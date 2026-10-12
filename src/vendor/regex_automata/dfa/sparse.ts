// Port of regex-automata 0.4.13 `src/dfa/sparse.rs` (deserializing a sparse DFA from bytes and
// walking it: the subset icu_list's `LazyAutomaton` uses).
//
// Copyright (c) 2015 The Rust Project Developers; licensed under MIT OR Apache-2.0 (regex-automata).

/*!
Types and routines specific to sparse DFAs.

This module is the home of [`sparse::DFA`](DFA).

Unlike the [`dense`] module, this module does not contain a builder or
configuration specific for sparse DFAs. Instead, the intended way to build a
sparse DFA is either by using a default configuration with its constructor
[`sparse::DFA::new`](DFA::new), or by first configuring the construction of a
dense DFA with [`dense::Builder`] and then calling [`dense::DFA::to_sparse`].
*/
//
// PORT: the target is little-endian; `StateID`/`PatternID` are `number`s. Deserializing borrows
// subarrays of the input (no copies). Building, serializing, validating (`from_bytes`), searching
// and `Debug` are not ported (unused on rustc's path).
import { panic } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { ByteClasses, ByteSet } from "../util/alphabet.ts";
import { PatternID, StateID } from "../util/primitives.ts";
import type { Anchored } from "../util/search.ts";
import { type Config, Start, StartByteMap } from "../util/start.ts";
import {
  add,
  check_slice_len,
  DeserializeError,
  mul,
  read_endianness_check,
  read_label,
  read_pattern_id_unchecked,
  read_state_id_unchecked,
  read_u16,
  read_u32,
  read_version,
  try_read_u32,
  try_read_u32_as_usize,
} from "../util/wire.ts";
import { StartError } from "./automaton.ts";
import { Flags } from "./dense.ts";
import { DEAD } from "./mod.ts";
import { Special } from "./special.ts";
import { StartKind } from "./start.ts";

const LABEL = "rust-regex-automata-dfa-sparse";
const VERSION = 2;

/// A sparse deterministic finite automaton (DFA) with variable sized states.
///
/// In contrast to a [dense::DFA], a sparse DFA uses a more space efficient
/// representation for its transitions. Consequently, sparse DFAs may use much
/// less memory than dense DFAs, but this comes at a price. In particular,
/// reading the more space efficient transitions takes more work, and
/// consequently, searching using a sparse DFA is typically slower than a dense
/// DFA.
///
/// (Details of upstream's type docs are not repeated here.)
// #[derive(Clone)]
export class DFA {
  constructor(
    public tt: Transitions,
    public st: StartTable,
    public special: Special,
    // PORT: `pre: Option<Prefilter>`; prefilters don't support serialization, so always `None`.
    public pre: undefined,
    public quitset: ByteSet,
    public flags: Flags,
  ) {}

  // crate-skip: regex-automata-0.4.13/src/dfa/sparse.rs:985 from_bytes the validating deserializer is unused (icu_list calls `from_bytes_unchecked`)

