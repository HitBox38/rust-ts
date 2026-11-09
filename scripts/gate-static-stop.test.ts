// `scripts/gate.ts run` stops before the suites when a static step fails (lane harness-w44, review harness-w43 F7), and refuses
// to start while RUST_TS_FREEZE_LISTS or NODE_ENV is set (review perf-heavy F3). As scripts/gate-power.test.ts: a real `gateRun`
// with a stub suite, in a child, with RUST_TS_DATA at a temp dir holding an empty git repository as its upstream checkout, and
// `GateHost.staticChecks` in place of the real static steps.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-gate-static-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const AC = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true\n";

function gate(name: string, staticOk: boolean, extraEnv: Record<string, string> = {}, opts: { dirtyUpstream?: boolean; frozenDir?: boolean } = {}) {
  const data = join(TMP, name);
  const child = `
const { gateRun } = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const { SUITES } = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const { PIN } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const ORACLE = ["rustc", \`+\${PIN.toolchain}\`, "-vV"];
SUITES.push({
  name: "static-stub", milestone: "test", description: "", mode: "single", cwd: ${JSON.stringify(TMP)}, timeoutMs: 30000,
  cases: () => [{ id: "same", file: "", args: [] }],
  oracle: () => ORACLE, subject: () => ORACLE,
});
const readers = { pmset: async () => ${JSON.stringify(AC)}, swapusage: async () => "total = 2048.00M  used = 512.00M  free = 1536.00M", load: () => [1, 2, 3], now: () => new Date() };
let calls = 0;
const { mkdirSync, writeFileSync } = await import("node:fs");
const staticChecks = async (runDir) => {
  calls++;
  console.log("static checks ran");
  // As a static step that leaves a stray in the upstream checkout; as the frozen lists step's own run directory.
  if (${Boolean(opts.dirtyUpstream)}) writeFileSync(${JSON.stringify(join(data, "rust", "stray.txt"))}, "x");
  if (${Boolean(opts.frozenDir)}) mkdirSync(runDir + "-frozen-lists");
  return { ok: ${staticOk}, notes: [{ step: "frozen lists", note: "note: frozen lists: a note" }] };
};
await gateRun(["static-stub"], false, false, false, { readers, pollMs: 1000, keepEveryMs: 3600000, staticChecks });
`;
  mkdirSync(join(data, "rust", "compiler"), { recursive: true });
  expect(Bun.spawnSync(["git", "init", "-q", join(data, "rust")]).exitCode).toBe(0);
  const env: Record<string, string | undefined> = { ...process.env, RUST_TS_DATA: data, ...extraEnv };
  // `bun test` sets NODE_ENV=test; the child must not inherit it unless a test sets it.
  if (!("NODE_ENV" in extraEnv)) delete env.NODE_ENV;
  delete env.RUST_TS_FREEZE_LISTS;
  Object.assign(env, extraEnv);
  const r = Bun.spawnSync([process.execPath, "-e", child], { cwd: REPO, stdout: "pipe", stderr: "pipe", env: env as Record<string, string> });
  const runs = join(data, "runs");
  const dirs = existsSync(runs) ? readdirSync(runs).filter((d) => d.startsWith("gate-") && !d.endsWith("-frozen-lists")) : [];
  const dir = dirs[0] === undefined ? undefined : join(runs, dirs[0]);
  return {
    code: r.exitCode,
    stdout: r.stdout.toString(),
    stderr: r.stderr.toString(),
    gateJson: dir === undefined ? undefined : (JSON.parse(readFileSync(join(dir, "gate.json"), "utf8")) as any),
    ranSuite: dir !== undefined && existsSync(join(dir, "static-stub.jsonl")),
  };
}

test("a failed static check stops the gate before the suites", () => {
  const r = gate("fails", false);
  expect(r.code).toBe(1);
  expect(r.stdout).toContain("static checks ran");
  expect(r.stdout).toContain("ERROR: a static check failed; the 1 suite(s) are not run");
  expect(r.stdout).toContain("gate FAIL run=");
  expect(r.ranSuite).toBe(false);
  expect(r.gateJson.pass).toBe(false);
  expect(r.gateJson.staticOk).toBe(false);
  expect(r.gateJson.suites).toEqual([]);
  expect(r.gateJson.notRun).toEqual([{ suite: "static-stub", reason: "a static check failed" }]);
  // Checked, and clean (review harness-w44 N2); no frozen lists run directory, so none named.
  expect(r.gateJson.upstreamOk).toBe(true);
  expect(r.gateJson.upstreamChanges).toBeUndefined();
  expect(r.gateJson.frozenLists).toBeNull();
  // A static step's notes are recorded (review root-w44-check N1).
  expect(r.gateJson.staticNotes).toEqual([{ step: "frozen lists", note: "note: frozen lists: a note" }]);
}, 60_000);

test("a stopped gate checks the upstream checkout and names the frozen lists run (review harness-w44 N2)", () => {
  const r = gate("fails-dirty", false, {}, { dirtyUpstream: true, frozenDir: true });
  expect(r.code).toBe(1);
  expect(r.stdout).toContain("ERROR: a static step changed the upstream checkout: 1 path(s)");
  expect(r.gateJson.upstreamOk).toBe(false);
  expect(r.gateJson.upstreamChanges).toEqual(["?? stray.txt"]);
  const id = `${r.gateJson.runId}-frozen-lists`;
  expect(r.gateJson.frozenLists).toEqual({ runId: id, dir: join(TMP, "fails-dirty", "runs", id) });
}, 60_000);

test("passing static checks go on to the suites", () => {
  const r = gate("passes", true);
  expect(r.stdout).toContain("static checks ran");
  expect(r.stdout).not.toContain("a static check failed");
  expect(r.ranSuite).toBe(true);
  expect(r.gateJson.staticOk).toBe(true);
  expect(r.gateJson.suites.map((s: { suite: string }) => s.suite)).toEqual(["static-stub"]);
  expect(r.gateJson.frozenLists).toBeNull();
  expect(r.gateJson.staticNotes).toEqual([{ step: "frozen lists", note: "note: frozen lists: a note" }]);
}, 60_000);

test("a passing gate names the frozen lists run", () => {
  const r = gate("passes-frozen", true, {}, { frozenDir: true });
  expect(r.ranSuite).toBe(true);
  const id = `${r.gateJson.runId}-frozen-lists`;
  expect(r.gateJson.frozenLists).toEqual({ runId: id, dir: join(TMP, "passes-frozen", "runs", id) });
}, 60_000);

for (const [k, v] of [
  ["RUST_TS_FREEZE_LISTS", "1"],
  ["NODE_ENV", "production"],
] as const) {
  test(`${k} set: refused before anything runs`, () => {
    const r = gate(`env-${k}`, true, { [k]: v });
    expect(r.code).toBe(1);
    const errors = r.stdout.split("\n").filter((l) => l.startsWith("ERROR:"));
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain(`${k}=${v} set`);
    expect(r.stdout).not.toContain("static checks ran");
    expect(r.gateJson).toBeUndefined();
  }, 60_000);
}
