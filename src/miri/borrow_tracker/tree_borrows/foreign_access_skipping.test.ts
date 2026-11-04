// Port of `mod tests` of src/tools/miri/src/borrow_tracker/tree_borrows/foreign_access_skipping.rs (lane miri-tb-a), then
// lane checks of the companion fns (upstream only exercises them through tree/tests.rs).
import { expect, test } from "bun:test";
import { IdempotentForeignAccess, IdempotentForeignAccess_discriminant } from "./foreign_access_skipping.ts";

// #[test]
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/foreign_access_skipping.rs:102 test_order
test("test_order", () => {
  // The internal logic relies on this order.
  // Do not change.
  expect(IdempotentForeignAccess_discriminant.None < IdempotentForeignAccess_discriminant.Read).toBe(true);
  expect(IdempotentForeignAccess_discriminant.Read < IdempotentForeignAccess_discriminant.Write).toBe(true);
});

const ALL: IdempotentForeignAccess[] = ["None", "Read", "Write"];

test("can_skip_foreign_access: happening_next <= self", () => {
  const F = IdempotentForeignAccess;
  expect(F.can_skip_foreign_access("None", "Read")).toBe(false);
  expect(F.can_skip_foreign_access("None", "Write")).toBe(false);
  expect(F.can_skip_foreign_access("Read", "Read")).toBe(true);
  expect(F.can_skip_foreign_access("Read", "Write")).toBe(false);
  expect(F.can_skip_foreign_access("Write", "Read")).toBe(true);
  expect(F.can_skip_foreign_access("Write", "Write")).toBe(true);
});

test("record_new resets on a local access and otherwise takes the max", () => {
  const run = (start: IdempotentForeignAccess, just: IdempotentForeignAccess) => {
    const r = { value: start };
    IdempotentForeignAccess.record_new(r, just);
    return r.value;
  };
  for (const start of ALL) expect(run(start, "None")).toBe("None");
  expect(run("None", "Read")).toBe("Read");
  expect(run("Read", "Read")).toBe("Read");
  expect(run("Write", "Read")).toBe("Write");
  for (const start of ALL) expect(run(start, "Write")).toBe("Write");
});

test("is_local / is_foreign / from_foreign / from_acc_and_rel", () => {
  const F = IdempotentForeignAccess;
  expect(F.is_local("None")).toBe(true);
  expect(F.is_foreign("None")).toBe(false);
  expect(F.is_local("Read")).toBe(false);
  expect(F.is_foreign("Write")).toBe(true);
  expect(F.from_foreign("Read")).toBe("Read");
  expect(F.from_foreign("Write")).toBe("Write");
  expect(F.from_acc_and_rel("Read", "ForeignAccess")).toBe("Read");
  expect(F.from_acc_and_rel("Write", "ForeignAccess")).toBe("Write");
  expect(F.from_acc_and_rel("Read", "LocalAccess")).toBe("None");
  expect(F.from_acc_and_rel("Write", "LocalAccess")).toBe("None");
});

test("ensure_no_stronger_than weakens and says whether it did", () => {
  const run = (start: IdempotentForeignAccess, allowed: IdempotentForeignAccess): [IdempotentForeignAccess, boolean] => {
    const r = { value: start };
    const changed = IdempotentForeignAccess.ensure_no_stronger_than(r, allowed);
    return [r.value, changed];
  };
  expect(run("Write", "Read")).toEqual(["Read", true]);
  expect(run("Write", "None")).toEqual(["None", true]);
  expect(run("Read", "None")).toEqual(["None", true]);
  expect(run("Read", "Read")).toEqual(["Read", false]);
  expect(run("None", "Write")).toEqual(["None", false]);
});
