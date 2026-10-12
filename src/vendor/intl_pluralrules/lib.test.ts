// Port of the `#[cfg(test)] mod tests` in intl_pluralrules 7.0.2 `src/lib.rs`.
import { expect, test } from "bun:test";
import { Ok, unwrap_result } from "../../std/result.ts";
import { LanguageIdentifier } from "../unic_langid/lib.ts";
import { CLDR_VERSION, PluralCategory, PluralRules, PluralRuleType } from "./lib.ts";
import { PluralOperands } from "./operands.ts";

const int = (x: number) => PluralOperands.try_from_signed(x); // `select(i32)`

// crate: intl_pluralrules-7.0.2/src/lib.rs:193 cardinals_test
test("cardinals_test", () => {
  const langid = unwrap_result(LanguageIdentifier.from_str("naq"));
  const pr_naq = unwrap_result(PluralRules.create(langid, PluralRuleType.CARDINAL));
  expect(pr_naq.select(1, int)).toEqual(Ok(PluralCategory.ONE));
  expect(pr_naq.select(2, int)).toEqual(Ok(PluralCategory.TWO));
  expect(pr_naq.select(5, int)).toEqual(Ok(PluralCategory.OTHER));

  const langid2 = unwrap_result(LanguageIdentifier.from_str("xx"));
  const pr_broken = PluralRules.create(langid2, PluralRuleType.CARDINAL);
  expect(pr_broken.$ === "Err").toBe(!(pr_broken.$ === "Ok"));
});

// crate: intl_pluralrules-7.0.2/src/lib.rs:206 ordinals_rules
test("ordinals_rules", () => {
  const langid = unwrap_result(LanguageIdentifier.from_str("uk"));
  const pr_naq = unwrap_result(PluralRules.create(langid, PluralRuleType.ORDINAL));
  expect(pr_naq.select(33, int)).toEqual(Ok(PluralCategory.FEW));
  expect(pr_naq.select(113, int)).toEqual(Ok(PluralCategory.OTHER));
});

// crate: intl_pluralrules-7.0.2/src/lib.rs:214 version_test
test("version_test", () => {
  expect(CLDR_VERSION).toBe(37);
});

// crate: intl_pluralrules-7.0.2/src/lib.rs:219 locale_test
test("locale_test", () => {
  expect(PluralRules.get_locales(PluralRuleType.CARDINAL).length === 0).toBe(false);
});

test("rust-ts: crate doc example (Polish)", () => {
  const langid = unwrap_result(LanguageIdentifier.from_str("pl"));
  expect(PluralRules.get_locales(PluralRuleType.CARDINAL).some((l) => l.eq(langid))).toBe(true);
  const pr = unwrap_result(PluralRules.create(langid.clone(), PluralRuleType.CARDINAL));
  expect(pr.select(1, int)).toEqual(Ok(PluralCategory.ONE));
  expect(pr.select("3", PluralOperands.try_from_str)).toEqual(Ok(PluralCategory.FEW));
  expect(pr.select(12, int)).toEqual(Ok(PluralCategory.MANY));
  expect(pr.select("5.0", PluralOperands.try_from_str)).toEqual(Ok(PluralCategory.OTHER));
  expect(pr.get_locale().eq(langid)).toBe(true);
});
