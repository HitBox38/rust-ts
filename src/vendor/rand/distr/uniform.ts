//! A distribution uniformly sampling numbers within a given range.
//!
//! [`Uniform`] is the standard distribution to sample uniformly from a range;
//! e.g. `Uniform::new_inclusive(1, 6).unwrap()` can sample integers from 1 to 6, like a
//! standard die. [`RngExt::random_range`] is implemented over [`Uniform`].
//
// Port of rand =0.10.1 `src/distr/uniform.rs`. The integer back-ends are in `uniform_int.ts` (`uniform_int.rs`,
// `#[path]` module `int`); `uniform_float.rs` and `uniform_other.rs` (floats, `char`, `Duration`) are not ported:
// Miri samples only integer ranges.
//
// PORT: `T: SampleUniform` is a table `SampleUniform<T>` holding `T::Sampler`'s associated functions
// (`UniformSamplerType`); sampler values implement `UniformSampler<X>` (`sample`). The provided
// `sample_single`/`sample_single_inclusive` are in `UniformSampler_provided`. `SampleBorrow` is the identity
// (`&X` and `X` are the same value). Integers are `number` (up to 32 bits, usize) or `bigint` (64/128 bits),
// so `PartialOrd` is the native `<`/`<=`. `core::ops::{Range, RangeInclusive, RangeTo, RangeToInclusive}` with
// their `SampleRange` impls are the classes below; they carry the element type's `SampleUniform` table.
// `pub use int::{UniformInt, UniformUsize}` is not repeated: uniform_int.ts imports this module, so import
// the integer back-ends (and the `SampleUniform_<int>` tables) from there.
import { debug_tuple, type Debug, type Fmt } from "../../../std/fmt.ts";
import { Ok, type Result } from "../../../std/result.ts";
import type { Rng } from "../../rand_core/lib.ts";
import type { Distribution } from "./distribution.ts";

export type Int = number | bigint;

/// Error type returned from [`Uniform::new`] and `new_inclusive`.
export type Error = "EmptyRange" | "NonFinite";
export const Error = {
  /// `low > high`, or equal in case of exclusive range.
  EmptyRange: "EmptyRange",
  /// Input or range `high - low` is non-finite. Not relevant to integer types.
  NonFinite: "NonFinite",
} as const;

export const debug_Error: Debug<Error> = (v) => v;

// impl fmt::Display for Error
// crate: rand-0.10.1/src/distr/uniform.rs:131 fmt
export function display_Error(v: Error): string {
  switch (v) {
    case "EmptyRange":
      return "low > high (or equal if exclusive) in uniform distribution";
    case "NonFinite":
      return "Non-finite range in uniform distribution";
  }
}

/// Sample values uniformly between two bounds.
///
/// # Construction
///
/// [`Uniform::new`] and [`Uniform::new_inclusive`] construct a uniform
/// distribution sampling from the given `low` and `high` limits. `Uniform` may
/// also be constructed via [`TryFrom`] as in `Uniform::try_from(1..=6).unwrap()`.
///
/// Constructors may do extra work up front to allow faster sampling of multiple
/// values. Where only a single sample is required it is suggested to use
/// [`Rng::random_range`] or one of the `sample_single` methods instead.
export class Uniform<X> implements Distribution<X> {
  constructor(public _0: UniformSampler<X>) {}

  /// Create a new `Uniform` instance, which samples uniformly from the half
  /// open range `[low, high)` (excluding `high`).
  ///
  /// For discrete types (e.g. integers), samples will always be strictly less
  /// than `high`. For (approximations of) continuous types (e.g. `f32`, `f64`),
  /// samples may equal `high` due to loss of precision but may not be
  /// greater than `high`.
  ///
  /// Fails if `low >= high`, or if `low`, `high` or the range `high - low` is
  /// non-finite. In release mode, only the range is checked.
  // crate: rand-0.10.1/src/distr/uniform.rs:235 new
  static new<X>(X: SampleUniform<X>, low: X, high: X): Result<Uniform<X>, Error> {
    const r = X.Sampler.new(low, high);
    return r.$ === "Ok" ? Ok(new Uniform(r._0)) : r;
  }

  /// Create a new `Uniform` instance, which samples uniformly from the closed
  /// range `[low, high]` (inclusive).
  ///
  /// Fails if `low > high`, or if `low`, `high` or the range `high - low` is
  /// non-finite. In release mode, only the range is checked.
  // crate: rand-0.10.1/src/distr/uniform.rs:248 new_inclusive
  static new_inclusive<X>(X: SampleUniform<X>, low: X, high: X): Result<Uniform<X>, Error> {
    const r = X.Sampler.new_inclusive(low, high);
    return r.$ === "Ok" ? Ok(new Uniform(r._0)) : r;
  }

  // impl<X: SampleUniform> Distribution<X> for Uniform<X>
  // crate: rand-0.10.1/src/distr/uniform.rs:258 sample
  sample(rng: Rng): X {
    return this._0.sample(rng);
  }

