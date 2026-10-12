// Port of icu_locale_core 2.3.0 `src/extensions/unicode/subdivision.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import type { Result } from "../../../../std/result.ts";
import { subtag_from_raw_unchecked, subtag_macro, subtag_try_from_str, subtag_try_from_utf8, TinystrSubtag, type TinystrSubtagSpec } from "../../helpers.ts";
import { Err, Ok } from "../../../../std/result.ts";
import { utf8 } from "../../../../std/str.ts";
import { is_ascii_alphabetic, is_ascii_digit } from "../../../../std/char.ts";
import { type FmtWrite, type fmt_Result, type LengthHint, type PartsWrite, type Writeable, Writeable_write_to_parts, Writeable_write_to_string, Writeable_writeable_borrow } from "../../../writeable/lib.ts";
import { add } from "../../../writeable/ops.ts";
import type { ParseError } from "../../parser/errors.ts";
import { Region } from "../../subtags/region.ts";
import { Subtag } from "../../subtags/mod.ts";

// impl_tinystr_subtag!(
/// A subdivision suffix used in [`SubdivisionId`].
///
/// This suffix represents a specific subdivision code under a given [`Region`].
/// For example the value of [`SubdivisionId`] may be `gbsct`, where the [`SubdivisionSuffix`]
/// is `sct` for Scotland.
///
/// Such a value associated with a key `rg` means that the locale should use Unit Preferences
/// (default calendar, currency, week data, time cycle, measurement system) for Scotland, even if the
/// [`LanguageIdentifier`](crate::LanguageIdentifier) is `en-US`.
///
/// A subdivision suffix has to be a sequence of alphanumerical characters no
/// shorter than one and no longer than four characters.
export class SubdivisionSuffix extends TinystrSubtag {
  static readonly SPEC: TinystrSubtagSpec<SubdivisionSuffix> = {
    path: "extensions::unicode::SubdivisionSuffix",
    len_start: 1,
    len_end: 4,
    validate: (s) => s.is_ascii_alphanumeric(),
    normalize: (s) => s.to_ascii_lowercase(),
    is_normalized: (s) => s.is_ascii_alphanumeric() && s.is_ascii_lowercase(),
    error: "InvalidExtension",
    make: (s) => new SubdivisionSuffix(s),
  };
  static try_from_str(s: string): Result<SubdivisionSuffix, ParseError> {
    return subtag_try_from_str(SubdivisionSuffix.SPEC, s);
  }
  static try_from_utf8(code_units: Uint8Array): Result<SubdivisionSuffix, ParseError> {
    return subtag_try_from_utf8(SubdivisionSuffix.SPEC, code_units);
  }
  static from_raw_unchecked(v: Uint8Array): SubdivisionSuffix {
    return subtag_from_raw_unchecked(SubdivisionSuffix.SPEC, v);
  }

  /** Nominal brand (TS classes are structural). */
  private declare readonly __brand_SubdivisionSuffix: void;

  // PORT: a lazily initialized getter (see `Language::UNKNOWN`).
  static get UNKNOWN(): SubdivisionSuffix {
    return (UNKNOWN_ ??= subdivision_suffix("zzzz"));
  }

  // crate: icu_locale_core-2.3.0/src/extensions/unicode/subdivision.rs:52 is_unknown
  is_unknown(): boolean {
    return this.eq(SubdivisionSuffix.UNKNOWN);
  }
}

/** `subdivision_suffix!("..")` */
export function subdivision_suffix(s: string): SubdivisionSuffix {
  return subtag_macro(SubdivisionSuffix.SPEC, s);
}

/// A Subivision Id as defined in [`Unicode Locale Identifier`].
///
/// Subdivision Id is used in [`Unicode`] extensions:
///  * `rg` - Regional Override
///  * `sd` - Regional Subdivision
///
/// In both cases the subdivision is composed of a [`Region`] and a [`SubdivisionSuffix`] which represents
/// different meaning depending on the key.
///
/// [`Unicode Locale Identifier`]: https://unicode.org/reports/tr35/tr35.html#unicode_subdivision_id
/// [`Unicode`]: crate::extensions::unicode::Unicode
// #[derive(Debug, PartialEq, Eq, Clone, Hash, PartialOrd, Ord, Copy)] #[non_exhaustive]
export class SubdivisionId implements Writeable {
  constructor(
    /// A region field of a Subdivision Id.
    public region: Region,
    /// A subdivision suffix field of a Subdivision Id.
    public suffix: SubdivisionSuffix,
  ) {}

