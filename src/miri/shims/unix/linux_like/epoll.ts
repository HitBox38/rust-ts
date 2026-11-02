// Port of src/tools/miri/src/shims/unix/linux_like/epoll.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-shims-e` (plan-m6
// wave 37). Its types are generated into epoll.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT decisions (docs/handoff/miri-shims-e.md), as in eventfd.ts:
// - `Epoll` is a generated class (set `miri`'s `class` list: exact type test for `downcast::<Epoll>()`); its trait impls
//   are installed on the prototype with `port_methods` (C10), the provided methods it does not override being
//   `FileDescription_provided` / `UnixFileDescription_provided`'s.
// - `FileDescriptionRef`s are owned strong handles, `drop()`ped where Rust drops them (reverse declaration order at scope
//   end, via `try`/`finally`), moved into `callback!` captures. `watcher: Rc<ReadinessWatcher>` follows readiness.ts's Rc
//   protocol: `Rc::new(ReadinessWatcher::default())` is `Rc_new_ReadinessWatcher()`, and dropping the `Epoll` drops the
//   `Rc` (`drop_glue`).
// - `u32` bit operations are kept unsigned with `>>> 0` (`EPOLLET` is bit 31).
import { Deadline } from "../../../clock.ts";
import { type UnblockKind } from "../../../concurrency/thread.ts";
import { type MPlaceTy, type OpTy, type Scalar } from "../../../lib.ts";
import { callback, type MiriInterpCx } from "../../../machine.ts";
import { type VisitProvenanceImpl, VisitProvenance_MPlaceTy } from "../../../provenance_gc.ts";
import { type FileDescription, FileDescription_provided, type FileDescriptionRef } from "../../files.ts";
import { type Readiness, type ReadinessInterest, type ReadinessInterestKey, Rc_drop_ReadinessWatcher, Rc_new_ReadinessWatcher } from "../../readiness.ts";
import { type UnixFileDescription, UnixFileDescription_provided } from "../fd.ts";
import { Epoll } from "./epoll.gen.ts";
import { FieldIdx } from "../../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../../rustc_const_eval/interpret/machine.ts";
import { type Either } from "../../../../rustc_middle/mir/mod.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Scalar as ScalarNs } from "../../../../rustc_middle/mir/interpret/mod.ts";
import { type Pending } from "../../../../rustc_type_ir/decls.ts";
import { type IoError as io_Error } from "../../../../std/io.ts";
import { assert, panic } from "../../../../std/panic.ts";
import { Err, type Result } from "../../../../std/result.ts";
import { Duration } from "../../../../std/time.ts";
import { port_methods } from "../../../../rust_ts/miri_stub.ts";
export * from "./epoll.gen.ts";

declare module "../../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/unix/linux_like/epoll.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/linux_like/epoll.rs:45
    epoll_create1(this: MiriInterpCx, flags: OpTy): InterpResult<Scalar>;
    // shims/unix/linux_like/epoll.rs:78
    epoll_ctl(this: MiriInterpCx, epfd: OpTy, op: OpTy, fd: OpTy, event: OpTy): InterpResult<Scalar>;
    // shims/unix/linux_like/epoll.rs:230
    epoll_wait(this: MiriInterpCx, epfd: OpTy, events_op: OpTy, maxevents: OpTy, timeout: OpTy, dest: MPlaceTy): InterpResult;
    // ---- shims/unix/linux_like/epoll.rs: `trait EvalContextPrivExt` (impl for `MiriInterpCx`) ----
    // shims/unix/linux_like/epoll.rs:323
    readiness_to_epoll_bitflag(this: MiriInterpCx, readiness: Readiness): number;
    // shims/unix/linux_like/epoll.rs:353
    epoll_bitflag_to_readiness(this: MiriInterpCx, bitflag: number): Readiness;
    // shims/unix/linux_like/epoll.rs:373
    return_ready_list(this: MiriInterpCx, epfd: FileDescriptionRef<Epoll>, dest: MPlaceTy, events: MPlaceTy): InterpResult<number>;
  }
}

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}
/** `{:#x}` of an `i32` / `u32` (two's complement for `i32`, as Rust's `LowerHex`). */
function hex32(v: number): string {
  return `0x${(v >>> 0).toString(16)}`;
}
/** `a & b` / `a | b` / `!a` on `u32` */
const and = (a: number, b: number): number => (a & b) >>> 0;
const or = (a: number, b: number): number => (a | b) >>> 0;
const not = (a: number): number => ~a >>> 0;
/** The `VisitProvenance` impl of a captured `FileDescriptionRef<T>` (files.rs:101, lane miri-shims-b). */
const VisitProvenance_FileDescriptionRef: VisitProvenanceImpl<FileDescriptionRef<Epoll>> = {
  visit_provenance: (self, visit) => self.visit_provenance(visit),
};

