// Port of compiler/rustc_index/src/bit_set/tests.rs (subset: the `DenseBitSet` and `BitMatrix` tests whose API is
// ported, see ../bit_set.ts; the `ChunkedBitSet` / `MixedBitSet` / `SparseBitMatrix` tests and the benches are not).
import { expect, test } from "bun:test";
import { BitMatrix, DenseBitSet } from "../bit_set.ts";

// rustc: compiler/rustc_index/src/bit_set/tests.rs:9 test_new_filled
test("test_new_filled", () => {
  for (let i = 0; i < 128; i++) {
    const idx_buf = DenseBitSet.new_filled<number>(i);
    const elems: number[] = [...idx_buf.iter()];
    const expected: number[] = Array.from({ length: i }, (_, k) => k);
    expect(elems).toEqual(expected);
  }
});

// rustc: compiler/rustc_index/src/bit_set/tests.rs:30 bitset_iter_works
test("bitset_iter_works", () => {
  const bitset = DenseBitSet.new_empty<number>(100);
  bitset.insert(1);
  bitset.insert(10);
  bitset.insert(19);
  bitset.insert(62);
  bitset.insert(63);
  bitset.insert(64);
  bitset.insert(65);
  bitset.insert(66);
  bitset.insert(99);
  expect([...bitset.iter()]).toEqual([1, 10, 19, 62, 63, 64, 65, 66, 99]);
});

// rustc: compiler/rustc_index/src/bit_set/tests.rs:45 bitset_iter_works_2
test("bitset_iter_works_2", () => {
  const bitset = DenseBitSet.new_empty<number>(320);
  bitset.insert(0);
  bitset.insert(127);
  bitset.insert(191);
  bitset.insert(255);
  bitset.insert(319);
  expect([...bitset.iter()]).toEqual([0, 127, 191, 255, 319]);
});

// rustc: compiler/rustc_index/src/bit_set/tests.rs:587 matrix_intersection
test("matrix_intersection", () => {
  const matrix: BitMatrix<number, number> = BitMatrix.new(200, 200);

  // (*) Elements reachable from both 2 and 65.

  matrix.insert(2, 3);
  matrix.insert(2, 6);
  matrix.insert(2, 10); // (*)
  matrix.insert(2, 64); // (*)
  matrix.insert(2, 65);
  matrix.insert(2, 130);
  matrix.insert(2, 160); // (*)

  matrix.insert(64, 133);

  matrix.insert(65, 2);
  matrix.insert(65, 8);
  matrix.insert(65, 10); // (*)
  matrix.insert(65, 64); // (*)
  matrix.insert(65, 68);
  matrix.insert(65, 133);
  matrix.insert(65, 160); // (*)

  let intersection = matrix.intersect_rows(2, 64);
  expect(intersection).toEqual([]);

  intersection = matrix.intersect_rows(2, 65);
  expect(intersection).toEqual([10, 64, 160]);
});

// rustc: compiler/rustc_index/src/bit_set/tests.rs:618 matrix_iter
test("matrix_iter", () => {
  const matrix: BitMatrix<number, number> = BitMatrix.new(64, 100);
  matrix.insert(3, 22);
  matrix.insert(3, 75);
  matrix.insert(2, 99);
  matrix.insert(4, 0);
  matrix.union_rows(3, 5);
  matrix.insert_all_into_row(6);

  expect([...matrix.iter(2)]).toEqual([99]);

  expect(matrix.count(3)).toBe(2);
  expect([...matrix.iter(3)]).toEqual([22, 75]);

  expect(matrix.count(4)).toBe(1);
  expect([...matrix.iter(4)]).toEqual([0]);

  expect(matrix.count(5)).toBe(2);
  expect([...matrix.iter(5)]).toEqual([22, 75]);

  expect(matrix.count(6)).toBe(100);
  let count = 0;
  let idx = 0;
  for (const i of matrix.iter(6)) {
    expect(i).toBe(idx);
    idx += 1;
    count += 1;
  }
  expect(count).toBe(100);

  expect(matrix.iter(7).next().done).toBe(true);
});
