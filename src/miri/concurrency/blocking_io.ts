// Port of src/tools/miri/src/concurrency/blocking_io.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-threads` (plan-m6
// wave 36), ported. Its types are generated into blocking_io.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT decisions (docs/handoff/miri-threads.md): host I/O polling is mio (plan-m6 D5: unported). With isolation on
// (`communicate == false`) `BlockingIoManager.poll` is `None`, and every method but `new`, `run_gc` and
// `any_thread_blocked_on_host` asserts isolation is off before touching mio, so the isolation-on paths are exact and
// the isolation-off ones stop `unported("mio::..")` where mio is called.
// - `BlockingIoManager::new`: `communicate.then_some(Poll::new()?)` evaluates `Poll::new()` eagerly; with isolation on its
//   result (a host kqueue/epoll handle) is dropped unobserved, so the port does not create one.
// - With isolation off, Miri polls before every foreign item and on every scheduler tick (scheduler.rs:107,
//   foreign_items.rs:127), so a program that does no socket I/O still reaches `Poll::new` and `Poll::poll`. Nothing can be in
//   the poller until `register` runs, and `register` stops `unported`. mio's `select` on an empty poller
//   (mio-1.1.1 sys/unix/selector/kqueue.rs, epoll.rs) returns no event once the timeout passes, so `new` makes no host
//   poller (`NO_HOST_POLLER`), and `poll` with no source is ported: nothing for a zero timeout, a sleep for a longer one
//   (fixers-39, recorded in docs/handoff/fixers-39.md). An EINTR there would be a spurious wakeup, which `poll_and_unblock` ignores.
// - `events: Events` is mio's buffer (`never` in the typemap): `undefined`, it is only read by `poll`.
// - `sources: BTreeMap<FdId, _>` is the generated `Map`; `FdId` is a class (lane miri-shims-b), so lookups compare
//   `FdId._0` (`source_entry`); `blocked_threads: BTreeMap<ThreadId, _>` is a `KeyedMap` keyed by `ThreadId._0`
//   (typemap `fields`; `new_blocked_threads`). It is insertion-ordered: its iteration (`poll`) must go in `_0` order.
import { type Deadline } from "../clock.ts";
import * as gen from "./blocking_io.gen.ts";
import { BlockingIoManager, type BlockingIoSource } from "./blocking_io.gen.ts";
import { type DynUnblockCallback, type ThreadId, ThreadId_value_key } from "./thread.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { type MiriInterpCx } from "../machine.ts";
import { type FdId, type FileDescription, type FileDescriptionRef } from "../shims/files.ts";
import { type Readiness } from "../shims/readiness.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult, interp_ok } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
import { display_IoError, type IoError as io_Error, IoError_kind } from "../../std/io.ts";
import { panic, unported } from "../../std/panic.ts";
import { type Result } from "../../std/result.ts";
import { type Duration } from "../../std/time.ts";
export * from "./blocking_io.gen.ts";

/// Capacity of the event queue which can be polled at a time.
/// Since we don't expect many simultaneous blocking I/O events
/// this value can be set rather low.
const IO_EVENT_CAPACITY = 16;
void IO_EVENT_CAPACITY; // only `Events::with_capacity` (mio) reads it

/// Trait for file descriptions that contain a mio [`Source`].
export interface SourceFileDescription extends FileDescription {
  /// Invoke `f` on the source inside `self`.
  // rustc: src/tools/miri/src/concurrency/blocking_io.rs:20 with_source
  with_source(f: (_0: Pending<"dyn Source">) => Result<null, io_Error>): Result<null, io_Error>;

  /// Get a mutable reference to the readiness of the source.
  // rustc: src/tools/miri/src/concurrency/blocking_io.rs:23 get_readiness_mut
  get_readiness_mut(): Readiness;
}

export type BlockingIoInterest = gen.BlockingIoInterest;
/** PORT: the methods of `impl BlockingIoInterest` on the generated companion (PORTING §8). */
export interface BlockingIoInterest_methods {
  is_fulfilled_by(self: BlockingIoInterest, readiness: Readiness): boolean;
}
export const BlockingIoInterest = gen.BlockingIoInterest as typeof gen.BlockingIoInterest & BlockingIoInterest_methods;

