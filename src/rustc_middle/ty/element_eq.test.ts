// Lane perf-tait: the element types' own `Hash` and `PartialEq` that the `canonical_var_kinds`, `predefined_opaques_in_body`
// and `args` tables use in place of `value_hash` / `value_eq` (context.ts `CANONICAL_VAR_KIND_EQ`, `PREDEFINED_OPAQUE_EQ`,
// `INTERNED_ELEMENT_EQ`; rustc_data_structures/sharded.ts `ElementEq`), and the `KeyedMap` key of the opaque type storage
// (rustc_infer opaque_types/table.ts `key_OpaqueTypeKey`). Each must give exactly the equality the generic functions give, and
// equal values must hash the same; a wrong one would make a duplicate list or merge two different ones.
import { expect, test } from "bun:test";
import "../lib.ts";
import { INTERNED } from "../../rustc_data_structures/intern.ts";
import { element_hash_slice, element_slice_eq, type ElementEq, ElementPool, ShardedHashMap } from "../../rustc_data_structures/sharded.ts";
import { intern_key, value_eq, value_hash } from "../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { DefId, DefIndex, CrateNum } from "../../rustc_span/def_id.ts";
import { key_OpaqueTypeKey } from "../../rustc_infer/infer/opaque_types/table.ts";
import { CANONICAL_VAR_KIND_EQ, INTERNED_ELEMENT_EQ, PREDEFINED_OPAQUE_EQ } from "./context.ts";

/** Stand-ins for interned objects: one object per id, as the interners guarantee. */
const interned = new Map<number, object>();
const I = (id: number): object => {
  let o = interned.get(id);
  if (o === undefined) interned.set(id, (o = { [INTERNED]: true, id }));
  return o;
};

const ANON = Object.freeze({ $: "Anon" as const });
const ty_kinds = (): unknown[] => [ANON, { $: "Anon" }, { $: "Param", _0: new DefId(DefIndex.from_u32(3), CrateNum.from_u32(0)) }, { $: "Param", _0: new DefId(DefIndex.from_u32(3), CrateNum.from_u32(1)) }];
const region_kinds = (): unknown[] => [
  ANON,
  { $: "Anon" },
  { $: "ClosureEnv" },
  { $: "NamedForPrinting", _0: 5 },
  { $: "NamedForPrinting", _0: 6 },
  { $: "Named", _0: new DefId(DefIndex.from_u32(3), CrateNum.from_u32(0)) },
];

/** Every `CanonicalVarKind` variant over small universes, vars and kinds, with and without the `PhantomData` field. */
function canonical_var_kinds(): unknown[] {
  const out: unknown[] = [{ $: "Int" }, { $: "Float" }, Object.freeze({ $: "Int" }), { $: "Int", extra: undefined }];
  for (const u of [0, 1, 2]) {
    out.push({ $: "Region", _0: u }, { $: "Const", _0: u });
    for (const v of [0, 1, 7]) {
      out.push({ $: "Ty", ui: u, sub_root: v }, { $: "Ty", sub_root: v, ui: u });
      for (const kind of ty_kinds()) out.push({ $: "PlaceholderTy", _0: { universe: u, bound: { var: v, kind }, _tcx: undefined } });
      for (const kind of region_kinds()) out.push({ $: "PlaceholderRegion", _0: { universe: u, bound: { var: v, kind } } });
      out.push({ $: "PlaceholderConst", _0: { universe: u, bound: { var: v, _tcx: undefined }, _tcx: undefined } });
      out.push({ $: "PlaceholderConst", _0: { bound: { var: v }, universe: u } });
    }
  }
  return out;
}

/** `(OpaqueTypeKey, Ty)` over small def ids, args lists and types. */
function opaque_entries(): unknown[] {
  const out: unknown[] = [];
  for (const def_id of [0, 1, 12, 0xffff_ffff]) for (const args of [100, 101]) for (const ty of [200, 201, 100]) out.push([{ def_id, args: I(args) }, I(ty)], [{ args: I(args), def_id }, I(ty)]);
  return out;
}

function check_against_value_eq(ee: ElementEq, values: readonly unknown[]): void {
  let equal = 0;
  for (const a of values) {
    for (const b of values) {
      const want = value_eq(a, b);
      expect(ee.eq(a, b)).toBe(want);
      if (want) {
        equal++;
        expect(ee.hash(a)).toBe(ee.hash(b));
      }
    }
  }
  expect(equal).toBeGreaterThan(values.length); // some pairs of distinct objects are equal
  // The written-out loops are the element functions' loops.
  const out1 = new Int32Array(values.length);
  const out2 = new Int32Array(values.length);
  expect(ee.hash_slice(values, out1)).toBe(element_hash_slice(ee.hash, values, out2));
  expect([...out1]).toEqual([...out2]);
  expect(ee.hash_slice(values, undefined)).toBe(element_hash_slice(ee.hash, values, undefined));
  const rev = [...values].reverse();
  for (const [a, b] of [[values, values], [values, [...values]], [values, rev], [values, values.slice(1)], [[], []]] as const) {
    expect(ee.slice_eq(a, b)).toBe(element_slice_eq(ee.eq, a, b));
    expect(ee.slice_eq(a, b)).toBe(element_slice_eq(value_eq, a, b));
  }
}

test("CANONICAL_VAR_KIND_EQ is value_eq on every CanonicalVarKind variant, and equal values hash the same", () => {
  check_against_value_eq(CANONICAL_VAR_KIND_EQ, canonical_var_kinds());
});

