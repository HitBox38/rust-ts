//! `UniformInt` implementation
//
// Port of rand =0.10.1 `src/distr/uniform_int.rs` (module `rand::distr::uniform::int`), without the
// `unbiased` feature (off in Miri's rand) and `simd_support`.
//
// PORT: `uniform_int_impl!($ty, $uty, $sample_ty)` is `uniform_int_impl(ty, S)`: `ty` describes `$ty` (with its
// same-width `$uty`) and `S` describes `$sample_ty`. 8/16/32-bit types are `number` with `$sample_ty = u32`;
// 64/128-bit types are `bigint`. The casts the macro relies on are `ty.to_sample` (`x as $uty as $sample_ty`, a
// zero-extension) and `ty.from_sample` (`x as $uty as $ty` and `x as $ty`, a truncation to the type's width,
// reinterpreted as signed for signed types). usize is `number` (values below 2^53).
import { debug_struct, type Debug, type Fmt } from "../../../std/fmt.ts";
import { unported } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import type { Rng } from "../../rand_core/lib.ts";
import type { Distribution } from "./distribution.ts";
import {
  StandardUniform_i128,
  StandardUniform_i16,
  StandardUniform_i32,
  StandardUniform_i64,
  StandardUniform_i8,
  StandardUniform_u128,
  StandardUniform_u16,
  StandardUniform_u32,
  StandardUniform_u64,
  StandardUniform_u8,
} from "./integer.ts";
import { Error, type SampleUniform, type SampleUniformUnsigned, type UniformSampler, type UniformSamplerType } from "./uniform.ts";
import { wmul_u128, wmul_u32, wmul_u64, type WideningMultiply } from "./utils.ts";

/** `$ty` (and its `$uty`) of a `uniform_int_impl!` expansion. */
interface IntTy<T, S> {
  readonly name: string;
  readonly ONE: T;
  /** `rng.random::<$ty>()` */
  readonly random: Distribution<T>;
  wrapping_add(a: T, b: T): T;
  wrapping_sub(a: T, b: T): T;
  /** `high - 1` (only for `low < high`, so it cannot overflow) */
  sub_one(x: T): T;
  /** `x as $uty as $sample_ty` */
  to_sample(x: T): S;
  /** `x as $uty as $ty`, `x as $ty` (from `$sample_ty`) */
  from_sample(x: S): T;
}

/** `$sample_ty` of a `uniform_int_impl!` expansion. */
interface SampleTy<S> {
  readonly ZERO: S;
  /** `rng.random::<$sample_ty>()` */
  readonly random: Distribution<S>;
  readonly wmul: WideningMultiply<S>;
  wrapping_neg(x: S): S;
  rem(a: S, b: S): S;
  /** `a.checked_add(b).is_none()` */
  checked_add_is_none(a: S, b: S): boolean;
  /** `a += b as $sample_ty` for a `bool` `b` (release build: wrapping) */
  add_bool(a: S, b: boolean): S;
}

function num_ty(name: string, bits: 8 | 16 | 32, signed: boolean, random: Distribution<number>): IntTy<number, number> {
  const shift = 32 - bits;
  // truncate to `bits` and reinterpret
  const wrap = signed ? (x: number) => (x << shift) >> shift : bits === 32 ? (x: number) => x >>> 0 : (x: number) => x & ((1 << bits) - 1);
  const to_u = bits === 32 ? (x: number) => x >>> 0 : (x: number) => x & ((1 << bits) - 1);
  return {
    name,
    ONE: 1,
    random,
    wrapping_add: (a, b) => wrap(a + b),
    wrapping_sub: (a, b) => wrap(a - b),
    sub_one: (x) => x - 1,
    to_sample: to_u,
    from_sample: wrap,
  };
}

function big_ty(name: string, bits: 64 | 128, signed: boolean, random: Distribution<bigint>): IntTy<bigint, bigint> {
  const n = bits;
  const wrap = signed ? (x: bigint) => BigInt.asIntN(n, x) : (x: bigint) => BigInt.asUintN(n, x);
  return {
    name,
    ONE: 1n,
    random,
    wrapping_add: (a, b) => wrap(a + b),
    wrapping_sub: (a, b) => wrap(a - b),
    sub_one: (x) => x - 1n,
    to_sample: (x) => BigInt.asUintN(n, x),
    from_sample: wrap,
  };
}

