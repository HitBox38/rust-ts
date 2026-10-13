// Port of unicode-width =0.2.2 `tests/tests.rs`.
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
//
// PORT: `assert_width!` dispatches on the type of `$s` like the trait methods do: a number is a
// `char` (`UnicodeWidthChar`, `Option<usize>` -> `number | undefined`), a string a `str`
// (`UnicodeWidthStr`). `format!("..{c}..")` -> template strings with `String.fromCodePoint(c)`;
// `for c in '\0'..=char::MAX` -> every scalar value (surrogates skipped, as `RangeInclusive<char>`
// does). The crate is built with its default features, so every `#[cfg(feature = "cjk")]` is on.
// `emoji_test_file` reads the crate's own `tests/emoji-test.txt` from the cargo registry (where the
// `uwidth` probe build puts the crate); it skips visibly if the crate source is not there, and fails
// instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { UnicodeWidthChar, UnicodeWidthStr } from "../lib.ts";

// macro_rules! assert_width
function assert_width(s: string | number, nocjk: number | undefined, cjk: number | undefined): void {
  if (typeof s === "number") {
    expect(UnicodeWidthChar.width(s), `${JSON.stringify(String.fromCodePoint(s))} has the wrong width`).toBe(nocjk);
    expect(UnicodeWidthChar.width_cjk(s), `${JSON.stringify(String.fromCodePoint(s))} has the wrong width (CJK)`).toBe(cjk);
  } else {
    expect<number | undefined>(UnicodeWidthStr.width(s), `${JSON.stringify(s)} has the wrong width`).toBe(nocjk);
    expect<number | undefined>(UnicodeWidthStr.width_cjk(s), `${JSON.stringify(s)} has the wrong width (CJK)`).toBe(cjk);
  }
}
const ch = (s: string): number => s.codePointAt(0)!;
/** Tests that loop over `all_chars()` (1.1M scalars) get an explicit timeout: bun's default 5 s is
 *  too short on a loaded host (review parser-b, batch 6 finding 1). Not part of the upstream tests. */
const ALL_CHARS_TIMEOUT_MS = 300_000;
/** `'\0'..=char::MAX` */
function* all_chars(): Generator<number> {
  for (let c = 0; c <= 0x10ffff; c++) if (c < 0xd800 || c > 0xdfff) yield c;
}
const S = (c: number): string => String.fromCodePoint(c);
/** `c.width().unwrap_or(1)` */
const unwrap_or = (w: number | undefined, d: number): number => (w === undefined ? d : w);

// crate: unicode-width-0.2.2/tests/tests.rs:27 test_str
test("test_str", () => {
    assert_width("ｈｅｌｌｏ", 10, 10);
    assert_width("\0\0\0\x01\x01", 5, 5);
    assert_width("", 0, 0);
    assert_width("\u{2081}\u{2082}\u{2083}\u{2084}", 4, 8);
});

// crate: unicode-width-0.2.2/tests/tests.rs:35 test_emoji
test("test_emoji", () => {
    assert_width("👩", 2, 2); // Woman
    assert_width("🔬", 2, 2); // Microscope
    assert_width("👩‍🔬", 2, 2); // Woman scientist
});

// From README
// crate: unicode-width-0.2.2/tests/tests.rs:43 test_bad_devanagari
test("test_bad_devanagari", () => {
    expect(UnicodeWidthStr.width("क")).toBe(1); // Devanagari letter Ka
    expect(UnicodeWidthStr.width("ष")).toBe(1); // Devanagari letter Ssa
    expect(UnicodeWidthStr.width("क्ष")).toBe(2); // Ka + Virama + Ssa
});

// crate: unicode-width-0.2.2/tests/tests.rs:50 test_char
test("test_char", () => {
    assert_width(ch("ｈ"), 2, 2);
    assert_width(0x00, undefined, undefined);
    assert_width(0x01, undefined, undefined);
    assert_width(0x2081, 1, 2);
});

// crate: unicode-width-0.2.2/tests/tests.rs:58 test_char2
test("test_char2", () => {
    assert_width(0x0a, undefined, undefined);
    assert_width(ch("w"), 1, 1);
    assert_width(ch("ｈ"), 2, 2);
    assert_width(0xad, 0, 0);
    assert_width(0x1160, 0, 0);
    assert_width(0xa1, 1, 2);
    assert_width(0x300, 0, 0);
});

// crate: unicode-width-0.2.2/tests/tests.rs:69 unicode_12
test("unicode_12", () => {
    assert_width(0x1f971, 2, 2);
});