/// An `Epoll` file descriptor connects file handles and epoll events
// #[derive(Debug)] struct Epoll (generated class: set `miri`'s `class` list)
declare module "./epoll.gen.ts" {
  interface Epoll extends UnixFileDescription {}
}

// impl FileDescription for Epoll (the provided methods it does not override are `FileDescription_provided`'s)
port_methods("miri::shims::unix::linux_like::epoll::FileDescription for Epoll", () => Epoll.prototype, {
  ...FileDescription_provided,

  // rustc: src/tools/miri/src/shims/unix/linux_like/epoll.rs:20 name
  name(this: Epoll): string {
    return "epoll";
  },

  // rustc: src/tools/miri/src/shims/unix/linux_like/epoll.rs:24 metadata
  metadata(this: Epoll): InterpResult<Either<Result<Pending<"fs::Metadata">, io_Error>, string>> {
    // On Linux, epoll is an "anonymous inode" reported as S_IFREG.
    return interp_ok({ $: "Right", _0: "S_IFREG" });
  },

  // rustc: src/tools/miri/src/shims/unix/linux_like/epoll.rs:31 as_unix
  as_unix(this: Epoll, self_: FileDescriptionRef<FileDescription>): FileDescriptionRef<UnixFileDescription> {
    // PORT: the unsizing `FileDescriptionRef<Self> -> FileDescriptionRef<dyn UnixFileDescription>` (a move).
    return self_ as unknown as FileDescriptionRef<UnixFileDescription>;
  },

  /** Drop glue of `Epoll` (no `Drop` impl of its own): drops `watcher: Rc<ReadinessWatcher>`. */
  drop_glue(this: Epoll): void {
    Rc_drop_ReadinessWatcher(this.watcher);
  },
} satisfies FileDescription & ThisType<Epoll>);

// impl UnixFileDescription for Epoll {}
port_methods("miri::shims::unix::linux_like::epoll::UnixFileDescription for Epoll", () => Epoll.prototype, UnixFileDescription_provided);

/** `downcast::<Epoll>()`'s exact type test. */
export const is_Epoll = (v: FileDescription): v is Epoll => v instanceof Epoll;

// ---------------------------------------------------------------- EvalContextExt ----

/// This function returns a file descriptor referring to the new `Epoll` instance. This file
/// descriptor is used for all subsequent calls to the epoll interface. If the `flags` argument
/// is 0, then this function is the same as `epoll_create()`.
///
/// <https://linux.die.net/man/2/epoll_create1>
// rustc: src/tools/miri/src/shims/unix/linux_like/epoll.rs:45 epoll_create1
InterpCx.prototype.epoll_create1 = function (this: MiriInterpCx, flags_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const f = this_.read_scalar(flags_op);
  if (f.$ === "Err") return f;
  const fi = ScalarNs.to_i32(f._0);
  if (fi.$ === "Err") return fi;
  const flags = fi._0;

  const epoll_cloexec = this_.eval_libc_i32("EPOLL_CLOEXEC");

  // Miri does not support exec, so EPOLL_CLOEXEC flag has no effect.
  if (flags !== epoll_cloexec && flags !== 0) {
    return throw_unsup_format(`epoll_create1: flag ${hex32(flags)} is unsupported, only 0 or EPOLL_CLOEXEC are allowed`);
  }

  const fd = this_.machine.fds.insert_new(new Epoll(Rc_new_ReadinessWatcher()));
  return interp_ok(ScalarNs.from_i32(fd));
};

