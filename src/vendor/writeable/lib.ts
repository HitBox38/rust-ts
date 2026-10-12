// Port of writeable 0.6.4 `src/lib.rs` (the subset icu_list / icu_locale_core / icu_provider use on
// rustc's list-formatting path; see docs/handoff/icu-list.md).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! This crate defines [`Writeable`], a trait representing an object that can be written to a
//! sink implementing `std::fmt::Write`. It is an alternative to `std::fmt::Display` with the
//! addition of a function indicating the number of bytes to be written.
//!
//! (Examples and details of upstream's crate docs are not repeated here.)

// mod cmp; mod impls; mod ops; mod parts_write_adapter;  (ported)
// mod concat; mod replace; mod to_string_or_borrow; mod try_writeable; mod testing;  (not ported:
// unused on rustc's path; see the handoff) #[cfg(feature = "either")] mod either; (feature off)
//
// PORT: `core::fmt::Write` / `fmt::Result` / `fmt::Error` are not in src/std yet; they are defined
// here (`FmtWrite`, `fmt_Result`, `fmt_Error`) and should move to src/std/fmt.ts later.
// `fmt::Result` is a `Result<(), fmt::Error>` (src/std/result.ts) with `undefined` for `()`.
import { Err, Ok, type Result } from "../../std/result.ts";
import { encode_utf8 } from "./impls.ts";
import { CoreWriteAsPartsWrite } from "./parts_write_adapter.ts";

/** `core::fmt::Error` (a unit struct). */
export type fmt_Error = "Error";
/** `core::fmt::Result` */
export type fmt_Result = Result<undefined, fmt_Error>;
export const FMT_OK: fmt_Result = Ok(undefined);
export const FMT_ERR: fmt_Result = Err("Error");

/**
 * `core::fmt::Write`. `write_char` is a provided method upstream
 * (`self.write_str(c.encode_utf8(&mut [0; 4]))`); implementors may delegate to `fmt_Write_write_char`.
 */
export interface FmtWrite {
  write_str(s: string): fmt_Result;
  write_char(c: number): fmt_Result;
}

/** core `fmt::Write::write_char` provided method. */
export function fmt_Write_write_char(self: FmtWrite, c: number): fmt_Result {
  return self.write_str(encode_utf8(c));
}

/** `impl fmt::Write for String`: a growable string sink. */
export class StringSink implements FmtWrite {
  constructor(public s: string = "") {}
  write_str(s: string): fmt_Result {
    this.s += s;
    return FMT_OK;
  }
  write_char(c: number): fmt_Result {
    this.s += String.fromCodePoint(c);
    return FMT_OK;
  }
}

export { cmp_str, cmp_utf8 } from "./cmp.ts";

// pub mod adapters { ... }: `CoreWriteAsPartsWrite` (parts_write_adapter.ts) is ported; `Concat`,
// `WithPart`, `Replace`, `TryWriteableInfallibleAsWriteable`, `WriteableAsTryWriteableInfallible`
// and `LossyWrap` are not (unused on rustc's path).
// crate-skip: writeable-0.6.4/src/lib.rs:126 write_to LossyWrap: TryWriteable is not ported (unused on rustc's path)
// crate-skip: writeable-0.6.4/src/lib.rs:132 write_to_parts LossyWrap: TryWriteable is not ported (unused on rustc's path)
// crate-skip: writeable-0.6.4/src/lib.rs:138 writeable_length_hint LossyWrap: TryWriteable is not ported (unused on rustc's path)
// crate-skip: writeable-0.6.4/src/lib.rs:143 writeable_borrow LossyWrap: TryWriteable is not ported (unused on rustc's path)
// crate-skip: writeable-0.6.4/src/lib.rs:152 write_to_string LossyWrap: TryWriteable is not ported (unused on rustc's path)

/// A hint to help consumers of `Writeable` pre-allocate bytes before they call
/// [`write_to`](Writeable::write_to).
///
/// This behaves like `Iterator::size_hint`: it is a tuple where the first element is the
/// lower bound, and the second element is the upper bound. If the upper bound is `None`
/// either there is no known upper bound, or the upper bound is larger than `usize`.
///
/// `LengthHint` implements std`::ops::{Add, Mul}` and similar traits for easy composition.
/// During computation, the lower bound will saturate at `usize::MAX`, while the upper
/// bound will become `None` if `usize::MAX` is exceeded.
// #[derive(Debug, PartialEq, Eq, Copy, Clone)] #[non_exhaustive]
export class LengthHint {
  constructor(
    public _0: number,
    public _1: number | undefined,
  ) {}

  /// Returns a hint where no length is known
  // crate: writeable-0.6.4/src/lib.rs:191 undefined
  static undefined(): LengthHint {
    return new LengthHint(0, undefined);
  }

  /// `write_to` will use exactly n bytes.
  // crate: writeable-0.6.4/src/lib.rs:196 exact
  static exact(n: number): LengthHint {
    return new LengthHint(n, n);
  }

  /// `write_to` will use at least n bytes.
  // crate: writeable-0.6.4/src/lib.rs:201 at_least
  static at_least(n: number): LengthHint {
    return new LengthHint(n, undefined);
  }

  /// `write_to` will use at most n bytes.
  // crate: writeable-0.6.4/src/lib.rs:206 at_most
  static at_most(n: number): LengthHint {
    return new LengthHint(0, n);
  }

  /// `write_to` will use between `n` and `m` bytes.
  // crate: writeable-0.6.4/src/lib.rs:211 between
  static between(n: number, m: number): LengthHint {
    return new LengthHint(Math.min(n, m), Math.max(n, m));
  }

