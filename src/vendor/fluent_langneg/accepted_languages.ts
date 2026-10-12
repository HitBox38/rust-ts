//! This function parses Accept-Language string into a list of language tags that
//! can be later passed to language negotiation functions.
//!
//! # Example:
//!
//! ```
//! use fluent_langneg::negotiate_languages;
//! use fluent_langneg::NegotiationStrategy;
//! use fluent_langneg::parse_accepted_languages;
//! use fluent_langneg::convert_vec_str_to_langids_lossy;
//! use unic_langid::LanguageIdentifier;
//!
//! let requested = parse_accepted_languages("de-AT;0.9,de-DE;0.8,de;0.7;en-US;0.5");
//! let available = convert_vec_str_to_langids_lossy(&["fr", "pl", "de", "en-US"]);
//! let default: LanguageIdentifier = "en-US".parse().expect("Failed to parse a langid.");
//!
//! let supported = negotiate_languages(
//!   &requested,
//!   &available,
//!   Some(&default),
//!   NegotiationStrategy::Filtering
//! );
//!
//! let expected = convert_vec_str_to_langids_lossy(&["de", "en-US"]);
//! assert_eq!(supported,
//!            expected.iter().map(|t| t.as_ref()).collect::<Vec<&LanguageIdentifier>>());
//! ```
//!
//! This function ignores the weights associated with the locales, since Fluent Locale
//! language negotiation only uses the order of locales, not the weights.
//!
//
// Port of fluent-langneg 0.13.1, src/accepted_languages.rs.
import { is_whitespace } from "../../std/char.ts";
import { LanguageIdentifier } from "../unic_langid/lib.ts";

/**
 * PORT: `str::trim` (= `trim_matches(char::is_whitespace)`, Unicode `White_Space`); JS `trim()`
 * differs (it strips U+FEFF and keeps U+0085). Belongs in src/std.
 */
function str_trim(s: string): string {
  const cps = Array.from(s);
  let a = 0;
  let b = cps.length;
  while (a < b && is_whitespace(cps[a]!.codePointAt(0)!)) a++;
  while (b > a && is_whitespace(cps[b - 1]!.codePointAt(0)!)) b--;
  return cps.slice(a, b).join("");
}

// crate: fluent-langneg-0.13.1/src/accepted_languages.rs:35 parse
export function parse(s: string): LanguageIdentifier[] {
  const out: LanguageIdentifier[] = [];
  for (const piece of s.split(",")) {
    const t = str_trim(piece).split(";")[0]!; // `.split(';').nth(0).unwrap()`: always Some
    if (t.length === 0) continue;
    const r = LanguageIdentifier.from_str(t);
    if (r.$ === "Ok") out.push(r._0);
  }
  return out;
}
