// Port of icu_locale_core 2.3.0 `src/extensions/private/other.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import type { Result } from "../../../../std/result.ts";
import { subtag_from_raw_unchecked, subtag_macro, subtag_try_from_str, subtag_try_from_utf8, TinystrSubtag, type TinystrSubtagSpec } from "../../helpers.ts";
import type { ParseError } from "../../parser/errors.ts";

// impl_tinystr_subtag!(
/// A single item used in a list of [`Private`](super::Private) extensions.
///
/// The subtag has to be an ASCII alphanumerical string no shorter than
/// one character and no longer than eight.
export class Subtag extends TinystrSubtag {
  static readonly SPEC: TinystrSubtagSpec<Subtag> = {
    path: "extensions::private::Subtag",
    len_start: 1,
    len_end: 8,
    validate: (s) => s.is_ascii_alphanumeric(),
    normalize: (s) => s.to_ascii_lowercase(),
    is_normalized: (s) => s.is_ascii_alphanumeric() && s.is_ascii_lowercase(),
    error: "InvalidExtension",
    make: (s) => new Subtag(s),
  };
  static try_from_str(s: string): Result<Subtag, ParseError> {
    return subtag_try_from_str(Subtag.SPEC, s);
  }
  static try_from_utf8(code_units: Uint8Array): Result<Subtag, ParseError> {
    return subtag_try_from_utf8(Subtag.SPEC, code_units);
  }
  static from_raw_unchecked(v: Uint8Array): Subtag {
    return subtag_from_raw_unchecked(Subtag.SPEC, v);
  }

  /** Nominal brand (TS classes are structural). */
  private declare readonly __brand_PrivateSubtag: void;
}

/** `subtag!("..")` (`extensions_private_subtag!`) */
export function subtag(s: string): Subtag {
  return subtag_macro(Subtag.SPEC, s);
}
