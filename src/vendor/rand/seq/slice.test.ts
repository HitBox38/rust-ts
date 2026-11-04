// Port of rand =0.10.1 `src/seq/slice.rs` `#[cfg(test)] mod test`: the `shuffle` tests (the others exercise methods that
// are not ported).
import { expect, test } from "bun:test";
import { rng } from "../test_util.ts";
import { SliceRandom } from "./slice.ts";

// crate: rand-0.10.1/src/seq/slice.rs:616 test_shuffle
test("test_shuffle", () => {
  const r = rng(108n);
  const empty: number[] = [];
  SliceRandom.shuffle(empty, r);
  const one = [1];
  SliceRandom.shuffle(one, r);
  expect(one).toEqual([1]);

  const two = [1, 2];
  SliceRandom.shuffle(two, r);
  expect(two[0] === 1 ? two : [two[1], two[0]]).toEqual([1, 2]);

  // crate: rand-0.10.1/src/seq/slice.rs:629 move_last
  const move_last = (slice: number[], pos: number): void => {
    // use slice[pos..].rotate_left(1); once we can use that
    const last_val = slice[pos]!;
    for (let i = pos; i < slice.length - 1; i++) {
      slice[i] = slice[i + 1]!;
    }
    slice[slice.length - 1] = last_val;
  };
  const counts = new Array<number>(24).fill(0);
  for (let t = 0; t < 10000; t++) {
    const arr = [0, 1, 2, 3];
    SliceRandom.shuffle(arr, r);
    let permutation = 0;
    let pos_value = counts.length;
    for (let i = 0; i < 4; i++) {
      pos_value = Math.trunc(pos_value / (4 - i));
      const pos = arr.indexOf(i);
      if (!(pos < 4 - i)) throw new Error(`pos ${pos}`);
      permutation += pos * pos_value;
      move_last(arr, pos);
      if (arr[3] !== i) throw new Error(`arr[3] ${arr[3]}`);
    }
    expect(arr).toEqual([0, 1, 2, 3]);
    counts[permutation]! += 1;
  }
  for (const count of counts) {
    // Binomial(10000, 1/24) with average 416.667
    // Octave: binocdf(n, 10000, 1/24)
    // 99.9% chance samples lie within this range:
    expect(352 <= count && count <= 483).toBe(true);
  }
});

// crate: rand-0.10.1/src/seq/slice.rs:665 test_partial_shuffle
test("test_partial_shuffle", () => {
  const r = rng(118n);

  const empty: number[] = [];
  const res0 = SliceRandom.partial_shuffle(empty, r, 10);
  expect([res0[0].length, res0[1].length]).toEqual([0, 0]);

  const v = [1, 2, 3, 4, 5];
  const res = SliceRandom.partial_shuffle(v, r, 2);
  expect([res[0].length, res[1].length]).toEqual([2, 3]);
  expect(res[0][0] !== res[0][1]).toBe(true);
  // First elements are only modified if selected, so at least one isn't modified:
  expect(res[1][0] === 1 || res[1][1] === 2 || res[1][2] === 3).toBe(true);
});
