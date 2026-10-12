// Port of icu_locale_core 2.3.0 `src/parser/langid.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: `ShortBoxSlice<Variant>` is a `Variant[]`; `SubtagIterator` is `Copy`, so the `const fn`
// parser takes it by value and threads `iter = iter.next_const().0`.
import { Err, Ok, type Result } from "../../../std/result.ts";
import { binary_search_by } from "../../litemap/map.ts";
import { ExtensionType } from "../extensions/mod.ts";
import { Attribute } from "../extensions/unicode/attribute.ts";
import { Key } from "../extensions/unicode/key.ts";
import { Value } from "../extensions/unicode/value.ts";
import { LanguageIdentifier } from "../langid.ts";
import { Language } from "../subtags/language.ts";
import type { Subtag } from "../subtags/mod.ts";
import { Region } from "../subtags/region.ts";
import { Script } from "../subtags/script.ts";
import { Variant } from "../subtags/variant.ts";
import { Variants } from "../subtags/variants.ts";
import type { ParseError } from "./errors.ts";
import { SubtagIterator } from "./mod.ts";

export type { ParseError } from "./errors.ts";

// #[derive(PartialEq, Clone, Copy)]
export type ParserMode = "LanguageIdentifier" | "Locale" | "Partial";
export const ParserMode = { LanguageIdentifier: "LanguageIdentifier", Locale: "Locale", Partial: "Partial" } as const;

// #[derive(PartialEq, Clone, Copy)]
type ParserPosition = "Script" | "Region" | "Variant";

// crate: icu_locale_core-2.3.0/src/parser/langid.rs:32 parse_language_identifier_from_iter
export function parse_language_identifier_from_iter(iter: SubtagIterator, mode: ParserMode): Result<LanguageIdentifier, ParseError> {
  let script: Script | undefined = undefined;
  let region: Region | undefined = undefined;
  const variants: Variant[] = [];

  let language: Language;
  const first = iter.next();
  if (first !== undefined) {
    const r = Language.try_from_utf8(first);
    if (r.$ === "Err") return r;
    language = r._0;
  } else {
    return Err("InvalidLanguage");
  }

  let position: ParserPosition = "Script";

  for (let subtag = iter.peek(); subtag !== undefined; subtag = iter.peek()) {
    if (mode !== "LanguageIdentifier" && subtag.length === 1) {
      break;
    }

    if (position === "Script") {
      let s: Result<Script, ParseError>;
      let r: Result<Region, ParseError>;
      let v: Result<Variant, ParseError>;
      if ((s = Script.try_from_utf8(subtag)).$ === "Ok") {
        script = s._0;
        position = "Region";
      } else if ((r = Region.try_from_utf8(subtag)).$ === "Ok") {
        region = r._0;
        position = "Variant";
      } else if ((v = Variant.try_from_utf8(subtag)).$ === "Ok") {
        const vv = v._0;
        const idx = binary_search_by(variants, (x) => x.cmp(vv));
        if (idx.$ === "Err") {
          variants.splice(idx._0, 0, vv);
        }
        position = "Variant";
      } else if (mode === "Partial") {
        break;
      } else {
        return Err("InvalidSubtag");
      }
    } else if (position === "Region") {
      let r: Result<Region, ParseError>;
      let v: Result<Variant, ParseError>;
      if ((r = Region.try_from_utf8(subtag)).$ === "Ok") {
        region = r._0;
        position = "Variant";
      } else if ((v = Variant.try_from_utf8(subtag)).$ === "Ok") {
        const vv = v._0;
        const idx = binary_search_by(variants, (x) => x.cmp(vv));
        if (idx.$ === "Err") {
          variants.splice(idx._0, 0, vv);
        }
        position = "Variant";
      } else if (mode === "Partial") {
        break;
      } else {
        return Err("InvalidSubtag");
      }
    } else {
      const v = Variant.try_from_utf8(subtag);
      if (v.$ === "Ok") {
        const vv = v._0;
        const idx = binary_search_by(variants, (x) => x.cmp(vv));
        if (idx.$ === "Err") {
          variants.splice(idx._0, 0, vv);
        } else {
          return Err("InvalidSubtag");
        }
      } else if (mode === "Partial") {
        break;
      } else {
        return Err("InvalidSubtag");
      }
    }
    iter.next();
  }

  return Ok(new LanguageIdentifier(language, script, region, Variants.from_short_slice_unchecked(variants)));
}

// crate: icu_locale_core-2.3.0/src/parser/langid.rs:107 parse_language_identifier
export function parse_language_identifier(t: Uint8Array, mode: ParserMode): Result<LanguageIdentifier, ParseError> {
  const iter = SubtagIterator.new(t);
  return parse_language_identifier_from_iter(iter, mode);
}

export type SingleVariantSingleKeyword = [
  Language,
  Script | undefined,
  Region | undefined,
  Variant | undefined,
  [Key, Subtag | undefined] | undefined,
];

