// `scripts/gate.ts run` and the power source (lane harness-w41; docs/reviews/perf-near-limit.md, question c), on fake readers: not by
// unplugging. A real `gateRun` with a stub suite; as scripts/retry-times.test.ts, in a child, with RUST_TS_DATA at a temp dir holding an empty
// git repository as its upstream checkout: the shared oracle cache and run directories are never touched.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-gate-power-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const AC = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true\n";
const BATT = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t57%; discharging; 3:21 remaining present: true\n";

/** Runs `gateRun` once: the readers' `pmset` gives each of `pmset` in turn, the last one staying. */
function gate(name: string, pmset: (string | null)[], allowBattery: boolean, hostile: boolean | "never answers" = false) {
  const data = join(TMP, name);
  const child = `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const { gateRun } = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const { SUITES } = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const STUB = ${JSON.stringify(join(TMP, `${name}-stub.mjs`))};
const { PIN } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
// The gate lets an oracle run only \`rustc\` or a declared probe (\`undeclaredRuns\`). The subject's sleep gives the polls time.
const ORACLE = ["rustc", \`+\${PIN.toolchain}\`, "-vV"];
writeFileSync(STUB, \`
const id = process.argv[2];
await Bun.sleep(100);
await Bun.write(Bun.stdout, id === "differs" ? "other\\\\n" : Bun.spawnSync(\${JSON.stringify(ORACLE)}).stdout);
\`);
SUITES.push({
  name: "power-stub", milestone: "test", description: "", mode: "single", cwd: ${JSON.stringify(TMP)}, timeoutMs: 30000,
  irTier: "N2",
  cases: () => ["same", "differs"].map((id) => ({ id, file: "", args: [] })),
  oracle: () => ORACLE, subject: ([c]) => [process.execPath, STUB, c.id],
});
const texts = ${JSON.stringify(pmset)};
let i = 0;
const readers = {
  pmset: ${hostile === "never answers" ? "() => { i++; return new Promise(() => {}); }" : `async () => { ${hostile ? 'throw new Error("no pmset");' : ""} return texts[Math.min(i++, texts.length - 1)] ?? undefined; }`},
  swapusage: async () => "total = 2048.00M  used = 512.00M  free = 1536.00M",
  load: () => [1, 2, 3],
  now: () => new Date(),
};
await gateRun(["power-stub"], true, false, ${allowBattery}, { readers, pollMs: 20, keepEveryMs: 3600000, ${hostile === "never answers" ? "readLimitMs: 20" : ""} });
console.log(\`pmset reads: \${i}\`);
`;
  mkdirSync(join(data, "rust", "compiler"), { recursive: true });
  expect(Bun.spawnSync(["git", "init", "-q", join(data, "rust")]).exitCode).toBe(0);
  // Without `bun test`'s NODE_ENV=test: the gate refuses to start with it (scripts/gate.ts `freezeEnvRefusal`).
  const { NODE_ENV: _node, RUST_TS_FREEZE_LISTS: _freeze, ...inherited } = process.env;
  const r = Bun.spawnSync([process.execPath, "-e", child], { cwd: REPO, stdout: "pipe", stderr: "pipe", env: { ...inherited, RUST_TS_DATA: data } });
  const stdout = r.stdout.toString();
  const runs = join(data, "runs");
  const dirs = (() => {
    try {
      return readdirSync(runs).filter((d) => d.startsWith("gate-"));
    } catch {
      return [];
    }
  })();
  const dir = dirs[0] === undefined ? undefined : join(runs, dirs[0]);
  return {
    code: r.exitCode,
    stdout,
    stderr: r.stderr.toString(),
    gateJson: dir === undefined ? undefined : (JSON.parse(readFileSync(join(dir, "gate.json"), "utf8")) as any),
    summary: dir === undefined ? undefined : (JSON.parse(readFileSync(join(dir, "power-stub.summary.json"), "utf8")) as any),
    statuses: dir === undefined ? undefined : readFileSync(join(dir, "power-stub.jsonl"), "utf8").trim().split("\n").map((l) => { const x = JSON.parse(l); return [x.id, x.status]; }),
  };
}

