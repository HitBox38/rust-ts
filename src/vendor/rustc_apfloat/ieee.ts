// Port of rustc_apfloat =0.2.3+llvm-462a31f5a5ab `src/ieee.rs`.
//
// PORT: representation.
// - `Limb` (`u128`) is a `bigint` kept in 0..2^128; `u128` arithmetic is written with the helpers below
//   (`!x` = `not(x)`, `x << n` = `shl(x, n)`, `wrapping_*`, `overflowing_*`). Shifts mask the shift amount
//   with 127, as rustc's release build (no overflow checks) does.
// - `[Limb; N]`, `&[Limb]` and `DynPrecisionLimbVec` (`SmallVec<[Limb; 2]>`) are `Limb[]`; `&mut [Limb]` slices
//   are the arrays themselves (the one mutable sub-slice, in `sig::extract`, is copied out and back).
// - `&mut ExpInt` / `&mut bool` out-parameters are `MutRef`s (`&mut 0` is a fresh `{ value: 0 }`).
// - `IeeeFloat<S>` is a class whose `marker` field (`PhantomData<S>`) holds the `Semantics` dictionary `S`; its
//   static side (`Float`'s associated items, `Self::ZERO`, ...) is the `IeeeFloatType<S>` of `ieee_float_type(S)`
//   (the exported `Half`, `Single`, `Double`, ... values). `IeeeFloat`s are immutable values: a `mut self` method
//   works on a `clone()`, and the shared constants are frozen.
// - `Semantics`' provided consts are computed by `semantics(..)` in upstream's order; its provided fns are
//   `Semantics_provided`. `NAME` (the semantics type's name) is a rust-ts addition that also makes
//   `IeeeFloat<HalfS>` and `IeeeFloat<SingleS>` distinct TS types.
// - `&str` arguments of the parsers are JS strings: byte offsets (`char_indices`, `s.len()`) are computed as UTF-8,
//   and every slice taken at such an offset follows only ASCII (any other character is rejected first).
//
//! Support for floating point types compatible with IEEE 754.

