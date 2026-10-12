// Port of icu_provider 2.3.0 `src/fallback.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! Options to define fallback behaviour.
//!
//! These options are consumed by the `LocaleFallbacker` in the `icu_locales` crate
//! (or the `icu::locales` module), but are defined here because they are used by `DataMarkerInfo`.

/// Hint for which subtag to prioritize during fallback.
///
/// For example, `"en-US"` might fall back to either `"en"` or `"und-US"` depending
/// on this enum.
// #[derive(Debug, PartialEq, Eq, Copy, Clone, PartialOrd, Ord)] #[non_exhaustive]
export type LocaleFallbackPriority =
  /// Prioritize the language. This is the default behavior.
  ///
  /// For example, `"en-US"` should go to `"en"` and then `"und"`.
  | "Language"
  /// Prioritize the script.
  ///
  /// For example, `"en-US"` should go to `"en"` and then `"und-Latn"` and then `"und"`.
  | "Script"
  /// Prioritize the region.
  ///
  /// For example, `"en-US"` should go to `"und-US"` and then `"und"`.
  | "Region";

export const LocaleFallbackPriority = {
  Language: "Language",
  Script: "Script",
  Region: "Region",

  /// Const-friendly version of [`Default::default`].
  // crate: icu_provider-2.3.0/src/fallback.rs:35 default
  default(): LocaleFallbackPriority {
    return "Language";
  },

  // impl Default for LocaleFallbackPriority
  // crate: icu_provider-2.3.0/src/fallback.rs:41 default
  default_trait(): LocaleFallbackPriority {
    return LocaleFallbackPriority.default();
  },
} as const;

/// Configuration settings for a particular fallback operation.
// #[derive(Debug, Clone, PartialEq, Eq, Copy)] #[non_exhaustive]
export class LocaleFallbackConfig {
  constructor(
    /// Strategy for choosing which subtags to drop during locale fallback.
    public priority: LocaleFallbackPriority,
  ) {}

  /// Const version of [`Default::default`].
  // crate: icu_provider-2.3.0/src/fallback.rs:114 default
  static default(): LocaleFallbackConfig {
    return new LocaleFallbackConfig(LocaleFallbackPriority.default());
  }

  // impl Default for LocaleFallbackConfig
  // crate: icu_provider-2.3.0/src/fallback.rs:122 default
  static default_trait(): LocaleFallbackConfig {
    return LocaleFallbackConfig.default();
  }
}
