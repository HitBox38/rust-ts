// Port of icu_locale_core 2.3.0 `src/locale.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import { panic } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import { cmp_utf8, type Ordering } from "../writeable/cmp.ts";
import { Extensions } from "./extensions/mod.ts";
import { Attributes } from "./extensions/unicode/attributes.ts";
import { Keywords } from "./extensions/unicode/keywords.ts";
import { Unicode } from "./extensions/unicode/mod.ts";
import { Value } from "./extensions/unicode/value.ts";
import { EachSubtagWriteable, each_subtag_writeable_borrow } from "./helpers.ts";
import { LanguageIdentifier } from "./langid.ts";
import type { ParseError } from "./parser/errors.ts";
import type { SingleVariantSingleKeyword } from "./parser/langid.ts";
import { parse_locale, parse_locale_with_single_variant_single_keyword_unicode_keyword_extension } from "./parser/locale.ts";
import { SubtagIterator } from "./parser/mod.ts";
import { Language } from "./subtags/language.ts";
import { Region } from "./subtags/region.ts";
import { Script } from "./subtags/script.ts";
import { Variant } from "./subtags/variant.ts";
import { Variants } from "./subtags/variants.ts";

/// A core struct representing a [`Unicode Locale Identifier`].
///
/// A locale is made of two parts:
///  * Unicode Language Identifier
///  * A set of Unicode Extensions
///
/// (Examples and details of upstream's type docs are not repeated here.)
///
/// [`Unicode Locale Identifier`]: https://unicode.org/reports/tr35/tr35.html#Unicode_locale_identifier
// #[derive(PartialEq, Eq, Clone, Hash)] // no Ord or PartialOrd: see docs
export class Locale extends EachSubtagWriteable {
  constructor(
    /// The basic language/script/region components in the locale identifier along with any variants.
    public id: LanguageIdentifier,
    /// Any extensions present in the locale identifier.
    public extensions: Extensions,
  ) {
    super();
  }

  // crate-skip: icu_locale_core-2.3.0/src/locale.rs:112 test_sizes checks Rust memory layout (`size_of`); not applicable

  /// The unknown locale "und".
  static get UNKNOWN(): Locale {
    return locale("und");
  }

  /// A constructor which takes a str slice, parses it and
  /// produces a well-formed [`Locale`].
  // crate: icu_locale_core-2.3.0/src/locale.rs:155 try_from_str
  static try_from_str(s: string): Result<Locale, ParseError> {
    return Locale.try_from_utf8(utf8(s));
  }

  /// See [`Self::try_from_str`]
  // crate: icu_locale_core-2.3.0/src/locale.rs:163 try_from_utf8
  static try_from_utf8(code_units: Uint8Array): Result<Locale, ParseError> {
    return parse_locale(code_units);
  }

  // crate-skip: icu_locale_core-2.3.0/src/locale.rs:184 normalize_utf8 needs `writeable::to_string_or_borrow` (not ported); unused on rustc's path
  // crate-skip: icu_locale_core-2.3.0/src/locale.rs:206 normalize needs `writeable::to_string_or_borrow` (not ported); unused on rustc's path

  /// Compare this [`Locale`] with BCP-47 bytes.
  // crate: icu_locale_core-2.3.0/src/locale.rs:264 strict_cmp
  strict_cmp(other: Uint8Array): Ordering {
    return cmp_utf8(this, other);
  }

  // crate-skip: icu_locale_core-2.3.0/src/locale.rs:269 as_tuple only used by `total_cmp` (not ported)
  // crate-skip: icu_locale_core-2.3.0/src/locale.rs:374 total_cmp derived `Ord` over the extension types not ported; unused on rustc's path

  /// Compare this `Locale` with a potentially unnormalized BCP-47 string.
  ///
  /// The return value is equivalent to what would happen if you first parsed the
  /// BCP-47 string to a `Locale` and then performed a structural comparison.
  // crate: icu_locale_core-2.3.0/src/locale.rs:404 normalizing_eq
  normalizing_eq(other: string): boolean {
    // macro_rules! subtag_matches
    const subtag_matches = <T extends { eq(o: T): boolean }>(
      try_from_utf8: (b: Uint8Array) => Result<T, ParseError>,
      iter: SubtagIterator,
      expected: T,
    ): boolean => {
      const b = iter.next();
      if (b === undefined) return false;
      const r = try_from_utf8(b);
      return r.$ === "Ok" && r._0.eq(expected);
    };

    const iter = SubtagIterator.new(utf8(other));
    if (!subtag_matches(Language.try_from_utf8, iter, this.id.language)) {
      return false;
    }
    if (this.id.script !== undefined && !subtag_matches(Script.try_from_utf8, iter, this.id.script)) {
      return false;
    }
    if (this.id.region !== undefined && !subtag_matches(Region.try_from_utf8, iter, this.id.region)) {
      return false;
    }
    for (const variant of this.id.variants.deref()) {
      if (!subtag_matches(Variant.try_from_utf8, iter, variant)) {
        return false;
      }
    }
    if (!this.extensions.is_empty()) {
      const exts = Extensions.try_from_iter(iter);
      if (exts.$ === "Ok") {
        if (!this.extensions.eq(exts._0)) {
          return false;
        }
      } else {
        return false;
      }
    }
    return iter.next() === undefined;
  }

