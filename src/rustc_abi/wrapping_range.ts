// Port of compiler/rustc_abi/src/wrapping_range.rs (lane layout-contract: the type, its Debug and what Debug needs;
// lane abi-lib: the other fns).
// Init order: lib.ts re-exports this module, so its top-level code must not touch lib.ts's values.
import { type Debug, type Fmt, PLAIN } from "../std/fmt.ts";
import { assert } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { debug_Size, type Size } from "./lib.ts";

/// Inclusive wrap-around range of valid values, that is, if
/// start > end, it represents `start..=MAX`, followed by `0..=end`.
///
/// That is, for an i8 primitive, a range of `254..=2` means following
/// sequence:
///
///    254 (-2), 255 (-1), 0, 1, 2
///
/// This is intended specifically to mirror LLVM’s `!range` metadata semantics.
// #[derive(Clone, Copy, PartialEq, Eq, Hash)]
// #[cfg_attr(feature = "nightly", derive(StableHash))]
// PORT (layout-contract): a struct with an inherent impl is a class; `u128` fields are `bigint`s; it is `Copy`, so the
// fields are immutable (`with_start` / `with_end` return a new value).
export class WrappingRange {
  constructor(
    readonly start: bigint,
    readonly end: bigint,
  ) {}

  // PORT (layout-contract): `impl fmt::Debug` (`fmt::from_fn`) is a closure taking the formatter.
  // rustc: compiler/rustc_abi/src/wrapping_range.rs:25 debug_as
  debug_as(size: Size, is_signed: boolean): (f: Fmt) => string {
    const range = this;
    return (f) => {
      if (WrappingRange_eq(range, WrappingRange.full(size))) {
        // This is intentionally not using `is_full_for` so that we ensure
        // different values always debug-print differently.
        // We don't need the full details when it's the canonical full range,
        // but if one is looking at the debug output it might be that seeing
        // `u8 is (..=0) | (1..)` instead of `u8 is ..` is the information
        // you needed because the problem is that despite being *a* full
        // range it's not *the* canonical one you expected it was.
        return "..";
      } else if (is_signed) {
        const start = size.sign_extend(range.start);
        const end = size.sign_extend(range.end);
        if (start > end) {
          return `(..=${end}) | (${start}..)`;
        } else {
          return `${start}..=${end}`;
        }
      } else {
        return debug_WrappingRange(range, f);
      }
    };
  }

  // rustc: compiler/rustc_abi/src/wrapping_range.rs:51 full
  static full(size: Size): WrappingRange {
    return new WrappingRange(0n, size.unsigned_int_max());
  }

  /// Returns `true` if `v` is contained in the range.
  // #[inline(always)]
  // rustc: compiler/rustc_abi/src/wrapping_range.rs:57 contains
  contains(v: bigint): boolean {
    if (this.start <= this.end) {
      return this.start <= v && v <= this.end;
    } else {
      return this.start <= v || v <= this.end;
    }
  }

  /// Returns `true` if all the values in `other` are contained in this range,
  /// when the values are considered as having width `size`.
  // #[inline(always)]
  // rustc: compiler/rustc_abi/src/wrapping_range.rs:68 contains_range
  contains_range(other: WrappingRange, size: Size): boolean {
    if (this.is_full_for(size)) {
      return true;
    } else {
      const trunc = (x: bigint) => size.truncate(x);

      const delta = this.start;
      const max = trunc(u128_wrapping_sub(this.end, delta));

      const other_start = trunc(u128_wrapping_sub(other.start, delta));
      const other_end = trunc(u128_wrapping_sub(other.end, delta));

      // Having shifted both input ranges by `delta`, now we only need to check
      // whether `0..=max` contains `other_start..=other_end`, which can only
      // happen if the other doesn't wrap since `self` isn't everything.
      return other_start <= other_end && other_end <= max;
    }
  }

  /// Returns `self` with replaced `start`
  // #[inline(always)]
  // rustc: compiler/rustc_abi/src/wrapping_range.rs:89 with_start
  with_start(start: bigint): WrappingRange {
    // PORT: `self` is a copy (`mut self`); the result is a new value.
    return new WrappingRange(start, this.end);
  }

  /// Returns `self` with replaced `end`
  // #[inline(always)]
  // rustc: compiler/rustc_abi/src/wrapping_range.rs:96 with_end
  with_end(end: bigint): WrappingRange {
    // PORT: `self` is a copy (`mut self`); the result is a new value.
    return new WrappingRange(this.start, end);
  }

  /// The wrapping distance from `self.start` to `self.end`.
  // rustc: compiler/rustc_abi/src/wrapping_range.rs:102 width
  width(size: Size): bigint {
    return size.truncate(u128_wrapping_sub(this.end, this.start));
  }

  /// Returns `true` if `size` completely fills the range.
  ///
  /// Note that this is *not* the same as `self == WrappingRange::full(size)`.
  /// Niche calculations can produce full ranges which are not the canonical one;
  /// for example `Option<NonZero<u16>>` gets `valid_range: (..=0) | (1..)`.
  // #[inline]
  // rustc: compiler/rustc_abi/src/wrapping_range.rs:112 is_full_for
  is_full_for(size: Size): boolean {
    const max_value = size.unsigned_int_max();
    // debug_assert!(self.start <= max_value && self.end <= max_value);
    return this.start === ((this.end + 1n) & U128_MAX & max_value);
  }

  /// Checks whether this range is considered non-wrapping when the values are
  /// interpreted as *unsigned* numbers of width `size`.
  ///
  /// Returns `Ok(true)` if there's no wrap-around, `Ok(false)` if there is,
  /// and `Err(..)` if the range is full so it depends how you think about it.
  // #[inline]
  // PORT (layout-contract): `RangeFull` (`..`) is `null` (a unit value).
  // rustc: compiler/rustc_abi/src/wrapping_range.rs:124 no_unsigned_wraparound
  no_unsigned_wraparound(size: Size): Result<boolean, null> {
    if (this.is_full_for(size)) {
      return Err(null);
    } else {
      return Ok(this.start <= this.end);
    }
  }

