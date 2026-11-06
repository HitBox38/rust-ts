// scripts/lib/host-state.ts, on fake readers. `scripts/gate-power.test.ts` runs the gate itself on them.
import { describe, expect, test } from "bun:test";
import { HostLog, batteryRefusal, commandOutput, parsePower, parseSwapUsedMb, sampleHost, type HostReaders } from "./host-state.ts";

const AC = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=22872163)\t100%; charged; 0:00 remaining present: true\n";
const BATT = (n: number) => `Now drawing from 'Battery Power'\n -InternalBattery-0 (id=22872163)\t${n}%; discharging; 3:21 remaining present: true\n`;
const DESKTOP = "Now drawing from 'AC Power'\n";

/** Each pmset read takes the next text; the last stays. The clock moves a minute per sample. */
function fake(pmset: (string | undefined)[]): HostReaders {
  let i = 0;
  let t = Date.parse("2026-11-05T12:00:00Z");
  return {
    pmset: async () => pmset[Math.min(i++, pmset.length - 1)],
    swapusage: async () => "total = 2048.00M  used = 512.25M  free = 1535.75M  (encrypted)\n",
    load: () => [1, 2, 3],
    now: () => new Date((t += 60_000)),
  };
}

describe("parsePower", () => {
  test("a laptop on AC, on battery; a desktop; a UPS", () => {
    expect(parsePower(AC)).toEqual({ source: "AC Power", onBattery: false, percent: 100 });
    expect(parsePower(BATT(57))).toEqual({ source: "Battery Power", onBattery: true, percent: 57 });
    expect(parsePower(DESKTOP)).toEqual({ source: "AC Power", onBattery: false, percent: null });
    expect(parsePower("Now drawing from 'UPS Power'\n")?.onBattery).toBe(false);
  });
  test("what it cannot read is no reading", () => {
    expect(parsePower("")).toBeUndefined();
    expect(parsePower("pmset: unknown option\n")).toBeUndefined();
    expect(parsePower("xNow drawing from 'Battery Power'\n")).toBeUndefined();
  });
});

test("parseSwapUsedMb", () => {
  expect(parseSwapUsedMb("total = 2048.00M  used = 1024.00M  free = 1024.00M  (encrypted)")).toBe(1024);
  expect(parseSwapUsedMb("total = 8.00G  used = 2.50G  free = 5.50G")).toBe(2560);
  expect(parseSwapUsedMb("nothing")).toBeUndefined();
});

describe("the refusal", () => {
  test("only on battery, and only without the flag", () => {
    expect(batteryRefusal(parsePower(BATT(57))!, false)).toContain("--allow-battery");
    expect(batteryRefusal(parsePower(BATT(57))!, false)).toContain("at 57%");
    expect(batteryRefusal(parsePower(BATT(57))!, false)).not.toContain("\n");
    expect(batteryRefusal(parsePower(BATT(57))!, true)).toBeUndefined();
    expect(batteryRefusal(parsePower(AC)!, false)).toBeUndefined();
  });
  test("a host with no battery or no pmset: nothing", () => {
    expect(batteryRefusal(parsePower(DESKTOP)!, false)).toBeUndefined();
    expect(batteryRefusal(null, false)).toBeUndefined();
  });
});

describe("a reader that fails", () => {
  test("no pmset on this path, and a command that fails: undefined", async () => {
    expect(await commandOutput(["/nonexistent/pmset", "-g", "batt"])).toBeUndefined();
    expect(await commandOutput(["/usr/bin/false"])).toBeUndefined();
  });
  test("a throwing reader is a null field, not an error", async () => {
    const f: HostReaders = { ...fake([AC]), pmset: () => Promise.reject(new Error("boom")), swapusage: () => Promise.reject(new Error("boom")) };
    const s = await sampleHost(f);
    expect(s.power).toBeNull();
    expect(s.swapUsedMb).toBeNull();
    expect(s.load).toEqual([1, 2, 3]);
  });
});

describe("HostLog", () => {
  const log = (pmset: (string | undefined)[], keepEveryMs = 3_600_000) => {
    const notes: string[] = [];
    return { notes, h: new HostLog(fake(pmset), { pollMs: 1, keepEveryMs, note: (l) => notes.push(l) }) };
  };
  test("power lost and back: one note each, as `note:`, and kept whatever the keep interval", async () => {
    const { h, notes } = log([AC, AC, BATT(90), BATT(88), AC]);
    await h.mark();
    for (let i = 0; i < 4; i++) await h.poll();
    expect(notes.length).toBe(2);
    expect(notes[0]).toStartWith("note: power lost at ");
    expect(notes[0]).toContain("at 90%");
    expect(notes[1]).toStartWith("note: power back at ");
    expect(h.powerLost.map((p) => p.percent)).toEqual([90]);
    expect(h.samples.map((s) => s.power?.onBattery)).toEqual([false, true, false]);
  });
  test("a run that starts on battery has lost nothing; losing it again later has", async () => {
    const { h, notes } = log([BATT(70), BATT(69), AC, BATT(100)]);
    await h.mark();
    await h.poll();
    expect(notes).toEqual([]);
    await h.poll();
    await h.poll();
    expect(h.powerLost.length).toBe(1);
  });
  test("a failed reading says nothing about the source", async () => {
    const { h, notes } = log([AC, undefined, AC, undefined, BATT(50)]);
    await h.mark();
    for (let i = 0; i < 4; i++) await h.poll();
    expect(notes.length).toBe(1);
    expect(h.powerLost.length).toBe(1);
  });
  test("a host with no pmset: samples with no power, and no note", async () => {
    const { h, notes } = log([undefined]);
    await h.mark();
    await h.poll();
    expect(notes).toEqual([]);
    expect(h.samples[0]!.power).toBeNull();
    expect(h.samples[0]!.load).toEqual([1, 2, 3]);
    expect(h.samples[0]!.swapUsedMb).toBe(512.25);
  });
  test("polls are thinned to the keep interval; marks always stay", async () => {
    const { h } = log([AC], 180_000); // the fake clock moves 60 s a sample
    await h.mark();
    for (let i = 0; i < 6; i++) await h.poll();
    expect(h.samples.length).toBe(3);
    await h.mark();
    expect(h.samples.length).toBe(4);
  });
  test("the timer polls, and stop ends it", async () => {
    const { h } = log([AC, BATT(10)]);
    await h.mark();
    h.start();
    while (h.powerLost.length === 0) await Bun.sleep(1);
    h.stop();
    expect(h.powerLost.length).toBe(1);
  });
});
