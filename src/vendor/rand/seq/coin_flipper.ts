// Port of rand =0.10.1 `src/seq/coin_flipper.rs`.
// PORT: `rng: R` (a `&mut R` in every use) is the generator. usize is `number`; `usize::leading_zeros` is
// `usize_leading_zeros` (64-bit usize). The `n`/`d` arithmetic stays exact for `d < 2^52` (asserted), which
// covers every iterator length the port can hold.
import { assert } from "../../../std/panic.ts";
import type { Rng } from "../../rand_core/lib.ts";

const USIZE_BITS = 64;
const USIZE_MAX = 2 ** 64 - 1; // only compared against (`saturating_mul`); see `random_ratio`

/** `usize::leading_zeros` for a 64-bit usize held in a `number`. */
function usize_leading_zeros(x: number): number {
  return x >= 0x1_0000_0000 ? Math.clz32(Math.floor(x / 0x1_0000_0000)) : 32 + Math.clz32(x);
}

export class CoinFlipper {
  constructor(
    public rng: Rng,
    public chunk: number, // TODO(opt): this should depend on RNG word size
    public chunk_remaining: number,
  ) {}

  // crate: rand-0.10.1/src/seq/coin_flipper.rs:18 new
  static new(rng: Rng): CoinFlipper {
    return new CoinFlipper(rng, 0, 0);
  }

  /// Returns true with a probability of 1 / d
  /// Uses an expected two bits of randomness
  /// Panics if d == 0
  // crate: rand-0.10.1/src/seq/coin_flipper.rs:30 random_ratio_one_over
  random_ratio_one_over(d: number): boolean {
    // debug_assert_ne!(d, 0);
    // This uses the same logic as `random_ratio` but is optimized for the case that
    // the starting numerator is one (which it always is for `Sequence::Choose()`)

    // In this case (but not `random_ratio`), this way of calculating c is always accurate
    const c = Math.min(USIZE_BITS - 1 - usize_leading_zeros(d), 32);

    if (this.flip_c_heads(c)) {
      const numerator = 2 ** c;
      return this.random_ratio(numerator, d);
    } else {
      return false;
    }
  }

  /// Returns true with a probability of n / d
  /// Uses an expected two bits of randomness
  // crate: rand-0.10.1/src/seq/coin_flipper.rs:49 random_ratio
  random_ratio(n: number, d: number): boolean {
    assert(d < 2 ** 52, "rand CoinFlipper: d at or above 2^52 (usize as number)");
    // Explanation:
    // We are trying to return true with a probability of n / d
    // If n >= d, we can just return true
    // Otherwise there are two possibilities 2n < d and 2n >= d
    // In either case we flip a coin.
    // If 2n < d
    //  If it comes up tails, return false
    //  If it comes up heads, double n and start again
    //  This is fair because (0.5 * 0) + (0.5 * 2n / d) = n / d and 2n is less than d
    // (if 2n was greater than d we would effectively round it down to 1
    // by returning true)
    // If 2n >= d
    //  If it comes up tails, set n to 2n - d and start again
    //  If it comes up heads, return true
    //  This is fair because (0.5 * 1) + (0.5 * (2n - d) / d) = n / d
    //  Note that if 2n = d and the coin comes up tails, n will be set to 0
    //  before restarting which is equivalent to returning false.

    // As a performance optimization we can flip multiple coins at once
    // This is efficient because we can use the `lzcnt` intrinsic
    // We can check up to 32 flips at once but we only receive one bit of information
    // - all heads or at least one tail.

    // Let c be the number of coins to flip. 1 <= c <= 32
    // If 2n < d, n * 2^c < d
    // If the result is all heads, then set n to n * 2^c
    // If there was at least one tail, return false
    // If 2n >= d, the order of results matters so we flip one coin at a time so c = 1
    // Ideally, c will be as high as possible within these constraints

    while (n < d) {
      // Find a good value for c by counting leading zeros
      // This will either give the highest possible c, or 1 less than that
      const c = Math.min(Math.max(Math.max(usize_leading_zeros(n) - (usize_leading_zeros(d) + 1), 0), 1), 32);

      if (this.flip_c_heads(c)) {
        // All heads
        // Set n to n * 2^c
        // If 2n >= d, the while loop will exit and we will return `true`
        // If n * 2^c > `usize::MAX` we always return `true` anyway
        // PORT: `n.saturating_mul(2_usize.pow(c))`; with `n < d < 2^52` and `c <= 32` an inexact product is
        // still `>= d` exactly when the true one is, which is all the loop reads.
        n = Math.min(n * 2 ** c, USIZE_MAX);
      } else {
        // At least one tail
        if (c === 1) {
          // Calculate 2n - d.
          // We need to use wrapping as 2n might be greater than `usize::MAX`
          // PORT: `n < d < 2^52`, so `2n - d` is exact; a negative value is the wrapped one (`> n`).
          const t = n + n - d;
          const next_n = t < 0 ? USIZE_MAX + 1 + t : t;
          if (next_n === 0 || next_n > n) {
            // This will happen if 2n < d
            return false;
          }
          n = next_n;
        } else {
          // c > 1 so 2n < d so we can return false
          return false;
        }
      }
    }
    return true;
  }

  /// If the next `c` bits of randomness all represent heads, consume them, return true.
  /// Otherwise return false and consume the number of heads plus one.
  /// Generates new bits of randomness when necessary (in 32 bit chunks)
  /// Has a 1 in 2 to the `c` chance of returning true
  /// `c` must be less than or equal to 32
  // crate: rand-0.10.1/src/seq/coin_flipper.rs:119 flip_c_heads
  flip_c_heads(c: number): boolean {
    // debug_assert!(c <= 32);
    // Note that zeros on the left of the chunk represent heads.
    // It needs to be this way round because zeros are filled in when left shifting
    for (;;) {
      const zeros = Math.clz32(this.chunk);

      if (zeros < c) {
        // The happy path - we found a 1 and can return false
        // Note that because a 1 bit was detected,
        // We cannot have run out of random bits so we don't need to check

        // First consume all of the bits read
        // Using shl seems to give worse performance for size-hinted iterators
        this.chunk = (this.chunk << ((zeros + 1) & 31)) >>> 0;

        this.chunk_remaining = Math.max(this.chunk_remaining - (zeros + 1), 0);
        return false;
      } else {
        // The number of zeros is larger than `c`
        // There are two possibilities
        if (this.chunk_remaining >= c) {
          const new_remaining = this.chunk_remaining - c;
          // Those zeroes were all part of our random chunk,
          // throw away `c` bits of randomness and return true
          this.chunk_remaining = new_remaining;
          // PORT: `self.chunk <<= c` in a release build (no overflow checks) masks the shift to `c & 31`.
          this.chunk = (this.chunk << (c & 31)) >>> 0;
          return true;
        } else {
          // Some of those zeroes were part of the random chunk
          // and some were part of the space behind it
          // We need to take into account only the zeroes that were random
          c -= this.chunk_remaining;

          // Generate a new chunk
          this.chunk = this.rng.next_u32();
          this.chunk_remaining = 32;
          // Go back to start of loop
        }
      }
    }
  }
}
