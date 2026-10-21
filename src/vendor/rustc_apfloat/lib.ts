// Port of rustc_apfloat =0.2.3+llvm-462a31f5a5ab `src/lib.rs` (the version in upstream's Cargo.lock; rustc's MIR
// build and const eval do all their float arithmetic through it).
//
// PORT: generics and traits.
// - `Float` is split in two: the instance side (`Float<Self>`, methods taking `self`) and the static side
//   (`FloatType<Self>`, the associated consts and the fns without `self`: `Self::ZERO`, `Self::from_bits(..)`, ...).
//   A float type is a value of `FloatType` (`ieee::Double`, ...); generic code over `F: Float` takes that dictionary.
//   Instances reach theirs through `Self()`.
// - Provided methods live in `Float_provided` (instance side: `this`-typed; static side: take the `FloatType`), and
//   the `float_common_impls!` items in `float_common_impls`; float types install them (ieee.ts `IeeeFloat`).
// - Floats are immutable values (Rust: `Copy`): methods never mutate `this`; `x op= y` (`AddAssign`, ...) returns
//   the new value.
// - `u128` / `i128` values (bits, payloads, integer conversions) are `bigint`; `usize` widths and `ExpInt` are `number`.
// - `&mut bool` out-parameters (`is_exact`, `loses_info`) are `MutRef<boolean>`.
// - `pub mod ieee; pub mod ppc;` are not re-exported from here (ieee.ts imports this module, so the re-export would
//   be an ESM cycle evaluated in the wrong order): import `./ieee.ts` directly.
//
//! Port of LLVM's APFloat software floating-point implementation from the
//! following C++ sources (please update commit hash when backporting):
//! <https://github.com/llvm/llvm-project/commit/462a31f5a5abb905869ea93cc49b096079b11aa4>
//! * `llvm/include/llvm/ADT/APFloat.h` -> `Float` and `FloatConvert` traits
//! * `llvm/lib/Support/APFloat.cpp` -> `ieee` and `ppc` modules
//! * `llvm/unittests/ADT/APFloatTest.cpp` -> `tests` directory
//!
//! The port contains no unsafe code, global state, or side-effects in general,
//! and the only allocations are in the conversion to/from decimal strings.
//!
//! Most of the API and the testcases are intact in some form or another,
//! with some ergonomic changes, such as idiomatic short names, returning
//! new values instead of mutating the receiver, and having separate method
//! variants that take a non-default rounding mode (with the suffix `_r`).
//! Comments have been preserved where possible, only slightly adapted.
//!
//! Instead of keeping a pointer to a configuration struct and inspecting it
//! dynamically on every operation, types (e.g. `ieee::Double`), traits
//! (e.g. `ieee::Semantics`) and associated constants are employed for
//! increased type safety and performance.
//!
//! On-heap bigints are replaced everywhere (except in decimal conversion),
//! with short arrays of `type Limb = u128` elements (instead of `u64`),
//! This allows fitting the largest supported significands in one integer
//! (`ieee::Quad` and `ppc::Fallback` use slightly less than 128 bits).
//! All of the functions in the `ieee::sig` module operate on slices.
//!
//! # Note
//!
//! This API is completely unstable and subject to change.

import { type Debug, type Fmt, debug_struct } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { Panic } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import { flags_companion } from "../bitflags/traits.ts";
import { to_writer } from "../bitflags/parser.ts";

/** `core::cmp::Ordering` (`Less` = -1, `Equal` = 0, `Greater` = 1). */
export type Ordering = -1 | 0 | 1;

/// IEEE-754R 7: Default exception handling.
///
/// UNDERFLOW or OVERFLOW are always returned or-ed with INEXACT.
///
/// APFloat models this behavior specified by IEEE-754:
///   "For operations producing results in floating-point format, the default
///    result of an operation that signals the invalid operation exception
///    shall be a quiet NaN."
// #[must_use]
// #[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
export type Status = number & { readonly __brand: "rustc_apfloat::Status" };
export const Status = {
  ...flags_companion(
    8,
    {
      OK: 0x00 as Status,
      INVALID_OP: 0x01 as Status,
      DIV_BY_ZERO: 0x02 as Status,
      OVERFLOW: 0x04 as Status,
      UNDERFLOW: 0x08 as Status,
      INEXACT: 0x10 as Status,
    },
    [
      ["OK", 0x00 as Status],
      ["INVALID_OP", 0x01 as Status],
      ["DIV_BY_ZERO", 0x02 as Status],
      ["OVERFLOW", 0x04 as Status],
      ["UNDERFLOW", 0x08 as Status],
      ["INEXACT", 0x10 as Status],
    ],
  ),

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:78 and
  /// Add a value to this status to create a [`StatusAnd`].
  and<T>(self: Status, value: T): StatusAnd<T> {
    return { status: self, value };
  },
};
/** `#[derive(Debug)]` of a bitflags 2 type: `Status(A | B)`, `Status(0x0)` when empty. */
export const debug_Status: Debug<Status> = (v) => `Status(${v === 0 ? "0x0" : to_writer(Status.FLAGS_DESC, v)})`;

