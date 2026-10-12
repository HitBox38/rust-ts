// Port of icu_locale_core 2.3.0 `src/preferences/extensions/unicode/keywords/regional_subdivision.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import { Err, Ok, type Result } from "../../../../../../std/result.ts";
import { key, type Key } from "../../../../extensions/unicode/key.ts";
import { SubdivisionId } from "../../../../extensions/unicode/subdivision.ts";
import { Value } from "../../../../extensions/unicode/value.ts";
import type { PreferencesParseError } from "../errors.ts";
import {
  type StructKeywordSpec,
  struct_keyword_into_value,
  struct_keyword_try_from,
  struct_keyword_try_from_key_value,
  struct_keyword_unicode_extension_key,
  struct_keyword_unicode_extension_value,
} from "../macros/struct_keyword.ts";

// struct_keyword!(
/// A Unicode Subdivision Identifier defines a regional subdivision used for locales.
///
/// The valid values are listed in [LDML](https://unicode.org/reports/tr35/#UnicodeSubdivisionIdentifier).
// #[derive(Debug, Clone, Eq, PartialEq, Hash)] [Copy]
export class RegionalSubdivision {
  constructor(public _0: SubdivisionId) {}

  static get UNICODE_EXTENSION_KEY(): Key {
    return key("sd");
  }

  static readonly SPEC: StructKeywordSpec<RegionalSubdivision> = {
    get UNICODE_EXTENSION_KEY(): Key {
      return RegionalSubdivision.UNICODE_EXTENSION_KEY;
    },
    try_from: (input: Value): Result<RegionalSubdivision, PreferencesParseError> => {
      const subtag = input.as_single_subtag();
      if (subtag !== undefined) {
        const r = SubdivisionId.from_str(subtag.as_str());
        if (r.$ === "Ok") return Ok(new RegionalSubdivision(r._0));
      }
      return Err("InvalidKeywordValue");
    },
    into: (input: RegionalSubdivision): Value => Value.from_subtag(input._0.into_subtag()),
  };

  static try_from(input: Value): Result<RegionalSubdivision, PreferencesParseError> {
    return struct_keyword_try_from(RegionalSubdivision.SPEC, input);
  }
  static into_value(input: RegionalSubdivision): Value {
    return struct_keyword_into_value(RegionalSubdivision.SPEC, input);
  }
  static unicode_extension_key(): Key | undefined {
    return struct_keyword_unicode_extension_key(RegionalSubdivision.SPEC);
  }
  static try_from_key_value(k: Key, value: Value): Result<RegionalSubdivision | undefined, PreferencesParseError> {
    return struct_keyword_try_from_key_value(RegionalSubdivision.SPEC, k, value);
  }
  unicode_extension_value(): Value | undefined {
    return struct_keyword_unicode_extension_value(RegionalSubdivision.SPEC, this);
  }

  /** `Deref<Target = SubdivisionId>` */
  get region() {
    return this._0.region;
  }
  get suffix() {
    return this._0.suffix;
  }

  eq(other: RegionalSubdivision): boolean {
    return this._0.eq(other._0);
  }
}
