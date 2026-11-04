// scripts/lib/case-lock.ts, with real processes for mutual exclusion and a dead owner.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isStaleLock, withCaseLock } from "./case-lock.ts";

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
