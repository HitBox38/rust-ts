// Port of icu_locale_core 2.3.0 `src/extensions/transform/mod.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! Transform Extensions provide information on content transformations in a given locale.
//!
//! The main struct for this extension is [`Transform`] which contains [`Fields`] and an
//! optional [`LanguageIdentifier`].
import { Err, Ok, type Result } from "../../../../std/result.ts";
import { utf8 } from "../../../../std/str.ts";
import { LiteMap } from "../../../litemap/map.ts";
import {
  type FmtWrite,
  type fmt_Result,
  LengthHint,
  type PartsWrite,
  type Writeable,
  Writeable_write_to_parts,
  Writeable_write_to_string,
  Writeable_writeable_borrow,
} from "../../../writeable/lib.ts";
import { add_assign, add_usize } from "../../../writeable/ops.ts";
import type { LanguageIdentifier } from "../../langid.ts";
import type { ParseError } from "../../parser/errors.ts";
import { parse_language_identifier_from_iter } from "../../parser/langid.ts";
import { SubtagIterator } from "../../parser/mod.ts";
import { Language } from "../../subtags/language.ts";
import type { Subtag } from "../../subtags/mod.ts";
import { ExtensionType } from "../mod.ts";
import { Fields } from "./fields.ts";
import { Key } from "./key.ts";
import { Value } from "./value.ts";

// mod fields; mod key; mod value;
export { Fields } from "./fields.ts";
export { Key, key } from "./key.ts";
export { Value } from "./value.ts";

export const TRANSFORM_EXT_CHAR = 0x74; // 't'
export const TRANSFORM_EXT_STR = "t";

/// A list of [`Unicode BCP47 T Extensions`] as defined in [`Unicode Locale
/// Identifier`] specification.
///
/// Transform extension carries information about source language or script of
/// transformed content, including content that has been transliterated, transcribed,
/// or translated, or in some other way influenced by the source (See [`RFC 6497`] for details).
///
/// [`Unicode BCP47 T Extensions`]: https://unicode.org/reports/tr35/#t_Extension
/// [`RFC 6497`]: https://www.ietf.org/rfc/rfc6497.txt
/// [`Unicode Locale Identifier`]: https://unicode.org/reports/tr35/#Unicode_locale_identifier
// #[derive(Clone, PartialEq, Eq, Debug, Default, Hash)]
export class Transform implements Writeable {
  constructor(
    /// The [`LanguageIdentifier`] specified with this locale extension, or `None` if not present.
    public lang: LanguageIdentifier | undefined,
    /// The key-value pairs present in this locale extension, with each extension key subtag
    /// associated to its provided value subtag.
    public fields: Fields,
  ) {}

  /// Returns a new empty map of Transform extensions. Same as [`default()`](Default::default()), but is `const`.
  // crate: icu_locale_core-2.3.0/src/extensions/transform/mod.rs:109 new
  static new(): Transform {
    return new Transform(undefined, Fields.new());
  }

  /// A constructor which takes a str slice, parses it and
  /// produces a well-formed [`Transform`].
  // crate: icu_locale_core-2.3.0/src/extensions/transform/mod.rs:122 try_from_str
  static try_from_str(s: string): Result<Transform, ParseError> {
    return Transform.try_from_utf8(utf8(s));
  }

  /// See [`Self::try_from_str`]
  // crate: icu_locale_core-2.3.0/src/extensions/transform/mod.rs:130 try_from_utf8
  static try_from_utf8(code_units: Uint8Array): Result<Transform, ParseError> {
    const iter = SubtagIterator.new(code_units);

    const ext = iter.next();
    if (ext === undefined) return Err("InvalidExtension");
    const t = ExtensionType.try_from_byte_slice(ext);
    if (t.$ === "Err") return t;
    if (t._0.$ === "Transform") {
      return Transform.try_from_iter(iter);
    }

    return Err("InvalidExtension");
  }

  /// Returns `true` if there are no tfields and no tlang in the `TransformExtensionList`.
  // crate: icu_locale_core-2.3.0/src/extensions/transform/mod.rs:152 is_empty
  is_empty(): boolean {
    return this.lang === undefined && this.fields.is_empty();
  }

  /// Clears the transform extension, effectively removing it from the locale.
  // crate: icu_locale_core-2.3.0/src/extensions/transform/mod.rs:167 clear
  clear(): void {
    this.lang = undefined;
    this.fields.clear();
  }

  // crate-skip: icu_locale_core-2.3.0/src/extensions/transform/mod.rs:173 as_tuple only used by `total_cmp` (not ported)
  // crate-skip: icu_locale_core-2.3.0/src/extensions/transform/mod.rs:193 total_cmp derived `Ord` over Fields not ported; unused on rustc's path

