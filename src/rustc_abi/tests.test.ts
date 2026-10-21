// compiler/rustc_abi/src/tests.rs.
import { expect, test } from "bun:test";
import { Align, Align_eq, Size, WrappingRange } from "./lib.ts";
import { Panic } from "../std/panic.ts";

const unwrap = <T>(r: { $: "Ok"; _0: T } | { $: "Err"; _0: unknown }): T => {
  if (r.$ === "Err") throw new Error("called `Result::unwrap()` on an `Err` value");
  return r._0;
};
/** `a..b` / `a..=b` over `u128` */
function* range(a: bigint, b: bigint): Generator<bigint> {
  for (let i = a; i < b; i++) yield i;
}
const range_incl = (a: bigint, b: bigint) => range(a, b + 1n);
const WR = (start: bigint, end: bigint) => new WrappingRange(start, end);
const U128_MAX = (1n << 128n) - 1n;
/** `i128::cast_unsigned` */
const cast_unsigned = (v: bigint) => BigInt.asUintN(128, v);

// rustc: compiler/rustc_abi/src/tests.rs:4 align_constants
test("align_constants", () => {
  expect(Align_eq(Align.ONE, unwrap(Align.from_bytes(1)))).toBe(true);
  expect(Align_eq(Align.EIGHT, unwrap(Align.from_bytes(8)))).toBe(true);
});

// #[should_panic(expected = "Value 299 is too big for Size(1 bytes)")]
// rustc: compiler/rustc_abi/src/tests.rs:11 wrapping_range_smallest_range_containing_size_mismatch
test("wrapping_range_smallest_range_containing_size_mismatch", () => {
  let err: unknown;
  try {
    WrappingRange.smallest_range_containing(range(200n, 300n), Size.from_bytes(1));
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Panic);
  expect((err as Panic).message).toContain("Value 299 is too big for Size(1 bytes)");
});

// rustc: compiler/rustc_abi/src/tests.rs:16 wrapping_range_smallest_range_containing
test("wrapping_range_smallest_range_containing", () => {
  // #[track_caller]
  // rustc: compiler/rustc_abi/src/tests.rs:18 check
  function check(x: Iterable<bigint>, bytes: number, start: bigint, end: bigint): void {
    const r = WrappingRange.smallest_range_containing(x, Size.from_bytes(bytes));
    expect(r === undefined ? undefined : [r.start, r.end]).toEqual([start, end]);
  }

  expect(WrappingRange.smallest_range_containing([], Size.from_bytes(1))).toBeUndefined();

  check([7n], 1, 7n, 7n);
  check([7n, 7n, 7n], 1, 7n, 7n);

  check(range_incl(0n, 127n), 1, 0n, 127n);
  check([...range_incl(0n, 127n), 255n], 1, 255n, 127n);

  check([...range_incl(-100n, 100n)].map(cast_unsigned), 16, cast_unsigned(-100n), 100n);

  // A wraparound case that's not just "sort them as signed"
  check([10n, 100n, 160n, 220n], 1, 100n, 10n);

  check([0n, 0xffn], 1, 0xffn, 0n);
  check([0n, 0xffn], 2, 0n, 0xffn);
  check([0n, 0xffffn], 2, 0xffffn, 0n);
  check([0n, 0xffffn], 4, 0n, 0xffffn);
  check([0n, 0xffffffffn], 4, 0xffffffffn, 0n);
  check([0n, 0xffffffffn], 8, 0n, 0xffffffffn);

  check([100n, 200n], 1, 100n, 200n);
  check([100n, 200n, 50n], 1, 50n, 200n);
  check([100n, 200n, 250n], 1, 100n, 250n);
  check([100n, 200n, 250n, 50n], 1, 200n, 100n);

  check([200n, 50n], 1, 200n, 50n);
  check([200n, 50n, 190n], 1, 190n, 50n);
  check([200n, 50n, 60n], 1, 200n, 60n);
  check([200n, 50n, 125n], 1, 50n, 200n);

  // A wraparound range is only potentially interesting when
  // the non-wraparound range covers over half the range.
  check([0n, 127n], 1, 0n, 127n); // `0..=127` is smaller
  check([0n, 128n], 1, 0n, 128n); // both are the same size
  check([0n, 129n], 1, 129n, 0n); // `(..=0) | (129..)` is smaller

  // The mem::Alignment case
  check(
    [...range(0n, 64n)].map((n) => 1n << n),
    8,
    1n,
    1n << 63n, // i64::MIN.cast_unsigned().into()
  );

  // Both `100..=228` and `..=228 | 100..` are the same size, but we pick the one without zero.
  check([100n, 228n], 1, 100n, 228n);

  // The wraparound one here is slightly smaller, so we pick it despite including zero.
  // (The distance 10→96 is 86, compared to 85 for 96→181 and 181→10.)
  check([10n, 96n, 181n], 1, 96n, 10n);

  // These 4 values are evenly spaced so all 4 candidate ranges have length 193:
  // `(..=32) | (96..)`, `(..=96) | (160..)`, `(..=160) | (224..)`, and `32..=224`.
  // We pick the last one as the only one that doesn't contain zero.
  check([0xa0n, 0xe0n, 0x20n, 0x60n], 1, 0x20n, 0xe0n);

  // Wraparound can still be needed even in `max - min < values.len()`.
  check([...Array<bigint>(100).fill(50n), ...Array<bigint>(100).fill(200n)], 1, 200n, 50n);
});