  /// Returns a new [`SubdivisionId`].
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/subdivision.rs:112 new
  static new(region: Region, suffix: SubdivisionSuffix): SubdivisionId {
    return new SubdivisionId(region, suffix);
  }

  /// A constructor which takes a str slice, parses it and
  /// produces a well-formed [`SubdivisionId`].
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/subdivision.rs:161 try_from_str
  static try_from_str(s: string): Result<SubdivisionId, ParseError> {
    return SubdivisionId.try_from_utf8(utf8(s));
  }

  /// See [`Self::try_from_str`]
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/subdivision.rs:166 try_from_utf8
  static try_from_utf8(code_units: Uint8Array): Result<SubdivisionId, ParseError> {
    const r = Subtag.try_from_utf8(code_units);
    if (r.$ === "Err") return r;
    return SubdivisionId.try_from_subtag(r._0);
  }

  // crate: icu_locale_core-2.3.0/src/extensions/unicode/subdivision.rs:170 try_from_subtag
  static try_from_subtag(subtag: Subtag): Result<SubdivisionId, ParseError> {
    const code_units = utf8(subtag.as_str());
    if (code_units.length === 0) {
      return Err("InvalidExtension");
    }
    const first = code_units[0]!;
    let region_len: number;
    if (is_ascii_alphabetic(first)) {
      region_len = 2;
    } else if (is_ascii_digit(first)) {
      region_len = 3;
    } else {
      return Err("InvalidExtension");
    }
    if (region_len > code_units.length) {
      return Err("InvalidExtension");
    }
    const region_code_units = code_units.subarray(0, region_len);
    const suffix_code_units = code_units.subarray(region_len);
    const region = Region.try_from_utf8(region_code_units);
    if (region.$ === "Err") {
      return Err("InvalidExtension");
    }
    const suffix = SubdivisionSuffix.try_from_utf8(suffix_code_units);
    if (suffix.$ === "Err") {
      return Err("InvalidExtension");
    }
    return Ok(new SubdivisionId(region._0, suffix._0));
  }

  /// Convert to [`Subtag`]
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/subdivision.rs:196 into_subtag
  into_subtag(): Subtag {
    const result = this.region.to_tinystr().to_ascii_lowercase().concat(this.suffix.to_tinystr(), 8);
    return Subtag.from_tinystr_unvalidated(result);
  }

  // impl writeable::Writeable for SubdivisionId
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/subdivision.rs:208 write_to
  write_to(sink: FmtWrite): fmt_Result {
    const r = sink.write_str(this.region.to_tinystr().to_ascii_lowercase().as_str());
    if (r.$ === "Err") return r;
    return sink.write_str(this.suffix.as_str());
  }

  // crate: icu_locale_core-2.3.0/src/extensions/unicode/subdivision.rs:214 writeable_length_hint
  writeable_length_hint(): LengthHint {
    return add(this.region.writeable_length_hint(), this.suffix.writeable_length_hint());
  }

  write_to_parts(sink: PartsWrite): fmt_Result {
    return Writeable_write_to_parts(this, sink);
  }
  writeable_borrow(): string | undefined {
    return Writeable_writeable_borrow(this);
  }
  write_to_string(): string {
    return Writeable_write_to_string(this);
  }
  /** `impl_display_with_writeable!` */
  to_string(): string {
    return this.write_to_string();
  }

  /** `#[derive(PartialEq)]` */
  eq(other: SubdivisionId): boolean {
    return this.region.eq(other.region) && this.suffix.eq(other.suffix);
  }

  /** `#[derive(Ord)]` */
  cmp(other: SubdivisionId): -1 | 0 | 1 {
    return this.region.cmp(other.region) || this.suffix.cmp(other.suffix);
  }

  // impl FromStr for SubdivisionId
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/subdivision.rs:225 from_str
  static from_str(s: string): Result<SubdivisionId, ParseError> {
    return SubdivisionId.try_from_str(s);
  }
}

let UNKNOWN_: SubdivisionSuffix | undefined;
