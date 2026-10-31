//! The standard RNG
//
// Port of rand =0.10.1 `src/rngs/std.rs` (feature `std_rng`).
import { debug_tuple, type Debug } from "../../../std/fmt.ts";
import type { Result } from "../../../std/result.ts";
import { ChaCha12Rng, debug_ChaCha12Rng } from "../../chacha20/rng.ts";
import { Rng_for_TryRng, type CryptoRng, type Infallible, type Rng } from "../../rand_core/lib.ts";
import { SeedableRng_provided } from "../../rand_core/seedable_rng.ts";

/// A strong, fast (amortized), non-portable RNG
///
/// This is the "standard" RNG, a generator with the following properties:
///
/// - Non-[portable]: any future library version may replace the algorithm
///   and results may be platform-dependent.
///   (For a portable version, use the [rand_chacha] crate directly.)
/// - [CSPRNG]: statistically good quality of randomness and [unpredictable]
/// - Fast ([amortized](https://en.wikipedia.org/wiki/Amortized_analysis)):
///   the RNG is fast for bulk generation, but the cost of method calls is not
///   consistent due to usage of an output buffer.
///
/// The current algorithm used is the ChaCha block cipher with 12 rounds. Please
/// see this relevant [rand issue] for the discussion. This may change as new
/// evidence of cipher security and performance becomes available.
// use chacha20::ChaCha12Rng as Rng;
export class StdRng implements CryptoRng {
  constructor(public _0: ChaCha12Rng) {}

  // impl TryRng for StdRng
  // crate: rand-0.10.1/src/rngs/std.rs:79 try_next_u32
  try_next_u32(): Result<number, Infallible> {
    return this._0.try_next_u32();
  }

  // crate: rand-0.10.1/src/rngs/std.rs:84 try_next_u64
  try_next_u64(): Result<bigint, Infallible> {
    return this._0.try_next_u64();
  }

  // crate: rand-0.10.1/src/rngs/std.rs:89 try_fill_bytes
  try_fill_bytes(dst: Uint8Array): Result<void, Infallible> {
    return this._0.try_fill_bytes(dst);
  }

  // impl Rng (blanket impl over `TryRng<Error = Infallible>`)
  next_u32(): number {
    return Rng_for_TryRng.next_u32(this);
  }
  next_u64(): bigint {
    return Rng_for_TryRng.next_u64(this);
  }
  fill_bytes(dst: Uint8Array): void {
    Rng_for_TryRng.fill_bytes(this, dst);
  }

  // impl SeedableRng for StdRng
  // Fix to 256 bits. Changing this is a breaking change!
  // type Seed = [u8; 32];
  static Seed_default(): Uint8Array {
    return new Uint8Array(32);
  }

  // crate: rand-0.10.1/src/rngs/std.rs:99 from_seed
  static from_seed(seed: Uint8Array): StdRng {
    return new StdRng(ChaCha12Rng.from_seed(seed));
  }

  /** `SeedableRng::seed_from_u64` (provided). */
  static seed_from_u64(state: bigint): StdRng {
    return SeedableRng_provided.seed_from_u64(StdRng, state);
  }

  /** `SeedableRng::from_rng` (provided). */
  static from_rng(rng: Rng): StdRng {
    return SeedableRng_provided.from_rng(StdRng, rng);
  }
}

/** `#[derive(Debug)]`: `StdRng(ChaCha12Rng { ... })`. */
export const debug_StdRng: Debug<StdRng> = (v, f) => debug_tuple(f, "StdRng", [debug_ChaCha12Rng(v._0, f)]);

/** `#[derive(PartialEq)]` */
export function StdRng_eq(a: StdRng, b: StdRng): boolean {
  return a._0.eq(b._0);
}
