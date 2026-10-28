// Port of compiler/rustc_mir_transform/src/coverage/counters/node_flow.rs (lane mt-coverage).
//
// PORT: `Node: Idx` is a number-like index (`G::Node`); `IndexVec<Node, T>` / `IndexSlice<Node, T>` are `T[]`
// (PORTING §5). The graph traits are rustc_data_structures/graph/mod.ts's interfaces. `#[derive(Debug)]` on the local
// structs (`NodeCounters`, `SpantreeEdge`, `CounterTerm`, `SpantreeBuilder`) is only reached by tracing / test failure
// output and is not ported.
//! For each node in a control-flow graph, determines whether that node should
//! have a physical counter, or a counter expression that is derived from the
//! physical counters of other nodes.
//!
//! Based on the algorithm given in
//! "Optimal measurement points for program frequency counts"
//! (Knuth & Stevenson, 1973).
import { DirectedGraph_provided, type Successors } from "../../../rustc_data_structures/graph/mod.ts";
import { UnionFind } from "../../../rustc_data_structures/union_find.ts";
import { DenseBitSet, debug_DenseBitSet } from "../../../rustc_index/bit_set.ts";
import { type NodeFlowData, Op } from "../../../rustc_middle/mir/coverage.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, unwrap } from "../../../std/panic.ts";

// pub(crate) use rustc_middle::mir::coverage::NodeFlowData;
export type { NodeFlowData };

// #[cfg(test)]
// mod tests; (node_flow/tests.test.ts)

/// Creates a "merged" view of an underlying graph.
///
/// The given graph is assumed to have [“balanced flow”](balanced-flow),
/// though it does not necessarily have to be a `BalancedFlowGraph`.
///
/// [balanced-flow]: `crate::coverage::counters::balanced_flow::BalancedFlowGraph`.
// rustc: compiler/rustc_mir_transform/src/coverage/counters/node_flow.rs:25 node_flow_data_for_balanced_graph
export function node_flow_data_for_balanced_graph<N extends number>(graph: Successors<N>): NodeFlowData<N> {
  const supernodes_ = UnionFind.new<N>(graph.num_nodes());

  // For each node, merge its successors into a single supernode, and
  // arbitrarily choose one of those successors to represent all of them.
  const successors: N[] = DirectedGraph_provided.iter_nodes<N>(graph).map((node) => {
    let acc: N | undefined;
    for (const b of graph.successors(node)) {
      acc = acc === undefined ? b : supernodes_.unify(acc, b);
    }
    return unwrap(acc, "each node in a balanced graph must have at least one out-edge");
  });

  // Now that unification is complete, take a snapshot of the supernode forest,
  // and resolve each arbitrarily-chosen successor to its canonical root.
  // (This avoids having to explicitly resolve them later.)
  const supernodes = supernodes_.snapshot();
  const succ_supernodes = successors.map((succ) => supernodes[succ]!);

  return { supernodes, succ_supernodes };
}

/// Uses the graph information in `node_flow_data`, together with a given
/// permutation of all nodes in the graph, to create physical counters and
/// counter expressions for each node in the underlying graph.
///
/// The given list must contain exactly one copy of each node in the
/// underlying balanced-flow graph. The order of nodes is used as a hint to
/// influence counter allocation:
/// - Earlier nodes are more likely to receive counter expressions.
/// - Later nodes are more likely to receive physical counters.
// rustc: compiler/rustc_mir_transform/src/coverage/counters/node_flow.rs:61 make_node_counters
export function make_node_counters<Node extends number>(node_flow_data: NodeFlowData<Node>, priority_list: readonly Node[]): NodeCounters<Node> {
  const builder = SpantreeBuilder.new(node_flow_data);

  for (const node of priority_list) {
    builder.visit_node(node);
  }

  return { counter_terms: builder.finish() };
}

/// End result of allocating physical counters and counter expressions for the
/// nodes of a graph.
// rustc-type: compiler/rustc_mir_transform/src/coverage/counters/node_flow.rs:77 NodeCounters
export interface NodeCounters<Node extends number> {
  /// For the given node, returns the finished list of terms that represent
  /// its physical counter or counter expression. Always non-empty.
  ///
  /// If a node was given a physical counter, the term list will contain
  /// that counter as its sole element.
  counter_terms: CounterTerm<Node>[][];
}

