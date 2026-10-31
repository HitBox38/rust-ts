// Port of src/tools/miri/src/concurrency/init_once.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-threads` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into init_once.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { InitOnce, InitOnceRef, type InitOnceStatus } from "./init_once.gen.ts";
import { type DynUnblockCallback } from "./thread.ts";
import { type MiriInterpCx } from "../machine.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
export * from "./init_once.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- concurrency/init_once.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // concurrency/init_once.rs:75
    init_once_enqueue_and_block(this: MiriInterpCx, init_once_ref: InitOnceRef, callback: DynUnblockCallback): void;
    // concurrency/init_once.rs:90
    init_once_complete(this: MiriInterpCx, init_once_ref: InitOnceRef): InterpResult;
    // concurrency/init_once.rs:117
    init_once_fail(this: MiriInterpCx, init_once_ref: InitOnceRef): InterpResult;
    // concurrency/init_once.rs:143
    init_once_observe_completed(this: MiriInterpCx, init_once_ref: InitOnceRef): InterpResult;
  }
}

declare module "./init_once.gen.ts" {
  interface InitOnce {
    // concurrency/init_once.rs:28 // PORT: `status_` (a field `status` exists; mir-contract rule)
    status_(): InitOnceStatus;
    // concurrency/init_once.rs:35
    begin(): void;
  }
}
declare module "./init_once.gen.ts" {
  interface InitOnceRef {
    // concurrency/init_once.rs:53
    status(): InitOnceStatus;
    // concurrency/init_once.rs:57
    begin(): void;
    // concurrency/init_once.rs:61
    queue_is_empty(): boolean;
  }
  namespace InitOnceRef {
    // concurrency/init_once.rs:49
    function new_(): InitOnceRef;
    export { new_ as new };
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl VisitProvenance for InitOnceRef (concurrency/init_once.rs:66): visit_provenance (:68)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::concurrency::init_once::EvalContextExt", "src/tools/miri/src/concurrency/init_once.rs", "miri-threads", () => InterpCx.prototype, ["init_once_enqueue_and_block", "init_once_complete", "init_once_fail", "init_once_observe_completed"]);
stub_methods("miri::concurrency::init_once::InitOnce", "src/tools/miri/src/concurrency/init_once.rs", "miri-threads", () => InitOnce.prototype, ["status_", "begin"]);
stub_methods("miri::concurrency::init_once::InitOnceRef", "src/tools/miri/src/concurrency/init_once.rs", "miri-threads", () => InitOnceRef.prototype, ["status", "begin", "queue_is_empty"]);
stub_statics("miri::concurrency::init_once::InitOnceRef", "src/tools/miri/src/concurrency/init_once.rs", "miri-threads", () => InitOnceRef, ["new"]);
