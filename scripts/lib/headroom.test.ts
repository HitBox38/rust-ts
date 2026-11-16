// scripts/lib/headroom.ts (plan-m8 D20, lane harness-m8a-gate), on fake host readers: no real heavy run. scripts/gate-headroom.test.ts
// runs the gate itself on them.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostReaders } from "./host-state.ts";
import { HEADROOM_MINIMUMS, VM_PRESSURE_CRITICAL, headroomRefusal, parseVmPressure, readHeadroom, recordWatchdogStop, watchdogStopDir, watchdogStopsSince, type HeadroomReading } from "./headroom.ts";

const TMP = mkdtempSync(join(tmpdir(), "rust-ts-headroom-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const GIB = 2 ** 30;
const reading = (freeGiB: number | null, swapGiB: number | null, pressure: number | null): HeadroomReading => ({ at: "2026-11-16T00:00:00.000Z", freeBytes: freeGiB === null ? null : freeGiB * GIB, swapUsedMb: swapGiB === null ? null : swapGiB * 1024, vmPressure: pressure });

/** Fake readers: free disk, swap text and pressure text as given (undefined: the reader fails; "absent": it is not there). */
function fake(free: number | undefined | "absent" | "throws" | "hangs", swap: string | undefined, pressure: string | undefined | "absent"): HostReaders {
  return {
    pmset: async () => undefined,
    swapusage: async () => swap,
    load: () => [0, 0, 0],
    now: () => new Date("2026-11-16T00:00:00Z"),
    ...(free === "absent" ? {} : { freeBytes: async () => (free === "throws" ? Promise.reject(new Error("no statfs")) : free === "hangs" ? new Promise<number>(() => {}) : free) }),
    ...(pressure === "absent" ? {} : { vmPressure: async () => pressure }),
  };
}

test("D20's table, as the plan has it (the minimums stand until m8-measure re-derives them)", () => {
  expect(HEADROOM_MINIMUMS["heavy-build"].freeGiB).toBe(20);
  expect(HEADROOM_MINIMUMS["heavy-build"].swapUnderGiB).toBe(4);
  expect(HEADROOM_MINIMUMS.testsuite.freeGiB).toBe(10);
  expect(HEADROOM_MINIMUMS.testsuite.swapUnderGiB).toBeNull();
  expect(VM_PRESSURE_CRITICAL).toBe(4);
});

describe("headroomRefusal", () => {
  test("enough of everything: none", () => {
    expect(headroomRefusal("heavy-build", reading(20, 3.9, 1))).toBeUndefined();
    expect(headroomRefusal("heavy-build", reading(21.8, 0, 2))).toBeUndefined();
    expect(headroomRefusal("testsuite", reading(10, 9, 2))).toBeUndefined();
  });
  test("each rule fails on its own, at its edge, and names the numbers", () => {
    expect(headroomRefusal("heavy-build", reading(19.9, 0, 1))).toContain("19.9 GiB free on the data volume, under 20 GiB");
    expect(headroomRefusal("heavy-build", reading(30, 4, 1))).toContain("4.0 GiB of swap in use, not under 4 GiB");
    expect(headroomRefusal("heavy-build", reading(30, 0, 4))).toContain("memory pressure is critical");
    expect(headroomRefusal("testsuite", reading(9.5, 0, 1))).toContain("9.5 GiB free on the data volume, under 10 GiB");
  });
  test("the testsuite has no swap rule", () => {
    expect(headroomRefusal("testsuite", reading(12, 10, 1))).toBeUndefined();
    expect(headroomRefusal("testsuite", reading(12, null, 1))).toBeUndefined();
  });
  test("every failing rule in one line; today's host (12 GiB free, 8.2 GiB swap) fails heavy-build on both", () => {
    const r = headroomRefusal("heavy-build", reading(12, 8.2, 1))!;
    expect(r).toContain("12.0 GiB free");
    expect(r).toContain("8.2 GiB of swap");
    expect(r).toContain("plan-m8 D20, heavy-build");
    expect(r.includes("\n")).toBe(false);
  });
  test("unknown is not enough: a reading a rule needs that is missing fails it", () => {
    expect(headroomRefusal("heavy-build", reading(null, 0, 1))).toContain("free disk could not be read");
    expect(headroomRefusal("heavy-build", reading(30, null, 1))).toContain("swap use could not be read");
    expect(headroomRefusal("testsuite", reading(30, 0, null))).toContain("memory pressure could not be read");
  });
});

describe("readHeadroom on fake readers", () => {
  const SWAP = "total = 9216.00M  used = 1024.00M  free = 8192.00M  (encrypted)";
  test("reads all three", async () => {
    const h = await readHeadroom(fake(25 * GIB, SWAP, "1\n"), "/data");
    expect(h).toEqual({ at: "2026-11-16T00:00:00.000Z", freeBytes: 25 * GIB, swapUsedMb: 1024, vmPressure: 1 });
    expect(headroomRefusal("heavy-build", h)).toBeUndefined();
  });
  test("a reader that is absent, fails, throws or never answers gives null, never an error, and so a failed check", async () => {
    for (const free of ["absent", undefined, "throws", "hangs"] as const) {
      const h = await readHeadroom(fake(free, SWAP, "1"), "/data", 50);
      expect(h.freeBytes).toBeNull();
      expect(headroomRefusal("testsuite", h)).toContain("free disk could not be read");
    }
    const h = await readHeadroom(fake(25 * GIB, undefined, "absent"), "/data");
    expect(h.swapUsedMb).toBeNull();
    expect(h.vmPressure).toBeNull();
  });
  test("parseVmPressure", () => {
    expect(parseVmPressure("4\n")).toBe(4);
    expect(parseVmPressure(" 1 ")).toBe(1);
    expect(parseVmPressure("")).toBeUndefined();
    expect(parseVmPressure("sysctl: unknown oid")).toBeUndefined();
  });
});

describe("watchdog stop records", () => {
  test("recorded whole; read back since a time, oldest first; earlier ones are not this suite's", () => {
    const dir = watchdogStopDir(join(TMP, "a"));
    expect(dir).toBe(join(TMP, "a", "watchdog-stops"));
    expect(watchdogStopsSince(dir, 0)).toEqual([]);
    recordWatchdogStop(dir, { at: "2026-11-16T01:00:00.000Z", pid: 11, what: "old", reason: "free disk 3.9 GiB" });
    recordWatchdogStop(dir, { at: "2026-11-16T02:00:05.000Z", pid: 13, what: "later", reason: "pressure critical for 60 s" });
    recordWatchdogStop(dir, { at: "2026-11-16T02:00:00.000Z", pid: 12, what: "cargo-build", reason: "free disk 3.5 GiB" });
    const since = watchdogStopsSince(dir, Date.parse("2026-11-16T02:00:00.000Z"));
    expect(since.map((s) => [s.what, s.pid])).toEqual([["cargo-build", 12], ["later", 13]]);
    expect(watchdogStopsSince(dir, Date.parse("2026-11-16T03:00:00.000Z"))).toEqual([]);
  });
  test("a record that cannot be read counts as a stop at its file's time: a gate never runs on past it", () => {
    const dir = join(TMP, "b");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "broken.json"), "{ not json");
    writeFileSync(join(dir, "notime.json"), JSON.stringify({ pid: 3, reason: "x" }));
    writeFileSync(join(dir, ".half.json.tmp"), "{");
    const got = watchdogStopsSince(dir, Date.now() - 60_000);
    expect(got.length).toBe(2);
    expect(got.some((s) => s.reason.startsWith("an unreadable watchdog stop record"))).toBe(true);
    expect(got.some((s) => s.reason.startsWith("a watchdog stop record with no time"))).toBe(true);
    // An old one, by its file's time, is not.
    for (const f of ["broken.json", "notime.json"]) utimesSync(join(dir, f), new Date("2020-01-01"), new Date("2020-01-01"));
    expect(watchdogStopsSince(dir, Date.parse("2021-01-01"))).toEqual([]);
  });
});
