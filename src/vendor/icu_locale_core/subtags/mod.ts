// Port of icu_locale_core 2.3.0 `src/subtags/mod.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! Language Identifier and Locale contains a set of subtags
//! which represent different fields of the structure.
//!
//! * [`Language`] is the only mandatory field, which when empty,
//!   takes the value `und`.
//! * [`Script`] is an optional field representing the written script used by the locale.
//! * [`Region`] is the region used by the locale.
//! * [`Variants`] is a list of optional [`Variant`] subtags containing information about the
//!   variant adjustments used by the locale.
//!
//! Subtags can be used in isolation, and all basic operations such as parsing, syntax normalization
//! and serialization are supported on each individual subtag, but most commonly
//! they are used to construct a [`LanguageIdentifier`] instance.
//!
//! [`Variants`] is a special structure which contains a list of [`Variant`] subtags.
//! It is wrapped around to allow for sorting and deduplication of variants, which
//! is one of the required steps of language identifier and locale syntax normalization.
//!
//! [`LanguageIdentifier`]: super::LanguageIdentifier
import type { Result } from "../../../std/result.ts";
import { TinyAsciiStr } from "../../tinystr/ascii.ts";
import { subtag_from_raw_unchecked, subtag_macro, subtag_try_from_str, subtag_try_from_utf8, TinystrSubtag, type TinystrSubtagSpec } from "../helpers.ts";
import type { ParseError } from "../parser/errors.ts";

// mod language; mod region; mod script; mod variant; mod variants;
export { Language, language } from "./language.ts";
export { Region, region } from "./region.ts";
export { Script, script } from "./script.ts";
export { Variant, variant } from "./variant.ts";
export { Variants } from "./variants.ts";

// impl_tinystr_subtag!(
/// A generic subtag.
///
/// The subtag has to be an ASCII alphanumerical string no shorter than
/// two characters and no longer than eight.
///
/// # Examples
///
/// ```
/// use icu::locale::subtags::Subtag;
///
/// let subtag1: Subtag = "Foo".parse()
///     .expect("Failed to parse a Subtag.");
///
/// assert_eq!(subtag1.as_str(), "foo");
/// ```
export class Subtag extends TinystrSubtag {
  static readonly SPEC: TinystrSubtagSpec<Subtag> = {
    path: "subtags::Subtag",
    len_start: 2,
    len_end: 8,
    validate: (s) => s.is_ascii_alphanumeric(),
    normalize: (s) => s.to_ascii_lowercase(),
    is_normalized: (s) => s.is_ascii_alphanumeric() && s.is_ascii_lowercase(),
    error: "InvalidSubtag",
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
  private declare readonly __brand_Subtag: void;

  // crate: icu_locale_core-2.3.0/src/subtags/mod.rs:97 valid_key
  static valid_key(v: Uint8Array): boolean {
    return 2 <= v.length && v.length <= 8;
  }

  /// Returns the length of `self`.
  ///
  /// # Examples
  ///
  /// ```
  /// use icu::locale::subtags::subtag;
  /// let s = subtag!("foo");
  /// assert_eq!(s.len(), 3);
  /// ```
  // crate: icu_locale_core-2.3.0/src/subtags/mod.rs:110 len
  len(): number {
    return this._0.len();
  }

  // crate: icu_locale_core-2.3.0/src/subtags/mod.rs:115 from_tinystr_unvalidated
  static from_tinystr_unvalidated(input: TinyAsciiStr): Subtag {
    return new Subtag(input);
  }

  // crate: icu_locale_core-2.3.0/src/subtags/mod.rs:120 as_tinystr
  as_tinystr(): TinyAsciiStr {
    return new TinyAsciiStr(this._0.bytes.slice());
  }

  // crate: icu_locale_core-2.3.0/src/subtags/mod.rs:125 to_ascii_lowercase
  to_ascii_lowercase(): Subtag {
    return new Subtag(this._0.to_ascii_lowercase());
  }

  // impl<const N: usize> TryFrom<tinystr::TinyAsciiStr<N>> for Subtag
  // crate: icu_locale_core-2.3.0/src/subtags/mod.rs:133 try_from
  static try_from(value: TinyAsciiStr): Result<Subtag, ParseError> {
    return Subtag.try_from_str(value.as_str());
  }

  // impl PartialEq<str> for Subtag
  // crate: icu_locale_core-2.3.0/src/subtags/mod.rs:139 eq
  eq_str(other: string): boolean {
    return this._0.eq_str(other);
  }
}

/** `subtag!("..")` */
export function subtag(s: string): Subtag {
  return subtag_macro(Subtag.SPEC, s);
}