// crate: unicode-width-0.2.2/tests/tests.rs:74 test_default_ignorable
test("test_default_ignorable", () => {
    assert_width(0x1160, 0, 0);
    assert_width(0x3164, 0, 0);
    assert_width(0xffa0, 0, 0);
    assert_width(0xe0000, 0, 0);
});

// crate: unicode-width-0.2.2/tests/tests.rs:82 test_ambiguous
test("test_ambiguous", () => {
    assert_width("\u{B7}", 1, 2);
    assert_width("\u{0387}", 1, 2);
    assert_width("\u{A8}", 1, 1);
    assert_width("\u{02C9}", 1, 1);
});

// crate: unicode-width-0.2.2/tests/tests.rs:90 test_jamo
test("test_jamo", () => {
    assert_width(0x1100, 2, 2);
    assert_width(0xa97c, 2, 2);
    // Special case: U+115F HANGUL CHOSEONG FILLER
    assert_width(0x115f, 2, 2);
    assert_width(0x1160, 0, 0);
    assert_width(0xd7c6, 0, 0);
    assert_width(0x11a8, 0, 0);
    assert_width(0xd7fb, 0, 0);
});

// crate: unicode-width-0.2.2/tests/tests.rs:102 test_prepended_concatenation_marks
test("test_prepended_concatenation_marks", () => {
    for (const c of [
        0x0600,
        0x0601,
        0x0602,
        0x0603,
        0x0604,
        0x06dd,
        0x110bd,
        0x110cd,
    ]) {
        assert_width(c, 1, 1);
    }

    for (const c of [0x0605, 0x070f, 0x0890, 0x0891, 0x08e2]) {
        assert_width(c, 0, 0);
    }
});

// crate: unicode-width-0.2.2/tests/tests.rs:122 test_gcb_prepend
test("test_gcb_prepend", () => {
    assert_width("ൎഉ", 1, 1);
    assert_width("\u{11A89}", 0, 0);
});

// crate: unicode-width-0.2.2/tests/tests.rs:128 test_interlinear_annotation_chars
test("test_interlinear_annotation_chars", () => {
    assert_width(0xfff9, 1, 1);
    assert_width(0xfffa, 1, 1);
    assert_width(0xfffb, 1, 1);
});

// crate: unicode-width-0.2.2/tests/tests.rs:135 test_hieroglyph_format_controls
test("test_hieroglyph_format_controls", () => {
    assert_width(0x13430, 1, 1);
    assert_width(0x13436, 1, 1);
    assert_width(0x1343c, 1, 1);
});

// crate: unicode-width-0.2.2/tests/tests.rs:142 test_marks
test("test_marks", () => {
    // Nonspacing marks have 0 width
    assert_width(0x0301, 0, 0);
    // Enclosing marks have 0 width
    assert_width(0x20dd, 0, 0);
    // Some spacing marks have width 1
    assert_width(0x09cb, 1, 1);
    // But others have width 0
    assert_width(0x09be, 0, 0);
});

// crate: unicode-width-0.2.2/tests/tests.rs:154 test_devanagari_caret
test("test_devanagari_caret", () => {
    assert_width(0xa8fa, 0, 0);
});

// crate: unicode-width-0.2.2/tests/tests.rs:159 test_solidus_overlay
test("test_solidus_overlay", () => {
    assert_width("<\u{338}", 1, 2);
    assert_width("=\u{338}", 1, 2);
    assert_width(">\u{338}", 1, 2);
    assert_width("=\u{301}\u{338}", 1, 2);
    assert_width("=\u{338}\u{301}", 1, 2);
    assert_width("=\u{FE0F}\u{338}", 1, 2);
    assert_width("#\u{FE0F}\u{338}", 2, 2);
    assert_width("#\u{338}\u{FE0F}", 1, 1);

    assert_width("\u{06B8}\u{338}\u{0627}", 1, 1);
    assert_width("\u{06B8}\u{338}\u{FE0E}\u{0627}", 1, 1);
    assert_width("\u{06B8}\u{338}\u{FE0F}\u{0627}", 1, 1);
    assert_width("\u{06B8}\u{FE0E}\u{338}\u{0627}", 1, 1);
    assert_width("\u{06B8}\u{FE0F}\u{338}\u{0627}", 1, 1);

    assert_width("=\u{338}\u{0627}", 2, 3);
});

