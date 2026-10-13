// Port of compiler/rustc_query_impl/src/job.rs.
//
// PORT: single-threaded (PORTING §5). The cycle search over *waiters* (`abstracted_waiters_of`,
// `find_cycle`, `connected_to_root`, `process_cycle`, `find_and_process_cycle`, `break_query_cycle`)
// is the parallel front-end's deadlock handler and is not ported: single-threaded rustc finds cycles
// on the query stack (`find_cycle_in_stack`), which is ported. Shard locks never contend, so the three
// `CollectActiveJobsKind`s collect the same map.
import { writeSync } from "node:fs";
import type { TaggedQueryKey } from "../rustc_middle/queries.gen.ts";
import { TaggedQueryKey as TaggedQueryKeyC } from "../rustc_middle/query/query_api.ts";
import { clone_QueryJob, type QueryCycle, type QueryJob, type QueryJobId, type QueryLatch, type QueryStackFrame } from "../rustc_middle/query/job.ts";
import type { QueryVTable } from "../rustc_middle/query/system.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Span } from "../rustc_span/lib.ts";
import { panic } from "../std/panic.ts";
import { utf8 as utf8_bytes } from "../std/str.ts";
import { for_each_query_vtable } from "./query_vtables.ts";

/// Map from query job IDs to job information collected by
/// `collect_active_query_jobs`.
export class QueryJobMap {
  constructor(readonly map: Map<QueryJobId, QueryJobInfo>) {}

  static default(): QueryJobMap {
    return new QueryJobMap(new Map());
  }

  /// Adds information about a job ID to the job map.
  ///
  /// Should only be called by `collect_active_query_jobs_inner`.
  // rustc: compiler/rustc_query_impl/src/job.rs:31 insert
  insert(id: QueryJobId, info: QueryJobInfo): void {
    this.map.set(id, info);
  }

  // rustc: compiler/rustc_query_impl/src/job.rs:35 tagged_key_of
  tagged_key_of(id: QueryJobId): TaggedQueryKey {
    return this.get(id).tagged_key;
  }

  // rustc: compiler/rustc_query_impl/src/job.rs:39 span_of
  span_of(id: QueryJobId): Span {
    return this.get(id).job.span;
  }

  // rustc: compiler/rustc_query_impl/src/job.rs:43 parent_of
  parent_of(id: QueryJobId): QueryJobId | undefined {
    return this.get(id).job.parent;
  }

  // rustc: compiler/rustc_query_impl/src/job.rs:47 latch_of
  latch_of(id: QueryJobId): QueryLatch | undefined {
    return this.get(id).job.latch;
  }

  /** `self.map[&id]` (panics on a missing key, like `HashMap`'s `Index`) */
  get(id: QueryJobId): QueryJobInfo {
    const info = this.map.get(id);
    if (info === undefined) panic("key not found in HashMap");
    return info;
  }
}

export interface QueryJobInfo {
  tagged_key: TaggedQueryKey;
  job: QueryJob;
}

export type CollectActiveJobsKind =
  /// We need the full query job map, and we are willing to wait to obtain the query state
  /// shard lock(s).
  | "Full"
  /// We need the full query job map, and we shouldn't need to wait to obtain the shard lock(s),
  /// because we are in a place where nothing else could hold the shard lock(s).
  | "FullNoContention"
  /// We can get by without the full query job map, so we won't bother waiting to obtain the
  /// shard lock(s) if they're not already unlocked.
  | "PartialAllowed";

/// Returns a map of currently active query jobs, collected from all queries.
// rustc: compiler/rustc_query_impl/src/job.rs:74 collect_active_query_jobs
export function collect_active_query_jobs(tcx: TyCtxt, collect_kind: CollectActiveJobsKind): QueryJobMap {
  const job_map = QueryJobMap.default();

  for_each_query_vtable(tcx, (query) => {
    collect_active_query_jobs_inner(query, collect_kind, job_map);
  });

  return job_map;
}

/// Internal plumbing for collecting the set of active jobs for this query.
///
/// Aborts if jobs can't be gathered as specified by `collect_kind`.
// rustc: compiler/rustc_query_impl/src/job.rs:90 collect_active_query_jobs_inner
function collect_active_query_jobs_inner<K, V>(query: QueryVTable<K, V>, _collect_kind: CollectActiveJobsKind, job_map: QueryJobMap): void {
  // PORT: one shard, never contended: `Full`, `FullNoContention` and `PartialAllowed` all collect it.
  for (const [key, status] of query.state.active.values()) {
    if (status.$ === "Started") {
      const job = status._0;
      // It's fine to call `create_tagged_key` with the shard locked,
      // because it's just a `TaggedQueryKey` variant constructor.
      const tagged_key = query.create_tagged_key(key);
      job_map.insert(job.id, { tagged_key, job: clone_QueryJob(job) });
    }
  }
}

