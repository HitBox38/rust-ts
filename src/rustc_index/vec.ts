// Port of compiler/rustc_index/src/vec.rs (lane index-ds).
//
// PORT: `IndexVec<I, T>` is a `T[]` indexed by the handle number (PORTING §5), so its methods are functions taking
// the array first, on the companion const `IndexVec` (`IndexVec.push(v, x)` returns the new index). `raw` is the array
// itself; `Deref`/`Borrow` to `IndexSlice` are the identity (the slice methods are on `IndexSlice`, slice.ts).
// `T: Clone` arguments (`from_elem`, `resize`, ...) take an optional `clone_T`, omitted only when `T` is immutable
// (numbers, strings, `undefined`, interned handles); `vec![elem; n]` then shares `elem`. `Option<T>` is `T | undefined`.
// `&mut T` results (`ensure_contains_elem`, `get_or_insert_with`) are the element itself (see slice.ts).
import { type Debug, debug_map, type Fmt } from "../std/fmt.ts";
import { assert } from "../std/panic.ts";
import { type Decoder, decode_Vec, type Decodable, type Encodable, type Encoder, encode_Vec } from "../rustc_serialize/serialize.ts";
import type { RangeBounds } from "./idx.ts";
import { IndexSlice } from "./slice.ts";

/** `vec![elem; n]`: `n` clones of `elem` (the last one is `elem` itself). */
function vec_from_elem<T>(elem: T, n: number, clone_T?: (v: T) => T): T[] {
  const v: T[] = new Array<T>(n);
  for (let i = 0; i < n; i++) v[i] = clone_T === undefined || i === n - 1 ? elem : clone_T(elem);
  return v;
}

/** `Vec::resize_with`. */
function resize_with<T>(raw: T[], new_len: number, f: () => T): void {
  if (new_len <= raw.length) {
    raw.length = new_len;
  } else {
    while (raw.length < new_len) raw.push(f());
  }
}

/** `RangeBounds<usize>` resolved against a vector of length `len` (`slice::range`). */
function vec_range(r: RangeBounds<number>, len: number): [number, number] {
  const s = r.start_bound;
  const e = r.end_bound;
  const start = s.$ === "Included" ? s._0 : s.$ === "Excluded" ? s._0 + 1 : 0;
  const end = e.$ === "Included" ? e._0 + 1 : e.$ === "Excluded" ? e._0 : len;
  assert(start <= end, `slice index starts at ${start} but ends at ${end}`);
  assert(end <= len, `range end index ${end} out of range for slice of length ${len}`);
  return [start, end];
}

