// Fill lane: `miri-x86-a` (plan-m6 wave 38): ported by this lane.
// Port of src/tools/miri/src/intrinsics/x86/mod.rs (crate `miri`, plan-m6 D2). Its types are generated into mod.gen.ts
// (tools/codegen set `miri`); this module re-exports them.
//
// PORT:
// - `trait EvalContextExt` (impl for `MiriInterpCx`) is a `declare module` augmentation of `InterpCx` (decision C2). The
//   sibling traits (`sse::EvalContextExt::emulate_x86_sse_intrinsic(this, ..)`, ...) are `InterpCx` methods too, so the
//   dispatch calls them as methods. lib.ts loads the sibling modules; this module does not import them (PORTING §5).
// - Generic `F: Float` fns take the float's `FloatType` dictionary as a trailing `F_` parameter (src/miri/math.ts header).
// - `impl FloatBinOp` is on the companion const (PORTING §8).
// - `u64` lengths and indices are `bigint` (C5), the type `project_index` takes; `u128` values are `bigint`; `u8`..`u32`,
//   `i8`..`i32` are `number`. `simd_size_and_type` and `Size::bits` give `number`s here, always small.
// - `strict_add` / `strict_sub` / `strict_mul` / `strict_div` / `strict_shr` are plain operations where the operands are
//   SIMD lengths, indices or bounded sums, which cannot overflow (u16 sums of at most 8 × 255; lengths at most 64).
// - `*imm` (`Deref` of `ImmTy` to `Immediate`) is `imm.imm`; `imm.to_scalar()` is operator.ts's `imm_to_scalar`.
import { debug_Size, FieldIdx, Size, Size_eq } from "../../../rustc_abi/lib.ts";
import { TyAndLayout_eq } from "../../../rustc_abi/layout/ty.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type Projectable } from "../../../rustc_const_eval/interpret/projection.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Scalar as interp_Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { debug_InterpErrorKind } from "../../../rustc_middle/mir/interpret/error.gen.ts";
import { type BinOp } from "../../../rustc_middle/mir/syntax.ts";
import { debug_TyAndLayout_Ty } from "../../../rustc_middle/ty/layout.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, assert_eq, panic, unreachable } from "../../../std/panic.ts";
import { Err, unwrap_result } from "../../../std/result.ts";
import { Single } from "../../../vendor/rustc_apfloat/ieee.ts";
import { type Float, type FloatType, type Round } from "../../../vendor/rustc_apfloat/lib.ts";
import { bool_to_simd_element } from "../../helpers.ts";
import { type ImmTy, type MPlaceTy, type OpTy, type Scalar } from "../../lib.ts";
import { type MiriInterpCx, type Provenance } from "../../machine.ts";
import { apply_random_float_error, sqrt } from "../../math.ts";
import { imm_to_scalar, MiriImmTy } from "../../operator.ts";
import { EmulateItemResult } from "../../shims/mod.ts";
import * as gen from "./mod.gen.ts";
export * from "./mod.gen.ts";

/** Debug of a `TyAndLayout`, for `assert_eq!`. */
const debug_layout = (v: ImmTy["layout"]): string => debug_TyAndLayout_Ty(v, PLAIN);

/** `u128::checked_shl`. */
function u128_checked_shl(v: bigint, shift: number): bigint | undefined {
  return shift < 128 ? BigInt.asUintN(128, v << BigInt(shift)) : undefined;
}

/** `u128::checked_shr` and `i128::checked_shr` (`>>` on a bigint is logical on non-negative values, arithmetic on negative ones). */
function checked_shr(v: bigint, shift: number): bigint | undefined {
  return shift < 128 ? v >> BigInt(shift) : undefined;
}

/** `u32::try_from(u128).unwrap_or(u32::MAX)` */
function u32_saturating_from(v: bigint): number {
  return v > 0xffff_ffffn ? 0xffff_ffff : Number(v);
}

/** `u64::widening_carryless_mul` */
function u64_widening_carryless_mul(a: bigint, b: bigint): bigint {
  let result = 0n;
  for (let i = 0n; i < 64n; i++) {
    if (((b >> i) & 1n) !== 0n) {
      result ^= a << i;
    }
  }
  return result;
}

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/x86/mod.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/x86/mod.rs:28
    emulate_x86_intrinsic(this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult>;
  }
}

// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:28 emulate_x86_intrinsic
InterpCx.prototype.emulate_x86_intrinsic = function (this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();
  // Prefix should have already been checked.
  const link_name_str = Symbol.as_str(link_name);
  if (!link_name_str.startsWith("llvm.x86.")) return panic("called `Option::unwrap()` on a `None` value");
  const unprefixed_name = link_name_str.slice("llvm.x86.".length);
  const name = unprefixed_name;
  // Used to implement the `_addcarry_u{32, 64}` and the `_subborrow_u{32, 64}` functions.
  // Computes a + b or a - b with input and output carry/borrow. The input carry/borrow is an 8-bit
  // value, which is interpreted as 1 if it is non-zero. The output carry/borrow is an 8-bit value that will be 0 or 1.
  // https://www.intel.com/content/www/us/en/docs/cpp-compiler/developer-guide-reference/2021-8/addcarry-u32-addcarry-u64.html
  // https://www.intel.com/content/www/us/en/docs/cpp-compiler/developer-guide-reference/2021-8/subborrow-u32-subborrow-u64.html
  if (name === "addcarry.32" || name === "addcarry.64" || name === "subborrow.32" || name === "subborrow.64") {
    if (unprefixed_name.endsWith("64") && this_.tcx.deref().sess.target.arch.$ !== "X86_64") {
      return interp_ok(EmulateItemResult.NotSupported);
    }

    const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
    if (c.$ === "Err") return c;
    const [cb_in, a, b] = c._0 as [OpTy, OpTy, OpTy];
    const op: BinOp = unprefixed_name.startsWith("add") ? "AddWithOverflow" : "SubWithOverflow";

    const r = carrying_add(this_, cb_in, a, b, op);
    if (r.$ === "Err") return r;
    const [sum, cb_out] = r._0;
    const f0 = this_.project_field(dest, FieldIdx.ZERO);
    if (f0.$ === "Err") return f0;
    const w0 = this_.write_scalar(cb_out, f0._0);
    if (w0.$ === "Err") return w0;
    const f1 = this_.project_field(dest, FieldIdx.ONE);
    if (f1.$ === "Err") return f1;
    const w1 = this_.write_immediate(sum.imm, f1._0);
    if (w1.$ === "Err") return w1;
  }
  // Used to implement the `_mm_pause` function.
  // The intrinsic is used to hint the processor that the code is in a spin-loop.
  // It is compiled down to a `pause` instruction. When SSE2 is not available,
  // the instruction behaves like a no-op, so it is always safe to call the
  // intrinsic.
  else if (name === "sse2.pause") {
    const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 0);
    if (c.$ === "Err") return c;
    // Only exhibit the spin-loop hint behavior when SSE2 is enabled.
    if (this_.tcx.deref().sess.internal_target_features.has(Symbol.intern("sse2"))) {
      this_.yield_active_thread();
    }
  } else if (name === "pclmulqdq" || name === "pclmulqdq.256" || name === "pclmulqdq.512") {
    let len = 2n; // in units of 64bits
    const e0 = this_.expect_target_feature_for_intrinsic(link_name, "pclmulqdq");
    if (e0.$ === "Err") return e0;
    if (unprefixed_name.endsWith(".256")) {
      const e1 = this_.expect_target_feature_for_intrinsic(link_name, "vpclmulqdq");
      if (e1.$ === "Err") return e1;
      len = 4n;
    } else if (unprefixed_name.endsWith(".512")) {
      const e1 = this_.expect_target_feature_for_intrinsic(link_name, "vpclmulqdq");
      if (e1.$ === "Err") return e1;
      const e2 = this_.expect_target_feature_for_intrinsic(link_name, "avx512f");
      if (e2.$ === "Err") return e2;
      len = 8n;
    }

    const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
    if (c.$ === "Err") return c;
    const [left, right, imm] = c._0 as [OpTy, OpTy, OpTy];

    const r = pclmulqdq(this_, left, right, imm, dest, len);
    if (r.$ === "Err") return r;
  } else if (name.startsWith("bmi.")) {
    return this_.emulate_x86_bmi_intrinsic(link_name, args, dest);
  }
  // The GFNI extension does not get its own namespace.
  // Check for instruction names instead.
  else if (name.startsWith("vgf2p8affine") || name.startsWith("vgf2p8mulb")) {
    return this_.emulate_x86_gfni_intrinsic(link_name, args, dest);
  } else if (name.startsWith("sha")) {
    return this_.emulate_x86_sha_intrinsic(link_name, args, dest);
  } else if (name.startsWith("sse.")) {
    return this_.emulate_x86_sse_intrinsic(link_name, args, dest);
  } else if (name.startsWith("sse2.")) {
    return this_.emulate_x86_sse2_intrinsic(link_name, args, dest);
  } else if (name.startsWith("sse3.")) {
    return this_.emulate_x86_sse3_intrinsic(link_name, args, dest);
  } else if (name.startsWith("ssse3.")) {
    return this_.emulate_x86_ssse3_intrinsic(link_name, args, dest);
  } else if (name.startsWith("sse41.")) {
    return this_.emulate_x86_sse41_intrinsic(link_name, args, dest);
  } else if (name.startsWith("sse42.")) {
    return this_.emulate_x86_sse42_intrinsic(link_name, args, dest);
  } else if (name.startsWith("aesni.")) {
    return this_.emulate_x86_aesni_intrinsic(link_name, args, dest);
  } else if (name.startsWith("avx.")) {
    return this_.emulate_x86_avx_intrinsic(link_name, args, dest);
  } else if (name.startsWith("avx2.")) {
    return this_.emulate_x86_avx2_intrinsic(link_name, args, dest);
  } else if (name.startsWith("avx512.")) {
    return this_.emulate_x86_avx512_intrinsic(link_name, args, dest);
  } else {
    return interp_ok(EmulateItemResult.NotSupported);
  }
  return interp_ok(EmulateItemResult.NeedsReturn);
};