// crate: unicode-width-0.2.2/tests/tests.rs:179 test_emoji_presentation
test("test_emoji_presentation", () => {
    assert_width(0x0023, 1, 1);
    assert_width(0xfe0f, 0, 0);
    assert_width("\u{0023}\u{FE0F}", 2, 2);
    assert_width("a\u{0023}\u{FE0F}a", 4, 4);
    assert_width("\u{0023}a\u{FE0F}", 2, 2);
    assert_width("a\u{FE0F}", 1, 1);
    assert_width("\u{0023}\u{0023}\u{FE0F}a", 4, 4);
    assert_width("\u{002A}\u{FE0F}", 2, 2);
    assert_width("\u{23F9}\u{FE0F}", 2, 2);
    assert_width("\u{24C2}\u{FE0F}", 2, 2);
    assert_width("\u{1F6F3}\u{FE0F}", 2, 2);
    assert_width("\u{1F700}\u{FE0F}", 1, 1);
    assert_width("\u{002A}\u{301}\u{FE0F}", 1, 1);
    assert_width("\u{002A}\u{200D}\u{FE0F}", 1, 1);
    assert_width("\u{002A}\u{FE0E}\u{FE0F}", 1, 1);
});

// crate: unicode-width-0.2.2/tests/tests.rs:198 test_text_presentation
test("test_text_presentation", () => {
    assert_width(0xfe0e, 0, 0);
    assert_width(0x2648, 2, 2);
    assert_width("\u{2648}\u{FE0E}", 1, 2);
    assert_width("\u{2648}\u{FE0E}\u{FE0F}", 1, 2);
    assert_width("\u{2648}\u{FE0F}\u{FE0E}", 2, 2);
    assert_width("\u{1F21A}\u{FE0E}", 2, 2);
    assert_width("\u{0301}\u{FE0E}", 0, 0);
    assert_width("a\u{FE0E}", 1, 1);
    assert_width("𘀀\u{FE0E}", 2, 2);
    assert_width("\u{2648}\u{0301}\u{FE0E}", 2, 2);
    assert_width("\u{2648}\u{200D}\u{FE0E}", 2, 2);
});

// crate: unicode-width-0.2.2/tests/tests.rs:213 test_control_line_break
test("test_control_line_break", () => {
    assert_width(0x2028, 1, 1);
    assert_width(0x2029, 1, 1);
    assert_width(0x0d, undefined, undefined);
    assert_width(0x0a, undefined, undefined);
    assert_width("\r", 1, 1);
    assert_width("\n", 1, 1);
    assert_width("\r\n", 1, 1);
    assert_width("\0", 1, 1);
    assert_width("1\t2\r\n3\u{85}4", 7, 7);
    assert_width("\r\u{FE0F}\n", 2, 2);
    assert_width("\r\u{200D}\n", 2, 2);
});

// crate: unicode-width-0.2.2/tests/tests.rs:228 char_str_consistent
test("char_str_consistent", () => {
    for (const c of all_chars()) {
        const s = S(c);
        expect(UnicodeWidthStr.width(s)).toBe(unwrap_or(UnicodeWidthChar.width(c), 1));
        expect(UnicodeWidthStr.width_cjk(s)).toBe(unwrap_or(UnicodeWidthChar.width_cjk(c), 1));
    }
}, ALL_CHARS_TIMEOUT_MS);

// crate: unicode-width-0.2.2/tests/tests.rs:240 test_lisu_tones
test("test_lisu_tones", () => {
    for (let c = 0xa4f8; c <= 0xa4fd; c++) {
        assert_width(c, 1, 1);
        assert_width(S(c), 1, 1);
    }
    for (let c1 = 0xa4f8; c1 <= 0xa4fd; c1++) {
        for (let c2 = 0xa4f8; c2 <= 0xa4fd; c2++) {
            const s = S(c1) + S(c2);
            if (c1 >= 0xa4f8 && c1 <= 0xa4fb && c2 >= 0xa4fc && c2 <= 0xa4fd) assert_width(s, 1, 1);
            else assert_width(s, 2, 2);
        }
    }

    assert_width("ꓪꓹ", 2, 2);
    assert_width("ꓪꓹꓼ", 2, 2);
    assert_width("ꓪꓹ\u{FE0F}ꓼ", 2, 2);
    assert_width("ꓪꓹ\u{200D}ꓼ", 2, 2);
    assert_width("ꓪꓹꓼ\u{FE0F}", 2, 2);
    assert_width("ꓪꓹ\u{0301}ꓼ", 3, 3);
    assert_width("ꓪꓹꓹ", 3, 3);
    assert_width("ꓪꓼꓼ", 3, 3);
});

