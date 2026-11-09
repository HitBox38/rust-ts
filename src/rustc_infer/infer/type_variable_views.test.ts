// Lane perf-tait: `TypeVariableStorage` keeps the last view of each kind (`with_log`, `eq_relations()`, `sub_unification_table()`)
// with the undo log it was made for. A kept view must act as a new one would: it is given out only for the same log object, it
// sees every write made through any other view, and a clone of the storage has views of its own.
import { expect, test } from "bun:test";
import "../lib.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { UniverseIndex } from "../../rustc_type_ir/lib.ts";
import { InferCtxtUndoLogs } from "./snapshot/undo_log.ts";
import { clone_TypeVariableStorage, TypeVariableStorage, type TypeVariableOrigin } from "./type_variable.ts";

const origin: TypeVariableOrigin = { span: DUMMY_SP, param_def_id: undefined };

test("a kept view is given out for the same log only, and sees writes made through other views", () => {
  const storage = TypeVariableStorage.default_();
  const log = InferCtxtUndoLogs.default_();
  const t1 = storage.with_log(log);
  expect(storage.with_log(log)).toBe(t1);
  expect(t1.eq_relations()).toBe(t1.eq_relations());
  expect(t1.sub_unification_table()).toBe(t1.sub_unification_table());

  const a = t1.new_var(UniverseIndex.ROOT, origin);
  const b = storage.with_log(log).new_var(UniverseIndex.ROOT, origin);
  // Another log object gets views of its own, over the same tables.
  const other = InferCtxtUndoLogs.default_();
  const t2 = storage.with_log(other);
  expect(t2).not.toBe(t1);
  expect(t2.eq_relations()).not.toBe(t1.eq_relations());
  expect(t2.sub_unification_table()).not.toBe(t1.sub_unification_table());
  expect(t2.num_vars()).toBe(2);
  t2.equate(a, b);
  // Back on the first log: a new view for it again, which sees the union made through `t2`.
  const t3 = storage.with_log(log);
  expect(t3.root_var(a)).toBe(t3.root_var(b));
  expect(t3.sub_unification_table_root_var(a)).toBe(t3.sub_unification_table_root_var(b));
  expect(t1.root_var(a)).toBe(t1.root_var(b));
});

test("writes under a snapshot go to the log the view was made for, and roll back", () => {
  const storage = TypeVariableStorage.default_();
  const log = InferCtxtUndoLogs.default_();
  const a = storage.with_log(log).new_var(UniverseIndex.ROOT, origin);
  const b = storage.with_log(log).new_var(UniverseIndex.ROOT, origin);
  const snapshot = log.start_snapshot();
  storage.with_log(log).equate(a, b);
  expect(log.logs.length).toBeGreaterThan(0);
  expect(storage.with_log(log).root_var(a)).toBe(storage.with_log(log).root_var(b));
  // Undo what the views logged (as `InferCtxtInner::rollback_to` does for this table).
  while (log.logs.length > snapshot.undo_len) {
    const undo = log.logs.pop()!;
    if (undo.$ === "TypeVariables") storage.reverse(undo._0);
  }
  log.num_open_snapshots_--;
  expect(storage.with_log(log).root_var(a)).not.toBe(storage.with_log(log).root_var(b));
});

test("a clone has views of its own", () => {
  const storage = TypeVariableStorage.default_();
  const log = InferCtxtUndoLogs.default_();
  const a = storage.with_log(log).new_var(UniverseIndex.ROOT, origin);
  const b = storage.with_log(log).new_var(UniverseIndex.ROOT, origin);
  const copy = clone_TypeVariableStorage(storage);
  expect(copy.with_log(log)).not.toBe(storage.with_log(log));
  copy.with_log(log).equate(a, b);
  expect(copy.with_log(log).root_var(a)).toBe(copy.with_log(log).root_var(b));
  expect(storage.with_log(log).root_var(a)).not.toBe(storage.with_log(log).root_var(b));
});

test("a kept sub_unification_table view logs to the log it was made for (review perf-tait N3)", () => {
  const storage = TypeVariableStorage.default_();
  const log = InferCtxtUndoLogs.default_();
  const a = storage.with_log(log).new_var(UniverseIndex.ROOT, origin);
  const b = storage.with_log(log).new_var(UniverseIndex.ROOT, origin);
  // Keep a sub view for `log`, which is in no snapshot, so nothing written through it is logged.
  storage.with_log(log).sub_unification_table();
  const other = InferCtxtUndoLogs.default_();
  other.start_snapshot();
  storage.with_log(other).sub_unify(a, b);
  expect(log.logs.length).toBe(0);
  expect(other.logs.some((u) => u.$ === "TypeVariables")).toBe(true);
  expect(storage.with_log(other).sub_unification_table_root_var(a)).toBe(storage.with_log(other).sub_unification_table_root_var(b));
});
