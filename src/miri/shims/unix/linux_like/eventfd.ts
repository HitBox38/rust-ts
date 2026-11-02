//! Linux `eventfd` implementation.
// Port of src/tools/miri/src/shims/unix/linux_like/eventfd.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-shims-e`
// (plan-m6 wave 37). Its types are generated into eventfd.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT decisions (docs/handoff/miri-shims-e.md):
// - `EventFd` implements `FileDescription` / `UnixFileDescription` and is downcast with an exact type test, so it is a
//   generated class (set `miri`'s `class` list); its trait impls are installed on the prototype with `port_methods`
//   (C10), the provided methods it does not override being `FileDescription_provided` / `UnixFileDescription_provided`'s
//   (PORTING §8). `Cell<u64>` / `RefCell<..>` fields are the plain fields.
// - `self: FileDescriptionRef<Self>` methods take a leading `self_` (agreed with miri-shims-b). A `FileDescriptionRef` is
//   one owned strong handle: it is `drop()`ped where Rust drops it (every exit of a fn that owns it and did not move it),
//   and moved (not dropped) into `update_fd_readiness`, `callback!` captures and recursive calls.
// - `Drop for EventFd` (field drop glue) is `drop_glue()`: its `watched: ReadinessWatched` runs readiness.rs's `Drop`.
import { type UnblockKind, assert_eq_UnblockKind, type ThreadId } from "../../../concurrency/thread.ts";
import { VClock } from "../../../concurrency/vector_clock.ts";
import { type MPlaceTy, type OpTy, type Pointer, type Scalar } from "../../../lib.ts";
import { callback, type DynMachineCallback, type MiriInterpCx } from "../../../machine.ts";
import { type VisitProvenanceImpl, VisitProvenance_MPlaceTy, VisitProvenance_no_provenance, VisitProvenance_object } from "../../../provenance_gc.ts";
import { type FileDescription, FileDescription_provided, type FileDescriptionRef } from "../../files.ts";
import { type IoError, IoError_from_ErrorKind } from "../../io_error.ts";
import { type Readiness, Readiness_EMPTY, ReadinessUpdateFlags, type ReadinessWatched, ReadinessWatched_default } from "../../readiness.ts";
import { type UnixFileDescription, UnixFileDescription_provided } from "../fd.ts";
import { EventFd } from "./eventfd.gen.ts";
import { type Either } from "../../../../rustc_middle/mir/mod.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Scalar as ScalarNs } from "../../../../rustc_middle/mir/interpret/mod.ts";
import { type Pending } from "../../../../rustc_type_ir/decls.ts";
import { type IoError as io_Error } from "../../../../std/io.ts";
import { Err, Ok, type Result } from "../../../../std/result.ts";
import { InterpCx } from "../../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../../rustc_const_eval/interpret/machine.ts";
import { port_methods } from "../../../../rust_ts/miri_stub.ts";
export * from "./eventfd.gen.ts";

declare module "../../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/unix/linux_like/eventfd.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/linux_like/eventfd.rs:144
    eventfd(this: MiriInterpCx, val: OpTy, flags: OpTy): InterpResult<Scalar>;
  }
}

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}
/** `{:#x}` of an `i32` (two's complement, as Rust's `LowerHex` for signed ints). */
function hex_i32(v: number): string {
  return `0x${(v >>> 0).toString(16)}`;
}
/** `io::ErrorKind::X.into()` as Miri's `IoError` (io_error.rs:46, lane miri-shims-b). */
function from_kind(kind: "InvalidInput" | "WouldBlock"): IoError {
  return IoError_from_ErrorKind(kind);
}
/** The `VisitProvenance` impl of a captured `FileDescriptionRef<T>` (files.rs:101, lane miri-shims-b). */
const VisitProvenance_FileDescriptionRef: VisitProvenanceImpl<FileDescriptionRef<EventFd>> = {
  visit_provenance: (self, visit) => self.visit_provenance(visit),
};

