// Port of regex-automata 0.4.13 `src/util/wire.rs` (the readers used by sparse DFA deserialization).
//
// Copyright (c) 2015 The Rust Project Developers; licensed under MIT OR Apache-2.0 (regex-automata).
//
// PORT: the target is little-endian (the oracle hosts aarch64 and x86_64 are), so `from_ne_bytes`
// reads little-endian. `StateID`/`PatternID` are `number`s (u32).
import { assert } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { PatternID, StateID } from "./primitives.ts";

/// An error that occurs when a regex engine fails to deserialize itself.
// #[derive(Clone, Debug)]
export class DeserializeError {
  constructor(readonly _0: DeserializeErrorKind) {}

  // crate: regex-automata-0.4.13/src/util/wire.rs:155 generic
  static generic(msg: string): DeserializeError {
    return new DeserializeError({ $: "Generic", msg });
  }

  // crate: regex-automata-0.4.13/src/util/wire.rs:159 buffer_too_small
  static buffer_too_small(what: string): DeserializeError {
    return new DeserializeError({ $: "BufferTooSmall", what });
  }

  // crate: regex-automata-0.4.13/src/util/wire.rs:163 invalid_usize
  static invalid_usize(what: string): DeserializeError {
    return new DeserializeError({ $: "InvalidUsize", what });
  }

  // crate: regex-automata-0.4.13/src/util/wire.rs:167 version_mismatch
  static version_mismatch(expected: number, found: number): DeserializeError {
    return new DeserializeError({ $: "VersionMismatch", expected, found });
  }

  // crate: regex-automata-0.4.13/src/util/wire.rs:174 endian_mismatch
  static endian_mismatch(expected: number, found: number): DeserializeError {
    return new DeserializeError({ $: "EndianMismatch", expected, found });
  }

  // crate: regex-automata-0.4.13/src/util/wire.rs:191 label_mismatch
  static label_mismatch(expected: string): DeserializeError {
    return new DeserializeError({ $: "LabelMismatch", expected });
  }

  // crate: regex-automata-0.4.13/src/util/wire.rs:195 arithmetic_overflow
  static arithmetic_overflow(what: string): DeserializeError {
    return new DeserializeError({ $: "ArithmeticOverflow", what });
  }

  // crate: regex-automata-0.4.13/src/util/wire.rs:199 pattern_id_error
  static pattern_id_error(err: { attempted: number }, what: string): DeserializeError {
    return new DeserializeError({ $: "PatternID", err, what });
  }

  // crate: regex-automata-0.4.13/src/util/wire.rs:206 state_id_error
  static state_id_error(err: { attempted: number }, what: string): DeserializeError {
    return new DeserializeError({ $: "StateID", err, what });
  }
}

// #[derive(Debug)]
export type DeserializeErrorKind =
  | { readonly $: "Generic"; readonly msg: string }
  | { readonly $: "BufferTooSmall"; readonly what: string }
  | { readonly $: "InvalidUsize"; readonly what: string }
  | { readonly $: "VersionMismatch"; readonly expected: number; readonly found: number }
  | { readonly $: "EndianMismatch"; readonly expected: number; readonly found: number }
  | { readonly $: "AlignmentMismatch"; readonly alignment: number; readonly address: number }
  | { readonly $: "LabelMismatch"; readonly expected: string }
  | { readonly $: "ArithmeticOverflow"; readonly what: string }
  | { readonly $: "PatternID"; readonly err: { attempted: number }; readonly what: string }
  | { readonly $: "StateID"; readonly err: { attempted: number }; readonly what: string };

/// Reads a NUL terminated label starting at the beginning of the given slice.
///
/// If a NUL terminated label could not be found, then an error is returned.
/// Similarly, if a label is found but doesn't match the expected label, then
/// an error is returned.
///
/// Upon success, the total number of bytes read (including padding bytes) is
/// returned.
// crate: regex-automata-0.4.13/src/util/wire.rs:414 read_label
export function read_label(slice: Uint8Array, expected_label: string): Result<number, DeserializeError> {
  // Set an upper bound on how many bytes we scan for a NUL. Since no label
  // in this crate is longer than 256 bytes, if we can't find one within that
  // range, then we have corrupted data.
  const first_nul_ = slice.subarray(0, Math.min(slice.length, 256)).indexOf(0);
  if (first_nul_ < 0) {
    return Err(DeserializeError.generic("could not find NUL terminated label at start of serialized object"));
  }
  const first_nul = first_nul_;
  const len = first_nul + padding_len(first_nul);
  if (slice.length < len) {
    return Err(DeserializeError.generic("could not find properly sized label at start of serialized object"));
  }
  const label = new TextEncoder().encode(expected_label);
  const got = slice.subarray(0, first_nul);
  if (label.length !== got.length || label.some((b, i) => b !== got[i])) {
    return Err(DeserializeError.label_mismatch(expected_label));
  }
  return Ok(len);
}

