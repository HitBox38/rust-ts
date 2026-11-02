// Fill lane: `miri-shims-d` (plan-m6 wave 37): ported by this lane.
// Port of src/tools/miri/src/shims/unix/poll.rs (crate `miri`, plan-m6 D2). Its types are generated into poll.gen.ts
// (tools/codegen set `miri`); this module re-exports them.
//
// PORT:
// - `trait EvalContextExt` / `EvalContextPrivExt` (impl for `MiriInterpCx`) are `declare module` augmentations of
//   `InterpCx` (decision C2).
// - `BTreeMap<FdNum, PollInterest>` is a `Map` (only looked up by key, never iterated in order).
// - `Rc<ReadinessWatcher>` is the `ReadinessWatcher` object with shims-c's refcount (readiness.ts):
//   `Rc::new(ReadinessWatcher::default())` is `Rc_new_ReadinessWatcher()`, dropping the `Rc` is
//   `Rc_drop_ReadinessWatcher(w)` (runs `impl Drop for ReadinessWatcher`, readiness.rs:139, at zero), `Readiness::EMPTY` is
//   `Readiness_EMPTY` (API from lane miri-shims-c, wave 37). The skeleton does not declare them yet, so they are read
//   through the module namespace at call time and stop `unported` until shims-c lands. PORT(contract): pending
//   miri-shims-c. A watcher moved into the blocking callback is dropped when the callback runs; a callback dropped
//   without running (its thread never unblocks) does not release it.
// - The watcher is released where Rust drops it on the success paths; on an `InterpError` exit (`?`, which ends the
//   program) it is not released.
// - The `FileDescriptionRef` from `FdTable::get` (`.is_some()`) is a strong handle released with `.drop()` (shims-b's
//   refcount protocol; unix/fd.ts header).
import { type MPlaceTy, type OpTy, type Scalar } from "../../lib.ts";
import { callback, type MiriInterpCx } from "../../machine.ts";
import { Deadline } from "../../clock.ts";
import { VisitProvenance_BTreeMap, VisitProvenance_MPlaceTy, VisitProvenance_no_provenance, type VisitWith } from "../../provenance_gc.ts";
import { type FdNum, type FileDescriptionRef } from "../files.ts";
import * as readiness_ns from "../readiness.ts";
import { type Readiness, type ReadinessWatcher } from "../readiness.ts";
import { type PollInterest } from "./poll.gen.ts";
import { type UnblockKind } from "../../concurrency/thread.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Scalar as interp_Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { panic, unported } from "../../../std/panic.ts";
import { Err } from "../../../std/result.ts";
import { Duration } from "../../../std/time.ts";
export * from "./poll.gen.ts";

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`). */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}

/** `{:#x}` of a `u16`. */
function hex_u16(x: number): string {
  return `0x${x.toString(16)}`;
}

// impl VisitProvenance for PollInterest<'_>
export const VisitProvenance_PollInterest = {
  // rustc: src/tools/miri/src/shims/unix/poll.rs:19 visit_provenance
  visit_provenance(self: PollInterest, visit: VisitWith): void {
    VisitProvenance_MPlaceTy.visit_provenance(self.revents_place, visit);
  },
};

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/unix/poll.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/poll.rs:26
    poll(this: MiriInterpCx, fds: OpTy, nfds: OpTy, timeout: OpTy, dest: MPlaceTy): InterpResult;
    // ---- shims/unix/poll.rs: `trait EvalContextPrivExt` (impl for `MiriInterpCx`) ----
    // shims/unix/poll.rs:152
    write_ready_events(this: MiriInterpCx, watcher: ReadinessWatcher, interests: Map<FdNum, PollInterest>): InterpResult<number>;
    // shims/unix/poll.rs:179
    readiness_to_poll_bitflag(this: MiriInterpCx, readiness: Readiness): number;
    // shims/unix/poll.rs:216
    poll_bitflag_to_readiness(this: MiriInterpCx, bitflag: number): InterpResult<Readiness>;
  }
}

