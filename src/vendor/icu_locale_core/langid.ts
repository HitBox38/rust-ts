// Port of icu_locale_core 2.3.0 `src/langid.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import { Ok, type Result } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import { cmp_utf8, type Ordering } from "../writeable/cmp.ts";
import type { FmtWrite, fmt_Result } from "../writeable/lib.ts";
import { EachSubtagWriteable, each_subtag_writeable_borrow } from "./helpers.ts";
import type { ParseError } from "./parser/errors.ts";
import { parse_language_identifier, parse_language_identifier_with_single_variant } from "./parser/langid.ts";
import { SubtagIterator } from "./parser/mod.ts";
import { Language } from "./subtags/language.ts";
import { Region } from "./subtags/region.ts";
import { Script } from "./subtags/script.ts";
import { Variant } from "./subtags/variant.ts";
import { Variants } from "./subtags/variants.ts";
import { panic } from "../../std/panic.ts";

/// A core struct representing a [`Unicode BCP47 Language Identifier`].
///
/// (Examples and details of upstream's type docs are not repeated here.)
///
/// [`Unicode BCP47 Language Identifier`]: https://unicode.org/reports/tr35/tr35.html#Unicode_language_identifier
// #[derive(PartialEq, Eq, Clone, Hash)] // no Ord or PartialOrd: see docs
export class LanguageIdentifier extends EachSubtagWriteable {
  constructor(
    /// Language subtag of the language identifier.
    public language: Language,
    /// Script subtag of the language identifier.
    public script: Script | undefined,
    /// Region subtag of the language identifier.
    public region: Region | undefined,
    /// Variant subtags of the language identifier.
    public variants: Variants,
  ) {
    super();
  }

  /// The unknown language identifier "und".
  static get UNKNOWN(): LanguageIdentifier {
    return langid("und");
  }

  /// A constructor which takes a str slice, parses it and
  /// produces a well-formed [`LanguageIdentifier`].
  // crate: icu_locale_core-2.3.0/src/langid.rs:121 try_from_str
  static try_from_str(s: string): Result<LanguageIdentifier, ParseError> {
    return LanguageIdentifier.try_from_utf8(utf8(s));
  }

  /// See [`Self::try_from_str`]
  // crate: icu_locale_core-2.3.0/src/langid.rs:129 try_from_utf8
  static try_from_utf8(code_units: Uint8Array): Result<LanguageIdentifier, ParseError> {
    return parse_language_identifier(code_units, "LanguageIdentifier");
  }

  // crate: icu_locale_core-2.3.0/src/langid.rs:137 try_from_utf8_with_single_variant
  static try_from_utf8_with_single_variant(
    code_units: Uint8Array,
  ): Result<[Language, Script | undefined, Region | undefined, Variant | undefined], ParseError> {
    return parse_language_identifier_with_single_variant(code_units, "LanguageIdentifier");
  }

  /// A constructor which takes a utf8 slice which may contain extension keys,
  /// parses it and produces a well-formed [`LanguageIdentifier`].
  // crate: icu_locale_core-2.3.0/src/langid.rs:173 try_from_locale_bytes
  static try_from_locale_bytes(v: Uint8Array): Result<LanguageIdentifier, ParseError> {
    return parse_language_identifier(v, "Locale");
  }

  /// Whether this [`LanguageIdentifier`] equals [`LanguageIdentifier::UNKNOWN`].
  // crate: icu_locale_core-2.3.0/src/langid.rs:178 is_unknown
  is_unknown(): boolean {
    return this.language.is_unknown() && this.script === undefined && this.region === undefined && this.variants.is_empty();
  }

  // crate-skip: icu_locale_core-2.3.0/src/langid.rs:202 normalize_utf8 needs `writeable::to_string_or_borrow` (not ported); unused on rustc's path
  // crate-skip: icu_locale_core-2.3.0/src/langid.rs:224 normalize needs `writeable::to_string_or_borrow` (not ported); unused on rustc's path

  /// Compare this [`LanguageIdentifier`] with BCP-47 bytes.
  // crate: icu_locale_core-2.3.0/src/langid.rs:280 strict_cmp
  strict_cmp(other: Uint8Array): Ordering {
    return cmp_utf8(this, other);
  }

  // crate: icu_locale_core-2.3.0/src/langid.rs:284 as_tuple
  as_tuple(): [Language, Script | undefined, Region | undefined, Variants] {
    return [this.language, this.script, this.region, this.variants];
  }

