// Port of src/tools/miri/src/shims/panic.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-a` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MiriInterpCx } from "../machine.ts";
import { stub_methods } from "../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type UnwindAction } from "../../rustc_middle/mir/mod.ts";
import { type AssertMessage } from "../../rustc_middle/mir/syntax.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- shims/panic.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/panic.rs:11
    start_panic(this: MiriInterpCx, msg: string, unwind: UnwindAction): InterpResult;
    // shims/panic.rs:30
    start_panic_nounwind(this: MiriInterpCx, msg: string): InterpResult;
    // shims/panic.rs:48
    assert_panic(this: MiriInterpCx, msg: AssertMessage, unwind: UnwindAction): InterpResult;
  }
}

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::panic::EvalContextExt", "src/tools/miri/src/shims/panic.rs", "miri-shims-a", () => InterpCx.prototype, ["start_panic", "start_panic_nounwind", "assert_panic"]);
