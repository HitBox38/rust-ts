// Ports of icu_locale_core 2.3.0's inline `#[test]` fns (subtags, langid, locale, data,
// extensions, preferences). The macro-generated tests (helpers.rs `test_construction` /
// `test_writeable`) run once per `impl_tinystr_subtag!` / list / key-value invocation, with the
// examples of each invocation.
import { expect, test } from "bun:test";
import { type Result, unwrap_result } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import { tinystr } from "../tinystr/macros.ts";
import { StringSink, type Writeable } from "../writeable/lib.ts";
import { DataLocale } from "./data.ts";
import { Extensions } from "./extensions/mod.ts";
import { Other } from "./extensions/other/mod.ts";
import { Private, Subtag as PrivateSubtag } from "./extensions/private/mod.ts";
import { Fields } from "./extensions/transform/fields.ts";
import { Key as TKey } from "./extensions/transform/key.ts";
import { Transform } from "./extensions/transform/mod.ts";
import { Value as TValue } from "./extensions/transform/value.ts";
import { Attribute } from "./extensions/unicode/attribute.ts";
import { Attributes } from "./extensions/unicode/attributes.ts";
import { Key } from "./extensions/unicode/key.ts";
import { Keywords } from "./extensions/unicode/keywords.ts";
import { Unicode } from "./extensions/unicode/mod.ts";
import { SubdivisionId, SubdivisionSuffix, subdivision_suffix } from "./extensions/unicode/subdivision.ts";
import { Value, value } from "./extensions/unicode/value.ts";
import { type TinystrSubtag, type TinystrSubtagSpec, subtag_from_raw_unchecked, subtag_try_from_utf8 } from "./helpers.ts";
import { LanguageIdentifier } from "./langid.ts";
import { Locale } from "./locale.ts";
import { RegionOverride } from "./preferences/extensions/unicode/keywords/region_override.ts";
import { RegionalSubdivision } from "./preferences/extensions/unicode/keywords/regional_subdivision.ts";
import { LocalePreferences } from "./preferences/locale.ts";
import { Language } from "./subtags/language.ts";
import { Subtag, subtag } from "./subtags/mod.ts";
import { Region, region } from "./subtags/region.ts";
import { Script } from "./subtags/script.ts";
import { Variant } from "./subtags/variant.ts";
import { Variants } from "./subtags/variants.ts";

/** `assert_writeable_eq!` (string, write_to_string, Display; length-hint bounds). */
function assert_writeable_eq(w: Writeable, expected: string): void {
  const s = new StringSink();
  w.write_to(s);
  expect(s.s).toBe(expected);
  expect(w.write_to_string()).toBe(expected);
  const borrowed = w.writeable_borrow();
  if (borrowed !== undefined) expect(borrowed).toBe(expected);
  const hint = w.writeable_length_hint();
  const len = utf8(expected).length;
  expect(hint._0 <= len).toBe(true);
  if (hint._1 !== undefined) expect(len <= hint._1).toBe(true);
}

const SUBTAG_TYPES: [string, TinystrSubtagSpec<TinystrSubtag>, string[], string[]][] = [
  ["Language", Language.SPEC, ["en", "foo"], ["419", "german", "en1"]],
  ["Script", Script.SPEC, ["Latn"], ["Latin"]],
  ["Region", Region.SPEC, ["FR", "009"], ["12", "FRA", "b2"]],
  ["Variant", Variant.SPEC, ["posix", "1996"], ["yes"]],
  ["Subtag", Subtag.SPEC, ["foo12"], ["f", "toolooong"]],
  ["unicode::Key", Key.SPEC, ["ca", "8a"], ["a", "a8", "abc"]],
  ["unicode::Attribute", Attribute.SPEC, ["foo12"], ["no", "toolooong"]],
  ["unicode::SubdivisionSuffix", SubdivisionSuffix.SPEC, ["sct"], ["toolooong"]],
  ["transform::Key", TKey.SPEC, ["k0"], ["", "k", "0k", "k12"]],
  ["private::Subtag", PrivateSubtag.SPEC, ["foo12"], ["toolooong"]],
];

