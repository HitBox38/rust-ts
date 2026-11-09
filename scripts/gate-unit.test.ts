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
// As when the gate runs from an AI agent's shell, which makes bun test quiet (scripts/lib/unit-steps.ts BUN_QUIET_VARS); the
// one-process passes unset them, the workers keep them.
process.env.CLAUDECODE = "1";
process.env.AGENT = "1";
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
  const steps = g.unitStaticSteps({ name: "unit tests", roots, junit: "u.junit.xml", ...(opts.oneProcess ? {} : { parallel: 3 }), ...(opts.alone ? { alone: opts.alone } : {}) }, runDir, opts.timeoutMs).map((s) => ({ ...s, cwd: dir, ...(opts.slowNoteS === undefined ? {} : { slowNoteS: opts.slowNoteS }) }));
  if (opts.noCi) for (const s of steps) delete s.env.CI;
  const before = listing(dir);
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  strip();
  const rs = [];
  try { for (const s of steps) rs.push(await g.runStaticStep(s)); } finally { console.log = log; }
  const junitFiles = (f) => [...new Set([...readFileSync(join(runDir, f), "utf8").matchAll(/<testsuite name="[^"]*" file="([^"]*)"/g)].map((m) => m[1]))].sort();
  // The slowest-test lines carry times that vary: they are compared with the time masked.
  const timed = (l) => l.replace(/\\(\\d+\\.\\d s\\)/, "(T s)");
  out[key] = {
    names: steps.map((s) => s.name),
    pass: rs.map((r) => r.pass),
    skips: rs.map((r) => r.skips ?? null),
    lines: lines.map(timed),
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
// A file that throws at load is not in the junit report; the step names it from bun's output, among the workers or alone.
const LOADS = { "src/a.test.ts": PASS, "src/bad.test.ts": 'import { test } from "bun:test";\\nthrow new Error("boom at load");\\ntest("never", () => {});\\n', "src/imp.test.ts": 'import { test } from "bun:test";\\nimport "./nope.ts";\\ntest("never", () => {});\\n' };
await step("load", ["src"], LOADS);
await step("aloneLoad", ["src"], LOADS, { alone: ["src/bad.test.ts"] });
// process.exit(0) in the alone pass: bun exits 0 and writes no report; the step must not print ok first.
await step("aloneExit0", ["src"], { "src/a.test.ts": PASS, "src/x.test.ts": 'import { test } from "bun:test";\\ntest("exits", () => { process.exit(0); });\\n' }, { alone: ["src/x.test.ts"] });
// A non-zero exit, an abort at load, and an exit in a pass without workers: the file is named by the last file name Bun printed (review harness-w45 N1).
const EXITS = { "src/a.test.ts": PASS, "src/x.test.ts": 'import { test } from "bun:test";\\ntest("before", () => {});\\ntest("exits", () => { process.exit(1); });\\n', "src/y.test.ts": 'process.abort();\\n', "src/z.test.ts": PASS };
await step("aloneExit1", ["src"], { "src/a.test.ts": PASS, "src/x.test.ts": EXITS["src/x.test.ts"], "src/z.test.ts": PASS }, { alone: ["src/x.test.ts", "src/a.test.ts"] });
await step("aloneAbort", ["src"], { "src/a.test.ts": PASS, "src/b.test.ts": PASS, "src/y.test.ts": EXITS["src/y.test.ts"], "src/z.test.ts": PASS }, { alone: ["src/a.test.ts", "src/y.test.ts", "src/z.test.ts"] });
await step("oneExit", ["src"], { "src/a.test.ts": PASS, "src/x.test.ts": EXITS["src/x.test.ts"], "src/z.test.ts": PASS }, { oneProcess: true });
// Every report prints its slowest test, and one over the step's note threshold is a note (here 0.3 s, as 30 s is too slow to test).
const SLOWISH = { "src/a.test.ts": PASS, "src/s.test.ts": 'import { test } from "bun:test";\\ntest("slowish", async () => { await Bun.sleep(600); });\\n' };
await step("slowNote", ["src"], SLOWISH, { slowNoteS: 0.3, alone: ["src/a.test.ts"] });
await step("slowAloneNote", ["src"], SLOWISH, { slowNoteS: 0.3, alone: ["src/s.test.ts"] });
// A step that fails and leaves a clean report and no file in its output: the step says that nothing is named.
{
  const runDir = join(TMP, "run-nameless");
  mkdirSync(runDir);
  const junit = join(runDir, "n.junit.xml");
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  let r;
  try {
    r = await g.runStaticStep({ name: "unit tests", cmd: [process.execPath, "-e", \`require("node:fs").writeFileSync(\${JSON.stringify(junit)}, '<testsuites name="bun test" tests="0" failures="0" skipped="0"></testsuites>'); process.exit(3);\`], env: {}, junit });
  } finally { console.log = log; }
  out.nameless = { pass: r.pass, lines };
}
// A step without a report: its note: lines are printed and returned when it passes (review root-w44-check N1), and when it
// fails, those the tail did not show; its pass is its exit code alone.
{
  const noteStep = async (code, extra) => {
    const lines = [];
    const log = console.log;
    console.log = (...a) => lines.push(a.join(" "));
    let r;
    try {
      r = await g.runStaticStep({ name: "frozen lists", cmd: [process.execPath, "-e", \`console.log("frozen lists: 48/48"); console.log("note: frozen lists: the latest accepted gate run's gate.json is missing"); console.error("note: second"); \${extra} process.exit(\${code});\`], env: {} });
    } finally { console.log = log; }
    return { pass: r.pass, notes: r.notes, lines };
  };
  out.notesPass = await noteStep(0, "");
  out.notesFail = await noteStep(1, 'for (let i = 0; i < 20; i++) console.log("line " + i);');
  out.notesFailTail = await noteStep(1, "");
}
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
    // The one-process passes unset the variables that make bun test quiet (review harness-w45 N1).
    const oneEnv = { ...env, CLAUDECODE: null, AGENT: null, REPL_ID: null };
    const alone: string[] = j.alone;
    expect(alone.length).toBeGreaterThan(0);
    const report = (f: string) => ["--timeout=60000", "--reporter=junit", `--reporter-outfile=/run/${f}`];
    expect(j.real).toEqual([
      { name: "unit tests", cmd: ["test", "./src", "./tools", "--parallel=4", ...alone.map((f) => `--path-ignore-patterns=${f}`), ...report("unit-tests.junit.xml")], env, junit: "/run/unit-tests.junit.xml" },
      { name: "unit tests (alone)", cmd: ["test", ...alone.map((f) => `./${f}`), "--isolate", ...report("unit-tests.alone.junit.xml")], env: oneEnv, junit: "/run/unit-tests.alone.junit.xml" },
      { name: "runner unit tests", cmd: ["test", "./scripts", "./harness", ...report("runner-unit-tests.junit.xml")], env: oneEnv, junit: "/run/runner-unit-tests.junit.xml" },
    ]);
    // Passing files over several workers, each seeing the step's env; the alone files once each, only in the second
    // report; the allowlisted skip is allowed; nothing written beside the tests.
    expect(j.ok.names).toEqual(["unit tests", "unit tests (alone)"]);
    expect<boolean[]>(j.ok.pass, j.ok.lines.join("\n")).toEqual([true, true]);
    expect(j.ok.skips).toEqual([{ allowed: [{ file: "src/rustc_span/source_map/tests.test.ts", path: ["read_binary_file_handles_lying_stat"] }], unexpected: [] }, { allowed: [], unexpected: [] }]);
    expect(j.ok.lines).toHaveLength(6);
    expect(j.ok.lines.slice(0, 2)).toEqual(["ok    unit tests", "ok    unit test skips: 1 (1 allowlisted, 0 not allowed under RUST_TS_REQUIRE_PROBES=1)"]);
    expect(j.ok.lines[2]).toMatch(/^  slowest: (src|tools)\/[\w/]+\.test\.ts: env \w+ \(T s\)$/);
    expect(j.ok.lines.slice(3, 5)).toEqual(["ok    unit tests (alone)", "ok    unit tests (alone) skips: 0 (0 allowlisted, 0 not allowed under RUST_TS_REQUIRE_PROBES=1)"]);
    expect(j.ok.lines[5]).toMatch(/^  slowest: (src\/heavy\.test\.ts: env h|tools\/heavy2\.test\.ts: env h2) \(T s\)$/);
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
    // A file that throws at load (or imports a missing module) is named, and said to be missing from the report (review
    // unit-parallel N3): among the workers and alone.
    const loadLines = ["  failed: src/bad.test.ts: an error outside any test (it threw at load, a bad import or a throwing describe: the file is not in the junit report)", "  failed: src/imp.test.ts: an error outside any test (it threw at load, a bad import or a throwing describe: the file is not in the junit report)"];
    expect(j.load.pass).toEqual([false]);
    expect(j.load.files).toEqual([["src/a.test.ts"]]);
    expect(j.load.lines[0]).toBe("ERROR: unit tests");
    for (const l of loadLines) expect(j.load.lines).toContain(l);
    expect(j.aloneLoad.pass).toEqual([false, false]);
    expect(j.aloneLoad.lines).toContain(loadLines[0]);
    expect(j.aloneLoad.lines.filter((l: string) => l.includes("src/bad.test.ts: an error"))).toHaveLength(1);
    // exit(0) alone: no ok line for it, only the missing report.
    expect(j.aloneExit0.pass).toEqual([true, false]);
    const exit0 = j.aloneExit0.lines.slice(j.aloneExit0.lines.findIndex((l: string) => l.startsWith("  slowest:")) + 1);
    expect(exit0).toHaveLength(2);
    expect(exit0[0]).toStartWith("ERROR: unit tests (alone) wrote no junit report (");
    expect(exit0[0]).toEndWith("; cannot check for skipped tests (bun test exited 0: a test that called process.exit, an abort or a crash?)");
    const crashed = (f: string) => `  failed: ${f}: the last test file bun test started; the process ended in it with no report (process.exit, an abort or a crash, at load or in a test)`;
    expect(exit0[1]).toBe(crashed("src/x.test.ts"));
    // Any exit code, an abort, and a pass without workers name the file (review harness-w45 N1); the workers named theirs already.
    const noReport = (r: { lines: string[] }) => r.lines.filter((l: string) => l.includes("wrote no junit report") || l.includes("the last test file bun test started") || l.includes("printed no test file"));
    expect(j.aloneExit1.pass).toEqual([true, false]);
    expect(noReport(j.aloneExit1)).toHaveLength(2);
    expect(noReport(j.aloneExit1)[0]).toEndWith("(bun test exited 1: a test that called process.exit, an abort or a crash?)");
    expect(noReport(j.aloneExit1)[1]).toBe(crashed("src/x.test.ts"));
    expect(j.aloneAbort.pass).toEqual([true, false]);
    expect(noReport(j.aloneAbort)).toEqual([expect.stringContaining("(bun test exited 134: "), crashed("src/y.test.ts")]);
    expect(j.oneExit.pass).toEqual([false]);
    expect(noReport(j.oneExit)).toEqual([expect.stringContaining("(bun test exited 1: "), crashed("src/x.test.ts")]);
    // The tail printed for a failed one-process pass keeps the failure, not the passing tests Bun now prints.
    expect(j.oneExit.lines.some((l: string) => l.startsWith("(pass)"))).toBe(false);
    // The .only refusal is an error outside any test too, so its file is named.
    expect(j.only.lines).toContain("  failed: src/o.test.ts: an error outside any test (it threw at load, a bad import or a throwing describe: the file is not in the junit report)");
    // A failed step that names nothing says so.
    expect(j.nameless.pass).toBe(false);
    expect(j.nameless.lines[0]).toBe("ERROR: unit tests");
    expect(j.nameless.lines).toContain("ERROR: unit tests: bun test exited 3, but its junit report names no failed test and its output no file: a crash, a .only under CI=true, or a timeout of the step (see the output above)");
    expect(j.fail.lines.some((l: string) => l.includes("names no failed test"))).toBe(false);
    // The slowest test of each report, and a note over the threshold, with advice that depends on the step.
    expect<boolean[]>(j.slowNote.pass, j.slowNote.lines.join("\n")).toEqual([true, true]);
    expect(j.slowNote.lines).toContain("  slowest: src/s.test.ts: slowish (T s)");
    expect(j.slowNote.lines.filter((l: string) => l.startsWith("note:"))).toEqual([
      "note: unit tests: its slowest test took over 0.3 s, src/s.test.ts: slowish (T s); among the workers, a test this slow can reach the 60 s per-test limit under load: consider adding its file to the step's alone list (scripts/lib/unit-steps.ts)",
    ]);
    expect(j.slowAloneNote.lines.filter((l: string) => l.startsWith("note:"))).toEqual(["note: unit tests (alone): its slowest test took over 0.3 s, src/s.test.ts: slowish (T s); even alone, a test this slow can reach the 60 s per-test limit under load"]);
    expect(j.ok.lines.some((l: string) => l.startsWith("note:"))).toBe(false);
    // A passing step without a report prints its notes after its ok line, and returns them; pass and fail are its exit code.
    expect(j.notesPass).toEqual({ pass: true, notes: ["note: frozen lists: the latest accepted gate run's gate.json is missing", "note: second"], lines: ["ok    frozen lists", "note: frozen lists: the latest accepted gate run's gate.json is missing", "note: second"] });
    expect(j.notesFail.pass).toBe(false);
    expect(j.notesFail.notes).toEqual(j.notesPass.notes);
    expect(j.notesFail.lines[0]).toBe("ERROR: frozen lists");
    // The first note was pushed out of the tail by the 20 lines after it, so it follows; the second (on stderr) ends the tail.
    expect(j.notesFail.lines.slice(-1)).toEqual([j.notesPass.notes[0]]);
    expect(j.notesFail.lines[1]).toEndWith("line 19\nnote: second");
    // Notes already in the printed tail are not printed twice.
    expect(j.notesFailTail.pass).toBe(false);
    expect(j.notesFailTail.lines).toEqual(["ERROR: frozen lists", "frozen lists: 48/48\nnote: frozen lists: the latest accepted gate run's gate.json is missing\nnote: second"]);
    // A test over the per-test timeout fails the step; with time enough it passes.
    expect(j.timeout.pass).toEqual([false]);
    expect(j.timeout.lines.join("\n")).toContain("timed out after 300ms");
    expect<boolean[]>(j.inTime.pass, j.inTime.lines.join("\n")).toEqual([true]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
}, 120_000);