/// Check whether the [`Readiness`] fulfills this blocking I/O interest.
/// This function also returns `true` if the error readiness is set
/// even when the requested interest might not be fulfilled.
// rustc: src/tools/miri/src/concurrency/blocking_io.rs:43 is_fulfilled_by
BlockingIoInterest.is_fulfilled_by = function (self: BlockingIoInterest, readiness: Readiness): boolean {
  switch (self) {
    case "Read":
      return readiness.readable || readiness.error;
    case "Write":
      return readiness.writable || readiness.error;
    case "ReadWrite":
      return readiness.readable || readiness.writable || readiness.error;
  }
};

// impl From<&mio::event::Event> for Readiness
// rustc: src/tools/miri/src/concurrency/blocking_io.rs:54 from
export function Readiness_from_Event(_event: Pending<"mio::event::Event">): Readiness {
  // Self { readable: event.is_readable(), writable: event.is_writable(), read_closed: event.is_read_closed(),
  //        write_closed: event.is_write_closed(), error: event.is_error() }
  return unported("mio::event::Event (host I/O, isolation off; plan-m6 D5)");
}

/** PORT: the `Some` of `BlockingIoManager.poll` with isolation off: the port creates no host poller (see the header). */
const NO_HOST_POLLER = Object.freeze({});

/// Create a new blocking I/O manager instance based on the availability
/// of communication with the host.
// rustc: src/tools/miri/src/concurrency/blocking_io.rs:106 new
(BlockingIoManager as unknown as { new: typeof BlockingIoManager.new }).new = function (communicate: boolean): Result<BlockingIoManager, io_Error> {
  // `poll: communicate.then_some(Poll::new()?)` (see the header)
  const manager = new BlockingIoManager(
    communicate ? (NO_HOST_POLLER as never) : undefined,
    // Events::with_capacity(IO_EVENT_CAPACITY)
    undefined as never,
    new Map<FdId, BlockingIoSource>(),
  );
  return { $: "Ok", _0: manager };
};

/// Poll for new I/O events from the OS or wait until the timeout expired.
/// The timeout semantics are the same as described in [`Poll::poll`].
/// The events also immediately get processed: threads get unblocked, and fd readiness gets updated.
// rustc: src/tools/miri/src/concurrency/blocking_io.rs:118 poll
BlockingIoManager.poll = function (ecx: MiriInterpCx, timeout: Duration | undefined): InterpResult<Result<null, io_Error>> {
  const poll = ecx.machine.blocking_io.poll;
  if (poll === undefined) panic("Blocking I/O should not be called with isolation enabled");

  // PORT: no source was ever registered, so the poller is empty and no event can arrive (see the header). With no timeout
  // upstream would block forever; the scheduler never asks for that with no source (`any_thread_blocked_on_host`).
  if (ecx.machine.blocking_io.sources.size === 0 && timeout !== undefined) {
    if (!timeout.is_zero()) ecx.machine.monotonic_clock.sleep(timeout);
    return interp_ok({ $: "Ok", _0: null });
  }

  // Poll for new I/O events from OS and store them in the events buffer.
  // `poll.poll(&mut ecx.machine.blocking_io.events, timeout)`, then each event's fd readiness is updated
  // (`ecx.update_fd_readiness(fd, ReadinessUpdateFlags::NO_RELEASE_CLOCK)`) and the threads whose interest is
  // fulfilled are unblocked (`ecx.unblock_thread(thread_id, BlockReason::IO)`), in `blocked_threads`' BTreeMap order
  // (ascending `ThreadId._0`; the `KeyedMap` is insertion-ordered, so sort).
  return unported("mio::Poll::poll (host I/O, isolation off; plan-m6 D5)");
};

/// Register a source file description to the blocking I/O poll.
// rustc: src/tools/miri/src/concurrency/blocking_io.rs:195 register
BlockingIoManager.prototype.register = function (this: BlockingIoManager, _source_fd: FileDescriptionRef<SourceFileDescription>): void {
  const poll = this.poll;
  if (poll === undefined) panic("Blocking I/O should not be called with isolation enabled");
  // `source_fd.with_source(&mut |source| poll.registry().register(source, Token(id.to_usize()), Interest::READABLE |
  // Interest::WRITABLE)).unwrap()`, then the source is inserted (`try_insert`, panicking "Source should not already be
  // registered") with `blocked_threads: BTreeMap::default()` (`new_blocked_threads()`).
  unported("mio::Registry::register (host I/O, isolation off; plan-m6 D5)");
};

/** `BTreeMap::<ThreadId, BlockingIoInterest>::default()` (`BlockingIoSource.blocked_threads`, built by `register`):
 *  value-keyed by `ThreadId._0` (see the header). */
