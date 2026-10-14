// Port of ena =0.14.4 `src/snapshot_vec.rs` (re-exported by rustc_data_structures as `snapshot_vec`).
//
// PORT: generics.
// - `D: SnapshotVecDelegate` is a dictionary (`SnapshotVecDelegate<Value, Undo>`); its associated
//   types `Value` / `Undo` are the type parameters of `UndoLog` / `SnapshotVec`. The `PhantomData<D>`
//   field of `SnapshotVec` holds that dictionary (`D`). `D::Value: Clone` (needed by `update` and
//   `Clone`) is `D.clone_Value`.
// - `V: VecLike<D>` is always a `Value[]`: `Vec<D::Value>` and `&mut Vec<D::Value>` are both the
//   array itself (`with_log` shares it), so the `&mut Vec` impls are `crate-skip`ped.
// - `L` is the undo log (`VecLog`, an external `UndoLogs`, or `undefined` for `()`): methods that
//   need `L: UndoLogs` / `L: Snapshots` say so in their `this` type.
// - `&mut D::Value` (`get_mut`, `update`'s `op`) is the element itself: values updated in place are
//   objects (ena's `VarValue`, rustc's `TypeVariableData`).
// `debug!` stays a comment.
//
//! A utility class for implementing "snapshottable" things; a snapshottable data structure permits
//! you to take a snapshot (via `start_snapshot`) and then, after making some changes, elect either
//! to rollback to the start of the snapshot or commit those changes.
//!
//! This vector is intended to be used as part of an abstraction, not serve as a complete
//! abstraction on its own. As such, while it will roll back most changes on its own, it also
//! supports a `get_mut` operation that gives you an arbitrary mutable pointer into the vector. To
//! ensure that any changes you make this with this pointer are rolled back, you must invoke
//! `record` to record any changes you make and also supplying a delegate capable of reversing
//! those changes.

import { type Debug, debug_struct, debug_tuple, debug_vec, type Fmt } from "../../std/fmt.ts";
import { assert, panic } from "../../std/panic.ts";
import { type Rollback, type Snapshot as UndoLogSnapshot, type Snapshots, type UndoLogs, VecLog } from "./undo_log.ts";

export type UndoLog<Value, Undo> =
  /// New variable with given index was created.
  | { readonly $: "NewElem"; readonly _0: number }
  /// Variable with given index was changed *from* the given value.
  | { readonly $: "SetElem"; readonly _0: number; readonly _1: Value }
  /// Extensible set of actions
  | { readonly $: "Other"; readonly _0: Undo };

/** `#[derive(Debug)] UndoLog<D>` */
export function debug_UndoLog<Value, Undo>(v: UndoLog<Value, Undo>, f: Fmt, debug_Value: Debug<Value>, debug_Undo: Debug<Undo>): string {
  switch (v.$) {
    case "NewElem":
      return debug_tuple(f, "NewElem", [String(v._0)]);
    case "SetElem":
      return debug_tuple(f, "SetElem", [String(v._0), debug_Value(v._1, f)]);
    case "Other":
      return debug_tuple(f, "Other", [debug_Undo(v._0, f)]);
  }
}

/** `impl<D: SnapshotVecDelegate> Rollback<UndoLog<D>> for Vec<D::Value>` */
// crate: ena-0.14.4/src/snapshot_vec.rs:49 reverse
export function reverse_Vec<Value, Undo>(D: SnapshotVecDelegate<Value, Undo>, self: Value[], undo: UndoLog<Value, Undo>): void {
  switch (undo.$) {
    case "NewElem": {
      const i = undo._0;
      self.pop();
      assert(self.length === i, "assertion failed: Vec::len(self) == i");
      break;
    }

    case "SetElem": {
      const [i, v] = [undo._0, undo._1];
      index_check(self, i);
      self[i] = v;
      break;
    }

    case "Other": {
      const u = undo._0;
      D.reverse(self, u);
      break;
    }
  }
}

// PORT: `trait VecLike<D>` over `Value[]` (its only implementor here); the methods take the vector.
export interface VecLike {
  // crate: ena-0.14.4/src/snapshot_vec.rs:71 push
  push<Value>(self: Value[], item: Value): void;
  // crate: ena-0.14.4/src/snapshot_vec.rs:72 len
  len<Value>(self: readonly Value[]): number;
  // crate: ena-0.14.4/src/snapshot_vec.rs:73 reserve
  reserve<Value>(self: Value[], size: number): void;
}

