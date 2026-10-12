// Port of anstyle-parse =0.2.7 `src/lib.rs` (default features: `utf8`; not `core`).
//
//! Parser for implementing virtual terminal emulators
//!
//! [`Parser`] is implemented according to [Paul Williams' ANSI parser
//! state machine]. The state machine doesn't assign meaning to the parsed data
//! and is thus not itself sufficient for writing a terminal emulator. Instead,
//! it is expected that an implementation of [`Perform`] is provided which does
//! something useful with the parsed data. The [`Parser`] handles the book
//! keeping, and the [`Perform`] gets to simply handle actions.
//!
//! # Examples
//!
//! For an example of using the [`Parser`] please see the examples folder. The example included
//! there simply logs all the actions [`Perform`] does. One quick thing to see it in action is to
//! pipe `vim` into it
//!
//! ```sh
//! cargo build --release --example parselog
//! vim | target/release/examples/parselog
//! ```
//!
//! Just type `:q` to exit.
//!
//! # Differences from original state machine description
//!
//! * UTF-8 Support for Input
//! * OSC Strings can be terminated by 0x07
//! * Only supports 7-bit codes. Some 8-bit codes are still supported, but they no longer work in
//!   all states.
//!
//! [Paul Williams' ANSI parser state machine]: https://vt100.net/emu/dec_ansi_parser
//
// PORT: `Parser<C = DefaultCharAccumulator>` keeps the accumulator as a `CharAccumulator` field;
// `Parser.new()` builds the default (`Utf8Parser`, the `utf8` feature). `char` is a number.
// `Perform`'s default (empty) methods → optional interface members, called with `?.`.
// `osc_raw` is the `Vec<u8>` of the non-`core` build (no `MAX_OSC_RAW` cap).
// crate-skip: anstyle-parse-0.2.7/examples/parselog.rs:10 print example binary, not library code
// crate-skip: anstyle-parse-0.2.7/examples/parselog.rs:14 execute example binary, not library code
// crate-skip: anstyle-parse-0.2.7/examples/parselog.rs:18 hook example binary, not library code
// crate-skip: anstyle-parse-0.2.7/examples/parselog.rs:24 put example binary, not library code
// crate-skip: anstyle-parse-0.2.7/examples/parselog.rs:28 unhook example binary, not library code
// crate-skip: anstyle-parse-0.2.7/examples/parselog.rs:32 osc_dispatch example binary, not library code
// crate-skip: anstyle-parse-0.2.7/examples/parselog.rs:36 csi_dispatch example binary, not library code
// crate-skip: anstyle-parse-0.2.7/examples/parselog.rs:42 esc_dispatch example binary, not library code
// crate-skip: anstyle-parse-0.2.7/examples/parselog.rs:49 main example binary, not library code

import { debug_struct, debug_list, type Debug, type Fmt } from "../../std/fmt.ts";
import { unreachable } from "../../std/panic.ts";
import * as utf8 from "../utf8parse/lib.ts";
import { Params, debug_Params } from "./params.ts";
import { state_change, debug_State, type Action, type State } from "./state/mod.ts";

export { Params, ParamsIter, debug_Params } from "./params.ts";
export * as state from "./state/mod.ts";

const MAX_INTERMEDIATES = 2;
const MAX_OSC_PARAMS = 16;

/// Parser for raw _VTE_ protocol which delegates actions to a [`Perform`]
export class Parser {
  constructor(
    public state: State,
    public intermediates_: Uint8Array,
    public intermediate_idx: number,
    public params_: Params,
    public param: number,
    public osc_raw: number[],
    public osc_params: [number, number][],
    public osc_num_params: number,
    public ignoring: boolean,
    public utf8_parser: CharAccumulator,
  ) {}

  /// Create a new Parser
  // crate: anstyle-parse-0.2.7/src/lib.rs:83 new
  static new(): Parser {
    return Parser.default_();
  }

  /** `#[derive(Default)]` (with `C = DefaultCharAccumulator`) */
  static default_(): Parser {
    const osc_params: [number, number][] = [];
    for (let i = 0; i < MAX_OSC_PARAMS; i++) osc_params.push([0, 0]);
    return new Parser("Ground", new Uint8Array(MAX_INTERMEDIATES), 0, Params.default_(), 0, [], osc_params, 0, false, Utf8Parser.default_());
  }

