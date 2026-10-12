// Port of icu_locale_core 2.3.0 `src/data.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import { panic } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import { cmp_utf8, type Ordering } from "../writeable/cmp.ts";
import { Extensions } from "./extensions/mod.ts";
import { Attributes } from "./extensions/unicode/attributes.ts";
import { Keywords } from "./extensions/unicode/keywords.ts";
import { Unicode } from "./extensions/unicode/mod.ts";
import { SubdivisionId, SubdivisionSuffix } from "./extensions/unicode/subdivision.ts";
import { EachSubtagWriteable, each_subtag_writeable_borrow } from "./helpers.ts";
import { cmp_option, eq_option, LanguageIdentifier } from "./langid.ts";
import { Locale } from "./locale.ts";
import type { ParseError } from "./parser/errors.ts";
import { parse_locale_with_single_variant_single_keyword_unicode_extension_from_iter } from "./parser/langid.ts";
import { SubtagIterator } from "./parser/mod.ts";
import { RegionalSubdivision } from "./preferences/extensions/unicode/keywords/regional_subdivision.ts";
import { LocalePreferences } from "./preferences/locale.ts";
import { Language } from "./subtags/language.ts";
import type { Subtag } from "./subtags/mod.ts";
import type { Region } from "./subtags/region.ts";
import type { Script } from "./subtags/script.ts";
import type { Variant } from "./subtags/variant.ts";
import { Variants } from "./subtags/variants.ts";

/// A locale type optimized for use in fallbacking and the ICU4X data pipeline.
///
/// [`DataLocale`] contains less functionality than [`Locale`] but more than
/// [`LanguageIdentifier`] for better size and performance while still meeting
/// the needs of the ICU4X data pipeline.
///
/// You can create a [`DataLocale`] from a borrowed [`Locale`], which is more
/// efficient than cloning the [`Locale`], but less efficient than converting an owned
/// [`Locale`]:
///
/// (Examples and details of upstream's type docs are not repeated here.)
// #[derive(Clone, Copy)] #[non_exhaustive]
export class DataLocale extends EachSubtagWriteable {
  constructor(
    /// Language subtag
    public language: Language,
    /// Script subtag
    public script: Script | undefined,
    /// Region subtag
    public region: Region | undefined,
    /// Variant subtag
    public variant: Variant | undefined,
    /// Subivision (-u-sd-) subtag
    // TODO(3.0): Use `SubdivisionSuffix` type
    public subdivision: Subtag | undefined,
  ) {
    super();
  }

  // impl PartialEq for DataLocale
  // crate: icu_locale_core-2.3.0/src/data.rs:89 eq
  eq(other: DataLocale): boolean {
    const [l1, s1, r1, v1] = this.as_tuple();
    const [l2, s2, r2, v2] = other.as_tuple();
    return l1.eq(l2) && eq_option(s1, s2) && eq_option(r1, r2) && eq_option(v1, v2);
  }

  // crate-skip: icu_locale_core-2.3.0/src/data.rs:97 hash `Hash` impl (no hashing in the TS port)

  // impl Default for DataLocale
  // crate: icu_locale_core-2.3.0/src/data.rs:103 default
  // (and the inherent `const fn default` at data.rs:116, and `Default for &DataLocale` at data.rs:128)
  static default(): DataLocale {
    return new DataLocale(Language.UNKNOWN, undefined, undefined, undefined, undefined);
  }
  // crate: icu_locale_core-2.3.0/src/data.rs:116 default
  static default_const(): DataLocale {
    return DataLocale.default();
  }
  // crate: icu_locale_core-2.3.0/src/data.rs:128 default
  static default_ref(): DataLocale {
    return DataLocale.default();
  }

  // impl fmt::Debug for DataLocale
  // crate: icu_locale_core-2.3.0/src/data.rs:135 fmt
  debug(): string {
    return `DataLocale{${this.to_string()}}`;
  }

  // impl_writeable_for_each_subtag_str_no_test!(DataLocale, selff, selff.script.is_none() && selff.region.is_none() && selff.variant.is_none() && selff.subdivision.is_none() => Some(selff.language.as_str()))
  override writeable_borrow(): string | undefined {
    return each_subtag_writeable_borrow(
      this.script === undefined && this.region === undefined && this.variant === undefined && this.subdivision === undefined,
      () => this.language.as_str(),
    );
  }

