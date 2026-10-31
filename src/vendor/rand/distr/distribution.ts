//! Distribution trait and associates
//
// Port of rand =0.10.1 `src/distr/distribution.rs` (the `alloc`-only `SampleString` is not ported: Miri never
// samples strings through it).
// PORT: `Distribution<T>` is an interface over `sample`; the provided methods live in `Distribution_provided`.
// `R: Rng` is `rand_core::Rng`, by reference (an owned `R` in `Iter` is the same object).
import { unported } from "../../../std/panic.ts";
import type { Rng } from "../../rand_core/lib.ts";
import type { RustIterator } from "../seq/iterator.ts";

/// Types (distributions) that can be used to create a random instance of `T`.
///
/// It is possible to sample from a distribution through both the
/// `Distribution` and [`RngExt`] traits, via `distr.sample(&mut rng)` and
/// `rng.sample(distr)`. They also both offer the [`sample_iter`] method, which
/// produces an iterator that samples from the distribution.
///
/// All implementations are expected to be immutable; this has the significant
/// advantage of not needing to consider thread safety, and for most
/// distributions efficient state-less sampling algorithms are available.
export interface Distribution<T> {
  /// Generate a random value of `T`, using `rng` as the source of randomness.
  // crate: rand-0.10.1/src/distr/distribution.rs:40 sample
  sample(rng: Rng): T;

  // sample_iter (provided)
  // map (provided)
}

export const Distribution_provided = {
  /// Create an iterator that generates random values of `T`, using `rng` as
  /// the source of randomness.
  ///
  /// Note that this function takes `self` by value. This works since
  /// `Distribution<T>` is impl'd for `&D` where `D: Distribution<T>`,
  /// however borrowing is not automatic hence `distr.sample_iter(...)` may
  /// need to be replaced with `(&distr).sample_iter(...)` to borrow or
  /// `(&*distr).sample_iter(...)` to reborrow an existing reference.
  // crate: rand-0.10.1/src/distr/distribution.rs:75 sample_iter
  sample_iter<T>(self: Distribution<T>, rng: Rng): Iter<T> {
    return new Iter(self, rng);
  },

  /// Map sampled values to type `S`
  // crate: rand-0.10.1/src/distr/distribution.rs:100 map
  map<T, S>(self: Distribution<T>, func: (t: T) => S): Map<T, S> {
    return new Map(self, func);
  },
};

// impl<T, D: Distribution<T> + ?Sized> Distribution<T> for &D
// PORT: `&D` is `D`; this is the forwarding body.
export const Distribution_for_ref = {
  // crate: rand-0.10.1/src/distr/distribution.rs:114 sample
  sample<T>(self: Distribution<T>, rng: Rng): T {
    return self.sample(rng);
  },
};

/// An iterator over a [`Distribution`]
///
/// This iterator yields random values of type `T` with distribution `D`
/// from a random generator of type `R`.
///
/// Construct this `struct` using [`Distribution::sample_iter`] or
/// [`RngExt::sample_iter`]. It is also used by [`RngExt::random_iter`] and
/// [`crate::random_iter`].
export class Iter<T> implements RustIterator<T> {
  constructor(
    public distr: Distribution<T>,
    public rng: Rng,
  ) {}

  // impl<D, R, T> Iterator for Iter<D, R, T>
  // crate: rand-0.10.1/src/distr/distribution.rs:142 next
  next(): T | undefined {
    // Here, self.rng may be a reference, but we must take &mut anyway.
    // Even if sample could take an R: Rng by value, we would need to do this
    // since Rng is not copyable and we cannot enforce that this is "reborrowable".
    return this.distr.sample(this.rng);
  }

  // crate: rand-0.10.1/src/distr/distribution.rs:149 size_hint
  size_hint(): [number, number | undefined] {
    // PORT: `(usize::MAX, None)`: usize is `number`, which has no exact usize::MAX.
    unported("rand distr::Iter::size_hint (usize::MAX as number)");
  }
}

/// A distribution of values of type `S` derived from the distribution `D`
/// by mapping its output of type `T` through the closure `F`.
export class Map<T, S> implements Distribution<S> {
  constructor(
    public distr: Distribution<T>,
    public func: (t: T) => S,
  ) {}

  // impl<D, F, T, S> Distribution<S> for Map<D, F, T, S>
  // crate: rand-0.10.1/src/distr/distribution.rs:177 sample
  sample(rng: Rng): S {
    return this.func(this.distr.sample(rng));
  }
}
