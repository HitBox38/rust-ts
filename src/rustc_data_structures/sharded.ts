// Partial port of compiler/rustc_data_structures/src/sharded.rs: the `ShardedHashMap<K, ()>` interning
// surface that rustc_middle's `CtxtInterners` uses (`InternedSet`, ty/context.rs:136).
//
// PORT (single-threaded, PORTING §5 sync types; docs/plan-m3.md D2):
// - `Sharded<T>` is always `Single` (`is_dyn_thread_safe()` is false), so a `ShardedHashMap` is one table and
//   the shard / lock fns are not needed by the interners (not ported).
// - The `hashbrown::HashTable<(K, V)>` keyed by `make_hash` + `table_entry`'s `k.borrow() == key` becomes a
//   JS `Map<string, [K, V]>` keyed by the canonical key of the borrowed value (`Q`), which callers pass in:
//   the derived `Hash` + `PartialEq` of `Q` as a string (rust_ts/intern_key.ts). Equal keys <=> `==` values.
// - Insertion order is the JS `Map`'s; nothing iterates an interner (D6).
// PORT(perf) (lane perf-near-limit): `intern_value` and `intern_slice` are the table as upstream has it, a hash that only picks
// the bucket and `==` on the value (rust_ts/intern_key.ts `value_hash`, `value_eq`), and need no key string. An interner uses
// either these or the key-string methods, never both.
// PORT(perf) (lane perf-heavy): `share_elements`. Upstream's `List::from_arena` copies each element's bytes into the arena, so a
// `CanonicalVarKind` costs 24 bytes in each list that holds it. Here an element is a reference to an object, and the canonicalizer
// builds new ones each time (`{ $: "PlaceholderTy", _0: { universe, bound: { var, kind } } }`, three objects): on
// `closures/supertrait-hint-cycle.rs` at `recursion_limit = "32"`, 11M such elements and 7.5M `(OpaqueTypeKey, Ty)` tuples were
// kept by the lists of two tables, most of them equal. A table that shares elements stores, in a new list, an element `value_eq`
// to one an earlier list of that table holds as that earlier object. That is the guarantee a hit already gives: `intern_slice` hands
// back the stored list, whose elements are only `value_eq` to the ones passed (a field left out where the caller's set it to
// `undefined`, another key order), so no caller can see more here than on a hit. What changes is that two lists can now hold one
// object where upstream has two equal copies: only `===` on elements of two lists, or a write to an element (to a stored list's
// elements, already a bug), could tell. Upstream compares these `Copy` values with `==`.
// PORT(perf) (lane perf-tait): a table that shares may also take its element type's derived `Hash` and `PartialEq` as functions
// (`ElementEq`), used in place of the generic `value_hash` / `value_eq` for its elements: upstream hashes and compares these elements
// with exactly those derives. The functions must agree with `value_eq` on every value of the element type (each pair's own test says
// how), and the hash with the eq; the hash only picks a bucket, and every table uses one hash for all its lists. On the `mir` cases
// `type-alias-impl-trait/recursive-drop-elaboration*.rs` the two sharing tables hashed 106M elements (lists of about 300 elements, made
// afresh by each canonicalization) and compared 75M on hits, about 30% of the run in the generic walk.

import { INTERNED } from "./intern.ts";
import { panic } from "../std/panic.ts";
import { hash_mix, observe_interned, observe_interned_slice, value_eq, value_hash } from "../rust_ts/intern_key.ts";

/** PORT(perf): test hook, see `set_intern_shadow`. */
let shadow: ((set: object, value: unknown, got: unknown) => void) | undefined;
/**
 * Test hook: `f` sees every `intern_value` / `intern_slice` result with its value, so a test can check that a table keyed by
 * `intern_key` would give the same object.
 */
export function set_intern_shadow(f: typeof shadow): void {
  shadow = f;
}

/** PORT(perf): the element hashes of the slice `intern_slice` is interning, for `share_elements`; reused, so no allocation per call. */
let elem_hashes = new Int32Array(64);

function slice_eq<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!value_eq(a[i], b[i])) return false;
  return true;
}

/**
 * PORT(perf): a list element type's derived `Hash` and `PartialEq` (module comment). `eq` must be `value_eq` on values of the type,
 * and `eq(a, b)` must imply `hash(a) === hash(b)`. `hash_slice` and `slice_eq` are the loops over a slice, written out per type so
 * that each loop calls one function (element_hash_slice, element_slice_eq give their meaning).
 */
