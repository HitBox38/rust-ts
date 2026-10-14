// rust-ts's own checks of sso/map.rs and sso/set.rs (upstream has no tests for them).
import { expect, test } from "bun:test";
import { debug_int, PLAIN } from "../../std/fmt.ts";
import { Panic } from "../../std/panic.ts";
import { FxHashMap, LAYOUT_U32, LAYOUT_UNIT, u32_key } from "../../rust_ts/hash_map.ts";
import { debug_SsoHashMap, debug_SsoHashSet, SsoHashMap, SsoHashSet } from "./mod.ts";

const new_map = (): SsoHashMap<number, number> => SsoHashMap.new(u32_key, LAYOUT_U32);

test("array storage: insertion order, swap_remove, Some/None results", () => {
  const m = new_map();
  for (const k of [5, 3, 9, 1]) expect(m.insert(k, k * 10)).toBe(undefined);
  expect(m.insert(3, 31)).toEqual({ $: "Some", _0: 30 });
  expect([...m.keys()]).toEqual([5, 3, 9, 1]);
  // `swap_remove`: the last pair takes the removed one's place.
  expect(m.remove(5)).toEqual({ $: "Some", _0: 50 });
  expect([...m.iter()]).toEqual([[1, 10], [3, 31], [9, 90]]);
  expect(m.remove(5)).toBe(undefined);
  expect(m.remove_entry(9)).toEqual([9, 90]);
  expect(m.capacity()).toBe(8);
  expect(debug_SsoHashMap(m, PLAIN, debug_int, debug_int)).toBe("{1: 10, 3: 31}");
  expect(m.index(3)).toBe(31);
  expect(() => m.index(4)).toThrow(Panic);
});

test("the ninth key switches to an FxHashMap built like `drain(..).collect()` + `insert`", () => {
  const m = new_map();
  const keys = [17, 4, 250, 3, 99, 1000, 8, 61, 12345];
  for (const k of keys) m.insert(k, k + 1);
  expect(m.repr.$).toBe("Map");
  const expected = FxHashMap.from_iter<number, number>(
    keys.slice(0, 8).map((k) => [k, k + 1] as const),
    8,
    u32_key,
    LAYOUT_U32,
  );
  expected.set(12345, 12346);
  expect([...m.iter()]).toEqual([...expected.entries()]);
  expect(m.capacity()).toBe(expected.capacity());
  // `shrink_to_fit` goes back to an array once at most 8 entries are left, in map order.
  m.remove(17);
  const order = [...m.keys()];
  m.shrink_to_fit();
  expect(m.repr.$).toBe("Array");
  expect([...m.keys()]).toEqual(order);
});

test("get_mut / entry / values_mut write through, in both representations", () => {
  for (const n of [3, 20]) {
    const m = new_map();
    for (let k = 0; k < n; k++) m.insert(k, 0);
    m.get_mut(1)!.value = 7;
    expect(m.get(1)).toBe(7);
    const e = m.entry(2).or_insert(5);
    expect(e.value).toBe(0);
    e.value = 9;
    expect(m.get(2)).toBe(9);
    expect(m.entry(100).or_insert_with(() => 4).value).toBe(4);
    m.entry(100).and_modify((v) => (v.value += 1));
    expect(m.index(100)).toBe(5);
    for (const v of m.values_mut()) v.value += 1;
    expect(m.get(1)).toBe(8);
    expect([...m.values()]).toEqual([...m.iter()].map(([, v]) => v));
  }
});

test("entry on a full array migrates first", () => {
  const m = new_map();
  for (let k = 0; k < 8; k++) m.insert(k, k);
  expect(m.entry(3).or_insert(0).value).toBe(3);
  expect(m.repr.$).toBe("Map");
});

test("reserve beyond the array size switches to a map", () => {
  const m = new_map();
  m.insert(1, 1);
  m.reserve(7);
  expect(m.repr.$).toBe("Array");
  m.reserve(8);
  expect(m.repr.$).toBe("Map");
  expect(m.get(1)).toBe(1);
  expect(SsoHashMap.with_capacity<number, number>(9, u32_key, LAYOUT_U32).repr.$).toBe("Map");
});

test("SsoHashSet", () => {
  const s = SsoHashSet.new(u32_key);
  expect(s.insert(4)).toBe(true);
  expect(s.insert(4)).toBe(false);
  expect(s.insert(2)).toBe(true);
  expect(s.contains(2)).toBe(true);
  expect(s.get(2)).toBe(2);
  expect(debug_SsoHashSet(s, PLAIN, debug_int)).toBe("{4, 2}");
  expect(s.remove(4)).toBe(true);
  expect(s.remove(4)).toBe(false);
  expect(s.take(2)).toBe(2);
  expect(s.is_empty()).toBe(true);
  const big = SsoHashSet.from_iter([...Array(12).keys()], 12, u32_key);
  expect(big.map.repr.$).toBe("Map");
  big.retain((t) => t % 2 === 0);
  expect([...big.iter()].sort((a, b) => a - b)).toEqual([0, 2, 4, 6, 8, 10]);
  expect([...big.drain()].length).toBe(6);
  expect(big.len()).toBe(0);
  expect(LAYOUT_UNIT.size).toBe(0);
});
