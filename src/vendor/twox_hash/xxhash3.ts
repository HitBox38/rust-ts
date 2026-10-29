// Port of twox-hash =2.1.2 `src/xxhash3.rs` (the code shared by XXH3-64 and XXH3-128).
//
// PORT: the module re-exports (`pub use large::{..}`, `pub use secret::{..}`, `pub use streaming::{..}`,
// `pub(crate) use large::dispatch`) are not repeated here: users import from the submodule. Only
// `xxhash3/secret.ts` is imported (for `DEFAULT_SECRET`), because `large.ts` and `streaming.ts` read this
// module's constants at module level and so must evaluate after it.
//
// PORT: u64 is `bigint` kept in [0, 2^64) (the `wrapping_*` helpers below mask), u128 is `bigint` in
// [0, 2^128), u32/u8/usize are `number`. `&[u8]`/`&[u8; N]` are `Uint8Array` views (`subarray`), so a
// `&mut` chunk writes through to its slice.

import { assert } from "../../std/panic.ts";
import { debug_tuple, type Debug } from "../../std/fmt.ts";
import { IntoU128_u64, IntoU32_u8 } from "./lib.ts";
import { debug_Error, display_Error, type Error as SecretError, Secret } from "./xxhash3/secret.ts";

// ---- u64 / u128 / u32 arithmetic (Rust's integer methods) ----

export const M32 = 0xffff_ffffn;
export const M64 = 0xffff_ffff_ffff_ffffn;
export const M128 = 0xffff_ffff_ffff_ffff_ffff_ffff_ffff_ffffn;

export function u64_wrapping_add(a: bigint, b: bigint): bigint {
  return (a + b) & M64;
}
export function u64_wrapping_sub(a: bigint, b: bigint): bigint {
  return (a - b) & M64;
}
export function u64_wrapping_mul(a: bigint, b: bigint): bigint {
  return (a * b) & M64;
}
export function u64_wrapping_neg(a: bigint): bigint {
  return -a & M64;
}
/** `!x` on a u64. */
export function u64_not(a: bigint): bigint {
  return a ^ M64;
}
export function u64_swap_bytes(a: bigint): bigint {
  let r = 0n;
  for (let i = 0; i < 8; i++) {
    r = (r << 8n) | (a & 0xffn);
    a >>= 8n;
  }
  return r;
}
export function u128_wrapping_mul(a: bigint, b: bigint): bigint {
  return (a * b) & M128;
}
export function u32_swap_bytes(a: number): number {
  return ((a >>> 24) | ((a >>> 8) & 0xff00) | ((a << 8) & 0xff0000) | (a << 24)) >>> 0;
}
export function u32_rotate_left(a: number, n: number): number {
  return ((a << n) | (a >>> (32 - n))) >>> 0;
}
/** `u32::from_le_bytes` of the 4 bytes at `off`. */
export function u32_from_le_bytes(b: Uint8Array, off = 0): number {
  return (b[off]! | (b[off + 1]! << 8) | (b[off + 2]! << 16) | (b[off + 3]! << 24)) >>> 0;
}
/** `u64::from_le_bytes` of the 8 bytes at `off`. */
export function u64_from_le_bytes(b: Uint8Array, off = 0): bigint {
  return BigInt(u32_from_le_bytes(b, off)) | (BigInt(u32_from_le_bytes(b, off + 4)) << 32n);
}
/** `u64::to_le_bytes`. */
export function u64_to_le_bytes(x: bigint): Uint8Array {
  const b = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}

// pub mod primes
export const primes = {
  PRIME32_1: 0x9e3779b1n,
  PRIME32_2: 0x85ebca77n,
  PRIME32_3: 0xc2b2ae3dn,
  PRIME64_1: 0x9e3779b185ebca87n,
  PRIME64_2: 0xc2b2ae3d27d4eb4fn,
  PRIME64_3: 0x165667b19e3779f9n,
  PRIME64_4: 0x85ebca77c2b2ae63n,
  PRIME64_5: 0x27d4eb2f165667c5n,
  PRIME_MX1: 0x165667919e3779f9n,
  PRIME_MX2: 0x9fb21c651e98df25n,
} as const;

export const CUTOFF = 240;

