// Port of unicode-normalization =0.1.25 `src/quick_check.rs` (its `#[cfg(test)] mod tests` is in
// quick_check.test.ts).
import type { Debug } from "../../std/fmt.ts";
import type { Str } from "../../std/str.ts";
import type { CharIterator } from "./lib.ts";
import { canonical_combining_class } from "./lookups.ts";
import { Recompositions } from "./recompose.ts";
import { Decompositions } from "./decompose.ts";
import * as stream_safe from "./stream_safe.ts";
import * as tables from "./tables.ts";

/// QuickCheck quickly determines if a string is normalized, it can return
/// `Maybe`
///
/// The QuickCheck algorithm can quickly determine if a text is or isn't
/// normalized without any allocations in many cases, but it has to be able to
/// return `Maybe` when a full decomposition and recomposition is necessary.
// #[derive(Debug, Eq, PartialEq)]
export type IsNormalized =
  /// The text is definitely normalized.
  | "Yes"
  /// The text is definitely not normalized.
  | "No"
  /// The text may be normalized.
  | "Maybe";
export const IsNormalized = { Yes: "Yes", No: "No", Maybe: "Maybe" } as const;
export const debug_IsNormalized: Debug<IsNormalized> = (v) => v;

// https://unicode.org/reports/tr15/#Detecting_Normalization_Forms
// crate: unicode-normalization-0.1.25/src/quick_check.rs:24 quick_check
function quick_check(s: CharIterator, is_allowed: (c: number) => IsNormalized, stream_safe_: boolean): IsNormalized {
  let last_cc = 0;
  let nonstarter_count = 0;
  let result: IsNormalized = IsNormalized.Yes;
  for (let ch = s.next(); ch !== undefined; ch = s.next()) {
    // For ASCII we know it's always allowed and a starter
    if (ch <= 0x7f) {
      last_cc = 0;
      nonstarter_count = 0;
      continue;
    }

    // Otherwise, lookup the combining class and QC property
    const cc = canonical_combining_class(ch);
    if (last_cc > cc && cc !== 0) {
      return IsNormalized.No;
    }
    switch (is_allowed(ch)) {
      case "Yes":
        break;
      case "No":
        return IsNormalized.No;
      case "Maybe": {
        result = IsNormalized.Maybe;
        break;
      }
    }
    if (stream_safe_) {
      const decomp = stream_safe.classify_nonstarters(ch);

      // If we're above `MAX_NONSTARTERS`, we're definitely *not*
      // stream-safe normalized.
      if (nonstarter_count + decomp.leading_nonstarters > stream_safe.MAX_NONSTARTERS) {
        return IsNormalized.No;
      }
      if (decomp.leading_nonstarters === decomp.decomposition_len) {
        nonstarter_count += decomp.decomposition_len;
      } else {
        nonstarter_count = decomp.trailing_nonstarters;
      }
    }
    last_cc = cc;
  }
  return result;
}

/// Quickly check if a string is in NFC, potentially returning
/// `IsNormalized::Maybe` if further checks are necessary.  In this case a check
/// like `s.chars().nfc().eq(s.chars())` should suffice.
// crate: unicode-normalization-0.1.25/src/quick_check.rs:75 is_nfc_quick
export function is_nfc_quick(s: CharIterator): IsNormalized {
  return quick_check(s, tables.qc_nfc, false);
}

/// Quickly check if a string is in NFKC.
// crate: unicode-normalization-0.1.25/src/quick_check.rs:81 is_nfkc_quick
export function is_nfkc_quick(s: CharIterator): IsNormalized {
  return quick_check(s, tables.qc_nfkc, false);
}

/// Quickly check if a string is in NFD.
// crate: unicode-normalization-0.1.25/src/quick_check.rs:87 is_nfd_quick
export function is_nfd_quick(s: CharIterator): IsNormalized {
  return quick_check(s, tables.qc_nfd, false);
}