// rustc: compiler/rustc_query_impl/src/job.rs:139 find_cycle_in_stack
export function find_cycle_in_stack(id: QueryJobId, job_map: QueryJobMap, current_job: QueryJobId | undefined, span: Span): QueryCycle {
  // Find the waitee amongst `current_job` parents.
  const frames: QueryStackFrame[] = [];

  while (current_job !== undefined) {
    const job = current_job;
    const info = job_map.get(job);
    frames.push({ span: info.job.span, tagged_key: info.tagged_key });

    if (job === id) {
      frames.reverse();

      // This is the end of the cycle. The span entry we included was for
      // the usage of the cycle itself, and not part of the cycle.
      // Replace it with the span which caused the cycle to form.
      frames[0]!.span = span;
      // Find out why the cycle itself was used.
      const parent = info.job.parent;
      const usage = parent === undefined ? undefined : { span: info.job.span, tagged_key: job_map.tagged_key_of(parent) };
      return { usage, frames };
    }

    current_job = info.job.parent;
  }

  return panic("did not find a cycle");
}

/// Finds the query job closest to the root that is for the same query method as `id`
/// (but not necessarily the same query key), and returns information about it.
// rustc: compiler/rustc_query_impl/src/job.rs:178 find_dep_kind_root
export function find_dep_kind_root(tcx: TyCtxt, id: QueryJobId, job_map: QueryJobMap): [Span, string, number] {
  let depth = 1;
  let info = job_map.get(id);
  // Two query jobs are for the same query method if they have the same
  // `TaggedQueryKey` discriminant.
  const expected_query = info.tagged_key.$;
  let last_info = info;

  for (let parent = info.job.parent; parent !== undefined; parent = info.job.parent) {
    info = job_map.get(parent);
    if (info.tagged_key.$ === expected_query) {
      depth += 1;
      last_info = info;
    }
  }
  return [last_info.job.span, TaggedQueryKeyC.description(last_info.tagged_key, tcx), depth];
}

/** `eprintln!` (PORT: synchronous write to fd 2, like the driver's `std_print`). */
function eprintln(s: string): void {
  const buf = utf8_bytes(`${s}\n`);
  let off = 0;
  while (off < buf.length) off += writeSync(2, buf, off);
}

/**
 * PORT: `mut file: Option<std::fs::File>` is a line sink (`writeln!(file, ..)`, errors ignored like
 * upstream's `let _ =`).
 */
// rustc: compiler/rustc_query_impl/src/job.rs:452 print_query_stack
export function print_query_stack(tcx: TyCtxt, current_query: QueryJobId | undefined, limit_frames: number | undefined, file: ((line: string) => void) | undefined): number {
  // Be careful relying on global state here: this code is called from
  // a panic hook, which means that the global `DiagCtxt` may be in a weird
  // state if it was responsible for triggering the panic.
  let count_printed = 0;
  let count_total = 0;

  // Make use of a partial query job map if we fail to take locks collecting active queries.
  const job_map = collect_active_query_jobs(tcx, "PartialAllowed");

  if (file !== undefined) {
    file("\n\nquery stack during panic:");
  }
  while (current_query !== undefined) {
    const query_info = job_map.map.get(current_query);
    if (query_info === undefined) {
      break;
    }
    const description = TaggedQueryKeyC.description(query_info.tagged_key, tcx);
    if ((limit_frames !== undefined && count_printed < limit_frames) || limit_frames === undefined) {
      // Only print to stderr as many stack frames as `num_frames` when present.
      eprintln(`#${count_printed} [${TaggedQueryKeyC.query_name(query_info.tagged_key)}] ${description}`);
      count_printed += 1;
    }

    if (file !== undefined) {
      file(`#${count_total} [${TaggedQueryKeyC.query_name(query_info.tagged_key)}] ${description}`);
    }

    current_query = query_info.job.parent;
    count_total += 1;
  }

  if (file !== undefined) {
    file("end of query stack");
  }
  return count_total;
}
