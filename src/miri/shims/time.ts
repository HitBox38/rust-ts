// Port of src/tools/miri/src/shims/time.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-shims-b` (plan-m6 wave 37).
//
// PORT:
// - Host time (`SystemTime::now()`, isolation off) is src/std/time.ts's stand-in (plan-m6 D14); the monotonic clock is
//   the machine's `MonotonicClock` (src/miri/clock.ts: virtual with isolation on, so those paths are exact).
// - `localtime_r` needs chrono / chrono-tz (plan-m6 D5: `unported` in M6); it is only reachable with isolation off
//   (`check_no_isolation` comes first), and stops `unported` after the argument reads.
import { Deadline, type Instant as MiriInstant, type TimeoutClock, type TimeoutStyle } from "../clock.ts";
import { type UnblockKind } from "../concurrency/thread.ts";
import { type MPlaceTy, type OpTy, type Pointer, type Scalar } from "../lib.ts";
import { callback, type MiriInterpCx } from "../machine.ts";
import { LibcError } from "./io_error.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Scalar as interp_Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { ScalarInt_eq } from "../../rustc_middle/ty/consts/int.ts";
import { type Os } from "../../rustc_target/spec/mod.ts";
import { assert_eq, panic, unported } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { Duration, SystemTime } from "../../std/time.ts";

/** `throw_unsup_format!(..)` / `err_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}

/** `Scalar == Scalar` (derived `PartialEq`) where the right side is an integer (`eval_libc` values always are):
 *  a pointer on the left is a different variant, so unequal. */
function scalar_eq_int(a: Scalar, b: Scalar): boolean {
  if (b.$ !== "Int") return panic("scalar_eq_int: right side is not an integer");
  return a.$ === "Int" && ScalarInt_eq(a._0, b._0);
}

/** `Duration::subsec_micros` (library/core/src/time.rs: `self.nanos.as_inner() / NANOS_PER_MICRO`). */
function subsec_micros(d: Duration): number {
  return Math.floor(d.subsec_nanos() / 1000);
}

/** `impl Add for Duration` (library/core/src/time.rs): `checked_add(..).expect("overflow when adding durations")`. */
function duration_add(a: Duration, b: Duration): Duration {
  const r = a.checked_add(b);
  if (r === undefined) return panic("overflow when adding durations");
  return r;
}

/** The `callback!` every sleep shim blocks with (`@capture<'tcx> {}`): it only accepts a timeout. */
function sleep_callback() {
  return callback<Record<string, never>, UnblockKind>({}, (_this, unblock) => {
    assert_eq<UnblockKind>(unblock, "TimedOut", (v) => v);
    return interp_ok(undefined);
  });
}

const OS_WINDOWS: Os = { $: "Windows" } as Os;
const OS_MACOS: Os = { $: "MacOs" } as Os;

