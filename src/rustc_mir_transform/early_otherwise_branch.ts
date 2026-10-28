// Port of compiler/rustc_mir_transform/src/early_otherwise_branch.rs (lane mt-opt2-d).
//
// PORT: `Place`, `SourceInfo` and `Operand` are `Copy` (or cloned) upstream: `*child_place` / `*source_info` copied out of
// the body are `clone_Place` / `clone_SourceInfo`, and `opt_data.child_place` is cloned at its use in the new
// statement, so no new MIR node is shared with the body (MIR aliasing rule, PORTING §8). The derived `PartialEq` of
// `Place` / `Operand` (`from_place != place`, `*switch_op != Operand::Move(..)`) is the file-local `place_eq` and the
// variant check plus `place_eq`.
import {
  BasicBlockData,
  type BasicBlock,
  BinOp,
  type Body,
  Location,
  Operand,
  type Place,
  type SourceInfo,
  SwitchTargets,
  TerminatorKind,
  clone_Operand,
  clone_Place,
  clone_SourceInfo,
} from "../rustc_middle/mir/mod.ts";
import { Place_from_Local } from "../rustc_middle/mir/statement.ts";
import { Terminator } from "../rustc_middle/mir/terminator.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { unreachable } from "../std/panic.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { MirPatch } from "./patch.ts";
import { simplify_cfg } from "./simplify.ts";

/** PORT: derived `PartialEq` of `mir::Place` (header). */
function place_eq(a: Place, b: Place): boolean {
  return a.local === b.local && a.projection === b.projection;
}

/// This pass optimizes something like
/// ```ignore (syntax-highlighting-only)
/// let x: Option<()>;
/// let y: Option<()>;
/// match (x,y) {
///     (Some(_), Some(_)) => {0},
///     (None, None) => {2},
///     _ => {1}
/// }
/// ```
/// into something like
/// ```ignore (syntax-highlighting-only)
/// let x: Option<()>;
/// let y: Option<()>;
/// let discriminant_x = std::mem::discriminant(x);
/// let discriminant_y = std::mem::discriminant(y);
/// if discriminant_x == discriminant_y {
///     match x {
///         Some(_) => 0,
///         None => 2,
///     }
/// } else {
///     1
/// }
/// ```
///
/// Specifically, it looks for instances of control flow like this:
/// ```text
///
///     =================
///     |      BB1      |
///     |---------------|                  ============================
///     |     ...       |         /------> |            BBC           |
///     |---------------|         |        |--------------------------|
///     |  switchInt(Q) |         |        |   _cl = discriminant(P)  |
///     |       c       | --------/        |--------------------------|
///     |       d       | -------\         |       switchInt(_cl)     |
///     |      ...      |        |         |            c             | ---> BBC.2
///     |    otherwise  | --\    |    /--- |         otherwise        |
///     =================   |    |    |    ============================
///                         |    |    |
///     =================   |    |    |
///     |      BBU      | <-|    |    |    ============================
///     |---------------|        \-------> |            BBD           |
///     |---------------|             |    |--------------------------|
///     |  unreachable  |             |    |   _dl = discriminant(P)  |
///     =================             |    |--------------------------|
///                                   |    |       switchInt(_dl)     |
///     =================             |    |            d             | ---> BBD.2
///     |      BB9      | <--------------- |         otherwise        |
///     |---------------|                  ============================
///     |      ...      |
///     =================
/// ```
/// Where the `otherwise` branch on `BB1` is permitted to either go to `BBU`. In the
/// code:
///  - `BB1` is `parent` and `BBC, BBD` are children
///  - `P` is `child_place`
///  - `child_ty` is the type of `_cl`.
///  - `Q` is `parent_op`.
///  - `parent_ty` is the type of `Q`.
///  - `BB9` is `destination`
/// All this is then transformed into:
/// ```text
///
///     =======================
///     |          BB1        |
///     |---------------------|                  ============================
///     |          ...        |         /------> |           BBEq           |
///     | _s = discriminant(P)|         |        |--------------------------|
///     | _t = Ne(Q, _s)      |         |        |--------------------------|
///     |---------------------|         |        |       switchInt(Q)       |
///     |     switchInt(_t)   |         |        |            c             | ---> BBC.2
///     |        false        | --------/        |            d             | ---> BBD.2
///     |       otherwise     |       /--------- |         otherwise        |
///     =======================       |          ============================
///                                   |
///     =================             |
///     |      BB9      | <-----------/
///     |---------------|
///     |      ...      |
///     =================
/// ```
// rustc-type: compiler/rustc_mir_transform/src/early_otherwise_branch.rs:94 EarlyOtherwiseBranch
export class EarlyOtherwiseBranch extends MirPass {
  readonly type_name = "rustc_mir_transform::early_otherwise_branch::EarlyOtherwiseBranch";

