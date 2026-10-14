// Port of compiler/rustc_data_structures/src/graph/scc/tests.rs
// PORT: `#[bench] bench_sccc` runs its `b.iter` body once as a test. Annotation values are immutable objects whose
// merges write a new value through the `MutRef` (see mod.ts).
import { expect, test } from "bun:test";
import { debug_struct, debug_tuple } from "../../../std/fmt.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { assert } from "../../../std/panic.ts";
import { TestGraph } from "../tests.test.ts";
import { type Annotation, type Annotations, Sccs } from "./mod.ts";

// #[derive(Copy, Clone, Debug)]
// struct MaxReached(usize);
interface MaxReached {
  readonly _0: number;
}
function MaxReached(_0: number): MaxReached {
  return { _0 };
}

// impl Annotation for MaxReached
const Annotation_MaxReached: Annotation<MaxReached> = {
  debug: (v, f) => debug_tuple(f, "MaxReached", [String(v._0)]),
  // rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:35 update_scc
  update_scc(self: MutRef<MaxReached>, other: MaxReached): void {
    self.value = MaxReached(Math.max(self.value._0, other._0));
  },

  // rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:39 update_reachable
  update_reachable(self: MutRef<MaxReached>, other: MaxReached): void {
    self.value = MaxReached(Math.max(self.value._0, other._0));
  },
};

// impl PartialEq<usize> for MaxReached
// rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:45 eq
function MaxReached_eq(self: MaxReached, other: number): boolean {
  return self._0 === other;
}

// struct Maxes(IndexVec<usize, MaxReached>, fn(usize) -> usize);
// type UsizeSccs = Sccs<usize, usize>;
type UsizeSccs = Sccs<number, number>;

class Maxes implements Annotations<number, MaxReached, number> {
  readonly Ann = Annotation_MaxReached;

  constructor(
    public _0: MaxReached[],
    public _1: (n: number) => number,
  ) {}

  // impl Annotations<usize> for Maxes
  // rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:12 new
  new(element: number): MaxReached {
    return MaxReached(this._1(element));
  }

  // rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:16 annotate_scc
  annotate_scc(scc: number, annotation: MaxReached): void {
    this._0.push(annotation);
    const i = this._0.length - 1;
    assert(i === scc, "assertion failed: i == scc");
  }

  // rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:26 annotation
  annotation(scc: number): MaxReached {
    return this._0[scc]!;
  }

  // rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:29 new
  static new_(mapping: (n: number) => number): Maxes {
    // PORT: the inherent `Maxes::new` is `new_` (the `Annotations::new` method has its name).
    return new Maxes([], mapping);
  }
}

// #[derive(Copy, Clone, Debug)]
// struct MinMaxIn { min: usize, max: usize }
interface MinMaxIn {
  readonly min: number;
  readonly max: number;
}

// struct MinMaxes(IndexVec<usize, MinMaxIn>, fn(usize) -> MinMaxIn);
class MinMaxes implements Annotations<number, MinMaxIn, number> {
  readonly Ann = Annotation_MinMaxIn;

  constructor(
    public _0: MinMaxIn[],
    public _1: (n: number) => MinMaxIn,
  ) {}

  // rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:58 annotation
  annotation(scc: number): MinMaxIn {
    return this._0[scc]!;
  }

  // impl Annotations<usize> for MinMaxes
  // rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:64 new
  new(element: number): MinMaxIn {
    return this._1(element);
  }

  // rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:68 annotate_scc
  annotate_scc(scc: number, annotation: MinMaxIn): void {
    this._0.push(annotation);
    const i = this._0.length - 1;
    assert(i === scc, "assertion failed: i == scc");
  }
}

