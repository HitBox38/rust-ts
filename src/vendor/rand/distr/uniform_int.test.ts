// Port of rand =0.10.1 `src/distr/uniform_int.rs` `#[cfg(test)] mod tests`.
import { expect, test } from "bun:test";
import { Unported } from "../../../std/panic.ts";
import { Err, unwrap_result, type Result } from "../../../std/result.ts";
import { RngExt } from "../rng.ts";
import { rng } from "../test_util.ts";
import { debug_Error, Error, Range, RangeInclusive, Uniform, type SampleUniform } from "./uniform.ts";
import {
  SampleUniform_i128,
  SampleUniform_i16,
  SampleUniform_i32,
  SampleUniform_i64,
  SampleUniform_i8,
  SampleUniform_u128,
  SampleUniform_u16,
  SampleUniform_u32,
  SampleUniform_u64,
  SampleUniform_u8,
  SampleUniform_usize,
  UniformInt,
  UniformUsize,
} from "./uniform_int.ts";

type Int = number | bigint;
const uw = <T>(r: Result<T, Error>): T => unwrap_result(r, debug_Error);

// crate: rand-0.10.1/src/distr/uniform_int.rs:591 test_uniform_bad_limits_equal_int
test("test_uniform_bad_limits_equal_int", () => {
  expect(Uniform.new(SampleUniform_i32, 10, 10)).toEqual(Err(Error.EmptyRange));
});

// crate: rand-0.10.1/src/distr/uniform_int.rs:596 test_uniform_good_limits_equal_int
test("test_uniform_good_limits_equal_int", () => {
  const r = rng(804n);
  const dist = uw(Uniform.new_inclusive(SampleUniform_i32, 10, 10));
  for (let i = 0; i < 20; i++) {
    expect(RngExt.sample(r, dist)).toBe(10);
  }
});

// crate: rand-0.10.1/src/distr/uniform_int.rs:605 test_uniform_bad_limits_flipped_int
test("test_uniform_bad_limits_flipped_int", () => {
  expect(Uniform.new(SampleUniform_i32, 10, 5)).toEqual(Err(Error.EmptyRange));
});

// crate: rand-0.10.1/src/distr/uniform_int.rs:611 test_integers
test("test_integers", () => {
  const r = rng(251n);
  // macro_rules! t (scalar bulk): `[(0, 10), (10, 127), ($ty::MIN, $ty::MAX)]`
  const t = <T extends Int>(X: SampleUniform<T>, v: [T, T][]) => {
    for (const [low, high] of v) {
      const check = (v: T, incl: boolean) => expect(low <= v && (incl ? v <= high : v < high)).toBe(true);
      let my_uniform = uw(Uniform.new(X, low, high));
      for (let i = 0; i < 1000; i++) check(RngExt.sample(r, my_uniform), false);

      my_uniform = uw(Uniform.new_inclusive(X, low, high));
      for (let i = 0; i < 1000; i++) check(RngExt.sample(r, my_uniform), true);

      my_uniform = uw(Uniform.new(X, low, high));
      for (let i = 0; i < 1000; i++) check(RngExt.sample(r, my_uniform), false);

      my_uniform = uw(Uniform.new_inclusive(X, low, high));
      for (let i = 0; i < 1000; i++) check(RngExt.sample(r, my_uniform), true);

      for (let i = 0; i < 1000; i++) check(uw(X.Sampler.sample_single(low, high, r)), false);

      for (let i = 0; i < 1000; i++) check(uw(X.Sampler.sample_single_inclusive(low, high, r)), true);
    }
  };
  const n = (min: number, max: number): [number, number][] => [
    [0, 10],
    [10, 127],
    [min, max],
  ];
  const b = (min: bigint, max: bigint): [bigint, bigint][] => [
    [0n, 10n],
    [10n, 127n],
    [min, max],
  ];
  t(SampleUniform_i8, n(-128, 127));
  t(SampleUniform_i16, n(-32768, 32767));
  t(SampleUniform_i32, n(-(2 ** 31), 2 ** 31 - 1));
  t(SampleUniform_i64, b(-(2n ** 63n), 2n ** 63n - 1n));
  t(SampleUniform_i128, b(-(2n ** 127n), 2n ** 127n - 1n));
  t(SampleUniform_u8, n(0, 255));
  t(SampleUniform_u16, n(0, 65535));
  t(SampleUniform_u32, n(0, 2 ** 32 - 1));
  t(SampleUniform_u64, b(0n, 2n ** 64n - 1n));
  // PORT: usize is `number`; `usize::MAX` has no exact `number`, so the full-range case is left out.
  t(SampleUniform_usize, [
    [0, 10],
    [10, 127],
  ]);
  t(SampleUniform_u128, b(0n, 2n ** 128n - 1n));
});

// crate: rand-0.10.1/src/distr/uniform_int.rs:692 test_uniform_from_std_range
test("test_uniform_from_std_range", () => {
  const r = uw(Uniform.try_from_Range(new Range(SampleUniform_u32, 2, 7)));
  expect((r._0 as UniformInt<number>).low).toBe(2);
  expect((r._0 as UniformInt<number>).range).toBe(5);
});

// crate: rand-0.10.1/src/distr/uniform_int.rs:699 test_uniform_from_std_range_bad_limits
test("test_uniform_from_std_range_bad_limits", () => {
  expect(Uniform.try_from_Range(new Range(SampleUniform_i32, 100, 10)).$).toBe("Err");
  expect(Uniform.try_from_Range(new Range(SampleUniform_i32, 100, 100)).$).toBe("Err");
});