  // rustc: compiler/rustc_mir_transform/src/early_otherwise_branch.rs:97 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 2);
  }

  // rustc: compiler/rustc_mir_transform/src/early_otherwise_branch.rs:101 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // trace!("running EarlyOtherwiseBranch on {:?}", body.source);

    let should_cleanup = false;

    // Also consider newly generated bbs in the same pass
    // PORT: `body.basic_blocks.indices()` is the range taken when the loop starts.
    const num_blocks = body.basic_blocks.deref().length;
    for (let p = 0; p < num_blocks; p++) {
      const parent = p as BasicBlock;
      const bbs = body.basic_blocks.deref();
      const opt_data = evaluate_candidate(tcx, body, parent);
      if (opt_data === undefined) continue;

      // trace!("SUCCESS: found optimization possibility to apply: {opt_data:?}");

      should_cleanup = true;

      const parent_kind = bbs[parent]!.terminator_().kind;
      if (parent_kind.$ !== "SwitchInt") {
        return unreachable();
      }
      const parent_targets = parent_kind.targets;
      // Always correct since we can only switch on `Copy` types
      const parent_op = Operand.to_copy(parent_kind.discr);
      const parent_ty = Operand.ty(parent_op, body.local_decls, tcx);
      const statements_before = bbs[parent]!.statements.length;
      const parent_end = new Location(parent, statements_before);

      const patch = MirPatch.new(body);

      let second_operand: Operand;
      if (opt_data.need_hoist_discriminant) {
        // create temp to store second discriminant in, `_s` in example above
        const second_discriminant_temp = patch.new_temp(opt_data.child_ty, opt_data.child_source.span);

        // create assignment of discriminant
        patch.add_assign(parent_end, Place_from_Local(second_discriminant_temp), {
          $: "Discriminant",
          _0: clone_Place(opt_data.child_place),
        });
        second_operand = { $: "Move", _0: Place_from_Local(second_discriminant_temp) };
      } else {
        second_operand = { $: "Copy", _0: clone_Place(opt_data.child_place) };
      }

      // create temp to store inequality comparison between the two discriminants, `_t` in
      // example above
      const nequal: BinOp = BinOp.Ne;
      const comp_res_type = BinOp.ty(nequal, tcx, parent_ty, opt_data.child_ty);
      const comp_temp = patch.new_temp(comp_res_type, opt_data.child_source.span);

      // create inequality comparison
      patch.add_statement(parent_end, {
        $: "Assign",
        _0: [Place_from_Local(comp_temp), { $: "BinaryOp", _0: nequal, _1: [clone_Operand(parent_op), second_operand] }],
      });

      const eq_new_targets = (function* (): Generator<[bigint, BasicBlock]> {
        for (const [value, child] of parent_targets.iter()) {
          const k = bbs[child]!.terminator_().kind;
          if (k.$ !== "SwitchInt") {
            return unreachable();
          }
          yield [value, k.targets.target_for_value(value)];
        }
      })();
      // The otherwise either is the same target branch or an unreachable.
      const eq_targets = SwitchTargets.new(eq_new_targets, parent_targets.otherwise());

      // Create `bbEq` in example above
      const eq_switch = BasicBlockData.new(
        new Terminator(
          clone_SourceInfo(bbs[parent]!.terminator_().source_info),
          // switch on the first discriminant, so we can mark the second one as dead
          { $: "SwitchInt", discr: parent_op, targets: eq_targets },
        ),
        bbs[parent]!.is_cleanup,
      );

      const eq_bb = patch.new_block(eq_switch);

      // Jump to it on the basis of the inequality comparison
      const true_case = opt_data.destination;
      const false_case = eq_bb;
      patch.patch_terminator(parent, TerminatorKind.if_({ $: "Move", _0: Place_from_Local(comp_temp) }, true_case, false_case));

      patch.apply(body);
    }

    // Since this optimization adds new basic blocks and invalidates others,
    // clean up the cfg to make it nicer for other passes
    if (should_cleanup) {
      simplify_cfg(tcx, body);
    }
  }
}