  // impl<X: SampleUniform> TryFrom<Range<X>> for Uniform<X>
  // crate: rand-0.10.1/src/distr/uniform.rs:377 try_from
  static try_from_Range<X extends Int>(r: Range<X>): Result<Uniform<X>, Error> {
    return Uniform.new(r.X, r.start, r.end);
  }

  // impl<X: SampleUniform> TryFrom<RangeInclusive<X>> for Uniform<X>
  // crate: rand-0.10.1/src/distr/uniform.rs:385 try_from
  static try_from_RangeInclusive<X extends Int>(r: RangeInclusive<X>): Result<Uniform<X>, Error> {
    return Uniform.new_inclusive(r.X, r.start(), r.end());
  }
}

/** `#[derive(Debug)]`: `Uniform(<sampler>)`. */
export function debug_Uniform<X>(debug_sampler: Debug<UniformSampler<X>>): Debug<Uniform<X>> {
  return (v: Uniform<X>, f: Fmt) => debug_tuple(f, "Uniform", [debug_sampler(v._0, f)]);
}

/// Helper trait for creating objects using the correct implementation of
/// [`UniformSampler`] for the sampling type.
export interface SampleUniform<X> {
  /// The `UniformSampler` implementation supporting type `X`.
  readonly Sampler: UniformSamplerType<X>;
}

/** `SampleUniform` of an unsigned integer type (`impl_sample_range_u!` needs its `0`). */
export interface SampleUniformUnsigned<X> extends SampleUniform<X> {
  readonly ZERO: X;
}

/// Helper trait handling actual uniform sampling.
///
/// Implementation of [`sample_single`] is optional, and is only useful when
/// the implementation can be faster than `Self::new(low, high).sample(rng)`.
// PORT: the trait's instance method; its associated functions are `UniformSamplerType`.
export interface UniformSampler<X> {
  /// Sample a value.
  // crate: rand-0.10.1/src/distr/uniform.rs:313 sample
  sample(rng: Rng): X;
}

/** The associated functions of a `UniformSampler` implementation (`Self` is `S`). */
export interface UniformSamplerType<X, S extends UniformSampler<X> = UniformSampler<X>> {
  /// Construct self, with inclusive lower bound and exclusive upper bound `[low, high)`.
  ///
  /// For discrete types (e.g. integers), samples will always be strictly less
  /// than `high`. For (approximations of) continuous types (e.g. `f32`, `f64`),
  /// samples may equal `high` due to loss of precision but may not be
  /// greater than `high`.
  ///
  /// Usually users should not call this directly but prefer to use
  /// [`Uniform::new`].
  // crate: rand-0.10.1/src/distr/uniform.rs:298 new
  "new"(low: X, high: X): Result<S, Error>;

  /// Construct self, with inclusive bounds `[low, high]`.
  ///
  /// Usually users should not call this directly but prefer to use
  /// [`Uniform::new_inclusive`].
  // crate: rand-0.10.1/src/distr/uniform.rs:307 new_inclusive
  new_inclusive(low: X, high: X): Result<S, Error>;

  /// Sample a single value uniformly from a range with inclusive lower bound
  /// and exclusive upper bound `[low, high)`.
  sample_single(low: X, high: X, rng: Rng): Result<X, Error>;

  /// Sample a single value uniformly from a range with inclusive lower bound
  /// and inclusive upper bound `[low, high]`.
  sample_single_inclusive(low: X, high: X, rng: Rng): Result<X, Error>;
}

export const UniformSampler_provided = {
  /// Sample a single value uniformly from a range with inclusive lower bound
  /// and exclusive upper bound `[low, high)`.
  ///
  /// For discrete types (e.g. integers), samples will always be strictly less
  /// than `high`. For (approximations of) continuous types (e.g. `f32`, `f64`),
  /// samples may equal `high` due to loss of precision but may not be
  /// greater than `high`.
  ///
  /// By default this is implemented using
  /// `UniformSampler::new(low, high).sample(rng)`. However, for some types
  /// more optimal implementations for single usage may be provided via this
  /// method (which is the case for integers and floats).
  /// Results may not be identical.
  // crate: rand-0.10.1/src/distr/uniform.rs:339 sample_single
  sample_single<X, S extends UniformSampler<X>>(Self: UniformSamplerType<X, S>, low: X, high: X, rng: Rng): Result<X, Error> {
    const uniform = Self.new(low, high);
    if (uniform.$ === "Err") return uniform;
    return Ok(uniform._0.sample(rng));
  },

  /// Sample a single value uniformly from a range with inclusive lower bound
  /// and inclusive upper bound `[low, high]`.
  ///
  /// By default this is implemented using
  /// `UniformSampler::new_inclusive(low, high).sample(rng)`. However, for
  /// some types more optimal implementations for single usage may be provided
  /// via this method.
  /// Results may not be identical.
  // crate: rand-0.10.1/src/distr/uniform.rs:360 sample_single_inclusive
  sample_single_inclusive<X, S extends UniformSampler<X>>(Self: UniformSamplerType<X, S>, low: X, high: X, rng: Rng): Result<X, Error> {
    const uniform = Self.new_inclusive(low, high);
    if (uniform.$ === "Err") return uniform;
    return Ok(uniform._0.sample(rng));
  },
};

