// scripts/lib/host-state.ts, on fake readers. `scripts/gate-power.test.ts` runs the gate itself on them.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostLog, StuckReads, batteryRefusal, commandOutput, parsePower, parseSwapUsedMb, sampleHost, type HostReaders } from "./host-state.ts";

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
    // The command never ends by itself, so only the kill can end it; the loop ends as soon as it is gone (review harness-w42 N6).
    const until = performance.now() + 30_000;
    while (alive() && performance.now() < until) await Bun.sleep(10);
    expect(alive()).toBe(false);
  }, 60_000);
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

describe("a read stuck past the limit (review root-w40-check F2)", () => {
  /** A reader whose reads end only when the test says; `n` counts the reads started. */
  const held = () => {
    const ends: ((text: string | undefined) => void)[] = [];
    const fails: ((e: Error) => void)[] = [];
    const reader = () =>
      new Promise<string | undefined>((res, rej) => {
        ends.push(res);
        fails.push(rej);
      });
    return { reader, ends, fails };
  };
  const readers = (pmset: () => Promise<string | undefined>): HostReaders => ({ ...fake([AC]), pmset });

  test("not started again while it has not ended, one note, and the other reader goes on; started again once it ends", async () => {
    const notes: string[] = [];
    const stuck = new StuckReads((l) => notes.push(l));
    const h = held();
    const r = readers(h.reader);
    expect((await sampleHost(r, 10, stuck)).power).toBeNull();
    expect(notes.length).toBe(1);
    expect(notes[0]).toStartWith("note: host reader pmset is stuck: ");
    expect(notes[0]).not.toContain("\n");
    // A held-back reader answers at once; one that is not waits out the limit, so the bound is one limit, however slow the host (review harness-w42 N6).
    const LIMIT_MS = 15_000;
    const started = performance.now();
    for (let i = 0; i < 5; i++) {
      const s = await sampleHost(r, LIMIT_MS, stuck);
      expect(s.power).toBeNull();
      expect(s.swapUsedMb).toBe(512.25);
    }
    expect(h.ends.length).toBe(1);
    expect(performance.now() - started).toBeLessThan(LIMIT_MS); // no sample waits out its limit
    h.ends[0]!(AC);
    await Bun.sleep(0);
    await sampleHost(r, 10, stuck);
    expect(h.ends.length).toBe(2); // read again, and past the limit again: still the one note
    expect(notes.length).toBe(1);
  }, 120_000);
  test("a stuck read that ends in a failure also releases it", async () => {
    const stuck = new StuckReads(() => {});
    const h = held();
    await sampleHost(readers(h.reader), 10, stuck);
    h.fails[0]!(new Error("late"));
    await Bun.sleep(0);
    expect(stuck.isStuck("pmset")).toBe(false);
  });
  test("reads within the limit are not held back: a mark overlapping a healthy poll gets its own reading", async () => {
    const notes: string[] = [];
    const stuck = new StuckReads((l) => notes.push(l));
    let n = 0;
    const slow = async () => {
      n++;
      await Bun.sleep(5);
      return AC;
    };
    const both = await Promise.all([sampleHost(readers(slow), 5_000, stuck), sampleHost(readers(slow), 5_000, stuck)]);
    expect(n).toBe(2);
    expect(both.map((s) => s.power?.source)).toEqual(["AC Power", "AC Power"]);
    expect(notes).toEqual([]);
  });
  test("a real command that outlives the limit: one process through many samples, cleaned up by pid", async () => {
    const TMP = mkdtempSync(join(tmpdir(), "rust-ts-host-stuck-"));
    const marker = join(TMP, "pids");
    const pids = () => (existsSync(marker) ? readFileSync(marker, "utf8").split("\n").filter(Boolean).map(Number) : []);
    // Its own limit is past the test's: to this reader it is unkillable, as one stuck in the kernel would be.
    const r = readers(() => commandOutput(["/bin/sh", "-c", `echo $$ >> ${marker}\nexec sleep 60`], 60_000));
    const notes: string[] = [];
    const stuck = new StuckReads((l) => notes.push(l));
    try {
      for (let i = 0; i < 4; i++) await sampleHost(r, 50, stuck);
      // Ends as soon as the pid is there: a wide deadline costs nothing when it passes (review harness-w42 N6).
      const until = performance.now() + 20_000;
      while (pids().length === 0 && performance.now() < until) await Bun.sleep(10);
      await Bun.sleep(20);
      expect(pids().length).toBe(1);
      expect(notes.length).toBe(1);
    } finally {
      for (const pid of pids()) process.kill(pid, "SIGKILL");
      rmSync(TMP, { recursive: true, force: true });
    }
  }, 60_000);
});

