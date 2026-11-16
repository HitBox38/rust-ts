// The watchdog beside a heavy build (scripts/lib/watchdog.ts; plan-m8 D20; lane harness-m8a-build), on fake readers and clocks: no real
// build, no real host reading.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WATCHDOG, WATCHDOG_START, startWatchdog, watchdogStep } from "./watchdog.ts";
import { watchdogStopsSince } from "./headroom.ts";
import type { HostReaders } from "./host-state.ts";

const TMP = mkdtempSync(join(tmpdir(), "rust-ts-watchdog-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const GIB = 2 ** 30;

describe("watchdogStep", () => {
  test("D20's numbers: a 5 s poll, the 4 GiB floor, 60 s of critical pressure", () => {
    expect(WATCHDOG).toEqual({ pollMs: 5_000, floorBytes: 4 * GIB, criticalForMs: 60_000, unknownForMs: 60_000 });
  });
  test("free disk under the floor stops at once; at the floor it does not", () => {
    expect(watchdogStep(WATCHDOG_START, { freeBytes: 4 * GIB, vmPressure: 1 }, 0).stop).toBeUndefined();
    const s = watchdogStep(WATCHDOG_START, { freeBytes: 4 * GIB - 1, vmPressure: 1 }, 0);
    expect(s.stop).toBe("watchdog (plan-m8 D20): 4.0 GiB free on the data volume, under the 4.0 GiB floor");
  });
  test("critical pressure stops only after 60 s of it; warn (2) or a dip resets it", () => {
    let st = WATCHDOG_START;
    const at = (ms: number, p: number) => {
      const r = watchdogStep(st, { freeBytes: 100 * GIB, vmPressure: p }, ms);
      st = r.state;
      return r.stop;
    };
    expect(at(0, 4)).toBeUndefined();
    expect(at(55_000, 4)).toBeUndefined();
    expect(at(59_999, 4)).toBeUndefined();
    expect(at(60_000, 4)).toBe("watchdog (plan-m8 D20): memory pressure critical (kern.memorystatus_vm_pressure_level 4) for 60 s");
    st = WATCHDOG_START;
    expect(at(0, 4)).toBeUndefined();
    expect(at(30_000, 2)).toBeUndefined();
    expect(st.criticalSince).toBeNull();
    expect(at(35_000, 4)).toBeUndefined();
    expect(at(90_000, 4)).toBeUndefined();
    expect(at(95_000, 4)).toContain("for 60 s");
  });
  test("an unreadable rule is no stop at first, and a stop after 60 s in a row (fail closed, slowly)", () => {
    let st = WATCHDOG_START;
    const at = (ms: number, free: number | null, p: number | null) => {
      const r = watchdogStep(st, { freeBytes: free, vmPressure: p }, ms);
      st = r.state;
      return r.stop;
    };
    expect(at(0, null, 1)).toBeUndefined();
    expect(at(30_000, 50 * GIB, 1)).toBeUndefined();
    expect(at(35_000, null, null)).toBeUndefined();
    expect(at(94_999, null, null)).toBeUndefined();
    expect(at(95_000, null, null)).toBe("watchdog (plan-m8 D20): free disk unreadable for 60 s; memory pressure unreadable for 60 s");
  });
  test("every reason that holds is named", () => {
    const st = { criticalSince: 0, freeUnknownSince: null, pressureUnknownSince: null };
    expect(watchdogStep(st, { freeBytes: GIB, vmPressure: 4 }, 61_000).stop).toBe(
      "watchdog (plan-m8 D20): 1.0 GiB free on the data volume, under the 4.0 GiB floor; memory pressure critical (kern.memorystatus_vm_pressure_level 4) for 61 s",
    );
  });
});

/** Fake readers: free bytes and pressure from the arrays, one per poll (the last repeats), a clock that moves `stepMs` per reading. */
function fakeReaders(free: (number | null)[], pressure: (string | null)[], stepMs: number): { readers: Pick<HostReaders, "freeBytes" | "vmPressure" | "swapusage" | "now">; polls: () => number } {
  let i = 0;
  let t = Date.parse("2026-11-16T03:00:00Z");
  return {
    readers: {
      freeBytes: async () => {
        const v = free[Math.min(i, free.length - 1)];
        i++;
        t += stepMs;
        return v ?? undefined;
      },
      vmPressure: async () => pressure[Math.min(i - 1, pressure.length - 1)] ?? undefined,
      swapusage: async () => "total = 1024.00M  used = 0.00M  free = 1024.00M",
      now: () => new Date(t),
    },
    polls: () => i,
  };
}

describe("startWatchdog", () => {
  test("at the floor it writes the stop record first, then kills the group once, and stops polling (review harness-m8a-gate N2)", async () => {
    const dir = join(TMP, "stops-floor");
    const f = fakeReaders([50 * GIB, 10 * GIB, 3 * GIB, 50 * GIB], ["1\n"], 5_000);
    const kills: { pgid: number; recordsAtKill: number }[] = [];
    const startMs = f.readers.now().getTime();
    const wd = startWatchdog({ readers: f.readers, path: TMP, pgid: 4242, what: "cargo-build subject", stopDir: dir, limits: { pollMs: 1 }, kill: (pgid) => kills.push({ pgid, recordsAtKill: existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")).length : 0 }) });
    await wd.done;
    expect(kills).toEqual([{ pgid: 4242, recordsAtKill: 1 }]);
    expect(f.polls()).toBe(3);
    expect(wd.stopped?.reason).toBe("watchdog (plan-m8 D20): 3.0 GiB free on the data volume, under the 4.0 GiB floor");
    // The gate's reader sees it, with its file.
    const seen = watchdogStopsSince(dir, startMs);
    expect(seen.map((s) => [s.pid, s.what, s.reason, s.file])).toEqual([[4242, "cargo-build subject", wd.stopped!.reason, wd.stopped!.file]]);
    expect(JSON.parse(readFileSync(wd.stopped!.file, "utf8")).at).toBe(wd.stopped!.at);
  });
  test("critical pressure for 60 s of polls stops it; normal pressure and room never do, and end() ends the polling", async () => {
    const dir = join(TMP, "stops-pressure");
    const f = fakeReaders([50 * GIB], ["4"], 5_000);
    const kills: number[] = [];
    const wd = startWatchdog({ readers: f.readers, path: TMP, pgid: 7, what: "x", stopDir: dir, limits: { pollMs: 1 }, kill: (p) => kills.push(p) });
    await wd.done;
    // Readings at +5 s, +10 s, ...: the first critical one starts the 60 s, the 13th is 60 s after it.
    expect(f.polls()).toBe(13);
    expect(kills).toEqual([7]);
    expect(wd.stopped?.reason).toContain("memory pressure critical");
    const quiet = join(TMP, "stops-quiet");
    const g = fakeReaders([50 * GIB], ["1"], 5_000);
    const calm = startWatchdog({ readers: g.readers, path: TMP, pgid: 8, what: "y", stopDir: quiet, limits: { pollMs: 1 }, kill: () => kills.push(8) });
    while (g.polls() < 20) await Bun.sleep(1);
    calm.end();
    await calm.done;
    expect(calm.stopped).toBeUndefined();
    expect(kills).toEqual([7]);
    expect(existsSync(quiet)).toBe(false);
  });
  test("readers that throw or never answer are unreadable, not a crash: the stop comes after 60 s of them", async () => {
    const dir = join(TMP, "stops-unreadable");
    let t = 0;
    const readers = {
      freeBytes: async () => {
        t += 5_000;
        throw new Error("statfs failed");
      },
      vmPressure: () => new Promise<string | undefined>(() => {}),
      swapusage: async () => undefined,
      now: () => new Date(t),
    };
    const kills: number[] = [];
    const wd = startWatchdog({ readers, path: TMP, pgid: 9, what: "z", stopDir: dir, limits: { pollMs: 1 }, readLimitMs: 2, kill: (p) => kills.push(p) });
    await wd.done;
    expect(kills).toEqual([9]);
    expect(wd.stopped?.reason).toBe("watchdog (plan-m8 D20): free disk unreadable for 60 s; memory pressure unreadable for 60 s");
  });
});
