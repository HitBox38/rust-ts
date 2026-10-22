// Oracle tests for lane hir-ty-lowering-d: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs (+ diagnostics.rs:477
// `MissingGenericParams::into_diag`).
//
// Cases: errors_oracle/cases/<name>.rs, small no_core libraries whose type checking emits exactly the errors.rs diagnostic
// under test. The oracle is the pinned rustc on the same file and arguments (stderr + exit code).
//
// 1. End to end: src/rust_ts/main.ts on every case. PENDING while the driver stops before HIR ty lowering; a pending case
//    must still stop at exactly the listed `rust-ts: unported: ..` line (exit 70), so the entry has to go once the pipeline
//    runs through (then stderr and the exit code must equal the oracle's).
// 2. In process: errors_oracle/run.ts calls the errors.rs entry point from `after_expansion` with the arguments its
//    upstream caller computes (see run.ts for the scaffolding), the diagnostic goes through the session's emitter and the
//    driver prints the error count: stderr and the exit code must equal the oracle's byte for byte.
//
// Without the pinned toolchain this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { beforeAll, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const HERE = import.meta.dir;
const CASES_DIR = join(HERE, "errors_oracle", "cases");
const RUNNER = join(HERE, "errors_oracle", "run.ts");
const MAIN = join(REPO, "src", "rust_ts", "main.ts");
const ARGS = ["--edition", "2021", "--crate-type", "lib", "-Ainternal_features"];

const CASES = readdirSync(CASES_DIR)
  .filter((f) => f.endsWith(".rs"))
  .map((f) => f.slice(0, -3))
  .sort();

/**
 * Where the port's driver stops today (main.ts), re-pinned by passes-analysis (the real `analysis`): cases with a fn body
 * stop at `mir_borrowck` (MIR_borrow_checking loop of `run_required_analyses`, not ported yet), after printing the
 * oracle's own diagnostics; the others now run `analysis` through and equal the oracle.
 */
const PENDING: Record<string, string> = Object.fromEntries(
  ["e0109_kinds"].map((c) => [c, "mir_borrowck provider (not ported)"]),
);

const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
}

interface Out {
  stderr: string;
  code: number;
}
async function run(cmd: string[]): Promise<Out> {
  const p = Bun.spawn(cmd, { cwd: CASES_DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  const [, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stderr, code };
}

let oracle_cmd: ((args: string[]) => string[]) | undefined;
const oracle_out = new Map<string, Out>();

beforeAll(async () => {
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  const probe = Bun.spawnSync(oracle.oracleRustcCmd(["-vV"]), { env: ENV });
  if (probe.exitCode !== 0) {
    if (REQUIRE) throw new Error("ERROR: the pinned rustc is not runnable and RUST_TS_REQUIRE_PROBES=1");
    console.log("SKIP: pinned rustc not runnable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");
    return;
  }
  await oracle.verifyOraclePin();
  oracle_cmd = oracle.oracleRustcCmd;
  await Promise.all(
    CASES.map(async (c) => {
      oracle_out.set(c, await run(oracle.oracleRustcCmd([...ARGS, `${c}.rs`])));
    }),
  );
}, 120_000);

test("the cases exist", () => {
  expect(CASES.length).toBeGreaterThanOrEqual(9);
});

for (const c of CASES) {
  test(`end to end: ${c}`, async () => {
    const got = await run([process.execPath, MAIN, ...ARGS, `${c}.rs`]);
    const pending = PENDING[c];
    if (pending !== undefined) {
      expect({ exit: got.code, unported: got.stderr.split("\n").filter((l) => l.startsWith("rust-ts: ")) }).toEqual({
        exit: 70,
        unported: [`rust-ts: unported: ${pending}`],
      });
      return;
    }
    if (oracle_cmd === undefined) return;
    expect(got).toEqual(oracle_out.get(c)!);
  }, 120_000);

  test(`in process: ${c}`, async () => {
    if (oracle_cmd === undefined) return;
    const want = oracle_out.get(c)!;
    // the oracle reported an error (guards against a case that tests nothing)
    expect(want.code).toBe(1);
    expect(want.stderr).toContain("error[E");
    const got = await run([process.execPath, RUNNER, c, ...ARGS, `${c}.rs`]);
    expect(got.stderr).toBe(want.stderr);
    expect(got.code).toBe(want.code);
  }, 120_000);
}