const S_u32: SampleTy<number> = {
  ZERO: 0,
  random: StandardUniform_u32,
  wmul: wmul_u32,
  wrapping_neg: (x) => -x >>> 0,
  rem: (a, b) => a % b,
  checked_add_is_none: (a, b) => a + b > 0xffff_ffff,
  add_bool: (a, b) => (a + (b ? 1 : 0)) >>> 0,
};

function big_sample(bits: 64n | 128n, random: Distribution<bigint>, wmul: WideningMultiply<bigint>): SampleTy<bigint> {
  const max = (1n << bits) - 1n;
  return {
    ZERO: 0n,
    random,
    wmul,
    wrapping_neg: (x) => -x & max,
    rem: (a, b) => a % b,
    checked_add_is_none: (a, b) => a + b > max,
    add_bool: (a, b) => (a + (b ? 1n : 0n)) & max,
  };
}

const S_u64 = big_sample(64n, StandardUniform_u64, wmul_u64);
const S_u128 = big_sample(128n, StandardUniform_u128, wmul_u128);

/// The back-end implementing [`UniformSampler`] for integer types.
///
/// Unless you are implementing [`UniformSampler`] for your own type, this type
/// should not be used directly, use [`Uniform`] instead.
///
/// # Implementation notes
///
/// For simplicity, we use the same generic struct `UniformInt<X>` for all
/// integer types `X`. This gives us only one field type, `X`; to store unsigned
/// values of this size, we take use the fact that these conversions are no-ops.
///
/// For a closed range, the number of possible numbers we should generate is
/// `range = (high - low + 1)`. To avoid bias, we must ensure that the size of
/// our sample space, `zone`, is a multiple of `range`; other values must be
/// rejected (by replacing with a new random sample).
///
/// As a special case, we use `range = 0` to represent the full range of the
/// result type (i.e. for `new_inclusive($ty::MIN, $ty::MAX)`).
///
/// The optimum `zone` is the largest product of `range` which fits in our
/// (unsigned) target type. We calculate this by calculating how many numbers we
/// must reject: `reject = (MAX + 1) % range = (MAX - range + 1) % range`. Any (large)
/// product of `range` will suffice, thus in `sample_single` we multiply by a
/// power of 2 via bit-shifting (faster but may cause more rejections).
///
/// The smallest integer PRNGs generate is `u32`. For 8- and 16-bit outputs we
/// use `u32` for our `zone` and samples (because it's not slower and because
/// it reduces the chance of having to reject a sample). In this case we cannot
/// store `zone` in the target type since it is too large, however we know
/// `ints_to_reject < range <= $uty::MAX`.
///
/// An alternative to using a modulus is widening multiply: After a widening
/// multiply by `range`, the result is in the high word. Then comparing the low
/// word against `zone` makes sure our distribution is uniform.
///
/// # Bias
///
/// Unless the `unbiased` feature flag is used, outputs may have a small bias.
/// In the worst case, bias affects 1 in `2^n` samples where n is
/// 56 (`i8` and `u8`), 48 (`i16` and `u16`), 96 (`i32` and `u32`), 64 (`i64`
/// and `u64`), 128 (`i128` and `u128`).
export class UniformInt<X> implements UniformSampler<X> {
  constructor(
    public low: X,
    public range: X,
    public thresh: X, // effectively 2.pow(max(64, uty_bits)) % range
    /** PORT: the `uniform_int_impl!` expansion for `X`. */
    readonly Impl: UniformIntImpl<X>,
  ) {}

  sample(rng: Rng): X {
    return this.Impl.sample(this, rng);
  }
}

/** `#[derive(Debug)]` */
export const debug_UniformInt: Debug<UniformInt<number | bigint>> = (v: UniformInt<number | bigint>, f: Fmt) =>
  debug_struct(f, "UniformInt", [
    ["low", String(v.low)],
    ["range", String(v.range)],
    ["thresh", String(v.thresh)],
  ]);

/** `#[derive(PartialEq)]` */
export function UniformInt_eq<X>(a: UniformInt<X>, b: UniformInt<X>): boolean {
  return a.low === b.low && a.range === b.range && a.thresh === b.thresh;
}

/** `impl UniformSampler for UniformInt<$ty>`: the associated functions plus the instance `sample`. */
export interface UniformIntImpl<X> extends UniformSamplerType<X, UniformInt<X>> {
  sample(self: UniformInt<X>, rng: Rng): X;
}

