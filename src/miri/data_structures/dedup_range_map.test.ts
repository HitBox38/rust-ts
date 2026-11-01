// Port of the `#[cfg(test)] mod tests` of src/tools/miri/src/data_structures/dedup_range_map.rs:245 (lane miri-driver).
import { expect, test } from "bun:test";
import { Size } from "../../rustc_abi/lib.ts";
import { Panic } from "../../std/panic.ts";
import "../lib.ts";
import { DedupRangeMap } from "./dedup_range_map.ts";

const clone_i32 = (v: number): number => v;
const eq_i32 = (a: number, b: number): boolean => a === b;

/// Query the map at every offset in the range and collect the results.
// rustc: src/tools/miri/src/data_structures/dedup_range_map.rs:249 to_vec
function to_vec(map: DedupRangeMap<number>, offset: number, len: number): number[] {
  const out: number[] = [];
  for (let i = offset; i < offset + len; i++) {
    const first = map.iter(Size.from_bytes(i), Size.from_bytes(1))[0];
    if (first === undefined) throw new Error("called `Option::unwrap()` on a `None` value");
    out.push(first[1]);
  }
  return out;
}

// rustc: src/tools/miri/src/data_structures/dedup_range_map.rs:258 basic_insert
test("basic_insert", () => {
  const map = DedupRangeMap.new<number>(Size.from_bytes(20), -1);
  // Insert.
  for (const [, , x] of map.iter_mut(Size.from_bytes(10), Size.from_bytes(1), clone_i32, eq_i32)) {
    x.data = 42;
  }
  // Check.
  expect(to_vec(map, 10, 1)).toEqual([42]);
  expect(map.v.length).toBe(3);

  // Insert with size 0.
  for (const [, , x] of map.iter_mut(Size.from_bytes(10), Size.from_bytes(0), clone_i32, eq_i32)) {
    x.data = 19;
  }
  for (const [, , x] of map.iter_mut(Size.from_bytes(11), Size.from_bytes(0), clone_i32, eq_i32)) {
    x.data = 19;
  }
  expect(to_vec(map, 10, 2)).toEqual([42, -1]);
  expect(map.v.length).toBe(3);
});

// rustc: src/tools/miri/src/data_structures/dedup_range_map.rs:280 gaps
test("gaps", () => {
  const map = DedupRangeMap.new<number>(Size.from_bytes(20), -1);
  for (const [, , x] of map.iter_mut(Size.from_bytes(11), Size.from_bytes(1), clone_i32, eq_i32)) {
    x.data = 42;
  }
  for (const [, , x] of map.iter_mut(Size.from_bytes(15), Size.from_bytes(1), clone_i32, eq_i32)) {
    x.data = 43;
  }
  expect(map.v.length).toBe(5);
  expect(to_vec(map, 10, 10)).toEqual([-1, 42, -1, -1, -1, 43, -1, -1, -1, -1]);

  for (const [, v, x] of map.iter_mut(Size.from_bytes(10), Size.from_bytes(10), clone_i32, eq_i32)) {
    if (v < 42) {
      x.data = 23;
    }
  }
  expect(map.v.length).toBe(6);
  expect(to_vec(map, 10, 10)).toEqual([23, 42, 23, 23, 23, 43, 23, 23, 23, 23]);
  expect(to_vec(map, 13, 5)).toEqual([23, 23, 43, 23, 23]);

  for (const [, , x] of map.iter_mut(Size.from_bytes(15), Size.from_bytes(5), clone_i32, eq_i32)) {
    x.data = 19;
  }
  expect(map.v.length).toBe(6);
  expect(to_vec(map, 10, 10)).toEqual([23, 42, 23, 23, 23, 19, 19, 19, 19, 19]);
  // Should be seeing two blocks with 19.
  expect(map.iter(Size.from_bytes(15), Size.from_bytes(2)).map(([, t]) => t)).toEqual([19, 19]);

  // A NOP `iter_mut` should trigger merging.
  map.iter_mut(Size.from_bytes(15), Size.from_bytes(5), clone_i32, eq_i32);
  expect(map.v.length).toBe(5);
  expect(to_vec(map, 10, 10)).toEqual([23, 42, 23, 23, 23, 19, 19, 19, 19, 19]);
});