/// An owned contiguous collection of `T`s, indexed by `I` rather than by `usize`.
///
/// ## Why use this instead of a `Vec`?
///
/// An `IndexVec` allows element access only via a specific associated index type, meaning that
/// trying to use the wrong index type (possibly accessing an invalid element) will fail at
/// compile time.
///
/// It also documents what the index is indexing: in a `HashMap<usize, Something>` it's not
/// immediately clear what the `usize` means, while a `HashMap<FieldIdx, Something>` makes it obvious.
///
/// While it's possible to use `u32` or `usize` directly for `I`,
/// you almost certainly want to use a [`newtype_index!`]-generated type instead.
///
/// This allows to index the IndexVec with the new index type.
///
/// [`newtype_index!`]: ../macro.newtype_index.html
// rustc-type: compiler/rustc_index/src/vec.rs:40 IndexVec
export const IndexVec = {
  /// Constructs a new, empty `IndexVec<I, T>`.
  // rustc: compiler/rustc_index/src/vec.rs:48 new
  new<T>(): T[] {
    return IndexVec.from_raw<T>([]);
  },

  /// Constructs a new `IndexVec<I, T>` from a `Vec<T>`.
  // rustc: compiler/rustc_index/src/vec.rs:54 from_raw
  from_raw<T>(raw: T[]): T[] {
    return raw;
  },

  // rustc: compiler/rustc_index/src/vec.rs:59 with_capacity
  with_capacity<T>(_capacity: number): T[] {
    return IndexVec.from_raw<T>([]);
  },

  /// Creates a new vector with a copy of `elem` for each index in `universe`.
  ///
  /// Thus `IndexVec::from_elem(elem, &universe)` is equivalent to
  /// `IndexVec::<I, _>::from_elem_n(elem, universe.len())`. That can help
  /// type inference as it ensures that the resulting vector uses the same
  /// index type as `universe`, rather than something potentially surprising.
  ///
  /// For example, if you want to store data for each local in a MIR body,
  /// using `let mut uses = IndexVec::from_elem(vec![], &body.local_decls);`
  /// ensures that `uses` is an `IndexVec<Local, _>`, and thus can give
  /// better error messages later if one accidentally mismatches indices.
  // rustc: compiler/rustc_index/src/vec.rs:75 from_elem
  from_elem<T, S>(elem: T, universe: readonly S[], clone_T?: (v: T) => T): T[] {
    return IndexVec.from_raw(vec_from_elem(elem, universe.length, clone_T));
  },

  /// Creates a new IndexVec with n copies of the `elem`.
  // rustc: compiler/rustc_index/src/vec.rs:84 from_elem_n
  from_elem_n<T>(elem: T, n: number, clone_T?: (v: T) => T): T[] {
    return IndexVec.from_raw(vec_from_elem(elem, n, clone_T));
  },

  /// Create an `IndexVec` with `n` elements, where the value of each
  /// element is the result of `func(i)`. (The underlying vector will
  /// be allocated only once, with a capacity of at least `n`.)
  // rustc: compiler/rustc_index/src/vec.rs:95 from_fn_n
  from_fn_n<I extends number, T>(func: (i: I) => T, n: number): T[] {
    // Allow the optimizer to elide the bounds checking when creating each index.
    // let _ = I::new(n);
    const raw: T[] = new Array<T>(n);
    for (let i = 0; i < n; i++) raw[i] = func(i as I);
    return IndexVec.from_raw(raw);
  },

  // rustc: compiler/rustc_index/src/vec.rs:102 as_slice
  as_slice<T>(self: readonly T[]): readonly T[] {
    return IndexSlice.from_raw(self);
  },

  // rustc: compiler/rustc_index/src/vec.rs:107 as_mut_slice
  as_mut_slice<T>(self: T[]): T[] {
    return IndexSlice.from_raw_mut(self);
  },

  /// Pushes an element to the array returning the index where it was pushed to.
  // rustc: compiler/rustc_index/src/vec.rs:113 push
  push<I extends number, T>(self: T[], d: T): I {
    const idx = IndexSlice.next_index<I, T>(self);
    self.push(d);
    return idx;
  },

  // rustc: compiler/rustc_index/src/vec.rs:120 pop
  pop<T>(self: T[]): T | undefined {
    return self.pop();
  },

  // rustc: compiler/rustc_index/src/vec.rs:125 into_iter
  into_iter<T>(self: T[]): IterableIterator<T> {
    return self.values();
  },

  // rustc: compiler/rustc_index/src/vec.rs:130 into_iter_enumerated
  *into_iter_enumerated<I extends number, T>(self: T[]): Generator<[I, T]> {
    // Allow the optimizer to elide the bounds checking when creating each index.
    // let _ = I::new(self.len());
    for (let n = 0; n < self.length; n++) yield [n as I, self[n]!];
  },

  // PORT: `Vec::drain` removes the range eagerly (upstream removes it when the iterator is dropped).
  // rustc: compiler/rustc_index/src/vec.rs:139 drain
  drain<T>(self: T[], range: RangeBounds<number>): IterableIterator<T> {
    const [start, end] = vec_range(range, self.length);
    return self.splice(start, end - start).values();
  },

  // rustc: compiler/rustc_index/src/vec.rs:144 drain_enumerated
  *drain_enumerated<I extends number, T>(self: T[], range: RangeBounds<number>): Generator<[I, T]> {
    const sb = range.start_bound;
    let begin: number;
    switch (sb.$) {
      case "Included":
        begin = sb._0;
        break;
      case "Excluded":
        begin = sb._0 + 1;
        break;
      case "Unbounded":
        begin = 0;
        break;
    }
    let n = 0;
    for (const t of IndexVec.drain(self, range)) {
      yield [(begin + n) as I, t];
      n += 1;
    }
  },

  // rustc: compiler/rustc_index/src/vec.rs:157 shrink_to_fit
  shrink_to_fit<T>(_self: T[]): void {},

  // rustc: compiler/rustc_index/src/vec.rs:162 truncate
  truncate<T>(self: T[], a: number): void {
    if (a < self.length) self.length = a;
  },

  /// Grows the index vector so that it contains an entry for
  /// `elem`; if that is already true, then has no
  /// effect. Otherwise, inserts new values as needed by invoking
  /// `fill_value`.
  ///
  /// Returns a reference to the `elem` entry.
  // rustc: compiler/rustc_index/src/vec.rs:173 ensure_contains_elem
  ensure_contains_elem<I extends number, T>(self: T[], elem: I, fill_value: () => T): T {
    const min_new_len = elem + 1;
    if (self.length < min_new_len) {
      resize_with(self, min_new_len, fill_value);
    }

    return self[elem]!;
  },

  // rustc: compiler/rustc_index/src/vec.rs:183 resize
  resize<T>(self: T[], new_len: number, value: T, clone_T?: (v: T) => T): void {
    if (new_len <= self.length) {
      self.length = new_len;
    } else {
      const extra = new_len - self.length;
      for (let i = 0; i < extra; i++) self.push(clone_T === undefined || i === extra - 1 ? value : clone_T(value));
    }
  },

  // rustc: compiler/rustc_index/src/vec.rs:191 resize_to_elem
  resize_to_elem<I extends number, T>(self: T[], elem: I, fill_value: () => T): void {
    const min_new_len = elem + 1;
    resize_with(self, min_new_len, fill_value);
  },

  // rustc: compiler/rustc_index/src/vec.rs:197 append
  append<T>(self: T[], other: T[]): void {
    for (const v of other) self.push(v);
    other.length = 0;
  },

  // rustc: compiler/rustc_index/src/vec.rs:202 debug_map_view
  debug_map_view<T>(self: readonly T[]): IndexSliceMapView<T> {
    return { _0: IndexVec.as_slice(self) };
  },

  // ---- `IndexVec` is often used as a map, so it provides some map-like APIs. (`impl<I, T> IndexVec<I, Option<T>>`)

  // rustc: compiler/rustc_index/src/vec.rs:210 insert
  insert<I extends number, T>(self: (T | undefined)[], index: I, value: T): T | undefined {
    IndexVec.ensure_contains_elem<I, T | undefined>(self, index, () => undefined);
    // `Option::replace`
    const old = self[index];
    self[index] = value;
    return old;
  },

  // rustc: compiler/rustc_index/src/vec.rs:215 get_or_insert_with
  get_or_insert_with<I extends number, T>(self: (T | undefined)[], index: I, value: () => T): T {
    IndexVec.ensure_contains_elem<I, T | undefined>(self, index, () => undefined);
    // `Option::get_or_insert_with`
    let v: T | undefined = self[index];
    if (v === undefined) {
      v = value();
      self[index] = v;
    }
    return v;
  },

  // rustc: compiler/rustc_index/src/vec.rs:220 remove
  remove<I extends number, T>(self: (T | undefined)[], index: I): T | undefined {
    if (index >= self.length) return undefined;
    // `Option::take`
    const v = self[index];
    self[index] = undefined;
    return v;
  },

  // rustc: compiler/rustc_index/src/vec.rs:225 contains
  contains<I extends number, T>(self: readonly (T | undefined)[], index: I): boolean {
    return index < self.length && self[index] !== undefined;
  },

  /// This debug view will skip printing `None` entries.
  /// This is useful when the slice is actually like a map and `None` means
  /// a value is absent under that key.
  // rustc: compiler/rustc_index/src/vec.rs:233 debug_map_view_compact
  debug_map_view_compact<T>(self: readonly (T | undefined)[]): IndexSliceMapViewCompact<T> {
    return { _0: IndexVec.as_slice(self) };
  },

  // impl<I: Idx, T: fmt::Debug> fmt::Debug for IndexVec<I, T>
  // rustc: compiler/rustc_index/src/vec.rs:242 fmt
  fmt<T>(self: readonly T[], fmt: Fmt, debug_T: Debug<T>): string {
    return IndexSlice.fmt(IndexVec.as_slice(self), fmt, debug_T);
  },

  // impl<I: Idx, T> Deref for IndexVec<I, T>
  // rustc: compiler/rustc_index/src/vec.rs:273 deref
  deref<T>(self: readonly T[]): readonly T[] {
    return IndexVec.as_slice(self);
  },

  // impl<I: Idx, T> DerefMut for IndexVec<I, T>
  // rustc: compiler/rustc_index/src/vec.rs:280 deref_mut
  deref_mut<T>(self: T[]): T[] {
    return IndexVec.as_mut_slice(self);
  },

  // impl<I: Idx, T> Borrow<IndexSlice<I, T>> for IndexVec<I, T>
  // rustc: compiler/rustc_index/src/vec.rs:286 borrow
  borrow<T>(self: readonly T[]): readonly T[] {
    return self;
  },

  // impl<I: Idx, T> BorrowMut<IndexSlice<I, T>> for IndexVec<I, T>
  // rustc: compiler/rustc_index/src/vec.rs:292 borrow_mut
  borrow_mut<T>(self: T[]): T[] {
    return self;
  },

  // impl<I: Idx, T> Extend<T> for IndexVec<I, T>
  // rustc: compiler/rustc_index/src/vec.rs:299 extend
  extend<T>(self: T[], iter: Iterable<T>): void {
    for (const v of iter) self.push(v);
  },

  // rustc: compiler/rustc_index/src/vec.rs:305 extend_one
  extend_one<T>(self: T[], item: T): void {
    self.push(item);
  },

  // rustc: compiler/rustc_index/src/vec.rs:311 extend_reserve
  extend_reserve<T>(_self: T[], _additional: number): void {},

  // impl<I: Idx, T> FromIterator<T> for IndexVec<I, T>
  // rustc: compiler/rustc_index/src/vec.rs:318 from_iter
  from_iter<T>(iter: Iterable<T>): T[] {
    return IndexVec.from_raw(Array.from(iter));
  },

  // impl<I: Idx, T> IntoIterator for IndexVec<I, T>
  // rustc: compiler/rustc_index/src/vec.rs:331 into_iter
  into_iter_owned<T>(self: T[]): IterableIterator<T> {
    return self.values();
  },

  // impl<'a, I: Idx, T> IntoIterator for &'a IndexVec<I, T>
  // rustc: compiler/rustc_index/src/vec.rs:341 into_iter
  into_iter_ref<T>(self: readonly T[]): IterableIterator<T> {
    return IndexSlice.iter(self);
  },

  // impl<'a, I: Idx, T> IntoIterator for &'a mut IndexVec<I, T>
  // rustc: compiler/rustc_index/src/vec.rs:351 into_iter
  into_iter_mut<T>(self: T[]): IterableIterator<T> {
    return IndexSlice.iter_mut(self);
  },

  // impl<I: Idx, T> Default for IndexVec<I, T>
  // rustc: compiler/rustc_index/src/vec.rs:358 default
  default_<T>(): T[] {
    return IndexVec.new<T>();
  },

  // impl<I: Idx, T, const N: usize> From<[T; N]> for IndexVec<I, T>
  // rustc: compiler/rustc_index/src/vec.rs:365 from
  from<T>(array: readonly T[]): T[] {
    return IndexVec.from_raw(array.slice());
  },

  // impl<S: Encoder, I: Idx, T: Encodable<S>> Encodable<S> for IndexVec<I, T>
  // rustc: compiler/rustc_index/src/vec.rs:372 encode
  encode<T, S extends Encoder>(self: readonly T[], s: S, encode_T: Encodable<T, S>): void {
    encode_Vec(self, s, encode_T);
  },

  // impl<D: Decoder, I: Idx, T: Decodable<D>> Decodable<D> for IndexVec<I, T>
  // rustc: compiler/rustc_index/src/vec.rs:379 decode
  decode<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): T[] {
    return IndexVec.from_raw(decode_Vec(d, decode_T));
  },
};

