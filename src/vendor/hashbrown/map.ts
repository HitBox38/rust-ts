// Port of hashbrown =0.17.1 `src/map.rs`: `HashMap` with the operations rustc's `FxHashMap`s use
// (std's `HashMap<K, V, S>` is a thin wrapper of this one: library/std/src/collections/hash/map.rs
// forwards `with_hasher`, `with_capacity_and_hasher`, `insert`, `remove`, `get`, `extend`, `iter`,
// `retain`, `reserve`, `shrink_to`, `clear`, `Clone` and `Debug` to `self.base`).
//
// PORT: generics. `K: Hash` is a `HashFn<K>` (the key's `Hash` impl, given at construction);
// `K: Eq` / `Q: Equivalent<K>` is `===` (keys are primitives or interned handles, PORTING §5).
// `S: BuildHasher` is a `BuildHasher` value (`FxBuildHasher` for rustc). `RawTable<(K, V)>` stores
// `[K, V]` tuples, and its `TableLayout` (`size_of::<(K, V)>()`, `align_of::<(K, V)>()`) is given
// at construction, because only the Rust types know it.
// PORT: iterators are JS iterators over the same `RawIter` order; `IntoIterator` sources of
// `extend` / `from_iter` come with their `size_hint().0` (`size_hint_lower`), which upstream reads.

import { type Debug, debug_map, type Fmt } from "../../std/fmt.ts";
import type { Hasher } from "../rustc_stable_hash/stable_hasher.ts";
import type { BuildHasher, HashFn } from "../rustc_hash/lib.ts";
import { RawIter, RawTable, type TableLayout } from "./raw.ts";

// crate: hashbrown-0.17.1/src/map.rs:206 make_hasher
export function make_hasher<Q, V>(hash_builder: BuildHasher<Hasher>, Q_hash: HashFn<Q>): (val: readonly [Q, V]) => bigint {
  return (val) => make_hash<Q>(hash_builder, val[0], Q_hash);
}

// crate: hashbrown-0.17.1/src/map.rs:217 equivalent_key
export function equivalent_key<Q, K, V>(k: Q): (x: readonly [K, V]) => boolean {
  return (x) => (k as unknown) === x[0];
}

// crate: hashbrown-0.17.1/src/map.rs:236 make_hash
export function make_hash<Q>(hash_builder: BuildHasher<Hasher>, val: Q, Q_hash: HashFn<Q>): bigint {
  // `hash_builder.hash_one(val)`
  const state = hash_builder.build_hasher();
  Q_hash(val, state);
  return state.finish_u64();
}

/// A hash map implemented with quadratic probing and SIMD lookup.
export class HashMap<K, V> {
  constructor(
    public hash_builder: BuildHasher<Hasher>,
    public table: RawTable<[K, V]>,
    /** PORT: `K: Hash` */
    readonly K_hash: HashFn<K>,
  ) {}

  // ---- impl Clone for HashMap ----

  // PORT: `K: Clone` / `V: Clone` are `clone_K` / `clone_V`; `S: Clone` keeps the same hasher value.
  // crate: hashbrown-0.17.1/src/map.rs:188 clone
  clone(clone_K: (k: K) => K, clone_V: (v: V) => V): HashMap<K, V> {
    return new HashMap(this.hash_builder, this.table.clone(([k, v]) => [clone_K(k), clone_V(v)]), this.K_hash);
  }

  /// Creates an empty `HashMap` which will use the given hash builder to hash
  /// keys.
  ///
  /// The hash map is initially created with a capacity of 0, so it will not
  /// allocate until it is first inserted into.
  // crate: hashbrown-0.17.1/src/map.rs:439 with_hasher
  static with_hasher<K, V>(hash_builder: BuildHasher<Hasher>, K_hash: HashFn<K>, layout: TableLayout): HashMap<K, V> {
    return new HashMap<K, V>(hash_builder, RawTable.new(layout), K_hash);
  }

  /// Creates an empty `HashMap` with the specified capacity, using `hash_builder`
  /// to hash the keys.
  ///
  /// The hash map will be able to hold at least `capacity` elements without
  /// reallocating. If `capacity` is 0, the hash map will not allocate.
  // crate: hashbrown-0.17.1/src/map.rs:480 with_capacity_and_hasher
  static with_capacity_and_hasher<K, V>(capacity: number, hash_builder: BuildHasher<Hasher>, K_hash: HashFn<K>, layout: TableLayout): HashMap<K, V> {
    return new HashMap<K, V>(hash_builder, RawTable.with_capacity(layout, capacity), K_hash);
  }

  /// Returns the number of elements the map can hold without reallocating.
  ///
  /// This number is a lower bound; the `HashMap<K, V>` might be able to hold
  /// more, but is guaranteed to be able to hold at least this many.
  // crate: hashbrown-0.17.1/src/map.rs:597 capacity
  capacity(): number {
    return this.table.capacity();
  }

