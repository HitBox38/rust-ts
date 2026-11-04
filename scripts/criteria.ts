// Milestone figures that span suites (plan-m6 A12). A suite's `criterion` line in its run covers that suite alone; a
// milestone group sums MATCH and the denominator (ORACLE_TIMEOUT excluded, A9) over every suite of the group, from one
// run directory, and only full runs count: a missing suite, a `--sample` or a `--filter` leaves the group not met.
//
//   bun scripts/criteria.ts --run <run id>
//
// Prints one line per group; exits 1 if a group is not met. Report only: `scripts/gate.ts` does not read it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RUNS, die, parseArgs } from "./lib/common.ts";

export interface CriteriaGroup {
  name: string;
  suites: string[];
  percent: number;
}

export const GROUPS: CriteriaGroup[] = [
  { name: "plan-m6 M6b run-pass", suites: ["run-pass-miri", "run-pass-miri-heavy", "run-fail-miri"], percent: 90 },
  { name: "plan-m6 M6b miri-pass", suites: ["miri-pass", "miri-pass-heavy"], percent: 80 },
];

/** The fields of `<suite>.summary.json` this reads; `undefined` is a suite the run does not have. */
export interface SuiteSummary {
  total: number;
  MATCH: number;
  ORACLE_TIMEOUT: number;
  sample: unknown;
  filter: unknown;
}

export interface GroupResult {
  name: string;
  match: number;
  of: number;
  percent: number;
  target: number;
  met: boolean;
  /** Why the sum is not a full figure: suites missing from the run or not run in full. */
  problems: string[];
}

export function groupResult(group: CriteriaGroup, summaryOf: (suite: string) => SuiteSummary | undefined): GroupResult {
  let match = 0;
  let of = 0;
  const problems: string[] = [];
  for (const suite of group.suites) {
    const s = summaryOf(suite);
    if (s === undefined) {
      problems.push(`${suite}: not in this run`);
      continue;
    }
    if ((s.sample ?? null) !== null || (s.filter ?? null) !== null) problems.push(`${suite}: not a full run`);
    match += s.MATCH;
    of += s.total - s.ORACLE_TIMEOUT;
  }
  const percent = of ? Math.round(((100 * match) / of) * 100) / 100 : 0;
  // On the exact counts, not the rounded percentage.
  const met = problems.length === 0 && of > 0 && 100 * match >= group.percent * of;
  return { name: group.name, match, of, percent, target: group.percent, met, problems };
}

function readSummary(dir: string, suite: string): SuiteSummary | undefined {
  const f = join(dir, `${suite}.summary.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as SuiteSummary) : undefined;
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  if (typeof a.run !== "string") die("usage: bun scripts/criteria.ts --run <run id>");
  const dir = join(RUNS, a.run);
  if (!existsSync(dir)) die(`no run directory ${dir}`);
  let allMet = true;
  for (const g of GROUPS) {
    const r = groupResult(g, (s) => readSummary(dir, s));
    allMet &&= r.met;
    const why = r.problems.length ? ` (${r.problems.join("; ")})` : "";
    console.log(`${r.name}: MATCH ${r.match}/${r.of} = ${r.percent}% vs >= ${r.target}%: ${r.met ? "met" : "not met"}${why}`);
  }
  process.exit(allMet ? 0 : 1);
}
