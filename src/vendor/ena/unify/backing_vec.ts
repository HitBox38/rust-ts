// Port of ena =0.14.4 `src/unify/backing_vec.rs`. Built without the `persistent` feature (rustc's
// Cargo.toml enables no ena features), so `Persistent` (dogged's `DVec`) is `crate-skip`ped.
//
// PORT: the store traits are interfaces generic over the key `K`, its value `V` and the value's
// `UnifyValue::Error` `E` (`UnificationStore` adds the associated `Snapshot` type as `Snap`). The
// associated type `Key` is the `UnifyKey` dictionary `Key` (`Value` is `Key.Value`). The
// `ops::Index<usize, Output = VarValue<Key<Self>>>` supertrait is the `index` method.
// `InPlace`'s `V: sv::VecLike` is always a `VarValue[]` (see snapshot_vec.ts).

import type { Range, UnifyKey, VarValue } from "./mod.ts";
import { SnapshotVec, type Snapshot as SvSnapshot, type SnapshotVecDelegate, type UndoLog as SvUndoLog } from "../snapshot_vec.ts";
import type { Snapshots, UndoLogs, VecLog } from "../undo_log.ts";

/// Largely internal trait implemented by the unification table
/// backing store types. The most common such type is `InPlace`,
/// which indicates a standard, mutable unification table.
export interface UnificationStoreBase<K, V, E> {
  /** PORT: `type Key: UnifyKey<Value = Self::Value>` (`type Value` is `Key.Value`). */
  readonly Key: UnifyKey<K, V, E>;

  /** PORT: the `ops::Index<usize, Output = VarValue<Key<Self>>>` supertrait. */
  index(index: number): VarValue<K, V>;

  // crate: ena-0.14.4/src/unify/backing_vec.rs:22 len
  len(): number;

  tag(): string; // (provided)
}

/** The provided methods of `UnificationStoreBase`. */
export const UnificationStoreBase_provided = {
  // crate: ena-0.14.4/src/unify/backing_vec.rs:24 tag
  tag<K, V, E>(self: UnificationStoreBase<K, V, E>): string {
    return self.Key.tag();
  },
};

export interface UnificationStoreMut<K, V, E> extends UnificationStoreBase<K, V, E> {
  // crate: ena-0.14.4/src/unify/backing_vec.rs:30 reset_unifications
  reset_unifications(value: (i: number) => VarValue<K, V>): void;

  // crate: ena-0.14.4/src/unify/backing_vec.rs:32 push
  push(value: VarValue<K, V>): void;

  // crate: ena-0.14.4/src/unify/backing_vec.rs:34 reserve
  reserve(num_new_values: number): void;

  // crate: ena-0.14.4/src/unify/backing_vec.rs:36 update
  update(index: number, op: (value: VarValue<K, V>) => void): void;
}

/** PORT: `type Snapshot` is the type parameter `Snap`. */
export interface UnificationStore<K, V, E, Snap> extends UnificationStoreMut<K, V, E> {
  // crate: ena-0.14.4/src/unify/backing_vec.rs:44 start_snapshot
  start_snapshot(): Snap;

  // crate: ena-0.14.4/src/unify/backing_vec.rs:46 rollback_to
  rollback_to(snapshot: Snap): void;

  // crate: ena-0.14.4/src/unify/backing_vec.rs:48 commit
  commit(snapshot: Snap): void;

  // crate: ena-0.14.4/src/unify/backing_vec.rs:50 values_since_snapshot
  values_since_snapshot(snapshot: Snap): Range<number>;
}

/** The undo log of an in-place table: `sv::UndoLog<Delegate<K>>` (`Undo = ()`). */
export type InPlaceUndoLog<K, V> = SvUndoLog<VarValue<K, V>, undefined>;

/// Backing store for an in-place unification table.
/// Not typically used directly.
// PORT: `L` is the undo log (`VecLog` by default, `undefined` for the `()` of
// `UnificationTableStorage`, or an external `UndoLogs` after `with_log`). `Key` holds `K: UnifyKey`.
export class InPlace<K, V, E, L = VecLog<InPlaceUndoLog<K, V>>> implements UnificationStoreBase<K, V, E> {
  constructor(
    public values: SnapshotVec<VarValue<K, V>, undefined, L>,
    readonly Key: UnifyKey<K, V, E>,
  ) {}

  // HACK(eddyb) manual impl avoids `Default` bound on `K`.
  // PORT: `K` is the key dictionary, `L: Default` is `L_default`.
  // crate: ena-0.14.4/src/unify/backing_vec.rs:66 default
  static default<K, V, E, L>(K: UnifyKey<K, V, E>, L_default: () => L): InPlace<K, V, E, L> {
    return new InPlace<K, V, E, L>(SnapshotVec.new(Delegate(K), L_default), K);
  }

  /** `#[derive(Clone)]`: `L: Clone` is `clone_L`. */
  clone(clone_L: (l: L) => L): InPlace<K, V, E, L> {
    return new InPlace(this.values.clone(clone_L), this.Key);
  }

  // ---- impl UnificationStoreBase for InPlace ----

