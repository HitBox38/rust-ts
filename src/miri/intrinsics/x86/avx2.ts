// Port of src/tools/miri/src/intrinsics/x86/avx2.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-x86-b` (plan-m6 wave 38): ported by this lane.
//
// PORT:
// - Element indices and `i64` offsets are `bigint` (C5). The gather's `i64::try_from(..).unwrap()` cannot fail, because
//   `to_int` of a 4- or 8-byte offset fits, and it is kept as a range check. `strict_sub` of a type's bit width cannot
//   underflow.
// - Rust shadows `src` / `offsets` / `mask` / `dest` / `scale` / `slice`; the projections here are `*_v`, the per-element
//   values `*_i`.
import { type MPlaceTy, type OpTy } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { EmulateItemResult } from "../../shims/mod.ts";
import * as x86 from "./mod.ts";
import { ShiftOp } from "./mod.ts";
import { Size } from "../../../rustc_abi/lib.ts";
import { TyAndLayout_eq } from "../../../rustc_abi/layout/ty.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { interp_ok, type InterpResult, Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { debug_TyAndLayout_Ty } from "../../../rustc_middle/ty/layout.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert_eq, panic, unreachable, unwrap } from "../../../std/panic.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/x86/avx2.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/x86/avx2.rs:11
    emulate_x86_avx2_intrinsic(this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult>;
  }
}

