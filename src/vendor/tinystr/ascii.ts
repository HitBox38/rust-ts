// Port of tinystr 0.8.4 `src/ascii.rs` (the subset unic-langid-impl uses, plus the `is_ascii_*` /
// `to_ascii_*` families that the crate's tests exercise). Not ported: `EMPTY`, `from_utf8_lossy`,
// `from_utf16_lossy`, `try_from_raw`, `new_unsigned_decimal`, `resize`, `concat`, `Borrow<str>`,
// `PartialEq<String>` (both directions); see docs/handoff/langid-plural.md.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: `TinyAsciiStr<const N: usize>` is a class over a `Uint8Array` of length `N` (the
// `[AsciiByte; N]` field); the const generic `N` is `bytes.length`, and associated functions that
// need `N` without a `self` take it as their first parameter. The type is `Copy`: methods taking
// `self` by value never mutate the receiver (they work on a copy).
import { is_ascii_alphabetic, is_ascii_alphanumeric, is_ascii_digit } from "../../std/char.ts";
import { debug_str, type Debug, type Fmt } from "../../std/fmt.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import { AsciiByte, u8_is_ascii_lowercase, u8_is_ascii_uppercase } from "./asciibyte.ts";
import type { ParseError } from "./error.ts";
import { Aligned4, Aligned8 } from "./int_ops.ts";

/// A tiny string that is from 1 to N bytes long.
///
/// This can be useful for small strings that would otherwise be stored as
/// `String` or `&str`. It is stored as a fixed-size `[AsciiByte; N]` array,
/// so it is `Copy` and does not need a heap allocation.
// #[repr(transparent)] #[derive(PartialEq, Eq, Ord, PartialOrd, Copy, Clone, Hash)]
export class TinyAsciiStr {
  constructor(public bytes: Uint8Array /* [AsciiByte; N] */) {}

  /** The const generic parameter `N`. */
  get N(): number {
    return this.bytes.length;
  }

  // Not ported: `pub const EMPTY: Self` (ascii.rs:23), unused by unic-langid-impl.

  // crate: tinystr-0.8.4/src/ascii.rs:28 try_from_str
  static try_from_str(N: number, s: string): Result<TinyAsciiStr, ParseError> {
    return TinyAsciiStr.try_from_utf8(N, utf8(s));
  }

  /// Creates a `TinyAsciiStr<N>` from the given UTF-8 slice.
  /// `code_units` may contain at most `N` non-null ASCII code points.
  // crate: tinystr-0.8.4/src/ascii.rs:35 try_from_utf8
  static try_from_utf8(N: number, code_units: Uint8Array): Result<TinyAsciiStr, ParseError> {
    return TinyAsciiStr.try_from_utf8_inner(N, code_units, false);
  }

  /// Creates a `TinyAsciiStr<N>` from the given UTF-16 slice.
  /// `code_units` may contain at most `N` non-null ASCII code points.
  // crate: tinystr-0.8.4/src/ascii.rs:42 try_from_utf16
  static try_from_utf16(N: number, code_units: Uint16Array | readonly number[]): Result<TinyAsciiStr, ParseError> {
    return TinyAsciiStr.try_from_utf16_inner(N, code_units, 0, code_units.length, false);
  }

  // crate-skip: tinystr-0.8.4/src/ascii.rs:57 from_utf8_lossy unused by unic-langid-impl
  // crate-skip: tinystr-0.8.4/src/ascii.rs:100 from_utf16_lossy unused by unic-langid-impl
  // crate-skip: tinystr-0.8.4/src/ascii.rs:152 try_from_raw unused by unic-langid-impl

  // crate: tinystr-0.8.4/src/ascii.rs:156 try_from_utf8_inner
  static try_from_utf8_inner(N: number, code_units: Uint8Array, allow_trailing_null: boolean): Result<TinyAsciiStr, ParseError> {
    if (code_units.length > N) {
      return Err({
        $: "TooLong",
        max: N,
        len: code_units.length,
      });
    }

    const out = new Uint8Array(N);
    let i = 0;
    let found_null = false;
    // Indexing is protected by TinyStrError::TooLarge
    while (i < code_units.length) {
      const b = code_units[i]!;

      if (b === 0) {
        found_null = true;
      } else if (b >= 0x80) {
        return Err({ $: "NonAscii" });
      } else if (found_null) {
        // Error if there are contentful bytes after null
        return Err({ $: "ContainsNull" });
      }
      out[i] = b;

      i += 1;
    }

    if (!allow_trailing_null && found_null) {
      // We found some trailing nulls, error
      return Err({ $: "ContainsNull" });
    }

    return Ok(
      new TinyAsciiStr(
        // SAFETY: `out` only contains ASCII bytes and has same size as `self.bytes`
        AsciiByte.to_ascii_byte_array(out),
      ),
    );
  }