// impl_tinystr_subtag! tests, once per invocation.
// crate: icu_locale_core-2.3.0/src/helpers.rs:201 test_construction
test("test_construction", () => {
  for (const [name, spec, good, bad] of SUBTAG_TYPES) {
    for (const g of good) {
      const maybe = subtag_try_from_utf8(spec, utf8(g));
      expect(maybe.$, `${name} ${g}`).toBe("Ok");
      const v = unwrap_result(maybe);
      // PORT: `try_from_raw` is not ported (see helpers.ts); the raw round trip uses `from_raw_unchecked`.
      expect(subtag_from_raw_unchecked(spec, v.into_raw()).eq(v)).toBe(true);
      expect(v.as_str()).toBe(g);
    }
    for (const b of bad) {
      expect(subtag_try_from_utf8(spec, utf8(b)).$, `${name} ${b}`).toBe("Err");
    }
  }
});

// crate: icu_locale_core-2.3.0/src/helpers.rs:219 test_writeable
test("test_writeable (subtags)", () => {
  for (const [, spec, good] of SUBTAG_TYPES) {
    for (const g of good) assert_writeable_eq(unwrap_result(subtag_try_from_utf8(spec, utf8(g))), g);
  }
});

// impl_writeable_for_subtag_list! tests: Variants ("macos", "posix"), unicode Value ("islamic",
// "civil"), Attributes ("foobar", "testing").
// crate: icu_locale_core-2.3.0/src/helpers.rs:377 test_writeable
test("test_writeable (subtag lists)", () => {
  assert_writeable_eq(Variants.new(), "");
  assert_writeable_eq(Variants.from_vec_unchecked([unwrap_result(Variant.try_from_str("macos"))]), "macos");
  assert_writeable_eq(
    Variants.from_vec_unchecked([unwrap_result(Variant.try_from_str("macos")), unwrap_result(Variant.try_from_str("posix"))]),
    "macos-posix",
  );
  assert_writeable_eq(Value.new_empty(), "");
  assert_writeable_eq(Value.from_vec_unchecked([unwrap_result(Subtag.try_from_str("islamic"))]), "islamic");
  assert_writeable_eq(
    Value.from_vec_unchecked([unwrap_result(Subtag.try_from_str("islamic")), unwrap_result(Subtag.try_from_str("civil"))]),
    "islamic-civil",
  );
  assert_writeable_eq(Attributes.new(), "");
  assert_writeable_eq(Attributes.from_vec_unchecked([unwrap_result(Attribute.try_from_str("foobar"))]), "foobar");
  assert_writeable_eq(
    Attributes.from_vec_unchecked([unwrap_result(Attribute.try_from_str("foobar")), unwrap_result(Attribute.try_from_str("testing"))]),
    "foobar-testing",
  );
});

// impl_writeable_for_key_value! tests: Keywords ("ca", "islamic-civil", "mm", "mm") and transform
// Fields ("h0", "hybrid", "m0", "m0-true"). `from_tuple_vec` is built with `set` (FromIterator is
// not ported).
// crate: icu_locale_core-2.3.0/src/helpers.rs:399 test_writeable
test("test_writeable (key-value lists)", () => {
  assert_writeable_eq(Keywords.new(), "");
  const kw = Keywords.new();
  kw.set(unwrap_result(Key.try_from_str("ca")), unwrap_result(Value.try_from_str("islamic-civil")));
  assert_writeable_eq(kw, "ca-islamic-civil");
  kw.set(unwrap_result(Key.try_from_str("mm")), unwrap_result(Value.try_from_str("true")));
  assert_writeable_eq(kw, "ca-islamic-civil-mm");

  assert_writeable_eq(Fields.new(), "");
  const f = Fields.new();
  f.set(unwrap_result(TKey.try_from_str("h0")), unwrap_result(TValue.try_from_str("hybrid")));
  assert_writeable_eq(f, "h0-hybrid");
  f.set(unwrap_result(TKey.try_from_str("m0")), unwrap_result(TValue.try_from_str("true")));
  assert_writeable_eq(f, "h0-hybrid-m0-true");
});

