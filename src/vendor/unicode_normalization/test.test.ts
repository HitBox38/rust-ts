// Port of unicode-normalization =0.1.25 `src/test.rs`.
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
import { expect, test } from "bun:test";
import { Str } from "../../std/str.ts";
import {
  type CharIterator,
  char,
  display_Decompositions,
  display_Recompositions,
  UnicodeNormalization_char,
  UnicodeNormalization_iter,
  UnicodeNormalization_str,
} from "./lib.ts";

const S = (s: string) => Str.from(s);
/** `.collect::<String>()` */
function collect(it: CharIterator): string {
  let out = "";
  for (let c = it.next(); c !== undefined; c = it.next()) out += String.fromCodePoint(c);
  return out;
}
/** `s.chars().map(|c| c)`: a char iterator that is not `Chars` itself. */
function mapped(s: string): CharIterator {
  const it = S(s).chars();
  return { next: () => it.next() };
}

// crate: unicode-normalization-0.1.25/src/test.rs:19 test_nfd
test("test_nfd", () => {
  const t = (input: string, expected: string) => {
    expect(display_Decompositions(UnicodeNormalization_str.nfd(S(input)))).toBe(expected);
    // A dummy iterator that is not std::str::Chars directly;
    // note that `id_func` is used to ensure `Clone` implementation
    expect(collect(UnicodeNormalization_iter.nfd(mapped(input)))).toBe(expected);
  };
  t("abc", "abc");
  t("\u{1e0b}\u{1c4}", "d\u{307}\u{1c4}");
  t("\u{2026}", "\u{2026}");
  t("\u{2126}", "\u{3a9}");
  t("\u{1e0b}\u{323}", "d\u{323}\u{307}");
  t("\u{1e0d}\u{307}", "d\u{323}\u{307}");
  t("a\u{301}", "a\u{301}");
  t("\u{301}a", "\u{301}a");
  t("\u{d4db}", "\u{1111}\u{1171}\u{11b6}");
  t("\u{ac1c}", "\u{1100}\u{1162}");
});

// crate: unicode-normalization-0.1.25/src/test.rs:44 test_nfkd
test("test_nfkd", () => {
  const t = (input: string, expected: string) => {
    expect(display_Decompositions(UnicodeNormalization_str.nfkd(S(input)))).toBe(expected);
  };
  t("abc", "abc");
  t("\u{1e0b}\u{1c4}", "d\u{307}DZ\u{30c}");
  t("\u{2026}", "...");
  t("\u{2126}", "\u{3a9}");
  t("\u{1e0b}\u{323}", "d\u{323}\u{307}");
  t("\u{1e0d}\u{307}", "d\u{323}\u{307}");
  t("a\u{301}", "a\u{301}");
  t("\u{301}a", "\u{301}a");
  t("\u{d4db}", "\u{1111}\u{1171}\u{11b6}");
  t("\u{ac1c}", "\u{1100}\u{1162}");
});

// crate: unicode-normalization-0.1.25/src/test.rs:63 test_nfc
test("test_nfc", () => {
  const t = (input: string, expected: string) => {
    expect(display_Recompositions(UnicodeNormalization_str.nfc(S(input)))).toBe(expected);
  };
  t("abc", "abc");
  t("\u{1e0b}\u{1c4}", "\u{1e0b}\u{1c4}");
  t("\u{2026}", "\u{2026}");
  t("\u{2126}", "\u{3a9}");
  t("\u{1e0b}\u{323}", "\u{1e0d}\u{307}");
  t("\u{1e0d}\u{307}", "\u{1e0d}\u{307}");
  t("a\u{301}", "\u{e1}");
  t("\u{301}a", "\u{301}a");
  t("\u{d4db}", "\u{d4db}");
  t("\u{ac1c}", "\u{ac1c}");
  t("a\u{300}\u{305}\u{315}\u{5ae}b", "\u{e0}\u{5ae}\u{305}\u{315}b");
});

// crate: unicode-normalization-0.1.25/src/test.rs:86 test_nfkc
test("test_nfkc", () => {
  const t = (input: string, expected: string) => {
    expect(display_Recompositions(UnicodeNormalization_str.nfkc(S(input)))).toBe(expected);
  };
  t("abc", "abc");
  t("\u{1e0b}\u{1c4}", "\u{1e0b}D\u{17d}");
  t("\u{2026}", "...");
  t("\u{2126}", "\u{3a9}");
  t("\u{1e0b}\u{323}", "\u{1e0d}\u{307}");
  t("\u{1e0d}\u{307}", "\u{1e0d}\u{307}");
  t("a\u{301}", "\u{e1}");
  t("\u{301}a", "\u{301}a");
  t("\u{d4db}", "\u{d4db}");
  t("\u{ac1c}", "\u{ac1c}");
  t("a\u{300}\u{305}\u{315}\u{5ae}b", "\u{e0}\u{5ae}\u{305}\u{315}b");
});

// crate: unicode-normalization-0.1.25/src/test.rs:109 test_normalize_char
test("test_normalize_char", () => {
  expect(display_Decompositions(UnicodeNormalization_char.nfd(0x2126))).toBe("\u{3a9}");
});

// crate: unicode-normalization-0.1.25/src/test.rs:114 test_is_combining_mark_ascii
test("test_is_combining_mark_ascii", () => {
  for (let cp = 0; cp < 0x7f; cp++) {
    expect(char.is_combining_mark(cp)).toBe(false);
  }
});

// crate: unicode-normalization-0.1.25/src/test.rs:121 test_is_combining_mark_misc
test("test_is_combining_mark_misc", () => {
  // https://github.com/unicode-rs/unicode-normalization/issues/16
  // U+11C3A BHAIKSUKI VOWEL SIGN O
  // Category: Mark, Nonspacing [Mn]
  expect(char.is_combining_mark(0x11c3a)).toBe(true);

  // U+11C3F BHAIKSUKI SIGN VIRAMA
  // Category: Mark, Nonspacing [Mn]
  expect(char.is_combining_mark(0x11c3f)).toBe(true);
});
