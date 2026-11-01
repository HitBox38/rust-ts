// Fill lane: `miri-eval` (plan-m6 wave 36): ported by this lane.
// Port of src/tools/miri/src/math.rs (crate `miri`, plan-m6 D2; lane miri-eval, wave 36). Its types are generated into
// math.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT:
// - Generic `F: Float` fns take their `FloatType` dictionary from a value (`val.Self()`) where they have one, else as a
//   trailing `F_` parameter (the interpreter's convention, interpret/eval_context.ts header): `fixed_float_value`,
//   `sqrt_op`, `host_unary_float_op`. `IeeeFloat<S>` with `S: Semantics` is `IeeeFloat<S>` / its dictionary.
// - `ToHost` / `ToSoft` / `HostFloatOperation` / `IeeeExt` are impl tables (`ToHost_Double`, ...). A host `f64` is a JS
//   number; a host `f32` / `f16` is a JS number holding a value exactly representable in that format.
// - Host float operations (`HostFloatOperation`, "do not have guaranteed precision", host_unary_float_op): `f64` uses
//   the JS `Math` functions, which Bun (JavaScriptCore) computes with the host libm like Rust's `f64::sin` & co.; there
//   is no `exp2` in JS, so `exp2(x)` is `2 ** x` (libm `pow`). `f32` has no JS operation: it is the `f64` operation
//   rounded to `f32` (`Math.fround`), where Rust calls the `f32` libm entry (`sinf`, ...); `f16` is LLVM's lowering on
//   targets without `f16` libcalls (promote to `f32`, round back). These may differ from the oracle's libm in the last
//   bit for some inputs (recorded in docs/handoff/miri-eval.md). `powi` is compiler-rt's `__powidf2` / `__powisf2`
//   (repeated multiplication, ported exactly).
import { type ImmTy, type OpTy, type PlaceTy, type Scalar } from "./lib.ts";
import { type MiriInterpCx } from "./machine.ts";
import { type HostUnaryFloatOp } from "./math.gen.ts";
import { MiriImmTy } from "./operator.ts";
import { type InterpResult, interp_ok, Scalar as interp_Scalar, Scalar_from_Double, Scalar_from_Half, Scalar_from_Quad, Scalar_from_Single } from "../rustc_middle/mir/interpret/mod.ts";
import { ScalarInt } from "../rustc_middle/ty/consts/int.ts";
import { bug } from "../rustc_span/macros.ts";
import { panic } from "../std/panic.ts";
import { StandardUniform_bool } from "../vendor/rand/distr/other.ts";
import { Range, RangeInclusive } from "../vendor/rand/distr/uniform.ts";
import { SampleUniform_i64, SampleUniform_u128 } from "../vendor/rand/distr/uniform_int.ts";
import { RngExt } from "../vendor/rand/rng.ts";
import { Double, Half, type IeeeFloat, Quad, type Semantics, Single } from "../vendor/rustc_apfloat/ieee.ts";
import { type Float, type FloatType } from "../vendor/rustc_apfloat/lib.ts";
export * from "./math.gen.ts";


// ---- host <-> bits ----
const f64_buf = new DataView(new ArrayBuffer(8));
function f64_from_bits(bits: bigint): number {
  f64_buf.setBigUint64(0, bits);
  return f64_buf.getFloat64(0);
}
function f64_to_bits(f: number): bigint {
  f64_buf.setFloat64(0, f);
  return f64_buf.getBigUint64(0);
}
function f32_from_bits(bits: bigint): number {
  f64_buf.setUint32(0, Number(bits));
  return f64_buf.getFloat32(0);
}
function f32_to_bits(f: number): bigint {
  f64_buf.setFloat32(0, f);
  return BigInt(f64_buf.getUint32(0));
}

/// Convert a softfloat type to its corresponding hostfloat type.
export interface ToHost<Soft, Host> {
  // type HostFloat;
  // rustc: src/tools/miri/src/math.rs:13 to_host
  to_host(self: Soft): Host;
}

/// Convert a hostfloat type to its corresponding softfloat type.
export interface ToSoft<Host, Soft> {
  // type SoftFloat;
  // rustc: src/tools/miri/src/math.rs:19 to_soft
  to_soft(self: Host): Soft;
}

export const ToHost_Double: ToHost<Double, number> = {
  // type HostFloat = f64;

  // rustc: src/tools/miri/src/math.rs:25 to_host
  to_host(self: Double): number {
    return f64_from_bits(self.to_bits());
  },
};

export const ToSoft_f64: ToSoft<number, Double> = {
  // type SoftFloat = rustc_apfloat::ieee::Double;

  // rustc: src/tools/miri/src/math.rs:33 to_soft
  to_soft(self: number): Double {
    return Double.from_bits(f64_to_bits(self));
  },
};