// rustc-type: compiler/rustc_mir_transform/src/coverage/counters/node_flow.rs:87 SpantreeEdge
interface SpantreeEdge<Node> {
  /// If true, this edge in the spantree has been reversed an odd number of
  /// times, so all physical counters added to its node's counter expression
  /// need to be negated.
  is_reversed: boolean;
  /// Each spantree edge is "claimed" by the (regular) node that caused it to
  /// be created. When a node with a physical counter traverses this edge,
  /// that counter is added to the claiming node's counter expression.
  claiming_node: Node;
  /// Supernode at the other end of this spantree edge. Transitively points
  /// to the "root" of this supernode's spantree component.
  span_parent: Node;
}

/// Part of a node's counter expression, which is a sum of counter terms.
// rustc-type: compiler/rustc_mir_transform/src/coverage/counters/node_flow.rs:103 CounterTerm
export interface CounterTerm<Node> {
  /// Whether to add or subtract the value of the node's physical counter.
  op: Op;
  /// The node whose physical counter is represented by this term.
  node: Node;
}

// rustc-type: compiler/rustc_mir_transform/src/coverage/counters/node_flow.rs:111 SpantreeBuilder
class SpantreeBuilder<Node extends number> {
  constructor(
    public supernodes: readonly Node[],
    public succ_supernodes: readonly Node[],

    public is_unvisited: DenseBitSet<Node>,
    /// Links supernodes to each other, gradually forming a spanning tree of
    /// the merged-flow graph.
    ///
    /// A supernode without a span edge is the root of its component of the
    /// spantree. Nodes that aren't supernodes cannot have a spantree edge.
    public span_edges: (SpantreeEdge<Node> | undefined)[],
    /// Shared path buffer recycled by all calls to `yank_to_spantree_root`.
    public yank_buffer: Node[],
    /// An in-progress counter expression for each node. Each expression is
    /// initially empty, and will be filled in as relevant nodes are visited.
    public counter_terms: CounterTerm<Node>[][],
  ) {}

