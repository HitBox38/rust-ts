// The first differing `MIRI_LOG=info` trace event between the Miri oracle and the port on one case (plan-m6 D10, A6;
// lane miri-diff): the interpreter's analogue of scripts/phase-diff.ts. Never a gate, never a status.
//
//   bun scripts/miri-diff.ts <file.rs> [options]               a program file, run as `miri-hello` runs its case
//   bun scripts/miri-diff.ts --suite <miri suite> --case <id>  a case of a Miri suite (`Suite.miri`)
//     --impl I      RUST_TS_IMPL for the port side (default port)
//     --run-id ID   output dir name under $RUST_TS_DATA/runs (default: timestamp)
//     --no-cache    run the oracle even if its trace is cached (the fresh trace replaces the entry)
//
// Both sides run exactly as the suite runs them (harness/suites.ts: the suite's `oracle` / `subject` commands, its cwd,
// the case's env over difftest's scrubbed environment, scripts/lib/env.ts `caseEnv`) plus `MIRI_LOG=info`
// (`MIRI_TRACE_ENV`). A file path gives `miriFileCase(<file>)` in suite `miri-hello` (Miri's plain argv, cwd the repo;
// the path is taken relative to the repo when it is inside it, else absolute). The port side is whatever the Miri
// suites run (harness/suites.ts `MIRI_SUBJECT_ENTRY`).
//
// Each side's stderr is normalised (scripts/lib/miri-trace.ts: event and span-opening records only, without
// indentation or colours; the program's own output and diagnostics are "other" lines). The oracle's raw output is
// cached under $RUST_TS_DATA/miri-diff-cache/, keyed as difftest keys the Miri oracle cache (difftest.ts
// `caseOracleCacheKey`: pin, Miri binary, suite, case id, argv, file, env including `MIRI_LOG`, dependencies,
// `miriOracleKey()`), so the oracle runs once per case and Miri toolchain/sysroot; raw, so a normalisation change needs
// no new oracle run. A case whose oracle stderr is unstable (difftest `unstableReasonOf`, `Suite.unstable`) is never
// cached.
//
// Output (AGENTS.md §4): a few summary lines (records on each side; the first differing record with the oracle's and
// the port's line; or, when the port stops early, its exit and first `unported`), `ERROR:` lines on failure. Files in
// $RUST_TS_DATA/runs/<run>/miri-diff/: `oracle.trace.txt`, `port.trace.txt` (one record per line, newlines as `\n`),
// `oracle.other.txt` (the oracle's non-trace stderr lines), `port.stdout.txt`, `port.stderr.txt` (raw), `report.txt`
// (the summary plus the records before the difference) and `report.json`. Exit: 0 traces and outputs match, 1 they differ (or the port stops), 2 an `ERROR:`.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { MIRI_SUBJECT_ENTRY, miriFileCase, suite as getSuite, type Case, type Suite } from "../harness/suites.ts";
import { DATA, REPO, RUNS, UPSTREAM, ensureDir, nowId, parseArgs, run, type ProcResult } from "./lib/common.ts";
import { caseEnv } from "./lib/env.ts";
import { verifyMiriOracle } from "./lib/miri.ts";
import { compareTraces, normaliseTrace, traceLine, traceText, type MiriTrace, type TraceVerdict } from "./lib/miri-trace.ts";
import { verifyOraclePin } from "./lib/oracle.ts";
import { upstreamChanges, upstreamError, upstreamStatus } from "./lib/upstream.ts";
import { caseOracleCacheKey, cwdOf, unportedOf, unstableOf, unstableReasonOf } from "./difftest.ts";

/** The variables miri-diff adds to a case's env on both sides (A6: `info`-level events only). */
export const MIRI_TRACE_ENV: Readonly<Record<string, string>> = { MIRI_LOG: "info" };
/** The oracle trace cache (see the header). */
const TRACE_CACHE = join(DATA, "miri-diff-cache");
/** Records shown before the first difference in report.txt. */
const CONTEXT = 5;
/** Console lines are cut to this many characters (the files have them whole). */
const MAX_LINE = 300;

/** A side's raw output, as cached for the oracle. */
interface RawOutput {
  stdout: string;
  stderr: string;
  code: number;
}

