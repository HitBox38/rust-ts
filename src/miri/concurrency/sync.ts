// Port of src/tools/miri/src/concurrency/sync.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-threads` (plan-m6 wave 36),
// ported. Its types are generated into sync.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT decisions (docs/handoff/miri-threads.md):
// - `XRef(Rc<RefCell<X>>)` is the generated class whose `_0` is the shared `X` (`clone` = `clone_XRef`, same `_0`;
//   `borrow`/`borrow_mut` are plain field access; the `drop(guard)` calls are kept as comments).
// - `VecDeque<ThreadId>` is a `ThreadId[]` (`push_back` = `push`, `pop_front` = `shift`); `RwLock.readers`
//   (`FxHashMap<ThreadId, usize>`) is an `FxKeyedMap` keyed by the thread number (typemap `fields`; hashbrown order for
//   its Debug).
// - `dyn SyncObj` / `downcast_ref::<T>()`: `T`'s `Any` type test is a trailing type predicate `is_T` (precedent
//   rustc_middle `MachineStopType_downcast_ref`), so `get_sync::<T>(offset)` is `get_sync(offset, is_T)` and the generic
//   `EvalContextExt` fns take `is_T` before their closure argument.
// - `AllocExtra.sync_objs` (`BTreeMap<Size, Box<dyn SyncObj>>`, built by lane miri-machine) is used through `get`/`set`:
//   it must compare `Size` keys by value.
// - A `callback!` is an inline `MachineCallback` object (thread.ts header).
import { type Deadline } from "../clock.ts";
import { type AccessKind, CondvarRef, FutexRef, type FutexWaiter, MutexRef, RwLock, RwLockRef } from "./sync.gen.ts";
import { assert_eq_UnblockKind, type DynUnblockCallback, type ThreadId, ThreadId_eq, ThreadId_key, ThreadId_value_key, type UnblockKind } from "./thread.ts";
import { VClock } from "./vector_clock.ts";
import { type ImmTy as ImmTy_, type MPlaceTy, type Pointer, type Scalar } from "../lib.ts";
import { AllocExtra, type MiriInterpCx, type MiriMachine } from "../machine.ts";
import { type VisitWith, VisitProvenance_MPlaceTy, VisitProvenance_Scalar } from "../provenance_gc.ts";
import { FxKeyedMap, LAYOUT_USIZE } from "../../rust_ts/hash_map.ts";
import { type Size, Size_cmp } from "../../rustc_abi/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { ImmTy } from "../../rustc_const_eval/interpret/operand.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Scalar as ScalarNs } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Debug, debug_int, debug_struct_non_exhaustive } from "../../std/fmt.ts";
import { assert, panic, unported } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
export * from "./sync.gen.ts";

/** `VClock::default()` (derived: the empty clock). */
function VClock_default(): VClock {
  return new VClock([]);
}

/** `throw_ub_format!(..)` */
function ub_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } }));
}
/** `throw_unsup_format!(..)` */
function unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}
const PLAIN_FMT = { alternate: false };

/// Indicates which kind of access is being performed.
// (generated: `AccessKind`)

// impl fmt::Display for AccessKind
// rustc: src/tools/miri/src/concurrency/sync.rs:25 fmt
export function display_AccessKind(self: AccessKind): string {
  switch (self) {
    case "Read":
      return "read";
    case "Write":
      return "write";
    case "Dealloc":
      return "deallocation";
  }
}

/// A trait for the synchronization metadata that can be attached to a memory location.
export interface SyncObj {
  /// Determines whether reads/writes to this object's location are currently permitted.
  // concurrency/sync.rs:37 (provided)
  on_access(_access_kind: AccessKind): InterpResult;

  /// Determines whether this object's metadata shall be deleted when a write to its
  /// location occurs.
  // concurrency/sync.rs:43 (provided)
  delete_on_write(): boolean;
}
/** PORT: the provided methods of `SyncObj` (PORTING §8); implementors copy the ones they do not override. */
export const SyncObj_provided = {
  /// Determines whether reads/writes to this object's location are currently permitted.
  // rustc: src/tools/miri/src/concurrency/sync.rs:37 on_access
  on_access(this: SyncObj, _access_kind: AccessKind): InterpResult {
    return interp_ok(undefined);
  },

  /// Determines whether this object's metadata shall be deleted when a write to its
  /// location occurs.
  // rustc: src/tools/miri/src/concurrency/sync.rs:43 delete_on_write
  delete_on_write(this: SyncObj): boolean {
    return false;
  },
};

/** `Any`'s type test of a `dyn SyncObj` against a concrete `T` (see the header). */
export type SyncObjType<T extends SyncObj> = (v: SyncObj) => v is T;

// impl dyn SyncObj
// #[inline(always)]
// rustc: src/tools/miri/src/concurrency/sync.rs:50 downcast_ref
export function SyncObj_downcast_ref<T extends SyncObj>(self: SyncObj, is_T: SyncObjType<T>): T | undefined {
  // `let x: &dyn Any = self; x.downcast_ref()`
  return is_T(self) ? self : undefined;
}

// impl fmt::Debug for dyn SyncObj
// rustc: src/tools/miri/src/concurrency/sync.rs:57 fmt
export const debug_SyncObj: Debug<SyncObj> = (_self, f) => debug_struct_non_exhaustive(f, "SyncObj", []);

/// The mutex state.
// (generated: `Mutex`, an interface)

// rustc: src/tools/miri/src/concurrency/sync.rs:79 new
(MutexRef as unknown as { new: typeof MutexRef.new }).new = function (): MutexRef {
  // `Self(Default::default())`
  return new MutexRef({ owner: undefined, lock_count: 0, queue: [], clock: VClock_default() });
};

/// Get the id of the thread that currently owns this lock, or `None` if it is not locked.
// rustc: src/tools/miri/src/concurrency/sync.rs:84 owner
MutexRef.prototype.owner = function (this: MutexRef): ThreadId | undefined {
  return this._0.owner;
};

