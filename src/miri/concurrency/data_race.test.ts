// Lane miri-race (not a port: upstream tests data-race detection only in its external test suite, vector_clock.rs:433).
// Hand-built access sequences on the vector-clock detector of concurrency/data_race.ts, with a stand-in thread manager
// (`ThreadManager` is lane miri-threads). Expected values are worked out from upstream data_race.rs at the pin.
import { expect, test } from "bun:test";
import "../lib.ts";
import { Size } from "../../rustc_abi/lib.ts";
import { BytePos, DUMMY_SP, Span, create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { TerminationInfoStop, type TerminationInfo, display_TerminationInfo } from "../diagnostics.ts";
import { AccessType, FrameState, GlobalState, MemoryCellClocks, NaReadType, NaWriteType, VClockAlloc } from "./data_race.ts";
import { type MiriMachine } from "../machine.ts";
import { type Local } from "../../rustc_middle/mir/mod.ts";
import { ThreadId, type ThreadManager } from "./thread.ts";
import { VClock, VTimestamp, VectorIdx, clone_VClock } from "./vector_clock.ts";
import { type MiriConfig } from "../eval.ts";
import { Pointer } from "../../rustc_middle/mir/interpret/pointer.ts";
import { type AllocId } from "../../rustc_middle/mir/interpret/mod.ts";

/** A stand-in `ThreadManager`: the active thread, the live count, display names (`main`, `t1`, ...). */
class FakeThreads {
  active = 0;
  live = 1;
  active_thread_(): ThreadId {
    return new ThreadId(this.active);
  }
  /** The span of the active thread's current statement (`DUMMY_SP` unless a test sets per-thread spans). */
  span: (t: number) => Span = () => DUMMY_SP;
  active_thread_ref(): { current_user_relevant_span(): Span } {
    return { current_user_relevant_span: () => this.span(this.active) };
  }
  get_live_thread_count(): number {
    return this.live;
  }
  get_thread_display_name(t: ThreadId): string {
    return t._0 === 0 ? "main" : `t${t._0}`;
  }
}

const CONFIG = { track_outdated_loads: false, weak_memory_emulation: true } as unknown as MiriConfig;

function setup(): { g: GlobalState; tm: FakeThreads; mgr: ThreadManager } {
  const tm = new FakeThreads();
  return { g: GlobalState.new(CONFIG), tm, mgr: tm as unknown as ThreadManager };
}

/** Spawns thread `id` from the active thread (`thread_created`). */
function spawn(g: GlobalState, tm: FakeThreads, mgr: ThreadManager, id: number): void {
  g.thread_created(mgr, new ThreadId(id), DUMMY_SP);
  tm.live++;
}

/** Terminates the active thread, then joins it from `joiner`. */
function finish(g: GlobalState, tm: FakeThreads, mgr: ThreadManager, id: number, joiner: number): void {
  tm.active = id;
  g.thread_terminated(mgr);
  tm.live--;
  tm.active = joiner;
  g.thread_joined(mgr, new ThreadId(id));
}

/** A memory cell allocated by the active thread "now" (like `VClockAlloc::new_allocation` for heap memory). */
function alloc_cell(g: GlobalState, mgr: ThreadManager): MemoryCellClocks {
  const [idx, clocks] = g.active_thread_state(mgr);
  return MemoryCellClocks.new(clocks.clock.index(idx), idx);
}

function na_write(g: GlobalState, mgr: ThreadManager, c: MemoryCellClocks, span: Span = DUMMY_SP): boolean {
  const [idx, clocks] = g.active_thread_state_mut(mgr);
  return c.non_atomic_write_detect(clocks, idx, "Write", span).$ === "Ok";
}
function na_read(g: GlobalState, mgr: ThreadManager, c: MemoryCellClocks): boolean {
  const [idx, clocks] = g.active_thread_state_mut(mgr);
  return c.non_atomic_read_detect(clocks, idx, "Read", DUMMY_SP).$ === "Ok";
}
/** An atomic op as `validate_atomic_op` does it: run `op`, then increment the clock (release semantics). */
function atomic(g: GlobalState, mgr: ThreadManager, op: (idx: VectorIdx, clocks: ReturnType<GlobalState["active_thread_state_mut"]>[1]) => boolean): boolean {
  let ok = true;
  const r = g.maybe_perform_sync_operation(mgr, DUMMY_SP, (idx, clocks) => {
    ok = op(idx, clocks);
    return { $: "Ok", _0: true };
  });
  expect(r.$).toBe("Ok");
  return ok;
}

test("GlobalState::new / thread_created: main is index 0 at time 0, the child joins main's clock", () => {
  const { g, tm, mgr } = setup();
  expect(g.race_detecting()).toBe(false);
  expect(g.thread_index(new ThreadId(0))).toBe(VectorIdx.new(0));
  spawn(g, tm, mgr, 1);
  expect(g.race_detecting()).toBe(true);
  expect(g.thread_index(new ThreadId(1))).toBe(VectorIdx.new(1));
  // main: [1]; t1: [0 joined, 1] -> [0, 1] (main's clock was empty before the increment)
  expect(g.vector_clocks.map((c) => c.clock._0.map((t) => t.time()))).toEqual([[1], [0, 1]]);
});

test("unsynchronized non-atomic write/write and read/write race; join synchronizes", () => {
  const { g, tm, mgr } = setup();
  spawn(g, tm, mgr, 1);
  const cell = alloc_cell(g, mgr); // allocated by main after the spawn
  expect(na_write(g, mgr, cell)).toBe(true); // main writes its own allocation
  tm.active = 1;
  expect(na_write(g, mgr, cell)).toBe(false); // t1 writes: races with main's write

  // read in t1 racing with a write in main
  const cell2 = alloc_cell(g, mgr); // allocated by t1
  expect(na_read(g, mgr, cell2)).toBe(true);
  tm.active = 0;
  expect(na_write(g, mgr, cell2)).toBe(false);

  // after t1 terminates and main joins it, main's accesses happen-after t1's
  const cell3 = (() => {
    tm.active = 1;
    const c = alloc_cell(g, mgr);
    expect(na_write(g, mgr, c)).toBe(true);
    return c;
  })();
  finish(g, tm, mgr, 1, 0);
  expect(na_write(g, mgr, cell3)).toBe(true);
  // upstream compares every clock with the *joinee's* clock (data_race.rs:1802 `thread_info.vector_index` is the
  // joinee's), and main's own entry (1) is ahead of t1's view of it (0): race detection stays on
  expect(g.multi_threaded).toBe(true);
});

test("message passing: allocation, release, acquire, then the read is ordered", () => {
  const { g, tm, mgr } = setup();
  // main allocates both cells before spawning: allocation happens-before both threads
  const size = Size.from_bytes(4);
  const data = alloc_cell(g, mgr);
  const flag = alloc_cell(g, mgr);
  spawn(g, tm, mgr, 1);
  spawn(g, tm, mgr, 2);
  tm.active = 1;
  expect(na_write(g, mgr, data)).toBe(true);
  expect(atomic(g, mgr, (idx, cl) => flag.store_release(cl, idx, size).$ === "Ok")).toBe(true);
  tm.active = 2;
  // acquire load: joins flag's sync clock
  expect(atomic(g, mgr, (idx, cl) => flag.load_acquire(cl, idx, size, undefined).$ === "Ok")).toBe(true);
  expect(na_read(g, mgr, data)).toBe(true);

  // the same with a relaxed load races
  const { g: g2, tm: tm2, mgr: mgr2 } = setup();
  const data_ = alloc_cell(g2, mgr2);
  const flag_ = alloc_cell(g2, mgr2);
  spawn(g2, tm2, mgr2, 1);
  spawn(g2, tm2, mgr2, 2);
  tm2.active = 1;
  expect(na_write(g2, mgr2, data_)).toBe(true);
  expect(atomic(g2, mgr2, (idx, cl) => flag_.store_release(cl, idx, size).$ === "Ok")).toBe(true);
  tm2.active = 2;
  expect(atomic(g2, mgr2, (idx, cl) => flag_.load_relaxed(cl, idx, size, undefined).$ === "Ok")).toBe(true);
  expect(na_read(g2, mgr2, data_)).toBe(false);
  // ... unless followed by an acquire fence
  expect(atomic(g2, mgr2, (_idx, cl) => (cl.apply_acquire_fence(), true))).toBe(true);
  expect(na_read(g2, mgr2, data_)).toBe(true);
});

test("mixed-size atomic accesses: same-size ok, unsynchronized different-size write races", () => {
  const { g, tm, mgr } = setup();
  const cell = alloc_cell(g, mgr);
  spawn(g, tm, mgr, 1);
  tm.active = 0;
  expect(atomic(g, mgr, (idx, cl) => cell.store_relaxed(cl, idx, Size.from_bytes(4)).$ === "Ok")).toBe(true);
  tm.active = 1;
  expect(atomic(g, mgr, (idx, cl) => cell.store_relaxed(cl, idx, Size.from_bytes(4)).$ === "Ok")).toBe(true);
  expect(atomic(g, mgr, (idx, cl) => cell.store_relaxed(cl, idx, Size.from_bytes(2)).$ === "Ok")).toBe(false);
});

test("vector index reuse after terminate + join", () => {
  const { g, tm, mgr } = setup();
  spawn(g, tm, mgr, 1);
  finish(g, tm, mgr, 1, 0);
  expect([...g.reuse_candidates].map((v) => v.index())).toEqual([1]);
  // the join acquired t1's clock from before its release increment ([0, 1]; t1 is at [0, 2]): not reusable yet
  expect(g.find_vector_index_reuse_candidate()).toBeUndefined();
  // once main has caught up with t1's last timestamp, index 1 can be reused
  g.acquire_clock(clone_VClock(g.vector_clocks[1]!.clock), mgr);
  spawn(g, tm, mgr, 2);
  // t2 reuses t1's index; t1 no longer has one
  expect(g.thread_index(new ThreadId(2))).toBe(VectorIdx.new(1));
  expect(g.thread_info[1]!.vector_index).toBeUndefined();
  expect(g.reuse_candidates.size).toBe(0);
  expect(g.vector_info.map((t) => t._0)).toEqual([0, 2]);
  // reused clock: incremented for the new use ([0, 3]), joined with main ([1, 2]), incremented again
  expect(g.vector_clocks.map((c) => c.clock._0.map((t) => t.time()))).toEqual([[2, 2], [1, 4]]);
});

test("find_gt_index", () => {
  const c = (ts: number[]) => new VClock(ts.map((t) => VTimestamp.new(t, "Read", DUMMY_SP)));
  expect(VClockAlloc.find_gt_index(c([1, 2]), c([1, 2]))).toBeUndefined();
  expect(VClockAlloc.find_gt_index(c([1, 3]), c([1, 2]))?.index()).toBe(1);
  expect(VClockAlloc.find_gt_index(c([1, 2, 0, 4]), c([1, 2]))?.index()).toBe(3);
  expect(VClockAlloc.find_gt_index(c([1]), c([1, 5]))).toBeUndefined();
});

test("AccessType / NaReadType / NaWriteType descriptions (race report text)", () => {
  expect(AccessType.description({ $: "NaWrite", _0: "Write" }, undefined, undefined)).toBe("non-atomic write");
  expect(AccessType.description({ $: "NaRead", _0: "Retag" }, undefined, undefined)).toBe("retag read");
  expect(AccessType.description(AccessType.AtomicRmw, undefined, undefined)).toBe("atomic read-modify-write");
  expect(AccessType.description(AccessType.AtomicStore, undefined, Size.from_bytes(4))).toBe("4-byte atomic store");
  expect(AccessType.description(AccessType.AtomicLoad, undefined, Size.ZERO)).toBe(
    "multiple differently-sized atomic loads, including one load",
  );
  expect(NaWriteType.description("Allocate")).toBe("creating a new allocation");
  expect(NaWriteType.description("Deallocate")).toBe("deallocation");
  expect(NaReadType.description("Read")).toBe("non-atomic read");
  expect(AccessType.is_retag({ $: "NaWrite", _0: "Retag" })).toBe(true);
  expect(AccessType.is_read(AccessType.AtomicLoad) && !AccessType.is_read(AccessType.AtomicRmw)).toBe(true);
  const { g, tm, mgr } = setup();
  spawn(g, tm, mgr, 1);
  expect(g.print_thread_metadata(mgr, VectorIdx.new(0))).toBe("thread `main`");
  expect(g.print_thread_metadata(mgr, VectorIdx.new(1))).toBe("thread `t1`");
});

/** Runs `report_data_race` for `access` by the active thread and returns the `TerminationInfo` of its machine stop. */
function report(g: GlobalState, mgr: ThreadManager, cell: MemoryCellClocks, access: AccessType, ptr: Pointer<AllocId>): TerminationInfo {
  const r = VClockAlloc.report_data_race(g, mgr, cell, access, Size.from_bytes(4), ptr, undefined);
  if (r.$ !== "Err") throw new Error("report_data_race must return Err");
  const kind = r._0.kind();
  if (kind.$ !== "MachineStop") throw new Error(`expected MachineStop, got ${kind.$}`);
  const info = TerminationInfoStop.downcast_ref(kind._0);
  if (info === undefined) throw new Error("the machine stop must be a TerminationInfo");
  return info;
}

/** Distinct spans per thread: `current_user_relevant_span()` of the active thread and the span of its accesses. */
function thread_span(t: number): Span {
  return Span.with_root_ctxt(BytePos(100 * (t + 1)), BytePos(100 * (t + 1) + 7));
}

test("report_data_race: an Err(MachineStop(DataRace)) naming both accesses, their threads and spans; upstream Display", () => {
  create_default_session_globals_then(() => {
    const { g, tm, mgr } = setup();
    tm.span = thread_span;
    spawn(g, tm, mgr, 1);
    const cell = alloc_cell(g, mgr);
    expect(na_write(g, mgr, cell, thread_span(0))).toBe(true);
    tm.active = 1;
    expect(na_write(g, mgr, cell, thread_span(1))).toBe(false);
    const ptr = Pointer.new(1 as AllocId, Size.from_bytes(8));
    const info = report(g, mgr, cell, { $: "NaWrite", _0: "Write" }, ptr);
    // op1 is the earlier non-atomic write by `main` (its span: main's write), op2 the racing write by `t1` (its span:
    // t1's clock entry, set by its write before the race check, data_race.rs:724). Swapping op1/op2 or their spans
    // changes these fields.
    if (info.$ !== "DataRace") throw new Error(`expected DataRace, got ${info.$}`);
    expect(info.involves_non_atomic).toBe(true);
    expect(info.retag_explain).toBe(false);
    expect(info.extra).toBeUndefined();
    expect(info.ptr).toBe(ptr);
    expect(info.op1.action).toBe("non-atomic write");
    expect(info.op1.thread_info).toBe("thread `main`");
    expect(info.op1.span).toBe(thread_span(0));
    expect(info.op2.action).toBe("non-atomic write");
    expect(info.op2.thread_info).toBe("thread `t1`");
    expect(info.op2.span).toBe(thread_span(1));
    // diagnostics.rs:92: "{} detected between (1) {} on {} and (2) {} on {} at {ptr:?}"; `Pointer<AllocId>` Debug is the
    // `AllocId` (`alloc1`) and, for a non-zero offset, `+{:#x}` (pointer.rs:202).
    expect(display_TerminationInfo(info)).toBe(
      "Data race detected between (1) non-atomic write on thread `main` and (2) non-atomic write on thread `t1` at alloc1+0x8",
    );
  });
});

test("report_data_race: branch order (an unsynchronized atomic store is reported before an older non-atomic write)", () => {
  create_default_session_globals_then(() => {
    const { g, tm, mgr } = setup();
    tm.span = thread_span;
    const cell = alloc_cell(g, mgr);
    const scratch = alloc_cell(g, mgr);
    spawn(g, tm, mgr, 1);
    spawn(g, tm, mgr, 2);
    // main: a non-atomic write after the spawns (t1 and t2 are not synchronized with it)
    expect(na_write(g, mgr, cell, thread_span(0))).toBe(true);
    // t1: a write elsewhere sets its clock entry's span (data_race.rs:724), then an atomic store to `cell` that races
    // with main's write but is recorded first (atomic_write_detect, data_race.rs:678)
    tm.active = 1;
    expect(na_write(g, mgr, scratch, thread_span(1))).toBe(true);
    expect(atomic(g, mgr, (idx, cl) => cell.store_relaxed(cl, idx, Size.from_bytes(4)).$ === "Ok")).toBe(false);
    // t2: a non-atomic write races with both. Upstream checks the atomic store first (data_race.rs:1125), so op1 is
    // t1's atomic store, not main's non-atomic write (the third branch, data_race.rs:1137).
    tm.active = 2;
    expect(na_write(g, mgr, cell, thread_span(2))).toBe(false);
    const ptr = Pointer.new(3 as AllocId, Size.ZERO);
    const info = report(g, mgr, cell, { $: "NaWrite", _0: "Write" }, ptr);
    if (info.$ !== "DataRace") throw new Error(`expected DataRace, got ${info.$}`);
    // `description(None, None)` (data_race.rs:419): no size prefix outside mixed-size races
    expect(info.op1.action).toBe("atomic store");
    expect(info.op1.thread_info).toBe("thread `t1`");
    expect(info.op1.span).toBe(thread_span(1));
    expect(info.op2.action).toBe("non-atomic write");
    expect(info.op2.thread_info).toBe("thread `t2`");
    expect(info.op2.span).toBe(thread_span(2));
    expect(info.involves_non_atomic).toBe(true);
    expect(info.extra).toBeUndefined();
    expect(display_TerminationInfo(info)).toBe(
      "Data race detected between (1) atomic store on thread `t1` and (2) non-atomic write on thread `t2` at alloc3",
    );
  });
});

// Lane perf-miri: `FrameState::local_write` / `local_read` read `current_user_relevant_span()` after the `race_detecting()`
// early return (upstream reads it before; see the PORT(perf) note). With race detection on, the span must still reach the
// active thread's clock entry, which is what a later race report names (miri-fail data_race/local_variable_*_race.rs).
test("FrameState::local_write / local_read: the span reaches the clock with race detection on, and is not read with it off", () => {
  create_default_session_globals_then(() => {
    const { g, tm, mgr } = setup();
    let span_reads = 0;
    const machine = {
      data_race: { $: "Vclocks", _0: g },
      threads: mgr,
      current_user_relevant_span: (): Span => {
        span_reads++;
        return tm.span(tm.active);
      },
    } as unknown as MiriMachine;
    tm.span = thread_span;
    const frame = (FrameState as unknown as { default: () => FrameState }).default();
    const local = 3 as Local;
    const clock_span = (): Span => g.active_thread_state_mut(mgr)[1].clock.index(g.active_thread_index(mgr)).span;
    // Single-threaded: nothing is recorded, and the span is not needed.
    frame.local_write(local, true, machine);
    frame.local_read(local, machine);
    expect(span_reads).toBe(0);
    expect(frame.local_clocks.size).toBe(0);
    // Multi-threaded: each access records its thread's current span.
    spawn(g, tm, mgr, 1);
    frame.local_write(local, true, machine);
    expect(span_reads).toBe(1);
    expect(clock_span()).toBe(thread_span(0));
    expect(frame.local_clocks.get(local)?.write_type).toBe("Allocate");
    tm.active = 1;
    frame.local_read(local, machine);
    expect(span_reads).toBe(2);
    expect(clock_span()).toBe(thread_span(1));
    frame.local_write(local, false, machine);
    expect(frame.local_clocks.get(local)?.write_type).toBe("Write");
    expect(span_reads).toBe(3);
  });
});
