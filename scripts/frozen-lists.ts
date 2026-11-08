// A static step of the gate (scripts/gate.ts `staticChecks`, "frozen lists"; lane harness-w44, docs/reviews/perf-heavy.md F1):
// a small fixed sample of protected cases, run with the interned lists frozen (`RUST_TS_FREEZE_LISTS=1`,
// src/rustc_middle/ty/list.ts `FREEZE_LISTS`).
//
//   bun scripts/frozen-lists.ts [--run-id ID] [--per-suite N] [--seed S]
//
// Outside tests and the alias checker the port's interned lists are not frozen (a frozen array's elements cost JSC a
// sparse map: 22% more instructions on the heavy next-solver cases), so a write to an interned list goes unnoticed by
// the gate's difftests: it changes no output until a later lookup misses. Frozen, the write throws, and the subject ICEs.
// This step runs `PER_SUITE` protected cases of each of `SUITES` that way, chosen by difftest's deterministic `sample`
// with a fixed seed (the same cases on every host and for every agent, until a baseline grows or an accepted gate records
// another case near its limit; `--seed` only for trying another). Every one must MATCH;
// anything else prints one `ERROR:` line per case and exits 1. The oracle side comes from difftest's cache (these cases
// are protected, so a gate has cached them), so the cost is the subjects' alone: about 1 to 3 s per case.
//
// Not sampled: suites whose cases run near their limit. Frozen, a heavy next-solver case runs about 22% longer (perf-heavy
// review F5: 46 s became 62 s against a limit of 60), so a sampled near-limit case would TIMEOUT. `mir-o2` has a limit of
// 240 s. `mir` and `check-ui` are mostly ordinary tests/ui files and auxiliary crates, but **`mir` has protected cases near
// its limit**: the three type-alias-impl-trait cases `recursive-drop-elaboration.rs`, `recursive-drop-elaboration-2.rs`
// and `error-tainting-issue-122904.rs` take 46-48 s of 60 alone, and time out frozen even alone (docs/reviews/w40d-audit.md
// N2). Their margin also depends on the interned lists staying unfrozen outside tests (`0d4092c4`).
//
// So the sample never takes a case the gate has recorded near its limit (`nearLimitCases`, lane harness-w45): every case in
// the `retryTimes` of an accepted gate run (docs/state/history.jsonl `accept` records; `<run>/gate.json`), that is, a case
// whose subject timed out in a gate's pool, at its limit, whatever its time alone. They are left out before sampling, so
// no seed and no sample size can pick one. A case the gate never had to retry has no recorded time: it finished inside
// its limit in the gate's 12-job pool every time. The latest accepted run's `gate.json` must be readable and hold every
// sampled suite, or the step fails (it cannot tell which cases are near their limit). Accepted runs whose run directory is
// gone (the first three, before `retryTimes` existed) add nothing.
// Details go to `$RUST_TS_DATA/runs/<run id>/` like any difftest run; nothing is written into the tree.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { difftest, sample } from "./difftest.ts";
import { REPO, RUNS, nowId, parseArgs } from "./lib/common.ts";

/** The suites sampled, in order. */
export const SUITES: readonly string[] = ["mir", "mir-o2", "check-ui"];
/** Cases per suite, unless `--per-suite`. */
export const PER_SUITE = 16;
/** The sample's seed: fixed, so every run takes the same cases (difftest's `--sample` seeds by `$RUST_TS_AGENT`). */
export const SEED = "frozen-lists";

/** The protected ids of `suite` (harness/baseline/<suite>.txt), sorted. */
function protectedIds(suite: string): string[] {
  const p = join(REPO, "harness", "baseline", `${suite}.txt`);
  return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).sort() : [];
}

/**
 * The ids sampled from `ids`, leaving out `exclude` first (see the header): the `n` remaining ids that rank first under
 * `seed`, so an excluded id can never be among them, and the cases picked are those picked before unless one is excluded.
 */
export const frozenSample = (ids: readonly string[], n: number, exclude: ReadonlyMap<string, string> | ReadonlySet<string> = new Set(), seed: string = SEED): string[] =>
  sample(ids.filter((id) => !exclude.has(id)).map((id) => ({ id })), n, seed).map((x) => x.id);

/** The protected cases of `suites` the gate has recorded near their limit (see the header), with why; or one error message. */
export type NearLimit = { ok: true; cases: Map<string, Map<string, string>>; runs: number } | { ok: false; error: string };

/** The gate runs `history` (docs/state/history.jsonl's text) records as accepted, oldest first. */
export function acceptedRuns(history: string): string[] {
  const out: string[] = [];
  for (const line of history.split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as { kind?: string; data?: { runId?: unknown } };
    if (r.kind === "accept" && typeof r.data?.runId === "string") out.push(r.data.runId);
  }
  return out;
}

interface RetryGate {
  suites?: { suite: string; retryTimes?: { id: string; status: string; pool?: { wallS?: number }; alone?: { wallS?: number } }[] }[];
}

/**
 * Every case of `suites` in the `retryTimes` of an accepted gate run under `runsDir` (see the header), keyed by suite, then
 * id, with the runs it timed out in. The latest accepted run's gate.json must exist and list every suite of `suites`.
 */