  // crate: tinystr-0.8.4/src/ascii.rs:199 try_from_utf16_inner
  static try_from_utf16_inner(
    N: number,
    code_units: Uint16Array | readonly number[],
    start: number,
    end: number,
    allow_trailing_null: boolean,
  ): Result<TinyAsciiStr, ParseError> {
    const len = end - start;
    if (len > N) {
      return Err({ $: "TooLong", max: N, len });
    }

    const out = new Uint8Array(N);
    let i = 0;
    let found_null = false;
    // Indexing is protected by TinyStrError::TooLarge
    while (i < len) {
      const b = code_units[start + i]!;

      if (b === 0) {
        found_null = true;
      } else if (b >= 0x80) {
        return Err({ $: "NonAscii" });
      } else if (found_null) {
        // Error if there are contentful bytes after null
        return Err({ $: "ContainsNull" });
      }
      out[i] = b;

      i += 1;
    }

    if (!allow_trailing_null && found_null) {
      // We found some trailing nulls, error
      return Err({ $: "ContainsNull" });
    }

    return Ok(
      new TinyAsciiStr(
        // SAFETY: `out` only contains ASCII bytes and has same size as `self.bytes`
        AsciiByte.to_ascii_byte_array(out),
      ),
    );
  }

  // crate-skip: tinystr-0.8.4/src/ascii.rs:283 new_unsigned_decimal unused by unic-langid-impl

  // crate: tinystr-0.8.4/src/ascii.rs:306 as_str
  as_str(): string {
    // as_utf8 is valid utf8
    return String.fromCharCode(...this.as_utf8());
  }

  // crate: tinystr-0.8.4/src/ascii.rs:313 len
  len(): number {
    const N = this.N;
    if (N <= 4) {
      return Aligned4.from_ascii_bytes(this.bytes).len();
    } else if (N <= 8) {
      return Aligned8.from_ascii_bytes(this.bytes).len();
    } else {
      let i = 0;
      while (i < N && this.bytes[i]! !== AsciiByte.B0) {
        i += 1;
      }
      return i;
    }
  }

  // crate: tinystr-0.8.4/src/ascii.rs:330 is_empty
  is_empty(): boolean {
    return this.bytes[0]! === AsciiByte.B0;
  }

  // crate: tinystr-0.8.4/src/ascii.rs:336 as_utf8
  as_utf8(): Uint8Array {
    // Safe because `self.bytes.as_slice()` pointer-casts to `&[u8]`,
    // and changing the length of that slice to self.len() < N is safe.
    return this.bytes.subarray(0, this.len());
  }

  // crate: tinystr-0.8.4/src/ascii.rs:346 all_bytes
  all_bytes(): Uint8Array /* &[u8; N] */ {
    // SAFETY: `self.bytes` has same size as [u8; N]
    return this.bytes;
  }

  /// Resizes a `TinyAsciiStr<N>` to a `TinyAsciiStr<M>`.
  ///
  /// If `M < len()` the string gets truncated, otherwise only the
  /// memory representation changes.
  // (added by the icu-list lane: icu_locale_core uses it)
  // crate: tinystr-0.8.4/src/ascii.rs:357 resize
  resize(M: number): TinyAsciiStr {
    const N = this.bytes.length;
    const bytes = new Uint8Array(M);
    let i = 0;
    // Indexing is protected by the loop guard
    while (i < M && i < N) {
      bytes[i] = this.bytes[i]!;
      i += 1;
    }
    // `self.bytes` only contains ASCII bytes, with no null bytes between
    // ASCII characters, so this also holds for `bytes`.
    return TinyAsciiStr.from_utf8_unchecked(bytes);
  }

