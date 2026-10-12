// Port of icu_locale_core 2.3.0 `src/extensions/mod.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! Unicode Extensions provide a mechanism to extend the [`LanguageIdentifier`] with
//! additional bits of information - a combination of a [`LanguageIdentifier`] and [`Extensions`]
//! is called [`Locale`].
//!
//! There are four types of extensions:
//!
//!  * [`Unicode Extensions`] - marked as `u`.
//!  * [`Transform Extensions`] - marked as `t`.
//!  * [`Private Use Extensions`] - marked as `x`.
//!  * [`Other Extensions`] - marked as any `a-z` except of `u`, `t` and `x`.
//!
//! One can think of extensions as a bag of extra information on top of basic 4 [`subtags`].
//!
//! Notice: `Other` extension type is currently not supported.
//!
//! [`LanguageIdentifier`]: super::LanguageIdentifier
//! [`Locale`]: super::Locale
//! [`subtags`]: super::subtags
//! [`Other Extensions`]: other
//! [`Private Use Extensions`]: private
//! [`Transform Extensions`]: transform
//! [`Unicode Extensions`]: unicode
import { Err, Ok, type Result } from "../../../std/result.ts";
import { binary_search_by } from "../../litemap/map.ts";
import { u8_to_ascii_lowercase } from "../../tinystr/asciibyte.ts";
import { EachSubtagWriteable } from "../helpers.ts";
import type { ParseError } from "../parser/errors.ts";
import type { SubtagIterator } from "../parser/mod.ts";
import { Other } from "./other/mod.ts";
import { PRIVATE_EXT_CHAR, Private } from "./private/mod.ts";
import { TRANSFORM_EXT_CHAR, Transform } from "./transform/mod.ts";
import { UNICODE_EXT_CHAR, Unicode } from "./unicode/mod.ts";

/// Defines the type of extension.
// #[derive(Debug, PartialEq, Eq, Clone, Hash, PartialOrd, Ord, Copy)] #[non_exhaustive]
export type ExtensionType =
  /// Transform Extension Type marked as `t`.
  | { readonly $: "Transform" }
  /// Unicode Extension Type marked as `u`.
  | { readonly $: "Unicode" }
  /// Private Extension Type marked as `x`.
  | { readonly $: "Private" }
  /// All other extension types.
  | { readonly $: "Other"; readonly _0: number };

export const ExtensionType = {
  Transform: { $: "Transform" } as ExtensionType,
  Unicode: { $: "Unicode" } as ExtensionType,
  Private: { $: "Private" } as ExtensionType,

  // crate: icu_locale_core-2.3.0/src/extensions/mod.rs:91 try_from_byte_slice
  try_from_byte_slice(key: Uint8Array): Result<ExtensionType, ParseError> {
    if (key.length === 1) {
      return ExtensionType.try_from_byte(key[0]!);
    } else {
      return Err("InvalidExtension");
    }
  },

  // crate: icu_locale_core-2.3.0/src/extensions/mod.rs:99 try_from_byte
  try_from_byte(key: number): Result<ExtensionType, ParseError> {
    key = u8_to_ascii_lowercase(key);
    switch (key) {
      case UNICODE_EXT_CHAR:
        return Ok(ExtensionType.Unicode);
      case TRANSFORM_EXT_CHAR:
        return Ok(ExtensionType.Transform);
      case PRIVATE_EXT_CHAR:
        return Ok(ExtensionType.Private);
      default:
        if ((key >= 0x61 && key <= 0x7a) || (key >= 0x30 && key <= 0x39)) {
          return Ok({ $: "Other", _0: key });
        }
        return Err("InvalidExtension");
    }
  },

  // crate: icu_locale_core-2.3.0/src/extensions/mod.rs:110 try_from_utf8
  try_from_utf8(code_units: Uint8Array): Result<ExtensionType, ParseError> {
    if (code_units.length !== 1) {
      return Err("InvalidExtension");
    }
    const first = code_units[0]!;

    return ExtensionType.try_from_byte(first);
  },
};

/// A map of extensions associated with a given [`Locale`](crate::Locale).
// #[derive(Debug, Default, PartialEq, Eq, Clone, Hash)] #[non_exhaustive]
export class Extensions extends EachSubtagWriteable {
  /// A representation of the data for a private-use extension, when present in the locale identifier.
  "private": Private;

  constructor(
    /// A representation of the data for a Unicode extension, when present in the locale identifier.
    public unicode: Unicode,
    /// A representation of the data for a transform extension, when present in the locale identifier.
    public transform: Transform,
    private_: Private,
    /// A sequence of any other extensions that are present in the locale identifier but are not formally
    /// [defined](https://unicode.org/reports/tr35/) and represented explicitly as [`Unicode`], [`Transform`],
    /// and [`Private`] are.
    public other: Other[],
  ) {
    super();
    this.private = private_;
  }

  /// Returns a new empty map of extensions. Same as [`default()`](Default::default()), but is `const`.
  // crate: icu_locale_core-2.3.0/src/extensions/mod.rs:152 new
  static new(): Extensions {
    return new Extensions(Unicode.new(), Transform.new(), Private.new(), []);
  }

  /// Function to create a new map of extensions containing exactly one unicode extension, callable in `const`
  /// context.
  // crate: icu_locale_core-2.3.0/src/extensions/mod.rs:167 from_unicode
  static from_unicode(unicode: Unicode): Extensions {
    return new Extensions(unicode, Transform.new(), Private.new(), []);
  }

