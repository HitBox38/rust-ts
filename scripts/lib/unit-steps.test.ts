// Unit tests of scripts/lib/unit-steps.ts (lane harness-w35): every test file of the repo runs in exactly one of the
// gate's unit-test processes (review gate-runner-unit N4).
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { UNIT_STEPS, unitStepsOf } from "./unit-steps.ts";

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

test("every test file of the repo (tracked or not ignored) runs in exactly one unit-test process", () => {
  const r = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard", "--", "*.test.ts"], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const files = r.stdout.toString().split("\n").filter(Boolean);
  expect(files.length).toBeGreaterThan(0);
  const bad = files.map((f) => ({ f, steps: unitStepsOf(f) })).filter((x) => x.steps.length !== 1);
  expect(bad).toEqual([]);
});
