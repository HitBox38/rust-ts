// Stub module (lane mt-opt2): compiler/rustc_mir_transform/src/ssa_range_prop.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/ssa_range_prop.rs:25 SsaRangePropagation (lane mt-opt2)
export class SsaRangePropagation extends MirPass {
  readonly type_name = "rustc_mir_transform::ssa_range_prop::SsaRangePropagation";

  // rustc: compiler/rustc_mir_transform/src/ssa_range_prop.rs:28 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 2);
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::ssa_range_prop::SsaRangePropagation (pass not ported)");
  }
}