interface FloatBinOp_methods {
  cmp_from_imm(ecx: MiriInterpCx, imm: number, intrinsic: Symbol): InterpResult<gen.FloatBinOp>;
}

export type FloatBinOp = gen.FloatBinOp;
export const FloatBinOp = gen.FloatBinOp as typeof gen.FloatBinOp & FloatBinOp_methods;

/// Convert from the `imm` argument used to specify the comparison
/// operation in intrinsics such as `llvm.x86.sse.cmp.ss`.
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:199 cmp_from_imm
FloatBinOp.cmp_from_imm = function (ecx: MiriInterpCx, imm: number, intrinsic: Symbol): InterpResult<gen.FloatBinOp> {
  // Only bits 0..=4 are used, remaining should be zero.
  if ((imm & ~0b1_1111) !== 0) {
    // PORT: `{imm:x}` of an `i8` prints its two's-complement bits.
    return panic(`invalid \`imm\` parameter of ${Symbol.as_str(intrinsic)}: 0x${(imm & 0xff).toString(16)}`);
  }
  // Bit 4 specifies whether the operation is quiet or signaling, which
  // we do not care in Miri.
  // Bits 0..=2 specifies the operation.
  // `gt` indicates the result to be returned when the LHS is strictly
  // greater than the RHS, and so on.
  let gt: boolean;
  let lt: boolean;
  let eq: boolean;
  let unord: boolean;
  switch (imm & 0b111) {
    // Equal
    case 0x0:
      [gt, lt, eq, unord] = [false, false, true, false];
      break;
    // Less-than
    case 0x1:
      [gt, lt, eq, unord] = [false, true, false, false];
      break;
    // Less-or-equal
    case 0x2:
      [gt, lt, eq, unord] = [false, true, true, false];
      break;
    // Unordered (either is NaN)
    case 0x3:
      [gt, lt, eq, unord] = [false, false, false, true];
      break;
    // Not equal
    case 0x4:
      [gt, lt, eq, unord] = [true, true, false, true];
      break;
    // Not less-than
    case 0x5:
      [gt, lt, eq, unord] = [true, false, true, true];
      break;
    // Not less-or-equal
    case 0x6:
      [gt, lt, eq, unord] = [true, false, false, true];
      break;
    // Ordered (neither is NaN)
    case 0x7:
      [gt, lt, eq, unord] = [true, true, true, false];
      break;
    default:
      return unreachable();
  }
  // When bit 3 is 1 (only possible in AVX), unord is toggled.
  if ((imm & 0b1000) !== 0) {
    const e = ecx.expect_target_feature_for_intrinsic(intrinsic, "avx");
    if (e.$ === "Err") return e;
    unord = !unord;
  }
  return interp_ok({ $: "Cmp", gt, lt, eq, unord });
};

/// Performs `which` scalar operation on `left` and `right` and returns
/// the result.
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:243 bin_op_float
export function bin_op_float<F extends Float<F>>(which: FloatBinOp, left: ImmTy, right: ImmTy, F_: FloatType<F>): InterpResult<Scalar> {
  switch (which.$) {
    case "Cmp": {
      const { gt, lt, eq, unord } = which;
      const left_r = interp_Scalar.to_float(imm_to_scalar(left), F_);
      if (left_r.$ === "Err") return left_r;
      const right_r = interp_Scalar.to_float(imm_to_scalar(right), F_);
      if (right_r.$ === "Err") return right_r;

      let res: boolean;
      switch (left_r._0.partial_cmp(right_r._0)) {
        case undefined:
          res = unord;
          break;
        case -1:
          res = lt;
          break;
        case 0:
          res = eq;
          break;
        case 1:
          res = gt;
          break;
      }
      return interp_ok(bool_to_simd_element(res, Size.from_bits(F_.BITS)));
    }
    case "Min": {
      const left_scalar = imm_to_scalar(left);
      const left_r = interp_Scalar.to_float(left_scalar, F_);
      if (left_r.$ === "Err") return left_r;
      const right_scalar = imm_to_scalar(right);
      const right_r = interp_Scalar.to_float(right_scalar, F_);
      if (right_r.$ === "Err") return right_r;
      const left_f = left_r._0;
      const right_f = right_r._0;
      // SSE semantics to handle zero and NaN. Note that `x == F::ZERO`
      // is true when `x` is either +0 or -0.
      const cmp = left_f.partial_cmp(right_f);
      if ((left_f.eq(F_.ZERO) && right_f.eq(F_.ZERO)) || left_f.is_nan() || right_f.is_nan() || cmp === 1 || cmp === 0) {
        return interp_ok(right_scalar);
      } else {
        return interp_ok(left_scalar);
      }
    }
    case "Max": {
      const left_scalar = imm_to_scalar(left);
      const left_r = interp_Scalar.to_float(left_scalar, F_);
      if (left_r.$ === "Err") return left_r;
      const right_scalar = imm_to_scalar(right);
      const right_r = interp_Scalar.to_float(right_scalar, F_);
      if (right_r.$ === "Err") return right_r;
      const left_f = left_r._0;
      const right_f = right_r._0;
      // SSE semantics to handle zero and NaN. Note that `x == F::ZERO`
      // is true when `x` is either +0 or -0.
      const cmp = left_f.partial_cmp(right_f);
      if ((left_f.eq(F_.ZERO) && right_f.eq(F_.ZERO)) || left_f.is_nan() || right_f.is_nan() || cmp === -1 || cmp === 0) {
        return interp_ok(right_scalar);
      } else {
        return interp_ok(left_scalar);
      }
    }
  }
}

/// Performs `which` operation on the first component of `left` and `right`
/// and copies the other components from `left`. The result is stored in `dest`.
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:300 bin_op_simd_float_first
export function bin_op_simd_float_first<F extends Float<F>>(ecx: MiriInterpCx, which: FloatBinOp, left: OpTy, right: OpTy, dest: MPlaceTy, F_: FloatType<F>): InterpResult {
  const left_s = ecx.project_to_simd(left);
  if (left_s.$ === "Err") return left_s;
  const [left_v, left_len] = left_s._0;
  const right_s = ecx.project_to_simd(right);
  if (right_s.$ === "Err") return right_s;
  const [right_v, right_len] = right_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  assert_eq(dest_len, left_len, String);
  assert_eq(dest_len, right_len, String);

  const l0 = ecx.project_index(left_v, 0n);
  if (l0.$ === "Err") return l0;
  const l0_i = ecx.read_immediate(l0._0);
  if (l0_i.$ === "Err") return l0_i;
  const r0 = ecx.project_index(right_v, 0n);
  if (r0.$ === "Err") return r0;
  const r0_i = ecx.read_immediate(r0._0);
  if (r0_i.$ === "Err") return r0_i;
  const res0 = bin_op_float(which, l0_i._0, r0_i._0, F_);
  if (res0.$ === "Err") return res0;
  const d0 = ecx.project_index(dest_v, 0n);
  if (d0.$ === "Err") return d0;
  const w0 = ecx.write_scalar(res0._0, d0._0);
  if (w0.$ === "Err") return w0;

  for (let i = 1n; i < dest_len; i++) {
    const l = ecx.project_index(left_v, i);
    if (l.$ === "Err") return l;
    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;
    const c = ecx.copy_op(l._0, d._0);
    if (c.$ === "Err") return c;
  }

  return interp_ok(undefined);
}

/// Performs `which` operation on each component of `left` and
/// `right`, storing the result is stored in `dest`.
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:330 bin_op_simd_float_all
export function bin_op_simd_float_all<F extends Float<F>>(ecx: MiriInterpCx, which: FloatBinOp, left: OpTy, right: OpTy, dest: MPlaceTy, F_: FloatType<F>): InterpResult {
  const left_s = ecx.project_to_simd(left);
  if (left_s.$ === "Err") return left_s;
  const [left_v, left_len] = left_s._0;
  const right_s = ecx.project_to_simd(right);
  if (right_s.$ === "Err") return right_s;
  const [right_v, right_len] = right_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  assert_eq(dest_len, left_len, String);
  assert_eq(dest_len, right_len, String);

  for (let i = 0n; i < dest_len; i++) {
    const l = ecx.project_index(left_v, i);
    if (l.$ === "Err") return l;
    const l_i = ecx.read_immediate(l._0);
    if (l_i.$ === "Err") return l_i;
    const r = ecx.project_index(right_v, i);
    if (r.$ === "Err") return r;
    const r_i = ecx.read_immediate(r._0);
    if (r_i.$ === "Err") return r_i;
    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;

    const res = bin_op_float(which, l_i._0, r_i._0, F_);
    if (res.$ === "Err") return res;
    const w = ecx.write_scalar(res._0, d._0);
    if (w.$ === "Err") return w;
  }

  return interp_ok(undefined);
}

/// Performs `which` scalar operation on `op` and returns the result.
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:371 unary_op_f32
export function unary_op_f32(ecx: MiriInterpCx, which: gen.FloatUnaryOp, op: ImmTy): InterpResult<Scalar> {
  switch (which) {
    case "Rcp": {
      const op_r = interp_Scalar.to_f32(imm_to_scalar(op));
      if (op_r.$ === "Err") return op_r;
      const div = Single.from_u128(1n).value.div(op_r._0).value;
      // Apply a relative error with a magnitude on the order of 2^-12 to simulate the
      // inaccuracy of RCP.
      const res = apply_random_float_error(ecx, div, -12);
      return interp_ok(interp_Scalar.from_f32(res));
    }
    case "Rsqrt": {
      const op_r = interp_Scalar.to_f32(imm_to_scalar(op));
      if (op_r.$ === "Err") return op_r;
      const rsqrt = Single.from_u128(1n).value.div(sqrt(op_r._0)).value;
      // Apply a relative error with a magnitude on the order of 2^-12 to simulate the
      // inaccuracy of RSQRT.
      const res = apply_random_float_error(ecx, rsqrt, -12);
      return interp_ok(interp_Scalar.from_f32(res));
    }
  }
}

