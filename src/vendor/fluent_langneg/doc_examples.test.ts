// The rustdoc examples of fluent-langneg 0.13.1 (accepted_languages.rs, negotiate/mod.rs), ported
// as tests, plus the negotiation table from the module docs.
import { expect, test } from "bun:test";
import { display_LanguageIdentifier, LanguageIdentifier } from "../unic_langid/lib.ts";
import { convert_vec_str_to_langids, convert_vec_str_to_langids_lossy, negotiate_languages, NegotiationStrategy, parse_accepted_languages } from "./lib.ts";

const show = (v: readonly LanguageIdentifier[]) => v.map(display_LanguageIdentifier);
const parse = (s: string) => {
  const r = LanguageIdentifier.from_str(s);
  if (r.$ === "Err") throw new Error("parse");
  return r._0;
};

test("accepted_languages.rs example", () => {
  const requested = parse_accepted_languages("de-AT;0.9,de-DE;0.8,de;0.7;en-US;0.5");
  const available = convert_vec_str_to_langids_lossy(["fr", "pl", "de", "en-US"]);
  const default_ = parse("en-US");
  const supported = negotiate_languages(requested, available, default_, NegotiationStrategy.Filtering);
  expect(show(supported)).toEqual(["de", "en-US"]);
  // The very objects of `available` (and `default`) are returned.
  expect(supported[0]).toBe(available[2]!);
  expect(supported[1]).toBe(default_);
});

test("negotiate/mod.rs example", () => {
  const requested = convert_vec_str_to_langids_lossy(["pl", "fr", "en-US"]);
  const available = convert_vec_str_to_langids_lossy(["it", "de", "fr", "en-GB", "en_US"]);
  const default_ = parse("en-US");
  const supported = negotiate_languages(requested, available, default_, NegotiationStrategy.Filtering);
  expect(show(supported)).toEqual(["fr", "en-US", "en-GB"]);
});

// Expected values from the pinned crate (scratch oracle run, see docs/handoff/fluent-bundle.md).
test("negotiate/mod.rs strategy table", () => {
  const n = (req: string[], av: string[], s: NegotiationStrategy = "Filtering") =>
    show(negotiate_languages(convert_vec_str_to_langids_lossy(req), convert_vec_str_to_langids_lossy(av), undefined, s));
  expect(n(["en-US"], ["en-US"])).toEqual(["en-US"]);
  expect(n(["en-US"], ["en"])).toEqual(["en"]);
  expect(n(["en"], ["en-GB", "en-US"])).toEqual(["en-US", "en-GB"]);
  expect(n(["ja-JP-macos"], ["ja-JP-windows"])).toEqual(["ja-JP-windows"]);
  expect(n(["en-CA"], ["en-ZA", "en-US"])).toEqual(["en-US", "en-ZA"]);
  expect(n(["en-GB"], ["en-AU"])).toEqual(["en-AU"]);
  expect(n(["de", "fr"], ["fr", "de-DE", "de"], "Matching")).toEqual(["de", "fr"]);
  expect(n(["de", "fr"], ["fr", "de-DE", "de"], "Lookup")).toEqual(["de"]);
});

test("convert_vec_str_to_langids", () => {
  expect(convert_vec_str_to_langids(["en", "fr-CA"]).$).toBe("Ok");
  expect(convert_vec_str_to_langids(["en", "x-ÁÁ"]).$).toBe("Err");
  expect(show(convert_vec_str_to_langids_lossy(["en", "x-ÁÁ", "de"]))).toEqual(["en", "de"]);
});
