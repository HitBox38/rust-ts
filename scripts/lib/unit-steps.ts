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
 */
export function unitStepEnv(data: string, hostTuple: string | undefined): Record<string, string> {
  return { RUST_TS_REQUIRE_PROBES: "1", CI: "true", RUST_TS_DATA: data, ...(hostTuple === undefined ? {} : { RUST_TS_HOST_TUPLE: hostTuple }) };
}
