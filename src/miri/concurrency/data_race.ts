// Port of src/tools/miri/src/concurrency/data_race.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-race` (wave 36); notes after
// the upstream module docs.
//! Implementation of a data-race detector using Lamport Timestamps / Vector clocks
//! based on the Dynamic Race Detection for C++:
//! <https://www.doc.ic.ac.uk/~afd/homepages/papers/pdfs/2017/POPL.pdf>
//! which does not report false-positives when fences are used, and gives better
//! accuracy in presence of read-modify-write operations.
//!
//! The implementation contains modifications to correctly model the changes to the memory model in C++20
//! regarding the weakening of release sequences: <http://www.open-std.org/jtc1/sc22/wg21/docs/papers/2018/p0982r1.html>.
//! Relaxed stores now unconditionally block all currently active release sequences and so per-thread tracking of release
//! sequences is not needed.
//!
//! The implementation also models races with memory allocation and deallocation via treating allocation and
//! deallocation as a type of write internally for detecting data-races.
//!
//! Weak memory orders are explored but not all weak behaviours are exhibited, so it can still miss data-races
//! but should not report false-positives
//!
//! Data-race definition from(<https://en.cppreference.com/w/cpp/language/memory_model#Threads_and_data_races>):
//! a data race occurs between two memory accesses if they are on different threads, at least one operation
//! is non-atomic, at least one operation is a write and neither access happens-before the other. Read the link
//! for full definition.
//!
//! This re-uses vector indexes for threads that are known to be unable to report data-races, this is valid
//! because it only re-uses vector indexes once all currently-active (not-terminated) threads have an internal
//! vector clock that happens-after the join operation of the candidate thread. Threads that have not been joined
//! on are not considered. Since the thread's vector clock will only increase and a data-race implies that
//! there is some index x where `clock[x] > thread_clock`, when this is true `clock[candidate-idx] > thread_clock`
//! can never hold and hence a data-race can never be reported in that vector index again.
//! This means that the thread-index can be safely re-used, starting on the next timestamp for the newly created
//! thread.
//!
//! The timestamps used in the data-race detector assign each sequence of non-atomic operations
//! followed by a single atomic or concurrent operation a single timestamp.
//! Write, Read, Write, ThreadJoin will be represented by a single timestamp value on a thread.
//! This is because extra increment operations between the operations in the sequence are not
//! required for accurate reporting of data-race values.
//!
//! As per the paper a threads timestamp is only incremented after a release operation is performed
//! so some atomic operations that only perform acquires do not increment the timestamp. Due to shared
//! code some atomic operations may increment the timestamp when not necessary but this has no effect
//! on the data-race detection code.
//
// Its types are generated into data_race.gen.ts (tools/codegen set `miri`); this module re-exports them and adds the methods.
// PORT (PORTING §5): `Cell` / `RefCell` fields are the values themselves; `Ref` / `RefMut` guards are the borrowed
// object (`thread_state_mut` returns the `ThreadClockSet`), and the dynamic borrow checks are not modelled. `IndexVec`s are
// arrays indexed by `VectorIdx::index()` / `ThreadId`'s `Idx::index` (its `u32`, `._0`). `Box<AtomicMemoryCellClocks>` is
// the object. `VTimestamp` is `Copy`: every copy that lands in a mutable slot is `clone_VTimestamp` (vector_clock.ts
// header). `Result<(), DataRace>` values are the shared frozen `OK` / `DATA_RACE_ERR` below (the hot per-byte checks
// allocate nothing).
// PORT: GenMC arms stop `unported("genmc")` (decision C7: the component is built without GenMC, so `GenmcCtx` is
// concurrency/genmc/dummy.rs and nothing can construct one).
// PORT: `trace!` lines are kept as comments (A6: only `info!` events are ported, by lane miri-log; this file has none).
import * as gen from "./data_race.gen.ts";
import { AtomicAccessType, AtomicMemoryCellClocks, FrameState, GlobalState, type LocalClocks, MemoryCellClocks, ThreadClockSet, type ThreadExtraState, VClockAlloc } from "./data_race.gen.ts";
import { GlobalDataRaceHandler, AllocDataRaceHandler } from "./data_race_handler.ts";
import { ThreadId, type ThreadManager } from "./thread.ts";
import { VClock, VTimestamp, VectorIdx, VTimestamp_cmp, clone_VClock } from "./vector_clock.ts";
import { clone_VTimestamp } from "./vector_clock.gen.ts";
import { DedupRangeMap } from "../data_structures/dedup_range_map.ts";
import { type RacingOp, type TerminationInfo } from "../diagnostics.ts";
import { type MiriConfig } from "../eval.ts";
import { type ImmTy, type MPlaceTy, type Scalar } from "../lib.ts";
import { type MemoryKind, type MiriInterpCx, type MiriMachine, type Provenance } from "../machine.ts";
import { type VisitWith } from "../provenance_gc.ts";
import { FxHashSet, type KeyType } from "../../rust_ts/hash_map.ts";
import { Align, Size, Size_cmp, Size_eq, debug_AlignFromBytesError } from "../../rustc_abi/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { Immediate } from "../../rustc_const_eval/interpret/operand.ts";
import { type AtomicRmwOp } from "../../rustc_const_eval/interpret/operator.gen.ts";
import { type AllocRange } from "../../rustc_middle/mir/interpret/allocation.ts";
import { InterpErrorInfo_from_InterpErrorKind, InterpResult, interp_ok, type InterpErrorInfo, type MachineStopType } from "../../rustc_middle/mir/interpret/error.ts";
import { type AllocId } from "../../rustc_middle/mir/interpret/mod.ts";
import { Pointer as interpret_Pointer } from "../../rustc_middle/mir/interpret/pointer.ts";
import { Scalar as interpret_Scalar } from "../../rustc_middle/mir/interpret/value.ts";
import { type Local } from "../../rustc_middle/mir/mod.ts";
import { type AtomicOrdering } from "../../rustc_middle/ty/consts/int.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { Span } from "../../rustc_span/lib.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Unported, assert, panic, unported, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, expect_result, unwrap_result, type Result } from "../../std/result.ts";
import { RngExt, type Rng } from "../../vendor/rand/lib.ts";
export * from "./data_race.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
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
    release_clock<R>(this: MiriInterpCx, callback: (_0: VClock) => R): InterpResult<R | undefined>;
    // concurrency/data_race.rs:997
    acquire_clock(this: MiriInterpCx, clock: VClock): InterpResult;
    // ---- concurrency/data_race.rs: `trait EvalContextPrivExt` (impl for `MiriInterpCx`) ----
    // concurrency/data_race.rs:1410
    allow_data_races_ref<R>(this: MiriInterpCx, op: (_0: MiriInterpCx) => R): R;
    // concurrency/data_race.rs:1422
    allow_data_races_mut<R>(this: MiriInterpCx, op: (_0: MiriInterpCx) => R): R;
    // concurrency/data_race.rs:1431
    atomic_access_check(this: MiriInterpCx, place: MPlaceTy, access_type: AtomicAccessType): InterpResult;
    // concurrency/data_race.rs:1487
    validate_atomic_load(this: MiriInterpCx, place: MPlaceTy, atomic: AtomicReadOrd, sync_clock: VClock | undefined): InterpResult;
    // concurrency/data_race.rs:1510
    validate_atomic_store(this: MiriInterpCx, place: MPlaceTy, atomic: AtomicWriteOrd): InterpResult;
    // concurrency/data_race.rs:1532
    validate_atomic_rmw(this: MiriInterpCx, place: MPlaceTy, atomic: AtomicRwOrd): InterpResult;
    // concurrency/data_race.rs:1561
    validate_atomic_op<A>(this: MiriInterpCx, place: MPlaceTy, atomic: A, access: AccessType, op: (_0: MemoryCellClocks, _1: ThreadClockSet, _2: VectorIdx, _3: A) => Result<undefined, DataRace>): InterpResult;
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
  namespace ThreadClockSet {
    /** `#[derive(Default)]` (concurrency/data_race.rs:153). */
    function default_(): ThreadClockSet;
    export { default_ as default };
  }
}
declare module "./data_race.gen.ts" {
  interface GlobalState {
    // impl VisitProvenance for GlobalState: concurrency/data_race.rs:413
    visit_provenance(visit: VisitWith): void;
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
    load_acquire(thread_clocks: ThreadClockSet, index: VectorIdx, access_size: Size, sync_clock: VClock | undefined): Result<undefined, DataRace>;
    // concurrency/data_race.rs:573
    load_relaxed(thread_clocks: ThreadClockSet, index: VectorIdx, access_size: Size, sync_clock: VClock | undefined): Result<undefined, DataRace>;
    // concurrency/data_race.rs:589
    store_release(thread_clocks: ThreadClockSet, index: VectorIdx, access_size: Size): Result<undefined, DataRace>;
    // concurrency/data_race.rs:603
    store_relaxed(thread_clocks: ThreadClockSet, index: VectorIdx, access_size: Size): Result<undefined, DataRace>;
    // concurrency/data_race.rs:623
    rmw_release(thread_clocks: ThreadClockSet, index: VectorIdx, access_size: Size): Result<undefined, DataRace>;
    // concurrency/data_race.rs:639
    rmw_relaxed(thread_clocks: ThreadClockSet, index: VectorIdx, access_size: Size): Result<undefined, DataRace>;
    // concurrency/data_race.rs:655
    atomic_read_detect(thread_clocks: ThreadClockSet, index: VectorIdx, access_size: Size): Result<undefined, DataRace>;
    // concurrency/data_race.rs:670
    atomic_write_detect(thread_clocks: ThreadClockSet, index: VectorIdx, access_size: Size): Result<undefined, DataRace>;
    // concurrency/data_race.rs:689
    non_atomic_read_detect(thread_clocks: ThreadClockSet, index: VectorIdx, read_type: NaReadType, current_span: Span): Result<undefined, DataRace>;
    // concurrency/data_race.rs:716
    non_atomic_write_detect(thread_clocks: ThreadClockSet, index: VectorIdx, write_type: NaWriteType, current_span: Span): Result<undefined, DataRace>;
  }
  namespace MemoryCellClocks {
    // concurrency/data_race.rs:485
    function new_(alloc: VTimestamp, alloc_index: VectorIdx): MemoryCellClocks;
    export { new_ as new };
  }
}
declare module "./data_race.gen.ts" {
  interface VClockAlloc {
    // impl VisitProvenance for VClockAlloc: concurrency/data_race.rs:1020
    visit_provenance(visit: VisitWith): void;
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
  namespace FrameState {
    /** `#[derive(Default)]` (concurrency/data_race.rs:1302). */
    function default_(): FrameState;
    export { default_ as default };
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
    maybe_perform_sync_operation(thread_mgr: ThreadManager, current_span: Span, op: (_0: VectorIdx, _1: ThreadClockSet) => InterpResult<boolean>): InterpResult;
    // concurrency/data_race.rs:1911
    print_thread_metadata(thread_mgr: ThreadManager, vector: VectorIdx): string;
    // concurrency/data_race.rs:1921
    acquire_clock(clock: VClock, threads: ThreadManager): void;
    // concurrency/data_race.rs:1930
    release_clock<R>(threads: ThreadManager, callback: (_0: VClock) => R): R;
    // concurrency/data_race.rs:1946
    thread_index(thread: ThreadId): VectorIdx;
    // concurrency/data_race.rs:1953
    thread_state_mut(thread: ThreadId): [VectorIdx, ThreadClockSet];
    // concurrency/data_race.rs:1963
    thread_state(thread: ThreadId): [VectorIdx, ThreadClockSet];
    // concurrency/data_race.rs:1973
    active_thread_state(thread_mgr: ThreadManager): [VectorIdx, ThreadClockSet];
    // concurrency/data_race.rs:1983
    active_thread_state_mut(thread_mgr: ThreadManager): [VectorIdx, ThreadClockSet];
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

// ---- module-private helpers (PORT, not upstream fns) ----

/** `Ok(())` / `Err(DataRace)` of the per-byte checks (module header). */
const OK: Result<undefined, DataRace> = Object.freeze(Ok(undefined));
const DATA_RACE: DataRace = Object.freeze({});
const DATA_RACE_ERR: Result<never, DataRace> = Object.freeze(Err(DATA_RACE));

/** `index_vec[i]` (`IndexVec` / slice indexing panics out of bounds). */
function at<T>(v: readonly T[], i: number): T {
  const x = v[i];
  if (x === undefined) panic(`index out of bounds: the len is ${v.length} but the index is ${i}`);
  return x;
}

/** `ThreadId`'s `Idx::index` (concurrency/thread.rs:67: `self.0` as `usize`). PORT(contract): pending miri-threads
 * (`impl Idx for ThreadId` is only in thread.ts's inventory). */
function thread_idx(thread: ThreadId): number {
  return thread._0;
}

/** `ThreadId::MAIN_THREAD` (concurrency/thread.rs:59: `ThreadId(0)`). PORT(contract): pending miri-threads (the
 * associated const is not declared in thread.ts). */
function main_thread(): ThreadId {
  return new ThreadId(0);
}

/** The interned `VectorIdx` equal to `idx` (vector_clock.ts: `===` is `Eq` only for interned instances), for the
 * `FxHashSet<VectorIdx>`. */
function canon(idx: VectorIdx): VectorIdx {
  return VectorIdx.from(idx.to_u32());
}

/** `#[derive(Hash)]` of `VectorIdx(u32)`: `write_u32`; `size_of::<VectorIdx>() == 4`. */
const VectorIdx_key: KeyType<VectorIdx> = { hash: (k, state) => state.write_u32(k._0), size: 4, align: 4 };

/** The start of a `DedupRangeMap` iteration range. PORT(contract): pending miri-driver: `DedupRangeMap::iter*` yield
 * `(ops::Range<u64>, &T)`, declared with a `Pending` range; the stored `Elem.range` is `{ start: number; end: number }`
 * (decision C5 amendment). */
function range_start(range: Pending<"ops::Range<u64>">): number {
  return (range as unknown as { start: number }).start;
}

/** `Immediate::to_scalar` of a Miri immediate. PORT(contract): pending interp-generic: rustc_const_eval's
 * `Immediate.to_scalar` is typed for `CtfeProvenance` only; its body is provenance-agnostic. */
function imm_to_scalar(imm: Immediate<Provenance>): Scalar {
  return Immediate.to_scalar(imm as unknown as Immediate) as unknown as Scalar;
}

/** `err_machine_stop!(TerminationInfo::..)`: `InterpErrorKind::MachineStop(Box::new(info))`. */
function err_machine_stop(info: TerminationInfo): InterpErrorInfo {
  return InterpErrorInfo_from_InterpErrorKind({ $: "MachineStop", _0: TerminationInfo_as_MachineStopType(info) });
}

/** `Box<dyn MachineStopType>` of a `TerminationInfo`. PORT(contract): pending miri-driver: `impl MachineStopType for
 * TerminationInfo` (diagnostics.rs:113, with its `Display` / `Debug`) is not declared in diagnostics.ts; once it is,
 * this stand-in becomes that function. */
function TerminationInfo_as_MachineStopType(info: TerminationInfo): MachineStopType {
  // Throws the stand-in's `Unported`, carrying the payload so that the race-report tests can check what would be reported.
  throw Object.assign(
    new Unported("miri::diagnostics::TerminationInfo: MachineStopType (src/tools/miri/src/diagnostics.rs:113; lane miri-driver)"),
    { payload: info },
  );
}

// rustc-type: src/tools/miri/src/concurrency/data_race.rs:63 AllocState (generated)
export type AllocState = gen.AllocState;

/// Valid atomic read-write orderings, alias of atomic::Ordering (not non-exhaustive).
/** PORT: the methods of `impl AtomicRwOrd` on the generated companion (PORTING §8). */
export interface AtomicRwOrd_methods {
  from(ordering: AtomicOrdering): AtomicRwOrd;
}
export type AtomicRwOrd = gen.AtomicRwOrd;
export const AtomicRwOrd = gen.AtomicRwOrd as typeof gen.AtomicRwOrd & AtomicRwOrd_methods;

// rustc: src/tools/miri/src/concurrency/data_race.rs:76 from
AtomicRwOrd.from = function (ordering: AtomicOrdering): AtomicRwOrd {
  switch (ordering) {
    case "Relaxed":
      return "Relaxed";
    case "Release":
      return "Release";
    case "Acquire":
      return "Acquire";
    case "AcqRel":
      return "AcqRel";
    case "SeqCst":
      return "SeqCst";
  }
};

/// Valid atomic read orderings, subset of atomic::Ordering.
export interface AtomicReadOrd_methods {
  from(ordering: AtomicOrdering): AtomicReadOrd;
}
export type AtomicReadOrd = gen.AtomicReadOrd;
export const AtomicReadOrd = gen.AtomicReadOrd as typeof gen.AtomicReadOrd & AtomicReadOrd_methods;

// rustc: src/tools/miri/src/concurrency/data_race.rs:97 from
AtomicReadOrd.from = function (ordering: AtomicOrdering): AtomicReadOrd {
  switch (ordering) {
    case "Relaxed":
      return "Relaxed";
    case "Acquire":
      return "Acquire";
    case "SeqCst":
      return "SeqCst";
    default:
      // `{ordering:?}`: the variant name
      return panic(`invalid atomic read ordering: ${ordering}`);
  }
};

/// Valid atomic write orderings, subset of atomic::Ordering.
export interface AtomicWriteOrd_methods {
  from(ordering: AtomicOrdering): AtomicWriteOrd;
}
export type AtomicWriteOrd = gen.AtomicWriteOrd;
export const AtomicWriteOrd = gen.AtomicWriteOrd as typeof gen.AtomicWriteOrd & AtomicWriteOrd_methods;

// rustc: src/tools/miri/src/concurrency/data_race.rs:117 from
AtomicWriteOrd.from = function (ordering: AtomicOrdering): AtomicWriteOrd {
  switch (ordering) {
    case "Relaxed":
      return "Relaxed";
    case "Release":
      return "Release";
    case "SeqCst":
      return "SeqCst";
    default:
      return panic(`invalid atomic write ordering: ${ordering}`);
  }
};

/// Valid atomic fence orderings, subset of atomic::Ordering.
export interface AtomicFenceOrd_methods {
  from(ordering: AtomicOrdering): AtomicFenceOrd;
}
export type AtomicFenceOrd = gen.AtomicFenceOrd;
export const AtomicFenceOrd = gen.AtomicFenceOrd as typeof gen.AtomicFenceOrd & AtomicFenceOrd_methods;

// rustc: src/tools/miri/src/concurrency/data_race.rs:138 from
AtomicFenceOrd.from = function (ordering: AtomicOrdering): AtomicFenceOrd {
  switch (ordering) {
    case "Acquire":
      return "Acquire";
    case "Release":
      return "Release";
    case "SeqCst":
      return "SeqCst";
    case "AcqRel":
      return "AcqRel";
    default:
      return panic(`invalid atomic fence ordering: ${ordering}`);
  }
};

/** `#[derive(Default)]` of `ThreadClockSet`: five empty clocks. */
(ThreadClockSet as unknown as { default: () => ThreadClockSet }).default = function (): ThreadClockSet {
  return new ThreadClockSet(VClock.default(), VClock.default(), VClock.default(), VClock.default(), VClock.default());
};

// impl ThreadClockSet

/// Apply the effects of a release fence to this
/// set of thread vector clocks.
// #[inline]
// rustc: src/tools/miri/src/concurrency/data_race.rs:184 apply_release_fence
ThreadClockSet.prototype.apply_release_fence = function (this: ThreadClockSet): void {
  this.fence_release.clone_from(this.clock);
};

/// Apply the effects of an acquire fence to this
/// set of thread vector clocks.
// #[inline]
// rustc: src/tools/miri/src/concurrency/data_race.rs:191 apply_acquire_fence
ThreadClockSet.prototype.apply_acquire_fence = function (this: ThreadClockSet): void {
  this.clock.join(this.fence_acquire);
};

/// Increment the happens-before clock at a
/// known index.
// #[inline]
// rustc: src/tools/miri/src/concurrency/data_race.rs:198 increment_clock
ThreadClockSet.prototype.increment_clock = function (this: ThreadClockSet, index: VectorIdx, current_span: Span): void {
  this.clock.increment_index(index, current_span);
};

/// Join the happens-before clock with that of
/// another thread, used to model thread join
/// operations.
// rustc: src/tools/miri/src/concurrency/data_race.rs:205 join_with
ThreadClockSet.prototype.join_with = function (this: ThreadClockSet, other: ThreadClockSet): void {
  this.clock.join(other.clock);
};

/// Error returned by finding a data race
/// should be elaborated upon.
export type DataRace = gen.DataRace;

/// Type of a non-atomic read operation.
export interface NaReadType_methods {
  description(self: NaReadType): string;
}
export type NaReadType = gen.NaReadType;
export const NaReadType = gen.NaReadType as typeof gen.NaReadType & NaReadType_methods;

// rustc: src/tools/miri/src/concurrency/data_race.rs:267 description
NaReadType.description = function (self: NaReadType): string {
  switch (self) {
    case "Read":
      return "non-atomic read";
    case "Retag":
      return "retag read";
  }
};

/// Type of a non-atomic write operation: allocating memory, non-atomic writes, and
/// deallocating memory are all treated as writes for the purpose of the data-race detector.
export interface NaWriteType_methods {
  description(self: NaWriteType): string;
}
export type NaWriteType = gen.NaWriteType;
export const NaWriteType = gen.NaWriteType as typeof gen.NaWriteType & NaWriteType_methods;

// rustc: src/tools/miri/src/concurrency/data_race.rs:296 description
NaWriteType.description = function (self: NaWriteType): string {
  switch (self) {
    case "Allocate":
      return "creating a new allocation";
    case "Write":
      return "non-atomic write";
    case "Retag":
      return "retag write";
    case "Deallocate":
      return "deallocation";
  }
};

// impl VisitProvenance for GlobalState
// rustc: src/tools/miri/src/concurrency/data_race.rs:413 visit_provenance
GlobalState.prototype.visit_provenance = function (this: GlobalState, _visit: VisitWith): void {
  // We don't have any tags.
};

export interface AccessType_methods {
  description(self: AccessType, ty: Ty | undefined, size: Size | undefined): string;
  is_atomic(self: AccessType): boolean;
  is_read(self: AccessType): boolean;
  is_retag(self: AccessType): boolean;
}
export type AccessType = gen.AccessType;
export const AccessType = gen.AccessType as typeof gen.AccessType & AccessType_methods;

// impl AccessType

// rustc: src/tools/miri/src/concurrency/data_race.rs:419 description
AccessType.description = function (self: AccessType, ty: Ty | undefined, size: Size | undefined): string {
  let msg = "";

  if (size !== undefined) {
    if (Size_eq(size, Size.ZERO)) {
      // In this case there were multiple read accesses with different sizes and then a write.
      // We will be reporting *one* of the other reads, but we don't have enough information
      // to determine which one had which size.
      assert(self.$ === "AtomicLoad", "assertion failed: self == AccessType::AtomicLoad");
      assert(ty === undefined, "assertion failed: ty.is_none()");
      return `multiple differently-sized atomic loads, including one load`;
    }
    msg += `${size.bytes()}-byte ${msg}`;
  }

  switch (self.$) {
    case "NaRead":
      msg += NaReadType.description(self._0);
      break;
    case "NaWrite":
      msg += NaWriteType.description(self._0);
      break;
    case "AtomicLoad":
      msg += "atomic load";
      break;
    case "AtomicStore":
      msg += "atomic store";
      break;
    case "AtomicRmw":
      msg += "atomic read-modify-write";
      break;
  }

  if (ty !== undefined) {
    msg += ` of type \`${display_Ty(ty)}\``;
  }

  return msg;
};

// rustc: src/tools/miri/src/concurrency/data_race.rs:449 is_atomic
AccessType.is_atomic = function (self: AccessType): boolean {
  switch (self.$) {
    case "AtomicLoad":
    case "AtomicStore":
    case "AtomicRmw":
      return true;
    case "NaRead":
    case "NaWrite":
      return false;
  }
};

// rustc: src/tools/miri/src/concurrency/data_race.rs:456 is_read
AccessType.is_read = function (self: AccessType): boolean {
  switch (self.$) {
    case "AtomicLoad":
    case "NaRead":
      return true;
    case "NaWrite":
    case "AtomicStore":
    case "AtomicRmw":
      return false;
  }
};

// rustc: src/tools/miri/src/concurrency/data_race.rs:463 is_retag
AccessType.is_retag = function (self: AccessType): boolean {
  return (self.$ === "NaRead" && self._0 === "Retag") || (self.$ === "NaWrite" && self._0 === "Retag");
};

// impl AtomicMemoryCellClocks
// rustc: src/tools/miri/src/concurrency/data_race.rs:472 new
(AtomicMemoryCellClocks as unknown as { new: (size: Size) => AtomicMemoryCellClocks }).new = function (size: Size): AtomicMemoryCellClocks {
  return new AtomicMemoryCellClocks(VClock.default(), VClock.default(), VClock.default(), size);
};

// impl MemoryCellClocks

/// Create a new set of clocks representing memory allocated
///  at a given vector timestamp and index.
// rustc: src/tools/miri/src/concurrency/data_race.rs:485 new
(MemoryCellClocks as unknown as { new: (alloc: VTimestamp, alloc_index: VectorIdx) => MemoryCellClocks }).new = function (
  alloc: VTimestamp,
  alloc_index: VectorIdx,
): MemoryCellClocks {
  return new MemoryCellClocks([alloc_index, clone_VTimestamp(alloc)], "Allocate", VClock.default(), undefined);
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/data_race.rs:495 write_was_before
MemoryCellClocks.prototype.write_was_before = function (this: MemoryCellClocks, other: VClock): boolean {
  // This is the same as `self.write() <= other` but
  // without actually manifesting a clock for `self.write`.
  return VTimestamp_cmp(this.write[1], other.index(this.write[0])) !== 1;
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/data_race.rs:502 write
MemoryCellClocks.prototype.write_ = function (this: MemoryCellClocks): VClock {
  return VClock.new_with_index(this.write[0], this.write[1]);
};

/// Load the internal atomic memory cells if they exist.
// #[inline]
// rustc: src/tools/miri/src/concurrency/data_race.rs:508 atomic
MemoryCellClocks.prototype.atomic = function (this: MemoryCellClocks): AtomicMemoryCellClocks | undefined {
  return this.atomic_ops;
};

/// Load the internal atomic memory cells if they exist.
// #[inline]
// rustc: src/tools/miri/src/concurrency/data_race.rs:514 atomic_mut_unwrap
MemoryCellClocks.prototype.atomic_mut_unwrap = function (this: MemoryCellClocks): AtomicMemoryCellClocks {
  return unwrap(this.atomic_ops);
};

/// Load or create the internal atomic memory metadata if it does not exist. Also ensures we do
/// not do mixed-size atomic accesses, and updates the recorded atomic access size.
// rustc: src/tools/miri/src/concurrency/data_race.rs:520 atomic_access
MemoryCellClocks.prototype.atomic_access = function (
  this: MemoryCellClocks,
  thread_clocks: ThreadClockSet,
  size: Size,
  write: boolean,
): Result<AtomicMemoryCellClocks, DataRace> {
  const atomic = this.atomic_ops;
  if (atomic !== undefined) {
    // We are good if the size is the same or all atomic accesses are before our current time.
    if (atomic.size !== undefined && Size_eq(atomic.size, size)) {
      return Ok(atomic);
    } else if (atomic.read_vector.le(thread_clocks.clock) && atomic.write_vector.le(thread_clocks.clock)) {
      // We are fully ordered after all previous accesses, so we can change the size.
      atomic.size = size;
      return Ok(atomic);
    } else if (!write && atomic.write_vector.le(thread_clocks.clock)) {
      // This is a read, and it is ordered after the last write. It's okay for the
      // sizes to mismatch, as long as no writes with a different size occur later.
      atomic.size = undefined;
      return Ok(atomic);
    } else {
      return DATA_RACE_ERR;
    }
  } else {
    this.atomic_ops = AtomicMemoryCellClocks.new(size);
    return Ok(this.atomic_ops);
  }
};

/// Update memory cell data-race tracking for atomic
/// load acquire semantics, is a no-op if this memory was
/// not used previously as atomic memory.
// rustc: src/tools/miri/src/concurrency/data_race.rs:556 load_acquire
MemoryCellClocks.prototype.load_acquire = function (
  this: MemoryCellClocks,
  thread_clocks: ThreadClockSet,
  index: VectorIdx,
  access_size: Size,
  sync_clock_: VClock | undefined,
): Result<undefined, DataRace> {
  const r = this.atomic_read_detect(thread_clocks, index, access_size);
  if (r.$ === "Err") return r;
  const sync_clock = sync_clock_ ?? this.atomic()?.sync_vector;
  if (sync_clock !== undefined) {
    thread_clocks.clock.join(sync_clock);
  }
  return OK;
};

/// Update memory cell data-race tracking for atomic
/// load relaxed semantics, is a no-op if this memory was
/// not used previously as atomic memory.
// rustc: src/tools/miri/src/concurrency/data_race.rs:573 load_relaxed
MemoryCellClocks.prototype.load_relaxed = function (
  this: MemoryCellClocks,
  thread_clocks: ThreadClockSet,
  index: VectorIdx,
  access_size: Size,
  sync_clock_: VClock | undefined,
): Result<undefined, DataRace> {
  const r = this.atomic_read_detect(thread_clocks, index, access_size);
  if (r.$ === "Err") return r;
  const sync_clock = sync_clock_ ?? this.atomic()?.sync_vector;
  if (sync_clock !== undefined) {
    thread_clocks.fence_acquire.join(sync_clock);
  }
  return OK;
};

/// Update the memory cell data-race tracking for atomic
/// store release semantics.
// rustc: src/tools/miri/src/concurrency/data_race.rs:589 store_release
MemoryCellClocks.prototype.store_release = function (
  this: MemoryCellClocks,
  thread_clocks: ThreadClockSet,
  index: VectorIdx,
  access_size: Size,
): Result<undefined, DataRace> {
  const r = this.atomic_write_detect(thread_clocks, index, access_size);
  if (r.$ === "Err") return r;
  const atomic = this.atomic_mut_unwrap(); // initialized by `atomic_write_detect`
  atomic.sync_vector.clone_from(thread_clocks.clock);
  return OK;
};

/// Update the memory cell data-race tracking for atomic
/// store relaxed semantics.
// rustc: src/tools/miri/src/concurrency/data_race.rs:603 store_relaxed
MemoryCellClocks.prototype.store_relaxed = function (
  this: MemoryCellClocks,
  thread_clocks: ThreadClockSet,
  index: VectorIdx,
  access_size: Size,
): Result<undefined, DataRace> {
  const r = this.atomic_write_detect(thread_clocks, index, access_size);
  if (r.$ === "Err") return r;

  // The handling of release sequences was changed in C++20 and so
  // the code here is different to the paper since now all relaxed
  // stores block release sequences. The exception for same-thread
  // relaxed stores has been removed. We always overwrite the `sync_vector`,
  // meaning the previous release sequence is broken.
  const atomic = this.atomic_mut_unwrap();
  atomic.sync_vector.clone_from(thread_clocks.fence_release);
  return OK;
};

/// Update the memory cell data-race tracking for atomic
/// store release semantics for RMW operations.
// rustc: src/tools/miri/src/concurrency/data_race.rs:623 rmw_release
MemoryCellClocks.prototype.rmw_release = function (
  this: MemoryCellClocks,
  thread_clocks: ThreadClockSet,
  index: VectorIdx,
  access_size: Size,
): Result<undefined, DataRace> {
  const r = this.atomic_write_detect(thread_clocks, index, access_size);
  if (r.$ === "Err") return r;
  const atomic = this.atomic_mut_unwrap();
  // This *joining* of `sync_vector` implements release sequences: future
  // reads of this location will acquire our clock *and* what was here before.
  atomic.sync_vector.join(thread_clocks.clock);
  return OK;
};

/// Update the memory cell data-race tracking for atomic
/// store relaxed semantics for RMW operations.
// rustc: src/tools/miri/src/concurrency/data_race.rs:639 rmw_relaxed
MemoryCellClocks.prototype.rmw_relaxed = function (
  this: MemoryCellClocks,
  thread_clocks: ThreadClockSet,
  index: VectorIdx,
  access_size: Size,
): Result<undefined, DataRace> {
  const r = this.atomic_write_detect(thread_clocks, index, access_size);
  if (r.$ === "Err") return r;
  const atomic = this.atomic_mut_unwrap();
  // This *joining* of `sync_vector` implements release sequences: future
  // reads of this location will acquire our fence clock *and* what was here before.
  atomic.sync_vector.join(thread_clocks.fence_release);
  return OK;
};

/// Detect data-races with an atomic read, caused by a non-atomic write that does
/// not happen-before the atomic-read.
// rustc: src/tools/miri/src/concurrency/data_race.rs:655 atomic_read_detect
MemoryCellClocks.prototype.atomic_read_detect = function (
  this: MemoryCellClocks,
  thread_clocks: ThreadClockSet,
  index: VectorIdx,
  access_size: Size,
): Result<undefined, DataRace> {
  // trace!("Atomic read with vectors: {:#?} :: {:#?}", self, thread_clocks);
  const atomic = this.atomic_access(thread_clocks, access_size, /*write*/ false);
  if (atomic.$ === "Err") return atomic;
  atomic._0.read_vector.set_at_index(thread_clocks.clock, index);
  // Make sure the last non-atomic write was before this access.
  if (this.write_was_before(thread_clocks.clock)) {
    return OK;
  } else {
    return DATA_RACE_ERR;
  }
};

/// Detect data-races with an atomic write, either with a non-atomic read or with
/// a non-atomic write.
// rustc: src/tools/miri/src/concurrency/data_race.rs:670 atomic_write_detect
MemoryCellClocks.prototype.atomic_write_detect = function (
  this: MemoryCellClocks,
  thread_clocks: ThreadClockSet,
  index: VectorIdx,
  access_size: Size,
): Result<undefined, DataRace> {
  // trace!("Atomic write with vectors: {:#?} :: {:#?}", self, thread_clocks);
  const atomic = this.atomic_access(thread_clocks, access_size, /*write*/ true);
  if (atomic.$ === "Err") return atomic;
  atomic._0.write_vector.set_at_index(thread_clocks.clock, index);
  // Make sure the last non-atomic write and all non-atomic reads were before this access.
  if (this.write_was_before(thread_clocks.clock) && this.read.le(thread_clocks.clock)) {
    return OK;
  } else {
    return DATA_RACE_ERR;
  }
};

/// Detect races for non-atomic read operations at the current memory cell
/// returns true if a data-race is detected.
// rustc: src/tools/miri/src/concurrency/data_race.rs:689 non_atomic_read_detect
MemoryCellClocks.prototype.non_atomic_read_detect = function (
  this: MemoryCellClocks,
  thread_clocks: ThreadClockSet,
  index: VectorIdx,
  read_type: NaReadType,
  current_span: Span,
): Result<undefined, DataRace> {
  // trace!("Unsynchronized read with vectors: {:#?} :: {:#?}", self, thread_clocks);
  if (!Span.is_dummy(current_span)) {
    thread_clocks.clock.index_mut(index).span = current_span;
  }
  thread_clocks.clock.index_mut(index).set_read_type(read_type);
  // Check synchronization with non-atomic writes.
  if (!this.write_was_before(thread_clocks.clock)) {
    return DATA_RACE_ERR;
  }
  // Check synchronization with atomic writes.
  const atomic = this.atomic();
  if (!(atomic === undefined || atomic.write_vector.le(thread_clocks.clock))) {
    return DATA_RACE_ERR;
  }
  // Record this access.
  this.read.set_at_index(thread_clocks.clock, index);
  return OK;
};

/// Detect races for non-atomic write operations at the current memory cell
/// returns true if a data-race is detected.
// rustc: src/tools/miri/src/concurrency/data_race.rs:716 non_atomic_write_detect
MemoryCellClocks.prototype.non_atomic_write_detect = function (
  this: MemoryCellClocks,
  thread_clocks: ThreadClockSet,
  index: VectorIdx,
  write_type: NaWriteType,
  current_span: Span,
): Result<undefined, DataRace> {
  // trace!("Unsynchronized write with vectors: {:#?} :: {:#?}", self, thread_clocks);
  if (!Span.is_dummy(current_span)) {
    thread_clocks.clock.index_mut(index).span = current_span;
  }
  // Check synchronization with non-atomic accesses.
  if (!(this.write_was_before(thread_clocks.clock) && this.read.le(thread_clocks.clock))) {
    return DATA_RACE_ERR;
  }
  // Check synchronization with atomic accesses.
  const atomic = this.atomic();
  if (!(atomic === undefined || (atomic.write_vector.le(thread_clocks.clock) && atomic.read_vector.le(thread_clocks.clock)))) {
    return DATA_RACE_ERR;
  }
  // Record this access.
  this.write = [index, clone_VTimestamp(thread_clocks.clock.index(index))];
  this.write_type = write_type;
  this.read.set_zero_vector();
  // This is not an atomic location any more.
  this.atomic_ops = undefined;
  return OK;
};

// impl GlobalDataRaceHandler
// PORT: a private method of `GlobalDataRaceHandler` (data_race_handler.ts's companion) defined in this file upstream; it
// is used only by `allow_data_races_*` below, so it stays a module-private fn here.
/// Select whether data race checking is disabled. This is solely an
/// implementation detail of `allow_data_races_*` and must not be used anywhere else!
// rustc: src/tools/miri/src/concurrency/data_race.rs:750 set_ongoing_action_data_race_free
function GlobalDataRaceHandler_set_ongoing_action_data_race_free(self: GlobalDataRaceHandler, enable: boolean): void {
  switch (self.$) {
    case "None":
      break;
    case "Vclocks": {
      const data_race = self._0;
      const old = data_race.ongoing_action_data_race_free;
      data_race.ongoing_action_data_race_free = enable;
      // `assert_ne!(old, enable, "cannot nest allow_data_races")`
      if (old === enable) {
        panic(`assertion \`left != right\` failed: cannot nest allow_data_races\n  left: ${old}\n right: ${enable}`);
      }
      break;
    }
    case "Genmc":
      // genmc_ctx.set_ongoing_action_data_race_free(enable)
      unported("genmc");
  }
}

/// Evaluation context extensions.
// impl<'tcx> EvalContextExt<'tcx> for MiriInterpCx<'tcx> {}
// pub trait EvalContextExt<'tcx>: MiriInterpCxExt<'tcx>

/// Perform an atomic read operation at the memory location.
// rustc: src/tools/miri/src/concurrency/data_race.rs:768 read_scalar_atomic
InterpCx.prototype.read_scalar_atomic = function (this: MiriInterpCx, place: MPlaceTy, atomic: AtomicReadOrd): InterpResult<Scalar> {
  const this_ = this.eval_context_ref();
  const r = this_.atomic_access_check(place, { $: "Load", _0: atomic });
  if (r.$ === "Err") return r;
  // This will read from the last store in the modification order of this location. In case
  // weak memory emulation is enabled, this may not be the store we will pick to actually read from and return.
  // This is fine with StackedBorrow and race checks because they don't concern metadata on
  // the *value* (including the associated provenance if this is an AtomicPtr) at this location.
  // Only metadata on the location itself is used.

  if (GlobalDataRaceHandler.as_genmc_ref(this_.machine.data_race) !== undefined) {
    // let old_val = this.ghost_run(|this| this.read_scalar(place)).discard_err();
    // return genmc_ctx.atomic_load(this, place.ptr().addr(), place.layout.size, atomic, old_val);
    return unported("genmc");
  }

  // trace!("read_scalar_atomic({:?}, {} bytes)", place.ptr(), place.layout.size.bytes());

  const scalar = this_.allow_data_races_ref((this_) => this_.read_scalar(place));
  if (scalar.$ === "Err") return scalar;
  const buffered_scalar = this_.buffered_atomic_read(place, atomic, scalar._0, (sync_clock) =>
    this_.validate_atomic_load(place, atomic, sync_clock),
  );
  if (buffered_scalar.$ === "Err") return buffered_scalar;
  // `buffered_scalar.ok_or_else(|| err_ub!(InvalidUninitBytes(None)))?`
  if (buffered_scalar._0 === undefined) {
    return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "InvalidUninitBytes", _0: undefined } }));
  }
  return interp_ok(buffered_scalar._0);
};

/// Perform an atomic write operation at the memory location.
// rustc: src/tools/miri/src/concurrency/data_race.rs:802 write_scalar_atomic
InterpCx.prototype.write_scalar_atomic = function (this: MiriInterpCx, val: Scalar, dest: MPlaceTy, atomic: AtomicWriteOrd): InterpResult {
  const this_ = this.eval_context_mut();
  const r = this_.atomic_access_check(dest, AtomicAccessType.Store);
  if (r.$ === "Err") return r;

  // Read the previous value so we can put it in the store buffer later.
  // Both GenMC and Miri need this. This value is nonsense if there are concurrent writes
  // but the code consuming the value is aware of that.
  // PORT(contract): `ghost_run` passes `self` to its closure, but rustc_const_eval types the closure's parameter as the
  // CTFE `InterpCx`; the closure uses `this_` (the same object) instead.
  const old_val = InterpResult.discard_err(this_.ghost_run(() => this_.read_scalar(dest)));

  // Inform GenMC about the atomic store.
  if (GlobalDataRaceHandler.as_genmc_ref(this_.machine.data_race) !== undefined) {
    // if genmc_ctx.atomic_store(this, dest.ptr().addr(), dest.layout.size, val, old_val, atomic)? {
    //     // The store might be the latest store in coherence order (determined by GenMC).
    //     // If it is, we need to update the value in Miri's memory:
    //     this.allow_data_races_mut(|this| this.write_scalar(val, dest))?;
    // }
    // return interp_ok(());
    return unported("genmc");
  }

  // trace!("write_scalar_atomic({:?}, {} bytes)", dest.ptr(), dest.layout.size.bytes());

  const w = this_.allow_data_races_mut((this_) => this_.write_scalar(val, dest));
  if (w.$ === "Err") return w;
  const v = this_.validate_atomic_store(dest, atomic);
  if (v.$ === "Err") return v;
  return this_.buffered_atomic_write(val, dest, atomic, old_val as Scalar | undefined);
};

/// Perform an atomic RMW operation on a memory location.
// rustc: src/tools/miri/src/concurrency/data_race.rs:841 atomic_rmw
InterpCx.prototype.atomic_rmw = function (this: MiriInterpCx, place: MPlaceTy, rhs: ImmTy, atomic_op: AtomicRmwOp, ord: AtomicRwOrd): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  const r = this_.atomic_access_check(place, AtomicAccessType.Rmw);
  if (r.$ === "Err") return r;

