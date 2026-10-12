// Port of icu_locale_core 2.3.0 `src/extensions/other/mod.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! Other Use Extensions is a list of extensions other than unicode,
//! transform or private.
//
// PORT: `ShortBoxSlice<Subtag>` is a `Subtag[]`.
import { is_ascii_alphanumeric } from "../../../../std/char.ts";
import { assert } from "../../../../std/panic.ts";
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
import { Subtag } from "../../subtags/mod.ts";
import { ExtensionType } from "../mod.ts";

/// A list of [`Other Use Extensions`] as defined in [`Unicode Locale
/// Identifier`] specification.
///
/// Those extensions are treated as a pass-through, and no Unicode related
/// behavior depends on them.
///
/// The main struct for this extension is [`Other`] which is a list of [`Subtag`]s.
///
/// [`Other Use Extensions`]: https://unicode.org/reports/tr35/#other_extensions
/// [`Unicode Locale Identifier`]: https://unicode.org/reports/tr35/#Unicode_locale_identifier
// #[derive(Clone, PartialEq, Eq, Debug, Default, Hash, PartialOrd, Ord)]
export class Other implements Writeable {
  constructor(
    // Safety invariant: must be ASCII
    public ext: number,
    public keys: Subtag[],
  ) {}

  /// A constructor which takes a str slice, parses it and
  /// produces a well-formed [`Other`].
  // crate: icu_locale_core-2.3.0/src/extensions/other/mod.rs:71 try_from_str
  static try_from_str(s: string): Result<Other, ParseError> {
    return Other.try_from_utf8(utf8(s));
  }

  /// See [`Self::try_from_str`]
  // crate: icu_locale_core-2.3.0/src/extensions/other/mod.rs:79 try_from_utf8
  static try_from_utf8(code_units: Uint8Array): Result<Other, ParseError> {
    const iter = SubtagIterator.new(code_units);

    const ext = iter.next();
    if (ext === undefined) return Err("InvalidExtension");
    const t = ExtensionType.try_from_byte_slice(ext);
    if (t.$ === "Err") return t;
    if (t._0.$ === "Other") {
      return Other.try_from_iter(t._0._0, iter);
    }

    return Err("InvalidExtension");
  }

  /// A constructor which takes a pre-sorted list of [`Subtag`].
  // crate: icu_locale_core-2.3.0/src/extensions/other/mod.rs:111 from_vec_unchecked
  static from_vec_unchecked(ext: number, keys: Subtag[]): Other {
    return Other.from_short_slice_unchecked(ext, keys);
  }

  // crate: icu_locale_core-2.3.0/src/extensions/other/mod.rs:116 from_short_slice_unchecked
  static from_short_slice_unchecked(ext: number, keys: Subtag[]): Other {
    assert(is_ascii_alphanumeric(ext), "assertion failed: ext.is_ascii_alphanumeric()");
    // Safety invariant upheld here: ext checked as ASCII above
    return new Other(ext, keys);
  }

  // crate: icu_locale_core-2.3.0/src/extensions/other/mod.rs:123 try_from_iter
  static try_from_iter(ext: number, iter: SubtagIterator): Result<Other, ParseError> {
    // debug_assert!(matches!(ExtensionType::try_from_byte(ext), Ok(ExtensionType::Other(_)),));

    const keys: Subtag[] = [];
    for (let subtag = iter.peek(); subtag !== undefined; subtag = iter.peek()) {
      if (!Subtag.valid_key(subtag)) {
        break;
      }
      const key = Subtag.try_from_utf8(subtag);
      if (key.$ === "Ok") {
        keys.push(key._0);
      }
      iter.next();
    }

    if (keys.length === 0) {
      return Err("InvalidExtension");
    } else {
      return Ok(Other.from_short_slice_unchecked(ext, keys));
    }
  }

  /// Gets the tag character for this extension as a &str.
  // crate: icu_locale_core-2.3.0/src/extensions/other/mod.rs:158 get_ext_str
  get_ext_str(): string {
    // debug_assert!(self.ext.is_ascii_alphanumeric());
    // Safety: from safety invariant on self.ext (that it is ASCII)
    return String.fromCharCode(this.ext);
  }

  /// Gets the tag character for this extension as a char.
  // crate: icu_locale_core-2.3.0/src/extensions/other/mod.rs:175 get_ext
  get_ext(): number {
    return this.ext;
  }

  /// Gets the tag character for this extension as a byte.
  // crate: icu_locale_core-2.3.0/src/extensions/other/mod.rs:190 get_ext_byte
  get_ext_byte(): number {
    return this.ext;
  }

  // crate: icu_locale_core-2.3.0/src/extensions/other/mod.rs:194 for_each_subtag_str
  for_each_subtag_str<E>(f: (subtag: string) => Result<undefined, E>, with_ext: boolean): Result<undefined, E> {
    if (this.keys.length === 0) {
      return Ok(undefined);
    }

    if (with_ext) {
      const r = f(this.get_ext_str());
      if (r.$ === "Err") return r;
    }
    for (const t of this.keys) {
      const r = f(t.as_str());
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  }

  // impl FromStr for Other
  // crate: icu_locale_core-2.3.0/src/extensions/other/mod.rs:215 from_str
  static from_str(s: string): Result<Other, ParseError> {
    return Other.try_from_str(s);
  }

  // impl writeable::Writeable for Other
  // crate: icu_locale_core-2.3.0/src/extensions/other/mod.rs:223 write_to
  write_to(sink: FmtWrite): fmt_Result {
    if (this.keys.length === 0) {
      return Ok(undefined);
    }
    let r = sink.write_str(this.get_ext_str());
    if (r.$ === "Err") return r;
    for (const key of this.keys) {
      r = sink.write_char(0x2d);
      if (r.$ === "Err") return r;
      r = key.write_to(sink);
      if (r.$ === "Err") return r;
    }

    return Ok(undefined);
  }

  // crate: icu_locale_core-2.3.0/src/extensions/other/mod.rs:236 writeable_length_hint
  writeable_length_hint(): LengthHint {
    if (this.keys.length === 0) {
      return LengthHint.exact(0);
    }
    let result = LengthHint.exact(1);
    for (const key of this.keys) {
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

  /** `#[derive(PartialEq)]` */
  eq(other: Other): boolean {
    return this.ext === other.ext && this.keys.length === other.keys.length && this.keys.every((v, i) => v.eq(other.keys[i]!));
  }

  /** `#[derive(Ord)]`: `ext`, then `keys` lexicographically. */
  cmp(other: Other): -1 | 0 | 1 {
    if (this.ext !== other.ext) return this.ext < other.ext ? -1 : 1;
    const n = Math.min(this.keys.length, other.keys.length);
    for (let i = 0; i < n; i++) {
      const c = this.keys[i]!.cmp(other.keys[i]!);
      if (c !== 0) return c;
    }
    return this.keys.length === other.keys.length ? 0 : this.keys.length < other.keys.length ? -1 : 1;
  }
}
