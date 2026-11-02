// Port of src/tools/miri/src/shims/unix/sync.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-shims-e` (plan-m6 wave 37).
// Its types are generated into sync.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT decisions (docs/handoff/miri-shims-e.md):
// - `PthreadMutex` / `PthreadRwLock` / `PthreadCondvar` implement `SyncObj` and are stored as `Box<dyn SyncObj>` in
//   `AllocExtra.sync_objs`; `get_sync::<T>` is an exact type test (decision after the miri-threads review: `instanceof`
//   the concrete class, never field presence). They are generated classes (set `miri`'s `class` list), so the derived
//   `Clone` (`clone_PthreadMutex`, ..) builds the class too; `impl SyncObj for ..` is installed on their prototypes with
//   `port_methods` (C10).
// - `ecx.tcx.sess.target.os` is `this.tcx.deref().sess.target.os` (helpers.ts precedent).
import { type TimeoutClock, type TimeoutStyle } from "../../clock.ts";
import { display_AccessKind, type AccessKind, clone_CondvarRef, clone_MutexRef, clone_RwLockRef, CondvarRef, MutexRef, RwLockRef, type SyncObj } from "../../concurrency/sync.ts";
import { ThreadId_eq } from "../../concurrency/thread.ts";
import { throw_machine_stop } from "../../helpers.ts";
import { type MPlaceTy, type OpTy, type Scalar } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import {
  clone_PthreadCondvar,
  clone_PthreadMutex,
  clone_PthreadRwLock,
  type MutexKind,
  PthreadCondvar,
  PthreadMutex,
  PthreadRwLock,
} from "./sync.gen.ts";
import { debug_Size, Size, Size_eq } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { InterpErrorInfo_from_InterpErrorKind, InterpResult, interp_ok, Scalar as ScalarNs } from "../../../rustc_middle/mir/interpret/mod.ts";
import { spec } from "../../../rustc_target/lib.ts";
import { type Os } from "../../../rustc_target/spec/mod.ts";
import { panic } from "../../../std/panic.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { port_methods } from "../../../rust_ts/miri_stub.ts";
import { Err } from "../../../std/result.ts";
export * from "./sync.gen.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
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

// ---------------------------------------------------------------- private glue of this module ----

/** `throw_ub_format!(..)` (`err_ub!(Ub(format!(..)))`) */
function throw_ub_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } }));
}
/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}
/** `&ecx.tcx.sess.target.os` */
function target_os(ecx: MiriInterpCx): Os {
  return ecx.tcx.deref().sess.target.os;
}
/** `{os}` (`impl Display for Os`) */
function display_os(os: Os): string {
  return spec.Os.display(os);
}
/** `Cell<bool>::replace(true)` on one of the machine's `pthread_*_sanity` flags. */
function replace_sanity(ecx: MiriInterpCx, flag: "pthread_mutex_sanity" | "pthread_rwlock_sanity" | "pthread_condvar_sanity"): boolean {
  const old = ecx.machine[flag];
  ecx.machine[flag] = true;
  return old;
}
/** `assert_eq!(init, PTHREAD_UNINIT, "{msg}")` of the static-initializer sanity checks. */
function assert_eq_u8(left: number, right: number, msg: string): void {
  if (left !== right) panic(`assertion \`left == right\` failed: ${msg}\n  left: ${left}\n right: ${right}`);
}

/// Do a bytewise comparison of the two places. This is used to check if
/// a synchronization primitive matches its static initializer value.
///
/// `prefix`, if set, indicates that only the first N bytes should be compared.
// rustc: src/tools/miri/src/shims/unix/sync.rs:11 bytewise_equal
function bytewise_equal(ecx: MiriInterpCx, left: MPlaceTy, right: MPlaceTy, prefix: bigint | undefined): InterpResult<boolean> {
  const size = left.layout.size;
  // assert_eq!(size, right.layout.size);
  if (!Size_eq(size, right.layout.size)) {
    panic(`assertion \`left == right\` failed\n  left: ${debug_Size(size, PLAIN)}\n right: ${debug_Size(right.layout.size, PLAIN)}`);
  }
  const cmp_size = prefix !== undefined ? Size.from_bytes(prefix) : size;

  const l = ecx.read_bytes_ptr_strip_provenance(left.ptr(), cmp_size);
  if (l.$ === "Err") return l;
  const left_bytes = l._0;
  const r = ecx.read_bytes_ptr_strip_provenance(right.ptr(), cmp_size);
  if (r.$ === "Err") return r;
  const right_bytes = r._0;

  // `left_bytes == right_bytes` (slice equality)
  let eq = left_bytes.length === right_bytes.length;
  for (let i = 0; eq && i < left_bytes.length; i++) eq = left_bytes[i] === right_bytes[i];
  return interp_ok(eq);
}

// The in-memory marker values we use to indicate whether objects have been initialized.
const PTHREAD_UNINIT = 0;
const PTHREAD_INIT = 1;

// # pthread_mutexattr_t
// We store some data directly inside the type, ignoring the platform layout:
// - kind: i32

// #[inline]
// rustc: src/tools/miri/src/shims/unix/sync.rs:36 mutexattr_kind_offset
function mutexattr_kind_offset(ecx: MiriInterpCx): InterpResult<bigint> {
  const os = target_os(ecx);
  switch (os.$) {
    case "Linux":
    case "Illumos":
    case "Solaris":
    case "MacOs":
    case "FreeBsd":
    case "Android":
    case "NetBsd":
      return interp_ok(0n);
    default:
      return throw_unsup_format(`\`pthread_mutexattr\` is not supported on ${display_os(os)}`);
  }
}

// rustc: src/tools/miri/src/shims/unix/sync.rs:49 mutexattr_get_kind
function mutexattr_get_kind(ecx: MiriInterpCx, attr_ptr: OpTy): InterpResult<number> {
  const o = mutexattr_kind_offset(ecx);
  if (o.$ === "Err") return o;
  const r = ecx.deref_pointer_and_read(attr_ptr, o._0, ecx.libc_ty_layout("pthread_mutexattr_t"), ecx.machine.layouts.i32);
  if (r.$ === "Err") return r;
  return ScalarNs.to_i32(r._0);
}

