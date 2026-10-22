// Port of compiler/rustc_index/src/idx.rs (lane index-ds).
//
// PORT: an `Idx` is a number-like index (`usize`, `u32` or a branded `newtype_index!` handle, PORTING §5), so
// `I::new(i)` / `i.index()` are the identity on the number (newtype handles get `new`/`index` with their `assert!`
// from newtype_index.ts). The trait is a function table (`Idx<I>`) for code that needs the `assert!` of `I::new`;
// `Idx_usize` / `Idx_u32` are the two impls of this file.
//
// PORT: `std::ops::{Bound, RangeBounds}` and the range types (`a..b`, `a..=b`, `a..`, `..b`, `..=b`, `..`) have no
// port in src/std yet; they are defined here, next to `IntoSliceIdx` which maps them (root: move to src/std/ops.ts).
// An `impl RangeBounds<T>` is a `RangeBounds<T>` object holding the values of its `start_bound()` / `end_bound()`.
import type { MutRef } from "../std/mut_ref.ts";
import { assert } from "../std/panic.ts";

/** PORT: `std::ops::Bound<T>`. */
export type Bound<T> = { readonly $: "Included"; readonly _0: T } | { readonly $: "Excluded"; readonly _0: T } | { readonly $: "Unbounded" };

/** PORT: an `impl RangeBounds<T>`: the values of its `start_bound()` / `end_bound()`. */
export interface RangeBounds<T> {
  readonly start_bound: Bound<T>;
  readonly end_bound: Bound<T>;
}

const UNBOUNDED: Bound<never> = Object.freeze({ $: "Unbounded" });

/** `start..end` (`ops::Range`). */
export function range<T>(start: T, end: T): RangeBounds<T> {
  return { start_bound: { $: "Included", _0: start }, end_bound: { $: "Excluded", _0: end } };
}

/** `start..=end` (`ops::RangeInclusive`). */
export function range_inclusive<T>(start: T, end: T): RangeBounds<T> {
  return { start_bound: { $: "Included", _0: start }, end_bound: { $: "Included", _0: end } };
}

/** `start..` (`ops::RangeFrom`). */
export function range_from<T>(start: T): RangeBounds<T> {
  return { start_bound: { $: "Included", _0: start }, end_bound: UNBOUNDED };
}

/** `..end` (`ops::RangeTo`). */
export function range_to<T>(end: T): RangeBounds<T> {
  return { start_bound: UNBOUNDED, end_bound: { $: "Excluded", _0: end } };
}

/** `..=end` (`ops::RangeToInclusive`). */
export function range_to_inclusive<T>(end: T): RangeBounds<T> {
  return { start_bound: UNBOUNDED, end_bound: { $: "Included", _0: end } };
}

/** `..` (`ops::RangeFull`). */
export function range_full<T>(): RangeBounds<T> {
  return { start_bound: UNBOUNDED, end_bound: UNBOUNDED };
}

/** `RangeBounds::contains` for number-like `T`. */
export function range_contains(r: RangeBounds<number>, item: number): boolean {
  const s = r.start_bound;
  const e = r.end_bound;
  const after_start = s.$ === "Included" ? s._0 <= item : s.$ === "Excluded" ? s._0 < item : true;
  const before_end = e.$ === "Included" ? item <= e._0 : e.$ === "Excluded" ? item < e._0 : true;
  return after_start && before_end;
}

/** The elements of a bounded number range (`impl IntoIterator for Range<usize>` / `RangeInclusive<usize>`). */
export function* range_iter(r: RangeBounds<number>): Generator<number> {
  const s = r.start_bound;
  const e = r.end_bound;
  const start = s.$ === "Included" ? s._0 : s.$ === "Excluded" ? s._0 + 1 : 0;
  assert(e.$ !== "Unbounded", "range_iter: unbounded end");
  const end = e.$ === "Included" ? e._0 + 1 : e._0;
  for (let i = start; i < end; i++) yield i;
}

/// Represents some newtyped `usize` wrapper.
///
/// Purpose: avoid mixing indexes for different bitvector domains.
// rustc-type: compiler/rustc_index/src/idx.rs:9 Idx
export interface Idx<I extends number> {
  // rustc: compiler/rustc_index/src/idx.rs:10 new
  "new"(idx: number): I;

  // rustc: compiler/rustc_index/src/idx.rs:12 index
  index(self: I): number;

  // (provided) increment_by
  // (provided) plus
}

/** Provided methods of `Idx`. */
export const Idx_provided = {
  // rustc: compiler/rustc_index/src/idx.rs:15 increment_by
  increment_by<I extends number>(I_: Idx<I>, self: MutRef<I>, amount: number): void {
    self.value = Idx_provided.plus(I_, self.value, amount);
  },

  // rustc: compiler/rustc_index/src/idx.rs:21 plus
  plus<I extends number>(I_: Idx<I>, self: I, amount: number): I {
    return I_.new(I_.index(self) + amount);
  },
};

