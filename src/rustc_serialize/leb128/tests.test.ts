// Port of compiler/rustc_serialize/src/leb128/tests.rs.
//
// PORT: the `impl_test_*_leb128!` macros expand to one test per integer type. The values are
// computed in `bigint` with the type's wrapping arithmetic and passed to the port in its TS width
// (`number` for u16/u32/usize/i16/i32/isize). `usize`/`isize` are exact TS numbers only within
// ±2^53: the values outside that range (the 2^56-spaced ones, MIN/MAX and most of the "random"
// products) are written with the 64-bit writers (the same encoding on a 64-bit target), and the
// `usize`/`isize` reads must refuse them (`Unported`) after consuming exactly their bytes.
import { expect, test } from "bun:test";
import { Unported } from "../../std/panic.ts";
import { unwrap_result } from "../../std/result.ts";
import {
  max_leb128_len,
  read_i128_leb128,
  read_i16_leb128,
  read_i32_leb128,
  read_i64_leb128,
  read_isize_leb128,
  read_u128_leb128,
  read_u16_leb128,
  read_u32_leb128,
  read_u64_leb128,
  read_usize_leb128,
  write_i128_leb128,
  write_i16_leb128,
  write_i32_leb128,
  write_i64_leb128,
  write_isize_leb128,
  write_u128_leb128,
  write_u16_leb128,
  write_u32_leb128,
  write_u64_leb128,
  write_usize_leb128,
} from "../leb128.ts";
import { MAGIC_END_BYTES, MemDecoder } from "../opaque.ts";

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Test 256 evenly spaced values of integer range, integer max value, and some "random" numbers. */
function unsigned_values(bits: number): bigint[] {
  const values: bigint[] = [];
  const increment = 1n << BigInt(bits - 8);
  for (let i = 0n; i < 256n; i++) values.push(0n + i * increment);
  values.push((1n << BigInt(bits)) - 1n);
  const k = BigInt.asUintN(bits, 0x12345789abcdefn);
  for (let i = -500n; i < 500n; i++) values.push(BigInt.asUintN(bits, BigInt.asUintN(bits, i) * k));
  return values;
}

function signed_values(bits: number): bigint[] {
  const values: bigint[] = [];
  let value = -(1n << BigInt(bits - 1));
  const increment = 1n << BigInt(bits - 8);
  for (let i = 0; i < 256; i++) {
    values.push(value);
    // The addition in the last loop iteration overflows.
    value = BigInt.asIntN(bits, value + increment);
  }
  values.push((1n << BigInt(bits - 1)) - 1n);
  const k = BigInt.asIntN(bits, 0x12345789abcdefn);
  for (let i = -500n; i < 500n; i++) values.push(BigInt.asIntN(bits, BigInt.asIntN(bits, i) * k));
  return values;
}

/** The body of both macros. `exact(x)`: whether `x` has a TS value of the tested width. */
function check<V>(
  values: bigint[],
  size_of: number,
  to_ts: (x: bigint) => V,
  from_ts: (v: V) => bigint,
  write: (out: Uint8Array, x: V) => number,
  read: (d: MemDecoder) => V,
  exact: (x: bigint) => boolean = () => true,
  write_wide?: (out: Uint8Array, x: bigint) => number,
): void {
  const stream: number[] = [];

  // `let mut buf = Default::default();`
  const buf = new Uint8Array(max_leb128_len(size_of));
  for (const x of values) {
    const n = exact(x) ? write(buf, to_ts(x)) : write_wide!(buf, x);
    stream.push(...buf.subarray(0, n));
  }
  const stream_end = stream.length;
  stream.push(...MAGIC_END_BYTES);

  const decoder = unwrap_result(MemDecoder.new(new Uint8Array(stream), 0));
  let refused = 0;
  for (const expected of values) {
    if (exact(expected)) {
      const actual = read(decoder);
      expect(from_ts(actual)).toBe(expected);
    } else {
      expect(() => read(decoder)).toThrow(Unported);
      refused++;
    }
  }
  expect(decoder.position()).toBe(stream_end);
  if (write_wide) expect(refused).toBeGreaterThan(0);
}

