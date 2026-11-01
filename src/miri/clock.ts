// Fill lane: `miri-eval` (plan-m6 wave 36): ported by this lane.
// Port of src/tools/miri/src/clock.rs (crate `miri`, plan-m6 D2; lane miri-eval, wave 36). Its types are generated into
// clock.gen.ts (tools/codegen set `miri`); this module re-exports them and adds the methods.
//
// PORT:
// - `std::time::{Duration, Instant, SystemTime}` are the src/std/time.ts stand-ins (plan-m6 D14); the generated fields are
//   typed with them (typemap, lane miri-wire).
// - (decision miri-contract C5 amendment, lane interp-miri-reconcile) the virtual clock's `Cell<u128>` counter
//   (`MonotonicClockKind::Virtual.nanoseconds`, typemap `fields`) is a `number`. It is ticked per basic block
//   (`NANOSECONDS_PER_BASIC_BLOCK`), but `MonotonicClock::sleep` (called from scheduler.rs:214) adds program-supplied
//   timeouts, so a run that sleeps ~104 virtual days passes 2^53 and still ends normally upstream: `sleep` stops with
//   `unported` past `Number.MAX_SAFE_INTEGER` (never rounding; recorded decision "Virtual clock counter"). `tick` adds
//   5000 per basic block and cannot reach 2^53 (1.8e12 basic blocks) before `sleep` does. `InstantKind::Virtual.
//   nanoseconds` stays a `bigint` (an `Instant` adds program-supplied `Duration`s, `saturating_add`): `BigInt(n)` where
//   an `Instant` is made from the clock.
import * as gen from "./clock.gen.ts";
import { Instant, MonotonicClock, type MonotonicClockKind, type TimeoutClock, type TimeoutStyle } from "./clock.gen.ts";
import { MiriMachine } from "./machine.ts";
import { port_methods } from "../rust_ts/miri_stub.ts";
import { assert, panic, unported } from "../std/panic.ts";
import { Duration, Instant as StdInstant, SystemTime } from "../std/time.ts";
export * from "./clock.gen.ts";

/// When using a virtual clock, this defines how many nanoseconds we pretend are passing for each
/// basic block.
/// This number is pretty random, but it has been shown to approximately cause
/// some sample programs to run within an order of magnitude of real time on desktop CPUs.
/// (See `tests/pass/shims/time-with-isolation*.rs`.)
const NANOSECONDS_PER_BASIC_BLOCK = 5000;

const U128_MAX = (1n << 128n) - 1n;

declare module "./clock.gen.ts" {
  interface Instant {
    // clock.rs:27
    add_lossy(duration: Duration): Instant;
    // clock.rs:43
    duration_since(earlier: Instant): Duration;
  }
}
declare module "./clock.gen.ts" {
  interface MonotonicClock {
    // clock.rs:91
    tick(): void;
    // clock.rs:103
    sleep(duration: Duration): void;
    // clock.rs:118
    epoch(): Instant;
    // clock.rs:126
    now(): Instant;
  }
  namespace MonotonicClock {
    // clock.rs:80
    function new_(communicate: boolean): MonotonicClock;
    export { new_ as new };
  }
}
declare module "./machine.gen.ts" {
  interface MiriMachine {
    // clock.rs:186
    timeout(clock: TimeoutClock, style: TimeoutStyle, duration: Duration): gen.Deadline;
  }
}

/// Will try to add `duration`, but if that overflows it may add less.
// rustc: src/tools/miri/src/clock.rs:27 add_lossy
Instant.prototype.add_lossy = function (this: Instant, duration: Duration): Instant {
  const kind = this.kind;
  switch (kind.$) {
    case "Host": {
      const instant = kind._0;
      // If this overflows, try adding just 1h and assume that will not overflow.
      let i = instant.checked_add(duration);
      if (i === undefined) {
        i = instant.checked_add(Duration.from_secs(3600n));
        if (i === undefined) panic("called `Option::unwrap()` on a `None` value");
      }
      return new Instant({ $: "Host", _0: i });
    }
    case "Virtual": {
      const nanoseconds = kind.nanoseconds;
      // u128::saturating_add
      let n = nanoseconds + duration.as_nanos();
      if (n > U128_MAX) n = U128_MAX;
      return new Instant({ $: "Virtual", nanoseconds: n });
    }
  }
};

// rustc: src/tools/miri/src/clock.rs:43 duration_since
Instant.prototype.duration_since = function (this: Instant, earlier: Instant): Duration {
  const a = this.kind;
  const b = earlier.kind;
  if (a.$ === "Host" && b.$ === "Host") {
    return a._0.duration_since(b._0);
  } else if (a.$ === "Virtual" && b.$ === "Virtual") {
    const nanoseconds = a.nanoseconds;
    const earlier_ = b.nanoseconds;
    // u128::saturating_sub
    const duration = nanoseconds > earlier_ ? nanoseconds - earlier_ : 0n;
    return Duration.from_nanos_u128(duration);
  } else {
    return panic("all `Instant` must be of the same kind");
  }
};