// rustc-type: compiler/rustc_index/src/vec.rs:238 IndexSliceMapView
export interface IndexSliceMapView<T> {
  readonly _0: readonly T[];
}
// rustc-type: compiler/rustc_index/src/vec.rs:239 IndexSliceMapViewCompact
export interface IndexSliceMapViewCompact<T> {
  readonly _0: readonly (T | undefined)[];
}

// impl<'a, I: Idx, T: fmt::Debug> fmt::Debug for IndexSliceMapView<'a, I, T>
// rustc: compiler/rustc_index/src/vec.rs:248 fmt
export function debug_IndexSliceMapView<I extends number, T>(self: IndexSliceMapView<T>, fmt: Fmt, debug_I: Debug<I>, debug_T: Debug<T>): string {
  const entries: [string, string][] = [];
  for (const [idx, val] of IndexSlice.iter_enumerated<I, T>(self._0)) {
    entries.push([debug_I(idx, fmt), debug_T(val, fmt)]);
  }
  return debug_map(fmt, entries);
}

// impl<'a, I: Idx, T: fmt::Debug> fmt::Debug for IndexSliceMapViewCompact<'a, I, T>
// rustc: compiler/rustc_index/src/vec.rs:258 fmt
export function debug_IndexSliceMapViewCompact<I extends number, T>(
  self: IndexSliceMapViewCompact<T>,
  fmt: Fmt,
  debug_I: Debug<I>,
  debug_T: Debug<T>,
): string {
  const entries: [string, string][] = [];
  for (const [idx, val] of IndexSlice.iter_enumerated<I, T | undefined>(self._0)) {
    if (val !== undefined) {
      entries.push([debug_I(idx, fmt), debug_T(val, fmt)]);
    }
  }
  return debug_map(fmt, entries);
}
