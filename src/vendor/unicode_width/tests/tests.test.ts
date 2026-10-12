// Port of unicode-width =0.2.2 `tests/tests.rs`, char-width parts only.
// PORT: string widths (`UnicodeWidthStr`) are unported (see tables.ts), so the str-only tests
// (test_str, test_emoji, test_bad_devanagari, test_ambiguous, test_gcb_prepend,
// test_solidus_overlay, char_str_consistent and the later str/emoji tests) are not ported, and
// mixed tests keep only their `char` assertions.
import { expect, test } from "bun:test";
import { UnicodeWidthChar } from "../lib.ts";

// macro_rules! assert_width (char form)
function assert_width(c: number, nocjk: number | undefined, cjk: number | undefined): void {
  expect(UnicodeWidthChar.width(c)).toBe(nocjk);
  expect(UnicodeWidthChar.width_cjk(c)).toBe(cjk);
}
const ch = (s: string): number => s.codePointAt(0)!;

test("test_char", () => {
  assert_width(ch("ｈ"), 2, 2);
  assert_width(0x00, undefined, undefined);
  assert_width(0x01, undefined, undefined);
  assert_width(0x2081, 1, 2);
});

test("test_char2", () => {
  assert_width(0x0a, undefined, undefined);
  assert_width(ch("w"), 1, 1);
  assert_width(ch("ｈ"), 2, 2);
  assert_width(0xad, 0, 0);
  assert_width(0x1160, 0, 0);
  assert_width(0xa1, 1, 2);
  assert_width(0x300, 0, 0);
});

test("unicode_12", () => {
  assert_width(0x1f971, 2, 2);
});

test("test_default_ignorable", () => {
  assert_width(0x1160, 0, 0);
  assert_width(0x3164, 0, 0);
  assert_width(0xffa0, 0, 0);
  assert_width(0xe0000, 0, 0);
});

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

test("test_prepended_concatenation_marks", () => {
  for (const c of [0x0600, 0x0601, 0x0602, 0x0603, 0x0604, 0x06dd, 0x110bd, 0x110cd]) {
    assert_width(c, 1, 1);
  }

  for (const c of [0x0605, 0x070f, 0x0890, 0x0891, 0x08e2]) {
    assert_width(c, 0, 0);
  }
});

test("test_interlinear_annotation_chars", () => {
  assert_width(0xfff9, 1, 1);
  assert_width(0xfffa, 1, 1);
  assert_width(0xfffb, 1, 1);
});

test("test_hieroglyph_format_controls", () => {
  assert_width(0x13430, 1, 1);
  assert_width(0x13436, 1, 1);
  assert_width(0x1343c, 1, 1);
});

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

test("test_devanagari_caret", () => {
  assert_width(0xa8fa, 0, 0);
});

test("test_emoji_presentation (char part)", () => {
  assert_width(0x0023, 1, 1);
  assert_width(0xfe0f, 0, 0);
});

test("test_text_presentation (char part)", () => {
  assert_width(0xfe0e, 0, 0);
  assert_width(0x2648, 2, 2);
});

test("test_control_line_break (char part)", () => {
  assert_width(0x2028, 1, 1);
  assert_width(0x2029, 1, 1);
  assert_width(ch("\r"), undefined, undefined);
  assert_width(ch("\n"), undefined, undefined);
});
