// Port of unic-langid-impl 0.9.6 `tests/likelysubtags.rs` (`required-features = ["likelysubtags"]`;
// the module is always present in the TS port).
import { expect, test } from "bun:test";
import { unwrap_result } from "../../../std/result.ts";
import { CLDR_VERSION, maximize, minimize, parts_eq } from "../likelysubtags/mod.ts";
import { Language } from "../subtags/language.ts";
import { Region } from "../subtags/region.ts";
import { Script } from "../subtags/script.ts";

type Parts = [Language, Script | undefined, Region | undefined];

const STRINGS: [string, string | undefined][] = [
  ["en-US", "en-Latn-US"],
  ["en-GB", "en-Latn-GB"],
  ["es-AR", "es-Latn-AR"],
  ["it", "it-Latn-IT"],
  ["zh-Hans-CN", undefined],
  ["de-AT", "de-Latn-AT"],
  ["pl", "pl-Latn-PL"],
  ["fr-FR", "fr-Latn-FR"],
  ["de-AT", "de-Latn-AT"],
  ["sr-Cyrl-SR", undefined],
  ["nb-NO", "nb-Latn-NO"],
  ["fr-FR", "fr-Latn-FR"],
  ["mk", "mk-Cyrl-MK"],
  ["uk", "uk-Cyrl-UA"],
  ["und-PL", "pl-Latn-PL"],
  ["und-Latn-AM", "ku-Latn-AM"],
  ["ug-Cyrl", "ug-Cyrl-KZ"],
  ["sr-ME", "sr-Latn-ME"],
  ["mn-Mong", "mn-Mong-CN"],
  ["lif-Limb", "lif-Limb-IN"],
  ["gan", "gan-Hans-CN"],
  ["zh-Hant", "zh-Hant-TW"],
  ["yue-Hans", "yue-Hans-CN"],
  ["unr", "unr-Beng-IN"],
  ["unr-Deva", "unr-Deva-NP"],
  ["und-Thai-CN", "lcp-Thai-CN"],
  ["ug-Cyrl", "ug-Cyrl-KZ"],
  ["en-Latn-DE", undefined],
  ["pl-FR", "pl-Latn-FR"],
  ["de-CH", "de-Latn-CH"],
  ["tuq", "tuq-Latn-TD"],
  ["sr-ME", "sr-Latn-ME"],
  ["ng", "ng-Latn-NA"],
  ["klx", "klx-Latn-PG"],
  ["kk-Arab", "kk-Arab-CN"],
  ["en-Cyrl", "en-Cyrl-US"],
  ["und-Cyrl-UK", "ru-Cyrl-UK"],
  ["und-Arab", "ar-Arab-EG"],
  ["und-Arab-FO", "ar-Arab-FO"],
  ["zh-TW", "zh-Hant-TW"],
];

// crate: unic-langid-impl-0.9.6/tests/likelysubtags.rs:47 extract_input
function extract_input(s: string): Parts {
  const chunks = s.split("-");
  const lang = unwrap_result(Language.from_str(chunks[0]!));
  let script: Script | undefined;
  let region: Region | undefined;
  const c1 = chunks[1];
  if (c1 !== undefined) {
    const sc = Script.from_str(c1);
    if (sc.$ === "Ok") {
      script = sc._0;
      region = chunks[2] !== undefined ? unwrap_result(Region.from_str(chunks[2])) : undefined;
    } else {
      region = unwrap_result(Region.from_str(c1));
    }
  }
  return [lang, script, region];
}

// crate: unic-langid-impl-0.9.6/tests/likelysubtags.rs:70 extract_output
function extract_output(s: string | undefined): Parts | undefined {
  if (s === undefined) return undefined;
  const chunks = s.split("-");
  return [
    unwrap_result(Language.from_str(chunks[0]!)),
    chunks[1] !== undefined ? unwrap_result(Script.from_str(chunks[1])) : undefined,
    chunks[2] !== undefined ? unwrap_result(Region.from_str(chunks[2])) : undefined,
  ];
}

function opt_parts_eq(a: Parts | undefined, b: Parts | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return parts_eq(a, b);
}

// crate: unic-langid-impl-0.9.6/tests/likelysubtags.rs:88 maximize_test
test("maximize_test", () => {
  for (const i of STRINGS) {
    const chunks = extract_input(i[0]);
    const result = maximize(chunks[0], chunks[1], chunks[2]);
    expect(opt_parts_eq(extract_output(i[1]), result), i[0]).toBe(true);
  }
});

// crate: unic-langid-impl-0.9.6/tests/likelysubtags.rs:97 version_works
test("version_works", () => {
  expect(CLDR_VERSION).toBe("44");
});

// crate: unic-langid-impl-0.9.6/tests/likelysubtags.rs:102 minimize_test
test("minimize_test", () => {
  const lang = unwrap_result(Language.from_str("zh"));
  const script = unwrap_result(Script.from_str("Hant"));
  const result = minimize(lang, script, undefined);
  expect(opt_parts_eq(result, extract_input("zh-TW"))).toBe(true);

  const lang2 = unwrap_result(Language.from_str("en"));
  const script2 = unwrap_result(Script.from_str("Latn"));
  const region2 = unwrap_result(Region.from_str("US"));
  const result2 = minimize(lang2, script2, region2);
  expect(opt_parts_eq(result2, extract_input("en"))).toBe(true);
});