  // rustc: compiler/rustc_mir_transform/src/coverage/counters/node_flow.rs:130 new
  static new<Node extends number>(node_flow_data: NodeFlowData<Node>): SpantreeBuilder<Node> {
    const { supernodes, succ_supernodes } = node_flow_data;
    const num_nodes = supernodes.length;
    return new SpantreeBuilder<Node>(
      supernodes,
      succ_supernodes,
      DenseBitSet.new_filled<Node>(num_nodes),
      Array.from({ length: num_nodes }, () => undefined),
      [],
      Array.from({ length: num_nodes }, () => []),
    );
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/counters/node_flow.rs:143 is_supernode
  is_supernode(node: Node): boolean {
    return this.supernodes[node] === node;
  }

  /// Given a supernode, finds the supernode that is the "root" of its
  /// spantree component. Two nodes that have the same spantree root are
  /// connected in the spantree.
  // rustc: compiler/rustc_mir_transform/src/coverage/counters/node_flow.rs:150 spantree_root
  spantree_root(this_: Node): Node {
    // debug_assert!(self.is_supernode(this));

    const edge = this.span_edges[this_];
    if (edge === undefined) {
      return this_;
    } else {
      return this.spantree_root(edge.span_parent);
    }
  }

  /// Rotates edges in the spantree so that `this` is the root of its
  /// spantree component.
  // rustc: compiler/rustc_mir_transform/src/coverage/counters/node_flow.rs:161 yank_to_spantree_root
  yank_to_spantree_root(this_: Node): void {
    // debug_assert!(self.is_supernode(this));

    // The rotation is done iteratively, by first traversing from `this` to
    // its root and storing the path in a buffer, and then traversing the
    // path buffer backwards to reverse all the edges.

    // Recycle the same path buffer for all calls to this method.
    const path_buf = this.yank_buffer;
    path_buf.length = 0;
    path_buf.push(this_);

    // Traverse the spantree until we reach a supernode that has no
    // span-parent, which must be the root.
    let curr = this_;
    let edge: SpantreeEdge<Node> | undefined;
    while ((edge = this.span_edges[curr]) !== undefined) {
      const span_parent = edge.span_parent;
      path_buf.push(span_parent);
      curr = span_parent;
    }

    // For each spantree edge `a -> b` in the path that was just traversed,
    // reverse it to become `a <- b`, while preserving `claiming_node`.
    for (let i = path_buf.length - 2; i >= 0; i--) {
      const a = path_buf[i]!;
      const b = path_buf[i + 1]!;
      const taken = this.span_edges[a];
      this.span_edges[a] = undefined;
      const { is_reversed, claiming_node } = unwrap<SpantreeEdge<Node>>(taken, "all nodes in the path (except the last) have a `span_parent`");
      // debug_assert_eq!(span_parent, b);
      // debug_assert!(self.span_edges[b].is_none());
      this.span_edges[b] = { is_reversed: !is_reversed, claiming_node, span_parent: a };
    }

    // The result of the rotation is that `this` is now a spantree root.
    // debug_assert!(self.span_edges[this].is_none());
  }

  /// Must be called exactly once for each node in the balanced-flow graph.
  // rustc: compiler/rustc_mir_transform/src/coverage/counters/node_flow.rs:198 visit_node
  visit_node(this_: Node): void {
    // Assert that this node was unvisited, and mark it visited.
    assert(this.is_unvisited.remove(this_), `node has already been visited: ${this_}`);

    // Get the supernode containing `this`, and make it the root of its
    // component of the spantree.
    const this_supernode = this.supernodes[this_]!;
    this.yank_to_spantree_root(this_supernode);

    // Get the supernode containing all of this's successors.
    const succ_supernode = this.succ_supernodes[this_]!;
    // debug_assert!(self.is_supernode(succ_supernode));

    // If two supernodes are already connected in the spantree, they will
    // have the same spantree root. (Each supernode is connected to itself.)
    if (this_supernode !== this.spantree_root(succ_supernode)) {
      // Adding this node's flow edge to the spantree would cause two
      // previously-disconnected supernodes to become connected, so add
      // it. That spantree-edge is now "claimed" by this node.
      //
      // Claiming a spantree-edge means that this node will get a counter
      // expression instead of a physical counter. That expression is
      // currently empty, but will be built incrementally as the other
      // nodes are visited.
      this.span_edges[this_supernode] = {
        is_reversed: false,
        claiming_node: this_,
        span_parent: succ_supernode,
      };
    } else {
      // This node's flow edge would join two supernodes that are already
      // connected in the spantree (or are the same supernode). That would
      // create a cycle in the spantree, so don't add an edge.
      //
      // Instead, create a physical counter for this node, and add that
      // counter to all expressions on the path from `succ_supernode` to
      // `this_supernode`.

      // Instead of setting `this.measure = true` as in the original paper,
      // we just add the node's ID to its own list of terms.
      this.counter_terms[this_]!.push({ node: this_, op: Op.Add });

      // Walk the spantree from `this.successor` back to `this`. For each
      // spantree edge along the way, add this node's physical counter to
      // the counter expression of the node that claimed the spantree edge.
      let curr = succ_supernode;
      while (curr !== this_supernode) {
        const { is_reversed, claiming_node, span_parent } = this.span_edges[curr]!;
        const op = is_reversed ? Op.Subtract : Op.Add;
        this.counter_terms[claiming_node]!.push({ node: this_, op });

        curr = span_parent;
      }
    }
  }

  /// Asserts that all nodes have been visited, and returns the computed
  /// counter expressions (made up of physical counters) for each node.
  // rustc: compiler/rustc_mir_transform/src/coverage/counters/node_flow.rs:257 finish
  finish(): CounterTerm<Node>[][] {
    const { is_unvisited } = this;
    assert(is_unvisited.is_empty(), `some nodes were never visited: ${debug_DenseBitSet(is_unvisited, PLAIN)}`);
    // debug_assert!(
    //     span_edges
    //         .iter_enumerated()
    //         .all(|(node, span_edge)| { span_edge.is_some() <= self.is_supernode(node) }),
    //     "only supernodes can have a span edge",
    // );
    // debug_assert!(
    //     counter_terms.iter().all(|terms| !terms.is_empty()),
    //     "after visiting all nodes, every node should have at least one term",
    // );

    return this.counter_terms;
  }
}
