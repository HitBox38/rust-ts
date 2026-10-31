// Port of src/tools/miri/src/concurrency/data_race.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-race` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into data_race.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type AccessType, type AtomicAccessType, type AtomicFenceOrd, AtomicMemoryCellClocks, type AtomicReadOrd, type AtomicRwOrd, type AtomicWriteOrd, type DataRace, FrameState, GlobalState, MemoryCellClocks, type NaReadType, type NaWriteType, ThreadClockSet, VClockAlloc } from "./data_race.gen.ts";
import { type ThreadId, type ThreadManager } from "./thread.ts";
import { type VClock, type VTimestamp, type VectorIdx } from "./vector_clock.ts";
import { type MiriConfig } from "../eval.ts";
import { type ImmTy, type MPlaceTy, type Scalar } from "../lib.ts";
import { type MemoryKind, type MiriInterpCx, type MiriMachine } from "../machine.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { type Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type AtomicRmwOp } from "../../rustc_const_eval/interpret/operator.gen.ts";
import { type AllocRange } from "../../rustc_middle/mir/interpret/allocation.ts";
import { type AllocId, type InterpResult, type Pointer as interpret_Pointer } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Local } from "../../rustc_middle/mir/mod.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
import { type Result } from "../../std/result.ts";
export * from "./data_race.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- concurrency/data_race.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // concurrency/data_race.rs:768
    read_scalar_atomic(this: MiriInterpCx, place: MPlaceTy, atomic: AtomicReadOrd): InterpResult<Scalar>;
    // concurrency/data_race.rs:802
    write_scalar_atomic(this: MiriInterpCx, val: Scalar, dest: MPlaceTy, atomic: AtomicWriteOrd): InterpResult;
    // concurrency/data_race.rs:841
    atomic_rmw(this: MiriInterpCx, place: MPlaceTy, rhs: ImmTy, atomic_op: AtomicRmwOp, ord: AtomicRwOrd): InterpResult<Scalar>;
    // concurrency/data_race.rs:887
    atomic_compare_exchange(this: MiriInterpCx, place: MPlaceTy, expect_old: ImmTy, new_: Scalar, success: AtomicRwOrd, fail: AtomicReadOrd, can_fail_spuriously: boolean): InterpResult<[Scalar, boolean]>;
    // concurrency/data_race.rs:964
    atomic_fence(this: MiriInterpCx, atomic: AtomicFenceOrd): InterpResult;
    // concurrency/data_race.rs:979
    release_clock<R>(this: MiriInterpCx, callback: ((_0: VClock) => R)): InterpResult<R | undefined>;
    // concurrency/data_race.rs:997
    acquire_clock(this: MiriInterpCx, clock: VClock): InterpResult;
    // ---- concurrency/data_race.rs: `trait EvalContextPrivExt` (impl for `MiriInterpCx`) ----
    // concurrency/data_race.rs:1410
    allow_data_races_ref<R>(this: MiriInterpCx, op: ((_0: MiriInterpCx) => R)): R;
    // concurrency/data_race.rs:1422
    allow_data_races_mut<R>(this: MiriInterpCx, op: ((_0: MiriInterpCx) => R)): R;
    // concurrency/data_race.rs:1431
    atomic_access_check(this: MiriInterpCx, place: MPlaceTy, access_type: AtomicAccessType): InterpResult;
    // concurrency/data_race.rs:1487
    validate_atomic_load(this: MiriInterpCx, place: MPlaceTy, atomic: AtomicReadOrd, sync_clock: VClock | undefined): InterpResult;
    // concurrency/data_race.rs:1510
    validate_atomic_store(this: MiriInterpCx, place: MPlaceTy, atomic: AtomicWriteOrd): InterpResult;
    // concurrency/data_race.rs:1532
    validate_atomic_rmw(this: MiriInterpCx, place: MPlaceTy, atomic: AtomicRwOrd): InterpResult;
    // concurrency/data_race.rs:1561
    validate_atomic_op<A>(this: MiriInterpCx, place: MPlaceTy, atomic: A, access: AccessType, op: ((_0: MemoryCellClocks, _1: ThreadClockSet, _2: VectorIdx, _3: A) => Result<null, DataRace>)): InterpResult;
  }
}