  // impl From<LanguageIdentifier> for DataLocale
  // crate: icu_locale_core-2.3.0/src/data.rs:143 from
  static from_langid_owned(langid: LanguageIdentifier): DataLocale {
    return DataLocale.from_langid(langid);
  }

  // impl From<Locale> for DataLocale
  // crate: icu_locale_core-2.3.0/src/data.rs:149 from
  static from_locale_owned(locale: Locale): DataLocale {
    return DataLocale.from_locale(locale);
  }

  // impl From<&LanguageIdentifier> for DataLocale
  // crate: icu_locale_core-2.3.0/src/data.rs:155 from
  static from_langid(langid: LanguageIdentifier): DataLocale {
    return new DataLocale(langid.language, langid.script, langid.region, langid.variants.deref()[0], undefined);
  }

  // impl From<&Locale> for DataLocale
  // crate: icu_locale_core-2.3.0/src/data.rs:167 from
  static from_locale(locale: Locale): DataLocale {
    return LocalePreferences.from_locale(locale).to_data_locale_language_priority();
  }

  // impl From<(Language, Option<Script>, Option<Region>)> for DataLocale
  // crate: icu_locale_core-2.3.0/src/data.rs:173 from
  static from_lsr([l, s, r]: [Language, Script | undefined, Region | undefined]): DataLocale {
    return DataLocale.from_parts(l, s, r !== undefined ? SubdivisionId.new(r, SubdivisionSuffix.UNKNOWN) : undefined, undefined);
  }

  // impl FromStr for DataLocale
  // crate: icu_locale_core-2.3.0/src/data.rs:186 from_str
  static from_str(s: string): Result<DataLocale, ParseError> {
    return DataLocale.try_from_str(s);
  }

  /// Parses a [`DataLocale`].
  // crate: icu_locale_core-2.3.0/src/data.rs:194 try_from_str
  static try_from_str(s: string): Result<DataLocale, ParseError> {
    return DataLocale.try_from_utf8(utf8(s));
  }

  /// Parses a [`DataLocale`] from a UTF-8 byte slice.
  // crate: icu_locale_core-2.3.0/src/data.rs:199 try_from_utf8
  static try_from_utf8(code_units: Uint8Array): Result<DataLocale, ParseError> {
    const r = parse_locale_with_single_variant_single_keyword_unicode_extension_from_iter(SubtagIterator.new(code_units), "Locale");
    if (r.$ === "Err") return r;
    const [language, script, region, variant, keyword] = r._0;
    let subdivision: SubdivisionId | undefined;
    if (keyword !== undefined) {
      const [key, value] = keyword;
      if (value !== undefined && key.eq(RegionalSubdivision.UNICODE_EXTENSION_KEY)) {
        const sd = SubdivisionId.try_from_subtag(value);
        if (sd.$ === "Err") {
          return Err("InvalidExtension");
        }
        const subdivision_ = sd._0;
        if (
          region !== undefined &&
          (region.into_raw()[0] !== subdivision_.region.into_raw()[0] ||
            region.into_raw()[1] !== subdivision_.region.into_raw()[1] ||
            region.into_raw()[2] !== subdivision_.region.into_raw()[2])
        ) {
          subdivision = SubdivisionId.new(region, SubdivisionSuffix.UNKNOWN);
        } else {
          subdivision = subdivision_;
        }
      } else {
        return Err("InvalidExtension");
      }
    } else if (region !== undefined) {
      subdivision = SubdivisionId.new(region, SubdivisionSuffix.UNKNOWN);
    } else {
      subdivision = undefined;
    }
    return Ok(DataLocale.from_parts(language, script, subdivision, variant));
  }