test("a process.exit during a read kills the command (review harness-w41 N1)", async () => {
  const TMP = mkdtempSync(join(tmpdir(), "rust-ts-host-exit-"));
  const marker = join(TMP, "pid");
  const script = join(TMP, "gate.ts");
  writeFileSync(
    script,
    `import { readFileSync } from "node:fs";
const { commandOutput } = await import(${JSON.stringify(join(import.meta.dir, "host-state.ts"))});
void commandOutput(["/bin/sh", "-c", "echo $$ > ${marker}\\ntrap '' TERM\\nexec sleep 120"], 120_000);
const written = () => { try { return readFileSync(${JSON.stringify(marker)}, "utf8").endsWith("\\n"); } catch { return false; } };
const until = Date.now() + 30_000;
while (!written()) {
  if (Date.now() > until) process.exit(3);
  await Bun.sleep(5);
}
process.exit(1);
`,
  );
  const r = Bun.spawnSync([process.execPath, script], { stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(1);
  const pid = Number(readFileSync(marker, "utf8"));
  expect(pid).toBeGreaterThan(0);
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    // The command never ends by itself, so only the kill can end it; the loop ends as soon as it is gone (review harness-w42 N6).
    const until = performance.now() + 30_000;
    while (alive() && performance.now() < until) await Bun.sleep(10);
    expect(alive()).toBe(false);
  } finally {
    if (alive()) process.kill(pid, "SIGKILL");
    rmSync(TMP, { recursive: true, force: true });
  }
}, 120_000);

test("a read that ends removes its exit listener: none build up over a gate's samples (review harness-w42 N4)", async () => {
  // By identity, not count: a read an earlier test left running can end, and drop its own listener, during this one.
  const before = new Set(process.listeners("exit"));
  const added = () => process.listeners("exit").filter((l) => !before.has(l));
  for (let i = 0; i < 20; i++) {
    const reading = commandOutput(["/bin/sh", "-c", "exit 0"]);
    // The read has its listener while it runs, so there is one to remove.
    expect(added().length).toBe(1);
    expect(await reading).toBe("");
    await Bun.sleep(0);
    expect(added()).toEqual([]);
  }
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
    return { notes, h: new HostLog(fake(pmset), { pollMs: 1, keepEveryMs, note: (l) => notes.push(l), allowBattery, firstOnBattery: undefined, stuck: new StuckReads(() => {}) }) };
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
      const h = new HostLog(fake([BATT(90), AC]), { pollMs: 1, keepEveryMs: 3_600_000, note: (l) => notes.push(l), allowBattery, firstOnBattery: false, stuck: new StuckReads(() => {}) });
      await h.mark();
      await h.poll();
      expect(notes.length).toBe(2);
      expect(notes[0]).toStartWith("note: power lost at ");
      expect(h.powerLost.map((p) => p.percent)).toEqual([90]);
    }
    const notes: string[] = [];
    const h = new HostLog(fake([AC]), { pollMs: 1, keepEveryMs: 3_600_000, note: (l) => notes.push(l), allowBattery: true, firstOnBattery: true, stuck: new StuckReads(() => {}) });
    await h.mark();
    expect(notes[0]).toStartWith("note: power back at ");
  });
  test("after a failed reading the time is when it was seen: `by`, not `at` (review root-w40-check2 C3)", async () => {
    for (const [pmset, first] of [[[AC, undefined, undefined, BATT(50)], "note: power lost by "], [[AC, undefined, AC, BATT(50)], "note: power lost at "]] as const) {
      const { h, notes } = log([...pmset]);
      await h.mark();
      for (let i = 0; i < 3; i++) await h.poll();
      expect(notes.length).toBe(1);
      expect(notes[0]).toStartWith(first);
    }
    const { h, notes } = log([AC, BATT(50), undefined, AC, BATT(49)]);
    await h.mark();
    for (let i = 0; i < 4; i++) await h.poll();
    expect(notes.map((n) => n.split(" ").slice(0, 4).join(" "))).toEqual(["note: power lost at", "note: power back by", "note: power lost at"]);
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
