// Port of ena =0.14.4 `tests/external_undo_log.rs` (the integration test of an undo log shared by
// several ena structures; rustc_infer's `InferCtxtUndoLogs` follows the same pattern).
//
// PORT: `IntKey(u32)` is its `u32`. `impl<T> UndoLogs<T> for TypeVariableUndoLogs where UndoLog: From<T>`
// is `TypeVariableUndoLogs.as_(from)`: a view of the log at one `T`, `from` being `UndoLog::from`.
// `&mut TypeVariableUndoLogs` is the log itself.
import { expect, test } from "bun:test";
import { assert, assert_eq, unwrap } from "../../../std/panic.ts";
import { SnapshotVec, type SnapshotVecStorage, SnapshotVecDelegate_i32, type UndoLog as SvUndoLog } from "../snapshot_vec.ts";
import { type Rollback, type Snapshots, type UndoLogs, UndoLogs_provided } from "../undo_log.ts";
import {
  type EqUnifyValue,
  InPlace,
  type InPlaceUndoLog,
  UnificationTable,
  type UnificationTableStorage,
  type UnifyKey,
  UnifyKey_provided,
  UnifyValue_EqUnifyValue,
  UnifyValue_Option,
} from "../unify/mod.ts";

type IntKey = number;

/** `impl EqUnifyValue for IntKey {}` */
const IntKey_EqUnifyValue: EqUnifyValue<IntKey> = { eq: (a, b) => a === b, clone: (v) => v };

/** `#[derive(Copy, Clone, Debug, Hash, PartialEq, Eq)] struct IntKey(u32);` (`Value = Option<IntKey>`) */
const IntKey: UnifyKey<IntKey, IntKey | undefined, [IntKey, IntKey]> = {
  Value: UnifyValue_Option(UnifyValue_EqUnifyValue(IntKey_EqUnifyValue)),
  eq: (a, b) => a === b,
  // crate: ena-0.14.4/tests/external_undo_log.rs:16 index
  index(self: IntKey): number {
    return self;
  },
  // crate: ena-0.14.4/tests/external_undo_log.rs:19 from_index
  from_index(u: number): IntKey {
    return u;
  },
  // crate: ena-0.14.4/tests/external_undo_log.rs:22 tag
  tag(): string {
    return "IntKey";
  },
  order_roots: UnifyKey_provided.order_roots,
};

type EqRelationLog = InPlaceUndoLog<IntKey, IntKey | undefined>;
type ValuesLog = SvUndoLog<number, undefined>;

type UndoLog = { readonly $: "EqRelation"; readonly _0: EqRelationLog } | { readonly $: "Values"; readonly _0: ValuesLog };

/** `impl From<sv::UndoLog<ut::Delegate<IntKey>>> for UndoLog` */
// crate: ena-0.14.4/tests/external_undo_log.rs:35 from
function UndoLog_from_EqRelation(l: EqRelationLog): UndoLog {
  return { $: "EqRelation", _0: l };
}

/** `impl From<sv::UndoLog<i32>> for UndoLog` */
// crate: ena-0.14.4/tests/external_undo_log.rs:41 from
function UndoLog_from_Values(l: ValuesLog): UndoLog {
  return { $: "Values", _0: l };
}

class TypeVariableStorage implements Rollback<UndoLog> {
  constructor(
    public values: SnapshotVecStorage<number, undefined>,
    public eq_relations: UnificationTableStorage<IntKey, IntKey | undefined, [IntKey, IntKey]>,
  ) {}

  /** `#[derive(Default)]` */
  static default(): TypeVariableStorage {
    return new TypeVariableStorage(
      SnapshotVec.default(SnapshotVecDelegate_i32, () => undefined),
      UnificationTable.new(() => InPlace.default(IntKey, () => undefined)),
    );
  }

  // ---- impl Rollback<UndoLog> for TypeVariableStorage ----

  // crate: ena-0.14.4/tests/external_undo_log.rs:47 reverse
  reverse(undo: UndoLog): void {
    switch (undo.$) {
      case "EqRelation":
        this.eq_relations.reverse(undo._0);
        break;
      case "Values":
        this.values.reverse(undo._0);
        break;
    }
  }

  // crate: ena-0.14.4/tests/external_undo_log.rs:63 with_log
  with_log(undo_log: TypeVariableUndoLogs): TypeVariableTable {
    return new TypeVariableTable(this, undo_log);
  }

  // crate: ena-0.14.4/tests/external_undo_log.rs:70 len
  len(): number {
    assert_eq(this.values.len(), this.eq_relations.len(), String);
    return this.values.len();
  }
}

class TypeVariableTable {
  constructor(
    public storage: TypeVariableStorage,
    public undo_log: TypeVariableUndoLogs,
  ) {}

  // crate: ena-0.14.4/tests/external_undo_log.rs:83 new
  new(i: number): IntKey {
    this.storage.values.with_log(this.undo_log.as_(UndoLog_from_Values)).push(i);
    return this.storage.eq_relations.with_log(this.undo_log.as_(UndoLog_from_EqRelation)).new_key(undefined);
  }
}

interface Snapshot {
  readonly undo_len: number;
}

