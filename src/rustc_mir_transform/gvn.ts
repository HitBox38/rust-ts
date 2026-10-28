// Stub module (lane mt-opt2): compiler/rustc_mir_transform/src/gvn.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/gvn.rs:128 GVN (lane mt-opt2)
export class GVN extends MirPass {
  readonly type_name = "rustc_mir_transform::gvn::GVN";

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:131 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 2);
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::gvn::GVN (pass not ported)");
  }
}
