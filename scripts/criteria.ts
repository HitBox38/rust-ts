// Milestone figures that span suites (plan-m6 A12). A suite's `criterion` line in its run covers that suite alone; a
// milestone group sums MATCH and the denominator (ORACLE_TIMEOUT excluded, A9) over every suite of the group.
//
//   bun scripts/criteria.ts --run <gate run id> [--milestone <prefix>]
//
// `--milestone M6b` (or any prefix of a group's milestone) prints and decides only those groups; with none, every group.
// M7a (plan-m7 §6 "Gates") is here only as far as a gate can compute it today: `ir-hello` MATCH, `mir-o2` and `mono-ui` >= 99%, and
// `check-rg` >= 33 of its 34 crates. `ir-hello` is in no gate yet (it has no baseline): name it with `gate.ts run --suites`. M7b and M7c
// (lane harness-m7b): `native-hello` MATCH, `run-pass-native` >= 80% and `ir-run-pass` >= 70%; then `run-pass-native` >= 98%,
// `run-fail-native` >= 95% and `ir-run-pass` >= 95%. Those suites have no baseline either, so a gate must name them with `--suites`.
// The M7 percent groups leave UNSTABLE cases out of the denominator as well as ORACLE_TIMEOUT (`excludeUnstable`, plan-m7 §6); M6's do not.
// M7c's `run-pass-native` "+ heavy" is that suite alone until a heavy sibling exists (docs/handoff/harness-m7b.md). M7d (lane
// harness-m7d): `rg-build` MATCH (its one case), `rg-behaviour` MATCH (the scripted queries, every case), `check-rg` 34 of its 34 crates and at
// least one `pm-self` MATCH (`minMatch`); only `check-rg` has a baseline, so a gate must name the others with `--suites`. The crate count needs per-case results, which gate.json has only as the protected set and its changes:
// MATCH is exactly (the baseline at the gate's commit - lost) + gained, as scripts/gate.ts computes those two.
//
// Every number comes from that run's `gate.json`, one snapshot of one commit: a `<suite>.summary.json` can be overwritten
// later (`difftest --run-id`), and so can mix trees. A group is met only if the gate passed on a clean tree, with its
// static steps, and ran every suite of the group and every protected suite at that gate's commit: a narrowed gate says nothing about losses
// (review integ-w38-recheck N3). Prints one line per group, then one verdict line per milestone and a line saying what the exit status
// means; exits 1 if a selected group is not met, so `--milestone M7` exits 1 while M7c is unmet even when M7a and M7b are met: read the
// `milestone M7a: met` lines, not the status (review harness-m7b-recheck note 1). Report only: `scripts/gate.ts` does not read it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface CriteriaGroup {
  name: string;
  /** The plan's milestone, which `--milestone` selects by prefix. */
  milestone: string;
  suites: string[];
  /** MATCH over the group's cases, ORACLE_TIMEOUT excluded (plan-m6 A9), at least this percent. */
  percent: number;
  /** Every case: an oracle timeout counts against it rather than being left out. */
  allCases?: boolean;
  /**
   * UNSTABLE cases (the oracle's output is not reproducible) are left out of the denominator too, as plan-m7 §6 says for every M7 figure
   * ("Denominators exclude ORACLE_TIMEOUT and oracle-unstable cases"; root's decision for review harness-m7b F2). plan-m6 A9's groups
   * leave out only ORACLE_TIMEOUT, and keep doing so. Needs gate.json's per-suite `unstable` list.
   */
  excludeUnstable?: boolean;
  /**
   * A count instead of a percent: at least `atLeast` MATCH among the cases whose id matches `cases`, of the `of` the plan counts.
   * Read from the protected set and gate.json's `lost` and `gained` (see the header).
   */
  count?: { cases: RegExp; atLeast: number; of: number; what: string };
  /** At least this many MATCH among the group's cases, besides `percent` (plan-m7 §6 M7d: "1 `pm-self` case"). */
  minMatch?: number;
}

