//! fluent-langneg is an API for operating on locales and language tags.
//! It's part of Project Fluent, a localization framework designed to unleash
//! the expressive power of the natural language.
//!
//! The primary use of fluent-langneg is to parse/modify/serialize language tags
//! and to perform language negotiation.
//!
//! fluent-langneg operates on a subset of [BCP47](http://tools.ietf.org/html/bcp47).
//! It can parse full BCP47 language tags, and will serialize them back,
//! but currently only allows for operations on primary subtags and
//! unicode extension keys.
//!
//! In result fluent-langneg is not suited to replace full implementations of
//! BCP47 like [rust-language-tags](https://github.com/pyfisch/rust-language-tags),
//! but is arguably a better option for use cases involving operations on
//! language tags and for language negotiation.
//
// Port of fluent-langneg 0.13.1 (the version in upstream's Cargo.lock), src/lib.rs.
// Features: `cldr` is off in rustc's build (as here), so `negotiate` uses the mock likely subtags.
import { Ok, type Result } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import { LanguageIdentifier, type LanguageIdentifierError } from "../unic_langid/lib.ts";

export * as accepted_languages from "./accepted_languages.ts";
export * as negotiate from "./negotiate/mod.ts";

export { parse as parse_accepted_languages } from "./accepted_languages.ts";
export { negotiate_languages, NegotiationStrategy, debug_NegotiationStrategy } from "./negotiate/mod.ts";

/** PORT: `J: AsRef<[u8]>` items: bytes, or a `&str` (its UTF-8 bytes). */
function as_ref(s: Uint8Array | string): Uint8Array {
  return typeof s === "string" ? utf8(s) : s;
}

// crate: fluent-langneg-0.13.1/src/lib.rs:27 convert_vec_str_to_langids
export function convert_vec_str_to_langids(
  input: Iterable<Uint8Array | string>,
): Result<LanguageIdentifier[], LanguageIdentifierError> {
  // `.collect::<Result<Vec<_>, _>>()` stops at the first error.
  const out: LanguageIdentifier[] = [];
  for (const s of input) {
    const r = LanguageIdentifier.from_bytes(as_ref(s));
    if (r.$ === "Err") return r;
    out.push(r._0);
  }
  return Ok(out);
}

// crate: fluent-langneg-0.13.1/src/lib.rs:40 convert_vec_str_to_langids_lossy
export function convert_vec_str_to_langids_lossy(input: Iterable<Uint8Array | string>): LanguageIdentifier[] {
  const out: LanguageIdentifier[] = [];
  for (const t of input) {
    const r = LanguageIdentifier.from_bytes(as_ref(t));
    if (r.$ === "Ok") out.push(r._0);
  }
  return out;
}

// Not ported: the criterion benchmark (not library code).
// crate-skip: fluent-langneg-0.13.1/benches/negotiate.rs:12 do_negotiate benchmark (benches/), not library code
// crate-skip: fluent-langneg-0.13.1/benches/negotiate.rs:24 negotiate_bench benchmark (benches/), not library code
