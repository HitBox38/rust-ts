// Port of compiler/rustc_query_impl/src/execution.rs.
//
// PORT: no dep graph (D3) and single-threaded (PORTING §5):
// - only the non-incremental path runs (`execute_query_non_incr_inner`); the incremental functions
//   (`execute_job_incr`, `load_from_disk_or_invoke_provider_green`, `ensure_can_skip_execution`,
//   `execute_query_incr_inner`, `force_query_dep_node`) call `unported`;
// - `sync::is_dyn_thread_safe()` is false, so an already-started key is a cycle (`find_and_handle_cycle`)
//   and the latch / waiting functions (`latch_wait_on`, `wait_for_query`) are never reached;
// - Rust's unwinding drop of `ActiveJobGuard` (poisoning the key) is a `catch` that poisons and rethrows;
// - the self-profiler is a disabled stand-in, so its timers are comments.
import { Limit, Limit_mul } from "../rustc_structures/lib.ts";
import type { Diag } from "../rustc_errors/lib.ts";
import { FatalError } from "../rustc_span/fatal_error.ts";
import { LOCAL_CRATE } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { CacheEntry, QueryCache } from "../rustc_middle/query/caches.ts";
import { type QueryCycle, QueryJob, type QueryJobId, type QueryLatch, type QueryState } from "../rustc_middle/query/job.ts";
import type { QueryMode, QueryVTable } from "../rustc_middle/query/system.ts";
import type { DepNodeIndex } from "../rustc_middle/dep_graph/graph.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { enter_context, ImplicitCtxt, with_context } from "../rustc_middle/ty/context/tls.ts";
import { assert, panic, unported } from "../std/panic.ts";
import { debug_str, PLAIN } from "../std/fmt.ts";
import type { Fingerprint } from "../rustc_data_structures/fingerprint.ts";
import { QueryOverflow_diagnostic } from "./diagnostics.ts";
import * as handle_cycle_error from "./handle_cycle_error.ts";
import { collect_active_query_jobs, find_cycle_in_stack, find_dep_kind_root } from "./job.ts";

type HashKey = string | number | bigint;

// rustc: compiler/rustc_query_impl/src/execution.rs:32 equivalent_key
function equivalent_key<K>(k: HashKey): (x: [K, unknown] | undefined) => boolean {
  // PORT: entries are keyed by `hash_key` (rustc_middle/query/job.rs), so the equality test is the lookup.
  void k;
  return (x) => x !== undefined;
}

// rustc: compiler/rustc_query_impl/src/execution.rs:38 handle_cycle
function handle_cycle<K, V>(query: QueryVTable<K, V>, tcx: TyCtxt, key: K, cycle: QueryCycle): V {
  let nested: boolean;
  {
    const nesting = tcx.query_system.cycle_handler_nesting;
    switch (nesting) {
      case 0:
        nested = false;
        break;
      case 1:
        nested = true;
        break;
      default:
        // Don't print further nested errors to avoid cases of infinite recursion
        return tcx.dcx().delayed_bug("doubly nested cycle error").raise_fatal();
    }
    tcx.query_system.cycle_handler_nesting = nesting + 1;
  }
  // let _guard = defer(|| *tcx.query_system.cycle_handler_nesting.lock() -= 1);
  try {
    const error: Diag = handle_cycle_error.create_cycle_error(tcx, cycle, nested);

    if (nested) {
      // Avoid custom handlers and only use the robust `create_cycle_error` for nested cycle errors
      return handle_cycle_error.default_(error);
    } else {
      return query.handle_cycle_error_fn(tcx, key, cycle, error);
    }
  } finally {
    tcx.query_system.cycle_handler_nesting -= 1;
  }
}