  /// Returns a recommendation for the number of bytes to pre-allocate.
  /// If an upper bound exists, this is used, otherwise the lower bound
  /// (which might be 0).
  // crate: writeable-0.6.4/src/lib.rs:228 capacity
  capacity(): number {
    return this._1 ?? this._0;
  }

  /// Returns whether the `LengthHint` indicates that the string is exactly 0 bytes long.
  // crate: writeable-0.6.4/src/lib.rs:233 is_zero
  is_zero(): boolean {
    return this._1 === 0;
  }

  /** `#[derive(PartialEq)]` */
  eq(other: LengthHint): boolean {
    return this._0 === other._0 && this._1 === other._1;
  }
}

/// [`Part`]s are used as annotations for formatted strings.
// #[derive(Clone, Copy, Debug, PartialEq)]
export interface Part {
  readonly category: string;
  readonly value: string;
}

export const Part = {
  /// A part that should annotate error segments in [`TryWriteable`] output.
  ///
  /// For an example, see [`TryWriteable`].
  ERROR: { category: "writeable", value: "error" } as Part,
} as const;

/// A sink that supports annotating parts of the string with [`Part`]s.
export interface PartsWrite extends FmtWrite {
  // type SubPartsWrite: PartsWrite + ?Sized;  (PORT: erased; the closure receives a PartsWrite)

  /// Annotates all strings written by the closure with the given [`Part`].
  // crate: writeable-0.6.4/src/lib.rs:286 with_part
  with_part(part: Part, f: (sink: PartsWrite) => fmt_Result): fmt_Result;
}

/// `Writeable` is an alternative to `std::fmt::Display` with the addition of a length function.
///
/// PORT: the trait's provided methods are the `Writeable_*` functions below; an implementor that
/// does not override a method delegates to the matching function (trait default dispatch).
export interface Writeable {
  /// Writes a string to the given sink. Errors from the sink are bubbled up.
  /// The default implementation delegates to `write_to_parts`, and discards any
  /// `Part` annotations.
  write_to(sink: FmtWrite): fmt_Result;
  /// Write bytes and `Part` annotations to the given sink. Errors from the
  /// sink are bubbled up. The default implementation delegates to `write_to`,
  /// and doesn't produce any `Part` annotations.
  write_to_parts(sink: PartsWrite): fmt_Result;
  /// Returns a hint for the number of UTF-8 bytes that will be written to the sink.
  ///
  /// Override this method if it can be computed quickly.
  writeable_length_hint(): LengthHint;
  /// Returns a `&str` that matches the output of `write_to`, if possible.
  ///
  /// This method is used to avoid materializing a [`String`] in `write_to_string`.
  writeable_borrow(): string | undefined;
  /// Creates a new string with the data from this `Writeable`.
  ///
  /// Unlike [`to_string`](ToString::to_string), this does not pre-allocate an empty string
  /// and does not need to call into the formatting infrastructure.
  write_to_string(): string;
}

// crate: writeable-0.6.4/src/lib.rs:298 write_to
export function Writeable_write_to(self: Writeable, sink: FmtWrite): fmt_Result {
  return self.write_to_parts(new CoreWriteAsPartsWrite(sink));
}

// crate: writeable-0.6.4/src/lib.rs:305 write_to_parts
export function Writeable_write_to_parts(self: Writeable, sink: PartsWrite): fmt_Result {
  return self.write_to(sink);
}

// crate: writeable-0.6.4/src/lib.rs:312 writeable_length_hint
export function Writeable_writeable_length_hint(_self: Writeable): LengthHint {
  return LengthHint.undefined();
}

// crate: writeable-0.6.4/src/lib.rs:319 writeable_borrow
export function Writeable_writeable_borrow(_self: Writeable): string | undefined {
  return undefined;
}

// crate: writeable-0.6.4/src/lib.rs:378 write_to_string
export function Writeable_write_to_string(self: Writeable): string {
  const borrow = self.writeable_borrow();
  if (borrow !== undefined) {
    return borrow;
  }

  const hint = self.writeable_length_hint();
  if (hint.is_zero()) {
    return "";
  }
  // PORT: `String::with_capacity(hint.capacity())`: capacity is not observable.
  const output = new StringSink();
  const _ = self.write_to(output);
  return output.s;
}

// `impl_writeable_delegate!` (lib.rs:434): implementations delegate each method by hand.
// crate-skip: writeable-0.6.4/src/lib.rs:438 write_to macro `impl_writeable_delegate!`: expanded by hand at each use
// crate-skip: writeable-0.6.4/src/lib.rs:442 write_to_parts macro `impl_writeable_delegate!`: expanded by hand at each use
// crate-skip: writeable-0.6.4/src/lib.rs:446 writeable_length_hint macro `impl_writeable_delegate!`: expanded by hand at each use
// crate-skip: writeable-0.6.4/src/lib.rs:450 writeable_borrow macro `impl_writeable_delegate!`: expanded by hand at each use
// crate-skip: writeable-0.6.4/src/lib.rs:435 write_to_string macro `impl_writeable_delegate!` pattern: expanded by hand at each use
// crate-skip: writeable-0.6.4/src/lib.rs:455 write_to_string macro `impl_writeable_delegate!`: expanded by hand at each use

/// `impl_display_with_writeable!`: `Display::fmt` is `Writeable::write_to(&self, f)` and the
/// inherent `to_string` is `Writeable::write_to_string(self).into_owned()`.
// crate: writeable-0.6.4/src/lib.rs:501 fmt
export function display_with_writeable(self: Writeable, f: FmtWrite): fmt_Result {
  return self.write_to(f);
}

// crate: writeable-0.6.4/src/lib.rs:516 to_string
export function to_string_with_writeable(self: Writeable): string {
  return self.write_to_string();
}


export { CoreWriteAsPartsWrite } from "./parts_write_adapter.ts";
export { StrWriteable, writeable_str } from "./impls.ts";
