// `FxHashMap` / `FxHashSet` (rustc_data_structures::fx, i.e. rustc-hash's aliases of std's
// `HashMap<K, V, FxBuildHasher>` / `HashSet<T, FxBuildHasher>`) and the `Debug` of hash maps ported
// as JS `Map`s (PORTING §5).
//
// rustc's Fx maps iterate in hashbrown bucket order: deterministic (FxHasher is unseeded) but a
// function of the keys' hashes, the element size, and the whole history of the map (capacity
// requests, insertions, removals, tombstones, resizes). `FxHashMap` / `FxHashSet` below are JS
// `Map` / `Set`s (so lookups, `size` and every other `Map` API keep working) that also drive the
// vendored hashbrown table (src/vendor/hashbrown) with FxHasher (src/vendor/rustc_hash) through
// every mutation, and iterate in its order. Ported code uses them where upstream iterates or
// prints an Fx map/set; std's `HashMap::new()` (`RandomState`, randomly seeded) has no
// reproducible order and is not modeled.
//
// Keys are hashed exactly as Rust's `Hash` impls do (`KeyType`): `u32`-newtypes (`Symbol`,
// `NodeId`, `AttrId`, every `newtype_index!`) write their `u32`; `String` / `&str` write their
// bytes and `0xff` (std's provided `Hasher::write_str`; rustc-hash's `nightly` override is off).
// Each `KeyType` also carries the key's size and alignment: hashbrown's minimum table size depends
// on `size_of::<(K, V)>()` (see vendor/hashbrown/raw.ts `capacity_to_buckets`).
//
// `Hash` of keys whose identity is not a JS primitive (`Span`, `Ident`, `DefId`, ...) is not
// provided: such maps cannot be JS `Map`s keyed by value anyway.

import { type Debug, debug_map, debug_set, type Fmt } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import { HashMap } from "../vendor/hashbrown/map.ts";
import { TableLayout } from "../vendor/hashbrown/raw.ts";
import { HashSet } from "../vendor/hashbrown/set.ts";
import { FxBuildHasher, type HashFn } from "../vendor/rustc_hash/lib.ts";

/** `core::alloc::Layout` of a Rust type: what hashbrown's `TableLayout::new::<T>()` reads. */
export interface Layout {
  readonly size: number;
  readonly align: number;
}

/** A key type: its `Hash` impl and its layout. */
export interface KeyType<K> extends Layout {
  readonly hash: HashFn<K>;
}

/** `u8` (`Hash` = `write_u8`). */
export const u8_key: KeyType<number> = { hash: (k, state) => state.write_u8(k), size: 1, align: 1 };

/** `u32`, and every `u32` newtype whose `Hash` hashes the `u32`: `Symbol` (derived over
 * `SymbolIndex`), the `newtype_index!` types (`NodeId`, `AttrId`, `SyntaxContext`, ...: `as_u32().hash()`). */
export const u32_key: KeyType<number> = { hash: (k, state) => state.write_u32(k), size: 4, align: 4 };

/** `usize` (`Hash` = `write_usize`). */
export const usize_key: KeyType<number> = { hash: (k, state) => state.write_usize(k), size: 8, align: 8 };

const utf8 = new TextEncoder();

/** `String` (`Hash` = `str::hash` = `write_str`; 24 bytes: ptr, capacity, length). */
export const String_key: KeyType<string> = { hash: (k, state) => state.write_str(utf8.encode(k)), size: 24, align: 8 };

/** `&str` (`write_str`; 16 bytes: ptr, length). */
export const str_key: KeyType<string> = { hash: (k, state) => state.write_str(utf8.encode(k)), size: 16, align: 8 };

/** Layout of a value type that is not a key (`size_of::<V>()`, `align_of::<V>()`). */
export const LAYOUT_UNIT: Layout = { size: 0, align: 1 };
export const LAYOUT_U8: Layout = { size: 1, align: 1 };
export const LAYOUT_U32: Layout = { size: 4, align: 4 };
export const LAYOUT_USIZE: Layout = { size: 8, align: 8 };

/** `Layout::new::<(K, V)>()`: two fields whose sizes are multiples of their alignments need no
 * padding between them (rustc orders them), only at the end. */
export function pair_layout(k: Layout, v: Layout): Layout {
  const align = Math.max(k.align, v.align);
  return { size: Math.ceil((k.size + v.size) / align) * align, align };
}