  /// Deserialize a DFA with a specific state identifier representation in
  /// constant time by omitting the verification of the validity of the
  /// sparse transitions.
  ///
  /// This is just like [`DFA::from_bytes`], except it can potentially return
  /// a DFA that exhibits undefined behavior if its transitions contains
  /// invalid state identifiers.
  ///
  /// This routine is useful if you need to deserialize a DFA cheaply and
  /// cannot afford the transition validation performed by `from_bytes`.
  ///
  /// # Safety
  ///
  /// This routine is not safe because it permits callers to provide
  /// arbitrary transitions with possibly incorrect state identifiers. While
  /// the various serialization routines will never return an incorrect
  /// DFA, there is no guarantee that the bytes provided here are correct.
  /// While `from_bytes_unchecked` will still do several forms of basic
  /// validation, this routine does not check that the transitions themselves
  /// are correct. Given an incorrect transition table, it is possible for
  /// the search routines to access out-of-bounds memory because of explicit
  /// bounds check elision.
  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1037 from_bytes_unchecked
  static from_bytes_unchecked(slice: Uint8Array): Result<[DFA, number], DeserializeError> {
    let nr = 0;

    let r: Result<number, DeserializeError> = read_label(slice.subarray(nr), LABEL);
    if (r.$ === "Err") return r;
    nr += r._0;
    r = read_endianness_check(slice.subarray(nr));
    if (r.$ === "Err") return r;
    nr += r._0;
    r = read_version(slice.subarray(nr), VERSION);
    if (r.$ === "Err") return r;
    nr += r._0;

    const _unused = try_read_u32(slice.subarray(nr), "unused space");
    if (_unused.$ === "Err") return _unused;
    nr += 4;

    const flags = Flags.from_bytes(slice.subarray(nr));
    if (flags.$ === "Err") return flags;
    nr += flags._0[1];

    const tt = Transitions.from_bytes_unchecked(slice.subarray(nr));
    if (tt.$ === "Err") return tt;
    nr += tt._0[1];

    const st = StartTable.from_bytes_unchecked(slice.subarray(nr));
    if (st.$ === "Err") return st;
    nr += st._0[1];

    const special = Special.from_bytes(slice.subarray(nr));
    if (special.$ === "Err") return special;
    nr += special._0[1];
    if (special._0[0].max >= tt._0[0].sparse().length) {
      return Err(DeserializeError.generic("max should not be greater than or equal to sparse bytes"));
    }

    const quitset = ByteSet.from_bytes(slice.subarray(nr));
    if (quitset.$ === "Err") return quitset;
    nr += quitset._0[1];

    // Prefilters don't support serialization, so they're always absent.
    const pre = undefined;
    return Ok([new DFA(tt._0[0], st._0[0], special._0[0], pre, quitset._0[0], flags._0[0]), nr]);
  }

  // unsafe impl<T: AsRef<[u8]>> Automaton for DFA<T>

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1121 is_special_state
  is_special_state(id: number): boolean {
    return this.special.is_special_state(id);
  }

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1126 is_dead_state
  is_dead_state(id: number): boolean {
    return this.special.is_dead_state(id);
  }

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1131 is_quit_state
  is_quit_state(id: number): boolean {
    return this.special.is_quit_state(id);
  }

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1136 is_match_state
  is_match_state(id: number): boolean {
    return this.special.is_match_state(id);
  }

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1141 is_start_state
  is_start_state(id: number): boolean {
    return this.special.is_start_state(id);
  }

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1146 is_accel_state
  is_accel_state(id: number): boolean {
    return this.special.is_accel_state(id);
  }

  // This is marked as inline to help dramatically boost sparse searching,
  // which decodes each state it enters to follow the next transition.
  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1153 next_state
  next_state(current: number, input: number): number {
    const class_ = this.tt.classes.get(input);
    return this.tt.state(current).next(class_);
  }

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1159 next_state_unchecked
  next_state_unchecked(current: number, input: number): number {
    return this.next_state(current, input);
  }

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1168 next_eoi_state
  next_eoi_state(current: number): number {
    return this.tt.state(current).next_eoi();
  }

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1173 pattern_len
  pattern_len(): number {
    return this.tt.pattern_len;
  }

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1178 match_len
  match_len(id: number): number {
    return this.tt.state(id).pattern_len();
  }

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1183 match_pattern
  match_pattern(id: number, match_index: number): number {
    // This is an optimization for the very common case of a DFA with a
    // single pattern. This conditional avoids a somewhat more costly path
    // that finds the pattern ID from the state machine, which requires
    // a bit of slicing/pointer-chasing. This optimization tends to only
    // matter when matches are frequent.
    if (this.tt.pattern_len === 1) {
      return PatternID.ZERO;
    }
    return this.tt.state(id).pattern_id(match_index);
  }

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1196 has_empty
  has_empty(): boolean {
    return this.flags.has_empty;
  }

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1201 is_utf8
  is_utf8(): boolean {
    return this.flags.is_utf8;
  }

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1206 is_always_start_anchored
  is_always_start_anchored(): boolean {
    return this.flags.is_always_start_anchored;
  }

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1211 start_state
  start_state(config: Config): Result<number, StartError> {
    const anchored = config.get_anchored();
    let start: Start;
    const byte = config.get_look_behind();
    if (byte === undefined) {
      start = "Text";
    } else {
      if (!this.quitset.is_empty() && this.quitset.contains(byte)) {
        return Err(StartError.quit(byte));
      }
      start = this.st.start_map.get(byte);
    }
    return this.st.start(anchored, start);
  }

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1229 universal_start_state
  universal_start_state(mode: Anchored): number | undefined {
    switch (mode.$) {
      case "No":
        return this.st.universal_start_unanchored;
      case "Yes":
        return this.st.universal_start_anchored;
      case "Pattern":
        return undefined;
    }
  }

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1238 accelerator
  accelerator(id: number): Uint8Array {
    return this.tt.state(id).accelerator();
  }

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1243 get_prefilter
  get_prefilter(): undefined {
    return this.pre;
  }
}