/// Maximum value that the eventfd counter can hold.
const MAX_COUNTER = (1n << 64n) - 2n; // u64::MAX - 1
const U64_MAX = (1n << 64n) - 1n;

/// A kind of file descriptor created by `eventfd`.
/// The `Event` type isn't currently written to by `eventfd`.
/// The interface is meant to keep track of objects associated
/// with a file descriptor. For more information see the man
/// page below:
///
/// <https://man.netbsd.org/eventfd.2>
// #[derive(Debug)] struct EventFd (generated class: set `miri`'s `class` list)
declare module "./eventfd.gen.ts" {
  interface EventFd extends UnixFileDescription {}
}

// impl FileDescription for EventFd (the provided methods it does not override are `FileDescription_provided`'s)
port_methods("miri::shims::unix::linux_like::eventfd::FileDescription for EventFd", () => EventFd.prototype, {
  ...FileDescription_provided,

  // rustc: src/tools/miri/src/shims/unix/linux_like/eventfd.rs:37 name
  name(this: EventFd): string {
    return "event";
  },

  // rustc: src/tools/miri/src/shims/unix/linux_like/eventfd.rs:41 metadata
  metadata(this: EventFd): InterpResult<Either<Result<Pending<"fs::Metadata">, io_Error>, string>> {
    // On Linux, eventfd is an "anonymous inode" reported as S_IFREG.
    return interp_ok({ $: "Right", _0: "S_IFREG" });
  },

  /// Read the counter in the buffer and return the counter if succeeded.
  // rustc: src/tools/miri/src/shims/unix/linux_like/eventfd.rs:49 read
  read(
    this: EventFd,
    self_: FileDescriptionRef<EventFd>,
    _communicate_allowed: boolean,
    ptr: Pointer,
    len: number,
    ecx: MiriInterpCx,
    finish: DynMachineCallback<Result<number, IoError>>,
  ): InterpResult {
    // We're treating the buffer as a `u64`.
    const ty = ecx.machine.layouts.u64;
    // Check the size of slice, and return error only if the size of the slice < 8.
    if (len < ty.size.bytes_usize()) {
      const r = finish.call(ecx, Err(from_kind("InvalidInput")));
      self_.drop();
      return r;
    }

    // Turn the pointer into a place at the right type.
    const buf_place = ecx.ptr_to_mplace_unaligned(ptr, ty);

    return eventfd_read(buf_place, self_, ecx, finish);
  },

  /// A write call adds the 8-byte integer value supplied in
  /// its buffer (in native endianness) to the counter.  The maximum value that may be
  /// stored in the counter is the largest unsigned 64-bit value
  /// minus 1 (i.e., 0xfffffffffffffffe).  If the addition would
  /// cause the counter's value to exceed the maximum, then the
  /// write either blocks until a read is performed on the
  /// file descriptor, or fails with the error EAGAIN if the
  /// file descriptor has been made nonblocking.
  ///
  /// A write fails with the error EINVAL if the size of the
  /// supplied buffer is less than 8 bytes, or if an attempt is
  /// made to write the value 0xffffffffffffffff.
  // rustc: src/tools/miri/src/shims/unix/linux_like/eventfd.rs:82 write
  write(
    this: EventFd,
    self_: FileDescriptionRef<EventFd>,
    _communicate_allowed: boolean,
    ptr: Pointer,
    len: number,
    ecx: MiriInterpCx,
    finish: DynMachineCallback<Result<number, IoError>>,
  ): InterpResult {
    // We're treating the buffer as a `u64`.
    const ty = ecx.machine.layouts.u64;
    // Check the size of slice, and return error if the size is wrong. The docs say we only
    // error when the size is too small, but Linux seems to also error when the size is too big.
    if (len !== ty.layout.size().bytes_usize()) {
      const r = finish.call(ecx, Err(from_kind("InvalidInput")));
      self_.drop();
      return r;
    }

    // Turn the pointer into a place at the right type.
    const buf_place = ecx.ptr_to_mplace_unaligned(ptr, ty);

    return eventfd_write(buf_place, self_, ecx, finish);
  },

  // rustc: src/tools/miri/src/shims/unix/linux_like/eventfd.rs:104 readiness_watched
  readiness_watched(this: EventFd): ReadinessWatched | undefined {
    return this.watched;
  },

  // rustc: src/tools/miri/src/shims/unix/linux_like/eventfd.rs:108 readiness
  readiness(this: EventFd): Readiness {
    // We only check the "readable" and "writable" readiness for eventfd. If other event flags
    // need to be supported in the future, the check should be added here.

    return {
      ...Readiness_EMPTY,
      readable: this.counter !== 0n,
      writable: this.counter !== MAX_COUNTER,
    };
  },

  // rustc: src/tools/miri/src/shims/unix/linux_like/eventfd.rs:119 as_unix
  as_unix(this: EventFd, self_: FileDescriptionRef<FileDescription>): FileDescriptionRef<UnixFileDescription> {
    // PORT: the unsizing `FileDescriptionRef<Self> -> FileDescriptionRef<dyn UnixFileDescription>` (a move).
    return self_ as unknown as FileDescriptionRef<UnixFileDescription>;
  },

  /** Drop glue of `EventFd` (no `Drop` impl of its own): `watched: ReadinessWatched` has one (readiness.rs:380). */
  drop_glue(this: EventFd): void {
    this.watched.drop();
  },
} satisfies FileDescription & ThisType<EventFd>);

