// Port of compiler/rustc_data_structures/src/graph/vec_graph/mod.rs
//
// PORT: the const generic `BR` (back references) is a readonly field set by `VecGraph.new(.., BR)` (default `false`,
// like upstream's `const BR: bool = false`). `predecessors` exists only on `VecGraph<N, true>` upstream (calling it on
// a `false` graph does not type-check), so here it is `unreachable` for `BR == false`.
import { assert, assert_eq, unreachable } from "../../../std/panic.ts";
import type { NumEdges, Predecessors, Successors } from "../mod.ts";

/// A directed graph, efficient for cases where node indices are pre-existing.
///
/// If `BR` is true, the graph will store back-references, allowing you to get predecessors.
// rustc-type: compiler/rustc_data_structures/src/graph/vec_graph/mod.rs:11 VecGraph
export class VecGraph<N extends number> implements Successors<N>, Predecessors<N>, NumEdges<N> {
  constructor(
    readonly BR: boolean,
    // This is basically a `HashMap<N, (Vec<N>, If<BR, Vec<N>>)>` -- a map from a node index, to
    // a list of targets of outgoing edges and (if enabled) a list of sources of incoming edges.
    //
    // However, it is condensed into two arrays as an optimization.
    //
    // `node_starts[n]` is the start of the list of targets of outgoing edges for node `n`.
    // So you can get node's successors with `edge_targets[node_starts[n]..node_starts[n + 1]]`.
    //
    // If `BR` is true (back references are enabled), then `node_starts[n + edge_count]` is the
    // start of the list of *sources* of incoming edges. You can get predecessors of a node
    // similarly to its successors but offsetting by `edge_count`. `edge_count` is
    // `edge_targets.len()/2` (again, in case BR is true) because half of the vec is back refs.
    //
    // All of this might be confusing, so here is an example graph and its representation:
    //
    //       n3 ----+
    //        ^     |                           (if BR = true)
    //        |     v     outgoing edges        incoming edges
    // n0 -> n1 -> n2     ______________      __________________
    //                   /              \    /                  \
    //  node indices[1]:  n0, n1, n2, n3,     n0, n1, n2, n3,       n/a
    //      vec indices:  n0, n1, n2, n3,     n4, n5, n6, n7,       n8
    //      node_starts:  [0,  1,  3,  4       4,  4,  5,  7,        8]
    //                     |   |   |   |       |   |   |   |         |
    //                     |   |   +---+       +---+   |   +---+     |
    //                     |   |       |           |   |       |     |
    //                     v   v       v           v   v       v     v
    //     edge_targets: [n1, n2, n3, n2          n0, n1, n3, n1]
    //                   /    \____/   |           |  \____/    \
    //             n0->n1     /        |           |       \     n3<-n1
    //                       /    n3->n2 [2]  n1<-n0 [2]    \
    //         n1->n2, n1->n3                                n2<-n1, n2<-n3
    //
    // The incoming edges are basically stored in the same way as outgoing edges, but offset and
    // the graph they store is the inverse of the original. Last index in the `node_starts` array
    // always points to one-past-the-end, so that we don't need to bound check `node_starts[n + 1]`
    //
    // [1]: "node indices" are the indices a user of `VecGraph` might use,
    //      note that they are different from "vec indices",
    //      which are the real indices you need to index `node_starts`
    //
    // [2]: Note that even though n2 also points to here,
    //      the next index also points here, so n2 has no
    //      successors (`edge_targets[3..3] = []`).
    //      Similarly with n0 and incoming edges
    //
    // If this is still confusing... then sorry :(
    //
    /// Indices into `edge_targets` that signify a start of list of edges.
    public node_starts: number[],
    /// Targets (or sources for back refs) of edges
    public edge_targets: N[],
  ) {}

  // rustc: compiler/rustc_data_structures/src/graph/vec_graph/mod.rs:68 new
  static new<N extends number>(num_nodes: number, edge_pairs: [N, N][], BR = false): VecGraph<N> {
    const num_edges = edge_pairs.length;

    let nodes_cap: number;
    switch (BR) {
      // +1 for special entry at the end, pointing one past the end of `edge_targets`
      case false:
        nodes_cap = num_nodes + 1;
        break;
      // *2 for back references
      case true:
        nodes_cap = num_nodes * 2 + 1;
        break;
    }

    let edges_cap: number;
    switch (BR) {
      case false:
        edges_cap = num_edges;
        break;
      // *2 for back references
      case true:
        edges_cap = num_edges * 2;
        break;
    }
    // PORT: the capacities only size the allocations.
    void nodes_cap;
    void edges_cap;

    const node_starts: number[] = [];
    const edge_targets: N[] = [];

    // Sort the edges by the source -- this is important.
    edge_pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    // Fill forward references
    create_index(
      num_nodes,
      edge_pairs.map(([src, _]) => src),
      edge_pairs.map(([_, tgt]) => tgt),
      edge_targets,
      node_starts,
    );

    // Fill back references
    if (BR) {
      // Pop the special "last" entry, it will be replaced by first back ref
      node_starts.pop();

      // Re-sort the edges so that they are sorted by target
      edge_pairs.sort((a, b) => a[1] - b[1] || a[0] - b[0]);

      create_index(
        // Back essentially double the number of nodes
        num_nodes * 2,
        // NB: the source/target are switched here too
        // NB: we double the key index, so that we can later use *2 to get the back references
        edge_pairs.map(([_, tgt]) => (tgt + num_nodes) as N),
        edge_pairs.map(([src, _]) => src),
        edge_targets,
        node_starts,
      );
    }

    return new VecGraph<N>(BR, node_starts, edge_targets);
  }

