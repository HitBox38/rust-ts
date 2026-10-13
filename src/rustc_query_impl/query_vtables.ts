// Port of compiler/rustc_query_impl/src/query_vtables.rs: the expansion of
// `rustc_with_all_queries! { define_queries! }`.
//
// PORT: the per-query modules the macro writes out are one generic `make_query_vtable` over the generated
// `QUERY_DECLS` (rustc_middle/queries.gen.ts). Erased values are the values (erase.rs). No dep graph (D3):
// `dep_kind` is the query name, `try_load_from_disk_fn` has no on-disk cache to read, and `hash_value_fn`
// (stable hashing of query values: no `StableHash` impls for query values yet) is kept only as present /
// absent (`no_hash`); calling it is unported.
import { QUERY_DECLS, QUERY_NAMES, type QueryName } from "../rustc_middle/queries.gen.ts";
import { provided_to_erased, type QueryDecl } from "../rustc_middle/query/query_api.ts";
import { QueryState } from "../rustc_middle/query/job.ts";
import { type QueryMode, QueryVTable, type QueryVTables } from "../rustc_middle/query/system.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Span } from "../rustc_span/lib.ts";
import { PLAIN } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import { execute_query_incr_inner, execute_query_non_incr_inner } from "./execution.ts";
import * as handle_cycle_error from "./handle_cycle_error.ts";

/// Trait that knows how to look up the [`QueryVTable`] for a particular query.
///
/// This trait allows some per-query code to be defined in generic functions
/// with a trait bound, instead of having to be defined inline within a macro
/// expansion.
///
/// There is one macro-generated implementation of this trait for each query,
/// on the type `rustc_query_impl::query_vtables::$name::VTableGetter`.
// rustc: compiler/rustc_query_impl/src/query_vtables.rs:18 query_vtable
// rustc: compiler/rustc_query_impl/src/query_vtables.rs:214 query_vtable
export function query_vtable<N extends QueryName>(tcx: TyCtxt, name: N): QueryVTables[N] {
  return tcx.query_system.query_vtables[name];
}

// rustc: compiler/rustc_query_impl/src/query_vtables.rs:65 __rust_end_short_backtrace
function execute_query_incr<K, V>(name: QueryName): (tcx: TyCtxt, span: Span, key: K, mode: QueryMode) => { _0: V } | undefined {
  return (tcx, span, key, mode) => execute_query_incr_inner(tcx.query_system.query_vtables[name] as unknown as QueryVTable<K, V>, tcx, span, key, mode);
}

// rustc: compiler/rustc_query_impl/src/query_vtables.rs:88 __rust_end_short_backtrace
function execute_query_non_incr<K, V>(name: QueryName): (tcx: TyCtxt, span: Span, key: K, mode: QueryMode) => { _0: V } | undefined {
  return (tcx, span, key, _mode) => ({ _0: execute_query_non_incr_inner(tcx.query_system.query_vtables[name] as unknown as QueryVTable<K, V>, tcx, span, key) });
}

/// Defines an `invoke_provider` function that calls the query's provider,
/// to be used as a function pointer in the query's vtable.
///
/// To mark a short-backtrace boundary, the function's actual name
/// (after demangling) must be `__rust_begin_short_backtrace`.
// rustc: compiler/rustc_query_impl/src/query_vtables.rs:113 __rust_begin_short_backtrace
function invoke_provider_fn<K, V>(decl: QueryDecl<K, V>): (tcx: TyCtxt, key: K) => V {
  const name = decl.name;
  return (tcx, key) => {
    // Call the actual provider function for this query.
    const local = tcx.query_system.local_providers as unknown as Record<string, (tcx: TyCtxt, key: unknown) => V>;
    let provided_value: V;
    if (decl.separate_provide_extern) {
      const local_key = decl.key.as_local_key(key);
      if (local_key !== undefined) {
        provided_value = local[name]!(tcx, local_key);
      } else {
        provided_value = (tcx.query_system.extern_providers as unknown as Record<string, (tcx: TyCtxt, key: K) => V>)[name]!(tcx, key);
      }
    } else {
      provided_value = local[name]!(tcx, key);
    }

    // Erase the returned value, because `QueryVTable` uses erased values.
    // For queries with `arena_cache`, this also arena-allocates the value.
    return provided_to_erased(tcx, provided_value);
  };
}

// rustc: compiler/rustc_query_impl/src/query_vtables.rs:142 make_query_vtable
export function make_query_vtable<K, V>(decl: QueryDecl<K, V>, incremental: boolean, track_present: boolean): QueryVTable<K, V> {
  const name = decl.name;
  const custom = handle_cycle_error.CUSTOM[name];
  return new QueryVTable<K, V>(
    name,
    decl.eval_always,
    decl.depth_limit,
    decl.feedable,
    decl.cache_on_disk,
    decl.separate_provide_extern,
    decl.key,
    QueryState.default(),
    decl.key.make_cache<V>(track_present),
    invoke_provider_fn(decl),
    decl.cache_on_disk ? () => unported(`rustc_query_impl::incremental::try_load_from_disk (query \`${name}\`; D3)`) : (_tcx, _prev_index) => undefined,
    decl.no_hash ? undefined : (_value: V) => unported(`rustc_middle::dep_graph::hash_result (stable hashing of the values of query \`${name}\`)`),
    decl.handle_cycle_error
      ? (tcx, key, cycle, err) => {
          if (custom === undefined) return unported(`rustc_query_impl::handle_cycle_error::${name}`);
          return custom(tcx, key, cycle, err) as V;
        }
      : (_tcx, _key, _cycle, err) => handle_cycle_error.default_(err),
    (value: V) => (decl.debug_value !== undefined ? decl.debug_value(value, PLAIN) : unported(`Debug of the values of query \`${name}\``)),
    (key: K) => ({ $: name, _0: key }) as never,
    incremental ? execute_query_incr<K, V>(name) : execute_query_non_incr<K, V>(name),
  );
}

// rustc: compiler/rustc_query_impl/src/query_vtables.rs:221 make_query_vtables
export function make_query_vtables(incremental: boolean, track_present: boolean): QueryVTables {
  const out: Record<string, unknown> = {};
  for (const name of QUERY_NAMES) {
    out[name] = make_query_vtable(QUERY_DECLS[name] as unknown as QueryDecl<unknown, unknown>, incremental, track_present);
  }
  return out as QueryVTables;
}

/// Given a filter condition (e.g. `ALL` or `CACHE_ON_DISK`), a `tcx`,
/// and a closure expression that accepts `&QueryVTable`, this macro
/// calls that closure with each query vtable that satisfies the filter
/// condition.
/** `for_each_query_vtable!(ALL, tcx, closure)` */
export function for_each_query_vtable(tcx: TyCtxt, closure: (query: QueryVTable<unknown, unknown>) => void): void {
  for (const name of QUERY_NAMES) {
    closure(tcx.query_system.query_vtables[name] as unknown as QueryVTable<unknown, unknown>);
  }
}
