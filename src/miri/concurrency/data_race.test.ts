// Lane miri-race (not a port: upstream tests data-race detection only in its external test suite, vector_clock.rs:433).
// Hand-built access sequences on the vector-clock detector of concurrency/data_race.ts, with a stand-in thread manager
// (`ThreadManager` is lane miri-threads). Expected values are worked out from upstream data_race.rs at the pin.
import { expect, test } from "bun:test";
import "../lib.ts";
import { Size } from "../../rustc_abi/lib.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { Unported } from "../../std/panic.ts";
import { AccessType, GlobalState, MemoryCellClocks, NaReadType, NaWriteType, VClockAlloc } from "./data_race.ts";
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
  active_thread_ref(): { current_user_relevant_span(): typeof DUMMY_SP } {
    return { current_user_relevant_span: () => DUMMY_SP };
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

function na_write(g: GlobalState, mgr: ThreadManager, c: MemoryCellClocks): boolean {
  const [idx, clocks] = g.active_thread_state_mut(mgr);
  return c.non_atomic_write_detect(clocks, idx, "Write", DUMMY_SP).$ === "Ok";
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

test("report_data_race picks the racing access and stops at the pending TerminationInfo machine-stop (miri-driver)", () => {
  const { g, tm, mgr } = setup();
  spawn(g, tm, mgr, 1);
  const cell = alloc_cell(g, mgr);
  expect(na_write(g, mgr, cell)).toBe(true);
  tm.active = 1;
  expect(na_write(g, mgr, cell)).toBe(false);
  const ptr = Pointer.new(1n as unknown as AllocId, Size.ZERO);
  let err: unknown;
  try {
    VClockAlloc.report_data_race(g, mgr, cell, { $: "NaWrite", _0: "Write" }, Size.from_bytes(4), ptr, undefined);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Unported);
  expect((err as Unported).what).toContain("TerminationInfo: MachineStopType");
});
