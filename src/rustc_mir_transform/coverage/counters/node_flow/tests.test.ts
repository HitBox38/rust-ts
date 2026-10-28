// Port of compiler/rustc_mir_transform/src/coverage/counters/node_flow/tests.rs (lane mt-coverage).
import { expect, test } from "bun:test";
import { type Successors } from "../../../../rustc_data_structures/graph/mod.ts";
import { VecGraph } from "../../../../rustc_data_structures/graph/vec_graph/mod.ts";
import "../../../../rustc_middle/lib.ts";
import { type CounterTerm, make_node_counters, type NodeCounters, type NodeFlowData, node_flow_data_for_balanced_graph } from "../node_flow.ts";

// rustc: compiler/rustc_mir_transform/src/coverage/counters/node_flow/tests.rs:11 node_flow_data
function node_flow_data<N extends number>(graph: Successors<N>): NodeFlowData<N> {
  return node_flow_data_for_balanced_graph(graph);
}

// rustc: compiler/rustc_mir_transform/src/coverage/counters/node_flow/tests.rs:15 make_graph
function make_graph<Node extends number>(num_nodes: number, edge_pairs: [Node, Node][]): VecGraph<Node> {
  return VecGraph.new(num_nodes, edge_pairs);
}

/// Example used in "Optimal Measurement Points for Program Frequency Counts"
/// (Knuth & Stevenson, 1973), but with 0-based node IDs.
// rustc: compiler/rustc_mir_transform/src/coverage/counters/node_flow/tests.rs:22 example_driver
test("example_driver", () => {
  const graph = make_graph<number>(5, [
    [0, 1],
    [0, 3],
    [1, 0],
    [1, 2],
    [2, 1],
    [2, 4],
    [3, 3],
    [3, 4],
    [4, 0],
  ]);

  const node_flow_data_ = node_flow_data(graph);
  const counters = make_node_counters(node_flow_data_, [3, 1, 2, 0, 4]);

  expect(format_counter_expressions(counters)).toEqual([
    // (comment to force vertical formatting for clarity)
    "[0]: +c0",
    "[1]: +c0 +c2 -c4",
    "[2]: +c2",
    "[3]: +c3",
    "[4]: +c4",
  ]);
});

// rustc: compiler/rustc_mir_transform/src/coverage/counters/node_flow/tests.rs:44 format_counter_expressions
function format_counter_expressions<Node extends number>(counters: NodeCounters<Node>): string[] {
  const format_item = ({ node, op }: CounterTerm<Node>): string => {
    let op_: string;
    switch (op) {
      case "Subtract":
        op_ = "-";
        break;
      case "Add":
        op_ = "+";
        break;
    }
    return `${op_}c${node}`;
  };

  return counters.counter_terms.map((_, node) => {
    const terms = counters.counter_terms[node]!.slice();
    terms.sort((a, b) => a.node - b.node);
    return `[${node}]: ${terms.map(format_item).join(" ")}`;
  });
}
