// Port of ena =0.14.4 `src/undo_log.rs` (the version in upstream's Cargo.lock; re-exported by
// rustc_data_structures as `undo_log`).
//
// PORT: traits are interfaces. `Snapshots<T>`'s associated type `Snapshot` is the type parameter `S`.
// Provided methods live in `UndoLogs_provided` / `Snapshots_provided` (PORTING §8); implementors
// forward to them. `&mut U` is `U`, so the forwarding impls for `&mut U` are `crate-skip`ped.
// `debug!` (the `log` crate) is never enabled in rustc and stays a comment.
//
//! Module which contains the snapshot/rollback functionality of the `ena` data structures.
//!
//! For most usecases this is just an internal implementation detail. However if many `ena`
//! data structures are snapshotted simultaneously it is possible to use
//! `UnificationTableStorage`/`SnapshotVecStorage` instead and use a custom `UndoLogs<T>`
//! type capable of recording the actions of all used data structures.
//!
//! Since the `*Storage` variants do not have an undo log `with_log` must be called with the
//! unified log before any mutating actions.

import { type Debug, debug_struct, debug_vec, type Fmt } from "../../std/fmt.ts";
import { assert, unwrap } from "../../std/panic.ts";

/// A trait which allows undo actions (`T`) to be pushed which can be used to rollback actions at a
/// later time if needed.
///
/// The undo actions themselves are opaque to `UndoLogs`, only specified `Rollback` implementations
/// need to know what an action is and how to reverse it.
export interface UndoLogs<T> {
  /// True if a snapshot has started, false otherwise
  in_snapshot(): boolean; // (provided)

  /// How many open snapshots this undo log currently has
  // crate: ena-0.14.4/src/undo_log.rs:23 num_open_snapshots
  num_open_snapshots(): number;

  /// Pushes a new "undo item" onto the undo log. This method is invoked when some action is taken
  /// (e.g., a variable is unified). It records the info needed to reverse that action should an
  /// enclosing snapshot be rolled back.
  // crate: ena-0.14.4/src/undo_log.rs:28 push
  push(undo: T): void;

  /// Removes all items from the undo log.
  // crate: ena-0.14.4/src/undo_log.rs:31 clear
  clear(): void;

  /// Extends the undo log with many undos.
  extend(undos: Iterable<T>): void; // (provided)
}

/** The provided methods of `UndoLogs`. */
export const UndoLogs_provided = {
  // crate: ena-0.14.4/src/undo_log.rs:18 in_snapshot
  in_snapshot<T>(self: UndoLogs<T>): boolean {
    return self.num_open_snapshots() > 0;
  },

  // crate: ena-0.14.4/src/undo_log.rs:34 extend
  extend<T>(self: UndoLogs<T>, undos: Iterable<T>): void {
    for (const undo of undos) self.push(undo);
  },
};

// crate-skip: ena-0.14.4/src/undo_log.rs:47 in_snapshot forwarding impl for &mut U (erased)
// crate-skip: ena-0.14.4/src/undo_log.rs:50 num_open_snapshots forwarding impl for &mut U (erased)
// crate-skip: ena-0.14.4/src/undo_log.rs:53 push forwarding impl for &mut U (erased)
// crate-skip: ena-0.14.4/src/undo_log.rs:56 clear forwarding impl for &mut U (erased)
// crate-skip: ena-0.14.4/src/undo_log.rs:59 extend forwarding impl for &mut U (erased)

/// A trait which extends `UndoLogs` to allow snapshots to be done at specific points. Each snapshot can then be used to
/// rollback any changes to an underlying data structures if they were not desirable.
///
/// Each snapshot must be consumed linearly with either `rollback_to` or `commit`.
// PORT: `type Snapshot` is the type parameter `S`.
export interface Snapshots<T, S> extends UndoLogs<T> {
  /// Returns true if `self` has made any changes since snapshot started.
  has_changes(snapshot: S): boolean; // (provided)