declare module "./data_race.gen.ts" {
  interface ThreadClockSet {
    // concurrency/data_race.rs:184
    apply_release_fence(): void;
    // concurrency/data_race.rs:191
    apply_acquire_fence(): void;
    // concurrency/data_race.rs:198
    increment_clock(index: VectorIdx, current_span: Span): void;
    // concurrency/data_race.rs:205
    join_with(other: ThreadClockSet): void;
  }
}
declare module "./data_race.gen.ts" {
  namespace AtomicMemoryCellClocks {
    // concurrency/data_race.rs:472
    function new_(size: Size): AtomicMemoryCellClocks;
    export { new_ as new };
  }
}
declare module "./data_race.gen.ts" {
  interface MemoryCellClocks {
    // concurrency/data_race.rs:495
    write_was_before(other: VClock): boolean;
    // concurrency/data_race.rs:502 // PORT: `write_` (a field `write` exists; mir-contract rule)
    write_(): VClock;
    // concurrency/data_race.rs:508
    atomic(): AtomicMemoryCellClocks | undefined;
    // concurrency/data_race.rs:514
    atomic_mut_unwrap(): AtomicMemoryCellClocks;
    // concurrency/data_race.rs:520
    atomic_access(thread_clocks: ThreadClockSet, size: Size, write: boolean): Result<AtomicMemoryCellClocks, DataRace>;
    // concurrency/data_race.rs:556
    load_acquire(thread_clocks: ThreadClockSet, index: VectorIdx, access_size: Size, sync_clock: VClock | undefined): Result<null, DataRace>;
    // concurrency/data_race.rs:573
    load_relaxed(thread_clocks: ThreadClockSet, index: VectorIdx, access_size: Size, sync_clock: VClock | undefined): Result<null, DataRace>;
    // concurrency/data_race.rs:589
    store_release(thread_clocks: ThreadClockSet, index: VectorIdx, access_size: Size): Result<null, DataRace>;
    // concurrency/data_race.rs:603
    store_relaxed(thread_clocks: ThreadClockSet, index: VectorIdx, access_size: Size): Result<null, DataRace>;
    // concurrency/data_race.rs:623
    rmw_release(thread_clocks: ThreadClockSet, index: VectorIdx, access_size: Size): Result<null, DataRace>;
    // concurrency/data_race.rs:639
    rmw_relaxed(thread_clocks: ThreadClockSet, index: VectorIdx, access_size: Size): Result<null, DataRace>;
    // concurrency/data_race.rs:655
    atomic_read_detect(thread_clocks: ThreadClockSet, index: VectorIdx, access_size: Size): Result<null, DataRace>;
    // concurrency/data_race.rs:670
    atomic_write_detect(thread_clocks: ThreadClockSet, index: VectorIdx, access_size: Size): Result<null, DataRace>;
    // concurrency/data_race.rs:689
    non_atomic_read_detect(thread_clocks: ThreadClockSet, index: VectorIdx, read_type: NaReadType, current_span: Span): Result<null, DataRace>;
    // concurrency/data_race.rs:716
    non_atomic_write_detect(thread_clocks: ThreadClockSet, index: VectorIdx, write_type: NaWriteType, current_span: Span): Result<null, DataRace>;
  }
  namespace MemoryCellClocks {
    // concurrency/data_race.rs:485
    function new_(alloc: VTimestamp, alloc_index: VectorIdx): MemoryCellClocks;
    export { new_ as new };
  }
}
declare module "./data_race.gen.ts" {
  interface VClockAlloc {
    // concurrency/data_race.rs:1198
    sync_clock(access_range: AllocRange): VClock;
    // concurrency/data_race.rs:1215
    read_non_atomic(alloc_id: AllocId, access_range: AllocRange, read_type: NaReadType, ty: Ty | undefined, machine: MiriMachine): InterpResult;
    // concurrency/data_race.rs:1260
    write_non_atomic(alloc_id: AllocId, access_range: AllocRange, write_type: NaWriteType, ty: Ty | undefined, machine: MiriMachine): InterpResult;
  }
  namespace VClockAlloc {
    // concurrency/data_race.rs:1027
    export let new_allocation: (global: GlobalState, thread_mgr: ThreadManager, len: Size, kind: MemoryKind, current_span: Span) => VClockAlloc;
    // concurrency/data_race.rs:1074
    export let find_gt_index: (l: VClock, r: VClock) => VectorIdx | undefined;
    // concurrency/data_race.rs:1111
    export let report_data_race: (global: GlobalState, thread_mgr: ThreadManager, mem_clocks: MemoryCellClocks, access: AccessType, access_size: Size, ptr_dbg: interpret_Pointer<AllocId>, ty: Ty | undefined) => InterpResult;
  }
}
declare module "./data_race.gen.ts" {
  interface FrameState {
    // concurrency/data_race.rs:1324
    local_write(local: Local, storage_live: boolean, machine: MiriMachine): void;
    // concurrency/data_race.rs:1354
    local_read(local: Local, machine: MiriMachine): void;
    // concurrency/data_race.rs:1373
    local_moved_to_memory(local: Local, alloc: VClockAlloc, machine: MiriMachine): void;
  }
}
declare module "./data_race.gen.ts" {
  interface GlobalState {
    // concurrency/data_race.rs:1674
    race_detecting(): boolean;
    // concurrency/data_race.rs:1678 // PORT: `ongoing_action_data_race_free_` (a field `ongoing_action_data_race_free` exists; mir-contract rule)
    ongoing_action_data_race_free_(): boolean;
    // concurrency/data_race.rs:1684
    find_vector_index_reuse_candidate(): VectorIdx | undefined;
    // concurrency/data_race.rs:1716
    thread_created(thread_mgr: ThreadManager, thread: ThreadId, current_span: Span): void;
    // concurrency/data_race.rs:1786
    thread_joined(threads: ThreadManager, joinee: ThreadId): void;
    // concurrency/data_race.rs:1828
    thread_terminated(thread_mgr: ThreadManager): void;
    // concurrency/data_race.rs:1843
    atomic_fence(machine: MiriMachine, atomic: AtomicFenceOrd): InterpResult;
    // concurrency/data_race.rs:1893
    maybe_perform_sync_operation(thread_mgr: ThreadManager, current_span: Span, op: ((_0: VectorIdx, _1: Pending<"RefMut<'_, ThreadClockSet>">) => InterpResult<boolean>)): InterpResult;
    // concurrency/data_race.rs:1911
    print_thread_metadata(thread_mgr: ThreadManager, vector: VectorIdx): string;
    // concurrency/data_race.rs:1921
    acquire_clock(clock: VClock, threads: ThreadManager): void;
    // concurrency/data_race.rs:1930
    release_clock<R>(threads: ThreadManager, callback: ((_0: VClock) => R)): R;
    // concurrency/data_race.rs:1946
    thread_index(thread: ThreadId): VectorIdx;
    // concurrency/data_race.rs:1953
    thread_state_mut(thread: ThreadId): [VectorIdx, Pending<"RefMut<'_, ThreadClockSet>">];
    // concurrency/data_race.rs:1963
    thread_state(thread: ThreadId): [VectorIdx, Pending<"Ref<'_, ThreadClockSet>">];
    // concurrency/data_race.rs:1973
    active_thread_state(thread_mgr: ThreadManager): [VectorIdx, Pending<"Ref<'_, ThreadClockSet>">];
    // concurrency/data_race.rs:1983
    active_thread_state_mut(thread_mgr: ThreadManager): [VectorIdx, Pending<"RefMut<'_, ThreadClockSet>">];
    // concurrency/data_race.rs:1993
    active_thread_index(thread_mgr: ThreadManager): VectorIdx;
    // concurrency/data_race.rs:1999
    sc_write(thread_mgr: ThreadManager): void;
    // concurrency/data_race.rs:2005
    sc_read(thread_mgr: ThreadManager): void;
  }
  namespace GlobalState {
    // concurrency/data_race.rs:1645
    function new_(config: MiriConfig): GlobalState;
    export { new_ as new };
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl AtomicRwOrd (concurrency/data_race.rs:75) [AtomicRwOrd is not a generated class: companion fns / hand type, lane decides]: from (:76)
// impl AtomicReadOrd (concurrency/data_race.rs:96) [AtomicReadOrd is not a generated class: companion fns / hand type, lane decides]: from (:97)
// impl AtomicWriteOrd (concurrency/data_race.rs:116) [AtomicWriteOrd is not a generated class: companion fns / hand type, lane decides]: from (:117)
// impl AtomicFenceOrd (concurrency/data_race.rs:137) [AtomicFenceOrd is not a generated class: companion fns / hand type, lane decides]: from (:138)
// impl NaReadType (concurrency/data_race.rs:266) [NaReadType is not a generated class: companion fns / hand type, lane decides]: description (:267)
// impl NaWriteType (concurrency/data_race.rs:295) [NaWriteType is not a generated class: companion fns / hand type, lane decides]: description (:296)
// impl VisitProvenance for GlobalState (concurrency/data_race.rs:412): visit_provenance (:413)
// impl AccessType (concurrency/data_race.rs:418) [AccessType is not a generated class: companion fns / hand type, lane decides]: description (:419), is_atomic (:449), is_read (:456), is_retag (:463)
// impl GlobalDataRaceHandler (concurrency/data_race.rs:747) [GlobalDataRaceHandler is not a generated class: companion fns / hand type, lane decides]: set_ongoing_action_data_race_free (:750)
// impl VisitProvenance for VClockAlloc (concurrency/data_race.rs:1019): visit_provenance (:1020)
// impl Default for LocalClocks (concurrency/data_race.rs:1317): default (:1318)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::concurrency::data_race::EvalContextExt", "src/tools/miri/src/concurrency/data_race.rs", "miri-race", () => InterpCx.prototype, ["read_scalar_atomic", "write_scalar_atomic", "atomic_rmw", "atomic_compare_exchange", "atomic_fence", "release_clock", "acquire_clock"]);
stub_methods("miri::concurrency::data_race::EvalContextPrivExt", "src/tools/miri/src/concurrency/data_race.rs", "miri-race", () => InterpCx.prototype, ["allow_data_races_ref", "allow_data_races_mut", "atomic_access_check", "validate_atomic_load", "validate_atomic_store", "validate_atomic_rmw", "validate_atomic_op"]);
stub_methods("miri::concurrency::data_race::ThreadClockSet", "src/tools/miri/src/concurrency/data_race.rs", "miri-race", () => ThreadClockSet.prototype, ["apply_release_fence", "apply_acquire_fence", "increment_clock", "join_with"]);
stub_statics("miri::concurrency::data_race::AtomicMemoryCellClocks", "src/tools/miri/src/concurrency/data_race.rs", "miri-race", () => AtomicMemoryCellClocks, ["new"]);
stub_methods("miri::concurrency::data_race::MemoryCellClocks", "src/tools/miri/src/concurrency/data_race.rs", "miri-race", () => MemoryCellClocks.prototype, ["write_was_before", "write_", "atomic", "atomic_mut_unwrap", "atomic_access", "load_acquire", "load_relaxed", "store_release", "store_relaxed", "rmw_release", "rmw_relaxed", "atomic_read_detect", "atomic_write_detect", "non_atomic_read_detect", "non_atomic_write_detect"]);
stub_statics("miri::concurrency::data_race::MemoryCellClocks", "src/tools/miri/src/concurrency/data_race.rs", "miri-race", () => MemoryCellClocks, ["new"]);
stub_methods("miri::concurrency::data_race::VClockAlloc", "src/tools/miri/src/concurrency/data_race.rs", "miri-race", () => VClockAlloc.prototype, ["sync_clock", "read_non_atomic", "write_non_atomic"]);
stub_statics("miri::concurrency::data_race::VClockAlloc", "src/tools/miri/src/concurrency/data_race.rs", "miri-race", () => VClockAlloc, ["new_allocation", "find_gt_index", "report_data_race"]);
stub_methods("miri::concurrency::data_race::FrameState", "src/tools/miri/src/concurrency/data_race.rs", "miri-race", () => FrameState.prototype, ["local_write", "local_read", "local_moved_to_memory"]);
stub_methods("miri::concurrency::data_race::GlobalState", "src/tools/miri/src/concurrency/data_race.rs", "miri-race", () => GlobalState.prototype, ["race_detecting", "ongoing_action_data_race_free_", "find_vector_index_reuse_candidate", "thread_created", "thread_joined", "thread_terminated", "atomic_fence", "maybe_perform_sync_operation", "print_thread_metadata", "acquire_clock", "release_clock", "thread_index", "thread_state_mut", "thread_state", "active_thread_state", "active_thread_state_mut", "active_thread_index", "sc_write", "sc_read"]);
stub_statics("miri::concurrency::data_race::GlobalState", "src/tools/miri/src/concurrency/data_race.rs", "miri-race", () => GlobalState, ["new"]);