// rustc: src/tools/miri/src/concurrency/sync.rs:88 queue_is_empty
MutexRef.prototype.queue_is_empty = function (this: MutexRef): boolean {
  return this._0.queue.length === 0;
};

// impl VisitProvenance for MutexRef
// Mutex contains no provenance.
// rustc: src/tools/miri/src/concurrency/sync.rs:95 visit_provenance
MutexRef.prototype.visit_provenance = function (this: MutexRef, _visit: VisitWith): void {};

/** `RwLock::default()` (derived). */
function RwLock_default(): RwLock {
  return new RwLock(undefined, new FxKeyedMap<ThreadId, number>(ThreadId_key, LAYOUT_USIZE, ThreadId_value_key), [], [], VClock_default(), VClock_default());
}

/// Check if locked.
// #[inline]
// rustc: src/tools/miri/src/concurrency/sync.rs:135 is_locked
RwLock.prototype.is_locked = function (this: RwLock): boolean {
  // trace!(
  //     "rwlock_is_locked: writer is {:?} and there are {} reader threads (some of which could hold multiple read locks)",
  //     self.writer,
  //     self.readers.len(),
  // );
  return this.writer !== undefined || !(this.readers.size === 0);
};

/// Check if write locked.
// #[inline]
// rustc: src/tools/miri/src/concurrency/sync.rs:146 is_write_locked
RwLock.prototype.is_write_locked = function (this: RwLock): boolean {
  // trace!("rwlock_is_write_locked: writer is {:?}", self.writer);
  return this.writer !== undefined;
};

// rustc: src/tools/miri/src/concurrency/sync.rs:156 new
(RwLockRef as unknown as { new: typeof RwLockRef.new }).new = function (): RwLockRef {
  return new RwLockRef(RwLock_default());
};

// rustc: src/tools/miri/src/concurrency/sync.rs:160 is_locked
RwLockRef.prototype.is_locked = function (this: RwLockRef): boolean {
  return this._0.is_locked();
};

// rustc: src/tools/miri/src/concurrency/sync.rs:164 is_write_locked
RwLockRef.prototype.is_write_locked = function (this: RwLockRef): boolean {
  return this._0.is_write_locked();
};

// rustc: src/tools/miri/src/concurrency/sync.rs:168 queue_is_empty
RwLockRef.prototype.queue_is_empty = function (this: RwLockRef): boolean {
  const inner = this._0;
  return inner.reader_queue.length === 0 && inner.writer_queue.length === 0;
};

// impl VisitProvenance for RwLockRef
// RwLock contains no provenance.
// rustc: src/tools/miri/src/concurrency/sync.rs:176 visit_provenance
RwLockRef.prototype.visit_provenance = function (this: RwLockRef, _visit: VisitWith): void {};

// rustc: src/tools/miri/src/concurrency/sync.rs:195 new
(CondvarRef as unknown as { new: typeof CondvarRef.new }).new = function (): CondvarRef {
  return new CondvarRef({ waiters: [], clock: VClock_default() });
};

// rustc: src/tools/miri/src/concurrency/sync.rs:199 queue_is_empty
CondvarRef.prototype.queue_is_empty = function (this: CondvarRef): boolean {
  return this._0.waiters.length === 0;
};

// impl VisitProvenance for CondvarRef
// Condvar contains no provenance.
// rustc: src/tools/miri/src/concurrency/sync.rs:206 visit_provenance
CondvarRef.prototype.visit_provenance = function (this: CondvarRef, _visit: VisitWith): void {};

// rustc: src/tools/miri/src/concurrency/sync.rs:225 new
(FutexRef as unknown as { new: typeof FutexRef.new }).new = function (): FutexRef {
  return new FutexRef({ waiters: [], clock: VClock_default() });
};

// rustc: src/tools/miri/src/concurrency/sync.rs:229 waiters
FutexRef.prototype.waiters = function (this: FutexRef): number {
  return this._0.waiters.length;
};

// impl VisitProvenance for FutexRef
// Futex contains no provenance.
// rustc: src/tools/miri/src/concurrency/sync.rs:236 visit_provenance
FutexRef.prototype.visit_provenance = function (this: FutexRef, _visit: VisitWith): void {};

// ---------------------------------------------------------------- EvalContextExtPriv ----
// Private extension trait for local helper methods

// rustc: src/tools/miri/src/concurrency/sync.rs:251 condvar_reacquire_mutex
InterpCx.prototype.condvar_reacquire_mutex = function (this: MiriInterpCx, mutex_ref: MutexRef, retval: Scalar, dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();
  const owner = mutex_ref.owner();
  if (owner !== undefined) {
    // assert_ne!(owner, this.active_thread());
    const active = this_.active_thread();
    if (ThreadId_eq(owner, active)) {
      panic(`assertion \`left != right\` failed\n  left: ThreadId(${owner._0})\n right: ThreadId(${active._0})`);
    }
    this_.mutex_enqueue_and_block(mutex_ref, [retval, dest]);
  } else {
    // We can have it right now!
    const l = this_.mutex_lock(mutex_ref);
    if (l.$ === "Err") return l;
    // Don't forget to write the return value.
    const w = this_.write_scalar(retval, dest);
    if (w.$ === "Err") return w;
  }
  return interp_ok(undefined);
};

// impl<'tcx> AllocExtra<'tcx>
// rustc: src/tools/miri/src/concurrency/sync.rs:272 get_sync
AllocExtra.prototype.get_sync = function <T extends SyncObj>(this: AllocExtra, offset: Size, is_T: SyncObjType<T>): T | undefined {
  const s = this.sync_objs.get(offset);
  return s === undefined ? undefined : SyncObj_downcast_ref(s, is_T);
};