export const ToHost_Single: ToHost<Single, number> = {
  // type HostFloat = f32;

  // rustc: src/tools/miri/src/math.rs:41 to_host
  to_host(self: Single): number {
    return f32_from_bits(self.to_bits());
  },
};

export const ToSoft_f32: ToSoft<number, Single> = {
  // type SoftFloat = rustc_apfloat::ieee::Single;

  // rustc: src/tools/miri/src/math.rs:49 to_soft
  to_soft(self: number): Single {
    return Single.from_bits(f32_to_bits(self));
  },
};

export const ToHost_Half: ToHost<Half, number> = {
  // type HostFloat = f16;

  // rustc: src/tools/miri/src/math.rs:57 to_host
  to_host(self: Half): number {
    // PORT: an `f16` host value is a JS number (header); the widening conversion is exact.
    return f64_from_bits(self.convert(Double, { value: false }).value.to_bits());
  },
};

export const ToSoft_f16: ToSoft<number, Half> = {
  // type SoftFloat = rustc_apfloat::ieee::Half;

  // rustc: src/tools/miri/src/math.rs:65 to_soft
  to_soft(self: number): Half {
    // PORT: `self` holds an `f16` value (header), so the narrowing conversion is exact.
    return Double.from_bits(f64_to_bits(self)).convert(Half, { value: false }).value;
  },
};

/** `i32::strict_sub` */
function i32_strict_sub(a: number, b: number): number {
  const r = a - b;
  if (r < -0x8000_0000 || r > 0x7fff_ffff) panic("attempt to subtract with overflow");
  return r;
}

/// Disturbes a floating-point result by a relative error in the range (-2^scale, 2^scale).
// rustc: src/tools/miri/src/math.rs:71 apply_random_float_error
export function apply_random_float_error<F extends Float<F>>(ecx: MiriInterpCx, val: F, err_scale: number): F {
  const F_ = val.Self();
  if (
    !ecx.machine.float_nondet ||
    ecx.machine.float_rounding_error === "None" ||
    // relative errors don't do anything to zeros... avoid messing up the sign
    val.is_zero() ||
    // The logic below makes no sense if the input is already non-finite.
    !val.is_finite()
  ) {
    return val;
  }
  const rng = ecx.machine.rng;

  // Generate a random integer in the range [0, 2^PREC).
  // (When read as binary, the position of the first `1` determines the exponent,
  // and the remaining bits fill the mantissa. `PREC` is one plus the size of the mantissa,
  // so this all works out.)
  let r_int: bigint;
  switch (ecx.machine.float_rounding_error) {
    case "Random":
      r_int = RngExt.random_range(rng, new Range(SampleUniform_u128, 0n, 1n << BigInt(F_.PRECISION)));
      break;
    case "Max":
      r_int = (1n << BigInt(F_.PRECISION)) - 1n; // force max error
      break;
    default:
      // FloatRoundingErrorMode::None (excluded above)
      return panic("internal error: entered unreachable code");
  }
  const r = F_.from_u128(r_int).value;
  // Multiply this with 2^(scale - PREC). The result is between 0 and
  // 2^PREC * 2^(scale - PREC) = 2^scale.
  let err = r.scalbn(i32_strict_sub(err_scale, F_.PRECISION));
  // give it a random sign
  err = RngExt.random(rng, StandardUniform_bool) ? err.neg() : err;
  // Compute `val*(1+err)`, distributed out as `val + val*err` to avoid the imprecise addition
  // error being amplified by multiplication.
  return val.add(val.mul(err).value).value;
}

/// Applies an error of `[-N, +N]` ULP to the given value.
// rustc: src/tools/miri/src/math.rs:108 apply_random_float_error_ulp
export function apply_random_float_error_ulp<F extends Float<F>>(ecx: MiriInterpCx, val: F, max_error: number): F {
  const F_ = val.Self();
  // We could try to be clever and reuse `apply_random_float_error`, but that is hard to get right
  // (see <https://github.com/rust-lang/miri/pull/4558#discussion_r2316838085> for why) so we
  // implement the logic directly instead.
  if (
    !ecx.machine.float_nondet ||
    ecx.machine.float_rounding_error === "None" ||
    // FIXME: also disturb zeros? That requires a lot more cases in `fixed_float_value`
    // and might make the std test suite quite unhappy.
    val.is_zero() ||
    // The logic below makes no sense if the input is already non-finite.
    !val.is_finite()
  ) {
    return val;
  }
  const rng = ecx.machine.rng;

  const max_error_ = BigInt(max_error);
  let error: bigint;
  switch (ecx.machine.float_rounding_error) {
    case "Random":
      error = RngExt.random_range(rng, new RangeInclusive(SampleUniform_i64, -max_error_, max_error_));
      break;
    case "Max":
      if (RngExt.random(rng, StandardUniform_bool)) {
        error = max_error_;
      } else {
        error = -max_error_;
      }
      break;
    default:
      // FloatRoundingErrorMode::None (excluded above)
      return panic("internal error: entered unreachable code");
  }
  // If upwards ULP and downwards ULP differ, we take the average.
  const ulp = val.next_up().value.sub(val).value.add(val.sub(val.next_down().value).value).value.div(F_.from_u128(2n).value).value;
  // Shift the value by N times the ULP
  return val.add(ulp.mul(F_.from_i128(error).value).value).value;
}

