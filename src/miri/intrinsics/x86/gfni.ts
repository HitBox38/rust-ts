// Port of src/tools/miri/src/intrinsics/x86/gfni.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-x86-b` (plan-m6 wave 38): ported by this lane.
//
// PORT:
// - Element indices are `u64` = `bigint` (C5); `wrapping_add` on them cannot wrap (`i + j` is below the vector's length).
// - Rust shadows `left` / `right` / `dest` with their projections; the projections here are `*_v`.
// - `static TABLE`, const-evaluated upstream, is computed once when the module loads, from this module's own
//   `gf2p8_mul` (a hoisted function), so C10 holds.
import { type MPlaceTy, type OpTy } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { EmulateItemResult } from "../../shims/mod.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { interp_ok, type InterpResult, Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { assert_eq, unwrap } from "../../../std/panic.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/x86/gfni.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/x86/gfni.rs:7
    emulate_x86_gfni_intrinsic(this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult>;
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

// rustc: src/tools/miri/src/intrinsics/x86/gfni.rs:7 emulate_x86_gfni_intrinsic
InterpCx.prototype.emulate_x86_gfni_intrinsic = function (this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();

  // Prefix should have already been checked.
  const unprefixed_name = unwrap(strip_prefix(Symbol.as_str(link_name), "llvm.x86."));

  const f = this_.expect_target_feature_for_intrinsic(link_name, "gfni");
  if (f.$ === "Err") return f;
  if (unprefixed_name.endsWith(".256")) {
    const f = this_.expect_target_feature_for_intrinsic(link_name, "avx");
    if (f.$ === "Err") return f;
  } else if (unprefixed_name.endsWith(".512")) {
    const f = this_.expect_target_feature_for_intrinsic(link_name, "avx512f");
    if (f.$ === "Err") return f;
  }

  switch (unprefixed_name) {
    // Used to implement the `_mm{, 256, 512}_gf2p8affine_epi64_epi8` functions.
    // See `affine_transform` for details.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=gf2p8affine_
    case "vgf2p8affineqb.128":
    case "vgf2p8affineqb.256":
    case "vgf2p8affineqb.512": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (sig.$ === "Err") return sig;
      const [left, right, imm8] = sig._0 as [OpTy, OpTy, OpTy];
      const r = affine_transform(this_, left, right, imm8, dest, /* inverse */ false);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the `_mm{, 256, 512}_gf2p8affineinv_epi64_epi8` functions.
    // See `affine_transform` for details.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=gf2p8affineinv
    case "vgf2p8affineinvqb.128":
    case "vgf2p8affineinvqb.256":
    case "vgf2p8affineinvqb.512": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (sig.$ === "Err") return sig;
      const [left, right, imm8] = sig._0 as [OpTy, OpTy, OpTy];
      const r = affine_transform(this_, left, right, imm8, dest, /* inverse */ true);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the `_mm{, 256, 512}_gf2p8mul_epi8` functions.
    // Multiplies packed 8-bit integers in `left` and `right` in the finite field GF(2^8)
    // and store the results in `dst`. The field GF(2^8) is represented in
    // polynomial representation with the reduction polynomial x^8 + x^4 + x^3 + x + 1.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=gf2p8mul
    case "vgf2p8mulb.128":
    case "vgf2p8mulb.256":
    case "vgf2p8mulb.512": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [left, right] = sig._0 as [OpTy, OpTy];
      const left_s = this_.project_to_simd(left);
      if (left_s.$ === "Err") return left_s;
      const [left_v, left_len] = left_s._0;
      const right_s = this_.project_to_simd(right);
      if (right_s.$ === "Err") return right_s;
      const [right_v, right_len] = right_s._0;
      const dest_s = this_.project_to_simd(dest);
      if (dest_s.$ === "Err") return dest_s;
      const [dest_v, dest_len] = dest_s._0;

      assert_eq_len(left_len, right_len);
      assert_eq_len(dest_len, right_len);

      for (let i = 0n; i < dest_len; i++) {
        const left_p = this_.project_index(left_v, i);
        if (left_p.$ === "Err") return left_p;
        const left_r = this_.read_scalar(left_p._0);
        if (left_r.$ === "Err") return left_r;
        const left_i = Scalar.to_u8(left_r._0);
        if (left_i.$ === "Err") return left_i;
        const right_p = this_.project_index(right_v, i);
        if (right_p.$ === "Err") return right_p;
        const right_r = this_.read_scalar(right_p._0);
        if (right_r.$ === "Err") return right_r;
        const right_i = Scalar.to_u8(right_r._0);
        if (right_i.$ === "Err") return right_i;
        const dest_p = this_.project_index(dest_v, i);
        if (dest_p.$ === "Err") return dest_p;
        const w = this_.write_scalar(Scalar.from_u8(gf2p8_mul(left_i._0, right_i._0)), dest_p._0);
        if (w.$ === "Err") return w;
      }
      break;
    }
    default:
      return interp_ok(EmulateItemResult.NotSupported);
  }
  return interp_ok(EmulateItemResult.NeedsReturn);
};

