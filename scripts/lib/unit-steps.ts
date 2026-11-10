// The gate's unit-test processes (scripts/gate.ts `staticChecks`; lane harness-w35, review gate-runner-unit N3/N4).
// No imports, so unit tests can load it without scripts/lib/common.ts (see scripts/lib/deps.test.ts).

export interface UnitStep {
  /** The step's name in the gate's output. */
  name: string;
  /** Repo-relative directories; passed to `bun test` as `./<root>`, a path (a bare argument is a substring filter). */
  roots: string[];
  /** The junit report the step writes, in the gate run's directory; its skipped tests are checked (`ALLOWED_SKIPS`). */
  junit: string;
  /**
   * `bun test --parallel=<n>`: n worker processes, each test file with fresh modules (`--isolate`, which `--parallel`
   * implies), so every file must load when it is first in its process (lane unit-parallel). Unset: one process that runs
   * the files one after another and loads each module once.
   */
  parallel?: number;
  /**
   * With `parallel`: repo-relative test files the workers leave out (`--path-ignore-patterns`, which matches the whole
   * path) and a second process runs after them, one file after another, writing its own junit report (`aloneJunit`).
   * For files whose tests run several processes at once or slow down most when they overlap other heavy files.
   */
  alone?: string[];
}

/**
 * In order:
 * - "unit tests" (src/, tools/): oracle unit tests fail (instead of skipping) when their probe is missing. Four workers
 *   (lane unit-parallel), then its `alone` files in one process.
 * - "runner unit tests" (scripts/, harness/), in a process of their own: they point RUST_TS_DATA and the modules
 *   that read it (scripts/lib/common.ts) at temp dirs, which the src/tools tests must not see. One file after another:
 *   under `--isolate` a file would load common.ts again with whatever env an earlier file of its worker left behind
 *   (review harness-w43 section 8), and no one has audited these files for that.
 * The roots are disjoint and cover every `*.test.ts` of the repo (scripts/lib/unit-steps.test.ts).
 */
export const UNIT_STEPS: UnitStep[] = [
  {
    name: "unit tests",
    roots: ["src", "tools"],
    junit: "unit-tests.junit.xml",
    parallel: 4,
    // Every file with a test of 29 s or more in a 4-worker run beside 12 CPU-bound processes (load 30-35, lane
    // unit-parallel). Alone under that load: 36.5, 22.8, 24.9 and 25.0 s, against 46.0, 41.5, 30.2 and 29.2 s among the
    // workers. rustc_ast_passes runs about 9 processes at once.
    alone: ["src/rustc_ast_passes/oracle.test.ts", "src/miri/shims/unix/virtual_socket.test.ts", "src/rustc_driver_impl/inputs.oracle.test.ts", "src/miri/contract.test.ts"],
  },
  { name: "runner unit tests", roots: ["scripts", "harness"], junit: "runner-unit-tests.junit.xml" },
];

/** Bun's 5 s per-test default flakes under load (seen: options oracle, unicode_width all-scalar, termize pty); a hung test still fails, after 60 s. */
export const UNIT_TEST_TIMEOUT_MS = 60_000;

/** Names of the steps that run the test file at repo-relative `path` (`/`-separated): exactly one for every test file. */
export function unitStepsOf(path: string, steps: UnitStep[] = UNIT_STEPS): string[] {
  return steps.filter((s) => s.roots.some((r) => path.startsWith(`${r}/`))).map((s) => s.name);
}

/** The junit report of step `u`'s second process, the files it runs alone. */
export const aloneJunit = (u: UnitStep): string => u.junit.replace(/\.junit\.xml$/, ".alone.junit.xml");

/** The arguments after the Bun binary of step `u`, writing its junit report to `junit` (a path). Its `alone` files are left out. */
export function unitStepArgs(u: UnitStep, junit: string, timeoutMs: number = UNIT_TEST_TIMEOUT_MS): string[] {
  const workers = u.parallel === undefined ? [] : [`--parallel=${u.parallel}`, ...(u.alone ?? []).map((f) => `--path-ignore-patterns=${f}`)];
  return ["test", ...u.roots.map((r) => `./${r}`), ...workers, `--timeout=${timeoutMs}`, "--reporter=junit", `--reporter-outfile=${junit}`];
}

/** The arguments of the process that runs step `u`'s `alone` files one after another, or undefined if it has none (or no workers). */
export function aloneStepArgs(u: UnitStep, junit: string, timeoutMs: number = UNIT_TEST_TIMEOUT_MS): string[] | undefined {
  if (u.parallel === undefined || !u.alone?.length) return undefined;
  // `--isolate`: each file gets fresh modules, as under the workers, so a module-order cycle in the second file cannot hide (review unit-parallel N1).
  return ["test", ...u.alone.map((f) => `./${f}`), "--isolate", `--timeout=${timeoutMs}`, "--reporter=junit", `--reporter-outfile=${junit}`];
}

