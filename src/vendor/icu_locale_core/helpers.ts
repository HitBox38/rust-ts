// Port of icu_locale_core 2.3.0 `src/helpers.rs`: the `impl_tinystr_subtag!`,
// `impl_writeable_for_each_subtag_str_no_test!`, `impl_writeable_for_subtag_list!` and
// `impl_writeable_for_key_value!` macros.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: `impl_tinystr_subtag!` defines a newtype over `TinyAsciiStr<$len_end>` per subtag type.
// Here every subtag class extends `TinystrSubtag` (the shared instance methods, one marker each)
// and passes its macro arguments as a `TinystrSubtagSpec` to the shared associated functions.
// `impl_writeable_for_each_subtag_str_no_test!` is the `each_subtag_*` functions, taking the
// type's `for_each_subtag_str` as a closure.
import { panic } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { utf8, utf8_len } from "../../std/str.ts";
import { TinyAsciiStr } from "../tinystr/ascii.ts";
import { cmp_bytes, type Ordering } from "../writeable/cmp.ts";
import {
  type FmtWrite,
  type fmt_Result,
  LengthHint,
  type PartsWrite,
  type Writeable,
  Writeable_write_to_parts,
  Writeable_write_to_string,
} from "../writeable/lib.ts";
import { add_assign_usize } from "../writeable/ops.ts";
import type { ParseError } from "./parser/errors.ts";

/** The arguments of one `impl_tinystr_subtag!` invocation. */
export interface TinystrSubtagSpec<T> {
  /** `$($path::)+ $name`, for the macro's panic message. */
  readonly path: string;
  readonly len_start: number;
  readonly len_end: number;
  readonly validate: (s: TinyAsciiStr) => boolean;
  readonly normalize: (s: TinyAsciiStr) => TinyAsciiStr;
  readonly is_normalized: (s: TinyAsciiStr) => boolean;
  readonly error: ParseError;
  /** The tuple-struct constructor `Self(..)`. */
  readonly make: (s: TinyAsciiStr) => T;
}

/// A parser for a subtag; see the type's documentation.
// crate: icu_locale_core-2.3.0/src/helpers.rs:39 try_from_str
export function subtag_try_from_str<T>(spec: TinystrSubtagSpec<T>, s: string): Result<T, ParseError> {
  return subtag_try_from_utf8(spec, utf8(s));
}

/// See [`Self::try_from_str`]
// crate: icu_locale_core-2.3.0/src/helpers.rs:44 try_from_utf8
export function subtag_try_from_utf8<T>(spec: TinystrSubtagSpec<T>, code_units: Uint8Array): Result<T, ParseError> {
  if (code_units.length < spec.len_start || code_units.length > spec.len_end) {
    return Err(spec.error);
  }

  const r = TinyAsciiStr.try_from_utf8(spec.len_end, code_units);
  if (r.$ === "Ok" && spec.validate(r._0)) {
    return Ok(spec.make(spec.normalize(r._0)));
  }
  return Err(spec.error);
}

// crate-skip: icu_locale_core-2.3.0/src/helpers.rs:60 try_from_raw needs `TinyAsciiStr::try_from_raw` (not ported); unused on rustc's path

/// Unsafely creates a subtag from its raw format
/// as returned by `Self::into_raw`. Unlike `Self::try_from_raw`,
/// this constructor only takes normalized values.
// crate: icu_locale_core-2.3.0/src/helpers.rs:82 from_raw_unchecked
export function subtag_from_raw_unchecked<T>(spec: TinystrSubtagSpec<T>, v: Uint8Array): T {
  return spec.make(TinyAsciiStr.from_utf8_unchecked(v));
}

/** The `$internal_macro_name!` macro (`language!("en")`, ...): `try_from_utf8` or panic. */
export function subtag_macro<T>(spec: TinystrSubtagSpec<T>, s: string): T {
  const r = subtag_try_from_utf8(spec, utf8(s));
  if (r.$ === "Ok") return r._0;
  return panic(`Invalid ${spec.path}: ${s}`);
}

/** The shared instance methods of every `impl_tinystr_subtag!` type. */
// #[derive(Debug, PartialEq, Eq, Clone, Hash, PartialOrd, Ord, Copy)] #[repr(transparent)]
export abstract class TinystrSubtag implements Writeable {
  constructor(public _0: TinyAsciiStr) {}

