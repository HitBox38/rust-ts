// M8a's suites' definitions (harness/suites.ts; plan-m8 §4, §6, D8, D15, D19, D20, D23; lane harness-m8a-build), in a child process (it loads
// scripts/lib/common.ts; see scripts/lib/deps.test.ts for why). No suite runs here: the cargo builds wait on the host (D20), and their
// harness is tested in scripts/lib/cargo-project-build.test.ts.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");

test("M8a's suites: never protected, headroom and order, their commands, keys and marks", () => {
  const code = `
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const g = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const d = await import(${JSON.stringify(join(REPO, "scripts/difftest.ts"))});
const { SMOKE_STEPS, smokeDir } = await import(${JSON.stringify(join(REPO, "scripts/cargo-smoke.ts"))});
const get = (n) => s.suite(n);
const fake = { id: "new", file: "", args: [] };
const shape = (n) => { const x = get(n); return [x.mode, x.milestone, typeof x.neverProtect, x.headroom ?? null, x.runFirst ?? null, x.heavy?.rssBudgetMb ?? null, x.criterion?.percent ?? null]; };
const fakeSuites = { a: {}, h: { heavy: { rssBudgetMb: 1 } }, f: { runFirst: true, heavy: { rssBudgetMb: 1 } }, b: {}, f2: { runFirst: true } };
console.log(JSON.stringify({
  shapes: { "cargo-build": shape("cargo-build"), "cargo-smoke": shape("cargo-smoke"), "rg-build": shape("rg-build") },
  neverProtect: get("cargo-build").neverProtect,
  build: { oracle: get("cargo-build").oracle([fake]).slice(1), subject: get("cargo-build").subject([fake]).slice(1), inputDirs: get("cargo-build").inputDirs, cwd: get("cargo-build").cwd },
  smoke: { oracle: get("cargo-smoke").oracle([fake]).slice(1), subject: get("cargo-smoke").subject([fake]).slice(1), lock: get("cargo-smoke").caseLock(fake), dir: smokeDir("new") },
  steps: SMOKE_STEPS.map((x) => x.id),
  keys: [get("cargo-build").oracleKey(), get("cargo-smoke").oracleKey(), get("rg-build").oracleKey()],
  undeclared: ["cargo-build", "cargo-smoke"].flatMap((n) => g.undeclaredRuns(get(n))),
  runs: ["cargo-build", "cargo-smoke"].map((n) => g.oracleRuns(get(n).oracle([fake]))),
  marks: ["cargo-build", "cargo-smoke", "rg-build"].map((n) => d.oracleUnstableReason(get(n), "x\\ncargo-harness: no result: the build was stopped: watchdog\\n") ?? null),
  order: [g.gateSuiteOrder(["a", "h", "f", "b", "f2"], false, (n) => fakeSuites[n]), g.gateSuiteOrder(["a", "h", "f", "b", "f2"], true, (n) => fakeSuites[n])],
  realOrder: g.gateSuiteOrder(["parse", "rg-build", "cargo-smoke", "cargo-build", "lex"], false),
}));
`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, stdout: "pipe", stderr: "pipe", env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
  expect(r.exitCode, r.stderr.toString() + r.stdout.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  // D19, D23: both are reports, never protected, with no baseline file; cargo-build has D20's heavy-build row and runs first (D20).
  expect(j.shapes).toEqual({
    "cargo-build": ["single", "M8", "string", "heavy-build", true, 14 * 1024, 100],
    "cargo-smoke": ["single", "M8", "string", null, null, null, 100],
    "rg-build": ["single", "M7", "undefined", null, null, 12 * 1024, 100],
  });
  expect(j.neverProtect).toContain("D23");
  for (const n of ["cargo-build", "cargo-smoke"]) expect(existsSync(join(REPO, "harness/baseline", `${n}.txt`))).toBe(false);
  // cargo-build: the project-build harness, project cargo; the source tree as its input directory.
  expect(j.build.oracle[0]).toEndWith("scripts/cargo-project-build.ts");
  expect(j.build.oracle.slice(1, 7)).toEqual(["run", "--project", "cargo", "--side", "oracle", "--"]);
  expect(j.build.oracle[7]).toMatch(/\/bin\/rustc$/);
  expect(j.build.subject.slice(1, 7)).toEqual(["run", "--project", "cargo", "--side", "subject", "--"]);
  expect(j.build.subject.join(" ")).toMatch(/src\/rust_ts\/main\.ts --sysroot \/\S+$/);
  expect(j.build.inputDirs).toEqual([expect.stringMatching(/^cargo-[0-9a-f]{40}$/)]);
  expect(j.build.cwd).toEndWith("/cargo-src");
  // cargo-smoke: one case per step, both sides in one directory under one lock, outside any repository.
  expect(j.steps).toEqual(["version", "version-verbose", "new", "build", "run", "test", "build-release", "metadata", "tree", "clean", "rg-check", "rg-tree"]);
  expect(j.smoke.oracle[0]).toEndWith("scripts/cargo-smoke.ts");
  expect(j.smoke.oracle.slice(1, 7)).toEqual(["--step", "new", "--side", "oracle", "--dir", j.smoke.dir]);
  expect(j.smoke.subject.slice(1, 7)).toEqual(["--step", "new", "--side", "subject", "--dir", j.smoke.dir]);
  expect(j.smoke.lock).toBe(`${j.smoke.dir}.case.lock`);
  expect(j.smoke.dir).toMatch(/\/rust-ts-cargo-smoke\/[0-9a-f]{16}$/);
  for (const k of j.keys) expect(k).toMatch(/^[0-9a-f]{40,64}$/);
  expect(new Set(j.keys).size).toBe(3);
  // gate.ts's probe check: each runs the oracle rustc (through the cargo it built) and nothing undeclared.
  expect(j.undeclared).toEqual([]);
  expect(j.runs).toEqual([["rustc"], ["rustc"]]);
  // The cargo mark is never cached (UNSTABLE), and only by the cargo suites.
  const why = "detected: the cargo harness had no result: the build was stopped: watchdog";
  expect(j.marks).toEqual([why, why, null]);
  // The gate's order: runFirst suites, then the rest, then the heavy ones; --skip-heavy drops a heavy runFirst suite too.
  expect(j.order).toEqual([
    ["f", "f2", "a", "b", "h"],
    ["f2", "a", "b"],
  ]);
  expect(j.realOrder).toEqual(["cargo-build", "parse", "cargo-smoke", "lex", "rg-build"]);
}, 60_000);
