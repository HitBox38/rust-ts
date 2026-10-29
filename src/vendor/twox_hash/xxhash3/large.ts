// Port of twox-hash =2.1.2 `src/xxhash3/large.rs` (inputs over 240 bytes: the striped accumulator loop).
//
// PORT: the accumulators `[u64; 8]` are an `Acc`: a `Uint32Array(16)` holding lane `i` as its low 32
// bits at `[2 * i]` and its high 32 bits at `[2 * i + 1]`, and `Vector` works on those pairs. Measured
// (lane vendor-twox-hash) on the first 54 MiB of core's rmeta, fed in 64 KiB writes (FileEncoder's
// BUF_SIZE) through the same `process_stripe` driver, bun 1.4.3 on an Apple M4 Pro: u32 pairs 0.27 s
// (~205 MB/s) against 0.52 s (~110 MB/s) for a `bigint` per lane, in its fastest form (lanes read with
// `DataView.getBigUint64`). Every other u64 of the crate (per-hash scalars, `final_merge`) stays `bigint`.
// An `Acc` that upstream passes by value (`mut acc: [u64; 8]`) is copied with `slice()`.
//
// PORT: only the scalar `Vector` (`large/scalar.rs`) is ported. `neon.rs`, `avx2.rs` and `sse2.rs` compute
// the same digest with SIMD (plan-m5 D8), so `dispatch!` always takes its portable `do_scalar` arm.

import { IntoU128_u64, IntoU64_usize } from "../lib.ts";
import {
  assert_input_range,
  avalanche,
  bp_as_chunks,
  Halves_u128,
  primes,
  stripes_with_tail,
  u128_from_X128,
  u128_wrapping_mul,
  u64_from_le_bytes,
  u64_not,
  u64_wrapping_add,
  u64_wrapping_mul,
} from "../xxhash3.ts";
import type { Secret } from "./secret.ts";
import type { Finalize } from "./streaming.ts";
import { Impl as ScalarImpl } from "./large/scalar.ts";

/** `[u64; 8]` as (low, high) u32 pairs; see the header. */
export type Acc = Uint32Array;

/** Lane `i` of an `Acc` as a u64 `bigint`. */
export function acc_lane(acc: Acc, i: number): bigint {
  return BigInt(acc[2 * i]!) | (BigInt(acc[2 * i + 1]!) << 32n);
}

/** An `Acc` from eight u64 `bigint`s. */
export function acc_from_u64s(lanes: readonly bigint[]): Acc {
  const acc = new Uint32Array(16);
  for (let i = 0; i < 8; i++) {
    acc[2 * i] = Number(lanes[i]! & 0xffff_ffffn);
    acc[2 * i + 1] = Number(lanes[i]! >> 32n);
  }
  return acc;
}

// This module is not `cfg`-gated because it is used by some of the
// SIMD implementations.
// pub mod scalar;

// #[cfg(all(target_arch = "aarch64", feature = "std"))] pub mod neon;
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/neon.rs:15 new_unchecked SIMD Vector (neon); computes the same digest as large/scalar.rs (plan-m5 D8)
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/neon.rs:22 round_scramble SIMD Vector (neon); computes the same digest as large/scalar.rs (plan-m5 D8)
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/neon.rs:28 accumulate SIMD Vector (neon); computes the same digest as large/scalar.rs (plan-m5 D8)
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/neon.rs:39 round_scramble_neon SIMD Vector (neon); computes the same digest as large/scalar.rs (plan-m5 D8)
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/neon.rs:79 accumulate_neon SIMD Vector (neon); computes the same digest as large/scalar.rs (plan-m5 D8)
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/neon.rs:175 xx_vmulq_u32_u64 SIMD Vector (neon); computes the same digest as large/scalar.rs (plan-m5 D8)
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/neon.rs:199 reordering_barrier SIMD Vector (neon); computes the same digest as large/scalar.rs (plan-m5 D8)
// #[cfg(all(target_arch = "x86_64", feature = "std"))] pub mod avx2;
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/avx2.rs:14 new_unchecked SIMD Vector (avx2); computes the same digest as large/scalar.rs (plan-m5 D8)
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/avx2.rs:21 round_scramble SIMD Vector (avx2); computes the same digest as large/scalar.rs (plan-m5 D8)
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/avx2.rs:27 accumulate SIMD Vector (avx2); computes the same digest as large/scalar.rs (plan-m5 D8)
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/avx2.rs:38 round_scramble_avx2 SIMD Vector (avx2); computes the same digest as large/scalar.rs (plan-m5 D8)
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/avx2.rs:48 accumulate_avx2 SIMD Vector (avx2); computes the same digest as large/scalar.rs (plan-m5 D8)
// #[cfg(all(target_arch = "x86_64", feature = "std"))] pub mod sse2;
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/sse2.rs:14 new_unchecked SIMD Vector (sse2); computes the same digest as large/scalar.rs (plan-m5 D8)
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/sse2.rs:21 round_scramble SIMD Vector (sse2); computes the same digest as large/scalar.rs (plan-m5 D8)
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/sse2.rs:27 accumulate SIMD Vector (sse2); computes the same digest as large/scalar.rs (plan-m5 D8)
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/sse2.rs:38 round_scramble_sse2 SIMD Vector (sse2); computes the same digest as large/scalar.rs (plan-m5 D8)
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/sse2.rs:48 accumulate_sse2 SIMD Vector (sse2); computes the same digest as large/scalar.rs (plan-m5 D8)