// macro_rules! uniform_int_impl
function uniform_int_impl<T extends number | bigint, S extends number | bigint>(ty: IntTy<T, S>, St: SampleTy<S>): UniformIntImpl<T> {
  // impl SampleUniform for $ty { type Sampler = UniformInt<$ty>; }
  // impl UniformSampler for UniformInt<$ty>
  const Impl: UniformIntImpl<T> = {
    // We play free and fast with unsigned vs signed here
    // (when $ty is signed), but that's fine, since the
    // contract of this macro is for $ty and $uty to be
    // "bit-equal", so casting between them is a no-op.

    // if the range is constant, this helps LLVM to do the
    // calculations at compile-time.
    // crate: rand-0.10.1/src/distr/uniform_int.rs:91 new
    new(low: T, high: T): Result<UniformInt<T>, Error> {
      if (!(low < high)) {
        return Err(Error.EmptyRange);
      }
      return Impl.new_inclusive(low, ty.sub_one(high));
    },

    // if the range is constant, this helps LLVM to do the
    // calculations at compile-time.
    // crate: rand-0.10.1/src/distr/uniform_int.rs:106 new_inclusive
    new_inclusive(low: T, high: T): Result<UniformInt<T>, Error> {
      if (!(low <= high)) {
        return Err(Error.EmptyRange);
      }

      // `as $uty`, held zero-extended in `$sample_ty`
      const range = ty.to_sample(ty.wrapping_add(ty.wrapping_sub(high, low), ty.ONE));
      let thresh: S;
      if (range > St.ZERO) {
        thresh = St.rem(St.wrapping_neg(range), range);
      } else {
        thresh = St.ZERO;
      }

      return Ok(
        new UniformInt(
          low,
          ty.from_sample(range), // type: $uty
          ty.from_sample(thresh), // type: $sample_ty
          Impl,
        ),
      );
    },

    /// Sample from distribution, Lemire's method, unbiased
    // crate: rand-0.10.1/src/distr/uniform_int.rs:134 sample
    sample(self: UniformInt<T>, rng: Rng): T {
      const range = ty.to_sample(self.range);
      if (range === St.ZERO) {
        return ty.random.sample(rng);
      }

      const thresh = ty.to_sample(self.thresh);
      let hi: S;
      for (;;) {
        const [hi_, lo] = St.wmul.wmul(St.random.sample(rng), range);
        if (lo >= thresh) {
          hi = hi_;
          break;
        }
      }
      return ty.wrapping_add(self.low, ty.from_sample(hi));
    },

    // crate: rand-0.10.1/src/distr/uniform_int.rs:151 sample_single
    sample_single(low: T, high: T, rng: Rng): Result<T, Error> {
      if (!(low < high)) {
        return Err(Error.EmptyRange);
      }
      return Impl.sample_single_inclusive(low, ty.sub_one(high), rng);
    },

    /// Sample single value, Canon's method, biased
    ///
    /// In the worst case, bias affects 1 in `2^n` samples where n is
    /// 56 (`i8`), 48 (`i16`), 96 (`i32`), 64 (`i64`), 128 (`i128`).
    // crate: rand-0.10.1/src/distr/uniform_int.rs:174 sample_single_inclusive
    sample_single_inclusive(low: T, high: T, rng: Rng): Result<T, Error> {
      if (!(low <= high)) {
        return Err(Error.EmptyRange);
      }
      const range = ty.to_sample(ty.wrapping_add(ty.wrapping_sub(high, low), ty.ONE));
      if (range === St.ZERO) {
        // Range is MAX+1 (unrepresentable), so we need a special case
        return Ok(ty.random.sample(rng));
      }

      // generate a sample using a sensible integer type
      let [result, lo_order] = St.wmul.wmul(St.random.sample(rng), range);

      // if the sample is biased...
      if (lo_order > St.wrapping_neg(range)) {
        // ...generate a new sample to reduce bias...
        const [new_hi_order] = St.wmul.wmul(St.random.sample(rng), range);
        // ... incrementing result on overflow
        const is_overflow = St.checked_add_is_none(lo_order, new_hi_order);
        result = St.add_bool(result, is_overflow);
      }

      return Ok(ty.wrapping_add(low, ty.from_sample(result)));
    },

    // crate-skip: rand-0.10.1/src/distr/uniform_int.rs:212 sample_single_inclusive cfg(feature = "unbiased"): off in Miri's rand (default features)
  };
  return Impl;
}

