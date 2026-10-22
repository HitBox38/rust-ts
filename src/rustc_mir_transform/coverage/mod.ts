// Stub module (lane mt-coverage): compiler/rustc_mir_transform/src/coverage/mod.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
// merge-w22b ported `InstrumentCoverage::policy` ahead of the lane (`mir_promoted` asks it for every body); the pass
// itself (`run_pass`) stays stubbed.
import { unported } from "../../std/panic.ts";
import type { Body } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, PassPolicy } from "../pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/coverage/mod.rs:25 InstrumentCoverage (lane mt-coverage)
export class InstrumentCoverage extends MirPass {
  readonly type_name = "rustc_mir_transform::coverage::InstrumentCoverage";

  // rustc: compiler/rustc_mir_transform/src/coverage/mod.rs:28 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.deref().instrument_coverage());
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::coverage::InstrumentCoverage (pass not ported)");
  }
}

// pub(super) mod query;
export * as query from "./query.ts";