  // PORT: the field `params` collides with this method; the field is `params_`
  // (and `intermediates_` likewise).
  // crate: anstyle-parse-0.2.7/src/lib.rs:88 params
  params(): Params {
    return this.params_;
  }

  // crate: anstyle-parse-0.2.7/src/lib.rs:93 intermediates
  intermediates(): Uint8Array {
    return this.intermediates_.subarray(0, this.intermediate_idx);
  }

  /// Advance the parser state
  ///
  /// Requires a [`Perform`] in case `byte` triggers an action
  // crate: anstyle-parse-0.2.7/src/lib.rs:101 advance
  advance(performer: Perform, byte: number): void {
    // Utf8 characters are handled out-of-band.
    if (this.state === "Utf8") {
      this.process_utf8(performer, byte);
      return;
    }

    const [state, action] = state_change(this.state, byte);
    this.perform_state_change(performer, state, action, byte);
  }

  // crate: anstyle-parse-0.2.7/src/lib.rs:113 process_utf8
  process_utf8(performer: Perform, byte: number): void {
    const c = this.utf8_parser.add(byte);
    if (c !== undefined) {
      performer.print?.(c);
      this.state = "Ground";
    }
  }

  // crate: anstyle-parse-0.2.7/src/lib.rs:124 perform_state_change
  perform_state_change(performer: Perform, state: State, action: Action, byte: number): void {
    switch (state) {
      case "Anywhere": {
        // Just run the action
        this.perform_action(performer, action, byte);
        break;
      }
      default: {
        switch (this.state) {
          case "DcsPassthrough": {
            this.perform_action(performer, "Unhook", byte);
            break;
          }
          case "OscString": {
            this.perform_action(performer, "OscEnd", byte);
            break;
          }
          default:
            break;
        }

        switch (action) {
          case "Nop":
            break;
          default: {
            this.perform_action(performer, action, byte);
            break;
          }
        }

        switch (state) {
          case "CsiEntry":
          case "DcsEntry":
          case "Escape": {
            this.perform_action(performer, "Clear", byte);
            break;
          }
          case "DcsPassthrough": {
            this.perform_action(performer, "Hook", byte);
            break;
          }
          case "OscString": {
            this.perform_action(performer, "OscStart", byte);
            break;
          }
          default:
            break;
        }

        // Assume the new state
        this.state = state;
        break;
      }
    }
  }

  /// Separate method for `osc_dispatch` that borrows self as read-only
  ///
  /// The aliasing is needed here for multiple slices into `self.osc_raw`
  // crate: anstyle-parse-0.2.7/src/lib.rs:174 osc_dispatch
  osc_dispatch(performer: Perform, byte: number): void {
    const slices: Uint8Array[] = [];

    for (let i = 0; i < Math.min(MAX_OSC_PARAMS, this.osc_num_params); i++) {
      const indices = this.osc_params[i]!;
      slices.push(Uint8Array.from(this.osc_raw.slice(indices[0], indices[1])));
    }

    const num_params = this.osc_num_params;
    const params = slices.slice(0, num_params);
    performer.osc_dispatch?.(params, byte === 0x07);
  }