  /// Gets the successors for `source` as a slice.
  // rustc: compiler/rustc_data_structures/src/graph/vec_graph/mod.rs:123 successors
  // impl<N: Idx + Ord, const BR: bool> Successors for VecGraph<N, BR>
  // rustc: compiler/rustc_data_structures/src/graph/vec_graph/mod.rs:227 successors
  successors(source: N): readonly N[] {
    // PORT: the trait method (`self.successors(node).iter().cloned()`) is this inherent method.
    assert(source < this.num_nodes(), "assertion failed: source.index() < self.num_nodes()");

    const start_index = this.node_starts[source]!;
    const end_index = this.node_starts[source + 1]!;
    return this.edge_targets.slice(start_index, end_index);
  }

  // impl<N: Idx + Ord> VecGraph<N, true>
  /// Gets the predecessors for `target` as a slice.
  // rustc: compiler/rustc_data_structures/src/graph/vec_graph/mod.rs:134 predecessors
  // impl<N: Idx + Ord> Predecessors for VecGraph<N, true>
  // rustc: compiler/rustc_data_structures/src/graph/vec_graph/mod.rs:233 predecessors
  predecessors(target: N): readonly N[] {
    // PORT: the trait method (`self.predecessors(node).iter().cloned()`) is this inherent method.
    if (!this.BR) unreachable("`VecGraph::predecessors` needs `BR = true`");
    assert(target < this.num_nodes(), "assertion failed: target.index() < self.num_nodes()");

    target = (target + this.num_nodes()) as N;

    const start_index = this.node_starts[target]!;
    const end_index = this.node_starts[target + 1]!;
    return this.edge_targets.slice(start_index, end_index);
  }

  // impl<N: Idx, const BR: bool> DirectedGraph for VecGraph<N, BR>
  // rustc: compiler/rustc_data_structures/src/graph/vec_graph/mod.rs:207 num_nodes
  num_nodes(): number {
    switch (this.BR) {
      case false:
        return this.node_starts.length - 1;
      // If back refs are enabled, half of the array is said back refs
      case true:
        return Math.floor((this.node_starts.length - 1) / 2);
    }
  }

  // impl<N: Idx, const BR: bool> NumEdges for VecGraph<N, BR>
  // rustc: compiler/rustc_data_structures/src/graph/vec_graph/mod.rs:217 num_edges
  num_edges(): number {
    switch (this.BR) {
      case false:
        return this.edge_targets.length;
      // If back refs are enabled, half of the array is reversed edges for them
      case true:
        return Math.floor(this.edge_targets.length / 2);
    }
  }
}

/// Creates/initializes the index for the [`VecGraph`]. A helper for [`VecGraph::new`].
///
/// - `num_nodes` is the target number of nodes in the graph
/// - `sorted_edge_sources` are the edge sources, sorted
/// - `associated_edge_targets` are the edge *targets* in the same order as sources
/// - `edge_targets` is the vec of targets to be extended
/// - `node_starts` is the index to be filled
// rustc: compiler/rustc_data_structures/src/graph/vec_graph/mod.rs:152 create_index
function create_index<N extends number>(
  num_nodes: number,
  sorted_edge_sources: Iterable<N>,
  associated_edge_targets: Iterable<N>,
  edge_targets: N[],
  node_starts: number[],
): void {
  const offset = edge_targets.length;

  // Store the *target* of each edge into `edge_targets`.
  for (const target of associated_edge_targets) edge_targets.push(target);

  // Create the *edge starts* array. We are iterating over the
  // (sorted) edge pairs. We maintain the invariant that the
  // length of the `node_starts` array is enough to store the
  // current source node -- so when we see that the source node
  // for an edge is greater than the current length, we grow the
  // edge-starts array by just enough.
  let index = 0;
  for (const source of sorted_edge_sources) {
    // If we have a list like `[(0, x), (2, y)]`:
    //
    // - Start out with `node_starts` of `[]`
    // - Iterate to `(0, x)` at index 0:
    //   - Push one entry because `node_starts.len()` (0) is <= the source (0)
    //   - Leaving us with `node_starts` of `[0]`
    // - Iterate to `(2, y)` at index 1:
    //   - Push one entry because `node_starts.len()` (1) is <= the source (2)
    //   - Push one entry because `node_starts.len()` (2) is <= the source (2)
    //   - Leaving us with `node_starts` of `[0, 1, 1]`
    // - Loop terminates
    while (node_starts.length <= source) {
      node_starts.push(index + offset);
    }
    index += 1;
  }

  // Pad out the `node_starts` array so that it has `num_nodes +
  // 1` entries. Continuing our example above, if `num_nodes` is
  // be `3`, we would push one more index: `[0, 1, 1, 2]`.
  //
  // Interpretation of that vector:
  //
  // [0, 1, 1, 2]
  //        ---- range for N=2
  //     ---- range for N=1
  //  ---- range for N=0
  while (node_starts.length <= num_nodes) {
    node_starts.push(edge_targets.length);
  }

  assert_eq(node_starts.length, num_nodes + 1, String);
}
