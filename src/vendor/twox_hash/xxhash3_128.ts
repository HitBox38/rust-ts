// Port of twox-hash =2.1.2 `src/xxhash3_128.rs`.
//
//! The implementation of XXH3_128.
//
// PORT: the `u128` results are `bigint`s in [0, 2^128).

import {
  assert_input_range,
  avalanche,
  avalanche_xxh64,
  CUTOFF,
  DEFAULT_SECRET,
  DEFAULT_SECRET_RAW,
  DEFAULT_SEED,
  derive_secret,
  Halves_u128,
  Halves_u64,
  impl_1_to_3_bytes_combined,
  impl_17_to_128_bytes_iter,
  IntoU128_X128,
  mix_step,
  type OneshotWithSecretError,
  pairs_of_u64_bytes,
  primes,
  bp_as_rchunks,
  to_u64s,
  u128_from_X128,
  u128_wrapping_mul,
  u32_rotate_left,
  u32_swap_bytes,
  U8SliceExt,
  u64_swap_bytes,
  u64_wrapping_add,
  u64_wrapping_mul,
  u64_wrapping_neg,
  u64_wrapping_sub,
} from "./xxhash3.ts";
import { IntoU128_u64, IntoU64_u32, IntoU64_usize } from "./lib.ts";
import { Err, expect_result, Ok, type Result } from "../../std/result.ts";
import { unwrap } from "../../std/panic.ts";
import { type Acc, Algorithm, do_scalar, type Vector } from "./xxhash3/large.ts";
import { debug_Error, Secret } from "./xxhash3/secret.ts";
import {
  type AllocRawHasher,
  clone_RawHasherCore,
  type FixedBuffer,
  type Finalize,
  RawHasherCore,
  SecretBuffer,
  SecretTooShortError,
} from "./xxhash3/streaming.ts";

// pub use crate::xxhash3::{FixedBuffer, FixedMutBuffer, OneshotWithSecretError, SecretBuffer, SecretTooShortError,
//     SecretWithSeedError, DEFAULT_SECRET_LENGTH, SECRET_MINIMUM_LENGTH};
export { DEFAULT_SECRET_LENGTH, type OneshotWithSecretError } from "./xxhash3.ts";
export { SECRET_MINIMUM_LENGTH } from "./xxhash3/secret.ts";
export {
  type FixedBuffer,
  type FixedMutBuffer,
  SecretBuffer,
  SecretTooShortError,
  SecretWithSeedError,
} from "./xxhash3/streaming.ts";

const { PRIME32_2, PRIME64_1, PRIME64_2, PRIME64_4, PRIME_MX2 } = primes;

/// Calculates the 128-bit hash.
///
/// This type does not implement [`std::hash::Hasher`] as that trait
/// requires a 64-bit result while this computes a 128-bit result.
// #[derive(Clone)]
export class Hasher {
  constructor(
    // #[cfg(feature = "alloc")]
    public inner: AllocRawHasher,
  ) {}

  /// Hash all data at once. If you can use this function, you may
  /// see noticable speed gains for certain types of input.
  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:35 oneshot
  static oneshot(input: Uint8Array): bigint {
    return impl_oneshot(DEFAULT_SECRET, DEFAULT_SEED, input);
  }

  /// Hash all data at once using the provided seed and a secret
  /// derived from the seed. If you can use this function, you may
  /// see noticable speed gains for certain types of input.
  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:44 oneshot_with_seed
  static oneshot_with_seed(seed: bigint, input: Uint8Array): bigint {
    const secret0 = DEFAULT_SECRET_RAW.slice();

    // We know that the secret will only be used if we have more
    // than 240 bytes, so don't waste time computing it otherwise.
    if (input.length > CUTOFF) {
      derive_secret(seed, secret0);
    }

    const secret = expect_result(Secret.new(secret0), "The default secret length is invalid", debug_Error);

    return impl_oneshot(secret, seed, input);
  }

  /// Hash all data at once using the provided secret and the
  /// default seed. If you can use this function, you may see
  /// noticable speed gains for certain types of input.
  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:62 oneshot_with_secret
  static oneshot_with_secret(secret0: Uint8Array, input: Uint8Array): Result<bigint, OneshotWithSecretError> {
    const r = Secret.new(secret0);
    if (r.$ === "Err") return Err({ _0: r._0 });
    const secret = r._0;
    return Ok(impl_oneshot(secret, DEFAULT_SEED, input));
  }

