//! Helper functions that serve as the immediate implementation of
//! `tcx.$query(..)` and its variations.
// Port of compiler/rustc_middle/src/query/calls.rs.
//
// PORT: the self-profiler is a disabled stand-in (driver-session handoff §9): `tcx.prof.query_cache_hit(..)`
// does nothing when profiling is off, so those calls are comments. No dep graph (D3): `read_index` on the
// disabled graph is a no-op but is still called, as upstream does.
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { DUMMY_SP, type Span } from "../../rustc_span/lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import { panic, unwrap } from "../../std/panic.ts";
import type { Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import type { TyCtxt } from "../ty/context.ts";
import { TyCtxtAt_create_def, type TyCtxtFeed } from "../ty/context.ts";
import type { DefKind } from "../../rustc_hir/def.ts";
import type { DefPathData, PerParentDisambiguatorState } from "../../rustc_hir_id/definitions.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import type { CacheEntry, QueryCache } from "./caches.ts";
import { into_query_key_LocalDefId, type IntoQueryKey } from "./into_query_key.ts";
import { QueryMode, type QueryVTable } from "./system.ts";

export class TyCtxtAt {
  constructor(
    public tcx: TyCtxt,
    public span: Span,
  ) {}

  /** PORT: `impl Deref for TyCtxtAt { type Target = TyCtxt }`: TS has no auto-deref; callers use `.deref()`
   * (or `.tcx`) for non-query `TyCtxt` methods. */
  // rustc: compiler/rustc_middle/src/query/calls.rs:24 deref
  deref(): TyCtxt {
    return this.tcx;
  }

  /** `TyCtxtAt::create_def` (context.rs:1302, ported in context.ts). */
  create_def(
    parent: LocalDefId,
    name: Symbol | undefined,
    def_kind: DefKind,
    override_def_path_data: DefPathData | undefined,
    disambiguator: PerParentDisambiguatorState,
  ): TyCtxtFeed<LocalDefId> {
    return TyCtxtAt_create_def(this, parent, name, def_kind, override_def_path_data, disambiguator);
  }
}

export class TyCtxtEnsureOk {
  constructor(public tcx: TyCtxt) {}

  // rustc: compiler/rustc_middle/src/query/calls.rs:48 typeck
  typeck(def_id: IntoQueryKey<LocalDefId>): void {
    return this.typeck_root(this.tcx.typeck_root_def_id(LocalDefId.to_def_id(into_query_key_LocalDefId(def_id))).expect_local());
  }
}

export class TyCtxtEnsureResult {
  constructor(public tcx: TyCtxt) {}
}

export class TyCtxtEnsureDone {
  constructor(public tcx: TyCtxt) {}
}


// rustc: compiler/rustc_middle/src/query/calls.rs:56 typeck
export function TyCtxt_typeck(tcx: TyCtxt, def_id: IntoQueryKey<LocalDefId>): unknown {
  return tcx.typeck_root(tcx.typeck_root_def_id(LocalDefId.to_def_id(into_query_key_LocalDefId(def_id))).expect_local());
}

/// Returns a transparent wrapper for `TyCtxt` which uses
/// `span` as the location of queries performed through it.
// rustc: compiler/rustc_middle/src/query/calls.rs:65 at
export function TyCtxt_at(tcx: TyCtxt, span: Span): TyCtxtAt {
  return new TyCtxtAt(tcx, span);
}

/// FIXME: `ensure_ok`'s effects are subtle. Is this comment fully accurate?
///
/// Wrapper that calls queries in a special "ensure OK" mode, for callers
/// that don't need the return value and just want to invoke a query for
/// its potential side-effect of emitting fatal errors.
///
/// This can be more efficient than a normal query call, because if the
/// query's inputs are all green, the call can return immediately without
/// needing to obtain a value (by decoding one from disk or by executing
/// the query).
///
/// (As with all query calls, execution is also skipped if the query result
/// is already cached in memory.)
///
/// ## WARNING
/// A subsequent normal call to the same query might still cause it to be
/// executed! This can occur when the inputs are all green, but the query's
/// result is not cached on disk, so the query must be executed to obtain a
/// return value.
///
/// Therefore, this call mode is not appropriate for callers that want to
/// ensure that the query is _never_ executed in the future.
// rustc: compiler/rustc_middle/src/query/calls.rs:92 ensure_ok
export function TyCtxt_ensure_ok(tcx: TyCtxt): TyCtxtEnsureOk {
  return new TyCtxtEnsureOk(tcx);
}

/// This is a variant of `ensure_ok` only usable with queries that return
/// `Result<_, ErrorGuaranteed>`. Queries calls through this function will
/// return `Result<(), ErrorGuaranteed>`. I.e. the error status is returned
/// but nothing else. As with `ensure_ok`, this can be more efficient than
/// a normal query call.
// rustc: compiler/rustc_middle/src/query/calls.rs:102 ensure_result
export function TyCtxt_ensure_result(tcx: TyCtxt): TyCtxtEnsureResult {
  return new TyCtxtEnsureResult(tcx);
}

/// Wrapper that calls queries where callers don't need the return value and
/// just want to guarantee that the query won't be executed in the future.
///
/// This is useful for queries that read from a [`Steal`] value, to ensure
/// that they are executed before the query that will steal the value.
///
/// Currently this causes the query to be executed normally, but this behavior may change.
///
/// [`Steal`]: rustc_data_structures::steal::Steal
// rustc: compiler/rustc_middle/src/query/calls.rs:116 ensure_done
export function TyCtxt_ensure_done(tcx: TyCtxt): TyCtxtEnsureDone {
  return new TyCtxtEnsureDone(tcx);
}

/// Checks whether there is already a value for this key in the in-memory
/// query cache, returning that value if present.
///
/// (Also performs some associated bookkeeping, if a value was found.)
// rustc: compiler/rustc_middle/src/query/calls.rs:126 try_get_cached
function try_get_cached<K, V>(tcx: TyCtxt, cache: QueryCache<K, V>, key: K): { _0: V } | undefined {
  const r: CacheEntry<V> | undefined = cache.lookup(key);
  if (r !== undefined) {
    const [value, index] = r;
    // tcx.prof.query_cache_hit(index.into());
    tcx.dep_graph.read_index(index);
    return { _0: value };
  } else {
    return undefined;
  }
}

/// Shared implementation of `tcx.$query(..)` and `tcx.at(span).$query(..)`
/// for all queries.
// rustc: compiler/rustc_middle/src/query/calls.rs:143 query_get_at
export function query_get_at<K, V>(tcx: TyCtxt, span: Span, query: QueryVTable<K, V>, key: K): V {
  const cached = try_get_cached(tcx, query.cache, key);
  if (cached !== undefined) {
    return cached._0;
  } else {
    return unwrap(query.execute_query_fn(tcx, span, key, QueryMode.Get))._0;
  }
}

/// Implementation of `tcx.ensure_ok().$query(..)` for all queries.
// rustc: compiler/rustc_middle/src/query/calls.rs:160 query_ensure_ok
export function query_ensure_ok<K, V>(tcx: TyCtxt, query: QueryVTable<K, V>, key: K): void {
  const cached = try_get_cached(tcx, query.cache, key);
  if (cached !== undefined) {
    // Some(_value) => {}
  } else {
    query.execute_query_fn(tcx, DUMMY_SP, key, QueryMode.EnsureOk);
  }
}

/// Implementation of `tcx.ensure_result().$query(..)` for queries that
/// return `Result<_, ErrorGuaranteed>`.
// rustc: compiler/rustc_middle/src/query/calls.rs:178 query_ensure_result
export function query_ensure_result<K, T>(tcx: TyCtxt, query: QueryVTable<K, Result<T, ErrorGuaranteed>>, key: K): Result<null, ErrorGuaranteed> {
  const convert = (value: Result<T, ErrorGuaranteed>): Result<null, ErrorGuaranteed> => {
    // erase::restore_val(value)
    if (value.$ === "Ok") {
      return Ok(null);
    } else {
      return Err(value._0);
    }
  };

  const cached = try_get_cached(tcx, query.cache, key);
  if (cached !== undefined) {
    return convert(cached._0);
  } else {
    const res = query.execute_query_fn(tcx, DUMMY_SP, key, QueryMode.EnsureOk);
    if (res !== undefined) {
      // We executed the query. Convert the successful result.
      return convert(res._0);
    } else {
      // Reaching here means we didn't execute the query, but we can just assume the
      // query succeeded, because it was green in the incremental cache. If it is green,
      // that means that the previous compilation that wrote to the incremental cache
      // compiles successfully. That is only possible if the cache entry was `Ok(())`, so
      // we emit that here, without actually encoding the `Result` in the cache or
      // loading it from there.
      return Ok(null);
    }
  }
}

/// "Feeds" a feedable query by adding a given key/value pair to its in-memory cache.
/// Called by macro-generated methods of [`rustc_middle::ty::TyCtxtFeed`].
// rustc: compiler/rustc_middle/src/query/calls.rs:215 query_feed
export function query_feed<K, V>(tcx: TyCtxt, query: QueryVTable<K, V>, key: K, value: V): void {
  const format_value = query.format_value;

  // Check whether the in-memory cache already has a value for this key.
  const cached = try_get_cached(tcx, query.cache, key);
  if (cached !== undefined) {
    const old = cached._0;
    // The query already has a cached value for this key.
    // That's OK if both values are the same, i.e. they have the same hash,
    // so now we check their hashes.
    const hash_value_fn = query.hash_value_fn;
    if (hash_value_fn !== undefined) {
      const [old_hash, value_hash] = tcx.with_stable_hashing_context((hcx): [Fingerprint, Fingerprint] => [hash_value_fn(hcx, old), hash_value_fn(hcx, value)]);
      if (old_hash !== value_hash) {
        // We have an inconsistency. This can happen if one of the two
        // results is tainted by errors. In this case, delay a bug to
        // ensure compilation is doomed, and keep the `old` value.
        tcx.dcx().delayed_bug(
          `Trying to feed an already recorded value for query ${query.name} key=${query.key_impl.debug(key, PLAIN)}:\n` +
            `old value: ${format_value(old)}\nnew value: ${format_value(value)}`,
        );
      }
    } else {
      // The query is `no_hash`, so we have no way to perform a sanity check.
      // If feeding the same value multiple times needs to be supported,
      // the query should not be marked `no_hash`.
      panic(
        `Trying to feed an already recorded value for query ${query.name} key=${query.key_impl.debug(key, PLAIN)}:\n` +
          `old value: ${format_value(old)}\nnew value: ${format_value(value)}`,
      );
    }
  } else {
    // There is no cached value for this key, so feed the query by
    // adding the provided value to the cache.
    // PORT: no dep graph (D3): `DepNode::construct(tcx, query.dep_kind, &key)` fingerprints the key with the
    // stable hasher; the disabled graph's `with_feed_task` ignores the node, so it is not built.
    const dep_node = undefined;
    const dep_node_index = tcx.dep_graph.with_feed_task(dep_node, tcx, value, query.hash_value_fn, query.format_value);
    query.cache.complete(key, value, dep_node_index);
  }
}
