// Port of litemap 0.8.1 `src/map.rs` (subset used by icu_locale_core's `Keywords` / transform
// `Fields`; see docs/handoff/icu-list.md).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: `LiteMap<K, V, S>` is a class over a sorted `[K, V][]` (the store `S`; icu_locale_core uses
// `ShortBoxSlice<(K, V)>`, whose `Store` impl is the slice's own `get`/`binary_search_by`/`insert`).
// `K: Ord` is passed as the comparison function `cmp` at construction (trait dispatch → function).
import { Err, Ok, type Result } from "../../std/result.ts";

export type Ordering = -1 | 0 | 1;

/**
 * PORT: core `<[T]>::binary_search_by` at the pin (a private copy, like the ones in
 * intl_pluralrules/lib.ts and unic_langid_impl/likelysubtags/mod.ts; belongs in src/std).
 */
export function binary_search_by<T>(v: readonly T[], f: (x: T) => Ordering): Result<number, number> {
  let size = v.length;
  if (size === 0) {
    return Err(0);
  }
  let base = 0;

  // This loop intentionally doesn't have an early exit if the comparison
  // returns Equal. We want the number of loop iterations to depend *only*
  // on the size of the input slice so that the CPU can reliably predict
  // the loop count.
  while (size > 1) {
    const half = Math.floor(size / 2);
    const mid = base + half;

    const cmp = f(v[mid]!);

    base = cmp === 1 ? base : mid;

    size -= half;
  }

  const cmp = f(v[base]!);
  if (cmp === 0) {
    return Ok(base);
  } else {
    const result = base + (cmp === -1 ? 1 : 0);
    return Err(result);
  }
}

/// A simple "flat" map based on a sorted vector
export class LiteMap<K, V> {
  constructor(
    public values: [K, V][],
    readonly cmp: (a: K, b: K) => Ordering,
  ) {}

  /// Construct a new [`LiteMap`] using the given values
  ///
  /// The store must be sorted and have no duplicate keys.
  // crate: litemap-0.8.1/src/map.rs:59 from_sorted_store_unchecked
  static from_sorted_store_unchecked<K, V>(values: [K, V][], cmp: (a: K, b: K) => Ordering): LiteMap<K, V> {
    return new LiteMap(values, cmp);
  }

  /// Create a new empty [`LiteMap`]
  // crate: litemap-0.8.1/src/map.rs:84 new
  static new<K, V>(cmp: (a: K, b: K) => Ordering): LiteMap<K, V> {
    return new LiteMap<K, V>([], cmp);
  }

  /// The number of elements in the [`LiteMap`]
  // crate: litemap-0.8.1/src/map.rs:98 len
  len(): number {
    return this.values.length;
  }

  /// Whether the [`LiteMap`] is empty
  // crate: litemap-0.8.1/src/map.rs:103 is_empty
  is_empty(): boolean {
    return this.values.length === 0;
  }

  /// Get the key-value pair residing at a particular index
  ///
  /// In most cases, prefer [`LiteMap::get()`] over this method.
  // crate: litemap-0.8.1/src/map.rs:111 get_indexed
  get_indexed(index: number): [K, V] | undefined {
    return this.values[index];
  }

  /// Get the value associated with `key`, if it exists.
  // crate: litemap-0.8.1/src/map.rs:287 get
  get(key: K): V | undefined {
    const r = this.find_index(key);
    if (r.$ === "Ok") {
      return this.values[r._0]![1];
    }
    return undefined;
  }

  /// Binary search the map with `predicate` to find a key, returning the value.
  // crate: litemap-0.8.1/src/map.rs:300 get_by
  get_by(predicate: (k: K) => Ordering): V | undefined {
    const r = binary_search_by(this.values, ([k]) => predicate(k));
    if (r.$ === "Err") return undefined;
    return this.values[r._0]?.[1];
  }

  /// Returns whether `key` is contained in this map
  // crate: litemap-0.8.1/src/map.rs:316 contains_key
  contains_key(key: K): boolean {
    return this.find_index(key).$ === "Ok";
  }

  /// Obtain the index for a given key, or if the key is not found, the index
  /// at which it would be inserted.
  ///
  /// (The return value works equivalently to [`slice::binary_search_by()`])
  ///
  /// The indices returned can be used with [`Self::get_indexed()`]. Prefer using
  /// [`Self::get()`] directly where possible.
  // crate: litemap-0.8.1/src/map.rs:332 find_index
  find_index(key: K): Result<number, number> {
    return binary_search_by(this.values, ([k]) => this.cmp(k, key));
  }

  /// Insert `value` with `key`, returning the existing value if it exists.
  // crate: litemap-0.8.1/src/map.rs:642 insert
  insert(key: K, value: V): V | undefined {
    const r = this.insert_save_key(key, value);
    return r === undefined ? undefined : r[1];
  }

  /// Version of [`Self::insert()`] that returns both the key and the old value.
  // crate: litemap-0.8.1/src/map.rs:647 insert_save_key
  insert_save_key(key: K, value: V): [K, V] | undefined {
    const r = binary_search_by(this.values, ([k]) => this.cmp(k, key));
    if (r.$ === "Ok") {
      const found = r._0;
      const old = this.values[found]![1];
      this.values[found]![1] = value;
      return [key, old];
    } else {
      this.values.splice(r._0, 0, [key, value]);
      return undefined;
    }
  }

  /// Attempts to insert a unique entry into the map.
  ///
  /// If `key` is not already in the map, inserts it with the corresponding `value`
  /// and returns `None`.
  ///
  /// If `key` is already in the map, no change is made to the map, and the key and value
  /// are returned back to the caller.
  // crate: litemap-0.8.1/src/map.rs:684 try_insert
  try_insert(key: K, value: V): [K, V] | undefined {
    const r = binary_search_by(this.values, ([k]) => this.cmp(k, key));
    if (r.$ === "Ok") {
      return [key, value];
    } else {
      this.values.splice(r._0, 0, [key, value]);
      return undefined;
    }
  }

  /// Remove the value at `key`, returning it if it exists.
  // crate: litemap-0.8.1/src/map.rs:763 remove
  remove(key: K): V | undefined {
    const r = binary_search_by(this.values, ([k]) => this.cmp(k, key));
    if (r.$ === "Ok") {
      return this.values.splice(r._0, 1)[0]![1];
    }
    return undefined;
  }

  // crate-skip: litemap-0.8.1/src/map.rs:893 from_iter `FromIterator` (store `lm_sort_from_iter`) is only used by icu_locale_core tests

  /// Produce an ordered iterator over key-value pairs
  // crate: litemap-0.8.1/src/map.rs:904 iter
  iter(): readonly [K, V][] {
    return this.values;
  }
}