// rustc: src/tools/miri/src/shims/unix/sync.rs:62 mutexattr_set_kind
function mutexattr_set_kind(ecx: MiriInterpCx, attr_ptr: OpTy, kind: number): InterpResult {
  const o = mutexattr_kind_offset(ecx);
  if (o.$ === "Err") return o;
  return ecx.deref_pointer_and_write(attr_ptr, o._0, ScalarNs.from_i32(kind), ecx.libc_ty_layout("pthread_mutexattr_t"), ecx.machine.layouts.i32);
}

/// To differentiate "the mutex kind has not been changed" from
/// "the mutex kind has been set to PTHREAD_MUTEX_DEFAULT and that is
/// equal to some other mutex kind", we make the default value of this
/// field *not* PTHREAD_MUTEX_DEFAULT but this special flag.
const PTHREAD_MUTEX_KIND_UNCHANGED = 0x8000000;

/// Translates the mutex kind from what is stored in pthread_mutexattr_t to our enum.
// rustc: src/tools/miri/src/shims/unix/sync.rs:83 mutexattr_translate_kind
function mutexattr_translate_kind(ecx: MiriInterpCx, kind: number): InterpResult<MutexKind> {
  if (kind === ecx.eval_libc_i32("PTHREAD_MUTEX_NORMAL")) {
    return interp_ok("Normal");
  } else if (kind === ecx.eval_libc_i32("PTHREAD_MUTEX_ERRORCHECK")) {
    return interp_ok("ErrorCheck");
  } else if (kind === ecx.eval_libc_i32("PTHREAD_MUTEX_RECURSIVE")) {
    return interp_ok("Recursive");
  } else if (kind === ecx.eval_libc_i32("PTHREAD_MUTEX_DEFAULT") || kind === PTHREAD_MUTEX_KIND_UNCHANGED) {
    // We check this *last* since PTHREAD_MUTEX_DEFAULT may be numerically equal to one of the
    // others, and we want an explicit `mutexattr_settype` to work as expected.
    return interp_ok("Default");
  } else {
    return throw_unsup_format(`unsupported type of mutex: ${kind}`);
  }
}

// # pthread_mutex_t
// We store some data directly inside the type, ignoring the platform layout:
// - init: u8

/// The mutex kind.
// (generated: `MutexKind`)

// #[derive(Debug, Clone)] struct PthreadMutex (generated class)
declare module "./sync.gen.ts" {
  interface PthreadMutex extends SyncObj {}
}
// impl SyncObj for PthreadMutex
port_methods("miri::shims::unix::sync::SyncObj for PthreadMutex", () => PthreadMutex.prototype, {
  // rustc: src/tools/miri/src/shims/unix/sync.rs:124 on_access
  on_access(this: PthreadMutex, access_kind: AccessKind): InterpResult {
    if (!this.mutex_ref.queue_is_empty()) {
      return throw_ub_format(`${display_AccessKind(access_kind)} of \`pthread_mutex_t\` is forbidden while the queue is non-empty`);
    }
    return interp_ok(undefined);
  },

  // rustc: src/tools/miri/src/shims/unix/sync.rs:133 delete_on_write
  delete_on_write(this: PthreadMutex): boolean {
    return true;
  },
});
/** `downcast_ref::<PthreadMutex>()`'s exact type test. */
const is_PthreadMutex = (v: SyncObj): v is PthreadMutex => v instanceof PthreadMutex;

/// To ensure an initialized mutex that was moved somewhere else can be distinguished from
/// a statically initialized mutex that is used the first time, we pick some offset within
/// `pthread_mutex_t` and use it as an "initialized" flag.
// rustc: src/tools/miri/src/shims/unix/sync.rs:141 mutex_init_offset
function mutex_init_offset(ecx: MiriInterpCx): InterpResult<Size> {
  const os = target_os(ecx);
  let offset_: number;
  switch (os.$) {
    case "Linux":
    case "Illumos":
    case "Solaris":
    case "FreeBsd":
    case "Android":
      offset_ = 0;
      break;
    // macOS and NetBSD store a signature in the first bytes, so we move to offset 4.
    case "MacOs":
    case "NetBsd":
      offset_ = 4;
      break;
    default:
      return throw_unsup_format(`\`pthread_mutex\` is not supported on ${display_os(os)}`);
  }
  const offset = Size.from_bytes(offset_);

  // Sanity-check this against PTHREAD_MUTEX_INITIALIZER (but only once):
  // the `init` field must start out not equal to INIT_COOKIE.
  if (!replace_sanity(ecx, "pthread_mutex_sanity")) {
    const check_static_initializer = (name: string): void => {
      const static_initializer = ecx.eval_path(["libc", name]);
      const init_field = InterpResult.unwrap(static_initializer.offset(offset, ecx.machine.layouts.u8, ecx));
      const init = InterpResult.unwrap(ScalarNs.to_u8(InterpResult.unwrap(ecx.read_scalar(init_field))));
      assert_eq_u8(init, PTHREAD_UNINIT, `${name} is incompatible with our initialization logic`);
    };

    check_static_initializer("PTHREAD_MUTEX_INITIALIZER");
    // Check non-standard initializers.
    switch (os.$) {
      case "Linux":
        check_static_initializer("PTHREAD_RECURSIVE_MUTEX_INITIALIZER_NP");
        check_static_initializer("PTHREAD_ERRORCHECK_MUTEX_INITIALIZER_NP");
        check_static_initializer("PTHREAD_ADAPTIVE_MUTEX_INITIALIZER_NP");
        break;
      case "Illumos":
      case "Solaris":
      case "MacOs":
      case "FreeBsd":
      case "Android":
      case "NetBsd":
        // No non-standard initializers.
        break;
      default:
        return throw_unsup_format(`\`pthread_mutex\` is not supported on ${display_os(os)}`);
    }
  }

  return interp_ok(offset);
}

