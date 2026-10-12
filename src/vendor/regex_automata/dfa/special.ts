// Port of regex-automata 0.4.13 `src/dfa/special.rs` (deserialization and the state predicates;
// the `dfa-build` parts are not ported).
//
// Copyright (c) 2015 The Rust Project Developers; licensed under MIT OR Apache-2.0 (regex-automata).
//
// PORT: `StateID`/`PatternID` are `number`s (u32).
import { assert } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { StateID } from "../util/primitives.ts";
import { check_slice_len, DeserializeError, try_read_state_id } from "../util/wire.ts";
import { DEAD } from "./mod.ts";

/// The set of all special state IDs in a DFA.
///
/// Special states have the following property: they require extra checks
/// before proceeding with the next transition. (Details of upstream's docs are not repeated here.)
// #[derive(Clone, Copy, Debug)]
export class Special {
  constructor(
    /// The identifier of the last special state in a DFA. A state is special
    /// if and only if its identifier is less than or equal to `max`.
    public max: number,
    /// The identifier of the quit state in a DFA. (There is no analogous field
    /// for the dead state since the dead state's ID is always zero, regardless
    /// of state ID size.)
    public quit_id: number,
    /// The identifier of the first match state.
    public min_match: number,
    /// The identifier of the last match state.
    public max_match: number,
    /// The identifier of the first accelerated state.
    public min_accel: number,
    /// The identifier of the last accelerated state.
    public max_accel: number,
    /// The identifier of the first start state.
    public min_start: number,
    /// The identifier of the last start state.
    public max_start: number,
  ) {}

  /// Deserialize the given bytes into special state ranges. If the slice
  /// given is not big enough, then this returns an error. Similarly, if
  /// any of the expected invariants around special state ranges aren't
  /// upheld, an error is returned. Note that this does not guarantee that the
  /// information returned is correct.
  ///
  /// Upon success, this returns the number of bytes read in addition to the
  /// special state IDs themselves.
  // crate: regex-automata-0.4.13/src/dfa/special.rs:223 from_bytes
  static from_bytes(slice: Uint8Array): Result<[Special, number], DeserializeError> {
    const c = check_slice_len(slice, 8 * StateID.SIZE, "special states");
    if (c.$ === "Err") return c;

    let nread = 0;
    const ids: number[] = [];
    for (const what of [
      "special max id",
      "special quit id",
      "special min match id",
      "special max match id",
      "special min accel id",
      "special max accel id",
      "special min start id",
      "special max start id",
    ]) {
      // let mut read_id = |what| -> Result<StateID, DeserializeError> { .. };
      const r = try_read_state_id(slice, what);
      if (r.$ === "Err") return r;
      nread += r._0[1];
      slice = slice.subarray(StateID.SIZE);
      ids.push(r._0[0]);
    }
    const [max, quit_id, min_match, max_match, min_accel, max_accel, min_start, max_start] = ids as [number, number, number, number, number, number, number, number];

    const special = new Special(max, quit_id, min_match, max_match, min_accel, max_accel, min_start, max_start);
    const v = special.validate();
    if (v.$ === "Err") return v;
    assert(nread === special.write_to_len(), "assertion `left == right` failed");
    return Ok([special, nread]);
  }

