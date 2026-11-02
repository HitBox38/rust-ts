// Port of src/tools/miri/src/shims/unix/linux_like/sync.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-shims-e` (plan-m6
// wave 37). Its types are generated into sync.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT decisions (docs/handoff/miri-shims-e.md):
// - `LinuxFutex` is a generated class (set `miri`'s `class` list; exact `instanceof` type test for `get_sync_or_init`, as
//   unix/sync.ts); `impl SyncObj for LinuxFutex {}` installs `SyncObj_provided` with `port_methods` (C10).
// - `shim_varargs![..]` is shims/sig.ts's `shim_varargs(..tys)` (string type specs).
import { type Deadline } from "../../../clock.ts";
import { clone_FutexRef, FutexRef, type SyncObj, SyncObj_provided } from "../../../concurrency/sync.ts";
import { type UnblockKind } from "../../../concurrency/thread.ts";
import { type MPlaceTy, type OpTy } from "../../../lib.ts";
import { callback, type MiriInterpCx } from "../../../machine.ts";
import { VisitProvenance_MPlaceTy } from "../../../provenance_gc.ts";
import { shim_varargs } from "../../sig.ts";
import { type Varargs } from "../../sig.ts";
import { LinuxFutex } from "./sync.gen.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Scalar as ScalarNs } from "../../../../rustc_middle/mir/interpret/mod.ts";
import { type Ty } from "../../../../rustc_middle/ty/mod.ts";
import { panic } from "../../../../std/panic.ts";
import { Err } from "../../../../std/result.ts";
import { port_methods } from "../../../../rust_ts/miri_stub.ts";
export * from "./sync.gen.ts";

/** `throw_ub_format!(..)` (`err_ub!(Ub(format!(..)))`) */
function throw_ub_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } }));
}
/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}
/** `u32::MAX` */
const U32_MAX = 0xffff_ffff;
/** `usize::try_from(u32).unwrap()` / `isize::try_from(usize).unwrap()` of values that fit (64-bit target). */
function try_into_unwrap(v: number): number {
  if (!Number.isSafeInteger(v) || v < 0) panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
  return v;
}

declare module "./sync.gen.ts" {
  interface LinuxFutex extends SyncObj {}
}
// impl SyncObj for LinuxFutex {}
port_methods("miri::shims::unix::linux_like::sync::SyncObj for LinuxFutex", () => LinuxFutex.prototype, SyncObj_provided);
/** `downcast_ref::<LinuxFutex>()`'s exact type test. */
const is_LinuxFutex = (v: SyncObj): v is LinuxFutex => v instanceof LinuxFutex;

