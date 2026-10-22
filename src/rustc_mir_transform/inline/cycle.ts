// Stub module (lane mt-inline): compiler/rustc_mir_transform/src/inline/cycle.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../../std/panic.ts";
import type { DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import type { InstanceKind } from "../../rustc_middle/ty/instance.ts";
import type { GenericArgsRef } from "../../rustc_middle/ty/generic_args.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";

// stub: compiler/rustc_mir_transform/src/inline/cycle.rs:152 mir_callgraph_cyclic (lane mt-inline)
export function mir_callgraph_cyclic(_tcx: TyCtxt, _root: LocalDefId): Set<LocalDefId> | undefined {
  return unported("rustc_mir_transform::inline::cycle::mir_callgraph_cyclic");
}

// stub: compiler/rustc_mir_transform/src/inline/cycle.rs:192 mir_inliner_callees (lane mt-inline)
export function mir_inliner_callees(_tcx: TyCtxt, _instance: InstanceKind): readonly [DefId, GenericArgsRef][] {
  return unported("rustc_mir_transform::inline::cycle::mir_inliner_callees");
}
