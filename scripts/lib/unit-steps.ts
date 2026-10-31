// The gate's unit-test processes (scripts/gate.ts `staticChecks`; lane harness-w35, review gate-runner-unit N3/N4).
// No imports, so unit tests can load it without scripts/lib/common.ts (see scripts/lib/deps.test.ts).

export interface UnitStep {
  /** The step's name in the gate's output. */
  name: string;
  /** Repo-relative directories; passed to `bun test` as `./<root>`, a path (a bare argument is a substring filter). */
  roots: string[];
  /** The junit report the step writes, in the gate run's directory; its skipped tests are checked (`ALLOWED_SKIPS`). */
  junit: string;
}

/**
 * In order:
 * - "unit tests" (src/, tools/): oracle unit tests fail (instead of skipping) when their probe is missing.
 * - "runner unit tests" (scripts/, harness/), in a process of their own: they point RUST_TS_DATA and the modules
 *   that read it (scripts/lib/common.ts) at temp dirs, which the src/tools tests must not see.
 * The roots are disjoint and cover every `*.test.ts` of the repo (scripts/lib/unit-steps.test.ts).
 */
export const UNIT_STEPS: UnitStep[] = [
  { name: "unit tests", roots: ["src", "tools"], junit: "unit-tests.junit.xml" },
  { name: "runner unit tests", roots: ["scripts", "harness"], junit: "runner-unit-tests.junit.xml" },
];

/** Names of the steps that run the test file at repo-relative `path` (`/`-separated): exactly one for every test file. */
export function unitStepsOf(path: string, steps: UnitStep[] = UNIT_STEPS): string[] {
  return steps.filter((s) => s.roots.some((r) => path.startsWith(`${r}/`))).map((s) => s.name);
}