// PORT(contract): pending miri-x86-a. The helpers of intrinsics/x86/mod.rs this file and avx512.ts call, with the
// signatures agreed with that lane. Calls go through the `x86` namespace, so this block only has to be deleted once
// mod.ts exports them; a differing export then shows up as a type error here.
declare module "./mod.ts" {
  export function pmaddbw(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult;
  export function mpsadbw(ecx: MiriInterpCx, left: OpTy, right: OpTy, imm: OpTy, dest: MPlaceTy): InterpResult;
  export function pmulhrsw(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult;
  export function packsswb(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult;
  export function packssdw(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult;
  export function packuswb(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult;
  export function packusdw(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult;
  export function permute(ecx: MiriInterpCx, values: OpTy, indices: OpTy, dest: MPlaceTy): InterpResult;
  export function psadbw(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult;
  export function pshufb(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult;
  export function psign(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult;
  export function shift_simd_by_scalar(ecx: MiriInterpCx, left: OpTy, right: OpTy, which: x86.ShiftOp, dest: MPlaceTy): InterpResult;
  export function shift_simd_by_simd(ecx: MiriInterpCx, left: OpTy, right: OpTy, which: x86.ShiftOp, dest: MPlaceTy): InterpResult;
  export function pmaddwd(ecx: MiriInterpCx, left: OpTy, right: OpTy, dest: MPlaceTy): InterpResult;
}

/** `assert_eq!` of two `u64` lengths. */
function assert_eq_len(left: bigint, right: bigint): void {
  assert_eq(left, right, (v) => `${v}`);
}

/** `str::strip_prefix` */
function strip_prefix(s: string, prefix: string): string | undefined {
  return s.startsWith(prefix) ? s.slice(prefix.length) : undefined;
}

const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;

/** `i64::strict_mul`: panics with core's `overflow_panic::mul` text. */
function i64_strict_mul(a: bigint, b: bigint): bigint {
  const r = a * b;
  if (r < I64_MIN || r > I64_MAX) panic("attempt to multiply with overflow");
  return r;
}

// rustc: src/tools/miri/src/intrinsics/x86/avx2.rs:11 emulate_x86_avx2_intrinsic
InterpCx.prototype.emulate_x86_avx2_intrinsic = function (this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();
  const f = this_.expect_target_feature_for_intrinsic(link_name, "avx2");
  if (f.$ === "Err") return f;
  // Prefix should have already been checked.
  const unprefixed_name = unwrap(strip_prefix(Symbol.as_str(link_name), "llvm.x86.avx2."));

  switch (unprefixed_name) {
    // Used to implement `_mm{,_mask}_{i32,i64}gather_{epi32,epi64,pd,ps}` functions
    // Gathers elements from `slice` using `offsets * scale` as indices.
    // When the highest bit of the corresponding element of `mask` is 0,
    // the value is copied from `src` instead.
    case "gather.d.d":
    case "gather.d.d.256":
    case "gather.d.q":
    case "gather.d.q.256":
    case "gather.q.d":
    case "gather.q.d.256":
    case "gather.q.q":
    case "gather.q.q.256":
    case "gather.d.pd":
    case "gather.d.pd.256":
    case "gather.q.pd":
    case "gather.q.pd.256":
    case "gather.d.ps":
    case "gather.d.ps.256":
    case "gather.q.ps":
    case "gather.q.ps.256": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 5);
      if (sig.$ === "Err") return sig;
      const [src, slice_, offsets, mask, scale_] = sig._0 as [OpTy, OpTy, OpTy, OpTy, OpTy];

      assert_eq(dest.layout, src.layout, (v) => debug_TyAndLayout_Ty(v, PLAIN), TyAndLayout_eq);

      const src_s = this_.project_to_simd(src);
      if (src_s.$ === "Err") return src_s;
      const [src_v] = src_s._0;
      const offsets_s = this_.project_to_simd(offsets);
      if (offsets_s.$ === "Err") return offsets_s;
      const [offsets_v, offsets_len] = offsets_s._0;
      const mask_s = this_.project_to_simd(mask);
      if (mask_s.$ === "Err") return mask_s;
      const [mask_v, mask_len] = mask_s._0;
      const dest_s = this_.project_to_simd(dest);
      if (dest_s.$ === "Err") return dest_s;
      const [dest_v, dest_len] = dest_s._0;

      // There are cases like dest: i32x4, offsets: i64x2
      // If dest has more elements than offset, extra dest elements are filled with zero.
      // If offsets has more elements than dest, extra offsets are ignored.
      const actual_len = dest_len < offsets_len ? dest_len : offsets_len;

      assert_eq_len(dest_len, mask_len);

      const mask_item_size: Size = mask_v.layout.field(this_, 0).size;
      const high_bit_offset = BigInt(mask_item_size.bits() - 1);

      const scale_s = this_.read_scalar(scale_);
      if (scale_s.$ === "Err") return scale_s;
      const scale_i8 = Scalar.to_i8(scale_s._0);
      if (scale_i8.$ === "Err") return scale_i8;
      if (!(scale_i8._0 === 1 || scale_i8._0 === 2 || scale_i8._0 === 4 || scale_i8._0 === 8)) {
        panic(`invalid gather scale ${scale_i8._0}`);
      }
      const scale = BigInt(scale_i8._0);

      const slice = this_.read_pointer(slice_);
      if (slice.$ === "Err") return slice;
      for (let i = 0n; i < actual_len; i++) {
        const mask_p = this_.project_index(mask_v, i);
        if (mask_p.$ === "Err") return mask_p;
        const dest_p = this_.project_index(dest_v, i);
        if (dest_p.$ === "Err") return dest_p;
        const dest_i = dest_p._0;

        const mask_r = this_.read_scalar(mask_p._0);
        if (mask_r.$ === "Err") return mask_r;
        const mask_u = Scalar.to_uint(mask_r._0, mask_item_size);
        if (mask_u.$ === "Err") return mask_u;
        if (mask_u._0 >> high_bit_offset !== 0n) {
          const offset_p = this_.project_index(offsets_v, i);
          if (offset_p.$ === "Err") return offset_p;
          const offset_r = this_.read_scalar(offset_p._0);
          if (offset_r.$ === "Err") return offset_r;
          const offset_i = Scalar.to_int(offset_r._0, offset_p._0.layout.size);
          if (offset_i.$ === "Err") return offset_i;
          const offset = offset_i._0;
          if (offset < I64_MIN || offset > I64_MAX) panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
          const ptr = slice._0.wrapping_signed_offset(i64_strict_mul(offset, scale), this_.tcx);
          // Unaligned copy, which is what we want.
          const c = this_.mem_copy(ptr, dest_i.ptr(), dest_i.layout.size, /*nonoverlapping*/ true);
          if (c.$ === "Err") return c;
        } else {
          const src_p = this_.project_index(src_v, i);
          if (src_p.$ === "Err") return src_p;
          const c = this_.copy_op(src_p._0, dest_i);
          if (c.$ === "Err") return c;
        }
      }
      for (let i = actual_len; i < dest_len; i++) {
        const dest_p = this_.project_index(dest_v, i);
        if (dest_p.$ === "Err") return dest_p;
        const w = this_.write_scalar(Scalar.from_int(0n, dest_p._0.layout.size), dest_p._0);
        if (w.$ === "Err") return w;
      }
      break;
    }
    // Used to implement the _mm256_maddubs_epi16 function.
    case "pmadd.ub.sw": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      const r = x86.pmaddbw(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm256_mpsadbw_epu8 function.
    // Compute the sum of absolute differences of quadruplets of unsigned
    // 8-bit integers in `left` and `right`, and store the 16-bit results
    // in `right`. Quadruplets are selected from `left` and `right` with
    // offsets specified in `imm`.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm256_mpsadbw_epu8
    case "mpsadbw": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (sig.$ === "Err") return sig;
      const [left, right, imm] = sig._0 as [OpTy, OpTy, OpTy];

      const r = x86.mpsadbw(this_, left, right, imm, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm256_mulhrs_epi16 function.
    // Multiplies packed 16-bit signed integer values, truncates the 32-bit
    // product to the 18 most significant bits by right-shifting, and then
    // divides the 18-bit value by 2 (rounding to nearest) by first adding
    // 1 and then taking the bits `1..=16`.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm256_mulhrs_epi16
    case "pmul.hr.sw": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      const r = x86.pmulhrsw(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm256_packs_epi16 function.
    // Converts two 16-bit integer vectors to a single 8-bit integer
    // vector with signed saturation.
    case "packsswb": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      const r = x86.packsswb(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm256_packs_epi32 function.
    // Converts two 32-bit integer vectors to a single 16-bit integer
    // vector with signed saturation.
    case "packssdw": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      const r = x86.packssdw(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm256_packus_epi16 function.
    // Converts two 16-bit signed integer vectors to a single 8-bit
    // unsigned integer vector with saturation.
    case "packuswb": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      const r = x86.packuswb(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm256_packus_epi32 function.
    // Concatenates two 32-bit signed integer vectors and converts
    // the result to a 16-bit unsigned integer vector with saturation.
    case "packusdw": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      const r = x86.packusdw(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement _mm256_permutevar8x32_epi32 and _mm256_permutevar8x32_ps.
    case "permd":
    case "permps": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      const r = x86.permute(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm256_sad_epu8 function.
    case "psad.bw": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      const r = x86.psadbw(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm256_shuffle_epi8 intrinsic.
    // Shuffles bytes from `left` using `right` as pattern.
    // Each 128-bit block is shuffled independently.
    case "pshuf.b": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      const r = x86.pshufb(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm256_sign_epi{8,16,32} functions.
    // Negates elements from `left` when the corresponding element in
    // `right` is negative. If an element from `right` is zero, zero
    // is written to the corresponding output element.
    // Basically, we multiply `left` with `right.signum()`.
    case "psign.b":
    case "psign.w":
    case "psign.d": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      const r = x86.psign(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm256_{sll,srl,sra}_epi{16,32,64} functions
    // (except _mm256_sra_epi64, which is not available in AVX2).
    // Shifts N-bit packed integers in left by the amount in right.
    // `right` is as 128-bit vector. but it is interpreted as a single
    // 64-bit integer (remaining bits are ignored).
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
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      let which: ShiftOp;
      switch (unprefixed_name) {
        case "psll.w":
        case "psll.d":
        case "psll.q":
          which = ShiftOp.Left;
          break;
        case "psrl.w":
        case "psrl.d":
        case "psrl.q":
          which = ShiftOp.RightLogic;
          break;
        case "psra.w":
        case "psra.d":
          which = ShiftOp.RightArith;
          break;
        default:
          return unreachable();
      }

      const r = x86.shift_simd_by_scalar(this_, left, right, which, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm256_madd_epi16 function.
    // Multiplies packed signed 16-bit integers in `left` and `right`, producing
    // intermediate signed 32-bit integers. Horizontally add adjacent pairs of
    // intermediate 32-bit integers, and pack the results in `dest`.
    case "pmadd.wd": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      const r = x86.pmaddwd(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm{,256}_{sllv,srlv,srav}_epi{32,64} functions
    // (except _mm{,256}_srav_epi64, which are not available in AVX2).
    case "psllv.d":
    case "psllv.d.256":
    case "psllv.q":
    case "psllv.q.256":
    case "psrlv.d":
    case "psrlv.d.256":
    case "psrlv.q":
    case "psrlv.q.256":
    case "psrav.d":
    case "psrav.d.256": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      let which: ShiftOp;
      switch (unprefixed_name) {
        case "psllv.d":
        case "psllv.d.256":
        case "psllv.q":
        case "psllv.q.256":
          which = ShiftOp.Left;
          break;
        case "psrlv.d":
        case "psrlv.d.256":
        case "psrlv.q":
        case "psrlv.q.256":
          which = ShiftOp.RightLogic;
          break;
        case "psrav.d":
        case "psrav.d.256":
          which = ShiftOp.RightArith;
          break;
        default:
          return unreachable();
      }

      const r = x86.shift_simd_by_simd(this_, left, right, which, dest);
      if (r.$ === "Err") return r;
      break;
    }

    default:
      return interp_ok(EmulateItemResult.NotSupported);
  }
  return interp_ok(EmulateItemResult.NeedsReturn);
};
