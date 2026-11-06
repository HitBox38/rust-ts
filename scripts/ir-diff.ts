// The first differing function, line and C API call between the oracle's IR and the port's on one case (plan-m7 D17, review F6): IR's
// analogue of scripts/miri-diff.ts. Never a gate, never a status.
//
//   bun scripts/ir-diff.ts <file.rs> [options]                  a program file, compiled as ir-hello compiles its case
//   bun scripts/ir-diff.ts --suite <IR suite> --case <id>       a case of a suite with `Suite.irArgs`
//     --opt O|0        file form: `-O` (default) or `-Copt-level=0`
//     --target T       file form: default x86_64-unknown-linux-gnu
//     --tier N1|N2|N3  the tier the first difference is read at (default N1); all three are always compared
//     --calls          also trace the C API: the oracle through scripts/lib/llvm-trace.ts, the port through RUST_TS_LLVM_TRACE
//     --subject "CMD"  the port side's compiler command instead of src/rust_ts/main.ts (words split on spaces)
//     --run-id ID      output dir name under $RUST_TS_DATA/runs (default: timestamp)
//
// Each side runs through scripts/ir-run.ts with `--keep`, the case's cwd and env, over difftest's scrubbed environment. Nothing is cached:
// the oracle takes milliseconds on such a program (plan-m7 §1b).
//
// Output (AGENTS.md §4): the tier result (which tell whether names or folds are the cause, F1's classes), the first differing function
// and line with both sides' text, and with `--calls` the first differing call. When the port stops: its exit and first `unported`. Files in
// $RUST_TS_DATA/runs/<run>/ir-diff/: `oracle/`, `subject/` (raw `.ll`), `oracle.<tier>.txt`, `subject.<tier>.txt`, `oracle.calls.txt`,
// `subject.calls.txt`, `report.txt`, `report.json`. Exit: 0 the same at N1, 1 they differ or the port stops, 2 an `ERROR:`.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { IR_RUN, irFileArgs, suite as getSuite, type Case, type Suite } from "../harness/suites.ts";
import { DATA, REPO, RUNS, UPSTREAM, ensureDir, nowId, parseArgs, run } from "./lib/common.ts";
import { caseEnv } from "./lib/env.ts";
import { firstIrDifference, tierClass, type IrDifference } from "./lib/ir-diff.ts";
import { IR_TIERS, isIrTier, normalForm, type IrTier } from "./lib/ir-normal.ts";
import { compareCalls, LLVM_TRACE_ENV, parseOracleCalls, parsePortCalls, readCalls, tracerDylib, type CallVerdict } from "./lib/llvm-trace.ts";
import { llvmBinDir, llvmToolsError } from "./lib/llvm-tools.ts";
import { oracleHost, oracleSysroot, verifyOraclePin } from "./lib/oracle.ts";
import { upstreamChanges, upstreamError, upstreamStatus } from "./lib/upstream.ts";
import { unportedOf } from "./difftest.ts";

/** Console lines are cut to this many characters (the files have them whole). */
const MAX_LINE = 300;
const cut = (s: string | undefined): string => (s === undefined ? "<end>" : s.length > MAX_LINE ? `${s.slice(0, MAX_LINE)}...` : s);
const fail = (msg: string): never => {
  console.log(`ERROR: ${msg}`);
  process.exit(2);
};