// crate: icu_locale_core-2.3.0/src/parser/langid.rs:116 parse_locale_with_single_variant_single_keyword_unicode_extension_from_iter
export function parse_locale_with_single_variant_single_keyword_unicode_extension_from_iter(
  iter: SubtagIterator,
  mode: ParserMode,
): Result<SingleVariantSingleKeyword, ParseError> {
  let language: Language;
  let script: Script | undefined = undefined;
  let region: Region | undefined = undefined;
  let variant: Variant | undefined = undefined;
  let keyword: [Key, Subtag | undefined] | undefined = undefined;

  {
    const [i, subtag] = iter.next_const();
    if (subtag !== undefined) {
      iter = i;
      const l = Language.try_from_utf8(subtag);
      if (l.$ === "Ok") language = l._0;
      else return l;
    } else {
      return Err("InvalidLanguage");
    }
  }

  let position: ParserPosition = "Script";

  for (let subtag = iter.peek(); subtag !== undefined; subtag = iter.peek()) {
    if (mode !== "LanguageIdentifier" && subtag.length === 1) {
      break;
    }

    if (position === "Script") {
      let s: Result<Script, ParseError>;
      let r: Result<Region, ParseError>;
      let v: Result<Variant, ParseError>;
      if ((s = Script.try_from_utf8(subtag)).$ === "Ok") {
        script = s._0;
        position = "Region";
      } else if ((r = Region.try_from_utf8(subtag)).$ === "Ok") {
        region = r._0;
        position = "Variant";
      } else if ((v = Variant.try_from_utf8(subtag)).$ === "Ok") {
        // We cannot handle multiple variants in a const context
        // debug_assert!(variant.is_none());
        variant = v._0;
        position = "Variant";
      } else if (mode === "Partial") {
        break;
      } else {
        return Err("InvalidSubtag");
      }
    } else if (position === "Region") {
      let s: Result<Region, ParseError>;
      let v: Result<Variant, ParseError>;
      if ((s = Region.try_from_utf8(subtag)).$ === "Ok") {
        region = s._0;
        position = "Variant";
      } else if ((v = Variant.try_from_utf8(subtag)).$ === "Ok") {
        // We cannot handle multiple variants in a const context
        // debug_assert!(variant.is_none());
        variant = v._0;
        position = "Variant";
      } else if (mode === "Partial") {
        break;
      } else {
        return Err("InvalidSubtag");
      }
    } else {
      const v = Variant.try_from_utf8(subtag);
      if (v.$ === "Ok") {
        // debug_assert!(matches!(position, ParserPosition::Variant));
        if (variant !== undefined) {
          // We cannot handle multiple variants in a const context
          return Err("InvalidSubtag");
        }
        variant = v._0;
      } else if (mode === "Partial") {
        break;
      } else {
        return Err("InvalidSubtag");
      }
    }

    iter = iter.next_const()[0];
  }

  const subtag = mode === "Locale" ? iter.peek() : undefined;
  if (subtag !== undefined) {
    const t = ExtensionType.try_from_utf8(subtag);
    if (t.$ === "Ok" && t._0.$ === "Unicode") {
      iter = iter.next_const()[0];
      const peek = iter.peek();
      if (peek !== undefined && Attribute.try_from_utf8(peek).$ === "Ok") {
        // We cannot handle Attributes in a const context
        return Err("InvalidSubtag");
      }

      let key: Key | undefined = undefined;
      let current_type: Subtag | undefined = undefined;

      for (let peek = iter.peek(); peek !== undefined; peek = iter.peek()) {
        if (peek.length === 2) {
          if (key !== undefined) {
            // We cannot handle more than one Key in a const context
            return Err("InvalidSubtag");
          }
          const k = Key.try_from_utf8(peek);
          if (k.$ === "Ok") key = k._0;
          else return k;
        } else if (key !== undefined) {
          const t = Value.parse_subtag_from_utf8(peek);
          if (t.$ === "Ok") {
            if (t._0 !== undefined) {
              if (current_type !== undefined) {
                // We cannot handle more than one type in a const context
                return Err("InvalidSubtag");
              }
              current_type = t._0;
            }
          } else {
            return t;
          }
        } else {
          break;
        }
        iter = iter.next_const()[0];
      }
      if (key !== undefined) {
        keyword = [key, current_type];
      }
    } else if (t.$ === "Ok") {
      // We cannot handle Transform, Private, Other extensions in a const context
      return Err("InvalidSubtag");
    } else {
      return t;
    }
  }

  return Ok([language, script, region, variant, keyword]);
}

// crate: icu_locale_core-2.3.0/src/parser/langid.rs:256 parse_language_identifier_with_single_variant
export function parse_language_identifier_with_single_variant(
  t: Uint8Array,
  mode: ParserMode,
): Result<[Language, Script | undefined, Region | undefined, Variant | undefined], ParseError> {
  const iter = SubtagIterator.new(t);
  const r = parse_locale_with_single_variant_single_keyword_unicode_extension_from_iter(iter, mode);
  if (r.$ === "Ok") {
    const [l, s, rr, v] = r._0;
    return Ok([l, s, rr, v]);
  } else {
    return r;
  }
}
