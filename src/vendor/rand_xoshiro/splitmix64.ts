// Port of rand_xoshiro =0.7.0 `src/splitmix64.rs`.
// PORT: the generator implements the vendored rand_core 0.10.1 `Rng`, whose `next_u32`/`next_u64`/`fill_bytes` are what
// rand_core 0.9.3's `RngCore` names; `SeedableRng` is the table of rand_core's `seedable_rng.ts`.
import type { Infallible, Rng } from "../rand_core/lib.ts";
import { Ok, type Result } from "../../std/result.ts";
import { fill_bytes_via_next, read_u64_into } from "./common.ts";

const M64 = 0xffff_ffff_ffff_ffffn;

/// A splitmix64 random number generator.
///
/// The splitmix algorithm is not suitable for cryptographic purposes, but is
/// very fast and has a 64 bit state.
///
/// The algorithm used here is translated from [the `splitmix64.c`
/// reference source code](http://xoshiro.di.unimi.it/splitmix64.c) by
/// Sebastiano Vigna. For `next_u32`, a more efficient mixing function taken
/// from [`dsiutils`](http://dsiutils.di.unimi.it/) is used.
export class SplitMix64 implements Rng {
  constructor(public x: bigint) {}

  // crate: rand_xoshiro-0.7.0/src/splitmix64.rs:35 next_u32
  next_u32(): number {
    this.x = (this.x + PHI) & M64;
    let z = this.x;
    // David Stafford's
    // (http://zimbry.blogspot.com/2011/09/better-bit-mixing-improving-on.html)
    // "Mix4" variant of the 64-bit finalizer in Austin Appleby's
    // MurmurHash3 algorithm.
    z = ((z ^ (z >> 33n)) * 0x62a9d9ed799705f5n) & M64;
    z = ((z ^ (z >> 28n)) * 0xcb24d0a5c88c35b3n) & M64;
    return Number(z >> 32n);
  }

  // crate: rand_xoshiro-0.7.0/src/splitmix64.rs:48 next_u64
  next_u64(): bigint {
    this.x = (this.x + PHI) & M64;
    let z = this.x;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M64;
    return z ^ (z >> 31n);
  }

  // crate: rand_xoshiro-0.7.0/src/splitmix64.rs:57 fill_bytes
  fill_bytes(dest: Uint8Array): void {
    fill_bytes_via_next(this, dest);
  }

  /// Create a new `SplitMix64`.
  // crate: rand_xoshiro-0.7.0/src/splitmix64.rs:66 from_seed
  static from_seed(seed: Uint8Array): SplitMix64 {
    const state = [0n];
    read_u64_into(seed, state);
    return new SplitMix64(state[0]!);
  }

  /// Seed a `SplitMix64` from a `u64`.
  // crate: rand_xoshiro-0.7.0/src/splitmix64.rs:73 seed_from_u64
  static seed_from_u64(seed: bigint): SplitMix64 {
    // `SplitMix64::from_seed(seed.to_le_bytes())`
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, seed & M64, /* littleEndian */ true);
    return SplitMix64.from_seed(bytes);
  }

  // PORT: rand_core 0.10's blanket `TryRng` of an infallible generator.
  try_next_u32(): Result<number, Infallible> {
    return Ok(this.next_u32());
  }
  try_next_u64(): Result<bigint, Infallible> {
    return Ok(this.next_u64());
  }
  try_fill_bytes(dst: Uint8Array): Result<void, Infallible> {
    this.fill_bytes(dst);
    return Ok(undefined);
  }
}

const PHI = 0x9e3779b97f4a7c15n;