/// Applies an error of `[-N, +N]` ULP to the given value.
/// Will fail if `val` is not a floating point number.
// rustc: src/tools/miri/src/math.rs:149 apply_random_float_error_to_imm
export function apply_random_float_error_to_imm(ecx: MiriInterpCx, val: ImmTy, max_error: number): InterpResult<ImmTy> {
  const scalar_r = val.to_scalar_int();
  if (scalar_r.$ === "Err") return scalar_r;
  const scalar = scalar_r._0;
  const kind = val.layout.ty.kind();
  let res: ScalarInt;
  if (kind.$ === "Float" && kind._0 === "F16") {
    res = ScalarInt.from_Half(apply_random_float_error_ulp(ecx, scalar.to_f16(), max_error));
  } else if (kind.$ === "Float" && kind._0 === "F32") {
    res = ScalarInt.from_Single(apply_random_float_error_ulp(ecx, scalar.to_f32(), max_error));
  } else if (kind.$ === "Float" && kind._0 === "F64") {
    res = ScalarInt.from_Double(apply_random_float_error_ulp(ecx, scalar.to_f64(), max_error));
  } else if (kind.$ === "Float" && kind._0 === "F128") {
    res = ScalarInt.from_Quad(apply_random_float_error_ulp(ecx, scalar.to_f128(), max_error));
  } else {
    return bug("intrinsic called with non-float input type");
  }

  return interp_ok(MiriImmTy.from_scalar_int(res, val.layout));
}

/** `str::strip_suffix` */
function strip_suffix(s: string, suffix: string): string | undefined {
  return s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : undefined;
}

/// Remove `f16`/`f32`/`f64`/`f128` suffix, if any.
///
/// Also strip trailing `f` (indicates "float"), with an exception for "erf" to avoid
/// removing that `f`.
// rustc: src/tools/miri/src/math.rs:174 strip_float_suffix
export function strip_float_suffix(intrinsic_name: string): string {
  const name =
    strip_suffix(intrinsic_name, "f16") ??
    strip_suffix(intrinsic_name, "f32") ??
    strip_suffix(intrinsic_name, "f64") ??
    strip_suffix(intrinsic_name, "f128") ??
    intrinsic_name;

  if (name === "erf") {
    return name;
  } else {
    return strip_suffix(name, "f") ?? name;
  }
}

/// Given a floating-point operation and a floating-point value, clamps the result to the output
/// range of the given operation according to the C standard, if any.
// rustc: src/tools/miri/src/math.rs:187 clamp_float_value
export function clamp_float_value<S extends Semantics>(intrinsic_name: string, val: IeeeFloat<S>): IeeeFloat<S> {
  const F_ = val.Self();
  const zero = F_.ZERO;
  const one = IeeeExt.one(F_);
  const two = IeeeExt.two(F_);
  const pi = IeeeExt_of(F_).pi();
  const pi_over_2 = pi.div(two).value;

  switch (strip_float_suffix(intrinsic_name)) {
    // sin, cos, tanh: [-1, 1]
    case "sin":
    case "cos":
    case "tanh":
      return IeeeExt.clamp(val, one.neg(), one);

    // exp: [0, +INF)
    case "exp":
    case "exp2":
      return val.maximum(zero);

    // cosh: [1, +INF)
    case "cosh":
      return val.maximum(one);

    // acos: [0, π]
    case "acos":
      return IeeeExt.clamp(val, zero, pi);

    // asin: [-π, +π]
    case "asin":
      return IeeeExt.clamp(val, pi.neg(), pi);

    // atan: (-π/2, +π/2)
    case "atan":
      return IeeeExt.clamp(val, pi_over_2.neg(), pi_over_2);

    // erfc: (-1, 1)
    case "erf":
      return IeeeExt.clamp(val, one.neg(), one);

    // erfc: (0, 2)
    case "erfc":
      return IeeeExt.clamp(val, zero, two);

    // atan2(y, x): arctan(y/x) in [−π, +π]
    case "atan2":
      return IeeeExt.clamp(val, pi.neg(), pi);

    default:
      return val;
  }
}

