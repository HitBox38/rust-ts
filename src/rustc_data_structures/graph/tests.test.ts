// Port of compiler/rustc_data_structures/src/graph/tests.rs (the `TestGraph` used by the graph algorithms' tests).
// PORT: `FxHashMap<usize, Vec<usize>>` is only indexed, never iterated: a JS `Map`.
import type { DirectedGraph, Predecessors, StartNode, Successors } from "./mod.ts";

// rustc-type: compiler/rustc_data_structures/src/graph/tests.rs:6 TestGraph
export class TestGraph implements DirectedGraph<number>, StartNode<number>, Predecessors<number>, Successors<number> {
  constructor(
    public num_nodes_: number,
    public start_node_: number,
    public successors_: Map<number, number[]>,
    public predecessors_: Map<number, number[]>,
  ) {}

  // rustc: compiler/rustc_data_structures/src/graph/tests.rs:14 new
  static new(start_node: number, edges: readonly (readonly [number, number])[]): TestGraph {
    const graph = new TestGraph(start_node + 1, start_node, new Map(), new Map());
    for (const [source, target] of edges) {
      graph.num_nodes_ = Math.max(graph.num_nodes_, source + 1);
      graph.num_nodes_ = Math.max(graph.num_nodes_, target + 1);
      or_default(graph.successors_, source).push(target);
      or_default(graph.predecessors_, target).push(source);
    }
    for (let node = 0; node < graph.num_nodes_; node++) {
      or_default(graph.successors_, node);
      or_default(graph.predecessors_, node);
    }
    return graph;
  }

  // impl DirectedGraph for TestGraph
  // rustc: compiler/rustc_data_structures/src/graph/tests.rs:38 num_nodes
  num_nodes(): number {
    return this.num_nodes_;
  }

  // impl StartNode for TestGraph
  // rustc: compiler/rustc_data_structures/src/graph/tests.rs:44 start_node
  start_node(): number {
    return this.start_node_;
  }

  // impl Predecessors for TestGraph
  // rustc: compiler/rustc_data_structures/src/graph/tests.rs:50 predecessors
  predecessors(node: number): Iterable<number> {
    return this.predecessors_.get(node)!.slice();
  }

  // impl Successors for TestGraph
  // rustc: compiler/rustc_data_structures/src/graph/tests.rs:56 successors
  successors(node: number): Iterable<number> {
    return this.successors_.get(node)!.slice();
  }
}

/** `map.entry(k).or_default()` */
function or_default(map: Map<number, number[]>, k: number): number[] {
  let v = map.get(k);
  if (v === undefined) {
    v = [];
    map.set(k, v);
  }
  return v;
}
