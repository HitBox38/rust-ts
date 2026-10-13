// Port of unicode-security =0.1.2 `src/tests.rs`.
import { expect, test } from "bun:test";
import { GeneralSecurityProfile_char, is_potential_mixed_script_confusable_char, MixedScript_str, skeleton } from "./lib.ts";
import { AugmentedScriptSet, debug_AugmentedScriptSet, display_AugmentedScriptSet } from "./mixed_script.ts";

const c = (s: string): number => s.codePointAt(0)!;
function collect(it: { next(): number | undefined }): string {
  let out = "";
  for (let ch = it.next(); ch !== undefined; ch = it.next()) out += String.fromCodePoint(ch);
  return out;
}

// crate: unicode-security-0.1.2/src/tests.rs:12 test_general_security_profile_identifier_allowed
test("test_general_security_profile_identifier_allowed", () => {
  const G = GeneralSecurityProfile_char;
  expect(G.identifier_allowed(c("A"))).toBe(true);
  expect(G.identifier_allowed(c("0"))).toBe(true);
  expect(G.identifier_allowed(c("_"))).toBe(true);
  expect(G.identifier_allowed(0)).toBe(false);
  // U+00B5 MICRO SIGN
  expect(G.identifier_allowed(c("µ"))).toBe(false);
  // U+2160 ROMAN NUMERAL ONE
  expect(G.identifier_allowed(c("Ⅰ"))).toBe(false);
});

// crate: unicode-security-0.1.2/src/tests.rs:31 test_mixed_script
test("test_mixed_script", () => {
  const M = MixedScript_str;
  const cases: [string, boolean, boolean, boolean][] = [
    ["", true, false, true],
    ["A", true, false, false],
    ["A0", true, false, false],
    ["0.", true, false, true],
    ["福", true, false, false],
    ["冬の雪", true, false, false],
    ["幻ㄒㄧㄤ", true, false, false],
    ["日出은", true, false, false],
    ["夏の幻ㄒㄧㄤ", false, true, false],
  ];
  for (const [s, single, empty, all] of cases) {
    expect(M.is_single_script(s)).toBe(single);
    expect(M.resolve_script_set(s).is_empty()).toBe(empty);
    expect(M.resolve_script_set(s).is_all()).toBe(all);
  }
});

// crate: unicode-security-0.1.2/src/tests.rs:63 test_confusable_detection
test("test_confusable_detection", () => {
  expect(collect(skeleton(""))).toBe("");
  expect(collect(skeleton("ｓ"))).toBe("s");
  expect(collect(skeleton("ｓｓｓ"))).toBe("sss");
  expect(collect(skeleton("ﶛ"))).toBe("نمى");
  expect(collect(skeleton("ﶛﶛ"))).toBe("نمىنمى");
});

// crate: unicode-security-0.1.2/src/tests.rs:74 test_potential_mixed_script_detection
test("test_potential_mixed_script_detection", () => {
  expect(is_potential_mixed_script_confusable_char(c("A"))).toBe(true);
  expect(is_potential_mixed_script_confusable_char(c("D"))).toBe(false);
});

const SETS = (): AugmentedScriptSet[] => [
  AugmentedScriptSet.default(),
  AugmentedScriptSet.from_char(c("0")),
  AugmentedScriptSet.from_char(c("a")),
  AugmentedScriptSet.from_char(c("μ")),
  AugmentedScriptSet.from_char(c("汉")),
  AugmentedScriptSet.from_char(c("ひ")),
  AugmentedScriptSet.from_char(c("カ")),
  AugmentedScriptSet.from_char(c("한")),
  AugmentedScriptSet.from_str("汉ひ"),
  AugmentedScriptSet.from_str("汉a"),
  AugmentedScriptSet.from_str("汉μ"),
  AugmentedScriptSet.from_str("〆切"),
];

// crate: unicode-security-0.1.2/src/tests.rs:82 test_augmented_script_set_fmt_debug
test("test_augmented_script_set_fmt_debug", () => {
  expect(SETS().map(debug_AugmentedScriptSet)).toEqual([
    "AugmentedScriptSet {ALL}",
    "AugmentedScriptSet {ALL}",
    "AugmentedScriptSet {Latn}",
    "AugmentedScriptSet {Grek}",
    "AugmentedScriptSet {Hanb, Jpan, Kore, Hani}",
    "AugmentedScriptSet {Jpan, Hira}",
    "AugmentedScriptSet {Jpan, Kana}",
    "AugmentedScriptSet {Kore, Hang}",
    "AugmentedScriptSet {Jpan}",
    "AugmentedScriptSet {∅}",
    "AugmentedScriptSet {∅}",
    "AugmentedScriptSet {Hanb, Jpan, Kore, Hani}",
  ]);
});

// crate: unicode-security-0.1.2/src/tests.rs:119 test_augmented_script_set_fmt_display
test("test_augmented_script_set_fmt_display", () => {
  expect(SETS().map(display_AugmentedScriptSet)).toEqual([
    "All",
    "All",
    "Latin",
    "Greek",
    "Han with Bopomofo, Japanese, Korean, Han",
    "Japanese, Hiragana",
    "Japanese, Katakana",
    "Korean, Hangul",
    "Japanese",
    "Empty",
    "Empty",
    "Han with Bopomofo, Japanese, Korean, Han",
  ]);
});