/// Performs `which` operation on the first component of `op` and copies
/// the other components. The result is stored in `dest`.
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:398 unary_op_ss
export function unary_op_ss(ecx: MiriInterpCx, which: gen.FloatUnaryOp, op: OpTy, dest: MPlaceTy): InterpResult {
  const op_s = ecx.project_to_simd(op);
  if (op_s.$ === "Err") return op_s;
  const [op_v, op_len] = op_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  assert_eq(dest_len, op_len, String);

  const o0 = ecx.project_index(op_v, 0n);
  if (o0.$ === "Err") return o0;
  const o0_i = ecx.read_immediate(o0._0);
  if (o0_i.$ === "Err") return o0_i;
  const res0 = unary_op_f32(ecx, which, o0_i._0);
  if (res0.$ === "Err") return res0;
  const d0 = ecx.project_index(dest_v, 0n);
  if (d0.$ === "Err") return d0;
  const w0 = ecx.write_scalar(res0._0, d0._0);
  if (w0.$ === "Err") return w0;

  for (let i = 1n; i < dest_len; i++) {
    const o = ecx.project_index(op_v, i);
    if (o.$ === "Err") return o;
    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;
    const c = ecx.copy_op(o._0, d._0);
    if (c.$ === "Err") return c;
  }

  return interp_ok(undefined);
}

/// Performs `which` operation on each component of `op`, storing the
/// result is stored in `dest`.
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:421 unary_op_ps
export function unary_op_ps(ecx: MiriInterpCx, which: gen.FloatUnaryOp, op: OpTy, dest: MPlaceTy): InterpResult {
  const op_s = ecx.project_to_simd(op);
  if (op_s.$ === "Err") return op_s;
  const [op_v, op_len] = op_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  assert_eq(dest_len, op_len, String);

  for (let i = 0n; i < dest_len; i++) {
    const o = ecx.project_index(op_v, i);
    if (o.$ === "Err") return o;
    const o_i = ecx.read_immediate(o._0);
    if (o_i.$ === "Err") return o_i;
    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;

    const res = unary_op_f32(ecx, which, o_i._0);
    if (res.$ === "Err") return res;
    const w = ecx.write_scalar(res._0, d._0);
    if (w.$ === "Err") return w;
  }

  return interp_ok(undefined);
}

/// Shifts each element of `left` by a scalar amount. The shift amount
/// is determined by the lowest 64 bits of `right` (which is a 128-bit vector).
///
/// For logic shifts, when right is larger than BITS - 1, zero is produced.
/// For arithmetic right-shifts, when right is larger than BITS - 1, the sign
/// bit is copied to all bits.
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:458 shift_simd_by_scalar
export function shift_simd_by_scalar(ecx: MiriInterpCx, left: OpTy, right: OpTy, which: gen.ShiftOp, dest: MPlaceTy): InterpResult {
  const left_s = ecx.project_to_simd(left);
  if (left_s.$ === "Err") return left_s;
  const [left_v, left_len] = left_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  assert_eq(dest_len, left_len, String);
  // `right` may have a different length, and we only care about its
  // lowest 64bit anyway.

  // Get the 64-bit shift operand and convert it to the type expected
  // by checked_{shl,shr} (u32).
  // It is ok to saturate the value to u32::MAX because any value
  // above BITS - 1 will produce the same result.
  const first = extract_first_u64(ecx, right);
  if (first.$ === "Err") return first;
  const shift = u32_saturating_from(first._0);

  for (let i = 0n; i < dest_len; i++) {
    const l = ecx.project_index(left_v, i);
    if (l.$ === "Err") return l;
    const left_r = ecx.read_scalar(l._0);
    if (left_r.$ === "Err") return left_r;
    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;
    const dest_i = d._0;

    let res: Scalar;
    switch (which) {
      case "Left": {
        const left_u = interp_Scalar.to_uint(left_r._0, dest_i.layout.size);
        if (left_u.$ === "Err") return left_u;
        const res_u = u128_checked_shl(left_u._0, shift) ?? 0n;
        // `truncate` is needed as left-shift can make the absolute value larger.
        res = interp_Scalar.from_uint(dest_i.layout.size.truncate(res_u), dest_i.layout.size);
        break;
      }
      case "RightLogic": {
        const left_u = interp_Scalar.to_uint(left_r._0, dest_i.layout.size);
        if (left_u.$ === "Err") return left_u;
        const res_u = checked_shr(left_u._0, shift) ?? 0n;
        // No `truncate` needed as right-shift can only make the absolute value smaller.
        res = interp_Scalar.from_uint(res_u, dest_i.layout.size);
        break;
      }
      case "RightArith": {
        const left_i = interp_Scalar.to_int(left_r._0, dest_i.layout.size);
        if (left_i.$ === "Err") return left_i;
        // On overflow, copy the sign bit to the remaining bits
        const res_i = checked_shr(left_i._0, shift) ?? left_i._0 >> 127n;
        // No `truncate` needed as right-shift can only make the absolute value smaller.
        res = interp_Scalar.from_int(res_i, dest_i.layout.size);
        break;
      }
    }
    const w = ecx.write_scalar(res, dest_i);
    if (w.$ === "Err") return w;
  }

  return interp_ok(undefined);
}

// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:509 shift_simd_by_simd
export function shift_simd_by_simd(ecx: MiriInterpCx, left: OpTy, right: OpTy, which: gen.ShiftOp, dest: MPlaceTy): InterpResult {
  const left_s = ecx.project_to_simd(left);
  if (left_s.$ === "Err") return left_s;
  const [left_v, left_len] = left_s._0;
  const right_s = ecx.project_to_simd(right);
  if (right_s.$ === "Err") return right_s;
  const [right_v, right_len] = right_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  assert_eq(dest_len, left_len, String);
  assert_eq(dest_len, right_len, String);

  for (let i = 0n; i < dest_len; i++) {
    const l = ecx.project_index(left_v, i);
    if (l.$ === "Err") return l;
    const left_r = ecx.read_scalar(l._0);
    if (left_r.$ === "Err") return left_r;
    const r = ecx.project_index(right_v, i);
    if (r.$ === "Err") return r;
    const right_r = ecx.read_scalar(r._0);
    if (right_r.$ === "Err") return right_r;
    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;
    const dest_i = d._0;

    // It is ok to saturate the value to u32::MAX because any value
    // above BITS - 1 will produce the same result.
    const shift_u = interp_Scalar.to_uint(right_r._0, dest_i.layout.size);
    if (shift_u.$ === "Err") return shift_u;
    const shift = u32_saturating_from(shift_u._0);

    let res: Scalar;
    switch (which) {
      case "Left": {
        const left_u = interp_Scalar.to_uint(left_r._0, dest_i.layout.size);
        if (left_u.$ === "Err") return left_u;
        const res_u = u128_checked_shl(left_u._0, shift) ?? 0n;
        // `truncate` is needed as left-shift can make the absolute value larger.
        res = interp_Scalar.from_uint(dest_i.layout.size.truncate(res_u), dest_i.layout.size);
        break;
      }
      case "RightLogic": {
        const left_u = interp_Scalar.to_uint(left_r._0, dest_i.layout.size);
        if (left_u.$ === "Err") return left_u;
        const res_u = checked_shr(left_u._0, shift) ?? 0n;
        // No `truncate` needed as right-shift can only make the absolute value smaller.
        res = interp_Scalar.from_uint(res_u, dest_i.layout.size);
        break;
      }
      case "RightArith": {
        const left_i = interp_Scalar.to_int(left_r._0, dest_i.layout.size);
        if (left_i.$ === "Err") return left_i;
        // On overflow, copy the sign bit to the remaining bits
        const res_i = checked_shr(left_i._0, shift) ?? left_i._0 >> 127n;
        // No `truncate` needed as right-shift can only make the absolute value smaller.
        res = interp_Scalar.from_int(res_i, dest_i.layout.size);
        break;
      }
    }
    const w = ecx.write_scalar(res, dest_i);
    if (w.$ === "Err") return w;
  }

  return interp_ok(undefined);
}

/// Takes a 128-bit vector, transmutes it to `[u64; 2]` and extracts
/// the first value.
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:561 extract_first_u64
export function extract_first_u64(ecx: MiriInterpCx, op: OpTy): InterpResult<bigint> {
  // Transmute vector to `[u64; 2]`
  const array_layout = ecx.layout_of(Ty.new_array(ecx.tcx.deref(), ecx.tcx.deref().types.u64, 2));
  if (array_layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(array_layout._0));
  const op_t = op.transmute(array_layout._0, ecx);
  if (op_t.$ === "Err") return op_t;

  // Get the first u64 from the array
  const p = ecx.project_index(op_t._0, 0n);
  if (p.$ === "Err") return p;
  const s = ecx.read_scalar(p._0);
  if (s.$ === "Err") return s;
  return interp_Scalar.to_u64(s._0);
}

