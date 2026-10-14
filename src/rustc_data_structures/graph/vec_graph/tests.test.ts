// Port of compiler/rustc_data_structures/src/graph/vec_graph/tests.rs
import { expect, test } from "bun:test";
import * as graph_ from "../mod.ts";
import { VecGraph } from "./mod.ts";

// rustc: compiler/rustc_data_structures/src/graph/vec_graph/tests.rs:4 create_graph
function create_graph(): VecGraph<number> {
  // Create a simple graph
  //
  //          5
  //          |
  //          V
  //    0 --> 1 --> 2
  //          |
  //          v
  //          3 --> 4
  //
  //    6

  return VecGraph.new(7, [
    [0, 1],
    [1, 2],
    [1, 3],
    [3, 4],
    [5, 1],
  ]);
}

// rustc: compiler/rustc_data_structures/src/graph/vec_graph/tests.rs:20 create_graph_with_back_refs
function create_graph_with_back_refs(): VecGraph<number> {
  // Same as above
  return VecGraph.new(
    7,
    [
      [0, 1],
      [1, 2],
      [1, 3],
      [3, 4],
      [5, 1],
    ],
    true,
  );
}

// rustc: compiler/rustc_data_structures/src/graph/vec_graph/tests.rs:26 num_nodes
test("num_nodes", () => {
  let graph = create_graph();
  expect(graph.num_nodes()).toBe(7);

  graph = create_graph_with_back_refs();
  expect(graph.num_nodes()).toBe(7);
});

// rustc: compiler/rustc_data_structures/src/graph/vec_graph/tests.rs:35 successors
test("successors", () => {
  let graph = create_graph();
  expect(graph.successors(0)).toEqual([1]);
  expect(graph.successors(1)).toEqual([2, 3]);
  expect(graph.successors(2)).toEqual([]);
  expect(graph.successors(3)).toEqual([4]);
  expect(graph.successors(4)).toEqual([]);
  expect(graph.successors(5)).toEqual([1]);
  expect(graph.successors(6)).toEqual([]);

  graph = create_graph_with_back_refs();
  expect(graph.successors(0)).toEqual([1]);
  expect(graph.successors(1)).toEqual([2, 3]);
  expect(graph.successors(2)).toEqual([]);
  expect(graph.successors(3)).toEqual([4]);
  expect(graph.successors(4)).toEqual([]);
  expect(graph.successors(5)).toEqual([1]);
  expect(graph.successors(6)).toEqual([]);
});

// rustc: compiler/rustc_data_structures/src/graph/vec_graph/tests.rs:56 predecessors
test("predecessors", () => {
  const graph = create_graph_with_back_refs();
  expect(graph.predecessors(0)).toEqual([]);
  expect(graph.predecessors(1)).toEqual([0, 5]);
  expect(graph.predecessors(2)).toEqual([1]);
  expect(graph.predecessors(3)).toEqual([1]);
  expect(graph.predecessors(4)).toEqual([3]);
  expect(graph.predecessors(5)).toEqual([]);
  expect(graph.predecessors(6)).toEqual([]);
});

// rustc: compiler/rustc_data_structures/src/graph/vec_graph/tests.rs:68 dfs
test("dfs", () => {
  let graph = create_graph();
  let dfs: number[] = [...graph_.depth_first_search(graph, 0)];
  expect(dfs).toEqual([0, 1, 3, 4, 2]);

  graph = create_graph_with_back_refs();
  dfs = [...graph_.depth_first_search(graph, 0)];
  expect(dfs).toEqual([0, 1, 3, 4, 2]);
});