// crate: unicode-width-0.2.2/tests/tests.rs:268 test_hebrew_alef_lamed
test("test_hebrew_alef_lamed", () => {
    assert_width("\u{05D0}", 1, 1);
    assert_width("\u{05DC}", 1, 1);
    assert_width("\u{05D0}\u{05DC}", 2, 2);
    assert_width("\u{05D0}\u{200D}\u{05DC}", 1, 1);
    assert_width("\u{05D0}\u{200D}\u{200D}\u{200D}\u{200D}\u{200D}\u{200D}\u{200D}\u{05DC}", 1, 1);
    assert_width("\u{05D0}\u{05D0}\u{200D}\u{05DC}", 2, 2);
    assert_width("\u{05D0}\u{05D0}\u{200D}\u{200D}\u{200D}\u{200D}\u{200D}\u{200D}\u{05DC}", 2, 2);
    assert_width("\u{05D0}\u{FE0F}\u{200D}\u{FE0F}\u{05DC}\u{FE0F}", 1, 1);
    assert_width("\u{05D0}\u{FE0E}\u{200D}\u{FE0E}\u{05DC}\u{FE0E}", 1, 1);
});

// crate: unicode-width-0.2.2/tests/tests.rs:289 test_arabic_lam_alef
test("test_arabic_lam_alef", () => {
    assert_width("\u{0644}", 1, 1);
    assert_width("\u{06B8}", 1, 1);

    assert_width("\u{0623}", 1, 1);
    assert_width("\u{0627}", 1, 1);

    assert_width("\u{0644}\u{0623}", 1, 1);
    assert_width("\u{0644}\u{0627}", 1, 1);
    assert_width("\u{06B8}\u{0623}", 1, 1);
    assert_width("\u{06B8}\u{0627}", 1, 1);

    assert_width("\u{0644}\u{065F}\u{065E}\u{0623}", 1, 1);
    assert_width("\u{0644}\u{065F}\u{065E}\u{0627}", 1, 1);
    assert_width("\u{06B8}\u{065F}\u{065E}\u{0623}", 1, 1);
    assert_width("\u{06B8}\u{065F}\u{065E}\u{0627}", 1, 1);

    assert_width("\u{06B8}\u{FE0E}\u{0627}", 1, 1);
    assert_width("\u{06B8}\u{FE0F}\u{0627}", 1, 1);
    assert_width("\u{06B8}\u{17B5}\u{0627}", 1, 1);

    assert_width("\u{0644}\u{0644}\u{0623}", 2, 2);
    assert_width("\u{0644}\u{0644}\u{0627}", 2, 2);
    assert_width("\u{06B8}\u{06B8}\u{0623}", 2, 2);
    assert_width("\u{06B8}\u{06B8}\u{0627}", 2, 2);

    assert_width("\u{0644}\u{200D}\u{0623}", 2, 2);
    assert_width("\u{0644}\u{200D}\u{0627}", 2, 2);
    assert_width("\u{06B8}\u{200D}\u{0623}", 2, 2);
    assert_width("\u{06B8}\u{200D}\u{0627}", 2, 2);

    assert_width("\u{0644}\u{1E94B}\u{0623}", 3, 3);
    assert_width("\u{0644}\u{1E94B}\u{0627}", 3, 3);
    assert_width("\u{06B8}\u{1E94B}\u{0623}", 3, 3);
    assert_width("\u{06B8}\u{1E94B}\u{0627}", 3, 3);
});

