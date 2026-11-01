// Port of library/proc_macro/src/escape.rs.
//
// PORT: library crate, `// std:` markers (decision 2026-10-13, see diagnostic.ts). `String` results are JS
// strings; the input `&[u8]` is a `Uint8Array`.

import { escape_char } from "../std/fmt.ts";
import { run_utf8_validation } from "../std/str.ts";

// std-type: library/proc_macro/src/escape.rs:2 EscapeOptions
export interface EscapeOptions {
  /// Produce \'.
  escape_single_quote: boolean;
  /// Produce \".
  escape_double_quote: boolean;
  /// Produce \x escapes for non-ASCII, and use \x rather than \u for ASCII
  /// control characters.
  escape_nonascii: boolean;
}

// std: library/proc_macro/src/escape.rs:12 escape_bytes
export function escape_bytes(bytes: Uint8Array, opt: EscapeOptions): string {
  const repr = { s: "" };

  if (opt.escape_nonascii) {
    for (const byte of bytes) {
      escape_single_byte(byte, opt, repr);
    }
  } else {
    for (const chunk of utf8_chunks(bytes)) {
      for (const ch of chunk.valid) {
        escape_single_char(ch.codePointAt(0)!, opt, repr);
      }
      for (const byte of chunk.invalid) {
        escape_single_byte(byte, opt, repr);
      }
    }
  }

  return repr.s;
}

// std: library/proc_macro/src/escape.rs:33 escape_single_byte
function escape_single_byte(byte: number, opt: EscapeOptions, repr: { s: string }): void {
  if (byte === 0x00) {
    repr.s += "\\0";
  } else if ((byte === 0x27 && !opt.escape_single_quote) || (byte === 0x22 && !opt.escape_double_quote)) {
    repr.s += String.fromCharCode(byte);
  } else {
    // Escapes \t, \r, \n, \\, \', \", and uses \x## for non-ASCII and
    // for ASCII control characters.
    repr.s += u8_escape_ascii(byte);
  }
}

// std: library/proc_macro/src/escape.rs:47 escape_single_char
function escape_single_char(ch: number, opt: EscapeOptions, repr: { s: string }): void {
  if ((ch === 0x27 && !opt.escape_single_quote) || (ch === 0x22 && !opt.escape_double_quote)) {
    repr.s += String.fromCodePoint(ch);
  } else {
    // Escapes \0, \t, \r, \n, \\, \', \", and uses \u{...} for
    // non-printable characters and for Grapheme_Extend characters, which
    // includes things like U+0300 "Combining Grave Accent".
    // PORT: `char::escape_debug` (ESCAPE_ALL) is `escape_char(c, true, true)` (src/std/fmt.ts).
    repr.s += escape_char(ch, true, true);
  }
}

/**
 * PORT: `u8::escape_ascii` (library/core/src/ascii/ascii_char.rs / num/mod.rs: `\t`, `\r`, `\n`, `\\`, `\'`, `\"`,
 * printable ASCII as is, everything else `\x` + two lowercase hex digits). src/std has no such helper.
 */
function u8_escape_ascii(byte: number): string {
  switch (byte) {
    case 0x09:
      return "\\t";
    case 0x0d:
      return "\\r";
    case 0x0a:
      return "\\n";
    case 0x5c:
      return "\\\\";
    case 0x27:
      return "\\'";
    case 0x22:
      return '\\"';
  }
  if (byte >= 0x20 && byte < 0x7f) return String.fromCharCode(byte);
  return "\\x" + byte.toString(16).padStart(2, "0");
}

/**
 * PORT: `<[u8]>::utf8_chunks` (library/core/src/str/lossy.rs `Utf8Chunks`): each chunk is the longest valid prefix
 * (`valid`, decoded) followed by the invalid sequence after it (`Utf8Error::error_len` bytes, or the rest of the
 * input for an incomplete sequence at the end). Built on src/std/str.ts `run_utf8_validation`.
 */
function utf8_chunks(bytes: Uint8Array): { valid: string; invalid: Uint8Array }[] {
  const out: { valid: string; invalid: Uint8Array }[] = [];
  const dec = new TextDecoder("utf-8", { fatal: true });
  let rest = bytes;
  while (rest.length > 0) {
    const err = run_utf8_validation(rest);
    if (err === undefined) {
      out.push({ valid: dec.decode(rest), invalid: rest.subarray(rest.length) });
      break;
    }
    const valid_up_to = err.valid_up_to();
    const invalid_len = err.error_len() ?? rest.length - valid_up_to;
    out.push({
      valid: dec.decode(rest.subarray(0, valid_up_to)),
      invalid: rest.subarray(valid_up_to, valid_up_to + invalid_len),
    });
    rest = rest.subarray(valid_up_to + invalid_len);
  }
  return out;
}