  /// An iterator visiting all keys in arbitrary order.
  /// The iterator element type is `&'a K`.
  // crate: hashbrown-0.17.1/src/map.rs:629 keys
  // crate: hashbrown-0.17.1/src/map.rs:3291 next
  *keys(): Generator<K> {
    for (const [k] of this.iter()) yield k;
  }

  /// An iterator visiting all values in arbitrary order.
  /// The iterator element type is `&'a V`.
  // crate: hashbrown-0.17.1/src/map.rs:661 values
  // crate: hashbrown-0.17.1/src/map.rs:3331 next
  *values(): Generator<V> {
    for (const [, v] of this.iter()) yield v;
  }

  /// An iterator visiting all key-value pairs in arbitrary order.
  /// The iterator element type is `(&'a K, &'a V)`.
  // crate: hashbrown-0.17.1/src/map.rs:733 iter
  // crate: hashbrown-0.17.1/src/map.rs:3145 next
  *iter(): Generator<readonly [K, V]> {
    // Here we tie the lifetime of self to the iter.
    const inner: RawIter<[K, V]> = this.table.iter();
    for (let x = inner.next(); x !== undefined; x = inner.next()) {
      const r = this.table.bucket_as_ref(x);
      yield r;
    }
  }

  /// Returns the number of elements in the map.
  // crate: hashbrown-0.17.1/src/map.rs:807 len
  len(): number {
    return this.table.len();
  }

  /// Returns `true` if the map contains no elements.
  // crate: hashbrown-0.17.1/src/map.rs:824 is_empty
  is_empty(): boolean {
    return this.len() === 0;
  }

  /// Retains only the elements specified by the predicate. Keeps the
  /// allocated memory for reuse.
  ///
  /// In other words, remove all pairs `(k, v)` such that `f(&k, &mut v)` returns `false`.
  /// The elements are visited in unsorted (and unspecified) order.
  // PORT: `&mut V` is the stored value; `f` returns the (possibly replaced) value's fate only.
  // crate: hashbrown-0.17.1/src/map.rs:896 retain
  retain(f: (k: K, v: V) => boolean): void {
    // Here we only use `iter` as a temporary, preventing use-after-free
    const it = this.table.iter();
    for (let item = it.next(); item !== undefined; item = it.next()) {
      const [key, value] = this.table.bucket_as_ref(item);
      if (!f(key, value)) {
        this.table.erase(item);
      }
    }
  }

  /// Clears the map, removing all key-value pairs. Keeps the allocated memory
  /// for reuse.
  // crate: hashbrown-0.17.1/src/map.rs:988 clear
  clear(): void {
    this.table.clear();
  }

  /// Reserves capacity for at least `additional` more elements to be inserted
  /// in the `HashMap`. The collection may reserve more space to avoid
  /// frequent reallocations.
  // crate: hashbrown-0.17.1/src/map.rs:1081 reserve
  reserve(additional: number): void {
    this.table.reserve(additional, make_hasher<K, V>(this.hash_builder, this.K_hash));
  }

  /// Shrinks the capacity of the map as much as possible. It will drop
  /// down as much as possible while maintaining the internal rules
  /// and possibly leaving some space in accordance with the resize policy.
  // crate: hashbrown-0.17.1/src/map.rs:1153 shrink_to_fit
  shrink_to_fit(): void {
    this.table.shrink_to(0, make_hasher<K, V>(this.hash_builder, this.K_hash));
  }

  /// Shrinks the capacity of the map with a lower limit. It will drop
  /// down no lower than the supplied limit while maintaining the internal rules
  /// and possibly leaving some space in accordance with the resize policy.
  ///
  /// This function does nothing if the current capacity is smaller than the
  /// supplied minimum capacity.
  // crate: hashbrown-0.17.1/src/map.rs:1182 shrink_to
  shrink_to(min_capacity: number): void {
    this.table.shrink_to(min_capacity, make_hasher<K, V>(this.hash_builder, this.K_hash));
  }

  /// Returns a reference to the value corresponding to the key.
  // crate: hashbrown-0.17.1/src/map.rs:1279 get
  get(k: K): V | undefined {
    // Avoid `Option::map` because it bloats LLVM IR.
    if (this.table.is_empty()) {
      return undefined;
    } else {
      const hash = make_hash<K>(this.hash_builder, k, this.K_hash);
      const r = this.table.get(hash, equivalent_key<K, K, V>(k));
      if (r !== undefined) {
        return r[1];
      } else {
        return undefined;
      }
    }
  }

  /// Returns `true` if the map contains a value for the specified key.
  // crate: hashbrown-0.17.1/src/map.rs:1382 contains_key
  contains_key(k: K): boolean {
    if (this.table.is_empty()) {
      return false;
    } else {
      const hash = make_hash<K>(this.hash_builder, k, this.K_hash);
      return this.table.get(hash, equivalent_key<K, K, V>(k)) !== undefined;
    }
  }