// macro_rules! dispatch
// PORT: each `dispatch! { fn $fn_name<..>(args) .. }` use expands to `do_scalar`/`do_neon`/`do_avx2`/
// `do_sse2` wrappers and a runtime CPU-feature pick (`_internal_xxhash3_force_*` cfgs unset). Without the
// SIMD paths the pick always ends in `do_scalar($($arg_name),*)`, which calls
// `$fn_name(scalar::Impl, $($arg_name),*)`; this function is that `do_scalar`, called at each use site.
// crate: twox-hash-2.1.2/src/xxhash3/large.rs:29 do_scalar
export function do_scalar<A extends unknown[], R>(fn_name: (vector: Vector, ...args: A) => R, ...args: A): R {
  return fn_name(ScalarImpl, ...args);
}
// crate-skip: twox-hash-2.1.2/src/xxhash3/large.rs:42 do_neon SIMD path (neon.rs); computes the same digest as do_scalar (plan-m5 D8)
// crate-skip: twox-hash-2.1.2/src/xxhash3/large.rs:58 do_avx2 SIMD path (avx2.rs); computes the same digest as do_scalar (plan-m5 D8)
// crate-skip: twox-hash-2.1.2/src/xxhash3/large.rs:74 do_sse2 SIMD path (sse2.rs); computes the same digest as do_scalar (plan-m5 D8)

// pub trait Vector: Copy
export interface Vector {
  // crate: twox-hash-2.1.2/src/xxhash3/large.rs:127 round_scramble
  round_scramble(acc: Acc, secret_end: Uint8Array): void;

  // crate: twox-hash-2.1.2/src/xxhash3/large.rs:129 accumulate
  accumulate(acc: Acc, stripe: Uint8Array, secret: Uint8Array): void;
}

// #[rustfmt::skip]
export const INITIAL_ACCUMULATORS: Acc = acc_from_u64s([
  primes.PRIME32_3, primes.PRIME64_1, primes.PRIME64_2, primes.PRIME64_3,
  primes.PRIME64_4, primes.PRIME32_2, primes.PRIME64_5, primes.PRIME32_1,
]);

export class Algorithm<V extends Vector> {
  constructor(readonly _0: V) {}

  // crate: twox-hash-2.1.2/src/xxhash3/large.rs:145 oneshot
  oneshot<O>(secret: Secret, input: Uint8Array, finalize: Finalize<O>): O {
    assert_input_range(241, undefined, input.length);
    const acc = INITIAL_ACCUMULATORS.slice();

    const stripes_per_block = Math.floor((secret.len() - 64) / 8);
    const block_size = 64 * stripes_per_block;

    // let mut blocks = input.chunks_exact(block_size);
    let n_blocks = Math.floor(input.length / block_size);
    const remainder = input.subarray(n_blocks * block_size);

    let last_block: Uint8Array;
    if (remainder.length === 0) {
      // Safety: We know that `input` is non-empty, which means
      // that either there will be a remainder or one or more
      // full blocks. That info isn't flowing to the optimizer,
      // so we use `unwrap_unchecked`.
      n_blocks -= 1;
      last_block = input.subarray(n_blocks * block_size, n_blocks * block_size + block_size);
    } else {
      last_block = remainder;
    }

    const blocks: Uint8Array[] = [];
    for (let i = 0; i < n_blocks; i++) blocks.push(input.subarray(i * block_size, i * block_size + block_size));
    this.rounds(acc, blocks, secret);

    const len = input.length;

    const last_stripe = input.subarray(input.length - 64);
    return finalize.large(this._0, acc, last_block, last_stripe, secret, len);
  }

