// Port of compiler/rustc_data_structures/src/sso/map.rs.
//
// PORT: representation and generics.
// - The enum `SsoHashMap { Array(ArrayVec<(K, V), 8>), Map(FxHashMap<K, V>) }` is the `repr` field of the
//   class; `*self = SsoHashMap::Map(..)` assigns it. `ArrayVec` is a `[K, V][]` holding at most
//   `SSO_ARRAY_SIZE` pairs; `FxHashMap` is rust_ts's (src/rust_ts/hash_map.ts), so iteration after the
//   switch to a map follows rustc's hashbrown order.
// - `K: Eq` is `===` (keys are primitives or interned handles, as for every `FxHashMap`); `K: Hash` and
//   the layout of `(K, V)` (which hashbrown's bucket placement depends on) are the `KeyType` `key` and
//   the value `Layout` `value`, given at construction.
// - `Option<V>` returned by `insert` / `remove` is `{ $: "Some", _0 } | undefined` (`V` may be `()`,
//   i.e. `undefined`, as in `SsoHashSet`); `get` returns `V | undefined` (as vendor/hashbrown's `get`).
// - `&mut V` (`get_mut`, `iter_mut`, `values_mut`, `Entry`) is a `MutRef<V>` view of the stored slot;
//   `retain`'s `&mut V` is the value itself (as in vendor/hashbrown).
// - Iterators are JS iterators; `drain` empties the map eagerly (its borrow ends only after the
//   iterator is consumed or dropped, and dropping it drains the rest anyway). `IntoIterator` sources of
//   `extend` / `from_iter` come with their `size_hint().0` (`size_hint_lower`).
// - `Either` (either crate) is a branch per variant.

import { type Debug, debug_map, type Fmt } from "../../std/fmt.ts";
import { field_mut, type MutRef } from "../../std/mut_ref.ts";
import { panic } from "../../std/panic.ts";
import { FxHashMap, type KeyType, type Layout } from "../../rust_ts/hash_map.ts";
import { equivalent_key, make_hash } from "../../vendor/hashbrown/map.ts";

/// For pointer-sized arguments arrays
/// are faster than set/map for up to 64
/// arguments.
///
/// On the other hand such a big array
/// hurts cache performance, makes passing
/// sso structures around very expensive.
///
/// Biggest performance benefit is gained
/// for reasonably small arrays that stay
/// small in vast majority of cases.
///
/// '8' is chosen as a sane default, to be
/// reevaluated later.
const SSO_ARRAY_SIZE = 8;

/** `Option<V>` for a `V` that may be `undefined`. */
export interface Some<V> {
  readonly $: "Some";
  readonly _0: V;
}

export type SsoHashMapRepr<K, V> = { readonly $: "Array"; readonly _0: [K, V][] } | { readonly $: "Map"; readonly _0: FxHashMap<K, V> };

/// Small-storage-optimized implementation of a map.
///
/// Stores elements in a small array up to a certain length
/// and switches to `HashMap` when that length is exceeded.
//
// FIXME: Implements subset of HashMap API.
//
// Missing HashMap API:
//   all hasher-related
//   try_reserve
//   shrink_to (unstable)
//   drain_filter (unstable)
//   into_keys/into_values (unstable)
//   all raw_entry-related
//   PartialEq/Eq (requires sorting the array)
//   Entry::or_insert_with_key
//   Vacant/Occupied entries and related
//
// FIXME: In HashMap most methods accepting key reference
// accept reference to generic `Q` where `K: Borrow<Q>`.
//
// However, using this approach in `HashMap::get` apparently
// breaks inlining and noticeably reduces performance.
//
// Performance *should* be the same given that borrow is
// a NOP in most cases, but in practice that's not the case.
//
// Further investigation is required.
//
// Affected methods:
//   SsoHashMap::get
//   SsoHashMap::get_mut
//   SsoHashMap::get_entry
//   SsoHashMap::get_key_value
//   SsoHashMap::contains_key
//   SsoHashMap::remove
//   SsoHashMap::remove_entry
//   Index::index
//   SsoHashSet::take
//   SsoHashSet::get
//   SsoHashSet::remove
//   SsoHashSet::contains
export class SsoHashMap<K, V> {
  constructor(
    public repr: SsoHashMapRepr<K, V>,
    /** PORT: `K: Hash` and the key's layout (for the `FxHashMap`). */
    readonly key: KeyType<K>,
    /** PORT: the value's layout (for the `FxHashMap`). */
    readonly value: Layout,
  ) {}