/** Everything a side needs: `args` run under its compiler, in `cwd`. */
function pickCase(a: ReturnType<typeof parseArgs>): { args: string[]; cwd: string; env: Case["env"]; what: string } {
  if (typeof a.suite === "string") {
    let s: Suite | undefined;
    try {
      s = getSuite(a.suite);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
    if (!s!.irArgs) fail(`suite ${s!.name} is not an IR suite (Suite.irArgs)`);
    if (typeof a.case !== "string") fail(`--suite ${s!.name} needs --case <id>`);
    const c = s!.cases().find((x) => x.id === a.case) ?? fail(`no case ${a.case} in ${s!.name}`);
    return { args: s!.irArgs!(c), cwd: s!.cwd ?? UPSTREAM, env: c.env, what: `${s!.name} ${c.id}` };
  }
  const file = a._[0] ?? fail("give a program file, or --suite <IR suite> --case <id>");
  const abs = resolve(process.cwd(), file);
  if (!existsSync(abs)) fail(`no such file: ${abs}`);
  if (a.opt !== undefined && a.opt !== "O" && a.opt !== "0") fail(`--opt must be O or 0, not ${String(a.opt)}`);
  // The file's own directory, so its name in panic locations is the bare name on both sides. No ICE report beside the file: under
  // tests/ui it would dirty the upstream checkout (review harness-w40 L1).
  return { args: irFileArgs(basename(abs), a.opt === "0" ? "0" : "O", typeof a.target === "string" ? a.target : undefined), cwd: dirname(abs), env: { RUSTC_ICE: "0" }, what: file };
}

/** The tiers' normal forms of a side's kept `.ll`s, joined by name; undefined if it kept none. */
async function normalForms(dir: string, bin: string): Promise<Record<IrTier, string> | undefined> {
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir).filter((f) => f.endsWith(".ll")).sort();
  if (files.length === 0) return undefined;
  const out = {} as Record<IrTier, string>;
  for (const t of IR_TIERS) {
    const parts: string[] = [];
    for (const f of files) {
      const n = await normalForm(readFileSync(join(dir, f)), t, bin);
      parts.push(`ir: ${f}\n`, "error" in n ? `ir: normal form failed: ${n.error}\n` : n.text);
    }
    out[t] = parts.join("");
  }
  return out;
}