  const old_r = this_.allow_data_races_mut((this_) => this_.read_immediate(place));
  if (old_r.$ === "Err") return old_r;
  const old = old_r._0;

  // Inform GenMC about the atomic rmw operation.
  if (GlobalDataRaceHandler.as_genmc_ref(this_.machine.data_race) !== undefined) {
    // let (old_val, new_val) = genmc_ctx.atomic_rmw(this, place.ptr().addr(), place.layout.size, atomic_op,
    //     place.layout.backend_repr.is_signed(), ord, rhs.to_scalar(), old.to_scalar())?;
    // if let Some(new_val) = new_val {
    //     this.allow_data_races_mut(|this| this.write_scalar(new_val, place))?;
    // }
    // return interp_ok(old_val);
    return unported("genmc");
  }

  // trace!("atomic_rmw({:?}, {} bytes)", place.ptr(), place.layout.size.bytes());

  const val_r = this_.atomic_rmw_op(atomic_op, old, rhs);
  if (val_r.$ === "Err") return val_r;
  const val = val_r._0;

  const w = this_.allow_data_races_mut((this_) => this_.write_immediate(val.imm, place));
  if (w.$ === "Err") return w;
  const v = this_.validate_atomic_rmw(place, ord);
  if (v.$ === "Err") return v;
  const b = this_.buffered_atomic_rmw(imm_to_scalar(val.imm), place, ord, imm_to_scalar(old.imm));
  if (b.$ === "Err") return b;
  return interp_ok(imm_to_scalar(old.imm));
};