/// Eagerly create and initialize a new mutex.
// rustc: src/tools/miri/src/shims/unix/sync.rs:183 mutex_create
function mutex_create(ecx: MiriInterpCx, mutex_ptr: OpTy, kind: MutexKind): InterpResult<PthreadMutex> {
  const m = ecx.deref_pointer_as(mutex_ptr, ecx.libc_ty_layout("pthread_mutex_t"));
  if (m.$ === "Err") return m;
  const mutex = m._0;
  const data = new PthreadMutex(MutexRef.new(), kind);
  const o = mutex_init_offset(ecx);
  if (o.$ === "Err") return o;
  const i = ecx.init_immovable_sync(mutex, o._0, PTHREAD_INIT, is_PthreadMutex, clone_PthreadMutex(data));
  if (i.$ === "Err") return i;
  return interp_ok(data);
}

/// Returns the mutex data stored at the address that `mutex_ptr` points to.
/// Will raise an error if the mutex has been moved since its first use.
// rustc: src/tools/miri/src/shims/unix/sync.rs:196 mutex_get_data
function mutex_get_data(ecx: MiriInterpCx, mutex_ptr: OpTy): InterpResult<PthreadMutex> {
  const m = ecx.deref_pointer_as(mutex_ptr, ecx.libc_ty_layout("pthread_mutex_t"));
  if (m.$ === "Err") return m;
  const mutex = m._0;
  const o = mutex_init_offset(ecx);
  if (o.$ === "Err") return o;
  return ecx.get_immovable_sync_with_static_init(mutex, o._0, PTHREAD_UNINIT, PTHREAD_INIT, is_PthreadMutex, (ecx) => {
    const kind = mutex_kind_from_static_initializer(ecx, mutex);
    if (kind.$ === "Err") return kind;
    return interp_ok(new PthreadMutex(MutexRef.new(), kind._0));
  });
}

/// Returns the kind of a static initializer.
// rustc: src/tools/miri/src/shims/unix/sync.rs:217 mutex_kind_from_static_initializer
function mutex_kind_from_static_initializer(ecx: MiriInterpCx, mutex: MPlaceTy): InterpResult<MutexKind> {
  const prefix =
    // On android, there's a 4-byte `value` header followed by "padding", and some versions
    // of libc leave that uninitialized. Only check the `value` bytes.
    target_os(ecx).$ === "Android" ? 4n : undefined;
  const is_initializer = (name: string): InterpResult<boolean> => bytewise_equal(ecx, mutex, ecx.eval_path(["libc", name]), prefix);

  // All the static initializers recognized here *must* be checked in `mutex_init_offset`!

  // PTHREAD_MUTEX_INITIALIZER is recognized on all targets.
  const d = is_initializer("PTHREAD_MUTEX_INITIALIZER");
  if (d.$ === "Err") return d;
  if (d._0) {
    return interp_ok("Default");
  }
  // Support additional platform-specific initializers.
  switch (target_os(ecx).$) {
    case "Linux": {
      const r = is_initializer("PTHREAD_RECURSIVE_MUTEX_INITIALIZER_NP");
      if (r.$ === "Err") return r;
      if (r._0) {
        return interp_ok("Recursive");
      } else {
        const e = is_initializer("PTHREAD_ERRORCHECK_MUTEX_INITIALIZER_NP");
        if (e.$ === "Err") return e;
        if (e._0) {
          return interp_ok("ErrorCheck");
        }
      }
      break;
    }
    default:
      break;
  }
  return throw_ub_format("`pthread_mutex_t` was not properly initialized at this location, or it got overwritten");
}

// # pthread_rwlock_t
// We store some data directly inside the type, ignoring the platform layout:
// - init: u8

// #[derive(Debug, Clone)] struct PthreadRwLock (generated class)
declare module "./sync.gen.ts" {
  interface PthreadRwLock extends SyncObj {}
}
// impl SyncObj for PthreadRwLock
port_methods("miri::shims::unix::sync::SyncObj for PthreadRwLock", () => PthreadRwLock.prototype, {
  // rustc: src/tools/miri/src/shims/unix/sync.rs:260 on_access
  on_access(this: PthreadRwLock, access_kind: AccessKind): InterpResult {
    if (!this.rwlock_ref.queue_is_empty()) {
      return throw_ub_format(`${display_AccessKind(access_kind)} of \`pthread_rwlock_t\` is forbidden while the queue is non-empty`);
    }
    return interp_ok(undefined);
  },

  // rustc: src/tools/miri/src/shims/unix/sync.rs:269 delete_on_write
  delete_on_write(this: PthreadRwLock): boolean {
    return true;
  },
});
/** `downcast_ref::<PthreadRwLock>()`'s exact type test. */
const is_PthreadRwLock = (v: SyncObj): v is PthreadRwLock => v instanceof PthreadRwLock;

// rustc: src/tools/miri/src/shims/unix/sync.rs:274 rwlock_init_offset
function rwlock_init_offset(ecx: MiriInterpCx): InterpResult<Size> {
  const os = target_os(ecx);
  let offset_: number;
  switch (os.$) {
    case "Linux":
    case "Illumos":
    case "Solaris":
    case "FreeBsd":
    case "Android":
      offset_ = 0;
      break;
    // macOS stores a signature in the first bytes, so we move to offset 4.
    case "MacOs":
      offset_ = 4;
      break;
    default:
      return throw_unsup_format(`\`pthread_rwlock\` is not supported on ${display_os(os)}`);
  }
  const offset = Size.from_bytes(offset_);

  // Sanity-check this against PTHREAD_RWLOCK_INITIALIZER (but only once):
  // the `init` field must start out not equal to LAZY_INIT_COOKIE.
  if (!replace_sanity(ecx, "pthread_rwlock_sanity")) {
    const static_initializer = ecx.eval_path(["libc", "PTHREAD_RWLOCK_INITIALIZER"]);
    const init_field = InterpResult.unwrap(static_initializer.offset(offset, ecx.machine.layouts.u8, ecx));
    const init = InterpResult.unwrap(ScalarNs.to_u8(InterpResult.unwrap(ecx.read_scalar(init_field))));
    assert_eq_u8(init, PTHREAD_UNINIT, "PTHREAD_RWLOCK_INITIALIZER is incompatible with our initialization logic");
  }

  return interp_ok(offset);
}