// #[should_panic]
// rustc: src/tools/miri/src/data_structures/dedup_range_map.rs:321 out_of_range_iter_mut
test("out_of_range_iter_mut", () => {
  const map = DedupRangeMap.new<number>(Size.from_bytes(20), -1);
  expect(() => map.iter_mut(Size.from_bytes(11), Size.from_bytes(11), clone_i32, eq_i32)).toThrow(Panic);
});

// #[should_panic]
// rustc: src/tools/miri/src/data_structures/dedup_range_map.rs:328 out_of_range_iter
test("out_of_range_iter", () => {
  const map = DedupRangeMap.new<number>(Size.from_bytes(20), -1);
  expect(() => map.iter(Size.from_bytes(11), Size.from_bytes(11))).toThrow(Panic);
});

// rustc: src/tools/miri/src/data_structures/dedup_range_map.rs:334 empty_map_iter
test("empty_map_iter", () => {
  const map = DedupRangeMap.new<number>(Size.from_bytes(0), -1);
  map.iter(Size.from_bytes(0), Size.from_bytes(0));
});

// rustc: src/tools/miri/src/data_structures/dedup_range_map.rs:340 empty_map_iter_mut
test("empty_map_iter_mut", () => {
  const map = DedupRangeMap.new<number>(Size.from_bytes(0), -1);
  map.iter_mut(Size.from_bytes(0), Size.from_bytes(0), clone_i32, eq_i32);
});

// Not upstream (lane miri-driver): `merge_adjacent_thorough` and the value-semantics of yielded ranges.
test("merge_adjacent_thorough + yielded ranges are values", () => {
  const map = DedupRangeMap.new<number>(Size.from_bytes(8), 0);
  for (const [, , x] of map.iter_mut(Size.from_bytes(2), Size.from_bytes(2), clone_i32, eq_i32)) x.data = 1;
  const ranges = map.iter_all().map(([r]) => r);
  expect(ranges).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 8 }]);
  for (const [, , x] of map.iter_mut_all()) x.data = 5;
  map.merge_adjacent_thorough(eq_i32);
  expect(map.v.length).toBe(1);
  expect(map.size().bytes()).toBe(8);
  // The ranges collected before the merge are unchanged.
  expect(ranges).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 8 }]);
});

// Not upstream (review miri-driver, finding 5): with an object-valued `T`, a split clones the element (`self.v[idx].data
// .clone()`, dedup_range_map.rs:123), so mutating one half in place leaves the other half untouched.
test("object-valued data: split halves do not share a value", () => {
  type Obj = { tags: number[] };
  const clone_obj = (v: Obj): Obj => ({ tags: [...v.tags] });
  const eq_obj = (a: Obj, b: Obj): boolean => a.tags.length === b.tags.length && a.tags.every((t, i) => t === b.tags[i]);
  const map = DedupRangeMap.new<Obj>(Size.from_bytes(20), { tags: [0] });
  // Mutate [5, 10) in place (as Stacked Borrows mutates a `Stack`): splits at 5 and at 10.
  for (const [, data] of map.iter_mut(Size.from_bytes(5), Size.from_bytes(5), clone_obj, eq_obj)) {
    data.tags.push(1);
  }
  const at = (i: number): number[] => map.iter(Size.from_bytes(i), Size.from_bytes(1))[0]![1].tags;
  expect(map.v.length).toBe(3);
  expect([at(0), at(5), at(9), at(10), at(19)]).toEqual([[0], [0, 1], [0, 1], [0], [0]]);
  const datas = map.v.map((e) => e.data);
  expect(new Set(datas).size).toBe(3);
  // Mutating [10, 20) again in place: the first two parts keep their values.
  for (const [, data] of map.iter_mut(Size.from_bytes(10), Size.from_bytes(10), clone_obj, eq_obj)) {
    data.tags.push(2);
  }
  expect([at(0), at(5), at(10), at(19)]).toEqual([[0], [0, 1], [0, 2], [0, 2]]);
  // Equal values (structurally, `eq_T`) of adjacent parts merge again: [5, 20) all become `[0, 1]`.
  for (const [, , elem] of map.iter_mut(Size.from_bytes(10), Size.from_bytes(10), clone_obj, eq_obj)) {
    elem.data = { tags: [0, 1] };
  }
  for (const _ of map.iter_mut(Size.from_bytes(0), Size.from_bytes(20), clone_obj, eq_obj)) {
    // `iter_mut` merges equal neighbours as it scans
  }
  expect(map.v.map((e) => [e.range.start, e.range.end, e.data.tags])).toEqual([
    [0, 5, [0]],
    [5, 20, [0, 1]],
  ]);
});