/// Signals to waiters that the query is complete.
///
/// This does nothing for single threaded rustc, as there are no concurrent jobs which could be
/// waiting on us.
// rustc: compiler/rustc_query_impl/src/execution.rs:74 signal_complete
function signal_complete(job: QueryJob): void {
  const latch: QueryLatch | undefined = job.latch;
  if (latch !== undefined) {
    // Set the latch and resume all waiters on it.
    unported("rustc_query_impl::execution::signal_complete with waiters (parallel front-end)");
  }
}

/// Guard object representing the responsibility to execute a query job and
/// mark it as completed.
///
/// This will poison the relevant query key if it is dropped without calling
/// [`Self::complete`].
class ActiveJobGuard<K> {
  constructor(
    readonly state: QueryState<K>,
    readonly key: K,
    readonly key_hash: HashKey,
  ) {}

  /// Completes the query by updating the query cache with the `result`,
  /// signals the waiter, and forgets the guard so it won't poison the query.
  // rustc: compiler/rustc_query_impl/src/execution.rs:107 complete
  complete<V>(cache: QueryCache<K, V>, value: V, dep_node_index: DepNodeIndex): void {
    // Mark as complete before we remove the job from the active state
    // so no other thread can re-execute this query.
    cache.complete(this.key, value, dep_node_index);

    // Drop everything without poisoning the query.
    this.drop_and_maybe_poison(/* poison */ false);
  }

  // rustc: compiler/rustc_query_impl/src/execution.rs:121 drop_and_maybe_poison
  drop_and_maybe_poison(poison: boolean): void {
    let status;
    {
      const shard = this.state.active;
      const occupied = shard.get(this.key_hash);
      if (!equivalent_key<K>(this.key_hash)(occupied)) {
        // Note: we must not panic while holding the lock, because unwinding also looks
        // at this map, which can result in a double panic. So drop it first.
        panic("explicit panic");
      }
      shard.delete(this.key_hash);
      const [key, s] = occupied!;
      if (poison) {
        shard.set(this.key_hash, [key, { $: "Poisoned" }]);
      }
      status = s;
    }

    // Also signal the completion of the job, so waiters will continue execution.
    switch (status.$) {
      case "Started":
        signal_complete(status._0);
        break;
      case "Poisoned":
        panic("explicit panic");
    }
  }

  // rustc: compiler/rustc_query_impl/src/execution.rs:155 drop
  drop(): void {
    // Poison the query so jobs waiting on it panic.
    this.drop_and_maybe_poison(/* poison */ true);
  }
}

// rustc: compiler/rustc_query_impl/src/execution.rs:163 find_and_handle_cycle
function find_and_handle_cycle<K, V>(query: QueryVTable<K, V>, tcx: TyCtxt, key: K, try_execute: QueryJobId, span: Span): [V, DepNodeIndex | undefined] {
  // Ensure there were no errors collecting all active jobs.
  // We need the complete map to ensure we find a cycle to break.
  const job_map = collect_active_query_jobs(tcx, "FullNoContention");

  const cycle = find_cycle_in_stack(try_execute, job_map, current_query_job(), span);
  return [handle_cycle(query, tcx, key, cycle), undefined];
}

// rustc: compiler/rustc_query_impl/src/execution.rs:265 next_job_id
function next_job_id(tcx: TyCtxt): QueryJobId {
  // `NonZero::new(jobs.fetch_add(1)).unwrap()`: starts at 1.
  const id = tcx.query_system.jobs;
  tcx.query_system.jobs += 1;
  if (id === 0) panic("called `Option::unwrap()` on a `None` value");
  return id as QueryJobId;
}

// rustc: compiler/rustc_query_impl/src/execution.rs:273 current_query_job
function current_query_job(): QueryJobId | undefined {
  return with_context((icx) => icx.query);
}