// crate: unicode-width-0.2.2/tests/tests.rs:327 test_buginese_a_i_ya
test("test_buginese_a_i_ya", () => {
    assert_width("\u{1A15}", 1, 1);
    assert_width("\u{1A17}", 0, 0);
    assert_width("\u{1A10}", 1, 1);

    assert_width("\u{1A15}\u{1A17}\u{200D}\u{1A10}", 1, 1);
    assert_width("\u{1A15}\u{1A17}\u{200D}\u{200D}\u{200D}\u{200D}\u{1A10}", 1, 1);
    assert_width("\u{1A15}\u{1A17}\u{200D}\u{338}", 1, 1);
    assert_width("\u{1A15}\u{FE0E}\u{1A17}\u{200D}", 1, 1);
    assert_width("\u{1A15}\u{FE0F}\u{1A17}\u{200D}", 1, 1);
    assert_width("\u{1A15}\u{1A17}\u{FE0E}\u{200D}", 1, 1);
    assert_width("\u{1A15}\u{1A17}\u{FE0F}\u{200D}", 1, 1);
    assert_width("\u{1A15}\u{1A17}\u{200D}\u{FE0E}", 1, 1);
    assert_width("\u{1A15}\u{1A17}\u{200D}\u{FE0F}", 1, 1);
    assert_width("\u{1A15}\u{17B5}\u{200D}\u{FE0E}\u{1A17}\u{200D}\u{FE0F}\u{200D}\u{FE0F}", 1, 1);

    assert_width("\u{1A15}\u{1A15}\u{1A17}\u{200D}\u{1A10}", 2, 2);
    assert_width("\u{1A15}\u{1A15}\u{1A17}\u{200D}\u{200D}\u{200D}\u{200D}\u{1A10}", 2, 2);

    assert_width("\u{1A15}\u{1A17}\u{1A10}", 2, 2);
    assert_width("\u{1A15}\u{200D}\u{1A10}", 2, 2);
    assert_width("\u{1A15}\u{1A10}", 2, 2);
    assert_width("\u{1A15}\u{1A17}\u{1A17}\u{200D}\u{1A10}", 2, 2);
    assert_width("\u{1A15}\u{1A17}\u{338}\u{200D}\u{1A10}", 2, 2);
});

// crate: unicode-width-0.2.2/tests/tests.rs:366 test_tifinagh_biconsonants
test("test_tifinagh_biconsonants", () => {
    assert_width("\u{2D4F}", 1, 1);
    assert_width("\u{2D3E}", 1, 1);
    assert_width("\u{2D7F}", 1, 1);

    assert_width("\u{2D4F}\u{200D}\u{2D3E}", 1, 1);
    assert_width("\u{2D4F}\u{2D7F}\u{2D3E}", 1, 1);
    assert_width("\u{2D4F}\u{200D}\u{2D3E}", 1, 1);
    assert_width("\u{2D4F}\u{FE0F}\u{200D}\u{2D7F}\u{FE0E}\u{200D}\u{17B5}\u{2D3E}", 1, 1);

    assert_width("\u{2D4F}\u{301}\u{2D7F}\u{2D3E}", 3, 3);
    assert_width("\u{2D4F}\u{301}\u{200D}\u{2D3E}", 2, 2);
    assert_width("\u{2D4F}\u{2D3E}", 2, 2);
    assert_width("\u{2D4F}\u{2D7F}\u{2D7F}\u{2D3E}", 4, 4);
    assert_width("\u{2D7F}\u{2D3E}", 2, 2);
    assert_width("\u{2D7F}\u{2D7F}\u{2D66}", 3, 3);
    assert_width("\u{2D66}\u{2D7F}\u{2D3E}", 3, 3);
});

// crate: unicode-width-0.2.2/tests/tests.rs:390 test_old_turkic_ligature
test("test_old_turkic_ligature", () => {
    assert_width("\u{10C32}", 1, 1);
    assert_width("\u{10C03}", 1, 1);
    assert_width("\u{10C32}\u{10C03}", 2, 2);

    assert_width("\u{10C32}\u{200D}\u{10C03}", 1, 1);
    assert_width("\u{10C32}\u{FE0F}\u{200D}\u{FE0E}\u{10C03}", 1, 1);

    assert_width("\u{10C32}\u{2D7F}\u{10C03}", 3, 3);
    assert_width("\u{10C32}\u{0301}\u{200D}\u{10C03}", 2, 2);
    assert_width("\u{10C03}\u{200D}\u{10C32}", 2, 2);
    assert_width("\u{200D}\u{10C32}", 1, 1);
});

// crate: unicode-width-0.2.2/tests/tests.rs:405 test_khmer_coeng
test("test_khmer_coeng", () => {
    assert_width("ល", 1, 1);
    assert_width("ង", 1, 1);
    assert_width("លង", 2, 2);
    assert_width("ល្ង", 1, 1);

    for (const c of all_chars()) {
        if (
            (c >= 0x1780 && c <= 0x1782) || (c >= 0x1784 && c <= 0x1787)
            || (c >= 0x1789 && c <= 0x178c) || (c >= 0x178e && c <= 0x1793)
            || (c >= 0x1795 && c <= 0x1798) || (c >= 0x179b && c <= 0x179d)
            || c === 0x17a0 || c === 0x17a2 || c === 0x17a7
            || (c >= 0x17ab && c <= 0x17ac) || c === 0x17af
        ) {
            assert_width(`\u{17D2}${S(c)}`, 0, 0);
            assert_width(`\u{17D2}\u{200D}\u{200D}${S(c)}`, 0, 0);
        } else {
            assert_width(`\u{17D2}${S(c)}`, unwrap_or(UnicodeWidthChar.width(c), 1), unwrap_or(UnicodeWidthChar.width_cjk(c), 1));
        }
    }
}, ALL_CHARS_TIMEOUT_MS);

