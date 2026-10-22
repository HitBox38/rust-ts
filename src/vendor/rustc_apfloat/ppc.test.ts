// Port of the unit test of rustc_apfloat =0.2.3+llvm-462a31f5a5ab `src/ppc.rs`.
import { expect, test } from "bun:test";
import { Double } from "./ieee.ts";
import { DoubleFloat } from "./ppc.ts";

const f64_buf = new DataView(new ArrayBuffer(8));

// HACK(eddyb) this is here instead of in `tests/ppc.rs` because `DoubleFloat`
// has private fields, and it's not worth it to make them public just for testing.
// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:456 is_integer
test("is_integer", () => {
  const double_from_f64 = (f: number) => {
    f64_buf.setFloat64(0, f);
    return Double.from_bits(f64_buf.getBigUint64(0));
  };
  expect(new DoubleFloat(double_from_f64(-0.0), double_from_f64(-0.0)).is_integer()).toBe(true);
  expect(!new DoubleFloat(double_from_f64(3.14159), double_from_f64(-0.0)).is_integer()).toBe(true);
  expect(!new DoubleFloat(double_from_f64(-0.0), double_from_f64(3.14159)).is_integer()).toBe(true);
});