  /** `#[derive(Clone)]`: `K: Clone` / `V: Clone` are `clone_K` / `clone_V`. */
  clone(clone_K: (k: K) => K = (k) => k, clone_V: (v: V) => V = (v) => v): SsoHashMap<K, V> {
    switch (this.repr.$) {
      case "Array":
        return new SsoHashMap({ $: "Array", _0: this.repr._0.map(([k, v]) => [clone_K(k), clone_V(v)]) }, this.key, this.value);
      case "Map":
        return new SsoHashMap({ $: "Map", _0: this.repr._0.clone(clone_K, clone_V) }, this.key, this.value);
    }
  }

  /// Creates an empty `SsoHashMap`.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:78 new
  static new<K, V>(key: KeyType<K>, value: Layout): SsoHashMap<K, V> {
    return new SsoHashMap<K, V>({ $: "Array", _0: [] }, key, value);
  }

  /// Creates an empty `SsoHashMap` with the specified capacity.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:83 with_capacity
  static with_capacity<K, V>(cap: number, key: KeyType<K>, value: Layout): SsoHashMap<K, V> {
    if (cap <= SSO_ARRAY_SIZE) {
      return SsoHashMap.new(key, value);
    } else {
      return new SsoHashMap<K, V>({ $: "Map", _0: FxHashMap.with_capacity(cap, key, value) }, key, value);
    }
  }

  /// Clears the map, removing all key-value pairs. Keeps the allocated memory
  /// for reuse.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:93 clear
  clear(): void {
    switch (this.repr.$) {
      case "Array":
        this.repr._0.length = 0;
        break;
      case "Map":
        this.repr._0.clear();
        break;
    }
  }

  /// Returns the number of elements the map can hold without reallocating.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:101 capacity
  capacity(): number {
    switch (this.repr.$) {
      case "Array":
        return SSO_ARRAY_SIZE;
      case "Map":
        return this.repr._0.capacity();
    }
  }

  /// Returns the number of elements in the map.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:109 len
  len(): number {
    switch (this.repr.$) {
      case "Array":
        return this.repr._0.length;
      case "Map":
        return this.repr._0.size;
    }
  }

  /// Returns `true` if the map contains no elements.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:117 is_empty
  is_empty(): boolean {
    switch (this.repr.$) {
      case "Array":
        return this.repr._0.length === 0;
      case "Map":
        return this.repr._0.size === 0;
    }
  }

  /// An iterator visiting all key-value pairs in arbitrary order.
  /// The iterator element type is `(&'a K, &'a V)`.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:127 iter
  iter(): Generator<readonly [K, V]> {
    return this.into_iter_ref();
  }

  /// An iterator visiting all key-value pairs in arbitrary order,
  /// with mutable references to the values.
  /// The iterator element type is `(&'a K, &'a mut V)`.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:135 iter_mut
  iter_mut(): Generator<readonly [K, MutRef<V>]> {
    return this.into_iter_mut();
  }

  /// An iterator visiting all keys in arbitrary order.
  /// The iterator element type is `&'a K`.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:141 keys
  *keys(): Generator<K> {
    switch (this.repr.$) {
      case "Array":
        for (const [k, _v] of this.repr._0) yield k;
        return;
      case "Map":
        yield* this.repr._0.keys();
        return;
    }
  }

  /// An iterator visiting all values in arbitrary order.
  /// The iterator element type is `&'a V`.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:150 values
  *values(): Generator<V> {
    switch (this.repr.$) {
      case "Array":
        for (const [_k, v] of this.repr._0) yield v;
        return;
      case "Map":
        yield* this.repr._0.values();
        return;
    }
  }

  /// An iterator visiting all values mutably in arbitrary order.
  /// The iterator element type is `&'a mut V`.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:159 values_mut
  *values_mut(): Generator<MutRef<V>> {
    switch (this.repr.$) {
      case "Array":
        for (const pair of this.repr._0) yield field_mut(pair, 1);
        return;
      case "Map":
        for (const [_k, v] of fx_iter_mut(this.repr._0)) yield v;
        return;
    }
  }

