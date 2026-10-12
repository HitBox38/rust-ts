// Port of icu_locale_core 2.3.0 `src/extensions/transform/fields.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import { Ok, type Result } from "../../../../std/result.ts";
import { LiteMap } from "../../../litemap/map.ts";
import { EachSubtagWriteable } from "../../helpers.ts";
import type { Key } from "./key.ts";
import type { Value } from "./value.ts";

const key_cmp = (a: Key, b: Key): -1 | 0 | 1 => a.cmp(b);

/// A list of [`Key`]-[`Value`] pairs representing functional information
/// about content transformations.
///
/// Here are examples of fields used in Unicode:
/// - `s0`, `d0` - Transform source/destination
/// - `t0` - Machine Translation
/// - `h0` - Hybrid Locale Identifiers
///
/// You can find the full list in [`Unicode BCP 47 T Extension`] section of LDML.
///
/// [`Unicode BCP 47 T Extension`]: https://unicode.org/reports/tr35/tr35.html#BCP47_T_Extension
// #[derive(Clone, PartialEq, Eq, Debug, Default, Hash, PartialOrd, Ord)]
export class Fields extends EachSubtagWriteable {
  constructor(public _0: LiteMap<Key, Value>) {
    super();
  }

  /// Returns a new empty list of key-value pairs. Same as [`default()`](Default::default()), but is `const`.
  // crate: icu_locale_core-2.3.0/src/extensions/transform/fields.rs:52 new
  static new(): Fields {
    return new Fields(LiteMap.new(key_cmp));
  }

  /// Returns `true` if there are no fields.
  // crate: icu_locale_core-2.3.0/src/extensions/transform/fields.rs:70 is_empty
  is_empty(): boolean {
    return this._0.is_empty();
  }

  /// Empties the [`Fields`] list.
  ///
  /// Returns the old list.
  // crate: icu_locale_core-2.3.0/src/extensions/transform/fields.rs:92 clear
  clear(): Fields {
    const old = this._0;
    this._0 = LiteMap.new(key_cmp);
    return new Fields(old);
  }

  /// Returns `true` if the list contains a [`Value`] for the specified [`Key`].
  // crate: icu_locale_core-2.3.0/src/extensions/transform/fields.rs:111 contains_key
  contains_key(key: Key): boolean {
    return this._0.contains_key(key);
  }

  /// Returns a reference to the [`Value`] corresponding to the [`Key`].
  // crate: icu_locale_core-2.3.0/src/extensions/transform/fields.rs:134 get
  get(key: Key): Value | undefined {
    return this._0.get(key);
  }

  /// Sets the specified keyword, returning the old value if it already existed.
  // crate: icu_locale_core-2.3.0/src/extensions/transform/fields.rs:164 set
  set(key: Key, value: Value): Value | undefined {
    return this._0.insert(key, value);
  }

  // crate-skip: icu_locale_core-2.3.0/src/extensions/transform/fields.rs:193 retain_by_key needs `LiteMap::retain` (not ported); unused on rustc's path

  // crate: icu_locale_core-2.3.0/src/extensions/transform/fields.rs:200 for_each_subtag_str
  for_each_subtag_str<E>(f: (subtag: string) => Result<undefined, E>): Result<undefined, E> {
    for (const [k, v] of this._0.iter()) {
      let r = f(k.as_str());
      if (r.$ === "Err") return r;
      r = v.for_each_subtag_str(f);
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  }

  // crate-skip: icu_locale_core-2.3.0/src/extensions/transform/fields.rs:213 from_tuple_vec #[cfg(test)] helper over `FromIterator` (not ported)

  // impl From<LiteMap<Key, Value>> for Fields
  // crate: icu_locale_core-2.3.0/src/extensions/transform/fields.rs:221 from
  static from(map: LiteMap<Key, Value>): Fields {
    return new Fields(map);
  }

  // crate-skip: icu_locale_core-2.3.0/src/extensions/transform/fields.rs:229 from_iter `LiteMap::from_iter` is not ported (test-only use)

  /** `#[derive(PartialEq)]` */
  eq(other: Fields): boolean {
    const a = this._0.iter();
    const b = other._0.iter();
    return a.length === b.length && a.every(([k, v], i) => k.eq(b[i]![0]) && v.eq(b[i]![1]));
  }
}
