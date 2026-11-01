// Port of src/tools/miri/src/concurrency/thread.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-threads` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into thread.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type Deadline } from "../clock.ts";
import { type BlockReason, type DynUnblockCallback, Thread, ThreadId, type ThreadLookupError, ThreadManager, type TlsAllocAction } from "./thread.gen.ts";
import { type MiriConfig } from "../eval.ts";
import { type ImmTy, type MPlaceTy, type Pointer, type Scalar, type StrictPointer } from "../lib.ts";
import { type FrameExtra, type MiriInterpCx, type Provenance } from "../machine.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { type ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type Frame } from "../../rustc_const_eval/interpret/stack.gen.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type DefId } from "../../rustc_span/def_id.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
import { type Debug } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import { type Result } from "../../std/result.ts";
export * from "./thread.gen.ts";

// rustc-type: src/tools/miri/src/concurrency/thread.rs:202 StackEmptyCallback
/** `Box<dyn FnMut(&mut MiriInterpCx<'tcx>) -> InterpResult<'tcx, Poll<()>> + 'tcx>` (PORT: `std::task::Poll` has no src/std stand-in yet). */
export type StackEmptyCallback = (ecx: MiriInterpCx) => InterpResult<Pending<"Poll<()>">>;

// ---- manual impls the generated modules call (stand-ins until the fill lane ports them) ----
/** `impl Debug for Thread` (src/tools/miri/src/concurrency/thread.rs:293): lane miri-threads. */
export const debug_Thread: Debug<Thread> = (_v, _f) => unported("miri::concurrency::thread::Thread: Debug (src/tools/miri/src/concurrency/thread.rs:293; lane miri-threads)");

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- concurrency/thread.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // concurrency/thread.rs:631
    thread_id_try_from(this: MiriInterpCx, id: Pending<"impl TryInto<u32>">): Result<ThreadId, ThreadLookupError>;
    // concurrency/thread.rs:637
    get_or_create_thread_local_alloc(this: MiriInterpCx, def_id: DefId): InterpResult<StrictPointer>;
    // concurrency/thread.rs:679
    start_regular_thread(this: MiriInterpCx, thread: MPlaceTy | undefined, start_routine: Pointer, start_abi: ExternAbi, func_arg: ImmTy, ret_layout: TyAndLayout): InterpResult<ThreadId>;
    // concurrency/thread.rs:754
    terminate_active_thread(this: MiriInterpCx, tls_alloc_action: TlsAllocAction): InterpResult;
    // concurrency/thread.rs:822
    block_thread(this: MiriInterpCx, reason: BlockReason, deadline: Deadline | undefined, callback: DynUnblockCallback): void;
    // concurrency/thread.rs:840
    unblock_thread(this: MiriInterpCx, thread: ThreadId, reason: BlockReason): InterpResult;
    // concurrency/thread.rs:865
    unblock_expired_deadlines(this: MiriInterpCx): InterpResult<Pending<"Duration"> | undefined>;
    // concurrency/thread.rs:918
    detach_thread(this: MiriInterpCx, thread_id: ThreadId, allow_terminated_joined: boolean): InterpResult;
    // concurrency/thread.rs:930
    join_thread(this: MiriInterpCx, joined_thread_id: ThreadId, success_retval: Scalar, return_dest: MPlaceTy): InterpResult;
    // concurrency/thread.rs:1002
    join_thread_exclusive(this: MiriInterpCx, joined_thread_id: ThreadId, success_retval: Scalar, return_dest: MPlaceTy): InterpResult;
    // concurrency/thread.rs:1030
    active_thread(this: MiriInterpCx): ThreadId;
    // concurrency/thread.rs:1036
    active_thread_mut(this: MiriInterpCx): Thread;
    // concurrency/thread.rs:1042
    active_thread_ref(this: MiriInterpCx): Thread;
    // concurrency/thread.rs:1048
    get_total_thread_count(this: MiriInterpCx): number;
    // concurrency/thread.rs:1054
    have_all_terminated(this: MiriInterpCx): boolean;
    // concurrency/thread.rs:1060
    enable_thread(this: MiriInterpCx, thread_id: ThreadId): void;
    // concurrency/thread.rs:1066
    active_thread_stack(this: MiriInterpCx): readonly Frame<Provenance, FrameExtra>[];
    // concurrency/thread.rs:1072
    active_thread_stack_mut(this: MiriInterpCx): Frame<Provenance, FrameExtra>[];
    // concurrency/thread.rs:1081
    set_thread_name(this: MiriInterpCx, thread: ThreadId, new_thread_name: Uint8Array): void;
    // concurrency/thread.rs:1086
    get_thread_name(this: MiriInterpCx, thread: ThreadId): Uint8Array | undefined;
    // concurrency/thread.rs:1094
    yield_active_thread(this: MiriInterpCx): void;
    // concurrency/thread.rs:1102
    maybe_preempt_active_thread(this: MiriInterpCx): void;
  }
}

