// Port of icu_locale_core 2.3.0 `src/macros.rs` `mod test`.
import { expect, test } from "bun:test";
import { unwrap_result } from "../../std/result.ts";
import { LanguageIdentifier, langid } from "./langid.ts";
import { Locale, locale } from "./locale.ts";

// crate: icu_locale_core-2.3.0/src/macros.rs:193 test_langid_macro_can_parse_langid_with_single_variant
test("test_langid_macro_can_parse_langid_with_single_variant", () => {
  const DE_AT_FOOBAR = langid("de-at-foobar");
  const de_at_foobar = unwrap_result(LanguageIdentifier.from_str("de-at-foobar"));
  expect(DE_AT_FOOBAR.eq(de_at_foobar)).toBe(true);
});

// crate: icu_locale_core-2.3.0/src/macros.rs:200 test_locale_macro_can_parse_locale_with_single_variant
test("test_locale_macro_can_parse_locale_with_single_variant", () => {
  const DE_AT_FOOBAR = locale("de-at-foobar");
  const de_at_foobar = unwrap_result(Locale.from_str("de-at-foobar"));
  expect(DE_AT_FOOBAR.eq(de_at_foobar)).toBe(true);
});

// crate: icu_locale_core-2.3.0/src/macros.rs:207 test_locale_macro_can_parse_locale_with_single_keyword_unicode_extension
test("test_locale_macro_can_parse_locale_with_single_keyword_unicode_extension", () => {
  const DE_AT_U_CA_FOOBAR = locale("de-at-u-ca-foobar");
  const de_at_u_ca_foobar = unwrap_result(Locale.from_str("de-at-u-ca-foobar"));
  expect(DE_AT_U_CA_FOOBAR.eq(de_at_u_ca_foobar)).toBe(true);
});
