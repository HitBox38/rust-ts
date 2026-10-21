// Port of compiler/rustc_data_structures/src/sorted_map/tests.rs
// PORT: keys are `usize`/`u32` numbers ordered by `num_cmp`; `SortedMap`'s derived `PartialEq` is `toEqual` on `data`.
import { expect, test } from "bun:test";
import { range, SortedIndexMultiMap, SortedMap } from "../sorted_map.ts";

const num_cmp = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);

// rustc: compiler/rustc_data_structures/src/sorted_map/tests.rs:4 test_sorted_index_multi_map
test("test_sorted_index_multi_map", () => {
  const entries: [number, number][] = [
    [2, 0],
    [1, 0],
    [2, 1],
    [3, 0],
    [2, 2],
  ];
  const set = SortedIndexMultiMap.from_iter<number, number, number>(
    entries.map(([k, v]) => [k, v]),
    num_cmp,
  );

  // Insertion order is preserved.
  expect([...set.iter()]).toEqual(entries);

  // Indexing
  for (let i = 0; i < entries.length; i++) {
    const expect_ = entries[i]!;
    expect(set.index(i)).toBe(expect_[1]);
  }

  // `get_by_key` works.
  expect([...set.get_by_key(3)]).toEqual([0]);
  expect(set.get_by_key(4).next().done).toBe(true);

  // `contains_key` works
  expect(set.contains_key(3)).toBe(true);
  expect(set.contains_key(4)).toBe(false);

  // `get_by_key` returns items in insertion order.
  const twos = [...set.get_by_key_enumerated(2)];
  const idxs: number[] = twos.map(([i, _]) => i);
  const values: number[] = twos.map(([_, v]) => v);

  expect(idxs).toEqual([0, 2, 4]);
  expect(values).toEqual([0, 1, 2]);
});

// rustc: compiler/rustc_data_structures/src/sorted_map/tests.rs:34 test_insert_and_iter
test("test_insert_and_iter", () => {
  const map = SortedMap.new<number, number>(num_cmp);
  const expected: [number, number][] = [];

  for (let x0 = 0; x0 < 100; x0++) {
    expect(map.iter().map(([k, v]) => [k, v])).toEqual(expected);

    const x = 1000 - x0 * 2;
    map.insert(x, x);
    expected.unshift([x, x]);
  }
});

// rustc: compiler/rustc_data_structures/src/sorted_map/tests.rs:48 test_get_and_index
test("test_get_and_index", () => {
  const map = SortedMap.new<number, number>(num_cmp);
  const expected: number[] = [];

  for (let x0 = 0; x0 < 100; x0++) {
    const x = 1000 - x0;
    if ((x & 1) === 0) {
      map.insert(x, x);
    }
    expected.push(x);
  }

  for (const x of expected) {
    if ((x & 1) === 0) {
      expect(map.get(x)).toBe(x);
      expect(map.get_mut(x)).toBe(x);
      expect(map.index(x)).toBe(x);
      expect(map.index_mut(x)).toBe(x);
    } else {
      expect(map.get(x)).toBe(undefined);
      expect(map.get_mut(x)).toBe(undefined);
    }
  }
});

// rustc: compiler/rustc_data_structures/src/sorted_map/tests.rs:74 test_range
test("test_range", () => {
  const map = SortedMap.new<number, number>(num_cmp);
  map.insert(1, 1);
  map.insert(3, 3);
  map.insert(6, 6);
  map.insert(9, 9);

  const keys = (s: readonly (readonly [number, number])[]): number[] => s.map((e) => e[0]);

  for (let start = 0; start < 11; start++) {
    for (let end = 0; end < 11; end++) {
      if (end < start) {
        continue;
      }

      const expected = [1, 3, 6, 9].filter((x) => x >= start && x < end);

      expect(keys(map.range(range(start, end)))).toEqual(expected);
    }
  }
});

// rustc: compiler/rustc_data_structures/src/sorted_map/tests.rs:98 test_offset_keys
test("test_offset_keys", () => {
  const map = SortedMap.new<number, number>(num_cmp);
  map.insert(1, 1);
  map.insert(3, 3);
  map.insert(6, 6);

  map.offset_keys((k) => {
    k.value += 1;
  });

  const expected = SortedMap.new<number, number>(num_cmp);
  expected.insert(2, 1);
  expected.insert(4, 3);
  expected.insert(7, 6);

  expect(map.data).toEqual(expected.data);
});

// rustc: compiler/rustc_data_structures/src/sorted_map/tests.rs:114 keys
function keys(s: SortedMap<number, number>): number[] {
  return s.into_iter().map(([k, _]) => k);
}