/// Shared main part of both [`execute_query_incr_inner`] and [`execute_query_non_incr_inner`].
// rustc: compiler/rustc_query_impl/src/execution.rs:279 try_execute_query
function try_execute_query<K, V>(query: QueryVTable<K, V>, tcx: TyCtxt, span: Span, key: K, incr: boolean): [V, DepNodeIndex | undefined] {
  const key_hash = query.key_impl.hash_key(key);
  const state_lock = query.state.active;

  // For the parallel compiler we need to check both the query cache and query state structures
  // while holding the state lock to ensure that 1) the query has not yet completed and 2) the
  // query is not still executing. Without checking the query cache here, we can end up
  // re-executing the query since `try_start` only checks that the query is not currently
  // executing, but another thread may have already completed the query and stores it result
  // in the query cache.
  if (tcx.sess.opts.jobs.frontend !== undefined) {
    const hit: CacheEntry<V> | undefined = query.cache.lookup(key);
    if (hit !== undefined) {
      // tcx.prof.query_cache_hit(index.into());
      return [hit[0], hit[1]];
    }
  }

  const current_job_id = current_query_job();

  const entry = state_lock.get(key_hash);
  if (entry === undefined) {
    // Nothing has computed or is computing the query, so we start a new job and insert it
    // in the state map.
    const id = next_job_id(tcx);
    const job = QueryJob.new(id, span, current_job_id);
    state_lock.set(key_hash, [key, { $: "Started", _0: job }]);

    // Drop the lock before we start executing the query.

    // Set up a guard object that will automatically poison the query if a
    // panic occurs while executing the query (or any intermediate plumbing).
    const job_guard = new ActiveJobGuard(query.state, key, key_hash);

    let value: V;
    let dep_node_index: DepNodeIndex;
    try {
      // Delegate to another function to actually execute the query job.
      if (incr) {
        [value, dep_node_index] = execute_job_incr(query, tcx, key, id);
      } else {
        [value, dep_node_index] = execute_job_non_incr(query, tcx, key, id);
      }

      if (query.feedable) {
        check_feedable_consistency(tcx, query, key, value);
      }
    } catch (e) {
      // `impl Drop for ActiveJobGuard` while unwinding.
      job_guard.drop();
      throw e;
    }

    // Tell the guard to insert `value` in the cache and remove the status entry from
    // `query.state`.
    job_guard.complete(query.cache, value, dep_node_index);

    return [value, dep_node_index];
  } else {
    const status = entry[1];
    switch (status.$) {
      case "Started": {
        const job = status._0;
        // `sync::is_dyn_thread_safe()`: false (single-threaded), so no `wait_for_query`.
        const id = job.id;

        // If we are single-threaded we know that we have cycle error,
        // so we just return the error.
        return find_and_handle_cycle(query, tcx, key, id, span);
      }
      case "Poisoned":
        return new FatalError().raise();
    }
  }
}

// rustc: compiler/rustc_query_impl/src/execution.rs:363 check_feedable_consistency
function check_feedable_consistency<K, V>(tcx: TyCtxt, query: QueryVTable<K, V>, key: K, value: V): void {
  // We should not compute queries that also got a value via feeding.
  // This can't happen, as query feeding adds the very dependencies to the fed query
  // as its feeding query had. So if the fed query is red, so is its feeder, which will
  // get evaluated first, and re-feed the query.
  const cached = query.cache.lookup(key);
  if (cached === undefined) return;
  const cached_value = cached[0];

  const hash_value_fn = query.hash_value_fn;
  if (hash_value_fn === undefined) {
    panic(
      "no_hash fed query later has its value computed.\n" +
        "Remove `no_hash` modifier to allow recomputation.\n" +
        `The already cached value: ${query.format_value(cached_value)}`,
    );
  }

  const [old_hash, new_hash] = tcx.with_stable_hashing_context((hcx): [Fingerprint, Fingerprint] => [hash_value_fn(hcx, cached_value), hash_value_fn(hcx, value)]);
  const formatter = query.format_value;
  if (old_hash !== new_hash) {
    // We have an inconsistency. This can happen if one of the two
    // results is tainted by errors.
    // PORT: `query.dep_kind` is the query name (no dep graph, D3); `{:#?}` of the formatted `String`s.
    assert(
      tcx.dcx().has_errors() !== undefined,
      () => `Computed query value for ${query.name}(${query.key_impl.debug(key, PLAIN)}) is inconsistent with fed value,\n` +
        `computed=${debug_str(formatter(value))}\nfed=${debug_str(formatter(cached_value))}`,
    );
  }
}