  /// Returns the slice of actions that were taken since the snapshot began.
  // crate: ena-0.14.4/src/undo_log.rs:80 actions_since_snapshot
  actions_since_snapshot(snapshot: S): readonly T[];

  /// Starts a new snapshot. That snapshot must eventually either be committed via a call to
  /// commit or rollback via rollback_to. Snapshots can be nested (i.e., you can start a snapshot
  /// whilst another snapshot is in progress) but you must then commit or rollback the inner
  /// snapshot before attempting to commit or rollback the outer snapshot.
  // crate: ena-0.14.4/src/undo_log.rs:86 start_snapshot
  start_snapshot(): S;

  /// Rollback (undo) the changes made to `storage` since the snapshot.
  // crate: ena-0.14.4/src/undo_log.rs:89 rollback_to
  rollback_to<R extends Rollback<T>>(storage: () => R, snapshot: S): void;

  /// Commit: keep the changes that have been made since the snapshot began
  // crate: ena-0.14.4/src/undo_log.rs:94 commit
  commit(snapshot: S): void;
}

/** The provided methods of `Snapshots`. */
export const Snapshots_provided = {
  // crate: ena-0.14.4/src/undo_log.rs:75 has_changes
  has_changes<T, S>(self: Snapshots<T, S>, snapshot: S): boolean {
    return !(self.actions_since_snapshot(snapshot).length === 0);
  },
};

// crate-skip: ena-0.14.4/src/undo_log.rs:102 has_changes forwarding impl for &mut U (erased)
// crate-skip: ena-0.14.4/src/undo_log.rs:105 actions_since_snapshot forwarding impl for &mut U (erased)
// crate-skip: ena-0.14.4/src/undo_log.rs:109 start_snapshot forwarding impl for &mut U (erased)
// crate-skip: ena-0.14.4/src/undo_log.rs:112 rollback_to forwarding impl for &mut U (erased)
// crate-skip: ena-0.14.4/src/undo_log.rs:119 commit forwarding impl for &mut U (erased)

/** `pub struct NoUndo;` (`impl<T> UndoLogs<T> for NoUndo`) */
export class NoUndo<T = never> implements UndoLogs<T> {
  in_snapshot(): boolean {
    return UndoLogs_provided.in_snapshot(this);
  }

  // crate: ena-0.14.4/src/undo_log.rs:126 num_open_snapshots
  num_open_snapshots(): number {
    return 0;
  }

  // crate: ena-0.14.4/src/undo_log.rs:129 push
  push(_undo: T): void {}

  // crate: ena-0.14.4/src/undo_log.rs:130 clear
  clear(): void {}

  extend(undos: Iterable<T>): void {
    UndoLogs_provided.extend(this, undos);
  }
}

/// A basic undo log.
// PORT: the field `num_open_snapshots` is `num_open_snapshots_` (the method of the same name is
// `UndoLogs::num_open_snapshots`); `debug_VecLog` prints the upstream name.
export class VecLog<T> implements Snapshots<T, Snapshot> {
  constructor(
    public log: T[],
    public num_open_snapshots_: number,
  ) {}

  // ---- impl Default for VecLog ----

  // crate: ena-0.14.4/src/undo_log.rs:141 default
  static default<T>(): VecLog<T> {
    return new VecLog<T>([], 0);
  }

  /** `#[derive(Clone)]`: `clone_T` is `T: Clone`. */
  clone(clone_T: (t: T) => T): VecLog<T> {
    return new VecLog(this.log.map(clone_T), this.num_open_snapshots_);
  }

  // ---- impl UndoLogs<T> for VecLog<T> ----

  in_snapshot(): boolean {
    return UndoLogs_provided.in_snapshot(this);
  }

  // crate: ena-0.14.4/src/undo_log.rs:150 num_open_snapshots
  num_open_snapshots(): number {
    return this.num_open_snapshots_;
  }

  // crate: ena-0.14.4/src/undo_log.rs:153 push
  push(undo: T): void {
    this.log.push(undo);
  }

