// Port of compiler/rustc_data_structures/src/graph/reversed.rs
import type { Predecessors, Successors } from "./mod.ts";

/// View that reverses the direction of edges in its underlying graph, so that
/// successors become predecessors and vice-versa.
///
/// Because of `impl<G: Graph> Graph for &G`, the underlying graph can be
/// wrapped by-reference instead of by-value if desired.
// rustc-type: compiler/rustc_data_structures/src/graph/reversed.rs:9 ReversedGraph
// PORT: the impls are conditional on `G`'s traits (`Successors` needs `G: Predecessors` and vice-versa); the class
// requires both, which every caller's `G` provides.
export class ReversedGraph<N extends number> implements Successors<N>, Predecessors<N> {
  constructor(public inner: Successors<N> & Predecessors<N>) {}

  // rustc: compiler/rustc_data_structures/src/graph/reversed.rs:14 new
  static new<N extends number>(inner: Successors<N> & Predecessors<N>): ReversedGraph<N> {
    return new ReversedGraph<N>(inner);
  }

  // impl<G: DirectedGraph> DirectedGraph for ReversedGraph<G>
  // rustc: compiler/rustc_data_structures/src/graph/reversed.rs:22 num_nodes
  num_nodes(): number {
    return this.inner.num_nodes();
  }

  // Implementing `StartNode` is not possible in general, because the start node
  // of an underlying graph is instead an _end_ node in the reversed graph.
  // But would be possible to define another wrapper type that adds an explicit
  // start node to its underlying graph, if desired.

  // impl<G: Predecessors> Successors for ReversedGraph<G>
  // rustc: compiler/rustc_data_structures/src/graph/reversed.rs:33 successors
  successors(node: N): Iterable<N> {
    return this.inner.predecessors(node);
  }

  // impl<G: Successors> Predecessors for ReversedGraph<G>
  // rustc: compiler/rustc_data_structures/src/graph/reversed.rs:39 predecessors
  predecessors(node: N): Iterable<N> {
    return this.inner.successors(node);
  }
}
