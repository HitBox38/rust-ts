// Port of compiler/rustc_data_structures/src/sorted_map/index_map.rs (lane ty-adt-assoc: `ty::AssocItems` is built on
// it).
//
//! A variant of `SortedMap` that preserves insertion order.
//
// PORT: `I: Idx` is a number (PORTING §5: `IndexVec<I, T>` is `T[]` indexed by the handle number). `K: Ord` is a
// `cmp` function (as in ../sorted_map.ts), passed to `new` / `from_iter`; `K: PartialEq` (`k == &key`) is
// `cmp(k, key) === 0`, which agrees with `==` for every key type used (`Option<Symbol>`). The iterators are
// generators (lazy, like upstream). `sorted_map.rs`'s `pub use index_map::SortedIndexMultiMap` is a re-export in
// ../sorted_map.ts (merge-w15b).
import type { Cmp } from "../sorted_map.ts";
import { type Debug, debug_struct, debug_tuple, debug_vec, type Fmt } from "../../std/fmt.ts";

/// An indexed multi-map that preserves insertion order while permitting both *O*(log *n*) lookup of
/// an item by key and *O*(1) lookup by index.
///
/// This data structure is a hybrid of an [`IndexVec`] and a [`SortedMap`]. Like `IndexVec`,
/// `SortedIndexMultiMap` assigns a typed index to each item while preserving insertion order.
/// Like `SortedMap`, `SortedIndexMultiMap` has efficient lookup of items by key. However, this
/// is accomplished by sorting an array of item indices instead of the items themselves.
///
/// Unlike `SortedMap`, this data structure can hold multiple equivalent items at once, so the
/// `get_by_key` method and its variants return an iterator instead of an `Option`. Equivalent
/// items will be yielded in insertion order.
///
/// Unlike a general-purpose map like `BTreeSet` or `HashSet`, `SortedMap` and
/// `SortedIndexMultiMap` require *O*(*n*) time to insert a single item. This is because we may need
/// to insert into the middle of the sorted array. Users should avoid mutating this data structure
/// in-place.
///
/// [`SortedMap`]: super::SortedMap
export class SortedIndexMultiMap<I extends number, K, V> {
  constructor(
    /// The elements of the map in insertion order.
    public items: [K, V][],

    // We can ignore this field because it is not observable from the outside.
    /// Indices of the items in the set, sorted by the item's key.
    public idx_sorted_by_item_key: I[],

    /** PORT: `K: Ord` (module comment). */
    readonly cmp: Cmp<K>,
  ) {}

  // rustc: compiler/rustc_data_structures/src/sorted_map/index_map.rs:39 new
  static new<I extends number, K, V>(cmp: Cmp<K>): SortedIndexMultiMap<I, K, V> {
    return new SortedIndexMultiMap<I, K, V>([], [], cmp);
  }

  // rustc: compiler/rustc_data_structures/src/sorted_map/index_map.rs:44 len
  len(): number {
    return this.items.length;
  }

  // rustc: compiler/rustc_data_structures/src/sorted_map/index_map.rs:49 is_empty
  is_empty(): boolean {
    return this.items.length === 0;
  }

  /// Returns an iterator over the items in the map in insertion order.
  // rustc: compiler/rustc_data_structures/src/sorted_map/index_map.rs:55 into_iter
  *into_iter(): Generator<[K, V]> {
    yield* this.items;
  }

  /// Returns an iterator over the items in the map in insertion order along with their indices.
  // rustc: compiler/rustc_data_structures/src/sorted_map/index_map.rs:61 into_iter_enumerated
  *into_iter_enumerated(): Generator<[I, [K, V]]> {
    for (let i = 0; i < this.items.length; i++) yield [i as I, this.items[i]!];
  }

  /// Returns an iterator over the items in the map in insertion order.
  // rustc: compiler/rustc_data_structures/src/sorted_map/index_map.rs:67 iter
  *iter(): Generator<[K, V]> {
    for (const [k, v] of this.items) yield [k, v];
  }

  /// Returns an iterator over the items in the map in insertion order along with their indices.
  // rustc: compiler/rustc_data_structures/src/sorted_map/index_map.rs:73 iter_enumerated
  *iter_enumerated(): Generator<[I, [K, V]]> {
    for (let i = 0; i < this.items.length; i++) {
      const [k, v] = this.items[i]!;
      yield [i as I, [k, v]];
    }
  }