// #[derive(Debug)]
// rustc-type: compiler/rustc_mir_transform/src/early_otherwise_branch.rs:203 OptimizationData
interface OptimizationData {
  destination: BasicBlock;
  child_place: Place;
  child_ty: Ty;
  child_source: SourceInfo;
  need_hoist_discriminant: boolean;
}

// rustc: compiler/rustc_mir_transform/src/early_otherwise_branch.rs:211 evaluate_candidate
function evaluate_candidate(tcx: TyCtxt, body: Body, parent: BasicBlock): OptimizationData | undefined {
  const bbs = body.basic_blocks.deref();
  // NB: If this BB is a cleanup, we may need to figure out what else needs to be handled.
  if (bbs[parent]!.is_cleanup) {
    return undefined;
  }
  const parent_kind = bbs[parent]!.terminator_().kind;
  if (parent_kind.$ !== "SwitchInt") {
    return undefined;
  }
  const targets = parent_kind.targets;
  const parent_discr = parent_kind.discr;
  const parent_ty = Operand.ty(parent_discr, body.local_decls, tcx);
  const first = targets.iter().next();
  if (first.done === true) return undefined;
  const [, child] = first.value;

  const child_term = bbs[child]!.terminator_();
  if (child_term.kind.$ !== "SwitchInt") {
    return undefined;
  }
  const child_targets = child_term.kind.targets;
  const child_discr = child_term.kind.discr;
  const source_info = child_term.source_info;
  const child_ty = Operand.ty(child_discr, body.local_decls, tcx);
  if (child_ty !== parent_ty) {
    return undefined;
  }

  // For now, we only handle:
  // ```
  // bb4: {
  //     _8 = discriminant((_3.1: Enum1));
  //    switchInt(move _8) -> [2: bb7, otherwise: bb1];
  // }
  // ```
  // and
  // ```
  // bb2: {
  //     switchInt((_3.1: u64)) -> [1: bb5, otherwise: bb1];
  // }
  // ```
  if (bbs[child]!.statements.length > 1) {
    return undefined;
  }

  // When thie BB has exactly one statement, this statement should be discriminant.
  const need_hoist_discriminant = bbs[child]!.statements.length === 1;
  const otherwise_is_empty_unreachable = bbs[targets.otherwise()]!.is_empty_unreachable();
  let child_place: Place;
  if (need_hoist_discriminant) {
    // Handle:
    // ```
    // bb4: {
    //     _8 = discriminant((_3.1: Enum1));
    //    switchInt(move _8) -> [2: bb7, otherwise: bb1];
    // }
    // ```
    const k = bbs[child]!.statements[0]!.kind;
    if (!(k.$ === "Assign" && k._0[1].$ === "Discriminant")) {
      return undefined;
    }
    child_place = clone_Place(k._0[1]._0);
  } else {
    // Handle:
    // ```
    // bb2: {
    //     switchInt((_3.1: u64)) -> [1: bb5, otherwise: bb1];
    // }
    // ```
    if (child_discr.$ !== "Copy") {
      return undefined;
    }
    child_place = clone_Place(child_discr._0);
  }
  const destination = otherwise_is_empty_unreachable ? child_targets.otherwise() : targets.otherwise();

  // Verify that the optimization is legal for each branch
  for (const [value, child] of targets.iter()) {
    if (
      !verify_candidate_branch(
        bbs[child]!,
        value,
        child_place,
        destination,
        need_hoist_discriminant,
        otherwise_is_empty_unreachable,
      )
    ) {
      return undefined;
    }
  }
  return {
    destination,
    child_place,
    child_ty,
    child_source: clone_SourceInfo(source_info),
    need_hoist_discriminant,
  };
}

