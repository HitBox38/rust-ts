// Port of `mod tests` of src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs (lane miri-tb-a), then lane checks of
// what those tests do not reach (`entry`, `iter`, equality, the reuse of deassigned indexes).
import { expect, test } from "bun:test";
import { debug_UniIndex, tests, UniEntry, type UniIndex, UniIndex_eq, UniKeyMap, UniValMap, UniValMap_eq } from "./unimap.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { Panic } from "../../../std/panic.ts";

// #[test]
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:256 extend_to_length
test("extend_to_length", () => {
  const km = UniValMap.default<number>();
  km.extend_to_length(10);
  expect(km.data.length === 10).toBe(true);
  km.extend_to_length(0);
  expect(km.data.length === 10).toBe(true);
  km.extend_to_length(10);
  expect(km.data.length === 10).toBe(true);
  km.extend_to_length(11);
  expect(km.data.length === 11).toBe(true);
});

/** `impl<K, V> MapWitness<K, V>` (PORT: a subclass of the generated `tests::MapWitness`, for its `Default`). */
class MapWitness<K, V> extends tests.MapWitness<K, V> {
  constructor() {
    super(UniKeyMap.default<K>(), UniValMap.default<V>(), new Map());
  }

  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:280 insert
  insert(k: K, v: V): void {
    // UniMap
    const i = this.key.get_or_insert(k);
    this.val.insert(i, v);
    // HashMap
    this.map.set(k, v);
    // Consistency: nothing to check
  }

  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:289 get
  get(k: K): void {
    // UniMap
    const i = this.key.get(k);
    const v1 = i === undefined ? undefined : this.val.get(i);
    // HashMap
    const v2 = this.map.get(k);
    // Consistency
    expect(v1).toBe(v2 as V);
  }

  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:298 get_mut
  get_mut(k: K): void {
    // UniMap
    const i = this.key.get(k);
    const v1 = i === undefined ? undefined : this.val.get_mut(i);
    // HashMap
    const v2 = this.map.get(k);
    // Consistency
    expect(v1).toBe(v2 as V);
  }

  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:306 remove
  remove(k: K): void {
    // UniMap
    const i = this.key.get(k);
    if (i !== undefined) {
      this.val.remove(i);
    }
    this.key.remove(k);
    // HashMap
    this.map.delete(k);
    // Consistency: nothing to check
  }
}

const ch = (c: string): number => c.codePointAt(0)!;

// #[test]
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:319 consistency_small
test("consistency_small", () => {
  const m = new MapWitness<bigint, number>();
  m.insert(1n, ch("a"));
  m.insert(2n, ch("b"));
  m.get(1n);
  m.get_mut(2n);
  m.remove(2n);
  m.insert(1n, ch("c"));
  m.get(1n);
  m.insert(3n, ch("d"));
  m.insert(4n, ch("e"));
  m.insert(4n, ch("f"));
  m.get(2n);
  m.get(3n);
  m.get(4n);
  m.get(5n);
  m.remove(100n);
  m.get_mut(100n);
  m.get(100n);
});

const U64 = (1n << 64n) - 1n;
const rotl = (x: bigint, b: bigint): bigint => ((x << b) | (x >> (64n - b))) & U64;

/** std's `DefaultHasher::new()`: SipHash-1-3 with zero keys, keeping its state across `finish` (test helper). */
class DefaultHasher {
  private v0 = 0x736f6d6570736575n;
  private v1 = 0x646f72616e646f6dn;
  private v2 = 0x6c7967656e657261n;
  private v3 = 0x7465646279746573n;
  private tail: number[] = [];
  private length = 0n;

  private static round(s: [bigint, bigint, bigint, bigint]): void {
    let [v0, v1, v2, v3] = s;
    v0 = (v0 + v1) & U64;
    v2 = (v2 + v3) & U64;
    v1 = rotl(v1, 13n) ^ v0;
    v0 = rotl(v0, 32n);
    v3 = rotl(v3, 16n) ^ v2;
    v0 = (v0 + v3) & U64;
    v2 = (v2 + v1) & U64;
    v3 = rotl(v3, 21n) ^ v0;
    v1 = rotl(v1, 17n) ^ v2;
    v2 = rotl(v2, 32n);
    s[0] = v0;
    s[1] = v1;
    s[2] = v2;
    s[3] = v3;
  }

  write(bytes: readonly number[]): void {
    for (const b of bytes) {
      this.tail.push(b);
      this.length += 1n;
      if (this.tail.length === 8) {
        let m = 0n;
        for (let i = 7; i >= 0; i--) m = (m << 8n) | BigInt(this.tail[i]!);
        this.tail = [];
        const s: [bigint, bigint, bigint, bigint] = [this.v0, this.v1, this.v2, this.v3 ^ m];
        DefaultHasher.round(s);
        this.v0 = s[0] ^ m;
        this.v1 = s[1];
        this.v2 = s[2];
        this.v3 = s[3];
      }
    }
  }

  finish(): bigint {
    let b = (this.length & 0xffn) << 56n;
    for (let i = this.tail.length - 1; i >= 0; i--) b |= BigInt(this.tail[i]!) << BigInt(8 * i);
    const s: [bigint, bigint, bigint, bigint] = [this.v0, this.v1, this.v2, this.v3 ^ b];
    DefaultHasher.round(s);
    s[0] ^= b;
    s[2] ^= 0xffn;
    DefaultHasher.round(s);
    DefaultHasher.round(s);
    DefaultHasher.round(s);
    return s[0] ^ s[1] ^ s[2] ^ s[3];
  }

