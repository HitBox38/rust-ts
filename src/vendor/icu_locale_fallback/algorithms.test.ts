// Port of icu_locale_fallback 2.3.0 `src/algorithms.rs` `mod tests` (the test table is upstream's).
import { expect, test } from "bun:test";
import { unwrap_result } from "../../std/result.ts";
import { Locale } from "../icu_locale_core/locale.ts";
import { LocalePreferences } from "../icu_locale_core/preferences/locale.ts";
import { LocaleFallbackConfig, type LocaleFallbackPriority } from "../icu_provider/fallback.ts";
import { LocaleFallbacker } from "./lib.ts";

interface TestCase {
  input: string;
  requires_data: boolean;
  // Note: The first entry in the chain is the normalized locale
  expected_language_chain: string[];
  expected_script_chain: string[];
  expected_region_chain: string[];
}

// TODO: Consider loading these from a JSON file
const TEST_CASES: TestCase[] = [
        {
            input: "en-fonipa",
            requires_data: false,
            expected_language_chain: ["en-fonipa", "en"],
            expected_script_chain: ["en-fonipa", "en"],
            expected_region_chain: ["en-fonipa", "en"],
        },
        {
            input: "en-US-u-sd-usca",
            requires_data: false,
            expected_language_chain: ["en-US-u-sd-usca", "en-US", "en"],
            expected_script_chain: ["en-US-u-sd-usca", "en-US", "en"],
            expected_region_chain: ["en-US-u-sd-usca", "en-US", "und-US-u-sd-usca", "und-US"],
        },
        {
            input: "en-US-fonipa-u-sd-usca",
            requires_data: false,
            expected_language_chain: [
                "en-US-fonipa-u-sd-usca",
                "en-US-fonipa",
                "en-US",
                "en-fonipa",
                "en",
            ],
            expected_script_chain: [
                "en-US-fonipa-u-sd-usca",
                "en-US-fonipa",
                "en-US",
                "en-fonipa",
                "en",
            ],
            expected_region_chain: [
                "en-US-fonipa-u-sd-usca",
                "en-US-fonipa",
                "en-US",
                "und-US-fonipa-u-sd-usca",
                "und-US-fonipa",
                "und-US",
            ],
        },
        {
            input: "en-fonipa",
            requires_data: true,
            expected_language_chain: ["en-fonipa", "en"],
            expected_script_chain: ["en-fonipa", "en", "und-Latn-fonipa", "und-Latn"],
            expected_region_chain: ["en-US-fonipa", "en-US", "und-US-fonipa", "und-US"],
        },
        {
            input: "en-Latn-fonipa",
            requires_data: true,
            expected_language_chain: ["en-fonipa", "en"],
            expected_script_chain: ["en-fonipa", "en", "und-Latn-fonipa", "und-Latn"],
            expected_region_chain: ["en-US-fonipa", "en-US", "und-US-fonipa", "und-US"],
        },
        {
            input: "en-Latn-US-u-sd-usca",
            requires_data: true,
            expected_language_chain: ["en-US-u-sd-usca", "en-US", "en"],
            expected_script_chain: ["en-US-u-sd-usca", "en-US", "en", "und-Latn"],
            expected_region_chain: ["en-US-u-sd-usca", "en-US", "und-US-u-sd-usca", "und-US"],
        },
        {
            input: "sr-ME",
            requires_data: true,
            expected_language_chain: ["sr-ME", "sr-Latn"],
            expected_script_chain: ["sr-ME", "sr-Latn", "und-Latn"],
            expected_region_chain: ["sr-ME", "und-ME"],
        },
        {
            input: "sr-Latn-ME",
            requires_data: true,
            expected_language_chain: ["sr-ME", "sr-Latn"],
            expected_script_chain: ["sr-ME", "sr-Latn", "und-Latn"],
            expected_region_chain: ["sr-ME", "und-ME"],
        },
        {
            input: "sr-Cyrl-ME",
            requires_data: true,
            expected_language_chain: ["sr-Cyrl-ME", "sr"],
            expected_script_chain: ["sr-Cyrl-ME", "sr", "und-Cyrl"],
            expected_region_chain: ["sr-Cyrl-ME", "und-ME"],
        },
        {
            input: "sr-ME-fonipa",
            requires_data: true,
            expected_language_chain: ["sr-ME-fonipa", "sr-ME", "sr-Latn-fonipa", "sr-Latn"],
            expected_script_chain: [
                "sr-ME-fonipa",
                "sr-ME",
                "sr-Latn-fonipa",
                "sr-Latn",
                "und-Latn-fonipa",
                "und-Latn",
            ],
            expected_region_chain: ["sr-ME-fonipa", "sr-ME", "und-ME-fonipa", "und-ME"],
        },
        {
            input: "sr-RS",
            requires_data: true,
            expected_language_chain: ["sr-RS", "sr"],
            expected_script_chain: ["sr-RS", "sr", "und-Cyrl"],
            expected_region_chain: ["sr-RS", "und-RS"],
        },
        {
            input: "sr-Cyrl-RS",
            requires_data: true,
            expected_language_chain: ["sr-RS", "sr"],
            expected_script_chain: ["sr-RS", "sr", "und-Cyrl"],
            expected_region_chain: ["sr-RS", "und-RS"],
        },
        {
            input: "sr-Latn-RS",
            requires_data: true,
            expected_language_chain: ["sr-Latn-RS", "sr-Latn"],
            expected_script_chain: ["sr-Latn-RS", "sr-Latn", "und-Latn"],
            expected_region_chain: ["sr-Latn-RS", "und-RS"],
        },
        {
            input: "de-Latn-LI",
            requires_data: true,
            expected_language_chain: ["de-LI", "de"],
            expected_script_chain: ["de-LI", "de", "und-Latn"],
            expected_region_chain: ["de-LI", "und-LI"],
        },
        {
            input: "ca-ES-valencia",
            requires_data: true,
            expected_language_chain: ["ca-ES-valencia", "ca-ES", "ca-valencia", "ca"],
            expected_script_chain: [
                "ca-ES-valencia",
                "ca-ES",
                "ca-valencia",
                "ca",
                "und-Latn-valencia",
                "und-Latn",
            ],
            expected_region_chain: ["ca-ES-valencia", "ca-ES", "und-ES-valencia", "und-ES"],
        },
        {
            input: "es-AR",
            requires_data: true,
            expected_language_chain: ["es-AR", "es-419", "es"],
            expected_script_chain: ["es-AR", "es-419", "es", "und-Latn"],
            expected_region_chain: ["es-AR", "und-AR"],
        },
        {
            input: "hi-IN",
            requires_data: true,
            expected_language_chain: ["hi-IN", "hi"],
            expected_script_chain: ["hi-IN", "hi", "und-Deva"],
            expected_region_chain: ["hi-IN", "und-IN"],
        },
        {
            input: "hi-Latn-IN",
            requires_data: true,
            expected_language_chain: ["hi-Latn-IN", "hi-Latn", "en-IN", "en-001", "en"],
            expected_script_chain: ["hi-Latn-IN", "hi-Latn", "en-IN", "en-001", "en", "und-Latn"],
            expected_region_chain: ["hi-Latn-IN", "und-IN"],
        },
        {
            input: "zh-CN",
            requires_data: true,
            // Note: "zh-Hans" is not reachable because it is the default script for "zh".
            // The fallback algorithm does not visit the language-script bundle when the
            // script is the default for the language
            expected_language_chain: ["zh-CN", "zh"],
            expected_script_chain: ["zh-CN", "zh", "und-Hans", "und-Hani"],
            expected_region_chain: ["zh-CN", "und-CN"],
        },
        {
            input: "zh-Hant-CN",
            requires_data: true,
            expected_language_chain: ["zh-Hant-CN", "zh-Hant"],
            expected_script_chain: ["zh-Hant-CN", "zh-Hant", "und-Hant", "und-Hani"],
            expected_region_chain: ["zh-Hant-CN", "und-CN"],
        },
        {
            input: "zh-TW",
            requires_data: true,
            expected_language_chain: ["zh-TW", "zh-Hant"],
            expected_script_chain: ["zh-TW", "zh-Hant", "und-Hant", "und-Hani"],
            expected_region_chain: ["zh-TW", "und-TW"],
        },
        {
            input: "zh-Hans-TW",
            requires_data: true,
            expected_language_chain: ["zh-Hans-TW", "zh"],
            expected_script_chain: ["zh-Hans-TW", "zh", "und-Hans", "und-Hani"],
            expected_region_chain: ["zh-Hans-TW", "und-TW"],
        },
        {
            input: "yue-HK",
            requires_data: true,
            expected_language_chain: ["yue-HK", "yue"],
            expected_script_chain: ["yue-HK", "yue", "und-Hant", "und-Hani"],
            expected_region_chain: ["yue-HK", "und-HK"],
        },
        {
            input: "yue-HK",
            requires_data: true,
            expected_language_chain: ["yue-HK", "yue"],
            expected_script_chain: ["yue-HK", "yue", "und-Hant", "und-Hani"],
            expected_region_chain: ["yue-HK", "und-HK"],
        },
        {
            input: "yue-CN",
            requires_data: true,
            expected_language_chain: ["yue-CN", "yue-Hans"],
            expected_script_chain: ["yue-CN", "yue-Hans", "und-Hans", "und-Hani"],
            expected_region_chain: ["yue-CN", "und-CN"],
        },
        {
            input: "az-Arab-IR",
            requires_data: true,
            expected_language_chain: ["az-IR", "az-Arab"],
            expected_script_chain: ["az-IR", "az-Arab", "und-Arab"],
            expected_region_chain: ["az-IR", "und-IR"],
        },
        {
            input: "az-IR",
            requires_data: true,
            expected_language_chain: ["az-IR", "az-Arab"],
            expected_script_chain: ["az-IR", "az-Arab", "und-Arab"],
            expected_region_chain: ["az-IR", "und-IR"],
        },
        {
            input: "az-Arab",
            requires_data: true,
            expected_language_chain: ["az-Arab"],
            expected_script_chain: ["az-Arab", "und-Arab"],
            expected_region_chain: ["az-IR", "und-IR"],
        },
    ];