// crate: rand-0.10.1/src/distr/uniform_int.rs:706 test_uniform_from_std_range_inclusive
test("test_uniform_from_std_range_inclusive", () => {
  const r = uw(Uniform.try_from_RangeInclusive(new RangeInclusive(SampleUniform_u32, 2, 6)));
  expect((r._0 as UniformInt<number>).low).toBe(2);
  expect((r._0 as UniformInt<number>).range).toBe(5);
});

// crate: rand-0.10.1/src/distr/uniform_int.rs:713 test_uniform_from_std_range_inclusive_bad_limits
test("test_uniform_from_std_range_inclusive_bad_limits", () => {
  expect(Uniform.try_from_RangeInclusive(new RangeInclusive(SampleUniform_i32, 100, 10)).$).toBe("Err");
  expect(Uniform.try_from_RangeInclusive(new RangeInclusive(SampleUniform_i32, 100, 99)).$).toBe("Err");
});

// crate: rand-0.10.1/src/distr/uniform_int.rs:720 value_stability
test("value_stability", () => {
  // crate: rand-0.10.1/src/distr/uniform_int.rs:721 test_samples
  function test_samples<T extends Int>(X: SampleUniform<T>, lb: T, ub: T, ub_excl: T, expected: T[]): void {
    let r = rng(897n);
    const buf: T[] = new Array<T>(6).fill(lb);

    for (let i = 0; i < 3; i++) buf[i] = uw(X.Sampler.sample_single_inclusive(lb, ub, r));
    let distr = uw(Uniform.new_inclusive(X, lb, ub));
    for (let i = 3; i < 6; i++) buf[i] = RngExt.sample(r, distr);
    expect(buf).toEqual(expected);

    r = rng(897n);

    for (let i = 0; i < 3; i++) buf[i] = uw(X.Sampler.sample_single(lb, ub_excl, r));
    distr = uw(Uniform.new(X, lb, ub_excl));
    for (let i = 3; i < 6; i++) buf[i] = RngExt.sample(r, distr);
    expect(buf).toEqual(expected);
  }

  test_samples(SampleUniform_i8, -105, 111, 112, [-99, -48, 107, 72, -19, 56]);
  test_samples(SampleUniform_i16, 2, 1352, 1353, [43, 361, 1325, 1109, 539, 1005]);
  test_samples(SampleUniform_i32, -313853, 13513, 13514, [-303803, -226673, 6912, -45605, -183505, -70668]);
  test_samples(SampleUniform_i64, 131521n, 6542165n, 6542166n, [1838724n, 5384489n, 4893692n, 3712948n, 3951509n, 4094926n]);
  test_samples(SampleUniform_i128, -(2n ** 127n), -1n, 0n, [
    -30725222750250982319765550926688025855n,
    -75088619368053423329503924805178012357n,
    -64950748766625548510467638647674468829n,
    -41794017901603587121582892414659436495n,
    -63623852319608406524605295913876414006n,
    -17404679390297612013597359206379189023n,
  ]);
  test_samples(SampleUniform_u8, 11, 218, 219, [17, 66, 214, 181, 93, 165]);
  test_samples(SampleUniform_u16, 11, 218, 219, [17, 66, 214, 181, 93, 165]);
  test_samples(SampleUniform_u32, 11, 218, 219, [17, 66, 214, 181, 93, 165]);
  test_samples(SampleUniform_u64, 11n, 218n, 219n, [66n, 181n, 165n, 127n, 134n, 139n]);
  test_samples(SampleUniform_u128, 11n, 218n, 219n, [181n, 127n, 139n, 167n, 141n, 197n]);
  test_samples(SampleUniform_usize, 11, 218, 219, [17, 66, 214, 181, 93, 165]);
});

// crate: rand-0.10.1/src/distr/uniform_int.rs:811 test_uniform_usize_empty_range
test("test_uniform_usize_empty_range", () => {
  expect(UniformUsize.new(10, 10)).toEqual(Err(Error.EmptyRange));
  expect(UniformUsize.new(10, 11).$).toBe("Ok");

  expect(UniformUsize.new_inclusive(10, 9)).toEqual(Err(Error.EmptyRange));
  expect(UniformUsize.new_inclusive(10, 10).$).toBe("Ok");
});

// crate: rand-0.10.1/src/distr/uniform_int.rs:820 test_uniform_usize_constructors
test("test_uniform_usize_constructors", () => {
  const U32_MAX = 0xffff_ffff;
  expect(uw(UniformUsize.new_inclusive(U32_MAX, U32_MAX))).toEqual(new UniformUsize(U32_MAX, 1, 0, false));
  expect(uw(UniformUsize.new_inclusive(0, U32_MAX))).toEqual(new UniformUsize(0, 0, 0, false));
  expect(uw(UniformUsize.new_inclusive(0, U32_MAX + 1))).toEqual(new UniformUsize(0, U32_MAX + 2, 1, true));
  // PORT: `new_inclusive(u32::MAX, u64::MAX as usize)` needs a usize above 2^53, which the port's `number` usize
  // does not hold: it is `unported`.
  expect(() => UniformUsize.new_inclusive(U32_MAX, 2 ** 64)).toThrow(Unported);
});

// crate-skip: rand-0.10.1/src/distr/uniform_int.rs:866 test_uniform_usize_deserialization cfg(feature = "serde"): off in Miri's rand
// crate-skip: rand-0.10.1/src/distr/uniform_int.rs:877 test_uniform_usize_deserialization_from_32bit cfg(feature = "serde"): off in Miri's rand
// crate-skip: rand-0.10.1/src/distr/uniform_int.rs:890 test_uniform_usize_deserialization_64bit cfg(feature = "serde"): off in Miri's rand
