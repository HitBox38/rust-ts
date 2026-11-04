//! This module implements the `UniMap`, which is a way to get efficient mappings
//! optimized for the setting of `tree_borrows/tree.rs`.
//!
//! A `UniKeyMap<K>` is a (slow) mapping from `K` to `UniIndex`,
//! and `UniValMap<V>` is a (fast) mapping from `UniIndex` to `V`.
//! Thus a pair `(UniKeyMap<K>, UniValMap<V>)` acts as a virtual `HashMap<K, V>`.
//!
//! Because of the asymmetry in access time, the use-case for `UniMap` is the following:
//! a tuple `(UniKeyMap<K>, Vec<UniValMap<V>>)` is much more efficient than
//! the equivalent `Vec<HashMap<K, V>>` it represents if all maps have similar
//! sets of keys.
// Port of src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-tb-a`
// (plan-m6 wave 38). Its types are generated into unimap.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT: the `V: PartialEq` bound of `identical` / `equivalent` / `eq` is a function parameter `eq_V` (PORTING §5; the
// dedup_range_map.ts precedent).
// PORT: `UniIndex` is `Copy` and its `idx` is private to this file, which never assigns it: copies share the object.
// `derive(PartialEq)` is `UniIndex_eq`.
// PORT: `UniEntry.inner` is `&'a mut Option<V>`: TS has no reference to an array slot, so the entry also carries the slot
// (`data`, `index`) and writes through it; `inner` stays the value of that slot (nothing else can touch the slot while the
// entry is alive, by the borrow upstream holds).
import { UniEntry, type UniIndex, UniKeyMap, UniValMap } from "./unimap.gen.ts";
import { type Debug, debug_int } from "../../../std/fmt.ts";
import { panic, unwrap } from "../../../std/panic.ts";
export * from "./unimap.gen.ts";

// #![allow(dead_code)]

/// Intermediate key between a UniKeyMap and a UniValMap.
// #[derive(Clone, Copy, PartialEq, Eq)] pub struct UniIndex { idx: u32 } (unimap.gen.ts)
/** `derive(PartialEq)` of `UniIndex`. */
export function UniIndex_eq(a: UniIndex, b: UniIndex): boolean {
  return a.idx === b.idx;
}
// impl Debug for UniIndex
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:29 fmt
export const debug_UniIndex: Debug<UniIndex> = (v, f) => debug_int(v.idx, f);

declare module "./unimap.gen.ts" {
  interface UniValMap<V> {
    // borrow_tracker/tree_borrows/unimap.rs:59
    identical(other: UniValMap<V>, eq_V: (a: V, b: V) => boolean): boolean;
    // borrow_tracker/tree_borrows/unimap.rs:65
    equivalent(other: UniValMap<V>, eq_V: (a: V, b: V) => boolean): boolean;
    // borrow_tracker/tree_borrows/unimap.rs:168
    contains_idx(idx: UniIndex): boolean;
    // borrow_tracker/tree_borrows/unimap.rs:173
    extend_to_length(len: number): void;
    // borrow_tracker/tree_borrows/unimap.rs:184
    insert(idx: UniIndex, val: V): void;
    // borrow_tracker/tree_borrows/unimap.rs:190
    get(idx: UniIndex): V | undefined;
    // borrow_tracker/tree_borrows/unimap.rs:195
    get_mut(idx: UniIndex): V | undefined;
    // borrow_tracker/tree_borrows/unimap.rs:202
    remove(idx: UniIndex): V | undefined;
    // borrow_tracker/tree_borrows/unimap.rs:212
    is_empty(): boolean;
    // borrow_tracker/tree_borrows/unimap.rs:217
    iter(): Iterable<[UniIndex, V]>;
    // borrow_tracker/tree_borrows/unimap.rs:232
    entry(idx: UniIndex): UniEntry<V>;
  }
  namespace UniValMap {
    // borrow_tracker/tree_borrows/unimap.rs:85
    function default_<V>(): UniValMap<V>;
    export { default_ as default };
  }
}
declare module "./unimap.gen.ts" {
  interface UniKeyMap<K> {
    // borrow_tracker/tree_borrows/unimap.rs:95
    len(): number;
    // borrow_tracker/tree_borrows/unimap.rs:100
    contains_key(key: K): boolean;
    // borrow_tracker/tree_borrows/unimap.rs:108
    insert(key: K): UniIndex;
    // borrow_tracker/tree_borrows/unimap.rs:125
    get(key: K): UniIndex | undefined;
    // borrow_tracker/tree_borrows/unimap.rs:131
    get_or_insert(key: K): UniIndex;
    // borrow_tracker/tree_borrows/unimap.rs:159
    remove(key: K): void;
  }
  namespace UniKeyMap {
    /** `#[derive(Default)]` (borrow_tracker/tree_borrows/unimap.rs:35). */
    function default_<K>(): UniKeyMap<K>;
    export { default_ as default };
  }
}
declare module "./unimap.gen.ts" {
  interface UniEntry<V> {
    // borrow_tracker/tree_borrows/unimap.rs:240
    or_insert(default_: V): V;
    // borrow_tracker/tree_borrows/unimap.rs:247
    get(): V | undefined;
    /** PORT: the slot `inner` refers to (module header). */
    data: (V | undefined)[];
    index: number;
  }
}

