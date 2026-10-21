// Port of rustc_apfloat =0.2.3+llvm-462a31f5a5ab `tests/ieee.rs` (the crate's integration tests of the IEEE formats).
//
// PORT: conventions.
// - `assert!(c)` is `expect(c).toBe(true)`, `assert_eq!(a, b)` is `expect(a).toBe(b)` (`toEqual` for strings /
//   bigints is the same), `unpack!(status=, e)` is written out (`r = e; status = r.status; x = r.value`).
// - Host floats (`f32` / `f64`) are JS numbers: `from_f32` / `to_f32` go through the IEEE single bit pattern
//   (`Math.fround` values), `from_f64` / `to_f64` through the double bit pattern.
// - `for_each_float_type!` runs the body once per float type dictionary (`FLOAT_TYPES`).
//
// Lane vendor-apfloat-a ported the tests listed by `bun scripts/coverage.ts --missing ...tests/ieee.rs` as covered;
// lane vendor-apfloat-b ports the rest (and `rustc_apfloat::ppc::DoubleDouble` joins `FLOAT_TYPES`).
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

// Referenced by tests ported later (vendor-apfloat-b); keeps the imports of the upstream file.
void [BFloat, Float8E4M3FN, Float8E5M2, Half, X87DoubleExtended, Category, IEK_INF, IEK_NAN, IEK_ZERO, Round];
export type { ExpInt, Ordering, StatusAnd };

type AnyFloat = IeeeFloat<Semantics>;
type AnyType = IeeeFloatType<Semantics>;

// FIXME(eddyb) maybe include this in `rustc_apfloat` itself?
// macro_rules! define_for_each_float_type / for_each_float_type: the float types, in upstream order.
// NOTE(eddyb) tests for `rustc_apfloat::ppc::DoubleDouble` are usually in `ppc.rs` but this works too.
// PORT: `DoubleDouble` is added with ppc.ts (lane vendor-apfloat-b).
const FLOAT_TYPES: readonly AnyType[] = [
  Half,
  Single,
  Double,
  Quad,

  BFloat,
  Float8E5M2,
  Float8E4M3FN,
  X87DoubleExtended,
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
