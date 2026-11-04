// Fill lane: `miri-x86-a` (plan-m6 wave 38): ported by this lane.
// Port of src/tools/miri/src/intrinsics/x86/sse.rs (crate `miri`, plan-m6 D2).
//
// PORT:
// - `trait EvalContextExt` (impl for `MiriInterpCx`) is a `declare module` augmentation of `InterpCx` (decision C2).
// - The apfloat comparisons (`left < right`, ...) are `partial_cmp` tests (Rust's `PartialOrd` provided methods); `==` is
//   `IeeeFloat::eq`, `!=` its negation.
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult, interp_ok, Scalar as interp_Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { assert_eq, panic } from "../../../std/panic.ts";
import { Single } from "../../../vendor/rustc_apfloat/ieee.ts";
import { type Round } from "../../../vendor/rustc_apfloat/lib.ts";
import { type MPlaceTy, type OpTy } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { MiriImmTy } from "../../operator.ts";
import { EmulateItemResult } from "../../shims/mod.ts";
import { bin_op_simd_float_all, bin_op_simd_float_first, FloatBinOp, type FloatUnaryOp, unary_op_ps, unary_op_ss } from "./mod.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/x86/sse.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/x86/sse.rs:12
    emulate_x86_sse_intrinsic(this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult>;
  }
}

