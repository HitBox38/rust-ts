// Host headroom for heavy builds (plan-m8 D20; root's decisions "M8 host capacity", "M8 host headroom", "M8 kept caches"; lane
// harness-m8a-gate). The port's build of cargo took free disk from 11 to 4.5 GiB and compiles of up to 12,450 MiB rss pushed the host
// into swap, so a run that needs that much may start only with D20's minimums free, and `scripts/gate.ts run` checks a suite's
// minimum immediately before that suite starts (`Suite.headroom`). A failed check, or a stop by the watchdog that runs beside such a
// build (`recordWatchdogStop`), stops the gate there: `pass: false` with the reason named, the suites left not run, no case of the
// stopped suite counted as lost, and `accept` refuses the run. A failed check before a report suite (`Suite.neverProtect`) only
// leaves that suite not run.
// **Unlike scripts/lib/host-state.ts, what this reads decides:** a reader that fails is a failed check (fail closed), never a pass.
// No imports beyond node: and host-state.ts (which has none either), so unit tests can load it without scripts/lib/common.ts.
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseSwapUsedMb, type HostReaders } from "./host-state.ts";

/** A row of D20's table: the runs with one minimum. */
export type HeadroomClass = "heavy-build" | "testsuite";

export interface HeadroomMinimum {
  /** Free space on the data volume (`$RUST_TS_DATA`), at least this many GiB. */
  freeGiB: number;
  /** Swap in use, under this many GiB; null: no swap rule. */
  swapUnderGiB: number | null;
  /** D20's "Why", short. */
  why: string;
}

/**
 * D20's table. The minimums stand until `m8-measure` re-derives them (each run's peak disk use + the 4 GiB watchdog floor + a 2 GiB
 * margin), as a recorded decision of its own; they are not lowered before that.
 */
export const HEADROOM_MINIMUMS: Readonly<Record<HeadroomClass, HeadroomMinimum>> = {
  // The port's cargo build by hand, m8-measure, cargo-build, cargo-build-release, cargo-testsuite-port, cargo-testsuite-rustc.
  "heavy-build": { freeGiB: 20, swapUnderGiB: 4, why: "port compiles of up to 12,450 MiB rss; the port's build of cargo took free disk from 11 to 4.5 GiB" },
  // cargo-testsuite: the port compiles nothing; its trees, 0.3 GiB of sandbox per 200 tests, and the 4 GiB floor.
  testsuite: { freeGiB: 10, swapUnderGiB: null, why: "the testsuite trees (4.2 GiB), its sandbox, and the 4 GiB watchdog floor" },
};

/**
 * `kern.memorystatus_vm_pressure_level` at critical: 1 is normal, 2 warn, 4 critical. The watchdog stops a build after 60 s there
 * (D20); a check refuses to start one there, whatever its class (lane harness-m8a-gate's reading of D20: the table names disk and
 * swap, and a host already at critical has no memory headroom for a 12 GiB compile).
 */
export const VM_PRESSURE_CRITICAL = 4;

/** What a check reads. Null: the reader is missing, failed, or printed nothing this reads. */
export interface HeadroomReading {
  at: string;
  /** Bytes free for an unprivileged writer on the volume of the path read. */
  freeBytes: number | null;
  swapUsedMb: number | null;
  vmPressure: number | null;
}

/** `sysctl -n kern.memorystatus_vm_pressure_level`: one integer. */
export function parseVmPressure(text: string): number | undefined {
  const m = /^\s*(\d+)\s*$/.exec(text);
  return m === null ? undefined : Number(m[1]);
}

const READ_LIMIT_MS = 6_000;

/** `read()`, or undefined if it throws or has not answered in `limitMs`. Never throws or hangs. */
async function limited<T>(read: (() => Promise<T | undefined>) | undefined, limitMs: number): Promise<T | undefined> {
  if (read === undefined) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read(), new Promise<undefined>((res) => (timer = setTimeout(() => res(undefined), limitMs)))]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** One reading of free disk at `path` (the data volume), swap and memory pressure. */
export async function readHeadroom(r: HostReaders, path: string, limitMs = READ_LIMIT_MS): Promise<HeadroomReading> {
  const [free, swap, pressure] = await Promise.all([limited(r.freeBytes && (() => r.freeBytes!(path)), limitMs), limited(() => r.swapusage(), limitMs), limited(r.vmPressure, limitMs)]);
  return {
    at: r.now().toISOString(),
    freeBytes: free ?? null,
    swapUsedMb: swap === undefined ? null : (parseSwapUsedMb(swap) ?? null),
    vmPressure: pressure === undefined ? null : (parseVmPressure(pressure) ?? null),
  };
}

const GIB = 2 ** 30;
const gib = (bytes: number): string => (bytes / GIB).toFixed(1);

/**
 * Why a run of class `cls` must not start with this reading, or undefined: one line, no `ERROR:` prefix, naming every rule that fails.
 * A reading a rule needs that is null fails that rule: unknown headroom is not headroom.
 */