// crate: unicode-width-0.2.2/tests/tests.rs:433 test_khmer_qaa
test("test_khmer_qaa", () => {
    assert_width("\u{17A4}", 2, 2);
    assert_width("\u{17A2}\u{17A6}", 2, 2);
});

// crate: unicode-width-0.2.2/tests/tests.rs:439 test_khmer_sign_beyyal
test("test_khmer_sign_beyyal", () => {
    assert_width("\u{17D8}", 3, 3);
    assert_width("\u{17D4}\u{179B}\u{17D4}", 3, 3);
});

// crate: unicode-width-0.2.2/tests/tests.rs:445 test_emoji_modifier
test("test_emoji_modifier", () => {
    assert_width("\u{1F46A}", 2, 2);
    assert_width("\u{1F3FB}", 2, 2);
    assert_width("\u{1F46A}\u{1F3FB}", 2, 2);
    assert_width("\u{1F46A}\u{200D}\u{200D}\u{1F3FB}", 4, 4);
});

// crate: unicode-width-0.2.2/tests/tests.rs:453 test_emoji_zwj
test("test_emoji_zwj", () => {
    assert_width("🧑‍🤝‍🧑", 2, 2);

    assert_width("🇮🇱🕊️🇵🇸", 6, 6);
    assert_width("🇵🇸\u{200D}🕊️\u{200D}🇮🇱", 2, 2);
    assert_width("🇮🇱\u{200D}🕊️\u{200D}\u{200D}🇵🇸", 4, 4);
    assert_width("🇵🇸\u{200D}\u{200D}🕊️\u{200D}🇮🇱", 4, 4);

    assert_width("🇦🇦\u{200D}🇦🇦", 2, 2);
    assert_width("🇦🇦\u{200D}🇦🇦🇦", 3, 3);
    assert_width("🇦🇦\u{200D}🇦🇦🇦", 3, 3);

    assert_width("🇦🇦\u{200D}\u{200D}🇦🇦", 4, 4);
    assert_width("🇦🇦\u{200D}🇦\u{200D}🇦🇦", 5, 5);
    assert_width("🇦🇦\u{200D}🇦🇦\u{200D}🇦🇦", 2, 2);
    assert_width("🇦🇦\u{200D}🇦🇦🇦\u{200D}🇦🇦", 5, 5);
    assert_width("🇦🇦\u{200D}🇦🇦🇦🇦\u{200D}🇦🇦", 4, 4);
    assert_width("🇦🇦\u{200D}🇦🇦🇦🇦🇦\u{200D}🇦🇦", 7, 7);
    assert_width("🇦🇦\u{200D}🇦🇦🇦🇦🇦🇦\u{200D}🇦🇦", 6, 6);
    assert_width("🇦🇦\u{200D}🇦🇦🇦🇦🇦🇦🇦\u{200D}🇦🇦", 9, 9);

    assert_width("🏴󠁧󠁢󠁷󠁬󠁳󠁿", 2, 2);
    assert_width("🏴󠁧󠁢󠁥󠁮󠁧󠁿\u{200D}🏴󠁧󠁢󠁳󠁣󠁴󠁿\u{200D}🏴󠁧󠁢󠁷󠁬󠁳󠁿", 2, 2);

    assert_width("🇦👪\u{200D}🏿", 3, 3);
    assert_width("🇦🏿\u{200D}🏿", 3, 3);

    assert_width(ch("🏴"), 2, 2);
    assert_width("\u{E0031}", 0, 0);
    assert_width("\u{E0063}", 0, 0);
    assert_width("\u{E007F}", 0, 0);
    assert_width("🏴\u{200D}Ⓜ️", 2, 2);
    assert_width("🏴\u{E0031}\u{200D}Ⓜ️", 4, 4);
    assert_width("🏴\u{E0063}\u{200D}Ⓜ️", 4, 4);
    assert_width("🏴\u{E007F}\u{200D}Ⓜ️", 4, 4);
    assert_width("🏴\u{E0031}\u{E007F}\u{200D}Ⓜ️", 4, 4);
    assert_width("🏴\u{E0031}\u{E0031}\u{E007F}\u{200D}Ⓜ️", 4, 4);
    assert_width("🏴\u{E0031}\u{E0031}\u{E0031}\u{E007F}\u{200D}Ⓜ️", 2, 2);
    assert_width("🏴\u{E0031}\u{E0031}\u{E0031}\u{E0031}\u{E007F}\u{200D}Ⓜ️", 4, 4);
    assert_width("🏴\u{E0031}\u{E0031}\u{E0031}\u{E0063}\u{E007F}\u{200D}Ⓜ️", 2, 2);
    assert_width("🏴\u{E0031}\u{E0031}\u{E0031}\u{E0063}\u{E0063}\u{E007F}\u{200D}Ⓜ️", 2, 2);
    assert_width("🏴\u{E0031}\u{E0031}\u{E0031}\u{E0063}\u{E0063}\u{E0063}\u{E007F}\u{200D}Ⓜ️", 2, 2);
    assert_width("🏴\u{E0031}\u{E0031}\u{E0031}\u{E0063}\u{E0063}\u{E0063}\u{E0063}\u{E007F}\u{200D}Ⓜ️", 2, 2);
    assert_width("🏴\u{E0031}\u{E0031}\u{E0031}\u{E0063}\u{E0063}\u{E0063}\u{E0063}\u{E0063}\u{E007F}\u{200D}Ⓜ️", 4, 4);
    assert_width("🏴\u{E0063}\u{E0063}\u{E007F}\u{200D}Ⓜ️", 4, 4);
    assert_width("🏴\u{E0063}\u{E0063}\u{E0063}\u{E007F}\u{200D}Ⓜ️", 2, 2);
    assert_width("🏴\u{E0063}\u{E0063}\u{E0063}\u{E0063}\u{E007F}\u{200D}Ⓜ️", 2, 2);
    assert_width("🏴\u{E0063}\u{E0063}\u{E0063}\u{E0063}\u{E0063}\u{E007F}\u{200D}Ⓜ️", 2, 2);
    assert_width("🏴\u{E0063}\u{E0063}\u{E0063}\u{E0063}\u{E0063}\u{E0063}\u{E007F}\u{200D}Ⓜ️", 2, 2);
    assert_width("🏴\u{E0063}\u{E0063}\u{E0063}\u{E0063}\u{E0063}\u{E0063}\u{E0063}\u{E007F}\u{200D}Ⓜ️", 4, 4);

    assert_width("a\u{200D}🏴󠁧󠁢󠁷󠁬󠁳󠁿", 3, 3);
    assert_width("👪\u{200D}a", 3, 3);
    assert_width("a\u{200D}a", 2, 2);

    assert_width("*\u{FE0F}", 2, 2);
    assert_width("*\u{20E3}", 1, 1);
    assert_width("*️⃣", 2, 2);
    assert_width("*\u{FE0F}", 2, 2);
    assert_width("*\u{20E3}\u{FE0F}", 1, 1);
    assert_width("*️⃣\u{200D}👪", 2, 2);
    assert_width("*\u{20E3}\u{FE0F}\u{200D}👪", 3, 3);
    assert_width("*\u{20E3}\u{200D}👪", 3, 3);
    assert_width("*\u{FE0F}\u{200D}👪", 2, 2);
    assert_width("*️⃣\u{20E3}\u{200D}👪", 4, 4);
    assert_width("*\u{FE0F}\u{FE0F}\u{20E3}\u{200D}👪", 4, 4);

    assert_width("🇦👪\u{200D}🏿\u{200D}👪🏻\u{200D}Ⓜ️\u{200D}*\u{FE0F}\u{200D}🇦🇦\u{200D}🏴󠁧󠁢󠁷󠁬󠁳󠁿\u{200D}👪", 3, 3);
});

