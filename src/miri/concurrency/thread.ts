//! Implements threads.
// Port of src/tools/miri/src/concurrency/thread.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-threads` (plan-m6 wave 36),
// ported. Its types are generated into thread.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT decisions (docs/handoff/miri-threads.md):
// - `ThreadId(u32)` is the generated class (`{ _0 }`). Equality is `ThreadId_eq` (derived `PartialEq`), and every
//   `ThreadId` this module makes (`Idx::new`, `new_unchecked`, `MAIN_THREAD`, `thread_id_try_from`) is the one canonical
//   instance per id (`thread_id_of`). Maps keyed by `ThreadId` are value-keyed nonetheless (lane miri-threads-fix):
//   `FxKeyedMap` / `KeyedMap` with `ThreadId_key` / `ThreadId_value_key` (`RwLock.readers`, `BlockingIoSource.
//   blocked_threads`, `thread_local_allocs`; the generated field types say so through the typemap `fields`). A plain
//   `Map<ThreadId, _>` (e.g. lane miri-machine's `MiriMachine.thread_cpu_affinity`) relies on the canonical instances.
// - `IndexVec<ThreadId, Thread>` is `Thread[]` indexed by `id.index()`.
// - `ThreadManager.thread_local_allocs` (`FxHashMap<(DefId, ThreadId), StrictPointer>`) is an `FxKeyedMap`, so `retain`
//   in `terminate_active_thread` frees the TLS statics in hashbrown bucket order, as upstream.
// - `std::task::Poll<()>` is src/std/task.ts's `Poll<null>` (re-exported below).
// - `DynMachineCallback<'tcx, T>` (`Box<dyn MachineCallback>`, machine.ts) is an object with `call(ecx, arg)` and
//   `visit_provenance(visit)`. A `callback!(@capture { a: A, b: B } |this, arg: T| body)` is machine.ts's
//   `callback({ a: [a, <A's VisitProvenance impl>], b: [b, ..] }, (this_, arg, { a, b }) => body)`: one capture list
//   gives both the visit and the body's values; `call` consumes the callback (lane miri-wire).
// - Calls into other lanes' files that their skeleton does not declare go through local `declare module` blocks marked
//   `PORT(contract): pending <lane>` (contract rule 6).
// - GenMC arms stop with `unported("genmc")` (lane brief; the `GenmcCtx` of genmc/dummy.rs cannot be constructed).
import * as clock from "../clock.ts";
import * as tracing from "../../rust_ts/tracing.ts";
import { type Deadline } from "../clock.ts";
import * as gen from "./thread.gen.ts";
import {
  type BlockReason,
  type DynUnblockCallback,
  Thread,
  ThreadId,
  type ThreadJoinStatus,
  type ThreadLookupError,
  ThreadManager,
  type TlsAllocAction,
  type UnblockKind,
  debug_BlockReason,
  debug_ThreadId,
  debug_ThreadJoinStatus,
  debug_UnblockKind,
} from "./thread.gen.ts";
import { type MiriConfig } from "../eval.ts";
import { type ImmTy, type MPlaceTy, type PlaceTy, type Pointer, type Scalar, type StrictPointer } from "../lib.ts";
import { callback, type FrameExtra, type MiriInterpCx, MemoryKind_from_MiriMemoryKind, type Provenance, VisitProvenance_FrameExtra } from "../machine.ts";
import {
  type VisitWith,
  VisitProvenance_ImmTy,
  VisitProvenance_Immediate,
  VisitProvenance_MPlaceTy,
  VisitProvenance_MemPlaceMeta,
  VisitProvenance_PlaceTy,
  VisitProvenance_Pointer,
  VisitProvenance_Scalar,
  VisitProvenance_StrictPointer,
  VisitProvenance_no_provenance,
} from "../provenance_gc.ts";
import { clone_CpuAffinityMask } from "../shims/cpu_affinity.ts";
import { TlsDtorsState, TlsDtorsStatePriv } from "../shims/tls.ts";
import { AllocBytes_MiriAllocBytes, type MiriAllocParams } from "../alloc/alloc_bytes.ts";
import { FxKeyedMap, type KeyType } from "../../rust_ts/hash_map.ts";
import { type ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { FnVal } from "../../rustc_const_eval/interpret/memory.ts";
import { type Frame } from "../../rustc_const_eval/interpret/stack.gen.ts";
import { type Immediate, type MemPlaceMeta } from "../../rustc_const_eval/interpret/mod.ts";
import {
  InterpErrorInfo_from_ErrorHandled,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpResult,
  interp_ok,
  Scalar as ScalarNs,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { DefId, DefId_fx_key } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type Span } from "../../rustc_span/lib.ts";
import { type Debug, debug_option, debug_struct } from "../../std/fmt.ts";
import { assert, panic, unported, unreachable } from "../../std/panic.ts";
import { type Poll } from "../../std/task.ts";
import { Duration, Duration_min, SystemTime } from "../../std/time.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { RngExt } from "../../vendor/rand/rng.ts";
import { type StdRng } from "../../vendor/rand/rngs/std.ts";
export * from "./thread.gen.ts";

// ---------------------------------------------------------------- helpers (macro expansions) ----

const PLAIN_FMT = { alternate: false };

/** `throw_ub_format!(..)` */
function ub_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } }));
}
/** `throw_unsup_format!(..)` */
function unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}
/** `assert_eq!(left, right, msg)` (core's `assert_failed_inner` text with a message). */
function assert_eq_msg<T>(left: T, right: T, eq: (a: T, b: T) => boolean, debug: (v: T) => string, msg: string): void {
  if (!eq(left, right)) {
    panic(`assertion \`left == right\` failed: ${msg}\n  left: ${debug(left)}\n right: ${debug(right)}`);
  }
}
/** PORT: `String::from_utf8_lossy` (WHATWG decoding replaces maximal invalid subparts with U+FFFD, as std does). */
function String_from_utf8_lossy(bytes: readonly number[]): string {
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(Uint8Array.from(bytes));
}

// ---------------------------------------------------------------- types ----

/// The argument type for the "unblock" callback, indicating why the thread got unblocked.
// (generated: `UnblockKind`, `TlsAllocAction`; `DynUnblockCallback` = `DynMachineCallback<UnblockKind>`)

/** `std::task::Poll<()>` is src/std/task.ts's `Poll<null>` (`Poll.Ready_unit` / `Poll.Pending`). */
export { Poll } from "../../std/task.ts";

/** PORT: the canonical `ThreadId` of each id (see the header). */
const THREAD_IDS: ThreadId[] = [];
function thread_id_of(id: number): ThreadId {
  let t = THREAD_IDS[id];
  if (t === undefined) {
    t = new ThreadId(id);
    THREAD_IDS[id] = t;
  }
  return t;
}

/** `#[derive(PartialEq)] struct ThreadId(u32)` */
export function ThreadId_eq(a: ThreadId, b: ThreadId): boolean {
  return a._0 === b._0;
}

/** PORT (lane miri-threads-fix): `ThreadId` as an `FxHashMap` key (`#[derive(Hash)] struct ThreadId(u32)`: `write_u32`;
 *  4 bytes, align 4). Maps keyed by `ThreadId` are value-keyed (`FxKeyedMap` / `KeyedMap` with `ThreadId_value_key`). */
