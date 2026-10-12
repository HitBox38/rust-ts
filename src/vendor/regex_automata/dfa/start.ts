// Port of regex-automata 0.4.13 `src/dfa/start.rs` (`StartKind` deserialization).
//
// Copyright (c) 2015 The Rust Project Developers; licensed under MIT OR Apache-2.0 (regex-automata).
//
// PORT: `StateID`/`PatternID` are `number`s (u32).
import { Err, Ok, type Result } from "../../../std/result.ts";
import { check_slice_len, DeserializeError, try_read_u32 } from "../util/wire.ts";

/// The configuration used to determine a DFA's start state for a search.
///
/// A DFA has a single starting state in the typical textbook description. That
/// is, it corresponds to the set of all starting states for the NFA that built
/// it, along with their epsilon closures. In this crate, however, DFAs have
/// many possible start states due to a few factors:
///
/// (Details of upstream's type docs are not repeated here.)
// #[derive(Clone, Copy, Debug, Eq, PartialEq)]
export type StartKind =
  /// Support both anchored and unanchored searches.
  | "Both"
  /// Support only unanchored searches. Requesting an anchored search will
  /// panic.
  ///
  /// Note that even if an unanchored search is requested, the pattern itself
  /// may still be anchored. For example, `^abc` will only match `abc` at the
  /// start of a haystack. This will remain true, even if the regex engine
  /// only supported unanchored searches.
  | "Unanchored"
  /// Support only anchored searches. Requesting an unanchored search will
  /// panic.
  | "Anchored";

export const StartKind = {
  // crate: regex-automata-0.4.13/src/dfa/start.rs:31 from_bytes
  from_bytes(slice: Uint8Array): Result<[StartKind, number], DeserializeError> {
    const c = check_slice_len(slice, 4, "start kind bytes");
    if (c.$ === "Err") return c;
    const r = try_read_u32(slice, "start kind integer");
    if (r.$ === "Err") return r;
    const [n, nr] = r._0;
    switch (n) {
      case 0:
        return Ok(["Both", nr]);
      case 1:
        return Ok(["Unanchored", nr]);
      case 2:
        return Ok(["Anchored", nr]);
      default:
        return Err(DeserializeError.generic("unrecognized start kind"));
    }
  },

  // crate: regex-automata-0.4.13/src/dfa/start.rs:66 has_unanchored
  has_unanchored(self: StartKind): boolean {
    return self === "Both" || self === "Unanchored";
  },

  // crate: regex-automata-0.4.13/src/dfa/start.rs:71 has_anchored
  has_anchored(self: StartKind): boolean {
    return self === "Both" || self === "Anchored";
  },
};
