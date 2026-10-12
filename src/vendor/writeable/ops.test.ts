// Port of writeable 0.6.4 `src/ops.rs` `mod tests`.
import { expect, test } from "bun:test";
import { LengthHint } from "./lib.ts";
import { add, add_assign, add_usize, add_assign_usize, bitor, bitor_assign, mul, mul_assign, sum, sum_usize } from "./ops.ts";

const eq = (a: LengthHint, b: LengthHint) => expect([a._0, a._1]).toEqual([b._0, b._1]);

// crate: writeable-0.6.4/src/ops.rs:130 test_add
test("test_add", () => {
  eq(add_usize(LengthHint.exact(3), 2), LengthHint.exact(5));
  eq(add(LengthHint.exact(3), LengthHint.exact(2)), LengthHint.exact(5));
  eq(add(LengthHint.exact(3), LengthHint.undefined()), LengthHint.at_least(3));

  eq(add_usize(LengthHint.undefined(), 2), LengthHint.at_least(2));
  eq(add(LengthHint.undefined(), LengthHint.exact(2)), LengthHint.at_least(2));
  eq(add(LengthHint.undefined(), LengthHint.undefined()), LengthHint.undefined());

  eq(add(LengthHint.at_least(15), LengthHint.exact(3)), LengthHint.at_least(18));

  eq(add(LengthHint.at_least(15), LengthHint.at_most(3)), LengthHint.at_least(15));

  eq(add_usize(LengthHint.between(48, 92), 5), LengthHint.between(53, 97));

  let len = LengthHint.exact(5);
  len = add_assign(len, LengthHint.exact(3));
  eq(len, LengthHint.exact(8));
  len = add_assign_usize(len, 2);
  eq(len, LengthHint.exact(10));
  len = add_assign(len, LengthHint.undefined());
  eq(len, LengthHint.at_least(10));

  len = add_assign(len, LengthHint.exact(3));
  eq(len, LengthHint.at_least(13));
  len = add_assign_usize(len, 2);
  eq(len, LengthHint.at_least(15));
  len = add_assign(len, LengthHint.undefined());
  eq(len, LengthHint.at_least(15));

  // PORT: `LengthHint::between(usize::MAX - 10, usize::MAX - 5) + LengthHint::exact(20)` is not
  // representable (usize::MAX - 10 rounds to 2^64 as a double); see ops.ts.
});

// crate: writeable-0.6.4/src/ops.rs:185 test_sum
test("test_sum", () => {
  eq(sum([LengthHint.exact(4), LengthHint.exact(1), LengthHint.exact(1)]), LengthHint.exact(6));
  eq(sum([LengthHint.exact(4), LengthHint.undefined(), LengthHint.at_least(1)]), LengthHint.at_least(5));
  eq(sum([LengthHint.exact(4), LengthHint.undefined(), LengthHint.at_most(1)]), LengthHint.at_least(4));
  eq(sum_usize([4, 1, 1]), LengthHint.exact(6));
});

// crate: writeable-0.6.4/src/ops.rs:224 test_mul
test("test_mul", () => {
  eq(mul(LengthHint.exact(3), 2), LengthHint.exact(6));
  eq(mul(LengthHint.undefined(), 2), LengthHint.undefined());
  eq(mul(LengthHint.between(48, 92), 2), LengthHint.between(96, 184));
  let len = LengthHint.exact(5);
  len = mul_assign(len, 2);
  eq(len, LengthHint.exact(10));
  // PORT: the `usize::MAX - 10` saturation case is not representable; see ops.ts.
});

// crate: writeable-0.6.4/src/ops.rs:245 test_bitor
test("test_bitor", () => {
  eq(bitor(LengthHint.exact(3), LengthHint.exact(2)), LengthHint.between(2, 3));
  eq(bitor(LengthHint.exact(3), LengthHint.undefined()), LengthHint.undefined());
  eq(bitor(LengthHint.undefined(), LengthHint.undefined()), LengthHint.undefined());
  eq(bitor(LengthHint.exact(10), LengthHint.exact(10)), LengthHint.exact(10));
  eq(bitor(LengthHint.at_least(15), LengthHint.exact(3)), LengthHint.at_least(3));
  eq(bitor(LengthHint.at_least(15), LengthHint.at_most(18)), LengthHint.undefined());
  eq(bitor(LengthHint.at_least(15), LengthHint.at_least(18)), LengthHint.at_least(15));
  eq(bitor(LengthHint.at_most(15), LengthHint.at_most(18)), LengthHint.at_most(18));
  eq(bitor(LengthHint.between(5, 10), LengthHint.at_most(3)), LengthHint.at_most(10));
  let len = LengthHint.exact(5);
  len = bitor_assign(len, LengthHint.exact(3));
  eq(len, LengthHint.between(5, 3));
});