/** `impl<D> VecLike<D> for Vec<D::Value>` */
export const VecLike_Vec: VecLike = {
  // crate: ena-0.14.4/src/snapshot_vec.rs:80 push
  push<Value>(self: Value[], item: Value): void {
    self.push(item);
  },
  // crate: ena-0.14.4/src/snapshot_vec.rs:83 len
  len<Value>(self: readonly Value[]): number {
    return self.length;
  },
  // crate: ena-0.14.4/src/snapshot_vec.rs:86 reserve
  reserve<Value>(_self: Value[], _size: number): void {
    // `Vec::reserve`: capacity is not modeled.
  },
};

// crate-skip: ena-0.14.4/src/snapshot_vec.rs:95 push forwarding impl for &mut Vec (erased)
// crate-skip: ena-0.14.4/src/snapshot_vec.rs:98 len forwarding impl for &mut Vec (erased)
// crate-skip: ena-0.14.4/src/snapshot_vec.rs:101 reserve forwarding impl for &mut Vec (erased)

/** `SnapshotVec<D, Vec<D::Value>, ()>`: no undo log of its own; mutate it through `with_log`. */
export type SnapshotVecStorage<Value, Undo> = SnapshotVec<Value, Undo, undefined>;

// Snapshots are tokens that should be created/consumed linearly.
export interface Snapshot<S = UndoLogSnapshot> {
  readonly value_count: number;
  readonly snapshot: S;
}

export interface SnapshotVecDelegate<Value, Undo> {
  /** PORT: `D::Value: Clone`. */
  clone_Value(v: Value): Value;

  // crate: ena-0.14.4/src/snapshot_vec.rs:144 reverse
  reverse(values: Value[], action: Undo): void;
}

export class SnapshotVec<Value, Undo, L = VecLog<UndoLog<Value, Undo>>> {
  constructor(
    public values: Value[],
    public undo_log: L,
    /** PORT: `_marker: PhantomData<D>` holds `D`. */
    readonly D: SnapshotVecDelegate<Value, Undo>,
  ) {}

  // HACK(eddyb) manual impl avoids `Default` bound on `D`.
  // PORT: `L: Default` is `L_default`.
  // crate: ena-0.14.4/src/snapshot_vec.rs:149 default
  static default<Value, Undo, L>(D: SnapshotVecDelegate<Value, Undo>, L_default: () => L): SnapshotVec<Value, Undo, L> {
    return new SnapshotVec<Value, Undo, L>([], L_default(), D);
  }

  /// Creates a new `SnapshotVec`. If `L` is set to `()` then most mutating functions will not
  /// be accessible without calling `with_log` and supplying a compatibly `UndoLogs` instance.
  // crate: ena-0.14.4/src/snapshot_vec.rs:161 new
  static new<Value, Undo, L>(D: SnapshotVecDelegate<Value, Undo>, L_default: () => L): SnapshotVec<Value, Undo, L> {
    return SnapshotVec.default(D, L_default);
  }

  /// Creates a `SnapshotVec` using the `undo_log`, allowing mutating methods to be called
  // crate: ena-0.14.4/src/snapshot_vec.rs:168 with_log
  with_log<L2 extends UndoLogs<UndoLog<Value, Undo>>>(this: SnapshotVecStorage<Value, Undo>, undo_log: L2): SnapshotVec<Value, Undo, L2> {
    return new SnapshotVec<Value, Undo, L2>(this.values, undo_log, this.D);
  }

  // crate: ena-0.14.4/src/snapshot_vec.rs:184 with_capacity
  static with_capacity<Value, Undo, L>(D: SnapshotVecDelegate<Value, Undo>, _c: number, L_default: () => L): SnapshotVec<Value, Undo, L> {
    // `Vec::with_capacity(c)`: capacity is not modeled.
    return new SnapshotVec<Value, Undo, L>([], L_default(), D);
  }

  // crate: ena-0.14.4/src/snapshot_vec.rs:194 len
  len(): number {
    return VecLike_Vec.len(this.values);
  }

  // crate: ena-0.14.4/src/snapshot_vec.rs:198 get
  get(index: number): Value {
    index_check(this.values, index);
    return this.values[index]!;
  }

  /// Returns a mutable pointer into the vec; whatever changes you make here cannot be undone
  /// automatically, so you should be sure call `record()` with some sort of suitable undo
  /// action.
  // crate: ena-0.14.4/src/snapshot_vec.rs:205 get_mut
  get_mut(index: number): Value {
    index_check(this.values, index);
    return this.values[index]!;
  }