export const GROUPS: CriteriaGroup[] = [
  { name: "plan-m6 M6b run-pass", milestone: "M6b", suites: ["run-pass-miri", "run-pass-miri-heavy"], percent: 90 },
  { name: "plan-m6 M6b run-fail", milestone: "M6b", suites: ["run-fail-miri"], percent: 90 },
  { name: "plan-m6 M6b miri-pass", milestone: "M6b", suites: ["miri-pass", "miri-pass-heavy"], percent: 80 },
  // The plan says `ir-hello` MATCH: both cases, so an oracle timeout does not leave it met on the other (review harness-w43 F3).
  { name: "plan-m7 M7a ir-hello", milestone: "M7a", suites: ["ir-hello"], percent: 100, allCases: true },
  { name: "plan-m7 M7a mir-o2", milestone: "M7a", suites: ["mir-o2"], percent: 99, excludeUnstable: true },
  { name: "plan-m7 M7a mono-ui", milestone: "M7a", suites: ["mono-ui"], percent: 99, excludeUnstable: true },
  // A crate's case is `ripgrep-<version>|<crate>`; not the run's own case, nor a build script's probe (`|<crate> (a build script's probe)`).
  { name: "plan-m7 M7a check-rg", milestone: "M7a", suites: ["check-rg"], percent: 0, count: { cases: /^ripgrep-[^|]+\|\w+$/, atLeast: 33, of: 34, what: "crates" } },
  // One case: an oracle timeout must not leave it met, as ir-hello.
  { name: "plan-m7 M7b native-hello", milestone: "M7b", suites: ["native-hello"], percent: 100, allCases: true },
  { name: "plan-m7 M7b run-pass-native", milestone: "M7b", suites: ["run-pass-native"], percent: 80, excludeUnstable: true },
  { name: "plan-m7 M7b ir-run-pass", milestone: "M7b", suites: ["ir-run-pass"], percent: 70, excludeUnstable: true },
  { name: "plan-m7 M7c run-pass-native", milestone: "M7c", suites: ["run-pass-native"], percent: 98, excludeUnstable: true },
  { name: "plan-m7 M7c run-fail-native", milestone: "M7c", suites: ["run-fail-native"], percent: 95, excludeUnstable: true },
  { name: "plan-m7 M7c ir-run-pass", milestone: "M7c", suites: ["ir-run-pass"], percent: 95, excludeUnstable: true },
  // One case each way: an oracle timeout or an unstable case must not leave either met (as ir-hello).
  { name: "plan-m7 M7d rg-build", milestone: "M7d", suites: ["rg-build"], percent: 100, allCases: true },
  { name: "plan-m7 M7d rg-behaviour", milestone: "M7d", suites: ["rg-behaviour"], percent: 100, allCases: true },
  { name: "plan-m7 M7d check-rg", milestone: "M7d", suites: ["check-rg"], percent: 0, count: { cases: /^ripgrep-[^|]+\|\w+$/, atLeast: 34, of: 34, what: "crates" } },
  { name: "plan-m7 M7d pm-self", milestone: "M7d", suites: ["pm-self"], percent: 0, minMatch: 1, excludeUnstable: true },
];

/** The fields of `gate.json` this reads. */
export interface GateRecord {
  pass: boolean;
  staticOk: boolean;
  skipStatic: boolean;
  head: string;
  dirty: string[];
  suites: { suite: string; match: number; total: number; oracleTimeouts: string[]; unstable?: string[]; lost?: string[]; gained?: string[] }[];
}