/// Perform an atomic compare and exchange at a given memory location.
/// On success an atomic RMW operation is performed and on failure
/// only an atomic read occurs. If `can_fail_spuriously` is true,
/// then we treat it as a "compare_exchange_weak" operation, and
/// some portion of the time fail even when the values are actually
/// identical.
// rustc: src/tools/miri/src/concurrency/data_race.rs:887 atomic_compare_exchange
InterpCx.prototype.atomic_compare_exchange = function (
  this: MiriInterpCx,
  place: MPlaceTy,
  expect_old: ImmTy,
  new_: Scalar,
  success: AtomicRwOrd,
  fail: AtomicReadOrd,
  can_fail_spuriously: boolean,
): InterpResult<[Scalar, boolean]> {
  const this_ = this.eval_context_mut();
  const r = this_.atomic_access_check(place, AtomicAccessType.Rmw);
  if (r.$ === "Err") return r;

  // Read as immediate for the sake of `binary_op()`
  const old_r = this_.allow_data_races_mut((this_) => this_.read_immediate(place));
  if (old_r.$ === "Err") return old_r;
  const old = old_r._0;

  // Inform GenMC about the atomic atomic compare exchange.
  if (GlobalDataRaceHandler.as_genmc_ref(this_.machine.data_race) !== undefined) {
    // let (old_value, new_value, cmpxchg_success) = genmc_ctx.atomic_compare_exchange(this, place.ptr().addr(),
    //     place.layout.size, this.read_scalar(expect_old)?, new, success, fail, can_fail_spuriously, old.to_scalar())?;
    // // The store might be the latest store in coherence order (determined by GenMC).
    // // If it is, we need to update the value in Miri's memory:
    // if let Some(new_value) = new_value {
    //     this.allow_data_races_mut(|this| this.write_scalar(new_value, place))?;
    // }
    // return interp_ok((old_value, cmpxchg_success));
    return unported("genmc");
  }

  // `binary_op` will bail if either of them is not a scalar.
  const eq = this_.binary_op("Eq", old, expect_old);
  if (eq.$ === "Err") return eq;
  // If the operation would succeed, but is "weak", fail some portion
  // of the time, based on `success_rate`.
  const success_rate = 1.0 - this_.machine.cmpxchg_weak_failure_rate;
  const eq_bool = interpret_Scalar.to_bool(imm_to_scalar(eq._0.imm));
  if (eq_bool.$ === "Err") return eq_bool;
  const cmpxchg_success =
    eq_bool._0 &&
    (can_fail_spuriously
      ? // PORT(contract): pending typemap: `MiriMachine.rng` is `Pending<"rand::rngs::StdRng">` (machine.gen.ts); the
        // vendored `StdRng` is a `Rng` (vendor-rand).
        RngExt.random_bool(this_.machine.rng as unknown as Rng, success_rate)
      : true);
  const res: [Scalar, boolean] = [imm_to_scalar(old.imm), cmpxchg_success];

  // trace!(
  //     "atomic_compare_exchange_scalar({:?}, {} bytes, success = {})",
  //     place.ptr(),
  //     place.layout.size.bytes(),
  //     cmpxchg_success,
  // );

  // Update ptr depending on comparison.
  // if successful, perform a full rw-atomic validation
  // otherwise treat this as an atomic load with the fail ordering.
  if (cmpxchg_success) {
    const w = this_.allow_data_races_mut((this_) => this_.write_scalar(new_, place));
    if (w.$ === "Err") return w;
    const v = this_.validate_atomic_rmw(place, success);
    if (v.$ === "Err") return v;
    const b = this_.buffered_atomic_rmw(new_, place, success, imm_to_scalar(old.imm));
    if (b.$ === "Err") return b;
  } else {
    const v = this_.validate_atomic_load(place, fail, /* can use latest sync clock */ undefined);
    if (v.$ === "Err") return v;
    // A failed compare exchange is equivalent to a load, reading from the latest store
    // in the modification order.
    // Since `old` is only a value and not the store element, we need to separately
    // find it in our store buffer and perform load_impl on it.
    const p = this_.perform_read_on_buffered_latest(place, fail);
    if (p.$ === "Err") return p;
  }

  // Return the old value.
  return interp_ok(res);
};

