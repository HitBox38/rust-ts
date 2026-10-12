// Port of intl_pluralrules 7.0.2 `src/operands.rs`.

//! Plural operands in compliance with [CLDR Plural Rules](https://unicode.org/reports/tr35/tr35-numbers.html#Language_Plural_Rules).
//!
//! See [full operands description](https://unicode.org/reports/tr35/tr35-numbers.html#Operands).
//!
//! # Examples
//!
//! From int
//!
//! ```
//! use std::convert::TryFrom;
//! use intl_pluralrules::operands::*;
//! assert_eq!(Ok(PluralOperands {
//!    n: 2_f64,
//!    i: 2,
//!    v: 0,
//!    w: 0,
//!    f: 0,
//!    t: 0,
//! }), PluralOperands::try_from(2))
//! ```
//!
//! From float
//!
//! ```
//! use std::convert::TryFrom;
//! use intl_pluralrules::operands::*;
//! assert_eq!(Ok(PluralOperands {
//!    n: 1234.567_f64,
//!    i: 1234,
//!    v: 3,
//!    w: 3,
//!    f: 567,
//!    t: 567,
//! }), PluralOperands::try_from("-1234.567"))
//! ```
//!
//! From &str
//!
//! ```
//! use std::convert::TryFrom;
//! use intl_pluralrules::operands::*;
//! assert_eq!(Ok(PluralOperands {
//!    n: 123.45_f64,
//!    i: 123,
//!    v: 2,
//!    w: 2,
//!    f: 45,
//!    t: 45,
//! }), PluralOperands::try_from(123.45))
//! ```
//
// PORT: the `u64` fields `i`, `f`, `t` are `bigint` (string input can carry up to 20 digits);
// `n: f64` and the `usize` fields `v`, `w` are `number`. The `TryFrom`/`From` impls are static
// functions on the `PluralOperands` companion: `try_from_str` (`&str`), `from_unsigned`
// (`impl_integer_type!(u8 u16 u32 u64 usize)`), `try_from_signed`
// (`impl_signed_integer_type!(i8 i16 i32 i64 isize)`) and `try_from_convert`
// (`impl_convert_type!(f32 f64 String)`, which goes through `ToString`: the caller passes the
// type's `to_string`, e.g. `<f64 as Display>`).
import { debug_f64, debug_struct, type Fmt } from "../../std/fmt.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { utf8_len } from "../../std/str.ts";

/// A full plural operands representation of a number. See [CLDR Plural Rules](https://unicode.org/reports/tr35/tr35-numbers.html#Language_Plural_Rules) for complete operands description.
// #[derive(Debug, PartialEq)]
export interface PluralOperands {
  /// Absolute value of input
  n: number;
  /// Integer value of input
  i: bigint;
  /// Number of visible fraction digits with trailing zeros
  v: number;
  /// Number of visible fraction digits without trailing zeros
  w: number;
  /// Visible fraction digits with trailing zeros
  f: bigint;
  /// Visible fraction digits without trailing zeros
  t: bigint;
}

const U64_MAX = 0xffff_ffff_ffff_ffffn;
const ISIZE_MIN = -(1n << 63n);
const ISIZE_MAX = (1n << 63n) - 1n;