/// For the intrinsics:
/// - sin, sinhf, sinh
/// - cos, coshf, cosh
/// - tanhf, tanh, atanf, atan, atan2f, atan2
/// - exp, exp2
/// - log, log2, log10
/// - powf32, powf64
/// - erff, erf, erfcf, erfc
/// - hypotf, hypot
///
/// # Return
///
/// Returns `Some(output)` if the `intrinsic` results in a defined fixed `output` specified in the C standard
/// (specifically, C23 annex F.10)  when given `args` as arguments. Outputs that are unaffected by a relative error
/// (such as INF and zero) are not handled here, they are assumed to be handled by the underlying
/// implementation. Returns `None` if no specific value is guaranteed.
///
/// # Note
///
/// For `powf*` operations of the form:
///
/// - `(SNaN)^(±0)`
/// - `1^(SNaN)`
///
/// The result is implementation-defined:
/// - musl returns for both `1.0`
/// - glibc returns for both `NaN`
///
/// This discrepancy exists because SNaN handling is not consistently defined across platforms,
/// and the C standard leaves behavior for SNaNs unspecified.
///
/// Miri chooses to adhere to both implementations and returns either one of them non-deterministically.
// rustc: src/tools/miri/src/math.rs:264 fixed_float_value
export function fixed_float_value<S extends Semantics>(
  ecx: MiriInterpCx,
  intrinsic_name: string,
  args: readonly IeeeFloat<S>[],
  F_: FloatType<IeeeFloat<S>>,
): IeeeFloat<S> | undefined {
  const this_ = ecx.eval_context_mut();
  const one = IeeeExt.one(F_);
  const two = IeeeExt.two(F_);
  const three = IeeeExt.three(F_);
  const pi = IeeeExt_of(F_).pi();
  const pi_over_2 = pi.div(two).value;
  const pi_over_4 = pi_over_2.div(two).value;

  const name = strip_float_suffix(intrinsic_name);
  // PORT: the `match (name, args)` arms, in order; `[input]` / `[x, y]` are length checks.
  if (args.length === 1) {
    const input = args[0]!;
    // cos(±0) and cosh(±0)= 1
    if ((name === "cos" || name === "cosh") && input.is_zero()) return one;

    // e^0 = 1
    if ((name === "exp" || name === "exp2") && input.is_zero()) return one;

    // tanh(±INF) = ±1
    if (name === "tanh" && input.is_infinite()) return one.copy_sign(input);

    // atan(±INF) = ±π/2
    if (name === "atan" && input.is_infinite()) return pi_over_2.copy_sign(input);

    // erf(±INF) = ±1
    if (name === "erf" && input.is_infinite()) return one.copy_sign(input);

    // erfc(-INF) = 2
    if (name === "erfc" && input.is_neg_infinity()) return one.add(one).value;
  }
  if (args.length === 2) {
    const x = args[0]!;
    const y = args[1]!;
    // hypot(x, ±0) = abs(x), if x is not a NaN.
    // `_hypot` is the Windows name for this.
    if ((name === "_hypot" || name === "hypot") && !x.is_nan() && y.is_zero()) return x.abs();

    // atan2(±0,−0) = ±π.
    // atan2(±0, y) = ±π for y < 0.
    // Must check for non NaN because `y.is_negative()` also applies to NaN.
    if (name === "atan2" && x.is_zero() && y.is_negative() && !y.is_nan()) return pi.copy_sign(x);

    // atan2(±x,−∞) = ±π for finite x > 0.
    if (name === "atan2" && !x.is_zero() && !x.is_infinite() && y.is_neg_infinity()) return pi.copy_sign(x);

    // atan2(x, ±0) = −π/2 for x < 0.
    // atan2(x, ±0) =  π/2 for x > 0.
    if (name === "atan2" && !x.is_zero() && y.is_zero()) return pi_over_2.copy_sign(x);

    //atan2(±∞, −∞) = ±3π/4
    if (name === "atan2" && x.is_infinite() && y.is_neg_infinity()) return pi_over_4.mul(three).value.copy_sign(x);

    //atan2(±∞, +∞) = ±π/4
    if (name === "atan2" && x.is_infinite() && y.is_pos_infinity()) return pi_over_4.copy_sign(x);

    // atan2(±∞, y) returns ±π/2 for finite y.
    if (name === "atan2" && x.is_infinite() && !y.is_infinite() && !y.is_nan()) return pi_over_2.copy_sign(x);

    const base = x;
    const exp = y;
    // (-1)^(±INF) = 1
    if (name === "pow" && base.eq(one.neg()) && exp.is_infinite()) return one;

    // 1^y = 1 for any y, even a NaN
    if (name === "pow" && base.eq(one)) {
      const rng = this_.machine.rng;
      // SNaN exponents get special treatment: they might return 1, or a NaN.
      // This is non-deterministic because LLVM can treat SNaN as QNaN, and because
      // implementation behavior differs between glibc and musl.
      const return_nan = exp.is_signaling() && this_.machine.float_nondet && RngExt.random(rng, StandardUniform_bool);
      if (return_nan) {
        return this_.generate_nan(args, F_);
      } else {
        return one;
      }
    }

    // x^(±0) = 1 for any x, even a NaN
    if (name === "pow" && exp.is_zero()) {
      const rng = this_.machine.rng;
      // SNaN bases get special treatment: they might return 1, or a NaN.
      // This is non-deterministic because LLVM can treat SNaN as QNaN, and because
      // implementation behavior differs between glibc and musl.
      const return_nan = base.is_signaling() && this_.machine.float_nondet && RngExt.random(rng, StandardUniform_bool);
      if (return_nan) {
        return this_.generate_nan(args, F_);
      } else {
        return one;
      }
    }
  }

  // There are a lot of cases for fixed outputs according to the C Standard, but these are
  // mainly INF or zero which are not affected by the applied error.
  return undefined;
}

