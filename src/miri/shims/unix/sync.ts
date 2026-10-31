// Port of src/tools/miri/src/shims/unix/sync.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-e` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into sync.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type TimeoutClock } from "../../clock.ts";
import { type MPlaceTy, type OpTy, type Scalar } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { type MutexKind, type PthreadCondvar, type PthreadMutex, type PthreadRwLock } from "./sync.gen.ts";
import { stub_methods } from "../../../rust_ts/miri_stub.ts";
import { type Size } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
export * from "./sync.gen.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- shims/unix/sync.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/sync.rs:473
    pthread_mutexattr_init(this: MiriInterpCx, attr_op: OpTy): InterpResult;
    // shims/unix/sync.rs:481
    pthread_mutexattr_settype(this: MiriInterpCx, attr_op: OpTy, kind_op: OpTy): InterpResult<Scalar>;
    // shims/unix/sync.rs:505
    pthread_mutexattr_destroy(this: MiriInterpCx, attr_op: OpTy): InterpResult;
    // shims/unix/sync.rs:530
    pthread_mutex_init(this: MiriInterpCx, mutex_op: OpTy, attr_op: OpTy): InterpResult;
    // shims/unix/sync.rs:549
    pthread_mutex_lock(this: MiriInterpCx, mutex_op: OpTy, dest: MPlaceTy): InterpResult;
    // shims/unix/sync.rs:589
    pthread_mutex_trylock(this: MiriInterpCx, mutex_op: OpTy): InterpResult<Scalar>;
    // shims/unix/sync.rs:614
    pthread_mutex_unlock(this: MiriInterpCx, mutex_op: OpTy): InterpResult<Scalar>;
    // shims/unix/sync.rs:641
    pthread_mutex_destroy(this: MiriInterpCx, mutex_op: OpTy): InterpResult;
    // shims/unix/sync.rs:661
    pthread_rwlock_rdlock(this: MiriInterpCx, rwlock_op: OpTy, dest: MPlaceTy): InterpResult;
    // shims/unix/sync.rs:684
    pthread_rwlock_tryrdlock(this: MiriInterpCx, rwlock_op: OpTy): InterpResult<Scalar>;
    // shims/unix/sync.rs:697
    pthread_rwlock_wrlock(this: MiriInterpCx, rwlock_op: OpTy, dest: MPlaceTy): InterpResult;
    // shims/unix/sync.rs:732
    pthread_rwlock_trywrlock(this: MiriInterpCx, rwlock_op: OpTy): InterpResult<Scalar>;
    // shims/unix/sync.rs:745
    pthread_rwlock_unlock(this: MiriInterpCx, rwlock_op: OpTy): InterpResult;
    // shims/unix/sync.rs:759
    pthread_rwlock_destroy(this: MiriInterpCx, rwlock_op: OpTy): InterpResult;
    // shims/unix/sync.rs:779
    pthread_condattr_init(this: MiriInterpCx, attr_op: OpTy): InterpResult;
    // shims/unix/sync.rs:794
    pthread_condattr_setclock(this: MiriInterpCx, attr_op: OpTy, clock_id_op: OpTy): InterpResult<Scalar>;
    // shims/unix/sync.rs:812
    pthread_condattr_getclock(this: MiriInterpCx, attr_op: OpTy, clk_id_op: OpTy): InterpResult;
    // shims/unix/sync.rs:828
    pthread_condattr_destroy(this: MiriInterpCx, attr_op: OpTy): InterpResult;
    // shims/unix/sync.rs:846
    pthread_cond_init(this: MiriInterpCx, cond_op: OpTy, attr_op: OpTy): InterpResult;
    // shims/unix/sync.rs:870
    pthread_cond_signal(this: MiriInterpCx, cond_op: OpTy): InterpResult;
    // shims/unix/sync.rs:877
    pthread_cond_broadcast(this: MiriInterpCx, cond_op: OpTy): InterpResult;
    // shims/unix/sync.rs:884
    pthread_cond_wait(this: MiriInterpCx, cond_op: OpTy, mutex_op: OpTy, dest: MPlaceTy): InterpResult;
    // shims/unix/sync.rs:907
    pthread_cond_timedwait(this: MiriInterpCx, cond_op: OpTy, mutex_op: OpTy, timeout_op: OpTy, dest: MPlaceTy, macos_relative_np: boolean): InterpResult;
    // shims/unix/sync.rs:953
    pthread_cond_destroy(this: MiriInterpCx, cond_op: OpTy): InterpResult;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl SyncObj for PthreadMutex (shims/unix/sync.rs:123): on_access (:124), delete_on_write (:133)
// impl SyncObj for PthreadRwLock (shims/unix/sync.rs:259): on_access (:260), delete_on_write (:269)
// impl SyncObj for PthreadCondvar (shims/unix/sync.rs:406): on_access (:407), delete_on_write (:416)
// fn bytewise_equal (shims/unix/sync.rs:11)
// fn mutexattr_kind_offset (shims/unix/sync.rs:36)
// fn mutexattr_get_kind (shims/unix/sync.rs:49)
// fn mutexattr_set_kind (shims/unix/sync.rs:62)
// fn mutexattr_translate_kind (shims/unix/sync.rs:83)
// fn mutex_init_offset (shims/unix/sync.rs:141)
// fn mutex_create (shims/unix/sync.rs:183)
// fn mutex_get_data (shims/unix/sync.rs:196)
// fn mutex_kind_from_static_initializer (shims/unix/sync.rs:217)
// fn rwlock_init_offset (shims/unix/sync.rs:274)
// fn rwlock_get_data (shims/unix/sync.rs:298)
// fn condattr_clock_offset (shims/unix/sync.rs:338)
// fn condattr_get_clock_id (shims/unix/sync.rs:346)
// fn condattr_set_clock_id (shims/unix/sync.rs:358)
// fn cond_init_offset (shims/unix/sync.rs:376)
// fn cond_create (shims/unix/sync.rs:421)
// fn cond_get_data (shims/unix/sync.rs:432)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::unix::sync::EvalContextExt", "src/tools/miri/src/shims/unix/sync.rs", "miri-shims-e", () => InterpCx.prototype, ["pthread_mutexattr_init", "pthread_mutexattr_settype", "pthread_mutexattr_destroy", "pthread_mutex_init", "pthread_mutex_lock", "pthread_mutex_trylock", "pthread_mutex_unlock", "pthread_mutex_destroy", "pthread_rwlock_rdlock", "pthread_rwlock_tryrdlock", "pthread_rwlock_wrlock", "pthread_rwlock_trywrlock", "pthread_rwlock_unlock", "pthread_rwlock_destroy", "pthread_condattr_init", "pthread_condattr_setclock", "pthread_condattr_getclock", "pthread_condattr_destroy", "pthread_cond_init", "pthread_cond_signal", "pthread_cond_broadcast", "pthread_cond_wait", "pthread_cond_timedwait", "pthread_cond_destroy"]);
