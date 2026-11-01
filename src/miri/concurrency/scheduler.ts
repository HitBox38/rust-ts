//! This file contains Miri's scheduler, which is in charge of picking the next thread to run when
//! the current thread blocks/yields. It also manages timeouts and runs an async event loop
//! to deal with host I/O. In GenMC mode, it handles delegating schedule control to GenMC.
// Port of src/tools/miri/src/concurrency/scheduler.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-threads` (plan-m6 wave
// 36), ported. Its types are generated into scheduler.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT decisions (docs/handoff/miri-threads.md):
// - `threads_iter` (`all_threads().skip(k).chain(all_threads().take(k)).filter(enabled)`) is a `RustIterator` (vendored
//   rand) over the rotated thread list with core's `Filter<Chain<Skip, Take>>` size hint `(0, Some(remaining))`, so
//   `IteratorRandom::choose` draws exactly the words upstream draws.
// - `throw_machine_stop!(TerminationInfo::X)` goes through `machine_stop` below (the `Box<dyn MachineStopType>` of a
//   `TerminationInfo` is lane miri-driver's: pending).
// - GenMC scheduling stops with `unported("genmc")`.
import * as diagnostics from "../diagnostics.ts";
import { type TerminationInfo } from "../diagnostics.ts";
import { SchedulingAction } from "./scheduler.gen.ts";
import { Duration_, machine_rng, pending, type Poll, type Thread, type ThreadId, ThreadId_eq } from "./thread.ts";
import { type MiriInterpCx } from "../machine.ts";
import { DelayedReadinessUpdates } from "../shims/readiness.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { CTRL_C_RECEIVED } from "../../rustc_const_eval/lib.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, type MachineStopType } from "../../rustc_middle/mir/interpret/mod.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
import { panic, unported, unreachable } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { type RustIterator, IteratorRandom } from "../../vendor/rand/seq/iterator.ts";
export * from "./scheduler.gen.ts";

declare module "../diagnostics.ts" {
  /** PORT(contract): pending miri-driver. `impl MachineStopType for TerminationInfo` (diagnostics.rs:113): the
   *  `Box<dyn MachineStopType>` that `throw_machine_stop!(info)` makes of a `TerminationInfo`. */
  export function MachineStopType_from_TerminationInfo(info: TerminationInfo): MachineStopType;
}

/** `throw_machine_stop!(info)` */
export function machine_stop<T>(info: TerminationInfo): InterpResult<T> {
  const boxed = pending(diagnostics.MachineStopType_from_TerminationInfo, "miri::diagnostics::MachineStopType_from_TerminationInfo (lane miri-driver)")(info);
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "MachineStop", _0: boxed }));
}

// ---------------------------------------------------------------- EvalContextPrivExt ----

// #[inline]
// rustc: src/tools/miri/src/concurrency/scheduler.rs:31 run_on_stack_empty
InterpCx.prototype.run_on_stack_empty = function (this: MiriInterpCx): InterpResult<Poll> {
  const this_ = this.eval_context_mut();
  const active_thread = this_.active_thread_mut();
  active_thread.origin_span = DUMMY_SP; // reset, the old value no longer applied
  const callback = active_thread.on_stack_empty;
  active_thread.on_stack_empty = undefined;
  if (callback === undefined) panic("`on_stack_empty` not set up, or already running");
  const res = callback(this_);
  if (res.$ === "Err") return res;
  this_.active_thread_mut().on_stack_empty = callback;
  return interp_ok(res._0);
};

