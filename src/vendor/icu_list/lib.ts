// Port of icu_list 2.3.0 `src/lib.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! Formatting lists in a locale-sensitive way.
//!
//! This module is published as its own crate ([`icu_list`](https://docs.rs/icu_list/latest/icu_list/))
//! and as part of the [`icu`](https://docs.rs/icu/latest/icu/) crate. See the latter for more details on the ICU4X project.
//!
//! (Examples of upstream's crate docs are not repeated here.)

// mod lazy_automaton; mod list_formatter; pub mod options; mod patterns; pub mod provider;
export * from "./list_formatter.ts";
export * as options from "./options.ts";
export * as provider from "./provider/mod.ts";