// ---------------------------------------------------------------- EvalContextExt ----
// Public interface to synchronization objects. Please note that in most
// cases, the function calls are infallible and it is the client's (shim
// implementation's) responsibility to detect and deal with erroneous
// situations.

/// Get the synchronization object associated with the given pointer,
/// or initialize a new one.
///
/// Return `None` if this pointer does not point to at least 1 byte of mutable memory.
// rustc: src/tools/miri/src/concurrency/sync.rs:287 get_sync_or_init
InterpCx.prototype.get_sync_or_init = function <T extends SyncObj>(this: MiriInterpCx, ptr: Pointer, is_T: SyncObjType<T>, new_: (machine: MiriMachine) => T): T | undefined {
  const this_ = this.eval_context_mut();
  const r = this_.ptr_try_get_alloc_id(ptr, 0n);
  let ok = false;
  if (r.$ === "Ok") {
    const [alloc_id, offset] = r._0;
    const info = this_.get_alloc_info(alloc_id);
    ok = info.kind === "LiveData" && Mutability.is_mut(info.mutbl) && Size_cmp(offset, info.size) < 0;
  }
  if (!ok) {
    return undefined;
  }
  // This cannot fail now.
  const [alloc, offset] = unwrap_interp(this_.ptr_get_alloc_id(ptr, 0n));
  const [alloc_extra, machine] = unwrap_interp(this_.get_alloc_extra_mut(alloc));
  // Due to borrow checker reasons, we have to do the lookup twice.
  if (alloc_extra.get_sync(offset, is_T) === undefined) {
    const new__ = new_(machine);
    alloc_extra.sync_objs.set(offset, new__);
  }
  return unwrap_opt(alloc_extra.get_sync(offset, is_T));
};

/** `InterpResult::unwrap` of a result that cannot be an error here. */
function unwrap_interp<T>(r: InterpResult<T>): T {
  if (r.$ === "Err") panic("called `Result::unwrap()` on an `Err` value");
  return r._0;
}
/** `Option::unwrap` */
function unwrap_opt<T>(v: T | undefined): T {
  if (v === undefined) panic("called `Option::unwrap()` on a `None` value");
  return v;
}

/// Helper for "immovable" synchronization objects: the expected protocol for these objects is
/// that they use a static initializer of `uninit_val`, and we set them to `init_val` upon
/// initialization. At that point we also register a synchronization object, which is expected
/// to have `delete_on_write() == true`. So in the future, if we still see the object, we know
/// the location must still contain `init_val`. If the object is copied somewhere, that will
/// show up as a non-`init_val` value without a synchronization object, which we can then use to
/// error.
///
/// `new_meta_obj` gets invoked when there is not yet an initialization object.
/// It has to ensure that the in-memory representation indeed matches `uninit_val`.
///
/// The point of storing an `init_val` is so that if this memory gets copied somewhere else,
/// it does not look like the static initializer (i.e., `uninit_val`) any more. For some
/// objects we could just entirely forbid reading their bytes to ensure they don't get copied,
/// but that does not work for objects without a destructor (Windows `InitOnce`, macOS
/// `os_unfair_lock`).
// rustc: src/tools/miri/src/concurrency/sync.rs:329 get_immovable_sync_with_static_init
InterpCx.prototype.get_immovable_sync_with_static_init = function <T extends SyncObj>(
  this: MiriInterpCx,
  obj: MPlaceTy,
  init_offset: Size,
  uninit_val: number,
  init_val: number,
  is_T: SyncObjType<T>,
  new_meta_obj: (ecx: MiriInterpCx) => InterpResult<T>,
): InterpResult<T> {
  assert(init_val !== uninit_val, "assertion failed: init_val != uninit_val");
  const this_ = this.eval_context_mut();
  const c = this_.check_ptr_access(obj.ptr(), obj.layout.size, { $: "Dereferenceable", _0: "pointer" });
  if (c.$ === "Err") return c;
  assert(Size_cmp(init_offset, obj.layout.size) < 0, "assertion failed: init_offset < obj.layout.size"); // ensure our 1-byte flag fits
  const f = obj.offset(init_offset, this_.machine.layouts.u8, this_);
  if (f.$ === "Err") return f;
  const init_field = f._0;

  const g = this_.ptr_get_alloc_id(init_field.ptr(), 0n);
  if (g.$ === "Err") return g;
  const [alloc, offset] = g._0;
  const e = this_.get_alloc_extra_mut(alloc);
  if (e.$ === "Err") return e;
  const [alloc_extra, _machine] = e._0;
  // Due to borrow checker reasons, we have to do the lookup twice.
  if (alloc_extra.get_sync(offset, is_T) !== undefined) {
    const [alloc_extra, _machine] = unwrap_interp(this_.get_alloc_extra_mut(alloc));
    return interp_ok(unwrap_opt(alloc_extra.get_sync(offset, is_T)));
  }

  // There's no sync object there yet. Create one, and try a CAS for uninit_val to init_val.
  const m = new_meta_obj(this_);
  if (m.$ === "Err") return m;
  const meta_obj = m._0;
  const x = this_.atomic_compare_exchange(
    init_field,
    // PORT(contract): `ImmTy::from_scalar` is declared on CTFE's `ImmTy` (operand.ts); it is provenance-generic upstream.
    ImmTy.from_scalar(ScalarNs.from_u8(uninit_val), this_.machine.layouts.u8) as unknown as ImmTy_,
    ScalarNs.from_u8(init_val),
    "Relaxed",
    "Relaxed",
    /* can_fail_spuriously */ false,
  );
  if (x.$ === "Err") return x;
  const [old_init, success] = x._0;
  if (!success) {
    // This can happen for the macOS lock if it is already marked as initialized.
    const o = ScalarNs.to_u8(old_init);
    if (o.$ === "Err") return o;
    if (o._0 !== init_val) {
      panic(`assertion \`left == right\` failed: \`new_meta_obj\` should have ensured that this CAS succeeds\n  left: ${debug_int(o._0, PLAIN_FMT)}\n right: ${debug_int(init_val, PLAIN_FMT)}`);
    }
  }

  {
    const [alloc_extra, _machine] = unwrap_interp(this_.get_alloc_extra_mut(alloc));
    assert(meta_obj.delete_on_write(), "assertion failed: meta_obj.delete_on_write()");
    alloc_extra.sync_objs.set(offset, meta_obj);
    return interp_ok(unwrap_opt(alloc_extra.get_sync(offset, is_T)));
  }
};

