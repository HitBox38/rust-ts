// Lane perf-near-limit: the interners' lookup without key strings. A hash only picks the bucket, so values that collide stay apart.
import { expect, test } from "bun:test";
import { ShardedHashMap } from "./sharded.ts";

interface Boxed {
  readonly v: unknown;
}
const set = (): ShardedHashMap<Boxed, null> => ShardedHashMap.with_capacity<Boxed, null>(0);
const value_of = (b: Boxed): unknown => b.v;

test("intern_value: one object per value; values that collide stay apart and each is found again", () => {
  const s = set();
  // Fields hash as a sum, so these two have one hash.
  const [a, b] = [{ x: 1, y: 2 }, { x: 2, y: 1 }];
  const ia = s.intern_value<unknown>(a, value_of, (v) => ({ v }));
  const ib = s.intern_value<unknown>(b, value_of, (v) => ({ v }));
  expect(ia).not.toBe(ib);
  expect(s.len()).toBe(2);
  expect(s.intern_value<unknown>({ y: 2, x: 1 }, value_of, () => expect.unreachable() as never)).toBe(ia);
  expect(s.intern_value<unknown>({ y: 1, x: 2 }, value_of, () => expect.unreachable() as never)).toBe(ib);
  expect(s.len()).toBe(2);
  // A third in the same bucket, found behind the first.
  const c = { x: 3, y: 0 };
  expect(s.intern_value<unknown>(c, value_of, (v) => ({ v })).v).toBe(c);
  expect(s.len()).toBe(3);
});

test("intern_value rejects what intern_key rejects, before making anything", () => {
  const s = set();
  expect(() => s.intern_value<unknown>({ a: new Map() }, value_of, () => expect.unreachable() as never)).toThrow("intern_key: a Map/Set inside an intern key");
  expect(() => s.intern_value<unknown>([() => 0], value_of, () => expect.unreachable() as never)).toThrow("intern_key: a function inside an intern key");
  expect(s.len()).toBe(0);
});

test("intern_slice: element-wise, so a list and an array with the same elements are one value", () => {
  class List extends Array<number> {}
  const s = ShardedHashMap.with_capacity<readonly number[], null>(0);
  const make = (v: readonly number[]) => (): readonly number[] => List.from(v);
  const first = s.intern_slice<number>([1, 2], make([1, 2]));
  expect(s.intern_slice<number>(first, () => expect.unreachable() as never)).toBe(first);
  expect(s.intern_slice<number>([1, 2], () => expect.unreachable() as never)).toBe(first);
  expect(s.intern_slice<number>([2, 1], make([2, 1]))).not.toBe(first);
  expect(s.len()).toBe(2);
});
