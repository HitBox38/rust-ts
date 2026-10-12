// Port of regex-automata 0.4.13 `src/util/start.rs` (start `Config`, `StartByteMap` deserialization, `Start`).
//
// Copyright (c) 2015 The Rust Project Developers; licensed under MIT OR Apache-2.0 (regex-automata).
//
// PORT: `StateID`/`PatternID` are `number`s (u32).
import { Err, Ok, type Result } from "../../../std/result.ts";
import { Anchored } from "./search.ts";
import { check_slice_len, DeserializeError } from "./wire.ts";

/// The configuration used to determine a DFA's start state for a search.
// #[derive(Clone, Debug)]
export class Config {
  constructor(
    public look_behind_: number | undefined,
    public anchored_: Anchored,
  ) {}

  /// Create a new default start configuration.
  ///
  /// The default is an unanchored search that starts at the beginning of the
  /// haystack.
  // crate: regex-automata-0.4.13/src/util/start.rs:131 new
  static new(): Config {
    return new Config(undefined, Anchored.No);
  }

  /// Set the look-behind byte at the start of a search.
  // crate: regex-automata-0.4.13/src/util/start.rs:169 look_behind
  look_behind(byte: number | undefined): Config {
    return new Config(byte, this.anchored_);
  }

  /// Set the anchored mode of a search.
  // crate: regex-automata-0.4.13/src/util/start.rs:177 anchored
  anchored(mode: Anchored): Config {
    return new Config(this.look_behind_, mode);
  }

  /// Return the look-behind byte in this configuration, if one exists.
  // crate: regex-automata-0.4.13/src/util/start.rs:183 get_look_behind
  get_look_behind(): number | undefined {
    return this.look_behind_;
  }

  /// Return the anchored mode in this configuration.
  // crate: regex-automata-0.4.13/src/util/start.rs:188 get_anchored
  get_anchored(): Anchored {
    return this.anchored_;
  }
}

/// A map from every possible byte value to its corresponding starting
/// configuration.
// #[derive(Clone)]
export class StartByteMap {
  constructor(public map: Start[] /* [Start; 256] */) {}

  /// Return the starting configuration for the given look-behind byte.
  // crate: regex-automata-0.4.13/src/util/start.rs:256 get
  get(byte: number): Start {
    return this.map[byte]!;
  }

  /// Deserializes a byte class map from the given slice. If the slice is of
  /// insufficient length or otherwise contains an impossible mapping, then
  /// an error is returned. Upon success, the number of bytes read along with
  /// the map are returned. The number of bytes read is always a multiple of
  /// 8.
  // crate: regex-automata-0.4.13/src/util/start.rs:265 from_bytes
  static from_bytes(slice: Uint8Array): Result<[StartByteMap, number], DeserializeError> {
    const c = check_slice_len(slice, 256, "start byte map");
    if (c.$ === "Err") return c;
    const map: Start[] = new Array<Start>(256).fill("NonWordByte");
    for (let i = 0; i < 256; i++) {
      const start = Start.from_usize(slice[i]!);
      if (start === undefined) {
        return Err(DeserializeError.generic("found invalid starting configuration"));
      }
      map[i] = start;
    }
    return Ok([new StartByteMap(map), 256]);
  }
}

/// Represents the six possible starting configurations of a DFA search.
// #[derive(Clone, Copy, Debug, Eq, PartialEq)]
export type Start =
  /// This occurs when the starting position is not any of the ones below.
  | "NonWordByte"
  /// This occurs when the byte immediately preceding the start of the search
  /// is an ASCII word byte.
  | "WordByte"
  /// This occurs when the starting position of the search corresponds to the
  /// beginning of the haystack.
  | "Text"
  /// This occurs when the byte immediately preceding the start of the search
  /// is a line terminator. Specifically, `\n`.
  | "LineLF"
  /// This occurs when the byte immediately preceding the start of the search
  /// is a line terminator. Specifically, `\r`.
  | "LineCR"
  /// This occurs when a custom line terminator has been set via a
  /// `LookMatcher`, and when that line terminator is neither a `\r` or a
  /// `\n`.
  ///
  /// If the custom line terminator is a word byte, then this start
  /// configuration is still selected. DFAs that implement word boundary
  /// assertions will likely need to check whether the custom line terminator
  /// is a word byte, in which case, it should behave as if the byte
  /// satisfies `\b` in addition to multi-line anchors.
  | "CustomLineTerminator";

const START_DISCRIMINANTS: readonly Start[] = ["NonWordByte", "WordByte", "Text", "LineLF", "LineCR", "CustomLineTerminator"];

export const Start = {
  /// Return the starting state corresponding to the given integer. If no
  /// starting state exists for the given integer, then None is returned.
  // crate: regex-automata-0.4.13/src/util/start.rs:374 from_usize
  from_usize(n: number): Start | undefined {
    return START_DISCRIMINANTS[n];
  },

  /// Returns the total number of starting state configurations.
  // crate: regex-automata-0.4.13/src/util/start.rs:387 len
  len(): number {
    return 6;
  },

  /// Return this starting configuration as `u8` integer. It is guaranteed to
  /// be less than `Start::len()`.
  // crate: regex-automata-0.4.13/src/util/start.rs:394 as_u8
  as_u8(self: Start): number {
    // AFAIK, 'as' is the only way to zero-cost convert an int enum to an
    // actual int.
    return START_DISCRIMINANTS.indexOf(self);
  },

  /// Return this starting configuration as a `usize` integer. It is
  /// guaranteed to be less than `Start::len()`.
  // crate: regex-automata-0.4.13/src/util/start.rs:403 as_usize
  as_usize(self: Start): number {
    return Start.as_u8(self);
  },
};