/**
 * `FxHashMap<K, V>`: a JS `Map` whose iteration (`for..of`, `entries`, `keys`, `values`,
 * `forEach`) is rustc's, because every mutation also runs through the vendored hashbrown table.
 * Constructing one is `FxHashMap::default()`; `with_capacity`, `from_iter` (std's
 * `collect()`), `extend`, `reserve`, `retain`, `shrink_to*` and `clone` mirror the std methods,
 * which all change bucket placement. Plain `Map#set` / `delete` / `clear` are `insert` /
 * `remove` / `clear`.
 */
export class FxHashMap<K, V> extends Map<K, V> {
  /** The hashbrown table (keys, values) in rustc's layout. */
  base: HashMap<K, V>;

  constructor(
    readonly key: KeyType<K>,
    readonly value: Layout,
    capacity = 0,
  ) {
    super();
    const layout = pair_layout(key, value);
    this.base = HashMap.with_capacity_and_hasher<K, V>(capacity, FxBuildHasher, key.hash, TableLayout.new(layout.size, layout.align));
  }

  /** `FxHashMap::default()` */
  static default<K, V>(key: KeyType<K>, value: Layout): FxHashMap<K, V> {
    return new FxHashMap<K, V>(key, value);
  }

  /** `FxHashMap::with_capacity_and_hasher(capacity, Default::default())` */
  static with_capacity<K, V>(capacity: number, key: KeyType<K>, value: Layout): FxHashMap<K, V> {
    return new FxHashMap<K, V>(key, value, capacity);
  }

  /** std's `FromIterator` (`iter.collect()`): `with_hasher` + `extend(iter)`; `size_hint_lower` is
   * the iterator's `size_hint().0` (the length of a `Vec`/slice/array source, 0 after `filter`). */
  static from_iter<K, V>(iter: Iterable<readonly [K, V]>, size_hint_lower: number, key: KeyType<K>, value: Layout): FxHashMap<K, V> {
    const m = new FxHashMap<K, V>(key, value);
    m.extend(iter, size_hint_lower);
    return m;
  }

  /** `insert(k, v)` */
  override set(k: K, v: V): this {
    // `super()` calls no `set`, so `base` always exists here.
    this.base.insert(k, v);
    return super.set(k, v);
  }

  /** `remove(&k).is_some()` */
  override delete(k: K): boolean {
    this.base.remove(k);
    return super.delete(k);
  }

  /** `clear()` */
  override clear(): void {
    this.base.clear();
    super.clear();
  }

  /** `Extend<(K, V)>` (`reserve`s from `size_hint_lower`, see `from_iter`). */
  extend(iter: Iterable<readonly [K, V]>, size_hint_lower: number): void {
    const self = this;
    this.base.extend(
      (function* (): Generator<[K, V]> {
        for (const [k, v] of iter) {
          Map.prototype.set.call(self, k, v);
          yield [k, v];
        }
      })(),
      size_hint_lower,
    );
  }

  reserve(additional: number): void {
    this.base.reserve(additional);
  }

  shrink_to_fit(): void {
    this.base.shrink_to_fit();
  }

  shrink_to(min_capacity: number): void {
    this.base.shrink_to(min_capacity);
  }

  capacity(): number {
    return this.base.capacity();
  }

  /** `retain(|k, v| f(k, v))`, visiting entries in bucket order. */
  retain(f: (k: K, v: V) => boolean): void {
    this.base.retain((k, v) => {
      if (f(k, v)) return true;
      Map.prototype.delete.call(this, k);
      return false;
    });
  }

  /** `Clone`: the same buckets, holding `clone_K(k)` / `clone_V(v)` (identity by default). */
  clone(clone_K: (k: K) => K = (k) => k, clone_V: (v: V) => V = (v) => v): FxHashMap<K, V> {
    const m = new FxHashMap<K, V>(this.key, this.value);
    m.base = this.base.clone(clone_K, clone_V);
    for (const [k, v] of m.base.iter()) Map.prototype.set.call(m, k, v);
    return m;
  }

  override *entries(): MapIterator<[K, V]> {
    for (const [k, v] of this.base.iter()) yield [k, v];
  }

  override *keys(): MapIterator<K> {
    for (const [k] of this.base.iter()) yield k;
  }

  override *values(): MapIterator<V> {
    for (const [, v] of this.base.iter()) yield v;
  }

  override [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  override forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown): void {
    for (const [k, v] of this.base.iter()) callbackfn.call(thisArg, v, k, this);
  }
}

/**
 * `FxHashMap<K, V>` whose Rust key is a struct compared by value (`DefId`, ...): `FxHashMap`'s bucket order with
 * rust_ts/keyed.ts `KeyedMap`'s key canonicalization. `canon(k)` is a string or number equal exactly when the Rust
 * keys are `==`; the first key object inserted for each canonical key is stored, and the hashbrown table holds the
 * stored objects (so its `===` is the keys' `Eq`) hashed by `key.hash` (the keys' `Hash`).
 */
