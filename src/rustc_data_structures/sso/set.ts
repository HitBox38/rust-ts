// Port of compiler/rustc_data_structures/src/sso/set.rs.
//
// PORT: `SsoHashMap<T, ()>`'s `()` is `undefined` (layout `LAYOUT_UNIT`); `T: Eq + Hash` is `===` plus
// the `KeyType` given at construction (see map.ts). Iterators are JS iterators; `IntoIterator` sources
// of `extend` / `from_iter` come with their `size_hint().0` (`size_hint_lower`).

import { type Debug, debug_set, type Fmt } from "../../std/fmt.ts";
import { type KeyType, LAYOUT_UNIT } from "../../rust_ts/hash_map.ts";
import { SsoHashMap } from "./map.ts";

/// Small-storage-optimized implementation of a set.
///
/// Stores elements in a small array up to a certain length
/// and switches to `HashSet` when that length is exceeded.
//
// FIXME: Implements subset of HashSet API.
//
// Missing HashSet API:
//   all hasher-related
//   try_reserve
//   shrink_to (unstable)
//   drain_filter (unstable)
//   replace
//   get_or_insert/get_or_insert_owned/get_or_insert_with (unstable)
//   difference/symmetric_difference/intersection/union
//   is_disjoint/is_subset/is_superset
//   PartialEq/Eq (requires SsoHashMap implementation)
//   BitOr/BitAnd/BitXor/Sub
export class SsoHashSet<T> {
  constructor(public map: SsoHashMap<T, undefined>) {}

  /** `#[derive(Clone)]`: `T: Clone` is `clone_T`. */
  clone(clone_T: (t: T) => T = (t) => t): SsoHashSet<T> {
    return new SsoHashSet(this.map.clone(clone_T));
  }

  /// Creates an empty `SsoHashSet`.
  // rustc: compiler/rustc_data_structures/src/sso/set.rs:40 new
  static new<T>(key: KeyType<T>): SsoHashSet<T> {
    return new SsoHashSet<T>(SsoHashMap.new(key, LAYOUT_UNIT));
  }

  /// Creates an empty `SsoHashSet` with the specified capacity.
  // rustc: compiler/rustc_data_structures/src/sso/set.rs:46 with_capacity
  static with_capacity<T>(cap: number, key: KeyType<T>): SsoHashSet<T> {
    return new SsoHashSet<T>(SsoHashMap.with_capacity(cap, key, LAYOUT_UNIT));
  }

  /// Clears the set, removing all values.
  // rustc: compiler/rustc_data_structures/src/sso/set.rs:52 clear
  clear(): void {
    this.map.clear();
  }

  /// Returns the number of elements the set can hold without reallocating.
  // rustc: compiler/rustc_data_structures/src/sso/set.rs:58 capacity
  capacity(): number {
    return this.map.capacity();
  }

  /// Returns the number of elements in the set.
  // rustc: compiler/rustc_data_structures/src/sso/set.rs:64 len
  len(): number {
    return this.map.len();
  }

  /// Returns `true` if the set contains no elements.
  // rustc: compiler/rustc_data_structures/src/sso/set.rs:70 is_empty
  is_empty(): boolean {
    return this.map.is_empty();
  }

  /// An iterator visiting all elements in arbitrary order.
  /// The iterator element type is `&'a T`.
  // rustc: compiler/rustc_data_structures/src/sso/set.rs:77 iter
  iter(): Generator<T> {
    return this.into_iter_ref();
  }

  /// Clears the set, returning all elements in an iterator.
  // rustc: compiler/rustc_data_structures/src/sso/set.rs:83 drain
  *drain(): Generator<T> {
    for (const e of this.map.drain()) yield entry_to_key(e);
  }

  // ---- impl<T: Eq + Hash> SsoHashSet<T> ----

  /// Reserves capacity for at least `additional` more elements to be inserted
  /// in the `SsoHashSet`. The collection may reserve more space to avoid
  /// frequent reallocations.
  // rustc: compiler/rustc_data_structures/src/sso/set.rs:93 reserve
  reserve(additional: number): void {
    this.map.reserve(additional);
  }

  /// Shrinks the capacity of the set as much as possible. It will drop
  /// down as much as possible while maintaining the internal rules
  /// and possibly leaving some space in accordance with the resize policy.
  // rustc: compiler/rustc_data_structures/src/sso/set.rs:101 shrink_to_fit
  shrink_to_fit(): void {
    this.map.shrink_to_fit();
  }

  /// Retains only the elements specified by the predicate.
  // rustc: compiler/rustc_data_structures/src/sso/set.rs:107 retain
  retain(f: (t: T) => boolean): void {
    this.map.retain((k, _v) => f(k));
  }

