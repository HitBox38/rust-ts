// Port of compiler/rustc_infer/src/traits/project.rs (lane infer-opaque-snapshot).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported_methods } from "../../rust_ts/stubs.ts";
import { Normalized, ProjectionCacheKey, ProjectionCacheStorage } from "./project.gen.ts";

export * from "./project.gen.ts";

import type { InferCtxtUndoLogs } from "../infer/snapshot/undo_log.ts";
import type { SnapshotMapStorage, UndoLog as SnapshotMapUndoLog } from "../../rustc_data_structures/snapshot_map/mod.ts";
import type { ProjectionCacheEntry } from "./project.gen.ts";

// rustc-type: compiler/rustc_infer/src/traits/project.rs:13 UndoLog
export type UndoLog = SnapshotMapUndoLog<ProjectionCacheKey, ProjectionCacheEntry>;

// rustc-type: compiler/rustc_infer/src/traits/project.rs:66 ProjectionCache
// PORT: hand class (codegen `hand`): the field `map` is `map_` (method `map()`). `&'a mut SnapshotMapStorage` is the
// storage itself.
// PORT: `SnapshotMapStorage<ProjectionCacheKey, _>` is a JS `Map` keyed by identity; `ProjectionCacheKey` is a plain
// struct, so the port of this file must key the map by value (a `KeyedMap` on `intern_key`).
export class ProjectionCache {
  constructor(
    public map_: SnapshotMapStorage<ProjectionCacheKey, ProjectionCacheEntry>,
    public undo_log: InferCtxtUndoLogs,
  ) {}
}

// Manual Debug impls of this file's types live in traits/structural_impls.rs (structural_impls.ts).
export { debug_MismatchedProjectionTypes, debug_Normalized } from "./structural_impls.ts";

unported_methods(Normalized.prototype, "rustc_infer::traits::project::Normalized", ["with"]);
unported_methods(ProjectionCacheStorage.prototype, "rustc_infer::traits::project::ProjectionCacheStorage", ["with_log", "reverse"]);
unported_methods(ProjectionCacheKey, "rustc_infer::traits::project::ProjectionCacheKey", ["new"]);
unported_methods(ProjectionCache.prototype, "rustc_infer::traits::project::ProjectionCache", ["map", "clear", "try_start", "insert_term", "complete", "is_complete", "ambiguous", "recur", "error"]);
