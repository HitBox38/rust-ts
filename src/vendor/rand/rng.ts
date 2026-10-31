//! [`RngExt`] trait
//
// Port of rand =0.10.1 `src/rng.rs`.
// PORT: `RngExt` (blanket-implemented for every `R: Rng`) is the `RngExt` table of its provided methods, each
// taking the generator first: `rng.random::<bool>()` is `RngExt.random(rng, StandardUniform_bool)` (the second
// argument is the `StandardUniform: Distribution<T>` impl), `rng.random_range(a..b)` is
// `RngExt.random_range(rng, new Range(SampleUniform_<T>, a, b))`.
// `Fill` is a table per element type; `[T]` is `T[]` (`Uint8Array` for `u8`), and `Wrapping<T>` is `T`.
import { debug_f64, PLAIN } from "../../std/fmt.ts";
import { assert, panic } from "../../std/panic.ts";
import { unwrap_result } from "../../std/result.ts";
import type { Rng } from "../rand_core/lib.ts";
import { Bernoulli } from "./distr/bernoulli.ts";
import { Distribution_provided, type Distribution, type Iter } from "./distr/distribution.ts";
import { debug_Error, type SampleRange } from "./distr/uniform.ts";

/// User-level interface for RNGs
///
/// [`Rng`] is the `dyn`-safe implementation-level interface for Random
/// (Number) Generators. This trait, `RngExt`, provides a user-level interface
/// on RNGs. It is implemented automatically for any <code>R: [Rng][]</code>.
// impl<R: Rng + ?Sized> RngExt for R {}
export const RngExt = {
  /// Return a random value via the [`StandardUniform`] distribution.
  // crate: rand-0.10.1/src/rng.rs:93 random
  random<T>(self: Rng, StandardUniform: Distribution<T>): T {
    return StandardUniform.sample(self);
  },

  /// Return an iterator over [`random`](Self::random) variates
  ///
  /// This is a just a wrapper over [`RngExt::sample_iter`] using
  /// [`distr::StandardUniform`].
  // crate: rand-0.10.1/src/rng.rs:118 random_iter
  random_iter<T>(self: Rng, StandardUniform: Distribution<T>): Iter<T> {
    return Distribution_provided.sample_iter(StandardUniform, self);
  },

  /// Generate a random value in the given range.
  ///
  /// This function is optimised for the case that only a single sample is
  /// made from the given range. See also the [`Uniform`] distribution
  /// type which may be faster if sampling from the same range repeatedly.
  ///
  /// All types support `low..high_exclusive` and `low..=high` range syntax.
  /// Unsigned integer types also support `..high_exclusive` and `..=high` syntax.
  ///
  /// # Panics
  ///
  /// Panics if the range is empty, or if `high - low` overflows for floats.
  // crate: rand-0.10.1/src/rng.rs:159 random_range
  random_range<T>(self: Rng, range: SampleRange<T>): T {
    assert(!range.is_empty(), "cannot sample empty range");
    return unwrap_result(range.sample_single(self), debug_Error);
  },

  /// Return a bool with a probability `p` of being true.
  ///
  /// See also the [`Bernoulli`] distribution, which may be faster if
  /// sampling from the same probability repeatedly.
  ///
  /// # Panics
  ///
  /// If `p < 0` or `p > 1`.
  // crate: rand-0.10.1/src/rng.rs:189 random_bool
  random_bool(self: Rng, p: number): boolean {
    const d = Bernoulli.new(p);
    switch (d.$) {
      case "Ok":
        return RngExt.sample(self, d._0);
      case "Err":
        panic(`p=${debug_f64(p, PLAIN)} is outside range [0.0, 1.0]`);
    }
  },

  /// Return a bool with a probability of `numerator/denominator` of being
  /// true.
  ///
  /// That is, `random_ratio(2, 3)` has chance of 2 in 3, or about 67%, of
  /// returning true. If `numerator == denominator`, then the returned value
  /// is guaranteed to be `true`. If `numerator == 0`, then the returned
  /// value is guaranteed to be `false`.
  ///
  /// See also the [`Bernoulli`] distribution, which may be faster if
  /// sampling from the same `numerator` and `denominator` repeatedly.
  ///
  /// # Panics
  ///
  /// If `denominator == 0` or `numerator > denominator`.
  // crate: rand-0.10.1/src/rng.rs:223 random_ratio
  random_ratio(self: Rng, numerator: number, denominator: number): boolean {
    const d = Bernoulli.from_ratio(numerator, denominator);
    switch (d.$) {
      case "Ok":
        return RngExt.sample(self, d._0);
      case "Err":
        panic(`p=${numerator}/${denominator} is outside range [0.0, 1.0]`);
    }
  },

  /// Sample a new value, using the given distribution.
  // crate: rand-0.10.1/src/rng.rs:247 sample
  sample<T>(self: Rng, distr: Distribution<T>): T {
    return distr.sample(self);
  },

  /// Create an iterator that generates values using the given distribution.
  // crate: rand-0.10.1/src/rng.rs:284 sample_iter
  sample_iter<T>(self: Rng, distr: Distribution<T>): Iter<T> {
    return Distribution_provided.sample_iter(distr, self);
  },

  /// Fill any type implementing [`Fill`] with random data
  ///
  /// This method is implemented for types which may be safely reinterpreted as
  /// an (aligned) `[u8]` slice then filled with random data. It is a faster
  /// alternative to using [`RngExt::random`] repeatedly.
  // crate: rand-0.10.1/src/rng.rs:312 fill
  fill<S>(self: Rng, Fill: Fill<S>, dest: S): void {
    Fill.fill_slice(dest, self);
  },
};

