// Tests of src/miri/shims/time.ts (lane miri-shims-b): the isolation-on (virtual clock) paths, which must be exact:
// `clock_gettime` with the monotonic clocks, `nanosleep` / `clock_nanosleep` deadlines, `read_timespec` validation.
// The ecx is a stand-in with the fields these shims read; the libc values are x86_64-linux's (io_error.test.ts oracle).
import { expect, test } from "bun:test";
import "../lib.ts";
import { MonotonicClock } from "../clock.ts";
import { type MiriInterpCx } from "../machine.ts";
import { system_time_to_duration } from "./time.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { Scalar as interp_Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { Size } from "../../rustc_abi/lib.ts";
import { Duration, SystemTime } from "../../std/time.ts";
import { Ok } from "../../std/result.ts";

const LIBC: Record<string, number> = {
  CLOCK_REALTIME: 0, CLOCK_MONOTONIC: 1, CLOCK_REALTIME_COARSE: 5, CLOCK_MONOTONIC_COARSE: 6, TIMER_ABSTIME: 1,
  EINVAL: 22,
};

interface Rec {
  fields?: bigint[];
  ret?: bigint;
  errno?: string;
  blocked?: { reason: string; deadline: unknown };
}

/** A stand-in Linux `MiriInterpCx` with a virtual (isolation-on) monotonic clock. Places are plain objects:
 *  `{ fields: { tv_sec, tv_nsec } }` of i64 values. */
function fake_ecx(rec: Rec, clock = MonotonicClock.new(false)): MiriInterpCx {
  const ecx: Record<string, unknown> = {
    tcx: { deref: () => ({ sess: { target: { families: ["unix"], os: { $: "Linux" } } } }) },
    machine: { monotonic_clock: clock, communicate: () => false, timeout: undefined },
    eval_context_ref: () => ecx,
    eval_context_mut: () => ecx,
    eval_libc: (n: string) => interp_Scalar.from_i32(LIBC[n]!),
    eval_libc_i32: (n: string) => LIBC[n]!,
    assert_target_os_is_unix: () => {},
    libc_ty_layout: (n: string) => ({ name: n, size: Size.from_bytes(n === "clockid_t" ? 4 : 16) }),
    read_scalar: (op: { scalar: unknown }) => Ok(op.scalar),
    read_pointer: () => Ok({}),
    deref_pointer_as: (op: { place: unknown }) => Ok(op.place),
    project_field_named: (p: { fields: Record<string, bigint> }, name: string) => Ok({ value: p.fields[name], layout: { size: Size.from_bytes(8) } }),
    write_int_fields: (vs: bigint[]) => ((rec.fields = vs), Ok(undefined)),
    write_int: (v: bigint) => ((rec.ret = v), Ok(undefined)),
    set_errno_and_return_neg1: (e: { _0: string }) => ((rec.errno = e._0), (rec.ret = -1n), Ok(undefined)),
    set_errno_and_return_neg1_i32: (e: { _0: string }) => ((rec.errno = e._0), Ok(interp_Scalar.from_i32(-1))),
    block_thread: (reason: { $: string }, deadline: unknown) => {
      rec.blocked = { reason: reason.$, deadline };
    },
    parse_clockid: InterpCx.prototype.parse_clockid,
    clock_gettime: InterpCx.prototype.clock_gettime,
    nanosleep: InterpCx.prototype.nanosleep,
    clock_nanosleep: InterpCx.prototype.clock_nanosleep,
    read_timespec: InterpCx.prototype.read_timespec,
    check_no_isolation: () => Ok(undefined),
  };
  // `read_scalar` of a projected field returns its i64 value.
  const read_scalar = ecx.read_scalar as (op: { scalar?: unknown; value?: bigint }) => unknown;
  ecx.read_scalar = (op: { scalar?: unknown; value?: bigint }) => (op.value !== undefined ? Ok(interp_Scalar.from_i64(op.value)) : read_scalar(op));
  return ecx as unknown as MiriInterpCx;
}
const op = (scalar: unknown) => ({ scalar }) as never;
const clk = (n: number) => op(interp_Scalar.from_i32(n));
const ts = (tv_sec: bigint, tv_nsec: bigint) => ({ place: { fields: { tv_sec, tv_nsec } } }) as never;

test("clock_gettime(CLOCK_MONOTONIC{,_COARSE}) reads the virtual clock: 5000 ns per basic block, split into sec / nsec", () => {
  const clock = MonotonicClock.new(false);
  const rec: Rec = {};
  const ecx = fake_ecx(rec, clock);
  expect(ecx.clock_gettime(clk(1), ts(0n, 0n), {} as never).$).toBe("Ok");
  expect(rec.fields).toEqual([0n, 0n]);
  expect(rec.ret).toBe(0n);
  for (let i = 0; i < 200_001; i++) clock.tick(); // 1_000_005_000 ns
  expect(ecx.clock_gettime(clk(6), ts(0n, 0n), {} as never).$).toBe("Ok");
  expect(rec.fields).toEqual([1n, 5000n]);
});