// rustc: compiler/rustc_mir_transform/src/early_otherwise_branch.rs:317 verify_candidate_branch
function verify_candidate_branch(
  branch: BasicBlockData,
  value: bigint,
  place: Place,
  destination: BasicBlock,
  need_hoist_discriminant: boolean,
  otherwise_is_empty_unreachable: boolean,
): boolean {
  // In order for the optimization to be correct, the terminator must be a `SwitchInt`.
  const term_kind = branch.terminator_().kind;
  if (term_kind.$ !== "SwitchInt") {
    return false;
  }
  const switch_op = term_kind.discr;
  const targets = term_kind.targets;
  if (!otherwise_is_empty_unreachable) {
    // Someone could write code like this:
    // ```rust
    // let Q = val;
    // if discriminant(P) == otherwise {
    //     let ptr = &mut Q as *mut _ as *mut u8;
    //     // It may be difficult for us to effectively determine whether values are valid.
    //     // Invalid values can come from all sorts of corners.
    //     unsafe { *ptr = 10; }
    // }
    //
    // match P {
    //    A => match Q {
    //        A => {
    //            // code
    //        }
    //        _ => {
    //            // don't use Q
    //        }
    //    }
    //    _ => {
    //        // don't use Q
    //    }
    // };
    // ```
    //
    // Hoisting the `discriminant(Q)` out of the `A` arm causes us to compute the discriminant of an
    // invalid value, which is UB.
    // In order to fix this, **we would either need to show that the discriminant computation of
    // `place` is computed in all branches**.
    // For <https://github.com/rust-lang/rust/issues/95162>, we adopt a conservative approach and
    // consider only the `otherwise` branch has no statements and an unreachable terminator.
    if (need_hoist_discriminant) {
      return false;
    }
    // For <https://github.com/rust-lang/rust/issues/159591>:
    // ```
    // bb0: {
    //     switchInt(copy _1) -> [1: bb1, 2: bb2, otherwise: bb5];
    // }
    // bb1: {
    //     switchInt(copy (*_2)) -> [1: bb3, otherwise: bb5];
    // }
    // bb2: {
    //     switchInt(copy (*_2)) -> [2: bb4, otherwise: bb5];
    // }
    // ```
    // We cannot hoist the dereference of `_2` to `bb0`,
    // because execution can reach `bb5` without dereferencing `_2`.
    const place_ = Operand.place(switch_op);
    if (place_ !== undefined && !place_.is_stable_offset()) {
      return false;
    }
  }
  if (need_hoist_discriminant) {
    // If we need hoist discriminant, the branch must have exactly one statement.
    if (branch.statements.length !== 1) {
      return false;
    }
    const statement = branch.statements[0]!;
    // The statement must assign the discriminant of `place`.
    const k = statement.kind;
    if (!(k.$ === "Assign" && k._0[1].$ === "Discriminant")) {
      return false;
    }
    const discr_place = k._0[0];
    const from_place = k._0[1]._0;
    if (!place_eq(from_place, place)) {
      return false;
    }
    // The assignment must invalidate a local that terminate on a `SwitchInt`.
    if (discr_place.projection.length !== 0 || !(switch_op.$ === "Move" && place_eq(switch_op._0, discr_place))) {
      return false;
    }
  } else {
    // If we don't need hoist discriminant, the branch must not have any statements.
    if (branch.statements.length !== 0) {
      return false;
    }
    // The place on `SwitchInt` must be the same.
    if (!(switch_op.$ === "Copy" && place_eq(switch_op._0, place))) {
      return false;
    }
  }
  // It must fall through to `destination` if the switch misses.
  if (destination !== targets.otherwise()) {
    return false;
  }
  // It must have exactly one branch for value `value` and have no more branches.
  const iter = targets.iter();
  const a = iter.next();
  const b = iter.next();
  if (!(a.done !== true && b.done === true)) {
    return false;
  }
  const [target_value] = a.value;
  return target_value === value;
}