/// Returns the time elapsed between the provided time and the unix epoch as a `Duration`.
// rustc: src/tools/miri/src/shims/time.rs:13 system_time_to_duration
export function system_time_to_duration(time: SystemTime): InterpResult<Duration> {
  const r = time.duration_since(SystemTime.UNIX_EPOCH);
  if (r.$ === "Err") return throw_unsup_format("times before the Unix epoch are not supported");
  return interp_ok(r._0);
}

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/time.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/time.rs:21
    parse_clockid(this: MiriInterpCx, clk_id: Scalar): TimeoutClock | undefined;
    // shims/time.rs:61
    clock_gettime(this: MiriInterpCx, clk_id_op: OpTy, tp_op: OpTy, dest: MPlaceTy): InterpResult;
    // shims/time.rs:98
    gettimeofday(this: MiriInterpCx, tv_op: OpTy, tz_op: OpTy): InterpResult<Scalar>;
    // shims/time.rs:128
    localtime_r(this: MiriInterpCx, timep: OpTy, result_op: OpTy): InterpResult<Pointer>;
    // shims/time.rs:213
    GetSystemTimeAsFileTime(this: MiriInterpCx, shim_name: string, LPFILETIME_op: OpTy): InterpResult;
    // shims/time.rs:236
    QueryPerformanceCounter(this: MiriInterpCx, lpPerformanceCount_op: OpTy): InterpResult<Scalar>;
    // shims/time.rs:260
    QueryPerformanceFrequency(this: MiriInterpCx, lpFrequency_op: OpTy): InterpResult<Scalar>;
    // shims/time.rs:281
    system_time_since_windows_epoch(this: MiriInterpCx, time: SystemTime): InterpResult<Duration>;
    // shims/time.rs:291
    windows_ticks_for(this: MiriInterpCx, duration: Duration): InterpResult<bigint>;
    // shims/time.rs:301
    mach_absolute_time(this: MiriInterpCx): InterpResult<Scalar>;
    // shims/time.rs:316
    mach_timebase_info(this: MiriInterpCx, info_op: OpTy): InterpResult<Scalar>;
    // shims/time.rs:331
    mach_wait_until(this: MiriInterpCx, deadline_op: OpTy): InterpResult<Scalar>;
    // shims/time.rs:357
    nanosleep(this: MiriInterpCx, duration: OpTy, rem: OpTy): InterpResult<Scalar>;
    // shims/time.rs:384
    clock_nanosleep(this: MiriInterpCx, clock_id: OpTy, flags: OpTy, timespec: OpTy, rem: OpTy): InterpResult<Scalar>;
    // shims/time.rs:440
    Sleep(this: MiriInterpCx, timeout: OpTy): InterpResult;
    // shims/time.rs:467
    read_timespec(this: MiriInterpCx, tp: MPlaceTy): InterpResult<Duration | undefined>;
    // shims/time.rs:490
    read_timeval(this: MiriInterpCx, tp: MPlaceTy): InterpResult<Duration | undefined>;
  }
}

// rustc: src/tools/miri/src/shims/time.rs:21 parse_clockid
InterpCx.prototype.parse_clockid = function (this: MiriInterpCx, clk_id: Scalar): TimeoutClock | undefined {
  // This clock support is deliberately minimal because a lot of clock types have fiddly
  // properties (is it possible for Miri to be suspended independently of the host?). If you
  // have a use for another clock type, please open an issue.
  const this_ = this.eval_context_ref();

  // Portable names that exist everywhere.
  if (scalar_eq_int(clk_id, this_.eval_libc("CLOCK_REALTIME"))) {
    return "RealTime";
  } else if (scalar_eq_int(clk_id, this_.eval_libc("CLOCK_MONOTONIC"))) {
    return "Monotonic";
  }

  // Some further platform-specific names we support.
  switch (this_.tcx.deref().sess.target.os.$) {
    case "Linux":
    case "FreeBsd":
    case "Android":
      // Linux further distinguishes regular and "coarse" clocks, but the "coarse" version
      // is just specified to be "faster and less precise", so we treat it like normal
      // clocks.
      if (scalar_eq_int(clk_id, this_.eval_libc("CLOCK_REALTIME_COARSE"))) {
        return "RealTime";
      } else if (scalar_eq_int(clk_id, this_.eval_libc("CLOCK_MONOTONIC_COARSE"))) {
        return "Monotonic";
      }
      break;
    // #[allow(clippy::collapsible_match)] // collapsing would remove symmetry
    case "MacOs":
      // `CLOCK_UPTIME_RAW` supposed to not increment while the system is asleep... but
      // that's not really something a program running inside Miri can tell, anyway.
      // We need to support it because std uses it.
      if (scalar_eq_int(clk_id, this_.eval_libc("CLOCK_UPTIME_RAW"))) {
        return "Monotonic";
      }
      break;
    default:
      break;
  }

  return undefined;
};

