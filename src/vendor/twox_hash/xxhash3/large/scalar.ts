// Port of twox-hash =2.1.2 `src/xxhash3/large/scalar.rs`.
//
// PORT: this is the hot loop of XXH3 on large inputs, on `Acc` u32 pairs (see `../large.ts`): each u64
// operation is written out on the (low, high) halves. `bp_as_chunks::<8>` of a stripe or secret is not
// materialised: chunk `i` is read in place at byte offset `8 * i`.

import { primes, u32_from_le_bytes } from "../../xxhash3.ts";
import type { Acc, Vector } from "../large.ts";

/** `PRIME32_1` as a `number` (it fits in 32 bits). */
const PRIME32_1 = Number(primes.PRIME32_1);

const TWO_32 = 0x1_0000_0000;

/** High 32 bits of the last `mul_32_32` product. */
let mul_hi = 0;

/** The full 64-bit product of two u32s: returns the low 32 bits and leaves the high 32 bits in `mul_hi`. */
function mul_32_32(a: number, b: number): number {
  const a_lo = a & 0xffff;
  const a_hi = a >>> 16;
  const b_lo = b & 0xffff;
  const b_hi = b >>> 16;
  const mid = a_hi * b_lo + a_lo * b_hi; // < 2^33, exact
  const lo = a_lo * b_lo + (mid % 0x1_0000) * 0x1_0000; // < 2^33, exact
  mul_hi = (a_hi * b_hi + Math.floor(mid / 0x1_0000) + Math.floor(lo / TWO_32)) >>> 0;
  return lo >>> 0;
}

// #[derive(Copy, Clone)]
// pub struct Impl;
// impl Vector for Impl
export const Impl: Vector = {
  // crate: twox-hash-2.1.2/src/xxhash3/large/scalar.rs:9 round_scramble
  round_scramble(acc: Acc, secret_end: Uint8Array): void {
    // let (last, _) = secret_end.bp_as_chunks();
    // let last = last.iter().copied().map(u64::from_le_bytes);

    for (let i = 0; i < 8; i++) {
      const s_lo = u32_from_le_bytes(secret_end, 8 * i);
      const s_hi = u32_from_le_bytes(secret_end, 8 * i + 4);
      let lo = acc[2 * i]!;
      let hi = acc[2 * i + 1]!;
      // *acc ^= *acc >> 47;
      lo = (lo ^ (hi >>> 15)) >>> 0;
      // *acc ^= secret;
      lo = (lo ^ s_lo) >>> 0;
      hi = (hi ^ s_hi) >>> 0;
      // *acc = acc.wrapping_mul(PRIME32_1);
      const p_lo = mul_32_32(lo, PRIME32_1);
      acc[2 * i] = p_lo;
      acc[2 * i + 1] = mul_hi + Math.imul(hi, PRIME32_1);
    }
  },

  // crate: twox-hash-2.1.2/src/xxhash3/large/scalar.rs:21 accumulate
  accumulate(acc: Acc, stripe_: Uint8Array, secret_: Uint8Array): void {
    // let (stripe, _) = stripe.bp_as_chunks();
    // let (secret, _) = secret.bp_as_chunks();

    for (let i = 0; i < 8; i++) {
      // let stripe = u64::from_le_bytes(stripe[i]);
      const stripe_lo = u32_from_le_bytes(stripe_, 8 * i);
      const stripe_hi = u32_from_le_bytes(stripe_, 8 * i + 4);
      // let secret = u64::from_le_bytes(secret[i]);
      const secret_lo = u32_from_le_bytes(secret_, 8 * i);
      const secret_hi = u32_from_le_bytes(secret_, 8 * i + 4);

      // let value = stripe ^ secret;
      const value_lo = (stripe_lo ^ secret_lo) >>> 0;
      const value_hi = (stripe_hi ^ secret_hi) >>> 0;
      // acc[i ^ 1] = acc[i ^ 1].wrapping_add(stripe);
      const j = 2 * (i ^ 1);
      const sum = acc[j]! + stripe_lo;
      acc[j] = sum;
      acc[j + 1] = acc[j + 1]! + stripe_hi + (sum >= TWO_32 ? 1 : 0);
      // acc[i] = multiply_64_as_32_and_add(value, value >> 32, acc[i]);
      multiply_64_as_32_and_add(value_lo, value_hi, acc, i);
    }
  },
};

/**
 * PORT: `lhs` and `rhs` are passed as their low 32 bits (all the function reads: `as u32`), and `acc` as
 * lane `i` of an `Acc`, which receives the result.
 */
// #[cfg(any(miri, not(target_arch = "aarch64")))]
// crate: twox-hash-2.1.2/src/xxhash3/large/scalar.rs:38 multiply_64_as_32_and_add
function multiply_64_as_32_and_add(lhs: number, rhs: number, acc: Acc, i: number): void {
  // use super::IntoU64;

  // let lhs = (lhs as u32).into_u64();
  // let rhs = (rhs as u32).into_u64();

  // let product = lhs.wrapping_mul(rhs);
  const product_lo = mul_32_32(lhs, rhs);
  const product_hi = mul_hi;
  // acc.wrapping_add(product)
  const sum = acc[2 * i]! + product_lo;
  acc[2 * i] = sum;
  acc[2 * i + 1] = acc[2 * i + 1]! + product_hi + (sum >= TWO_32 ? 1 : 0);
}

// https://github.com/Cyan4973/xxHash/blob/d5fe4f54c47bc8b8e76c6da9146c32d5c720cd79/xxhash.h#L5595-L5610
// https://github.com/llvm/llvm-project/issues/98481
// crate-skip: twox-hash-2.1.2/src/xxhash3/large/scalar.rs:52 multiply_64_as_32_and_add cfg(all(not(miri), target_arch = "aarch64")): the `umaddl` inline-asm form of the same `acc + (lhs as u32) * (rhs as u32)`