/**
 * The environment a unit-test step adds to the gate's own:
 * - RUST_TS_REQUIRE_PROBES=1: a missing probe fails a test instead of skipping it; the junit report lists the tests
 *   that skipped anyway (checked against ALLOWED_SKIPS).
 * - CI=true: Bun fails the run on a leftover `.only` (which would otherwise drop the other tests of its file from the
 *   run, and from the report, without counting them as skipped).
 * - RUST_TS_DATA, RUST_TS_HOST_TUPLE: `bun test` and its `--parallel` workers do not read `.env.local` (Bun loads
 *   `.env.test` there), so the gate's values (scripts/lib/common.ts reads `.env.local`) are passed by name. A host tuple
 *   the gate does not have stays unset.
 * - RUST_TS_SUBJECT=source: the unit tests test the harness in source mode, whatever mode the gate's suites run in. Source
 *   is the harness's default (`DEFAULT_SUBJECT_MODE` in scripts/lib/subject-bin.ts, which this file may not import, see
 *   its header; scripts/lib/unit-steps.test.ts checks that the two agree, review root-w47-check N3). A gate run with `RUST_TS_SUBJECT=binary` passed it on, and the harness tests that read a suite's subject command (which
 *   names `src/rust_ts/main.ts` in source mode) failed (gate-20261110-013859-root-j9yr). Binary mode has its own tests
 *   (scripts/subject-bin.cases.ts).
 */
export function unitStepEnv(data: string, hostTuple: string | undefined): Record<string, string> {
  return {
    RUST_TS_REQUIRE_PROBES: "1",
    CI: "true",
    RUST_TS_DATA: data,
    RUST_TS_SUBJECT: "source",
    ...(hostTuple === undefined ? {} : { RUST_TS_HOST_TUPLE: hostTuple }),
  };
}

/**
 * Variables that make `bun test` (1.4.3) quiet, as for an AI agent: with any of them set it prints no file names and no
 * passing tests, only failures (measured one at a time; others it checks, if any, were not found). The gate is often started
 * from such an agent's shell, so they reach the unit steps.
 */
export const BUN_QUIET_VARS: readonly string[] = ["CLAUDECODE", "AGENT", "REPL_ID"];

/**
 * The environment of a one-process pass (the alone files, and a step without workers): `env` with BUN_QUIET_VARS unset, so
 * that Bun prints each test file's name as it starts it (review harness-w45 N1). A test that ends the process
 * (`process.exit`, an abort, a crash) leaves no junit report, and the last name Bun printed is then the file it was in. The
 * workers need no such thing: Bun names a file whose worker died. Nothing in the repo reads these variables (they change
 * only what Bun prints).
 */
export function oneProcessEnv(env: Record<string, string>): Record<string, string | null> {
  return { ...env, ...Object.fromEntries(BUN_QUIET_VARS.map((k) => [k, null])) };
}

/**
 * Variables that change what a unit test checks, each with why; the gate refuses to start while any is set
 * (`unitEnvRefusal`, review root-w47-check N1, N2), since every unit test would inherit it. Nothing the gate runs needs one
 * from the gate's own environment: difftest, miri-diff and phase-diff set `RUST_TS_IMPL` for each subject they start, and
 * the subject builds unset it (scripts/lib/subject-bin.ts). A refusal rather than unsetting them in the unit steps: whoever
 * set one meant something the gate cannot do, and a fixture rewrite would otherwise surface only at the end of the run, as
 * "the tree changed while the gate was running". scripts/lib/unit-steps.test.ts checks that every variable a test file reads
 * is here or named harmless there, and that every fixture-writer name (`REGEN`, `*_WRITE`, ...) in the repo is here.
 */
export const UNIT_ENV_REFUSED: Readonly<Record<string, string>> = {
  RUST_TS_IMPL:
    "the unit tests that start src/rust_ts/main.ts with a copy of their environment pass it on: `shim` runs the oracle in the port's place, so such a test compares the oracle with itself, and `stub` fails it (src/rustc_const_eval/const_eval/eval_queries.oracle.test.ts)",
  REGEN: "the oracle tests that read it rewrite their checked-in fixtures from the oracle, so a test of a fixture passes by construction",
  RUST_TS_WRITE_ORACLE: "src/rustc_parse/parser/item.test.ts rewrites its checked-in oracle output",
  TYREPR_WRITE: "src/rustc_middle/ty/repr.oracle.test.ts rewrites its expected.json",
  TYPRINT_WRITE: "src/rustc_middle/ty/print/pretty_b.test.ts rewrites its expected.json",
  TYCONSTS_WRITE: "src/rustc_middle/ty/consts/consts.oracle.test.ts rewrites its expected.json",
  TYREPR_PROBE: "src/rustc_middle/ty/repr.oracle.test.ts compares with that probe instead of its checked-in expected.json",
  TYPRINT_PROBE: "src/rustc_middle/ty/print/pretty_b.test.ts compares with that probe instead of its checked-in expected.json",
  TYCONSTS_PROBE: "src/rustc_middle/ty/consts/consts.oracle.test.ts compares with that probe instead of its checked-in expected.json",
};

/** Why the gate must not start with this environment, or `undefined`: a `UNIT_ENV_REFUSED` variable is set (even to ""). */
export function unitEnvRefusal(env: Record<string, string | undefined>): string | undefined {
  const set = Object.keys(UNIT_ENV_REFUSED).filter((k) => env[k] !== undefined);
  if (set.length === 0) return undefined;
  const why = set.map((k) => `${k}: ${UNIT_ENV_REFUSED[k]}`).join("; ");
  return `${set.map((k) => `${k}=${env[k]}`).join(" and ")} set: every unit test would inherit it (${why}); no gate step needs it from the gate's environment: unset it and re-run the gate`;
}
