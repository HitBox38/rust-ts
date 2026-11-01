// Tests of the src/std/time.ts stand-ins (lane miri-eval; library/core/src/time.rs semantics).
import { expect, test } from "bun:test";
import { Duration, Duration_eq, Instant, SystemTime } from "./time.ts";
import { Panic } from "./panic.ts";

const U64_MAX = (1n << 64n) - 1n;

test("Duration constructors carry nanoseconds into seconds", () => {
  expect(Duration.new(1n, 1_500_000_000)).toEqual(new Duration(2n, 500_000_000));
  expect(() => Duration.new(U64_MAX, 1_000_000_000)).toThrow(Panic);
  expect(Duration.from_millis(1500n)).toEqual(new Duration(1n, 500_000_000));
  expect(Duration.from_micros(1_000_001n)).toEqual(new Duration(1n, 1000));
  expect(Duration.from_nanos(3_000_000_007n)).toEqual(new Duration(3n, 7));
  expect(Duration.from_nanos_u128(U64_MAX * 1_000_000_000n + 999_999_999n)).toEqual(Duration.MAX);
  expect(() => Duration.from_nanos_u128((U64_MAX + 1n) * 1_000_000_000n)).toThrow("overflow in `Duration::from_nanos_u128`");
  expect(Duration.MAX.as_nanos()).toBe(U64_MAX * 1_000_000_000n + 999_999_999n);
});

test("Duration checked / saturating add and sub", () => {
  expect(Duration.new(1n, 600_000_000).checked_add(Duration.new(0n, 600_000_000))).toEqual(new Duration(2n, 200_000_000));
  expect(Duration.MAX.checked_add(Duration.new(0n, 1))).toBeUndefined();
  expect(Duration.new(1n, 0).saturating_add(Duration.new(U64_MAX, 0))).toEqual(Duration.MAX);
  expect(Duration.new(0n, 1).checked_sub(Duration.new(0n, 0))).toEqual(new Duration(0n, 1));
  expect(Duration.new(0n, 0).checked_sub(Duration.new(0n, 1))).toBeUndefined();
  expect(Duration.new(2n, 100).checked_sub(Duration.new(1n, 200))).toEqual(new Duration(0n, 999_999_900));
  expect(Duration.new(0n, 0).saturating_sub(Duration.new(0n, 1))).toEqual(Duration.ZERO);
  expect(Duration_eq(Duration.from_secs(1n), Duration.new(0n, 1_000_000_000))).toBe(true);
});

test("Instant / SystemTime (unix Timespec arithmetic)", () => {
  const a = Instant.now();
  const b = a.checked_add(Duration.new(1n, 999_999_999))!;
  expect(b.duration_since(a)).toEqual(Duration.new(1n, 999_999_999));
  expect(a.duration_since(b)).toEqual(Duration.ZERO);
  expect(a.checked_duration_since(b)).toBeUndefined();
  expect(b.checked_sub(Duration.new(1n, 999_999_999))!.duration_since(a)).toEqual(Duration.ZERO);

  const e = SystemTime.UNIX_EPOCH;
  expect(e.checked_add(Duration.from_secs((1n << 63n) - 1n))).toBeDefined();
  expect(e.checked_add(Duration.from_secs(1n << 63n))).toBeUndefined();
  expect(e.checked_sub(Duration.new(0n, 1))!.duration_since(e)).toEqual({ $: "Err", _0: { _0: Duration.new(0n, 1) } });
  const now = SystemTime.now();
  const since = now.duration_since(e);
  expect(since.$).toBe("Ok");
  // Sanity: after 2020-01-01.
  expect(since.$ === "Ok" && since._0.as_secs() > 1_577_836_800n).toBe(true);
});