  /// Returns a `TinyAsciiStr<Q>` with the concatenation of this string,
  /// `TinyAsciiStr<N>`, and another string, `TinyAsciiStr<M>`.
  ///
  /// If `Q < N + M`, the string gets truncated.
  // (added by the icu-list lane: icu_locale_core uses it)
  // crate: tinystr-0.8.4/src/ascii.rs:397 concat
  concat(other: TinyAsciiStr, Q: number): TinyAsciiStr {
    const M = other.bytes.length;
    const result = this.resize(Q);
    let i = this.len();
    let j = 0;
    // Indexing is protected by the loop guard
    while (i < Q && j < M) {
      result.bytes[i] = other.bytes[j]!;
      i += 1;
      j += 1;
    }
    return result;
  }

  /// # Safety
  /// Must be called with a bytes array made of valid ASCII bytes, with no null bytes
  /// between ASCII characters
  // crate: tinystr-0.8.4/src/ascii.rs:418 from_utf8_unchecked
  static from_utf8_unchecked(code_units: Uint8Array /* [u8; N] */): TinyAsciiStr {
    return new TinyAsciiStr(AsciiByte.to_ascii_byte_array(code_units));
  }

  /// Checks if the value is composed of ASCII alphabetic characters:
  ///
  ///  * U+0041 'A' ..= U+005A 'Z', or
  ///  * U+0061 'a' ..= U+007A 'z'.
  // crate: tinystr-0.8.4/src/ascii.rs:503 is_ascii_alphabetic
  is_ascii_alphabetic(): boolean {
    return check_is(this, "is_ascii_alphabetic", is_ascii_alphabetic);
  }

  /// Checks if the value is composed of ASCII alphanumeric characters:
  ///
  ///  * U+0041 'A' ..= U+005A 'Z', or
  ///  * U+0061 'a' ..= U+007A 'z', or
  ///  * U+0030 '0' ..= U+0039 '9'.
  // crate: tinystr-0.8.4/src/ascii.rs:526 is_ascii_alphanumeric
  is_ascii_alphanumeric(): boolean {
    return check_is(this, "is_ascii_alphanumeric", is_ascii_alphanumeric);
  }

  /// Checks if the value is composed of ASCII decimal digits:
  ///
  ///  * U+0030 '0' ..= U+0039 '9'.
  // crate: tinystr-0.8.4/src/ascii.rs:547 is_ascii_numeric
  is_ascii_numeric(): boolean {
    return check_is(this, "is_ascii_numeric", is_ascii_digit);
  }

  /// Checks if the value is in ASCII lower case.
  ///
  /// All letter characters are checked for case. Non-letter characters are ignored.
  // crate: tinystr-0.8.4/src/ascii.rs:570 is_ascii_lowercase
  is_ascii_lowercase(): boolean {
    return check_is_not(this, "is_ascii_lowercase", u8_is_ascii_uppercase, u8_is_ascii_uppercase);
  }

  /// Checks if the value is in ASCII title case.
  ///
  /// This verifies that the first character is ASCII uppercase and all others ASCII lowercase.
  /// Non-letter characters are ignored.
  // crate: tinystr-0.8.4/src/ascii.rs:599 is_ascii_titlecase
  is_ascii_titlecase(): boolean {
    return check_is_not(this, "is_ascii_titlecase", u8_is_ascii_lowercase, u8_is_ascii_uppercase);
  }

  /// Checks if the value is in ASCII upper case.
  ///
  /// All letter characters are checked for case. Non-letter characters are ignored.
  // crate: tinystr-0.8.4/src/ascii.rs:627 is_ascii_uppercase
  is_ascii_uppercase(): boolean {
    return check_is_not(this, "is_ascii_uppercase", u8_is_ascii_lowercase, u8_is_ascii_lowercase);
  }

  /// Checks if the value is composed of ASCII alphabetic lower case characters:
  ///
  ///  * U+0061 'a' ..= U+007A 'z',
  // crate: tinystr-0.8.4/src/ascii.rs:659 is_ascii_alphabetic_lowercase
  is_ascii_alphabetic_lowercase(): boolean {
    return check_is_both(this, "is_ascii_alphabetic_lowercase", u8_is_ascii_lowercase, u8_is_ascii_lowercase);
  }

  /// Checks if the value is composed of ASCII alphabetic, with the first character being ASCII uppercase, and all others ASCII lowercase.
  // crate: tinystr-0.8.4/src/ascii.rs:689 is_ascii_alphabetic_titlecase
  is_ascii_alphabetic_titlecase(): boolean {
    return check_is_both(this, "is_ascii_alphabetic_titlecase", u8_is_ascii_uppercase, u8_is_ascii_lowercase);
  }

