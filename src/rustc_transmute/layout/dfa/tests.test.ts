// compiler/rustc_transmute/src/layout/dfa/tests.rs.
import { expect, test } from "bun:test";
// Init order: rustc_middle's crate root first (as the driver loads it), then this crate.
import "../../../rustc_middle/lib.ts";
import { debug_Dfa, Dfa, EdgeSet, union, type UnionItem } from "../dfa.ts";
import { Byte, clone_Byte, debug_Byte } from "../mod.ts";
import { PLAIN, type Debug } from "../../../std/fmt.ts";

/** `bytes(range: Range<u16>)`: `a..b` is `(a, b)`. */
// rustc: compiler/rustc_transmute/src/layout/dfa/tests.rs:5 bytes
function bytes(start: number, end: number): Byte {
  return new Byte(start, end);
}

/** `{:?}` of the union items (for `assert_eq!` on vectors). */
function show(items: readonly UnionItem<number>[]): string[] {
  const o = (v: number | undefined): string => (v === undefined ? "None" : `Some(${v})`);
  return items.map(([b, [x, y]]) => `(${debug_Byte(b, PLAIN)}, (${o(x)}, ${o(y)}))`);
}

// rustc: compiler/rustc_transmute/src/layout/dfa/tests.rs:9 assert_union
function assert_union(xs: readonly [Byte, number][], ys: readonly [Byte, number][], expected: readonly UnionItem<number>[]): void {
  // `xs.iter().copied()`
  const copied = (v: readonly [Byte, number][]): Iterator<[Byte, number]> => v.map(([b, s]): [Byte, number] => [clone_Byte(b), s])[Symbol.iterator]();
  const actual = [...union(copied(xs), copied(ys))];
  expect(show(actual)).toEqual(show(expected));

  const actual2 = [...union(copied(ys), copied(xs))];
  const expected2 = expected.map(([range, [x, y]]): UnionItem<number> => [range, [y, x]]);
  expect(show(actual2)).toEqual(show(expected2));
}

// rustc: compiler/rustc_transmute/src/layout/dfa/tests.rs:23 union_empty_inputs
test("union_empty_inputs", () => {
  assert_union([], [], []);
  assert_union(
    [
      [bytes(1, 3), 1],
      [bytes(5, 7), 2],
    ],
    [],
    [
      [bytes(1, 3), [1, undefined]],
      [bytes(5, 7), [2, undefined]],
    ],
  );
});

// rustc: compiler/rustc_transmute/src/layout/dfa/tests.rs:33 union_disjoint_and_adjacent_ranges
test("union_disjoint_and_adjacent_ranges", () => {
  assert_union(
    [
      [bytes(1, 3), 1],
      [bytes(6, 8), 2],
    ],
    [
      [bytes(3, 5), 3],
      [bytes(8, 9), 4],
    ],
    [
      [bytes(1, 3), [1, undefined]],
      [bytes(3, 5), [undefined, 3]],
      [bytes(6, 8), [2, undefined]],
      [bytes(8, 9), [undefined, 4]],
    ],
  );
});

// rustc: compiler/rustc_transmute/src/layout/dfa/tests.rs:47 union_equal_ranges
test("union_equal_ranges", () => {
  assert_union([[bytes(1, 4), 1]], [[bytes(1, 4), 2]], [[bytes(1, 4), [1, 2]]]);
});

// rustc: compiler/rustc_transmute/src/layout/dfa/tests.rs:52 union_partially_overlapping_ranges
test("union_partially_overlapping_ranges", () => {
  assert_union(
    [[bytes(1, 4), 1]],
    [[bytes(3, 6), 2]],
    [
      [bytes(1, 3), [1, undefined]],
      [bytes(3, 4), [1, 2]],
      [bytes(4, 6), [undefined, 2]],
    ],
  );
});

// rustc: compiler/rustc_transmute/src/layout/dfa/tests.rs:65 union_contained_ranges
test("union_contained_ranges", () => {
  assert_union(
    [[bytes(0, 8), 1]],
    [
      [bytes(2, 4), 2],
      [bytes(4, 6), 3],
    ],
    [
      [bytes(0, 2), [1, undefined]],
      [bytes(2, 4), [1, 2]],
      [bytes(4, 6), [1, 3]],
      [bytes(6, 8), [1, undefined]],
    ],
  );
});

// rustc: compiler/rustc_transmute/src/layout/dfa/tests.rs:79 union_matching_starts_and_ends
test("union_matching_starts_and_ends", () => {
  assert_union(
    [
      [bytes(0, 4), 1],
      [bytes(6, 10), 2],
    ],
    [
      [bytes(0, 2), 3],
      [bytes(8, 10), 4],
    ],
    [
      [bytes(0, 2), [1, 3]],
      [bytes(2, 4), [1, undefined]],
      [bytes(6, 8), [2, undefined]],
      [bytes(8, 10), [2, 4]],
    ],
  );
});

// rustc: compiler/rustc_transmute/src/layout/dfa/tests.rs:93 union_uninit_boundary
test("union_uninit_boundary", () => {
  const uninit = Byte.UNINIT;
  assert_union(
    [[Byte.uninit(), 1]],
    [
      [bytes(255, uninit), 2],
      [bytes(uninit, uninit + 1), 3],
    ],
    [
      [bytes(0, 255), [1, undefined]],
      [bytes(255, uninit), [1, 2]],
      [bytes(uninit, uninit + 1), [1, 3]],
    ],
  );
});

// rustc: compiler/rustc_transmute/src/layout/dfa/tests.rs:107 edge_set_union_coalesces_only_adjacent_ranges_with_equal_destinations
test("edge_set_union_coalesces_only_adjacent_ranges_with_equal_destinations", () => {
  const xs = EdgeSet.from_edges<number>([
    [bytes(0, 4), 1],
    [bytes(8, 10), 1],
  ]);
  const ys = EdgeSet.from_edges<number>([
    [bytes(2, 6), 2],
    [bytes(10, 12), 3],
  ]);
  const merged = xs.union(ys, (_, y) => (y === 3 ? 8 : 7));

  expect(show([...merged.iter()].map(([b, s]): UnionItem<number> => [b, [s, undefined]]))).toEqual(
    show([
      [bytes(0, 6), [7, undefined]],
      [bytes(8, 10), [7, undefined]],
      [bytes(10, 12), [8, undefined]],
    ]),
  );
});

// rustc: compiler/rustc_transmute/src/layout/dfa/tests.rs:119 dot_distinguishes_start_and_accept
test("dot_distinguishes_start_and_accept", () => {
  const never_debug: Debug<never> = () => "!";
  for (const dfa of [Dfa.from_edges<never, never>(0, 1, [[0, 0, 1]]), Dfa.unit<never, never>()]) {
    const dot = debug_Dfa(dfa, PLAIN, never_debug, never_debug);
    const lines = dot.split("\n").filter((l, i, a) => i < a.length - 1 || l !== "");
    expect(lines.some((line) => line === "    start [shape = point, style = invis]")).toBe(true);
    const start_edge = `    start -> S_${dfa.start}`;
    expect(lines.some((line) => line === start_edge)).toBe(true);

    const accept_marker = `    S_${dfa.accept} [shape = doublecircle]`;
    const accept_markers = lines.filter((line) => line.includes("doublecircle"));
    expect(accept_markers).toEqual([accept_marker]);
  }
});
