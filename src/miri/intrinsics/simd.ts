// Port of src/tools/miri/src/intrinsics/simd.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-d` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type OpTy, type PlaceTy } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { type EmulateItemResult } from "../shims/mod.ts";
import { stub_methods } from "../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- intrinsics/simd.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/simd.rs:13
    emulate_simd_intrinsic(this: MiriInterpCx, intrinsic_name: string, args: readonly OpTy[], dest: PlaceTy): InterpResult<EmulateItemResult>;
  }
}

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::intrinsics::simd::EvalContextExt", "src/tools/miri/src/intrinsics/simd.rs", "miri-shims-d", () => InterpCx.prototype, ["emulate_simd_intrinsic"]);