export const DEFAULT_SEED = 0n;

/// The length of the default secret.
export const DEFAULT_SECRET_LENGTH = 192;

/** `pub type DefaultSecret = [u8; DEFAULT_SECRET_LENGTH];` */
export type DefaultSecret = Uint8Array;

/** PORT: shared and never written; users that need a mutable copy (`let mut secret = DEFAULT_SECRET_RAW;`) `slice()` it. */
export const DEFAULT_SECRET_RAW: DefaultSecret = Uint8Array.of(
  0xb8, 0xfe, 0x6c, 0x39, 0x23, 0xa4, 0x4b, 0xbe, 0x7c, 0x01, 0x81, 0x2c, 0xf7, 0x21, 0xad, 0x1c,
  0xde, 0xd4, 0x6d, 0xe9, 0x83, 0x90, 0x97, 0xdb, 0x72, 0x40, 0xa4, 0xa4, 0xb7, 0xb3, 0x67, 0x1f,
  0xcb, 0x79, 0xe6, 0x4e, 0xcc, 0xc0, 0xe5, 0x78, 0x82, 0x5a, 0xd0, 0x7d, 0xcc, 0xff, 0x72, 0x21,
  0xb8, 0x08, 0x46, 0x74, 0xf7, 0x43, 0x24, 0x8e, 0xe0, 0x35, 0x90, 0xe6, 0x81, 0x3a, 0x26, 0x4c,
  0x3c, 0x28, 0x52, 0xbb, 0x91, 0xc3, 0x00, 0xcb, 0x88, 0xd0, 0x65, 0x8b, 0x1b, 0x53, 0x2e, 0xa3,
  0x71, 0x64, 0x48, 0x97, 0xa2, 0x0d, 0xf9, 0x4e, 0x38, 0x19, 0xef, 0x46, 0xa9, 0xde, 0xac, 0xd8,
  0xa8, 0xfa, 0x76, 0x3f, 0xe3, 0x9c, 0x34, 0x3f, 0xf9, 0xdc, 0xbb, 0xc7, 0xc7, 0x0b, 0x4f, 0x1d,
  0x8a, 0x51, 0xe0, 0x4b, 0xcd, 0xb4, 0x59, 0x31, 0xc8, 0x9f, 0x7e, 0xc9, 0xd9, 0x78, 0x73, 0x64,
  0xea, 0xc5, 0xac, 0x83, 0x34, 0xd3, 0xeb, 0xc3, 0xc5, 0x81, 0xa0, 0xff, 0xfa, 0x13, 0x63, 0xeb,
  0x17, 0x0d, 0xdd, 0x51, 0xb7, 0xf0, 0xda, 0x49, 0xd3, 0x16, 0x55, 0x26, 0x29, 0xd4, 0x68, 0x9e,
  0x2b, 0x16, 0xbe, 0x58, 0x7d, 0x47, 0xa1, 0xfc, 0x8f, 0xf8, 0xb8, 0xd1, 0x7a, 0xd0, 0x31, 0xce,
  0x45, 0xcb, 0x3a, 0x8f, 0x95, 0x16, 0x04, 0x28, 0xaf, 0xd7, 0xfb, 0xca, 0xbb, 0x4b, 0x40, 0x7e,
);

// Safety: The default secret is long enough
export const DEFAULT_SECRET: Secret = Secret.new_unchecked(DEFAULT_SECRET_RAW);

/// # Correctness
///
/// This function assumes that the incoming buffer has been populated
/// with the default secret.
// crate: twox-hash-2.1.2/src/xxhash3.rs:69 derive_secret
export function derive_secret(seed: bigint, secret: DefaultSecret): void {
  if (seed === DEFAULT_SEED) {
    return;
  }

  const [words] = bp_as_chunks_mut(secret, 8);
  const [pairs] = bp_as_chunks_mut(words, 2);

  for (const [a_p, b_p] of pairs as [Uint8Array, Uint8Array][]) {
    let a = u64_from_le_bytes(a_p);
    let b = u64_from_le_bytes(b_p);

    a = u64_wrapping_add(a, seed);
    b = u64_wrapping_sub(b, seed);

    a_p.set(u64_to_le_bytes(a));
    b_p.set(u64_to_le_bytes(b));
  }
}

