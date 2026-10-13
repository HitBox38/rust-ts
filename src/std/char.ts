// `char` is a number holding a Unicode scalar value.
import { assert } from "./panic.ts";
import * as conversions from "./unicode/conversions.ts";
import { in_table } from "./unicode/mod.ts";
import { ALPHABETIC, CASE_IGNORABLE, LOWERCASE, LT, N, UPPERCASE, WHITE_SPACE } from "./unicode/tables.ts";

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

// std: library/core/src/char/methods.rs:798 is_alphabetic
/// Returns `true` if this `char` has the `Alphabetic` property.
export function is_alphabetic(c: number): boolean {
  if ((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a)) return true; // 'a'..='z' | 'A'..='Z'
  if (c <= 0xa9) return false; // '\0'..='\u{A9}'
  return in_table(ALPHABETIC, c); // unicode::Alphabetic
}

// std: library/core/src/char/methods.rs:829 is_cased
/// Returns `true` if this `char` has the `Cased` property.
/// A character is cased if and only if it is uppercase, lowercase, or titlecase.
export function is_cased(c: number): boolean {
  if ((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a)) return true; // 'a'..='z' | 'A'..='Z'
  if (c <= 0xa9) return false; // '\0'..='\u{A9}'
  return in_table(LOWERCASE, c) || in_table(UPPERCASE, c) || in_table(LT, c); // unicode::Lowercase || Uppercase || Lt
}

// std: library/core/src/char/methods.rs:904 is_lowercase
/// Returns `true` if this `char` has the `Lowercase` property.
export function is_lowercase(c: number): boolean {
  if (c >= 0x61 && c <= 0x7a) return true; // 'a'..='z'
  if (c <= 0xa9) return false; // '\0'..='\u{A9}'
  return in_table(LOWERCASE, c); // unicode::Lowercase
}

// std: library/core/src/char/methods.rs:939 is_titlecase
/// Returns `true` if this `char` is in the general category for titlecase letters.
export function is_titlecase(c: number): boolean {
  if (c <= 0x01c4) return false; // '\0'..='\u{01C4}'
  return in_table(LT, c); // unicode::Lt
}

// std: library/core/src/char/methods.rs:980 is_uppercase
/// Returns `true` if this `char` has the `Uppercase` property.
export function is_uppercase(c: number): boolean {
  if (c >= 0x41 && c <= 0x5a) return true; // 'A'..='Z'
  if (c <= 0xbf) return false; // '\0'..='\u{BF}'
  return in_table(UPPERCASE, c); // unicode::Uppercase
}

// std: library/core/src/char/methods.rs:1024 is_numeric
/// Returns `true` if this `char` has one of the general categories for numbers (`Nd`, `Nl`, `No`).
export function is_numeric(c: number): boolean {
  if (c >= 0x30 && c <= 0x39) return true; // '0'..='9'
  if (c <= 0xb1) return false; // '\0'..='\u{B1}'
  return in_table(N, c); // unicode::N
}

// std: library/core/src/char/methods.rs:1054 is_alphanumeric
/// Returns `true` if this `char` satisfies either `is_alphabetic()` or `is_numeric()`.
export function is_alphanumeric(c: number): boolean {
  // 'a'..='z' | 'A'..='Z' | '0'..='9'
  if ((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39)) return true;
  if (c <= 0xa9) return false; // '\0'..='\u{A9}'
  return in_table(ALPHABETIC, c) || in_table(N, c); // unicode::Alphabetic || unicode::N
}

// std: library/core/src/char/methods.rs:1088 is_whitespace
/// Returns `true` if this `char` has the `White_Space` property.
export function is_whitespace(c: number): boolean {
  if (c === 0x20 || (c >= 0x09 && c <= 0x0d)) return true; // ' ' | '\x09'..='\x0d'
  if (c <= 0x84) return false; // '\0'..='\u{84}'
  return in_table(WHITE_SPACE, c); // unicode::White_Space
}

// std: library/core/src/char/methods.rs:1121 is_control
/// Returns `true` if this `char` has the general category for control codes.
export function is_control(c: number): boolean {
  // According to
  // https://www.unicode.org/policies/stability_policy.html#Property_Value,
  // the set of codepoints in `Cc` will never change.
  // So we can just hard-code the patterns to match against instead of using a table.
  return c <= 0x1f || (c >= 0x7f && c <= 0x9f); // '\0'..='\x1f' | '\x7f'..='\u{9f}'
}

// std: library/core/src/char/methods.rs:1300 is_case_ignorable
/// Returns `true` if this `char` has the `Case_Ignorable` property.
export function is_case_ignorable(c: number): boolean {
  if (is_ascii(c)) {
    // '\'' | '.' | ':' | '^' | '`'
    return c === 0x27 || c === 0x2e || c === 0x3a || c === 0x5e || c === 0x60;
  } else {
    return in_table(CASE_IGNORABLE, c); // unicode::Case_Ignorable
  }
}

// std: library/core/src/char/methods.rs:1425 to_lowercase
/// Returns an iterator that yields the lowercase mapping of this `char` as one or more `char`s.
/// PORT: the `ToLowercase` iterator is returned as the array of the chars it yields
/// (`CaseMappingIter::new` drops the trailing '\0' padding).
export function to_lowercase(c: number): number[] {
  return case_mapping_iter_new(conversions.to_lower(c));
}

// std: library/core/src/char/methods.rs:1714 to_uppercase
/// Returns an iterator that yields the uppercase mapping of this `char` as one or more `char`s.
/// PORT: the `ToUppercase` iterator is returned as the array of the chars it yields.
export function to_uppercase(c: number): number[] {
  return case_mapping_iter_new(conversions.to_upper(c));
}

// std: library/core/src/char/mod.rs:542 CaseMappingIter::new
function case_mapping_iter_new(chars: conversions.CaseMapping): number[] {
  if (chars[2] === 0) {
    if (chars[1] === 0) {
      // Deliberately don't check `chars[0]`,
      // as '\0' lowercases to itself
      return [chars[0]];
    }
    return [chars[0], chars[1]];
  }
  return [chars[0], chars[1], chars[2]];
}
