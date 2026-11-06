// scripts/lib/host-state.ts, on fake readers. `scripts/gate-power.test.ts` runs the gate itself on them.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("a command that will not end", () => {
  const TMP = mkdtempSync(join(tmpdir(), "rust-ts-host-state-"));
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));
  /**
   * The real readers' shape on `/bin/sh -c body`, with short limits: no reading, soon, from a command seen to start. Not a script
   * file: macOS takes about 600 ms to start a new one, and a command killed before it starts proves nothing. So a shell that did not
   * start in time, as on a loaded host, gets a longer limit: this runs in every gate, and a flake would cost one.
   */
  const sampled = async (name: string, body: string): Promise<number> => {
    const marker = join(TMP, name);
    for (const limit of [200, 1_500]) {
      const read = () => commandOutput(["/bin/sh", "-c", `echo $$ > ${marker}\n${body}`], limit);
      const started = performance.now();
      const s = await sampleHost({ ...fake([AC]), pmset: read, swapusage: async () => undefined }, limit * 2);
      expect(performance.now() - started).toBeLessThan(limit * 2 + 1_600);
      expect(s.power).toBeNull();
      // Empty if the shell was killed between making the file and writing it, which is not having started.
      const pid = existsSync(marker) ? Number(readFileSync(marker, "utf8")) : 0;
      if (pid > 0) return pid;
    }
    throw new Error(`${name}: the shell never started`);
  };
  test("ignores SIGTERM: killed, and the sample goes on", async () => {
    const pid = await sampled("ignores-term", "trap '' TERM\nwhile :; do sleep 1; done");
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const until = performance.now() + 1_500;
    while (alive() && performance.now() < until) await Bun.sleep(10);
    expect(alive()).toBe(false);
  });
  test("killed, and its child holds stdout", async () => {
    await sampled("child-holds", "sleep 2\nexit 0");
  });
  test("exits at once, and a background child holds stdout", async () => {
    await sampled("background-holds", "sleep 2 &\nexit 0");
  });
  test("a reader that never answers", async () => {
    const never = () => new Promise<undefined>(() => {});
    const s = await sampleHost({ ...fake([AC]), pmset: never, swapusage: never }, 20);
    expect(s.power).toBeNull();
    expect(s.load).toEqual([1, 2, 3]);
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
  const log = (pmset: (string | undefined)[], keepEveryMs = 3_600_000, allowBattery = false) => {
    const notes: string[] = [];
    return { notes, h: new HostLog(fake(pmset), { pollMs: 1, keepEveryMs, note: (l) => notes.push(l), allowBattery, firstOnBattery: undefined }) };
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
  test("a run started on battery with the flag has lost nothing; losing it again later has", async () => {
    const { h, notes } = log([BATT(70), BATT(69), AC, BATT(100)], 3_600_000, true);
    await h.mark();
    await h.poll();
    expect(notes).toEqual([]);
    await h.poll();
    await h.poll();
    expect(h.powerLost.length).toBe(1);
  });
  test("without the flag, a first reading on battery is noted, however late it comes", async () => {
    const { h, notes } = log([undefined, undefined, BATT(40), BATT(39)]);
    await h.mark();
    for (let i = 0; i < 3; i++) await h.poll();
    expect(notes.length).toBe(1);
    expect(notes[0]).toStartWith("note: power lost by ");
    expect(h.powerLost.map((p) => p.percent)).toEqual([40]);
  });
  test("the reading taken before the log counts, flag or not", async () => {
    for (const allowBattery of [false, true]) {
      const notes: string[] = [];
      const h = new HostLog(fake([BATT(90), AC]), { pollMs: 1, keepEveryMs: 3_600_000, note: (l) => notes.push(l), allowBattery, firstOnBattery: false });
      await h.mark();
      await h.poll();
      expect(notes.length).toBe(2);
      expect(notes[0]).toStartWith("note: power lost at ");
      expect(h.powerLost.map((p) => p.percent)).toEqual([90]);
    }
    const notes: string[] = [];
    const h = new HostLog(fake([AC]), { pollMs: 1, keepEveryMs: 3_600_000, note: (l) => notes.push(l), allowBattery: true, firstOnBattery: true });
    await h.mark();
    expect(notes[0]).toStartWith("note: power back at ");
  });
  test("a first reading on AC is no news", async () => {
    const { h, notes } = log([undefined, AC, AC]);
    await h.mark();
    await h.poll();
    await h.poll();
    expect(notes).toEqual([]);
    expect(h.powerLost).toEqual([]);
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
