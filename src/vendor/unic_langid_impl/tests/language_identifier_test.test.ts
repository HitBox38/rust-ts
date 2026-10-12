// Port of unic-langid-impl 0.9.6 `tests/language_identifier_test.rs`.
import { expect, test } from "bun:test";
import { unwrap_result } from "../../../std/result.ts";
import { utf8 } from "../../../std/str.ts";
import { CharacterDirection, display_LanguageIdentifier, FEATURES, LanguageIdentifier } from "../lib.ts";
import { parse_language_identifier } from "../parser/mod.ts";
import { Language } from "../subtags/language.ts";
import { Region } from "../subtags/region.ts";
import { Script } from "../subtags/script.ts";
import { Variant } from "../subtags/variant.ts";

const parse = (s: string) => unwrap_result(LanguageIdentifier.from_str(s));
const to_string = display_LanguageIdentifier;

// crate: unic-langid-impl-0.9.6/tests/language_identifier_test.rs:6 assert_language_identifier
function assert_language_identifier(
  loc: LanguageIdentifier,
  language: string | undefined,
  script: string | undefined,
  region: string | undefined,
  variants: string[] | undefined,
): void {
  expect(loc.language.eq(language === undefined ? Language.default() : unwrap_result(Language.from_bytes(utf8(language))))).toBe(true);
  const s = script === undefined ? undefined : unwrap_result(Script.from_str(script));
  expect(loc.script === undefined || s === undefined ? loc.script === s : loc.script.eq(s)).toBe(true);
  const r = region === undefined ? undefined : unwrap_result(Region.from_str(region));
  expect(loc.region === undefined || r === undefined ? loc.region === r : loc.region.eq(r)).toBe(true);
  const v = (variants ?? []).map((v) => unwrap_result(Variant.from_str(v)));
  const lv = loc.variants();
  expect(lv.length).toBe(v.length);
  lv.forEach((x, i) => expect(x.eq(v[i]!)).toBe(true));
}

// crate: unic-langid-impl-0.9.6/tests/language_identifier_test.rs:32 assert_parsed_language_identifier
function assert_parsed_language_identifier(
  input: string,
  language: string | undefined,
  script: string | undefined,
  region: string | undefined,
  variants: string[] | undefined,
): void {
  const langid = unwrap_result(parse_language_identifier(utf8(input)));
  assert_language_identifier(langid, language, script, region, variants);
}

// crate: unic-langid-impl-0.9.6/tests/language_identifier_test.rs:44 test_language_identifier_parser
test("test_language_identifier_parser", () => {
  assert_parsed_language_identifier("pl", "pl", undefined, undefined, undefined);
  assert_parsed_language_identifier("und", undefined, undefined, undefined, undefined);
  assert_parsed_language_identifier("en-US", "en", undefined, "US", undefined);
  assert_parsed_language_identifier("en-Latn-US", "en", "Latn", "US", undefined);
  assert_parsed_language_identifier("sl-nedis", "sl", undefined, undefined, ["nedis"]);
});

// crate: unic-langid-impl-0.9.6/tests/language_identifier_test.rs:53 test_language_casing
test("test_language_casing", () => {
  assert_parsed_language_identifier("Pl", "pl", undefined, undefined, undefined);
  assert_parsed_language_identifier("En-uS", "en", undefined, "US", undefined);
  assert_parsed_language_identifier("eN-lAtN-uS", "en", "Latn", "US", undefined);
  assert_parsed_language_identifier("ZH_cyrl_hN", "zh", "Cyrl", "HN", undefined);
});

// crate: unic-langid-impl-0.9.6/tests/language_identifier_test.rs:61 test_serialize_langid
test("test_serialize_langid", () => {
  const langid = parse("en-Latn-US");
  expect(to_string(langid)).toBe("en-Latn-US");
});

// crate: unic-langid-impl-0.9.6/tests/language_identifier_test.rs:67 test_sorted_variants
test("test_sorted_variants", () => {
  let langid = parse("en-nedis-macos");
  expect(to_string(langid)).toBe("en-macos-nedis");

  langid = LanguageIdentifier.from_parts(unwrap_result(Language.from_str("en")), undefined, undefined, [
    unwrap_result(Variant.from_str("nedis")),
    unwrap_result(Variant.from_str("macos")),
  ]);
  expect(to_string(langid)).toBe("en-macos-nedis");
});

// crate: unic-langid-impl-0.9.6/tests/language_identifier_test.rs:81 test_from_parts_unchecked
test("test_from_parts_unchecked", () => {
  let langid = parse("en-nedis-macos");
  const [lang, script, region, variants] = langid.into_parts();
  langid = LanguageIdentifier.from_raw_parts_unchecked(lang, script, region, variants);
  expect(to_string(langid)).toBe("en-macos-nedis");
});

// crate: unic-langid-impl-0.9.6/tests/language_identifier_test.rs:94 test_matches
test("test_matches", () => {
  const langid_en = parse("en");
  const langid_en_us = parse("en-US");
  const langid_en_us2 = parse("en-US");
  const langid_pl = parse("pl");
  expect(langid_en.matches(langid_en_us, false, false)).toBe(false);
  expect(langid_en_us.matches(langid_en_us2, false, false)).toBe(true);
  expect(langid_en.matches(langid_pl, false, false)).toBe(false);
  expect(langid_en.matches(langid_en_us, true, false)).toBe(true);
});