// rustc: src/tools/miri/src/shims/time.rs:61 clock_gettime
InterpCx.prototype.clock_gettime = function (this: MiriInterpCx, clk_id_op: OpTy, tp_op: OpTy, dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();

  this_.assert_target_os_is_unix("clock_gettime");

  const clk_id = this_.read_scalar(clk_id_op);
  if (clk_id.$ === "Err") return clk_id;
  const tp = this_.deref_pointer_as(tp_op, this_.libc_ty_layout("timespec"));
  if (tp.$ === "Err") return tp;

  let duration: Duration;
  switch (this_.parse_clockid(clk_id._0)) {
    case "RealTime": {
      const r = this_.check_no_isolation("`clock_gettime` with `REALTIME` clocks");
      if (r.$ === "Err") return r;
      const d = system_time_to_duration(SystemTime.now());
      if (d.$ === "Err") return d;
      duration = d._0;
      break;
    }
    case "Monotonic":
      duration = this_.machine.monotonic_clock.now().duration_since(this_.machine.monotonic_clock.epoch());
      break;
    case undefined:
      return this_.set_errno_and_return_neg1(LibcError("EINVAL"), dest);
  }

  const tv_sec = duration.as_secs();
  const tv_nsec = duration.subsec_nanos();

  const w = this_.write_int_fields([tv_sec, BigInt(tv_nsec)], tp._0);
  if (w.$ === "Err") return w;
  const w2 = this_.write_int(0n, dest);
  if (w2.$ === "Err") return w2;

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/time.rs:98 gettimeofday
InterpCx.prototype.gettimeofday = function (this: MiriInterpCx, tv_op: OpTy, tz_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  this_.assert_target_os_is_unix("gettimeofday");
  const ni = this_.check_no_isolation("`gettimeofday`");
  if (ni.$ === "Err") return ni;

  const tv = this_.deref_pointer_as(tv_op, this_.libc_ty_layout("timeval"));
  if (tv.$ === "Err") return tv;

  // Using tz is obsolete and should always be null
  const tz = this_.read_pointer(tz_op);
  if (tz.$ === "Err") return tz;
  const is_null = this_.ptr_is_null(tz._0);
  if (is_null.$ === "Err") return is_null;
  if (!is_null._0) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EINVAL"));
  }

  const duration = system_time_to_duration(SystemTime.now());
  if (duration.$ === "Err") return duration;
  const tv_sec = duration._0.as_secs();
  const tv_usec = subsec_micros(duration._0);

  const w = this_.write_int_fields([tv_sec, BigInt(tv_usec)], tv._0);
  if (w.$ === "Err") return w;

  return interp_ok(interp_Scalar.from_i32(0));
};

// The localtime() function shall convert the time in seconds since the Epoch pointed to by
// timer into a broken-down time, expressed as a local time.
// https://linux.die.net/man/3/localtime_r
// rustc: src/tools/miri/src/shims/time.rs:128 localtime_r
InterpCx.prototype.localtime_r = function (this: MiriInterpCx, timep: OpTy, result_op: OpTy): InterpResult<Pointer> {
  const this_ = this.eval_context_mut();

  this_.assert_target_os_is_unix("localtime_r");
  const ni = this_.check_no_isolation("`localtime_r`");
  if (ni.$ === "Err") return ni;

  const time_layout = this_.libc_ty_layout("time_t");
  const timep_ = this_.deref_pointer_as(timep, time_layout);
  if (timep_.$ === "Err") return timep_;
  const result = this_.deref_pointer_as(result_op, this_.libc_ty_layout("tm"));
  if (result.$ === "Err") return result;

  // The input "represents the number of seconds elapsed since the Epoch,
  // 1970-01-01 00:00:00 +0000 (UTC)".
  const s = this_.read_scalar(timep_._0);
  if (s.$ === "Err") return s;
  const sec_since_epoch = interp_Scalar.to_int(s._0, time_layout.size);
  if (sec_since_epoch.$ === "Err") return sec_since_epoch;
  // let dt_utc: DateTime<Utc> = DateTime::from_timestamp(sec_since_epoch, 0).expect("Invalid timestamp");
  // ... (time zone from `TZ`, `dt_utc.with_timezone(&tz)`, the broken-down fields, `tm_zone` / `tm_gmtoff`)
  return unported("chrono::DateTime / chrono_tz::Tz (miri::shims::time::localtime_r, isolation off; plan-m6 D5)");
};

