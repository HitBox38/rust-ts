// Port of compiler/rustc_data_structures/src/graph/iterate/tests.rs
import { expect, test } from "bun:test";
import { PLAIN } from "../../../std/fmt.ts";
import { is_cyclic } from "../mod.ts";
import { TestGraph } from "../tests.test.ts";
import { DepthFirstSearch, debug_DepthFirstSearch, post_order_from } from "./mod.ts";

// rustc: compiler/rustc_data_structures/src/graph/iterate/tests.rs:5 diamond_post_order
test("diamond_post_order", () => {
  const graph = TestGraph.new(0, [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
  ]);

  const result = post_order_from(graph, 0);
  expect(result).toEqual([3, 1, 2, 0]);
});

// rustc: compiler/rustc_data_structures/src/graph/iterate/tests.rs:13 is_cyclic
test("is_cyclic", () => {
  const diamond_acyclic = TestGraph.new(0, [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
  ]);
  const diamond_cyclic = TestGraph.new(0, [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ]);

  expect(is_cyclic(diamond_acyclic)).toBe(false);
  expect(is_cyclic(diamond_cyclic)).toBe(true);
});

// rustc: compiler/rustc_data_structures/src/graph/iterate/tests.rs:24 dfs
test("dfs", () => {
  const graph = TestGraph.new(0, [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
    [3, 0],
  ]);

  const result: number[] = [...DepthFirstSearch.new(graph).with_start_node(0)];
  expect(result).toEqual([0, 2, 3, 1]);
});

// rustc: compiler/rustc_data_structures/src/graph/iterate/tests.rs:32 dfs_debug
test("dfs_debug", () => {
  const graph = TestGraph.new(0, [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
    [3, 0],
  ]);
  const dfs = DepthFirstSearch.new(graph).with_start_node(0);
  dfs.complete_search();
  expect(debug_DepthFirstSearch(dfs, PLAIN)).toBe("{0, 1, 2, 3}");
});