/// This function performs control operations on the `Epoll` instance referred to by the file
/// descriptor `epfd`. It requests that the operation `op` be performed for the target file
/// descriptor, `fd`.
///
/// Valid values for the op argument are:
/// `EPOLL_CTL_ADD` - Register the target file descriptor `fd` on the `Epoll` instance referred
/// to by the file descriptor `epfd` and associate the event `event` with the internal file
/// linked to `fd`.
/// `EPOLL_CTL_MOD` - Change the event `event` associated with the target file descriptor `fd`.
/// `EPOLL_CTL_DEL` - Deregister the target file descriptor `fd` from the `Epoll` instance
/// referred to by `epfd`. The `event` is ignored and can be null.
///
/// <https://linux.die.net/man/2/epoll_ctl>
// rustc: src/tools/miri/src/shims/unix/linux_like/epoll.rs:78 epoll_ctl
InterpCx.prototype.epoll_ctl = function (this: MiriInterpCx, epfd_op: OpTy, op_op: OpTy, fd_op: OpTy, event_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const e = this_.read_scalar(epfd_op);
  if (e.$ === "Err") return e;
  const ei = ScalarNs.to_i32(e._0);
  if (ei.$ === "Err") return ei;
  const epfd_value = ei._0;
  const o = this_.read_scalar(op_op);
  if (o.$ === "Err") return o;
  const oi = ScalarNs.to_i32(o._0);
  if (oi.$ === "Err") return oi;
  const op = oi._0;
  const f = this_.read_scalar(fd_op);
  if (f.$ === "Err") return f;
  const fi = ScalarNs.to_i32(f._0);
  if (fi.$ === "Err") return fi;
  const fd = fi._0;
  const ev = this_.deref_pointer_as(event_op, this_.libc_ty_layout("epoll_event"));
  if (ev.$ === "Err") return ev;
  const event = ev._0;

  const epoll_ctl_add = this_.eval_libc_i32("EPOLL_CTL_ADD");
  const epoll_ctl_mod = this_.eval_libc_i32("EPOLL_CTL_MOD");
  const epoll_ctl_del = this_.eval_libc_i32("EPOLL_CTL_DEL");
  const epollin = this_.eval_libc_u32("EPOLLIN");
  const epollout = this_.eval_libc_u32("EPOLLOUT");
  const epollrdhup = this_.eval_libc_u32("EPOLLRDHUP");
  const epollet = this_.eval_libc_u32("EPOLLET");
  const epollhup = this_.eval_libc_u32("EPOLLHUP");
  const epollerr = this_.eval_libc_u32("EPOLLERR");

  // Throw EFAULT if epfd and fd have the same value.
  if (epfd_value === fd) {
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EFAULT" });
  }

  // Check if epfd is a valid epoll file descriptor.
  const epfd_dyn = this_.machine.fds.get(epfd_value);
  if (epfd_dyn === undefined) {
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EBADF" });
  }
  const epfd = epfd_dyn.downcast(is_Epoll);
  if (epfd === undefined) {
    // `.ok_or_else(|| err_unsup_format!("non-epoll FD passed to `epoll_ctl`"))?`
    return throw_unsup_format("non-epoll FD passed to `epoll_ctl`");
  }
  try {
    const fd_ref = this_.machine.fds.get(fd);
    if (fd_ref === undefined) {
      return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EBADF" });
    }
    try {
      const id = fd_ref.id();
      const interest_key: ReadinessInterestKey = [id, fd];

      if (op === epoll_ctl_add || op === epoll_ctl_mod) {
        // Read event bitmask and data from epoll_event passed by caller.
        const p0 = this_.project_field(event, FieldIdx.ZERO);
        if (p0.$ === "Err") return p0;
        const r0 = this_.read_scalar(p0._0);
        if (r0.$ === "Err") return r0;
        const u0 = ScalarNs.to_u32(r0._0);
        if (u0.$ === "Err") return u0;
        let relevant_bitflag = u0._0;
        const p1 = this_.project_field(event, FieldIdx.ONE);
        if (p1.$ === "Err") return p1;
        const r1 = this_.read_scalar(p1._0);
        if (r1.$ === "Err") return r1;
        const u1 = ScalarNs.to_u64(r1._0);
        if (u1.$ === "Err") return u1;
        const data = u1._0;

        let is_edge_triggered: boolean;
        if (and(relevant_bitflag, epollet) === epollet) {
          relevant_bitflag = and(relevant_bitflag, not(epollet));
          is_edge_triggered = true;
        } else {
          is_edge_triggered = false;
        }

        // Unset the flag we support to discover if any unsupported flags are used.
        let flags = relevant_bitflag;
        // epoll_wait(2) will always wait for epollhup and epollerr; it is not
        // necessary to set it in events when calling epoll_ctl().
        // So we will always set these two event types.
        relevant_bitflag = or(relevant_bitflag, epollhup);
        relevant_bitflag = or(relevant_bitflag, epollerr);

        if (and(flags, epollin) === epollin) {
          flags = and(flags, not(epollin));
        }
        if (and(flags, epollout) === epollout) {
          flags = and(flags, not(epollout));
        }
        if (and(flags, epollrdhup) === epollrdhup) {
          flags = and(flags, not(epollrdhup));
        }
        if (and(flags, epollhup) === epollhup) {
          flags = and(flags, not(epollhup));
        }
        if (and(flags, epollerr) === epollerr) {
          flags = and(flags, not(epollerr));
        }
        if (flags !== 0) {
          return throw_unsup_format(`epoll_ctl: encountered unknown unsupported flags ${hex32(flags)}`);
        }

        const relevant = this_.epoll_bitflag_to_readiness(relevant_bitflag);

        if (op === epoll_ctl_add) {
          // Add a new interest to the watcher.
          const r = epfd.deref().watcher.add_interest(fd, relevant, is_edge_triggered, data, this_);
          if (r.$ === "Err") return r;
          const result = r._0;
          if (result.$ === "Err") {
            // We already had an interest in this.
            return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EEXIST" });
          }
        } else {
          // Modify the existing interest.
          const r = epfd.deref().watcher.update_interest(interest_key, this_, (interest: ReadinessInterest) => {
            interest.is_edge_triggered = is_edge_triggered;
            interest.relevant = relevant;
            interest.data = data;
          });
          if (r.$ === "Err") return r;
          const result = r._0;
          if (result === undefined) {
            // There is no interest registered for the specified key.
            return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "ENOENT" });
          }
        }
      } else if (op === epoll_ctl_del) {
        if (epfd.deref().watcher.remove_interest(interest_key) === undefined) {
          // We did not have interest in this.
          return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "ENOENT" });
        }
      } else {
        return throw_unsup_format(`unsupported epoll_ctl operation: ${op}`);
      }

      return interp_ok(ScalarNs.from_i32(0));
    } finally {
      fd_ref.drop();
    }
  } finally {
    epfd.drop();
  }
};

