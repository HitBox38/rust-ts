// Lane miri-threads (plan-m6 wave 36; not a port): unit tests of the thread set, the scheduler and the sync primitives
// (concurrency/{thread,scheduler,sync,init_once,blocking_io}.ts) on small scenarios.
//
// The `MiriInterpCx` is a stand-in: an object on `InterpCx.prototype` whose `machine` holds the fields these files read
// (a real `ThreadManager`, `BlockingIoManager` and vendored `StdRng`, data race detection off), and whose methods owned by
// other wave-36 lanes are replaced by their data-race-off behaviour (`acquire_clock` / `release_clock`: data_race.rs:979 /
// :997 with `GlobalDataRaceHandler::None`), a recording `write_scalar`, and a scripted `step()` (one program per thread).
// Time is real: the machine's `monotonic_clock` is clock.ts's virtual `MonotonicClock` (`MonotonicClock::new(false)`),
// deadlines are virtual `Instant`s and durations src/std/time.ts `Duration`s (lane miri-wire).
import { afterAll, beforeAll, expect, test } from "bun:test";
import "../lib.ts";
import { type Deadline, Instant, MonotonicClock } from "../clock.ts";
import { TerminationInfoStop, TerminationInfo_into_machine_stop } from "../diagnostics.ts";
import { type MiriConfig } from "../eval.ts";
import { type MPlaceTy, type Scalar } from "../lib.ts";
import { AllocExtra, type MiriInterpCx, new_sync_objs } from "../machine.ts";
import { FdId } from "../shims/files.ts";
import { DelayedReadinessUpdates } from "../shims/readiness.ts";
import { BlockingIoManager, new_blocked_threads } from "./blocking_io.ts";
import { GlobalDataRaceHandler } from "./data_race_handler.ts";
import { InitOnceRef } from "./init_once.ts";
import { CondvarRef, FutexRef, MutexRef, RwLockRef, type SyncObj, SyncObj_provided } from "./sync.ts";
import {
  type DynUnblockCallback,
  type StackEmptyCallback,
  ThreadId,
  ThreadManager,
  type UnblockKind,
  debug_Thread,
  debug_ThreadState,
} from "./thread.ts";
import { Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, type MachineStopType } from "../../rustc_middle/mir/interpret/mod.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { Poll } from "../../std/task.ts";
import { Duration } from "../../std/time.ts";
import { StdRng } from "../../vendor/rand/rngs/std.ts";
import { EnvFilter, LayeredSubscriber, reset_global_default_for_tests, set_global_default } from "../../rust_ts/tracing.ts";
import { HierarchicalLayer, type Writer } from "../../rust_ts/tracing_tree.ts";

// ---------------------------------------------------------------- stand-ins ----

/** A deadline at virtual time `t` ns (a virtual-clock `Instant`, as `MonotonicClock::now` makes). */
const deadline = (t: bigint): Deadline => ({ $: "Monotonic", _0: new Instant({ $: "Virtual", nanoseconds: t }) });

let orig_process: typeof DelayedReadinessUpdates.process;
beforeAll(() => {
  orig_process = DelayedReadinessUpdates.process;
  // shims/readiness.rs:465 with no delayed updates (lane miri-shims-c)
  DelayedReadinessUpdates.process = () => interp_ok(undefined);
});
afterAll(() => {
  DelayedReadinessUpdates.process = orig_process;
});

type Program = (ecx: Cx) => boolean;
interface Cx extends MiriInterpCx {
  log: string[];
  writes: [Scalar, MPlaceTy][];
  programs: Program[];
  /** The virtual clock's current time in ns. */
  now: { readonly t: bigint };
}

