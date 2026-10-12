// Port of icu_locale_core 2.3.0 `src/preferences/extensions/unicode/macros/struct_keyword.rs`
// (the `struct_keyword!` macro).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: the macro defines a newtype `$name(pub(crate) $value)` with conversions to/from a unicode
// extension `Value` and a `PreferenceKey` impl. Each expansion is a class that passes its
// `$ext_key` / `$try_from` / `$into` arguments to these shared functions (one marker each).
import { Ok, type Result } from "../../../../../../std/result.ts";
import type { Key } from "../../../../extensions/unicode/key.ts";
import type { Value } from "../../../../extensions/unicode/value.ts";
import type { PreferencesParseError } from "../errors.ts";

export interface StructKeywordSpec<T> {
  readonly UNICODE_EXTENSION_KEY: Key;
  readonly try_from: (input: Value) => Result<T, PreferencesParseError>;
  readonly into: (input: T) => Value;
}

// impl TryFrom<Value> for $name
// crate: icu_locale_core-2.3.0/src/preferences/extensions/unicode/macros/struct_keyword.rs:41 try_from
export function struct_keyword_try_from_owned<T>(spec: StructKeywordSpec<T>, input: Value): Result<T, PreferencesParseError> {
  return struct_keyword_try_from(spec, input);
}

// impl TryFrom<&Value> for $name
// crate: icu_locale_core-2.3.0/src/preferences/extensions/unicode/macros/struct_keyword.rs:51 try_from
export function struct_keyword_try_from<T>(spec: StructKeywordSpec<T>, input: Value): Result<T, PreferencesParseError> {
  return spec.try_from(input);
}

// impl From<$name> for Value
// crate: icu_locale_core-2.3.0/src/preferences/extensions/unicode/macros/struct_keyword.rs:59 from
export function struct_keyword_into_value_owned<T>(spec: StructKeywordSpec<T>, input: T): Value {
  return struct_keyword_into_value(spec, input);
}

// impl From<&$name> for Value
// crate: icu_locale_core-2.3.0/src/preferences/extensions/unicode/macros/struct_keyword.rs:65 from
export function struct_keyword_into_value<T>(spec: StructKeywordSpec<T>, input: T): Value {
  return spec.into(input);
}

// impl PreferenceKey for $name
// crate: icu_locale_core-2.3.0/src/preferences/extensions/unicode/macros/struct_keyword.rs:71 unicode_extension_key
export function struct_keyword_unicode_extension_key<T>(spec: StructKeywordSpec<T>): Key | undefined {
  return spec.UNICODE_EXTENSION_KEY;
}

// crate: icu_locale_core-2.3.0/src/preferences/extensions/unicode/macros/struct_keyword.rs:75 try_from_key_value
export function struct_keyword_try_from_key_value<T>(
  spec: StructKeywordSpec<T>,
  key: Key,
  value: Value,
): Result<T | undefined, PreferencesParseError> {
  if (spec.UNICODE_EXTENSION_KEY.eq(key)) {
    const result = struct_keyword_try_from_owned(spec, value);
    if (result.$ === "Err") return result;
    return Ok(result._0);
  } else {
    return Ok(undefined);
  }
}

// crate: icu_locale_core-2.3.0/src/preferences/extensions/unicode/macros/struct_keyword.rs:87 unicode_extension_value
export function struct_keyword_unicode_extension_value<T>(spec: StructKeywordSpec<T>, self: T): Value | undefined {
  return struct_keyword_into_value_owned(spec, self);
}

// impl core::ops::Deref for $name: the newtype's `_0`.
// crate: icu_locale_core-2.3.0/src/preferences/extensions/unicode/macros/struct_keyword.rs:101 deref
export function struct_keyword_deref<V>(self: { _0: V }): V {
  return self._0;
}

// crate-skip: icu_locale_core-2.3.0/src/preferences/extensions/unicode/macros/struct_keyword.rs:119 struct_keywords_test test of the macro with a dummy keyword; the two expansions are tested in preferences.test.ts