  // crate: ena-0.14.4/src/undo_log.rs:156 clear
  clear(): void {
    this.log.length = 0;
    this.num_open_snapshots_ = 0;
  }

  extend(undos: Iterable<T>): void {
    UndoLogs_provided.extend(this, undos);
  }

  // ---- impl Snapshots<T> for VecLog<T> ----

  // crate: ena-0.14.4/src/undo_log.rs:165 has_changes
  has_changes(snapshot: Snapshot): boolean {
    return this.log.length > snapshot.undo_len;
  }

  // crate: ena-0.14.4/src/undo_log.rs:168 actions_since_snapshot
  actions_since_snapshot(snapshot: Snapshot): readonly T[] {
    // `&self.log[snapshot.undo_len..]` (panics if out of range)
    assert(snapshot.undo_len <= this.log.length, `range start index ${snapshot.undo_len} out of range for slice of length ${this.log.length}`);
    return this.log.slice(snapshot.undo_len);
  }

  // crate: ena-0.14.4/src/undo_log.rs:172 start_snapshot
  start_snapshot(): Snapshot {
    this.num_open_snapshots_ += 1;
    return {
      undo_len: this.log.length,
    };
  }

  // crate: ena-0.14.4/src/undo_log.rs:179 rollback_to
  rollback_to<R extends Rollback<T>>(values_: () => R, snapshot: Snapshot): void {
    // debug!("rollback_to({})", snapshot.undo_len);

    this.assert_open_snapshot(snapshot);

    if (this.log.length > snapshot.undo_len) {
      const values = values_();
      while (this.log.length > snapshot.undo_len) {
        values.reverse(unwrap(this.log.pop()));
      }
    }

    this.num_open_snapshots_ -= 1;
  }

  // crate: ena-0.14.4/src/undo_log.rs:197 commit
  commit(snapshot: Snapshot): void {
    // debug!("commit({})", snapshot.undo_len);

    this.assert_open_snapshot(snapshot);

    if (this.num_open_snapshots_ === 1) {
      // The root snapshot. It's safe to clear the undo log because
      // there's no snapshot further out that we might need to roll back
      // to.
      assert(snapshot.undo_len === 0, "assertion failed: snapshot.undo_len == 0");
      this.log.length = 0;
    }

    this.num_open_snapshots_ -= 1;
  }

  // ---- impl VecLog<T> ----

  // crate: ena-0.14.4/src/undo_log.rs:215 assert_open_snapshot
  assert_open_snapshot(snapshot: Snapshot): void {
    // Failures here may indicate a failure to follow a stack discipline.
    assert(this.log.length >= snapshot.undo_len, "assertion failed: self.log.len() >= snapshot.undo_len");
    assert(this.num_open_snapshots_ > 0, "assertion failed: self.num_open_snapshots > 0");
  }

  // ---- impl Index<usize> for VecLog<T> ----

  // crate: ena-0.14.4/src/undo_log.rs:224 index
  index(key: number): T {
    // `&self.log[key]`
    assert(key < this.log.length, `index out of bounds: the len is ${this.log.length} but the index is ${key}`);
    return this.log[key]!;
  }
}

/** `#[derive(Debug)] VecLog<T>` */
export function debug_VecLog<T>(v: VecLog<T>, f: Fmt, debug_T: Debug<T>): string {
  return debug_struct(f, "VecLog", [
    ["log", debug_vec(v.log, f, debug_T)],
    ["num_open_snapshots", String(v.num_open_snapshots_)],
  ]);
}

/// A trait implemented for storage types (like `SnapshotVecStorage`) which can be rolled back using actions of type `U`.
export interface Rollback<U> {
  // crate: ena-0.14.4/src/undo_log.rs:231 reverse
  reverse(undo: U): void;
}

// crate-skip: ena-0.14.4/src/undo_log.rs:238 reverse forwarding impl for &mut T (erased)

/// Snapshots are tokens that should be created/consumed linearly.
export interface Snapshot {
  // Length of the undo log at the time the snapshot was taken.
  readonly undo_len: number;
}