export const UniformInt_i8 = uniform_int_impl(num_ty("i8", 8, true, StandardUniform_i8), S_u32);
export const UniformInt_i16 = uniform_int_impl(num_ty("i16", 16, true, StandardUniform_i16), S_u32);
export const UniformInt_i32 = uniform_int_impl(num_ty("i32", 32, true, StandardUniform_i32), S_u32);
export const UniformInt_i64 = uniform_int_impl(big_ty("i64", 64, true, StandardUniform_i64), S_u64);
export const UniformInt_i128 = uniform_int_impl(big_ty("i128", 128, true, StandardUniform_i128), S_u128);
export const UniformInt_u8 = uniform_int_impl(num_ty("u8", 8, false, StandardUniform_u8), S_u32);
export const UniformInt_u16 = uniform_int_impl(num_ty("u16", 16, false, StandardUniform_u16), S_u32);
export const UniformInt_u32 = uniform_int_impl(num_ty("u32", 32, false, StandardUniform_u32), S_u32);
export const UniformInt_u64 = uniform_int_impl(big_ty("u64", 64, false, StandardUniform_u64), S_u64);
export const UniformInt_u128 = uniform_int_impl(big_ty("u128", 128, false, StandardUniform_u128), S_u128);

// impl SampleUniform for $ty { type Sampler = UniformInt<$ty>; }
export const SampleUniform_i8: SampleUniform<number> = { Sampler: UniformInt_i8 };
export const SampleUniform_i16: SampleUniform<number> = { Sampler: UniformInt_i16 };
export const SampleUniform_i32: SampleUniform<number> = { Sampler: UniformInt_i32 };
export const SampleUniform_i64: SampleUniform<bigint> = { Sampler: UniformInt_i64 };
export const SampleUniform_i128: SampleUniform<bigint> = { Sampler: UniformInt_i128 };
export const SampleUniform_u8: SampleUniformUnsigned<number> = { Sampler: UniformInt_u8, ZERO: 0 };
export const SampleUniform_u16: SampleUniformUnsigned<number> = { Sampler: UniformInt_u16, ZERO: 0 };
export const SampleUniform_u32: SampleUniformUnsigned<number> = { Sampler: UniformInt_u32, ZERO: 0 };
export const SampleUniform_u64: SampleUniformUnsigned<bigint> = { Sampler: UniformInt_u64, ZERO: 0n };
export const SampleUniform_u128: SampleUniformUnsigned<bigint> = { Sampler: UniformInt_u128, ZERO: 0n };

// crate-skip: rand-0.10.1/src/distr/uniform_int.rs:302 new cfg(feature = "simd_support"): off in Miri's rand (default features)
// crate-skip: rand-0.10.1/src/distr/uniform_int.rs:316 new_inclusive cfg(feature = "simd_support"): off in Miri's rand (default features)
// crate-skip: rand-0.10.1/src/distr/uniform_int.rs:343 sample cfg(feature = "simd_support"): off in Miri's rand (default features)

const U32_MAX = 0xffff_ffff;

/// The back-end implementing [`UniformSampler`] for `usize`.
///
/// # Implementation notes
///
/// Sampling a `usize` value is usually used in relation to the length of an
/// array or other memory structure, thus it is reasonable to assume that the
/// vast majority of use-cases will have a maximum size under [`u32::MAX`].
/// In part to optimise for this use-case, but mostly to ensure that results
/// are portable across 32-bit and 64-bit architectures (as far as is possible),
/// this implementation will use 32-bit sampling when possible.
// PORT: `target_pointer_width = "64"` (the oracle host and Miri's target), so `mode64` exists. usize is `number`:
// bounds must stay below 2^53, where the u64 arithmetic below is exact.
export class UniformUsize implements UniformSampler<number> {
  constructor(
    /// The lowest possible value.
    public low: number,
    /// The number of possible values. `0` has a special meaning: all.
    public range: number,
    /// Threshold used when sampling to obtain a uniform distribution.
    public thresh: number,
    /// Whether the largest possible value is greater than `u32::MAX`.
    // Handle missing field when deserializing on 64-bit an object serialized
    // on 32-bit. Can be removed when switching to a custom deserializer.
    public mode64: boolean,
  ) {}

  // impl UniformSampler for UniformUsize

  // if the range is constant, this helps LLVM to do the
  // calculations at compile-time.
  // crate: rand-0.10.1/src/distr/uniform_int.rs:437 new
  static new(low: number, high: number): Result<UniformUsize, Error> {
    if (!(low < high)) {
      return Err(Error.EmptyRange);
    }

    return UniformUsize.new_inclusive(low, high - 1);
  }

