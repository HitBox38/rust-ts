// rust-ts glue (not an upstream mirror) for tests that run one small program under both Miris: the isolated oracle
// (scripts/lib/miri.ts; plan-m6 D1) and the port's driver (src/miri/bin/miri.ts), with the same argv, environment and
// cwd. A test compares the two results directly, so its expected value is always the oracle's, on the machine running
// the test (host float results included), and no fixture can go stale.
import { spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { REPO } from "../../scripts/lib/common.ts";
import { caseEnv, mergeEnv } from "../../scripts/lib/env.ts";
import { MIRI_CASE_ENV, MIRI_SYSROOT, miriBinary, miriOracleProblem, miriPin } from "../../scripts/lib/miri.ts";

/** A generous per-run limit: a run that takes seconds on a quiet machine took over 240 s at load 100 (other lanes). */
export const MIRI_PROGRAM_TIMEOUT_MS = 900_000;

export interface MiriRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Why the isolated oracle cannot run here (a test skips with this reason), or undefined when it can. */
export function miri_program_problem(): string | undefined {
  return miriOracleProblem({ sysroot: true });
}

function run(cmd: string[], file: string, env: Record<string, string>): MiriRun {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd: dirname(file), env, encoding: "utf8", maxBuffer: 1 << 26, timeout: MIRI_PROGRAM_TIMEOUT_MS });
  if (r.error !== undefined) throw new Error(`ERROR: ${basename(cmd[0]!)} on ${basename(file)}: ${r.error.message}`);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/**
 * The environment both sides run with: what difftest and phase-diff give a case (`caseEnv` keeps a caller's exported
 * variables out, such as RUSTC_LOG), and `RUSTC_ICE=0` so an ICE writes no file into the cwd, which is inside `src/`.
 */
export function miri_program_env(base: Record<string, string | undefined> = process.env): Record<string, string> {
  return mergeEnv(base, caseEnv({ ...MIRI_CASE_ENV, RUSTC_ICE: "0", RUST_BACKTRACE: "0" }, base));
}

/** The oracle's and the port's result on `file`, with Miri flags `flags` and the program's arguments `program_args`. */
export function run_miri_program(file: string, flags: readonly string[] = [], program_args: readonly string[] = []): { oracle: MiriRun; port: MiriRun } {
  const env = miri_program_env();
  const argv = [basename(file), "--edition", "2021", "--sysroot", MIRI_SYSROOT, "--target", miriPin().target, ...flags];
  if (program_args.length > 0) argv.push("--", ...program_args);
  return {
    oracle: run([miriBinary(), ...argv], file, env),
    port: run([process.execPath, join(REPO, "src/miri/bin/miri.ts"), ...argv], file, env),
  };
}