// crate: unic-langid-impl-0.9.6/tests/language_identifier_test.rs:106 test_set_fields
test("test_set_fields", () => {
  const langid = LanguageIdentifier.default();
  expect(to_string(langid)).toBe("und");

  langid.language = unwrap_result(Language.from_str("pl"));
  expect(to_string(langid)).toBe("pl");

  langid.language = unwrap_result(Language.from_str("de"));
  expect(to_string(langid)).toBe("de");
  langid.region = unwrap_result(Region.from_str("AT"));
  expect(to_string(langid)).toBe("de-AT");
  langid.script = unwrap_result(Script.from_str("Latn"));
  expect(to_string(langid)).toBe("de-Latn-AT");
  langid.set_variants([unwrap_result(Variant.from_str("macos"))]);
  expect(to_string(langid)).toBe("de-Latn-AT-macos");

  expect(langid.has_variant(unwrap_result(Variant.from_str("macos")))).toBe(true);
  expect(langid.has_variant(unwrap_result(Variant.from_str("windows")))).toBe(false);

  langid.language.clear();
  expect(to_string(langid)).toBe("und-Latn-AT-macos");
  langid.region = undefined;
  expect(to_string(langid)).toBe("und-Latn-macos");
  langid.script = undefined;
  expect(to_string(langid)).toBe("und-macos");
  langid.clear_variants();
  expect(to_string(langid)).toBe("und");

  expect(langid.has_variant(unwrap_result(Variant.from_str("macos")))).toBe(false);
});

// crate: unic-langid-impl-0.9.6/tests/language_identifier_test.rs:138 test_matches_as_range
test("test_matches_as_range", () => {
  const langid = parse("en-US");
  const langid2 = parse("en-US-windows");
  expect(langid.matches(langid2, false, false)).toBe(false);
  expect(langid.matches(langid2, true, false)).toBe(true);
  expect(langid.matches(langid2, false, true)).toBe(false);
  expect(langid.matches(langid2, true, true)).toBe(true);
});

/** Runs `f` with the `likelysubtags` cargo feature set to `on`. */
function with_likelysubtags(on: boolean, f: () => void): void {
  const saved = FEATURES.likelysubtags;
  FEATURES.likelysubtags = on;
  try {
    f();
  } finally {
    FEATURES.likelysubtags = saved;
  }
}

// crate: unic-langid-impl-0.9.6/tests/language_identifier_test.rs:148 test_character_direction
test("test_character_direction", () => {
  for (const on of [false, true]) {
    with_likelysubtags(on, () => {
      const en_us = parse("en-US");
      expect(en_us.character_direction()).toBe(CharacterDirection.LTR);

      const ar_af = parse("ar-AF");
      expect(ar_af.character_direction()).toBe(CharacterDirection.RTL);

      const ks = parse("ks");
      expect(ks.character_direction()).toBe(CharacterDirection.RTL);

      const ks_deva = parse("ks-Deva");
      expect(ks_deva.character_direction()).toBe(CharacterDirection.LTR);

      const mn_mong = parse("mn-Mong");
      expect(mn_mong.character_direction()).toBe(CharacterDirection.TTB);

      const lid = parse("pa-Guru");
      expect(lid.character_direction()).toBe(CharacterDirection.LTR);

      const lid_pa_pk = parse("pa-PK");
      expect(lid_pa_pk.character_direction()).toBe(CharacterDirection.RTL);

      const lid_ar_us = parse("ar-US");
      expect(lid_ar_us.character_direction()).toBe(CharacterDirection.RTL);
    });
  }
});

// #[cfg(not(feature = "likelysubtags"))]
// crate: unic-langid-impl-0.9.6/tests/language_identifier_test.rs:176 test_character_direction_without_likelysubtags
test("test_character_direction_without_likelysubtags", () => {
  with_likelysubtags(false, () => {
    const lid = parse("pa");
    expect(lid.character_direction()).toBe(CharacterDirection.RTL);
  });
});

// #[cfg(feature = "likelysubtags")]
// crate: unic-langid-impl-0.9.6/tests/language_identifier_test.rs:183 test_character_direction_with_likelysubtags
test("test_character_direction_with_likelysubtags", () => {
  with_likelysubtags(true, () => {
    const lid_pa = parse("pa");
    expect(lid_pa.character_direction()).toBe(CharacterDirection.LTR);
  });
});

// crate: unic-langid-impl-0.9.6/tests/language_identifier_test.rs:189 test_langid_ord
test("test_langid_ord", () => {
  const input = ["en-US-macos-zarab", "en-US-macos-nedis", "en-US-macos", "en-GB", "en", "en-US", "ar", "fr", "de"];

  const langids = input.map((l) => parse(l));

  langids.sort((a, b) => a.cmp(b));

  const result = langids.map((l) => to_string(l));

  expect(result).toEqual(["ar", "de", "en", "en-GB", "en-US", "en-US-macos", "en-US-macos-nedis", "en-US-macos-zarab", "fr"]);
});

// tests/fixtures.rs reads tests/fixtures/parsing.json, which the published crate does not ship:
// crate-skip: unic-langid-impl-0.9.6/tests/fixtures.rs:37 read_langid_testsets fixture file not in the crate
// crate-skip: unic-langid-impl-0.9.6/tests/fixtures.rs:43 test_langid_fixtures fixture file not in the crate
// crate-skip: unic-langid-impl-0.9.6/tests/fixtures.rs:73 parse fixture file not in the crate