const cut = (s: string): string => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE)}...` : s);
const fail = (msg: string): never => {
  console.log(`ERROR: ${msg}`);
  process.exit(2);
};

/** The suite and case `argv` names (see the header), or an error message. */
export function pickCase(a: ReturnType<typeof parseArgs>, cwd: string = process.cwd()): { suite: Suite; case: Case } | { error: string } {
  if (typeof a.suite === "string") {
    let s: Suite;
    try {
      s = getSuite(a.suite);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    if (!s.miri) return { error: `suite ${s.name} is not a Miri suite (Suite.miri)` };
    if (typeof a.case !== "string") return { error: `--suite ${s.name} needs --case <id>` };
    const c = s.cases().find((c) => c.id === a.case);
    if (c) return { suite: s, case: c };
    const skipped = s.skipped?.().find((k) => k.id === a.case);
    return { error: skipped ? `${a.case} is skipped in ${s.name}: ${skipped.reason}` : `no case ${a.case} in ${s.name}` };
  }
  const file = a._[0];
  if (file === undefined) return { error: "give a program file or --suite <miri suite> --case <id>" };
  const abs = resolve(cwd, file);
  if (!existsSync(abs)) return { error: `no such file: ${abs}` };
  const rel = relative(REPO, abs);
  const inRepo = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  return { suite: getSuite("miri-hello"), case: miriFileCase(inRepo ? rel.split("\\").join("/") : abs) };
}

function readTrace(p: string): RawOutput | undefined {
  try {
    const o = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(readFileSync(p)))) as RawOutput;
    if (typeof o.stdout === "string" && typeof o.stderr === "string" && typeof o.code === "number") return o;
  } catch {}
  console.log(`ERROR: unreadable miri-diff cache entry ${p}; re-running the oracle`);
  return undefined;
}

function writeTrace(p: string, o: RawOutput): void {
  const tmp = `${p}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(tmp, Bun.gzipSync(JSON.stringify(o)));
  renameSync(tmp, p);
}

/** The port's stop reason: its first `unported`, a timeout, or its exit and first non-trace stderr line. */
function stopOf(r: ProcResult, t: MiriTrace): string {
  if (r.timedOut) return `timed out after ${Math.round(r.ms)} ms`;
  const u = unportedOf(r);
  if (u !== undefined) return `exit ${r.code}, rust-ts: unported: ${u}`;
  const first = t.other.find((l) => l.trim() !== "");
  return `exit ${r.code}${first !== undefined ? `: ${cut(first)}` : ""}`;
}

