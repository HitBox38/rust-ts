// Port of compiler/rustc_index/src/bit_set/tests.rs (subset: the `DenseBitSet` tests whose API is ported,
// see ../bit_set.ts; the `ChunkedBitSet` / `MixedBitSet` / `BitMatrix` tests and the benches are not).
import { expect, test } from "bun:test";
import { DenseBitSet } from "../bit_set.ts";

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
