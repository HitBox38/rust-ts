// Port of icu_locale_core 2.3.0 `src/subtags/variant.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import type { Result } from "../../../std/result.ts";
import { subtag_from_raw_unchecked, subtag_macro, subtag_try_from_str, subtag_try_from_utf8, TinystrSubtag, type TinystrSubtagSpec } from "../helpers.ts";
import type { ParseError } from "../parser/errors.ts";
import { is_ascii_digit } from "../../../std/char.ts";
// impl_tinystr_subtag!(
/// A variant subtag (examples: `"macos"`, `"posix"`, `"1996"` etc.)
///
/// [`Variant`] represents a Unicode base language code conformant to the
/// [`unicode_variant_id`] field of the Language and Locale Identifier.
///
/// [`unicode_variant_id`]: https://unicode.org/reports/tr35/#unicode_variant_id
export class Variant extends TinystrSubtag {
  static readonly SPEC: TinystrSubtagSpec<Variant> = {
    path: "subtags::Variant",
    len_start: 4,
    len_end: 8,
    validate: (s) => s.is_ascii_alphanumeric() && (s.len() !== 4 || is_ascii_digit(s.all_bytes()[0]!)),
    normalize: (s) => s.to_ascii_lowercase(),
    is_normalized: (s) => s.is_ascii_lowercase() && s.is_ascii_alphanumeric() && (s.len() !== 4 || is_ascii_digit(s.all_bytes()[0]!)),
    error: "InvalidSubtag",
    make: (s) => new Variant(s),
  };
  static try_from_str(s: string): Result<Variant, ParseError> {
    return subtag_try_from_str(Variant.SPEC, s);
  }
  static try_from_utf8(code_units: Uint8Array): Result<Variant, ParseError> {
    return subtag_try_from_utf8(Variant.SPEC, code_units);
  }
  static from_raw_unchecked(v: Uint8Array): Variant {
    return subtag_from_raw_unchecked(Variant.SPEC, v);
  }

  /** Nominal brand (TS classes are structural). */
  private declare readonly __brand_Variant: void;

}

/** `variant!("..")` */
export function variant(s: string): Variant {
  return subtag_macro(Variant.SPEC, s);
}
