// Port of icu_locale_core 2.3.0 `src/extensions/private/mod.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! Private Use Extensions is a list of extensions intended for
//! private use.
//!
//! Those extensions are treated as a pass-through, and no Unicode related
//! behavior depends on them.
//
// PORT: `ShortBoxSlice<Subtag>` is a `Subtag[]`.
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
import { Subtag } from "./other.ts";

// mod other;
export { Subtag, subtag } from "./other.ts";

export const PRIVATE_EXT_CHAR = 0x78; // 'x'
export const PRIVATE_EXT_STR = "x";

/// A list of [`Private Use Extensions`] as defined in [`Unicode Locale
/// Identifier`] specification.
///
/// Those extensions are treated as a pass-through, and no Unicode related
/// behavior depends on them.
///
/// [`Private Use Extensions`]: https://unicode.org/reports/tr35/#pu_extensions
/// [`Unicode Locale Identifier`]: https://unicode.org/reports/tr35/#Unicode_locale_identifier
// #[derive(Clone, PartialEq, Eq, Debug, Default, Hash, PartialOrd, Ord)]
export class Private implements Writeable {
  constructor(public _0: Subtag[]) {}

  /// Returns a new empty list of private-use extensions. Same as [`default()`](Default::default()), but is `const`.
  // crate: icu_locale_core-2.3.0/src/extensions/private/mod.rs:86 new
  static new(): Private {
    return new Private([]);
  }

  /// A constructor which takes a str slice, parses it and
  /// produces a well-formed [`Private`].
  // crate: icu_locale_core-2.3.0/src/extensions/private/mod.rs:96 try_from_str
  static try_from_str(s: string): Result<Private, ParseError> {
    return Private.try_from_utf8(utf8(s));
  }

  /// See [`Self::try_from_str`]
  // crate: icu_locale_core-2.3.0/src/extensions/private/mod.rs:104 try_from_utf8
  static try_from_utf8(code_units: Uint8Array): Result<Private, ParseError> {
    const iter = SubtagIterator.new(code_units);

    const ext = iter.next();
    if (ext === undefined) return Err("InvalidExtension");
    const t = ExtensionType.try_from_byte_slice(ext);
    if (t.$ === "Err") return t;
    if (t._0.$ === "Private") {
      return Private.try_from_iter(iter);
    }

    return Err("InvalidExtension");
  }

  /// A constructor which takes a pre-sorted list of [`Subtag`].
  // crate: icu_locale_core-2.3.0/src/extensions/private/mod.rs:131 from_vec_unchecked
  static from_vec_unchecked(input: Subtag[]): Private {
    return new Private(input);
  }

  /// A constructor which takes a single [`Subtag`].
  // crate: icu_locale_core-2.3.0/src/extensions/private/mod.rs:147 new_single
  static new_single(input: Subtag): Private {
    return new Private([input]);
  }

  /// Empties the [`Private`] list.
  // crate: icu_locale_core-2.3.0/src/extensions/private/mod.rs:168 clear
  clear(): void {
    this._0 = [];
  }

  // crate: icu_locale_core-2.3.0/src/extensions/private/mod.rs:173 try_from_iter
  static try_from_iter(iter: SubtagIterator): Result<Private, ParseError> {
    // `iter.map(Subtag::try_from_utf8).collect::<Result<ShortBoxSlice<_>, _>>()?`
    const keys: Subtag[] = [];
    for (const s of iter) {
      const r = Subtag.try_from_utf8(s);
      if (r.$ === "Err") return r;
      keys.push(r._0);
    }

    if (keys.length === 0) {
      return Err("InvalidExtension");
    } else {
      return Ok(new Private(keys));
    }
  }

  // crate: icu_locale_core-2.3.0/src/extensions/private/mod.rs:185 for_each_subtag_str
  for_each_subtag_str<E>(f: (subtag: string) => Result<undefined, E>, with_ext: boolean): Result<undefined, E> {
    if (this.is_empty()) {
      return Ok(undefined);
    }
    if (with_ext) {
      const r = f(PRIVATE_EXT_STR);
      if (r.$ === "Err") return r;
    }
    for (const t of this.deref()) {
      const r = f(t.as_str());
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  }

  // impl FromStr for Private
  // crate: icu_locale_core-2.3.0/src/extensions/private/mod.rs:205 from_str
  static from_str(s: string): Result<Private, ParseError> {
    return Private.try_from_str(s);
  }

  // impl writeable::Writeable for Private
  // crate: icu_locale_core-2.3.0/src/extensions/private/mod.rs:213 write_to
  write_to(sink: FmtWrite): fmt_Result {
    if (this.is_empty()) {
      return Ok(undefined);
    }
    let r = sink.write_char(PRIVATE_EXT_CHAR);
    if (r.$ === "Err") return r;
    for (const key of this.deref()) {
      r = sink.write_char(0x2d);
      if (r.$ === "Err") return r;
      r = key.write_to(sink);
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  }

  // crate: icu_locale_core-2.3.0/src/extensions/private/mod.rs:225 writeable_length_hint
  writeable_length_hint(): LengthHint {
    if (this.is_empty()) {
      return LengthHint.exact(0);
    }
    let result = LengthHint.exact(1);
    for (const key of this.deref()) {
      result = add_assign(result, add_usize(key.writeable_length_hint(), 1));
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

  // impl Deref for Private
  // crate: icu_locale_core-2.3.0/src/extensions/private/mod.rs:240 deref
  deref(): readonly Subtag[] {
    return this._0;
  }

  is_empty(): boolean {
    return this._0.length === 0;
  }

  /** `#[derive(PartialEq)]` */
  eq(other: Private): boolean {
    return this._0.length === other._0.length && this._0.every((v, i) => v.eq(other._0[i]!));
  }
}