// Rounds the first element of `right` according to `rounding`
// and copies the remaining elements from `left`.
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:575 round_first
export function round_first<F extends Float<F>>(ecx: MiriInterpCx, left: OpTy, right: OpTy, rounding: OpTy, dest: MPlaceTy, F_: FloatType<F>): InterpResult {
  const left_s = ecx.project_to_simd(left);
  if (left_s.$ === "Err") return left_s;
  const [left_v, left_len] = left_s._0;
  const right_s = ecx.project_to_simd(right);
  if (right_s.$ === "Err") return right_s;
  const [right_v, right_len] = right_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  assert_eq(dest_len, left_len, String);
  assert_eq(dest_len, right_len, String);

  const rounding_s = ecx.read_scalar(rounding);
  if (rounding_s.$ === "Err") return rounding_s;
  const rounding_i = interp_Scalar.to_i32(rounding_s._0);
  if (rounding_i.$ === "Err") return rounding_i;
  const rounding_r = rounding_from_imm(rounding_i._0);
  if (rounding_r.$ === "Err") return rounding_r;

  const r0 = ecx.project_index(right_v, 0n);
  if (r0.$ === "Err") return r0;
  const r0_s = ecx.read_scalar(r0._0);
  if (r0_s.$ === "Err") return r0_s;
  const op0 = interp_Scalar.to_float(r0_s._0, F_);
  if (op0.$ === "Err") return op0;
  const res = op0._0.round_to_integral(rounding_r._0).value;
  const d0 = ecx.project_index(dest_v, 0n);
  if (d0.$ === "Err") return d0;
  const w0 = ecx.write_scalar(interp_Scalar.from_uint(res.to_bits(), Size.from_bits(F_.BITS)), d0._0);
  if (w0.$ === "Err") return w0;

  for (let i = 1n; i < dest_len; i++) {
    const l = ecx.project_index(left_v, i);
    if (l.$ === "Err") return l;
    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;
    const c = ecx.copy_op(l._0, d._0);
    if (c.$ === "Err") return c;
  }

  return interp_ok(undefined);
}

// Rounds all elements of `op` according to `rounding`.
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:606 round_all
export function round_all<F extends Float<F>>(ecx: MiriInterpCx, op: OpTy, rounding: OpTy, dest: MPlaceTy, F_: FloatType<F>): InterpResult {
  const op_s = ecx.project_to_simd(op);
  if (op_s.$ === "Err") return op_s;
  const [op_v, op_len] = op_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  assert_eq(dest_len, op_len, String);

  const rounding_s = ecx.read_scalar(rounding);
  if (rounding_s.$ === "Err") return rounding_s;
  const rounding_i = interp_Scalar.to_i32(rounding_s._0);
  if (rounding_i.$ === "Err") return rounding_i;
  const rounding_r = rounding_from_imm(rounding_i._0);
  if (rounding_r.$ === "Err") return rounding_r;

  for (let i = 0n; i < dest_len; i++) {
    const o = ecx.project_index(op_v, i);
    if (o.$ === "Err") return o;
    const o_s = ecx.read_scalar(o._0);
    if (o_s.$ === "Err") return o_s;
    const op_f = interp_Scalar.to_float(o_s._0, F_);
    if (op_f.$ === "Err") return op_f;
    const res = op_f._0.round_to_integral(rounding_r._0).value;
    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;
    const w = ecx.write_scalar(interp_Scalar.from_uint(res.to_bits(), Size.from_bits(F_.BITS)), d._0);
    if (w.$ === "Err") return w;
  }

  return interp_ok(undefined);
}

/// Gets equivalent `rustc_apfloat::Round` from rounding mode immediate of
/// `round.{ss,sd,ps,pd}` intrinsics.
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:633 rounding_from_imm
export function rounding_from_imm(rounding: number): InterpResult<Round> {
  // The fourth bit of `rounding` only affects the SSE status
  // register, which cannot be accessed from Miri (or from Rust,
  // for that matter), so we can ignore it.
  const masked = rounding & ~0b1000;
  switch (masked) {
    // When the third bit is 0, the rounding mode is determined by the
    // first two bits.
    case 0b000:
      return interp_ok("NearestTiesToEven");
    case 0b001:
      return interp_ok("TowardNegative");
    case 0b010:
      return interp_ok("TowardPositive");
    case 0b011:
      return interp_ok("TowardZero");
    // When the third bit is 1, the rounding mode is determined by the
    // SSE status register. Since we do not support modifying it from
    // Miri (or Rust), we assume it to be at its default mode (round-to-nearest).
    case 0b100:
    case 0b101:
    case 0b110:
    case 0b111:
      return interp_ok("NearestTiesToEven");
    default:
      // PORT: `{rounding:02x}` of an `i32` prints its two's-complement bits.
      return panic(`invalid rounding mode 0x${(masked >>> 0).toString(16).padStart(2, "0")}`);
  }
}

/// Converts each element of `op` from floating point to signed integer.
///
/// When the input value is NaN or out of range, fall back to minimum value.
///
/// If `op` has more elements than `dest`, extra elements are ignored. If `op`
/// has less elements than `dest`, the rest is filled with zeros.
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:658 convert_float_to_int
export function convert_float_to_int(ecx: MiriInterpCx, op: OpTy, rnd: Round, dest: MPlaceTy): InterpResult {
  const op_s = ecx.project_to_simd(op);
  if (op_s.$ === "Err") return op_s;
  const [op_v, op_len] = op_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  // Output must be *signed* integers.
  assert(dest_v.layout.field(ecx, 0).ty.kind().$ === "Int", "assertion failed: matches!(dest.layout.field(ecx, 0).ty.kind(), ty::Int(_))");

  const min_len = op_len < dest_len ? op_len : dest_len;
  for (let i = 0n; i < min_len; i++) {
    const o = ecx.project_index(op_v, i);
    if (o.$ === "Err") return o;
    const o_i = ecx.read_immediate(o._0);
    if (o_i.$ === "Err") return o_i;
    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;
    const dest_i = d._0;

    const res_r = ecx.float_to_int_checked(o_i._0, dest_i.layout, rnd);
    if (res_r.$ === "Err") return res_r;
    // Fallback to minimum according to SSE/AVX semantics.
    const res = res_r._0 ?? MiriImmTy.from_int(dest_i.layout.size.signed_int_min(), dest_i.layout);
    const w = ecx.write_immediate(res.imm, dest_i);
    if (w.$ === "Err") return w;
  }
  // Fill remainder with zeros
  for (let i = op_len; i < dest_len; i++) {
    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;
    const dest_i = d._0;
    const w = ecx.write_scalar(interp_Scalar.from_int(0n, dest_i.layout.size), dest_i);
    if (w.$ === "Err") return w;
  }

  return interp_ok(undefined);
}

/// Splits `op` (which must be a SIMD vector) into 128-bit chunks.
///
/// Returns a tuple where:
/// * The first element is the number of 128-bit chunks (let's call it `N`).
/// * The second element is the number of elements per chunk (let's call it `M`).
/// * The third element is the `op` vector split into chunks, i.e, it's
///   type is `[[T; M]; N]` where `T` is the element type of `op`.
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:696 split_simd_to_128bit_chunks
export function split_simd_to_128bit_chunks<P extends Projectable<P, Provenance>>(ecx: MiriInterpCx, op: P): InterpResult<[bigint, bigint, P]> {
  const simd_layout = op.layout_();
  const [simd_len, element_ty] = simd_layout.ty.simd_size_and_type(ecx.tcx.deref());

  assert_eq(simd_layout.size.bits() % 128, 0, String);
  const num_chunks = Math.trunc(simd_layout.size.bits() / 128);
  const items_per_chunk = Math.trunc(simd_len / num_chunks);

  // Transmute to `[[T; items_per_chunk]; num_chunks]`
  const chunked_layout = unwrap_result(ecx.layout_of(Ty.new_array(ecx.tcx.deref(), Ty.new_array(ecx.tcx.deref(), element_ty, items_per_chunk), num_chunks)), debug_InterpErrorKind);
  const chunked_op = op.transmute(chunked_layout, ecx);
  if (chunked_op.$ === "Err") return chunked_op;

  return interp_ok([BigInt(num_chunks), BigInt(items_per_chunk), chunked_op._0]);
}

