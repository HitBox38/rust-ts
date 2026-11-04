// Port of the tests of rand_xoshiro =0.7.0 `src/xoshiro128starstar.rs`.
import { expect, test } from "bun:test";
import { Xoshiro128StarStar } from "./xoshiro128starstar.ts";

const SEED = Uint8Array.from([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0]);

// crate: rand_xoshiro-0.7.0/src/xoshiro128starstar.rs:102 reference
test("reference", () => {
  const rng = Xoshiro128StarStar.from_seed(SEED);
  // These values were produced with the reference implementation (v1.1):
  // http://xoshiro.di.unimi.it/xoshiro128starstar.c
  const expected = [11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849, 3729100597, 4258142804];
  for (const e of expected) {
    expect(rng.next_u32()).toBe(e);
  }
});

// crate: rand_xoshiro-0.7.0/src/xoshiro128starstar.rs:117 test_jump
test("test_jump", () => {
  const rng = Xoshiro128StarStar.from_seed(SEED);
  rng.jump();
  // These values were produced by instrumenting the reference implementation:
  // http://xoshiro.di.unimi.it/xoshiro128plus.c
  expect(rng.s).toEqual([2843103750, 2038079848, 1533207345, 44816753]);
});

// crate: rand_xoshiro-0.7.0/src/xoshiro128starstar.rs:130 test_long_jump
test("test_long_jump", () => {
  const rng = Xoshiro128StarStar.from_seed(SEED);
  rng.long_jump();
  // These values were produced by instrumenting the reference implementation:
  // http://xoshiro.di.unimi.it/xoshiro128plus.c
  expect(rng.s).toEqual([1611968294, 2125834322, 966769569, 3193880526]);
});

test("from_seed maps the all-zero seed to seed_from_u64(0)", () => {
  expect(Xoshiro128StarStar.from_seed(new Uint8Array(16)).s).toEqual(Xoshiro128StarStar.seed_from_u64(0n).s);
});
