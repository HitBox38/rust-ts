//! Code for projecting associated types out of trait references.
// Port of compiler/rustc_infer/src/traits/project.rs (lane infer-opaque-snapshot). The data types are generated
// (project.gen.ts) except the hand classes `ProjectionCache` (field rename) and `ProjectionCacheStorage` (keyed map).
// Init order: other rustc_infer modules are read inside function bodies only.
//
// PORT: `tracing` (`debug!` / `info!`) is left out (kept as comments).

import { clone_Normalized, clone_ProjectionCacheEntry, debug_ProjectionCacheKey, Normalized, ProjectionCacheEntry, ProjectionCacheKey } from "./project.gen.ts";

export * from "./project.gen.ts";

import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { SnapshotMap, type SnapshotMapStorage, type UndoLog as SnapshotMapUndoLog } from "../../rustc_data_structures/snapshot_map/mod.ts";
import { EvaluationResult } from "../../rustc_middle/traits/select.ts";
import type { ParamEnv } from "../../rustc_middle/ty/mod.ts";
import type { AliasTerm } from "../../rustc_type_ir/ty/alias.ts";
import { PLAIN } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { UndoLogs } from "../../vendor/ena/undo_log.ts";
import type { InferCtxtUndoLogs } from "../infer/snapshot/undo_log.ts";
import { UndoLog as InferUndoLog } from "../infer/snapshot/undo_log.ts";
import type { NormalizedTerm } from "./project.gen.ts";

// rustc-type: compiler/rustc_infer/src/traits/project.rs:13 UndoLog
export type UndoLog = SnapshotMapUndoLog<ProjectionCacheKey, ProjectionCacheEntry>;

// # Cache

/// The projection cache. Unlike the standard caches, this can include
/// infcx-dependent type variables, therefore we have to roll the
/// cache back each time we roll a snapshot back, to avoid assumptions
/// on yet-unresolved inference variables. Types with placeholder
/// regions also have to be removed when the respective snapshot ends.
///
/// Because of that, projection cache entries can be "stranded" and left
/// inaccessible when type variables inside the key are resolved. We make no
/// attempt to recover or remove "stranded" entries, but rather let them be
/// (for the lifetime of the infcx).
///
/// Entries in the projection cache might contain inference variables
/// that will be resolved by obligations on the projection cache entry (e.g.,
/// when a type parameter in the associated type is constrained through
/// an "RFC 447" projection on the impl).
///
/// When working with a fulfillment context, the derived obligations of each
/// projection cache entry will be registered on the fulfillcx, so any users
/// that can wait for a fulfillcx fixed point need not care about this. However,
/// users that don't wait for a fixed point (e.g., trait evaluation) have to
/// resolve the obligations themselves to make sure the projected result is
/// ok and avoid issues like #43132.
///
/// If that is done, after evaluation the obligations, it is a good idea to
/// call `ProjectionCache::complete` to make sure the obligations won't be
/// re-evaluated and avoid an exponential worst-case.
//
// FIXME: we probably also want some sort of cross-infcx cache here to
// reduce the amount of duplication. Let's see what we get with the Chalk reforms.
// rustc-type: compiler/rustc_infer/src/traits/project.rs:66 ProjectionCache
// PORT: hand class (codegen `hand`): the field `map` is `map_` (method `map()`). `&'a mut SnapshotMapStorage` is the
// storage itself (its map is a `KeyedMap`, see `ProjectionCacheStorage`).
export class ProjectionCache {
  constructor(
    public map_: SnapshotMapStorage<ProjectionCacheKey, ProjectionCacheEntry>,
    public undo_log: InferCtxtUndoLogs,
  ) {}
}

// rustc-type: compiler/rustc_infer/src/traits/project.rs:72 ProjectionCacheStorage
// PORT: hand class (codegen `hand`): `ProjectionCacheKey` is a plain struct compared by value (`#[derive(Hash, Eq)]`),
// so the `SnapshotMapStorage`'s map is a `KeyedMap` on `intern_key` (rust_ts/keyed.ts). The derived `Default` / `Clone`
// are `default_ProjectionCacheStorage` / `clone_ProjectionCacheStorage` below.
export class ProjectionCacheStorage {
  constructor(public map: SnapshotMapStorage<ProjectionCacheKey, ProjectionCacheEntry>) {}
}