// #[allow(non_snake_case, clippy::arithmetic_side_effects)]
// rustc: src/tools/miri/src/shims/time.rs:213 GetSystemTimeAsFileTime
InterpCx.prototype.GetSystemTimeAsFileTime = function (this: MiriInterpCx, shim_name: string, LPFILETIME_op: OpTy): InterpResult {
  const this_ = this.eval_context_mut();

  this_.assert_target_os(OS_WINDOWS, shim_name);
  const ni = this_.check_no_isolation(shim_name);
  if (ni.$ === "Err") return ni;

  const filetime = this_.deref_pointer_as(LPFILETIME_op, this_.windows_ty_layout("FILETIME"));
  if (filetime.$ === "Err") return filetime;

  const duration = this_.system_time_since_windows_epoch(SystemTime.now());
  if (duration.$ === "Err") return duration;
  const duration_ticks = this_.windows_ticks_for(duration._0);
  if (duration_ticks.$ === "Err") return duration_ticks;

  const dwLowDateTime = duration_ticks._0 & 0x00000000ffffffffn;
  const dwHighDateTime = (duration_ticks._0 & 0xffffffff00000000n) >> 32n;
  return this_.write_int_fields([dwLowDateTime, dwHighDateTime], filetime._0);
};

// #[allow(non_snake_case)]
// rustc: src/tools/miri/src/shims/time.rs:236 QueryPerformanceCounter
InterpCx.prototype.QueryPerformanceCounter = function (this: MiriInterpCx, lpPerformanceCount_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  this_.assert_target_os(OS_WINDOWS, "QueryPerformanceCounter");

  // QueryPerformanceCounter uses a hardware counter as its basis.
  // Miri will emulate a counter with a resolution of 1 nanosecond.
  const duration = this_.machine.monotonic_clock.now().duration_since(this_.machine.monotonic_clock.epoch());
  const nanos = duration.as_nanos();
  if (nanos > (1n << 63n) - 1n) {
    return throw_unsup_format("programs running longer than 2^63 nanoseconds are not supported");
  }
  const qpc = nanos;

  const place = this_.deref_pointer_as(lpPerformanceCount_op, this_.machine.layouts.i64);
  if (place.$ === "Err") return place;
  const w = this_.write_scalar(interp_Scalar.from_i64(qpc), place._0);
  if (w.$ === "Err") return w;
  return interp_ok(interp_Scalar.from_i32(-1)); // return non-zero on success
};

// #[allow(non_snake_case)]
// rustc: src/tools/miri/src/shims/time.rs:260 QueryPerformanceFrequency
InterpCx.prototype.QueryPerformanceFrequency = function (this: MiriInterpCx, lpFrequency_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  this_.assert_target_os(OS_WINDOWS, "QueryPerformanceFrequency");

  // Retrieves the frequency of the hardware performance counter.
  // The frequency of the performance counter is fixed at system boot and
  // is consistent across all processors.
  // Miri emulates a "hardware" performance counter with a resolution of 1ns,
  // and thus 10^9 counts per second.
  const place = this_.deref_pointer_as(lpFrequency_op, this_.machine.layouts.u64);
  if (place.$ === "Err") return place;
  const w = this_.write_scalar(interp_Scalar.from_i64(1_000_000_000n), place._0);
  if (w.$ === "Err") return w;
  return interp_ok(interp_Scalar.from_i32(-1)); // Return non-zero on success
};

// #[allow(clippy::arithmetic_side_effects)]
// rustc: src/tools/miri/src/shims/time.rs:281 system_time_since_windows_epoch
InterpCx.prototype.system_time_since_windows_epoch = function (this: MiriInterpCx, time: SystemTime): InterpResult<Duration> {
  // The amount of seconds between 1601/1/1 and 1970/1/1.
  // See https://learn.microsoft.com/en-us/windows/win32/sysinfo/converting-a-time-t-value-to-a-file-time
  // (just divide by the number of 100 ns intervals per second).
  const SECONDS_TO_UNIX_EPOCH = 11_644_473_600n;

  const d = system_time_to_duration(time);
  if (d.$ === "Err") return d;
  return interp_ok(duration_add(d._0, Duration.from_secs(SECONDS_TO_UNIX_EPOCH)));
};

