// Port of compiler/rustc_data_structures/src/union_find/tests.rs
import { expect, test } from "bun:test";
import { UnionFind } from "../union_find.ts";

// rustc: compiler/rustc_data_structures/src/union_find/tests.rs:4 empty
test("empty", () => {
  const sets = UnionFind.new<number>(10);

  for (let i = 1; i < 10; i++) {
    expect(sets.find(i)).toBe(i);
  }
});

// rustc: compiler/rustc_data_structures/src/union_find/tests.rs:13 transitive
test("transitive", () => {
  const sets = UnionFind.new<number>(10);

  sets.unify(3, 7);
  sets.unify(4, 2);

  expect(sets.find(7)).toBe(sets.find(3));
  expect(sets.find(2)).toBe(sets.find(4));
  expect(sets.find(3)).not.toBe(sets.find(4));

  sets.unify(7, 4);

  expect(sets.find(7)).toBe(sets.find(3));
  expect(sets.find(2)).toBe(sets.find(4));
  expect(sets.find(3)).toBe(sets.find(4));

  for (const i of [0, 1, 5, 6, 8, 9]) {
    expect(sets.find(i)).toBe(i);
  }
});