/** `#[derive(Default)]` (`SnapshotMapStorage::default()` over a keyed map). */
export function default_ProjectionCacheStorage(): ProjectionCacheStorage {
  return new ProjectionCacheStorage(new SnapshotMap(new KeyedMap<ProjectionCacheKey, ProjectionCacheEntry>(intern_key), undefined));
}

/** `#[derive(Clone)]`: the `SnapshotMap`'s `#[derive(Clone)]` clones its map (the `()` undo log is unit). The keys are
 *  immutable (`Copy`); the entries are cloned (`ProjectionCacheEntry: Clone`). */
export function clone_ProjectionCacheStorage(v: ProjectionCacheStorage): ProjectionCacheStorage {
  const map = new KeyedMap<ProjectionCacheKey, ProjectionCacheEntry>(intern_key);
  for (const [k, e] of v.map.map) map.set(k, clone_ProjectionCacheEntry(e));
  return new ProjectionCacheStorage(new SnapshotMap(map, undefined));
}

// ---- impl<T> Normalized<T> -------------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/traits/project.rs:30 with
Normalized.prototype.with = function <T, U>(this: Normalized<T>, value: U): Normalized<U> {
  return new Normalized(value, this.obligations);
};

// ---- impl ProjectionCacheKey -----------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/traits/project.rs:83 new
(ProjectionCacheKey as unknown as { new: typeof ProjectionCacheKey.new }).new = function (term: AliasTerm, param_env: ParamEnv): ProjectionCacheKey {
  return new ProjectionCacheKey(term, param_env);
};

// ---- impl ProjectionCacheStorage -------------------------------------------------------------------------------------

// #[inline]
// rustc: compiler/rustc_infer/src/traits/project.rs:127 with_log
ProjectionCacheStorage.prototype.with_log = function (this: ProjectionCacheStorage, undo_log: InferCtxtUndoLogs): ProjectionCache {
  return new ProjectionCache(this.map, undo_log);
};

// ---- impl ProjectionCache --------------------------------------------------------------------------------------------

// PORT: `SnapshotMapRef<'_, K, V, InferCtxtUndoLogs>`: the map with the shared undo log viewed at this table's undo type
// (`UndoLog: From<project::UndoLog>`, `InferCtxtUndoLogs.as_`).
// #[inline]
// rustc: compiler/rustc_infer/src/traits/project.rs:137 map
ProjectionCache.prototype.map = function (this: ProjectionCache): SnapshotMap<ProjectionCacheKey, ProjectionCacheEntry, UndoLogs<UndoLog>> {
  return this.map_.with_log(this.undo_log.as_(InferUndoLog.from_ProjectionCache));
};

// rustc: compiler/rustc_infer/src/traits/project.rs:148 clear
ProjectionCache.prototype.clear = function (this: ProjectionCache): void {
  this.map().clear();
};

/// Try to start normalize `key`; returns an error if
/// normalization already occurred (this error corresponds to a
/// cache hit, so it's actually a good thing).
// rustc: compiler/rustc_infer/src/traits/project.rs:155 try_start
ProjectionCache.prototype.try_start = function (this: ProjectionCache, key: ProjectionCacheKey): Result<null, ProjectionCacheEntry> {
  const map = this.map();
  const entry = map.get(key);
  if (entry !== undefined) {
    return Err(clone_ProjectionCacheEntry(entry));
  }

  map.insert(key, ProjectionCacheEntry.InProgress);
  return Ok(null);
};