/// Explicitly initializes an object that would usually be implicitly initialized with
/// `get_immovable_sync_with_static_init`.
// rustc: src/tools/miri/src/concurrency/sync.rs:385 init_immovable_sync
InterpCx.prototype.init_immovable_sync = function <T extends SyncObj>(
  this: MiriInterpCx,
  obj: MPlaceTy,
  init_offset: Size,
  init_val: number,
  is_T: SyncObjType<T>,
  new_meta_obj: T,
): InterpResult<T | undefined> {
  const this_ = this.eval_context_mut();
  const c = this_.check_ptr_access(obj.ptr(), obj.layout.size, { $: "Dereferenceable", _0: "pointer" });
  if (c.$ === "Err") return c;
  assert(Size_cmp(init_offset, obj.layout.size) < 0, "assertion failed: init_offset < obj.layout.size"); // ensure our 1-byte flag fits
  const f = obj.offset(init_offset, this_.machine.layouts.u8, this_);
  if (f.$ === "Err") return f;
  const init_field = f._0;

  // Zero the entire object, and then store `init_val` directly.
  const n = obj.layout.size.bytes_usize();
  const z = this_.write_bytes_ptr(
    obj.ptr(),
    (function* (): Generator<number> {
      // `iter::repeat_n(0, n)`
      for (let i = 0; i < n; i++) yield 0;
    })(),
  );
  if (z.$ === "Err") return z;
  const w = this_.write_scalar(ScalarNs.from_u8(init_val), init_field);
  if (w.$ === "Err") return w;

  // Create meta-level initialization object.
  const g = this_.ptr_get_alloc_id(init_field.ptr(), 0n);
  if (g.$ === "Err") return g;
  const [alloc, offset] = g._0;
  const [alloc_extra, _machine] = unwrap_interp(this_.get_alloc_extra_mut(alloc));
  assert(new_meta_obj.delete_on_write(), "assertion failed: new_meta_obj.delete_on_write()");
  alloc_extra.sync_objs.set(offset, new_meta_obj);
  return interp_ok(unwrap_opt(alloc_extra.get_sync(offset, is_T)));
};

/// Lock by setting the mutex owner and increasing the lock count.
// rustc: src/tools/miri/src/concurrency/sync.rs:417 mutex_lock
InterpCx.prototype.mutex_lock = function (this: MiriInterpCx, mutex_ref: MutexRef): InterpResult {
  const this_ = this.eval_context_mut();
  const thread = this_.active_thread();
  const mutex = mutex_ref._0;
  const current_owner = mutex.owner;
  if (current_owner !== undefined) {
    if (!ThreadId_eq(thread, current_owner)) {
      panic(`assertion \`left == right\` failed: mutex already locked by another thread\n  left: ThreadId(${thread._0})\n right: ThreadId(${current_owner._0})`);
    }
    assert(mutex.lock_count > 0, "invariant violation: lock_count == 0 iff the thread is unlocked");
  } else {
    mutex.owner = thread;
  }
  mutex.lock_count = strict_add(mutex.lock_count, 1);
  return this_.acquire_clock(mutex.clock);
};

/** `usize::strict_add` */
function strict_add(a: number, b: number): number {
  const r = a + b;
  if (r > Number.MAX_SAFE_INTEGER) unported("usize::strict_add above 2^53");
  return r;
}
/** `usize::strict_sub` */
function strict_sub(a: number, b: number): number {
  if (a < b) panic("attempt to subtract with overflow");
  return a - b;
}

/// Try unlocking by decreasing the lock count and returning the old lock
/// count. If the lock count reaches 0, release the lock and potentially
/// give to a new owner. If the lock was not locked by the current thread,
/// return `None`.
// rustc: src/tools/miri/src/concurrency/sync.rs:439 mutex_unlock
InterpCx.prototype.mutex_unlock = function (this: MiriInterpCx, mutex_ref: MutexRef): InterpResult<number | undefined> {
  const this_ = this.eval_context_mut();
  const mutex = mutex_ref._0;
  const current_owner = mutex.owner;
  if (current_owner !== undefined) {
    // Mutex is locked.
    if (!ThreadId_eq(current_owner, this_.machine.threads.active_thread_())) {
      // Only the owner can unlock the mutex.
      return interp_ok(undefined);
    }
    const old_lock_count = mutex.lock_count;
    mutex.lock_count = strict_sub(old_lock_count, 1);
    if (mutex.lock_count === 0) {
      mutex.owner = undefined;
      // The mutex is completely unlocked. Try transferring ownership
      // to another thread.

      const r = this_.release_clock((clock) => mutex.clock.clone_from(clock));
      if (r.$ === "Err") return r;
      const thread_id = mutex.queue.shift();
      // We need to drop our mutex borrow before unblock_thread
      // because it will be borrowed again in the unblock callback.
      // drop(mutex);
      if (thread_id !== undefined) {
        const u = this_.unblock_thread(thread_id, { $: "Mutex" });
        if (u.$ === "Err") return u;
      }
    }
    return interp_ok(old_lock_count);
  } else {
    // Mutex is not locked.
    return interp_ok(undefined);
  }
};

