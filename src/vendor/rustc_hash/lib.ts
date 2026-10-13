// Port of rustc-hash =2.1.1 `src/lib.rs` (the version `rustc_data_structures::fx` re-exports; rustc
// builds it with the default `std` feature only: no `nightly`, no `rand`).
//
//! A speedy, non-cryptographic hashing algorithm used by `rustc`.
//!
//! # Example
//!
//! ```rust
//! # #[cfg(feature = "std")]
//! # fn main() {
//! use rustc_hash::FxHashMap;
//!
//! let mut map: FxHashMap<u32, u32> = FxHashMap::default();
//! map.insert(22, 44);
//! # }
//! # #[cfg(not(feature = "std"))]
//! # fn main() { }
//! ```
//
// PORT: the oracle host is 64-bit (`target_pointer_width = "64"`), so only the 64-bit `cfg` arms are
// ported. `usize` hash state and every u64 are `bigint` (always kept in 0..2^64); `usize` arguments
// of the `Hasher` methods are `number` (< 2^53) as in the `Hasher` stand-in of rustc-stable-hash.
// PORT: without the `nightly` feature `write_length_prefix` and `write_str` are std's provided
// methods (`write_usize(len)`, `write(bytes)` + `write_u8(0xff)`), not the overrides at lines 149/160.
// PORT: `FxHashMap` / `FxHashSet` (`std::collections::HashMap<K, V, FxBuildHasher>`) are
// src/rust_ts/hash_map.ts's `FxHashMap` / `FxHashSet` (std's `HashMap` is hashbrown's, see
// src/vendor/hashbrown/map.ts).

import { type Hasher, Hasher_provided } from "../rustc_stable_hash/stable_hasher.ts";

export { FxSeededState } from "./seeded_state.ts";

// crate-skip: rustc-hash-2.1.1/src/random_state.rs:23 new behind the `rand` feature (off in rustc)
// crate-skip: rustc-hash-2.1.1/src/random_state.rs:49 build_hasher behind the `rand` feature (off in rustc)
// crate-skip: rustc-hash-2.1.1/src/random_state.rs:55 default behind the `rand` feature (off in rustc)
// crate-skip: rustc-hash-2.1.1/src/random_state.rs:67 cloned_random_states_are_equal test of the `rand` feature (off in rustc)
// crate-skip: rustc-hash-2.1.1/src/random_state.rs:75 random_states_are_different test of the `rand` feature (off in rustc)
// crate-skip: rustc-hash-2.1.1/src/random_state.rs:87 random_states_are_different_cross_thread test of the `rand` feature (off in rustc)

const U64 = (1n << 64n) - 1n;

/// A speedy hash algorithm for use within rustc. The hashmap in liballoc
/// by default uses SipHash which isn't quite as speedy as we want. In the
/// compiler we're not really worried about DOS attempts, so we use a fast
/// non-cryptographic hash.
///
/// The current implementation is a fast polynomial hash with a single
/// bit rotation as a finishing step designed by Orson Peters.
///
/// It is also not cryptographically secure, so do not use it in places
/// where the attacker could control the inputs.
// PORT: `#[derive(Clone)]` is `clone()`.
export class FxHasher implements Hasher {
  constructor(public hash: bigint) {}

  clone(): FxHasher {
    return new FxHasher(this.hash);
  }

  /// Creates a `fx` hasher with a given seed.
  // crate: rustc-hash-2.1.1/src/lib.rs:79 with_seed
  static with_seed(seed: bigint): FxHasher {
    return new FxHasher(seed);
  }

  /// Creates a default `fx` hasher.
  // crate: rustc-hash-2.1.1/src/lib.rs:84 default
  // crate: rustc-hash-2.1.1/src/lib.rs:91 default
  static default(): FxHasher {
    return new FxHasher(0n);
  }

  // crate: rustc-hash-2.1.1/src/lib.rs:98 add_to_hash
  add_to_hash(i: bigint): void {
    this.hash = ((this.hash + i) * K) & U64;
  }

  // ---- impl Hasher for FxHasher ----

  // crate: rustc-hash-2.1.1/src/lib.rs:105 write
  write(bytes: Uint8Array): void {
    // Compress the byte string to a single u64 and add to our hash.
    this.write_u64(hash_bytes(bytes));
  }

  // crate: rustc-hash-2.1.1/src/lib.rs:111 write_u8
  write_u8(i: number): void {
    this.add_to_hash(BigInt(i & 0xff));
  }

  // crate: rustc-hash-2.1.1/src/lib.rs:116 write_u16
  write_u16(i: number): void {
    this.add_to_hash(BigInt(i & 0xffff));
  }

  // crate: rustc-hash-2.1.1/src/lib.rs:121 write_u32
  write_u32(i: number): void {
    this.add_to_hash(BigInt(i >>> 0));
  }

  // crate: rustc-hash-2.1.1/src/lib.rs:126 write_u64
  write_u64(i: bigint): void {
    this.add_to_hash(BigInt.asUintN(64, i));
    // #[cfg(target_pointer_width = "32")] self.add_to_hash((i >> 32) as usize);
  }

