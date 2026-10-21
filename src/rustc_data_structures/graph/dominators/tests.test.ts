// Port of compiler/rustc_data_structures/src/graph/dominators/tests.rs
import { expect, test } from "bun:test";
import { TestGraph } from "../tests.test.ts";
import { dominators } from "./mod.ts";

// rustc: compiler/rustc_data_structures/src/graph/dominators/tests.rs:5 diamond
test("diamond", () => {
  const graph = TestGraph.new(0, [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
  ]);

  const d = dominators(graph);
  expect(d.immediate_dominator(0)).toBe(undefined);
  expect(d.immediate_dominator(1)).toBe(0);
  expect(d.immediate_dominator(2)).toBe(0);
  expect(d.immediate_dominator(3)).toBe(0);
});

// rustc: compiler/rustc_data_structures/src/graph/dominators/tests.rs:16 paper
test("paper", () => {
  // example from the paper:
  const graph = TestGraph.new(6, [
    [6, 5],
    [6, 4],
    [5, 1],
    [4, 2],
    [4, 3],
    [1, 2],
    [2, 3],
    [3, 2],
    [2, 1],
  ]);

  const d = dominators(graph);
  expect(d.immediate_dominator(0)).toBe(undefined); // <-- note that 0 is not in graph
  expect(d.immediate_dominator(1)).toBe(6);
  expect(d.immediate_dominator(2)).toBe(6);
  expect(d.immediate_dominator(3)).toBe(6);
  expect(d.immediate_dominator(4)).toBe(6);
  expect(d.immediate_dominator(5)).toBe(6);
  expect(d.immediate_dominator(6)).toBe(undefined);
});

// rustc: compiler/rustc_data_structures/src/graph/dominators/tests.rs:34 paper_slt
test("paper_slt", () => {
  // example from the paper:
  const graph = TestGraph.new(1, [
    [1, 2],
    [1, 3],
    [2, 3],
    [2, 7],
    [3, 4],
    [3, 6],
    [4, 5],
    [5, 4],
    [6, 7],
    [7, 8],
    [8, 5],
  ]);

  dominators(graph);
});

// rustc: compiler/rustc_data_structures/src/graph/dominators/tests.rs:45 immediate_dominator
test("immediate_dominator", () => {
  const graph = TestGraph.new(1, [
    [1, 2],
    [2, 3],
  ]);
  const d = dominators(graph);
  expect(d.immediate_dominator(0)).toBe(undefined);
  expect(d.immediate_dominator(1)).toBe(undefined);
  expect(d.immediate_dominator(2)).toBe(1);
  expect(d.immediate_dominator(3)).toBe(2);
});

// rustc: compiler/rustc_data_structures/src/graph/dominators/tests.rs:55 transitive_dominator
test("transitive_dominator", () => {
  const graph = TestGraph.new(0, [
    // First tree branch.
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    // Second tree branch.
    [1, 5],
    [5, 6],
    // Third tree branch.
    [0, 7],
    // These links make 0 the dominator for 2 and 3.
    [7, 2],
    [5, 3],
  ]);

  const d = dominators(graph);
  expect(d.immediate_dominator(2)).toBe(0);
  expect(d.immediate_dominator(3)).toBe(0); // This used to return Some(1).
});
