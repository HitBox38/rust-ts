// Port of src/tools/miri/src/intrinsics/x86/avx.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-x86-b` (plan-m6 wave 38): ported by this lane.
//
// PORT:
// - `bin_op_simd_float_all::<Single>` / `round_all::<Single>` take the float type's `FloatType` dictionary as a trailing
//   argument (src/miri/math.ts header; agreed with miri-x86-a).
// - Element indices are `u64` = `bigint` (C5). `strict_add` of `i & !0b11` and a two-bit index cannot overflow: `i` is
//   below the vector's length.
// - Rust shadows `data` / `control` / `dest` with their projections; the projections here are `data_v` / `control_v` /
//   `dest_v` and the per-element values `control_i`.
import { type MPlaceTy, type OpTy } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { EmulateItemResult } from "../../shims/mod.ts";
import * as x86 from "./mod.ts";
import { FloatBinOp, FloatUnaryOp } from "./mod.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { interp_ok, type InterpResult, Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { assert_eq, unreachable, unwrap } from "../../../std/panic.ts";
import { Round, type Float, type FloatType } from "../../../vendor/rustc_apfloat/lib.ts";
import { Double, Single } from "../../../vendor/rustc_apfloat/ieee.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/x86/avx.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/x86/avx.rs:12
    emulate_x86_avx_intrinsic(this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult>;
  }
}

/** `assert_eq!` of two `u64` lengths. */
function assert_eq_len(left: bigint, right: bigint): void {
  assert_eq(left, right, (v) => `${v}`);
}

/** `str::strip_prefix` */
function strip_prefix(s: string, prefix: string): string | undefined {
  return s.startsWith(prefix) ? s.slice(prefix.length) : undefined;
}