export function new_blocked_threads(): KeyedMap<ThreadId, BlockingIoInterest> {
  return new KeyedMap<ThreadId, BlockingIoInterest>(ThreadId_value_key);
}

/** `self.sources.get_mut(&source_id)` (`FdId` compared by value, see the header). */
function source_entry(sources: Map<FdId, BlockingIoSource>, source_id: FdId): BlockingIoSource | undefined {
  for (const [id, source] of sources) {
    if (id._0 === source_id._0) return source;
  }
  return undefined;
}

/// Add a new blocked thread to a registered source. The thread gets unblocked
/// once its [`BlockingIoInterest`] is fulfilled when calling
/// [`BlockingIoManager::poll`].
///
/// It's assumed that the thread of `thread_id` isn't already blocked on
/// the source with id `source_id` and that this source is currently
/// registered.
// rustc: src/tools/miri/src/concurrency/blocking_io.rs:231 add_blocked_thread
BlockingIoManager.prototype.add_blocked_thread = function (this: BlockingIoManager, source_id: FdId, thread_id: ThreadId, interest: BlockingIoInterest): void {
  const source = source_entry(this.sources, source_id);
  if (source === undefined) panic("Source should be registered");

  // `.try_insert(thread_id, interest).expect(..)` (value-keyed: `new_blocked_threads`)
  if (source.blocked_threads.has(thread_id)) {
    // The panic text is `<msg>: OccupiedError { .. }` with the entry's real `Debug` fields; that formatting is not ported
    // (unreachable in M6: no caller blocks a thread twice), so stop rather than print an invented message.
    unported("BlockingIoManager::add_blocked_thread: `expect` panic text (Debug of BTreeMap OccupiedError)");
  }
  source.blocked_threads.set(thread_id, interest);
};

/// Remove a blocked thread from a registered source.
///
/// It's assumed that the thread of `thread_id` is blocked on the
/// source with id `source_id` and that this source is currently
/// registered.
// rustc: src/tools/miri/src/concurrency/blocking_io.rs:250 remove_blocked_thread
BlockingIoManager.prototype.remove_blocked_thread = function (this: BlockingIoManager, source_id: FdId, thread_id: ThreadId): void {
  const source = source_entry(this.sources, source_id);
  if (source === undefined) panic("Source should be registered");
  if (!source.blocked_threads.delete(thread_id)) panic("Thread should be blocked on source");
};

/// Run garbage collector on blocking I/O manager to remove all closed source file
/// descriptions from the registered sources map.
// rustc: src/tools/miri/src/concurrency/blocking_io.rs:257 run_gc
BlockingIoManager.prototype.run_gc = function (this: BlockingIoManager): void {
  // For hosts where mio uses `kqueue`, `epoll` or `IOCP` (Windows), we know that
  // the source doesn't need to be deregistered from the `Poll` before being dropped:
  // See <https://github.com/tokio-rs/mio/issues/1972>
  // Thus, just removing the closed source file descriptions from the `sources` map
  // is enough.
  for (const [id, source] of [...this.sources]) {
    if (source.fd.is_closed()) this.sources.delete(id);
  }
};

// ---------------------------------------------------------------- EvalContextExt ----

/// Block the current thread until some interests on an I/O source
/// are fulfilled or the optional timeout exceeded.
/// The callback will be invoked when the thread gets unblocked.
///
/// Note that an error interest is implicitly added to `interest`.
/// This means that the thread will also be unblocked when the error
/// readiness gets set for the source even when the requested interest
/// might not be fulfilled.
///
/// The callback function will immediately be executed with [`UnblockKind::Ready`]
/// when `interest` is already fulfilled for `source_fd`.
///
/// There can also be spurious wake-ups by the OS and thus it's the callers
/// responsibility to verify that the requested I/O interests are
/// really ready and to block again if they're not.
///
/// It's the callers responsibility to remove the [`BlockingIoInterest`]
/// from the blocking I/O manager in the provided callback function.
// #[inline]
// rustc: src/tools/miri/src/concurrency/blocking_io.rs:288 block_thread_for_io
InterpCx.prototype.block_thread_for_io = function (
  this: MiriInterpCx,
  source_fd: FileDescriptionRef<SourceFileDescription>,
  interest: BlockingIoInterest,
  deadline: Deadline | undefined,
  callback: DynUnblockCallback,
): InterpResult {
  const this_ = this.eval_context_mut();

  // We always have to do this since the thread will de-register itself.
  this_.machine.blocking_io.add_blocked_thread(source_fd.id(), this_.active_thread(), interest);

  // `Deref` of `FileDescriptionRef<T>` is the `T` inside (`_0.inner`).
  if (BlockingIoInterest.is_fulfilled_by(interest, source_fd._0.inner.get_readiness_mut())) {
    // The requested readiness is currently already fulfilled for the provided source.
    // Instead of actually blocking the thread, we just run the callback function.
    return callback.call(this_, "Ready");
  } else {
    // The I/O readiness is currently not fulfilled. We block the thread
    // until the readiness is fulfilled and execute the callback then.
    this_.block_thread({ $: "IO" }, deadline, callback);
    return interp_ok(undefined);
  }
};