// rustc: src/tools/miri/src/shims/unix/sync.rs:298 rwlock_get_data
function rwlock_get_data(ecx: MiriInterpCx, rwlock_ptr: OpTy): InterpResult<PthreadRwLock> {
  const l = ecx.deref_pointer_as(rwlock_ptr, ecx.libc_ty_layout("pthread_rwlock_t"));
  if (l.$ === "Err") return l;
  const rwlock = l._0;
  const o = rwlock_init_offset(ecx);
  if (o.$ === "Err") return o;
  return ecx.get_immovable_sync_with_static_init(rwlock, o._0, PTHREAD_UNINIT, PTHREAD_INIT, is_PthreadRwLock, (ecx) => {
    const prefix =
      // On android, there's a 4-byte `value` header followed by "padding", and some
      // versions of libc leave that uninitialized. Only check the `value` bytes.
      target_os(ecx).$ === "Android" ? 4n : undefined;
    const b = bytewise_equal(ecx, rwlock, ecx.eval_path(["libc", "PTHREAD_RWLOCK_INITIALIZER"]), prefix);
    if (b.$ === "Err") return b;
    if (!b._0) {
      return throw_ub_format("`pthread_rwlock_t` was not properly initialized at this location, or it got overwritten");
    }
    return interp_ok(new PthreadRwLock(RwLockRef.new()));
  });
}

// # pthread_condattr_t
// We store some data directly inside the type, ignoring the platform layout:
// - clock: i32

// #[inline]
// rustc: src/tools/miri/src/shims/unix/sync.rs:338 condattr_clock_offset
function condattr_clock_offset(ecx: MiriInterpCx): InterpResult<bigint> {
  const os = target_os(ecx);
  switch (os.$) {
    case "Linux":
    case "Illumos":
    case "Solaris":
    case "FreeBsd":
    case "Android":
      return interp_ok(0n);
    // macOS does not have a clock attribute.
    default:
      return throw_unsup_format(`\`pthread_condattr\` clock field is not supported on ${display_os(os)}`);
  }
}

// rustc: src/tools/miri/src/shims/unix/sync.rs:346 condattr_get_clock_id
function condattr_get_clock_id(ecx: MiriInterpCx, attr_ptr: OpTy): InterpResult<Scalar> {
  const o = condattr_clock_offset(ecx);
  if (o.$ === "Err") return o;
  return ecx.deref_pointer_and_read(attr_ptr, o._0, ecx.libc_ty_layout("pthread_condattr_t"), ecx.machine.layouts.i32);
}

// rustc: src/tools/miri/src/shims/unix/sync.rs:358 condattr_set_clock_id
function condattr_set_clock_id(ecx: MiriInterpCx, attr_ptr: OpTy, clock_id: number): InterpResult {
  const o = condattr_clock_offset(ecx);
  if (o.$ === "Err") return o;
  return ecx.deref_pointer_and_write(attr_ptr, o._0, ScalarNs.from_i32(clock_id), ecx.libc_ty_layout("pthread_condattr_t"), ecx.machine.layouts.i32);
}

// # pthread_cond_t
// We store some data directly inside the type, ignoring the platform layout:
// - init: u8

// rustc: src/tools/miri/src/shims/unix/sync.rs:376 cond_init_offset
function cond_init_offset(ecx: MiriInterpCx): InterpResult<Size> {
  const os = target_os(ecx);
  let offset_: number;
  switch (os.$) {
    case "Linux":
    case "Illumos":
    case "Solaris":
    case "FreeBsd":
    case "Android":
      offset_ = 0;
      break;
    // macOS stores a signature in the first bytes, so we move to offset 4.
    case "MacOs":
      offset_ = 4;
      break;
    default:
      return throw_unsup_format(`\`pthread_cond\` is not supported on ${display_os(os)}`);
  }
  const offset = Size.from_bytes(offset_);

  // Sanity-check this against PTHREAD_COND_INITIALIZER (but only once):
  // the `init` field must start out not equal to LAZY_INIT_COOKIE.
  if (!replace_sanity(ecx, "pthread_condvar_sanity")) {
    const static_initializer = ecx.eval_path(["libc", "PTHREAD_COND_INITIALIZER"]);
    const init_field = InterpResult.unwrap(static_initializer.offset(offset, ecx.machine.layouts.u8, ecx));
    const init = InterpResult.unwrap(ScalarNs.to_u8(InterpResult.unwrap(ecx.read_scalar(init_field))));
    assert_eq_u8(init, PTHREAD_UNINIT, "PTHREAD_COND_INITIALIZER is incompatible with our initialization logic");
  }

  return interp_ok(offset);
}

// #[derive(Debug, Clone)] struct PthreadCondvar (generated class)
declare module "./sync.gen.ts" {
  interface PthreadCondvar extends SyncObj {}
}
// impl SyncObj for PthreadCondvar
port_methods("miri::shims::unix::sync::SyncObj for PthreadCondvar", () => PthreadCondvar.prototype, {
  // rustc: src/tools/miri/src/shims/unix/sync.rs:407 on_access
  on_access(this: PthreadCondvar, access_kind: AccessKind): InterpResult {
    if (!this.condvar_ref.queue_is_empty()) {
      return throw_ub_format(`${display_AccessKind(access_kind)} of \`pthread_cond_t\` is forbidden while the queue is non-empty`);
    }
    return interp_ok(undefined);
  },

  // rustc: src/tools/miri/src/shims/unix/sync.rs:416 delete_on_write
  delete_on_write(this: PthreadCondvar): boolean {
    return true;
  },
});
/** `downcast_ref::<PthreadCondvar>()`'s exact type test. */
const is_PthreadCondvar = (v: SyncObj): v is PthreadCondvar => v instanceof PthreadCondvar;

// rustc: src/tools/miri/src/shims/unix/sync.rs:421 cond_create
function cond_create(ecx: MiriInterpCx, cond_ptr: OpTy, clock: TimeoutClock): InterpResult<PthreadCondvar> {
  const c = ecx.deref_pointer_as(cond_ptr, ecx.libc_ty_layout("pthread_cond_t"));
  if (c.$ === "Err") return c;
  const cond = c._0;
  const data = new PthreadCondvar(CondvarRef.new(), clock);
  const o = cond_init_offset(ecx);
  if (o.$ === "Err") return o;
  const i = ecx.init_immovable_sync(cond, o._0, PTHREAD_INIT, is_PthreadCondvar, clone_PthreadCondvar(data));
  if (i.$ === "Err") return i;
  return interp_ok(data);
}