/// The transition table portion of a sparse DFA.
///
/// The transition table is the core part of the DFA in that it describes how
/// to move from one state to another based on the input sequence observed.
///
/// Unlike a typical dense table based DFA, states in a sparse transition
/// table have variable size. That is, states with more transitions use more
/// space than states with fewer transitions. This means that finding the next
/// transition takes more work than with a dense DFA, but also typically uses
/// much less space.
// #[derive(Clone)]
export class Transitions {
  constructor(
    /// The raw encoding of each state in this DFA.
    ///
    /// Each state has the following information:
    ///
    /// * A set of transitions to subsequent states. Transitions to the dead
    ///   state are omitted.
    /// * If the state can be accelerated, then any additional accelerator
    ///   information.
    /// * If the state is a match state, then the state contains all pattern
    ///   IDs that match when in that state.
    ///
    /// To decode a state, use Transitions::state.
    ///
    /// In practice, T is either Vec<u8> or &[u8].
    public sparse_: Uint8Array,
    /// A set of equivalence classes, where a single equivalence class
    /// represents a set of bytes that never discriminate between a match
    /// and a non-match in the DFA. (Details of upstream's docs are not repeated here.)
    public classes: ByteClasses,
    /// The total number of states in this DFA. Note that a DFA always has at
    /// least one state---the dead state---even the empty DFA. In particular,
    /// the dead state always has ID 0 and is correspondingly always the first
    /// state. The dead state is never a match state.
    public state_len: number,
    /// The total number of unique patterns represented by these match states.
    public pattern_len: number,
  ) {}

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1314 from_bytes_unchecked
  static from_bytes_unchecked(slice: Uint8Array): Result<[Transitions, number], DeserializeError> {
    const slice_start = slice.byteOffset;

    const sl = try_read_u32_as_usize(slice, "state length");
    if (sl.$ === "Err") return sl;
    const [state_len, nr1] = sl._0;
    slice = slice.subarray(nr1);

    const pl = try_read_u32_as_usize(slice, "pattern length");
    if (pl.$ === "Err") return pl;
    const [pattern_len, nr2] = pl._0;
    slice = slice.subarray(nr2);

    const cl = ByteClasses.from_bytes(slice);
    if (cl.$ === "Err") return cl;
    const [classes, nr3] = cl._0;
    slice = slice.subarray(nr3);

    const ln = try_read_u32_as_usize(slice, "sparse transitions length");
    if (ln.$ === "Err") return ln;
    const [len, nr4] = ln._0;
    slice = slice.subarray(nr4);

    const c = check_slice_len(slice, len, "sparse states byte length");
    if (c.$ === "Err") return c;
    const sparse = slice.subarray(0, len);
    slice = slice.subarray(len);

    const trans = new Transitions(sparse, classes, state_len, pattern_len);
    return Ok([trans, slice.byteOffset - slice_start]);
  }

  /// Return a convenient representation of the given state.
  ///
  /// This panics if the state is invalid.
  ///
  /// This is marked as inline to help dramatically boost sparse searching,
  /// which decodes each state it enters to follow the next transition. Other
  /// functions involved are also inlined, which should hopefully eliminate
  /// a lot of the extraneous decoding that is never needed just to follow
  /// the next transition.
  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1513 state
  state(id: number): State {
    let state = this.sparse().subarray(id);
    let ntrans = read_u16(state);
    const is_match = ((1 << 15) & ntrans) !== 0;
    ntrans &= ~(1 << 15);
    state = state.subarray(2);

    const input_ranges = split_at(state, ntrans * 2);
    state = input_ranges[1];
    const next = split_at(state, ntrans * StateID.SIZE);
    state = next[1];
    let pattern_ids: Uint8Array;
    if (is_match) {
      const npats = read_u32(state);
      const r = split_at(state.subarray(4), npats * 4);
      pattern_ids = r[0];
      state = r[1];
    } else {
      pattern_ids = new Uint8Array(0);
    }

    const accel_len = index(state, 0);
    const accel = state.subarray(1, accel_len + 1);
    if (accel.length !== accel_len) panic(`range end index ${accel_len + 1} out of range for slice of length ${state.length}`);
    return new State(id, is_match, ntrans, input_ranges[0], next[0], pattern_ids, accel);
  }