function make_ecx(opts: { fixed?: boolean; preemption_rate?: number; seed?: bigint } = {}): Cx {
  const monotonic_clock = MonotonicClock.new(false);
  const now = {
    get t(): bigint {
      const kind = monotonic_clock.kind;
      if (kind.$ !== "Virtual") throw new Error("virtual clock expected");
      return BigInt(kind.nanoseconds);
    },
  };
  const machine = {
    threads: ThreadManager.new({ fixed_scheduling: opts.fixed ?? true } as MiriConfig),
    data_race: GlobalDataRaceHandler.None,
    rng: StdRng.seed_from_u64(opts.seed ?? 0n),
    preemption_rate: opts.preemption_rate ?? 0,
    monotonic_clock,
    blocking_io: (BlockingIoManager.new(false) as { _0: BlockingIoManager })._0,
    static_roots: [],
    thread_cpu_affinity: undefined,
    communicate: () => false,
    handle_abnormal_termination: () => {},
    current_user_relevant_span: () => DUMMY_SP,
  };
  const ecx = Object.create(InterpCx.prototype) as Cx;
  Object.assign(ecx, {
    machine,
    tcx: { deref: () => ({ sess: { target: { os: { $: "Linux" } } } }) },
    log: [],
    writes: [],
    programs: [],
    now,
    acquire_clock: () => interp_ok(undefined),
    release_clock: () => interp_ok(undefined),
    write_scalar(this: Cx, v: Scalar, d: MPlaceTy) {
      this.writes.push([v, d]);
      return interp_ok(undefined);
    },
    step(this: Cx) {
      const p = this.programs[this.active_thread().index()];
      return interp_ok(p === undefined ? false : p(this));
    },
  });
  return ecx;
}

const EXIT: StackEmptyCallback = () => Err(InterpErrorInfo_from_InterpErrorKind(TerminationInfo_into_machine_stop({ $: "Exit", code: 0, leak_check: false })));
const READY: StackEmptyCallback = () => interp_ok(Poll.Ready_unit);

/** A program running `steps` (each logged as `<name>:<i>`, calling `at[i]` if present), then an empty stack. */
function script(name: string, steps: number, at: Record<number, (ecx: Cx) => void> = {}): Program {
  let i = 0;
  return (ecx) => {
    if (i >= steps) return false;
    ecx.log.push(`${name}:${i}`);
    at[i]?.(ecx);
    i++;
    return true;
  };
}

/** Runs `run_threads` until it returns its error; returns the `TerminationInfo` variant it stopped with. */
function run(ecx: Cx): string {
  const r = ecx.run_threads();
  expect(r.$).toBe("Err");
  const kind = (r as { _0: { _0: { kind: { $: string; _0: MachineStopType } } } })._0._0.kind;
  expect(kind.$).toBe("MachineStop");
  const info = TerminationInfoStop.downcast_ref(kind._0);
  expect(info).toBeDefined();
  return info!.$;
}

const SCALAR = { $: "Int", _0: "retval" } as unknown as Scalar;
const DEST = { dest: true } as unknown as MPlaceTy;

/** A recording unblock callback. */
function record(ecx: Cx, name: string): DynUnblockCallback {
  return {
    visit_provenance() {},
    call(this_: MiriInterpCx, unblock: UnblockKind): InterpResult {
      ecx.log.push(`${name}:${unblock}@${this_.active_thread().index()}`);
      return interp_ok(undefined);
    },
  };
}

// ---------------------------------------------------------------- thread set ----

test("ThreadId: canonical instances, Idx, Debug; ThreadManager::new has the detached main thread", () => {
  expect(ThreadId.new(3)).toBe(ThreadId.new_unchecked(3));
  expect(ThreadId.MAIN_THREAD).toBe(ThreadId.new(0));
  expect(ThreadId.new(5).index()).toBe(5);
  expect(() => ThreadId.new(2 ** 32)).toThrow(Panic);
  const ecx = make_ecx();
  ThreadManager.init(ecx, EXIT);
  const t = ecx.machine.threads;
  expect(t.get_total_thread_count()).toBe(1);
  expect(t.get_thread_display_name(ThreadId.MAIN_THREAD)).toBe("main");
  expect(debug_Thread(t.thread_ref(ThreadId.MAIN_THREAD), PLAIN)).toBe("main(Enabled, Detached)");
  const t1 = t.create_thread(READY);
  expect(t.get_thread_display_name(t1)).toBe("unnamed-1");
  t.set_thread_name(t1, [0x77, 0xff, 0x6b]);
  expect(t.get_thread_display_name(t1)).toBe("w\u{fffd}k");
  expect(t.thread_id_try_from(1)).toEqual({ $: "Ok", _0: t1 });
  expect(t.thread_id_try_from(7n)).toEqual({ $: "Err", _0: { $: "InvalidId" } });
  expect(t.thread_id_try_from(-1)).toEqual({ $: "Err", _0: { $: "InvalidId" } });
  expect(t.get_live_thread_count()).toBe(2);
});

