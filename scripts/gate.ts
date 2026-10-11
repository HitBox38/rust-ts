// The ratchet. The protected set (harness/baseline/<suite>.txt) lists every case that has
// ever been accepted as MATCH. A revision is acceptable only if it loses none of them.
//
//   bun scripts/gate.ts run [--suites lex,parse] [--skip-static]
//       typecheck + unit tests + marker check + full difftest of each suite; prints lost/gained
//   bun scripts/gate.ts accept --run <run-id>
//       grow the protected set with that gate run's new MATCHes (refused if it lost anything)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { difftest } from "./difftest.ts";
import { REPO, RUNS, die, nowId, parseArgs, run } from "./lib/common.ts";
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
}

async function staticChecks(): Promise<boolean> {
  const steps: [string, string[]][] = [
    ["typecheck", ["bunx", "tsc", "--noEmit", "-p", "."]],
    ["unit tests", [process.execPath, "test", "src"]],
    ["markers", [process.execPath, "scripts/coverage.ts", "--check"]],
  ];
  let ok = true;
  for (const [name, cmd] of steps) {
    const r = await run(cmd, { timeoutMs: 1_800_000 });
    const pass = r.code === 0;
    console.log(`${pass ? "ok   " : "ERROR:"} ${name}`);
    if (!pass) {
      ok = false;
      console.log((r.stdout + r.stderr).split("\n").filter(Boolean).slice(-15).join("\n"));
    }
  }
  return ok;
}

async function gateRun(suites: string[], skipStatic: boolean): Promise<void> {
  const runId = `gate-${nowId()}`;
  const staticOk = skipStatic ? true : await staticChecks();
  const out: SuiteGate[] = [];
  for (const suite of suites) {
    const { results } = await difftest({ suite, runId, quiet: true });
    const base = readBaseline(suite);
    const match = new Set(results.filter((r) => r.status === "MATCH").map((r) => r.id));
    const lost = [...base].filter((id) => !match.has(id));
    const gained = [...match].filter((id) => !base.has(id));
    out.push({ suite, baseline: base.size, match: match.size, total: results.length, lost, gained });
    console.log(`${lost.length ? "ERROR:" : "ok   "} ${suite}: protected=${base.size} match=${match.size}/${results.length} lost=${lost.length} gained=${gained.length}`);
    for (const id of lost.slice(0, 20)) console.log(`  lost: ${id}`);
  }
  const pass = staticOk && out.every((s) => s.lost.length === 0);
  writeFileSync(join(RUNS, runId, "gate.json"), JSON.stringify({ runId, pass, staticOk, suites: out }, null, 1));
  console.log(`gate ${pass ? "PASS" : "FAIL"} run=${runId}`);
  if (!pass) process.exit(1);
}

function gateAccept(runId: string): void {
  const p = join(RUNS, runId, "gate.json");
  if (!existsSync(p)) die(`no gate result at ${p}`);
  const g = JSON.parse(readFileSync(p, "utf8")) as { pass: boolean; suites: SuiteGate[] };
  if (!g.pass) die(`gate run ${runId} did not pass; nothing accepted`);
  const summary: Record<string, { protected: number; total: number }> = {};
  for (const s of g.suites) {
    const base = readBaseline(s.suite);
    for (const id of s.gained) base.add(id);
    writeFileSync(join(BASELINE, `${s.suite}.txt`), [...base].sort().join("\n") + "\n");
    summary[s.suite] = { protected: base.size, total: s.total };
    console.log(`${s.suite}: protected set ${s.baseline} -> ${base.size}`);
  }
  record("accept", `accepted gate run ${runId}`, { runId, suites: summary });
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (cmd === "run") {
    const suites =
      typeof a.suites === "string"
        ? a.suites.split(",")
        : readdirSync(BASELINE)
            .filter((f) => f.endsWith(".txt"))
            .map((f) => f.slice(0, -4));
    await gateRun(suites, Boolean(a["skip-static"]));
  } else if (cmd === "accept" && typeof a.run === "string") {
    gateAccept(a.run);
  } else {
    console.log("usage: bun scripts/gate.ts run [--suites a,b] [--skip-static] | accept --run <run-id>");
  }
}
