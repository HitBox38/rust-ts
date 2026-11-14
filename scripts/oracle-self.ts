// Oracle against oracle, for a suite whose sides run one wrapper with `--side oracle|subject` (scripts/native-run.ts, scripts/ir-run.ts;
// lane harness-m7b): for each sampled case, the suite's oracle command, then the same command as the subject side (`--side subject`, and
// for native-run one run, `--runs 1`) still with the oracle's compiler, compared as difftest compares (stdout, stderr with its masks, and
// `Suite.maskProgramOutput`'s, exit). For a native suite that makes three runs of each program: the oracle's two, then the subject side's.
// It checks the harness, not the port: two equal outputs show that the wrapper's two sides agree when the compilers do, and that the case
// is stable; a case whose oracle output carries native-run's unstable mark is counted apart. Never reads or writes the oracle cache.
//
//   bun scripts/oracle-self.ts --suite <name> [--sample N] [--jobs N]
//
// Sample as difftest's (`--sample`, seed $RUST_TS_AGENT). Prints one summary line; per case to $RUST_TS_DATA/runs/oracle-self-<suite>-<time>.jsonl.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { suite as getSuite, type Case } from "../harness/suites.ts";
import { sample } from "./difftest.ts";
import { RUNS, UPSTREAM, die, ensureDir, nowId, parseArgs, pool, run } from "./lib/common.ts";
import { caseEnv } from "./lib/env.ts";
import { EXIT_MARK, STDERR_MARK, maskProgramOutput, maskedTexts } from "./lib/unstable.ts";

/** `cmd`, a wrapper's oracle command, as its subject side: `--side subject`, and one run where it has `--runs` (before the compiler's `--`). */
export function asSubjectSide(cmd: readonly string[]): string[] {
  const c = [...cmd];
  const end = c.indexOf("--");
  const side = c.indexOf("--side");
  if (side < 0 || (end >= 0 && side > end)) throw new Error(`oracle-self: the oracle command has no --side: ${c.slice(0, 3).join(" ")}`);
  c[side + 1] = "subject";
  const runs = c.indexOf("--runs");
  if (runs >= 0 && (end < 0 || runs < end)) c[runs + 1] = "1";
  return c;
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  if (typeof a.suite !== "string") die("usage: bun scripts/oracle-self.ts --suite <name> [--sample N] [--jobs N]");
  const s = getSuite(String(a.suite));
  const all = s.cases();
  const cases = typeof a.sample === "string" ? sample(all, Number(a.sample), process.env.RUST_TS_AGENT ?? "0") : all;
  const jobs = typeof a.jobs === "string" ? Number(a.jobs) : 4;
  const render = (p: { stdout: string; stderr: string; code: number }) => `${p.stdout}${STDERR_MARK}${p.stderr}${EXIT_MARK}${p.code} ---\n`;
  const opts = (c: Case) => ({ cwd: s.cwd ?? UPSTREAM, timeoutMs: s.oracleTimeoutMs ?? s.timeoutMs, env: caseEnv(c.env) });
  const t0 = performance.now();
  const res = await pool(cases, jobs, async (c) => {
    const o = await run(s.oracle([c]), opts(c));
    const sub = await run(asSubjectSide(s.oracle([c])), opts(c));
    const [x, y] = maskedTexts(s.miri === true, render(o), render(sub), s.maskProgramOutput ? maskProgramOutput : undefined);
    const unstable = /^native-run: unstable: (.*)$/m.exec(o.stderr)?.[1];
    return { id: c.id, equal: unstable === undefined && !o.timedOut && x === y, unstable: unstable ?? null, timedOut: o.timedOut || sub.timedOut, oracleExit: o.code, notMet: /^native-run: compiletest [^:]+: not met/m.test(o.stdout), ms: Math.round(o.ms) };
  });
  const out = join(ensureDir(RUNS), `oracle-self-${s.name}-${nowId()}.jsonl`);
  writeFileSync(out, res.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const n = (f: (r: (typeof res)[number]) => boolean) => res.filter(f).length;
  console.log(
    `oracle-self ${s.name}: ${res.length} cases in ${Math.round((performance.now() - t0) / 1000)} s: equal ${n((r) => r.equal)}, unstable ${n((r) => r.unstable !== null)}, timed out ${n((r) => r.timedOut)}, differ ${n((r) => !r.equal && r.unstable === null && !r.timedOut)}; per case: ${out}`,
  );
  const differ = res.filter((r) => !r.equal && r.unstable === null);
  if (differ.length > 0) console.log(`ERROR: oracle-self ${s.name}: ${differ.length} case(s) differ between the two sides with one compiler, first ${differ[0]!.id}`);
  process.exit(differ.length > 0 ? 1 : 0);
}
