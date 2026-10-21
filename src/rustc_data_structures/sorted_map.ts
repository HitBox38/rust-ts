// Port of compiler/rustc_data_structures/src/sorted_map.rs (partial: what crate metadata's
// `DefPathHashMapRef` reads (lane rmeta-contract), plus `default`/`new`/`insert`/`iter`/`len`/`is_empty` and the
// `StableHash`/`Debug` impls for `rustc_hir_id::definitions` and HIR (lane hir-types)).
//
// PORT: `K: Ord` is a `cmp` function (PORTING section 5: trait bounds become function tables), passed to the
// constructor (and so to `default`/`new`, which take no arguments upstream). The rest of the file (remove, range,
// ...) is not ported. `SortedIndexMultiMap` is sorted_map/index_map.ts (re-exported below, as upstream's `pub use`).
// Rest of the file ported by lane index-ds.
//
// PORT (index-ds): `R: RangeBounds<K>` is a `RangeBounds<K>` object (`{ start_bound, end_bound }` of `Bound<K>`s, the
// values of `RangeBounds::start_bound()` / `end_bound()`); `range(a, b)` builds `a..b`. `&mut V` returns
// (`get_mut`, `get_mut_or_insert_default`, `index_mut`) are the value itself (an object is mutated in place; a
// primitive is written back with `insert`). `V: Default` is a `default_V` thunk.
import { type StableHash, type StableHashCtxt, type StableHasher, stable_hash_tuple2, stable_hash_Vec } from "./stable_hash.ts";
import { type Debug, debug_map, type Fmt } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { panic } from "../std/panic.ts";
import { binary_search_by, splice } from "../std/slice.ts";
import { type SortLayout, slice_sort_unstable_by } from "../std/slice_sort.ts";
import { Err, Ok, type Result } from "../std/result.ts";

export { SortedIndexMultiMap } from "./sorted_map/index_map.ts";

/** `Ord::cmp` as a number (< 0, 0, > 0). */
export type Cmp<K> = (a: K, b: K) => number;

/** PORT: `std::ops::Bound<K>`. */
export type Bound<K> = { readonly $: "Included"; readonly _0: K } | { readonly $: "Excluded"; readonly _0: K } | { readonly $: "Unbounded" };

/** PORT: an `impl RangeBounds<K>`: its `start_bound()` / `end_bound()`. */
export interface RangeBounds<K> {
  readonly start_bound: Bound<K>;
  readonly end_bound: Bound<K>;
}