/// Reads an endianness check from the beginning of the given slice and
/// confirms that the endianness of the serialized object matches the expected
/// endianness. If the slice is too small or if the endianness check fails,
/// this returns an error.
///
/// Upon success, the total number of bytes read is returned.
// crate: regex-automata-0.4.13/src/util/wire.rs:486 read_endianness_check
export function read_endianness_check(slice: Uint8Array): Result<number, DeserializeError> {
  const r = try_read_u32(slice, "endianness check");
  if (r.$ === "Err") return r;
  const [n, nr] = r._0;
  assert(nr === write_endianness_check_len(), "assertion `left == right` failed");
  if (n !== 0xfeff) {
    return Err(DeserializeError.endian_mismatch(0xfeff, n));
  }
  return Ok(nr);
}

/// Return the number of bytes written by `write_endianness_check`.
// crate: regex-automata-0.4.13/src/util/wire.rs:516 write_endianness_check_len
export function write_endianness_check_len(): number {
  return 4;
}

/// Reads a version number from the beginning of the given slice and confirms
/// that is matches the expected version number given. If the slice is too
/// small or if the version numbers aren't equivalent, this returns an error.
///
/// Upon success, the total number of bytes read is returned.
// crate: regex-automata-0.4.13/src/util/wire.rs:529 read_version
export function read_version(slice: Uint8Array, expected_version: number): Result<number, DeserializeError> {
  const r = try_read_u32(slice, "version");
  if (r.$ === "Err") return r;
  const [n, nr] = r._0;
  assert(nr === write_version_len(), "assertion `left == right` failed");
  if (n !== expected_version) {
    return Err(DeserializeError.version_mismatch(expected_version, n));
  }
  return Ok(nr);
}

/// Return the number of bytes written by `write_version`.
// crate: regex-automata-0.4.13/src/util/wire.rs:561 write_version_len
export function write_version_len(): number {
  return 4;
}

/// Reads a pattern ID from the given slice. If the slice has insufficient
/// length, then this panics. Otherwise, the deserialized pattern ID is
/// returned along with the number of bytes read. Unlike `read_pattern_id`,
/// this does not validate the pattern ID.
// crate: regex-automata-0.4.13/src/util/wire.rs:586 read_pattern_id_unchecked
export function read_pattern_id_unchecked(slice: Uint8Array): [number, number] {
  const pid = PatternID.from_ne_bytes_unchecked(slice.subarray(0, PatternID.SIZE));
  return [pid, PatternID.SIZE];
}

/// Attempts to read a state ID from the given slice. If the slice has an
/// insufficient number of bytes or if the state ID exceeds the limit for
/// the current target, then this returns an error.
///
/// Upon success, this also returns the number of bytes read.
// crate: regex-automata-0.4.13/src/util/wire.rs:610 try_read_state_id
export function try_read_state_id(slice: Uint8Array, what: string): Result<[number, number], DeserializeError> {
  if (slice.length < StateID.SIZE) {
    return Err(DeserializeError.buffer_too_small(what));
  }
  return read_state_id(slice, what);
}

/// Reads a state ID from the given slice. If the slice has an insufficient
/// number of bytes, then this panics. Otherwise, the deserialized state ID is
/// returned along with the number of bytes read.
// crate: regex-automata-0.4.13/src/util/wire.rs:625 read_state_id
export function read_state_id(slice: Uint8Array, what: string): Result<[number, number], DeserializeError> {
  const sid = StateID.from_ne_bytes(slice.subarray(0, StateID.SIZE));
  if (sid.$ === "Err") return Err(DeserializeError.state_id_error(sid._0, what));
  return Ok([sid._0, StateID.SIZE]);
}

/// Reads a state ID from the given slice. If the slice has insufficient
/// length, then this panics. Otherwise, the deserialized state ID is returned
/// along with the number of bytes read. Unlike `read_state_id`, this does not
/// validate the state ID.
// crate: regex-automata-0.4.13/src/util/wire.rs:641 read_state_id_unchecked
export function read_state_id_unchecked(slice: Uint8Array): [number, number] {
  const sid = StateID.from_ne_bytes_unchecked(slice.subarray(0, StateID.SIZE));
  return [sid, StateID.SIZE];
}

/// Try to read a u32 as a usize from the beginning of the given slice in
/// native endian format. If the slice has fewer than 4 bytes or if the
/// deserialized number cannot be represented by usize, then this returns an
/// error. The error message will include the `what` description of what is
/// being deserialized, for better error messages. `what` should be a noun in
/// singular form.
///
/// Upon success, this also returns the number of bytes read.
// crate: regex-automata-0.4.13/src/util/wire.rs:687 try_read_u32_as_usize
export function try_read_u32_as_usize(slice: Uint8Array, what: string): Result<[number, number], DeserializeError> {
  // `usize::try_from(u32)` never fails on 32/64-bit targets
  return try_read_u32(slice, what);
}

