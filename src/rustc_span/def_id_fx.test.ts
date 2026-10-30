// Lane rmeta-fxmap: `FxDefIdMap` (def_id.ts) is a `DefIdMap` that iterates in the hashbrown order of the
// `FxKeyedMap<DefId, _>` it drives; that map's order against the oracle is rust_ts/hash_map.oracle.test.ts's `def`
// fixture (fxorder probe). Here: every mutation keeps both views in sync, and the order is the `FxKeyedMap`'s.
import { expect, test } from "bun:test";
import { FxKeyedMap, iterates_in_fx_order, LAYOUT_VEC } from "../rust_ts/hash_map.ts";
import { CrateNum, DefId, DefId_fx_key, DefId_key, DefIdMap, DefIndex, FxDefIdMap } from "./def_id.ts";

const def = (krate: number, index: number): DefId => new DefId(DefIndex.from_u32(index), CrateNum.from_u32(krate));

test("FxDefIdMap is a DefIdMap iterating in FxKeyedMap<DefId, _> order through inserts, removals and resizes", () => {
  const m = new FxDefIdMap<number>(LAYOUT_VEC);
  const fx = new FxKeyedMap<DefId, number>(DefId_fx_key, LAYOUT_VEC, DefId_key);
  for (let i = 0; i < 100; i++) {
    const k = def(i % 4, (i * 2654435761) >>> 8);
    m.set(k, i);
    fx.set(def(k.krate, k.index), i);
    if (i % 7 === 3) {
      const r = def((i - 3) % 4, ((i - 3) * 2654435761) >>> 8);
      expect(m.delete(r)).toBe(fx.delete(r));
    }
  }
  expect(m instanceof DefIdMap).toBe(true);
  expect(iterates_in_fx_order(m)).toBe(true);
  expect(iterates_in_fx_order(new DefIdMap<number>([[def(0, 1), 1], [def(0, 2), 2]]))).toBe(false);
  const order = (it: Iterable<readonly [DefId, number]>) => [...it].map(([k, v]) => `${k.krate}.${k.index}=${v}`);
  expect(order(m)).toEqual(order(fx));
  expect(order(m.entries())).toEqual(order(fx));
  expect([...m.keys()].map(DefId_key)).toEqual([...fx.keys()].map(DefId_key));
  expect([...m.values()]).toEqual([...fx.values()]);
  const seen: number[] = [];
  m.forEach((v) => seen.push(v));
  expect(seen).toEqual([...fx.values()]);
  // insertion order (a plain `DefIdMap`) is not the bucket order
  expect(order(m)).not.toEqual(order(Map.prototype.entries.call(m) as Iterable<[DefId, number]>));
  expect([m.size, m.capacity()]).toEqual([fx.size, fx.capacity()]);
  // keyed by value: an equal key object finds the stored entry and keeps the stored key
  const [k0] = m.keys();
  m.set(def(k0!.krate, k0!.index), -1);
  expect(m.get(def(k0!.krate, k0!.index))).toBe(-1);
  expect(m.stored_key(def(k0!.krate, k0!.index))).toBe(k0);
  expect([...m.keys()][0]).toBe(k0);
  m.clear();
  expect([m.size, [...m].length, m.get(k0!)]).toEqual([0, 0, undefined]);
});

test("FxDefIdMap.from_iter is FxKeyedMap.from_iter_keyed (reserves from the size hint)", () => {
  const items = Array.from({ length: 30 }, (_, i) => [def(0, i * 3), i] as const);
  for (const hint of [0, 30]) {
    const m = FxDefIdMap.from_iter(items, hint, LAYOUT_VEC);
    const fx = FxKeyedMap.from_iter_keyed(items, hint, DefId_fx_key, LAYOUT_VEC, DefId_key);
    expect([...m.values()]).toEqual([...fx.values()]);
    expect(m.capacity()).toBe(fx.capacity());
    expect(m.get(def(0, 27))).toBe(9);
  }
});
