// Port of icu_locale_core 2.3.0 `src/preferences/mod.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! This API provides necessary functionality for building user preferences structs.
//!
//! It includes the ability to merge information between the struct and a [`Locale`],
//! facilitating the resolution of attributes against default values.
//!
//! (The module docs' design notes and examples are not repeated here.)
import { Ok, type Result } from "../../../std/result.ts";
import type { Key } from "../extensions/unicode/key.ts";
import type { Value } from "../extensions/unicode/value.ts";
import type { LanguageIdentifier } from "../langid.ts";
import type { Locale } from "../locale.ts";
import type { PreferencesParseError } from "./extensions/unicode/errors.ts";
import { LocalePreferences } from "./locale.ts";

// pub mod extensions; mod locale;
export { LocalePreferences } from "./locale.ts";

/// A pair of functions that are used to convert a preference from a `Locale`'s
/// unicode extension keyword. `PreferenceKey`'s provided methods (for preference types that are
/// not unicode extension keywords):
// crate: icu_locale_core-2.3.0/src/preferences/mod.rs:401 try_from_key_value
export function PreferenceKey_try_from_key_value<T>(_key: Key, _value: Value): Result<T | undefined, PreferencesParseError> {
  return Ok(undefined);
}

// crate: icu_locale_core-2.3.0/src/preferences/mod.rs:409 unicode_extension_key
export function PreferenceKey_unicode_extension_key(): Key | undefined {
  return undefined;
}

// crate: icu_locale_core-2.3.0/src/preferences/mod.rs:414 unicode_extension_value
export function PreferenceKey_unicode_extension_value<T>(_self: T): Value | undefined {
  return undefined;
}

/// `define_preferences!`: the shared part of every expansion, for a preferences struct with no
/// extra keys (`{}`), such as icu_list's `ListFormatterPreferences`.
///
/// PORT: the macro defines a struct per invocation. A struct with no keys has the single field
/// `locale_preferences`; its conversions are these functions (one marker each). A struct with
/// keys would also loop its `PreferenceKey`s over `loc.extensions.unicode.keywords`.
export class EmptyPreferences {
  constructor(public locale_preferences: LocalePreferences) {}

  /** `#[derive(Default)]` */
  static default(): EmptyPreferences {
    return new EmptyPreferences(LocalePreferences.default());
  }

  // impl From<$crate::Locale> for $name
  // crate: icu_locale_core-2.3.0/src/preferences/mod.rs:490 from
  static from_locale_owned(loc: Locale): EmptyPreferences {
    return EmptyPreferences.from_locale(loc);
  }

  // impl From<&$crate::Locale> for $name
  // crate: icu_locale_core-2.3.0/src/preferences/mod.rs:496 from
  static from_locale(loc: Locale): EmptyPreferences {
    const r = EmptyPreferences.from_locale_strict(loc);
    return r._0;
  }

  // impl From<$crate::LanguageIdentifier> for $name
  // crate: icu_locale_core-2.3.0/src/preferences/mod.rs:502 from
  static from_langid_owned(lid: LanguageIdentifier): EmptyPreferences {
    return EmptyPreferences.from_langid(lid);
  }

  // impl From<&$crate::LanguageIdentifier> for $name
  // crate: icu_locale_core-2.3.0/src/preferences/mod.rs:508 from
  static from_langid(lid: LanguageIdentifier): EmptyPreferences {
    return new EmptyPreferences(LocalePreferences.from_langid(lid));
  }

  /// Extends the preferences with the values from another set of preferences.
  // crate: icu_locale_core-2.3.0/src/preferences/mod.rs:537 extend
  extend(other: EmptyPreferences): void {
    this.locale_preferences.extend(other.locale_preferences);
  }

  // crate: icu_locale_core-2.3.0/src/preferences/mod.rs:549 from_locale_strict
  static from_locale_strict(loc: Locale): Result<EmptyPreferences, EmptyPreferences> {
    let is_err = false;
    // for (k, v) in loc.extensions.unicode.keywords.iter() { (no `$key`s) }
    for (const _ of loc.extensions.unicode.keywords.iter()) {
      // no preference keys to match
    }
    const lp = LocalePreferences.from_locale_strict(loc);
    if (lp.$ === "Err") is_err = true;
    const r = new EmptyPreferences(lp._0);
    if (is_err) {
      return { $: "Err", _0: r };
    } else {
      return Ok(r);
    }
  }
}

// prefs_convert! (mod.rs:595): no preferences struct conversions are used on rustc's path.
// crate-skip: icu_locale_core-2.3.0/src/preferences/mod.rs:600 from macro `prefs_convert!`: unused on rustc's path
// crate-skip: icu_locale_core-2.3.0/src/preferences/mod.rs:617 from macro `prefs_convert!`: unused on rustc's path
