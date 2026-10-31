// Port of src/tools/miri/src/concurrency/sync.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-threads` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into sync.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type Deadline } from "../clock.ts";
import { type AccessKind, CondvarRef, FutexRef, MutexRef, RwLock, RwLockRef } from "./sync.gen.ts";
import { type DynUnblockCallback, type ThreadId } from "./thread.ts";
import { type MPlaceTy, type Pointer, type Scalar } from "../lib.ts";
import { AllocExtra, type MiriInterpCx, type MiriMachine } from "../machine.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { type Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
export * from "./sync.gen.ts";

/** `trait SyncObj` (src/tools/miri/src/concurrency/sync.rs): implemented by the file description / sync object types; `(provided)`
 * members are the trait's default methods (PORTING §8: a `<Trait>_provided` helper holds them once ported). */
export interface SyncObj {
  // concurrency/sync.rs:37 (provided)
  on_access(_access_kind: AccessKind): InterpResult;
  // concurrency/sync.rs:43 (provided)
  delete_on_write(): boolean;
}

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- concurrency/sync.rs: `trait EvalContextExtPriv` (impl for `MiriInterpCx`) ----
    // concurrency/sync.rs:251
    condvar_reacquire_mutex(this: MiriInterpCx, mutex_ref: MutexRef, retval: Scalar, dest: MPlaceTy): InterpResult;
    // ---- concurrency/sync.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // concurrency/sync.rs:287
    get_sync_or_init<T>(this: MiriInterpCx, ptr: Pointer, new_: ((_0: MiriMachine) => T)): T | undefined;
    // concurrency/sync.rs:329
    get_immovable_sync_with_static_init<T>(this: MiriInterpCx, obj: MPlaceTy, init_offset: Size, uninit_val: number, init_val: number, new_meta_obj: ((_0: MiriInterpCx) => InterpResult<T>)): InterpResult<T>;
    // concurrency/sync.rs:385
    init_immovable_sync<T>(this: MiriInterpCx, obj: MPlaceTy, init_offset: Size, init_val: number, new_meta_obj: T): InterpResult<T | undefined>;
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
    get_sync<T>(offset: Size): T | undefined;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl fmt::Display for AccessKind (concurrency/sync.rs:24): fmt (:25)
// impl dyn SyncObj (concurrency/sync.rs:48) [dyn SyncObj is not a generated class: companion fns / hand type, lane decides]: downcast_ref (:50)
// impl fmt::Debug for dyn SyncObj (concurrency/sync.rs:56): fmt (:57)
// impl VisitProvenance for MutexRef (concurrency/sync.rs:93): visit_provenance (:95)
// impl VisitProvenance for RwLockRef (concurrency/sync.rs:174): visit_provenance (:176)
// impl VisitProvenance for CondvarRef (concurrency/sync.rs:204): visit_provenance (:206)
// impl VisitProvenance for FutexRef (concurrency/sync.rs:234): visit_provenance (:236)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::concurrency::sync::EvalContextExtPriv", "src/tools/miri/src/concurrency/sync.rs", "miri-threads", () => InterpCx.prototype, ["condvar_reacquire_mutex"]);
stub_methods("miri::concurrency::sync::EvalContextExt", "src/tools/miri/src/concurrency/sync.rs", "miri-threads", () => InterpCx.prototype, ["get_sync_or_init", "get_immovable_sync_with_static_init", "init_immovable_sync", "mutex_lock", "mutex_unlock", "mutex_enqueue_and_block", "rwlock_reader_lock", "rwlock_reader_unlock", "rwlock_enqueue_and_block_reader", "rwlock_writer_lock", "rwlock_writer_unlock", "rwlock_enqueue_and_block_writer", "condvar_wait", "condvar_signal", "futex_wait", "futex_wake"]);
stub_methods("miri::concurrency::sync::MutexRef", "src/tools/miri/src/concurrency/sync.rs", "miri-threads", () => MutexRef.prototype, ["owner", "queue_is_empty"]);
stub_statics("miri::concurrency::sync::MutexRef", "src/tools/miri/src/concurrency/sync.rs", "miri-threads", () => MutexRef, ["new"]);
stub_methods("miri::concurrency::sync::RwLock", "src/tools/miri/src/concurrency/sync.rs", "miri-threads", () => RwLock.prototype, ["is_locked", "is_write_locked"]);
stub_methods("miri::concurrency::sync::RwLockRef", "src/tools/miri/src/concurrency/sync.rs", "miri-threads", () => RwLockRef.prototype, ["is_locked", "is_write_locked", "queue_is_empty"]);
stub_statics("miri::concurrency::sync::RwLockRef", "src/tools/miri/src/concurrency/sync.rs", "miri-threads", () => RwLockRef, ["new"]);
stub_methods("miri::concurrency::sync::CondvarRef", "src/tools/miri/src/concurrency/sync.rs", "miri-threads", () => CondvarRef.prototype, ["queue_is_empty"]);
stub_statics("miri::concurrency::sync::CondvarRef", "src/tools/miri/src/concurrency/sync.rs", "miri-threads", () => CondvarRef, ["new"]);
stub_methods("miri::concurrency::sync::FutexRef", "src/tools/miri/src/concurrency/sync.rs", "miri-threads", () => FutexRef.prototype, ["waiters"]);
stub_statics("miri::concurrency::sync::FutexRef", "src/tools/miri/src/concurrency/sync.rs", "miri-threads", () => FutexRef, ["new"]);
stub_methods("miri::concurrency::sync::AllocExtra", "src/tools/miri/src/concurrency/sync.rs", "miri-threads", () => AllocExtra.prototype, ["get_sync"]);
