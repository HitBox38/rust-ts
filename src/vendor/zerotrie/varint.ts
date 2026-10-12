// Port of zerotrie 0.2.5 `src/varint.rs` (the readers).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! Varint spec for ZeroTrie:
//!
//! - Lead byte: top M (2 or 3) bits are metadata; next is varint extender; rest is value
//! - Trail bytes: top bit is varint extender; rest are low bits of value
//! - Guaranteed uniqueness of varint by adding "latent value" for each extender byte
//! - No maximum, but high bits will be dropped if they don't fit in the platform's `usize`
//!
//! (The examples of upstream's module docs are not repeated here.)
//
// PORT: `usize` arithmetic on JS numbers; trie offsets and values are small (bounded by the trie
// size), so `(value << 7)` is computed as `value * 128` without wrapping.

/// Reads a varint with 2 bits of metadata in the lead byte.
///
/// Returns the varint value and a subslice of `remainder` with the varint bytes removed.
///
/// If the varint spills off the end of the slice, a debug assertion will fail,
/// and the function will return the value up to that point.
// crate: zerotrie-0.2.5/src/varint.rs:53 read_varint_meta2
export function read_varint_meta2(start: number, remainder: Uint8Array): [number, Uint8Array] {
  let value = start & 0b00011111;
  if ((start & 0b00100000) !== 0) {
    for (;;) {
      if (remainder.length === 0) {
        // debug_unwrap!(remainder.split_first(), break, "invalid varint");
        break;
      }
      const next = remainder[0]!;
      remainder = remainder.subarray(1);
      // Note: value << 7 could drop high bits. The first addition can't overflow.
      // The second addition could overflow; in such a case we just inform the
      // developer via the debug assertion.
      value = value * 128 + (next & 0b01111111) + 32;
      if ((next & 0b10000000) === 0) {
        break;
      }
    }
  }
  return [value, remainder];
}

/// Reads a varint with 3 bits of metadata in the lead byte.
///
/// Returns the varint value and a subslice of `remainder` with the varint bytes removed.
///
/// If the varint spills off the end of the slice, a debug assertion will fail,
/// and the function will return the value up to that point.
// crate: zerotrie-0.2.5/src/varint.rs:78 read_varint_meta3
export function read_varint_meta3(start: number, remainder: Uint8Array): [number, Uint8Array] {
  let value = start & 0b00001111;
  if ((start & 0b00010000) !== 0) {
    for (;;) {
      if (remainder.length === 0) {
        // debug_unwrap!(remainder.split_first(), break, "invalid varint");
        break;
      }
      const next = remainder[0]!;
      remainder = remainder.subarray(1);
      // Note: value << 7 could drop high bits. The first addition can't overflow.
      // The second addition could overflow; in such a case we just inform the
      // developer via the debug assertion.
      value = value * 128 + (next & 0b01111111) + 16;
      if ((next & 0b10000000) === 0) {
        break;
      }
    }
  }
  return [value, remainder];
}
