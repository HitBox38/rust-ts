// Port of unicode-normalization =0.1.25 `src/lib.rs` (default features: `std`).
// Table data and lookups: `tables.ts` (generated from the crate's tables.rs by
// tools/gen-unicode-normalization.ts).
//
// Copyright 2012-2015 The Rust Project Developers. See the COPYRIGHT
// file at the top-level directory of this distribution and at
// http://rust-lang.org/COPYRIGHT.
//
// Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
// http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
// <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. This file may not be copied, modified, or distributed
// except according to those terms.

//! Unicode character composition and decomposition utilities
//! as described in
//! [Unicode Standard Annex #15](http://www.unicode.org/reports/tr15/).
//!
//! ```rust
//! extern crate unicode_normalization;
//!
//! use unicode_normalization::char::compose;
//! use unicode_normalization::UnicodeNormalization;
//!
//! fn main() {
//!     assert_eq!(compose('A','\u{30a}'), Some('Å'));
//!
//!     let s = "ÅΩ";
//!     let c = s.nfc().collect::<String>();
//!     assert_eq!(c, "ÅΩ");
//! }
//! ```
//!
//! # crates.io
//!
//! You can use this package in your project by adding the following
//! to your `Cargo.toml`:
//!
//! ```toml
//! [dependencies]
//! unicode-normalization = "0.1.20"
//! ```
import type { Str } from "../../std/str.ts";
import { Decompositions } from "./decompose.ts";
import { Recompositions } from "./recompose.ts";
import { Replacements } from "./replace.ts";
import { StreamSafe } from "./stream_safe.ts";
import { compose, decompose_canonical, decompose_cjk_compat_variants, decompose_compatible } from "./normalize.ts";
import { canonical_combining_class, is_combining_mark } from "./lookups.ts";
import { is_public_assigned } from "./tables.ts";

export { Decompositions, display_Decompositions } from "./decompose.ts";
export {
  is_nfc,
  is_nfc_quick,
  is_nfc_stream_safe,
  is_nfc_stream_safe_quick,
  is_nfd,
  is_nfd_quick,
  is_nfd_stream_safe,
  is_nfd_stream_safe_quick,
  is_nfkc,
  is_nfkc_quick,
  is_nfkd,
  is_nfkd_quick,
  IsNormalized,
  debug_IsNormalized,
} from "./quick_check.ts";
export { Recompositions, display_Recompositions } from "./recompose.ts";
export { Replacements, display_Replacements } from "./replace.ts";
export { StreamSafe } from "./stream_safe.ts";
export { UNICODE_VERSION } from "./tables.ts";
export * as __test_api from "./__test_api.ts";

/**
 * PORT: `I: Iterator<Item = char>`: anything with Rust's `next()` (std/str.ts `Chars`, and every
 * iterator of this crate). `size_hint` is optional; adapters that need it call `unported` without it.
 */
export interface CharIterator {
  next(): number | undefined;
  size_hint?(): [number, number | undefined];
}
/** PORT: `I: Iterator<Item = char> + Clone` (needed by the `Display` impls). */
export interface CloneCharIterator extends CharIterator {
  clone(): this;
}

/// Methods for composing and decomposing characters.
// PORT: `pub mod char { pub use ... }` -> a namespace object of the re-exported fns.
export const char = {
  compose,
  decompose_canonical,
  decompose_cjk_compat_variants,
  decompose_compatible,
  canonical_combining_class,
  is_combining_mark,

  /// Return whether the given character is assigned (`General_Category` != `Unassigned`)
  /// and not Private-Use (`General_Category` != `Private_Use`), in the supported version
  /// of Unicode.
  is_public_assigned,
} as const;

/// Methods for iterating over strings while applying Unicode normalizations
/// as described in
/// [Unicode Standard Annex #15](http://www.unicode.org/reports/tr15/).
// PORT: `trait UnicodeNormalization<I>` has three impls (for `&str`, `char`, and every char
// iterator); each is a const object of the trait's methods: `UnicodeNormalization_str.nfc(s)` is
// `s.nfc()` for `s: &str` (a `Str`), `_char` for a `char`, `_iter` for an iterator.
export interface UnicodeNormalization<S, I extends CharIterator> {
  /// Returns an iterator over the string in Unicode Normalization Form D
  /// (canonical decomposition).
  // crate: unicode-normalization-0.1.25/src/lib.rs:102 nfd
  nfd(self: S): Decompositions<I>;