/// Returns `Some(output)` if `powi` (called `pown` in C) results in a fixed value specified in the
/// C standard (specifically, C23 annex F.10.4.6) when doing `base^exp`. Otherwise, returns `None`.
// rustc: src/tools/miri/src/math.rs:358 fixed_powi_value
export function fixed_powi_value<S extends Semantics>(ecx: MiriInterpCx, base: IeeeFloat<S>, exp: number): IeeeFloat<S> | undefined {
  const F_ = base.Self();
  switch (exp) {
    case 0: {
      const one = IeeeExt.one(F_);
      const rng = ecx.machine.rng;
      // SNaN bases get special treatment: they might return 1, or a NaN.
      // This is non-deterministic because LLVM can treat SNaN as QNaN.
      const return_nan = base.is_signaling() && ecx.machine.float_nondet && RngExt.random(rng, StandardUniform_bool);
      return return_nan ? ecx.generate_nan([base], F_) : one;
    }

    default:
      return undefined;
  }
}

// rustc: src/tools/miri/src/math.rs:380 sqrt
export function sqrt<F extends Float<F>>(x: F): F {
  const F_ = x.Self();
  const category = x.category();
  // preserve zero sign
  if (category === "Zero") return x;
  // propagate NaN
  if (category === "NaN") return x;
  // sqrt of negative number is NaN
  if (x.is_negative()) return F_.NAN;
  // sqrt(∞) = ∞
  if (category === "Infinity") return F_.INFINITY;
  // category === "Normal"
  {
    // Floating point precision, excluding the integer bit
    const prec = F_.PRECISION - 1;

    // x = 2^(exp - prec) * mant
    // where mant is an integer with prec+1 bits
    // mant is a u128, which should be large enough for the largest prec (112 for f128)
    let exp = x.ilogb();
    let mant = x.scalbn(prec - exp).to_u128(128).value;

    if (exp % 2 !== 0) {
      // Make exponent even, so it can be divided by 2
      exp -= 1;
      mant = (mant << 1n) & U128_MASK;
    }

    // Bit-by-bit (base-2 digit-by-digit) sqrt of mant.
    // mant is treated here as a fixed point number with prec fractional bits.
    // mant will be shifted left by one bit to have an extra fractional bit, which
    // will be used to determine the rounding direction.

    // res is the truncated sqrt of mant, where one bit is added at each iteration.
    let res = 0n;
    // rem is the remainder with the current res
    // rem_i = 2^i * ((mant<<1) - res_i^2)
    // starting with res = 0, rem = mant<<1
    let rem = (mant << 1n) & U128_MASK;
    // s_i = 2*res_i
    let s = 0n;
    // d is used to iterate over bits, from high to low (d_i = 2^(-i))
    let d = 1n << BigInt(prec + 1);

    // For iteration j=i+1, we need to find largest b_j = 0 or 1 such that
    //  (res_i + b_j * 2^(-j))^2 <= mant<<1
    // Expanding (a + b)^2 = a^2 + b^2 + 2*a*b:
    //  res_i^2 + (b_j * 2^(-j))^2 + 2 * res_i * b_j * 2^(-j) <= mant<<1
    // And rearranging the terms:
    //  b_j^2 * 2^(-j) + 2 * res_i * b_j <= 2^j * (mant<<1 - res_i^2)
    //  b_j^2 * 2^(-j) + 2 * res_i * b_j <= rem_i

    while (d !== 0n) {
      // Probe b_j^2 * 2^(-j) + 2 * res_i * b_j <= rem_i with b_j = 1:
      // t = 2*res_i + 2^(-j)
      const t = s + d;
      if (rem >= t) {
        // b_j should be 1, so make res_j = res_i + 2^(-j) and adjust rem
        res += d;
        s += d + d;
        rem -= t;
      }
      // Adjust rem for next iteration
      rem = (rem << 1n) & U128_MASK;
      // Shift iterator
      d >>= 1n;
    }

    // Remove extra fractional bit from result, rounding to nearest.
    // If the last bit is 0, then the nearest neighbor is definitely the lower one.
    // If the last bit is 1, it sounds like this may either be a tie (if there's
    // infinitely many 0s after this 1), or the nearest neighbor is the upper one.
    // However, since square roots are either exact or irrational, and an exact root
    // would lead to the last "extra" bit being 0, we can exclude a tie in this case.
    // We therefore always round up if the last bit is 1. When the last bit is 0,
    // adding 1 will not do anything since the shift will discard it.
    res = (res + 1n) >> 1n;

    // Build resulting value with res as mantissa and exp/2 as exponent
    return F_.from_u128(res).value.scalbn(Math.trunc(exp / 2) - prec);
  }
}
/** `u128` wrapping of `<<` (the shifted values stay below 2^115 for f128; kept for the `u128` semantics). */
const U128_MASK = (1n << 128n) - 1n;