export const ThreadId_key: KeyType<ThreadId> = { hash: (k, state) => state.write_u32(k._0), size: 4, align: 4 };
/** The value a `ThreadId` map key compares by (`#[derive(PartialEq, Eq, Ord)]` over the `u32`). */
export function ThreadId_value_key(t: ThreadId): number {
  return t._0;
}

// rustc: src/tools/miri/src/concurrency/thread.rs:50 to_u32
ThreadId.prototype.to_u32 = function (this: ThreadId): number {
  return this._0;
};

/// Create a new thread id from a `u32` without checking if this thread exists.
// rustc: src/tools/miri/src/concurrency/thread.rs:55 new_unchecked
ThreadId.new_unchecked = function (id: number): ThreadId {
  return thread_id_of(id);
};

// pub const MAIN_THREAD: ThreadId = ThreadId(0);
ThreadId.MAIN_THREAD = thread_id_of(0);

// impl Idx for ThreadId
// rustc: src/tools/miri/src/concurrency/thread.rs:63 new
ThreadId.new = function (idx: number): ThreadId {
  // `ThreadId(u32::try_from(idx).unwrap())`
  if (!(Number.isInteger(idx) && idx >= 0 && idx <= 0xffff_ffff)) {
    panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
  }
  return thread_id_of(idx);
};

// rustc: src/tools/miri/src/concurrency/thread.rs:67 index
ThreadId.prototype.index = function (this: ThreadId): number {
  // `usize::try_from(self.0).unwrap()`
  return this._0;
};

// impl From<ThreadId> for u64
// rustc: src/tools/miri/src/concurrency/thread.rs:73 from
export function u64_from_ThreadId(t: ThreadId): bigint {
  return BigInt(t._0);
}

/** `#[derive(PartialEq)] enum BlockReason` */
export function BlockReason_eq(a: BlockReason, b: BlockReason): boolean {
  if (a.$ === "Join") return b.$ === "Join" && ThreadId_eq(a._0, b._0);
  return a.$ === b.$;
}

/// The state of a thread.
export type ThreadState = gen.ThreadState;
/** PORT: the methods of `impl ThreadState` on the generated companion (PORTING §8). */
export interface ThreadState_methods {
  is_enabled(self: ThreadState): boolean;
  is_terminated(self: ThreadState): boolean;
  is_blocked_on(self: ThreadState, reason: BlockReason): boolean;
}
export const ThreadState = gen.ThreadState as typeof gen.ThreadState & ThreadState_methods;

// impl<'tcx> std::fmt::Debug for ThreadState<'tcx>
// rustc: src/tools/miri/src/concurrency/thread.rs:121 fmt
export const debug_ThreadState: Debug<ThreadState> = (self, f) => {
  switch (self.$) {
    case "Enabled":
      return "Enabled";
    case "Blocked": {
      const { reason, deadline } = self;
      return debug_struct(f, "Blocked", [
        ["reason", debug_BlockReason(reason, f)],
        ["deadline", debug_option(deadline, f, debug_Deadline_lazy)],
      ]);
    }
    case "Terminated":
      return "Terminated";
  }
};
/** `debug_Deadline` of clock.ts, read lazily (C10: a hand module never reads another Miri module's values at top level;
 *  clock.gen.ts is entered through clock.ts). */
const debug_Deadline_lazy: Debug<Deadline> = (v, f) => clock.debug_Deadline(v, f);

// rustc: src/tools/miri/src/concurrency/thread.rs:135 is_enabled
ThreadState.is_enabled = function (self: ThreadState): boolean {
  return self.$ === "Enabled";
};

// rustc: src/tools/miri/src/concurrency/thread.rs:139 is_terminated
ThreadState.is_terminated = function (self: ThreadState): boolean {
  return self.$ === "Terminated";
};

// rustc: src/tools/miri/src/concurrency/thread.rs:143 is_blocked_on
ThreadState.is_blocked_on = function (self: ThreadState, reason: BlockReason): boolean {
  return self.$ === "Blocked" && BlockReason_eq(self.reason, reason);
};

// rustc-type: src/tools/miri/src/concurrency/thread.rs:202 StackEmptyCallback
/** `Box<dyn FnMut(&mut MiriInterpCx<'tcx>) -> InterpResult<'tcx, Poll<()>> + 'tcx>` */
export type StackEmptyCallback = (ecx: MiriInterpCx) => InterpResult<Poll<null>>;

/// Get the name of the current thread if it was set.
// rustc: src/tools/miri/src/concurrency/thread.rs:208 thread_name
Thread.prototype.thread_name_ = function (this: Thread): readonly number[] | undefined {
  return this.thread_name;
};

/// Return whether this thread is enabled or not.
// rustc: src/tools/miri/src/concurrency/thread.rs:213 is_enabled
Thread.prototype.is_enabled = function (this: Thread): boolean {
  return ThreadState.is_enabled(this.state);
};

// rustc: src/tools/miri/src/concurrency/thread.rs:217 is_terminated
Thread.prototype.is_terminated = function (this: Thread): boolean {
  return ThreadState.is_terminated(this.state);
};

// rustc: src/tools/miri/src/concurrency/thread.rs:221 is_blocked_on
Thread.prototype.is_blocked_on = function (this: Thread, reason: BlockReason): boolean {
  return ThreadState.is_blocked_on(this.state, reason);
};

/// Get the name of the current thread for display purposes; will include thread ID if not set.
// rustc: src/tools/miri/src/concurrency/thread.rs:226 thread_display_name
Thread.prototype.thread_display_name = function (this: Thread, id: ThreadId): string {
  const thread_name = this.thread_name;
  if (thread_name !== undefined) {
    return String_from_utf8_lossy(thread_name);
  } else {
    return `unnamed-${id.index()}`;
  }
};

/// Return the top user-relevant frame, if there is one. `skip` indicates how many top frames
/// should be skipped.
/// Note that the choice to return `None` here when there is no user-relevant frame is part of
/// justifying the optimization that only pushes of user-relevant frames require updating the
/// `top_user_relevant_frame` field.
// rustc: src/tools/miri/src/concurrency/thread.rs:239 compute_top_user_relevant_frame
Thread.prototype.compute_top_user_relevant_frame = function (this: Thread, skip: number): number | undefined {
  // We are search for the frame with maximum relevance.
  let best: [number, number] | undefined = undefined;
  // `self.stack.iter().enumerate().rev().skip(skip)`
  for (let idx = this.stack.length - 1 - skip; idx >= 0; idx--) {
    const frame = this.stack[idx]!;
    const relevance = frame.extra.user_relevance;
    if (relevance === 0xff) {
      // We can short-circuit this search.
      return idx;
    }
    if (best === undefined || best[1] < relevance) {
      // The previous best frame has strictly worse relevance, so despite us being lower
      // in the stack, we win.
      best = [idx, relevance];
    }
  }
  return best === undefined ? undefined : best[0];
};

/// Re-compute the top user-relevant frame from scratch. `skip` indicates how many top frames
/// should be skipped.
// rustc: src/tools/miri/src/concurrency/thread.rs:259 recompute_top_user_relevant_frame
Thread.prototype.recompute_top_user_relevant_frame = function (this: Thread, skip: number): void {
  this.top_user_relevant_frame = this.compute_top_user_relevant_frame(skip);
};

/// Set the top user-relevant frame to the given value. Must be equal to what
/// `get_top_user_relevant_frame` would return!
// rustc: src/tools/miri/src/concurrency/thread.rs:265 set_top_user_relevant_frame
Thread.prototype.set_top_user_relevant_frame = function (this: Thread, frame_idx: number): void {
  // debug_assert_eq!(Some(frame_idx), self.compute_top_user_relevant_frame(0));
  this.top_user_relevant_frame = frame_idx;
};