// crate: icu_locale_core-2.3.0/src/subtags/mod.rs:150 test_subtag
test("test_subtag", () => {
  const s = subtag("foo");
  expect(s.as_str()).toBe("foo");
});

// crate: icu_locale_core-2.3.0/src/subtags/mod.rs:156 test_subtag_from_tinystr
test("test_subtag_from_tinystr", () => {
  expect(Subtag.try_from(tinystr(3, "foo")).$).toBe("Ok");
  expect(Subtag.try_from(tinystr(1, "f")).$).toBe("Err");
});

// crate: icu_locale_core-2.3.0/src/langid.rs:540 test_writeable
test("test_writeable (LanguageIdentifier)", () => {
  assert_writeable_eq(LanguageIdentifier.UNKNOWN, "und");
  for (const s of ["und-001", "und-Mymr", "my-Mymr-MM", "my-Mymr-MM-posix", "zh-macos-posix"]) {
    assert_writeable_eq(unwrap_result(LanguageIdentifier.from_str(s)), s);
  }
});

// crate-skip: icu_locale_core-2.3.0/src/locale.rs:112 test_sizes Rust memory layout (`size_of`)

// crate: icu_locale_core-2.3.0/src/locale.rs:519 test_writeable
test("test_writeable (Locale)", () => {
  assert_writeable_eq(Locale.UNKNOWN, "und");
  for (const s of [
    "und-001",
    "und-Mymr",
    "my-Mymr-MM",
    "my-Mymr-MM-posix",
    "zh-macos-posix",
    "my-t-my-d0-zawgyi",
    "ar-SA-u-ca-islamic-civil",
    "en-001-x-foo-bar",
    "und-t-m0-true",
  ]) {
    assert_writeable_eq(unwrap_result(Locale.from_str(s)), s);
  }
});

// crate: icu_locale_core-2.3.0/src/extensions/mod.rs:370 test_writeable
test("test_writeable (Extensions)", () => {
  assert_writeable_eq(Extensions.new(), "");
  const ext = (s: string) => unwrap_result(Locale.from_str(s)).extensions;
  assert_writeable_eq(ext("my-t-my-d0-zawgyi"), "t-my-d0-zawgyi");
  assert_writeable_eq(ext("ar-SA-u-ca-islamic-civil"), "u-ca-islamic-civil");
  assert_writeable_eq(ext("en-001-x-foo-bar"), "x-foo-bar");
  assert_writeable_eq(ext("und-t-m0-true"), "t-m0-true");
  assert_writeable_eq(ext("und-a-foo-t-foo-u-foo-w-foo-z-foo-x-foo"), "a-foo-t-foo-u-foo-w-foo-z-foo-x-foo");
  assert_writeable_eq(ext("en-1-ext-value"), "1-ext-value");
  assert_writeable_eq(ext("und-a-foo-1-bar"), "1-bar-a-foo");
});

const ok = <T, E>(r: Result<T, E>): T => unwrap_result(r);

// crate: icu_locale_core-2.3.0/src/extensions/other/mod.rs:253 test_other_extension_fromstr
test("test_other_extension_fromstr", () => {
  expect(ok(Other.from_str("o-foo-bar")).to_string()).toBe("o-foo-bar");
  expect(ok(Other.from_str("1-foo-bar")).to_string()).toBe("1-foo-bar");
  expect(Other.from_str("o").$).toBe("Err");
});

// crate: icu_locale_core-2.3.0/src/extensions/private/mod.rs:250 test_private_extension_fromstr
test("test_private_extension_fromstr", () => {
  expect(ok(Private.from_str("x-foo-bar-l-baz")).to_string()).toBe("x-foo-bar-l-baz");
  expect(Private.from_str("x").$).toBe("Err");
});

// crate: icu_locale_core-2.3.0/src/extensions/transform/mod.rs:325 test_transform_extension_fromstr
test("test_transform_extension_fromstr", () => {
  expect(ok(Transform.from_str("t-en-us-h0-hybrid")).to_string()).toBe("t-en-us-h0-hybrid");
  expect(Transform.from_str("t").$).toBe("Err");
});

