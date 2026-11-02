// Fill lane: `miri-shims-c` (plan-m6 wave 37): ported by this lane.
// Port of src/tools/miri/src/shims/readiness.rs (crate `miri`, plan-m6 D2). Its types are generated into
// readiness.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT:
// - `trait EvalContextExt` / `EvalContextPrivExt` (impl for `MiriInterpCx`) are `declare module` augmentations of
//   `InterpCx` (decision C2). `impl BitAnd/BitOr/BitOrAssign for Readiness` are `Readiness_bitand` / `_bitor` /
//   `_bitor_assign` (the struct is a generated interface); `#[derive(PartialEq)]` is `Readiness_eq`.
// - `ReadinessInterestKey = (FdId, FdNum)` stays a tuple compared by value (`key_eq`). `ReadinessWatcher.interests`
//   (`BTreeMap<ReadinessInterestKey, ReadinessInterest>`) is an `InterestMap`: a `KeyedMap` (rust_ts/keyed.ts) whose
//   iteration is in key order (`FdId` then `FdNum`, the tuple's derived `Ord`), so `range`, `retain` and `Drop` visit the
//   entries in upstream's order.
// - `Rc<ReadinessWatcher>` / `Weak<ReadinessWatcher>`: the strong count is observable (`Drop for ReadinessWatcher`,
//   `Weak::upgrade`, `retain(|w| w.strong_count() > 0)`), so a watcher carries an explicit count (`rc_strong`).
//   `Rc::new(ReadinessWatcher::default())` is `Rc_new_ReadinessWatcher()`, `Rc::clone` is `Rc_clone_ReadinessWatcher`,
//   dropping an `Rc` is `Rc_drop_ReadinessWatcher` (runs `Drop` at zero): the owners (unix/poll.rs, linux_like/epoll.rs)
//   call them where Rust clones / drops. `Rc::downgrade` is `WeakReadinessWatcher` (the element type of
//   `ReadinessWatched.watchers`, generated as `Pending1<"std::rc::Weak", ..>`).
// - `Drop for ReadinessWatched` is `ReadinessWatched.prototype.drop`: the file description that holds it runs it when its last
//   `FileDescriptionRef` goes away (shims/files.rs's `Rc`, lane miri-shims-b).
// - `FileDescriptionRef<T>`'s `Deref` is `deref()` (shims/files.ts); strong handles this file receives (`FdTable::get`,
//   `upgrade`, the by-value `fd` of `update_fd_readiness`) are released with `drop()` where Rust drops them
//   (`try`/`finally` for the scope end).
// - `#[derive(Default)]` of `ReadinessWatched` / `DelayedReadinessUpdates` are `ReadinessWatched_default()` /
//   `DelayedReadinessUpdates_default()`.
// - `cfg!(debug_assertions)` blocks (readiness.rs:327, :408) are off in the release Miri (the oracle): kept as comments.
import { BlockReason, type ThreadId, ThreadId_eq } from "../concurrency/thread.ts";
import { VClock } from "../concurrency/vector_clock.ts";
import { type MiriInterpCx } from "../machine.ts";
import { type VisitWith } from "../provenance_gc.ts";
import { type DynFileDescriptionRef, type FdId, type FdNum, type FileDescription, FileDescriptionRef } from "./files.ts";
import {
  DelayedReadinessUpdates,
  type Readiness,
  ReadinessInterest,
  type ReadinessInterestKey,
  ReadinessUpdateFlags,
  ReadinessWatched,
  ReadinessWatcher,
} from "./readiness.gen.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok } from "../../rustc_middle/mir/interpret/mod.ts";
import { panic } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
export * from "./readiness.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/readiness.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/readiness.rs:483
    update_fd_readiness(this: MiriInterpCx, fd: DynFileDescriptionRef, flags: ReadinessUpdateFlags): InterpResult;
    // ---- shims/readiness.rs: `trait EvalContextPrivExt` (impl for `MiriInterpCx`) ----
    // shims/readiness.rs:539
    update_readiness(this: MiriInterpCx, watcher: ReadinessWatcher, active: Readiness, force_edge: boolean, for_each_interest: ((_0: ((_0: ReadinessInterestKey, _1: ReadinessInterest) => InterpResult)) => InterpResult)): InterpResult;
  }
}