test("spawn / join: the joiner blocks on Join(t1), is woken by t1's termination and writes the return value", () => {
  const ecx = make_ecx();
  ThreadManager.init(ecx, EXIT);
  let t1: ThreadId | undefined;
  ecx.programs[0] = script("main", 2, {
    0: (ecx) => {
      t1 = ecx.machine.threads.create_thread(READY);
      ecx.programs[t1.index()] = script("t1", 3);
    },
    1: (ecx) => {
      expect(ecx.join_thread(t1!, SCALAR, DEST).$).toBe("Ok");
      expect(debug_ThreadState(ecx.active_thread_ref().state, PLAIN)).toBe("Blocked { reason: Join(ThreadId(1)), deadline: None }");
    },
  });
  expect(run(ecx)).toBe("Exit");
  expect(ecx.log).toEqual(["main:0", "main:1", "t1:0", "t1:1", "t1:2"]);
  expect(ecx.writes).toEqual([[SCALAR, DEST]]);
  const t = ecx.machine.threads;
  expect(t.has_terminated(t1!)).toBe(true);
  expect(t.thread_ref(t1!).join_status).toBe("Joined");
  expect(ecx.active_thread()).toBe(ThreadId.MAIN_THREAD);
  // Joining a terminated thread writes immediately; joining a detached one / itself is UB.
  expect(ecx.join_thread(t1!, SCALAR, DEST).$).toBe("Ok");
  expect(ecx.writes.length).toBe(2);
  expect(ecx.join_thread_exclusive(t1!, SCALAR, DEST)).toMatchObject({ $: "Err", _0: { _0: { kind: { _0: { _0: "trying to join an already joined thread" } } } } });
  expect(ecx.join_thread(ThreadId.MAIN_THREAD, SCALAR, DEST)).toMatchObject({ $: "Err", _0: { _0: { kind: { _0: { _0: "trying to join a detached thread" } } } } });
  const t2 = t.create_thread(READY);
  expect(ecx.detach_thread(t2, false).$).toBe("Ok");
  expect(ecx.detach_thread(t2, false)).toMatchObject({ $: "Err", _0: { _0: { kind: { _0: { _0: "trying to detach thread that was already detached or joined" } } } } });
});

test("yield, fixed scheduling: round robin over the threads after the active one", () => {
  const ecx = make_ecx({ fixed: true });
  ThreadManager.init(ecx, EXIT);
  const yields = (n: number): Record<number, (ecx: Cx) => void> => Object.fromEntries([...Array(n).keys()].map((i) => [i, (e: Cx) => e.yield_active_thread()]));
  ecx.programs[0] = script("main", 3, {
    ...yields(3),
    0: (e) => {
      for (const name of ["a", "b"]) {
        const id = e.machine.threads.create_thread(READY);
        e.programs[id.index()] = script(name, 2, yields(2));
      }
      e.yield_active_thread();
    },
  });
  expect(run(ecx)).toBe("Exit");
  expect(ecx.log).toEqual(["main:0", "a:0", "b:0", "main:1", "a:1", "b:1", "main:2"]);
});

test("random scheduling and preemption draw from the seeded RNG, deterministically", () => {
  const go = (seed: bigint): string[] => {
    const ecx = make_ecx({ fixed: false, seed, preemption_rate: 0.5 });
    ThreadManager.init(ecx, EXIT);
    const preempt = (e: Cx) => e.maybe_preempt_active_thread();
    const each = (n: number) => Object.fromEntries([...Array(n).keys()].map((i) => [i, preempt]));
    ecx.programs[0] = script("m", 6, {
      ...each(6),
      0: (e) => {
        for (const name of ["a", "b", "c"]) {
          const id = e.machine.threads.create_thread(READY);
          e.programs[id.index()] = script(name, 4, each(4));
        }
        preempt(e);
      },
    });
    expect(run(ecx)).toBe("Exit");
    return ecx.log;
  };
  const a = go(0n);
  expect(go(0n)).toEqual(a);
  // The run ends when main's stack empties (its `on_stack_empty` stops), whatever the others still had to do.
  expect(a.filter((s) => s.startsWith("m:"))).toEqual(["m:0", "m:1", "m:2", "m:3", "m:4", "m:5"]);
  expect(a[a.length - 1]).toBe("m:5");
  // Not round robin: the scheduler chose among the enabled threads with the RNG.
  expect(go(1n)).not.toEqual(a);
});

