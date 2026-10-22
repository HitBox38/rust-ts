// Stub module (lane mt-built-lints): compiler/rustc_mir_transform/src/lint_and_remove_uninhabited.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, type PassPolicy } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/lint_and_remove_uninhabited.rs:11 LintAndRemoveUninhabited (lane mt-built-lints)
export class LintAndRemoveUninhabited extends MirPass {
  readonly type_name = "rustc_mir_transform::lint_and_remove_uninhabited::LintAndRemoveUninhabited";

  policy(_ctx: PassCtx): PassPolicy {
    return unported("rustc_mir_transform::lint_and_remove_uninhabited::LintAndRemoveUninhabited (pass not ported)");
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::lint_and_remove_uninhabited::LintAndRemoveUninhabited (pass not ported)");
  }
}
