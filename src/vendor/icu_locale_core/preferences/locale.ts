// Port of icu_locale_core 2.3.0 `src/preferences/locale.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import { Err, Ok, type Result } from "../../../std/result.ts";
import { DataLocale } from "../data.ts";
import { Extensions } from "../extensions/mod.ts";
import { SubdivisionId, SubdivisionSuffix } from "../extensions/unicode/subdivision.ts";
import { LanguageIdentifier } from "../langid.ts";
import { Locale } from "../locale.ts";
import { Language } from "../subtags/language.ts";
import type { Region } from "../subtags/region.ts";
import type { Script } from "../subtags/script.ts";
import type { Variant } from "../subtags/variant.ts";
import { Variants } from "../subtags/variants.ts";
import { RegionOverride } from "./extensions/unicode/keywords/region_override.ts";
import { RegionalSubdivision } from "./extensions/unicode/keywords/regional_subdivision.ts";

/// The structure storing locale subtags used in preferences.
// #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
export class LocalePreferences {
  constructor(
    /// Preference of Language
    public language: Language,
    /// Preference of Script
    public script: Script | undefined,
    /// Preference of Region/Subdivision
    public region: RegionalSubdivision | undefined,
    /// Preference of Variant
    public variant: Variant | undefined,
    /// Preference of Regional override
    public region_override: RegionOverride | undefined,
  ) {}

  /// Convert to a DataLocale, with region-based fallback priority
  ///
  /// Most users should use `icu_provider::marker::make_locale()` instead.
  // crate: icu_locale_core-2.3.0/src/preferences/locale.rs:31 to_data_locale_region_priority
  to_data_locale_region_priority(): DataLocale {
    return DataLocale.from_parts(
      this.language,
      this.script,
      this.region_override !== undefined ? this.region_override._0 : this.region !== undefined ? this.region._0 : undefined,
      this.variant,
    );
  }

  /// Convert to a DataLocale, with language-based fallback priority
  ///
  /// Most users should use `icu_provider::marker::make_locale()` instead.
  // crate: icu_locale_core-2.3.0/src/preferences/locale.rs:49 to_data_locale_language_priority
  to_data_locale_language_priority(): DataLocale {
    return DataLocale.from_parts(this.language, this.script, this.region !== undefined ? this.region._0 : undefined, this.variant);
  }

  // impl Default for LocalePreferences
  // crate: icu_locale_core-2.3.0/src/preferences/locale.rs:63 default
  static default_trait(): LocalePreferences {
    return LocalePreferences.default();
  }

  // impl From<&crate::Locale> for LocalePreferences
  // crate: icu_locale_core-2.3.0/src/preferences/locale.rs:69 from
  static from_locale(loc: Locale): LocalePreferences {
    const r = LocalePreferences.from_locale_strict(loc);
    return r._0;
  }

  // impl From<&crate::LanguageIdentifier> for LocalePreferences
  // crate: icu_locale_core-2.3.0/src/preferences/locale.rs:75 from
  static from_langid(lid: LanguageIdentifier): LocalePreferences {
    return new LocalePreferences(
      lid.language,
      lid.script,
      lid.region !== undefined ? new RegionalSubdivision(new SubdivisionId(lid.region, SubdivisionSuffix.UNKNOWN)) : undefined,
      lid.variants.deref()[0],
      undefined,
    );
  }

  /// Convert to a Locale
  // impl From<LocalePreferences> for crate::Locale
  // crate: icu_locale_core-2.3.0/src/preferences/locale.rs:94 from
  into_locale(): Locale {
    const prefs = this;
    const extensions = Extensions.default();
    if (prefs.region !== undefined && !prefs.region.suffix.is_unknown()) {
      extensions.unicode.keywords.set(RegionalSubdivision.UNICODE_EXTENSION_KEY, RegionalSubdivision.into_value(prefs.region));
    }
    if (prefs.region_override !== undefined) {
      extensions.unicode.keywords.set(RegionOverride.UNICODE_EXTENSION_KEY, RegionOverride.into_value(prefs.region_override));
    }
    return new Locale(
      new LanguageIdentifier(
        prefs.language,
        prefs.script,
        prefs.region !== undefined ? prefs.region.region : undefined,
        prefs.variant !== undefined ? Variants.from_variant(prefs.variant) : Variants.new(),
      ),
      extensions,
    );
  }