/// Put the thread into the queue waiting for the mutex.
///
/// Once the Mutex becomes available and if it exists, `retval_dest.0` will
/// be written to `retval_dest.1`.
// #[inline]
// rustc: src/tools/miri/src/concurrency/sync.rs:476 mutex_enqueue_and_block
InterpCx.prototype.mutex_enqueue_and_block = function (this: MiriInterpCx, mutex_ref: MutexRef, retval_dest: [Scalar, MPlaceTy] | undefined): void {
  const this_ = this.eval_context_mut();
  const thread = this_.active_thread();
  const mutex = mutex_ref._0;
  mutex.queue.push(thread);
  assert(mutex.owner !== undefined, "queuing on unlocked mutex");
  // drop(mutex);
  this_.block_thread(
    { $: "Mutex" },
    undefined,
    // callback!(@capture<'tcx> { mutex_ref: MutexRef, retval_dest: Option<(Scalar, MPlaceTy<'tcx>)> }
    //     |this, unblock: UnblockKind| { .. })
    {
      visit_provenance(visit: VisitWith): void {
        mutex_ref.visit_provenance(visit);
        if (retval_dest !== undefined) {
          VisitProvenance_Scalar.visit_provenance(retval_dest[0], visit);
          VisitProvenance_MPlaceTy.visit_provenance(retval_dest[1], visit);
        }
      },
      call(this_: MiriInterpCx, unblock: UnblockKind): InterpResult {
        assert_eq_UnblockKind(unblock, "Ready");

        assert(mutex_ref.owner() === undefined, "assertion failed: mutex_ref.owner().is_none()");
        const l = this_.mutex_lock(mutex_ref);
        if (l.$ === "Err") return l;

        if (retval_dest !== undefined) {
          const [retval, dest] = retval_dest;
          const w = this_.write_scalar(retval, dest);
          if (w.$ === "Err") return w;
        }

        return interp_ok(undefined);
      },
    },
  );
};

/// Read-lock the lock by adding the `reader` the list of threads that own
/// this lock.
// rustc: src/tools/miri/src/concurrency/sync.rs:513 rwlock_reader_lock
InterpCx.prototype.rwlock_reader_lock = function (this: MiriInterpCx, rwlock_ref: RwLockRef): InterpResult {
  const this_ = this.eval_context_mut();
  const thread = this_.active_thread();
  // trace!("rwlock_reader_lock: now also held (one more time) by {:?}", thread);
  const rwlock = rwlock_ref._0;
  assert(!rwlock.is_write_locked(), "the lock is write locked");
  // `let count = rwlock.readers.entry(thread).or_insert(0); *count = count.strict_add(1);`
  const count = rwlock.readers.get(thread) ?? 0;
  rwlock.readers.set(thread, strict_add(count, 1));
  return this_.acquire_clock(rwlock.clock_unlocked);
};

/// Try read-unlock the lock for the current threads and potentially give the lock to a new owner.
/// Returns `true` if succeeded, `false` if this `reader` did not hold the lock.
// rustc: src/tools/miri/src/concurrency/sync.rs:527 rwlock_reader_unlock
InterpCx.prototype.rwlock_reader_unlock = function (this: MiriInterpCx, rwlock_ref: RwLockRef): InterpResult<boolean> {
  const this_ = this.eval_context_mut();
  const thread = this_.active_thread();
  const rwlock = rwlock_ref._0;
  const count0 = rwlock.readers.get(thread);
  if (count0 !== undefined) {
    // Entry::Occupied(mut entry)
    assert(count0 > 0, "rwlock locked with count == 0");
    const count = count0 - 1;
    rwlock.readers.set(thread, count);
    if (count === 0) {
      // trace!("rwlock_reader_unlock: no longer held by {:?}", thread);
      rwlock.readers.delete(thread);
    } else {
      // trace!("rwlock_reader_unlock: held one less time by {:?}", thread);
    }
  } else {
    return interp_ok(false); // we did not even own this lock
  }
  // Add this to the shared-release clock of all concurrent readers.
  const r = this_.release_clock((clock) => rwlock.clock_current_readers.join(clock));
  if (r.$ === "Err") return r;

  // The thread was a reader. If the lock is not held any more, give it to a writer.
  if (!rwlock.is_locked()) {
    // All the readers are finished, so set the writer data-race handle to the value
    // of the union of all reader data race handles, since the set of readers
    // happen-before the writers
    const rwlock_ref_ = rwlock;
    rwlock_ref_.clock_unlocked.clone_from(rwlock_ref_.clock_current_readers);
    // See if there is a thread to unblock.
    const writer = rwlock_ref_.writer_queue.shift();
    if (writer !== undefined) {
      // drop(rwlock); // make RefCell available for unblock callback
      const u = this_.unblock_thread(writer, { $: "RwLock" });
      if (u.$ === "Err") return u;
    }
  }
  return interp_ok(true);
};

/// Put the reader in the queue waiting for the lock and block it.
/// Once the lock becomes available, `retval` will be written to `dest`.
// #[inline]
// rustc: src/tools/miri/src/concurrency/sync.rs:567 rwlock_enqueue_and_block_reader
InterpCx.prototype.rwlock_enqueue_and_block_reader = function (this: MiriInterpCx, rwlock_ref: RwLockRef, retval: Scalar, dest: MPlaceTy): void {
  const this_ = this.eval_context_mut();
  const thread = this_.active_thread();
  const rwlock = rwlock_ref._0;
  rwlock.reader_queue.push(thread);
  assert(rwlock.is_write_locked(), "read-queueing on not write locked rwlock");
  // drop(rwlock);
  this_.block_thread(
    { $: "RwLock" },
    undefined,
    // callback!(@capture<'tcx> { rwlock_ref: RwLockRef, retval: Scalar, dest: MPlaceTy<'tcx> }
    //     |this, unblock: UnblockKind| { .. })
    {
      visit_provenance(visit: VisitWith): void {
        rwlock_ref.visit_provenance(visit);
        VisitProvenance_Scalar.visit_provenance(retval, visit);
        VisitProvenance_MPlaceTy.visit_provenance(dest, visit);
      },
      call(this_: MiriInterpCx, unblock: UnblockKind): InterpResult {
        assert_eq_UnblockKind(unblock, "Ready");
        const l = this_.rwlock_reader_lock(rwlock_ref);
        if (l.$ === "Err") return l;
        const w = this_.write_scalar(retval, dest);
        if (w.$ === "Err") return w;
        return interp_ok(undefined);
      },
    },
  );
};