test("PREDEFINED_OPAQUE_EQ is value_eq on (OpaqueTypeKey, Ty), and equal values hash the same", () => {
  check_against_value_eq(PREDEFINED_OPAQUE_EQ, opaque_entries());
});

test("INTERNED_ELEMENT_EQ is value_eq and value_hash on interned objects", () => {
  const values = [I(0), I(1), I(2), I(300), I(0x7fff_ffff)];
  check_against_value_eq(INTERNED_ELEMENT_EQ, [...values, ...values]);
  for (const v of values) expect(INTERNED_ELEMENT_EQ.hash(v)).toBe(value_hash(v));
});

test("a table with an ElementEq gives the same lists as one with value_eq", () => {
  for (const [ee, values] of [
    [CANONICAL_VAR_KIND_EQ, canonical_var_kinds()],
    [PREDEFINED_OPAQUE_EQ, opaque_entries()],
  ] as const) {
    const typed = ShardedHashMap.with_capacity<readonly unknown[], null>(0);
    typed.share_elements(ee);
    const generic = ShardedHashMap.with_capacity<readonly unknown[], null>(0);
    generic.share_elements();
    const make = (w: readonly unknown[]): readonly unknown[] => Object.freeze([...w]);
    // Slices of a few elements, in a fixed pseudo-random order, many of them equal to an earlier one.
    let seed = 1;
    const next = (n: number): number => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % n);
    const pairs = new Map<readonly unknown[], readonly unknown[]>();
    for (let i = 0; i < 3000; i++) {
      const len = 1 + next(4);
      const v = Array.from({ length: len }, () => values[next(values.length)]);
      const a = typed.intern_slice<unknown>(v, make);
      const b = generic.intern_slice<unknown>(v, make);
      const seen = pairs.get(a);
      if (seen === undefined) pairs.set(a, b);
      else expect(seen).toBe(b);
    }
    expect(typed.len()).toBe(generic.len());
    expect(new Set(pairs.values()).size).toBe(pairs.size);
  }
});

test("the element functions of a table cannot change once it holds a list", () => {
  const s = ShardedHashMap.with_capacity<readonly unknown[], null>(0);
  s.intern_slice<unknown>([I(1)], (w) => [...w]);
  expect(() => s.elements_eq(INTERNED_ELEMENT_EQ)).toThrow("elements_eq: the element hash of a table that holds lists changed");
});

test("key_OpaqueTypeKey: two keys give one text exactly when intern_key gives them one", () => {
  const keys: { def_id: number; args: object }[] = [];
  // Around the bounds of the number form (a def id below 2^21, an args id below 2^32) and the text form's separator.
  for (const def_id of [0, 1, 2, 12, 123, 0x1f_ffff, 0x20_0000, 0x20_0001, 0xffff_ffff]) {
    for (const args of [0, 1, 2, 3, 23, 0x7fff_ffff, 0xffff_ffff, 0x1_0000_0000, 0x1_0000_0001]) keys.push({ def_id, args: I(args) });
  }
  const kinds = new Set<string>();
  for (const a of keys) {
    kinds.add(typeof key_OpaqueTypeKey(a as never));
    for (const b of keys) expect(key_OpaqueTypeKey(a as never) === key_OpaqueTypeKey(b as never)).toBe(intern_key(a) === intern_key(b));
  }
  expect([...kinds].sort()).toEqual(["number", "string"]);
  expect(key_OpaqueTypeKey({ def_id: 0x1f_ffff, args: I(0xffff_ffff) } as never)).toBe(0x1f_ffff * 2 ** 32 + 0xffff_ffff);
  expect(Number.isSafeInteger(key_OpaqueTypeKey({ def_id: 0x1f_ffff, args: I(0xffff_ffff) } as never))).toBe(true);
});

test("KeyedMap.replace is get then set", () => {
  const m = new KeyedMap<{ k: number }, string>((x) => x.k);
  const k1 = { k: 1 };
  expect(m.replace(k1, "a")).toBeUndefined();
  expect(m.replace({ k: 2 }, "b")).toBeUndefined();
  expect(m.replace({ k: 1 }, "c")).toBe("a");
  expect(m.get({ k: 1 })).toBe("c");
  // The first key object stays, in its place.
  expect([...m]).toEqual([[k1, "c"], [{ k: 2 }, "b"]]);
  expect([...m.keys()][0]).toBe(k1);
  expect(m.size).toBe(2);
});

test("ElementPool: one representative per value, through collisions and growth", () => {
  const pool = new ElementPool();
  const eq = (a: unknown, b: unknown): boolean => value_eq(a, b);
  const reps = new Map<number, unknown>();
  // 5,000 values (past several doublings of the 1,024 slots), on only 64 distinct hashes, each offered three times as fresh objects.
  for (let round = 0; round < 3; round++) {
    for (let n = 0; n < 5000; n++) {
      const x = { n };
      const got = pool.share(x, n % 64, eq);
      if (round === 0) {
        expect(got).toBe(x);
        reps.set(n, x);
      } else {
        expect(got).toBe(reps.get(n));
      }
    }
  }
  expect(pool.size).toBe(5000);
  // Hashes that differ only in high bits, and negative ones, find their own.
  const a = { a: 1 };
  const b = { b: 1 };
  expect(pool.share(a, 1 << 30, eq)).toBe(a);
  expect(pool.share(b, -(1 << 30), eq)).toBe(b);
  expect(pool.share({ a: 1 }, 1 << 30, eq)).toBe(a);
  expect(pool.share({ b: 1 }, -(1 << 30), eq)).toBe(b);
});