test("blocking with a timeout: the scheduler sleeps the virtual clock to the deadline and runs the TimedOut callback", () => {
  const ecx = make_ecx();
  ThreadManager.init(ecx, EXIT);
  ecx.programs[0] = script("main", 2, { 0: (e) => e.block_thread({ $: "Sleep" }, deadline(100n), record(e, "sleep")) });
  expect(run(ecx)).toBe("Exit");
  expect(ecx.log).toEqual(["main:0", "sleep:TimedOut@0", "main:1"]);
  expect(ecx.now.t).toBe(100n);
});

test("unblock_expired_deadlines: fires expired timeouts and returns the smallest remaining wait", () => {
  const ecx = make_ecx();
  ThreadManager.init(ecx, EXIT);
  const t = ecx.machine.threads;
  const ids = [t.create_thread(READY), t.create_thread(READY), t.create_thread(READY)];
  const waits = [30n, 0n, 70n];
  ids.forEach((id, i) => {
    t.set_active_thread(id);
    ecx.block_thread({ $: "Sleep" }, deadline(waits[i]!), record(ecx, `t${id.index()}`));
  });
  t.set_active_thread(ThreadId.MAIN_THREAD);
  const r = ecx.unblock_expired_deadlines();
  expect(r).toEqual({ $: "Ok", _0: Duration.from_nanos(30n) });
  expect(ecx.log).toEqual(["t2:TimedOut@2"]);
  expect(ecx.active_thread()).toBe(ThreadId.MAIN_THREAD);
});

test("futex: a wake before the deadline unblocks with Ready; the waiter list follows extract_if(..).take(count)", () => {
  const ecx = make_ecx();
  ThreadManager.init(ecx, EXIT);
  const futex = FutexRef.new();
  let t1: ThreadId | undefined;
  ecx.programs[0] = script("main", 2, {
    0: (e) => {
      t1 = e.machine.threads.create_thread(READY);
      e.programs[t1.index()] = script("t1", 1, { 0: (e) => e.log.push(`woke ${e.futex_wake(futex, 0xffff_ffff, 1)._0 as number}`) });
      e.futex_wait(futex, 0xffff_ffff, deadline(1000n), record(e, "futex"));
    },
  });
  expect(run(ecx)).toBe("Exit");
  expect(ecx.log).toEqual(["main:0", "t1:0", "futex:Ready@0", "woke 1", "main:1"]);
  expect(futex.waiters()).toBe(0);
  expect(ecx.now.t).toBe(0n);

  // bitset and count: waiters (thread, bitset) = (1,1) (2,2) (3,1) (4,1); wake(bitset 1, count 2) wakes 1 and 3.
  const ecx2 = make_ecx();
  const t = ecx2.machine.threads;
  const f2 = FutexRef.new();
  for (const bits of [1, 2, 1, 1]) {
    const id = t.create_thread(READY);
    t.set_active_thread(id);
    ecx2.futex_wait(f2, bits, undefined, record(ecx2, `w${id.index()}`));
  }
  t.set_active_thread(ThreadId.MAIN_THREAD);
  expect(ecx2.futex_wake(f2, 1, 2)).toEqual({ $: "Ok", _0: 2 });
  expect(ecx2.log).toEqual(["w1:Ready@1", "w3:Ready@3"]);
  expect(f2._0.waiters.map((w) => [w.thread.index(), w.bitset])).toEqual([[2, 2], [4, 1]]);
});

