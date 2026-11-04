// Port of src/tools/miri/src/shims/math.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-shims-b` (plan-m6 wave 37).
//
// PORT (host float ops, the src/rust_ts/host_libm.ts decision of lane miri-eval-fix): every `f_host.<op>()` here is a
// call into the host C math library in the Miri binary. Established from the pinned Miri binary (`nm -u` of
// `$RUST_TS_DATA/rustup-miri/toolchains/nightly-2026-10-11-aarch64-apple-darwin/bin/miri`) and std at the pin
// (library/std/src/num/f{32,64}.rs: `cmath::coshf(self)` & co.; `cbrt` / `abs_sub` are core's `libm::cbrtf` /
// `libm::fdimf` externs; `acosh` / `asinh` are `cmath::acosh{,f}` at this pin): the 38 imports `cbrt{,f} cosh{,f}
// sinh{,f} tan{,f} tanh{,f} acos{,f} asin{,f} atan{,f} acosh{,f} asinh{,f} log1p{,f} expm1{,f} tgamma{,f} erf{,f}
// erfc{,f} hypot{,f} atan2{,f} fdim{,f} lgamma_r lgammaf_r`. src/rust_ts/host_libm.ts opens them with bun:ffi.
import { type MPlaceTy, type OpTy, type Scalar } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { apply_random_float_error_ulp, clamp_float_value, fixed_float_value, ToHost_Double, ToHost_Single, ToSoft_f32, ToSoft_f64 } from "../math.ts";
import { type EmulateItemResult } from "./mod.ts";
import { CanonAbi } from "../../rustc_abi/canon_abi.ts";
import { type InterpResult, interp_ok, Scalar as interp_Scalar, Scalar_from_Double, Scalar_from_Single } from "../../rustc_middle/mir/interpret/mod.ts";
import { type FnAbi } from "../../rustc_middle/ty/decls.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { host_libm, host_libm_lgamma } from "../../rust_ts/host_libm.ts";
import { Double, Single } from "../../vendor/rustc_apfloat/ieee.ts";
import { ptr } from "bun:ffi";

/** `fN::ln_gamma` (std: `let x = cmath::lgamma{f}_r(self, &mut signgamp); (x, signgamp)`). */
function ln_gamma(f: "lgamma_r" | "lgammaf_r", x: number): [number, number] {
  const signgamp = new Int32Array(1);
  const r = host_libm_lgamma()[f](x, ptr(signgamp));
  return [r, signgamp[0]!];
}