  // crate: icu_locale_core-2.3.0/src/data.rs:243 for_each_subtag_str
  for_each_subtag_str<E>(f: (subtag: string) => Result<undefined, E>): Result<undefined, E> {
    let r = f(this.language.as_str());
    if (r.$ === "Err") return r;
    if (this.script !== undefined) {
      r = f(this.script.as_str());
      if (r.$ === "Err") return r;
    }
    if (this.region !== undefined) {
      r = f(this.region.as_str());
      if (r.$ === "Err") return r;
    }
    if (this.variant !== undefined) {
      r = f(this.variant.as_str());
      if (r.$ === "Err") return r;
    }
    const extensions = this.extensions();
    if (extensions !== undefined) {
      r = extensions.for_each_subtag_str(f);
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  }

  // crate: icu_locale_core-2.3.0/src/data.rs:263 region_and_subdivision
  region_and_subdivision(): SubdivisionId | undefined {
    let sd: SubdivisionId | undefined = undefined;
    if (this.subdivision !== undefined) {
      const r = SubdivisionId.try_from_str(this.subdivision.as_str());
      if (r.$ === "Ok") sd = r._0;
    }
    if (sd !== undefined) return sd;
    if (this.region !== undefined) {
      return new SubdivisionId(this.region, SubdivisionSuffix.UNKNOWN);
    }
    return undefined;
  }

  // crate: icu_locale_core-2.3.0/src/data.rs:274 as_tuple
  as_tuple(): [Language, Script | undefined, SubdivisionId | undefined, Variant | undefined] {
    return [this.language, this.script, this.region_and_subdivision(), this.variant];
  }

  // crate: icu_locale_core-2.3.0/src/data.rs:290 from_parts
  static from_parts(language: Language, script: Script | undefined, region: SubdivisionId | undefined, variant: Variant | undefined): DataLocale {
    return new DataLocale(
      language,
      script,
      region !== undefined ? region.region : undefined,
      variant,
      region !== undefined ? region.into_subtag() : undefined,
    );
  }

  /// Returns an ordering suitable for use in [`BTreeSet`].
  // crate: icu_locale_core-2.3.0/src/data.rs:316 total_cmp
  total_cmp(other: DataLocale): Ordering {
    const [l1, s1, r1, v1] = this.as_tuple();
    const [l2, s2, r2, v2] = other.as_tuple();
    return l1.cmp(l2) || cmp_option(s1, s2) || cmp_option(r1, r2) || cmp_option(v1, v2);
  }

  /// Compare this [`DataLocale`] with BCP-47 bytes.
  ///
  /// The return value is equivalent to what would happen if you first converted this
  /// [`DataLocale`] to a BCP-47 string and then performed a byte comparison.
  ///
  /// This function is case-sensitive and results in a *total order*, so it is appropriate for
  /// binary search. The only argument producing [`Ordering::Equal`] is `self.to_string()`.
  // crate: icu_locale_core-2.3.0/src/data.rs:405 strict_cmp
  strict_cmp(other: Uint8Array): Ordering {
    return cmp_utf8(this, other);
  }

  /// Returns whether this [`DataLocale`] is `und` in the locale and extensions portion.
  // crate: icu_locale_core-2.3.0/src/data.rs:420 is_unknown
  is_unknown(): boolean {
    return (
      this.language.is_unknown() &&
      this.script === undefined &&
      this.region === undefined &&
      this.variant === undefined &&
      this.subdivision === undefined
    );
  }

  /// Converts this `DataLocale` into a [`Locale`].
  // crate: icu_locale_core-2.3.0/src/data.rs:429 into_locale
  into_locale(): Locale {
    return new Locale(
      new LanguageIdentifier(
        this.language,
        this.script,
        this.region,
        this.variant !== undefined ? Variants.from_variant(this.variant) : Variants.new(),
      ),
      this.extensions() ?? Extensions.default(),
    );
  }

  // crate: icu_locale_core-2.3.0/src/data.rs:444 extensions
  extensions(): Extensions | undefined {
    const sd = this.region_and_subdivision();
    // `.filter(|sd| !sd.suffix.is_unknown())?`
    if (sd === undefined || sd.suffix.is_unknown()) return undefined;
    return Extensions.from_unicode(
      new Unicode(
        Keywords.new_single(RegionalSubdivision.UNICODE_EXTENSION_KEY, RegionalSubdivision.into_value(new RegionalSubdivision(sd))),
        Attributes.new(),
      ),
    );
  }

  clone(): DataLocale {
    return new DataLocale(this.language, this.script, this.region, this.variant, this.subdivision);
  }
}

/** `data_locale!("..")` (macros.rs:176): `DataLocale::try_from_str` or panic. */
export function data_locale(s: string): DataLocale {
  const r = DataLocale.try_from_str(s);
  if (r.$ === "Ok") return r._0;
  return panic(`Invalid data locale: ${s}`);
}