  /// Reserve space for new values, just like an ordinary vec.
  // crate: ena-0.14.4/src/snapshot_vec.rs:210 reserve
  reserve(additional: number): void {
    // This is not affected by snapshots or anything.
    VecLike_Vec.reserve(this.values, additional);
  }

  // crate: ena-0.14.4/src/snapshot_vec.rs:217 in_snapshot
  in_snapshot(this: SnapshotVec<Value, Undo, UndoLogs<UndoLog<Value, Undo>>>): boolean {
    return this.undo_log.in_snapshot();
  }

  // crate: ena-0.14.4/src/snapshot_vec.rs:221 record
  record(this: SnapshotVec<Value, Undo, UndoLogs<UndoLog<Value, Undo>>>, action: Undo): void {
    if (this.in_snapshot()) {
      this.undo_log.push({ $: "Other", _0: action });
    }
  }

  // crate: ena-0.14.4/src/snapshot_vec.rs:227 push
  push(this: SnapshotVec<Value, Undo, UndoLogs<UndoLog<Value, Undo>>>, elem: Value): number {
    const len = VecLike_Vec.len(this.values);
    VecLike_Vec.push(this.values, elem);

    if (this.in_snapshot()) {
      this.undo_log.push({ $: "NewElem", _0: len });
    }

    return len;
  }

  /// Updates the element at the given index. The old value will saved (and perhaps restored) if
  /// a snapshot is active.
  // crate: ena-0.14.4/src/snapshot_vec.rs:240 set
  set(this: SnapshotVec<Value, Undo, UndoLogs<UndoLog<Value, Undo>>>, index: number, new_elem: Value): void {
    // `mem::replace(&mut self.values.as_mut()[index], new_elem)`
    index_check(this.values, index);
    const old_elem = this.values[index]!;
    this.values[index] = new_elem;
    if (this.undo_log.in_snapshot()) {
      this.undo_log.push({ $: "SetElem", _0: index, _1: old_elem });
    }
  }

  /// Updates all elements. Potentially more efficient -- but
  /// otherwise equivalent to -- invoking `set` for each element.
  // crate: ena-0.14.4/src/snapshot_vec.rs:249 set_all
  set_all(this: SnapshotVec<Value, Undo, UndoLogs<UndoLog<Value, Undo>>>, new_elems: (index: number) => Value): void {
    if (!this.undo_log.in_snapshot()) {
      for (let index = 0; index < this.values.length; index++) {
        this.values[index] = new_elems(index);
      }
    } else {
      for (let i = 0; i < VecLike_Vec.len(this.values); i++) {
        this.set(i, new_elems(i));
      }
    }
  }

  // crate: ena-0.14.4/src/snapshot_vec.rs:261 update
  update(this: SnapshotVec<Value, Undo, UndoLogs<UndoLog<Value, Undo>>>, index: number, op: (value: Value) => void): void {
    if (this.undo_log.in_snapshot()) {
      index_check(this.values, index);
      const old_elem = this.D.clone_Value(this.values[index]!);
      this.undo_log.push({ $: "SetElem", _0: index, _1: old_elem });
    }
    index_check(this.values, index);
    op(this.values[index]!);
  }

  // crate: ena-0.14.4/src/snapshot_vec.rs:280 start_snapshot
  start_snapshot<S>(this: SnapshotVec<Value, Undo, Snapshots<UndoLog<Value, Undo>, S>>): Snapshot<S> {
    return {
      value_count: VecLike_Vec.len(this.values),
      snapshot: this.undo_log.start_snapshot(),
    };
  }

  // crate: ena-0.14.4/src/snapshot_vec.rs:287 actions_since_snapshot
  actions_since_snapshot<S>(this: SnapshotVec<Value, Undo, Snapshots<UndoLog<Value, Undo>, S>>, snapshot: Snapshot<S>): readonly UndoLog<Value, Undo>[] {
    return this.undo_log.actions_since_snapshot(snapshot.snapshot);
  }

  // crate: ena-0.14.4/src/snapshot_vec.rs:291 rollback_to
  rollback_to<S>(this: SnapshotVec<Value, Undo, Snapshots<UndoLog<Value, Undo>, S>>, snapshot: Snapshot<S>): void {
    // `&mut self.values` (`V: Rollback<UndoLog<D>>`)
    const D = this.D;
    const values = this.values;
    const rollback: Rollback<UndoLog<Value, Undo>> = { reverse: (undo) => reverse_Vec(D, values, undo) };
    this.undo_log.rollback_to(() => rollback, snapshot.snapshot);
  }

