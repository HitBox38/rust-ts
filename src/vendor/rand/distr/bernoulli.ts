//! The Bernoulli distribution `Bernoulli(p)`.
//
// Port of rand =0.10.1 `src/distr/bernoulli.rs`.
// PORT: `p_int: u64` is `bigint`. `(p * SCALE) as u64` is Rust's saturating float-to-int cast; for
// `0.0 <= p < 1.0` the product is in `[0, 2^64)` and an integer-valued double, so `BigInt(...)` is exact.
import { debug_struct, type Debug } from "../../../std/fmt.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import type { Rng } from "../../rand_core/lib.ts";
import type { Distribution } from "./distribution.ts";
import { StandardUniform_u64 } from "./integer.ts";

/// The [Bernoulli distribution](https://en.wikipedia.org/wiki/Bernoulli_distribution) `Bernoulli(p)`.
///
/// This distribution describes a single boolean random variable, which is true
/// with probability `p` and false with probability `1 - p`.
/// It is a special case of the Binomial distribution with `n = 1`.
///
/// # Precision
///
/// This `Bernoulli` distribution uses 64 bits from the RNG (a `u64`),
/// so only probabilities that are multiples of 2<sup>-64</sup> can be
/// represented.
export class Bernoulli implements Distribution<boolean> {
  constructor(
    /// Probability of success, relative to the maximal integer.
    public p_int: bigint,
  ) {}

  /// Construct a new `Bernoulli` with the given probability of success `p`.
  ///
  /// # Precision
  ///
  /// For `p = 1.0`, the resulting distribution will always generate true.
  /// For `p = 0.0`, the resulting distribution will always generate false.
  ///
  /// This method is accurate for any input `p` in the range `[0, 1]` which is
  /// a multiple of 2<sup>-64</sup>. (Note that not all multiples of
  /// 2<sup>-64</sup> in `[0, 1]` can be represented as a `f64`.)
  // crate: rand-0.10.1/src/distr/bernoulli.rs:107 new
  static new(p: number): Result<Bernoulli, BernoulliError> {
    if (!(0.0 <= p && p < 1.0)) {
      if (p === 1.0) {
        return Ok(new Bernoulli(ALWAYS_TRUE));
      }
      return Err(BernoulliError.InvalidProbability);
    }
    return Ok(new Bernoulli(BigInt(Math.trunc(p * SCALE))));
  }

  /// Construct a new `Bernoulli` with the probability of success of
  /// `numerator`-in-`denominator`. I.e. `new_ratio(2, 3)` will return
  /// a `Bernoulli` with a 2-in-3 chance, or about 67%, of returning `true`.
  ///
  /// return `true`. If `numerator == 0` it will always return `false`.
  /// For `numerator > denominator` and `denominator == 0`, this returns an
  /// error. Otherwise, for `numerator == denominator`, samples are always
  /// true; for `numerator == 0` samples are always false.
  // crate: rand-0.10.1/src/distr/bernoulli.rs:128 from_ratio
  static from_ratio(numerator: number, denominator: number): Result<Bernoulli, BernoulliError> {
    if (numerator > denominator || denominator === 0) {
      return Err(BernoulliError.InvalidProbability);
    }
    if (numerator === denominator) {
      return Ok(new Bernoulli(ALWAYS_TRUE));
    }
    const p_int = BigInt(Math.trunc((numerator / denominator) * SCALE));
    return Ok(new Bernoulli(p_int));
  }

  /// Returns the probability (`p`) of the distribution.
  ///
  /// This value may differ slightly from the input due to loss of precision.
  // crate: rand-0.10.1/src/distr/bernoulli.rs:143 p
  p(): number {
    if (this.p_int === ALWAYS_TRUE) {
      return 1.0;
    } else {
      return Number(this.p_int) / SCALE;
    }
  }

  // impl Distribution<bool> for Bernoulli
  // crate: rand-0.10.1/src/distr/bernoulli.rs:154 sample
  sample(rng: Rng): boolean {
    // Make sure to always return true for p = 1.0.
    if (this.p_int === ALWAYS_TRUE) {
      return true;
    }
    const v: bigint = StandardUniform_u64.sample(rng);
    return v < this.p_int;
  }
}

// To sample from the Bernoulli distribution we use a method that compares a
// random `u64` value `v < (p * 2^64)`.
//
// If `p == 1.0`, the integer `v` to compare against can not represented as a
// `u64`. We manually set it to `u64::MAX` instead (2^64 - 1 instead of 2^64).
// Note that  value of `p < 1.0` can never result in `u64::MAX`, because an
// `f64` only has 53 bits of precision, and the next largest value of `p` will
// result in `2^64 - 2048`.
//
// Also there is a 100% theoretical concern: if someone consistently wants to
// generate `true` using the Bernoulli distribution (i.e. by using a probability
// of `1.0`), just using `u64::MAX` is not enough. On average it would return
// false once every 2^64 iterations. Some people apparently care about this
// case.
//
// That is why we special-case `u64::MAX` to always return `true`, without using
// the RNG, and pay the performance price for all uses that *are* reasonable.
// Luckily, if `new()` and `sample` are close, the compiler can optimize out the
// extra check.
const ALWAYS_TRUE = 0xffff_ffff_ffff_ffffn;

// This is just `2.0.powi(64)`, but written this way because it is not available
// in `no_std` mode.
const SCALE = 2.0 * 2 ** 63;

/// Error type returned from [`Bernoulli::new`].
export type BernoulliError = "InvalidProbability";
export const BernoulliError = {
  /// `p < 0` or `p > 1`.
  InvalidProbability: "InvalidProbability",
} as const;

export const debug_BernoulliError: Debug<BernoulliError> = (v) => v;

// impl fmt::Display for BernoulliError
// crate: rand-0.10.1/src/distr/bernoulli.rs:86 fmt
export function display_BernoulliError(v: BernoulliError): string {
  switch (v) {
    case "InvalidProbability":
      return "p is outside [0, 1] in Bernoulli distribution";
  }
}

/** `#[derive(Debug)]` */
export const debug_Bernoulli: Debug<Bernoulli> = (v, f) => debug_struct(f, "Bernoulli", [["p_int", String(v.p_int)]]);

/** `#[derive(PartialEq)]` */
export function Bernoulli_eq(a: Bernoulli, b: Bernoulli): boolean {
  return a.p_int === b.p_int;
}