  /// Returns the sparse transitions as raw bytes.
  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1712 sparse
  sparse(): Uint8Array {
    return this.sparse_;
  }
}

/** `<[u8]>::split_at` (panics if `mid > len`). */
function split_at(s: Uint8Array, mid: number): [Uint8Array, Uint8Array] {
  if (mid > s.length) panic("mid > len");
  return [s.subarray(0, mid), s.subarray(mid)];
}

/** `slice[i]` (panics out of bounds). */
function index(s: Uint8Array, i: number): number {
  if (i >= s.length) panic(`index out of bounds: the len is ${s.length} but the index is ${i}`);
  return s[i]!;
}

/// The set of all possible starting states in a DFA.
///
/// (Details of upstream's type docs are not repeated here.)
// #[derive(Clone)]
export class StartTable {
  constructor(
    /// The initial start state IDs as a contiguous table of native endian
    /// encoded integers, represented by `S`.
    ///
    /// In practice, T is either Vec<u8> or &[u8] and has no alignment
    /// requirements.
    ///
    /// The first `2 * stride` (currently always 8) entries always correspond
    /// to the starts states for the entire DFA, with the first 4 entries being
    /// for unanchored searches and the second 4 entries being for anchored
    /// searches. To keep things simple, we always use 8 entries even if the
    /// `StartKind` is not both.
    ///
    /// After that, there are `stride * patterns` state IDs, where `patterns`
    /// may be zero in the case of a DFA with no patterns or in the case where
    /// the DFA was built without enabling starting states for each pattern.
    public table_: Uint8Array,
    /// The starting state configuration supported. When 'both', both
    /// unanchored and anchored searches work. When 'unanchored', anchored
    /// searches panic. When 'anchored', unanchored searches panic.
    public kind: StartKind,
    /// The start state configuration for every possible byte.
    public start_map: StartByteMap,
    /// The number of starting state IDs per pattern.
    public stride: number,
    /// The total number of patterns for which starting states are encoded.
    /// This is `None` for DFAs that were built without start states for each
    /// pattern. Thus, one cannot use this field to say how many patterns
    /// are in the DFA in all cases. It is specific to how many patterns are
    /// represented in this start table.
    public pattern_len: number | undefined,
    /// The universal starting state for unanchored searches. This is only
    /// present when the DFA supports unanchored searches and when all starting
    /// state IDs for an unanchored search are equivalent.
    public universal_start_unanchored: number | undefined,
    /// The universal starting state for anchored searches. This is only
    /// present when the DFA supports anchored searches and when all starting
    /// state IDs for an anchored search are equivalent.
    public universal_start_anchored: number | undefined,
  ) {}

  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:1874 from_bytes_unchecked
  static from_bytes_unchecked(slice: Uint8Array): Result<[StartTable, number], DeserializeError> {
    const slice_start = slice.byteOffset;

    const k = StartKind.from_bytes(slice);
    if (k.$ === "Err") return k;
    const [kind, nr1] = k._0;
    slice = slice.subarray(nr1);

    const sm = StartByteMap.from_bytes(slice);
    if (sm.$ === "Err") return sm;
    const [start_map, nr2] = sm._0;
    slice = slice.subarray(nr2);

    const st = try_read_u32_as_usize(slice, "sparse start table stride");
    if (st.$ === "Err") return st;
    const [stride, nr3] = st._0;
    slice = slice.subarray(nr3);
    if (stride !== Start.len()) {
      return Err(DeserializeError.generic("invalid sparse starting table stride"));
    }

    const mp = try_read_u32_as_usize(slice, "sparse start table patterns");
    if (mp.$ === "Err") return mp;
    const [maybe_pattern_len, nr4] = mp._0;
    slice = slice.subarray(nr4);
    const pattern_len = maybe_pattern_len === 0xffffffff ? undefined : maybe_pattern_len;
    if (pattern_len !== undefined && pattern_len > PatternID.LIMIT) {
      return Err(DeserializeError.generic("sparse invalid number of patterns"));
    }

    const uu = try_read_u32(slice, "universal unanchored start");
    if (uu.$ === "Err") return uu;
    const [universal_unanchored, nr5] = uu._0;
    slice = slice.subarray(nr5);
    let universal_start_unanchored: number | undefined;
    if (universal_unanchored === 0xffffffff) {
      universal_start_unanchored = undefined;
    } else {
      const id = StateID.try_from(universal_unanchored);
      if (id.$ === "Err") return Err(DeserializeError.state_id_error(id._0, "universal unanchored start"));
      universal_start_unanchored = id._0;
    }

    const ua = try_read_u32(slice, "universal anchored start");
    if (ua.$ === "Err") return ua;
    const [universal_anchored, nr6] = ua._0;
    slice = slice.subarray(nr6);
    let universal_start_anchored: number | undefined;
    if (universal_anchored === 0xffffffff) {
      universal_start_anchored = undefined;
    } else {
      const id = StateID.try_from(universal_anchored);
      if (id.$ === "Err") return Err(DeserializeError.state_id_error(id._0, "universal anchored start"));
      universal_start_anchored = id._0;
    }

    const pattern_table_size = mul(stride, pattern_len ?? 0, "sparse invalid pattern length");
    if (pattern_table_size.$ === "Err") return pattern_table_size;
    // Our start states always start with a single stride of start states
    // for the entire automaton which permit it to match any pattern. What
    // follows it are an optional set of start states for each pattern.
    const two_strides = mul(2, stride, "start state stride too big");
    if (two_strides.$ === "Err") return two_strides;
    const start_state_len = add(two_strides._0, pattern_table_size._0, "sparse invalid 'any' pattern starts size");
    if (start_state_len.$ === "Err") return start_state_len;
    const table_bytes_len = mul(start_state_len._0, StateID.SIZE, "sparse pattern table bytes length");
    if (table_bytes_len.$ === "Err") return table_bytes_len;
    const c = check_slice_len(slice, table_bytes_len._0, "sparse start ID table");
    if (c.$ === "Err") return c;
    const table = slice.subarray(0, table_bytes_len._0);
    slice = slice.subarray(table_bytes_len._0);

    const sl = new StartTable(table, kind, start_map, stride, pattern_len, universal_start_unanchored, universal_start_anchored);
    return Ok([sl, slice.byteOffset - slice_start]);
  }