  /// Clears the map, returning all key-value pairs as an iterator. Keeps the
  /// allocated memory for reuse.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:168 drain
  drain(): IterableIterator<[K, V]> {
    switch (this.repr.$) {
      case "Array":
        return this.repr._0.splice(0).values();
      case "Map":
        return fx_drain(this.repr._0).values();
    }
  }

  // ---- impl<K: Eq + Hash, V> SsoHashMap<K, V> ----

  /// Changes underlying storage from array to hashmap
  /// if array is full.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:179 migrate_if_full
  migrate_if_full(): void {
    if (this.repr.$ === "Array") {
      const array = this.repr._0;
      if (array.length === SSO_ARRAY_SIZE) {
        this.repr = { $: "Map", _0: this.collect_map(array.splice(0)) };
      }
    }
  }

  /// Reserves capacity for at least `additional` more elements to be inserted
  /// in the `SsoHashMap`. The collection may reserve more space to avoid
  /// frequent reallocations.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:190 reserve
  reserve(additional: number): void {
    switch (this.repr.$) {
      case "Array": {
        const array = this.repr._0;
        if (SSO_ARRAY_SIZE < array.length + additional) {
          const map = this.collect_map(array.splice(0));
          map.reserve(additional);
          this.repr = { $: "Map", _0: map };
        }
        break;
      }
      case "Map":
        this.repr._0.reserve(additional);
        break;
    }
  }

  /// Shrinks the capacity of the map as much as possible. It will drop
  /// down as much as possible while maintaining the internal rules
  /// and possibly leaving some space in accordance with the resize policy.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:206 shrink_to_fit
  shrink_to_fit(): void {
    if (this.repr.$ === "Map") {
      const map = this.repr._0;
      if (map.size <= SSO_ARRAY_SIZE) {
        // `map.drain().collect()` into an `ArrayVec`
        this.repr = { $: "Array", _0: fx_drain(map) };
      } else {
        map.shrink_to_fit();
      }
    }
  }

  /// Retains only the elements specified by the predicate.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:217 retain
  retain(f: (k: K, v: V) => boolean): void {
    switch (this.repr.$) {
      case "Array": {
        // `ArrayVec::retain`: keeps the order of the retained elements.
        const array = this.repr._0;
        let j = 0;
        for (let i = 0; i < array.length; i++) {
          const pair = array[i]!;
          if (f(pair[0], pair[1])) array[j++] = pair;
        }
        array.length = j;
        break;
      }
      case "Map":
        this.repr._0.retain(f);
        break;
    }
  }

  /// Inserts a key-value pair into the map.
  ///
  /// If the map did not have this key present, [`None`] is returned.
  ///
  /// If the map did have this key present, the value is updated, and the old
  /// value is returned. The key is not updated, though; this matters for
  /// types that can be `==` without being identical. See the [module-level
  /// documentation] for more.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:235 insert
  insert(key: K, value: V): Some<V> | undefined {
    switch (this.repr.$) {
      case "Array": {
        const array = this.repr._0;
        for (const pair of array) {
          if (pair[0] === key) {
            const old_value = pair[1];
            pair[1] = value;
            return { $: "Some", _0: old_value };
          }
        }
        // `array.try_push((key, value))`
        if (array.length < SSO_ARRAY_SIZE) {
          array.push([key, value]);
        } else {
          const map = this.collect_map(array.splice(0));
          map.set(key, value);
          this.repr = { $: "Map", _0: map };
        }
        return undefined;
      }
      case "Map":
        return fx_insert(this.repr._0, key, value);
    }
  }

  /// Removes a key from the map, returning the value at the key if the key
  /// was previously in the map.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:258 remove
  remove(key: K): Some<V> | undefined {
    switch (this.repr.$) {
      case "Array": {
        const array = this.repr._0;
        const index = array.findIndex(([k, _v]) => k === key);
        return index === -1 ? undefined : { $: "Some", _0: swap_remove(array, index)[1] };
      }

      case "Map": {
        const r = fx_remove_entry(this.repr._0, key);
        return r === undefined ? undefined : { $: "Some", _0: r[1] };
      }
    }
  }

  /// Removes a key from the map, returning the stored key and value if the
  /// key was previously in the map.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:270 remove_entry
  remove_entry(key: K): [K, V] | undefined {
    switch (this.repr.$) {
      case "Array": {
        const array = this.repr._0;
        const index = array.findIndex(([k, _v]) => k === key);
        return index === -1 ? undefined : swap_remove(array, index);
      }
      case "Map":
        return fx_remove_entry(this.repr._0, key);
    }
  }