/** `<F as Into<Scalar>>::into` for the four IEEE types (dispatched on the `FloatType` dictionary). */
function F_into_Scalar<F extends Float<F>>(f: F, F_: FloatType<F>): Scalar {
  const T = F_ as unknown;
  if (T === Half) return Scalar_from_Half(f as unknown as Half);
  if (T === Single) return Scalar_from_Single(f as unknown as Single);
  if (T === Double) return Scalar_from_Double(f as unknown as Double);
  if (T === Quad) return Scalar_from_Quad(f as never);
  return bug("`Into<Scalar>` on a float type other than Half / Single / Double / Quad");
}

// rustc: src/tools/miri/src/math.rs:462 sqrt_op
export function sqrt_op<F extends Float<F>>(this_: MiriInterpCx, f: OpTy, dest: PlaceTy, F_: FloatType<F>): InterpResult {
  const s = this_.read_scalar(f);
  if (s.$ === "Err") return s;
  const f_r = interp_Scalar.to_float(s._0, F_);
  if (f_r.$ === "Err") return f_r;
  const f_ = f_r._0;
  // Sqrt is specified to be fully precise.
  let res = sqrt(f_);
  res = this_.adjust_nan(res, [f_], F_);
  return this_.write_scalar(F_into_Scalar(res, F_), dest);
}

export interface HostFloatOperation<Self> {
  // rustc: src/tools/miri/src/math.rs:475 host_sin
  host_sin(self: Self): Self;
  // rustc: src/tools/miri/src/math.rs:476 host_cos
  host_cos(self: Self): Self;
  // rustc: src/tools/miri/src/math.rs:477 host_exp
  host_exp(self: Self): Self;
  // rustc: src/tools/miri/src/math.rs:478 host_exp2
  host_exp2(self: Self): Self;
  // rustc: src/tools/miri/src/math.rs:479 host_log
  host_log(self: Self): Self;
  // rustc: src/tools/miri/src/math.rs:480 host_log10
  host_log10(self: Self): Self;
  // rustc: src/tools/miri/src/math.rs:481 host_log2
  host_log2(self: Self): Self;
  // rustc: src/tools/miri/src/math.rs:482 host_powf
  host_powf(self: Self, y: Self): Self;
  // rustc: src/tools/miri/src/math.rs:483 host_powi
  host_powi(self: Self, y: number): Self;
}

/**
 * PORT: the host float type's operations (`f64::sin`, ...; module header). `round` rounds a JS number to the host type
 * (`f64`: identity, `f32`: `Math.fround`, `f16`: via `f32`).
 */
