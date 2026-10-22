// Stub module (lane mt-coroutine-a): compiler/rustc_mir_transform/src/coroutine/by_move_body.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../../std/panic.ts";
import type { DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";

// stub: compiler/rustc_mir_transform/src/coroutine/by_move_body.rs:83 coroutine_by_move_body_def_id (lane mt-coroutine-a)
export function coroutine_by_move_body_def_id(_tcx: TyCtxt, _coroutine_def_id: LocalDefId): DefId {
  return unported("rustc_mir_transform::coroutine::by_move_body::coroutine_by_move_body_def_id");
}