/// The provided secret was not at least [`SECRET_MINIMUM_LENGTH`][]
/// bytes.
export interface OneshotWithSecretError {
  readonly _0: SecretError;
}

export const debug_OneshotWithSecretError: Debug<OneshotWithSecretError> = (v, f) =>
  debug_tuple(f, "OneshotWithSecretError", [debug_Error(v._0, f)]);

// impl core::fmt::Display for OneshotWithSecretError
// crate: twox-hash-2.1.2/src/xxhash3.rs:97 fmt
export function display_OneshotWithSecretError(self: OneshotWithSecretError): string {
  return display_Error(self._0);
}

/** `macro_rules! assert_input_range`: `$min..` when `max` is `undefined`, else `$min..=$max`. */
export function assert_input_range(min: number, max: number | undefined, len: number): void {
  assert(min <= len, `assertion failed: ${min} <= input.len()`);
  if (max !== undefined) {
    assert(len <= max, `assertion failed: input.len() <= ${max}`);
  }
}

// crate: twox-hash-2.1.2/src/xxhash3.rs:114 impl_1_to_3_bytes_combined
export function impl_1_to_3_bytes_combined(input: Uint8Array): number {
  assert_input_range(1, 3, input.length);
  const input_length = input.length; // OK as we checked that the length fits

  return (
    (IntoU32_u8.into_u32(input[input.length - 1]!) |
      (IntoU32_u8.into_u32(input_length) << 8) |
      (IntoU32_u8.into_u32(input[0]!) << 16) |
      (IntoU32_u8.into_u32(input[input.length >> 1]!) << 24)) >>>
    0
  );
}

// crate: twox-hash-2.1.2/src/xxhash3.rs:125 impl_17_to_128_bytes_iter
export function impl_17_to_128_bytes_iter(
  secret_: Secret,
  input: Uint8Array,
  f: (fwd: Uint8Array, bwd: Uint8Array, secret: readonly Uint8Array[]) => void,
): void {
  const secret0 = secret_.words_for_17_to_128();
  const [secret] = bp_as_chunks(secret0, 2);
  const [fwd] = bp_as_chunks(input, 16);
  const [, bwd] = bp_as_rchunks(input, 16);

  const q = bwd.length;

  if (input.length > 32) {
    if (input.length > 64) {
      if (input.length > 96) {
        f(fwd[3]!, bwd[q - 4]!, secret[3]!);
      }

      f(fwd[2]!, bwd[q - 3]!, secret[2]!);
    }

    f(fwd[1]!, bwd[q - 2]!, secret[1]!);
  }

  f(fwd[0]!, bwd[q - 1]!, secret[0]!);
}

// crate: twox-hash-2.1.2/src/xxhash3.rs:153 mix_step
export function mix_step(data: Uint8Array, secret: Uint8Array, seed: bigint): bigint {
  const data_words = to_u64s(data);
  const secret_words = to_u64s(secret);

  const mul_result = (() => {
    const a = IntoU128_u64.into_u128(data_words[0] ^ u64_wrapping_add(secret_words[0], seed));
    const b = IntoU128_u64.into_u128(data_words[1] ^ u64_wrapping_sub(secret_words[1], seed));

    return u128_wrapping_mul(a, b);
  })();

  return Halves_u128.lower_half(mul_result) ^ Halves_u128.upper_half(mul_result);
}

// crate: twox-hash-2.1.2/src/xxhash3.rs:168 to_u64s
export function to_u64s(bytes: Uint8Array): [bigint, bigint] {
  const [pair] = bp_as_chunks(bytes, 8);
  return [u64_from_le_bytes(pair[0]!), u64_from_le_bytes(pair[1]!)];
}

// #[cfg(feature = "xxhash3_128")]
/** PORT: `&[[[u8; 16]; 2]]` is an array of `[lo, hi]` 16-byte views. */
// crate: twox-hash-2.1.2/src/xxhash3.rs:175 pairs_of_u64_bytes
export function pairs_of_u64_bytes(bytes: Uint8Array): Uint8Array[][] {
  const [u64_bytes] = bp_as_chunks(bytes, 16);
  const [pairs] = bp_as_chunks(u64_bytes, 2);
  return pairs;
}

