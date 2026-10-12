//! Utilities for validating (raw) string, char, and byte literals and
//! turning escape sequences into the values they represent.
//
// Port of the `rustc-literal-escaper` crate (=0.0.8), src/lib.rs.
//
// PORT: `Range<usize>` callback arguments are passed as two numbers: every callback is
// `(start, end, res)` where upstream has `(start..end, res)`.
// PORT: `NonZero<char>` / `NonZero<u8>` are plain numbers (their Debug forwards to the inner
// value, so `MixedUnit::Char(NonZero('a'))` prints as `Char('a')`).
// PORT: the private traits `CheckRaw` and `Unescape` become interfaces of their required
// items; their provided (default) methods become functions taking the impl table as `Self`.
// Methods of fieldless enums become free functions `<Enum>_<method>(self)`.

import { from_u32, is_ascii, is_whitespace, len_utf8, to_digit } from "../../std/char.ts";
import { debug_char, debug_int, debug_tuple, type Debug } from "../../std/fmt.ts";
import { unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { Chars, type Str } from "../../std/str.ts";

/// Errors and warnings that can occur during string, char, and byte unescaping.
///
/// Mostly relating to malformed escape sequences, but also a few other problems.
export type EscapeError =
  /// Expected 1 char, but 0 were found.
  | "ZeroChars"
  /// Expected 1 char, but more than 1 were found.
  | "MoreThanOneChar"

  /// Escaped '\' character without continuation.
  | "LoneSlash"
  /// Invalid escape character (e.g. '\z').
  | "InvalidEscape"
  /// Raw '\r' encountered.
  | "BareCarriageReturn"
  /// Raw '\r' encountered in raw string.
  | "BareCarriageReturnInRawString"
  /// Unescaped character that was expected to be escaped (e.g. raw '\t').
  | "EscapeOnlyChar"

  /// Numeric character escape is too short (e.g. '\x1').
  | "TooShortHexEscape"
  /// Invalid character in numeric escape (e.g. '\xz')
  | "InvalidCharInHexEscape"
  /// Character code in numeric escape is non-ascii (e.g. '\xFF').
  | "OutOfRangeHexEscape"

  /// '\u' not followed by '{'.
  | "NoBraceInUnicodeEscape"
  /// Non-hexadecimal value in '\u{..}'.
  | "InvalidCharInUnicodeEscape"
  /// '\u{}'
  | "EmptyUnicodeEscape"
  /// No closing brace in '\u{..}', e.g. '\u{12'.
  | "UnclosedUnicodeEscape"
  /// '\u{_12}'
  | "LeadingUnderscoreUnicodeEscape"
  /// More than 6 characters in '\u{..}', e.g. '\u{10FFFF_FF}'
  | "OverlongUnicodeEscape"
  /// Invalid in-bound unicode character code, e.g. '\u{DFFF}'.
  | "LoneSurrogateUnicodeEscape"
  /// Out of bounds unicode character code, e.g. '\u{FFFFFF}'.
  | "OutOfRangeUnicodeEscape"

  /// Unicode escape code in byte literal.
  | "UnicodeEscapeInByte"
  /// Non-ascii character in byte literal, byte string literal, or raw byte string literal.
  | "NonAsciiCharInByte"

  /// `\0` in a C string literal.
  | "NulInCStr"

  /// After a line ending with '\', the next line contains whitespace
  /// characters that are not skipped.
  | "UnskippedWhitespaceWarning"

  /// After a line ending with '\', multiple lines are skipped.
  | "MultipleSkippedLinesWarning";

export const EscapeError = {
  ZeroChars: "ZeroChars",
  MoreThanOneChar: "MoreThanOneChar",
  LoneSlash: "LoneSlash",
  InvalidEscape: "InvalidEscape",
  BareCarriageReturn: "BareCarriageReturn",
  BareCarriageReturnInRawString: "BareCarriageReturnInRawString",
  EscapeOnlyChar: "EscapeOnlyChar",
  TooShortHexEscape: "TooShortHexEscape",
  InvalidCharInHexEscape: "InvalidCharInHexEscape",
  OutOfRangeHexEscape: "OutOfRangeHexEscape",
  NoBraceInUnicodeEscape: "NoBraceInUnicodeEscape",
  InvalidCharInUnicodeEscape: "InvalidCharInUnicodeEscape",
  EmptyUnicodeEscape: "EmptyUnicodeEscape",
  UnclosedUnicodeEscape: "UnclosedUnicodeEscape",
  LeadingUnderscoreUnicodeEscape: "LeadingUnderscoreUnicodeEscape",
  OverlongUnicodeEscape: "OverlongUnicodeEscape",
  LoneSurrogateUnicodeEscape: "LoneSurrogateUnicodeEscape",
  OutOfRangeUnicodeEscape: "OutOfRangeUnicodeEscape",
  UnicodeEscapeInByte: "UnicodeEscapeInByte",
  NonAsciiCharInByte: "NonAsciiCharInByte",
  NulInCStr: "NulInCStr",
  UnskippedWhitespaceWarning: "UnskippedWhitespaceWarning",
  MultipleSkippedLinesWarning: "MultipleSkippedLinesWarning",
} as const;

export const debug_EscapeError: Debug<EscapeError> = (v) => v;

/// Returns true for actual errors, as opposed to warnings.
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:74 is_fatal
export function EscapeError_is_fatal(self: EscapeError): boolean {
  return !(self === "UnskippedWhitespaceWarning" || self === "MultipleSkippedLinesWarning");
}

/// Check a raw string literal for validity
///
/// Takes the contents of a raw string literal (without quotes)
/// and produces a sequence of characters or errors,
/// which are returned by invoking `callback`.
/// NOTE: Does no escaping, but produces errors for bare carriage return ('\r').
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:88 check_raw_str
export function check_raw_str(src: Str, callback: (start: number, end: number, res: Result<number, EscapeError>) => void): void {
  check_raw(CheckRaw_str, src, callback);
}

/// Check a raw byte string literal for validity
///
/// Takes the contents of a raw byte string literal (without quotes)
/// and produces a sequence of bytes or errors,
/// which are returned by invoking `callback`.
/// NOTE: Does no escaping, but produces errors for bare carriage return ('\r').
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:98 check_raw_byte_str
export function check_raw_byte_str(src: Str, callback: (start: number, end: number, res: Result<number, EscapeError>) => void): void {
  check_raw(CheckRaw_u8_slice, src, callback);
}

/// Check a raw C string literal for validity
///
/// Takes the contents of a raw C string literal (without quotes)
/// and produces a sequence of characters or errors,
/// which are returned by invoking `callback`.
/// NOTE: Does no escaping, but produces errors for bare carriage return ('\r').
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:108 check_raw_c_str
export function check_raw_c_str(src: Str, callback: (start: number, end: number, res: Result<number, EscapeError>) => void): void {
  check_raw(CheckRaw_CStr, src, callback);
}

/// Trait for checking raw string literals for validity
interface CheckRaw<RawUnit> {
  // /// Unit type of the implementing string type (`char` for string, `u8` for byte string)
  // type RawUnit;

  /// Converts chars to the unit type of the literal type
  char2raw_unit(c: number): Result<RawUnit, EscapeError>;
}

/// Takes the contents of a raw literal (without quotes)
/// and produces a sequence of `Result<Self::RawUnit, EscapeError>`
/// which are returned via `callback`.
///
/// NOTE: Does no escaping, but produces errors for bare carriage return ('\r').
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:128 check_raw
function check_raw<RawUnit>(
  Self: CheckRaw<RawUnit>,
  src: Str,
  callback: (start: number, end: number, res: Result<RawUnit, EscapeError>) => void,
): void {
  // PORT: `src.char_indices().for_each(..)`
  const chars = src.chars();
  let pos = 0;
  let c: number | undefined;
  while ((c = chars.next()) !== undefined) {
    callback(pos, pos + len_utf8(c), c === 0x0d /* '\r' */ ? Err(EscapeError.BareCarriageReturnInRawString) : Self.char2raw_unit(c));
    pos += len_utf8(c);
  }
}

// impl CheckRaw for str
const CheckRaw_str: CheckRaw<number> = {
  // crate: rustc-literal-escaper-0.0.8/src/lib.rs:149 char2raw_unit
  char2raw_unit(c: number): Result<number, EscapeError> {
    return Ok(c);
  },
};

// impl CheckRaw for [u8]
const CheckRaw_u8_slice: CheckRaw<number> = {
  // crate: rustc-literal-escaper-0.0.8/src/lib.rs:158 char2raw_unit
  char2raw_unit(c: number): Result<number, EscapeError> {
    return char2byte(c);
  },
};

/// Turn an ascii char into a byte
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:165 char2byte
function char2byte(c: number): Result<number, EscapeError> {
  // do NOT do: c.try_into().ok_or(EscapeError::NonAsciiCharInByte)
  if (is_ascii(c)) {
    return Ok(c);
  } else {
    return Err(EscapeError.NonAsciiCharInByte);
  }
}

// impl CheckRaw for CStr
const CheckRaw_CStr: CheckRaw<number> = {
  // crate: rustc-literal-escaper-0.0.8/src/lib.rs:178 char2raw_unit
  char2raw_unit(c: number): Result<number, EscapeError> {
    // NonZero::new(c).ok_or(EscapeError::NulInCStr)
    return c !== 0 ? Ok(c) : Err(EscapeError.NulInCStr);
  },
};

/// Unescape a char literal
///
/// Takes the contents of a char literal (without quotes),
/// and returns an unescaped char or an error.
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:188 unescape_char
export function unescape_char(src: Str): Result<number, EscapeError> {
  return unescape_single(Unescape_str, src.chars());
}

/// Unescape a byte literal
///
/// Takes the contents of a byte literal (without quotes),
/// and returns an unescaped byte or an error.
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:197 unescape_byte
export function unescape_byte(src: Str): Result<number, EscapeError> {
  return unescape_single(Unescape_u8_slice, src.chars());
}

/// Unescape a string literal
///
/// Takes the contents of a string literal (without quotes)
/// and produces a sequence of escaped characters or errors,
/// which are returned by invoking `callback`.
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:206 unescape_str
export function unescape_str(src: Str, callback: (start: number, end: number, res: Result<number, EscapeError>) => void): void {
  unescape(Unescape_str, src, callback);
}

/// Unescape a byte string literal
///
/// Takes the contents of a byte string literal (without quotes)
/// and produces a sequence of escaped bytes or errors,
/// which are returned by invoking `callback`.
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:215 unescape_byte_str
export function unescape_byte_str(src: Str, callback: (start: number, end: number, res: Result<number, EscapeError>) => void): void {
  unescape(Unescape_u8_slice, src, callback);
}

/// Unescape a C string literal
///
/// Takes the contents of a C string literal (without quotes)
/// and produces a sequence of escaped MixedUnits or errors,
/// which are returned by invoking `callback`.
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:224 unescape_c_str
export function unescape_c_str(src: Str, callback: (start: number, end: number, res: Result<MixedUnit, EscapeError>) => void): void {
  unescape(Unescape_CStr, src, callback);
}

/// Enum representing either a char or a byte
///
/// Used for mixed utf8 string literals, i.e. those that allow both unicode
/// chars and high bytes.
export type MixedUnit =
  /// Used for ASCII chars (written directly or via `\x00`..`\x7f` escapes)
  /// and Unicode chars (written directly or via `\u` escapes).
  ///
  /// For example, if '¥' appears in a string it is represented here as
  /// `MixedUnit::Char('¥')`, and it will be appended to the relevant byte
  /// string as the two-byte UTF-8 sequence `[0xc2, 0xa5]`
  | { readonly $: "Char"; readonly _0: number }

  /// Used for high bytes (`\x80`..`\xff`).
  ///
  /// For example, if `\xa5` appears in a string it is represented here as
  /// `MixedUnit::HighByte(0xa5)`, and it will be appended to the relevant
  /// byte string as the single byte `0xa5`.
  | { readonly $: "HighByte"; readonly _0: number };

export const debug_MixedUnit: Debug<MixedUnit> = (v, f) => {
  switch (v.$) {
    case "Char":
      return debug_tuple(f, "Char", [debug_char(v._0)]);
    case "HighByte":
      return debug_tuple(f, "HighByte", [debug_int(v._0, f)]);
  }
};

/// derive(PartialEq)
export function MixedUnit_eq(a: MixedUnit, b: MixedUnit): boolean {
  return a.$ === b.$ && a._0 === b._0;
}

// impl From<NonZero<char>> for MixedUnit
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:255 from
export function MixedUnit_from_nonzero_char(c: number): MixedUnit {
  return { $: "Char", _0: c };
}

// impl From<NonZero<u8>> for MixedUnit
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:262 from
export function MixedUnit_from_nonzero_u8(byte: number): MixedUnit {
  if (is_ascii(byte)) {
    // MixedUnit::Char(NonZero::new(byte.get() as char).unwrap())
    return { $: "Char", _0: unwrap(byte !== 0 ? byte : undefined) };
  } else {
    return { $: "HighByte", _0: byte };
  }
}

// impl TryFrom<char> for MixedUnit
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:275 try_from
export function MixedUnit_try_from_char(c: number): Result<MixedUnit, EscapeError> {
  // NonZero::new(c).map(MixedUnit::Char).ok_or(EscapeError::NulInCStr)
  return c !== 0 ? Ok<MixedUnit>({ $: "Char", _0: c }) : Err(EscapeError.NulInCStr);
}

// impl TryFrom<u8> for MixedUnit
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:286 try_from
export function MixedUnit_try_from_u8(byte: number): Result<MixedUnit, EscapeError> {
  // NonZero::new(byte).map(From::from).ok_or(EscapeError::NulInCStr)
  return byte !== 0 ? Ok(MixedUnit_from_nonzero_u8(byte)) : Err(EscapeError.NulInCStr);
}

/// Trait for unescaping escape sequences in strings
interface Unescape<Unit> {
  // /// Unit type of the implementing string type (`char` for string, `u8` for byte string)
  // type Unit;

  /// Result of unescaping the zero char ('\0')
  readonly ZERO_RESULT: Result<Unit, EscapeError>;

  /// Converts non-zero bytes to the unit type
  nonzero_byte2unit(b: number): Unit;

  /// Converts chars to the unit type
  char2unit(c: number): Result<Unit, EscapeError>;

  /// Converts the byte of a hex escape to the unit type
  hex2unit(b: number): Result<Unit, EscapeError>;

  /// Converts the result of a unicode escape to the unit type
  unicode2unit(r: Result<number, EscapeError>): Result<Unit, EscapeError>;
}

/// Unescape a single unit (single quote syntax)
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:314 unescape_single
function unescape_single<Unit>(Self: Unescape<Unit>, chars: Chars): Result<Unit, EscapeError> {
  const c = chars.next();
  if (c === undefined) return Err(EscapeError.ZeroChars);
  let res: Result<Unit, EscapeError>;
  switch (c) {
    case 0x5c /* '\\' */:
      res = unescape_1(Self, chars);
      break;
    case 0x0a /* '\n' */:
    case 0x09 /* '\t' */:
    case 0x27 /* '\'' */:
      res = Err(EscapeError.EscapeOnlyChar);
      break;
    case 0x0d /* '\r' */:
      res = Err(EscapeError.BareCarriageReturn);
      break;
    default:
      res = Self.char2unit(c);
  }
  if (res.$ === "Err") return res;
  if (chars.next() !== undefined) {
    return Err(EscapeError.MoreThanOneChar);
  }
  return Ok(res._0);
}

/// Unescape the first unit of a string (double quoted syntax)
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:328 unescape_1
function unescape_1<Unit>(Self: Unescape<Unit>, chars: Chars): Result<Unit, EscapeError> {
  // Previous character was '\\', unescape what follows.
  const c = chars.next();
  if (c === undefined) return Err(EscapeError.LoneSlash);
  if (c === 0x30 /* '0' */) {
    return Self.ZERO_RESULT;
  } else {
    const simple = simple_escape(c);
    if (simple.$ === "Ok") return Ok(Self.nonzero_byte2unit(simple._0));
    // PORT: `.or_else(|c| match c { .. })`; a `?` inside the closure returns its Err
    // as the result of `or_else` (bypassing `hex2unit`/`unicode2unit`).
    switch (simple._0) {
      case 0x78 /* 'x' */: {
        const b = hex_escape(chars);
        if (b.$ === "Err") return b;
        return Self.hex2unit(b._0);
      }
      case 0x75 /* 'u' */: {
        const value = unicode_escape(chars);
        if (value.$ === "Err") return value;
        let r: Result<number, EscapeError>;
        if (value._0 > 0x10ffff /* char::MAX as u32 */) {
          r = Err(EscapeError.OutOfRangeUnicodeEscape);
        } else {
          const ch = from_u32(value._0);
          r = ch !== undefined ? Ok(ch) : Err(EscapeError.LoneSurrogateUnicodeEscape);
        }
        return Self.unicode2unit(r);
      }
      default:
        return Err(EscapeError.InvalidEscape);
    }
  }
}

/// Unescape a string literal
///
/// Takes the contents of a raw string literal (without quotes)
/// and produces a sequence of `Result<Self::Unit, EscapeError>`
/// which are returned via `callback`.
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:356 unescape
function unescape<Unit>(
  Self: Unescape<Unit>,
  src: Str,
  callback: (start: number, end: number, res: Result<Unit, EscapeError>) => void,
): void {
  const chars = src.chars();
  let c: number | undefined;
  while ((c = chars.next()) !== undefined) {
    const start = src.len() - chars.rest_len() - len_utf8(c);
    let res: Result<Unit, EscapeError>;
    switch (c) {
      case 0x5c /* '\\' */: {
        // PORT: `if let Some(b'\n') = chars.as_str().as_bytes().first()`
        if (chars.rest_len() > 0 && chars.b[chars.pos] === 0x0a /* b'\n' */) {
          chars.next();
          // skip whitespace for backslash newline, see [Rust language reference]
          // (https://doc.rust-lang.org/reference/tokens.html#string-literals).
          const callback_err = (start: number, end: number, err: EscapeError) => callback(start, end, Err(err));
          skip_ascii_whitespace(chars, start, callback_err);
          continue;
        } else {
          res = unescape_1(Self, chars);
        }
        break;
      }
      case 0x22 /* '"' */:
        res = Err(EscapeError.EscapeOnlyChar);
        break;
      case 0x0d /* '\r' */:
        res = Err(EscapeError.BareCarriageReturn);
        break;
      default:
        res = Self.char2unit(c);
    }
    const end = src.len() - chars.rest_len();
    callback(start, end, res);
  }
}

/// Interpret a non-nul ASCII escape
///
/// Parses the character of an ASCII escape (except nul) without the leading backslash.
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:390 simple_escape
function simple_escape(c: number): Result<number, number> {
  // Previous character was '\\', unescape what follows.
  let b: number;
  switch (c) {
    case 0x22 /* '"' */:
      b = 0x22 /* b'"' */;
      break;
    case 0x6e /* 'n' */:
      b = 0x0a /* b'\n' */;
      break;
    case 0x72 /* 'r' */:
      b = 0x0d /* b'\r' */;
      break;
    case 0x74 /* 't' */:
      b = 0x09 /* b'\t' */;
      break;
    case 0x5c /* '\\' */:
      b = 0x5c /* b'\\' */;
      break;
    case 0x27 /* '\'' */:
      b = 0x27 /* b'\'' */;
      break;
    default:
      return Err(c);
  }
  // Ok(NonZero::new(..).unwrap())
  return Ok(unwrap(b !== 0 ? b : undefined));
}

/// Interpret a hexadecimal escape
///
/// Parses the two hexadecimal characters of a hexadecimal escape without the leading r"\x".
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:408 hex_escape
function hex_escape(chars: Chars): Result<number, EscapeError> {
  const hi_c = chars.next();
  if (hi_c === undefined) return Err(EscapeError.TooShortHexEscape);
  const hi = to_digit(hi_c, 16);
  if (hi === undefined) return Err(EscapeError.InvalidCharInHexEscape);

  const lo_c = chars.next();
  if (lo_c === undefined) return Err(EscapeError.TooShortHexEscape);
  const lo = to_digit(lo_c, 16);
  if (lo === undefined) return Err(EscapeError.InvalidCharInHexEscape);

  return Ok((hi * 16 + lo) & 0xff);
}

/// Interpret a unicode escape
///
/// Parse the braces with hexadecimal characters (and underscores) part of a unicode escape.
/// This r"{...}" normally comes after r"\u" and cannot start with an underscore.
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:423 unicode_escape
function unicode_escape(chars: Chars): Result<number, EscapeError> {
  if (chars.next() !== 0x7b /* '{' */) {
    return Err(EscapeError.NoBraceInUnicodeEscape);
  }

  // First character must be a hexadecimal digit.
  const first = chars.next();
  if (first === undefined) return Err(EscapeError.UnclosedUnicodeEscape);
  let value: number;
  switch (first) {
    case 0x5f /* '_' */:
      return Err(EscapeError.LeadingUnderscoreUnicodeEscape);
    case 0x7d /* '}' */:
      return Err(EscapeError.EmptyUnicodeEscape);
    default: {
      const d = to_digit(first, 16);
      if (d === undefined) return Err(EscapeError.InvalidCharInUnicodeEscape);
      value = d;
    }
  }

  // First character is valid, now parse the rest of the number
  // and closing brace.
  let n_digits = 1;
  for (;;) {
    const c = chars.next();
    if (c === undefined) {
      return Err(EscapeError.UnclosedUnicodeEscape);
    } else if (c === 0x5f /* '_' */) {
      continue;
    } else if (c === 0x7d /* '}' */) {
      // Incorrect syntax has higher priority for error reporting
      // than unallowed value for a literal.
      return n_digits > 6 ? Err(EscapeError.OverlongUnicodeEscape) : Ok(value);
    } else {
      const digit = to_digit(c, 16);
      if (digit === undefined) return Err(EscapeError.InvalidCharInUnicodeEscape);
      n_digits += 1;
      if (n_digits > 6) {
        // Stop updating value since we're sure that it's incorrect already.
        continue;
      }
      value = value * 16 + digit;
    }
  }
}

/// Interpret a string continuation escape (https://doc.rust-lang.org/reference/expressions/literal-expr.html#string-continuation-escapes)
///
/// Skip ASCII whitespace, except for the formfeed character
/// (see [this issue](https://github.com/rust-lang/rust/issues/136600)).
/// Warns on unescaped newline and following non-ASCII whitespace.
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:474 skip_ascii_whitespace
function skip_ascii_whitespace(chars: Chars, start: number, callback: (start: number, end: number, err: EscapeError) => void): void {
  const rest = chars.as_str();
  // PORT: `rest.bytes().position(|b| ..).unwrap_or(rest.len())`
  let first_non_space = 0;
  while (first_non_space < rest.len()) {
    const b = rest.byte(first_non_space);
    if (b !== 0x20 /* b' ' */ && b !== 0x09 /* b'\t' */ && b !== 0x0a /* b'\n' */ && b !== 0x0d /* b'\r' */) break;
    first_non_space++;
  }
  const space = rest.slice(0, first_non_space);
  const rest_ = rest.slice(first_non_space);
  // backslash newline adds 2 bytes
  const end = start + 2 + first_non_space;
  if (space.find("\n") !== undefined) {
    callback(start, end, EscapeError.MultipleSkippedLinesWarning);
  }
  // PORT: `*chars = rest.chars()`: `rest` ends where `chars` ends, so reposition in place.
  chars.pos = rest_.lo;
  const c = chars.clone().next();
  if (c !== undefined) {
    if (is_whitespace(c)) {
      // for error reporting, include the character that was not skipped in the span
      callback(start, end + len_utf8(c), EscapeError.UnskippedWhitespaceWarning);
    }
  }
}

// impl Unescape for str
const Unescape_str: Unescape<number> = {
  ZERO_RESULT: Ok(0 /* '\0' */),

  // crate: rustc-literal-escaper-0.0.8/src/lib.rs:508 nonzero_byte2unit
  nonzero_byte2unit(b: number): number {
    return b;
  },

  // crate: rustc-literal-escaper-0.0.8/src/lib.rs:513 char2unit
  char2unit(c: number): Result<number, EscapeError> {
    return Ok(c);
  },

  // crate: rustc-literal-escaper-0.0.8/src/lib.rs:518 hex2unit
  hex2unit(b: number): Result<number, EscapeError> {
    if (is_ascii(b)) {
      return Ok(b);
    } else {
      return Err(EscapeError.OutOfRangeHexEscape);
    }
  },

  // crate: rustc-literal-escaper-0.0.8/src/lib.rs:527 unicode2unit
  unicode2unit(r: Result<number, EscapeError>): Result<number, EscapeError> {
    return r;
  },
};

// impl Unescape for [u8]
const Unescape_u8_slice: Unescape<number> = {
  ZERO_RESULT: Ok(0 /* b'\0' */),

  // crate: rustc-literal-escaper-0.0.8/src/lib.rs:538 nonzero_byte2unit
  nonzero_byte2unit(b: number): number {
    return b;
  },

  // crate: rustc-literal-escaper-0.0.8/src/lib.rs:543 char2unit
  char2unit(c: number): Result<number, EscapeError> {
    return char2byte(c);
  },

  // crate: rustc-literal-escaper-0.0.8/src/lib.rs:548 hex2unit
  hex2unit(b: number): Result<number, EscapeError> {
    return Ok(b);
  },

  // crate: rustc-literal-escaper-0.0.8/src/lib.rs:553 unicode2unit
  unicode2unit(_r: Result<number, EscapeError>): Result<number, EscapeError> {
    return Err(EscapeError.UnicodeEscapeInByte);
  },
};

// impl Unescape for CStr
const Unescape_CStr: Unescape<MixedUnit> = {
  ZERO_RESULT: Err(EscapeError.NulInCStr),

  // crate: rustc-literal-escaper-0.0.8/src/lib.rs:564 nonzero_byte2unit
  nonzero_byte2unit(b: number): MixedUnit {
    return MixedUnit_from_nonzero_u8(b);
  },

  // crate: rustc-literal-escaper-0.0.8/src/lib.rs:569 char2unit
  char2unit(c: number): Result<MixedUnit, EscapeError> {
    return MixedUnit_try_from_char(c);
  },

  // crate: rustc-literal-escaper-0.0.8/src/lib.rs:574 hex2unit
  hex2unit(byte: number): Result<MixedUnit, EscapeError> {
    return MixedUnit_try_from_u8(byte);
  },

  // crate: rustc-literal-escaper-0.0.8/src/lib.rs:579 unicode2unit
  unicode2unit(r: Result<number, EscapeError>): Result<MixedUnit, EscapeError> {
    if (r.$ === "Err") return r;
    return Unescape_CStr.char2unit(r._0);
  },
};

/// Enum of the different kinds of literal
export type Mode =
  /// `'a'`
  | "Char"

  /// `b'a'`
  | "Byte"

  /// `"hello"`
  | "Str"
  /// `r"hello"`
  | "RawStr"

  /// `b"hello"`
  | "ByteStr"
  /// `br"hello"`
  | "RawByteStr"

  /// `c"hello"`
  | "CStr"
  /// `cr"hello"`
  | "RawCStr";

export const Mode = {
  Char: "Char",
  Byte: "Byte",
  Str: "Str",
  RawStr: "RawStr",
  ByteStr: "ByteStr",
  RawByteStr: "RawByteStr",
  CStr: "CStr",
  RawCStr: "RawCStr",
} as const;

export const debug_Mode: Debug<Mode> = (v) => v;

// crate: rustc-literal-escaper-0.0.8/src/lib.rs:610 in_double_quotes
export function Mode_in_double_quotes(self: Mode): boolean {
  switch (self) {
    case "Str":
    case "RawStr":
    case "ByteStr":
    case "RawByteStr":
    case "CStr":
    case "RawCStr":
      return true;
    case "Char":
    case "Byte":
      return false;
  }
}

// crate: rustc-literal-escaper-0.0.8/src/lib.rs:622 prefix_noraw
export function Mode_prefix_noraw(self: Mode): string {
  switch (self) {
    case "Char":
    case "Str":
    case "RawStr":
      return "";
    case "Byte":
    case "ByteStr":
    case "RawByteStr":
      return "b";
    case "CStr":
    case "RawCStr":
      return "c";
  }
}

/// Check a literal only for errors
///
/// Takes the contents of a literal (without quotes)
/// and produces a sequence of only errors,
/// which are returned by invoking `error_callback`.
///
/// NB Does not produce any output other than errors
// crate: rustc-literal-escaper-0.0.8/src/lib.rs:638 check_for_errors
export function check_for_errors(src: Str, mode: Mode, error_callback: (start: number, end: number, err: EscapeError) => void): void {
  switch (mode) {
    case "Char": {
      const chars = src.chars();
      const r = unescape_single(Unescape_str, chars);
      if (r.$ === "Err") {
        error_callback(0, src.len() - chars.rest_len(), r._0);
      }
      break;
    }
    case "Byte": {
      const chars = src.chars();
      const r = unescape_single(Unescape_u8_slice, chars);
      if (r.$ === "Err") {
        error_callback(0, src.len() - chars.rest_len(), r._0);
      }
      break;
    }
    case "Str":
      unescape_str(src, (start, end, res) => {
        if (res.$ === "Err") {
          error_callback(start, end, res._0);
        }
      });
      break;
    case "ByteStr":
      unescape_byte_str(src, (start, end, res) => {
        if (res.$ === "Err") {
          error_callback(start, end, res._0);
        }
      });
      break;
    case "CStr":
      unescape_c_str(src, (start, end, res) => {
        if (res.$ === "Err") {
          error_callback(start, end, res._0);
        }
      });
      break;
    case "RawStr":
      check_raw_str(src, (start, end, res) => {
        if (res.$ === "Err") {
          error_callback(start, end, res._0);
        }
      });
      break;
    case "RawByteStr":
      check_raw_byte_str(src, (start, end, res) => {
        if (res.$ === "Err") {
          error_callback(start, end, res._0);
        }
      });
      break;
    case "RawCStr":
      check_raw_c_str(src, (start, end, res) => {
        if (res.$ === "Err") {
          error_callback(start, end, res._0);
        }
      });
      break;
  }
}