/** `start..end` as a `RangeBounds<K>`. */
export function range<K>(start: K, end: K): RangeBounds<K> {
  return { start_bound: { $: "Included", _0: start }, end_bound: { $: "Excluded", _0: end } };
}

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

  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:71 remove
  remove(key: K): V | undefined {
    const r = this.lookup_index_for(key);
    if (r.$ === "Ok") {
      return this.data.splice(r._0, 1)[0]![1];
    } else {
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

  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:91 get_mut
  get_mut(key: K): V | undefined {
    const r = this.lookup_index_for(key);
    if (r.$ === "Ok") {
      return this.data[r._0]![1];
    } else {
      return undefined;
    }
  }

  /// Gets a mutable reference to the value in the entry, or insert a new one.
  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:104 get_mut_or_insert_default
  get_mut_or_insert_default(key: K, default_V: () => V): V {
    const r = this.lookup_index_for(key);
    let index: number;
    if (r.$ === "Ok") {
      index = r._0;
    } else {
      index = r._0;
      this.data.splice(index, 0, [key, default_V()]);
    }
    return this.data[index]![1];
  }

  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:120 clear
  clear(): void {
    this.data.length = 0;
  }

  /// Iterate over elements, sorted by key
  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:126 iter
  iter(): readonly (readonly [K, V])[] {
    return this.data;
  }

  /// Iterate over the keys, sorted
  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:132 keys
  keys(): K[] {
    return this.data.map(([k, _]) => k);
  }

  /// Iterate over values, sorted by key
  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:138 values
  values(): V[] {
    return this.data.map(([_, v]) => v);
  }

  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:143 len
  len(): number {
    return this.data.length;
  }

  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:148 is_empty
  is_empty(): boolean {
    return this.len() === 0;
  }

  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:153 range
  range(range: RangeBounds<K>): readonly (readonly [K, V])[] {
    const [start, end] = this.range_slice_indices(range);
    return this.data.slice(start, end);
  }

  /// `sm.range_is_empty(r)` == `sm.range(r).is_empty()`, but is faster.
  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:163 range_is_empty
  range_is_empty(range: RangeBounds<K>): boolean {
    // `range` must (via `range_slice_indices`) search for the start and
    // end separately. But here we can do a single binary search for the
    // entire range. If a single `x` matching `range` is found then the
    // range is *not* empty.
    return !binary_search_by(this.data, ([x, _]) => {
      // Is `x` below `range`?
      const start = range.start_bound;
      if (start.$ === "Included" && this.cmp(x, start._0) < 0) return -1;
      if (start.$ === "Excluded" && this.cmp(x, start._0) <= 0) return -1;

      // Is `x` above `range`?
      const end = range.end_bound;
      if (end.$ === "Included" && this.cmp(x, end._0) > 0) return 1;
      if (end.$ === "Excluded" && this.cmp(x, end._0) >= 0) return 1;

      // `x` must be within `range`.
      return 0;
    }).ok;
  }

  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:194 remove_range
  remove_range(range: RangeBounds<K>): void {
    const [start, end] = this.range_slice_indices(range);
    splice(this.data, start, end - start, []);
  }

  /// Mutate all keys with the given function `f`. This mutation must not
  /// change the sort-order of keys.
  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:205 offset_keys
  offset_keys(f: (k: MutRef<K>) => void): void {
    for (const e of this.data) {
      const k: MutRef<K> = { value: e[0] };
      f(k);
      e[0] = k.value;
    }
  }

  /// Inserts a presorted range of elements into the map. If the range can be
  /// inserted as a whole in between to existing elements of the map, this
  /// will be faster than inserting the elements individually.
  ///
  /// It is up to the caller to make sure that the elements are sorted by key
  /// and that there are no duplicates.
  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:219 insert_presorted
  insert_presorted(
    // We require `TrustedLen` to ensure that the `splice` below is actually efficient.
    // PORT: the `Iterator + DoubleEndedIterator + TrustedLen` is an array, consumed from both ends through
    // `front`/`back` (`next()` / `next_back()`).
    elements: readonly [K, V][],
  ): void {
    let front = 0;
    let back = elements.length;
    if (front === back) {
      return;
    }
    const first = elements[front++]!;

    const start_index = this.lookup_index_for(first[0]);

    let rest: [K, V][];
    if (start_index.$ === "Ok") {
      const index = start_index._0;
      this.data[index] = first; // overwrite first element
      rest = elements.slice(front, back); // insert the rest below
    } else {
      const index = start_index._0;
      const last = front < back ? elements[--back] : undefined;
      if (index === this.data.length || last === undefined || this.cmp(last[0], this.data[index]![0]) < 0) {
        // We can copy the whole range without having to mix with
        // existing elements.
        const middle = elements.slice(front, back);
        const replacement: [K, V][] = [first];
        for (const e of middle) replacement.push(e);
        if (last !== undefined) replacement.push(last);
        splice(this.data, index, 0, replacement);
        return;
      }

      this.data.splice(index, 0, first);
      rest = elements.slice(front, back); // insert the rest below
      rest.push(last);
    }

    // Insert the rest. This is super inefficicent since each insertion copies the entire tail.
    for (const [k, v] of rest) {
      this.insert(k, v);
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

  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:269 range_slice_indices
  range_slice_indices(range: RangeBounds<K>): [number, number] {
    let start: number;
    const sb = range.start_bound;
    switch (sb.$) {
      case "Included": {
        const r = this.lookup_index_for(sb._0);
        start = r._0;
        break;
      }
      case "Excluded": {
        const r = this.lookup_index_for(sb._0);
        start = r.$ === "Ok" ? r._0 + 1 : r._0;
        break;
      }
      case "Unbounded":
        start = 0;
        break;
    }

    let end: number;
    const eb = range.end_bound;
    switch (eb.$) {
      case "Included": {
        const r = this.lookup_index_for(eb._0);
        end = r.$ === "Ok" ? r._0 + 1 : r._0;
        break;
      }
      case "Excluded": {
        const r = this.lookup_index_for(eb._0);
        end = r._0;
        break;
      }
      case "Unbounded":
        end = this.data.length;
        break;
    }

    return [start, end];
  }

  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:299 contains_key
  contains_key(key: K): boolean {
    return this.get(key) !== undefined;
  }

  // impl<K: Ord, V> IntoIterator for SortedMap<K, V>
  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:312 into_iter
  into_iter(): [K, V][] {
    return this.data;
  }

  // impl<'a, K, Q, V> Index<&'a Q> for SortedMap<K, V>
  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:324 index
  index(key: K): V {
    const v = this.get(key);
    if (v === undefined) panic("no entry found for key");
    return v;
  }

  // impl<'a, K, Q, V> IndexMut<&'a Q> for SortedMap<K, V>
  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:334 index_mut
  index_mut(key: K): V {
    const v = this.get_mut(key);
    if (v === undefined) panic("no entry found for key");
    return v;
  }

  // impl<K: Ord, V> FromIterator<(K, V)> for SortedMap<K, V>
  // rustc: compiler/rustc_data_structures/src/sorted_map.rs:340 from_iter
  static from_iter<K, V>(iter: Iterable<[K, V]>, cmp: Cmp<K>, layout: SortLayout): SortedMap<K, V> {
    // PORT: `layout` is the Rust layout of `(K, V)` (src/std/slice_sort.ts: `sort_unstable_by` depends on it).
    const data: [K, V][] = [...iter];

    slice_sort_unstable_by(data, ([k1, _1], [k2, _2]) => cmp(k1, k2), layout);
    // `data.dedup_by(|(k1, _), (k2, _)| k1 == k2)`: keeps the first of each run of equal keys.
    // PORT: `k1 == k2` is `cmp(k1, k2) === 0` (`K: Ord`, whose `Eq` agrees with `cmp`).
    let w = 0;
    for (let r = 0; r < data.length; r++) {
      if (w > 0 && cmp(data[r]![0], data[w - 1]![0]) === 0) continue;
      data[w++] = data[r]!;
    }
    data.length = w;

    return new SortedMap<K, V>(data, cmp);
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