  /// Checks whether this range is considered non-wrapping when the values are
  /// interpreted as *signed* numbers of width `size`.
  ///
  /// This is heavily dependent on the `size`, as `100..=200` does wrap when
  /// interpreted as `i8`, but doesn't when interpreted as `i16`.
  ///
  /// Returns `Ok(true)` if there's no wrap-around, `Ok(false)` if there is,
  /// and `Err(..)` if the range is full so it depends how you think about it.
  // #[inline]
  // rustc: compiler/rustc_abi/src/wrapping_range.rs:137 no_signed_wraparound
  no_signed_wraparound(size: Size): Result<boolean, null> {
    if (this.is_full_for(size)) {
      return Err(null);
    } else {
      const start: bigint = size.sign_extend(this.start);
      const end: bigint = size.sign_extend(this.end);
      return Ok(start <= end);
    }
  }

  /// Returns a `WrappingRange` that contains all of the values from the iterator,
  /// when they're treated as values `size` wide.
  ///
  /// # Examples
  ///
  /// ```
  /// use rustc_abi::{Size, WrappingRange};
  ///
  /// let chain = std::iter::chain(10..20, 30..40);
  /// let range = WrappingRange::smallest_range_containing(chain, Size::from_bytes(2));
  /// assert_eq!(range.unwrap(), WrappingRange { start: 10, end: 39 });
  ///
  /// // Values don't need to be sorted nor unique
  /// let range = WrappingRange::smallest_range_containing([3, 5, 3, 1, 3], Size::from_bytes(2));
  /// assert_eq!(range.unwrap(), WrappingRange { start: 1, end: 5 });
  ///
  /// // The size matters because it changes where the wrapping can happen:
  /// let range = WrappingRange::smallest_range_containing([1, 254], Size::from_bytes(1));
  /// assert_eq!(range.unwrap(), WrappingRange { start: 254, end: 1 });
  /// let range = WrappingRange::smallest_range_containing([1, 254], Size::from_bytes(4));
  /// assert_eq!(range.unwrap(), WrappingRange { start: 1, end: 254 });
  /// ```
  // PORT (layout-contract): `impl IntoIterator<Item = u128>` is an `Iterable<bigint>`.
  // rustc: compiler/rustc_abi/src/wrapping_range.rs:169 smallest_range_containing
  static smallest_range_containing(values_: Iterable<bigint>, size: Size): WrappingRange | undefined {
    const values: bigint[] = [...values_];

    // `values.iter().copied().map(|x| (x, x)).reduce(|a, b| (u128::min(a.0, b.0), u128::max(a.1, b.1)))?`
    if (values.length === 0) return undefined;
    let [min, max] = [values[0]!, values[0]!];
    for (let i = 1; i < values.length; i++) {
      const x = values[i]!;
      [min, max] = [min < x ? min : x, max > x ? max : x];
    }

    // Just checking the max is enough to ensure that everything is in-range.
    assert(max <= size.unsigned_int_max(), () => `Value ${max} is too big for ${debug_Size(size, PLAIN)}`);

    // The simple answer is the non-wraparound range `min..=max`.
    const obvious_range = new WrappingRange(min, max);

    // It's very common that the input was only small non-negative integers and the
    // obvious range turns out to be the best we can do.
    // Every possible wraparound range must include at least `(...=min) | (max..)`,
    // so if what we found already is at least that good, just use it.
    //     WR(min, max).width() ≤ WR(max, min).width()
    //         (max - min) % 2ⁿ ≤ (min - max) % 2ⁿ
    //                max - min ≤ min - max + 2ⁿ
    //            2×(max - min) ≤ 2ⁿ
    //                max - min ≤ 2ⁿ⁻¹
    const half_range = 1n << BigInt(size.bits() - 1);
    if (max - min <= half_range) {
      return obvious_range;
    }

    // But every `[.., end, start, ..]` is also a potential candidate for a wraparound
    // range `(..=end) | (start..)`, so long as `start` and `end` aren't duplicates.
    values.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const wraparound_ranges: WrappingRange[] = [];
    for (let i = 0; i + 1 < values.length; i++) {
      const [end, start] = [values[i]!, values[i + 1]!];
      if (start !== end) wraparound_ranges.push(new WrappingRange(start, end));
    }

    // Pick whichever range is smallest. By putting the non-wraparound range first,
    // it'll be preferred over a wraparound range with the same width.
    // PORT: `Iterator::min_by_key` returns the first minimum.
    let best = obvious_range;
    let best_width = obvious_range.width(size);
    for (const r of wraparound_ranges) {
      const w = r.width(size);
      if (w < best_width) [best, best_width] = [r, w];
    }
    return best;
  }
}

/** `u128::wrapping_sub` */
function u128_wrapping_sub(a: bigint, b: bigint): bigint {
  return (a - b) & U128_MAX;
}
const U128_MAX = (1n << 128n) - 1n;

/** derive(PartialEq) */
export function WrappingRange_eq(a: WrappingRange, b: WrappingRange): boolean {
  return a.start === b.start && a.end === b.end;
}

// impl fmt::Debug for WrappingRange
// rustc: compiler/rustc_abi/src/wrapping_range.rs:215 fmt
export const debug_WrappingRange: Debug<WrappingRange> = (self) => {
  if (self.start > self.end) {
    return `(..=${self.end}) | (${self.start}..)`;
  } else {
    return `${self.start}..=${self.end}`;
  }
};
