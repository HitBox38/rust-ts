// Port of the integer parsing of library/core/src/num/mod.rs (`from_str_int_impl!`) that rust-ts uses: `<uN as
// FromStr>::from_str`, which is `from_str_radix(src, 10)` -> `from_ascii_bytes_radix_impl(src.as_bytes(), 10)`.
// Moved here from lane driver-cli's local copies (docs/reviews/driver-cli.md N4).
// PORT: only the unsigned types up to `u32` and radix 10, over a JS string: a UTF-16 code unit outside ASCII is never a
// digit, as no byte of a multi-byte UTF-8 char is. The values stay exact in a `number`.
import { Err, Ok, type Result } from "./result.ts";

/** `core::num::IntErrorKind` (library/core/src/num/error.rs) */
export type IntErrorKind = "Empty" | "InvalidDigit" | "PosOverflow" | "NegOverflow" | "Zero";

/** `core::num::ParseIntError` (library/core/src/num/error.rs) */
export interface ParseIntError {
  kind: IntErrorKind;
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
