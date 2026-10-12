//! Language Negotiation is a process in which locales from different
//! sources are filtered and sorted in an effort to produce the best
//! possible selection of them.
//!
//! There are multiple language negotiation strategies, most popular is
//! described in [RFC4647](https://www.ietf.org/rfc/rfc4647.txt).
//!
//! The algorithm is based on the BCP4647 3.3.2 Extended Filtering algorithm,
//! with several modifications.
//!
//! # Example:
//!
//! ```
//! use fluent_langneg::negotiate_languages;
//! use fluent_langneg::NegotiationStrategy;
//! use fluent_langneg::convert_vec_str_to_langids_lossy;
//! use unic_langid::LanguageIdentifier;
//!
//! let requested = convert_vec_str_to_langids_lossy(&["pl", "fr", "en-US"]);
//! let available = convert_vec_str_to_langids_lossy(&["it", "de", "fr", "en-GB", "en_US"]);
//! let default: LanguageIdentifier = "en-US".parse().expect("Parsing langid failed.");
//!
//! let supported = negotiate_languages(
//!   &requested,
//!   &available,
//!   Some(&default),
//!   NegotiationStrategy::Filtering
//! );
//!
//! let expected = convert_vec_str_to_langids_lossy(&["fr", "en-US", "en-GB"]);
//! assert_eq!(supported,
//!            expected.iter().map(|t| t.as_ref()).collect::<Vec<&LanguageIdentifier>>());
//! ```
//!
//! # The exact algorithm is custom, and consists of a 6 level strategy:
//!
//! ### 1) Attempt to find an exact match for each requested locale in available locales.
//!
//! Example:
//!
//! ```text
//! // [requested] * [available] = [supported]
//!
//! ["en-US"] * ["en-US"] = ["en-US"]
//! ```
//!
//! ### 2) Attempt to match a requested locale to an available locale treated as a locale range.
//!
//! Example:
//!
//! ```text
//! // [requested] * [available] = [supported]
//!
//! ["en-US"] * ["en"] = ["en"]
//!               ^^
//!                |-- becomes "en-*-*-*"
//! ```
//!
//! ### 3) Maximize the requested locale to find the best match in available locales.
//!
//! This part uses ICU's likelySubtags or similar database.
//!
//! Example:
//!
//! ```text
//! // [requested] * [available] = [supported]
//!
//! ["en"] * ["en-GB", "en-US"] = ["en-US"]
//!   ^^       ^^^^^    ^^^^^
//!    |           |        |
//!    |           |----------- become "en-*-GB-*" and "en-*-US-*"
//!    |
//!    |-- ICU likelySubtags expands it to "en-Latn-US"
//! ```
//!
//! ### 4) Attempt to look up for a different variant of the same locale.
//!
//! Example:
//!
//! ```text
//! // [requested] * [available] = [supported]
//!
//! ["ja-JP-win"] * ["ja-JP-mac"] = ["ja-JP-mac"]
//!   ^^^^^^^^^       ^^^^^^^^^
//!           |               |-- become "ja-*-JP-mac"
//!           |
//!           |----------- replace variant with range: "ja-JP-*"
//! ```
//!
//! ### 5) Look up for a maximized version of the requested locale, stripped of the region code.
//!
//! Example:
//!
//! ```text
//! // [requested] * [available] = [supported]
//!
//! ["en-CA"] * ["en-ZA", "en-US"] = ["en-US", "en-ZA"]
//!   ^^^^^
//!       |       ^^^^^    ^^^^^
//!       |           |        |
//!       |           |----------- become "en-*-ZA-*" and "en-*-US-*"
//!       |
//!       |----------- strip region produces "en", then lookup likelySubtag: "en-Latn-US"
//! ```
//!
//!
//! ### 6) Attempt to look up for a different region of the same locale.
//!
//! Example:
//!
//! ```text
//! // [requested] * [available] = [supported]
//!
//! ["en-GB"] * ["en-AU"] = ["en-AU"]
//!   ^^^^^       ^^^^^
//!       |           |-- become "en-*-AU-*"
//!       |
//!       |----- replace region with range: "en-*"
//! ```
//!

//
// Port of fluent-langneg 0.13.1, src/negotiate/mod.rs.
// PORT: generics `R: AsRef<LanguageIdentifier>` / `A: AsRef<LanguageIdentifier> + PartialEq` are
// `LanguageIdentifier` (the only instantiation reachable from fluent-bundle); `Vec<&'a A>` holds
// the very objects of `available` (and `default`).
import { type Fmt } from "../../../std/fmt.ts";
import type { LanguageIdentifier } from "../../unic_langid/lib.ts";
// #[cfg(not(feature = "cldr"))]
import { MockLikelySubtags } from "./likely_subtags.ts";

