// Port of icu_locale_core 2.3.0 `src/extensions/unicode/keywords.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import { Ok, type Result } from "../../../../std/result.ts";
import { utf8 } from "../../../../std/str.ts";
import { LiteMap } from "../../../litemap/map.ts";
import { cmp_utf8, type Ordering } from "../../../writeable/cmp.ts";
import { EachSubtagWriteable } from "../../helpers.ts";
import type { ParseError } from "../../parser/errors.ts";
import { SubtagIterator } from "../../parser/mod.ts";
import type { Subtag } from "../../subtags/mod.ts";
import { Key } from "./key.ts";
import { Value } from "./value.ts";

const key_cmp = (a: Key, b: Key): Ordering => a.cmp(b);

/// A list of [`Key`]-[`Value`] pairs representing functional information
/// about locale's internationalization preferences.
///
/// Here are examples of fields used in Unicode:
/// - `hc` - Hour Cycle (`h11`, `h12`, `h23`, `h24`)
/// - `ca` - Calendar (`buddhist`, `gregory`, ...)
/// - `fw` - First Day Of the Week (`sun`, `mon`, `sat`, ...)
///
/// You can find the full list in [`Unicode BCP 47 U Extension`] section of LDML.
///
/// [`Unicode BCP 47 U Extension`]: https://unicode.org/reports/tr35/tr35.html#Key_And_Type_Definitions_
// #[derive(Clone, PartialEq, Eq, Debug, Default, Hash, PartialOrd, Ord)]
export class Keywords extends EachSubtagWriteable {
  constructor(public _0: LiteMap<Key, Value>) {
    super();
  }

  /// Returns a new empty list of key-value pairs. Same as [`default()`](Default::default()), but is `const`.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:85 new
  static new(): Keywords {
    return new Keywords(LiteMap.new(key_cmp));
  }

  /// Create a new list of key-value pairs having exactly one pair, callable in a `const` context.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:91 new_single
  static new_single(key: Key, value: Value): Keywords {
    return new Keywords(LiteMap.from_sorted_store_unchecked([[key, value]], key_cmp));
  }

  /// A constructor which takes a str slice, parses it and
  /// produces a well-formed [`Keywords`].
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:103 try_from_str
  static try_from_str(s: string): Result<Keywords, ParseError> {
    return Keywords.try_from_utf8(utf8(s));
  }

  /// See [`Self::try_from_str`]
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:111 try_from_utf8
  static try_from_utf8(code_units: Uint8Array): Result<Keywords, ParseError> {
    const iter = SubtagIterator.new(code_units);
    return Keywords.try_from_iter(iter);
  }

  /// Returns `true` if there are no keywords.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:130 is_empty
  is_empty(): boolean {
    return this._0.is_empty();
  }

  /// Returns `true` if the list contains a [`Value`] for the specified [`Key`].
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:148 contains_key
  contains_key(key: Key): boolean {
    return this._0.contains_key(key);
  }

  /// Returns a reference to the [`Value`] corresponding to the [`Key`].
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:170 get
  get(key: Key): Value | undefined {
    return this._0.get(key);
  }

  /// Returns a mutable reference to the [`Value`] corresponding to the [`Key`].
  ///
  /// Returns `None` if the key doesn't exist or if the key has no value.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:199 get_mut
  get_mut(key: Key): Value | undefined {
    return this._0.get(key);
  }

  /// Sets the specified keyword, returning the old value if it already existed.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:230 set
  set(key: Key, value: Value): Value | undefined {
    return this._0.insert(key, value);
  }

  /// Removes the specified keyword, returning the old value if it existed.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:251 remove
  remove(key: Key): Value | undefined {
    return this._0.remove(key);
  }

  /// Clears all Unicode extension keywords, leaving Unicode attributes.
  ///
  /// Returns the old Unicode extension keywords.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:268 clear
  clear(): Keywords {
    const old = this._0;
    this._0 = LiteMap.new(key_cmp);
    return new Keywords(old);
  }

  // crate-skip: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:297 retain_by_key needs `LiteMap::retain` (not ported); unused on rustc's path

  /// Compare this [`Keywords`] with BCP-47 bytes.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:335 strict_cmp
  strict_cmp(other: Uint8Array): Ordering {
    return cmp_utf8(this, other);
  }

  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:340 try_from_iter
  static try_from_iter(iter: SubtagIterator): Result<Keywords, ParseError> {
    const keywords = LiteMap.new<Key, Value>(key_cmp);

    let current_keyword: Key | undefined = undefined;
    let current_value: Subtag[] = [];

    for (let subtag = iter.peek(); subtag !== undefined; subtag = iter.peek()) {
      const slen = subtag.length;
      if (slen === 2) {
        if (current_keyword !== undefined) {
          const kw = current_keyword;
          current_keyword = undefined;
          keywords.try_insert(kw, Value.from_short_slice_unchecked(current_value));
          current_value = [];
        }
        const k = Key.try_from_utf8(subtag);
        if (k.$ === "Err") return k;
        current_keyword = k._0;
      } else if (current_keyword !== undefined) {
        const r = Value.parse_subtag_from_utf8(subtag);
        if (r.$ === "Ok") {
          if (r._0 !== undefined) current_value.push(r._0);
        } else {
          break;
        }
      } else {
        break;
      }
      iter.next();
    }

    if (current_keyword !== undefined) {
      const kw = current_keyword;
      current_keyword = undefined;
      keywords.try_insert(kw, Value.from_short_slice_unchecked(current_value));
    }

    return Ok(Keywords.from(keywords));
  }

  /// Produce an ordered iterator over key-value pairs
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:374 iter
  iter(): readonly [Key, Value][] {
    return this._0.iter();
  }

  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:378 for_each_subtag_str
  for_each_subtag_str<E>(f: (subtag: string) => Result<undefined, E>): Result<undefined, E> {
    for (const [k, v] of this._0.iter()) {
      let r = f(k.as_str());
      if (r.$ === "Err") return r;
      r = v.for_each_subtag_str(f);
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  }

  /// Extends the `Keywords` with values from  another `Keywords`.
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:404 extend_from_keywords
  extend_from_keywords(other: Keywords): void {
    for (const [key, value] of other._0.iter()) {
      this._0.insert(key, value);
    }
  }

  // crate-skip: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:412 from_tuple_vec #[cfg(test)] helper over `FromIterator` (not ported)

  // impl From<LiteMap<Key, Value, ShortBoxSlice<(Key, Value)>>> for Keywords
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:418 from
  static from(map: LiteMap<Key, Value>): Keywords {
    return new Keywords(map);
  }

  // crate-skip: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:426 from_iter `LiteMap::from_iter` is not ported (test-only use)

  // impl FromStr for Keywords
  // crate: icu_locale_core-2.3.0/src/extensions/unicode/keywords.rs:437 from_str
  static from_str(s: string): Result<Keywords, ParseError> {
    return Keywords.try_from_str(s);
  }

  /** `#[derive(PartialEq)]` */
  eq(other: Keywords): boolean {
    const a = this._0.iter();
    const b = other._0.iter();
    return a.length === b.length && a.every(([k, v], i) => k.eq(b[i]![0]) && v.eq(b[i]![1]));
  }
}