  /// Hash all data at once using the provided seed and secret. If
  /// you can use this function, you may see noticable speed gains
  /// for certain types of input.
  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:74 oneshot_with_seed_and_secret
  static oneshot_with_seed_and_secret(seed: bigint, secret0: Uint8Array, input: Uint8Array): Result<bigint, OneshotWithSecretError> {
    let secret: Secret;
    if (input.length > CUTOFF) {
      const r = Secret.new(secret0);
      if (r.$ === "Err") return Err({ _0: r._0 });
      secret = r._0;
    } else {
      secret = DEFAULT_SECRET;
    }

    return Ok(impl_oneshot(secret, seed, input));
  }

  // #[cfg(feature = "alloc")] mod with_alloc

  /// Constructs the hasher using the default seed and secret values.
  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:98 new
  static new(): Hasher {
    return new Hasher(RawHasherCore.allocate_default());
  }

  /// Constructs the hasher using the provided seed and a secret
  /// derived from the seed.
  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:107 with_seed
  static with_seed(seed: bigint): Hasher {
    return new Hasher(RawHasherCore.allocate_with_seed(seed));
  }

  /// Constructs the hasher using the provided seed and secret.
  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:115 with_seed_and_secret
  static with_seed_and_secret(seed: bigint, secret: Uint8Array): Result<Hasher, SecretTooShortError<Uint8Array>> {
    const r = RawHasherCore.allocate_with_seed_and_secret(seed, secret);
    if (r.$ === "Err") return r;
    return Ok(new Hasher(r._0));
  }

  /// Returns the secret.
  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:126 into_secret
  into_secret(): Uint8Array {
    return this.inner.into_secret();
  }

  /// Writes some data into this `Hasher`.
  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:132 write
  write(input: Uint8Array): void {
    this.inner.write(input);
  }

  /// Returns the hash value for the values written so
  /// far. Unlike [`std::hash::Hasher::finish`][], this method
  /// returns the complete 128-bit value calculated, not a
  /// 64-bit value.
  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:141 finish_128
  finish_128(): bigint {
    return this.inner.finish(Finalize128);
  }

  // impl Default for Hasher
  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:147 default
  static default_(): Hasher {
    return Hasher.new();
  }
}

export function clone_Hasher(v: Hasher): Hasher {
  return new Hasher(clone_RawHasherCore(v.inner));
}

// #[derive(Clone)]
/// A lower-level interface for computing a hash from streaming data.
///
/// The algorithm requires a secret which can be a reasonably large
/// piece of data. [`Hasher`][] makes one concrete implementation
/// decision that uses dynamic memory allocation, but specialized
/// usages may desire more flexibility. This type, combined with
/// [`SecretBuffer`][], offer that flexibility at the cost of a
/// generic type.
export class RawHasher<S extends FixedBuffer = FixedBuffer> {
  constructor(readonly _0: RawHasherCore<S>) {}

  /// Construct the hasher with the provided seed, secret, and
  /// temporary buffer.
  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:167 new
  static new<S extends FixedBuffer>(secret_buffer: SecretBuffer<S>): RawHasher<S> {
    return new RawHasher(RawHasherCore.new(secret_buffer));
  }

  /// Returns the secret.
  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:172 into_secret
  into_secret(): S {
    return this._0.into_secret();
  }

  /// Writes some data into this `Hasher`.
  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:183 write
  write(input: Uint8Array): void {
    this._0.write(input);
  }

  /// Returns the hash value for the values written so
  /// far. Unlike [`std::hash::Hasher::finish`][], this method
  /// returns the complete 128-bit value calculated, not a
  /// 64-bit value.
  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:192 finish_128
  finish_128(): bigint {
    return this._0.finish(Finalize128);
  }
}

