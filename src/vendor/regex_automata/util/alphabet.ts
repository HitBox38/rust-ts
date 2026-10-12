// Port of regex-automata 0.4.13 `src/util/alphabet.rs` (`ByteClasses` / `ByteSet` deserialization and
// lookups used by the sparse DFA).
//
// Copyright (c) 2015 The Rust Project Developers; licensed under MIT OR Apache-2.0 (regex-automata).
//
// PORT: the target is little-endian (the oracle hosts aarch64 and x86_64 are), so `from_ne_bytes`
// reads little-endian. `StateID`/`PatternID` are `number`s (u32).
import { Err, Ok, type Result } from "../../../std/result.ts";
import { check_slice_len, DeserializeError, try_read_u128 } from "./wire.ts";

/// A representation of byte oriented equivalence classes.
///
/// This is used in a DFA to reduce the size of the transition table. This can
/// have a particularly large impact not only on the total size of a dense DFA,
/// but also on compile times.
// #[derive(Clone, Copy)]
export class ByteClasses {
  constructor(public _0: Uint8Array /* [u8; 256] */) {}

  /// Creates a new class map where every byte is mapped to the same class.
  // crate: regex-automata-0.4.13/src/util/alphabet.rs:221 empty
  static empty(): ByteClasses {
    return new ByteClasses(new Uint8Array(256));
  }

  /// Deserializes a byte class map from the given slice. If the slice is of
  /// insufficient length or otherwise contains an impossible mapping, then
  /// an error is returned. Upon success, the number of bytes read along with
  /// the map are returned. The number of bytes read is always a multiple of
  /// 8.
  // crate: regex-automata-0.4.13/src/util/alphabet.rs:241 from_bytes
  static from_bytes(slice: Uint8Array): Result<[ByteClasses, number], DeserializeError> {
    const c = check_slice_len(slice, 256, "byte class map");
    if (c.$ === "Err") return c;
    const classes = ByteClasses.empty();
    for (let b = 0; b < 256; b++) {
      classes.set(b, slice[b]!);
    }
    // We specifically don't use 'classes.iter()' here because that
    // iterator depends on 'classes.alphabet_len()' being correct. But that
    // is precisely the thing we're trying to verify below!
    for (const b of classes._0) {
      if (b >= classes.alphabet_len()) {
        return Err(DeserializeError.generic("found equivalence class greater than alphabet len"));
      }
    }
    return Ok([classes, 256]);
  }

  /// Set the equivalence class for the given byte.
  // crate: regex-automata-0.4.13/src/util/alphabet.rs:288 set
  set(byte: number, class_: number): void {
    this._0[byte] = class_;
  }

  /// Get the equivalence class for the given byte.
  // crate: regex-automata-0.4.13/src/util/alphabet.rs:294 get
  get(byte: number): number {
    return this._0[byte]!;
  }

  /// Return the total number of elements in the alphabet represented by
  /// these equivalence classes. Equivalently, this returns the total number
  /// of equivalence classes.
  // crate: regex-automata-0.4.13/src/util/alphabet.rs:321 alphabet_len
  alphabet_len(): number {
    // Add one since the number of equivalence classes is one bigger than
    // the last one. But add another to account for the final EOI class
    // that isn't explicitly represented.
    return this._0[255]! + 1 + 1;
  }
}

/// A set of bytes.
// #[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
export class ByteSet {
  constructor(public bits: [bigint, bigint] /* BitSet([u128; 2]) */) {}

  /// Create an empty set of bytes.
  // crate: regex-automata-0.4.13/src/util/alphabet.rs:753 empty
  static empty(): ByteSet {
    return new ByteSet([0n, 0n]);
  }

  /// Return true if and only if the given byte is in this set.
  // crate: regex-automata-0.4.13/src/util/alphabet.rs:776 contains
  contains(byte: number): boolean {
    const bucket = Math.floor(byte / 128);
    const bit = BigInt(byte % 128);
    return (this.bits[bucket]! & (1n << bit)) > 0n;
  }

  /// Return true if and only if this set is empty.
  // crate: regex-automata-0.4.13/src/util/alphabet.rs:800 is_empty
  is_empty(): boolean {
    return this.bits[0] === 0n && this.bits[1] === 0n;
  }

  /// Deserializes a byte set from the given slice. If the slice is of
  /// incorrect length or is otherwise malformed, then an error is returned.
  /// Upon success, the number of bytes read along with the set are returned.
  /// The number of bytes read is always a multiple of 8.
  // crate: regex-automata-0.4.13/src/util/alphabet.rs:808 from_bytes
  static from_bytes(slice: Uint8Array): Result<[ByteSet, number], DeserializeError> {
    const c = check_slice_len(slice, 2 * 16, "byte set");
    if (c.$ === "Err") return c;
    let nread = 0;
    const low = try_read_u128(slice, "byte set low bucket");
    if (low.$ === "Err") return low;
    nread += low._0[1];
    const high = try_read_u128(slice, "byte set high bucket");
    if (high.$ === "Err") return high;
    nread += high._0[1];
    return Ok([new ByteSet([low._0[0], high._0[0]]), nread]);
  }
}
