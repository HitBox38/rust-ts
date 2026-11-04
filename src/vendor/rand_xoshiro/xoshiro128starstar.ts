// Port of rand_xoshiro =0.7.0 `src/xoshiro128starstar.rs`.
// PORT: see splitmix64.ts for `Rng` and `SeedableRng`.
import type { Infallible, Rng } from "../rand_core/lib.ts";
import { SeedableRng_provided, type SeedableRng } from "../rand_core/seedable_rng.ts";
import { Ok, type Result } from "../../std/result.ts";
import { fill_bytes_via_next, impl_jump_u32_4, impl_xoshiro_u32, next_u64_via_u32, read_u32_into, starstar_u64 } from "./common.ts";
import { SplitMix64 } from "./splitmix64.ts";

/// A xoshiro128** random number generator.
///
/// The xoshiro128** algorithm is not suitable for cryptographic purposes, but
/// is very fast and has excellent statistical properties.
///
/// The algorithm used here is translated from [the `xoshiro128starstar.c`
/// reference source code](http://xoshiro.di.unimi.it/xoshiro128starstar.c) by
/// David Blackman and Sebastiano Vigna.
export class Xoshiro128StarStar implements Rng {
  constructor(public s: number[]) {}

  /// Jump forward, equivalently to 2^64 calls to `next_u32()`.
  ///
  /// This can be used to generate 2^64 non-overlapping subsequences for
  /// parallel computations.
  // crate: rand_xoshiro-0.7.0/src/xoshiro128starstar.rs:45 jump
  jump(): void {
    impl_jump_u32_4(this, [0x8764000b, 0xf542d2d3, 0x6fa035c3, 0x77f2db5b]);
  }

  /// Jump forward, equivalently to 2^96 calls to `next_u32()`.
  ///
  /// This can be used to generate 2^32 starting points, from each of which
  /// `jump()` will generate 2^32 non-overlapping subsequences for parallel
  /// distributed computations.
  // crate: rand_xoshiro-0.7.0/src/xoshiro128starstar.rs:54 long_jump
  long_jump(): void {
    impl_jump_u32_4(this, [0xb523952e, 0x0b6f099f, 0xccf5a0ef, 0x1c580662]);
  }

  /// Create a new `Xoshiro128StarStar`.  If `seed` is entirely 0, it will be
  /// mapped to a different seed.
  // crate: rand_xoshiro-0.7.0/src/xoshiro128starstar.rs:65 from_seed
  static from_seed(seed: Uint8Array): Xoshiro128StarStar {
    // deal_with_zero_seed!(seed, Self, 16);
    if (seed.every((b) => b === 0)) {
      return Xoshiro128StarStar.seed_from_u64(0n);
    }
    const state = [0, 0, 0, 0];
    read_u32_into(seed, state);
    return new Xoshiro128StarStar(state);
  }

  /// Seed a `Xoshiro128StarStar` from a `u64` using `SplitMix64`.
  // crate: rand_xoshiro-0.7.0/src/xoshiro128starstar.rs:73 seed_from_u64
  static seed_from_u64(seed: bigint): Xoshiro128StarStar {
    // from_splitmix!(seed)
    const rng = SplitMix64.seed_from_u64(seed);
    return SeedableRng_provided.from_rng(SeedableRng_Xoshiro128StarStar, rng);
  }

  // crate: rand_xoshiro-0.7.0/src/xoshiro128starstar.rs:80 next_u32
  next_u32(): number {
    const result_starstar = starstar_u64(this.s[1]!);
    impl_xoshiro_u32(this);
    return result_starstar;
  }

  // crate: rand_xoshiro-0.7.0/src/xoshiro128starstar.rs:87 next_u64
  next_u64(): bigint {
    return next_u64_via_u32(this);
  }

  // crate: rand_xoshiro-0.7.0/src/xoshiro128starstar.rs:92 fill_bytes
  fill_bytes(dest: Uint8Array): void {
    fill_bytes_via_next(this, dest);
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

/** `impl SeedableRng for Xoshiro128StarStar` (`type Seed = [u8; 16]`). */
const SeedableRng_Xoshiro128StarStar: SeedableRng<Xoshiro128StarStar> = {
  Seed_default: () => new Uint8Array(16),
  from_seed: (seed) => Xoshiro128StarStar.from_seed(seed),
};