/// Indicates that `key` was normalized to `value`.
// rustc: compiler/rustc_infer/src/traits/project.rs:169 insert_term
ProjectionCache.prototype.insert_term = function (this: ProjectionCache, key: ProjectionCacheKey, value: NormalizedTerm): void {
  // debug!(
  //     "ProjectionCacheEntry::insert_ty: adding cache entry: key={:?}, value={:?}",
  //     key, value
  // );
  const map = this.map();
  if (map.get(key)?.$ === "Recur") {
    // debug!("Not overwriting Recur");
    return;
  }
  const fresh_key = map.insert(key, { $: "NormalizedTerm", ty: value, complete: undefined });
  if (fresh_key) never_started(key);
};

/// Mark the relevant projection cache key as having its derived obligations
/// complete, so they won't have to be re-computed (this is OK to do in a
/// snapshot - if the snapshot is rolled back, the obligations will be
/// marked as incomplete again).
// rustc: compiler/rustc_infer/src/traits/project.rs:188 complete
ProjectionCache.prototype.complete = function (this: ProjectionCache, key: ProjectionCacheKey, result: EvaluationResult): void {
  const map = this.map();
  const entry = map.get(key);
  if (entry !== undefined && entry.$ === "NormalizedTerm") {
    // info!("ProjectionCacheEntry::complete({:?}) - completing {:?}", key, ty);
    const ty = clone_Normalized(entry.ty, (x) => x);
    if (EvaluationResult.must_apply_considering_regions(result)) {
      ty.obligations = [];
    }
    map.insert(key, { $: "NormalizedTerm", ty, complete: result });
  } else {
    // Type inference could "strand behind" old cache entries. Leave
    // them alone for now.
    // info!("ProjectionCacheEntry::complete({:?}) - ignoring {:?}", key, value);
  }
};

// rustc: compiler/rustc_infer/src/traits/project.rs:210 is_complete
ProjectionCache.prototype.is_complete = function (this: ProjectionCache, key: ProjectionCacheKey): EvaluationResult | undefined {
  const res = this.map().get(key);
  if (res === undefined) return undefined;
  switch (res.$) {
    case "NormalizedTerm":
      return res.complete;
    default:
      return undefined;
  }
};

/// Indicates that trying to normalize `key` resulted in
/// ambiguity. No point in trying it again then until we gain more
/// type information (in which case, the "fully resolved" key will
/// be different).
// rustc: compiler/rustc_infer/src/traits/project.rs:221 ambiguous
ProjectionCache.prototype.ambiguous = function (this: ProjectionCache, key: ProjectionCacheKey): void {
  const fresh = this.map().insert(key, ProjectionCacheEntry.Ambiguous);
  if (fresh) never_started(key);
};

/// Indicates that while trying to normalize `key`, `key` was required to
/// be normalized again. Selection or evaluation should eventually report
/// an error here.
// rustc: compiler/rustc_infer/src/traits/project.rs:229 recur
ProjectionCache.prototype.recur = function (this: ProjectionCache, key: ProjectionCacheKey): void {
  const fresh = this.map().insert(key, ProjectionCacheEntry.Recur);
  if (fresh) never_started(key);
};

/// Indicates that trying to normalize `key` resulted in
/// error.
// rustc: compiler/rustc_infer/src/traits/project.rs:236 error
ProjectionCache.prototype.error = function (this: ProjectionCache, key: ProjectionCacheKey): void {
  const fresh = this.map().insert(key, ProjectionCacheEntry.Error);
  if (fresh) never_started(key);
};

// ---- impl Rollback<UndoLog> for ProjectionCacheStorage ---------------------------------------------------------------

// rustc: compiler/rustc_infer/src/traits/project.rs:243 reverse
ProjectionCacheStorage.prototype.reverse = function (this: ProjectionCacheStorage, undo: UndoLog): void {
  this.map.reverse(undo);
};

/** `assert!(!fresh, "never started projecting `{key:?}`")`: the message is formatted only when the assertion fails. */
function never_started(key: ProjectionCacheKey): never {
  return panic(`never started projecting \`${debug_ProjectionCacheKey(key, PLAIN)}\``);
}

// Manual Debug impls of this file's types live in traits/structural_impls.rs (structural_impls.ts).
export { debug_MismatchedProjectionTypes, debug_Normalized } from "./structural_impls.ts";