/** The summary lines of a comparison (printed, and the head of report.txt). */
export function summaryLines(v: TraceVerdict, o: MiriTrace, p: MiriTrace, port: { stop: string; code: number }, oCode: number, sameStdout: boolean): string[] {
  const at = (ev: readonly string[], i: number) => (i < ev.length ? cut(traceLine(ev[i]!)) : "<end of trace>");
  switch (v.kind) {
    case "match":
      return [`traces match (${o.events.length} records); stdout ${sameStdout ? "same" : "differs"}, exit oracle ${oCode}, port ${port.code}`];
    case "diverges":
      return [`first difference at record ${v.index} (${port.code === oCode ? `exit ${oCode}` : `port: ${port.stop}`}):`, `  - ${at(o.events, v.index)}`, `  + ${at(p.events, v.index)}`];
    case "port-stops":
      return [`port stops after ${v.index} of the oracle's ${o.events.length} records (${port.stop})`, `  next oracle record ${v.index}: ${at(o.events, v.index)}`];
    case "port-extra":
      return [`port has records after the oracle's ${o.events.length} (port: ${port.stop})`, `  + ${at(p.events, v.index)}`];
  }
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (a._.length === 0 && a.suite === undefined) {
    console.log("usage: bun scripts/miri-diff.ts <file.rs> | --suite <miri suite> --case <id> [--impl I] [--run-id ID] [--no-cache]");
    process.exit(0);
  }
  const picked = pickCase(a);
  if ("error" in picked) fail(picked.error);
  const { suite: s, case: c0 } = picked as { suite: Suite; case: Case };
  await verifyOraclePin();
  verifyMiriOracle();
  const c: Case = { ...c0, env: { ...c0.env, ...MIRI_TRACE_ENV } };
  const cwd = cwdOf(s);
  const impl = typeof a.impl === "string" ? a.impl : "port";
  const upstreamBefore = upstreamStatus(UPSTREAM);

  const key = caseOracleCacheKey(s, c);
  const cacheFile = join(ensureDir(join(TRACE_CACHE, key.slice(0, 2))), `${key}.json.gz`);
  const listedUnstable = unstableOf(s).get(c.id);
  const cached = !a["no-cache"] && listedUnstable === undefined && existsSync(cacheFile) ? readTrace(cacheFile) : undefined;
  const oracleRun = async (): Promise<RawOutput> => {
    const r = await run(s.oracle([c]), { cwd, timeoutMs: s.oracleTimeoutMs ?? s.timeoutMs, env: caseEnv(c.env) });
    if (r.timedOut) fail(`the Miri oracle timed out after ${Math.round(r.ms)} ms on ${c.id}`);
    return { stdout: r.stdout, stderr: r.stderr, code: r.code };
  };
  const [o, p] = await Promise.all([
    cached ?? oracleRun(),
    run(s.subject([c]), { cwd, timeoutMs: s.timeoutMs, env: { ...caseEnv(c.env), RUST_TS_IMPL: impl } }),
  ]);
  const unstable = listedUnstable ?? unstableReasonOf(s)(o.stderr);
  if (!cached && unstable === undefined) writeTrace(cacheFile, o);

  const ot = normaliseTrace(o.stderr);
  const pt = normaliseTrace(p.stderr);
  const v = compareTraces(ot.events, pt.events);
  const stop = stopOf(p, pt);
  const out = ensureDir(join(RUNS, typeof a["run-id"] === "string" ? a["run-id"] : nowId(), "miri-diff"));
  writeFileSync(join(out, "oracle.trace.txt"), traceText(ot.events));
  writeFileSync(join(out, "port.trace.txt"), traceText(pt.events));
  writeFileSync(join(out, "oracle.other.txt"), ot.other.map((l) => `${l}\n`).join(""));
  writeFileSync(join(out, "port.stdout.txt"), p.stdout);
  writeFileSync(join(out, "port.stderr.txt"), p.stderr);

  const lines = [
    `miri-diff ${s.name} ${c.id} (port ${MIRI_SUBJECT_ENTRY}; oracle ${cached ? "cached" : "ran"}, exit ${o.code}${unstable !== undefined ? `; unstable, not cached: ${unstable}` : ""})`,
    `records: oracle ${ot.events.length}, port ${pt.events.length}; other stderr lines: oracle ${ot.other.length}, port ${pt.other.length}`,
    ...summaryLines(v, ot, pt, { stop, code: p.code }, o.code, o.stdout === p.stdout),
  ];
  if (ot.events.length === 0) lines.push(`ERROR: the oracle printed no MIRI_LOG=info records for ${c.id} (exit ${o.code}); is MIRI_LOG reaching it?`);
  const changed = upstreamChanges(upstreamBefore, upstreamStatus(UPSTREAM));
  if (changed.length) lines.push(upstreamError("the upstream checkout changed during miri-diff", changed, UPSTREAM));
  lines.push(`files: ${out}`);
  const index = v.kind === "match" ? -1 : v.index;
  const context = index < 0 ? [] : ot.events.slice(Math.max(0, index - CONTEXT), index).map((e, k) => `    ${Math.max(0, index - CONTEXT) + k}: ${traceLine(e)}`);
  writeFileSync(join(out, "report.txt"), [...lines, ...(context.length ? ["matching records before the difference:", ...context] : [])].join("\n") + "\n");
  writeFileSync(
    join(out, "report.json"),
    JSON.stringify(
      {
        suite: s.name,
        case: c.id,
        portEntry: MIRI_SUBJECT_ENTRY,
        verdict: v,
        oracle: { cached: cached !== undefined, code: o.code, records: ot.events.length, other: ot.other.length, unstable, sameStdout: o.stdout === p.stdout },
        port: { code: p.code, timedOut: p.timedOut, ms: Math.round(p.ms), records: pt.events.length, other: pt.other.length, stop, unported: unportedOf(p) },
        first: index < 0 ? null : { index, oracle: ot.events[index] ?? null, port: pt.events[index] ?? null },
        upstreamChanges: changed,
      },
      null,
      2,
    ) + "\n",
  );
  for (const l of lines) console.log(l);
  const error = lines.some((l) => l.startsWith("ERROR:"));
  process.exit(error ? 2 : v.kind === "match" && o.stdout === p.stdout && o.code === p.code ? 0 : 1);
}

if (import.meta.main) await main();