/// Quickly check if a string is in NFKD.
// crate: unicode-normalization-0.1.25/src/quick_check.rs:93 is_nfkd_quick
export function is_nfkd_quick(s: CharIterator): IsNormalized {
  return quick_check(s, tables.qc_nfkd, false);
}

/// Quickly check if a string is Stream-Safe NFC.
// crate: unicode-normalization-0.1.25/src/quick_check.rs:99 is_nfc_stream_safe_quick
export function is_nfc_stream_safe_quick(s: CharIterator): IsNormalized {
  return quick_check(s, tables.qc_nfc, true);
}

/// Quickly check if a string is Stream-Safe NFD.
// crate: unicode-normalization-0.1.25/src/quick_check.rs:105 is_nfd_stream_safe_quick
export function is_nfd_stream_safe_quick(s: CharIterator): IsNormalized {
  return quick_check(s, tables.qc_nfd, true);
}

/** PORT: `Iterator::eq` over two char iterators (std). `s.chars().nfc()` etc. below call what the
 *  blanket `impl UnicodeNormalization<I> for I` calls (`Recompositions::new_canonical(self)`, ...),
 *  keeping lib.ts out of the runtime import cycle. */
function iter_eq(a: CharIterator, b: CharIterator): boolean {
  for (;;) {
    const x = a.next();
    const y = b.next();
    if (x === undefined || y === undefined) return x === y;
    if (x !== y) return false;
  }
}

/// Authoritatively check if a string is in NFC.
// crate: unicode-normalization-0.1.25/src/quick_check.rs:111 is_nfc
export function is_nfc(s: Str): boolean {
  switch (is_nfc_quick(s.chars())) {
    case "Yes":
      return true;
    case "No":
      return false;
    case "Maybe":
      return iter_eq(s.chars(), Recompositions.new_canonical(s.chars()));
  }
}

/// Authoritatively check if a string is in NFKC.
// crate: unicode-normalization-0.1.25/src/quick_check.rs:121 is_nfkc
export function is_nfkc(s: Str): boolean {
  switch (is_nfkc_quick(s.chars())) {
    case "Yes":
      return true;
    case "No":
      return false;
    case "Maybe":
      return iter_eq(s.chars(), Recompositions.new_compatible(s.chars()));
  }
}

/// Authoritatively check if a string is in NFD.
// crate: unicode-normalization-0.1.25/src/quick_check.rs:131 is_nfd
export function is_nfd(s: Str): boolean {
  switch (is_nfd_quick(s.chars())) {
    case "Yes":
      return true;
    case "No":
      return false;
    case "Maybe":
      return iter_eq(s.chars(), Decompositions.new_canonical(s.chars()));
  }
}

/// Authoritatively check if a string is in NFKD.
// crate: unicode-normalization-0.1.25/src/quick_check.rs:141 is_nfkd
export function is_nfkd(s: Str): boolean {
  switch (is_nfkd_quick(s.chars())) {
    case "Yes":
      return true;
    case "No":
      return false;
    case "Maybe":
      return iter_eq(s.chars(), Decompositions.new_compatible(s.chars()));
  }
}

/// Authoritatively check if a string is Stream-Safe NFC.
// crate: unicode-normalization-0.1.25/src/quick_check.rs:151 is_nfc_stream_safe
export function is_nfc_stream_safe(s: Str): boolean {
  switch (is_nfc_stream_safe_quick(s.chars())) {
    case "Yes":
      return true;
    case "No":
      return false;
    case "Maybe":
      return iter_eq(s.chars(), Recompositions.new_canonical(stream_safe.StreamSafe.new(s.chars())));
  }
}

/// Authoritatively check if a string is Stream-Safe NFD.
// crate: unicode-normalization-0.1.25/src/quick_check.rs:161 is_nfd_stream_safe
export function is_nfd_stream_safe(s: Str): boolean {
  switch (is_nfd_stream_safe_quick(s.chars())) {
    case "Yes":
      return true;
    case "No":
      return false;
    case "Maybe":
      return iter_eq(s.chars(), Decompositions.new_canonical(stream_safe.StreamSafe.new(s.chars())));
  }
}