/// The `epoll_wait()` system call waits for events on the `Epoll`
/// instance referred to by the file descriptor `epfd`. The buffer
/// pointed to by `events` is used to return information from the ready
/// list about file descriptors in the interest list that have some
/// events available. Up to `maxevents` are returned by `epoll_wait()`.
/// The `maxevents` argument must be greater than zero.
///
/// The `timeout` argument specifies the number of milliseconds that
/// `epoll_wait()` will block. Time is measured against the
/// CLOCK_MONOTONIC clock. If the timeout is zero, the function will not block,
/// while if the timeout is -1, the function will block
/// until at least one event has been retrieved (or an error
/// occurred).
///
/// A call to `epoll_wait()` will block until either:
/// • a file descriptor delivers an event;
/// • the call is interrupted by a signal handler; or
/// • the timeout expires.
///
/// Note that the timeout interval will be rounded up to the system
/// clock granularity, and kernel scheduling delays mean that the
/// blocking interval may overrun by a small amount. Specifying a
/// timeout of -1 causes `epoll_wait()` to block indefinitely, while
/// specifying a timeout equal to zero cause `epoll_wait()` to return
/// immediately, even if no events are available.
///
/// On success, `epoll_wait()` returns the number of file descriptors
/// ready for the requested I/O, or zero if no file descriptor became
/// ready during the requested timeout milliseconds. On failure,
/// `epoll_wait()` returns -1 and errno is set to indicate the error.
///
/// <https://man7.org/linux/man-pages/man2/epoll_wait.2.html>
// rustc: src/tools/miri/src/shims/unix/linux_like/epoll.rs:230 epoll_wait
InterpCx.prototype.epoll_wait = function (
  this: MiriInterpCx,
  epfd_op: OpTy,
  events_op: OpTy,
  maxevents_op: OpTy,
  timeout_op: OpTy,
  dest: MPlaceTy,
): InterpResult {
  const this_ = this.eval_context_mut();

  const e = this_.read_scalar(epfd_op);
  if (e.$ === "Err") return e;
  const ei = ScalarNs.to_i32(e._0);
  if (ei.$ === "Err") return ei;
  const epfd_value = ei._0;
  const ev = this_.read_immediate(events_op);
  if (ev.$ === "Err") return ev;
  const events = ev._0;
  const m = this_.read_scalar(maxevents_op);
  if (m.$ === "Err") return m;
  const mi = ScalarNs.to_i32(m._0);
  if (mi.$ === "Err") return mi;
  const maxevents = mi._0;
  const t = this_.read_scalar(timeout_op);
  if (t.$ === "Err") return t;
  const ti = ScalarNs.to_i32(t._0);
  if (ti.$ === "Err") return ti;
  const timeout = ti._0;

  if (epfd_value <= 0 || maxevents <= 0) {
    return this_.set_errno_and_return_neg1({ $: "LibcError", _0: "EINVAL" }, dest);
  }

  // This needs to come after the maxevents value check, or else maxevents.try_into().unwrap()
  // will fail.
  const p = this_.deref_pointer_as(events, this_.libc_array_ty_layout("epoll_event", BigInt(maxevents)));
  if (p.$ === "Err") return p;
  const event = p._0;

  const epfd_dyn = this_.machine.fds.get(epfd_value);
  if (epfd_dyn === undefined) {
    return this_.set_errno_and_return_neg1({ $: "LibcError", _0: "EBADF" }, dest);
  }
  const epfd = epfd_dyn.downcast(is_Epoll);
  if (epfd === undefined) {
    return this_.set_errno_and_return_neg1({ $: "LibcError", _0: "EBADF" }, dest);
  }

  if (timeout === 0 || epfd.deref().watcher.ready_count() !== 0) {
    // If the timeout is 0 or there is a ready event, we can return immediately.
    const r = this_.return_ready_list(epfd, dest, event);
    epfd.drop();
    if (r.$ === "Err") return r;
  } else {
    // Blocking, with a relative timeout.
    let deadline: Deadline | undefined;
    if (timeout >= 0) {
      const duration = Duration.from_millis(BigInt(timeout));
      deadline = Deadline.from(this_.machine.monotonic_clock.now().add_lossy(duration));
    } else if (timeout === -1) {
      deadline = undefined;
    } else {
      epfd.drop();
      return throw_unsup_format("epoll_wait: Only timeout values greater than or equal to -1 are supported.");
    }

    // Record this thread as blocked.
    epfd.deref().watcher.add_blocked_thread(this_.active_thread());
    // And block it.
    // We keep a strong ref to the underlying `ReadinessWatcher` to make sure it sticks around.
    // This means there'll be a leak if we never wake up, but that anyway would imply
    // a thread is permanently blocked so this is fine.
    this_.block_thread(
      { $: "Readiness" },
      deadline,
      // callback!(@capture<'tcx> { epfd: FileDescriptionRef<Epoll>, dest: MPlaceTy<'tcx>, event: MPlaceTy<'tcx> }
      //     |this, unblock: UnblockKind| { .. })
      callback<{ epfd: FileDescriptionRef<Epoll>; dest: MPlaceTy; event: MPlaceTy }, UnblockKind>(
        {
          epfd: [epfd, VisitProvenance_FileDescriptionRef],
          dest: [dest, VisitProvenance_MPlaceTy],
          event: [event, VisitProvenance_MPlaceTy],
        },
        (this_, unblock, { epfd, dest, event }) => {
          // The captures are dropped when the callback body ends.
          try {
            switch (unblock) {
              case "Ready": {
                const r = this_.return_ready_list(epfd, dest, event);
                if (r.$ === "Err") return r;
                const events = r._0;
                assert(events > 0, "we got woken up with no events to deliver");
                return interp_ok(undefined);
              }
              case "TimedOut": {
                // Remove the current active thread id from the blocked threads list.
                epfd.deref().watcher.remove_blocked_thread(this_.active_thread());
                const w = this_.write_int(0n, dest);
                if (w.$ === "Err") return w;
                return interp_ok(undefined);
              }
            }
          } finally {
            epfd.drop();
          }
        },
      ),
    );
  }
  return interp_ok(undefined);
};