declare module "./thread.gen.ts" {
  interface ThreadId {
    // concurrency/thread.rs:50
    to_u32(): number;
  }
  namespace ThreadId {
    // concurrency/thread.rs:55
    export let new_unchecked: (id: number) => ThreadId;
  }
}
declare module "./thread.gen.ts" {
  interface Thread {
    // concurrency/thread.rs:208 // PORT: `thread_name_` (a field `thread_name` exists; mir-contract rule)
    thread_name_(): Uint8Array | undefined;
    // concurrency/thread.rs:213
    is_enabled(): boolean;
    // concurrency/thread.rs:217
    is_terminated(): boolean;
    // concurrency/thread.rs:221
    is_blocked_on(reason: BlockReason): boolean;
    // concurrency/thread.rs:226
    thread_display_name(id: ThreadId): string;
    // concurrency/thread.rs:239
    compute_top_user_relevant_frame(skip: number): number | undefined;
    // concurrency/thread.rs:259
    recompute_top_user_relevant_frame(skip: number): void;
    // concurrency/thread.rs:265
    set_top_user_relevant_frame(frame_idx: number): void;
    // concurrency/thread.rs:272 // PORT: `top_user_relevant_frame_` (a field `top_user_relevant_frame` exists; mir-contract rule)
    top_user_relevant_frame_(): number | undefined;
    // concurrency/thread.rs:279
    current_user_relevance(): number;
    // concurrency/thread.rs:285
    current_user_relevant_span(): Span;
  }
  namespace Thread {
    // concurrency/thread.rs:306
    function new_(name: string | undefined, on_stack_empty: StackEmptyCallback | undefined): Thread;
    export { new_ as new };
  }
}
declare module "./thread.gen.ts" {
  interface ThreadManager {
    // concurrency/thread.rs:452
    thread_id_try_from(id: Pending<"impl TryInto<u32>">): Result<ThreadId, ThreadLookupError>;
    // concurrency/thread.rs:469
    get_thread_local_alloc_id(def_id: DefId): StrictPointer | undefined;
    // concurrency/thread.rs:477
    set_thread_local_alloc(def_id: DefId, ptr: StrictPointer): void;
    // concurrency/thread.rs:482
    active_thread_stack(): readonly Frame<Provenance, FrameExtra>[];
    // concurrency/thread.rs:487
    active_thread_stack_mut(): Frame<Provenance, FrameExtra>[];
    // concurrency/thread.rs:493
    all_threads(): Iterable<[ThreadId, Thread]>;
    // concurrency/thread.rs:497
    all_blocked_stacks(): Iterable<[ThreadId, readonly Frame<Provenance, FrameExtra>[]]>;
    // concurrency/thread.rs:507
    create_thread(on_stack_empty: StackEmptyCallback): ThreadId;
    // concurrency/thread.rs:514
    set_active_thread(id: ThreadId): ThreadId;
    // concurrency/thread.rs:525 // PORT: `active_thread_` (a field `active_thread` exists; mir-contract rule)
    active_thread_(): ThreadId;
    // concurrency/thread.rs:530
    get_total_thread_count(): number;
    // concurrency/thread.rs:536
    get_live_thread_count(): number;
    // concurrency/thread.rs:541
    has_terminated(thread_id: ThreadId): boolean;
    // concurrency/thread.rs:546
    have_all_terminated(): boolean;
    // concurrency/thread.rs:551
    enable_thread(thread_id: ThreadId): void;
    // concurrency/thread.rs:557
    active_thread_mut(): Thread;
    // concurrency/thread.rs:562
    active_thread_ref(): Thread;
    // concurrency/thread.rs:566
    thread_ref(thread_id: ThreadId): Thread;
    // concurrency/thread.rs:578
    detach_thread(id: ThreadId, allow_terminated_joined: boolean): InterpResult;
    // concurrency/thread.rs:597
    set_thread_name(thread: ThreadId, new_thread_name: Uint8Array): void;
    // concurrency/thread.rs:602
    get_thread_name(thread: ThreadId): Uint8Array | undefined;
    // concurrency/thread.rs:606
    get_thread_display_name(thread: ThreadId): string;
    // concurrency/thread.rs:611
    block_thread(reason: BlockReason, deadline: Deadline | undefined, callback: DynUnblockCallback): void;
    // concurrency/thread.rs:622 // PORT: `fixed_scheduling_` (a field `fixed_scheduling` exists; mir-contract rule)
    fixed_scheduling_(): boolean;
  }
  namespace ThreadManager {
    // concurrency/thread.rs:423
    function new_(config: MiriConfig): ThreadManager;
    export { new_ as new };
    // concurrency/thread.rs:436
    export let init: (ecx: MiriInterpCx, on_main_stack_empty: StackEmptyCallback) => void;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl Idx for ThreadId (concurrency/thread.rs:62): new (:63), index (:67)
// impl From<ThreadId> for u64 (concurrency/thread.rs:72): from (:73)
// impl std::fmt::Debug for ThreadState<'tcx> (concurrency/thread.rs:120): fmt (:121)
// impl ThreadState<'tcx> (concurrency/thread.rs:134) [ThreadState is not a generated class: companion fns / hand type, lane decides]: is_enabled (:135), is_terminated (:139), is_blocked_on (:143)
// impl std::fmt::Debug for Thread<'tcx> (concurrency/thread.rs:293): fmt (:294)
// impl VisitProvenance for Thread<'_> (concurrency/thread.rs:321): visit_provenance (:322)
// impl VisitProvenance for Frame<'_, Provenance, FrameExtra<'_>> (concurrency/thread.rs:345): visit_provenance (:346)
// impl VisitProvenance for ThreadManager<'_> (concurrency/thread.rs:403): visit_provenance (:404)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::concurrency::thread::EvalContextExt", "src/tools/miri/src/concurrency/thread.rs", "miri-threads", () => InterpCx.prototype, ["thread_id_try_from", "get_or_create_thread_local_alloc", "start_regular_thread", "terminate_active_thread", "block_thread", "unblock_thread", "unblock_expired_deadlines", "detach_thread", "join_thread", "join_thread_exclusive", "active_thread", "active_thread_mut", "active_thread_ref", "get_total_thread_count", "have_all_terminated", "enable_thread", "active_thread_stack", "active_thread_stack_mut", "set_thread_name", "get_thread_name", "yield_active_thread", "maybe_preempt_active_thread"]);
stub_methods("miri::concurrency::thread::ThreadId", "src/tools/miri/src/concurrency/thread.rs", "miri-threads", () => ThreadId.prototype, ["to_u32"]);
stub_statics("miri::concurrency::thread::ThreadId", "src/tools/miri/src/concurrency/thread.rs", "miri-threads", () => ThreadId, ["new_unchecked"]);
stub_methods("miri::concurrency::thread::Thread", "src/tools/miri/src/concurrency/thread.rs", "miri-threads", () => Thread.prototype, ["thread_name_", "is_enabled", "is_terminated", "is_blocked_on", "thread_display_name", "compute_top_user_relevant_frame", "recompute_top_user_relevant_frame", "set_top_user_relevant_frame", "top_user_relevant_frame_", "current_user_relevance", "current_user_relevant_span"]);
stub_statics("miri::concurrency::thread::Thread", "src/tools/miri/src/concurrency/thread.rs", "miri-threads", () => Thread, ["new"]);
stub_methods("miri::concurrency::thread::ThreadManager", "src/tools/miri/src/concurrency/thread.rs", "miri-threads", () => ThreadManager.prototype, ["thread_id_try_from", "get_thread_local_alloc_id", "set_thread_local_alloc", "active_thread_stack", "active_thread_stack_mut", "all_threads", "all_blocked_stacks", "create_thread", "set_active_thread", "active_thread_", "get_total_thread_count", "get_live_thread_count", "has_terminated", "have_all_terminated", "enable_thread", "active_thread_mut", "active_thread_ref", "thread_ref", "detach_thread", "set_thread_name", "get_thread_name", "get_thread_display_name", "block_thread", "fixed_scheduling_"]);
stub_statics("miri::concurrency::thread::ThreadManager", "src/tools/miri/src/concurrency/thread.rs", "miri-threads", () => ThreadManager, ["new", "init"]);