interface HostOps {
  round(x: number): number;
  /** compiler-rt `__powidf2` / `__powisf2` (`llvm.powi`). */
  powi(a: number, b: number): number;
}
/** compiler-rt `__powi{d,s}f2` (lib/builtins/powidf2.c): `r *= a` / `a *= a` in the host type. */
function compiler_rt_powi(round: (x: number) => number, a: number, b: number): number {
  const recip = b < 0;
  let r = 1;
  for (;;) {
    if (b & 1) r = round(r * a);
    b = (b / 2) | 0;
    if (b === 0) break;
    a = round(a * a);
  }
  return recip ? round(1 / r) : r;
}
const HOST_F64: HostOps = { round: (x) => x, powi: (a, b) => compiler_rt_powi((x) => x, a, b) };
const HOST_F32: HostOps = { round: Math.fround, powi: (a, b) => compiler_rt_powi(Math.fround, a, b) };
/** `f16`: LLVM promotes `f16` libm calls to `f32` and rounds back (`ToSoft_f16` does the `f16` rounding). */
const HOST_F16: HostOps = HOST_F32;

// macro_rules! impl_float_host_operations: `impl HostFloatOperation for $ty` (expanded once per type below).
function impl_float_host_operations<T>(ToHost_T: ToHost<T, number>, ToSoft_T: ToSoft<number, T>, host: HostOps): HostFloatOperation<T> {
  const to_host = ToHost_T.to_host;
  const to_soft = (x: number): T => ToSoft_T.to_soft(host.round(x));
  return {
    // rustc: src/tools/miri/src/math.rs:489 host_sin
    host_sin(self: T): T {
      return to_soft(Math.sin(to_host(self)));
    },
    // rustc: src/tools/miri/src/math.rs:492 host_cos
    host_cos(self: T): T {
      return to_soft(Math.cos(to_host(self)));
    },
    // rustc: src/tools/miri/src/math.rs:495 host_exp
    host_exp(self: T): T {
      return to_soft(Math.exp(to_host(self)));
    },
    // rustc: src/tools/miri/src/math.rs:498 host_exp2
    host_exp2(self: T): T {
      return to_soft(2 ** to_host(self));
    },
    // rustc: src/tools/miri/src/math.rs:501 host_log
    host_log(self: T): T {
      return to_soft(Math.log(to_host(self)));
    },
    // rustc: src/tools/miri/src/math.rs:504 host_log10
    host_log10(self: T): T {
      return to_soft(Math.log10(to_host(self)));
    },
    // rustc: src/tools/miri/src/math.rs:507 host_log2
    host_log2(self: T): T {
      return to_soft(Math.log2(to_host(self)));
    },
    // rustc: src/tools/miri/src/math.rs:510 host_powf
    host_powf(self: T, y: T): T {
      return to_soft(Math.pow(to_host(self), to_host(y)));
    },
    // rustc: src/tools/miri/src/math.rs:513 host_powi
    host_powi(self: T, y: number): T {
      return to_soft(host.powi(to_host(self), y));
    },
  };
}

export const HostFloatOperation_Half: HostFloatOperation<Half> = impl_float_host_operations(ToHost_Half, ToSoft_f16, HOST_F16);
export const HostFloatOperation_Single: HostFloatOperation<Single> = impl_float_host_operations(ToHost_Single, ToSoft_f32, HOST_F32);
export const HostFloatOperation_Double: HostFloatOperation<Double> = impl_float_host_operations(ToHost_Double, ToSoft_f64, HOST_F64);

/** PORT: the `HostFloatOperation` impl of `IeeeFloat<S>` (`impl_float_host_operations!` instances: Half, Single, Double). */
function HostFloatOperation_of<S extends Semantics>(F_: FloatType<IeeeFloat<S>>): HostFloatOperation<IeeeFloat<S>> {
  const T = F_ as unknown;
  if (T === Half) return HostFloatOperation_Half as unknown as HostFloatOperation<IeeeFloat<S>>;
  if (T === Single) return HostFloatOperation_Single as unknown as HostFloatOperation<IeeeFloat<S>>;
  if (T === Double) return HostFloatOperation_Double as unknown as HostFloatOperation<IeeeFloat<S>>;
  return bug("`HostFloatOperation` on a float type other than Half / Single / Double");
}