/** `Vec<Option<V>>` equality of `a[0..len]` and `b[0..len]`. */
function options_eq<V>(a: readonly (V | undefined)[], b: readonly (V | undefined)[], len: number, eq_V: (a: V, b: V) => boolean): boolean {
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) {
      if (x !== y) return false;
    } else if (!eq_V(x, y)) {
      return false;
    }
  }
  return true;
}

// impl<V: PartialEq> UniValMap<V>
/// Exact equality of two maps.
/// Less accurate but faster than `equivalent`, mostly because
/// of the fast path when the lengths are different.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:59 identical
UniValMap.prototype.identical = function <V>(this: UniValMap<V>, other: UniValMap<V>, eq_V: (a: V, b: V) => boolean): boolean {
  return this.data.length === other.data.length && options_eq(this.data, other.data, this.data.length, eq_V);
};

/// Equality up to trailing `None`s of two maps, i.e.
/// do they represent the same mapping ?
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:65 equivalent
UniValMap.prototype.equivalent = function <V>(this: UniValMap<V>, other: UniValMap<V>, eq_V: (a: V, b: V) => boolean): boolean {
  const min_len = Math.min(this.data.length, other.data.length);
  for (let i = min_len; i < this.data.length; i++) {
    if (this.data[i] !== undefined) return false;
  }
  for (let i = min_len; i < other.data.length; i++) {
    if (other.data[i] !== undefined) return false;
  }
  return options_eq(this.data, other.data, min_len, eq_V);
};

// impl<V: PartialEq> PartialEq for UniValMap<V>
/// 2023-05: We found that using `equivalent` rather than `identical`
/// in the equality testing of the `RangeMap` is neutral for most
/// benchmarks, while being quite beneficial for `zip-equal`
/// and to a lesser extent for `unicode`, `slice-get-unchecked` and
/// `backtraces` as well.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:79 eq
export function UniValMap_eq<V>(self: UniValMap<V>, other: UniValMap<V>, eq_V: (a: V, b: V) => boolean): boolean {
  return self.equivalent(other, eq_V);
}

// impl<V> Default for UniValMap<V>
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:85 default
(UniValMap as unknown as { default: <V>() => UniValMap<V> }).default = function <V>(): UniValMap<V> {
  return new UniValMap<V>([]);
};

/** `#[derive(Default)]` of `UniKeyMap` (unimap.rs:35). */
(UniKeyMap as unknown as { default: <K>() => UniKeyMap<K> }).default = function <K>(): UniKeyMap<K> {
  return new UniKeyMap<K>(new Map(), []);
};

// impl<K> UniKeyMap<K> where K: Hash + Eq
/// How many keys/index pairs are currently active.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:95 len
UniKeyMap.prototype.len = function <K>(this: UniKeyMap<K>): number {
  return this.mapping.size;
};

/// Whether this key has an associated index or not.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:100 contains_key
UniKeyMap.prototype.contains_key = function <K>(this: UniKeyMap<K>, key: K): boolean {
  return this.mapping.has(key);
};

/// Assign this key to a new index. Panics if the key is already assigned,
/// use `get_or_insert` for a version that instead returns the existing
/// assignment.
// #[track_caller]
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:108 insert
UniKeyMap.prototype.insert = function <K>(this: UniKeyMap<K>, key: K): UniIndex {
  // We want an unused index. First we attempt to find one from `deassigned`,
  // and if `deassigned` is empty we generate a fresh index.
  let idx = this.deassigned.pop();
  if (idx === undefined) {
    // `deassigned` is empty, so all keys in use are already in `mapping`.
    // The next available key is `mapping.len()`.
    idx = this.mapping.size;
    if (idx > 0xffff_ffff) panic("UniMap ran out of useable keys: TryFromIntError(())");
  }
  const had = this.mapping.has(key);
  this.mapping.set(key, idx);
  if (had) {
    panic(
      "This key is already assigned to a different index; either use `get_or_insert` instead if you care about this data, or first call `remove` to undo the preexisting assignment.",
    );
  }
  return { idx };
};

/// If it exists, the index this key maps to.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:125 get
UniKeyMap.prototype.get = function <K>(this: UniKeyMap<K>, key: K): UniIndex | undefined {
  const idx = this.mapping.get(key);
  return idx === undefined ? undefined : { idx };
};

/// Either get a previously existing entry, or create a new one if it
/// is not yet present.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:131 get_or_insert
UniKeyMap.prototype.get_or_insert = function <K>(this: UniKeyMap<K>, key: K): UniIndex {
  return this.get(key) ?? this.insert(key);
};