// crate: icu_locale_core-2.3.0/src/extensions/transform/value.rs:136 test_writeable
test("test_writeable (transform Value)", () => {
  const hybrid = ok(Subtag.try_from_str("hybrid"));
  const foobar = ok(Subtag.try_from_str("foobar"));
  assert_writeable_eq(TValue.from_short_slice_unchecked([]), "true");
  assert_writeable_eq(TValue.from_short_slice_unchecked([hybrid]), "hybrid");
  assert_writeable_eq(TValue.from_short_slice_unchecked([hybrid, foobar]), "hybrid-foobar");
});

// crate: icu_locale_core-2.3.0/src/extensions/transform/value.rs:154 test_short_tvalue
test("test_short_tvalue", () => {
  const v = ok(TValue.try_from_str("foo-longstag"));
  expect(v._0.length).toBe(2);
  expect(v._0.map((s) => s.as_str())).toEqual(["foo", "longstag"]);
  expect(TValue.try_from_str("foo-ba").$).toBe("Err");
});

// crate: icu_locale_core-2.3.0/src/extensions/unicode/attributes.rs:202 test_attributes_fromstr
test("test_attributes_fromstr", () => {
  expect(ok(Attributes.from_str("foo-bar")).to_string()).toBe("bar-foo");
});

// crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:449 test_keywords_fromstr
test("test_keywords_fromstr", () => {
  expect(ok(Keywords.from_str("hc-h12")).to_string()).toBe("hc-h12");
});

// crate: icu_locale_core-2.3.0/src/extensions/unicode/mod.rs:288 test_unicode_extension_fromstr
test("test_unicode_extension_fromstr", () => {
  expect(ok(Unicode.from_str("u-foo-hc-h12")).to_string()).toBe("u-foo-hc-h12");
  expect(Unicode.from_str("u").$).toBe("Err");
});

// crate: icu_locale_core-2.3.0/src/extensions/unicode/subdivision.rs:235 test_subdivisionid_fromstr
test("test_subdivisionid_fromstr", () => {
  const si = ok(SubdivisionId.from_str("gbzzzz"));
  expect(si.region.to_string()).toBe("GB");
  expect(si.suffix.to_string()).toBe("zzzz");
  expect(si.to_string()).toBe("gbzzzz");
  for (const sample of ["", "gb", "o"]) {
    expect(SubdivisionId.from_str(sample).$, sample).toBe("Err");
  }
});

// crate: icu_locale_core-2.3.0/src/preferences/extensions/unicode/keywords/region_override.rs:56 region_override_test
test("region_override_test", () => {
  const cases: [string, string, string][] = [
    ["uksct", "UK", "sct"],
    ["usca", "US", "ca"],
    ["419bel", "419", "bel"],
    ["uszzzz", "us", "zzzz"],
  ];
  for (const [v, r, s] of cases) {
    const rg = ok(RegionOverride.try_from(value(v)));
    expect(rg.region.eq(region(r))).toBe(true);
    expect(rg.suffix.eq(subdivision_suffix(s))).toBe(true);
  }
  for (const i of ["4aabel", "a4bel", "ukabcde"]) {
    expect(RegionOverride.try_from(ok(Value.try_from_str(i))).$, i).toBe("Err");
  }
});

// crate: icu_locale_core-2.3.0/src/preferences/extensions/unicode/keywords/regional_subdivision.rs:73 region_subdivision_test
test("region_subdivision_test", () => {
  const rg = ok(RegionalSubdivision.try_from(value("uksct")));
  expect(rg.region.eq(region("UK"))).toBe(true);
  expect(rg.suffix.eq(subdivision_suffix("sct"))).toBe(true);
  for (const i of ["4aabel", "a4bel", "ukabcde"]) {
    expect(RegionalSubdivision.try_from(ok(Value.try_from_str(i))).$, i).toBe("Err");
  }
});

