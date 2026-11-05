// `report_error`'s allocation dump against the isolated Miri oracle (miri-x86-a review O1). A dump larger than the pipe
// on stderr came out of order: the rest of the report overtook it, because the dump went through `process.stderr.write`.
// The expected bytes are the oracle's, live (rust_ts/miri_program.ts). The same dump through a file or a `spawnSync` pipe
// always matched, so this reads stderr through a real `pipe(2)`.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { MIRI_PROGRAM_TIMEOUT_MS, miri_program_problem, run_miri_program, run_miri_program_stderr_pipe } from "../rust_ts/miri_program.ts";

const PROGRAM = join(import.meta.dir, "diagnostics_oracle", "big_alloc_dump.rs");
const problem = miri_program_problem();
if (problem !== undefined) console.log(`diagnostics.oracle.test.ts: skipped: ${problem}`);

test.skipIf(problem !== undefined)(
  "an allocation dump larger than the pipe buffer stays in order",
  () => {
    const { oracle, port } = run_miri_program_stderr_pipe(PROGRAM);
    // The program does reach the path: the dump is over the 64 KiB of a pipe, and the report ends after it.
    expect(oracle).toContain("Uninitialized memory occurred at");
    expect(oracle.length).toBeGreaterThan(1 << 16);
    expect(oracle.trimEnd().endsWith("error: aborting due to 1 previous error")).toBe(true);
    expect(port === oracle).toBe(true);
  },
  MIRI_PROGRAM_TIMEOUT_MS * 2,
);

// docs/reviews/integ-w38-recheck.md F1: a pointer fragment in an allocation dump printed `╾42a[object Object] (ptr fragment 0)╼`.
const FRAGMENTS = join(import.meta.dir, "diagnostics_oracle", "ptr_fragment_dump.rs");
test.skipIf(problem !== undefined)(
  "an allocation dump prints the provenance of pointer fragments, concrete and wildcard",
  () => {
    const { oracle, port } = run_miri_program(FRAGMENTS, ["-Zmiri-disable-validation"]);
    // The program does reach the path: both kinds of fragment are in the dump.
    expect(oracle.stderr).toContain("(ptr fragment 0)");
    expect(oracle.stderr).toContain("[wildcard] (ptr fragment 2)");
    expect(port.stderr === oracle.stderr).toBe(true);
    expect(port.status).toBe(oracle.status);
  },
  MIRI_PROGRAM_TIMEOUT_MS * 2,
);