test("clock_gettime with an unknown clock sets EINVAL and returns -1", () => {
  const rec: Rec = {};
  expect(fake_ecx(rec).clock_gettime(clk(42), ts(0n, 0n), {} as never).$).toBe("Ok");
  expect(rec.errno).toBe("EINVAL");
  expect(rec.ret).toBe(-1n);
  expect(rec.fields).toBeUndefined();
});

test("read_timespec: tv_sec >= 0, 0 <= tv_nsec < 1e9", () => {
  const ecx = fake_ecx({});
  const rd = (s: bigint, n: bigint) => {
    const r = ecx.read_timespec((ts(s, n) as unknown as { place: never }).place);
    return r.$ === "Ok" ? r._0 : "err";
  };
  expect(rd(3n, 999_999_999n)).toEqual(new Duration(3n, 999_999_999));
  expect(rd(0n, 0n)).toEqual(Duration.ZERO);
  expect(rd(-1n, 0n)).toBeUndefined();
  expect(rd(0n, -1n)).toBeUndefined();
  expect(rd(0n, 1_000_000_000n)).toBeUndefined();
  expect(rd((1n << 63n) - 1n, 0n)).toEqual(new Duration((1n << 63n) - 1n, 0));
});

test("nanosleep blocks the thread until now + duration on the virtual clock; an invalid timespec is EINVAL", () => {
  const clock = MonotonicClock.new(false);
  for (let i = 0; i < 3; i++) clock.tick(); // 15_000 ns
  const rec: Rec = {};
  const ecx = fake_ecx(rec, clock);
  const r = ecx.nanosleep(ts(2n, 500n), op(undefined));
  expect(r.$ === "Ok" && interp_Scalar.to_i32(r._0)).toEqual(Ok(0));
  expect(rec.blocked!.reason).toBe("Sleep");
  expect(rec.blocked!.deadline).toEqual({ $: "Monotonic", _0: { kind: { $: "Virtual", nanoseconds: 2_000_015_500n } } });

  const rec2: Rec = {};
  const r2 = fake_ecx(rec2, clock).nanosleep(ts(0n, 1_000_000_000n), op(undefined));
  expect(r2.$ === "Ok" && interp_Scalar.to_i32(r2._0)).toEqual(Ok(-1));
  expect(rec2.errno).toBe("EINVAL");
  expect(rec2.blocked).toBeUndefined();
});

test("clock_nanosleep: only CLOCK_MONOTONIC; flags 0 or TIMER_ABSTIME", () => {
  const rec: Rec = {};
  const ecx = fake_ecx(rec);
  const timeouts: unknown[] = [];
  (ecx.machine as unknown as { timeout: unknown }).timeout = (c: string, s: string, d: Duration) => (timeouts.push([c, s, d]), { $: "Monotonic", _0: "deadline" });
  const flags = (n: number) => op(interp_Scalar.from_i32(n));
  const c = (n: number) => op(interp_Scalar.from_i32(n));
  expect(ecx.clock_nanosleep(c(1), flags(1), ts(5n, 6n), op(undefined)).$).toBe("Ok");
  expect(ecx.clock_nanosleep(c(1), flags(0), ts(1n, 0n), op(undefined)).$).toBe("Ok");
  expect(timeouts).toEqual([["Monotonic", "Absolute", new Duration(5n, 6)], ["Monotonic", "Relative", new Duration(1n, 0)]]);
  expect(rec.blocked).toEqual({ reason: "Sleep", deadline: { $: "Monotonic", _0: "deadline" } });
  const bad_clock = ecx.clock_nanosleep(c(0), flags(0), ts(1n, 0n), op(undefined));
  expect(JSON.stringify(bad_clock)).toContain("clock_nanosleep: only CLOCK_MONOTONIC is supported");
  const bad_flags = ecx.clock_nanosleep(c(1), flags(2), ts(1n, 0n), op(undefined));
  expect(JSON.stringify(bad_flags)).toContain("`clock_nanosleep` unsupported flags 2, only no flags or TIMER_ABSTIME is supported");
});

test("system_time_to_duration: times before the epoch are unsupported", () => {
  const d = system_time_to_duration(SystemTime.UNIX_EPOCH.checked_add(new Duration(7n, 8))!);
  expect(d.$ === "Ok" && d._0).toEqual(new Duration(7n, 8));
  const before = system_time_to_duration(SystemTime.UNIX_EPOCH.checked_sub(new Duration(1n, 0))!);
  expect(JSON.stringify(before)).toContain("times before the Unix epoch are not supported");
});
