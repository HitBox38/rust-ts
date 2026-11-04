// Fill lane: `miri-x86-a` (plan-m6 wave 38): ported by this lane.
// Port of src/tools/miri/src/intrinsics/x86/sse2.rs (crate `miri`, plan-m6 D2).
//
// PORT:
// - `trait EvalContextExt` (impl for `MiriInterpCx`) is a `declare module` augmentation of `InterpCx` (decision C2).
// - The apfloat comparisons (`left < right`, ...) are `partial_cmp` tests (Rust's `PartialOrd` provided methods); `==` is
//   `IeeeFloat::eq`, `!=` its negation.
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Scalar as interp_Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { assert_eq, panic } from "../../../std/panic.ts";
import { Err } from "../../../std/result.ts";
import { Double } from "../../../vendor/rustc_apfloat/ieee.ts";
import { type Round } from "../../../vendor/rustc_apfloat/lib.ts";
import { type MPlaceTy, type OpTy } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { MiriImmTy } from "../../operator.ts";
import { EmulateItemResult } from "../../shims/mod.ts";
import { bin_op_simd_float_all, bin_op_simd_float_first, convert_float_to_int, FloatBinOp, packssdw, packsswb, packuswb, pmaddwd, psadbw, type ShiftOp, shift_simd_by_scalar } from "./mod.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/x86/sse2.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/x86/sse2.rs:13
    emulate_x86_sse2_intrinsic(this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult>;
  }
}

