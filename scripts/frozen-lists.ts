// A static step of the gate (scripts/gate.ts `staticChecks`, "frozen lists"; lane harness-w44, docs/reviews/perf-heavy.md F1):
// a small fixed sample of protected cases, run with the interned lists frozen (`RUST_TS_FREEZE_LISTS=1`,
// src/rustc_middle/ty/list.ts `FREEZE_LISTS`).
//
//   bun scripts/frozen-lists.ts [--run-id ID] [--per-suite N]
//
// Outside tests and the alias checker the port's interned lists are not frozen (a frozen array's elements cost JSC a
// sparse map: 22% more instructions on the heavy next-solver cases), so a write to an interned list goes unnoticed by
// the gate's difftests: it changes no output until a later lookup misses. Frozen, the write throws, and the subject ICEs.
// This step runs `PER_SUITE` protected cases of each of `SUITES` that way, chosen by difftest's deterministic `sample`
// with a fixed seed (the same cases on every host and for every agent, until a baseline grows). Every one must MATCH;
// anything else prints one `ERROR:` line per case and exits 1. The oracle side comes from difftest's cache (these cases
// are protected, so a gate has cached them), so the cost is the subjects' alone: about 1 to 3 s per case.
//
// Not sampled: suites whose cases run near their limit. Frozen, a heavy next-solver case runs about 22% longer (perf-heavy
// review F5: 46 s became 62 s against a limit of 60), so a sampled near-limit case would TIMEOUT. `mir` and `check-ui`
// cases are ordinary tests/ui files and auxiliary crates; `mir-o2` has a limit of 240 s.
// Details go to `$RUST_TS_DATA/runs/<run id>/` like any difftest run; nothing is written into the tree.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { difftest, sample } from "./difftest.ts";
import { REPO, nowId, parseArgs } from "./lib/common.ts";

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

/** The ids sampled from `ids` (see the header). */
export const frozenSample = (ids: readonly string[], n: number): string[] => sample(ids.map((id) => ({ id })), n, SEED).map((x) => x.id);

export async function frozenLists(runId: string, perSuite: number): Promise<number> {
  // Every subject difftest starts inherits it (scripts/lib/env.ts keeps `RUST_TS_*`).
  process.env.RUST_TS_FREEZE_LISTS = "1";
  const started = performance.now();
  let total = 0;
  let match = 0;
  const errors: string[] = [];
  for (const suite of SUITES) {
    const ids = frozenSample(protectedIds(suite), perSuite);
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
      else errors.push(`ERROR: frozen lists: ${suite} ${id}: ${r === undefined ? "no longer a case of the suite" : `${r.status}${r.first ? ` at ${r.first}` : ""}${r.unported ? ` (${r.unported})` : ""}`}`);
    }
  }
  const secs = ((performance.now() - started) / 1000).toFixed(0);
  console.log(`frozen lists: ${match}/${total} protected cases of ${SUITES.join(", ")} MATCH with RUST_TS_FREEZE_LISTS=1 (${secs} s; run ${runId})`);
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
  process.exit(await frozenLists(runId, per));
}
