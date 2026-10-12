// Port of utf8parse =0.2.2 `src/lib.rs`.
//
//! A table-driven UTF-8 Parser
//!
//! This module implements a table-driven UTF-8 parser which should
//! theoretically contain the minimal number of branches (1). The only branch is
//! on the `Action` returned from unpacking a transition.
//
// PORT: `char` is a number (Unicode scalar). The `#[cfg(all(feature = "nightly", test))] mod
// benches` (a `Receiver for ()` impl and two `#[bench]`es) is not ported:
// crate-skip: utf8parse-0.2.2/src/lib.rs:106 codepoint nightly-only bench helper
// crate-skip: utf8parse-0.2.2/src/lib.rs:110 invalid_sequence nightly-only bench helper
// crate-skip: utf8parse-0.2.2/src/lib.rs:114 parse_bench_utf8_demo nightly-only benchmark
// crate-skip: utf8parse-0.2.2/src/lib.rs:125 std_string_parse_utf8 nightly-only benchmark

import { debug_struct, type Debug } from "../../std/fmt.ts";
import { State, debug_State, type Action } from "./types.ts";

export { Action, State } from "./types.ts";

/// Handles codepoint and invalid sequence events from the parser.
export interface Receiver {
  /// Called whenever a codepoint is parsed successfully
  // crate: utf8parse-0.2.2/src/lib.rs:19 codepoint
  codepoint(_: number): void;

  /// Called when an invalid_sequence is detected
  // crate: utf8parse-0.2.2/src/lib.rs:22 invalid_sequence
  invalid_sequence(): void;
}

/// Continuation bytes are masked with this value.
const CONTINUATION_MASK = 0b0011_1111;

/// A parser for Utf8 Characters
///
/// Repeatedly call `advance` with bytes to emit Utf8 characters
export class Parser {
  constructor(
    public point: number,
    public state: State,
  ) {}

  /// Create a new Parser
  // crate: utf8parse-0.2.2/src/lib.rs:39 new
  static new(): Parser {
    return new Parser(0, "Ground");
  }

  /** `#[derive(Default)]` */
  static default_(): Parser {
    return new Parser(0, State.default_());
  }

  /** `#[derive(Clone)]` */
  clone(): Parser {
    return new Parser(this.point, this.state);
  }

  /// Advance the parser
  ///
  /// The provider receiver will be called whenever a codepoint is completed or an invalid
  /// sequence is detected.
  // crate: utf8parse-0.2.2/src/lib.rs:47 advance
  advance(receiver: Receiver, byte: number): void {
    const [state, action] = State.advance(this.state, byte);
    this.perform_action(receiver, byte, action);
    this.state = state;
  }

  // crate: utf8parse-0.2.2/src/lib.rs:56 perform_action
  perform_action(receiver: Receiver, byte: number, action: Action): void {
    switch (action) {
      case "InvalidSequence": {
        this.point = 0;
        receiver.invalid_sequence();
        break;
      }
      case "EmitByte": {
        receiver.codepoint(byte);
        break;
      }
      case "SetByte1": {
        const point = (this.point | (byte & CONTINUATION_MASK)) >>> 0;
        const c = point; // char::from_u32_unchecked(point)
        this.point = 0;

        receiver.codepoint(c);
        break;
      }
      case "SetByte2": {
        this.point = (this.point | ((byte & CONTINUATION_MASK) << 6)) >>> 0;
        break;
      }
      case "SetByte2Top": {
        this.point = (this.point | ((byte & 0b0001_1111) << 6)) >>> 0;
        break;
      }
      case "SetByte3": {
        this.point = (this.point | ((byte & CONTINUATION_MASK) << 12)) >>> 0;
        break;
      }
      case "SetByte3Top": {
        this.point = (this.point | ((byte & 0b0000_1111) << 12)) >>> 0;
        break;
      }
      case "SetByte4": {
        this.point = (this.point | ((byte & 0b0000_0111) << 18)) >>> 0;
        break;
      }
    }
  }
}

/** `#[derive(Debug)]` */
export const debug_Parser: Debug<Parser> = (v, f) =>
  debug_struct(f, "Parser", [
    ["point", String(v.point)],
    ["state", debug_State(v.state)],
  ]);
