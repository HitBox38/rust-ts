// Port of compiler/rustc_parse/src/lexer/unescape_error_reporting.rs
//! Utilities for rendering escape sequence errors as diagnostics.

import { Applicability, type Diag, type DiagCtxtHandle, type ErrorGuaranteed } from "../../rustc_errors/lib.ts";
import { BytePos, Span } from "../../rustc_span/lib.ts";
import { is_whitespace, len_utf8, to_digit } from "../../std/char.ts";
import { debug_char } from "../../std/fmt.ts";
import { assert, panic } from "../../std/panic.ts";
import { type Str, utf8, utf8_len } from "../../std/str.ts";
import { type EscapeError, Mode } from "../../vendor/rustc_literal_escaper/lib.ts";
import { char as unicode_char, display_Recompositions, UnicodeNormalization_str } from "../../vendor/unicode_normalization/lib.ts";
import { UnicodeWidthChar } from "../../vendor/unicode_width/lib.ts";
import {
  type MoreThanOneCharNote,
  type MoreThanOneCharSugg,
  NoBraceUnicodeSub,
  UnescapeError_diagnostic,
} from "../diagnostics.ts";

/** PORT: `std::ops::Range<usize>` (the `range` argument of `emit_unescape_error`). */
export interface Range {
  start: number;
  end: number;
}

/** PORT: `char::escape_default` (std; not in src/std/char.ts yet). */
function char_escape_default(c: number): string {
  switch (c) {
    case 0x09:
      return "\\t";
    case 0x0d:
      return "\\r";
    case 0x0a:
      return "\\n";
    case 0x5c:
    case 0x27:
    case 0x22:
      return "\\" + String.fromCodePoint(c);
    default:
      if (c >= 0x20 && c <= 0x7e) return String.fromCodePoint(c);
      return `\\u{${c.toString(16)}}`;
  }
}

/** PORT: `str::escape_default` (std): `char::escape_default` of every char. */
function str_escape_default(s: Str): string {
  let out = "";
  const chars = s.chars();
  for (let c = chars.next(); c !== undefined; c = chars.next()) out += char_escape_default(c);
  return out;
}

/** PORT: `u8::from_str_radix` (std `from_str_radix` for an unsigned type): `undefined` is `Err`. */
function u8_from_str_radix(src: string, radix: number): number | undefined {
  if (src.length === 0) return undefined;
  let digits = src;
  if (src === "+" || src === "-") return undefined;
  if (src.startsWith("+")) digits = src.slice(1);
  let result = 0;
  for (const ch of digits) {
    const d = to_digit(ch.codePointAt(0)!, radix);
    if (d === undefined) return undefined;
    result = result * radix + d;
    if (result > 0xff) return undefined;
  }
  return result;
}