  // crate: icu_locale_core-2.3.0/src/locale.rs:450 try_from_utf8_with_single_variant_single_keyword_unicode_extension
  static try_from_utf8_with_single_variant_single_keyword_unicode_extension(
    code_units: Uint8Array,
  ): Result<SingleVariantSingleKeyword, ParseError> {
    return parse_locale_with_single_variant_single_keyword_unicode_keyword_extension(code_units, "Locale");
  }

  // crate: icu_locale_core-2.3.0/src/locale.rs:468 for_each_subtag_str
  for_each_subtag_str<E>(f: (subtag: string) => Result<undefined, E>): Result<undefined, E> {
    let r = this.id.for_each_subtag_str(f);
    if (r.$ === "Err") return r;
    r = this.extensions.for_each_subtag_str(f);
    if (r.$ === "Err") return r;
    return Ok(undefined);
  }

  // impl AsRef<LanguageIdentifier> for Locale
  // crate: icu_locale_core-2.3.0/src/locale.rs:479 as_ref
  as_ref(): LanguageIdentifier {
    return this.id;
  }

  // impl FromStr for Locale
  // crate: icu_locale_core-2.3.0/src/locale.rs:490 from_str
  static from_str(s: string): Result<Locale, ParseError> {
    return Locale.try_from_str(s);
  }

  // impl From<LanguageIdentifier> for Locale
  // crate: icu_locale_core-2.3.0/src/locale.rs:496 from
  static from_langid(id: LanguageIdentifier): Locale {
    return new Locale(id, Extensions.default());
  }

  // impl From<Locale> for LanguageIdentifier
  // crate: icu_locale_core-2.3.0/src/locale.rs:505 from
  into_langid(): LanguageIdentifier {
    return this.id;
  }

  // impl core::fmt::Debug for Locale: `writeable::Writeable::write_to(self, f)`.
  // crate: icu_locale_core-2.3.0/src/locale.rs:511 fmt
  debug(): string {
    return this.to_string();
  }

  // impl_writeable_for_each_subtag_str_no_test!(Locale, selff, selff.extensions.is_empty() => selff.id.writeable_borrow())
  override writeable_borrow(): string | undefined {
    return each_subtag_writeable_borrow(this.extensions.is_empty(), () => this.id.writeable_borrow());
  }

  // impl From<subtags::Language> for Locale
  // crate: icu_locale_core-2.3.0/src/locale.rs:557 from
  static from_language(language: Language): Locale {
    return new Locale(LanguageIdentifier.from_language(language), Extensions.new());
  }

  // impl From<Option<subtags::Script>> for Locale
  // crate: icu_locale_core-2.3.0/src/locale.rs:574 from
  static from_script(script: Script | undefined): Locale {
    return new Locale(LanguageIdentifier.from_script(script), Extensions.new());
  }

  // impl From<Option<subtags::Region>> for Locale
  // crate: icu_locale_core-2.3.0/src/locale.rs:591 from
  static from_region(region: Region | undefined): Locale {
    return new Locale(LanguageIdentifier.from_region(region), Extensions.new());
  }

  // impl From<(Language, Option<Script>, Option<Region>)> for Locale
  // crate: icu_locale_core-2.3.0/src/locale.rs:624 from
  static from_lsr(lsr: [Language, Script | undefined, Region | undefined]): Locale {
    return new Locale(LanguageIdentifier.from_lsr(lsr), Extensions.new());
  }

  /** `#[derive(PartialEq)]` */
  eq(other: Locale): boolean {
    return this.id.eq(other.id) && this.extensions.eq(other.extensions);
  }
}

/// A macro allowing for compile-time construction of valid [`Locale`]s.
///
/// The macro will perform syntax normalization of the tag.
// macro_rules! locale (macros.rs:120)
export function locale(s: string): Locale {
  const r = Locale.try_from_utf8_with_single_variant_single_keyword_unicode_extension(utf8(s));
  if (r.$ === "Ok") {
    const [language, script, region, variant, keyword] = r._0;
    return new Locale(
      new LanguageIdentifier(language, script, region, variant !== undefined ? Variants.from_variant(variant) : Variants.new()),
      keyword !== undefined
        ? Extensions.from_unicode(new Unicode(Keywords.new_single(keyword[0], Value.from_subtag(keyword[1])), Attributes.new()))
        : Extensions.new(),
    );
  }
  return panic(
    `Invalid locale: ${s} . Note the locale! macro only supports up to one variant tag; and one unicode keyword, other extension are not supported. Use runtime parsing instead.`,
  );
}