export class FxKeyedMap<K, V> extends FxHashMap<K, V> {
  /** canonical key -> the stored key object */
  readonly #canon = new Map<string | number, K>();

  constructor(
    key: KeyType<K>,
    value: Layout,
    readonly canon: (k: K) => string | number,
    capacity = 0,
  ) {
    super(key, value, capacity);
  }

  /** `FxHashMap::with_capacity_and_hasher(capacity, Default::default())` */
  static with_capacity_keyed<K, V>(capacity: number, key: KeyType<K>, value: Layout, canon: (k: K) => string | number): FxKeyedMap<K, V> {
    return new FxKeyedMap<K, V>(key, value, canon, capacity);
  }

  /** std's `FromIterator` (`iter.collect()`), see `FxHashMap.from_iter`. */
  static from_iter_keyed<K, V>(
    iter: Iterable<readonly [K, V]>,
    size_hint_lower: number,
    key: KeyType<K>,
    value: Layout,
    canon: (k: K) => string | number,
  ): FxKeyedMap<K, V> {
    const m = new FxKeyedMap<K, V>(key, value, canon);
    m.extend(iter, size_hint_lower);
    return m;
  }

  /** The stored key object equal to `k`, if any. */
  stored_key(k: K): K | undefined {
    return this.#canon.get(this.canon(k));
  }

  /** The stored key object equal to `k`, storing `k` if there is none. */
  #store(k: K): K {
    const c = this.canon(k);
    const s = this.#canon.get(c);
    if (s !== undefined) return s;
    this.#canon.set(c, k);
    return k;
  }

  override get(k: K): V | undefined {
    const s = this.stored_key(k);
    return s === undefined ? undefined : super.get(s);
  }

  override has(k: K): boolean {
    return this.#canon.has(this.canon(k));
  }

  /** `insert(k, v)` */
  override set(k: K, v: V): this {
    return super.set(this.#store(k), v);
  }

  /** `remove(&k).is_some()` */
  override delete(k: K): boolean {
    const c = this.canon(k);
    const s = this.#canon.get(c);
    if (s === undefined) return false;
    this.#canon.delete(c);
    return super.delete(s);
  }

  /** `clear()` */
  override clear(): void {
    this.#canon.clear();
    super.clear();
  }

  /** `Extend<(K, V)>`, see `FxHashMap.extend`. */
  override extend(iter: Iterable<readonly [K, V]>, size_hint_lower: number): void {
    const self = this;
    super.extend(
      (function* (): Generator<[K, V]> {
        for (const [k, v] of iter) yield [self.#store(k), v];
      })(),
      size_hint_lower,
    );
  }

  /** `retain(|k, v| f(k, v))`, visiting entries in bucket order. */
  override retain(f: (k: K, v: V) => boolean): void {
    super.retain((k, v) => {
      if (f(k, v)) return true;
      this.#canon.delete(this.canon(k));
      return false;
    });
  }

  /** `Clone`: the same buckets, holding `clone_K(k)` / `clone_V(v)` (identity by default). */
  override clone(clone_K: (k: K) => K = (k) => k, clone_V: (v: V) => V = (v) => v): FxKeyedMap<K, V> {
    const m = new FxKeyedMap<K, V>(this.key, this.value, this.canon);
    m.base = this.base.clone(clone_K, clone_V);
    for (const [k, v] of m.base.iter()) {
      Map.prototype.set.call(m, k, v);
      m.#canon.set(m.canon(k), k);
    }
    return m;
  }
}

/**
 * `FxHashSet<T>`: a JS `Set` that iterates in rustc's order (see `FxHashMap`).
 */
export class FxHashSet<T> extends Set<T> {
  /** The hashbrown table in rustc's layout. */
  base: HashSet<T>;

  constructor(
    readonly key: KeyType<T>,
    capacity = 0,
  ) {
    super();
    // `HashMap<T, ()>`: the elements are `(T, ())`.
    this.base = HashSet.with_capacity_and_hasher<T>(capacity, FxBuildHasher, key.hash, TableLayout.new(key.size, key.align));
  }

  /** `FxHashSet::default()` */
  static default<T>(key: KeyType<T>): FxHashSet<T> {
    return new FxHashSet<T>(key);
  }

  /** `FxHashSet::with_capacity_and_hasher(capacity, Default::default())` */
  static with_capacity<T>(capacity: number, key: KeyType<T>): FxHashSet<T> {
    return new FxHashSet<T>(key, capacity);
  }

  /** std's `FromIterator` (`collect()`): `with_hasher` + `extend`; see `FxHashMap.from_iter`. */
  static from_iter<T>(iter: Iterable<T>, size_hint_lower: number, key: KeyType<T>): FxHashSet<T> {
    const s = new FxHashSet<T>(key);
    s.extend(iter, size_hint_lower);
    return s;
  }

  /** `insert(t)` */
  override add(t: T): this {
    // `super()` calls no `add`, so `base` always exists here.
    this.base.insert(t);
    return super.add(t);
  }

  /** `remove(&t)` */
  override delete(t: T): boolean {
    this.base.remove(t);
    return super.delete(t);
  }

  /** `clear()` */
  override clear(): void {
    this.base.clear();
    super.clear();
  }

  /** `Extend<T>` (`reserve`s from `size_hint_lower`, see `FxHashMap.from_iter`). */
  extend(iter: Iterable<T>, size_hint_lower: number): void {
    const self = this;
    this.base.extend(
      (function* (): Generator<T> {
        for (const t of iter) {
          Set.prototype.add.call(self, t);
          yield t;
        }
      })(),
      size_hint_lower,
    );
  }

  reserve(additional: number): void {
    this.base.reserve(additional);
  }

  shrink_to_fit(): void {
    this.base.shrink_to_fit();
  }

  shrink_to(min_capacity: number): void {
    this.base.shrink_to(min_capacity);
  }

  capacity(): number {
    return this.base.capacity();
  }

  /** `retain(|t| f(t))`, visiting elements in bucket order. */
  retain(f: (t: T) => boolean): void {
    this.base.retain((t) => {
      if (f(t)) return true;
      Set.prototype.delete.call(this, t);
      return false;
    });
  }

  /** `Clone`: the same buckets, holding `clone_T(t)` (identity by default). */
  clone(clone_T: (t: T) => T = (t) => t): FxHashSet<T> {
    const s = new FxHashSet<T>(this.key);
    s.base = this.base.clone(clone_T);
    for (const t of s.base.iter()) Set.prototype.add.call(s, t);
    return s;
  }

  override *values(): SetIterator<T> {
    yield* this.base.iter();
  }

  override keys(): SetIterator<T> {
    return this.values();
  }

  override *entries(): SetIterator<[T, T]> {
    for (const t of this.base.iter()) yield [t, t];
  }

  override [Symbol.iterator](): SetIterator<T> {
    return this.values();
  }

  override forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: unknown): void {
    for (const t of this.base.iter()) callbackfn.call(thisArg, t, t, this);
  }
}

