// M8a's suites' definitions (harness/suites.ts; plan-m8 §4, §6, D8, D15, D19, D20, D23; lane harness-m8a-build), in a child process (it loads
// scripts/lib/common.ts; see scripts/lib/deps.test.ts for why). No suite runs here: the cargo builds wait on the host (D20), and their
// harness is tested in scripts/lib/cargo-project-build.test.ts.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

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
  // The source tree and the unpacked crates (review harness-m8a-build N6), as rg-build keys ripgrep's.
  expect(j.build.inputDirs).toEqual([expect.stringMatching(/^cargo-[0-9a-f]{40}$/), "cargo-home/registry/src"]);
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

/**
 * Modules the project-build suites' commands load that need not be in an oracle key, with why: they do not shape a suite's output, or
 * another key part covers what they read. Everything else a command loads must be in its suite's `ORACLE_KEY_FILES`.
 */
const UNKEYED: Record<string, string> = {
  "scripts/lib/common.ts": "paths, hashing, process helpers",
  "scripts/lib/env.ts": "difftest's environment merge; the harness sets its own",
  "scripts/lib/case-lock.ts": "locking only",
  "scripts/lib/host-state.ts": "host readers for the preconditions and the watchdog, which print no report",
  "scripts/lib/oracle.ts": "finds the oracle toolchain; its build is keyed by rustcDriverHash",
  "scripts/lib/toolchain.ts": "the oracle toolchain's checks, under lib/oracle.ts",
  "scripts/lib/tool-oracles.ts": "clippy/rustfmt oracles, under lib/oracle.ts; not run here",
  "scripts/lib/llvm-tools.ts": "the port's pinned LLVM tools, keyed in the port's binary key (portInputs)",
  "scripts/rg-check.ts": "ripgrep's setup and paths; its Cargo.lock and sources are keyed (binKey, inputDirs)",
  "scripts/tools-src.ts": "cargo's setup and paths; the pinned commit is a key part",
  "scripts/lib/tools-src.ts": "cargo's pin, read for the commit, which is a key part",
};

/** Every repo module `entries` load, transitively, by their relative imports (as scripts/cargo-project-build.ts `portInputs` finds them). */
function importClosure(entries: string[]): string[] {
  const seen = new Set<string>();
  const todo = entries.map((f) => resolve(REPO, f));
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const m of readFileSync(f, "utf8").matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["'](\.{1,2}\/[^"']+)["']/gm)) {
      const g = resolve(dirname(f), m[1]!);
      if (existsSync(g)) todo.push(g);
    }
  }
  return [...seen].map((f) => relative(REPO, f)).sort();
}

test("every module a project-build suite's command loads is in its oracle key, or named harmless (review harness-m8a-build N1)", () => {
  const code = `
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const fake = { id: "new", file: "", args: [] };
console.log(JSON.stringify(Object.fromEntries(Object.keys(s.ORACLE_KEY_FILES).map((n) => [n, { script: s.suite(n).oracle([fake])[1], files: s.ORACLE_KEY_FILES[n]() }]))));
`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, stdout: "pipe", stderr: "pipe", env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!) as Record<string, { script: string; files: string[] }>;
  expect(Object.keys(j).sort()).toEqual(["cargo-build", "cargo-smoke", "rg-behaviour", "rg-behaviour-rgtest", "rg-build"]);
  const missing: string[] = [];
  for (const [name, { script, files }] of Object.entries(j)) {
    const entries = [relative(REPO, script)];
    // A command that builds (directly, or through `ensureBinary`) also runs the `RUSTC` wrapper, which cargo starts.
    if (importClosure(entries).includes("scripts/cargo-project-build.ts")) entries.push("scripts/cargo-project-build-rustc.ts");
    const keyed = new Set(files.map((f) => relative(REPO, f)));
    for (const m of importClosure(entries)) if (!keyed.has(m) && UNKEYED[m] === undefined) missing.push(`${name}: ${m}`);
  }
  expect(missing).toEqual([]);
  // The modules lane harness-m8a-build's split made, named: each keyed by every suite whose output it shapes.
  const has = (n: string, f: string) => j[n]!.files.some((x) => x.endsWith(f));
  for (const n of ["rg-behaviour", "rg-behaviour-rgtest"]) expect(has(n, "scripts/lib/rg-behaviour.ts")).toBe(true);
  for (const n of Object.keys(j)) expect(has(n, "scripts/lib/cargo-project-build.ts")).toBe(true);
  expect(has("cargo-smoke", "scripts/lib/cargo-smoke.ts")).toBe(true);
  // An entry of UNKEYED that nothing loads any more is stale.
  const loaded = new Set(Object.values(j).flatMap(({ script }) => importClosure([relative(REPO, script), "scripts/cargo-project-build-rustc.ts"])));
  expect(Object.keys(UNKEYED).filter((m) => !loaded.has(m))).toEqual([]);
}, 60_000);