  // crate: anstyle-parse-0.2.7/src/lib.rs:191 perform_action
  perform_action(performer: Perform, action: Action, byte: number): void {
    switch (action) {
      case "Print":
        performer.print?.(byte);
        break;
      case "Execute":
        performer.execute?.(byte);
        break;
      case "Hook": {
        if (this.params_.is_full()) {
          this.ignoring = true;
        } else {
          this.params_.push(this.param);
        }

        performer.hook?.(this.params(), this.intermediates(), this.ignoring, byte);
        break;
      }
      case "Put":
        performer.put?.(byte);
        break;
      case "OscStart": {
        this.osc_raw.length = 0;
        this.osc_num_params = 0;
        break;
      }
      case "OscPut": {
        const idx = this.osc_raw.length;

        // Param separator
        if (byte === 0x3b /* b';' */) {
          const param_idx = this.osc_num_params;
          switch (param_idx) {
            // Only process up to MAX_OSC_PARAMS
            case MAX_OSC_PARAMS:
              return;

            // First param is special - 0 to current byte index
            case 0: {
              this.osc_params[param_idx] = [0, idx];
              break;
            }

            // All other params depend on previous indexing
            default: {
              const prev = this.osc_params[param_idx - 1]!;
              const begin = prev[1];
              this.osc_params[param_idx] = [begin, idx];
              break;
            }
          }

          this.osc_num_params += 1;
        } else {
          this.osc_raw.push(byte);
        }
        break;
      }
      case "OscEnd": {
        const param_idx = this.osc_num_params;
        const idx = this.osc_raw.length;

        switch (param_idx) {
          // Finish last parameter if not already maxed
          case MAX_OSC_PARAMS:
            break;

          // First param is special - 0 to current byte index
          case 0: {
            this.osc_params[param_idx] = [0, idx];
            this.osc_num_params += 1;
            break;
          }

          // All other params depend on previous indexing
          default: {
            const prev = this.osc_params[param_idx - 1]!;
            const begin = prev[1];
            this.osc_params[param_idx] = [begin, idx];
            this.osc_num_params += 1;
            break;
          }
        }
        this.osc_dispatch(performer, byte);
        break;
      }
      case "Unhook":
        performer.unhook?.();
        break;
      case "CsiDispatch": {
        if (this.params_.is_full()) {
          this.ignoring = true;
        } else {
          this.params_.push(this.param);
        }

        performer.csi_dispatch?.(this.params(), this.intermediates(), this.ignoring, byte);
        break;
      }
      case "EscDispatch": {
        performer.esc_dispatch?.(this.intermediates(), this.ignoring, byte);
        break;
      }
      case "Collect": {
        if (this.intermediate_idx === MAX_INTERMEDIATES) {
          this.ignoring = true;
        } else {
          this.intermediates_[this.intermediate_idx] = byte;
          this.intermediate_idx += 1;
        }
        break;
      }
      case "Param": {
        if (this.params_.is_full()) {
          this.ignoring = true;
          return;
        }

        if (byte === 0x3b /* b';' */) {
          this.params_.push(this.param);
          this.param = 0;
        } else if (byte === 0x3a /* b':' */) {
          this.params_.extend(this.param);
          this.param = 0;
        } else {
          // Continue collecting bytes into param
          this.param = Math.min(this.param * 10, 0xffff); // saturating_mul(10)
          // `byte - b'0'` is a u8 subtraction (overflow is impossible for the bytes routed here)
          this.param = Math.min(this.param + ((byte - 0x30) & 0xff), 0xffff); // saturating_add
        }
        break;
      }
      case "Clear": {
        // Reset everything on ESC/CSI/DCS entry
        this.intermediate_idx = 0;
        this.ignoring = false;
        this.param = 0;

        this.params_.clear();
        break;
      }
      case "BeginUtf8":
        this.process_utf8(performer, byte);
        break;
      case "Ignore":
        break;
      case "Nop":
        break;
    }
  }
}

/** `#[derive(Debug)]` */
export const debug_Parser: Debug<Parser> = (v, f) =>
  debug_struct(f, "Parser", [
    ["state", debug_State(v.state)],
    ["intermediates", debug_list(f, Array.from(v.intermediates_, String))],
    ["intermediate_idx", String(v.intermediate_idx)],
    ["params", debug_Params(v.params_, f)],
    ["param", String(v.param)],
    ["osc_raw", debug_list(f, v.osc_raw.map(String))],
    ["osc_params", debug_list(f, v.osc_params.map(([a, b]) => `(${a}, ${b})`))],
    ["osc_num_params", String(v.osc_num_params)],
    ["ignoring", String(v.ignoring)],
    ["utf8_parser", v.utf8_parser.debug(f)],
  ]);

/// Build a `char` out of bytes
export interface CharAccumulator {
  /// Build a `char` out of bytes
  ///
  /// Return `None` when more data is needed
  // crate: anstyle-parse-0.2.7/src/lib.rs:327 add
  add(byte: number): number | undefined;

  /** `#[derive(Debug)]` of the implementor (rust-ts: needed by `debug_Parser`). */
  debug(f: Fmt): string;
}

/// Most flexible [`CharAccumulator`] for [`Parser`] based on active features
// PORT: `#[cfg(feature = "utf8")] pub type DefaultCharAccumulator = Utf8Parser;`
export type DefaultCharAccumulator = Utf8Parser;

/// Only allow parsing 7-bit ASCII
export class AsciiParser implements CharAccumulator {
  static default_(): AsciiParser {
    return new AsciiParser();
  }

