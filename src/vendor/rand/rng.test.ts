// Port of rand =0.10.1 `src/rng.rs` `#[cfg(test)] mod test` (the float `test_random_range_float` is not ported:
// float ranges are not ported).
import { expect, test } from "bun:test";
import type { Rng } from "../rand_core/lib.ts";
import { Fill_u32, Fill_u64, RngExt } from "./rng.ts";
import { const_rng, rng } from "./test_util.ts";
import { Range, RangeInclusive, RangeTo } from "./distr/uniform.ts";
import { SampleUniform_i32, SampleUniform_i64, SampleUniform_i8, SampleUniform_u16, SampleUniform_u32, SampleUniform_usize } from "./distr/uniform_int.ts";
import { StandardUniform_i32, StandardUniform_u8 } from "./distr/integer.ts";

// crate: rand-0.10.1/src/rng.rs:411 test_fill_bytes_default
test("test_fill_bytes_default", () => {
  const r = const_rng(0x11_22_33_44_55_66_77_88n);

  // check every remainder mod 8, both in small and big vectors.
  const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 80, 81, 82, 83, 84, 85, 86, 87];
  for (const n of lengths) {
    const buffer = new Uint8Array(87);
    const v = buffer.subarray(0, n);
    r.fill_bytes(v);

    // use this to get nicer error messages.
    for (let i = 0; i < v.length; i++) {
      expect(`byte ${i} of ${n} is ${v[i] === 0 ? "zero" : "nonzero"}`).toBe(`byte ${i} of ${n} is nonzero`);
    }
  }
});

// crate: rand-0.10.1/src/rng.rs:431 test_fill
test("test_fill", () => {
  const x = 9041086907909331047n; // a random u64
  const r = const_rng(x);

  // Convert to byte sequence and back to u64; byte-swap twice if BE.
  const array64 = [0n, 0n];
  RngExt.fill(r, Fill_u64, array64);
  expect(array64).toEqual([x, x]);
  expect(r.next_u64()).toBe(x);

  // Convert to bytes then u32 in LE order
  const array = [0, 0];
  RngExt.fill(r, Fill_u32, array);
  expect(array).toEqual([Number(x & 0xffff_ffffn), Number(x >> 32n)]);
  expect(r.next_u32()).toBe(Number(x & 0xffff_ffffn));

  // Check equivalence using wrapped arrays
  // PORT: `Wrapping<u32>` is `u32`, so `[Wrapping(0u32); 2]` uses the same `Fill` table.
  const warray = [0, 0];
  RngExt.fill(r, Fill_u32, warray);
  expect(array[0]).toBe(warray[0]!);
  expect(array[1]).toBe(warray[1]!);
});

// crate: rand-0.10.1/src/rng.rs:455 test_fill_empty
test("test_fill_empty", () => {
  const array: number[] = [];
  const r = rng(1n);
  RngExt.fill(r, Fill_u32, array);
  RngExt.fill(r, Fill_u32, array.slice());
});

// crate: rand-0.10.1/src/rng.rs:463 test_random_range_int
test("test_random_range_int", () => {
  const r = rng(101n);
  const ok = (c: boolean) => expect(c).toBe(true);
  for (let i = 0; i < 1000; i++) {
    let a = RngExt.random_range(r, new Range(SampleUniform_i32, -4711, 17));
    ok(-4711 <= a && a < 17);
    a = RngExt.random_range(r, new Range(SampleUniform_i8, -3, 42));
    ok(-3 <= a && a < 42);
    a = RngExt.random_range(r, new Range(SampleUniform_u16, 10, 99));
    ok(10 <= a && a < 99);
    a = RngExt.random_range(r, new Range(SampleUniform_i32, -100, 2000));
    ok(-100 <= a && a < 2000);
    a = RngExt.random_range(r, new RangeInclusive(SampleUniform_u32, 12, 24));
    ok(12 <= a && a <= 24);

    expect(RngExt.random_range(r, new RangeTo(SampleUniform_u32, 1))).toBe(0);
    expect(RngExt.random_range(r, new Range(SampleUniform_i64, -12n, -11n))).toBe(-12n);
    expect(RngExt.random_range(r, new Range(SampleUniform_i32, 3_000_000, 3_000_001))).toBe(3_000_000);
  }
});

// crate: rand-0.10.1/src/rng.rs:501 test_random_range_panic_int
test("test_random_range_panic_int", () => {
  const r = rng(102n);
  expect(() => RngExt.random_range(r, new Range(SampleUniform_i32, 5, -2))).toThrow("cannot sample empty range");
});

// crate: rand-0.10.1/src/rng.rs:509 test_random_range_panic_usize
test("test_random_range_panic_usize", () => {
  const r = rng(103n);
  expect(() => RngExt.random_range(r, new Range(SampleUniform_usize, 5, 2))).toThrow("cannot sample empty range");
});

// crate: rand-0.10.1/src/rng.rs:516 test_random_bool
test("test_random_bool", () => {
  const r = rng(105n);
  for (let i = 0; i < 5; i++) {
    expect(RngExt.random_bool(r, 0.0)).toBe(false);
    expect(RngExt.random_bool(r, 1.0)).toBe(true);
  }
});

// crate: rand-0.10.1/src/rng.rs:525 test_rng_mut_ref
test("test_rng_mut_ref", () => {
  // crate: rand-0.10.1/src/rng.rs:526 use_rng
  function use_rng(r: Rng): void {
    r.next_u32();
  }

  const r = rng(109n);
  use_rng(r);
});

// crate: rand-0.10.1/src/rng.rs:535 test_rng_trait_object
test("test_rng_trait_object", () => {
  const r: Rng = rng(109n);
  r.next_u32();
  RngExt.random(r, StandardUniform_i32);
  expect(RngExt.random_range(r, new Range(SampleUniform_i32, 0, 1))).toBe(0);
  StandardUniform_u8.sample(r);
});

// crate: rand-0.10.1/src/rng.rs:547 test_rng_boxed_trait
test("test_rng_boxed_trait", () => {
  const r: Rng = rng(110n);
  r.next_u32();
  RngExt.random(r, StandardUniform_i32);
  expect(RngExt.random_range(r, new Range(SampleUniform_i32, 0, 1))).toBe(0);
  StandardUniform_u8.sample(r);
});

// crate: rand-0.10.1/src/rng.rs:559 test_gen_ratio_average
test("test_gen_ratio_average", () => {
  const NUM = 3;
  const DENOM = 10;
  const N = 100_000;

  let sum = 0;
  const r = rng(111n);
  for (let i = 0; i < N; i++) {
    if (RngExt.random_ratio(r, NUM, DENOM)) {
      sum += 1;
    }
  }
  // Have Binomial(N, NUM/DENOM) distribution
  const expected = (NUM * N) / DENOM; // exact integer
  expect(Math.abs(sum - expected) < 500).toBe(true);
});
