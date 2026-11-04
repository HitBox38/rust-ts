// Fill lane: `miri-x86-a` (plan-m6 wave 38): ported by this lane.
// Port of src/tools/miri/src/intrinsics/x86/sse3.rs (crate `miri`, plan-m6 D2).
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

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/x86/sse3.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/x86/sse3.rs:7
    emulate_x86_sse3_intrinsic(this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult>;
  }
}

// rustc: src/tools/miri/src/intrinsics/x86/sse3.rs:7 emulate_x86_sse3_intrinsic
InterpCx.prototype.emulate_x86_sse3_intrinsic = function (this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();
  const e = this_.expect_target_feature_for_intrinsic(link_name, "sse3");
  if (e.$ === "Err") return e;
  // Prefix should have already been checked.
  const link_name_str = Symbol.as_str(link_name);
  if (!link_name_str.startsWith("llvm.x86.sse3.")) return panic("called `Option::unwrap()` on a `None` value");
  const unprefixed_name = link_name_str.slice("llvm.x86.sse3.".length);

  switch (unprefixed_name) {
    // Used to implement the _mm_lddqu_si128 function.
    // Reads a 128-bit vector from an unaligned pointer. This intrinsic
    // is expected to perform better than a regular unaligned read when
    // the data crosses a cache line, but for Miri this is just a regular
    // unaligned read.
    case "ldu.dq": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 1);
      if (c.$ === "Err") return c;
      const [src_ptr_] = c._0 as [OpTy];
      const src_ptr = this_.read_pointer(src_ptr_);
      if (src_ptr.$ === "Err") return src_ptr;
      const dest_m = dest.force_mplace(this_);
      if (dest_m.$ === "Err") return dest_m;

      const r = this_.mem_copy(src_ptr._0, dest_m._0.ptr(), dest_m._0.layout.size, /*nonoverlapping*/ true);
      if (r.$ === "Err") return r;
      break;
    }
    default:
      return interp_ok(EmulateItemResult.NotSupported);
  }
  return interp_ok(EmulateItemResult.NeedsReturn);
};
