// The ratchet. The protected set (harness/baseline/<suite>.txt) lists every case that has
// ever been accepted as MATCH. A revision is acceptable only if it loses none of them.
//
//   bun scripts/gate.ts run [--suites lex,parse] [--skip-static]
//       probe check + typecheck + unit tests (RUST_TS_REQUIRE_PROBES=1) + marker check + full
//       difftest of each suite; prints lost/gained
//   bun scripts/gate.ts accept --run <run-id>
//       grow the protected set with that gate run's new MATCHes. Refused if the run lost anything,
//       skipped static checks, skipped a protected suite, ran on a dirty tree, or HEAD has moved since.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { suite as getSuite } from "../harness/suites.ts";
import { difftest } from "./difftest.ts";
import { REPO, RUNS, die, nowId, parseArgs, run } from "./lib/common.ts";
import { oracleTestProbes, probeBinary } from "./probes.ts";
import { record } from "./state.ts";

const BASELINE = join(REPO, "harness", "baseline");

export function readBaseline(suite: string): Set<string> {
  const p = join(BASELINE, `${suite}.txt`);
  if (!existsSync(p)) return new Set();
  return new Set(readFileSync(p, "utf8").split("\n").filter(Boolean));
}

interface SuiteGate {
  suite: string;
  baseline: number;
  match: number;
  total: number;
  lost: string[];
  gained: string[];
  /** See `SubjectStats` in difftest.ts (informational; never affects pass/accept). */
  batchOnlyFailures?: number;
  batchOnlyTimeouts?: number;
}

/**
 * Every probe the gate needs must be built before anything runs: the oracle probes of the suites
 * it runs (`Suite.probes`) and, unless static checks are skipped, the probes the oracle unit tests
 * read (they run with RUST_TS_REQUIRE_PROBES=1, so a missing probe fails them). One `ERROR:` line
 * per missing probe, with its build command. Also checks that each suite's oracle command runs one
 * of its declared probes (or `rustc`), so `Suite.probes` cannot drift from `Suite.oracle`.
 */
export function checkProbes(suites: string[], unitTests: boolean): boolean {
  const need = new Map<string, string[]>();
  const add = (probe: string, by: string) => need.set(probe, [...(need.get(probe) ?? []), by]);
  for (const name of suites) for (const p of getSuite(name).probes ?? []) add(p, `suite ${name}`);
  if (unitTests) for (const p of oracleTestProbes()) add(p, "unit tests");
  let ok = true;
  for (const [probe, by] of [...need].sort()) {
    if (!existsSync(probeBinary(probe))) {
      console.log(`ERROR: probe '${probe}' not built (needed by ${by.join(", ")}); run: bun scripts/probes.ts build ${probe}`);
      ok = false;
    }
  }
  if (!ok) return false;
  for (const name of suites) {
    const s = getSuite(name);
    const cmd0 = s.oracle([{ id: "", file: "", args: [] }])[0]!;
    const declared = (s.probes ?? []).map(probeBinary);
    if (cmd0 !== "rustc" && !declared.includes(cmd0)) {
      console.log(`ERROR: suite ${name} runs ${cmd0} but declares probes [${(s.probes ?? []).join(", ")}]`);
      ok = false;
    }
  }
  return ok;
}

async function staticChecks(): Promise<boolean> {
  const steps: [string, string[], Record<string, string>][] = [
    ["typecheck", ["bunx", "tsc", "--noEmit", "-p", "."], {}],
    // Oracle unit tests fail (instead of skipping) when their probe is missing.
    ["unit tests", [process.execPath, "test", "src", "tools"], { RUST_TS_REQUIRE_PROBES: "1" }],
    // --offline: a vendor crate missing from cargo's cache is an ERROR, never network I/O.
    ["markers", [process.execPath, "scripts/coverage.ts", "--check", "--offline"], {}],
  ];
  let ok = true;
  for (const [name, cmd, env] of steps) {
    const r = await run(cmd, { timeoutMs: 1_800_000, env });
    const pass = r.code === 0;
    console.log(`${pass ? "ok   " : "ERROR:"} ${name}`);
    if (!pass) {
      ok = false;
      console.log((r.stdout + r.stderr).split("\n").filter(Boolean).slice(-15).join("\n"));
    }
  }
  return ok;
}

/** Commit and cleanliness of the tree under test, recorded so an accepted run names exactly what it tested. */
async function provenance(): Promise<{ head: string; dirty: string[] }> {
  const h = await run(["git", "rev-parse", "HEAD"]);
  const head = h.stdout.trim();
  if (h.code !== 0 || !/^[0-9a-f]{40}$/.test(head)) die(`git rev-parse HEAD failed: ${(h.stderr || h.stdout).trim()}`);
  const st = await run(["git", "status", "--porcelain"]);
  if (st.code !== 0) die(`git status failed: ${st.stderr.trim()}`);
  return { head, dirty: st.stdout.split("\n").filter(Boolean) };
}

function protectedSuites(): string[] {
  return readdirSync(BASELINE)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => f.slice(0, -4));
}