/// Update the data-race detector for an atomic fence on the current thread.
// rustc: src/tools/miri/src/concurrency/data_race.rs:964 atomic_fence
InterpCx.prototype.atomic_fence = function (this: MiriInterpCx, atomic: AtomicFenceOrd): InterpResult {
  const this_ = this.eval_context_ref();
  const machine = this_.machine;
  const data_race = machine.data_race;
  switch (data_race.$) {
    case "None":
      return interp_ok(undefined);
    case "Vclocks":
      return data_race._0.atomic_fence(machine, atomic);
    case "Genmc":
      // genmc_ctx.atomic_fence(machine, atomic)
      return unported("genmc");
  }
};

/// Calls the callback with the "release" clock of the current thread.
/// Other threads can acquire this clock in the future to establish synchronization
/// with this program point.
///
/// The closure will only be invoked if data race handling is on.
// rustc: src/tools/miri/src/concurrency/data_race.rs:979 release_clock
InterpCx.prototype.release_clock = function <R>(this: MiriInterpCx, callback: (_0: VClock) => R): InterpResult<R | undefined> {
  const this_ = this.eval_context_ref();
  const data_race = this_.machine.data_race;
  switch (data_race.$) {
    case "None":
      return interp_ok(undefined);
    case "Genmc":
      // throw_unsup_format!("this operation performs synchronization that is not supported in GenMC mode")
      return unported("genmc");
    case "Vclocks":
      return interp_ok(data_race._0.release_clock(this_.machine.threads, callback));
  }
};