export const PluralOperands = {
  // crate: intl_pluralrules-7.0.2/src/operands.rs:76 try_from
  /** `impl<'a> TryFrom<&'a str> for PluralOperands` */
  try_from_str(input: string): Result<PluralOperands, string> {
    const abs_str = input.startsWith("-") ? input.slice(1) : input;

    const absolute_value_r = f64_from_str(abs_str);
    if (absolute_value_r === undefined) return Err("Incorrect number passed!");
    const absolute_value = absolute_value_r;

    let integer_digits: bigint;
    let num_fraction_digits0: number;
    let num_fraction_digits: number;
    let fraction_digits0: bigint;
    let fraction_digits: bigint;

    const dec_pos = abs_str.indexOf(".");
    if (dec_pos !== -1) {
      // PORT: `find`/slicing are byte offsets upstream; `abs_str` parsed as an f64, so it is ASCII.
      const int_str = abs_str.slice(0, dec_pos);
      const dec_str = abs_str.slice(dec_pos + 1);

      const integer_digits_r = u64_from_str(int_str);
      if (integer_digits_r === undefined) return Err("Could not convert string to integer!");
      integer_digits = integer_digits_r;

      const backtrace = trim_end_matches_0(dec_str);

      num_fraction_digits0 = utf8_len(dec_str);
      num_fraction_digits = utf8_len(backtrace);
      const fraction_digits0_r = u64_from_str(dec_str);
      if (fraction_digits0_r === undefined) return Err("Could not convert string to integer!");
      fraction_digits0 = fraction_digits0_r;
      fraction_digits = u64_from_str(backtrace) ?? 0n;
    } else {
      integer_digits = f64_as_u64(absolute_value);
      num_fraction_digits0 = 0;
      num_fraction_digits = 0;
      fraction_digits0 = 0n;
      fraction_digits = 0n;
    }

    return Ok({
      n: absolute_value,
      i: integer_digits,
      v: num_fraction_digits0,
      w: num_fraction_digits,
      f: fraction_digits0,
      t: fraction_digits,
    });
  },

  // crate: intl_pluralrules-7.0.2/src/operands.rs:127 from
  /** `impl From<$ty> for PluralOperands` for `u8 u16 u32 u64 usize` (`input` in the type's range). */
  from_unsigned(input: number | bigint): PluralOperands {
    // XXXManishearth converting from u32 or u64 to isize may wrap
    return {
      n: Number(input), // `input as f64` (round to nearest, ties to even, as `Number(bigint)`)
      i: BigInt(input),
      v: 0,
      w: 0,
      f: 0n,
      t: 0n,
    };
  },

  // crate: intl_pluralrules-7.0.2/src/operands.rs:149 try_from
  /** `impl TryFrom<$ty> for PluralOperands` for `i8 i16 i32 i64 isize` (`input` in the type's range). */
  try_from_signed(input: number | bigint): Result<PluralOperands, string> {
    // XXXManishearth converting from i64 to isize may wrap
    const x = isize_checked_abs(BigInt(input)); // PORT: `(input as isize)`: 64-bit target, no wrap for i8..=i64
    if (x === undefined) return Err("Number too big");
    return Ok({
      n: Number(x),
      i: x,
      v: 0,
      w: 0,
      f: 0n,
      t: 0n,
    });
  },

  // crate: intl_pluralrules-7.0.2/src/operands.rs:172 try_from
  /** `impl TryFrom<$ty> for PluralOperands` for `f32 f64 String`; `to_string` is `$ty`'s `ToString`. */
  try_from_convert<T>(input: T, to_string: (v: T) => string): Result<PluralOperands, string> {
    const as_str: string = to_string(input);
    return PluralOperands.try_from_str(as_str);
  },
} as const;

/** `#[derive(Debug)]` */
export function debug_PluralOperands(self: PluralOperands, f: Fmt): string {
  return debug_struct(f, "PluralOperands", [
    ["n", debug_f64(self.n, f)],
    ["i", String(self.i)],
    ["v", String(self.v)],
    ["w", String(self.w)],
    ["f", String(self.f)],
    ["t", String(self.t)],
  ]);
}

/** `#[derive(PartialEq)]` (`n` compares as f64: NaN != NaN) */
export function PluralOperands_eq(a: PluralOperands, b: PluralOperands): boolean {
  return a.n === b.n && a.i === b.i && a.v === b.v && a.w === b.w && a.f === b.f && a.t === b.t;
}

// ---------------------------------------------------------------------------------------------
// PORT: std helpers used by operands.rs, not (yet) in src/std; see handoff. Each follows the
// pinned library/core source.
// ---------------------------------------------------------------------------------------------

/** `isize::checked_abs` (64-bit) */
function isize_checked_abs(x: bigint): bigint | undefined {
  if (x < ISIZE_MIN || x > ISIZE_MAX) throw new RangeError("isize out of range");
  if (x === ISIZE_MIN) return undefined;
  return x < 0n ? -x : x;
}

/** `str::trim_end_matches('0')` */
function trim_end_matches_0(s: string): string {
  let e = s.length;
  while (e > 0 && s.charCodeAt(e - 1) === 0x30) e--;
  return s.slice(0, e);
}