const num = (x: bigint) => Number(x);
const big = (v: number) => BigInt(v);
const id = (x: bigint) => x;
const safe = (x: bigint) => x <= SAFE && x >= -SAFE;

// rustc-macro: compiler/rustc_serialize/src/leb128/tests.rs:8 test_u16_leb128 (impl_test_unsigned_leb128!)
test("test_u16_leb128", () => check(unsigned_values(16), 2, num, big, write_u16_leb128, read_u16_leb128));
// rustc-macro: compiler/rustc_serialize/src/leb128/tests.rs:8 test_u32_leb128 (impl_test_unsigned_leb128!)
test("test_u32_leb128", () => check(unsigned_values(32), 4, num, big, write_u32_leb128, read_u32_leb128));
// rustc-macro: compiler/rustc_serialize/src/leb128/tests.rs:8 test_u64_leb128 (impl_test_unsigned_leb128!)
test("test_u64_leb128", () => check(unsigned_values(64), 8, id, id, write_u64_leb128, read_u64_leb128));
// rustc-macro: compiler/rustc_serialize/src/leb128/tests.rs:8 test_u128_leb128 (impl_test_unsigned_leb128!)
test("test_u128_leb128", () => check(unsigned_values(128), 16, id, id, write_u128_leb128, read_u128_leb128));
// rustc-macro: compiler/rustc_serialize/src/leb128/tests.rs:8 test_usize_leb128 (impl_test_unsigned_leb128!)
test("test_usize_leb128", () => check(unsigned_values(64), 8, num, big, write_usize_leb128, read_usize_leb128, safe, write_u64_leb128));

// rustc-macro: compiler/rustc_serialize/src/leb128/tests.rs:51 test_i16_leb128 (impl_test_signed_leb128!)
test("test_i16_leb128", () => check(signed_values(16), 2, num, big, write_i16_leb128, read_i16_leb128));
// rustc-macro: compiler/rustc_serialize/src/leb128/tests.rs:51 test_i32_leb128 (impl_test_signed_leb128!)
test("test_i32_leb128", () => check(signed_values(32), 4, num, big, write_i32_leb128, read_i32_leb128));
// rustc-macro: compiler/rustc_serialize/src/leb128/tests.rs:51 test_i64_leb128 (impl_test_signed_leb128!)
test("test_i64_leb128", () => check(signed_values(64), 8, id, id, write_i64_leb128, read_i64_leb128));
// rustc-macro: compiler/rustc_serialize/src/leb128/tests.rs:51 test_i128_leb128 (impl_test_signed_leb128!)
test("test_i128_leb128", () => check(signed_values(128), 16, id, id, write_i128_leb128, read_i128_leb128));
// rustc-macro: compiler/rustc_serialize/src/leb128/tests.rs:51 test_isize_leb128 (impl_test_signed_leb128!)
test("test_isize_leb128", () => check(signed_values(64), 8, num, big, write_isize_leb128, read_isize_leb128, safe, write_i64_leb128));

// PORT: extra coverage of the `usize`/`isize` `number`/`bigint` hand-over (not upstream): every
// power-of-two neighbourhood up to the safe-integer limit round-trips exactly.
test("usize/isize LEB128 near powers of two (TS number range)", () => {
  const xs: bigint[] = [];
  for (let b = 0n; b <= 53n; b++) for (const d of [-1n, 0n, 1n]) xs.push((1n << b) + d);
  const us = xs.filter((x) => x >= 0n && x <= SAFE);
  check(us, 8, num, big, write_usize_leb128, read_usize_leb128);
  const is = [...us, ...us.map((x) => -x)];
  check(is, 8, num, big, write_isize_leb128, read_isize_leb128);
});
