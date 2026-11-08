// Unit tests of the gate's unit-test step as it runs (scripts/gate.ts `unitStaticStep`, `runStaticStep`; lane
// unit-parallel): with `--parallel`, the junit report and the ALLOWED_SKIPS check, a failing test, `CI=true`'s `.only`
// refusal, the per-test timeout, and the environment the workers see (RUST_TS_REQUIRE_PROBES=1, RUST_TS_DATA,
// RUST_TS_HOST_TUPLE). Each case runs `bun test` over a fixture tree in a temp dir. gate.ts loads
// scripts/lib/common.ts, so (as scripts/gate-probes.test.ts) it is loaded in a child process; see scripts/lib/deps.test.ts.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");

const CHILD = (tmp: string) => `
const { mkdirSync, readdirSync, readFileSync, writeFileSync } = await import("node:fs");
const { dirname, join } = await import("node:path");
const g = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const { DATA } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const { UNIT_STEPS } = await import(${JSON.stringify(join(REPO, "scripts/lib/unit-steps.ts"))});
const TMP = ${JSON.stringify(tmp)};
// Only the step's own environment may reach the workers: the child's copies are removed after the step is built.
process.env.RUST_TS_HOST_TUPLE = "tuple-under-test";
const strip = () => { for (const k of ["RUST_TS_DATA", "RUST_TS_HOST_TUPLE", "RUST_TS_REQUIRE_PROBES", "CI"]) delete process.env[k]; };
let n = 0;
const fixture = (files) => {
  const dir = join(TMP, "f" + ++n);
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  return dir;
};
const listing = (dir) => readdirSync(dir, { recursive: true }).map(String).sort();
// A test file that records its worker's pid, holds its worker long enough for the others to start, and checks the env.
const envFile = (name) => \`
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
test("env \${name}", async () => {
  writeFileSync(\${JSON.stringify(join(TMP, "pids"))} + "/\${name}." + process.pid, "");
  await Bun.sleep(400);
  expect([process.env.RUST_TS_REQUIRE_PROBES, process.env.CI, process.env.RUST_TS_DATA, process.env.RUST_TS_HOST_TUPLE]).toEqual(["1", "true", \${JSON.stringify(DATA)}, "tuple-under-test"]);
});
\`;
mkdirSync(join(TMP, "pids"));
const out = {};
const step = async (key, roots, files, opts = {}) => {
  const dir = fixture(files);
  const runDir = join(TMP, "run-" + key);
  mkdirSync(runDir);
  const steps = g.unitStaticSteps({ name: "unit tests", roots, junit: "u.junit.xml", parallel: 3, ...(opts.alone ? { alone: opts.alone } : {}) }, runDir, opts.timeoutMs).map((s) => ({ ...s, cwd: dir }));
  if (opts.noCi) for (const s of steps) delete s.env.CI;
  const before = listing(dir);
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  strip();
  const rs = [];
  try { for (const s of steps) rs.push(await g.runStaticStep(s)); } finally { console.log = log; }
  const junitFiles = (f) => [...new Set([...readFileSync(join(runDir, f), "utf8").matchAll(/<testsuite name="[^"]*" file="([^"]*)"/g)].map((m) => m[1]))].sort();
  out[key] = {
    names: steps.map((s) => s.name),
    pass: rs.map((r) => r.pass),
    skips: rs.map((r) => r.skips ?? null),
    lines,
    unchanged: JSON.stringify(listing(dir)) === JSON.stringify(before),
    junit: listing(runDir),
    files: listing(runDir).map(junitFiles),
  };
};
const PASS = 'import { expect, test } from "bun:test";\\ntest("passes", () => { expect(1).toBe(1); });\\n';
await step("ok", ["src", "tools"], {
  "src/a1.test.ts": envFile("a1"),
  "src/a2.test.ts": envFile("a2"),
  "tools/b.test.ts": envFile("b"),
  "src/rustc_span/source_map/tests.test.ts": 'import { test } from "bun:test";\\ntest.skip("read_binary_file_handles_lying_stat", () => {});\\n' + envFile("c"),
  "src/heavy.test.ts": envFile("h"),
  "tools/heavy2.test.ts": envFile("h2"),
}, { alone: ["src/heavy.test.ts", "tools/heavy2.test.ts"] });
out.pids = readdirSync(join(TMP, "pids")).sort();
await step("skip", ["src"], { "src/a.test.ts": PASS, "src/x.test.ts": 'import { test } from "bun:test";\\ntest.skip("not allowed", () => {});\\n' });
await step("fail", ["src"], { "src/a.test.ts": PASS, "src/f.test.ts": 'import { expect, test } from "bun:test";\\ntest("fails", () => { expect(1).toBe(2); });\\n' });
const ONLY = { "src/a.test.ts": PASS, "src/o.test.ts": 'import { expect, test } from "bun:test";\\ntest.only("only", () => {});\\ntest("other", () => { expect(1).toBe(1); });\\n' };
await step("only", ["src"], ONLY);
await step("onlyNoCi", ["src"], ONLY, { noCi: true });
await step("aloneFail", ["src"], { "src/a.test.ts": PASS, "src/f.test.ts": 'import { expect, test } from "bun:test";\\ntest("fails", () => { expect(1).toBe(2); });\\n' }, { alone: ["src/f.test.ts"] });
const SLOW = { "src/a.test.ts": PASS, "src/t.test.ts": 'import { test } from "bun:test";\\ntest("slow", async () => { await Bun.sleep(1500); });\\n' };
await step("timeout", ["src"], SLOW, { timeoutMs: 300 });
await step("inTime", ["src"], SLOW, { timeoutMs: 20000 });
process.env.RUST_TS_HOST_TUPLE = "tuple-under-test";
const real = UNIT_STEPS.flatMap((u) => g.unitStaticSteps(u, "/run"));
out.real = real.map((s) => ({ name: s.name, cmd: s.cmd.slice(1), env: s.env, junit: s.junit }));
out.alone = UNIT_STEPS[0].alone;
out.data = DATA;
console.log("RESULT " + JSON.stringify(out));
`;

