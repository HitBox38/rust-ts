// Port of src/tools/miri/src/shims/unix/thread.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-c` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into thread.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MPlaceTy, type OpTy, type Scalar } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { type ThreadNameResult } from "./thread.gen.ts";
import { stub_methods } from "../../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
export * from "./thread.gen.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/unix/thread.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/thread.rs:14
    pthread_create(this: MiriInterpCx, thread: OpTy, _attr: OpTy, start_routine: OpTy, arg: OpTy): InterpResult;
    // shims/unix/thread.rs:40
    pthread_join(this: MiriInterpCx, thread: OpTy, retval: OpTy, return_dest: MPlaceTy): InterpResult;
    // shims/unix/thread.rs:68
    pthread_detach(this: MiriInterpCx, thread: OpTy): InterpResult<Scalar>;
    // shims/unix/thread.rs:83
    pthread_self(this: MiriInterpCx): InterpResult<Scalar>;
    // shims/unix/thread.rs:94
    pthread_setname_np(this: MiriInterpCx, thread: Scalar, name: Scalar, name_max_len: bigint, truncate: boolean): InterpResult<ThreadNameResult>;
    // shims/unix/thread.rs:130
    pthread_getname_np(this: MiriInterpCx, thread: Scalar, name_out: Scalar, len: Scalar, truncate: boolean): InterpResult<ThreadNameResult>;
    // shims/unix/thread.rs:161
    sched_yield(this: MiriInterpCx): InterpResult;
  }
}

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::unix::thread::EvalContextExt", "src/tools/miri/src/shims/unix/thread.rs", "miri-shims-c", () => InterpCx.prototype, ["pthread_create", "pthread_join", "pthread_detach", "pthread_self", "pthread_setname_np", "pthread_getname_np", "sched_yield"]);