/// Returns the topmost frame that is considered user-relevant, or the
/// top of the stack if there is no such frame, or `None` if the stack is empty.
// rustc: src/tools/miri/src/concurrency/thread.rs:272 top_user_relevant_frame
Thread.prototype.top_user_relevant_frame_ = function (this: Thread): number | undefined {
  // This can be called upon creation of an allocation. We create allocations while setting up
  // parts of the Rust runtime when we do not have any stack frames yet, so we need to handle
  // empty stacks.
  return this.top_user_relevant_frame ?? (this.stack.length >= 1 ? this.stack.length - 1 : undefined);
};

// rustc: src/tools/miri/src/concurrency/thread.rs:279 current_user_relevance
Thread.prototype.current_user_relevance = function (this: Thread): number {
  const frame_idx = this.top_user_relevant_frame_();
  return frame_idx === undefined ? 0 : this.stack[frame_idx]!.extra.user_relevance;
};

// rustc: src/tools/miri/src/concurrency/thread.rs:285 current_user_relevant_span
Thread.prototype.current_user_relevant_span = function (this: Thread): Span {
  // debug_assert_eq!(self.top_user_relevant_frame, self.compute_top_user_relevant_frame(0));
  const frame_idx = this.top_user_relevant_frame_();
  return frame_idx === undefined ? DUMMY_SP : this.stack[frame_idx]!.current_span();
};

// impl<'tcx> std::fmt::Debug for Thread<'tcx>
// rustc: src/tools/miri/src/concurrency/thread.rs:294 fmt
export const debug_Thread: Debug<Thread> = (self, f) => {
  const name = self.thread_name_();
  // `write!(f, "{}({:?}, {:?})", ..)`: the arguments are formatted with their own (plain) specs, not `f`'s flags.
  void f;
  return `${String_from_utf8_lossy(name ?? UNNAMED)}(${debug_ThreadState(self.state, PLAIN_FMT)}, ${debug_ThreadJoinStatus(self.join_status, PLAIN_FMT)})`;
};
const UNNAMED: readonly number[] = Array.from(new TextEncoder().encode("<unnamed>"));

// rustc: src/tools/miri/src/concurrency/thread.rs:306 new
(Thread as unknown as { new: typeof Thread.new }).new = function (name: string | undefined, on_stack_empty: StackEmptyCallback | undefined): Thread {
  return new Thread(
    ThreadState.Enabled,
    name === undefined ? undefined : Array.from(new TextEncoder().encode(name)),
    [],
    DUMMY_SP,
    on_stack_empty,
    undefined,
    "Joinable",
    [],
    undefined,
  );
};

// impl VisitProvenance for Thread<'_>
// rustc: src/tools/miri/src/concurrency/thread.rs:322 visit_provenance
Thread.prototype.visit_provenance = function (this: Thread, visit: VisitWith): void {
  const {
    unwind_payloads: panic_payload,
    last_error,
    stack,
    // origin_span: _, top_user_relevant_frame: _, state: _, thread_name: _, join_status: _,
    // on_stack_empty: _, // we assume the closure captures no GC-relevant state
  } = this;

  for (const payload of panic_payload) {
    VisitProvenance_ImmTy.visit_provenance(payload, visit);
  }
  if (last_error !== undefined) VisitProvenance_MPlaceTy.visit_provenance(last_error, visit);
  for (const frame of stack) {
    VisitProvenance_Frame.visit_provenance(frame, visit);
  }
};

/** `impl VisitProvenance for Frame<'_, Provenance, FrameExtra<'_>>` (a rustc_const_eval class: an impl table). */
export const VisitProvenance_Frame = {
  // rustc: src/tools/miri/src/concurrency/thread.rs:346 visit_provenance
  visit_provenance(self: Frame<Provenance, FrameExtra>, visit: VisitWith): void {
    const return_place = self.return_place_();
    const locals = self.locals_();
    const {
      extra,
      // There are some private fields we cannot access; they contain no tags.
    } = self;

    // Return place.
    VisitProvenance_PlaceTy.visit_provenance(return_place, visit);
    // Locals.
    for (const local of locals) {
      // We only need the provenance so it's good for this to not be a real read.
      const m = local.as_mplace_or_imm_ghost();
      if (m === undefined) {
      } else if (m.$ === "Left") {
        const [ptr, meta] = m._0;
        VisitProvenance_Pointer.visit_provenance(ptr, visit);
        VisitProvenance_MemPlaceMeta.visit_provenance(meta, visit);
      } else {
        const imm = m._0;
        VisitProvenance_Immediate.visit_provenance(imm, visit);
      }
    }

    VisitProvenance_FrameExtra.visit_provenance(extra, visit);
  },
};

/** PORT: the `FxHashMap` key type of `(DefId, ThreadId)`: the tuple's `Hash` is `DefId::hash` then `ThreadId`'s derived
 *  `u32` hash; `(DefId, ThreadId)` is 12 bytes, align 4. The value, `StrictPointer` (`Pointer<Provenance>`), is 24 bytes
 *  (the 16-byte `Provenance`, niche in `AllocId`, and the `Size` offset), align 8. */
const DefId_ThreadId_key: KeyType<[DefId, ThreadId]> = {
  hash: (k, state) => {
    DefId_fx_key.hash(k[0], state);
    state.write_u32(k[1]._0);
  },
  size: 12,
  align: 4,
};
const StrictPointer_layout = { size: 24, align: 8 };
function new_thread_local_allocs(): FxKeyedMap<[DefId, ThreadId], StrictPointer> {
  return new FxKeyedMap<[DefId, ThreadId], StrictPointer>(DefId_ThreadId_key, StrictPointer_layout, (k) => `${k[0].krate}:${k[0].index}:${k[1]._0}`);
}

// impl VisitProvenance for ThreadManager<'_>
// rustc: src/tools/miri/src/concurrency/thread.rs:404 visit_provenance
ThreadManager.prototype.visit_provenance = function (this: ThreadManager, visit: VisitWith): void {
  const {
    threads,
    thread_local_allocs,
    // active_thread: _, yield_active_thread: _, fixed_scheduling: _,
  } = this;

  for (const thread of threads) {
    thread.visit_provenance(visit);
  }
  for (const ptr of thread_local_allocs.values()) {
    VisitProvenance_StrictPointer.visit_provenance(ptr, visit);
  }
};

// rustc: src/tools/miri/src/concurrency/thread.rs:423 new
(ThreadManager as unknown as { new: typeof ThreadManager.new }).new = function (config: MiriConfig): ThreadManager {
  const threads: Thread[] = [];
  // Create the main thread and add it to the list of threads.
  threads.push(Thread.new("main", undefined));
  return new ThreadManager(ThreadId.MAIN_THREAD, threads, new_thread_local_allocs(), false, config.fixed_scheduling);
};

// rustc: src/tools/miri/src/concurrency/thread.rs:436 init
ThreadManager.init = function (ecx: MiriInterpCx, on_main_stack_empty: StackEmptyCallback): void {
  ecx.machine.threads.threads[ThreadId.MAIN_THREAD.index()]!.on_stack_empty = on_main_stack_empty;
  if (ecx.tcx.deref().sess.target.os.$ !== "Windows") {
    // The main thread can *not* be joined on except on windows.
    ecx.machine.threads.threads[ThreadId.MAIN_THREAD.index()]!.join_status = "Detached";
  }
};