export interface ElementEq {
  readonly hash: (v: unknown) => number;
  readonly eq: (a: unknown, b: unknown) => boolean;
  /** `element_hash_slice(this.hash, v, out)` */
  readonly hash_slice: (v: readonly unknown[], out: Int32Array | undefined) => number;
  /** `element_slice_eq(this.eq, a, b)` */
  readonly slice_eq: (a: readonly unknown[], b: readonly unknown[]) => boolean;
}

/** PORT(perf): what `ElementEq.hash_slice` computes: a slice's hash from its elements' (`intern_slice`), each also put in `out`. */
export function element_hash_slice(hash: (v: unknown) => number, v: readonly unknown[], out: Int32Array | undefined): number {
  let h = v.length;
  for (let i = 0; i < v.length; i++) {
    const eh = hash(v[i]);
    if (out !== undefined) out[i] = eh;
    h = hash_mix(h, eh);
  }
  return h;
}

/** PORT(perf): what `ElementEq.slice_eq` computes: the slices' `==`, element by element. */
export function element_slice_eq(eq: (a: unknown, b: unknown) => boolean, a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
  return true;
}

/** PORT(perf): the generic element functions, for a table without its own. */
const VALUE_ELEMENT_EQ: ElementEq = {
  hash: value_hash,
  eq: value_eq,
  hash_slice(v, out) {
    let h = v.length;
    for (let i = 0; i < v.length; i++) {
      const eh = value_hash(v[i]);
      if (out !== undefined) out[i] = eh;
      h = hash_mix(h, eh);
    }
    return h;
  },
  slice_eq,
};

/**
 * PORT(perf) (lane perf-tait): `share_elements`' representatives, one per value, found by element hash then `eq`: an open-addressing
 * table (linear probing over an `Int32Array` of hashes beside an array of the objects), in place of a `Map` from hash to an array of
 * objects, whose lookups were 7% of the `mir` case `type-alias-impl-trait/recursive-drop-elaboration-2.rs` (19M + 9M elements of
 * lists that missed). Representatives are pairwise unequal, so at most one matches, and the probe order cannot matter.
 */
export class ElementPool {
  private hashes = new Int32Array(1024);
  private objects: unknown[] = new Array<unknown>(1024).fill(undefined);
  private count = 0;

  /** The representative `eq` to `x` (whose hash is `h`); if there is none, `x`, which becomes it. `x` is an object. */
  share(x: unknown, h: number, eq: (a: unknown, b: unknown) => boolean): unknown {
    const objects = this.objects;
    const mask = objects.length - 1;
    let i = slot_of(h) & mask;
    for (;;) {
      const o = objects[i];
      if (o === undefined) break;
      if (this.hashes[i] === h && eq(x, o)) return o;
      i = (i + 1) & mask;
    }
    objects[i] = x;
    this.hashes[i] = h;
    if (++this.count * 2 > objects.length) this.grow();
    return x;
  }

  /** The number of representatives (for tests). */
  get size(): number {
    return this.count;
  }

  private grow(): void {
    const old_hashes = this.hashes;
    const old_objects = this.objects;
    const n = old_objects.length * 2;
    const hashes = new Int32Array(n);
    const objects = new Array<unknown>(n).fill(undefined);
    const mask = n - 1;
    for (let j = 0; j < old_objects.length; j++) {
      const o = old_objects[j];
      if (o === undefined) continue;
      const h = old_hashes[j]!;
      let i = slot_of(h) & mask;
      while (objects[i] !== undefined) i = (i + 1) & mask;
      objects[i] = o;
      hashes[i] = h;
    }
    this.hashes = hashes;
    this.objects = objects;
  }
}

/** The start slot of hash `h`: its bits spread, as the element hashes of small values are small numbers. */
function slot_of(h: number): number {
  const x = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return x ^ (x >>> 16);
}

