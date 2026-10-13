// Port of rustc-stable-hash =0.1.2 `src/stable_hasher/tests.rs`.
// PORT: `x.hash(&mut h)` of an integer is the matching `write_*` call (std's `Hash` impls);
// tuples hash their fields in order.
import { expect, test } from "bun:test";
import { StableSipHasher128 } from "../lib.ts";
import type { SipHasher128Hash } from "../sip128.ts";
import type { FromStableHash, Hasher } from "../stable_hasher.ts";

// The tests below compare the computed hashes to particular expected values
// in order to test that we produce the same results on different platforms,
// regardless of endianness and `usize` and `isize` size differences (this
// of course assumes we run these tests on platforms that differ in those
// ways). The expected values depend on the hashing algorithm used, so they
// need to be updated whenever StableHasher changes its hashing algorithm.

// `#[derive(Debug, PartialEq)] struct TestHash([u64; 2]);`
type TestHash = readonly [bigint, bigint];
const TestHash: FromStableHash<TestHash, SipHasher128Hash> = {
  // crate: rustc-stable-hash-0.1.2/src/stable_hasher/tests.rs:19 from
  from(hash: SipHasher128Hash): TestHash {
    return hash._0;
  },
};

// crate: rustc-stable-hash-0.1.2/src/stable_hasher/tests.rs:25 test_hash_integers
test("test_hash_integers", () => {
  // Test that integers are handled consistently across platforms.
  const test_u8 = 0xab;
  const test_u16 = 0xffee;
  const test_u32 = 0x445577aa;
  const test_u64 = 0x01234567_13243546n;
  const test_u128 = 0x22114433_66557788_99aaccbb_eeddff77n;
  const test_usize = 0xd0c0b0a0;

  const test_i8 = -100;
  const test_i16 = -200;
  const test_i32 = -300;
  const test_i64 = -400n;
  const test_i128 = -500n;
  const test_isize = -600;

  const h = StableSipHasher128.new();
  h.write_u8(test_u8);
  h.write_u16(test_u16);
  h.write_u32(test_u32);
  h.write_u64(test_u64);
  h.write_u128(test_u128);
  h.write_usize(test_usize);
  h.write_i8(test_i8);
  h.write_i16(test_i16);
  h.write_i32(test_i32);
  h.write_i64(test_i64);
  h.write_i128(test_i128);
  h.write_isize(test_isize);

  // This depends on the hashing algorithm. See note at top of file.
  const expected: TestHash = [13997337031081104755n, 6178945012502239489n];

  expect(h.finish(TestHash)).toEqual(expected);
});

// crate: rustc-stable-hash-0.1.2/src/stable_hasher/tests.rs:62 test_hash_usize
test("test_hash_usize", () => {
  // Test that usize specifically is handled consistently across platforms.
  const test_usize = 0xabcdef01;

  const h = StableSipHasher128.new();
  h.write_usize(test_usize);

  // This depends on the hashing algorithm. See note at top of file.
  const expected: TestHash = [12037165114281468837n, 3094087741167521712n];

  expect(h.finish(TestHash)).toEqual(expected);
});

// crate: rustc-stable-hash-0.1.2/src/stable_hasher/tests.rs:76 test_hash_isize
test("test_hash_isize", () => {
  // Test that isize specifically is handled consistently across platforms.
  const test_isize = -7;

  const h = StableSipHasher128.new();
  h.write_isize(test_isize);

  // This depends on the hashing algorithm. See note at top of file.
  const expected: TestHash = [3979067582695659080n, 2322428596355037273n];

  expect(h.finish(TestHash)).toEqual(expected);
});

// crate: rustc-stable-hash-0.1.2/src/stable_hasher/tests.rs:89 hash
function hash(t: (h: Hasher) => void): TestHash {
  const h = StableSipHasher128.new();
  t(h);
  return h.finish(TestHash);
}

// Check that the `isize` hashing optimization does not produce the same hash when permuting two
// values.
// crate: rustc-stable-hash-0.1.2/src/stable_hasher/tests.rs:98 test_isize_compression
test("test_isize_compression", () => {
  // PORT: `a as isize` of a u64 is its two's complement value (a JS number while |value| < 2^53;
  // the `0xFFFFFFFFFFFFFFFF` / `u64::MAX` cases are `-1`).
  // crate: rustc-stable-hash-0.1.2/src/stable_hasher/tests.rs:99 check_hash
  function check_hash(a: number, b: number): void {
    const hash_a = hash((h) => {
      h.write_isize(a);
      h.write_isize(b);
    });
    const hash_b = hash((h) => {
      h.write_isize(b);
      h.write_isize(a);
    });
    expect(hash_a).not.toEqual(hash_b);
  }

  check_hash(0xaa, 0xaaaa);
  check_hash(0xff, 0xffff);
  check_hash(0xaaaa, 0xaaaaaa);
  check_hash(0xaaaaaa, 0xaaaaaaaa);
  check_hash(0xff, -1 /* 0xFFFFFFFFFFFFFFFF */);
  check_hash(-1 /* u64::MAX */, 1);
});

// crate: rustc-stable-hash-0.1.2/src/stable_hasher/tests.rs:117 test_cloned_hasher_output
test("test_cloned_hasher_output", () => {
  // Test that integers are handled consistently across platforms.
  const test_u8 = 0xab;
  const test_u16 = 0xffee;
  const test_u32 = 0x445577aa;

  const h1 = StableSipHasher128.new();
  h1.write_u8(test_u8);
  h1.write_u16(test_u16);

  const h2 = h1.clone();
  const h3 = h1.clone();
  // Make sure the cloned hasher can be fed more values.
  h3.write_u32(test_u32);

  const h1_hash: TestHash = h1.finish(TestHash);
  expect(h1_hash).toEqual(h2.finish(TestHash));
  expect(h1_hash).not.toEqual(h3.finish(TestHash));
});

// crate: rustc-stable-hash-0.1.2/src/stable_hasher/tests.rs:138 test_hash_trait_finish
test("test_hash_trait_finish", () => {
  // crate: rustc-stable-hash-0.1.2/src/stable_hasher/tests.rs:139 hash
  function hash(h: Hasher): bigint {
    return h.finish_u64();
  }

  // Test that integers are handled consistently across platforms.
  const test_u8 = 0xab;
  const test_u16 = 0xffee;
  const test_u32 = 0x445577aa;

  const h1 = StableSipHasher128.new();
  h1.write_u8(test_u8);
  h1.write_u16(test_u16);
  h1.write_u32(test_u32);

  expect(hash(h1)).toBe(hash(h1));
  expect(hash(h1)).toBe(13655241286414701638n);
});
