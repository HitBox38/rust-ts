//! `IndexedRandom`, `IndexedMutRandom`, `SliceRandom`
//
// Port of rand =0.10.1 `src/seq/slice.rs`: `IndexedRandom::{len, is_empty, choose}` for `[T]` (Miri's NaN
// choice and `mkstemp` suffix) and `SliceRandom::{shuffle, partial_shuffle}` for `[T]` (rustc_abi's
// `-Zrandomize-layout`, whose rand 0.9.3 has the same two methods). The other sampling and weighted methods are not
// ported.
// PORT: `[T]` is `readonly T[]`; `Option<&T>` is `T | undefined`.
import type { Rng } from "../../rand_core/lib.ts";
import { RangeTo } from "../distr/uniform.ts";
import { SampleUniform_usize } from "../distr/uniform_int.ts";
import { RngExt } from "../rng.ts";
import { IncreasingUniform } from "./increasing_uniform.ts";

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

/// Extension trait on slices, providing shuffling methods.
///
/// This trait is implemented on all `[T]` slice types, providing several
/// methods for choosing and shuffling elements. You must `use` this trait:
// impl<T> SliceRandom for [T]
// PORT: a table of the methods; `[T]` is `T[]`, shuffled in place.
export const SliceRandom = {
  // crate: rand-0.10.1/src/seq/slice.rs:459 shuffle
  shuffle<T>(self: T[], rng: Rng): void {
    if (self.length <= 1) {
      // There is no need to shuffle an empty or single element slice
      return;
    }
    SliceRandom.partial_shuffle(self, rng, self.length);
  },

  /// PORT: the two returned slices are copies, not views of `self` (`shuffle` ignores them).
  // crate: rand-0.10.1/src/seq/slice.rs:470 partial_shuffle
  partial_shuffle<T>(self: T[], rng: Rng, amount: number): [T[], T[]] {
    const m = Math.max(0, self.length - amount);

    const swap = (a: number, b: number): void => {
      const t = self[a]!;
      self[a] = self[b]!;
      self[b] = t;
    };

    // The algorithm below is based on Durstenfeld's algorithm for the
    // [Fisher–Yates shuffle](https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle#The_modern_algorithm)
    // for an unbiased permutation.
    // It ensures that the last `amount` elements of the slice
    // are randomly selected from the whole slice.

    // `IncreasingUniform::next_index()` is faster than `Rng::random_range`
    // but only works for 32 bit integers
    // So we must use the slow method if the slice is longer than that.
    if (self.length < 0xffff_ffff) {
      const chooser = IncreasingUniform.new(rng, m);
      for (let i = m; i < self.length; i++) {
        const index = chooser.next_index();
        swap(i, index);
      }
    } else {
      for (let i = m; i < self.length; i++) {
        const index = RngExt.random_range(rng, new RangeTo(SampleUniform_usize, i + 1));
        swap(i, index);
      }
    }
    return [self.slice(m), self.slice(0, m)];
  },
};