export class ShardedHashMap<K, V> {
  /** canonical key of the borrowed value -> the stored `(K, V)` */
  protected readonly table = new Map<string, [K, V]>();
  /** PORT(perf): `value_hash` -> the first stored entry with that hash. */
  private readonly hashed = new Map<number, K>();
  /** PORT(perf): `value_hash` -> the later entries with that hash. Empty unless two distinct values collide. */
  private readonly collided = new Map<number, K[]>();
  private hashed_len = 0;
  /** PORT(perf): `share_elements`: the element objects lists of this table hold, by element hash. */
  private elements: ElementPool | undefined;
  /** PORT(perf): `elements_eq`: the element type's hash and eq (`ElementEq`). */
  private element_eq: ElementEq = VALUE_ELEMENT_EQ;

  // rustc: compiler/rustc_data_structures/src/sharded.rs:146 with_capacity
  static with_capacity<K, V>(_cap: number): ShardedHashMap<K, V> {
    // PORT: `per_shard_cap = cap.div_ceil(shards())` is a capacity hint only; a JS `Map` has none.
    return new ShardedHashMap<K, V>();
  }

  // rustc: compiler/rustc_data_structures/src/sharded.rs:150 len
  len(): number {
    return this.table.size + this.hashed_len;
  }

  // rustc: compiler/rustc_data_structures/src/sharded.rs:157 get
  /** PORT: `key` is the canonical key of the borrowed `&Q` (module comment). */
  get(key: string): V | undefined {
    const e = this.table.get(key);
    return e === undefined ? undefined : e[1];
  }

  // rustc: compiler/rustc_data_structures/src/sharded.rs:170 get_or_insert_with
  get_or_insert_with(key: K, hash_key: string, default_: () => V): V {
    const e = this.table.get(hash_key);
    if (e !== undefined) return e[1];
    const value = default_();
    this.table.set(hash_key, [key, value]);
    return value;
  }

  /// Insert value into the [`ShardedHashMap`] with unique key.
  ///
  /// This function panics if debug_assertions are enabled and uniqueness is violated.
  /// If uniqueness is violated but debug_assertions are disabled then lookups will arbitrarily
  /// return one of the inserted elements.
  // rustc: compiler/rustc_data_structures/src/sharded.rs:193 insert_unique
  insert_unique(key: K, hash_key: string, value: V): void {
    // PORT: the `debug_assertions` arm is off in rustc; `insert_unique` without the check. A JS `Map` keeps one
    // entry per key, so a violated uniqueness keeps the first (upstream: an arbitrary one).
    if (!this.table.has(hash_key)) this.table.set(hash_key, [key, value]);
  }

  // rustc: compiler/rustc_data_structures/src/sharded.rs:215 intern_ref
  /** PORT: `key` is the canonical key of `value` (module comment). */
  intern_ref<Q>(this: InternedSet<K>, _value: Q, key: string, make: () => K): K {
    const hit = this.table.get(key);
    if (hit !== undefined) return hit[0];
    const v = make();
    this.table.set(key, [v, null]);
    return v;
  }

  // rustc: compiler/rustc_data_structures/src/sharded.rs:234 intern
  /** PORT: `key` is the canonical key of `value` (module comment). */
  intern<Q>(this: InternedSet<K>, value: Q, key: string, make: (value: Q) => K): K {
    const hit = this.table.get(key);
    if (hit !== undefined) return hit[0];
    const v = make(value);
    this.table.set(key, [v, null]);
    return v;
  }

  /**
   * PORT(perf): `intern`, with no key string (module comment). `value_of(k)` is the value `k` was made from: the fields
   * compared are that stored value's, so nothing may write to it after this (hash-consed values are immutable upstream, and
   * `set_intern_shadow`'s test would see a write as a different object from a key table).
   */
  intern_value<Q>(this: InternedSet<K>, value: Q, value_of: (k: K) => Q, make: (value: Q) => K): K {
    observe_interned(value);
    const h = value_hash(value);
    const first = this.hashed.get(h);
    let got: K | undefined;
    if (first === undefined) {
      got = make(value);
      this.hashed.set(h, got);
      this.hashed_len++;
    } else if (value_eq(value, value_of(first))) {
      got = first;
    } else {
      const rest = this.collided.get(h);
      if (rest !== undefined) {
        for (let i = 0; i < rest.length; i++) {
          if (value_eq(value, value_of(rest[i]!))) {
            got = rest[i]!;
            break;
          }
        }
      }
      if (got === undefined) {
        got = make(value);
        if (rest === undefined) this.collided.set(h, [got]);
        else rest.push(got);
        this.hashed_len++;
      }
    }
    if (shadow !== undefined) shadow(this, value, got);
    return got;
  }

