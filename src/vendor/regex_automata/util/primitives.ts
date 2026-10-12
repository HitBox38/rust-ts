// Port of regex-automata 0.4.13 `src/util/primitives.rs` (the `StateID`/`PatternID` constants and
// byte decoders used by the sparse DFA).
//
// Copyright (c) 2015 The Rust Project Developers; licensed under MIT OR Apache-2.0 (regex-automata).
//
// PORT: the target is little-endian (the oracle hosts aarch64 and x86_64 are), so `from_ne_bytes`
// reads little-endian. `StateID`/`PatternID` are `number`s (u32).
import { Err, Ok, type Result } from "../../../std/result.ts";

/// `SmallIndex::MAX` on 32/64-bit targets: `i32::MAX as usize - 1`.
const SMALL_INDEX_MAX = 2147483647 - 1;

function u32_from_ne_bytes(b: Uint8Array): number {
  return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
}

/// `SmallIndexError`
export interface SmallIndexError {
  readonly attempted: number;
}

const small_index = {
  MAX: SMALL_INDEX_MAX,
  LIMIT: SMALL_INDEX_MAX + 1,
  ZERO: 0,
  SIZE: 4,

  /// Create a new small index.
  ///
  /// If the given index exceeds [`SmallIndex::MAX`], then this returns
  /// an error.
  // crate: regex-automata-0.4.13/src/util/primitives.rs:244 from_ne_bytes
  from_ne_bytes(bytes: Uint8Array): Result<number, SmallIndexError> {
    const id = u32_from_ne_bytes(bytes);
    if (id > SMALL_INDEX_MAX) {
      return Err({ attempted: id });
    }
    return Ok(id);
  },

  /// Decode this small index from the bytes given using the native endian
  /// byte order for the current target.
  // crate: regex-automata-0.4.13/src/util/primitives.rs:260 from_ne_bytes_unchecked
  from_ne_bytes_unchecked(bytes: Uint8Array): number {
    return u32_from_ne_bytes(bytes);
  },

  // impl TryFrom<u32> for SmallIndex
  // crate: regex-automata-0.4.13/src/util/primitives.rs:326 try_from
  try_from(index: number): Result<number, SmallIndexError> {
    if (index > SMALL_INDEX_MAX) {
      return Err({ attempted: index });
    }
    return Ok(index);
  },
};

/// The identifier of a finite automaton state, represented by a [`SmallIndex`].
// index_type! { pub struct StateID(SmallIndex); ... }  (the macro's methods delegate to SmallIndex)
export const StateID = small_index;
/// The identifier of a regex pattern, represented by a [`SmallIndex`].
export const PatternID = small_index;
