// Port of compiler/rustc_data_structures/src/graph/reference.rs
//
// PORT: `impl<'graph, G: Trait> Trait for &'graph G` forwards every method to `G`. A Rust `&G` is the `G` object
// itself in TS (PORTING §5), so a reference already is a graph; these helpers are the forwarding bodies, kept for
// fidelity (nothing needs to call them).
import type { DirectedGraph, Predecessors, StartNode, Successors } from "./mod.ts";

export const ref_graph = {
  // impl<'graph, G: DirectedGraph> DirectedGraph for &'graph G
  // rustc: compiler/rustc_data_structures/src/graph/reference.rs:6 num_nodes
  num_nodes<N extends number>(self: DirectedGraph<N>): number {
    return self.num_nodes();
  },

  // impl<'graph, G: StartNode> StartNode for &'graph G
  // rustc: compiler/rustc_data_structures/src/graph/reference.rs:12 start_node
  start_node<N extends number>(self: StartNode<N>): N {
    return self.start_node();
  },

  // impl<'graph, G: Successors> Successors for &'graph G
  // rustc: compiler/rustc_data_structures/src/graph/reference.rs:18 successors
  successors<N extends number>(self: Successors<N>, node: N): Iterable<N> {
    return self.successors(node);
  },

  // impl<'graph, G: Predecessors> Predecessors for &'graph G
  // rustc: compiler/rustc_data_structures/src/graph/reference.rs:24 predecessors
  predecessors<N extends number>(self: Predecessors<N>, node: N): Iterable<N> {
    return self.predecessors(node);
  },
};
