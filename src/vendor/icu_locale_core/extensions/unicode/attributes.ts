// Port of icu_locale_core 2.3.0 `src/extensions/unicode/attributes.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: `ShortBoxSlice<Attribute>` is an `Attribute[]`.
import { Ok, type Result } from "../../../../std/result.ts";
import { utf8 } from "../../../../std/str.ts";
import { binary_search_by } from "../../../litemap/map.ts";
import { EachSubtagWriteable, each_subtag_writeable_borrow } from "../../helpers.ts";
import type { ParseError } from "../../parser/errors.ts";
import { SubtagIterator } from "../../parser/mod.ts";
import { Attribute } from "./attribute.ts";

/// A set of [`Attribute`] elements as defined in [`Unicode Extension Attributes`].
///
/// [`Unicode Extension Attributes`]: https://unicode.org/reports/tr35/tr35.html#u_Extension
// #[derive(Default, Debug, PartialEq, Eq, Clone, Hash, PartialOrd, Ord)]
export class Attributes extends EachSubtagWriteable {
  constructor(public _0: Attribute[]) {
    super();
  }

  /// Returns a new empty set of attributes. Same as [`default()`](Default::default()), but is `const`.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/attributes.rs:54 new
  static new(): Attributes {
    return new Attributes([]);
  }

  /// A constructor which takes a str slice, parses it and
  /// produces a well-formed [`Attributes`].
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/attributes.rs:64 try_from_str
  static try_from_str(s: string): Result<Attributes, ParseError> {
    return Attributes.try_from_utf8(utf8(s));
  }

  /// See [`Self::try_from_str`]
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/attributes.rs:72 try_from_utf8
  static try_from_utf8(code_units: Uint8Array): Result<Attributes, ParseError> {
    const iter = SubtagIterator.new(code_units);
    return Ok(Attributes.from_iter(iter));
  }

  /// A constructor which takes a pre-sorted list of [`Attribute`] elements.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/attributes.rs:99 from_vec_unchecked
  static from_vec_unchecked(input: Attribute[]): Attributes {
    return new Attributes(input);
  }

  /// Empties the [`Attributes`] list.
  ///
  /// Returns the old list.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/attributes.rs:124 clear
  clear(): Attributes {
    const old = this._0;
    this._0 = [];
    return new Attributes(old);
  }

  // crate: icu_locale_core-2.3.0/src/extensions/unicode/attributes.rs:129 from_iter
  static from_iter(iter: SubtagIterator): Attributes {
    const attributes: Attribute[] = [];

    for (let subtag = iter.peek(); subtag !== undefined; subtag = iter.peek()) {
      const attr = Attribute.try_from_utf8(subtag);
      if (attr.$ === "Ok") {
        const r = binary_search_by(attributes, (x) => x.cmp(attr._0));
        if (r.$ === "Err") {
          attributes.splice(r._0, 0, attr._0);
        }
      } else {
        break;
      }
      iter.next();
    }
    return new Attributes(attributes);
  }

  // crate: icu_locale_core-2.3.0/src/extensions/unicode/attributes.rs:145 for_each_subtag_str
  for_each_subtag_str<E>(f: (subtag: string) => Result<undefined, E>): Result<undefined, E> {
    for (const t of this.deref()) {
      const r = f(t.as_str());
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  }

  /// Extends the `Attributes` with values from  another `Attributes`.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/attributes.rs:167 extend_from_attributes
  extend_from_attributes(other: Attributes): void {
    for (const attr of other._0) {
      const r = binary_search_by(this._0, (x) => x.cmp(attr));
      if (r.$ === "Err") {
        this._0.splice(r._0, 0, attr);
      }
    }
  }

  // impl FromStr for Attributes
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/attributes.rs:182 from_str
  static from_str(s: string): Result<Attributes, ParseError> {
    return Attributes.try_from_str(s);
  }

  // impl_writeable_for_subtag_list!(Attributes, "foobar", "testing")
  override writeable_borrow(): string | undefined {
    return each_subtag_writeable_borrow(this._0.length === 1, () => this._0[0]!.as_str());
  }

  // impl Deref for Attributes
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/attributes.rs:192 deref
  deref(): readonly Attribute[] {
    return this._0;
  }

  is_empty(): boolean {
    return this._0.length === 0;
  }

  /** `#[derive(PartialEq)]` */
  eq(other: Attributes): boolean {
    return this._0.length === other._0.length && this._0.every((v, i) => v.eq(other._0[i]!));
  }
}