  /// Return the start state for the given index and pattern ID. If the
  /// pattern ID is None, then the corresponding start state for the entire
  /// DFA is returned. If the pattern ID is not None, then the corresponding
  /// starting state for the given pattern is returned. If this start table
  /// does not have individual starting states for each pattern, then this
  /// panics.
  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:2090 start
  start(anchored: Anchored, start: Start): Result<number, StartError> {
    const start_index = Start.as_usize(start);
    let index: number;
    switch (anchored.$) {
      case "No":
        if (!StartKind.has_unanchored(this.kind)) {
          return Err(StartError.unsupported_anchored(anchored));
        }
        index = start_index;
        break;
      case "Yes":
        if (!StartKind.has_anchored(this.kind)) {
          return Err(StartError.unsupported_anchored(anchored));
        }
        index = this.stride + start_index;
        break;
      case "Pattern": {
        const pid = anchored._0;
        if (this.pattern_len === undefined) {
          return Err(StartError.unsupported_anchored(anchored));
        }
        const len = this.pattern_len;
        if (pid >= len) {
          return Ok(DEAD);
        }
        index = 2 * this.stride + this.stride * pid + start_index;
        break;
      }
    }
    const start_ = index * StateID.SIZE;
    // This OK since we're allowed to assume that the start table contains
    // valid StateIDs.
    return Ok(read_state_id_unchecked(this.table().subarray(start_))[0]);
  }

  /// Returns the total number of start state IDs in this table.
  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:2136 len
  len(): number {
    return Math.floor(this.table().length / StateID.SIZE);
  }