// impl UnixFileDescription for EventFd {}
port_methods("miri::shims::unix::linux_like::eventfd::UnixFileDescription for EventFd", () => EventFd.prototype, UnixFileDescription_provided);

/** `downcast::<EventFd>()`'s exact type test. */
export const is_EventFd = (v: FileDescription): v is EventFd => v instanceof EventFd;

// rustc: src/tools/miri/src/shims/unix/linux_like/eventfd.rs:144 eventfd
/// This function creates an `Event` that is used as an event wait/notify mechanism by
/// user-space applications, and by the kernel to notify user-space applications of events.
/// The `Event` contains an `u64` counter maintained by the kernel. The counter is initialized
/// with the value specified in the `initval` argument.
///
/// A new file descriptor referring to the `Event` is returned. The `read`, `write`, `poll`,
/// `select`, and `close` operations can be performed on the file descriptor. For more
/// information on these operations, see the man page linked below.
///
/// The `flags` are not currently implemented for eventfd.
/// The `flags` may be bitwise ORed to change the behavior of `eventfd`:
/// `EFD_CLOEXEC` - Set the close-on-exec (`FD_CLOEXEC`) flag on the new file descriptor.
/// `EFD_NONBLOCK` - Set the `O_NONBLOCK` file status flag on the new open file description.
/// `EFD_SEMAPHORE` - miri does not support semaphore-like semantics.
///
/// <https://linux.die.net/man/2/eventfd>
InterpCx.prototype.eventfd = function (this: MiriInterpCx, val_op: OpTy, flags_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const v = this_.read_scalar(val_op);
  if (v.$ === "Err") return v;
  const vu = ScalarNs.to_u32(v._0);
  if (vu.$ === "Err") return vu;
  const val = vu._0;
  const f = this_.read_scalar(flags_op);
  if (f.$ === "Err") return f;
  const fi = ScalarNs.to_i32(f._0);
  if (fi.$ === "Err") return fi;
  let flags = fi._0;

  const efd_cloexec = this_.eval_libc_i32("EFD_CLOEXEC");
  const efd_nonblock = this_.eval_libc_i32("EFD_NONBLOCK");
  const efd_semaphore = this_.eval_libc_i32("EFD_SEMAPHORE");

  if ((flags & efd_semaphore) === efd_semaphore) {
    return throw_unsup_format("eventfd: EFD_SEMAPHORE is unsupported");
  }

  let is_nonblock = false;
  // Unset the flag that we support.
  // After unloading, flags != 0 means other flags are used.
  if ((flags & efd_cloexec) === efd_cloexec) {
    // cloexec is ignored because Miri does not support exec.
    flags &= ~efd_cloexec;
  }
  if ((flags & efd_nonblock) === efd_nonblock) {
    flags &= ~efd_nonblock;
    is_nonblock = true;
  }
  if (flags !== 0) {
    return throw_unsup_format(`eventfd: encountered unknown unsupported flags ${hex_i32(flags)}`);
  }

  const fds = this_.machine.fds;

  const fd_value = fds.insert_new(
    new EventFd(
      BigInt(val),
      is_nonblock,
      new VClock([]), // VClock::default()
      [],
      [],
      ReadinessWatched_default(),
    ),
  );

  return interp_ok(ScalarNs.from_i32(fd_value));
};

