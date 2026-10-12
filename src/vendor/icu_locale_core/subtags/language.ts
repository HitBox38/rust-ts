// Port of icu_locale_core 2.3.0 `src/subtags/language.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import type { Result } from "../../../std/result.ts";
import { subtag_from_raw_unchecked, subtag_macro, subtag_try_from_str, subtag_try_from_utf8, TinystrSubtag, type TinystrSubtagSpec } from "../helpers.ts";
import type { ParseError } from "../parser/errors.ts";

// impl_tinystr_subtag!(
/// A language subtag (examples: `"en"`, `"csb"`, `"zh"`, `"und"`, etc.)
///
/// [`Language`] represents a Unicode base language code conformant to the
/// [`unicode_language_id`] field of the Language and Locale Identifier.
///
/// # Pre-defined languages
///
/// For the language code `und`, see [`Language::UNKNOWN`]
///
/// [`unicode_language_id`]: https://unicode.org/reports/tr35/#unicode_language_id
export class Language extends TinystrSubtag {
  static readonly SPEC: TinystrSubtagSpec<Language> = {
    path: "subtags::Language",
    len_start: 2,
    len_end: 3,
    validate: (s) => s.is_ascii_alphabetic(),
    normalize: (s) => s.to_ascii_lowercase(),
    is_normalized: (s) => s.is_ascii_alphabetic_lowercase(),
    error: "InvalidLanguage",
    make: (s) => new Language(s),
  };
  static try_from_str(s: string): Result<Language, ParseError> {
    return subtag_try_from_str(Language.SPEC, s);
  }
  static try_from_utf8(code_units: Uint8Array): Result<Language, ParseError> {
    return subtag_try_from_utf8(Language.SPEC, code_units);
  }
  static from_raw_unchecked(v: Uint8Array): Language {
    return subtag_from_raw_unchecked(Language.SPEC, v);
  }

  /// The default undefined language "und". Same as [`default()`](Default::default()).
  // PORT: a lazily initialized getter (a static initializer cannot call `language!` while the
  // class binding is still uninitialized).
  static get UNKNOWN(): Language {
    return (UNKNOWN_ ??= language("und"));
  }

  /// Whether this [`Language`] equals [`Language::UNKNOWN`].
  // crate: icu_locale_core-2.3.0/src/subtags/language.rs:58 is_unknown
  is_unknown(): boolean {
    return this.eq(Language.UNKNOWN);
  }

  /** Nominal brand (TS classes are structural). */
  private declare readonly __brand_Language: void;
}

/** `language!("..")` */
export function language(s: string): Language {
  return subtag_macro(Language.SPEC, s);
}


let UNKNOWN_: Language | undefined;