/// Support filling a slice with random data
///
/// This trait allows slices of "plain data" types to be efficiently filled
/// with random data.
///
/// Implementations are expected to be portable across machines unless
/// clearly documented otherwise (see the
/// [Chapter on Portability](https://rust-random.github.io/book/portability.html)).
/// The implementations provided achieve this by byte-swapping on big-endian
/// machines.
export interface Fill<S> {
  /// Fill this with random data
  // crate: rand-0.10.1/src/rng.rs:331 fill_slice
  fill_slice(self: S, rng: Rng): void;
}

// impl Fill for u8
export const Fill_u8: Fill<Uint8Array> = {
  // crate: rand-0.10.1/src/rng.rs:335 fill_slice
  fill_slice(self: Uint8Array, rng: Rng): void {
    rng.fill_bytes(self);
  },
};

// crate: rand-0.10.1/src/rng.rs:341 __unsafe
// PORT: `const unsafe fn __unsafe() {}` only forces `impl_fill!` callers into an `unsafe` block.
function __unsafe(): void {}

// macro_rules! impl_fill: `(fill_slice! $t, $to_le)` (the `plain` and `wrapping` arms are the same here)
// PORT: `slice::from_raw_parts_mut(this as *mut u8, size)` is a byte buffer that is filled and then read back
// as little-endian `$t`s (`to_le` is the identity on the little-endian targets the oracle runs on).
function impl_fill<T>(size: number, read_le: (b: Uint8Array, at: number) => T): Fill<T[]> {
  __unsafe();
  return {
    // crate: rand-0.10.1/src/rng.rs:356 fill_slice
    fill_slice(self: T[], rng: Rng): void {
      if (self.length > 0) {
        const bytes = new Uint8Array(self.length * size);
        rng.fill_bytes(bytes);
        for (let i = 0; i < self.length; i++) {
          self[i] = read_le(bytes, i * size);
        }
      }
    },
  };
}

function read_uint(b: Uint8Array, at: number, n: number): bigint {
  let x = 0n;
  for (let i = n - 1; i >= 0; i--) x = (x << 8n) | BigInt(b[at + i]!);
  return x;
}

// SAFETY: All bit patterns of `[u8; size_of::<$t>()]` represent values of `u*`.
// const _: () = unsafe { impl_fill!(u16, u32, u64, u128,) };
export const Fill_u16 = impl_fill<number>(2, (b, at) => b[at]! | (b[at + 1]! << 8));
export const Fill_u32 = impl_fill<number>(4, (b, at) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0);
export const Fill_u64 = impl_fill<bigint>(8, (b, at) => read_uint(b, at, 8));
export const Fill_u128 = impl_fill<bigint>(16, (b, at) => read_uint(b, at, 16));
// SAFETY: All bit patterns of `[u8; size_of::<$t>()]` represent values of `i*`.
// const _: () = unsafe { impl_fill!(i8, i16, i32, i64, i128,) };
export const Fill_i8 = impl_fill<number>(1, (b, at) => (b[at]! << 24) >> 24);
export const Fill_i16 = impl_fill<number>(2, (b, at) => ((b[at]! | (b[at + 1]! << 8)) << 16) >> 16);
export const Fill_i32 = impl_fill<number>(4, (b, at) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24));
export const Fill_i64 = impl_fill<bigint>(8, (b, at) => BigInt.asIntN(64, read_uint(b, at, 8)));
export const Fill_i128 = impl_fill<bigint>(16, (b, at) => BigInt.asIntN(128, read_uint(b, at, 16)));