// rustc: src/tools/miri/src/shims/unix/sync.rs:432 cond_get_data
function cond_get_data(ecx: MiriInterpCx, cond_ptr: OpTy): InterpResult<PthreadCondvar> {
  const c = ecx.deref_pointer_as(cond_ptr, ecx.libc_ty_layout("pthread_cond_t"));
  if (c.$ === "Err") return c;
  const cond = c._0;
  const o = cond_init_offset(ecx);
  if (o.$ === "Err") return o;
  return ecx.get_immovable_sync_with_static_init(cond, o._0, PTHREAD_UNINIT, PTHREAD_INIT, is_PthreadCondvar, (ecx) => {
    const prefix =
      // On android, there's a 4-byte `value` header followed by "padding", and some
      // versions of libc leave that uninitialized. Only check the `value` bytes.
      target_os(ecx).$ === "Android" ? 4n : undefined;
    const b = bytewise_equal(ecx, cond, ecx.eval_path(["libc", "PTHREAD_COND_INITIALIZER"]), prefix);
    if (b.$ === "Err") return b;
    if (!b._0) {
      return throw_ub_format("`pthread_cond_t` was not properly initialized at this location, or it got overwritten");
    }
    // This used the static initializer. The clock there is always CLOCK_REALTIME.
    return interp_ok(new PthreadCondvar(CondvarRef.new(), "RealTime"));
  });
}

// ---------------------------------------------------------------- EvalContextExt ----

