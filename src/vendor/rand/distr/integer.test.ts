// Port of rand =0.10.1 `src/distr/integer.rs` `#[cfg(test)] mod tests`.
import { expect, test } from "bun:test";
import { RngExt } from "../rng.ts";
import { rng } from "../test_util.ts";
import type { Distribution } from "./distribution.ts";
import {
  StandardUniform_i128,
  StandardUniform_i16,
  StandardUniform_i32,
  StandardUniform_i64,
  StandardUniform_i8,
  StandardUniform_u128,
  StandardUniform_u16,
  StandardUniform_u32,
  StandardUniform_u64,
  StandardUniform_u8,
} from "./integer.ts";

// crate: rand-0.10.1/src/distr/integer.rs:181 test_integers
test("test_integers", () => {
  const r = rng(806n);

  RngExt.sample(r, StandardUniform_i8);
  RngExt.sample(r, StandardUniform_i16);
  RngExt.sample(r, StandardUniform_i32);
  RngExt.sample(r, StandardUniform_i64);
  RngExt.sample(r, StandardUniform_i128);

  RngExt.sample(r, StandardUniform_u8);
  RngExt.sample(r, StandardUniform_u16);
  RngExt.sample(r, StandardUniform_u32);
  RngExt.sample(r, StandardUniform_u64);
  RngExt.sample(r, StandardUniform_u128);
});

// crate-skip: rand-0.10.1/src/distr/integer.rs:199 x86_integers cfg(target_arch = "x86"/"x86_64") test of the x86 SIMD register impls (crate-skip)

// crate: rand-0.10.1/src/distr/integer.rs:209 value_stability
test("value_stability", () => {
  // crate: rand-0.10.1/src/distr/integer.rs:210 test_samples
  function test_samples<T>(StandardUniform: Distribution<T>, expected: T[]): void {
    const r = rng(807n);
    const buf = Array.from({ length: 3 }, () => RngExt.sample(r, StandardUniform));
    expect(buf).toEqual(expected);
  }

  test_samples(StandardUniform_u8, [9, 247, 111]);
  test_samples(StandardUniform_u16, [32265, 42999, 38255]);
  test_samples(StandardUniform_u32, [2220326409, 2575017975, 2018088303]);
  test_samples(StandardUniform_u64, [11059617991457472009n, 16096616328739788143n, 1487364411147516184n]);
  test_samples(StandardUniform_u128, [
    296930161868957086625409848350820761097n,
    145644820879247630242265036535529306392n,
    111087889832015897993126088499035356354n,
  ]);

  test_samples(StandardUniform_i8, [9, -9, 111]);
  // Skip further i* types: they are simple reinterpretation of u* samples
});