  /// Checks if the value is composed of ASCII alphabetic upper case characters:
  ///
  ///  * U+0041 'A' ..= U+005A 'Z',
  // crate: tinystr-0.8.4/src/ascii.rs:721 is_ascii_alphabetic_uppercase
  is_ascii_alphabetic_uppercase(): boolean {
    return check_is_both(this, "is_ascii_alphabetic_uppercase", u8_is_ascii_uppercase, u8_is_ascii_uppercase);
  }

  /// Converts this type to its ASCII lower case equivalent in-place.
  ///
  /// ASCII letters 'A' to 'Z' are mapped to 'a' to 'z', other characters are unchanged.
  // crate: tinystr-0.8.4/src/ascii.rs:779 to_ascii_lowercase
  to_ascii_lowercase(): TinyAsciiStr {
    return to(new TinyAsciiStr(this.bytes.slice()), "to_ascii_lowercase", AsciiByte.to_ascii_lowercase);
  }

  /// Converts this type to its ASCII title case equivalent in-place.
  ///
  /// The first character is converted to ASCII uppercase; the remaining characters
  /// are converted to ASCII lowercase.
  // crate: tinystr-0.8.4/src/ascii.rs:799 to_ascii_titlecase
  to_ascii_titlecase(): TinyAsciiStr {
    return to(new TinyAsciiStr(this.bytes.slice()), "to_ascii_titlecase", AsciiByte.to_ascii_lowercase, AsciiByte.to_ascii_uppercase);
  }

  /// Converts this type to its ASCII upper case equivalent in-place.
  ///
  /// ASCII letters 'a' to 'z' are mapped to 'A' to 'Z', other characters are unchanged.
  // crate: tinystr-0.8.4/src/ascii.rs:823 to_ascii_uppercase
  to_ascii_uppercase(): TinyAsciiStr {
    return to(new TinyAsciiStr(this.bytes.slice()), "to_ascii_uppercase", AsciiByte.to_ascii_uppercase);
  }

  // crate: tinystr-0.8.4/src/ascii.rs:843 deref
  deref(): string {
    return this.as_str();
  }

  // crate-skip: tinystr-0.8.4/src/ascii.rs:850 borrow same as `deref`; unused by unic-langid-impl

  // crate: tinystr-0.8.4/src/ascii.rs:858 from_str
  static from_str(N: number, s: string): Result<TinyAsciiStr, ParseError> {
    return TinyAsciiStr.try_from_str(N, s);
  }

  // crate: tinystr-0.8.4/src/ascii.rs:864 eq
  /** `impl PartialEq<str>` */
  eq_str(other: string): boolean {
    return this.deref() === other;
  }

  // crate-skip: tinystr-0.8.4/src/ascii.rs:877 eq PartialEq<String>: a JS string is `eq_str`
  // crate-skip: tinystr-0.8.4/src/ascii.rs:884 eq PartialEq<TinyAsciiStr<N>> for String: `eq_str`

  /** `#[derive(PartialEq)]` */
  eq(other: TinyAsciiStr): boolean {
    return this.cmp(other) === 0;
  }

  /** `#[derive(Ord)]`: lexicographic over `[AsciiByte; N]` (both sides have the same `N`). */
  cmp(other: TinyAsciiStr): -1 | 0 | 1 {
    const a = this.bytes;
    const b = other.bytes;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1;
    }
    return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
  }
}

// crate: tinystr-0.8.4/src/ascii.rs:870 eq
/** `impl PartialEq<&str>`: same as `PartialEq<str>`. */
export function TinyAsciiStr_eq_ref_str(self: TinyAsciiStr, other: string): boolean {
  return self.deref() === other;
}

type IntCheck =
  | "is_ascii_alphabetic"
  | "is_ascii_alphanumeric"
  | "is_ascii_numeric"
  | "is_ascii_lowercase"
  | "is_ascii_titlecase"
  | "is_ascii_uppercase"
  | "is_ascii_alphabetic_lowercase"
  | "is_ascii_alphabetic_titlecase"
  | "is_ascii_alphabetic_uppercase";

