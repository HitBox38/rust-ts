// Port of compiler/rustc_data_structures/src/snapshot_map/mod.rs (used by rustc_infer's
// `ProjectionCache`).
//
// PORT: generics.
// - `M: BorrowMut<FxHashMap<K, V>>` (an owned map, or `&mut` one after `with_log`) is the `Map`
//   itself; `with_log` shares it. A `SnapshotMap` is never iterated (only `insert` / `remove` / `get`
//   / `index` / `clear`), so the `FxHashMap` is a plain JS `Map` (PORTING §5): keys are primitives or
//   interned handles, compared by identity. `V` must not be `undefined`.
// - `L` is the undo log (`VecLog` by default, `undefined` for the `()` of `SnapshotMapStorage`, or
//   an external `UndoLogs` after `with_log`); methods that need `L: UndoLogs` say so in their `this`.
// - `K: Clone` is the key itself (keys are immutable).

import { panic } from "../../std/panic.ts";
import { type Snapshot, type UndoLogs, VecLog } from "../../vendor/ena/undo_log.ts";

export type { Snapshot } from "../../vendor/ena/undo_log.ts";

export type SnapshotMapStorage<K, V> = SnapshotMap<K, V, undefined>;
export type SnapshotMapRef<K, V, L> = SnapshotMap<K, V, L>;

export class SnapshotMap<K, V, L = VecLog<UndoLog<K, V>>> {
  constructor(
    public map: Map<K, V>,
    public undo_log: L,
  ) {}

  // HACK(eddyb) manual impl avoids `Default` bounds on `K` and `V`.
  // PORT: `L: Default` is `L_default`.
  // rustc: compiler/rustc_data_structures/src/snapshot_map/mod.rs:29 default
  static default<K, V, L>(L_default: () => L): SnapshotMap<K, V, L> {
    return new SnapshotMap<K, V, L>(new Map(), L_default());
  }

  // rustc: compiler/rustc_data_structures/src/snapshot_map/mod.rs:43 with_log
  with_log<L2>(undo_log: L2): SnapshotMap<K, V, L2> {
    return new SnapshotMap<K, V, L2>(this.map, undo_log);
  }

  // rustc: compiler/rustc_data_structures/src/snapshot_map/mod.rs:54 clear
  clear(this: SnapshotMap<K, V, UndoLogs<UndoLog<K, V>>>): void {
    this.map.clear();
    this.undo_log.clear();
  }

  // rustc: compiler/rustc_data_structures/src/snapshot_map/mod.rs:59 insert
  insert(this: SnapshotMap<K, V, UndoLogs<UndoLog<K, V>>>, key: K, value: V): boolean {
    // `self.map.borrow_mut().insert(key.clone(), value)`
    const had = this.map.has(key);
    const old_value = this.map.get(key) as V;
    this.map.set(key, value);
    if (!had) {
      this.undo_log.push({ $: "Inserted", _0: key });
      return true;
    } else {
      this.undo_log.push({ $: "Overwrite", _0: key, _1: old_value });
      return false;
    }
  }

  // rustc: compiler/rustc_data_structures/src/snapshot_map/mod.rs:72 remove
  remove(this: SnapshotMap<K, V, UndoLogs<UndoLog<K, V>>>, key: K): boolean {
    // `self.map.borrow_mut().remove(&key)`
    if (this.map.has(key)) {
      const old_value = this.map.get(key) as V;
      this.map.delete(key);
      this.undo_log.push({ $: "Overwrite", _0: key, _1: old_value });
      return true;
    } else {
      return false;
    }
  }

  // rustc: compiler/rustc_data_structures/src/snapshot_map/mod.rs:82 get
  get(key: K): V | undefined {
    return this.map.get(key);
  }

  // ---- impl<K, V> SnapshotMap<K, V> (the default `M` and `L`) ----

  // rustc: compiler/rustc_data_structures/src/snapshot_map/mod.rs:91 snapshot
  snapshot(this: SnapshotMap<K, V, VecLog<UndoLog<K, V>>>): Snapshot {
    return this.undo_log.start_snapshot();
  }

  // rustc: compiler/rustc_data_structures/src/snapshot_map/mod.rs:95 commit
  commit(this: SnapshotMap<K, V, VecLog<UndoLog<K, V>>>, snapshot: Snapshot): void {
    this.undo_log.commit(snapshot);
  }

  // rustc: compiler/rustc_data_structures/src/snapshot_map/mod.rs:99 rollback_to
  rollback_to(this: SnapshotMap<K, V, VecLog<UndoLog<K, V>>>, snapshot: Snapshot): void {
    const map = this.map;
    this.undo_log.rollback_to(() => ({ reverse: (undo: UndoLog<K, V>) => reverse_FxHashMap(map, undo) }), snapshot);
  }

  // ---- impl ops::Index<&K> ----

  // rustc: compiler/rustc_data_structures/src/snapshot_map/mod.rs:111 index
  index(key: K): V {
    // `&self.map.borrow()[key]` (std's `Index`: `self.get(key).expect("no entry found for key")`)
    if (!this.map.has(key)) panic("no entry found for key");
    return this.map.get(key) as V;
  }

  // ---- impl Rollback<UndoLog<K, V>> for SnapshotMap (M: Rollback) ----

  // rustc: compiler/rustc_data_structures/src/snapshot_map/mod.rs:121 reverse
  reverse(undo: UndoLog<K, V>): void {
    reverse_FxHashMap(this.map, undo);
  }
}

export type UndoLog<K, V> =
  | { readonly $: "Inserted"; readonly _0: K }
  | { readonly $: "Overwrite"; readonly _0: K; readonly _1: V }
  | { readonly $: "Purged" };

/** `impl<K, V> Rollback<UndoLog<K, V>> for FxHashMap<K, V>` */
// rustc: compiler/rustc_data_structures/src/snapshot_map/mod.rs:130 reverse
export function reverse_FxHashMap<K, V>(self: Map<K, V>, undo: UndoLog<K, V>): void {
  switch (undo.$) {
    case "Inserted": {
      const key = undo._0;
      self.delete(key);
      break;
    }

    case "Overwrite": {
      const [key, old_value] = [undo._0, undo._1];
      self.set(key, old_value);
      break;
    }

    case "Purged":
      break;
  }
}