/// Block thread if the value addition will exceed u64::MAX -1,
/// else just add the user-supplied value to current counter.
// rustc: src/tools/miri/src/shims/unix/linux_like/eventfd.rs:190 eventfd_write
function eventfd_write(
  buf_place: MPlaceTy,
  eventfd: FileDescriptionRef<EventFd>,
  ecx: MiriInterpCx,
  finish: DynMachineCallback<Result<number, IoError>>,
): InterpResult {
  const inner = eventfd.deref();
  // Figure out which value we should add.
  const r = ecx.read_scalar(buf_place);
  if (r.$ === "Err") return eventfd.drop(), r;
  const ru = ScalarNs.to_u64(r._0);
  if (ru.$ === "Err") return eventfd.drop(), ru;
  const num = ru._0;
  // u64::MAX as input is invalid because the maximum value of counter is u64::MAX - 1.
  if (num === U64_MAX) {
    const c = finish.call(ecx, Err(from_kind("InvalidInput")));
    eventfd.drop();
    return c;
  }

  // `eventfd.counter.get().checked_add(num)`
  const sum = inner.counter + num;
  const new_count = sum <= U64_MAX ? sum : undefined;
  if (new_count !== undefined && new_count <= MAX_COUNTER) {
    // Future `read` calls will synchronize with this write, so update the FD clock.
    const rc = ecx.release_clock((clock) => {
      inner.clock.join(clock);
    });
    if (rc.$ === "Err") return eventfd.drop(), rc;

    // Store new counter value.
    inner.counter = new_count;

    // Unblock *all* threads previously blocked on `read`.
    // We need to take out the blocked thread ids and unblock them together,
    // because `unblock_threads` may block them again and end up re-adding the
    // thread to the blocked list.
    const waiting_threads = inner.blocked_read_tid;
    inner.blocked_read_tid = [];
    // FIXME: We can randomize the order of unblocking.
    for (const thread_id of waiting_threads) {
      const u = ecx.unblock_thread(thread_id, { $: "Eventfd" });
      if (u.$ === "Err") return eventfd.drop(), u;
    }

    // The state changed; we check and update the status of all supported event
    // types for current file description.
    // Linux seems to cause spurious wakeups here, and Tokio seems to rely on that
    // (see <https://github.com/rust-lang/miri/pull/4676#discussion_r2510528994>
    // and also <https://www.illumos.org/issues/16700>).
    const up = ecx.update_fd_readiness(eventfd, ReadinessUpdateFlags.FORCE_EDGE);
    if (up.$ === "Err") return up;

    // Return how many bytes we consumed from the user-provided buffer.
    return finish.call(ecx, Ok(buf_place.layout.size.bytes_usize()));
  } else {
    // `None | Some(u64::MAX)`
    // We can't update the state, so we have to block.
    if (inner.is_nonblock) {
      const c = finish.call(ecx, Err(from_kind("WouldBlock")));
      eventfd.drop();
      return c;
    }

    inner.blocked_write_tid.push(ecx.active_thread());

    ecx.block_thread(
      { $: "Eventfd" },
      undefined,
      // callback!(@capture<'tcx> { num: u64, buf_place: MPlaceTy<'tcx>,
      //     finish: DynMachineCallback<'tcx, Result<usize, IoError>>, eventfd: FileDescriptionRef<EventFd> }
      //     |this, unblock: UnblockKind| { .. })
      callback<{ num: bigint; buf_place: MPlaceTy; finish: DynMachineCallback<Result<number, IoError>>; eventfd: FileDescriptionRef<EventFd> }, UnblockKind>(
        {
          num: [num, VisitProvenance_no_provenance],
          buf_place: [buf_place, VisitProvenance_MPlaceTy],
          finish: [finish, VisitProvenance_object],
          eventfd: [eventfd, VisitProvenance_FileDescriptionRef],
        },
        (this_, unblock, { buf_place, finish, eventfd }) => {
          assert_eq_UnblockKind(unblock, "Ready");
          return eventfd_write(buf_place, eventfd, this_, finish);
        },
      ),
    );
  }
  return interp_ok(undefined);
}