  // crate: twox-hash-2.1.2/src/xxhash3/large.rs:176 rounds
  rounds(acc: Acc, blocks: Iterable<Uint8Array>, secret: Secret): void {
    for (const block of blocks) {
      const [stripes] = bp_as_chunks(block, 64);

      this.round(acc, stripes, secret);
    }
  }

  // crate: twox-hash-2.1.2/src/xxhash3/large.rs:190 round
  round(acc: Acc, stripes: readonly Uint8Array[], secret: Secret): void {
    const secret_end = secret.last_stripe();

    this.round_accumulate(acc, stripes, secret);
    this._0.round_scramble(acc, secret_end);
  }

  // crate: twox-hash-2.1.2/src/xxhash3/large.rs:198 round_accumulate
  round_accumulate(acc: Acc, stripes: readonly Uint8Array[], secret: Secret): void {
    for (let i = 0; i < stripes.length; i++) {
      // Safety: The number of stripes is determined by the
      // block size, which is determined by the secret size.
      this._0.accumulate(acc, stripes[i]!, secret.stripe(i));
    }
  }

  // crate-skip: twox-hash-2.1.2/src/xxhash3/large.rs:212 finalize_64 cfg(feature = "xxhash3_64"): rustc_metadata enables only xxhash3_128 and std

  // #[cfg(feature = "xxhash3_128")]
  // crate: twox-hash-2.1.2/src/xxhash3/large.rs:229 finalize_128
  finalize_128(acc_: Acc, last_block: Uint8Array, last_stripe: Uint8Array, secret: Secret, len_: number): bigint {
    const acc = acc_.slice();
    // debug_assert!(!last_block.is_empty());
    this.last_round(acc, last_block, last_stripe, secret);

    const len = IntoU64_usize.into_u64(len_);

    let low = u64_wrapping_mul(len, primes.PRIME64_1);
    low = this.final_merge(acc, low, secret.final_secret());

    let high = u64_not(u64_wrapping_mul(len, primes.PRIME64_2));
    high = this.final_merge(acc, high, secret.for_128().final_secret());

    return u128_from_X128({ low, high });
  }

  // crate: twox-hash-2.1.2/src/xxhash3/large.rs:252 last_round
  last_round(acc: Acc, block: Uint8Array, last_stripe: Uint8Array, secret: Secret): void {
    // Accumulation steps are run for the stripes in the last block,
    // except for the last stripe (whether it is full or not)
    const [stripes] = stripes_with_tail(block);

    for (let i = 0; i < stripes.length; i++) {
      // Safety: The number of stripes is determined by the
      // block size, which is determined by the secret size.
      this._0.accumulate(acc, stripes[i]!, secret.stripe(i));
    }

    const last_stripe_secret = secret.last_stripe_secret_better_name();
    this._0.accumulate(acc, last_stripe, last_stripe_secret);
  }

  // crate: twox-hash-2.1.2/src/xxhash3/large.rs:278 final_merge
  final_merge(acc: Acc, init_value: bigint, secret: Uint8Array): bigint {
    const [secrets] = bp_as_chunks(secret, 8);
    let result = init_value;
    for (let i = 0; i < 4; i++) {
      // 64-bit by 64-bit multiplication to 128-bit full result
      const sa = u64_from_le_bytes(secrets[i * 2]!);
      const sb = u64_from_le_bytes(secrets[i * 2 + 1]!);

      const a = IntoU128_u64.into_u128(acc_lane(acc, i * 2) ^ sa);
      const b = IntoU128_u64.into_u128(acc_lane(acc, i * 2 + 1) ^ sb);
      const mul_result = u128_wrapping_mul(a, b);
      result = u64_wrapping_add(result, Halves_u128.lower_half(mul_result) ^ Halves_u128.upper_half(mul_result));
    }
    return avalanche(result);
  }
}