// rustc: src/tools/miri/src/shims/unix/poll.rs:26 poll
InterpCx.prototype.poll = function (this: MiriInterpCx, fds: OpTy, nfds_op: OpTy, timeout_op: OpTy, dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();

  const nfds_layout = this_.libc_ty_layout("nfds_t");
  const nfds_s = this_.read_scalar(nfds_op as never);
  if (nfds_s.$ === "Err") return nfds_s;
  const nfds_i = interp_Scalar.to_int(nfds_s._0 as Scalar, nfds_layout.size);
  if (nfds_i.$ === "Err") return nfds_i;
  if (nfds_i._0 < 0n) return panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
  const nfds: bigint = nfds_i._0;
  const timeout_s = this_.read_scalar(timeout_op as never);
  if (timeout_s.$ === "Err") return timeout_s;
  const timeout_r = interp_Scalar.to_i32(timeout_s._0 as Scalar);
  if (timeout_r.$ === "Err") return timeout_r;
  const timeout = timeout_r._0;
  const fds_arr_layout = this_.libc_array_ty_layout("pollfd", nfds);
  const fds_arr_mplace = this_.deref_pointer_as(fds as never, fds_arr_layout);
  if (fds_arr_mplace.$ === "Err") return fds_arr_mplace;
  const fds_arr_iter_r = this_.project_array_fields(fds_arr_mplace._0 as never);
  if (fds_arr_iter_r.$ === "Err") return fds_arr_iter_r;
  const fds_arr_iter = fds_arr_iter_r._0;

  // The provided interests indexed by the file descriptor they're for.
  const interests = new Map<FdNum, PollInterest>();
  // Counts the number of poll interests that are invalid because they're for
  // a positive file descriptor that doesn't exist.
  let invalid_interests = 0;

  const watcher = ReadinessWatcher_default();

  // We iterate over the fds array of the `poll` syscall. For each fd, we check its
  // output field, the relevant events, and whether they are currently fulfilled.
  for (;;) {
    const n = fds_arr_iter.next(this_ as never);
    if (n.$ === "Err") return n;
    if (n._0 === undefined) break;
    const [_idx, pollfd] = n._0 as [bigint, MPlaceTy];
    const fd_field = this_.project_field_named(pollfd, "fd");
    if (fd_field.$ === "Err") return fd_field;
    const fd_s = this_.read_scalar(fd_field._0 as never);
    if (fd_s.$ === "Err") return fd_s;
    const fd_num_r = interp_Scalar.to_i32(fd_s._0 as Scalar);
    if (fd_num_r.$ === "Err") return fd_num_r;
    const fd_num = fd_num_r._0;
    const events_field = this_.project_field_named(pollfd, "events");
    if (events_field.$ === "Err") return events_field;
    const events_s = this_.read_scalar(events_field._0 as never);
    if (events_s.$ === "Err") return events_s;
    const events = interp_Scalar.to_u16(events_s._0 as Scalar);
    if (events.$ === "Err") return events;
    const revents_field_r = this_.project_field_named(pollfd, "revents");
    if (revents_field_r.$ === "Err") return revents_field_r;
    const revents_field = revents_field_r._0;

    const relevant_events = this_.poll_bitflag_to_readiness(events._0);
    if (relevant_events.$ === "Err") return relevant_events;

    let revents: number;
    const fd = this_.machine.fds.get(fd_num);
    if (fd !== undefined) drop_fd_ref(fd);
    if (fd !== undefined) {
      // A file description for this file descriptor exists; the interest is thus not ignored.
      const interest: PollInterest = { revents_place: revents_field };
      if (interests.has(fd_num)) {
        return throw_unsup_format("poll: providing multiple interests for the same file descriptor is unsupported");
      }
      interests.set(fd_num, interest);
      const added = watcher.add_interest(
        fd_num,
        relevant_events._0,
        /* is_edge_triggered */ false,
        BigInt(fd_num),
        this_,
      );
      if (added.$ === "Err") return added;
      // We just ensured that no file descriptor is registered twice.
      if (added._0.$ === "Err") return panic("called `Result::unwrap()` on an `Err` value: ()");

      // Since we later only update the `revents` field for FDs which receive
      // an event, we initially zero this field.
      revents = 0;
    } else if (fd_num < 0) {
      // Interests for negative file descriptors should be ignored and
      // their `revents` field should be zeroed.
      revents = 0;
    } else {
      // Interests for positive, invalid file descriptors should be ignored
      // and their `revents` field should be set to POLLNVAL.

      // The Linux implementation still counts such interests as "fulfilled"
      // and thus returns from the `poll` invocation.
      invalid_interests = u32_strict_add(invalid_interests, 1);

      revents = this_.eval_libc_u16("POLLNVAL");
    }

    const w = this_.write_scalar(interp_Scalar.from_u16(revents) as never, revents_field as never);
    if (w.$ === "Err") return w;
  }

  if (timeout === 0 || invalid_interests > 0 || watcher.ready_count() > 0) {
    // Some interests are already fulfilled or a zero timeout was provided.
    // We thus don't need to block the thread and can just return here.

    const count = this_.write_ready_events(watcher, interests);
    if (count.$ === "Err") return count;
    // The Linux implementation also counts invalid interests as fulfilled.
    const total = u32_strict_add(count._0, invalid_interests);

    return this_.write_scalar(interp_Scalar.from_u32(total) as never, dest as never);
  }

  // None of the interests are currently fulfilled; we thus need to
  // block the thread until any interest gets fulfilled.
  watcher.add_blocked_thread(this_.machine.threads.active_thread_());

  let deadline: Deadline | undefined;
  if (timeout > 0) {
    const timeout_duration = Duration.from_millis(BigInt(timeout));
    deadline = Deadline.from(this_.machine.monotonic_clock.now().add_lossy(timeout_duration));
  } else {
    // Negative timeout means block indefinitely.
    deadline = undefined;
  }

  this_.block_thread(
    { $: "Readiness" },
    deadline,
    callback<{ watcher: ReadinessWatcher; interests: Map<FdNum, PollInterest>; dest: MPlaceTy }, UnblockKind>(
      {
        // `impl VisitProvenance for ReadinessWatcher` (readiness.rs:364) visits nothing.
        watcher: [watcher, VisitProvenance_no_provenance],
        interests: [interests, VisitProvenance_interests],
        dest: [dest, VisitProvenance_MPlaceTy],
      },
      (this_, reason, { watcher, interests, dest }) => {
        if (reason === "TimedOut") {
          // The captured `watcher` is dropped when the callback returns.
          return with_drop_watcher(watcher, this_.write_scalar(interp_Scalar.from_u32(0) as never, dest as never));
        }

        const count = this_.write_ready_events(watcher, interests);
        if (count.$ === "Err") return count;
        return this_.write_scalar(interp_Scalar.from_u32(count._0) as never, dest as never);
      },
    ),
  );

  return interp_ok(undefined);
};

