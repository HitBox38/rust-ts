// `scripts/gate.ts run` and host headroom (plan-m8 D20) and never-protected suites (D19), lane harness-m8a-gate, on fake host readers
// (free disk, swap, memory pressure): no real heavy run. As scripts/gate-power.test.ts: a real `gateRun` with stub suites, in a child, with
// RUST_TS_DATA at a temp dir holding an empty git repository as its upstream checkout, and `GateHost.baselineDir` at a temp dir: the
// shared oracle cache, run directories and harness/baseline are never touched. `accept` is run on the gate.json each stopped run wrote.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { UNIT_ENV_REFUSED } from "./lib/unit-steps.ts";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-gate-headroom-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const AC = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true\n";
const GIB = 2 ** 30;

interface Stub {
  name: string;
  /** Suite.headroom */
  headroom?: string;
  /** Suite.neverProtect */
  neverProtect?: string;
  /** The subject records a watchdog stop (scripts/lib/headroom.ts `recordWatchdogStop`) before it answers. */
  watchdog?: boolean;
}

/**
 * Runs `gateRun` once over `stubs`, in order, with the readers giving `freeGiB`, `swapMb` and `pressure`, and `baselines` (suite ->
 * ids) as the protected sets. Each stub has one case, "same", that matches.
 */
function gate(name: string, stubs: Stub[], host: { freeGiB: number; swapMb: number; pressure: number }, baselines: Record<string, string[]> = {}) {
  const data = join(TMP, name);
  const baseDir = join(data, "baseline");
  mkdirSync(baseDir, { recursive: true });
  for (const [s, ids] of Object.entries(baselines)) writeFileSync(join(baseDir, `${s}.txt`), ids.map((i) => i + "\n").join(""));
  const child = `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const { gateRun } = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const { SUITES } = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const { PIN } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const ORACLE = ["rustc", \`+\${PIN.toolchain}\`, "-vV"];
const STUB = ${JSON.stringify(join(data, "stub.mjs"))};
// The subject answers as the oracle; with "watchdog", it first records a stop, as the project-build harness's watchdog will.
writeFileSync(STUB, \`
const { recordWatchdogStop, watchdogStopDir } = await import(\${JSON.stringify(${JSON.stringify(join(REPO, "scripts/lib/headroom.ts"))})});
if (process.argv[2] === "watchdog") recordWatchdogStop(watchdogStopDir(\${JSON.stringify(${JSON.stringify(data)})}), { at: new Date().toISOString(), pid: process.pid, what: "the stub's build", reason: "free disk 3.9 GiB, under the 4 GiB floor" });
await Bun.write(Bun.stdout, Bun.spawnSync(\${JSON.stringify(ORACLE)}).stdout);
\`);
for (const s of ${JSON.stringify(stubs)}) {
  SUITES.push({
    name: s.name, milestone: "test", description: "", mode: "single", cwd: ${JSON.stringify(TMP)}, timeoutMs: 30000,
    ...(s.headroom ? { headroom: s.headroom } : {}), ...(s.neverProtect ? { neverProtect: s.neverProtect } : {}),
    cases: () => [{ id: "same", file: "", args: [] }],
    oracle: () => ORACLE, subject: () => [process.execPath, STUB, s.watchdog ? "watchdog" : "plain"],
  });
}
const readers = {
  pmset: async () => ${JSON.stringify(AC)},
  swapusage: async () => "total = 9216.00M  used = ${host.swapMb}.00M  free = 0.00M  (encrypted)",
  load: () => [1, 2, 3],
  now: () => new Date(),
  freeBytes: async () => ${host.freeGiB * GIB},
  vmPressure: async () => "${host.pressure}\\n",
};
await gateRun(${JSON.stringify(stubs.map((s) => s.name))}, true, false, false, { readers, pollMs: 3600000, keepEveryMs: 3600000, baselineDir: ${JSON.stringify(baseDir)} });
`;
  mkdirSync(join(data, "rust", "compiler"), { recursive: true });
  expect(Bun.spawnSync(["git", "init", "-q", join(data, "rust")]).exitCode).toBe(0);
  // Without `bun test`'s NODE_ENV=test, nor a variable that changes what a unit test checks: the gate refuses to start with them.
  const { NODE_ENV: _node, RUST_TS_FREEZE_LISTS: _freeze, ...inherited } = process.env;
  for (const k of Object.keys(UNIT_ENV_REFUSED)) delete inherited[k];
  const env = { ...inherited, RUST_TS_DATA: data };
  const r = Bun.spawnSync([process.execPath, "-e", child], { cwd: REPO, stdout: "pipe", stderr: "pipe", env });
  const runs = join(data, "runs");
  const dirs = existsSync(runs) ? readdirSync(runs).filter((d) => d.startsWith("gate-")) : [];
  const dir = dirs[0] === undefined ? undefined : join(runs, dirs[0]);
  const gateJson = dir === undefined ? undefined : (JSON.parse(readFileSync(join(dir, "gate.json"), "utf8")) as any);
  return {
    code: r.exitCode,
    stdout: r.stdout.toString(),
    stderr: r.stderr.toString(),
    gateJson,
    ran: dir === undefined ? [] : stubs.map((s) => s.name).filter((s) => existsSync(join(dir, `${s}.jsonl`))),
    /** `gate.ts accept --run` of this run: it must refuse before reading anything else. */
    accept: () => {
      const a = Bun.spawnSync([process.execPath, join(REPO, "scripts/gate.ts"), "accept", "--run", gateJson.runId], { cwd: REPO, stdout: "pipe", stderr: "pipe", env });
      return { code: a.exitCode, stdout: a.stdout.toString() };
    },
  };
}