  // if the range is constant, this helps LLVM to do the
  // calculations at compile-time.
  // crate: rand-0.10.1/src/distr/uniform_int.rs:453 new_inclusive
  static new_inclusive(low: number, high: number): Result<UniformUsize, Error> {
    if (!(low <= high)) {
      return Err(Error.EmptyRange);
    }

    // #[cfg(target_pointer_width = "64")]
    const mode64 = high > U32_MAX;

    let range, thresh;
    if (/* cfg!(target_pointer_width = "64") && */ !mode64) {
      const range32 = ((high >>> 0) - (low >>> 0) + 1) >>> 0;
      range = range32;
      thresh = range32 > 0 ? (-range32 >>> 0) % range32 : 0;
    } else {
      check_usize(high);
      // `high.wrapping_sub(low).wrapping_add(1)` and `range.wrapping_neg() % range` on 64-bit usize
      const range64 = BigInt.asUintN(64, BigInt(high) - BigInt(low) + 1n);
      range = Number(range64);
      thresh = range64 > 0n ? Number(BigInt.asUintN(64, -range64) % range64) : 0;
    }

    return Ok(new UniformUsize(low, range, thresh, mode64));
  }

  // crate: rand-0.10.1/src/distr/uniform_int.rs:497 sample
  sample(rng: Rng): number {
    // #[cfg(target_pointer_width = "64")]
    const mode32 = !this.mode64;

    if (mode32) {
      const range = this.range >>> 0;
      if (range === 0) {
        return StandardUniform_u32.sample(rng);
      }

      const thresh = this.thresh >>> 0;
      let hi;
      for (;;) {
        const [hi_, lo] = wmul_u32.wmul(StandardUniform_u32.sample(rng), range);
        if (lo >= thresh) {
          hi = hi_;
          break;
        }
      }
      return this.low + hi;
    } else {
      const range = BigInt(this.range);
      if (range === 0n) {
        unported("rand UniformUsize::sample: full 64-bit range (usize as number)");
      }

      const thresh = BigInt(this.thresh);
      let hi;
      for (;;) {
        const [hi_, lo] = wmul_u64.wmul(StandardUniform_u64.sample(rng), range);
        if (lo >= thresh) {
          hi = hi_;
          break;
        }
      }
      return this.low + Number(hi);
    }
  }

  // crate: rand-0.10.1/src/distr/uniform_int.rs:535 sample_single
  static sample_single(low: number, high: number, rng: Rng): Result<number, Error> {
    if (!(low < high)) {
      return Err(Error.EmptyRange);
    }

    if (/* cfg!(target_pointer_width = "64") && */ high > U32_MAX) {
      check_usize(high);
      const r = UniformInt_u64.sample_single(BigInt(low), BigInt(high), rng);
      return r.$ === "Ok" ? Ok(Number(r._0)) : r;
    }

    return UniformInt_u32.sample_single(low, high, rng);
  }

  // crate: rand-0.10.1/src/distr/uniform_int.rs:559 sample_single_inclusive
  static sample_single_inclusive(low: number, high: number, rng: Rng): Result<number, Error> {
    if (!(low <= high)) {
      return Err(Error.EmptyRange);
    }

    if (/* cfg!(target_pointer_width = "64") && */ high > U32_MAX) {
      check_usize(high);
      const r = UniformInt_u64.sample_single_inclusive(BigInt(low), BigInt(high), rng);
      return r.$ === "Ok" ? Ok(Number(r._0)) : r;
    }

    return UniformInt_u32.sample_single_inclusive(low, high, rng);
  }
}

/** `#[derive(Debug)]` */
export const debug_UniformUsize: Debug<UniformUsize> = (v, f) =>
  debug_struct(f, "UniformUsize", [
    ["low", String(v.low)],
    ["range", String(v.range)],
    ["thresh", String(v.thresh)],
    ["mode64", String(v.mode64)],
  ]);

/** `#[derive(PartialEq)]` */
export function UniformUsize_eq(a: UniformUsize, b: UniformUsize): boolean {
  return a.low === b.low && a.range === b.range && a.thresh === b.thresh && a.mode64 === b.mode64;
}

// impl SampleUniform for usize { type Sampler = UniformUsize; }
export const SampleUniform_usize: SampleUniformUnsigned<number> = { Sampler: UniformUsize, ZERO: 0 };

/** PORT: usize is `number`; a bound at or above 2^53 has no exact `number`. */
function check_usize(x: number): void {
  if (!Number.isSafeInteger(x)) unported("rand UniformUsize: a usize bound above 2^53 (usize as number)");
}
