// Port of icu_locale_core 2.3.0 `src/preferences/extensions/unicode/errors.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

/// Error returned by parsers of unicode extensions as preferences.
// #[non_exhaustive] #[derive(Debug, displaydoc::Display)]
export type PreferencesParseError =
  /// The given keyword value is not a valid preference variant.
  "InvalidKeywordValue";