  /// Returns the item in the map with the given index.
  // rustc: compiler/rustc_data_structures/src/sorted_map/index_map.rs:79 get
  get(idx: I): [K, V] | undefined {
    return this.items[idx];
  }

  /// Returns an iterator over the items in the map that are equal to `key`.
  ///
  /// If there are multiple items that are equivalent to `key`, they will be yielded in
  /// insertion order.
  // rustc: compiler/rustc_data_structures/src/sorted_map/index_map.rs:88 get_by_key
  *get_by_key(key: K): Generator<V> {
    for (const [, v] of this.get_by_key_enumerated(key)) yield v;
  }

  /// Returns an iterator over the items in the map that are equal to `key` along with their
  /// indices.
  ///
  /// If there are multiple items that are equivalent to `key`, they will be yielded in
  /// insertion order.
  // rustc: compiler/rustc_data_structures/src/sorted_map/index_map.rs:98 get_by_key_enumerated
  *get_by_key_enumerated(key: K): Generator<[I, V]> {
    // `partition_point(|&i| self.items[i].0 < key)`: the first index whose item key is not `< key`.
    const sorted = this.idx_sorted_by_item_key;
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.cmp(this.items[sorted[mid]!]![0], key) < 0) lo = mid + 1;
      else hi = mid;
    }
    const lower_bound = lo;
    // `map_while`: stop at the first item whose key differs.
    for (let j = lower_bound; j < sorted.length; j++) {
      const i = sorted[j]!;
      const [k, v] = this.items[i]!;
      if (this.cmp(k, key) !== 0) return;
      yield [i, v];
    }
  }

  // rustc: compiler/rustc_data_structures/src/sorted_map/index_map.rs:107 contains_key
  contains_key(key: K): boolean {
    return !this.get_by_key(key).next().done;
  }

  // PORT: `impl PartialEq` with `K: PartialEq, V: PartialEq` as the function `eq_KV` over items.
  // rustc: compiler/rustc_data_structures/src/sorted_map/index_map.rs:114 eq
  eq(other: SortedIndexMultiMap<I, K, V>, eq_KV: (a: [K, V], b: [K, V]) => boolean): boolean {
    // No need to compare the sorted index. If the items are the same, the index will be too.
    return this.items.length === other.items.length && this.items.every((item, i) => eq_KV(item, other.items[i]!));
  }

  // PORT: `impl Hash` as the canonical key string (rust_ts/intern_key.ts convention: `Hash` + `Eq` as a string);
  // `hash_KV` keys one item.
  // rustc: compiler/rustc_data_structures/src/sorted_map/index_map.rs:125 hash
  hash(hash_KV: (item: [K, V]) => string): string {
    return `[${this.items.map(hash_KV).join(",")}]`;
  }

  // rustc: compiler/rustc_data_structures/src/sorted_map/index_map.rs:131 from_iter
  static from_iter<I extends number, K, V>(iter: Iterable<[K, V]>, cmp: Cmp<K>): SortedIndexMultiMap<I, K, V> {
    const items: [K, V][] = [...iter];
    const idx_sorted_by_item_key: I[] = items.map((_, i) => i as I);

    // `sort_by_key` is stable, so insertion order is preserved for duplicate items.
    idx_sorted_by_item_key.sort((a, b) => cmp(items[a]![0], items[b]![0]));

    return new SortedIndexMultiMap(items, idx_sorted_by_item_key, cmp);
  }

  // rustc: compiler/rustc_data_structures/src/sorted_map/index_map.rs:148 index
  index(idx: I): V {
    return this.items[idx]![1];
  }
}

/** `#[derive(Debug)]` (`SortedIndexMultiMap { items: [..], idx_sorted_by_item_key: [..] }`); `I` prints as its number. */
export function debug_SortedIndexMultiMap<I extends number, K, V>(
  v: SortedIndexMultiMap<I, K, V>,
  f: Fmt,
  debug_K: Debug<K>,
  debug_V: Debug<V>,
): string {
  return debug_struct(f, "SortedIndexMultiMap", [
    ["items", debug_vec(v.items, f, ([k, val], f) => debug_tuple(f, "", [debug_K(k, f), debug_V(val, f)]))],
    ["idx_sorted_by_item_key", debug_vec(v.idx_sorted_by_item_key, f, (i) => String(i))],
  ]);
}
