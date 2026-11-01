// Port of rand_core =0.10.1 `src/seedable_rng.rs`.
// PORT: `SeedableRng` is a table of the implementor's associated items (`Self` is the type parameter `S`):
// `Seed` is always a byte array `[u8; N]` here, so `Self::Seed::default()` is `Seed_default()` (N zero bytes).
// The provided methods live in `SeedableRng_provided` and take that table first.
import { Ok, type Result } from "../../std/result.ts";
import type { Infallible, Rng, TryRng } from "./lib.ts";

const U64_MASK = 0xffff_ffff_ffff_ffffn;

/// A random number generator that can be explicitly seeded.
///
/// This trait encapsulates the low-level functionality common to all
/// pseudo-random number generators (PRNGs, or algorithmic generators).
///
/// A generator implementing `SeedableRng` will usually be deterministic, but
/// beware that portability and reproducibility of results **is not implied**.
/// Refer to documentation of the generator, noting that generators named after
/// a specific algorithm are usually tested for reproducibility against a
/// reference vector, while `SmallRng` and `StdRng` specifically opt out of
/// reproducibility guarantees.
export interface SeedableRng<S> {
  /** `Self::Seed::default()`: the zeroed `[u8; N]` seed. */
  Seed_default(): Uint8Array;

  /// Create a new PRNG using the given seed.
  ///
  /// PRNG implementations are allowed to assume that bits in the seed are
  /// well distributed. That means usually that the number of one and zero
  /// bits are roughly equal, and values like 0, 1 and (size - 1) are unlikely.
  /// Note that many non-cryptographic PRNGs will show poor quality output
  /// if this is not adhered to. If you wish to seed from simple numbers, use
  /// `seed_from_u64` instead.
  // crate: rand_core-0.10.1/src/seedable_rng.rs:93 from_seed
  from_seed(seed: Uint8Array): S;

  // seed_from_u64 (provided)
  // from_rng (provided)
  // try_from_rng (provided)
  // fork (provided)
  // try_fork (provided)
}

export const SeedableRng_provided = {
  /// Create a new PRNG using a `u64` seed.
  ///
  /// This is a convenience-wrapper around `from_seed` to allow construction
  /// of any `SeedableRng` from a simple `u64` value. It is designed such that
  /// low Hamming Weight numbers like 0 and 1 can be used and should still
  /// result in good, independent seeds to the PRNG which is returned.
  ///
  /// This **is not suitable for cryptography**, as should be clear given that
  /// the input size is only 64 bits.
  // crate: rand_core-0.10.1/src/seedable_rng.rs:109 seed_from_u64
  seed_from_u64<S>(Self: SeedableRng<S>, state_: bigint): S {
    const state = { value: state_ & U64_MASK };
    const seed = Self.Seed_default();
    // `seed.as_mut().chunks_exact_mut(4)`
    const full = seed.length - (seed.length % 4);
    for (let at = 0; at < full; at += 4) {
      seed.set(pcg32(state), at);
    }
    const rem = seed.subarray(full);
    if (rem.length !== 0) {
      rem.set(pcg32(state).subarray(0, rem.length));
    }

    return Self.from_seed(seed);
  },

  /// Create a new PRNG seeded from an infallible `Rng`.
  ///
  /// This may be useful when needing to rapidly seed many PRNGs from a master
  /// PRNG, and to allow forking of PRNGs. It may be considered deterministic.
  // crate: rand_core-0.10.1/src/seedable_rng.rs:147 from_rng
  from_rng<S>(Self: SeedableRng<S>, rng: Rng): S {
    const seed = Self.Seed_default();
    rng.fill_bytes(seed);
    return Self.from_seed(seed);
  },

  /// Create a new PRNG seeded from a potentially fallible `Rng`.
  ///
  /// See [`from_rng`][SeedableRng::from_rng] docs for more information.
  // crate: rand_core-0.10.1/src/seedable_rng.rs:156 try_from_rng
  try_from_rng<S, E>(Self: SeedableRng<S>, rng: TryRng<E>): Result<S, E> {
    const seed = Self.Seed_default();
    const r = rng.try_fill_bytes(seed);
    if (r.$ === "Err") return r;
    return Ok(Self.from_seed(seed));
  },

  /// Fork this PRNG
  ///
  /// This creates a new PRNG from the current one by initializing a new one and
  /// seeding it from the current one.
  ///
  /// This is useful when initializing a PRNG for a thread
  // crate: rand_core-0.10.1/src/seedable_rng.rs:168 fork
  fork<S extends Rng>(Self: SeedableRng<S>, self: S): S {
    return SeedableRng_provided.from_rng(Self, self);
  },

  /// Fork this PRNG
  ///
  /// This is the failable equivalent to [`SeedableRng::fork`]
  // crate: rand_core-0.10.1/src/seedable_rng.rs:183 try_fork
  try_fork<S extends TryRng<E>, E = Infallible>(Self: SeedableRng<S>, self: S): Result<S, E> {
    return SeedableRng_provided.try_from_rng(Self, self);
  },
};

/// PCG32 generator function
// crate: rand_core-0.10.1/src/seedable_rng.rs:192 pcg32
function pcg32(state: { value: bigint }): Uint8Array {
  const MUL = 0x5851_f42d_4c95_7f2dn;
  const INC = 0xa176_54e4_6fbe_17f3n;

  // We advance the state first (to get away from the input value,
  // in case it has low Hamming Weight).
  state.value = (state.value * MUL + INC) & U64_MASK;
  const s = state.value;

  // Use PCG output function with to_le to generate x:
  const xorshifted = Number((((s >> 18n) ^ s) >> 27n) & 0xffff_ffffn);
  const rot = Number(s >> 59n);
  // `xorshifted.rotate_right(rot)`
  const x = ((xorshifted >>> rot) | (xorshifted << ((32 - rot) & 31))) >>> 0;
  return Uint8Array.of(x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, x >>> 24);
}
