// Port of zerotrie 0.2.5 `src/cursor.rs` (`ZeroTrieSimpleAscii`'s cursor; the
// `ZeroAsciiIgnoreCaseTrie` cursor is not ported).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! Types for walking stepwise through a trie.
//!
//! For examples, see the `.cursor()` functions
//! and the `Cursor` types in this module.
import { FMT_ERR, FMT_OK, type FmtWrite, type fmt_Result } from "../writeable/lib.ts";
import { utf8 } from "../../std/str.ts";
import { ZeroTrieSimpleAscii_OPTIONS } from "./options.ts";
import { probe_parameterized, step_parameterized, take_value } from "./reader.ts";
import { ZeroTrieSimpleAscii } from "./zerotrie.ts";

/// A cursor into a [`ZeroTrieSimpleAscii`], useful for stepwise lookup.
///
/// For examples, see [`ZeroTrieSimpleAscii::cursor()`].
// #[derive(Debug, Clone)]
// PORT: the trie's `store: &[u8]` is held in a `{ value }` cell so the reader can advance it.
export class ZeroTrieSimpleAsciiCursor implements FmtWrite {
  constructor(public trie: { value: Uint8Array }) {}

  /// Steps the cursor one character into the trie based on the character's byte value.
  // crate: zerotrie-0.2.5/src/cursor.rs:279 step
  step(byte: number): void {
    step_parameterized(ZeroTrieSimpleAscii_OPTIONS, this.trie, byte);
  }

  /// Takes the value at the current position.
  ///
  /// Calling this function on a new cursor is equivalent to calling `.get()`
  /// with the empty string (except that it can only be called once).
  // crate: zerotrie-0.2.5/src/cursor.rs:302 take_value
  take_value(): number | undefined {
    return take_value(this.trie);
  }

  /// Steps the cursor one position into the trie based on the edge index.
  ///
  /// This function is similar to [`Self::step()`], but it takes an index instead of a char.
  /// This enables stepwise iteration over the contents of the trie.
  ///
  /// If there are multiple possibilities for the next byte, the `index` argument allows
  /// visiting them in order. Since this function steps the cursor, the cursor must be
  /// cloned (a cheap operation) in order to visit multiple children.
  // crate: zerotrie-0.2.5/src/cursor.rs:399 probe
  probe(index: number): AsciiProbeResult | undefined {
    return probe_parameterized(ZeroTrieSimpleAscii_OPTIONS, this.trie, index);
  }

  /// Checks whether the cursor points to an empty trie.
  ///
  /// Use this to determine when to stop iterating.
  // crate: zerotrie-0.2.5/src/cursor.rs:407 is_empty
  is_empty(): boolean {
    return this.trie.value.length === 0;
  }

  /// Gets the trie containing all values that are reachable from the cursor's current position.
  // crate: zerotrie-0.2.5/src/cursor.rs:432 into_suffix_trie
  into_suffix_trie(): ZeroTrieSimpleAscii {
    return new ZeroTrieSimpleAscii(this.trie.value);
  }

  // impl fmt::Write for ZeroTrieSimpleAsciiCursor<'_>
  /// Steps the cursor through each ASCII byte of the string.
  ///
  /// If the string contains non-ASCII chars, an error is returned.
  // crate: zerotrie-0.2.5/src/cursor.rs:548 write_str
  write_str(s: string): fmt_Result {
    for (const b of utf8(s)) {
      if (b >= 0x80) {
        return FMT_ERR;
      }
      this.step(b);
    }
    return FMT_OK;
  }

  /// Equivalent to [`ZeroTrieSimpleAsciiCursor::step()`], except returns
  /// an error if the char is non-ASCII.
  // crate: zerotrie-0.2.5/src/cursor.rs:575 write_char
  write_char(c: number): fmt_Result {
    if (c >= 0x80) {
      return FMT_ERR;
    }
    this.step(c);
    return FMT_OK;
  }
}

/// Information about a probed edge.
// #[derive(Debug, Copy, Clone, PartialEq, Eq)] #[non_exhaustive]
export interface AsciiProbeResult {
  /// The character's byte value between this node and its parent.
  readonly byte: number;
  /// The number of siblings of this node, _including itself_.
  readonly total_siblings: number;
}

// impl ZeroTrieSimpleAscii<Store>
/// Gets a cursor into the current trie.
// crate: zerotrie-0.2.5/src/cursor.rs:72 cursor
export function ZeroTrieSimpleAscii_cursor(self: ZeroTrieSimpleAscii): ZeroTrieSimpleAsciiCursor {
  return new ZeroTrieSimpleAsciiCursor({ value: self.as_borrowed_slice().store });
}

/// Queries the trie for a string encoded by the given write function.
// crate: zerotrie-0.2.5/src/cursor.rs:102 get_with_write_fn
export function ZeroTrieSimpleAscii_get_with_write_fn(
  self: ZeroTrieSimpleAscii,
  write_fn: (cursor: ZeroTrieSimpleAsciiCursor) => fmt_Result,
): number | undefined {
  const cursor = ZeroTrieSimpleAscii_cursor(self);
  if (write_fn(cursor).$ === "Err") return undefined;
  return cursor.take_value();
}

/// Takes the trie by value and returns a cursor into it.
// crate: zerotrie-0.2.5/src/cursor.rs:186 into_cursor
export function ZeroTrieSimpleAscii_into_cursor(self: ZeroTrieSimpleAscii): ZeroTrieSimpleAsciiCursor {
  return new ZeroTrieSimpleAsciiCursor({ value: self.store });
}

// The `ZeroAsciiIgnoreCaseTrie` cursor is not ported (unused on rustc's path).
// crate-skip: zerotrie-0.2.5/src/cursor.rs:142 cursor ZeroAsciiIgnoreCaseTrie: unused on rustc's path
// crate-skip: zerotrie-0.2.5/src/cursor.rs:172 get_with_write_fn ZeroAsciiIgnoreCaseTrie: unused on rustc's path
// crate-skip: zerotrie-0.2.5/src/cursor.rs:195 into_cursor ZeroAsciiIgnoreCaseTrie: unused on rustc's path
// crate-skip: zerotrie-0.2.5/src/cursor.rs:477 step ZeroAsciiIgnoreCaseTrie: unused on rustc's path
// crate-skip: zerotrie-0.2.5/src/cursor.rs:485 take_value ZeroAsciiIgnoreCaseTrie: unused on rustc's path
// crate-skip: zerotrie-0.2.5/src/cursor.rs:492 probe ZeroAsciiIgnoreCaseTrie: unused on rustc's path
// crate-skip: zerotrie-0.2.5/src/cursor.rs:500 is_empty ZeroAsciiIgnoreCaseTrie: unused on rustc's path
// crate-skip: zerotrie-0.2.5/src/cursor.rs:525 into_suffix_trie ZeroAsciiIgnoreCaseTrie: unused on rustc's path
// crate-skip: zerotrie-0.2.5/src/cursor.rs:588 write_str ZeroAsciiIgnoreCaseTrie: unused on rustc's path
// crate-skip: zerotrie-0.2.5/src/cursor.rs:600 write_char ZeroAsciiIgnoreCaseTrie: unused on rustc's path