// rustc: src/tools/miri/src/intrinsics/x86/avx.rs:12 emulate_x86_avx_intrinsic
InterpCx.prototype.emulate_x86_avx_intrinsic = function (this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();
  const f = this_.expect_target_feature_for_intrinsic(link_name, "avx");
  if (f.$ === "Err") return f;
  // Prefix should have already been checked.
  const unprefixed_name = unwrap(strip_prefix(Symbol.as_str(link_name), "llvm.x86.avx."));

  switch (unprefixed_name) {
    // Used to implement _mm256_min_ps and _mm256_max_ps functions.
    // Note that the semantics are a bit different from Rust simd_min
    // and simd_max intrinsics regarding handling of NaN and -0.0: Rust
    // matches the IEEE min/max operations, while x86 has different
    // semantics.
    case "min.ps.256":
    case "max.ps.256": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      let which: FloatBinOp;
      switch (unprefixed_name) {
        case "min.ps.256":
          which = FloatBinOp.Min;
          break;
        case "max.ps.256":
          which = FloatBinOp.Max;
          break;
        default:
          return unreachable();
      }

      const r = x86.bin_op_simd_float_all(this_, which, left, right, dest, Single);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement _mm256_min_pd and _mm256_max_pd functions.
    case "min.pd.256":
    case "max.pd.256": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      let which: FloatBinOp;
      switch (unprefixed_name) {
        case "min.pd.256":
          which = FloatBinOp.Min;
          break;
        case "max.pd.256":
          which = FloatBinOp.Max;
          break;
        default:
          return unreachable();
      }

      const r = x86.bin_op_simd_float_all(this_, which, left, right, dest, Double);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm256_round_ps function.
    // Rounds the elements of `op` according to `rounding`.
    case "round.ps.256": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [op, rounding] = sig._0 as [OpTy, OpTy];

      const r = x86.round_all(this_, op, rounding, dest, Single);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm256_round_pd function.
    // Rounds the elements of `op` according to `rounding`.
    case "round.pd.256": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [op, rounding] = sig._0 as [OpTy, OpTy];

      const r = x86.round_all(this_, op, rounding, dest, Double);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement _mm256_{rcp,rsqrt}_ps functions.
    // Performs the operations on all components of `op`.
    case "rcp.ps.256":
    case "rsqrt.ps.256": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 1);
      if (sig.$ === "Err") return sig;
      const [op] = sig._0 as [OpTy];

      let which: FloatUnaryOp;
      switch (unprefixed_name) {
        case "rcp.ps.256":
          which = FloatUnaryOp.Rcp;
          break;
        case "rsqrt.ps.256":
          which = FloatUnaryOp.Rsqrt;
          break;
        default:
          return unreachable();
      }

      const r = x86.unary_op_ps(this_, which, op, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm256_dp_ps function.
    case "dp.ps.256": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (sig.$ === "Err") return sig;
      const [left, right, imm] = sig._0 as [OpTy, OpTy, OpTy];

      const r = x86.conditional_dot_product(this_, left, right, imm, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm256_cmp_ps function.
    // Performs a comparison operation on each component of `left`
    // and `right`. For each component, returns 0 if false or u32::MAX
    // if true.
    case "cmp.ps.256": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (sig.$ === "Err") return sig;
      const [left, right, imm] = sig._0 as [OpTy, OpTy, OpTy];

      const imm_s = this_.read_scalar(imm);
      if (imm_s.$ === "Err") return imm_s;
      const imm_v = Scalar.to_i8(imm_s._0);
      if (imm_v.$ === "Err") return imm_v;
      const which = FloatBinOp.cmp_from_imm(this_, imm_v._0, link_name);
      if (which.$ === "Err") return which;

      const r = x86.bin_op_simd_float_all(this_, which._0, left, right, dest, Single);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm256_cmp_pd function.
    // Performs a comparison operation on each component of `left`
    // and `right`. For each component, returns 0 if false or u64::MAX
    // if true.
    case "cmp.pd.256": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (sig.$ === "Err") return sig;
      const [left, right, imm] = sig._0 as [OpTy, OpTy, OpTy];

      const imm_s = this_.read_scalar(imm);
      if (imm_s.$ === "Err") return imm_s;
      const imm_v = Scalar.to_i8(imm_s._0);
      if (imm_v.$ === "Err") return imm_v;
      const which = FloatBinOp.cmp_from_imm(this_, imm_v._0, link_name);
      if (which.$ === "Err") return which;

      const r = x86.bin_op_simd_float_all(this_, which._0, left, right, dest, Double);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm256_cvtps_epi32, _mm256_cvttps_epi32, _mm256_cvtpd_epi32
    // and _mm256_cvttpd_epi32 functions.
    // Converts packed f32/f64 to packed i32.
    case "cvt.ps2dq.256":
    case "cvtt.ps2dq.256":
    case "cvt.pd2dq.256":
    case "cvtt.pd2dq.256": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 1);
      if (sig.$ === "Err") return sig;
      const [op] = sig._0 as [OpTy];

      let rnd: Round;
      switch (unprefixed_name) {
        // "current SSE rounding mode", assume nearest
        case "cvt.ps2dq.256":
        case "cvt.pd2dq.256":
          rnd = Round.NearestTiesToEven;
          break;
        // always truncate
        case "cvtt.ps2dq.256":
        case "cvtt.pd2dq.256":
          rnd = Round.TowardZero;
          break;
        default:
          return unreachable();
      }

      const r = x86.convert_float_to_int(this_, op, rnd, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_permutevar_ps and _mm256_permutevar_ps functions.
    // Shuffles 32-bit floats from `data` using `control` as control. Each 128-bit
    // chunk is shuffled independently: this means that we view the vector as a
    // sequence of 4-element arrays, and we shuffle each of these arrays, where
    // `control` determines which element of the current `data` array is written.
    case "vpermilvar.ps":
    case "vpermilvar.ps.256": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [data, control] = sig._0 as [OpTy, OpTy];

      const data_s = this_.project_to_simd(data);
      if (data_s.$ === "Err") return data_s;
      const [data_v, data_len] = data_s._0;
      const control_s = this_.project_to_simd(control);
      if (control_s.$ === "Err") return control_s;
      const [control_v, control_len] = control_s._0;
      const dest_s = this_.project_to_simd(dest);
      if (dest_s.$ === "Err") return dest_s;
      const [dest_v, dest_len] = dest_s._0;

      assert_eq_len(dest_len, data_len);
      assert_eq_len(dest_len, control_len);

      for (let i = 0n; i < dest_len; i++) {
        const control_i = this_.project_index(control_v, i);
        if (control_i.$ === "Err") return control_i;

        // Each 128-bit chunk is shuffled independently. Since each chunk contains
        // four 32-bit elements, only two bits from `control` are used. To read the
        // value from the current chunk, add the destination index truncated to a multiple
        // of 4.
        const chunk_base = i & ~0b11n;
        const control_s_i = this_.read_scalar(control_i._0);
        if (control_s_i.$ === "Err") return control_s_i;
        const control_u = Scalar.to_u32(control_s_i._0);
        if (control_u.$ === "Err") return control_u;
        const src_i = BigInt(control_u._0 & 0b11) + chunk_base;

        const src_p = this_.project_index(data_v, src_i);
        if (src_p.$ === "Err") return src_p;
        const dest_p = this_.project_index(dest_v, i);
        if (dest_p.$ === "Err") return dest_p;
        const c = this_.copy_op(src_p._0, dest_p._0);
        if (c.$ === "Err") return c;
      }
      break;
    }
    // Used to implement the _mm_permutevar_pd and _mm256_permutevar_pd functions.
    // Shuffles 64-bit floats from `left` using `right` as control. Each 128-bit
    // chunk is shuffled independently: this means that we view the vector as
    // a sequence of 2-element arrays, and we shuffle each of these arrays,
    // where `right` determines which element of the current `left` array is
    // written.
    case "vpermilvar.pd":
    case "vpermilvar.pd.256": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [data, control] = sig._0 as [OpTy, OpTy];

      const data_s = this_.project_to_simd(data);
      if (data_s.$ === "Err") return data_s;
      const [data_v, data_len] = data_s._0;
      const control_s = this_.project_to_simd(control);
      if (control_s.$ === "Err") return control_s;
      const [control_v, control_len] = control_s._0;
      const dest_s = this_.project_to_simd(dest);
      if (dest_s.$ === "Err") return dest_s;
      const [dest_v, dest_len] = dest_s._0;

      assert_eq_len(dest_len, data_len);
      assert_eq_len(dest_len, control_len);

      for (let i = 0n; i < dest_len; i++) {
        const control_i = this_.project_index(control_v, i);
        if (control_i.$ === "Err") return control_i;

        // Each 128-bit chunk is shuffled independently. Since each chunk contains
        // two 64-bit elements, only the second bit from `control` is used (yes, the
        // second instead of the first, ask Intel). To read the value from the current
        // chunk, add the destination index truncated to a multiple of 2.
        const chunk_base = i & ~1n;
        const control_s_i = this_.read_scalar(control_i._0);
        if (control_s_i.$ === "Err") return control_s_i;
        const control_u = Scalar.to_u64(control_s_i._0);
        if (control_u.$ === "Err") return control_u;
        const src_i = ((control_u._0 >> 1n) & 1n) + chunk_base;

        const src_p = this_.project_index(data_v, src_i);
        if (src_p.$ === "Err") return src_p;
        const dest_p = this_.project_index(dest_v, i);
        if (dest_p.$ === "Err") return dest_p;
        const c = this_.copy_op(src_p._0, dest_p._0);
        if (c.$ === "Err") return c;
      }
      break;
    }
    // Used to implement the _mm256_lddqu_si256 function.
    // Reads a 256-bit vector from an unaligned pointer. This intrinsic
    // is expected to perform better than a regular unaligned read when
    // the data crosses a cache line, but for Miri this is just a regular
    // unaligned read.
    case "ldu.dq.256": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 1);
      if (sig.$ === "Err") return sig;
      const [src_ptr_] = sig._0 as [OpTy];
      const src_ptr = this_.read_pointer(src_ptr_);
      if (src_ptr.$ === "Err") return src_ptr;
      const dest_m = dest.force_mplace(this_);
      if (dest_m.$ === "Err") return dest_m;

      // Unaligned copy, which is what we want.
      const c = this_.mem_copy(src_ptr._0, dest_m._0.ptr(), dest_m._0.layout.size, /*nonoverlapping*/ true);
      if (c.$ === "Err") return c;
      break;
    }
    // Used to implement the _mm256_testnzc_si256 function.
    // Tests `op & mask != 0 && op & mask != mask`
    case "ptestnzc.256": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [op, mask] = sig._0 as [OpTy, OpTy];

      const t = x86.test_bits_masked(this_, op, mask);
      if (t.$ === "Err") return t;
      const [all_zero, masked_set] = t._0;
      const res = !all_zero && !masked_set;

      const w = this_.write_scalar(Scalar.from_i32(res ? 1 : 0), dest);
      if (w.$ === "Err") return w;
      break;
    }
    // Used to implement the _mm256_testz_pd, _mm256_testc_pd, _mm256_testnzc_pd
    // _mm_testnzc_pd, _mm256_testz_ps, _mm256_testc_ps, _mm256_testnzc_ps and
    // _mm_testnzc_ps functions.
    // Calculates two booleans:
    // `direct`, which is true when the highest bit of each element of `op & mask` is zero.
    // `negated`, which is true when the highest bit of each element of `!op & mask` is zero.
    // Return `direct` (testz), `negated` (testc) or `!direct & !negated` (testnzc)
    case "vtestz.pd.256":
    case "vtestc.pd.256":
    case "vtestnzc.pd.256":
    case "vtestnzc.pd":
    case "vtestz.ps.256":
    case "vtestc.ps.256":
    case "vtestnzc.ps.256":
    case "vtestnzc.ps": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [op, mask] = sig._0 as [OpTy, OpTy];

      const t = x86.test_high_bits_masked(this_, op, mask);
      if (t.$ === "Err") return t;
      const [direct, negated] = t._0;
      let res: boolean;
      switch (unprefixed_name) {
        case "vtestz.pd.256":
        case "vtestz.ps.256":
          res = direct;
          break;
        case "vtestc.pd.256":
        case "vtestc.ps.256":
          res = negated;
          break;
        case "vtestnzc.pd.256":
        case "vtestnzc.pd":
        case "vtestnzc.ps.256":
        case "vtestnzc.ps":
          res = !direct && !negated;
          break;
        default:
          return unreachable();
      }

      const w = this_.write_scalar(Scalar.from_i32(res ? 1 : 0), dest);
      if (w.$ === "Err") return w;
      break;
    }
    // Used to implement the `_mm256_zeroupper` and `_mm256_zeroall` functions.
    // These function clear out the upper 128 bits of all avx registers or
    // zero out all avx registers respectively.
    case "vzeroupper":
    case "vzeroall": {
      // These functions are purely a performance hint for the CPU.
      // Any registers currently in use will be saved beforehand by the
      // compiler, making these functions no-ops.

      // The only thing that needs to be ensured is the correct calling convention.
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 0);
      if (sig.$ === "Err") return sig;
      break;
    }
    default:
      return interp_ok(EmulateItemResult.NotSupported);
  }
  return interp_ok(EmulateItemResult.NeedsReturn);
};