/// Try to read a u32 from the beginning of the given slice in native endian
/// format. If the slice has fewer than 4 bytes, then this returns an error.
/// The error message will include the `what` description of what is being
/// deserialized, for better error messages. `what` should be a noun in
/// singular form.
///
/// Upon success, this also returns the number of bytes read.
// crate: regex-automata-0.4.13/src/util/wire.rs:720 try_read_u32
export function try_read_u32(slice: Uint8Array, what: string): Result<[number, number], DeserializeError> {
  const c = check_slice_len(slice, 4, what);
  if (c.$ === "Err") return c;
  return Ok([read_u32(slice), 4]);
}

/// Try to read a u128 from the beginning of the given slice in native endian
/// format. If the slice has fewer than 16 bytes, then this returns an error.
/// The error message will include the `what` description of what is being
/// deserialized, for better error messages. `what` should be a noun in
/// singular form.
///
/// Upon success, this also returns the number of bytes read.
// crate: regex-automata-0.4.13/src/util/wire.rs:735 try_read_u128
export function try_read_u128(slice: Uint8Array, what: string): Result<[bigint, number], DeserializeError> {
  const c = check_slice_len(slice, 16, what);
  if (c.$ === "Err") return c;
  return Ok([read_u128(slice), 16]);
}

/// Read a u16 from the beginning of the given slice in native endian format.
/// If the slice has fewer than 2 bytes, then this panics.
///
/// Marked as inline to speed up sparse searching which decodes integers from
/// its automaton at search time.
// crate: regex-automata-0.4.13/src/util/wire.rs:749 read_u16
export function read_u16(slice: Uint8Array): number {
  return slice[0]! | (slice[1]! << 8);
}

/// Read a u32 from the beginning of the given slice in native endian format.
/// If the slice has fewer than 4 bytes, then this panics.
///
/// Marked as inline to speed up sparse searching which decodes integers from
/// its automaton at search time.
// crate: regex-automata-0.4.13/src/util/wire.rs:760 read_u32
export function read_u32(slice: Uint8Array): number {
  return (slice[0]! | (slice[1]! << 8) | (slice[2]! << 16) | (slice[3]! << 24)) >>> 0;
}

/// Read a u128 from the beginning of the given slice in native endian format.
/// If the slice has fewer than 16 bytes, then this panics.
// crate: regex-automata-0.4.13/src/util/wire.rs:767 read_u128
export function read_u128(slice: Uint8Array): bigint {
  let v = 0n;
  for (let i = 15; i >= 0; i--) v = (v << 8n) | BigInt(slice[i]!);
  return v;
}

/// Checks that the given slice has some minimal length. If it's smaller than
/// the bound given, then a "buffer too small" error is returned with `what`
/// describing what the buffer represents.
// crate: regex-automata-0.4.13/src/util/wire.rs:775 check_slice_len
export function check_slice_len(slice: { length: number }, at_least_len: number, what: string): Result<undefined, DeserializeError> {
  if (slice.length < at_least_len) {
    return Err(DeserializeError.buffer_too_small(what));
  }
  return Ok(undefined);
}

/// Multiply the given numbers, and on overflow, return an error that includes
/// 'what' in the error message.
///
/// This is useful when doing arithmetic with untrusted data.
// crate: regex-automata-0.4.13/src/util/wire.rs:790 mul
export function mul(a: number, b: number, what: string): Result<number, DeserializeError> {
  const c = a * b;
  // PORT: `usize::checked_mul` (64-bit); values here are bounded by the serialized size.
  if (!Number.isSafeInteger(c)) return Err(DeserializeError.arithmetic_overflow(what));
  return Ok(c);
}

/// Add the given numbers, and on overflow, return an error that includes
/// 'what' in the error message.
///
/// This is useful when doing arithmetic with untrusted data.
// crate: regex-automata-0.4.13/src/util/wire.rs:805 add
export function add(a: number, b: number, what: string): Result<number, DeserializeError> {
  const c = a + b;
  // PORT: `usize::checked_add` (64-bit); values here are bounded by the serialized size.
  if (!Number.isSafeInteger(c)) return Err(DeserializeError.arithmetic_overflow(what));
  return Ok(c);
}

/// Returns the number of additional bytes required to add to the given length
/// in order to make the total length a multiple of 4. The return value is
/// always less than 4.
// crate: regex-automata-0.4.13/src/util/wire.rs:836 padding_len
export function padding_len(non_padding_len: number): number {
  return (4 - (non_padding_len & 0b11)) & 0b11;
}
