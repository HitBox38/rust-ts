// The gate's Bun pin (lane bun-144; docs/reviews/w40j-audit.md N1): `gate.ts run` refuses any Bun build but scripts/lib/bun-pin.ts
// `GATE_BUN` before any work, and `gate.ts accept` refuses a run whose gate.json records another build. Both in a child, with
// RUST_TS_DATA at a temp dir (an empty git repository as its upstream checkout, as scripts/gate-power.test.ts): the shared run
// directories, baselines and state records are never touched. That gate.json records the build is checked by gate-power.test.ts.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// No import may load scripts/lib/common.ts (scripts/lib/subject-bin.ts does): this file runs in the runner unit-test process
// before scripts/lib/deps.test.ts, which needs common.ts to read its temp RUST_TS_DATA. That `GATE_BUN` is in `VALIDATED_BUN` is
// checked in scripts/subject-bin.cases.ts, which runs in a child.
import { GATE_BUN, acceptBunRefusal, gateBunRefusal } from "./lib/bun-pin.ts";
import { UNIT_ENV_REFUSED } from "./lib/unit-steps.ts";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-gate-bun-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** A temp RUST_TS_DATA with an empty upstream checkout; the environment a child gate runs with. */
function dataDir(name: string): { data: string; env: Record<string, string | undefined> } {
  const data = join(TMP, name);
  mkdirSync(join(data, "rust", "compiler"), { recursive: true });
  expect(Bun.spawnSync(["git", "init", "-q", join(data, "rust")]).exitCode).toBe(0);
  // Without the variables the gate refuses for other reasons (scripts/gate.ts `gateEnvRefusal`).
  const { NODE_ENV: _node, RUST_TS_FREEZE_LISTS: _freeze, ...inherited } = process.env;
  for (const k of Object.keys(UNIT_ENV_REFUSED)) delete inherited[k];
  return { data, env: { ...inherited, RUST_TS_DATA: data } };
}

const errorLines = (out: string) => out.split("\n").filter((l) => l.startsWith("ERROR:"));

/** `gateRun` on a stub suite list, taking itself to run on `bun`; counts the host reads it makes. */
function gateOn(name: string, bun: { version: string; revision: string }) {
  const { data, env } = dataDir(name);
  const child = `
const { gateRun } = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
let reads = 0;
process.on("exit", () => console.log(\`host reads: \${reads}\`));
const readers = {
  pmset: async () => { reads++; return "Now drawing from 'AC Power'\\n"; },
  swapusage: async () => { reads++; return "total = 2048.00M  used = 512.00M  free = 1536.00M"; },
  load: () => { reads++; return [1, 2, 3]; },
  now: () => new Date(),
};
await gateRun(["lex"], true, false, false, { readers, pollMs: 20, keepEveryMs: 3600000, bun: ${JSON.stringify(bun)} });
`;
  const r = Bun.spawnSync([process.execPath, "-e", child], { cwd: REPO, stdout: "pipe", stderr: "pipe", env });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString(), runs: existsSync(join(data, "runs")) };
}

/** `gate.ts accept --run <id>` of a gate.json holding `g`. */
function acceptOf(name: string, g: Record<string, unknown>) {
  const { data, env } = dataDir(name);
  const runId = `gate-test-${name}`;
  mkdirSync(join(data, "runs", runId), { recursive: true });
  writeFileSync(join(data, "runs", runId, "gate.json"), JSON.stringify({ runId, pass: true, skipStatic: false, dirty: [], suites: [], ...g }));
  const r = Bun.spawnSync([process.execPath, join(REPO, "scripts/gate.ts"), "accept", "--run", runId], { cwd: REPO, stdout: "pipe", stderr: "pipe", env });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString(), runId };
}

/** A head no repository has: with the Bun check passed, accept stops at the next one ("tested … but HEAD is …"), before any write. */
const NO_HEAD = "0".repeat(40);

test("GATE_BUN names a full revision", () => {
  expect(GATE_BUN.revision).toMatch(/^[0-9a-f]{40}$/);
});

