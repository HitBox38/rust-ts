// Port of rand_core =0.10.1 `tests/utils.rs`.
import { expect, test } from "bun:test";
import { Ok, type Result } from "../../../std/result.ts";
import { Rng_for_TryRng, type Infallible, type Rng } from "../lib.ts";
import { fill_bytes_via_next_word, next_u64_via_u32, read_words } from "../utils.ts";
import { Word_u32, Word_u64 } from "../word.ts";

class DummyRng implements Rng {
  constructor(public _0: number) {}

  // crate: rand_core-0.10.1/tests/utils.rs:8 try_next_u32
  try_next_u32(): Result<number, Infallible> {
    this._0 = Number((BigInt(this._0) * 3n) & 0xffff_ffffn);
    return Ok(this._0);
  }

  // crate: rand_core-0.10.1/tests/utils.rs:13 try_next_u64
  try_next_u64(): Result<bigint, Infallible> {
    return next_u64_via_u32(this);
  }

  // crate: rand_core-0.10.1/tests/utils.rs:17 try_fill_bytes
  try_fill_bytes(dst: Uint8Array): Result<void, Infallible> {
    return fill_bytes_via_next_word(Word_u32, dst, () => this.try_next_u32());
  }

  next_u32(): number {
    return Rng_for_TryRng.next_u32(this);
  }
  next_u64(): bigint {
    return Rng_for_TryRng.next_u64(this);
  }
  fill_bytes(dst: Uint8Array): void {
    Rng_for_TryRng.fill_bytes(this, dst);
  }
}

// crate: rand_core-0.10.1/tests/utils.rs:23 test_next_u64_via_u32
test("test_next_u64_via_u32", () => {
  const rng = new DummyRng(0xf973_f2ec);

  expect(rng.next_u64()).toBe(0xc513_8a4c_ec5b_d8c4n);
  expect(rng.next_u64()).toBe(0xedaf_dcac_4f3a_9ee4n);
  expect(rng.next_u64()).toBe(0x5b2e_c20c_c90f_9604n);
});

// crate: rand_core-0.10.1/tests/utils.rs:32 test_fill_bytes_via_next_word
test("test_fill_bytes_via_next_word", () => {
  const rng = new DummyRng(0xf973_f2ec);

  const buf = new Uint8Array(8);

  let dst = buf.subarray(0, 3);
  rng.fill_bytes(dst);
  expect([...dst]).toEqual([196, 216, 91]);

  dst = buf.subarray(0, 5);
  rng.fill_bytes(dst);
  expect([...dst]).toEqual([76, 138, 19, 197, 228]);

  dst = buf.subarray(0);
  rng.fill_bytes(dst);
  expect([...dst]).toEqual([172, 220, 175, 237, 4, 150, 15, 201]);
});

// crate: rand_core-0.10.1/tests/utils.rs:51 test_read_words
test("test_read_words", () => {
  const bytes = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);

  let buf: (number | bigint)[] = read_words(Word_u32, 4, bytes);
  expect(buf[0]).toBe(0x0403_0201);
  expect(buf[3]).toBe(0x100f_0e0d);

  buf = read_words(Word_u32, 3, bytes.subarray(1, 13)); // unaligned
  expect(buf[0]).toBe(0x0504_0302);
  expect(buf[2]).toBe(0x0d0c_0b0a);

  buf = read_words(Word_u64, 2, bytes);
  expect(buf[0]).toBe(0x0807_0605_0403_0201n);
  expect(buf[1]).toBe(0x100f_0e0d_0c0b_0a09n);

  buf = read_words(Word_u64, 1, bytes.subarray(7, 15)); // unaligned
  expect(buf[0]).toBe(0x0f0e_0d0c_0b0a_0908n);
});