/// Acquire the given clock into the current thread, establishing synchronization with
/// the moment when that clock snapshot was taken via `release_clock`.
// rustc: src/tools/miri/src/concurrency/data_race.rs:997 acquire_clock
InterpCx.prototype.acquire_clock = function (this: MiriInterpCx, clock: VClock): InterpResult {
  const this_ = this.eval_context_ref();
  const data_race = this_.machine.data_race;
  switch (data_race.$) {
    case "None":
      break;
    case "Genmc":
      // throw_unsup_format!("this operation performs synchronization that is not supported in GenMC mode")
      return unported("genmc");
    case "Vclocks":
      data_race._0.acquire_clock(clock, this_.machine.threads);
      break;
  }
  return interp_ok(undefined);
};

/// Vector clock metadata for a logical memory allocation.
// impl VisitProvenance for VClockAlloc
// rustc: src/tools/miri/src/concurrency/data_race.rs:1020 visit_provenance
VClockAlloc.prototype.visit_provenance = function (this: VClockAlloc, _visit: VisitWith): void {
  // No tags or allocIds here.
};

// impl VClockAlloc

/// Create a new data-race detector for newly allocated memory.
// rustc: src/tools/miri/src/concurrency/data_race.rs:1027 new_allocation
VClockAlloc.new_allocation = function (
  global: GlobalState,
  thread_mgr: ThreadManager,
  len: Size,
  kind: MemoryKind,
  current_span: Span,
): VClockAlloc {
  // Determine the thread that did the allocation, and when it did it.
  let alloc_timestamp: VTimestamp;
  let alloc_index: VectorIdx;
  // User allocated and stack memory should track allocation.
  const tracks =
    kind.$ === "Stack" ||
    (kind.$ === "Machine" &&
      (kind._0 === "Rust" ||
        kind._0 === "Miri" ||
        kind._0 === "C" ||
        kind._0 === "WinHeap" ||
        kind._0 === "WinLocal" ||
        kind._0 === "Mmap" ||
        kind._0 === "SocketAddress"));
  if (tracks) {
    const [alloc_index_, clocks] = global.active_thread_state(thread_mgr);
    const alloc_timestamp_ = clone_VTimestamp(clocks.clock.index(alloc_index_));
    alloc_timestamp_.span = current_span;
    alloc_timestamp = alloc_timestamp_;
    alloc_index = alloc_index_;
  } else if (
    kind.$ === "CallerLocation" ||
    (kind.$ === "Machine" &&
      (kind._0 === "Global" || kind._0 === "Machine" || kind._0 === "Runtime" || kind._0 === "ExternStatic" || kind._0 === "Tls"))
  ) {
    // Other global memory should trace races but be allocated at the 0 timestamp
    // (conceptually they are allocated on the main thread before everything).
    alloc_timestamp = VTimestamp.ZERO;
    alloc_index = global.thread_index(main_thread());
  } else {
    // PORT: the match is exhaustive upstream.
    return unreachable();
  }
  return new VClockAlloc(DedupRangeMap.new(len, MemoryCellClocks.new(alloc_timestamp, alloc_index)));
};

// Find an index, if one exists where the value
// in `l` is greater than the value in `r`.
// rustc: src/tools/miri/src/concurrency/data_race.rs:1074 find_gt_index
VClockAlloc.find_gt_index = function (l: VClock, r: VClock): VectorIdx | undefined {
  // trace!("Find index where not {:?} <= {:?}", l, r);
  const l_slice = l.as_slice();
  const r_slice = r.as_slice();
  // `l_slice.iter().zip(r_slice.iter()).enumerate().find_map(|(idx, (&l, &r))| if l > r { Some(idx) } else { None })`
  const n = Math.min(l_slice.length, r_slice.length);
  let found: number | undefined;
  for (let idx = 0; idx < n; idx++) {
    if (VTimestamp_cmp(l_slice[idx]!, r_slice[idx]!) === 1) {
      found = idx;
      break;
    }
  }
  if (found === undefined) {
    if (l_slice.length > r_slice.length) {
      // By invariant, if l_slice is longer
      // then one element must be larger.
      // This just validates that this is true
      // and reports earlier elements first.
      const l_remainder_slice = l_slice.slice(r_slice.length);
      let idx: number | undefined;
      for (let i = 0; i < l_remainder_slice.length; i++) {
        // `if r == VTimestamp::ZERO { None } else { Some(idx) }`
        if (l_remainder_slice[i]!.time() !== VTimestamp.ZERO.time()) {
          idx = i;
          break;
        }
      }
      found = unwrap(idx, "Invalid VClock Invariant") + r_slice.length;
    } else {
      found = undefined;
    }
  }
  return found === undefined ? undefined : VectorIdx.new(found);
};

/// Report a data-race found in the program.
/// This finds the two racing threads and the type
/// of data-race that occurred. This will also
/// return info about the memory location the data-race
/// occurred in. The `ty` parameter is used for diagnostics, letting
/// the user know which type was involved in the access.
// #[cold]
// #[inline(never)]
// rustc: src/tools/miri/src/concurrency/data_race.rs:1111 report_data_race
VClockAlloc.report_data_race = function (
  global: GlobalState,
  thread_mgr: ThreadManager,
  mem_clocks: MemoryCellClocks,
  access: AccessType,
  access_size: Size,
  ptr_dbg: interpret_Pointer<AllocId>,
  ty: Ty | undefined,
): InterpResult {
  const [active_index, active_clocks] = global.active_thread_state(thread_mgr);
  let other_size: Size | undefined = undefined; // if `Some`, this was a size-mismatch race
  let other_access: AccessType;
  let other_thread: VectorIdx;
  let other_clock: VClock;
  // First check the atomic-nonatomic cases.
  let atomic: AtomicMemoryCellClocks | undefined;
  let idx: VectorIdx | undefined;
  if (
    !AccessType.is_atomic(access) &&
    (atomic = mem_clocks.atomic()) !== undefined &&
    (idx = VClockAlloc.find_gt_index(atomic.write_vector, active_clocks.clock)) !== undefined
  ) {
    [other_access, other_thread, other_clock] = [AccessType.AtomicStore, idx, atomic.write_vector];
  } else if (
    !AccessType.is_atomic(access) &&
    !AccessType.is_read(access) &&
    (atomic = mem_clocks.atomic()) !== undefined &&
    (idx = VClockAlloc.find_gt_index(atomic.read_vector, active_clocks.clock)) !== undefined
  ) {
    [other_access, other_thread, other_clock] = [AccessType.AtomicLoad, idx, atomic.read_vector];
    // Then check races with non-atomic writes/reads.
  } else if (VTimestamp_cmp(mem_clocks.write[1], active_clocks.clock.index(mem_clocks.write[0])) === 1) {
    const write_clock = mem_clocks.write_();
    [other_access, other_thread, other_clock] = [{ $: "NaWrite", _0: mem_clocks.write_type }, mem_clocks.write[0], write_clock];
  } else if (!AccessType.is_read(access) && (idx = VClockAlloc.find_gt_index(mem_clocks.read, active_clocks.clock)) !== undefined) {
    [other_access, other_thread, other_clock] = [{ $: "NaRead", _0: mem_clocks.read.index(idx).read_type() }, idx, mem_clocks.read];
    // Finally, mixed-size races.
  } else if (
    AccessType.is_atomic(access) &&
    (atomic = mem_clocks.atomic()) !== undefined &&
    !(atomic.size !== undefined && Size_eq(atomic.size, access_size))
  ) {
    // This is only a race if we are not synchronized with all atomic accesses, so find
    // the one we are not synchronized with.
    other_size = atomic.size ?? Size.ZERO;
    if ((idx = VClockAlloc.find_gt_index(atomic.write_vector, active_clocks.clock)) !== undefined) {
      [other_access, other_thread, other_clock] = [AccessType.AtomicStore, idx, atomic.write_vector];
    } else if ((idx = VClockAlloc.find_gt_index(atomic.read_vector, active_clocks.clock)) !== undefined) {
      [other_access, other_thread, other_clock] = [AccessType.AtomicLoad, idx, atomic.read_vector];
    } else {
      return unreachable("internal error: entered unreachable code: Failed to report data-race for mixed-size access: no race found");
    }
  } else {
    return unreachable("internal error: entered unreachable code: Failed to report data-race");
  }

  // Load elaborated thread information about the racing thread actions.
  const active_thread_info = global.print_thread_metadata(thread_mgr, active_index);
  const other_thread_info = global.print_thread_metadata(thread_mgr, other_thread);
  const involves_non_atomic = !AccessType.is_atomic(access) || !AccessType.is_atomic(other_access);

  // Throw the data-race detection.
  let extra: string | undefined;
  if (other_size !== undefined) {
    assert(!involves_non_atomic, "assertion failed: !involves_non_atomic");
    extra = "overlapping unsynchronized atomic accesses must use the same access size";
  } else if (AccessType.is_read(access) && AccessType.is_read(other_access)) {
    return panic(
      `there should be no same-size read-read races\naccess: ${gen.debug_AccessType(access, PLAIN)}\nother_access: ${gen.debug_AccessType(other_access, PLAIN)}`,
    );
  } else {
    extra = undefined;
  }
  const op1: RacingOp = {
    action: AccessType.description(other_access, undefined, other_size),
    thread_info: other_thread_info,
    span: at(other_clock.as_slice(), other_thread.index()).span,
  };
  const op2: RacingOp = {
    action: AccessType.description(access, ty, other_size === undefined ? undefined : access_size),
    thread_info: active_thread_info,
    span: at(active_clocks.clock.as_slice(), active_index.index()).span,
  };
  return Err(
    err_machine_stop({
      $: "DataRace",
      involves_non_atomic,
      extra,
      retag_explain: AccessType.is_retag(access) || AccessType.is_retag(other_access),
      ptr: ptr_dbg,
      op1,
      op2,
    }),
  );
};

/// Return the release/acquire synchronization clock for the given memory range.
// rustc: src/tools/miri/src/concurrency/data_race.rs:1198 sync_clock
VClockAlloc.prototype.sync_clock = function (this: VClockAlloc, access_range: AllocRange): VClock {
  const alloc_ranges = this.alloc_ranges;
  const clock = VClock.default();
  for (const [, mem_clocks] of alloc_ranges.iter(access_range.start, access_range.size)) {
    const atomic = mem_clocks.atomic();
    if (atomic !== undefined) {
      clock.join(atomic.sync_vector);
    }
  }
  return clock;
};