// impl Annotation for MinMaxIn
const Annotation_MinMaxIn: Annotation<MinMaxIn> = {
  debug: (v, f) =>
    debug_struct(f, "MinMaxIn", [
      ["min", String(v.min)],
      ["max", String(v.max)],
    ]),
  // rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:78 update_scc
  update_scc(self: MutRef<MinMaxIn>, other: MinMaxIn): void {
    self.value = { min: Math.min(self.value.min, other.min), max: Math.max(self.value.max, other.max) };
  },

  // rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:83 update_reachable
  update_reachable(_self: MutRef<MinMaxIn>, _other: MinMaxIn): void {},
};

// rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:87 diamond
test("diamond", () => {
  const graph = TestGraph.new(0, [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
  ]);
  const sccs: UsizeSccs = Sccs.new(graph);
  expect(sccs.num_sccs()).toBe(4);
  expect(sccs.num_sccs()).toBe(4);
});

// rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:95 test_big_scc
test("test_big_scc", () => {
  // The order in which things will be visited is important to this
  // test.
  //
  // We will visit:
  //
  // 0 -> 1 -> 2 -> 0
  //
  // and at this point detect a cycle. 2 will return back to 1 which
  // will visit 3. 3 will visit 2 before the cycle is complete, and
  // hence it too will return a cycle.

  /*
    +-> 0
    |   |
    |   v
    |   1 -> 3
    |   |    |
    |   v    |
    +-- 2 <--+
         */
  const graph = TestGraph.new(0, [
    [0, 1],
    [1, 2],
    [1, 3],
    [2, 0],
    [3, 2],
  ]);
  const sccs: UsizeSccs = Sccs.new(graph);
  expect(sccs.num_sccs()).toBe(1);
});

// rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:122 test_three_sccs
test("test_three_sccs", () => {
  /*
        0
        |
        v
    +-> 1    3
    |   |    |
    |   v    |
    +-- 2 <--+
         */
  const graph = TestGraph.new(0, [
    [0, 1],
    [1, 2],
    [2, 1],
    [3, 2],
  ]);
  const sccs: UsizeSccs = Sccs.new(graph);
  expect(sccs.num_sccs()).toBe(3);
  expect(sccs.scc(0)).toBe(1);
  expect(sccs.scc(1)).toBe(0);
  expect(sccs.scc(2)).toBe(0);
  expect(sccs.scc(3)).toBe(2);
  expect(sccs.successors(0)).toEqual([]);
  expect(sccs.successors(1)).toEqual([0]);
  expect(sccs.successors(2)).toEqual([0]);
});

// rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:145 test_find_state_2
test("test_find_state_2", () => {
  // The order in which things will be visited is important to this
  // test. It tests part of the `find_state` behavior. Here is the
  // graph:
  //
  //
  //       /----+
  //     0 <--+ |
  //     |    | |
  //     v    | |
  // +-> 1 -> 3 4
  // |   |      |
  // |   v      |
  // +-- 2 <----+

  const graph = TestGraph.new(0, [
    [0, 1],
    [0, 4],
    [1, 2],
    [1, 3],
    [2, 1],
    [3, 0],
    [4, 2],
  ]);

  // For this graph, we will start in our DFS by visiting:
  //
  // 0 -> 1 -> 2 -> 1
  //
  // and at this point detect a cycle. The state of 2 will thus be
  // `InCycleWith { 1 }`. We will then visit the 1 -> 3 edge, which
  // will attempt to visit 0 as well, thus going to the state
  // `InCycleWith { 0 }`. Finally, node 1 will complete; the lowest
  // depth of any successor was 3 which had depth 0, and thus it
  // will be in the state `InCycleWith { 3 }`.
  //
  // When we finally traverse the `0 -> 4` edge and then visit node 2,
  // the states of the nodes are:
  //
  // 0 BeingVisited { 0 }
  // 1 InCycleWith { 3 }
  // 2 InCycleWith { 1 }
  // 3 InCycleWith { 0 }
  //
  // and hence 4 will traverse the links, finding an ultimate depth of 0.
  // If will also collapse the states to the following:
  //
  // 0 BeingVisited { 0 }
  // 1 InCycleWith { 3 }
  // 2 InCycleWith { 1 }
  // 3 InCycleWith { 0 }

  const sccs: UsizeSccs = Sccs.new(graph);
  expect(sccs.num_sccs()).toBe(1);
  expect(sccs.scc(0)).toBe(0);
  expect(sccs.scc(1)).toBe(0);
  expect(sccs.scc(2)).toBe(0);
  expect(sccs.scc(3)).toBe(0);
  expect(sccs.scc(4)).toBe(0);
  expect(sccs.successors(0)).toEqual([]);
});

// rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:200 test_find_state_3
test("test_find_state_3", () => {
  /*
          /----+
        0 <--+ |
        |    | |
        v    | |
    +-> 1 -> 3 4 5
    |   |      | |
    |   v      | |
    +-- 2 <----+-+
         */
  const graph = TestGraph.new(0, [
    [0, 1],
    [0, 4],
    [1, 2],
    [1, 3],
    [2, 1],
    [3, 0],
    [4, 2],
    [5, 2],
  ]);
  const sccs: UsizeSccs = Sccs.new(graph);
  expect(sccs.num_sccs()).toBe(2);
  expect(sccs.scc(0)).toBe(0);
  expect(sccs.scc(1)).toBe(0);
  expect(sccs.scc(2)).toBe(0);
  expect(sccs.scc(3)).toBe(0);
  expect(sccs.scc(4)).toBe(0);
  expect(sccs.scc(5)).toBe(1);
  expect(sccs.successors(0)).toEqual([]);
  expect(sccs.successors(1)).toEqual([0]);
});

// rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:226 test_deep_linear
test("test_deep_linear", () => {
  /*
    0
    |
    v
    1
    |
    v
    2
    |
    v
    …
     */
  // #[cfg(not(miri))]
  const NR_NODES = 1 << 14;
  const nodes: [number, number][] = [];
  for (let i = 1; i < NR_NODES; i++) {
    nodes.push([i - 1, i]);
  }
  const graph = TestGraph.new(0, nodes);
  const sccs: UsizeSccs = Sccs.new(graph);
  expect(sccs.num_sccs()).toBe(NR_NODES);
  expect(sccs.scc(0)).toBe(NR_NODES - 1);
  expect(sccs.scc(NR_NODES - 1)).toBe(0);
});

// #[bench]
// rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:255 bench_sccc
test("bench_sccc", () => {
  // Like `test_three_sccs` but each state is replaced by a group of
  // three or four to have some amount of test data.
  /*
       0-3
        |
        v
    +->4-6 11-14
    |   |    |
    |   v    |
    +--7-10<-+
         */
  // rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:267 make_3_clique
  function make_3_clique(slice: [number, number][], start: number, base: number): void {
    // PORT: `&mut graph[a..b]` is the array plus the slice start.
    slice[start + 0] = [base + 0, base + 1];
    slice[start + 1] = [base + 1, base + 2];
    slice[start + 2] = [base + 2, base + 0];
  }
  // Not actually a clique but strongly connected.
  // rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:273 make_4_clique
  function make_4_clique(slice: [number, number][], start: number, base: number): void {
    slice[start + 0] = [base + 0, base + 1];
    slice[start + 1] = [base + 1, base + 2];
    slice[start + 2] = [base + 2, base + 3];
    slice[start + 3] = [base + 3, base + 0];
    slice[start + 4] = [base + 1, base + 3];
    slice[start + 5] = [base + 2, base + 1];
  }

  const graph_: [number, number][] = Array.from({ length: 6 + 3 + 6 + 3 + 4 }, () => [0, 0]);
  make_4_clique(graph_, 0, 0);
  make_3_clique(graph_, 6, 4);
  make_4_clique(graph_, 9, 7);
  make_3_clique(graph_, 15, 11);
  graph_[18] = [0, 4];
  graph_[19] = [5, 7];
  graph_[20] = [11, 10];
  graph_[21] = [7, 4];
  const graph = TestGraph.new(0, graph_);
  // b.iter(|| { ... })
  const sccs: UsizeSccs = Sccs.new(graph);
  expect(sccs.num_sccs()).toBe(3);
});

// rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:299 test_max_self_loop
test("test_max_self_loop", () => {
  const graph = TestGraph.new(0, [[0, 0]]);
  const annotations = new Maxes([], (n) => (n === 0 ? 17 : 0));
  Sccs.new_with_annotation(graph, annotations);
  expect(MaxReached_eq(annotations._0[0]!, 17)).toBe(true);
});

// rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:307 test_max_branch
test("test_max_branch", () => {
  const graph = TestGraph.new(0, [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 4],
  ]);
  const annotations = new Maxes([], (n) => n);
  const sccs = Sccs.new_with_annotation(graph, annotations);
  expect(MaxReached_eq(annotations._0[sccs.scc(0)]!, 4)).toBe(true);
  expect(MaxReached_eq(annotations._0[sccs.scc(1)]!, 3)).toBe(true);
  expect(MaxReached_eq(annotations._0[sccs.scc(2)]!, 4)).toBe(true);
});

// rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:317 test_single_cycle_max
test("test_single_cycle_max", () => {
  const graph = TestGraph.new(0, [
    [0, 2],
    [2, 3],
    [2, 4],
    [4, 1],
    [1, 2],
  ]);
  const annotations = new Maxes([], (n) => n);
  const sccs = Sccs.new_with_annotation(graph, annotations);
  expect(MaxReached_eq(annotations._0[sccs.scc(2)]!, 4)).toBe(true);
  expect(MaxReached_eq(annotations._0[sccs.scc(0)]!, 4)).toBe(true);
});

// rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:326 test_double_cycle_max
test("test_double_cycle_max", () => {
  const graph = TestGraph.new(0, [
    [0, 1],
    [1, 2],
    [1, 4],
    [2, 3],
    [2, 4],
    [3, 5],
    [4, 1],
    [5, 4],
  ]);
  const annotations = new Maxes([], (n) => (n === 5 ? 2 : 1));

  const sccs = Sccs.new_with_annotation(graph, annotations);

  expect(annotations._0[sccs.scc(0)]!._0).toBe(2);
});

// rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:337 test_bug_minimised
test("test_bug_minimised", () => {
  const graph = TestGraph.new(0, [
    [0, 3],
    [0, 1],
    [3, 2],
    [2, 3],
    [1, 4],
    [4, 5],
    [5, 4],
  ]);
  const annotations = new Maxes([], (n) => {
    switch (n) {
      case 3:
        return 1;
      default:
        return 0;
    }
  });

  const sccs = Sccs.new_with_annotation(graph, annotations);
  expect(MaxReached_eq(annotations.annotation(sccs.scc(2)), 1)).toBe(true);
  expect(MaxReached_eq(annotations.annotation(sccs.scc(1)), 0)).toBe(true);
  expect(MaxReached_eq(annotations.annotation(sccs.scc(4)), 0)).toBe(true);
});

// rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:351 test_bug_max_leak_minimised
test("test_bug_max_leak_minimised", () => {
  const graph = TestGraph.new(0, [
    [0, 1],
    [0, 2],
    [1, 3],
    [3, 0],
    [3, 4],
    [4, 3],
  ]);
  const annotations = new Maxes([], (w) => {
    switch (w) {
      case 4:
        return 1;
      default:
        return 0;
    }
  });

  const sccs = Sccs.new_with_annotation(graph, annotations);

  expect(MaxReached_eq(annotations.annotation(sccs.scc(2)), 0)).toBe(true);
  expect(MaxReached_eq(annotations.annotation(sccs.scc(3)), 1)).toBe(true);
  expect(MaxReached_eq(annotations.annotation(sccs.scc(0)), 1)).toBe(true);
});

// rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:366 test_bug_max_leak
test("test_bug_max_leak", () => {
  const graph = TestGraph.new(8, [
    [0, 0],
    [0, 18],
    [0, 19],
    [0, 1],
    [0, 2],
    [0, 7],
    [0, 8],
    [0, 23],
    [18, 0],
    [18, 12],
    [19, 0],
    [19, 25],
    [12, 18],
    [12, 3],
    [12, 5],
    [3, 12],
    [3, 21],
    [3, 22],
    [5, 13],
    [21, 3],
    [22, 3],
    [13, 5],
    [13, 4],
    [4, 13],
    [4, 0],
    [2, 11],
    [7, 6],
    [6, 20],
    [20, 6],
    [8, 17],
    [17, 9],
    [9, 16],
    [16, 26],
    [26, 15],
    [15, 10],
    [10, 14],
    [14, 27],
    [23, 24],
  ]);
  const annotations = Maxes.new_((w) => {
    switch (w) {
      case 22:
        return 1;
      case 24:
        return 2;
      case 27:
        return 2;
      default:
        return 0;
    }
  });
  const sccs = Sccs.new_with_annotation(graph, annotations);

  expect(MaxReached_eq(annotations.annotation(sccs.scc(2)), 0)).toBe(true);
  expect(MaxReached_eq(annotations.annotation(sccs.scc(7)), 0)).toBe(true);
  expect(MaxReached_eq(annotations.annotation(sccs.scc(8)), 2)).toBe(true);
  expect(MaxReached_eq(annotations.annotation(sccs.scc(23)), 2)).toBe(true);
  expect(MaxReached_eq(annotations.annotation(sccs.scc(3)), 2)).toBe(true);
  expect(MaxReached_eq(annotations.annotation(sccs.scc(0)), 2)).toBe(true);
});

// rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:427 test_bug_max_zero_stick_shape
test("test_bug_max_zero_stick_shape", () => {
  const graph = TestGraph.new(0, [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 2],
    [3, 4],
  ]);
  const annotations = Maxes.new_((w) => {
    switch (w) {
      case 4:
        return 1;
      default:
        return 0;
    }
  });
  const sccs = Sccs.new_with_annotation(graph, annotations);

  expect(MaxReached_eq(annotations.annotation(sccs.scc(0)), 1)).toBe(true);
  expect(MaxReached_eq(annotations.annotation(sccs.scc(1)), 1)).toBe(true);
  expect(MaxReached_eq(annotations.annotation(sccs.scc(2)), 1)).toBe(true);
  expect(MaxReached_eq(annotations.annotation(sccs.scc(3)), 1)).toBe(true);
  expect(MaxReached_eq(annotations.annotation(sccs.scc(4)), 1)).toBe(true);
});

// rustc: compiler/rustc_data_structures/src/graph/scc/tests.rs:443 test_min_max_in
test("test_min_max_in", () => {
  const graph = TestGraph.new(0, [
    [0, 1],
    [0, 2],
    [1, 3],
    [3, 0],
    [3, 4],
    [4, 3],
    [3, 5],
  ]);
  const annotations = new MinMaxes([], (w) => ({ min: w, max: w }));
  const sccs = Sccs.new_with_annotation(graph, annotations);

  expect(annotations.annotation(sccs.scc(2)).min).toBe(2);
  expect(annotations.annotation(sccs.scc(2)).max).toBe(2);
  expect(annotations.annotation(sccs.scc(0)).min).toBe(0);
  expect(annotations.annotation(sccs.scc(0)).max).toBe(4);
  expect(annotations.annotation(sccs.scc(3)).min).toBe(0);
  expect(annotations.annotation(sccs.scc(3)).max).toBe(4);
  expect(annotations.annotation(sccs.scc(5)).min).toBe(5);
});