test("condvar_wait timeout: the waiter leaves the queue, reacquires the mutex and writes retval_timeout", () => {
  const ecx = make_ecx();
  ThreadManager.init(ecx, EXIT);
  const m = MutexRef.new();
  const c = CondvarRef.new();
  const TIMEOUT = { $: "Int", _0: "timeout" } as unknown as Scalar;
  ecx.programs[0] = script("main", 2, {
    0: (e) => {
      expect(e.mutex_lock(m).$).toBe("Ok");
      expect(e.condvar_wait(c, m, deadline(50n), SCALAR, TIMEOUT, DEST).$).toBe("Ok");
      expect(m.owner()).toBeUndefined();
      expect(c.queue_is_empty()).toBe(false);
    },
  });
  expect(run(ecx)).toBe("Exit");
  expect(ecx.writes).toEqual([[TIMEOUT, DEST]]);
  expect(c.queue_is_empty()).toBe(true);
  expect(m.owner()).toBe(ThreadId.MAIN_THREAD);
  expect(ecx.now.t).toBe(50n);
  // Waiting on a mutex we do not hold is UB; on a recursively held one, unsupported.
  const c2 = CondvarRef.new();
  expect(ecx.mutex_lock(m).$).toBe("Ok");
  expect(ecx.condvar_wait(c2, m, undefined, SCALAR, TIMEOUT, DEST)).toMatchObject({ $: "Err", _0: { _0: { kind: { $: "Unsupported" } } } });
  expect(ecx.condvar_wait(c2, MutexRef.new(), undefined, SCALAR, TIMEOUT, DEST)).toMatchObject({ $: "Err", _0: { _0: { kind: { $: "UndefinedBehavior" } } } });
});

test("deadlock: every thread blocked without a deadline stops with TerminationInfo::GlobalDeadlock", () => {
  const ecx = make_ecx();
  ThreadManager.init(ecx, EXIT);
  const m = MutexRef.new();
  ecx.programs[0] = script("main", 2, {
    0: (e) => {
      expect(e.mutex_lock(m).$).toBe("Ok");
      const t1 = e.machine.threads.create_thread(READY);
      e.programs[t1.index()] = script("t1", 1, { 0: (e) => e.mutex_enqueue_and_block(m, undefined) });
    },
    1: (e) => {
      expect(e.join_thread(ThreadId.new(1), SCALAR, DEST).$).toBe("Ok");
    },
  });
  expect(run(ecx)).toBe("GlobalDeadlock");
  expect(ecx.log).toEqual(["main:0", "main:1", "t1:0"]);
  expect(ecx.machine.threads.all_blocked_stacks().map(([id]) => id.index())).toEqual([0, 1]);
  expect(ecx.any_thread_blocked_on_host()).toBe(false);
});

// ---------------------------------------------------------------- sync primitives ----

/** `n` extra threads; `as(i, f)` runs `f` as thread `i` (0 = main), as the scheduler's `set_active_thread` would. */
function threads(n: number): { ecx: Cx; ids: ThreadId[]; as: <R>(i: number, f: () => R) => R } {
  const ecx = make_ecx();
  ThreadManager.init(ecx, EXIT);
  const ids = [ThreadId.MAIN_THREAD];
  for (let i = 0; i < n; i++) ids.push(ecx.machine.threads.create_thread(READY));
  return {
    ecx,
    ids,
    as: (i, f) => {
      const old = ecx.machine.threads.set_active_thread(ids[i]!);
      try {
        return f();
      } finally {
        ecx.machine.threads.set_active_thread(old);
      }
    },
  };
}

test("mutex: recursive lock count, owner-only unlock, FIFO hand-over to queued threads", () => {
  const { ecx, ids, as } = threads(2);
  const m = MutexRef.new();
  expect(ecx.mutex_lock(m).$).toBe("Ok");
  expect(ecx.mutex_lock(m).$).toBe("Ok");
  as(1, () => ecx.mutex_enqueue_and_block(m, [SCALAR, DEST]));
  as(2, () => ecx.mutex_enqueue_and_block(m, undefined));
  expect(m._0.queue.map((t) => t.index())).toEqual([1, 2]);
  expect(as(1, () => ecx.mutex_unlock(m))).toEqual({ $: "Ok", _0: undefined }); // not the owner
  expect(ecx.mutex_unlock(m)).toEqual({ $: "Ok", _0: 2 });
  expect(m.owner()).toBe(ids[0]);
  expect(ecx.mutex_unlock(m)).toEqual({ $: "Ok", _0: 1 });
  expect(m.owner()).toBe(ids[1]);
  expect(m._0.lock_count).toBe(1);
  expect(ecx.machine.threads.thread_ref(ids[1]!).is_enabled()).toBe(true);
  expect(ecx.machine.threads.thread_ref(ids[2]!).is_blocked_on({ $: "Mutex" })).toBe(true);
  expect(ecx.writes).toEqual([[SCALAR, DEST]]);
  expect(as(1, () => ecx.mutex_unlock(m))).toEqual({ $: "Ok", _0: 1 });
  expect(m.owner()).toBe(ids[2]);
  expect(m.queue_is_empty()).toBe(true);
  expect(ecx.mutex_unlock(m)).toEqual({ $: "Ok", _0: undefined });
});

