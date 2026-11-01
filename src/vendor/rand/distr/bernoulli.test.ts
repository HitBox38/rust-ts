// Port of rand =0.10.1 `src/distr/bernoulli.rs` `#[cfg(test)] mod test`.
import { expect, test } from "bun:test";
import { unwrap_result } from "../../../std/result.ts";
import { Bernoulli, Bernoulli_eq, debug_BernoulliError } from "./bernoulli.ts";
import { RngExt } from "../rng.ts";
import { rng } from "../test_util.ts";

// crate-skip: rand-0.10.1/src/distr/bernoulli.rs:172 test_serializing_deserializing_bernoulli cfg(feature = "serde"): off in Miri's rand

// crate: rand-0.10.1/src/distr/bernoulli.rs:181 test_trivial
test("test_trivial", () => {
  // We prefer to be explicit here.
  const r = rng(1n);
  const always_false = unwrap_result(Bernoulli.new(0.0), debug_BernoulliError);
  const always_true = unwrap_result(Bernoulli.new(1.0), debug_BernoulliError);
  for (let i = 0; i < 5; i++) {
    expect(RngExt.sample(r, always_false)).toBe(false);
    expect(RngExt.sample(r, always_true)).toBe(true);
    expect(always_false.sample(r)).toBe(false);
    expect(always_true.sample(r)).toBe(true);
  }
});

// crate: rand-0.10.1/src/distr/bernoulli.rs:198 test_average
test("test_average", () => {
  const P = 0.3;
  const NUM = 3;
  const DENOM = 10;
  const d1 = unwrap_result(Bernoulli.new(P), debug_BernoulliError);
  const d2 = unwrap_result(Bernoulli.from_ratio(NUM, DENOM), debug_BernoulliError);
  const N = 100_000;

  let sum1 = 0;
  let sum2 = 0;
  const r = rng(2n);
  for (let i = 0; i < N; i++) {
    if (d1.sample(r)) {
      sum1 += 1;
    }
    if (d2.sample(r)) {
      sum2 += 1;
    }
  }
  const avg1 = sum1 / N;
  expect(Math.abs(avg1 - P) < 5e-3).toBe(true);

  const avg2 = sum2 / N;
  expect(Math.abs(avg2 - NUM / DENOM) < 5e-3).toBe(true);
});

// crate: rand-0.10.1/src/distr/bernoulli.rs:225 value_stability
test("value_stability", () => {
  const r = rng(3n);
  const distr = unwrap_result(Bernoulli.new(0.4532), debug_BernoulliError);
  const buf = Array.from({ length: 10 }, () => RngExt.sample(r, distr));
  expect(buf).toEqual([true, false, false, true, false, false, true, true, true, true]);
});

// crate: rand-0.10.1/src/distr/bernoulli.rs:241 bernoulli_distributions_can_be_compared
test("bernoulli_distributions_can_be_compared", () => {
  const a = unwrap_result(Bernoulli.new(1.0), debug_BernoulliError);
  const b = unwrap_result(Bernoulli.new(1.0), debug_BernoulliError);
  expect(Bernoulli_eq(a, b)).toBe(true);
});
