// Port of compiler/rustc_data_structures/src/graph/mod.rs
//
// PORT: the graph traits are interfaces over a node type `N` (`type Node: Idx`: a number or a branded `newtype_index!`
// handle; `Idx::new(i)` / `node.index()` are the identity). `impl Iterator<Item = Self::Node>` returns are `Iterable<N>`
// (an implementor may return a slice, e.g. `VecGraph::successors`). The provided `DirectedGraph::iter_nodes` lives in
// `DirectedGraph_provided` (PORTING §8). `ControlFlowGraph` (a blanket-implemented alias trait) is an intersection type.
//
// PORT: `mod reference` (`impl<G: Trait> Trait for &G`) is the identity in TS (`&G` is `G`); its fns are ported in
// reference.ts as forwarding helpers.
import * as iterate from "./iterate/mod.ts";

// pub mod dominators; (not ported yet)
export * as iterate from "./iterate/mod.ts";
// pub mod linked_graph; (not ported yet)
// mod reference; (reference.ts: identity forwarding helpers, nothing to re-export)
export * as reversed from "./reversed.ts";
export * as scc from "./scc/mod.ts";
export * as vec_graph from "./vec_graph/mod.ts";

// rustc-trait: compiler/rustc_data_structures/src/graph/mod.rs:14 DirectedGraph
export interface DirectedGraph<N extends number = number> {
  /** `type Node: Idx` (type-level only). */
  readonly __node?: N;

  /// Returns the total number of nodes in this graph.
  ///
  /// Several graph algorithm implementations assume that every node ID is
  /// strictly less than the number of nodes, i.e. nodes are densely numbered.
  /// That assumption allows them to use `num_nodes` to allocate per-node
  /// data structures, indexed by node.
  // rustc: compiler/rustc_data_structures/src/graph/mod.rs:23 num_nodes
  num_nodes(): number;

  // (provided) iter_nodes
}

/** PORT: the provided methods of `DirectedGraph` (PORTING §8). */
export const DirectedGraph_provided = {
  /// Iterates over all nodes of a graph in ascending numeric order.
  ///
  /// Assumes that nodes are densely numbered, i.e. every index in
  /// `0..num_nodes` is a valid node.
  // rustc: compiler/rustc_data_structures/src/graph/mod.rs:29 iter_nodes
  iter_nodes<N extends number>(self: DirectedGraph<N>): N[] {
    // PORT: the `DoubleEndedIterator + ExactSizeIterator` is an array.
    const n = self.num_nodes();
    const out: N[] = [];
    for (let i = 0; i < n; i++) out.push(i as N);
    return out;
  },
};

// rustc-trait: compiler/rustc_data_structures/src/graph/mod.rs:36 NumEdges
export interface NumEdges<N extends number = number> extends DirectedGraph<N> {
  // rustc: compiler/rustc_data_structures/src/graph/mod.rs:37 num_edges
  num_edges(): number;
}

// rustc-trait: compiler/rustc_data_structures/src/graph/mod.rs:40 StartNode
export interface StartNode<N extends number = number> extends DirectedGraph<N> {
  // rustc: compiler/rustc_data_structures/src/graph/mod.rs:41 start_node
  start_node(): N;
}

// rustc-trait: compiler/rustc_data_structures/src/graph/mod.rs:44 Successors
export interface Successors<N extends number = number> extends DirectedGraph<N> {
  // rustc: compiler/rustc_data_structures/src/graph/mod.rs:45 successors
  successors(node: N): Iterable<N>;
}

// rustc-trait: compiler/rustc_data_structures/src/graph/mod.rs:48 Predecessors
export interface Predecessors<N extends number = number> extends DirectedGraph<N> {
  // rustc: compiler/rustc_data_structures/src/graph/mod.rs:49 predecessors
  predecessors(node: N): Iterable<N>;
}

/// Alias for [`DirectedGraph`] + [`StartNode`] + [`Predecessors`] + [`Successors`].
export type ControlFlowGraph<N extends number = number> = DirectedGraph<N> & StartNode<N> & Predecessors<N> & Successors<N>;

/// Returns `true` if the graph has a cycle that is reachable from the start node.
// rustc: compiler/rustc_data_structures/src/graph/mod.rs:57 is_cyclic
export function is_cyclic<N extends number>(graph: DirectedGraph<N> & StartNode<N> & Successors<N>): boolean {
  return iterate.TriColorDepthFirstSearch.new(graph).run_from_start(iterate.CycleDetector) !== undefined;
}

// rustc: compiler/rustc_data_structures/src/graph/mod.rs:66 depth_first_search
export function depth_first_search<N extends number>(graph: Successors<N>, from: N): iterate.DepthFirstSearch<N> {
  return iterate.DepthFirstSearch.new(graph).with_start_node(from);
}

// rustc: compiler/rustc_data_structures/src/graph/mod.rs:73 depth_first_search_as_undirected
export function depth_first_search_as_undirected<N extends number>(graph: Successors<N> & Predecessors<N>, from: N): iterate.DepthFirstSearch<N> {
  // struct AsUndirected<G>(G);
  class AsUndirected implements Successors<N> {
    constructor(public _0: Successors<N> & Predecessors<N>) {}

    // impl<G: DirectedGraph> DirectedGraph for AsUndirected<G>
    // rustc: compiler/rustc_data_structures/src/graph/mod.rs:85 num_nodes
    num_nodes(): number {
      return this._0.num_nodes();
    }

    // impl<G: Successors + Predecessors> Successors for AsUndirected<G>
    // rustc: compiler/rustc_data_structures/src/graph/mod.rs:91 successors
    *successors(node: N): Generator<N> {
      yield* this._0.successors(node);
      yield* this._0.predecessors(node);
    }
  }

  return iterate.DepthFirstSearch.new<N>(new AsUndirected(graph)).with_start_node(from);
}
