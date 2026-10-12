// Port of icu_locale_core 2.3.0 `src/subtags/region.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import type { Result } from "../../../std/result.ts";
import { subtag_from_raw_unchecked, subtag_macro, subtag_try_from_str, subtag_try_from_utf8, TinystrSubtag, type TinystrSubtagSpec } from "../helpers.ts";
import type { ParseError } from "../parser/errors.ts";

// impl_tinystr_subtag!(
/// A region subtag (examples: `"US"`, `"CN"`, `"AR"` etc.)
///
/// [`Region`] represents a Unicode base language code conformant to the
/// [`unicode_region_id`] field of the Language and Locale Identifier.
///
/// [`unicode_region_id`]: https://unicode.org/reports/tr35/#unicode_region_id
export class Region extends TinystrSubtag {
  static readonly SPEC: TinystrSubtagSpec<Region> = {
    path: "subtags::Region",
    len_start: 2,
    len_end: 3,
    validate: (s) => s.len() === 2 ? s.is_ascii_alphabetic() : s.is_ascii_numeric(),
    normalize: (s) => s.len() === 2 ? s.to_ascii_uppercase() : s,
    is_normalized: (s) => s.len() === 2 ? s.is_ascii_alphabetic_uppercase() : s.is_ascii_numeric(),
    error: "InvalidSubtag",
    make: (s) => new Region(s),
  };
  static try_from_str(s: string): Result<Region, ParseError> {
    return subtag_try_from_str(Region.SPEC, s);
  }
  static try_from_utf8(code_units: Uint8Array): Result<Region, ParseError> {
    return subtag_try_from_utf8(Region.SPEC, code_units);
  }
  static from_raw_unchecked(v: Uint8Array): Region {
    return subtag_from_raw_unchecked(Region.SPEC, v);
  }

  /** Nominal brand (TS classes are structural). */
  private declare readonly __brand_Region: void;

  /// Returns true if the Region has an alphabetic code.
  ///
  /// # Examples
  ///
  /// ```
  /// use icu::locale::subtags::region;
  ///
  /// assert!(region!("us").is_alphabetic());
  /// ```
  // crate: icu_locale_core-2.3.0/src/subtags/region.rs:60 is_alphabetic
  is_alphabetic(): boolean {
    return this._0.len() === 2;
  }
}

/** `region!("..")` */
export function region(s: string): Region {
  return subtag_macro(Region.SPEC, s);
}
