// Port of regex-automata 0.4.13 `src/dfa/dense.rs` (`Flags` deserialization only, which the sparse
// DFA shares).
//
// Copyright (c) 2015 The Rust Project Developers; licensed under MIT OR Apache-2.0 (regex-automata).
//
// PORT: `StateID`/`PatternID` are `number`s (u32).
import { Ok, type Result } from "../../../std/result.ts";
import { type DeserializeError, try_read_u32 } from "../util/wire.ts";

/// The set of flags that a DFA uses. (Details of upstream's docs are not repeated here.)
// #[derive(Clone, Copy, Debug)]
export class Flags {
  constructor(
    /// Whether the DFA can match the empty string.
    public has_empty: boolean,
    /// Whether the DFA should only produce matches with spans that correspond
    /// to valid UTF-8.
    public is_utf8: boolean,
    /// Whether the DFA is always anchored or not, regardless of `Input`
    /// configuration.
    public is_always_start_anchored: boolean,
  ) {}

  /// Deserializes the flags from the given slice. On success, this also
  /// returns the number of bytes read from the slice.
  // crate: regex-automata-0.4.13/src/dfa/dense.rs:4729 from_bytes
  static from_bytes(slice: Uint8Array): Result<[Flags, number], DeserializeError> {
    const r = try_read_u32(slice, "flag bitset");
    if (r.$ === "Err") return r;
    const [bits, nread] = r._0;
    const flags = new Flags((bits & (1 << 0)) !== 0, (bits & (1 << 1)) !== 0, (bits & (1 << 2)) !== 0);
    return Ok([flags, nread]);
  }
}