  /** `i.hash(&mut hasher)` for `i: i32` (little-endian host). */
  hash_i32(i: number): void {
    this.write([i & 0xff, (i >> 8) & 0xff, (i >> 16) & 0xff, (i >> 24) & 0xff]);
  }
}

test("DefaultHasher matches the pinned nightly's std", () => {
  // Reference values from the pinned nightly (a throwaway program running `consistency_large`'s loop).
  const h = new DefaultHasher();
  const out: Record<number, bigint> = {};
  let xor = 0n;
  let ops = 0;
  for (let i = 0; i < 1000; i++) {
    h.hash_i32(i);
    const rng = h.finish();
    out[i] = rng;
    xor ^= rng;
    if (rng % 3n === 0n) ops++;
  }
  expect(out[0]).toBe(14709398186846620400n);
  expect(out[1]).toBe(6961116553929376407n);
  expect(out[2]).toBe(12424772963402752658n);
  expect(out[999]).toBe(12919008262992241871n);
  expect(xor).toBe(4918182926162606186n);
  expect(ops).toBe(315);
});

// #[test]
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:341 consistency_large
test("consistency_large", () => {
  const hasher = new DefaultHasher();
  const map = new MapWitness<bigint, bigint>();
  for (let i = 0; i < 1000; i++) {
    hasher.hash_i32(i);
    const rng = hasher.finish();
    const op = rng % 3n === 0n;
    const key = rng / 2n % 50n;
    const val = rng / 100n % 1000n;
    if (op) {
      map.insert(key, val);
    } else {
      map.get(key);
    }
  }
});

// ---- lane checks ----

const eq = (a: number, b: number): boolean => a === b;
const I = (idx: number): UniIndex => ({ idx });

test("entry: or_insert writes through to the map and keeps an existing value", () => {
  const m = UniValMap.default<{ n: number }>();
  const e = m.entry(I(3));
  expect(e).toBeInstanceOf(UniEntry);
  expect(m.data.length).toBe(4);
  expect(e.get()).toBeUndefined();
  const first = { n: 1 };
  expect(e.or_insert(first)).toBe(first);
  expect(e.get()).toBe(first);
  expect(m.get(I(3))).toBe(first);
  // A second entry sees the value; `or_insert` does not replace it, and a `&mut V` mutation shows in the map.
  const again = m.entry(I(3));
  const got = again.or_insert({ n: 2 });
  expect(got).toBe(first);
  got.n = 9;
  expect(m.get_mut(I(3))!.n).toBe(9);
});

test("iter yields present values in index order, lazily over the live data", () => {
  const m = UniValMap.default<number>();
  m.insert(I(5), 50);
  m.insert(I(1), 10);
  m.insert(I(3), 30);
  m.remove(I(3));
  expect([...m.iter()].map(([i, v]) => [i.idx, v])).toEqual([
    [1, 10],
    [5, 50],
  ]);
  expect(m.is_empty()).toBe(false);
  expect(m.contains_idx(I(1))).toBe(true);
  expect(m.contains_idx(I(3))).toBe(false);
  expect(m.contains_idx(I(100))).toBe(false);
  m.remove(I(1));
  m.remove(I(5));
  expect(m.is_empty()).toBe(true);
  expect(m.data.length).toBe(6);
  expect(m.remove(I(100))).toBeUndefined();
});

test("identical compares lengths, equivalent ignores trailing Nones (PartialEq is equivalent)", () => {
  const a = UniValMap.default<number>();
  const b = UniValMap.default<number>();
  a.insert(I(0), 1);
  b.insert(I(0), 1);
  expect(a.identical(b, eq)).toBe(true);
  b.extend_to_length(5);
  expect(a.identical(b, eq)).toBe(false);
  expect(a.equivalent(b, eq)).toBe(true);
  expect(UniValMap_eq(a, b, eq)).toBe(true);
  b.insert(I(4), 2);
  expect(a.equivalent(b, eq)).toBe(false);
  expect(b.equivalent(a, eq)).toBe(false);
  b.remove(I(4));
  b.insert(I(0), 7);
  expect(a.equivalent(b, eq)).toBe(false);
});

test("UniKeyMap keeps its key invariant and reuses deassigned indexes last-in-first-out", () => {
  const k = UniKeyMap.default<number>();
  expect(k.insert(10).idx).toBe(0);
  expect(k.insert(20).idx).toBe(1);
  expect(k.insert(30).idx).toBe(2);
  expect(k.len()).toBe(3);
  k.remove(10);
  k.remove(20);
  k.remove(999); // not there: nothing happens
  expect(k.deassigned).toEqual([0, 1]);
  expect(k.contains_key(10)).toBe(false);
  expect(k.get(10)).toBeUndefined();
  expect(k.insert(40).idx).toBe(1);
  expect(k.get_or_insert(50).idx).toBe(0);
  expect(k.get_or_insert(50).idx).toBe(0);
  // `0 .. mapping.len() + deassigned.len()` again: the next fresh index is `mapping.len()`.
  expect(k.insert(60).idx).toBe(3);
});

test("UniKeyMap::insert panics on an assigned key, with upstream's text", () => {
  const k = UniKeyMap.default<number>();
  k.insert(1);
  let err: unknown;
  try {
    k.insert(1);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Panic);
  expect((err as Panic).message).toBe(
    "This key is already assigned to a different index; either use `get_or_insert` instead if you care about this data, or first call `remove` to undo the preexisting assignment.",
  );
});

test("UniIndex: Debug is the bare number, PartialEq compares idx", () => {
  expect(debug_UniIndex(I(42), PLAIN)).toBe("42");
  expect(UniIndex_eq(I(1), I(1))).toBe(true);
  expect(UniIndex_eq(I(1), I(2))).toBe(false);
});
