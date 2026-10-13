// Port of compiler/rustc_data_structures/src/sorted_map.rs (partial: what crate metadata's
// `DefPathHashMapRef` reads; lane rmeta-contract).
//
// PORT: `K: Ord` is a `cmp` function (PORTING section 5: trait bounds become function tables), passed to the
// constructor. The rest of the file (insert, remove, range, iteration, `SortedIndexMultiMap`) is not ported.
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

  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:79 get
  get(key: K): V | undefined {
    const r = this.lookup_index_for(key);
    if (r.$ === "Ok") {
      return this.data[r._0]![1];
    } else {
      return undefined;
    }
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