const errorLines = (s: string) => s.split("\n").filter((l) => l.startsWith("ERROR:"));
const ROOMY = { freeGiB: 30, swapMb: 512, pressure: 1 };

test("a failed headroom check before a covered suite stops the gate there: pass false, the reason named, the rest not run, no lost case; accept refuses", () => {
  const r = gate("check-fails", [{ name: "hr-before" }, { name: "hr-covered", headroom: "heavy-build" }, { name: "hr-after" }], { freeGiB: 12, swapMb: 8423, pressure: 1 }, { "hr-covered": ["same"], "hr-after": ["same"] });
  expect(r.code, r.stdout + r.stderr).toBe(1);
  expect(r.ran).toEqual(["hr-before"]);
  const errors = errorLines(r.stdout);
  expect(errors.length, r.stdout).toBe(1);
  expect(errors[0]).toContain("ERROR: hr-covered: host headroom (plan-m8 D20, heavy-build");
  expect(errors[0]).toContain("12.0 GiB free on the data volume, under 20 GiB");
  expect(errors[0]).toContain("8.2 GiB of swap in use, not under 4 GiB");
  expect(errors[0]).toContain("the gate stops here: 2 suite(s) not run");
  const g = r.gateJson;
  expect(g.pass).toBe(false);
  expect(g.stop.suite).toBe("hr-covered");
  expect(g.stop.kind).toBe("headroom");
  expect(g.stop.reason).toContain("12.0 GiB free");
  expect(g.notRun.map((n: { suite: string }) => n.suite)).toEqual(["hr-covered", "hr-after"]);
  expect(g.notRun[0].reason).toStartWith("headroom check failed: host headroom");
  expect(g.notRun[1].reason).toBe("the gate stopped at hr-covered");
  // No case of the stopped suite (nor of the ones after it) is recorded, so none is lost.
  expect(g.suites.map((s: { suite: string; lost: string[] }) => [s.suite, s.lost])).toEqual([["hr-before", []]]);
  expect(g.headroom.length).toBe(1);
  expect(g.headroom[0].reading.freeBytes).toBe(12 * GIB);
  expect(g.headroom[0].refused).toBe(g.stop.reason);
  expect(r.stdout).toContain(`gate FAIL run=${g.runId}`);
  const a = r.accept();
  expect(a.code).toBe(1);
  expect(errorLines(a.stdout)).toEqual([`ERROR: gate run ${g.runId} stopped at hr-covered (headroom: ${g.stop.reason}); nothing accepted; re-run the gate once the host meets plan-m8 D20`]);
}, 60_000);

test("critical memory pressure fails the check too, with free disk and swap in range", () => {
  const r = gate("pressure", [{ name: "hp-covered", headroom: "testsuite" }], { freeGiB: 30, swapMb: 0, pressure: 4 });
  expect(r.code).toBe(1);
  expect(r.gateJson.stop.reason).toContain("memory pressure is critical (kern.memorystatus_vm_pressure_level 4)");
  expect(r.ran).toEqual([]);
}, 60_000);