  /// Removes and returns the value in the set, if any, that is equal to the given one.
  // rustc: compiler/rustc_data_structures/src/sso/set.rs:116 take
  take(value: T): T | undefined {
    const e = this.map.remove_entry(value);
    return e === undefined ? undefined : entry_to_key(e);
  }

  /// Returns a reference to the value in the set, if any, that is equal to the given value.
  // rustc: compiler/rustc_data_structures/src/sso/set.rs:122 get
  get(value: T): T | undefined {
    const e = this.map.get_key_value(value);
    return e === undefined ? undefined : entry_to_key(e);
  }

  /// Adds a value to the set.
  ///
  /// Returns whether the value was newly inserted. That is:
  ///
  /// - If the set did not previously contain this value, `true` is returned.
  /// - If the set already contained this value, `false` is returned.
  // rustc: compiler/rustc_data_structures/src/sso/set.rs:133 insert
  insert(elem: T): boolean {
    return this.map.insert(elem, undefined) === undefined;
  }

  /// Removes a value from the set. Returns whether the value was
  /// present in the set.
  // rustc: compiler/rustc_data_structures/src/sso/set.rs:140 remove
  remove(value: T): boolean {
    return this.map.remove(value) !== undefined;
  }

  /// Returns `true` if the set contains a value.
  // rustc: compiler/rustc_data_structures/src/sso/set.rs:146 contains
  contains(value: T): boolean {
    return this.map.contains_key(value);
  }

  // ---- impl FromIterator<T> ----

  // rustc: compiler/rustc_data_structures/src/sso/set.rs:152 from_iter
  static from_iter<T>(iter: Iterable<T>, size_hint_lower: number, key: KeyType<T>): SsoHashSet<T> {
    const set: SsoHashSet<T> = SsoHashSet.default(key);
    set.extend(iter, size_hint_lower);
    return set;
  }

  // ---- impl Default ----

  // rustc: compiler/rustc_data_structures/src/sso/set.rs:161 default
  static default<T>(key: KeyType<T>): SsoHashSet<T> {
    return SsoHashSet.new(key);
  }

  // ---- impl Extend<T> ----

  // rustc: compiler/rustc_data_structures/src/sso/set.rs:167 extend
  extend(iter: Iterable<T>, size_hint_lower: number): void {
    this.reserve(size_hint_lower);
    for (const val of iter) {
      this.insert(val);
    }
  }

  // rustc: compiler/rustc_data_structures/src/sso/set.rs:179 extend_one
  extend_one(item: T): void {
    this.insert(item);
  }

  // rustc: compiler/rustc_data_structures/src/sso/set.rs:184 extend_reserve
  extend_reserve(additional: number): void {
    this.map.extend_reserve(additional);
  }

  // ---- impl Extend<&T> (T: Copy) ----
  // PORT: the methods of this second `Extend` impl are suffixed `_ref`.

  // rustc: compiler/rustc_data_structures/src/sso/set.rs:194 extend
  extend_ref(iter: Iterable<T>, size_hint_lower: number): void {
    this.extend(iter, size_hint_lower);
  }

  // rustc: compiler/rustc_data_structures/src/sso/set.rs:199 extend_one
  extend_one_ref(item: T): void {
    this.insert(item);
  }

  // rustc: compiler/rustc_data_structures/src/sso/set.rs:204 extend_reserve
  extend_reserve_ref(additional: number): void {
    this.extend_reserve(additional);
  }

  // ---- impl IntoIterator for SsoHashSet / &SsoHashSet ----

  // rustc: compiler/rustc_data_structures/src/sso/set.rs:214 into_iter
  *into_iter(): Generator<T> {
    for (const e of this.map.into_iter()) yield entry_to_key(e);
  }

  // rustc: compiler/rustc_data_structures/src/sso/set.rs:227 into_iter
  *into_iter_ref(): Generator<T> {
    for (const e of this.map.iter()) yield entry_to_key(e);
  }
}

/// Adapter function used to return
/// result if SsoHashMap functions into
/// result SsoHashSet should return.
// rustc: compiler/rustc_data_structures/src/sso/set.rs:33 entry_to_key
function entry_to_key<K, V>([k, _v]: readonly [K, V]): K {
  return k;
}

/** `impl fmt::Debug for SsoHashSet` */
// rustc: compiler/rustc_data_structures/src/sso/set.rs:236 fmt
export function debug_SsoHashSet<T>(self: SsoHashSet<T>, f: Fmt, debug_T: Debug<T>): string {
  const items: string[] = [];
  for (const t of self.iter()) items.push(debug_T(t, f));
  return debug_set(f, items);
}
