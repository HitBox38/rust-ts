// Port of unicode-width =0.2.2 `src/tables.rs` `#[cfg(test)] mod tests`.
// PORT: `NORMALIZATION_TEST` (20,034 generated `(orig, nfc, nfd, nfkc, nfkd)` tuples, ~1.4 MB) is not
// copied into the repo: the test reads it from the crate's own `src/tables.rs` in the cargo registry
// (where the `uwidth` probe build puts the crate), parsing its fixed `(r#".."#, ×5),` lines strictly.
// It skips visibly if the crate source is not there, and fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { width_in_str, width_in_str_cjk, WidthInfo } from "./tables.ts";

// crate: unicode-width-0.2.2/src/tables.rs:2681 str_width_test
function str_width_test(s: string, init: WidthInfo): number {
  // PORT: `s.chars().rfold((0, init), ..)`; `checked_add(..).unwrap()` on isize cannot overflow here.
  const chars = Array.from(s, (ch) => ch.codePointAt(0)!);
  let sum = 0;
  let next_info = init;
  for (let i = chars.length - 1; i >= 0; i--) {
    const [add, info] = width_in_str(chars[i]!, next_info);
    sum = sum + add;
    next_info = info;
  }
  return sum;
}

// crate: unicode-width-0.2.2/src/tables.rs:2691 str_width_test_cjk
function str_width_test_cjk(s: string, init: WidthInfo): number {
  const chars = Array.from(s, (ch) => ch.codePointAt(0)!);
  let sum = 0;
  let next_info = init;
  for (let i = chars.length - 1; i >= 0; i--) {
    const [add, info] = width_in_str_cjk(chars[i]!, next_info);
    sum = sum + add;
    next_info = info;
  }
  return sum;
}

/** `{init:X?}` of `WidthInfo(u16)` (derived Debug): `WidthInfo(1F)`. */
const hexDebug = (w: WidthInfo): string => `WidthInfo(${w.toString(16).toUpperCase()})`;

const CRATE = "unicode-width-0.2.2";
const TABLES_RS = ((): string | undefined => {
  const src = join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "registry", "src");
  if (!existsSync(src)) return undefined;
  for (const idx of readdirSync(src)) {
    const p = join(src, idx, CRATE, "src", "tables.rs");
    if (existsSync(p)) return p;
  }
  return undefined;
})();
const SKIP = TABLES_RS === undefined && process.env.RUST_TS_REQUIRE_PROBES !== "1";
if (SKIP) {
  console.log(`SKIP: test_normalization: ${CRATE} source not in the cargo registry (bun scripts/crate-src.ts unicode-width --version 0.2.2); RUST_TS_REQUIRE_PROBES=1 makes this a failure`);
}

