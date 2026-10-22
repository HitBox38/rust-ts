// Stub module (lane mt-validate): compiler/rustc_mir_transform/src/lint.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";

// stub: compiler/rustc_mir_transform/src/lint.rs:15 lint_body (lane mt-validate)
export function lint_body(_tcx: TyCtxt, _body: Body, _when: string): void {
  return unported("rustc_mir_transform::lint::lint_body");
}
