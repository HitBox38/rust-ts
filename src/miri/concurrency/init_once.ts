// Port of src/tools/miri/src/concurrency/init_once.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-threads` (plan-m6
// wave 36), ported. Its types are generated into init_once.gen.ts (tools/codegen set `miri`); this module re-exports them.
// PORT: `InitOnceRef(Rc<RefCell<InitOnce>>)` is the generated class whose `_0` is the shared `InitOnce`; `VecDeque` is an
// array (sync.ts header).
import { InitOnce, InitOnceRef, type InitOnceStatus, debug_InitOnceStatus } from "./init_once.gen.ts";
import { VClock_clone_from } from "./sync.ts";
import { type DynUnblockCallback } from "./thread.ts";
import { VClock } from "./vector_clock.ts";
import { type MiriInterpCx } from "../machine.ts";
import { type VisitWith } from "../provenance_gc.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult, interp_ok } from "../../rustc_middle/mir/interpret/mod.ts";
import { panic } from "../../std/panic.ts";
export * from "./init_once.gen.ts";

const PLAIN_FMT = { alternate: false };

/** `assert_eq!(left, right, msg)` / `assert_ne!(left, right, msg)` on `InitOnceStatus`. */
function assert_status(eq: boolean, left: InitOnceStatus, right: InitOnceStatus, msg: string): void {
  if ((left === right) !== eq) {
    panic(`assertion \`left ${eq ? "==" : "!="} right\` failed: ${msg}\n  left: ${debug_InitOnceStatus(left, PLAIN_FMT)}\n right: ${debug_InitOnceStatus(right, PLAIN_FMT)}`);
  }
}

// #[inline]
// rustc: src/tools/miri/src/concurrency/init_once.rs:28 status
InitOnce.prototype.status_ = function (this: InitOnce): InitOnceStatus {
  return this.status;
};

/// Begin initializing this InitOnce. Must only be called after checking that it is currently
/// uninitialized.
// #[inline]
// rustc: src/tools/miri/src/concurrency/init_once.rs:35 begin
InitOnce.prototype.begin = function (this: InitOnce): void {
  assert_status(true, this.status_(), "Uninitialized", "beginning already begun or complete init once");
  this.status = "Begun";
};

// rustc: src/tools/miri/src/concurrency/init_once.rs:49 new
(InitOnceRef as unknown as { new: typeof InitOnceRef.new }).new = function (): InitOnceRef {
  // `Self(Default::default())`
  return new InitOnceRef(new InitOnce("Uninitialized", [], new VClock([])));
};

// rustc: src/tools/miri/src/concurrency/init_once.rs:53 status
InitOnceRef.prototype.status = function (this: InitOnceRef): InitOnceStatus {
  return this._0.status_();
};

// rustc: src/tools/miri/src/concurrency/init_once.rs:57 begin
InitOnceRef.prototype.begin = function (this: InitOnceRef): void {
  this._0.begin();
};

// rustc: src/tools/miri/src/concurrency/init_once.rs:61 queue_is_empty
InitOnceRef.prototype.queue_is_empty = function (this: InitOnceRef): boolean {
  return this._0.waiters.length === 0;
};

// impl VisitProvenance for InitOnceRef
// InitOnce contains no provenance.
// rustc: src/tools/miri/src/concurrency/init_once.rs:68 visit_provenance
InitOnceRef.prototype.visit_provenance = function (this: InitOnceRef, _visit: VisitWith): void {};

// ---------------------------------------------------------------- EvalContextExt ----

