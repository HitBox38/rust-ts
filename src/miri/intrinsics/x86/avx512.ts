// Port of src/tools/miri/src/intrinsics/x86/avx512.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-x86-b` (plan-m6 wave 38): ported by this lane.
//
// PORT:
// - Element indices are `u64` = `bigint` (C5). `u32` lanes are JS numbers kept unsigned with `>>> 0`. In `vpdpbusd` the
//   `strict_*` products and sums cannot overflow an i32 (four products of `u8 * i8`), so they are plain arithmetic; only
//   the upstream `wrapping_add` wraps.
// - Rust shadows `a` / `b` / `c` / `dest` / `src` with their projections; the projections here are `*_v`.
import { type MPlaceTy, type OpTy } from "../../lib.ts";
import { type MiriInterpCx, type Provenance } from "../../machine.ts";
import { EmulateItemResult } from "../../shims/mod.ts";
import * as x86 from "./mod.ts";
import { TyAndLayout_eq } from "../../../rustc_abi/layout/ty.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { interp_ok, type InterpResult, Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { debug_TyAndLayout_Ty } from "../../../rustc_middle/ty/layout.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert_eq, unwrap } from "../../../std/panic.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/x86/avx512.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/x86/avx512.rs:10
    emulate_x86_avx512_intrinsic(this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult>;
  }
}

// PORT(contract): pending miri-x86-a. `permute2` of intrinsics/x86/mod.rs (the other helpers this file calls are declared
// in avx2.ts), with the signature agreed with that lane. Delete this block once mod.ts exports it.
declare module "./mod.ts" {
  export function permute2(ecx: MiriInterpCx, left: OpTy, indices: OpTy, right: OpTy, dest: MPlaceTy): InterpResult;
}

/** `assert_eq!` of two `u64` lengths. */
function assert_eq_len(left: bigint, right: bigint): void {
  assert_eq(left, right, (v) => `${v}`);
}

/** `str::strip_prefix` */
function strip_prefix(s: string, prefix: string): string | undefined {
  return s.startsWith(prefix) ? s.slice(prefix.length) : undefined;
}

