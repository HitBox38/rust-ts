// Port of icu_locale_core 2.3.0 `tests/fixtures/mod.rs` (test helper; the JSON fixtures next to it
// are copied verbatim from the crate).
//
// PORT: the serde-derived structs are plain JSON objects; `#[serde(untagged)] enum LocaleInfo` is
// decided like serde would: a string, then an object with `error` + `text`, then one with `type` +
// `identifier`, else the subtags object.
import { panic, unreachable } from "../../../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../../../std/result.ts";
import { Extensions } from "../../extensions/mod.ts";
import { Other } from "../../extensions/other/mod.ts";
import { Private, Subtag as PrivateSubtag } from "../../extensions/private/mod.ts";
import { Key as TKey } from "../../extensions/transform/key.ts";
import { Value as TValue } from "../../extensions/transform/value.ts";
import { Attribute } from "../../extensions/unicode/attribute.ts";
import { Attributes } from "../../extensions/unicode/attributes.ts";
import { Key } from "../../extensions/unicode/key.ts";
import { Value } from "../../extensions/unicode/value.ts";
import { LanguageIdentifier } from "../../langid.ts";
import { Locale } from "../../locale.ts";
import type { ParseError } from "../../parser/errors.ts";
import { utf8 } from "../../../../std/str.ts";
import { Language } from "../../subtags/language.ts";
import { Region } from "../../subtags/region.ts";
import { Script } from "../../subtags/script.ts";
import { Variant } from "../../subtags/variant.ts";
import { Variants } from "../../subtags/variants.ts";

export interface LocaleIdentifier {
  type: string;
  identifier: string;
}
interface LocaleExtensions {
  unicode?: { keywords?: Record<string, string | null>; attributes?: string[] };
  transform?: { tlang?: string | null; tfields?: Record<string, string | null> };
  private?: string[];
  other?: string[];
}
export interface LocaleSubtags {
  type: string;
  language?: string | null;
  script?: string | null;
  region?: string | null;
  variants?: string[];
  extensions?: LocaleExtensions | null;
}
export interface LocaleError {
  error: string;
  text: string;
}
export type LocaleInfo =
  | { $: "String"; _0: string }
  | { $: "Error"; _0: LocaleError }
  | { $: "Identifier"; _0: LocaleIdentifier }
  | { $: "Object"; _0: LocaleSubtags };
export interface LocaleTest {
  input: LocaleInfo;
  output: LocaleInfo;
}

function info(v: unknown): LocaleInfo {
  if (typeof v === "string") return { $: "String", _0: v };
  const o = v as Record<string, unknown>;
  if (typeof o.error === "string" && typeof o.text === "string") return { $: "Error", _0: o as unknown as LocaleError };
  if (typeof o.type === "string" && typeof o.identifier === "string") return { $: "Identifier", _0: o as unknown as LocaleIdentifier };
  return { $: "Object", _0: o as unknown as LocaleSubtags };
}

/** `serde_json::from_str::<Vec<LocaleTest>>` */
export function parse_fixtures(json: string): LocaleTest[] {
  return (JSON.parse(json) as { input: unknown; output: unknown }[]).map((t) => ({ input: info(t.input), output: info(t.output) }));
}

const expect_ = <T, E>(r: Result<T, E>, msg: string): T => (r.$ === "Ok" ? r._0 : panic(msg));

// impl TryFrom<LocaleExtensions> for Extensions
// crate: icu_locale_core-2.3.0/tests/fixtures/mod.rs:51 try_from
function extensions_try_from(input: LocaleExtensions): Result<Extensions, ParseError> {
  const ext = Extensions.default();
  if (input.unicode) {
    const unicode = input.unicode;
    for (const [k, v] of Object.entries(unicode.keywords ?? {})) {
      ext.unicode.keywords.set(
        expect_(Key.try_from_str(k), "Parsing key failed."),
        v === null ? expect_(Value.try_from_str(""), "Failed to parse Value") : expect_(Value.try_from_str(v), "Parsing type failed."),
      );
    }
    const v = (unicode.attributes ?? []).map((a) => expect_(Attribute.try_from_str(a), "Parsing attribute failed."));
    ext.unicode.attributes = Attributes.from_vec_unchecked(v);
  }
  if (input.transform) {
    const transform = input.transform;
    for (const [k, v] of Object.entries(transform.tfields ?? {})) {
      if (v === null) panic("Value cannot be empty.");
      ext.transform.fields.set(expect_(TKey.try_from_str(k), "Parsing key failed."), expect_(TValue.try_from_str(v), "Parsing value failed."));
    }
    if (transform.tlang != null) {
      ext.transform.lang = expect_(LanguageIdentifier.from_str(transform.tlang), "Failed to parse tlang.");
    }
  }
  const v = (input.private ?? []).map((p) => expect_(PrivateSubtag.try_from_str(p), "Failed to add field."));
  ext.private = Private.from_vec_unchecked(v);
  const other = (input.other ?? []).map((o) => expect_(Other.try_from_str(o), "Failed to parse Other extension"));
  other.sort((a, b) => a.cmp(b));
  ext.other = other;
  return Ok(ext);
}