export function headroomRefusal(cls: HeadroomClass, h: HeadroomReading): string | undefined {
  const min = HEADROOM_MINIMUMS[cls];
  const bad: string[] = [];
  if (h.freeBytes === null) bad.push("free disk could not be read");
  else if (h.freeBytes < min.freeGiB * GIB) bad.push(`${gib(h.freeBytes)} GiB free on the data volume, under ${min.freeGiB} GiB`);
  if (min.swapUnderGiB !== null) {
    if (h.swapUsedMb === null) bad.push("swap use could not be read");
    else if (h.swapUsedMb >= min.swapUnderGiB * 1024) bad.push(`${(h.swapUsedMb / 1024).toFixed(1)} GiB of swap in use, not under ${min.swapUnderGiB} GiB`);
  }
  if (h.vmPressure === null) bad.push("memory pressure could not be read");
  else if (h.vmPressure >= VM_PRESSURE_CRITICAL) bad.push(`memory pressure is critical (kern.memorystatus_vm_pressure_level ${h.vmPressure})`);
  if (bad.length === 0) return undefined;
  return `host headroom (plan-m8 D20, ${cls}: ${min.freeGiB} GiB free${min.swapUnderGiB === null ? "" : `, swap under ${min.swapUnderGiB} GiB`}, memory pressure not critical): ${bad.join("; ")}`;
}

/** Where watchdogs record their stops: `<RUST_TS_DATA>/watchdog-stops/`, one JSON file per stop. Outside the tree, so a gate can see it. */
export const watchdogStopDir = (data: string): string => join(data, "watchdog-stops");

/** One stop: the watchdog killed the process group of `what` (by its own pid, never `pkill`) at `at`, for `reason`. */
export interface WatchdogStop {
  at: string;
  /** The process group's leader. */
  pid: number;
  /** What it stopped, as the watchdog's caller names it (a suite's case, `m8-measure`, ...). */
  what: string;
  /** Free disk under the floor, or critical memory pressure for 60 s, with the readings. */
  reason: string;
}

/**
 * Records a stop, for `scripts/gate.ts run` to see after the suite (`watchdogStopsSince`). Written whole, then renamed, so a reader never
 * sees half of one. Returns its path. **Contract (review harness-m8a-gate N2):** the record must exist before the process difftest waits on
 * exits, because the gate reads stops right after the suite and a record written after that read is never seen. The project-build
 * harness's watchdog (scripts/lib/watchdog.ts, lane harness-m8a-build) runs inside that process and calls this before it signals the build.
 */
export function recordWatchdogStop(dir: string, stop: WatchdogStop): string {
  mkdirSync(dir, { recursive: true });
  const name = `${stop.at.replace(/[^\dT]/g, "")}-${stop.pid}-${Math.random().toString(36).slice(2, 8)}.json`;
  const tmp = join(dir, `.${name}.tmp`);
  writeFileSync(tmp, JSON.stringify(stop));
  renameSync(tmp, join(dir, name));
  return join(dir, name);
}

/** A stop as `watchdogStopsSince` read it: with the record file it came from, so a stale or wrong one can be found and named. */
export interface WatchdogStopRecord extends WatchdogStop {
  file: string;
}

/**
 * The stops recorded in `dir` at or after `sinceMs` (epoch ms), oldest first, each with its file. Never throws on a record (fail closed:
 * a gate must not run on past a stop it cannot read):
 * - a record that cannot be read, or has no time, is taken at its file's modification time, with a reason that names the file;
 * - a record that disappears between the listing and its read or stat (removed by hand, or by a cleanup) is taken as a stop at
 *   `sinceMs`, its reason saying so (review harness-m8a-gate N5): what it said is unknown, so it is not taken as no stop.
 */
export function watchdogStopsSince(dir: string, sinceMs: number): WatchdogStopRecord[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    // No directory (or it went away before the listing): no watchdog has recorded a stop there.
    return [];
  }
  const out: WatchdogStopRecord[] = [];
  const gone = (file: string, f: string): WatchdogStopRecord => ({ at: new Date(sinceMs).toISOString(), pid: 0, what: f, reason: `the watchdog stop record ${file} disappeared while the gate read it; what it recorded is unknown, so it counts as a stop`, file });
  const isGone = (e: unknown) => (e as { code?: string } | undefined)?.code === "ENOENT";
  for (const f of names) {
    if (!f.endsWith(".json") || f.startsWith(".")) continue;
    const file = join(dir, f);
    let s: Partial<WatchdogStop> | undefined;
    let bad: string | undefined;
    try {
      s = JSON.parse(readFileSync(file, "utf8")) as Partial<WatchdogStop>;
    } catch (e) {
      if (isGone(e)) {
        out.push(gone(file, f));
        continue;
      }
      bad = `an unreadable watchdog stop record ${file}: ${e instanceof Error ? e.message : String(e)}`;
    }
    const at = typeof s?.at === "string" ? Date.parse(s.at) : NaN;
    if (Number.isNaN(at)) {
      let mtime: number;
      try {
        mtime = statSync(file).mtimeMs;
      } catch {
        out.push(gone(file, f));
        continue;
      }
      if (mtime >= sinceMs) out.push({ at: new Date(mtime).toISOString(), pid: typeof s?.pid === "number" ? s.pid : 0, what: typeof s?.what === "string" ? s.what : f, reason: bad ?? `a watchdog stop record with no time (${file}): ${String(s?.reason)}`, file });
      continue;
    }
    if (at >= sinceMs) out.push({ at: s!.at!, pid: typeof s!.pid === "number" ? s!.pid : 0, what: typeof s!.what === "string" ? s!.what : f, reason: typeof s!.reason === "string" ? s!.reason : "(no reason recorded)", file });
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** The gate's record of a stop (gate.json `stop`): where it stopped and why. `accept` refuses any run that has one. */
export interface GateStop {
  suite: string;
  kind: "headroom" | "watchdog";
  reason: string;
}