// PORT: `macro_rules! check_is`, first arm `($self, $check_int, $check_u8)`.
function check_is(self: TinyAsciiStr, check_int: IntCheck, check_u8: (b: number) => boolean): boolean {
  const N = self.N;
  if (N <= 4) {
    return Aligned4.from_ascii_bytes(self.bytes)[check_int]();
  } else if (N <= 8) {
    return Aligned8.from_ascii_bytes(self.bytes)[check_int]();
  } else {
    let i = 0;
    while (i < N && self.bytes[i]! !== AsciiByte.B0) {
      if (!check_u8(self.bytes[i]!)) {
        return false;
      }
      i += 1;
    }
    return true;
  }
}

// PORT: `macro_rules! check_is`, second arm `($self, $check_int, !$check_u8_0_inv, !$check_u8_1_inv)`.
function check_is_not(
  self: TinyAsciiStr,
  check_int: IntCheck,
  check_u8_0_inv: (b: number) => boolean,
  check_u8_1_inv: (b: number) => boolean,
): boolean {
  const N = self.N;
  if (N <= 4) {
    return Aligned4.from_ascii_bytes(self.bytes)[check_int]();
  } else if (N <= 8) {
    return Aligned8.from_ascii_bytes(self.bytes)[check_int]();
  } else {
    // Won't panic because N is > 8
    if (check_u8_0_inv(self.bytes[0]!)) {
      return false;
    }
    let i = 1;
    while (i < N && self.bytes[i]! !== AsciiByte.B0) {
      if (check_u8_1_inv(self.bytes[i]!)) {
        return false;
      }
      i += 1;
    }
    return true;
  }
}

// PORT: `macro_rules! check_is`, third arm `($self, $check_int, $check_u8_0_inv, $check_u8_1_inv)`.
function check_is_both(
  self: TinyAsciiStr,
  check_int: IntCheck,
  check_u8_0_inv: (b: number) => boolean,
  check_u8_1_inv: (b: number) => boolean,
): boolean {
  const N = self.N;
  if (N <= 4) {
    return Aligned4.from_ascii_bytes(self.bytes)[check_int]();
  } else if (N <= 8) {
    return Aligned8.from_ascii_bytes(self.bytes)[check_int]();
  } else {
    // Won't panic because N is > 8
    if (!check_u8_0_inv(self.bytes[0]!)) {
      return false;
    }
    let i = 1;
    while (i < N && self.bytes[i]! !== AsciiByte.B0) {
      if (!check_u8_1_inv(self.bytes[i]!)) {
        return false;
      }
      i += 1;
    }
    return true;
  }
}

// PORT: `macro_rules! to` (`$self` is the by-value copy, mutated and returned).
function to(
  self: TinyAsciiStr,
  to_: "to_ascii_lowercase" | "to_ascii_titlecase" | "to_ascii_uppercase",
  later_char_to: (b: AsciiByte) => AsciiByte,
  first_char_to?: (b: AsciiByte) => AsciiByte,
): TinyAsciiStr {
  const N = self.N;
  let i = 0;
  if (N <= 4) {
    const aligned = Aligned4.from_ascii_bytes(self.bytes)[to_]();
    // Won't panic because self.bytes has length N and aligned has length >= N
    while (i < N) {
      self.bytes[i] = aligned[i]!;
      i += 1;
    }
  } else if (N <= 8) {
    const aligned = Aligned8.from_ascii_bytes(self.bytes)[to_]();
    // Won't panic because self.bytes has length N and aligned has length >= N
    while (i < N) {
      self.bytes[i] = aligned[i]!;
      i += 1;
    }
  } else {
    while (i < N && self.bytes[i]! !== AsciiByte.B0) {
      self.bytes[i] = later_char_to(self.bytes[i]!);
      i += 1;
    }
    if (first_char_to !== undefined) {
      self.bytes[0] = first_char_to(self.bytes[0]!);
    }
  }
  return self;
}

// crate: tinystr-0.8.4/src/ascii.rs:829 fmt
/** `impl fmt::Debug for TinyAsciiStr<N>` */
export const debug_TinyAsciiStr: Debug<TinyAsciiStr> = (v: TinyAsciiStr, _f: Fmt) => debug_str(v.as_str());

// crate: tinystr-0.8.4/src/ascii.rs:835 fmt
/** `impl fmt::Display for TinyAsciiStr<N>` */
export function display_TinyAsciiStr(self: TinyAsciiStr): string {
  return self.as_str();
}