// rustc: compiler/rustc_parse/src/lexer/unescape_error_reporting.rs:15 emit_unescape_error
export function emit_unescape_error(
  dcx: DiagCtxtHandle,
  // interior part of the literal, between quotes
  lit: Str,
  // full span of the literal, including quotes and any prefix
  full_lit_span: Span,
  // span of the error part of the literal
  err_span: Span,
  mode: Mode,
  // range of the error inside `lit`
  range: Range,
  error: EscapeError,
): ErrorGuaranteed | undefined {
  // debug!(
  //     "emit_unescape_error: {:?}, {:?}, {:?}, {:?}, {:?}",
  //     lit, full_lit_span, mode, range, error
  // );
  const last_char = (): [number, Span] => {
    // `lit[range.clone()].chars().next_back().unwrap()`
    const chars = lit.slice(range.start, range.end).chars();
    let c: number | undefined;
    for (let x = chars.next(); x !== undefined; x = chars.next()) c = x;
    if (c === undefined) panic("called `Option::unwrap()` on a `None` value");
    const span = Span.with_lo(err_span, BytePos.sub(Span.hi(err_span), BytePos(len_utf8(c))));
    return [c, span];
  };
  switch (error) {
    case "LoneSurrogateUnicodeEscape": {
      return dcx.emit_err(UnescapeError_diagnostic({ $: "InvalidUnicodeEscape", span: err_span, surrogate: true }));
    }
    case "OutOfRangeUnicodeEscape": {
      return dcx.emit_err(UnescapeError_diagnostic({ $: "InvalidUnicodeEscape", span: err_span, surrogate: false }));
    }
    case "MoreThanOneChar": {
      // use unicode_normalization::UnicodeNormalization;
      // use unicode_normalization::char::is_combining_mark;
      let sugg: MoreThanOneCharSugg | undefined = undefined;
      let note: MoreThanOneCharNote | undefined = undefined;

      const lit_chars: number[] = [];
      const it = lit.chars();
      for (let c = it.next(); c !== undefined; c = it.next()) lit_chars.push(c);
      // `lit_chars.split_first().unwrap()`
      if (lit_chars.length === 0) panic("called `Option::unwrap()` on a `None` value");
      const first = lit_chars[0]!;
      const rest = lit_chars.slice(1);
      if (rest.every(unicode_char.is_combining_mark)) {
        const normalized = display_Recompositions(UnicodeNormalization_str.nfc(lit));
        const normalized_chars = [...normalized];
        if (normalized_chars.length === 1) {
          const ch = char_escape_default(normalized_chars[0]!.codePointAt(0)!);
          sugg = {
            $: "NormalizedForm",
            span: err_span,
            ch,
            normalized,
          };
        }
        const escaped_marks = rest.map((c) => char_escape_default(c));
        note = {
          $: "AllCombining",
          span: err_span,
          chr: String.fromCodePoint(first),
          len: escaped_marks.length,
          escaped_marks: escaped_marks.join(""),
        };
      } else {
        const printable: number[] = [];
        const chars = lit.chars();
        for (let x = chars.next(); x !== undefined; x = chars.next()) {
          if ((UnicodeWidthChar.width(x) ?? 0) !== 0 && !is_whitespace(x)) printable.push(x);
        }

        if (printable.length === 1) {
          const ch = printable[0]!;
          sugg = {
            $: "RemoveNonPrinting",
            span: err_span,
            ch: String.fromCodePoint(ch),
          };
          note = {
            $: "NonPrinting",
            span: err_span,
            escaped: str_escape_default(lit),
          };
        }
      }
      // `sugg.unwrap_or_else(|| { .. })`
      if (sugg === undefined) {
        const prefix = Mode.prefix_noraw(mode);
        let escaped = "";
        let in_escape = false;
        const chars = lit.chars();
        for (let c = chars.next(); c !== undefined; c = chars.next()) {
          if (c === 0x5c /* '\\' */) {
            in_escape = !in_escape;
          } else if (c === 0x22 /* '"' */ && !in_escape) {
            escaped += "\\";
          } else {
            in_escape = false;
          }
          escaped += String.fromCodePoint(c);
        }
        if (utf8_len(escaped) !== lit.len() || Span.is_empty(full_lit_span)) {
          const sugg_ = `${prefix}"${escaped}"`;
          sugg = {
            $: "QuotesFull",
            span: full_lit_span,
            is_byte: mode === Mode.Byte,
            sugg: sugg_,
          };
        } else {
          sugg = {
            $: "Quotes",
            start: Span.with_hi(full_lit_span, BytePos.add(Span.lo(full_lit_span), BytePos(utf8_len(prefix) + 1))),
            end: Span.with_lo(full_lit_span, BytePos.sub(Span.hi(full_lit_span), BytePos(1))),
            is_byte: mode === Mode.Byte,
            prefix,
          };
        }
      }
      return dcx.emit_err(
        UnescapeError_diagnostic({
          $: "MoreThanOneChar",
          span: full_lit_span,
          note,
          suggestion: sugg,
        }),
      );
    }
    case "EscapeOnlyChar": {
      const [c, char_span] = last_char();
      return dcx.emit_err(
        UnescapeError_diagnostic({
          $: "EscapeOnlyChar",
          span: err_span,
          char_span,
          escaped_sugg: char_escape_default(c),
          escaped_msg: escaped_char(c),
          byte: mode === Mode.Byte,
        }),
      );
    }
    case "BareCarriageReturn": {
      const double_quotes = Mode.in_double_quotes(mode);
      return dcx.emit_err(UnescapeError_diagnostic({ $: "BareCr", span: err_span, double_quotes }));
    }
    case "BareCarriageReturnInRawString": {
      assert(Mode.in_double_quotes(mode), "assertion failed: mode.in_double_quotes()");
      return dcx.emit_err(UnescapeError_diagnostic({ $: "BareCrRawString", _0: err_span }));
    }
    case "InvalidEscape": {
      const [c, span] = last_char();

      const label = mode === Mode.Byte || mode === Mode.ByteStr ? "unknown byte escape" : "unknown character escape";
      const ec = escaped_char(c);
      const diag = dcx.struct_span_err(span, `${label}: \`${ec}\``);
      diag.span_label(span, label);
      if (c === 0x7b /* '{' */ || (c === 0x7d /* '}' */ && (mode === Mode.Str || mode === Mode.RawStr))) {
        diag.help("if used in a formatting string, curly braces are escaped with `{{` and `}}`");
      } else if (c === 0x0d /* '\r' */) {
        diag.help("this is an isolated carriage return; consider checking your editor and version control settings");
      } else {
        if (mode === Mode.Str || mode === Mode.Char) {
          diag.span_suggestion_verbose(
            full_lit_span,
            "if you meant to write a literal backslash (perhaps escaping in a regular expression), consider a raw string literal",
            `r"${lit.toString()}"`,
            Applicability.MaybeIncorrect,
          );
        }

        diag.help("for more information, visit <https://doc.rust-lang.org/reference/tokens.html#literals>");

        foreign_escape_suggestion(diag, [ec, span], err_span);
      }
      return diag.emit_err();
    }
    case "TooShortHexEscape":
      return dcx.emit_err(UnescapeError_diagnostic({ $: "TooShortHexEscape", _0: err_span }));
    case "InvalidCharInHexEscape":
    case "InvalidCharInUnicodeEscape": {
      const [c, span] = last_char();
      const is_hex = error === "InvalidCharInHexEscape";
      const ch = escaped_char(c);
      return dcx.emit_err(UnescapeError_diagnostic({ $: "InvalidCharInEscape", span, is_hex, ch }));
    }
    case "NonAsciiCharInByte": {
      const [c, span] = last_char();
      let desc: string;
      switch (mode) {
        case "Byte":
          desc = "byte literal";
          break;
        case "ByteStr":
          desc = "byte string literal";
          break;
        case "RawByteStr":
          desc = "raw byte string literal";
          break;
        default:
          return panic("non-is_byte literal paired with NonAsciiCharInByte");
      }
      const err = dcx.struct_span_err(span, `non-ASCII character in ${desc}`);
      const postfix = (UnicodeWidthChar.width(c) ?? 1) === 0 ? ` but is ${debug_char(c)}` : "";
      err.span_label(span, `must be ASCII${postfix}`);
      // Note: the \\xHH suggestions are not given for raw byte string
      // literals, because they are araw and so cannot use any escapes.
      if (c <= 0xff && mode !== Mode.RawByteStr) {
        err.span_suggestion_verbose(
          span,
          `if you meant to use the unicode code point for ${debug_char(c)}, use a \\xHH escape`,
          `\\x${c.toString(16).toUpperCase()}`,
          Applicability.MaybeIncorrect,
        );
      } else if (mode === Mode.Byte) {
        err.span_label(span, "this multibyte character does not fit into a single byte");
      } else if (mode !== Mode.RawByteStr) {
        const utf8_ = utf8(String.fromCodePoint(c));
        err.span_suggestion_verbose(
          span,
          `if you meant to use the UTF-8 encoding of ${debug_char(c)}, use \\xHH escapes`,
          Array.from(utf8_)
            .map((b) => `\\x${b.toString(16).toUpperCase()}`)
            .reduce((a, c) => a + c, ""),
          Applicability.MaybeIncorrect,
        );
      }
      return err.emit_err();
    }
    case "OutOfRangeHexEscape": {
      const err = dcx.struct_span_err(err_span, "out of range hex escape");
      err.span_label(err_span, "must be a character in the range [\\x00-\\x7f]");

      const escape_str = lit.slice(range.start, range.end);
      let value: number | undefined;
      if (
        lit.len() <= 4 &&
        escape_str.len() === 4 &&
        escape_str.starts_with("\\x") &&
        (value = u8_from_str_radix(escape_str.slice(2, 4).toString(), 16)) !== undefined &&
        (mode === Mode.Char || mode === Mode.Str)
      ) {
        err.help(`if you want to write a byte literal, use \`b'${escape_str.toString()}'\``);
        err.help(`if you want to write a Unicode character, use \`'\\u{${value.toString(16).toUpperCase()}}'\``);
      }

      return err.emit_err();
    }
    case "LeadingUnderscoreUnicodeEscape": {
      const [c, span] = last_char();
      return dcx.emit_err(UnescapeError_diagnostic({ $: "LeadingUnderscoreUnicodeEscape", span, ch: escaped_char(c) }));
    }
    case "OverlongUnicodeEscape": {
      return dcx.emit_err(UnescapeError_diagnostic({ $: "OverlongUnicodeEscape", _0: err_span }));
    }
    case "UnclosedUnicodeEscape": {
      return dcx.emit_err(UnescapeError_diagnostic({ $: "UnclosedUnicodeEscape", _0: err_span, _1: Span.shrink_to_hi(err_span) }));
    }
    case "NoBraceInUnicodeEscape": {
      let suggestion = "\\u{";
      let suggestion_len = 0;
      const [c, char_span] = last_char();
      // `once(c).chain(lit[range.end..].chars())`, `.take(6).take_while(|c| c.is_digit(16))`
      const rest = lit.slice(range.end).chars();
      for (let n = 0, x: number | undefined = c; n < 6 && x !== undefined; n++, x = rest.next()) {
        if (to_digit(x, 16) === undefined) break;
        suggestion += String.fromCodePoint(x);
        suggestion_len += len_utf8(x);
      }

      let label: Span | undefined;
      let sub: NoBraceUnicodeSub;
      if (suggestion_len > 0) {
        suggestion += "}";
        const hi = BytePos.add(Span.lo(char_span), BytePos(suggestion_len));
        [label, sub] = [undefined, { $: "Suggestion", span: Span.with_hi(err_span, hi), suggestion }];
      } else {
        [label, sub] = [err_span, NoBraceUnicodeSub.Help];
      }
      return dcx.emit_err(UnescapeError_diagnostic({ $: "NoBraceInUnicodeEscape", span: err_span, label, sub }));
    }
    case "UnicodeEscapeInByte": {
      return dcx.emit_err(UnescapeError_diagnostic({ $: "UnicodeEscapeInByte", _0: err_span }));
    }
    case "EmptyUnicodeEscape": {
      return dcx.emit_err(UnescapeError_diagnostic({ $: "EmptyUnicodeEscape", _0: err_span }));
    }
    case "ZeroChars":
      return dcx.emit_err(UnescapeError_diagnostic({ $: "ZeroChars", _0: err_span }));
    case "LoneSlash":
      return dcx.emit_err(UnescapeError_diagnostic({ $: "LoneSlash", _0: err_span }));
    case "NulInCStr":
      return dcx.emit_err(UnescapeError_diagnostic({ $: "NulInCStr", span: err_span }));
    case "UnskippedWhitespaceWarning": {
      const [c, char_span] = last_char();
      dcx.emit_warn(
        UnescapeError_diagnostic({
          $: "UnskippedWhitespace",
          span: err_span,
          ch: escaped_char(c),
          char_span,
        }),
      );
      return undefined;
    }
    case "MultipleSkippedLinesWarning": {
      dcx.emit_warn(UnescapeError_diagnostic({ $: "MultipleSkippedLinesWarning", _0: err_span }));
      return undefined;
    }
  }
}

