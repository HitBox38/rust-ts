// Stub module (lane mt-opt1): compiler/rustc_mir_transform/src/simplify_branches.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, type PassPolicy } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/simplify_branches.rs:8 SimplifyConstCondition (lane mt-opt1)
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

  policy(_ctx: PassCtx): PassPolicy {
    return unported("rustc_mir_transform::simplify_branches::SimplifyConstCondition (pass not ported)");
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::simplify_branches::SimplifyConstCondition (pass not ported)");
  }
}