  // crate: rustc-hash-2.1.1/src/lib.rs:133 write_u128
  write_u128(i: bigint): void {
    const v = BigInt.asUintN(128, i);
    this.add_to_hash(v & U64);
    // #[cfg(target_pointer_width = "32")] self.add_to_hash((i >> 32) as usize);
    this.add_to_hash(v >> 64n);
    // #[cfg(target_pointer_width = "32")] self.add_to_hash((i >> 96) as usize);
  }

  // crate: rustc-hash-2.1.1/src/lib.rs:143 write_usize
  write_usize(i: number): void {
    this.add_to_hash(BigInt(i));
  }

  // crate-skip: rustc-hash-2.1.1/src/lib.rs:149 write_length_prefix behind the `nightly` feature (off in rustc; std's provided method below)
  // crate-skip: rustc-hash-2.1.1/src/lib.rs:160 write_str behind the `nightly` feature (off in rustc; std's provided method below)

  // crate: rustc-hash-2.1.1/src/lib.rs:167 finish
  finish_u64(): bigint {
    // Since we used a multiplicative hash our top bits have the most
    // entropy (with the top bit having the most, decreasing as you go).
    // As most hash table implementations (including hashbrown) compute
    // the bucket index from the bottom bits we want to move bits from the
    // top to the bottom. Ideally we'd rotate left by exactly the hash table
    // size, but as we don't know this we'll choose 26 bits, giving decent
    // entropy up until 2^26 table sizes. On 32-bit hosts we'll dial it
    // back down a bit to 15 bits.

    // #[cfg(target_pointer_width = "64")]
    const ROTATE = 26n;

    return ((this.hash << ROTATE) | (this.hash >> (64n - ROTATE))) & U64;

    // A bit reversal would be even better, except hashbrown also expects
    // good entropy in the top 7 bits and a bit reverse would fill those
    // bits with low entropy. More importantly, bit reversals are very slow
    // on x86-64. A byte reversal is relatively fast, but still has a 2
    // cycle latency on x86-64 compared to the 1 cycle latency of a rotate.
    // It also suffers from the hashbrown-top-7-bit-issue.
  }

  // ---- provided methods of `std::hash::Hasher` (library/core/src/hash/mod.rs) ----

  /** `fn write_i8(&mut self, i: i8) { self.write_u8(i as u8) }` */
  write_i8(i: number): void {
    this.write_u8(i & 0xff);
  }
  /** `fn write_i16(&mut self, i: i16) { self.write_u16(i as u16) }` */
  write_i16(i: number): void {
    this.write_u16(i & 0xffff);
  }
  /** `fn write_i32(&mut self, i: i32) { self.write_u32(i as u32) }` */
  write_i32(i: number): void {
    this.write_u32(i >>> 0);
  }
  /** `fn write_i64(&mut self, i: i64) { self.write_u64(i as u64) }` */
  write_i64(i: bigint): void {
    this.write_u64(BigInt.asUintN(64, i));
  }
  /** `fn write_i128(&mut self, i: i128) { self.write_u128(i as u128) }` */
  write_i128(i: bigint): void {
    this.write_u128(BigInt.asUintN(128, i));
  }
  /** `fn write_isize(&mut self, i: isize) { self.write_usize(i as usize) }` */
  write_isize(i: number): void {
    this.add_to_hash(BigInt.asUintN(64, BigInt(i)));
  }
  /** `fn write_length_prefix(&mut self, len: usize) { self.write_usize(len); }` */
  write_length_prefix(len: number): void {
    Hasher_provided.write_length_prefix(this, len);
  }
  /** `fn write_str(&mut self, s: &str) { self.write(s.as_bytes()); self.write_u8(0xff); }` */
  write_str(s: Uint8Array): void {
    Hasher_provided.write_str(this, s);
  }
}

// One might view a polynomial hash
//    m[0] * k    + m[1] * k^2  + m[2] * k^3  + ...
// as a multilinear hash with keystream k[..]
//    m[0] * k[0] + m[1] * k[1] + m[2] * k[2] + ...
// where keystream k just happens to be generated using a multiplicative
// congruential pseudorandom number generator (MCG). For that reason we chose a
// constant that was found to be good for a MCG in:
//     "Computationally Easy, Spectrally Good Multipliers for Congruential
//     Pseudorandom Number Generators" by Guy Steele and Sebastiano Vigna.
// #[cfg(target_pointer_width = "64")]
const K = 0xf1357aea2e62a9c5n;

// Nothing special, digits of pi.
const SEED1 = 0x243f6a8885a308d3n;
const SEED2 = 0x13198a2e03707344n;
const PREVENT_TRIVIAL_ZERO_COLLAPSE = 0xa4093822299f31d0n;