  /// Returns an iterator over the string in Unicode Normalization Form KD
  /// (compatibility decomposition).
  // crate: unicode-normalization-0.1.25/src/lib.rs:106 nfkd
  nfkd(self: S): Decompositions<I>;

  /// An Iterator over the string in Unicode Normalization Form C
  /// (canonical decomposition followed by canonical composition).
  // crate: unicode-normalization-0.1.25/src/lib.rs:110 nfc
  nfc(self: S): Recompositions<I>;

  /// An Iterator over the string in Unicode Normalization Form KC
  /// (compatibility decomposition followed by canonical composition).
  // crate: unicode-normalization-0.1.25/src/lib.rs:114 nfkc
  nfkc(self: S): Recompositions<I>;

  /// A transformation which replaces [CJK Compatibility Ideograph] codepoints
  /// with normal forms using [Standardized Variation Sequences]. This is not
  /// part of the canonical or compatibility decomposition algorithms, but
  /// performing it before those algorithms produces normalized output which
  /// better preserves the intent of the original text.
  ///
  /// Note that many systems today ignore variation selectors, so these
  /// may not immediately help text display as intended, but they at
  /// least preserve the information in a standardized form, giving
  /// implementations the option to recognize them.
  ///
  /// [CJK Compatibility Ideograph]: https://www.unicode.org/glossary/#compatibility_ideograph
  /// [Standardized Variation Sequences]: https://www.unicode.org/glossary/#standardized_variation_sequence
  // crate: unicode-normalization-0.1.25/src/lib.rs:129 cjk_compat_variants
  cjk_compat_variants(self: S): Replacements<I>;

  /// An Iterator over the string with Conjoining Grapheme Joiner characters
  /// inserted according to the Stream-Safe Text Process ([UAX15-D4]).
  ///
  /// [UAX15-D4]: https://www.unicode.org/reports/tr15/#UAX15-D4
  // crate: unicode-normalization-0.1.25/src/lib.rs:135 stream_safe
  stream_safe(self: S): StreamSafe<I>;
}

type StrChars = ReturnType<Str["chars"]>;

/** `impl<'a> UnicodeNormalization<Chars<'a>> for &'a str` */
export const UnicodeNormalization_str: UnicodeNormalization<Str, StrChars> = {
  // crate: unicode-normalization-0.1.25/src/lib.rs:140 nfd
  nfd(self: Str): Decompositions<StrChars> {
    return Decompositions.new_canonical(self.chars());
  },

  // crate: unicode-normalization-0.1.25/src/lib.rs:145 nfkd
  nfkd(self: Str): Decompositions<StrChars> {
    return Decompositions.new_compatible(self.chars());
  },

  // crate: unicode-normalization-0.1.25/src/lib.rs:150 nfc
  nfc(self: Str): Recompositions<StrChars> {
    return Recompositions.new_canonical(self.chars());
  },

  // crate: unicode-normalization-0.1.25/src/lib.rs:155 nfkc
  nfkc(self: Str): Recompositions<StrChars> {
    return Recompositions.new_compatible(self.chars());
  },

  // crate: unicode-normalization-0.1.25/src/lib.rs:160 cjk_compat_variants
  cjk_compat_variants(self: Str): Replacements<StrChars> {
    return Replacements.new_cjk_compat_variants(self.chars());
  },

  // crate: unicode-normalization-0.1.25/src/lib.rs:165 stream_safe
  stream_safe(self: Str): StreamSafe<StrChars> {
    return StreamSafe.new(self.chars());
  },
};

/** PORT: `option::IntoIter<char>` (`Some(c).into_iter()`), cloneable. */
export class OptionIntoIter {
  constructor(public inner: number | undefined) {}
  next(): number | undefined {
    const c = this.inner;
    this.inner = undefined;
    return c;
  }
  size_hint(): [number, number | undefined] {
    const n = this.inner === undefined ? 0 : 1;
    return [n, n];
  }
  clone(): OptionIntoIter {
    return new OptionIntoIter(this.inner);
  }
}

