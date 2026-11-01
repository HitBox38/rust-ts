//! Math helper functions
//
// Port of rand =0.10.1 `src/distr/utils.rs`: the integer `WideningMultiply` impls (the float/SIMD helpers serve
// distributions Miri does not use and are not ported).
// PORT: `WideningMultiply` is one function per type, returning `[hi, lo]`. u8..u32 and usize are `number`,
// u64/u128 are `bigint`.
import { unported } from "../../../std/panic.ts";

/// Widening multiply: `(hi, lo)` of the double-width product.
export interface WideningMultiply<T> {
  // crate: rand-0.10.1/src/distr/utils.rs:19 wmul
  wmul(self: T, x: T): [T, T];
}

const U64_MASK = 0xffff_ffff_ffff_ffffn;
const U128_MASK = (1n << 128n) - 1n;

// wmul_impl! { u8, u16, 8 }
export const wmul_u8: WideningMultiply<number> = {
  // crate: rand-0.10.1/src/distr/utils.rs:28 wmul
  wmul(self: number, x: number): [number, number] {
    const tmp = self * x;
    return [tmp >>> 8, tmp & 0xff];
  },
};

// wmul_impl! { u16, u32, 16 }
export const wmul_u16: WideningMultiply<number> = {
  // crate: rand-0.10.1/src/distr/utils.rs:28 wmul
  wmul(self: number, x: number): [number, number] {
    const tmp = self * x;
    return [tmp >>> 16, tmp & 0xffff];
  },
};

// wmul_impl! { u32, u64, 32 }
// PORT: the u64 product exceeds 2^53, so it is formed from 16-bit halves.
export const wmul_u32: WideningMultiply<number> = {
  // crate: rand-0.10.1/src/distr/utils.rs:28 wmul
  wmul(self: number, x: number): [number, number] {
    const a_lo = self & 0xffff;
    const a_hi = self >>> 16;
    const b_lo = x & 0xffff;
    const b_hi = x >>> 16;
    const ll = a_lo * b_lo;
    const lh = a_lo * b_hi;
    const hl = a_hi * b_lo;
    const hh = a_hi * b_hi;
    // ll + ((lh + hl) << 16) + (hh << 32), carried in exact doubles (every term < 2^53)
    const mid = lh + hl + Math.floor(ll / 0x1_0000);
    const lo = ((mid % 0x1_0000) * 0x1_0000 + (ll % 0x1_0000)) >>> 0;
    const hi = (hh + Math.floor(mid / 0x1_0000)) >>> 0;
    return [hi, lo];
  },
};

// wmul_impl! { u64, u128, 64 }
export const wmul_u64: WideningMultiply<bigint> = {
  // crate: rand-0.10.1/src/distr/utils.rs:28 wmul
  wmul(self: bigint, x: bigint): [bigint, bigint] {
    const tmp = self * x;
    return [(tmp >> 64n) & U64_MASK, tmp & U64_MASK];
  },
};

// crate-skip: rand-0.10.1/src/distr/utils.rs:42 wmul cfg(feature = "simd_support"): off in Miri's rand (default features)

// This code is a translation of the __mulddi3 function in LLVM's
// compiler-rt. It is an optimised variant of the common method
// `(a + b) * (c + d) = ac + ad + bc + bd`.
//
// For some reason LLVM can optimise the C version very well, but
// keeps shuffling registers in this Rust translation.
// wmul_impl_large! { u128, 64 }
export const wmul_u128: WideningMultiply<bigint> = {
  // crate: rand-0.10.1/src/distr/utils.rs:75 wmul
  wmul(self: bigint, b: bigint): [bigint, bigint] {
    const half = 64n;
    const LOWER_MASK = U128_MASK >> half;
    const wmul = (p: bigint, q: bigint) => (p * q) & U128_MASK;
    let low = wmul(self & LOWER_MASK, b & LOWER_MASK);
    let t = low >> half;
    low &= LOWER_MASK;
    t = (t + wmul(self >> half, b & LOWER_MASK)) & U128_MASK;
    low = (low + ((t & LOWER_MASK) << half)) & U128_MASK;
    let high = t >> half;
    t = low >> half;
    low &= LOWER_MASK;
    t = (t + wmul(b >> half, self & LOWER_MASK)) & U128_MASK;
    low = (low + ((t & LOWER_MASK) << half)) & U128_MASK;
    high = (high + (t >> half)) & U128_MASK;
    high = (high + wmul(self >> half, b >> half)) & U128_MASK;

    return [high, low];
  },
};

// crate-skip: rand-0.10.1/src/distr/utils.rs:102 wmul cfg(feature = "simd_support"): off in Miri's rand (default features)

// wmul_impl_usize! { u64 } (target_pointer_width = "64")
// PORT: usize is `number`; a half above 2^53 has no exact `number` (no caller in this port uses usize wmul:
// `UniformUsize` multiplies as u32 or u64).
export const wmul_usize: WideningMultiply<number> = {
  // crate: rand-0.10.1/src/distr/utils.rs:133 wmul
  wmul(self: number, x: number): [number, number] {
    const [high, low] = wmul_u64.wmul(BigInt(self), BigInt(x));
    const MAX = BigInt(Number.MAX_SAFE_INTEGER);
    if (high > MAX || low > MAX) unported("rand usize wmul with a half above 2^53 (usize as number)");
    return [Number(high), Number(low)];
  },
};

// crate-skip: rand-0.10.1/src/distr/utils.rs:183 wmul cfg(feature = "simd_support") x86 SIMD: off in Miri's rand (default features)
