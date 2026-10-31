// Port of src/tools/miri/src/shims/unwind.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-a` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into unwind.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type OpTy, type PlaceTy } from "../lib.ts";
import { type FrameExtra, type MiriInterpCx } from "../machine.ts";
import { stub_methods } from "../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type ReturnAction } from "../../rustc_const_eval/interpret/machine.gen.ts";
import { type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type BasicBlock } from "../../rustc_middle/mir/mod.ts";
export * from "./unwind.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- shims/unwind.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unwind.rs:47
    handle_miri_start_unwind(this: MiriInterpCx, payload: OpTy): InterpResult;
    // shims/unwind.rs:60
    handle_catch_unwind(this: MiriInterpCx, try_fn: OpTy, data: OpTy, catch_fn: OpTy, dest: PlaceTy, ret: BasicBlock | undefined): InterpResult;
    // shims/unwind.rs:114
    handle_stack_pop_unwind(this: MiriInterpCx, extra: FrameExtra, unwinding: boolean): InterpResult<ReturnAction>;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl VisitProvenance for CatchUnwindData<'_> (shims/unwind.rs:34): visit_provenance (:35)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::unwind::EvalContextExt", "src/tools/miri/src/shims/unwind.rs", "miri-shims-a", () => InterpCx.prototype, ["handle_miri_start_unwind", "handle_catch_unwind", "handle_stack_pop_unwind"]);