// ---------------------------------------------------------------- EvalContextPrivExt ----

/// Convert a [`Readiness`] instance into the corresponding epoll
/// readiness bitflag.
// rustc: src/tools/miri/src/shims/unix/linux_like/epoll.rs:323 readiness_to_epoll_bitflag
InterpCx.prototype.readiness_to_epoll_bitflag = function (this: MiriInterpCx, readiness: Readiness): number {
  const this_ = this.eval_context_ref();

  const epollin = this_.eval_libc_u32("EPOLLIN");
  const epollout = this_.eval_libc_u32("EPOLLOUT");
  const epollrdhup = this_.eval_libc_u32("EPOLLRDHUP");
  const epollhup = this_.eval_libc_u32("EPOLLHUP");
  const epollerr = this_.eval_libc_u32("EPOLLERR");

  let bitflag = 0;
  if (readiness.readable) {
    bitflag = or(bitflag, epollin);
  }
  if (readiness.writable) {
    bitflag = or(bitflag, epollout);
  }
  if (readiness.read_closed) {
    bitflag = or(bitflag, epollrdhup);
  }
  if (readiness.write_closed) {
    bitflag = or(bitflag, epollhup);
  }
  if (readiness.error) {
    bitflag = or(bitflag, epollerr);
  }
  return bitflag;
};