// #[allow(non_snake_case, clippy::arithmetic_side_effects)]
// rustc: src/tools/miri/src/shims/time.rs:291 windows_ticks_for
InterpCx.prototype.windows_ticks_for = function (this: MiriInterpCx, duration: Duration): InterpResult<bigint> {
  // 1 interval = 100 ns.
  // See https://learn.microsoft.com/en-us/windows/win32/api/minwinbase/ns-minwinbase-filetime
  const NANOS_PER_INTERVAL = 100n;

  const ticks = duration.as_nanos() / NANOS_PER_INTERVAL;
  if (ticks > (1n << 64n) - 1n) {
    return throw_unsup_format("programs running more than 2^64 Windows ticks after the Windows epoch are not supported");
  }
  return interp_ok(ticks);
};

// rustc: src/tools/miri/src/shims/time.rs:301 mach_absolute_time
InterpCx.prototype.mach_absolute_time = function (this: MiriInterpCx): InterpResult<Scalar> {
  const this_ = this.eval_context_ref();

  this_.assert_target_os(OS_MACOS, "mach_absolute_time");

  // This returns a u64, with time units determined dynamically by `mach_timebase_info`.
  // We return plain nanoseconds.
  const duration = this_.machine.monotonic_clock.now().duration_since(this_.machine.monotonic_clock.epoch());
  const res = duration.as_nanos();
  if (res > (1n << 64n) - 1n) {
    return throw_unsup_format("programs running longer than 2^64 nanoseconds are not supported");
  }
  return interp_ok(interp_Scalar.from_u64(res));
};

// rustc: src/tools/miri/src/shims/time.rs:316 mach_timebase_info
InterpCx.prototype.mach_timebase_info = function (this: MiriInterpCx, info_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  this_.assert_target_os(OS_MACOS, "mach_timebase_info");

  const info = this_.deref_pointer_as(info_op, this_.libc_ty_layout("mach_timebase_info"));
  if (info.$ === "Err") return info;

  // Since our emulated ticks in `mach_absolute_time` *are* nanoseconds,
  // no scaling needs to happen.
  const [numerator, denom] = [1n, 1n];
  const w = this_.write_int_fields([numerator, denom], info._0);
  if (w.$ === "Err") return w;

  return interp_ok(interp_Scalar.from_i32(0)); // KERN_SUCCESS
};

// rustc: src/tools/miri/src/shims/time.rs:331 mach_wait_until
InterpCx.prototype.mach_wait_until = function (this: MiriInterpCx, deadline_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  this_.assert_target_os(OS_MACOS, "mach_wait_until");

  const s = this_.read_scalar(deadline_op);
  if (s.$ === "Err") return s;
  const deadline_r = interp_Scalar.to_u64(s._0);
  if (deadline_r.$ === "Err") return deadline_r;
  // Our mach_absolute_time "ticks" are plain nanoseconds.
  const deadline_d = Duration.from_nanos(deadline_r._0);
  // This is *absolute* time.
  const deadline: MiriInstant = this_.machine.monotonic_clock.epoch().add_lossy(deadline_d);

  this_.block_thread({ $: "Sleep" }, Deadline.from(deadline), sleep_callback());

  return interp_ok(interp_Scalar.from_i32(0)); // KERN_SUCCESS
};