test("on battery: refused before anything runs, one ERROR: line naming the flag", () => {
  const r = gate("refused", [BATT], false);
  expect(r.code).toBe(1);
  const errors = r.stdout.split("\n").filter((l) => l.startsWith("ERROR:"));
  expect(errors.length).toBe(1);
  expect(errors[0]).toContain("on battery at 57%");
  expect(errors[0]).toContain("--allow-battery");
  expect(r.gateJson).toBeUndefined();
});

test("--allow-battery runs, says so, and records it", () => {
  const r = gate("allowed", [BATT], true);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  expect(r.stdout).toContain("note: running on battery (--allow-battery), at 57%");
  expect(r.stdout).not.toContain("power lost");
  expect(r.gateJson.pass).toBe(true);
  expect(r.gateJson.host.allowBattery).toBe(true);
  expect(r.gateJson.host.powerLost).toEqual([]);
  expect(r.gateJson.suites[0].hostStart.power.source).toBe("Battery Power");
});

test("power lost during a run: a note, and neither the verdict nor a status changes; gate.json has the times", () => {
  const steady = gate("steady", [AC], false);
  const lost = gate("lost", [AC, AC, BATT], false);
  expect(steady.code, steady.stdout + steady.stderr).toBe(0);
  expect(lost.code, lost.stdout + lost.stderr).toBe(0);
  expect(steady.stdout).not.toContain("power lost");
  expect(lost.stdout).toMatch(/^note: power lost at \S+: this gate now runs on battery at 57%/m);
  expect(lost.stdout).toMatch(/^note: this gate lost power 1 time\(s\)/m);
  expect(lost.stdout).not.toContain("ERROR:");
  expect(lost.gateJson.pass).toBe(true);
  expect(lost.gateJson.host.powerLost[0].percent).toBe(57);
  expect(lost.statuses).toEqual(steady.statuses);
  expect(lost.statuses).toEqual([["differs", "DIFF"], ["same", "MATCH"]]);
  // The suite's two ends, in order, with load and swap.
  const s = steady.gateJson.suites[0];
  expect(Date.parse(s.startedAt)).toBeLessThanOrEqual(Date.parse(s.endedAt));
  expect(s.hostStart.power).toEqual({ source: "AC Power", onBattery: false, percent: 100 });
  expect(s.hostEnd.load).toEqual([1, 2, 3]);
  expect(s.hostEnd.swapUsedMb).toBe(512);
  expect(steady.gateJson.host.samples.length).toBeGreaterThanOrEqual(4); // the run's start and end, the suite's two
});

test("with the flag, a move to battery just after the gate's first reading is still a loss", () => {
  const r = gate("allowed-move", [AC, BATT], true);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  expect(r.stdout).toMatch(/^note: power lost at \S+: this gate now runs on battery at 57%/m);
  expect(r.gateJson.host.powerLost.map((p: { percent: number }) => p.percent)).toEqual([57]);
});

test("a reader stuck from the first reading: one read in the whole gate, one note, and no status or verdict moves (review root-w40-check F2)", () => {
  const r = gate("stuck", [AC], false, "never answers");
  expect(r.code, r.stdout + r.stderr).toBe(0);
  expect(r.stdout).toContain("pmset reads: 1\n");
  expect(r.stdout.split("\n").filter((l) => l.startsWith("note: host reader pmset is stuck: ")).length).toBe(1);
  expect(r.gateJson.pass).toBe(true);
  expect(r.gateJson.host.samples.every((s: { power: unknown }) => s.power === null)).toBe(true);
  expect(r.statuses).toEqual([["differs", "DIFF"], ["same", "MATCH"]]);
});

test("an IR suite's tier is in gate.json, the summary and the gate's output, and only there (review harness-m7a H3)", () => {
  const r = gate("tier", [AC], false);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  expect(r.gateJson.suites[0].irTier).toBe("N2");
  expect(r.summary.irTier).toBe("N2");
  expect(r.stdout).toContain("note: power-stub: read at IR tier N2\n");
  expect(r.statuses).toEqual([["differs", "DIFF"], ["same", "MATCH"]]);
});

test("no pmset, or one that throws: nothing is refused or noted (the parser's own tests cover a desktop)", () => {
  const r = gate("no-pmset", [null], false, true);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  expect(r.stdout).not.toContain("battery");
  expect(r.gateJson.pass).toBe(true);
  expect(r.gateJson.host.powerLost).toEqual([]);
  expect(r.gateJson.suites[0].hostStart.power).toBeNull();
});