  /** `#[derive(Default)]` */
  static default(): Extensions {
    return Extensions.new();
  }

  /// Returns whether there are no extensions present.
  // crate: icu_locale_core-2.3.0/src/extensions/mod.rs:190 is_empty
  is_empty(): boolean {
    return this.unicode.is_empty() && this.transform.is_empty() && this.private.is_empty() && this.other.length === 0;
  }

  // crate-skip: icu_locale_core-2.3.0/src/extensions/mod.rs:199 as_tuple only used by `total_cmp` (not ported)
  // crate-skip: icu_locale_core-2.3.0/src/extensions/mod.rs:229 total_cmp derived `Ord` over the extension types not ported; unused on rustc's path

  /// Retains the specified extension types, clearing all others.
  // crate: icu_locale_core-2.3.0/src/extensions/mod.rs:259 retain_by_type
  retain_by_type(predicate: (t: ExtensionType) => boolean): void {
    if (!predicate(ExtensionType.Unicode)) {
      this.unicode.clear();
    }
    if (!predicate(ExtensionType.Transform)) {
      this.transform.clear();
    }
    if (!predicate(ExtensionType.Private)) {
      this.private.clear();
    }
    this.other = this.other.filter((o) => predicate({ $: "Other", _0: o.get_ext_byte() }));
  }

  // crate: icu_locale_core-2.3.0/src/extensions/mod.rs:278 try_from_iter
  static try_from_iter(iter: SubtagIterator): Result<Extensions, ParseError> {
    let unicode: Unicode | undefined = undefined;
    let transform: Transform | undefined = undefined;
    let private_: Private | undefined = undefined;
    const other: Other[] = [];

    for (let subtag = iter.next(); subtag !== undefined; subtag = iter.next()) {
      if (subtag.length === 0) {
        return Err("InvalidExtension");
      }

      if (subtag.length !== 1) {
        return Err("InvalidExtension");
      }
      const byte = subtag[0]!;

      const t = ExtensionType.try_from_byte(byte);
      if (t.$ === "Ok" && t._0.$ === "Unicode") {
        if (unicode !== undefined) {
          return Err("DuplicatedExtension");
        }
        const r = Unicode.try_from_iter(iter);
        if (r.$ === "Err") return r;
        unicode = r._0;
      } else if (t.$ === "Ok" && t._0.$ === "Transform") {
        if (transform !== undefined) {
          return Err("DuplicatedExtension");
        }
        const r = Transform.try_from_iter(iter);
        if (r.$ === "Err") return r;
        transform = r._0;
      } else if (t.$ === "Ok" && t._0.$ === "Private") {
        if (private_ !== undefined) {
          return Err("DuplicatedExtension");
        }
        const r = Private.try_from_iter(iter);
        if (r.$ === "Err") return r;
        private_ = r._0;
      } else if (t.$ === "Ok" && t._0.$ === "Other") {
        const ext = t._0._0;
        if (other.some((o: Other) => o.get_ext_byte() === ext)) {
          return Err("DuplicatedExtension");
        }
        const parsed = Other.try_from_iter(ext, iter);
        if (parsed.$ === "Err") return parsed;
        const idx = binary_search_by(other, (o) => o.cmp(parsed._0));
        if (idx.$ === "Err") {
          other.splice(idx._0, 0, parsed._0);
        } else {
          return Err("InvalidExtension");
        }
      } else {
        return Err("InvalidExtension");
      }
    }

    return Ok(new Extensions(unicode ?? Unicode.new(), transform ?? Transform.new(), private_ ?? Private.new(), other));
  }

  // crate: icu_locale_core-2.3.0/src/extensions/mod.rs:335 for_each_subtag_str
  for_each_subtag_str<E>(f: (subtag: string) => Result<undefined, E>): Result<undefined, E> {
    let wrote_tu = false;
    // Alphabetic by singleton
    for (const other of this.other) {
      if (other.get_ext() > TRANSFORM_EXT_CHAR && !wrote_tu) {
        // Since 't' and 'u' are next to each other in alphabetical
        // order, write both now.
        let r = this.transform.for_each_subtag_str(f, true);
        if (r.$ === "Err") return r;
        r = this.unicode.for_each_subtag_str(f, true);
        if (r.$ === "Err") return r;
        wrote_tu = true;
      }
      const r = other.for_each_subtag_str(f, true);
      if (r.$ === "Err") return r;
    }

    if (!wrote_tu) {
      let r = this.transform.for_each_subtag_str(f, true);
      if (r.$ === "Err") return r;
      r = this.unicode.for_each_subtag_str(f, true);
      if (r.$ === "Err") return r;
    }

    // Private must be written last, since it allows single character
    // keys. Extensions must also be written in alphabetical order,
    // which would seem to imply that other extensions `y` and `z` are
    // invalid, but this is not specified.
    const r = this.private.for_each_subtag_str(f, true);
    if (r.$ === "Err") return r;
    return Ok(undefined);
  }

  /** `#[derive(PartialEq)]` */
  eq(other: Extensions): boolean {
    return (
      this.unicode.eq(other.unicode) &&
      this.transform.eq(other.transform) &&
      this.private.eq(other.private) &&
      this.other.length === other.other.length &&
      this.other.every((o, i) => o.eq(other.other[i]!))
    );
  }
}
// impl_writeable_for_each_subtag_str_no_test!(Extensions): `EachSubtagWriteable`.
// test_writeable (mod.rs:370): extensions/extensions.test.ts.
