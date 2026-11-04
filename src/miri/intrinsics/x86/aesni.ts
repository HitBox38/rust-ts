// Port of src/tools/miri/src/intrinsics/x86/aesni.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-x86-b` (plan-m6 wave 38): ported by this lane.
//
// PORT:
// - The `aes` crate is not vendored: plan-m6 D5 keeps it `unported` in M6. `aes::hazmat::{cipher_round,
//   equiv_inv_cipher_round, mix_columns, inv_mix_columns}` are stand-ins below that stop `unported`, so aesenc, aesdec,
//   their `last` forms and aesimc stop at their first crate call. `aeskeygenassist` needs only `math::aes::sub_word`
//   and is fully ported. The closures and the block conversions are ported in upstream form, ready for the crate.
// - `aes::Block` is a 16-element byte array (`number[]`), mutated in place as `&mut Block` is.
// - `u128` values are `bigint`.
import { type MPlaceTy, type OpTy } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { EmulateItemResult } from "../../shims/mod.ts";
import { sub_word } from "../math.ts";
import { debug_Size } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { InterpErrorInfo_from_InterpErrorKind, interp_ok, type InterpResult, Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert_eq, unported, unwrap } from "../../../std/panic.ts";
import { Err } from "../../../std/result.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/x86/aesni.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/x86/aesni.rs:8
    emulate_x86_aesni_intrinsic(this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult>;
  }
}

/** `aes::Block` (`Array<u8, U16>`). */
type Block = number[];

/** `aes::hazmat::cipher_round` (the `aes` crate: plan-m6 D5). */
function hazmat_cipher_round(_block: Block, _round_key: Block): void {
  unported("aes::hazmat::cipher_round (plan-m6 D5: the aes crate is not vendored in M6)");
}

/** `aes::hazmat::equiv_inv_cipher_round` (the `aes` crate: plan-m6 D5). */
function hazmat_equiv_inv_cipher_round(_block: Block, _round_key: Block): void {
  unported("aes::hazmat::equiv_inv_cipher_round (plan-m6 D5: the aes crate is not vendored in M6)");
}

/** `aes::hazmat::mix_columns` (the `aes` crate: plan-m6 D5). */
function hazmat_mix_columns(_block: Block): void {
  unported("aes::hazmat::mix_columns (plan-m6 D5: the aes crate is not vendored in M6)");
}

/** `aes::hazmat::inv_mix_columns` (the `aes` crate: plan-m6 D5). */
function hazmat_inv_mix_columns(_block: Block): void {
  unported("aes::hazmat::inv_mix_columns (plan-m6 D5: the aes crate is not vendored in M6)");
}

/** `u128::to_le_bytes` */
function u128_to_le_bytes(v: bigint): Block {
  const bytes: Block = [];
  for (let i = 0n; i < 16n; i++) bytes.push(Number((v >> (i * 8n)) & 0xffn));
  return bytes;
}

/** `u128::from_le_bytes` */
function u128_from_le_bytes(bytes: Block): bigint {
  let v = 0n;
  for (let i = 15; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]!);
  return v;
}

/** `str::strip_prefix` */
function strip_prefix(s: string, prefix: string): string | undefined {
  return s.startsWith(prefix) ? s.slice(prefix.length) : undefined;
}

