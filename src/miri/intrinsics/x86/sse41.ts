// Fill lane: `miri-x86-a` (plan-m6 wave 38): ported by this lane.
// Port of src/tools/miri/src/intrinsics/x86/sse41.rs (crate `miri`, plan-m6 D2).
//
// PORT: `trait EvalContextExt` (impl for `MiriInterpCx`) is a `declare module` augmentation of `InterpCx` (decision C2).
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult, interp_ok, Scalar as interp_Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { assert, assert_eq, panic } from "../../../std/panic.ts";
import { Double, Single } from "../../../vendor/rustc_apfloat/ieee.ts";
import { type MPlaceTy, type OpTy } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { EmulateItemResult } from "../../shims/mod.ts";
import { conditional_dot_product, mpsadbw, packusdw, round_all, round_first, test_bits_masked } from "./mod.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/x86/sse41.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/x86/sse41.rs:8
    emulate_x86_sse41_intrinsic(this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult>;
  }
}

// rustc: src/tools/miri/src/intrinsics/x86/sse41.rs:8 emulate_x86_sse41_intrinsic
InterpCx.prototype.emulate_x86_sse41_intrinsic = function (this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();
  const e = this_.expect_target_feature_for_intrinsic(link_name, "sse4.1");
  if (e.$ === "Err") return e;
  // Prefix should have already been checked.
  const link_name_str = Symbol.as_str(link_name);
  if (!link_name_str.startsWith("llvm.x86.sse41.")) return panic("called `Option::unwrap()` on a `None` value");
  const unprefixed_name = link_name_str.slice("llvm.x86.sse41.".length);

  switch (unprefixed_name) {
    // Used to implement the _mm_insert_ps function.
    // Takes one element of `right` and inserts it into `left` and
    // optionally zero some elements. Source index is specified
    // in bits `6..=7` of `imm`, destination index is specified in
    // bits `4..=5` if `imm`, and `i`th bit specifies whether element
    // `i` is zeroed.
    case "insertps": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (c.$ === "Err") return c;
      const [left, right, imm_] = c._0 as [OpTy, OpTy, OpTy];

      const left_s = this_.project_to_simd(left);
      if (left_s.$ === "Err") return left_s;
      const [left_v, left_len] = left_s._0;
      const right_s = this_.project_to_simd(right);
      if (right_s.$ === "Err") return right_s;
      const [right_v, right_len] = right_s._0;
      const dest_s = this_.project_to_simd(dest);
      if (dest_s.$ === "Err") return dest_s;
      const [dest_v, dest_len] = dest_s._0;

      assert_eq(dest_len, left_len, String);
      assert_eq(dest_len, right_len, String);
      assert(dest_len <= 4n, "assertion failed: dest_len <= 4");

      const imm_r = this_.read_scalar(imm_);
      if (imm_r.$ === "Err") return imm_r;
      const imm = interp_Scalar.to_u8(imm_r._0);
      if (imm.$ === "Err") return imm;
      const src_index = BigInt((imm._0 >> 6) & 0b11);
      const dst_index = BigInt((imm._0 >> 4) & 0b11);

      const src_p = this_.project_index(right_v, src_index);
      if (src_p.$ === "Err") return src_p;
      const src_value = this_.read_immediate(src_p._0);
      if (src_value.$ === "Err") return src_value;

      for (let i = 0n; i < dest_len; i++) {
        const d = this_.project_index(dest_v, i);
        if (d.$ === "Err") return d;

        if ((imm._0 & (1 << Number(i))) !== 0) {
          // zeroed
          const w = this_.write_scalar(interp_Scalar.from_u32(0), d._0);
          if (w.$ === "Err") return w;
        } else if (i === dst_index) {
          // copy from `right` at specified index
          const w = this_.write_immediate(src_value._0.imm, d._0);
          if (w.$ === "Err") return w;
        } else {
          // copy from `left`
          const l = this_.project_index(left_v, i);
          if (l.$ === "Err") return l;
          const w = this_.copy_op(l._0, d._0);
          if (w.$ === "Err") return w;
        }
      }
      break;
    }
    // Used to implement the _mm_packus_epi32 function.
    // Concatenates two 32-bit signed integer vectors and converts
    // the result to a 16-bit unsigned integer vector with saturation.
    case "packusdw": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left, right] = c._0 as [OpTy, OpTy];

      const r = packusdw(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_dp_ps and _mm_dp_pd functions.
    // Conditionally multiplies the packed floating-point elements in
    // `left` and `right` using the high 4 bits in `imm`, sums the four
    // products, and conditionally stores the sum in `dest` using the low
    // 4 bits of `imm`.
    case "dpps":
    case "dppd": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (c.$ === "Err") return c;
      const [left, right, imm] = c._0 as [OpTy, OpTy, OpTy];

      const r = conditional_dot_product(this_, left, right, imm, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_floor_ss, _mm_ceil_ss and _mm_round_ss
    // functions. Rounds the first element of `right` according to `rounding`
    // and copies the remaining elements from `left`.
    case "round.ss": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (c.$ === "Err") return c;
      const [left, right, rounding] = c._0 as [OpTy, OpTy, OpTy];

      const r = round_first(this_, left, right, rounding, dest, Single);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_floor_ps, _mm_ceil_ps and _mm_round_ps
    // functions. Rounds the elements of `op` according to `rounding`.
    case "round.ps": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [op, rounding] = c._0 as [OpTy, OpTy];

      const r = round_all(this_, op, rounding, dest, Single);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_floor_sd, _mm_ceil_sd and _mm_round_sd
    // functions. Rounds the first element of `right` according to `rounding`
    // and copies the remaining elements from `left`.
    case "round.sd": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (c.$ === "Err") return c;
      const [left, right, rounding] = c._0 as [OpTy, OpTy, OpTy];

      const r = round_first(this_, left, right, rounding, dest, Double);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_floor_pd, _mm_ceil_pd and _mm_round_pd
    // functions. Rounds the elements of `op` according to `rounding`.
    case "round.pd": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [op, rounding] = c._0 as [OpTy, OpTy];

      const r = round_all(this_, op, rounding, dest, Double);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_minpos_epu16 function.
    // Find the minimum unsigned 16-bit integer in `op` and
    // returns its value and position.
    case "phminposuw": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 1);
      if (c.$ === "Err") return c;
      const [op_] = c._0 as [OpTy];

      const op_s = this_.project_to_simd(op_);
      if (op_s.$ === "Err") return op_s;
      const [op_v, op_len] = op_s._0;
      const dest_s = this_.project_to_simd(dest);
      if (dest_s.$ === "Err") return dest_s;
      const [dest_v, dest_len] = dest_s._0;

      // Find minimum
      let min_value = 0xffff;
      let min_index = 0n;
      for (let i = 0n; i < op_len; i++) {
        const o_p = this_.project_index(op_v, i);
        if (o_p.$ === "Err") return o_p;
        const o_s = this_.read_scalar(o_p._0);
        if (o_s.$ === "Err") return o_s;
        const op = interp_Scalar.to_u16(o_s._0);
        if (op.$ === "Err") return op;
        if (op._0 < min_value) {
          min_value = op._0;
          min_index = i;
        }
      }

      // Write value and index
      const d0 = this_.project_index(dest_v, 0n);
      if (d0.$ === "Err") return d0;
      const w0 = this_.write_scalar(interp_Scalar.from_u16(min_value), d0._0);
      if (w0.$ === "Err") return w0;
      const d1 = this_.project_index(dest_v, 1n);
      if (d1.$ === "Err") return d1;
      const w1 = this_.write_scalar(interp_Scalar.from_u16(Number(min_index)), d1._0);
      if (w1.$ === "Err") return w1;
      // Fill remainder with zeros
      for (let i = 2n; i < dest_len; i++) {
        const d = this_.project_index(dest_v, i);
        if (d.$ === "Err") return d;
        const w = this_.write_scalar(interp_Scalar.from_u16(0), d._0);
        if (w.$ === "Err") return w;
      }
      break;
    }
    // Used to implement the _mm_mpsadbw_epu8 function.
    // Compute the sum of absolute differences of quadruplets of unsigned
    // 8-bit integers in `left` and `right`, and store the 16-bit results
    // in `right`. Quadruplets are selected from `left` and `right` with
    // offsets specified in `imm`.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm_mpsadbw_epu8
    case "mpsadbw": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (c.$ === "Err") return c;
      const [left, right, imm] = c._0 as [OpTy, OpTy, OpTy];

      const r = mpsadbw(this_, left, right, imm, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_testnzc_si128 function.
    // Tests `(op & mask) != 0 && (op & mask) != mask`
    case "ptestnzc": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [op, mask] = c._0 as [OpTy, OpTy];

      const t = test_bits_masked(this_, op, mask);
      if (t.$ === "Err") return t;
      const [all_zero, masked_set] = t._0;
      const res = !all_zero && !masked_set;

      const w = this_.write_scalar(interp_Scalar.from_i32(res ? 1 : 0), dest);
      if (w.$ === "Err") return w;
      break;
    }
    default:
      return interp_ok(EmulateItemResult.NotSupported);
  }
  return interp_ok(EmulateItemResult.NeedsReturn);
};
