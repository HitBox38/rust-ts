// Port of compiler/rustc_mir_transform/src/unreachable_prop.rs (lane mt-opt2-a).
//
// PORT: `FxHashSet<BasicBlock>` is a `Set<BasicBlock>`; it is only iterated to clear the statements of its blocks, where
// the order does not matter (as upstream notes). `targets.iter().filter(..)` handed to `SwitchTargets::new` is a
// generator, so `add_assumption(BinOp::Ne, ..)` runs in the same order as upstream's lazy filter (while `new` collects).
//! A pass that propagates the unreachable terminator of a block to its predecessors
//! when all of their successors are unreachable. This is achieved through a
//! post-order traversal of the blocks.
import { Size } from "../rustc_abi/lib.ts";
import { IntTy, UintTy } from "../rustc_ast_ir/lib.ts";
import { Scalar } from "../rustc_middle/mir/interpret/mod.ts";
import { Const as mir_Const } from "../rustc_middle/mir/consts.ts";
import {
  type BasicBlock,
  type Body,
  type BinOp,
  clone_Operand,
  ConstOperand,
  Operand,
  Place_from_Local,
  type Rvalue,
  SwitchTargets,
  type TerminatorKind,
  TerminatorKind as TerminatorKindC,
  traversal,
} from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { debug_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { bug } from "../rustc_span/macros.ts";
import { PLAIN } from "../std/fmt.ts";
import { unwrap } from "../std/panic.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { MirPatch } from "./patch.ts";

// rustc-type: compiler/rustc_mir_transform/src/unreachable_prop.rs:15 UnreachablePropagation
export class UnreachablePropagation extends MirPass {
  readonly type_name = "rustc_mir_transform::unreachable_prop::UnreachablePropagation";

  // rustc: compiler/rustc_mir_transform/src/unreachable_prop.rs:18 policy
  policy(ctx: PassCtx): PassPolicy {
    // Enable only under -Zmir-opt-level=2 as this can make programs less debuggable.
    return PassPolicy.optional(ctx.mir_opt_level() >= 2);
  }

  // rustc: compiler/rustc_mir_transform/src/unreachable_prop.rs:23 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    const patch = MirPatch.new(body);
    const unreachable_blocks = new Set<BasicBlock>();

    for (const [bb, bb_data] of traversal.postorder(body)) {
      const terminator = bb_data.terminator_();
      let is_unreachable: boolean;
      const kind = terminator.kind;
      if (kind.$ === "Unreachable") {
        is_unreachable = true;
      }
      // This will unconditionally run into an unreachable and is therefore unreachable
      // as well.
      else if (kind.$ === "Goto" && unreachable_blocks.has(kind.target)) {
        patch.patch_terminator(bb, TerminatorKindC.Unreachable);
        is_unreachable = true;
      }
      // Try to remove unreachable targets from the switch.
      else if (kind.$ === "SwitchInt") {
        is_unreachable = remove_successors_from_switch(tcx, bb, body, patch, (bb) => unreachable_blocks.has(bb));
      } else {
        is_unreachable = false;
      }
      if (is_unreachable) {
        unreachable_blocks.add(bb);
      }
    }

    patch.apply(body);

    // We do want do keep some unreachable blocks, but make them empty.
    // The order in which we clear bb statements does not matter.
    // #[allow(rustc::potential_query_instability)]
    for (const bb of unreachable_blocks) {
      body.basic_blocks_mut()[bb]!.statements.length = 0;
    }
  }
}