/// Returns the `ThreadId` for the given raw thread id.
/// Returns `Err(ThreadNotFound::InvalidId)` if the id is out of range, or
/// `Err(ThreadNotFound::Terminated(id))` if the thread exists but has terminated.
// rustc: src/tools/miri/src/concurrency/thread.rs:452 thread_id_try_from
ThreadManager.prototype.thread_id_try_from = function (this: ThreadManager, id: number | bigint): Result<ThreadId, ThreadLookupError> {
  // PORT: `impl TryInto<u32>`: callers pass integers of any width (`number` or `bigint`).
  // `if let Ok(id) = id.try_into() && usize::try_from(id).is_ok_and(|id| id < self.threads.len())`
  const as_u32 = typeof id === "bigint" ? (id >= 0n && id <= 0xffff_ffffn ? Number(id) : undefined) : id >= 0 && id <= 0xffff_ffff ? id : undefined;
  if (as_u32 !== undefined && as_u32 < this.threads.length) {
    const thread_id = thread_id_of(as_u32);
    if (ThreadState.is_terminated(this.threads[thread_id.index()]!.state)) {
      return Err({ $: "Terminated", _0: thread_id });
    } else {
      return Ok(thread_id);
    }
  } else {
    return Err(gen.ThreadLookupError.InvalidId);
  }
};

/// Check if we have an allocation for the given thread local static for the
/// active thread.
// rustc: src/tools/miri/src/concurrency/thread.rs:469 get_thread_local_alloc_id
ThreadManager.prototype.get_thread_local_alloc_id = function (this: ThreadManager, def_id: DefId): StrictPointer | undefined {
  return this.thread_local_allocs.get([def_id, this.active_thread]);
};

/// Set the pointer for the allocation of the given thread local
/// static for the active thread.
///
/// Panics if a thread local is initialized twice for the same thread.
// rustc: src/tools/miri/src/concurrency/thread.rs:477 set_thread_local_alloc
ThreadManager.prototype.set_thread_local_alloc = function (this: ThreadManager, def_id: DefId, ptr: StrictPointer): void {
  // `self.thread_local_allocs.try_insert((def_id, self.active_thread), ptr).unwrap();`
  const key: [DefId, ThreadId] = [def_id, this.active_thread];
  if (this.thread_local_allocs.has(key)) {
    // `unwrap` prints the `OccupiedError`'s real `Debug` (key `(DefId, ThreadId)`, old and new value); not ported (needs
    // the DefId formatter; unreachable in M6: a thread-local is initialized once per thread), so stop, don't invent it.
    unported("ThreadManager::set_thread_local_alloc: `unwrap` panic text (Debug of OccupiedError)");
  }
  this.thread_local_allocs.set(key, ptr);
};

/// Borrow the stack of the active thread.
// rustc: src/tools/miri/src/concurrency/thread.rs:482 active_thread_stack
ThreadManager.prototype.active_thread_stack = function (this: ThreadManager): readonly Frame<Provenance, FrameExtra>[] {
  return this.threads[this.active_thread.index()]!.stack;
};

/// Mutably borrow the stack of the active thread.
// rustc: src/tools/miri/src/concurrency/thread.rs:487 active_thread_stack_mut
ThreadManager.prototype.active_thread_stack_mut = function (this: ThreadManager): Frame<Provenance, FrameExtra>[] {
  return this.threads[this.active_thread.index()]!.stack;
};

// rustc: src/tools/miri/src/concurrency/thread.rs:493 all_threads
ThreadManager.prototype.all_threads = function (this: ThreadManager): [ThreadId, Thread][] {
  // PORT: `self.threads.iter_enumerated()` collected (callers re-iterate it; the scheduler gives it core's size hints).
  return this.threads.map((t, i) => [ThreadId.new(i), t]);
};

// rustc: src/tools/miri/src/concurrency/thread.rs:497 all_blocked_stacks
ThreadManager.prototype.all_blocked_stacks = function (this: ThreadManager): [ThreadId, readonly Frame<Provenance, FrameExtra>[]][] {
  const out: [ThreadId, readonly Frame<Provenance, FrameExtra>[]][] = [];
  this.threads.forEach((t, i) => {
    if (t.state.$ === "Blocked") out.push([ThreadId.new(i), t.stack]);
  });
  return out;
};

/// Create a new thread and returns its id.
// rustc: src/tools/miri/src/concurrency/thread.rs:507 create_thread
ThreadManager.prototype.create_thread = function (this: ThreadManager, on_stack_empty: StackEmptyCallback): ThreadId {
  const new_thread_id = ThreadId.new(this.threads.length);
  this.threads.push(Thread.new(undefined, on_stack_empty));
  return new_thread_id;
};

/// Set an active thread and return the id of the thread that was active before.
// rustc: src/tools/miri/src/concurrency/thread.rs:514 set_active_thread
ThreadManager.prototype.set_active_thread = function (this: ThreadManager, id: ThreadId): ThreadId {
  assert(id.index() < this.threads.length, "assertion failed: id.index() < self.threads.len()");
  if (tracing.INFO_ENABLED) {
    tracing.info(
      "miri::concurrency::thread",
      () =>
        `---------- Now executing on thread \`${this.get_thread_display_name(id)}\` (previous: \`${this.get_thread_display_name(this.active_thread)}\`) ----------------------------------------`,
    );
  }
  const old = this.active_thread;
  this.active_thread = id;
  return old;
};

/// Get the id of the currently active thread.
// rustc: src/tools/miri/src/concurrency/thread.rs:525 active_thread
ThreadManager.prototype.active_thread_ = function (this: ThreadManager): ThreadId {
  return this.active_thread;
};

/// Get the total number of threads that were ever spawn by this program.
// rustc: src/tools/miri/src/concurrency/thread.rs:530 get_total_thread_count
ThreadManager.prototype.get_total_thread_count = function (this: ThreadManager): number {
  return this.threads.length;
};

/// Get the total of threads that are currently live, i.e., not yet terminated.
/// (They might be blocked.)
// rustc: src/tools/miri/src/concurrency/thread.rs:536 get_live_thread_count
ThreadManager.prototype.get_live_thread_count = function (this: ThreadManager): number {
  let count = 0;
  for (const t of this.threads) if (!ThreadState.is_terminated(t.state)) count++;
  return count;
};

/// Has the given thread terminated?
// rustc: src/tools/miri/src/concurrency/thread.rs:541 has_terminated
ThreadManager.prototype.has_terminated = function (this: ThreadManager, thread_id: ThreadId): boolean {
  return ThreadState.is_terminated(this.threads[thread_id.index()]!.state);
};

/// Have all threads terminated?
// rustc: src/tools/miri/src/concurrency/thread.rs:546 have_all_terminated
ThreadManager.prototype.have_all_terminated = function (this: ThreadManager): boolean {
  return this.threads.every((thread) => ThreadState.is_terminated(thread.state));
};

/// Enable the thread for execution. The thread must be terminated.
// rustc: src/tools/miri/src/concurrency/thread.rs:551 enable_thread
ThreadManager.prototype.enable_thread = function (this: ThreadManager, thread_id: ThreadId): void {
  assert(this.has_terminated(thread_id), "assertion failed: self.has_terminated(thread_id)");
  this.threads[thread_id.index()]!.state = ThreadState.Enabled;
};