/// Detect data-races for an unsynchronized read operation. It will not perform
/// data-race detection if `race_detecting()` is false, either due to no threads
/// being created or if it is temporarily disabled during a racy read or write
/// operation for which data-race detection is handled separately, for example
/// atomic read operations. The `ty` parameter is used for diagnostics, letting
/// the user know which type was read.
// rustc: src/tools/miri/src/concurrency/data_race.rs:1215 read_non_atomic
VClockAlloc.prototype.read_non_atomic = function (
  this: VClockAlloc,
  alloc_id: AllocId,
  access_range: AllocRange,
  read_type: NaReadType,
  ty: Ty | undefined,
  machine: MiriMachine,
): InterpResult {
  const current_span = machine.current_user_relevant_span();
  const global = unwrap(GlobalDataRaceHandler.as_vclocks_ref(machine.data_race));
  if (!global.race_detecting()) {
    return interp_ok(undefined);
  }
  const [index, thread_clocks] = global.active_thread_state_mut(machine.threads);
  const alloc_ranges = this.alloc_ranges;
  for (const [mem_clocks_range, mem_clocks] of alloc_ranges.iter_mut(access_range.start, access_range.size)) {
    if (mem_clocks.non_atomic_read_detect(thread_clocks, index, read_type, current_span).$ === "Err") {
      // drop(thread_clocks);
      // Report data-race.
      return VClockAlloc.report_data_race(
        global,
        machine.threads,
        mem_clocks,
        { $: "NaRead", _0: read_type },
        access_range.size,
        interpret_Pointer.new(alloc_id, Size.from_bytes(range_start(mem_clocks_range))),
        ty,
      );
    }
  }
  return interp_ok(undefined);
};

/// Detect data-races for an unsynchronized write operation. It will not perform
/// data-race detection if `race_detecting()` is false, either due to no threads
/// being created or if it is temporarily disabled during a racy read or write
/// operation. The `ty` parameter is used for diagnostics, letting
/// the user know which type was written.
// rustc: src/tools/miri/src/concurrency/data_race.rs:1260 write_non_atomic
VClockAlloc.prototype.write_non_atomic = function (
  this: VClockAlloc,
  alloc_id: AllocId,
  access_range: AllocRange,
  write_type: NaWriteType,
  ty: Ty | undefined,
  machine: MiriMachine,
): InterpResult {
  const current_span = machine.current_user_relevant_span();
  const global = unwrap(GlobalDataRaceHandler.as_vclocks_ref(machine.data_race));
  if (!global.race_detecting()) {
    return interp_ok(undefined);
  }
  const [index, thread_clocks] = global.active_thread_state_mut(machine.threads);
  for (const [mem_clocks_range, mem_clocks] of this.alloc_ranges.iter_mut(access_range.start, access_range.size)) {
    if (mem_clocks.non_atomic_write_detect(thread_clocks, index, write_type, current_span).$ === "Err") {
      // drop(thread_clocks);
      // Report data-race
      return VClockAlloc.report_data_race(
        global,
        machine.threads,
        mem_clocks,
        { $: "NaWrite", _0: write_type },
        access_range.size,
        interpret_Pointer.new(alloc_id, Size.from_bytes(range_start(mem_clocks_range))),
        ty,
      );
    }
  }
  return interp_ok(undefined);
};

/// Vector clock state for a stack frame (tracking the local variables
/// that do not have an allocation yet).
/** `#[derive(Default)]` of `FrameState`: an empty map. */
(FrameState as unknown as { default: () => FrameState }).default = function (): FrameState {
  // PORT: `FxHashMap<mir::Local, LocalClocks>` is never iterated: a plain `Map`.
  return new FrameState(new Map<Local, LocalClocks>());
};

/// Stripped-down version of [`MemoryCellClocks`] for the clocks we need to keep track
/// of in a local that does not yet have addressable memory -- and hence can only
/// be accessed from the thread its stack frame belongs to, and cannot be access atomically.
// impl Default for LocalClocks
// rustc: src/tools/miri/src/concurrency/data_race.rs:1318 default
export function default_LocalClocks(): LocalClocks {
  return { write: clone_VTimestamp(VTimestamp.ZERO), write_type: "Allocate", read: clone_VTimestamp(VTimestamp.ZERO) };
}

/** `clocks.entry(local).or_default()` */
function entry_or_default(clocks: Map<Local, LocalClocks>, local: Local): LocalClocks {
  let c = clocks.get(local);
  if (c === undefined) {
    c = default_LocalClocks();
    clocks.set(local, c);
  }
  return c;
}

// impl FrameState

// rustc: src/tools/miri/src/concurrency/data_race.rs:1324 local_write
FrameState.prototype.local_write = function (this: FrameState, local: Local, storage_live: boolean, machine: MiriMachine): void {
  const current_span = machine.current_user_relevant_span();
  const global = unwrap(GlobalDataRaceHandler.as_vclocks_ref(machine.data_race));
  if (!global.race_detecting()) {
    return;
  }
  const [index, thread_clocks] = global.active_thread_state_mut(machine.threads);
  // This should do the same things as `MemoryCellClocks::write_race_detect`.
  if (!Span.is_dummy(current_span)) {
    thread_clocks.clock.index_mut(index).span = current_span;
  }
  const clocks = this.local_clocks;
  if (storage_live) {
    const new_clocks: LocalClocks = {
      write: clone_VTimestamp(thread_clocks.clock.index(index)),
      write_type: "Allocate",
      read: clone_VTimestamp(VTimestamp.ZERO),
    };
    // There might already be an entry in the map for this, if the local was previously
    // live already.
    clocks.set(local, new_clocks);
  } else {
    // This can fail to exist if `race_detecting` was false when the allocation
    // occurred, in which case we can backdate this to the beginning of time.
    const clocks_ = entry_or_default(clocks, local);
    clocks_.write = clone_VTimestamp(thread_clocks.clock.index(index));
    clocks_.write_type = "Write";
  }
};

// rustc: src/tools/miri/src/concurrency/data_race.rs:1354 local_read
FrameState.prototype.local_read = function (this: FrameState, local: Local, machine: MiriMachine): void {
  const current_span = machine.current_user_relevant_span();
  const global = unwrap(GlobalDataRaceHandler.as_vclocks_ref(machine.data_race));
  if (!global.race_detecting()) {
    return;
  }
  const [index, thread_clocks] = global.active_thread_state_mut(machine.threads);
  // This should do the same things as `MemoryCellClocks::read_race_detect`.
  if (!Span.is_dummy(current_span)) {
    thread_clocks.clock.index_mut(index).span = current_span;
  }
  thread_clocks.clock.index_mut(index).set_read_type("Read");
  // This can fail to exist if `race_detecting` was false when the allocation
  // occurred, in which case we can backdate this to the beginning of time.
  const clocks = entry_or_default(this.local_clocks, local);
  clocks.read = clone_VTimestamp(thread_clocks.clock.index(index));
};

// rustc: src/tools/miri/src/concurrency/data_race.rs:1373 local_moved_to_memory
FrameState.prototype.local_moved_to_memory = function (this: FrameState, local: Local, alloc: VClockAlloc, machine: MiriMachine): void {
  const global = unwrap(GlobalDataRaceHandler.as_vclocks_ref(machine.data_race));
  if (!global.race_detecting()) {
    return;
  }
  const [index, _thread_clocks] = global.active_thread_state_mut(machine.threads);
  // Get the time the last write actually happened. This can fail to exist if
  // `race_detecting` was false when the write occurred, in that case we can backdate this
  // to the beginning of time.
  // `self.local_clocks.borrow_mut().remove(&local).unwrap_or_default()`
  const local_clocks = this.local_clocks.get(local) ?? default_LocalClocks();
  this.local_clocks.delete(local);
  for (const [, mem_clocks] of alloc.alloc_ranges.iter_mut_all()) {
    // The initialization write for this already happened, just at the wrong timestamp.
    // Check that the thread index matches what we expect.
    // `assert_eq!(mem_clocks.write.0, index)`
    if (mem_clocks.write[0].index() !== index.index()) {
      panic(
        `assertion \`left == right\` failed\n  left: ${gen_debug_VectorIdx(mem_clocks.write[0])}\n right: ${gen_debug_VectorIdx(index)}`,
      );
    }
    // Convert the local's clocks into memory clocks.
    mem_clocks.write = [index, clone_VTimestamp(local_clocks.write)];
    mem_clocks.write_type = local_clocks.write_type;
    mem_clocks.read = VClock.new_with_index(index, local_clocks.read);
  }
};

/** `{:?}` of a `VectorIdx` (derived: `VectorIdx(n)`). */
function gen_debug_VectorIdx(v: VectorIdx): string {
  return `VectorIdx(${v._0})`;
}

// impl<'tcx> EvalContextPrivExt<'tcx> for MiriInterpCx<'tcx> {}
// trait EvalContextPrivExt<'tcx>: MiriInterpCxExt<'tcx>

/// Temporarily allow data-races to occur. This should only be used in
/// one of these cases:
/// - One of the appropriate `validate_atomic` functions will be called to
///   treat a memory access as atomic.
/// - The memory being accessed should be treated as internal state, that
///   cannot be accessed by the interpreted program.
/// - Execution of the interpreted program execution has halted.
// #[inline]
// rustc: src/tools/miri/src/concurrency/data_race.rs:1410 allow_data_races_ref
InterpCx.prototype.allow_data_races_ref = function <R>(this: MiriInterpCx, op: (_0: MiriInterpCx) => R): R {
  const this_ = this.eval_context_ref();
  GlobalDataRaceHandler_set_ongoing_action_data_race_free(this_.machine.data_race, true);
  const result = op(this_);
  GlobalDataRaceHandler_set_ongoing_action_data_race_free(this_.machine.data_race, false);
  return result;
};

/// Same as `allow_data_races_ref`, this temporarily disables any data-race detection and
/// so should only be used for atomic operations or internal state that the program cannot
/// access.
// #[inline]
// rustc: src/tools/miri/src/concurrency/data_race.rs:1422 allow_data_races_mut
InterpCx.prototype.allow_data_races_mut = function <R>(this: MiriInterpCx, op: (_0: MiriInterpCx) => R): R {
  const this_ = this.eval_context_mut();
  GlobalDataRaceHandler_set_ongoing_action_data_race_free(this_.machine.data_race, true);
  const result = op(this_);
  GlobalDataRaceHandler_set_ongoing_action_data_race_free(this_.machine.data_race, false);
  return result;
};

/// Checks that an atomic access is legal at the given place.
// rustc: src/tools/miri/src/concurrency/data_race.rs:1431 atomic_access_check
InterpCx.prototype.atomic_access_check = function (this: MiriInterpCx, place: MPlaceTy, access_type: AtomicAccessType): InterpResult {
  const this_ = this.eval_context_ref();
  // Check alignment requirements. Atomics must always be aligned to their size,
  // even if the type they wrap would be less aligned (e.g. AtomicU64 on 32bit must
  // be 8-aligned).
  const align = unwrap_result(Align.from_bytes(place.layout.size.bytes()), debug_AlignFromBytesError);
  const c = this_.check_ptr_align(place.ptr(), align);
  if (c.$ === "Err") return c;
  // Ensure the allocation is mutable. Even failing (read-only) compare_exchange need mutable
  // memory on many targets (i.e., they segfault if that memory is mapped read-only), and
  // atomic loads can be implemented via compare_exchange on some targets. There could
  // possibly be some very specific exceptions to this, see
  // <https://github.com/rust-lang/miri/pull/2464#discussion_r939636130> for details.
  // We avoid `get_ptr_alloc` since we do *not* want to run the access hooks -- the actual
  // access will happen later.
  const [alloc_id, _offset, _prov] = expect_result(
    this_.ptr_try_get_alloc_id(place.ptr(), 0n),
    "there are no zero-sized atomic accesses",
    (e) => String(e),
  );
  const mutability = this_.get_alloc_mutability(alloc_id);
  if (mutability.$ === "Err") return mutability;
  if (mutability._0 === "Not") {
    // See if this is fine.
    if (access_type.$ === "Rmw" || access_type.$ === "Store") {
      // throw_ub_format!(..)
      return Err(
        InterpErrorInfo_from_InterpErrorKind({
          $: "UndefinedBehavior",
          _0: {
            $: "Ub",
            _0:
              "atomic store and read-modify-write operations cannot be performed on read-only memory\n" +
              "see <https://doc.rust-lang.org/nightly/std/sync/atomic/index.html#atomic-accesses-to-read-only-memory> for more information",
          },
        }),
      );
    } else if (access_type.$ === "Load" && Size_cmp(place.layout.size, this_.tcx.data_layout().pointer_size()) === 1) {
      return Err(
        InterpErrorInfo_from_InterpErrorKind({
          $: "UndefinedBehavior",
          _0: {
            $: "Ub",
            _0:
              "large atomic load operations cannot be performed on read-only memory\n" +
              "these operations often have to be implemented using read-modify-write operations, which require writeable memory\n" +
              "see <https://doc.rust-lang.org/nightly/std/sync/atomic/index.html#atomic-accesses-to-read-only-memory> for more information",
          },
        }),
      );
    } else if (access_type.$ === "Load" && access_type._0 !== "Relaxed") {
      return Err(
        InterpErrorInfo_from_InterpErrorKind({
          $: "UndefinedBehavior",
          _0: {
            $: "Ub",
            _0:
              "non-relaxed atomic load operations cannot be performed on read-only memory\n" +
              "these operations sometimes have to be implemented using read-modify-write operations, which require writeable memory\n" +
              "see <https://doc.rust-lang.org/nightly/std/sync/atomic/index.html#atomic-accesses-to-read-only-memory> for more information",
          },
        }),
      );
    } else {
      // Large relaxed loads are fine!
    }
  }
  return interp_ok(undefined);
};

