// Unit tests of scripts/lib/unit-steps.ts (lane harness-w35): every test file of the repo runs in exactly one of the
// gate's unit-test processes (review gate-runner-unit N4).
import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { UNIT_STEPS, aloneJunit, aloneStepArgs, unitStepArgs, unitStepEnv, unitStepsOf } from "./unit-steps.ts";

const REPO = resolve(import.meta.dir, "..", "..");

test("roots are disjoint, and no root lies inside another", () => {
  const roots = UNIT_STEPS.flatMap((s) => s.roots);
  expect(new Set(roots).size).toBe(roots.length);
  for (const a of roots) for (const b of roots) if (a !== b) expect(a.startsWith(`${b}/`)).toBe(false);
  expect(new Set(UNIT_STEPS.map((s) => s.junit)).size).toBe(UNIT_STEPS.length);
});

test("unitStepsOf matches by root path, not substring", () => {
  expect(unitStepsOf("src/a.test.ts")).toEqual(["unit tests"]);
  expect(unitStepsOf("scripts/src/a.test.ts")).toEqual(["runner unit tests"]);
  expect(unitStepsOf("harness/tools.test.ts")).toEqual(["runner unit tests"]);
  expect(unitStepsOf("srcx/a.test.ts")).toEqual([]);
});

// Every name `bun test` discovers as a test file (its default patterns: `*.test.*`, `*_test.*`, `*.spec.*`, `*_spec.*`
// over js/jsx/ts/tsx; review harness-w35 N4, lane harness-w36). At the pin `src/rustc_passes/{abi,layout}_test.ts`
// match `*_test.ts` (ported modules named after upstream's abi_test.rs / layout_test.rs, which bun also runs as test
// files); they are under src/, so in exactly one step.
const BUN_TEST_PATTERNS = ["test", "spec"].flatMap((w) => [".", "_"].flatMap((sep) => ["js", "jsx", "ts", "tsx"].map((ext) => `*${sep}${w}.${ext}`)));

test("every test file of the repo (tracked or not ignored, any of bun's test-file patterns) runs in exactly one unit-test process", () => {
  expect(BUN_TEST_PATTERNS).toContain("*_test.ts");
  expect(BUN_TEST_PATTERNS).toContain("*.spec.ts");
  expect(BUN_TEST_PATTERNS.length).toBe(16);
  const r = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard", "--", ...BUN_TEST_PATTERNS], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const files = r.stdout.toString().split("\n").filter(Boolean);
  expect(files.length).toBeGreaterThan(0);
  expect(files).toContain("src/rustc_passes/abi_test.ts");
  const bad = files.map((f) => ({ f, steps: unitStepsOf(f) })).filter((x) => x.steps.length !== 1);
  expect(bad).toEqual([]);
});

// Lane unit-parallel: the src/tools step runs in workers, the runner step does not (its files are not audited for --isolate).
test("unitStepArgs: --parallel only where the step sets it; unitStepEnv: an unset host tuple stays unset", () => {
  expect(UNIT_STEPS.map((s) => s.parallel)).toEqual([4, undefined]);
  expect(unitStepArgs({ name: "n", roots: ["a", "b"], junit: "j", parallel: 2 }, "/r/j.xml", 500)).toEqual(["test", "./a", "./b", "--parallel=2", "--timeout=500", "--reporter=junit", "--reporter-outfile=/r/j.xml"]);
  expect(unitStepArgs({ name: "n", roots: ["a"], junit: "j" }, "/r/j.xml")).toEqual(["test", "./a", "--timeout=60000", "--reporter=junit", "--reporter-outfile=/r/j.xml"]);
  expect(unitStepEnv("/d", undefined)).toEqual({ RUST_TS_REQUIRE_PROBES: "1", CI: "true", RUST_TS_DATA: "/d", RUST_TS_SUBJECT: "source" });
  expect(unitStepEnv("/d", "t")).toEqual({ RUST_TS_REQUIRE_PROBES: "1", CI: "true", RUST_TS_DATA: "/d", RUST_TS_SUBJECT: "source", RUST_TS_HOST_TUPLE: "t" });
});

test("alone files: workers leave them out by whole path, one process runs them; each is a test file under its step's roots", () => {
  const u = { name: "n", roots: ["a"], junit: "j.junit.xml", parallel: 2, alone: ["a/x.test.ts", "a/b/y.test.ts"] };
  expect(unitStepArgs(u, "/r/j.xml", 500)).toEqual(["test", "./a", "--parallel=2", "--path-ignore-patterns=a/x.test.ts", "--path-ignore-patterns=a/b/y.test.ts", "--timeout=500", "--reporter=junit", "--reporter-outfile=/r/j.xml"]);
  expect(aloneJunit(u)).toBe("j.alone.junit.xml");
  expect(aloneStepArgs(u, "/r/k.xml", 500)).toEqual(["test", "./a/x.test.ts", "./a/b/y.test.ts", "--isolate", "--timeout=500", "--reporter=junit", "--reporter-outfile=/r/k.xml"]);
  // No workers: the step runs every file in one process already, so nothing runs twice or is left out.
  expect(aloneStepArgs({ ...u, parallel: undefined }, "/r/k.xml")).toBeUndefined();
  expect(unitStepArgs({ ...u, parallel: undefined }, "/r/j.xml")).not.toContain("--path-ignore-patterns=a/x.test.ts");
  expect(aloneStepArgs({ ...u, alone: [] }, "/r/k.xml")).toBeUndefined();
  for (const s of UNIT_STEPS) {
    // The second report must not overwrite the first, nor another step's.
    if (s.alone?.length) expect(UNIT_STEPS.map((t) => t.junit)).not.toContain(aloneJunit(s));
    for (const f of s.alone ?? []) {
      expect(s.parallel).toBeDefined();
      expect(unitStepsOf(f)).toEqual([s.name]);
      expect(f).toMatch(/\.test\.ts$/);
      // A glob character would make --path-ignore-patterns match other paths, or none.
      expect(f).not.toMatch(/[*?[\]{}!]/);
      expect(existsSync(join(REPO, f))).toBe(true);
    }
  }
});
