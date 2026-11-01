// `std::time` stand-ins (`Duration`, `Instant`, `SystemTime`): plan-m6 D14 (host time goes through src/std stand-ins),
// created by lane miri-eval for Miri's clock.rs (tools/codegen/miri.typemap.json names this lane for it).
// Port of library/core/src/time.rs (`Duration`, the subset Miri uses) and library/std/src/time.rs (`Instant`,
// `SystemTime`) over the unix `Timespec` arithmetic (library/std/src/sys/pal/unix/time.rs).
//
// PORT:
// - `Duration { secs: u64, nanos: u32 }`: `secs` is a `bigint` (u64, PORTING §5: program-supplied durations reach
//   u64::MAX), `nanos` a number < 1e9. Durations are immutable values (Rust: `Copy`).
// - `Instant` / `SystemTime` are unix `Timespec`s (`tv_sec: i64` bigint, `tv_nsec` < 1e9). Only isolation-off (host)
//   paths read the host clock: `Instant::now()` is `process.hrtime.bigint()` (monotonic, like CLOCK_MONOTONIC /
//   CLOCK_UPTIME_RAW), `SystemTime::now()` is `performance.timeOrigin + performance.now()` (wall clock, sub-ms; the host
//   value differs per run anyway, D14).
import { panic } from "./panic.ts";
import { Err, Ok, type Result } from "./result.ts";

const NANOS_PER_SEC = 1_000_000_000;
const NANOS_PER_SEC_N = 1_000_000_000n;
const U64_MAX = (1n << 64n) - 1n;
const I64_MAX = (1n << 63n) - 1n;
const I64_MIN = -(1n << 63n);

/// A `Duration` type to represent a span of time, typically used for system
/// timeouts.
export class Duration {
  constructor(
    readonly secs: bigint,
    readonly nanos: number,
  ) {}

  /// A duration of zero time.
  static readonly ZERO: Duration = new Duration(0n, 0);
  /// The maximum duration.
  static readonly MAX: Duration = new Duration(U64_MAX, NANOS_PER_SEC - 1);

  // std: library/core/src/time.rs:274 new
  static new(secs: bigint, nanos: number): Duration {
    if (nanos < NANOS_PER_SEC) {
      return new Duration(secs, nanos);
    } else {
      const secs2 = secs + BigInt(Math.floor(nanos / NANOS_PER_SEC));
      if (secs2 > U64_MAX) panic("adding carry-over seconds from nanoseconds should not exceed u64::MAX");
      return new Duration(secs2, nanos % NANOS_PER_SEC);
    }
  }

  // std: library/core/src/time.rs:304 from_secs
  static from_secs(secs: bigint): Duration {
    return new Duration(secs, 0);
  }

  // std: library/core/src/time.rs:324 from_millis
  static from_millis(millis: bigint): Duration {
    const secs = millis / 1000n;
    const subsec_millis = Number(millis % 1000n);
    return new Duration(secs, subsec_millis * 1_000_000);
  }

  // std: library/core/src/time.rs:350 from_micros
  static from_micros(micros: bigint): Duration {
    const secs = micros / 1_000_000n;
    const subsec_micros = Number(micros % 1_000_000n);
    return new Duration(secs, subsec_micros * 1000);
  }

  // std: library/core/src/time.rs:381 from_nanos
  static from_nanos(nanos: bigint): Duration {
    const secs = nanos / NANOS_PER_SEC_N;
    const subsec_nanos = Number(nanos % NANOS_PER_SEC_N);
    return new Duration(secs, subsec_nanos);
  }

  // std: library/core/src/time.rs:414 from_nanos_u128
  static from_nanos_u128(nanos: bigint): Duration {
    const secs = nanos / NANOS_PER_SEC_N;
    if (secs > U64_MAX) panic("overflow in `Duration::from_nanos_u128`");
    const subsec_nanos = Number(nanos % NANOS_PER_SEC_N);
    return new Duration(secs, subsec_nanos);
  }