/// Lock by setting the writer that owns the lock.
// #[inline]
// rustc: src/tools/miri/src/concurrency/sync.rs:600 rwlock_writer_lock
InterpCx.prototype.rwlock_writer_lock = function (this: MiriInterpCx, rwlock_ref: RwLockRef): InterpResult {
  const this_ = this.eval_context_mut();
  const thread = this_.active_thread();
  // trace!("rwlock_writer_lock: now held by {:?}", thread);

  const rwlock = rwlock_ref._0;
  assert(!rwlock.is_locked(), "the rwlock is already locked");
  rwlock.writer = thread;
  return this_.acquire_clock(rwlock.clock_unlocked);
};

/// Try to unlock an rwlock held by the current thread.
/// Return `false` if it is held by another thread.
// #[inline]
// rustc: src/tools/miri/src/concurrency/sync.rs:615 rwlock_writer_unlock
InterpCx.prototype.rwlock_writer_unlock = function (this: MiriInterpCx, rwlock_ref: RwLockRef): InterpResult<boolean> {
  const this_ = this.eval_context_mut();
  const thread = this_.active_thread();
  const rwlock = rwlock_ref._0;
  const current_writer = rwlock.writer;
  if (current_writer !== undefined) {
    if (!ThreadId_eq(current_writer, thread)) {
      // Only the owner can unlock the rwlock.
      return interp_ok(false);
    }
    rwlock.writer = undefined;
    // trace!("rwlock_writer_unlock: unlocked by {:?}", thread);
    // Record release clock for next lock holder.
    const r = this_.release_clock((clock) => rwlock.clock_unlocked.clone_from(clock));
    if (r.$ === "Err") return r;

    // The thread was a writer.
    //
    // We are prioritizing writers here against the readers. As a
    // result, not only readers can starve writers, but also writers can
    // starve readers.
    const writer = rwlock.writer_queue.shift();
    if (writer !== undefined) {
      // drop(rwlock); // make RefCell available for unblock callback
      const u = this_.unblock_thread(writer, { $: "RwLock" });
      if (u.$ === "Err") return u;
    } else {
      // Take the entire read queue and wake them all up.
      const readers = rwlock.reader_queue;
      rwlock.reader_queue = [];
      // drop(rwlock); // make RefCell available for unblock callback
      for (const reader of readers) {
        const u = this_.unblock_thread(reader, { $: "RwLock" });
        if (u.$ === "Err") return u;
      }
    }
    return interp_ok(true);
  } else {
    return interp_ok(false);
  }
};

/// Put the writer in the queue waiting for the lock.
/// Once the lock becomes available, `retval` will be written to `dest`.
// #[inline]
// rustc: src/tools/miri/src/concurrency/sync.rs:654 rwlock_enqueue_and_block_writer
InterpCx.prototype.rwlock_enqueue_and_block_writer = function (this: MiriInterpCx, rwlock_ref: RwLockRef, retval: Scalar, dest: MPlaceTy): void {
  const this_ = this.eval_context_mut();
  const thread = this_.active_thread();
  const rwlock = rwlock_ref._0;
  rwlock.writer_queue.push(thread);
  assert(rwlock.is_locked(), "write-queueing on unlocked rwlock");
  // drop(rwlock);
  this_.block_thread(
    { $: "RwLock" },
    undefined,
    // callback!(@capture<'tcx> { rwlock_ref: RwLockRef, retval: Scalar, dest: MPlaceTy<'tcx> }
    //     |this, unblock: UnblockKind| { .. })
    {
      visit_provenance(visit: VisitWith): void {
        rwlock_ref.visit_provenance(visit);
        VisitProvenance_Scalar.visit_provenance(retval, visit);
        VisitProvenance_MPlaceTy.visit_provenance(dest, visit);
      },
      call(this_: MiriInterpCx, unblock: UnblockKind): InterpResult {
        assert_eq_UnblockKind(unblock, "Ready");
        const l = this_.rwlock_writer_lock(rwlock_ref);
        if (l.$ === "Err") return l;
        const w = this_.write_scalar(retval, dest);
        if (w.$ === "Err") return w;
        return interp_ok(undefined);
      },
    },
  );
};

