// Port of rand =0.10.1 `src/seq/increasing_uniform.rs`.
// PORT: rustc_abi's `-Zrandomize-layout` shuffle uses rand 0.9.3, whose file differs from this one only in the trait
// names (`RngCore` for `Rng`, `Rng` for `RngExt`); harness/scope.json holds rand at 0.10.1.
import type { Rng } from "../../rand_core/lib.ts";
import { RangeTo } from "../distr/uniform.ts";
import { SampleUniform_u32 } from "../distr/uniform_int.ts";
import { RngExt } from "../rng.ts";

/// Similar to a Uniform distribution,
/// but after returning a number in the range [0,n], n is increased by 1.
export class IncreasingUniform {
  constructor(
    public rng: Rng,
    public n: number,
    // Chunk is a random number in [0, (n + 1) * (n + 2) *..* (n + chunk_remaining) )
    public chunk: number,
    public chunk_remaining: number,
  ) {}

  /// Create a dice roller.
  /// The next item returned will be a random number in the range [0,n]
  // crate: rand-0.10.1/src/seq/increasing_uniform.rs:24 new
  static new(rng: Rng, n: number): IncreasingUniform {
    // If n = 0, the first number returned will always be 0
    // so we don't need to generate a random number
    const chunk_remaining = n === 0 ? 1 : 0;
    return new IncreasingUniform(rng, n, 0, chunk_remaining);
  }

  /// Returns a number in [0,n] and increments n by 1.
  /// Generates new random bits as needed
  /// Panics if `n >= u32::MAX`
  // crate: rand-0.10.1/src/seq/increasing_uniform.rs:40 next_index
  next_index(): number {
    const next_n = this.n + 1;

    // There's room for further optimisation here:
    // random_range uses rejection sampling (or other method; see #1196) to avoid bias.
    // When the initial sample is biased for range 0..bound
    // it may still be viable to use for a smaller bound
    // (especially if small biases are considered acceptable).

    let next_chunk_remaining: number;
    if (this.chunk_remaining !== 0) {
      next_chunk_remaining = this.chunk_remaining - 1;
    } else {
      // If the chunk is empty, generate a new chunk
      const [bound, remaining] = calculate_bound_u32(next_n);
      // bound = (n + 1) * (n + 2) *..* (n + remaining)
      this.chunk = RngExt.random_range(this.rng, new RangeTo(SampleUniform_u32, bound));
      // Chunk is a random number in
      // [0, (n + 1) * (n + 2) *..* (n + remaining) )

      next_chunk_remaining = remaining - 1;
    }

    let result: number;
    if (next_chunk_remaining === 0) {
      // `chunk` is a random number in the range [0..n+1)
      // Because `chunk_remaining` is about to be set to zero
      // we do not need to clear the chunk here
      result = this.chunk;
    } else {
      // `chunk` is a random number in a range that is a multiple of n+1
      // so r will be a random number in [0..n+1)
      const r = this.chunk % next_n;
      this.chunk = Math.trunc(this.chunk / next_n);
      result = r;
    }

    this.chunk_remaining = next_chunk_remaining;
    this.n = next_n;
    return result;
  }
}

/// Calculates `bound`, `count` such that bound (m)*(m+1)*..*(m + remaining - 1)
// crate: rand-0.10.1/src/seq/increasing_uniform.rs:81 calculate_bound_u32
function calculate_bound_u32(m: number): [number, number] {
  // debug_assert!(m > 0);
  if (m === 2) {
    // Making this value a constant instead of recalculating it
    // gives a significant (~50%) performance boost for small shuffles
    return RESULT2;
  }

  return inner(m);
}

// crate: rand-0.10.1/src/seq/increasing_uniform.rs:84 inner
function inner(m: number): [number, number] {
  let product = m;
  let current = m + 1;

  for (;;) {
    // `u32::checked_mul`: the f64 product can round, but only above u32::MAX, so the comparison holds.
    const p = product * current;
    if (p <= 0xffff_ffff) {
      product = p;
      current += 1;
    } else {
      // Count has a maximum value of 13 for when min is 1 or 2
      const count = current - m;
      return [product, count];
    }
  }
}

const RESULT2: [number, number] = inner(2);