  /// Validate that the information describing special states satisfies
  /// all known invariants.
  // crate: regex-automata-0.4.13/src/dfa/special.rs:262 validate
  validate(): Result<undefined, DeserializeError> {
    const err = (msg: string) => Err(DeserializeError.generic(msg));
    // Check that both ends of the range are DEAD or neither are.
    if (this.min_match === DEAD && this.max_match !== DEAD) return err("min_match is DEAD, but max_match is not");
    if (this.min_match !== DEAD && this.max_match === DEAD) return err("max_match is DEAD, but min_match is not");
    if (this.min_accel === DEAD && this.max_accel !== DEAD) return err("min_accel is DEAD, but max_accel is not");
    if (this.min_accel !== DEAD && this.max_accel === DEAD) return err("max_accel is DEAD, but min_accel is not");
    if (this.min_start === DEAD && this.max_start !== DEAD) return err("min_start is DEAD, but max_start is not");
    if (this.min_start !== DEAD && this.max_start === DEAD) return err("max_start is DEAD, but min_start is not");

    // Check that ranges are well formed.
    if (this.min_match > this.max_match) return err("min_match should not be greater than max_match");
    if (this.min_accel > this.max_accel) return err("min_accel should not be greater than max_accel");
    if (this.min_start > this.max_start) return err("min_start should not be greater than max_start");

    // Check that ranges are ordered with respect to one another.
    if (this.matches() && this.quit_id >= this.min_match) return err("quit_id should not be greater than min_match");
    if (this.accels() && this.quit_id >= this.min_accel) return err("quit_id should not be greater than min_accel");
    if (this.starts() && this.quit_id >= this.min_start) return err("quit_id should not be greater than min_start");
    if (this.matches() && this.accels() && this.min_accel < this.min_match) return err("min_match should not be greater than min_accel");
    if (this.matches() && this.starts() && this.min_start < this.min_match) return err("min_match should not be greater than min_start");
    if (this.accels() && this.starts() && this.min_start < this.min_accel) return err("min_accel should not be greater than min_start");

    // Check that max is at least as big as everything else.
    if (this.max < this.quit_id) return err("quit_id should not be greater than max");
    if (this.max < this.max_match) return err("max_match should not be greater than max");
    if (this.max < this.max_accel) return err("max_accel should not be greater than max");
    if (this.max < this.max_start) return err("max_start should not be greater than max");

    return Ok(undefined);
  }

  /// Returns the total number of bytes written by `write_to`.
  // crate: regex-automata-0.4.13/src/dfa/special.rs:387 write_to_len
  write_to_len(): number {
    return 8 * StateID.SIZE;
  }

  /// Returns true if and only if the given state ID is a special state.
  // crate: regex-automata-0.4.13/src/dfa/special.rs:421 is_special_state
  is_special_state(id: number): boolean {
    return id <= this.max;
  }

  /// Returns true if and only if the given state ID is a dead state.
  // crate: regex-automata-0.4.13/src/dfa/special.rs:427 is_dead_state
  is_dead_state(id: number): boolean {
    return id === DEAD;
  }

  /// Returns true if and only if the given state ID is a quit state.
  // crate: regex-automata-0.4.13/src/dfa/special.rs:433 is_quit_state
  is_quit_state(id: number): boolean {
    return !this.is_dead_state(id) && this.quit_id === id;
  }

  /// Returns true if and only if the given state ID is a match state.
  // crate: regex-automata-0.4.13/src/dfa/special.rs:439 is_match_state
  is_match_state(id: number): boolean {
    return !this.is_dead_state(id) && this.min_match <= id && id <= this.max_match;
  }

  /// Returns true if and only if the given state ID is an accel state.
  // crate: regex-automata-0.4.13/src/dfa/special.rs:445 is_accel_state
  is_accel_state(id: number): boolean {
    return !this.is_dead_state(id) && this.min_accel <= id && id <= this.max_accel;
  }

  /// Returns true if and only if the given state ID is a start state.
  // crate: regex-automata-0.4.13/src/dfa/special.rs:451 is_start_state
  is_start_state(id: number): boolean {
    return !this.is_dead_state(id) && this.min_start <= id && id <= this.max_start;
  }

  /// Returns the total number of match states for a dense table based DFA.
  // crate: regex-automata-0.4.13/src/dfa/special.rs:457 match_len
  match_len(stride: number): number {
    if (this.matches()) {
      return Math.floor((this.max_match - this.min_match + stride) / stride);
    } else {
      return 0;
    }
  }

  /// Returns true if and only if there is at least one match state.
  // crate: regex-automata-0.4.13/src/dfa/special.rs:468 matches
  matches(): boolean {
    return this.min_match !== DEAD;
  }

  /// Returns true if and only if there is at least one accel state.
  // crate: regex-automata-0.4.13/src/dfa/special.rs:485 accels
  accels(): boolean {
    return this.min_accel !== DEAD;
  }

  /// Returns true if and only if there is at least one start state.
  // crate: regex-automata-0.4.13/src/dfa/special.rs:491 starts
  starts(): boolean {
    return this.min_start !== DEAD;
  }
}