/// Release the mutex and let the current thread wait on the given condition variable.
/// Once it is signaled, the mutex will be acquired and `retval_succ` will be written to `dest`.
/// If the timeout happens first, `retval_timeout` will be written to `dest`.
// rustc: src/tools/miri/src/concurrency/sync.rs:688 condvar_wait
InterpCx.prototype.condvar_wait = function (
  this: MiriInterpCx,
  condvar_ref: CondvarRef,
  mutex_ref: MutexRef,
  deadline: Deadline | undefined,
  retval_succ: Scalar,
  retval_timeout: Scalar,
  dest: MPlaceTy,
): InterpResult {
  const this_ = this.eval_context_mut();
  const u = this_.mutex_unlock(mutex_ref);
  if (u.$ === "Err") return u;
  const old_locked_count = u._0;
  if (old_locked_count !== undefined) {
    if (old_locked_count !== 1) {
      return unsup_format("awaiting a condvar on a mutex acquired multiple times is not supported");
    }
  } else {
    return ub_format("awaiting a condvar on a mutex that is unlocked or owned by a different thread");
  }
  const thread = this_.active_thread();

  condvar_ref._0.waiters.push(thread);
  this_.block_thread(
    { $: "Condvar" },
    deadline,
    // callback!(@capture<'tcx> { condvar_ref: CondvarRef, mutex_ref: MutexRef, retval_succ: Scalar,
    //     retval_timeout: Scalar, dest: MPlaceTy<'tcx> } |this, unblock: UnblockKind| { .. })
    {
      visit_provenance(visit: VisitWith): void {
        condvar_ref.visit_provenance(visit);
        mutex_ref.visit_provenance(visit);
        VisitProvenance_Scalar.visit_provenance(retval_succ, visit);
        VisitProvenance_Scalar.visit_provenance(retval_timeout, visit);
        VisitProvenance_MPlaceTy.visit_provenance(dest, visit);
      },
      call(this_: MiriInterpCx, unblock: UnblockKind): InterpResult {
        switch (unblock) {
          case "Ready": {
            // The condvar was signaled. Make sure we get the clock for that.
            const a = this_.acquire_clock(condvar_ref._0.clock);
            if (a.$ === "Err") return a;
            // Try to acquire the mutex.
            // The timeout only applies to the first wait (until the signal), not for mutex acquisition.
            return this_.condvar_reacquire_mutex(mutex_ref, retval_succ, dest);
          }
          case "TimedOut": {
            // We have to remove the waiter from the queue again.
            const thread = this_.active_thread();
            const waiters = condvar_ref._0;
            waiters.waiters = waiters.waiters.filter((waiter) => !ThreadId_eq(waiter, thread));
            // Now get back the lock.
            return this_.condvar_reacquire_mutex(mutex_ref, retval_timeout, dest);
          }
        }
      },
    },
  );
  return interp_ok(undefined);
};

/// Wake up some thread (if there is any) sleeping on the conditional
/// variable. Returns `true` iff any thread was woken up.
// rustc: src/tools/miri/src/concurrency/sync.rs:751 condvar_signal
InterpCx.prototype.condvar_signal = function (this: MiriInterpCx, condvar_ref: CondvarRef): InterpResult<boolean> {
  const this_ = this.eval_context_mut();
  const condvar = condvar_ref._0;

  // Each condvar signal happens-before the end of the condvar wake
  const r = this_.release_clock((clock) => condvar.clock.clone_from(clock));
  if (r.$ === "Err") return r;
  const waiter = condvar.waiters.shift();
  if (waiter === undefined) {
    return interp_ok(false);
  }
  // drop(condvar);
  const u = this_.unblock_thread(waiter, { $: "Condvar" });
  if (u.$ === "Err") return u;
  return interp_ok(true);
};

/// Wait for the futex to be signaled, or a timeout. Once the thread is
/// unblocked, `callback` is called with the unblock reason.
// rustc: src/tools/miri/src/concurrency/sync.rs:767 futex_wait
InterpCx.prototype.futex_wait = function (this: MiriInterpCx, futex_ref: FutexRef, bitset: number, deadline: Deadline | undefined, callback: DynUnblockCallback): void {
  const this_ = this.eval_context_mut();
  const thread = this_.active_thread();
  const futex = futex_ref._0;
  const waiters = futex.waiters;
  assert(
    waiters.every((waiter) => !ThreadId_eq(waiter.thread, thread)),
    "thread is already waiting",
  );
  waiters.push({ thread, bitset });
  // drop(futex);

  this_.block_thread(
    { $: "Futex" },
    deadline,
    // callback!(@capture<'tcx> { futex_ref: FutexRef, callback: DynUnblockCallback<'tcx> }
    //     |this, unblock: UnblockKind| { .. })
    {
      visit_provenance(visit: VisitWith): void {
        futex_ref.visit_provenance(visit);
        callback.visit_provenance(visit);
      },
      call(this_: MiriInterpCx, unblock: UnblockKind): InterpResult {
        switch (unblock) {
          case "Ready": {
            const futex = futex_ref._0;
            // Acquire the clock of the futex.
            const a = this_.acquire_clock(futex.clock);
            if (a.$ === "Err") return a;
            break;
          }
          case "TimedOut": {
            // Remove the waiter from the futex.
            const thread = this_.active_thread();
            const futex = futex_ref._0;
            futex.waiters = futex.waiters.filter((waiter) => !ThreadId_eq(waiter.thread, thread));
            break;
          }
        }

        return callback.call(this_, unblock);
      },
    },
  );
};

