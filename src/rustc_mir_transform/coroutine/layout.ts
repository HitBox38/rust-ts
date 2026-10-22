// Stub module (lane mt-coroutine-b): compiler/rustc_mir_transform/src/coroutine/layout.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../../std/panic.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { CoroutineLayout } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";

// stub: compiler/rustc_mir_transform/src/coroutine/layout.rs:457 mir_coroutine_witnesses (lane mt-coroutine-b)
export function mir_coroutine_witnesses(_tcx: TyCtxt, _def_id: LocalDefId): CoroutineLayout | undefined {
  return unported("rustc_mir_transform::coroutine::layout::mir_coroutine_witnesses");
}