async function gateRun(suites: string[], skipStatic: boolean): Promise<void> {
  for (const name of suites) getSuite(name); // unknown suite names fail here
  const runId = `gate-${nowId()}`;
  const prov = await provenance();
  if (prov.dirty.length) console.log(`note: tree is dirty (${prov.dirty.length} paths); this run cannot be accepted`);
  if (!checkProbes(suites, !skipStatic)) die("missing probes; build them and re-run the gate");
  const staticOk = skipStatic ? true : await staticChecks();
  const out: SuiteGate[] = [];
  for (const suite of suites) {
    const { results, stats } = await difftest({ suite, runId, quiet: true });
    const base = readBaseline(suite);
    const match = new Set(results.filter((r) => r.status === "MATCH").map((r) => r.id));
    const lost = [...base].filter((id) => !match.has(id));
    const gained = [...match].filter((id) => !base.has(id));
    out.push({ suite, baseline: base.size, match: match.size, total: results.length, lost, gained, batchOnlyFailures: stats.batchOnlyFailures, batchOnlyTimeouts: stats.batchOnlyTimeouts });
    console.log(`${lost.length ? "ERROR:" : "ok   "} ${suite}: protected=${base.size} match=${match.size}/${results.length} lost=${lost.length} gained=${gained.length}`);
    for (const id of lost.slice(0, 20)) console.log(`  lost: ${id}`);
    if (stats.batchOnlyFailures || stats.batchOnlyTimeouts) {
      console.log(`note: ${suite}: ${stats.batchOnlyFailures} batch-only failure(s), ${stats.batchOnlyTimeouts} batch-only timeout(s) (a batch process failed at a case that passes alone; see ${suite}.summary.json)`);
    }
  }
  // The tree must be the same at the end as at the start, or the run tested a moving target.
  const after = await provenance();
  const unchanged = after.head === prov.head && after.dirty.join("\n") === prov.dirty.join("\n");
  if (!unchanged) console.log("ERROR: the tree changed while the gate was running");
  const pass = staticOk && unchanged && out.every((s) => s.lost.length === 0);
  writeFileSync(join(RUNS, runId, "gate.json"), JSON.stringify({ runId, pass, staticOk, skipStatic, head: prov.head, dirty: prov.dirty, suites: out }, null, 1));
  console.log(`gate ${pass ? "PASS" : "FAIL"} run=${runId}`);
  if (!pass) process.exit(1);
}

/** MATCH ids of one suite, re-read from the run's own per-case results (not from gate.json). */
function matchesOfRun(runId: string, suite: string): Set<string> {
  const p = join(RUNS, runId, `${suite}.jsonl`);
  if (!existsSync(p)) die(`gate run ${runId} has no results for ${suite}`);
  const ids = new Set<string>();
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line) as { id: string; status: string };
    if (r.status === "MATCH") ids.add(r.id);
  }
  return ids;
}

async function gateAccept(runId: string): Promise<void> {
  const p = join(RUNS, runId, "gate.json");
  if (!existsSync(p)) die(`no gate result at ${p}`);
  const g = JSON.parse(readFileSync(p, "utf8")) as { pass: boolean; skipStatic?: boolean; head?: string; dirty?: string[]; suites: SuiteGate[] };
  if (!g.pass) die(`gate run ${runId} did not pass; nothing accepted`);
  if (g.head === undefined || g.dirty === undefined) die(`gate run ${runId} has no provenance (older gate.ts); re-run the gate`);
  if (g.skipStatic) die(`gate run ${runId} skipped static checks; nothing accepted`);
  if (g.dirty.length) die(`gate run ${runId} ran on a dirty tree (${g.dirty.length} paths); commit, then re-run the gate`);
  const now = await provenance();
  if (now.head !== g.head) die(`gate run ${runId} tested ${g.head.slice(0, 10)} but HEAD is ${now.head.slice(0, 10)}; re-run the gate`);
  // Only state records (docs/state/) may be pending; anything else would be committed untested.
  const stray = now.dirty.filter((l) => !l.slice(3).startsWith("docs/state/"));
  if (stray.length) die(`tree is dirty outside docs/state/ (${stray.slice(0, 3).join("; ")}); commit or stash, then re-run the gate`);
  const missing = protectedSuites().filter((name) => !g.suites.some((x) => x.suite === name));
  if (missing.length) die(`gate run ${runId} did not run protected suite(s) ${missing.join(", ")}; nothing accepted`);
  const summary: Record<string, { protected: number; total: number }> = {};
  for (const s of g.suites) {
    getSuite(s.suite); // registered suite names only (also keeps the baseline path inside harness/baseline)
    const base = readBaseline(s.suite);
    const before = base.size;
    const match = matchesOfRun(runId, s.suite);
    const lost = [...base].filter((id) => !match.has(id));
    if (lost.length) die(`gate run ${runId}: ${s.suite} results lose ${lost.length} protected case(s) (e.g. ${lost[0]})`);
    for (const id of match) base.add(id);
    writeFileSync(join(BASELINE, `${s.suite}.txt`), [...base].sort().join("\n") + "\n");
    summary[s.suite] = { protected: base.size, total: s.total };
    console.log(`${s.suite}: protected set ${before} -> ${base.size}`);
  }
  record("accept", `accepted gate run ${runId} (tested ${g.head})`, { runId, head: g.head, suites: summary });
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (cmd === "run") {
    const suites =
      typeof a.suites === "string"
        ? a.suites.split(",")
        : protectedSuites();
    await gateRun(suites, Boolean(a["skip-static"]));
  } else if (cmd === "accept" && typeof a.run === "string") {
    await gateAccept(a.run);
  } else {
    console.log("usage: bun scripts/gate.ts run [--suites a,b] [--skip-static] | accept --run <run-id>");
  }
}