  /// Returns a reference to the value corresponding to the key.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:280 get
  get(key: K): V | undefined {
    switch (this.repr.$) {
      case "Array": {
        for (const [k, v] of this.repr._0) {
          if (k === key) {
            return v;
          }
        }
        return undefined;
      }
      case "Map":
        return this.repr._0.get(key);
    }
  }

  /// Returns a mutable reference to the value corresponding to the key.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:295 get_mut
  get_mut(key: K): MutRef<V> | undefined {
    switch (this.repr.$) {
      case "Array": {
        for (const pair of this.repr._0) {
          if (pair[0] === key) {
            return field_mut(pair, 1);
          }
        }
        return undefined;
      }
      case "Map":
        return fx_get_mut(this.repr._0, key);
    }
  }

  /// Returns the key-value pair corresponding to the supplied key.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:310 get_key_value
  get_key_value(key: K): readonly [K, V] | undefined {
    switch (this.repr.$) {
      case "Array": {
        for (const [k, v] of this.repr._0) {
          if (k === key) {
            return [k, v];
          }
        }
        return undefined;
      }
      case "Map": {
        const map = this.repr._0;
        return map.has(key) ? [key, map.get(key) as V] : undefined;
      }
    }
  }

  /// Returns `true` if the map contains a value for the specified key.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:325 contains_key
  contains_key(key: K): boolean {
    switch (this.repr.$) {
      case "Array":
        return this.repr._0.some(([k, _v]) => k === key);
      case "Map":
        return this.repr._0.has(key);
    }
  }

  /// Gets the given key's corresponding entry in the map for in-place manipulation.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:334 entry
  entry(key: K): Entry<K, V> {
    return new Entry(this, key);
  }

  // ---- impl Default ----

  // rustc: compiler/rustc_data_structures/src/sso/map.rs:341 default
  static default<K, V>(key: KeyType<K>, value: Layout): SsoHashMap<K, V> {
    return SsoHashMap.new(key, value);
  }

  // ---- impl FromIterator<(K, V)> ----

  // rustc: compiler/rustc_data_structures/src/sso/map.rs:347 from_iter
  static from_iter<K, V>(iter: Iterable<readonly [K, V]>, size_hint_lower: number, key: KeyType<K>, value: Layout): SsoHashMap<K, V> {
    const map: SsoHashMap<K, V> = SsoHashMap.default(key, value);
    map.extend(iter, size_hint_lower);
    return map;
  }

  // ---- impl Extend<(K, V)> ----

  // rustc: compiler/rustc_data_structures/src/sso/map.rs:355 extend
  extend(iter: Iterable<readonly [K, V]>, size_hint_lower: number): void {
    this.reserve(size_hint_lower);
    for (const [key, value] of iter) {
      this.insert(key, value);
    }
  }

  // rustc: compiler/rustc_data_structures/src/sso/map.rs:367 extend_one
  extend_one([k, v]: readonly [K, V]): void {
    this.insert(k, v);
  }

  // rustc: compiler/rustc_data_structures/src/sso/map.rs:371 extend_reserve
  extend_reserve(additional: number): void {
    switch (this.repr.$) {
      case "Array": {
        const array = this.repr._0;
        if (SSO_ARRAY_SIZE < array.length + additional) {
          const map = this.collect_map(array.splice(0));
          fx_extend_reserve(map, additional);
          this.repr = { $: "Map", _0: map };
        }
        break;
      }
      case "Map":
        fx_extend_reserve(this.repr._0, additional);
        break;
    }
  }

  // ---- impl Extend<(&K, &V)> (K: Copy, V: Copy) ----
  // PORT: the methods of this second `Extend` impl are suffixed `_ref`.

  // rustc: compiler/rustc_data_structures/src/sso/map.rs:390 extend
  extend_ref(iter: Iterable<readonly [K, V]>, size_hint_lower: number): void {
    this.extend(iter, size_hint_lower);
  }

  // rustc: compiler/rustc_data_structures/src/sso/map.rs:395 extend_one
  extend_one_ref([k, v]: readonly [K, V]): void {
    this.insert(k, v);
  }

  // rustc: compiler/rustc_data_structures/src/sso/map.rs:400 extend_reserve
  extend_reserve_ref(additional: number): void {
    this.extend_reserve(additional);
  }