const CRATE = "unicode-width-0.2.2";
/** `File::open("tests/emoji-test.txt")` (cwd = the crate root under `cargo test`). */
const EMOJI_TEST = ((): string | undefined => {
  const src = join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "registry", "src");
  if (!existsSync(src)) return undefined;
  for (const idx of readdirSync(src)) {
    const p = join(src, idx, CRATE, "tests", "emoji-test.txt");
    if (existsSync(p)) return p;
  }
  return undefined;
})();
const EMOJI_TEST_SKIP = EMOJI_TEST === undefined && process.env.RUST_TS_REQUIRE_PROBES !== "1";
if (EMOJI_TEST_SKIP) {
  console.log(`SKIP: emoji_test_file: ${CRATE} source not in the cargo registry (bun scripts/crate-src.ts unicode-width --version 0.2.2); RUST_TS_REQUIRE_PROBES=1 makes this a failure`);
}

// crate: unicode-width-0.2.2/tests/tests.rs:568 emoji_test_file
test.skipIf(EMOJI_TEST_SKIP)("emoji_test_file", () => {
    if (EMOJI_TEST === undefined) throw new Error(`ERROR: ${CRATE} source not in the cargo registry and RUST_TS_REQUIRE_PROBES=1`);
    const norm_file = readFileSync(EMOJI_TEST, "utf8");
    for (const line of norm_file.split("\n").slice(0, -1)) {
        if (line === "" || line.startsWith("#")) {
            continue;
        }

        const i = line.indexOf(";");
        const cps = line.slice(0, i);
        const status = line.slice(i + 1).trim();
        if (status.startsWith("fully-qualified") || status.startsWith("component")) {
            const emoji: string = cps
                .trim()
                .split(" ")
                .map((s) => String.fromCodePoint(parseInt(s, 16)))
                .join("");
            // dbg!(&emoji);
            assert_width(emoji, 2, 2);
        }
    }
});

