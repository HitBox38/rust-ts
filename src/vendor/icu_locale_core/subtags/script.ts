// Port of icu_locale_core 2.3.0 `src/subtags/script.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import type { Result } from "../../../std/result.ts";
import { subtag_from_raw_unchecked, subtag_macro, subtag_try_from_str, subtag_try_from_utf8, TinystrSubtag, type TinystrSubtagSpec } from "../helpers.ts";
import type { ParseError } from "../parser/errors.ts";
import { Subtag } from "./mod.ts";

// impl_tinystr_subtag!(
/// A script subtag (examples: `"Latn"`, `"Arab"`, etc.)
///
/// [`Script`] represents a Unicode base language code conformant to the
/// [`unicode_script_id`] field of the Language and Locale Identifier.
///
/// [`unicode_script_id`]: https://unicode.org/reports/tr35/#unicode_script_id
export class Script extends TinystrSubtag {
  static readonly SPEC: TinystrSubtagSpec<Script> = {
    path: "subtags::Script",
    len_start: 4,
    len_end: 4,
    validate: (s) => s.is_ascii_alphabetic(),
    normalize: (s) => s.to_ascii_titlecase(),
    is_normalized: (s) => s.is_ascii_alphabetic_titlecase(),
    error: "InvalidSubtag",
    make: (s) => new Script(s),
  };
  static try_from_str(s: string): Result<Script, ParseError> {
    return subtag_try_from_str(Script.SPEC, s);
  }
  static try_from_utf8(code_units: Uint8Array): Result<Script, ParseError> {
    return subtag_try_from_utf8(Script.SPEC, code_units);
  }
  static from_raw_unchecked(v: Uint8Array): Script {
    return subtag_from_raw_unchecked(Script.SPEC, v);
  }

  /** Nominal brand (TS classes are structural). */
  private declare readonly __brand_Script: void;

}

/** `script!("..")` */
export function script(s: string): Script {
  return subtag_macro(Script.SPEC, s);
}

// impl From<Script> for Subtag
// crate: icu_locale_core-2.3.0/src/subtags/script.rs:40 from
export function Subtag_from_Script(value: Script): Subtag {
  return new Subtag(value._0.resize(8));
}