/** `impl Idx for usize`. */
export const Idx_usize: Idx<number> = {
  // rustc: compiler/rustc_index/src/idx.rs:28 new
  new(idx: number): number {
    return idx;
  },
  // rustc: compiler/rustc_index/src/idx.rs:32 index
  index(self: number): number {
    return self;
  },
};

/** `impl Idx for u32`. */
export const Idx_u32: Idx<number> = {
  // rustc: compiler/rustc_index/src/idx.rs:39 new
  new(idx: number): number {
    assert(idx <= 0xffff_ffff, "assertion failed: idx <= u32::MAX as usize");
    return idx;
  },
  // rustc: compiler/rustc_index/src/idx.rs:44 index
  index(self: number): number {
    return self;
  },
};

/// Helper trait for indexing operations with a custom index type.
// rustc-type: compiler/rustc_index/src/idx.rs:50 IntoSliceIdx
export interface IntoSliceIdx<R> {
  // rustc: compiler/rustc_index/src/idx.rs:52 into_slice_idx
  into_slice_idx(self: R): R;
}

///
/// PORT: every impl maps an index or range of `I` to the same index or range of `usize`; with number-like indices
/// that is the identity on the value. One entry per upstream impl, so the markers stay greppable.
export const IntoSliceIdx = {
  /** `impl<I: Idx, T> IntoSliceIdx<I, [T]> for I` */
  I: {
    // rustc: compiler/rustc_index/src/idx.rs:58 into_slice_idx
    into_slice_idx(self: number): number {
      return self;
    },
  },
  /** `impl<I, T> IntoSliceIdx<I, [T]> for ops::RangeFull` */
  RangeFull: {
    // rustc: compiler/rustc_index/src/idx.rs:66 into_slice_idx
    into_slice_idx(self: RangeBounds<number>): RangeBounds<number> {
      return self;
    },
  },
  /** `impl<I: Idx, T> IntoSliceIdx<I, [T]> for ops::Range<I>` */
  Range: {
    // rustc: compiler/rustc_index/src/idx.rs:74 into_slice_idx
    into_slice_idx(self: RangeBounds<number>): RangeBounds<number> {
      return self;
    },
  },
  /** `impl<I: Idx, T> IntoSliceIdx<I, [T]> for ops::RangeFrom<I>` */
  RangeFrom: {
    // rustc: compiler/rustc_index/src/idx.rs:82 into_slice_idx
    into_slice_idx(self: RangeBounds<number>): RangeBounds<number> {
      return self;
    },
  },
  /** `impl<I: Idx, T> IntoSliceIdx<I, [T]> for ops::RangeTo<I>` */
  RangeTo: {
    // rustc: compiler/rustc_index/src/idx.rs:90 into_slice_idx
    into_slice_idx(self: RangeBounds<number>): RangeBounds<number> {
      return self;
    },
  },
  /** `impl<I: Idx, T> IntoSliceIdx<I, [T]> for ops::RangeInclusive<I>` */
  RangeInclusive: {
    // rustc: compiler/rustc_index/src/idx.rs:98 into_slice_idx
    into_slice_idx(self: RangeBounds<number>): RangeBounds<number> {
      return self;
    },
  },
  /** `impl<I: Idx, T> IntoSliceIdx<I, [T]> for ops::RangeToInclusive<I>` */
  RangeToInclusive: {
    // rustc: compiler/rustc_index/src/idx.rs:106 into_slice_idx
    into_slice_idx(self: RangeBounds<number>): RangeBounds<number> {
      return self;
    },
  },
  /** `impl<I: Idx, T> IntoSliceIdx<I, [T]> for core::range::Range<I>` */
  core_range_Range: {
    // rustc: compiler/rustc_index/src/idx.rs:115 into_slice_idx
    into_slice_idx(self: RangeBounds<number>): RangeBounds<number> {
      return self;
    },
  },
  /** `impl<I: Idx, T> IntoSliceIdx<I, [T]> for core::range::RangeFrom<I>` */
  core_range_RangeFrom: {
    // rustc: compiler/rustc_index/src/idx.rs:124 into_slice_idx
    into_slice_idx(self: RangeBounds<number>): RangeBounds<number> {
      return self;
    },
  },
  /** `impl<I: Idx, T> IntoSliceIdx<I, [T]> for core::range::RangeInclusive<I>` */
  core_range_RangeInclusive: {
    // rustc: compiler/rustc_index/src/idx.rs:133 into_slice_idx
    into_slice_idx(self: RangeBounds<number>): RangeBounds<number> {
      return self;
    },
  },
  /** `impl<I: Idx, T> IntoSliceIdx<I, [T]> for core::range::RangeToInclusive<I>` */
  core_range_RangeToInclusive: {
    // rustc: compiler/rustc_index/src/idx.rs:142 into_slice_idx
    into_slice_idx(self: RangeBounds<number>): RangeBounds<number> {
      return self;
    },
  },
};
