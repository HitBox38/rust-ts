// Port of icu_locale_core 2.3.0 `src/parser/errors.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import type { Fmt } from "../../../std/fmt.ts";

/// List of parser errors that can be generated
/// while parsing [`LanguageIdentifier`](crate::LanguageIdentifier), [`Locale`](crate::Locale),
/// [`subtags`](crate::subtags) or [`extensions`](crate::extensions).
///
/// Re-exported as [`Error`](crate::Error).
// #[derive(Display, Debug, PartialEq, Copy, Clone)] #[non_exhaustive]
export type ParseError =
  /// Invalid language subtag.
  | "InvalidLanguage"
  /// Invalid script, region or variant subtag.
  | "InvalidSubtag"
  /// Invalid extension subtag.
  | "InvalidExtension"
  /// Duplicated extension.
  | "DuplicatedExtension";
export const ParseError = {
  InvalidLanguage: "InvalidLanguage",
  InvalidSubtag: "InvalidSubtag",
  InvalidExtension: "InvalidExtension",
  DuplicatedExtension: "DuplicatedExtension",
} as const;

/** `#[derive(Debug)]` */
export function debug_ParseError(v: ParseError, _f?: Fmt): string {
  return v;
}

/** `#[derive(displaydoc::Display)]` */
export function display_ParseError(v: ParseError): string {
  switch (v) {
    case "InvalidLanguage":
      return "The given language subtag is invalid";
    case "InvalidSubtag":
      return "Invalid subtag";
    case "InvalidExtension":
      return "Invalid extension";
    case "DuplicatedExtension":
      return "Duplicated extension";
  }
}