/// For all ready interests on the watcher, write the appropriate
/// readiness into the `revents` field of the associated poll interest.
// rustc: src/tools/miri/src/shims/unix/poll.rs:152 write_ready_events
InterpCx.prototype.write_ready_events = function (this: MiriInterpCx, watcher: ReadinessWatcher, interests: Map<FdNum, PollInterest>): InterpResult<number> {
  const this_ = this.eval_context_mut();

  // Counts the number of poll interests that are fulfilled.
  let fulfilled_interests = 0;

  // Iterate over all ready interests of the watcher and
  // write the output readiness of all related poll interests.
  const ready_r = watcher.get_ready_interests(watcher.ready_count(), this_);
  if (ready_r.$ === "Err") return with_drop_watcher(watcher, ready_r);
  for (const ready of ready_r._0) {
    if (ready.data < -(1n << 31n) || ready.data >= 1n << 31n) panic("Data is always a file descriptor: TryFromIntError(())");
    const fd_num = Number(ready.data);
    const interest = interests.get(fd_num);
    if (interest === undefined) panic("Interest should exist");

    fulfilled_interests = u32_strict_add(fulfilled_interests, 1);

    const poll_events = this_.readiness_to_poll_bitflag(ready.active_());
    const w = this_.write_scalar(interp_Scalar.from_u16(poll_events) as never, interest.revents_place as never);
    if (w.$ === "Err") return with_drop_watcher(watcher, w);
  }

  return with_drop_watcher(watcher, interp_ok(fulfilled_interests));
};

/// Convert a [`Readiness`] instance into the corresponding poll
/// readiness bitflag.
// rustc: src/tools/miri/src/shims/unix/poll.rs:179 readiness_to_poll_bitflag
InterpCx.prototype.readiness_to_poll_bitflag = function (this: MiriInterpCx, readiness: Readiness): number {
  const this_ = this.eval_context_ref();

  const pollin = this_.eval_libc_u16("POLLIN");
  const pollout = this_.eval_libc_u16("POLLOUT");
  const pollhup = this_.eval_libc_u16("POLLHUP");
  const pollerr = this_.eval_libc_u16("POLLERR");

  let bitflag = 0;
  if (readiness.readable) {
    bitflag |= pollin;
  }
  if (readiness.writable) {
    bitflag |= pollout;
  }
  if (readiness.write_closed) {
    bitflag |= pollhup;
  }
  if (readiness.error) {
    bitflag |= pollerr;
  }

  const os = this_.tcx.deref().sess.target.os.$;
  if (os === "Linux" || os === "Android" || os === "FreeBsd" || os === "Illumos") {
    // POLLRDHUP only exists on Linux, Android, FreeBSD, and Illumos.
    const pollrdhup = this_.eval_libc_u16("POLLRDHUP");
    if (readiness.read_closed) {
      bitflag |= pollrdhup;
    }
  }

  return bitflag;
};

