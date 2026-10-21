// Port of the unit test of rustc_apfloat =0.2.3+llvm-462a31f5a5ab `src/ieee.rs` (`mod sig`'s `#[test]`).
import { expect, test } from "bun:test";
import { type Limb, type Loss, sig } from "./ieee.ts";
import type { ExpInt } from "./lib.ts";

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:3079 test_add_or_sub
test("test_add_or_sub", () => {
  // #[track_caller]
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ieee.rs:3081 run_test
  function run_test(
    subtract: boolean,
    lhs_sign: boolean,
    lhs_exponent: ExpInt,
    lhs_significand: Limb,
    rhs_sign: boolean,
    rhs_exponent: ExpInt,
    rhs_significand: Limb,
    expected_sign: boolean,
    expected_exponent: ExpInt,
    expected_significand: Limb,
    expected_loss: Loss,
  ): void {
    const lhs_sig = [lhs_significand];
    const lhs_exp = { value: lhs_exponent };
    const lhs_sgn = { value: lhs_sign };
    const loss = sig.add_or_sub(lhs_sig, lhs_exp, lhs_sgn, [rhs_significand], rhs_exponent, rhs_sign !== subtract);
    expect(loss).toBe(expected_loss);
    expect(lhs_sgn.value).toBe(expected_sign);
    expect(lhs_exp.value).toBe(expected_exponent);
    expect(lhs_sig[0]).toBe(expected_significand);
  }

  // Test cases are all combinations of:
  // {equal exponents, LHS larger exponent, RHS larger exponent}
  // {equal significands, LHS larger significand, RHS larger significand}
  // {no loss, loss}

  // Equal exponents (loss cannot occur as their is no shifting)
  run_test(true, false, 1, 0x10n, false, 1, 0x5n, false, 1, 0xbn, "ExactlyZero");
  run_test(false, false, -2, 0x20n, true, -2, 0x20n, false, -2, 0n, "ExactlyZero");
  run_test(false, true, 3, 0x20n, false, 3, 0x30n, false, 3, 0x10n, "ExactlyZero");

  // LHS larger exponent
  // LHS significand greater after shitfing
  run_test(true, false, 7, 0x100n, false, 3, 0x100n, false, 6, 0x1e0n, "ExactlyZero");
  run_test(true, false, 7, 0x100n, false, 3, 0x101n, false, 6, 0x1dfn, "MoreThanHalf");
  // Significands equal after shitfing
  run_test(true, false, 7, 0x100n, false, 3, 0x1000n, false, 6, 0n, "ExactlyZero");
  run_test(true, false, 7, 0x100n, false, 3, 0x1001n, true, 6, 0n, "LessThanHalf");
  // RHS significand greater after shitfing
  run_test(true, false, 7, 0x100n, false, 3, 0x10000n, true, 6, 0x1e00n, "ExactlyZero");
  run_test(true, false, 7, 0x100n, false, 3, 0x10001n, true, 6, 0x1e00n, "LessThanHalf");

  // RHS larger exponent
  // RHS significand greater after shitfing
  run_test(true, false, 3, 0x100n, false, 7, 0x100n, true, 6, 0x1e0n, "ExactlyZero");
  run_test(true, false, 3, 0x101n, false, 7, 0x100n, true, 6, 0x1dfn, "MoreThanHalf");
  // Significands equal after shitfing
  run_test(true, false, 3, 0x1000n, false, 7, 0x100n, false, 6, 0n, "ExactlyZero");
  run_test(true, false, 3, 0x1001n, false, 7, 0x100n, false, 6, 0n, "LessThanHalf");
  // LHS significand greater after shitfing
  run_test(true, false, 3, 0x10000n, false, 7, 0x100n, false, 6, 0x1e00n, "ExactlyZero");
  run_test(true, false, 3, 0x10001n, false, 7, 0x100n, false, 6, 0x1e00n, "LessThanHalf");
});