// rustc: compiler/rustc_query_impl/src/execution.rs:403 depth_limit_error
function depth_limit_error(tcx: TyCtxt, job: QueryJobId): void {
  const job_map = collect_active_query_jobs(tcx, "Full");
  const [span, desc, depth] = find_dep_kind_root(tcx, job, job_map);

  const limit = tcx.recursion_limit();
  const suggested_limit = limit._0 === 0 ? new Limit(2) : Limit_mul(limit, 2);

  tcx.dcx().emit_fatal(
    QueryOverflow_diagnostic({
      span,
      note: { desc, depth },
      suggested_limit,
      crate_name: tcx.crate_name(LOCAL_CRATE),
    }),
  );
}

/// Executes a job by changing the `ImplicitCtxt` to point to the new query job while it executes.
// rustc: compiler/rustc_query_impl/src/execution.rs:422 start_query
function start_query<R>(job_id: QueryJobId, depth_limit: boolean, compute: () => R): R {
  return with_context((icx) => {
    if (depth_limit && !icx.tcx.recursion_limit().value_within_limit(icx.query_depth)) {
      depth_limit_error(icx.tcx, job_id);
    }

    // Update the `ImplicitCtxt` to point to our new query job.
    const new_icx = new ImplicitCtxt(icx.tcx, job_id, icx.query_depth + (depth_limit ? 1 : 0));

    // Use the `ImplicitCtxt` while we execute the query.
    return enter_context(new_icx, compute);
  });
}

// Fast path for when incr. comp. is off.
// rustc: compiler/rustc_query_impl/src/execution.rs:442 execute_job_non_incr
function execute_job_non_incr<K, V>(query: QueryVTable<K, V>, tcx: TyCtxt, key: K, job_id: QueryJobId): [V, DepNodeIndex] {
  // debug_assert!(!tcx.dep_graph.is_fully_enabled());

  // let prof_timer = tcx.prof.query_provider();
  // Call the query provider.
  const value = start_query(job_id, query.depth_limit, () => query.invoke_provider_fn(tcx, key));
  const dep_node_index = tcx.dep_graph.next_virtual_depnode_index();
  // prof_timer.finish_with_query_invocation_id(dep_node_index.into());

  // Sanity: Fingerprint the key and the result to assert they don't contain anything unhashable.
  // `if cfg!(debug_assertions) { .. }`: rustc ships without debug assertions.

  return [value, dep_node_index];
}

function execute_job_incr<K, V>(_query: QueryVTable<K, V>, _tcx: TyCtxt, _key: K, _job_id: QueryJobId): [V, DepNodeIndex] {
  return unported("rustc_query_impl::execution::execute_job_incr (incremental; D3)");
}

/// Called by a macro-generated impl of [`QueryVTable::execute_query_fn`],
/// in non-incremental mode.
// rustc: compiler/rustc_query_impl/src/execution.rs:631 execute_query_non_incr_inner
export function execute_query_non_incr_inner<K, V>(query: QueryVTable<K, V>, tcx: TyCtxt, span: Span, key: K): V {
  return try_execute_query(query, tcx, span, key, false)[0];
}

/// Called by a macro-generated impl of [`QueryVTable::execute_query_fn`],
/// in incremental mode.
export function execute_query_incr_inner<K, V>(_query: QueryVTable<K, V>, _tcx: TyCtxt, _span: Span, _key: K, _mode: QueryMode): { _0: V } | undefined {
  return unported("rustc_query_impl::execution::execute_query_incr_inner (incremental; D3)");
}
