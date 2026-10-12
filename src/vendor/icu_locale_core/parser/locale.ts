// Port of icu_locale_core 2.3.0 `src/parser/locale.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import { Ok, type Result } from "../../../std/result.ts";
import { Extensions } from "../extensions/mod.ts";
import { Locale } from "../locale.ts";
import type { ParseError } from "./errors.ts";
import {
  parse_language_identifier_from_iter,
  parse_locale_with_single_variant_single_keyword_unicode_extension_from_iter,
  type ParserMode,
  type SingleVariantSingleKeyword,
} from "./langid.ts";
import { SubtagIterator } from "./mod.ts";

// crate: icu_locale_core-2.3.0/src/parser/locale.rs:14 parse_locale
export function parse_locale(t: Uint8Array): Result<Locale, ParseError> {
  const iter = SubtagIterator.new(t);

  const id = parse_language_identifier_from_iter(iter, "Locale");
  if (id.$ === "Err") return id;
  let extensions: Extensions;
  if (iter.peek() !== undefined) {
    const r = Extensions.try_from_iter(iter);
    if (r.$ === "Err") return r;
    extensions = r._0;
  } else {
    extensions = Extensions.default();
  }
  return Ok(new Locale(id._0, extensions));
}

// crate: icu_locale_core-2.3.0/src/parser/locale.rs:27 parse_locale_with_single_variant_single_keyword_unicode_keyword_extension
export function parse_locale_with_single_variant_single_keyword_unicode_keyword_extension(
  t: Uint8Array,
  mode: ParserMode,
): Result<SingleVariantSingleKeyword, ParseError> {
  const iter = SubtagIterator.new(t);
  return parse_locale_with_single_variant_single_keyword_unicode_extension_from_iter(iter, mode);
}
