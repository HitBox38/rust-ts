// A lock across difftest processes for one case (review harness-m6c N1). A heavy Miri case's `MIRI_TEMP` is a fixed path
// per case under the shared $RUST_TS_DATA, since the path is in the oracle cache key. `jobs = 1` keeps the two sides apart
// only inside one difftest, and two at once would delete each other's files (`utils::prepare`): a false DIFF, or a
// failing oracle output in the cache.
//
// The lock is a file created with O_EXCL, holding the owner's pid. A dead owner's lock, or one older than `maxHoldMs` (a
// reused pid after a reboot), is taken over. If two waiters see the same dead owner, one can remove the lock the other
// has just made: that needs a killed difftest and two more on the same case in the same moment, and is not handled.
// Imports no harness code: scripts/lib/common.ts fixes RUST_TS_DATA when it first loads.
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists (another user's).
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** The owner of a lock file: its pid, undefined while it is being written, or "gone" if the file has just been released. */
function owner(file: string): number | undefined | "gone" {
  try {
    const n = Number.parseInt(readFileSync(file, "utf8"), 10);
    return Number.isNaN(n) ? undefined : n;
  } catch {
    return "gone";
  }
}

const ageMs = (file: string): number => {
  try {
    return Date.now() - statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

/**
 * Runs `fn` holding the lock `file`, waiting for any other process that holds it. The wait is outside `fn`, so it never
 * counts against the limits of the processes `fn` starts. `note` gets one line if this has to wait.
 */
export async function withCaseLock<T>(file: string, maxHoldMs: number, fn: () => Promise<T>, note: (line: string) => void = console.error, pollMs = 500): Promise<T> {
  let noted = false;
  for (;;) {
    try {
      writeFileSync(file, `${process.pid}\n`, { flag: "wx" });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const pid = owner(file);
    if (pid === "gone") continue;
    if ((pid !== undefined && !alive(pid)) || ageMs(file) > maxHoldMs) {
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
      note(`note: waiting for pid ${pid ?? "?"} to release ${file}: another difftest is running this case`);
    }
    await Bun.sleep(pollMs);
  }
  try {
    return await fn();
  } finally {
    // Unless it was taken over: then the file is the new owner's.
    if (owner(file) === process.pid) rmSync(file, { force: true });
  }
}