// rustc: src/tools/miri/src/shims/time.rs:357 nanosleep
InterpCx.prototype.nanosleep = function (this: MiriInterpCx, duration: OpTy, rem: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  this_.assert_target_os_is_unix("nanosleep");

  const duration_place = this_.deref_pointer_as(duration, this_.libc_ty_layout("timespec"));
  if (duration_place.$ === "Err") return duration_place;
  const _rem = this_.read_pointer(rem); // Signal handlers are not supported, so rem will never be written to.
  if (_rem.$ === "Err") return _rem;

  const d = this_.read_timespec(duration_place._0);
  if (d.$ === "Err") return d;
  if (d._0 === undefined) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EINVAL"));
  }
  const deadline = this_.machine.monotonic_clock.now().add_lossy(d._0);

  this_.block_thread({ $: "Sleep" }, Deadline.from(deadline), sleep_callback());
  return interp_ok(interp_Scalar.from_i32(0));
};

// rustc: src/tools/miri/src/shims/time.rs:384 clock_nanosleep
InterpCx.prototype.clock_nanosleep = function (this: MiriInterpCx, clock_id: OpTy, flags: OpTy, timespec: OpTy, rem: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  const clockid_t_size = this_.libc_ty_layout("clockid_t").size;

  const clock_id_s = this_.read_scalar(clock_id);
  if (clock_id_s.$ === "Err") return clock_id_s;
  const clock_id_ = interp_Scalar.to_int(clock_id_s._0, clockid_t_size);
  if (clock_id_.$ === "Err") return clock_id_;
  const timespec_ = this_.deref_pointer_as(timespec, this_.libc_ty_layout("timespec"));
  if (timespec_.$ === "Err") return timespec_;
  const flags_s = this_.read_scalar(flags);
  if (flags_s.$ === "Err") return flags_s;
  const flags_ = interp_Scalar.to_i32(flags_s._0);
  if (flags_.$ === "Err") return flags_;
  const _rem = this_.read_pointer(rem); // Signal handlers are not supported, so rem will never be written to.
  if (_rem.$ === "Err") return _rem;

  // The standard lib through sleep_until only needs CLOCK_MONOTONIC
  const monotonic = interp_Scalar.to_int(this_.eval_libc("CLOCK_MONOTONIC"), clockid_t_size);
  if (monotonic.$ === "Err") return monotonic;
  if (clock_id_._0 !== monotonic._0) {
    return throw_unsup_format("clock_nanosleep: only CLOCK_MONOTONIC is supported");
  }

  const duration = this_.read_timespec(timespec_._0);
  if (duration.$ === "Err") return duration;
  if (duration._0 === undefined) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EINVAL"));
  }

  let timeout_style: TimeoutStyle;
  if (flags_._0 === 0) {
    // No flags set, the timespec should be interpreted as a duration
    // to sleep for, i.e., a relative time.
    timeout_style = "Relative";
  } else if (flags_._0 === this_.eval_libc_i32("TIMER_ABSTIME")) {
    // Only flag TIMER_ABSTIME set, the timespec should be interpreted as
    // an absolute time.
    timeout_style = "Absolute";
  } else {
    // The standard lib (through `sleep_until`) only needs TIMER_ABSTIME
    return throw_unsup_format(`\`clock_nanosleep\` unsupported flags ${flags_._0}, only no flags or TIMER_ABSTIME is supported`);
  }
  const deadline = this_.machine.timeout("Monotonic", timeout_style, duration._0);

  this_.block_thread({ $: "Sleep" }, deadline, sleep_callback());
  return interp_ok(interp_Scalar.from_i32(0));
};

// #[allow(non_snake_case)]
// rustc: src/tools/miri/src/shims/time.rs:440 Sleep
InterpCx.prototype.Sleep = function (this: MiriInterpCx, timeout: OpTy): InterpResult {
  const this_ = this.eval_context_mut();

  this_.assert_target_os(OS_WINDOWS, "Sleep");

  const s = this_.read_scalar(timeout);
  if (s.$ === "Err") return s;
  const timeout_ms = interp_Scalar.to_u32(s._0);
  if (timeout_ms.$ === "Err") return timeout_ms;

  const duration = Duration.from_millis(BigInt(timeout_ms._0));
  const deadline = this_.machine.monotonic_clock.now().add_lossy(duration);

  this_.block_thread({ $: "Sleep" }, Deadline.from(deadline), sleep_callback());
  return interp_ok(undefined);
};

