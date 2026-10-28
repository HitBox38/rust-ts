// Port of the `#[cfg(test)] mod tests` of polonius-engine =0.13.0 `src/output/mod.rs`.
import { expect, test } from "bun:test";
import { compare_errors } from "./mod.ts";

// impl Atom for usize
// PORT: `usize` atoms are numbers; `index` is the identity.
// crate: polonius-engine-0.13.0/src/output/mod.rs:564 index
function index(self: number): number {
  return self;
}
void index;

// crate: polonius-engine-0.13.0/src/output/mod.rs:569 compare
function compare(errors1: ReadonlyMap<number, number[]>, errors2: ReadonlyMap<number, number[]>): boolean {
  const diff1 = compare_errors(errors1, errors2);
  const diff2 = compare_errors(errors2, errors1);
  expect(diff1).toBe(diff2);
  return diff1;
}

// crate: polonius-engine-0.13.0/src/output/mod.rs:580 test_compare_errors
test("test_compare_errors", () => {
  const empty = new Map<number, number[]>();
  expect(compare(empty, empty)).toBe(false);
  const empty_vec = new Map<number, number[]>();
  empty_vec.set(1, []);
  empty_vec.set(2, []);
  expect(compare(empty, empty_vec)).toBe(false);

  const singleton1 = new Map<number, number[]>();
  singleton1.set(1, [10]);
  expect(compare(singleton1, singleton1)).toBe(false);
  const singleton2 = new Map<number, number[]>();
  singleton2.set(1, [11]);
  expect(compare(singleton2, singleton2)).toBe(false);
  const singleton3 = new Map<number, number[]>();
  singleton3.set(2, [10]);
  expect(compare(singleton3, singleton3)).toBe(false);

  expect(compare(singleton1, singleton2)).toBe(true);
  expect(compare(singleton2, singleton3)).toBe(true);
  expect(compare(singleton1, singleton3)).toBe(true);

  expect(compare(empty, singleton1)).toBe(true);
  expect(compare(empty, singleton2)).toBe(true);
  expect(compare(empty, singleton3)).toBe(true);

  const errors1 = new Map<number, number[]>();
  errors1.set(1, [11]);
  errors1.set(2, [10]);
  expect(compare(errors1, errors1)).toBe(false);
  expect(compare(errors1, singleton1)).toBe(true);
  expect(compare(errors1, singleton2)).toBe(true);
  expect(compare(errors1, singleton3)).toBe(true);
});
