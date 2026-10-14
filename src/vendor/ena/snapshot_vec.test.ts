// Port of the `#[test]`s of ena =0.14.4 `src/snapshot_vec.rs`.
// PORT: `#[should_panic]` is `expect(..).toThrow(Panic)`.
import { expect, test } from "bun:test";
import { Panic } from "../../std/panic.ts";
import { SnapshotVec, SnapshotVecDelegate_i32, type UndoLog } from "./snapshot_vec.ts";
import { VecLog } from "./undo_log.ts";

/** `let mut vec: SnapshotVec<i32> = SnapshotVec::default();` */
function new_vec(): SnapshotVec<number, undefined> {
  return SnapshotVec.default(SnapshotVecDelegate_i32, () => VecLog.default<UndoLog<number, undefined>>());
}

// crate: ena-0.14.4/src/snapshot_vec.rs:383 basic
test("basic", () => {
  const vec = new_vec();
  expect(!vec.in_snapshot()).toBe(true);
  expect(vec.len()).toBe(0);
  vec.push(22);
  vec.push(33);
  expect(vec.len()).toBe(2);
  expect(vec.get(0)).toBe(22);
  expect(vec.get(1)).toBe(33);
  vec.set(1, 34);
  expect(vec.len()).toBe(2);
  expect(vec.get(0)).toBe(22);
  expect(vec.get(1)).toBe(34);

  const snapshot = vec.start_snapshot();
  expect(vec.in_snapshot()).toBe(true);

  vec.push(44);
  vec.push(55);
  vec.set(1, 35);
  expect(vec.len()).toBe(4);
  expect(vec.get(0)).toBe(22);
  expect(vec.get(1)).toBe(35);
  expect(vec.get(2)).toBe(44);
  expect(vec.get(3)).toBe(55);

  vec.rollback_to(snapshot);
  expect(!vec.in_snapshot()).toBe(true);

  expect(vec.len()).toBe(2);
  expect(vec.get(0)).toBe(22);
  expect(vec.get(1)).toBe(34);
});

// #[should_panic]
// crate: ena-0.14.4/src/snapshot_vec.rs:419 out_of_order
test("out_of_order", () => {
  expect(() => {
    const vec = new_vec();
    vec.push(22);
    const snapshot1 = vec.start_snapshot();
    vec.push(33);
    const snapshot2 = vec.start_snapshot();
    vec.push(44);
    vec.rollback_to(snapshot1); // bogus, but accepted
    vec.rollback_to(snapshot2); // asserts
  }).toThrow(Panic);
});

// crate: ena-0.14.4/src/snapshot_vec.rs:431 nested_commit_then_rollback
test("nested_commit_then_rollback", () => {
  const vec = new_vec();
  vec.push(22);
  const snapshot1 = vec.start_snapshot();
  const snapshot2 = vec.start_snapshot();
  vec.set(0, 23);
  vec.commit(snapshot2);
  expect(vec.get(0)).toBe(23);
  vec.rollback_to(snapshot1);
  expect(vec.get(0)).toBe(22);
});
