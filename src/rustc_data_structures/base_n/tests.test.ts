// Port of compiler/rustc_data_structures/src/base_n/tests.rs.
import { expect, test } from "bun:test";
import { to_base, to_base_fixed_len, ToBaseN_u128 } from "../base_n.ts";

const U128_MAX = (1n << 128n) - 1n;
const U64_MAX = (1n << 64n) - 1n;
const U32_MAX = 0xffff_ffffn;

/** `uN::from_str_radix(s, radix)` for the digits `to_base` emits in bases up to 36. */
function from_str_radix(s: string, radix: number): bigint {
  let n = 0n;
  for (const c of s) n = n * BigInt(radix) + BigInt(parseInt(c, radix));
  return n;
}

// rustc: compiler/rustc_data_structures/src/base_n/tests.rs:4 limits
test("limits", () => {
  expect(from_str_radix(to_base(U128_MAX, 36).as_str(), 36)).toBe(U128_MAX);
  expect(from_str_radix(to_base(U64_MAX, 36).as_str(), 36)).toBe(U64_MAX);
  expect(from_str_radix(to_base(U32_MAX, 36).as_str(), 36)).toBe(U32_MAX);
});

// rustc: compiler/rustc_data_structures/src/base_n/tests.rs:11 test_to_base
test("test_to_base", () => {
  // rustc: compiler/rustc_data_structures/src/base_n/tests.rs:12 test
  function test_(n: bigint, base: number): void {
    expect(from_str_radix(to_base(n, base).as_str(), base)).toBe(n);
    expect(from_str_radix(to_base_fixed_len(n, base, ToBaseN_u128).as_str(), base)).toBe(n);
  }

  for (let base = 2; base < 37; base++) {
    test_(0n, base);
    test_(1n, base);
    test_(35n, base);
    test_(36n, base);
    test_(37n, base);
    test_(U64_MAX, base);
    test_(U128_MAX, base);

    const N = 1000n;

    for (let i = 0n; i < N; i++) {
      test_(i * 983n, base);
    }
  }
});

test("base 62 (v0 mangling)", () => {
  expect(to_base(0n, 62).as_str()).toBe("0");
  expect(to_base(61n, 62).as_str()).toBe("Z");
  expect(to_base(62n, 62).as_str()).toBe("10");
});