/// Block thread if the current counter is 0,
/// else just return the current counter value to the caller and set the counter to 0.
// rustc: src/tools/miri/src/shims/unix/linux_like/eventfd.rs:264 eventfd_read
function eventfd_read(
  buf_place: MPlaceTy,
  eventfd: FileDescriptionRef<EventFd>,
  ecx: MiriInterpCx,
  finish: DynMachineCallback<Result<number, IoError>>,
): InterpResult {
  const inner = eventfd.deref();
  // Set counter to 0, get old value.
  const counter = inner.counter;
  inner.counter = 0n;

  // Block when counter == 0.
  if (counter === 0n) {
    if (inner.is_nonblock) {
      const c = finish.call(ecx, Err(from_kind("WouldBlock")));
      eventfd.drop();
      return c;
    }

    inner.blocked_read_tid.push(ecx.active_thread());

    ecx.block_thread(
      { $: "Eventfd" },
      undefined,
      // callback!(@capture<'tcx> { buf_place: MPlaceTy<'tcx>,
      //     finish: DynMachineCallback<'tcx, Result<usize, IoError>>, eventfd: FileDescriptionRef<EventFd> }
      //     |this, unblock: UnblockKind| { .. })
      callback<{ buf_place: MPlaceTy; finish: DynMachineCallback<Result<number, IoError>>; eventfd: FileDescriptionRef<EventFd> }, UnblockKind>(
        {
          buf_place: [buf_place, VisitProvenance_MPlaceTy],
          finish: [finish, VisitProvenance_object],
          eventfd: [eventfd, VisitProvenance_FileDescriptionRef],
        },
        (this_, unblock, { buf_place, finish, eventfd }) => {
          assert_eq_UnblockKind(unblock, "Ready");
          return eventfd_read(buf_place, eventfd, this_, finish);
        },
      ),
    );
  } else {
    // Synchronize with all prior `write` calls to this FD.
    const a = ecx.acquire_clock(inner.clock);
    if (a.$ === "Err") return eventfd.drop(), a;

    // Return old counter value into user-space buffer.
    const w = ecx.write_int(counter, buf_place);
    if (w.$ === "Err") return eventfd.drop(), w;

    // Unblock *all* threads previously blocked on `write`.
    // We need to take out the blocked thread ids and unblock them together,
    // because `unblock_threads` may block them again and end up re-adding the
    // thread to the blocked list.
    const waiting_threads = inner.blocked_write_tid;
    inner.blocked_write_tid = [];
    // FIXME: We can randomize the order of unblocking.
    for (const thread_id of waiting_threads) {
      const u = ecx.unblock_thread(thread_id, { $: "Eventfd" });
      if (u.$ === "Err") return eventfd.drop(), u;
    }

    // The state changed; we check and update the status of all supported event
    // types for current file description.
    // Linux seems to always emit do notifications here, even if we were already writable.
    const up = ecx.update_fd_readiness(eventfd, ReadinessUpdateFlags.FORCE_EDGE);
    if (up.$ === "Err") return up;

    // Tell userspace how many bytes we put into the buffer.
    return finish.call(ecx, Ok(buf_place.layout.size.bytes_usize()));
  }
  return interp_ok(undefined);
}
