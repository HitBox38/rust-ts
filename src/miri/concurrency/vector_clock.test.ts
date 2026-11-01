/// Test vector clock ordering operations
///  data-race detection is tested in the external
///  test suite
// Port of the `#[cfg(test)] mod tests` of src/tools/miri/src/concurrency/vector_clock.rs:437 (lane miri-race).
// PORT: `VClock`'s derived `PartialEq` is `VClock_eq`; the `PartialOrd` operators are the methods `lt` / `le` / `gt` / `ge`;
// `Ordering::reverse` negates; `Option<Ordering>` is `Ordering | undefined`.
import { expect, test } from "bun:test";
import "../lib.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { type Ordering, VClock, VClock_eq, VTimestamp, VectorIdx, debug_VClock } from "./vector_clock.ts";
import { PLAIN } from "../../std/fmt.ts";

// #[test]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:446 test_equal
test("test_equal", () => {
  const c1 = VClock.default();
  const c2 = VClock.default();
  expect(VClock_eq(c1, c2)).toBe(true);
  c1.increment_index(VectorIdx.new(5), DUMMY_SP);
  expect(VClock_eq(c1, c2)).toBe(false);
  c2.increment_index(VectorIdx.new(53), DUMMY_SP);
  expect(VClock_eq(c1, c2)).toBe(false);
  c1.increment_index(VectorIdx.new(53), DUMMY_SP);
  expect(VClock_eq(c1, c2)).toBe(false);
  c2.increment_index(VectorIdx.new(5), DUMMY_SP);
  expect(VClock_eq(c1, c2)).toBe(true);
});

// #[test]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:461 test_partial_order
test("test_partial_order", () => {
  // Small test
  assert_order([1], [1], 0);
  assert_order([1], [2], -1);
  assert_order([2], [1], 1);
  assert_order([1], [1, 2], -1);
  assert_order([2], [1, 2], undefined);

  // Misc tests
  assert_order([400], [0, 1], undefined);

  // Large test
  assert_order([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 0, 0], 0);
  assert_order([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 1, 0], -1);
  assert_order([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 0, 0], 1);
  assert_order([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 1, 0], undefined);
  assert_order([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 0, 0], -1);
  assert_order([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 1, 0], -1);
});

// rustc: src/tools/miri/src/concurrency/vector_clock.rs:505 from_slice
function from_slice(slice_: readonly number[]): VClock {
  let slice = slice_;
  while (slice.length > 0 && slice[slice.length - 1] === 0) {
    slice = slice.slice(0, slice.length - 1);
  }
  return new VClock(slice.map((time) => VTimestamp.new(time, "Read", DUMMY_SP)));
}

const reverse = (o: Ordering | undefined): Ordering | undefined => (o === undefined ? undefined : (-o as Ordering) || 0);
const dbg = (c: VClock): string => debug_VClock(c, PLAIN);

// rustc: src/tools/miri/src/concurrency/vector_clock.rs:518 assert_order
function assert_order(l_: readonly number[], r_: readonly number[], o: Ordering | undefined): void {
  const l = from_slice(l_);
  const r = from_slice(r_);
  const ctx = `\n l: ${dbg(l)}\n r: ${dbg(r)}`;

  //Test partial_cmp
  const compare = l.partial_cmp(r);
  expect(compare, `Invalid comparison${ctx}`).toBe(o);
  const alt_compare = r.partial_cmp(l);
  expect(alt_compare, `Invalid alt comparison${ctx}`).toBe(reverse(o));

  //Test operators with faster implementations
  expect(compare === -1, `Invalid (<):${ctx}`).toBe(l.lt(r));
  expect(compare === -1 || compare === 0, `Invalid (<=):${ctx}`).toBe(l.le(r));
  expect(compare === 1, `Invalid (>):${ctx}`).toBe(l.gt(r));
  expect(compare === 1 || compare === 0, `Invalid (>=):${ctx}`).toBe(l.ge(r));
  expect(alt_compare === -1, `Invalid alt (<):${ctx}`).toBe(r.lt(l));
  expect(alt_compare === -1 || alt_compare === 0, `Invalid alt (<=):${ctx}`).toBe(r.le(l));
  expect(alt_compare === 1, `Invalid alt (>):${ctx}`).toBe(r.gt(l));
  expect(alt_compare === 1 || alt_compare === 0, `Invalid alt (>=):${ctx}`).toBe(r.ge(l));
}

// #[test]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:576 set_index_to_0
test("set_index_to_0", () => {
  const clock1 = from_slice([0, 1, 2, 3]);
  const clock2 = from_slice([0, 2, 3, 4, 0, 5]);
  // Naively, this would extend clock1 with a new index and set it to 0, making
  // the last index 0. Make sure that does not happen.
  clock1.set_at_index(clock2, VectorIdx.new(4));
  // This must not have made the last element 0.
  expect(clock1._0[clock1._0.length - 1]!.time() !== 0).toBe(true);
});

// ---- rust-ts additions (not upstream tests) ----

test("VTimestamp encoding, Debug, frozen ZERO, interned VectorIdx", () => {
  const t = VTimestamp.new(7, "Retag", DUMMY_SP);
  expect(t.time_and_read_type).toBe(15);
  expect([t.time(), t.read_type()]).toEqual([7, "Retag"]);
  t.set_time(8);
  expect([t.time(), t.read_type()]).toEqual([8, "Retag"]);
  t.set_read_type("Read");
  expect(t.time_and_read_type).toBe(16);
  // the largest time that fits: u32::MAX / 2
  const big = VTimestamp.new(0x7fffffff, "Retag", DUMMY_SP);
  expect(big.time_and_read_type).toBe(0xffffffff);
  expect(big.time()).toBe(0x7fffffff);
  expect(() => VTimestamp.new(0x80000000, "Read", DUMMY_SP)).toThrow("Vector clock overflow");
  expect(Object.isFrozen(VTimestamp.ZERO)).toBe(true);
  expect(VectorIdx.new(3)).toBe(VectorIdx.from(3));
  // `Index` past the end is ZERO; `join` keeps the invariant and copies (no aliasing of the source's slots).
  const a = from_slice([1, 0, 3]);
  const b = from_slice([2, 5]);
  a.join(b);
  expect(a._0.map((x) => x.time())).toEqual([2, 5, 3]);
  b.increment_index(VectorIdx.new(0), DUMMY_SP);
  expect(a.index(VectorIdx.new(0)).time()).toBe(2);
  expect(a.index(VectorIdx.new(9))).toBe(VTimestamp.ZERO);
  // clone_from reuses and truncates
  a.clone_from(b);
  expect(a._0.map((x) => x.time())).toEqual([3, 5]);
  expect(a._0[0]).not.toBe(b._0[0]);
});