// crate: icu_locale_fallback-2.3.0/src/algorithms.rs:495 test_fallback
test("test_fallback", () => {
  const fallbacker_no_data = LocaleFallbacker.new_without_data().as_borrowed();
  const fallbacker_with_data = LocaleFallbacker.new();
  for (const cas of TEST_CASES) {
    const prefs = LocalePreferences.from_locale(unwrap_result(Locale.from_str(cas.input)));
    for (const [priority, data_locale, expected_chain] of [
      ["Language", prefs.to_data_locale_language_priority(), cas.expected_language_chain],
      ["Script", prefs.to_data_locale_language_priority(), cas.expected_script_chain],
      ["Region", prefs.to_data_locale_region_priority(), cas.expected_region_chain],
    ] as const) {
      const config = LocaleFallbackConfig.default();
      config.priority = priority as LocaleFallbackPriority;
      const fallbacker = cas.requires_data ? fallbacker_with_data : fallbacker_no_data;
      const it = fallbacker.for_config(config).fallback_for(data_locale);
      const actual_chain: string[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 19) {
          console.error("20 iterations reached!");
        }
        if (it.get().is_unknown()) {
          break;
        }
        actual_chain.push(it.get().write_to_string());
        it.step();
      }
      expect(actual_chain, `${cas.input} (${priority})`).toEqual(expected_chain);
    }
  }
});