declare module "./readiness.gen.ts" {
  interface ReadinessInterest {
    // shims/readiness.rs:115 // PORT: `active_` (a field `active` exists; mir-contract rule)
    active_(): Readiness;
  }
}
declare module "./readiness.gen.ts" {
  interface ReadinessWatcher {
    /** PORT: the `Rc<ReadinessWatcher>` strong count (module header). */
    rc_strong: number;
    // shims/readiness.rs:140 (`impl Drop for ReadinessWatcher`)
    drop(): void;
    // shims/readiness.rs:170 // self: &Rc<Self>
    add_interest(fd_num: FdNum, relevant: Readiness, is_edge_triggered: boolean, data: bigint, ecx: MiriInterpCx): InterpResult<Result<null, null>>;
    // shims/readiness.rs:225 // self: &Rc<Self>
    update_interest(key: ReadinessInterestKey, ecx: MiriInterpCx, cb: ((_0: ReadinessInterest) => void)): InterpResult<null | undefined>;
    // shims/readiness.rs:257 // self: &Rc<ReadinessWatcher>
    remove_interest(key: ReadinessInterestKey): null | undefined;
    // shims/readiness.rs:283
    add_blocked_thread(thread_id: ThreadId): void;
    // shims/readiness.rs:290
    remove_blocked_thread(thread_id: ThreadId): void;
    // shims/readiness.rs:296
    ready_count(): number;
    // shims/readiness.rs:309
    get_ready_interests(max: number, ecx: MiriInterpCx): InterpResult<ReadinessInterest[]>;
    // shims/readiness.rs:365 (`impl VisitProvenance for ReadinessWatcher`)
    visit_provenance(_visit: VisitWith): void;
  }
}
declare module "./readiness.gen.ts" {
  interface ReadinessWatched {
    // shims/readiness.rs:380 (`impl Drop for ReadinessWatched`; run by the drop glue of the description holding it)
    drop(): void;
    // shims/readiness.rs:406
    insert(watcher: ReadinessWatcher): void;
    // shims/readiness.rs:419
    remove(watcher: ReadinessWatcher): void;
    // shims/readiness.rs:432
    has_watcher_with_blocked_thread(): boolean;
    // shims/readiness.rs:440
    remove_file_num_interests(fd_id: FdId, fd_num: FdNum): void;
  }
}
declare module "./readiness.gen.ts" {
  interface DelayedReadinessUpdates {
    // shims/readiness.rs:461
    add(fd: DynFileDescriptionRef): void;
  }
  namespace DelayedReadinessUpdates {
    // shims/readiness.rs:465
    export let process: (ecx: MiriInterpCx) => InterpResult;
  }
}

// ---- Readiness ----

/** `#[derive(PartialEq)]` of `Readiness`. */
export function Readiness_eq(a: Readiness, b: Readiness): boolean {
  return a.readable === b.readable && a.writable === b.writable && a.read_closed === b.read_closed && a.write_closed === b.write_closed && a.error === b.error;
}

// impl std::ops::BitAnd for Readiness
// rustc: src/tools/miri/src/shims/readiness.rs:31 bitand
export function Readiness_bitand(self: Readiness, rhs: Readiness): Readiness {
  return {
    readable: self.readable && rhs.readable,
    writable: self.writable && rhs.writable,
    read_closed: self.read_closed && rhs.read_closed,
    write_closed: self.write_closed && rhs.write_closed,
    error: self.error && rhs.error,
  };
}

// impl std::ops::BitOr for Readiness
// rustc: src/tools/miri/src/shims/readiness.rs:45 bitor
export function Readiness_bitor(self: Readiness, rhs: Readiness): Readiness {
  return {
    readable: self.readable || rhs.readable,
    writable: self.writable || rhs.writable,
    read_closed: self.read_closed || rhs.read_closed,
    write_closed: self.write_closed || rhs.write_closed,
    error: self.error || rhs.error,
  };
}

// impl std::ops::BitOrAssign for Readiness
// rustc: src/tools/miri/src/shims/readiness.rs:57 bitor_assign
export function Readiness_bitor_assign(self: Readiness, rhs: Readiness): void {
  self.readable ||= rhs.readable;
  self.writable ||= rhs.writable;
  self.read_closed ||= rhs.read_closed;
  self.write_closed ||= rhs.write_closed;
  self.error ||= rhs.error;
}

/** `Readiness::EMPTY` (readiness.rs:67). Frozen: copy it (`clone_Readiness`) before mutating. */
export const Readiness_EMPTY: Readiness = Object.freeze({
  readable: false,
  writable: false,
  read_closed: false,
  write_closed: false,
  error: false,
});