// crate: rustc-hash-2.1.1/src/lib.rs:199 multiply_mix
function multiply_mix(x: bigint, y: bigint): bigint {
  // #[cfg(target_pointer_width = "64")]
  {
    // We compute the full u64 x u64 -> u128 product, this is a single mul
    // instruction on x86-64, one mul plus one mulhi on ARM64.
    const full = x * y;
    const lo = full & U64;
    const hi = (full >> 64n) & U64;

    // The middle bits of the full product fluctuate the most with small
    // changes in the input. This is the top bits of lo and the bottom bits
    // of hi. We can thus make the entire output fluctuate with small
    // changes to the input by XOR'ing these two halves.
    return lo ^ hi;

    // Unfortunately both 2^64 + 1 and 2^64 - 1 have small prime factors,
    // otherwise combining with + or - could result in a really strong hash, as:
    //     x * y = 2^64 * hi + lo = (-1) * hi + lo = lo - hi,   (mod 2^64 + 1)
    //     x * y = 2^64 * hi + lo =    1 * hi + lo = lo + hi,   (mod 2^64 - 1)
    // Multiplicative hashing is universal in a field (like mod p).
  }
}

/** `u64::from_le_bytes(bytes[off..off + 8])` */
function u64_le(bytes: Uint8Array, off: number): bigint {
  return u32_le(bytes, off) | (u32_le(bytes, off + 4) << 32n);
}

/** `u32::from_le_bytes(bytes[off..off + 4])` */
function u32_le(bytes: Uint8Array, off: number): bigint {
  return BigInt((bytes[off]! | (bytes[off + 1]! << 8) | (bytes[off + 2]! << 16) | (bytes[off + 3]! << 24)) >>> 0);
}

/// A wyhash-inspired non-collision-resistant hash for strings/slices designed
/// by Orson Peters, with a focus on small strings and small codesize.
///
/// The 64-bit version of this hash passes the SMHasher3 test suite on the full
/// 64-bit output, that is, f(hash_bytes(b) ^ f(seed)) for some good avalanching
/// permutation f() passed all tests with zero failures. When using the 32-bit
/// version of multiply_mix this hash has a few non-catastrophic failures where
/// there are a handful more collisions than an optimal hash would give.
///
/// We don't bother avalanching here as we'll feed this hash into a
/// multiplication after which we take the high bits, which avalanches for us.
// crate: rustc-hash-2.1.1/src/lib.rs:252 hash_bytes
export function hash_bytes(bytes: Uint8Array): bigint {
  const len = bytes.length;
  let s0 = SEED1;
  let s1 = SEED2;

  if (len <= 16) {
    // XOR the input into s0, s1.
    if (len >= 8) {
      s0 ^= u64_le(bytes, 0);
      s1 ^= u64_le(bytes, len - 8);
    } else if (len >= 4) {
      s0 ^= u32_le(bytes, 0);
      s1 ^= u32_le(bytes, len - 4);
    } else if (len > 0) {
      const lo = bytes[0]!;
      const mid = bytes[len >>> 1]!;
      const hi = bytes[len - 1]!;
      s0 ^= BigInt(lo);
      s1 ^= BigInt((hi << 8) | mid);
    }
  } else {
    // Handle bulk (can partially overlap with suffix).
    let off = 0;
    while (off < len - 16) {
      const x = u64_le(bytes, off);
      const y = u64_le(bytes, off + 8);

      // Replace s1 with a mix of s0, x, and y, and s0 with s1.
      // This ensures the compiler can unroll this loop into two
      // independent streams, one operating on s0, the other on s1.
      //
      // Since zeroes are a common input we prevent an immediate trivial
      // collapse of the hash function by XOR'ing a constant with y.
      const t = multiply_mix(s0 ^ x, PREVENT_TRIVIAL_ZERO_COLLAPSE ^ y);
      s0 = s1;
      s1 = t;
      off += 16;
    }

    const suffix = len - 16;
    s0 ^= u64_le(bytes, suffix);
    s1 ^= u64_le(bytes, suffix + 8);
  }

  return multiply_mix(s0, s1) ^ BigInt(len);
}

/// An implementation of [`BuildHasher`] that produces [`FxHasher`]s.
///
/// ```
/// use std::hash::BuildHasher;
/// use rustc_hash::FxBuildHasher;
/// assert_ne!(FxBuildHasher.hash_one(1), FxBuildHasher.hash_one(2));
/// ```
// PORT: `#[derive(Copy, Clone, Default)] pub struct FxBuildHasher;` is a frozen singleton; the
// `BuildHasher` trait is the `BuildHasher<H>` interface below (with its provided `hash_one`).
export const FxBuildHasher: BuildHasher<FxHasher> = {
  // crate: rustc-hash-2.1.1/src/lib.rs:311 build_hasher
  build_hasher(): FxHasher {
    return FxHasher.default();
  },
};

/// PORT: stand-in for `std::hash::BuildHasher` (library/core/src/hash/mod.rs).
export interface BuildHasher<H extends Hasher> {
  build_hasher(): H;
}

/** PORT: `<T: Hash>::hash(&self, state)` passed as a function (the key's `Hash` impl). */
export type HashFn<T> = (v: T, state: Hasher) => void;

/// `BuildHasher::hash_one` (provided): `let mut hasher = self.build_hasher(); x.hash(&mut hasher); hasher.finish()`.
export function hash_one<T>(self: BuildHasher<Hasher>, x: T, hash: HashFn<T>): bigint {
  const hasher = self.build_hasher();
  hash(x, hasher);
  return hasher.finish_u64();
}