// rustc: src/tools/miri/src/shims/unix/sync.rs:473 pthread_mutexattr_init
InterpCx.prototype.pthread_mutexattr_init = function (this: MiriInterpCx, attr_op: OpTy): InterpResult {
  const this_ = this.eval_context_mut();

  const s = mutexattr_set_kind(this_, attr_op, PTHREAD_MUTEX_KIND_UNCHANGED);
  if (s.$ === "Err") return s;

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:481 pthread_mutexattr_settype
InterpCx.prototype.pthread_mutexattr_settype = function (this: MiriInterpCx, attr_op: OpTy, kind_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const k = this_.read_scalar(kind_op);
  if (k.$ === "Err") return k;
  const ki = ScalarNs.to_i32(k._0);
  if (ki.$ === "Err") return ki;
  const kind = ki._0;
  if (
    kind === this_.eval_libc_i32("PTHREAD_MUTEX_NORMAL") ||
    kind === this_.eval_libc_i32("PTHREAD_MUTEX_DEFAULT") ||
    kind === this_.eval_libc_i32("PTHREAD_MUTEX_ERRORCHECK") ||
    kind === this_.eval_libc_i32("PTHREAD_MUTEX_RECURSIVE")
  ) {
    // Make sure we do not mix this up with the "unchanged" kind.
    // assert_ne!(kind, PTHREAD_MUTEX_KIND_UNCHANGED);
    if (kind === PTHREAD_MUTEX_KIND_UNCHANGED) {
      panic(`assertion \`left != right\` failed\n  left: ${kind}\n right: ${PTHREAD_MUTEX_KIND_UNCHANGED}`);
    }
    const s = mutexattr_set_kind(this_, attr_op, kind);
    if (s.$ === "Err") return s;
  } else {
    const einval = this_.eval_libc_i32("EINVAL");
    return interp_ok(ScalarNs.from_i32(einval));
  }

  return interp_ok(ScalarNs.from_i32(0));
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:505 pthread_mutexattr_destroy
InterpCx.prototype.pthread_mutexattr_destroy = function (this: MiriInterpCx, attr_op: OpTy): InterpResult {
  const this_ = this.eval_context_mut();

  // Destroying an uninit pthread_mutexattr is UB, so check to make sure it's not uninit.
  const g = mutexattr_get_kind(this_, attr_op);
  if (g.$ === "Err") return g;

  // To catch double-destroys, we de-initialize the mutexattr.
  // This is technically not right and might lead to false positives. For example, the below
  // code is *likely* sound, even assuming uninit numbers are UB, but Miri complains.
  //
  // let mut x: MaybeUninit<libc::pthread_mutexattr_t> = MaybeUninit::zeroed();
  // libc::pthread_mutexattr_init(x.as_mut_ptr());
  // libc::pthread_mutexattr_destroy(x.as_mut_ptr());
  // x.assume_init();
  //
  // However, the way libstd uses the pthread APIs works in our favor here, so we can get away with this.
  // This can always be revisited to have some external state to catch double-destroys
  // but not complain about the above code. See https://github.com/rust-lang/miri/pull/1933
  const p = this_.deref_pointer_as(attr_op, this_.libc_ty_layout("pthread_mutexattr_t"));
  if (p.$ === "Err") return p;
  const w = this_.write_uninit(p._0);
  if (w.$ === "Err") return w;

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:530 pthread_mutex_init
InterpCx.prototype.pthread_mutex_init = function (this: MiriInterpCx, mutex_op: OpTy, attr_op: OpTy): InterpResult {
  const this_ = this.eval_context_mut();

  const a = this_.read_pointer(attr_op);
  if (a.$ === "Err") return a;
  const attr = a._0;
  const n = this_.ptr_is_null(attr);
  if (n.$ === "Err") return n;
  let kind: MutexKind;
  if (n._0) {
    kind = "Default";
  } else {
    const g = mutexattr_get_kind(this_, attr_op);
    if (g.$ === "Err") return g;
    const t = mutexattr_translate_kind(this_, g._0);
    if (t.$ === "Err") return t;
    kind = t._0;
  }

  const c = mutex_create(this_, mutex_op, kind);
  if (c.$ === "Err") return c;

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:549 pthread_mutex_lock
InterpCx.prototype.pthread_mutex_lock = function (this: MiriInterpCx, mutex_op: OpTy, dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();

  const g = mutex_get_data(this_, mutex_op);
  if (g.$ === "Err") return g;
  const mutex = clone_PthreadMutex(g._0);

  let ret: number;
  const owner_thread = mutex.mutex_ref.owner();
  if (owner_thread !== undefined) {
    if (!ThreadId_eq(owner_thread, this_.active_thread())) {
      this_.mutex_enqueue_and_block(mutex.mutex_ref, [ScalarNs.from_i32(0), dest]);
      return interp_ok(undefined);
    } else {
      // Trying to acquire the same mutex again.
      switch (mutex.kind) {
        case "Default":
          return throw_ub_format("trying to acquire default mutex already locked by the current thread");
        case "Normal":
          return throw_machine_stop({ $: "LocalDeadlock" });
        case "ErrorCheck":
          ret = this_.eval_libc_i32("EDEADLK");
          break;
        case "Recursive": {
          const l = this_.mutex_lock(mutex.mutex_ref);
          if (l.$ === "Err") return l;
          ret = 0;
          break;
        }
      }
    }
  } else {
    // The mutex is unlocked. Let's lock it.
    const l = this_.mutex_lock(mutex.mutex_ref);
    if (l.$ === "Err") return l;
    ret = 0;
  }
  const w = this_.write_scalar(ScalarNs.from_i32(ret), dest);
  if (w.$ === "Err") return w;
  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:589 pthread_mutex_trylock
InterpCx.prototype.pthread_mutex_trylock = function (this: MiriInterpCx, mutex_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const g = mutex_get_data(this_, mutex_op);
  if (g.$ === "Err") return g;
  const mutex = clone_PthreadMutex(g._0);

  let ret: number;
  const owner_thread = mutex.mutex_ref.owner();
  if (owner_thread !== undefined) {
    if (!ThreadId_eq(owner_thread, this_.active_thread())) {
      ret = this_.eval_libc_i32("EBUSY");
    } else {
      switch (mutex.kind) {
        case "Default":
        case "Normal":
        case "ErrorCheck":
          ret = this_.eval_libc_i32("EBUSY");
          break;
        case "Recursive": {
          const l = this_.mutex_lock(mutex.mutex_ref);
          if (l.$ === "Err") return l;
          ret = 0;
          break;
        }
      }
    }
  } else {
    // The mutex is unlocked. Let's lock it.
    const l = this_.mutex_lock(mutex.mutex_ref);
    if (l.$ === "Err") return l;
    ret = 0;
  }
  return interp_ok(ScalarNs.from_i32(ret));
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:614 pthread_mutex_unlock
InterpCx.prototype.pthread_mutex_unlock = function (this: MiriInterpCx, mutex_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const g = mutex_get_data(this_, mutex_op);
  if (g.$ === "Err") return g;
  const mutex = clone_PthreadMutex(g._0);

  const u = this_.mutex_unlock(mutex.mutex_ref);
  if (u.$ === "Err") return u;
  if (u._0 !== undefined) {
    // The mutex was locked by the current thread.
    return interp_ok(ScalarNs.from_i32(0));
  } else {
    // The mutex was locked by another thread or not locked at all. See
    // the “Unlock When Not Owner” column in
    // https://pubs.opengroup.org/onlinepubs/9699919799/functions/pthread_mutex_unlock.html.
    switch (mutex.kind) {
      case "Default":
        return throw_ub_format("unlocked a default mutex that was not locked by the current thread");
      case "Normal":
        return throw_ub_format("unlocked a PTHREAD_MUTEX_NORMAL mutex that was not locked by the current thread");
      case "ErrorCheck":
      case "Recursive":
        return interp_ok(ScalarNs.from_i32(this_.eval_libc_i32("EPERM")));
    }
  }
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:641 pthread_mutex_destroy
InterpCx.prototype.pthread_mutex_destroy = function (this: MiriInterpCx, mutex_op: OpTy): InterpResult {
  const this_ = this.eval_context_mut();

  // Reading the field also has the side-effect that we detect double-`destroy`
  // since we make the field uninit below.
  const g = mutex_get_data(this_, mutex_op);
  if (g.$ === "Err") return g;
  const mutex = clone_PthreadMutex(g._0);

  if (mutex.mutex_ref.owner() !== undefined) {
    return throw_ub_format("destroyed a locked mutex");
  }

  // This write also deletes the interpreter state for this mutex.
  // This might lead to false positives, see comment in pthread_mutexattr_destroy
  const p = this_.deref_pointer_as(mutex_op, this_.libc_ty_layout("pthread_mutex_t"));
  if (p.$ === "Err") return p;
  const mutex_place = p._0;
  const w = this_.write_uninit(mutex_place);
  if (w.$ === "Err") return w;

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:661 pthread_rwlock_rdlock
InterpCx.prototype.pthread_rwlock_rdlock = function (this: MiriInterpCx, rwlock_op: OpTy, dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();

  const g = rwlock_get_data(this_, rwlock_op);
  if (g.$ === "Err") return g;
  const rwlock = clone_PthreadRwLock(g._0);

  if (rwlock.rwlock_ref.is_write_locked()) {
    this_.rwlock_enqueue_and_block_reader(rwlock.rwlock_ref, ScalarNs.from_i32(0), dest);
  } else {
    const l = this_.rwlock_reader_lock(rwlock.rwlock_ref);
    if (l.$ === "Err") return l;
    const w = this_.write_null(dest);
    if (w.$ === "Err") return w;
  }

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:684 pthread_rwlock_tryrdlock
InterpCx.prototype.pthread_rwlock_tryrdlock = function (this: MiriInterpCx, rwlock_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const g = rwlock_get_data(this_, rwlock_op);
  if (g.$ === "Err") return g;
  const rwlock = clone_PthreadRwLock(g._0);

  if (rwlock.rwlock_ref.is_write_locked()) {
    return interp_ok(ScalarNs.from_i32(this_.eval_libc_i32("EBUSY")));
  } else {
    const l = this_.rwlock_reader_lock(rwlock.rwlock_ref);
    if (l.$ === "Err") return l;
    return interp_ok(ScalarNs.from_i32(0));
  }
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:697 pthread_rwlock_wrlock
InterpCx.prototype.pthread_rwlock_wrlock = function (this: MiriInterpCx, rwlock_op: OpTy, dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();

  const g = rwlock_get_data(this_, rwlock_op);
  if (g.$ === "Err") return g;
  const rwlock = clone_PthreadRwLock(g._0);

  if (rwlock.rwlock_ref.is_locked()) {
    // Note: this will deadlock if the lock is already locked by this
    // thread in any way.
    //
    // Relevant documentation:
    // https://pubs.opengroup.org/onlinepubs/9699919799/functions/pthread_rwlock_wrlock.html
    // An in-depth discussion on this topic:
    // https://github.com/rust-lang/rust/issues/53127
    //
    // FIXME: Detect and report the deadlock proactively. (We currently
    // report the deadlock only when no thread can continue execution,
    // but we could detect that this lock is already locked and report
    // an error.)
    this_.rwlock_enqueue_and_block_writer(rwlock.rwlock_ref, ScalarNs.from_i32(0), dest);
  } else {
    const l = this_.rwlock_writer_lock(rwlock.rwlock_ref);
    if (l.$ === "Err") return l;
    const w = this_.write_null(dest);
    if (w.$ === "Err") return w;
  }

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:732 pthread_rwlock_trywrlock
InterpCx.prototype.pthread_rwlock_trywrlock = function (this: MiriInterpCx, rwlock_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const g = rwlock_get_data(this_, rwlock_op);
  if (g.$ === "Err") return g;
  const rwlock = clone_PthreadRwLock(g._0);

  if (rwlock.rwlock_ref.is_locked()) {
    return interp_ok(ScalarNs.from_i32(this_.eval_libc_i32("EBUSY")));
  } else {
    const l = this_.rwlock_writer_lock(rwlock.rwlock_ref);
    if (l.$ === "Err") return l;
    return interp_ok(ScalarNs.from_i32(0));
  }
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:745 pthread_rwlock_unlock
InterpCx.prototype.pthread_rwlock_unlock = function (this: MiriInterpCx, rwlock_op: OpTy): InterpResult {
  const this_ = this.eval_context_mut();

  const g = rwlock_get_data(this_, rwlock_op);
  if (g.$ === "Err") return g;
  const rwlock = clone_PthreadRwLock(g._0);

  const r = this_.rwlock_reader_unlock(rwlock.rwlock_ref);
  if (r.$ === "Err") return r;
  let unlocked = r._0;
  if (!unlocked) {
    const w = this_.rwlock_writer_unlock(rwlock.rwlock_ref);
    if (w.$ === "Err") return w;
    unlocked = w._0;
  }
  if (unlocked) {
    return interp_ok(undefined);
  } else {
    return throw_ub_format("unlocked an rwlock that was not locked by the active thread");
  }
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:759 pthread_rwlock_destroy
InterpCx.prototype.pthread_rwlock_destroy = function (this: MiriInterpCx, rwlock_op: OpTy): InterpResult {
  const this_ = this.eval_context_mut();

  // Reading the field also has the side-effect that we detect double-`destroy`
  // since we make the field uninit below.
  const g = rwlock_get_data(this_, rwlock_op);
  if (g.$ === "Err") return g;
  const rwlock = clone_PthreadRwLock(g._0);

  if (rwlock.rwlock_ref.is_locked()) {
    return throw_ub_format("destroyed a locked rwlock");
  }

  // This write also deletes the interpreter state for this rwlock.
  // This might lead to false positives, see comment in pthread_mutexattr_destroy
  const p = this_.deref_pointer_as(rwlock_op, this_.libc_ty_layout("pthread_rwlock_t"));
  if (p.$ === "Err") return p;
  const rwlock_place = p._0;
  const w = this_.write_uninit(rwlock_place);
  if (w.$ === "Err") return w;

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:779 pthread_condattr_init
InterpCx.prototype.pthread_condattr_init = function (this: MiriInterpCx, attr_op: OpTy): InterpResult {
  const this_ = this.eval_context_mut();

  // no clock attribute on macOS
  if (target_os(this_).$ !== "MacOs") {
    // The default value of the clock attribute shall refer to the system
    // clock.
    // https://pubs.opengroup.org/onlinepubs/9699919799/functions/pthread_condattr_setclock.html
    const default_clock_id = this_.eval_libc_i32("CLOCK_REALTIME");
    const s = condattr_set_clock_id(this_, attr_op, default_clock_id);
    if (s.$ === "Err") return s;
  }

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:794 pthread_condattr_setclock
InterpCx.prototype.pthread_condattr_setclock = function (this: MiriInterpCx, attr_op: OpTy, clock_id_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const c = this_.read_scalar(clock_id_op);
  if (c.$ === "Err") return c;
  const clock_id = c._0;
  if (this_.parse_clockid(clock_id) !== undefined) {
    const i = ScalarNs.to_i32(clock_id);
    if (i.$ === "Err") return i;
    const s = condattr_set_clock_id(this_, attr_op, i._0);
    if (s.$ === "Err") return s;
  } else {
    const einval = this_.eval_libc_i32("EINVAL");
    return interp_ok(ScalarNs.from_i32(einval));
  }

  return interp_ok(ScalarNs.from_i32(0));
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:812 pthread_condattr_getclock
InterpCx.prototype.pthread_condattr_getclock = function (this: MiriInterpCx, attr_op: OpTy, clk_id_op: OpTy): InterpResult {
  const this_ = this.eval_context_mut();

  const c = condattr_get_clock_id(this_, attr_op);
  if (c.$ === "Err") return c;
  const clock_id = c._0;
  const p = this_.deref_pointer_as(clk_id_op, this_.libc_ty_layout("clockid_t"));
  if (p.$ === "Err") return p;
  const w = this_.write_scalar(clock_id, p._0);
  if (w.$ === "Err") return w;

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:828 pthread_condattr_destroy
InterpCx.prototype.pthread_condattr_destroy = function (this: MiriInterpCx, attr_op: OpTy): InterpResult {
  const this_ = this.eval_context_mut();

  // Destroying an uninit pthread_condattr is UB, so check to make sure it's not uninit.
  // There's no clock attribute on macOS.
  if (target_os(this_).$ !== "MacOs") {
    const c = condattr_get_clock_id(this_, attr_op);
    if (c.$ === "Err") return c;
  }

  // De-init the entire thing.
  // This might lead to false positives, see comment in pthread_mutexattr_destroy
  const p = this_.deref_pointer_as(attr_op, this_.libc_ty_layout("pthread_condattr_t"));
  if (p.$ === "Err") return p;
  const w = this_.write_uninit(p._0);
  if (w.$ === "Err") return w;

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:846 pthread_cond_init
InterpCx.prototype.pthread_cond_init = function (this: MiriInterpCx, cond_op: OpTy, attr_op: OpTy): InterpResult {
  const this_ = this.eval_context_mut();

  const a = this_.read_pointer(attr_op);
  if (a.$ === "Err") return a;
  const attr = a._0;
  // Default clock if `attr` is null, and on macOS where there is no clock attribute.
  const n = this_.ptr_is_null(attr);
  if (n.$ === "Err") return n;
  let clock_id: Scalar;
  if (n._0 || target_os(this_).$ === "MacOs") {
    clock_id = this_.eval_libc("CLOCK_REALTIME");
  } else {
    const c = condattr_get_clock_id(this_, attr_op);
    if (c.$ === "Err") return c;
    clock_id = c._0;
  }
  const clock = this_.parse_clockid(clock_id);
  if (clock === undefined) {
    // This is UB since this situation cannot arise when using pthread_condattr_setclock.
    return throw_ub_format("pthread_cond_init: invalid attributes (unsupported clock)");
  }

  const c = cond_create(this_, cond_op, clock);
  if (c.$ === "Err") return c;

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:870 pthread_cond_signal
InterpCx.prototype.pthread_cond_signal = function (this: MiriInterpCx, cond_op: OpTy): InterpResult {
  const this_ = this.eval_context_mut();
  const g = cond_get_data(this_, cond_op);
  if (g.$ === "Err") return g;
  const condvar = clone_CondvarRef(g._0.condvar_ref);
  const s = this_.condvar_signal(condvar);
  if (s.$ === "Err") return s;
  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:877 pthread_cond_broadcast
InterpCx.prototype.pthread_cond_broadcast = function (this: MiriInterpCx, cond_op: OpTy): InterpResult {
  const this_ = this.eval_context_mut();
  const g = cond_get_data(this_, cond_op);
  if (g.$ === "Err") return g;
  const condvar = clone_CondvarRef(g._0.condvar_ref);
  for (;;) {
    const s = this_.condvar_signal(condvar);
    if (s.$ === "Err") return s;
    if (!s._0) break;
  }
  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:884 pthread_cond_wait
InterpCx.prototype.pthread_cond_wait = function (this: MiriInterpCx, cond_op: OpTy, mutex_op: OpTy, dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();

  const d = cond_get_data(this_, cond_op);
  if (d.$ === "Err") return d;
  const data = clone_PthreadCondvar(d._0);
  const m = mutex_get_data(this_, mutex_op);
  if (m.$ === "Err") return m;
  const mutex_ref = clone_MutexRef(m._0.mutex_ref);

  const w = this_.condvar_wait(
    data.condvar_ref,
    mutex_ref,
    undefined, // no timeout
    ScalarNs.from_i32(0),
    ScalarNs.from_i32(0), // retval_timeout -- unused
    dest,
  );
  if (w.$ === "Err") return w;

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:907 pthread_cond_timedwait
InterpCx.prototype.pthread_cond_timedwait = function (
  this: MiriInterpCx,
  cond_op: OpTy,
  mutex_op: OpTy,
  timeout_op: OpTy,
  dest: MPlaceTy,
  macos_relative_np: boolean,
): InterpResult {
  const this_ = this.eval_context_mut();

  const d = cond_get_data(this_, cond_op);
  if (d.$ === "Err") return d;
  const data = clone_PthreadCondvar(d._0);
  const m = mutex_get_data(this_, mutex_op);
  if (m.$ === "Err") return m;
  const mutex_ref = clone_MutexRef(m._0.mutex_ref);

  // Extract the timeout.
  const p = this_.deref_pointer_as(timeout_op, this_.libc_ty_layout("timespec"));
  if (p.$ === "Err") return p;
  const t = this_.read_timespec(p._0);
  if (t.$ === "Err") return t;
  const duration = t._0;
  if (duration === undefined) {
    const einval = this_.eval_libc("EINVAL");
    const w = this_.write_scalar(einval, dest);
    if (w.$ === "Err") return w;
    return interp_ok(undefined);
  }

  let clock: TimeoutClock;
  let style: TimeoutStyle;
  if (macos_relative_np) {
    // `pthread_cond_timedwait_relative_np` always measures time against the
    // monotonic clock, regardless of the condvar clock.
    [clock, style] = ["Monotonic", "Relative"];
  } else {
    if (data.clock === "RealTime") {
      const c = this_.check_no_isolation("`pthread_cond_timedwait` with `CLOCK_REALTIME`");
      if (c.$ === "Err") return c;
    }

    [clock, style] = [data.clock, "Absolute"];
  }

  const w = this_.condvar_wait(
    data.condvar_ref,
    mutex_ref,
    this_.machine.timeout(clock, style, duration),
    ScalarNs.from_i32(0),
    this_.eval_libc("ETIMEDOUT"), // retval_timeout
    dest,
  );
  if (w.$ === "Err") return w;

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/sync.rs:953 pthread_cond_destroy
InterpCx.prototype.pthread_cond_destroy = function (this: MiriInterpCx, cond_op: OpTy): InterpResult {
  const this_ = this.eval_context_mut();

  // Reading the field also has the side-effect that we detect double-`destroy`
  // since we make the field uninit below.
  const g = cond_get_data(this_, cond_op);
  if (g.$ === "Err") return g;
  const condvar = g._0.condvar_ref;
  if (!condvar.queue_is_empty()) {
    return throw_ub_format("destroying an awaited conditional variable");
  }

  // This write also deletes the interpreter state for this mutex.
  // This might lead to false positives, see comment in pthread_mutexattr_destroy
  const p = this_.deref_pointer_as(cond_op, this_.libc_ty_layout("pthread_cond_t"));
  if (p.$ === "Err") return p;
  const cond_place = p._0;
  const w = this_.write_uninit(cond_place);
  if (w.$ === "Err") return w;

  return interp_ok(undefined);
};