/// Add additional suggestions for escapes that are supported by C.
// rustc: compiler/rustc_parse/src/lexer/unescape_error_reporting.rs:310 foreign_escape_suggestion
function foreign_escape_suggestion(diag: Diag, [escaped_char, escape_span]: [string, Span], err_span: Span): void {
  if (escaped_char === "?") {
    diag.span_suggestion_verbose(
      err_span,
      "if you meant to write a literal question mark, don't escape the character",
      "?",
      Applicability.MaybeIncorrect,
    );
    return;
  }

  if (u8_from_str_radix(escaped_char, 8) !== undefined) {
    diag.help("if you meant to write an ASCII control code, use a `\\xNN` hex escape");
    return;
  }

  let name: string;
  let hex: string;
  switch (escaped_char) {
    case "a":
      [name, hex] = ["an audible bell", "07"];
      break;
    case "b":
      [name, hex] = ["a backspace", "08"];
      break;
    case "f":
      [name, hex] = ["a form feed", "0C"];
      break;
    case "v":
      [name, hex] = ["a vertical tab", "0B"];
      break;
    case "e":
      [name, hex] = ["an ANSI escape sequence", "1B"];
      break;
    default:
      return;
  }

  diag.span_suggestion_verbose(escape_span, `if you meant to write ${name}, use a hex escape`, `x${hex}`, Applicability.MaybeIncorrect);
}

/// Pushes a character to a message string for error reporting
// rustc: compiler/rustc_parse/src/lexer/unescape_error_reporting.rs:348 escaped_char
export function escaped_char(c: number): string {
  if (c >= 0x20 && c <= 0x7e) {
    // Don't escape \, ' or " for user-facing messages
    return String.fromCodePoint(c);
  }
  return char_escape_default(c);
}
