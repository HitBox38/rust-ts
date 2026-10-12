// Port of zerovec 0.11.7 `src/map/map.rs` (the read-only lookups used by icu_locale_fallback).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: `ZeroMap<K, V>` stores its keys and values as zero-copy byte containers
// (`ZeroVec`/`VarZeroVec`). rustc only reads baked maps, which tools/codegen/icu-data.ts decodes
// at generation time, so here the containers are plain arrays in the stored (sorted) order: `keys`
// holds each key's ULE bytes (the `Ord` of the ULE key types used here — fixed-width
// `UnvalidatedTinyAsciiStr` tuples and `PotentialUtf8` — is byte-lexicographic) and `values` the
// decoded values. `zvl_binary_search` / `zvl_binary_search_by` are core's `binary_search_by`.
import { binary_search_by } from "../../litemap/map.ts";
import { cmp_bytes, type Ordering } from "../../writeable/cmp.ts";

/// A zero-copy map datastructure, built on sorted binary-searchable [`ZeroVec`]
/// and [`VarZeroVec`].
export class ZeroMap<V> {
  constructor(
    public keys: readonly Uint8Array[],
    public values: readonly V[],
  ) {}

  /// Construct a new [`ZeroMap`] directly from the backing [`ZeroVec`]s.
  ///
  /// # Safety
  /// The keys must be sorted and unique, and the two containers must have the same length.
  // crate: zerovec-0.11.7/src/map/map.rs:103 from_parts_unchecked
  static from_parts_unchecked<V>(keys: readonly Uint8Array[], values: readonly V[]): ZeroMap<V> {
    return new ZeroMap(keys, values);
  }

  /// The number of elements in the [`ZeroMap`]
  // crate: zerovec-0.11.7/src/map/map.rs:124 len
  len(): number {
    return this.values.length;
  }

  /// Whether the [`ZeroMap`] is empty
  // crate: zerovec-0.11.7/src/map/map.rs:129 is_empty
  is_empty(): boolean {
    return this.values.length === 0;
  }

  /// Get the value associated with `key`, if it exists.
  // crate: zerovec-0.11.7/src/map/map.rs:168 get
  get(key: Uint8Array): V | undefined {
    const index = binary_search_by(this.keys, (probe) => cmp_bytes(probe, key));
    if (index.$ === "Err") return undefined;
    return this.values[index._0];
  }

  /// Binary search the map with `predicate` to find a key, returning the value.
  // crate: zerovec-0.11.7/src/map/map.rs:184 get_by
  get_by(predicate: (k: Uint8Array) => Ordering): V | undefined {
    const index = binary_search_by(this.keys, predicate);
    if (index.$ === "Err") return undefined;
    return this.values[index._0];
  }

  /// Returns whether `key` is contained in this map
  // crate: zerovec-0.11.7/src/map/map.rs:200 contains_key
  contains_key(key: Uint8Array): boolean {
    return binary_search_by(this.keys, (probe) => cmp_bytes(probe, key)).$ === "Ok";
  }

  /// For cases when `V` is fixed-size, obtain a direct copy of `V` instead of `V::ULE`.
  // crate: zerovec-0.11.7/src/map/map.rs:484 get_copied
  get_copied(key: Uint8Array): V | undefined {
    const index = binary_search_by(this.keys, (probe) => cmp_bytes(probe, key));
    if (index.$ === "Err") return undefined;
    return this.get_copied_at(index._0);
  }

  /// Binary search the map with `predicate` to find a key, returning the value.
  ///
  /// For cases when `V` is fixed-size, use this method to obtain a direct copy of `V`
  /// instead of `V::ULE`.
  // crate: zerovec-0.11.7/src/map/map.rs:506 get_copied_by
  get_copied_by(predicate: (k: Uint8Array) => Ordering): V | undefined {
    const index = binary_search_by(this.keys, predicate);
    if (index.$ === "Err") return undefined;
    return this.get_copied_at(index._0);
  }

  // crate: zerovec-0.11.7/src/map/map.rs:511 get_copied_at
  get_copied_at(index: number): V | undefined {
    return this.values[index];
  }
}
