//! The [`Word`] trait
//
// Port of rand_core =0.10.1 `src/word.rs`.
// PORT: the sealed trait is a function table per word type (`Word_u32` over `number`, `Word_u64` over `bigint`);
// generic code over `W: Word` takes the table. `Self::Bytes` (`[u8; 4]` / `[u8; 8]`) is a `Uint8Array` of
// `size_of::<W>()` bytes; `size` and `default` stand for `size_of::<W>()` and `W::default()`.
import { assert } from "../../std/panic.ts";

const U64_MASK = 0xffff_ffff_ffff_ffffn;

/// A marker trait for supported "word" types.
///
/// This is implemented for: `u32`, `u64`.
export interface Word<W> extends Sealed<W> {}

/// Sealed trait implemented for `u32` and `u64`.
// (mod sealed)
export interface Sealed<W> {
  /** `size_of::<Self>()` */
  readonly size: number;
  /** `Self::default()` */
  readonly default: W;

  // crate: rand_core-0.10.1/src/word.rs:16 from_le_bytes
  from_le_bytes(bytes: Uint8Array): W;
  // crate: rand_core-0.10.1/src/word.rs:17 to_le_bytes
  to_le_bytes(self: W): Uint8Array;

  // crate: rand_core-0.10.1/src/word.rs:19 from_usize
  from_usize(val: number): W;
  // crate: rand_core-0.10.1/src/word.rs:20 into_usize
  into_usize(self: W): number;
}

// impl Sealed for u32
export const Word_u32: Word<number> = {
  size: 4,
  default: 0,

  // crate: rand_core-0.10.1/src/word.rs:27 from_le_bytes
  from_le_bytes(bytes: Uint8Array): number {
    return (bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24)) >>> 0;
  },
  // crate: rand_core-0.10.1/src/word.rs:31 to_le_bytes
  to_le_bytes(self: number): Uint8Array {
    return Uint8Array.of(self & 0xff, (self >>> 8) & 0xff, (self >>> 16) & 0xff, self >>> 24);
  },

  // crate: rand_core-0.10.1/src/word.rs:36 from_usize
  from_usize(val: number): number {
    // `val.try_into().unwrap()`
    assert(val >= 0 && val <= 0xffff_ffff, "called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
    return val;
  },
  // crate: rand_core-0.10.1/src/word.rs:40 into_usize
  into_usize(self: number): number {
    return self;
  },
};

// impl Sealed for u64
export const Word_u64: Word<bigint> = {
  size: 8,
  default: 0n,

  // crate: rand_core-0.10.1/src/word.rs:49 from_le_bytes
  from_le_bytes(bytes: Uint8Array): bigint {
    const lo = BigInt(Word_u32.from_le_bytes(bytes.subarray(0, 4)));
    const hi = BigInt(Word_u32.from_le_bytes(bytes.subarray(4, 8)));
    return (hi << 32n) | lo;
  },
  // crate: rand_core-0.10.1/src/word.rs:53 to_le_bytes
  to_le_bytes(self: bigint): Uint8Array {
    const out = new Uint8Array(8);
    out.set(Word_u32.to_le_bytes(Number(self & 0xffff_ffffn)), 0);
    out.set(Word_u32.to_le_bytes(Number((self >> 32n) & 0xffff_ffffn)), 4);
    return out;
  },

  // crate: rand_core-0.10.1/src/word.rs:58 from_usize
  from_usize(val: number): bigint {
    return BigInt(val) & U64_MASK;
  },
  // crate: rand_core-0.10.1/src/word.rs:62 into_usize
  into_usize(self: bigint): number {
    // `self.try_into().unwrap()`
    // PORT: usize is `number`; values above 2^53 are not representable, which upstream's 64-bit `usize`
    // never needs here (the `BlockRng` index is at most `N`).
    assert(self <= BigInt(Number.MAX_SAFE_INTEGER), "u64 does not fit a usize number");
    return Number(self);
  },
};
