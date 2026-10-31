//! `IndexedRandom`, `IndexedMutRandom`, `SliceRandom`
//
// Port of rand =0.10.1 `src/seq/slice.rs`: `IndexedRandom::{len, is_empty, choose}` for `[T]` (Miri's NaN
// choice and `mkstemp` suffix). The other sampling, weighted and shuffling methods are not ported (Miri does not
// call them).
// PORT: `[T]` is `readonly T[]`; `Option<&T>` is `T | undefined`.
import type { Rng } from "../../rand_core/lib.ts";
import { RangeTo } from "../distr/uniform.ts";
import { SampleUniform_usize } from "../distr/uniform_int.ts";
import { RngExt } from "../rng.ts";

/// Extension trait on indexable lists, providing random sampling methods.
///
/// This trait is implemented on `[T]` slice types. Other types supporting
/// [`std::ops::Index<usize>`] may implement this (only [`Self::len`] must be
/// specified).
export interface IndexedRandom<T> {
  /// The length
  // crate: rand-0.10.1/src/seq/slice.rs:27 len
  len(): number;
  at(i: number): T;

  // is_empty (provided)
  // choose (provided)
}

export const IndexedRandom_provided = {
  /// True when the length is zero
  // crate: rand-0.10.1/src/seq/slice.rs:31 is_empty
  is_empty<T>(self: IndexedRandom<T>): boolean {
    return self.len() === 0;
  },

  /// Uniformly sample one element
  ///
  /// Returns a reference to one uniformly-sampled random element of
  /// the slice, or `None` if the slice is empty.
  ///
  /// For slices, complexity is `O(1)`.
  // crate: rand-0.10.1/src/seq/slice.rs:52 choose
  choose<T>(self: IndexedRandom<T>, rng: Rng): T | undefined {
    if (IndexedRandom_provided.is_empty(self)) {
      return undefined;
    } else {
      return self.at(RngExt.random_range(rng, new RangeTo(SampleUniform_usize, self.len())));
    }
  },
};

/** `impl<T> IndexedRandom for [T]` */
export class IndexedRandom_slice<T> implements IndexedRandom<T> {
  constructor(readonly slice: readonly T[]) {}

  // crate: rand-0.10.1/src/seq/slice.rs:451 len
  len(): number {
    return this.slice.length;
  }

  at(i: number): T {
    return this.slice[i]!;
  }
}

/** `<[T]>::choose(rng)` */
export function choose<T>(slice: readonly T[], rng: Rng): T | undefined {
  return IndexedRandom_provided.choose(new IndexedRandom_slice(slice), rng);
}