/// Helper trait similar to [`Borrow`] but implemented
/// only for [`SampleUniform`] and references to [`SampleUniform`]
/// in order to resolve ambiguity issues.
export interface SampleBorrow<Borrowed> {
  /// Immutably borrows from an owned value. See [`Borrow::borrow`]
  // crate: rand-0.10.1/src/distr/uniform.rs:399 borrow
  borrow(self: Borrowed): Borrowed;
}

// impl<Borrowed> SampleBorrow<Borrowed> for Borrowed where Borrowed: SampleUniform
export const SampleBorrow_for_Borrowed = {
  // crate: rand-0.10.1/src/distr/uniform.rs:406 borrow
  borrow<Borrowed>(self: Borrowed): Borrowed {
    return self;
  },
};

// impl<Borrowed> SampleBorrow<Borrowed> for &Borrowed where Borrowed: SampleUniform
export const SampleBorrow_for_ref = {
  // crate: rand-0.10.1/src/distr/uniform.rs:415 borrow
  borrow<Borrowed>(self: Borrowed): Borrowed {
    return self;
  },
};

/// Range that supports generating a single sample efficiently.
///
/// Any type implementing this trait can be used to specify the sampled range
/// for `Rng::random_range`.
export interface SampleRange<T> {
  /// Generate a sample from the given range.
  // crate: rand-0.10.1/src/distr/uniform.rs:426 sample_single
  sample_single(rng: Rng): Result<T, Error>;

  /// Check whether the range is empty.
  // crate: rand-0.10.1/src/distr/uniform.rs:429 is_empty
  is_empty(): boolean;
}

/** `core::ops::Range<T>` (`start..end`) with `impl<T: SampleUniform + PartialOrd> SampleRange<T>`. */
export class Range<T extends Int> implements SampleRange<T> {
  constructor(
    readonly X: SampleUniform<T>,
    public start: T,
    public end: T,
  ) {}

  // crate: rand-0.10.1/src/distr/uniform.rs:434 sample_single
  sample_single(rng: Rng): Result<T, Error> {
    return this.X.Sampler.sample_single(this.start, this.end, rng);
  }

  // crate: rand-0.10.1/src/distr/uniform.rs:439 is_empty
  is_empty(): boolean {
    return !(this.start < this.end);
  }
}

/** `core::ops::RangeInclusive<T>` (`start..=end`) with `impl<T: SampleUniform + PartialOrd> SampleRange<T>`. */
export class RangeInclusive<T extends Int> implements SampleRange<T> {
  constructor(
    readonly X: SampleUniform<T>,
    readonly _start: T,
    readonly _end: T,
  ) {}

  start(): T {
    return this._start;
  }
  end(): T {
    return this._end;
  }

  // crate: rand-0.10.1/src/distr/uniform.rs:446 sample_single
  sample_single(rng: Rng): Result<T, Error> {
    return this.X.Sampler.sample_single_inclusive(this.start(), this.end(), rng);
  }

  // crate: rand-0.10.1/src/distr/uniform.rs:451 is_empty
  is_empty(): boolean {
    return !(this.start() <= this.end());
  }
}

// macro_rules! impl_sample_range_u: `impl_sample_range_u!(u8); ... impl_sample_range_u!(usize);`
// PORT: the macro's types are the unsigned ones, i.e. the `SampleUniformUnsigned` tables.

/** `core::ops::RangeTo<T>` (`..end`) with the `impl_sample_range_u!` `SampleRange<$t>` impl. */
export class RangeTo<T extends Int> implements SampleRange<T> {
  constructor(
    readonly X: SampleUniformUnsigned<T>,
    public end: T,
  ) {}

  // crate: rand-0.10.1/src/distr/uniform.rs:460 sample_single
  sample_single(rng: Rng): Result<T, Error> {
    return this.X.Sampler.sample_single(this.X.ZERO, this.end, rng);
  }

  // crate: rand-0.10.1/src/distr/uniform.rs:465 is_empty
  is_empty(): boolean {
    return this.X.ZERO === this.end;
  }
}

/** `core::ops::RangeToInclusive<T>` (`..=end`) with the `impl_sample_range_u!` `SampleRange<$t>` impl. */
export class RangeToInclusive<T extends Int> implements SampleRange<T> {
  constructor(
    readonly X: SampleUniformUnsigned<T>,
    public end: T,
  ) {}

  // crate: rand-0.10.1/src/distr/uniform.rs:472 sample_single
  sample_single(rng: Rng): Result<T, Error> {
    return this.X.Sampler.sample_single_inclusive(this.X.ZERO, this.end, rng);
  }

  // crate: rand-0.10.1/src/distr/uniform.rs:477 is_empty
  is_empty(): boolean {
    return false;
  }
}
