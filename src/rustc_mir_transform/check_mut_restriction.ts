// Stub module (lane mt-built-lints): compiler/rustc_mir_transform/src/check_mut_restriction.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirLint } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/check_mut_restriction.rs:9 CheckMutRestriction (lane mt-built-lints)
export class CheckMutRestriction extends MirLint {
  readonly type_name = "rustc_mir_transform::check_mut_restriction::CheckMutRestriction";

  run_lint(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::check_mut_restriction::CheckMutRestriction (pass not ported)");
  }
}
