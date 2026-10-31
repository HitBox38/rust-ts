//! `IteratorRandom`
//
// Port of rand =0.10.1 `src/seq/iterator.rs`: `IteratorRandom::choose` (Miri's scheduler, weak-memory store
// buffer and `IteratorRandom` uses). `choose_stable`, `sample_fill`, `sample` and the deprecated
// `choose_multiple*` are not ported (Miri does not call them).
//
// PORT: `Iterator` is `RustIterator<T>`: `next` (`None` is `undefined`), `size_hint` and an optional `nth` (the
// default `Iterator::nth` is `iter_nth`). The result of `choose` and the number of words it draws depend on
// `size_hint`, so callers must give core's exact hints for their adapters (e.g. `Filter` is `(0, upper)`).
import type { Rng } from "../../rand_core/lib.ts";
import { RangeTo } from "../distr/uniform.ts";
import { SampleUniform_usize } from "../distr/uniform_int.ts";
import { RngExt } from "../rng.ts";
import { CoinFlipper } from "./coin_flipper.ts";

/** `core::iter::Iterator`, as far as `IteratorRandom` uses it. */
export interface RustIterator<T> {
  next(): T | undefined;
  size_hint(): [number, number | undefined];
  /** Overrides of `Iterator::nth`; absent means the default (`advance_by(n)` then `next()`). */
  nth?(n: number): T | undefined;
}

/** `Iterator::nth`, dispatching to the iterator's override if it has one. */
export function iter_nth<T>(it: RustIterator<T>, n: number): T | undefined {
  if (it.nth !== undefined) return it.nth(n);
  for (let i = 0; i < n; i++) {
    if (it.next() === undefined) return undefined;
  }
  return it.next();
}

/// Extension trait on iterators, providing random sampling methods.
///
/// This trait is implemented on all iterators `I` where `I: Iterator + Sized`
/// and provides methods for
/// choosing one or more elements. You must `use` this trait:
// impl<I> IteratorRandom for I where I: Iterator + Sized {}
export const IteratorRandom = {
  /// Uniformly sample one element
  ///
  /// Assuming that the [`Iterator::size_hint`] is correct, this method
  /// returns one uniformly-sampled random element of the slice, or `None`
  /// only if the slice is empty. Incorrect bounds on the `size_hint` may
  /// cause this method to incorrectly return `None` if fewer elements than
  /// the advertised `lower` bound are present and may prevent sampling of
  /// elements beyond an advertised `upper` bound (i.e. incorrect `size_hint`
  /// is memory-safe, but may result in unexpected `None` result and
  /// non-uniform distribution).
  ///
  /// With an accurate [`Iterator::size_hint`] and where [`Iterator::nth`] is
  /// a constant-time operation, this method can offer `O(1)` performance.
  /// Where no size hint is
  /// available, complexity is `O(n)` where `n` is the iterator length.
  /// Partial hints (where `lower > 0`) also improve performance.
  ///
  /// Note further that [`Iterator::size_hint`] may affect the number of RNG
  /// samples used as well as the result (while remaining uniform sampling).
  /// Consider instead using [`IteratorRandom::choose_stable`] to avoid
  /// [`Iterator`] combinators which only change size hints from affecting the
  /// results.
  // crate: rand-0.10.1/src/seq/iterator.rs:66 choose
  choose<T>(self: RustIterator<T>, rng: Rng): T | undefined {
    let [lower, upper] = self.size_hint();
    let result: T | undefined = undefined;

    // Handling for this condition outside the loop allows the optimizer to eliminate the loop
    // when the Iterator is an ExactSizeIterator. This has a large performance impact on e.g.
    // seq_iter_choose_from_1000.
    if (upper === lower) {
      switch (lower) {
        case 0:
          return undefined;
        case 1:
          return self.next();
        default:
          return iter_nth(self, RngExt.random_range(rng, new RangeTo(SampleUniform_usize, lower)));
      }
    }

    const coin_flipper = CoinFlipper.new(rng);
    let consumed = 0;

    // Continue until the iterator is exhausted
    for (;;) {
      if (lower > 1) {
        const ix = RngExt.random_range(coin_flipper.rng, new RangeTo(SampleUniform_usize, lower + consumed));
        let skip;
        if (ix < lower) {
          result = iter_nth(self, ix);
          skip = lower - (ix + 1);
        } else {
          skip = lower;
        }
        if (upper === lower) {
          return result;
        }
        consumed += lower;
        if (skip > 0) {
          iter_nth(self, skip - 1);
        }
      } else {
        const elem = self.next();
        if (elem === undefined) {
          return result;
        }
        consumed += 1;
        if (coin_flipper.random_ratio_one_over(consumed)) {
          result = elem;
        }
      }

      const hint = self.size_hint();
      lower = hint[0];
      upper = hint[1];
    }
  },
};