// crate: unicode-width-0.2.2/tests/tests.rs:594 ambiguous_line_break
test("ambiguous_line_break", () => {
    assert_width("\u{24EA}", 1, 2);
    assert_width("\u{2616}", 1, 2);
    assert_width("\u{2780}", 1, 2);
});

// crate: unicode-width-0.2.2/tests/tests.rs:601 test_vs1_vs2_vs3
test("test_vs1_vs2_vs3", () => {
    assert_width(0xfe00, 0, 0);
    assert_width(0xfe01, 0, 0);
    assert_width(0xfe02, 0, 0);
    for (const c of all_chars()) {
        if (c === 0x2018 || c === 0x2019 || c === 0x201c || c === 0x201d) {
            assert_width(c, 1, 2);
            assert_width(`${S(c)}\u{FE00}`, 1, 1);
            assert_width(`${S(c)}\u{FE00}\u{FE01}`, 1, 1);
            assert_width(`${S(c)}\u{FE01}`, 2, 2);
            assert_width(`${S(c)}\u{FE01}\u{FE00}`, 2, 2);
            assert_width(`${S(c)}\u{FE02}`, 1, 1);
            assert_width(`${S(c)}\u{FE02}\u{FE01}`, 1, 1);
        } else {
            const msg = JSON.stringify(S(c));
            expect(UnicodeWidthStr.width(`${S(c)}\u{FE00}`), msg).toBe(unwrap_or(UnicodeWidthChar.width(c), 1));
            expect(UnicodeWidthStr.width_cjk(`${S(c)}\u{FE00}`), msg).toBe(unwrap_or(UnicodeWidthChar.width_cjk(c), 1));
            expect(UnicodeWidthStr.width(`${S(c)}\u{FE01}`), msg).toBe(unwrap_or(UnicodeWidthChar.width(c), 1));
            expect(UnicodeWidthStr.width_cjk(`${S(c)}\u{FE01}`), msg).toBe(unwrap_or(UnicodeWidthChar.width_cjk(c), 1));
            expect(UnicodeWidthStr.width(`${S(c)}\u{FE02}`), msg).toBe(unwrap_or(UnicodeWidthChar.width(c), 1));
            expect(UnicodeWidthStr.width_cjk(`${S(c)}\u{FE02}`), msg).toBe(unwrap_or(UnicodeWidthChar.width_cjk(c), 1));
        }
    }
}, ALL_CHARS_TIMEOUT_MS);

// Test traits are unsealed

// PORT: `struct Foo;` (a unit struct) -> a unique symbol type; the impls -> objects typed by the trait interfaces.
const Foo: unique symbol = Symbol("Foo");
type Foo = typeof Foo;

// impl UnicodeWidthChar for Foo
export const Foo_UnicodeWidthChar: UnicodeWidthChar<Foo> = {
    // crate: unicode-width-0.2.2/tests/tests.rs:660 width
    width(_self: Foo): number | undefined {
        return 0;
    },

    // crate: unicode-width-0.2.2/tests/tests.rs:664 width_cjk
    width_cjk(_self: Foo): number | undefined {
        return 0;
    },
};

// impl UnicodeWidthStr for Foo
export const Foo_UnicodeWidthStr: UnicodeWidthStr<Foo> = {
    // crate: unicode-width-0.2.2/tests/tests.rs:671 width
    width(_self: Foo): number {
        return 0;
    },

    // crate: unicode-width-0.2.2/tests/tests.rs:675 width_cjk
    width_cjk(_self: Foo): number {
        return 0;
    },
};