export interface GroupResult {
  name: string;
  match: number;
  of: number;
  oracleTimeouts: number;
  /** UNSTABLE cases left out (`excludeUnstable` groups only; 0 otherwise). */
  unstable: number;
  percent: number;
  target: number;
  met: boolean;
  /** A count group's `atLeast`, and what it counts. */
  count?: { atLeast: number; what: string };
  /** The group's `minMatch`. */
  minMatch?: number;
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

/** What a `gate.json` lacks of the fields this reads, or undefined (review harness-m6c-recheck L7: one ERROR line, not a stack trace). */
export function gateRecordProblem(g: unknown): string | undefined {
  const r = g as Partial<GateRecord> | null;
  if (typeof r !== "object" || r === null) return "not an object";
  if (typeof r.pass !== "boolean" || typeof r.staticOk !== "boolean" || typeof r.skipStatic !== "boolean") return "pass, staticOk or skipStatic is missing";
  if (typeof r.head !== "string" || !Array.isArray(r.dirty) || !Array.isArray(r.suites)) return "head, dirty or suites is missing";
  const bad = r.suites.find((s) => typeof s?.suite !== "string" || typeof s.match !== "number" || typeof s.total !== "number" || !Array.isArray(s.oracleTimeouts));
  return bad === undefined ? undefined : `a suites entry lacks suite, match, total or oracleTimeouts: ${JSON.stringify(bad)?.slice(0, 200)}`;
}

/** The protected suites `g` did not run, as one problem, or none. */
export function protectedNotRun(g: GateRecord, protectedSuites: readonly string[]): string[] {
  const missing = protectedSuites.filter((p) => !g.suites.some((s) => s.suite === p));
  return missing.length === 0 ? [] : [`${missing.length} protected suite(s) not in this gate, so losses are unknown (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", ..." : ""})`];
}

/**
 * A count group's figure: the MATCH cases among those `count.cases` names, from the protected set at the gate's commit
 * (`baselines`, by suite) less `lost` plus `gained`.
 */
function countResult(group: CriteriaGroup & { count: NonNullable<CriteriaGroup["count"]> }, g: GateRecord, problems: string[], baselines: ReadonlyMap<string, readonly string[]>): GroupResult {
  const c = group.count;
  const matched = new Set<string>();
  const seen = new Set<string>();
  let oracleTimeouts = 0;
  for (const name of group.suites) {
    const s = g.suites.find((x) => x.suite === name);
    if (s === undefined) {
      problems.push(`${name}: not in this gate`);
      continue;
    }
    const base = baselines.get(name);
    if (base === undefined || s.lost === undefined || s.gained === undefined) {
      problems.push(`${name}: no protected set, lost or gained to count ${c.what} from`);
      continue;
    }
    const lost = new Set(s.lost);
    for (const id of [...base, ...s.lost, ...s.gained, ...s.oracleTimeouts]) if (c.cases.test(id)) seen.add(id);
    for (const id of [...base.filter((x) => !lost.has(x)), ...s.gained]) if (c.cases.test(id)) matched.add(id);
    oracleTimeouts += s.oracleTimeouts.filter((id) => c.cases.test(id)).length;
  }
  // A case list the plan's count no longer describes (another ripgrep, say): the target needs a new decision, not a quiet pass.
  if (seen.size > c.of) problems.push(`${seen.size} ${c.what} seen, where the plan counts ${c.of}`);
  const match = matched.size;
  const percent = Math.round(((100 * match) / c.of) * 100) / 100;
  return { name: group.name, match, of: c.of, oracleTimeouts, unstable: 0, percent, target: Math.round(((100 * c.atLeast) / c.of) * 100) / 100, met: problems.length === 0 && match >= c.atLeast, count: { atLeast: c.atLeast, what: c.what }, problems };
}

/**
 * The verdict of each milestone among `results` (each group's `milestone` and whether it is met), in the order they first
 * appear, and a last line saying what the exit status means (review harness-m7b-recheck note 1): `--milestone M7` exits 1
 * while M7c is unmet though M7a and M7b are met, so the status alone must not be read as any one sub-milestone's.
 */
export function milestoneVerdicts(results: readonly { milestone: string; met: boolean }[]): string[] {
  const by = new Map<string, { met: number; of: number }>();
  for (const r of results) {
    const m = by.get(r.milestone) ?? { met: 0, of: 0 };
    m.of++;
    if (r.met) m.met++;
    by.set(r.milestone, m);
  }
  const lines = [...by].map(([name, m]) => `milestone ${name}: ${m.met === m.of ? "met" : "not met"} (${m.met} of ${m.of} groups met)`);
  const unmet = [...by].filter(([, m]) => m.met < m.of).map(([name]) => name);
  const met = [...by].filter(([, m]) => m.met === m.of).map(([name]) => name);
  if (unmet.length === 0) lines.push(`exit 0: every selected milestone is met (${met.join(", ")})`);
  else lines.push(`exit 1: not met: ${unmet.join(", ")}${met.length ? `; met all the same: ${met.join(", ")} (read each milestone's line, not the exit status)` : ""}`);
  return lines;
}

/** `baselines`: the protected set at the gate's commit, by suite; only a count group reads it. */
export function groupResult(group: CriteriaGroup, g: GateRecord, protectedSuites: readonly string[] = [], baselines: ReadonlyMap<string, readonly string[]> = new Map()): GroupResult {
  if (group.count !== undefined) return countResult({ ...group, count: group.count }, g, [...gateProblems(g), ...protectedNotRun(g, protectedSuites)], baselines);
  let match = 0;
  let of = 0;
  let oracleTimeouts = 0;
  let unstable = 0;
  const problems = [...gateProblems(g), ...protectedNotRun(g, protectedSuites)];
  for (const name of group.suites) {
    const s = g.suites.find((x) => x.suite === name);
    if (s === undefined) {
      problems.push(`${name}: not in this gate`);
      continue;
    }
    match += s.match;
    let left = group.allCases ? 0 : s.oracleTimeouts.length;
    if (group.excludeUnstable && !group.allCases) {
      if (!Array.isArray(s.unstable)) problems.push(`${name}: this gate.json has no unstable list to leave out`);
      else left += s.unstable.length;
      unstable += s.unstable?.length ?? 0;
    }
    of += s.total - left;
    oracleTimeouts += s.oracleTimeouts.length;
  }
  const percent = of ? Math.round(((100 * match) / of) * 100) / 100 : 0;
  // On the exact counts, not the rounded percentage.
  const met = problems.length === 0 && of > 0 && 100 * match >= group.percent * of && match >= (group.minMatch ?? 0);
  return { name: group.name, match, of, oracleTimeouts, unstable, percent, target: group.percent, met, problems, ...(group.minMatch !== undefined ? { minMatch: group.minMatch } : {}) };
}

if (import.meta.main) {
  // Loaded here, not at the top: common.ts fixes the data directory when it loads, and a test file sharing a process with
  // criteria.test.ts (lib/deps.test.ts) sets its own first.
  const { REPO, RUNS, die, parseArgs } = await import("./lib/common.ts");
  const readGate = (run: string): GateRecord => {
    const f = join(RUNS, run, "gate.json");
    if (!existsSync(f)) die(`${run} has no gate.json: a milestone figure comes from a gate run`);
    let g: unknown;
    try {
      g = JSON.parse(readFileSync(f, "utf8"));
    } catch (e) {
      die(`${f} is not readable JSON: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
    const problem = gateRecordProblem(g);
    if (problem !== undefined) die(`${f}: ${problem}`);
    return g as GateRecord;
  };
  const a = parseArgs(process.argv.slice(2));
  if (typeof a.run !== "string" || (a.milestone !== undefined && typeof a.milestone !== "string")) {
    die("usage: bun scripts/criteria.ts --run <gate run id> [--milestone <prefix>]");
    process.exit(1);
  }
  const groups = GROUPS.filter((x) => a.milestone === undefined || x.milestone.startsWith(a.milestone as string));
  if (groups.length === 0) die(`no criteria group has a milestone starting with ${a.milestone}`);
  const g = readGate(a.run);
  console.log(`gate ${a.run} at ${g.head.slice(0, 10)}: pass=${g.pass}`);
  // The protected set of the gate's own commit: a later commit may have grown it.
  const ls = Bun.spawnSync(["git", "ls-tree", "--name-only", g.head, "harness/baseline/"], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  if (ls.exitCode !== 0) die(`cannot read the protected set of ${g.head}: ${ls.stderr.toString().trim().split("\n")[0]}`);
  const protectedSuites = ls.stdout.toString().split("\n").filter((f) => f.endsWith(".txt")).map((f) => f.slice("harness/baseline/".length, -".txt".length));
  // A count group's protected set, at the gate's commit, as `readBaseline` read it there.
  const baselines = new Map<string, string[]>();
  for (const suite of new Set(groups.filter((x) => x.count).flatMap((x) => x.suites))) {
    if (!protectedSuites.includes(suite)) continue;
    const show = Bun.spawnSync(["git", "show", `${g.head}:harness/baseline/${suite}.txt`], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
    if (show.exitCode !== 0) die(`cannot read ${suite}'s protected set at ${g.head}: ${show.stderr.toString().trim().split("\n")[0]}`);
    baselines.set(suite, show.stdout.toString().split("\n").filter(Boolean));
  }
  let allMet = true;
  const verdicts: { milestone: string; met: boolean }[] = [];
  for (const group of groups) {
    const r = groupResult(group, g, protectedSuites, baselines);
    allMet &&= r.met;
    verdicts.push({ milestone: group.milestone, met: r.met });
    const why = r.problems.length ? ` (${r.problems.join("; ")})` : "";
    if (r.minMatch !== undefined) console.log(`${r.name}: MATCH ${r.match} of ${r.of} cases vs >= ${r.minMatch}, ${r.oracleTimeouts} oracle timeouts ${group.allCases ? "counted" : "excluded"}: ${r.met ? "met" : "not met"}${why}`);
    else if (r.count) console.log(`${r.name}: MATCH ${r.match} of ${r.of} ${r.count.what} vs >= ${r.count.atLeast}, ${r.oracleTimeouts} oracle timeouts: ${r.met ? "met" : "not met"}${why}`);
    else console.log(`${r.name}: MATCH ${r.match}/${r.of} = ${r.percent}% vs >= ${r.target}%, ${r.oracleTimeouts} oracle timeouts ${group.allCases ? "counted" : "excluded"}${group.excludeUnstable && !group.allCases ? `, ${r.unstable} unstable excluded` : ""}: ${r.met ? "met" : "not met"}${why}`);
  }
  for (const line of milestoneVerdicts(verdicts)) console.log(line);
  process.exit(allMet ? 0 : 1);
}
