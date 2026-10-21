// Port of compiler/rustc_abi/src/wrapping_range.rs (lane layout-contract: the type, its Debug and what Debug needs;
// the other fns are `// stub:` declarations for lane abi-lib, docs/handoff/layout-contract.md).
// Init order: lib.ts re-exports this module, so its top-level code must not touch lib.ts's values.
import type { Debug, Fmt } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";
import type { Size } from "./lib.ts";

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
  // stub: compiler/rustc_abi/src/wrapping_range.rs:57 contains (lane abi-lib)
  contains(_v: bigint): boolean {
    return unported("rustc_abi::wrapping_range::WrappingRange::contains");
  }

  /// Returns `true` if all the values in `other` are contained in this range,
  /// when the values are considered as having width `size`.
  // #[inline(always)]
  // stub: compiler/rustc_abi/src/wrapping_range.rs:68 contains_range (lane abi-lib)
  contains_range(_other: WrappingRange, _size: Size): boolean {
    return unported("rustc_abi::wrapping_range::WrappingRange::contains_range");
  }

  /// Returns `self` with replaced `start`
  // #[inline(always)]
  // stub: compiler/rustc_abi/src/wrapping_range.rs:89 with_start (lane abi-lib)
  with_start(_start: bigint): WrappingRange {
    return unported("rustc_abi::wrapping_range::WrappingRange::with_start");
  }

  /// Returns `self` with replaced `end`
  // #[inline(always)]
  // stub: compiler/rustc_abi/src/wrapping_range.rs:96 with_end (lane abi-lib)
  with_end(_end: bigint): WrappingRange {
    return unported("rustc_abi::wrapping_range::WrappingRange::with_end");
  }

  /// The wrapping distance from `self.start` to `self.end`.
  // stub: compiler/rustc_abi/src/wrapping_range.rs:102 width (lane abi-lib)
  width(_size: Size): bigint {
    return unported("rustc_abi::wrapping_range::WrappingRange::width");
  }

  /// Returns `true` if `size` completely fills the range.
  ///
  /// Note that this is *not* the same as `self == WrappingRange::full(size)`.
  /// Niche calculations can produce full ranges which are not the canonical one;
  /// for example `Option<NonZero<u16>>` gets `valid_range: (..=0) | (1..)`.
  // #[inline]
  // stub: compiler/rustc_abi/src/wrapping_range.rs:112 is_full_for (lane abi-lib)
  is_full_for(_size: Size): boolean {
    return unported("rustc_abi::wrapping_range::WrappingRange::is_full_for");
  }

  /// Checks whether this range is considered non-wrapping when the values are
  /// interpreted as *unsigned* numbers of width `size`.
  ///
  /// Returns `Ok(true)` if there's no wrap-around, `Ok(false)` if there is,
  /// and `Err(..)` if the range is full so it depends how you think about it.
  // #[inline]
  // PORT (layout-contract): `RangeFull` (`..`) is `null` (a unit value).
  // stub: compiler/rustc_abi/src/wrapping_range.rs:124 no_unsigned_wraparound (lane abi-lib)
  no_unsigned_wraparound(_size: Size): Result<boolean, null> {
    return unported("rustc_abi::wrapping_range::WrappingRange::no_unsigned_wraparound");
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
  // stub: compiler/rustc_abi/src/wrapping_range.rs:137 no_signed_wraparound (lane abi-lib)
  no_signed_wraparound(_size: Size): Result<boolean, null> {
    return unported("rustc_abi::wrapping_range::WrappingRange::no_signed_wraparound");
  }

  /// Returns a `WrappingRange` that contains all of the values from the iterator,
  /// when they're treated as values `size` wide.
  // PORT (layout-contract): `impl IntoIterator<Item = u128>` is an `Iterable<bigint>`.
  // stub: compiler/rustc_abi/src/wrapping_range.rs:169 smallest_range_containing (lane abi-lib)
  static smallest_range_containing(_values: Iterable<bigint>, _size: Size): WrappingRange | undefined {
    return unported("rustc_abi::wrapping_range::WrappingRange::smallest_range_containing");
  }
}

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