// crate: twox-hash-2.1.2/src/xxhash3.rs:182 avalanche
export function avalanche(x: bigint): bigint {
  x ^= x >> 37n;
  x = u64_wrapping_mul(x, primes.PRIME_MX1);
  x ^= x >> 32n;
  return x;
}

// crate: twox-hash-2.1.2/src/xxhash3.rs:190 avalanche_xxh64
export function avalanche_xxh64(x: bigint): bigint {
  x ^= x >> 33n;
  x = u64_wrapping_mul(x, primes.PRIME64_2);
  x ^= x >> 29n;
  x = u64_wrapping_mul(x, primes.PRIME64_3);
  x ^= x >> 32n;
  return x;
}

/** PORT: `(&[[u8; 64]], &[u8])` -> `[stripes, tail]` views. */
// crate: twox-hash-2.1.2/src/xxhash3.rs:200 stripes_with_tail
export function stripes_with_tail(block: Uint8Array): [Uint8Array[], Uint8Array] {
  const [stripes, last] = bp_as_chunks(block, 64);
  // ([stripes @ .., last], []) => (stripes, last),
  if (stripes.length >= 1 && last.length === 0) {
    return [stripes.slice(0, -1), stripes[stripes.length - 1]!];
  }
  // (stripes, last) => (stripes, last),
  return [stripes, last];
}

/// THis exists just to easily map the XXH3 algorithm to Rust as the
/// algorithm describes 128-bit results as a pair of high and low u64
/// values.
export interface X128 {
  low: bigint;
  high: bigint;
}

// impl From<X128> for u128
// crate: twox-hash-2.1.2/src/xxhash3.rs:217 from
export function u128_from_X128(value: X128): bigint {
  return (IntoU128_u64.into_u128(value.high) << 64n) | IntoU128_u64.into_u128(value.low);
}

// impl crate::IntoU128 for X128
export const IntoU128_X128 = {
  // crate: twox-hash-2.1.2/src/xxhash3.rs:223 into_u128
  into_u128(self: X128): bigint {
    return u128_from_X128(self);
  },
};

// trait Halves
export interface Halves<Self, Output> {
  // crate: twox-hash-2.1.2/src/xxhash3.rs:231 upper_half
  upper_half(self: Self): Output;
  // crate: twox-hash-2.1.2/src/xxhash3.rs:232 lower_half
  lower_half(self: Self): Output;
}

// impl Halves for u64 { type Output = u32; }
export const Halves_u64: Halves<bigint, number> = {
  // crate: twox-hash-2.1.2/src/xxhash3.rs:239 upper_half
  upper_half(self: bigint): number {
    return Number(self >> 32n);
  },

  // crate: twox-hash-2.1.2/src/xxhash3.rs:244 lower_half
  lower_half(self: bigint): number {
    return Number(self & M32);
  },
};

// impl Halves for u128 { type Output = u64; }
export const Halves_u128: Halves<bigint, bigint> = {
  // crate: twox-hash-2.1.2/src/xxhash3.rs:253 upper_half
  upper_half(self: bigint): bigint {
    return self >> 64n;
  },

  // crate: twox-hash-2.1.2/src/xxhash3.rs:258 lower_half
  lower_half(self: bigint): bigint {
    return self & M64;
  },
};

// trait U8SliceExt
export interface U8SliceExt {
  // crate: twox-hash-2.1.2/src/xxhash3.rs:264 first_u32
  first_u32(self: Uint8Array): number | undefined;

  // crate: twox-hash-2.1.2/src/xxhash3.rs:266 last_u32
  last_u32(self: Uint8Array): number | undefined;

  // crate: twox-hash-2.1.2/src/xxhash3.rs:268 first_u64
  first_u64(self: Uint8Array): bigint | undefined;

  // crate: twox-hash-2.1.2/src/xxhash3.rs:270 last_u64
  last_u64(self: Uint8Array): bigint | undefined;
}

