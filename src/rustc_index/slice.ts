// Port of compiler/rustc_index/src/slice.rs (`invert_bijective_mapping` by lane merge-layout; the rest by lane index-ds).
//
// PORT: `IndexSlice<I, T>` is a `T[]` indexed by the handle number (PORTING §5), so its methods are functions taking
// the array first, on the companion const `IndexSlice` (`IndexSlice.iter_enumerated(v)`); `invert_bijective_mapping`
// is also a free export (its existing users). `&IndexSlice` / `&mut IndexSlice` are the array itself (`from_raw` is the
// identity). Sub-slicing by a range (`get(range)`, `index(range)`) returns a copy: JS arrays have no in-place views.
// `&mut T` results (`get_mut`, `pick2_mut`, `index_mut`) are the elements themselves: an object element is mutated in
// place; a primitive element must be written back by the caller (`v[i] = x`).
import { type Debug, debug_vec, type Fmt } from "../std/fmt.ts";
import { panic } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { binary_search_by } from "../std/slice.ts";
import type { RangeBounds } from "./idx.ts";

/** `RangeBounds<usize>` resolved against a slice of length `len` (`slice::range`), panicking like `[T]::index`. */
function slice_range(r: RangeBounds<number>, len: number): [number, number] {
  const s = r.start_bound;
  const e = r.end_bound;
  const start = s.$ === "Included" ? s._0 : s.$ === "Excluded" ? s._0 + 1 : 0;
  const end = e.$ === "Included" ? e._0 + 1 : e.$ === "Excluded" ? e._0 : len;
  if (start > end) panic(`slice index starts at ${start} but ends at ${end}`);
  if (end > len) panic(`range end index ${end} out of range for slice of length ${len}`);
  return [start, end];
}

/** A `R: IntoSliceIdx<I, [T]>` argument: an index or a range of indices. */
type SliceIdx = number | RangeBounds<number>;

