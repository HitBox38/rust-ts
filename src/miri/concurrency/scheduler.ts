// Port of src/tools/miri/src/concurrency/scheduler.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-threads` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into scheduler.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type SchedulingAction } from "./scheduler.gen.ts";
import { type MiriInterpCx } from "../machine.ts";
import { stub_methods } from "../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
export * from "./scheduler.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- concurrency/scheduler.rs: `trait EvalContextPrivExt` (impl for `MiriInterpCx`) ----
    // concurrency/scheduler.rs:31
    run_on_stack_empty(this: MiriInterpCx): InterpResult<Pending<"Poll<()>">>;
    // concurrency/scheduler.rs:52
    schedule(this: MiriInterpCx): InterpResult<SchedulingAction>;
    // ---- concurrency/scheduler.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // concurrency/scheduler.rs:174
    step_current_thread(this: MiriInterpCx): InterpResult;
    // concurrency/scheduler.rs:192
    run_threads(this: MiriInterpCx): InterpResult<never>;
  }
}

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::concurrency::scheduler::EvalContextPrivExt", "src/tools/miri/src/concurrency/scheduler.rs", "miri-threads", () => InterpCx.prototype, ["run_on_stack_empty", "schedule"]);
stub_methods("miri::concurrency::scheduler::EvalContextExt", "src/tools/miri/src/concurrency/scheduler.rs", "miri-threads", () => InterpCx.prototype, ["step_current_thread", "run_threads"]);
