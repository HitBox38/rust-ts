// Port of icu_locale_core 2.3.0 `src/extensions/unicode/value.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: `ShortBoxSlice<Subtag>` is a `Subtag[]`.
import { panic } from "../../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../../std/result.ts";
import { utf8 } from "../../../../std/str.ts";
import { cmp_utf8 } from "../../../writeable/cmp.ts";
import { EachSubtagWriteable, each_subtag_writeable_borrow } from "../../helpers.ts";
import type { ParseError } from "../../parser/errors.ts";
import { SubtagIterator } from "../../parser/mod.ts";
import { Subtag, subtag } from "../../subtags/mod.ts";

/// A value used in a list of [`Keywords`](super::Keywords).
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
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:60 try_from_str
  static try_from_str(s: string): Result<Value, ParseError> {
    return Value.try_from_utf8(utf8(s));
  }

  /// See [`Self::try_from_str`]
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:65 try_from_utf8
  static try_from_utf8(code_units: Uint8Array): Result<Value, ParseError> {
    const v: Subtag[] = [];

    if (code_units.length !== 0) {
      for (const chunk of SubtagIterator.new(code_units)) {
        const r = Subtag.try_from_utf8(chunk);
        if (r.$ === "Err") return r;
        const subtag = r._0;
        if (!subtag.eq(TRUE_VALUE())) {
          v.push(subtag);
        }
      }
    }
    return Ok(new Value(v));
  }

  /// Returns a reference to a single [`Subtag`] if the [`Value`] contains exactly one
  /// subtag, or `None` otherwise.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:103 as_single_subtag
  as_single_subtag(): Subtag | undefined {
    return this._0.length === 1 ? this._0[0] : undefined;
  }

  /// Destructs into a single [`Subtag`] if the [`Value`] contains exactly one
  /// subtag, or returns `None` otherwise.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:122 into_single_subtag
  into_single_subtag(): Subtag | undefined {
    return this._0.length === 1 ? this._0[0] : undefined;
  }

  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:127 as_subtags_slice
  as_subtags_slice(): readonly Subtag[] {
    return this._0;
  }

  /// Appends a subtag to the back of a [`Value`].
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:148 push_subtag
  push_subtag(subtag: Subtag): void {
    if (!subtag.eq(TRUE_VALUE())) {
      this._0.push(subtag);
    }
  }

  /// Returns the number of subtags in the [`Value`].
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:166 subtag_count
  subtag_count(): number {
    return this._0.length;
  }

  /// Creates an empty [`Value`], which corresponds to a "true" value.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:179 new_empty
  static new_empty(): Value {
    return new Value([]);
  }

  /// Returns `true` if the Value has no subtags.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:193 is_empty
  is_empty(): boolean {
    return this._0.length === 0;
  }

  /// Removes and returns the subtag at position `index` within the value,
  /// shifting all subtags after it to the left.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:212 remove_subtag
  remove_subtag(idx: number): Subtag | undefined {
    if (this._0.length < idx) {
      return undefined;
    } else {
      // `ShortBoxSlice::remove` panics on an out-of-bounds index (idx == len)
      if (idx >= this._0.length) panic(`removal index (is ${idx}) should be < len (is ${this._0.length})`);
      const item = this._0.splice(idx, 1)[0]!;
      return item;
    }
  }

  /// Returns a reference to a subtag at index.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:235 get_subtag
  get_subtag(idx: number): Subtag | undefined {
    return this._0[idx];
  }

  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:240 from_subtag
  static from_subtag(subtag: Subtag | undefined): Value {
    if (subtag === undefined || subtag.eq(TRUE_VALUE())) {
      return new Value([]);
    }
    return new Value([subtag]);
  }

  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:248 from_two_subtags
  static from_two_subtags(f: Subtag, s: Subtag): Value {
    return new Value([f, s]);
  }

  /// A constructor which takes a pre-sorted list of [`Value`] elements.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:275 from_vec_unchecked
  static from_vec_unchecked(input: Subtag[]): Value {
    return new Value(input);
  }

  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:280 from_short_slice_unchecked
  static from_short_slice_unchecked(input: Subtag[]): Value {
    return new Value(input);
  }

  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:284 parse_subtag_from_utf8
  static parse_subtag_from_utf8(t: Uint8Array): Result<Subtag | undefined, ParseError> {
    const r = Subtag.try_from_utf8(t);
    if (r.$ === "Ok") {
      if (r._0.eq(TRUE_VALUE())) return Ok(undefined);
      return Ok(r._0);
    }
    return Err("InvalidSubtag");
  }

  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:292 for_each_subtag_str
  for_each_subtag_str<E>(f: (subtag: string) => Result<undefined, E>): Result<undefined, E> {
    for (const s of this._0) {
      const r = f(s.as_str());
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  }

  // impl IntoIterator for Value
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:305 into_iter
  into_iter(): Subtag[] {
    return this._0;
  }

  // impl FromIterator<Subtag> for Value
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:313 from_iter
  static from_iter(iter: Iterable<Subtag>): Value {
    return new Value([...iter]);
  }

  // impl Extend<Subtag> for Value
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:321 extend
  extend(iter: Iterable<Subtag>): void {
    for (const i of iter) {
      this._0.push(i);
    }
  }

  // impl FromStr for Value
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:334 from_str
  static from_str(s: string): Result<Value, ParseError> {
    return Value.try_from_str(s);
  }

  // impl PartialEq<&str> for Value
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/value.rs:340 eq
  eq_str(other: string): boolean {
    return cmp_utf8(this, utf8(other)) === 0;
  }

  // impl_writeable_for_subtag_list!(Value, "islamic", "civil")
  override writeable_borrow(): string | undefined {
    return each_subtag_writeable_borrow(this._0.length === 1, () => this._0[0]!.as_str());
  }

  /** `#[derive(PartialEq)]` */
  eq(other: Value): boolean {
    return this._0.length === other._0.length && this._0.every((v, i) => v.eq(other._0[i]!));
  }

  /** `#[derive(Ord)]` */
  cmp(other: Value): -1 | 0 | 1 {
    const n = Math.min(this._0.length, other._0.length);
    for (let i = 0; i < n; i++) {
      const c = this._0[i]!.cmp(other._0[i]!);
      if (c !== 0) return c;
    }
    return this._0.length === other._0.length ? 0 : this._0.length < other._0.length ? -1 : 1;
  }
}

// const TRUE_VALUE: Subtag = subtag!("true");
// PORT: a function, so module evaluation order does not matter.
let TRUE_VALUE_: Subtag | undefined;
function TRUE_VALUE(): Subtag {
  return (TRUE_VALUE_ ??= subtag("true"));
}

/** `value!("..")` (`extensions_unicode_value!`) */
export function value(s: string): Value {
  const r = Subtag.try_from_utf8(utf8(s));
  if (r.$ === "Ok") return Value.from_subtag(r._0);
  return panic(`Invalid Unicode extension value: ${s}`);
}