/// Decide which action to take next and on which thread.
///
/// The currently implemented scheduling policy is the one that is commonly
/// used in stateless model checkers such as Loom: run the active thread as
/// long as we can and switch only when we have to (the active thread was
/// blocked, terminated, or has explicitly asked to be preempted).
///
/// If GenMC mode is active, the scheduling is instead handled by GenMC.
// rustc: src/tools/miri/src/concurrency/scheduler.rs:52 schedule
InterpCx.prototype.schedule = function (this: MiriInterpCx): InterpResult<SchedulingAction> {
  const this_ = this.eval_context_mut();

  // In GenMC mode, we let GenMC do the scheduling.
  if (this_.machine.data_race.$ === "Genmc") {
    // loop { genmc_ctx.schedule_thread(this)? ...; info!("GenMC: scheduling blocked thread {next_thread_id:?}, so we
    // unblock it now."); ... }
    return unported("genmc");
  }

  // We are not in GenMC mode, so we control the scheduling.
  {
    const thread_manager = this_.machine.threads;
    // Check if we can just keep running the current thread.
    if (thread_manager.active_thread_ref().is_enabled() && !thread_manager.yield_active_thread) {
      // The currently active thread is still enabled, just continue with it.
      return interp_ok(SchedulingAction.ExecuteStep);
    }
  }

  // The active thread yielded or got terminated. Let's see if there are any I/O events
  // or timeouts to take care of.

  // There may be delayed readiness updates we have to process. We only care about this
  // if it may unblock other threads, or if someone calls `epoll_wait`, and for the latter
  // case there is another call in `ReadinessWatcher::get_ready_interests`.
  {
    const r = DelayedReadinessUpdates.process(this_);
    if (r.$ === "Err") return r;
  }

  if (this_.machine.communicate()) {
    // When isolation is disabled we need to check for events for threads
    // which are blocked on host I/O. Unlike the `poll_and_unblock` before
    // any foreign item, the call here is needed to ensure that threads which
    // are blocked on host I/O are woken up even if no shimmed functions are
    // executed afterwards.
    // We do this before running any other threads such that the threads
    // which received events are available for scheduling afterwards.

    // Perform a non-blocking poll for newly available I/O events from the OS.
    const r = this_.poll_and_unblock(Duration_().ZERO);
    if (r.$ === "Err") return r;
  }

  // We also check timeouts before running any other thread, to ensure that timeouts
  // "in the past" fire before any other thread can take an action. This ensures that for
  // `pthread_cond_timedwait`, "an error is returned if [...] the absolute time specified by
  // abstime has already been passed at the time of the call".
  // <https://pubs.opengroup.org/onlinepubs/9699919799/functions/pthread_cond_timedwait.html>
  const pst = this_.unblock_expired_deadlines();
  if (pst.$ === "Err") return pst;
  const potential_sleep_time = pst._0;

  const thread_manager = this_.machine.threads;
  const rng = machine_rng(this_);

  // No callbacks immediately scheduled, pick a regular thread to execute.
  // The active thread blocked or yielded. So we go search for another enabled thread.
  // We build the list of threads by starting with the threads after the current one, followed by
  // the threads before the current one and then the current thread itself (i.e., this iterator acts
  // like `threads.rotate_left(self.active_thread.index() + 1)`. This ensures that if we pick the first
  // eligible thread, we do regular round-robin scheduling, and all threads get a chance to take a step.
  const threads_iter = rotated_enabled_threads(
    thread_manager.all_threads(),
    thread_manager.active_thread_().index() + 1,
  );
  // Pick a new thread, and switch to it.
  let new_thread: [ThreadId, Thread] | undefined;
  if (thread_manager.fixed_scheduling_()) {
    const next = threads_iter.next();
    new_thread = next;
  } else {
    new_thread = IteratorRandom.choose(threads_iter, rng);
  }

  if (new_thread !== undefined) {
    const [id, _thread] = new_thread;
    if (!ThreadId_eq(thread_manager.active_thread_(), id)) {
      thread_manager.set_active_thread(id);
    }
  }
  // This completes the `yield`, if any was requested.
  thread_manager.yield_active_thread = false;

  if (thread_manager.active_thread_ref().is_enabled()) {
    return interp_ok(SchedulingAction.ExecuteStep);
  }

  // We have not found a thread to execute.
  if (this_.machine.threads.all_threads().every(([_id, thread]) => thread.is_terminated())) {
    unreachable("internal error: entered unreachable code: all threads terminated without the main thread terminating?!");
  } else if (potential_sleep_time !== undefined) {
    const sleep_time = potential_sleep_time;
    // All threads are currently blocked, but we have unexecuted
    // timeout_callbacks, which may unblock some of the threads. Hence,
    // sleep until the first callback.
    return interp_ok({ $: "SleepAndWaitForIo", _0: sleep_time as unknown as Pending<"std::time::Duration"> });
  } else if (this_.any_thread_blocked_on_host()) {
    // At least one thread doesn't have a timeout set, and is blocked on host I/O or is waiting on an
    // epoll instance which contains a host source interest. Hence, we sleep indefinitely in the
    // hope that eventually an I/O event happens.
    return interp_ok({ $: "SleepAndWaitForIo", _0: undefined });
  } else {
    return machine_stop(diagnostics.TerminationInfo.GlobalDeadlock);
  }
};