// crate: icu_locale_core-2.3.0/src/preferences/locale.rs:244 test_data_locale_conversion
test("test_data_locale_conversion", () => {
  const test_cases: { input: string; language_priority: string; region_priority: string }[] = [
    { input: "en", language_priority: "en", region_priority: "en" },
    { input: "en-US", language_priority: "en-US", region_priority: "en-US" },
    { input: "en-u-sd-ustx", language_priority: "en-US-u-sd-ustx", region_priority: "en-US-u-sd-ustx" },
    { input: "en-US-u-sd-ustx", language_priority: "en-US-u-sd-ustx", region_priority: "en-US-u-sd-ustx" },
    { input: "en-u-rg-gbzzzz", language_priority: "en", region_priority: "en-GB" },
    { input: "en-US-u-rg-gbzzzz", language_priority: "en-US", region_priority: "en-GB" },
    { input: "!en-US-u-sd-gbzzzz", language_priority: "en-US", region_priority: "en-US" },
    { input: "en-u-rg-gbzzzz-sd-ustx", language_priority: "en-US-u-sd-ustx", region_priority: "en-GB" },
    { input: "en-US-u-rg-gbzzzz-sd-ustx", language_priority: "en-US-u-sd-ustx", region_priority: "en-GB" },
    { input: "en-US-u-rg-gbeng-sd-ustx", language_priority: "en-US-u-sd-ustx", region_priority: "en-GB-u-sd-gbeng" },
    { input: "!en-TR-u-rg-true", language_priority: "en-TR", region_priority: "en-TR" },
    { input: "!en-US-u-sd-tx", language_priority: "en-US", region_priority: "en-US" },
    { input: "!en-GB-u-rg-tx", language_priority: "en-GB", region_priority: "en-GB" },
    { input: "en-US-u-rg-eng", language_priority: "en-US", region_priority: "en-EN-u-sd-eng" },
    // All alphabetic values of `-u-sd` are valid, as they are of length 3+, so there's
    // always at least a one-character subdivision. Numeric regions can lead to invalid
    // values though.
    { input: "!en-001-u-sd-001", language_priority: "en-001", region_priority: "en-001" },
  ];
  for (const test_case of test_cases) {
    let prefs: LocalePreferences;
    if (test_case.input.startsWith("!")) {
      const locale = test_case.input.slice(1);
      const r = LocalePreferences.from_locale_strict(ok(Locale.try_from_str(locale)));
      expect(r.$, locale).toBe("Err");
      prefs = r._0;
    } else {
      const r = LocalePreferences.from_locale_strict(ok(Locale.try_from_str(test_case.input)));
      expect(r.$, test_case.input).toBe("Ok");
      prefs = r._0;
    }
    expect(prefs.to_data_locale_language_priority().to_string(), test_case.input).toBe(test_case.language_priority);
    expect(prefs.to_data_locale_region_priority().to_string(), test_case.input).toBe(test_case.region_priority);
  }
});

// crate: icu_locale_core-2.3.0/src/data.rs:463 test_data_locale_to_string
test("test_data_locale_to_string", () => {
  for (const [locale, expected] of [
    ["und", "und"],
    ["und-u-sd-sdd", "und-SD-u-sd-sdd"],
    ["en-ZA-u-sd-zaa", "en-ZA-u-sd-zaa"],
    ["en-ZA-u-sd-sdd", "en-ZA"],
  ] as const) {
    assert_writeable_eq(ok(DataLocale.from_str(locale)), expected);
  }
});

// crate: icu_locale_core-2.3.0/src/data.rs:493 test_data_locale_from_string
test("test_data_locale_from_string", () => {
  for (const [input, success] of [
    ["und", true],
    ["und-u-cu-gbp", false],
    ["en-ZA-u-sd-zaa", true],
    ["en...", false],
  ] as const) {
    const r = DataLocale.from_str(input);
    expect(r.$ === "Ok", input).toBe(success);
    if (r.$ === "Ok") assert_writeable_eq(r._0, input);
  }
});

// Upstream tests of the struct_keyword! / enum_keyword! macros and the serde/shortvec modules are
// not ported (see the crate-skip markers in those files).