  /// Returns the table as a raw slice of bytes.
  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:2141 table
  table(): Uint8Array {
    return this.table_;
  }
}

/// A representation of a sparse DFA state that can be cheaply materialized
/// from a state identifier.
// #[derive(Clone)]
export class State {
  constructor(
    /// The identifier of this state.
    public id_: number,
    /// Whether this is a match state or not.
    public is_match: boolean,
    /// The number of transitions in this state.
    public ntrans: number,
    /// Pairs of input ranges, where there is one pair for each transition.
    /// Each pair specifies an inclusive start and end byte range for the
    /// corresponding transition.
    public input_ranges: Uint8Array,
    /// Transitions to the next state. This slice contains native endian
    /// encoded state identifiers, with `S` as the representation. Thus, there
    /// are `ntrans * size_of::<S>()` bytes in this slice.
    public next_: Uint8Array,
    /// If this is a match state, then this contains the pattern IDs that match
    /// when the DFA is in this state.
    ///
    /// This is a contiguous sequence of 32-bit native endian encoded integers.
    public pattern_ids: Uint8Array,
    /// An accelerator for this state, if present. If this state has no
    /// accelerator, then this is an empty slice. When non-empty, this slice
    /// has length at most 3 and corresponds to the exhaustive set of bytes
    /// that must be seen in order to transition out of this state.
    public accel: Uint8Array,
  ) {}

  /// Searches for the next transition given an input byte. If no such
  /// transition could be found, then a dead state is returned.
  ///
  /// This is marked as inline to help dramatically boost sparse searching,
  /// which decodes each state it enters to follow the next transition.
  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:2295 next
  next(input: number): number {
    // This straight linear search was observed to be much better than
    // binary search on ASCII haystacks, likely because a binary search
    // visits the ASCII case last but a linear search sees it first. A
    // binary search does do a little better on non-ASCII haystacks, but
    // not by much. There might be a better trade off lurking here.
    for (let i = 0; i < this.ntrans - 1; i++) {
      const [start, end] = this.range(i);
      if (start <= input && input <= end) {
        return this.next_at(i);
      }
      // We could bail early with an extra branch: if input < b1, then
      // we know we'll never find a matching transition. Interestingly,
      // this extra branch seems to not help performance, or will even
      // hurt it. It's likely very dependent on the DFA itself and what
      // is being searched.
    }
    return DEAD;
  }

  /// Returns the next state ID for the special EOI transition.
  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:2316 next_eoi
  next_eoi(): number {
    return this.next_at(this.ntrans - 1);
  }

  /// Returns the identifier for this state.
  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:2321 id
  id(): number {
    return this.id_;
  }

  /// Returns the inclusive input byte range for the ith transition in this
  /// state.
  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:2327 range
  range(i: number): [number, number] {
    return [index(this.input_ranges, i * 2), index(this.input_ranges, i * 2 + 1)];
  }

  /// Returns the next state for the ith transition in this state.
  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:2332 next_at
  next_at(i: number): number {
    const start = i * StateID.SIZE;
    const end = start + StateID.SIZE;
    if (end > this.next_.length) panic(`range end index ${end} out of range for slice of length ${this.next_.length}`);
    const bytes = this.next_.subarray(start, end);
    return StateID.from_ne_bytes_unchecked(bytes);
  }

  /// Returns the pattern ID for the given match index. If the match index
  /// is invalid, then this panics.
  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:2341 pattern_id
  pattern_id(match_index: number): number {
    const start = match_index * PatternID.SIZE;
    return read_pattern_id_unchecked(this.pattern_ids.subarray(start))[0];
  }

  /// Returns the total number of pattern IDs for this state. This is always
  /// zero when `is_match` is false.
  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:2348 pattern_len
  pattern_len(): number {
    // assert_eq!(0, self.pattern_ids.len() % 4);
    if (this.pattern_ids.length % 4 !== 0) panic("assertion `left == right` failed");
    return this.pattern_ids.length / 4;
  }

  /// Return an accelerator for this state.
  // crate: regex-automata-0.4.13/src/dfa/sparse.rs:2354 accelerator
  accelerator(): Uint8Array {
    return this.accel;
  }
}