// rustc: src/tools/miri/src/intrinsics/x86/avx512.rs:10 emulate_x86_avx512_intrinsic
InterpCx.prototype.emulate_x86_avx512_intrinsic = function (this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();
  // Prefix should have already been checked.
  const unprefixed_name = unwrap(strip_prefix(Symbol.as_str(link_name), "llvm.x86.avx512."));

  switch (unprefixed_name) {
    // Used by the ternarylogic functions.
    case "pternlog.d.128":
    case "pternlog.d.256":
    case "pternlog.d.512": {
      const f = this_.expect_target_feature_for_intrinsic(link_name, "avx512f");
      if (f.$ === "Err") return f;
      if (unprefixed_name === "pternlog.d.128" || unprefixed_name === "pternlog.d.256") {
        const f = this_.expect_target_feature_for_intrinsic(link_name, "avx512vl");
        if (f.$ === "Err") return f;
      }

      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 4);
      if (sig.$ === "Err") return sig;
      const [a, b, c, imm8_] = sig._0 as [OpTy, OpTy, OpTy, OpTy];

      assert_eq(dest.layout, a.layout, (v) => debug_TyAndLayout_Ty(v, PLAIN), TyAndLayout_eq);
      assert_eq(dest.layout, b.layout, (v) => debug_TyAndLayout_Ty(v, PLAIN), TyAndLayout_eq);
      assert_eq(dest.layout, c.layout, (v) => debug_TyAndLayout_Ty(v, PLAIN), TyAndLayout_eq);

      // The signatures of these operations are:
      //
      // ```
      // fn vpternlogd(a: i32x16, b: i32x16, c: i32x16, imm8: i32) -> i32x16;
      // fn vpternlogd256(a: i32x8, b: i32x8, c: i32x8, imm8: i32) -> i32x8;
      // fn vpternlogd128(a: i32x4, b: i32x4, c: i32x4, imm8: i32) -> i32x4;
      // ```
      //
      // The element type is always a 32-bit integer, the width varies.

      const a_s = this_.project_to_simd(a);
      if (a_s.$ === "Err") return a_s;
      const [a_v] = a_s._0;
      const b_s = this_.project_to_simd(b);
      if (b_s.$ === "Err") return b_s;
      const [b_v] = b_s._0;
      const c_s = this_.project_to_simd(c);
      if (c_s.$ === "Err") return c_s;
      const [c_v] = c_s._0;
      const dest_s = this_.project_to_simd(dest);
      if (dest_s.$ === "Err") return dest_s;
      const [dest_v, dest_len] = dest_s._0;

      // Compute one lane with ternary table.
      const tern = (xa: number, xb: number, xc: number, imm: number): number => {
        let out = 0;
        // At each bit position, select bit from imm8 at index = (a << 2) | (b << 1) | c
        for (let bit = 0; bit < 32; bit++) {
          const ia = (xa >>> bit) & 1;
          const ib = (xb >>> bit) & 1;
          const ic = (xc >>> bit) & 1;
          const idx = (ia << 2) | (ib << 1) | ic;
          const v = (imm >>> idx) & 1;
          out |= v << bit;
        }
        return out >>> 0;
      };

      const imm8_s = this_.read_scalar(imm8_);
      if (imm8_s.$ === "Err") return imm8_s;
      const imm8_u = Scalar.to_u32(imm8_s._0);
      if (imm8_u.$ === "Err") return imm8_u;
      const imm8 = imm8_u._0 & 0xff;
      for (let i = 0n; i < dest_len; i++) {
        const a_lane = this_.project_index(a_v, i);
        if (a_lane.$ === "Err") return a_lane;
        const b_lane = this_.project_index(b_v, i);
        if (b_lane.$ === "Err") return b_lane;
        const c_lane = this_.project_index(c_v, i);
        if (c_lane.$ === "Err") return c_lane;
        const d_lane = this_.project_index(dest_v, i);
        if (d_lane.$ === "Err") return d_lane;

        const va_s = this_.read_scalar(a_lane._0);
        if (va_s.$ === "Err") return va_s;
        const va = Scalar.to_u32(va_s._0);
        if (va.$ === "Err") return va;
        const vb_s = this_.read_scalar(b_lane._0);
        if (vb_s.$ === "Err") return vb_s;
        const vb = Scalar.to_u32(vb_s._0);
        if (vb.$ === "Err") return vb;
        const vc_s = this_.read_scalar(c_lane._0);
        if (vc_s.$ === "Err") return vc_s;
        const vc = Scalar.to_u32(vc_s._0);
        if (vc.$ === "Err") return vc;

        const r = tern(va._0, vb._0, vc._0, imm8);
        const w = this_.write_scalar(Scalar.from_u32(r), d_lane._0);
        if (w.$ === "Err") return w;
      }
      break;
    }
    // Used to implement the _mm512_sad_epu8 function.
    case "psad.bw.512": {
      const f = this_.expect_target_feature_for_intrinsic(link_name, "avx512bw");
      if (f.$ === "Err") return f;

      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      const r = x86.psadbw(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm512_madd_epi16 function.
    case "pmaddw.d.512": {
      const f = this_.expect_target_feature_for_intrinsic(link_name, "avx512bw");
      if (f.$ === "Err") return f;

      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      const r = x86.pmaddwd(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm512_maddubs_epi16 function.
    case "pmaddubs.w.512": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      const r = x86.pmaddbw(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm512_permutexvar_epi32/_mm512_permutexvar_epi64 functions.
    case "permvar.si.512":
    case "permvar.di.512": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      const r = x86.permute(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "permvar.qi.512":
    case "permvar.qi.256":
    case "permvar.qi.128": {
      const f = this_.expect_target_feature_for_intrinsic(link_name, "avx512vbmi");
      if (f.$ === "Err") return f;
      if (!unprefixed_name.endsWith("512")) {
        const f = this_.expect_target_feature_for_intrinsic(link_name, "avx512vl");
        if (f.$ === "Err") return f;
      }

      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      const r = x86.permute(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm512_permutex2var_epi64 intrinsic.
    case "vpermi2var.q.512": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (sig.$ === "Err") return sig;
      const [left, indices, right] = sig._0 as [OpTy, OpTy, OpTy];

      const r = x86.permute2(this_, left, indices, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm512_permutex2var_epi8 intrinsic.
    case "vpermi2var.qi.512": {
      const f = this_.expect_target_feature_for_intrinsic(link_name, "avx512vbmi");
      if (f.$ === "Err") return f;

      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (sig.$ === "Err") return sig;
      const [left, indices, right] = sig._0 as [OpTy, OpTy, OpTy];

      const r = x86.permute2(this_, left, indices, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm512_shuffle_epi8 intrinsic.
    case "pshuf.b.512": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];

      const r = x86.pshufb(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }

    // Used to implement the _mm512_dpbusd_epi32 function.
    case "vpdpbusd.512":
    case "vpdpbusd.256":
    case "vpdpbusd.128": {
      const f = this_.expect_target_feature_for_intrinsic(link_name, "avx512vnni");
      if (f.$ === "Err") return f;
      if (unprefixed_name === "vpdpbusd.128" || unprefixed_name === "vpdpbusd.256") {
        const f = this_.expect_target_feature_for_intrinsic(link_name, "avx512vl");
        if (f.$ === "Err") return f;
      }

      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (sig.$ === "Err") return sig;
      const [src, a, b] = sig._0 as [OpTy, OpTy, OpTy];

      const r = vpdpbusd(this_, src, a, b, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm512_packs_epi16 function
    case "packsswb.512": {
      const f = this_.expect_target_feature_for_intrinsic(link_name, "avx512bw");
      if (f.$ === "Err") return f;

      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [a, b] = sig._0 as [OpTy, OpTy];

      const r = x86.packsswb(this_, a, b, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm512_packus_epi16 function
    case "packuswb.512": {
      const f = this_.expect_target_feature_for_intrinsic(link_name, "avx512bw");
      if (f.$ === "Err") return f;

      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [a, b] = sig._0 as [OpTy, OpTy];

      const r = x86.packuswb(this_, a, b, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm512_packs_epi32 function
    case "packssdw.512": {
      const f = this_.expect_target_feature_for_intrinsic(link_name, "avx512bw");
      if (f.$ === "Err") return f;

      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [a, b] = sig._0 as [OpTy, OpTy];

      const r = x86.packssdw(this_, a, b, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm512_packus_epi32 function
    case "packusdw.512": {
      const f = this_.expect_target_feature_for_intrinsic(link_name, "avx512bw");
      if (f.$ === "Err") return f;

      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [a, b] = sig._0 as [OpTy, OpTy];

      const r = x86.packusdw(this_, a, b, dest);
      if (r.$ === "Err") return r;
      break;
    }
    default:
      return interp_ok(EmulateItemResult.NotSupported);
  }
  return interp_ok(EmulateItemResult.NeedsReturn);
};

/// Multiply groups of 4 adjacent pairs of unsigned 8-bit integers in `a` with corresponding signed
/// 8-bit integers in `b`, producing 4 intermediate signed 16-bit results. Sum these 4 results with
/// the corresponding 32-bit integer in `src` (using wrapping arighmetic), and store the packed
/// 32-bit results in `dst`.
///
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm_dpbusd_epi32>
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm256_dpbusd_epi32>
/// <https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm512_dpbusd_epi32>
// rustc: src/tools/miri/src/intrinsics/x86/avx512.rs:195 vpdpbusd
function vpdpbusd(ecx: MiriInterpCx, src: OpTy, a: OpTy, b: OpTy, dest: MPlaceTy): InterpResult {
  const src_s = ecx.project_to_simd(src);
  if (src_s.$ === "Err") return src_s;
  const [src_v, src_len] = src_s._0;
  const a_s = ecx.project_to_simd(a);
  if (a_s.$ === "Err") return a_s;
  const [a_v, a_len] = a_s._0;
  const b_s = ecx.project_to_simd(b);
  if (b_s.$ === "Err") return b_s;
  const [b_v, b_len] = b_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  // fn vpdpbusd(src: i32x16, a: u8x64, b: i8x64) -> i32x16;
  // fn vpdpbusd256(src: i32x8, a: u8x32, b: i8x32) -> i32x8;
  // fn vpdpbusd128(src: i32x4, a: u8x16, b: i8x16) -> i32x4;
  assert_eq_len(src_len, dest_len);
  assert_eq_len(a_len, dest_len * 4n);
  assert_eq_len(b_len, a_len);

  for (let i = 0n; i < dest_len; i++) {
    const src_p = ecx.project_index(src_v, i);
    if (src_p.$ === "Err") return src_p;
    const src_r = ecx.read_scalar(src_p._0);
    if (src_r.$ === "Err") return src_r;
    const src_i = Scalar.to_i32(src_r._0);
    if (src_i.$ === "Err") return src_i;
    const dest_p = ecx.project_index(dest_v, i);
    if (dest_p.$ === "Err") return dest_p;

    let intermediate_sum = 0;
    for (let j = 0n; j < 4n; j++) {
      const idx = i * 4n + j;
      const a_p = ecx.project_index(a_v, idx);
      if (a_p.$ === "Err") return a_p;
      const a_r = ecx.read_scalar(a_p._0);
      if (a_r.$ === "Err") return a_r;
      const a_i = Scalar.to_u8(a_r._0);
      if (a_i.$ === "Err") return a_i;
      const b_p = ecx.project_index(b_v, idx);
      if (b_p.$ === "Err") return b_p;
      const b_r = ecx.read_scalar(b_p._0);
      if (b_r.$ === "Err") return b_r;
      const b_i = Scalar.to_i8(b_r._0);
      if (b_i.$ === "Err") return b_i;

      const product = a_i._0 * b_i._0;
      intermediate_sum = intermediate_sum + product;
    }

    // Use `wrapping_add` because `src` is an arbitrary i32 and the addition can overflow.
    const res: Scalar<Provenance> = Scalar.from_i32((intermediate_sum + src_i._0) | 0);
    const w = ecx.write_scalar(res, dest_p._0);
    if (w.$ === "Err") return w;
  }

  return interp_ok(undefined);
}