export function nearLimitCases(suites: readonly string[], history: string, runsDir: string): NearLimit {
  const runs = acceptedRuns(history);
  const latest = runs.at(-1);
  if (latest === undefined) return { ok: false, error: "no accepted gate run in docs/state/history.jsonl" };
  const cases = new Map<string, Map<string, string>>(suites.map((s) => [s, new Map()]));
  let read = 0;
  for (const runId of runs) {
    const p = join(runsDir, runId, "gate.json");
    if (!existsSync(p)) {
      if (runId === latest) return { ok: false, error: `the latest accepted gate run's ${p} is missing, so the cases it recorded near their limit are unknown` };
      continue;
    }
    let g: RetryGate;
    try {
      g = JSON.parse(readFileSync(p, "utf8")) as RetryGate;
    } catch (e) {
      return { ok: false, error: `cannot read ${p}: ${e instanceof Error ? e.message : String(e)}` };
    }
    read++;
    if (runId === latest) {
      const missing = suites.filter((s) => !g.suites?.some((x) => x.suite === s && Array.isArray(x.retryTimes)));
      if (missing.length) return { ok: false, error: `the latest accepted gate run ${runId} records no retryTimes for ${missing.join(", ")}` };
    }
    for (const s of g.suites ?? []) {
      const m = cases.get(s.suite);
      if (m === undefined) continue;
      for (const t of s.retryTimes ?? []) {
        const alone = t.alone?.wallS === undefined ? "not re-run" : `${t.alone.wallS} s alone`;
        const why = `${runId} (pool TIMEOUT, ${alone})`;
        const had = m.get(t.id);
        m.set(t.id, had === undefined ? why : `${had}; ${why}`);
      }
    }
  }
  return { ok: true, cases, runs: read };
}

export async function frozenLists(runId: string, perSuite: number, seed: string = SEED): Promise<number> {
  const historyPath = join(REPO, "docs", "state", "history.jsonl");
  const near = nearLimitCases(SUITES, existsSync(historyPath) ? readFileSync(historyPath, "utf8") : "", RUNS);
  if (!near.ok) {
    console.log(`ERROR: frozen lists: ${near.error}; the sample could take a protected case near its limit`);
    return 1;
  }
  // Every subject difftest starts inherits it (scripts/lib/env.ts keeps `RUST_TS_*`).
  process.env.RUST_TS_FREEZE_LISTS = "1";
  const started = performance.now();
  let total = 0;
  let match = 0;
  const errors: string[] = [];
  const excluded: string[] = [];
  for (const suite of SUITES) {
    const base = protectedIds(suite);
    const near1 = near.cases.get(suite)!;
    excluded.push(...base.filter((id) => near1.has(id)).map((id) => `${suite} ${id}`));
    const ids = frozenSample(base, perSuite, near1, seed);
    if (ids.length === 0) {
      errors.push(`ERROR: frozen lists: ${suite} has no protected case to sample`);
      continue;
    }
    const { results } = await difftest({ suite, runId, ids: new Set(ids), quiet: true });
    const byId = new Map(results.map((r) => [r.id, r]));
    for (const id of ids) {
      total++;
      const r = byId.get(id);
      if (r?.status === "MATCH") match++;
      else errors.push(`ERROR: frozen lists: ${suite} ${id}: ${r === undefined ? "no longer a case of the suite" : `${r.status}${r.first ? ` at ${r.first}` : ""}${r.unported ? ` (${r.unported})` : ""}${r.status === "TIMEOUT" ? "; frozen lists make a whole case run about 22-35% longer, so a protected case near its limit can time out here, though the gate never had to retry it (it is not in any accepted run's retryTimes): change the sample's seed, or exclude the case (a reviewed scripts/ change)" : ""}`}`);
    }
  }
  const secs = ((performance.now() - started) / 1000).toFixed(0);
  console.log(`frozen lists: ${match}/${total} protected cases of ${SUITES.join(", ")} MATCH with RUST_TS_FREEZE_LISTS=1 (${secs} s; run ${runId}${seed === SEED ? "" : `; seed ${seed}`})`);
  console.log(`frozen lists: left out ${excluded.length} protected case(s) near their limit (in the retryTimes of ${near.runs} accepted gate run(s))${excluded.length ? `: ${excluded.join(", ")}` : ""}`);
  for (const e of errors.slice(0, 20)) console.log(e);
  if (errors.length > 20) console.log(`ERROR: frozen lists: ${errors.length - 20} more`);
  return errors.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  const per = a["per-suite"] === undefined ? PER_SUITE : Number(a["per-suite"]);
  if (!Number.isInteger(per) || per < 1) {
    console.log(`ERROR: frozen lists: --per-suite must be a positive integer, not ${String(a["per-suite"])}`);
    process.exit(2);
  }
  const runId = typeof a["run-id"] === "string" ? a["run-id"] : `frozen-lists-${nowId()}`;
  process.exit(await frozenLists(runId, per, typeof a.seed === "string" ? a.seed : SEED));
}