/// Parse a `timespec` struct and return it as a [`Duration`]. It returns [`None`]
/// if the value in the `timespec` struct is invalid. Some libc functions will return
/// EINVAL in this case.
// rustc: src/tools/miri/src/shims/time.rs:467 read_timespec
InterpCx.prototype.read_timespec = function (this: MiriInterpCx, tp: MPlaceTy): InterpResult<Duration | undefined> {
  const this_ = this.eval_context_ref();
  const sec_field = this_.project_field_named(tp, "tv_sec");
  if (sec_field.$ === "Err") return sec_field;
  const sec_s = this_.read_scalar(sec_field._0);
  if (sec_s.$ === "Err") return sec_s;
  const sec = interp_Scalar.to_int(sec_s._0, sec_field._0.layout.size);
  if (sec.$ === "Err") return sec;
  const nsec_field = this_.project_field_named(tp, "tv_nsec");
  if (nsec_field.$ === "Err") return nsec_field;
  const nsec_s = this_.read_scalar(nsec_field._0);
  if (nsec_s.$ === "Err") return nsec_s;
  const nsec = interp_Scalar.to_int(nsec_s._0, nsec_field._0.layout.size);
  if (nsec.$ === "Err") return nsec;

  // try { .. }
  const v = ((): Duration | undefined => {
    // tv_sec must be non-negative.
    if (sec._0 < 0n || sec._0 > (1n << 64n) - 1n) return undefined; // let seconds: u64 = sec.try_into().ok()?;
    const seconds = sec._0;
    // tv_nsec must be non-negative.
    if (nsec._0 < 0n || nsec._0 > 0xffffffffn) return undefined; // let nanoseconds: u32 = nsec.try_into().ok()?;
    const nanoseconds = Number(nsec._0);
    if (nanoseconds >= 1_000_000_000) {
      // tv_nsec must not be greater than 999,999,999.
      return undefined;
    }
    return Duration.new(seconds, nanoseconds);
  })();
  return interp_ok(v);
};

/// Parse a `timeval` struct and return it as a [`Duration`]. It returns [`None`]
/// if the value in the `timeval` struct is invalid. Some libc functions will return
/// EINVAL in this case.
// rustc: src/tools/miri/src/shims/time.rs:490 read_timeval
InterpCx.prototype.read_timeval = function (this: MiriInterpCx, tp: MPlaceTy): InterpResult<Duration | undefined> {
  const this_ = this.eval_context_mut();
  const sec_field = this_.project_field_named(tp, "tv_sec");
  if (sec_field.$ === "Err") return sec_field;
  const sec_s = this_.read_scalar(sec_field._0);
  if (sec_s.$ === "Err") return sec_s;
  const sec = interp_Scalar.to_int(sec_s._0, sec_field._0.layout.size);
  if (sec.$ === "Err") return sec;

  const usec_field = this_.project_field_named(tp, "tv_usec");
  if (usec_field.$ === "Err") return usec_field;
  const usec_s = this_.read_scalar(usec_field._0);
  if (usec_s.$ === "Err") return usec_s;
  const usec = interp_Scalar.to_int(usec_s._0, usec_field._0.layout.size);
  if (usec.$ === "Err") return usec;

  // try { .. }
  const v = ((): Duration | undefined => {
    // tv_sec must be non-negative.
    if (sec._0 < 0n || sec._0 > (1n << 64n) - 1n) return undefined; // let seconds: u64 = sec.try_into().ok()?;
    const seconds = sec._0;
    // tv_usec must be non-negative.
    if (usec._0 < 0n || usec._0 > 0xffffffffn) return undefined; // let microseconds: u32 = usec.try_into().ok()?;
    const microseconds = Number(usec._0);
    if (microseconds >= 1_000_000) {
      // tv_usec must not be greater than 999,999.
      return undefined;
    }
    // microseconds.strict_mul(1000): < 1e9, no overflow.
    return Duration.new(seconds, microseconds * 1000);
  })();
  return interp_ok(v);
};
