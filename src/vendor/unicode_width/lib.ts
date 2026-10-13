// Port of unicode-width =0.2.2 `src/lib.rs` (default features, i.e. with `cjk`).
// Table data: `tables.gen.ts` (generated from upstream's tables.rs by tools/gen-unicode-width.ts).
//
// Copyright 2012-2025 The Rust Project Developers. See the COPYRIGHT
// file at the top-level directory of this distribution and at
// http://rust-lang.org/COPYRIGHT.
//
// Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
// http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
// <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. This file may not be copied, modified, or distributed
// except according to those terms.

//! Determine displayed width of `char` and `str` types according to
//! [Unicode Standard Annex #11](http://www.unicode.org/reports/tr11/)
//! and other portions of the Unicode standard.
//! See the [Rules for determining width](#rules-for-determining-width) section
//! for the exact rules.
//!
//! This crate is `#![no_std]`.
//!
//! (The rest of upstream's crate docs, a description of the width rules, is not repeated here.)
import * as tables from "./tables.ts";

export { UNICODE_VERSION } from "./tables.ts";

// PORT: the traits `UnicodeWidthChar` and `UnicodeWidthStr` become interfaces over `Self` (methods
// taking `self` first); their impls for `char` (a code point) and `str` (a JS string) are the
// same-named companion consts. `mod private { trait Sealed }` only restricts implementors when the
// `cjk` feature is off (with `cjk`, the default, it is implemented for every `T`), so it is erased.

/// Methods for determining displayed width of Unicode characters.
export interface UnicodeWidthChar<Self> {
  /// Returns the character's displayed width in columns, or `None` if the
  /// character is a control character.
  ///
  /// This function treats characters in the Ambiguous category according
  /// to [Unicode Standard Annex #11](http://www.unicode.org/reports/tr11/)
  /// as 1 column wide. This is consistent with the recommendations for non-CJK
  /// contexts, or when the context cannot be reliably determined.
  // crate: unicode-width-0.2.2/src/lib.rs:202 width
  width(self: Self): number | undefined;

  /// Returns the character's displayed width in columns, or `None` if the
  /// character is a control character.
  ///
  /// This function treats characters in the Ambiguous category according
  /// to [Unicode Standard Annex #11](http://www.unicode.org/reports/tr11/)
  /// as 2 columns wide. This is consistent with the recommendations for
  /// CJK contexts.
  // crate: unicode-width-0.2.2/src/lib.rs:212 width_cjk
  width_cjk(self: Self): number | undefined;
}

/// `impl UnicodeWidthChar for char`
export const UnicodeWidthChar: UnicodeWidthChar<number> = {
  /// Returns the character's displayed width in columns, or `None` if the
  /// character is a control character.
  ///
  /// This function treats characters in the Ambiguous category according
  /// to [Unicode Standard Annex #11](http://www.unicode.org/reports/tr11/)
  /// as 1 column wide. This is consistent with the recommendations for non-CJK
  /// contexts, or when the context cannot be reliably determined.
  // crate: unicode-width-0.2.2/src/lib.rs:217 width
  width(self: number): number | undefined {
    return tables.single_char_width(self);
  },

  /// Returns the character's displayed width in columns, or `None` if the
  /// character is a control character.
  ///
  /// This function treats characters in the Ambiguous category according
  /// to [Unicode Standard Annex #11](http://www.unicode.org/reports/tr11/)
  /// as 2 columns wide. This is consistent with the recommendations for
  /// CJK contexts.
  // crate: unicode-width-0.2.2/src/lib.rs:223 width_cjk
  width_cjk(self: number): number | undefined {
    return tables.single_char_width_cjk(self);
  },
};

/// Methods for determining displayed width of Unicode strings.
export interface UnicodeWidthStr<Self> {
  /// Returns the string's displayed width in columns.
  ///
  /// This function treats characters in the Ambiguous category according
  /// to [Unicode Standard Annex #11](http://www.unicode.org/reports/tr11/)
  /// as 1 column wide. This is consistent with the recommendations for
  /// non-CJK contexts, or when the context cannot be reliably determined.
  // crate: unicode-width-0.2.2/src/lib.rs:236 width
  width(self: Self): number;

  /// Returns the string's displayed width in columns.
  ///
  /// This function treats characters in the Ambiguous category according
  /// to [Unicode Standard Annex #11](http://www.unicode.org/reports/tr11/)
  /// as 2 column wide. This is consistent with the recommendations for
  /// CJK contexts.
  // crate: unicode-width-0.2.2/src/lib.rs:245 width_cjk
  width_cjk(self: Self): number;
}

/// `impl UnicodeWidthStr for str`
export const UnicodeWidthStr: UnicodeWidthStr<string> = {
  /// Returns the string's displayed width in columns.
  ///
  /// This function treats characters in the Ambiguous category according
  /// to [Unicode Standard Annex #11](http://www.unicode.org/reports/tr11/)
  /// as 1 column wide. This is consistent with the recommendations for
  /// non-CJK contexts, or when the context cannot be reliably determined.
  // crate: unicode-width-0.2.2/src/lib.rs:250 width
  width(self: string): number {
    return tables.str_width(self);
  },

  /// Returns the string's displayed width in columns.
  ///
  /// This function treats characters in the Ambiguous category according
  /// to [Unicode Standard Annex #11](http://www.unicode.org/reports/tr11/)
  /// as 2 column wide. This is consistent with the recommendations for
  /// CJK contexts.
  // crate: unicode-width-0.2.2/src/lib.rs:256 width_cjk
  width_cjk(self: string): number {
    return tables.str_width_cjk(self);
  },
};