test("the unit-test step under --parallel: report, skips, failures, .only, timeout and the workers' env", () => {
  const tmp = mkdtempSync(join(tmpdir(), "rust-ts-gate-unit-"));
  const data = mkdtempSync(join(tmpdir(), "rust-ts-gate-unit-data-"));
  try {
    const r = Bun.spawnSync([process.execPath, "-e", CHILD(tmp)], { cwd: REPO, stdout: "pipe", stderr: "pipe", env: { ...process.env, RUST_TS_DATA: data } });
    const text = r.stdout.toString() + r.stderr.toString();
    expect(r.exitCode, text).toBe(0);
    const line = text.split("\n").find((l) => l.startsWith("RESULT "));
    expect(line, text).toBeDefined();
    const j = JSON.parse(line!.slice("RESULT ".length));
    expect(j.data).toBe(data);
    // The real steps: src/tools in 4 workers without its alone files, then those files in one process; scripts/harness in
    // one process; the 60 s per-test timeout; the env.
    const env = { RUST_TS_REQUIRE_PROBES: "1", CI: "true", RUST_TS_DATA: data, RUST_TS_HOST_TUPLE: "tuple-under-test" };
    const alone: string[] = j.alone;
    expect(alone.length).toBeGreaterThan(0);
    const report = (f: string) => ["--timeout=60000", "--reporter=junit", `--reporter-outfile=/run/${f}`];
    expect(j.real).toEqual([
      { name: "unit tests", cmd: ["test", "./src", "./tools", "--parallel=4", ...alone.map((f) => `--path-ignore-patterns=${f}`), ...report("unit-tests.junit.xml")], env, junit: "/run/unit-tests.junit.xml" },
      { name: "unit tests (alone)", cmd: ["test", ...alone.map((f) => `./${f}`), "--isolate", ...report("unit-tests.alone.junit.xml")], env, junit: "/run/unit-tests.alone.junit.xml" },
      { name: "runner unit tests", cmd: ["test", "./scripts", "./harness", ...report("runner-unit-tests.junit.xml")], env, junit: "/run/runner-unit-tests.junit.xml" },
    ]);
    // Passing files over several workers, each seeing the step's env; the alone files once each, only in the second
    // report; the allowlisted skip is allowed; nothing written beside the tests.
    expect(j.ok.names).toEqual(["unit tests", "unit tests (alone)"]);
    expect<boolean[]>(j.ok.pass, j.ok.lines.join("\n")).toEqual([true, true]);
    expect(j.ok.skips).toEqual([{ allowed: [{ file: "src/rustc_span/source_map/tests.test.ts", path: ["read_binary_file_handles_lying_stat"] }], unexpected: [] }, { allowed: [], unexpected: [] }]);
    expect(j.ok.lines).toEqual([
      "ok    unit tests",
      "ok    unit test skips: 1 (1 allowlisted, 0 not allowed under RUST_TS_REQUIRE_PROBES=1)",
      "ok    unit tests (alone)",
      "ok    unit tests (alone) skips: 0 (0 allowlisted, 0 not allowed under RUST_TS_REQUIRE_PROBES=1)",
    ]);
    expect(j.ok.unchanged).toBe(true);
    expect(j.ok.junit).toEqual(["u.alone.junit.xml", "u.junit.xml"]);
    expect(j.ok.files).toEqual([["src/heavy.test.ts", "tools/heavy2.test.ts"], ["src/a1.test.ts", "src/a2.test.ts", "src/rustc_span/source_map/tests.test.ts", "tools/b.test.ts"]]);
    const pids = (names: string[]) => j.pids.filter((p: string) => names.includes(p.split(".")[0])).map((p: string) => p.split(".")[1]);
    expect(j.pids.map((p: string) => p.split(".")[0])).toEqual(["a1", "a2", "b", "c", "h", "h2"]);
    expect(new Set(pids(["a1", "a2", "b", "c"])).size).toBeGreaterThan(1);
    expect(new Set(pids(["h", "h2"])).size).toBe(1);
    // A skip not in ALLOWED_SKIPS fails the step, by name.
    expect(j.skip.pass).toEqual([false]);
    expect(j.skip.skips[0].unexpected).toEqual([{ file: "src/x.test.ts", path: ["not allowed"] }]);
    expect(j.skip.lines).toContain("  skipped: src/x.test.ts: not allowed");
    // A failing test fails the step, among the workers or alone.
    expect(j.fail.pass).toEqual([false]);
    expect(j.fail.lines[0]).toBe("ERROR: unit tests");
    // The report names it, wherever its worker's output landed.
    expect(j.fail.lines).toContain("  failed: src/f.test.ts: fails");
    expect(j.ok.lines.some((l: string) => l.startsWith("  failed:"))).toBe(false);
    expect(j.aloneFail.pass).toEqual([true, false]);
    expect(j.aloneFail.lines).toContain("ERROR: unit tests (alone)");
    // CI=true refuses a .only; the same tree without CI passes, so the refusal is what failed it.
    expect<boolean[]>(j.only.pass, j.only.lines.join("\n")).toEqual([false]);
    expect(j.only.lines[0]).toBe("ERROR: unit tests");
    expect<boolean[]>(j.onlyNoCi.pass, j.onlyNoCi.lines.join("\n")).toEqual([true]);
    // A test over the per-test timeout fails the step; with time enough it passes.
    expect(j.timeout.pass).toEqual([false]);
    expect(j.timeout.lines.join("\n")).toContain("timed out after 300ms");
    expect<boolean[]>(j.inTime.pass, j.inTime.lines.join("\n")).toEqual([true]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
}, 120_000);
