// Port of compiler/rustc_data_structures/src/transitive_relation/tests.rs
import { expect, test } from "bun:test";
import { TransitiveRelation, TransitiveRelationBuilder } from "../transitive_relation.ts";

// impl<T: Eq + Hash + Copy> TransitiveRelation<T>
/// A "best" parent in some sense. See `parents` and
/// `postdom_upper_bound` for more details.
// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:6 postdom_parent
function postdom_parent<T>(self: TransitiveRelation<T>, a: T): T | undefined {
  return self.mutual_immediate_postdominator(self.parents(a));
}

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:12 test_one_step
test("test_one_step", () => {
  const relation_ = TransitiveRelationBuilder.default<string>();
  relation_.add("a", "b");
  relation_.add("a", "c");
  const relation = relation_.freeze();
  expect(relation.contains("a", "c")).toBe(true);
  expect(relation.contains("a", "b")).toBe(true);
  expect(relation.contains("b", "a")).toBe(false);
  expect(relation.contains("a", "d")).toBe(false);
});

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:24 test_many_steps
test("test_many_steps", () => {
  const relation_ = TransitiveRelationBuilder.default<string>();
  relation_.add("a", "b");
  relation_.add("a", "c");
  relation_.add("a", "f");

  relation_.add("b", "c");
  relation_.add("b", "d");
  relation_.add("b", "e");

  relation_.add("e", "g");
  const relation = relation_.freeze();

  expect(relation.contains("a", "b")).toBe(true);
  expect(relation.contains("a", "c")).toBe(true);
  expect(relation.contains("a", "d")).toBe(true);
  expect(relation.contains("a", "e")).toBe(true);
  expect(relation.contains("a", "f")).toBe(true);
  expect(relation.contains("a", "g")).toBe(true);

  expect(relation.contains("b", "g")).toBe(true);

  expect(relation.contains("a", "x")).toBe(false);
  expect(relation.contains("b", "f")).toBe(false);
});

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:51 mubs_triangle
test("mubs_triangle", () => {
  // a -> tcx
  //      ^
  //      |
  //      b
  const relation_ = TransitiveRelationBuilder.default<string>();
  relation_.add("a", "tcx");
  relation_.add("b", "tcx");
  const relation = relation_.freeze();
  expect(relation.minimal_upper_bounds("a", "b")).toEqual(["tcx"]);
  expect(relation.parents("a")).toEqual(["tcx"]);
  expect(relation.parents("b")).toEqual(["tcx"]);
});

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:66 mubs_best_choice1
test("mubs_best_choice1", () => {
  // 0 -> 1 <- 3
  // |    ^    |
  // |    |    |
  // +--> 2 <--+
  //
  // mubs(0,3) = [1]

  // This tests a particular state in the algorithm, in which we
  // need the second pare down call to get the right result (after
  // intersection, we have [1, 2], but 2 -> 1).

  const relation_ = TransitiveRelationBuilder.default<string>();
  relation_.add("0", "1");
  relation_.add("0", "2");

  relation_.add("2", "1");

  relation_.add("3", "1");
  relation_.add("3", "2");
  const relation = relation_.freeze();

  expect(relation.minimal_upper_bounds("0", "3")).toEqual(["2"]);
  expect(relation.parents("0")).toEqual(["2"]);
  expect(relation.parents("2")).toEqual(["1"]);
  expect(relation.parents("1")).toEqual([]);
});

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:95 mubs_best_choice2
test("mubs_best_choice2", () => {
  // 0 -> 1 <- 3
  // |    |    |
  // |    v    |
  // +--> 2 <--+
  //
  // mubs(0,3) = [2]

  // Like the preceding test, but in this case intersection is [2,
  // 1], and hence we rely on the first pare down call.

  const relation_ = TransitiveRelationBuilder.default<string>();
  relation_.add("0", "1");
  relation_.add("0", "2");

  relation_.add("1", "2");

  relation_.add("3", "1");
  relation_.add("3", "2");
  const relation = relation_.freeze();

  expect(relation.minimal_upper_bounds("0", "3")).toEqual(["1"]);
  expect(relation.parents("0")).toEqual(["1"]);
  expect(relation.parents("1")).toEqual(["2"]);
  expect(relation.parents("2")).toEqual([]);
});

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:123 mubs_no_best_choice
test("mubs_no_best_choice", () => {
  // in this case, the intersection yields [1, 2], and the "pare
  // down" calls find nothing to remove.
  const relation_ = TransitiveRelationBuilder.default<string>();
  relation_.add("0", "1");
  relation_.add("0", "2");

  relation_.add("3", "1");
  relation_.add("3", "2");
  const relation = relation_.freeze();

  expect(relation.minimal_upper_bounds("0", "3")).toEqual(["1", "2"]);
  expect(relation.parents("0")).toEqual(["1", "2"]);
  expect(relation.parents("3")).toEqual(["1", "2"]);
});

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:140 mubs_best_choice_scc
test("mubs_best_choice_scc", () => {
  // in this case, 1 and 2 form a cycle; we pick arbitrarily (but
  // consistently).

  const relation_ = TransitiveRelationBuilder.default<string>();
  relation_.add("0", "1");
  relation_.add("0", "2");

  relation_.add("1", "2");
  relation_.add("2", "1");

  relation_.add("3", "1");
  relation_.add("3", "2");
  const relation = relation_.freeze();

  expect(relation.minimal_upper_bounds("0", "3")).toEqual(["1"]);
  expect(relation.parents("0")).toEqual(["1"]);
});

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:160 pdub_crisscross
test("pdub_crisscross", () => {
  // diagonal edges run left-to-right
  // a -> a1 -> x
  //   \/       ^
  //   /\       |
  // b -> b1 ---+

  const relation_ = TransitiveRelationBuilder.default<string>();
  relation_.add("a", "a1");
  relation_.add("a", "b1");
  relation_.add("b", "a1");
  relation_.add("b", "b1");
  relation_.add("a1", "x");
  relation_.add("b1", "x");
  const relation = relation_.freeze();

  expect(relation.minimal_upper_bounds("a", "b")).toEqual(["a1", "b1"]);
  expect(relation.postdom_upper_bound("a", "b")).toBe("x");
  expect(postdom_parent(relation, "a")).toBe("x");
  expect(postdom_parent(relation, "b")).toBe("x");
});

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:183 pdub_crisscross_more
test("pdub_crisscross_more", () => {
  // diagonal edges run left-to-right
  // a -> a1 -> a2 -> a3 -> x
  //   \/    \/             ^
  //   /\    /\             |
  // b -> b1 -> b2 ---------+

  const relation_ = TransitiveRelationBuilder.default<string>();
  relation_.add("a", "a1");
  relation_.add("a", "b1");
  relation_.add("b", "a1");
  relation_.add("b", "b1");

  relation_.add("a1", "a2");
  relation_.add("a1", "b2");
  relation_.add("b1", "a2");
  relation_.add("b1", "b2");

  relation_.add("a2", "a3");

  relation_.add("a3", "x");
  relation_.add("b2", "x");
  const relation = relation_.freeze();

  expect(relation.minimal_upper_bounds("a", "b")).toEqual(["a1", "b1"]);
  expect(relation.minimal_upper_bounds("a1", "b1")).toEqual(["a2", "b2"]);
  expect(relation.postdom_upper_bound("a", "b")).toBe("x");

  expect(postdom_parent(relation, "a")).toBe("x");
  expect(postdom_parent(relation, "b")).toBe("x");
});

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:216 pdub_lub
test("pdub_lub", () => {
  // a -> a1 -> x
  //            ^
  //            |
  // b -> b1 ---+

  const relation_ = TransitiveRelationBuilder.default<string>();
  relation_.add("a", "a1");
  relation_.add("b", "b1");
  relation_.add("a1", "x");
  relation_.add("b1", "x");
  const relation = relation_.freeze();

  expect(relation.minimal_upper_bounds("a", "b")).toEqual(["x"]);
  expect(relation.postdom_upper_bound("a", "b")).toBe("x");

  expect(postdom_parent(relation, "a")).toBe("a1");
  expect(postdom_parent(relation, "b")).toBe("b1");
  expect(postdom_parent(relation, "a1")).toBe("x");
  expect(postdom_parent(relation, "b1")).toBe("x");
});

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:239 mubs_intermediate_node_on_one_side_only
test("mubs_intermediate_node_on_one_side_only", () => {
  // a -> c -> d
  //           ^
  //           |
  //           b

  // "digraph { a -> c -> d; b -> d; }",
  const relation_ = TransitiveRelationBuilder.default<string>();
  relation_.add("a", "c");
  relation_.add("c", "d");
  relation_.add("b", "d");
  const relation = relation_.freeze();

  expect(relation.minimal_upper_bounds("a", "b")).toEqual(["d"]);
});

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:256 mubs_scc_1
test("mubs_scc_1", () => {
  // +-------------+
  // |    +----+   |
  // |    v    |   |
  // a -> c -> d <-+
  //           ^
  //           |
  //           b

  // "digraph { a -> c -> d; d -> c; a -> d; b -> d; }",
  const relation_ = TransitiveRelationBuilder.default<string>();
  relation_.add("a", "c");
  relation_.add("c", "d");
  relation_.add("d", "c");
  relation_.add("a", "d");
  relation_.add("b", "d");
  const relation = relation_.freeze();

  expect(relation.minimal_upper_bounds("a", "b")).toEqual(["c"]);
});

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:278 mubs_scc_2
test("mubs_scc_2", () => {
  //      +----+
  //      v    |
  // a -> c -> d
  //      ^    ^
  //      |    |
  //      +--- b

  // "digraph { a -> c -> d; d -> c; b -> d; b -> c; }",
  const relation_ = TransitiveRelationBuilder.default<string>();
  relation_.add("a", "c");
  relation_.add("c", "d");
  relation_.add("d", "c");
  relation_.add("b", "d");
  relation_.add("b", "c");
  const relation = relation_.freeze();

  expect(relation.minimal_upper_bounds("a", "b")).toEqual(["c"]);
});

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:299 mubs_scc_3
test("mubs_scc_3", () => {
  //      +---------+
  //      v         |
  // a -> c -> d -> e
  //           ^    ^
  //           |    |
  //           b ---+

  // "digraph { a -> c -> d -> e -> c; b -> d; b -> e; }",
  const relation_ = TransitiveRelationBuilder.default<string>();
  relation_.add("a", "c");
  relation_.add("c", "d");
  relation_.add("d", "e");
  relation_.add("e", "c");
  relation_.add("b", "d");
  relation_.add("b", "e");
  const relation = relation_.freeze();

  expect(relation.minimal_upper_bounds("a", "b")).toEqual(["c"]);
});

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:321 mubs_scc_4
test("mubs_scc_4", () => {
  //      +---------+
  //      v         |
  // a -> c -> d -> e
  // |         ^    ^
  // +---------+    |
  //                |
  //           b ---+

  // "digraph { a -> c -> d -> e -> c; a -> d; b -> e; }"
  const relation_ = TransitiveRelationBuilder.default<string>();
  relation_.add("a", "c");
  relation_.add("c", "d");
  relation_.add("d", "e");
  relation_.add("e", "c");
  relation_.add("a", "d");
  relation_.add("b", "e");
  const relation = relation_.freeze();

  expect(relation.minimal_upper_bounds("a", "b")).toEqual(["c"]);
});

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:344 parent
test("parent", () => {
  // An example that was misbehaving in the compiler.
  //
  // 4 -> 1 -> 3
  //   \  |   /
  //    \ v  /
  // 2 -> 0
  //
  // plus a bunch of self-loops
  //
  // Here `->` represents `<=` and `0` is `'static`.

  const pairs: [number, number][] = [
    [2, /*->*/ 0],
    [2, /*->*/ 2],
    [0, /*->*/ 0],
    [0, /*->*/ 0],
    [1, /*->*/ 0],
    [1, /*->*/ 1],
    [3, /*->*/ 0],
    [3, /*->*/ 3],
    [4, /*->*/ 0],
    [4, /*->*/ 1],
    [1, /*->*/ 3],
  ];

  const relation_ = TransitiveRelationBuilder.default<number>();
  for (const [a, b] of pairs) {
    relation_.add(a, b);
  }
  const relation = relation_.freeze();

  const p = postdom_parent(relation, 3);
  expect(p).toBe(0);
});

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:381 minimal_scc_representative_1
test("minimal_scc_representative_1", () => {
  //      +---------+
  //      v         |
  // a -> c -> d -> e
  //           ^    ^
  //           |    |
  //           b ---+

  // "digraph { a -> c -> d -> e -> c; b -> d; b -> e; }",
  const relation_ = TransitiveRelationBuilder.default<string>();
  relation_.add("a", "c");
  relation_.add("c", "d");
  relation_.add("d", "e");
  relation_.add("e", "c");
  relation_.add("b", "d");
  relation_.add("b", "e");
  const relation = relation_.freeze();

  expect(relation.minimal_scc_representative("a")).toBe("a");
  expect(relation.minimal_scc_representative("b")).toBe("b");
  expect(relation.minimal_scc_representative("c")).toBe("c");
  expect(relation.minimal_scc_representative("d")).toBe("c");
  expect(relation.minimal_scc_representative("e")).toBe("c");
});

// rustc: compiler/rustc_data_structures/src/transitive_relation/tests.rs:407 minimal_scc_representative_2
test("minimal_scc_representative_2", () => {
  // "digraph { a -> b; a -> a; b -> a; c -> c}",
  const relation_ = TransitiveRelationBuilder.default<string>();
  relation_.add("a", "b");
  relation_.add("b", "a");
  relation_.add("a", "a");
  relation_.add("c", "c");
  const relation = relation_.freeze();

  expect(relation.minimal_scc_representative("a")).toBe("a");
  expect(relation.minimal_scc_representative("b")).toBe("a");
  expect(relation.minimal_scc_representative("c")).toBe("c");
});