/// Convert a poll readiness bitflag into the corresponding [`Readiness`] instance.
///
/// This always sets the `write_closed` and `error` readiness since they are
/// implicitly registered for any interest with `poll`.
// rustc: src/tools/miri/src/shims/unix/poll.rs:216 poll_bitflag_to_readiness
InterpCx.prototype.poll_bitflag_to_readiness = function (this: MiriInterpCx, bitflag_: number): InterpResult<Readiness> {
  const this_ = this.eval_context_ref();
  let bitflag = bitflag_;

  const pollin = this_.eval_libc_u16("POLLIN");
  const pollout = this_.eval_libc_u16("POLLOUT");
  const pollhup = this_.eval_libc_u16("POLLHUP");
  const pollerr = this_.eval_libc_u16("POLLERR");
  const pollnval = this_.eval_libc_u16("POLLNVAL");

  // The POLLHUP and POLLERR interests are always set.
  const readiness: Readiness = { ...readiness_api("Readiness_EMPTY"), write_closed: true, error: true };

  if ((bitflag & pollin) === pollin) {
    readiness.readable = true;
    bitflag &= ~pollin & 0xffff;
  }
  if ((bitflag & pollout) === pollout) {
    readiness.writable = true;
    bitflag &= ~pollout & 0xffff;
  }
  if ((bitflag & pollhup) === pollhup) {
    bitflag &= ~pollhup & 0xffff;
  }
  if ((bitflag & pollerr) === pollerr) {
    bitflag &= ~pollerr & 0xffff;
  }
  if ((bitflag & pollnval) === pollnval) {
    // POLLNVAL is ignored when it's provided as a relevant event.
    bitflag &= ~pollnval & 0xffff;
  }

  const os = this_.tcx.deref().sess.target.os.$;
  if (os === "Linux" || os === "Android" || os === "FreeBsd" || os === "Illumos") {
    // POLLRDHUP only exists on Linux, Android, FreeBSD, and Illumos.
    const pollrdhup = this_.eval_libc_u16("POLLRDHUP");
    if ((bitflag & pollrdhup) === pollrdhup) {
      readiness.read_closed = true;
      bitflag &= ~pollrdhup & 0xffff;
    }
  }

  if (bitflag !== 0) {
    return throw_unsup_format(
      `poll: poll event ${hex_u16(bitflag)} is unsupported. Only POLLIN, POLLOUT, POLLERR, POLLHUP, POLLNVAL and POLLRDHUP are supported.`,
    );
  }

  return interp_ok(readiness);
};

// ---------------------------------------------------------------- private glue of this module ----

/** `VisitProvenance for BTreeMap<FdNum, PollInterest>`. */
const VisitProvenance_interests = {
  visit_provenance(self: Map<FdNum, PollInterest>, visit: VisitWith): void {
    VisitProvenance_BTreeMap.visit_provenance(self, visit, VisitProvenance_no_provenance, VisitProvenance_PollInterest);
  },
};

/** shims-c's readiness.ts API that the skeleton does not declare (module header). */
interface ReadinessApi {
  Rc_new_ReadinessWatcher: () => ReadinessWatcher;
  Rc_drop_ReadinessWatcher: (w: ReadinessWatcher) => void;
  Readiness_EMPTY: Readiness;
}
function readiness_api<K extends keyof ReadinessApi>(name: K): ReadinessApi[K] {
  const v = (readiness_ns as unknown as Partial<ReadinessApi>)[name];
  if (v === undefined) {
    return unported(`miri::shims::readiness::${name} (src/tools/miri/src/shims/readiness.rs; lane miri-shims-c) in poll`);
  }
  return v as ReadinessApi[K];
}

/** `Rc::new(ReadinessWatcher::default())`. PORT(contract): pending miri-shims-c. */
function ReadinessWatcher_default(): ReadinessWatcher {
  return readiness_api("Rc_new_ReadinessWatcher")();
}

/** `drop(watcher)` of an `Rc<ReadinessWatcher>`. PORT(contract): pending miri-shims-c. */
function drop_watcher(watcher: ReadinessWatcher): void {
  readiness_api("Rc_drop_ReadinessWatcher")(watcher);
}
function with_drop_watcher<T>(watcher: ReadinessWatcher, value: T): T {
  drop_watcher(watcher);
  return value;
}

/** `drop(fd)` of a strong `FileDescriptionRef` handle (shims-b's `.drop()`; unix/fd.ts `drop_fd_ref`). */
function drop_fd_ref(fd: FileDescriptionRef<unknown>): void {
  const drop = (fd as unknown as { drop?: () => void }).drop;
  if (typeof drop !== "function") {
    unported("miri::shims::files::FileDescriptionRef: `Drop` of the `Rc` (src/tools/miri/src/shims/files.rs:44; lane miri-shims-b) in poll");
  }
  drop.call(fd);
}

/** `u32::strict_add`. */
function u32_strict_add(a: number, b: number): number {
  const s = a + b;
  if (s > 0xffff_ffff) panic("attempt to add with overflow");
  return s;
}
