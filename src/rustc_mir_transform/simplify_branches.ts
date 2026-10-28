// Port of compiler/rustc_mir_transform/src/simplify_branches.rs (lane mt-opt1).
//
// PORT: `pre_place_const.take()` in the terminator match guards reads the value without clearing it (it is not read
// afterwards; the two guarded arms are exclusive). The derived
// `PartialEq` of `mir::Place` (`place_const == *place`) compares `local` and the interned `projection` list.
import {
  type Body,
  type ConstOperand,
  Location,
  type Operand,
  type Place,
  type TerminatorKind,
  TerminatorKind as TerminatorKindC,
} from "../rustc_middle/mir/mod.ts";
import { Const as mir_Const } from "../rustc_middle/mir/consts.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { MirPatch } from "./patch.ts";

/** PORT: derived `PartialEq` of `mir::Place` (header). */
function place_eq(a: Place, b: Place): boolean {
  return a.local === b.local && a.projection === b.projection;
}

// rustc-type: compiler/rustc_mir_transform/src/simplify_branches.rs:8 SimplifyConstCondition
// PORT: a pass enum (pass_manager.ts header): one frozen instance per variant, tagged `$`.
export type SimplifyConstCondition_variant = "AfterInstSimplify" | "AfterConstProp" | "Final";
export class SimplifyConstCondition extends MirPass {
  readonly type_name = "rustc_mir_transform::simplify_branches::SimplifyConstCondition";

  private constructor(readonly $: SimplifyConstCondition_variant) {
    super();
    Object.freeze(this);
  }

  static readonly AfterInstSimplify = new SimplifyConstCondition("AfterInstSimplify");
  static readonly AfterConstProp = new SimplifyConstCondition("AfterConstProp");
  static readonly Final = new SimplifyConstCondition("Final");

  // rustc: compiler/rustc_mir_transform/src/simplify_branches.rs:16 name
  override name(): string {
    switch (this.$) {
      case "AfterInstSimplify":
        return "SimplifyConstCondition-after-inst-simplify";
      case "AfterConstProp":
        return "SimplifyConstCondition-after-const-prop";
      case "Final":
        return "SimplifyConstCondition-final";
    }
  }

  // rustc: compiler/rustc_mir_transform/src/simplify_branches.rs:26 policy
  policy(_ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(true);
  }

  // rustc: compiler/rustc_mir_transform/src/simplify_branches.rs:30 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // trace!("Running SimplifyConstCondition on {:?}", body.source);
    const typing_env = body.typing_env(tcx);
    const patch = MirPatch.new(body);

    // rustc: compiler/rustc_mir_transform/src/simplify_branches.rs:35 try_get_const
    function try_get_const(operand: Operand, has_place_const: [Place, ConstOperand] | undefined): ConstOperand | undefined {
      switch (operand.$) {
        case "Constant":
          return operand._0;
        case "Copy":
        case "Move":
          // `has_place_const` must be the LHS of the previous statement.
          // Soundness: There is nothing can modify the place, as there are no statements between the two statements.
          if (has_place_const !== undefined && place_eq(has_place_const[0], operand._0)) {
            return has_place_const[1];
          }
          return undefined;
        case "RuntimeChecks":
          return undefined;
      }
    }

    const blocks = body.basic_blocks.deref();
    blocks: for (let bb_ = 0; bb_ < blocks.length; bb_++) {
      const bb = bb_ as Location["block"];
      const block = blocks[bb]!;
      let pre_place_const: [Place, ConstOperand] | undefined = undefined;

      for (let statement_index = 0; statement_index < block.statements.length; statement_index++) {
        const stmt = block.statements[statement_index]!;
        const has_place_const = pre_place_const;
        pre_place_const = undefined;
        // Simplify `assume` of a known value: either a NOP or unreachable.
        const sk = stmt.kind;
        let c: ConstOperand | undefined;
        let constant: boolean | undefined;
        if (
          sk.$ === "Intrinsic" &&
          sk._0.$ === "Assume" &&
          (c = try_get_const(sk._0._0, has_place_const)) !== undefined &&
          (constant = mir_Const.try_eval_bool(c.const_, tcx, typing_env)) !== undefined
        ) {
          if (constant) {
            patch.nop_statement(new Location(bb, statement_index));
          } else {
            patch.patch_terminator(bb, TerminatorKindC.Unreachable);
            continue blocks;
          }
        } else if (sk.$ === "Assign" && sk._0[1].$ === "Use" && sk._0[1]._0.$ === "Constant") {
          pre_place_const = [sk._0[0], sk._0[1]._0._0];
        }
      }

      const terminator_ = block.terminator_();
      let terminator: TerminatorKind;
      const kind = terminator_.kind;
      let c: ConstOperand | undefined;
      let bits: bigint | undefined;
      let constant: boolean | undefined;
      if (
        kind.$ === "SwitchInt" &&
        (c = try_get_const(kind.discr, pre_place_const)) !== undefined &&
        (bits = mir_Const.try_eval_bits(c.const_, tcx, typing_env)) !== undefined
      ) {
        const target = kind.targets.target_for_value(bits);
        terminator = TerminatorKindC.goto(target);
      } else if (
        kind.$ === "Assert" &&
        (c = try_get_const(kind.cond, pre_place_const)) !== undefined &&
        (constant = mir_Const.try_eval_bool(c.const_, tcx, typing_env)) !== undefined &&
        constant === kind.expected
      ) {
        terminator = TerminatorKindC.goto(kind.target);
      } else {
        continue;
      }
      patch.patch_terminator(bb, terminator);
    }
    patch.apply(body);
  }
}
