// The ENV status (scripts/difftest.ts, plan-m8 D9 and D19, lane harness-m8a-gate): decided from oracle runs only, on two of them, never
// cached, never MATCH (so never protected: scripts/lib/protect.ts `matchIdsOfJsonl`, which gate.ts `matchesOfRun` reads). A real run of
// `difftest()` with a stub suite; as scripts/retry-times.test.ts, in a child, with RUST_TS_DATA at a temp dir holding an empty git
// repository as its upstream checkout: the shared oracle cache and run directories are never touched.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { matchIdsOfJsonl } from "./lib/protect.ts";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-difftest-env-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** A child that registers the stub suite (in `mode`), its files in `dir`, and runs `body`. */
const child = (mode: string, body: string, dir: string) => `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const d = await import(${JSON.stringify(join(REPO, "scripts/difftest.ts"))});
const { SUITES } = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const { RUNS } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const TMP = ${JSON.stringify(dir)};
const STUB = join(TMP, "stub.mjs");
// argv: the side, then a case id. The oracle appends its case id to oracle-runs.txt each time it runs.
// "env": the oracle skips it (host reasons) every time; the subject passes. "env-same": both print the oracle's skip.
// "env-once": the oracle skips it on its first run only. "subject-skips": only the subject prints a skip. "plain": both "ok".
writeFileSync(STUB, \`
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const [side, id, dir] = process.argv.slice(2);
const SKIP = "test x ... ignored, requires tool foo\\\\n";
if (side === "oracle") {
  appendFileSync(dir + "/oracle-runs.txt", id + "\\\\n");
  const first = !existsSync(dir + "/" + id + ".seen");
  writeFileSync(dir + "/" + id + ".seen", "");
  if (id === "env" || id === "env-same" || (id === "env-once" && first)) { await Bun.write(Bun.stdout, SKIP); process.exit(0); }
} else if (id === "env-same" || id === "subject-skips") { await Bun.write(Bun.stdout, SKIP); process.exit(0); }
await Bun.write(Bun.stdout, "ok\\\\n");
\`);
SUITES.push({
  name: "env-stub", milestone: "test", description: "", mode: ${JSON.stringify(mode)}, cwd: TMP, timeoutMs: 20000,
  cases: () => ["env", "env-same", "env-once", "subject-skips", "plain"].map((id) => ({ id, file: "", args: [] })),
  oracle: ([c]) => [process.execPath, STUB, "oracle", c.id, TMP], subject: ([c]) => [process.execPath, STUB, "subject", c.id, TMP],
  criterion: { percent: 30, what: "a test figure" },
  envOracle: (r) => (/ignored, requires tool (\\S+)/.exec(r.stdout) ? "the host lacks a tool the test requires" : undefined),
});
${body}
`;