  /// Deconstructs into a raw format to be consumed
  /// by `from_raw_unchecked` or `try_from_raw`.
  // crate: icu_locale_core-2.3.0/src/helpers.rs:89 into_raw
  into_raw(): Uint8Array {
    return this._0.all_bytes().slice();
  }

  /// A helper function for displaying as a `&str`.
  // crate: icu_locale_core-2.3.0/src/helpers.rs:95 as_str
  as_str(): string {
    return this._0.as_str();
  }

  // crate: icu_locale_core-2.3.0/src/helpers.rs:100 to_tinystr
  to_tinystr(): TinyAsciiStr {
    return new TinyAsciiStr(this._0.bytes.slice());
  }

  /// Compare with BCP-47 bytes.
  ///
  /// The return value is equivalent to what would happen if you first converted
  /// `self` to a BCP-47 string and then performed a byte comparison.
  ///
  /// This function is case-sensitive and results in a *total order*, so it is appropriate for
  /// binary search. The only argument producing [`Ordering::Equal`](core::cmp::Ordering::Equal)
  /// is `self.as_str().as_bytes()`.
  // crate: icu_locale_core-2.3.0/src/helpers.rs:113 strict_cmp
  strict_cmp(other: Uint8Array): Ordering {
    return cmp_bytes(utf8(this.as_str()), other);
  }

  /// Compare with a potentially unnormalized BCP-47 string.
  ///
  /// The return value is equivalent to what would happen if you first parsed the
  /// BCP-47 string and then performed a structural comparison.
  // crate: icu_locale_core-2.3.0/src/helpers.rs:123 normalizing_eq
  normalizing_eq(other: string): boolean {
    return eq_ignore_ascii_case(this.as_str(), other);
  }

  /** `#[derive(PartialEq)]` */
  eq(other: TinystrSubtag): boolean {
    return this._0.eq(other._0);
  }

  /** `#[derive(Ord)]` */
  cmp(other: TinystrSubtag): Ordering {
    return this._0.cmp(other._0);
  }

  // writeable::impl_writeable_delegate!($name, |&self| self.as_str(), ..)
  write_to(sink: FmtWrite): fmt_Result {
    return sink.write_str(this.as_str());
  }
  write_to_parts(sink: PartsWrite): fmt_Result {
    return sink.write_str(this.as_str());
  }
  writeable_length_hint(): LengthHint {
    return LengthHint.exact(utf8_len(this.as_str()));
  }
  writeable_borrow(): string | undefined {
    return this.as_str();
  }
  write_to_string(): string {
    return this.as_str();
  }

  /** `impl_display_with_writeable!`: `Display` / `to_string`. */
  to_string(): string {
    return this.write_to_string();
  }
}

/** `str::eq_ignore_ascii_case` */
export function eq_ignore_ascii_case(a: string, b: string): boolean {
  const x = utf8(a);
  const y = utf8(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    const l = (c: number) => (c >= 0x41 && c <= 0x5a ? c + 32 : c);
    if (l(x[i]!) !== l(y[i]!)) return false;
  }
  return true;
}