  // crate: icu_locale_core-2.3.0/src/extensions/transform/mod.rs:198 try_from_iter
  static try_from_iter(iter: SubtagIterator): Result<Transform, ParseError> {
    let tlang: LanguageIdentifier | undefined = undefined;
    const tfields = LiteMap.new<Key, Value>((a, b) => a.cmp(b));

    const peeked = iter.peek();
    if (peeked !== undefined && Language.try_from_utf8(peeked).$ === "Ok") {
      const r = parse_language_identifier_from_iter(iter, "Partial");
      if (r.$ === "Err") return r;
      tlang = r._0;
    }

    let current_tkey: Key | undefined = undefined;
    let current_tvalue: Subtag[] = [];
    let has_current_tvalue = false;

    for (let subtag = iter.peek(); subtag !== undefined; subtag = iter.peek()) {
      if (current_tkey !== undefined) {
        const tkey = current_tkey;
        const val = Value.parse_subtag(subtag);
        if (val.$ === "Ok") {
          has_current_tvalue = true;
          if (val._0 !== undefined) {
            current_tvalue.push(val._0);
          }
        } else {
          if (!has_current_tvalue) {
            return Err("InvalidExtension");
          }
          tfields.try_insert(tkey, Value.from_short_slice_unchecked(current_tvalue));
          current_tkey = undefined;
          current_tvalue = [];
          has_current_tvalue = false;
          continue;
        }
      } else {
        const tkey = Key.try_from_utf8(subtag);
        if (tkey.$ === "Ok") {
          current_tkey = tkey._0;
        } else {
          break;
        }
      }

      iter.next();
    }

    if (current_tkey !== undefined) {
      if (!has_current_tvalue) {
        return Err("InvalidExtension");
      }
      tfields.try_insert(current_tkey, Value.from_short_slice_unchecked(current_tvalue));
    }

    if (tlang === undefined && tfields.is_empty()) {
      return Err("InvalidExtension");
    } else {
      return Ok(new Transform(tlang, Fields.from(tfields)));
    }
  }

  // crate: icu_locale_core-2.3.0/src/extensions/transform/mod.rs:258 for_each_subtag_str
  for_each_subtag_str<E>(f: (subtag: string) => Result<undefined, E>, with_ext: boolean): Result<undefined, E> {
    if (this.is_empty()) {
      return Ok(undefined);
    }
    if (with_ext) {
      const r = f(TRANSFORM_EXT_STR);
      if (r.$ === "Err") return r;
    }
    if (this.lang !== undefined) {
      const r = this.lang.for_each_subtag_str_lowercased(f);
      if (r.$ === "Err") return r;
    }
    return this.fields.for_each_subtag_str(f);
  }

  // impl FromStr for Transform
  // crate: icu_locale_core-2.3.0/src/extensions/transform/mod.rs:281 from_str
  static from_str(s: string): Result<Transform, ParseError> {
    return Transform.try_from_str(s);
  }

  // impl writeable::Writeable for Transform
  // crate: icu_locale_core-2.3.0/src/extensions/transform/mod.rs:289 write_to
  write_to(sink: FmtWrite): fmt_Result {
    if (this.is_empty()) {
      return Ok(undefined);
    }
    let r = sink.write_char(TRANSFORM_EXT_CHAR);
    if (r.$ === "Err") return r;
    if (this.lang !== undefined) {
      r = sink.write_char(0x2d);
      if (r.$ === "Err") return r;
      r = this.lang.write_lowercased_to(sink);
      if (r.$ === "Err") return r;
    }
    if (!this.fields.is_empty()) {
      r = sink.write_char(0x2d);
      if (r.$ === "Err") return r;
      r = this.fields.write_to(sink);
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  }

  // crate: icu_locale_core-2.3.0/src/extensions/transform/mod.rs:305 writeable_length_hint
  writeable_length_hint(): LengthHint {
    if (this.is_empty()) {
      return LengthHint.exact(0);
    }
    let result = LengthHint.exact(1);
    if (this.lang !== undefined) {
      result = add_assign(result, add_usize(this.lang.writeable_length_hint(), 1));
    }
    if (!this.fields.is_empty()) {
      result = add_assign(result, add_usize(this.fields.writeable_length_hint(), 1));
    }
    return result;
  }

  write_to_parts(sink: PartsWrite): fmt_Result {
    return Writeable_write_to_parts(this, sink);
  }
  writeable_borrow(): string | undefined {
    return Writeable_writeable_borrow(this);
  }
  write_to_string(): string {
    return Writeable_write_to_string(this);
  }
  to_string(): string {
    return this.write_to_string();
  }

  /** `#[derive(PartialEq)]` */
  eq(other: Transform): boolean {
    const l =
      this.lang === undefined || other.lang === undefined ? this.lang === other.lang : this.lang.eq(other.lang);
    return l && this.fields.eq(other.fields);
  }
}
