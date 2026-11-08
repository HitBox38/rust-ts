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
// and `error-tainting-issue-122904.rs` took 46-48 s of 60 alone and timed out frozen even alone (docs/reviews/w40d-audit.md
// N2); since lane perf-tait they take about 25-27 s alone, but stay left out, as frozen lists still make them about 22%
// slower and their margin also depends on the interned lists staying unfrozen outside tests (`0d4092c4`).
//
// So the sample never takes a case the gate has recorded near its limit (`nearLimitCases`, lane harness-w45): every case in
// the `retryTimes` of an accepted gate run (docs/state/history.jsonl `accept` records; `<run>/gate.json`), that is, a case
// whose subject timed out in a gate's pool, at its limit, whatever its time alone. They are left out before sampling, so
// no seed and no sample size can pick one. A case the gate never had to retry has no recorded time: it finished inside
// its limit in the gate's 12-job pool every time. The run directories are host-local, so which cases they add depends on
// what this host keeps: `KNOWN_NEAR_LIMIT`, committed, holds the cases known near their limit whatever the host keeps
// (review harness-w45 F2, N4). A missing or unreadable `gate.json`, or a malformed history line, is a `note:`, never a
// failure: a step that cannot clear without a hand restore would stop every gate after (review F2).
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

/** The protected cases of `suites` near their limit (see the header), with why, and what could not be read. */
export type NearLimit = { ok: true; cases: Map<string, Map<string, string>>; runs: number; notes: string[] };

/**
 * Cases known near their limit, kept here so that no host's run directories decide it (review harness-w45 F2). Each was
 * retried in an accepted gate: docs/reviews/w40d-audit.md N1 for the three type-alias-impl-trait ones.
 */
export const KNOWN_NEAR_LIMIT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  mir: {
    "tests/ui/type-alias-impl-trait/recursive-drop-elaboration.rs": "known: retried in accepted gates at 46-48 s alone of 60 (w40d audit N1; about 26 s since perf-tait)",
    "tests/ui/type-alias-impl-trait/recursive-drop-elaboration-2.rs": "known: retried in accepted gates at 46-48 s alone of 60 (w40d audit N1; about 26 s since perf-tait)",
    "tests/ui/type-alias-impl-trait/error-tainting-issue-122904.rs": "known: retried in accepted gates at 46-48 s alone of 60 (w40d audit N1; about 26 s since perf-tait)",
    "tests/ui/type-alias-impl-trait/hkl_forbidden.rs": "known: retried in an accepted gate (its pool run timed out)",
  },
};

/** The gate runs `history` (docs/state/history.jsonl's text) records as accepted, oldest first. */
export function acceptedRuns(history: string, notes: string[] = []): string[] {
  const out: string[] = [];
  for (const [i, line] of history.split("\n").entries()) {
    if (!line.trim()) continue;
    let r: { kind?: string; data?: { runId?: unknown } };
    try {
      r = JSON.parse(line) as typeof r;
    } catch {
      notes.push(`docs/state/history.jsonl line ${i + 1} is not JSON; it is skipped`);
      continue;
    }
    if (r.kind === "accept" && typeof r.data?.runId === "string") out.push(r.data.runId);
  }
  return out;
}

interface RetryGate {
  suites?: { suite: string; retryTimes?: { id: string; status: string; pool?: { wallS?: number }; alone?: { wallS?: number } }[] }[];
}

/**
 * Every case of `suites` in the `retryTimes` of an accepted gate run under `runsDir` (see the header), keyed by suite, then
 * id, with the runs it timed out in, plus `known`. What cannot be read is a note (see the header), never a failure.
 */
export function nearLimitCases(
  suites: readonly string[],
  history: string,
  runsDir: string,
  known: Readonly<Record<string, Readonly<Record<string, string>>>> = KNOWN_NEAR_LIMIT,
): NearLimit {
  const notes: string[] = [];
  const runs = acceptedRuns(history, notes);
  const latest = runs.at(-1);
  if (latest === undefined) notes.push("no accepted gate run in docs/state/history.jsonl");
  const cases = new Map<string, Map<string, string>>(suites.map((s) => [s, new Map(Object.entries(known[s] ?? {}))]));
  let read = 0;
  for (const runId of runs) {
    const p = join(runsDir, runId, "gate.json");
    if (!existsSync(p)) {
      if (runId === latest) notes.push(`the latest accepted gate run's ${p} is missing: only KNOWN_NEAR_LIMIT and older runs are left out`);
      continue;
    }
    let g: RetryGate;
    try {
      g = JSON.parse(readFileSync(p, "utf8")) as RetryGate;
    } catch (e) {
      notes.push(`cannot read ${p} (${e instanceof Error ? e.message : String(e)}); it adds nothing`);
      continue;
    }
    read++;
    if (runId === latest) {
      const missing = suites.filter((s) => !g.suites?.some((x) => x.suite === s && Array.isArray(x.retryTimes)));
      if (missing.length) notes.push(`the latest accepted gate run ${runId} records no retryTimes for ${missing.join(", ")}`);
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
  return { ok: true, cases, runs: read, notes };
}

export async function frozenLists(runId: string, perSuite: number, seed: string = SEED): Promise<number> {
  const historyPath = join(REPO, "docs", "state", "history.jsonl");
  const near = nearLimitCases(SUITES, existsSync(historyPath) ? readFileSync(historyPath, "utf8") : "", RUNS);
  for (const n of near.notes) console.log(`note: frozen lists: ${n}`);
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
  console.log(`frozen lists: left out ${excluded.length} protected case(s) near their limit (KNOWN_NEAR_LIMIT and the retryTimes of ${near.runs} accepted gate run(s))${excluded.length ? `: ${excluded.join(", ")}` : ""}`);
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
