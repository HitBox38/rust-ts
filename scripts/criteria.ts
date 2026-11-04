// Milestone figures that span suites (plan-m6 A12). A suite's `criterion` line in its run covers that suite alone; a
// milestone group sums MATCH and the denominator (ORACLE_TIMEOUT excluded, A9) over every suite of the group.
//
//   bun scripts/criteria.ts --run <gate run id>
//
// Every number comes from that run's `gate.json`, one snapshot of one commit: a `<suite>.summary.json` can be overwritten
// later (`difftest --run-id`), and so can mix trees. A group is met only if the gate passed on a clean tree, with its
// static steps, and ran every suite of the group. Prints one line per group; exits 1 if a group is not met. Report only:
// `scripts/gate.ts` does not read it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RUNS, die, parseArgs } from "./lib/common.ts";

export interface CriteriaGroup {
  name: string;
  suites: string[];
  percent: number;
}

export const GROUPS: CriteriaGroup[] = [
  { name: "plan-m6 M6b run-pass", suites: ["run-pass-miri", "run-pass-miri-heavy"], percent: 90 },
  { name: "plan-m6 M6b run-fail", suites: ["run-fail-miri"], percent: 90 },
  { name: "plan-m6 M6b miri-pass", suites: ["miri-pass", "miri-pass-heavy"], percent: 80 },
];

/** The fields of `gate.json` this reads. */
export interface GateRecord {
  pass: boolean;
  staticOk: boolean;
  skipStatic: boolean;
  head: string;
  dirty: string[];
  suites: { suite: string; match: number; total: number; oracleTimeouts: string[] }[];
}

export interface GroupResult {
  name: string;
  match: number;
  of: number;
  oracleTimeouts: number;
  percent: number;
  target: number;
  met: boolean;
  /** Why this is not a figure of one clean gate: the gate's own state, and suites it did not run. */
  problems: string[];
}

/** Why a gate's numbers cannot decide a milestone, whatever they are. */
export function gateProblems(g: GateRecord): string[] {
  const problems: string[] = [];
  if (!g.pass) problems.push("the gate did not pass");
  if (!g.staticOk || g.skipStatic) problems.push("the gate's static steps did not run clean");
  if (g.dirty.length > 0) problems.push("the gate's tree was dirty");
  return problems;
}

export function groupResult(group: CriteriaGroup, g: GateRecord): GroupResult {
  let match = 0;
  let of = 0;
  let oracleTimeouts = 0;
  const problems = gateProblems(g);
  for (const name of group.suites) {
    const s = g.suites.find((x) => x.suite === name);
    if (s === undefined) {
      problems.push(`${name}: not in this gate`);
      continue;
    }
    match += s.match;
    of += s.total - s.oracleTimeouts.length;
    oracleTimeouts += s.oracleTimeouts.length;
  }
  const percent = of ? Math.round(((100 * match) / of) * 100) / 100 : 0;
  // On the exact counts, not the rounded percentage.
  const met = problems.length === 0 && of > 0 && 100 * match >= group.percent * of;
  return { name: group.name, match, of, oracleTimeouts, percent, target: group.percent, met, problems };
}

function readGate(run: string): GateRecord {
  const f = join(RUNS, run, "gate.json");
  if (!existsSync(f)) die(`${run} has no gate.json: a milestone figure comes from a gate run`);
  try {
    return JSON.parse(readFileSync(f, "utf8")) as GateRecord;
  } catch (e) {
    die(`${f} is not readable JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  if (typeof a.run !== "string") die("usage: bun scripts/criteria.ts --run <gate run id>");
  const g = readGate(a.run);
  console.log(`gate ${a.run} at ${g.head.slice(0, 10)}: pass=${g.pass}`);
  let allMet = true;
  for (const group of GROUPS) {
    const r = groupResult(group, g);
    allMet &&= r.met;
    const why = r.problems.length ? ` (${r.problems.join("; ")})` : "";
    console.log(`${r.name}: MATCH ${r.match}/${r.of} = ${r.percent}% vs >= ${r.target}%, ${r.oracleTimeouts} oracle timeouts excluded: ${r.met ? "met" : "not met"}${why}`);
  }
  process.exit(allMet ? 0 : 1);
}
