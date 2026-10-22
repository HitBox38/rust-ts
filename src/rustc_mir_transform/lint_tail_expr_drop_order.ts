// Stub module (lane mt-built-lints): compiler/rustc_mir_transform/src/lint_tail_expr_drop_order.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";

// stub: compiler/rustc_mir_transform/src/lint_tail_expr_drop_order.rs:183 run_lint (lane mt-built-lints)
export function run_lint(_tcx: TyCtxt, _def_id: LocalDefId, _body: Body): void {
  return unported("rustc_mir_transform::lint_tail_expr_drop_order::run_lint");
}
