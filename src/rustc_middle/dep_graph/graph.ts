// Partial port of compiler/rustc_middle/src/dep_graph/graph.rs: the *disabled* dep graph only.
//
// PORT: no dep graph (D3, docs/plan-m2.md). rust-ts has no incremental compilation, so the only
// `DepGraph` is `DepGraph::new_disabled()` (`data: None`), which is also what a non-incremental rustc
// runs with. Every function below is ported with its `data: None` path; the `Some(data)` paths are
// incremental-only and call `unported`. `DepGraphData`, `DepNode`, task deps, colors, the serialized
// graph and the work products are not ported.
import { newtype_index } from "../../rustc_index/newtype_index.ts";
import type { Debug } from "../../std/fmt.ts";
import { Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import { type StableHash, StableHasher } from "../../rustc_data_structures/stable_hash.ts";
import { unported } from "../../std/panic.ts";
import type { StableHashState } from "../ich.ts";
import type { HashValueFn } from "../query/system.ts";
import type { TyCtxt } from "../ty/context.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";

/// Tracks 'side effects' for a particular query.
/// This struct is saved to disk along with the query result,
/// and loaded from disk if we mark the query as green.
/// This allows us to 'replay' changes to global state
/// that would otherwise only occur if we actually
/// executed the query method.
///
/// Each side effect gets an unique dep node index which is added
/// as a dependency of the query which had the effect.
// rustc-type: compiler/rustc_middle/src/dep_graph/graph.rs:44 QuerySideEffect
// PORT: `Diagnostic(DiagInner)` is not declared yet (`track_diagnostic` is incremental-only and not ported).
export type QuerySideEffect =
  /// Records the feature used during query execution.
  /// This feature will be inserted into `query_system.used_features`
  /// if we mark the query as green, as that query will have
  /// the side effect dep node as a dependency.
  { readonly $: "CheckFeature"; symbol: Symbol };

/** PORT: the `R: StableHash` bound is passed as `stable_hash_R` (stable-hash handoff, decision 4). */
// rustc: compiler/rustc_middle/src/dep_graph/graph.rs:165 hash_result
export function hash_result<R>(hcx: StableHashState, result: R, stable_hash_R: StableHash<R>): Fingerprint {
  const stable_hasher = StableHasher.new();
  stable_hash_R(result, hcx, stable_hasher);
  return stable_hasher.finish(Fingerprint);
}

/** PORT: `DepKind` (dep_node.rs, generated from the query list plus the non-query kinds such as `TraitSelect`)
 * is not ported (D3): its variant name, as `check_feedable_consistency` prints it. The disabled graph never
 * reads it. */
export type DepKind = string;

/** PORT: `DepGraphData` is not ported (D3); a `DepGraph` never has one. */
export type DepGraphData = never;

export class DepGraph {
  constructor(
    /** PORT: always `None` (D3). */
    readonly data_: DepGraphData | undefined,
    /// This field is used for assigning DepNodeIndices when running in
    /// non-incremental mode. Even in non-incremental mode we make sure that
    /// each task has a `DepNodeIndex` that uniquely identifies it. This unique
    /// ID is used for self-profiling.
    public virtual_dep_node_index: number,
  ) {}

  // rustc: compiler/rustc_middle/src/dep_graph/graph.rs:226 new_disabled
  static new_disabled(): DepGraph {
    return new DepGraph(undefined, 0);
  }

  // rustc: compiler/rustc_middle/src/dep_graph/graph.rs:231 data
  data(): DepGraphData | undefined {
    return this.data_;
  }

  /// Returns `true` if we are actually building the full dep-graph, and `false` otherwise.
  // rustc: compiler/rustc_middle/src/dep_graph/graph.rs:237 is_fully_enabled
  is_fully_enabled(): boolean {
    return this.data_ !== undefined;
  }

  // rustc: compiler/rustc_middle/src/dep_graph/graph.rs:249 assert_ignored
  assert_ignored(): void {
    if (this.data_ !== undefined) {
      unported("rustc_middle::dep_graph::DepGraph::assert_ignored with a dep graph (D3)");
    }
  }

  // rustc: compiler/rustc_middle/src/dep_graph/graph.rs:269 with_ignore
  with_ignore<R>(op: () => R): R {
    // PORT: no dep graph (D3): `with_deps(TaskDepsRef::Ignore, op)` only swaps the implicit context's
    // task deps, which do not exist here.
    return op();
  }

  /** PORT: no dep graph (D3): `DepNode` is not ported, so `dep_node` is `undefined` (as in `with_feed_task`);
   * the disabled graph never reads it. `hash_result` is kept for the signature only. */
  // rustc: compiler/rustc_middle/src/dep_graph/graph.rs:330 with_task
  with_task<R>(dep_node: undefined, tcx: TyCtxt, op: () => R, hash_result: HashValueFn<R> | undefined): [R, DepNodeIndex] {
    if (this.data_ !== undefined) {
      void [dep_node, tcx, hash_result];
      return unported("rustc_middle::dep_graph::DepGraphData::with_task (D3)");
    } else {
      return [op(), this.next_virtual_depnode_index()];
    }
  }

  // rustc: compiler/rustc_middle/src/dep_graph/graph.rs:346 with_anon_task
  with_anon_task<R>(tcx: TyCtxt, dep_kind: DepKind, op: () => R): [R, DepNodeIndex] {
    if (this.data_ !== undefined) {
      // let (result, index) = data.with_anon_task_inner(tcx, dep_kind, op);
      // self.read_index(index);
      void [tcx, dep_kind];
      return unported("rustc_middle::dep_graph::DepGraphData::with_anon_task_inner (D3)");
    } else {
      return [op(), this.next_virtual_depnode_index()];
    }
  }

  // rustc: compiler/rustc_middle/src/dep_graph/graph.rs:507 read_index
  read_index(_dep_node_index: DepNodeIndex): void {
    if (this.data_ !== undefined) {
      unported("rustc_middle::dep_graph::DepGraph::read_index with a dep graph (D3)");
    }
  }

  // rustc: compiler/rustc_middle/src/dep_graph/graph.rs:574 encode_side_effect
  encode_side_effect(_tcx: TyCtxt, _side_effect: QuerySideEffect): DepNodeIndex {
    if (this.data_ !== undefined) {
      return unported("rustc_middle::dep_graph::DepGraph::encode_side_effect with a dep graph (D3)");
    } else {
      return this.next_virtual_depnode_index();
    }
  }

  /// Create a node when we force-feed a value into the query cache.
  /// This is used to remove cycles during type-checking const generic parameters.
  ///
  /// As usual in the query system, we consider the current state of the calling query
  /// only depends on the list of dependencies up to now. As a consequence, the value
  /// that this query gives us can only depend on those dependencies too. Therefore,
  /// it is sound to use the current dependency set for the created node.
  ///
  /// During replay, the order of the nodes is relevant in the dependency graph.
  /// So the unchanged replay will mark the caller query before trying to mark this one.
  /// If there is a change to report, the caller query will be re-executed before this one.
  ///
  /// FIXME: If the code is changed enough for this node to be marked before requiring the
  /// caller's node, we suppose that those changes will be enough to mark this node red and
  /// force a recomputation using the "normal" way.
  // rustc: compiler/rustc_middle/src/dep_graph/graph.rs:601 with_feed_task
  with_feed_task<R>(_node: undefined, _tcx: TyCtxt, _result: R, _hash_result: HashValueFn<R> | undefined, _format_value_fn: (v: R) => string): DepNodeIndex {
    if (this.data_ !== undefined) {
      return unported("rustc_middle::dep_graph::DepGraph::with_feed_task with a dep graph (D3)");
    } else {
      // Incremental compilation is turned off. We just execute the task
      // without tracking. We still provide a dep-node index that uniquely
      // identifies the task so that we have a cheap way of referring to
      // the query for self-profiling.
      return this.next_virtual_depnode_index();
    }
  }

  // rustc: compiler/rustc_middle/src/dep_graph/graph.rs:1093 finish_encoding
  finish_encoding(): { $: "Ok"; _0: number } {
    if (this.data_ !== undefined) {
      return unported("rustc_middle::dep_graph::DepGraph::finish_encoding with a dep graph (D3)");
    } else {
      return { $: "Ok", _0: 0 };
    }
  }

  // rustc: compiler/rustc_middle/src/dep_graph/graph.rs:1097 next_virtual_depnode_index
  next_virtual_depnode_index(): DepNodeIndex {
    // debug_assert!(self.data.is_none());
    const index = this.virtual_dep_node_index;
    this.virtual_dep_node_index += 1;
    return DepNodeIndex.from_u32(index);
  }
}

// rustc_index::newtype_index! { pub struct DepNodeIndex {} }
export type DepNodeIndex = number & { readonly __brand: "DepNodeIndex" };
export const DepNodeIndex = {
  ...newtype_index<DepNodeIndex>((n) => `DepNodeIndex(${n})`),
  // const SINGLETON_ZERO_DEPS_ANON_NODE: DepNodeIndex = DepNodeIndex::ZERO;
  FOREVER_RED_NODE: 1 as DepNodeIndex,
};
export const debug_DepNodeIndex: Debug<DepNodeIndex> = DepNodeIndex.debug;
