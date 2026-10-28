// Port of compiler/rustc_mir_transform/src/coverage/counters/balanced_flow.rs (lane mt-coverage).
//
// PORT: `BalancedFlowGraph<G>` is a class over the node type `N` holding `G` (a `ControlFlowGraph<N>`, the bound of
// `for_graph`); the trait impls are its methods. `G::Node::new(n)` is `n as N`. `force_sink_edge: impl Fn(G::Node) ->
// bool` is a closure.
//! A control-flow graph can be said to have “balanced flow” if the flow
//! (execution count) of each node is equal to the sum of its in-edge flows,
//! and also equal to the sum of its out-edge flows.
//!
//! Control-flow graphs typically have one or more nodes that don't satisfy the
//! balanced-flow property, e.g.:
//! - The start node has out-edges, but no in-edges.
//! - Return nodes have in-edges, but no out-edges.
//! - `Yield` nodes can have an out-flow that is less than their in-flow.
//! - Inescapable loops cause the in-flow/out-flow relationship to break down.
//!
//! Balanced-flow graphs are nevertheless useful for analysis, so this module
//! provides a wrapper type ([`BalancedFlowGraph`]) that imposes balanced flow
//! on an underlying graph. This is done by non-destructively adding synthetic
//! nodes and edges as necessary.
import { DepthFirstSearch } from "../../../rustc_data_structures/graph/iterate/mod.ts";
import { type ControlFlowGraph, DirectedGraph_provided, type StartNode, type Successors } from "../../../rustc_data_structures/graph/mod.ts";
import { ReversedGraph } from "../../../rustc_data_structures/graph/reversed.ts";
import { DenseBitSet } from "../../../rustc_index/bit_set.ts";

/// A view of an underlying graph that has been augmented to have “balanced flow”.
/// This means that the flow (execution count) of each node is equal to the
/// sum of its in-edge flows, and also equal to the sum of its out-edge flows.
///
/// To achieve this, a synthetic "sink" node is non-destructively added to the
/// graph, with synthetic in-edges from these nodes:
/// - Any node that has no out-edges.
/// - Any node that explicitly requires a sink edge, as indicated by a
///   caller-supplied `force_sink_edge` function.
/// - Any node that would otherwise be unable to reach the sink, because it is
///   part of an inescapable loop.
///
/// To make the graph fully balanced, there is also a synthetic edge from the
/// sink node back to the start node.
///
/// ---
/// The benefit of having a balanced-flow graph is that it can be subsequently
/// transformed in ways that are guaranteed to preserve balanced flow
/// (e.g. merging nodes together), which is useful for discovering relationships
/// between the node flows of different nodes in the graph.
// rustc-type: compiler/rustc_mir_transform/src/coverage/counters/balanced_flow.rs:43 BalancedFlowGraph
export class BalancedFlowGraph<N extends number> implements StartNode<N>, Successors<N> {
  constructor(
    public graph: ControlFlowGraph<N>,
    public sink_edge_nodes: DenseBitSet<N>,
    public sink: N,
  ) {}

  /// Creates a balanced view of an underlying graph, by adding a synthetic
  /// sink node that has in-edges from nodes that need or request such an edge,
  /// and a single out-edge to the start node.
  ///
  /// Assumes that all nodes in the underlying graph are reachable from the
  /// start node.
  // rustc: compiler/rustc_mir_transform/src/coverage/counters/balanced_flow.rs:56 for_graph
  static for_graph<N extends number>(graph: ControlFlowGraph<N>, force_sink_edge: (node: N) => boolean): BalancedFlowGraph<N> {
    const sink_edge_nodes = DenseBitSet.new_empty<N>(graph.num_nodes());
    const dfs = DepthFirstSearch.new(ReversedGraph.new(graph));

    // First, determine the set of nodes that explicitly request or require
    // an out-edge to the sink.
    for (const node of DirectedGraph_provided.iter_nodes<N>(graph)) {
      if (force_sink_edge(node) || graph.successors(node)[Symbol.iterator]().next().done === true) {
        sink_edge_nodes.insert(node);
        dfs.push_start_node(node);
      }
    }

    // Next, find all nodes that are currently not reverse-reachable from
    // `sink_edge_nodes`, and add them to the set as well.
    dfs.complete_search();
    sink_edge_nodes.union_not(dfs.visited_set());

    // The sink node is 1 higher than the highest real node.
    const sink = graph.num_nodes() as N;

    return new BalancedFlowGraph<N>(graph, sink_edge_nodes, sink);
  }

  // impl<G> graph::DirectedGraph for BalancedFlowGraph<G>
  /// Returns the number of nodes in this balanced-flow graph, which is 1
  /// more than the number of nodes in the underlying graph, to account for
  /// the synthetic sink node.
  // rustc: compiler/rustc_mir_transform/src/coverage/counters/balanced_flow.rs:93 num_nodes
  num_nodes(): number {
    // The sink node's index is already the size of the underlying graph,
    // so just add 1 to that instead.
    return this.sink + 1;
  }

  // impl<G> graph::StartNode for BalancedFlowGraph<G>
  // rustc: compiler/rustc_mir_transform/src/coverage/counters/balanced_flow.rs:104 start_node
  start_node(): N {
    return this.graph.start_node();
  }

  // impl<G> graph::Successors for BalancedFlowGraph<G>
  // rustc: compiler/rustc_mir_transform/src/coverage/counters/balanced_flow.rs:113 successors
  successors(node: N): Iterable<N> {
    let real_edges: Iterable<N> | undefined;
    let sink_edge: N | undefined;

    if (node === this.sink) {
      // The sink node has no real out-edges, and one synthetic out-edge
      // to the start node.
      real_edges = undefined;
      sink_edge = this.graph.start_node();
    } else {
      // Real nodes have their real out-edges, and possibly one synthetic
      // out-edge to the sink node.
      real_edges = this.graph.successors(node);
      sink_edge = this.sink_edge_nodes.contains(node) ? this.sink : undefined;
    }

    // real_edges.into_flat_iter().chain(sink_edge)
    const out: N[] = real_edges === undefined ? [] : [...real_edges];
    if (sink_edge !== undefined) out.push(sink_edge);
    return out;
  }
}
