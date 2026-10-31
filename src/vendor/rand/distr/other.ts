//! The implementations of the `StandardUniform` distribution for other built-in types.
//
// Port of rand =0.10.1 `src/distr/other.rs`: `bool` (Miri's `random::<bool>()`). The `char`, `Alphanumeric`,
// `Alphabetic`, tuple, array and `Wrapping` impls are not ported (Miri does not sample them).
import type { Rng } from "../../rand_core/lib.ts";
import type { Distribution } from "./distribution.ts";

// crate-skip: rand-0.10.1/src/distr/other.rs:241 sample cfg(feature = "simd_support"): off in Miri's rand (default features)

// impl Distribution<bool> for StandardUniform
export const StandardUniform_bool: Distribution<boolean> = {
  // crate: rand-0.10.1/src/distr/other.rs:198 sample
  sample(rng: Rng): boolean {
    // We can compare against an arbitrary bit of an u32 to get a bool.
    // Because the least significant bits of a lower quality RNG can have
    // simple patterns, we compare against the most significant bit. This is
    // easiest done using a sign test.
    return (rng.next_u32() | 0) < 0;
  },
};
