// Port of unic-langid 0.9.6 `src/lib.rs`: re-exports unic-langid-impl, plus the `macros`
// feature's macros (rustc_error_messages enables `features = ["macros"]`).

//! `unic-langid` is an API for managing Unicode Language Identifiers.
//!
//! The crate provides a struct `LanguageIdentifier` which allows to store, manipulate and
//! serialize Unicode Language Identifiers.
//!
//! (The rest of upstream's crate docs is not repeated here.)
import { panic } from "../../std/panic.ts";
import { PLAIN } from "../../std/fmt.ts";
import { debug_LanguageIdentifierError, LanguageIdentifier } from "../unic_langid_impl/lib.ts";

export * from "../unic_langid_impl/lib.ts";

// PORT: `unic_langid_macros::langid!` (a proc macro from unic-langid-macros-impl 0.9.6) parses its
// string literal at compile time with `LanguageIdentifier::from_str(..).expect("Malformed
// Language Identifier")` and emits `LanguageIdentifier::from_raw_parts_unchecked` of the parsed
// parts, which reconstructs exactly the parsed value. Here it is a function that parses at run
// time; a malformed literal (a compile error upstream) panics with the same `expect` message.
// The other macros of that crate (`lang!`, `script!`, `region!`, `variant!`) are not used by
// rustc's dependencies and are not ported.
export function langid(s: string): LanguageIdentifier {
  const r = LanguageIdentifier.from_str(s);
  if (r.$ === "Err") return panic(`Malformed Language Identifier: ${debug_LanguageIdentifierError(r._0, PLAIN)}`); // `Result::expect`
  return r._0;
}

// PORT: `macro_rules! langids { ($($langid:expr),*) => vec![$($crate::langid!($langid),)*] }`
// (unic-langid 0.9.6 src/lib.rs:115) as a function.
export function langids(...ls: string[]): LanguageIdentifier[] {
  return ls.map((l) => langid(l));
}

// PORT: `macro_rules! langid_slice` (unic-langid 0.9.6 src/lib.rs:127) builds the same values as
// `langids!` in a const slice.
export function langid_slice(...ls: string[]): readonly LanguageIdentifier[] {
  return langids(...ls);
}
