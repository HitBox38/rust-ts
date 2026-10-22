// Stub module (lane mt-liveness): compiler/rustc_mir_transform/src/liveness.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { DenseBitSet } from "../rustc_index/bit_set.ts";
import type { FieldIdx } from "../rustc_abi/layout.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";

// stub: compiler/rustc_mir_transform/src/liveness.rs:54 check_liveness (lane mt-liveness)
export function check_liveness(_tcx: TyCtxt, _def_id: LocalDefId): DenseBitSet<FieldIdx> {
  return unported("rustc_mir_transform::liveness::check_liveness");
}