/// Convert an epoll readiness bitflag into the corresponding
/// [`Readiness`] instance.
// rustc: src/tools/miri/src/shims/unix/linux_like/epoll.rs:353 epoll_bitflag_to_readiness
InterpCx.prototype.epoll_bitflag_to_readiness = function (this: MiriInterpCx, bitflag: number): Readiness {
  const this_ = this.eval_context_ref();

  const epollin = this_.eval_libc_u32("EPOLLIN");
  const epollout = this_.eval_libc_u32("EPOLLOUT");
  const epollrdhup = this_.eval_libc_u32("EPOLLRDHUP");
  const epollhup = this_.eval_libc_u32("EPOLLHUP");
  const epollerr = this_.eval_libc_u32("EPOLLERR");

  return {
    readable: and(bitflag, epollin) === epollin,
    writable: and(bitflag, epollout) === epollout,
    read_closed: and(bitflag, epollrdhup) === epollrdhup,
    write_closed: and(bitflag, epollhup) === epollhup,
    error: and(bitflag, epollerr) === epollerr,
  };
};

/// Stores the ready list of the `epfd` epoll instance into `events` (which must be an array),
/// and the number of returned events into `dest`.
// rustc: src/tools/miri/src/shims/unix/linux_like/epoll.rs:373 return_ready_list
InterpCx.prototype.return_ready_list = function (this: MiriInterpCx, epfd: FileDescriptionRef<Epoll>, dest: MPlaceTy, events: MPlaceTy): InterpResult<number> {
  const this_ = this.eval_context_mut();

  let num_of_events = 0;
  const a = this_.project_array_fields(events);
  if (a.$ === "Err") return a;
  const array_iter = a._0;
  const l = events.len(this_);
  if (l.$ === "Err") return l;
  const max_events_num = Number(l._0); // `usize::try_from(u64).unwrap()` (a 64-bit target: always fits)

  // We get up to the first `max_events_num` ready events from the
  // watcher and fill them into the slots of the array.
  const g = epfd.deref().watcher.get_ready_interests(max_events_num, this_);
  if (g.$ === "Err") return g;
  for (const interest of g._0) {
    const n = array_iter.next(this_ as never); // PORT: `ArrayIterator::next` is declared over the CTFE `InterpCx` (helpers.ts precedent)
    if (n.$ === "Err") return n;
    if (n._0 === undefined) panic("Array should have slot for interest");
    const [_idx, slot] = n._0;
    // Deliver event to caller.
    const w = this_.write_int_fields_named(
      [
        ["events", BigInt(this_.readiness_to_epoll_bitflag(interest.active_()))],
        ["u64", interest.data],
      ],
      slot,
    );
    if (w.$ === "Err") return w;
    num_of_events = num_of_events + 1; // strict_add (at most `maxevents: i32`)
  }
  const w = this_.write_int(BigInt(num_of_events), dest);
  if (w.$ === "Err") return w;
  return interp_ok(num_of_events);
};
