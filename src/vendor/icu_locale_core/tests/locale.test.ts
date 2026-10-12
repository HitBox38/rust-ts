// Port of icu_locale_core 2.3.0 `tests/locale.rs`.
import { expect, test } from "bun:test";
import { panic } from "../../../std/panic.ts";
import { unwrap_result } from "../../../std/result.ts";
import { utf8 } from "../../../std/str.ts";
import { Locale } from "../locale.ts";
import { assert_writeable_eq, cmp_bytes, fixture } from "./common.ts";
import { locale_try_from_identifier, locale_try_from_info, locale_try_from_subtags, type LocaleTest, parse_error_from, parse_fixtures } from "./fixtures/mod.ts";

// crate: icu_locale_core-2.3.0/tests/locale.rs:14 test_langid_fixtures
function test_langid_fixtures(tests: LocaleTest[]): void {
  for (const t of tests) {
    const msg = JSON.stringify(t.input);
    switch (t.output.$) {
      case "String": {
        const input = unwrap_result(locale_try_from_info(t.input));
        assert_writeable_eq(input, t.output._0, msg);
        break;
      }
      case "Error": {
        const err = parse_error_from(t.output._0);
        const input = locale_try_from_info(t.input);
        expect(input, msg).toEqual({ $: "Err", _0: err });
        break;
      }
      case "Identifier": {
        const ident = t.output._0;
        const input = unwrap_result(locale_try_from_info(t.input));
        const output = unwrap_result(locale_try_from_identifier(ident));
        expect(input.eq(output), msg).toBe(true);
        assert_writeable_eq(input, ident.identifier, msg);
        break;
      }
      case "Object": {
        const input = unwrap_result(locale_try_from_info(t.input));
        const output = unwrap_result(locale_try_from_subtags(t.output._0));
        expect(input.eq(output), msg).toBe(true);
        break;
      }
    }
  }
}

// crate: icu_locale_core-2.3.0/tests/locale.rs:42 test_locale_parsing
test("test_locale_parsing", () => test_langid_fixtures(parse_fixtures(fixture("locale.json"))));

// crate: icu_locale_core-2.3.0/tests/locale.rs:50 test_locale_invalid
test("test_locale_invalid", () => test_langid_fixtures(parse_fixtures(fixture("invalid-extensions.json"))));

// crate: icu_locale_core-2.3.0/tests/locale.rs:58 test_locale_is_empty
test("test_locale_is_empty", () => {
  const locale = Locale.UNKNOWN;
  expect(locale.extensions.is_empty()).toBe(true);
  assert_writeable_eq(locale, "und");
});

// crate: icu_locale_core-2.3.0/tests/locale.rs:65 test_locale_conversions
test("test_locale_conversions", () => {
  const locale = Locale.UNKNOWN;
  const langid = locale.into_langid();
  const locale2 = Locale.from_langid(langid);
  expect(locale.eq(locale2)).toBe(true);
});

// crate: icu_locale_core-2.3.0/tests/locale.rs:73 test_locale_canonicalize
test("test_locale_canonicalize", () => test_langid_fixtures(parse_fixtures(fixture("canonicalize.json"))));

// crate: icu_locale_core-2.3.0/tests/locale.rs:81 test_locale_normalizing_eq_str
test("test_locale_normalizing_eq_str", () => {
  for (const t of parse_fixtures(fixture("locale.json"))) {
    const parsed = unwrap_result(locale_try_from_info(t.input));
    expect(parsed.normalizing_eq(parsed.write_to_string())).toBe(true);
  }
  // Check that trailing characters are not ignored
  const locale = unwrap_result(Locale.from_str("en"));
  expect(locale.normalizing_eq("en-US")).toBe(false);
});

// crate: icu_locale_core-2.3.0/tests/locale.rs:96 test_locale_strict_cmp
test("test_locale_strict_cmp", () => {
  const bcp47_strings = parse_fixtures(fixture("locale.json")).map((t) =>
    t.input.$ === "Identifier" ? t.input._0.identifier : t.output.$ === "Identifier" ? t.output._0.identifier : panic(`No string in fixture input or output: ${JSON.stringify(t)}`),
  );
  for (const a of bcp47_strings) {
    for (const b of bcp47_strings) {
      const a_langid = unwrap_result(Locale.from_str(a));
      const a_normalized = a_langid.write_to_string();
      const string_cmp = cmp_bytes(utf8(a_normalized), utf8(b));
      const test_cmp = a_langid.strict_cmp(utf8(b));
      expect(test_cmp, `${a}/${b}`).toBe(string_cmp);
    }
  }
});

// crate-skip: icu_locale_core-2.3.0/tests/locale.rs:122 test_locale_total_cmp `Locale::total_cmp` is not ported (unused on rustc's path)
