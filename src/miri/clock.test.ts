// Tests of src/miri/clock.ts (lane miri-eval): the virtual clock (isolation on: the only byte-exact path), `Instant`
// arithmetic, `Deadline`, `MiriMachine::timeout`, and the 2^53 stop of the `number` counter (decision C5 amendment).
import { expect, test } from "bun:test";
import "./lib.ts";
import { Deadline, Instant, MonotonicClock } from "./clock.ts";
import { MiriMachine } from "./machine.ts";
import { Panic, Unported } from "../std/panic.ts";
import { Duration, SystemTime } from "../std/time.ts";

const U128_MAX = (1n << 128n) - 1n;
const virt = (i: Instant): bigint => {
  if (i.kind.$ !== "Virtual") throw new Error("ERROR: not virtual");
  return i.kind.nanoseconds;
};

test("virtual monotonic clock: tick, sleep, now, epoch", () => {
  const c = MonotonicClock.new(false);
  expect(c.kind).toEqual({ $: "Virtual", nanoseconds: 0 });
  expect(virt(c.now())).toBe(0n);
  c.tick();
  c.tick();
  expect(virt(c.now())).toBe(10_000n); // NANOSECONDS_PER_BASIC_BLOCK = 5000
  c.sleep(Duration.new(1n, 500));
  expect(virt(c.now())).toBe(1_000_010_500n);
  expect(virt(c.epoch())).toBe(0n);
  expect(c.now().duration_since(c.epoch())).toEqual(Duration.new(1n, 10_500));
  // `saturating_sub`
  expect(c.epoch().duration_since(c.now())).toEqual(Duration.ZERO);
});

test("virtual clock counter: sleeping past 2^53 ns stops with unported (never rounds)", () => {
  const c = MonotonicClock.new(false);
  c.sleep(Duration.from_nanos(BigInt(Number.MAX_SAFE_INTEGER) - 5000n));
  c.tick(); // exactly 2^53 - 1
  expect(virt(c.now())).toBe(BigInt(Number.MAX_SAFE_INTEGER));
  expect(() => c.sleep(Duration.from_nanos(1n))).toThrow(Unported);
  expect(virt(c.now())).toBe(BigInt(Number.MAX_SAFE_INTEGER));
});

test("Instant::add_lossy saturates (virtual); Deadline::from / add_lossy", () => {
  const i = new Instant({ $: "Virtual", nanoseconds: 5n });
  expect(virt(i.add_lossy(Duration.new(2n, 3)))).toBe(2_000_000_008n);
  expect(virt(new Instant({ $: "Virtual", nanoseconds: U128_MAX - 1n }).add_lossy(Duration.from_secs(1n)))).toBe(U128_MAX);
  expect(virt(i.add_lossy(Duration.MAX))).toBe(5n + Duration.MAX.as_nanos());

  const d = Deadline.from(i);
  expect(d.$).toBe("Monotonic");
  const d2 = Deadline.add_lossy(d, Duration.from_nanos(10n));
  expect(d2.$ === "Monotonic" && virt(d2._0)).toBe(15n);

  // `RealTime`: `SystemTime` overflow falls back to adding 1h.
  const s = SystemTime.UNIX_EPOCH.checked_add(Duration.from_secs(1000n))!;
  const d3 = Deadline.add_lossy({ $: "RealTime", _0: s as never }, Duration.from_secs(1n << 63n));
  expect(d3.$).toBe("RealTime");
  const t = d3._0 as unknown as SystemTime;
  expect(t.duration_since(SystemTime.UNIX_EPOCH)).toEqual({ $: "Ok", _0: Duration.from_secs(4600n) });
  // ... and if adding 1h overflows too, the `unwrap` panics as upstream.
  const far = SystemTime.UNIX_EPOCH.checked_add(Duration.from_secs((1n << 63n) - 2n))!;
  expect(() => Deadline.add_lossy({ $: "RealTime", _0: far as never }, Duration.from_secs(10n))).toThrow(Panic);
});

test("Instant::duration_since panics on mixed kinds", () => {
  const host = MonotonicClock.new(true).now();
  expect(host.kind.$).toBe("Host");
  expect(() => host.duration_since(new Instant({ $: "Virtual", nanoseconds: 0n }))).toThrow(Panic);
});

test("MiriMachine::timeout (monotonic, isolation on; real-time needs communication)", () => {
  const clock = MonotonicClock.new(false);
  clock.sleep(Duration.from_nanos(1000n));
  const machine = { monotonic_clock: clock, communicate: () => false } as unknown as MiriMachine;
  const rel = MiriMachine.prototype.timeout.call(machine, "Monotonic", "Relative", Duration.from_nanos(5n));
  expect(rel.$ === "Monotonic" && virt(rel._0)).toBe(1005n);
  const abs = MiriMachine.prototype.timeout.call(machine, "Monotonic", "Absolute", Duration.from_nanos(5n));
  expect(abs.$ === "Monotonic" && virt(abs._0)).toBe(5n);
  expect(() => MiriMachine.prototype.timeout.call(machine, "RealTime", "Absolute", Duration.ZERO)).toThrow(
    "cannot have `RealTime` timeout with isolation",
  );
  const comm = { monotonic_clock: clock, communicate: () => true } as unknown as MiriMachine;
  const rt = MiriMachine.prototype.timeout.call(comm, "RealTime", "Absolute", Duration.from_secs(7n));
  expect(rt.$ === "RealTime" && (rt._0 as unknown as SystemTime).duration_since(SystemTime.UNIX_EPOCH)).toEqual({
    $: "Ok",
    _0: Duration.from_secs(7n),
  });
});