// rustc: src/tools/miri/src/intrinsics/x86/aesni.rs:8 emulate_x86_aesni_intrinsic
InterpCx.prototype.emulate_x86_aesni_intrinsic = function (this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();
  const f = this_.expect_target_feature_for_intrinsic(link_name, "aes");
  if (f.$ === "Err") return f;
  // Prefix should have already been checked.
  const unprefixed_name = unwrap(strip_prefix(Symbol.as_str(link_name), "llvm.x86.aesni."));

  switch (unprefixed_name) {
    // Used to implement the _mm_aesdec_si128, _mm256_aesdec_epi128
    // and _mm512_aesdec_epi128 functions.
    // Performs one round of an AES decryption on each 128-bit word of
    // `state` with the corresponding 128-bit key of `key`.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm_aesdec_si128
    case "aesdec":
    case "aesdec.256":
    case "aesdec.512": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [state, key] = sig._0 as [OpTy, OpTy];
      const r = aes_round(this_, state, key, dest, (state, key) => {
        const key_ = u128_to_le_bytes(key);
        const state_ = u128_to_le_bytes(state);
        // `aes::hazmat::equiv_inv_cipher_round` documentation states that
        // it performs the same operation as the x86 aesdec instruction.
        hazmat_equiv_inv_cipher_round(state_, key_);
        return u128_from_le_bytes(state_);
      });
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_aesdeclast_si128, _mm256_aesdeclast_epi128
    // and _mm512_aesdeclast_epi128 functions.
    // Performs last round of an AES decryption on each 128-bit word of
    // `state` with the corresponding 128-bit key of `key`.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm_aesdeclast_si128
    case "aesdeclast":
    case "aesdeclast.256":
    case "aesdeclast.512": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [state, key] = sig._0 as [OpTy, OpTy];

      const r = aes_round(this_, state, key, dest, (state, key) => {
        const state_ = u128_to_le_bytes(state);
        // `aes::hazmat::equiv_inv_cipher_round` does the following operations:
        // state = InvShiftRows(state)
        // state = InvSubBytes(state)
        // state = InvMixColumns(state)
        // state = state ^ key
        // But we need to skip the InvMixColumns.
        // First, use a zeroed key to skip the XOR.
        hazmat_equiv_inv_cipher_round(state_, new Array<number>(16).fill(0));
        // Then, undo the InvMixColumns with MixColumns.
        hazmat_mix_columns(state_);
        // Finally, do the XOR.
        return u128_from_le_bytes(state_) ^ key;
      });
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_aesenc_si128, _mm256_aesenc_epi128
    // and _mm512_aesenc_epi128 functions.
    // Performs one round of an AES encryption on each 128-bit word of
    // `state` with the corresponding 128-bit key of `key`.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm_aesenc_si128
    case "aesenc":
    case "aesenc.256":
    case "aesenc.512": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [state, key] = sig._0 as [OpTy, OpTy];
      const r = aes_round(this_, state, key, dest, (state, key) => {
        const key_ = u128_to_le_bytes(key);
        const state_ = u128_to_le_bytes(state);
        // `aes::hazmat::cipher_round` documentation states that
        // it performs the same operation as the x86 aesenc instruction.
        hazmat_cipher_round(state_, key_);
        return u128_from_le_bytes(state_);
      });
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_aesenclast_si128, _mm256_aesenclast_epi128
    // and _mm512_aesenclast_epi128 functions.
    // Performs last round of an AES encryption on each 128-bit word of
    // `state` with the corresponding 128-bit key of `key`.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm_aesenclast_si128
    case "aesenclast":
    case "aesenclast.256":
    case "aesenclast.512": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [state, key] = sig._0 as [OpTy, OpTy];
      const r = aes_round(this_, state, key, dest, (state, key) => {
        const state_ = u128_to_le_bytes(state);
        // `aes::hazmat::cipher_round` does the following operations:
        // state = ShiftRows(state)
        // state = SubBytes(state)
        // state = MixColumns(state)
        // state = state ^ key
        // But we need to skip the MixColumns.
        // First, use a zeroed key to skip the XOR.
        hazmat_cipher_round(state_, new Array<number>(16).fill(0));
        // Then, undo the MixColumns with InvMixColumns.
        hazmat_inv_mix_columns(state_);
        // Finally, do the XOR.
        return u128_from_le_bytes(state_) ^ key;
      });
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_aesimc_si128 function.
    // Performs the AES InvMixColumns operation on `op`
    case "aesimc": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 1);
      if (sig.$ === "Err") return sig;
      const [op_] = sig._0 as [OpTy];
      // Transmute to `u128`
      const op = op_.transmute(this_.machine.layouts.u128, this_);
      if (op.$ === "Err") return op;
      const dest_t = dest.transmute(this_.machine.layouts.u128, this_);
      if (dest_t.$ === "Err") return dest_t;

      const state_s = this_.read_scalar(op._0);
      if (state_s.$ === "Err") return state_s;
      const state_u = Scalar.to_u128(state_s._0);
      if (state_u.$ === "Err") return state_u;
      const state = u128_to_le_bytes(state_u._0);
      hazmat_inv_mix_columns(state);

      const w = this_.write_scalar(Scalar.from_u128(u128_from_le_bytes(state)), dest_t._0);
      if (w.$ === "Err") return w;
      break;
    }
    // Used to implement the _mm_aeskeygenassist_si128 function.
    // Assists in expanding the AES cipher key.
    case "aeskeygenassist": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [ckey_, rcon_] = sig._0 as [OpTy, OpTy];
      // Transmute `__m128i` to `u128`.
      const ckey_t = ckey_.transmute(this_.machine.layouts.u128, this_);
      if (ckey_t.$ === "Err") return ckey_t;
      const dest_t = dest.transmute(this_.machine.layouts.u128, this_);
      if (dest_t.$ === "Err") return dest_t;

      const rcon_s = this_.read_scalar(rcon_);
      if (rcon_s.$ === "Err") return rcon_s;
      const rcon = Scalar.to_u8(rcon_s._0);
      if (rcon.$ === "Err") return rcon;
      const ckey_s = this_.read_scalar(ckey_t._0);
      if (ckey_s.$ === "Err") return ckey_s;
      const ckey = Scalar.to_u128(ckey_s._0);
      if (ckey.$ === "Err") return ckey;

      const res = aeskeygenassist(ckey._0, rcon._0);

      const w = this_.write_scalar(Scalar.from_u128(res), dest_t._0);
      if (w.$ === "Err") return w;
      break;
    }
    default:
      return interp_ok(EmulateItemResult.NotSupported);
  }
  return interp_ok(EmulateItemResult.NeedsReturn);
};

