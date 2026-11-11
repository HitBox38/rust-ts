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

// docs/reviews/miri-host-fs.md item 5: `SystemTime::new` → `Timespec::new` (library/std/src/sys/time/unix.rs:19,
// sys/pal/unix/time.rs:47), with Apple's pre-epoch correction on darwin hosts.
test("SystemTime.new: Timespec::new's range check and Apple's pre-epoch form", () => {
  const I64_MIN = -(1n << 63n);
  const I64_MAX = (1n << 63n) - 1n;
  const ts = (r: ReturnType<typeof SystemTime.new>): [bigint, number] | string =>
    r.$ === "Ok" ? [r._0.t.tv_sec, r._0.t.tv_nsec] : `${r._0.$}:${"kind" in r._0 ? r._0.kind : ""}:${"message" in r._0 ? r._0.message : ""}`;
  const INVALID = "SimpleMessage:InvalidData:invalid timestamp";
  // The common unix form is stored as is.
  expect(ts(SystemTime.new(0n, 0n))).toEqual([0n, 0]);
  expect(ts(SystemTime.new(-1n, 100_000_000n))).toEqual([-1n, 100_000_000]);
  expect(ts(SystemTime.new(I64_MAX, 999_999_999n))).toEqual([I64_MAX, 999_999_999]);
  expect(ts(SystemTime.new(I64_MIN, 0n))).toEqual([I64_MIN, 0]);
  expect(ts(SystemTime.new(5n, 1_000_000_000n))).toBe(INVALID);
  expect(ts(SystemTime.new(5n, -1n))).toBe(INVALID);
  // Apple: `seconds <= 0` with `nanoseconds` in `-1e9 < n < 0` is moved to the common form; `i64::MIN` never is.
  const apple = process.platform === "darwin";
  expect(ts(SystemTime.new(0n, -900_000_000n))).toEqual(apple ? [-1n, 100_000_000] : INVALID);
  expect(ts(SystemTime.new(-1n, -1n))).toEqual(apple ? [-2n, 999_999_999] : INVALID);
  expect(ts(SystemTime.new(1n, -1n))).toBe(INVALID);
  expect(ts(SystemTime.new(0n, -1_000_000_000n))).toBe(INVALID);
  expect(ts(SystemTime.new(I64_MIN, -1n))).toBe(INVALID);
  // UNIX_EPOCH is `Timespec::zero()`; `(-1, 1e8)`, Apple's `(0, -9e8)`, is 0.9 s before it.
  const before = SystemTime.new(apple ? 0n : -1n, apple ? -900_000_000n : 100_000_000n);
  if (before.$ !== "Ok") throw new Error("expected Ok");
  const d = SystemTime.UNIX_EPOCH.duration_since(before._0);
  expect(d.$ === "Ok" && Duration_eq(d._0, Duration.new(0n, 900_000_000))).toBe(true);
});