  // ---- impl IntoIterator for SsoHashMap / &SsoHashMap / &mut SsoHashMap ----

  // rustc: compiler/rustc_data_structures/src/sso/map.rs:412 into_iter
  *into_iter(): Generator<[K, V]> {
    switch (this.repr.$) {
      case "Array":
        for (const pair of this.repr._0) yield pair;
        return;
      case "Map":
        for (const [k, v] of this.repr._0) yield [k, v];
        return;
    }
  }

  // rustc: compiler/rustc_data_structures/src/sso/map.rs:444 into_iter
  *into_iter_ref(): Generator<readonly [K, V]> {
    switch (this.repr.$) {
      case "Array":
        for (const pair of this.repr._0) yield adapt_array_ref_it(pair);
        return;
      case "Map":
        yield* this.repr._0.entries();
        return;
    }
  }

  // rustc: compiler/rustc_data_structures/src/sso/map.rs:462 into_iter
  *into_iter_mut(): Generator<readonly [K, MutRef<V>]> {
    switch (this.repr.$) {
      case "Array":
        for (const pair of this.repr._0) yield adapt_array_mut_it(pair);
        return;
      case "Map":
        yield* fx_iter_mut(this.repr._0);
        return;
    }
  }

  // ---- impl Index<&K> ----

  // rustc: compiler/rustc_data_structures/src/sso/map.rs:487 index
  index(key: K): V {
    // `self.get(key).expect("no entry found for key")` (PORT: `V` may be `()`, i.e. `undefined`)
    const v = this.get(key);
    if (v === undefined && !this.contains_key(key)) panic("no entry found for key");
    return v as V;
  }

  /** `array.drain(..).collect::<FxHashMap<K, V>>()`: std's `FromIterator` with the drain's exact size hint. */
  private collect_map(drained: [K, V][]): FxHashMap<K, V> {
    return FxHashMap.from_iter(drained, drained.length, this.key, this.value);
  }
}

/// adapts Item of array reference iterator to Item of hashmap reference iterator.
// rustc: compiler/rustc_data_structures/src/sso/map.rs:422 adapt_array_ref_it
function adapt_array_ref_it<K, V>(pair: readonly [K, V]): readonly [K, V] {
  const [a, b] = pair;
  return [a, b];
}

/// adapts Item of array mut reference iterator to Item of hashmap mut reference iterator.
// rustc: compiler/rustc_data_structures/src/sso/map.rs:429 adapt_array_mut_it
function adapt_array_mut_it<K, V>(pair: [K, V]): readonly [K, MutRef<V>] {
  return [pair[0], field_mut(pair, 1)];
}

/** `impl fmt::Debug for SsoHashMap` */
// rustc: compiler/rustc_data_structures/src/sso/map.rs:475 fmt
export function debug_SsoHashMap<K, V>(self: SsoHashMap<K, V>, f: Fmt, debug_K: Debug<K>, debug_V: Debug<V>): string {
  const entries: [string, string][] = [];
  for (const [k, v] of self.iter()) entries.push([debug_K(k, f), debug_V(v, f)]);
  return debug_map(f, entries);
}

/// A view into a single entry in a map.
export class Entry<K, V> {
  constructor(
    public ssomap: SsoHashMap<K, V>,
    public key_: K,
  ) {}

  /// Provides in-place mutable access to an occupied entry before any
  /// potential inserts into the map.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:501 and_modify
  and_modify(f: (value: MutRef<V>) => void): Entry<K, V> {
    const value = this.ssomap.get_mut(this.key_);
    if (value !== undefined) {
      f(value);
    }
    return this;
  }

  /// Ensures a value is in the entry by inserting the default if empty, and returns
  /// a mutable reference to the value in the entry.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:514 or_insert
  or_insert(value: V): MutRef<V> {
    return this.or_insert_with(() => value);
  }