  /**
   * PORT(perf): `intern_ref` of a slice, with no key string. The stored list is an interned object that `value_eq` compares by
   * id, so slices compare element by element here; `v` may itself be a list: it is its elements, as in `slice_intern`'s key.
   */
  intern_slice<T>(this: InternedSet<K & readonly T[]>, v: readonly T[], make: (v: readonly T[]) => K & readonly T[]): K & readonly T[] {
    observe_interned_slice(v);
    const ee = this.element_eq;
    let h: number;
    if (this.elements === undefined) {
      h = ee.hash_slice(v, undefined);
    } else {
      if (elem_hashes.length < v.length) elem_hashes = new Int32Array(Math.max(v.length, 2 * elem_hashes.length));
      h = ee.hash_slice(v, elem_hashes);
    }
    const first = this.hashed.get(h);
    let got: (K & readonly T[]) | undefined;
    if (first === undefined) {
      got = make(this.shared_elements(v));
      this.hashed.set(h, got);
      this.hashed_len++;
    } else if (ee.slice_eq(v, first)) {
      got = first;
    } else {
      const rest = this.collided.get(h);
      if (rest !== undefined) {
        for (let i = 0; i < rest.length; i++) {
          if (ee.slice_eq(v, rest[i]!)) {
            got = rest[i]!;
            break;
          }
        }
      }
      if (got === undefined) {
        got = make(this.shared_elements(v));
        if (rest === undefined) this.collided.set(h, [got]);
        else rest.push(got);
        this.hashed_len++;
      }
    }
    if (shadow !== undefined) shadow(this, v, got);
    return got;
  }

  /**
   * PORT: `lock_shards()` and each shard's `iter()`: every stored key. The port keeps one table, so this is not upstream's
   * order; its one user (`TyCtxt::debug_stats`, whose upstream loop says "ordering doesn't affect anything here") only counts.
   */
  *keys(): Generator<K> {
    for (const e of this.table.values()) yield e[0];
    for (const k of this.hashed.values()) yield k;
    for (const rest of this.collided.values()) yield* rest;
  }

  /**
   * PORT(perf): this table's new lists hold an element `value_eq` to one an earlier list holds as that object (module comment).
   * `element_eq`: as `elements_eq`.
   */
  share_elements(element_eq?: ElementEq): void {
    if (element_eq !== undefined) this.elements_eq(element_eq);
    this.elements ??= new ElementPool();
  }

  /**
   * PORT(perf): `element_eq`, the element type's own hash and eq, replaces `value_hash` / `value_eq` for this table's elements
   * (module comment), without sharing; only before the first `intern_slice`, as the table keeps one hash for all its lists.
   */
  elements_eq(element_eq: ElementEq): void {
    if (this.hashed_len !== 0) panic("elements_eq: the element hash of a table that holds lists changed");
    this.element_eq = element_eq;
  }

  /**
   * PORT(perf): `v`, or a copy whose elements are the objects earlier lists of this table hold, where `value_eq` (module comment).
   * Only right after `intern_slice` filled `elem_hashes` for `v`. Numbers, strings and interned objects are left as they are.
   */
  private shared_elements<T>(v: readonly T[]): readonly T[] {
    const elements = this.elements;
    if (elements === undefined) return v;
    const eq = this.element_eq.eq;
    let w: T[] | undefined;
    for (let i = 0; i < v.length; i++) {
      const x = v[i];
      if (typeof x !== "object" || x === null || (x as { readonly [INTERNED]?: true })[INTERNED] === true) continue;
      const found = elements.share(x, elem_hashes[i]!, eq);
      if (found !== x) (w ??= Array.from(v))[i] = found as T;
    }
    return w ?? v;
  }

  // rustc: compiler/rustc_data_structures/src/sharded.rs:259 contains_pointer_to
  /** PORT: `IntoPointer` is object identity: is `value` the object stored under `key`? */
  contains_pointer_to(this: InternedSet<K>, value: K, key: string): boolean {
    const hit = this.table.get(key);
    return hit !== undefined && hit[0] === value;
  }
}

/** PORT: `ShardedHashMap<K, ()>`, the interner set (`impl<K: Eq + Hash + Copy> ShardedHashMap<K, ()>`). */
export type InternedSet<K> = ShardedHashMap<K, null>;