// impl U8SliceExt for [u8]
export const U8SliceExt: U8SliceExt = {
  // crate: twox-hash-2.1.2/src/xxhash3.rs:275 first_u32
  first_u32(self: Uint8Array): number | undefined {
    return self.length >= 4 ? u32_from_le_bytes(self, 0) : undefined;
  },

  // crate: twox-hash-2.1.2/src/xxhash3.rs:280 last_u32
  last_u32(self: Uint8Array): number | undefined {
    return self.length >= 4 ? u32_from_le_bytes(self, self.length - 4) : undefined;
  },

  // crate: twox-hash-2.1.2/src/xxhash3.rs:285 first_u64
  first_u64(self: Uint8Array): bigint | undefined {
    return self.length >= 8 ? u64_from_le_bytes(self, 0) : undefined;
  },

  // crate: twox-hash-2.1.2/src/xxhash3.rs:290 last_u64
  last_u64(self: Uint8Array): bigint | undefined {
    return self.length >= 8 ? u64_from_le_bytes(self, self.length - 8) : undefined;
  },
};

// trait SliceBackport<T>
export interface SliceBackport {
  // crate: twox-hash-2.1.2/src/xxhash3.rs:296 bp_as_chunks
  bp_as_chunks: typeof bp_as_chunks;

  // crate: twox-hash-2.1.2/src/xxhash3.rs:298 bp_as_chunks_mut
  bp_as_chunks_mut: typeof bp_as_chunks_mut;

  // crate: twox-hash-2.1.2/src/xxhash3.rs:300 bp_as_rchunks
  bp_as_rchunks: typeof bp_as_rchunks;
}

// impl<T> SliceBackport<T> for [T]
// PORT: the impl is three free functions taking the slice first and `N` as a number. A `Uint8Array` is
// split into `subarray` views (writes go through to the slice, as with `&mut [[u8; N]]`); a plain array
// of chunks into new arrays of the same element objects.

// crate: twox-hash-2.1.2/src/xxhash3.rs:304 bp_as_chunks
export function bp_as_chunks(self: Uint8Array, N: number): [Uint8Array[], Uint8Array];
export function bp_as_chunks<T>(self: readonly T[], N: number): [T[][], T[]];
export function bp_as_chunks<T>(self: Uint8Array | readonly T[], N: number): [unknown[], unknown] {
  assert(N !== 0, "assertion `left != right` failed");
  const len = Math.floor(self.length / N);
  // Safety: `(len / N) * N` has to be less-than-or-equal to `len`
  const head: unknown[] = [];
  if (self instanceof Uint8Array) {
    for (let i = 0; i < len; i++) head.push(self.subarray(i * N, i * N + N));
    return [head, self.subarray(len * N)];
  }
  for (let i = 0; i < len; i++) head.push(self.slice(i * N, i * N + N));
  return [head, self.slice(len * N)];
}

// crate: twox-hash-2.1.2/src/xxhash3.rs:317 bp_as_chunks_mut
export function bp_as_chunks_mut(self: Uint8Array, N: number): [Uint8Array[], Uint8Array];
export function bp_as_chunks_mut<T>(self: T[], N: number): [T[][], T[]];
export function bp_as_chunks_mut<T>(self: Uint8Array | T[], N: number): [unknown[], unknown] {
  assert(N !== 0, "assertion `left != right` failed");
  // Safety: `(len / N) * N` has to be less than or equal to `len`
  return bp_as_chunks(self as T[], N);
}

// crate: twox-hash-2.1.2/src/xxhash3.rs:330 bp_as_rchunks
export function bp_as_rchunks(self: Uint8Array, N: number): [Uint8Array, Uint8Array[]];
export function bp_as_rchunks<T>(self: readonly T[], N: number): [T[], T[][]];
export function bp_as_rchunks<T>(self: Uint8Array | readonly T[], N: number): [unknown, unknown[]] {
  assert(N !== 0, "assertion `left != right` failed");
  const len = Math.floor(self.length / N);
  // Safety: `(len / N) * N` has to be less than or equal to `len`
  const start = self.length - len * N;
  const tail: unknown[] = [];
  if (self instanceof Uint8Array) {
    for (let i = 0; i < len; i++) tail.push(self.subarray(start + i * N, start + i * N + N));
    return [self.subarray(0, start), tail];
  }
  for (let i = 0; i < len; i++) tail.push(self.slice(start + i * N, start + i * N + N));
  return [self.slice(0, start), tail];
}