/// Conditionally multiplies the packed floating-point elements in
/// `left` and `right` using the high 4 bits in `imm`, sums the calculated
/// products (up to 4), and conditionally stores the sum in `dest` using
/// the low 4 bits of `imm`.
///
/// Each 128-bit chunk is treated independently (i.e., the value for
/// the is i-th 128-bit chunk of `dest` is calculated with the i-th
/// 128-bit blocks of `left` and `right`).
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:728 conditional_dot_product
export function conditional_dot_product(ecx: MiriInterpCx, left: OpTy, right: OpTy, imm: OpTy, dest: MPlaceTy): InterpResult {
  assert_eq(left.layout, dest.layout, debug_layout, TyAndLayout_eq);
  assert_eq(right.layout, dest.layout, debug_layout, TyAndLayout_eq);

  const left_s = split_simd_to_128bit_chunks(ecx, left);
  if (left_s.$ === "Err") return left_s;
  const [num_chunks, items_per_chunk, left_c] = left_s._0;
  const right_s = split_simd_to_128bit_chunks(ecx, right);
  if (right_s.$ === "Err") return right_s;
  const [, , right_c] = right_s._0;
  const dest_s = split_simd_to_128bit_chunks(ecx, dest);
  if (dest_s.$ === "Err") return dest_s;
  const [, , dest_c] = dest_s._0;

  const element_layout = left_c.layout.field(ecx, 0).field(ecx, 0);
  assert(items_per_chunk <= 4n, "assertion failed: items_per_chunk <= 4");

  // `imm` is a `u8` for SSE4.1 or an `i32` for AVX :/
  const imm_s = ecx.read_scalar(imm);
  if (imm_s.$ === "Err") return imm_s;
  const imm_r = interp_Scalar.to_uint(imm_s._0, imm.layout.size);
  if (imm_r.$ === "Err") return imm_r;
  const imm_u = imm_r._0;

  for (let i = 0n; i < num_chunks; i++) {
    const left_i = ecx.project_index(left_c, i);
    if (left_i.$ === "Err") return left_i;
    const right_i = ecx.project_index(right_c, i);
    if (right_i.$ === "Err") return right_i;
    const dest_i = ecx.project_index(dest_c, i);
    if (dest_i.$ === "Err") return dest_i;

    // Calculate dot product
    // Elements are floating point numbers, but we can use `from_int`
    // for the initial value because the representation of 0.0 is all zero bits.
    let sum = MiriImmTy.from_int(0n, element_layout);
    for (let j = 0n; j < items_per_chunk; j++) {
      if ((imm_u & (1n << (j + 4n))) !== 0n) {
        const l = ecx.project_index(left_i._0, j);
        if (l.$ === "Err") return l;
        const l_i = ecx.read_immediate(l._0);
        if (l_i.$ === "Err") return l_i;
        const r = ecx.project_index(right_i._0, j);
        if (r.$ === "Err") return r;
        const r_i = ecx.read_immediate(r._0);
        if (r_i.$ === "Err") return r_i;

        const mul = ecx.binary_op("Mul", l_i._0, r_i._0);
        if (mul.$ === "Err") return mul;
        const add = ecx.binary_op("Add", sum, mul._0);
        if (add.$ === "Err") return add;
        sum = add._0;
      }
    }

    // Write to destination (conditioned to imm)
    for (let j = 0n; j < items_per_chunk; j++) {
      const d = ecx.project_index(dest_i._0, j);
      if (d.$ === "Err") return d;

      if ((imm_u & (1n << j)) !== 0n) {
        const w = ecx.write_immediate(sum.imm, d._0);
        if (w.$ === "Err") return w;
      } else {
        const w = ecx.write_scalar(interp_Scalar.from_int(0n, element_layout.size), d._0);
        if (w.$ === "Err") return w;
      }
    }
  }

  return interp_ok(undefined);
}

/// Calculates two booleans.
///
/// The first is true when all the bits of `op & mask` are zero.
/// The second is true when `(op & mask) == mask`
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:786 test_bits_masked
export function test_bits_masked(ecx: MiriInterpCx, op: OpTy, mask: OpTy): InterpResult<[boolean, boolean]> {
  assert_eq(op.layout, mask.layout, debug_layout, TyAndLayout_eq);

  const op_s = ecx.project_to_simd(op);
  if (op_s.$ === "Err") return op_s;
  const [op_v, op_len] = op_s._0;
  const mask_s = ecx.project_to_simd(mask);
  if (mask_s.$ === "Err") return mask_s;
  const [mask_v, mask_len] = mask_s._0;

  assert_eq(op_len, mask_len, String);

  let all_zero = true;
  let masked_set = true;
  for (let i = 0n; i < op_len; i++) {
    const o = ecx.project_index(op_v, i);
    if (o.$ === "Err") return o;
    const m = ecx.project_index(mask_v, i);
    if (m.$ === "Err") return m;

    const o_s = ecx.read_scalar(o._0);
    if (o_s.$ === "Err") return o_s;
    const o_u = interp_Scalar.to_uint(o_s._0, o._0.layout.size);
    if (o_u.$ === "Err") return o_u;
    const m_s = ecx.read_scalar(m._0);
    if (m_s.$ === "Err") return m_s;
    const m_u = interp_Scalar.to_uint(m_s._0, m._0.layout.size);
    if (m_u.$ === "Err") return m_u;
    all_zero &&= (o_u._0 & m_u._0) === 0n;
    masked_set &&= (o_u._0 & m_u._0) === m_u._0;
  }

  return interp_ok([all_zero, masked_set]);
}

/// Calculates two booleans.
///
/// The first is true when the highest bit of each element of `op & mask` is zero.
/// The second is true when the highest bit of each element of `!op & mask` is zero.
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:817 test_high_bits_masked
export function test_high_bits_masked(ecx: MiriInterpCx, op: OpTy, mask: OpTy): InterpResult<[boolean, boolean]> {
  assert_eq(op.layout, mask.layout, debug_layout, TyAndLayout_eq);

  const op_s = ecx.project_to_simd(op);
  if (op_s.$ === "Err") return op_s;
  const [op_v, op_len] = op_s._0;
  const mask_s = ecx.project_to_simd(mask);
  if (mask_s.$ === "Err") return mask_s;
  const [mask_v, mask_len] = mask_s._0;

  assert_eq(op_len, mask_len, String);

  const high_bit_offset = BigInt(op_v.layout.field(ecx, 0).size.bits() - 1);

  let direct = true;
  let negated = true;
  for (let i = 0n; i < op_len; i++) {
    const o = ecx.project_index(op_v, i);
    if (o.$ === "Err") return o;
    const m = ecx.project_index(mask_v, i);
    if (m.$ === "Err") return m;

    const o_s = ecx.read_scalar(o._0);
    if (o_s.$ === "Err") return o_s;
    const o_u = interp_Scalar.to_uint(o_s._0, o._0.layout.size);
    if (o_u.$ === "Err") return o_u;
    const m_s = ecx.read_scalar(m._0);
    if (m_s.$ === "Err") return m_s;
    const m_u = interp_Scalar.to_uint(m_s._0, m._0.layout.size);
    if (m_u.$ === "Err") return m_u;
    direct &&= (o_u._0 & m_u._0) >> high_bit_offset === 0n;
    // PORT: `!op` on a u128; a bigint's `~` is infinite two's complement, and `& mask` makes the result the same.
    negated &&= (~o_u._0 & m_u._0) >> high_bit_offset === 0n;
  }

  return interp_ok([direct, negated]);
}

/// Compute the sum of absolute differences of quadruplets of unsigned
/// 8-bit integers in `left` and `right`, and store the 16-bit results
/// in `right`. Quadruplets are selected from `left` and `right` with
/// offsets specified in `imm`.
///
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm_maddubs_epi16>
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm256_mpsadbw_epu8>
///
/// Each 128-bit chunk is treated independently (i.e., the value for
/// the is i-th 128-bit chunk of `dest` is calculated with the i-th
/// 128-bit chunks of `left` and `right`).
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:857 mpsadbw
export function mpsadbw(ecx: MiriInterpCx, left: OpTy, right: OpTy, imm: OpTy, dest: MPlaceTy): InterpResult {
  assert_eq(left.layout, right.layout, debug_layout, TyAndLayout_eq);
  assert_eq(left.layout.size, dest.layout.size, (v) => debug_Size(v, PLAIN), Size_eq);

  const left_s = split_simd_to_128bit_chunks(ecx, left);
  if (left_s.$ === "Err") return left_s;
  const [num_chunks, op_items_per_chunk, left_c] = left_s._0;
  assert(num_chunks <= 2n, "assertion failed: num_chunks <= 2");

  const right_s = split_simd_to_128bit_chunks(ecx, right);
  if (right_s.$ === "Err") return right_s;
  const [, , right_c] = right_s._0;
  const dest_s = split_simd_to_128bit_chunks(ecx, dest);
  if (dest_s.$ === "Err") return dest_s;
  const [, dest_items_per_chunk, dest_c] = dest_s._0;

  assert_eq(op_items_per_chunk, dest_items_per_chunk * 2n, String);

  const imm_s = ecx.read_scalar(imm);
  if (imm_s.$ === "Err") return imm_s;
  const imm_r = interp_Scalar.to_uint(imm_s._0, imm.layout.size);
  if (imm_r.$ === "Err") return imm_r;
  const imm_u = imm_r._0;

  for (let i = 0n; i < num_chunks; i++) {
    const left_i = ecx.project_index(left_c, i);
    if (left_i.$ === "Err") return left_i;
    const right_i = ecx.project_index(right_c, i);
    if (right_i.$ === "Err") return right_i;
    const dest_i = ecx.project_index(dest_c, i);
    if (dest_i.$ === "Err") return dest_i;

    // The first 128-bit chunk uses the low 3 bits of IMM, the second chunk uses bits 3..6.
    const lane_imm = imm_u >> (i * 3n);

    // Bit 2 of `lane_imm` specifies the offset for indices of `left`.
    // The offset is 0 when the bit is 0 or 4 when the bit is 1.
    const left_base = ((lane_imm >> 2n) & 1n) * 4n;
    // Bits 0..=1 of `lane_imm` specify the offset for indices of
    // `right` in blocks of 4 elements.
    const right_base = (lane_imm & 0b11n) * 4n;

    for (let j = 0n; j < dest_items_per_chunk; j++) {
      const left_offset = left_base + j;
      let res = 0;
      for (let k = 0n; k < 4n; k++) {
        const l_p = ecx.project_index(left_i._0, left_offset + k);
        if (l_p.$ === "Err") return l_p;
        const l_s = ecx.read_scalar(l_p._0);
        if (l_s.$ === "Err") return l_s;
        const l = interp_Scalar.to_u8(l_s._0);
        if (l.$ === "Err") return l;
        const r_p = ecx.project_index(right_i._0, right_base + k);
        if (r_p.$ === "Err") return r_p;
        const r_s = ecx.read_scalar(r_p._0);
        if (r_s.$ === "Err") return r_s;
        const r = interp_Scalar.to_u8(r_s._0);
        if (r.$ === "Err") return r;
        res += Math.abs(l._0 - r._0);
      }
      const d = ecx.project_index(dest_i._0, j);
      if (d.$ === "Err") return d;
      const w = ecx.write_scalar(interp_Scalar.from_u16(res), d._0);
      if (w.$ === "Err") return w;
    }
  }

  return interp_ok(undefined);
}