/// Update the data-race detector for an atomic read occurring at the
/// associated memory-place and on the current thread.
// rustc: src/tools/miri/src/concurrency/data_race.rs:1487 validate_atomic_load
InterpCx.prototype.validate_atomic_load = function (
  this: MiriInterpCx,
  place: MPlaceTy,
  atomic: AtomicReadOrd,
  sync_clock: VClock | undefined,
): InterpResult {
  const this_ = this.eval_context_ref();
  return this_.validate_atomic_op(place, atomic, AccessType.AtomicLoad, (memory, clocks, index, atomic) => {
    if (atomic === "Relaxed") {
      return memory.load_relaxed(clocks, index, place.layout.size, sync_clock);
    } else {
      return memory.load_acquire(clocks, index, place.layout.size, sync_clock);
    }
  });
};

/// Update the data-race detector for an atomic write occurring at the
/// associated memory-place and on the current thread.
// rustc: src/tools/miri/src/concurrency/data_race.rs:1510 validate_atomic_store
InterpCx.prototype.validate_atomic_store = function (this: MiriInterpCx, place: MPlaceTy, atomic: AtomicWriteOrd): InterpResult {
  const this_ = this.eval_context_mut();
  return this_.validate_atomic_op(place, atomic, AccessType.AtomicStore, (memory, clocks, index, atomic) => {
    if (atomic === "Relaxed") {
      return memory.store_relaxed(clocks, index, place.layout.size);
    } else {
      return memory.store_release(clocks, index, place.layout.size);
    }
  });
};

/// Update the data-race detector for an atomic read-modify-write occurring
/// at the associated memory place and on the current thread.
// rustc: src/tools/miri/src/concurrency/data_race.rs:1532 validate_atomic_rmw
InterpCx.prototype.validate_atomic_rmw = function (this: MiriInterpCx, place: MPlaceTy, atomic: AtomicRwOrd): InterpResult {
  const acquire = atomic === "Acquire" || atomic === "AcqRel" || atomic === "SeqCst";
  const release = atomic === "Release" || atomic === "AcqRel" || atomic === "SeqCst";
  const this_ = this.eval_context_mut();
  return this_.validate_atomic_op(place, atomic, AccessType.AtomicRmw, (memory, clocks, index, _) => {
    if (acquire) {
      const r = memory.load_acquire(clocks, index, place.layout.size, undefined);
      if (r.$ === "Err") return r;
    } else {
      const r = memory.load_relaxed(clocks, index, place.layout.size, undefined);
      if (r.$ === "Err") return r;
    }
    if (release) {
      return memory.rmw_release(clocks, index, place.layout.size);
    } else {
      return memory.rmw_relaxed(clocks, index, place.layout.size);
    }
  });
};

/// Generic atomic operation implementation
// rustc: src/tools/miri/src/concurrency/data_race.rs:1561 validate_atomic_op
InterpCx.prototype.validate_atomic_op = function <A>(
  this: MiriInterpCx,
  place: MPlaceTy,
  atomic: A,
  access: AccessType,
  op: (_0: MemoryCellClocks, _1: ThreadClockSet, _2: VectorIdx, _3: A) => Result<undefined, DataRace>,
): InterpResult {
  const this_ = this.eval_context_ref();
  assert(AccessType.is_atomic(access), "assertion failed: access.is_atomic()");
  const data_race = GlobalDataRaceHandler.as_vclocks_ref(this_.machine.data_race);
  if (data_race === undefined) {
    return interp_ok(undefined);
  }
  if (!data_race.race_detecting()) {
    return interp_ok(undefined);
  }
  const size = place.layout.size;
  const alloc = this_.ptr_get_alloc_id(place.ptr(), 0n);
  if (alloc.$ === "Err") return alloc;
  const [alloc_id, base_offset, _prov] = alloc._0;
  // Load and log the atomic operation.
  // Note that atomic loads are possible even from read-only allocations, so `get_alloc_extra_mut` is not an option.
  const extra = this_.get_alloc_extra(alloc_id);
  if (extra.$ === "Err") return extra;
  const alloc_meta = unwrap(AllocDataRaceHandler.as_vclocks_ref(extra._0.data_race));
  // trace!(
  //     "Atomic op({}) with ordering {:?} on {:?} (size={})",
  //     access.description(None, None),
  //     &atomic,
  //     place.ptr(),
  //     size.bytes()
  // );

  const current_span = this_.machine.current_user_relevant_span();
  // Perform the atomic operation.
  const r = data_race.maybe_perform_sync_operation(this_.machine.threads, current_span, (index, thread_clocks) => {
    for (const [mem_clocks_range, mem_clocks] of alloc_meta.alloc_ranges.iter_mut(base_offset, size)) {
      if (op(mem_clocks, thread_clocks, index, atomic).$ === "Err") {
        // mem::drop(thread_clocks);
        const rep = VClockAlloc.report_data_race(
          data_race,
          this_.machine.threads,
          mem_clocks,
          access,
          place.layout.size,
          interpret_Pointer.new(alloc_id, Size.from_bytes(range_start(mem_clocks_range))),
          undefined,
        );
        // `.map(|_| true)`
        return rep.$ === "Err" ? rep : interp_ok(true);
      }
    }

    // This conservatively assumes all operations have release semantics
    return interp_ok(true);
  });
  if (r.$ === "Err") return r;

  // Log changes to atomic memory.
  // if tracing::enabled!(tracing::Level::TRACE) {
  //     for (_offset, mem_clocks) in alloc_meta.alloc_ranges.borrow().iter(base_offset, size) {
  //         trace!(
  //             "Updated atomic memory({:?}, size={}) to {:#?}",
  //             place.ptr(),
  //             size.bytes(),
  //             mem_clocks.atomic_ops
  //         );
  //     }
  // }

  return interp_ok(undefined);
};

// impl GlobalState

/// Create a new global state, setup with just thread-id=0
/// advanced to timestamp = 1.
// rustc: src/tools/miri/src/concurrency/data_race.rs:1645 new
(GlobalState as unknown as { new: (config: MiriConfig) => GlobalState }).new = function (config: MiriConfig): GlobalState {
  const global_state = new GlobalState(
    false,
    false,
    [],
    [],
    [],
    // PORT: `FxHashSet<VectorIdx>` iterates in hashbrown order (`find_vector_index_reuse_candidate`): rust_ts/hash_map.ts.
    FxHashSet.default(VectorIdx_key),
    VClock.default(),
    VClock.default(),
    config.track_outdated_loads,
    config.weak_memory_emulation,
  );

  // Setup the main-thread since it is not explicitly created:
  // uses vector index and thread-id 0.
  // `IndexVec::push` returns the index of the new element.
  const index = VectorIdx.new(global_state.vector_clocks.length);
  global_state.vector_clocks.push(ThreadClockSet.default());
  global_state.vector_info.push(main_thread());
  global_state.thread_info.push({ vector_index: index, termination_vector_clock: undefined });

  return global_state;
};

// We perform data race detection when there are more than 1 active thread
// and we have not temporarily disabled race detection to perform something
// data race free
// rustc: src/tools/miri/src/concurrency/data_race.rs:1674 race_detecting
GlobalState.prototype.race_detecting = function (this: GlobalState): boolean {
  return this.multi_threaded && !this.ongoing_action_data_race_free;
};

// rustc: src/tools/miri/src/concurrency/data_race.rs:1678 ongoing_action_data_race_free
GlobalState.prototype.ongoing_action_data_race_free_ = function (this: GlobalState): boolean {
  return this.ongoing_action_data_race_free;
};

// Try to find vector index values that can potentially be re-used
// by a new thread instead of a new vector index being created.
// rustc: src/tools/miri/src/concurrency/data_race.rs:1684 find_vector_index_reuse_candidate
GlobalState.prototype.find_vector_index_reuse_candidate = function (this: GlobalState): VectorIdx | undefined {
  const reuse = this.reuse_candidates;
  const vector_clocks = this.vector_clocks;
  for (const candidate of reuse) {
    const target_timestamp = at(vector_clocks, candidate.index()).clock.index(candidate);
    // `vector_clocks.iter_enumerated().all(|(clock_idx, clock)| ..)`
    let all = true;
    for (let i = 0; i < vector_clocks.length; i++) {
      const clock_idx = VectorIdx.new(i);
      const clock = vector_clocks[i]!;
      // The thread happens before the clock, and hence cannot report
      // a data-race with this the candidate index.
      const no_data_race = VTimestamp_cmp(clock.clock.index(candidate), target_timestamp) !== -1;

      // The vector represents a thread that has terminated and hence cannot
      // report a data-race with the candidate index.
      const vector_terminated = reuse.has(clock_idx);

      // The vector index cannot report a race with the candidate index
      // and hence allows the candidate index to be re-used.
      if (!(no_data_race || vector_terminated)) {
        all = false;
        break;
      }
    }
    if (all) {
      // All vector clocks for each vector index are equal to
      // the target timestamp, and the thread is known to have
      // terminated, therefore this vector clock index cannot
      // report any more data-races.
      assert(reuse.delete(candidate), "assertion failed: reuse.remove(&candidate)");
      return candidate;
    }
  }
  return undefined;
};