/// Get a mutable borrow of the currently active thread.
// rustc: src/tools/miri/src/concurrency/thread.rs:557 active_thread_mut
ThreadManager.prototype.active_thread_mut = function (this: ThreadManager): Thread {
  return this.threads[this.active_thread.index()]!;
};

/// Get a shared borrow of the currently active thread.
// rustc: src/tools/miri/src/concurrency/thread.rs:562 active_thread_ref
ThreadManager.prototype.active_thread_ref = function (this: ThreadManager): Thread {
  return this.threads[this.active_thread.index()]!;
};

// rustc: src/tools/miri/src/concurrency/thread.rs:566 thread_ref
ThreadManager.prototype.thread_ref = function (this: ThreadManager, thread_id: ThreadId): Thread {
  return index_thread(this.threads, thread_id);
};

/// `self.threads[thread_id]` (`IndexVec` indexing panics when out of bounds).
function index_thread(threads: Thread[], id: ThreadId): Thread {
  const t = threads[id.index()];
  if (t === undefined) panic(`index out of bounds: the len is ${threads.length} but the index is ${id.index()}`);
  return t;
}

/// Mark the thread as detached, which means that no other thread will try
/// to join it and the thread is responsible for cleaning up.
///
/// `allow_terminated_joined` allows detaching joined threads that have already terminated.
/// This matches Windows's behavior for `CloseHandle`.
///
/// See <https://docs.microsoft.com/en-us/windows/win32/procthread/thread-handles-and-identifiers>:
/// > The handle is valid until closed, even after the thread it represents has been terminated.
// rustc: src/tools/miri/src/concurrency/thread.rs:578 detach_thread
ThreadManager.prototype.detach_thread = function (this: ThreadManager, id: ThreadId, allow_terminated_joined: boolean): InterpResult {
  // NOTE: In GenMC mode, we treat detached threads like regular threads that are never joined, so there is no special handling required here.
  // trace!("detaching {:?}", id);

  const thread = index_thread(this.threads, id);
  let is_ub: boolean;
  if (allow_terminated_joined && ThreadState.is_terminated(thread.state)) {
    // "Detached" in particular means "not yet joined". Redundant detaching is still UB.
    is_ub = thread.join_status === "Detached";
  } else {
    is_ub = thread.join_status !== "Joinable";
  }
  if (is_ub) {
    return ub_format("trying to detach thread that was already detached or joined");
  }

  thread.join_status = "Detached";
  return interp_ok(undefined);
};

/// Set the name of the given thread.
// rustc: src/tools/miri/src/concurrency/thread.rs:597 set_thread_name
ThreadManager.prototype.set_thread_name = function (this: ThreadManager, thread: ThreadId, new_thread_name: number[]): void {
  index_thread(this.threads, thread).thread_name = new_thread_name;
};

/// Get the name of the given thread.
// rustc: src/tools/miri/src/concurrency/thread.rs:602 get_thread_name
ThreadManager.prototype.get_thread_name = function (this: ThreadManager, thread: ThreadId): readonly number[] | undefined {
  return index_thread(this.threads, thread).thread_name_();
};

// rustc: src/tools/miri/src/concurrency/thread.rs:606 get_thread_display_name
ThreadManager.prototype.get_thread_display_name = function (this: ThreadManager, thread: ThreadId): string {
  return index_thread(this.threads, thread).thread_display_name(thread);
};

/// Put the thread into the blocked state.
// rustc: src/tools/miri/src/concurrency/thread.rs:611 block_thread
ThreadManager.prototype.block_thread = function (this: ThreadManager, reason: BlockReason, deadline: Deadline | undefined, callback: DynUnblockCallback): void {
  const thread = this.threads[this.active_thread.index()]!;
  assert(ThreadState.is_enabled(thread.state), "assertion failed: state.is_enabled()");
  thread.state = { $: "Blocked", reason, deadline, callback };
};

// rustc: src/tools/miri/src/concurrency/thread.rs:622 fixed_scheduling
ThreadManager.prototype.fixed_scheduling_ = function (this: ThreadManager): boolean {
  return this.fixed_scheduling;
};

// ---------------------------------------------------------------- EvalContextExt ----
// Public interface to thread management.

// #[inline]
// rustc: src/tools/miri/src/concurrency/thread.rs:631 thread_id_try_from
InterpCx.prototype.thread_id_try_from = function (this: MiriInterpCx, id: number | bigint): Result<ThreadId, ThreadLookupError> {
  return this.eval_context_ref().machine.threads.thread_id_try_from(id);
};

/// Get a thread-specific allocation id for the given thread-local static.
/// If needed, allocate a new one.
// rustc: src/tools/miri/src/concurrency/thread.rs:637 get_or_create_thread_local_alloc
InterpCx.prototype.get_or_create_thread_local_alloc = function (this: MiriInterpCx, def_id: DefId): InterpResult<StrictPointer> {
  const this_ = this.eval_context_mut();
  const tcx = this_.tcx;
  const old_alloc = this_.machine.threads.get_thread_local_alloc_id(def_id);
  if (old_alloc !== undefined) {
    // We already have a thread-specific allocation id for this
    // thread-local static.
    return interp_ok(old_alloc);
  } else {
    // We need to allocate a thread-specific allocation id for this
    // thread-local static.
    // First, we compute the initial value for this static.
    if (tcx.deref().is_foreign_item(def_id)) {
      return unsup_format("foreign thread-local statics are not supported");
    }
    const params: MiriAllocParams = this_.machine.get_default_alloc_params();
    const alloc_r = this_.ctfe_query((tcx) => tcx.eval_static_initializer(def_id));
    if (alloc_r.$ === "Err") return Err(InterpErrorInfo_from_ErrorHandled(alloc_r._0));
    const alloc0 = alloc_r._0;
    // We make a full copy of this allocation.
    const alloc_a = alloc0.inner().adjust_from_tcx(
      this_.tcx,
      (bytes, align) => interp_ok(AllocBytes_MiriAllocBytes.from_bytes(bytes, align, params)),
      // PORT(contract): rustc_const_eval's `global_root_pointer` takes a `Pointer<CtfeProvenance>` upstream (memory.rs); its
      // TS declaration is typed `Pointer<ProvOf<M>>` (CTFE's machine-generic shape), hence the cast.
      (ptr) => this_.global_root_pointer(ptr as unknown as StrictPointer),
    );
    if (alloc_a.$ === "Err") return alloc_a;
    const alloc = alloc_a._0;
    // This allocation will be deallocated when the thread dies, so it is not in read-only memory.
    alloc.mutability = "Mut";
    // Create a fresh allocation with this content.
    // PORT(contract): `insert_allocation` takes `Allocation<M::Provenance, (), M::Bytes>` upstream (memory.rs:279); its TS
    // declaration says `MachineAllocation` (with `M::AllocExtra`), hence the cast.
    const ptr_r = this_.insert_allocation(alloc as never, MemoryKind_from_MiriMemoryKind("Tls"));
    if (ptr_r.$ === "Err") return ptr_r;
    const ptr = ptr_r._0;
    this_.machine.threads.set_thread_local_alloc(def_id, ptr);
    return interp_ok(ptr);
  }
};

