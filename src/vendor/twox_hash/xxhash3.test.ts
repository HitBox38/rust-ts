// Port of the `#[cfg(test)] pub mod test` of twox-hash =2.1.2 `src/xxhash3.rs`.
import "./lib.ts";
import { expect, test } from "bun:test";
import { bp_as_chunks, bp_as_rchunks, DEFAULT_SECRET } from "./xxhash3.ts";

// crate: twox-hash-2.1.2/src/xxhash3.rs:364 default_secret_is_valid
test("default_secret_is_valid", () => {
  expect(DEFAULT_SECRET.is_valid()).toBe(true);
});

// crate: twox-hash-2.1.2/src/xxhash3.rs:369 backported_as_chunks
test("backported_as_chunks", () => {
  const x = [1, 2, 3, 4, 5];

  let [a, b] = bp_as_chunks(x, 1);
  expect(a).toEqual([[1], [2], [3], [4], [5]]);
  expect(b).toEqual([]);

  [a, b] = bp_as_chunks(x, 2);
  expect(a).toEqual([[1, 2], [3, 4]]);
  expect(b).toEqual([5]);

  [a, b] = bp_as_chunks(x, 3);
  expect(a).toEqual([[1, 2, 3]]);
  expect(b).toEqual([4, 5]);

  [a, b] = bp_as_chunks(x, 4);
  expect(a).toEqual([[1, 2, 3, 4]]);
  expect(b).toEqual([5]);

  [a, b] = bp_as_chunks(x, 5);
  expect(a).toEqual([[1, 2, 3, 4, 5]]);
  expect(b).toEqual([]);

  [a, b] = bp_as_chunks(x, 6);
  expect(a).toEqual([]);
  expect(b).toEqual([1, 2, 3, 4, 5]);
});

// crate: twox-hash-2.1.2/src/xxhash3.rs:398 backported_as_rchunks
test("backported_as_rchunks", () => {
  const x = [1, 2, 3, 4, 5];

  let [a, b] = bp_as_rchunks(x, 1);
  expect(a).toEqual([]);
  expect(b).toEqual([[1], [2], [3], [4], [5]]);

  [a, b] = bp_as_rchunks(x, 2);
  expect(a).toEqual([1]);
  expect(b).toEqual([[2, 3], [4, 5]]);

  [a, b] = bp_as_rchunks(x, 3);
  expect(a).toEqual([1, 2]);
  expect(b).toEqual([[3, 4, 5]]);

  [a, b] = bp_as_rchunks(x, 4);
  expect(a).toEqual([1]);
  expect(b).toEqual([[2, 3, 4, 5]]);

  [a, b] = bp_as_rchunks(x, 5);
  expect(a).toEqual([]);
  expect(b).toEqual([[1, 2, 3, 4, 5]]);

  [a, b] = bp_as_rchunks(x, 6);
  expect(a).toEqual([1, 2, 3, 4, 5]);
  expect(b).toEqual([]);
});

// PORT: also the `Uint8Array` form the crate uses (views, not copies).
test("bp_as_chunks on bytes gives views", () => {
  const x = Uint8Array.of(1, 2, 3, 4, 5);
  const [a, b] = bp_as_chunks(x, 2);
  expect(a.map((c) => [...c])).toEqual([[1, 2], [3, 4]]);
  expect([...b]).toEqual([5]);
  a[1]![0] = 9;
  expect(x[2]).toBe(9);
  const [c, d] = bp_as_rchunks(x, 2);
  expect([...c]).toEqual([1]);
  expect(d.map((e) => [...e])).toEqual([[2, 9], [4, 5]]);
});
