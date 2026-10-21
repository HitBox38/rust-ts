// Port of compiler/rustc_index/src/bit_set/tests.rs.
//
// PORT (D6): the expected `Mixed` chunk words are upstream's u64 literals, compared with `words_to_u64` of the u32
// words. `WORD_BITS` in the range tests is upstream's 64 (the u64 word boundaries; the u32 ones lie inside the ranges
// checked). `#[bench]` fns run their body a few times as plain tests.
import { expect, test } from "bun:test";
import {
  BitMatrix,
  CHUNK_BITS,
  type Chunk,
  ChunkedBitSet,
  ChunkedBitSet_eq,
  DenseBitSet,
  debug_DenseBitSet,
  GrowableBitSet,
  SparseBitMatrix,
  words_to_u64,
} from "../bit_set.ts";
import { range, range_contains, range_inclusive, range_iter, type RangeBounds } from "../idx.ts";
import { PLAIN } from "../../std/fmt.ts";

/** Upstream's `WORD_BITS` (`u64`). */
const WORD_BITS = 64;

/** A chunk as upstream's test literals write it (u64 words for `Mixed`). */
function chunk_u64(c: Chunk): unknown {
  return c.$ === "Mixed" ? { $: c.$, chunk_domain_size: c.chunk_domain_size, ones_count: c.ones_count, words: words_to_u64(c.words) } : { ...c };
}

function mixed(chunk_domain_size: number, ones_count: number, words: bigint[]): unknown {
  return { $: "Mixed", chunk_domain_size, ones_count, words };
}

const zeros32 = (n: number): bigint[] => new Array<bigint>(n).fill(0n);

// rustc: compiler/rustc_index/src/bit_set/tests.rs:9 test_new_filled
test("test_new_filled", () => {
  for (let i = 0; i < 128; i++) {
    const idx_buf = DenseBitSet.new_filled<number>(i);
    const elems: number[] = [...idx_buf.iter()];
    const expected: number[] = Array.from({ length: i }, (_, k) => k);
    expect(elems).toEqual(expected);
  }
});