/// Start a regular (non-main) thread.
// #[inline]
// rustc: src/tools/miri/src/concurrency/thread.rs:679 start_regular_thread
InterpCx.prototype.start_regular_thread = function (
  this: MiriInterpCx,
  thread: MPlaceTy | undefined,
  start_routine: Pointer,
  start_abi: ExternAbi,
  func_arg: ImmTy,
  ret_layout: TyAndLayout,
): InterpResult<ThreadId> {
  const this_ = this.eval_context_mut();

  // Create the new thread
  const current_span = this_.machine.current_user_relevant_span();
  const new_thread_id = this_.machine.threads.create_thread(
    (() => {
      const state = new TlsDtorsState(TlsDtorsStatePriv.Init);
      return (m: MiriInterpCx) => state.on_stack_empty(m);
    })(),
  );
  const data_race = this_.machine.data_race;
  switch (data_race.$) {
    case "None":
      break;
    case "Vclocks":
      data_race._0.thread_created(this_.machine.threads, new_thread_id, current_span);
      break;
    case "Genmc":
      // genmc_ctx.handle_thread_create(&this.machine.threads, start_routine, &func_arg, new_thread_id)?
      return unported("genmc");
  }
  // Write the current thread-id, switch to the next thread later
  // to treat this write operation as occurring on the current thread.
  if (thread !== undefined) {
    const thread_info_place = thread;
    const w = this_.write_scalar(ScalarNs.from_uint(BigInt(new_thread_id.to_u32()), thread_info_place.layout.size), thread_info_place);
    if (w.$ === "Err") return w;
  }

  // Finally switch to new thread so that we can push the first stackframe.
  // After this all accesses will be treated as occurring in the new thread.
  const old_thread_id = this_.machine.threads.set_active_thread(new_thread_id);

  // The child inherits its parent's cpu affinity.
  // Skips this if `machine.thread_cpu_affinity` is not initialized.
  const thread_cpu_affinity = this_.machine.thread_cpu_affinity;
  if (thread_cpu_affinity !== undefined) {
    const cpuset0 = thread_cpu_affinity.get(old_thread_id);
    if (cpuset0 !== undefined) {
      const cpuset = clone_CpuAffinityMask(cpuset0);
      thread_cpu_affinity.set(new_thread_id, cpuset);
    }
  }

  // Perform the function pointer load in the new thread frame.
  const fn_r = this_.get_ptr_fn(start_routine);
  if (fn_r.$ === "Err") return fn_r;
  const inst_r = FnVal.as_instance(fn_r._0);
  if (inst_r.$ === "Err") return inst_r;
  const instance = inst_r._0;

  // Note: the returned value is currently ignored (see the FIXME in
  // pthread_join in shims/unix/thread.rs) because the Rust standard library does not use
  // it.
  const ret_r = this_.allocate(ret_layout, MemoryKind_from_MiriMemoryKind("Machine"));
  if (ret_r.$ === "Err") return ret_r;
  const ret_place = ret_r._0;

  const c = this_.call_thread_root_function(instance, start_abi, [func_arg], ret_place, current_span);
  if (c.$ === "Err") return c;

  // Restore the old active thread frame.
  this_.machine.threads.set_active_thread(old_thread_id);

  return interp_ok(new_thread_id);
};

/// Handles thread termination of the active thread: wakes up threads joining on this one,
/// and deals with the thread's thread-local statics according to `tls_alloc_action`.
///
/// This is called by the eval loop when a thread's on_stack_empty returns `Ready`.
// rustc: src/tools/miri/src/concurrency/thread.rs:754 terminate_active_thread
InterpCx.prototype.terminate_active_thread = function (this: MiriInterpCx, tls_alloc_action: TlsAllocAction): InterpResult {
  const this_ = this.eval_context_mut();

  // Mark thread as terminated.
  const thread = this_.active_thread_mut();
  assert(thread.stack.length === 0, "only threads with an empty stack can be terminated");
  thread.state = ThreadState.Terminated;

  // Deallocate TLS.
  const gone_thread = this_.active_thread();
  {
    const free_tls_statics: StrictPointer[] = [];
    (this_.machine.threads.thread_local_allocs as FxKeyedMap<[DefId, ThreadId], StrictPointer>).retain(([_def_id, thread], alloc_id) => {
      if (!ThreadId_eq(thread, gone_thread)) {
        // A different thread, keep this static around.
        return true;
      }
      // Delete this static from the map and from memory.
      // We cannot free directly here as we cannot use `?` in this context.
      free_tls_statics.push(alloc_id);
      return false;
    });
    // Now free the TLS statics.
    for (const ptr of free_tls_statics) {
      switch (tls_alloc_action) {
        case "Deallocate": {
          const d = this_.deallocate_ptr(ptr, undefined, MemoryKind_from_MiriMemoryKind("Tls"));
          if (d.$ === "Err") return d;
          break;
        }
        case "Leak": {
          const alloc = ptr.provenance.$ === "Concrete" ? ptr.provenance.alloc_id : undefined;
          if (alloc !== undefined) {
            // trace!(
            //     "Thread-local static leaked and stored as static root: {:?}",
            //     alloc
            // );
            this_.machine.static_roots.push(alloc);
          }
          break;
        }
      }
    }
  }

  const data_race = this_.machine.data_race;
  switch (data_race.$) {
    case "None":
      break;
    case "Vclocks":
      data_race._0.thread_terminated(this_.machine.threads);
      break;
    case "Genmc":
      // Inform GenMC that the thread finished.
      // This needs to happen once all accesses to the thread are done, including freeing any TLS statics.
      // genmc_ctx.handle_thread_finish(&this.machine.threads)
      return unported("genmc");
  }

  // Unblock joining threads.
  const unblock_reason: BlockReason = { $: "Join", _0: gone_thread };
  const threads = this_.machine.threads.threads;
  const joining_threads: ThreadId[] = [];
  threads.forEach((thread, id) => {
    if (ThreadState.is_blocked_on(thread.state, unblock_reason)) joining_threads.push(ThreadId.new(id));
  });
  for (const thread of joining_threads) {
    const u = this_.unblock_thread(thread, unblock_reason);
    if (u.$ === "Err") return u;
  }

  return interp_ok(undefined);
};

/// Block the current thread, with an optional timeout.
/// The callback will be invoked when the thread gets unblocked.
// #[inline]
// rustc: src/tools/miri/src/concurrency/thread.rs:822 block_thread
InterpCx.prototype.block_thread = function (this: MiriInterpCx, reason: BlockReason, deadline: Deadline | undefined, callback: DynUnblockCallback): void {
  const this_ = this.eval_context_mut();
  if (deadline !== undefined && this_.machine.data_race.$ === "Genmc") {
    // panic!("Unimplemented: Timeouts not yet supported in GenMC mode.");
    unported("genmc");
  }
  if (deadline !== undefined && deadline.$ === "RealTime" && !this_.machine.communicate()) {
    panic("cannot have `RealTime` timeout with isolation");
  }
  this_.machine.threads.block_thread(reason, deadline, callback);
};

/// Put the blocked thread into the enabled state.
/// Sanity-checks that the thread previously was blocked for the right reason.
// rustc: src/tools/miri/src/concurrency/thread.rs:840 unblock_thread
InterpCx.prototype.unblock_thread = function (this: MiriInterpCx, thread: ThreadId, reason: BlockReason): InterpResult {
  const this_ = this.eval_context_mut();
  const t = index_thread(this_.machine.threads.threads, thread);
  const old_state = t.state;
  t.state = ThreadState.Enabled;
  let callback: DynUnblockCallback;
  if (old_state.$ === "Blocked") {
    const actual_reason = old_state.reason;
    assert_eq_msg(reason, actual_reason, BlockReason_eq, (v) => debug_BlockReason(v, PLAIN_FMT), "unblock_thread: thread was blocked for the wrong reason");
    callback = old_state.callback;
  } else {
    panic("unblock_thread: thread was not blocked");
  }
  // The callback must be executed in the previously blocked thread.
  const old_thread = this_.machine.threads.set_active_thread(thread);
  const r = callback.call(this_, "Ready");
  if (r.$ === "Err") return r;
  this_.machine.threads.set_active_thread(old_thread);
  return interp_ok(undefined);
};