// rustc: src/tools/miri/src/intrinsics/x86/sse2.rs:13 emulate_x86_sse2_intrinsic
InterpCx.prototype.emulate_x86_sse2_intrinsic = function (this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();
  const e = this_.expect_target_feature_for_intrinsic(link_name, "sse2");
  if (e.$ === "Err") return e;
  // Prefix should have already been checked.
  const link_name_str = Symbol.as_str(link_name);
  if (!link_name_str.startsWith("llvm.x86.sse2.")) return panic("called `Option::unwrap()` on a `None` value");
  const unprefixed_name = link_name_str.slice("llvm.x86.sse2.".length);

  // These intrinsics operate on 128-bit (f32x4, f64x2, i8x16, i16x8, i32x4, i64x2) SIMD
  // vectors unless stated otherwise.
  // Many intrinsic names are suffixed with "ps" (packed single), "ss" (scalar single),
  // "pd" (packed double) or "sd" (scalar double), where single means single precision
  // floating point (f32) and double means double precision floating point (f64). "ps"
  // and "pd" means that the operation is performed on each element of the vector, while
  // "ss" and "sd" means that the operation is performed only on the first element, copying
  // the remaining elements from the input vector (for binary operations, from the left-hand
  // side).
  // Intrinsics suffixed with "epiX" or "epuX" operate with X-bit signed or unsigned
  // vectors.
  switch (unprefixed_name) {
    // Used to implement the _mm_sad_epu8 function.
    case "psad.bw": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left, right] = c._0 as [OpTy, OpTy];

      const r = psadbw(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_{sll,srl,sra}_epi{16,32,64} functions
    // (except _mm_sra_epi64, which is not available in SSE2).
    // Shifts N-bit packed integers in left by the amount in right.
    // Both operands are 128-bit vectors. However, right is interpreted as
    // a single 64-bit integer (remaining bits are ignored).
    // For logic shifts, when right is larger than N - 1, zero is produced.
    // For arithmetic shifts, when right is larger than N - 1, the sign bit
    // is copied to remaining bits.
    case "psll.w":
    case "psrl.w":
    case "psra.w":
    case "psll.d":
    case "psrl.d":
    case "psra.d":
    case "psll.q":
    case "psrl.q": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left, right] = c._0 as [OpTy, OpTy];

      let which: ShiftOp;
      switch (unprefixed_name) {
        case "psll.w":
        case "psll.d":
        case "psll.q":
          which = "Left";
          break;
        case "psrl.w":
        case "psrl.d":
        case "psrl.q":
          which = "RightLogic";
          break;
        case "psra.w":
        case "psra.d":
          which = "RightArith";
          break;
      }

      const r = shift_simd_by_scalar(this_, left, right, which, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_cvtps_epi32, _mm_cvttps_epi32, _mm_cvtpd_epi32
    // and _mm_cvttpd_epi32 functions.
    // Converts packed f32/f64 to packed i32.
    case "cvtps2dq":
    case "cvttps2dq":
    case "cvtpd2dq":
    case "cvttpd2dq": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 1);
      if (c.$ === "Err") return c;
      const [op] = c._0 as [OpTy];

      const [op_len] = op.layout.ty.simd_size_and_type(this_.tcx.deref());
      const [dest_len] = dest.layout.ty.simd_size_and_type(this_.tcx.deref());
      switch (unprefixed_name) {
        case "cvtps2dq":
        case "cvttps2dq":
          // f32x4 to i32x4 conversion
          assert_eq(op_len, 4, String);
          assert_eq(dest_len, op_len, String);
          break;
        case "cvtpd2dq":
        case "cvttpd2dq":
          // f64x2 to i32x4 conversion
          // the last two values are filled with zeros
          assert_eq(op_len, 2, String);
          assert_eq(dest_len, 4, String);
          break;
      }

      let rnd: Round;
      switch (unprefixed_name) {
        // "current SSE rounding mode", assume nearest
        // https://www.felixcloutier.com/x86/cvtps2dq
        // https://www.felixcloutier.com/x86/cvtpd2dq
        case "cvtps2dq":
        case "cvtpd2dq":
          rnd = "NearestTiesToEven";
          break;
        // always truncate
        // https://www.felixcloutier.com/x86/cvttps2dq
        // https://www.felixcloutier.com/x86/cvttpd2dq
        case "cvttps2dq":
        case "cvttpd2dq":
          rnd = "TowardZero";
          break;
      }

      const r = convert_float_to_int(this_, op, rnd, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_packs_epi16 function.
    // Converts two 16-bit integer vectors to a single 8-bit integer
    // vector with signed saturation.
    case "packsswb.128": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left, right] = c._0 as [OpTy, OpTy];

      const r = packsswb(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_packus_epi16 function.
    // Converts two 16-bit signed integer vectors to a single 8-bit
    // unsigned integer vector with saturation.
    case "packuswb.128": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left, right] = c._0 as [OpTy, OpTy];

      const r = packuswb(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_packs_epi32 function.
    // Converts two 32-bit integer vectors to a single 16-bit integer
    // vector with signed saturation.
    case "packssdw.128": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left, right] = c._0 as [OpTy, OpTy];

      const r = packssdw(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement _mm_min_sd and _mm_max_sd functions.
    // Note that the semantics are a bit different from Rust simd_min
    // and simd_max intrinsics regarding handling of NaN and -0.0: Rust
    // matches the IEEE min/max operations, while x86 has different
    // semantics.
    case "min.sd":
    case "max.sd": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left, right] = c._0 as [OpTy, OpTy];

      let which: FloatBinOp;
      switch (unprefixed_name) {
        case "min.sd":
          which = FloatBinOp.Min;
          break;
        case "max.sd":
          which = FloatBinOp.Max;
          break;
      }

      const r = bin_op_simd_float_first(this_, which, left, right, dest, Double);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement _mm_min_pd and _mm_max_pd functions.
    // Note that the semantics are a bit different from Rust simd_min
    // and simd_max intrinsics regarding handling of NaN and -0.0: Rust
    // matches the IEEE min/max operations, while x86 has different
    // semantics.
    case "min.pd":
    case "max.pd": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left, right] = c._0 as [OpTy, OpTy];

      let which: FloatBinOp;
      switch (unprefixed_name) {
        case "min.pd":
          which = FloatBinOp.Min;
          break;
        case "max.pd":
          which = FloatBinOp.Max;
          break;
      }

      const r = bin_op_simd_float_all(this_, which, left, right, dest, Double);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_cmp*_sd functions.
    // Performs a comparison operation on the first component of `left`
    // and `right`, returning 0 if false or `u64::MAX` if true. The remaining
    // components are copied from `left`.
    // _mm_cmp_sd is actually an AVX function where the operation is specified
    // by a const parameter.
    // _mm_cmp{eq,lt,le,gt,ge,neq,nlt,nle,ngt,nge,ord,unord}_sd are SSE2 functions
    // with hard-coded operations.
    case "cmp.sd": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (c.$ === "Err") return c;
      const [left, right, imm] = c._0 as [OpTy, OpTy, OpTy];

      const imm_s = this_.read_scalar(imm);
      if (imm_s.$ === "Err") return imm_s;
      const imm_i = interp_Scalar.to_i8(imm_s._0);
      if (imm_i.$ === "Err") return imm_i;
      const which = FloatBinOp.cmp_from_imm(this_, imm_i._0, link_name);
      if (which.$ === "Err") return which;

      const r = bin_op_simd_float_first(this_, which._0, left, right, dest, Double);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_cmp*_pd functions.
    // Performs a comparison operation on each component of `left`
    // and `right`. For each component, returns 0 if false or `u64::MAX`
    // if true.
    // _mm_cmp_pd is actually an AVX function where the operation is specified
    // by a const parameter.
    // _mm_cmp{eq,lt,le,gt,ge,neq,nlt,nle,ngt,nge,ord,unord}_pd are SSE2 functions
    // with hard-coded operations.
    case "cmp.pd": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (c.$ === "Err") return c;
      const [left, right, imm] = c._0 as [OpTy, OpTy, OpTy];

      const imm_s = this_.read_scalar(imm);
      if (imm_s.$ === "Err") return imm_s;
      const imm_i = interp_Scalar.to_i8(imm_s._0);
      if (imm_i.$ === "Err") return imm_i;
      const which = FloatBinOp.cmp_from_imm(this_, imm_i._0, link_name);
      if (which.$ === "Err") return which;

      const r = bin_op_simd_float_all(this_, which._0, left, right, dest, Double);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement _mm_{,u}comi{eq,lt,le,gt,ge,neq}_sd functions.
    // Compares the first component of `left` and `right` and returns
    // a scalar value (0 or 1).
    case "comieq.sd":
    case "comilt.sd":
    case "comile.sd":
    case "comigt.sd":
    case "comige.sd":
    case "comineq.sd":
    case "ucomieq.sd":
    case "ucomilt.sd":
    case "ucomile.sd":
    case "ucomigt.sd":
    case "ucomige.sd":
    case "ucomineq.sd": {
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
      const left = interp_Scalar.to_f64(l_s._0);
      if (left.$ === "Err") return left;
      const r_p = this_.project_index(right_v, 0n);
      if (r_p.$ === "Err") return r_p;
      const r_s = this_.read_scalar(r_p._0);
      if (r_s.$ === "Err") return r_s;
      const right = interp_Scalar.to_f64(r_s._0);
      if (right.$ === "Err") return right;
      // The difference between the com* and ucom* variants is signaling
      // of exceptions when either argument is a quiet NaN. We do not
      // support accessing the SSE status register from miri (or from Rust,
      // for that matter), so we treat both variants equally.
      const cmp = left._0.partial_cmp(right._0);
      let res: boolean;
      switch (unprefixed_name) {
        case "comieq.sd":
        case "ucomieq.sd":
          res = cmp === 0;
          break;
        case "comilt.sd":
        case "ucomilt.sd":
          res = cmp === -1;
          break;
        case "comile.sd":
        case "ucomile.sd":
          res = cmp === -1 || cmp === 0;
          break;
        case "comigt.sd":
        case "ucomigt.sd":
          res = cmp === 1;
          break;
        case "comige.sd":
        case "ucomige.sd":
          res = cmp === 1 || cmp === 0;
          break;
        case "comineq.sd":
        case "ucomineq.sd":
          res = cmp !== 0;
          break;
      }
      const w = this_.write_scalar(interp_Scalar.from_i32(res ? 1 : 0), dest);
      if (w.$ === "Err") return w;
      break;
    }
    // Use to implement the _mm_cvtsd_si32, _mm_cvttsd_si32,
    // _mm_cvtsd_si64 and _mm_cvttsd_si64 functions.
    // Converts the first component of `op` from f64 to i32/i64.
    case "cvtsd2si":
    case "cvttsd2si":
    case "cvtsd2si64":
    case "cvttsd2si64": {
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
        // https://www.felixcloutier.com/x86/cvtsd2si
        case "cvtsd2si":
        case "cvtsd2si64":
          rnd = "NearestTiesToEven";
          break;
        // always truncate
        // https://www.felixcloutier.com/x86/cvttsd2si
        case "cvttsd2si":
        case "cvttsd2si64":
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
    // Used to implement the _mm_cvtsd_ss function.
    // Converts the first f64 from `right` to f32 and copies the remaining
    // elements from `left`
    case "cvtsd2ss": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left, right] = c._0 as [OpTy, OpTy];

      const left_s = this_.project_to_simd(left);
      if (left_s.$ === "Err") return left_s;
      const [left_v, left_len] = left_s._0;
      const right_s = this_.project_to_simd(right);
      if (right_s.$ === "Err") return right_s;
      const [right_v] = right_s._0;
      const dest_s = this_.project_to_simd(dest);
      if (dest_s.$ === "Err") return dest_s;
      const [dest_v, dest_len] = dest_s._0;

      assert_eq(dest_len, left_len, String);

      // Convert first element of `right`
      const r0_p = this_.project_index(right_v, 0n);
      if (r0_p.$ === "Err") return r0_p;
      const right0 = this_.read_immediate(r0_p._0);
      if (right0.$ === "Err") return right0;
      const dest0 = this_.project_index(dest_v, 0n);
      if (dest0.$ === "Err") return dest0;
      const res0 = this_.float_to_float_or_int(right0._0, dest0._0.layout);
      if (res0.$ === "Err") return res0;
      const w0 = this_.write_immediate(res0._0.imm, dest0._0);
      if (w0.$ === "Err") return w0;

      // Copy remaining from `left`
      for (let i = 1n; i < dest_len; i++) {
        const l = this_.project_index(left_v, i);
        if (l.$ === "Err") return l;
        const d = this_.project_index(dest_v, i);
        if (d.$ === "Err") return d;
        const w = this_.copy_op(l._0, d._0);
        if (w.$ === "Err") return w;
      }
      break;
    }
    // Used to implement the _mm_madd_epi16 function.
    // Multiplies packed signed 16-bit integers in `left` and `right`, producing
    // intermediate signed 32-bit integers. Horizontally add adjacent pairs of
    // intermediate 32-bit integers, and pack the results in `dest`.
    case "pmadd.wd": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left, right] = c._0 as [OpTy, OpTy];

      const r = pmaddwd(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_mulhi_epi16 and _mm_mulhi_epu16 functions.
    case "pmulh.w":
    case "pmulhu.w": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left_, right_] = c._0 as [OpTy, OpTy];

      const left_s = this_.project_to_simd(left_);
      if (left_s.$ === "Err") return left_s;
      const [left_v, left_len] = left_s._0;
      const right_s = this_.project_to_simd(right_);
      if (right_s.$ === "Err") return right_s;
      const [right_v, right_len] = right_s._0;
      const dest_s = this_.project_to_simd(dest);
      if (dest_s.$ === "Err") return dest_s;
      const [dest_v, dest_len] = dest_s._0;

      assert_eq(dest_len, left_len, String);
      assert_eq(dest_len, right_len, String);

      for (let i = 0n; i < dest_len; i++) {
        const l_p = this_.project_index(left_v, i);
        if (l_p.$ === "Err") return l_p;
        const left_i = this_.read_immediate(l_p._0);
        if (left_i.$ === "Err") return left_i;
        const r_p = this_.project_index(right_v, i);
        if (r_p.$ === "Err") return r_p;
        const right_i = this_.read_immediate(r_p._0);
        if (right_i.$ === "Err") return right_i;
        const d = this_.project_index(dest_v, i);
        if (d.$ === "Err") return d;
        const dest_i = d._0;

        // Widen the operands to avoid overflow
        const twice_wide = this_.layout_of(this_.get_twice_wide_int_ty(left_i._0.layout.ty));
        if (twice_wide.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(twice_wide._0));
        const left = this_.int_to_int_or_float(left_i._0, twice_wide._0);
        if (left.$ === "Err") return left;
        const right = this_.int_to_int_or_float(right_i._0, twice_wide._0);
        if (right.$ === "Err") return right;

        // Multiply
        const multiplied = this_.binary_op("Mul", left._0, right._0);
        if (multiplied.$ === "Err") return multiplied;
        // Keep the high half
        const high = this_.binary_op("Shr", multiplied._0, MiriImmTy.from_uint(BigInt(dest_i.layout.size.bits()), twice_wide._0));
        if (high.$ === "Err") return high;

        // Narrow back to the original type
        const res = this_.int_to_int_or_float(high._0, dest_i.layout);
        if (res.$ === "Err") return res;
        const w = this_.write_immediate(res._0.imm, dest_i);
        if (w.$ === "Err") return w;
      }
      break;
    }
    default:
      return interp_ok(EmulateItemResult.NotSupported);
  }
  return interp_ok(EmulateItemResult.NeedsReturn);
};
