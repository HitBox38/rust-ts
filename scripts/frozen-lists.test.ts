// The frozen-lists sample's exclusion of cases near their limit (scripts/frozen-lists.ts `nearLimitCases`, `frozenSample`;
// lane harness-w45, docs/reviews/w40d-audit.md N2). frozen-lists.ts loads scripts/lib/common.ts, so (as
// scripts/gate-probes.test.ts) it runs in a child, with RUST_TS_DATA at a temp dir; the runs and history it reads are temp
// files, so nothing shared is read or written. See scripts/lib/deps.test.ts.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const DATA = mkdtempSync(join(tmpdir(), "rust-ts-frozen-lists-"));
afterAll(() => rmSync(DATA, { recursive: true, force: true }));

const RUNS = join(DATA, "runs");
const accept = (runId: string) => JSON.stringify({ ts: "t", kind: "accept", msg: "m", data: { runId, suites: {} } });
const gate = (runId: string, suites: { suite: string; retryTimes?: unknown[] }[]) => {
  mkdirSync(join(RUNS, runId), { recursive: true });
  writeFileSync(join(RUNS, runId, "gate.json"), JSON.stringify({ runId, suites }));
};
const retry = (id: string, alone?: number) => ({ id, status: "MATCH", pool: { timedOut: true, wallS: 60 }, ...(alone === undefined ? {} : { alone: { timedOut: false, wallS: alone } }) });

gate("g-old", [{ suite: "mir", retryTimes: [retry("tests/ui/old-slow.rs", 50)] }, { suite: "check-ui", retryTimes: [] }]);
gate("g-new", [{ suite: "mir", retryTimes: [retry("tests/ui/tait.rs", 46), retry("tests/ui/old-slow.rs")] }, { suite: "mir-o2", retryTimes: [] }, { suite: "check-ui", retryTimes: [] }, { suite: "run-pass-miri", retryTimes: [retry("tests/ui/miri.rs", 35)] }]);
const HISTORY = [JSON.stringify({ kind: "decision", msg: "x" }), accept("g-gone"), accept("g-old"), JSON.stringify({ kind: "accept", msg: "no data" }), accept("g-new"), ""].join("\n");

const CHILD = `
const f = await import(${JSON.stringify(join(REPO, "scripts/frozen-lists.ts"))});
const RUNS = ${JSON.stringify(RUNS)};
const HISTORY = ${JSON.stringify(HISTORY)};
const accept = (runId) => JSON.stringify({ ts: "t", kind: "accept", msg: "m", data: { runId, suites: {} } });
const out = {};
out.accepted = f.acceptedRuns(HISTORY);
const r = f.nearLimitCases(["mir", "mir-o2", "check-ui"], HISTORY, RUNS);
out.near = r.ok ? { ok: true, runs: r.runs, cases: [...r.cases].map(([s, m]) => [s, [...m]]) } : r;
out.missing = f.nearLimitCases(["mir"], HISTORY + "\\n" + accept("g-none"), RUNS);
out.partial = f.nearLimitCases(["mir", "mir-o2"], [accept("g-new"), accept("g-old")].join("\\n"), RUNS);
out.none = f.nearLimitCases(["mir"], "", RUNS);
// Seeds and sizes: with the exclusion, never an excluded id; without it, the same seeds and sizes pick them.
const ids = Array.from({ length: 400 }, (_, i) => "tests/ui/c" + i + ".rs");
const exclude = new Map(ids.filter((_, i) => i % 37 === 5).map((id) => [id, "slow"]));
out.sizes = { picked: 0, would: 0, wrongLength: 0, excluded: exclude.size };
for (let k = 0; k < 50; k++) {
  for (const n of [1, 16, 100, ids.length]) {
    const got = f.frozenSample(ids, n, exclude, "seed-" + k);
    if (got.length !== Math.min(n, ids.length - exclude.size)) out.sizes.wrongLength++;
    out.sizes.picked += got.filter((id) => exclude.has(id)).length;
    out.sizes.would += f.frozenSample(ids, n, new Set(), "seed-" + k).filter((id) => exclude.has(id)).length;
  }
}
// The exclusion keeps every other pick: the sample is the first ranked ids that are not excluded.
const small = ids.slice(0, 200);
const before = f.frozenSample(small, 16);
const outside = small.find((id) => !before.includes(id));
out.keep = { before, outsideExcluded: f.frozenSample(small, 16, new Set([outside])), gone: before[3], insideExcluded: f.frozenSample(small, 16, new Set([before[3]]), f.SEED) };
console.log("RESULT " + JSON.stringify(out));
`;

test("frozen lists: cases near their limit are left out of the sample, whatever the seed or size", () => {
  const r = Bun.spawnSync([process.execPath, "-e", CHILD], { cwd: REPO, stdout: "pipe", stderr: "pipe", env: { ...process.env, RUST_TS_DATA: DATA } });
  const text = r.stdout.toString() + r.stderr.toString();
  expect(r.exitCode, text).toBe(0);
  const line = text.split("\n").find((l) => l.startsWith("RESULT "));
  expect(line, text).toBeDefined();
  const j = JSON.parse(line!.slice("RESULT ".length));
  // Accepted runs come from the history's accept records, oldest first.
  expect(j.accepted).toEqual(["g-gone", "g-old", "g-new"]);
  // Every retried case of a sampled suite in any accepted run, with why; a run whose directory is gone adds nothing, and an
  // unsampled suite (run-pass-miri) is not read.
  expect(j.near).toEqual({
    ok: true,
    runs: 2,
    cases: [
      [
        "mir",
        [
          ["tests/ui/old-slow.rs", "g-old (pool TIMEOUT, 50 s alone); g-new (pool TIMEOUT, not re-run)"],
          ["tests/ui/tait.rs", "g-new (pool TIMEOUT, 46 s alone)"],
        ],
      ],
      ["mir-o2", []],
      ["check-ui", []],
    ],
  });
  // The latest accepted run must be readable and hold every sampled suite (g-old has no mir-o2).
  expect(j.missing.ok).toBe(false);
  expect(j.missing.error).toContain("the latest accepted gate run's");
  expect(j.partial).toEqual({ ok: false, error: "the latest accepted gate run g-old records no retryTimes for mir-o2" });
  expect(j.none).toEqual({ ok: false, error: "no accepted gate run in docs/state/history.jsonl" });
  // No seed and no sample size picks an excluded case; without the exclusion they do.
  expect(j.sizes.excluded).toBeGreaterThan(5);
  expect(j.sizes.picked).toBe(0);
  expect(j.sizes.wrongLength).toBe(0);
  expect(j.sizes.would).toBeGreaterThan(0);
  // Excluding an id outside the sample changes nothing; excluding one inside replaces only it.
  expect(j.keep.outsideExcluded).toEqual(j.keep.before);
  expect(j.keep.insideExcluded.filter((id: string) => !j.keep.before.includes(id))).toHaveLength(1);
  expect(j.keep.before.filter((id: string) => !j.keep.insideExcluded.includes(id))).toEqual([j.keep.gone]);
}, 60_000);
