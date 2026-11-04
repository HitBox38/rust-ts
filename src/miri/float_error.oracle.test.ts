// The random float error of Miri's float operations, against the isolated Miri oracle (miri-shims-d review M1): the
// suites' deterministic oracle fixtures short-circuit it, so without this test a changed error scale goes unnoticed.
// `float_error_oracle/float_error.rs` runs under both Miris (rust_ts/miri_program.ts); under
// `-Zmiri-max-extra-rounding-error` every result is off by exactly its maximum, so stdout pins the scale and every RNG
// draw, and the same program under `-Zmiri-deterministic-floats` shows the error really is applied.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { MIRI_PROGRAM_TIMEOUT_MS, miri_program_problem, run_miri_program } from "../rust_ts/miri_program.ts";

const PROGRAM = join(import.meta.dir, "float_error_oracle", "float_error.rs");
const problem = miri_program_problem();
if (problem !== undefined) console.log(`float_error.oracle.test.ts: skipped: ${problem}`);

test.skipIf(problem !== undefined)(
  "the maximum float error of pow, powi, fast math and the host and shim float ops matches Miri",
  () => {
    const max = run_miri_program(PROGRAM, ["-Zmiri-max-extra-rounding-error"]);
    expect(max.oracle.status).toBe(0);
    expect(max.oracle.stdout).toEndWith("done\n");
    expect(max.port).toEqual(max.oracle);

    const det = run_miri_program(PROGRAM, ["-Zmiri-deterministic-floats"]);
    expect(det.oracle.status).toBe(0);
    expect(det.port).toEqual(det.oracle);

    // The error shows in every line with a result that is not exact.
    const lines = (s: string) => s.trimEnd().split("\n");
    const changed = lines(max.oracle.stdout).filter((l, i) => l !== lines(det.oracle.stdout)[i]).map((l) => l.split(" ")[0]);
    for (const op of ["powf32", "powf64", "powif32", "powif64", "fadd_fast", "fsub_fast", "fmul_fast", "fdiv_fast", "frem_fast", "sin", "exp2", "tan", "gamma", "ln_gamma"]) {
      expect(changed).toContain(op);
    }
  },
  2 * MIRI_PROGRAM_TIMEOUT_MS,
);