// rustc: src/tools/miri/src/intrinsics/x86/sse.rs:12 emulate_x86_sse_intrinsic
InterpCx.prototype.emulate_x86_sse_intrinsic = function (this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();
  const e = this_.expect_target_feature_for_intrinsic(link_name, "sse");
  if (e.$ === "Err") return e;
  // Prefix should have already been checked.
  const link_name_str = Symbol.as_str(link_name);
  if (!link_name_str.startsWith("llvm.x86.sse.")) return panic("called `Option::unwrap()` on a `None` value");
  const unprefixed_name = link_name_str.slice("llvm.x86.sse.".length);
  // All these intrinsics operate on 128-bit (f32x4) SIMD vectors unless stated otherwise.
  // Many intrinsic names are suffixed with "ps" (packed single) or "ss" (scalar single),
  // where single means single precision floating point (f32). "ps" means that the operation
  // is performed on each element of the vector, while "ss" means that the operation is
  // performed only on the first element, copying the remaining elements from the input
  // vector (for binary operations, from the left-hand side).
  switch (unprefixed_name) {
    // Used to implement _mm_{min,max}_ss functions.
    // Performs the operations on the first component of `left` and
    // `right` and copies the remaining components from `left`.
    case "min.ss":
    case "max.ss": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left, right] = c._0 as [OpTy, OpTy];

      let which: FloatBinOp;
      switch (unprefixed_name) {
        case "min.ss":
          which = FloatBinOp.Min;
          break;
        case "max.ss":
          which = FloatBinOp.Max;
          break;
      }

      const r = bin_op_simd_float_first(this_, which, left, right, dest, Single);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement _mm_min_ps and _mm_max_ps functions.
    // Note that the semantics are a bit different from Rust simd_min
    // and simd_max intrinsics regarding handling of NaN and -0.0: Rust
    // matches the IEEE min/max operations, while x86 has different
    // semantics.
    case "min.ps":
    case "max.ps": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left, right] = c._0 as [OpTy, OpTy];

      let which: FloatBinOp;
      switch (unprefixed_name) {
        case "min.ps":
          which = FloatBinOp.Min;
          break;
        case "max.ps":
          which = FloatBinOp.Max;
          break;
      }

      const r = bin_op_simd_float_all(this_, which, left, right, dest, Single);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement _mm_{rcp,rsqrt}_ss functions.
    // Performs the operations on the first component of `op` and
    // copies the remaining components from `op`.
    case "rcp.ss":
    case "rsqrt.ss": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 1);
      if (c.$ === "Err") return c;
      const [op] = c._0 as [OpTy];

      let which: FloatUnaryOp;
      switch (unprefixed_name) {
        case "rcp.ss":
          which = "Rcp";
          break;
        case "rsqrt.ss":
          which = "Rsqrt";
          break;
      }

      const r = unary_op_ss(this_, which, op, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement _mm_{sqrt,rcp,rsqrt}_ps functions.
    // Performs the operations on all components of `op`.
    case "rcp.ps":
    case "rsqrt.ps": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 1);
      if (c.$ === "Err") return c;
      const [op] = c._0 as [OpTy];

      let which: FloatUnaryOp;
      switch (unprefixed_name) {
        case "rcp.ps":
          which = "Rcp";
          break;
        case "rsqrt.ps":
          which = "Rsqrt";
          break;
      }

      const r = unary_op_ps(this_, which, op, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_cmp*_ss functions.
    // Performs a comparison operation on the first component of `left`
    // and `right`, returning 0 if false or `u32::MAX` if true. The remaining
    // components are copied from `left`.
    // _mm_cmp_ss is actually an AVX function where the operation is specified
    // by a const parameter.
    // _mm_cmp{eq,lt,le,gt,ge,neq,nlt,nle,ngt,nge,ord,unord}_ss are SSE functions
    // with hard-coded operations.
    case "cmp.ss": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (c.$ === "Err") return c;
      const [left, right, imm] = c._0 as [OpTy, OpTy, OpTy];

      const imm_s = this_.read_scalar(imm);
      if (imm_s.$ === "Err") return imm_s;
      const imm_i = interp_Scalar.to_i8(imm_s._0);
      if (imm_i.$ === "Err") return imm_i;
      const which = FloatBinOp.cmp_from_imm(this_, imm_i._0, link_name);
      if (which.$ === "Err") return which;

      const r = bin_op_simd_float_first(this_, which._0, left, right, dest, Single);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_cmp*_ps functions.
    // Performs a comparison operation on each component of `left`
    // and `right`. For each component, returns 0 if false or u32::MAX
    // if true.
    // _mm_cmp_ps is actually an AVX function where the operation is specified
    // by a const parameter.
    // _mm_cmp{eq,lt,le,gt,ge,neq,nlt,nle,ngt,nge,ord,unord}_ps are SSE functions
    // with hard-coded operations.
    case "cmp.ps": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (c.$ === "Err") return c;
      const [left, right, imm] = c._0 as [OpTy, OpTy, OpTy];

      const imm_s = this_.read_scalar(imm);
      if (imm_s.$ === "Err") return imm_s;
      const imm_i = interp_Scalar.to_i8(imm_s._0);
      if (imm_i.$ === "Err") return imm_i;
      const which = FloatBinOp.cmp_from_imm(this_, imm_i._0, link_name);
      if (which.$ === "Err") return which;

      const r = bin_op_simd_float_all(this_, which._0, left, right, dest, Single);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement _mm_{,u}comi{eq,lt,le,gt,ge,neq}_ss functions.
    // Compares the first component of `left` and `right` and returns
    // a scalar value (0 or 1).
    case "comieq.ss":
    case "comilt.ss":
    case "comile.ss":
    case "comigt.ss":
    case "comige.ss":
    case "comineq.ss":
    case "ucomieq.ss":
    case "ucomilt.ss":
    case "ucomile.ss":
    case "ucomigt.ss":
    case "ucomige.ss":
    case "ucomineq.ss": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left_, right_] = c._0 as [OpTy, OpTy];

      const left_s = this_.project_to_simd(left_);
      if (left_s.$ === "Err") return left_s;
      const [left_v, left_len] = left_s._0;
      const right_s = this_.project_to_simd(right_);
      if (right_s.$ === "Err") return right_s;
      const [right_v, right_len] = right_s._0;

      assert_eq(left_len, right_len, String);

      const l_p = this_.project_index(left_v, 0n);
      if (l_p.$ === "Err") return l_p;
      const l_s = this_.read_scalar(l_p._0);
      if (l_s.$ === "Err") return l_s;
      const left = interp_Scalar.to_f32(l_s._0);
      if (left.$ === "Err") return left;
      const r_p = this_.project_index(right_v, 0n);
      if (r_p.$ === "Err") return r_p;
      const r_s = this_.read_scalar(r_p._0);
      if (r_s.$ === "Err") return r_s;
      const right = interp_Scalar.to_f32(r_s._0);
      if (right.$ === "Err") return right;
      // The difference between the com* and ucom* variants is signaling
      // of exceptions when either argument is a quiet NaN. We do not
      // support accessing the SSE status register from miri (or from Rust,
      // for that matter), so we treat both variants equally.
      const cmp = left._0.partial_cmp(right._0);
      let res: boolean;
      switch (unprefixed_name) {
        case "comieq.ss":
        case "ucomieq.ss":
          res = cmp === 0;
          break;
        case "comilt.ss":
        case "ucomilt.ss":
          res = cmp === -1;
          break;
        case "comile.ss":
        case "ucomile.ss":
          res = cmp === -1 || cmp === 0;
          break;
        case "comigt.ss":
        case "ucomigt.ss":
          res = cmp === 1;
          break;
        case "comige.ss":
        case "ucomige.ss":
          res = cmp === 1 || cmp === 0;
          break;
        case "comineq.ss":
        case "ucomineq.ss":
          res = cmp !== 0;
          break;
      }
      const w = this_.write_scalar(interp_Scalar.from_i32(res ? 1 : 0), dest);
      if (w.$ === "Err") return w;
      break;
    }
    // Use to implement the _mm_cvtss_si32, _mm_cvttss_si32,
    // _mm_cvtss_si64 and _mm_cvttss_si64 functions.
    // Converts the first component of `op` from f32 to i32/i64.
    case "cvtss2si":
    case "cvttss2si":
    case "cvtss2si64":
    case "cvttss2si64": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 1);
      if (c.$ === "Err") return c;
      const [op_] = c._0 as [OpTy];
      const op_s = this_.project_to_simd(op_);
      if (op_s.$ === "Err") return op_s;
      const [op_v] = op_s._0;

      const op_p = this_.project_index(op_v, 0n);
      if (op_p.$ === "Err") return op_p;
      const op = this_.read_immediate(op_p._0);
      if (op.$ === "Err") return op;

      let rnd: Round;
      switch (unprefixed_name) {
        // "current SSE rounding mode", assume nearest
        // https://www.felixcloutier.com/x86/cvtss2si
        case "cvtss2si":
        case "cvtss2si64":
          rnd = "NearestTiesToEven";
          break;
        // always truncate
        // https://www.felixcloutier.com/x86/cvttss2si
        case "cvttss2si":
        case "cvttss2si64":
          rnd = "TowardZero";
          break;
      }

      const res_r = this_.float_to_int_checked(op._0, dest.layout, rnd);
      if (res_r.$ === "Err") return res_r;
      // Fallback to minimum according to SSE semantics.
      const res = res_r._0 ?? MiriImmTy.from_int(dest.layout.size.signed_int_min(), dest.layout);

      const w = this_.write_immediate(res.imm, dest);
      if (w.$ === "Err") return w;
      break;
    }
    default:
      return interp_ok(EmulateItemResult.NotSupported);
  }
  return interp_ok(EmulateItemResult.NeedsReturn);
};