test("callback! sites visit every capture: a blocked thread's callback roots the provenance it holds (machine.rs:2181)", () => {
  const { ecx, ids, as } = threads(5);
  const prov = (a: number, t: number) => ({ $: "Concrete", alloc_id: a, tag: t });
  const ptr_scalar = (a: number, t: number) => ({ $: "Ptr", _0: { provenance: prov(a, t), offset: Size.ZERO }, _1: 8 }) as unknown as Scalar;
  const place = (a: number, t: number) => ({ ptr: () => ({ provenance: prov(a, t) }), meta: () => ({ $: "None" }) }) as unknown as MPlaceTy;
  const roots = (i: number): [unknown, unknown][] => {
    const state = ecx.machine.threads.thread_ref(ids[i]!).state;
    if (state.$ !== "Blocked") throw new Error("thread must be blocked");
    const out: [unknown, unknown][] = [];
    state.callback.visit_provenance((a, t) => out.push([a, t]));
    return out;
  };
  // mutex_enqueue_and_block: { mutex_ref, retval_dest: Option<(Scalar, MPlaceTy)> }
  const m = MutexRef.new();
  expect(ecx.mutex_lock(m).$).toBe("Ok");
  as(1, () => ecx.mutex_enqueue_and_block(m, [ptr_scalar(1, 11), place(2, 12)]));
  expect(roots(1)).toEqual([[1, 11], [2, 12]]);
  // rwlock_enqueue_and_block_reader / _writer: { rwlock_ref, retval, dest }
  const rw = RwLockRef.new();
  expect(ecx.rwlock_writer_lock(rw).$).toBe("Ok");
  as(2, () => ecx.rwlock_enqueue_and_block_reader(rw, ptr_scalar(3, 13), place(4, 14)));
  as(3, () => ecx.rwlock_enqueue_and_block_writer(rw, ptr_scalar(5, 15), place(6, 16)));
  expect(roots(2)).toEqual([[3, 13], [4, 14]]);
  expect(roots(3)).toEqual([[5, 15], [6, 16]]);
  // futex_wait: { futex_ref, callback } visits the inner callback
  const inner: DynUnblockCallback = { visit_provenance: (visit) => visit(7 as never, 17 as never), call: () => interp_ok(undefined) };
  as(4, () => ecx.futex_wait(FutexRef.new(), 0xffff_ffff, undefined, inner));
  expect(roots(4)).toEqual([[7, 17]]);
  // join_thread: { joined_thread_id, dest, success_retval } (ThreadId has no provenance)
  as(5, () => expect(ecx.join_thread(ids[1]!, ptr_scalar(8, 18), place(9, 19)).$).toBe("Ok"));
  expect(roots(5)).toEqual([[9, 19], [8, 18]]);
});

test("set_active_thread: the thread-switch info! event (thread.rs:516) under MIRI_LOG=info", () => {
  const out: string[] = [];
  const writer: Writer = {
    write_all(s: string) {
      out.push(s);
      return undefined;
    },
  };
  const layer = HierarchicalLayer.default().with_writer(() => writer).with_ansi(false).with_targets(true).with_indent_amount(2);
  // bin/log/setup.rs: `MIRI_LOG=info`
  const filter = EnvFilter.new("rustc_middle::mir::interpret=info,rustc_const_eval::interpret=info,miri=info");
  expect(set_global_default(new LayeredSubscriber([layer], filter)).$).toBe("Ok");
  try {
    const { ecx, ids } = threads(1);
    const old = ecx.machine.threads.set_active_thread(ids[1]!);
    expect(old).toBe(ids[0]);
    ecx.machine.threads.set_active_thread(old);
  } finally {
    reset_global_default_for_tests();
  }
  // `get_thread_display_name`: the main thread is named `main`, others `unnamed-{index}` (thread.rs:226)
  const dashes = "----------------------------------------";
  expect(out.join("")).toBe(
    [
      ` INFO miri::concurrency::thread ---------- Now executing on thread \`unnamed-1\` (previous: \`main\`) ${dashes}`,
      ` INFO miri::concurrency::thread ---------- Now executing on thread \`main\` (previous: \`unnamed-1\`) ${dashes}`,
      "",
    ].join("\n"),
  );
});