/// Implementation of the SYS_futex syscall.
/// `args` is the arguments *including* the syscall number.
// rustc: src/tools/miri/src/shims/unix/linux_like/sync.rs:13 futex
export function futex(ecx: MiriInterpCx, varargs_: Varargs, dest: MPlaceTy): InterpResult {
  const c = ecx.check_varargs(shim_varargs("*u32", "i32", "u32"), varargs_, "syscall(SYS_futex, ...)");
  if (c.$ === "Err") return c;
  const [[addr_op, op_op, val_op], varargs] = [c._0[0], c._0[1]];

  // See <https://man7.org/linux/man-pages/man2/futex.2.html> for docs.
  // The first three arguments (after the syscall number itself) are the same to all futex operations:
  //     (uint32_t *addr, int op, uint32_t val).
  // We checked above that these definitely exist.
  const a = ecx.read_pointer(addr_op);
  if (a.$ === "Err") return a;
  const addr_ptr = a._0;
  const o = ecx.read_scalar(op_op);
  if (o.$ === "Err") return o;
  const oi = ScalarNs.to_i32(o._0);
  if (oi.$ === "Err") return oi;
  const op = oi._0;
  const v = ecx.read_scalar(val_op);
  if (v.$ === "Err") return v;
  const vu = ScalarNs.to_u32(v._0);
  if (vu.$ === "Err") return vu;
  const val = vu._0;

  // This is a vararg function so we have to bring our own type for this pointer.
  const addr = ecx.ptr_to_mplace(addr_ptr, ecx.machine.layouts.i32);

  const futex_private = ecx.eval_libc_i32("FUTEX_PRIVATE_FLAG");
  const futex_wait = ecx.eval_libc_i32("FUTEX_WAIT");
  const futex_wait_bitset = ecx.eval_libc_i32("FUTEX_WAIT_BITSET");
  const futex_wake = ecx.eval_libc_i32("FUTEX_WAKE");
  const futex_wake_bitset = ecx.eval_libc_i32("FUTEX_WAKE_BITSET");
  const futex_realtime = ecx.eval_libc_i32("FUTEX_CLOCK_REALTIME");

  // FUTEX_PRIVATE enables an optimization that stops it from working across processes.
  // Miri doesn't support that anyway, so we ignore that flag.
  const op_ = op & ~futex_private;
  // FUTEX_WAIT: (int *addr, int op = FUTEX_WAIT, int val, const timespec *timeout)
  // Blocks the thread if *addr still equals val. Wakes up when FUTEX_WAKE is called on the same address,
  // or *timeout expires. `timeout == null` for an infinite timeout.
  //
  // FUTEX_WAIT_BITSET: (int *addr, int op = FUTEX_WAIT_BITSET, int val, const timespec *timeout, int *_ignored, unsigned int bitset)
  // This is identical to FUTEX_WAIT, except:
  //  - The timeout is absolute rather than relative.
  //  - You can specify the bitset to selecting what WAKE operations to respond to.
  if ((op_ & ~futex_realtime) === futex_wait || (op_ & ~futex_realtime) === futex_wait_bitset) {
    const op = op_;
    const wait_bitset = (op & ~futex_realtime) === futex_wait_bitset;

    let timeout_op: OpTy;
    let bitset: number;
    if (wait_bitset) {
      const c = ecx.check_varargs(shim_varargs("*libc::timespec", "*u32", "u32"), varargs, "syscall(SYS_futex, ...)");
      if (c.$ === "Err") return c;
      const [timeout, uaddr2_op, bitset_op] = c._0[0];
      const u = ecx.read_pointer(uaddr2_op);
      if (u.$ === "Err") return u;
      const uaddr2 = u._0;
      const n = ecx.ptr_is_null(uaddr2);
      if (n.$ === "Err") return n;
      if (!n._0) {
        return throw_ub_format("`uaddr2` pointer must be null for `FUTEX_WAIT_BITSET`");
      }
      const b = ecx.read_scalar(bitset_op);
      if (b.$ === "Err") return b;
      const bu = ScalarNs.to_u32(b._0);
      if (bu.$ === "Err") return bu;
      [timeout_op, bitset] = [timeout, bu._0];
    } else {
      const c = ecx.check_varargs(shim_varargs("*libc::timespec"), varargs, "syscall(SYS_futex, ...)");
      if (c.$ === "Err") return c;
      const [timeout] = c._0[0];
      [timeout_op, bitset] = [timeout, U32_MAX];
    }

    if (bitset === 0) {
      return ecx.set_errno_and_return_neg1({ $: "LibcError", _0: "EINVAL" }, dest);
    }

    const t = ecx.deref_pointer_as(timeout_op, ecx.libc_ty_layout("timespec"));
    if (t.$ === "Err") return t;
    const timeout = t._0;
    const tn = ecx.ptr_is_null(timeout.ptr());
    if (tn.$ === "Err") return tn;
    let deadline: Deadline | undefined;
    if (tn._0) {
      deadline = undefined;
    } else {
      const r = ecx.read_timespec(timeout);
      if (r.$ === "Err") return r;
      const duration = r._0;
      if (duration === undefined) {
        return ecx.set_errno_and_return_neg1({ $: "LibcError", _0: "EINVAL" }, dest);
      }
      let timeout_clock: "RealTime" | "Monotonic";
      if ((op & futex_realtime) === futex_realtime) {
        const i = ecx.check_no_isolation("`futex` syscall with `op=FUTEX_WAIT` and non-null timeout with `FUTEX_CLOCK_REALTIME`");
        if (i.$ === "Err") return i;
        timeout_clock = "RealTime";
      } else {
        timeout_clock = "Monotonic";
      }
      const timeout_style = wait_bitset
        ? // FUTEX_WAIT_BITSET uses an absolute timestamp.
          "Absolute"
        : // FUTEX_WAIT uses a relative timestamp.
          "Relative";
      deadline = ecx.machine.timeout(timeout_clock, timeout_style, duration);
    }
    // There may be a concurrent thread changing the value of addr
    // and then invoking the FUTEX_WAKE syscall. It is critical that the
    // effects of this and the other thread are correctly observed,
    // otherwise we will deadlock.
    //
    // There are two scenarios to consider, depending on whether WAIT or WAKE goes first:
    // 1. If we (FUTEX_WAIT) execute first, we'll push ourselves into the waiters queue and
    //    go to sleep. They (FUTEX_WAKE) will see us in the queue and wake us up. It doesn't
    //    matter how the addr write is ordered.
    // 2. If they (FUTEX_WAKE) execute first, that means the addr write is also before us
    //    (FUTEX_WAIT). It is crucial that we observe addr's new value. If we see an
    //    outdated value that happens to equal the expected val, then we'll put ourselves to
    //    sleep with no one to wake us up, so we end up with a deadlock. This is prevented
    //    by having a SeqCst fence inside FUTEX_WAKE syscall, and another SeqCst fence here
    //    in FUTEX_WAIT. The atomic read on addr after the SeqCst fence is guaranteed not to
    //    see any value older than the addr write immediately before calling FUTEX_WAKE.
    //    We'll see futex_val != val and return without sleeping.
    //
    //    Note that the fences do not create any happens-before relationship.
    //    The read sees the write immediately before the fence not because
    //    one happens after the other, but is instead due to a guarantee unique
    //    to SeqCst fences that restricts what an atomic read placed AFTER the
    //    fence can see. The read still has to be atomic, otherwise it's a data
    //    race. This guarantee cannot be achieved with acquire-release fences
    //    since they only talk about reads placed BEFORE a fence - and places
    //    no restrictions on what the read itself can see, only that there is
    //    a happens-before between the fences IF the read happens to see the
    //    right value. This is useless to us, since we need the read itself
    //    to see an up-to-date value.
    //
    // The above case distinction is valid since both FUTEX_WAIT and FUTEX_WAKE
    // contain a SeqCst fence, therefore inducing a total order between the operations.
    // It is also critical that the fence, the atomic load, and the comparison in FUTEX_WAIT
    // altogether happen atomically. If the other thread's fence in FUTEX_WAKE
    // gets interleaved after our fence, then we lose the guarantee on the
    // atomic load being up-to-date; if the other thread's write on addr and FUTEX_WAKE
    // call are interleaved after the load but before the comparison, then we get a TOCTOU
    // race condition, and go to sleep thinking the other thread will wake us up,
    // even though they have already finished.
    //
    // Thankfully, preemptions cannot happen inside a Miri shim, so we do not need to
    // do anything special to guarantee fence-load-comparison atomicity.
    const f = ecx.atomic_fence("SeqCst");
    if (f.$ === "Err") return f;
    // Read an `i32` through the pointer, regardless of any wrapper types.
    // It's not uncommon for `addr` to be passed as another type than `*mut i32`, such as `*const AtomicI32`.
    // We do an acquire read -- it only seems reasonable that if we observe a value here, we
    // actually establish an ordering with that value.
    const fr = ecx.read_scalar_atomic(addr, "Acquire");
    if (fr.$ === "Err") return fr;
    const fu = ScalarNs.to_u32(fr._0);
    if (fu.$ === "Err") return fu;
    const futex_val = fu._0;
    if (val === futex_val) {
      // The value still matches, so we block the thread and make it wait for FUTEX_WAKE.

      // This cannot fail since we already did an atomic acquire read on that pointer.
      // Acquire reads are only allowed on mutable memory.
      const futex_obj = ecx.get_sync_or_init(addr.ptr(), is_LinuxFutex, (_) => new LinuxFutex(FutexRef.new()));
      if (futex_obj === undefined) panic("called `Option::unwrap()` on a `None` value");
      const futex_ref = clone_FutexRef(futex_obj.futex);

      ecx.futex_wait(
        futex_ref,
        bitset,
        deadline,
        // callback!(@capture<'tcx> { dest: MPlaceTy<'tcx> } |ecx, unblock: UnblockKind| ..)
        callback<{ dest: MPlaceTy }, UnblockKind>({ dest: [dest, VisitProvenance_MPlaceTy] }, (ecx, unblock, { dest }) => {
          switch (unblock) {
            case "Ready":
              return ecx.write_int(0n, dest);
            case "TimedOut":
              return ecx.set_errno_and_return_neg1({ $: "LibcError", _0: "ETIMEDOUT" }, dest);
          }
        }),
      );
    } else {
      // The futex value doesn't match the expected value, so we return failure
      // right away without sleeping: -1 and errno set to EAGAIN.
      return ecx.set_errno_and_return_neg1({ $: "LibcError", _0: "EAGAIN" }, dest);
    }
  }
  // FUTEX_WAKE: (int *addr, int op = FUTEX_WAKE, int val)
  // Wakes at most `val` threads waiting on the futex at `addr`.
  // Returns the amount of threads woken up.
  // Does not access the futex value at *addr.
  // FUTEX_WAKE_BITSET: (int *addr, int op = FUTEX_WAKE, int val, const timespect *_unused, int *_unused, unsigned int bitset)
  // Same as FUTEX_WAKE, but allows you to specify a bitset to select which threads to wake up.
  else if (op_ === futex_wake || op_ === futex_wake_bitset) {
    const op = op_;
    const futex_obj = ecx.get_sync_or_init(addr.ptr(), is_LinuxFutex, (_) => new LinuxFutex(FutexRef.new()));
    if (futex_obj === undefined) {
      // No AllocId, or no live allocation at that AllocId.
      // Return an error code. (That seems nicer than silently doing something non-intuitive.)
      // This means that if an address gets reused by a new allocation,
      // we'll use an independent futex queue for this... that seems acceptable.
      return ecx.set_errno_and_return_neg1({ $: "LibcError", _0: "EFAULT" }, dest);
    }
    const futex_ref = clone_FutexRef(futex_obj.futex);

    let bitset: number;
    if (op === futex_wake_bitset) {
      const c = ecx.check_varargs(shim_varargs("*libc::timespec", "*u32", "u32"), varargs, "syscall(SYS_futex, ...)");
      if (c.$ === "Err") return c;
      const [timeout_op, uaddr2_op, bitset_op] = c._0[0];
      const t = ecx.read_pointer(timeout_op);
      if (t.$ === "Err") return t;
      const tn = ecx.ptr_is_null(t._0);
      if (tn.$ === "Err") return tn;
      if (!tn._0) {
        return throw_ub_format("`timeout` pointer must be null for `FUTEX_WAKE_BITSET`");
      }
      const u = ecx.read_pointer(uaddr2_op);
      if (u.$ === "Err") return u;
      const un = ecx.ptr_is_null(u._0);
      if (un.$ === "Err") return un;
      if (!un._0) {
        return throw_ub_format("`uaddr2` pointer must be null for `FUTEX_WAKE_BITSET`");
      }
      const b = ecx.read_scalar(bitset_op);
      if (b.$ === "Err") return b;
      const bu = ScalarNs.to_u32(b._0);
      if (bu.$ === "Err") return bu;
      bitset = bu._0;
    } else {
      bitset = U32_MAX;
    }
    if (bitset === 0) {
      return ecx.set_errno_and_return_neg1({ $: "LibcError", _0: "EINVAL" }, dest);
    }
    // Together with the SeqCst fence in futex_wait, this makes sure that futex_wait
    // will see the latest value on addr which could be changed by our caller
    // before doing the syscall.
    const f = ecx.atomic_fence("SeqCst");
    if (f.$ === "Err") return f;
    const w = ecx.futex_wake(futex_ref, bitset, try_into_unwrap(val));
    if (w.$ === "Err") return w;
    const woken = w._0;
    const ws = ecx.write_scalar(ScalarNs.from_target_isize(BigInt(try_into_unwrap(woken)), ecx), dest);
    if (ws.$ === "Err") return ws;
  } else {
    return throw_unsup_format(`Miri does not support \`futex\` syscall with op=${op_}`);
  }

  return interp_ok(undefined);
}