// Hook for thread creation, enabled multi-threaded execution and marks
// the current thread timestamp as happening-before the current thread.
// #[inline]
// rustc: src/tools/miri/src/concurrency/data_race.rs:1716 thread_created
GlobalState.prototype.thread_created = function (this: GlobalState, thread_mgr: ThreadManager, thread: ThreadId, current_span: Span): void {
  const current_index = this.active_thread_index(thread_mgr);

  // Enable multi-threaded execution, there are now at least two threads
  // so data-races are now possible.
  this.multi_threaded = true;

  // Load and setup the associated thread metadata
  const thread_info = this.thread_info;
  // `thread_info.ensure_contains_elem(thread, Default::default)`
  while (thread_info.length <= thread_idx(thread)) {
    thread_info.push({ vector_index: undefined, termination_vector_clock: undefined });
  }

  // Assign a vector index for the thread, attempting to re-use an old
  // vector index that can no longer report any data-races if possible.
  let created_index: VectorIdx;
  const reuse_index = this.find_vector_index_reuse_candidate();
  if (reuse_index !== undefined) {
    // Now re-configure the re-use candidate, increment the clock
    // for the new sync use of the vector.
    const vector_clocks = this.vector_clocks;
    at(vector_clocks, reuse_index.index()).increment_clock(reuse_index, current_span);

    // Locate the old thread the vector was associated with and update
    // it to represent the new thread instead.
    const vector_info = this.vector_info;
    const old_thread = at(vector_info, reuse_index.index());
    vector_info[reuse_index.index()] = thread;

    // Mark the thread the vector index was associated with as no longer
    // representing a thread index.
    at(thread_info, thread_idx(old_thread)).vector_index = undefined;

    created_index = reuse_index;
  } else {
    // No vector re-use candidates available, instead create
    // a new vector index.
    const vector_info = this.vector_info;
    // `vector_info.push(thread)` returns the new index.
    created_index = VectorIdx.new(vector_info.length);
    vector_info.push(thread);
  }

  // trace!("Creating thread = {:?} with vector index = {:?}", thread, created_index);

  // Mark the chosen vector index as in use by the thread.
  at(thread_info, thread_idx(thread)).vector_index = created_index;

  // Create a thread clock set if applicable.
  const vector_clocks = this.vector_clocks;
  if (created_index.index() === vector_clocks.length) {
    vector_clocks.push(ThreadClockSet.default());
  }

  // Now load the two clocks and configure the initial state.
  // `vector_clocks.pick2_mut(current_index, created_index)`
  assert(current_index.index() !== created_index.index(), "assertion failed: ai != bi");
  const current = at(vector_clocks, current_index.index());
  const created = at(vector_clocks, created_index.index());

  // Join the created with current, since the current threads
  // previous actions happen-before the created thread.
  created.join_with(current);

  // Advance both threads after the synchronized operation.
  // Both operations are considered to have release semantics.
  current.increment_clock(current_index, current_span);
  created.increment_clock(created_index, current_span);
};

/// Hook on a thread join to update the implicit happens-before relation between the joined
/// thread (the joinee, the thread that someone waited on) and the current thread (the joiner,
/// the thread who was waiting).
// #[inline]
// rustc: src/tools/miri/src/concurrency/data_race.rs:1786 thread_joined
GlobalState.prototype.thread_joined = function (this: GlobalState, threads: ThreadManager, joinee: ThreadId): void {
  const thread_info = at(this.thread_info, thread_idx(joinee));

  // Load the associated vector clock for the terminated thread.
  const join_clock = unwrap(thread_info.termination_vector_clock, "joined with thread but thread has not terminated");
  // Acquire that into the current thread.
  this.acquire_clock(join_clock, threads);

  // Check the number of live threads, if the value is 1
  // then test for potentially disabling multi-threaded execution.
  // This has to happen after `acquire_clock`, otherwise there'll always
  // be some thread that has not synchronized yet.
  const current_index = thread_info.vector_index;
  if (current_index !== undefined) {
    if (threads.get_live_thread_count() === 1) {
      const vector_clocks = this.vector_clocks;
      // May potentially be able to disable multi-threaded execution.
      const current_clock = at(vector_clocks, current_index.index());
      // `vector_clocks.iter_enumerated().all(|(idx, clocks)| clocks.clock[idx] <= current_clock.clock[idx])`
      let all = true;
      for (let i = 0; i < vector_clocks.length; i++) {
        const idx = VectorIdx.new(i);
        if (VTimestamp_cmp(vector_clocks[i]!.clock.index(idx), current_clock.clock.index(idx)) === 1) {
          all = false;
          break;
        }
      }
      if (all) {
        // All thread terminations happen-before the current clock
        // therefore no data-races can be reported until a new thread
        // is created, so disable multi-threaded execution.
        this.multi_threaded = false;
      }
    }
  }
};

/// On thread termination, the vector clock may be re-used
/// in the future once all remaining thread-clocks catch
/// up with the time index of the terminated thread.
/// This assigns thread termination with a unique index
/// which will be used to join the thread
/// This should be called strictly before any calls to
/// `thread_joined`.
// #[inline]
// rustc: src/tools/miri/src/concurrency/data_race.rs:1828 thread_terminated
GlobalState.prototype.thread_terminated = function (this: GlobalState, thread_mgr: ThreadManager): void {
  const current_thread = thread_mgr.active_thread_();
  const current_index = this.active_thread_index(thread_mgr);

  // Store the terminaion clock.
  const terminaion_clock = this.release_clock(thread_mgr, (clock) => clone_VClock(clock));
  at(this.thread_info, thread_idx(current_thread)).termination_vector_clock = terminaion_clock;

  // Add this thread's clock index as a candidate for re-use.
  const reuse = this.reuse_candidates;
  reuse.add(canon(current_index));
};

/// Update the data-race detector for an atomic fence on the current thread.
// rustc: src/tools/miri/src/concurrency/data_race.rs:1843 atomic_fence
GlobalState.prototype.atomic_fence = function (this: GlobalState, machine: MiriMachine, atomic: AtomicFenceOrd): InterpResult {
  const current_span = machine.current_user_relevant_span();
  return this.maybe_perform_sync_operation(machine.threads, current_span, (_index, clocks) => {
    // trace!("Atomic fence on {:?} with ordering {:?}", index, atomic);

    // Apply data-race detection for the current fences
    // this treats AcqRel and SeqCst as the same as an acquire
    // and release fence applied in the same timestamp.
    if (atomic !== "Release") {
      // Either Acquire | AcqRel | SeqCst
      clocks.apply_acquire_fence();
    }
    if (atomic === "SeqCst") {
      // Behave like an RMW on the global fence location. This takes full care of
      // all the SC fence requirements, including C++17 §32.4 [atomics.order]
      // paragraph 6 (which would limit what future reads can see). It also rules
      // out many legal behaviors, but we don't currently have a model that would
      // be more precise.
      // Also see the second bullet on page 10 of
      // <https://www.cs.tau.ac.il/~orilahav/papers/popl21_robustness.pdf>.
      const sc_fence_clock = this.last_sc_fence;
      sc_fence_clock.join(clocks.clock);
      clocks.clock.join(sc_fence_clock);
      // Also establish some sort of order with the last SC write that happened, globally
      // (but this is only respected by future reads).
      clocks.write_seqcst.join(this.last_sc_write_per_thread);
    }
    // The release fence is last, since both of the above could alter our clock,
    // which should be part of what is being released.
    if (atomic !== "Acquire") {
      // Either Release | AcqRel | SeqCst
      clocks.apply_release_fence();
    }

    // Increment timestamp in case of release semantics.
    return interp_ok(atomic !== "Acquire");
  });
};

/// Attempt to perform a synchronized operation, this
/// will perform no operation if multi-threading is
/// not currently enabled.
/// Otherwise it will increment the clock for the current
/// vector before and after the operation for data-race
/// detection between any happens-before edges the
/// operation may create.
// rustc: src/tools/miri/src/concurrency/data_race.rs:1893 maybe_perform_sync_operation
GlobalState.prototype.maybe_perform_sync_operation = function (
  this: GlobalState,
  thread_mgr: ThreadManager,
  current_span: Span,
  op: (_0: VectorIdx, _1: ThreadClockSet) => InterpResult<boolean>,
): InterpResult {
  if (this.multi_threaded) {
    const [index, clocks] = this.active_thread_state_mut(thread_mgr);
    const r = op(index, clocks);
    if (r.$ === "Err") return r;
    if (r._0) {
      const [, clocks] = this.active_thread_state_mut(thread_mgr);
      clocks.increment_clock(index, current_span);
    }
  }
  return interp_ok(undefined);
};

/// Internal utility to identify a thread stored internally
/// returns the id and the name for better diagnostics.
// rustc: src/tools/miri/src/concurrency/data_race.rs:1911 print_thread_metadata
GlobalState.prototype.print_thread_metadata = function (this: GlobalState, thread_mgr: ThreadManager, vector: VectorIdx): string {
  const thread = at(this.vector_info, vector.index());
  const thread_name = thread_mgr.get_thread_display_name(thread);
  return `thread \`${thread_name}\``;
};

/// Acquire the given clock into the current thread, establishing synchronization with
/// the moment when that clock snapshot was taken via `release_clock`.
/// As this is an acquire operation, the thread timestamp is not
/// incremented.
// rustc: src/tools/miri/src/concurrency/data_race.rs:1921 acquire_clock
GlobalState.prototype.acquire_clock = function (this: GlobalState, clock: VClock, threads: ThreadManager): void {
  const thread = threads.active_thread_();
  const [, clocks] = this.thread_state_mut(thread);
  clocks.clock.join(clock);
};

/// Calls the given closure with the "release" clock of the current thread.
/// Other threads can acquire this clock in the future to establish synchronization
/// with this program point.
// rustc: src/tools/miri/src/concurrency/data_race.rs:1930 release_clock
GlobalState.prototype.release_clock = function <R>(this: GlobalState, threads: ThreadManager, callback: (_0: VClock) => R): R {
  const thread = threads.active_thread_();
  const span = threads.active_thread_ref().current_user_relevant_span();
  const [index, clocks] = this.thread_state_mut(thread);
  const r = callback(clocks.clock);
  // Increment the clock, so that all following events cannot be confused with anything that
  // occurred before the release. Crucially, the callback is invoked on the *old* clock!
  clocks.increment_clock(index, span);

  return r;
};

// rustc: src/tools/miri/src/concurrency/data_race.rs:1946 thread_index
GlobalState.prototype.thread_index = function (this: GlobalState, thread: ThreadId): VectorIdx {
  return unwrap(at(this.thread_info, thread_idx(thread)).vector_index, "thread has no assigned vector");
};

/// Load the vector index used by the given thread as well as the set of vector clocks
/// used by the thread.
// #[inline]
// rustc: src/tools/miri/src/concurrency/data_race.rs:1953 thread_state_mut
GlobalState.prototype.thread_state_mut = function (this: GlobalState, thread: ThreadId): [VectorIdx, ThreadClockSet] {
  const index = this.thread_index(thread);
  const ref_vector = this.vector_clocks;
  const clocks = at(ref_vector, index.index());
  return [index, clocks];
};

/// Load the vector index used by the given thread as well as the set of vector clocks
/// used by the thread.
// #[inline]
// rustc: src/tools/miri/src/concurrency/data_race.rs:1963 thread_state
GlobalState.prototype.thread_state = function (this: GlobalState, thread: ThreadId): [VectorIdx, ThreadClockSet] {
  const index = this.thread_index(thread);
  const ref_vector = this.vector_clocks;
  const clocks = at(ref_vector, index.index());
  return [index, clocks];
};

/// Load the current vector clock in use and the current set of thread clocks
/// in use for the vector.
// #[inline]
// rustc: src/tools/miri/src/concurrency/data_race.rs:1973 active_thread_state
GlobalState.prototype.active_thread_state = function (this: GlobalState, thread_mgr: ThreadManager): [VectorIdx, ThreadClockSet] {
  return this.thread_state(thread_mgr.active_thread_());
};

/// Load the current vector clock in use and the current set of thread clocks
/// in use for the vector mutably for modification.
// #[inline]
// rustc: src/tools/miri/src/concurrency/data_race.rs:1983 active_thread_state_mut
GlobalState.prototype.active_thread_state_mut = function (this: GlobalState, thread_mgr: ThreadManager): [VectorIdx, ThreadClockSet] {
  return this.thread_state_mut(thread_mgr.active_thread_());
};

/// Return the current thread, should be the same
/// as the data-race active thread.
// #[inline]
// rustc: src/tools/miri/src/concurrency/data_race.rs:1993 active_thread_index
GlobalState.prototype.active_thread_index = function (this: GlobalState, thread_mgr: ThreadManager): VectorIdx {
  const active_thread_id = thread_mgr.active_thread_();
  return this.thread_index(active_thread_id);
};

// SC ATOMIC STORE rule in the paper.
// rustc: src/tools/miri/src/concurrency/data_race.rs:1999 sc_write
GlobalState.prototype.sc_write = function (this: GlobalState, thread_mgr: ThreadManager): void {
  const [index, clocks] = this.active_thread_state(thread_mgr);
  this.last_sc_write_per_thread.set_at_index(clocks.clock, index);
};

// SC ATOMIC READ rule in the paper.
// rustc: src/tools/miri/src/concurrency/data_race.rs:2005 sc_read
GlobalState.prototype.sc_read = function (this: GlobalState, thread_mgr: ThreadManager): void {
  const [, clocks] = this.active_thread_state_mut(thread_mgr);
  clocks.read_seqcst.join(this.last_sc_fence);
};