  /// Compare this [`LanguageIdentifier`] with another [`LanguageIdentifier`] field-by-field.
  /// The result is a total ordering sufficient for use in a [`BTreeSet`].
  // crate: icu_locale_core-2.3.0/src/langid.rs:369 total_cmp
  total_cmp(other: LanguageIdentifier): Ordering {
    const [l1, s1, r1, v1] = this.as_tuple();
    const [l2, s2, r2, v2] = other.as_tuple();
    return l1.cmp(l2) || cmp_option(s1, s2) || cmp_option(r1, r2) || v1.cmp(v2);
  }

  /// Compare this `LanguageIdentifier` with a potentially unnormalized BCP-47 string.
  ///
  /// The return value is equivalent to what would happen if you first parsed the
  /// BCP-47 string to a `LanguageIdentifier` and then performed a structural comparison.
  // crate: icu_locale_core-2.3.0/src/langid.rs:396 normalizing_eq
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
    if (!subtag_matches(Language.try_from_utf8, iter, this.language)) {
      return false;
    }
    if (this.script !== undefined && !subtag_matches(Script.try_from_utf8, iter, this.script)) {
      return false;
    }
    if (this.region !== undefined && !subtag_matches(Region.try_from_utf8, iter, this.region)) {
      return false;
    }
    for (const variant of this.variants.deref()) {
      if (!subtag_matches(Variant.try_from_utf8, iter, variant)) {
        return false;
      }
    }
    return iter.next() === undefined;
  }

  // crate: icu_locale_core-2.3.0/src/langid.rs:428 for_each_subtag_str
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
    for (const variant of this.variants.deref()) {
      r = f(variant.as_str());
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  }

  /// Executes `f` on each subtag string of this `LanguageIdentifier`, with every string in
  /// lowercase ascii form.
  ///
  /// The default canonicalization of language identifiers uses titlecase scripts and uppercase
  /// regions. However, this differs from [RFC6497 (BCP 47 Extension T)], which specifies:
  ///
  /// > _The canonical form for all subtags in the extension is lowercase, with the fields
  /// > ordered by the separators, alphabetically._
  ///
  /// Hence, this method is used inside [`Transform Extensions`] to be able to get the correct
  /// canonicalization of the language identifier.
  ///
  /// As an example, the canonical form of locale **EN-LATN-CA-T-EN-LATN-CA** is
  /// **en-Latn-CA-t-en-latn-ca**, with the script and region parts lowercased inside T extensions,
  /// but titlecased and uppercased outside T extensions respectively.
  ///
  /// [RFC6497 (BCP 47 Extension T)]: https://www.ietf.org/rfc/rfc6497.txt
  /// [`Transform extensions`]: crate::extensions::transform
  // crate: icu_locale_core-2.3.0/src/langid.rs:463 for_each_subtag_str_lowercased
  for_each_subtag_str_lowercased<E>(f: (subtag: string) => Result<undefined, E>): Result<undefined, E> {
    let r = f(this.language.as_str());
    if (r.$ === "Err") return r;
    if (this.script !== undefined) {
      r = f(this.script.to_tinystr().to_ascii_lowercase().as_str());
      if (r.$ === "Err") return r;
    }
    if (this.region !== undefined) {
      r = f(this.region.to_tinystr().to_ascii_lowercase().as_str());
      if (r.$ === "Err") return r;
    }
    for (const variant of this.variants.deref()) {
      r = f(variant.as_str());
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  }

  /// Writes this `LanguageIdentifier` to a sink, replacing uppercase ascii chars with
  /// lowercase ascii chars.
  ///
  /// The default canonicalization of language identifiers uses titlecase scripts and uppercase
  /// regions. However, this differs from [RFC6497 (BCP 47 Extension T)], which specifies:
  ///
  /// > _The canonical form for all subtags in the extension is lowercase, with the fields
  /// > ordered by the separators, alphabetically._
  ///
  /// Hence, this method is used inside [`Transform Extensions`] to be able to get the correct
  /// canonicalization of the language identifier.
  ///
  /// As an example, the canonical form of locale **EN-LATN-CA-T-EN-LATN-CA** is
  /// **en-Latn-CA-t-en-latn-ca**, with the script and region parts lowercased inside T extensions,
  /// but titlecased and uppercased outside T extensions respectively.
  ///
  /// [RFC6497 (BCP 47 Extension T)]: https://www.ietf.org/rfc/rfc6497.txt
  /// [`Transform extensions`]: crate::extensions::transform
  // crate: icu_locale_core-2.3.0/src/langid.rs:498 write_lowercased_to
  write_lowercased_to(sink: FmtWrite): fmt_Result {
    let initial = true;
    return this.for_each_subtag_str_lowercased((subtag) => {
      if (initial) {
        initial = false;
      } else {
        const r = sink.write_char(0x2d);
        if (r.$ === "Err") return r;
      }
      return sink.write_str(subtag);
    });
  }

  // impl AsRef<LanguageIdentifier> for LanguageIdentifier
  // crate: icu_locale_core-2.3.0/src/langid.rs:515 as_ref
  as_ref(): LanguageIdentifier {
    return this;
  }

  // impl core::fmt::Debug for LanguageIdentifier: `Display::fmt(&self, f)`.
  // crate: icu_locale_core-2.3.0/src/langid.rs:521 fmt
  debug(): string {
    return this.to_string();
  }

  // impl FromStr for LanguageIdentifier
  // crate: icu_locale_core-2.3.0/src/langid.rs:532 from_str
  static from_str(s: string): Result<LanguageIdentifier, ParseError> {
    return LanguageIdentifier.try_from_str(s);
  }

  // impl_writeable_for_each_subtag_str_no_test!(LanguageIdentifier, selff, selff.script.is_none() && selff.region.is_none() && selff.variants.is_empty() => Some(selff.language.as_str()))
  override writeable_borrow(): string | undefined {
    return each_subtag_writeable_borrow(
      this.script === undefined && this.region === undefined && this.variants.is_empty(),
      () => this.language.as_str(),
    );
  }

  // impl From<subtags::Language> for LanguageIdentifier
  // crate: icu_locale_core-2.3.0/src/langid.rs:570 from
  static from_language(language: Language): LanguageIdentifier {
    return new LanguageIdentifier(language, undefined, undefined, Variants.new());
  }

  // impl From<Option<subtags::Script>> for LanguageIdentifier
  // crate: icu_locale_core-2.3.0/src/langid.rs:591 from
  static from_script(script: Script | undefined): LanguageIdentifier {
    return new LanguageIdentifier(Language.UNKNOWN, script, undefined, Variants.new());
  }

  // impl From<Option<subtags::Region>> for LanguageIdentifier
  // crate: icu_locale_core-2.3.0/src/langid.rs:612 from
  static from_region(region: Region | undefined): LanguageIdentifier {
    return new LanguageIdentifier(Language.UNKNOWN, undefined, region, Variants.new());
  }

  // impl From<(Language, Option<Script>, Option<Region>)> for LanguageIdentifier
  // crate: icu_locale_core-2.3.0/src/langid.rs:647 from
  static from_lsr(lsr: [Language, Script | undefined, Region | undefined]): LanguageIdentifier {
    return new LanguageIdentifier(lsr[0], lsr[1], lsr[2], Variants.new());
  }

  // impl From<&LanguageIdentifier> for (Language, Option<Script>, Option<Region>)
  // crate: icu_locale_core-2.3.0/src/langid.rs:687 from
  into_lsr(): [Language, Script | undefined, Region | undefined] {
    return [this.language, this.script, this.region];
  }

  /** `#[derive(PartialEq)]` */
  eq(other: LanguageIdentifier): boolean {
    return (
      this.language.eq(other.language) &&
      eq_option(this.script, other.script) &&
      eq_option(this.region, other.region) &&
      this.variants.eq(other.variants)
    );
  }

  clone(): LanguageIdentifier {
    return new LanguageIdentifier(this.language, this.script, this.region, this.variants.clone());
  }
}

export function eq_option<T extends { eq(o: T): boolean }>(a: T | undefined, b: T | undefined): boolean {
  return a === undefined || b === undefined ? a === b : a.eq(b);
}

/** `<Option<T> as Ord>::cmp` (`None` first) */
export function cmp_option<T extends { cmp(o: T): Ordering }>(a: T | undefined, b: T | undefined): Ordering {
  if (a === undefined) return b === undefined ? 0 : -1;
  if (b === undefined) return 1;
  return a.cmp(b);
}

/// A macro allowing for compile-time construction of valid [`LanguageIdentifier`]s.
///
/// The macro will perform syntax normalization of the tag.
// macro_rules! langid (macros.rs:38)
export function langid(s: string): LanguageIdentifier {
  const r = LanguageIdentifier.try_from_utf8_with_single_variant(utf8(s));
  if (r.$ === "Ok") {
    const [language, script, region, variant] = r._0;
    return new LanguageIdentifier(language, script, region, variant !== undefined ? Variants.from_variant(variant) : Variants.new());
  }
  return panic(
    `Invalid language identifier: ${s} . Note langid! macro can only support up to a single variant tag. Use runtime parsing instead.`,
  );
}
