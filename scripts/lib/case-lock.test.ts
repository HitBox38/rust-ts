// scripts/lib/case-lock.ts, with real processes for mutual exclusion and a dead owner.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addLockHolder, isStaleLock, releaseHeldLocks, withCaseLock } from "./case-lock.ts";

const inTemp = async (f: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), "rust-ts-case-lock-"));
  try {
    await f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("processes on one lock never overlap, and each one runs", async () => {
  await inTemp(async (dir) => {
    const child = `
const { withCaseLock } = await import(${JSON.stringify(join(import.meta.dir, "case-lock.ts"))});
const { appendFileSync, existsSync, readdirSync, rmSync, writeFileSync } = await import("node:fs");
const [busy, log, lock, ready] = ${JSON.stringify(["busy", "log", "lock", "ready"].map((f) => join(dir, f)))};
// All of them reach the lock together, however slowly the host starts them.
writeFileSync(ready + process.pid, "");
while (readdirSync(${JSON.stringify(dir)}).filter((n) => n.startsWith("ready")).length < 4) await Bun.sleep(5);
await withCaseLock(lock, 600000, async () => {
  if (existsSync(busy)) appendFileSync(log, "OVERLAP\\n");
  writeFileSync(busy, "");
  await Bun.sleep(100);
  rmSync(busy, { force: true });
  appendFileSync(log, "ran\\n");
}, () => {}, 10);
`;
    const ps = [0, 1, 2, 3].map(() => Bun.spawn([process.execPath, "-e", child], { stderr: "pipe" }));
    expect(await Promise.all(ps.map((p) => p.exited))).toEqual([0, 0, 0, 0]);
    expect(readFileSync(join(dir, "log"), "utf8")).toBe("ran\n".repeat(4));
    expect(readdirSync(dir).filter((n) => !n.startsWith("ready"))).toEqual(["log"]);
  });
}, 300_000);

test("a dead owner's lock is taken over without a wait", async () => {
  await inTemp(async (dir) => {
    const dead = Bun.spawnSync([process.execPath, "-e", ""]).pid;
    const lock = join(dir, "lock");
    writeFileSync(lock, `${dead}\n`);
    const notes: string[] = [];
    expect(await withCaseLock(lock, 600_000, async () => readFileSync(lock, "utf8"), (l) => notes.push(l), 10)).toBe(`${process.pid}\n`);
    expect(notes).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });
}, 60_000);

test("a live owner is waited for, with one note; past the limit its lock is taken over", async () => {
  await inTemp(async (dir) => {
    const lock = join(dir, "lock");
    writeFileSync(lock, `${process.ppid}\n`);
    const notes: string[] = [];
    let ran = false;
    const waiting = withCaseLock(lock, 600_000, async () => void (ran = true), (l) => notes.push(l), 10);
    await Bun.sleep(100);
    expect(ran).toBe(false);
    expect(notes.length).toBe(1);
    expect(notes[0]).toContain(`waiting for pid ${process.ppid} to release ${lock}`);
    rmSync(lock);
    await waiting;
    expect(ran).toBe(true);

    writeFileSync(lock, `${process.ppid}\n`);
    utimesSync(lock, new Date(0), new Date(0));
    await withCaseLock(lock, 600_000, async () => void 0, () => {}, 10);
    expect(existsSync(lock)).toBe(false);
  });
}, 60_000);

test("the lock is released when fn throws, and a lock that was taken over stays with its new owner", async () => {
  await inTemp(async (dir) => {
    const lock = join(dir, "lock");
    await expect(withCaseLock(lock, 600_000, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(existsSync(lock)).toBe(false);
    await withCaseLock(lock, 600_000, async () => writeFileSync(lock, "1\n"));
    expect(readFileSync(lock, "utf8")).toBe("1\n");
  });
}, 60_000);

test("a lock nobody can hold is stale: from before this boot, naming this process, empty for too long (review harness-w39 N1)", () => {
  const HOUR = 3_600_000;
  const liveOther = 4242;
  const alive = (pid: number) => pid === liveOther;
  const stale = (pid: number | undefined, age: number) => isStaleLock(pid, age, 3 * HOUR, 2 * HOUR, 1000, alive);
  // A live owner during this boot: it may really hold it.
  expect(stale(liveOther, 60_000)).toBe(false);
  // The same live pid, but the file predates the boot: a reused pid after a reboot.
  expect(stale(liveOther, 2 * HOUR + 1)).toBe(true);
  expect(stale(1000, 60_000)).toBe(true);
  expect(stale(9999, 60_000)).toBe(true);
  // Empty: a writer between create and write, then not.
  expect(stale(undefined, 1)).toBe(false);
  expect(stale(undefined, 11_000)).toBe(true);
  // Past the limit even with a long uptime.
  expect(isStaleLock(liveOther, 3 * HOUR + 1, 3 * HOUR, 100 * HOUR, 1000, alive)).toBe(true);
});

test("two calls in one process take turns: its own pid on a lock it holds is a holder (review integ-w38-recheck N1)", async () => {
  await inTemp(async (dir) => {
    const lock = join(dir, "lock");
    let inside = 0;
    let most = 0;
    const body = async () => {
      most = Math.max(most, ++inside);
      await Bun.sleep(40);
      inside--;
    };
    await Promise.all([withCaseLock(lock, 60_000, body, () => {}, 10), withCaseLock(lock, 60_000, body, () => {}, 10)]);
    expect(most).toBe(1);
    expect(existsSync(lock)).toBe(false);
    // A file with this pid that this process does not hold is still a leftover: no wait.
    writeFileSync(lock, `${process.pid}\n`);
    const start = Date.now();
    await withCaseLock(lock, 60_000, async () => {}, () => {}, 10_000);
    expect(Date.now() - start).toBeLessThan(5_000);
  });
});

test("difftest takes the lock around a heavy case's two sides, and only there (review harness-w39 N3)", async () => {
  await inTemp(async (dir) => {
    // A case's oracle prints what it sees of the lock; the subject always prints "locked". MATCH means the lock was held.
    const child = `
const { writeFileSync, readFileSync, mkdirSync } = await import("node:fs");
const { join } = await import("node:path");
const d = await import(${JSON.stringify(join(import.meta.dir, "..", "difftest.ts"))});
const { SUITES } = await import(${JSON.stringify(join(import.meta.dir, "..", "..", "harness", "suites.ts"))});
const { RUNS } = await import(${JSON.stringify(join(import.meta.dir, "common.ts"))});
const TMP = ${JSON.stringify(dir)};
const STUB = join(TMP, "stub.mjs");
writeFileSync(STUB, \`import { existsSync } from "node:fs"; console.log(process.argv[2] === "subject" || existsSync(process.env.MIRI_TEMP + ".lock") ? "locked" : "unlocked");\`);
const suite = (name, heavy, env) => ({ name, milestone: "test", description: "", mode: "single", cwd: TMP, timeoutMs: 20000, ...(heavy ? { heavy: { rssBudgetMb: 12288 } } : {}), cases: () => [{ id: "c", file: "", args: [], env }], oracle: () => [process.execPath, STUB, "oracle"], subject: () => [process.execPath, STUB, "subject"] });
SUITES.push(suite("lock-heavy", true, { MIRI_TEMP: join(TMP, "t") }), suite("lock-light", false, { MIRI_TEMP: join(TMP, "t") }));
const status = async (name) => {
  await d.difftest({ suite: name, runId: "run-" + name, quiet: true, jobs: 1 });
  return JSON.parse(readFileSync(join(RUNS, "run-" + name, name + ".jsonl"), "utf8").trim()).status;
};
console.log(JSON.stringify({ heavy: await status("lock-heavy"), light: await status("lock-light") }));
`;
    // An empty git repository as the upstream checkout, which difftest only reads the status of (as unported-buckets.test.ts).
    mkdirSync(join(dir, "rust", "compiler"), { recursive: true });
    Bun.spawnSync(["git", "init", "-q", join(dir, "rust")]);
    const r = Bun.spawnSync([process.execPath, "-e", child], { env: { ...process.env, RUST_TS_DATA: dir }, stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode, r.stderr.toString() + r.stdout.toString()).toBe(0);
    expect(JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!)).toEqual({ heavy: "MATCH", light: "DIFF" });
  });
}, 60_000);

test("a holder alive keeps a dead owner's lock; holders dead, it is stale (review harness-w42 N1)", () => {
  const HOUR = 3_600_000;
  const alive = (pid: number) => pid === 4242;
  const stale = (pid: number | undefined, holders: number[]) => isStaleLock(pid, 60_000, 3 * HOUR, 2 * HOUR, 1000, alive, holders);
  expect(stale(9999, [4242])).toBe(false);
  expect(stale(1000, [4242])).toBe(false);
  expect(stale(9999, [9998, 9997])).toBe(true);
  expect(stale(9999, [])).toBe(true);
  // Age still decides, whatever lives.
  expect(isStaleLock(9999, 2 * HOUR + 1, 3 * HOUR, 2 * HOUR, 1000, alive, [4242])).toBe(true);
});

test("addLockHolder names a holder only on a lock this process holds; a waiter waits for it (review harness-w42 N1)", async () => {
  await inTemp(async (dir) => {
    const lock = join(dir, "lock");
    const holder = Bun.spawn(["/bin/sleep", "30"]);
    try {
      addLockHolder(lock, holder.pid);
      expect(existsSync(lock)).toBe(false);
      await withCaseLock(lock, 600_000, async () => {
        addLockHolder(lock, holder.pid);
        expect(readFileSync(lock, "utf8")).toBe(`${process.pid}\n${holder.pid}\n`);
      });
      // Released by its owner: gone, whatever its holders.
      expect(existsSync(lock)).toBe(false);
      // A dead owner with a live holder: waited for, until the holder ends.
      const dead = Bun.spawnSync([process.execPath, "-e", ""]).pid;
      writeFileSync(lock, `${dead}\n${holder.pid}\n`);
      const notes: string[] = [];
      let ran = false;
      const waiting = withCaseLock(lock, 600_000, async () => void (ran = true), (l) => notes.push(l), 10);
      await Bun.sleep(200);
      expect(ran).toBe(false);
      expect(notes.length).toBe(1);
      holder.kill("SIGKILL");
      await holder.exited;
      await waiting;
      expect(ran).toBe(true);
    } finally {
      holder.kill("SIGKILL");
    }
  });
}, 60_000);

test("releaseHeldLocks removes the locks this process holds, and no other (review harness-w42 N2)", async () => {
  await inTemp(async (dir) => {
    const mine = join(dir, "mine");
    const other = join(dir, "other");
    writeFileSync(other, "1\n");
    let inside: string[] = [];
    await withCaseLock(mine, 600_000, async () => {
      releaseHeldLocks();
      inside = readdirSync(dir);
    });
    expect(inside).toEqual(["other"]);
    expect(readFileSync(other, "utf8")).toBe("1\n");
  });
});

test("difftest takes a suite's caseLock around both sides and around a subject's re-run (review root-w41-check N3)", async () => {
  await inTemp(async (dir) => {
    // The oracle prints whether the lock is there. The subject times out once, so it is re-run alone, then does the same.
    const child = `
const { writeFileSync, readFileSync, existsSync } = await import("node:fs");
const { join } = await import("node:path");
const d = await import(${JSON.stringify(join(import.meta.dir, "..", "difftest.ts"))});
const { SUITES } = await import(${JSON.stringify(join(import.meta.dir, "..", "..", "harness", "suites.ts"))});
const { RUNS } = await import(${JSON.stringify(join(import.meta.dir, "common.ts"))});
const TMP = ${JSON.stringify(dir)};
const LOCK = join(TMP, "locks", "c.case.lock");
const ONCE = join(TMP, "subject-once");
const STUB = join(TMP, "stub.mjs");
writeFileSync(STUB, \`import { existsSync, writeFileSync } from "node:fs";
if (process.argv[2] === "subject" && !existsSync(\${JSON.stringify(ONCE)})) { writeFileSync(\${JSON.stringify(ONCE)}, ""); await Bun.sleep(30000); }
console.log(existsSync(\${JSON.stringify(LOCK)}) ? "locked" : "unlocked");\`);
SUITES.push({ name: "case-lock-ir", milestone: "test", description: "", mode: "single", cwd: TMP, timeoutMs: 3000, oracleTimeoutMs: 20000, irTier: "N1", caseLock: () => LOCK, cases: () => [{ id: "c", file: "", args: [] }], oracle: () => [process.execPath, STUB, "oracle"], subject: () => [process.execPath, STUB, "subject"] });
await d.difftest({ suite: "case-lock-ir", runId: "run-case-lock-ir", quiet: true, jobs: 1 });
const r = JSON.parse(readFileSync(join(RUNS, "run-case-lock-ir", "case-lock-ir.jsonl"), "utf8").trim());
console.log(JSON.stringify({ status: r.status, retried: r.retried === true, left: existsSync(LOCK) }));
`;
    mkdirSync(join(dir, "rust", "compiler"), { recursive: true });
    Bun.spawnSync(["git", "init", "-q", join(dir, "rust")]);
    const r = Bun.spawnSync([process.execPath, "-e", child], { env: { ...process.env, RUST_TS_DATA: dir }, stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode, r.stderr.toString() + r.stdout.toString()).toBe(0);
    expect(JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!)).toEqual({ status: "MATCH", retried: true, left: false });
  });
}, 120_000);
