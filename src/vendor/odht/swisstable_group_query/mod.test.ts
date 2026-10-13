// Port of the `#[cfg(test)] mod tests` of odht =0.3.1 `src/swisstable_group_query/mod.rs` (run
// against the oracle host's group query, no_simd).
import { expect, test } from "bun:test";
import { GroupQuery, GROUP_SIZE } from "./mod.ts";

// const EMPTY_GROUP: [u8; GROUP_SIZE] = [255; GROUP_SIZE];
function EMPTY_GROUP(): Uint8Array {
  return new Uint8Array(GROUP_SIZE).fill(255);
}

// crate: odht-0.3.1/src/swisstable_group_query/mod.rs:32 full_group
function full_group(): Uint8Array {
  const group = new Uint8Array(GROUP_SIZE);
  for (let i = 0; i < group.length; i++) {
    group[i] = i;
  }
  return group;
}

/** `Iterator::count(&mut q)` */
function count(q: GroupQuery): number {
  let n = 0;
  for (const _ of q) n++;
  return n;
}

// crate: odht-0.3.1/src/swisstable_group_query/mod.rs:41 full
test("full", () => {
  const q = GroupQuery.from(full_group(), 42);

  expect(count(q)).toBe(0);
  expect(q.any_empty()).toBe(false);
  expect(q.first_empty()).toBeUndefined();
});

// crate: odht-0.3.1/src/swisstable_group_query/mod.rs:50 all_empty
test("all_empty", () => {
  const q = GroupQuery.from(EMPTY_GROUP(), 31);

  expect(count(q)).toBe(0);
  expect(q.any_empty()).toBe(true);
  expect(q.first_empty()).toBe(0);
});

// crate: odht-0.3.1/src/swisstable_group_query/mod.rs:59 partially_filled
test("partially_filled", () => {
  for (let filled_up_to_index = 0; filled_up_to_index <= GROUP_SIZE - 2; filled_up_to_index++) {
    const group = EMPTY_GROUP();

    for (let i = 0; i <= filled_up_to_index; i++) {
      group[i] = 42;
    }

    const q = GroupQuery.from(group, 77);

    expect(count(q)).toBe(0);
    expect(q.any_empty()).toBe(true);
    expect(q.first_empty()).toBe(filled_up_to_index + 1);
  }
});

// crate: odht-0.3.1/src/swisstable_group_query/mod.rs:76 match_iter
test("match_iter", () => {
  const expected: number[] = [];
  for (let x = 0; x < GROUP_SIZE; x++) if (x % 3 === 0) expected.push(x);

  const group = full_group();

  for (const i of expected) {
    group[i] = 103;
  }

  const q = GroupQuery.from(group, 103);

  const matches: number[] = [...q];

  expect(matches).toEqual(expected);
  expect(q.any_empty()).toBe(false);
  expect(q.first_empty()).toBeUndefined();
});

// crate: odht-0.3.1/src/swisstable_group_query/mod.rs:95 match_iter_with_empty
test("match_iter_with_empty", () => {
  const expected: number[] = [];
  for (let x = 0; x < GROUP_SIZE; x++) if (x % 3 === 2) expected.push(x);

  const group = full_group();

  for (const i of expected) {
    group[i] = 99;
  }

  // Clear a few slots
  group[3] = 255;
  group[4] = 255;
  group[GROUP_SIZE - 1] = 255;

  const q = GroupQuery.from(group, 99);

  const matches: number[] = [...q];

  expect(matches).toEqual(expected);
  expect(q.any_empty()).toBe(true);
  expect(q.first_empty()).toBe(3);
});