/** `impl UnicodeNormalization<option::IntoIter<char>> for char` */
export const UnicodeNormalization_char: UnicodeNormalization<number, OptionIntoIter> = {
  // crate: unicode-normalization-0.1.25/src/lib.rs:172 nfd
  nfd(self: number): Decompositions<OptionIntoIter> {
    return Decompositions.new_canonical(new OptionIntoIter(self));
  },

  // crate: unicode-normalization-0.1.25/src/lib.rs:177 nfkd
  nfkd(self: number): Decompositions<OptionIntoIter> {
    return Decompositions.new_compatible(new OptionIntoIter(self));
  },

  // crate: unicode-normalization-0.1.25/src/lib.rs:182 nfc
  nfc(self: number): Recompositions<OptionIntoIter> {
    return Recompositions.new_canonical(new OptionIntoIter(self));
  },

  // crate: unicode-normalization-0.1.25/src/lib.rs:187 nfkc
  nfkc(self: number): Recompositions<OptionIntoIter> {
    return Recompositions.new_compatible(new OptionIntoIter(self));
  },

  // crate: unicode-normalization-0.1.25/src/lib.rs:192 cjk_compat_variants
  cjk_compat_variants(self: number): Replacements<OptionIntoIter> {
    return Replacements.new_cjk_compat_variants(new OptionIntoIter(self));
  },

  // crate: unicode-normalization-0.1.25/src/lib.rs:197 stream_safe
  stream_safe(self: number): StreamSafe<OptionIntoIter> {
    return StreamSafe.new(new OptionIntoIter(self));
  },
};

/** `impl<I: Iterator<Item = char>> UnicodeNormalization<I> for I` */
export const UnicodeNormalization_iter = {
  // crate: unicode-normalization-0.1.25/src/lib.rs:204 nfd
  nfd<I extends CharIterator>(self: I): Decompositions<I> {
    return Decompositions.new_canonical(self);
  },

  // crate: unicode-normalization-0.1.25/src/lib.rs:209 nfkd
  nfkd<I extends CharIterator>(self: I): Decompositions<I> {
    return Decompositions.new_compatible(self);
  },

  // crate: unicode-normalization-0.1.25/src/lib.rs:214 nfc
  nfc<I extends CharIterator>(self: I): Recompositions<I> {
    return Recompositions.new_canonical(self);
  },

  // crate: unicode-normalization-0.1.25/src/lib.rs:219 nfkc
  nfkc<I extends CharIterator>(self: I): Recompositions<I> {
    return Recompositions.new_compatible(self);
  },

  // crate: unicode-normalization-0.1.25/src/lib.rs:224 cjk_compat_variants
  cjk_compat_variants<I extends CharIterator>(self: I): Replacements<I> {
    return Replacements.new_cjk_compat_variants(self);
  },

  // crate: unicode-normalization-0.1.25/src/lib.rs:229 stream_safe
  stream_safe<I extends CharIterator>(self: I): StreamSafe<I> {
    return StreamSafe.new(self);
  },
} as const;

// Benchmarks (benches/bench.rs) are not ported:
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:15 bench_is_nfc_ascii benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:20 bench_is_nfc_normalized benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:25 bench_is_nfc_not_normalized benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:30 bench_is_nfd_ascii benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:35 bench_is_nfd_normalized benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:40 bench_is_nfd_not_normalized benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:45 bench_is_nfc_stream_safe_ascii benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:50 bench_is_nfc_stream_safe_normalized benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:55 bench_is_nfc_stream_safe_not_normalized benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:60 bench_is_nfd_stream_safe_ascii benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:65 bench_is_nfd_stream_safe_normalized benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:70 bench_is_nfd_stream_safe_not_normalized benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:75 bench_nfc_ascii benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:80 bench_nfd_ascii benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:85 bench_nfc_long benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:91 bench_nfd_long benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:97 bench_nfkc_ascii benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:102 bench_nfkd_ascii benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:107 bench_nfkc_long benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:113 bench_nfkd_long benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:119 bench_streamsafe_ascii benchmark, not library code or a test
// crate-skip: unicode-normalization-0.1.25/benches/bench.rs:124 bench_streamsafe_adversarial benchmark, not library code or a test