/// Return whether the current terminator is fully unreachable.
// rustc: compiler/rustc_mir_transform/src/unreachable_prop.rs:61 remove_successors_from_switch
export function remove_successors_from_switch(
  tcx: TyCtxt,
  bb: BasicBlock,
  body: Body,
  patch: MirPatch,
  is_unreachable_block: (bb: BasicBlock) => boolean,
): boolean {
  const terminator = body.basic_blocks.deref()[bb]!.terminator_();
  const kind = terminator.kind;
  if (kind.$ !== "SwitchInt") return bug();
  const { discr, targets } = kind;
  const source_info = terminator.source_info;
  const location = body.terminator_loc(bb);

  // If there are multiple targets, we want to keep information about reachability for codegen.
  // For example (see tests/codegen-llvm/match-optimizes-away.rs)
  //
  // pub enum Two { A, B }
  // pub fn identity(x: Two) -> Two {
  //     match x {
  //         Two::A => Two::A,
  //         Two::B => Two::B,
  //     }
  // }
  //
  // This generates a `switchInt() -> [0: 0, 1: 1, otherwise: unreachable]`, which allows us or
  // LLVM to turn it into just `x` later. Without the unreachable, such a transformation would be
  // illegal.
  //
  // In order to preserve this information, we record reachable and unreachable targets as
  // `Assume` statements in MIR.

  const discr_ty = Operand.ty(discr, body, tcx);
  const discr_kind = discr_ty.kind();
  let bits: number;
  switch (discr_kind.$) {
    case "Uint":
      bits = unwrap(UintTy.bit_width(UintTy.normalize(discr_kind._0, tcx.sess.target.pointer_width)));
      break;
    case "Int":
      bits = unwrap(IntTy.bit_width(IntTy.normalize(discr_kind._0, tcx.sess.target.pointer_width)));
      break;
    case "Char":
      bits = 32;
      break;
    case "Bool":
      bits = 1;
      break;
    default:
      // PORT: `{:?}` of the `TyKind` is `{:?}` of the `Ty` (as in validate.ts).
      return bug(`unhandled type: ${debug_Ty(discr_ty, PLAIN)}`);
  }
  const discr_size = Size.from_bits(bits);

  const add_assumption = (binop: BinOp, value: bigint): void => {
    const local = patch.new_temp(tcx.types.bool, source_info.span);
    const value_: Operand = {
      $: "Constant",
      _0: new ConstOperand(source_info.span, undefined, mir_Const.from_scalar(tcx, Scalar.from_uint(value, discr_size), discr_ty)),
    };
    const cmp: Rvalue = { $: "BinaryOp", _0: binop, _1: [Operand.to_copy(discr), value_] };
    patch.add_assign(location, Place_from_Local(local), cmp);

    const assume = { $: "Assume", _0: { $: "Move", _0: Place_from_Local(local) } } as const;
    patch.add_statement(location, { $: "Intrinsic", _0: assume });
  };

  const otherwise = targets.otherwise();
  const otherwise_unreachable = is_unreachable_block(otherwise);

  const reachable_iter = (function* (): Generator<[bigint, BasicBlock]> {
    for (const [value, bb] of targets.iter()) {
      const is_unreachable = is_unreachable_block(bb);
      // We remove this target from the switch, so record the inequality using `Assume`.
      if (is_unreachable && !otherwise_unreachable) {
        add_assumption("Ne", value);
      }
      if (!is_unreachable) yield [value, bb];
    }
  })();

  const new_targets = SwitchTargets.new(reachable_iter, otherwise);

  const num_targets = new_targets.all_targets().length;
  const fully_unreachable = num_targets === 1 && otherwise_unreachable;

  let terminator_: TerminatorKind;
  if (num_targets === 1 && otherwise_unreachable) {
    // If all targets are unreachable, we can be unreachable as well.
    terminator_ = TerminatorKindC.Unreachable;
  } else if (num_targets === 1 && !otherwise_unreachable) {
    terminator_ = TerminatorKindC.goto(otherwise);
  } else if (num_targets === 2 && otherwise_unreachable) {
    // All targets are unreachable except one. Record the equality, and make it a goto.
    const [value, target] = unwrap(new_targets.iter().next().value);
    add_assumption("Eq", value);
    terminator_ = TerminatorKindC.goto(target);
  } else if (num_targets === targets.all_targets().length) {
    // Nothing has changed.
    return false;
  } else {
    terminator_ = { $: "SwitchInt", discr: clone_Operand(discr), targets: new_targets };
  }

  patch.patch_terminator(bb, terminator_);
  return fully_unreachable;
}