/// Compute the absolute differences of packed unsigned 8-bit integers
/// in `left` and `right`, then horizontally sum each consecutive 8
/// differences to produce unsigned 16-bit integers, and pack
/// these unsigned 16-bit integers in the low 16 bits of 64-bit elements
/// in `dest`.
///
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm_sad_epu8>
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm256_sad_epu8>
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm512_sad_epu8>
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:920 psadbw
export function psadbw(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult {
  const left_s = ecx.project_to_simd(left);
  if (left_s.$ === "Err") return left_s;
  const [left_v, left_len] = left_s._0;
  const right_s = ecx.project_to_simd(right);
  if (right_s.$ === "Err") return right_s;
  const [right_v, right_len] = right_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  // fn psadbw(a: u8x16, b: u8x16) -> u64x2;
  // fn psadbw(a: u8x32, b: u8x32) -> u64x4;
  // fn vpsadbw(a: u8x64, b: u8x64) -> u64x8;
  assert_eq(left_len, right_len, String);
  assert_eq(left_len, BigInt(left_v.layout.size.bytes()), String);
  assert_eq(dest_len, left_len / 8n, String);

  for (let i = 0n; i < dest_len; i++) {
    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;

    let acc = 0;
    for (let j = 0n; j < 8n; j++) {
      const src_index = i * 8n + j;

      const l_p = ecx.project_index(left_v, src_index);
      if (l_p.$ === "Err") return l_p;
      const l_s = ecx.read_scalar(l_p._0);
      if (l_s.$ === "Err") return l_s;
      const l = interp_Scalar.to_u8(l_s._0);
      if (l.$ === "Err") return l;

      const r_p = ecx.project_index(right_v, src_index);
      if (r_p.$ === "Err") return r_p;
      const r_s = ecx.read_scalar(r_p._0);
      if (r_s.$ === "Err") return r_s;
      const r = interp_Scalar.to_u8(r_s._0);
      if (r.$ === "Err") return r;

      acc += Math.abs(l._0 - r._0);
    }

    const w = ecx.write_scalar(interp_Scalar.from_u64(BigInt(acc)), d._0);
    if (w.$ === "Err") return w;
  }

  return interp_ok(undefined);
}

/// Multiply packed signed 16-bit integers in `left` and `right`, producing intermediate signed 32-bit integers.
/// Horizontally add adjacent pairs of intermediate 32-bit integers, and pack the results in `dest`.
///
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm_madd_epi16>
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm256_madd_epi16>
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm512_madd_epi16>
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:965 pmaddwd
export function pmaddwd(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult {
  const left_s = ecx.project_to_simd(left);
  if (left_s.$ === "Err") return left_s;
  const [left_v, left_len] = left_s._0;
  const right_s = ecx.project_to_simd(right);
  if (right_s.$ === "Err") return right_s;
  const [right_v, right_len] = right_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  // fn  pmaddwd(a: i16x8,  b: i16x8)  -> i32x4;
  // fn  pmaddwd(a: i16x16, b: i16x16) -> i32x8;
  // fn vpmaddwd(a: i16x32, b: i16x32) -> i32x16;
  assert_eq(left_len, right_len, String);
  assert_eq(dest_len * 2n, left_len, String);

  for (let i = 0n; i < dest_len; i++) {
    const j1 = i * 2n;
    const left1 = read_i16(ecx, left_v, j1);
    if (left1.$ === "Err") return left1;
    const right1 = read_i16(ecx, right_v, j1);
    if (right1.$ === "Err") return right1;

    const j2 = j1 + 1n;
    const left2 = read_i16(ecx, left_v, j2);
    if (left2.$ === "Err") return left2;
    const right2 = read_i16(ecx, right_v, j2);
    if (right2.$ === "Err") return right2;

    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;

    // Multiplications are i16*i16->i32, which will not overflow.
    const mul1 = left1._0 * right1._0;
    const mul2 = left2._0 * right2._0;
    // However, this addition can overflow in the most extreme case
    // (-0x8000)*(-0x8000)+(-0x8000)*(-0x8000) = 0x80000000
    const res = (mul1 + mul2) | 0;

    const w = ecx.write_scalar(interp_Scalar.from_i32(res), d._0);
    if (w.$ === "Err") return w;
  }

  return interp_ok(undefined);
}

/// Multiplies packed 8-bit unsigned integers from `left` and packed
/// signed 8-bit integers from `right` into 16-bit signed integers. Then,
/// the saturating sum of the products with indices `2*i` and `2*i+1`
/// produces the output at index `i`.
///
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm_maddubs_epi16>
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm256_maddubs_epi16>
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm512_maddubs_epi16>
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:1013 pmaddbw
export function pmaddbw(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult {
  const left_s = ecx.project_to_simd(left);
  if (left_s.$ === "Err") return left_s;
  const [left_v, left_len] = left_s._0;
  const right_s = ecx.project_to_simd(right);
  if (right_s.$ === "Err") return right_s;
  const [right_v, right_len] = right_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  // fn pmaddubsw128(a: u8x16, b: i8x16) -> i16x8;
  // fn pmaddubsw(   a: u8x32, b: i8x32) -> i16x16;
  // fn vpmaddubsw(  a: u8x64, b: i8x64) -> i16x32;
  assert_eq(left_len, right_len, String);
  assert_eq(dest_len * 2n, left_len, String);

  for (let i = 0n; i < dest_len; i++) {
    const j1 = i * 2n;
    const left1 = read_u8(ecx, left_v, j1);
    if (left1.$ === "Err") return left1;
    const right1 = read_i8(ecx, right_v, j1);
    if (right1.$ === "Err") return right1;

    const j2 = j1 + 1n;
    const left2 = read_u8(ecx, left_v, j2);
    if (left2.$ === "Err") return left2;
    const right2 = read_i8(ecx, right_v, j2);
    if (right2.$ === "Err") return right2;

    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;

    // Multiplication of a u8 and an i8 into an i16 cannot overflow.
    const mul1 = left1._0 * right1._0;
    const mul2 = left2._0 * right2._0;
    // `i16::saturating_add`
    const res = Math.max(-0x8000, Math.min(0x7fff, mul1 + mul2));

    const w = ecx.write_scalar(interp_Scalar.from_i16(res), d._0);
    if (w.$ === "Err") return w;
  }

  return interp_ok(undefined);
}

/// Shuffle elements in `values` across lanes using the corresponding index in
/// `indices`, and store the results in `dest`.
///
/// This helper is shared by both the 32-bit-lane and 64-bit-lane AVX
/// permute-by-index intrinsics. The element type is taken from `values` and
/// `dest`, while the index lanes are interpreted at their full width (`i32` or
/// `i64`, depending on the intrinsic).
///
/// For a vector with `N` lanes, only the low `log2(N)` bits of each index are
/// used. Equivalently, lane `i` of the result is copied from
/// `values[indices[i] & (N - 1)]`.
///
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm256_permutevar8x32_epi32>
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm256_permutevar8x32_ps>
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm512_permutexvar_epi32>
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm512_permutexvar_epi64>
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:1067 permute
export function permute(ecx: MiriInterpCx, values: OpTy, indices: OpTy, dest: MPlaceTy): InterpResult {
  const values_s = ecx.project_to_simd(values);
  if (values_s.$ === "Err") return values_s;
  const [values_v, values_len] = values_s._0;
  const indices_s = ecx.project_to_simd(indices);
  if (indices_s.$ === "Err") return indices_s;
  const [indices_v, indices_len] = indices_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  // fn permd(a: u32x8, b: u32x8) -> u32x8;
  // fn permps(a: __m256, b: i32x8) -> __m256;
  // fn vpermd(a: i32x16, idx: i32x16) -> i32x16;
  // fn vpermq(a: i64x8, b: i64x8) -> i64x8;
  assert_eq(dest_len, values_len, String);
  assert_eq(dest_len, indices_len, String);

  // Only use the lower 3 bits to index into a vector with 8 lanes,
  // or the lower 4 bits when indexing into a 16-lane vector.
  assert(u64_is_power_of_two(dest_len), "assertion failed: dest_len.is_power_of_two()");
  const mask = dest_len - 1n;

  for (let i = 0n; i < dest_len; i++) {
    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;
    const index_place = ecx.project_index(indices_v, i);
    if (index_place.$ === "Err") return index_place;
    const index_s = ecx.read_scalar(index_place._0);
    if (index_s.$ === "Err") return index_s;
    const index = interp_Scalar.to_uint(index_s._0, index_place._0.layout.size);
    if (index.$ === "Err") return index;
    // `mask` is at most `dest_len - 1` which fits in a `u64`, so this cannot fail.
    const element = ecx.project_index(values_v, index._0 & mask);
    if (element.$ === "Err") return element;

    const c = ecx.copy_op(element._0, d._0);
    if (c.$ === "Err") return c;
  }

  return interp_ok(undefined);
}

/// Shuffle elements from *two* source registers (`left` and `right`) using
/// the corresponding index in `indices`, and store the results in `dest`.
///
/// For indexing, we basically concatenate `left` and `right`, and index into the concatenation.
/// More precisely: For a vector with `N` lanes, the low `log2(N)` bits of each index select a
/// lane within a source vector. Bit `log2(N)` selects the source vector (`0` =>
/// `left`, `1` => `right`), and all higher bits are ignored.
/// Equivalently, lane `i` of the result is copied from
/// `src[indices[i] & (N - 1)]` where
/// `src = if indices[i] & N == 0 { left } else { right }`.
///
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm512_permutex2var_epi64>
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm512_permutex2var_epi8>
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:1115 permute2
export function permute2(ecx: MiriInterpCx, left: OpTy, indices: OpTy, right: OpTy, dest: MPlaceTy): InterpResult {
  const left_s = ecx.project_to_simd(left);
  if (left_s.$ === "Err") return left_s;
  const [left_v, left_len] = left_s._0;
  const indices_s = ecx.project_to_simd(indices);
  if (indices_s.$ === "Err") return indices_s;
  const [indices_v, indices_len] = indices_s._0;
  const right_s = ecx.project_to_simd(right);
  if (right_s.$ === "Err") return right_s;
  const [right_v, right_len] = right_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  assert_eq(dest_len, left_len, String);
  assert_eq(dest_len, indices_len, String);
  assert_eq(dest_len, right_len, String);

  // Use the low bits to select a lane within either input vector, and the next bit to
  // choose between the two vectors.
  assert(u64_is_power_of_two(dest_len), "assertion failed: dest_len.is_power_of_two()");
  const lane_mask = dest_len - 1n;
  const vector_select_bit = dest_len;

  for (let i = 0n; i < dest_len; i++) {
    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;
    const index_place = ecx.project_index(indices_v, i);
    if (index_place.$ === "Err") return index_place;
    const index_s = ecx.read_scalar(index_place._0);
    if (index_s.$ === "Err") return index_s;
    const index = interp_Scalar.to_uint(index_s._0, index_place._0.layout.size);
    if (index.$ === "Err") return index;
    // `lane_mask` is at most `dest_len - 1` which fits in a `u64`, so this cannot fail.
    const lane = index._0 & lane_mask;
    const src = (index._0 & vector_select_bit) === 0n ? left_v : right_v;
    const element = ecx.project_index(src, lane);
    if (element.$ === "Err") return element;

    const c = ecx.copy_op(element._0, d._0);
    if (c.$ === "Err") return c;
  }

  return interp_ok(undefined);
}

/// Multiplies packed 16-bit signed integer values, truncates the 32-bit
/// product to the 18 most significant bits by right-shifting, and then
/// divides the 18-bit value by 2 (rounding to nearest) by first adding
/// 1 and then taking the bits `1..=16`.
///
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm_mulhrs_epi16>
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm256_mulhrs_epi16>
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:1159 pmulhrsw
export function pmulhrsw(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult {
  const left_s = ecx.project_to_simd(left);
  if (left_s.$ === "Err") return left_s;
  const [left_v, left_len] = left_s._0;
  const right_s = ecx.project_to_simd(right);
  if (right_s.$ === "Err") return right_s;
  const [right_v, right_len] = right_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  assert_eq(dest_len, left_len, String);
  assert_eq(dest_len, right_len, String);

  for (let i = 0n; i < dest_len; i++) {
    const l = read_i16(ecx, left_v, i);
    if (l.$ === "Err") return l;
    const r = read_i16(ecx, right_v, i);
    if (r.$ === "Err") return r;
    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;

    const res32 = (((l._0 * r._0) >> 14) + 1) >> 1;

    // The result of this operation can overflow a signed 16-bit integer.
    // When `left` and `right` are -0x8000, the result is 0x8000.
    const res = (res32 << 16) >> 16;

    const w = ecx.write_scalar(interp_Scalar.from_i16(res), d._0);
    if (w.$ === "Err") return w;
  }

  return interp_ok(undefined);
}

/// Perform a carry-less multiplication of two 64-bit integers, selected from `left` and `right` according to `imm8`,
/// and store the results in `dst`.
///
/// `left` and `right` are both vectors of type `len` x i64. Only bits 0 and 4 of `imm8` matter;
/// they select the element of `left` and `right`, respectively.
///
/// `len` is the SIMD vector length (in counts of `i64` values). It is expected to be one of
/// `2`, `4`, or `8`.
///
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm_clmulepi64_si128>
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:1200 pclmulqdq
export function pclmulqdq(ecx: MiriInterpCx, left: OpTy, right: OpTy, imm8: OpTy, dest: MPlaceTy, len: bigint): InterpResult {
  assert_eq(left.layout, right.layout, debug_layout, TyAndLayout_eq);
  assert_eq(left.layout.size, dest.layout.size, (v) => debug_Size(v, PLAIN), Size_eq);
  assert(len === 2n || len === 4n || len === 8n, "assertion failed: [2u64, 4, 8].contains(&len)");

  // Transmute the input into arrays of `[u64; len]`.
  // Transmute the output into an array of `[u128, len / 2]`.

  const src_layout = ecx.layout_of(Ty.new_array(ecx.tcx.deref(), ecx.tcx.deref().types.u64, Number(len)));
  if (src_layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(src_layout._0));
  const dest_layout = ecx.layout_of(Ty.new_array(ecx.tcx.deref(), ecx.tcx.deref().types.u128, Number(len / 2n)));
  if (dest_layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(dest_layout._0));

  const left_t = left.transmute(src_layout._0, ecx);
  if (left_t.$ === "Err") return left_t;
  const right_t = right.transmute(src_layout._0, ecx);
  if (right_t.$ === "Err") return right_t;
  const dest_t = dest.transmute(dest_layout._0, ecx);
  if (dest_t.$ === "Err") return dest_t;

  const imm8_s = ecx.read_scalar(imm8);
  if (imm8_s.$ === "Err") return imm8_s;
  const imm8_u = interp_Scalar.to_u8(imm8_s._0);
  if (imm8_u.$ === "Err") return imm8_u;

  for (let i = 0n; i < len / 2n; i++) {
    const lo = i * 2n;
    const hi = i * 2n + 1n;

    // select the 64-bit integer from left that the user specified (low or high)
    const left_index = (imm8_u._0 & 0x01) === 0 ? lo : hi;
    const l_p = ecx.project_index(left_t._0, left_index);
    if (l_p.$ === "Err") return l_p;
    const l_s = ecx.read_scalar(l_p._0);
    if (l_s.$ === "Err") return l_s;
    const l = interp_Scalar.to_u64(l_s._0);
    if (l.$ === "Err") return l;

    // select the 64-bit integer from right that the user specified (low or high)
    const right_index = (imm8_u._0 & 0x10) === 0 ? lo : hi;
    const r_p = ecx.project_index(right_t._0, right_index);
    if (r_p.$ === "Err") return r_p;
    const r_s = ecx.read_scalar(r_p._0);
    if (r_s.$ === "Err") return r_s;
    const r = interp_Scalar.to_u64(r_s._0);
    if (r.$ === "Err") return r;

    const result = u64_widening_carryless_mul(l._0, r._0);

    const d = ecx.project_index(dest_t._0, i);
    if (d.$ === "Err") return d;
    const w = ecx.write_scalar(interp_Scalar.from_u128(result), d._0);
    if (w.$ === "Err") return w;
  }

  return interp_ok(undefined);
}

/// Shuffles bytes from `left` using `right` as pattern. Each 16-byte block is shuffled independently.
///
/// `left` and `right` are both vectors of type `len` x i8.
///
/// If the highest bit of a byte in `right` is not set, the corresponding byte in `dest` is taken
/// from the current 16-byte block of `left` at the position indicated by the lowest 4 bits of this
/// byte in `right`. If the highest bit of a byte in `right` is set, the corresponding byte in
/// `dest` is set to `0`.
///
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm_shuffle_epi8>
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm256_shuffle_epi8>
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm512_shuffle_epi8>
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:1257 pshufb
export function pshufb(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult {
  const left_s = ecx.project_to_simd(left);
  if (left_s.$ === "Err") return left_s;
  const [left_v, left_len] = left_s._0;
  const right_s = ecx.project_to_simd(right);
  if (right_s.$ === "Err") return right_s;
  const [right_v, right_len] = right_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  assert_eq(dest_len, left_len, String);
  assert_eq(dest_len, right_len, String);

  for (let i = 0n; i < dest_len; i++) {
    const r = read_u8(ecx, right_v, i);
    if (r.$ === "Err") return r;
    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;

    let res: Scalar;
    if ((r._0 & 0x80) === 0) {
      // Shuffle each 128-bit (16-byte) block independently.
      const block_offset = i & ~15n; // round down to previous multiple of 16
      const j = block_offset + BigInt(r._0 % 16);
      const l_p = ecx.project_index(left_v, j);
      if (l_p.$ === "Err") return l_p;
      const l_s = ecx.read_scalar(l_p._0);
      if (l_s.$ === "Err") return l_s;
      res = l_s._0;
    } else {
      // If the highest bit in `right` is 1, write zero.
      res = interp_Scalar.from_u8(0);
    }

    const w = ecx.write_scalar(res, d._0);
    if (w.$ === "Err") return w;
  }

  return interp_ok(undefined);
}

/// Packs two N-bit integer vectors to a single N/2-bit integers.
///
/// The conversion from N-bit to N/2-bit should be provided by `f`.
///
/// Each 128-bit chunk is treated independently (i.e., the value for
/// the is i-th 128-bit chunk of `dest` is calculated with the i-th
/// 128-bit chunks of `left` and `right`).
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:1297 pack_generic
export function pack_generic(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy, f: (op: Scalar) => InterpResult<Scalar>): InterpResult {
  assert_eq(left.layout, right.layout, debug_layout, TyAndLayout_eq);
  assert_eq(left.layout.size, dest.layout.size, (v) => debug_Size(v, PLAIN), Size_eq);

  const left_s = split_simd_to_128bit_chunks(ecx, left);
  if (left_s.$ === "Err") return left_s;
  const [num_chunks, op_items_per_chunk, left_c] = left_s._0;
  const right_s = split_simd_to_128bit_chunks(ecx, right);
  if (right_s.$ === "Err") return right_s;
  const [, , right_c] = right_s._0;
  const dest_s = split_simd_to_128bit_chunks(ecx, dest);
  if (dest_s.$ === "Err") return dest_s;
  const [, dest_items_per_chunk, dest_c] = dest_s._0;

  assert_eq(dest_items_per_chunk, op_items_per_chunk * 2n, String);

  for (let i = 0n; i < num_chunks; i++) {
    const left_i = ecx.project_index(left_c, i);
    if (left_i.$ === "Err") return left_i;
    const right_i = ecx.project_index(right_c, i);
    if (right_i.$ === "Err") return right_i;
    const dest_i = ecx.project_index(dest_c, i);
    if (dest_i.$ === "Err") return dest_i;

    for (let j = 0n; j < op_items_per_chunk; j++) {
      const l_p = ecx.project_index(left_i._0, j);
      if (l_p.$ === "Err") return l_p;
      const l = ecx.read_scalar(l_p._0);
      if (l.$ === "Err") return l;
      const r_p = ecx.project_index(right_i._0, j);
      if (r_p.$ === "Err") return r_p;
      const r = ecx.read_scalar(r_p._0);
      if (r.$ === "Err") return r;
      const left_dest = ecx.project_index(dest_i._0, j);
      if (left_dest.$ === "Err") return left_dest;
      const right_dest = ecx.project_index(dest_i._0, j + op_items_per_chunk);
      if (right_dest.$ === "Err") return right_dest;

      const left_res = f(l._0);
      if (left_res.$ === "Err") return left_res;
      const right_res = f(r._0);
      if (right_res.$ === "Err") return right_res;

      const w0 = ecx.write_scalar(left_res._0, left_dest._0);
      if (w0.$ === "Err") return w0;
      const w1 = ecx.write_scalar(right_res._0, right_dest._0);
      if (w1.$ === "Err") return w1;
    }
  }

  return interp_ok(undefined);
}

/// Converts two 16-bit integer vectors to a single 8-bit integer
/// vector with signed saturation.
///
/// Each 128-bit chunk is treated independently (i.e., the value for
/// the is i-th 128-bit chunk of `dest` is calculated with the i-th
/// 128-bit chunks of `left` and `right`).
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:1341 packsswb
export function packsswb(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult {
  return pack_generic(ecx, left, right, dest, (op) => {
    const op_r = interp_Scalar.to_i16(op);
    if (op_r.$ === "Err") return op_r;
    const v = op_r._0;
    const res = v >= -0x80 && v <= 0x7f ? v : v < 0 ? -0x80 : 0x7f;
    return interp_ok(interp_Scalar.from_i8(res));
  });
}

/// Converts two 16-bit signed integer vectors to a single 8-bit
/// unsigned integer vector with saturation.
///
/// Each 128-bit chunk is treated independently (i.e., the value for
/// the is i-th 128-bit chunk of `dest` is calculated with the i-th
/// 128-bit chunks of `left` and `right`).
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:1360 packuswb
export function packuswb(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult {
  return pack_generic(ecx, left, right, dest, (op) => {
    const op_r = interp_Scalar.to_i16(op);
    if (op_r.$ === "Err") return op_r;
    const v = op_r._0;
    const res = v >= 0 && v <= 0xff ? v : v < 0 ? 0 : 0xff;
    return interp_ok(interp_Scalar.from_u8(res));
  });
}

/// Converts two 32-bit integer vectors to a single 16-bit integer
/// vector with signed saturation.
///
/// Each 128-bit chunk is treated independently (i.e., the value for
/// the is i-th 128-bit chunk of `dest` is calculated with the i-th
/// 128-bit chunks of `left` and `right`).
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:1379 packssdw
export function packssdw(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult {
  return pack_generic(ecx, left, right, dest, (op) => {
    const op_r = interp_Scalar.to_i32(op);
    if (op_r.$ === "Err") return op_r;
    const v = op_r._0;
    const res = v >= -0x8000 && v <= 0x7fff ? v : v < 0 ? -0x8000 : 0x7fff;
    return interp_ok(interp_Scalar.from_i16(res));
  });
}

/// Converts two 32-bit integer vectors to a single 16-bit integer
/// vector with unsigned saturation.
///
/// Each 128-bit chunk is treated independently (i.e., the value for
/// the is i-th 128-bit chunk of `dest` is calculated with the i-th
/// 128-bit chunks of `left` and `right`).
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:1398 packusdw
export function packusdw(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult {
  return pack_generic(ecx, left, right, dest, (op) => {
    const op_r = interp_Scalar.to_i32(op);
    if (op_r.$ === "Err") return op_r;
    const v = op_r._0;
    const res = v >= 0 && v <= 0xffff ? v : v < 0 ? 0 : 0xffff;
    return interp_ok(interp_Scalar.from_u16(res));
  });
}

/// Negates elements from `left` when the corresponding element in
/// `right` is negative. If an element from `right` is zero, zero
/// is written to the corresponding output element.
/// In other words, multiplies `left` with `right.signum()`.
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:1415 psign
export function psign(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult {
  const left_s = ecx.project_to_simd(left);
  if (left_s.$ === "Err") return left_s;
  const [left_v, left_len] = left_s._0;
  const right_s = ecx.project_to_simd(right);
  if (right_s.$ === "Err") return right_s;
  const [right_v, right_len] = right_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  assert_eq(dest_len, left_len, String);
  assert_eq(dest_len, right_len, String);

  for (let i = 0n; i < dest_len; i++) {
    const d = ecx.project_index(dest_v, i);
    if (d.$ === "Err") return d;
    const dest_i = d._0;
    const l_p = ecx.project_index(left_v, i);
    if (l_p.$ === "Err") return l_p;
    const l = ecx.read_immediate(l_p._0);
    if (l.$ === "Err") return l;
    const r_p = ecx.project_index(right_v, i);
    if (r_p.$ === "Err") return r_p;
    const r_s = ecx.read_scalar(r_p._0);
    if (r_s.$ === "Err") return r_s;
    const r = interp_Scalar.to_int(r_s._0, dest_i.layout.size);
    if (r.$ === "Err") return r;

    // `i128::signum`
    const signum = r._0 > 0n ? 1n : r._0 < 0n ? -1n : 0n;
    const res = ecx.binary_op("Mul", l._0, MiriImmTy.from_int(signum, dest_i.layout));
    if (res.$ === "Err") return res;

    const w = ecx.write_immediate(res._0.imm, dest_i);
    if (w.$ === "Err") return w;
  }

  return interp_ok(undefined);
}

/// Calcultates either `a + b + cb_in` or `a - b - cb_in` depending on the value
/// of `op` and returns both the sum and the overflow bit. `op` is expected to be
/// either one of `mir::BinOp::AddWithOverflow` and `mir::BinOp::SubWithOverflow`.
// rustc: src/tools/miri/src/intrinsics/x86/mod.rs:1445 carrying_add
export function carrying_add(ecx: MiriInterpCx, cb_in: OpTy, a: OpTy, b: OpTy, op: BinOp): InterpResult<[ImmTy, Scalar]> {
  assert(op === "AddWithOverflow" || op === "SubWithOverflow", "assertion failed: op == mir::BinOp::AddWithOverflow || op == mir::BinOp::SubWithOverflow");

  const cb_in_s = ecx.read_scalar(cb_in);
  if (cb_in_s.$ === "Err") return cb_in_s;
  const cb_in_u = interp_Scalar.to_u8(cb_in_s._0);
  if (cb_in_u.$ === "Err") return cb_in_u;
  const cb_in_b = cb_in_u._0 !== 0;
  const a_i = ecx.read_immediate(a);
  if (a_i.$ === "Err") return a_i;
  const b_i = ecx.read_immediate(b);
  if (b_i.$ === "Err") return b_i;

  const res1 = ecx.binary_op(op, a_i._0, b_i._0);
  if (res1.$ === "Err") return res1;
  const [sum1, overflow1] = res1._0.to_pair(ecx);
  const res2 = ecx.binary_op(op, sum1, MiriImmTy.from_uint(cb_in_b ? 1n : 0n, a_i._0.layout));
  if (res2.$ === "Err") return res2;
  const [sum, overflow2] = res2._0.to_pair(ecx);
  const o1 = interp_Scalar.to_bool(imm_to_scalar(overflow1));
  if (o1.$ === "Err") return o1;
  const o2 = interp_Scalar.to_bool(imm_to_scalar(overflow2));
  if (o2.$ === "Err") return o2;
  const cb_out = o1._0 || o2._0;

  return interp_ok([sum, interp_Scalar.from_u8(cb_out ? 1 : 0)]);
}

// ---------------------------------------------------------------- private glue of this module ----

/** `u64::is_power_of_two`. */
function u64_is_power_of_two(v: bigint): boolean {
  return v !== 0n && (v & (v - 1n)) === 0n;
}

/** `ecx.read_scalar(&ecx.project_index(base, i)?)?.to_u8()?`. */
function read_u8(ecx: MiriInterpCx, base: OpTy, i: bigint): InterpResult<number> {
  const p = ecx.project_index(base, i);
  if (p.$ === "Err") return p;
  const s = ecx.read_scalar(p._0);
  if (s.$ === "Err") return s;
  return interp_Scalar.to_u8(s._0);
}

/** `ecx.read_scalar(&ecx.project_index(base, i)?)?.to_i8()?`. */
function read_i8(ecx: MiriInterpCx, base: OpTy, i: bigint): InterpResult<number> {
  const p = ecx.project_index(base, i);
  if (p.$ === "Err") return p;
  const s = ecx.read_scalar(p._0);
  if (s.$ === "Err") return s;
  return interp_Scalar.to_i8(s._0);
}

/** `ecx.read_scalar(&ecx.project_index(base, i)?)?.to_i16()?`. */
function read_i16(ecx: MiriInterpCx, base: OpTy, i: bigint): InterpResult<number> {
  const p = ecx.project_index(base, i);
  if (p.$ === "Err") return p;
  const s = ecx.read_scalar(p._0);
  if (s.$ === "Err") return s;
  return interp_Scalar.to_i16(s._0);
}
