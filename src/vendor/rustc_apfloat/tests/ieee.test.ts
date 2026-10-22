// Port of rustc_apfloat =0.2.3+llvm-462a31f5a5ab `tests/ieee.rs` (the crate's integration tests of the IEEE formats).
//
// PORT: conventions.
// - `assert!(c)` is `expect(c).toBe(true)`, `assert_eq!(a, b)` is `expect(a).toBe(b)` (`toEqual` for strings /
//   bigints is the same), `unpack!(status=, e)` is written out (`r = e; status = r.status; x = r.value`).
// - Host floats (`f32` / `f64`) are JS numbers: `from_f32` / `to_f32` go through the IEEE single bit pattern
//   (`Math.fround` values), `from_f64` / `to_f64` through the double bit pattern.
// - `for_each_float_type!` runs the body once per float type dictionary (`FLOAT_TYPES`).
//
import { expect, test } from "bun:test";
import {
  BFloat,
  Double,
  Float8E4M3FN,
  Float8E5M2,
  Half,
  type IeeeFloat,
  type IeeeFloatType,
  Quad,
  type Semantics,
  Single,
  X87DoubleExtended,
} from "../ieee.ts";
import {
  Category,
  type ExpInt,
  type Float,
  type FloatType,
  IEK_INF,
  IEK_NAN,
  IEK_ZERO,
  type Ordering,
  Round,
  Status,
  type StatusAnd,
} from "../lib.ts";
import { DoubleDouble } from "../ppc.ts";

export type { ExpInt, Ordering, StatusAnd };

type AnyFloat = IeeeFloat<Semantics>;
type AnyType = IeeeFloatType<Semantics>;

// FIXME(eddyb) maybe include this in `rustc_apfloat` itself?
// macro_rules! define_for_each_float_type / for_each_float_type: the float types, in upstream order.
const FLOAT_TYPES: readonly AnyType[] = [
  Half,
  Single,
  Double,
  Quad,

  BFloat,
  Float8E5M2,
  Float8E4M3FN,
  X87DoubleExtended,

  // NOTE(eddyb) tests for this are usually in `ppc.rs` but this works too.
  DoubleDouble,
] as unknown as AnyType[];
/** `for_each_float_type!(for<F: Float> e)` */
function for_each_float_type(e: <F extends Float<F>>(F: FloatType<F>) => void): void {
  for (const F of FLOAT_TYPES) e(F);
}

const f32_buf = new DataView(new ArrayBuffer(8));

// trait SingleExt
// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:39 from_f32
// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:44 from_f32
function from_f32(input: number): AnyFloat {
  f32_buf.setFloat32(0, input);
  return Single.from_bits(BigInt(f32_buf.getUint32(0))) as unknown as AnyFloat;
}
// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:40 to_f32
// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:48 to_f32
function single_to_f32(self: AnyFloat): number {
  f32_buf.setUint32(0, Number(self.to_bits()));
  return f32_buf.getFloat32(0);
}

// trait DoubleExt
// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:54 from_f64
// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:59 from_f64
function from_f64(input: number): AnyFloat {
  f32_buf.setFloat64(0, input);
  return Double.from_bits(f32_buf.getBigUint64(0)) as unknown as AnyFloat;
}
// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:55 to_f64
// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:63 to_f64
function double_to_f64(self: AnyFloat): number {
  f32_buf.setBigUint64(0, self.to_bits());
  return f32_buf.getFloat64(0);
}