  // crate: anstyle-parse-0.2.7/src/lib.rs:342 add
  add(_byte: number): number | undefined {
    return unreachable("internal error: entered unreachable code: multi-byte UTF8 characters are unsupported");
  }

  debug(_f: Fmt): string {
    return "AsciiParser";
  }
}

/// Allow parsing UTF-8
export class Utf8Parser implements CharAccumulator {
  constructor(public utf8_parser: utf8.Parser) {}

  static default_(): Utf8Parser {
    return new Utf8Parser(utf8.Parser.default_());
  }

  // crate: anstyle-parse-0.2.7/src/lib.rs:356 add
  add(byte: number): number | undefined {
    const c: { value: number | undefined } = { value: undefined };
    const receiver = new VtUtf8Receiver(c);
    this.utf8_parser.advance(receiver, byte);
    return c.value;
  }

  debug(f: Fmt): string {
    return debug_struct(f, "Utf8Parser", [["utf8_parser", utf8.debug_Parser(this.utf8_parser, f)]]);
  }
}

class VtUtf8Receiver implements utf8.Receiver {
  constructor(public _0: { value: number | undefined }) {}

  // crate: anstyle-parse-0.2.7/src/lib.rs:369 codepoint
  codepoint(c: number): void {
    this._0.value = c;
  }

  // crate: anstyle-parse-0.2.7/src/lib.rs:373 invalid_sequence
  invalid_sequence(): void {
    this._0.value = 0xfffd; // '�'
  }
}

/// Performs actions requested by the [`Parser`]
///
/// Actions in this case mean, for example, handling a CSI escape sequence describing cursor
/// movement, or simply printing characters to the screen.
///
/// The methods on this type correspond to actions described in
/// <http://vt100.net/emu/dec_ansi_parser>. I've done my best to describe them in
/// a useful way in my own words for completeness, but the site should be
/// referenced if something isn't clear. If the site disappears at some point in
/// the future, consider checking archive.org.
export interface Perform {
  /// Draw a character to the screen and update states.
  // crate: anstyle-parse-0.2.7/src/lib.rs:390 print
  print?(_c: number): void;

  /// Execute a C0 or C1 control function.
  // crate: anstyle-parse-0.2.7/src/lib.rs:393 execute
  execute?(_byte: number): void;

  /// Invoked when a final character arrives in first part of device control string.
  ///
  /// The control function should be determined from the private marker, final character, and
  /// execute with a parameter list. A handler should be selected for remaining characters in the
  /// string; the handler function should subsequently be called by `put` for every character in
  /// the control string.
  ///
  /// The `ignore` flag indicates that more than two intermediates arrived and
  /// subsequent characters were ignored.
  // crate: anstyle-parse-0.2.7/src/lib.rs:404 hook
  hook?(_params: Params, _intermediates: Uint8Array, _ignore: boolean, _action: number): void;

  /// Pass bytes as part of a device control string to the handle chosen in `hook`. C0 controls
  /// will also be passed to the handler.
  // crate: anstyle-parse-0.2.7/src/lib.rs:408 put
  put?(_byte: number): void;

  /// Called when a device control string is terminated.
  ///
  /// The previously selected handler should be notified that the DCS has
  /// terminated.
  // crate: anstyle-parse-0.2.7/src/lib.rs:414 unhook
  unhook?(): void;

  /// Dispatch an operating system command.
  // crate: anstyle-parse-0.2.7/src/lib.rs:417 osc_dispatch
  osc_dispatch?(_params: readonly Uint8Array[], _bell_terminated: boolean): void;

  /// A final character has arrived for a CSI sequence
  ///
  /// The `ignore` flag indicates that either more than two intermediates arrived
  /// or the number of parameters exceeded the maximum supported length,
  /// and subsequent characters were ignored.
  // crate: anstyle-parse-0.2.7/src/lib.rs:424 csi_dispatch
  csi_dispatch?(_params: Params, _intermediates: Uint8Array, _ignore: boolean, _action: number): void;

  /// The final character of an escape sequence has arrived.
  ///
  /// The `ignore` flag indicates that more than two intermediates arrived and
  /// subsequent characters were ignored.
  // crate: anstyle-parse-0.2.7/src/lib.rs:437 esc_dispatch
  esc_dispatch?(_intermediates: Uint8Array, _ignore: boolean, _byte: number): void;
}
