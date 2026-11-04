// Fill lane: `miri-x86-a` (plan-m6 wave 38): ported by this lane.
// Port of src/tools/miri/src/intrinsics/x86/ssse3.rs (crate `miri`, plan-m6 D2).
//
// PORT: `trait EvalContextExt` (impl for `MiriInterpCx`) is a `declare module` augmentation of `InterpCx` (decision C2).
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult, interp_ok } from "../../../rustc_middle/mir/interpret/mod.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { panic } from "../../../std/panic.ts";
import { type MPlaceTy, type OpTy } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { EmulateItemResult } from "../../shims/mod.ts";
import { pmaddbw, pmulhrsw, pshufb, psign } from "./mod.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/x86/ssse3.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/x86/ssse3.rs:8
    emulate_x86_ssse3_intrinsic(this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult>;
  }
}

// rustc: src/tools/miri/src/intrinsics/x86/ssse3.rs:8 emulate_x86_ssse3_intrinsic
InterpCx.prototype.emulate_x86_ssse3_intrinsic = function (this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();
  const e = this_.expect_target_feature_for_intrinsic(link_name, "ssse3");
  if (e.$ === "Err") return e;
  // Prefix should have already been checked.
  const link_name_str = Symbol.as_str(link_name);
  if (!link_name_str.startsWith("llvm.x86.ssse3.")) return panic("called `Option::unwrap()` on a `None` value");
  const unprefixed_name = link_name_str.slice("llvm.x86.ssse3.".length);

  switch (unprefixed_name) {
    // Used to implement the _mm_shuffle_epi8 intrinsic.
    // Shuffles bytes from `left` using `right` as pattern.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm_shuffle_epi8
    case "pshuf.b.128": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left, right] = c._0 as [OpTy, OpTy];

      const r = pshufb(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_maddubs_epi16 function.
    case "pmadd.ub.sw.128": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left, right] = c._0 as [OpTy, OpTy];

      const r = pmaddbw(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_mulhrs_epi16 function.
    // Multiplies packed 16-bit signed integer values, truncates the 32-bit
    // product to the 18 most significant bits by right-shifting, and then
    // divides the 18-bit value by 2 (rounding to nearest) by first adding
    // 1 and then taking the bits `1..=16`.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm_mulhrs_epi16
    case "pmul.hr.sw.128": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left, right] = c._0 as [OpTy, OpTy];

      const r = pmulhrsw(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    // Used to implement the _mm_sign_epi{8,16,32} functions.
    // Negates elements from `left` when the corresponding element in
    // `right` is negative. If an element from `right` is zero, zero
    // is written to the corresponding output element.
    // Basically, we multiply `left` with `right.signum()`.
    case "psign.b.128":
    case "psign.w.128":
    case "psign.d.128": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left, right] = c._0 as [OpTy, OpTy];

      const r = psign(this_, left, right, dest);
      if (r.$ === "Err") return r;
      break;
    }
    default:
      return interp_ok(EmulateItemResult.NotSupported);
  }
  return interp_ok(EmulateItemResult.NeedsReturn);
};