// rustc: compiler/rustc_data_structures/src/sorted_map/tests.rs:118 elements
function elements(s: SortedMap<number, number>): [number, number][] {
  return s.into_iter();
}

/** `#[derive(Clone)]` of `SortedMap<u32, u32>`. */
function clone(s: SortedMap<number, number>): SortedMap<number, number> {
  return new SortedMap(s.data.map(([k, v]) => [k, v]), s.cmp);
}

// rustc: compiler/rustc_data_structures/src/sorted_map/tests.rs:123 test_remove_range
test("test_remove_range", () => {
  const map = SortedMap.new<number, number>(num_cmp);
  map.insert(1, 1);
  map.insert(3, 3);
  map.insert(6, 6);
  map.insert(9, 9);

  for (let start = 0; start < 11; start++) {
    for (let end = 0; end < 11; end++) {
      if (end < start) {
        continue;
      }

      const expected = [1, 3, 6, 9].filter((x) => x < start || x >= end);

      const map2 = clone(map);
      map2.remove_range(range(start, end));

      expect(keys(map2)).toEqual(expected);
    }
  }
});

// rustc: compiler/rustc_data_structures/src/sorted_map/tests.rs:148 test_remove
test("test_remove", () => {
  const map = SortedMap.new<number, number>(num_cmp);
  const expected: [number, number][] = [];

  for (let x = 0; x < 10; x++) {
    map.insert(x, x);
    expected.push([x, x]);
  }

  for (let x = 0; x < 10; x++) {
    const map2 = clone(map);
    const expected2 = expected.map(([a, b]): [number, number] => [a, b]);

    expect(map2.remove(x)).toBe(x);
    expected2.splice(x, 1);

    expect(map2.iter().map(([k, v]) => [k, v])).toEqual(expected2);
  }
});

// rustc: compiler/rustc_data_structures/src/sorted_map/tests.rs:169 test_insert_presorted_non_overlapping
test("test_insert_presorted_non_overlapping", () => {
  const map = SortedMap.new<number, number>(num_cmp);
  map.insert(2, 0);
  map.insert(8, 0);

  map.insert_presorted([
    [3, 0],
    [7, 0],
  ]);

  const expected = [2, 3, 7, 8];
  expect(keys(map)).toEqual(expected);
});

// rustc: compiler/rustc_data_structures/src/sorted_map/tests.rs:181 test_insert_presorted_first_elem_equal
test("test_insert_presorted_first_elem_equal", () => {
  const map = SortedMap.new<number, number>(num_cmp);
  map.insert(2, 2);
  map.insert(8, 8);

  map.insert_presorted([
    [2, 0],
    [7, 7],
  ]);

  const expected: [number, number][] = [
    [2, 0],
    [7, 7],
    [8, 8],
  ];
  expect(elements(map)).toEqual(expected);
});

// rustc: compiler/rustc_data_structures/src/sorted_map/tests.rs:193 test_insert_presorted_last_elem_equal
test("test_insert_presorted_last_elem_equal", () => {
  const map = SortedMap.new<number, number>(num_cmp);
  map.insert(2, 2);
  map.insert(8, 8);

  map.insert_presorted([
    [3, 3],
    [8, 0],
  ]);

  const expected: [number, number][] = [
    [2, 2],
    [3, 3],
    [8, 0],
  ];
  expect(elements(map)).toEqual(expected);
});

// rustc: compiler/rustc_data_structures/src/sorted_map/tests.rs:205 test_insert_presorted_shuffle
test("test_insert_presorted_shuffle", () => {
  const map = SortedMap.new<number, number>(num_cmp);
  map.insert(2, 2);
  map.insert(7, 7);

  map.insert_presorted([
    [1, 1],
    [3, 3],
    [8, 8],
  ]);

  const expected: [number, number][] = [
    [1, 1],
    [2, 2],
    [3, 3],
    [7, 7],
    [8, 8],
  ];
  expect(elements(map)).toEqual(expected);
});

// rustc: compiler/rustc_data_structures/src/sorted_map/tests.rs:217 test_insert_presorted_at_end
test("test_insert_presorted_at_end", () => {
  const map = SortedMap.new<number, number>(num_cmp);
  map.insert(1, 1);
  map.insert(2, 2);

  map.insert_presorted([
    [3, 3],
    [8, 8],
  ]);

  const expected: [number, number][] = [
    [1, 1],
    [2, 2],
    [3, 3],
    [8, 8],
  ];
  expect(elements(map)).toEqual(expected);
});