  /// Ensures a value is in the entry by inserting the result of the default function if empty,
  /// and returns a mutable reference to the value in the entry.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:520 or_insert_with
  or_insert_with(default_: () => V): MutRef<V> {
    this.ssomap.migrate_if_full();
    const repr = this.ssomap.repr;
    switch (repr.$) {
      case "Array": {
        const array = repr._0;
        const key_ref = this.key_;
        const found_index = array.findIndex(([k, _v]) => k === key_ref);
        let index: number;
        if (found_index !== -1) {
          index = found_index;
        } else {
          index = array.length;
          // `array.try_push((self.key, default())).unwrap()`
          const pair: [K, V] = [this.key_, default_()];
          if (array.length >= SSO_ARRAY_SIZE) panic("called `Result::unwrap()` on an `Err` value: CapacityError: insufficient capacity");
          array.push(pair);
        }
        return field_mut(array[index]!, 1);
      }
      case "Map":
        return fx_entry_or_insert_with(repr._0, this.key_, default_);
    }
  }

  /// Returns a reference to this entry's key.
  // PORT: the field `key` is `key_` (the method of the same name returns it).
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:541 key
  key(): K {
    return this.key_;
  }

  /// Ensures a value is in the entry by inserting the default value if empty,
  /// and returns a mutable reference to the value in the entry.
  // PORT: `V: Default` is `V_default`.
  // rustc: compiler/rustc_data_structures/src/sso/map.rs:550 or_default
  or_default(V_default: () => V): MutRef<V> {
    return this.or_insert_with(V_default);
  }
}

// ---- `ArrayVec` and std `HashMap` operations not provided by `FxHashMap` ----

/** `ArrayVec::swap_remove(index)`: the last element takes the removed one's place. */
function swap_remove<T>(array: T[], index: number): T {
  const last = array.pop() as T;
  if (index < array.length) {
    const removed = array[index]!;
    array[index] = last;
    return removed;
  }
  return last;
}

/** `HashMap::insert` returning the old value (`Option<V>`). */
function fx_insert<K, V>(map: FxHashMap<K, V>, key: K, value: V): Some<V> | undefined {
  const had = map.has(key);
  const old = map.get(key) as V;
  map.set(key, value);
  return had ? { $: "Some", _0: old } : undefined;
}

/** `HashMap::remove_entry` */
function fx_remove_entry<K, V>(map: FxHashMap<K, V>, key: K): [K, V] | undefined {
  if (!map.has(key)) return undefined;
  const value = map.get(key) as V;
  map.delete(key);
  return [key, value];
}

/** `HashMap::drain`: every entry in iteration order, leaving the map empty (capacity kept). */
function fx_drain<K, V>(map: FxHashMap<K, V>): [K, V][] {
  const out: [K, V][] = [];
  for (const [k, v] of map) out.push([k, v]);
  map.clear();
  return out;
}

/** `&mut V` of a hashbrown bucket `slot`: writes go to the bucket and to the JS `Map`. */
function fx_slot_mut<K, V>(map: FxHashMap<K, V>, slot: [K, V]): MutRef<V> {
  return {
    get value(): V {
      return slot[1];
    },
    set value(v: V) {
      slot[1] = v;
      Map.prototype.set.call(map, slot[0], v);
    },
  };
}

/** `HashMap::get_mut` */
function fx_get_mut<K, V>(map: FxHashMap<K, V>, key: K): MutRef<V> | undefined {
  if (!map.has(key)) return undefined;
  const base = map.base;
  const slot = base.table.get(make_hash<K>(base.hash_builder, key, base.K_hash), equivalent_key<K, K, V>(key));
  if (slot === undefined) return undefined;
  return fx_slot_mut(map, slot);
}

/** `HashMap::iter_mut` */
function* fx_iter_mut<K, V>(map: FxHashMap<K, V>): Generator<readonly [K, MutRef<V>]> {
  for (const slot of map.base.iter()) yield [slot[0], fx_slot_mut(map, slot as [K, V])];
}

/** `HashMap::entry(key).or_insert_with(default)` (hashbrown's `rustc_entry`: `reserve(1)` only when
 * the key is vacant, then the insertion `insert` would do). */
function fx_entry_or_insert_with<K, V>(map: FxHashMap<K, V>, key: K, default_: () => V): MutRef<V> {
  if (!map.has(key)) map.set(key, default_());
  return fx_get_mut(map, key)!;
}

/** `Extend::extend_reserve` of std's `HashMap` (hashbrown's: the whole hint when empty, else half
 * of it rounded up). */
function fx_extend_reserve<K, V>(map: FxHashMap<K, V>, additional: number): void {
  const reserve = map.size === 0 ? additional : Math.ceil(additional / 2);
  map.reserve(reserve);
}
