// Port of icu_locale_core 2.3.0 `src/extensions/transform/value.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: `ShortBoxSlice<Subtag>` is a `Subtag[]`.
import { is_ascii_alphanumeric } from "../../../../std/char.ts";
import { Err, Ok, type Result } from "../../../../std/result.ts";
import { utf8 } from "../../../../std/str.ts";
import { EachSubtagWriteable, each_subtag_writeable_borrow } from "../../helpers.ts";
import type { ParseError } from "../../parser/errors.ts";
import { SubtagIterator } from "../../parser/mod.ts";
import { Subtag, subtag } from "../../subtags/mod.ts";

/// A value used in a list of [`Fields`](super::Fields).
///
/// The value has to be a sequence of one or more alphanumerical strings
/// separated by `-`.
/// Each part of the sequence has to be no shorter than three characters and no
/// longer than 8.
// #[derive(Debug, PartialEq, Eq, Clone, Hash, PartialOrd, Ord, Default)]
export class Value extends EachSubtagWriteable {
  constructor(public _0: Subtag[]) {
    super();
  }

  /// A constructor which takes a str slice, parses it and
  /// produces a well-formed [`Value`].
  // crate: icu_locale_core-2.3.0/src/extensions/transform/value.rs:54 try_from_str
  static try_from_str(s: string): Result<Value, ParseError> {
    return Value.try_from_utf8(utf8(s));
  }

  /// See [`Self::try_from_str`]
  // crate: icu_locale_core-2.3.0/src/extensions/transform/value.rs:62 try_from_utf8
  static try_from_utf8(code_units: Uint8Array): Result<Value, ParseError> {
    const v: Subtag[] = [];
    let has_value = false;

    for (const subtag of SubtagIterator.new(code_units)) {
      if (!Value.is_type_subtag(subtag)) {
        return Err("InvalidExtension");
      }
      has_value = true;
      const val = Subtag.try_from_utf8(subtag);
      if (val.$ === "Err") return Err("InvalidExtension");
      if (!val._0.eq(TRUE_TVALUE())) {
        v.push(val._0);
      }
    }

    if (!has_value) {
      return Err("InvalidExtension");
    }
    return Ok(new Value(v));
  }

  // crate: icu_locale_core-2.3.0/src/extensions/transform/value.rs:84 from_short_slice_unchecked
  static from_short_slice_unchecked(input: Subtag[]): Value {
    return new Value(input);
  }

  // crate: icu_locale_core-2.3.0/src/extensions/transform/value.rs:89 is_type_subtag
  static is_type_subtag(t: Uint8Array): boolean {
    return TYPE_LENGTH_START <= t.length && t.length <= TYPE_LENGTH_END && t.every(is_ascii_alphanumeric);
  }

  // crate: icu_locale_core-2.3.0/src/extensions/transform/value.rs:94 parse_subtag
  static parse_subtag(t: Uint8Array): Result<Subtag | undefined, ParseError> {
    if (!(TYPE_LENGTH_START <= t.length && t.length <= TYPE_LENGTH_END)) {
      return Err("InvalidExtension");
    }
    const r = Subtag.try_from_utf8(t);
    if (r.$ === "Err") return Err("InvalidSubtag");

    const s = r._0.to_ascii_lowercase();

    if (s.eq(TRUE_TVALUE())) {
      return Ok(undefined);
    } else {
      return Ok(s);
    }
  }

  // crate: icu_locale_core-2.3.0/src/extensions/transform/value.rs:109 for_each_subtag_str
  for_each_subtag_str<E>(f: (subtag: string) => Result<undefined, E>): Result<undefined, E> {
    if (this._0.length === 0) {
      const r = f(TRUE_TVALUE().as_str());
      if (r.$ === "Err") return r;
    } else {
      for (const s of this._0) {
        const r = f(s.as_str());
        if (r.$ === "Err") return r;
      }
    }
    return Ok(undefined);
  }

  // impl FromStr for Value
  // crate: icu_locale_core-2.3.0/src/extensions/transform/value.rs:128 from_str
  static from_str(s: string): Result<Value, ParseError> {
    return Value.try_from_str(s);
  }

  // impl_writeable_for_each_subtag_str_no_test!(Value, selff, selff.0.is_empty() => Some("true"))
  override writeable_borrow(): string | undefined {
    return each_subtag_writeable_borrow(this._0.length === 0, () => "true");
  }

  /** `#[derive(PartialEq)]` */
  eq(other: Value): boolean {
    return this._0.length === other._0.length && this._0.every((v, i) => v.eq(other._0[i]!));
  }
}

// const TYPE_LENGTH: RangeInclusive<usize> = 3..=8;
const TYPE_LENGTH_START = 3;
const TYPE_LENGTH_END = 8;
// const TRUE_TVALUE: Subtag = subtag!("true");
let TRUE_TVALUE_: Subtag | undefined;
function TRUE_TVALUE(): Subtag {
  return (TRUE_TVALUE_ ??= subtag("true"));
}
