// Tests for src/std/slice.ts. Expectations from a scratch program built with the pinned nightly
// (rustc 1.101.0-nightly 6f5da406b):
//   for v in vs { println!("{:?} {} {:?}", v, v.partition_point(|&x| x == 1), v.binary_search_by(|&x| x.cmp(&1))) }
// Non-partitioned / unsorted inputs are included on purpose: the result then depends on core's
// exact probe sequence.
import { expect, test } from "bun:test";
import { Panic } from "./panic.ts";
import { binary_search_by, extend, partition_point, slice_from, slice_to, splice } from "./slice.ts";

// [v, partition_point(|x| x == 1), binary_search_by(|x| x.cmp(&1)) is Ok, its index]
const CASES: [number[], number, boolean, number][] = [
  [[], 0, false, 0],
  [[1], 1, true, 0],
  [[0], 0, false, 1],
  [[1, 1, 1, 0, 0], 3, false, 5],
  [[1, 0, 1, 0, 1, 0, 1], 3, true, 6],
  [[0, 1, 1, 1, 1, 1, 1, 1], 8, true, 7],
  [[1, 1, 1, 1, 1, 1, 1, 0], 7, false, 8],
  [[0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1], 9, true, 10],
  [[2, 0, 1, 2, 0, 0, 1, 2], 3, true, 6],
  [[0, 0, 0, 2, 2, 2], 0, false, 3],
  [[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0], 16, false, 19],
];

test("partition_point / binary_search_by match core (oracle)", () => {
  for (const [v, pp, ok, i] of CASES) {
    expect(partition_point(v, (x) => x === 1)).toBe(pp);
    expect(binary_search_by(v, (x) => (x < 1 ? -1 : x > 1 ? 1 : 0))).toEqual({ ok, i });
  }
});

test("extend / splice", () => {
  const v = [1, 2, 3];
  extend(v, [4, 5]);
  expect(v).toEqual([1, 2, 3, 4, 5]);
  splice(v, 1, 2, [9, 9, 9]);
  expect(v).toEqual([1, 9, 9, 9, 4, 5]);
  splice(v, 6, 0, [7]);
  expect(v).toEqual([1, 9, 9, 9, 4, 5, 7]);
  // core::slice::index::slice_index_fail texts
  expect(() => splice(v, 5, 3, [])).toThrow("range end index 8 out of range for slice of length 7");
  // Large inputs: no argument-spread `RangeError`.
  const big: number[] = [];
  extend(big, new Array<number>(1_000_000).fill(0));
  expect(big.length).toBe(1_000_000);
});

test("slice_to / slice_from: Rust's range-index panics, wrapped usize ends printed as u64", () => {
  expect(slice_to([1, 2, 3], 2)).toEqual([1, 2]);
  expect(slice_from([1, 2, 3], 3)).toEqual([]);
  expect(() => slice_to([1, 2, 3], 4)).toThrow(new Panic("range end index 4 out of range for slice of length 3"));
  expect(() => slice_to([1], 1 - 2)).toThrow(new Panic("range end index 18446744073709551615 out of range for slice of length 1"));
  expect(() => slice_from([1, 2], 3)).toThrow(new Panic("range start index 3 out of range for slice of length 2"));
});