const callLines = (v: CallVerdict): string[] => {
  switch (v.kind) {
    case "match":
      return [`C API calls match (${v.calls})`];
    case "called-differently":
      return [`first differing C API call, number ${v.index}: the port called something else`, `  - ${cut(v.oracle)}`, `  + ${cut(v.port)}`];
    case "answered-differently":
      return [`first differing C API call, number ${v.index}: the same call, the model answered differently`, `  - ${cut(v.oracle)}`, `  + ${cut(v.port)}`];
    case "port-stops":
      return [`the port's calls end after ${v.index} of the oracle's; next oracle call: ${cut(v.oracle)}`];
    case "port-extra":
      return [`the port makes more calls than the oracle's ${v.index}; next: ${cut(v.port)}`];
  }
};

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (a._.length === 0 && a.suite === undefined) {
    console.log('usage: bun scripts/ir-diff.ts <file.rs> | --suite <IR suite> --case <id> [--opt O|0] [--target T] [--tier N1|N2|N3] [--calls] [--subject "CMD"] [--run-id ID]');
    process.exit(0);
  }
  const tier: IrTier = typeof a.tier === "string" ? (isIrTier(a.tier) ? a.tier : fail(`--tier must be N1, N2 or N3, not ${a.tier}`)) : "N1";
  const picked = pickCase(a);
  await verifyOraclePin();
  const sysroot = oracleSysroot();
  const host = oracleHost();
  const toolsBad = llvmToolsError(sysroot, host, false);
  if (toolsBad !== undefined) fail(toolsBad);
  const bin = llvmBinDir(sysroot, host);
  const out = ensureDir(join(RUNS, typeof a["run-id"] === "string" ? a["run-id"] : nowId(), "ir-diff"));
  const upstreamBefore = upstreamStatus(UPSTREAM);

  const wrap = (side: string, compiler: string[]) => [process.execPath, IR_RUN, "--out", out, "--side", side, "--bin", bin, "--keep", "--", ...compiler];
  const oracleTrace = join(out, "oracle.calls.raw");
  const portTrace = join(out, "subject.calls.raw");
  // Through `env`, so the tracer loads into rustc alone, and not into ir-run or the tools it runs (each would truncate the trace).
  let oracleCompiler = [join(sysroot, "bin", "rustc"), ...picked.args];
  if (a.calls) {
    try {
      oracleCompiler = ["/usr/bin/env", `DYLD_INSERT_LIBRARIES=${tracerDylib(sysroot, DATA)}`, `${LLVM_TRACE_ENV}=${oracleTrace}`, ...oracleCompiler];
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }
  const portWords = typeof a.subject === "string" ? a.subject.split(" ").filter(Boolean) : [process.execPath, join(REPO, "src/rust_ts/main.ts")];
  const portEnv: Record<string, string | null> = { ...caseEnv(picked.env), ...(a.calls ? { [LLVM_TRACE_ENV]: portTrace } : {}) };
  const o = await run(wrap("oracle", oracleCompiler), { cwd: picked.cwd, timeoutMs: 300_000, env: caseEnv(picked.env) });
  const p = await run(wrap("subject", [...portWords, ...picked.args]), { cwd: picked.cwd, timeoutMs: 1_800_000, env: portEnv });
  if (o.timedOut) fail(`the oracle timed out on ${picked.what}`);

  const of = await normalForms(join(out, "oracle"), bin);
  const pf = await normalForms(join(out, "subject"), bin);
  const lines = [`ir-diff ${picked.what} (oracle exit ${o.code}, port exit ${p.code})`];
  let diff: IrDifference | undefined;
  const same = {} as Record<IrTier, boolean>;
  if (o.code !== 0 && o.stderr.trim() !== "") lines.push(`oracle stderr: ${cut(o.stderr.trim().split("\n")[0])}`);
  if (!of) lines.push(o.code === 0 ? `ERROR: the oracle wrote no .ll for ${picked.what}; does its argv have --emit=llvm-ir?` : "the oracle wrote no IR");
  if (!pf) {
    const u = unportedOf(p);
    lines.push(`the port wrote no IR: ${p.timedOut ? "timed out" : `exit ${p.code}`}${u !== undefined ? `, rust-ts: unported: ${u}` : p.stderr.trim() !== "" ? `: ${cut(p.stderr.trim().split("\n")[0])}` : ""}`);
  }
  if (of && pf) {
    for (const t of IR_TIERS) {
      same[t] = of[t] === pf[t];
      writeFileSync(join(out, `oracle.${t}.txt`), of[t], "latin1");
      writeFileSync(join(out, `subject.${t}.txt`), pf[t], "latin1");
    }
    lines.push(`tiers: ${IR_TIERS.map((t) => `${t} ${same[t] ? "same" : "differs"}`).join(", ")}: ${tierClass(same)}`);
    diff = firstIrDifference(of[tier], pf[tier]);
    if (diff) lines.push(`first difference at ${tier}: ${diff.function !== undefined ? `function ${diff.function}` : "module level"}, line ${diff.oracleLine} of ${basename(out)}/oracle.${tier}.txt`, `  - ${cut(diff.oracle)}`, `  + ${cut(diff.port)}`);
    if (o.stderr !== p.stderr) lines.push(`stderr differs: - ${cut(o.stderr.split("\n")[0])} | + ${cut(p.stderr.split("\n")[0])}`);
  }
  let calls: CallVerdict | undefined;
  if (a.calls) {
    const oc = readCalls(oracleTrace, parseOracleCalls);
    const pc = readCalls(portTrace, parsePortCalls);
    if (oc) writeFileSync(join(out, "oracle.calls.txt"), oc.join("\n") + "\n", "latin1");
    if (pc) writeFileSync(join(out, "subject.calls.txt"), pc.join("\n") + "\n", "latin1");
    if (!oc || oc.length === 0) lines.push("ERROR: the oracle's call trace is empty: is the tracer loading?");
    if (!pc) lines.push(`the port wrote no call trace: src/rust_ts/llvm does not write ${LLVM_TRACE_ENV} yet`);
    if (oc && pc) {
      calls = compareCalls(oc, pc);
      lines.push(...callLines(calls));
    }
  }
  const changed = upstreamChanges(upstreamBefore, upstreamStatus(UPSTREAM));
  if (changed.length) lines.push(upstreamError("the upstream checkout changed during ir-diff", changed, UPSTREAM));
  lines.push(`files: ${out}`);
  writeFileSync(join(out, "report.txt"), lines.join("\n") + "\n");
  writeFileSync(join(out, "report.json"), JSON.stringify({ case: picked.what, tier, oracle: { code: o.code }, port: { code: p.code, unported: unportedOf(p) }, same, first: diff ?? null, calls: calls ?? null, upstreamChanges: changed }, null, 2) + "\n");
  for (const l of lines) console.log(l);
  const matched = of !== undefined && pf !== undefined && same.N1 && o.stderr === p.stderr && o.code === p.code;
  process.exit(lines.some((l) => l.startsWith("ERROR:")) ? 2 : matched ? 0 : 1);
}

if (import.meta.main) await main();
