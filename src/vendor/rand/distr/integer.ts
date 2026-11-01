//! The implementations of the `StandardUniform` distribution for integer types.
//
// Port of rand =0.10.1 `src/distr/integer.rs`.
// PORT: each `impl Distribution<$ty> for StandardUniform` is a `StandardUniform_<ty>` table. u8..u32, i8..i32
// are `number`; u64/i64/u128/i128 are `bigint`. `NonZero*` values are their integer (never 0).
import type { Rng } from "../../rand_core/lib.ts";
import type { Distribution } from "./distribution.ts";

// impl Distribution<u8> for StandardUniform
export const StandardUniform_u8: Distribution<number> = {
  // crate: rand-0.10.1/src/distr/integer.rs:30 sample
  sample(rng: Rng): number {
    return rng.next_u32() & 0xff;
  },
};

// impl Distribution<u16> for StandardUniform
export const StandardUniform_u16: Distribution<number> = {
  // crate: rand-0.10.1/src/distr/integer.rs:37 sample
  sample(rng: Rng): number {
    return rng.next_u32() & 0xffff;
  },
};

// impl Distribution<u32> for StandardUniform
export const StandardUniform_u32: Distribution<number> = {
  // crate: rand-0.10.1/src/distr/integer.rs:44 sample
  sample(rng: Rng): number {
    return rng.next_u32();
  },
};

// impl Distribution<u64> for StandardUniform
export const StandardUniform_u64: Distribution<bigint> = {
  // crate: rand-0.10.1/src/distr/integer.rs:51 sample
  sample(rng: Rng): bigint {
    return rng.next_u64();
  },
};

// impl Distribution<u128> for StandardUniform
export const StandardUniform_u128: Distribution<bigint> = {
  // crate: rand-0.10.1/src/distr/integer.rs:58 sample
  sample(rng: Rng): bigint {
    // Use LE; we explicitly generate one value before the next.
    const x = rng.next_u64();
    const y = rng.next_u64();
    return (y << 64n) | x;
  },
};

// macro_rules! impl_int_from_uint
function impl_int_from_uint<T>(uty: Distribution<T>, as_ty: (x: T) => T): Distribution<T> {
  return {
    // crate: rand-0.10.1/src/distr/integer.rs:70 sample
    sample(rng: Rng): T {
      return as_ty(uty.sample(rng));
    },
  };
}

export const StandardUniform_i8 = impl_int_from_uint(StandardUniform_u8, (x) => (x << 24) >> 24);
export const StandardUniform_i16 = impl_int_from_uint(StandardUniform_u16, (x) => (x << 16) >> 16);
export const StandardUniform_i32 = impl_int_from_uint(StandardUniform_u32, (x) => x | 0);
export const StandardUniform_i64 = impl_int_from_uint(StandardUniform_u64, (x) => BigInt.asIntN(64, x));
export const StandardUniform_i128 = impl_int_from_uint(StandardUniform_u128, (x) => BigInt.asIntN(128, x));

// macro_rules! impl_nzint
// PORT: `$new(x)` is `NonZero::new`, i.e. `None` for 0.
function impl_nzint<T extends number | bigint>(ty: Distribution<T>): Distribution<T> {
  return {
    // crate: rand-0.10.1/src/distr/integer.rs:86 sample
    sample(rng: Rng): T {
      for (;;) {
        const x = ty.sample(rng);
        if (x !== 0 && x !== 0n) {
          return x;
        }
      }
    },
  };
}

export const StandardUniform_NonZeroU8 = impl_nzint(StandardUniform_u8);
export const StandardUniform_NonZeroU16 = impl_nzint(StandardUniform_u16);
export const StandardUniform_NonZeroU32 = impl_nzint(StandardUniform_u32);
export const StandardUniform_NonZeroU64 = impl_nzint(StandardUniform_u64);
export const StandardUniform_NonZeroU128 = impl_nzint(StandardUniform_u128);

export const StandardUniform_NonZeroI8 = impl_nzint(StandardUniform_i8);
export const StandardUniform_NonZeroI16 = impl_nzint(StandardUniform_i16);
export const StandardUniform_NonZeroI32 = impl_nzint(StandardUniform_i32);
export const StandardUniform_NonZeroI64 = impl_nzint(StandardUniform_i64);
export const StandardUniform_NonZeroI128 = impl_nzint(StandardUniform_i128);

// crate-skip: rand-0.10.1/src/distr/integer.rs:112 sample cfg(target_arch = "x86"/"x86_64") `__m128i`: x86 SIMD register type (compiled on x86/x86_64 hosts); Miri never samples it
// crate-skip: rand-0.10.1/src/distr/integer.rs:129 sample cfg(target_arch = "x86"/"x86_64") `__m256i`: x86 SIMD register type (compiled on x86/x86_64 hosts); Miri never samples it
// crate-skip: rand-0.10.1/src/distr/integer.rs:145 sample cfg(feature = "simd_support") `__m512i`: off in Miri's rand (default features)
// crate-skip: rand-0.10.1/src/distr/integer.rs:164 sample cfg(feature = "simd_support"): off in Miri's rand (default features)