// struct Finalize128;
// impl Finalize for Finalize128 { type Output = u128; }
const Finalize128: Finalize<bigint> = {
  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:203 small
  small(secret: Secret, seed: bigint, input: Uint8Array): bigint {
    return impl_oneshot(secret, seed, input);
  },

  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:208 large
  large(vector: Vector, acc: Acc, last_block: Uint8Array, last_stripe: Uint8Array, secret: Secret, len: number): bigint {
    return new Algorithm(vector).finalize_128(acc, last_block, last_stripe, secret, len);
  },
};

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:222 impl_oneshot
function impl_oneshot(secret: Secret, seed: bigint, input: Uint8Array): bigint {
  const len = input.length;
  if (len >= 241) return impl_241_plus_bytes(secret, input);

  if (len >= 129) return impl_129_to_240_bytes(secret, seed, input);

  if (len >= 17) return impl_17_to_128_bytes(secret, seed, input);

  if (len >= 9) return impl_9_to_16_bytes(secret, seed, input);

  if (len >= 4) return impl_4_to_8_bytes(secret, seed, input);

  if (len >= 1) return impl_1_to_3_bytes(secret, seed, input);

  return impl_0_bytes(secret, seed);
}

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:241 impl_0_bytes
function impl_0_bytes(secret: Secret, seed: bigint): bigint {
  const secret_words = secret.for_128().words_for_0();

  const low = avalanche_xxh64(seed ^ secret_words[0] ^ secret_words[1]);
  const high = avalanche_xxh64(seed ^ secret_words[2] ^ secret_words[3]);

  return u128_from_X128({ low, high });
}

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:251 impl_1_to_3_bytes
function impl_1_to_3_bytes(secret_: Secret, seed: bigint, input: Uint8Array): bigint {
  assert_input_range(1, 3, input.length);

  const combined = impl_1_to_3_bytes_combined(input);
  const secret_words = secret_.for_128().words_for_1_to_3();

  let low = (() => {
    const secret = IntoU64_u32.into_u64((secret_words[0] ^ secret_words[1]) >>> 0);
    return u64_wrapping_add(secret, seed) ^ IntoU64_u32.into_u64(combined);
  })();
  let high = (() => {
    const secret = IntoU64_u32.into_u64((secret_words[2] ^ secret_words[3]) >>> 0);
    return u64_wrapping_sub(secret, seed) ^ IntoU64_u32.into_u64(u32_rotate_left(u32_swap_bytes(combined), 13));
  })();

  low = avalanche_xxh64(low);
  high = avalanche_xxh64(high);

  return u128_from_X128({ low, high });
}

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:273 impl_4_to_8_bytes
function impl_4_to_8_bytes(secret: Secret, seed: bigint, input: Uint8Array): bigint {
  assert_input_range(4, 8, input.length);
  const input_first = unwrap(U8SliceExt.first_u32(input));
  const input_last = unwrap(U8SliceExt.last_u32(input));

  const modified_seed = seed ^ ((IntoU64_u32.into_u64(u32_swap_bytes(Halves_u64.lower_half(seed))) << 32n) & 0xffff_ffff_ffff_ffffn);
  const secret_words = secret.for_128().words_for_4_to_8();

  const combined = IntoU64_u32.into_u64(input_first) | (IntoU64_u32.into_u64(input_last) << 32n);
  const lhs = (() => {
    const a = secret_words[0] ^ secret_words[1];
    const b = u64_wrapping_add(a, modified_seed);
    return b ^ combined;
  })();
  const rhs = u64_wrapping_add(PRIME64_1, IntoU64_usize.into_u64(input.length) << 2n);
  const mul_result = u128_wrapping_mul(IntoU128_u64.into_u128(lhs), IntoU128_u64.into_u128(rhs));

  let high = Halves_u128.upper_half(mul_result);
  let low = Halves_u128.lower_half(mul_result);

  high = u64_wrapping_add(high, (low << 1n) & 0xffff_ffff_ffff_ffffn);

  low ^= high >> 3n;
  low ^= low >> 35n;
  low = u64_wrapping_mul(low, PRIME_MX2);
  low ^= low >> 28n;

  high = avalanche(high);

  return u128_from_X128({ low, high });
}

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:306 impl_9_to_16_bytes
function impl_9_to_16_bytes(secret: Secret, seed: bigint, input: Uint8Array): bigint {
  assert_input_range(9, 16, input.length);
  const input_first = unwrap(U8SliceExt.first_u64(input));
  const input_last = unwrap(U8SliceExt.last_u64(input));

  const secret_words = secret.for_128().words_for_9_to_16();
  const val1 = u64_wrapping_sub(secret_words[0] ^ secret_words[1], seed) ^ input_first ^ input_last;
  const val2 = u64_wrapping_add(secret_words[2] ^ secret_words[3], seed) ^ input_last;
  const mul_result = u128_wrapping_mul(IntoU128_u64.into_u128(val1), IntoU128_u64.into_u128(PRIME64_1));
  let low = u64_wrapping_add(Halves_u128.lower_half(mul_result), (IntoU64_usize.into_u64(input.length - 1) << 54n) & 0xffff_ffff_ffff_ffffn);

  // Algorithm describes this in two ways
  let high = u64_wrapping_add(
    u64_wrapping_add(Halves_u128.upper_half(mul_result), IntoU64_u32.into_u64(Halves_u64.upper_half(val2)) << 32n),
    u64_wrapping_mul(IntoU64_u32.into_u64(Halves_u64.lower_half(val2)), PRIME32_2),
  );

  low = low ^ u64_swap_bytes(high);

  // Algorithm describes this multiplication in two ways.
  const q = u128_wrapping_mul(IntoU128_X128.into_u128({ low, high }), IntoU128_u64.into_u128(PRIME64_2));

  low = avalanche(Halves_u128.lower_half(q));
  high = avalanche(Halves_u128.upper_half(q));

  return u128_from_X128({ low, high });
}

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:339 impl_17_to_128_bytes
function impl_17_to_128_bytes(secret: Secret, seed: bigint, input: Uint8Array): bigint {
  assert_input_range(17, 128, input.length);
  const input_len = IntoU64_usize.into_u64(input.length);
  const acc: [bigint, bigint] = [u64_wrapping_mul(input_len, PRIME64_1), 0n];

  impl_17_to_128_bytes_iter(secret, input, (fwd, bwd, secret) => {
    mix_two_chunks(acc, fwd, bwd, secret, seed);
  });

  return finalize_medium(acc, input_len, seed);
}

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:352 impl_129_to_240_bytes
function impl_129_to_240_bytes(secret: Secret, seed: bigint, input: Uint8Array): bigint {
  assert_input_range(129, 240, input.length);
  const input_len = IntoU64_usize.into_u64(input.length);
  let acc: [bigint, bigint] = [u64_wrapping_mul(input_len, PRIME64_1), 0n];

  const head = pairs_of_u64_bytes(input);
  // let mut head = head.iter();
  let head_pos = 0;

  let ss = secret.for_128().words_for_127_to_240_part1();
  // for (input, secret) in head.by_ref().zip(ss).take(4)
  for (let k = 0; k < 4; k++) {
    if (head_pos >= head.length) break;
    const input = head[head_pos++]!;
    if (k >= ss.length) break;
    mix_two_chunks(acc, input[0]!, input[1]!, ss[k]!, seed);
  }

  acc = [avalanche(acc[0]), avalanche(acc[1])];

  ss = secret.for_128().words_for_127_to_240_part2();
  // for (input, secret) in head.zip(ss)
  for (let k = 0; ; k++) {
    if (head_pos >= head.length) break;
    const input = head[head_pos++]!;
    if (k >= ss.length) break;
    mix_two_chunks(acc, input[0]!, input[1]!, ss[k]!, seed);
  }

  const [, tail0] = bp_as_rchunks(input, 16);
  const [, tail1] = bp_as_rchunks(tail0, 2);
  const tail = unwrap(tail1[tail1.length - 1]);
  const ss3 = secret.for_128().words_for_127_to_240_part3();

  // note that the half-chunk order and the seed is different here
  mix_two_chunks(acc, tail[1]!, tail[0]!, ss3, u64_wrapping_neg(seed));

  return finalize_medium(acc, input_len, seed);
}

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:384 mix_two_chunks
function mix_two_chunks(acc: [bigint, bigint], data1: Uint8Array, data2: Uint8Array, secret: readonly Uint8Array[], seed: bigint): void {
  const data_words1 = to_u64s(data1);
  const data_words2 = to_u64s(data2);

  acc[0] = u64_wrapping_add(acc[0], mix_step(data1, secret[0]!, seed));
  acc[1] = u64_wrapping_add(acc[1], mix_step(data2, secret[1]!, seed));
  acc[0] ^= u64_wrapping_add(data_words2[0], data_words2[1]);
  acc[1] ^= u64_wrapping_add(data_words1[0], data_words1[1]);
}

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:401 finalize_medium
function finalize_medium(acc: [bigint, bigint], input_len: bigint, seed: bigint): bigint {
  let low = u64_wrapping_add(acc[0], acc[1]);
  let high = u64_wrapping_add(
    u64_wrapping_add(u64_wrapping_mul(acc[0], PRIME64_1), u64_wrapping_mul(acc[1], PRIME64_4)),
    u64_wrapping_mul(u64_wrapping_sub(input_len, seed), PRIME64_2),
  );

  low = avalanche(low);
  high = u64_wrapping_neg(avalanche(high));

  return u128_from_X128({ low, high });
}

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:415 impl_241_plus_bytes
function impl_241_plus_bytes(secret: Secret, input: Uint8Array): bigint {
  assert_input_range(241, undefined, input.length);
  // dispatch! { fn oneshot_impl<>(secret: &Secret, input: &[u8]) -> u128 [] }
  // crate: twox-hash-2.1.2/src/xxhash3_128.rs:418 oneshot_impl
  return do_scalar(oneshot_impl, secret, input);
}

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:424 oneshot_impl
function oneshot_impl(vector: Vector, secret: Secret, input: Uint8Array): bigint {
  return new Algorithm(vector).oneshot(secret, input, Finalize128);
}
