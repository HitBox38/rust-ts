// Port of compiler/rustc_middle/src/query/system.rs.
//
// PORT: no dep graph (D3): `QueryVTable` has no `dep_kind` (dep kinds are the query names) and its
// `try_load_from_disk_fn` / `hash_value_fn` are kept only as the shape the engine branches on;
// `QuerySystem` has no `arenas` (arena allocation is erased, PORTING §5), no `dep_kind_vtables`, no
// `side_effects` and no `on_disk_cache` (incremental only). Erased values are the values themselves
// (`Erased<V>` = `V`, see erase.ts). The `C: QueryCache` type parameter becomes the key/value types plus
// the key's `QueryKey` impl (`key_impl`), which the generic engine code needs at run time.
import type { Diag } from "../../rustc_errors/lib.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import type { Fmt } from "../../std/fmt.ts";
import type { DepNodeIndex } from "../dep_graph/graph.ts";
import type { ExternProviders, Providers, QueryName, QueryTypes, TaggedQueryKey } from "../queries.gen.ts";
import type { TyCtxt } from "../ty/context.ts";
import type { QueryCache } from "./caches.ts";
import type { QueryCycle, QueryState } from "./job.ts";
import type { QueryKey } from "./keys.ts";

export type QueryMode =
  /// This is a normal query call to `tcx.$query(..)` or `tcx.at(span).$query(..)`.
  | "Get"
  /// This is a call to `tcx.ensure_ok().$query(..)`.
  | "EnsureOk";
export const QueryMode = { Get: "Get", EnsureOk: "EnsureOk" } as const;
export const debug_QueryMode = (v: QueryMode, _f: Fmt): string => v;

/** PORT: `fn(&mut StableHashState<'_>, &C::Value) -> Fingerprint`; stable hashing of query values is not
 * ported (no `StableHash` impls of query values yet; D3): only its presence (`no_hash` or not) is used. */
export type HashValueFn<V> = (value: V) => never;

/// Stores data and metadata (e.g. function pointers) for a particular query.
export class QueryVTable<K, V> {
  constructor(
    public name: QueryName,

    /// True if this query has the `eval_always` modifier.
    public eval_always: boolean,
    /// True if this query has the `depth_limit` modifier.
    public depth_limit: boolean,
    /// True if this query has the `feedable` modifier.
    public feedable: boolean,

    public cache_on_disk_local: boolean,
    public separate_provide_extern: boolean,

    /** PORT: the `QueryKey` impl of `C::Key` (trait dictionary of the generic upstream code). */
    public key_impl: QueryKey<K, unknown>,
    public state: QueryState<K>,
    public cache: QueryCache<K, V>,

    /// Function pointer that actually calls this query's provider.
    /// Also performs some associated secondary tasks; see the macro-defined
    /// implementation in `mod invoke_provider_fn` for more details.
    ///
    /// This should be the only code that calls the provider function.
    public invoke_provider_fn: (tcx: TyCtxt, key: K) => V,

    /// Function pointer that tries to load a query value from disk.
    ///
    /// This should only be called after a successful check of [`Self::will_cache_on_disk_for_key`].
    public try_load_from_disk_fn: (tcx: TyCtxt, prev_index: number) => { _0: V } | undefined,

    /// Function pointer that hashes this query's result values.
    ///
    /// For `no_hash` queries, this function pointer is None.
    public hash_value_fn: HashValueFn<V> | undefined,

    /// Function pointer that handles a cycle error. `error` must be consumed, e.g. with `emit` (if
    /// it should be emitted) or `delay_as_bug` (if it need not be emitted because an alternative
    /// error is created and emitted). A value may be returned, or (more commonly) the function may
    /// just abort after emitting the error.
    public handle_cycle_error_fn: (tcx: TyCtxt, key: K, cycle: QueryCycle, error: Diag) => V,

    public format_value: (value: V) => string,

    public create_tagged_key: (key: K) => TaggedQueryKey,

    /// Function pointer that is called by the query methods on [`TyCtxt`] and
    /// friends[^1], after they have checked the in-memory cache and found no
    /// existing value for this key.
    ///
    /// Transitive responsibilities include trying to load a disk-cached value
    /// if possible (incremental only), invoking the query provider if necessary,
    /// and putting the obtained value into the in-memory cache.
    ///
    /// [^1]: [`TyCtxt`], [`crate::query::TyCtxtAt`], [`crate::query::TyCtxtEnsureOk`],
    /// [`crate::query::TyCtxtEnsureDone`]
    /** PORT: `Option<C::Value>` as `{ _0: V } | undefined` (`V` may itself be `undefined`). */
    public execute_query_fn: (tcx: TyCtxt, span: Span, key: K, mode: QueryMode) => { _0: V } | undefined,
  ) {}

  // rustc: compiler/rustc_middle/src/query/system.rs:87 will_cache_on_disk_for_key
  will_cache_on_disk_for_key(key: K): boolean {
    return this.cache_on_disk_local && (!this.separate_provide_extern || this.key_impl.as_local_key(key) !== undefined);
  }
}

// rustc: compiler/rustc_middle/src/query/system.rs:93 fmt
export function debug_QueryVTable<K, V>(v: QueryVTable<K, V>, _f: Fmt): string {
  // When debug-printing a query vtable (e.g. for ICE or tracing),
  // just print the query name to know what query we're dealing with.
  // The other fields and flags are probably just unhelpful noise.
  //
  // If there is need for a more detailed dump of all flags and fields,
  // consider writing a separate dump method and calling it explicitly.
  return v.name;
}

/// Holds a `QueryVTable` for each query.
export type QueryVTables = { [N in QueryName]: QueryVTable<QueryTypes[N]["Key"], QueryTypes[N]["Value"]> };

export class QuerySystem {
  constructor(
    public query_vtables: QueryVTables,

    /// Enabled features that are used in the current compilation.
    ///
    /// The value is the `DepNodeIndex` of the node that encodes the used feature.
    public used_features: Map<Symbol, DepNodeIndex>,

    public local_providers: Providers,
    public extern_providers: ExternProviders,

    public jobs: number,

    public cycle_handler_nesting: number,
  ) {}
}