/** `all_threads().skip(k).chain(all_threads().take(k)).filter(|(_id, thread)| thread.is_enabled())`, with core's size
 *  hint: `Filter` is `(0, upper)`, `upper` = what `Chain<Skip<Enumerate<slice::Iter>>, Take<..>>` has left. */
function rotated_enabled_threads(all: [ThreadId, Thread][], k: number): RustIterator<[ThreadId, Thread]> {
  const rotated = all.slice(k).concat(all.slice(0, Math.min(k, all.length)));
  let i = 0;
  return {
    next(): [ThreadId, Thread] | undefined {
      while (i < rotated.length) {
        const x = rotated[i++]!;
        if (x[1].is_enabled()) return x;
      }
      return undefined;
    },
    size_hint(): [number, number | undefined] {
      return [0, rotated.length - i];
    },
  };
}

// ---------------------------------------------------------------- EvalContextExt ----

/// Public because this is used by Priroda.
// rustc: src/tools/miri/src/concurrency/scheduler.rs:174 step_current_thread
InterpCx.prototype.step_current_thread = function (this: MiriInterpCx): InterpResult {
  const this_ = this.eval_context_mut();

  const s = this_.step();
  if (s.$ === "Err") return s;
  if (!s._0) {
    // See if this thread can do something else.
    const r = this_.run_on_stack_empty();
    if (r.$ === "Err") return r;
    switch (r._0) {
      case "Pending":
        break; // keep going
      case "Ready": {
        const t = this_.terminate_active_thread("Deallocate");
        if (t.$ === "Err") return t;
        break;
      }
    }
  }

  return interp_ok(undefined);
};

/// Run the core interpreter loop. Returns only when an interrupt occurs (an error or program
/// termination).
// rustc: src/tools/miri/src/concurrency/scheduler.rs:192 run_threads
InterpCx.prototype.run_threads = function (this: MiriInterpCx): InterpResult<never> {
  const this_ = this.eval_context_mut();
  for (;;) {
    if (CTRL_C_RECEIVED.value) {
      this_.machine.handle_abnormal_termination();
      return machine_stop(diagnostics.TerminationInfo.Interrupted);
    }
    const a = this_.schedule();
    if (a.$ === "Err") return a;
    const action = a._0;
    switch (action.$) {
      case "ExecuteStep": {
        const r = this_.step_current_thread();
        if (r.$ === "Err") return r;
        break;
      }
      case "SleepAndWaitForIo": {
        const duration = action._0 as unknown as Pending<"Duration"> | undefined;
        if (this_.machine.communicate()) {
          // When we're running with isolation disabled, instead of
          // strictly sleeping the duration we allow waking up
          // early for I/O events from the OS.

          const r = this_.poll_and_unblock(duration);
          if (r.$ === "Err") return r;
        } else {
          if (duration === undefined) panic("Infinite sleep should not be triggered when isolation is enabled");
          this_.machine.monotonic_clock.sleep(duration);
        }
        break;
      }
    }
  }
};

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- concurrency/scheduler.rs: `trait EvalContextPrivExt` (impl for `MiriInterpCx`) ----
    // concurrency/scheduler.rs:31
    run_on_stack_empty(this: MiriInterpCx): InterpResult<Poll>;
    // concurrency/scheduler.rs:52
    schedule(this: MiriInterpCx): InterpResult<SchedulingAction>;
    // ---- concurrency/scheduler.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // concurrency/scheduler.rs:174
    step_current_thread(this: MiriInterpCx): InterpResult;
    // concurrency/scheduler.rs:192
    run_threads(this: MiriInterpCx): InterpResult<never>;
  }
}
