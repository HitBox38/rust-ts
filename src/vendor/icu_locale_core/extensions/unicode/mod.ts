// Port of icu_locale_core 2.3.0 `src/extensions/unicode/mod.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! Unicode Extensions provide information about user preferences in a given locale.
//!
//! The main struct for this extension is [`Unicode`] which contains [`Keywords`] and
//! [`Attributes`].
import { Err, Ok, type Result } from "../../../../std/result.ts";
import { utf8 } from "../../../../std/str.ts";
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
import type { ParseError } from "../../parser/errors.ts";
import { SubtagIterator } from "../../parser/mod.ts";
import { ExtensionType } from "../mod.ts";
import { Attributes } from "./attributes.ts";
import { Keywords } from "./keywords.ts";

// mod attribute; mod attributes; mod key; mod keywords; mod subdivision; mod value;
export { Attribute, attribute } from "./attribute.ts";
export { Attributes } from "./attributes.ts";
export { Key, key } from "./key.ts";
export { Keywords } from "./keywords.ts";
export { SubdivisionId, SubdivisionSuffix, subdivision_suffix } from "./subdivision.ts";
export { Value, value } from "./value.ts";

export const UNICODE_EXT_CHAR = 0x75; // 'u'
export const UNICODE_EXT_STR = "u";

/// Unicode Extensions provide information about user preferences in a given locale.
///
/// A list of [`Unicode BCP47 U Extensions`] as defined in [`Unicode Locale
/// Identifier`] specification.
///
/// Unicode extensions provide subtags that specify language and/or locale-based behavior
/// or refinements to language tags, according to work done by the Unicode Consortium.
/// (See [`RFC 6067`] for details).
///
/// [`Unicode BCP47 U Extensions`]: https://unicode.org/reports/tr35/#u_Extension
/// [`RFC 6067`]: https://www.ietf.org/rfc/rfc6067.txt
/// [`Unicode Locale Identifier`]: https://unicode.org/reports/tr35/#Unicode_locale_identifier
// #[derive(Clone, PartialEq, Eq, Debug, Default, Hash)]
export class Unicode implements Writeable {
  constructor(
    /// The key-value pairs present in this locale extension, with each extension key subtag
    /// associated to its provided value subtag.
    public keywords: Keywords,
    /// A canonically ordered sequence of single standalone subtags for this locale extension.
    public attributes: Attributes,
  ) {}

  /// Returns a new empty map of Unicode extensions. Same as [`default()`](Default::default()), but is `const`.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/mod.rs:110 new
  static new(): Unicode {
    return new Unicode(Keywords.new(), Attributes.new());
  }

  /// A constructor which takes a str slice, parses it and
  /// produces a well-formed [`Unicode`].
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/mod.rs:123 try_from_str
  static try_from_str(s: string): Result<Unicode, ParseError> {
    return Unicode.try_from_utf8(utf8(s));
  }

  /// See [`Self::try_from_str`]
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/mod.rs:131 try_from_utf8
  static try_from_utf8(code_units: Uint8Array): Result<Unicode, ParseError> {
    const iter = SubtagIterator.new(code_units);

    const ext = iter.next();
    if (ext === undefined) return Err("InvalidExtension");
    const t = ExtensionType.try_from_byte_slice(ext);
    if (t.$ === "Err") return t;
    if (t._0.$ === "Unicode") {
      return Unicode.try_from_iter(iter);
    }

    return Err("InvalidExtension");
  }

  /// Returns [`true`] if there list of keywords and attributes is empty.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/mod.rs:153 is_empty
  is_empty(): boolean {
    return this.keywords.is_empty() && this.attributes.is_empty();
  }

  /// Clears all Unicode extension keywords and attributes, effectively removing
  /// the Unicode extension.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/mod.rs:170 clear
  clear(): void {
    this.keywords.clear();
    this.attributes.clear();
  }

  // crate-skip: icu_locale_core-2.3.0/src/extensions/unicode/mod.rs:175 as_tuple only used by `total_cmp` (not ported)
  // crate-skip: icu_locale_core-2.3.0/src/extensions/unicode/mod.rs:185 total_cmp derived `Ord` over Attributes/Keywords not ported; unused on rustc's path

  // crate: icu_locale_core-2.3.0/src/extensions/unicode/mod.rs:190 try_from_iter
  static try_from_iter(iter: SubtagIterator): Result<Unicode, ParseError> {
    const attributes = Attributes.from_iter(iter);
    const keywords = Keywords.try_from_iter(iter);
    if (keywords.$ === "Err") return keywords;

    // Ensure we've defined at least one attribute or keyword
    if (attributes.is_empty() && keywords._0.is_empty()) {
      return Err("InvalidExtension");
    }

    return Ok(new Unicode(keywords._0, attributes));
  }

  // crate: icu_locale_core-2.3.0/src/extensions/unicode/mod.rs:205 for_each_subtag_str
  for_each_subtag_str<E>(f: (subtag: string) => Result<undefined, E>, with_ext: boolean): Result<undefined, E> {
    if (!this.is_empty()) {
      if (with_ext) {
        const r = f(UNICODE_EXT_STR);
        if (r.$ === "Err") return r;
      }
      let r = this.attributes.for_each_subtag_str(f);
      if (r.$ === "Err") return r;
      r = this.keywords.for_each_subtag_str(f);
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  }

  /// Extends the `Unicode` with values from another `Unicode`.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/mod.rs:234 extend
  extend(other: Unicode): void {
    this.keywords.extend_from_keywords(other.keywords);
    this.attributes.extend_from_attributes(other.attributes);
  }

  // impl FromStr for Unicode
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/mod.rs:246 from_str
  static from_str(s: string): Result<Unicode, ParseError> {
    return Unicode.try_from_str(s);
  }

  // impl writeable::Writeable for Unicode
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/mod.rs:254 write_to
  write_to(sink: FmtWrite): fmt_Result {
    let r = sink.write_char(UNICODE_EXT_CHAR);
    if (r.$ === "Err") return r;

    if (!this.attributes.is_empty()) {
      r = sink.write_char(0x2d);
      if (r.$ === "Err") return r;
      r = this.attributes.write_to(sink);
      if (r.$ === "Err") return r;
    }
    if (!this.keywords.is_empty()) {
      r = sink.write_char(0x2d);
      if (r.$ === "Err") return r;
      r = this.keywords.write_to(sink);
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  }

  // crate: icu_locale_core-2.3.0/src/extensions/unicode/mod.rs:268 writeable_length_hint
  writeable_length_hint(): LengthHint {
    if (this.is_empty()) {
      return LengthHint.exact(0);
    }
    let result = LengthHint.exact(1);
    if (!this.attributes.is_empty()) {
      result = add_assign(result, add_usize(this.attributes.writeable_length_hint(), 1));
    }
    if (!this.keywords.is_empty()) {
      result = add_assign(result, add_usize(this.keywords.writeable_length_hint(), 1));
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
  /** `impl_display_with_writeable!` */
  to_string(): string {
    return this.write_to_string();
  }

  /** `#[derive(PartialEq)]` */
  eq(other: Unicode): boolean {
    return this.keywords.eq(other.keywords) && this.attributes.eq(other.attributes);
  }
}