/// Put the thread into the queue waiting for the initialization.
// #[inline]
// rustc: src/tools/miri/src/concurrency/init_once.rs:75 init_once_enqueue_and_block
InterpCx.prototype.init_once_enqueue_and_block = function (this: MiriInterpCx, init_once_ref: InitOnceRef, callback: DynUnblockCallback): void {
  const this_ = this.eval_context_mut();
  const thread = this_.active_thread();
  const init_once = init_once_ref._0;
  assert_status(false, init_once.status, "Complete", "queueing on complete init once");

  init_once.waiters.push(thread);
  this_.block_thread({ $: "InitOnce" }, undefined, callback);
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/init_once.rs:90 init_once_complete
InterpCx.prototype.init_once_complete = function (this: MiriInterpCx, init_once_ref: InitOnceRef): InterpResult {
  const this_ = this.eval_context_mut();

  const init_once = init_once_ref._0;
  assert_status(true, init_once.status, "Begun", "completing already complete or uninit init once");

  init_once.status = "Complete";

  // Each complete happens-before the end of the wait
  const r = this_.release_clock((clock) => VClock_clone_from(init_once.clock, clock));
  if (r.$ === "Err") return r;

  // Wake up everyone.
  // need to take the queue to avoid having `this` be borrowed multiple times
  const waiters = init_once.waiters;
  init_once.waiters = [];
  // drop(init_once);
  for (const waiter of waiters) {
    const u = this_.unblock_thread(waiter, { $: "InitOnce" });
    if (u.$ === "Err") return u;
  }

  return interp_ok(undefined);
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/init_once.rs:117 init_once_fail
InterpCx.prototype.init_once_fail = function (this: MiriInterpCx, init_once_ref: InitOnceRef): InterpResult {
  const this_ = this.eval_context_mut();
  const init_once = init_once_ref._0;
  assert_status(true, init_once.status, "Begun", "failing already completed or uninit init once");
  // This is again uninitialized.
  init_once.status = "Uninitialized";

  // Each complete happens-before the end of the wait
  const r = this_.release_clock((clock) => VClock_clone_from(init_once.clock, clock));
  if (r.$ === "Err") return r;

  // Wake up one waiting thread, so they can go ahead and try to init this.
  const waiter = init_once.waiters.shift();
  if (waiter !== undefined) {
    // drop(init_once);
    const u = this_.unblock_thread(waiter, { $: "InitOnce" });
    if (u.$ === "Err") return u;
  }

  return interp_ok(undefined);
};

/// Synchronize with the previous completion of an InitOnce.
/// Must only be called after checking that it is complete.
// #[inline]
// rustc: src/tools/miri/src/concurrency/init_once.rs:143 init_once_observe_completed
InterpCx.prototype.init_once_observe_completed = function (this: MiriInterpCx, init_once_ref: InitOnceRef): InterpResult {
  const this_ = this.eval_context_mut();
  const init_once = init_once_ref._0;

  assert_status(true, init_once.status, "Complete", "observing the completion of incomplete init once");

  return this_.acquire_clock(init_once.clock);
};

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- concurrency/init_once.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // concurrency/init_once.rs:75
    init_once_enqueue_and_block(this: MiriInterpCx, init_once_ref: InitOnceRef, callback: DynUnblockCallback): void;
    // concurrency/init_once.rs:90
    init_once_complete(this: MiriInterpCx, init_once_ref: InitOnceRef): InterpResult;
    // concurrency/init_once.rs:117
    init_once_fail(this: MiriInterpCx, init_once_ref: InitOnceRef): InterpResult;
    // concurrency/init_once.rs:143
    init_once_observe_completed(this: MiriInterpCx, init_once_ref: InitOnceRef): InterpResult;
  }
}

declare module "./init_once.gen.ts" {
  interface InitOnce {
    // concurrency/init_once.rs:28 // PORT: `status_` (a field `status` exists; mir-contract rule)
    status_(): InitOnceStatus;
    // concurrency/init_once.rs:35
    begin(): void;
  }
}
declare module "./init_once.gen.ts" {
  interface InitOnceRef {
    // concurrency/init_once.rs:53
    status(): InitOnceStatus;
    // concurrency/init_once.rs:57
    begin(): void;
    // concurrency/init_once.rs:61
    queue_is_empty(): boolean;
    // concurrency/init_once.rs:68 (impl VisitProvenance)
    visit_provenance(visit: VisitWith): void;
  }
  namespace InitOnceRef {
    // concurrency/init_once.rs:49
    function new_(): InitOnceRef;
    export { new_ as new };
  }
}