/// Find all threads with expired timeouts, unblock them and execute their timeout callbacks.
///
/// This method returns the minimum duration until the next thread deadline.
/// If all ready threads have no deadline set, [`None`] is returned.
// rustc: src/tools/miri/src/concurrency/thread.rs:865 unblock_expired_deadlines
InterpCx.prototype.unblock_expired_deadlines = function (this: MiriInterpCx): InterpResult<Duration | undefined> {
  const this_ = this.eval_context_mut();
  const communicate = this_.machine.communicate();

  let min_wait_time: Duration | undefined = undefined;
  const callbacks: [ThreadId, DynUnblockCallback][] = [];

  this_.machine.threads.threads.forEach((thread, idx) => {
    const id = ThreadId.new(idx);
    const state = thread.state;
    if (state.$ === "Blocked" && state.deadline !== undefined) {
      const deadline = state.deadline;
      let wait_time: Duration;
      switch (deadline.$) {
        case "Monotonic": {
          const instant = deadline._0;
          wait_time = instant.duration_since(this_.machine.monotonic_clock.now());
          break;
        }
        case "RealTime": {
          assert(communicate, "cannot have `RealTime` timeout with isolation");
          const time = deadline._0;
          const r = time.duration_since(SystemTime.now());
          wait_time = r.$ === "Ok" ? r._0 : Duration.ZERO;
          break;
        }
      }

      if (wait_time.is_zero()) {
        // The timeout expired for this thread.
        const old_state = thread.state;
        thread.state = ThreadState.Enabled;
        if (old_state.$ !== "Blocked") unreachable();
        const callback = old_state.callback;
        // Add callback to list to be run after this loop because of borrow-checking.
        callbacks.push([id, callback]);
      } else {
        // Update `min_wait_time` to contain the smallest duration until
        // the next timeout expires.
        min_wait_time = Duration_min(wait_time, min_wait_time ?? Duration.MAX);
      }
    }
  });

  for (const [thread, callback] of callbacks) {
    // This back-and-forth with `set_active_thread` is here because of two
    // design decisions:
    // 1. Make the caller and not the callback responsible for changing
    //    thread.
    // 2. Make the scheduler the only place that can change the active
    //    thread.
    const old_thread = this_.machine.threads.set_active_thread(thread);
    const r = callback.call(this_, "TimedOut");
    if (r.$ === "Err") return r;
    this_.machine.threads.set_active_thread(old_thread);
  }

  return interp_ok(min_wait_time);
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/thread.rs:918 detach_thread
InterpCx.prototype.detach_thread = function (this: MiriInterpCx, thread_id: ThreadId, allow_terminated_joined: boolean): InterpResult {
  const this_ = this.eval_context_mut();
  return this_.machine.threads.detach_thread(thread_id, allow_terminated_joined);
};

/// Mark that the active thread tries to join the thread with `joined_thread_id`.
///
/// When the join is successful (immediately, or as soon as the joined thread finishes), `success_retval` will be written to `return_dest`.
// rustc: src/tools/miri/src/concurrency/thread.rs:930 join_thread
InterpCx.prototype.join_thread = function (this: MiriInterpCx, joined_thread_id: ThreadId, success_retval: Scalar, return_dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();
  const thread_mgr = this_.machine.threads;
  if (index_thread(thread_mgr.threads, joined_thread_id).join_status === "Detached") {
    // On Windows this corresponds to joining on a closed handle.
    return ub_format("trying to join a detached thread");
  }

  // rustc: src/tools/miri/src/concurrency/thread.rs:943 after_join
  function after_join(this_: MiriInterpCx, joined_thread_id: ThreadId, success_retval: Scalar, return_dest: MPlaceTy): InterpResult {
    const threads = this_.machine.threads;
    const data_race = this_.machine.data_race;
    switch (data_race.$) {
      case "None":
        break;
      case "Vclocks":
        data_race._0.thread_joined(threads, joined_thread_id);
        break;
      case "Genmc":
        // genmc_ctx.handle_thread_join(threads.active_thread, joined_thread_id)?
        return unported("genmc");
    }
    const w = this_.write_scalar(success_retval, return_dest);
    if (w.$ === "Err") return w;
    return interp_ok(undefined);
  }

  // Mark the joined thread as being joined so that we detect if other
  // threads try to join it.
  index_thread(thread_mgr.threads, joined_thread_id).join_status = "Joined";
  if (!ThreadState.is_terminated(index_thread(thread_mgr.threads, joined_thread_id).state)) {
    // trace!(
    //     "{:?} blocked on {:?} when trying to join",
    //     thread_mgr.active_thread, joined_thread_id
    // );
    if (this_.machine.data_race.$ === "Genmc") {
      // genmc_ctx.handle_thread_join(thread_mgr.active_thread, joined_thread_id)?;
      return unported("genmc");
    }

    // The joined thread is still running, we need to wait for it.
    // Once we get unblocked, perform the appropriate synchronization and write the return value.
    const dest = return_dest;
    thread_mgr.block_thread(
      { $: "Join", _0: joined_thread_id },
      undefined,
      // callback!(@capture<'tcx> { joined_thread_id: ThreadId, dest: MPlaceTy<'tcx>, success_retval: Scalar }
      //     |this, unblock: UnblockKind| { .. })
      callback<{ joined_thread_id: ThreadId; dest: MPlaceTy; success_retval: Scalar }, UnblockKind>(
        {
          joined_thread_id: [joined_thread_id, VisitProvenance_no_provenance],
          dest: [dest, VisitProvenance_MPlaceTy],
          success_retval: [success_retval, VisitProvenance_Scalar],
        },
        (this_, unblock, { joined_thread_id, dest, success_retval }) => {
          assert_eq_UnblockKind(unblock, "Ready");
          return after_join(this_, joined_thread_id, success_retval, dest);
        },
      ),
    );
  } else {
    // The thread has already terminated - establish happens-before and write the return value.
    const r = after_join(this_, joined_thread_id, success_retval, return_dest);
    if (r.$ === "Err") return r;
  }
  return interp_ok(undefined);
};


/** `assert_eq!(unblock, UnblockKind::Ready)` */
export function assert_eq_UnblockKind(left: UnblockKind, right: UnblockKind): void {
  if (left !== right) {
    panic(`assertion \`left == right\` failed\n  left: ${debug_UnblockKind(left, PLAIN_FMT)}\n right: ${debug_UnblockKind(right, PLAIN_FMT)}`);
  }
}

/// Mark that the active thread tries to exclusively join the thread with `joined_thread_id`.
/// If the thread is already joined by another thread, it will throw UB.
///
/// When the join is successful (immediately, or as soon as the joined thread finishes), `success_retval` will be written to `return_dest`.
// rustc: src/tools/miri/src/concurrency/thread.rs:1002 join_thread_exclusive
InterpCx.prototype.join_thread_exclusive = function (this: MiriInterpCx, joined_thread_id: ThreadId, success_retval: Scalar, return_dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();
  const threads = this_.machine.threads.threads;
  if (index_thread(threads, joined_thread_id).join_status === "Joined") {
    return ub_format("trying to join an already joined thread");
  }

  if (ThreadId_eq(joined_thread_id, this_.machine.threads.active_thread)) {
    return ub_format("trying to join itself");
  }

  // Sanity check `join_status`.
  assert(
    threads.every((thread) => !ThreadState.is_blocked_on(thread.state, { $: "Join", _0: joined_thread_id })),
    "this thread already has threads waiting for its termination",
  );

  return this_.join_thread(joined_thread_id, success_retval, return_dest);
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/thread.rs:1030 active_thread
InterpCx.prototype.active_thread = function (this: MiriInterpCx): ThreadId {
  const this_ = this.eval_context_ref();
  return this_.machine.threads.active_thread_();
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/thread.rs:1036 active_thread_mut
InterpCx.prototype.active_thread_mut = function (this: MiriInterpCx): Thread {
  const this_ = this.eval_context_mut();
  return this_.machine.threads.active_thread_mut();
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/thread.rs:1042 active_thread_ref
InterpCx.prototype.active_thread_ref = function (this: MiriInterpCx): Thread {
  const this_ = this.eval_context_ref();
  return this_.machine.threads.active_thread_ref();
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/thread.rs:1048 get_total_thread_count
InterpCx.prototype.get_total_thread_count = function (this: MiriInterpCx): number {
  const this_ = this.eval_context_ref();
  return this_.machine.threads.get_total_thread_count();
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/thread.rs:1054 have_all_terminated
InterpCx.prototype.have_all_terminated = function (this: MiriInterpCx): boolean {
  const this_ = this.eval_context_ref();
  return this_.machine.threads.have_all_terminated();
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/thread.rs:1060 enable_thread
InterpCx.prototype.enable_thread = function (this: MiriInterpCx, thread_id: ThreadId): void {
  const this_ = this.eval_context_mut();
  this_.machine.threads.enable_thread(thread_id);
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/thread.rs:1066 active_thread_stack
InterpCx.prototype.active_thread_stack = function (this: MiriInterpCx): readonly Frame<Provenance, FrameExtra>[] {
  // Measured (docs/handoff/miri-perf.md, 486 Ginstr at base): -6.4 Ginstr with `frame` / `frame_mut` (eval_context.ts).
  // PORT(perf): the two inner calls inlined: every frame access comes through here. `eval_context_ref` is `this`.
  const threads = this.machine.threads;
  return threads.threads[threads.active_thread._0]!.stack;
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/thread.rs:1072 active_thread_stack_mut
InterpCx.prototype.active_thread_stack_mut = function (this: MiriInterpCx): Frame<Provenance, FrameExtra>[] {
  // PORT(perf): as `active_thread_stack`.
  const threads = this.machine.threads;
  return threads.threads[threads.active_thread._0]!.stack;
};

/// Set the name of the current thread. The buffer must not include the null terminator.
// #[inline]
// rustc: src/tools/miri/src/concurrency/thread.rs:1081 set_thread_name
InterpCx.prototype.set_thread_name = function (this: MiriInterpCx, thread: ThreadId, new_thread_name: number[]): void {
  this.eval_context_mut().machine.threads.set_thread_name(thread, new_thread_name);
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/thread.rs:1086 get_thread_name
InterpCx.prototype.get_thread_name = function (this: MiriInterpCx, thread: ThreadId): readonly number[] | undefined {
  return this.eval_context_ref().machine.threads.get_thread_name(thread);
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/thread.rs:1094 yield_active_thread
InterpCx.prototype.yield_active_thread = function (this: MiriInterpCx): void {
  // We do not yield immediately, as swapping out the current stack while executing a MIR statement
  // could lead to all sorts of confusion.
  // We should only switch stacks between steps.
  this.eval_context_mut().machine.threads.yield_active_thread = true;
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/thread.rs:1102 maybe_preempt_active_thread
InterpCx.prototype.maybe_preempt_active_thread = function (this: MiriInterpCx): void {
  const this_ = this.eval_context_mut();
  if (!this_.machine.threads.fixed_scheduling && RngExt.random_bool(machine_rng(this_), this_.machine.preemption_rate)) {
    this_.yield_active_thread();
  }
};

/** `this.machine.rng.get_mut()` (`RefCell<StdRng>`: the vendored `StdRng`, typemap entry of lane miri-machine). */
export function machine_rng(ecx: MiriInterpCx): StdRng {
  return ecx.machine.rng;
}

// ---------------------------------------------------------------- declarations ----

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- concurrency/thread.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // concurrency/thread.rs:631
    thread_id_try_from(this: MiriInterpCx, id: number | bigint): Result<ThreadId, ThreadLookupError>;
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
    unblock_expired_deadlines(this: MiriInterpCx): InterpResult<Duration | undefined>;
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
    set_thread_name(this: MiriInterpCx, thread: ThreadId, new_thread_name: number[]): void;
    // concurrency/thread.rs:1086
    get_thread_name(this: MiriInterpCx, thread: ThreadId): readonly number[] | undefined;
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
    // concurrency/thread.rs:67 (impl Idx)
    index(): number;
  }
  namespace ThreadId {
    // concurrency/thread.rs:55
    export let new_unchecked: (id: number) => ThreadId;
    // concurrency/thread.rs:59 (`pub const MAIN_THREAD`)
    export let MAIN_THREAD: ThreadId;
    // concurrency/thread.rs:63 (impl Idx)
    function new_(idx: number): ThreadId;
    export { new_ as new };
  }
}
declare module "./thread.gen.ts" {
  interface Thread {
    // concurrency/thread.rs:208 // PORT: `thread_name_` (a field `thread_name` exists; mir-contract rule)
    thread_name_(): readonly number[] | undefined;
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
    // concurrency/thread.rs:322 (impl VisitProvenance)
    visit_provenance(visit: VisitWith): void;
  }
  namespace Thread {
    // concurrency/thread.rs:306
    function new_(name: string | undefined, on_stack_empty: StackEmptyCallback | undefined): Thread;
    export { new_ as new };
  }
}
declare module "./thread.gen.ts" {
  interface ThreadManager {
    // concurrency/thread.rs:404 (impl VisitProvenance)
    visit_provenance(visit: VisitWith): void;
    // concurrency/thread.rs:452
    thread_id_try_from(id: number | bigint): Result<ThreadId, ThreadLookupError>;
    // concurrency/thread.rs:469
    get_thread_local_alloc_id(def_id: DefId): StrictPointer | undefined;
    // concurrency/thread.rs:477
    set_thread_local_alloc(def_id: DefId, ptr: StrictPointer): void;
    // concurrency/thread.rs:482
    active_thread_stack(): readonly Frame<Provenance, FrameExtra>[];
    // concurrency/thread.rs:487
    active_thread_stack_mut(): Frame<Provenance, FrameExtra>[];
    // concurrency/thread.rs:493
    all_threads(): [ThreadId, Thread][];
    // concurrency/thread.rs:497
    all_blocked_stacks(): [ThreadId, readonly Frame<Provenance, FrameExtra>[]][];
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
    set_thread_name(thread: ThreadId, new_thread_name: number[]): void;
    // concurrency/thread.rs:602
    get_thread_name(thread: ThreadId): readonly number[] | undefined;
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