/// Return whatever index this key was using to the deassigned pool.
///
/// Note: calling this function can be dangerous. If the index still exists
/// somewhere in a `UniValMap` and is reassigned by the `UniKeyMap` then
/// it will inherit the old value of a completely unrelated key.
/// If you `UniKeyMap::remove` a key you should make sure to also `UniValMap::remove`
/// the associated `UniIndex` from ALL `UniValMap`s.
///
/// Example of such behavior:
/// ```rust,ignore (private type can't be doctested)
/// let mut keymap = UniKeyMap::<char>::default();
/// let mut valmap = UniValMap::<char>::default();
/// // Insert 'a' -> _ -> 'A'
/// let idx_a = keymap.insert('a');
/// valmap.insert(idx_a, 'A');
/// // Remove 'a' -> _, but forget to remove _ -> 'A'
/// keymap.remove(&'a');
/// // valmap.remove(idx_a); // If we uncomment this line the issue is fixed
/// // Insert 'b' -> _
/// let idx_b = keymap.insert('b');
/// let val_b = valmap.get(idx_b);
/// assert_eq!(val_b, Some('A')); // Oh no
/// // assert_eq!(val_b, None); // This is what we would have expected
/// ```
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:159 remove
UniKeyMap.prototype.remove = function <K>(this: UniKeyMap<K>, key: K): void {
  const idx = this.mapping.get(key);
  if (idx !== undefined) {
    this.mapping.delete(key);
    this.deassigned.push(idx);
  }
};

// impl<V> UniValMap<V>
/// Whether this index has an associated value.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:168 contains_idx
UniValMap.prototype.contains_idx = function <V>(this: UniValMap<V>, idx: UniIndex): boolean {
  return this.data[idx.idx] !== undefined;
};

/// Reserve enough space to insert the value at the right index.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:173 extend_to_length
UniValMap.prototype.extend_to_length = function <V>(this: UniValMap<V>, len: number): void {
  if (len > this.data.length) {
    const nb = len - this.data.length;
    // self.data.reserve(nb);
    for (let i = 0; i < nb; i++) {
      this.data.push(undefined);
    }
  }
};

/// Assign a value to the index. Permanently overwrites any previous value.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:184 insert
UniValMap.prototype.insert = function <V>(this: UniValMap<V>, idx: UniIndex, val: V): void {
  this.extend_to_length(idx.idx + 1);
  this.data[idx.idx] = val;
};

/// Get the value at this index, if it exists.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:190 get
UniValMap.prototype.get = function <V>(this: UniValMap<V>, idx: UniIndex): V | undefined {
  return this.data[idx.idx];
};

/// Get the value at this index mutably, if it exists.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:195 get_mut
UniValMap.prototype.get_mut = function <V>(this: UniValMap<V>, idx: UniIndex): V | undefined {
  return this.data[idx.idx];
};

/// Delete any value associated with this index.
/// Returns None if the value was not present, otherwise
/// returns the previously stored value.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:202 remove
UniValMap.prototype.remove = function <V>(this: UniValMap<V>, idx: UniIndex): V | undefined {
  if (idx.idx >= this.data.length) {
    return undefined;
  }
  // mem::swap(&mut res, &mut self.data[idx.idx.to_usize()]);
  const res = this.data[idx.idx];
  this.data[idx.idx] = undefined;
  return res;
};

/// Returns true if the map is empty.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:212 is_empty
UniValMap.prototype.is_empty = function <V>(this: UniValMap<V>): boolean {
  return this.data.every((v) => v === undefined);
};

/// Iterates over all key-value pairs in the map.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:217 iter
UniValMap.prototype.iter = function* <V>(this: UniValMap<V>): Generator<[UniIndex, V]> {
  for (let i = 0; i < this.data.length; i++) {
    const v = this.data[i];
    if (v !== undefined) yield [{ idx: i }, v];
  }
};

/// An access to a single value of the map.
// pub struct UniEntry<'a, V> { inner: &'a mut Option<V> } (unimap.gen.ts; module header)

// impl<'a, V> UniValMap<V>
/// Get a wrapper around a mutable access to the value corresponding to `idx`.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:232 entry
UniValMap.prototype.entry = function <V>(this: UniValMap<V>, idx: UniIndex): UniEntry<V> {
  this.extend_to_length(idx.idx + 1);
  const e = new UniEntry<V>(this.data[idx.idx]);
  e.data = this.data;
  e.index = idx.idx;
  return e;
};

// impl<'a, V> UniEntry<'a, V>
/// Insert in the map and get the value.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:240 or_insert
UniEntry.prototype.or_insert = function <V>(this: UniEntry<V>, default_: V): V {
  if (this.inner === undefined) {
    this.inner = default_;
    this.data[this.index] = default_;
  }
  return unwrap(this.inner);
};

// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:247 get
UniEntry.prototype.get = function <V>(this: UniEntry<V>): V | undefined {
  return this.inner;
};

// mod tests: unimap.test.ts
