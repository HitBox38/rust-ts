// Port of icu_locale_core 2.3.0 `src/extensions/unicode/key.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import type { Result } from "../../../../std/result.ts";
import { subtag_from_raw_unchecked, subtag_macro, subtag_try_from_str, subtag_try_from_utf8, TinystrSubtag, type TinystrSubtagSpec } from "../../helpers.ts";
import type { ParseError } from "../../parser/errors.ts";
import { is_ascii_alphabetic, is_ascii_alphanumeric, is_ascii_digit } from "../../../../std/char.ts";
import { u8_is_ascii_lowercase } from "../../../tinystr/asciibyte.ts";
// impl_tinystr_subtag!(
/// A key used in a list of [`Keywords`](super::Keywords).
///
/// The key has to be a two ASCII alphanumerical characters long, with the first
/// character being alphanumeric, and the second being alphabetic.
export class Key extends TinystrSubtag {
  static readonly SPEC: TinystrSubtagSpec<Key> = {
    path: "extensions::unicode::Key",
    len_start: 2,
    len_end: 2,
    validate: (s) => is_ascii_alphanumeric(s.all_bytes()[0]!) && is_ascii_alphabetic(s.all_bytes()[1]!),
    normalize: (s) => s.to_ascii_lowercase(),
    is_normalized: (s) => (u8_is_ascii_lowercase(s.all_bytes()[0]!) || is_ascii_digit(s.all_bytes()[0]!)) && u8_is_ascii_lowercase(s.all_bytes()[1]!),
    error: "InvalidExtension",
    make: (s) => new Key(s),
  };
  static try_from_str(s: string): Result<Key, ParseError> {
    return subtag_try_from_str(Key.SPEC, s);
  }
  static try_from_utf8(code_units: Uint8Array): Result<Key, ParseError> {
    return subtag_try_from_utf8(Key.SPEC, code_units);
  }
  static from_raw_unchecked(v: Uint8Array): Key {
    return subtag_from_raw_unchecked(Key.SPEC, v);
  }

  /** Nominal brand (TS classes are structural). */
  private declare readonly __brand_Key: void;
}

/** `key!("..")` */
export function key(s: string): Key {
  return subtag_macro(Key.SPEC, s);
}
