// Port of icu_locale_core 2.3.0 `src/lib.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! Parsing, manipulating, and serializing Unicode Language and Locale Identifiers.
//!
//! This module is published as its own crate ([`icu_locale_core`](https://docs.rs/icu_locale_core/latest/icu_locale_core/))
//! and as part of the [`icu`](https://docs.rs/icu/latest/icu/) crate. See the latter for more details on the ICU4X project.
//!
//! (Examples and details of upstream's crate docs are not repeated here.)
//
// Ported: helpers, data, langid, locale, macros (`langid!`/`locale!`/`data_locale!` as functions),
// parser, subtags, extensions, preferences (LocalePreferences, `define_preferences!` for a
// key-less struct, `RegionalSubdivision`/`RegionOverride`). Not ported: `shortvec` (`T[]`),
// `zerovec` (feature-only ULE impls; the fallback data is decoded by tools/codegen/icu-data.ts),
// `serde` / `databake` (features off), and the other preference keywords (unused on rustc's path).
// See docs/handoff/icu-list.md.

// #[macro_use] mod helpers; mod data; mod langid; mod locale; mod macros; mod parser; mod shortvec;
export { DataLocale, data_locale } from "./data.ts";
export { LanguageIdentifier, langid } from "./langid.ts";
export { Locale, locale } from "./locale.ts";
export { ParseError, debug_ParseError, display_ParseError } from "./parser/errors.ts";
// pub mod extensions; pub mod subtags; pub mod preferences; pub mod zerovec;
export * as extensions from "./extensions/mod.ts";
export * as subtags from "./subtags/mod.ts";
export * as preferences from "./preferences/mod.ts";
