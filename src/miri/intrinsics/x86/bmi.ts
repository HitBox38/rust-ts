// Port of src/tools/miri/src/intrinsics/x86/bmi.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-x86-b` (plan-m6 wave 38): ported by this lane.
//
// PORT: operands are `u64` = `bigint` (C5). Shifts of a `bigint` do not wrap, so `checked_shr` / `wrapping_shl` are written
// out: `start >= 64` gives `None` (0), and `len` / `index` are below 64 where `wrapping_shl` is reached.
import { type MPlaceTy, type OpTy } from "../../lib.ts";
import { type MiriInterpCx, type Provenance } from "../../machine.ts";
import { EmulateItemResult } from "../../shims/mod.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { interp_ok, type InterpResult, Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { panic, unwrap } from "../../../std/panic.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/x86/bmi.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/x86/bmi.rs:8
    emulate_x86_bmi_intrinsic(this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult>;
  }
}

/** `str::strip_prefix` */
function strip_prefix(s: string, prefix: string): string | undefined {
  return s.startsWith(prefix) ? s.slice(prefix.length) : undefined;
}

/** `str::strip_suffix(..).unwrap_or("")` */
function strip_suffix_or_empty(s: string, suffix: string): string {
  return s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : "";
}

/** `u64::trailing_zeros` of a non-zero value. */
function u64_trailing_zeros(v: bigint): bigint {
  let n = 0n;
  while (((v >> n) & 1n) === 0n) n++;
  return n;
}

// rustc: src/tools/miri/src/intrinsics/x86/bmi.rs:8 emulate_x86_bmi_intrinsic
InterpCx.prototype.emulate_x86_bmi_intrinsic = function (this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();

  // Prefix should have already been checked.
  const prefixed_name = unwrap(strip_prefix(Symbol.as_str(link_name), "llvm.x86.bmi."));

  // The intrinsics are suffixed with the bit size of their operands.
  const is_64_bit = prefixed_name.endsWith("64");
  const unprefixed_name = is_64_bit ? strip_suffix_or_empty(prefixed_name, ".64") : strip_suffix_or_empty(prefixed_name, ".32");

  // All intrinsics of the "bmi" namespace belong to the "bmi2" ISA extension.
  // The exception is "bextr", which belongs to "bmi1".
  const target_feature = unprefixed_name === "bextr" ? "bmi1" : "bmi2";
  const f = this_.expect_target_feature_for_intrinsic(link_name, target_feature);
  if (f.$ === "Err") return f;

  if (is_64_bit && this_.tcx.deref().sess.target.arch.$ !== "X86_64") {
    return interp_ok(EmulateItemResult.NotSupported);
  }

  const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
  if (sig.$ === "Err") return sig;
  const [left_, right_] = sig._0 as [OpTy, OpTy];
  const left_s = this_.read_scalar(left_);
  if (left_s.$ === "Err") return left_s;
  const right_s = this_.read_scalar(right_);
  if (right_s.$ === "Err") return right_s;

  let left: bigint;
  if (is_64_bit) {
    const r = Scalar.to_u64(left_s._0);
    if (r.$ === "Err") return r;
    left = r._0;
  } else {
    const r = Scalar.to_u32(left_s._0);
    if (r.$ === "Err") return r;
    left = BigInt(r._0);
  }
  let right: bigint;
  if (is_64_bit) {
    const r = Scalar.to_u64(right_s._0);
    if (r.$ === "Err") return r;
    right = r._0;
  } else {
    const r = Scalar.to_u32(right_s._0);
    if (r.$ === "Err") return r;
    right = BigInt(r._0);
  }

  let result: bigint;
  switch (unprefixed_name) {
    // Extract a contiguous range of bits from an unsigned integer.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_bextr_u32
    case "bextr": {
      const start = right & 0xffn;
      const len = (right >> 8n) & 0xffn;
      const shifted = start < 64n ? left >> start : 0n;
      // Keep the `len` lowest bits of `shifted`, or all bits if `len` is too big.
      result = len >= 64n ? shifted : shifted & ((1n << len) - 1n);
      break;
    }
    // Create a copy of an unsigned integer with bits above a certain index cleared.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_bzhi_u32
    case "bzhi": {
      const index = right & 0xffn;
      // Keep the `index` lowest bits of `left`, or all bits if `index` is too big.
      result = index >= 64n ? left : left & ((1n << index) - 1n);
      break;
    }
    // Extract bit values of an unsigned integer at positions marked by a mask.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_pext_u32
    case "pext": {
      let mask = right;
      let i = 0n;
      let res = 0n;
      // Iterate over the mask one 1-bit at a time, from
      // the least significant bit to the most significant bit.
      while (mask !== 0n) {
        // Extract the bit marked by the mask's least significant set bit
        // and put it at position `i` of the result.
        res |= ((left & (1n << u64_trailing_zeros(mask))) !== 0n ? 1n : 0n) << i;
        i = i + 1n;
        // Clear the least significant set bit.
        mask &= mask - 1n;
      }
      result = res;
      break;
    }
    // Deposit bit values of an unsigned integer to positions marked by a mask.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_pdep_u32
    case "pdep": {
      let mask = right;
      let set = left;
      let res = 0n;
      // Iterate over the mask one 1-bit at a time, from
      // the least significant bit to the most significant bit.
      while (mask !== 0n) {
        // Put rightmost bit of `set` at the position of the current `mask` bit.
        res |= (set & 1n) << u64_trailing_zeros(mask);
        // Go to next bit of `set`.
        set >>= 1n;
        // Clear the least significant set bit.
        mask &= mask - 1n;
      }
      result = res;
      break;
    }
    default:
      return interp_ok(EmulateItemResult.NotSupported);
  }

  let result_s: Scalar<Provenance>;
  if (is_64_bit) {
    result_s = Scalar.from_u64(result);
  } else {
    if (result > 0xffff_ffffn) panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
    result_s = Scalar.from_u32(Number(result));
  }
  const w = this_.write_scalar(result_s, dest);
  if (w.$ === "Err") return w;

  return interp_ok(EmulateItemResult.NeedsReturn);
};
