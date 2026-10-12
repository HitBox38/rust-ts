// `char` is a number holding a Unicode scalar value.
import { assert } from "./panic.ts";

/** Character literal: `ch("a")` is `'a'`. */
export function ch(s: string): number {
  return s.codePointAt(0)!;
}

export function is_ascii(c: number): boolean {
  return c < 0x80;
}

export function is_ascii_digit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

export function is_ascii_hexdigit(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

export function is_ascii_alphabetic(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

export function is_ascii_alphanumeric(c: number): boolean {
  return is_ascii_alphabetic(c) || is_ascii_digit(c);
}

/** `char::len_utf8` */
export function len_utf8(c: number): number {
  return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
}

export function from_u32(n: number): number | undefined {
  return n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? undefined : n;
}

export function to_string(c: number): string {
  return String.fromCodePoint(c);
}

/// `char::to_digit(self, radix)` (library/core/src/char/methods.rs:409 at the pin).
export function to_digit(c: number, radix: number): number | undefined {
  assert(radix >= 2 && radix <= 36, "to_digit: invalid radix -- radix must be in the range 2 to 36 inclusive");
  // check radix to remove letter handling code when radix is a known constant
  const value =
    c > 0x39 /* '9' */ && radix > 10
      ? // mask to convert ASCII letters to uppercase (!0b0010_0000), wrapping u32 arithmetic
        (((c - 0x41) /* 'A' */ & ~0x20) >>> 0) + 10
      : // convert digit to value, non-digits wrap to values > 36
        (c - 0x30) /* '0' */ >>> 0;
  return value < radix ? value : undefined;
}

/// `char::is_whitespace` (Unicode `White_Space`; table checked against the pinned oracle).
export function is_whitespace(c: number): boolean {
  if (c === 0x20 || (c >= 0x09 && c <= 0x0d)) return true;
  if (c <= 0x7f) return false;
  return (
    c === 0x85 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}
