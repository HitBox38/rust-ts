// Port of src/tools/miri/src/shims/readiness.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-c` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into readiness.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type ThreadId } from "../concurrency/thread.ts";
import { type MiriInterpCx } from "../machine.ts";
import { type DynFileDescriptionRef, type FdId, type FdNum } from "./files.ts";
import { DelayedReadinessUpdates, type Readiness, ReadinessInterest, type ReadinessInterestKey, type ReadinessUpdateFlags, ReadinessWatched, ReadinessWatcher } from "./readiness.gen.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
import { type Result } from "../../std/result.ts";
export * from "./readiness.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/readiness.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/readiness.rs:483
    update_fd_readiness(this: MiriInterpCx, fd: DynFileDescriptionRef, flags: ReadinessUpdateFlags): InterpResult;
    // ---- shims/readiness.rs: `trait EvalContextPrivExt` (impl for `MiriInterpCx`) ----
    // shims/readiness.rs:539
    update_readiness(this: MiriInterpCx, watcher: ReadinessWatcher, active: Readiness, force_edge: boolean, for_each_interest: ((_0: ((_0: ReadinessInterestKey, _1: ReadinessInterest) => InterpResult)) => InterpResult)): InterpResult;
  }
}

declare module "./readiness.gen.ts" {
  interface ReadinessInterest {
    // shims/readiness.rs:115 // PORT: `active_` (a field `active` exists; mir-contract rule)
    active_(): Readiness;
  }
}
declare module "./readiness.gen.ts" {
  interface ReadinessWatcher {
    // shims/readiness.rs:170 // self: &Rc<Self>
    add_interest(fd_num: FdNum, relevant: Readiness, is_edge_triggered: boolean, data: bigint, ecx: MiriInterpCx): InterpResult<Result<null, null>>;
    // shims/readiness.rs:225 // self: &Rc<Self>
    update_interest(key: ReadinessInterestKey, ecx: MiriInterpCx, cb: ((_0: ReadinessInterest) => void)): InterpResult<null | undefined>;
    // shims/readiness.rs:257 // self: &Rc<ReadinessWatcher>
    remove_interest(key: ReadinessInterestKey): null | undefined;
    // shims/readiness.rs:283
    add_blocked_thread(thread_id: ThreadId): void;
    // shims/readiness.rs:290
    remove_blocked_thread(thread_id: ThreadId): void;
    // shims/readiness.rs:296
    ready_count(): number;
    // shims/readiness.rs:309
    get_ready_interests(max: number, ecx: MiriInterpCx): InterpResult<ReadinessInterest[]>;
  }
}
declare module "./readiness.gen.ts" {
  interface ReadinessWatched {
    // shims/readiness.rs:406
    insert(watcher: ReadinessWatcher): void;
    // shims/readiness.rs:419
    remove(watcher: ReadinessWatcher): void;
    // shims/readiness.rs:432
    has_watcher_with_blocked_thread(): boolean;
    // shims/readiness.rs:440
    remove_file_num_interests(fd_id: FdId, fd_num: FdNum): void;
  }
}
declare module "./readiness.gen.ts" {
  interface DelayedReadinessUpdates {
    // shims/readiness.rs:461
    add(fd: DynFileDescriptionRef): void;
  }
  namespace DelayedReadinessUpdates {
    // shims/readiness.rs:465
    export let process: (ecx: MiriInterpCx) => InterpResult;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl std::ops::BitAnd for Readiness (shims/readiness.rs:28): bitand (:31)
// impl std::ops::BitOr for Readiness (shims/readiness.rs:42): bitor (:45)
// impl std::ops::BitOrAssign for Readiness (shims/readiness.rs:56): bitor_assign (:57)
// impl Drop for ReadinessWatcher (shims/readiness.rs:139): drop (:140)
// impl VisitProvenance for ReadinessWatcher (shims/readiness.rs:364): visit_provenance (:365)
// impl Drop for ReadinessWatched (shims/readiness.rs:379): drop (:380)
// fn range_for_id (shims/readiness.rs:92)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::readiness::EvalContextExt", "src/tools/miri/src/shims/readiness.rs", "miri-shims-c", () => InterpCx.prototype, ["update_fd_readiness"]);
stub_methods("miri::shims::readiness::EvalContextPrivExt", "src/tools/miri/src/shims/readiness.rs", "miri-shims-c", () => InterpCx.prototype, ["update_readiness"]);
stub_methods("miri::shims::readiness::ReadinessInterest", "src/tools/miri/src/shims/readiness.rs", "miri-shims-c", () => ReadinessInterest.prototype, ["active_"]);
stub_methods("miri::shims::readiness::ReadinessWatcher", "src/tools/miri/src/shims/readiness.rs", "miri-shims-c", () => ReadinessWatcher.prototype, ["add_interest", "update_interest", "remove_interest", "add_blocked_thread", "remove_blocked_thread", "ready_count", "get_ready_interests"]);
stub_methods("miri::shims::readiness::ReadinessWatched", "src/tools/miri/src/shims/readiness.rs", "miri-shims-c", () => ReadinessWatched.prototype, ["insert", "remove", "has_watcher_with_blocked_thread", "remove_file_num_interests"]);
stub_methods("miri::shims::readiness::DelayedReadinessUpdates", "src/tools/miri/src/shims/readiness.rs", "miri-shims-c", () => DelayedReadinessUpdates.prototype, ["add"]);
stub_statics("miri::shims::readiness::DelayedReadinessUpdates", "src/tools/miri/src/shims/readiness.rs", "miri-shims-c", () => DelayedReadinessUpdates, ["process"]);