/** `f64 as u64` (saturating; NaN → 0) */
function f64_as_u64(v: number): bigint {
  if (Number.isNaN(v) || v <= 0) return 0n;
  if (v >= 18446744073709551616) return U64_MAX;
  return BigInt(Math.trunc(v));
}

/**
 * `<u64 as FromStr>::from_str` = `u64::from_str_radix(src, 10)` (library/core/src/num/mod.rs
 * `from_ascii_radix`): optional `+`, then one or more ASCII digits, value <= u64::MAX.
 * Returns undefined for any `ParseIntError` (callers only map the error to a fixed message).
 */
function u64_from_str(src: string): bigint | undefined {
  if (src.length === 0) return undefined; // Empty
  let digits = src;
  if (src === "+" || src === "-") return undefined; // InvalidDigit
  if (src.charCodeAt(0) === 0x2b /* '+' */) digits = src.slice(1);
  let result = 0n;
  for (let i = 0; i < digits.length; i++) {
    const c = digits.charCodeAt(i) - 0x30;
    if (c < 0 || c > 9) return undefined; // InvalidDigit
    result = result * 10n + BigInt(c);
    if (result > U64_MAX) return undefined; // PosOverflow
  }
  return result;
}

/**
 * `<f64 as FromStr>::from_str` = `core::num::imp::dec2flt::dec2flt` (library/core/src/num/imp/
 * dec2flt/mod.rs:211, parse.rs at the pin). The accepted grammar is ported exactly:
 *   [+-]? ( digits* ('.' digits*)? ([eE] [+-]? digits+)?   with at least one mantissa digit
 *         | "inf" | "infinity" | "nan" (ASCII case-insensitive) )
 * PORT: the value of an accepted decimal string is computed by JS `Number()`, which, like
 * dec2flt, rounds the exact decimal value to the nearest f64 (ties to even). Returns undefined for
 * any `ParseFloatError`.
 */
function f64_from_str(src: string): number | undefined {
  let s = src;
  if (s.length === 0) return undefined; // pfe_empty
  const c = s.charCodeAt(0);
  const negative = c === 0x2d; /* '-' */
  if (c === 0x2d || c === 0x2b /* '+' */) {
    s = s.slice(1);
  }
  if (s.length === 0) {
    return undefined; // pfe_invalid
  }

  if (!parse_number(s)) {
    const v = parse_inf_nan(s, negative);
    if (v !== undefined) return v;
    return undefined; // pfe_invalid
  }
  const v = Number(s);
  return negative ? -v : v;
}

/** `dec2flt::parse::parse_number` (grammar only): true iff `parse_partial_number` consumes all of `s`. */
function parse_number(s: string): boolean {
  const isDigit = (i: number) => i < s.length && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39;
  let i = 0;
  let n_digits = 0;
  while (isDigit(i)) {
    i++;
    n_digits++;
  }
  if (i < s.length && s[i] === ".") {
    i++;
    while (isDigit(i)) {
      i++;
      n_digits++;
    }
  }
  if (n_digits === 0) return false;
  if (i < s.length && (s[i] === "e" || s[i] === "E")) {
    i++;
    // parse_scientific
    if (i < s.length && (s[i] === "-" || s[i] === "+")) i++;
    if (!isDigit(i)) return false; // `parse_scientific(&mut s)?` → None
    while (isDigit(i)) i++;
  }
  return i === s.length;
}

/** `dec2flt::parse::parse_inf_nan` */
function parse_inf_nan(s: string, negative: boolean): number | undefined {
  // `register &= 0xDFDF..`: ASCII case folding of letters (other bytes cannot match).
  let float: number;
  const u = s.length === 3 || s.length === 8 ? fold(s) : undefined;
  if (u === "INF" || u === "INFINITY") float = Infinity;
  else if (u === "NAN") float = NaN;
  else return undefined;
  return negative ? -float : float;
}

/** `byte & 0xDF` for each byte (non-ASCII → no match). */
function fold(s: string): string | undefined {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const b = s.charCodeAt(i);
    if (b > 0x7f) return undefined;
    out += String.fromCharCode(b & 0xdf);
  }
  return out;
}