  // std: library/core/src/time.rs:594 as_secs
  as_secs(): bigint {
    return this.secs;
  }

  // std: library/core/src/time.rs:663 subsec_nanos
  subsec_nanos(): number {
    return this.nanos;
  }

  // std: library/core/src/time.rs:719 as_nanos
  as_nanos(): bigint {
    return this.secs * NANOS_PER_SEC_N + BigInt(this.nanos);
  }

  // std: library/core/src/time.rs:758 checked_add
  checked_add(rhs: Duration): Duration | undefined {
    let secs = this.secs + rhs.secs;
    if (secs <= U64_MAX) {
      let nanos = this.nanos + rhs.nanos;
      if (nanos >= NANOS_PER_SEC) {
        nanos -= NANOS_PER_SEC;
        const new_secs = secs + 1n;
        if (new_secs > U64_MAX) {
          return undefined;
        }
        secs = new_secs;
      }
      // debug_assert!(nanos < NANOS_PER_SEC);
      return Duration.new(secs, nanos);
    } else {
      return undefined;
    }
  }

  // std: library/core/src/time.rs:791 saturating_add
  saturating_add(rhs: Duration): Duration {
    const res = this.checked_add(rhs);
    return res !== undefined ? res : Duration.MAX;
  }

  // std: library/core/src/time.rs:814 checked_sub
  checked_sub(rhs: Duration): Duration | undefined {
    let secs = this.secs - rhs.secs;
    if (secs >= 0n) {
      let nanos;
      if (this.nanos >= rhs.nanos) {
        nanos = this.nanos - rhs.nanos;
      } else if (secs - 1n >= 0n) {
        secs = secs - 1n;
        nanos = this.nanos + NANOS_PER_SEC - rhs.nanos;
      } else {
        return undefined;
      }
      // debug_assert!(nanos < NANOS_PER_SEC);
      return Duration.new(secs, nanos);
    } else {
      return undefined;
    }
  }

  // std: library/core/src/time.rs:847 saturating_sub
  saturating_sub(rhs: Duration): Duration {
    const res = this.checked_sub(rhs);
    return res !== undefined ? res : Duration.ZERO;
  }
}

/** derive(PartialEq) of `Duration`. */
export function Duration_eq(a: Duration, b: Duration): boolean {
  return a.secs === b.secs && a.nanos === b.nanos;
}



/** The unix `Timespec` (library/std/src/sys/pal/unix/time.rs): `tv_sec: i64`, `tv_nsec` in `0..1e9`. */
class Timespec {
  constructor(
    readonly tv_sec: bigint,
    readonly tv_nsec: number,
  ) {}

  /** derive(PartialOrd) (lexicographic). */
  ge(other: Timespec): boolean {
    return this.tv_sec > other.tv_sec || (this.tv_sec === other.tv_sec && this.tv_nsec >= other.tv_nsec);
  }

  // std: library/std/src/sys/pal/unix/time.rs:112 sub_timespec
  sub_timespec(other: Timespec): Result<Duration, Duration> {
    if (this.ge(other)) {
      let secs, nsec;
      if (this.tv_nsec >= other.tv_nsec) {
        secs = this.tv_sec - other.tv_sec;
        nsec = this.tv_nsec - other.tv_nsec;
      } else {
        secs = this.tv_sec - 1n - other.tv_sec;
        nsec = this.tv_nsec + NANOS_PER_SEC - other.tv_nsec;
      }
      return Ok(Duration.new(secs, nsec));
    } else {
      const r = other.sub_timespec(this);
      return r.$ === "Ok" ? Err(r._0) : Ok(r._0);
    }
  }

  // std: library/std/src/sys/pal/unix/time.rs:145 checked_add_duration
  checked_add_duration(other: Duration): Timespec | undefined {
    let secs = this.tv_sec + other.as_secs();
    if (secs > I64_MAX) return undefined;
    // Nano calculations can't overflow because nanos are <1B which fit
    // in a u32.
    let nsec = other.subsec_nanos() + this.tv_nsec;
    if (nsec >= NANOS_PER_SEC) {
      nsec -= NANOS_PER_SEC;
      secs = secs + 1n;
      if (secs > I64_MAX) return undefined;
    }
    return new Timespec(secs, nsec);
  }

