// Port of src/tools/miri/src/shims/env.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-a` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into env.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type ThreadId } from "../concurrency/thread.ts";
import { type MiriInterpCx } from "../machine.ts";
import { stub_methods } from "../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
export * from "./env.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- shims/env.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/env.rs:97
    get_env_var(this: MiriInterpCx, name: string): InterpResult<string | undefined>;
    // shims/env.rs:107
    get_pid(this: MiriInterpCx): number;
    // shims/env.rs:113
    get_tid(this: MiriInterpCx, thread: ThreadId): number;
    // shims/env.rs:123
    get_thread_id_from_linux_tid(this: MiriInterpCx, tid: number): ThreadId | undefined;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl VisitProvenance for EnvVars<'_> (shims/env.rs:19): visit_provenance (:20)
// impl EnvVars<'tcx> (shims/env.rs:29) [EnvVars is not a generated class: companion fns / hand type, lane decides]: init (:30), unix (:64), unix_mut (:71), windows (:78), windows_mut (:85)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::env::EvalContextExt", "src/tools/miri/src/shims/env.rs", "miri-shims-a", () => InterpCx.prototype, ["get_env_var", "get_pid", "get_tid", "get_thread_id_from_linux_tid"]);