/// The result of a computation consisting of the output value and the exceptions, if any.
// #[must_use]
// #[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
export interface StatusAnd<T> {
  readonly status: Status;
  readonly value: T;
}
export const StatusAnd = {
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:85 map
  /// Keep the existing status but apply a transformation to `value`.
  map<T, U>(self: StatusAnd<T>, f: (v: T) => U): StatusAnd<U> {
    return {
      status: self.status,
      value: f(self.value),
    };
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:95 unwrap
  /// Extract the inner value if there were no errors. If there were errors, panic.
  unwrap<T>(self: StatusAnd<T>, debug_T: Debug<T>): T {
    if (self.status !== Status.OK) {
      throw new Panic(
        `assertion \`left == right\` failed: called \`StatusAnd::unwrap()\` on an error value. Value: ${debug_T(self.value, { alternate: false })}\n  left: ${debug_Status(self.status, { alternate: false })}\n right: ${debug_Status(Status.OK, { alternate: false })}`,
      );
    }
    return self.value;
  },
};
export function debug_StatusAnd<T>(v: StatusAnd<T>, f: Fmt, debug_T: Debug<T>): string {
  return debug_struct(f, "StatusAnd", [
    ["status", debug_Status(v.status, f)],
    ["value", debug_T(v.value, f)],
  ]);
}

// #[macro_export] macro_rules! unpack: `unpack!(status=, e)` / `unpack!(status|=, e)` are written out at each use
// (`const r = e; status = r.status; x = r.value;`).

/// Category of internally-represented number.
// #[derive(Copy, Clone, PartialEq, Eq, Debug)]
export type Category = "Infinity" | "NaN" | "Normal" | "Zero";
export const Category = { Infinity: "Infinity", NaN: "NaN", Normal: "Normal", Zero: "Zero" } as const;
export const debug_Category: Debug<Category> = (v) => v;

/// IEEE-754R 4.3: Rounding-direction attributes.
// #[derive(Copy, Clone, PartialEq, Eq, Debug)]
export type Round = "NearestTiesToEven" | "TowardPositive" | "TowardNegative" | "TowardZero" | "NearestTiesToAway";
export const Round = {
  NearestTiesToEven: "NearestTiesToEven",
  TowardPositive: "TowardPositive",
  TowardNegative: "TowardNegative",
  TowardZero: "TowardZero",
  NearestTiesToAway: "NearestTiesToAway",

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:143 neg
  /** `impl Neg for Round` */
  neg(self: Round): Round {
    switch (self) {
      case "TowardPositive":
        return "TowardNegative";
      case "TowardNegative":
        return "TowardPositive";
      case "NearestTiesToEven":
      case "TowardZero":
      case "NearestTiesToAway":
        return self;
    }
  },
} as const;
export const debug_Round: Debug<Round> = (v) => v;

/// A signed type to represent a floating point number's unbiased exponent.
export type ExpInt = number;

// \c ilogb error results.
export const IEK_INF: ExpInt = 2147483647;
export const IEK_NAN: ExpInt = -2147483648;
export const IEK_ZERO: ExpInt = -2147483648 + 1;

/// An error which can occur when parsing a floating point number from a string.
// #[derive(Copy, Clone, PartialEq, Eq, Debug)]
export interface ParseError {
  readonly _0: string;
}
export function ParseError(s: string): ParseError {
  return { _0: s };
}
export const debug_ParseError: Debug<ParseError> = (v) => `ParseError(${JSON.stringify(v._0)})`;

/** PORT: the formatter flags `fmt::Display for IeeeFloat` reads (`{:width.precision}`, `{:#}`). */
export interface FloatFmt {
  readonly width?: number;
  readonly precision?: number;
  readonly alternate?: boolean;
}

/// A self-contained host- and target-independent arbitrary-precision
/// floating-point software implementation.
///
/// `apfloat` uses significand bignum integer arithmetic as provided by functions
/// in the `ieee::sig`.
///
/// Written for clarity rather than speed, in particular with a view to use in
/// the front-end of a cross compiler so that target arithmetic can be correctly
/// performed on the host. Performance should nonetheless be reasonable,
/// particularly for its intended use. It may be useful as a base
/// implementation for a run-time library during development of a faster
/// target-specific one.
///
/// All 5 rounding modes in the IEEE-754R draft are handled correctly for all
/// implemented operations. Currently implemented operations are add, subtract,
/// multiply, divide, fused-multiply-add, conversion-to-float,
/// conversion-to-integer and conversion-from-integer. New rounding modes
/// (e.g. away from zero) can be added with three or four lines of code.
///
/// Four formats are built-in: IEEE single precision, double precision,
/// quadruple precision, and x87 80-bit extended double (when operating with
/// full extended precision). Adding a new format that obeys IEEE semantics
/// only requires adding two lines of code: a declaration and definition of the
/// format.
///
/// All operations return the status of that operation as an exception bit-mask,
/// so multiple operations can be done consecutively with their results or-ed
/// together. The returned status can be useful for compiler diagnostics; e.g.,
/// inexact, underflow and overflow can be easily diagnosed on constant folding,
/// and compiler optimizers can determine what exceptions would be raised by
/// folding operations and optimize, or perhaps not optimize, accordingly.
///
/// At present, underflow tininess is detected after rounding; it should be
/// straight forward to add support for the before-rounding case too.
///
/// The library reads hexadecimal floating point numbers as per C99, and
/// correctly rounds if necessary according to the specified rounding mode.
/// Syntax is required to have been validated by the caller.
///
/// It also reads decimal floating point numbers and correctly rounds according
/// to the specified rounding mode.
///
/// Non-zero finite numbers are represented internally as a sign bit, a 16-bit
/// signed exponent, and the significand as an array of integer limbs. After
/// normalization of a number of precision P the exponent is within the range of
/// the format, and if the number is not denormal the P-th bit of the
/// significand is set as an explicit integer bit. For denormals the most
/// significant bit is shifted right so that the exponent is maintained at the
/// format's minimum, so that the smallest denormal has just the least
/// significant bit of the significand set. The sign of zeros and infinities
/// is significant; the exponent and significand of such numbers is not stored,
/// but has a known implicit (deterministic) value: 0 for the significands, 0
/// for zero exponent, all 1 bits for infinity exponent. For NaNs the sign and
/// significand are deterministic, although not really meaningful, and preserved
/// in non-conversion operations. The exponent is implicitly all 1 bits.
///
/// `apfloat` does not provide any exception handling beyond default exception
/// handling. We represent Signaling NaNs via IEEE-754R 2008 6.2.1 should clause
/// by encoding Signaling NaNs with the first bit of its trailing significand as
/// 0.
///
/// Future work
/// ===========
///
/// Some features that may or may not be worth adding:
///
/// Optional ability to detect underflow tininess before rounding.
///
/// New formats: x87 in single and double precision mode (IEEE apart from
/// extended exponent range) (hard).
///
/// New operations: sqrt, nexttoward.
///
// PORT: the instance side of `trait Float` (supertraits: `Neg`, `PartialOrd`, `Display`, the operators of
// `float_common_impls!`). The static side is `FloatType`.
export interface Float<Self extends Float<Self>> {
  /** PORT: `Self::` (the static side of the type). */
  Self(): FloatType<Self>;

  /** `Neg` */
  neg(): Self;
  /** `PartialOrd::partial_cmp` (`undefined` = `None`) */
  partial_cmp(rhs: Self): Ordering | undefined;
  /** `PartialEq::eq` */
  eq(rhs: Self): boolean;
  /** `Display` */
  fmt(f?: FloatFmt): string;

  // Arithmetic

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:301 add_r
  add_r(rhs: Self, round: Round): StatusAnd<Self>;
  sub_r(rhs: Self, round: Round): StatusAnd<Self>; // (provided)
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:305 mul_r
  mul_r(rhs: Self, round: Round): StatusAnd<Self>;
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:306 mul_add_r
  mul_add_r(multiplicand: Self, addend: Self, round: Round): StatusAnd<Self>;
  mul_add(multiplicand: Self, addend: Self): StatusAnd<Self>; // (provided)
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:310 div_r
  div_r(rhs: Self, round: Round): StatusAnd<Self>;
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:312 ieee_rem
  /// IEEE remainder.
  ieee_rem(rhs: Self): StatusAnd<Self>;
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:314 c_fmod
  /// C fmod, or llvm frem.
  c_fmod(rhs: Self): StatusAnd<Self>;
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:315 round_to_integral
  round_to_integral(round: Round): StatusAnd<Self>;

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:318 next_up
  /// IEEE-754R 2008 5.3.1: nextUp.
  next_up(): StatusAnd<Self>;

  next_down(): StatusAnd<Self>; // (provided)

  abs(): Self; // (provided)
  copy_sign(rhs: Self): Self; // (provided)

  // Conversions
  // (static side: from_bits, from_i128_r, from_i128, from_u128_r, from_u128, from_str_r)
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:360 to_bits
  to_bits(): bigint;

  to_i128_r(width: number, round: Round, is_exact: MutRef<boolean>): StatusAnd<bigint>; // (provided)
  to_i128(width: number): StatusAnd<bigint>; // (provided)
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:403 to_u128_r
  to_u128_r(width: number, round: Round, is_exact: MutRef<boolean>): StatusAnd<bigint>;
  to_u128(width: number): StatusAnd<bigint>; // (provided)

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:408 cmp_abs_normal
  cmp_abs_normal(rhs: Self): Ordering;

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:411 bitwise_eq
  /// Bitwise comparison for equality (QNaNs compare equal, 0!=-0).
  bitwise_eq(rhs: Self): boolean;

  // IEEE-754R 5.7.2 General operations.

  min(other: Self): Self; // (provided)
  max(other: Self): Self; // (provided)
  minimum(other: Self): Self; // (provided)
  maximum(other: Self): Self; // (provided)

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:487 is_negative
  /// IEEE-754R isSignMinus: Returns true if and only if the current value is
  /// negative.
  ///
  /// This applies to zeros and NaNs as well.
  is_negative(): boolean;

  is_normal(): boolean; // (provided)
  is_finite(): boolean; // (provided)
  is_zero(): boolean; // (provided)

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:512 is_denormal
  /// IEEE-754R isSubnormal(): Returns true if and only if the float is a
  /// denormal.
  is_denormal(): boolean;

  is_infinite(): boolean; // (provided)
  is_nan(): boolean; // (provided)

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:525 is_signaling
  /// Returns true if and only if the float is a signaling NaN.
  is_signaling(): boolean;

  // Simple Queries

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:529 category
  category(): Category;
  is_non_zero(): boolean; // (provided)
  is_finite_non_zero(): boolean; // (provided)
  is_pos_zero(): boolean; // (provided)
  is_neg_zero(): boolean; // (provided)
  is_pos_infinity(): boolean; // (provided)
  is_neg_infinity(): boolean; // (provided)
  is_smallest(): boolean; // (provided)
  is_smallest_normalized(): boolean; // (provided)
  is_largest(): boolean; // (provided)
  is_integer(): boolean; // (provided)

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:577 get_exact_inverse
  /// If this value has an exact multiplicative inverse, return it.
  get_exact_inverse(): Self | undefined;

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:588 ilogb
  /// Returns the exponent of the internal representation of the Float.
  ///
  /// Because the radix of Float is 2, this is equivalent to floor(log2(x)).
  /// For special Float values, this returns special error codes:
  ///
  ///   NaN -> \c IEK_NAN
  ///   0   -> \c IEK_ZERO
  ///   Inf -> \c IEK_INF
  ///
  ilogb(): ExpInt;

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:591 scalbn_r
  /// Returns: self * 2^exp for integral exponents.
  scalbn_r(exp: ExpInt, round: Round): Self;
  scalbn(exp: ExpInt): Self; // (provided)

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:600 frexp_r
  /// Equivalent of C standard library function.
  ///
  /// While the C standard says exp is an unspecified value for infinity and nan,
  /// this returns INT_MAX for infinities, and INT_MIN for NaNs (see `ilogb`).
  frexp_r(exp: MutRef<ExpInt>, round: Round): Self;
  frexp(exp: MutRef<ExpInt>): Self; // (provided)

  // float_common_impls!
  add(rhs: Self): StatusAnd<Self>;
  sub(rhs: Self): StatusAnd<Self>;
  mul(rhs: Self): StatusAnd<Self>;
  div(rhs: Self): StatusAnd<Self>;
  rem(rhs: Self): StatusAnd<Self>;
  add_assign(rhs: Self): Self;
  sub_assign(rhs: Self): Self;
  mul_assign(rhs: Self): Self;
  div_assign(rhs: Self): Self;
  rem_assign(rhs: Self): Self;
}

/** PORT: the static side of `trait Float` (associated consts and the fns without `self`), plus `Default`/`FromStr`. */
export interface FloatType<Self extends Float<Self>> {
  /// Total number of bits in the in-memory format.
  readonly BITS: number;

  /// Number of bits in the significand. This includes the integer bit.
  readonly PRECISION: number;

  /// The largest E such that 2^E is representable; this matches the
  /// definition of IEEE 754.
  readonly MAX_EXP: ExpInt;

  /// The smallest E such that 2^E is a normalized number; this
  /// matches the definition of IEEE 754.
  readonly MIN_EXP: ExpInt;

  /// Positive Zero.
  readonly ZERO: Self;

  /// Positive Infinity.
  readonly INFINITY: Self;

  /// NaN (Not a Number).
  // FIXME(eddyb) provide a default when qnan becomes const fn.
  readonly NAN: Self;

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:281 qnan
  /// Factory for QNaN values.
  // FIXME(eddyb) should be const fn.
  qnan(payload: bigint | undefined): Self;

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:285 snan
  /// Factory for SNaN values.
  // FIXME(eddyb) should be const fn.
  snan(payload: bigint | undefined): Self;

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:289 largest
  /// Largest finite number.
  // FIXME(eddyb) should be const (but FloatPair::largest is nontrivial).
  largest(): Self;

  /// Smallest (by magnitude) finite number.
  /// Might be denormalized, which implies a relative loss of precision.
  readonly SMALLEST: Self;

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:297 smallest_normalized
  /// Smallest (by magnitude) normalized finite number.
  // FIXME(eddyb) should be const (but FloatPair::smallest_normalized is nontrivial).
  smallest_normalized(): Self;

  // Conversions
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:344 from_bits
  from_bits(input: bigint): Self;
  from_i128_r(input: bigint, round: Round): StatusAnd<Self>; // (provided)
  from_i128(input: bigint): StatusAnd<Self>; // (provided)
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:355 from_u128_r
  from_u128_r(input: bigint, round: Round): StatusAnd<Self>;
  from_u128(input: bigint): StatusAnd<Self>; // (provided)
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:359 from_str_r
  from_str_r(s: string, round: Round): Result<StatusAnd<Self>, ParseError>;

  /** `Default` (float_common_impls!) */
  default(): Self;
  /** `FromStr` (float_common_impls!) */
  from_str(s: string): Result<Self, ParseError>;
}

/** `x as i128` for a `u128` / an `i128` result of wrapping arithmetic. */
function as_i128(x: bigint): bigint {
  return BigInt.asIntN(128, x);
}

/** PORT: the provided methods of `trait Float`. */
export const Float_provided = {
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:302 sub_r
  sub_r<F extends Float<F>>(this: F, rhs: F, round: Round): StatusAnd<F> {
    return this.add_r(rhs.neg(), round);
  },
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:307 mul_add
  mul_add<F extends Float<F>>(this: F, multiplicand: F, addend: F): StatusAnd<F> {
    return this.mul_add_r(multiplicand, addend, Round.NearestTiesToEven);
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:324 next_down
  /// IEEE-754R 2008 5.3.1: nextDown.
  ///
  /// *NOTE* since nextDown(x) = -nextUp(-x), we only implement nextUp with
  /// appropriate sign switching before/after the computation.
  next_down<F extends Float<F>>(this: F): StatusAnd<F> {
    return StatusAnd.map(this.neg().next_up(), (r) => r.neg());
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:328 abs
  abs<F extends Float<F>>(this: F): F {
    if (this.is_negative()) {
      return this.neg();
    } else {
      return this;
    }
  },
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:335 copy_sign
  copy_sign<F extends Float<F>>(this: F, rhs: F): F {
    if (this.is_negative() !== rhs.is_negative()) {
      return this.neg();
    } else {
      return this;
    }
  },

  // Conversions
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:345 from_i128_r
  from_i128_r<F extends Float<F>>(Self: FloatType<F>, input: bigint, round: Round): StatusAnd<F> {
    if (input < 0n) {
      return StatusAnd.map(Self.from_u128_r(BigInt.asUintN(128, -input), Round.neg(round)), (r) => r.neg());
    } else {
      return Self.from_u128_r(input, round);
    }
  },
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:352 from_i128
  from_i128<F extends Float<F>>(Self: FloatType<F>, input: bigint): StatusAnd<F> {
    return Self.from_i128_r(input, Round.NearestTiesToEven);
  },
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:356 from_u128
  from_u128<F extends Float<F>>(Self: FloatType<F>, input: bigint): StatusAnd<F> {
    return Self.from_u128_r(input, Round.NearestTiesToEven);
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:377 to_i128_r
  /// Convert a floating point number to an integer according to the
  /// rounding mode. In case of an invalid operation exception,
  /// deterministic values are returned, namely zero for NaNs and the
  /// minimal or maximal value respectively for underflow or overflow.
  /// If the rounded value is in range but the floating point number is
  /// not the exact integer, the C standard doesn't require an inexact
  /// exception to be raised. IEEE-854 does require it so we do that.
  ///
  /// Note that for conversions to integer type the C standard requires
  /// round-to-zero to always be used.
  ///
  /// The *is_exact output tells whether the result is exact, in the sense
  /// that converting it back to the original floating point type produces
  /// the original value. This is almost equivalent to result==Status::OK,
  /// except for negative zeroes.
  to_i128_r<F extends Float<F>>(this: F, width: number, round: Round, is_exact: MutRef<boolean>): StatusAnd<bigint> {
    let status: Status;
    if (this.is_negative()) {
      if (this.is_zero()) {
        // Negative zero can't be represented as an int.
        is_exact.value = false;
      }
      const r_ = this.neg().to_u128_r(width, Round.neg(round), is_exact);
      status = r_.status;
      const r = r_.value;

      // Check for values that don't fit in the signed integer.
      // PORT: `1 << (width - 1)` and `-1 << (width - 1)` are i128 / u128 shifts (`width` <= 128).
      if (r > 1n << BigInt(width - 1)) {
        // Return the most negative integer for the given width.
        is_exact.value = false;
        return Status.and(Status.INVALID_OP, as_i128(-1n << BigInt(width - 1)));
      } else {
        return Status.and(status, as_i128(BigInt.asUintN(128, -r)));
      }
    } else {
      // Positive case is simpler, can pretend it's a smaller unsigned
      // integer, and `to_u128` will take care of all the edge cases.
      return StatusAnd.map(this.to_u128_r(width - 1, round, is_exact), (r) => as_i128(r));
    }
  },
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:400 to_i128
  to_i128<F extends Float<F>>(this: F, width: number): StatusAnd<bigint> {
    return this.to_i128_r(width, Round.TowardZero, { value: true });
  },
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:404 to_u128
  to_u128<F extends Float<F>>(this: F, width: number): StatusAnd<bigint> {
    return this.to_u128_r(width, Round.TowardZero, { value: true });
  },

  // IEEE-754R 5.7.2 General operations.

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:417 min
  /// Implements IEEE minNum semantics. Returns the smaller of the 2 arguments if
  /// both are not NaN. If either argument is a NaN, returns the other argument.
  min<F extends Float<F>>(this: F, other: F): F {
    if (this.is_nan()) {
      return other;
    } else if (other.is_nan()) {
      return this;
    } else if (other.partial_cmp(this) === -1) {
      return other;
    } else {
      return this;
    }
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:431 max
  /// Implements IEEE maxNum semantics. Returns the larger of the 2 arguments if
  /// both are not NaN. If either argument is a NaN, returns the other argument.
  max<F extends Float<F>>(this: F, other: F): F {
    if (this.is_nan()) {
      return other;
    } else if (other.is_nan()) {
      return this;
    } else if (this.partial_cmp(other) === -1) {
      return other;
    } else {
      return this;
    }
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:445 minimum
  /// Implements IEEE 754-2018 minimum semantics. Returns the smaller of 2
  /// arguments, propagating NaNs and treating -0 as less than +0.
  minimum<F extends Float<F>>(this: F, other: F): F {
    if (this.is_nan()) {
      return this;
    } else if (other.is_nan()) {
      return other;
    } else if (this.is_zero() && other.is_zero() && this.is_negative() !== other.is_negative()) {
      if (this.is_negative()) {
        return this;
      } else {
        return other;
      }
    } else if (other.partial_cmp(this) === -1) {
      return other;
    } else {
      return this;
    }
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:465 maximum
  /// Implements IEEE 754-2018 maximum semantics. Returns the larger of 2
  /// arguments, propagating NaNs and treating -0 as less than +0.
  maximum<F extends Float<F>>(this: F, other: F): F {
    if (this.is_nan()) {
      return this;
    } else if (other.is_nan()) {
      return other;
    } else if (this.is_zero() && other.is_zero() && this.is_negative() !== other.is_negative()) {
      if (this.is_negative()) {
        return other;
      } else {
        return this;
      }
    } else if (this.partial_cmp(other) === -1) {
      return other;
    } else {
      return this;
    }
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:493 is_normal
  /// IEEE-754R isNormal: Returns true if and only if the current value is normal.
  ///
  /// This implies that the current value of the float is not zero, subnormal,
  /// infinite, or NaN following the definition of normality from IEEE-754R.
  is_normal<F extends Float<F>>(this: F): boolean {
    return !this.is_denormal() && this.is_finite_non_zero();
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:501 is_finite
  /// Returns true if and only if the current value is zero, subnormal, or
  /// normal.
  ///
  /// This means that the value is not infinite or NaN.
  is_finite<F extends Float<F>>(this: F): boolean {
    return !this.is_nan() && !this.is_infinite();
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:506 is_zero
  /// Returns true if and only if the float is plus or minus zero.
  is_zero<F extends Float<F>>(this: F): boolean {
    return this.category() === Category.Zero;
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:515 is_infinite
  /// IEEE-754R isInfinite(): Returns true if and only if the float is infinity.
  is_infinite<F extends Float<F>>(this: F): boolean {
    return this.category() === Category.Infinity;
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:520 is_nan
  /// Returns true if and only if the float is a quiet or signaling NaN.
  is_nan<F extends Float<F>>(this: F): boolean {
    return this.category() === Category.NaN;
  },

  // Simple Queries

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:530 is_non_zero
  is_non_zero<F extends Float<F>>(this: F): boolean {
    return !this.is_zero();
  },
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:533 is_finite_non_zero
  is_finite_non_zero<F extends Float<F>>(this: F): boolean {
    return this.is_finite() && !this.is_zero();
  },
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:536 is_pos_zero
  is_pos_zero<F extends Float<F>>(this: F): boolean {
    return this.is_zero() && !this.is_negative();
  },
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:539 is_neg_zero
  is_neg_zero<F extends Float<F>>(this: F): boolean {
    return this.is_zero() && this.is_negative();
  },
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:542 is_pos_infinity
  is_pos_infinity<F extends Float<F>>(this: F): boolean {
    return this.is_infinite() && !this.is_negative();
  },
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:545 is_neg_infinity
  is_neg_infinity<F extends Float<F>>(this: F): boolean {
    return this.is_infinite() && this.is_negative();
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:551 is_smallest
  /// Returns true if and only if the number has the smallest possible non-zero
  /// magnitude in the current semantics.
  is_smallest<F extends Float<F>>(this: F): boolean {
    return this.Self().SMALLEST.copy_sign(this).bitwise_eq(this);
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:557 is_smallest_normalized
  /// Returns true if this is the smallest (by magnitude) normalized finite
  /// number in the given semantics.
  is_smallest_normalized<F extends Float<F>>(this: F): boolean {
    return this.Self().smallest_normalized().copy_sign(this).bitwise_eq(this);
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:563 is_largest
  /// Returns true if and only if the number has the largest possible finite
  /// magnitude in the current semantics.
  is_largest<F extends Float<F>>(this: F): boolean {
    return this.Self().largest().copy_sign(this).bitwise_eq(this);
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:568 is_integer
  /// Returns true if and only if the number is an exact integer.
  is_integer<F extends Float<F>>(this: F): boolean {
    // This could be made more efficient; I'm going for obviously correct.
    if (!this.is_finite()) {
      return false;
    }
    return this.round_to_integral(Round.TowardZero).value.bitwise_eq(this);
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:592 scalbn
  scalbn<F extends Float<F>>(this: F, exp: ExpInt): F {
    return this.scalbn_r(exp, Round.NearestTiesToEven);
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:601 frexp
  frexp<F extends Float<F>>(this: F, exp: MutRef<ExpInt>): F {
    return this.frexp_r(exp, Round.NearestTiesToEven);
  },
};

/** The instance-side names of `Float_provided`, for installing them on a float type's prototype. */
export const FLOAT_PROVIDED_METHODS = [
  "sub_r",
  "mul_add",
  "next_down",
  "abs",
  "copy_sign",
  "to_i128_r",
  "to_i128",
  "to_u128",
  "min",
  "max",
  "minimum",
  "maximum",
  "is_normal",
  "is_finite",
  "is_zero",
  "is_infinite",
  "is_nan",
  "is_non_zero",
  "is_finite_non_zero",
  "is_pos_zero",
  "is_neg_zero",
  "is_pos_infinity",
  "is_neg_infinity",
  "is_smallest",
  "is_smallest_normalized",
  "is_largest",
  "is_integer",
  "scalbn",
  "frexp",
] as const;

/// Convert between floating point types.
// PORT: the target type `T` is passed as its `FloatType` dictionary (`x.convert(Single, loses_info)`).
export interface FloatConvert {
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:614 convert_r
  /// Convert a value of one floating point type to another.
  /// The return value corresponds to the IEEE754 exceptions. *loses_info
  /// records whether the transformation lost information, i.e. whether
  /// converting the result back to the original type will produce the
  /// original value (this is almost the same as return value==Status::OK,
  /// but there are edge cases where this is not so).
  convert_r<T extends Float<T>>(T: FloatType<T>, round: Round, loses_info: MutRef<boolean>): StatusAnd<T>;

  convert<T extends Float<T>>(T: FloatType<T>, loses_info: MutRef<boolean>): StatusAnd<T>; // (provided)
}

export const FloatConvert_provided = {
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:617 convert
  /// Convert with default [`NearestTiesToEven`](Round::NearestTiesToEven) rounding.
  convert<T extends Float<T>>(this: FloatConvert, T: FloatType<T>, loses_info: MutRef<boolean>): StatusAnd<T> {
    return this.convert_r(T, Round.NearestTiesToEven, loses_info);
  },
};

// macro_rules! float_common_impls: the impls it expands to for a float type, installed by the type
// (`ieee.rs` `float_common_impls!(IeeeFloat<S>)`).
export const float_common_impls = {
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:629 default
  /** `impl Default` */
  default<F extends Float<F>>(Self: FloatType<F>): F {
    return Self.ZERO;
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:640 from_str
  /** `impl FromStr` */
  from_str<F extends Float<F>>(Self: FloatType<F>, s: string): Result<F, ParseError> {
    const r = Self.from_str_r(s, Round.NearestTiesToEven);
    return r.$ === "Ok" ? { $: "Ok", _0: r._0.value } : r;
  },

  // Rounding ties to the nearest even, by default.

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:653 add
  add<F extends Float<F>>(this: F, rhs: F): StatusAnd<F> {
    return this.add_r(rhs, Round.NearestTiesToEven);
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:664 sub
  sub<F extends Float<F>>(this: F, rhs: F): StatusAnd<F> {
    return this.sub_r(rhs, Round.NearestTiesToEven);
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:675 mul
  mul<F extends Float<F>>(this: F, rhs: F): StatusAnd<F> {
    return this.mul_r(rhs, Round.NearestTiesToEven);
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:686 div
  div<F extends Float<F>>(this: F, rhs: F): StatusAnd<F> {
    return this.div_r(rhs, Round.NearestTiesToEven);
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:697 rem
  rem<F extends Float<F>>(this: F, rhs: F): StatusAnd<F> {
    return this.c_fmod(rhs);
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:707 add_assign
  // PORT: `*self = ..` returns the new value.
  add_assign<F extends Float<F>>(this: F, rhs: F): F {
    return this.add(rhs).value;
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:717 sub_assign
  sub_assign<F extends Float<F>>(this: F, rhs: F): F {
    return this.sub(rhs).value;
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:727 mul_assign
  mul_assign<F extends Float<F>>(this: F, rhs: F): F {
    return this.mul(rhs).value;
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:737 div_assign
  div_assign<F extends Float<F>>(this: F, rhs: F): F {
    return this.div(rhs).value;
  },

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/lib.rs:747 rem_assign
  rem_assign<F extends Float<F>>(this: F, rhs: F): F {
    return this.rem(rhs).value;
  },
};

/** The instance-side names of `float_common_impls`. */
export const FLOAT_COMMON_METHODS = [
  "add",
  "sub",
  "mul",
  "div",
  "rem",
  "add_assign",
  "sub_assign",
  "mul_assign",
  "div_assign",
  "rem_assign",
] as const;

// pub mod ieee;
// pub mod ppc;