  // std: library/std/src/sys/pal/unix/time.rs:158 checked_sub_duration
  checked_sub_duration(other: Duration): Timespec | undefined {
    let secs = this.tv_sec - other.as_secs();
    if (secs < I64_MIN) return undefined;
    // Similar to above, nanos can't overflow.
    let nsec = this.tv_nsec - other.subsec_nanos();
    if (nsec < 0) {
      nsec += NANOS_PER_SEC;
      secs = secs - 1n;
      if (secs < I64_MIN) return undefined;
    }
    return new Timespec(secs, nsec);
  }
}

function timespec_from_nanos(n: bigint): Timespec {
  let secs = n / NANOS_PER_SEC_N;
  let nsec = n % NANOS_PER_SEC_N;
  if (nsec < 0n) {
    nsec += NANOS_PER_SEC_N;
    secs -= 1n;
  }
  return new Timespec(secs, Number(nsec));
}

/// A measurement of a monotonically nondecreasing clock.
export class Instant {
  constructor(readonly t: Timespec) {}

  // std: library/std/src/time.rs:285 now
  static now(): Instant {
    // PORT: host monotonic clock (D14).
    return new Instant(timespec_from_nanos(process.hrtime.bigint()));
  }

  // std: library/std/src/time.rs:314 duration_since
  duration_since(earlier: Instant): Duration {
    return this.checked_duration_since(earlier) ?? Duration.ZERO;
  }

  // std: library/std/src/time.rs:340 checked_duration_since
  checked_duration_since(earlier: Instant): Duration | undefined {
    const r = this.t.sub_timespec(earlier.t);
    return r.$ === "Ok" ? r._0 : undefined;
  }

  // std: library/std/src/time.rs:396 checked_add
  checked_add(duration: Duration): Instant | undefined {
    const t = this.t.checked_add_duration(duration);
    return t === undefined ? undefined : new Instant(t);
  }

  // std: library/std/src/time.rs:404 checked_sub
  checked_sub(duration: Duration): Instant | undefined {
    const t = this.t.checked_sub_duration(duration);
    return t === undefined ? undefined : new Instant(t);
  }
}

/// An error returned from the `duration_since` and `elapsed` methods on
/// `SystemTime`, used to learn how far in the opposite direction a system time
/// lies.
export class SystemTimeError {
  constructor(readonly _0: Duration) {}
}

/// A measurement of the system clock.
export class SystemTime {
  constructor(readonly t: Timespec) {}

  /// An anchor in time which can be used to create new `SystemTime` instances or
  /// learn about where in time a `SystemTime` lies.
  static readonly UNIX_EPOCH: SystemTime = new SystemTime(new Timespec(0n, 0));

  // std: library/std/src/time.rs:601 now
  static now(): SystemTime {
    // PORT: host wall clock (D14), in nanoseconds since the Unix epoch.
    const ms = performance.timeOrigin + performance.now();
    return new SystemTime(timespec_from_nanos(BigInt(Math.floor(ms * 1e6))));
  }

  // std: library/std/src/time.rs:630 duration_since
  duration_since(earlier: SystemTime): Result<Duration, SystemTimeError> {
    const r = this.t.sub_timespec(earlier.t);
    return r.$ === "Ok" ? Ok(r._0) : Err(new SystemTimeError(r._0));
  }

  // std: library/std/src/time.rs:671 checked_add
  checked_add(duration: Duration): SystemTime | undefined {
    const t = this.t.checked_add_duration(duration);
    return t === undefined ? undefined : new SystemTime(t);
  }

  // std: library/std/src/time.rs:682 checked_sub
  checked_sub(duration: Duration): SystemTime | undefined {
    const t = this.t.checked_sub_duration(duration);
    return t === undefined ? undefined : new SystemTime(t);
  }
}
