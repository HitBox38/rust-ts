// Port of src/tools/miri/src/shims/tls.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-a` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into tls.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type ThreadId } from "../concurrency/thread.ts";
import { type ImmTy, type Scalar } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { type RunningPthreadDtorState, type RunningWindowsDtorState, TlsData, TlsDtorsState, type TlsEntry, type TlsKey } from "./tls.gen.ts";
import { stub_methods } from "../../rust_ts/miri_stub.ts";
import { type Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Instance } from "../../rustc_middle/ty/instance.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
export * from "./tls.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- shims/tls.rs: `trait EvalContextPrivExt` (impl for `MiriInterpCx`) ----
    // shims/tls.rs:329
    lookup_windows_tls_dtors(this: MiriInterpCx): InterpResult<([ImmTy, Span])[]>;
    // shims/tls.rs:339
    lookup_windows_fls_keys_with_dtors(this: MiriInterpCx): InterpResult<TlsKey[]>;
    // shims/tls.rs:353
    schedule_windows_tls_dtor(this: MiriInterpCx, dtor: ImmTy, span: Span): InterpResult;
    // shims/tls.rs:379
    schedule_macos_tls_dtor(this: MiriInterpCx): InterpResult<Pending<"Poll<()>">>;
    // shims/tls.rs:405
    schedule_next_pthread_tls_dtor(this: MiriInterpCx, state: RunningPthreadDtorState): InterpResult<Pending<"Poll<()>">>;
    // shims/tls.rs:441
    schedule_next_windows_fls_dtor(this: MiriInterpCx, state: RunningWindowsDtorState): InterpResult<Pending<"Poll<()>">>;
  }
}

declare module "./tls.gen.ts" {
  interface TlsData {
    // shims/tls.rs:68
    create_tls_key(dtor: [Instance, Span] | undefined, key_size: Size): InterpResult<TlsKey>;
    // shims/tls.rs:84
    delete_tls_key(key: TlsKey): InterpResult<TlsEntry>;
    // shims/tls.rs:94
    load_tls(key: TlsKey, thread_id: ThreadId, cx: Pending<"impl HasDataLayout">): InterpResult<Scalar>;
    // shims/tls.rs:110
    store_tls(key: TlsKey, thread_id: ThreadId, new_data: Scalar, cx: Pending<"impl HasDataLayout">): InterpResult;
    // shims/tls.rs:134
    add_macos_thread_dtor(thread: ThreadId, dtor: Instance, data: Scalar, span: Span): InterpResult;
    // shims/tls.rs:164
    fetch_tls_dtor(key: TlsKey | undefined, thread_id: ThreadId): [Instance, Scalar, TlsKey, Span] | undefined;
    // shims/tls.rs:200
    delete_all_thread_tls(thread_id: ThreadId): void;
  }
}
declare module "./tls.gen.ts" {
  interface TlsDtorsState {
    // shims/tls.rs:242
    on_stack_empty(this_: MiriInterpCx): InterpResult<Pending<"Poll<()>">>;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl Default for TlsData<'tcx> (shims/tls.rs:54): default (:55)
// impl VisitProvenance for TlsData<'_> (shims/tls.rs:211): visit_provenance (:212)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::tls::EvalContextPrivExt", "src/tools/miri/src/shims/tls.rs", "miri-shims-a", () => InterpCx.prototype, ["lookup_windows_tls_dtors", "lookup_windows_fls_keys_with_dtors", "schedule_windows_tls_dtor", "schedule_macos_tls_dtor", "schedule_next_pthread_tls_dtor", "schedule_next_windows_fls_dtor"]);
stub_methods("miri::shims::tls::TlsData", "src/tools/miri/src/shims/tls.rs", "miri-shims-a", () => TlsData.prototype, ["create_tls_key", "delete_tls_key", "load_tls", "store_tls", "add_macos_thread_dtor", "fetch_tls_dtor", "delete_all_thread_tls"]);
stub_methods("miri::shims::tls::TlsDtorsState", "src/tools/miri/src/shims/tls.rs", "miri-shims-a", () => TlsDtorsState.prototype, ["on_stack_empty"]);