/**
 * `<HashMap<K, V, S> as Debug>::fmt`: `f.debug_map().entries(self.iter()).finish()`.
 * Exact for an `FxHashMap` (bucket order) and for any map of at most one entry. A plain `Map`
 * with more entries has lost the history that decides rustc's order (its upstream map must be
 * created as an `FxHashMap`), so it stays unported.
 */
export function debug_HashMap<K, V>(v: Map<K, V>, f: Fmt, debug_K: Debug<K>, debug_V: Debug<V>): string {
  if (!(v instanceof FxHashMap) && v.size > 1) {
    unported("std::collections::HashMap Debug iteration order (hashbrown + FxHasher)");
  }
  return debug_map(
    f,
    [...v].map(([k, x]) => [debug_K(k, f), debug_V(x, f)]),
  );
}

/** `<HashSet<T, S> as Debug>::fmt`: `f.debug_set().entries(self.iter()).finish()` (see `debug_HashMap`). */
export function debug_HashSet<T>(v: Set<T>, f: Fmt, debug_T: Debug<T>): string {
  if (!(v instanceof FxHashSet) && v.size > 1) {
    unported("std::collections::HashSet Debug iteration order (hashbrown + FxHasher)");
  }
  return debug_set(
    f,
    [...v].map((t) => debug_T(t, f)),
  );
}

/** `<HashMap<K, V, S> as Clone>::clone` of a map ported as a JS `Map`: an `FxHashMap` keeps its
 * buckets (and so its order); a plain `Map` is copied entry by entry. */
export function clone_HashMap<K, V>(v: Map<K, V>, clone_K: (k: K) => K, clone_V: (v: V) => V): Map<K, V> {
  if (v instanceof FxHashMap) return (v as FxHashMap<K, V>).clone(clone_K, clone_V);
  return new Map([...v].map(([k, x]) => [clone_K(k), clone_V(x)]));
}

/** `<HashSet<T, S> as Clone>::clone` of a set ported as a JS `Set` (see `clone_HashMap`). */
export function clone_HashSet<T>(v: Set<T>, clone_T: (t: T) => T): Set<T> {
  if (v instanceof FxHashSet) return (v as FxHashSet<T>).clone(clone_T);
  return new Set([...v].map(clone_T));
}
