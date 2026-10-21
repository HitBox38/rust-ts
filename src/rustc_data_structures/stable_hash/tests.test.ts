// Port of compiler/rustc_data_structures/src/stable_hash/tests.rs.
import { expect, test } from "bun:test";
import { panic } from "../../std/panic.ts";
import { BitMatrix, BitMatrix_eq, DenseBitSet, DenseBitSet_eq } from "../../rustc_index/bit_set.ts";
import { Hash128 } from "../../rustc_hashes/lib.ts";
import type { Fingerprint } from "../fingerprint.ts";
import {
  type RawDefId,
  type RawSpan,
  type StableHash,
  type StableHashControls,
  type StableHashCtxt,
  StableHasher,
  stable_hash_BitMatrix,
  stable_hash_DenseBitSet,
  stable_hash_i128,
  stable_hash_i16,
  stable_hash_i32,
  stable_hash_i64,
  stable_hash_isize,
  stable_hash_tuple2,
  stable_hash_u128,
  stable_hash_u16,
  stable_hash_u32,
  stable_hash_u64,
} from "../stable_hash.ts";

// The tests below compare the computed hashes to particular expected values
// in order to test that we produce the same results on different platforms,
// regardless of endianness and `usize` and `isize` size differences (this
// of course assumes we run these tests on platforms that differ in those
// ways). The expected values depend on the hashing algorithm used, so they
// need to be updated whenever StableHasher changes its hashing algorithm.

// `impl StableHashCtxt for ()`
const UNIT_HCX: StableHashCtxt = {
  // rustc: compiler/rustc_data_structures/src/stable_hash/tests.rs:11 stable_hash_span
  stable_hash_span(_: RawSpan, __: StableHasher): void {
    panic();
  },
  // rustc: compiler/rustc_data_structures/src/stable_hash/tests.rs:14 def_path_hash
  def_path_hash(_: RawDefId): Fingerprint {
    panic();
  },
  // rustc: compiler/rustc_data_structures/src/stable_hash/tests.rs:17 stable_hash_controls
  stable_hash_controls(): StableHashControls {
    panic();
  },
  // rustc: compiler/rustc_data_structures/src/stable_hash/tests.rs:20 assert_default_stable_hash_controls
  assert_default_stable_hash_controls(_: string): void {
    panic();
  },
};

// rustc: compiler/rustc_data_structures/src/stable_hash/tests.rs:25 hash
function hash<T>(t: T, stable_hash_T: StableHash<T>): Hash128 {
  const h = StableHasher.new();
  const hcx = UNIT_HCX;
  stable_hash_T(t, hcx, h);
  return h.finish(Hash128);
}

// Check that bit set hash includes the domain size.
// rustc: compiler/rustc_data_structures/src/stable_hash/tests.rs:34 test_hash_bit_set
test("test_hash_bit_set", () => {
  const a = DenseBitSet.new_empty<number>(1);
  const b = DenseBitSet.new_empty<number>(2);
  expect(DenseBitSet_eq(a, b)).toBe(false);
  expect(String(hash(a, stable_hash_DenseBitSet))).not.toBe(String(hash(b, stable_hash_DenseBitSet)));
});

// Check that bit matrix hash includes the matrix dimensions.
// rustc: compiler/rustc_data_structures/src/stable_hash/tests.rs:44 test_hash_bit_matrix
test("test_hash_bit_matrix", () => {
  const a = BitMatrix.new<number, number>(1, 1);
  const b = BitMatrix.new<number, number>(1, 2);
  expect(BitMatrix_eq(a, b)).toBe(false);
  expect(String(hash(a, stable_hash_BitMatrix))).not.toBe(String(hash(b, stable_hash_BitMatrix)));
});

// Check that exchanging the value of two adjacent fields changes the hash.
// rustc: compiler/rustc_data_structures/src/stable_hash/tests.rs:54 test_attribute_permutation
test("test_attribute_permutation", () => {
  // `macro_rules! test_type`: `struct Foo { a: $ty, b: $ty }` hashing `a` then `b`.
  function test_type<T>(ty: string, ff: T, ffff: T, stable_hash_T: StableHash<T>): void {
    interface Foo {
      a: T;
      b: T;
    }

    // rustc: compiler/rustc_data_structures/src/stable_hash/tests.rs:63 stable_hash
    const stable_hash_Foo: StableHash<Foo> = (self, hcx, hasher) => {
      stable_hash_T(self.a, hcx, hasher);
      stable_hash_T(self.b, hcx, hasher);
    };

    // #[allow(overflowing_literals)]
    const item: Foo = { a: ff, b: ffff };
    const hash_a = hash(item, stable_hash_Foo);
    [item.a, item.b] = [item.b, item.a];
    const hash_b = hash(item, stable_hash_Foo);
    expect(hash_a, `The hash stayed the same after values were swapped for type \`${ty}\`!`).not.toBe(hash_b);
  }

  test_type("u16", 0xff, 0xffff, stable_hash_u16);
  test_type("u32", 0xff, 0xffff, stable_hash_u32);
  test_type("u64", 0xffn, 0xffffn, stable_hash_u64);
  test_type("u128", 0xffn, 0xffffn, stable_hash_u128);

  // `0xFF_FF as i16` overflows to -1.
  test_type("i16", 0xff, -1, stable_hash_i16);
  test_type("i32", 0xff, 0xffff, stable_hash_i32);
  test_type("i64", 0xffn, 0xffffn, stable_hash_i64);
  test_type("i128", 0xffn, 0xffffn, stable_hash_i128);
});

// Check that the `isize` hashing optimization does not produce the same hash when permuting two
// values.
// rustc: compiler/rustc_data_structures/src/stable_hash/tests.rs:101 test_isize_compression
test("test_isize_compression", () => {
  // PORT: `a as isize` of a u64 is its two's complement value (`u64::MAX` is -1).
  // rustc: compiler/rustc_data_structures/src/stable_hash/tests.rs:102 check_hash
  function check_hash(a: number, b: number): void {
    const pair = (x: readonly [number, number]) => hash(x, (v, hcx, h) => stable_hash_tuple2(v, hcx, h, stable_hash_isize, stable_hash_isize));
    const hash_a = pair([a, b]);
    const hash_b = pair([b, a]);
    expect(hash_a, `The hash stayed the same when permuting values \`${a}\` and \`${b}\`!`).not.toBe(hash_b);
  }

  check_hash(0xaa, 0xaaaa);
  check_hash(0xff, 0xffff);
  check_hash(0xaaaa, 0xaaaaaa);
  check_hash(0xaaaaaa, 0xaaaaaaaa);
  check_hash(0xff, -1 /* 0xFFFFFFFFFFFFFFFF */);
  check_hash(-1 /* u64::MAX */, 1);
});