  /// Commits all changes since the last snapshot. Of course, they
  /// can still be undone if there is a snapshot further out.
  // crate: ena-0.14.4/src/snapshot_vec.rs:298 commit
  commit<S>(this: SnapshotVec<Value, Undo, Snapshots<UndoLog<Value, Undo>, S>>, snapshot: Snapshot<S>): void {
    this.undo_log.commit(snapshot.snapshot);
  }

  // ---- impl Deref / DerefMut (Target = [D::Value]) ----

  // crate: ena-0.14.4/src/snapshot_vec.rs:305 deref
  // crate: ena-0.14.4/src/snapshot_vec.rs:311 deref_mut
  deref(): Value[] {
    return this.values;
  }

  // ---- impl Index / IndexMut<usize> ----

  // crate: ena-0.14.4/src/snapshot_vec.rs:317 index
  index(index: number): Value {
    return this.get(index);
  }

  // crate: ena-0.14.4/src/snapshot_vec.rs:324 index_mut
  index_mut(index: number): Value {
    return this.get_mut(index);
  }

  // ---- impl Extend<D::Value> for SnapshotVec<D, V> ----

  // PORT: the iterable's elements are appended as `Vec::extend` would.
  // crate: ena-0.14.4/src/snapshot_vec.rs:332 extend
  extend(this: SnapshotVec<Value, Undo, VecLog<UndoLog<Value, Undo>>>, iterable: Iterable<Value>): void {
    const initial_len = VecLike_Vec.len(this.values);
    for (const v of iterable) this.values.push(v);
    const final_len = VecLike_Vec.len(this.values);

    if (this.in_snapshot()) {
      this.undo_log.extend(
        (function* (): Generator<UndoLog<Value, Undo>> {
          for (let len = initial_len; len < final_len; len++) yield { $: "NewElem", _0: len };
        })(),
      );
    }
  }

  // ---- impl Clone ----

  // PORT: `V: Clone` clones each element with `D.clone_Value`; `L: Clone` is `clone_L`.
  // crate: ena-0.14.4/src/snapshot_vec.rs:352 clone
  clone(clone_L: (l: L) => L): SnapshotVec<Value, Undo, L> {
    return new SnapshotVec<Value, Undo, L>(
      this.values.map((v) => this.D.clone_Value(v)),
      clone_L(this.undo_log),
      this.D,
    );
  }

  // ---- impl Rollback<UndoLog<D>> for SnapshotVecStorage<D> ----

  // crate: ena-0.14.4/src/snapshot_vec.rs:44 reverse
  reverse(this: SnapshotVecStorage<Value, Undo>, undo: UndoLog<Value, Undo>): void {
    reverse_Vec(this.D, this.values, undo);
  }
}

/** `impl fmt::Debug for SnapshotVec` (`V: Debug` is `debug_Value` over the vector, `L: Debug` is `debug_L`). */
// crate: ena-0.14.4/src/snapshot_vec.rs:126 fmt
export function debug_SnapshotVec<Value, Undo, L>(v: SnapshotVec<Value, Undo, L>, fmt: Fmt, debug_Value: Debug<Value>, debug_L: Debug<L>): string {
  return debug_struct(fmt, "SnapshotVec", [
    ["values", debug_vec(v.values, fmt, debug_Value)],
    ["undo_log", debug_L(v.undo_log, fmt)],
  ]);
}

/** `impl Clone for UndoLog<D>` (`D::Value: Clone`, `D::Undo: Clone`). */
// crate: ena-0.14.4/src/snapshot_vec.rs:366 clone
export function clone_UndoLog<Value, Undo>(self: UndoLog<Value, Undo>, clone_Value: (v: Value) => Value, clone_Undo: (u: Undo) => Undo): UndoLog<Value, Undo> {
  switch (self.$) {
    case "NewElem":
      return { $: "NewElem", _0: self._0 };
    case "SetElem":
      return { $: "SetElem", _0: self._0, _1: clone_Value(self._1) };
    case "Other":
      return { $: "Other", _0: clone_Undo(self._0) };
  }
}

/** `impl SnapshotVecDelegate for i32` (`Value = i32`, `Undo = ()`). */
export const SnapshotVecDelegate_i32: SnapshotVecDelegate<number, undefined> = {
  clone_Value: (v) => v,

  // crate: ena-0.14.4/src/snapshot_vec.rs:379 reverse
  reverse(_values: number[], _action: undefined): void {},
};

/** Slice indexing's bounds check (`index out of bounds` panic). */
function index_check(values: readonly unknown[], index: number): void {
  if (!(index < values.length)) {
    panic(`index out of bounds: the len is ${values.length} but the index is ${index}`);
  }
}