// impl core::str::FromStr for $name: `from_str` is `try_from_str`.
// crate: icu_locale_core-2.3.0/src/helpers.rs:132 from_str
export const subtag_from_str = subtag_try_from_str;
// impl<'l> From<&'l $name> for &'l str: `as_str`.
// crate: icu_locale_core-2.3.0/src/helpers.rs:138 from
export function subtag_into_str(input: TinystrSubtag): string {
  return input.as_str();
}
// impl From<$name> for tinystr::TinyAsciiStr<$len_end>: `to_tinystr`.
// crate: icu_locale_core-2.3.0/src/helpers.rs:144 from
export function subtag_into_tinystr(input: TinystrSubtag): TinyAsciiStr {
  return input.to_tinystr();
}
// crate-skip: icu_locale_core-2.3.0/src/helpers.rs:149 write_to_string macro arg of `impl_writeable_delegate!`: `TinystrSubtag.write_to_string`
// crate-skip: icu_locale_core-2.3.0/src/helpers.rs:186 bake feature "databake" off
// crate-skip: icu_locale_core-2.3.0/src/helpers.rs:195 borrows_size feature "databake" off
// test_construction (helpers.rs:201) and test_writeable (helpers.rs:219): subtags/subtags.test.ts.
// crate-skip: icu_locale_core-2.3.0/src/helpers.rs:228 serialize feature "serde" off
// crate-skip: icu_locale_core-2.3.0/src/helpers.rs:238 deserialize feature "serde" off
// crate-skip: icu_locale_core-2.3.0/src/helpers.rs:247 expecting feature "serde" off
// crate-skip: icu_locale_core-2.3.0/src/helpers.rs:254 visit_str feature "serde" off
// crate-skip: icu_locale_core-2.3.0/src/helpers.rs:278 validate_bytes ULE: zerovec data is decoded by tools/codegen/icu-data.ts
// crate-skip: icu_locale_core-2.3.0/src/helpers.rs:303 to_unaligned ULE: zerovec data is decoded by tools/codegen/icu-data.ts
// crate-skip: icu_locale_core-2.3.0/src/helpers.rs:306 from_unaligned ULE: zerovec data is decoded by tools/codegen/icu-data.ts

/** A type's `for_each_subtag_str` (`F: FnMut(&str) -> Result<(), E>`). */
export type ForEachSubtagStr = <E>(f: (subtag: string) => Result<undefined, E>) => Result<undefined, E>;

// impl_writeable_for_each_subtag_str_no_test!
// crate: icu_locale_core-2.3.0/src/helpers.rs:327 write_to
export function each_subtag_write_to(for_each_subtag_str: ForEachSubtagStr, sink: FmtWrite): fmt_Result {
  let initial = true;
  return for_each_subtag_str((subtag) => {
    if (initial) {
      initial = false;
    } else {
      const r = sink.write_char(0x2d /* '-' */);
      if (r.$ === "Err") return r;
    }
    return sink.write_str(subtag);
  });
}

// crate: icu_locale_core-2.3.0/src/helpers.rs:340 writeable_length_hint
export function each_subtag_writeable_length_hint(for_each_subtag_str: ForEachSubtagStr): LengthHint {
  let result = LengthHint.exact(0);
  let initial = true;
  const r = for_each_subtag_str<never>((subtag) => {
    if (initial) {
      initial = false;
    } else {
      result = add_assign_usize(result, 1);
    }
    result = add_assign_usize(result, utf8_len(subtag));
    return Ok(undefined);
  });
  if (r.$ === "Err") panic("infallible");
  return result;
}

// crate: icu_locale_core-2.3.0/src/helpers.rs:357 writeable_borrow
export function each_subtag_writeable_borrow(borrow_cond: boolean, borrow: () => string | undefined): string | undefined {
  if (borrow_cond) {
    return borrow();
  } else {
    return undefined;
  }
}

/** The `Writeable` methods `impl_writeable_for_each_subtag_str_no_test!` defines, for a class to delegate to. */
export abstract class EachSubtagWriteable implements Writeable {
  abstract for_each_subtag_str<E>(f: (subtag: string) => Result<undefined, E>): Result<undefined, E>;
  /** The macro's optional `$borrow_cond => $borrow` (none: `writeable_borrow` stays the default). */
  writeable_borrow(): string | undefined {
    return undefined;
  }
  write_to(sink: FmtWrite): fmt_Result {
    return each_subtag_write_to((f) => this.for_each_subtag_str(f), sink);
  }
  writeable_length_hint(): LengthHint {
    return each_subtag_writeable_length_hint((f) => this.for_each_subtag_str(f));
  }
  write_to_parts(sink: PartsWrite): fmt_Result {
    return Writeable_write_to_parts(this, sink);
  }
  write_to_string(): string {
    return Writeable_write_to_string(this);
  }
  /** `impl_display_with_writeable!`: `Display` / `to_string`. */
  to_string(): string {
    return this.write_to_string();
  }
}
// test_writeable (helpers.rs:377, impl_writeable_for_subtag_list!) and test_writeable
// (helpers.rs:399, impl_writeable_for_key_value!): extensions/extensions.test.ts.
