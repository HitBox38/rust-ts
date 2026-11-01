//! Main `rand_core` tests
//
// Port of rand_core =0.10.1 `tests/mod.rs`.
// PORT: the `dyn_*` tests check trait-object coercions at compile time; here they call the same functions with
// the stub RNG (TS checks the shapes structurally).
import { expect, test } from "bun:test";
import { Ok, type Result } from "../../../std/result.ts";
import { panic } from "../../../std/panic.ts";
import { Rng_for_TryRng, UnwrapErr, utils, type CryptoRng, type Infallible, type Rng, type TryCryptoRng, type TryRng } from "../lib.ts";
import { SeedableRng_provided, type SeedableRng } from "../seedable_rng.ts";
import { Word_u64 } from "../word.ts";

const popcount = (x: bigint) => [...x.toString(2)].filter((c) => c === "1").length;

// crate: rand_core-0.10.1/tests/mod.rs:5 test_seed_from_u64
test("test_seed_from_u64", () => {
  // struct SeedableNum(u64); impl SeedableRng for SeedableNum (type Seed = [u8; 8])
  const SeedableNum: SeedableRng<bigint> = {
    Seed_default: () => new Uint8Array(8),
    // crate: rand_core-0.10.1/tests/mod.rs:10 from_seed
    from_seed(seed: Uint8Array): bigint {
      const x = utils.read_words(Word_u64, 1, seed);
      return x[0]!;
    },
  };

  const SEEDS = [0n, 1n, 2n, 3n, 4n, 8n, 16n, 0xffff_ffff_ffff_ffffn];
  const results = SEEDS.map((seed) => SeedableRng_provided.seed_from_u64(SeedableNum, seed));

  for (let i1 = 0; i1 < results.length; i1++) {
    const r1 = results[i1]!;
    const weight = popcount(r1);
    // This is the binomial distribution B(64, 0.5), so chance of
    // weight < 20 is binocdf(19, 64, 0.5) = 7.8e-4, and same for
    // weight > 44.
    expect(weight >= 20 && weight <= 44).toBe(true);

    for (let i2 = 0; i2 < results.length; i2++) {
      if (i1 === i2) {
        continue;
      }
      const diff_weight = popcount(r1 ^ results[i2]!);
      expect(diff_weight >= 20).toBe(true);
    }
  }

  // value-breakage test:
  expect(results[0]).toBe(5029875928683246316n);
});

// A stub RNG.
class SomeRng implements Rng, TryCryptoRng<Infallible> {
  // crate: rand_core-0.10.1/tests/mod.rs:50 try_next_u32
  try_next_u32(): Result<number, Infallible> {
    panic("not implemented");
  }
  // crate: rand_core-0.10.1/tests/mod.rs:53 try_next_u64
  try_next_u64(): Result<bigint, Infallible> {
    panic("not implemented");
  }
  // crate: rand_core-0.10.1/tests/mod.rs:56 try_fill_bytes
  try_fill_bytes(_dst: Uint8Array): Result<void, Infallible> {
    panic("not implemented");
  }
  next_u32(): number {
    return Rng_for_TryRng.next_u32(this);
  }
  next_u64(): bigint {
    return Rng_for_TryRng.next_u64(this);
  }
  fill_bytes(dst: Uint8Array): void {
    Rng_for_TryRng.fill_bytes(this, dst);
  }
}

// crate: rand_core-0.10.1/tests/mod.rs:64 dyn_rng_to_tryrng
test("dyn_rng_to_tryrng", () => {
  // Illustrates the need for `+ ?Sized` bound in `impl<R: Rng> TryRng for R`.

  // A method in another crate taking a fallible RNG
  // crate: rand_core-0.10.1/tests/mod.rs:68 third_party_api
  function third_party_api(_rng: TryRng): boolean {
    return true;
  }

  // A method in our crate requiring an infallible RNG
  // crate: rand_core-0.10.1/tests/mod.rs:73 my_api
  function my_api(rng: Rng): boolean {
    // We want to call the method above
    return third_party_api(rng);
  }

  expect(my_api(new SomeRng())).toBe(true);
});

// crate: rand_core-0.10.1/tests/mod.rs:82 dyn_cryptorng_to_trycryptorng
test("dyn_cryptorng_to_trycryptorng", () => {
  // Illustrates the need for `+ ?Sized` bound in `impl<R: CryptoRng> TryCryptoRng for R`.

  // A method in another crate taking a fallible RNG
  // crate: rand_core-0.10.1/tests/mod.rs:86 third_party_api
  function third_party_api(_rng: TryCryptoRng): boolean {
    return true;
  }

  // A method in our crate requiring an infallible RNG
  // crate: rand_core-0.10.1/tests/mod.rs:91 my_api
  function my_api(rng: CryptoRng): boolean {
    // We want to call the method above
    return third_party_api(rng);
  }

  expect(my_api(new SomeRng())).toBe(true);
});

// crate: rand_core-0.10.1/tests/mod.rs:100 dyn_unwrap_mut_tryrng
test("dyn_unwrap_mut_tryrng", () => {
  // Illustrates that UnwrapMut may be used over &mut R where R: TryRng

  // crate: rand_core-0.10.1/tests/mod.rs:103 third_party_api
  function third_party_api(_rng: Rng): boolean {
    return true;
  }

  // crate: rand_core-0.10.1/tests/mod.rs:107 my_api
  function my_api(rng: TryRng): boolean {
    const infallible_rng = new UnwrapErr(rng);
    return third_party_api(infallible_rng);
  }

  expect(my_api(new SomeRng())).toBe(true);
});

// crate: rand_core-0.10.1/tests/mod.rs:116 dyn_unwrap_mut_trycryptorng
test("dyn_unwrap_mut_trycryptorng", () => {
  // Crypto variant of the above

  // crate: rand_core-0.10.1/tests/mod.rs:119 third_party_api
  function third_party_api(_rng: CryptoRng): boolean {
    return true;
  }

  // crate: rand_core-0.10.1/tests/mod.rs:123 my_api
  function my_api(rng: TryCryptoRng): boolean {
    const infallible_rng = new UnwrapErr(rng);
    return third_party_api(infallible_rng);
  }

  expect(my_api(new SomeRng())).toBe(true);
});

// crate: rand_core-0.10.1/tests/mod.rs:132 reborrow_unwrap_mut
test("reborrow_unwrap_mut", () => {
  class FourRng implements TryRng<Infallible> {
    // crate: rand_core-0.10.1/tests/mod.rs:137 try_next_u32
    try_next_u32(): Result<number, Infallible> {
      return Ok(4);
    }
    // crate: rand_core-0.10.1/tests/mod.rs:140 try_next_u64
    try_next_u64(): Result<bigint, Infallible> {
      panic("not implemented");
    }
    // crate: rand_core-0.10.1/tests/mod.rs:143 try_fill_bytes
    try_fill_bytes(_: Uint8Array): Result<void, Infallible> {
      panic("not implemented");
    }
  }

  const rng0 = new FourRng();
  const rng = new UnwrapErr(rng0);

  expect(rng.next_u32()).toBe(4);
  {
    const rng2 = rng.re();
    expect(rng2.next_u32()).toBe(4);
    // Make sure rng2 is dropped.
  }
  expect(rng.next_u32()).toBe(4);
});