test("rwlock: writers are preferred; a writer unlock with no queued writer wakes every queued reader in order", () => {
  const { ecx, ids, as } = threads(4);
  const rw = RwLockRef.new();
  expect(ecx.rwlock_writer_lock(rw).$).toBe("Ok");
  expect(rw.is_write_locked()).toBe(true);
  as(1, () => ecx.rwlock_enqueue_and_block_reader(rw, SCALAR, DEST));
  as(2, () => ecx.rwlock_enqueue_and_block_writer(rw, SCALAR, DEST));
  as(3, () => ecx.rwlock_enqueue_and_block_reader(rw, SCALAR, DEST));
  expect(as(1, () => ecx.rwlock_writer_unlock(rw))).toEqual({ $: "Ok", _0: false });
  expect(ecx.rwlock_writer_unlock(rw)).toEqual({ $: "Ok", _0: true });
  expect(rw._0.writer).toBe(ids[2]);
  expect(as(2, () => ecx.rwlock_writer_unlock(rw))).toEqual({ $: "Ok", _0: true });
  expect(rw._0.writer).toBeUndefined();
  // `readers` is an FxHashMap: iteration is hashbrown order, so compare as a set.
  expect([...rw._0.readers].map(([t, n]) => [t.index(), n]).sort((a, b) => a[0]! - b[0]!)).toEqual([[1, 1], [3, 1]]);
  // Value-keyed (review miri-threads finding 3): a non-canonical `ThreadId` finds the entry.
  expect(rw._0.readers.get(new ThreadId(3))).toBe(1);
  expect(rw.queue_is_empty()).toBe(true);
  // A queued writer gets the lock when the last reader leaves.
  as(4, () => ecx.rwlock_enqueue_and_block_writer(rw, SCALAR, DEST));
  expect(as(1, () => ecx.rwlock_reader_unlock(rw))).toEqual({ $: "Ok", _0: true });
  expect(rw._0.writer).toBeUndefined();
  expect(as(0, () => ecx.rwlock_reader_unlock(rw))).toEqual({ $: "Ok", _0: false });
  expect(as(3, () => ecx.rwlock_reader_lock(rw)).$).toBe("Ok");
  expect(as(3, () => ecx.rwlock_reader_unlock(rw))).toEqual({ $: "Ok", _0: true });
  expect(rw._0.readers.get(ids[3]!)).toBe(1);
  expect(as(3, () => ecx.rwlock_reader_unlock(rw))).toEqual({ $: "Ok", _0: true });
  expect(rw._0.writer).toBe(ids[4]);
  expect(ecx.writes.length).toBe(4);
});

test("condvar: signal wakes the waiters FIFO, each reacquiring the mutex (or queueing on it)", () => {
  const { ecx, ids, as } = threads(2);
  const m = MutexRef.new();
  const c = CondvarRef.new();
  for (const i of [1, 2]) {
    as(i, () => {
      expect(ecx.mutex_lock(m).$).toBe("Ok");
      expect(ecx.condvar_wait(c, m, undefined, SCALAR, SCALAR, DEST).$).toBe("Ok");
    });
  }
  expect(c._0.waiters.map((t) => t.index())).toEqual([1, 2]);
  expect(ecx.mutex_lock(m).$).toBe("Ok");
  expect(ecx.condvar_signal(c)).toEqual({ $: "Ok", _0: true });
  // Thread 1 is woken but the mutex is held by main: it queues on the mutex.
  expect(ecx.machine.threads.thread_ref(ids[1]!).is_blocked_on({ $: "Mutex" })).toBe(true);
  expect(ecx.mutex_unlock(m)).toEqual({ $: "Ok", _0: 1 });
  expect(m.owner()).toBe(ids[1]);
  expect(as(1, () => ecx.mutex_unlock(m))).toEqual({ $: "Ok", _0: 1 });
  expect(ecx.condvar_signal(c)).toEqual({ $: "Ok", _0: true });
  expect(m.owner()).toBe(ids[2]);
  expect(ecx.condvar_signal(c)).toEqual({ $: "Ok", _0: false });
  expect(ecx.writes.length).toBe(2);
});

