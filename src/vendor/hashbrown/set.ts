// Port of hashbrown =0.17.1 `src/set.rs`: `HashSet` with the operations rustc's `FxHashSet`s use
// (std's `HashSet<T, S>` forwards to this one: library/std/src/collections/hash/set.rs).
//
// PORT: as in map.ts: `T: Hash` is a `HashFn<T>`, `T: Eq` is `===`, and the `TableLayout` of the
// map's `(T, ())` elements (`size_of::<T>()`, `align_of::<T>()`) is given at construction.

import { type Debug, debug_set, type Fmt } from "../../std/fmt.ts";
import type { Hasher } from "../rustc_stable_hash/stable_hasher.ts";
import type { BuildHasher, HashFn } from "../rustc_hash/lib.ts";
import { HashMap } from "./map.ts";
import type { TableLayout } from "./raw.ts";

/// A hash set implemented as a `HashMap` where the value is `()`.
export class HashSet<T> {
  constructor(public map: HashMap<T, undefined>) {}

  // ---- impl Clone for HashSet ----

  // crate: hashbrown-0.17.1/src/set.rs:116 clone
  clone(clone_T: (t: T) => T): HashSet<T> {
    return new HashSet(this.map.clone(clone_T, () => undefined));
  }

  /// Returns the number of elements the set can hold without reallocating.
  // crate: hashbrown-0.17.1/src/set.rs:266 capacity
  capacity(): number {
    return this.map.capacity();
  }

  /// An iterator visiting all elements in arbitrary order.
  /// The iterator element type is `&'a T`.
  // crate: hashbrown-0.17.1/src/set.rs:287 iter
  // crate: hashbrown-0.17.1/src/set.rs:1771 next
  *iter(): Generator<T> {
    yield* this.map.keys();
  }

  /// Returns the number of elements in the set.
  // crate: hashbrown-0.17.1/src/set.rs:306 len
  len(): number {
    return this.map.len();
  }

  /// Returns `true` if the set contains no elements.
  // crate: hashbrown-0.17.1/src/set.rs:323 is_empty
  is_empty(): boolean {
    return this.map.is_empty();
  }

  /// Retains only the elements specified by the predicate.
  ///
  /// In other words, remove all elements `e` such that `f(&e)` returns `false`.
  // crate: hashbrown-0.17.1/src/set.rs:365 retain
  retain(f: (t: T) => boolean): void {
    this.map.retain((k) => f(k));
  }

  /// Clears the set, removing all values.
  // crate: hashbrown-0.17.1/src/set.rs:427 clear
  clear(): void {
    this.map.clear();
  }

  /// Creates a new empty hash set which will use the given hasher to hash
  /// keys.
  ///
  /// The hash set is initially created with a capacity of 0, so it will not
  /// allocate until it is first inserted into.
  // crate: hashbrown-0.17.1/src/set.rs:465 with_hasher
  static with_hasher<T>(hasher: BuildHasher<Hasher>, T_hash: HashFn<T>, layout: TableLayout): HashSet<T> {
    return new HashSet(HashMap.with_hasher<T, undefined>(hasher, T_hash, layout));
  }

  /// Creates an empty `HashSet` with the specified capacity, using
  /// `hasher` to hash the keys.
  // crate: hashbrown-0.17.1/src/set.rs:502 with_capacity_and_hasher
  static with_capacity_and_hasher<T>(capacity: number, hasher: BuildHasher<Hasher>, T_hash: HashFn<T>, layout: TableLayout): HashSet<T> {
    return new HashSet(HashMap.with_capacity_and_hasher<T, undefined>(capacity, hasher, T_hash, layout));
  }

  /// Reserves capacity for at least `additional` more elements to be inserted
  /// in the `HashSet`. The collection may reserve more space to avoid
  /// frequent reallocations.
  // crate: hashbrown-0.17.1/src/set.rs:639 reserve
  reserve(additional: number): void {
    this.map.reserve(additional);
  }

  /// Shrinks the capacity of the set as much as possible. It will drop
  /// down as much as possible while maintaining the internal rules
  /// and possibly leaving some space in accordance with the resize policy.
  // crate: hashbrown-0.17.1/src/set.rs:681 shrink_to_fit
  shrink_to_fit(): void {
    this.map.shrink_to_fit();
  }

  /// Shrinks the capacity of the set with a lower limit. It will drop
  /// down no lower than the supplied limit while maintaining the internal rules
  /// and possibly leaving some space in accordance with the resize policy.
  // crate: hashbrown-0.17.1/src/set.rs:707 shrink_to
  shrink_to(min_capacity: number): void {
    this.map.shrink_to(min_capacity);
  }

  /// Returns `true` if the set contains a value.
  // crate: hashbrown-0.17.1/src/set.rs:850 contains
  contains(value: T): boolean {
    return this.map.contains_key(value);
  }

  /// Adds a value to the set.
  ///
  /// If the set did not have this value present, `true` is returned.
  ///
  /// If the set did have this value present, `false` is returned.
  // crate: hashbrown-0.17.1/src/set.rs:1074 insert
  insert(value: T): boolean {
    return this.map.insert(value, undefined) === undefined;
  }

  /// Removes a value from the set. Returns whether the value was
  /// present in the set.
  // crate: hashbrown-0.17.1/src/set.rs:1161 remove
  remove(value: T): boolean {
    return this.map.remove(value) !== undefined;
  }

  // ---- impl FromIterator<T> for HashSet (hashbrown's; std's `from_iter` is `with_hasher` + `extend`) ----

  // crate: hashbrown-0.17.1/src/set.rs:1256 from_iter
  static from_iter<T>(iter: Iterable<T>, size_hint_lower: number, hasher: BuildHasher<Hasher>, T_hash: HashFn<T>, layout: TableLayout): HashSet<T> {
    const set = HashSet.with_capacity_and_hasher<T>(size_hint_lower, hasher, T_hash, layout);
    set.extend(iter, size_hint_lower);
    return set;
  }

  // ---- impl Extend<T> for HashSet ----

  // crate: hashbrown-0.17.1/src/set.rs:1291 extend
  extend(iter: Iterable<T>, size_hint_lower: number): void {
    // `self.map.extend(iter.into_iter().map(|k| (k, ())))`
    const mapped = (function* (): Generator<[T, undefined]> {
      for (const k of iter) yield [k, undefined];
    })();
    this.map.extend(mapped, size_hint_lower);
  }

  // crate: hashbrown-0.17.1/src/set.rs:1339 default
  static default<T>(hasher: BuildHasher<Hasher>, T_hash: HashFn<T>, layout: TableLayout): HashSet<T> {
    return new HashSet(HashMap.default<T, undefined>(hasher, T_hash, layout));
  }
}

// crate: hashbrown-0.17.1/src/set.rs:1235 fmt
export function debug_HashSet<T>(self: HashSet<T>, f: Fmt, debug_T: Debug<T>): string {
  // `f.debug_set().entries(self.iter()).finish()`
  const entries: string[] = [];
  for (const t of self.iter()) entries.push(debug_T(t, f));
  return debug_set(f, entries);
}