// NOTE(eddyb) these match the C++ `convertToFloat`/`convertToDouble` methods,
// after their generalization to allow an optional lossless conversion to their
// expected semantics (from e.g. `IEEEhalf`/`BFloat`, for `convertToSingle`).
// FIXME(eddyb) should the methods have e.g. `_lossless_via_convert` in their names?
// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:72 assert_lossless_conversion
function assert_lossless_conversion(src: AnyFloat, T: AnyType): AnyFloat {
  const loses_info = { value: false };
  const r_ = src.convert(T, loses_info);
  const status = r_.status;
  const r = r_.value;
  expect(!Status.intersects(status, Status.INEXACT) && !loses_info.value).toBe(true); // "Unexpected imprecision"
  return r;
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:81 to_f32
/** `ToF32LosslessViaConvertToSingle::to_f32` (Half, BFloat, Float8E5M2, Float8E4M3FN); `Single` itself: `single_to_f32`. */
function to_f32(self: AnyFloat): number {
  return single_to_f32(assert_lossless_conversion(self, Single as unknown as AnyType));
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:91 to_f64
/** `ToF64LosslessViaConvertToDouble::to_f64` (Single and the `ToF32LosslessViaConvertToSingle` types); `Double`: `double_to_f64`. */
function to_f64(self: AnyFloat): number {
  return double_to_f64(assert_lossless_conversion(self, Double as unknown as AnyType));
}
void [from_f32, from_f64, to_f32, to_f64, for_each_float_type];

/** `"..".parse::<T>().unwrap()` */
function parse<F extends Float<F>>(T: FloatType<F>, s: string): F {
  const r = T.from_str(s);
  if (r.$ === "Err") throw new Error(`${JSON.stringify(s)}: called \`Result::unwrap()\` on an \`Err\` value: ParseError(${JSON.stringify(r._0._0)})`);
  return r._0;
}
const p = parse;
/** `"..".parse::<T>().unwrap_err().0` */
function parse_err<F extends Float<F>>(T: FloatType<F>, s: string): string {
  const r = T.from_str(s);
  if (r.$ === "Ok") throw new Error(`${JSON.stringify(s)}: called \`Result::unwrap_err()\` on an \`Ok\` value`);
  return r._0._0;
}
/** `assert_eq!(a, b)` on primitives (`==`: `0.0 == -0.0`, as Rust's float `PartialEq`). */
function aeq<X extends number | bigint | string | boolean>(a: X, b: X): void {
  expect(b === a ? a : b).toBe(a);
}
/** An `f32` literal. */
const f32 = Math.fround;
/** `assert_eq!` of host floats (`==`: `-0.0 == 0.0`, NaN never equal). */
function feq(a: number, b: number): void {
  expect(a === b).toBe(true);
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:100 is_signaling
test("is_signaling", () => {
  // We test qNaN, -qNaN, +sNaN, -sNaN with and without payloads.
  const payload = 4n;
  expect(!Single.qnan(undefined).is_signaling()).toBe(true);
  expect(!Single.qnan(undefined).neg().is_signaling()).toBe(true);
  expect(!Single.qnan(payload).is_signaling()).toBe(true);
  expect(!Single.qnan(payload).neg().is_signaling()).toBe(true);
  expect(Single.snan(undefined).is_signaling()).toBe(true);
  expect(Single.snan(undefined).neg().is_signaling()).toBe(true);
  expect(Single.snan(payload).is_signaling()).toBe(true);
  expect(Single.snan(payload).neg().is_signaling()).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:114 next
test("next", () => {
  // 1. Test Special Cases Values.
  //
  // Test all special values for nextUp and nextDown perscribed by IEEE-754R
  // 2008. These are:
  //   1. +inf
  //   2. -inf
  //   3. largest
  //   4. -largest
  //   5. smallest
  //   6. -smallest
  //   7. qNaN
  //   8. sNaN
  //   9. +0
  //   10. -0

  let status: Status;
  let r: StatusAnd<Quad>;
  let test: Quad;
  let expected: Quad;

  // nextUp(+inf) = +inf.
  r = Quad.INFINITY.next_up();
  status = r.status;
  test = r.value;
  expected = Quad.INFINITY;
  expect(status).toBe(Status.OK);
  expect(test.is_infinite()).toBe(true);
  expect(!test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(+inf) = -nextUp(-inf) = -(-largest) = largest
  r = Quad.INFINITY.next_down();
  status = r.status;
  test = r.value;
  expected = Quad.largest();
  expect(status).toBe(Status.OK);
  expect(!test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextUp(-inf) = -largest
  r = Quad.INFINITY.neg().next_up();
  status = r.status;
  test = r.value;
  expected = Quad.largest().neg();
  expect(status).toBe(Status.OK);
  expect(test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(-inf) = -nextUp(+inf) = -(+inf) = -inf.
  r = Quad.INFINITY.neg().next_down();
  status = r.status;
  test = r.value;
  expected = Quad.INFINITY.neg();
  expect(status).toBe(Status.OK);
  expect(test.is_infinite() && test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextUp(largest) = +inf
  r = Quad.largest().next_up();
  status = r.status;
  test = r.value;
  expected = Quad.INFINITY;
  expect(status).toBe(Status.OK);
  expect(test.is_infinite() && !test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(largest) = -nextUp(-largest)
  //                        = -(-largest + inc)
  //                        = largest - inc.
  r = Quad.largest().next_down();
  status = r.status;
  test = r.value;
  expected = p(Quad, "0x1.fffffffffffffffffffffffffffep+16383");
  expect(status).toBe(Status.OK);
  expect(!test.is_infinite() && !test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextUp(-largest) = -largest + inc.
  r = Quad.largest().neg().next_up();
  status = r.status;
  test = r.value;
  expected = p(Quad, "-0x1.fffffffffffffffffffffffffffep+16383");
  expect(status).toBe(Status.OK);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(-largest) = -nextUp(largest) = -(inf) = -inf.
  r = Quad.largest().neg().next_down();
  status = r.status;
  test = r.value;
  expected = Quad.INFINITY.neg();
  expect(status).toBe(Status.OK);
  expect(test.is_infinite() && test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextUp(smallest) = smallest + inc.
  r = p(Quad, "0x0.0000000000000000000000000001p-16382").next_up();
  status = r.status;
  test = r.value;
  expected = p(Quad, "0x0.0000000000000000000000000002p-16382");
  expect(status).toBe(Status.OK);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(smallest) = -nextUp(-smallest) = -(-0) = +0.
  r = p(Quad, "0x0.0000000000000000000000000001p-16382").next_down();
  status = r.status;
  test = r.value;
  expected = Quad.ZERO;
  expect(status).toBe(Status.OK);
  expect(test.is_pos_zero()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextUp(-smallest) = -0.
  r = p(Quad, "-0x0.0000000000000000000000000001p-16382").next_up();
  status = r.status;
  test = r.value;
  expected = Quad.ZERO.neg();
  expect(status).toBe(Status.OK);
  expect(test.is_neg_zero()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(-smallest) = -nextUp(smallest) = -smallest - inc.
  r = p(Quad, "-0x0.0000000000000000000000000001p-16382").next_down();
  status = r.status;
  test = r.value;
  expected = p(Quad, "-0x0.0000000000000000000000000002p-16382");
  expect(status).toBe(Status.OK);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextUp(qNaN) = qNaN
  r = Quad.qnan(undefined).next_up();
  status = r.status;
  test = r.value;
  expected = Quad.qnan(undefined);
  expect(status).toBe(Status.OK);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(qNaN) = qNaN
  r = Quad.qnan(undefined).next_down();
  status = r.status;
  test = r.value;
  expected = Quad.qnan(undefined);
  expect(status).toBe(Status.OK);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextUp(sNaN) = qNaN
  r = Quad.snan(undefined).next_up();
  status = r.status;
  test = r.value;
  expected = Quad.qnan(undefined);
  expect(status).toBe(Status.INVALID_OP);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(sNaN) = qNaN
  r = Quad.snan(undefined).next_down();
  status = r.status;
  test = r.value;
  expected = Quad.qnan(undefined);
  expect(status).toBe(Status.INVALID_OP);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextUp(+0) = +smallest
  r = Quad.ZERO.next_up();
  status = r.status;
  test = r.value;
  expected = Quad.SMALLEST;
  expect(status).toBe(Status.OK);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(+0) = -nextUp(-0) = -smallest
  r = Quad.ZERO.next_down();
  status = r.status;
  test = r.value;
  expected = Quad.SMALLEST.neg();
  expect(status).toBe(Status.OK);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextUp(-0) = +smallest
  r = Quad.ZERO.neg().next_up();
  status = r.status;
  test = r.value;
  expected = Quad.SMALLEST;
  expect(status).toBe(Status.OK);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(-0) = -nextUp(0) = -smallest
  r = Quad.ZERO.neg().next_down();
  status = r.status;
  test = r.value;
  expected = Quad.SMALLEST.neg();
  expect(status).toBe(Status.OK);
  expect(test.bitwise_eq(expected)).toBe(true);

  // 2. Binade Boundary Tests.

  // 2a. Test denormal <-> normal binade boundaries.
  //     * nextUp(+Largest Denormal) -> +Smallest Normal.
  //     * nextDown(-Largest Denormal) -> -Smallest Normal.
  //     * nextUp(-Smallest Normal) -> -Largest Denormal.
  //     * nextDown(+Smallest Normal) -> +Largest Denormal.

  // nextUp(+Largest Denormal) -> +Smallest Normal.
  r = p(Quad, "0x0.ffffffffffffffffffffffffffffp-16382").next_up();
  status = r.status;
  test = r.value;
  expected = p(Quad, "0x1.0000000000000000000000000000p-16382");
  expect(status).toBe(Status.OK);
  expect(!test.is_denormal()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(-Largest Denormal) -> -Smallest Normal.
  r = p(Quad, "-0x0.ffffffffffffffffffffffffffffp-16382").next_down();
  status = r.status;
  test = r.value;
  expected = p(Quad, "-0x1.0000000000000000000000000000p-16382");
  expect(status).toBe(Status.OK);
  expect(!test.is_denormal()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextUp(-Smallest Normal) -> -Largest Denormal.
  r = p(Quad, "-0x1.0000000000000000000000000000p-16382").next_up();
  status = r.status;
  test = r.value;
  expected = p(Quad, "-0x0.ffffffffffffffffffffffffffffp-16382");
  expect(status).toBe(Status.OK);
  expect(test.is_denormal()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(+Smallest Normal) -> +Largest Denormal.
  r = p(Quad, "+0x1.0000000000000000000000000000p-16382").next_down();
  status = r.status;
  test = r.value;
  expected = p(Quad, "+0x0.ffffffffffffffffffffffffffffp-16382");
  expect(status).toBe(Status.OK);
  expect(test.is_denormal()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // 2b. Test normal <-> normal binade boundaries.
  //     * nextUp(-Normal Binade Boundary) -> -Normal Binade Boundary + 1.
  //     * nextDown(+Normal Binade Boundary) -> +Normal Binade Boundary - 1.
  //     * nextUp(+Normal Binade Boundary - 1) -> +Normal Binade Boundary.
  //     * nextDown(-Normal Binade Boundary + 1) -> -Normal Binade Boundary.

  // nextUp(-Normal Binade Boundary) -> -Normal Binade Boundary + 1.
  r = p(Quad, "-0x1p+1").next_up();
  status = r.status;
  test = r.value;
  expected = p(Quad, "-0x1.ffffffffffffffffffffffffffffp+0");
  expect(status).toBe(Status.OK);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(+Normal Binade Boundary) -> +Normal Binade Boundary - 1.
  r = p(Quad, "0x1p+1").next_down();
  status = r.status;
  test = r.value;
  expected = p(Quad, "0x1.ffffffffffffffffffffffffffffp+0");
  expect(status).toBe(Status.OK);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextUp(+Normal Binade Boundary - 1) -> +Normal Binade Boundary.
  r = p(Quad, "0x1.ffffffffffffffffffffffffffffp+0").next_up();
  status = r.status;
  test = r.value;
  expected = p(Quad, "0x1p+1");
  expect(status).toBe(Status.OK);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(-Normal Binade Boundary + 1) -> -Normal Binade Boundary.
  r = p(Quad, "-0x1.ffffffffffffffffffffffffffffp+0").next_down();
  status = r.status;
  test = r.value;
  expected = p(Quad, "-0x1p+1");
  expect(status).toBe(Status.OK);
  expect(test.bitwise_eq(expected)).toBe(true);

  // 2c. Test using next at binade boundaries with a direction away from the
  // binade boundary. Away from denormal <-> normal boundaries.
  //
  // This is to make sure that even though we are at a binade boundary, since
  // we are rounding away, we do not trigger the binade boundary code. Thus we
  // test:
  //   * nextUp(-Largest Denormal) -> -Largest Denormal + inc.
  //   * nextDown(+Largest Denormal) -> +Largest Denormal - inc.
  //   * nextUp(+Smallest Normal) -> +Smallest Normal + inc.
  //   * nextDown(-Smallest Normal) -> -Smallest Normal - inc.

  // nextUp(-Largest Denormal) -> -Largest Denormal + inc.
  r = p(Quad, "-0x0.ffffffffffffffffffffffffffffp-16382").next_up();
  status = r.status;
  test = r.value;
  expected = p(Quad, "-0x0.fffffffffffffffffffffffffffep-16382");
  expect(status).toBe(Status.OK);
  expect(test.is_denormal()).toBe(true);
  expect(test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(+Largest Denormal) -> +Largest Denormal - inc.
  r = p(Quad, "0x0.ffffffffffffffffffffffffffffp-16382").next_down();
  status = r.status;
  test = r.value;
  expected = p(Quad, "0x0.fffffffffffffffffffffffffffep-16382");
  expect(status).toBe(Status.OK);
  expect(test.is_denormal()).toBe(true);
  expect(!test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextUp(+Smallest Normal) -> +Smallest Normal + inc.
  r = p(Quad, "0x1.0000000000000000000000000000p-16382").next_up();
  status = r.status;
  test = r.value;
  expected = p(Quad, "0x1.0000000000000000000000000001p-16382");
  expect(status).toBe(Status.OK);
  expect(!test.is_denormal()).toBe(true);
  expect(!test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(-Smallest Normal) -> -Smallest Normal - inc.
  r = p(Quad, "-0x1.0000000000000000000000000000p-16382").next_down();
  status = r.status;
  test = r.value;
  expected = p(Quad, "-0x1.0000000000000000000000000001p-16382");
  expect(status).toBe(Status.OK);
  expect(!test.is_denormal()).toBe(true);
  expect(test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // 2d. Test values which cause our exponent to go to min exponent. This
  // is to ensure that guards in the code to check for min exponent
  // trigger properly.
  //     * nextUp(-0x1p-16381) -> -0x1.ffffffffffffffffffffffffffffp-16382
  //     * nextDown(-0x1.ffffffffffffffffffffffffffffp-16382) ->
  //         -0x1p-16381
  //     * nextUp(0x1.ffffffffffffffffffffffffffffp-16382) -> 0x1p-16382
  //     * nextDown(0x1p-16382) -> 0x1.ffffffffffffffffffffffffffffp-16382

  // nextUp(-0x1p-16381) -> -0x1.ffffffffffffffffffffffffffffp-16382
  r = p(Quad, "-0x1p-16381").next_up();
  status = r.status;
  test = r.value;
  expected = p(Quad, "-0x1.ffffffffffffffffffffffffffffp-16382");
  expect(status).toBe(Status.OK);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(-0x1.ffffffffffffffffffffffffffffp-16382) ->
  //         -0x1p-16381
  r = p(Quad, "-0x1.ffffffffffffffffffffffffffffp-16382").next_down();
  status = r.status;
  test = r.value;
  expected = p(Quad, "-0x1p-16381");
  expect(status).toBe(Status.OK);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextUp(0x1.ffffffffffffffffffffffffffffp-16382) -> 0x1p-16381
  r = p(Quad, "0x1.ffffffffffffffffffffffffffffp-16382").next_up();
  status = r.status;
  test = r.value;
  expected = p(Quad, "0x1p-16381");
  expect(status).toBe(Status.OK);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(0x1p-16381) -> 0x1.ffffffffffffffffffffffffffffp-16382
  r = p(Quad, "0x1p-16381").next_down();
  status = r.status;
  test = r.value;
  expected = p(Quad, "0x1.ffffffffffffffffffffffffffffp-16382");
  expect(status).toBe(Status.OK);
  expect(test.bitwise_eq(expected)).toBe(true);

  // 3. Now we test both denormal/normal computation which will not cause us
  // to go across binade boundaries. Specifically we test:
  //   * nextUp(+Denormal) -> +Denormal.
  //   * nextDown(+Denormal) -> +Denormal.
  //   * nextUp(-Denormal) -> -Denormal.
  //   * nextDown(-Denormal) -> -Denormal.
  //   * nextUp(+Normal) -> +Normal.
  //   * nextDown(+Normal) -> +Normal.
  //   * nextUp(-Normal) -> -Normal.
  //   * nextDown(-Normal) -> -Normal.

  // nextUp(+Denormal) -> +Denormal.
  r = p(Quad, "0x0.ffffffffffffffffffffffff000cp-16382").next_up();
  status = r.status;
  test = r.value;
  expected = p(Quad, "0x0.ffffffffffffffffffffffff000dp-16382");
  expect(status).toBe(Status.OK);
  expect(test.is_denormal()).toBe(true);
  expect(!test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(+Denormal) -> +Denormal.
  r = p(Quad, "0x0.ffffffffffffffffffffffff000cp-16382").next_down();
  status = r.status;
  test = r.value;
  expected = p(Quad, "0x0.ffffffffffffffffffffffff000bp-16382");
  expect(status).toBe(Status.OK);
  expect(test.is_denormal()).toBe(true);
  expect(!test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextUp(-Denormal) -> -Denormal.
  r = p(Quad, "-0x0.ffffffffffffffffffffffff000cp-16382").next_up();
  status = r.status;
  test = r.value;
  expected = p(Quad, "-0x0.ffffffffffffffffffffffff000bp-16382");
  expect(status).toBe(Status.OK);
  expect(test.is_denormal()).toBe(true);
  expect(test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(-Denormal) -> -Denormal
  r = p(Quad, "-0x0.ffffffffffffffffffffffff000cp-16382").next_down();
  status = r.status;
  test = r.value;
  expected = p(Quad, "-0x0.ffffffffffffffffffffffff000dp-16382");
  expect(status).toBe(Status.OK);
  expect(test.is_denormal()).toBe(true);
  expect(test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextUp(+Normal) -> +Normal.
  r = p(Quad, "0x1.ffffffffffffffffffffffff000cp-16000").next_up();
  status = r.status;
  test = r.value;
  expected = p(Quad, "0x1.ffffffffffffffffffffffff000dp-16000");
  expect(status).toBe(Status.OK);
  expect(!test.is_denormal()).toBe(true);
  expect(!test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(+Normal) -> +Normal.
  r = p(Quad, "0x1.ffffffffffffffffffffffff000cp-16000").next_down();
  status = r.status;
  test = r.value;
  expected = p(Quad, "0x1.ffffffffffffffffffffffff000bp-16000");
  expect(status).toBe(Status.OK);
  expect(!test.is_denormal()).toBe(true);
  expect(!test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextUp(-Normal) -> -Normal.
  r = p(Quad, "-0x1.ffffffffffffffffffffffff000cp-16000").next_up();
  status = r.status;
  test = r.value;
  expected = p(Quad, "-0x1.ffffffffffffffffffffffff000bp-16000");
  expect(status).toBe(Status.OK);
  expect(!test.is_denormal()).toBe(true);
  expect(test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);

  // nextDown(-Normal) -> -Normal.
  r = p(Quad, "-0x1.ffffffffffffffffffffffff000cp-16000").next_down();
  status = r.status;
  test = r.value;
  expected = p(Quad, "-0x1.ffffffffffffffffffffffff000dp-16000");
  expect(status).toBe(Status.OK);
  expect(!test.is_denormal()).toBe(true);
  expect(test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:556 fma
test("fma", () => {
  {
    let f1 = from_f32(14.5);
    const f2 = from_f32(-14.5);
    const f3 = from_f32(225.0);
    f1 = f1.mul_add(f2, f3).value;
    feq(f32(14.75), single_to_f32(f1));
  }

  {
    const val2 = from_f32(2.0);
    let f1 = from_f32(1.17549435e-38);
    let f2 = from_f32(1.17549435e-38);
    f1 = f1.div_assign(val2);
    f2 = f2.div_assign(val2);
    const f3 = from_f32(12.0);
    f1 = f1.mul_add(f2, f3).value;
    feq(f32(12.0), single_to_f32(f1));
  }

  // Test for correct zero sign when answer is exactly zero.
  // fma(1.0, -1.0, 1.0) -> +ve 0.
  {
    let f1 = from_f64(1.0);
    const f2 = from_f64(-1.0);
    const f3 = from_f64(1.0);
    f1 = f1.mul_add(f2, f3).value;
    expect(!f1.is_negative() && f1.is_zero()).toBe(true);
  }

  // Test for correct zero sign when answer is exactly zero and rounding towards
  // negative.
  // fma(1.0, -1.0, 1.0) -> +ve 0.
  {
    let f1 = from_f64(1.0);
    const f2 = from_f64(-1.0);
    const f3 = from_f64(1.0);
    f1 = f1.mul_add_r(f2, f3, Round.TowardNegative).value;
    expect(f1.is_negative() && f1.is_zero()).toBe(true);
  }

  // Test for correct (in this case -ve) sign when adding like signed zeros.
  // Test fma(0.0, -0.0, -0.0) -> -ve 0.
  {
    let f1 = from_f64(0.0);
    const f2 = from_f64(-0.0);
    const f3 = from_f64(-0.0);
    f1 = f1.mul_add(f2, f3).value;
    expect(f1.is_negative() && f1.is_zero()).toBe(true);
  }

  // Test -ve sign preservation when small negative results underflow.
  {
    let f1 = p(Double, "-0x1p-1074");
    const f2 = p(Double, "+0x1p-1074");
    const f3 = from_f64(0.0) as unknown as typeof f1;
    f1 = f1.mul_add(f2, f3).value;
    expect(f1.is_negative() && f1.is_zero()).toBe(true);
  }

  // Test x87 extended precision case from http://llvm.org/PR20728.
  {
    let m1 = X87DoubleExtended.from_u128(1n).value;
    const m2 = X87DoubleExtended.from_u128(1n).value;
    const a = X87DoubleExtended.from_u128(3n).value;

    const loses_info = { value: false };
    m1 = m1.mul_add(m2, a).value;
    const r = m1.convert(Single, loses_info).value;
    expect(!loses_info.value).toBe(true);
    feq(f32(4.0), single_to_f32(r as unknown as AnyFloat));
  }

  // Regression test that failed an assertion.
  {
    let f1 = from_f32(-8.85242279e-41);
    const f2 = from_f32(2.0);
    const f3 = from_f32(8.85242279e-41);
    f1 = f1.mul_add(f2, f3).value;
    feq(f32(-8.85242279e-41), single_to_f32(f1));
  }

  // `sig::add_or_sub` can be considered to have 9 possible cases
  // when subtracting: all combinations of `Ordering::{Less, Greater, Equal} and
  // {no loss, loss from lhs, loss from rhs}. Test each reachable case here.

  // Regression test for failing the assertions in `sig::add_or_sub` and normalizing
  // the exponent even when the significand is zero if there is a lost fraction.
  // This tests `Ordering::Equal`, loss from lhs
  {
    let f1 = from_f32(-1.4728589e-38);
    const f2 = from_f32(3.7105144e-6);
    const f3 = from_f32(5.5e-44);
    f1 = f1.mul_add(f2, f3).value;
    feq(f32(-0.0), single_to_f32(f1));
  }

  // Test `Ordering::Greater`, no loss
  {
    let f1 = from_f32(2.0);
    const f2 = from_f32(2.0);
    const f3 = from_f32(-3.5);
    f1 = f1.mul_add(f2, f3).value;
    feq(f32(0.5), single_to_f32(f1));
  }

  // Test `Ordering::Less`, no loss
  {
    let f1 = from_f32(2.0);
    const f2 = from_f32(2.0);
    const f3 = from_f32(-4.5);
    f1 = f1.mul_add(f2, f3).value;
    feq(f32(-0.5), single_to_f32(f1));
  }

  // Test `Ordering::Equal`, no loss
  {
    let f1 = from_f32(2.0);
    const f2 = from_f32(2.0);
    const f3 = from_f32(-4.0);
    f1 = f1.mul_add(f2, f3).value;
    feq(f32(0.0), single_to_f32(f1));
  }

  // Test `Ordering::Less`, loss from lhs
  {
    let f1 = from_f32(2.0000002);
    const f2 = from_f32(2.0000002);
    const f3 = from_f32(-32.0);
    f1 = f1.mul_add(f2, f3).value;
    feq(f32(-27.999998), single_to_f32(f1));
  }

  // Test `Ordering::Greater`, loss from rhs
  {
    let f1 = from_f32(1e10);
    const f2 = from_f32(1e10);
    const f3 = from_f32(-2.0000002);
    f1 = f1.mul_add(f2, f3).value;
    feq(f32(1e20), single_to_f32(f1));
  }

  // Test `Ordering::Greater`, loss from lhs
  {
    let f1 = from_f32(1e-36);
    const f2 = from_f32(0.0019531252);
    const f3 = from_f32(-1e-45);
    f1 = f1.mul_add(f2, f3).value;
    feq(f32(1.953124e-39), single_to_f32(f1));
  }

  // `Ordering::{Equal, Less}` with loss from rhs can't occur for the usage in
  // `mul_add` as `mul_add_r` normalises the MSB of lhs to one bit below the top.

  // Test cases from llvm/llvm-project#104984
  {
    let f1 = from_f32(0.24999998);
    const f2 = from_f32(2.3509885e-38);
    const f3 = from_f32(-1e-45);
    f1 = f1.mul_add(f2, f3).value;
    feq(f32(5.87747e-39), single_to_f32(f1));
  }
  {
    let f1 = from_f32(4.4501477170144023e-308);
    const f2 = from_f32(0.24999999999999997);
    const f3 = from_f32(-8.475904604373977e-309);
    f1 = f1.mul_add(f2, f3).value;
    feq(f32(2.64946468816203e-309), single_to_f32(f1));
  }
  {
    let f1 = Half.from_bits(0x8fffn);
    const f2 = Half.from_bits(0x2bffn);
    const f3 = Half.from_bits(0x0172n);
    f1 = f1.mul_add(f2, f3).value;
    expect(f1.to_bits()).toBe(0x808en);
  }

  // Test using only a single instance of APFloat.
  {
    let f = from_f64(1.5);

    f = f.mul_add(f, f).value;
    feq(3.75, double_to_f64(f));
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:743 min_num
test("min_num", () => {
  const f1 = from_f64(1.0);
  const f2 = from_f64(2.0);
  const nan = Double.NAN as unknown as AnyFloat;

  feq(1.0, double_to_f64(f1.min(f2)));
  feq(1.0, double_to_f64(f2.min(f1)));
  feq(1.0, double_to_f64(f1.min(nan)));
  feq(1.0, double_to_f64(nan.min(f1)));
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:755 max_num
test("max_num", () => {
  const f1 = from_f64(1.0);
  const f2 = from_f64(2.0);
  const nan = Double.NAN as unknown as AnyFloat;

  feq(2.0, double_to_f64(f1.max(f2)));
  feq(2.0, double_to_f64(f2.max(f1)));
  feq(1.0, double_to_f64(f1.max(nan)));
  feq(1.0, double_to_f64(nan.max(f1)));
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:767 minimum
test("minimum", () => {
  const f1 = from_f64(1.0);
  const f2 = from_f64(2.0);
  const zp = from_f64(0.0);
  const zn = from_f64(-0.0);
  const nan = Double.NAN as unknown as AnyFloat;

  feq(1.0, double_to_f64(f1.minimum(f2)));
  feq(1.0, double_to_f64(f2.minimum(f1)));
  feq(-0.0, double_to_f64(zp.minimum(zn)));
  feq(-0.0, double_to_f64(zn.minimum(zp)));
  expect(Number.isNaN(double_to_f64(f1.minimum(nan)))).toBe(true);
  expect(Number.isNaN(double_to_f64(nan.minimum(f1)))).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:783 maximum
test("maximum", () => {
  const f1 = from_f64(1.0);
  const f2 = from_f64(2.0);
  const zp = from_f64(0.0);
  const zn = from_f64(-0.0);
  const nan = Double.NAN as unknown as AnyFloat;

  feq(2.0, double_to_f64(f1.maximum(f2)));
  feq(2.0, double_to_f64(f2.maximum(f1)));
  feq(0.0, double_to_f64(zp.maximum(zn)));
  feq(0.0, double_to_f64(zn.maximum(zp)));
  expect(Number.isNaN(double_to_f64(f1.maximum(nan)))).toBe(true);
  expect(Number.isNaN(double_to_f64(nan.maximum(f1)))).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:799 denormal
test("denormal", () => {
  // Test single precision
  {
    expect(!Single.from_u128(0n).value.is_denormal()).toBe(true);

    let t = p(Single, "1.17549435082228750797e-38");
    expect(!t.is_denormal()).toBe(true);

    t = t.div_assign(Single.from_u128(2n).value);
    expect(t.is_denormal()).toBe(true);
  }

  // Test double precision
  {
    expect(!Double.from_u128(0n).value.is_denormal()).toBe(true);

    let t = p(Double, "2.22507385850720138309e-308");
    expect(!t.is_denormal()).toBe(true);

    t = t.div_assign(Double.from_u128(2n).value);
    expect(t.is_denormal()).toBe(true);
  }

  // Test Intel double-ext
  {
    expect(!X87DoubleExtended.from_u128(0n).value.is_denormal()).toBe(true);

    let t = p(X87DoubleExtended, "3.36210314311209350626e-4932");
    expect(!t.is_denormal()).toBe(true);

    t = t.div_assign(X87DoubleExtended.from_u128(2n).value);
    expect(t.is_denormal()).toBe(true);
  }

  // Test quadruple precision
  {
    expect(!Quad.from_u128(0n).value.is_denormal()).toBe(true);

    let t = p(Quad, "3.36210314311209350626267781732175260e-4932");
    expect(!t.is_denormal()).toBe(true);

    t = t.div_assign(Quad.from_u128(2n).value);
    expect(t.is_denormal()).toBe(true);
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:846 is_smallest_normalized
test("is_smallest_normalized", () => {
  for_each_float_type(<F extends Float<F>>(F: FloatType<F>) => test_<F>(F));
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:848 test
  function test_<F extends Float<F>>(F: FloatType<F>): void {
    expect(!F.ZERO.is_smallest_normalized()).toBe(true);
    expect(!F.ZERO.neg().is_smallest_normalized()).toBe(true);

    expect(!F.INFINITY.is_smallest_normalized()).toBe(true);
    expect(!F.INFINITY.neg().is_smallest_normalized()).toBe(true);

    expect(!F.qnan(undefined).is_smallest_normalized()).toBe(true);
    expect(!F.snan(undefined).is_smallest_normalized()).toBe(true);

    expect(!F.largest().is_smallest_normalized()).toBe(true);
    expect(!F.largest().neg().is_smallest_normalized()).toBe(true);

    expect(!F.SMALLEST.is_smallest_normalized()).toBe(true);
    expect(!F.SMALLEST.neg().is_smallest_normalized()).toBe(true);

    expect(!F.from_bits(((1n << 128n) - 1n) >> BigInt(128 - F.BITS)).is_smallest_normalized()).toBe(true);

    const pos_smallest_normalized = F.smallest_normalized();
    const neg_smallest_normalized = F.smallest_normalized().neg();
    expect(pos_smallest_normalized.is_smallest_normalized()).toBe(true);
    expect(neg_smallest_normalized.is_smallest_normalized()).toBe(true);

    for (let val of [pos_smallest_normalized, neg_smallest_normalized]) {
      const old_sign = val.is_negative();

      let status: Status;
      let r: StatusAnd<F>;

      // Step down, make sure it's still not smallest normalized.
      r = val.next_down();
      status = r.status;
      val = r.value;
      expect(status).toBe(Status.OK);
      expect(val.is_negative()).toBe(old_sign);
      expect(!val.is_smallest_normalized()).toBe(true);
      expect(val.is_negative()).toBe(old_sign);

      // Step back up should restore it to being smallest normalized.
      r = val.next_up();
      status = r.status;
      val = r.value;
      expect(status).toBe(Status.OK);
      expect(val.is_smallest_normalized()).toBe(true);
      expect(val.is_negative()).toBe(old_sign);

      // Step beyond should no longer smallest normalized.
      r = val.next_up();
      status = r.status;
      val = r.value;
      expect(status).toBe(Status.OK);
      expect(!val.is_smallest_normalized()).toBe(true);
      expect(val.is_negative()).toBe(old_sign);
    }
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:899 decimal_strings_without_null_terminators
test("decimal_strings_without_null_terminators", () => {
  // Make sure that we can parse strings without null terminators.
  // rdar://14323230.
  feq(double_to_f64(p(Double, "0.00".slice(0, 3))), 0.0);
  feq(double_to_f64(p(Double, "0.01".slice(0, 3))), 0.0);
  feq(double_to_f64(p(Double, "0.09".slice(0, 3))), 0.0);
  feq(double_to_f64(p(Double, "0.095".slice(0, 4))), 0.09);
  feq(double_to_f64(p(Double, "0.00e+3".slice(0, 7))), 0.0);
  feq(double_to_f64(p(Double, "0e+3".slice(0, 4))), 0.0);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:911 from_zero_decimal_string
test("from_zero_decimal_string", () => {
  feq(0.0, double_to_f64(p(Double, "0")));
  feq(0.0, double_to_f64(p(Double, "+0")));
  feq(-0.0, double_to_f64(p(Double, "-0")));

  feq(0.0, double_to_f64(p(Double, "0.")));
  feq(0.0, double_to_f64(p(Double, "+0.")));
  feq(-0.0, double_to_f64(p(Double, "-0.")));

  feq(0.0, double_to_f64(p(Double, ".0")));
  feq(0.0, double_to_f64(p(Double, "+.0")));
  feq(-0.0, double_to_f64(p(Double, "-.0")));

  feq(0.0, double_to_f64(p(Double, "0.0")));
  feq(0.0, double_to_f64(p(Double, "+0.0")));
  feq(-0.0, double_to_f64(p(Double, "-0.0")));

  feq(0.0, double_to_f64(p(Double, "00000.")));
  feq(0.0, double_to_f64(p(Double, "+00000.")));
  feq(-0.0, double_to_f64(p(Double, "-00000.")));

  feq(0.0, double_to_f64(p(Double, ".00000")));
  feq(0.0, double_to_f64(p(Double, "+.00000")));
  feq(-0.0, double_to_f64(p(Double, "-.00000")));

  feq(0.0, double_to_f64(p(Double, "0000.00000")));
  feq(0.0, double_to_f64(p(Double, "+0000.00000")));
  feq(-0.0, double_to_f64(p(Double, "-0000.00000")));
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:942 from_zero_decimal_single_exponent_string
test("from_zero_decimal_single_exponent_string", () => {
  feq(0.0, double_to_f64(p(Double, "0e1")));
  feq(0.0, double_to_f64(p(Double, "+0e1")));
  feq(-0.0, double_to_f64(p(Double, "-0e1")));

  feq(0.0, double_to_f64(p(Double, "0e+1")));
  feq(0.0, double_to_f64(p(Double, "+0e+1")));
  feq(-0.0, double_to_f64(p(Double, "-0e+1")));

  feq(0.0, double_to_f64(p(Double, "0e-1")));
  feq(0.0, double_to_f64(p(Double, "+0e-1")));
  feq(-0.0, double_to_f64(p(Double, "-0e-1")));

  feq(0.0, double_to_f64(p(Double, "0.e1")));
  feq(0.0, double_to_f64(p(Double, "+0.e1")));
  feq(-0.0, double_to_f64(p(Double, "-0.e1")));

  feq(0.0, double_to_f64(p(Double, "0.e+1")));
  feq(0.0, double_to_f64(p(Double, "+0.e+1")));
  feq(-0.0, double_to_f64(p(Double, "-0.e+1")));

  feq(0.0, double_to_f64(p(Double, "0.e-1")));
  feq(0.0, double_to_f64(p(Double, "+0.e-1")));
  feq(-0.0, double_to_f64(p(Double, "-0.e-1")));

  feq(0.0, double_to_f64(p(Double, ".0e1")));
  feq(0.0, double_to_f64(p(Double, "+.0e1")));
  feq(-0.0, double_to_f64(p(Double, "-.0e1")));

  feq(0.0, double_to_f64(p(Double, ".0e+1")));
  feq(0.0, double_to_f64(p(Double, "+.0e+1")));
  feq(-0.0, double_to_f64(p(Double, "-.0e+1")));

  feq(0.0, double_to_f64(p(Double, ".0e-1")));
  feq(0.0, double_to_f64(p(Double, "+.0e-1")));
  feq(-0.0, double_to_f64(p(Double, "-.0e-1")));

  feq(0.0, double_to_f64(p(Double, "0.0e1")));
  feq(0.0, double_to_f64(p(Double, "+0.0e1")));
  feq(-0.0, double_to_f64(p(Double, "-0.0e1")));

  feq(0.0, double_to_f64(p(Double, "0.0e+1")));
  feq(0.0, double_to_f64(p(Double, "+0.0e+1")));
  feq(-0.0, double_to_f64(p(Double, "-0.0e+1")));

  feq(0.0, double_to_f64(p(Double, "0.0e-1")));
  feq(0.0, double_to_f64(p(Double, "+0.0e-1")));
  feq(-0.0, double_to_f64(p(Double, "-0.0e-1")));

  feq(0.0, double_to_f64(p(Double, "000.0000e1")));
  feq(0.0, double_to_f64(p(Double, "+000.0000e+1")));
  feq(-0.0, double_to_f64(p(Double, "-000.0000e+1")));
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:997 from_zero_decimal_large_exponent_string
test("from_zero_decimal_large_exponent_string", () => {
  feq(0.0, double_to_f64(p(Double, "0e1234")));
  feq(0.0, double_to_f64(p(Double, "+0e1234")));
  feq(-0.0, double_to_f64(p(Double, "-0e1234")));

  feq(0.0, double_to_f64(p(Double, "0e+1234")));
  feq(0.0, double_to_f64(p(Double, "+0e+1234")));
  feq(-0.0, double_to_f64(p(Double, "-0e+1234")));

  feq(0.0, double_to_f64(p(Double, "0e-1234")));
  feq(0.0, double_to_f64(p(Double, "+0e-1234")));
  feq(-0.0, double_to_f64(p(Double, "-0e-1234")));

  feq(0.0, double_to_f64(p(Double, "000.0000e1234")));
  feq(0.0, double_to_f64(p(Double, "000.0000e-1234")));
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1015 from_zero_hexadecimal_string
test("from_zero_hexadecimal_string", () => {
  feq(0.0, double_to_f64(p(Double, "0x0p1")));
  feq(0.0, double_to_f64(p(Double, "+0x0p1")));
  feq(-0.0, double_to_f64(p(Double, "-0x0p1")));

  feq(0.0, double_to_f64(p(Double, "0x0p+1")));
  feq(0.0, double_to_f64(p(Double, "+0x0p+1")));
  feq(-0.0, double_to_f64(p(Double, "-0x0p+1")));

  feq(0.0, double_to_f64(p(Double, "0x0p-1")));
  feq(0.0, double_to_f64(p(Double, "+0x0p-1")));
  feq(-0.0, double_to_f64(p(Double, "-0x0p-1")));

  feq(0.0, double_to_f64(p(Double, "0x0.p1")));
  feq(0.0, double_to_f64(p(Double, "+0x0.p1")));
  feq(-0.0, double_to_f64(p(Double, "-0x0.p1")));

  feq(0.0, double_to_f64(p(Double, "0x0.p+1")));
  feq(0.0, double_to_f64(p(Double, "+0x0.p+1")));
  feq(-0.0, double_to_f64(p(Double, "-0x0.p+1")));

  feq(0.0, double_to_f64(p(Double, "0x0.p-1")));
  feq(0.0, double_to_f64(p(Double, "+0x0.p-1")));
  feq(-0.0, double_to_f64(p(Double, "-0x0.p-1")));

  feq(0.0, double_to_f64(p(Double, "0x.0p1")));
  feq(0.0, double_to_f64(p(Double, "+0x.0p1")));
  feq(-0.0, double_to_f64(p(Double, "-0x.0p1")));

  feq(0.0, double_to_f64(p(Double, "0x.0p+1")));
  feq(0.0, double_to_f64(p(Double, "+0x.0p+1")));
  feq(-0.0, double_to_f64(p(Double, "-0x.0p+1")));

  feq(0.0, double_to_f64(p(Double, "0x.0p-1")));
  feq(0.0, double_to_f64(p(Double, "+0x.0p-1")));
  feq(-0.0, double_to_f64(p(Double, "-0x.0p-1")));

  feq(0.0, double_to_f64(p(Double, "0x0.0p1")));
  feq(0.0, double_to_f64(p(Double, "+0x0.0p1")));
  feq(-0.0, double_to_f64(p(Double, "-0x0.0p1")));

  feq(0.0, double_to_f64(p(Double, "0x0.0p+1")));
  feq(0.0, double_to_f64(p(Double, "+0x0.0p+1")));
  feq(-0.0, double_to_f64(p(Double, "-0x0.0p+1")));

  feq(0.0, double_to_f64(p(Double, "0x0.0p-1")));
  feq(0.0, double_to_f64(p(Double, "+0x0.0p-1")));
  feq(-0.0, double_to_f64(p(Double, "-0x0.0p-1")));

  feq(0.0, double_to_f64(p(Double, "0x00000.p1")));
  feq(0.0, double_to_f64(p(Double, "0x0000.00000p1")));
  feq(0.0, double_to_f64(p(Double, "0x.00000p1")));
  feq(0.0, double_to_f64(p(Double, "0x0.p1")));
  feq(0.0, double_to_f64(p(Double, "0x0p1234")));
  feq(-0.0, double_to_f64(p(Double, "-0x0p1234")));
  feq(0.0, double_to_f64(p(Double, "0x00000.p1234")));
  feq(0.0, double_to_f64(p(Double, "0x0000.00000p1234")));
  feq(0.0, double_to_f64(p(Double, "0x.00000p1234")));
  feq(0.0, double_to_f64(p(Double, "0x0.p1234")));
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1077 from_decimal_string
test("from_decimal_string", () => {
    aeq(1.0, double_to_f64(parse(Double, "1")));
    aeq(2.0, double_to_f64(parse(Double, "2.")));
    aeq(0.5, double_to_f64(parse(Double, ".5")));
    aeq(1.0, double_to_f64(parse(Double, "1.0")));
    aeq(-2.0, double_to_f64(parse(Double, "-2")));
    aeq(-4.0, double_to_f64(parse(Double, "-4.")));
    aeq(-0.5, double_to_f64(parse(Double, "-.5")));
    aeq(-1.5, double_to_f64(parse(Double, "-1.5")));
    aeq(1.25e12, double_to_f64(parse(Double, "1.25e12")));
    aeq(1.25e+12, double_to_f64(parse(Double, "1.25e+12")));
    aeq(1.25e-12, double_to_f64(parse(Double, "1.25e-12")));
    aeq(1024.0, double_to_f64(parse(Double, "1024.")));
    aeq(1024.05, double_to_f64(parse(Double, "1024.05000")));
    aeq(0.05, double_to_f64(parse(Double, ".05000")));
    aeq(2.0, double_to_f64(parse(Double, "2.")));
    aeq(2.0e2, double_to_f64(parse(Double, "2.e2")));
    aeq(2.0e+2, double_to_f64(parse(Double, "2.e+2")));
    aeq(2.0e-2, double_to_f64(parse(Double, "2.e-2")));
    aeq(2.05e2, double_to_f64(parse(Double, "002.05000e2")));
    aeq(2.05e+2, double_to_f64(parse(Double, "002.05000e+2")));
    aeq(2.05e-2, double_to_f64(parse(Double, "002.05000e-2")));
    aeq(2.05e12, double_to_f64(parse(Double, "002.05000e12")));
    aeq(2.05e+12, double_to_f64(parse(Double, "002.05000e+12")));
    aeq(2.05e-12, double_to_f64(parse(Double, "002.05000e-12")));

    aeq(1.0, double_to_f64(parse(Double, "1e")));
    aeq(1.0, double_to_f64(parse(Double, "+1e")));
    aeq(-1.0, double_to_f64(parse(Double, "-1e")));

    aeq(1.0, double_to_f64(parse(Double, "1.e")));
    aeq(1.0, double_to_f64(parse(Double, "+1.e")));
    aeq(-1.0, double_to_f64(parse(Double, "-1.e")));

    aeq(0.1, double_to_f64(parse(Double, ".1e")));
    aeq(0.1, double_to_f64(parse(Double, "+.1e")));
    aeq(-0.1, double_to_f64(parse(Double, "-.1e")));

    aeq(1.1, double_to_f64(parse(Double, "1.1e")));
    aeq(1.1, double_to_f64(parse(Double, "+1.1e")));
    aeq(-1.1, double_to_f64(parse(Double, "-1.1e")));

    aeq(1.0, double_to_f64(parse(Double, "1e+")));
    aeq(1.0, double_to_f64(parse(Double, "1e-")));

    aeq(0.1, double_to_f64(parse(Double, ".1e")));
    aeq(0.1, double_to_f64(parse(Double, ".1e+")));
    aeq(0.1, double_to_f64(parse(Double, ".1e-")));

    aeq(1.0, double_to_f64(parse(Double, "1.0e")));
    aeq(1.0, double_to_f64(parse(Double, "1.0e+")));
    aeq(1.0, double_to_f64(parse(Double, "1.0e-")));

    // These are "carefully selected" to overflow the fast log-base
    // calculations in the implementation.
    expect(parse(Double, "99e99999").is_infinite()).toBe(true);
    expect(parse(Double, "-99e99999").is_infinite()).toBe(true);
    expect(parse(Double, "1e-99999").is_pos_zero()).toBe(true);
    expect(parse(Double, "-1e-99999").is_neg_zero()).toBe(true);

    aeq(2.71828, double_to_f64(parse(Double, "2.71828")));
});


// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1141 from_string_specials
test("from_string_specials", () => {
  const precision = 53;
  const payload_bits = precision - 2;
  const payload_mask = (1n << BigInt(payload_bits)) - 1n;

  const nan_payloads: bigint[] = [
    0n,
    1n,
    123n,
    0xdeadbeefn,
    BigInt.asUintN(128, -2n), // -2i32 as u128
    1n << BigInt(payload_bits), // overflow bit
    1n << BigInt(payload_bits - 1), // signaling bit
    1n << BigInt(payload_bits - 2), // highest possible bit
  ];

  // Convert payload integer to decimal string representation.
  const nan_payload_dec_strings = nan_payloads.map((payload) => `${payload}`);

  // Convert payload integer to hexadecimal string representation.
  const nan_payload_hex_strings = nan_payloads.map((payload) => `0x${payload.toString(16)}`);

  // Fix payloads to expected result.
  for (let i = 0; i < nan_payloads.length; i++) {
    nan_payloads[i] = nan_payloads[i]! & payload_mask;
  }

  // Signaling NaN must have a non-zero payload. In case a zero payload is
  // requested, a default arbitrary payload is set instead. Save this payload
  // for testing.
  const snan_default_payload = Double.snan(undefined).to_bits() & payload_mask;

  // Negative sign prefix (or none - for positive).
  const signs = ["", "-"];

  // "Signaling" prefix (or none - for "Quiet").
  const nan_types = ["", "s", "S"];

  const nan_strings = ["nan", "NaN"];
  for (const nan_str of nan_strings) {
    for (const type_str of nan_types) {
      const signaling = type_str === "s" || type_str === "S";

      for (let j = 0; j < nan_payloads.length; j++) {
        const payload = signaling && nan_payloads[j] === 0n ? snan_default_payload : nan_payloads[j]!;
        const payload_dec = nan_payload_dec_strings[j]!;
        const payload_hex = nan_payload_hex_strings[j]!;

        for (const sign_str of signs) {
          const negative = sign_str === "-";

          const prefix = `${sign_str}${type_str}${nan_str}`;

          const test_strings = [
            // Test without any paylod.
            payload === 0n ? prefix : undefined,
            // Test with the payload as a suffix.
            `${prefix}${payload_dec}`,
            `${prefix}${payload_hex}`,
            // Test with the payload inside parentheses.
            `${prefix}(${payload_dec})`,
            `${prefix}(${payload_hex})`,
          ].filter((s) => s !== undefined);

          for (const test_str of test_strings) {
            const f = parse(Double, test_str);
            expect(f.is_nan()).toBe(true);
            aeq(signaling, f.is_signaling());
            aeq(negative, f.is_negative());
            aeq(payload, f.to_bits() & payload_mask);
          }
        }
      }
    }
  }

  const inf_strings = ["inf", "INFINITY", "+Inf", "-inf", "-INFINITY", "-Inf"];
  for (const inf_str of inf_strings) {
    const negative = inf_str.startsWith("-");

    const f = parse(Double, inf_str);
    expect(f.is_infinite()).toBe(true);
    aeq(negative, f.is_negative());
    aeq(0n, f.to_bits() & payload_mask);
  }
});


// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1238 from_to_string_specials
test("from_to_string_specials", () => {
    aeq("+Inf", parse(Double, "+Inf").fmt());
    aeq("+Inf", parse(Double, "INFINITY").fmt());
    aeq("+Inf", parse(Double, "inf").fmt());
    aeq("-Inf", parse(Double, "-Inf").fmt());
    aeq("-Inf", parse(Double, "-INFINITY").fmt());
    aeq("-Inf", parse(Double, "-inf").fmt());
    aeq("NaN", parse(Double, "NaN").fmt());
    aeq("NaN", parse(Double, "nan").fmt());
    aeq("NaN", parse(Double, "-NaN").fmt());
    aeq("NaN", parse(Double, "-nan").fmt());
});


// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1252 from_hexadecimal_string
test("from_hexadecimal_string", () => {
    aeq(1.0, double_to_f64(parse(Double, "0x1p0")));
    aeq(1.0, double_to_f64(parse(Double, "+0x1p0")));
    aeq(-1.0, double_to_f64(parse(Double, "-0x1p0")));

    aeq(1.0, double_to_f64(parse(Double, "0x1p+0")));
    aeq(1.0, double_to_f64(parse(Double, "+0x1p+0")));
    aeq(-1.0, double_to_f64(parse(Double, "-0x1p+0")));

    aeq(1.0, double_to_f64(parse(Double, "0x1p-0")));
    aeq(1.0, double_to_f64(parse(Double, "+0x1p-0")));
    aeq(-1.0, double_to_f64(parse(Double, "-0x1p-0")));

    aeq(2.0, double_to_f64(parse(Double, "0x1p1")));
    aeq(2.0, double_to_f64(parse(Double, "+0x1p1")));
    aeq(-2.0, double_to_f64(parse(Double, "-0x1p1")));

    aeq(2.0, double_to_f64(parse(Double, "0x1p+1")));
    aeq(2.0, double_to_f64(parse(Double, "+0x1p+1")));
    aeq(-2.0, double_to_f64(parse(Double, "-0x1p+1")));

    aeq(0.5, double_to_f64(parse(Double, "0x1p-1")));
    aeq(0.5, double_to_f64(parse(Double, "+0x1p-1")));
    aeq(-0.5, double_to_f64(parse(Double, "-0x1p-1")));

    aeq(3.0, double_to_f64(parse(Double, "0x1.8p1")));
    aeq(3.0, double_to_f64(parse(Double, "+0x1.8p1")));
    aeq(-3.0, double_to_f64(parse(Double, "-0x1.8p1")));

    aeq(3.0, double_to_f64(parse(Double, "0x1.8p+1")));
    aeq(3.0, double_to_f64(parse(Double, "+0x1.8p+1")));
    aeq(-3.0, double_to_f64(parse(Double, "-0x1.8p+1")));

    aeq(0.75, double_to_f64(parse(Double, "0x1.8p-1")));
    aeq(0.75, double_to_f64(parse(Double, "+0x1.8p-1")));
    aeq(-0.75, double_to_f64(parse(Double, "-0x1.8p-1")));

    aeq(8192.0, double_to_f64(parse(Double, "0x1000.000p1")));
    aeq(8192.0, double_to_f64(parse(Double, "+0x1000.000p1")));
    aeq(-8192.0, double_to_f64(parse(Double, "-0x1000.000p1")));

    aeq(8192.0, double_to_f64(parse(Double, "0x1000.000p+1")));
    aeq(8192.0, double_to_f64(parse(Double, "+0x1000.000p+1")));
    aeq(-8192.0, double_to_f64(parse(Double, "-0x1000.000p+1")));

    aeq(2048.0, double_to_f64(parse(Double, "0x1000.000p-1")));
    aeq(2048.0, double_to_f64(parse(Double, "+0x1000.000p-1")));
    aeq(-2048.0, double_to_f64(parse(Double, "-0x1000.000p-1")));

    aeq(8192.0, double_to_f64(parse(Double, "0x1000p1")));
    aeq(8192.0, double_to_f64(parse(Double, "+0x1000p1")));
    aeq(-8192.0, double_to_f64(parse(Double, "-0x1000p1")));

    aeq(8192.0, double_to_f64(parse(Double, "0x1000p+1")));
    aeq(8192.0, double_to_f64(parse(Double, "+0x1000p+1")));
    aeq(-8192.0, double_to_f64(parse(Double, "-0x1000p+1")));

    aeq(2048.0, double_to_f64(parse(Double, "0x1000p-1")));
    aeq(2048.0, double_to_f64(parse(Double, "+0x1000p-1")));
    aeq(-2048.0, double_to_f64(parse(Double, "-0x1000p-1")));

    aeq(16384.0, double_to_f64(parse(Double, "0x10p10")));
    aeq(16384.0, double_to_f64(parse(Double, "+0x10p10")));
    aeq(-16384.0, double_to_f64(parse(Double, "-0x10p10")));

    aeq(16384.0, double_to_f64(parse(Double, "0x10p+10")));
    aeq(16384.0, double_to_f64(parse(Double, "+0x10p+10")));
    aeq(-16384.0, double_to_f64(parse(Double, "-0x10p+10")));

    aeq(0.015625, double_to_f64(parse(Double, "0x10p-10")));
    aeq(0.015625, double_to_f64(parse(Double, "+0x10p-10")));
    aeq(-0.015625, double_to_f64(parse(Double, "-0x10p-10")));

    aeq(1.0625, double_to_f64(parse(Double, "0x1.1p0")));
    aeq(1.0, double_to_f64(parse(Double, "0x1p0")));

    aeq(
        double_to_f64(parse(Double, "0x1p-150")),
        double_to_f64(parse(Double, "+0x800000000000000001.p-221")),
    );
    aeq(2251799813685248.5, double_to_f64(parse(Double, "0x80000000000004000000.010p-28")));
});


// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1336 to_string
test("to_string", () => {
  let to_string = (d: number, precision: number, width: number): string => {
    const x = from_f64(d);
    if (precision === 0) {
      return x.fmt({ width }); // format!("{:1$}", x, width)
    } else {
      return x.fmt({ width, precision }); // format!("{:2$.1$}", x, precision, width)
    }
  };
  aeq("10", to_string(10.0, 6, 3));
  aeq("1.0E+1", to_string(10.0, 6, 0));
  aeq("10100", to_string(1.01e4, 5, 2));
  aeq("1.01E+4", to_string(1.01e4, 4, 2));
  aeq("1.01E+4", to_string(1.01e4, 5, 1));
  aeq("0.0101", to_string(1.01e-2, 5, 2));
  aeq("0.0101", to_string(1.01e-2, 4, 2));
  aeq("1.01E-2", to_string(1.01e-2, 5, 1));
  aeq("0.78539816339744828", to_string(0.78539816339744830961, 0, 3));
  aeq("4.9406564584124654E-324", to_string(4.9406564584124654e-324, 0, 3));
  aeq("873.18340000000001", to_string(873.1834, 0, 1));
  aeq("8.7318340000000001E+2", to_string(873.1834, 0, 0));
  aeq("1.7976931348623157E+308", to_string(1.7976931348623157e308, 0, 0));

  to_string = (d: number, precision: number, width: number): string => {
    const x = from_f64(d);
    if (precision === 0) {
      return x.fmt({ width, alternate: true }); // format!("{:#1$}", x, width)
    } else {
      return x.fmt({ width, precision, alternate: true }); // format!("{:#2$.1$}", x, precision, width)
    }
  };
  aeq("10", to_string(10.0, 6, 3));
  aeq("1.000000e+01", to_string(10.0, 6, 0));
  aeq("10100", to_string(1.01e4, 5, 2));
  aeq("1.0100e+04", to_string(1.01e4, 4, 2));
  aeq("1.01000e+04", to_string(1.01e4, 5, 1));
  aeq("0.0101", to_string(1.01e-2, 5, 2));
  aeq("0.0101", to_string(1.01e-2, 4, 2));
  aeq("1.01000e-02", to_string(1.01e-2, 5, 1));
  aeq("0.78539816339744828", to_string(0.78539816339744830961, 0, 3));
  aeq("4.94065645841246540e-324", to_string(4.9406564584124654e-324, 0, 3));
  aeq("873.18340000000001", to_string(873.1834, 0, 1));
  aeq("8.73183400000000010e+02", to_string(873.1834, 0, 0));
  aeq("1.79769313486231570e+308", to_string(1.7976931348623157e308, 0, 0));
  aeq("NaN", X87DoubleExtended.from_bits(1n << 64n).fmt());
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1384 to_integer
test("to_integer", () => {
  const is_exact = { value: false };
  const sa_eq = (a: StatusAnd<bigint>, b: StatusAnd<bigint>) => {
    aeq(a.status, b.status);
    aeq(a.value, b.value);
  };

  sa_eq(Status.and(Status.OK, 10n), parse(Double, "10").to_u128_r(5, Round.TowardZero, is_exact));
  expect(is_exact.value).toBe(true);

  sa_eq(Status.and(Status.INVALID_OP, 0n), parse(Double, "-10").to_u128_r(5, Round.TowardZero, is_exact));
  expect(!is_exact.value).toBe(true);

  sa_eq(Status.and(Status.INVALID_OP, 31n), parse(Double, "32").to_u128_r(5, Round.TowardZero, is_exact));
  expect(!is_exact.value).toBe(true);

  sa_eq(Status.and(Status.INEXACT, 7n), parse(Double, "7.9").to_u128_r(5, Round.TowardZero, is_exact));
  expect(!is_exact.value).toBe(true);

  sa_eq(Status.and(Status.OK, -10n), parse(Double, "-10").to_i128_r(5, Round.TowardZero, is_exact));
  expect(is_exact.value).toBe(true);

  sa_eq(Status.and(Status.INVALID_OP, -16n), parse(Double, "-17").to_i128_r(5, Round.TowardZero, is_exact));
  expect(!is_exact.value).toBe(true);

  sa_eq(Status.and(Status.INVALID_OP, 15n), parse(Double, "16").to_i128_r(5, Round.TowardZero, is_exact));
  expect(!is_exact.value).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1449 nan
test("nan", () => {
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1450 nanbits_from_u128
  function nanbits_from_u128<F extends Float<F>>(F: FloatType<F>, signaling: boolean, negative: boolean, payload: bigint): bigint {
    const x = signaling ? F.snan(payload) : F.qnan(payload);
    if (negative) {
      return x.neg().to_bits();
    } else {
      return x.to_bits();
    }
  }

  const tests_single: [bigint, boolean, boolean, bigint][] = [
    // expected   SNaN    Neg     payload
    [0x7fc00000n, false, false, 0x00000000n],
    [0xffc00000n, false, true, 0x00000000n],
    [0x7fc0ae72n, false, false, 0x0000ae72n],
    [0x7fffae72n, false, false, 0xffffae72n],
    [0x7fdaae72n, false, false, 0x00daae72n],
    [0x7fa00000n, true, false, 0x00000000n],
    [0xffa00000n, true, true, 0x00000000n],
    [0x7f80ae72n, true, false, 0x0000ae72n],
    [0x7fbfae72n, true, false, 0xffffae72n],
    [0x7f9aae72n, true, false, 0x001aae72n],
  ];
  const tests_double: [bigint, boolean, boolean, bigint][] = [
    //         expected   SNaN    Neg             payload
    [0x7ff8000000000000n, false, false, 0x0000000000000000n],
    [0xfff8000000000000n, false, true, 0x0000000000000000n],
    [0x7ff800000000ae72n, false, false, 0x000000000000ae72n],
    [0x7fffffffffffae72n, false, false, 0xffffffffffffae72n],
    [0x7ffdaaaaaaaaae72n, false, false, 0x000daaaaaaaaae72n],
    [0x7ff4000000000000n, true, false, 0x0000000000000000n],
    [0xfff4000000000000n, true, true, 0x0000000000000000n],
    [0x7ff000000000ae72n, true, false, 0x000000000000ae72n],
    [0x7ff7ffffffffae72n, true, false, 0xffffffffffffae72n],
    [0x7ff1aaaaaaaaae72n, true, false, 0x0001aaaaaaaaae72n],
  ];
  for (const [expected, signaling, negative, payload] of tests_single) {
    aeq(expected, nanbits_from_u128(Single, signaling, negative, payload));
  }
  for (const [expected, signaling, negative, payload] of tests_double) {
    aeq(expected, nanbits_from_u128(Double, signaling, negative, payload));
  }
});


// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1498 string_decimal_error
test("string_decimal_error", () => {
    aeq("Invalid string length", parse_err(Double, ""));
    aeq("String has no digits", parse_err(Double, "+"));
    aeq("String has no digits", parse_err(Double, "-"));

    aeq("Invalid character in significand", parse_err(Double, "\x00"));
    aeq("Invalid character in significand", parse_err(Double, "1\x00"));
    aeq("Invalid character in significand", parse_err(Double, "1\x002"));
    aeq("Invalid character in significand", parse_err(Double, "1\x002e1"));
    aeq("Invalid character in exponent", parse_err(Double, "1e\x00"));
    aeq("Invalid character in exponent", parse_err(Double, "1e1\x00"));
    aeq("Invalid character in exponent", parse_err(Double, "1e1\x002"));

    aeq("Invalid character in significand", parse_err(Double, "1.0f"));

    aeq("String contains multiple dots", parse_err(Double, ".."));
    aeq("String contains multiple dots", parse_err(Double, "..0"));
    aeq("String contains multiple dots", parse_err(Double, "1.0.0"));
});


// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1519 string_decimal_significand_error
test("string_decimal_significand_error", () => {
    aeq("Significand has no digits", parse_err(Double, "."));
    aeq("Significand has no digits", parse_err(Double, "+."));
    aeq("Significand has no digits", parse_err(Double, "-."));

    aeq("Significand has no digits", parse_err(Double, "e"));
    aeq("Significand has no digits", parse_err(Double, "+e"));
    aeq("Significand has no digits", parse_err(Double, "-e"));

    aeq("Significand has no digits", parse_err(Double, "e1"));
    aeq("Significand has no digits", parse_err(Double, "+e1"));
    aeq("Significand has no digits", parse_err(Double, "-e1"));

    aeq("Significand has no digits", parse_err(Double, ".e1"));
    aeq("Significand has no digits", parse_err(Double, "+.e1"));
    aeq("Significand has no digits", parse_err(Double, "-.e1"));

    aeq("Significand has no digits", parse_err(Double, ".e"));
    aeq("Significand has no digits", parse_err(Double, "+.e"));
    aeq("Significand has no digits", parse_err(Double, "-.e"));
});


// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1542 string_hexadecimal_error
test("string_hexadecimal_error", () => {
    aeq("Invalid string", parse_err(Double, "0x"));
    aeq("Invalid string", parse_err(Double, "+0x"));
    aeq("Invalid string", parse_err(Double, "-0x"));

    aeq("Hex strings require an exponent", parse_err(Double, "0x0"));
    aeq("Hex strings require an exponent", parse_err(Double, "+0x0"));
    aeq("Hex strings require an exponent", parse_err(Double, "-0x0"));

    aeq("Hex strings require an exponent", parse_err(Double, "0x0."));
    aeq("Hex strings require an exponent", parse_err(Double, "+0x0."));
    aeq("Hex strings require an exponent", parse_err(Double, "-0x0."));

    aeq("Hex strings require an exponent", parse_err(Double, "0x.0"));
    aeq("Hex strings require an exponent", parse_err(Double, "+0x.0"));
    aeq("Hex strings require an exponent", parse_err(Double, "-0x.0"));

    aeq("Hex strings require an exponent", parse_err(Double, "0x0.0"));
    aeq("Hex strings require an exponent", parse_err(Double, "+0x0.0"));
    aeq("Hex strings require an exponent", parse_err(Double, "-0x0.0"));

    aeq("Invalid character in significand", parse_err(Double, "0x\x00"));
    aeq("Invalid character in significand", parse_err(Double, "0x1\x00"));
    aeq("Invalid character in significand", parse_err(Double, "0x1\x002"));
    aeq("Invalid character in significand", parse_err(Double, "0x1\x002p1"));
    aeq("Invalid character in exponent", parse_err(Double, "0x1p\x00"));
    aeq("Invalid character in exponent", parse_err(Double, "0x1p1\x00"));
    aeq("Invalid character in exponent", parse_err(Double, "0x1p1\x002"));

    aeq("Invalid character in exponent", parse_err(Double, "0x1p0f"));

    aeq("String contains multiple dots", parse_err(Double, "0x..p1"));
    aeq("String contains multiple dots", parse_err(Double, "0x..0p1"));
    aeq("String contains multiple dots", parse_err(Double, "0x1.0.0p1"));
});


// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1579 string_hexadecimal_significand_error
test("string_hexadecimal_significand_error", () => {
    aeq("Significand has no digits", parse_err(Double, "0x."));
    aeq("Significand has no digits", parse_err(Double, "+0x."));
    aeq("Significand has no digits", parse_err(Double, "-0x."));

    aeq("Significand has no digits", parse_err(Double, "0xp"));
    aeq("Significand has no digits", parse_err(Double, "+0xp"));
    aeq("Significand has no digits", parse_err(Double, "-0xp"));

    aeq("Significand has no digits", parse_err(Double, "0xp+"));
    aeq("Significand has no digits", parse_err(Double, "+0xp+"));
    aeq("Significand has no digits", parse_err(Double, "-0xp+"));

    aeq("Significand has no digits", parse_err(Double, "0xp-"));
    aeq("Significand has no digits", parse_err(Double, "+0xp-"));
    aeq("Significand has no digits", parse_err(Double, "-0xp-"));

    aeq("Significand has no digits", parse_err(Double, "0x.p"));
    aeq("Significand has no digits", parse_err(Double, "+0x.p"));
    aeq("Significand has no digits", parse_err(Double, "-0x.p"));

    aeq("Significand has no digits", parse_err(Double, "0x.p+"));
    aeq("Significand has no digits", parse_err(Double, "+0x.p+"));
    aeq("Significand has no digits", parse_err(Double, "-0x.p+"));

    aeq("Significand has no digits", parse_err(Double, "0x.p-"));
    aeq("Significand has no digits", parse_err(Double, "+0x.p-"));
    aeq("Significand has no digits", parse_err(Double, "-0x.p-"));
});


// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1610 string_hexadecimal_exponent_error
test("string_hexadecimal_exponent_error", () => {
    aeq("Exponent has no digits", parse_err(Double, "0x1p"));
    aeq("Exponent has no digits", parse_err(Double, "+0x1p"));
    aeq("Exponent has no digits", parse_err(Double, "-0x1p"));

    aeq("Exponent has no digits", parse_err(Double, "0x1p+"));
    aeq("Exponent has no digits", parse_err(Double, "+0x1p+"));
    aeq("Exponent has no digits", parse_err(Double, "-0x1p+"));

    aeq("Exponent has no digits", parse_err(Double, "0x1p-"));
    aeq("Exponent has no digits", parse_err(Double, "+0x1p-"));
    aeq("Exponent has no digits", parse_err(Double, "-0x1p-"));

    aeq("Exponent has no digits", parse_err(Double, "0x1.p"));
    aeq("Exponent has no digits", parse_err(Double, "+0x1.p"));
    aeq("Exponent has no digits", parse_err(Double, "-0x1.p"));

    aeq("Exponent has no digits", parse_err(Double, "0x1.p+"));
    aeq("Exponent has no digits", parse_err(Double, "+0x1.p+"));
    aeq("Exponent has no digits", parse_err(Double, "-0x1.p+"));

    aeq("Exponent has no digits", parse_err(Double, "0x1.p-"));
    aeq("Exponent has no digits", parse_err(Double, "+0x1.p-"));
    aeq("Exponent has no digits", parse_err(Double, "-0x1.p-"));

    aeq("Exponent has no digits", parse_err(Double, "0x.1p"));
    aeq("Exponent has no digits", parse_err(Double, "+0x.1p"));
    aeq("Exponent has no digits", parse_err(Double, "-0x.1p"));

    aeq("Exponent has no digits", parse_err(Double, "0x.1p+"));
    aeq("Exponent has no digits", parse_err(Double, "+0x.1p+"));
    aeq("Exponent has no digits", parse_err(Double, "-0x.1p+"));

    aeq("Exponent has no digits", parse_err(Double, "0x.1p-"));
    aeq("Exponent has no digits", parse_err(Double, "+0x.1p-"));
    aeq("Exponent has no digits", parse_err(Double, "-0x.1p-"));

    aeq("Exponent has no digits", parse_err(Double, "0x1.1p"));
    aeq("Exponent has no digits", parse_err(Double, "+0x1.1p"));
    aeq("Exponent has no digits", parse_err(Double, "-0x1.1p"));

    aeq("Exponent has no digits", parse_err(Double, "0x1.1p+"));
    aeq("Exponent has no digits", parse_err(Double, "+0x1.1p+"));
    aeq("Exponent has no digits", parse_err(Double, "-0x1.1p+"));

    aeq("Exponent has no digits", parse_err(Double, "0x1.1p-"));
    aeq("Exponent has no digits", parse_err(Double, "+0x1.1p-"));
    aeq("Exponent has no digits", parse_err(Double, "-0x1.1p-"));
});


// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1661 exact_inverse
test("exact_inverse", () => {
  // Trivial operation.
  expect(from_f64(2.0).get_exact_inverse()!.bitwise_eq(from_f64(0.5))).toBe(true);
  expect(from_f32(2.0).get_exact_inverse()!.bitwise_eq(from_f32(0.5))).toBe(true);
  expect(parse(Quad, "2.0").get_exact_inverse()!.bitwise_eq(parse(Quad, "0.5"))).toBe(true);
  expect(parse(X87DoubleExtended, "2.0").get_exact_inverse()!.bitwise_eq(parse(X87DoubleExtended, "0.5"))).toBe(true);

  // FLT_MIN
  expect(from_f32(1.17549435e-38).get_exact_inverse()!.bitwise_eq(from_f32(8.5070592e37))).toBe(true);

  // Large float, inverse is a denormal.
  expect(from_f32(1.7014118e38).get_exact_inverse() === undefined).toBe(true);
  // Zero
  expect(from_f64(0.0).get_exact_inverse() === undefined).toBe(true);
  // Denormalized float
  expect(from_f32(1.40129846e-45).get_exact_inverse() === undefined).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1699 round_to_integral
test("round_to_integral", () => {
  const t = from_f64(-0.5);
  aeq(-0.0, double_to_f64(t.round_to_integral(Round.TowardZero).value));
  aeq(-1.0, double_to_f64(t.round_to_integral(Round.TowardNegative).value));
  aeq(-0.0, double_to_f64(t.round_to_integral(Round.TowardPositive).value));
  aeq(-0.0, double_to_f64(t.round_to_integral(Round.NearestTiesToEven).value));

  const s = from_f64(3.14);
  aeq(3.0, double_to_f64(s.round_to_integral(Round.TowardZero).value));
  aeq(3.0, double_to_f64(s.round_to_integral(Round.TowardNegative).value));
  aeq(4.0, double_to_f64(s.round_to_integral(Round.TowardPositive).value));
  aeq(3.0, double_to_f64(s.round_to_integral(Round.NearestTiesToEven).value));

  const r = Double.largest();
  aeq(double_to_f64(r), double_to_f64(r.round_to_integral(Round.TowardZero).value));
  aeq(double_to_f64(r), double_to_f64(r.round_to_integral(Round.TowardNegative).value));
  aeq(double_to_f64(r), double_to_f64(r.round_to_integral(Round.TowardPositive).value));
  aeq(double_to_f64(r), double_to_f64(r.round_to_integral(Round.NearestTiesToEven).value));

  let p: AnyFloat = Double.ZERO.round_to_integral(Round.TowardZero).value;
  aeq(0.0, double_to_f64(p));
  p = Double.ZERO.neg().round_to_integral(Round.TowardZero).value;
  aeq(-0.0, double_to_f64(p));
  p = Double.NAN.round_to_integral(Round.TowardZero).value;
  expect(Number.isNaN(double_to_f64(p))).toBe(true);
  p = Double.INFINITY.round_to_integral(Round.TowardZero).value;
  expect(!Number.isFinite(double_to_f64(p)) && !Number.isNaN(double_to_f64(p)) && double_to_f64(p) > 0.0).toBe(true);
  p = Double.INFINITY.neg().round_to_integral(Round.TowardZero).value;
  expect(!Number.isFinite(double_to_f64(p)) && !Number.isNaN(double_to_f64(p)) && double_to_f64(p) < 0.0).toBe(true);

  let status: Status;
  let x: StatusAnd<AnyFloat>;

  x = Double.NAN.round_to_integral(Round.TowardZero);
  status = x.status;
  p = x.value;
  expect(p.is_nan()).toBe(true);
  expect(!p.is_negative()).toBe(true);
  aeq(Status.OK, status);

  x = Double.NAN.neg().round_to_integral(Round.TowardZero);
  status = x.status;
  p = x.value;
  expect(p.is_nan()).toBe(true);
  expect(p.is_negative()).toBe(true);
  aeq(Status.OK, status);

  x = Double.snan(undefined).round_to_integral(Round.TowardZero);
  status = x.status;
  p = x.value;
  expect(p.is_nan()).toBe(true);
  expect(!p.is_signaling()).toBe(true);
  expect(!p.is_negative()).toBe(true);
  aeq(Status.INVALID_OP, status);

  x = Double.snan(undefined).neg().round_to_integral(Round.TowardZero);
  status = x.status;
  p = x.value;
  expect(p.is_nan()).toBe(true);
  expect(!p.is_signaling()).toBe(true);
  expect(p.is_negative()).toBe(true);
  aeq(Status.INVALID_OP, status);

  x = Double.INFINITY.round_to_integral(Round.TowardZero);
  status = x.status;
  p = x.value;
  expect(p.is_infinite()).toBe(true);
  expect(!p.is_negative()).toBe(true);
  aeq(Status.OK, status);

  x = Double.INFINITY.neg().round_to_integral(Round.TowardZero);
  status = x.status;
  p = x.value;
  expect(p.is_infinite()).toBe(true);
  expect(p.is_negative()).toBe(true);
  aeq(Status.OK, status);

  x = Double.ZERO.round_to_integral(Round.TowardZero);
  status = x.status;
  p = x.value;
  expect(p.is_zero()).toBe(true);
  expect(!p.is_negative()).toBe(true);
  aeq(Status.OK, status);

  x = Double.ZERO.round_to_integral(Round.TowardNegative);
  status = x.status;
  p = x.value;
  expect(p.is_zero()).toBe(true);
  expect(!p.is_negative()).toBe(true);
  aeq(Status.OK, status);

  x = Double.ZERO.neg().round_to_integral(Round.TowardZero);
  status = x.status;
  p = x.value;
  expect(p.is_zero()).toBe(true);
  expect(p.is_negative()).toBe(true);
  aeq(Status.OK, status);

  x = Double.ZERO.neg().round_to_integral(Round.TowardNegative);
  status = x.status;
  p = x.value;
  expect(p.is_zero()).toBe(true);
  expect(p.is_negative()).toBe(true);
  aeq(Status.OK, status);

  x = from_f64(1e-100).round_to_integral(Round.TowardNegative);
  status = x.status;
  p = x.value;
  expect(p.is_zero()).toBe(true);
  expect(!p.is_negative()).toBe(true);
  aeq(Status.INEXACT, status);

  x = from_f64(1e-100).round_to_integral(Round.TowardPositive);
  status = x.status;
  p = x.value;
  aeq(1.0, double_to_f64(p));
  expect(!p.is_negative()).toBe(true);
  aeq(Status.INEXACT, status);

  x = from_f64(-1e-100).round_to_integral(Round.TowardNegative);
  status = x.status;
  p = x.value;
  expect(p.is_negative()).toBe(true);
  aeq(-1.0, double_to_f64(p));
  aeq(Status.INEXACT, status);

  x = from_f64(-1e-100).round_to_integral(Round.TowardPositive);
  status = x.status;
  p = x.value;
  expect(p.is_zero()).toBe(true);
  expect(p.is_negative()).toBe(true);
  aeq(Status.INEXACT, status);

  x = from_f64(10.0).round_to_integral(Round.TowardZero);
  status = x.status;
  p = x.value;
  aeq(10.0, double_to_f64(p));
  aeq(Status.OK, status);

  x = from_f64(10.5).round_to_integral(Round.TowardZero);
  status = x.status;
  p = x.value;
  aeq(10.0, double_to_f64(p));
  aeq(Status.INEXACT, status);

  x = from_f64(10.5).round_to_integral(Round.TowardPositive);
  status = x.status;
  p = x.value;
  aeq(11.0, double_to_f64(p));
  aeq(Status.INEXACT, status);

  x = from_f64(10.5).round_to_integral(Round.TowardNegative);
  status = x.status;
  p = x.value;
  aeq(10.0, double_to_f64(p));
  aeq(Status.INEXACT, status);

  x = from_f64(10.5).round_to_integral(Round.NearestTiesToAway);
  status = x.status;
  p = x.value;
  aeq(11.0, double_to_f64(p));
  aeq(Status.INEXACT, status);

  x = from_f64(10.5).round_to_integral(Round.NearestTiesToEven);
  status = x.status;
  p = x.value;
  aeq(10.0, double_to_f64(p));
  aeq(Status.INEXACT, status);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1829 is_integer
test("is_integer", () => {
  let t = from_f64(-0.0);
  expect(t.is_integer()).toBe(true);
  t = from_f64(3.14159);
  expect(!t.is_integer()).toBe(true);
  t = Double.NAN;
  expect(!t.is_integer()).toBe(true);
  t = Double.INFINITY;
  expect(!t.is_integer()).toBe(true);
  t = Double.INFINITY.neg();
  expect(!t.is_integer()).toBe(true);
  t = Double.largest();
  expect(t.is_integer()).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1845 largest
test("largest", () => {
  aeq(Math.fround(3.402823466e38), single_to_f32(Single.largest()));
  aeq(1.7976931348623158e308, double_to_f64(Double.largest()));
  aeq(448.0, to_f64(Float8E4M3FN.largest()));
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1852 smallest
test("smallest", () => {
  {
    const test = Single.SMALLEST;
    const expected = parse(Single, "0x0.000002p-126");
    expect(!test.is_negative()).toBe(true);
    expect(test.is_finite_non_zero()).toBe(true);
    expect(test.is_denormal()).toBe(true);
    expect(test.bitwise_eq(expected)).toBe(true);
  }

  {
    const test = Single.SMALLEST.neg();
    const expected = parse(Single, "-0x0.000002p-126");
    expect(test.is_negative()).toBe(true);
    expect(test.is_finite_non_zero()).toBe(true);
    expect(test.is_denormal()).toBe(true);
    expect(test.bitwise_eq(expected)).toBe(true);
  }

  {
    const test = Quad.SMALLEST;
    const expected = parse(Quad, "0x0.0000000000000000000000000001p-16382");
    expect(!test.is_negative()).toBe(true);
    expect(test.is_finite_non_zero()).toBe(true);
    expect(test.is_denormal()).toBe(true);
    expect(test.bitwise_eq(expected)).toBe(true);
  }

  {
    const test = Quad.SMALLEST.neg();
    const expected = parse(Quad, "-0x0.0000000000000000000000000001p-16382");
    expect(test.is_negative()).toBe(true);
    expect(test.is_finite_non_zero()).toBe(true);
    expect(test.is_denormal()).toBe(true);
    expect(test.bitwise_eq(expected)).toBe(true);
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1883 smallest_normalized
test("smallest_normalized", () => {
  const check = <F extends Float<F>>(test: F, expected: F, negative: boolean) => {
    expect(negative ? test.is_negative() : !test.is_negative()).toBe(true);
    expect(test.is_finite_non_zero()).toBe(true);
    expect(!test.is_denormal()).toBe(true);
    expect(test.bitwise_eq(expected)).toBe(true);
    expect(test.is_smallest_normalized()).toBe(true);
  };
  // PORT: the six upstream blocks (`let test = ..; let expected = ..;` + the same five asserts) via `check`.
  check(Single.smallest_normalized(), parse(Single, "0x1p-126"), false);
  check(Single.smallest_normalized().neg(), parse(Single, "-0x1p-126"), true);
  check(Double.smallest_normalized(), parse(Double, "0x1p-1022"), false);
  check(Double.smallest_normalized().neg(), parse(Double, "-0x1p-1022"), true);
  check(Quad.smallest_normalized(), parse(Quad, "0x1p-16382"), false);
  check(Quad.smallest_normalized().neg(), parse(Quad, "-0x1p-16382"), true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1934 zero
test("zero", () => {
  aeq(Math.fround(0.0), single_to_f32(from_f32(0.0)));
  aeq(Math.fround(-0.0), single_to_f32(from_f32(-0.0)));
  expect(from_f32(-0.0).is_negative()).toBe(true);

  aeq(0.0, double_to_f64(from_f64(0.0)));
  aeq(-0.0, double_to_f64(from_f64(-0.0)));
  expect(from_f64(-0.0).is_negative()).toBe(true);

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1943 test
  function test<F extends Float<F>>(F: FloatType<F>, sign: boolean, bits: bigint): void {
    const test = sign ? F.ZERO.neg() : F.ZERO;
    const pattern = sign ? "-0x0p+0" : "0x0p+0";
    const expected = parse(F, pattern);
    expect(test.is_zero()).toBe(true);
    aeq(sign, test.is_negative());
    expect(test.bitwise_eq(expected)).toBe(true);
    aeq(bits, test.to_bits());
  }
  test(Half, false, 0n);
  test(Half, true, 0x8000n);
  test(Single, false, 0n);
  test(Single, true, 0x80000000n);
  test(Double, false, 0n);
  test(Double, true, 0x8000000000000000n);
  test(Quad, false, 0n);
  test(Quad, true, 0x8000000000000000_0000000000000000n);
  test(X87DoubleExtended, false, 0n);
  test(X87DoubleExtended, true, 0x8000_0000000000000000n);
  test(Float8E5M2, false, 0n);
  test(Float8E5M2, true, 0x80n);
  test(Float8E4M3FN, false, 0n);
  test(Float8E4M3FN, true, 0x80n);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1969 copy_sign
test("copy_sign", () => {
  expect(from_f64(-42.0).bitwise_eq(from_f64(42.0).copy_sign(from_f64(-1.0)))).toBe(true);
  expect(from_f64(42.0).bitwise_eq(from_f64(-42.0).copy_sign(from_f64(1.0)))).toBe(true);
  expect(from_f64(-42.0).bitwise_eq(from_f64(-42.0).copy_sign(from_f64(-1.0)))).toBe(true);
  expect(from_f64(42.0).bitwise_eq(from_f64(42.0).copy_sign(from_f64(1.0)))).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:1977 convert
test("convert", () => {
  const loses_info = { value: false };
  let status: Status;
  let r: StatusAnd<AnyFloat>;
  const S = Single as unknown as AnyType;
  const D = Double as unknown as AnyType;
  const X = X87DoubleExtended as unknown as AnyType;
  const B = BFloat as unknown as AnyType;

  let test: AnyFloat = parse(D, "1.0");
  test = test.convert(S, loses_info).value;
  aeq(Math.fround(1.0), single_to_f32(test));
  expect(!loses_info.value).toBe(true);

  test = parse(X, "0x1p-53");
  let one = parse(X, "1.0");
  test = test.add_assign(one);
  test = test.convert(D, loses_info).value;
  aeq(1.0, double_to_f64(test));
  expect(loses_info.value).toBe(true);

  test = parse(Quad as unknown as AnyType, "0x1p-53");
  one = parse(Quad as unknown as AnyType, "1.0");
  test = test.add_assign(one);
  test = test.convert(D, loses_info).value;
  aeq(1.0, double_to_f64(test));
  expect(loses_info.value).toBe(true);

  test = parse(X, "0xf.fffffffp+28");
  test = test.convert(D, loses_info).value;
  aeq(4294967295.0, double_to_f64(test));
  expect(!loses_info.value).toBe(true);

  test = S.snan(undefined);
  r = test.convert(X, loses_info);
  status = r.status;
  test = r.value;
  // Conversion quiets the SNAN, so now 2 bits of the 64-bit significand should be set.
  expect(test.bitwise_eq(X.qnan(0x6000000000000000n))).toBe(true);
  expect(!loses_info.value).toBe(true);
  aeq(status, Status.INVALID_OP);

  test = S.qnan(undefined);
  const x87_qnan = X.qnan(undefined);
  test = test.convert(X, loses_info).value;
  expect(test.bitwise_eq(x87_qnan)).toBe(true);
  expect(!loses_info.value).toBe(true);

  // NOTE(eddyb) these were mistakenly noops upstream, here they're already
  // fixed (by instead converting from `Double` to `X87DoubleExtended`),
  // see also upstream issue https://github.com/llvm/llvm-project/issues/63842.
  test = D.snan(undefined);
  test = test.convert(X, loses_info).value;
  // Conversion quiets the SNAN, so now 2 bits of the 64-bit significand should be set.
  expect(test.bitwise_eq(X.qnan(0x6000000000000000n))).toBe(true);
  expect(!loses_info.value).toBe(true);

  test = D.qnan(undefined);
  test = test.convert(X, loses_info).value;
  expect(test.bitwise_eq(x87_qnan)).toBe(true);
  expect(!loses_info.value).toBe(true);

  // The payload is lost in truncation, but we retain NaN by setting the quiet bit.
  test = D.snan(1n);
  r = test.convert(S, loses_info);
  status = r.status;
  test = r.value;
  aeq(0x7fc00000n, test.to_bits());
  expect(loses_info.value).toBe(true);
  aeq(status, Status.INVALID_OP);

  // The payload is lost in truncation. QNaN remains QNaN.
  test = D.qnan(1n);
  r = test.convert(S, loses_info);
  status = r.status;
  test = r.value;
  aeq(0x7fc00000n, test.to_bits());
  expect(loses_info.value).toBe(true);
  aeq(status, Status.OK);

  // Test that subnormals are handled correctly in double to float conversion
  test = parse(D, "0x0.0000010000000p-1022");
  r = test.convert(S, loses_info);
  status = r.status;
  test = r.value;
  aeq(Math.fround(0.0), single_to_f32(test));
  expect(loses_info.value).toBe(true);

  test = parse(D, "0x0.0000010000001p-1022");
  r = test.convert(S, loses_info);
  status = r.status;
  test = r.value;
  aeq(Math.fround(0.0), single_to_f32(test));
  expect(loses_info.value).toBe(true);

  test = parse(D, "-0x0.0000010000001p-1022");
  r = test.convert(S, loses_info);
  status = r.status;
  test = r.value;
  aeq(Math.fround(0.0), single_to_f32(test));
  expect(loses_info.value).toBe(true);

  test = parse(D, "0x0.0000020000000p-1022");
  r = test.convert(S, loses_info);
  status = r.status;
  test = r.value;
  aeq(Math.fround(0.0), single_to_f32(test));
  expect(loses_info.value).toBe(true);

  test = parse(D, "0x0.0000020000001p-1022");
  r = test.convert(S, loses_info);
  status = r.status;
  test = r.value;
  aeq(Math.fround(0.0), single_to_f32(test));
  expect(loses_info.value).toBe(true);

  // Test subnormal conversion to bfloat
  test = parse(S, "0x0.01p-126");
  r = test.convert(B, loses_info);
  status = r.status;
  test = r.value;
  aeq(Math.fround(0.0), to_f32(test));
  expect(loses_info.value).toBe(true);

  test = parse(S, "0x0.02p-126");
  r = test.convert(B, loses_info);
  status = r.status;
  test = r.value;
  aeq(0x01n, test.to_bits());
  expect(!loses_info.value).toBe(true);

  test = parse(S, "0x0.01p-126");
  r = test.convert_r(B, Round.NearestTiesToAway, loses_info);
  status = r.status;
  test = r.value;
  aeq(0x01n, test.to_bits());
  expect(loses_info.value).toBe(true);
  void status;
});


// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:2090 is_negative
test("is_negative", () => {
    let t = parse(Single, "0x1p+0");
    expect(!t.is_negative()).toBe(true);
    t = parse(Single, "-0x1p+0");
    expect(t.is_negative()).toBe(true);

    expect(!Single.INFINITY.is_negative()).toBe(true);
    expect(Single.INFINITY.neg().is_negative()).toBe(true);

    expect(!Single.ZERO.is_negative()).toBe(true);
    expect(Single.ZERO.neg().is_negative()).toBe(true);

    expect(!Single.NAN.is_negative()).toBe(true);
    expect(Single.NAN.neg().is_negative()).toBe(true);

    expect(!Single.snan(undefined).is_negative()).toBe(true);
    expect(Single.snan(undefined).neg().is_negative()).toBe(true);
});


// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:2110 is_normal
test("is_normal", () => {
    let t = parse(Single, "0x1p+0");
    expect(t.is_normal()).toBe(true);

    expect(!Single.INFINITY.is_normal()).toBe(true);
    expect(!Single.ZERO.is_normal()).toBe(true);
    expect(!Single.NAN.is_normal()).toBe(true);
    expect(!Single.snan(undefined).is_normal()).toBe(true);
    expect(!parse(Single, "0x1p-149").is_normal()).toBe(true);
});


// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:2122 is_finite
test("is_finite", () => {
    let t = parse(Single, "0x1p+0");
    expect(t.is_finite()).toBe(true);
    expect(!Single.INFINITY.is_finite()).toBe(true);
    expect(Single.ZERO.is_finite()).toBe(true);
    expect(!Single.NAN.is_finite()).toBe(true);
    expect(!Single.snan(undefined).is_finite()).toBe(true);
    expect(parse(Single, "0x1p-149").is_finite()).toBe(true);
});


// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:2133 is_infinite
test("is_infinite", () => {
    let t = parse(Single, "0x1p+0");
    expect(!t.is_infinite()).toBe(true);

    let pos_inf = Single.INFINITY;
    let neg_inf = Single.INFINITY.neg();

    expect(pos_inf.is_infinite()).toBe(true);
    expect(pos_inf.is_pos_infinity()).toBe(true);
    expect(!pos_inf.is_neg_infinity()).toBe(true);
    expect(neg_inf.is_infinite()).toBe(true);
    expect(!neg_inf.is_pos_infinity()).toBe(true);
    expect(neg_inf.is_neg_infinity()).toBe(true);

    expect(!Single.ZERO.is_infinite()).toBe(true);
    expect(!Single.NAN.is_infinite()).toBe(true);
    expect(!Single.snan(undefined).is_infinite()).toBe(true);
    expect(!parse(Single, "0x1p-149").is_infinite()).toBe(true);
});


// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:2154 is_nan
test("is_nan", () => {
    let t = parse(Single, "0x1p+0");
    expect(!t.is_nan()).toBe(true);
    expect(!Single.INFINITY.is_nan()).toBe(true);
    expect(!Single.ZERO.is_nan()).toBe(true);
    expect(Single.NAN.is_nan()).toBe(true);
    expect(Single.snan(undefined).is_nan()).toBe(true);
    expect(!parse(Single, "0x1p-149").is_nan()).toBe(true);
});


// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:2165 is_finite_non_zero
test("is_finite_non_zero", () => {
    // Test positive/negative normal value.
    expect(parse(Single, "0x1p+0").is_finite_non_zero()).toBe(true);
    expect(parse(Single, "-0x1p+0").is_finite_non_zero()).toBe(true);

    // Test positive/negative denormal value.
    expect(parse(Single, "0x1p-149").is_finite_non_zero()).toBe(true);
    expect(parse(Single, "-0x1p-149").is_finite_non_zero()).toBe(true);

    // Test +/- Infinity.
    expect(!Single.INFINITY.is_finite_non_zero()).toBe(true);
    expect(!Single.INFINITY.neg().is_finite_non_zero()).toBe(true);

    // Test +/- Zero.
    expect(!Single.ZERO.is_finite_non_zero()).toBe(true);
    expect(!Single.ZERO.neg().is_finite_non_zero()).toBe(true);

    // Test +/- qNaN. +/- dont mean anything with qNaN but paranoia can't hurt in
    // this instance.
    expect(!Single.NAN.is_finite_non_zero()).toBe(true);
    expect(!Single.NAN.neg().is_finite_non_zero()).toBe(true);

    // Test +/- sNaN. +/- dont mean anything with sNaN but paranoia can't hurt in
    // this instance.
    expect(!Single.snan(undefined).is_finite_non_zero()).toBe(true);
    expect(!Single.snan(undefined).neg().is_finite_non_zero()).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:2194 add
test("add", () => {
    // Test Special Cases against each other and normal values.

    const p_inf = Single.INFINITY;
    const m_inf = Single.INFINITY.neg();
    const p_zero = Single.ZERO;
    const m_zero = Single.ZERO.neg();
    const qnan = Single.NAN;
    const snan = parse(Single, "snan123");
    const p_normal_value = parse(Single, "0x1p+0");
    const m_normal_value = parse(Single, "-0x1p+0");
    const p_largest_value = Single.largest();
    const m_largest_value = Single.largest().neg();
    const p_smallest_value = Single.SMALLEST;
    const m_smallest_value = Single.SMALLEST.neg();
    const p_smallest_normalized = Single.smallest_normalized();
    const m_smallest_normalized = Single.smallest_normalized().neg();

    const overflow_status = (Status.OVERFLOW | Status.INEXACT) as Status;

    const special_cases: [Single, Single, string, Status, Category][] = [
        [p_inf, p_inf, "inf", Status.OK, Category.Infinity],
        [p_inf, m_inf, "nan", Status.INVALID_OP, Category.NaN],
        [p_inf, p_zero, "inf", Status.OK, Category.Infinity],
        [p_inf, m_zero, "inf", Status.OK, Category.Infinity],
        [p_inf, qnan, "nan", Status.OK, Category.NaN],
        [p_inf, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_inf, p_normal_value, "inf", Status.OK, Category.Infinity],
        [p_inf, m_normal_value, "inf", Status.OK, Category.Infinity],
        [p_inf, p_largest_value, "inf", Status.OK, Category.Infinity],
        [p_inf, m_largest_value, "inf", Status.OK, Category.Infinity],
        [p_inf, p_smallest_value, "inf", Status.OK, Category.Infinity],
        [p_inf, m_smallest_value, "inf", Status.OK, Category.Infinity],
        [p_inf, p_smallest_normalized, "inf", Status.OK, Category.Infinity],
        [p_inf, m_smallest_normalized, "inf", Status.OK, Category.Infinity],
        [m_inf, p_inf, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, m_inf, "-inf", Status.OK, Category.Infinity],
        [m_inf, p_zero, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_zero, "-inf", Status.OK, Category.Infinity],
        [m_inf, qnan, "nan", Status.OK, Category.NaN],
        [m_inf, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_inf, p_normal_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_normal_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, p_largest_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_largest_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, p_smallest_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_smallest_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, p_smallest_normalized, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_smallest_normalized, "-inf", Status.OK, Category.Infinity],
        [p_zero, p_inf, "inf", Status.OK, Category.Infinity],
        [p_zero, m_inf, "-inf", Status.OK, Category.Infinity],
        [p_zero, p_zero, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, m_zero, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, qnan, "nan", Status.OK, Category.NaN],
        [p_zero, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_zero, p_normal_value, "0x1p+0", Status.OK, Category.Normal],
        [p_zero, m_normal_value, "-0x1p+0", Status.OK, Category.Normal],
        [p_zero, p_largest_value, "0x1.fffffep+127", Status.OK, Category.Normal],
        [p_zero, m_largest_value, "-0x1.fffffep+127", Status.OK, Category.Normal],
        [p_zero, p_smallest_value, "0x1p-149", Status.OK, Category.Normal],
        [p_zero, m_smallest_value, "-0x1p-149", Status.OK, Category.Normal],
        [p_zero, p_smallest_normalized, "0x1p-126", Status.OK, Category.Normal],
        [p_zero, m_smallest_normalized, "-0x1p-126", Status.OK, Category.Normal],
        [m_zero, p_inf, "inf", Status.OK, Category.Infinity],
        [m_zero, m_inf, "-inf", Status.OK, Category.Infinity],
        [m_zero, p_zero, "0x0p+0", Status.OK, Category.Zero],
        [m_zero, m_zero, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, qnan, "nan", Status.OK, Category.NaN],
        [m_zero, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_zero, p_normal_value, "0x1p+0", Status.OK, Category.Normal],
        [m_zero, m_normal_value, "-0x1p+0", Status.OK, Category.Normal],
        [m_zero, p_largest_value, "0x1.fffffep+127", Status.OK, Category.Normal],
        [m_zero, m_largest_value, "-0x1.fffffep+127", Status.OK, Category.Normal],
        [m_zero, p_smallest_value, "0x1p-149", Status.OK, Category.Normal],
        [m_zero, m_smallest_value, "-0x1p-149", Status.OK, Category.Normal],
        [m_zero, p_smallest_normalized, "0x1p-126", Status.OK, Category.Normal],
        [m_zero, m_smallest_normalized, "-0x1p-126", Status.OK, Category.Normal],
        [qnan, p_inf, "nan", Status.OK, Category.NaN],
        [qnan, m_inf, "nan", Status.OK, Category.NaN],
        [qnan, p_zero, "nan", Status.OK, Category.NaN],
        [qnan, m_zero, "nan", Status.OK, Category.NaN],
        [qnan, qnan, "nan", Status.OK, Category.NaN],
        [qnan, snan, "nan", Status.INVALID_OP, Category.NaN],
        [qnan, p_normal_value, "nan", Status.OK, Category.NaN],
        [qnan, m_normal_value, "nan", Status.OK, Category.NaN],
        [qnan, p_largest_value, "nan", Status.OK, Category.NaN],
        [qnan, m_largest_value, "nan", Status.OK, Category.NaN],
        [qnan, p_smallest_value, "nan", Status.OK, Category.NaN],
        [qnan, m_smallest_value, "nan", Status.OK, Category.NaN],
        [qnan, p_smallest_normalized, "nan", Status.OK, Category.NaN],
        [qnan, m_smallest_normalized, "nan", Status.OK, Category.NaN],
        [snan, p_inf, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_inf, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_zero, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_zero, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, qnan, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_normal_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_normal_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_largest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_largest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_smallest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_smallest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_smallest_normalized, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_smallest_normalized, "nan123", Status.INVALID_OP, Category.NaN],
        [p_normal_value, p_inf, "inf", Status.OK, Category.Infinity],
        [p_normal_value, m_inf, "-inf", Status.OK, Category.Infinity],
        [p_normal_value, p_zero, "0x1p+0", Status.OK, Category.Normal],
        [p_normal_value, m_zero, "0x1p+0", Status.OK, Category.Normal],
        [p_normal_value, qnan, "nan", Status.OK, Category.NaN],
        [p_normal_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_normal_value, p_normal_value, "0x1p+1", Status.OK, Category.Normal],
        [p_normal_value, m_normal_value, "0x0p+0", Status.OK, Category.Zero],
        [p_normal_value, p_largest_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_normal_value, m_largest_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_normal_value, p_smallest_value, "0x1p+0", Status.INEXACT, Category.Normal],
        [p_normal_value, m_smallest_value, "0x1p+0", Status.INEXACT, Category.Normal],
        [p_normal_value, p_smallest_normalized, "0x1p+0", Status.INEXACT, Category.Normal],
        [p_normal_value, m_smallest_normalized, "0x1p+0", Status.INEXACT, Category.Normal],
        [m_normal_value, p_inf, "inf", Status.OK, Category.Infinity],
        [m_normal_value, m_inf, "-inf", Status.OK, Category.Infinity],
        [m_normal_value, p_zero, "-0x1p+0", Status.OK, Category.Normal],
        [m_normal_value, m_zero, "-0x1p+0", Status.OK, Category.Normal],
        [m_normal_value, qnan, "nan", Status.OK, Category.NaN],
        [m_normal_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_normal_value, p_normal_value, "0x0p+0", Status.OK, Category.Zero],
        [m_normal_value, m_normal_value, "-0x1p+1", Status.OK, Category.Normal],
        [m_normal_value, p_largest_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_normal_value, m_largest_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_normal_value, p_smallest_value, "-0x1p+0", Status.INEXACT, Category.Normal],
        [m_normal_value, m_smallest_value, "-0x1p+0", Status.INEXACT, Category.Normal],
        [m_normal_value, p_smallest_normalized, "-0x1p+0", Status.INEXACT, Category.Normal],
        [m_normal_value, m_smallest_normalized, "-0x1p+0", Status.INEXACT, Category.Normal],
        [p_largest_value, p_inf, "inf", Status.OK, Category.Infinity],
        [p_largest_value, m_inf, "-inf", Status.OK, Category.Infinity],
        [p_largest_value, p_zero, "0x1.fffffep+127", Status.OK, Category.Normal],
        [p_largest_value, m_zero, "0x1.fffffep+127", Status.OK, Category.Normal],
        [p_largest_value, qnan, "nan", Status.OK, Category.NaN],
        [p_largest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_largest_value, p_normal_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_largest_value, m_normal_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_largest_value, p_largest_value, "inf", overflow_status, Category.Infinity],
        [p_largest_value, m_largest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_largest_value, p_smallest_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_largest_value, m_smallest_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_largest_value, p_smallest_normalized, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_largest_value, m_smallest_normalized, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_largest_value, p_inf, "inf", Status.OK, Category.Infinity],
        [m_largest_value, m_inf, "-inf", Status.OK, Category.Infinity],
        [m_largest_value, p_zero, "-0x1.fffffep+127", Status.OK, Category.Normal],
        [m_largest_value, m_zero, "-0x1.fffffep+127", Status.OK, Category.Normal],
        [m_largest_value, qnan, "nan", Status.OK, Category.NaN],
        [m_largest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_largest_value, p_normal_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_largest_value, m_normal_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_largest_value, p_largest_value, "0x0p+0", Status.OK, Category.Zero],
        [m_largest_value, m_largest_value, "-inf", overflow_status, Category.Infinity],
        [m_largest_value, p_smallest_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_largest_value, m_smallest_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_largest_value, p_smallest_normalized, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_largest_value, m_smallest_normalized, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_smallest_value, p_inf, "inf", Status.OK, Category.Infinity],
        [p_smallest_value, m_inf, "-inf", Status.OK, Category.Infinity],
        [p_smallest_value, p_zero, "0x1p-149", Status.OK, Category.Normal],
        [p_smallest_value, m_zero, "0x1p-149", Status.OK, Category.Normal],
        [p_smallest_value, qnan, "nan", Status.OK, Category.NaN],
        [p_smallest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_smallest_value, p_normal_value, "0x1p+0", Status.INEXACT, Category.Normal],
        [p_smallest_value, m_normal_value, "-0x1p+0", Status.INEXACT, Category.Normal],
        [p_smallest_value, p_largest_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_smallest_value, m_largest_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_smallest_value, p_smallest_value, "0x1p-148", Status.OK, Category.Normal],
        [p_smallest_value, m_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_smallest_value, p_smallest_normalized, "0x1.000002p-126", Status.OK, Category.Normal],
        [p_smallest_value, m_smallest_normalized, "-0x1.fffffcp-127", Status.OK, Category.Normal],
        [m_smallest_value, p_inf, "inf", Status.OK, Category.Infinity],
        [m_smallest_value, m_inf, "-inf", Status.OK, Category.Infinity],
        [m_smallest_value, p_zero, "-0x1p-149", Status.OK, Category.Normal],
        [m_smallest_value, m_zero, "-0x1p-149", Status.OK, Category.Normal],
        [m_smallest_value, qnan, "nan", Status.OK, Category.NaN],
        [m_smallest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_smallest_value, p_normal_value, "0x1p+0", Status.INEXACT, Category.Normal],
        [m_smallest_value, m_normal_value, "-0x1p+0", Status.INEXACT, Category.Normal],
        [m_smallest_value, p_largest_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_smallest_value, m_largest_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_smallest_value, p_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [m_smallest_value, m_smallest_value, "-0x1p-148", Status.OK, Category.Normal],
        [m_smallest_value, p_smallest_normalized, "0x1.fffffcp-127", Status.OK, Category.Normal],
        [m_smallest_value, m_smallest_normalized, "-0x1.000002p-126", Status.OK, Category.Normal],
        [p_smallest_normalized, p_inf, "inf", Status.OK, Category.Infinity],
        [p_smallest_normalized, m_inf, "-inf", Status.OK, Category.Infinity],
        [p_smallest_normalized, p_zero, "0x1p-126", Status.OK, Category.Normal],
        [p_smallest_normalized, m_zero, "0x1p-126", Status.OK, Category.Normal],
        [p_smallest_normalized, qnan, "nan", Status.OK, Category.NaN],
        [p_smallest_normalized, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_smallest_normalized, p_normal_value, "0x1p+0", Status.INEXACT, Category.Normal],
        [p_smallest_normalized, m_normal_value, "-0x1p+0", Status.INEXACT, Category.Normal],
        [p_smallest_normalized, p_largest_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_smallest_normalized, m_largest_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_smallest_normalized, p_smallest_value, "0x1.000002p-126", Status.OK, Category.Normal],
        [p_smallest_normalized, m_smallest_value, "0x1.fffffcp-127", Status.OK, Category.Normal],
        [p_smallest_normalized, p_smallest_normalized, "0x1p-125", Status.OK, Category.Normal],
        [p_smallest_normalized, m_smallest_normalized, "0x0p+0", Status.OK, Category.Zero],
        [m_smallest_normalized, p_inf, "inf", Status.OK, Category.Infinity],
        [m_smallest_normalized, m_inf, "-inf", Status.OK, Category.Infinity],
        [m_smallest_normalized, p_zero, "-0x1p-126", Status.OK, Category.Normal],
        [m_smallest_normalized, m_zero, "-0x1p-126", Status.OK, Category.Normal],
        [m_smallest_normalized, qnan, "nan", Status.OK, Category.NaN],
        [m_smallest_normalized, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_smallest_normalized, p_normal_value, "0x1p+0", Status.INEXACT, Category.Normal],
        [m_smallest_normalized, m_normal_value, "-0x1p+0", Status.INEXACT, Category.Normal],
        [m_smallest_normalized, p_largest_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_smallest_normalized, m_largest_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_smallest_normalized, p_smallest_value, "-0x1.fffffcp-127", Status.OK, Category.Normal],
        [m_smallest_normalized, m_smallest_value, "-0x1.000002p-126", Status.OK, Category.Normal],
        [m_smallest_normalized, p_smallest_normalized, "0x0p+0", Status.OK, Category.Zero],
        [m_smallest_normalized, m_smallest_normalized, "-0x1p-125", Status.OK, Category.Normal],
    ];

    for (const [x, y, e_result, e_status, e_category] of special_cases) {
        const r = x.add(y);
        const status = r.status;
        const result = r.value;
        expect(status).toBe(e_status);
        expect(result.category()).toBe(e_category);
        expect(result.bitwise_eq(parse(Single, e_result))).toBe(true); // "result = {result:?}, case = {case:?}"
    }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:2423 subtract
test("subtract", () => {
    // Test Special Cases against each other and normal values.

    const p_inf = Single.INFINITY;
    const m_inf = Single.INFINITY.neg();
    const p_zero = Single.ZERO;
    const m_zero = Single.ZERO.neg();
    const qnan = Single.NAN;
    const snan = parse(Single, "snan123");
    const p_normal_value = parse(Single, "0x1p+0");
    const m_normal_value = parse(Single, "-0x1p+0");
    const p_largest_value = Single.largest();
    const m_largest_value = Single.largest().neg();
    const p_smallest_value = Single.SMALLEST;
    const m_smallest_value = Single.SMALLEST.neg();
    const p_smallest_normalized = Single.smallest_normalized();
    const m_smallest_normalized = Single.smallest_normalized().neg();

    const overflow_status = (Status.OVERFLOW | Status.INEXACT) as Status;

    const special_cases: [Single, Single, string, Status, Category][] = [
        [p_inf, p_inf, "nan", Status.INVALID_OP, Category.NaN],
        [p_inf, m_inf, "inf", Status.OK, Category.Infinity],
        [p_inf, p_zero, "inf", Status.OK, Category.Infinity],
        [p_inf, m_zero, "inf", Status.OK, Category.Infinity],
        [p_inf, qnan, "nan", Status.OK, Category.NaN],
        [p_inf, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_inf, p_normal_value, "inf", Status.OK, Category.Infinity],
        [p_inf, m_normal_value, "inf", Status.OK, Category.Infinity],
        [p_inf, p_largest_value, "inf", Status.OK, Category.Infinity],
        [p_inf, m_largest_value, "inf", Status.OK, Category.Infinity],
        [p_inf, p_smallest_value, "inf", Status.OK, Category.Infinity],
        [p_inf, m_smallest_value, "inf", Status.OK, Category.Infinity],
        [p_inf, p_smallest_normalized, "inf", Status.OK, Category.Infinity],
        [p_inf, m_smallest_normalized, "inf", Status.OK, Category.Infinity],
        [m_inf, p_inf, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_inf, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, p_zero, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_zero, "-inf", Status.OK, Category.Infinity],
        [m_inf, qnan, "nan", Status.OK, Category.NaN],
        [m_inf, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_inf, p_normal_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_normal_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, p_largest_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_largest_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, p_smallest_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_smallest_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, p_smallest_normalized, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_smallest_normalized, "-inf", Status.OK, Category.Infinity],
        [p_zero, p_inf, "-inf", Status.OK, Category.Infinity],
        [p_zero, m_inf, "inf", Status.OK, Category.Infinity],
        [p_zero, p_zero, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, m_zero, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, qnan, "nan", Status.OK, Category.NaN],
        [p_zero, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_zero, p_normal_value, "-0x1p+0", Status.OK, Category.Normal],
        [p_zero, m_normal_value, "0x1p+0", Status.OK, Category.Normal],
        [p_zero, p_largest_value, "-0x1.fffffep+127", Status.OK, Category.Normal],
        [p_zero, m_largest_value, "0x1.fffffep+127", Status.OK, Category.Normal],
        [p_zero, p_smallest_value, "-0x1p-149", Status.OK, Category.Normal],
        [p_zero, m_smallest_value, "0x1p-149", Status.OK, Category.Normal],
        [p_zero, p_smallest_normalized, "-0x1p-126", Status.OK, Category.Normal],
        [p_zero, m_smallest_normalized, "0x1p-126", Status.OK, Category.Normal],
        [m_zero, p_inf, "-inf", Status.OK, Category.Infinity],
        [m_zero, m_inf, "inf", Status.OK, Category.Infinity],
        [m_zero, p_zero, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, m_zero, "0x0p+0", Status.OK, Category.Zero],
        [m_zero, qnan, "nan", Status.OK, Category.NaN],
        [m_zero, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_zero, p_normal_value, "-0x1p+0", Status.OK, Category.Normal],
        [m_zero, m_normal_value, "0x1p+0", Status.OK, Category.Normal],
        [m_zero, p_largest_value, "-0x1.fffffep+127", Status.OK, Category.Normal],
        [m_zero, m_largest_value, "0x1.fffffep+127", Status.OK, Category.Normal],
        [m_zero, p_smallest_value, "-0x1p-149", Status.OK, Category.Normal],
        [m_zero, m_smallest_value, "0x1p-149", Status.OK, Category.Normal],
        [m_zero, p_smallest_normalized, "-0x1p-126", Status.OK, Category.Normal],
        [m_zero, m_smallest_normalized, "0x1p-126", Status.OK, Category.Normal],
        [qnan, p_inf, "nan", Status.OK, Category.NaN],
        [qnan, m_inf, "nan", Status.OK, Category.NaN],
        [qnan, p_zero, "nan", Status.OK, Category.NaN],
        [qnan, m_zero, "nan", Status.OK, Category.NaN],
        [qnan, qnan, "nan", Status.OK, Category.NaN],
        [qnan, snan, "nan", Status.INVALID_OP, Category.NaN],
        [qnan, p_normal_value, "nan", Status.OK, Category.NaN],
        [qnan, m_normal_value, "nan", Status.OK, Category.NaN],
        [qnan, p_largest_value, "nan", Status.OK, Category.NaN],
        [qnan, m_largest_value, "nan", Status.OK, Category.NaN],
        [qnan, p_smallest_value, "nan", Status.OK, Category.NaN],
        [qnan, m_smallest_value, "nan", Status.OK, Category.NaN],
        [qnan, p_smallest_normalized, "nan", Status.OK, Category.NaN],
        [qnan, m_smallest_normalized, "nan", Status.OK, Category.NaN],
        [snan, p_inf, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_inf, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_zero, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_zero, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, qnan, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_normal_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_normal_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_largest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_largest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_smallest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_smallest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_smallest_normalized, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_smallest_normalized, "nan123", Status.INVALID_OP, Category.NaN],
        [p_normal_value, p_inf, "-inf", Status.OK, Category.Infinity],
        [p_normal_value, m_inf, "inf", Status.OK, Category.Infinity],
        [p_normal_value, p_zero, "0x1p+0", Status.OK, Category.Normal],
        [p_normal_value, m_zero, "0x1p+0", Status.OK, Category.Normal],
        [p_normal_value, qnan, "nan", Status.OK, Category.NaN],
        [p_normal_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_normal_value, p_normal_value, "0x0p+0", Status.OK, Category.Zero],
        [p_normal_value, m_normal_value, "0x1p+1", Status.OK, Category.Normal],
        [p_normal_value, p_largest_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_normal_value, m_largest_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_normal_value, p_smallest_value, "0x1p+0", Status.INEXACT, Category.Normal],
        [p_normal_value, m_smallest_value, "0x1p+0", Status.INEXACT, Category.Normal],
        [p_normal_value, p_smallest_normalized, "0x1p+0", Status.INEXACT, Category.Normal],
        [p_normal_value, m_smallest_normalized, "0x1p+0", Status.INEXACT, Category.Normal],
        [m_normal_value, p_inf, "-inf", Status.OK, Category.Infinity],
        [m_normal_value, m_inf, "inf", Status.OK, Category.Infinity],
        [m_normal_value, p_zero, "-0x1p+0", Status.OK, Category.Normal],
        [m_normal_value, m_zero, "-0x1p+0", Status.OK, Category.Normal],
        [m_normal_value, qnan, "nan", Status.OK, Category.NaN],
        [m_normal_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_normal_value, p_normal_value, "-0x1p+1", Status.OK, Category.Normal],
        [m_normal_value, m_normal_value, "0x0p+0", Status.OK, Category.Zero],
        [m_normal_value, p_largest_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_normal_value, m_largest_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_normal_value, p_smallest_value, "-0x1p+0", Status.INEXACT, Category.Normal],
        [m_normal_value, m_smallest_value, "-0x1p+0", Status.INEXACT, Category.Normal],
        [m_normal_value, p_smallest_normalized, "-0x1p+0", Status.INEXACT, Category.Normal],
        [m_normal_value, m_smallest_normalized, "-0x1p+0", Status.INEXACT, Category.Normal],
        [p_largest_value, p_inf, "-inf", Status.OK, Category.Infinity],
        [p_largest_value, m_inf, "inf", Status.OK, Category.Infinity],
        [p_largest_value, p_zero, "0x1.fffffep+127", Status.OK, Category.Normal],
        [p_largest_value, m_zero, "0x1.fffffep+127", Status.OK, Category.Normal],
        [p_largest_value, qnan, "nan", Status.OK, Category.NaN],
        [p_largest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_largest_value, p_normal_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_largest_value, m_normal_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_largest_value, p_largest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_largest_value, m_largest_value, "inf", overflow_status, Category.Infinity],
        [p_largest_value, p_smallest_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_largest_value, m_smallest_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_largest_value, p_smallest_normalized, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_largest_value, m_smallest_normalized, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_largest_value, p_inf, "-inf", Status.OK, Category.Infinity],
        [m_largest_value, m_inf, "inf", Status.OK, Category.Infinity],
        [m_largest_value, p_zero, "-0x1.fffffep+127", Status.OK, Category.Normal],
        [m_largest_value, m_zero, "-0x1.fffffep+127", Status.OK, Category.Normal],
        [m_largest_value, qnan, "nan", Status.OK, Category.NaN],
        [m_largest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_largest_value, p_normal_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_largest_value, m_normal_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_largest_value, p_largest_value, "-inf", overflow_status, Category.Infinity],
        [m_largest_value, m_largest_value, "0x0p+0", Status.OK, Category.Zero],
        [m_largest_value, p_smallest_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_largest_value, m_smallest_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_largest_value, p_smallest_normalized, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_largest_value, m_smallest_normalized, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_smallest_value, p_inf, "-inf", Status.OK, Category.Infinity],
        [p_smallest_value, m_inf, "inf", Status.OK, Category.Infinity],
        [p_smallest_value, p_zero, "0x1p-149", Status.OK, Category.Normal],
        [p_smallest_value, m_zero, "0x1p-149", Status.OK, Category.Normal],
        [p_smallest_value, qnan, "nan", Status.OK, Category.NaN],
        [p_smallest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_smallest_value, p_normal_value, "-0x1p+0", Status.INEXACT, Category.Normal],
        [p_smallest_value, m_normal_value, "0x1p+0", Status.INEXACT, Category.Normal],
        [p_smallest_value, p_largest_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_smallest_value, m_largest_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_smallest_value, p_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_smallest_value, m_smallest_value, "0x1p-148", Status.OK, Category.Normal],
        [p_smallest_value, p_smallest_normalized, "-0x1.fffffcp-127", Status.OK, Category.Normal],
        [p_smallest_value, m_smallest_normalized, "0x1.000002p-126", Status.OK, Category.Normal],
        [m_smallest_value, p_inf, "-inf", Status.OK, Category.Infinity],
        [m_smallest_value, m_inf, "inf", Status.OK, Category.Infinity],
        [m_smallest_value, p_zero, "-0x1p-149", Status.OK, Category.Normal],
        [m_smallest_value, m_zero, "-0x1p-149", Status.OK, Category.Normal],
        [m_smallest_value, qnan, "nan", Status.OK, Category.NaN],
        [m_smallest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_smallest_value, p_normal_value, "-0x1p+0", Status.INEXACT, Category.Normal],
        [m_smallest_value, m_normal_value, "0x1p+0", Status.INEXACT, Category.Normal],
        [m_smallest_value, p_largest_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_smallest_value, m_largest_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_smallest_value, p_smallest_value, "-0x1p-148", Status.OK, Category.Normal],
        [m_smallest_value, m_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [m_smallest_value, p_smallest_normalized, "-0x1.000002p-126", Status.OK, Category.Normal],
        [m_smallest_value, m_smallest_normalized, "0x1.fffffcp-127", Status.OK, Category.Normal],
        [p_smallest_normalized, p_inf, "-inf", Status.OK, Category.Infinity],
        [p_smallest_normalized, m_inf, "inf", Status.OK, Category.Infinity],
        [p_smallest_normalized, p_zero, "0x1p-126", Status.OK, Category.Normal],
        [p_smallest_normalized, m_zero, "0x1p-126", Status.OK, Category.Normal],
        [p_smallest_normalized, qnan, "nan", Status.OK, Category.NaN],
        [p_smallest_normalized, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_smallest_normalized, p_normal_value, "-0x1p+0", Status.INEXACT, Category.Normal],
        [p_smallest_normalized, m_normal_value, "0x1p+0", Status.INEXACT, Category.Normal],
        [p_smallest_normalized, p_largest_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_smallest_normalized, m_largest_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [p_smallest_normalized, p_smallest_value, "0x1.fffffcp-127", Status.OK, Category.Normal],
        [p_smallest_normalized, m_smallest_value, "0x1.000002p-126", Status.OK, Category.Normal],
        [p_smallest_normalized, p_smallest_normalized, "0x0p+0", Status.OK, Category.Zero],
        [p_smallest_normalized, m_smallest_normalized, "0x1p-125", Status.OK, Category.Normal],
        [m_smallest_normalized, p_inf, "-inf", Status.OK, Category.Infinity],
        [m_smallest_normalized, m_inf, "inf", Status.OK, Category.Infinity],
        [m_smallest_normalized, p_zero, "-0x1p-126", Status.OK, Category.Normal],
        [m_smallest_normalized, m_zero, "-0x1p-126", Status.OK, Category.Normal],
        [m_smallest_normalized, qnan, "nan", Status.OK, Category.NaN],
        [m_smallest_normalized, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_smallest_normalized, p_normal_value, "-0x1p+0", Status.INEXACT, Category.Normal],
        [m_smallest_normalized, m_normal_value, "0x1p+0", Status.INEXACT, Category.Normal],
        [m_smallest_normalized, p_largest_value, "-0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_smallest_normalized, m_largest_value, "0x1.fffffep+127", Status.INEXACT, Category.Normal],
        [m_smallest_normalized, p_smallest_value, "-0x1.000002p-126", Status.OK, Category.Normal],
        [m_smallest_normalized, m_smallest_value, "-0x1.fffffcp-127", Status.OK, Category.Normal],
        [m_smallest_normalized, p_smallest_normalized, "-0x1p-125", Status.OK, Category.Normal],
        [m_smallest_normalized, m_smallest_normalized, "0x0p+0", Status.OK, Category.Zero],
    ];

    for (const [x, y, e_result, e_status, e_category] of special_cases) {
        const r = x.sub(y);
        const status = r.status;
        const result = r.value;
        expect(status).toBe(e_status);
        expect(result.category()).toBe(e_category);
        expect(result.bitwise_eq(parse(Single, e_result))).toBe(true); // "result = {result:?}, case = {case:?}"
    }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:2652 multiply
test("multiply", () => {
    // Test Special Cases against each other and normal values.

    const p_inf = Single.INFINITY;
    const m_inf = Single.INFINITY.neg();
    const p_zero = Single.ZERO;
    const m_zero = Single.ZERO.neg();
    const qnan = Single.NAN;
    const snan = parse(Single, "snan123");
    const p_normal_value = parse(Single, "0x1p+0");
    const m_normal_value = parse(Single, "-0x1p+0");
    const p_largest_value = Single.largest();
    const m_largest_value = Single.largest().neg();
    const p_smallest_value = Single.SMALLEST;
    const m_smallest_value = Single.SMALLEST.neg();
    const p_smallest_normalized = Single.smallest_normalized();
    const m_smallest_normalized = Single.smallest_normalized().neg();

    const max_quad = parse(Quad, "0x1.ffffffffffffffffffffffffffffp+16383");
    const min_quad = parse(Quad, "0x0.0000000000000000000000000001p-16382");
    const n_min_quad = parse(Quad, "-0x0.0000000000000000000000000001p-16382");

    const overflow_status = (Status.OVERFLOW | Status.INEXACT) as Status;
    const underflow_status = (Status.UNDERFLOW | Status.INEXACT) as Status;

    const single_special_cases: [Single, Single, string, Status, Category][] = [
        [p_inf, p_inf, "inf", Status.OK, Category.Infinity],
        [p_inf, m_inf, "-inf", Status.OK, Category.Infinity],
        [p_inf, p_zero, "nan", Status.INVALID_OP, Category.NaN],
        [p_inf, m_zero, "nan", Status.INVALID_OP, Category.NaN],
        [p_inf, qnan, "nan", Status.OK, Category.NaN],
        [p_inf, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_inf, p_normal_value, "inf", Status.OK, Category.Infinity],
        [p_inf, m_normal_value, "-inf", Status.OK, Category.Infinity],
        [p_inf, p_largest_value, "inf", Status.OK, Category.Infinity],
        [p_inf, m_largest_value, "-inf", Status.OK, Category.Infinity],
        [p_inf, p_smallest_value, "inf", Status.OK, Category.Infinity],
        [p_inf, m_smallest_value, "-inf", Status.OK, Category.Infinity],
        [p_inf, p_smallest_normalized, "inf", Status.OK, Category.Infinity],
        [p_inf, m_smallest_normalized, "-inf", Status.OK, Category.Infinity],
        [m_inf, p_inf, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_inf, "inf", Status.OK, Category.Infinity],
        [m_inf, p_zero, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, m_zero, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, qnan, "nan", Status.OK, Category.NaN],
        [m_inf, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_inf, p_normal_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_normal_value, "inf", Status.OK, Category.Infinity],
        [m_inf, p_largest_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_largest_value, "inf", Status.OK, Category.Infinity],
        [m_inf, p_smallest_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_smallest_value, "inf", Status.OK, Category.Infinity],
        [m_inf, p_smallest_normalized, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_smallest_normalized, "inf", Status.OK, Category.Infinity],
        [p_zero, p_inf, "nan", Status.INVALID_OP, Category.NaN],
        [p_zero, m_inf, "nan", Status.INVALID_OP, Category.NaN],
        [p_zero, p_zero, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, m_zero, "-0x0p+0", Status.OK, Category.Zero],
        [p_zero, qnan, "nan", Status.OK, Category.NaN],
        [p_zero, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_zero, p_normal_value, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, m_normal_value, "-0x0p+0", Status.OK, Category.Zero],
        [p_zero, p_largest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, m_largest_value, "-0x0p+0", Status.OK, Category.Zero],
        [p_zero, p_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, m_smallest_value, "-0x0p+0", Status.OK, Category.Zero],
        [p_zero, p_smallest_normalized, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, m_smallest_normalized, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, p_inf, "nan", Status.INVALID_OP, Category.NaN],
        [m_zero, m_inf, "nan", Status.INVALID_OP, Category.NaN],
        [m_zero, p_zero, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, m_zero, "0x0p+0", Status.OK, Category.Zero],
        [m_zero, qnan, "nan", Status.OK, Category.NaN],
        [m_zero, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_zero, p_normal_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, m_normal_value, "0x0p+0", Status.OK, Category.Zero],
        [m_zero, p_largest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, m_largest_value, "0x0p+0", Status.OK, Category.Zero],
        [m_zero, p_smallest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, m_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [m_zero, p_smallest_normalized, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, m_smallest_normalized, "0x0p+0", Status.OK, Category.Zero],
        [qnan, p_inf, "nan", Status.OK, Category.NaN],
        [qnan, m_inf, "nan", Status.OK, Category.NaN],
        [qnan, p_zero, "nan", Status.OK, Category.NaN],
        [qnan, m_zero, "nan", Status.OK, Category.NaN],
        [qnan, qnan, "nan", Status.OK, Category.NaN],
        [qnan, snan, "nan", Status.INVALID_OP, Category.NaN],
        [qnan, p_normal_value, "nan", Status.OK, Category.NaN],
        [qnan, m_normal_value, "nan", Status.OK, Category.NaN],
        [qnan, p_largest_value, "nan", Status.OK, Category.NaN],
        [qnan, m_largest_value, "nan", Status.OK, Category.NaN],
        [qnan, p_smallest_value, "nan", Status.OK, Category.NaN],
        [qnan, m_smallest_value, "nan", Status.OK, Category.NaN],
        [qnan, p_smallest_normalized, "nan", Status.OK, Category.NaN],
        [qnan, m_smallest_normalized, "nan", Status.OK, Category.NaN],
        [snan, p_inf, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_inf, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_zero, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_zero, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, qnan, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_normal_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_normal_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_largest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_largest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_smallest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_smallest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_smallest_normalized, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_smallest_normalized, "nan123", Status.INVALID_OP, Category.NaN],
        [p_normal_value, p_inf, "inf", Status.OK, Category.Infinity],
        [p_normal_value, m_inf, "-inf", Status.OK, Category.Infinity],
        [p_normal_value, p_zero, "0x0p+0", Status.OK, Category.Zero],
        [p_normal_value, m_zero, "-0x0p+0", Status.OK, Category.Zero],
        [p_normal_value, qnan, "nan", Status.OK, Category.NaN],
        [p_normal_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_normal_value, p_normal_value, "0x1p+0", Status.OK, Category.Normal],
        [p_normal_value, m_normal_value, "-0x1p+0", Status.OK, Category.Normal],
        [p_normal_value, p_largest_value, "0x1.fffffep+127", Status.OK, Category.Normal],
        [p_normal_value, m_largest_value, "-0x1.fffffep+127", Status.OK, Category.Normal],
        [p_normal_value, p_smallest_value, "0x1p-149", Status.OK, Category.Normal],
        [p_normal_value, m_smallest_value, "-0x1p-149", Status.OK, Category.Normal],
        [p_normal_value, p_smallest_normalized, "0x1p-126", Status.OK, Category.Normal],
        [p_normal_value, m_smallest_normalized, "-0x1p-126", Status.OK, Category.Normal],
        [m_normal_value, p_inf, "-inf", Status.OK, Category.Infinity],
        [m_normal_value, m_inf, "inf", Status.OK, Category.Infinity],
        [m_normal_value, p_zero, "-0x0p+0", Status.OK, Category.Zero],
        [m_normal_value, m_zero, "0x0p+0", Status.OK, Category.Zero],
        [m_normal_value, qnan, "nan", Status.OK, Category.NaN],
        [m_normal_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_normal_value, p_normal_value, "-0x1p+0", Status.OK, Category.Normal],
        [m_normal_value, m_normal_value, "0x1p+0", Status.OK, Category.Normal],
        [m_normal_value, p_largest_value, "-0x1.fffffep+127", Status.OK, Category.Normal],
        [m_normal_value, m_largest_value, "0x1.fffffep+127", Status.OK, Category.Normal],
        [m_normal_value, p_smallest_value, "-0x1p-149", Status.OK, Category.Normal],
        [m_normal_value, m_smallest_value, "0x1p-149", Status.OK, Category.Normal],
        [m_normal_value, p_smallest_normalized, "-0x1p-126", Status.OK, Category.Normal],
        [m_normal_value, m_smallest_normalized, "0x1p-126", Status.OK, Category.Normal],
        [p_largest_value, p_inf, "inf", Status.OK, Category.Infinity],
        [p_largest_value, m_inf, "-inf", Status.OK, Category.Infinity],
        [p_largest_value, p_zero, "0x0p+0", Status.OK, Category.Zero],
        [p_largest_value, m_zero, "-0x0p+0", Status.OK, Category.Zero],
        [p_largest_value, qnan, "nan", Status.OK, Category.NaN],
        [p_largest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_largest_value, p_normal_value, "0x1.fffffep+127", Status.OK, Category.Normal],
        [p_largest_value, m_normal_value, "-0x1.fffffep+127", Status.OK, Category.Normal],
        [p_largest_value, p_largest_value, "inf", overflow_status, Category.Infinity],
        [p_largest_value, m_largest_value, "-inf", overflow_status, Category.Infinity],
        [p_largest_value, p_smallest_value, "0x1.fffffep-22", Status.OK, Category.Normal],
        [p_largest_value, m_smallest_value, "-0x1.fffffep-22", Status.OK, Category.Normal],
        [p_largest_value, p_smallest_normalized, "0x1.fffffep+1", Status.OK, Category.Normal],
        [p_largest_value, m_smallest_normalized, "-0x1.fffffep+1", Status.OK, Category.Normal],
        [m_largest_value, p_inf, "-inf", Status.OK, Category.Infinity],
        [m_largest_value, m_inf, "inf", Status.OK, Category.Infinity],
        [m_largest_value, p_zero, "-0x0p+0", Status.OK, Category.Zero],
        [m_largest_value, m_zero, "0x0p+0", Status.OK, Category.Zero],
        [m_largest_value, qnan, "nan", Status.OK, Category.NaN],
        [m_largest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_largest_value, p_normal_value, "-0x1.fffffep+127", Status.OK, Category.Normal],
        [m_largest_value, m_normal_value, "0x1.fffffep+127", Status.OK, Category.Normal],
        [m_largest_value, p_largest_value, "-inf", overflow_status, Category.Infinity],
        [m_largest_value, m_largest_value, "inf", overflow_status, Category.Infinity],
        [m_largest_value, p_smallest_value, "-0x1.fffffep-22", Status.OK, Category.Normal],
        [m_largest_value, m_smallest_value, "0x1.fffffep-22", Status.OK, Category.Normal],
        [m_largest_value, p_smallest_normalized, "-0x1.fffffep+1", Status.OK, Category.Normal],
        [m_largest_value, m_smallest_normalized, "0x1.fffffep+1", Status.OK, Category.Normal],
        [p_smallest_value, p_inf, "inf", Status.OK, Category.Infinity],
        [p_smallest_value, m_inf, "-inf", Status.OK, Category.Infinity],
        [p_smallest_value, p_zero, "0x0p+0", Status.OK, Category.Zero],
        [p_smallest_value, m_zero, "-0x0p+0", Status.OK, Category.Zero],
        [p_smallest_value, qnan, "nan", Status.OK, Category.NaN],
        [p_smallest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_smallest_value, p_normal_value, "0x1p-149", Status.OK, Category.Normal],
        [p_smallest_value, m_normal_value, "-0x1p-149", Status.OK, Category.Normal],
        [p_smallest_value, p_largest_value, "0x1.fffffep-22", Status.OK, Category.Normal],
        [p_smallest_value, m_largest_value, "-0x1.fffffep-22", Status.OK, Category.Normal],
        [p_smallest_value, p_smallest_value, "0x0p+0", underflow_status, Category.Zero],
        [p_smallest_value, m_smallest_value, "-0x0p+0", underflow_status, Category.Zero],
        [p_smallest_value, p_smallest_normalized, "0x0p+0", underflow_status, Category.Zero],
        [p_smallest_value, m_smallest_normalized, "-0x0p+0", underflow_status, Category.Zero],
        [m_smallest_value, p_inf, "-inf", Status.OK, Category.Infinity],
        [m_smallest_value, m_inf, "inf", Status.OK, Category.Infinity],
        [m_smallest_value, p_zero, "-0x0p+0", Status.OK, Category.Zero],
        [m_smallest_value, m_zero, "0x0p+0", Status.OK, Category.Zero],
        [m_smallest_value, qnan, "nan", Status.OK, Category.NaN],
        [m_smallest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_smallest_value, p_normal_value, "-0x1p-149", Status.OK, Category.Normal],
        [m_smallest_value, m_normal_value, "0x1p-149", Status.OK, Category.Normal],
        [m_smallest_value, p_largest_value, "-0x1.fffffep-22", Status.OK, Category.Normal],
        [m_smallest_value, m_largest_value, "0x1.fffffep-22", Status.OK, Category.Normal],
        [m_smallest_value, p_smallest_value, "-0x0p+0", underflow_status, Category.Zero],
        [m_smallest_value, m_smallest_value, "0x0p+0", underflow_status, Category.Zero],
        [m_smallest_value, p_smallest_normalized, "-0x0p+0", underflow_status, Category.Zero],
        [m_smallest_value, m_smallest_normalized, "0x0p+0", underflow_status, Category.Zero],
        [p_smallest_normalized, p_inf, "inf", Status.OK, Category.Infinity],
        [p_smallest_normalized, m_inf, "-inf", Status.OK, Category.Infinity],
        [p_smallest_normalized, p_zero, "0x0p+0", Status.OK, Category.Zero],
        [p_smallest_normalized, m_zero, "-0x0p+0", Status.OK, Category.Zero],
        [p_smallest_normalized, qnan, "nan", Status.OK, Category.NaN],
        [p_smallest_normalized, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_smallest_normalized, p_normal_value, "0x1p-126", Status.OK, Category.Normal],
        [p_smallest_normalized, m_normal_value, "-0x1p-126", Status.OK, Category.Normal],
        [p_smallest_normalized, p_largest_value, "0x1.fffffep+1", Status.OK, Category.Normal],
        [p_smallest_normalized, m_largest_value, "-0x1.fffffep+1", Status.OK, Category.Normal],
        [p_smallest_normalized, p_smallest_value, "0x0p+0", underflow_status, Category.Zero],
        [p_smallest_normalized, m_smallest_value, "-0x0p+0", underflow_status, Category.Zero],
        [p_smallest_normalized, p_smallest_normalized, "0x0p+0", underflow_status, Category.Zero],
        [p_smallest_normalized, m_smallest_normalized, "-0x0p+0", underflow_status, Category.Zero],
        [m_smallest_normalized, p_inf, "-inf", Status.OK, Category.Infinity],
        [m_smallest_normalized, m_inf, "inf", Status.OK, Category.Infinity],
        [m_smallest_normalized, p_zero, "-0x0p+0", Status.OK, Category.Zero],
        [m_smallest_normalized, m_zero, "0x0p+0", Status.OK, Category.Zero],
        [m_smallest_normalized, qnan, "nan", Status.OK, Category.NaN],
        [m_smallest_normalized, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_smallest_normalized, p_normal_value, "-0x1p-126", Status.OK, Category.Normal],
        [m_smallest_normalized, m_normal_value, "0x1p-126", Status.OK, Category.Normal],
        [m_smallest_normalized, p_largest_value, "-0x1.fffffep+1", Status.OK, Category.Normal],
        [m_smallest_normalized, m_largest_value, "0x1.fffffep+1", Status.OK, Category.Normal],
        [m_smallest_normalized, p_smallest_value, "-0x0p+0", underflow_status, Category.Zero],
        [m_smallest_normalized, m_smallest_value, "0x0p+0", underflow_status, Category.Zero],
        [m_smallest_normalized, p_smallest_normalized, "-0x0p+0", underflow_status, Category.Zero],
        [m_smallest_normalized, m_smallest_normalized, "0x0p+0", underflow_status, Category.Zero],
    ];
    const quad_special_cases: [Quad, Quad, string, Status, Category, Round][] = [
        [
            max_quad,
            min_quad,
            "0x1.ffffffffffffffffffffffffffffp-111",
            Status.OK,
            Category.Normal,
            Round.NearestTiesToEven,
        ],
        [
            max_quad,
            min_quad,
            "0x1.ffffffffffffffffffffffffffffp-111",
            Status.OK,
            Category.Normal,
            Round.TowardPositive,
        ],
        [
            max_quad,
            min_quad,
            "0x1.ffffffffffffffffffffffffffffp-111",
            Status.OK,
            Category.Normal,
            Round.TowardNegative,
        ],
        [max_quad, min_quad, "0x1.ffffffffffffffffffffffffffffp-111", Status.OK, Category.Normal, Round.TowardZero],
        [
            max_quad,
            min_quad,
            "0x1.ffffffffffffffffffffffffffffp-111",
            Status.OK,
            Category.Normal,
            Round.NearestTiesToAway,
        ],
        [
            max_quad,
            n_min_quad,
            "-0x1.ffffffffffffffffffffffffffffp-111",
            Status.OK,
            Category.Normal,
            Round.NearestTiesToEven,
        ],
        [
            max_quad,
            n_min_quad,
            "-0x1.ffffffffffffffffffffffffffffp-111",
            Status.OK,
            Category.Normal,
            Round.TowardPositive,
        ],
        [
            max_quad,
            n_min_quad,
            "-0x1.ffffffffffffffffffffffffffffp-111",
            Status.OK,
            Category.Normal,
            Round.TowardNegative,
        ],
        [
            max_quad,
            n_min_quad,
            "-0x1.ffffffffffffffffffffffffffffp-111",
            Status.OK,
            Category.Normal,
            Round.TowardZero,
        ],
        [
            max_quad,
            n_min_quad,
            "-0x1.ffffffffffffffffffffffffffffp-111",
            Status.OK,
            Category.Normal,
            Round.NearestTiesToAway,
        ],
        [max_quad, max_quad, "inf", overflow_status, Category.Infinity, Round.NearestTiesToEven],
        [max_quad, max_quad, "inf", overflow_status, Category.Infinity, Round.TowardPositive],
        [
            max_quad,
            max_quad,
            "0x1.ffffffffffffffffffffffffffffp+16383",
            Status.INEXACT,
            Category.Normal,
            Round.TowardNegative,
        ],
        [
            max_quad,
            max_quad,
            "0x1.ffffffffffffffffffffffffffffp+16383",
            Status.INEXACT,
            Category.Normal,
            Round.TowardZero,
        ],
        [max_quad, max_quad, "inf", overflow_status, Category.Infinity, Round.NearestTiesToAway],
        [min_quad, min_quad, "0", underflow_status, Category.Zero, Round.NearestTiesToEven],
        [
            min_quad,
            min_quad,
            "0x0.0000000000000000000000000001p-16382",
            underflow_status,
            Category.Normal,
            Round.TowardPositive,
        ],
        [min_quad, min_quad, "0", underflow_status, Category.Zero, Round.TowardNegative],
        [min_quad, min_quad, "0", underflow_status, Category.Zero, Round.TowardZero],
        [min_quad, min_quad, "0", underflow_status, Category.Zero, Round.NearestTiesToAway],
        [min_quad, n_min_quad, "-0", underflow_status, Category.Zero, Round.NearestTiesToEven],
        [min_quad, n_min_quad, "-0", underflow_status, Category.Zero, Round.TowardPositive],
        [
            min_quad,
            n_min_quad,
            "-0x0.0000000000000000000000000001p-16382",
            underflow_status,
            Category.Normal,
            Round.TowardNegative,
        ],
        [min_quad, n_min_quad, "-0", underflow_status, Category.Zero, Round.TowardZero],
        [min_quad, n_min_quad, "-0", underflow_status, Category.Zero, Round.NearestTiesToAway],
    ];

    for (const [x, y, e_result, e_status, e_category] of single_special_cases) {
        const r = x.mul(y);
        const status = r.status;
        const result = r.value;
        expect(status).toBe(e_status);
        expect(result.category()).toBe(e_category);
        expect(result.bitwise_eq(parse(Single, e_result))).toBe(true); // "result = {result:?}, case = {case:?}"
    }
    for (const [x, y, e_result, e_status, e_category, round] of quad_special_cases) {
        const r = x.mul_r(y, round);
        const status = r.status;
        const result = r.value;
        expect(status).toBe(e_status);
        expect(result.category()).toBe(e_category);
        expect(result.bitwise_eq(parse(Quad, e_result))).toBe(true); // "result = {result:?}, case = {case:?}"
    }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:3011 divide
test("divide", () => {
    // Test Special Cases against each other and normal values.

    const p_inf = Single.INFINITY;
    const m_inf = Single.INFINITY.neg();
    const p_zero = Single.ZERO;
    const m_zero = Single.ZERO.neg();
    const qnan = Single.NAN;
    const snan = parse(Single, "snan123");
    const p_normal_value = parse(Single, "0x1p+0");
    const m_normal_value = parse(Single, "-0x1p+0");
    const p_largest_value = Single.largest();
    const m_largest_value = Single.largest().neg();
    const p_smallest_value = Single.SMALLEST;
    const m_smallest_value = Single.SMALLEST.neg();
    const p_smallest_normalized = Single.smallest_normalized();
    const m_smallest_normalized = Single.smallest_normalized().neg();

    const max_quad = parse(Quad, "0x1.ffffffffffffffffffffffffffffp+16383");
    const min_quad = parse(Quad, "0x0.0000000000000000000000000001p-16382");
    const n_min_quad = parse(Quad, "-0x0.0000000000000000000000000001p-16382");

    const overflow_status = (Status.OVERFLOW | Status.INEXACT) as Status;
    const underflow_status = (Status.UNDERFLOW | Status.INEXACT) as Status;

    const single_special_cases: [Single, Single, string, Status, Category][] = [
        [p_inf, p_inf, "nan", Status.INVALID_OP, Category.NaN],
        [p_inf, m_inf, "nan", Status.INVALID_OP, Category.NaN],
        [p_inf, p_zero, "inf", Status.OK, Category.Infinity],
        [p_inf, m_zero, "-inf", Status.OK, Category.Infinity],
        [p_inf, qnan, "nan", Status.OK, Category.NaN],
        [p_inf, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_inf, p_normal_value, "inf", Status.OK, Category.Infinity],
        [p_inf, m_normal_value, "-inf", Status.OK, Category.Infinity],
        [p_inf, p_largest_value, "inf", Status.OK, Category.Infinity],
        [p_inf, m_largest_value, "-inf", Status.OK, Category.Infinity],
        [p_inf, p_smallest_value, "inf", Status.OK, Category.Infinity],
        [p_inf, m_smallest_value, "-inf", Status.OK, Category.Infinity],
        [p_inf, p_smallest_normalized, "inf", Status.OK, Category.Infinity],
        [p_inf, m_smallest_normalized, "-inf", Status.OK, Category.Infinity],
        [m_inf, p_inf, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, m_inf, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, p_zero, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_zero, "inf", Status.OK, Category.Infinity],
        [m_inf, qnan, "nan", Status.OK, Category.NaN],
        [m_inf, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_inf, p_normal_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_normal_value, "inf", Status.OK, Category.Infinity],
        [m_inf, p_largest_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_largest_value, "inf", Status.OK, Category.Infinity],
        [m_inf, p_smallest_value, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_smallest_value, "inf", Status.OK, Category.Infinity],
        [m_inf, p_smallest_normalized, "-inf", Status.OK, Category.Infinity],
        [m_inf, m_smallest_normalized, "inf", Status.OK, Category.Infinity],
        [p_zero, p_inf, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, m_inf, "-0x0p+0", Status.OK, Category.Zero],
        [p_zero, p_zero, "nan", Status.INVALID_OP, Category.NaN],
        [p_zero, m_zero, "nan", Status.INVALID_OP, Category.NaN],
        [p_zero, qnan, "nan", Status.OK, Category.NaN],
        [p_zero, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_zero, p_normal_value, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, m_normal_value, "-0x0p+0", Status.OK, Category.Zero],
        [p_zero, p_largest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, m_largest_value, "-0x0p+0", Status.OK, Category.Zero],
        [p_zero, p_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, m_smallest_value, "-0x0p+0", Status.OK, Category.Zero],
        [p_zero, p_smallest_normalized, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, m_smallest_normalized, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, p_inf, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, m_inf, "0x0p+0", Status.OK, Category.Zero],
        [m_zero, p_zero, "nan", Status.INVALID_OP, Category.NaN],
        [m_zero, m_zero, "nan", Status.INVALID_OP, Category.NaN],
        [m_zero, qnan, "nan", Status.OK, Category.NaN],
        [m_zero, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_zero, p_normal_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, m_normal_value, "0x0p+0", Status.OK, Category.Zero],
        [m_zero, p_largest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, m_largest_value, "0x0p+0", Status.OK, Category.Zero],
        [m_zero, p_smallest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, m_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [m_zero, p_smallest_normalized, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, m_smallest_normalized, "0x0p+0", Status.OK, Category.Zero],
        [qnan, p_inf, "nan", Status.OK, Category.NaN],
        [qnan, m_inf, "nan", Status.OK, Category.NaN],
        [qnan, p_zero, "nan", Status.OK, Category.NaN],
        [qnan, m_zero, "nan", Status.OK, Category.NaN],
        [qnan, qnan, "nan", Status.OK, Category.NaN],
        [qnan, snan, "nan", Status.INVALID_OP, Category.NaN],
        [qnan, p_normal_value, "nan", Status.OK, Category.NaN],
        [qnan, m_normal_value, "nan", Status.OK, Category.NaN],
        [qnan, p_largest_value, "nan", Status.OK, Category.NaN],
        [qnan, m_largest_value, "nan", Status.OK, Category.NaN],
        [qnan, p_smallest_value, "nan", Status.OK, Category.NaN],
        [qnan, m_smallest_value, "nan", Status.OK, Category.NaN],
        [qnan, p_smallest_normalized, "nan", Status.OK, Category.NaN],
        [qnan, m_smallest_normalized, "nan", Status.OK, Category.NaN],
        [snan, p_inf, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_inf, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_zero, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_zero, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, qnan, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_normal_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_normal_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_largest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_largest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_smallest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_smallest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_smallest_normalized, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_smallest_normalized, "nan123", Status.INVALID_OP, Category.NaN],
        [p_normal_value, p_inf, "0x0p+0", Status.OK, Category.Zero],
        [p_normal_value, m_inf, "-0x0p+0", Status.OK, Category.Zero],
        [p_normal_value, p_zero, "inf", Status.DIV_BY_ZERO, Category.Infinity],
        [p_normal_value, m_zero, "-inf", Status.DIV_BY_ZERO, Category.Infinity],
        [p_normal_value, qnan, "nan", Status.OK, Category.NaN],
        [p_normal_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_normal_value, p_normal_value, "0x1p+0", Status.OK, Category.Normal],
        [p_normal_value, m_normal_value, "-0x1p+0", Status.OK, Category.Normal],
        [p_normal_value, p_largest_value, "0x1p-128", underflow_status, Category.Normal],
        [p_normal_value, m_largest_value, "-0x1p-128", underflow_status, Category.Normal],
        [p_normal_value, p_smallest_value, "inf", overflow_status, Category.Infinity],
        [p_normal_value, m_smallest_value, "-inf", overflow_status, Category.Infinity],
        [p_normal_value, p_smallest_normalized, "0x1p+126", Status.OK, Category.Normal],
        [p_normal_value, m_smallest_normalized, "-0x1p+126", Status.OK, Category.Normal],
        [m_normal_value, p_inf, "-0x0p+0", Status.OK, Category.Zero],
        [m_normal_value, m_inf, "0x0p+0", Status.OK, Category.Zero],
        [m_normal_value, p_zero, "-inf", Status.DIV_BY_ZERO, Category.Infinity],
        [m_normal_value, m_zero, "inf", Status.DIV_BY_ZERO, Category.Infinity],
        [m_normal_value, qnan, "nan", Status.OK, Category.NaN],
        [m_normal_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_normal_value, p_normal_value, "-0x1p+0", Status.OK, Category.Normal],
        [m_normal_value, m_normal_value, "0x1p+0", Status.OK, Category.Normal],
        [m_normal_value, p_largest_value, "-0x1p-128", underflow_status, Category.Normal],
        [m_normal_value, m_largest_value, "0x1p-128", underflow_status, Category.Normal],
        [m_normal_value, p_smallest_value, "-inf", overflow_status, Category.Infinity],
        [m_normal_value, m_smallest_value, "inf", overflow_status, Category.Infinity],
        [m_normal_value, p_smallest_normalized, "-0x1p+126", Status.OK, Category.Normal],
        [m_normal_value, m_smallest_normalized, "0x1p+126", Status.OK, Category.Normal],
        [p_largest_value, p_inf, "0x0p+0", Status.OK, Category.Zero],
        [p_largest_value, m_inf, "-0x0p+0", Status.OK, Category.Zero],
        [p_largest_value, p_zero, "inf", Status.DIV_BY_ZERO, Category.Infinity],
        [p_largest_value, m_zero, "-inf", Status.DIV_BY_ZERO, Category.Infinity],
        [p_largest_value, qnan, "nan", Status.OK, Category.NaN],
        [p_largest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_largest_value, p_normal_value, "0x1.fffffep+127", Status.OK, Category.Normal],
        [p_largest_value, m_normal_value, "-0x1.fffffep+127", Status.OK, Category.Normal],
        [p_largest_value, p_largest_value, "0x1p+0", Status.OK, Category.Normal],
        [p_largest_value, m_largest_value, "-0x1p+0", Status.OK, Category.Normal],
        [p_largest_value, p_smallest_value, "inf", overflow_status, Category.Infinity],
        [p_largest_value, m_smallest_value, "-inf", overflow_status, Category.Infinity],
        [p_largest_value, p_smallest_normalized, "inf", overflow_status, Category.Infinity],
        [p_largest_value, m_smallest_normalized, "-inf", overflow_status, Category.Infinity],
        [m_largest_value, p_inf, "-0x0p+0", Status.OK, Category.Zero],
        [m_largest_value, m_inf, "0x0p+0", Status.OK, Category.Zero],
        [m_largest_value, p_zero, "-inf", Status.DIV_BY_ZERO, Category.Infinity],
        [m_largest_value, m_zero, "inf", Status.DIV_BY_ZERO, Category.Infinity],
        [m_largest_value, qnan, "nan", Status.OK, Category.NaN],
        [m_largest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_largest_value, p_normal_value, "-0x1.fffffep+127", Status.OK, Category.Normal],
        [m_largest_value, m_normal_value, "0x1.fffffep+127", Status.OK, Category.Normal],
        [m_largest_value, p_largest_value, "-0x1p+0", Status.OK, Category.Normal],
        [m_largest_value, m_largest_value, "0x1p+0", Status.OK, Category.Normal],
        [m_largest_value, p_smallest_value, "-inf", overflow_status, Category.Infinity],
        [m_largest_value, m_smallest_value, "inf", overflow_status, Category.Infinity],
        [m_largest_value, p_smallest_normalized, "-inf", overflow_status, Category.Infinity],
        [m_largest_value, m_smallest_normalized, "inf", overflow_status, Category.Infinity],
        [p_smallest_value, p_inf, "0x0p+0", Status.OK, Category.Zero],
        [p_smallest_value, m_inf, "-0x0p+0", Status.OK, Category.Zero],
        [p_smallest_value, p_zero, "inf", Status.DIV_BY_ZERO, Category.Infinity],
        [p_smallest_value, m_zero, "-inf", Status.DIV_BY_ZERO, Category.Infinity],
        [p_smallest_value, qnan, "nan", Status.OK, Category.NaN],
        [p_smallest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_smallest_value, p_normal_value, "0x1p-149", Status.OK, Category.Normal],
        [p_smallest_value, m_normal_value, "-0x1p-149", Status.OK, Category.Normal],
        [p_smallest_value, p_largest_value, "0x0p+0", underflow_status, Category.Zero],
        [p_smallest_value, m_largest_value, "-0x0p+0", underflow_status, Category.Zero],
        [p_smallest_value, p_smallest_value, "0x1p+0", Status.OK, Category.Normal],
        [p_smallest_value, m_smallest_value, "-0x1p+0", Status.OK, Category.Normal],
        [p_smallest_value, p_smallest_normalized, "0x1p-23", Status.OK, Category.Normal],
        [p_smallest_value, m_smallest_normalized, "-0x1p-23", Status.OK, Category.Normal],
        [m_smallest_value, p_inf, "-0x0p+0", Status.OK, Category.Zero],
        [m_smallest_value, m_inf, "0x0p+0", Status.OK, Category.Zero],
        [m_smallest_value, p_zero, "-inf", Status.DIV_BY_ZERO, Category.Infinity],
        [m_smallest_value, m_zero, "inf", Status.DIV_BY_ZERO, Category.Infinity],
        [m_smallest_value, qnan, "nan", Status.OK, Category.NaN],
        [m_smallest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_smallest_value, p_normal_value, "-0x1p-149", Status.OK, Category.Normal],
        [m_smallest_value, m_normal_value, "0x1p-149", Status.OK, Category.Normal],
        [m_smallest_value, p_largest_value, "-0x0p+0", underflow_status, Category.Zero],
        [m_smallest_value, m_largest_value, "0x0p+0", underflow_status, Category.Zero],
        [m_smallest_value, p_smallest_value, "-0x1p+0", Status.OK, Category.Normal],
        [m_smallest_value, m_smallest_value, "0x1p+0", Status.OK, Category.Normal],
        [m_smallest_value, p_smallest_normalized, "-0x1p-23", Status.OK, Category.Normal],
        [m_smallest_value, m_smallest_normalized, "0x1p-23", Status.OK, Category.Normal],
        [p_smallest_normalized, p_inf, "0x0p+0", Status.OK, Category.Zero],
        [p_smallest_normalized, m_inf, "-0x0p+0", Status.OK, Category.Zero],
        [p_smallest_normalized, p_zero, "inf", Status.DIV_BY_ZERO, Category.Infinity],
        [p_smallest_normalized, m_zero, "-inf", Status.DIV_BY_ZERO, Category.Infinity],
        [p_smallest_normalized, qnan, "nan", Status.OK, Category.NaN],
        [p_smallest_normalized, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_smallest_normalized, p_normal_value, "0x1p-126", Status.OK, Category.Normal],
        [p_smallest_normalized, m_normal_value, "-0x1p-126", Status.OK, Category.Normal],
        [p_smallest_normalized, p_largest_value, "0x0p+0", underflow_status, Category.Zero],
        [p_smallest_normalized, m_largest_value, "-0x0p+0", underflow_status, Category.Zero],
        [p_smallest_normalized, p_smallest_value, "0x1p+23", Status.OK, Category.Normal],
        [p_smallest_normalized, m_smallest_value, "-0x1p+23", Status.OK, Category.Normal],
        [p_smallest_normalized, p_smallest_normalized, "0x1p+0", Status.OK, Category.Normal],
        [p_smallest_normalized, m_smallest_normalized, "-0x1p+0", Status.OK, Category.Normal],
        [m_smallest_normalized, p_inf, "-0x0p+0", Status.OK, Category.Zero],
        [m_smallest_normalized, m_inf, "0x0p+0", Status.OK, Category.Zero],
        [m_smallest_normalized, p_zero, "-inf", Status.DIV_BY_ZERO, Category.Infinity],
        [m_smallest_normalized, m_zero, "inf", Status.DIV_BY_ZERO, Category.Infinity],
        [m_smallest_normalized, qnan, "nan", Status.OK, Category.NaN],
        [m_smallest_normalized, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_smallest_normalized, p_normal_value, "-0x1p-126", Status.OK, Category.Normal],
        [m_smallest_normalized, m_normal_value, "0x1p-126", Status.OK, Category.Normal],
        [m_smallest_normalized, p_largest_value, "-0x0p+0", underflow_status, Category.Zero],
        [m_smallest_normalized, m_largest_value, "0x0p+0", underflow_status, Category.Zero],
        [m_smallest_normalized, p_smallest_value, "-0x1p+23", Status.OK, Category.Normal],
        [m_smallest_normalized, m_smallest_value, "0x1p+23", Status.OK, Category.Normal],
        [m_smallest_normalized, p_smallest_normalized, "-0x1p+0", Status.OK, Category.Normal],
        [m_smallest_normalized, m_smallest_normalized, "0x1p+0", Status.OK, Category.Normal],
    ];
    const quad_special_cases: [Quad, Quad, string, Status, Category, Round][] = [
        [max_quad, n_min_quad, "-inf", overflow_status, Category.Infinity, Round.NearestTiesToEven],
        [
            max_quad,
            n_min_quad,
            "-0x1.ffffffffffffffffffffffffffffp+16383",
            Status.INEXACT,
            Category.Normal,
            Round.TowardPositive,
        ],
        [max_quad, n_min_quad, "-inf", overflow_status, Category.Infinity, Round.TowardNegative],
        [
            max_quad,
            n_min_quad,
            "-0x1.ffffffffffffffffffffffffffffp+16383",
            Status.INEXACT,
            Category.Normal,
            Round.TowardZero,
        ],
        [max_quad, n_min_quad, "-inf", overflow_status, Category.Infinity, Round.NearestTiesToAway],
        [min_quad, max_quad, "0", underflow_status, Category.Zero, Round.NearestTiesToEven],
        [
            min_quad,
            max_quad,
            "0x0.0000000000000000000000000001p-16382",
            underflow_status,
            Category.Normal,
            Round.TowardPositive,
        ],
        [min_quad, max_quad, "0", underflow_status, Category.Zero, Round.TowardNegative],
        [min_quad, max_quad, "0", underflow_status, Category.Zero, Round.TowardZero],
        [min_quad, max_quad, "0", underflow_status, Category.Zero, Round.NearestTiesToAway],
        [n_min_quad, max_quad, "-0", underflow_status, Category.Zero, Round.NearestTiesToEven],
        [n_min_quad, max_quad, "-0", underflow_status, Category.Zero, Round.TowardPositive],
        [
            n_min_quad,
            max_quad,
            "-0x0.0000000000000000000000000001p-16382",
            underflow_status,
            Category.Normal,
            Round.TowardNegative,
        ],
        [n_min_quad, max_quad, "-0", underflow_status, Category.Zero, Round.TowardZero],
        [n_min_quad, max_quad, "-0", underflow_status, Category.Zero, Round.NearestTiesToAway],
    ];

    for (const [x, y, e_result, e_status, e_category] of single_special_cases) {
        const r = x.div(y);
        const status = r.status;
        const result = r.value;
        expect(status).toBe(e_status);
        expect(result.category()).toBe(e_category);
        expect(result.bitwise_eq(parse(Single, e_result))).toBe(true); // "result = {result:?}, case = {case:?}"
    }
    for (const [x, y, e_result, e_status, e_category, round] of quad_special_cases) {
        const r = x.div_r(y, round);
        const status = r.status;
        const result = r.value;
        expect(status).toBe(e_status);
        expect(result.category()).toBe(e_category);
        expect(result.bitwise_eq(parse(Quad, e_result))).toBe(true); // "result = {result:?}, case = {case:?}"
    }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:3297 operator_overloads
test("operator_overloads", () => {
  // This is mostly testing that these operator overloads compile.
  const one = parse(Single, "0x1p+0");
  const two = parse(Single, "0x2p+0");
  expect(two.bitwise_eq(one.add(one).value)).toBe(true);
  expect(one.bitwise_eq(two.sub(one).value)).toBe(true);
  expect(two.bitwise_eq(one.mul(two).value)).toBe(true);
  expect(one.bitwise_eq(two.div(two).value)).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:3308 comparisons
test("comparisons", () => {
  const vals = [
    /* MNan */ Single.NAN.neg(),
    /* MInf */ Single.INFINITY.neg(),
    /* MBig */ Single.largest().neg(),
    /* MOne */ parse(Single, "-0x1p+0"),
    /* MZer */ Single.ZERO.neg(),
    /* PZer */ Single.ZERO,
    /* POne */ parse(Single, "0x1p+0"),
    /* PBig */ Single.largest(),
    /* PInf */ Single.INFINITY,
    /* PNan */ Single.NAN,
  ];

  const LT: Ordering | undefined = -1;
  const EQ: Ordering | undefined = 0;
  const GT: Ordering | undefined = 1;
  const UN: Ordering | undefined = undefined;

  // HACK(eddyb) for some reason the first row (MNan) gets formatted differently.
  // prettier-ignore
  const relations = [
    //          -N  -I  -B  -1  -0  +0  +1  +B  +I  +N
    /* MNan */ [UN, UN, UN, UN, UN, UN, UN, UN, UN, UN],
    /* MInf */ [UN, EQ, LT, LT, LT, LT, LT, LT, LT, UN],
    /* MBig */ [UN, GT, EQ, LT, LT, LT, LT, LT, LT, UN],
    /* MOne */ [UN, GT, GT, EQ, LT, LT, LT, LT, LT, UN],
    /* MZer */ [UN, GT, GT, GT, EQ, EQ, LT, LT, LT, UN],
    /* PZer */ [UN, GT, GT, GT, EQ, EQ, LT, LT, LT, UN],
    /* POne */ [UN, GT, GT, GT, GT, GT, EQ, LT, LT, UN],
    /* PBig */ [UN, GT, GT, GT, GT, GT, GT, EQ, LT, UN],
    /* PInf */ [UN, GT, GT, GT, GT, GT, GT, GT, EQ, UN],
    /* PNan */ [UN, UN, UN, UN, UN, UN, UN, UN, UN, UN],
  ];
  // `<`, `>`, `<=`, `>=` (PartialOrd's provided methods over `partial_cmp`)
  const lt = (a: (typeof vals)[number], b: (typeof vals)[number]) => a.partial_cmp(b) === -1;
  const gt = (a: (typeof vals)[number], b: (typeof vals)[number]) => a.partial_cmp(b) === 1;
  const le = (a: (typeof vals)[number], b: (typeof vals)[number]) => {
    const o = a.partial_cmp(b);
    return o === -1 || o === 0;
  };
  const ge = (a: (typeof vals)[number], b: (typeof vals)[number]) => {
    const o = a.partial_cmp(b);
    return o === 1 || o === 0;
  };
  vals.forEach((lhs, i) => {
    vals.forEach((rhs, j) => {
      const relation = lhs.partial_cmp(rhs);
      expect(relation).toBe(relations[i]![j]);

      // NOTE(eddyb) these checks have been kept from the C++ code which didn't
      // appear to have a concept like `Option<Ordering>`, but in Rust they
      // should be entirely redundant with the single `assert_eq!` above.
      switch (relation) {
        case LT:
          expect(!lhs.eq(rhs)).toBe(true);
          expect(!lhs.eq(rhs)).toBe(true);
          expect(lt(lhs, rhs)).toBe(true);
          expect(!gt(lhs, rhs)).toBe(true);
          expect(le(lhs, rhs)).toBe(true);
          expect(!ge(lhs, rhs)).toBe(true);
          break;
        case EQ:
          expect(lhs.eq(rhs)).toBe(true);
          expect(!!lhs.eq(rhs)).toBe(true);
          expect(!lt(lhs, rhs)).toBe(true);
          expect(!gt(lhs, rhs)).toBe(true);
          expect(le(lhs, rhs)).toBe(true);
          expect(ge(lhs, rhs)).toBe(true);
          break;
        case GT:
          expect(!lhs.eq(rhs)).toBe(true);
          expect(!lhs.eq(rhs)).toBe(true);
          expect(!lt(lhs, rhs)).toBe(true);
          expect(gt(lhs, rhs)).toBe(true);
          expect(!le(lhs, rhs)).toBe(true);
          expect(ge(lhs, rhs)).toBe(true);
          break;
        case UN:
          expect(!lhs.eq(rhs)).toBe(true);
          expect(!lhs.eq(rhs)).toBe(true);
          expect(!lt(lhs, rhs)).toBe(true);
          expect(!gt(lhs, rhs)).toBe(true);
          expect(!le(lhs, rhs)).toBe(true);
          expect(!ge(lhs, rhs)).toBe(true);
          break;
      }
    });
  });
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:3389 abs
test("abs", () => {
  const p_inf = Single.INFINITY;
  const m_inf = Single.INFINITY.neg();
  const p_zero = Single.ZERO;
  const m_zero = Single.ZERO.neg();
  const p_qnan = Single.NAN;
  const m_qnan = Single.NAN.neg();
  const p_snan = Single.snan(undefined);
  const m_snan = Single.snan(undefined).neg();
  const p_normal_value = parse(Single, "0x1p+0");
  const m_normal_value = parse(Single, "-0x1p+0");
  const p_largest_value = Single.largest();
  const m_largest_value = Single.largest().neg();
  const p_smallest_value = Single.SMALLEST;
  const m_smallest_value = Single.SMALLEST.neg();
  const p_smallest_normalized = Single.smallest_normalized();
  const m_smallest_normalized = Single.smallest_normalized().neg();

  expect(p_inf.bitwise_eq(p_inf.abs())).toBe(true);
  expect(p_inf.bitwise_eq(m_inf.abs())).toBe(true);
  expect(p_zero.bitwise_eq(p_zero.abs())).toBe(true);
  expect(p_zero.bitwise_eq(m_zero.abs())).toBe(true);
  expect(p_qnan.bitwise_eq(p_qnan.abs())).toBe(true);
  expect(p_qnan.bitwise_eq(m_qnan.abs())).toBe(true);
  expect(p_snan.bitwise_eq(p_snan.abs())).toBe(true);
  expect(p_snan.bitwise_eq(m_snan.abs())).toBe(true);
  expect(p_normal_value.bitwise_eq(p_normal_value.abs())).toBe(true);
  expect(p_normal_value.bitwise_eq(m_normal_value.abs())).toBe(true);
  expect(p_largest_value.bitwise_eq(p_largest_value.abs())).toBe(true);
  expect(p_largest_value.bitwise_eq(m_largest_value.abs())).toBe(true);
  expect(p_smallest_value.bitwise_eq(p_smallest_value.abs())).toBe(true);
  expect(p_smallest_value.bitwise_eq(m_smallest_value.abs())).toBe(true);
  expect(p_smallest_normalized.bitwise_eq(p_smallest_normalized.abs())).toBe(true);
  expect(p_smallest_normalized.bitwise_eq(m_smallest_normalized.abs())).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:3426 neg
test("neg", () => {
  const one = parse(Single, "1.0");
  const neg_one = parse(Single, "-1.0");
  const zero = Single.ZERO;
  const neg_zero = Single.ZERO.neg();
  const inf = Single.INFINITY;
  const neg_inf = Single.INFINITY.neg();
  const qnan = Single.NAN;
  const neg_qnan = Single.NAN.neg();

  expect(neg_one.bitwise_eq(one.neg())).toBe(true);
  expect(one.bitwise_eq(neg_one.neg())).toBe(true);
  expect(neg_zero.bitwise_eq(zero.neg())).toBe(true);
  expect(zero.bitwise_eq(neg_zero.neg())).toBe(true);
  expect(neg_inf.bitwise_eq(inf.neg())).toBe(true);
  expect(inf.bitwise_eq(neg_inf.neg())).toBe(true);
  expect(neg_inf.bitwise_eq(inf.neg())).toBe(true);
  expect(inf.bitwise_eq(neg_inf.neg())).toBe(true);
  expect(neg_qnan.bitwise_eq(qnan.neg())).toBe(true);
  expect(qnan.bitwise_eq(neg_qnan.neg())).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:3449 ilogb
test("ilogb", () => {
  expect(Double.SMALLEST.ilogb()).toBe(-1074);
  expect(Double.SMALLEST.neg().ilogb()).toBe(-1074);
  expect(parse(Double, "0x1.ffffffffffffep-1024").ilogb()).toBe(-1023);
  expect(parse(Double, "0x1.ffffffffffffep-1023").ilogb()).toBe(-1023);
  expect(parse(Double, "-0x1.ffffffffffffep-1023").ilogb()).toBe(-1023);
  expect(parse(Double, "0x1p-51").ilogb()).toBe(-51);
  expect(parse(Double, "0x1.c60f120d9f87cp-1023").ilogb()).toBe(-1023);
  expect(parse(Double, "0x0.ffffp-1").ilogb()).toBe(-2);
  expect(parse(Double, "0x1.fffep-1023").ilogb()).toBe(-1023);
  expect(Double.largest().ilogb()).toBe(1023);
  expect(Double.largest().neg().ilogb()).toBe(1023);

  expect(parse(Single, "0x1p+0").ilogb()).toBe(0);
  expect(parse(Single, "-0x1p+0").ilogb()).toBe(0);
  expect(parse(Single, "0x1p+42").ilogb()).toBe(42);
  expect(parse(Single, "0x1p-42").ilogb()).toBe(-42);

  expect(Single.INFINITY.ilogb()).toBe(IEK_INF);
  expect(Single.INFINITY.neg().ilogb()).toBe(IEK_INF);
  expect(Single.ZERO.ilogb()).toBe(IEK_ZERO);
  expect(Single.ZERO.neg().ilogb()).toBe(IEK_ZERO);
  expect(Single.NAN.ilogb()).toBe(IEK_NAN);
  expect(Single.snan(undefined).ilogb()).toBe(IEK_NAN);

  expect(Single.largest().ilogb()).toBe(127);
  expect(Single.largest().neg().ilogb()).toBe(127);

  expect(Single.SMALLEST.ilogb()).toBe(-149);
  expect(Single.SMALLEST.neg().ilogb()).toBe(-149);
  expect(Single.smallest_normalized().ilogb()).toBe(-126);
  expect(Single.smallest_normalized().neg().ilogb()).toBe(-126);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:3484 scalbn
test("scalbn", () => {
  expect(parse(Single, "0x1p+0").bitwise_eq(parse(Single, "0x1p+0").scalbn(0))).toBe(true);
  expect(parse(Single, "0x1p+42").bitwise_eq(parse(Single, "0x1p+0").scalbn(42))).toBe(true);
  expect(parse(Single, "0x1p-42").bitwise_eq(parse(Single, "0x1p+0").scalbn(-42))).toBe(true);

  const p_inf = Single.INFINITY;
  const m_inf = Single.INFINITY.neg();
  const p_zero = Single.ZERO;
  const m_zero = Single.ZERO.neg();
  const p_qnan = Single.NAN;
  const m_qnan = Single.NAN.neg();
  const snan = Single.snan(undefined);

  expect(p_inf.bitwise_eq(p_inf.scalbn(0))).toBe(true);
  expect(m_inf.bitwise_eq(m_inf.scalbn(0))).toBe(true);
  expect(p_zero.bitwise_eq(p_zero.scalbn(0))).toBe(true);
  expect(m_zero.bitwise_eq(m_zero.scalbn(0))).toBe(true);
  expect(p_qnan.bitwise_eq(p_qnan.scalbn(0))).toBe(true);
  expect(m_qnan.bitwise_eq(m_qnan.scalbn(0))).toBe(true);
  expect(!snan.scalbn(0).is_signaling()).toBe(true);

  const scalbn_snan = snan.scalbn(1);
  expect(scalbn_snan.is_nan() && !scalbn_snan.is_signaling()).toBe(true);

  // Make sure highest bit of payload is preserved.
  const payload = (1n << 50n) | (1n << 49n) | (1234n << 32n) | 1n;

  const snan_with_payload = Double.snan(payload);
  const quiet_payload = snan_with_payload.scalbn(1);
  expect(quiet_payload.is_nan() && !quiet_payload.is_signaling()).toBe(true);
  expect(quiet_payload.to_bits() & ((1n << 51n) - 1n)).toBe(payload);

  expect(p_inf.bitwise_eq(parse(Single, "0x1p+0").scalbn(128))).toBe(true);
  expect(m_inf.bitwise_eq(parse(Single, "-0x1p+0").scalbn(128))).toBe(true);
  expect(p_inf.bitwise_eq(parse(Single, "0x1p+127").scalbn(1))).toBe(true);
  expect(p_zero.bitwise_eq(parse(Single, "0x1p-127").scalbn(-127))).toBe(true);
  expect(m_zero.bitwise_eq(parse(Single, "-0x1p-127").scalbn(-127))).toBe(true);
  expect(parse(Single, "-0x1p-149").bitwise_eq(parse(Single, "-0x1p-127").scalbn(-22))).toBe(true);
  expect(p_zero.bitwise_eq(parse(Single, "0x1p-126").scalbn(-24))).toBe(true);

  const smallest_f64 = Double.SMALLEST;
  const neg_smallest_f64 = Double.SMALLEST.neg();

  const largest_f64 = Double.largest();
  const neg_largest_f64 = Double.largest().neg();

  const largest_denormal_f64 = parse(Double, "0x1.ffffffffffffep-1023");
  const neg_largest_denormal_f64 = parse(Double, "-0x1.ffffffffffffep-1023");

  expect(smallest_f64.bitwise_eq(parse(Double, "0x1p-1074").scalbn(0))).toBe(true);
  expect(neg_smallest_f64.bitwise_eq(parse(Double, "-0x1p-1074").scalbn(0))).toBe(true);

  expect(parse(Double, "0x1p+1023").bitwise_eq(smallest_f64.scalbn(2097))).toBe(true);

  expect(smallest_f64.scalbn(-2097).is_pos_zero()).toBe(true);
  expect(smallest_f64.scalbn(-2098).is_pos_zero()).toBe(true);
  expect(smallest_f64.scalbn(-2099).is_pos_zero()).toBe(true);
  expect(parse(Double, "0x1p+1022").bitwise_eq(smallest_f64.scalbn(2096))).toBe(true);
  expect(parse(Double, "0x1p+1023").bitwise_eq(smallest_f64.scalbn(2097))).toBe(true);
  expect(smallest_f64.scalbn(2098).is_infinite()).toBe(true);
  expect(smallest_f64.scalbn(2099).is_infinite()).toBe(true);

  // Test for integer overflows when adding to exponent.
  expect(smallest_f64.scalbn(-2147483647).is_pos_zero()).toBe(true);
  expect(largest_f64.scalbn(2147483647).is_infinite()).toBe(true);

  expect(largest_denormal_f64.bitwise_eq(largest_denormal_f64.scalbn(0))).toBe(true);
  expect(neg_largest_denormal_f64.bitwise_eq(neg_largest_denormal_f64.scalbn(0))).toBe(true);

  expect(parse(Double, "0x1.ffffffffffffep-1022").bitwise_eq(largest_denormal_f64.scalbn(1))).toBe(true);
  expect(parse(Double, "-0x1.ffffffffffffep-1021").bitwise_eq(neg_largest_denormal_f64.scalbn(2))).toBe(true);

  expect(parse(Double, "0x1.ffffffffffffep+1").bitwise_eq(largest_denormal_f64.scalbn(1024))).toBe(true);
  expect(largest_denormal_f64.scalbn(-1023).is_pos_zero()).toBe(true);
  expect(largest_denormal_f64.scalbn(-1024).is_pos_zero()).toBe(true);
  expect(largest_denormal_f64.scalbn(-2048).is_pos_zero()).toBe(true);
  expect(largest_denormal_f64.scalbn(2047).is_infinite()).toBe(true);
  expect(largest_denormal_f64.scalbn(2098).is_infinite()).toBe(true);
  expect(largest_denormal_f64.scalbn(2099).is_infinite()).toBe(true);

  expect(parse(Double, "0x1.ffffffffffffep-2").bitwise_eq(largest_denormal_f64.scalbn(1021))).toBe(true);
  expect(parse(Double, "0x1.ffffffffffffep-1").bitwise_eq(largest_denormal_f64.scalbn(1022))).toBe(true);
  expect(parse(Double, "0x1.ffffffffffffep+0").bitwise_eq(largest_denormal_f64.scalbn(1023))).toBe(true);
  expect(parse(Double, "0x1.ffffffffffffep+1023").bitwise_eq(largest_denormal_f64.scalbn(2046))).toBe(true);
  expect(parse(Double, "0x1p+974").bitwise_eq(smallest_f64.scalbn(2048))).toBe(true);

  const random_denormal_f64 = parse(Double, "0x1.c60f120d9f87cp+51");
  expect(parse(Double, "0x1.c60f120d9f87cp-972").bitwise_eq(random_denormal_f64.scalbn(-1023))).toBe(true);
  expect(parse(Double, "0x1.c60f120d9f87cp-1").bitwise_eq(random_denormal_f64.scalbn(-52))).toBe(true);
  expect(parse(Double, "0x1.c60f120d9f87cp-2").bitwise_eq(random_denormal_f64.scalbn(-53))).toBe(true);
  expect(parse(Double, "0x1.c60f120d9f87cp+0").bitwise_eq(random_denormal_f64.scalbn(-51))).toBe(true);

  expect(random_denormal_f64.scalbn(-2097).is_pos_zero()).toBe(true);
  expect(random_denormal_f64.scalbn(-2090).is_pos_zero()).toBe(true);

  expect(parse(Double, "-0x1p-1073").bitwise_eq(neg_largest_f64.scalbn(-2097))).toBe(true);

  expect(parse(Double, "-0x1p-1024").bitwise_eq(neg_largest_f64.scalbn(-2048))).toBe(true);

  expect(parse(Double, "0x1p-1073").bitwise_eq(largest_f64.scalbn(-2097))).toBe(true);

  expect(parse(Double, "0x1p-1074").bitwise_eq(largest_f64.scalbn(-2098))).toBe(true);
  expect(parse(Double, "-0x1p-1074").bitwise_eq(neg_largest_f64.scalbn(-2098))).toBe(true);
  expect(neg_largest_f64.scalbn(-2099).is_neg_zero()).toBe(true);
  expect(largest_f64.scalbn(1).is_infinite()).toBe(true);

  expect(parse(Double, "0x1p+0").bitwise_eq(parse(Double, "0x1p+52").scalbn(-52))).toBe(true);

  expect(parse(Double, "0x1p-103").bitwise_eq(parse(Double, "0x1p-51").scalbn(-52))).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:3674 frexp
test("frexp", () => {
  const p_zero = Double.ZERO;
  const m_zero = Double.ZERO.neg();
  const one = from_f64(1.0) as unknown as typeof p_zero;
  const m_one = from_f64(-1.0) as unknown as typeof p_zero;

  const largest_denormal = parse(Double, "0x1.ffffffffffffep-1023");
  const neg_largest_denormal = parse(Double, "-0x1.ffffffffffffep-1023");

  const smallest = Double.SMALLEST;
  const neg_smallest = Double.SMALLEST.neg();

  const largest = Double.largest();
  const neg_largest = Double.largest().neg();

  const p_inf = Double.INFINITY;
  const m_inf = Double.INFINITY.neg();

  const p_qnan = Double.NAN;
  const m_qnan = Double.NAN.neg();
  const snan = Double.snan(undefined);

  // Make sure highest bit of payload is preserved.
  const payload = (1n << 50n) | (1n << 49n) | (1234n << 32n) | 1n;

  const snan_with_payload = Double.snan(payload);

  const exp = { value: 0 };

  let frac = p_zero.frexp(exp);
  expect(exp.value).toBe(0);
  expect(frac.is_pos_zero()).toBe(true);

  frac = m_zero.frexp(exp);
  expect(exp.value).toBe(0);
  expect(frac.is_neg_zero()).toBe(true);

  frac = one.frexp(exp);
  expect(exp.value).toBe(1);
  expect(parse(Double, "0x1p-1").bitwise_eq(frac)).toBe(true);

  frac = m_one.frexp(exp);
  expect(exp.value).toBe(1);
  expect(parse(Double, "-0x1p-1").bitwise_eq(frac)).toBe(true);

  frac = largest_denormal.frexp(exp);
  expect(exp.value).toBe(-1022);
  expect(parse(Double, "0x1.ffffffffffffep-1").bitwise_eq(frac)).toBe(true);

  frac = neg_largest_denormal.frexp(exp);
  expect(exp.value).toBe(-1022);
  expect(parse(Double, "-0x1.ffffffffffffep-1").bitwise_eq(frac)).toBe(true);

  frac = smallest.frexp(exp);
  expect(exp.value).toBe(-1073);
  expect(parse(Double, "0x1p-1").bitwise_eq(frac)).toBe(true);

  frac = neg_smallest.frexp(exp);
  expect(exp.value).toBe(-1073);
  expect(parse(Double, "-0x1p-1").bitwise_eq(frac)).toBe(true);

  frac = largest.frexp(exp);
  expect(exp.value).toBe(1024);
  expect(parse(Double, "0x1.fffffffffffffp-1").bitwise_eq(frac)).toBe(true);

  frac = neg_largest.frexp(exp);
  expect(exp.value).toBe(1024);
  expect(parse(Double, "-0x1.fffffffffffffp-1").bitwise_eq(frac)).toBe(true);

  frac = p_inf.frexp(exp);
  expect(exp.value).toBe(IEK_INF);
  expect(frac.is_infinite() && !frac.is_negative()).toBe(true);

  frac = m_inf.frexp(exp);
  expect(exp.value).toBe(IEK_INF);
  expect(frac.is_infinite() && frac.is_negative()).toBe(true);

  frac = p_qnan.frexp(exp);
  expect(exp.value).toBe(IEK_NAN);
  expect(frac.is_nan()).toBe(true);

  frac = m_qnan.frexp(exp);
  expect(exp.value).toBe(IEK_NAN);
  expect(frac.is_nan()).toBe(true);

  frac = snan.frexp(exp);
  expect(exp.value).toBe(IEK_NAN);
  expect(frac.is_nan() && !frac.is_signaling()).toBe(true);

  frac = snan_with_payload.frexp(exp);
  expect(exp.value).toBe(IEK_NAN);
  expect(frac.is_nan() && !frac.is_signaling()).toBe(true);
  expect(frac.to_bits() & ((1n << 51n) - 1n)).toBe(payload);

  frac = parse(Double, "0x0.ffffp-1").frexp(exp);
  expect(exp.value).toBe(-1);
  expect(parse(Double, "0x1.fffep-1").bitwise_eq(frac)).toBe(true);

  frac = parse(Double, "0x1p-51").frexp(exp);
  expect(exp.value).toBe(-50);
  expect(parse(Double, "0x1p-1").bitwise_eq(frac)).toBe(true);

  frac = parse(Double, "0x1.c60f120d9f87cp+51").frexp(exp);
  expect(exp.value).toBe(52);
  expect(parse(Double, "0x1.c60f120d9f87cp-1").bitwise_eq(frac)).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:3782 modulo
test("modulo", () => {
  let status: Status;
  /** `unpack!(status=, e)` */
  const unpack = <X>(e: StatusAnd<X>): X => {
    status = e.status;
    return e.value;
  };
  {
    const f1 = parse(Double, "1.5");
    const f2 = parse(Double, "1.0");
    const expected = parse(Double, "0.5");
    expect(unpack(f1.rem(f2)).bitwise_eq(expected)).toBe(true);
    expect(status!).toBe(Status.OK);
  }
  {
    const f1 = parse(Double, "0.5");
    const f2 = parse(Double, "1.0");
    const expected = parse(Double, "0.5");
    expect(unpack(f1.rem(f2)).bitwise_eq(expected)).toBe(true);
    expect(status!).toBe(Status.OK);
  }
  {
    const f1 = parse(Double, "0x1.3333333333333p-2"); // 0.3
    const f2 = parse(Double, "0x1.47ae147ae147bp-7"); // 0.01
    // 0.009999999999999983
    const expected = parse(Double, "0x1.47ae147ae1471p-7");
    expect(unpack(f1.rem(f2)).bitwise_eq(expected)).toBe(true);
    expect(status!).toBe(Status.OK);
  }
  {
    const f1 = parse(Double, "0x1p64"); // 1.8446744073709552e19
    const f2 = parse(Double, "1.5");
    const expected = parse(Double, "1.0");
    expect(unpack(f1.rem(f2)).bitwise_eq(expected)).toBe(true);
    expect(status!).toBe(Status.OK);
  }
  {
    const f1 = parse(Double, "0x1p1000");
    const f2 = parse(Double, "0x1p-1000");
    const expected = parse(Double, "0.0");
    expect(unpack(f1.rem(f2)).bitwise_eq(expected)).toBe(true);
    expect(status!).toBe(Status.OK);
  }
  {
    const f1 = parse(Double, "0.0");
    const f2 = parse(Double, "1.0");
    const expected = parse(Double, "0.0");
    expect(unpack(f1.rem(f2)).bitwise_eq(expected)).toBe(true);
    expect(status!).toBe(Status.OK);
  }
  {
    const f1 = parse(Double, "1.0");
    const f2 = parse(Double, "0.0");
    expect(unpack(f1.rem(f2)).is_nan()).toBe(true);
    expect(status!).toBe(Status.INVALID_OP);
  }
  {
    const f1 = parse(Double, "0.0");
    const f2 = parse(Double, "0.0");
    expect(unpack(f1.rem(f2)).is_nan()).toBe(true);
    expect(status!).toBe(Status.INVALID_OP);
  }
  {
    const f1 = Double.INFINITY;
    const f2 = parse(Double, "1.0");
    expect(unpack(f1.rem(f2)).is_nan()).toBe(true);
    expect(status!).toBe(Status.INVALID_OP);
  }
  {
    const f1 = parse(Double, "-4.0");
    const f2 = parse(Double, "-2.0");
    const expected = parse(Double, "-0.0");
    expect(unpack(f1.rem(f2)).bitwise_eq(expected)).toBe(true);
    expect(status!).toBe(Status.OK);
  }
  {
    const f1 = parse(Double, "-4.0");
    const f2 = parse(Double, "2.0");
    const expected = parse(Double, "-0.0");
    expect(unpack(f1.rem(f2)).bitwise_eq(expected)).toBe(true);
    expect(status!).toBe(Status.OK);
  }
  {
    // Test E4M3FN mod where the LHS exponent is maxExponent (8) and the RHS is
    // the max value whose exponent is minExponent (-6). This requires special
    // logic in the mod implementation to prevent overflow to NaN.
    const f1 = parse(Float8E4M3FN, "0x1p8"); // 256
    const f2 = parse(Float8E4M3FN, "0x1.ep-6"); // 0.029296875
    const expected = parse(Float8E4M3FN, "0x1p-8"); // 0.00390625
    expect(unpack(f1.rem(f2)).bitwise_eq(expected)).toBe(true);
    expect(status!).toBe(Status.OK);
  }
});


// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:3872 remainder
test("remainder", () => {
    // Test Special Cases against each other and normal values.

    const p_inf = Single.INFINITY;
    const m_inf = Single.INFINITY.neg();
    const p_zero = Single.ZERO;
    const m_zero = Single.ZERO.neg();
    const qnan = Single.NAN;
    const snan = parse(Single, "snan123");
    const p_normal_value = parse(Single, "0x1p+0");
    const m_normal_value = parse(Single, "-0x1p+0");
    const p_largest_value = Single.largest();
    const m_largest_value = Single.largest().neg();
    const p_smallest_value = Single.SMALLEST;
    const m_smallest_value = Single.SMALLEST.neg();
    const p_smallest_normalized = Single.smallest_normalized();
    const m_smallest_normalized = Single.smallest_normalized().neg();

    const p_val1 = parse(Single, "0x1.fffffep+126");
    const m_val1 = parse(Single, "-0x1.fffffep+126");
    const p_val2 = parse(Single, "0x1.fffffep-126");
    const m_val2 = parse(Single, "-0x1.fffffep-126");
    const p_val3 = parse(Single, "0x1p-125");
    const m_val3 = parse(Single, "-0x1p-125");
    const p_val4 = parse(Single, "0x1p+127");
    const m_val4 = parse(Single, "-0x1p+127");
    const p_val5 = parse(Single, "1.5");
    const m_val5 = parse(Single, "-1.5");
    const p_val6 = parse(Single, "1");
    const m_val6 = parse(Single, "-1");

    const special_cases: [AnyFloat, AnyFloat, string, Status, Category][] = [
        [p_inf, p_inf, "nan", Status.INVALID_OP, Category.NaN],
        [p_inf, m_inf, "nan", Status.INVALID_OP, Category.NaN],
        [p_inf, p_zero, "nan", Status.INVALID_OP, Category.NaN],
        [p_inf, m_zero, "nan", Status.INVALID_OP, Category.NaN],
        [p_inf, qnan, "nan", Status.OK, Category.NaN],
        [p_inf, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_inf, p_normal_value, "nan", Status.INVALID_OP, Category.NaN],
        [p_inf, m_normal_value, "nan", Status.INVALID_OP, Category.NaN],
        [p_inf, p_largest_value, "nan", Status.INVALID_OP, Category.NaN],
        [p_inf, m_largest_value, "nan", Status.INVALID_OP, Category.NaN],
        [p_inf, p_smallest_value, "nan", Status.INVALID_OP, Category.NaN],
        [p_inf, m_smallest_value, "nan", Status.INVALID_OP, Category.NaN],
        [p_inf, p_smallest_normalized, "nan", Status.INVALID_OP, Category.NaN],
        [p_inf, m_smallest_normalized, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, p_inf, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, m_inf, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, p_zero, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, m_zero, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, qnan, "nan", Status.OK, Category.NaN],
        [m_inf, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_inf, p_normal_value, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, m_normal_value, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, p_largest_value, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, m_largest_value, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, p_smallest_value, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, m_smallest_value, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, p_smallest_normalized, "nan", Status.INVALID_OP, Category.NaN],
        [m_inf, m_smallest_normalized, "nan", Status.INVALID_OP, Category.NaN],
        [p_zero, p_inf, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, m_inf, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, p_zero, "nan", Status.INVALID_OP, Category.NaN],
        [p_zero, m_zero, "nan", Status.INVALID_OP, Category.NaN],
        [p_zero, qnan, "nan", Status.OK, Category.NaN],
        [p_zero, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_zero, p_normal_value, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, m_normal_value, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, p_largest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, m_largest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, p_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, m_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, p_smallest_normalized, "0x0p+0", Status.OK, Category.Zero],
        [p_zero, m_smallest_normalized, "0x0p+0", Status.OK, Category.Zero],
        [m_zero, p_inf, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, m_inf, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, p_zero, "nan", Status.INVALID_OP, Category.NaN],
        [m_zero, m_zero, "nan", Status.INVALID_OP, Category.NaN],
        [m_zero, qnan, "nan", Status.OK, Category.NaN],
        [m_zero, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_zero, p_normal_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, m_normal_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, p_largest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, m_largest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, p_smallest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, m_smallest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, p_smallest_normalized, "-0x0p+0", Status.OK, Category.Zero],
        [m_zero, m_smallest_normalized, "-0x0p+0", Status.OK, Category.Zero],
        [qnan, p_inf, "nan", Status.OK, Category.NaN],
        [qnan, m_inf, "nan", Status.OK, Category.NaN],
        [qnan, p_zero, "nan", Status.OK, Category.NaN],
        [qnan, m_zero, "nan", Status.OK, Category.NaN],
        [qnan, qnan, "nan", Status.OK, Category.NaN],
        [qnan, snan, "nan", Status.INVALID_OP, Category.NaN],
        [qnan, p_normal_value, "nan", Status.OK, Category.NaN],
        [qnan, m_normal_value, "nan", Status.OK, Category.NaN],
        [qnan, p_largest_value, "nan", Status.OK, Category.NaN],
        [qnan, m_largest_value, "nan", Status.OK, Category.NaN],
        [qnan, p_smallest_value, "nan", Status.OK, Category.NaN],
        [qnan, m_smallest_value, "nan", Status.OK, Category.NaN],
        [qnan, p_smallest_normalized, "nan", Status.OK, Category.NaN],
        [qnan, m_smallest_normalized, "nan", Status.OK, Category.NaN],
        [snan, p_inf, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_inf, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_zero, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_zero, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, qnan, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_normal_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_normal_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_largest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_largest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_smallest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_smallest_value, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, p_smallest_normalized, "nan123", Status.INVALID_OP, Category.NaN],
        [snan, m_smallest_normalized, "nan123", Status.INVALID_OP, Category.NaN],
        [p_normal_value, p_inf, "0x1p+0", Status.OK, Category.Normal],
        [p_normal_value, m_inf, "0x1p+0", Status.OK, Category.Normal],
        [p_normal_value, p_zero, "nan", Status.INVALID_OP, Category.NaN],
        [p_normal_value, m_zero, "nan", Status.INVALID_OP, Category.NaN],
        [p_normal_value, qnan, "nan", Status.OK, Category.NaN],
        [p_normal_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_normal_value, p_normal_value, "0x0p+0", Status.OK, Category.Zero],
        [p_normal_value, m_normal_value, "0x0p+0", Status.OK, Category.Zero],
        [p_normal_value, p_largest_value, "0x1p+0", Status.OK, Category.Normal],
        [p_normal_value, m_largest_value, "0x1p+0", Status.OK, Category.Normal],
        [p_normal_value, p_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_normal_value, m_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_normal_value, p_smallest_normalized, "0x0p+0", Status.OK, Category.Zero],
        [p_normal_value, m_smallest_normalized, "0x0p+0", Status.OK, Category.Zero],
        [m_normal_value, p_inf, "-0x1p+0", Status.OK, Category.Normal],
        [m_normal_value, m_inf, "-0x1p+0", Status.OK, Category.Normal],
        [m_normal_value, p_zero, "nan", Status.INVALID_OP, Category.NaN],
        [m_normal_value, m_zero, "nan", Status.INVALID_OP, Category.NaN],
        [m_normal_value, qnan, "nan", Status.OK, Category.NaN],
        [m_normal_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_normal_value, p_normal_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_normal_value, m_normal_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_normal_value, p_largest_value, "-0x1p+0", Status.OK, Category.Normal],
        [m_normal_value, m_largest_value, "-0x1p+0", Status.OK, Category.Normal],
        [m_normal_value, p_smallest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_normal_value, m_smallest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_normal_value, p_smallest_normalized, "-0x0p+0", Status.OK, Category.Zero],
        [m_normal_value, m_smallest_normalized, "-0x0p+0", Status.OK, Category.Zero],
        [p_largest_value, p_inf, "0x1.fffffep+127", Status.OK, Category.Normal],
        [p_largest_value, m_inf, "0x1.fffffep+127", Status.OK, Category.Normal],
        [p_largest_value, p_zero, "nan", Status.INVALID_OP, Category.NaN],
        [p_largest_value, m_zero, "nan", Status.INVALID_OP, Category.NaN],
        [p_largest_value, qnan, "nan", Status.OK, Category.NaN],
        [p_largest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_largest_value, p_normal_value, "0x0p+0", Status.OK, Category.Zero],
        [p_largest_value, m_normal_value, "0x0p+0", Status.OK, Category.Zero],
        [p_largest_value, p_largest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_largest_value, m_largest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_largest_value, p_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_largest_value, m_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_largest_value, p_smallest_normalized, "0x0p+0", Status.OK, Category.Zero],
        [p_largest_value, m_smallest_normalized, "0x0p+0", Status.OK, Category.Zero],
        [m_largest_value, p_inf, "-0x1.fffffep+127", Status.OK, Category.Normal],
        [m_largest_value, m_inf, "-0x1.fffffep+127", Status.OK, Category.Normal],
        [m_largest_value, p_zero, "nan", Status.INVALID_OP, Category.NaN],
        [m_largest_value, m_zero, "nan", Status.INVALID_OP, Category.NaN],
        [m_largest_value, qnan, "nan", Status.OK, Category.NaN],
        [m_largest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_largest_value, p_normal_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_largest_value, m_normal_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_largest_value, p_largest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_largest_value, m_largest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_largest_value, p_smallest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_largest_value, m_smallest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_largest_value, p_smallest_normalized, "-0x0p+0", Status.OK, Category.Zero],
        [m_largest_value, m_smallest_normalized, "-0x0p+0", Status.OK, Category.Zero],
        [p_smallest_value, p_inf, "0x1p-149", Status.OK, Category.Normal],
        [p_smallest_value, m_inf, "0x1p-149", Status.OK, Category.Normal],
        [p_smallest_value, p_zero, "nan", Status.INVALID_OP, Category.NaN],
        [p_smallest_value, m_zero, "nan", Status.INVALID_OP, Category.NaN],
        [p_smallest_value, qnan, "nan", Status.OK, Category.NaN],
        [p_smallest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_smallest_value, p_normal_value, "0x1p-149", Status.OK, Category.Normal],
        [p_smallest_value, m_normal_value, "0x1p-149", Status.OK, Category.Normal],
        [p_smallest_value, p_largest_value, "0x1p-149", Status.OK, Category.Normal],
        [p_smallest_value, m_largest_value, "0x1p-149", Status.OK, Category.Normal],
        [p_smallest_value, p_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_smallest_value, m_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_smallest_value, p_smallest_normalized, "0x1p-149", Status.OK, Category.Normal],
        [p_smallest_value, m_smallest_normalized, "0x1p-149", Status.OK, Category.Normal],
        [m_smallest_value, p_inf, "-0x1p-149", Status.OK, Category.Normal],
        [m_smallest_value, m_inf, "-0x1p-149", Status.OK, Category.Normal],
        [m_smallest_value, p_zero, "nan", Status.INVALID_OP, Category.NaN],
        [m_smallest_value, m_zero, "nan", Status.INVALID_OP, Category.NaN],
        [m_smallest_value, qnan, "nan", Status.OK, Category.NaN],
        [m_smallest_value, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_smallest_value, p_normal_value, "-0x1p-149", Status.OK, Category.Normal],
        [m_smallest_value, m_normal_value, "-0x1p-149", Status.OK, Category.Normal],
        [m_smallest_value, p_largest_value, "-0x1p-149", Status.OK, Category.Normal],
        [m_smallest_value, m_largest_value, "-0x1p-149", Status.OK, Category.Normal],
        [m_smallest_value, p_smallest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_smallest_value, m_smallest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_smallest_value, p_smallest_normalized, "-0x1p-149", Status.OK, Category.Normal],
        [m_smallest_value, m_smallest_normalized, "-0x1p-149", Status.OK, Category.Normal],
        [p_smallest_normalized, p_inf, "0x1p-126", Status.OK, Category.Normal],
        [p_smallest_normalized, m_inf, "0x1p-126", Status.OK, Category.Normal],
        [p_smallest_normalized, p_zero, "nan", Status.INVALID_OP, Category.NaN],
        [p_smallest_normalized, m_zero, "nan", Status.INVALID_OP, Category.NaN],
        [p_smallest_normalized, qnan, "nan", Status.OK, Category.NaN],
        [p_smallest_normalized, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [p_smallest_normalized, p_normal_value, "0x1p-126", Status.OK, Category.Normal],
        [p_smallest_normalized, m_normal_value, "0x1p-126", Status.OK, Category.Normal],
        [p_smallest_normalized, p_largest_value, "0x1p-126", Status.OK, Category.Normal],
        [p_smallest_normalized, m_largest_value, "0x1p-126", Status.OK, Category.Normal],
        [p_smallest_normalized, p_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_smallest_normalized, m_smallest_value, "0x0p+0", Status.OK, Category.Zero],
        [p_smallest_normalized, p_smallest_normalized, "0x0p+0", Status.OK, Category.Zero],
        [p_smallest_normalized, m_smallest_normalized, "0x0p+0", Status.OK, Category.Zero],
        [m_smallest_normalized, p_inf, "-0x1p-126", Status.OK, Category.Normal],
        [m_smallest_normalized, m_inf, "-0x1p-126", Status.OK, Category.Normal],
        [m_smallest_normalized, p_zero, "nan", Status.INVALID_OP, Category.NaN],
        [m_smallest_normalized, m_zero, "nan", Status.INVALID_OP, Category.NaN],
        [m_smallest_normalized, qnan, "nan", Status.OK, Category.NaN],
        [m_smallest_normalized, snan, "nan123", Status.INVALID_OP, Category.NaN],
        [m_smallest_normalized, p_normal_value, "-0x1p-126", Status.OK, Category.Normal],
        [m_smallest_normalized, m_normal_value, "-0x1p-126", Status.OK, Category.Normal],
        [m_smallest_normalized, p_largest_value, "-0x1p-126", Status.OK, Category.Normal],
        [m_smallest_normalized, m_largest_value, "-0x1p-126", Status.OK, Category.Normal],
        [m_smallest_normalized, p_smallest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_smallest_normalized, m_smallest_value, "-0x0p+0", Status.OK, Category.Zero],
        [m_smallest_normalized, p_smallest_normalized, "-0x0p+0", Status.OK, Category.Zero],
        [m_smallest_normalized, m_smallest_normalized, "-0x0p+0", Status.OK, Category.Zero],
        [p_val1, p_val1, "0x0p+0", Status.OK, Category.Zero],
        [p_val1, m_val1, "0x0p+0", Status.OK, Category.Zero],
        [p_val1, p_val2, "0x0p+0", Status.OK, Category.Zero],
        [p_val1, m_val2, "0x0p+0", Status.OK, Category.Zero],
        [p_val1, p_val3, "0x0p+0", Status.OK, Category.Zero],
        [p_val1, m_val3, "0x0p+0", Status.OK, Category.Zero],
        [p_val1, p_val4, "-0x1p+103", Status.OK, Category.Normal],
        [p_val1, m_val4, "-0x1p+103", Status.OK, Category.Normal],
        [p_val1, p_val5, "0x0p+0", Status.OK, Category.Zero],
        [p_val1, m_val5, "0x0p+0", Status.OK, Category.Zero],
        [p_val1, p_val6, "0x0p+0", Status.OK, Category.Zero],
        [p_val1, m_val6, "0x0p+0", Status.OK, Category.Zero],
        [m_val1, p_val1, "-0x0p+0", Status.OK, Category.Zero],
        [m_val1, m_val1, "-0x0p+0", Status.OK, Category.Zero],
        [m_val1, p_val2, "-0x0p+0", Status.OK, Category.Zero],
        [m_val1, m_val2, "-0x0p+0", Status.OK, Category.Zero],
        [m_val1, p_val3, "-0x0p+0", Status.OK, Category.Zero],
        [m_val1, m_val3, "-0x0p+0", Status.OK, Category.Zero],
        [m_val1, p_val4, "0x1p+103", Status.OK, Category.Normal],
        [m_val1, m_val4, "0x1p+103", Status.OK, Category.Normal],
        [m_val1, p_val5, "-0x0p+0", Status.OK, Category.Zero],
        [m_val1, m_val5, "-0x0p+0", Status.OK, Category.Zero],
        [m_val1, p_val6, "-0x0p+0", Status.OK, Category.Zero],
        [m_val1, m_val6, "-0x0p+0", Status.OK, Category.Zero],
        [p_val2, p_val1, "0x1.fffffep-126", Status.OK, Category.Normal],
        [p_val2, m_val1, "0x1.fffffep-126", Status.OK, Category.Normal],
        [p_val2, p_val2, "0x0p+0", Status.OK, Category.Zero],
        [p_val2, m_val2, "0x0p+0", Status.OK, Category.Zero],
        [p_val2, p_val3, "-0x0.000002p-126", Status.OK, Category.Normal],
        [p_val2, m_val3, "-0x0.000002p-126", Status.OK, Category.Normal],
        [p_val2, p_val4, "0x1.fffffep-126", Status.OK, Category.Normal],
        [p_val2, m_val4, "0x1.fffffep-126", Status.OK, Category.Normal],
        [p_val2, p_val5, "0x1.fffffep-126", Status.OK, Category.Normal],
        [p_val2, m_val5, "0x1.fffffep-126", Status.OK, Category.Normal],
        [p_val2, p_val6, "0x1.fffffep-126", Status.OK, Category.Normal],
        [p_val2, m_val6, "0x1.fffffep-126", Status.OK, Category.Normal],
        [m_val2, p_val1, "-0x1.fffffep-126", Status.OK, Category.Normal],
        [m_val2, m_val1, "-0x1.fffffep-126", Status.OK, Category.Normal],
        [m_val2, p_val2, "-0x0p+0", Status.OK, Category.Zero],
        [m_val2, m_val2, "-0x0p+0", Status.OK, Category.Zero],
        [m_val2, p_val3, "0x0.000002p-126", Status.OK, Category.Normal],
        [m_val2, m_val3, "0x0.000002p-126", Status.OK, Category.Normal],
        [m_val2, p_val4, "-0x1.fffffep-126", Status.OK, Category.Normal],
        [m_val2, m_val4, "-0x1.fffffep-126", Status.OK, Category.Normal],
        [m_val2, p_val5, "-0x1.fffffep-126", Status.OK, Category.Normal],
        [m_val2, m_val5, "-0x1.fffffep-126", Status.OK, Category.Normal],
        [m_val2, p_val6, "-0x1.fffffep-126", Status.OK, Category.Normal],
        [m_val2, m_val6, "-0x1.fffffep-126", Status.OK, Category.Normal],
        [p_val3, p_val1, "0x1p-125", Status.OK, Category.Normal],
        [p_val3, m_val1, "0x1p-125", Status.OK, Category.Normal],
        [p_val3, p_val2, "0x0.000002p-126", Status.OK, Category.Normal],
        [p_val3, m_val2, "0x0.000002p-126", Status.OK, Category.Normal],
        [p_val3, p_val3, "0x0p+0", Status.OK, Category.Zero],
        [p_val3, m_val3, "0x0p+0", Status.OK, Category.Zero],
        [p_val3, p_val4, "0x1p-125", Status.OK, Category.Normal],
        [p_val3, m_val4, "0x1p-125", Status.OK, Category.Normal],
        [p_val3, p_val5, "0x1p-125", Status.OK, Category.Normal],
        [p_val3, m_val5, "0x1p-125", Status.OK, Category.Normal],
        [p_val3, p_val6, "0x1p-125", Status.OK, Category.Normal],
        [p_val3, m_val6, "0x1p-125", Status.OK, Category.Normal],
        [m_val3, p_val1, "-0x1p-125", Status.OK, Category.Normal],
        [m_val3, m_val1, "-0x1p-125", Status.OK, Category.Normal],
        [m_val3, p_val2, "-0x0.000002p-126", Status.OK, Category.Normal],
        [m_val3, m_val2, "-0x0.000002p-126", Status.OK, Category.Normal],
        [m_val3, p_val3, "-0x0p+0", Status.OK, Category.Zero],
        [m_val3, m_val3, "-0x0p+0", Status.OK, Category.Zero],
        [m_val3, p_val4, "-0x1p-125", Status.OK, Category.Normal],
        [m_val3, m_val4, "-0x1p-125", Status.OK, Category.Normal],
        [m_val3, p_val5, "-0x1p-125", Status.OK, Category.Normal],
        [m_val3, m_val5, "-0x1p-125", Status.OK, Category.Normal],
        [m_val3, p_val6, "-0x1p-125", Status.OK, Category.Normal],
        [m_val3, m_val6, "-0x1p-125", Status.OK, Category.Normal],
        [p_val4, p_val1, "0x1p+103", Status.OK, Category.Normal],
        [p_val4, m_val1, "0x1p+103", Status.OK, Category.Normal],
        [p_val4, p_val2, "0x0.002p-126", Status.OK, Category.Normal],
        [p_val4, m_val2, "0x0.002p-126", Status.OK, Category.Normal],
        [p_val4, p_val3, "0x0p+0", Status.OK, Category.Zero],
        [p_val4, m_val3, "0x0p+0", Status.OK, Category.Zero],
        [p_val4, p_val4, "0x0p+0", Status.OK, Category.Zero],
        [p_val4, m_val4, "0x0p+0", Status.OK, Category.Zero],
        [p_val4, p_val5, "0.5", Status.OK, Category.Normal],
        [p_val4, m_val5, "0.5", Status.OK, Category.Normal],
        [p_val4, p_val6, "0x0p+0", Status.OK, Category.Zero],
        [p_val4, m_val6, "0x0p+0", Status.OK, Category.Zero],
        [m_val4, p_val1, "-0x1p+103", Status.OK, Category.Normal],
        [m_val4, m_val1, "-0x1p+103", Status.OK, Category.Normal],
        [m_val4, p_val2, "-0x0.002p-126", Status.OK, Category.Normal],
        [m_val4, m_val2, "-0x0.002p-126", Status.OK, Category.Normal],
        [m_val4, p_val3, "-0x0p+0", Status.OK, Category.Zero],
        [m_val4, m_val3, "-0x0p+0", Status.OK, Category.Zero],
        [m_val4, p_val4, "-0x0p+0", Status.OK, Category.Zero],
        [m_val4, m_val4, "-0x0p+0", Status.OK, Category.Zero],
        [m_val4, p_val5, "-0.5", Status.OK, Category.Normal],
        [m_val4, m_val5, "-0.5", Status.OK, Category.Normal],
        [m_val4, p_val6, "-0x0p+0", Status.OK, Category.Zero],
        [m_val4, m_val6, "-0x0p+0", Status.OK, Category.Zero],
        [p_val5, p_val1, "1.5", Status.OK, Category.Normal],
        [p_val5, m_val1, "1.5", Status.OK, Category.Normal],
        [p_val5, p_val2, "0x0.00006p-126", Status.OK, Category.Normal],
        [p_val5, m_val2, "0x0.00006p-126", Status.OK, Category.Normal],
        [p_val5, p_val3, "0x0p+0", Status.OK, Category.Zero],
        [p_val5, m_val3, "0x0p+0", Status.OK, Category.Zero],
        [p_val5, p_val4, "1.5", Status.OK, Category.Normal],
        [p_val5, m_val4, "1.5", Status.OK, Category.Normal],
        [p_val5, p_val5, "0x0p+0", Status.OK, Category.Zero],
        [p_val5, m_val5, "0x0p+0", Status.OK, Category.Zero],
        [p_val5, p_val6, "-0.5", Status.OK, Category.Normal],
        [p_val5, m_val6, "-0.5", Status.OK, Category.Normal],
        [m_val5, p_val1, "-1.5", Status.OK, Category.Normal],
        [m_val5, m_val1, "-1.5", Status.OK, Category.Normal],
        [m_val5, p_val2, "-0x0.00006p-126", Status.OK, Category.Normal],
        [m_val5, m_val2, "-0x0.00006p-126", Status.OK, Category.Normal],
        [m_val5, p_val3, "-0x0p+0", Status.OK, Category.Zero],
        [m_val5, m_val3, "-0x0p+0", Status.OK, Category.Zero],
        [m_val5, p_val4, "-1.5", Status.OK, Category.Normal],
        [m_val5, m_val4, "-1.5", Status.OK, Category.Normal],
        [m_val5, p_val5, "-0x0p+0", Status.OK, Category.Zero],
        [m_val5, m_val5, "-0x0p+0", Status.OK, Category.Zero],
        [m_val5, p_val6, "0.5", Status.OK, Category.Normal],
        [m_val5, m_val6, "0.5", Status.OK, Category.Normal],
        [p_val6, p_val1, "0x1p+0", Status.OK, Category.Normal],
        [p_val6, m_val1, "0x1p+0", Status.OK, Category.Normal],
        [p_val6, p_val2, "0x0.00004p-126", Status.OK, Category.Normal],
        [p_val6, m_val2, "0x0.00004p-126", Status.OK, Category.Normal],
        [p_val6, p_val3, "0x0p+0", Status.OK, Category.Zero],
        [p_val6, m_val3, "0x0p+0", Status.OK, Category.Zero],
        [p_val6, p_val4, "0x1p+0", Status.OK, Category.Normal],
        [p_val6, m_val4, "0x1p+0", Status.OK, Category.Normal],
        [p_val6, p_val5, "-0.5", Status.OK, Category.Normal],
        [p_val6, m_val5, "-0.5", Status.OK, Category.Normal],
        [p_val6, p_val6, "0x0p+0", Status.OK, Category.Zero],
        [p_val6, m_val6, "0x0p+0", Status.OK, Category.Zero],
        [m_val6, p_val1, "-0x1p+0", Status.OK, Category.Normal],
        [m_val6, m_val1, "-0x1p+0", Status.OK, Category.Normal],
        [m_val6, p_val2, "-0x0.00004p-126", Status.OK, Category.Normal],
        [m_val6, m_val2, "-0x0.00004p-126", Status.OK, Category.Normal],
        [m_val6, p_val3, "-0x0p+0", Status.OK, Category.Zero],
        [m_val6, m_val3, "-0x0p+0", Status.OK, Category.Zero],
        [m_val6, p_val4, "-0x1p+0", Status.OK, Category.Normal],
        [m_val6, m_val4, "-0x1p+0", Status.OK, Category.Normal],
        [m_val6, p_val5, "0.5", Status.OK, Category.Normal],
        [m_val6, m_val5, "0.5", Status.OK, Category.Normal],
        [m_val6, p_val6, "-0x0p+0", Status.OK, Category.Zero],
        [m_val6, m_val6, "-0x0p+0", Status.OK, Category.Zero],
    ];

    for (const [x, y, e_result, e_status, e_category] of special_cases) {
        const r = x.ieee_rem(y);
        const status = r.status;
        const result = r.value;
        expect(status).toBe(e_status);
        expect(result.category()).toBe(e_category);
        expect(result.bitwise_eq(parse(Single, e_result))).toBe(true); // "result = {result:?}, case = {case:?}"
    }

    let status: Status;
    {
        const f1 = parse(Double, "0x1.3333333333333p-2"); // 0.3
        const f2 = parse(Double, "0x1.47ae147ae147bp-7"); // 0.01
        const expected = parse(Double, "-0x1.4p-56");
        const r = f1.ieee_rem(f2);
        status = r.status;
        expect(r.value.bitwise_eq(expected)).toBe(true);
        expect(status).toBe(Status.OK);
    }
    {
        const f1 = parse(Double, "0x1p64"); // 1.8446744073709552e19
        const f2 = parse(Double, "1.5");
        const expected = parse(Double, "-0.5");
        const r = f1.ieee_rem(f2);
        status = r.status;
        expect(r.value.bitwise_eq(expected)).toBe(true);
        expect(status).toBe(Status.OK);
    }
    {
        const f1 = parse(Double, "0x1p1000");
        const f2 = parse(Double, "0x1p-1000");
        const expected = parse(Double, "0.0");
        const r = f1.ieee_rem(f2);
        status = r.status;
        expect(r.value.bitwise_eq(expected)).toBe(true);
        expect(status).toBe(Status.OK);
    }
    {
        const f1 = Double.INFINITY as unknown as AnyFloat;
        const f2 = parse(Double, "1.0");
        const r = f1.ieee_rem(f2);
        status = r.status;
        expect(r.value.is_nan()).toBe(true);
        expect(status).toBe(Status.INVALID_OP);
    }
    {
        const f1 = parse(Double, "-4.0");
        const f2 = parse(Double, "-2.0");
        const expected = parse(Double, "-0.0");
        const r = f1.ieee_rem(f2);
        status = r.status;
        expect(r.value.bitwise_eq(expected)).toBe(true);
        expect(status).toBe(Status.OK);
    }
    {
        const f1 = parse(Double, "-4.0");
        const f2 = parse(Double, "2.0");
        const expected = parse(Double, "-0.0");
        const r = f1.ieee_rem(f2);
        status = r.status;
        expect(r.value.bitwise_eq(expected)).toBe(true);
        expect(status).toBe(Status.OK);
    }
});

/** `f64::MAX` / `f64::MIN_POSITIVE` / `f32::MAX` / `f32::MIN_POSITIVE` (f32 values as exact JS numbers). */
const F64_MAX = Number.MAX_VALUE;
const F64_MIN_POSITIVE = 2.2250738585072014e-308;
const F32_MAX = Math.fround(3.4028234663852886e38);
const F32_MIN_POSITIVE = Math.fround(1.1754943508222875e-38);

// HACK(eddyb) C`{FLT,DBL}_TRUE_MIN` / C++ `std::numeric_limits<T>::denorm_min`
// equivalents, for the two tests below, as Rust seems to lack anything like them,
// but their bit-patterns are thankfuly trivial, with the main caveat that they
// can't be `const` (subnormals and NaNs are banned from CTFE `{to,from}_bits`).

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4299 x87_largest
test("x87_largest", () => {
  expect(X87DoubleExtended.largest().is_largest()).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4304 x87_next
test("x87_next", () => {
  expect(parse(X87DoubleExtended, "-1.0").next_up().value.ilogb()).toBe(-1);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4309 convert_e4m3fn_to_e5m2
test("convert_e4m3fn_to_e5m2", () => {
  let status: Status;
  const loses_info = { value: false };
  /** `let test: Float8E5M2 = unpack!(status=, test.convert(&mut loses_info));` */
  const convert = (test: IeeeFloat<Semantics>): IeeeFloat<Semantics> => {
    const r = test.convert(Float8E5M2 as unknown as AnyType, loses_info);
    status = r.status;
    return r.value;
  };

  let test = convert(parse(Float8E4M3FN, "1.0") as unknown as AnyFloat);
  expect(to_f32(test)).toBe(1.0);
  expect(!loses_info.value).toBe(true);
  expect(status!).toBe(Status.OK);

  test = convert(parse(Float8E4M3FN, "0.0") as unknown as AnyFloat);
  expect(to_f32(test)).toBe(0.0);
  expect(!loses_info.value).toBe(true);
  expect(status!).toBe(Status.OK);

  test = convert(parse(Float8E4M3FN, "0x1.2p0") as unknown as AnyFloat); // 1.125
  expect(to_f32(test)).toBe(/* 0x1.0p0 */ 1.0);
  expect(loses_info.value).toBe(true);
  expect(status!).toBe(Status.INEXACT);

  test = convert(parse(Float8E4M3FN, "0x1.6p0") as unknown as AnyFloat); // 1.375
  expect(to_f32(test)).toBe(/* 0x1.8p0 */ 1.5);
  expect(loses_info.value).toBe(true);
  expect(status!).toBe(Status.INEXACT);

  // Convert E4M3 denormal to E5M2 normal. Should not be truncated, despite the
  // destination format having one fewer significand bit
  test = convert(parse(Float8E4M3FN, "0x1.Cp-7") as unknown as AnyFloat);
  expect(to_f32(test)).toBe(/* 0x1.Cp-7 */ 0.013671875);
  expect(!loses_info.value).toBe(true);
  expect(status!).toBe(Status.OK);

  // Test convert from NaN
  test = convert(parse(Float8E4M3FN, "nan") as unknown as AnyFloat);
  expect(Number.isNaN(to_f32(test))).toBe(true);
  expect(!loses_info.value).toBe(true);
  expect(status!).toBe(Status.OK);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4354 convert_e5m2_to_e4m3fn
test("convert_e5m2_to_e4m3fn", () => {
  let status: Status;
  const loses_info = { value: false };
  /** `let test: Float8E4M3FN = unpack!(status=, test.convert(&mut loses_info));` */
  const convert = (test: IeeeFloat<Semantics>): IeeeFloat<Semantics> => {
    const r = test.convert(Float8E4M3FN as unknown as AnyType, loses_info);
    status = r.status;
    return r.value;
  };

  let test = convert(parse(Float8E5M2, "1.0") as unknown as AnyFloat);
  expect(to_f32(test)).toBe(1.0);
  expect(!loses_info.value).toBe(true);
  expect(status!).toBe(Status.OK);

  test = convert(parse(Float8E5M2, "0.0") as unknown as AnyFloat);
  expect(to_f32(test)).toBe(0.0);
  expect(!loses_info.value).toBe(true);
  expect(status!).toBe(Status.OK);

  test = convert(parse(Float8E5M2, "0x1.Cp8") as unknown as AnyFloat); // 448
  expect(to_f32(test)).toBe(/* 0x1.Cp8 */ 448.0);
  expect(!loses_info.value).toBe(true);
  expect(status!).toBe(Status.OK);

  // Test overflow
  test = convert(parse(Float8E5M2, "0x1.0p9") as unknown as AnyFloat); // 512
  expect(Number.isNaN(to_f32(test))).toBe(true);
  expect(loses_info.value).toBe(true);
  expect(status!).toBe((Status.OVERFLOW | Status.INEXACT) as Status);

  // Test underflow
  test = convert(parse(Float8E5M2, "0x1.0p-10") as unknown as AnyFloat);
  expect(to_f32(test)).toBe(0);
  expect(loses_info.value).toBe(true);
  expect(status!).toBe((Status.UNDERFLOW | Status.INEXACT) as Status);

  // Test rounding up to smallest denormal number
  test = convert(parse(Float8E5M2, "0x1.8p-10") as unknown as AnyFloat);
  expect(to_f32(test)).toBe(/* 0x1.0p-9 */ 0.001953125);
  expect(loses_info.value).toBe(true);
  expect(status!).toBe((Status.UNDERFLOW | Status.INEXACT) as Status);

  // Testing inexact rounding to denormal number
  test = convert(parse(Float8E5M2, "0x1.8p-9") as unknown as AnyFloat);
  expect(to_f32(test)).toBe(/* 0x1.0p-8 */ 0.00390625);
  expect(loses_info.value).toBe(true);
  expect(status!).toBe((Status.UNDERFLOW | Status.INEXACT) as Status);

  const nan = parse(Float8E4M3FN, "nan") as unknown as AnyFloat;

  // Testing convert from Inf
  test = convert(parse(Float8E5M2, "inf") as unknown as AnyFloat);
  expect(Number.isNaN(to_f32(test))).toBe(true);
  expect(loses_info.value).toBe(true);
  expect(status!).toBe(Status.INEXACT);
  expect(test.bitwise_eq(nan)).toBe(true);

  // Testing convert from quiet NaN
  test = convert(parse(Float8E5M2, "nan") as unknown as AnyFloat);
  expect(Number.isNaN(to_f32(test))).toBe(true);
  expect(loses_info.value).toBe(true);
  expect(status!).toBe(Status.OK);
  expect(test.bitwise_eq(nan)).toBe(true);

  // Testing convert from signaling NaN
  test = convert(parse(Float8E5M2, "snan") as unknown as AnyFloat);
  expect(Number.isNaN(to_f32(test))).toBe(true);
  expect(loses_info.value).toBe(true);
  expect(status!).toBe(Status.INVALID_OP);
  expect(test.bitwise_eq(nan)).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4432 float8e4m3fn_infinity
test("float8e4m3fn_infinity", () => {
  const t = Float8E4M3FN.INFINITY;
  expect(t.is_nan()).toBe(true);
  expect(!t.is_infinite()).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4439 float8e4m3fn_from_string
test("float8e4m3fn_from_string", () => {
  const p = (s: string) => parse(Float8E4M3FN, s) as unknown as AnyFloat;
  // Exactly representable
  expect(to_f64(p("448"))).toBe(448.0);
  // Round down to maximum value
  expect(to_f64(p("464"))).toBe(448.0);
  // Round up, causing overflow to NaN
  expect(p("465").is_nan()).toBe(true);
  // Overflow without rounding
  expect(p("480").is_nan()).toBe(true);
  // Inf converted to NaN
  expect(p("inf").is_nan()).toBe(true);
  // NaN converted to NaN
  expect(p("nan").is_nan()).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4455 float8e4m3fn_add
test("float8e4m3fn_add", () => {
  const qnan = Float8E4M3FN.NAN;

  const from_str = (s: string) => parse(Float8E4M3FN, s);

  const addition_tests: [typeof qnan, typeof qnan, string, Status, Category, Round][] = [
    // Test addition operations involving NaN, overflow, and the max E4M3
    // value (448) because E4M3 differs from IEEE-754 types in these regards
    [from_str("448"), from_str("16"), "448", Status.INEXACT, Category.Normal, Round.NearestTiesToEven],
    [from_str("448"), from_str("18"), "NaN", (Status.OVERFLOW | Status.INEXACT) as Status, Category.NaN, Round.NearestTiesToEven],
    [from_str("448"), from_str("32"), "NaN", (Status.OVERFLOW | Status.INEXACT) as Status, Category.NaN, Round.NearestTiesToEven],
    [from_str("-448"), from_str("-32"), "-NaN", (Status.OVERFLOW | Status.INEXACT) as Status, Category.NaN, Round.NearestTiesToEven],
    [qnan, from_str("-448"), "NaN", Status.OK, Category.NaN, Round.NearestTiesToEven],
    [from_str("448"), from_str("-32"), "416", Status.OK, Category.Normal, Round.NearestTiesToEven],
    [from_str("448"), from_str("0"), "448", Status.OK, Category.Normal, Round.NearestTiesToEven],
    [from_str("448"), from_str("32"), "448", Status.INEXACT, Category.Normal, Round.TowardZero],
    [from_str("448"), from_str("448"), "448", Status.INEXACT, Category.Normal, Round.TowardZero],
  ];

  for (const [x, y, e_result, e_status, e_category, round] of addition_tests) {
    const r = x.add_r(y, round);
    const status = r.status;
    const result = r.value;
    expect(status).toBe(e_status);
    expect(result.category()).toBe(e_category);
    expect(result.bitwise_eq(parse(Float8E4M3FN, e_result))).toBe(true); // "result = {result:?}, case = {case:?}"
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4505 float8e4m3fn_divide_by_zero
test("float8e4m3fn_divide_by_zero", () => {
  const x = parse(Float8E4M3FN, "1");
  const zero = parse(Float8E4M3FN, "0");
  const r = x.div(zero);
  const status = r.status;
  expect(r.value.is_nan()).toBe(true);
  expect(status).toBe(Status.DIV_BY_ZERO);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4514 float8e4m3fn_next
test("float8e4m3fn_next", () => {
  let status: Status;
  /** `unpack!(status=, e)` */
  const unpack = <X>(e: StatusAnd<X>): X => {
    status = e.status;
    return e.value;
  };

  // nextUp on positive numbers
  for (let i = 0n; i < 127n; i++) {
    const test = Float8E4M3FN.from_bits(i);
    const expected = Float8E4M3FN.from_bits(i + 1n);
    expect(unpack(test.next_up()).bitwise_eq(expected)).toBe(true);
    expect(status!).toBe(Status.OK);
  }

  // nextUp on negative zero
  let test = Float8E4M3FN.ZERO.neg();
  let expected = Float8E4M3FN.SMALLEST;
  expect(unpack(test.next_up()).bitwise_eq(expected)).toBe(true);
  expect(status!).toBe(Status.OK);

  // nextUp on negative nonzero numbers
  for (let i = 129n; i < 255n; i++) {
    const test = Float8E4M3FN.from_bits(i);
    const expected = Float8E4M3FN.from_bits(i - 1n);
    expect(unpack(test.next_up()).bitwise_eq(expected)).toBe(true);
    expect(status!).toBe(Status.OK);
  }

  // nextUp on NaN
  test = Float8E4M3FN.qnan(undefined);
  expected = Float8E4M3FN.qnan(undefined);
  expect(unpack(test.next_up()).bitwise_eq(expected)).toBe(true);
  expect(status!).toBe(Status.OK);

  // nextDown on positive nonzero finite numbers
  for (let i = 1n; i < 127n; i++) {
    const test = Float8E4M3FN.from_bits(i);
    const expected = Float8E4M3FN.from_bits(i - 1n);
    expect(unpack(test.next_down()).bitwise_eq(expected)).toBe(true);
    expect(status!).toBe(Status.OK);
  }

  // nextDown on positive zero
  test = Float8E4M3FN.ZERO.neg();
  expected = Float8E4M3FN.SMALLEST.neg();
  expect(unpack(test.next_down()).bitwise_eq(expected)).toBe(true);
  expect(status!).toBe(Status.OK);

  // nextDown on negative finite numbers
  for (let i = 128n; i < 255n; i++) {
    const test = Float8E4M3FN.from_bits(i);
    const expected = Float8E4M3FN.from_bits(i + 1n);
    expect(unpack(test.next_down()).bitwise_eq(expected)).toBe(true);
    expect(status!).toBe(Status.OK);
  }

  // nextDown on NaN
  test = Float8E4M3FN.qnan(undefined);
  expected = Float8E4M3FN.qnan(undefined);
  expect(unpack(test.next_down()).bitwise_eq(expected)).toBe(true);
  expect(status!).toBe(Status.OK);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4575 float8e4m3fn_exhaustive
test("float8e4m3fn_exhaustive", () => {
  // Test each of the 256 Float8E4M3FN values.
  for (let i = 0; i <= 255; i++) {
    const test = Float8E4M3FN.from_bits(BigInt(i)) as unknown as AnyFloat;

    // isLargest
    if (i === 126 || i === 254) {
      expect(test.is_largest()).toBe(true);
      expect(to_f64(test.abs())).toBe(448);
    } else {
      expect(!test.is_largest()).toBe(true);
    }

    // isSmallest
    if (i === 1 || i === 129) {
      expect(test.is_smallest()).toBe(true);
      expect(to_f64(test.abs())).toBe(/* 0x1p-9 */ 0.001953125);
    } else {
      expect(!test.is_smallest()).toBe(true);
    }

    // convert to BFloat
    const loses_info = { value: false };
    const r = test.convert(BFloat as unknown as AnyType, loses_info);
    const status = r.status;
    const test2 = r.value;
    expect(status).toBe(Status.OK);
    expect(!loses_info.value).toBe(true);
    if (i === 127 || i === 255) {
      expect(test2.is_nan()).toBe(true);
    } else {
      expect(to_f32(test)).toBe(to_f32(test2));
    }

    // bitcastToAPInt
    expect(test.to_bits()).toBe(BigInt(i));
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4614 float8e4m3fn_exhaustive_pair
test(
  "float8e4m3fn_exhaustive_pair",
  () => {
    const E4 = Float8E4M3FN as unknown as AnyType;
    const H = Half as unknown as AnyType;
    // Test each pair of Float8E4M3FN values.
    for (let i = 0; i <= 255; i++) {
      for (let j = 0; j <= 255; j++) {
        const x = E4.from_bits(BigInt(i));
        const y = E4.from_bits(BigInt(j));

        const loses_info = { value: false };
        const x16 = x.convert(H, loses_info).value;
        expect(!loses_info.value).toBe(true);
        const y16 = y.convert(H, loses_info).value;
        expect(!loses_info.value).toBe(true);

        // Add
        let z = x.add(y).value;
        let z16 = x16.add(y16).value;
        expect(z.bitwise_eq(z16.convert(E4, loses_info).value)).toBe(true); // "i={i}, j={j}"

        // Subtract
        z = x.sub(y).value;
        z16 = x16.sub(y16).value;
        expect(z.bitwise_eq(z16.convert(E4, loses_info).value)).toBe(true); // "i={i}, j={j}"

        // Multiply
        z = x.mul(y).value;
        z16 = x16.mul(y16).value;
        expect(z.bitwise_eq(z16.convert(E4, loses_info).value)).toBe(true); // "i={i}, j={j}"

        // Divide
        z = x.div(y).value;
        z16 = x16.div(y16).value;
        expect(z.bitwise_eq(z16.convert(E4, loses_info).value)).toBe(true); // "i={i}, j={j}"

        // Mod
        z = x.rem(y).value;
        z16 = x16.rem(y16).value;
        expect(z.bitwise_eq(z16.convert(E4, loses_info).value)).toBe(true); // "i={i}, j={j}"

        // Remainder
        z = x.ieee_rem(y).value;
        z16 = x16.ieee_rem(y16).value;
        expect(z.bitwise_eq(z16.convert(E4, loses_info).value)).toBe(true); // "i={i}, j={j}"
      }
    }
  },
  120_000,
);

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4661 f8_to_string
test("f8_to_string", () => {
  for_each_float_type(test);
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4663 test
  function test<F extends Float<F>>(F: FloatType<F>): void {
    if (F.BITS !== 8) {
      return;
    }

    // NOTE(eddyb) this was buggy upstream as it didn't test `F` but `Float8E5M2`,
    // https://github.com/llvm/llvm-project/commit/6109e70c72fc5171d25c4467fc3cfe6eb2029f50
    // fixed it upstream so we've effectively backported that commit.
    for (let i = 0; i <= 255; i++) {
      const test = F.from_bits(BigInt(i));
      const str = test.fmt();

      if (test.is_nan()) {
        expect(str).toBe("NaN");
      } else {
        expect(test.bitwise_eq(parse(F, str))).toBe(true);
      }
    }
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4688 f64_smallest_subnormal
function f64_smallest_subnormal(): number {
  f32_buf.setBigUint64(0, 1n);
  return f32_buf.getFloat64(0);
}
// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4691 f32_smallest_subnormal
function f32_smallest_subnormal(): number {
  f32_buf.setUint32(0, 1);
  return f32_buf.getFloat32(0);
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4696 double_to_f64
test("double_to_f64", () => {
  const d_pos_zero = from_f64(0.0);
  expect(from_f64(double_to_f64(d_pos_zero)).is_pos_zero()).toBe(true);
  const d_neg_zero = from_f64(-0.0);
  expect(from_f64(double_to_f64(d_neg_zero)).is_neg_zero()).toBe(true);

  const d_one = from_f64(1.0);
  expect(double_to_f64(d_one)).toBe(1.0);
  const d_pos_largest = Double.largest() as unknown as AnyFloat;
  expect(double_to_f64(d_pos_largest)).toBe(F64_MAX);
  const d_neg_largest = Double.largest().neg() as unknown as AnyFloat;
  expect(double_to_f64(d_neg_largest)).toBe(-F64_MAX);
  const d_pos_smallest = Double.smallest_normalized() as unknown as AnyFloat;
  expect(double_to_f64(d_pos_smallest)).toBe(F64_MIN_POSITIVE);
  const d_neg_smallest = Double.smallest_normalized().neg() as unknown as AnyFloat;
  expect(double_to_f64(d_neg_smallest)).toBe(-F64_MIN_POSITIVE);

  const d_smallest_denorm = Double.SMALLEST as unknown as AnyFloat;
  expect(double_to_f64(d_smallest_denorm)).toBe(f64_smallest_subnormal());
  const d_largest_denorm = parse(Double, "0x0.FFFFFFFFFFFFFp-1022");
  expect(double_to_f64(d_largest_denorm)).toBe(/*0x0.FFFFFFFFFFFFFp-1022*/ 2.225073858507201e-308);

  const d_pos_inf = Double.INFINITY as unknown as AnyFloat;
  expect(double_to_f64(d_pos_inf)).toBe(Infinity);
  const d_neg_inf = Double.INFINITY.neg() as unknown as AnyFloat;
  expect(double_to_f64(d_neg_inf)).toBe(-Infinity);
  const d_qnan = Double.qnan(undefined) as unknown as AnyFloat;
  expect(Number.isNaN(double_to_f64(d_qnan))).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4727 single_to_f64
test("single_to_f64", () => {
  const f_pos_zero = from_f32(0.0);
  expect(from_f64(to_f64(f_pos_zero)).is_pos_zero()).toBe(true);
  const f_neg_zero = from_f32(-0.0);
  expect(from_f64(to_f64(f_neg_zero)).is_neg_zero()).toBe(true);

  const f_one = from_f32(1.0);
  expect(to_f64(f_one)).toBe(1.0);
  const f_pos_largest = Single.largest() as unknown as AnyFloat;
  expect(to_f64(f_pos_largest)).toBe(F32_MAX);
  const f_neg_largest = Single.largest().neg() as unknown as AnyFloat;
  expect(to_f64(f_neg_largest)).toBe(-F32_MAX);
  const f_pos_smallest = Single.smallest_normalized() as unknown as AnyFloat;
  expect(to_f64(f_pos_smallest)).toBe(F32_MIN_POSITIVE);
  const f_neg_smallest = Single.smallest_normalized().neg() as unknown as AnyFloat;
  expect(to_f64(f_neg_smallest)).toBe(-F32_MIN_POSITIVE);

  const f_smallest_denorm = Single.SMALLEST as unknown as AnyFloat;
  expect(to_f64(f_smallest_denorm)).toBe(f32_smallest_subnormal());
  const f_largest_denorm = parse(Double, "0x0.FFFFFEp-126");
  expect(double_to_f64(f_largest_denorm)).toBe(/*0x0.FFFFFEp-126*/ 1.1754942106924411e-38);

  const f_pos_inf = Single.INFINITY as unknown as AnyFloat;
  expect(to_f64(f_pos_inf)).toBe(Infinity);
  const f_neg_inf = Single.INFINITY.neg() as unknown as AnyFloat;
  expect(to_f64(f_neg_inf)).toBe(-Infinity);
  const f_qnan = Single.qnan(undefined) as unknown as AnyFloat;
  expect(Number.isNaN(to_f64(f_qnan))).toBe(true);

  const h_pos_zero = Half.ZERO as unknown as AnyFloat;
  expect(from_f64(to_f64(h_pos_zero)).is_pos_zero()).toBe(true);
  const h_neg_zero = Half.ZERO.neg() as unknown as AnyFloat;
  expect(from_f64(to_f64(h_neg_zero)).is_neg_zero()).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4763 half_to_f64
test("half_to_f64", () => {
  const h_one = parse(Half, "1.0");
  expect(to_f64(h_one)).toBe(1.0);
  const h_pos_largest = Half.largest() as unknown as AnyFloat;
  expect(to_f64(h_pos_largest)).toBe(65504.0);
  const h_neg_largest = Half.largest().neg() as unknown as AnyFloat;
  expect(to_f64(h_neg_largest)).toBe(-65504.0);
  const h_pos_smallest = Half.smallest_normalized() as unknown as AnyFloat;
  expect(to_f64(h_pos_smallest)).toBe(/*0x1.p-14*/ 6.103515625e-5);
  const h_neg_smallest = Half.smallest_normalized().neg() as unknown as AnyFloat;
  expect(to_f64(h_neg_smallest)).toBe(/*-0x1.p-14*/ -6.103515625e-5);

  const h_smallest_denorm = Half.SMALLEST as unknown as AnyFloat;
  expect(to_f64(h_smallest_denorm)).toBe(/*0x1.p-24*/ 5.960464477539063e-8);
  const h_largest_denorm = parse(Half, "0x1.FFCp-14");
  expect(to_f64(h_largest_denorm)).toBe(/*0x1.FFCp-14*/ 0.00012201070785522461);

  const h_pos_inf = Half.INFINITY as unknown as AnyFloat;
  expect(to_f64(h_pos_inf)).toBe(Infinity);
  const h_neg_inf = Half.INFINITY.neg() as unknown as AnyFloat;
  expect(to_f64(h_neg_inf)).toBe(-Infinity);
  const h_qnan = Half.qnan(undefined) as unknown as AnyFloat;
  expect(Number.isNaN(to_f64(h_qnan))).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4789 bfloat_to_f64
test("bfloat_to_f64", () => {
  const b_pos_zero = Half.ZERO as unknown as AnyFloat;
  expect(from_f64(to_f64(b_pos_zero)).is_pos_zero()).toBe(true);
  const b_neg_zero = Half.ZERO.neg() as unknown as AnyFloat;
  expect(from_f64(to_f64(b_neg_zero)).is_neg_zero()).toBe(true);

  const b_one = parse(BFloat, "1.0");
  expect(to_f64(b_one)).toBe(1.0);
  const b_pos_largest = BFloat.largest() as unknown as AnyFloat;
  expect(to_f64(b_pos_largest)).toBe(/*0x1.FEp127*/ 3.3895313892515355e38);
  const b_neg_largest = BFloat.largest().neg() as unknown as AnyFloat;
  expect(to_f64(b_neg_largest)).toBe(/*-0x1.FEp127*/ -3.3895313892515355e38);
  const b_pos_smallest = BFloat.smallest_normalized() as unknown as AnyFloat;
  expect(to_f64(b_pos_smallest)).toBe(/*0x1.p-126*/ 1.1754943508222875e-38);
  const b_neg_smallest = BFloat.smallest_normalized().neg() as unknown as AnyFloat;
  expect(to_f64(b_neg_smallest)).toBe(/*-0x1.p-126*/ -1.1754943508222875e-38);

  const b_smallest_denorm = BFloat.SMALLEST as unknown as AnyFloat;
  expect(to_f64(b_smallest_denorm)).toBe(/*0x1.p-133*/ 9.183549615799121e-41);
  const b_largest_denorm = parse(BFloat, "0x1.FCp-127");
  expect(to_f64(b_largest_denorm)).toBe(/*0x1.FCp-127*/ 1.1663108012064884e-38);

  const b_pos_inf = BFloat.INFINITY as unknown as AnyFloat;
  expect(to_f64(b_pos_inf)).toBe(Infinity);
  const b_neg_inf = BFloat.INFINITY.neg() as unknown as AnyFloat;
  expect(to_f64(b_neg_inf)).toBe(-Infinity);
  const b_qnan = BFloat.qnan(undefined) as unknown as AnyFloat;
  expect(Number.isNaN(to_f64(b_qnan))).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4820 float8e5m2_to_f64
test("float8e5m2_to_f64", () => {
  const one = parse(Float8E5M2, "1.0");
  expect(to_f64(one)).toBe(1.0);
  const two = parse(Float8E5M2, "2.0");
  expect(to_f64(two)).toBe(2.0);
  const pos_largest = Float8E5M2.largest() as unknown as AnyFloat;
  expect(to_f64(pos_largest)).toBe(5.7344e4);
  const neg_largest = Float8E5M2.largest().neg() as unknown as AnyFloat;
  expect(to_f64(neg_largest)).toBe(-5.7344e4);
  const pos_smallest = Float8E5M2.smallest_normalized() as unknown as AnyFloat;
  expect(to_f64(pos_smallest)).toBe(/* 0x1.p-14 */ 6.103515625e-5);
  const neg_smallest = Float8E5M2.smallest_normalized().neg() as unknown as AnyFloat;
  expect(to_f64(neg_smallest)).toBe(/* -0x1.p-14 */ -6.103515625e-5);

  const smallest_denorm = Float8E5M2.SMALLEST as unknown as AnyFloat;
  expect(smallest_denorm.is_denormal()).toBe(true);
  expect(to_f64(smallest_denorm)).toBe(/* 0x1p-16 */ 0.0000152587890625);

  const pos_inf = Float8E5M2.INFINITY as unknown as AnyFloat;
  expect(to_f64(pos_inf)).toBe(Infinity);
  const neg_inf = Float8E5M2.INFINITY.neg() as unknown as AnyFloat;
  expect(to_f64(neg_inf)).toBe(-Infinity);
  const qnan = Float8E5M2.qnan(undefined) as unknown as AnyFloat;
  expect(Number.isNaN(to_f64(qnan))).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4847 float8e4m3fn_to_f64
test("float8e4m3fn_to_f64", () => {
  const one = parse(Float8E4M3FN, "1.0");
  expect(to_f64(one)).toBe(1.0);
  const two = parse(Float8E4M3FN, "2.0");
  expect(to_f64(two)).toBe(2.0);
  const pos_largest = Float8E4M3FN.largest() as unknown as AnyFloat;
  expect(to_f64(pos_largest)).toBe(448);
  const neg_largest = Float8E4M3FN.largest().neg() as unknown as AnyFloat;
  expect(to_f64(neg_largest)).toBe(-448);
  const pos_smallest = Float8E4M3FN.smallest_normalized() as unknown as AnyFloat;
  expect(to_f64(pos_smallest)).toBe(/* 0x1.p-6 */ 0.015625);
  const neg_smallest = Float8E4M3FN.smallest_normalized().neg() as unknown as AnyFloat;
  expect(to_f64(neg_smallest)).toBe(/* -0x1.p-6 */ -0.015625);

  const smallest_denorm = Float8E4M3FN.SMALLEST as unknown as AnyFloat;
  expect(smallest_denorm.is_denormal()).toBe(true);
  expect(to_f64(smallest_denorm)).toBe(/* 0x1p-9 */ 0.001953125);

  const qnan = Float8E4M3FN.qnan(undefined) as unknown as AnyFloat;
  expect(Number.isNaN(to_f64(qnan))).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4870 single_to_f32
test("single_to_f32", () => {
  const f_pos_zero = from_f32(0.0);
  expect(from_f32(single_to_f32(f_pos_zero)).is_pos_zero()).toBe(true);
  const f_neg_zero = from_f32(-0.0);
  expect(from_f32(single_to_f32(f_neg_zero)).is_neg_zero()).toBe(true);

  const f_one = from_f32(1.0);
  expect(single_to_f32(f_one)).toBe(1.0);
  const f_pos_largest = Single.largest() as unknown as AnyFloat;
  expect(single_to_f32(f_pos_largest)).toBe(F32_MAX);
  const f_neg_largest = Single.largest().neg() as unknown as AnyFloat;
  expect(single_to_f32(f_neg_largest)).toBe(-F32_MAX);
  const f_pos_smallest = Single.smallest_normalized() as unknown as AnyFloat;
  expect(single_to_f32(f_pos_smallest)).toBe(F32_MIN_POSITIVE);
  const f_neg_smallest = Single.smallest_normalized().neg() as unknown as AnyFloat;
  expect(single_to_f32(f_neg_smallest)).toBe(-F32_MIN_POSITIVE);

  const f_smallest_denorm = Single.SMALLEST as unknown as AnyFloat;
  expect(single_to_f32(f_smallest_denorm)).toBe(f32_smallest_subnormal());
  const f_largest_denorm = parse(Single, "0x1.FFFFFEp-126");
  expect(single_to_f32(f_largest_denorm)).toBe(Math.fround(/*0x1.FFFFFEp-126*/ 2.3509885615147286e-38));

  const f_pos_inf = Single.INFINITY as unknown as AnyFloat;
  expect(single_to_f32(f_pos_inf)).toBe(Infinity);
  const f_neg_inf = Single.INFINITY.neg() as unknown as AnyFloat;
  expect(single_to_f32(f_neg_inf)).toBe(-Infinity);
  const f_qnan = Single.qnan(undefined) as unknown as AnyFloat;
  expect(Number.isNaN(single_to_f32(f_qnan))).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4901 half_to_f32
test("half_to_f32", () => {
  const h_pos_zero = Half.ZERO as unknown as AnyFloat;
  expect(from_f32(to_f32(h_pos_zero)).is_pos_zero()).toBe(true);
  const h_neg_zero = Half.ZERO.neg() as unknown as AnyFloat;
  expect(from_f32(to_f32(h_neg_zero)).is_neg_zero()).toBe(true);

  const h_one = parse(Half, "1.0");
  expect(to_f32(h_one)).toBe(1.0);
  const h_pos_largest = Half.largest() as unknown as AnyFloat;
  expect(to_f32(h_pos_largest)).toBe(/*0x1.FFCp15*/ 65504.0);
  const h_neg_largest = Half.largest().neg() as unknown as AnyFloat;
  expect(to_f32(h_neg_largest)).toBe(/*-0x1.FFCp15*/ -65504.0);
  const h_pos_smallest = Half.smallest_normalized() as unknown as AnyFloat;
  expect(to_f32(h_pos_smallest)).toBe(/*0x1.p-14*/ Math.fround(6.103515625e-5));
  const h_neg_smallest = Half.smallest_normalized().neg() as unknown as AnyFloat;
  expect(to_f32(h_neg_smallest)).toBe(/*-0x1.p-14*/ Math.fround(-6.103515625e-5));

  const h_smallest_denorm = Half.SMALLEST as unknown as AnyFloat;
  expect(to_f32(h_smallest_denorm)).toBe(/*0x1.p-24*/ Math.fround(5.960464477539063e-8));
  const h_largest_denorm = parse(Half, "0x1.FFCp-14");
  expect(to_f32(h_largest_denorm)).toBe(/*0x1.FFCp-14*/ Math.fround(0.00012201070785522461));

  const h_pos_inf = Half.INFINITY as unknown as AnyFloat;
  expect(to_f32(h_pos_inf)).toBe(Infinity);
  const h_neg_inf = Half.INFINITY.neg() as unknown as AnyFloat;
  expect(to_f32(h_neg_inf)).toBe(-Infinity);
  const h_qnan = Half.qnan(undefined) as unknown as AnyFloat;
  expect(Number.isNaN(to_f32(h_qnan))).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4932 bfloat_to_f32
test("bfloat_to_f32", () => {
  const b_pos_zero = BFloat.ZERO as unknown as AnyFloat;
  expect(from_f32(to_f32(b_pos_zero)).is_pos_zero()).toBe(true);
  const b_neg_zero = BFloat.ZERO.neg() as unknown as AnyFloat;
  expect(from_f32(to_f32(b_neg_zero)).is_neg_zero()).toBe(true);

  const b_one = parse(BFloat, "1.0");
  expect(to_f32(b_one)).toBe(1.0);
  const b_pos_largest = BFloat.largest() as unknown as AnyFloat;
  expect(to_f32(b_pos_largest)).toBe(/*0x1.FEp127*/ Math.fround(3.3895313892515355e38));
  const b_neg_largest = BFloat.largest().neg() as unknown as AnyFloat;
  expect(to_f32(b_neg_largest)).toBe(/*-0x1.FEp127*/ Math.fround(-3.3895313892515355e38));
  const b_pos_smallest = BFloat.smallest_normalized() as unknown as AnyFloat;
  expect(to_f32(b_pos_smallest)).toBe(/*0x1.p-126*/ Math.fround(1.1754943508222875e-38));
  const b_neg_smallest = BFloat.smallest_normalized().neg() as unknown as AnyFloat;
  expect(to_f32(b_neg_smallest)).toBe(/*-0x1.p-126*/ Math.fround(-1.1754943508222875e-38));

  const b_smallest_denorm = BFloat.SMALLEST as unknown as AnyFloat;
  expect(to_f32(b_smallest_denorm)).toBe(/*0x1.p-133*/ Math.fround(9.183549615799121e-41));
  const b_largest_denorm = parse(BFloat, "0x1.FCp-127");
  expect(to_f32(b_largest_denorm)).toBe(/*0x1.FCp-127*/ Math.fround(1.1663108012064884e-38));

  const b_pos_inf = BFloat.INFINITY as unknown as AnyFloat;
  expect(to_f32(b_pos_inf)).toBe(Infinity);
  const b_neg_inf = BFloat.INFINITY.neg() as unknown as AnyFloat;
  expect(to_f32(b_neg_inf)).toBe(-Infinity);
  const b_qnan = BFloat.qnan(undefined) as unknown as AnyFloat;
  expect(Number.isNaN(to_f32(b_qnan))).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4963 float8e5m2_to_f32
test("float8e5m2_to_f32", () => {
  const pos_zero = Float8E5M2.ZERO as unknown as AnyFloat;
  expect(from_f32(to_f32(pos_zero)).is_pos_zero()).toBe(true);
  const neg_zero = Float8E5M2.ZERO.neg() as unknown as AnyFloat;
  expect(from_f32(to_f32(neg_zero)).is_neg_zero()).toBe(true);

  const one = parse(Float8E5M2, "1.0");
  expect(to_f32(one)).toBe(1.0);
  const two = parse(Float8E5M2, "2.0");
  expect(to_f32(two)).toBe(2.0);

  const pos_largest = Float8E5M2.largest() as unknown as AnyFloat;
  expect(to_f32(pos_largest)).toBe(5.7344e4);
  const neg_largest = Float8E5M2.largest().neg() as unknown as AnyFloat;
  expect(to_f32(neg_largest)).toBe(-5.7344e4);
  const pos_smallest = Float8E5M2.smallest_normalized() as unknown as AnyFloat;
  expect(to_f32(pos_smallest)).toBe(/* 0x1.p-14 */ Math.fround(6.103515625e-5));
  const neg_smallest = Float8E5M2.smallest_normalized().neg() as unknown as AnyFloat;
  expect(to_f32(neg_smallest)).toBe(/* -0x1.p-14 */ Math.fround(-6.103515625e-5));

  const smallest_denorm = Float8E5M2.SMALLEST as unknown as AnyFloat;
  expect(smallest_denorm.is_denormal()).toBe(true);
  expect(to_f32(smallest_denorm)).toBe(/* 0x1.p-16 */ Math.fround(0.0000152587890625));

  const pos_inf = Float8E5M2.INFINITY as unknown as AnyFloat;
  expect(to_f32(pos_inf)).toBe(Infinity);
  const neg_inf = Float8E5M2.INFINITY.neg() as unknown as AnyFloat;
  expect(to_f32(neg_inf)).toBe(-Infinity);
  const qnan = Float8E5M2.qnan(undefined) as unknown as AnyFloat;
  expect(Number.isNaN(to_f32(qnan))).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ieee.rs:4996 float8e4m3fn_to_f32
test("float8e4m3fn_to_f32", () => {
  const pos_zero = Float8E4M3FN.ZERO as unknown as AnyFloat;
  expect(from_f32(to_f32(pos_zero)).is_pos_zero()).toBe(true);
  const neg_zero = Float8E4M3FN.ZERO.neg() as unknown as AnyFloat;
  expect(from_f32(to_f32(neg_zero)).is_neg_zero()).toBe(true);

  const one = parse(Float8E4M3FN, "1.0");
  expect(to_f32(one)).toBe(1.0);
  const two = parse(Float8E4M3FN, "2.0");
  expect(to_f32(two)).toBe(2.0);

  const pos_largest = Float8E4M3FN.largest() as unknown as AnyFloat;
  expect(to_f32(pos_largest)).toBe(448);
  const neg_largest = Float8E4M3FN.largest().neg() as unknown as AnyFloat;
  expect(to_f32(neg_largest)).toBe(-448.0);
  const pos_smallest = Float8E4M3FN.smallest_normalized() as unknown as AnyFloat;
  expect(to_f32(pos_smallest)).toBe(/* 0x1.p-6 */ 0.015625);
  const neg_smallest = Float8E4M3FN.smallest_normalized().neg() as unknown as AnyFloat;
  expect(to_f32(neg_smallest)).toBe(/* -0x1.p-6 */ -0.015625);

  const smallest_denorm = Float8E4M3FN.SMALLEST as unknown as AnyFloat;
  expect(smallest_denorm.is_denormal()).toBe(true);
  expect(to_f32(smallest_denorm)).toBe(/* 0x1.p-9 */ 0.001953125);

  const qnan = Float8E4M3FN.qnan(undefined) as unknown as AnyFloat;
  expect(Number.isNaN(to_f32(qnan))).toBe(true);
});
