// Port of compiler/rustc_middle/src/query/job.rs.
//
// PORT: single-threaded (PORTING §5): `Sharded<HashTable<..>>` is one `Map` keyed by the key's
// `hash_key` (query/keys.ts); `QueryLatch`/`QueryWaiter` only exist for the parallel front-end
// (`sync::is_dyn_thread_safe()`), which rust-ts does not run, so a job's `latch` is always `None`.
import type { Span } from "../../rustc_span/lib.ts";
import { type Debug, debug_int, debug_option, debug_struct, debug_tuple, debug_vec } from "../../std/fmt.ts";
import type { TaggedQueryKey } from "../queries.gen.ts";

/// A value uniquely identifying an active query job.
// `pub struct QueryJobId(pub NonZero<u64>)`; PORT: the counter stays far below 2^53.
export type QueryJobId = number & { readonly __brand: "QueryJobId" };
export const debug_QueryJobId: Debug<QueryJobId> = (v, f) => debug_tuple(f, "QueryJobId", [debug_int(v, f)]);

/// Represents an active query job.
export class QueryJob {
  constructor(
    public id: QueryJobId,
    /// The span corresponding to the reason for which this query was required.
    public span: Span,
    /// The parent query job which created this job and is implicitly waiting on it.
    public parent: QueryJobId | undefined,
    /// The latch that is used to wait on this job.
    public latch: QueryLatch | undefined,
  ) {}

  /// Creates a new query job.
  // rustc: compiler/rustc_middle/src/query/job.rs:35 new
  static new(id: QueryJobId, span: Span, parent: QueryJobId | undefined): QueryJob {
    return new QueryJob(id, span, parent, undefined);
  }
}

/** `#[derive(Clone)]` */
export function clone_QueryJob(v: QueryJob): QueryJob {
  return new QueryJob(v.id, v.span, v.parent, v.latch);
}

/// For a particular query and key, tracks the status of a query evaluation
/// that has started, but has not yet finished successfully.
///
/// (Successful query evaluation for a key is represented by an entry in the
/// query's in-memory cache.)
export type ActiveKeyStatus =
  /// Some thread is already evaluating the query for this key.
  ///
  /// The enclosed [`QueryJob`] can be used to wait for it to finish.
  | { readonly $: "Started"; _0: QueryJob }
  /// The query panicked. Queries trying to wait on this will raise a fatal error which will
  /// silently panic.
  | { readonly $: "Poisoned" };

/// For a particular query, keeps track of "active" keys, i.e. keys whose
/// evaluation has started but has not yet finished successfully.
///
/// (Successful query evaluation for a key is represented by an entry in the
/// query's in-memory cache.)
export class QueryState<K> {
  /** PORT: `Sharded<HashTable<(K, ActiveKeyStatus)>>`, keyed by the key's `hash_key`. */
  constructor(public active: Map<string | number | bigint, [K, ActiveKeyStatus]>) {}

  // rustc: compiler/rustc_middle/src/query/job.rs:66 default
  static default<K>(): QueryState<K> {
    return new QueryState<K>(new Map());
  }
}

/// Description of a frame in the query stack.
///
/// This is mostly used in case of cycles for error reporting.
export interface QueryStackFrame {
  span: Span;

  /// The query and key of the query method call that this stack frame
  /// corresponds to.
  ///
  /// Code that doesn't care about the specific key can still use this to
  /// check which query it's for, or obtain the query's name.
  tagged_key: TaggedQueryKey;
}

export interface QueryCycle {
  /// The query and related span that uses the cycle.
  usage: QueryStackFrame | undefined;

  /// The span here corresponds to the reason for which this query was required.
  frames: QueryStackFrame[];
}

/**
 * `#[derive(Debug)]` of `QueryStackFrame` / `QueryCycle`; `debug_tagged_key` is the Debug of
 * `TaggedQueryKey` (query_api.ts) and `debug_span` the one of `Span`, passed in to keep this module
 * free of value imports.
 */
export function debug_QueryCycle(v: QueryCycle, f: Parameters<Debug<QueryCycle>>[1], debug_span: Debug<Span>, debug_tagged_key: Debug<TaggedQueryKey>): string {
  const frame: Debug<QueryStackFrame> = (fr, f) =>
    debug_struct(f, "QueryStackFrame", [
      ["span", debug_span(fr.span, f)],
      ["tagged_key", debug_tagged_key(fr.tagged_key, f)],
    ]);
  return debug_struct(f, "QueryCycle", [
    ["usage", debug_option(v.usage, f, frame)],
    ["frames", debug_vec(v.frames, f, frame)],
  ]);
}

/**
 * PORT: `QueryWaiter` / `QueryLatch` (job.rs:96/104) belong to the parallel front-end (see the module
 * comment); they are ported for completeness and never created by the single-threaded engine.
 */
export interface QueryWaiter {
  parent: QueryJobId | undefined;
  span: Span;
  cycle: QueryCycle | undefined;
}
export interface QueryLatch {
  /// The `Option` is `Some(..)` when the job is active, and `None` once completed.
  waiters: QueryWaiter[] | undefined;
}
export const QueryLatch = {
  // rustc: compiler/rustc_middle/src/query/job.rs:110 new
  new(): QueryLatch {
    return { waiters: [] };
  },
};