/** `static NORMALIZATION_TEST: [(&str, &str, &str, &str, &str); N]`, read from the crate's tables.rs. */
function normalization_test(): [string, string, string, string, string][] {
  if (TABLES_RS === undefined) throw new Error(`ERROR: ${CRATE} source not in the cargo registry and RUST_TS_REQUIRE_PROBES=1`);
  const lines = readFileSync(TABLES_RS, "utf8").split("\n");
  const head = lines.findIndex((l) => /^ {4}static NORMALIZATION_TEST: \[\(&str, &str, &str, &str, &str\); \d+\] = \[$/.test(l));
  if (head < 0) throw new Error("ERROR: NORMALIZATION_TEST not found in tables.rs");
  const n = Number(/; (\d+)\] = \[$/.exec(lines[head]!)![1]);
  const out: [string, string, string, string, string][] = [];
  const re = /^ {8}\(r#"(.*?)"#, r#"(.*?)"#, r#"(.*?)"#, r#"(.*?)"#, r#"(.*?)"#\),$/;
  for (let i = head + 1; lines[i] !== "    ];"; i++) {
    const m = re.exec(lines[i]!);
    if (!m) throw new Error(`ERROR: tables.rs:${i + 1}: unexpected NORMALIZATION_TEST line`);
    out.push([m[1]!, m[2]!, m[3]!, m[4]!, m[5]!]);
  }
  expect(out.length).toBe(n);
  return out;
}

// crate: unicode-width-0.2.2/src/tables.rs:2701 test_normalization
test.skipIf(SKIP)(
  "test_normalization",
  () => {
    for (const [orig, nfc, nfd, nfkc, nfkd] of normalization_test()) {
      for (const init of NORMALIZATION_TEST_WIDTHS) {
        expect(str_width_test(orig, init), `width of X = ${JSON.stringify(orig)} differs from toNFC(X) = ${JSON.stringify(nfc)} with mode ${hexDebug(init)}`).toBe(str_width_test(nfc, init));
        expect(str_width_test(orig, init), `width of X = ${JSON.stringify(orig)} differs from toNFD(X) = ${JSON.stringify(nfd)} with mode ${hexDebug(init)}`).toBe(str_width_test(nfd, init));
        expect(str_width_test(nfkc, init), `width of toNFKC(X) = ${JSON.stringify(nfkc)} differs from toNFKD(X) = ${JSON.stringify(nfkd)} with mode ${hexDebug(init)}`).toBe(str_width_test(nfkd, init));
      }

      for (const init of NORMALIZATION_TEST_WIDTHS_CJK) {
        expect(str_width_test_cjk(orig, init), `CJK width of X = ${JSON.stringify(orig)} differs from toNFC(X) = ${JSON.stringify(nfc)} with mode ${hexDebug(init)}`).toBe(str_width_test_cjk(nfc, init));
        expect(str_width_test_cjk(orig, init), `CJK width of X = ${JSON.stringify(orig)} differs from toNFD(X) = ${JSON.stringify(nfd)} with mode ${hexDebug(init)}`).toBe(str_width_test_cjk(nfd, init));
        // PORT: upstream formats this mode with `{init:?}` (decimal), the others with `{init:X?}`.
        expect(str_width_test_cjk(nfkc, init), `CJK width of toNFKC(X) = ${JSON.stringify(nfkc)} differs from toNFKD(X) = ${JSON.stringify(nfkd)} with mode WidthInfo(${init})`).toBe(str_width_test_cjk(nfkd, init));
      }
    }
  },
  120_000,
);

const NORMALIZATION_TEST_WIDTHS: readonly WidthInfo[] = [
  WidthInfo.DEFAULT,
  WidthInfo.LINE_FEED,
  WidthInfo.EMOJI_MODIFIER,
  WidthInfo.REGIONAL_INDICATOR,
  WidthInfo.SEVERAL_REGIONAL_INDICATOR,
  WidthInfo.EMOJI_PRESENTATION,
  WidthInfo.ZWJ_EMOJI_PRESENTATION,
  WidthInfo.VS16_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.KEYCAP_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.VS16_KEYCAP_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.REGIONAL_INDICATOR_ZWJ_PRESENTATION,
  WidthInfo.EVEN_REGIONAL_INDICATOR_ZWJ_PRESENTATION,
  WidthInfo.ODD_REGIONAL_INDICATOR_ZWJ_PRESENTATION,
  WidthInfo.TAG_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_D1_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_D2_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_D3_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_A1_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_A2_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_A3_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_A4_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_A5_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_A6_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.KIRAT_RAI_VOWEL_SIGN_E,
  WidthInfo.KIRAT_RAI_VOWEL_SIGN_AI,
  WidthInfo.VARIATION_SELECTOR_1_2_OR_3,
  WidthInfo.VARIATION_SELECTOR_15,
  WidthInfo.VARIATION_SELECTOR_16,
  WidthInfo.JOINING_GROUP_ALEF,
  WidthInfo.HEBREW_LETTER_LAMED,
  WidthInfo.ZWJ_HEBREW_LETTER_LAMED,
  WidthInfo.BUGINESE_LETTER_YA,
  WidthInfo.ZWJ_BUGINESE_LETTER_YA,
  WidthInfo.BUGINESE_VOWEL_SIGN_I_ZWJ_LETTER_YA,
  WidthInfo.TIFINAGH_CONSONANT,
  WidthInfo.ZWJ_TIFINAGH_CONSONANT,
  WidthInfo.TIFINAGH_JOINER_CONSONANT,
  WidthInfo.LISU_TONE_LETTER_MYA_NA_JEU,
  WidthInfo.OLD_TURKIC_LETTER_ORKHON_I,
  WidthInfo.ZWJ_OLD_TURKIC_LETTER_ORKHON_I,
  WidthInfo.KHMER_COENG_ELIGIBLE_LETTER,
];

const NORMALIZATION_TEST_WIDTHS_CJK: readonly WidthInfo[] = [
  WidthInfo.DEFAULT,
  WidthInfo.LINE_FEED,
  WidthInfo.EMOJI_MODIFIER,
  WidthInfo.REGIONAL_INDICATOR,
  WidthInfo.SEVERAL_REGIONAL_INDICATOR,
  WidthInfo.EMOJI_PRESENTATION,
  WidthInfo.ZWJ_EMOJI_PRESENTATION,
  WidthInfo.VS16_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.KEYCAP_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.VS16_KEYCAP_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.REGIONAL_INDICATOR_ZWJ_PRESENTATION,
  WidthInfo.EVEN_REGIONAL_INDICATOR_ZWJ_PRESENTATION,
  WidthInfo.ODD_REGIONAL_INDICATOR_ZWJ_PRESENTATION,
  WidthInfo.TAG_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_D1_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_D2_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_D3_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_A1_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_A2_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_A3_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_A4_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_A5_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.TAG_A6_END_ZWJ_EMOJI_PRESENTATION,
  WidthInfo.KIRAT_RAI_VOWEL_SIGN_E,
  WidthInfo.KIRAT_RAI_VOWEL_SIGN_AI,
  WidthInfo.VARIATION_SELECTOR_1_2_OR_3,
  WidthInfo.VARIATION_SELECTOR_16,
  WidthInfo.JOINING_GROUP_ALEF,
  WidthInfo.COMBINING_LONG_SOLIDUS_OVERLAY,
  WidthInfo.SOLIDUS_OVERLAY_ALEF,
  WidthInfo.HEBREW_LETTER_LAMED,
  WidthInfo.ZWJ_HEBREW_LETTER_LAMED,
  WidthInfo.BUGINESE_LETTER_YA,
  WidthInfo.ZWJ_BUGINESE_LETTER_YA,
  WidthInfo.BUGINESE_VOWEL_SIGN_I_ZWJ_LETTER_YA,
  WidthInfo.TIFINAGH_CONSONANT,
  WidthInfo.ZWJ_TIFINAGH_CONSONANT,
  WidthInfo.TIFINAGH_JOINER_CONSONANT,
  WidthInfo.LISU_TONE_LETTER_MYA_NA_JEU,
  WidthInfo.OLD_TURKIC_LETTER_ORKHON_I,
  WidthInfo.ZWJ_OLD_TURKIC_LETTER_ORKHON_I,
  WidthInfo.KHMER_COENG_ELIGIBLE_LETTER,
];
