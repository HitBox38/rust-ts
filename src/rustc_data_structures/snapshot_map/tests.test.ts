// Port of compiler/rustc_data_structures/src/snapshot_map/tests.rs.
// PORT: `#[should_panic]` is `expect(..).toThrow(Panic)`; `SnapshotMap::default()` is
// `SnapshotMap<i32, &str>` with its default `VecLog`.
import { expect, test } from "bun:test";
import { Panic } from "../../std/panic.ts";
import { VecLog } from "../../vendor/ena/undo_log.ts";
import { SnapshotMap, type UndoLog } from "./mod.ts";

function new_map(): SnapshotMap<number, string> {
  return SnapshotMap.default(() => VecLog.default<UndoLog<number, string>>());
}

// rustc: compiler/rustc_data_structures/src/snapshot_map/tests.rs:4 basic
test("basic", () => {
  const map = new_map();
  map.insert(22, "twenty-two");
  const snapshot = map.snapshot();
  map.insert(22, "thirty-three");
  expect(map.index(22)).toBe("thirty-three");
  map.insert(44, "forty-four");
  expect(map.index(44)).toBe("forty-four");
  expect(map.get(33)).toBe(undefined);
  map.rollback_to(snapshot);
  expect(map.index(22)).toBe("twenty-two");
  expect(map.get(33)).toBe(undefined);
  expect(map.get(44)).toBe(undefined);
});

// #[should_panic]
// rustc: compiler/rustc_data_structures/src/snapshot_map/tests.rs:21 out_of_order
test("out_of_order", () => {
  expect(() => {
    const map = new_map();
    map.insert(22, "twenty-two");
    const snapshot1 = map.snapshot();
    map.insert(33, "thirty-three");
    const snapshot2 = map.snapshot();
    map.insert(44, "forty-four");
    map.rollback_to(snapshot1); // bogus, but accepted
    map.rollback_to(snapshot2); // asserts
  }).toThrow(Panic);
});

// rustc: compiler/rustc_data_structures/src/snapshot_map/tests.rs:33 nested_commit_then_rollback
test("nested_commit_then_rollback", () => {
  const map = new_map();
  map.insert(22, "twenty-two");
  const snapshot1 = map.snapshot();
  const snapshot2 = map.snapshot();
  map.insert(22, "thirty-three");
  map.commit(snapshot2);
  expect(map.index(22)).toBe("thirty-three");
  map.rollback_to(snapshot1);
  expect(map.index(22)).toBe("twenty-two");
});