// impl TryFrom<LocaleInfo> for LanguageIdentifier
// crate: icu_locale_core-2.3.0/tests/fixtures/mod.rs:142 try_from
export function langid_try_from_info(input: LocaleInfo): Result<LanguageIdentifier, ParseError> {
  switch (input.$) {
    case "String":
      return LanguageIdentifier.from_str(input._0);
    case "Error":
      return Err(parse_error_from(input._0));
    case "Identifier":
      return langid_try_from_identifier(input._0);
    case "Object":
      return langid_try_from_subtags(input._0);
  }
}

// impl TryFrom<LocaleInfo> for Locale
// crate: icu_locale_core-2.3.0/tests/fixtures/mod.rs:155 try_from
export function locale_try_from_info(input: LocaleInfo): Result<Locale, ParseError> {
  switch (input.$) {
    case "String":
      return Locale.from_str(input._0);
    case "Error":
      return Err(parse_error_from(input._0));
    case "Identifier":
      return locale_try_from_identifier(input._0);
    case "Object":
      return locale_try_from_subtags(input._0);
  }
}

// impl TryFrom<LocaleIdentifier> for LanguageIdentifier
// crate: icu_locale_core-2.3.0/tests/fixtures/mod.rs:168 try_from
export function langid_try_from_identifier(input: LocaleIdentifier): Result<LanguageIdentifier, ParseError> {
  return LanguageIdentifier.try_from_locale_bytes(utf8(input.identifier));
}

// impl TryFrom<LocaleIdentifier> for Locale
// crate: icu_locale_core-2.3.0/tests/fixtures/mod.rs:176 try_from
export function locale_try_from_identifier(input: LocaleIdentifier): Result<Locale, ParseError> {
  return Locale.try_from_str(input.identifier);
}

function subtags_of(subtags: LocaleSubtags): [Language, Script | undefined, Region | undefined, Variants] {
  const language = subtags.language != null ? expect_(Language.try_from_str(subtags.language), "Failed to parse language subtag") : Language.UNKNOWN;
  const script = subtags.script != null ? expect_(Script.try_from_str(subtags.script), "Failed to parse script subtag.") : undefined;
  const region = subtags.region != null ? expect_(Region.try_from_str(subtags.region), "Failed to parse region subtag.") : undefined;
  const variants = (subtags.variants ?? []).map((v) => expect_(Variant.try_from_str(v), "Failed to parse variant subtag."));
  return [language, script, region, Variants.from_vec_unchecked(variants)];
}

// impl TryFrom<LocaleSubtags> for LanguageIdentifier
// crate: icu_locale_core-2.3.0/tests/fixtures/mod.rs:184 try_from
export function langid_try_from_subtags(subtags: LocaleSubtags): Result<LanguageIdentifier, ParseError> {
  const [language, script, region, variants] = subtags_of(subtags);
  return Ok(new LanguageIdentifier(language, script, region, variants));
}

// impl TryFrom<LocaleSubtags> for Locale
// crate: icu_locale_core-2.3.0/tests/fixtures/mod.rs:213 try_from
export function locale_try_from_subtags(subtags: LocaleSubtags): Result<Locale, ParseError> {
  const [language, script, region, variants] = subtags_of(subtags);
  const extensions = subtags.extensions ? unwrap_result(extensions_try_from(subtags.extensions)) : Extensions.default();
  return Ok(new Locale(new LanguageIdentifier(language, script, region, variants), extensions));
}

// impl From<LocaleError> for ParseError
// crate: icu_locale_core-2.3.0/tests/fixtures/mod.rs:248 from
export function parse_error_from(e: LocaleError): ParseError {
  switch (e.error) {
    case "InvalidLanguage":
      return "InvalidLanguage";
    case "InvalidSubtag":
      return "InvalidSubtag";
    case "InvalidExtension":
      return "InvalidExtension";
    case "DuplicatedExtension":
      return "DuplicatedExtension";
    default:
      return unreachable("Unknown error name");
  }
}
