// read, write, readv, writev, fcntl, ioctl, flock and poll against the isolated Miri oracle (miri-shims-d review M2): the
// programs in fd_oracle/ run under both Miris (rust_ts/miri_program.ts) and their exit code, stdout and stderr must be
// equal. They use eventfds and the standard streams with isolation on, because pipes and socketpairs are not ported yet
// (plan-m6 D2) and host files need isolation off (D14); fd.test.ts covers what only a host file reaches on a stand-in.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { MIRI_PROGRAM_TIMEOUT_MS, miri_program_problem, run_miri_program } from "../../../rust_ts/miri_program.ts";

const dir = join(import.meta.dir, "fd_oracle");
const problem = miri_program_problem();
if (problem !== undefined) console.log(`fd_ops.oracle.test.ts: skipped: ${problem}`);
const oracle_test = test.skipIf(problem !== undefined);
const TIMEOUT = 2 * MIRI_PROGRAM_TIMEOUT_MS;

oracle_test(
  "read, write, readv, writev, fcntl and ioctl match Miri, and leak no handle",
  () => {
    const { oracle, port } = run_miri_program(join(dir, "fd_ops.rs"));
    expect(oracle.status).toBe(0);
    expect(oracle.stdout).toEndWith("done\n");
    // The program's leak check really holds under the oracle: registered while a descriptor is open, gone after.
    expect(oracle.stdout).toContain("epoll_wait dups open: 1\n");
    expect(oracle.stdout).toContain("close neg: 0\n");
    expect(oracle.stdout).toContain("epoll_wait closed: 0\n");
    expect(port).toEqual(oracle);
  },
  TIMEOUT,
);

oracle_test(
  "poll's fast path, POLLNVAL, timeouts and wakeups match Miri",
  () => {
    const { oracle, port } = run_miri_program(join(dir, "poll_ops.rs"));
    expect(oracle.status).toBe(0);
    expect(oracle.stdout).toEndWith("done\n");
    expect(port).toEqual(oracle);
  },
  TIMEOUT,
);

// The calls Miri stops on: unsupported operations, UB and deadlocks.
for (const c of [
  "fcntl-command",
  "fcntl-getfl",
  "fcntl-setfl",
  "fcntl-varargs",
  "ioctl-opcode",
  "flock-flags",
  "flock-eventfd",
  "poll-events",
  "poll-twice",
  "pread-eventfd",
  "pwrite-eventfd",
  "read-oob",
  "write-oob",
  "readv-iov",
  "writev-iov",
  "read-deadlock",
  "poll-deadlock",
]) {
  oracle_test(
    `stops like Miri: ${c}`,
    () => {
      const { oracle, port } = run_miri_program(join(dir, "stops.rs"), [], [c]);
      expect(oracle.status).not.toBe(0);
      expect(oracle.stderr).toContain("error: ");
      expect(port).toEqual(oracle);
    },
    TIMEOUT,
  );
}