test("a watchdog stop during a covered suite stops the gate there: pass false, no case of it lost, the rest not run; accept refuses", () => {
  const r = gate("watchdog", [{ name: "wd-covered", headroom: "heavy-build", watchdog: true }, { name: "wd-after" }], ROOMY, { "wd-covered": ["same", "gone"] });
  expect(r.code, r.stdout + r.stderr).toBe(1);
  const errors = errorLines(r.stdout);
  expect(errors.length, r.stdout).toBe(1);
  expect(errors[0]).toContain("ERROR: wd-covered: the watchdog stopped the stub's build (pid ");
  expect(errors[0]).toContain("free disk 3.9 GiB, under the 4 GiB floor; the gate stops here: 2 suite(s) not run");
  const g = r.gateJson;
  expect(g.pass).toBe(false);
  expect(g.stop.kind).toBe("watchdog");
  // The suite ran (its results file exists) but is not scored: "gone", protected and absent, is not counted as lost.
  expect(r.ran).toEqual(["wd-covered"]);
  expect(g.suites).toEqual([]);
  expect(r.stdout).not.toContain("lost:");
  expect(g.notRun.map((n: { suite: string; reason: string }) => [n.suite, n.reason.split(":")[0]])).toEqual([["wd-covered", "watchdog stop"], ["wd-after", "the gate stopped at wd-covered"]]);
  // The check before it passed, and is recorded.
  expect(g.headroom[0].refused).toBeUndefined();
  const a = r.accept();
  expect(a.code).toBe(1);
  expect(a.stdout).toContain(`ERROR: gate run ${g.runId} stopped at wd-covered (watchdog: the watchdog stopped`);
}, 60_000);

test("a failed check before a never-protected suite only leaves it not run: the gate goes on and passes", () => {
  const r = gate("report", [{ name: "np-report", headroom: "heavy-build", neverProtect: "a report until D23 holds" }, { name: "np-after" }], { freeGiB: 5, swapMb: 0, pressure: 1 }, { "np-after": ["same"] });
  expect(r.code, r.stdout + r.stderr).toBe(0);
  expect(errorLines(r.stdout)).toEqual([]);
  expect(r.stdout).toMatch(/^note: np-report not run \(a report suite, never protected\): host headroom \(plan-m8 D20, heavy-build[^\n]*5\.0 GiB free/m);
  expect(r.ran).toEqual(["np-after"]);
  const g = r.gateJson;
  expect(g.pass).toBe(true);
  expect(g.stop).toBeUndefined();
  expect(g.notRun).toEqual([{ suite: "np-report", reason: `headroom check failed: ${g.headroom[0].refused}` }]);
}, 60_000);

test("enough headroom: the suite runs as before, the reading recorded; a never-protected suite runs as a report", () => {
  const r = gate("roomy", [{ name: "ok-covered", headroom: "heavy-build" }, { name: "ok-report", neverProtect: "permanently" }], ROOMY);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  expect(r.ran).toEqual(["ok-covered", "ok-report"]);
  const g = r.gateJson;
  expect(g.pass).toBe(true);
  expect(g.stop).toBeUndefined();
  expect(g.notRun).toBeUndefined();
  expect(g.headroom).toEqual([{ suite: "ok-covered", reading: { at: expect.any(String), freeBytes: 30 * GIB, swapUsedMb: 512, vmPressure: 1 } }]);
  expect(r.stdout).toContain("note: ok-report: a report, never protected (permanently); accept skips its matches");
}, 60_000);

test("a suite with no headroom field is read as before: no check, no `headroom` record, even with no disk free", () => {
  const r = gate("unchanged", [{ name: "plain-a" }, { name: "plain-b" }], { freeGiB: 0, swapMb: 9000, pressure: 4 });
  expect(r.code, r.stdout + r.stderr).toBe(0);
  expect(r.ran).toEqual(["plain-a", "plain-b"]);
  expect(r.gateJson.headroom).toBeUndefined();
  expect(r.gateJson.stop).toBeUndefined();
  expect(Object.keys(r.gateJson.suites[0])).not.toContain("env");
}, 60_000);

test("gate run refuses a never-protected suite that has a baseline file, before anything runs", () => {
  const r = gate("np-baseline", [{ name: "np-based", neverProtect: "a report" }], ROOMY, { "np-based": ["same"] });
  expect(r.code).toBe(1);
  const errors = errorLines(r.stdout);
  expect(errors.length).toBe(1);
  expect(errors[0]).toContain("suite np-based is never protected (neverProtect: a report) but has a baseline file");
  expect(r.gateJson).toBeUndefined();
}, 60_000);