/// [`DenseBitSet::contains_loose`] should not panic when given an out-of-domain value.
// rustc: compiler/rustc_index/src/bit_set/tests.rs:20 contains_loose
test("contains_loose", () => {
  const bitset = DenseBitSet.new_empty<number>(100);
  bitset.insert(77);

  for (let i = 0; i < 256; i++) {
    expect(bitset.contains_loose(i)).toBe(i === 77);
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

// rustc: compiler/rustc_index/src/bit_set/tests.rs:56 bitset_clone_from
test("bitset_clone_from", () => {
  const a = DenseBitSet.new_empty<number>(10);
  a.insert(4);
  a.insert(7);
  a.insert(9);

  const b = DenseBitSet.new_empty<number>(2);
  b.clone_from(a);
  expect(b.domain_size()).toBe(10);
  expect([...b.iter()]).toEqual([4, 7, 9]);

  b.clone_from(DenseBitSet.new_empty(40));
  expect(b.domain_size()).toBe(40);
  expect([...b.iter()]).toEqual([]);
});

// rustc: compiler/rustc_index/src/bit_set/tests.rs:73 union_two_sets
test("union_two_sets", () => {
  const set1 = DenseBitSet.new_empty<number>(65);
  const set2 = DenseBitSet.new_empty<number>(65);
  expect(set1.insert(3)).toBe(true);
  expect(!set1.insert(3)).toBe(true);
  expect(set2.insert(5)).toBe(true);
  expect(set2.insert(64)).toBe(true);
  expect(set1.union(set2)).toBe(true);
  expect(!set1.union(set2)).toBe(true);
  expect(set1.contains(3)).toBe(true);
  expect(!set1.contains(4)).toBe(true);
  expect(set1.contains(5)).toBe(true);
  expect(!set1.contains(63)).toBe(true);
  expect(set1.contains(64)).toBe(true);
});

// rustc: compiler/rustc_index/src/bit_set/tests.rs:90 union_not
test("union_not", () => {
  const a = DenseBitSet.new_empty<number>(100);
  const b = DenseBitSet.new_empty<number>(100);

  a.insert(3);
  a.insert(5);
  a.insert(80);
  a.insert(81);

  b.insert(5); // Already in `a`.
  b.insert(7);
  b.insert(63);
  b.insert(81); // Already in `a`.
  b.insert(90);

  a.union_not(b);

  // After union-not, `a` should contain all values in the domain, except for
  // the ones that are in `b` and were _not_ already in `a`.
  expect([...a.iter()]).toEqual(Array.from({ length: 100 }, (_, x) => x).filter((x) => !(x === 7 || x === 63 || x === 90)));
});

// rustc: compiler/rustc_index/src/bit_set/tests.rs:116 chunked_bitset
test("chunked_bitset", () => {
  const b0 = ChunkedBitSet.new_empty<number>(0);
  const b0b = b0.clone();
  expect(ChunkedBitSet_eq(b0, new ChunkedBitSet(0, []))).toBe(true);

  // There are no valid insert/remove/contains operations on a 0-domain
  // bitset, but we can test `union`.
  b0.assert_valid();
  expect(!b0.union(b0b)).toBe(true);
  expect(b0.chunks()).toEqual([]);
  expect(b0.count()).toBe(0);
  b0.assert_valid();

  //-----------------------------------------------------------------------

  const b1 = ChunkedBitSet.new_empty<number>(1);
  expect(ChunkedBitSet_eq(b1, new ChunkedBitSet(1, [{ $: "Zeros", chunk_domain_size: 1 }]))).toBe(true);

  b1.assert_valid();
  expect(!b1.contains(0)).toBe(true);
  expect(b1.count()).toBe(0);
  expect(b1.insert(0)).toBe(true);
  expect(b1.contains(0)).toBe(true);
  expect(b1.count()).toBe(1);
  expect(b1.chunks().map(chunk_u64)).toEqual([{ $: "Ones", chunk_domain_size: 1 }]);
  expect(!b1.insert(0)).toBe(true);
  expect(b1.remove(0)).toBe(true);
  expect(!b1.contains(0)).toBe(true);
  expect(b1.count()).toBe(0);
  expect(b1.chunks().map(chunk_u64)).toEqual([{ $: "Zeros", chunk_domain_size: 1 }]);
  b1.assert_valid();

  //-----------------------------------------------------------------------

  const b100 = ChunkedBitSet.new_filled<number>(100);
  expect(ChunkedBitSet_eq(b100, new ChunkedBitSet(100, [{ $: "Ones", chunk_domain_size: 100 }]))).toBe(true);

  b100.assert_valid();
  for (let i = 0; i < 100; i++) {
    expect(b100.contains(i)).toBe(true);
  }
  expect(b100.count()).toBe(100);
  expect(b100.remove(3)).toBe(true);
  expect(b100.insert(3)).toBe(true);
  expect(b100.chunks().map(chunk_u64)).toEqual([{ $: "Ones", chunk_domain_size: 100 }]);
  expect(b100.remove(20) && b100.remove(30) && b100.remove(40) && b100.remove(99) && b100.insert(30)).toBe(true);
  expect(b100.count()).toBe(97);
  expect(!b100.contains(20) && b100.contains(30) && !b100.contains(99) && b100.contains(50)).toBe(true);
  expect(b100.chunks().map(chunk_u64)).toEqual([
    mixed(100, 97, [0b11111111_11111111_11111110_11111111_11111111_11101111_11111111_11111111n, 0b00000000_00000000_00000000_00000111_11111111_11111111_11111111_11111111n, ...zeros32(30)]),
  ]);
  b100.assert_valid();
  let num_removed = 0;
  for (let i = 0; i < 100; i++) {
    if (b100.remove(i)) {
      num_removed += 1;
    }
  }
  expect(num_removed).toBe(97);
  expect(b100.chunks().map(chunk_u64)).toEqual([{ $: "Zeros", chunk_domain_size: 100 }]);
  b100.assert_valid();

  //-----------------------------------------------------------------------

  const b2548 = ChunkedBitSet.new_empty<number>(2548);
  expect(
    ChunkedBitSet_eq(
      b2548,
      new ChunkedBitSet(2548, [
        { $: "Zeros", chunk_domain_size: 2048 },
        { $: "Zeros", chunk_domain_size: 500 },
      ]),
    ),
  ).toBe(true);

  b2548.assert_valid();
  b2548.insert(14);
  b2548.remove(14);
  expect(b2548.chunks().map(chunk_u64)).toEqual([
    { $: "Zeros", chunk_domain_size: 2048 },
    { $: "Zeros", chunk_domain_size: 500 },
  ]);
  b2548.insert_all();
  for (let i = 0; i < 2548; i++) {
    expect(b2548.contains(i)).toBe(true);
  }
  expect(b2548.count()).toBe(2548);
  expect(b2548.chunks().map(chunk_u64)).toEqual([
    { $: "Ones", chunk_domain_size: 2048 },
    { $: "Ones", chunk_domain_size: 500 },
  ]);
  b2548.assert_valid();

  //-----------------------------------------------------------------------

  const b4096 = ChunkedBitSet.new_empty<number>(4096);
  expect(
    ChunkedBitSet_eq(
      b4096,
      new ChunkedBitSet(4096, [
        { $: "Zeros", chunk_domain_size: 2048 },
        { $: "Zeros", chunk_domain_size: 2048 },
      ]),
    ),
  ).toBe(true);

  b4096.assert_valid();
  for (let i = 0; i < 4096; i++) {
    expect(!b4096.contains(i)).toBe(true);
  }
  expect(b4096.insert(0) && b4096.insert(4095) && !b4096.insert(4095)).toBe(true);
  expect(b4096.contains(0) && !b4096.contains(2047) && !b4096.contains(2048) && b4096.contains(4095)).toBe(true);
  expect(b4096.chunks().map(chunk_u64)).toEqual([mixed(2048, 1, [1n, ...zeros32(31)]), mixed(2048, 1, [...zeros32(31), 0x8000_0000_0000_0000n])]);
  expect(b4096.count()).toBe(2);
  b4096.assert_valid();

  //-----------------------------------------------------------------------

  const b10000 = ChunkedBitSet.new_empty<number>(10000);
  expect(
    ChunkedBitSet_eq(
      b10000,
      new ChunkedBitSet(10000, [
        { $: "Zeros", chunk_domain_size: 2048 },
        { $: "Zeros", chunk_domain_size: 2048 },
        { $: "Zeros", chunk_domain_size: 2048 },
        { $: "Zeros", chunk_domain_size: 2048 },
        { $: "Zeros", chunk_domain_size: 1808 },
      ]),
    ),
  ).toBe(true);

  b10000.assert_valid();
  expect(b10000.insert(3000) && b10000.insert(5000)).toBe(true);
  expect(b10000.chunks().map(chunk_u64)).toEqual([
    { $: "Zeros", chunk_domain_size: 2048 },
    mixed(2048, 1, [...zeros32(14), 0x0100_0000_0000_0000n, ...zeros32(17)]),
    mixed(2048, 1, [...zeros32(14), 0x0100n, ...zeros32(17)]),
    { $: "Zeros", chunk_domain_size: 2048 },
    { $: "Zeros", chunk_domain_size: 1808 },
  ]);
  const b10000b = ChunkedBitSet.new_empty<number>(10000);
  b10000b.clone_from(b10000);
  expect(ChunkedBitSet_eq(b10000, b10000b)).toBe(true);
  for (let i = 6000; i < 7000; i++) {
    b10000b.insert(i);
  }
  expect(b10000b.count()).toBe(1002);
  b10000b.assert_valid();
  b10000b.clone_from(b10000);
  expect(b10000b.count()).toBe(2);
  for (let i = 2000; i < 8000; i++) {
    b10000b.insert(i);
  }
  b10000.union(b10000b);
  expect(b10000.count()).toBe(6000);
  b10000.union(b10000b);
  expect(b10000.count()).toBe(6000);
  b10000.assert_valid();
  b10000b.assert_valid();

  //-----------------------------------------------------------------------

  const b64 = ChunkedBitSet.new_filled<number>(64);

  const b64b = ChunkedBitSet.new_empty<number>(64);
  b64b.insert(0);

  b64.subtract(b64b);
  expect(!b64.contains(0)).toBe(true);
  expect(b64.contains(10)).toBe(true);
  expect(b64.contains(50)).toBe(true);
  expect(b64.contains(63)).toBe(true);
  expect(b64.chunks().map(chunk_u64)).toEqual([mixed(64, 63, [0xfffffffffffffffen, ...zeros32(31)])]);
});

/// Additional helper methods for testing.
/// Creates a new `ChunkedBitSet` containing all `i` for which `fill_fn(i)` is true.
// rustc: compiler/rustc_index/src/bit_set/tests.rs:379 fill_with
function fill_with(domain_size: number, fill_fn: (i: number) => boolean): ChunkedBitSet<number> {
  const this_ = ChunkedBitSet.new_empty<number>(domain_size);
  for (let i = 0; i < domain_size; i++) {
    if (fill_fn(i)) {
      this_.insert(i);
    }
  }
  return this_;
}

/// Asserts that for each `i` in `0..self.domain_size()`, `self.contains(i) == expected_fn(i)`.
// rustc: compiler/rustc_index/src/bit_set/tests.rs:391 assert_filled_with
function assert_filled_with(self: ChunkedBitSet<number>, expected_fn: (i: number) => boolean): void {
  for (let i = 0; i < self.domain_size(); i++) {
    const expected = expected_fn(i);
    if (self.contains(i) !== expected) expect(`i = ${i}: ${self.contains(i)}`).toBe(`i = ${i}: ${expected}`);
  }
}

// rustc: compiler/rustc_index/src/bit_set/tests.rs:400 chunked_bulk_ops
test("chunked_bulk_ops", () => {
  interface ChunkedBulkOp {
    name: string;
    op_fn: (a: ChunkedBitSet<number>, b: ChunkedBitSet<number>) => boolean;
    spec_fn: (fizz: (i: number) => boolean, buzz: (i: number) => boolean, i: number) => boolean;
  }
  const ops: ChunkedBulkOp[] = [
    {
      name: "union",
      op_fn: (a, b) => a.union(b),
      spec_fn: (fizz, buzz, i) => fizz(i) || buzz(i),
    },
    {
      name: "subtract",
      op_fn: (a, b) => a.subtract(b),
      spec_fn: (fizz, buzz, i) => fizz(i) && !buzz(i),
    },
  ];

  const domain_sizes = [
    Math.floor(CHUNK_BITS / 7), // Smaller than a full chunk.
    CHUNK_BITS,
    CHUNK_BITS + Math.floor(CHUNK_BITS / 7), // Larger than a full chunk.
  ];

  for (const { op_fn, spec_fn } of ops) {
    for (const domain_size of domain_sizes) {
      // If false, use different values for LHS and RHS, to test "fizz op buzz".
      // If true, use identical values, to test "fizz op fizz".
      for (const identical of [false, true]) {
        // If false, make a clone of LHS before doing the op.
        // This covers optimizations that depend on whether chunk words are shared or not.
        for (const unique of [false, true]) {
          const fizz_fn = (i: number) => i % 3 === 0;
          const buzz_fn = identical ? fizz_fn : (i: number) => i % 5 === 0;

          // Check that `fizz op buzz` gives the expected results.
          chunked_bulk_ops_test_inner(domain_size, unique, fizz_fn, buzz_fn, op_fn, (i) => spec_fn(fizz_fn, buzz_fn, i));
        }
      }
    }
  }
});

// rustc: compiler/rustc_index/src/bit_set/tests.rs:456 chunked_bulk_ops_test_inner
function chunked_bulk_ops_test_inner(
  domain_size: number,
  unique: boolean,
  fizz_fn: (i: number) => boolean,
  buzz_fn: (i: number) => boolean,
  op_fn: (a: ChunkedBitSet<number>, b: ChunkedBitSet<number>) => boolean,
  expected_fn: (i: number) => boolean,
): void {
  // Create two bitsets, "fizz" (LHS) and "buzz" (RHS).
  const fizz = fill_with(domain_size, fizz_fn);
  const buzz = fill_with(domain_size, buzz_fn);

  // If requested, clone `fizz` so that its word Rcs are not uniquely-owned.
  const _cloned = !unique ? fizz.clone() : undefined;

  // Perform the op (e.g. union/subtract/intersect), and verify that the
  // mutated LHS contains exactly the expected values.
  const changed = op_fn(fizz, buzz);
  assert_filled_with(fizz, expected_fn);

  // Verify that the "changed" return value is correct.
  let should_change = false;
  for (let i = 0; i < domain_size; i++) {
    if (fizz_fn(i) !== expected_fn(i)) {
      should_change = true;
      break;
    }
  }
  expect(changed).toBe(should_change);

  // rust-ts: the clone still holds the original words (`Rc::make_mut` copied before writing).
  if (_cloned !== undefined) assert_filled_with(_cloned, fizz_fn);
}

// rustc: compiler/rustc_index/src/bit_set/tests.rs:481 with_elements_chunked
function with_elements_chunked(elements: readonly number[], domain_size: number): ChunkedBitSet<number> {
  const s = ChunkedBitSet.new_empty<number>(domain_size);
  for (const e of elements) {
    expect(s.insert(e)).toBe(true);
  }
  return s;
}

// rustc: compiler/rustc_index/src/bit_set/tests.rs:490 chunked_bitset_iter
test("chunked_bitset_iter", () => {
  // rustc: compiler/rustc_index/src/bit_set/tests.rs:491 check_iter
  function check_iter(bit: ChunkedBitSet<number>, vec: number[]): void {
    // Test collecting via both `.next()` and `.fold()` calls, to make sure both are correct
    const collect_next: number[] = [];
    const bit_iter = bit.iter();
    for (;;) {
      const item = bit_iter.next();
      if (item.done) break;
      collect_next.push(item.value);
    }
    expect(vec).toEqual(collect_next);

    const collect_fold = [...bit.iter()].reduce<number[]>((v, item) => {
      v.push(item);
      return v;
    }, []);
    expect(vec).toEqual(collect_fold);
  }

  // Empty
  let vec: number[] = [];
  let bit = with_elements_chunked(vec, 9000);
  check_iter(bit, vec);

  // Filled
  let n = 10000;
  vec = Array.from({ length: n }, (_, i) => i);
  bit = with_elements_chunked(vec, n);
  check_iter(bit, vec);

  // Filled with trailing zeros
  n = 10000;
  vec = Array.from({ length: n }, (_, i) => i);
  bit = with_elements_chunked(vec, 2 * n);
  check_iter(bit, vec);

  // Mixed
  n = 12345;
  vec = [0, 1, 2, 2010, 2047, 2099, 6000, 6002, 6004];
  bit = with_elements_chunked(vec, n);
  check_iter(bit, vec);
});

// rustc: compiler/rustc_index/src/bit_set/tests.rs:532 grow
test("grow", () => {
  const set = GrowableBitSet.with_capacity<number>(65);
  for (let index = 0; index < 65; index++) {
    expect(set.insert(index)).toBe(true);
    expect(!set.insert(index)).toBe(true);
  }
  set.ensure(128);

  // Check if the bits set before growing are still set
  for (let index = 0; index < 65; index++) {
    expect(set.contains(index)).toBe(true);
  }

  // Check if the new bits are all un-set
  for (let index = 65; index < 128; index++) {
    expect(!set.contains(index)).toBe(true);
  }

  // Check that we can set all new bits without running out of bounds
  for (let index = 65; index < 128; index++) {
    expect(set.insert(index)).toBe(true);
    expect(!set.insert(index)).toBe(true);
  }
});

// rustc: compiler/rustc_index/src/bit_set/tests.rs:558 growable_union
test("growable_union", () => {
  // Create two input sets with partly-overlapping values, and different sizes.
  const twos = GrowableBitSet.new_empty<number>();
  for (let x = 0; x < 100; x++) {
    twos.insert(x * 2);
  }

  const threes = GrowableBitSet.new_empty<number>();
  for (let x = 0; x < 100; x++) {
    threes.insert(x * 3);
  }

  // Double-check that we did end up with input sets of different sizes.
  expect(twos.words.length).not.toBe(threes.words.length);

  // Perform a union in both directions, and check that the resulting contents are correct.
  for (const [lhs, rhs] of [
    [twos.clone(), threes.clone()],
    [threes.clone(), twos.clone()],
  ] as [GrowableBitSet<number>, GrowableBitSet<number>][]) {
    lhs.union(rhs);

    for (let i = 0; i < 400; i++) {
      expect(lhs.contains(i)).toBe((i % 2 === 0 && i < 200) || (i % 3 === 0 && i < 300));
    }
  }
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

// rustc: compiler/rustc_index/src/bit_set/tests.rs:676 sparse_matrix_iter
test("sparse_matrix_iter", () => {
  const matrix: SparseBitMatrix<number, number> = SparseBitMatrix.new(100);
  matrix.insert(3, 22);
  matrix.insert(3, 75);
  matrix.insert(2, 99);
  matrix.insert(4, 0);
  matrix.union_rows(3, 5);

  expect([...matrix.iter(2)]).toEqual([99]);
  expect([...matrix.iter(3)]).toEqual([22, 75]);
  expect([...matrix.iter(4)]).toEqual([0]);
  expect([...matrix.iter(5)]).toEqual([22, 75]);
});

// rustc: compiler/rustc_index/src/bit_set/tests.rs:718 sparse_matrix_operations
test("sparse_matrix_operations", () => {
  const matrix: SparseBitMatrix<number, number> = SparseBitMatrix.new(100);
  matrix.insert(3, 22);
  matrix.insert(3, 75);
  matrix.insert(2, 99);
  matrix.insert(4, 0);

  // SparseBitMatrix::remove
  {
    const m = matrix.clone();
    m.remove(3, 22);
    expect(!m.row(3)!.contains(22)).toBe(true);
    m.remove(0, 0);
    expect(m.row(0)).toBeUndefined();
  }

  // SparseBitMatrix::clear
  {
    const m = matrix.clone();
    m.clear(3);
    expect(!m.row(3)!.contains(75)).toBe(true);
    m.clear(0);
    expect(m.row(0)).toBeUndefined();
  }
});

// rustc: compiler/rustc_index/src/bit_set/tests.rs:745 dense_insert_range
test("dense_insert_range", () => {
  // rustc: compiler/rustc_index/src/bit_set/tests.rs:747 check
  function check(domain: number, range: RangeBounds<number>): void {
    const set = DenseBitSet.new_empty<number>(domain);
    set.insert_range(range);
    for (const i of set.iter()) {
      if (!range_contains(range, i)) expect(`${i} in range`).toBe("");
    }
    for (const i of range_iter(range)) {
      if (!set.contains(i)) expect(`${i} in ${debug_DenseBitSet(set, PLAIN)}`).toBe("");
    }
  }
  check(300, range(10, 10));
  check(300, range(WORD_BITS, WORD_BITS * 2));
  check(300, range(WORD_BITS - 1, WORD_BITS * 2));
  check(300, range(WORD_BITS - 1, WORD_BITS));
  check(300, range(10, 100));
  check(300, range(10, 30));
  check(300, range(0, 5));
  check(300, range(0, 250));
  check(300, range(200, 250));

  check(300, range_inclusive(10, 10));
  check(300, range_inclusive(WORD_BITS, WORD_BITS * 2));
  check(300, range_inclusive(WORD_BITS - 1, WORD_BITS * 2));
  check(300, range_inclusive(WORD_BITS - 1, WORD_BITS));
  check(300, range_inclusive(10, 100));
  check(300, range_inclusive(10, 30));
  check(300, range_inclusive(0, 5));
  check(300, range_inclusive(0, 250));
  check(300, range_inclusive(200, 250));

  for (let i = 0; i < WORD_BITS * 2; i++) {
    for (let j = i; j < WORD_BITS * 2; j++) {
      check(WORD_BITS * 2, range(i, j));
      check(WORD_BITS * 2, range_inclusive(i, j));
      check(300, range(i, j));
      check(300, range_inclusive(i, j));
    }
  }
});

// rustc: compiler/rustc_index/src/bit_set/tests.rs:791 dense_last_set_before
test("dense_last_set_before", () => {
  // rustc: compiler/rustc_index/src/bit_set/tests.rs:792 easy
  function easy(set: DenseBitSet<number>, needle: RangeBounds<number>): number | undefined {
    let last_leq: number | undefined = undefined;
    for (const e of set.iter()) {
      if (range_contains(needle, e)) {
        last_leq = e;
      }
    }
    return last_leq;
  }

  // rustc: compiler/rustc_index/src/bit_set/tests.rs:803 cmp
  function cmp(set: DenseBitSet<number>, needle: RangeBounds<number>): void {
    const got = set.last_set_in(needle);
    const want = easy(set, needle);
    if (got !== want) expect(`${JSON.stringify(needle)} in ${debug_DenseBitSet(set, PLAIN)}: ${got}`).toBe(`${want}`);
  }
  let set = DenseBitSet.new_empty<number>(300);
  cmp(set, range_inclusive(50, 50));
  set.insert(WORD_BITS);
  cmp(set, range_inclusive(WORD_BITS, WORD_BITS));
  set.insert(WORD_BITS - 1);
  cmp(set, range_inclusive(0, WORD_BITS - 1));
  cmp(set, range_inclusive(0, 5));
  cmp(set, range(10, 100));
  set.insert(100);
  cmp(set, range(100, 110));
  cmp(set, range(99, 100));
  cmp(set, range_inclusive(99, 100));

  for (let i = 0; i <= WORD_BITS * 2; i++) {
    for (let j = i; j <= WORD_BITS * 2; j++) {
      for (let k = 0; k < WORD_BITS * 2; k++) {
        set = DenseBitSet.new_empty<number>(300);
        cmp(set, range(i, j));
        cmp(set, range_inclusive(i, j));
        set.insert(k);
        cmp(set, range(i, j));
        cmp(set, range_inclusive(i, j));
      }
    }
  }
});

// rustc: compiler/rustc_index/src/bit_set/tests.rs:840 dense_contains_any
test("dense_contains_any", () => {
  const set = DenseBitSet.new_empty<number>(300);
  expect(!set.contains_any(range(0, 300))).toBe(true);
  set.insert_range(range(10, 20));
  set.insert_range(range(60, 70));
  set.insert_range(range_inclusive(150, 250));

  expect(set.contains_any(range(0, 30))).toBe(true);
  expect(set.contains_any(range(5, 100))).toBe(true);
  expect(set.contains_any(range(250, 255))).toBe(true);

  expect(!set.contains_any(range(20, 59))).toBe(true);
  expect(!set.contains_any(range(256, 290))).toBe(true);

  set.insert(22);
  expect(set.contains_any(range(20, 59))).toBe(true);
});

// `#[bench]` fns: the body runs a few times (no `Bencher` in bun).
const BENCH_ITERS = 10;

// rustc: compiler/rustc_index/src/bit_set/tests.rs:859 bench_insert
test("bench_insert", () => {
  const bs = DenseBitSet.new_filled<number>(99999);
  for (let k = 0; k < BENCH_ITERS; k++) {
    bs.insert(100);
  }
});

// rustc: compiler/rustc_index/src/bit_set/tests.rs:867 bench_remove
test("bench_remove", () => {
  const bs = DenseBitSet.new_filled<number>(99999);
  for (let k = 0; k < BENCH_ITERS; k++) {
    bs.remove(100);
  }
});

// rustc: compiler/rustc_index/src/bit_set/tests.rs:875 bench_iter
test("bench_iter", () => {
  const bs = DenseBitSet.new_filled<number>(99999);
  for (let k = 0; k < BENCH_ITERS; k++) {
    for (const b of bs.iter()) void b;
  }
});

// rustc: compiler/rustc_index/src/bit_set/tests.rs:883 bench_intersect
test("bench_intersect", () => {
  const ba = DenseBitSet.new_filled<number>(99999);
  const bb = DenseBitSet.new_filled<number>(99999);
  for (let k = 0; k < BENCH_ITERS; k++) {
    ba.intersect(bb);
  }
});