/** The child, with RUST_TS_DATA and the stub's files at `<TMP>/<name>`. */
function runChild(name: string, mode: string, body: string) {
  const data = join(TMP, name);
  mkdirSync(join(data, "rust", "compiler"), { recursive: true });
  expect(Bun.spawnSync(["git", "init", "-q", join(data, "rust")]).exitCode).toBe(0);
  const { NODE_ENV: _n, ...env } = process.env;
  const r = Bun.spawnSync([process.execPath, "-e", child(mode, body, data)], { cwd: REPO, stdout: "pipe", stderr: "pipe", env: { ...env, RUST_TS_DATA: data } });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

test("ENV: on two oracle runs, whatever the subject does; once is UNSTABLE; never cached, never MATCH", () => {
  const r = runChild(
    "single",
    "single",
    `
const rows = async (run) => {
  const res = await d.difftest({ suite: "env-stub", runId: run, quiet: true, jobs: 2 });
  return { counts: res.counts, criterion: res.criterion, rows: readFileSync(join(RUNS, run, "env-stub.jsonl"), "utf8"), runs: readFileSync(join(TMP, "oracle-runs.txt"), "utf8").trim().split("\\n") };
};
const first = await rows("one");
const second = await rows("two");
console.log(JSON.stringify({ first, second }));
`,
  );
  expect(r.code, r.stdout + r.stderr).toBe(0);
  const { first, second } = JSON.parse(r.stdout.trim().split("\n").at(-1)!) as Record<"first" | "second", { counts: Record<string, number>; criterion: { match: number; of: number; env?: number }; rows: string; runs: string[] }>;
  const status = (text: string) => Object.fromEntries(text.trim().split("\n").map((l) => JSON.parse(l)).map((x: { id: string; status: string; env?: string; unstable?: string }) => [x.id, [x.status, x.env ?? x.unstable ?? null]]));
  expect(status(first.rows)).toEqual({
    env: ["ENV", "the host lacks a tool the test requires"],
    // The subject printing the oracle's very output does not make it MATCH: ENV is the oracle's alone.
    "env-same": ["ENV", "the host lacks a tool the test requires"],
    "env-once": ["UNSTABLE", "detected: ENV on one oracle run of two (the host lacks a tool the test requires)"],
    // A skip on the subject side alone is a difference, never ENV.
    "subject-skips": ["DIFF", null],
    plain: ["MATCH", null],
  });
  expect(first.counts.ENV).toBe(2);
  expect(first.counts.MATCH).toBe(1);
  // Out of the denominator (plan-m8 §6): 5 cases less 2 ENV.
  expect([first.criterion.match, first.criterion.of, first.criterion.env]).toEqual([1, 3, 2]);
  // Two oracle runs for each flagged case, one for the others.
  const count = (runs: string[], id: string) => runs.filter((x) => x === id).length;
  expect([count(first.runs, "env"), count(first.runs, "env-same"), count(first.runs, "env-once"), count(first.runs, "plain")]).toEqual([2, 2, 2, 1]);
  // The second run: the ENV cases are run twice again (never cached), the others come from the cache; "env-once" was not cached
  // either (UNSTABLE), and is now plain "ok" on both sides.
  const runs2 = second.runs.slice(first.runs.length);
  expect([count(runs2, "env"), count(runs2, "env-same"), count(runs2, "env-once"), count(runs2, "plain"), count(runs2, "subject-skips")]).toEqual([2, 2, 1, 0, 0]);
  expect(status(second.rows).env).toEqual(["ENV", "the host lacks a tool the test requires"]);
  expect(status(second.rows)["env-once"]).toEqual(["MATCH", null]);
  // What accept may protect: never an ENV case.
  expect([...matchIdsOfJsonl(first.rows)]).toEqual(["plain"]);
  expect([...matchIdsOfJsonl(second.rows)].sort()).toEqual(["env-once", "plain"]);
}, 60_000);

test("classify: a subject-side outcome can never produce ENV; an ENV oracle is ENV whatever the subject did", () => {
  const r = runChild(
    "classify",
    "single",
    `
const oracles = [{ text: "a", code: 0, timedOut: false }, { text: "a", code: 1, timedOut: false }];
const subjects = [{ text: "a", code: 0, timedOut: false }, { text: "b", code: 0, timedOut: false }, { text: "", code: 70, timedOut: false }, { text: "", code: 101, timedOut: false }, { text: "", code: 0, timedOut: true }, { text: "a", code: 1, timedOut: false }];
const plain = [], env = [];
for (const o of oracles) for (const s of subjects) { plain.push(d.classify(o, s)); env.push(d.classify({ ...o, env: "host" }, s)); }
// An oracle timeout or unstable output still comes first.
const order = [d.classify({ text: "", code: 0, timedOut: true, env: "host" }, subjects[0]), d.classify({ text: "", code: 0, timedOut: false, unstable: "u", env: "host" }, subjects[0])];
console.log(JSON.stringify({ plain, env, order, statuses: d.STATUSES }));
`,
  );
  expect(r.code, r.stdout + r.stderr).toBe(0);
  const out = JSON.parse(r.stdout.trim().split("\n").at(-1)!) as { plain: string[]; env: string[]; order: string[]; statuses: string[] };
  expect(out.plain.length).toBe(12);
  expect(out.plain.includes("ENV")).toBe(false);
  expect(new Set(out.env)).toEqual(new Set(["ENV"]));
  expect(out.order).toEqual(["ORACLE_TIMEOUT", "UNSTABLE"]);
  expect(out.statuses.at(-1)).toBe("ENV");
}, 60_000);

test("only a single-mode suite may have envOracle: another mode is refused before any case runs", () => {
  const r = runChild("batch", "batch", `await d.difftest({ suite: "env-stub", runId: "batch", quiet: true });`);
  expect(r.code).toBe(1);
  expect(r.stdout).toContain("ERROR: suite env-stub: only a single-mode suite can have envOracle (plan-m8 D19), not a batch one");
  // Refused before the oracle ran.
  expect(() => readFileSync(join(TMP, "batch", "oracle-runs.txt"))).toThrow();
}, 60_000);