// ---- ReadinessInterestKey (the `BTreeMap` key) ----

/** `FdNum::MAX` (`i32::MAX`). */
const FdNum_MAX = 0x7fff_ffff;

/** The tuple's derived `Ord` as a number: `FdId` first, then `FdNum` (offset so a negative `i32` orders first). */
function key_ord(k: ReadinessInterestKey): number {
  return k[0]._0 * 2 ** 32 + (k[1] + 2 ** 31);
}

/** The tuple's derived `PartialEq`. */
function key_eq(a: ReadinessInterestKey, b: ReadinessInterestKey): boolean {
  return a[0]._0 === b[0]._0 && a[1] === b[1];
}

/**
 * `BTreeMap<ReadinessInterestKey, ReadinessInterest>`: a `Map` keyed by value whose iteration is in key order (module
 * header). Mutation while iterating goes through a snapshot, so `retain` / `range_mut` see a stable order.
 */
export class InterestMap extends KeyedMap<ReadinessInterestKey, ReadinessInterest> {
  constructor() {
    super(key_ord);
  }

  /** The stored keys in `Ord` order. */
  #sorted_keys(): ReadinessInterestKey[] {
    return Array.from(super.keys()).sort((a, b) => key_ord(a) - key_ord(b));
  }

  override *entries(): MapIterator<[ReadinessInterestKey, ReadinessInterest]> {
    for (const k of this.#sorted_keys()) yield [k, super.get(k)!];
  }

  override *keys(): MapIterator<ReadinessInterestKey> {
    for (const k of this.#sorted_keys()) yield k;
  }

  override *values(): MapIterator<ReadinessInterest> {
    for (const k of this.#sorted_keys()) yield super.get(k)!;
  }

  override [Symbol.iterator](): MapIterator<[ReadinessInterestKey, ReadinessInterest]> {
    return this.entries();
  }

  override forEach(callbackfn: (value: ReadinessInterest, key: ReadinessInterestKey, map: Map<ReadinessInterestKey, ReadinessInterest>) => void, thisArg?: unknown): void {
    for (const [k, v] of this.entries()) callbackfn.call(thisArg, v, k, this);
  }

  /** `range(lo..=hi)` / `range_mut(lo..=hi)`: the entries with `lo <= key <= hi`, in order. */
  range(range: [ReadinessInterestKey, ReadinessInterestKey]): [ReadinessInterestKey, ReadinessInterest][] {
    const lo = key_ord(range[0]);
    const hi = key_ord(range[1]);
    const out: [ReadinessInterestKey, ReadinessInterest][] = [];
    for (const [k, v] of this.entries()) {
      const o = key_ord(k);
      if (lo <= o && o <= hi) out.push([k, v]);
    }
    return out;
  }

  /** `retain(|k, v| f(k, v))`, visiting the entries in order. */
  retain(f: (k: ReadinessInterestKey, v: ReadinessInterest) => boolean): void {
    for (const [k, v] of Array.from(this.entries())) {
      if (!f(k, v)) this.delete(k);
    }
  }
}

/// Returns the range of all [`ReadinessInterestKey`] for the given FD ID.
// rustc: src/tools/miri/src/shims/readiness.rs:92 range_for_id
function range_for_id(id: FdId): [ReadinessInterestKey, ReadinessInterestKey] {
  return [[id, 0], [id, FdNum_MAX]];
}

/** `interests` of a watcher as the `InterestMap` it is built with. */
function interests_of(w: ReadinessWatcher): InterestMap {
  return w.interests as InterestMap;
}

/** `ready.iter().position(|k| k == key)` */
function position_key(ready: readonly ReadinessInterestKey[], key: ReadinessInterestKey): number | undefined {
  const idx = ready.findIndex((k) => key_eq(k, key));
  return idx === -1 ? undefined : idx;
}

/** `#[derive(Clone)]` of `ReadinessInterest` (the `WeakFileDescriptionRef` is cloned by reference: a `Weak` clone). */
function clone_interest(v: ReadinessInterest): ReadinessInterest {
  return new ReadinessInterest(v.watched_fd, { ...v.relevant }, v.is_edge_triggered, v.data, { ...v.active });
}

// ---- Rc<ReadinessWatcher> / Weak<ReadinessWatcher> ----

/** `Rc::new(ReadinessWatcher::default())` (strong count 1). */
export function Rc_new_ReadinessWatcher(): ReadinessWatcher {
  const w = new ReadinessWatcher(new InterestMap(), [], []);
  w.rc_strong = 1;
  return w;
}

/** `Rc::clone(&w)` */
export function Rc_clone_ReadinessWatcher(w: ReadinessWatcher): ReadinessWatcher {
  w.rc_strong += 1;
  return w;
}

/** Dropping an `Rc<ReadinessWatcher>`: the last one runs `Drop for ReadinessWatcher`. */
export function Rc_drop_ReadinessWatcher(w: ReadinessWatcher): void {
  w.rc_strong -= 1;
  if (w.rc_strong === 0) w.drop();
}

/** `Weak<ReadinessWatcher>` (`Rc::downgrade`). */
export class WeakReadinessWatcher {
  constructor(readonly target: ReadinessWatcher) {}

  /** `Weak::upgrade` (PORT: the result is a borrow; callers that keep it past a drop point clone it). */
  upgrade(): ReadinessWatcher | undefined {
    return this.target.rc_strong > 0 ? this.target : undefined;
  }

  /** `Weak::strong_count` */
  strong_count(): number {
    return this.target.rc_strong;
  }
}

/** `ReadinessWatched.watchers` as the `WeakReadinessWatcher`s it holds. */
function watchers_of(w: ReadinessWatched): WeakReadinessWatcher[] {
  return w.watchers as unknown as WeakReadinessWatcher[];
}

// ---- ReadinessInterest ----

// rustc: src/tools/miri/src/shims/readiness.rs:115 active
ReadinessInterest.prototype.active_ = function (this: ReadinessInterest): Readiness {
  return this.active;
};

// ---- ReadinessWatcher ----

// impl Drop for ReadinessWatcher
// rustc: src/tools/miri/src/shims/readiness.rs:140 drop
ReadinessWatcher.prototype.drop = function (this: ReadinessWatcher): void {
  // Remove ourselves from the FDs we were interested in, at most once per description.
  let last_id: FdId | undefined = undefined;
  for (const [[id, _fd_num], interest] of interests_of(this)) {
    // We'll see interested sorted by ID. Only do something once for each ID.
    if (last_id !== undefined && id._0 === last_id._0) {
      continue;
    }
    last_id = id;
    // If the FD still exists, remove ourselves from it.
    const fd = interest.watched_fd.upgrade();
    if (fd !== undefined) {
      try {
        // We can't easily figure out who in that list is us, but we can just remove
        // everything that has no more strong refs.
        const watched = fd.deref().readiness_watched();
        if (watched === undefined) panic("called `Option::unwrap()` on a `None` value");
        const watchers = watchers_of(watched);
        const kept = watchers.filter((w) => w.strong_count() > 0);
        watchers.length = 0;
        watchers.push(...kept);
      } finally {
        fd.drop();
      }
    }
  }
};

/// Add an interest for the file description to which the file descriptor
/// `fd_num` belongs.
/// `relevant` contains the readiness mask of relevant events.
/// `is_edge_triggered` specifies whether the interest is edge-triggered
/// ([`true`]) or level-triggered ([`false`]).
/// `data` is the user-data which is associated with the interest.
///
/// The function returns `Ok(())` when the interest was successfully
/// added, and `Err(())` when an interest with this key was already registered.
// rustc: src/tools/miri/src/shims/readiness.rs:170 add_interest
ReadinessWatcher.prototype.add_interest = function (
  this: ReadinessWatcher,
  fd_num: FdNum,
  relevant: Readiness,
  is_edge_triggered: boolean,
  data: bigint,
  ecx: MiriInterpCx,
): InterpResult<Result<null, null>> {
  const fd_ref = ecx.machine.fds.get(fd_num);
  if (fd_ref === undefined) panic("File description should exist");
  // `fd_ref` (an owned handle from `FdTable::get`) is dropped when the function returns.
  try {
    const fd_id = fd_ref.id();
    const key: ReadinessInterestKey = [fd_id, fd_num];

    const interest = new ReadinessInterest(
      FileDescriptionRef.downgrade(fd_ref),
      relevant,
      is_edge_triggered,
      data,
      { ...Readiness_EMPTY },
    );
    const interests = interests_of(this);
    if (interests.range(range_for_id(fd_id)).length === 0) {
      // This is the first time this FD got added to the watcher.
      // Let's make sure it can be watched, and add ourselves to its list.
      const watched = fd_ref.deref().readiness_watched();
      if (watched === undefined) {
        return Err(
          InterpErrorInfo_from_InterpErrorKind({
            $: "Unsupported",
            _0: { $: "Unsupported", _0: `I/O readiness watching not supported for ${fd_ref.deref().name()}` },
          }),
        );
      }
      watched.insert(this);
    }
    // `interests.try_insert(key, interest).is_err()`
    if (interests.has(key)) {
      return interp_ok(Err(null));
    }
    interests.set(key, interest);

    // After adding a new interest for a fd, we need to forcefully update
    // the readiness of this fd.

    const r = ecx.update_readiness(this, fd_ref.deref().readiness(), /* force_edge */ true, (callback) => {
      // Need to release the RefCell when this closure returns, so we have to move
      // it into the closure, so we have to do a re-lookup here.
      return callback(key, interests.get(key)!);
    });
    if (r.$ === "Err") return r;

    return interp_ok(Ok(null));
  } finally {
    fd_ref.drop();
  }
};

/// Update the interest which is registered for `key`.
/// `cb` gets invoked with a mutable reference to the registered
/// [`ReadinessInterest`].
///
/// This function returns [`None`] when no interest is registered
/// for the specified `key`.
// rustc: src/tools/miri/src/shims/readiness.rs:225 update_interest
ReadinessWatcher.prototype.update_interest = function (
  this: ReadinessWatcher,
  key: ReadinessInterestKey,
  ecx: MiriInterpCx,
  cb: (_0: ReadinessInterest) => void,
): InterpResult<null | undefined> {
  const interests = interests_of(this);
  const interest = interests.get(key);
  if (interest === undefined) return interp_ok(undefined);
  cb(interest);

  // After updating an interest for a fd, we need to forcefully update
  // the readiness of this fd.

  const fd_ref = ecx.machine.fds.get(key[1]);
  if (fd_ref === undefined) panic("File description should exist");
  try {
    const r = ecx.update_readiness(this, fd_ref.deref().readiness(), /* force_edge */ true, (callback) => {
      // Need to release the RefCell when this closure returns, so we have to move
      // it into the closure, so we have to do a re-lookup here.
      return callback(key, interests.get(key)!);
    });
    if (r.$ === "Err") return r;

    return interp_ok(null);
  } finally {
    fd_ref.drop();
  }
};

/// Remove the interest registered for `key`.
///
/// This function returns [`None`] when no interest is registered
/// for the specified `key`.
// rustc: src/tools/miri/src/shims/readiness.rs:257 remove_interest
ReadinessWatcher.prototype.remove_interest = function (this: ReadinessWatcher, key: ReadinessInterestKey): null | undefined {
  const interests = interests_of(this);

  const interest = interests.get(key);
  if (interest === undefined) {
    // We did not have interest in this.
    return undefined;
  }
  interests.delete(key);
  const fd_ref = interest.watched_fd.upgrade();
  if (fd_ref === undefined) panic("dead watched");
  try {

    // Remove the ready event for this key, should one exist.
    const ready_events = this.ready;
    const idx = position_key(ready_events, key);
    if (idx !== undefined) {
      ready_events.splice(idx, 1);
    }
    // If this was the last interest in this FD, remove us from the global list
    // of who is interested in this FD.
    if (interests.range(range_for_id(key[0])).length === 0) {
      const watched = fd_ref.deref().readiness_watched();
      if (watched === undefined) return undefined;
      watched.remove(this);
    }

    return null;
  } finally {
    fd_ref.drop();
  }
};

/// Add the thread with id `thread_id` to the queue of
/// blocked threads which will be unblocked when the
/// watcher becomes ready.
// rustc: src/tools/miri/src/shims/readiness.rs:283 add_blocked_thread
ReadinessWatcher.prototype.add_blocked_thread = function (this: ReadinessWatcher, thread_id: ThreadId): void {
  this.queue.push(thread_id);
};

/// Remove all threads with id `thread_id` from the queue
/// of blocked threads which will be unblocked when the
/// watcher becomes ready.
// rustc: src/tools/miri/src/shims/readiness.rs:290 remove_blocked_thread
ReadinessWatcher.prototype.remove_blocked_thread = function (this: ReadinessWatcher, thread_id: ThreadId): void {
  const kept = this.queue.filter((id) => !ThreadId_eq(id, thread_id));
  this.queue.length = 0;
  this.queue.push(...kept);
};

/// Get the amount of interests which are registered to this
/// watcher and which are currently ready.
// rustc: src/tools/miri/src/shims/readiness.rs:296 ready_count
ReadinessWatcher.prototype.ready_count = function (this: ReadinessWatcher): number {
  return this.ready.length;
};

/// Get at most the first `max` ready interests from the ready queue.
///
/// If the interest is a level-triggered interest, it's automatically
/// added to the end of the queue again such that it will only be reported
/// after all other ready interest have been returned.
///
/// This method returns at most every event from the ready queue once.
/// This ensures that every returned interest is unique, even when there
/// are level-triggered interests.
// rustc: src/tools/miri/src/shims/readiness.rs:309 get_ready_interests
ReadinessWatcher.prototype.get_ready_interests = function (this: ReadinessWatcher, max: number, ecx: MiriInterpCx): InterpResult<ReadinessInterest[]> {
  // The goal below is to do work proportyional to how much we're actually reporting to the
  // client, i.e., how many interests of this watcher are ready. In particular, we do *not*
  // iterate over all interests of this watcher, or all watchers, or all FDs being watched, or
  // anything like that.

  // Process delayed readiness updates, to ensure we have fully up-to-date information.
  // This is almost always a NOP.
  {
    const r = DelayedReadinessUpdates.process(ecx);
    if (r.$ === "Err") return r;
  }

  const interests = interests_of(this);
  const ready = this.ready;

  // Sanity-check to ensure that all event info is up-to-date.
  // if cfg!(debug_assertions) {
  //     for interest in interests.values() {
  //         // Ensure this matches the latest readiness of this FD.
  //         let fd = interest.watched_fd.upgrade().expect("dead watched");
  //         let current_active = fd.readiness();
  //         assert_eq!(interest.active(), &(current_active & interest.relevant));
  //     }
  // }

  const ready_interests: ReadinessInterest[] = [];
  const re_add_interests: ReadinessInterestKey[] = [];

  // Continue while we haven't yet gotten `max` events, and while there are more to add.
  while (ready_interests.length < max && ready.length > 0) {
    const key = ready.shift()!;
    const interest = interests.get(key);
    if (interest === undefined) panic("non-existing interest in ready set");
    const fd = interest.watched_fd.upgrade();
    if (fd === undefined) panic("dead watched");
    // `fd` (an owned handle) is dropped at the end of the iteration.
    try {
      if (!interest.is_edge_triggered) {
        // This is a level-triggered interest, so we need to re-add the event:
        // <https://github.com/torvalds/linux/blob/HEAD/fs/eventpoll.c#L1835-L1847>.
        // We delay adding them back so they do not get picked up by later loop iterations.
        re_add_interests.push(key);
      }

      ready_interests.push(clone_interest(interest));
      // We now "see" the readiness of this FD, so make the data race system aware of that.
      const watched = fd.deref().readiness_watched();
      if (watched === undefined) panic("called `Option::unwrap()` on a `None` value");
      const r = ecx.acquire_clock(watched.ready_clock);
      if (r.$ === "Err") return r;
    } finally {
      fd.drop();
    }
  }
  // Add back the level-triggered ones.
  ready.push(...re_add_interests);

  return interp_ok(ready_interests);
};

// impl VisitProvenance for ReadinessWatcher
// rustc: src/tools/miri/src/shims/readiness.rs:365 visit_provenance
ReadinessWatcher.prototype.visit_provenance = function (this: ReadinessWatcher, _visit: VisitWith): void {};

// ---- ReadinessWatched ----

/** `#[derive(Default)]` of `ReadinessWatched`. */
export function ReadinessWatched_default(): ReadinessWatched {
  return new ReadinessWatched([], VClock.default());
}

// impl Drop for ReadinessWatched
// rustc: src/tools/miri/src/shims/readiness.rs:380 drop
ReadinessWatched.prototype.drop = function (this: ReadinessWatched): void {
  const self = this;
  // "A file descriptor is removed from an interest list only after all the file
  // descriptors referring to the underlying open file description have been closed."
  // So, remove ourselves from all interest lists.
  for (const weak of watchers_of(self)) {
    // If the watcher still exists, remove ourselves from it.
    const watcher = weak.upgrade();
    if (watcher === undefined) continue;
    // We can't easily figure out who in that list is us, but we can just remove everything
    // that has no more strong refs.
    const ready_events = watcher.ready;
    interests_of(watcher).retain((key, interest) => {
      if (interest.watched_fd.is_closed()) {
        // We'll remove this one. Also remove it from the ready queue if applicable!
        const idx = position_key(ready_events, key);
        if (idx !== undefined) {
          ready_events.splice(idx, 1);
        }
        return false; // do not retain
      } else {
        return true; // do retain
      }
    });
  }
};

// rustc: src/tools/miri/src/shims/readiness.rs:406 insert
ReadinessWatched.prototype.insert = function (this: ReadinessWatched, watcher: ReadinessWatcher): void {
  const watchers = watchers_of(this);
  // if cfg!(debug_assertions) {
  //     // Ensure uniqueness.
  //     assert_matches!(
  //         watchers.iter().find(|elem| elem.as_ptr() == Rc::as_ptr(watcher)),
  //         None,
  //         "watcher has already been added to this watched fd",
  //     );
  // }
  watchers.push(new WeakReadinessWatcher(watcher));
};

// rustc: src/tools/miri/src/shims/readiness.rs:419 remove
ReadinessWatched.prototype.remove = function (this: ReadinessWatched, watcher: ReadinessWatcher): void {
  const watchers = watchers_of(this);
  // We need to do a linear scan to find the watcher to remove. That's not ideal, but removing
  // a watched FD from an epoll is rare so it's not worth the non-trivial effort it would take
  // to make this more efficient.
  const idx = watchers.findIndex((elem) => elem.target === watcher);
  if (idx === -1) panic("watcher has no registered interest in the provided watched fd");
  watchers.splice(idx, 1);
};

/// Returns whether the watched FD has any readiness watcher with a blocked thread watching it.
// rustc: src/tools/miri/src/shims/readiness.rs:432 has_watcher_with_blocked_thread
ReadinessWatched.prototype.has_watcher_with_blocked_thread = function (this: ReadinessWatched): boolean {
  const watchers = watchers_of(this);
  // See if any of those watchers has a blocked thread.
  return watchers.some((w) => {
    const watcher = w.upgrade();
    if (watcher === undefined) panic("dead watcher");
    return watcher.queue.length > 0;
  });
};

/// Remove all interes in the given file descriptor, which must refer to the file description
/// that contains `self`.
// rustc: src/tools/miri/src/shims/readiness.rs:440 remove_file_num_interests
ReadinessWatched.prototype.remove_file_num_interests = function (this: ReadinessWatched, fd_id: FdId, fd_num: FdNum): void {
  // We make a copy since `remove_interest` may want to mutate `watchers`. This is not
  // very efficient, but this code anyway only runs on `close` on Illumos.
  const watchers = watchers_of(this).slice();
  for (const weak of watchers) {
    const watcher = weak.upgrade();
    if (watcher === undefined) panic("dead watcher");
    // Remove this interest, if it exists.
    watcher.remove_interest([fd_id, fd_num]);
  }
};

// ---- DelayedReadinessUpdates ----

/** `#[derive(Default)]` of `DelayedReadinessUpdates`. */
export function DelayedReadinessUpdates_default(): DelayedReadinessUpdates {
  return new DelayedReadinessUpdates([]);
}

// rustc: src/tools/miri/src/shims/readiness.rs:461 add
DelayedReadinessUpdates.prototype.add = function (this: DelayedReadinessUpdates, fd: DynFileDescriptionRef): void {
  this.to_update.push(fd);
};

// rustc: src/tools/miri/src/shims/readiness.rs:465 process
DelayedReadinessUpdates.process = function (ecx: MiriInterpCx): InterpResult {
  for (;;) {
    // Avoid keeping the RefCell open over the `update_fd_readiness` as that can invoke
    // arbitrary code via the unblock callback.
    const fd = ecx.machine.delayed_readiness_updates.to_update.pop();
    if (fd === undefined) {
      return interp_ok(undefined);
    }
    const r = ecx.update_fd_readiness(fd, ReadinessUpdateFlags.DEFAULT);
    if (r.$ === "Err") return r;
  }
};

// ---- EvalContextExt ----

/// For a specific file description, get its current readiness and send it to everyone who
/// registered interest in this FD. This function must be called whenever the result of
/// `FileDescription::readiness` might change.
// rustc: src/tools/miri/src/shims/readiness.rs:483 update_fd_readiness
InterpCx.prototype.update_fd_readiness = function (this: MiriInterpCx, fd: DynFileDescriptionRef, flags: ReadinessUpdateFlags): InterpResult {
  const this_ = this.eval_context_mut();
  // `fd` (taken by value) is dropped when the function returns.
  try {
    const fd_id = fd.id();
    const watched = fd.deref().readiness_watched();
    if (watched === undefined) panic("called `Option::unwrap()` on a `None` value");

    if (!ReadinessUpdateFlags.contains(flags, ReadinessUpdateFlags.NO_RELEASE_CLOCK)) {
      // We capture a vector clock even if there is nobody watching, since someone might get
      // interested in the future and then synchronize with this event.
      // FIXME: currently we do this even if the readiness did not change!
      const r = this_.release_clock((clock) => {
        watched.ready_clock.join(clock);
      });
      if (r.$ === "Err") return r;
    }

    const watchers_ref = watchers_of(watched);
    // Need to make a copy so below we can unblock threads which may need the same `RefCell`.
    const watchers = watchers_ref.map((w) => {
      const watcher = w.upgrade();
      if (watcher === undefined) panic("dead watcher");
      return Rc_clone_ReadinessWatcher(watcher);
    });
    if (watchers.length === 0) {
      return interp_ok(undefined);
    }

    const active_readiness = fd.deref().readiness();
    // `for watcher in watchers`: each `Rc` is dropped at the end of its iteration (the rest on an early return).
    for (let i = 0; i < watchers.length; i++) {
      const watcher = watchers[i]!;
      const r = this_.update_readiness(watcher, active_readiness, ReadinessUpdateFlags.contains(flags, ReadinessUpdateFlags.FORCE_EDGE), (callback) => {
        for (const [key, interest] of interests_of(watcher).range(range_for_id(fd_id))) {
          const r = callback(key, interest);
          if (r.$ === "Err") return r;
        }
        return interp_ok(undefined);
      });
      Rc_drop_ReadinessWatcher(watcher);
      if (r.$ === "Err") {
        for (const rest of watchers.slice(i + 1)) Rc_drop_ReadinessWatcher(rest);
        return r;
      }
    }

    return interp_ok(undefined);
  } finally {
    fd.drop();
  }
};

// ---- EvalContextPrivExt ----

/// Call this when the interests denoted by `for_each_interest` have their active readiness changed
/// to `active`. The list is provided indirectly via the `for_each_interest` closure, which
/// will call its argument closure for each relevant interest.
///
/// Any [`RefCell`]s should be released by the time `for_each_interest` returns since we will then
/// be waking up threads which might require access to those [`RefCell`]s.
// rustc: src/tools/miri/src/shims/readiness.rs:539 update_readiness
InterpCx.prototype.update_readiness = function (
  this: MiriInterpCx,
  watcher: ReadinessWatcher,
  active: Readiness,
  force_edge: boolean,
  for_each_interest: (_0: (_0: ReadinessInterestKey, _1: ReadinessInterest) => InterpResult) => InterpResult,
): InterpResult {
  const this_ = this.eval_context_mut();
  const ready = watcher.ready;
  {
    const r = for_each_interest((key, interest) => {
      const new_readiness = Readiness_bitand(interest.relevant, active);
      const prev_readiness = interest.active;
      interest.active = new_readiness;
      if (Readiness_eq(new_readiness, Readiness_EMPTY)) {
        // Un-trigger this, there's nothing left to report here.
        const idx = position_key(ready, key);
        if (idx !== undefined) {
          ready.splice(idx, 1);
        }
      } else if (force_edge || !Readiness_eq(new_readiness, Readiness_bitand(prev_readiness, new_readiness))) {
        // Either we force an "edge" to be detected or there's a bit set in `new_readiness`
        // that was not set in `prev_readiness`. In both cases, this is ready now.

        // We need to ensure that this event is not already part of the `ready` queue
        // before enqueueing, as Linux does it with epoll:
        // <https://github.com/torvalds/linux/blob/13dce771bbad42da6ecf086446d8ddfd1fce3a1b/fs/eventpoll.c#L1290-L1293>
        if (position_key(ready, key) === undefined) {
          ready.push(key);
        }
      }
      return interp_ok(undefined);
    });
    if (r.$ === "Err") return r;
  }

  // While there are events ready to be delivered, wake up a thread to receive them.
  while (watcher.ready.length > 0 && watcher.queue.length > 0) {
    const thread_id = watcher.queue.shift()!;
    const r = this_.unblock_thread(thread_id, BlockReason.Readiness);
    if (r.$ === "Err") return r;
  }
  return interp_ok(undefined);
};
