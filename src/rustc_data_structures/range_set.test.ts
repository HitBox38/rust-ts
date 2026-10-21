// Unit tests of rustc_data_structures range_set.ts (lane abi-layout-b; upstream has no tests for range_set.rs).
// Expectations follow the upstream algorithm by hand, over `u64`-like numbers.
import { expect, test } from "bun:test";
import { RangeSet, type RangeSetOps } from "./range_set.ts";

const NUM: RangeSetOps<number> = {
  default_: () => 0,
  cmp: (a, b) => a - b,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
};

test("add_range keeps sorted, disjoint, non-adjacent (offset, size) pairs", () => {
  const s = RangeSet.new(NUM);
  s.add_range(0, 4);
  s.add_range(8, 4);
  expect(s._0).toEqual([
    [0, 4],
    [8, 4],
  ]);
  // adjacent on both sides: merges all three
  s.add_range(4, 4);
  expect(s._0).toEqual([[0, 12]]);
  // empty ranges are not tracked
  s.add_range(20, 0);
  expect(s._0).toEqual([[0, 12]]);
  s.add_range(14, 2);
  // inserted before an existing element
  s.add_range(13, 0);
  s.add_range(-5, 2);
  expect(s._0).toEqual([
    [-5, 2],
    [0, 12],
    [14, 2],
  ]);
});

test("difference carves the other set out (upstream pushes (start, end) pairs)", () => {
  const a = RangeSet.new(NUM);
  a.add_range(0, 12);
  a.add_range(14, 2);
  const b = RangeSet.new(NUM);
  b.add_range(2, 3);
  expect(a.difference(b)._0).toEqual([
    [0, 2],
    [5, 12],
    [14, 16],
  ]);
  expect(a.difference(RangeSet.new(NUM))._0).toEqual([
    [0, 12],
    [14, 16],
  ]);
});
