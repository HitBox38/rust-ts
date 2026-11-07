// Lane perf-near-limit: the interners' lookup without key strings. A hash only picks the bucket, so values that collide stay apart.
import { expect, test } from "bun:test";
import { INTERNED } from "./intern.ts";
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

// Lane perf-heavy: `share_elements`.
test("share_elements: a new list holds the element objects earlier lists of its table hold, and only where value_eq", () => {
  const INTERNED_STUB = { [INTERNED]: true, id: 7 } as const;
  const s = ShardedHashMap.with_capacity<readonly unknown[], null>(0);
  s.share_elements();
  const make = (w: readonly unknown[]): readonly unknown[] => Object.freeze([...w]);
  const a = { $: "Ty", ui: 0, sub_root: 1 };
  const [x, y] = [{ x: 1, y: 2 }, { x: 2, y: 1 }];
  const first = s.intern_slice<unknown>([a, x, 3, "s", INTERNED_STUB], make);
  expect(first[0]).toBe(a);
  // Equal values in a different list: the earlier objects. The caller's array is not written to.
  const a2 = { $: "Ty", ui: 0, sub_root: 1 };
  const x2 = { y: 2, x: 1 };
  const passed = [x2, a2, y, 3];
  const second = s.intern_slice<unknown>(passed, make);
  expect(second).not.toBe(first);
  expect(second[0]).toBe(x);
  expect(second[1]).toBe(a);
  // `y` collides with `x` in no way that matters: not equal, so its own object, and later found as itself.
  expect(second[2]).toBe(y);
  expect(passed[0]).toBe(x2);
  expect(passed[1]).toBe(a2);
  const third = s.intern_slice<unknown>([{ x: 2, y: 1 }, { $: "Ty", ui: 1, sub_root: 1 }], make);
  expect(third[0]).toBe(y);
  expect(third[1]).not.toBe(a);
  // Nothing to share: the caller's array itself goes to `make`.
  const own = [{ q: 1 }];
  let got: readonly unknown[] | undefined;
  s.intern_slice<unknown>(own, (w) => ((got = w), make(w)));
  expect(got).toBe(own);
  // A hit registers nothing: the stored list comes back, and its elements stay the representatives.
  const a3 = { $: "Ty", ui: 0, sub_root: 1 };
  expect(s.intern_slice<unknown>([a3, { x: 1, y: 2 }, 3, "s", INTERNED_STUB], () => expect.unreachable() as never)).toBe(first);
  expect(s.intern_slice<unknown>([a3, { z: 0 }], make)[0]).toBe(a);
});

test("share_elements: a table that does not share keeps the caller's objects", () => {
  const s = ShardedHashMap.with_capacity<readonly unknown[], null>(0);
  const make = (w: readonly unknown[]): readonly unknown[] => [...w];
  const a = { k: 1 };
  s.intern_slice<unknown>([a], make);
  const b = { k: 1 };
  expect(s.intern_slice<unknown>([b, 2], make)[0]).toBe(b);
});

test("share_elements: undefined fields and -0 follow value_eq, as a list hit already does", () => {
  const s = ShardedHashMap.with_capacity<readonly unknown[], null>(0);
  s.share_elements();
  const make = (w: readonly unknown[]): readonly unknown[] => [...w];
  const a = { k: 0, u: undefined };
  s.intern_slice<unknown>([a], make);
  // `value_eq`: a missing field equals one set to `undefined`, and `0` is not `-0`.
  expect(s.intern_slice<unknown>([{ k: 0 }, 1], make)[0]).toBe(a);
  expect(s.intern_slice<unknown>([{ k: -0 }, 2], make)[0]).not.toBe(a);
});
