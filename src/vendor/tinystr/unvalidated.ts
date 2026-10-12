// Port of tinystr 0.8.4 `src/unvalidated.rs` (subset; added by the icu-list lane: the
// icu_locale_fallback data maps are keyed by `UnvalidatedTinyAsciiStr`).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import { Err, Ok, type Result } from "../../std/result.ts";
import type { TinyAsciiStr } from "./ascii.ts";
import type { ParseError } from "./error.ts";

/// A fixed-length bytes array that is expected to be an ASCII string but does not enforce that invariant.
///
/// Use this type instead of `TinyAsciiStr` if you don't need to enforce ASCII during deserialization. For
/// example, strings that are keys of a map don't need to ever be reified as `TinyAsciiStr`s.
///
/// The main advantage of this type over `[u8; N]` is that it serializes as a string in
/// human-readable formats like JSON.
// #[derive(PartialEq, PartialOrd, Eq, Ord, Clone, Copy)]
export class UnvalidatedTinyAsciiStr {
  constructor(public _0: Uint8Array /* [u8; N] */) {}

  // crate-skip: tinystr-0.8.4/src/unvalidated.rs:20 fmt Debug needs `TinyAsciiStr::try_from_raw` (not ported); unused on rustc's path
  // crate-skip: tinystr-0.8.4/src/unvalidated.rs:32 try_into_tinystr needs `TinyAsciiStr::try_from_raw` (not ported); unused on rustc's path

  /// Create a new `UnvalidatedTinyAsciiStr` from a UTF-8 byte slice.
  // crate: tinystr-0.8.4/src/unvalidated.rs:39 try_from_utf8
  static try_from_utf8(N: number, bytes: Uint8Array): Result<UnvalidatedTinyAsciiStr, ParseError> {
    if (bytes.length > N) {
      return Err({ $: "TooLong", max: N, len: bytes.length });
    }
    const target = new Uint8Array(N);
    target.set(bytes, 0);
    return Ok(new UnvalidatedTinyAsciiStr(target));
  }

  /// Create a new `UnvalidatedTinyAsciiStr` from a byte array.
  // crate: tinystr-0.8.4/src/unvalidated.rs:53 from_utf8_unchecked
  static from_utf8_unchecked(bytes: Uint8Array /* [u8; N] */): UnvalidatedTinyAsciiStr {
    return new UnvalidatedTinyAsciiStr(bytes);
  }

  // crate-skip: tinystr-0.8.4/src/unvalidated.rs:59 default needs `TinyAsciiStr::EMPTY` (not ported); unused on rustc's path
  // crate-skip: tinystr-0.8.4/src/unvalidated.rs:65 default needs `TinyAsciiStr::EMPTY` (not ported); unused on rustc's path
}

// Converts into a [`UnvalidatedTinyAsciiStr`]
// crate: tinystr-0.8.4/src/unvalidated.rs:73 to_unvalidated
export function to_unvalidated(self: TinyAsciiStr): UnvalidatedTinyAsciiStr {
  return new UnvalidatedTinyAsciiStr(self.all_bytes().slice());
}

// impl From<TinyAsciiStr<N>> for UnvalidatedTinyAsciiStr<N>
// crate: tinystr-0.8.4/src/unvalidated.rs:79 from
export function UnvalidatedTinyAsciiStr_from(other: TinyAsciiStr): UnvalidatedTinyAsciiStr {
  return to_unvalidated(other);
}