// #[derive(PartialEq, Debug, Clone, Copy)]
export type NegotiationStrategy = "Filtering" | "Matching" | "Lookup";
export const NegotiationStrategy = { Filtering: "Filtering", Matching: "Matching", Lookup: "Lookup" } as const;

/** `#[derive(Debug)]` */
export function debug_NegotiationStrategy(v: NegotiationStrategy, _f: Fmt): string {
  return v;
}

// crate: fluent-langneg-0.13.1/src/negotiate/mod.rs:136 filter_matches
export function filter_matches(
  requested: readonly LanguageIdentifier[],
  available: readonly LanguageIdentifier[],
  strategy: NegotiationStrategy,
): LanguageIdentifier[] {
  const supported_locales: LanguageIdentifier[] = [];

  let available_locales: LanguageIdentifier[] = available.slice();

  for (const req_ of requested) {
    const req = req_.as_ref().clone(); // `to_owned()`
    // PORT: `macro_rules! test_strategy` → a closure; its `continue` / `break` of the enclosing
    // `for req` loop are returned to the call site as "continue" / "break".
    const test_strategy = (self_as_range: boolean, other_as_range: boolean): "continue" | "break" | undefined => {
      let match_found = false;
      // `available_locales.retain(|locale| ..)`: visits every element in order, keeps those for
      // which the closure returns true.
      available_locales = available_locales.filter((locale) => {
        if (strategy !== NegotiationStrategy.Filtering && match_found) {
          return true;
        }

        if (locale.as_ref().matches(req, self_as_range, other_as_range)) {
          match_found = true;
          supported_locales.push(locale);
          return false;
        }
        return true;
      });

      if (match_found) {
        switch (strategy) {
          case "Filtering":
            break;
          case "Matching":
            return "continue";
          case "Lookup":
            return "break";
        }
      }
      return undefined;
    };
    let c: "continue" | "break" | undefined;

    // 1) Try to find a simple (case-insensitive) string match for the request.
    c = test_strategy(false, false);
    if (c === "continue") continue;
    if (c === "break") break;

    // 2) Try to match against the available locales treated as ranges.
    c = test_strategy(true, false);
    if (c === "continue") continue;
    if (c === "break") break;

    // Per Unicode TR35, 4.4 Locale Matching, we don't add likely subtags to
    // requested locales, so we'll skip it from the rest of the steps.
    if (req.language.is_empty()) {
      continue;
    }

    // 3) Try to match against a maximized version of the requested locale
    // PORT: `req.maximize()` resolves to `MockLikelySubtags::maximize`: unic-langid's inherent
    // `maximize` only exists with its `likelysubtags` feature, which is off in rustc's build (the
    // TS port always has it, so the trait fn is called explicitly).
    if (MockLikelySubtags.maximize(req)) {
      c = test_strategy(true, false);
      if (c === "continue") continue;
      if (c === "break") break;
    }

    // 4) Try to match against a variant as a range
    req.clear_variants();
    c = test_strategy(true, true);
    if (c === "continue") continue;
    if (c === "break") break;

    // 5) Try to match against the likely subtag without region
    req.region = undefined;
    if (MockLikelySubtags.maximize(req)) {
      c = test_strategy(true, false);
      if (c === "continue") continue;
      if (c === "break") break;
    }

    // 6) Try to match against a region as a range
    req.region = undefined;
    c = test_strategy(true, true);
    if (c === "continue") continue;
    if (c === "break") break;
  }

  return supported_locales;
}

// crate: fluent-langneg-0.13.1/src/negotiate/mod.rs:211 negotiate_languages
export function negotiate_languages(
  requested: readonly LanguageIdentifier[],
  available: readonly LanguageIdentifier[],
  default_: LanguageIdentifier | undefined,
  strategy: NegotiationStrategy,
): LanguageIdentifier[] {
  const supported = filter_matches(requested, available, strategy);

  if (default_ !== undefined) {
    if (strategy === NegotiationStrategy.Lookup) {
      if (supported.length === 0) {
        supported.push(default_);
      }
    } else if (!supported.some((s) => s.eq(default_))) {
      supported.push(default_);
    }
  }
  return supported;
}