// rustc: compiler/rustc_abi/src/tests.rs:81 wrapping_range_contains_range
test("wrapping_range_contains_range", () => {
  const size16 = Size.from_bytes(16);

  const a = WR(10n, 20n);
  expect(a.contains_range(a, size16)).toBe(true);
  expect(a.contains_range(WR(11n, 19n), size16)).toBe(true);
  expect(a.contains_range(WR(10n, 10n), size16)).toBe(true);
  expect(a.contains_range(WR(20n, 20n), size16)).toBe(true);
  expect(a.contains_range(WR(10n, 21n), size16)).toBe(false);
  expect(a.contains_range(WR(9n, 20n), size16)).toBe(false);
  expect(a.contains_range(WR(4n, 6n), size16)).toBe(false);
  expect(a.contains_range(WR(24n, 26n), size16)).toBe(false);

  expect(a.contains_range(WR(16n, 14n), size16)).toBe(false);

  const b = WR(20n, 10n);
  expect(b.contains_range(b, size16)).toBe(true);
  expect(b.contains_range(WR(20n, 20n), size16)).toBe(true);
  expect(b.contains_range(WR(10n, 10n), size16)).toBe(true);
  expect(b.contains_range(WR(0n, 10n), size16)).toBe(true);
  expect(b.contains_range(WR(20n, 30n), size16)).toBe(true);
  expect(b.contains_range(WR(20n, 9n), size16)).toBe(true);
  expect(b.contains_range(WR(21n, 10n), size16)).toBe(true);
  expect(b.contains_range(WR(999n, 9999n), size16)).toBe(true);
  expect(b.contains_range(WR(999n, 9n), size16)).toBe(true);
  expect(b.contains_range(WR(19n, 19n), size16)).toBe(false);
  expect(b.contains_range(WR(11n, 11n), size16)).toBe(false);
  expect(b.contains_range(WR(19n, 11n), size16)).toBe(false);
  expect(b.contains_range(WR(11n, 19n), size16)).toBe(false);

  const f = WR(0n, U128_MAX);
  expect(f.contains_range(WR(10n, 20n), size16)).toBe(true);
  expect(f.contains_range(WR(20n, 10n), size16)).toBe(true);

  const g = WR(2n, 1n);
  expect(g.contains_range(WR(10n, 20n), size16)).toBe(true);
  expect(g.contains_range(WR(20n, 10n), size16)).toBe(true);

  const size1 = Size.from_bytes(1);
  const u8r = WR(0n, 255n);
  const i8r = WR(128n, 127n);
  expect(u8r.contains_range(i8r, size1)).toBe(true);
  expect(i8r.contains_range(u8r, size1)).toBe(true);
  expect(u8r.contains_range(i8r, size16)).toBe(false);
  expect(i8r.contains_range(u8r, size16)).toBe(true);

  const boolr = WR(0n, 1n);
  expect(u8r.contains_range(boolr, size1)).toBe(true);
  expect(i8r.contains_range(boolr, size1)).toBe(true);
  expect(boolr.contains_range(u8r, size1)).toBe(false);
  expect(boolr.contains_range(i8r, size1)).toBe(false);

  const cmpr = WR(255n, 1n);
  expect(u8r.contains_range(cmpr, size1)).toBe(true);
  expect(i8r.contains_range(cmpr, size1)).toBe(true);
  expect(cmpr.contains_range(u8r, size1)).toBe(false);
  expect(cmpr.contains_range(i8r, size1)).toBe(false);

  expect(boolr.contains_range(cmpr, size1)).toBe(false);
  expect(cmpr.contains_range(boolr, size1)).toBe(true);
});

// wrapping_range.rs doc test (`smallest_range_containing`)
test("wrapping_range.rs doc example: smallest_range_containing", () => {
  const chain = [...range(10n, 20n), ...range(30n, 40n)];
  let r = WrappingRange.smallest_range_containing(chain, Size.from_bytes(2))!;
  expect([r.start, r.end]).toEqual([10n, 39n]);
  r = WrappingRange.smallest_range_containing([3n, 5n, 3n, 1n, 3n], Size.from_bytes(2))!;
  expect([r.start, r.end]).toEqual([1n, 5n]);
  r = WrappingRange.smallest_range_containing([1n, 254n], Size.from_bytes(1))!;
  expect([r.start, r.end]).toEqual([254n, 1n]);
  r = WrappingRange.smallest_range_containing([1n, 254n], Size.from_bytes(4))!;
  expect([r.start, r.end]).toEqual([1n, 254n]);
});