test("init_once: complete wakes every waiter in queue order, fail wakes only the first", () => {
  const { ecx, as } = threads(3);
  const o = InitOnceRef.new();
  expect(o.status()).toBe("Uninitialized");
  o.begin();
  expect(() => o.begin()).toThrow(Panic);
  for (const i of [1, 2]) as(i, () => ecx.init_once_enqueue_and_block(o, record(ecx, `t${i}`)));
  expect(ecx.init_once_fail(o).$).toBe("Ok");
  expect(ecx.log).toEqual(["t1:Ready@1"]);
  expect(o.status()).toBe("Uninitialized");
  o.begin();
  as(3, () => ecx.init_once_enqueue_and_block(o, record(ecx, "t3")));
  expect(ecx.init_once_complete(o).$).toBe("Ok");
  expect(ecx.log).toEqual(["t1:Ready@1", "t2:Ready@2", "t3:Ready@3"]);
  expect(o.queue_is_empty()).toBe(true);
  expect(ecx.init_once_observe_completed(o).$).toBe("Ok");
  expect(() => ecx.init_once_enqueue_and_block(o, record(ecx, "late"))).toThrow(Panic);
});

test("unblock_thread checks the block reason; blocking twice panics", () => {
  const { ecx, ids, as } = threads(1);
  as(1, () => ecx.block_thread({ $: "Join", _0: ids[0]! }, undefined, record(ecx, "j")));
  expect(() => ecx.unblock_thread(ids[1]!, { $: "Join", _0: ids[1]! })).toThrow(
    "assertion `left == right` failed: unblock_thread: thread was blocked for the wrong reason\n  left: Join(ThreadId(1))\n right: Join(ThreadId(0))",
  );
  expect(() => ecx.unblock_thread(ids[0]!, { $: "Sleep" })).toThrow("unblock_thread: thread was not blocked");
});

// ---------------------------------------------------------------- value-keyed maps (lane miri-threads-fix) ----

test("AllocExtra.sync_objs is value-keyed: get_sync finds an object with a fresh Size of the same offset", () => {
  interface Tagged extends SyncObj {
    tag: string;
  }
  const is_tagged = (v: SyncObj): v is Tagged => "tag" in v;
  const extra = Object.create(AllocExtra.prototype) as AllocExtra;
  extra.sync_objs = new_sync_objs();
  const obj: Tagged = { tag: "m8", on_access: SyncObj_provided.on_access, delete_on_write: SyncObj_provided.delete_on_write };
  extra.sync_objs.set(Size.from_bytes(8), obj);
  expect(extra.get_sync(Size.from_bytes(8), is_tagged)).toBe(obj);
  expect(extra.get_sync(Size.from_bytes(16), is_tagged)).toBeUndefined();
  extra.sync_objs.set(Size.from_bytes(8), obj);
  expect(extra.sync_objs.size).toBe(1);
});

test("BlockingIoSource.blocked_threads is value-keyed by ThreadId", () => {
  const manager = (BlockingIoManager.new(false) as { _0: BlockingIoManager })._0;
  const fd = new FdId(3);
  manager.sources.set(fd, { fd: undefined as never, blocked_threads: new_blocked_threads() });
  manager.add_blocked_thread(new FdId(3), new ThreadId(1), "Read");
  // A fresh ThreadId(1) finds the existing entry (value-keyed); the double-block panic text is not ported, so it stops.
  expect(() => manager.add_blocked_thread(fd, ThreadId.new(1), "Write")).toThrow(Unported);
  manager.remove_blocked_thread(fd, new ThreadId(1));
  expect(manager.sources.get(fd)!.blocked_threads.size).toBe(0);
  expect(() => manager.remove_blocked_thread(fd, ThreadId.new(1))).toThrow("Thread should be blocked on source");
});
