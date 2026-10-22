// Oracle tests for lane check-compare: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs (+ refine.rs).
//
// Cases: compare_impl_item_oracle/cases/<name>.rs, small no_core libraries whose type checking emits exactly the
// impl/trait mismatch diagnostic under test (E0049, E0050, E0053, E0185, E0186, E0195, E0326, E0643, and the
// `refining_impl_trait` lint). The oracle is the pinned rustc on the same file and arguments (stderr + exit code).
//
// 1. End to end: src/rust_ts/main.ts on every case. PENDING while the driver stops before `check_crate`; a pending case
//    must still stop at exactly the listed `rust-ts: unported: ..` line (exit 70), so the entry has to go once the pipeline
//    runs through (then stderr and the exit code must equal the oracle's).
// 2. In process: compare_impl_item_oracle/run.ts calls `compare_impl_item` (and `refine`) on every trait impl item from
//    `after_expansion`, as check.rs `check_impl_items_against_trait` does. Cases in IN_PROCESS_PENDING stop at the listed
//    unported item (exit 70, other wave-17 lanes); the rest must equal the oracle's stderr and exit code byte for byte.
//
// Without the pinned toolchain this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { beforeAll, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const HERE = import.meta.dir;
const CASES_DIR = join(HERE, "compare_impl_item_oracle", "cases");
const RUNNER = join(HERE, "compare_impl_item_oracle", "run.ts");
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
  ["e0049_fn", "e0049_fn_fewer", "e0049_impl_trait", "e0050", "e0053_kinds_fn", "e0053_sig", "e0185", "e0186", "e0195", "e0643", "refine_rpitit"].map((c) => [c, "mir_borrowck provider (not ported)"]),
);

/**
 * In-process stops (re-pinned by merge-w17; e0050 / e0185 / e0186 / e0643 now equal the oracle, e0195 since small-gaps-18
 * ported `LateParamRegionKind::from_bound`, refine_rpitit since typeck-gaps ported `ConstraintCategory`): E0053 (signature)
 * and E0326 stop at the type-error report (`TypeErrCtxt::note_type_err`, wave 19; re-pinned by errctxt-contract, which
 * ported `err_ctxt` / `ObligationCauseExt`). Re-pinned by errrep-infer-a: `note_type_err` is ported; the stop is its call of
 * `note_field_shadowed_by_private_candidate_in_cause` (traits/suggestions.rs, lane errrep-sugg-a). Since merge-w19 (the
 * wave-19 error-reporting lanes landed) both equal the oracle; no in-process stop is left.
 */
/** The lint case (`refining_impl_trait`, a warning; in process since lane typeck-gaps ported `ConstraintCategory`). */
const LINT_CASES = new Set(["refine_rpitit"]);
const IN_PROCESS_PENDING: Record<string, string> = {};

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

function unported_lines(stderr: string): string[] {
  return stderr.split("\n").filter((l) => l.startsWith("rust-ts: "));
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
  expect(CASES.length).toBeGreaterThanOrEqual(14);
  for (const c of Object.keys(IN_PROCESS_PENDING)) expect(CASES).toContain(c);
});

for (const c of CASES) {
  test(`end to end: ${c}`, async () => {
    const got = await run([process.execPath, MAIN, ...ARGS, `${c}.rs`]);
    const pending = PENDING[c];
    if (pending !== undefined) {
      expect({ exit: got.code, unported: unported_lines(got.stderr) }).toEqual({ exit: 70, unported: [`rust-ts: unported: ${pending}`] });
      return;
    }
    if (oracle_cmd === undefined) return;
    expect(got).toEqual(oracle_out.get(c)!);
  }, 120_000);

  test(`in process: ${c}`, async () => {
    const got = await run([process.execPath, RUNNER, ...ARGS, `${c}.rs`]);
    const pending = IN_PROCESS_PENDING[c];
    if (pending !== undefined) {
      expect({ exit: got.code, unported: unported_lines(got.stderr) }).toEqual({ exit: 70, unported: [`rust-ts: unported: ${pending}`] });
      return;
    }
    if (oracle_cmd === undefined) return;
    const want = oracle_out.get(c)!;
    // the oracle reported an error, or the lint case its warning (guards against a case that tests nothing)
    if (LINT_CASES.has(c)) {
      expect(want.code).toBe(0);
      expect(want.stderr).toMatch(/^warning: /m);
    } else {
      expect(want.code).toBe(1);
      expect(want.stderr).toContain("error[E");
    }
    expect(got.stderr).toBe(want.stderr);
    expect(got.code).toBe(want.code);
  }, 120_000);

  test(`oracle: ${c} emits exactly one diagnostic`, () => {
    if (oracle_cmd === undefined) return;
    const want = oracle_out.get(c)!;
    // one error (or, for the lint case, one warning) and nothing else from later passes
    const heads = want.stderr.split("\n").filter((l) => /^(error|warning)(\[E\d+\])?: /.test(l) && !/^error: aborting|^warning: \d+ warning/.test(l));
    expect(heads.length).toBe(1);
  });
}