  // crate: ena-0.14.4/src/unify/backing_vec.rs:81 len
  len(): number {
    return this.values.len();
  }

  tag(): string {
    return UnificationStoreBase_provided.tag(this);
  }

  // ---- impl UnificationStoreMut for InPlace (L: UndoLogs) ----

  // crate: ena-0.14.4/src/unify/backing_vec.rs:93 reset_unifications
  reset_unifications(this: InPlace<K, V, E, UndoLogs<InPlaceUndoLog<K, V>>>, value: (i: number) => VarValue<K, V>): void {
    this.values.set_all((i) => value(i));
  }

  // crate: ena-0.14.4/src/unify/backing_vec.rs:98 push
  push(this: InPlace<K, V, E, UndoLogs<InPlaceUndoLog<K, V>>>, value: VarValue<K, V>): void {
    this.values.push(value);
  }

  // crate: ena-0.14.4/src/unify/backing_vec.rs:103 reserve
  reserve(num_new_values: number): void {
    this.values.reserve(num_new_values);
  }

  // crate: ena-0.14.4/src/unify/backing_vec.rs:108 update
  update(this: InPlace<K, V, E, UndoLogs<InPlaceUndoLog<K, V>>>, index: number, op: (value: VarValue<K, V>) => void): void {
    this.values.update(index, op);
  }

  // ---- impl UnificationStore for InPlace (L: Snapshots) ----

  // crate: ena-0.14.4/src/unify/backing_vec.rs:125 start_snapshot
  start_snapshot<S>(this: InPlace<K, V, E, Snapshots<InPlaceUndoLog<K, V>, S>>): SvSnapshot<S> {
    return this.values.start_snapshot();
  }

  // crate: ena-0.14.4/src/unify/backing_vec.rs:130 rollback_to
  rollback_to<S>(this: InPlace<K, V, E, Snapshots<InPlaceUndoLog<K, V>, S>>, snapshot: SvSnapshot<S>): void {
    this.values.rollback_to(snapshot);
  }

  // crate: ena-0.14.4/src/unify/backing_vec.rs:135 commit
  commit<S>(this: InPlace<K, V, E, Snapshots<InPlaceUndoLog<K, V>, S>>, snapshot: SvSnapshot<S>): void {
    this.values.commit(snapshot);
  }

  // crate: ena-0.14.4/src/unify/backing_vec.rs:140 values_since_snapshot
  values_since_snapshot<S>(snapshot: SvSnapshot<S>): Range<number> {
    return { start: snapshot.value_count, end: this.len() };
  }

  // ---- impl ops::Index<usize> for InPlace ----

  // crate: ena-0.14.4/src/unify/backing_vec.rs:151 index
  index(index: number): VarValue<K, V> {
    return this.values.index(index);
  }
}

/** `#[doc(hidden)] pub struct Delegate<K>(PhantomData<K>);` PORT: holds the `K: UnifyKey` dictionary. */
export interface Delegate<K, V, E> extends SnapshotVecDelegate<VarValue<K, V>, undefined> {
  readonly K: UnifyKey<K, V, E>;
}

/** `impl<K: UnifyKey> sv::SnapshotVecDelegate for Delegate<K>` (`Value = VarValue<K>`, `Undo = ()`). */
export function Delegate<K, V, E>(K: UnifyKey<K, V, E>): Delegate<K, V, E> {
  return {
    K,
    // `VarValue<K>: Clone` (derived)
    clone_Value: (v) => v.clone(K.Value),

    // crate: ena-0.14.4/src/unify/backing_vec.rs:164 reverse
    reverse(_values: VarValue<K, V>[], _undo: undefined): void {},
  };
}

// The `impl Rollback<sv::UndoLog<Delegate<K>>> for UnificationTableStorage<K>` (backing_vec.rs:168) is
// `UnificationTable.reverse` in mod.ts.

// crate-skip: ena-0.14.4/src/unify/backing_vec.rs:182 default cfg(feature = "persistent") is off
// crate-skip: ena-0.14.4/src/unify/backing_vec.rs:194 len cfg(feature = "persistent") is off
// crate-skip: ena-0.14.4/src/unify/backing_vec.rs:202 reset_unifications cfg(feature = "persistent") is off
// crate-skip: ena-0.14.4/src/unify/backing_vec.rs:212 push cfg(feature = "persistent") is off
// crate-skip: ena-0.14.4/src/unify/backing_vec.rs:217 reserve cfg(feature = "persistent") is off
// crate-skip: ena-0.14.4/src/unify/backing_vec.rs:222 update cfg(feature = "persistent") is off
// crate-skip: ena-0.14.4/src/unify/backing_vec.rs:236 start_snapshot cfg(feature = "persistent") is off
// crate-skip: ena-0.14.4/src/unify/backing_vec.rs:241 rollback_to cfg(feature = "persistent") is off
// crate-skip: ena-0.14.4/src/unify/backing_vec.rs:246 commit cfg(feature = "persistent") is off
// crate-skip: ena-0.14.4/src/unify/backing_vec.rs:249 values_since_snapshot cfg(feature = "persistent") is off
// crate-skip: ena-0.14.4/src/unify/backing_vec.rs:260 index cfg(feature = "persistent") is off
