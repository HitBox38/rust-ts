// A lock across difftest processes for one case (review harness-m6c N1). A heavy Miri case's `MIRI_TEMP` is a fixed path
// per case under the shared $RUST_TS_DATA, since the path is in the oracle cache key. `jobs = 1` keeps the two sides apart
// only inside one difftest, and two at once would delete each other's files (`utils::prepare`): a false DIFF, or a
// failing oracle output in the cache.
//
// The lock is a file created with O_EXCL, holding the owner's pid, then the pid of each process the owner started that writes
// where the lock guards (`addLockHolder`): a compiler outlives an owner killed by SIGKILL, and would write into the next
// owner's files (review harness-w42 N1). It is taken over if its owner and every such holder are dead, if it predates
// this boot (a reboot leaves it behind, and its pids may now be other live processes'), if its owner is this process, if it
// is still empty after a write that takes microseconds, or if it is older than `maxHoldMs`. If two waiters see the same dead owner, one can remove the lock the other
// has just made: that needs an owner killed by SIGKILL (scripts/ir-run.ts releases its lock on SIGTERM, review harness-w42 N2) and two
// more on the same case in the same moment, and is not handled.
// Imports no harness code: scripts/lib/common.ts fixes RUST_TS_DATA when it first loads.
import { appendFileSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";

/** The lock files this process holds now: its own pid on one of these is a holder, not a leftover (review integ-w38-recheck N1). */
const held = new Set<string>();

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists (another user's).
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** The pids of a lock file, owner first, then its holders: undefined while it is being written, or "gone" if the file has just been released. */
function lockPids(file: string): number[] | undefined | "gone" {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return "gone";
  }
  const lines = text.split("\n");
  const first = Number.parseInt(lines[0]!, 10);
  if (Number.isNaN(first)) return undefined;
  // Holders: whole lines only, as what follows the last newline can be a line still being appended.
  const holders = lines.slice(1, -1).map((l) => Number.parseInt(l, 10)).filter((n) => !Number.isNaN(n));
  return [first, ...holders];
}

/** The owner of a lock file: its pid, undefined while it is being written, or "gone" if the file has just been released. */
function owner(file: string): number | undefined | "gone" {
  const p = lockPids(file);
  return p === undefined || p === "gone" ? p : p[0];
}

/** How long an empty lock file can still be a writer between creating it and writing its pid. */
const EMPTY_LOCK_MS = 10_000;

const ageMs = (file: string): number => {
  try {
    return Date.now() - statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

/**
 * Whether a lock with owner `pid`, the further `holders` and age `age` can no longer be held by anyone. `uptimeMs` is how long ago
 * this boot was. A holder alive keeps the lock even when the owner is gone, or is this process's pid on a file it does not hold.
 */
export function isStaleLock(pid: number | undefined, age: number, maxHoldMs: number, uptimeMs: number, self: number, isAlive: (pid: number) => boolean, holders: readonly number[] = []): boolean {
  if (age > maxHoldMs || age > uptimeMs) return true;
  if (pid === undefined) return age > EMPTY_LOCK_MS;
  return (pid === self || !isAlive(pid)) && !holders.some(isAlive);
}

/**
 * Records `pid`, a process this one started, as a holder of the lock `file` that this process holds: the lock is not taken over
 * while it lives, even if this process is killed (review harness-w42 N1). Nothing if this process does not hold `file`.
 */
export function addLockHolder(file: string, pid: number): void {
  if (!held.has(file) || owner(file) !== process.pid) return;
  appendFileSync(file, `${pid}\n`);
}

/**
 * Removes every lock this process holds now, at once: for a signal handler about to `process.exit`, where `withCaseLock`'s own
 * release would not run (review harness-w42 N2). Its holders must have ended, or the next owner shares what they write.
 */
export function releaseHeldLocks(): void {
  for (const file of held) {
    held.delete(file);
    if (owner(file) === process.pid) rmSync(file, { force: true });
  }
}

/**
 * Runs `fn` holding the lock `file`, waiting for any other process that holds it. The wait is outside `fn`, so it counts against
 * no limit of the processes `fn` starts. It does count against a limit on this process itself: scripts/ir-run.ts is timed by
 * difftest, so difftest takes the case's own lock first (`Suite.caseLock`, review root-w41-check N3). `note` gets one line if this has to wait.
 */
export async function withCaseLock<T>(file: string, maxHoldMs: number, fn: () => Promise<T>, note: (line: string) => void = console.error, pollMs = 500): Promise<T> {
  let noted = false;
  for (;;) {
    try {
      writeFileSync(file, `${process.pid}\n`, { flag: "wx" });
      held.add(file);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const pids = lockPids(file);
    if (pids === "gone") continue;
    const pid = pids?.[0];
    // A lock this process holds is never stale here, so a second call in one process waits for the first. `self` only says "my pid on a file I do not hold".
    if (isStaleLock(pid, ageMs(file), maxHoldMs, uptime() * 1000, held.has(file) ? -1 : process.pid, alive, pids?.slice(1))) {
      const moved = `${file}.stale-${process.pid}`;
      try {
        renameSync(file, moved);
        rmSync(moved, { force: true });
      } catch {
        // Another waiter took it first.
      }
      continue;
    }
    if (!noted) {
      noted = true;
      note(`note: waiting for pid ${pid ?? "?"} to release ${file}: another run has this lock`);
    }
    await Bun.sleep(pollMs);
  }
  try {
    return await fn();
  } finally {
    held.delete(file);
    // Unless it was taken over: then the file is the new owner's.
    if (owner(file) === process.pid) rmSync(file, { force: true });
  }
}