// rustc: src/tools/miri/src/shims/math.rs:12 emulate_foreign_item_inner
// PORT: decision C9, a module fn taking `this_` (the trait is called by path).
export function emulate_foreign_item_inner(this_: MiriInterpCx, link_name: Symbol, abi: FnAbi<Ty>, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  const this__ = this_.eval_context_mut();
  const name = Symbol.as_str(link_name);

  // math functions (note that there are also intrinsics for some other functions)
  switch (name) {
    // math functions (note that there are also intrinsics for some other functions)
    case "cbrtf":
    case "coshf":
    case "sinhf":
    case "tanf":
    case "tanhf":
    case "acosf":
    case "asinf":
    case "atanf":
    case "acoshf":
    case "asinhf":
    case "log1pf":
    case "expm1f":
    case "tgammaf":
    case "erff":
    case "erfcf": {
      const a = this__.check_shim_sig_deprecated(abi, CanonAbi.C, link_name, args, 1);
      if (a.$ === "Err") return a;
      const [f] = a._0 as [OpTy];
      const s = this__.read_scalar(f);
      if (s.$ === "Err") return s;
      const f_r = interp_Scalar.to_f32(s._0);
      if (f_r.$ === "Err") return f_r;
      const f_ = f_r._0;

      let res =
        fixed_float_value(this__, name, [f_], Single) ??
        (() => {
          // Using host floats (but it's fine, these operations do not have
          // guaranteed precision).
          const f_host = ToHost_Single.to_host(f_);
          const m = host_libm();
          let res: number;
          switch (name) {
            case "cbrtf": res = m.cbrtf(f_host); break;
            case "coshf": res = m.coshf(f_host); break;
            case "sinhf": res = m.sinhf(f_host); break;
            case "tanf": res = m.tanf(f_host); break;
            case "tanhf": res = m.tanhf(f_host); break;
            case "acosf": res = m.acosf(f_host); break;
            case "asinf": res = m.asinf(f_host); break;
            case "atanf": res = m.atanf(f_host); break;
            case "acoshf": res = m.acoshf(f_host); break;
            case "asinhf": res = m.asinhf(f_host); break;
            case "log1pf": res = m.log1pf(f_host); break;
            case "expm1f": res = m.expm1f(f_host); break;
            case "tgammaf": res = m.tgammaf(f_host); break;
            case "erff": res = m.erff(f_host); break;
            case "erfcf": res = m.erfcf(f_host); break;
            default: return bug();
          }
          let res_ = ToSoft_f32.to_soft(res);
          // Apply a relative error of 4ULP to introduce some non-determinism
          // simulating imprecise implementations and optimizations.
          res_ = apply_random_float_error_ulp(this__, res_, 4);

          // Clamp the result to the guaranteed range of this function according to the C standard,
          // if any.
          return clamp_float_value(name, res_);
        })();
      res = this__.adjust_nan(res, [f_], Single);
      const w = this__.write_scalar(Scalar_from_Single(res) as Scalar, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "_hypotf":
    case "hypotf":
    case "atan2f":
    case "fdimf": {
      const a = this__.check_shim_sig_deprecated(abi, CanonAbi.C, link_name, args, 2);
      if (a.$ === "Err") return a;
      const [f1_, f2_] = a._0 as [OpTy, OpTy];
      const s1 = this__.read_scalar(f1_);
      if (s1.$ === "Err") return s1;
      const v1 = interp_Scalar.to_f32(s1._0);
      if (v1.$ === "Err") return v1;
      const s2 = this__.read_scalar(f2_);
      if (s2.$ === "Err") return s2;
      const v2 = interp_Scalar.to_f32(s2._0);
      if (v2.$ === "Err") return v2;
      const f1v = v1._0;
      const f2v = v2._0;

      let res =
        fixed_float_value(this__, name, [f1v, f2v], Single) ??
        (() => {
          const m = host_libm();
          let res: Single;
          switch (name) {
            // underscore case for windows, here and below
            // (see https://docs.microsoft.com/en-us/cpp/c-runtime-library/reference/floating-point-primitives?view=vs-2019)
            // Using host floats (but it's fine, these operations do not have guaranteed precision).
            case "_hypotf":
            case "hypotf":
              res = ToSoft_f32.to_soft(m.hypotf(ToHost_Single.to_host(f1v), ToHost_Single.to_host(f2v)));
              break;
            case "atan2f":
              res = ToSoft_f32.to_soft(m.atan2f(ToHost_Single.to_host(f1v), ToHost_Single.to_host(f2v)));
              break;
            // #[allow(deprecated)]
            case "fdimf":
              res = ToSoft_f32.to_soft(m.fdimf(ToHost_Single.to_host(f1v), ToHost_Single.to_host(f2v)));
              break;
            default:
              return bug();
          }
          // Apply a relative error of 4ULP to introduce some non-determinism
          // simulating imprecise implementations and optimizations.
          res = apply_random_float_error_ulp(this__, res, 4);

          // Clamp the result to the guaranteed range of this function according to the C standard,
          // if any.
          return clamp_float_value(name, res);
        })();
      res = this__.adjust_nan(res, [f1v, f2v], Single);
      const w = this__.write_scalar(Scalar_from_Single(res) as Scalar, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "cbrt":
    case "cosh":
    case "sinh":
    case "tan":
    case "tanh":
    case "acos":
    case "asin":
    case "atan":
    case "acosh":
    case "asinh":
    case "log1p":
    case "expm1":
    case "tgamma":
    case "erf":
    case "erfc": {
      const a = this__.check_shim_sig_deprecated(abi, CanonAbi.C, link_name, args, 1);
      if (a.$ === "Err") return a;
      const [f] = a._0 as [OpTy];
      const s = this__.read_scalar(f);
      if (s.$ === "Err") return s;
      const f_r = interp_Scalar.to_f64(s._0);
      if (f_r.$ === "Err") return f_r;
      const f_ = f_r._0;

      let res =
        fixed_float_value(this__, name, [f_], Double) ??
        (() => {
          // Using host floats (but it's fine, these operations do not have
          // guaranteed precision).
          const f_host = ToHost_Double.to_host(f_);
          const m = host_libm();
          let res: number;
          switch (name) {
            case "cbrt": res = m.cbrt(f_host); break;
            case "cosh": res = m.cosh(f_host); break;
            case "sinh": res = m.sinh(f_host); break;
            case "tan": res = m.tan(f_host); break;
            case "tanh": res = m.tanh(f_host); break;
            case "acos": res = m.acos(f_host); break;
            case "asin": res = m.asin(f_host); break;
            case "atan": res = m.atan(f_host); break;
            case "acosh": res = m.acosh(f_host); break;
            case "asinh": res = m.asinh(f_host); break;
            case "log1p": res = m.log1p(f_host); break;
            case "expm1": res = m.expm1(f_host); break;
            case "tgamma": res = m.tgamma(f_host); break;
            case "erf": res = m.erf(f_host); break;
            case "erfc": res = m.erfc(f_host); break;
            default: return bug();
          }
          let res_ = ToSoft_f64.to_soft(res);
          // Apply a relative error of 4ULP to introduce some non-determinism
          // simulating imprecise implementations and optimizations.
          res_ = apply_random_float_error_ulp(this__, res_, 4);

          // Clamp the result to the guaranteed range of this function according to the C standard,
          // if any.
          return clamp_float_value(name, res_);
        })();
      res = this__.adjust_nan(res, [f_], Double);
      const w = this__.write_scalar(Scalar_from_Double(res) as Scalar, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "_hypot":
    case "hypot":
    case "atan2":
    case "fdim": {
      const a = this__.check_shim_sig_deprecated(abi, CanonAbi.C, link_name, args, 2);
      if (a.$ === "Err") return a;
      const [f1_, f2_] = a._0 as [OpTy, OpTy];
      const s1 = this__.read_scalar(f1_);
      if (s1.$ === "Err") return s1;
      const v1 = interp_Scalar.to_f64(s1._0);
      if (v1.$ === "Err") return v1;
      const s2 = this__.read_scalar(f2_);
      if (s2.$ === "Err") return s2;
      const v2 = interp_Scalar.to_f64(s2._0);
      if (v2.$ === "Err") return v2;
      const f1v = v1._0;
      const f2v = v2._0;

      let res =
        fixed_float_value(this__, name, [f1v, f2v], Double) ??
        (() => {
          const m = host_libm();
          let res: Double;
          switch (name) {
            // underscore case for windows, here and below
            // (see https://docs.microsoft.com/en-us/cpp/c-runtime-library/reference/floating-point-primitives?view=vs-2019)
            // Using host floats (but it's fine, these operations do not have guaranteed precision).
            case "_hypot":
            case "hypot":
              res = ToSoft_f64.to_soft(m.hypot(ToHost_Double.to_host(f1v), ToHost_Double.to_host(f2v)));
              break;
            case "atan2":
              res = ToSoft_f64.to_soft(m.atan2(ToHost_Double.to_host(f1v), ToHost_Double.to_host(f2v)));
              break;
            // #[allow(deprecated)]
            case "fdim":
              res = ToSoft_f64.to_soft(m.fdim(ToHost_Double.to_host(f1v), ToHost_Double.to_host(f2v)));
              break;
            default:
              return bug();
          }
          // Apply a relative error of 4ULP to introduce some non-determinism
          // simulating imprecise implementations and optimizations.
          res = apply_random_float_error_ulp(this__, res, 4);

          // Clamp the result to the guaranteed range of this function according to the C standard,
          // if any.
          return clamp_float_value(name, res);
        })();
      res = this__.adjust_nan(res, [f1v, f2v], Double);
      const w = this__.write_scalar(Scalar_from_Double(res) as Scalar, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "_ldexp":
    case "ldexp":
    case "scalbn": {
      const a = this__.check_shim_sig_deprecated(abi, CanonAbi.C, link_name, args, 2);
      if (a.$ === "Err") return a;
      const [x, exp] = a._0 as [OpTy, OpTy];
      // For radix-2 (binary) systems, `ldexp` and `scalbn` are the same.
      const xs = this__.read_scalar(x);
      if (xs.$ === "Err") return xs;
      const x_ = interp_Scalar.to_f64(xs._0);
      if (x_.$ === "Err") return x_;
      const es = this__.read_scalar(exp);
      if (es.$ === "Err") return es;
      const exp_ = interp_Scalar.to_i32(es._0);
      if (exp_.$ === "Err") return exp_;

      let res = x_._0.scalbn(exp_._0);
      res = this__.adjust_nan(res, [x_._0], Double);
      const w = this__.write_scalar(Scalar_from_Double(res) as Scalar, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "lgammaf_r": {
      const a = this__.check_shim_sig_deprecated(abi, CanonAbi.C, link_name, args, 2);
      if (a.$ === "Err") return a;
      const [x, signp] = a._0 as [OpTy, OpTy];
      const xs = this__.read_scalar(x);
      if (xs.$ === "Err") return xs;
      const x_ = interp_Scalar.to_f32(xs._0);
      if (x_.$ === "Err") return x_;
      const signp_ = this__.deref_pointer_as(signp, this__.machine.layouts.i32);
      if (signp_.$ === "Err") return signp_;

      // Using host floats (but it's fine, these operations do not have guaranteed precision).
      const [res_host, sign] = ln_gamma("lgammaf_r", ToHost_Single.to_host(x_._0));
      const ws = this__.write_int(BigInt(sign), signp_._0);
      if (ws.$ === "Err") return ws;

      let res = ToSoft_f32.to_soft(res_host);
      // Apply a relative error of 4ULP to introduce some non-determinism
      // simulating imprecise implementations and optimizations.
      res = apply_random_float_error_ulp(this__, res, 4);
      // Clamp the result to the guaranteed range of this function according to the C standard,
      // if any.
      res = clamp_float_value(name, res);
      res = this__.adjust_nan(res, [x_._0], Single);
      const w = this__.write_scalar(Scalar_from_Single(res) as Scalar, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "lgamma_r": {
      const a = this__.check_shim_sig_deprecated(abi, CanonAbi.C, link_name, args, 2);
      if (a.$ === "Err") return a;
      const [x, signp] = a._0 as [OpTy, OpTy];
      const xs = this__.read_scalar(x);
      if (xs.$ === "Err") return xs;
      const x_ = interp_Scalar.to_f64(xs._0);
      if (x_.$ === "Err") return x_;
      const signp_ = this__.deref_pointer_as(signp, this__.machine.layouts.i32);
      if (signp_.$ === "Err") return signp_;

      // Using host floats (but it's fine, these operations do not have guaranteed precision).
      const [res_host, sign] = ln_gamma("lgamma_r", ToHost_Double.to_host(x_._0));
      const ws = this__.write_int(BigInt(sign), signp_._0);
      if (ws.$ === "Err") return ws;

      let res = ToSoft_f64.to_soft(res_host);
      // Apply a relative error of 4ULP to introduce some non-determinism
      // simulating imprecise implementations and optimizations.
      res = apply_random_float_error_ulp(this__, res, 4);
      // Clamp the result to the guaranteed range of this function according to the C standard,
      // if any.
      res = clamp_float_value(name, res);
      res = this__.adjust_nan(res, [x_._0], Double);
      const w = this__.write_scalar(Scalar_from_Double(res) as Scalar, dest);
      if (w.$ === "Err") return w;
      break;
    }

    default:
      return interp_ok("NotSupported");
  }

  return interp_ok("NeedsReturn");
}