import type { MutRef } from "../../std/mut_ref.ts";
import { assert, panic, unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import {
  Category,
  type ExpInt,
  FLOAT_COMMON_METHODS,
  FLOAT_PROVIDED_METHODS,
  type Float,
  type FloatConvert,
  FloatConvert_provided,
  type FloatFmt,
  type FloatType,
  Float_provided,
  IEK_INF,
  IEK_NAN,
  IEK_ZERO,
  type Ordering,
  ParseError,
  Round,
  Status,
  type StatusAnd,
  StatusAnd as StatusAnd_,
  float_common_impls,
} from "./lib.ts";

// ---- u128 / i32 helpers (PORT: Rust primitive operations) ----

/** `!0` of `u128` */
const MAX: Limb = (1n << 128n) - 1n;
/** `!x` */
function not(x: Limb): Limb {
  return x ^ MAX;
}
/** `x << n` (shift amount masked as in release builds; result truncated to 128 bits) */
function shl(x: Limb, n: number): Limb {
  return (x << BigInt(n & 127)) & MAX;
}
/** `x >> n` */
function shr(x: Limb, n: number): Limb {
  return x >> BigInt(n & 127);
}
function wrapping_add(a: Limb, b: Limb): Limb {
  return (a + b) & MAX;
}
function wrapping_sub(a: Limb, b: Limb): Limb {
  return (a - b) & MAX;
}
function wrapping_neg(a: Limb): Limb {
  return -a & MAX;
}
function overflowing_add(a: Limb, b: Limb): [Limb, boolean] {
  const r = a + b;
  return r > MAX ? [r & MAX, true] : [r, false];
}
function overflowing_sub(a: Limb, b: Limb): [Limb, boolean] {
  const r = a - b;
  return r < 0n ? [r & MAX, true] : [r, false];
}
function trailing_zeros(x: Limb): number {
  if (x === 0n) return LIMB_BITS;
  return (x & -x).toString(2).length - 1;
}
function leading_zeros(x: Limb): number {
  if (x === 0n) return LIMB_BITS;
  return LIMB_BITS - x.toString(2).length;
}
function limb_min(a: Limb, b: Limb): Limb {
  return a < b ? a : b;
}
function sat_i32(x: number): number {
  return x > 2147483647 ? 2147483647 : x < -2147483648 ? -2147483648 : x;
}
/** `i32::checked_add(..).unwrap()` / `checked_sub` */
function checked_i32(x: number): number {
  if (x > 2147483647 || x < -2147483648) panic("called `Option::unwrap()` on a `None` value");
  return x;
}
/** `usize::saturating_sub` */
function sat_sub_usize(a: number, b: number): number {
  return a > b ? a - b : 0;
}
/** `Ord::cmp` of numbers / bools. */
function cmp_num(a: number, b: number): Ordering {
  return a < b ? -1 : a > b ? 1 : 0;
}
function cmp_bool(a: boolean, b: boolean): Ordering {
  return a === b ? 0 : a ? 1 : -1;
}
function cmp_limb(a: Limb, b: Limb): Ordering {
  return a < b ? -1 : a > b ? 1 : 0;
}
/** `Ordering::reverse` */
function reverse(o: Ordering): Ordering {
  return -o as Ordering;
}
/** `i32` negation (`Neg for ExpInt`, wrapping). */
function neg_i32(x: ExpInt): ExpInt {
  return -x | 0;
}
/** `char::to_digit(radix)` */
function to_digit(c: number, radix: number): number | undefined {
  let d: number;
  if (c >= 0x30 && c <= 0x39) d = c - 0x30;
  else if (c >= 0x61 && c <= 0x7a) d = c - 0x61 + 10;
  else if (c >= 0x41 && c <= 0x5a) d = c - 0x41 + 10;
  else return undefined;
  return d < radix ? d : undefined;
}
/** `str::char_indices`: [UTF-8 byte offset, code point]. */
function* char_indices(s: string): Generator<[number, number]> {
  let p = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    yield [p, c];
    p += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
}
/** `str::len` (UTF-8) */
function str_len(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}
/** `u128::from_str_radix(s, radix).ok()` (core's `from_str_radix` for an unsigned type). */
function u128_from_str_radix(s: string, radix: number): bigint | undefined {
  if (s.length === 0) return undefined;
  let digits = s;
  if (s === "+" || s === "-") return undefined;
  if (s[0] === "+") digits = s.slice(1);
  let result = 0n;
  const r = BigInt(radix);
  for (let i = 0; i < digits.length; i++) {
    const d = to_digit(digits.charCodeAt(i), radix);
    if (d === undefined) return undefined;
    result = result * r + BigInt(d);
    if (result > MAX) return undefined;
  }
  return result;
}
/** `SmallVec::resize(n, 0)` */
function resize(v: Limb[], n: number): void {
  if (v.length > n) v.length = n;
  else while (v.length < n) v.push(0n);
}
/** `[Limb] == [Limb]` */
function limbs_eq(a: readonly Limb[], b: readonly Limb[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
/** `SmallVec::last() == Some(&0)` */
function last_is_zero(v: readonly Limb[]): boolean {
  return v.length > 0 && v[v.length - 1] === 0n;
}

/// Fundamental unit of big integer arithmetic, but also
/// large to store the largest significands by itself.
export type Limb = bigint;
const LIMB_BITS = 128;
// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:51 limbs_for_bits
function limbs_for_bits(bits: number): number {
  return Math.floor((bits + LIMB_BITS - 1) / LIMB_BITS);
}

/// Growable `[Limb]` (i.e. heap-allocated and typically `Vec`/`SmallVec`/etc.),
/// used only by algorithms that may require dynamically arbitrary precision,
/// i.e. conversions from/to decimal strings.
///
/// Note: the specific type was chosen by starting with `SmallVec<[_; 1]>` and
/// increasing the inline length as long as benchmarks were showing improvements,
/// or at least the `Double::from_str` ones, which roughly had these behaviors:
/// * `Vec<_>` -> `SmallVec<[_; 1]>`: ~15% speedup, but only for shorter inputs
/// * `SmallVec<[_; 1]>` -> `SmallVec<[_; 2]>`: ~10% speedup for longer inputs
/// * `SmallVec<[_; 2]>` -> `SmallVec<[_; 3]>`: noise and/or diminishing returns
///
/// Note: the choice of type described above, and the factors in its decision,
/// are specific to `Limb` being `u128`, so if `Limb` changes, this should too.
type DynPrecisionLimbVec = Limb[];

/// Enum that represents what fraction of the LSB truncated bits of an fp number
/// represent.
///
/// This essentially combines the roles of guard and sticky bits.
// #[must_use]
// #[derive(Copy, Clone, PartialEq, Eq, Debug)]
export type Loss =
  // Example of truncated bits:
  | "ExactlyZero" // 000000
  | "LessThanHalf" // 0xxxxx  x's not all zero
  | "ExactlyHalf" // 100000
  | "MoreThanHalf"; // 1xxxxx  x's not all zero

/// How the nonfinite values Inf and NaN are represented.
// #[derive(Copy, Clone, PartialEq, Eq)]
export type NonfiniteBehavior =
  /// Represents standard IEEE 754 behavior. A value is nonfinite if the
  /// exponent field is all 1s. In such cases, a value is Inf if the
  /// significand bits are all zero, and NaN otherwise
  | "IEEE754"
  /// Only the Float8E5M2 has this behavior. There is no Inf representation. A
  /// value is NaN if the exponent field and the mantissa field are all 1s.
  /// This behavior matches the FP8 E4M3 type described in
  /// <https://arxiv.org/abs/2209.05433>. We treat both signed and unsigned NaNs
  /// as non-signalling, although the paper does not state whether the NaN
  /// values are signalling or not.
  | "NanOnly";
export const NonfiniteBehavior = { IEEE754: "IEEE754", NanOnly: "NanOnly" } as const;

// HACK(eddyb) extension method flipping/changing the sign based on `bool`s.
// PORT: `trait NegExt` (blanket impl for every `T: Neg`): `neg` is `T`'s `Neg`. `IeeeFloat` has the two
// methods as `negate_if` / `with_sign`.
export const NegExt = {
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:103 negate_if
  negate_if<T>(self: T, negate: boolean, neg: (v: T) => T): T {
    if (negate) {
      return neg(self);
    } else {
      return self;
    }
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:111 with_sign
  with_sign<F extends Float<F>>(self: F, sign: boolean): F {
    return NegExt.negate_if(self, self.is_negative() !== sign, (x) => x.neg());
  },
};

/// Represents floating point arithmetic semantics.
export interface Semantics {
  /** PORT: the name of the semantics type (rust-ts addition; also brands `IeeeFloat<S>`). */
  readonly NAME: string;

  /// Total number of bits in the interchange format.
  readonly BITS: number;

  /// Number of exponent bits in the interchange format.
  readonly EXP_BITS: number;

  /// Number of bits in the significand. This includes the integer bit.
  readonly PRECISION: number;

  /// How the nonfinite values Inf and NaN are represented.
  readonly NONFINITE_BEHAVIOR: NonfiniteBehavior;

  /// The largest E such that 2^E is representable; this matches the
  /// definition of IEEE 754.
  readonly MAX_EXP: ExpInt;
  readonly IEEE_MAX_EXP: ExpInt;

  /// The smallest E such that 2^E is a normalized number; this
  /// matches the definition of IEEE 754.
  readonly MIN_EXP: ExpInt;
  readonly IEEE_MIN_EXP: ExpInt;

  /// The base significand bitpattern of NaNs, i.e. the bits that must always
  /// be set in all NaNs, with other significand bits being either used for
  /// payload bits (if `NAN_PAYLOAD_MASK` covers them) or always unset.
  readonly NAN_SIGNIFICAND_BASE: Limb;

  /// The significand bitmask for the payload of a NaN (if supported),
  /// including the "quiet bit" (telling QNaNs apart from SNaNs).
  readonly NAN_PAYLOAD_MASK: Limb;

  /// The significand bitpattern to mark a NaN as quiet (if supported).
  ///
  /// NOTE: for X87DoubleExtended we need to set two bits instead of one.
  ///
  /// NOTE: all NaNs are quiet if unsupported (see `NonfiniteBehavior::NanOnly`).
  readonly QNAN_SIGNIFICAND: Limb;

  from_bits(bits: bigint): IeeeFloat<Semantics>; // (provided)
  to_bits(x: IeeeFloat<Semantics>): bigint; // (provided)
}

/** The items a `Semantics` impl may set; the rest take the trait's defaults. */
interface SemanticsImpl {
  readonly BITS: number;
  readonly EXP_BITS: number;
  readonly PRECISION?: number;
  readonly NONFINITE_BEHAVIOR?: NonfiniteBehavior;
  readonly QNAN_SIGNIFICAND?: (PRECISION: number) => Limb;
  readonly from_bits?: (this: Semantics, bits: bigint) => IeeeFloat<Semantics>;
  readonly to_bits?: (this: Semantics, x: IeeeFloat<Semantics>) => bigint;
}

/** PORT: `impl Semantics for <NAME>`: the associated consts with the trait's defaults, in upstream's order. */
function semantics<const N extends string>(NAME: N, d: SemanticsImpl): Semantics & { readonly NAME: N } {
  const BITS = d.BITS;
  const EXP_BITS = d.EXP_BITS;
  const PRECISION = d.PRECISION ?? BITS - 1 - EXP_BITS + 1;
  const NONFINITE_BEHAVIOR = d.NONFINITE_BEHAVIOR ?? NonfiniteBehavior.IEEE754;
  const IEEE_MIN_EXP = -(1 << (EXP_BITS - 1)) + 2;
  const MIN_EXP = IEEE_MIN_EXP;
  const IEEE_MAX_EXP = -IEEE_MIN_EXP + 1;
  let ieee_inf_and_nan_replaced_with_extra_normals: boolean;
  switch (NONFINITE_BEHAVIOR) {
    case NonfiniteBehavior.IEEE754:
      ieee_inf_and_nan_replaced_with_extra_normals = false;
      break;
    case NonfiniteBehavior.NanOnly:
      ieee_inf_and_nan_replaced_with_extra_normals = true;
      break;
  }
  const MAX_EXP = IEEE_MAX_EXP + (MIN_EXP - IEEE_MIN_EXP) + (ieee_inf_and_nan_replaced_with_extra_normals ? 1 : 0);
  const ieee = NONFINITE_BEHAVIOR === NonfiniteBehavior.IEEE754;
  const NAN_SIGNIFICAND_BASE = ieee ? 0n : shl(1n, PRECISION - 1) - 1n;
  const NAN_PAYLOAD_MASK = ieee ? shl(1n, PRECISION - 1) - 1n : 0n;
  const QNAN_SIGNIFICAND = d.QNAN_SIGNIFICAND !== undefined ? d.QNAN_SIGNIFICAND(PRECISION) : ieee ? shl(1n, PRECISION - 2) : 0n;
  return Object.freeze({
    NAME,
    BITS,
    EXP_BITS,
    PRECISION,
    NONFINITE_BEHAVIOR,
    MAX_EXP,
    IEEE_MAX_EXP,
    MIN_EXP,
    IEEE_MIN_EXP,
    NAN_SIGNIFICAND_BASE,
    NAN_PAYLOAD_MASK,
    QNAN_SIGNIFICAND,
    from_bits: d.from_bits ?? Semantics_provided.from_bits,
    to_bits: d.to_bits ?? Semantics_provided.to_bits,
  });
}

export const Semantics_provided = {
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:177 from_bits
  from_bits(this: Semantics, bits: bigint): IeeeFloat<Semantics> {
    const Self = this;
    assert(Self.BITS > Self.PRECISION);

    const sign = bits & shl(1n, Self.BITS - 1);
    const exponent = shr(bits & not(sign), Self.BITS - 1 - Self.EXP_BITS) & (shl(1n, Self.EXP_BITS) - 1n);
    const r = new IeeeFloat(
      [bits & (shl(1n, Self.PRECISION - 1) - 1n)],
      // Convert the exponent from its bias representation to a signed integer.
      Number(exponent) + (Self.MIN_EXP - 1),
      Category.Zero,
      sign !== 0n,
      Self,
    );

    // NOTE(eddyb) unlike the original C++ code, this doesn't check for
    // specific exponent/significand combinations, but instead relies on
    // being able to construct known-good special values to compare to.
    const try_category_from_special = (special: IeeeFloat<Semantics>): Category | undefined => {
      special = special.copy_sign(r);

      // Ignore NaN payload to avoid needing a separate NaN check.
      const sig_mask = special.is_nan() ? not(Self.NAN_PAYLOAD_MASK) : MAX;

      if (special.is_negative() === r.is_negative() && special.exp === r.exp && (special.sig[0]! & sig_mask) === (r.sig[0]! & sig_mask)) {
        return special.category();
      } else {
        return undefined;
      }
    };

    // NOTE(eddyb) the order here matters, i.e. `NAN` needs to be last, as
    // its relaxed check (see above) overlaps `INFINITY`, for IEEE NaNs.
    const T = ieee_float_type(Self);
    const specials = [T.ZERO, T.INFINITY, T.NAN];

    let category: Category | undefined = undefined;
    for (const s of specials) {
      category = try_category_from_special(s);
      if (category !== undefined) break;
    }
    if (category === undefined) {
      if (r.exp === Self.MIN_EXP - 1) {
        // Denormal.
        r.exp = Self.MIN_EXP;
      } else {
        // Set integer bit.
        sig.set_bit(r.sig, Self.PRECISION - 1);
      }
      category = Category.Normal;
    }

    r.read_only_category_do_not_mutate = category;

    return r;
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:237 to_bits
  to_bits(this: Semantics, x: IeeeFloat<Semantics>): bigint {
    const Self = this;
    const T = ieee_float_type(Self);
    assert(Self.BITS > Self.PRECISION);

    // Split integer bit from significand.
    const integer_bit = sig.get_bit(x.sig, Self.PRECISION - 1);
    let significand = x.sig[0]! & (shl(1n, Self.PRECISION - 1) - 1n);
    let exponent = x.exp;
    switch (x.category()) {
      case Category.Normal:
        if (exponent === Self.MIN_EXP && !integer_bit) {
          // Denormal.
          exponent -= 1;
        }
        break;
      case Category.Zero:
        // FIXME(eddyb) Maybe we should guarantee an invariant instead?
        significand = T.ZERO.sig[0]!;
        exponent = T.ZERO.exp;
        break;
      case Category.Infinity:
        // FIXME(eddyb) Maybe we should guarantee an invariant instead?
        significand = T.INFINITY.sig[0]!;
        exponent = T.INFINITY.exp;
        break;
      case Category.NaN:
        exponent = T.NAN.exp;
        break;
    }

    // Convert the exponent from a signed integer to its bias representation.
    const exponent_ = BigInt.asUintN(128, BigInt(exponent - (Self.MIN_EXP - 1)));

    return shl(x.is_negative() ? 1n : 0n, Self.BITS - 1) | shl(exponent_, Self.PRECISION - 1) | significand;
  },
};

// macro_rules! ieee_semantics: one `Semantics` value (`<name>S`) and one float type (`<name>`) per format.

/** Floating point semantics for [`Half`]. */
export const HalfS = semantics("HalfS", { BITS: 16, EXP_BITS: 5 });
export type HalfS = typeof HalfS;
/// IEEE binary16 half-precision (16-bit) floating point number.
export type Half = IeeeFloat<HalfS>;

/** Floating point semantics for [`Single`]. */
export const SingleS = semantics("SingleS", { BITS: 32, EXP_BITS: 8 });
export type SingleS = typeof SingleS;
/// IEEE binary32 single-precision (32-bit) floating point number.
export type Single = IeeeFloat<SingleS>;

/** Floating point semantics for [`Double`]. */
export const DoubleS = semantics("DoubleS", { BITS: 64, EXP_BITS: 11 });
export type DoubleS = typeof DoubleS;
/// IEEE binary64 double-precision (64-bit) floating point number.
export type Double = IeeeFloat<DoubleS>;

/** Floating point semantics for [`Quad`]. */
export const QuadS = semantics("QuadS", { BITS: 128, EXP_BITS: 15 });
export type QuadS = typeof QuadS;
/// IEEE binary128 quadruple-precision (128-bit) floating point number.
export type Quad = IeeeFloat<QuadS>;

/** Floating point semantics for [`BFloat`]. */
export const BFloatS = semantics("BFloatS", { BITS: 16, EXP_BITS: 8 });
export type BFloatS = typeof BFloatS;
/// 16-bit brain floating point number.
///
/// This is not an IEEE kind but uses the same semantics.
export type BFloat = IeeeFloat<BFloatS>;

/** Floating point semantics for [`Float8E5M2`]. */
export const Float8E5M2S = semantics("Float8E5M2S", { BITS: 8, EXP_BITS: 5 });
export type Float8E5M2S = typeof Float8E5M2S;
/// 8-bit floating point number with S1E5M2 bit layout.
///
/// Follows IEEE-754 conventions with S1E5M2 bit layout as described in
/// <https://arxiv.org/abs/2209.05433>.
export type Float8E5M2 = IeeeFloat<Float8E5M2S>;

/** Floating point semantics for [`Float8E4M3FN`]. */
export const Float8E4M3FNS = semantics("Float8E4M3FNS", { BITS: 8, EXP_BITS: 4, NONFINITE_BEHAVIOR: NonfiniteBehavior.NanOnly });
export type Float8E4M3FNS = typeof Float8E4M3FNS;
/// 8-bit floating point number with S1E4M3 bit layout.
///
/// This type mostly follows IEEE-754 conventions with a
/// bit layout S1E4M3 as described in <https://arxiv.org/abs/2209.05433>.
/// Unlike IEEE-754 types, there are no infinity values, and NaN is
/// represented with the exponent and mantissa bits set to all 1s.
export type Float8E4M3FN = IeeeFloat<Float8E4M3FNS>;

// FIXME(eddyb) consider moving X87-specific logic to a "has explicit integer bit"
// associated `const` on `Semantics` itself.
/// Floating point semantics for [`X87DoubleExtended`].
///
/// See that type for more details.
export const X87DoubleExtendedS = semantics("X87DoubleExtendedS", {
  BITS: 80,
  EXP_BITS: 15,

  // HACK(eddyb) overwriting `EXP_BITS` because its default is incorrect.
  // FIMXE(eddyb) get rid of this by allowing `Semantics` to generically have
  // the concept of "explicitly included integer bit", which is the main way
  // in which the 80-bit X87 format differs from standard IEEE encodings.
  PRECISION: 64,

  /// For x87 extended precision, we want to make a NaN, not a
  /// pseudo-NaN. Maybe we should expose the ability to make
  /// pseudo-NaNs?
  QNAN_SIGNIFICAND: (PRECISION) => shl(0b11n, PRECISION - 2),

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:379 from_bits
  /// Integer bit is explicit in this format. Intel hardware (387 and later)
  /// does not support these bit patterns:
  ///  exponent = all 1's, integer bit 0, significand 0 ("pseudoinfinity")
  ///  exponent = all 1's, integer bit 0, significand nonzero ("pseudoNaN")
  ///  exponent!=0 nor all 1's, integer bit 0 ("unnormal")
  ///  exponent = 0, integer bit 1 ("pseudodenormal")
  /// At the moment, the first three are treated as NaNs, the last one as Normal.
  from_bits(this: Semantics, bits: bigint): IeeeFloat<Semantics> {
    const Self = this;
    const sign = bits & shl(1n, Self.BITS - 1);
    const exponent = shr(bits & not(sign), Self.BITS - 1 - Self.EXP_BITS) & (shl(1n, Self.EXP_BITS) - 1n);
    const r = new IeeeFloat(
      [bits & (shl(1n, Self.PRECISION) - 1n)],
      // Convert the exponent from its bias representation to a signed integer.
      Number(exponent) + (Self.MIN_EXP - 1),
      Category.Zero,
      sign !== 0n,
      Self,
    );

    const integer_bit = shr(r.sig[0]!, Self.PRECISION - 1);

    let category: Category;
    if (r.exp === Self.MIN_EXP - 1 && r.sig[0] === 0n) {
      category = Category.Zero;
    } else if (r.exp === Self.MAX_EXP + 1 && r.sig[0] === shl(1n, Self.PRECISION - 1)) {
      category = Category.Infinity;
    } else if (
      (r.exp === Self.MAX_EXP + 1 && r.sig[0] !== shl(1n, Self.PRECISION - 1)) ||
      (r.exp !== Self.MAX_EXP + 1 && r.exp !== Self.MIN_EXP - 1 && integer_bit === 0n)
    ) {
      r.exp = Self.MAX_EXP + 1;
      category = Category.NaN;
    } else {
      if (r.exp === Self.MIN_EXP - 1) {
        // Denormal.
        r.exp = Self.MIN_EXP;
      }
      category = Category.Normal;
    }

    r.read_only_category_do_not_mutate = category;

    return r;
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:416 to_bits
  to_bits(this: Semantics, x: IeeeFloat<Semantics>): bigint {
    const Self = this;
    // Get integer bit from significand.
    const integer_bit = sig.get_bit(x.sig, Self.PRECISION - 1);
    let significand = x.sig[0]! & (shl(1n, Self.PRECISION) - 1n);
    let exponent: ExpInt;
    switch (x.category()) {
      case Category.Normal:
        if (x.exp === Self.MIN_EXP && !integer_bit) {
          // Denormal.
          exponent = Self.MIN_EXP - 1;
        } else {
          exponent = x.exp;
        }
        break;
      case Category.Zero:
        // FIXME(eddyb) Maybe we should guarantee an invariant instead?
        significand = 0n;
        exponent = Self.MIN_EXP - 1;
        break;
      case Category.Infinity:
        // FIXME(eddyb) Maybe we should guarantee an invariant instead?
        significand = shl(1n, Self.PRECISION - 1);
        exponent = Self.MAX_EXP + 1;
        break;
      case Category.NaN:
        exponent = Self.MAX_EXP + 1;
        break;
    }

    // Convert the exponent from a signed integer to its bias representation.
    const exponent_ = BigInt.asUintN(128, BigInt(exponent - (Self.MIN_EXP - 1)));

    return shl(x.is_negative() ? 1n : 0n, Self.BITS - 1) | shl(exponent_, Self.PRECISION) | significand;
  },
});
export type X87DoubleExtendedS = typeof X87DoubleExtendedS;
/// 80-bit floating point number that uses IEEE extended precision semantics, as used
/// by x87 `long double`.
export type X87DoubleExtended = IeeeFloat<X87DoubleExtendedS>;

/// A floating point number that uses IEEE semantics.
///
/// Usually you will want to use the available type aliases of this type
/// (e.g., [`Single`], [`Double`]) rather than referencing it directly.
///
/// If `S` implements [`Semantics`], this type will implement [`Float`].
// #[must_use]
export class IeeeFloat<S extends Semantics = Semantics> implements Float<IeeeFloat<S>>, FloatConvert {
  constructor(
    /// Absolute significand value (including the integer bit).
    public sig: Limb[],

    /// The signed unbiased exponent of the value.
    public exp: ExpInt,

    /// What kind of floating point number this is.
    //
    // HACK(eddyb) because mutating this without accounting for `exp`/`sig`
    // can break some subtle edge cases, it should be only read through the
    // `.category()` method, and only set during initialization, either for
    // one of the special value constants, or for conversion from bits.
    public read_only_category_do_not_mutate: Category,

    /// Sign bit of the number.
    //
    // HACK(eddyb) because mutating this without accounting for `category`
    // can break some subtle edge cases, it should be only read through the
    // `.is_negative()` method, and only set through negation (which can be
    // more easily used through e.g. `copy_sign`/`negate_if`/`with_sign`).
    public read_only_sign_do_not_mutate: boolean,

    public marker: S,
  ) {}

  /** PORT: `Self::` */
  Self(): IeeeFloatType<S> {
    return ieee_float_type(this.marker);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:281 clone
  clone(): IeeeFloat<S> {
    return new IeeeFloat([this.sig[0]!], this.exp, this.read_only_category_do_not_mutate, this.read_only_sign_do_not_mutate, this.marker);
  }

  /** `NegExt::negate_if` */
  negate_if(negate: boolean): IeeeFloat<S> {
    return NegExt.negate_if<IeeeFloat<S>>(this, negate, (x) => x.neg());
  }
  /** `NegExt::with_sign` */
  with_sign(sign: boolean): IeeeFloat<S> {
    return NegExt.with_sign<IeeeFloat<S>>(this, sign);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:452 eq
  eq(rhs: IeeeFloat<S>): boolean {
    return this.partial_cmp(rhs) === 0;
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:458 partial_cmp
  partial_cmp(rhs: IeeeFloat<S>): Ordering | undefined {
    const a = this.category();
    const b = rhs.category();
    if (a === Category.NaN || b === Category.NaN) {
      return undefined;
    } else if (a === Category.Infinity && b === Category.Infinity) {
      return cmp_bool(!this.is_negative(), !rhs.is_negative());
    } else if (a === Category.Zero && b === Category.Zero) {
      return 0;
    } else if (a === Category.Infinity || (a === Category.Normal && b === Category.Zero)) {
      return cmp_bool(!this.is_negative(), this.is_negative());
    } else if (b === Category.Infinity || (a === Category.Zero && b === Category.Normal)) {
      return cmp_bool(rhs.is_negative(), !rhs.is_negative());
    } else {
      // (Category::Normal, Category::Normal)
      // Two normal numbers. Do they have the same sign?
      const o = cmp_bool(!this.is_negative(), !rhs.is_negative());
      if (o !== 0) return o;
      // Compare absolute values; invert result if negative.
      const result = this.cmp_abs_normal(rhs);

      if (this.is_negative()) {
        return reverse(result);
      } else {
        return result;
      }
    }
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:493 neg
  neg(): IeeeFloat<S> {
    const self = this.clone();
    self.read_only_sign_do_not_mutate = !self.is_negative();
    return self;
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:526 fmt
  /// Prints this value as a decimal string.
  ///
  /// \param precision The maximum number of digits of
  ///   precision to output. If there are fewer digits available,
  ///   zero padding will not be used unless the value is
  ///   integral and small enough to be expressed in
  ///   precision digits. 0 means to use the natural
  ///   precision of the number.
  /// \param width The maximum number of zeros to
  ///   consider inserting before falling back to scientific
  ///   notation. 0 means to always use scientific notation.
  ///
  /// \param alternate Indicate whether to remove the trailing zero in
  ///   fraction part or not. Also setting this parameter to true forces
  ///   producing of output more similar to default printf behavior.
  ///   Specifically the lower e is used as exponent delimiter and exponent
  ///   always contains no less than two digits.
  ///
  /// Number       precision    width      Result
  /// ------       ---------    -----      ------
  /// 1.01E+4              5        2       10100
  /// 1.01E+4              4        2       1.01E+4
  /// 1.01E+4              5        1       1.01E+4
  /// 1.01E-2              5        2       0.0101
  /// 1.01E-2              4        2       0.0101
  /// 1.01E-2              4        1       1.01E-2
  // PORT: `impl fmt::Display`; returns the written text. `f` carries the formatter's width / precision / `#`.
  fmt(f: FloatFmt = {}): string {
    const S = this.marker;
    let out = "";
    const width = f.width ?? 3;
    const alternate = f.alternate ?? false;

    switch (this.category()) {
      case Category.Infinity:
        if (this.is_negative()) {
          return "-Inf";
        } else {
          return "+Inf";
        }

      case Category.NaN:
        return "NaN";

      case Category.Zero:
        if (this.is_negative()) {
          out += "-";
        }

        if (width === 0) {
          if (alternate) {
            out += "0.0";
            const n = f.precision;
            if (n !== undefined) {
              for (let i = 1; i < n; i++) {
                out += "0";
              }
            }
            out += "e+00";
          } else {
            out += "0.0E+0";
          }
        } else {
          out += "0";
        }
        return out;

      case Category.Normal:
        break;
    }

    if (this.is_negative()) {
      out += "-";
    }

    // We use enough digits so the number can be round-tripped back to an
    // APFloat. The formula comes from "How to Print Floating-Point Numbers
    // Accurately" by Steele and White.
    // FIXME: Using a formula based purely on the precision is conservative;
    // we can print fewer digits depending on the actual value being printed.

    // precision = 2 + floor(S::PRECISION / lg_2(10))
    const precision = f.precision ?? 2 + Math.floor((S.PRECISION * 59) / 196);

    // Decompose the number into an APInt and an exponent.
    const exp: MutRef<ExpInt> = { value: this.exp - (S.PRECISION - 1) };
    let sig_: DynPrecisionLimbVec = [this.sig[0]!];

    // Ignore trailing binary zeros.
    const trailing_zeros_ = trailing_zeros(sig_[0]!);
    sig.shift_right(sig_, exp, trailing_zeros_);

    // Change the exponent from 2^e to 10^e.
    if (exp.value === 0) {
      // Nothing to do.
    } else if (exp.value > 0) {
      // Just shift left.
      const shift = exp.value;
      resize(sig_, limbs_for_bits(S.PRECISION + shift));
      sig.shift_left(sig_, exp, shift);
    } else {
      // exp < 0
      let texp = -exp.value;

      // We transform this using the identity:
      //   (N)(2^-e) == (N)(5^e)(10^-e)

      // Multiply significand by 5^e.
      //   N * 5^0101 == N * 5^(1*1) * 5^(0*2) * 5^(1*4) * 5^(0*8)
      let sig_scratch: DynPrecisionLimbVec = [];
      let p5: DynPrecisionLimbVec = [];
      let p5_scratch: DynPrecisionLimbVec = [];
      while (texp !== 0) {
        if (p5.length === 0) {
          p5.push(5n);
        } else {
          resize(p5_scratch, p5.length * 2);
          sig.mul(p5_scratch, { value: 0 }, p5, p5, p5.length * 2 * LIMB_BITS);
          while (last_is_zero(p5_scratch)) {
            p5_scratch.pop();
          }
          [p5, p5_scratch] = [p5_scratch, p5];
        }
        if ((texp & 1) !== 0) {
          resize(sig_scratch, sig_.length + p5.length);
          sig.mul(sig_scratch, { value: 0 }, sig_, p5, (sig_.length + p5.length) * LIMB_BITS);
          while (last_is_zero(sig_scratch)) {
            sig_scratch.pop();
          }
          [sig_, sig_scratch] = [sig_scratch, sig_];
        }
        texp >>>= 1;
      }
    }

    // Fill the buffer.
    const buffer: number[] = [];

    // Ignore digits from the significand until it is no more
    // precise than is required for the desired precision.
    // 196/59 is a very slight overestimate of lg_2(10).
    const required = Math.floor((precision * 196 + 58) / 59);
    let discard_digits = Math.floor((sat_sub_usize(sig.omsb(sig_), required) * 59) / 196);
    let in_trail = true;
    // PORT: upstream divides the limbs by 10 in place, 32-bit chunk by 32-bit chunk (`sig::each_chunk`), pops the
    // zero top limbs and stops when none is left. The successive remainders are the decimal digits of the
    // significand from the least significant one, so they are read off its decimal string instead (one O(n log n)
    // conversion instead of O(digits x limbs) closure calls; f128 extremes have ~11k digits).
    let sig_n = 0n;
    for (let i = sig_.length - 1; i >= 0; i--) sig_n = (sig_n << 128n) | sig_[i]!;
    const decimal = sig_n === 0n ? "" : sig_n.toString();
    for (let di = decimal.length - 1; di >= 0; di--) {
      // Perform short division by 10 to extract the rightmost digit.
      // rem <- sig % 10
      // sig <- sig / 10
      const rem = decimal.charCodeAt(di) - 0x30;

      const digit = rem;

      // Ignore digits we don't need.
      if (discard_digits > 0) {
        discard_digits -= 1;
        exp.value += 1;
        continue;
      }

      // Drop trailing zeros.
      if (in_trail && digit === 0) {
        exp.value += 1;
      } else {
        in_trail = false;
        buffer.push(0x30 + digit);
      }
    }

    assert(buffer.length !== 0, "no characters in buffer!");

    // Drop down to precision.
    // FIXME: don't do more precise calculations above than are required.
    if (buffer.length > precision) {
      // The most significant figures are the last ones in the buffer.
      let first_sig = buffer.length - precision;

      // Round.
      // FIXME: this probably shouldn't use 'round half up'.

      // Rounding down is just a truncation, except we also want to drop
      // trailing zeros from the new result.
      if (buffer[first_sig - 1]! < 0x35) {
        while (first_sig < buffer.length && buffer[first_sig] === 0x30) {
          first_sig += 1;
        }
      } else {
        // Rounding up requires a decimal add-with-carry. If we continue
        // the carry, the newly-introduced zeros will just be truncated.
        for (let i = first_sig; i < buffer.length; i++) {
          if (buffer[i] === 0x39) {
            first_sig += 1;
          } else {
            buffer[i]! += 1;
            break;
          }
        }
      }

      exp.value += first_sig;
      buffer.splice(0, first_sig);

      // If we carried through, we have exactly one digit of precision.
      if (buffer.length === 0) {
        buffer.push(0x31);
      }
    }

    const digits = buffer.length;
    const ch = (d: number) => String.fromCharCode(d);

    // Check whether we should use scientific notation.
    let scientific: boolean;
    if (width === 0) {
      scientific = true;
    } else {
      if (exp.value >= 0) {
        // 765e3 --> 765000
        //              ^^^
        // But we shouldn't make the number look more precise than it is.
        scientific = exp.value > width || digits + exp.value > precision;
      } else {
        // Power of the most significant digit.
        const msd = exp.value + (digits - 1);
        if (msd >= 0) {
          // 765e-2 == 7.65
          scientific = false;
        } else {
          // 765e-5 == 0.00765
          //           ^ ^^
          scientific = -msd > width;
        }
      }
    }

    // Scientific formatting is pretty straightforward.
    if (scientific) {
      exp.value += digits - 1;

      out += ch(buffer[digits - 1]!);
      out += ".";
      const truncate_zero = !alternate;
      if (digits === 1 && truncate_zero) {
        out += "0";
      } else {
        for (let i = digits - 2; i >= 0; i--) {
          out += ch(buffer[i]!);
        }
      }
      // Fill with zeros up to precision.
      if (!truncate_zero && precision > digits - 1) {
        for (let i = 0; i < precision - digits + 1; i++) {
          out += "0";
        }
      }
      // For alternate we use lower 'e'.
      out += alternate ? "e" : "E";

      // Exponent always at least two digits if we do not truncate zeros.
      const sign = exp.value < 0 ? "-" : "+";
      const abs = String(Math.abs(exp.value));
      if (truncate_zero) {
        out += sign + abs; // write!(f, "{:+}", exp)
      } else {
        out += sign + abs.padStart(2, "0"); // write!(f, "{:+03}", exp)
      }

      return out;
    }

    // Non-scientific, positive exponents.
    if (exp.value >= 0) {
      for (let i = digits - 1; i >= 0; i--) {
        out += ch(buffer[i]!);
      }
      for (let i = 0; i < exp.value; i++) {
        out += "0";
      }
      return out;
    }

    // Non-scientific, negative exponents.
    const unit_place = -exp.value;
    if (unit_place < digits) {
      for (let i = digits - 1; i >= unit_place; i--) {
        out += ch(buffer[i]!);
      }
      out += ".";
      for (let i = unit_place - 1; i >= 0; i--) {
        out += ch(buffer[i]!);
      }
    } else {
      out += "0.";
      for (let i = digits; i < unit_place; i++) {
        out += "0";
      }
      for (let i = digits - 1; i >= 0; i--) {
        out += ch(buffer[i]!);
      }
    }

    return out;
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:810 fmt
  /** `impl fmt::Debug` */
  debug_fmt(): string {
    return `${this.fmt()}(${this.category()} | ${this.is_negative() ? "-" : "+"}[${this.sig[0]}] * 2^${this.exp})`;
  }

  // HACK(eddyb) allow `Self::qnan` to be used from `IeeeFloat::NAN`.
  // FIXME(eddyb) move back to the trait impl when that can be `const fn`.
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:885 qnan
  // PORT: the inherent `const fn qnan` (the trait's `qnan` is `IeeeFloatType.qnan`).
  static qnan_const<S extends Semantics>(S: S, payload: bigint | undefined): IeeeFloat<S> {
    const sig = [
      S.NAN_SIGNIFICAND_BASE |
        S.QNAN_SIGNIFICAND |
        // Zero out the excess bits of the significand.
        (payload !== undefined ? payload & S.NAN_PAYLOAD_MASK : 0n),
    ];

    let exp: ExpInt;
    switch (S.NONFINITE_BEHAVIOR) {
      case NonfiniteBehavior.IEEE754:
        exp = S.MAX_EXP + 1;
        break;
      case NonfiniteBehavior.NanOnly:
        exp = S.MAX_EXP;
        break;
    }

    return new IeeeFloat(sig, exp, Category.NaN, false, S);
  }

  // impl<S: Semantics> Float for IeeeFloat<S>
  // (the associated consts and the fns without `self` are on `IeeeFloatType`)

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1009 add_r
  add_r(rhs: IeeeFloat<S>, round: Round): StatusAnd<IeeeFloat<S>> {
    const Self = this.Self();
    let self: IeeeFloat<S> = this;
    let status: Status;
    const a = self.category();
    const b = rhs.category();
    if (a === Category.NaN || b === Category.NaN) {
      return IeeeDefaultExceptionHandling.binop_result_from_either_nan(self, rhs);
    } else if (a === Category.Infinity && b === Category.Infinity) {
      // Differently signed infinities can only be validly
      // subtracted.
      if (self.is_negative() !== rhs.is_negative()) {
        self = Self.NAN;
        status = Status.INVALID_OP;
      } else {
        status = Status.OK;
      }
    } else if (b === Category.Zero || (a === Category.Infinity && b === Category.Normal)) {
      // Sign may depend on rounding mode; handled below.
      status = Status.OK;
    } else if (a === Category.Zero || b === Category.Infinity) {
      self = rhs;
      status = Status.OK;
    } else {
      // (Category::Normal, Category::Normal)
      self = self.clone();
      const sign = { value: self.is_negative() };
      const exp = { value: self.exp };
      const loss = sig.add_or_sub(self.sig, exp, sign, [rhs.sig[0]!], rhs.exp, rhs.is_negative());
      self.exp = exp.value;
      self = self.with_sign(sign.value);

      const r = self.normalize(round, loss);
      status = r.status;
      self = r.value;

      // Can only be zero if we lost no fraction.
      assert(self.category() !== Category.Zero || loss === Loss.ExactlyZero);
    }

    // If two numbers add (exactly) to zero, IEEE 754 decrees it is a
    // positive zero unless rounding to minus infinity, except that
    // adding two like-signed zeroes gives that zero.
    if (self.category() === Category.Zero && (rhs.category() !== Category.Zero || self.is_negative() !== rhs.is_negative())) {
      self = self.with_sign(round === Round.TowardNegative);
    }

    return Status.and(status, self);
  }

  // NOTE(eddyb) we can't rely on the `sub_r` method default implementation
  // because NaN handling needs the original `rhs` (i.e. without negation).
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1070 sub_r
  sub_r(rhs: IeeeFloat<S>, round: Round): StatusAnd<IeeeFloat<S>> {
    if (this.category() === Category.NaN || rhs.category() === Category.NaN) {
      return IeeeDefaultExceptionHandling.binop_result_from_either_nan(this, rhs);
    } else {
      return this.add_r(rhs.neg(), round);
    }
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1080 mul_r
  mul_r(rhs: IeeeFloat<S>, round: Round): StatusAnd<IeeeFloat<S>> {
    const Self = this.Self();
    const S = this.marker;
    let self = this.negate_if(rhs.is_negative());

    const a = self.category();
    const b = rhs.category();
    if (a === Category.NaN || b === Category.NaN) {
      self = self.negate_if(rhs.is_negative()); // restore the original sign

      return IeeeDefaultExceptionHandling.binop_result_from_either_nan(self, rhs);
    } else if ((a === Category.Zero && b === Category.Infinity) || (a === Category.Infinity && b === Category.Zero)) {
      return Status.and(Status.INVALID_OP, Self.NAN);
    } else if (a === Category.Infinity || b === Category.Infinity) {
      return Status.and(Status.OK, Self.INFINITY.copy_sign(self));
    } else if (a === Category.Zero || b === Category.Zero) {
      return Status.and(Status.OK, Self.ZERO.copy_sign(self));
    } else {
      // (Category::Normal, Category::Normal)
      self = self.clone();
      self.exp += rhs.exp;
      const wide_sig = [0n, 0n];
      const exp = { value: self.exp };
      const loss = sig.mul(wide_sig, exp, self.sig, rhs.sig, S.PRECISION);
      self.exp = exp.value;
      self.sig = [wide_sig[0]!];
      const r = self.normalize(round, loss);
      let status = r.status;
      self = r.value;
      if (loss !== Loss.ExactlyZero) {
        status = (status | Status.INEXACT) as Status;
      }
      return Status.and(status, self);
    }
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1113 mul_add_r
  mul_add_r(multiplicand: IeeeFloat<S>, addend: IeeeFloat<S>, round: Round): StatusAnd<IeeeFloat<S>> {
    const S = this.marker;
    let self: IeeeFloat<S> = this;
    // If and only if all arguments are normal do we need to do an
    // extended-precision calculation.
    if (!self.is_finite_non_zero() || !multiplicand.is_finite_non_zero() || !addend.is_finite()) {
      let status: Status;
      if (self.is_finite_non_zero() && multiplicand.is_finite_non_zero()) {
        // HACK(eddyb) this corresponds to the case where the C++ code
        // (`multiplySpecials`) is effectively a noop: no multiplication
        // is actually performed, because we're really only here to handle
        // the "infinite/NaN `addend`" special-case, which needs to ignore
        // the "finite * finite" multiplication entirely, instead of letting
        // it e.g. overflow into infinity (and trample over `addend`).
        assert(!addend.is_finite());
        status = Status.OK;
      } else {
        const r = self.mul_r(multiplicand, round);
        status = r.status;
        self = r.value;
      }

      // FS can only be Status::OK or Status::INVALID_OP. There is no more work
      // to do in the latter case. The IEEE-754R standard says it is
      // implementation-defined in this case whether, if ADDEND is a
      // quiet NaN, we raise invalid op; this implementation does so.
      //
      // If we need to do the addition we can do so with normal
      // precision.
      if (status === Status.OK) {
        const r = self.add_r(addend, round);
        status = r.status;
        self = r.value;
      }
      return Status.and(status, self);
    }

    // Post-multiplication sign, before addition.
    self = self.negate_if(multiplicand.is_negative()).clone();

    // Allocate space for twice as many bits as the original significand, plus one
    // extra bit for the addition to overflow into.
    assert(limbs_for_bits(S.PRECISION * 2 + 1) <= 2);
    const wide_sig = sig.widening_mul(self.sig[0]!, multiplicand.sig[0]!);

    let loss: Loss = Loss.ExactlyZero;
    let omsb = sig.omsb(wide_sig);
    self.exp += multiplicand.exp;

    // Assume the operands involved in the multiplication are single-precision
    // FP, and the two multiplicants are:
    //     lhs = a23 . a22 ... a0 * 2^e1
    //     rhs = b23 . b22 ... b0 * 2^e2
    // the result of multiplication is:
    //     lhs = c48 c47 c46 . c45 ... c0 * 2^(e1+e2)
    // Note that there are three significant bits at the left-hand side of the
    // radix point: two for the multiplication, and an overflow bit for the
    // addition (that will always be zero at this point). Move the radix point
    // toward left by two bits, and adjust exponent accordingly.
    self.exp += 2;

    if (addend.is_non_zero()) {
      // Normalize our MSB to one below the top bit to allow for overflow.
      const ext_precision = 2 * S.PRECISION + 1;
      if (omsb !== ext_precision - 1) {
        assert(ext_precision > omsb);
        const exp = { value: self.exp };
        sig.shift_left(wide_sig, exp, ext_precision - 1 - omsb);
        self.exp = exp.value;
      }

      // The intermediate result of the multiplication has "2 * S::PRECISION"
      // signicant bit; adjust the addend to be consistent with mul result.
      const ext_addend_sig = [addend.sig[0]!, 0n];

      // Extend the addend significand to ext_precision - 1. This guarantees
      // that the high bit of the significand is zero (same as wide_sig),
      // so the addition will overflow (if it does overflow at all) into the top bit.
      sig.shift_left(ext_addend_sig, { value: 0 }, ext_precision - 1 - S.PRECISION);

      const sign = { value: self.is_negative() };
      const exp = { value: self.exp };
      loss = sig.add_or_sub(wide_sig, exp, sign, ext_addend_sig, addend.exp + 1, addend.is_negative());
      self.exp = exp.value;
      self = self.with_sign(sign.value).clone();

      omsb = sig.omsb(wide_sig);
    }

    // Convert the result having "2 * S::PRECISION" significant-bits back to the one
    // having "S::PRECISION" significant-bits. First, move the radix point from
    // poision "2*S::PRECISION - 1" to "S::PRECISION - 1". The exponent need to be
    // adjusted by "2*S::PRECISION - 1" - "S::PRECISION - 1" = "S::PRECISION".
    self.exp -= S.PRECISION + 1;

    // In case MSB resides at the left-hand side of radix point, shift the
    // mantissa right by some amount to make sure the MSB reside right before
    // the radix point (i.e. "MSB . rest-significant-bits").
    if (omsb > S.PRECISION) {
      const bits = omsb - S.PRECISION;
      const exp = { value: self.exp };
      loss = Loss.combine(sig.shift_right(wide_sig, exp, bits), loss);
      self.exp = exp.value;
    }

    self.sig[0] = wide_sig[0]!;

    const r = self.normalize(round, loss);
    let status = r.status;
    self = r.value;
    if (loss !== Loss.ExactlyZero) {
      status = (status | Status.INEXACT) as Status;
    }

    // If two numbers add (exactly) to zero, IEEE 754 decrees it is a
    // positive zero unless rounding to minus infinity, except that
    // adding two like-signed zeroes gives that zero.
    if (self.category() === Category.Zero && !Status.intersects(status, Status.UNDERFLOW) && self.is_negative() !== addend.is_negative()) {
      self = self.with_sign(round === Round.TowardNegative);
    }

    return Status.and(status, self);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1234 div_r
  div_r(rhs: IeeeFloat<S>, round: Round): StatusAnd<IeeeFloat<S>> {
    const Self = this.Self();
    const S = this.marker;
    let self = this.negate_if(rhs.is_negative());

    const a = self.category();
    const b = rhs.category();
    if (a === Category.NaN || b === Category.NaN) {
      self = self.negate_if(rhs.is_negative()); // restore the original sign

      return IeeeDefaultExceptionHandling.binop_result_from_either_nan(self, rhs);
    } else if ((a === Category.Infinity && b === Category.Infinity) || (a === Category.Zero && b === Category.Zero)) {
      return Status.and(Status.INVALID_OP, Self.NAN);
    } else if (a === Category.Infinity || a === Category.Zero) {
      return Status.and(Status.OK, self);
    } else if (b === Category.Infinity) {
      return Status.and(Status.OK, Self.ZERO.copy_sign(self));
    } else if (b === Category.Zero) {
      return Status.and(Status.DIV_BY_ZERO, Self.INFINITY.copy_sign(self));
    } else {
      // (Category::Normal, Category::Normal)
      self = self.clone();
      self.exp -= rhs.exp;
      const dividend = self.sig[0]!;
      const exp = { value: self.exp };
      const loss = sig.div(self.sig, exp, [dividend], [rhs.sig[0]!], S.PRECISION);
      self.exp = exp.value;
      const r = self.normalize(round, loss);
      let status = r.status;
      self = r.value;
      if (loss !== Loss.ExactlyZero) {
        status = (status | Status.INEXACT) as Status;
      }
      return Status.and(status, self);
    }
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1268 ieee_rem
  ieee_rem(rhs: IeeeFloat<S>): StatusAnd<IeeeFloat<S>> {
    const Self = this.Self();
    const a = this.category();
    const b = rhs.category();
    if (a === Category.NaN || b === Category.NaN) {
      return IeeeDefaultExceptionHandling.binop_result_from_either_nan(this, rhs);
    } else if (a === Category.Infinity || b === Category.Zero) {
      return Status.and(Status.INVALID_OP, Self.NAN);
    } else if (a === Category.Zero || b === Category.Infinity) {
      return Status.and(Status.OK, this);
    }
    // (Category::Normal, Category::Normal)
    let status: Status;

    let x: IeeeFloat<S> = this;
    let p = rhs;

    // Make sure the current value is less than twice the denom. If the addition
    // did not succeed (an overflow has happened), which means that the finite
    // value we currently posses must be less than twice the denom (as we are
    // using the same semantics).
    const p2_ = p.add(p);
    status = p2_.status;
    const p2 = p2_.value;
    if (status === Status.OK) {
      const r = x.c_fmod(p2);
      status = r.status;
      x = r.value;
      assert(status === Status.OK);
    }

    // Lets work with absolute numbers.
    p = p.abs();
    x = x.abs();

    //
    // To calculate the remainder we use the following scheme.
    //
    // The remainder is defained as follows:
    //
    // remainder = numer - rquot * denom = x - r * p
    //
    // Where r is the result of: x/p, rounded toward the nearest integral value
    // (with halfway cases rounded toward the even number).
    //
    // Currently, (after x mod 2p):
    // r is the number of 2p's present inside x, which is inherently, an even
    // number of p's.
    //
    // We may split the remaining calculation into 4 options:
    // - if x < 0.5p then we round to the nearest number with is 0, and are done.
    // - if x == 0.5p then we round to the nearest even number which is 0, and we
    //   are done as well.
    // - if 0.5p < x < p then we round to nearest number which is 1, and we have
    //   to subtract 1p at least once.
    // - if x >= p then we must subtract p at least once, as x must be a
    //   remainder.
    //
    // By now, we were done, or we added 1 to r, which in turn, now an odd number.
    //
    // We can now split the remaining calculation to the following 3 options:
    // - if x < 0.5p then we round to the nearest number with is 0, and are done.
    // - if x == 0.5p then we round to the nearest even number. As r is odd, we
    //   must round up to the next even number. so we must subtract p once more.
    // - if x > 0.5p (and inherently x < p) then we must round r up to the next
    //   integral, and subtract p once more.
    //

    // Return `x * 2` at no loss of precision (i.e. no overflow).
    //
    // HACK(eddyb) this may seem a bit sketchy because it can return
    // values that `normalize` would've replaced with `overflow_result`
    // (e.g. overflowing to infinity), but the result is only used for
    // comparisons, where both sides of such comparison can be seen
    // as transiently having a larger *effective* exponent range.
    const lossless_2x = (x: IeeeFloat<S>): IeeeFloat<S> => {
      x = x.clone();
      x.exp += 1;

      if (x.exp >= Self.MAX_EXP) {
        // HACK(eddyb) skip lossy `normalize` (see above).
      } else {
        const r = x.normalize(Round.NearestTiesToEven, Loss.ExactlyZero);
        x = r.value;
        assert(r.status === Status.OK);
      }

      return x;
    };

    if (lossless_2x(x).partial_cmp(p) === 1) {
      let r = x.sub(p);
      x = r.value;
      assert(r.status === Status.OK);

      const c = lossless_2x(x).partial_cmp(p);
      if (c === 1 || c === 0) {
        r = x.sub(p);
        x = r.value;
        assert(r.status === Status.OK);
      }
    }

    if (x.is_zero()) {
      return Status.and(Status.OK, x.copy_sign(this)); // IEEE754 requires this
    } else {
      return Status.and(Status.OK, x.negate_if(this.is_negative()));
    }
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1371 c_fmod
  c_fmod(rhs: IeeeFloat<S>): StatusAnd<IeeeFloat<S>> {
    const Self = this.Self();
    let self: IeeeFloat<S> = this;
    const a = self.category();
    const b = rhs.category();
    if (a === Category.NaN || b === Category.NaN) {
      return IeeeDefaultExceptionHandling.binop_result_from_either_nan(self, rhs);
    } else if (a === Category.Infinity || b === Category.Zero) {
      return Status.and(Status.INVALID_OP, Self.NAN);
    } else if (a === Category.Zero || b === Category.Infinity) {
      return Status.and(Status.OK, self);
    }
    // (Category::Normal, Category::Normal)
    const orig = self;

    while (self.is_finite_non_zero() && rhs.is_finite_non_zero() && self.cmp_abs_normal(rhs) !== -1) {
      const exp = self.ilogb() - rhs.ilogb();
      let v = rhs.scalbn(exp);
      // `v` can overflow to NaN with `NonfiniteBehavior::NanOnly`, so explicitly
      // check for it.
      if (v.is_nan() || self.cmp_abs_normal(v) === -1) {
        v = rhs.scalbn(exp - 1);
      }
      v = v.copy_sign(self);

      const r = self.sub(v);
      self = r.value;
      assert(r.status === Status.OK);
    }
    if (self.is_zero()) {
      self = self.copy_sign(orig);
    }
    return Status.and(Status.OK, self);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1409 round_to_integral
  round_to_integral(round: Round): StatusAnd<IeeeFloat<S>> {
    const Self = this.Self();
    const S = this.marker;
    switch (this.category()) {
      case Category.NaN:
        return IeeeDefaultExceptionHandling.result_from_nan(this);

      // [IEEE Std 754-2008 6.1]:
      // The behavior of infinity in floating-point arithmetic is derived from the
      // limiting cases of real arithmetic with operands of arbitrarily
      // large magnitude, when such a limit exists.
      // ...
      // Operations on infinite operands are usually exact and therefore signal no
      // exceptions ...
      case Category.Infinity:
        return Status.and(Status.OK, this);

      // [IEEE Std 754-2008 6.3]:
      // ... the sign of the result of conversions, the quantize operation, the
      // roundToIntegral operations, and the roundToIntegralExact(see 5.3.1) is
      // the sign of the first or only operand.
      case Category.Zero:
        return Status.and(Status.OK, this);

      case Category.Normal: {
        // If the exponent is large enough, we know that this value is already
        // integral, and the arithmetic below would potentially cause it to saturate
        // to +/-Inf. Bail out early instead.
        if (this.exp + 1 >= S.PRECISION) {
          return Status.and(Status.OK, this);
        }

        // The algorithm here is quite simple: we add 2^(p-1), where p is the
        // precision of our format, and then subtract it back off again. The choice
        // of rounding modes for the addition/subtraction determines the rounding mode
        // for our integral rounding as well.
        // NOTE: When the input value is negative, we do subtraction followed by
        // addition instead.
        assert(S.PRECISION <= 128);
        const m = Self.from_u128(shl(1n, S.PRECISION - 1));
        let status = m.status;
        assert(status === Status.OK);
        const magic_const = m.value.copy_sign(this);

        let r: IeeeFloat<S> = this;
        const a = r.add_r(magic_const, round);
        status = a.status;
        r = a.value;

        // Current value and 'MagicConstant' are both integers, so the result of the
        // subtraction is always exact according to Sterbenz' lemma.
        r = r.sub_r(magic_const, round).value;

        // Restore the input sign to handle the case of zero result
        // correctly.
        return Status.and(status, r.copy_sign(this));
      }
    }
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1462 next_up
  next_up(): StatusAnd<IeeeFloat<S>> {
    const Self = this.Self();
    const S = this.marker;
    // Compute nextUp(x), handling each float category separately.
    switch (this.category()) {
      case Category.Infinity:
        if (this.is_negative()) {
          // nextUp(-inf) = -largest
          return Status.and(Status.OK, Self.largest().neg());
        } else {
          // nextUp(+inf) = +inf
          return Status.and(Status.OK, this);
        }
      case Category.NaN:
        // IEEE-754R 2008 6.2 Par 2: nextUp(sNaN) = qNaN. Set Invalid flag.
        // IEEE-754R 2008 6.2: nextUp(qNaN) = qNaN. Must be identity so we do not
        //                     change the payload.
        if (this.is_signaling()) {
          // For consistency, propagate the sign of the sNaN to the qNaN.
          return Status.and(Status.INVALID_OP, Self.NAN.copy_sign(this));
        } else {
          return Status.and(Status.OK, this);
        }
      case Category.Zero:
        // nextUp(pm 0) = +smallest
        return Status.and(Status.OK, Self.SMALLEST);
      case Category.Normal: {
        // nextUp(-smallest) = -0
        if (this.is_smallest() && this.is_negative()) {
          return Status.and(Status.OK, Self.ZERO.neg());
        }

        // nextUp(largest) == INFINITY
        if (this.is_largest() && !this.is_negative()) {
          return Status.and(Status.OK, Self.INFINITY);
        }

        const self = this.clone();

        // Excluding the integral bit. This allows us to test for binade boundaries.
        const sig_mask = shl(1n, S.PRECISION - 1) - 1n;

        // nextUp(normal) == normal + inc.
        if (self.is_negative()) {
          // If we are negative, we need to decrement the significand.

          // We only cross a binade boundary that requires adjusting the exponent
          // if:
          //   1. exponent != S::MIN_EXP. This implies we are not in the
          //   smallest binade or are dealing with denormals.
          //   2. Our significand excluding the integral bit is all zeros.
          const crossing_binade_boundary = self.exp !== S.MIN_EXP && (self.sig[0]! & sig_mask) === 0n;

          // Decrement the significand.
          //
          // We always do this since:
          //   1. If we are dealing with a non-binade decrement, by definition we
          //   just decrement the significand.
          //   2. If we are dealing with a normal -> normal binade decrement, since
          //   we have an explicit integral bit the fact that all bits but the
          //   integral bit are zero implies that subtracting one will yield a
          //   significand with 0 integral bit and 1 in all other spots. Thus we
          //   must just adjust the exponent and set the integral bit to 1.
          //   3. If we are dealing with a normal -> denormal binade decrement,
          //   since we set the integral bit to 0 when we represent denormals, we
          //   just decrement the significand.
          sig.decrement(self.sig);

          if (crossing_binade_boundary) {
            // Our result is a normal number. Do the following:
            // 1. Set the integral bit to 1.
            // 2. Decrement the exponent.
            sig.set_bit(self.sig, S.PRECISION - 1);
            self.exp -= 1;
          }
        } else {
          // If we are positive, we need to increment the significand.

          // We only cross a binade boundary that requires adjusting the exponent if
          // the input is not a denormal and all of said input's significand bits
          // are set. If all of said conditions are true: clear the significand, set
          // the integral bit to 1, and increment the exponent. If we have a
          // denormal always increment since moving denormals and the numbers in the
          // smallest normal binade have the same exponent in our representation.
          const crossing_binade_boundary = !self.is_denormal() && (self.sig[0]! & sig_mask) === sig_mask;

          if (crossing_binade_boundary) {
            self.sig = [0n];
            sig.set_bit(self.sig, S.PRECISION - 1);
            assert(
              self.exp !== S.MAX_EXP,
              "We can not increment an exponent beyond the MAX_EXP allowed by the given floating point semantics.",
            );
            self.exp += 1;
          } else {
            sig.increment(self.sig);
          }
        }
        return Status.and(Status.OK, self);
      }
    }
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1672 to_bits
  to_bits(): bigint {
    // Dispatch to semantics.
    return this.marker.to_bits(this);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1677 to_u128_r
  to_u128_r(width: number, round: Round, is_exact: MutRef<boolean>): StatusAnd<bigint> {
    const S = this.marker;
    // The result of trying to convert a number too large.
    let overflow: bigint;
    if (this.is_negative()) {
      // Negative numbers cannot be represented as unsigned.
      overflow = 0n;
    } else {
      // Largest unsigned integer of the given width.
      overflow = shr(MAX, 128 - width);
    }

    is_exact.value = false;

    switch (this.category()) {
      case Category.NaN:
        return Status.and(Status.INVALID_OP, 0n);

      case Category.Infinity:
        return Status.and(Status.INVALID_OP, overflow);

      case Category.Zero:
        // Negative zero can't be represented as an int.
        is_exact.value = !this.is_negative();
        return Status.and(Status.OK, 0n);

      case Category.Normal: {
        let r = 0n;

        // Step 1: place our absolute value, with any fraction truncated, in
        // the destination.
        let truncated_bits: number;
        if (this.exp < 0) {
          // Our absolute value is less than one; truncate everything.
          // For exponent -1 the integer bit represents .5, look at that.
          // For smaller exponents leftmost truncated bit is 0.
          truncated_bits = S.PRECISION - 1 + -this.exp;
        } else {
          // We want the most significant (exponent + 1) bits; the rest are
          // truncated.
          const bits = this.exp + 1;

          // Hopelessly large in magnitude?
          if (bits > width) {
            return Status.and(Status.INVALID_OP, overflow);
          }

          if (bits < S.PRECISION) {
            // We truncate (S::PRECISION - bits) bits.
            r = shr(this.sig[0]!, S.PRECISION - bits);
            truncated_bits = S.PRECISION - bits;
          } else {
            // We want at least as many bits as are available.
            r = shl(this.sig[0]!, bits - S.PRECISION);
            truncated_bits = 0;
          }
        }

        // Step 2: work out any lost fraction, and increment the absolute
        // value if we would round away from zero.
        let loss: Loss = Loss.ExactlyZero;
        if (truncated_bits > 0) {
          loss = Loss.through_truncation(this.sig, truncated_bits);
          if (loss !== Loss.ExactlyZero && this.round_away_from_zero(round, loss, truncated_bits)) {
            r = wrapping_add(r, 1n);
            if (r === 0n) {
              return Status.and(Status.INVALID_OP, overflow); // Overflow.
            }
          }
        }

        // Step 3: check if we fit in the destination.
        if (r > overflow) {
          return Status.and(Status.INVALID_OP, overflow);
        }

        if (loss === Loss.ExactlyZero) {
          is_exact.value = true;
          return Status.and(Status.OK, r);
        } else {
          return Status.and(Status.INEXACT, r);
        }
      }
    }
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1759 cmp_abs_normal
  cmp_abs_normal(rhs: IeeeFloat<S>): Ordering {
    assert(this.is_finite_non_zero());
    assert(rhs.is_finite_non_zero());

    // If exponents are equal, do an unsigned comparison of the significands.
    const o = cmp_num(this.exp, rhs.exp);
    return o !== 0 ? o : sig.cmp(this.sig, rhs.sig);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1767 bitwise_eq
  bitwise_eq(rhs: IeeeFloat<S>): boolean {
    if (this.category() !== rhs.category() || this.is_negative() !== rhs.is_negative()) {
      return false;
    }

    if (this.category() === Category.Zero || this.category() === Category.Infinity) {
      return true;
    }

    if (this.is_finite_non_zero() && this.exp !== rhs.exp) {
      return false;
    }

    return limbs_eq(this.sig, rhs.sig);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1783 is_negative
  is_negative(): boolean {
    return this.read_only_sign_do_not_mutate;
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1787 is_denormal
  is_denormal(): boolean {
    const S = this.marker;
    return this.is_finite_non_zero() && this.exp === S.MIN_EXP && !sig.get_bit(this.sig, S.PRECISION - 1);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1791 is_signaling
  is_signaling(): boolean {
    const S = this.marker;
    // IEEE-754R 2008 6.2.1: A signaling NaN bit string should be encoded with the
    // first bit of the trailing significand being 0.
    return this.is_nan() && (this.sig[0]! & S.QNAN_SIGNIFICAND) !== S.QNAN_SIGNIFICAND;
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1797 category
  category(): Category {
    return this.read_only_category_do_not_mutate;
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1801 get_exact_inverse
  get_exact_inverse(): IeeeFloat<S> | undefined {
    const Self = this.Self();
    const S = this.marker;
    // Special floats and denormals have no exact inverse.
    if (!this.is_finite_non_zero()) {
      return undefined;
    }

    // Check that the number is a power of two by making sure that only the
    // integer bit is set in the significand.
    if (!limbs_eq(this.sig, [shl(1n, S.PRECISION - 1)])) {
      return undefined;
    }

    // Get the inverse.
    let reciprocal = Self.from_u128(1n).value;
    const r = reciprocal.div(this);
    const status = r.status;
    reciprocal = r.value;
    if (status !== Status.OK) {
      return undefined;
    }

    // Avoid multiplication with a denormal, it is not safe on all platforms and
    // may be slower than a normal division.
    if (reciprocal.is_denormal()) {
      return undefined;
    }

    assert(reciprocal.is_finite_non_zero());
    assert(limbs_eq(reciprocal.sig, [shl(1n, S.PRECISION - 1)]));

    return reciprocal;
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1833 ilogb
  ilogb(): ExpInt {
    const S = this.marker;
    if (this.is_nan()) {
      return IEK_NAN;
    }
    if (this.is_zero()) {
      return IEK_ZERO;
    }
    if (this.is_infinite()) {
      return IEK_INF;
    }
    if (!this.is_denormal()) {
      return this.exp;
    }

    let self = this.clone();
    const sig_bits = S.PRECISION - 1;
    self.exp += sig_bits;
    self = self.normalize(Round.NearestTiesToEven, Loss.ExactlyZero).value;
    return self.exp - sig_bits;
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1853 scalbn_r
  scalbn_r(exp: ExpInt, round: Round): IeeeFloat<S> {
    const S = this.marker;
    // If exp is wildly out-of-scale, simply adding it to self.exp will
    // overflow; clamp it to a safe range before adding, but ensure that the range
    // is large enough that the clamp does not change the result. The range we
    // need to support is the difference between the largest possible exponent and
    // the normalized exponent of half the smallest denormal.

    const sig_bits = S.PRECISION - 1;
    const max_change = S.MAX_EXP - (S.MIN_EXP - sig_bits) + 1;

    // Clamp to one past the range ends to let normalize handle overflow.
    const exp_change = Math.min(Math.max(exp, -max_change - 1), max_change);
    let self = this.clone();
    self.exp = sat_i32(self.exp + exp_change);
    self = self.normalize(round, Loss.ExactlyZero).value;
    if (self.is_nan()) {
      self = IeeeDefaultExceptionHandling.result_from_nan(self).value;
    }
    return self;
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1873 frexp_r
  frexp_r(exp: MutRef<ExpInt>, round: Round): IeeeFloat<S> {
    let self: IeeeFloat<S> = this;
    exp.value = self.ilogb();

    // Quiet signalling nans.
    if (exp.value === IEK_NAN) {
      self = IeeeDefaultExceptionHandling.result_from_nan(self).value;
      return self;
    }

    if (exp.value === IEK_INF) {
      return self;
    }

    // 1 is added because frexp is defined to return a normalized fraction in
    // +/-[0.5, 1.0), rather than the usual +/-[1.0, 2.0).
    if (exp.value === IEK_ZERO) {
      exp.value = 0;
    } else {
      exp.value += 1;
    }
    return self.scalbn_r(-exp.value, round);
  }

  // impl<S: Semantics, T: Semantics> FloatConvert<IeeeFloat<T>> for IeeeFloat<S>
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1898 convert_r
  convert_r<F extends Float<F>>(T_: FloatType<F>, round: Round, loses_info: MutRef<boolean>): StatusAnd<F> {
    // PORT: only `IeeeFloat` targets (the `FloatConvert<IeeeFloat<T>>` impl).
    if (!(T_ instanceof IeeeFloatType)) {
      return panic("rustc_apfloat: IeeeFloat::convert_r to a non-IeeeFloat type");
    }
    const T = (T_ as IeeeFloatType<Semantics>).S;
    const S = this.marker;
    let self: IeeeFloat<Semantics> = this;
    // FIXME(eddyb) move this into the return result.
    loses_info.value = false;

    // x86 has some unusual NaNs which cannot be represented in any other
    // format; note them here.
    // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1904 is_x87_double_extended
    function is_x87_double_extended(S: Semantics): boolean {
      return S.QNAN_SIGNIFICAND === X87DoubleExtendedS.QNAN_SIGNIFICAND;
    }
    const loses_x87_pseudo_nan =
      is_x87_double_extended(S) &&
      !is_x87_double_extended(T) &&
      self.category() === Category.NaN &&
      (self.sig[0]! & S.QNAN_SIGNIFICAND) !== S.QNAN_SIGNIFICAND;

    // NOTE(eddyb) this is done early because the target semantics may not
    // actually support encoding the distinction between SNaN and QNaN.
    //
    // Convert of sNaN creates qNaN and raises an exception (invalid op).
    // This also guarantees that a sNaN does not become Inf on a truncation
    // that loses all payload bits.
    let status = Status.OK;
    if (self.is_nan()) {
      const r = IeeeDefaultExceptionHandling.result_from_nan(self);
      status = (status | r.status) as Status;
      self = r.value;
    }

    const sig_ = [self.sig[0]!];
    let exp = self.exp;

    // If this is a truncation of a denormal number, and the target semantics
    // has larger exponent range than the source semantics (this can happen
    // when truncating from PowerPC double-double to double format), the
    // right shift could lose result mantissa bits. Adjust exponent instead
    // of performing excessive shift.
    // Also do a similar trick in case shifting denormal would produce zero
    // significand as this case isn't handled correctly by normalize.
    let shift = T.PRECISION - S.PRECISION;
    if (shift < 0 && self.is_finite_non_zero()) {
      const omsb = sig.omsb(sig_);
      let exp_change = omsb - S.PRECISION;
      if (exp + exp_change < T.MIN_EXP) {
        exp_change = T.MIN_EXP - exp;
      }
      if (exp_change < shift) {
        exp_change = shift;
      }
      if (exp_change < 0) {
        shift -= exp_change;
        exp += exp_change;
      } else if (omsb <= -shift) {
        exp_change = omsb + shift - 1; // leave at least one bit set
        shift -= exp_change;
        exp += exp_change;
      }
    }

    // If this is a truncation, perform the shift.
    let loss: Loss = Loss.ExactlyZero;
    if (shift < 0 && (self.is_finite_non_zero() || (self.category() === Category.NaN && S.NAN_PAYLOAD_MASK !== 0n))) {
      loss = sig.shift_right(sig_, { value: 0 }, -shift);
    }

    // If this is an extension, perform the shift.
    if (shift > 0 && (self.is_finite_non_zero() || self.category() === Category.NaN)) {
      sig.shift_left(sig_, { value: 0 }, shift);
    }

    let r: IeeeFloat<Semantics>;
    switch (self.category()) {
      case Category.Normal: {
        const r_ = new IeeeFloat(sig_, exp, self.category(), self.is_negative(), T);
        const n = r_.normalize(round, loss);
        status = (status | n.status) as Status;
        r = n.value;
        break;
      }
      case Category.NaN:
        loses_info.value =
          loss !== Loss.ExactlyZero || loses_x87_pseudo_nan || (S.NAN_PAYLOAD_MASK !== 0n && T.NAN_PAYLOAD_MASK === 0n);

        r = IeeeFloat.qnan_const(T, sig_[0]!).with_sign(self.is_negative());
        break;
      case Category.Infinity:
        r = ieee_float_type(T).INFINITY.with_sign(self.is_negative());
        break;
      case Category.Zero:
        r = ieee_float_type(T).ZERO.with_sign(self.is_negative());
        break;
    }

    // NOTE(eddyb) this catches all cases of e.g. ±Inf turning into NaN,
    // because of `T::NONFINITE_BEHAVIOR` not being `IEEE754`.
    if (
      (self.category() === Category.Infinity || self.category() === Category.Zero) &&
      (r.category() !== self.category() || r.is_negative() !== self.is_negative())
    ) {
      status = (status | Status.INEXACT) as Status;
    }

    loses_info.value ||= Status.difference(status, Status.INVALID_OP) !== Status.OK;

    return Status.and(status, r as unknown as F);
  }

  // impl<S: Semantics> IeeeFloat<S>

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2003 overflow_result
  /// Handle positive overflow. We either return infinity or
  /// the largest finite number. For negative overflow,
  /// negate the `round` argument before calling.
  static overflow_result<S extends Semantics>(S: S, round: Round): StatusAnd<IeeeFloat<S>> {
    const Self = ieee_float_type(S);
    switch (round) {
      // Infinity?
      case Round.NearestTiesToEven:
      case Round.NearestTiesToAway:
      case Round.TowardPositive:
        return Status.and((Status.OVERFLOW | Status.INEXACT) as Status, Self.INFINITY);
      // Otherwise we become the largest finite number.
      case Round.TowardNegative:
      case Round.TowardZero:
        return Status.and(Status.INEXACT, Self.largest());
    }
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2019 round_away_from_zero
  /// Returns TRUE if, when truncating the current number, with BIT the
  /// new LSB, with the given lost fraction and rounding mode, the result
  /// would need to be rounded away from zero (i.e., by increasing the
  /// signficand). This routine must work for Category::Zero of both signs, and
  /// Category::Normal numbers.
  round_away_from_zero(round: Round, loss: Loss, bit: number): boolean {
    // NaNs and infinities should not have lost fractions.
    assert(this.is_finite_non_zero() || this.is_zero());

    // Current callers never pass this so we don't handle it.
    assert(loss !== Loss.ExactlyZero);

    switch (round) {
      case Round.NearestTiesToAway:
        return loss === Loss.ExactlyHalf || loss === Loss.MoreThanHalf;
      case Round.NearestTiesToEven:
        if (loss === Loss.MoreThanHalf) {
          return true;
        }

        // Our zeros don't have a significand to test.
        if (loss === Loss.ExactlyHalf && this.category() !== Category.Zero) {
          return sig.get_bit(this.sig, bit);
        }

        return false;
      case Round.TowardZero:
        return false;
      case Round.TowardPositive:
        return !this.is_negative();
      case Round.TowardNegative:
        return this.is_negative();
    }
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2046 normalize
  normalize(round: Round, loss: Loss): StatusAnd<IeeeFloat<S>> {
    const Self = this.Self();
    const S = this.marker;
    if (!this.is_finite_non_zero()) {
      return Status.and(Status.OK, this);
    }
    let self = this.clone();

    // Before rounding normalize the exponent of Category::Normal numbers.
    let omsb = sig.omsb(self.sig);

    // Only skip this `if` if the value is exactly zero.
    if (omsb > 0 || loss !== Loss.ExactlyZero) {
      // OMSB is numbered from 1. We want to place it in the integer
      // bit numbered PRECISION if possible, with a compensating change in
      // the exponent.
      let final_exp = sat_i32(self.exp + (omsb - S.PRECISION));

      // If the resulting exponent is too high, overflow according to
      // the rounding mode.
      if (final_exp > S.MAX_EXP) {
        const round_ = NegExt.negate_if(round, self.is_negative(), Round.neg);
        const s = self;
        return StatusAnd_.map(IeeeFloat.overflow_result(S, round_), (r) => r.copy_sign(s));
      }

      // Subnormal numbers have exponent MIN_EXP, and their MSB
      // is forced based on that.
      if (final_exp < S.MIN_EXP) {
        final_exp = S.MIN_EXP;
      }

      // Shifting left is easy as we don't lose precision.
      if (final_exp < self.exp) {
        assert(loss === Loss.ExactlyZero);

        const exp_change = self.exp - final_exp;
        const exp = { value: self.exp };
        sig.shift_left(self.sig, exp, exp_change);
        self.exp = exp.value;

        return Status.and(Status.OK, self);
      }

      // Shift right and capture any new lost fraction.
      if (final_exp > self.exp) {
        const exp_change = final_exp - self.exp;
        const exp = { value: self.exp };
        loss = Loss.combine(sig.shift_right(self.sig, exp, exp_change), loss);
        self.exp = exp.value;

        // Keep OMSB up-to-date.
        omsb = sat_sub_usize(omsb, exp_change);
      }
    }

    // NOTE(eddyb) for `NonfiniteBehavior::NanOnly`, the unique `NAN` takes up
    // the largest significand of `MAX_EXP` (which also has normals), though
    // comparing significands needs to ignore the integer bit `NAN` lacks.
    if (
      S.NONFINITE_BEHAVIOR === NonfiniteBehavior.NanOnly &&
      self.exp === Self.NAN.exp &&
      limbs_eq([self.sig[0]! & S.NAN_SIGNIFICAND_BASE], Self.NAN.sig)
    ) {
      const s = self;
      return StatusAnd_.map(IeeeFloat.overflow_result(S, round), (r) => r.copy_sign(s));
    }

    // Now round the number according to round given the lost
    // fraction.

    // As specified in IEEE 754, since we do not trap we do not report
    // underflow for exact results.
    if (loss === Loss.ExactlyZero) {
      // Canonicalize zeros.
      if (omsb === 0) {
        self = Self.ZERO.copy_sign(self);
      }

      return Status.and(Status.OK, self);
    }

    // Increment the significand if we're rounding away from zero.
    if (self.round_away_from_zero(round, loss, 0)) {
      if (omsb === 0) {
        self.exp = S.MIN_EXP;
      }

      // We should never overflow.
      assert(sig.increment(self.sig) === 0n);
      omsb = sig.omsb(self.sig);

      // Did the significand increment overflow?
      if (omsb === S.PRECISION + 1) {
        // Renormalize by incrementing the exponent and shifting our
        // significand right one. However if we already have the
        // maximum exponent we overflow to infinity.
        if (self.exp === S.MAX_EXP) {
          return Status.and((Status.OVERFLOW | Status.INEXACT) as Status, Self.INFINITY.copy_sign(self));
        }

        const exp = { value: self.exp };
        sig.shift_right(self.sig, exp, 1);
        self.exp = exp.value;

        return Status.and(Status.INEXACT, self);
      }

      // NOTE(eddyb) for `NonfiniteBehavior::NanOnly`, the unique `NAN` takes up
      // the largest significand of `MAX_EXP` (which also has normals), though
      // comparing significands needs to ignore the integer bit `NAN` lacks.
      if (
        S.NONFINITE_BEHAVIOR === NonfiniteBehavior.NanOnly &&
        self.exp === Self.NAN.exp &&
        limbs_eq([self.sig[0]! & S.NAN_SIGNIFICAND_BASE], Self.NAN.sig)
      ) {
        const s = self;
        return StatusAnd_.map(IeeeFloat.overflow_result(S, round), (r) => r.copy_sign(s));
      }
    }

    // The normal case - we were and are not denormal, and any
    // significand increment above didn't overflow.
    if (omsb === S.PRECISION) {
      return Status.and(Status.INEXACT, self);
    }

    // We have a non-zero denormal.
    assert(omsb < S.PRECISION);

    // Canonicalize zeros.
    if (omsb === 0) {
      self = Self.ZERO.copy_sign(self);
    }

    // The Category::Zero case is a denormal that underflowed to zero.
    return Status.and((Status.UNDERFLOW | Status.INEXACT) as Status, self);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2171 from_hexadecimal_string
  static from_hexadecimal_string<S extends Semantics>(S: S, s: string, round: Round): Result<StatusAnd<IeeeFloat<S>>, ParseError> {
    const Self = ieee_float_type(S);
    const r = new IeeeFloat([0n], 0, Category.Normal, false, S);

    let any_digits = false;
    let has_exp = false;
    let bit_pos = LIMB_BITS;
    let loss: Loss | undefined = undefined;

    // Without leading or trailing zeros, irrespective of the dot.
    let first_sig_digit: number | undefined = undefined;
    const s_len = str_len(s);
    let dot = s_len;

    for (const [p, c] of char_indices(s)) {
      const hex_value = to_digit(c, 16);
      // Skip leading zeros and any (hexa)decimal point.
      if (c === 0x2e /* '.' */) {
        if (dot !== s_len) {
          return Err(ParseError("String contains multiple dots"));
        }
        dot = p;
      } else if (hex_value !== undefined) {
        any_digits = true;

        if (first_sig_digit === undefined) {
          if (hex_value === 0) {
            continue;
          }
          first_sig_digit = p;
        }

        // Store the number while we have space.
        bit_pos -= 4;
        if (bit_pos >= 0) {
          r.sig[0] = r.sig[0]! | shl(BigInt(hex_value), bit_pos);
        } else {
          // If zero or one-half (the hexadecimal digit 8) are followed
          // by non-zero, they're a little more than zero or one-half.
          if (loss !== undefined) {
            if (hex_value !== 0) {
              if (loss === Loss.ExactlyZero) {
                loss = Loss.LessThanHalf;
              }
              if (loss === Loss.ExactlyHalf) {
                loss = Loss.MoreThanHalf;
              }
            }
          } else {
            if (hex_value === 0) loss = Loss.ExactlyZero;
            else if (hex_value >= 1 && hex_value <= 7) loss = Loss.LessThanHalf;
            else if (hex_value === 8) loss = Loss.ExactlyHalf;
            else if (hex_value >= 9 && hex_value <= 15) loss = Loss.MoreThanHalf;
            else unreachable();
          }
        }
      } else if (c === 0x70 /* 'p' */ || c === 0x50 /* 'P' */) {
        if (!any_digits) {
          return Err(ParseError("Significand has no digits"));
        }

        if (dot === s_len) {
          dot = p;
        }

        // PORT: `s[p + 1..]`: every character before `p` is ASCII here.
        const chars = [...s.slice(p + 1)].map((x) => x.codePointAt(0)!);
        let i = 0;

        // Adjust for the given exponent.
        const exp_minus = chars[i] === 0x2d; /* '-' */
        if (exp_minus || chars[i] === 0x2b /* '+' */) {
          i++;
        }

        for (; i < chars.length; i++) {
          const value = to_digit(chars[i]!, 10);
          if (value !== undefined) {
            has_exp = true;
            r.exp = sat_i32(sat_i32(r.exp * 10) + value);
          } else {
            return Err(ParseError("Invalid character in exponent"));
          }
        }
        if (!has_exp) {
          return Err(ParseError("Exponent has no digits"));
        }

        r.exp = NegExt.negate_if(r.exp, exp_minus, neg_i32);

        break;
      } else {
        return Err(ParseError("Invalid character in significand"));
      }
    }
    if (!any_digits) {
      return Err(ParseError("Significand has no digits"));
    }

    // Hex floats require an exponent but not a hexadecimal point.
    if (!has_exp) {
      return Err(ParseError("Hex strings require an exponent"));
    }

    // Ignore the exponent if we are zero.
    if (first_sig_digit === undefined) {
      return Ok(Status.and(Status.OK, Self.ZERO));
    }

    // Calculate the exponent adjustment implicit in the number of
    // significant digits and adjust for writing the significand starting
    // at the most significant nibble.
    let exp_adjustment: ExpInt;
    if (dot > first_sig_digit) {
      exp_adjustment = checked_i32(dot - first_sig_digit);
    } else {
      exp_adjustment = -checked_i32(first_sig_digit - dot - 1);
    }
    exp_adjustment = sat_i32(sat_i32(sat_i32(sat_i32(exp_adjustment * 4) - 1) + S.PRECISION) - LIMB_BITS);
    r.exp = sat_i32(r.exp + exp_adjustment);

    return Ok(r.normalize(round, loss ?? Loss.ExactlyZero));
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2301 from_decimal_string
  static from_decimal_string<S extends Semantics>(S: S, s: string, round: Round): Result<StatusAnd<IeeeFloat<S>>, ParseError> {
    const Self = ieee_float_type(S);
    // Given a normal decimal floating point number of the form
    //
    //   dddd.dddd[eE][+-]ddd
    //
    // where the decimal point and exponent are optional, fill out the
    // variables below. Exponent is appropriate if the significand is
    // treated as an integer, and normalized_exp if the significand
    // is taken to have the decimal point after a single leading
    // non-zero digit.
    //
    // If the value is zero, first_sig_digit is None.

    let any_digits = false;
    let dec_exp = 0;

    // Without leading or trailing zeros, irrespective of the dot.
    let first_sig_digit: number | undefined = undefined;
    let last_sig_digit = 0;
    const s_len = str_len(s);
    let dot = s_len;

    for (const [p, c] of char_indices(s)) {
      const dec_value = to_digit(c, 10);
      if (c === 0x2e /* '.' */) {
        if (dot !== s_len) {
          return Err(ParseError("String contains multiple dots"));
        }
        dot = p;
      } else if (dec_value !== undefined) {
        any_digits = true;

        if (dec_value !== 0) {
          if (first_sig_digit === undefined) {
            first_sig_digit = p;
          }
          last_sig_digit = p;
        }
      } else if (c === 0x65 /* 'e' */ || c === 0x45 /* 'E' */) {
        if (!any_digits) {
          return Err(ParseError("Significand has no digits"));
        }

        if (dot === s_len) {
          dot = p;
        }

        // PORT: `s[p + 1..]`: every character before `p` is ASCII here.
        const chars = [...s.slice(p + 1)].map((x) => x.codePointAt(0)!);
        let i = 0;

        // Adjust for the given exponent.
        const exp_minus = chars[i] === 0x2d; /* '-' */
        if (exp_minus || chars[i] === 0x2b /* '+' */) {
          i++;
        }

        let any_exp_digits = false;
        for (; i < chars.length; i++) {
          const value = to_digit(chars[i]!, 10);
          if (value !== undefined) {
            any_exp_digits = true;
            dec_exp = sat_i32(sat_i32(dec_exp * 10) + value);
          } else {
            return Err(ParseError("Invalid character in exponent"));
          }
        }
        // Treat no exponent as 0 to match binutils
        if (!any_exp_digits) {
          assert(dec_exp === 0);
        }

        dec_exp = NegExt.negate_if(dec_exp, exp_minus, neg_i32);

        break;
      } else {
        return Err(ParseError("Invalid character in significand"));
      }
    }
    if (!any_digits) {
      return Err(ParseError("Significand has no digits"));
    }

    // Test if we have a zero number allowing for non-zero exponents.
    if (first_sig_digit === undefined) {
      return Ok(Status.and(Status.OK, Self.ZERO));
    }

    // Adjust the exponents for any decimal point.
    if (dot > last_sig_digit) {
      dec_exp = sat_i32(dec_exp + (dot - last_sig_digit - 1));
    } else {
      dec_exp = sat_i32(dec_exp - (last_sig_digit - dot));
    }
    const significand_digits = last_sig_digit - first_sig_digit + 1 - (dot > first_sig_digit && dot < last_sig_digit ? 1 : 0);
    const normalized_exp = sat_i32(dec_exp + (significand_digits - 1));

    // Handle the cases where exponents are obviously too large or too
    // small. Writing L for log 10 / log 2, a number d.ddddd*10^dec_exp
    // definitely overflows if
    //
    //       (dec_exp - 1) * L >= MAX_EXP
    //
    // and definitely underflows to zero where
    //
    //       (dec_exp + 1) * L <= MIN_EXP - PRECISION
    //
    // With integer arithmetic the tightest bounds for L are
    //
    //       93/28 < L < 196/59            [ numerator <= 256 ]
    //       42039/12655 < L < 28738/8651  [ numerator <= 65536 ]

    // Check for MAX_EXP.
    if (sat_i32(sat_i32(normalized_exp - 1) * 42039) >= 12655 * S.MAX_EXP) {
      // Overflow and round.
      return Ok(IeeeFloat.overflow_result(S, round));
    }

    // Check for MIN_EXP.
    if (sat_i32(sat_i32(normalized_exp + 1) * 28738) <= 8651 * (S.MIN_EXP - S.PRECISION)) {
      // Underflow to zero and round.
      const r = round === Round.TowardPositive ? Self.SMALLEST : Self.ZERO;
      return Ok(Status.and((Status.UNDERFLOW | Status.INEXACT) as Status, r));
    }

    // A tight upper bound on number of bits required to hold an
    // N-digit decimal integer is N * 196 / 59. Allocate enough space
    // to hold the full significand, and an extra limb required by
    // tcMultiplyPart.
    // let max_limbs = limbs_for_bits(1 + 196 * significand_digits / 59);
    // PORT: `with_capacity(max_limbs)` is only an allocation hint.
    const dec_sig: DynPrecisionLimbVec = [];

    // Convert to binary efficiently - we do almost all multiplication
    // in a Limb. When this would overflow do we do a single
    // bignum multiplication, and then revert again to multiplication
    // in a Limb.
    // PORT: `s[first_sig_digit..last_sig_digit + 1]`: all ASCII here.
    const chars = s.slice(first_sig_digit, last_sig_digit + 1);
    let ci = 0;
    for (;;) {
      let val = 0n;
      let multiplier = 1n;

      for (;;) {
        if (ci >= chars.length) break;
        const c = chars.charCodeAt(ci++);
        if (c === 0x2e /* '.' */) continue;
        const dec_value = to_digit(c, 10)!;

        multiplier *= 10n;
        val = val * 10n + BigInt(dec_value);

        // The maximum number that can be multiplied by ten with any
        // digit added without overflowing a Limb.
        if (multiplier > (MAX - 9n) / 10n) {
          break;
        }
      }

      // If we've consumed no digits, we're done.
      if (multiplier === 1n) {
        break;
      }

      // Multiply out the current limb.
      let carry = val;
      for (let k = 0; k < dec_sig.length; k++) {
        let [low, high] = sig.widening_mul(dec_sig[k]!, multiplier) as [Limb, Limb];

        // Now add carry.
        const [low2, overflow] = overflowing_add(low, carry);
        low = low2;
        high += overflow ? 1n : 0n;

        dec_sig[k] = low;
        carry = high;
      }

      // If we had carry, we need another limb (likely but not guaranteed).
      if (carry > 0n) {
        dec_sig.push(carry);
      }
    }

    // Calculate pow(5, abs(dec_exp)) into `pow5_full`.
    // The *_calc Vec's are reused scratch space, as an optimization.
    let pow5_full: DynPrecisionLimbVec;
    let pow5_calc: DynPrecisionLimbVec;
    let sig_calc: DynPrecisionLimbVec;
    let sig_scratch_calc: DynPrecisionLimbVec;
    {
      let power = Math.abs(dec_exp);

      const FIRST_EIGHT_POWERS: Limb[] = [1n, 5n, 25n, 125n, 625n, 3125n, 15625n, 78125n];

      let p5_scratch: DynPrecisionLimbVec = [];
      let p5: DynPrecisionLimbVec = [FIRST_EIGHT_POWERS[4]!];

      let r_scratch: DynPrecisionLimbVec = [];
      let r: DynPrecisionLimbVec = [FIRST_EIGHT_POWERS[power & 7]!];
      power >>>= 3;

      while (power > 0) {
        // Calculate pow(5,pow(2,n+3)).
        resize(p5_scratch, p5.length * 2);
        sig.mul(p5_scratch, { value: 0 }, p5, p5, p5.length * 2 * LIMB_BITS);
        while (last_is_zero(p5_scratch)) {
          p5_scratch.pop();
        }
        [p5, p5_scratch] = [p5_scratch, p5];

        if ((power & 1) !== 0) {
          resize(r_scratch, r.length + p5.length);
          sig.mul(r_scratch, { value: 0 }, r, p5, (r.length + p5.length) * LIMB_BITS);
          while (last_is_zero(r_scratch)) {
            r_scratch.pop();
          }
          [r, r_scratch] = [r_scratch, r];
        }

        power >>>= 1;
      }

      [pow5_full, pow5_calc, sig_calc, sig_scratch_calc] = [r, r_scratch, p5, p5_scratch];
    }

    // Attempt dec_sig * 10^dec_exp with increasing precision.
    let attempt = 0;
    for (;;) {
      // PORT: `LIMB_BITS << attempt` is a usize shift (attempt stays small).
      const calc_precision = LIMB_BITS * 2 ** attempt - 1;
      attempt += 1;

      const calc_normal_from_limbs = (sig_: DynPrecisionLimbVec, limbs: readonly Limb[]): StatusAnd<ExpInt> => {
        resize(sig_, limbs_for_bits(calc_precision));
        const [loss0, exp0] = sig.from_limbs(sig_, limbs, calc_precision);
        let loss = loss0;
        const exp = { value: exp0 };

        // Before rounding normalize the exponent of Category::Normal numbers.
        let omsb = sig.omsb(sig_);

        assert(omsb !== 0);

        // OMSB is numbered from 1. We want to place it in the integer
        // bit numbered PRECISION if possible, with a compensating change in
        // the exponent.
        const final_exp = sat_i32(exp.value + (omsb - calc_precision));

        // Shifting left is easy as we don't lose precision.
        if (final_exp < exp.value) {
          assert(loss === Loss.ExactlyZero);

          const exp_change = exp.value - final_exp;
          sig.shift_left(sig_, exp, exp_change);

          return Status.and(Status.OK, exp.value);
        }

        // Shift right and capture any new lost fraction.
        if (final_exp > exp.value) {
          const exp_change = final_exp - exp.value;
          loss = Loss.combine(sig.shift_right(sig_, exp, exp_change), loss);

          // Keep OMSB up-to-date.
          omsb = sat_sub_usize(omsb, exp_change);
        }

        assert(omsb === calc_precision);

        // Now round the number according to round given the lost
        // fraction.

        // As specified in IEEE 754, since we do not trap we do not report
        // underflow for exact results.
        if (loss === Loss.ExactlyZero) {
          return Status.and(Status.OK, exp.value);
        }

        // Increment the significand if we're rounding away from zero.
        if (loss === Loss.MoreThanHalf || (loss === Loss.ExactlyHalf && sig.get_bit(sig_, 0))) {
          // We should never overflow.
          assert(sig.increment(sig_) === 0n);
          omsb = sig.omsb(sig_);

          // Did the significand increment overflow?
          if (omsb === calc_precision + 1) {
            sig.shift_right(sig_, exp, 1);

            return Status.and(Status.INEXACT, exp.value);
          }
        }

        // The normal case - we were and are not denormal, and any
        // significand increment above didn't overflow.
        return Status.and(Status.INEXACT, exp.value);
      };

      const e1 = calc_normal_from_limbs(sig_calc, dec_sig);
      const status = e1.status;
      let exp = e1.value;
      const e2 = calc_normal_from_limbs(pow5_calc, pow5_full);
      const pow5_status = e2.status;
      const pow5_exp = e2.value;

      // Add dec_exp, as 10^n = 5^n * 2^n.
      exp += dec_exp;

      let used_bits = S.PRECISION;
      let truncated_bits = calc_precision - used_bits;

      const half_ulp_err1: Limb = status !== Status.OK ? 1n : 0n;
      let calc_loss: Loss;
      let half_ulp_err2: Limb;
      if (dec_exp >= 0) {
        exp += pow5_exp;

        resize(sig_scratch_calc, sig_calc.length + pow5_calc.length);
        const e = { value: exp };
        calc_loss = sig.mul(sig_scratch_calc, e, sig_calc, pow5_calc, calc_precision);
        exp = e.value;
        [sig_calc, sig_scratch_calc] = [sig_scratch_calc, sig_calc];

        half_ulp_err2 = pow5_status !== Status.OK ? 1n : 0n;
      } else {
        exp -= pow5_exp;

        resize(sig_scratch_calc, sig_calc.length);
        const e = { value: exp };
        calc_loss = sig.div(sig_scratch_calc, e, sig_calc, pow5_calc, calc_precision);
        exp = e.value;
        [sig_calc, sig_scratch_calc] = [sig_scratch_calc, sig_calc];

        // Denormal numbers have less precision.
        if (exp < S.MIN_EXP) {
          truncated_bits += S.MIN_EXP - exp;
          used_bits = sat_sub_usize(calc_precision, truncated_bits);
        }
        // Extra half-ulp lost in reciprocal of exponent.
        half_ulp_err2 = 2n * (pow5_status !== Status.OK || calc_loss !== Loss.ExactlyZero ? 1n : 0n);
      }

      // Both sig::mul and sig::div return the
      // result with the integer bit set.
      assert(sig.get_bit(sig_calc, calc_precision - 1));

      // The error from the true value, in half-ulps, on multiplying two
      // floating point numbers, which differ from the value they
      // approximate by at most half_ulp_err1 and half_ulp_err2 half-ulps, is strictly less
      // than the returned value.
      //
      // See "How to Read Floating Point Numbers Accurately" by William D Clinger.
      assert(half_ulp_err1 < 2n || half_ulp_err2 < 2n || half_ulp_err1 + half_ulp_err2 < 8n);

      const inexact: Limb = calc_loss !== Loss.ExactlyZero ? 1n : 0n;
      let half_ulp_err: Limb;
      if (half_ulp_err1 + half_ulp_err2 === 0n) {
        half_ulp_err = inexact * 2n; // <= inexact half-ulps.
      } else {
        half_ulp_err = inexact + 2n * (half_ulp_err1 + half_ulp_err2);
      }

      let ulps_from_boundary: Limb;
      {
        const bits = calc_precision - used_bits - 1;

        const i = Math.floor(bits / LIMB_BITS);
        const limb = sig_calc[i]! & shr(MAX, LIMB_BITS - 1 - (bits % LIMB_BITS));
        let boundary: Limb;
        switch (round) {
          case Round.NearestTiesToEven:
          case Round.NearestTiesToAway:
            boundary = shl(1n, bits % LIMB_BITS);
            break;
          default:
            boundary = 0n;
        }
        if (i === 0) {
          const delta = wrapping_sub(limb, boundary);
          ulps_from_boundary = limb_min(delta, wrapping_neg(delta));
        } else if (limb === boundary) {
          if (!sig.is_all_zeros(sig_calc.slice(1, i))) {
            ulps_from_boundary = MAX; // A lot.
          } else {
            ulps_from_boundary = sig_calc[0]!;
          }
        } else if (limb === wrapping_sub(boundary, 1n)) {
          if (sig_calc.slice(1, i).some((x) => wrapping_neg(x) !== 1n)) {
            ulps_from_boundary = MAX; // A lot.
          } else {
            ulps_from_boundary = wrapping_neg(sig_calc[0]!);
          }
        } else {
          ulps_from_boundary = MAX; // A lot.
        }
      }

      // Are we guaranteed to round correctly if we truncate?
      if (limb_min(ulps_from_boundary * 2n, MAX) >= half_ulp_err) {
        const r = new IeeeFloat([0n], exp, Category.Normal, false, S);
        sig.extract(r.sig, sig_calc, used_bits, calc_precision - used_bits);
        // If we extracted less bits above we must adjust our exponent
        // to compensate for the implicit right shift.
        r.exp += S.PRECISION - used_bits;
        const loss = Loss.through_truncation(sig_calc, truncated_bits);
        return Ok(r.normalize(round, loss));
      }
    }
  }
}

/** PORT: the `Float` methods `IeeeFloat` does not define itself (provided / `float_common_impls!`). */
type IeeeFloatProvided =
  | Exclude<(typeof FLOAT_PROVIDED_METHODS)[number], "sub_r">
  | (typeof FLOAT_COMMON_METHODS)[number];
export interface IeeeFloat<S extends Semantics = Semantics>
  extends Pick<Float<IeeeFloat<S>>, IeeeFloatProvided>,
    Pick<FloatConvert, "convert"> {}

// float_common_impls!(IeeeFloat<S>);
for (const k of FLOAT_PROVIDED_METHODS) {
  if (!Object.hasOwn(IeeeFloat.prototype, k)) {
    Object.defineProperty(IeeeFloat.prototype, k, { value: Float_provided[k], writable: true, configurable: true });
  }
}
for (const k of FLOAT_COMMON_METHODS) {
  Object.defineProperty(IeeeFloat.prototype, k, { value: float_common_impls[k], writable: true, configurable: true });
}
Object.defineProperty(IeeeFloat.prototype, "convert", { value: FloatConvert_provided.convert, writable: true, configurable: true });

/** `impl fmt::Debug for IeeeFloat<S>` as a `Debug` fn. */
export function debug_IeeeFloat<S extends Semantics>(v: IeeeFloat<S>): string {
  return v.debug_fmt();
}

// HACK(eddyb) this logic is duplicated throughout the original C++ code,
// but it's a bit too long to keep repeating in the Rust port for all ops.
// FIXME(eddyb) find a better name/organization for all of this functionality
// (`IeeeDefaultExceptionHandling` doesn't have a counterpart in the C++ code).
const IeeeDefaultExceptionHandling = {
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:829 result_from_nan
  result_from_nan<S extends Semantics>(r: IeeeFloat<S>): StatusAnd<IeeeFloat<S>> {
    const S = r.marker;
    assert(r.is_nan());

    let status: Status;
    if (r.is_signaling()) {
      // [IEEE Std 754-2008 6.2]:
      // Under default exception handling, any operation signaling an invalid
      // operation exception and for which a floating-point result is to be
      // delivered shall deliver a quiet NaN.
      r = r.clone();
      r.sig[0] =
        r.sig[0]! |
        (S.QNAN_SIGNIFICAND === X87DoubleExtendedS.QNAN_SIGNIFICAND
          ? // HACK(eddyb) remain bug-compatible with the original C++ code
            // which doesn't appear to attempt avoiding creating pseudo-NaNs
            // (see https://github.com/llvm/llvm-project/issues/63938).
            S.QNAN_SIGNIFICAND & S.NAN_PAYLOAD_MASK
          : S.QNAN_SIGNIFICAND);

      // [IEEE Std 754-2008 6.2]:
      // Signaling NaNs shall be reserved operands that, under default exception
      // handling, signal the invalid operation exception(see 7.2) for every
      // general-computational and signaling-computational operation except for
      // the conversions described in 5.12.
      status = Status.INVALID_OP;
    } else {
      // [IEEE Std 754-2008 6.2]:
      // For an operation with quiet NaN inputs, other than maximum and minimum
      // operations, if a floating-point result is to be delivered the result
      // shall be a quiet NaN which should be one of the input NaNs.
      // ...
      // Every general-computational and quiet-computational operation involving
      // one or more input NaNs, none of them signaling, shall signal no
      // exception, except fusedMultiplyAdd might signal the invalid operation
      // exception(see 7.2).
      status = Status.OK;
    }
    return Status.and(status, r);
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:868 binop_result_from_either_nan
  binop_result_from_either_nan<S extends Semantics>(a: IeeeFloat<S>, b: IeeeFloat<S>): StatusAnd<IeeeFloat<S>> {
    let r: IeeeFloat<S>;
    if (a.category() === Category.NaN) {
      r = a;
    } else if (b.category() === Category.NaN) {
      r = b;
    } else {
      unreachable();
    }
    const status_and_r = IeeeDefaultExceptionHandling.result_from_nan(r);
    if (b.is_signaling()) {
      return Status.and((status_and_r.status | Status.INVALID_OP) as Status, status_and_r.value);
    }
    return status_and_r;
  },
};

/**
 * PORT: the static side of `IeeeFloat<S>`: `impl<S: Semantics> Float for IeeeFloat<S>`'s associated consts and
 * fns without `self` (`Self::ZERO`, `Self::from_bits(..)`, ...), plus `Default` / `FromStr`. One per semantics,
 * made by `ieee_float_type(S)`; `S` is the semantics.
 */
export class IeeeFloatType<S extends Semantics = Semantics> implements FloatType<IeeeFloat<S>> {
  readonly BITS: number;
  readonly PRECISION: number;
  readonly MAX_EXP: ExpInt;
  readonly MIN_EXP: ExpInt;
  readonly ZERO: IeeeFloat<S>;
  readonly INFINITY: IeeeFloat<S>;
  readonly NAN: IeeeFloat<S>;
  // We want (in interchange format):
  //   exponent = 0..0
  //   significand = 0..01
  readonly SMALLEST: IeeeFloat<S>;

  constructor(readonly S: S) {
    this.BITS = S.BITS;
    this.PRECISION = S.PRECISION;
    this.MAX_EXP = S.MAX_EXP;
    this.MIN_EXP = S.MIN_EXP;

    this.ZERO = frozen(new IeeeFloat([0n], S.MIN_EXP - 1, Category.Zero, false, S));

    this.NAN = frozen(IeeeFloat.qnan_const(S, undefined));

    switch (S.NONFINITE_BEHAVIOR) {
      case NonfiniteBehavior.IEEE754:
        this.INFINITY = frozen(new IeeeFloat([0n], S.MAX_EXP + 1, Category.Infinity, false, S));
        break;

      // There is no Inf, so make NaN instead.
      case NonfiniteBehavior.NanOnly:
        this.INFINITY = this.NAN;
        break;
    }

    this.SMALLEST = frozen(new IeeeFloat([1n], S.MIN_EXP, Category.Normal, false, S));
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:938 qnan
  qnan(payload: bigint | undefined): IeeeFloat<S> {
    // NOTE(eddyb) this is not a recursive self-call, but rather it calls
    // the `const fn` inherent mehtod (see above).
    return IeeeFloat.qnan_const(this.S, payload);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:944 snan
  snan(payload: bigint | undefined): IeeeFloat<S> {
    const S = this.S;
    const snan = this.qnan(payload);

    // We always have to clear the QNaN bit to make it an SNaN.
    snan.sig[0] = snan.sig[0]! & not(S.QNAN_SIGNIFICAND & S.NAN_PAYLOAD_MASK);

    // If there are no bits set in the payload, we have to set
    // *something* to make it a NaN instead of an infinity;
    // conventionally, this is the next bit down from the QNaN bit.
    if ((snan.sig[0]! & S.NAN_PAYLOAD_MASK) === 0n) {
      snan.sig[0] = snan.sig[0]! | ((S.QNAN_SIGNIFICAND & S.NAN_PAYLOAD_MASK) >> 1n);
    }

    return snan;
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:962 largest
  largest(): IeeeFloat<S> {
    const S = this.S;
    // We want (in interchange format):
    //   exponent = 1..10
    //   significand = 1..1
    return new IeeeFloat(
      [
        (shl(1n, S.PRECISION) - 1n) &
          (S.NONFINITE_BEHAVIOR === NonfiniteBehavior.IEEE754
            ? // The largest number by magnitude in our format will be the floating point
              // number with maximum exponent and with significand that is all ones.
              MAX
            : // The largest number by magnitude in our format will be the floating point
              // number with maximum exponent and with significand that is all ones except
              // the LSB.
              not(1n)),
      ],
      S.MAX_EXP,
      Category.Normal,
      false,
      S,
    );
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:996 smallest_normalized
  smallest_normalized(): IeeeFloat<S> {
    const S = this.S;
    // We want (in interchange format):
    //   exponent = 0..0
    //   significand = 10..0
    return new IeeeFloat([shl(1n, S.PRECISION - 1)], S.MIN_EXP, Category.Normal, false, S);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1566 from_bits
  from_bits(input: bigint): IeeeFloat<S> {
    // Dispatch to semantics.
    return this.S.from_bits(input) as IeeeFloat<S>;
  }

  from_i128_r(input: bigint, round: Round): StatusAnd<IeeeFloat<S>> {
    return Float_provided.from_i128_r(this, input, round);
  }
  from_i128(input: bigint): StatusAnd<IeeeFloat<S>> {
    return Float_provided.from_i128(this, input);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1571 from_u128_r
  from_u128_r(input: bigint, round: Round): StatusAnd<IeeeFloat<S>> {
    const S = this.S;
    return new IeeeFloat([input], S.PRECISION - 1, Category.Normal, false, S).normalize(round, Loss.ExactlyZero);
  }

  from_u128(input: bigint): StatusAnd<IeeeFloat<S>> {
    return Float_provided.from_u128(this, input);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:1582 from_str_r
  from_str_r(s: string, round: Round): Result<StatusAnd<IeeeFloat<S>>, ParseError> {
    const Self = this;
    if (s.length === 0) {
      return Err(ParseError("Invalid string length"));
    }

    // Handle a leading minus sign.
    const minus = s.startsWith("-");
    if (minus) s = s.slice(1);
    const from_abs = (r: IeeeFloat<S>) => r.negate_if(minus);

    // Handle a leading plus sign (mutually exclusive with minus).
    const explicit_plus = !minus && s.startsWith("+");
    if (explicit_plus) s = s.slice(1);

    // Handle special cases.
    let special: IeeeFloat<S> | undefined;
    if (s === "Inf" && (minus || explicit_plus)) {
      special = Self.INFINITY;
    } else if ((s === "inf" || s === "INFINITY") && !explicit_plus) {
      special = Self.INFINITY;
    } else if (!explicit_plus) {
      // If we have a 's' (or 'S') prefix, then this is a Signaling NaN.
      let t = s;
      const is_signaling = t.startsWith("s") || t.startsWith("S");
      if (is_signaling) t = t.slice(1);

      special = ((): IeeeFloat<S> | undefined => {
        let rest: string;
        if (t.startsWith("nan")) rest = t.slice(3);
        else if (t.startsWith("NaN")) rest = t.slice(3);
        else return undefined;

        // Allow the payload to be inside parentheses.
        let u = rest;
        if (u.startsWith("(")) {
          const inner = u.slice(1);
          // Parentheses should be balanced (and not empty).
          if (inner.endsWith(")") && inner.length > 1) {
            u = inner.slice(0, -1);
          }
        }

        let payload: bigint | undefined;
        if (u.length === 0) {
          // A NaN without payload.
          payload = undefined;
        } else {
          // Determine the payload number's radix.
          let radix = 10;
          let v = u;
          if (u.startsWith("0") && u.length > 1) {
            const w = u.slice(1);
            if (w.startsWith("x") || w.startsWith("X")) {
              radix = 16;
              v = w.slice(1);
            } else {
              radix = 8;
              v = w;
            }
          }

          // Parse the payload and make the NaN.
          payload = u128_from_str_radix(v, radix);
          if (payload === undefined) return undefined;
        }

        return is_signaling ? Self.snan(payload) : Self.qnan(payload);
      })();
    } else {
      special = undefined;
    }
    if (special !== undefined) {
      return Ok(Status.and(Status.OK, from_abs(special)));
    }

    if (s.length === 0) {
      return Err(ParseError("String has no digits"));
    }

    // Adjust the rounding mode for the absolute value below.
    round = NegExt.negate_if(round, minus, Round.neg);

    const is_hex = s.startsWith("0x") || s.startsWith("0X");
    if (is_hex) s = s.slice(2);

    let r: Result<StatusAnd<IeeeFloat<S>>, ParseError>;
    if (is_hex) {
      if (s.length === 0) {
        return Err(ParseError("Invalid string"));
      }
      r = IeeeFloat.from_hexadecimal_string(this.S, s, round);
    } else {
      r = IeeeFloat.from_decimal_string(this.S, s, round);
    }
    if (r.$ === "Err") return r;

    return Ok(StatusAnd_.map(r._0, from_abs));
  }

  default(): IeeeFloat<S> {
    return float_common_impls.default(this);
  }
  from_str(s: string): Result<IeeeFloat<S>, ParseError> {
    return float_common_impls.from_str(this, s);
  }
}

/** A shared constant: frozen, so that no method can mutate it in place. */
function frozen<S extends Semantics>(x: IeeeFloat<S>): IeeeFloat<S> {
  Object.freeze(x.sig);
  return Object.freeze(x);
}

const TYPES = new WeakMap<Semantics, IeeeFloatType<Semantics>>();
/** The static side (`IeeeFloat::<S>::..`) of the float type with semantics `S`. */
export function ieee_float_type<S extends Semantics>(S: S): IeeeFloatType<S> {
  let t = TYPES.get(S);
  if (t === undefined) {
    t = new IeeeFloatType<Semantics>(S);
    TYPES.set(S, t);
  }
  return t as IeeeFloatType<S>;
}

/// IEEE binary16 half-precision (16-bit) floating point number.
export const Half = ieee_float_type(HalfS);
/// IEEE binary32 single-precision (32-bit) floating point number.
export const Single = ieee_float_type(SingleS);
/// IEEE binary64 double-precision (64-bit) floating point number.
export const Double = ieee_float_type(DoubleS);
/// IEEE binary128 quadruple-precision (128-bit) floating point number.
export const Quad = ieee_float_type(QuadS);
/// 16-bit brain floating point number.
export const BFloat = ieee_float_type(BFloatS);
/// 8-bit floating point number with S1E5M2 bit layout.
export const Float8E5M2 = ieee_float_type(Float8E5M2S);
/// 8-bit floating point number with S1E4M3 bit layout.
export const Float8E4M3FN = ieee_float_type(Float8E4M3FNS);
/// 80-bit floating point number that uses IEEE extended precision semantics, as used
/// by x87 `long double`.
export const X87DoubleExtended = ieee_float_type(X87DoubleExtendedS);

export const Loss = {
  ExactlyZero: "ExactlyZero",
  LessThanHalf: "LessThanHalf",
  ExactlyHalf: "ExactlyHalf",
  MoreThanHalf: "MoreThanHalf",

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2701 combine
  /// Combine the effect of two lost fractions.
  combine(self: Loss, less_significant: Loss): Loss {
    let more_significant = self;
    if (less_significant !== Loss.ExactlyZero) {
      if (more_significant === Loss.ExactlyZero) {
        more_significant = Loss.LessThanHalf;
      } else if (more_significant === Loss.ExactlyHalf) {
        more_significant = Loss.MoreThanHalf;
      }
    }

    return more_significant;
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2717 through_truncation
  /// Return the fraction lost were a bignum truncated losing the least
  /// significant `bits` bits.
  through_truncation(limbs: readonly Limb[], bits: number): Loss {
    if (bits === 0) {
      return Loss.ExactlyZero;
    }

    const half_bit = bits - 1;
    const half_limb_i = Math.floor(half_bit / LIMB_BITS);
    let half_limb: Limb;
    let rest: readonly Limb[];
    if (half_limb_i < limbs.length) {
      half_limb = limbs[half_limb_i]!;
      rest = limbs.slice(0, half_limb_i);
    } else {
      half_limb = 0n;
      rest = limbs;
    }
    const half = shl(1n, half_bit % LIMB_BITS);
    const has_half = (half_limb & half) !== 0n;
    const has_rest = (half_limb & (half - 1n)) !== 0n || !sig.is_all_zeros(rest);

    if (!has_half && !has_rest) return Loss.ExactlyZero;
    if (!has_half && has_rest) return Loss.LessThanHalf;
    if (has_half && !has_rest) return Loss.ExactlyHalf;
    return Loss.MoreThanHalf;
  },
} as const;

/// Implementation details of IeeeFloat significands, such as big integer arithmetic.
/// As a rule of thumb, no functions in this module should dynamically allocate.
// PORT: `mod sig` (exported for the module's unit test).

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2750 is_all_zeros
function is_all_zeros(limbs: readonly Limb[]): boolean {
  return limbs.every((l) => l === 0n);
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2756 olsb
/// One, not zero, based LSB. That is, returns 0 for a zeroed significand.
function olsb(limbs: readonly Limb[]): number {
  for (let i = 0; i < limbs.length; i++) {
    if (limbs[i] !== 0n) {
      return i * LIMB_BITS + trailing_zeros(limbs[i]!) + 1;
    }
  }

  return 0;
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2768 omsb
/// One, not zero, based MSB. That is, returns 0 for a zeroed significand.
function omsb(limbs: readonly Limb[]): number {
  for (let i = limbs.length - 1; i >= 0; i--) {
    if (limbs[i] !== 0n) {
      return (i + 1) * LIMB_BITS - leading_zeros(limbs[i]!);
    }
  }

  return 0;
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2780 cmp
/// Comparison (unsigned) of two significands.
function cmp(a: readonly Limb[], b: readonly Limb[]): Ordering {
  assert(a.length === b.length);
  for (let i = a.length - 1; i >= 0; i--) {
    const o = cmp_limb(a[i]!, b[i]!);
    if (o !== 0) return o;
  }

  return 0;
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2794 get_bit
/// Extract the given bit.
function get_bit(limbs: readonly Limb[], bit: number): boolean {
  return (limbs[Math.floor(bit / LIMB_BITS)]! & shl(1n, bit % LIMB_BITS)) !== 0n;
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2800 set_bit
/// Set the given bit.
function set_bit(limbs: Limb[], bit: number): void {
  const i = Math.floor(bit / LIMB_BITS);
  limbs[i] = limbs[i]! | shl(1n, bit % LIMB_BITS);
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2806 shift_left
/// Shift `dst` left `bits` bits, subtract `bits` from its exponent.
function shift_left(dst: Limb[], exp: MutRef<ExpInt>, bits: number): void {
  if (bits > 0) {
    // Our exponent should not underflow.
    exp.value = checked_i32(exp.value - bits);

    // Jump is the inter-limb jump; shift is is intra-limb shift.
    const jump = Math.floor(bits / LIMB_BITS);
    const shift = bits % LIMB_BITS;

    for (let i = dst.length - 1; i >= 0; i--) {
      let limb: Limb;

      if (i < jump) {
        limb = 0n;
      } else {
        // dst[i] comes from the two limbs src[i - jump] and, if we have
        // an intra-limb shift, src[i - jump - 1].
        limb = dst[i - jump]!;
        if (shift > 0) {
          limb = shl(limb, shift);
          if (i >= jump + 1) {
            limb |= shr(dst[i - jump - 1]!, LIMB_BITS - shift);
          }
        }
      }

      dst[i] = limb;
    }
  }
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2839 shift_right
/// Shift `dst` right `bits` bits noting lost fraction.
function shift_right(dst: Limb[], exp: MutRef<ExpInt>, bits: number): Loss {
  const loss = Loss.through_truncation(dst, bits);

  if (bits > 0) {
    // Our exponent should not overflow.
    exp.value = checked_i32(exp.value + bits);

    // Jump is the inter-limb jump; shift is is intra-limb shift.
    const jump = Math.floor(bits / LIMB_BITS);
    const shift = bits % LIMB_BITS;

    // Perform the shift. This leaves the most significant `bits` bits
    // of the result at zero.
    for (let i = 0; i < dst.length; i++) {
      let limb: Limb;

      if (i + jump >= dst.length) {
        limb = 0n;
      } else {
        limb = dst[i + jump]!;
        if (shift > 0) {
          limb = shr(limb, shift);
          if (i + jump + 1 < dst.length) {
            limb |= shl(dst[i + jump + 1]!, LIMB_BITS - shift);
          }
        }
      }

      dst[i] = limb;
    }
  }

  return loss;
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2878 extract
/// Copy the bit vector of width `src_bits` from `src`, starting at bit SRC_LSB,
/// to `dst`, such that the bit SRC_LSB becomes the least significant bit of `dst`.
/// All high bits above `src_bits` in `dst` are zero-filled.
function extract(dst: Limb[], src: readonly Limb[], src_bits: number, src_lsb: number): void {
  if (src_bits === 0) {
    return;
  }

  const dst_limbs = limbs_for_bits(src_bits);
  assert(dst_limbs <= dst.length);

  src = src.slice(Math.floor(src_lsb / LIMB_BITS));
  assert(src.length >= dst_limbs, "source slice length does not match destination slice length");
  for (let i = 0; i < dst_limbs; i++) dst[i] = src[i]!;

  const shift = src_lsb % LIMB_BITS;
  // PORT: `shift_right(&mut dst[..dst_limbs], ..)` on a copy of the sub-slice, written back.
  const head = dst.slice(0, dst_limbs);
  shift_right(head, { value: 0 }, shift);
  for (let i = 0; i < dst_limbs; i++) dst[i] = head[i]!;

  // We now have (dst_limbs * LIMB_BITS - shift) bits from `src`
  // in `dst`.  If this is less that src_bits, append the rest, else
  // clear the high bits.
  const n = dst_limbs * LIMB_BITS - shift;
  if (n < src_bits) {
    const mask = shl(1n, src_bits - n) - 1n;
    dst[dst_limbs - 1] = dst[dst_limbs - 1]! | shl(src[dst_limbs]! & mask, n % LIMB_BITS);
  } else if (n > src_bits && src_bits % LIMB_BITS > 0) {
    dst[dst_limbs - 1] = dst[dst_limbs - 1]! & (shl(1n, src_bits % LIMB_BITS) - 1n);
  }

  // Clear high limbs.
  for (let i = dst_limbs; i < dst.length; i++) {
    dst[i] = 0n;
  }
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2912 from_limbs
/// We want the most significant PRECISION bits of `src`. There may not
/// be that many; extract what we can.
function from_limbs(dst: Limb[], src: readonly Limb[], precision: number): [Loss, ExpInt] {
  const omsb_ = omsb(src);

  if (precision <= omsb_) {
    extract(dst, src, precision, omsb_ - precision);
    return [Loss.through_truncation(src, omsb_ - precision), omsb_ - 1];
  } else {
    extract(dst, src, omsb_, 0);
    return [Loss.ExactlyZero, precision - 1];
  }
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2928 each_chunk
/// For every consecutive chunk of `bits` bits from `limbs`,
/// going from most significant to the least significant bits,
/// call `f` to transform those bits and store the result back.
function each_chunk(limbs: Limb[], bits: number, f: (chunk: Limb) => Limb): void {
  assert(LIMB_BITS % bits === 0);
  const mask = shl(1n, bits) - 1n;
  for (let k = limbs.length - 1; k >= 0; k--) {
    const limb = limbs[k]!;
    let r = 0n;
    for (let i = LIMB_BITS / bits - 1; i >= 0; i--) {
      r |= shl(f(shr(limb, i * bits) & mask), i * bits);
    }
    limbs[k] = r;
  }
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2941 increment
/// Increment in-place, return the carry flag.
function increment(dst: Limb[]): Limb {
  for (let i = 0; i < dst.length; i++) {
    dst[i] = wrapping_add(dst[i]!, 1n);
    if (dst[i] !== 0n) {
      return 0n;
    }
  }

  return 1n;
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2954 decrement
/// Decrement in-place, return the borrow flag.
function decrement(dst: Limb[]): Limb {
  for (let i = 0; i < dst.length; i++) {
    dst[i] = wrapping_sub(dst[i]!, 1n);
    if (dst[i] !== MAX) {
      return 0n;
    }
  }

  return 1n;
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2967 add
/// `a += b + c` where `c` is zero or one. Returns the carry flag.
function add(a: Limb[], b: readonly Limb[], c: Limb): Limb {
  assert(c <= 1n);

  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const [r, overflow] = overflowing_add(a[i]!, b[i]!);
    const [r2, overflow2] = overflowing_add(r, c);
    a[i] = r2;
    c = overflow || overflow2 ? 1n : 0n;
  }

  return c;
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2982 sub
/// `a -= b + c` where `c` is zero or one. Returns the borrow flag.
function sub(a: Limb[], b: readonly Limb[], c: Limb): Limb {
  assert(c <= 1n);

  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const [r, overflow] = overflowing_sub(a[i]!, b[i]!);
    const [r2, overflow2] = overflowing_sub(r, c);
    a[i] = r2;
    c = overflow || overflow2 ? 1n : 0n;
  }

  return c;
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:2997 add_or_sub
/// `a += b` or `a -= b`. Does not preserve `b`.
function add_or_sub(
  a_sig: Limb[],
  a_exp: MutRef<ExpInt>,
  a_sign: MutRef<boolean>,
  b_sig: Limb[],
  b_exp: ExpInt,
  b_sign: boolean,
): Loss {
  // Are we bigger exponent-wise than the RHS?
  const bits = a_exp.value - b_exp;

  // Determine if the operation on the absolute values is effectively
  // an addition or subtraction.
  // Subtraction is more subtle than one might naively expect.
  if (a_sign.value !== b_sign) {
    let loss: Loss;
    let loss_is_from_b: boolean;
    if (bits === 0) {
      [loss, loss_is_from_b] = [Loss.ExactlyZero, false];
    } else if (bits > 0) {
      shift_left(a_sig, a_exp, 1);
      [loss, loss_is_from_b] = [shift_right(b_sig, { value: 0 }, bits - 1), true];
    } else {
      shift_left(b_sig, { value: 0 }, 1);
      [loss, loss_is_from_b] = [shift_right(a_sig, a_exp, -bits - 1), false];
    }

    const invert_loss = (loss: Loss): Loss => {
      switch (loss) {
        case Loss.LessThanHalf:
          return Loss.MoreThanHalf;
        case Loss.MoreThanHalf:
          return Loss.LessThanHalf;
        default:
          return loss;
      }
    };

    // Should we reverse the subtraction.
    switch (cmp(a_sig, b_sig)) {
      case -1: {
        let borrow: Limb;
        if (loss !== Loss.ExactlyZero && !loss_is_from_b) {
          // The loss is being subtracted, borrow from the significand and invert
          // `loss`.
          loss = invert_loss(loss);
          borrow = 1n;
        } else {
          borrow = 0n;
        }
        // The code above is intended to ensure that no borrow is necessary.
        assert(sub(b_sig, a_sig, borrow) === 0n);
        assert(a_sig.length === b_sig.length);
        for (let i = 0; i < a_sig.length; i++) a_sig[i] = b_sig[i]!;
        a_sign.value = !a_sign.value;
        break;
      }
      case 1: {
        let borrow: Limb;
        if (loss !== Loss.ExactlyZero && loss_is_from_b) {
          // The loss is being subtracted, borrow from the significand and invert
          // `loss`.
          loss = invert_loss(loss);
          borrow = 1n;
        } else {
          borrow = 0n;
        }
        // The code above is intended to ensure that no borrow is necessary.
        assert(sub(a_sig, b_sig, borrow) === 0n);
        break;
      }
      case 0:
        a_sig.fill(0n);
        if (loss !== Loss.ExactlyZero && loss_is_from_b) {
          // b is slightly larger due to the loss, flip the sign.
          a_sign.value = !a_sign.value;
        }
        break;
    }

    return loss;
  } else {
    let loss: Loss;
    if (bits > 0) {
      loss = shift_right(b_sig, { value: 0 }, bits);
    } else {
      loss = shift_right(a_sig, a_exp, -bits);
    }
    // We have a guard bit; generating a carry cannot happen.
    assert(add(a_sig, b_sig, 0n) === 0n);
    return loss;
  }
}

// #[test] fn test_add_or_sub: ieee.test.ts

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:3149 widening_mul
/// `[low, high] = a * b`.
///
/// This cannot overflow, because
///
/// `(n - 1) * (n - 1) + 2 * (n - 1) == (n - 1) * (n + 1)`
///
/// which is less than n^2.
function widening_mul(a: Limb, b: Limb): Limb[] {
  // PORT: upstream adds the four half-limb partial products (`select(a, i) * select(b, j)` shifted by
  // `(i + j) * HALF_BITS`); with bigints the full product is one multiplication, split into its two limbs
  // (the same value, hot in decimal conversions).
  if (a === 0n || b === 0n) {
    return [0n, 0n];
  }
  const p = a * b;
  return [p & MAX, p >> 128n];
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:3172 mul
/// `dst = a * b` (for normal `a` and `b`). Returns the lost fraction.
function mul(dst: Limb[], exp: MutRef<ExpInt>, a: readonly Limb[], b: readonly Limb[], precision: number): Loss {
  // Put the narrower number on the `a` for less loops below.
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  for (let i = 0; i < b.length; i++) {
    dst[i] = 0n;
  }

  for (let i = 0; i < a.length; i++) {
    let carry = 0n;
    for (let j = 0; j < b.length; j++) {
      let [low, high] = widening_mul(a[i]!, b[j]!) as [Limb, Limb];

      // Now add carry.
      let [low2, overflow] = overflowing_add(low, carry);
      high += overflow ? 1n : 0n;

      // And now `dst[i + j]`, and store the new low part there.
      [low, overflow] = overflowing_add(low2, dst[i + j]!);
      high += overflow ? 1n : 0n;

      dst[i + j] = low;
      carry = high;
    }
    dst[i + b.length] = carry;
  }

  // Assume the operands involved in the multiplication are single-precision
  // FP, and the two multiplicants are:
  //     a = a23 . a22 ... a0 * 2^e1
  //     b = b23 . b22 ... b0 * 2^e2
  // the result of multiplication is:
  //     dst = c48 c47 c46 . c45 ... c0 * 2^(e1+e2)
  // Note that there are three significant bits at the left-hand side of the
  // radix point: two for the multiplication, and an overflow bit for the
  // addition (that will always be zero at this point). Move the radix point
  // toward left by two bits, and adjust exponent accordingly.
  exp.value += 2;

  // Convert the result having "2 * precision" significant-bits back to the one
  // having "precision" significant-bits. First, move the radix point from
  // poision "2*precision - 1" to "precision - 1". The exponent need to be
  // adjusted by "2*precision - 1" - "precision - 1" = "precision".
  exp.value -= precision + 1;

  // In case MSB resides at the left-hand side of radix point, shift the
  // mantissa right by some amount to make sure the MSB reside right before
  // the radix point (i.e. "MSB . rest-significant-bits").
  //
  // Note that the result is not normalized when "omsb < precision". So, the
  // caller needs to call IeeeFloat::normalize() if normalized value is
  // expected.
  const omsb_ = omsb(dst);
  if (omsb_ <= precision) {
    return Loss.ExactlyZero;
  } else {
    return shift_right(dst, exp, omsb_ - precision);
  }
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:3243 div
/// `quotient = dividend / divisor`. Returns the lost fraction.
/// Does not preserve `dividend` or `divisor`.
function div(quotient: Limb[], exp: MutRef<ExpInt>, dividend: Limb[], divisor: Limb[], precision: number): Loss {
  // Normalize the divisor.
  let bits = precision - omsb(divisor);
  shift_left(divisor, { value: 0 }, bits);
  exp.value += bits;

  // Normalize the dividend.
  bits = precision - omsb(dividend);
  shift_left(dividend, exp, bits);

  // Division by 1.
  const olsb_divisor = olsb(divisor);
  if (olsb_divisor === precision) {
    assert(quotient.length === dividend.length);
    for (let i = 0; i < quotient.length; i++) quotient[i] = dividend[i]!;
    return Loss.ExactlyZero;
  }

  // Ensure the dividend >= divisor initially for the loop below.
  // Incidentally, this means that the division loop below is
  // guaranteed to set the integer bit to one.
  if (cmp(dividend, divisor) === -1) {
    shift_left(dividend, exp, 1);
    assert(cmp(dividend, divisor) !== -1);
  }

  // Helper for figuring out the lost fraction.
  const lost_fraction = (dividend: readonly Limb[], divisor: readonly Limb[]): Loss => {
    switch (cmp(dividend, divisor)) {
      case 1:
        return Loss.MoreThanHalf;
      case 0:
        return Loss.ExactlyHalf;
      case -1:
        if (is_all_zeros(dividend)) {
          return Loss.ExactlyZero;
        } else {
          return Loss.LessThanHalf;
        }
    }
  };

  // Try to perform a (much faster) short division for small divisors.
  const divisor_bits = precision - (olsb_divisor - 1);
  // macro_rules! try_short_div: `$W` / `$H` are the `2 * half`- / `half`-bit unsigned types.
  const try_short_div = (half: number): Loss | undefined => {
    if (divisor_bits * 2 <= half) {
      const H = shl(1n, half) - 1n;
      // Extract the small divisor.
      shift_right(divisor, { value: 0 }, olsb_divisor - 1);
      const divisor_ = divisor[0]! & H;

      // Shift the dividend to produce a quotient with the unit bit set.
      const top_limb = dividend[dividend.length - 1]!;
      let rem = shr(top_limb, LIMB_BITS - (divisor_bits - 1)) & H;
      shift_left(dividend, { value: 0 }, divisor_bits - 1);

      // Apply short division in place on $H (of $half bits) chunks.
      each_chunk(dividend, half, (chunk) => {
        const chunk_ = chunk & H;
        const combined = (rem << BigInt(half)) | chunk_;
        rem = combined % divisor_ & H;
        return (combined / divisor_) & H;
      });
      assert(quotient.length === dividend.length);
      for (let i = 0; i < quotient.length; i++) quotient[i] = dividend[i]!;

      return lost_fraction([shl(rem, 1)], [divisor_]);
    }
    return undefined;
  };

  let r = try_short_div(16); // try_short_div!(u32, u16, 16)
  if (r !== undefined) return r;
  r = try_short_div(32); // try_short_div!(u64, u32, 32)
  if (r !== undefined) return r;
  r = try_short_div(64); // try_short_div!(u128, u64, 64)
  if (r !== undefined) return r;

  // Zero the quotient before setting bits in it.
  for (let i = 0; i < limbs_for_bits(precision); i++) {
    quotient[i] = 0n;
  }

  // Long division.
  for (let bit = precision - 1; bit >= 0; bit--) {
    if (cmp(dividend, divisor) !== -1) {
      sub(dividend, divisor, 0n);
      set_bit(quotient, bit);
    }
    shift_left(dividend, { value: 0 }, 1);
  }

  return lost_fraction(dividend, divisor);
}

/** `mod sig` */
export const sig = {
  is_all_zeros,
  olsb,
  omsb,
  cmp,
  get_bit,
  set_bit,
  shift_left,
  shift_right,
  extract,
  from_limbs,
  each_chunk,
  increment,
  decrement,
  add,
  sub,
  add_or_sub,
  widening_mul,
  mul,
  div,
};
