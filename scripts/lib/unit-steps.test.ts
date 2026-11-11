// Unit tests of scripts/lib/unit-steps.ts (lane harness-w35): every test file of the repo runs in exactly one of the
// gate's unit-test processes (review gate-runner-unit N4).
import { expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { UNIT_ENV_REFUSED, UNIT_STEPS, aloneJunit, aloneStepArgs, unitEnvRefusal, unitStepArgs, unitStepEnv, unitStepsOf } from "./unit-steps.ts";

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

/**
 * Runner test files that load scripts/lib/common.ts in the runner step's process, on purpose: deps.test.ts sets its temp
 * RUST_TS_DATA before its dynamic import of it (see the header of scripts/lib/unit-steps.ts).
 */
const COMMON_LOADERS = ["scripts/lib/deps.test.ts"];

/**
 * The runner test files that load `target` in the test process: through the file's own imports of any kind (static, side-effect,
 * `export ... from`, dynamic, `require`), since its tests run there, and then through the static imports of every module reached.
 * Type-only imports are not loads (Bun's scanner drops them). A lazy import inside a module's function is not followed.
 */
function runnerLoadersOf(target: string): { loaders: string[]; files: number; modules: number } {
  const scan = new Bun.Transpiler({ loader: "ts" });
  const resolveFrom = (spec: string, from: string): string | undefined => {
    if (!spec.startsWith(".")) return undefined;
    try {
      return Bun.resolveSync(spec, dirname(from));
    } catch {
      return undefined;
    }
  };
  const importsOf = (f: string) => scan.scanImports(readFileSync(f, "utf8"));
  const r = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard", "--", ...BUN_TEST_PATTERNS], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  const files = r.stdout.toString().split("\n").filter((f) => f && unitStepsOf(f).includes("runner unit tests"));
  const modules = new Set<string>();
  const loaders: string[] = [];
  for (const rel of files) {
    const seen = new Set<string>();
    const reaches = (f: string, own: boolean): boolean => {
      if (f === target) return true;
      if (seen.has(f) || !/\.[cm]?[jt]sx?$/.test(f)) return false;
      seen.add(f);
      modules.add(f);
      return importsOf(f).some((i) => (own || i.kind === "import-statement") && ((p) => p !== undefined && reaches(p, false))(resolveFrom(i.path, f)));
    };
    if (reaches(join(REPO, rel), true)) loaders.push(rel);
  }
  return { loaders: loaders.sort(), files: files.length, modules: modules.size };
}

// The gate runs the runner test files one after another in one process, where the first module to load scripts/lib/common.ts
// fixes RUST_TS_DATA for every later file (scripts/lib/deps.test.ts's "uses a temp oracle cache" failed when one did, lane
// scope-m7). So no runner test file may load it but the allowlisted ones, today's and every file added later (review scope-m7 N4).
test("no runner test file loads scripts/lib/common.ts in the step's process, but COMMON_LOADERS", () => {
  const { loaders, files, modules } = runnerLoadersOf(join(REPO, "scripts", "lib", "common.ts"));
  expect(files).toBeGreaterThan(40);
  expect(modules).toBeGreaterThan(files);
  expect(loaders).toEqual(COMMON_LOADERS);
});

// Lane unit-parallel: the src/tools step runs in workers, the runner step does not (its files are not audited for --isolate).// Lane unit-parallel: the src/tools step runs in workers, the runner step does not (its files are not audited for --isolate).
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

// Review root-w47-check N3: the unit steps' RUST_TS_SUBJECT is the harness's default mode. scripts/lib/subject-bin.ts loads
// scripts/lib/common.ts, which this file must not (see the header of unit-steps.ts), so a child reads it.
test("unitStepEnv's RUST_TS_SUBJECT is DEFAULT_SUBJECT_MODE (scripts/lib/subject-bin.ts)", () => {
  const code = `const m = await import(${JSON.stringify(join(REPO, "scripts/lib/subject-bin.ts"))}); console.log("MODE " + m.DEFAULT_SUBJECT_MODE);`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, stdout: "pipe", stderr: "pipe", env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const line = r.stdout.toString().split("\n").find((l) => l.startsWith("MODE "));
  expect(line, r.stdout.toString()).toBeDefined();
  expect(unitStepEnv("/d", undefined).RUST_TS_SUBJECT).toBe(line!.slice("MODE ".length));
});

// Review root-w47-check N1, N2.
test("unitEnvRefusal: each refused variable refuses, set to anything (even \"\"), and is named with its reason; nothing else refuses", () => {
  expect(unitEnvRefusal({})).toBeUndefined();
  expect(unitEnvRefusal({ PATH: "/bin", RUST_TS_SUBJECT: "binary", RUST_TS_AGENT: "a", DUMP: "1", CI: "true" })).toBeUndefined();
  expect(Object.keys(UNIT_ENV_REFUSED)).toEqual(expect.arrayContaining(["RUST_TS_IMPL", "REGEN", "RUST_TS_WRITE_ORACLE", "TYREPR_WRITE", "TYPRINT_WRITE", "TYCONSTS_WRITE"]));
  for (const [k, why] of Object.entries(UNIT_ENV_REFUSED)) {
    for (const v of ["1", ""]) {
      const r = unitEnvRefusal({ [k]: v, PATH: "/bin" });
      expect(r).toStartWith(`${k}=${v} set: every unit test would inherit it (${k}: ${why}); `);
      expect(r).toEndWith("unset it and re-run the gate");
    }
  }
  const two = unitEnvRefusal({ RUST_TS_IMPL: "shim", REGEN: "1" })!;
  expect(two).toStartWith("RUST_TS_IMPL=shim and REGEN=1 set: ");
});

/** An environment object: `process.env`, `Bun.env`, `import.meta.env`. */
const ENV_OBJ = String.raw`(?:process\.env|Bun\.env|import\.meta\.env)\b`;
const NAME = String.raw`[A-Za-z_][A-Za-z0-9_]*`;
/**
 * The variables a file reads by name: `<env>.X`, `<env>["X"]` and the keys of a destructuring `{ X, Y: y, ...rest } = <env>`
 * (`<env>` any of ENV_OBJ), and `var_os("X")` (review harness-w48 N1).
 */
const envReads = (text: string): string[] => {
  const names = [...text.matchAll(new RegExp(String.raw`${ENV_OBJ}(?:\.(${NAME})|\[\s*["'\`](${NAME})["'\`]\s*\])|\bvar_os\(\s*"(${NAME})"\s*\)`, "g"))].map((m) => (m[1] ?? m[2] ?? m[3])!);
  for (const m of text.matchAll(new RegExp(String.raw`\{([^{}]*)\}\s*=\s*${ENV_OBJ}`, "g"))) {
    for (const entry of m[1]!.split(",")) {
      const key = entry.trim().split(/\s*[:=]\s*/)[0]!;
      if (new RegExp(`^${NAME}$`).test(key)) names.push(key);
    }
  }
  return names;
};
/**
 * The reads the scan cannot name: `<env>[expr]` with a computed key, a computed key in a destructuring (`{ [k]: v } = <env>`),
 * and the environment object itself assigned to a name (`const e = process.env`, which is then read by any key). A spread copy
 * (`{ ...process.env }`) is no read: it hands every variable to a child, which the scan of the child's code covers.
 */
const unnamedEnvReads = (text: string): string[] => [
  ...[...text.matchAll(new RegExp(String.raw`${ENV_OBJ}\[\s*(?!["'\`]${NAME}["'\`]\s*\])[^\]]*\]`, "g"))].map((m) => m[0]),
  ...[...text.matchAll(new RegExp(String.raw`\{[^{}]*\[[^{}]*\}\s*=\s*${ENV_OBJ}`, "g"))].map((m) => m[0]),
  ...[...text.matchAll(new RegExp(String.raw`\b${NAME}\s*=\s*${ENV_OBJ}\s*(?:[;,)\n]|$)`, "gm"))].map((m) => m[0].trim()),
];

/**
 * The test files that read the environment by a key the scan cannot name (`unnamedEnvReads`), and why no value from the gate's
 * environment can make one of their tests pass falsely. A new one fails the test below until it is named here.
 */
const UNIT_ENV_UNNAMED: Record<string, string> = {
  "scripts/gate-unit.test.ts": "deletes the variables of a literal list (RUST_TS_DATA, RUST_TS_HOST_TUPLE, RUST_TS_REQUIRE_PROBES, CI) before its steps run",
  "src/std/env.test.ts": "reads, sets and deletes a variable named by the test itself, unset before it starts",
  "src/vendor/anstyle_query/lib.test.ts": "saves, sets and restores its own literal list VARS (TERM, NO_COLOR, CLICOLOR, CLICOLOR_FORCE, COLORTERM, all named harmless)",
  "tools/probes/fixtures.test.ts": "a child it starts prints MIRI_BE_RUSTC, MIRI_LOG, RUSTC_LOG and RUSTUP_HOME, a literal list, to check they are scrubbed",
};

/**
 * Every other variable a test file reads by name, and why a value from the gate's environment cannot make a test pass that
 * should fail. A new one fails the test below until it is put here or in `UNIT_ENV_REFUSED`.
 */
const UNIT_ENV_HARMLESS: Record<string, string> = {
  RUST_TS_REQUIRE_PROBES: "set by the unit step (unitStepEnv)",
  RUST_TS_DATA: "set by the unit step (unitStepEnv)",
  RUST_TS_HOST_TUPLE: "set by the unit step from the gate's own (unitStepEnv); host-specific tests skip, and skips are checked",
  CI: "set by the unit step (unitStepEnv)",
  RUST_TS_AGENT: "names work directories only",
  TMPDIR: "where temp files go",
  HOME: "where temp files and the cargo registry are found",
  PATH: "where programs are found; a missing one fails a test",
  CARGO_HOME: "where the cargo registry's crate sources are read from; a wrong one fails a test",
  TERM: "set by the test itself (src/vendor/anstyle_query/lib.test.ts)",
  NO_COLOR: "set by the test itself (src/vendor/anstyle_query/lib.test.ts)",
  CLICOLOR: "set by the test itself (src/vendor/anstyle_query/lib.test.ts)",
  CLICOLOR_FORCE: "set by the test itself (src/vendor/anstyle_query/lib.test.ts)",
  COLORTERM: "set by the test itself (src/vendor/anstyle_query/lib.test.ts)",
  BUN_JSC_maxPerThreadStackUsage: "removed or set by the tests themselves; a binary-mode gate refuses BUN_JSC_* (scripts/lib/subject-bin.ts binaryModeRefusal)",
  BUN_JSC_useTailCalls: "the test expects what the variable selects (src/rust_ts/track_caller.test.ts)",
  CARGO_CRATE_NAME: "the test expects what the variable selects (src/rustc_session/diagnostics.test.ts)",
  RUSTC_FORCE_RUSTC_VERSION: "the test fails while it is set (src/rustc_span/stable_hash.oracle.test.ts)",
  RUST_TS_X86_TEST_TIMEOUT_MS: "a per-test limit: a lower one can only fail a test",
  DUMP: "prints the results too (src/rustc_mir_dataflow/impls/impls.test.ts)",
  ANNOTATE_DUMP: "writes each comparison under $RUST_TS_DATA/tmp too (src/vendor/annotate_snippets/oracle.test.ts)",
  MTP_DEBUG: "writes the port's output to the test's work directory too (src/rustc_mir_transform/promote_consts.test.ts)",
  MIRI_TEMP: "read by a stub the test writes and starts with it set (scripts/lib/case-lock.test.ts)",
  FD_OUT: "read by a child the test writes and starts with it set (src/vendor/termize/lib.test.ts)",
  IR_SIDES_TMP: "read by a child the test writes and starts with it set (scripts/ir-sides.test.ts)",
  RETRY_TMP: "read by a child the test writes and starts with it set (scripts/retry-times.test.ts)",
  RMETA_SPLIT_TMP: "read by a child the test writes and starts with it set (scripts/rmeta-split.test.ts)",
  SPLIT_RUN_TMP: "read by a child the test writes and starts with it set (scripts/split-run.test.ts)",
  BUCKETS_TMP: "read by a child the test writes and starts with it set (scripts/unported-buckets.test.ts)",
  FAKE_EXIT: "read by a stub the test writes and starts with it set (scripts/rmeta-run.test.ts)",
  FAKE_PROBE_EXIT: "read by a stub the test writes and starts with it set (scripts/rmeta-run.test.ts)",
  RUSTUP_HOME: "set by the test's child itself (scripts/miri.test.ts)",
  CLAUDECODE: "set by the test's child itself (scripts/gate-unit.test.ts); Bun's output only (unit-steps.ts BUN_QUIET_VARS)",
  AGENT: "set by the test's child itself (scripts/gate-unit.test.ts); Bun's output only (unit-steps.ts BUN_QUIET_VARS)",
  NODE_ENV: "left out of the environment the test gives the gate it starts (scripts/gate-power.test.ts, gate-probes.test.ts); the gate refuses to start with it set (gate.ts freezeEnvRefusal)",
  RUST_TS_FREEZE_LISTS: "left out of the environment the test gives the gate it starts (scripts/gate-power.test.ts, gate-probes.test.ts); the gate refuses to start with it set (gate.ts freezeEnvRefusal)",
};

/** Every tracked or untracked-not-ignored file under `roots` matching `pattern` (a pathspec, where `*` matches `/` too). */
const repoFiles = (roots: string[], pattern: string): string[] => {
  const r = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard", "--", ...roots.map((d) => `${d}/${pattern}`)], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  return r.stdout.toString().split("\n").filter(Boolean).filter((f) => existsSync(join(REPO, f)));
};

test("every variable a test file reads by name is refused at the gate's start or named harmless here", () => {
  expect(envReads(`process.env.A_1; process.env["B"]; var_os("C"); process.env.BUN_JSC_x`)).toEqual(["A_1", "B", "C", "BUN_JSC_x"]);
  // Bun.env, import.meta.env and destructuring (review harness-w48 N1); a rest element or a spread copy names nothing.
  expect(envReads(`Bun.env.D; Bun.env['E']; import.meta.env.F; const { G, H: h, I = "x", ...rest } = process.env; const { J } = Bun.env; f({ ...process.env })`)).toEqual(["D", "E", "F", "G", "H", "I", "J"]);
  expect(unnamedEnvReads(`process.env.A; process.env["B"]; ({ ...process.env }); const { C } = process.env;`)).toEqual([]);
  expect(unnamedEnvReads(`process.env[k]; Bun.env[\`X_\${s}\`]; const { [k]: v } = process.env; const e = Bun.env;\nx = import.meta.env\n`)).toEqual(["process.env[k]", "Bun.env[`X_${s}`]", "{ [k]: v } = process.env", "e = Bun.env;", "x = import.meta.env"]);
  // This file's own samples above are not reads.
  const files = repoFiles(UNIT_STEPS.flatMap((u) => u.roots), "*.test.ts").filter((f) => f !== "scripts/lib/unit-steps.test.ts");
  expect(files.length).toBeGreaterThan(100);
  const seen = new Map<string, string>();
  for (const f of files) for (const k of envReads(readFileSync(join(REPO, f), "utf8"))) if (!seen.has(k)) seen.set(k, f);
  // The ones the review found are among them, so the scan sees them.
  for (const k of ["REGEN", "RUST_TS_IMPL", "RUST_TS_WRITE_ORACLE", "TYREPR_WRITE"]) expect(seen.has(k)).toBe(true);
  const unknown = [...seen].filter(([k]) => !(k in UNIT_ENV_REFUSED) && !(k in UNIT_ENV_HARMLESS)).map(([k, f]) => `${k} (${f})`);
  expect(unknown).toEqual([]);
  for (const k of Object.keys(UNIT_ENV_HARMLESS)) expect(k in UNIT_ENV_REFUSED).toBe(false);
  // Reads the scan cannot name are only in the files listed, and each listed file still has one.
  const unnamed = files.filter((f) => unnamedEnvReads(readFileSync(join(REPO, f), "utf8")).length > 0).sort();
  expect(unnamed).toEqual(Object.keys(UNIT_ENV_UNNAMED).sort());
});

// A fixture writer that a test reaches through a helper module (src/rust_ts/typeck_oracle_fixtures.ts reads REGEN) is no test file.
test("every fixture-writer variable (REGEN, BLESS, UPDATE, *_WRITE, ...) read anywhere in the repo is refused at the gate's start", () => {
  // `_PROBE` as a suffix only: a `<X>_PROBE` switch compares with a probe instead of a checked-in fixture (TYREPR_PROBE, review
  // harness-w48 N2); FAKE_PROBE_EXIT (a stub's exit code) and RUST_TS_REQUIRE_PROBES are no such switch.
  const writer = /^(REGEN|BLESS|UPDATE|OVERWRITE)$|(^|_)(REGEN|BLESS|UPDATE|WRITE|OVERWRITE|RECORD|SNAPSHOT)(_|$)|_PROBE$/;
  expect(["REGEN", "TYREPR_WRITE", "RUST_TS_WRITE_ORACLE", "UPDATE_EXPECT", "X_BLESS", "TYREPR_PROBE", "X_PROBE"].every((k) => writer.test(k))).toBe(true);
  expect(["RUST_TS_DATA", "WRITER", "REGENERATE_X", "FAKE_PROBE_EXIT", "RUST_TS_REQUIRE_PROBES", "PROBE"].some((k) => writer.test(k))).toBe(false);
  const found = new Map<string, string>();
  for (const f of repoFiles(["src", "tools", "scripts", "harness"], "*.ts")) for (const k of envReads(readFileSync(join(REPO, f), "utf8"))) if (writer.test(k) && !found.has(k)) found.set(k, f);
  expect(found.get("REGEN")).toBeDefined();
  expect(found.get("TYREPR_PROBE")).toBeDefined();
  expect([...found].filter(([k]) => !(k in UNIT_ENV_REFUSED)).map(([k, f]) => `${k} (${f})`)).toEqual([]);
});