/// Wake up `count` of the threads in the queue that match any of the bits
/// in the bitset. Returns how many threads were woken.
// rustc: src/tools/miri/src/concurrency/sync.rs:813 futex_wake
InterpCx.prototype.futex_wake = function (this: MiriInterpCx, futex_ref: FutexRef, bitset: number, count: number): InterpResult<number> {
  const this_ = this.eval_context_mut();
  const futex = futex_ref._0;

  // Each futex-wake happens-before the end of the futex wait
  const r = this_.release_clock((clock) => futex.clock.clone_from(clock));
  if (r.$ === "Err") return r;

  // Remove `count` of the threads in the queue that match any of the bits in the bitset.
  // We collect all of them before unblocking because the unblock callback may access the
  // futex state to retrieve the remaining number of waiters on macOS.
  // `futex.waiters.extract_if(.., |w| w.bitset & bitset != 0).take(count).collect()`: `extract_if` is lazy, so only
  // the first `count` matching waiters are removed; later matching ones stay in place.
  const waiters: FutexWaiter[] = [];
  const kept: FutexWaiter[] = [];
  for (const w of futex.waiters) {
    if (waiters.length < count && (w.bitset & bitset) !== 0) waiters.push(w);
    else kept.push(w);
  }
  futex.waiters = kept;
  // drop(futex);

  const woken = waiters.length;
  for (const waiter of waiters) {
    const u = this_.unblock_thread(waiter.thread, { $: "Futex" });
    if (u.$ === "Err") return u;
  }

  return interp_ok(woken);
};

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- concurrency/sync.rs: `trait EvalContextExtPriv` (impl for `MiriInterpCx`) ----
    // concurrency/sync.rs:251
    condvar_reacquire_mutex(this: MiriInterpCx, mutex_ref: MutexRef, retval: Scalar, dest: MPlaceTy): InterpResult;
    // ---- concurrency/sync.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // concurrency/sync.rs:287
    get_sync_or_init<T extends SyncObj>(this: MiriInterpCx, ptr: Pointer, is_T: SyncObjType<T>, new_: (machine: MiriMachine) => T): T | undefined;
    // concurrency/sync.rs:329
    get_immovable_sync_with_static_init<T extends SyncObj>(this: MiriInterpCx, obj: MPlaceTy, init_offset: Size, uninit_val: number, init_val: number, is_T: SyncObjType<T>, new_meta_obj: (ecx: MiriInterpCx) => InterpResult<T>): InterpResult<T>;
    // concurrency/sync.rs:385
    init_immovable_sync<T extends SyncObj>(this: MiriInterpCx, obj: MPlaceTy, init_offset: Size, init_val: number, is_T: SyncObjType<T>, new_meta_obj: T): InterpResult<T | undefined>;
    // concurrency/sync.rs:417
    mutex_lock(this: MiriInterpCx, mutex_ref: MutexRef): InterpResult;
    // concurrency/sync.rs:439
    mutex_unlock(this: MiriInterpCx, mutex_ref: MutexRef): InterpResult<number | undefined>;
    // concurrency/sync.rs:476
    mutex_enqueue_and_block(this: MiriInterpCx, mutex_ref: MutexRef, retval_dest: [Scalar, MPlaceTy] | undefined): void;
    // concurrency/sync.rs:513
    rwlock_reader_lock(this: MiriInterpCx, rwlock_ref: RwLockRef): InterpResult;
    // concurrency/sync.rs:527
    rwlock_reader_unlock(this: MiriInterpCx, rwlock_ref: RwLockRef): InterpResult<boolean>;
    // concurrency/sync.rs:567
    rwlock_enqueue_and_block_reader(this: MiriInterpCx, rwlock_ref: RwLockRef, retval: Scalar, dest: MPlaceTy): void;
    // concurrency/sync.rs:600
    rwlock_writer_lock(this: MiriInterpCx, rwlock_ref: RwLockRef): InterpResult;
    // concurrency/sync.rs:615
    rwlock_writer_unlock(this: MiriInterpCx, rwlock_ref: RwLockRef): InterpResult<boolean>;
    // concurrency/sync.rs:654
    rwlock_enqueue_and_block_writer(this: MiriInterpCx, rwlock_ref: RwLockRef, retval: Scalar, dest: MPlaceTy): void;
    // concurrency/sync.rs:688
    condvar_wait(this: MiriInterpCx, condvar_ref: CondvarRef, mutex_ref: MutexRef, deadline: Deadline | undefined, retval_succ: Scalar, retval_timeout: Scalar, dest: MPlaceTy): InterpResult;
    // concurrency/sync.rs:751
    condvar_signal(this: MiriInterpCx, condvar_ref: CondvarRef): InterpResult<boolean>;
    // concurrency/sync.rs:767
    futex_wait(this: MiriInterpCx, futex_ref: FutexRef, bitset: number, deadline: Deadline | undefined, callback: DynUnblockCallback): void;
    // concurrency/sync.rs:813
    futex_wake(this: MiriInterpCx, futex_ref: FutexRef, bitset: number, count: number): InterpResult<number>;
  }
}

declare module "./sync.gen.ts" {
  interface MutexRef {
    // concurrency/sync.rs:84
    owner(): ThreadId | undefined;
    // concurrency/sync.rs:88
    queue_is_empty(): boolean;
    // concurrency/sync.rs:95 (impl VisitProvenance)
    visit_provenance(visit: VisitWith): void;
  }
  namespace MutexRef {
    // concurrency/sync.rs:79
    function new_(): MutexRef;
    export { new_ as new };
  }
}
declare module "./sync.gen.ts" {
  interface RwLock {
    // concurrency/sync.rs:135
    is_locked(): boolean;
    // concurrency/sync.rs:146
    is_write_locked(): boolean;
  }
}
declare module "./sync.gen.ts" {
  interface RwLockRef {
    // concurrency/sync.rs:160
    is_locked(): boolean;
    // concurrency/sync.rs:164
    is_write_locked(): boolean;
    // concurrency/sync.rs:168
    queue_is_empty(): boolean;
    // concurrency/sync.rs:176 (impl VisitProvenance)
    visit_provenance(visit: VisitWith): void;
  }
  namespace RwLockRef {
    // concurrency/sync.rs:156
    function new_(): RwLockRef;
    export { new_ as new };
  }
}
declare module "./sync.gen.ts" {
  interface CondvarRef {
    // concurrency/sync.rs:199
    queue_is_empty(): boolean;
    // concurrency/sync.rs:206 (impl VisitProvenance)
    visit_provenance(visit: VisitWith): void;
  }
  namespace CondvarRef {
    // concurrency/sync.rs:195
    function new_(): CondvarRef;
    export { new_ as new };
  }
}
declare module "./sync.gen.ts" {
  interface FutexRef {
    // concurrency/sync.rs:229
    waiters(): number;
    // concurrency/sync.rs:236 (impl VisitProvenance)
    visit_provenance(visit: VisitWith): void;
  }
  namespace FutexRef {
    // concurrency/sync.rs:225
    function new_(): FutexRef;
    export { new_ as new };
  }
}
declare module "../machine.gen.ts" {
  interface AllocExtra {
    // concurrency/sync.rs:272
    get_sync<T extends SyncObj>(offset: Size, is_T: SyncObjType<T>): T | undefined;
  }
}