test("gateBunRefusal: only the pin's version and full revision pass", () => {
  expect(gateBunRefusal(GATE_BUN)).toBeUndefined();
  expect(gateBunRefusal({ ...GATE_BUN })).toBeUndefined();
  const otherRev = gateBunRefusal({ version: GATE_BUN.version, revision: "f".repeat(40) });
  expect(otherRev).toContain(`not on ${GATE_BUN.version} (ffffffffffff)`);
  expect(otherRev).toContain("scripts/lib/bun-pin.ts GATE_BUN");
  expect(gateBunRefusal({ version: "1.4.3", revision: GATE_BUN.revision })).toContain("not on 1.4.3");
  expect(gateBunRefusal({ version: "1.4.3", revision: "c6da4a4d3010e5553438c60f6bd76d981976867c" }, { version: "1.4.3", revision: "c6da4a4d3010e5553438c60f6bd76d981976867c" })).toBeUndefined();
});

test("acceptBunRefusal: a recorded build other than the pin is refused; none recorded is let through", () => {
  expect(acceptBunRefusal("r", GATE_BUN)).toBeUndefined();
  expect(acceptBunRefusal("r", undefined)).toBeUndefined();
  expect(acceptBunRefusal("r", { version: GATE_BUN.version, revision: "a".repeat(40) })).toContain("gate run r ran on Bun");
  expect(acceptBunRefusal("r", { version: "1.4.3", revision: GATE_BUN.revision })).toContain("nothing accepted");
});

test("gate run on another Bun: one ERROR: line before anything else (no host read, no run directory)", () => {
  for (const [name, bun] of [
    ["other-version", { version: "1.4.3", revision: "c6da4a4d3010e5553438c60f6bd76d981976867c" }],
    ["other-revision", { version: GATE_BUN.version, revision: "0123456789abcdef0123456789abcdef01234567" }],
  ] as const) {
    const r = gateOn(name, bun);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const errors = errorLines(r.stdout);
    expect(errors.length, r.stdout).toBe(1);
    expect(errors[0]).toContain(`the gate runs only on Bun ${GATE_BUN.version} (${GATE_BUN.revision.slice(0, 12)})`);
    expect(errors[0]).toContain(`not on ${bun.version} (${bun.revision.slice(0, 12)})`);
    expect(r.stdout).toContain("host reads: 0");
    expect(r.runs).toBe(false);
  }
});

test("gate run on the pin passes the Bun check (it goes on to the host's first reading)", () => {
  // An unknown suite stops it right after the Bun check, before the host is read: the Bun check comes first of all.
  const { env } = dataDir("pin-unknown-suite");
  const child = `const { gateRun } = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))}); await gateRun(["no-such-suite"], true, false, false, { readers: {}, pollMs: 20, keepEveryMs: 3600000, bun: ${JSON.stringify(GATE_BUN)} });`;
  const r = Bun.spawnSync([process.execPath, "-e", child], { cwd: REPO, stdout: "pipe", stderr: "pipe", env });
  const out = r.stdout.toString() + r.stderr.toString();
  expect(r.exitCode).not.toBe(0);
  expect(out).not.toContain("the gate runs only on Bun");
  expect(out).toContain("no-such-suite");
});

test("accept refuses a run recorded on another Bun, before any other check", () => {
  const other = { version: GATE_BUN.version, revision: "1".repeat(40) };
  const r = acceptOf("other", { head: NO_HEAD, bun: other });
  expect(r.code, r.stdout + r.stderr).toBe(1);
  expect(errorLines(r.stdout)).toEqual([`ERROR: gate run ${r.runId} ran on Bun ${GATE_BUN.version} (111111111111), but the gate's Bun is ${GATE_BUN.version} (${GATE_BUN.revision.slice(0, 12)}) (scripts/lib/bun-pin.ts GATE_BUN); nothing accepted`]);
});

test("accept of a run on the pin, or with no Bun recorded, goes on to the next check", () => {
  const pinned = acceptOf("pinned", { head: NO_HEAD, bun: GATE_BUN });
  expect(pinned.code).toBe(1);
  expect(errorLines(pinned.stdout)).toEqual([expect.stringContaining(`gate run ${pinned.runId} tested 0000000000 but HEAD is`)]);
  expect(pinned.stdout).not.toContain("records no Bun");
  const old = acceptOf("old", { head: NO_HEAD });
  expect(old.code).toBe(1);
  expect(old.stdout).toContain(`note: gate run ${old.runId} records no Bun build`);
  expect(errorLines(old.stdout)).toEqual([expect.stringContaining(`gate run ${old.runId} tested 0000000000 but HEAD is`)]);
});