class TypeVariableUndoLogs implements Snapshots<UndoLog, Snapshot> {
  constructor(
    public logs: UndoLog[],
    public num_open_snapshots_: number,
  ) {}

  // crate: ena-0.14.4/tests/external_undo_log.rs:102 default
  static default(): TypeVariableUndoLogs {
    return new TypeVariableUndoLogs([], 0);
  }

  /** The `UndoLogs<T>` impl at one `T` (`UndoLog: From<T>` is `from`). */
  as_<T>(from: (t: T) => UndoLog): UndoLogs<T> {
    return new TypeVariableUndoLogsAt(this, from);
  }

  // `UndoLogs<UndoLog>` (`impl<T> From<T> for T`)
  in_snapshot(): boolean {
    return this.as_<UndoLog>((u) => u).in_snapshot();
  }
  num_open_snapshots(): number {
    return this.as_<UndoLog>((u) => u).num_open_snapshots();
  }
  push(undo: UndoLog): void {
    this.as_<UndoLog>((u) => u).push(undo);
  }
  clear(): void {
    this.as_<UndoLog>((u) => u).clear();
  }
  extend(undos: Iterable<UndoLog>): void {
    this.as_<UndoLog>((u) => u).extend(undos);
  }

  // ---- impl Snapshots<UndoLog> for TypeVariableUndoLogs ----

  has_changes(snapshot: Snapshot): boolean {
    return this.actions_since_snapshot(snapshot).length !== 0;
  }

  // crate: ena-0.14.4/tests/external_undo_log.rs:139 actions_since_snapshot
  actions_since_snapshot(snapshot: Snapshot): readonly UndoLog[] {
    return this.logs.slice(snapshot.undo_len);
  }

  // crate: ena-0.14.4/tests/external_undo_log.rs:143 start_snapshot
  start_snapshot(): Snapshot {
    this.num_open_snapshots_ += 1;
    return {
      undo_len: this.logs.length,
    };
  }

  // crate: ena-0.14.4/tests/external_undo_log.rs:150 rollback_to
  rollback_to<R extends Rollback<UndoLog>>(values_: () => R, snapshot: Snapshot): void {
    // debug!("rollback_to({})", snapshot.undo_len);

    if (this.logs.length > snapshot.undo_len) {
      const values = values_();
      while (this.logs.length > snapshot.undo_len) {
        values.reverse(unwrap(this.logs.pop()));
      }
    }

    if (this.num_open_snapshots_ === 1) {
      // The root snapshot. It's safe to clear the undo log because
      // there's no snapshot further out that we might need to roll back
      // to.
      assert(snapshot.undo_len === 0, "assertion failed: snapshot.undo_len == 0");
      this.logs.length = 0;
    }

    this.num_open_snapshots_ -= 1;
  }

  // crate: ena-0.14.4/tests/external_undo_log.rs:174 commit
  commit(snapshot: Snapshot): void {
    // debug!("commit({})", snapshot.undo_len);

    if (this.num_open_snapshots_ === 1) {
      // The root snapshot. It's safe to clear the undo log because
      // there's no snapshot further out that we might need to roll back
      // to.
      assert(snapshot.undo_len === 0, "assertion failed: snapshot.undo_len == 0");
      this.logs.length = 0;
    }

    this.num_open_snapshots_ -= 1;
  }
}

/** `impl<T> UndoLogs<T> for TypeVariableUndoLogs where UndoLog: From<T>` */
class TypeVariableUndoLogsAt<T> implements UndoLogs<T> {
  constructor(
    readonly self_: TypeVariableUndoLogs,
    readonly from: (t: T) => UndoLog,
  ) {}

  in_snapshot(): boolean {
    return UndoLogs_provided.in_snapshot(this);
  }

  // crate: ena-0.14.4/tests/external_undo_log.rs:114 num_open_snapshots
  num_open_snapshots(): number {
    return this.self_.num_open_snapshots_;
  }

  // crate: ena-0.14.4/tests/external_undo_log.rs:117 push
  push(undo: T): void {
    if (this.in_snapshot()) {
      this.self_.logs.push(this.from(undo));
    }
  }

  // crate: ena-0.14.4/tests/external_undo_log.rs:122 clear
  clear(): void {
    this.self_.logs.length = 0;
    this.self_.num_open_snapshots_ = 0;
  }

  // crate: ena-0.14.4/tests/external_undo_log.rs:126 extend
  extend(undos: Iterable<T>): void {
    if (this.in_snapshot()) {
      for (const undo of undos) this.self_.logs.push(this.from(undo));
    }
  }
}

/// Tests that a undo log stored externally can be used with TypeVariableTable
// crate: ena-0.14.4/tests/external_undo_log.rs:191 external_undo_log
test("external_undo_log", () => {
  const storage = TypeVariableStorage.default();
  const undo_log = TypeVariableUndoLogs.default();

  const snapshot = undo_log.start_snapshot();
  storage.with_log(undo_log).new(1);
  storage.with_log(undo_log).new(2);
  expect(storage.len()).toBe(2);

  undo_log.rollback_to(() => storage, snapshot);
  expect(storage.len()).toBe(0);
});
