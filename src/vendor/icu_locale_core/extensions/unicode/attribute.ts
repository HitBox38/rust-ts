// Port of icu_locale_core 2.3.0 `src/extensions/unicode/attribute.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import type { Result } from "../../../../std/result.ts";
import { subtag_from_raw_unchecked, subtag_macro, subtag_try_from_str, subtag_try_from_utf8, TinystrSubtag, type TinystrSubtagSpec } from "../../helpers.ts";
import type { ParseError } from "../../parser/errors.ts";

// impl_tinystr_subtag!(
/// An attribute used in a set of [`Attributes`](super::Attributes).
///
/// An attribute has to be a sequence of alphanumerical characters no
/// shorter than three and no longer than eight characters.
export class Attribute extends TinystrSubtag {
  static readonly SPEC: TinystrSubtagSpec<Attribute> = {
    path: "extensions::unicode::Attribute",
    len_start: 3,
    len_end: 8,
    validate: (s) => s.is_ascii_alphanumeric(),
    normalize: (s) => s.to_ascii_lowercase(),
    is_normalized: (s) => s.is_ascii_alphanumeric() && s.is_ascii_lowercase(),
    error: "InvalidExtension",
    make: (s) => new Attribute(s),
  };
  static try_from_str(s: string): Result<Attribute, ParseError> {
    return subtag_try_from_str(Attribute.SPEC, s);
  }
  static try_from_utf8(code_units: Uint8Array): Result<Attribute, ParseError> {
    return subtag_try_from_utf8(Attribute.SPEC, code_units);
  }
  static from_raw_unchecked(v: Uint8Array): Attribute {
    return subtag_from_raw_unchecked(Attribute.SPEC, v);
  }

  /** Nominal brand (TS classes are structural). */
  private declare readonly __brand_Attribute: void;
}

/** `attribute!("..")` */
export function attribute(s: string): Attribute {
  return subtag_macro(Attribute.SPEC, s);
}