/// Create a new clock based on the availability of communication with the host.
// rustc: src/tools/miri/src/clock.rs:80 new
(MonotonicClock as unknown as { new: (communicate: boolean) => MonotonicClock }).new = function (
  communicate: boolean,
): MonotonicClock {
  let kind: MonotonicClockKind;
  if (communicate) {
    kind = { $: "Host", epoch: StdInstant.now() };
  } else {
    kind = { $: "Virtual", nanoseconds: 0 };
  }

  return new MonotonicClock(kind);
};

/// Let the time pass for a small interval.
// rustc: src/tools/miri/src/clock.rs:91 tick
MonotonicClock.prototype.tick = function (this: MonotonicClock): void {
  const kind = this.kind;
  switch (kind.$) {
    case "Host": {
      // Time will pass without us doing anything.
      break;
    }
    case "Virtual": {
      kind.nanoseconds = kind.nanoseconds + NANOSECONDS_PER_BASIC_BLOCK;
      break;
    }
  }
};

/// Sleep for the desired duration.
// rustc: src/tools/miri/src/clock.rs:103 sleep
MonotonicClock.prototype.sleep = function (this: MonotonicClock, duration: Duration): void {
  const kind = this.kind;
  switch (kind.$) {
    case "Host":
      // PORT: `std::thread::sleep(duration)` (isolation off, D14): a synchronous host sleep.
      Bun.sleepSync(Number(duration.as_nanos() / 1_000_000n));
      break;
    case "Virtual": {
      // Just pretend that we have slept for some time.
      const nanos: bigint = duration.as_nanos();
      const x = BigInt(kind.nanoseconds) + nanos;
      if (x > U128_MAX) panic("Miri's virtual clock cannot represent an execution this long");
      // PORT: the counter is a number (module header): past 2^53 stop rather than round.
      if (x > BigInt(Number.MAX_SAFE_INTEGER)) {
        unported("miri::clock::MonotonicClock::sleep (virtual clock past 2^53 ns; decision C5 amendment)");
      }
      kind.nanoseconds = Number(x);
      break;
    }
  }
};

/// Return the `epoch` instant (time = 0), to convert between monotone instants and absolute durations.
// rustc: src/tools/miri/src/clock.rs:118 epoch
MonotonicClock.prototype.epoch = function (this: MonotonicClock): Instant {
  const kind = this.kind;
  switch (kind.$) {
    case "Host":
      return new Instant({ $: "Host", _0: kind.epoch });
    case "Virtual":
      return new Instant({ $: "Virtual", nanoseconds: 0n });
  }
};

// rustc: src/tools/miri/src/clock.rs:126 now
MonotonicClock.prototype.now = function (this: MonotonicClock): Instant {
  const kind = this.kind;
  switch (kind.$) {
    case "Host":
      return new Instant({ $: "Host", _0: StdInstant.now() });
    case "Virtual":
      return new Instant({ $: "Virtual", nanoseconds: BigInt(kind.nanoseconds) });
  }
};

/// A deadline for some event to occur.
export type Deadline = gen.Deadline;
export interface Deadline_methods {
  /** `impl From<Instant> for Deadline` */
  from(value: Instant): Deadline;
  add_lossy(self: Deadline, duration: Duration): Deadline;
}
export const Deadline: Deadline_methods = {
  // rustc: src/tools/miri/src/clock.rs:144 from
  from(value: Instant): Deadline {
    return { $: "Monotonic", _0: value };
  },

  /// Will try to add `duration`, but if that overflows it may add less.
  // rustc: src/tools/miri/src/clock.rs:151 add_lossy
  add_lossy(self: Deadline, duration: Duration): Deadline {
    switch (self.$) {
      case "Monotonic":
        return { $: "Monotonic", _0: self._0.add_lossy(duration) };
      case "RealTime": {
        const s = self._0;
        // If this overflows, try adding just 1h and assume that will not overflow.
        let t = s.checked_add(duration);
        if (t === undefined) {
          t = s.checked_add(Duration.from_secs(3600n));
          if (t === undefined) panic("called `Option::unwrap()` on a `None` value");
        }
        return { $: "RealTime", _0: t };
      }
    }
  },
};

/// Computes the deadline for a given timeout configuration and duration.
// rustc: src/tools/miri/src/clock.rs:186 timeout
port_methods("miri::clock::MiriMachine", () => MiriMachine.prototype, {
  // Registered, not assigned at load: MiriMachine is in an import cycle with this module (decision: port_methods, C10).
  timeout: function (
  this: MiriMachine,
  clock: TimeoutClock,
  style: TimeoutStyle,
  duration: Duration,
): Deadline {
  // First let's figure out what "zero" means for the given clock and style.
  let zero: Deadline;
  switch (clock) {
    case "RealTime": {
      assert(this.communicate(), "cannot have `RealTime` timeout with isolation");
      let t: SystemTime;
      switch (style) {
        case "Absolute":
          t = SystemTime.UNIX_EPOCH;
          break;
        case "Relative":
          t = SystemTime.now();
          break;
      }
      zero = { $: "RealTime", _0: t };
      break;
    }
    case "Monotonic": {
      let i: Instant;
      switch (style) {
        case "Absolute":
          i = this.monotonic_clock.epoch();
          break;
        case "Relative":
          i = this.monotonic_clock.now();
          break;
      }
      zero = { $: "Monotonic", _0: i };
      break;
    }
  }
  // Then add the given duration relative to that "zero".
  return Deadline.add_lossy(zero, duration);
  },
});