/// Calculates the affine transformation `right * left + imm8` inside the finite field GF(2^8).
/// `right` is an 8x8 bit matrix, `left` and `imm8` are bit vectors.
/// If `inverse` is set, then the inverse transformation with respect to the reduction polynomial
/// x^8 + x^4 + x^3 + x + 1 is performed instead.
// rustc: src/tools/miri/src/intrinsics/x86/gfni.rs:71 affine_transform
function affine_transform(ecx: MiriInterpCx, left: OpTy, right: OpTy, imm8_: OpTy, dest: MPlaceTy, inverse: boolean): InterpResult {
  const left_s = ecx.project_to_simd(left);
  if (left_s.$ === "Err") return left_s;
  const [left_v, left_len] = left_s._0;
  const right_s = ecx.project_to_simd(right);
  if (right_s.$ === "Err") return right_s;
  const [right_v, right_len] = right_s._0;
  const dest_s = ecx.project_to_simd(dest);
  if (dest_s.$ === "Err") return dest_s;
  const [dest_v, dest_len] = dest_s._0;

  assert_eq_len(dest_len, right_len);
  assert_eq_len(dest_len, left_len);

  const imm8_r = ecx.read_scalar(imm8_);
  if (imm8_r.$ === "Err") return imm8_r;
  const imm8_u = Scalar.to_u8(imm8_r._0);
  if (imm8_u.$ === "Err") return imm8_u;
  const imm8 = imm8_u._0;

  // Each 8x8 bit matrix gets multiplied with eight bit vectors.
  // Therefore, the iteration is done in chunks of eight.
  for (let i = 0n; i < dest_len; i += 8n) {
    // Get the bit matrix.
    const matrix = new Array<number>(8).fill(0);
    for (let j = 0n; j < 8n; j++) {
      const m_p = ecx.project_index(right_v, i + j);
      if (m_p.$ === "Err") return m_p;
      const m_r = ecx.read_scalar(m_p._0);
      if (m_r.$ === "Err") return m_r;
      const m_u = Scalar.to_u8(m_r._0);
      if (m_u.$ === "Err") return m_u;
      matrix[Number(j)] = m_u._0;
    }

    // Multiply the matrix with the vector and perform the addition.
    for (let j = 0n; j < 8n; j++) {
      const index = i + j;
      const left_p = ecx.project_index(left_v, index);
      if (left_p.$ === "Err") return left_p;
      const left_r = ecx.read_scalar(left_p._0);
      if (left_r.$ === "Err") return left_r;
      const left_u = Scalar.to_u8(left_r._0);
      if (left_u.$ === "Err") return left_u;
      const left_i = inverse ? TABLE[left_u._0]! : left_u._0;

      let res = 0;

      // Do the matrix multiplication.
      for (let bit = 0; bit < 8; bit++) {
        let b = matrix[bit]! & left_i;

        // Calculate the parity bit.
        b = (b & 0b1111) ^ (b >>> 4);
        b = (b & 0b11) ^ (b >>> 2);
        b = (b & 0b1) ^ (b >>> 1);

        res |= b << (7 - bit);
      }

      // Perform the addition.
      res ^= imm8;

      const dest_p = ecx.project_index(dest_v, index);
      if (dest_p.$ === "Err") return dest_p;
      const w = ecx.write_scalar(Scalar.from_u8(res), dest_p._0);
      if (w.$ === "Err") return w;
    }
  }

  return interp_ok(undefined);
}

/// A lookup table for computing the inverse byte for the inverse affine transformation.
// This is a evaluated at compile time. Trait based conversion is not available.
/// See <https://www.corsix.org/content/galois-field-instructions-2021-cpus> for the
/// definition of `gf_inv` which was used for the creation of this table.
const TABLE: readonly number[] = (() => {
  const array = new Array<number>(256).fill(0);

  let i = 1;
  while (i < 256) {
    let x = i;
    let y = gf2p8_mul(x, x);
    x = y;
    let j = 2;
    while (j < 8) {
      x = gf2p8_mul(x, x);
      y = gf2p8_mul(x, y);
      j += 1;
    }
    array[i] = y;
    i += 1;
  }

  return array;
})();

/// Multiplies packed 8-bit integers in `left` and `right` in the finite field GF(2^8)
/// and store the results in `dst`. The field GF(2^8) is represented in
/// polynomial representation with the reduction polynomial x^8 + x^4 + x^3 + x + 1.
/// See <https://www.corsix.org/content/galois-field-instructions-2021-cpus> for details.
// This is a const function. Trait based conversion is not available.
// rustc: src/tools/miri/src/intrinsics/x86/gfni.rs:161 gf2p8_mul
function gf2p8_mul(left: number, right: number): number {
  // This implementation is based on the `gf2p8mul_byte` definition found inside the Intel intrinsics guide.
  // See https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=gf2p8mul
  // for more information.

  const POLYNOMIAL = 0x11b;

  let result = 0;

  let i = 0;
  while (i < 8) {
    if ((left & (1 << i)) !== 0) {
      result ^= right << i;
    }
    i = i + 1;
  }

  i = 14;
  while (i >= 8) {
    if ((result & (1 << i)) !== 0) {
      result ^= POLYNOMIAL << (i - 8);
    }
    i = i - 1;
  }

  return result & 0xff;
}