// rustc: src/tools/miri/src/math.rs:535 host_unary_float_op
export function host_unary_float_op<S extends Semantics>(
  this_: MiriInterpCx,
  f: OpTy,
  op: HostUnaryFloatOp,
  dest: PlaceTy,
  F_: FloatType<IeeeFloat<S>>,
): InterpResult {
  // use HostFloatOperation;
  const ops = HostFloatOperation_of(F_);

  const s = this_.read_scalar(f);
  if (s.$ === "Err") return s;
  const f_r = interp_Scalar.to_float(s._0, F_);
  if (f_r.$ === "Err") return f_r;
  const f_: IeeeFloat<S> = f_r._0;

  // The fixed-value and clamping functions need the name as a string.
  let name: string;
  switch (op) {
    case "Sin":
      name = "sin";
      break;
    case "Cos":
      name = "cos";
      break;
    case "Exp":
      name = "exp";
      break;
    case "Exp2":
      name = "exp2";
      break;
    case "Log":
      name = "log";
      break;
    case "Log10":
      name = "log10";
      break;
    case "Log2":
      name = "log2";
      break;
  }
  let res =
    fixed_float_value(this_, name, [f_], F_) ??
    (() => {
      // Using host floats (but it's fine, these operations do not have
      // guaranteed precision).
      let res: IeeeFloat<S>;
      switch (op) {
        case "Sin":
          res = ops.host_sin(f_);
          break;
        case "Cos":
          res = ops.host_cos(f_);
          break;
        case "Exp":
          res = ops.host_exp(f_);
          break;
        case "Exp2":
          res = ops.host_exp2(f_);
          break;
        case "Log":
          res = ops.host_log(f_);
          break;
        case "Log10":
          res = ops.host_log10(f_);
          break;
        case "Log2":
          res = ops.host_log2(f_);
          break;
      }

      // Apply a relative error of 4ULP to introduce some non-determinism
      // simulating imprecise implementations and optimizations.
      res = apply_random_float_error_ulp(this_, res, 4);

      // Clamp the result to the guaranteed range of this function according to the C standard,
      // if any.
      return clamp_float_value(name, res);
    })();

  res = this_.adjust_nan(res, [f_], F_);
  const w = this_.write_scalar(F_into_Scalar(res, F_), dest);
  if (w.$ === "Err") return w;
  return interp_ok(undefined);
}

/// Extend functionality of `rustc_apfloat` softfloats for IEEE float types.
// PORT: the provided methods take the type's `FloatType` dictionary (static side) or the value (`clamp`); `pi` is the
// per-type impl (`IeeeExt_of(F_).pi()`).
export const IeeeExt = {
  // Some values we use:

  // #[inline]
  // rustc: src/tools/miri/src/math.rs:590 one
  one<F extends Float<F>>(Self: FloatType<F>): F {
    return Self.from_u128(1n).value;
  },

  // #[inline]
  // rustc: src/tools/miri/src/math.rs:595 two
  two<F extends Float<F>>(Self: FloatType<F>): F {
    return Self.from_u128(2n).value;
  },

  // #[inline]
  // rustc: src/tools/miri/src/math.rs:600 three
  three<F extends Float<F>>(Self: FloatType<F>): F {
    return Self.from_u128(3n).value;
  },

  // #[inline]
  // rustc: src/tools/miri/src/math.rs:607 clamp
  clamp<F extends Float<F>>(self: F, min: F, max: F): F {
    return self.maximum(min).minimum(max);
  },
};

/** The required method of `IeeeExt` for one type. */
export interface IeeeExt_required<F> {
  // rustc: src/tools/miri/src/math.rs:604 pi
  pi(): F;
}

// macro_rules! impl_ieee_pi: `impl IeeeExt for IeeeFloat<$semantic>` (expanded once per type below).
function impl_ieee_pi<F extends Float<F>>(Self: FloatType<F>, pi_bits: bigint): IeeeExt_required<F> {
  return {
    // #[inline]
    // rustc: src/tools/miri/src/math.rs:616 pi
    pi(): F {
      // We take the value from the standard library as the most reasonable source for an exact π here.
      return Self.from_bits(pi_bits);
    },
  };
}

// PORT: `core::{f16,f32,f64}::consts::PI.to_bits()` (the IEEE encodings of π rounded to nearest; math.test.ts checks
// them against `Math.PI`).
export const IeeeExt_Half: IeeeExt_required<Half> = impl_ieee_pi(Half, 0x4248n);
export const IeeeExt_Single: IeeeExt_required<Single> = impl_ieee_pi(Single, 0x40490fdbn);
export const IeeeExt_Double: IeeeExt_required<Double> = impl_ieee_pi(Double, 0x400921fb54442d18n);

/** PORT: the `IeeeExt` impl of `IeeeFloat<S>` (`impl_ieee_pi!` instances: Half, Single, Double). */
function IeeeExt_of<S extends Semantics>(F_: FloatType<IeeeFloat<S>>): IeeeExt_required<IeeeFloat<S>> {
  const T = F_ as unknown;
  if (T === Half) return IeeeExt_Half as unknown as IeeeExt_required<IeeeFloat<S>>;
  if (T === Single) return IeeeExt_Single as unknown as IeeeExt_required<IeeeFloat<S>>;
  if (T === Double) return IeeeExt_Double as unknown as IeeeExt_required<IeeeFloat<S>>;
  return bug("`IeeeExt` on a float type other than Half / Single / Double");
}