/// A view into contiguous `T`s, indexed by `I` rather than by `usize`.
///
/// One common pattern you'll see is code that uses [`IndexVec::from_elem`]
/// to create the storage needed for a particular "universe" (aka the set of all
/// the possible keys that need an associated value) then passes that working
/// area as `&mut IndexSlice<I, T>` to clarify that nothing will be added nor
/// removed during processing (and, as a bonus, to chase fewer pointers).
// rustc-type: compiler/rustc_index/src/slice.rs:18 IndexSlice
export const IndexSlice = {
  // rustc: compiler/rustc_index/src/slice.rs:25 empty
  empty<T>(): readonly T[] {
    return IndexSlice.from_raw<T>([]);
  },

  // rustc: compiler/rustc_index/src/slice.rs:30 from_raw
  from_raw<T>(raw: readonly T[]): readonly T[] {
    // SAFETY: `IndexSlice` is `repr(transparent)` over a normal slice
    return raw;
  },

  // rustc: compiler/rustc_index/src/slice.rs:37 from_raw_mut
  from_raw_mut<T>(raw: T[]): T[] {
    // SAFETY: `IndexSlice` is `repr(transparent)` over a normal slice
    return raw;
  },

  // rustc: compiler/rustc_index/src/slice.rs:44 len
  len<T>(self: readonly T[]): number {
    return self.length;
  },

  // rustc: compiler/rustc_index/src/slice.rs:49 is_empty
  is_empty<T>(self: readonly T[]): boolean {
    return self.length === 0;
  },

  /// Gives the next index that will be assigned when `push` is called.
  ///
  /// Manual bounds checks can be done using `idx < slice.next_index()`
  /// (as opposed to `idx.index() < slice.len()`).
  // rustc: compiler/rustc_index/src/slice.rs:58 next_index
  next_index<I extends number, T>(self: readonly T[]): I {
    return self.length as I;
  },

  // rustc: compiler/rustc_index/src/slice.rs:63 iter
  iter<T>(self: readonly T[]): IterableIterator<T> {
    return self.values();
  },

  // rustc: compiler/rustc_index/src/slice.rs:68 iter_enumerated
  *iter_enumerated<I extends number, T>(self: readonly T[]): Generator<[I, T]> {
    // Allow the optimizer to elide the bounds checking when creating each index.
    // let _ = I::new(self.len());
    for (let n = 0; n < self.length; n++) yield [n as I, self[n]!];
  },

  // rustc: compiler/rustc_index/src/slice.rs:75 indices
  *indices<I extends number, T>(self: readonly T[]): Generator<I> {
    // Allow the optimizer to elide the bounds checking when creating each index.
    // let _ = I::new(self.len());
    const len = self.length;
    for (let n = 0; n < len; n++) yield n as I;
  },

  // rustc: compiler/rustc_index/src/slice.rs:84 iter_mut
  iter_mut<T>(self: T[]): IterableIterator<T> {
    return self.values();
  },

  // rustc: compiler/rustc_index/src/slice.rs:89 iter_enumerated_mut
  *iter_enumerated_mut<I extends number, T>(self: T[]): Generator<[I, T]> {
    // Allow the optimizer to elide the bounds checking when creating each index.
    // let _ = I::new(self.len());
    for (let n = 0; n < self.length; n++) yield [n as I, self[n]!];
  },

  // rustc: compiler/rustc_index/src/slice.rs:98 last_index
  last_index<I extends number, T>(self: readonly T[]): I | undefined {
    return self.length === 0 ? undefined : ((self.length - 1) as I);
  },

  // rustc: compiler/rustc_index/src/slice.rs:103 swap
  swap<I extends number, T>(self: T[], a: I, b: I): void {
    if (a >= self.length || b >= self.length) panic(`index out of bounds: the len is ${self.length} but the index is ${a >= self.length ? a : b}`);
    const t = self[a]!;
    self[a] = self[b]!;
    self[b] = t;
  },

  // rustc: compiler/rustc_index/src/slice.rs:108 copy_within
  copy_within<I extends number, T>(self: T[], src: RangeBounds<number>, dest: I): void {
    const [start, end] = slice_range(src, self.length);
    const count = end - start;
    if (dest > self.length - count) panic("dest is out of bounds");
    self.copyWithin(dest, start, end);
  },

  // rustc: compiler/rustc_index/src/slice.rs:119 get
  get<T>(self: readonly T[], index: SliceIdx): T | readonly T[] | undefined {
    if (typeof index === "number") {
      return index < self.length ? self[index] : undefined;
    }
    const s = index.start_bound;
    const e = index.end_bound;
    const start = s.$ === "Included" ? s._0 : s.$ === "Excluded" ? s._0 + 1 : 0;
    const end = e.$ === "Included" ? e._0 + 1 : e.$ === "Excluded" ? e._0 : self.length;
    if (start > end || end > self.length) return undefined;
    return self.slice(start, end);
  },

  // rustc: compiler/rustc_index/src/slice.rs:127 get_mut
  get_mut<T>(self: T[], index: SliceIdx): T | readonly T[] | undefined {
    return IndexSlice.get(self, index);
  },

  /// Returns mutable references to two distinct elements, `a` and `b`.
  ///
  /// Panics if `a == b` or if some of them are out of bounds.
  // rustc: compiler/rustc_index/src/slice.rs:138 pick2_mut
  pick2_mut<I extends number, T>(self: T[], a: I, b: I): [T, T] {
    const ai = a;
    const bi = b;

    // PORT: `self.raw.get_disjoint_mut([ai, bi])` checks bounds first, then overlap.
    if (ai >= self.length || bi >= self.length) {
      panic(`Some indices among (${ai}, ${bi}) are out of bounds`);
    }
    if (ai === bi) {
      panic(`Indices ${ai} and ${bi} are not disjoint!`);
    }
    return [self[ai]!, self[bi]!];
  },

  /// Returns mutable references to three distinct elements.
  ///
  /// Panics if the elements are not distinct or if some of them are out of bounds.
  // rustc: compiler/rustc_index/src/slice.rs:154 pick3_mut
  pick3_mut<I extends number, T>(self: T[], a: I, b: I, c: I): [T, T, T] {
    const ai = a;
    const bi = b;
    const ci = c;

    // PORT: `self.raw.get_disjoint_mut([ai, bi, ci])` checks bounds first, then overlap.
    if (ai >= self.length || bi >= self.length || ci >= self.length) {
      panic(`Some indices among (${ai}, ${bi}, ${ci}) are out of bounds`);
    }
    if (ai === bi || ai === ci || bi === ci) {
      panic(`Indices ${ai}, ${bi} and ${ci} are not disjoint!`);
    }
    return [self[ai]!, self[bi]!, self[ci]!];
  },

  // PORT: `T: Ord` is a `cmp` function returning -1 / 0 / 1.
  // rustc: compiler/rustc_index/src/slice.rs:169 binary_search
  binary_search<I extends number, T>(self: readonly T[], value: T, cmp: (a: T, b: T) => -1 | 0 | 1): Result<I, I> {
    const r = binary_search_by(self, (x) => cmp(x, value));
    if (r.ok) {
      return Ok(r.i as I);
    } else {
      return Err(r.i as I);
    }
  },

  invert_bijective_mapping,

  // impl<I: Idx, T: fmt::Debug> fmt::Debug for IndexSlice<I, T>
  // rustc: compiler/rustc_index/src/slice.rs:208 fmt
  fmt<T>(self: readonly T[], fmt: Fmt, debug_T: Debug<T>): string {
    return debug_vec(self, fmt, debug_T);
  },

  // impl<I: Idx, T, R: IntoSliceIdx<I, [T]>> Index<R> for IndexSlice<I, T>
  // rustc: compiler/rustc_index/src/slice.rs:217 index
  index<T>(self: readonly T[], index: SliceIdx): T | readonly T[] {
    if (typeof index === "number") {
      if (index >= self.length) panic(`index out of bounds: the len is ${self.length} but the index is ${index}`);
      return self[index]!;
    }
    const [start, end] = slice_range(index, self.length);
    return self.slice(start, end);
  },

  // impl<I: Idx, T, R: IntoSliceIdx<I, [T]>> IndexMut<R> for IndexSlice<I, T>
  // rustc: compiler/rustc_index/src/slice.rs:224 index_mut
  index_mut<T>(self: T[], index: SliceIdx): T | readonly T[] {
    return IndexSlice.index(self, index);
  },

  // impl<'a, I: Idx, T> IntoIterator for &'a IndexSlice<I, T>
  // rustc: compiler/rustc_index/src/slice.rs:234 into_iter
  into_iter<T>(self: readonly T[]): IterableIterator<T> {
    return self.values();
  },

  // impl<'a, I: Idx, T> IntoIterator for &'a mut IndexSlice<I, T>
  // rustc: compiler/rustc_index/src/slice.rs:244 into_iter
  into_iter_mut<T>(self: T[]): IterableIterator<T> {
    return self.values();
  },

  // impl<I: Idx, T: Clone> ToOwned for IndexSlice<I, T>
  // PORT: `T: Clone` is `clone_T` (omit it only when `T` is immutable: numbers, strings, interned handles).
  // rustc: compiler/rustc_index/src/slice.rs:252 to_owned
  to_owned<T>(self: readonly T[], clone_T?: (v: T) => T): T[] {
    return clone_T === undefined ? self.slice() : self.map(clone_T);
  },

  // rustc: compiler/rustc_index/src/slice.rs:256 clone_into
  clone_into<T>(self: readonly T[], target: T[], clone_T?: (v: T) => T): void {
    target.length = 0;
    for (const v of self) target.push(clone_T === undefined ? v : clone_T(v));
  },

  // impl<I: Idx, T> Default for &IndexSlice<I, T>
  // rustc: compiler/rustc_index/src/slice.rs:263 default
  default_<T>(): readonly T[] {
    return IndexSlice.from_raw<T>([]);
  },

  // impl<I: Idx, T> Default for &mut IndexSlice<I, T>
  // rustc: compiler/rustc_index/src/slice.rs:270 default
  default_mut<T>(): T[] {
    return IndexSlice.from_raw_mut<T>([]);
  },
};

/// Invert a bijective mapping, i.e. `invert(map)[y] = x` if `map[x] = y`,
/// assuming the values in `self` are a permutation of `0..self.len()`.
///
// FIXME(eddyb) build a better abstraction for permutations, if possible.
// rustc: compiler/rustc_index/src/slice.rs:185 invert_bijective_mapping
export function invert_bijective_mapping<I extends number, J extends number>(self: readonly J[]): I[] {
  // debug_assert_eq!(
  //     self.iter().map(|x| x.index() as u128).sum::<u128>(),
  //     (0..self.len() as u128).sum::<u128>(),
  //     "The values aren't 0..N in input {self:?}",
  // );

  const inverse: I[] = new Array<I>(self.length).fill(0 as I);
  for (let i1 = 0; i1 < self.length; i1++) {
    const i2 = self[i1]!;
    inverse[i2] = i1 as I;
  }

  // debug_assert_eq!(
  //     inverse.iter().map(|x| x.index() as u128).sum::<u128>(),
  //     (0..inverse.len() as u128).sum::<u128>(),
  //     "The values aren't 0..N in result {self:?}",
  // );
  return inverse;
}