/// Poll for I/O events until either an I/O event happened or the timeout expired.
///
/// - If the timeout is [`Some`] and contains [`Duration::ZERO`], the poll doesn't block and just
///   reads all events since the last poll.
/// - If the timeout is [`Some`] and contains a non-zero duration, it blocks at most for the
///   specified duration.
/// - If the timeout is [`None`] the poll blocks indefinitely until an event occurs.
///
/// Unblocks all threads which are blocked on I/O and whose I/O interests
/// are currently fulfilled.
// rustc: src/tools/miri/src/concurrency/blocking_io.rs:322 poll_and_unblock
InterpCx.prototype.poll_and_unblock = function (this: MiriInterpCx, timeout: Duration | undefined): InterpResult {
  const this_ = this.eval_context_mut();

  const r = BlockingIoManager.poll(this_, timeout);
  if (r.$ === "Err") return r;
  const res = r._0;
  if (res.$ === "Ok") {
    return interp_ok(undefined);
  } else if (IoError_kind(res._0) === "Interrupted") {
    // We can ignore errors originating from interrupts; that's just a spurious wakeup.
    return interp_ok(undefined);
  } else {
    // For other errors we panic. On Linux and BSD hosts this should only be
    // reachable when a system resource error (e.g. ENOMEM or ENOSPC) occurred.
    panic(`unexpected error while polling: ${display_IoError(res._0)}`);
  }
};

/// Returns whether there exists any thread that is blocked on host I/O.
// rustc: src/tools/miri/src/concurrency/blocking_io.rs:336 any_thread_blocked_on_host
InterpCx.prototype.any_thread_blocked_on_host = function (this: MiriInterpCx): boolean {
  const this_ = this.eval_context_ref();
  for (const source of this_.machine.blocking_io.sources.values()) {
    // There's two ways something could be blocked on this: directly,
    // or indirectly via a readiness watcher.
    if (source.blocked_threads.size > 0) return true;
    const fd = source.fd.upgrade();
    if (fd !== undefined) {
      const w = fd._0.inner.readiness_watched();
      if (w !== undefined && w.has_watcher_with_blocked_thread()) return true;
    }
  }
  return false;
};

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- concurrency/blocking_io.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // concurrency/blocking_io.rs:288
    block_thread_for_io(this: MiriInterpCx, source_fd: FileDescriptionRef<SourceFileDescription>, interest: BlockingIoInterest, deadline: Deadline | undefined, callback: DynUnblockCallback): InterpResult;
    // concurrency/blocking_io.rs:322
    poll_and_unblock(this: MiriInterpCx, timeout: Duration | undefined): InterpResult;
    // concurrency/blocking_io.rs:336
    any_thread_blocked_on_host(this: MiriInterpCx): boolean;
  }
}

declare module "./blocking_io.gen.ts" {
  interface BlockingIoManager {
    // concurrency/blocking_io.rs:195
    register(source_fd: FileDescriptionRef<SourceFileDescription>): void;
    // concurrency/blocking_io.rs:231
    add_blocked_thread(source_id: FdId, thread_id: ThreadId, interest: BlockingIoInterest): void;
    // concurrency/blocking_io.rs:250
    remove_blocked_thread(source_id: FdId, thread_id: ThreadId): void;
    // concurrency/blocking_io.rs:257
    run_gc(): void;
  }
  namespace BlockingIoManager {
    // concurrency/blocking_io.rs:106
    function new_(communicate: boolean): Result<BlockingIoManager, io_Error>;
    export { new_ as new };
    // concurrency/blocking_io.rs:118
    export let poll: (ecx: MiriInterpCx, timeout: Duration | undefined) => InterpResult<Result<null, io_Error>>;
  }
}
