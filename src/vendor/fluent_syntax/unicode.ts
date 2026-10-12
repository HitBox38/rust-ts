//! A set of helper functions for unescaping Fluent unicode escape sequences.
//!
//! # Unicode
//!
//! Fluent supports UTF-8 in all FTL resources, but it also allows
//! unicode sequences to be escaped in [`String
//! Literals`](super::ast::InlineExpression::StringLiteral).
//!
//! Four byte sequences are encoded with `\u` and six byte
//! sequences using `\U`.
//! ## Example
//!
//! ```
//! use fluent_syntax::unicode::unescape_unicode_to_string;
//!
//! assert_eq!(
//!     unescape_unicode_to_string("Foo \\u5bd2 Bar"),
//!     "Foo 寒 Bar"
//! );
//!
//! assert_eq!(
//!     unescape_unicode_to_string("Foo \\U01F68A Bar"),
//!     "Foo 🚊 Bar"
//! );
//! ```
//!
//! # Other unescapes
//!
//! This also allows for a char `"` to be present inside an FTL string literal,
//! and for `\` itself to be escaped.
//!
//! ## Example
//!
//! ```
//! use fluent_syntax::unicode::unescape_unicode_to_string;
//!
//! assert_eq!(
//!     unescape_unicode_to_string("Foo \\\" Bar"),
//!     "Foo \" Bar"
//! );
//! assert_eq!(
//!     unescape_unicode_to_string("Foo \\\\ Bar"),
//!     "Foo \\ Bar"
//! );
//! ```
//
// Port of fluent-syntax-0.12.0/src/unicode.rs.
// PORT: the input `&str` is byte-indexed, so it is a `Str`; `&input[a..b]` panics off a char
// boundary as upstream, `input.get(a..b)` yields `undefined` there. `W: fmt::Write` → the `Write`
// interface below (the two methods used); `fmt::Result` → `Result<null, FmtError>`. The produced
// text is a JS `string`. `Cow<str>` → `string` (`Cow::Borrowed(input)` is `input.toString()`; the
// borrowed/owned distinction is not observable).

import { from_u32, to_digit } from "../../std/char.ts";
import { panic } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";
import type { Str } from "../../std/str.ts";

/** PORT: `std::fmt::Error` (unit struct). */
export type FmtError = "Error";

/** PORT: the subset of `std::fmt::Write` used by this module. */
export interface Write {
  write_str(s: string): Result<null, FmtError>;
  write_char(c: number): Result<null, FmtError>;
}

/** PORT: `String as fmt::Write` (never fails). */
export class StringWriter implements Write {
  constructor(public buf: string = "") {}
  write_str(s: string): Result<null, FmtError> {
    this.buf += s;
    return Ok(null);
  }
  write_char(c: number): Result<null, FmtError> {
    this.buf += String.fromCodePoint(c);
    return Ok(null);
  }
}

const UNKNOWN_CHAR = 0xfffd; // '�'

/** PORT: `str::get(a..b)`: `undefined` when out of bounds or not on char boundaries. */
function str_get(s: Str, a: number, b: number): Str | undefined {
  const boundary = (i: number) => i === s.len() || (i < s.len() && (s.byte(i) & 0xc0) !== 0x80);
  if (a > b || b > s.len() || !boundary(a) || !boundary(b)) return undefined;
  return s.slice(a, b);
}

/**
 * PORT: `u32::from_str_radix(s, radix).ok()` (core/src/num/mod.rs `from_ascii_radix`): an optional
 * leading `+` (a lone `+` or `-` is invalid; `-` is never valid for unsigned), then digits by
 * `char::to_digit` on each byte; `None` on an empty input, invalid digit or overflow.
 */
function u32_from_str_radix(s: Str, radix: number): number | undefined {
  const n = s.len();
  if (n === 0) return undefined;
  let i = 0;
  const first = s.byte(0);
  if ((first === 0x2b /* '+' */ || first === 0x2d) /* '-' */ && n === 1) return undefined;
  if (first === 0x2b /* '+' */) i = 1;
  let result = 0;
  for (; i < n; i++) {
    const d = to_digit(s.byte(i), radix);
    if (d === undefined) return undefined;
    result = result * radix + d;
    if (result > 0xffffffff) return undefined;
  }
  return result;
}

// crate: fluent-syntax-0.12.0/src/unicode.rs:52 encode_unicode
function encode_unicode(s: Str | undefined): number {
  if (s !== undefined) {
    const n = u32_from_str_radix(s, 16);
    const c = n === undefined ? undefined : from_u32(n);
    if (c !== undefined) return c;
  }
  return UNKNOWN_CHAR;
}

/// Unescapes to a writer without allocating.
///
/// ## Example
///
/// ```
/// use fluent_syntax::unicode::unescape_unicode;
///
/// let mut s = String::new();
/// unescape_unicode(&mut s, "Foo \\U01F60A Bar");
/// assert_eq!(s, "Foo 😊 Bar");
/// ```
// crate: fluent-syntax-0.12.0/src/unicode.rs:68 unescape_unicode
export function unescape_unicode(w: Write, input: Str): Result<null, FmtError> {
  const r = unescape(w, input);
  if (r.$ === "Err") return r;
  if (r._0) {
    return Ok(null);
  }
  return w.write_str(input.toString());
}

// crate: fluent-syntax-0.12.0/src/unicode.rs:78 unescape
function unescape(w: Write, input: Str): Result<boolean, FmtError> {
  const bytes = input;

  let start = 0;
  let ptr = 0;

  while (ptr < bytes.len()) {
    const b = bytes.byte(ptr);
    if (b !== 0x5c /* b'\\' */) {
      ptr += 1;
      continue;
    }
    if (start !== ptr) {
      const r = w.write_str(input.slice(start, ptr).toString());
      if (r.$ === "Err") return r;
    }

    ptr += 1;

    let new_char: number;
    const next = ptr < bytes.len() ? bytes.byte(ptr) : undefined;
    if (next === 0x5c /* b'\\' */) {
      new_char = 0x5c; // '\\'
    } else if (next === 0x22 /* b'"' */) {
      new_char = 0x22; // '"'
    } else if (next === 0x75 /* b'u' */ || next === 0x55 /* b'U' */) {
      const u = next;
      const seq_start = ptr + 1;
      const len = u === 0x75 /* b'u' */ ? 4 : 6;
      ptr += len;
      new_char = encode_unicode(str_get(input, seq_start, seq_start + len));
    } else {
      new_char = UNKNOWN_CHAR;
    }
    ptr += 1;
    const r = w.write_char(new_char);
    if (r.$ === "Err") return r;
    start = ptr;
  }

  if (start === 0) {
    return Ok(false);
  }

  if (start !== ptr) {
    const r = w.write_str(input.slice(start, ptr).toString());
    if (r.$ === "Err") return r;
  }
  return Ok(true);
}

/// Unescapes to a `Cow<str>` optionally allocating.
///
/// ## Example
///
/// ```
/// use fluent_syntax::unicode::unescape_unicode_to_string;
///
/// assert_eq!(
///     unescape_unicode_to_string("Foo \\U01F60A Bar"),
///     "Foo 😊 Bar"
/// );
/// ```
// crate: fluent-syntax-0.12.0/src/unicode.rs:136 unescape_unicode_to_string
export function unescape_unicode_to_string(input: Str): string {
  const result = new StringWriter();
  const r = unescape(result, input);
  if (r.$ === "Err") panic("String write methods don't Err: Error");
  const owned = r._0;
  if (owned) {
    return result.buf;
  } else {
    return input.toString();
  }
}
