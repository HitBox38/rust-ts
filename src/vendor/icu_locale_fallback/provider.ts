// Port of icu_locale_fallback 2.3.0 `src/provider.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! 🚧 \[Unstable\] Data provider struct definitions for this ICU4X component.
//!
//! Read more about data providers: [`icu_provider`]
import type { Language } from "../icu_locale_core/subtags/language.ts";
import type { Region } from "../icu_locale_core/subtags/region.ts";
import type { Script } from "../icu_locale_core/subtags/script.ts";
import { data_marker } from "../icu_provider/marker.ts";
import type { ZeroMap } from "../zerovec/map/map.ts";
import { BAKED_LOCALE_LIKELY_SUBTAGS_LANGUAGE_V1, BAKED_LOCALE_PARENTS_V1 } from "../icu_locale_fallback_data/data.ts";

/// Baked data (`compiled_data`): `make_provider!(Baked)`, `impl_locale_likely_subtags_language_v1!(Baked)`
/// and `impl_locale_parents_v1!(Baked)` over `icu_locale_fallback_data`.
// #[derive(Debug)]
export const Baked = {
  /// `Baked::SINGLETON_LOCALE_LIKELY_SUBTAGS_LANGUAGE_V1` (from icu_locale_fallback_data)
  get SINGLETON_LOCALE_LIKELY_SUBTAGS_LANGUAGE_V1(): LikelySubtagsForLanguage {
    return BAKED_LOCALE_LIKELY_SUBTAGS_LANGUAGE_V1();
  },
  /// `Baked::SINGLETON_LOCALE_PARENTS_V1` (from icu_locale_fallback_data)
  get SINGLETON_LOCALE_PARENTS_V1(): Parents {
    return BAKED_LOCALE_PARENTS_V1();
  },
};

/// Marker for data for likely subtags for languages.
// icu_provider::data_marker!(LocaleLikelySubtagsLanguageV1, "locale/likely/subtags/language/v1",
//     LikelySubtagsForLanguage<'static>, is_singleton = true);
export const LocaleLikelySubtagsLanguageV1 = data_marker<LikelySubtagsForLanguage>("LocaleLikelySubtagsLanguageV1", { is_singleton: true });
/// Marker for locale fallback parents data.
// icu_provider::data_marker!(LocaleParentsV1, "locale/parents/v1", Parents<'static>, is_singleton = true);
export const LocaleParentsV1 = data_marker<Parents>("LocaleParentsV1", { is_singleton: true });

/// This likely subtags data is used for the minimize and maximize operations.
///
/// Each field defines a mapping from an old identifier to a new identifier,
/// based upon the rules in
/// <https://www.unicode.org/reports/tr35/#Likely_Subtags>.
///
/// The data is stored is broken down into smaller vectors based upon the rules
/// defined for the likely subtags maximize algorithm.
///
/// For efficiency, only the relevant part of the [`icu_locale_core::LanguageIdentifier`] is stored
/// for searching and replacing. E.g., the `language_script` field is used to store
/// rules for [`icu_locale_core::LanguageIdentifier`]s that contain a language and a script, but not a
/// region.
///
/// This struct contains mappings when the input contains a language subtag.
// #[derive(Debug, PartialEq, Clone, yoke::Yokeable, zerofrom::ZeroFrom)]
// PORT: map keys are the ULE bytes of `(UnvalidatedLanguage, UnvalidatedScript)` etc. (see zerovec/map/map.ts).
export interface LikelySubtagsForLanguage {
  /// Language and script.
  readonly language_script: ZeroMap<Region>;
  /// Language and region.
  readonly language_region: ZeroMap<Script>;
  /// Just language.
  readonly language: ZeroMap<[Script, Region]>;
  /// Undefined.
  readonly und: [Language, Script, Region];
}

/// Locale fallback rules derived from CLDR parent locales data.
// #[derive(Default, Clone, PartialEq, Debug, yoke::Yokeable, zerofrom::ZeroFrom)]
export interface Parents {
  /// Map from language identifier to language identifier, indicating that the language on the
  /// left should inherit from the language on the right.
  readonly parents: ZeroMap<[Language, Script | undefined, Region | undefined]>;
}