  /// Inserts a key-value pair into the map.
  ///
  /// If the map did not have this key present, [`None`] is returned.
  ///
  /// If the map did have this key present, the value is updated, and the old
  /// value is returned. The key is not updated, though; this matters for
  /// types that can be `==` without being identical. See the [`std::collections`]
  /// [module-level documentation] for more.
  // PORT: `Option<V>` is `{ $: "Some", _0 } | undefined` (`V` may itself be `undefined`-able).
  // crate: hashbrown-0.17.1/src/map.rs:1806 insert
  insert(k: K, v: V): { $: "Some"; _0: V } | undefined {
    const hash = make_hash<K>(this.hash_builder, k, this.K_hash);
    const equivalent = equivalent_key<K, K, V>(k);
    const hasher = make_hasher<K, V>(this.hash_builder, this.K_hash);
    const r = this.table.find_or_find_insert_index(hash, equivalent, hasher);
    switch (r.$) {
      case "Ok": {
        // `mem::replace(&mut bucket.as_mut().1, v)`
        const slot = this.table.bucket_as_ref(r._0);
        const old = slot[1];
        slot[1] = v;
        return { $: "Some", _0: old };
      }
      case "Err": {
        this.table.insert_at_index(hash, r._0, [k, v]);
        return undefined;
      }
    }
  }

  /// Removes a key from the map, returning the value at the key if the key
  /// was previously in the map. Keeps the allocated memory for reuse.
  // crate: hashbrown-0.17.1/src/map.rs:1956 remove
  remove(k: K): { $: "Some"; _0: V } | undefined {
    // Avoid `Option::map` because it bloats LLVM IR.
    const r = this.remove_entry(k);
    if (r !== undefined) {
      return { $: "Some", _0: r[1] };
    } else {
      return undefined;
    }
  }

  /// Removes a key from the map, returning the stored key and value if the
  /// key was previously in the map. Keeps the allocated memory for reuse.
  // crate: hashbrown-0.17.1/src/map.rs:1992 remove_entry
  remove_entry(k: K): [K, V] | undefined {
    const hash = make_hash<K>(this.hash_builder, k, this.K_hash);
    return this.table.remove_entry(hash, equivalent_key<K, K, V>(k));
  }

  /// Creates an empty `HashMap<K, V, S, A>`, with the `Default` value for the hasher and allocator.
  // crate: hashbrown-0.17.1/src/map.rs:2069 default
  static default<K, V>(hash_builder: BuildHasher<Hasher>, K_hash: HashFn<K>, layout: TableLayout): HashMap<K, V> {
    // `Self::with_hasher_in(Default::default(), Default::default())`
    return HashMap.with_hasher<K, V>(hash_builder, K_hash, layout);
  }

  // ---- impl FromIterator<(K, V)> for HashMap (hashbrown's; std's `from_iter` is `with_hasher` + `extend`) ----

  // crate: hashbrown-0.17.1/src/map.rs:4812 from_iter
  static from_iter<K, V>(iter: Iterable<[K, V]>, size_hint_lower: number, hash_builder: BuildHasher<Hasher>, K_hash: HashFn<K>, layout: TableLayout): HashMap<K, V> {
    const map = HashMap.with_capacity_and_hasher<K, V>(size_hint_lower, hash_builder, K_hash, layout);
    for (const [k, v] of iter) {
      map.insert(k, v);
    }
    return map;
  }

  // ---- impl Extend<(K, V)> for HashMap ----

  /// Inserts all new key-values from the iterator to existing `HashMap<K, V, S, A>`.
  /// Replace values with existing keys with new values returned from the iterator.
  // crate: hashbrown-0.17.1/src/map.rs:4867 extend
  extend(iter: Iterable<[K, V]>, size_hint_lower: number): void {
    // Keys may be already present or show multiple times in the iterator.
    // Reserve the entire hint lower bound if the map is empty.
    // Otherwise reserve half the hint (rounded up), so the map
    // will only resize twice in the worst case.
    const reserve = this.is_empty() ? size_hint_lower : Math.ceil(size_hint_lower / 2);
    this.reserve(reserve);
    for (const [k, v] of iter) {
      this.insert(k, v);
    }
  }
}

// crate: hashbrown-0.17.1/src/map.rs:2043 fmt
export function debug_HashMap<K, V>(self: HashMap<K, V>, f: Fmt, debug_K: Debug<K>, debug_V: Debug<V>): string {
  // `f.debug_map().entries(self.iter()).finish()`
  const entries: [string, string][] = [];
  for (const [k, v] of self.iter()) entries.push([debug_K(k, f), debug_V(v, f)]);
  return debug_map(f, entries);
}
