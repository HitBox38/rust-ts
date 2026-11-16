// The watchdog beside a heavy build (plan-m8 D20; lane harness-m8a-build): it polls every 5 s and stops the build's process group when
// free disk on the data volume falls under the 4 GiB floor, or memory pressure (`kern.memorystatus_vm_pressure_level`) has been critical
// for 60 s. It runs **inside** the process that runs the build (scripts/cargo-project-build.ts), and records its stop through
// lib/headroom.ts `recordWatchdogStop` **before** it signals the group, so the record exists before the build process, and so the
// process difftest waits on, exits: the gate reads stops right after the suite, and a record written after that read is never seen
// (review harness-m8a-gate N2).
//
// A reading it cannot take is not a reason to kill a build at once: a `sysctl` that hangs one poll is not a full disk. But a rule it
// cannot read for 60 s in a row is a stop (fail closed, as lib/headroom.ts is for a start): a watchdog that sees nothing protects nothing.
// No imports beyond node: and lib/headroom.ts / lib/host-state.ts (which have none), so unit tests load it without scripts/lib/common.ts.
import { readHeadroom, recordWatchdogStop, VM_PRESSURE_CRITICAL, type HeadroomReading, type WatchdogStop } from "./headroom.ts";
import type { HostReaders } from "./host-state.ts";

const GIB = 2 ** 30;

/** D20's numbers. */
export const WATCHDOG = {
  pollMs: 5_000,
  /** Free bytes on the data volume under which the build is stopped at once. */
  floorBytes: 4 * GIB,
  /** How long memory pressure must stay critical before the build is stopped. */
  criticalForMs: 60_000,
  /** How long a rule may go unread before that alone stops the build (see the header). */
  unknownForMs: 60_000,
} as const;

export type WatchdogLimits = { -readonly [K in keyof typeof WATCHDOG]: number };

/** Since when each condition has held, in epoch ms (null: it does not hold now). */
export interface WatchdogState {
  criticalSince: number | null;
  freeUnknownSince: number | null;
  pressureUnknownSince: number | null;
}

export const WATCHDOG_START: WatchdogState = { criticalSince: null, freeUnknownSince: null, pressureUnknownSince: null };

const gib = (b: number): string => (b / GIB).toFixed(1);

/**
 * One poll: the next state, and why the build must stop now, if it must. Pure, so tests drive it with fake readings and times.
 * Free disk under the floor stops at once; critical pressure or an unreadable rule only once it has lasted its limit.
 */
export function watchdogStep(state: WatchdogState, r: Pick<HeadroomReading, "freeBytes" | "vmPressure">, nowMs: number, lim: WatchdogLimits = WATCHDOG): { state: WatchdogState; stop?: string } {
  const since = (held: boolean, prev: number | null): number | null => (held ? (prev ?? nowMs) : null);
  const next: WatchdogState = {
    criticalSince: since(r.vmPressure !== null && r.vmPressure >= VM_PRESSURE_CRITICAL, state.criticalSince),
    freeUnknownSince: since(r.freeBytes === null, state.freeUnknownSince),
    pressureUnknownSince: since(r.vmPressure === null, state.pressureUnknownSince),
  };
  const why: string[] = [];
  if (r.freeBytes !== null && r.freeBytes < lim.floorBytes) why.push(`${gib(r.freeBytes)} GiB free on the data volume, under the ${gib(lim.floorBytes)} GiB floor`);
  if (next.criticalSince !== null && nowMs - next.criticalSince >= lim.criticalForMs) why.push(`memory pressure critical (kern.memorystatus_vm_pressure_level ${r.vmPressure}) for ${Math.round((nowMs - next.criticalSince) / 1000)} s`);
  if (next.freeUnknownSince !== null && nowMs - next.freeUnknownSince >= lim.unknownForMs) why.push(`free disk unreadable for ${Math.round((nowMs - next.freeUnknownSince) / 1000)} s`);
  if (next.pressureUnknownSince !== null && nowMs - next.pressureUnknownSince >= lim.unknownForMs) why.push(`memory pressure unreadable for ${Math.round((nowMs - next.pressureUnknownSince) / 1000)} s`);
  return why.length ? { state: next, stop: `watchdog (plan-m8 D20): ${why.join("; ")}` } : { state: next };
}

export interface WatchdogOptions {
  readers: Pick<HostReaders, "freeBytes" | "vmPressure" | "swapusage" | "now">;
  /** A path on the data volume (`$RUST_TS_DATA`). */
  path: string;
  /** The build's process group (its leader's pid). */
  pgid: number;
  /** What it watches, for the record (`cargo-build subject`, ...). */
  what: string;
  /** Where stops are recorded (lib/headroom.ts `watchdogStopDir`). */
  stopDir: string;
  /** Stops the build: called once, after the record is written. */
  kill(pgid: number): void;
  limits?: Partial<WatchdogLimits>;
  /** How long one reading may take (lib/headroom.ts `readHeadroom`). */
  readLimitMs?: number;
}

export interface Watchdog {
  /** The stop it made, with the record's path, once it has made one. */
  readonly stopped: (WatchdogStop & { file: string }) | undefined;
  /** Ends the polling (the build ended); a poll in flight finishes without acting. */
  end(): void;
  /** Settles when the polling has ended (by `end`, or after a stop). */
  readonly done: Promise<void>;
}

/** Starts polling now (the first reading at once) until `end()` or a stop. */
export function startWatchdog(o: WatchdogOptions): Watchdog {
  const lim: WatchdogLimits = { ...WATCHDOG, ...o.limits };
  let state = WATCHDOG_START;
  let ended = false;
  let stopped: (WatchdogStop & { file: string }) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  const done = (async () => {
    while (!ended) {
      const reading = await readHeadroom({ ...o.readers, pmset: async () => undefined, load: () => [] }, o.path, o.readLimitMs);
      if (ended) break;
      const step = watchdogStep(state, reading, o.readers.now().getTime(), lim);
      state = step.state;
      if (step.stop !== undefined) {
        const stop: WatchdogStop = { at: o.readers.now().toISOString(), pid: o.pgid, what: o.what, reason: step.stop };
        // The record first, then the signal (see the header).
        const file = recordWatchdogStop(o.stopDir, stop);
        stopped = { ...stop, file };
        o.kill(o.pgid);
        break;
      }
      await new Promise<void>((res) => {
        wake = res;
        timer = setTimeout(res, lim.pollMs);
      });
    }
  })();
  return {
    get stopped() {
      return stopped;
    },
    end() {
      ended = true;
      if (timer !== undefined) clearTimeout(timer);
      wake?.();
    },
    done,
  };
}