  /// Constructs a new [`LocalePreferences`] struct with the defaults.
  // crate: icu_locale_core-2.3.0/src/preferences/locale.rs:127 default
  static default(): LocalePreferences {
    return new LocalePreferences(Language.UNKNOWN, undefined, undefined, undefined, undefined);
  }

  /// Construct a `LocalePreferences` from a `Locale`
  ///
  /// Returns `Err` if any of of the preference values are invalid.
  // crate: icu_locale_core-2.3.0/src/preferences/locale.rs:140 from_locale_strict
  static from_locale_strict(loc: Locale): Result<LocalePreferences, LocalePreferences> {
    let is_err = false;

    let subdivision: RegionalSubdivision | undefined;
    const sd_value = loc.extensions.unicode.keywords.get(RegionalSubdivision.UNICODE_EXTENSION_KEY);
    if (sd_value !== undefined) {
      const sd = RegionalSubdivision.try_from(sd_value);
      if (sd.$ === "Ok") {
        subdivision = sd._0;
      } else {
        is_err = true;
        subdivision = undefined;
      }
    } else {
      subdivision = undefined;
    }

    let region: RegionalSubdivision | undefined;
    if (subdivision !== undefined) {
      const sd = subdivision;
      if (loc.id.region !== undefined) {
        const region_ = loc.id.region;
        // Discard the subdivison if it doesn't match the region
        let suffix: SubdivisionSuffix;
        if (sd.region.eq(region_)) {
          suffix = sd.suffix;
        } else {
          is_err = true;
          suffix = SubdivisionSuffix.UNKNOWN;
        }
        region = new RegionalSubdivision(new SubdivisionId(region_, suffix));
      } else {
        // Use the subdivision's region if there's no region
        region = sd;
      }
    } else {
      region = loc.id.region !== undefined ? new RegionalSubdivision(new SubdivisionId(loc.id.region, SubdivisionSuffix.UNKNOWN)) : undefined;
    }

    let region_override: RegionOverride | undefined;
    const rg_value = loc.extensions.unicode.keywords.get(RegionOverride.UNICODE_EXTENSION_KEY);
    if (rg_value !== undefined) {
      const rg = RegionOverride.try_from(rg_value);
      if (rg.$ === "Err") {
        is_err = true;
        region_override = undefined;
      } else {
        region_override = rg._0;
      }
    } else {
      region_override = undefined;
    }

    const prefs = new LocalePreferences(loc.id.language, loc.id.script, region, loc.id.variants.deref()[0], region_override);
    return is_err ? Err(prefs) : Ok(prefs);
  }

  /// Preference of Language
  // #[deprecated(since = "2.2.0", note = "convert to `DataLocale` to access fields")]
  // crate: icu_locale_core-2.3.0/src/preferences/locale.rs:205 language
  language_(): Language {
    return this.to_data_locale_language_priority().language;
  }

  /// Preference of Region
  // #[deprecated(since = "2.2.0", note = "convert to `DataLocale` to access fields")]
  // crate: icu_locale_core-2.3.0/src/preferences/locale.rs:211 region
  region_(): Region | undefined {
    return this.to_data_locale_region_priority().region;
  }

  /// Extends the preferences with the values from another set of preferences.
  // crate: icu_locale_core-2.3.0/src/preferences/locale.rs:216 extend
  extend(other: LocalePreferences): void {
    if (!other.language.is_unknown()) {
      this.language = other.language;
    }
    if (other.script !== undefined) {
      this.script = other.script;
    }
    if (other.region !== undefined) {
      const sd = other.region;
      // Use the other region if it's different, or if it has a subdivision
      const self_region = this.region !== undefined ? this.region.region : undefined;
      if (!sd.suffix.is_unknown() || self_region === undefined || !sd.region.eq(self_region)) {
        this.region = sd;
      }
    }
    if (other.variant !== undefined) {
      this.variant = other.variant;
    }
    if (other.region_override !== undefined) {
      this.region_override = other.region_override;
    }
  }
}
