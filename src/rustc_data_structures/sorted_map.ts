// Port of compiler/rustc_data_structures/src/sorted_map.rs (partial: what crate metadata's
// `DefPathHashMapRef` reads (lane rmeta-contract), plus `default`/`new`/`insert`/`iter`/`len`/`is_empty` and the
// `StableHash`/`Debug` impls for `rustc_hir_id::definitions` and HIR (lane hir-types)).
//
// PORT: `K: Ord` is a `cmp` function (PORTING section 5: trait bounds become function tables), passed to the
// constructor (and so to `default`/`new`, which take no arguments upstream). The rest of the file (remove, range,
// `SortedIndexMultiMap`, ...) is not ported.
import { type StableHash, type StableHashCtxt, type StableHasher, stable_hash_tuple2, stable_hash_Vec } from "./stable_hash.ts";
import { type Debug, debug_map, type Fmt } from "../std/fmt.ts";
import { Err, Ok, type Result } from "../std/result.ts";

/** `Ord::cmp` as a number (< 0, 0, > 0). */
export type Cmp<K> = (a: K, b: K) => number;

/// `SortedMap` is a data structure similar to `BTreeMap` but backed by
/// a sorted `Vec`. Its `insert` and `remove` methods are O(n), so it should
/// only be used where the map is filled in sorted order or rarely mutated.
export class SortedMap<K, V> {
  constructor(
    public data: [K, V][],
    readonly cmp: Cmp<K>,
  ) {}

  // impl<K, V> Default for SortedMap<K, V>
  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:31 default
  static default<K, V>(cmp: Cmp<K>): SortedMap<K, V> {
    return new SortedMap<K, V>([], cmp);
  }

  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:38 new
  static new<K, V>(cmp: Cmp<K>): SortedMap<K, V> {
    return new SortedMap<K, V>([], cmp);
  }

  /// Construct a `SortedMap` from a presorted set of elements. This is faster
  /// than creating an empty map and then inserting the elements individually.
  ///
  /// It is up to the caller to make sure that the elements are sorted by key
  /// and that there are no duplicates.
  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:50 from_presorted_elements
  static from_presorted_elements<K, V>(elements: [K, V][], cmp: Cmp<K>): SortedMap<K, V> {
    // debug_assert!(elements.array_windows().all(|[fst, snd]| fst.0 < snd.0));

    return new SortedMap(elements, cmp);
  }

  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:57 insert
  insert(key: K, value: V): V | undefined {
    const r = this.lookup_index_for(key);
    if (r.$ === "Ok") {
      const index = r._0;
      const slot = this.data[index]!;
      // `Some(mem::replace(&mut slot.1, value))`
      const old = slot[1];
      slot[1] = value;
      return old;
    } else {
      const index = r._0;
      this.data.splice(index, 0, [key, value]);
      return undefined;
    }
  }

  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:79 get
  get(key: K): V | undefined {
    const r = this.lookup_index_for(key);
    if (r.$ === "Ok") {
      return this.data[r._0]![1];
    } else {
      return undefined;
    }
  }

  /// Iterate over elements, sorted by key
  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:126 iter
  iter(): readonly (readonly [K, V])[] {
    return this.data;
  }

  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:143 len
  len(): number {
    return this.data.length;
  }

  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:148 is_empty
  is_empty(): boolean {
    return this.len() === 0;
  }

  /// Looks up the key in `self.data` via `slice::binary_search()`.
  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:260 lookup_index_for
  lookup_index_for(key: K): Result<number, number> {
    // `self.data.binary_search_by(|(x, _)| x.borrow().cmp(key))` (core slice::binary_search_by)
    let size = this.data.length;
    if (size === 0) return Err(0);
    let base = 0;
    while (size > 1) {
      const half = size >>> 1;
      const mid = base + half;
      if (this.cmp(this.data[mid]![0], key) <= 0) base = mid;
      size -= half;
    }
    const c = this.cmp(this.data[base]![0], key);
    if (c === 0) return Ok(base);
    return Err(base + (c < 0 ? 1 : 0));
  }
}

// impl<K: StableHash + StableOrd, V: StableHash> StableHash for SortedMap<K, V>
// rustc: compiler/rustc_data_structures/src/sorted_map.rs:352 stable_hash
export function stable_hash_SortedMap<K, V>(
  self: SortedMap<K, V>,
  hcx: StableHashCtxt,
  hasher: StableHasher,
  stable_hash_K: StableHash<K>,
  stable_hash_V: StableHash<V>,
): void {
  stable_hash_Vec(self.data, hcx, hasher, (e, hcx, hasher) => stable_hash_tuple2(e, hcx, hasher, stable_hash_K, stable_hash_V));
}

// impl<K: Debug, V: Debug> Debug for SortedMap<K, V>
// rustc: compiler/rustc_data_structures/src/sorted_map.rs:358 fmt
export function debug_SortedMap<K, V>(self: SortedMap<K, V>, f: Fmt, debug_K: Debug<K>, debug_V: Debug<V>): string {
  return debug_map(
    f,
    self.data.map(([a, b]) => [debug_K(a, f), debug_V(b, f)]),
  );
}
