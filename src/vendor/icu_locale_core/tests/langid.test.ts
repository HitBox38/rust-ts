// Port of icu_locale_core 2.3.0 `tests/langid.rs`.
import { expect, test } from "bun:test";
import { panic } from "../../../std/panic.ts";
import { unwrap_result } from "../../../std/result.ts";
import { utf8 } from "../../../std/str.ts";
import { LanguageIdentifier } from "../langid.ts";
import { Language } from "../subtags/language.ts";
import { Region } from "../subtags/region.ts";
import { Script } from "../subtags/script.ts";
import { Variant } from "../subtags/variant.ts";
import { Variants } from "../subtags/variants.ts";
import { assert_writeable_eq, cmp_bytes, fixture } from "./common.ts";
import { langid_try_from_identifier, langid_try_from_info, langid_try_from_subtags, type LocaleTest, parse_error_from, parse_fixtures } from "./fixtures/mod.ts";

// crate: icu_locale_core-2.3.0/tests/langid.rs:14 test_langid_fixtures
function test_langid_fixtures(tests: LocaleTest[]): void {
  for (const t of tests) {
    const msg = JSON.stringify(t.input);
    switch (t.output.$) {
      case "String": {
        if (t.input.$ === "Object" && t.input._0.type === "Locale") {
          continue;
        }
        const input = unwrap_result(langid_try_from_info(t.input));
        assert_writeable_eq(input, t.output._0, msg);
        break;
      }
      case "Error": {
        const err = parse_error_from(t.output._0);
        const input = langid_try_from_info(t.input);
        expect(input, msg).toEqual({ $: "Err", _0: err });
        break;
      }
      case "Identifier": {
        const input = unwrap_result(langid_try_from_info(t.input));
        const output = unwrap_result(langid_try_from_identifier(t.output._0));
        expect(input.eq(output), msg).toBe(true);
        break;
      }
      case "Object": {
        const input = unwrap_result(langid_try_from_info(t.input));
        const output = unwrap_result(langid_try_from_subtags(t.output._0));
        expect(input.eq(output), msg).toBe(true);
        break;
      }
    }
  }
}

// crate: icu_locale_core-2.3.0/tests/langid.rs:46 test_langid_parsing
test("test_langid_parsing", () => test_langid_fixtures(parse_fixtures(fixture("langid.json"))));

// crate: icu_locale_core-2.3.0/tests/langid.rs:54 test_langid_invalid
test("test_langid_invalid", () => test_langid_fixtures(parse_fixtures(fixture("invalid.json"))));

// crate: icu_locale_core-2.3.0/tests/langid.rs:62 test_langid_canonicalize
test("test_langid_canonicalize", () => test_langid_fixtures(parse_fixtures(fixture("canonicalize.json"))));

// crate: icu_locale_core-2.3.0/tests/langid.rs:70 test_langid_from_locale
test("test_langid_from_locale", () => test_langid_fixtures(parse_fixtures(fixture("locale.json"))));

// crate: icu_locale_core-2.3.0/tests/langid.rs:78 test_langid_subtag_language
test("test_langid_subtag_language", () => {
  let lang = unwrap_result(Language.try_from_str("en"));
  expect(lang.as_str()).toBe("en");
  lang = Language.UNKNOWN;
  expect(lang.is_unknown()).toBe(true);
  assert_writeable_eq(lang, "und");
});

// crate: icu_locale_core-2.3.0/tests/langid.rs:89 test_langid_subtag_region
test("test_langid_subtag_region", () => {
  const region = unwrap_result(Region.try_from_str("en"));
  expect(region.as_str()).toBe("EN");
  assert_writeable_eq(region, "EN");
});

// crate: icu_locale_core-2.3.0/tests/langid.rs:96 test_langid_subtag_script
test("test_langid_subtag_script", () => {
  const script = unwrap_result(Script.try_from_str("Latn"));
  expect(script.as_str()).toBe("Latn");
  assert_writeable_eq(script, "Latn");
});

// crate: icu_locale_core-2.3.0/tests/langid.rs:103 test_langid_subtag_variant
test("test_langid_subtag_variant", () => {
  const variant = unwrap_result(Variant.try_from_str("macos"));
  expect(variant.as_str()).toBe("macos");
  assert_writeable_eq(variant, "macos");
});

// crate: icu_locale_core-2.3.0/tests/langid.rs:110 test_langid_subtag_variants
test("test_langid_subtag_variants", () => {
  const variant = unwrap_result(Variant.try_from_str("macos"));
  const variants = Variants.from_vec_unchecked([variant]);
  expect(variants.deref()[0]!.eq(variant)).toBe(true);
  variants.clear();
  expect(variants.deref().length).toBe(0);
});

// crate: icu_locale_core-2.3.0/tests/langid.rs:119 test_langid_normalizing_eq_str
test("test_langid_normalizing_eq_str", () => {
  for (const t of parse_fixtures(fixture("langid.json"))) {
    const parsed = unwrap_result(langid_try_from_info(t.input));
    expect(parsed.normalizing_eq(parsed.write_to_string())).toBe(true);
  }
  // Check that trailing characters are not ignored
  const lang = unwrap_result(LanguageIdentifier.from_str("en"));
  expect(lang.normalizing_eq("en-US")).toBe(false);
});

// crate: icu_locale_core-2.3.0/tests/langid.rs:134 test_langid_strict_cmp
test("test_langid_strict_cmp", () => {
  const bcp47_strings = parse_fixtures(fixture("langid.json")).map((t) => (t.input.$ === "String" ? t.input._0 : panic("Invalid fixture")));
  for (const a of bcp47_strings) {
    for (const b of bcp47_strings) {
      const a_langid = unwrap_result(LanguageIdentifier.from_str(a));
      const a_normalized = a_langid.write_to_string();
      const string_cmp = cmp_bytes(utf8(a_normalized), utf8(b));
      const test_cmp = a_langid.strict_cmp(utf8(b));
      expect(test_cmp, `${a}/${b}`).toBe(string_cmp);
    }
  }
});
