// Stub module (lane mt-opt2): compiler/rustc_mir_transform/src/dead_store_elimination.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/dead_store_elimination.rs:138 DeadStoreElimination (lane mt-opt2)
// PORT: a pass enum (pass_manager.ts header): one frozen instance per variant, tagged `$`.
export type DeadStoreElimination_variant = "Initial" | "Final";
export class DeadStoreElimination extends MirPass {
  readonly type_name = "rustc_mir_transform::dead_store_elimination::DeadStoreElimination";

  private constructor(readonly $: DeadStoreElimination_variant) {
    super();
    Object.freeze(this);
  }

  static readonly Initial = new DeadStoreElimination("Initial");
  static readonly Final = new DeadStoreElimination("Final");

  // rustc: compiler/rustc_mir_transform/src/dead_store_elimination.rs:144 name
  override name(): string {
    switch (this.$) {
      case "Initial":
        return "DeadStoreElimination-initial";
      case "Final":
        return "DeadStoreElimination-final";
    }
  }

  // rustc: compiler/rustc_mir_transform/src/dead_store_elimination.rs:151 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 2);
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::dead_store_elimination::DeadStoreElimination (pass not ported)");
  }
}