// Performs an AES round (given by `f`) on each 128-bit word of
// `state` with the corresponding 128-bit key of `key`.
// rustc: src/tools/miri/src/intrinsics/x86/aesni.rs:136 aes_round
function aes_round(ecx: MiriInterpCx, state_: OpTy, key_: OpTy, dest_: MPlaceTy, f: (state: bigint, key: bigint) => bigint): InterpResult {
  const debug_size = (v: typeof dest_.layout.size) => debug_Size(v, PLAIN);
  const size_eq = (a: typeof dest_.layout.size, b: typeof dest_.layout.size) => a.bytes() === b.bytes();
  assert_eq(dest_.layout.size, state_.layout.size, debug_size, size_eq);
  assert_eq(dest_.layout.size, key_.layout.size, debug_size, size_eq);

  // Transmute arguments to arrays of `u128`.
  assert_eq(dest_.layout.size.bytes() % 16, 0, (v) => `${v}`);
  const len = dest_.layout.size.bytes() / 16;

  const u128_array_layout = ecx.layout_of(Ty.new_array(ecx.tcx.tcx, ecx.tcx.deref().types.u128, len));
  if (u128_array_layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(u128_array_layout._0));

  const state_t = state_.transmute(u128_array_layout._0, ecx);
  if (state_t.$ === "Err") return state_t;
  const key_t = key_.transmute(u128_array_layout._0, ecx);
  if (key_t.$ === "Err") return key_t;
  const dest_t = dest_.transmute(u128_array_layout._0, ecx);
  if (dest_t.$ === "Err") return dest_t;

  for (let i = 0n; i < BigInt(len); i++) {
    const state_p = ecx.project_index(state_t._0, i);
    if (state_p.$ === "Err") return state_p;
    const state_r = ecx.read_scalar(state_p._0);
    if (state_r.$ === "Err") return state_r;
    const state = Scalar.to_u128(state_r._0);
    if (state.$ === "Err") return state;
    const key_p = ecx.project_index(key_t._0, i);
    if (key_p.$ === "Err") return key_p;
    const key_r = ecx.read_scalar(key_p._0);
    if (key_r.$ === "Err") return key_r;
    const key = Scalar.to_u128(key_r._0);
    if (key.$ === "Err") return key;
    const dest = ecx.project_index(dest_t._0, i);
    if (dest.$ === "Err") return dest;

    const res = f(state._0, key._0);

    const w = ecx.write_scalar(Scalar.from_u128(res), dest._0);
    if (w.$ === "Err") return w;
  }

  return interp_ok(undefined);
}

/** `u32::rotate_right` */
function u32_rotate_right(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/// AES Key Generation Assist
///
/// From [Intel Intrinsics Guide][1]:
/// ```text
/// X3[31:0] := a[127:96]
/// X2[31:0] := a[95:64]
/// X1[31:0] := a[63:32]
/// X0[31:0] := a[31:0]
/// RCON[31:0] := ZeroExtend32(imm8[7:0])
/// dst[31:0] := SubWord(X1)
/// dst[63:32] := RotWord(SubWord(X1)) XOR RCON
/// dst[95:64] := SubWord(X3)
/// dst[127:96] := RotWord(SubWord(X3)) XOR RCON
/// ```
///
/// [1]: https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm_aeskeygenassist_si128
// rustc: src/tools/miri/src/intrinsics/x86/aesni.rs:186 aeskeygenassist
function aeskeygenassist(a: bigint, rcon_: number): bigint {
  const rcon = rcon_;
  // TODO: use `truncate` method on stabilization
  const x1_ = Number((a >> 32n) & 0xffff_ffffn);
  const x3_ = Number((a >> 96n) & 0xffff_ffffn);

  const x0 = sub_word(x1_);
  const x1 = (u32_rotate_right(x0, 8) ^ rcon) >>> 0;
  const x2 = sub_word(x3_);
  const x3 = (u32_rotate_right(x2, 8) ^ rcon) >>> 0;

  return (BigInt(x3) << 96n) | (BigInt(x2) << 64n) | (BigInt(x1) << 32n) | BigInt(x0);
}
