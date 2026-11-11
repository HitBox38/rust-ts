// Port of the integer parsing of library/core/src/num/mod.rs (`from_str_int_impl!`) that rust-ts uses: `<uN as
// FromStr>::from_str`, which is `from_str_radix(src, 10)` -> `from_ascii_bytes_radix_impl(src.as_bytes(), 10)`.
// Moved here from lane driver-cli's local copies (docs/reviews/driver-cli.md N4).
// PORT: only the unsigned types and radix 10, over a JS string: a UTF-16 code unit outside ASCII is never a digit, as no
// byte of a multi-byte UTF-8 char is. Types up to `u32` parse into an exact `number`, `u64` into a `bigint`; `usize` (the
// 64-bit hosts the oracle runs on) parses as `u64` and is then a `number` (see `usize_from_str`). The `u8`, `u64`,
// `usize` and `NonZero` parsers moved here from rustc_session options.ts (docs/reviews/driver-cli-2.md N4).
import { Err, Ok, type Result } from "./result.ts";

/** `core::num::IntErrorKind` (library/core/src/num/error.rs) */
export type IntErrorKind = "Empty" | "InvalidDigit" | "PosOverflow" | "NegOverflow" | "Zero";

/** `core::num::ParseIntError` (library/core/src/num/error.rs) */
export interface ParseIntError {
  kind: IntErrorKind;
}

/** `impl Display for ParseIntError`. PORT: `IntErrorKind::NotAPowerOfTwo` (unstable, made only by `Alignment`'s
 *  conversions, never by `from_str`) is not modelled. */
// std: library/core/src/num/error.rs:138 fmt
export function display_ParseIntError(e: ParseIntError): string {
  switch (e.kind) {
    case "Empty":
      return "cannot parse integer from empty string";
    case "InvalidDigit":
      return "invalid digit found in string";
    case "PosOverflow":
      return "number too large to fit in target type";
    case "NegOverflow":
      return "number too small to fit in target type";
    case "Zero":
      return "number would be zero for non-zero type";
  }
}

/** `from_ascii_bytes_radix_impl` for an unsigned type with maximum `max` (at most `u32::MAX`), radix 10. */
// PORT: one checked loop: `can_not_overflow`'s unchecked loop is a speed path with the same result.
// std: library/core/src/num/mod.rs:1788 from_ascii_bytes_radix_impl
function from_ascii_bytes_radix_impl_unsigned(src: string, max: number): Result<number, ParseIntError> {
  if (src.length === 0) {
    return Err({ kind: "Empty" });
  }
  // `is_signed_ty` is false: a leading `-` is a digit, so it is invalid.
  let digits: string;
  if (src === "+" || src === "-") {
    return Err({ kind: "InvalidDigit" });
  } else if (src.charCodeAt(0) === 0x2b /* + */) {
    digits = src.slice(1);
  } else {
    digits = src;
  }
  let result = 0;
  for (let i = 0; i < digits.length; i++) {
    const mul = result * 10;
    const c = digits.charCodeAt(i);
    // `(*c as char).to_digit(10)`
    if (c < 0x30 || c > 0x39) return Err({ kind: "InvalidDigit" });
    if (mul > max) return Err({ kind: "PosOverflow" });
    result = mul + (c - 0x30);
    if (result > max) return Err({ kind: "PosOverflow" });
  }
  return Ok(result);
}

/** `from_ascii_bytes_radix_impl` for `u64` (maximum `u64::MAX`), radix 10, over `bigint`. */
// PORT: as `from_ascii_bytes_radix_impl_unsigned`, in `bigint` so every `u64` is exact.
// std: library/core/src/num/mod.rs:1788 from_ascii_bytes_radix_impl
function from_ascii_bytes_radix_impl_u64(src: string): Result<bigint, ParseIntError> {
  if (src.length === 0) {
    return Err({ kind: "Empty" });
  }
  let digits: string;
  if (src === "+" || src === "-") {
    return Err({ kind: "InvalidDigit" });
  } else if (src.charCodeAt(0) === 0x2b /* + */) {
    digits = src.slice(1);
  } else {
    digits = src;
  }
  const max = 0xffff_ffff_ffff_ffffn;
  let result = 0n;
  for (let i = 0; i < digits.length; i++) {
    const mul = result * 10n;
    const c = digits.charCodeAt(i);
    if (c < 0x30 || c > 0x39) return Err({ kind: "InvalidDigit" });
    if (mul > max) return Err({ kind: "PosOverflow" });
    result = mul + BigInt(c - 0x30);
    if (result > max) return Err({ kind: "PosOverflow" });
  }
  return Ok(result);
}

/** `<u8 as FromStr>::from_str` */
// std: library/core/src/num/mod.rs:1645 from_str
export function u8_from_str(src: string): Result<number, ParseIntError> {
  return from_ascii_bytes_radix_impl_unsigned(src, 0xff);
}

/** `<u16 as FromStr>::from_str` */
// std: library/core/src/num/mod.rs:1645 from_str
export function u16_from_str(src: string): Result<number, ParseIntError> {
  return from_ascii_bytes_radix_impl_unsigned(src, 0xffff);
}

/** `<u32 as FromStr>::from_str` */
// std: library/core/src/num/mod.rs:1645 from_str
export function u32_from_str(src: string): Result<number, ParseIntError> {
  return from_ascii_bytes_radix_impl_unsigned(src, 0xffff_ffff);
}

/** `<u64 as FromStr>::from_str`. PORT: a `u64` is a `bigint`, exact. */
// std: library/core/src/num/mod.rs:1645 from_str
export function u64_from_str(src: string): Result<bigint, ParseIntError> {
  return from_ascii_bytes_radix_impl_u64(src);
}

/**
 * `<usize as FromStr>::from_str` on a 64-bit host. PORT: the callers keep a `usize` (a count, threshold or limit) in a
 * `number`: every string `u64` accepts is accepted, with the same errors, and a value above 2^53 is rounded to the
 * nearest double.
 */
// std: library/core/src/num/mod.rs:1645 from_str
export function usize_from_str(src: string): Result<number, ParseIntError> {
  const r = from_ascii_bytes_radix_impl_u64(src);
  return r.$ === "Err" ? r : Ok(Number(r._0));
}

/** `<NonZero<u32> as FromStr>::from_str`: `u32`'s parse, then `Zero` for 0 (`NonZero::from_ascii_bytes_radix_impl`). */
// std: library/core/src/num/nonzero.rs:1612 from_str
export function nonzero_u32_from_str(src: string): Result<number, ParseIntError> {
  const r = u32_from_str(src);
  if (r.$ === "Err") return r;
  return r._0 === 0 ? Err({ kind: "Zero" }) : r;
}

/** `<NonZero<usize> as FromStr>::from_str`: `usize`'s parse, then `Zero` for 0 (`NonZero::from_ascii_bytes_radix_impl`). */
// std: library/core/src/num/nonzero.rs:1612 from_str
export function nonzero_usize_from_str(src: string): Result<number, ParseIntError> {
  const r = usize_from_str(src);
  if (r.$ === "Err") return r;
  return r._0 === 0 ? Err({ kind: "Zero" }) : r;
}

/** `<NonZero<u64> as FromStr>::from_str`: `u64`'s parse, then `Zero` for 0 (`NonZero::from_ascii_bytes_radix_impl`). */
// std: library/core/src/num/nonzero.rs:1612 from_str
export function nonzero_u64_from_str(src: string): Result<bigint, ParseIntError> {
  const r = u64_from_str(src);
  if (r.$ === "Err") return r;
  return r._0 === 0n ? Err({ kind: "Zero" }) : r;
}
