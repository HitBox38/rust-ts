// Port of compiler/rustc_index/src/interval/tests.rs.
import { expect, test } from "bun:test";
import { range, range_contains, range_from, range_inclusive, range_iter, range_to, type RangeBounds } from "../idx.ts";
import { debug_IntervalSet, IntervalSet } from "../interval.ts";
import { PLAIN } from "../../std/fmt.ts";

// rustc: compiler/rustc_index/src/interval/tests.rs:4 insert_collapses
test("insert_collapses", () => {
  const set = IntervalSet.new<number>(10000);
  set.insert_range(range_inclusive(9831, 9837));
  set.insert_range(range_inclusive(43, 9830));
  expect([...set.iter_intervals()]).toEqual([{ start: 43, end: 9838 }]);
});

// rustc: compiler/rustc_index/src/interval/tests.rs:12 contains
test("contains", () => {
  const set = IntervalSet.new<number>(300);
  set.insert(0);
  expect(set.contains(0)).toBe(true);
  set.insert_range(range(0, 10));
  expect(set.contains(9)).toBe(true);
  expect(!set.contains(10)).toBe(true);
  set.insert_range(range(10, 11));
  expect(set.contains(10)).toBe(true);
});

// rustc: compiler/rustc_index/src/interval/tests.rs:24 insert
test("insert", () => {
  for (let i = 0; i < 30; i++) {
    const set = IntervalSet.new<number>(300);
    for (let j = i; j < 30; j++) {
      set.insert(j);
      for (let k = i; k < j; k++) {
        expect(set.contains(k)).toBe(true);
      }
    }
  }

  let set = IntervalSet.new<number>(300);
  set.insert_range(range(0, 1));
  expect(set.contains(0)).toBe(true);
  expect(!set.contains(1)).toBe(true);
  set.insert_range(range(1, 1));
  expect(set.contains(0)).toBe(true);
  expect(!set.contains(1)).toBe(true);

  set = IntervalSet.new<number>(300);
  set.insert_range(range(4, 5));
  set.insert_range(range(5, 10));
  expect([...set.iter()]).toEqual([4, 5, 6, 7, 8, 9]);
  set.insert_range(range(3, 7));
  expect([...set.iter()]).toEqual([3, 4, 5, 6, 7, 8, 9]);

  set = IntervalSet.new<number>(300);
  set.insert_range(range(0, 10));
  set.insert_range(range(3, 5));
  expect([...set.iter()]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  set = IntervalSet.new<number>(300);
  set.insert_range(range(0, 10));
  set.insert_range(range(0, 3));
  expect([...set.iter()]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  set = IntervalSet.new<number>(300);
  set.insert_range(range(0, 10));
  set.insert_range(range(0, 10));
  expect([...set.iter()]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  set = IntervalSet.new<number>(300);
  set.insert_range(range(0, 10));
  set.insert_range(range(5, 10));
  expect([...set.iter()]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  set = IntervalSet.new<number>(300);
  set.insert_range(range(0, 10));
  set.insert_range(range(5, 13));
  expect([...set.iter()]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

// rustc: compiler/rustc_index/src/interval/tests.rs:77 insert_range
test("insert_range", () => {
  // rustc: compiler/rustc_index/src/interval/tests.rs:79 check
  function check(r: RangeBounds<number>): void {
    const set = IntervalSet.new<number>(300);
    set.insert_range(r);
    for (const i of set.iter()) {
      expect(range_contains(r, i)).toBe(true);
    }
    for (const i of range_iter(r)) {
      if (!set.contains(i)) expect(`A: ${i} in ${debug_IntervalSet(set, PLAIN, "usize")}`).toBe("");
    }
    set.insert_range(r);
    for (const i of set.iter()) {
      if (!range_contains(r, i)) expect(`${i} in ${debug_IntervalSet(set, PLAIN, "usize")}`).toBe("");
    }
    for (const i of range_iter(r)) {
      if (!set.contains(i)) expect(`B: ${i} in ${debug_IntervalSet(set, PLAIN, "usize")}`).toBe("");
    }
  }
  check(range(10, 10));
  check(range(10, 100));
  check(range(10, 30));
  check(range(0, 5));
  check(range(0, 250));
  check(range(200, 250));

  check(range_inclusive(10, 10));
  check(range_inclusive(10, 100));
  check(range_inclusive(10, 30));
  check(range_inclusive(0, 5));
  check(range_inclusive(0, 250));
  check(range_inclusive(200, 250));

  for (let i = 0; i < 30; i++) {
    for (let j = i; j < 30; j++) {
      check(range(i, j));
      check(range_inclusive(i, j));
    }
  }
});

// rustc: compiler/rustc_index/src/interval/tests.rs:122 insert_range_dual
test("insert_range_dual", () => {
  const set = IntervalSet.new<number>(300);
  set.insert_range(range(0, 3));
  expect([...set.iter()]).toEqual([0, 1, 2]);
  set.insert_range(range(5, 7));
  expect([...set.iter()]).toEqual([0, 1, 2, 5, 6]);
  set.insert_range(range(3, 4));
  expect([...set.iter()]).toEqual([0, 1, 2, 3, 5, 6]);
  set.insert_range(range(3, 5));
  expect([...set.iter()]).toEqual([0, 1, 2, 3, 4, 5, 6]);
});

// rustc: compiler/rustc_index/src/interval/tests.rs:135 last_set_before_adjacent
test("last_set_before_adjacent", () => {
  const set = IntervalSet.new<number>(300);
  set.insert_range(range(0, 3));
  set.insert_range(range(3, 5));
  expect(set.last_set_in(range(0, 3))).toBe(2);
  expect(set.last_set_in(range(0, 5))).toBe(4);
  expect(set.last_set_in(range(3, 5))).toBe(4);
  set.insert_range(range(2, 5));
  expect(set.last_set_in(range(0, 3))).toBe(2);
  expect(set.last_set_in(range(0, 5))).toBe(4);
  expect(set.last_set_in(range(3, 5))).toBe(4);
});

// rustc: compiler/rustc_index/src/interval/tests.rs:149 last_set_in
test("last_set_in", () => {
  // rustc: compiler/rustc_index/src/interval/tests.rs:150 easy
  function easy(set: IntervalSet<number>, needle: RangeBounds<number>): number | undefined {
    let last_leq: number | undefined = undefined;
    for (const e of set.iter()) {
      if (range_contains(needle, e)) {
        last_leq = e;
      }
    }
    return last_leq;
  }

  // rustc: compiler/rustc_index/src/interval/tests.rs:161 cmp
  function cmp(set: IntervalSet<number>, needle: RangeBounds<number>): void {
    const got = set.last_set_in(needle);
    const want = easy(set, needle);
    if (got !== want) expect(`${JSON.stringify(needle)} in ${debug_IntervalSet(set, PLAIN, "usize")}: ${got}`).toBe(`${want}`);
  }
  let set = IntervalSet.new<number>(300);
  cmp(set, range_inclusive(50, 50));
  set.insert(64);
  cmp(set, range_inclusive(64, 64));
  set.insert(64 - 1);
  cmp(set, range_inclusive(0, 64 - 1));
  cmp(set, range_inclusive(0, 5));
  cmp(set, range(10, 100));
  set.insert(100);
  cmp(set, range(100, 110));
  cmp(set, range(99, 100));
  cmp(set, range_inclusive(99, 100));

  for (let i = 0; i <= 30; i++) {
    for (let j = i; j <= 30; j++) {
      for (let k = 0; k < 30; k++) {
        set = IntervalSet.new<number>(100);
        cmp(set, range_to(j));
        cmp(set, range_from(i));
        cmp(set, range(i, j));
        cmp(set, range_inclusive(i, j));
        set.insert(k);
        cmp(set, range_to(j));
        cmp(set, range_from(i));
        cmp(set, range(i, j));
        cmp(set, range_inclusive(i, j));
      }
    }
  }
});
