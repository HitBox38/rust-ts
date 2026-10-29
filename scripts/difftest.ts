// Differential tester: runs a suite on the oracle and on rust-ts, compares outputs.
//
//   bun scripts/difftest.ts --suite <name> [options]
//     --sample N        deterministic random sample of N cases (seed: --seed, else $RUST_TS_AGENT, else 0)
//     --filter S        only cases whose id contains S
//     --impl I          RUST_TS_IMPL for the subject: port (default) | shim | stub
//     --jobs N          parallel processes (default: cores)
//     --batch-size N    files per process in batch suites (default 100)
//     --run-id ID       output dir name under $RUST_TS_DATA/runs (default: timestamp)
//     --report blessed  also write the blessed-output report (suites with `Suite.blessed`; never a status)
//     --list            list suites
//
// Statuses: MATCH | DIFF | UNPORTED (exit 70) | CRASH (subject ICE/exit mismatch with no output) |
// TIMEOUT (the subject timed out, in the parallel pool and again in its serial re-run) | ORACLE_TIMEOUT (the oracle timed out twice, the second time with
// ORACLE_RETRY_FACTOR x its timeout; never cached, never compared, never MATCH) | UNSTABLE (the oracle's output
// is not reproducible: the case is listed in `Suite.unstable`, or its oracle stderr matches one of
// `UNSTABLE_ORACLE_PATTERNS`; never cached, never compared, never MATCH, and the gate never protects it)
//
// Environment: both sides run with the caller's environment minus the variables scripts/lib/env.ts scrubs
// (`RUSTC_LOG*`, `RUST_BACKTRACE`, `RUSTC_BOOTSTRAP`, `CLICOLOR_FORCE`, `CARGO_*`, ...), plus the case's own
// `Case.env`. Upstream checkout: `git status` of $RUST_TS_DATA/rust (ignored files included, `build/` excluded:
// compiletest's output dirs) is compared before and after the run; any change prints an `ERROR:` line and is
// listed in `<suite>.upstream-changes.txt` (`upstreamChanges` in the result; the gate fails on it).
// Prints one summary line; details go to $RUST_TS_DATA/runs/<run-id>/ (`<suite>.skipped.jsonl` lists
// the tests a suite leaves out, with reasons). Suites with `Suite.subsets` also get per-subset counts
// (summary `subsets`, one line each).
//
// Split suites (`Suite.mode` "split", plan-m5 D6; lane harness-m5a): each case is a *run*, one oracle and one subject
// process, whose stdout `Suite.split` (scripts/lib/split.ts) cuts into sections. Reported cases: the run's own case
// (id = the run's id; compares stderr, exit code and the skeleton: everything outside the sections, with their ids in
// order) and one case per oracle section (`<run id>|<section id>`, MATCH when the subject prints a section with the
// same id and text; a section missing from the subject's output is a DIFF). A run-level failure (subject TIMEOUT, or an
// exit code other than the oracle's: UNPORTED, CRASH, DIFF) gives every case of the run that status (`unported` /
// `first` only on the run case), and so do an unstable oracle output (UNSTABLE) and an oracle timeout (ORACLE_TIMEOUT,
// which reports only the run case: there are no sections). Sections only the subject prints are counted (summary
// `extra`) and listed in `<suite>.extra.jsonl`. The oracle cache keeps per-section hashes, never the text (core's MIR
// is 47 MB); when a DIFF needs the oracle's text for its diff file, the oracle is run again, and it must reproduce the
// cached entry (lane harness-m5b). If it does not, the cached hashes are known not to be reproducible and nothing is
// scored against them: a differing exit code, stderr or skeleton makes every case of the run UNSTABLE, differing
// section hashes make those sections UNSTABLE; the entry is removed and the event gets an `ERROR:` line (summary and
// gate.json `oracleReruns`, which also lists re-runs that reproduced or timed out). `--filter`/`--sample` select among
// the reported cases; every run still runs. Diff files are named by a cut id plus a hash of it.
//
// Heavy suites (`Suite.heavy`, plan-m5 §4.2, D11): one process at a time (jobs = 1, the oracle before the subject), no
// re-run of a subject TIMEOUT (it already ran alone), and per run the wall/user time and max RSS of each process
// (summary `heavy`, printed; a split run's oracle re-run too). A subject over the suite's RSS budget, and a process
// whose resource usage is unavailable (so its budget cannot be checked), get an `ERROR:` line (`heavyErrorLines`),
// which is not a status: root's decision (lane harness-m5b, plan-m5 D11 "fail loudly" but "a reported regression, not
// a timeout") is that it is reported and recorded in gate.json, but does not by itself fail the gate.
//
// `--report blessed` (report only; it never changes a status): for every case of a suite with
// `Suite.blessed` (the UI-test suites of M3), the oracle's stderr is normalized as compiletest would
// and compared with the test's blessed `.stderr`. Where they are equal ("covered": the probe's
// diagnostics are all the test expects), the subject's normalized stderr is compared too: PASS or FAIL.
// Other cases are NOT_COVERED (with the first oracle/blessed difference), N/A (no blessed comparison,
// with why) or ORACLE_TIMEOUT. Written to `<suite>.blessed.jsonl` and summary `blessed`.
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { SUITES, suite as getSuite, type Case, type Suite } from "../harness/suites.ts";
import type { Blessed } from "../harness/compiletest.ts";
import { ORACLE_CACHE, PIN, REPO, RUNS, UPSTREAM, die, ensureDir, hash, nowId, parseArgs, pool, requireUpstream, run, type ProcResult } from "./lib/common.ts";
import { caseDeps, type Dep } from "./lib/deps.ts";
import { caseEnv } from "./lib/env.ts";
import { UNSTABLE_ORACLE_PATTERNS, unstableOracleReason } from "./lib/unstable.ts";
import { upstreamChanges, upstreamError, upstreamStatus } from "./lib/upstream.ts";
import { ORACLE_RETRY_FACTOR, rustcDriverHash, verifyOraclePin } from "./lib/oracle.ts";
import { SPLITTERS, compareSections, splitHashes, type SplitHashes, type SplitOutput } from "./lib/split.ts";
import { isRustcDevProbe } from "./probes.ts";

export type Status = "MATCH" | "DIFF" | "UNPORTED" | "CRASH" | "TIMEOUT" | "ORACLE_TIMEOUT" | "UNSTABLE";
export const STATUSES: Status[] = ["MATCH", "DIFF", "UNPORTED", "CRASH", "TIMEOUT", "ORACLE_TIMEOUT", "UNSTABLE"];

/** Oracle stderr patterns that are not reproducible (scripts/lib/unstable.ts). */
export { UNSTABLE_ORACLE_PATTERNS, unstableOracleReason };

/** An oracle process that times out is run once more with this many times its timeout (scripts/lib/oracle.ts). */
export { ORACLE_RETRY_FACTOR };
/**
 * At most this many subject TIMEOUTs from the parallel pool are re-run alone (serially, so each can
 * cost the whole timeout); the rest keep their TIMEOUT unretried. A gate run sees a handful.
 */
export const SUBJECT_TIMEOUT_RETRY_CAP = 50;

export interface CaseResult {
  id: string;
  status: Status;
  /** UNPORTED: what the subject reported (`rust-ts: unported: <what>`), for bucketing. */
  unported?: string;
  /** DIFF/CRASH: the first differing line, as `<line>: <oracle> | <subject>` (each JSON, cut to 200 chars). */
  first?: string;
  /**
   * ORACLE_TIMEOUT, UNSTABLE: what the subject did, which the status alone would hide: `TIMEOUT`, `ICE`
   * (exit 101), `UNPORTED: <what>` (exit 70), or `exit <code>`.
   */
  subject?: string;
  /** UNSTABLE: why (the `Suite.unstable` reason, or `detected: <pattern reason>`). */
  unstable?: string;
  /**
   * The subject timed out in the parallel pool and this status is from its one serial re-run, alone,
   * with the same timeout, after the pool (see `difftest`).
   */
  retried?: true;
}

/** ORACLE_TIMEOUT cases by what the subject did (see `CaseResult.subject`). */
export interface OracleTimeoutSubjects {
  ok: number;
  TIMEOUT: number;
  ICE: number;
  UNPORTED: number;
}

interface Output {
  text: string;
  code: number;
  timedOut: boolean;
  /** Not reproducible, with why (see `Suite.unstable`, `UNSTABLE_ORACLE_PATTERNS`); never cached. */
  unstable?: string;
}

const EXIT_UNPORTED = 70;

/** One process of a heavy run (`Suite.heavy`), from `ProcResult.usage`. */
export interface Usage {
  exit: number;
  timedOut: boolean;
  wallS: number;
  /** `null`: unavailable (see `unavailable`), never a made-up number. */
  userS: number | null;
  sysS: number | null;
  maxRssMb: number | null;
  /** Why `userS`/`sysS`/`maxRssMb` are `null`: Bun reported no usage, or an implausible one (`usageOf`). */
  unavailable?: string;
}

/** Resources of one run of a heavy suite (summary `heavy`); `oracle` is "cached" when the oracle did not run. */
export interface HeavyRun {
  id: string;
  oracle: Usage | "cached";
  subject: Usage;
  /** A split run's second oracle process (run for the diff files' text; see the header), if there was one. */
  oracleRerun?: Usage;
  rssBudgetMb: number;
  /** The subject's max RSS exceeds the budget: an `ERROR:` line (plan-m5 D11), never a status. False when unavailable. */
  overBudget: boolean;
}

/**
 * Below this, a max RSS reported for a process that used at least `PLAUSIBLE_RSS_AFTER_MS` of CPU is taken as a unit
 * error, not a measurement: every process a heavy suite runs (the Bun subject, rustc) has a far larger RSS. Bun 1.4.3
 * reports bytes on every platform (src/spawn_sys/spawn_process.rs `RusageFields::maxrss`: `ru_maxrss` as is on Apple,
 * times 1024 on Linux/BSD, `PeakWorkingSetSize` on Windows), so this guards against a Bun that passes the KiB through.
 */
export const MIN_PLAUSIBLE_RSS_BYTES = 16 * 2 ** 20;
export const PLAUSIBLE_RSS_AFTER_MS = 1000;

export function usageOf(r: ProcResult): Usage {
  const u = r.usage;
  const tenths = (ms: number) => Math.round(ms / 100) / 10;
  const base = { exit: r.code, timedOut: r.timedOut, wallS: tenths(r.ms) };
  const none = (unavailable: string): Usage => ({ ...base, userS: null, sysS: null, maxRssMb: null, unavailable });
  if (!u) return none("Bun reported no resource usage for the process");
  if (![u.userMs, u.sysMs, u.maxRssBytes].every(Number.isFinite)) return none(`Bun reported a non-finite resource usage (${JSON.stringify(u)})`);
  const cpuMs = u.userMs + u.sysMs;
  if (cpuMs >= PLAUSIBLE_RSS_AFTER_MS && u.maxRssBytes < MIN_PLAUSIBLE_RSS_BYTES) return none(`implausible max RSS ${u.maxRssBytes} after ${Math.round(cpuMs)} ms of CPU (KiB read as bytes?)`);
  return { ...base, userS: tenths(u.userMs), sysS: tenths(u.sysMs), maxRssMb: Math.round(u.maxRssBytes / 2 ** 20) };
}

function heavyRun(s: Suite, id: string, oracle: Usage | "cached", subject: Usage, oracleRerun?: Usage): HeavyRun {
  const budget = s.heavy!.rssBudgetMb;
  return { id, oracle, subject, ...(oracleRerun ? { oracleRerun } : {}), rssBudgetMb: budget, overBudget: subject.maxRssMb !== null && subject.maxRssMb > budget };
}

/** One line per heavy run (difftest's CLI and the gate print it). */
export function heavyLine(suite: string, h: HeavyRun): string {
  const u = (x: Usage) => `${x.wallS} s wall, ${x.userS ?? "?"} s user, ${x.maxRssMb ?? "?"} MB max RSS, exit ${x.exit}${x.timedOut ? " (timed out)" : ""}`;
  return `heavy ${suite} ${h.id}: subject ${u(h.subject)} (budget ${h.rssBudgetMb} MB); oracle ${h.oracle === "cached" ? "cached" : u(h.oracle)}${h.oracleRerun ? `; oracle re-run ${u(h.oracleRerun)}` : ""}`;
}

/**
 * The `ERROR:` lines of a heavy run: its subject over the RSS budget, and every process whose usage is unavailable (its
 * budget is then unchecked). Reported, never a status, and by root's decision (lane harness-m5b) they do not by
 * themselves fail the gate: gate.json records them (`heavyErrors`, and `heavy` per run).
 */
export function heavyErrorLines(suite: string, h: HeavyRun): string[] {
  const out: string[] = [];
  if (h.overBudget) out.push(`ERROR: ${suite} ${h.id}: subject max RSS ${h.subject.maxRssMb} MB is over the suite's budget of ${h.rssBudgetMb} MB (plan-m5 D11: reported, not a status; does not fail the gate)`);
  const procs: [string, Usage | "cached" | undefined][] = [["subject", h.subject], ["oracle", h.oracle], ["oracle re-run", h.oracleRerun]];
  for (const [what, u] of procs) {
    if (u === undefined || u === "cached" || u.unavailable === undefined) continue;
    out.push(`ERROR: ${suite} ${h.id}: the ${what}'s resource usage is unavailable (${u.unavailable})${what === "subject" ? "; its RSS budget is unchecked" : ""} (reported, not a status; does not fail the gate)`);
  }
  return out;
}

function render(r: { stdout: string; stderr: string; code: number }): string {
  return `${r.stdout}\n--- stderr ---\n${r.stderr}\n--- exit: ${r.code} ---\n`;
}

/** Split batch output on `file: <path>` header lines. */
function splitBatch(stdout: string): Map<string, string> {
  const out = new Map<string, string>();
  let cur: string | undefined;
  let start = 0;
  let i = 0;
  while (i <= stdout.length) {
    const nl = stdout.indexOf("\n", i);
    const end = nl < 0 ? stdout.length : nl;
    if (stdout.startsWith("file: ", i)) {
      if (cur !== undefined) out.set(cur, stdout.slice(start, i));
      cur = stdout.slice(i + 6, end);
      start = i;
    }
    if (nl < 0) break;
    i = nl + 1;
  }
  if (cur !== undefined) out.set(cur, stdout.slice(start));
  return out;
}

// Per suite: gate.ts runs several suites (with different probes) in one process.
const oracleVersionCache = new Map<string, string>();
function oracleVersion(s: Suite): string {
  // Probe-based suites are keyed by the probe binary, rustc-based ones by the oracle rustc_driver
  // build, so rebuilding a probe or reinstalling the toolchain invalidates the cache. A rustc-dev
  // probe (scripts/probes.ts) runs the sysroot's librustc_driver, which its binary does not
  // contain, so its suites are keyed by both.
  let v = oracleVersionCache.get(s.name);
  if (v) return v;
  const cmd0 = s.oracle([{ id: "", file: "", args: [] }])[0]!;
  v = cmd0 === "rustc" ? rustcDriverHash() : existsSync(cmd0) ? hash(readFileSync(cmd0)) : PIN.commit;
  if (cmd0 !== "rustc" && (s.probes ?? []).some(isRustcDevProbe)) v += `+${rustcDriverHash()}`;
  oracleVersionCache.set(s.name, v);
  return v;
}

/** Working directory of every command of a suite (and base of `Case.file`). */
const cwdOf = (s: Suite): string => s.cwd ?? UPSTREAM;

/** Hash of a case's input file; synthetic cases (`file: ""`) have no input. */
const fileHash = (s: Suite, c: Case): string => (c.file === "" ? "" : hash(readFileSync(join(cwdOf(s), c.file))));

/**
 * Every other path the case may make the oracle read or probe, with its state (scripts/lib/deps.ts: `#[path]`,
 * out-of-line `mod`, the include macros, ...); `[]` for most cases, for synthetic ones and in suites whose
 * tools read only the case files (`Suite.readsOnlyCaseFile`).
 */
export const depsOf = (s: Suite, c: Case): Dep[] => (c.file === "" || s.readsOnlyCaseFile || s.inputDirs ? [] : caseDeps(cwdOf(s), c.file, c.env));

const inputDirsMemo = new Map<string, string>();
/**
 * `Suite.inputDirs`' part of the oracle cache key: a hash of every file under them (relative path and content hash,
 * sorted), so any file changing, appearing or disappearing there changes the key. Memoized per process (the upstream
 * checkout must not change during a run: difftest checks it).
 */
function inputDirsHash(s: Suite): string {
  const key = `${cwdOf(s)}\0${s.inputDirs!.join("\0")}`;
  let h = inputDirsMemo.get(key);
  if (h) return h;
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(join(cwdOf(s), d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else files.push(rel);
    }
  };
  for (const d of s.inputDirs!) walk(d);
  files.sort();
  h = hash(files.map((f) => `${f}\0${hash(readFileSync(join(cwdOf(s), f)))}`).join("\n"));
  inputDirsMemo.set(key, h);
  return h;
}

/** Split suites' part of the cache key: the splitter and scripts/lib/split.ts's source (a changed splitter changes ids). */
let splitSourceHash: string | undefined;
const splitKey = (s: Suite) => ({ split: s.split, source: (splitSourceHash ??= hash(readFileSync(join(REPO, "scripts", "lib", "split.ts")))) });

/**
 * Oracle cache entries are JSON `Output`s. Entries larger than this (UTF-8 bytes) are stored gzipped (token
 * stream dumps are ~20x their source); a reader tells them apart by the gzip magic bytes, which
 * JSON text never starts with. 4 KiB (one filesystem block; was 64 KiB): the M2 suites
 * (expanded-nocore, resdump-nocore) write ~65k entries of mostly 4-60 KiB that gzip ~6-10x, so
 * the old threshold stored them raw (~0.7 GB estimated for the three suites, against ~0.3 GB).
 * Only writes change; entries written under the old threshold stay readable.
 */
const GZIP_OVER = 4 * 1024;

/**
 * A cached oracle output, or `undefined` (a miss) if the entry is unreadable: a torn or corrupt
 * entry (neither a corrupt gzip stream nor a prefix of an `Output` decodes) is reported with one
 * `ERROR:` line, removed, and re-run by the caller, which overwrites it.
 */
function readCached(p: string): Output | undefined {
  return readCachedAs<Output>(p, (o) => typeof o?.text === "string" && typeof o.code === "number");
}

/** `readCached` for any entry shape; `valid` tells an entry of that shape. */
function readCachedAs<T>(p: string, valid: (o: T) => boolean): T | undefined {
  try {
    const raw = readFileSync(p);
    const text = raw[0] === 0x1f && raw[1] === 0x8b ? new TextDecoder().decode(Bun.gunzipSync(raw)) : raw.toString("utf8");
    const o = JSON.parse(text) as T;
    if (!valid(o)) throw new Error("not an oracle output");
    return o;
  } catch (e) {
    console.log(`ERROR: unreadable oracle cache entry ${p} (${e instanceof Error ? e.message : String(e)}); removed, re-running the oracle`);
    rmSync(p, { force: true });
    return undefined;
  }
}

/** Atomic: written to a process-unique temp file, then renamed over the entry. */
function writeCached(p: string, o: Output | SplitOracle): void {
  const json = JSON.stringify(o);
  const tmp = `${p}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(tmp, Buffer.byteLength(json) > GZIP_OVER ? Bun.gzipSync(json) : json);
  renameSync(tmp, p);
}

export function cachePath(s: Suite, c: Case, fileHash: string, deps: Dep[]): string {
  // `env` joins the key only when a case has one, so the keys of env-less suites are unchanged. The
  // dependencies (`depsOf`) join it only when there are any, so the keys of cases that can read no other
  // file are unchanged too; a file appearing, disappearing or changing at a path a case may read changes
  // that case's key.
  const parts: unknown[] = [PIN.commit, oracleVersion(s), s.name, c.id, c.args, fileHash];
  if (c.env !== undefined) parts.push(c.env);
  if (deps.length > 0) parts.push({ deps });
  // (Only suites with these fields get the extra parts, so every other key is unchanged.)
  if (s.inputDirs) parts.push({ inputDirs: inputDirsHash(s) });
  if (s.mode === "split") parts.push(splitKey(s));
  const key = hash(JSON.stringify(parts));
  return join(ensureDir(join(ORACLE_CACHE, key.slice(0, 2))), key);
}

/** `Suite.unstable` as a map from case id to reason. */
export function unstableOf(s: Suite): Map<string, string> {
  return new Map((s.unstable?.() ?? []).map((u) => [u.id, u.reason]));
}

/** `usage`: filled with each single-mode oracle process's resources (heavy suites); a cached case has none. */
async function runOracle(s: Suite, cases: Case[], usage?: Map<string, Usage>): Promise<Map<string, Output>> {
  const out = new Map<string, Output>();
  const todo: Case[] = [];
  const paths = new Map<string, string>();
  const listed = unstableOf(s);
  for (const c of cases) {
    const p = cachePath(s, c, fileHash(s, c), depsOf(s, c));
    paths.set(c.id, p);
    // A listed unstable case's oracle output is never read from (or written to) the cache.
    let cached = !listed.has(c.id) && existsSync(p) ? readCached(p) : undefined;
    if (cached && s.mode === "single") {
      // An entry written before its pattern was known: never reused, removed.
      const why = unstableOracleReason(stderrOf(cached));
      if (why) {
        rmSync(p, { force: true });
        cached = undefined;
      }
    }
    if (cached) out.set(c.id, cached);
    else todo.push(c);
  }
  if (todo.length === 0) return out;
  const timeoutMs = s.oracleTimeoutMs ?? s.timeoutMs;
  /** One oracle process; a timed-out one is retried once with a longer timeout. */
  const runOnce = async (cmd: string[], env: Case["env"]) => {
    const r = await run(cmd, { cwd: cwdOf(s), timeoutMs, env: caseEnv(env) });
    return r.timedOut ? await run(cmd, { cwd: cwdOf(s), timeoutMs: timeoutMs * ORACLE_RETRY_FACTOR, env: caseEnv(env) }) : r;
  };
  /** A case whose oracle timed out twice: no output to compare, never cached. */
  const timedOut = (code: number): Output => ({ text: "", code, timedOut: true });
  if (s.mode === "batch") {
    // A batch can time out under load; split it in halves until it succeeds, and only
    // fail when a single file cannot be run by the oracle (a single file that times out twice is
    // ORACLE_TIMEOUT).
    const runBatch = async (batch: Case[]): Promise<void> => {
      const r = batch.length === 1 ? await runOnce(s.oracle(batch), undefined) : await run(s.oracle(batch), { cwd: cwdOf(s), timeoutMs, env: caseEnv(undefined) });
      if (r.code !== 0 || r.timedOut) {
        if (batch.length === 1 && r.timedOut) {
          out.set(batch[0]!.id, timedOut(r.code));
          return;
        }
        if (batch.length === 1) throw new Error(`oracle failed on ${batch[0]!.file} (exit ${r.code}): ${r.stderr.slice(0, 2000)}`);
        const mid = batch.length >> 1;
        await runBatch(batch.slice(0, mid));
        await runBatch(batch.slice(mid));
        return;
      }
      const parts = splitBatch(r.stdout);
      for (const c of batch) {
        const o: Output = { text: parts.get(c.file) ?? "", code: 0, timedOut: false };
        // (Batch output is per-file stdout; only `Suite.unstable` applies.)
        if (listed.has(c.id)) o.unstable = listed.get(c.id)!;
        out.set(c.id, o);
        if (!o.unstable) writeCached(paths.get(c.id)!, o);
      }
    };
    await runBatch(todo);
  } else {
    for (const c of todo) {
      const r = await runOnce(s.oracle([c]), c.env);
      usage?.set(c.id, usageOf(r));
      if (r.timedOut) {
        out.set(c.id, timedOut(r.code));
        continue;
      }
      const o: Output = { text: render(r), code: r.code, timedOut: false };
      const why = listed.get(c.id) ?? unstableOracleReason(r.stderr);
      if (why) o.unstable = why;
      out.set(c.id, o);
      if (!why) writeCached(paths.get(c.id)!, o);
    }
  }
  return out;
}

/** Counters a subject run reports besides per-case statuses (written to `<suite>.summary.json`). */
export interface SubjectStats {
  /** Subject processes started. */
  processes: number;
  /**
   * Batch-only failures: failed (non-zero exit) multi-case batch processes none of whose cases fails
   * on its own, counting only the smallest such batches (a failing batch that contains another
   * counted one is not counted again). That is state leaking from earlier files of the same
   * process. Every status still comes from runs that pass or from the isolated run (= `--batch-size
   * 1`), so these failures leave no other trace; a non-zero count is a bug in the dump driver (or
   * the port's global state) to look at.
   */
  batchOnlyFailures: number;
  /** Same, for batch processes that timed out (usually load, not a state leak). */
  batchOnlyTimeouts: number;
}

/** `usage`: filled with each single-mode subject process's resources (heavy suites). */
export async function runSubject(s: Suite, cases: Case[], impl: string, stats?: SubjectStats, usage?: Map<string, Usage>): Promise<Map<string, Output>> {
  const env = { RUST_TS_IMPL: impl };
  const out = new Map<string, Output>();
  /** Every failed multi-case batch process: its case ids and whether it timed out. */
  const failedBatches: { ids: Set<string>; timedOut: boolean }[] = [];
  const exec = async (batch: Case[]) => {
    if (stats) stats.processes++;
    // (Only single-mode suites have per-case env; `difftest` rejects it in batch suites.)
    const r = await run(s.subject(batch), { cwd: cwdOf(s), timeoutMs: s.timeoutMs, env: { ...caseEnv(batch[0]!.env), ...env } });
    if (batch.length > 1 && (r.code !== 0 || r.timedOut)) failedBatches.push({ ids: new Set(batch.map((c) => c.id)), timedOut: r.timedOut });
    return r;
  };
  /** A single-case process: its own status, whatever it printed. */
  const runOne = async (c: Case): Promise<boolean> => {
    const r = await exec([c]);
    const failed = r.code !== 0 || r.timedOut;
    const parts = splitBatch(r.stdout);
    // On failure the section printed may be incomplete; treat it as missing.
    out.set(c.id, !failed && parts.has(c.file) ? { text: parts.get(c.file)!, code: 0, timedOut: false } : { text: r.stderr, code: r.code, timedOut: r.timedOut });
    return !failed;
  };
  /** Statuses of every case of an exit-0 batch process. */
  const attribute = (batch: Case[], r: Awaited<ReturnType<typeof run>>) => {
    const parts = splitBatch(r.stdout);
    // (A case whose header is missing from an exit-0 batch scores the process's stderr, as before.)
    for (const c of batch) out.set(c.id, parts.has(c.file) ? { text: parts.get(c.file)!, code: 0, timedOut: false } : { text: r.stderr, code: r.code, timedOut: r.timedOut });
  };
  const ok = (r: Awaited<ReturnType<typeof run>>) => r.code === 0 && !r.timedOut;
  if (s.mode === "batch") {
    // A failed batch process (timeout, UNPORTED exit 70, ICE, any non-zero exit) says nothing about
    // the other files in it: the process stopped at one file, or was slow under load. Its output is
    // never attributed to any case; it is only used to choose a suspect: `k`, the first case without
    // a complete section (its header and the next one printed). The suspect runs alone.
    // - It fails alone: the header pinpointed the culprit. `[0, k)` is re-run as a batch, and the
    //   rest `(k, n)` continues in this loop: after a case fails alone the next cases run alone in a
    //   doubling streak (1, 2, 4, ...) until one passes, then the rest is tried as a batch again, so a
    //   batch where every case fails costs about one process per case.
    // - It passes alone: the split point carried no information (e.g. a subject that buffers its
    //   output lost it when it died or was killed). `[0, k]` is re-run as one batch (k > 0; if that
    //   fails too, it is a batch-only failure and `[0, k)` is resolved recursively), and the rest
    //   `(k, n)` is bisected in halves. So an uninformative failure costs O(log n) batch runs.
    // Every part is strictly smaller than the batch, so this terminates, and a wrong or lying header
    // can only make the split worse, never change a status: every status from a failed process
    // (TIMEOUT, UNPORTED, CRASH, ...) is only ever reported for a file that fails on its own.
    const runBatch = async (batch: Case[]): Promise<void> => {
      let i = 0;
      let streak = 0;
      while (i < batch.length) {
        if (streak > 0) {
          let allFailed = true;
          for (let j = 0; j < streak && i < batch.length; j++) {
            if (await runOne(batch[i++]!)) {
              allFailed = false;
              break;
            }
          }
          streak = allFailed ? streak * 2 : 0;
          continue;
        }
        const rest = batch.slice(i);
        if (rest.length === 1) {
          if (!(await runOne(rest[0]!))) streak = 1;
          i++;
          continue;
        }
        const r = await exec(rest);
        if (ok(r)) {
          attribute(rest, r);
          return;
        }
        const parts = splitBatch(r.stdout);
        let k = 0;
        while (k + 1 < rest.length && parts.has(rest[k]!.file) && parts.has(rest[k + 1]!.file)) k++;
        const suspectFails = !(await runOne(rest[k]!));
        i += k + 1;
        if (suspectFails) {
          if (k > 0) await runBatch(rest.slice(0, k));
          streak = 1;
          continue;
        }
        if (k > 0 && k + 1 === rest.length) {
          // Every section was complete, so the output pinpoints nothing and re-running `[0, k]` would
          // repeat the identical failed batch (one case shorter per step: linear). Bisect `[0, k)`.
          const mid = k >> 1;
          await runBatch(rest.slice(0, mid));
          await runBatch(rest.slice(mid, k));
        } else if (k > 0) {
          const prefix = rest.slice(0, k + 1);
          const rp = await exec(prefix);
          if (ok(rp)) attribute(prefix, rp);
          else await runBatch(rest.slice(0, k)); // `prefix` is recorded as a failed batch; the suspect already has its status
        }
        const tail = batch.slice(i);
        if (tail.length > 1) {
          const mid = tail.length >> 1;
          await runBatch(tail.slice(0, mid));
          await runBatch(tail.slice(mid));
        } else if (tail.length === 1) await runBatch(tail);
        return;
      }
    };
    await runBatch(cases);
    if (stats) {
      const fails = (id: string) => {
        const o = out.get(id)!;
        return o.code !== 0 || o.timedOut;
      };
      const only = failedBatches.filter((b) => ![...b.ids].some(fails));
      // Keep the smallest: drop a batch that strictly contains another batch-only failure.
      const minimal = only.filter((b) => !only.some((o) => o !== b && o.ids.size < b.ids.size && [...o.ids].every((id) => b.ids.has(id))));
      // Identical id sets (the same batch failing twice) count once.
      const seen = new Set<string>();
      for (const b of minimal) {
        const key = [...b.ids].sort().join("\0");
        if (seen.has(key)) continue;
        seen.add(key);
        if (b.timedOut) stats.batchOnlyTimeouts++;
        else stats.batchOnlyFailures++;
      }
    }
  } else {
    for (const c of cases) {
      const r = await exec([c]);
      out.set(c.id, { text: render(r), code: r.code, timedOut: r.timedOut });
      usage?.set(c.id, usageOf(r));
    }
  }
  return out;
}

export function classify(o: Output, sub: Output): Status {
  if (o.timedOut) return "ORACLE_TIMEOUT";
  if (o.unstable !== undefined) return "UNSTABLE";
  if (sub.timedOut) return "TIMEOUT";
  if (sub.text === o.text && sub.code === o.code) return "MATCH";
  if (sub.code === EXIT_UNPORTED) return "UNPORTED";
  if (sub.code === 101 && o.code !== 101) return "CRASH";
  return "DIFF";
}

function firstDiff(a: string, b: string): string {
  const al = a.split("\n");
  const bl = b.split("\n");
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) return `line ${i + 1}\n  oracle:  ${JSON.stringify(al[i] ?? "<eof>")}\n  subject: ${JSON.stringify(bl[i] ?? "<eof>")}`;
  }
  return "(identical text; exit codes differ)";
}

function firstDiffLine(a: string, b: string): string {
  const al = a.split("\n");
  const bl = b.split("\n");
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) return `${i + 1}: ${JSON.stringify((al[i] ?? "<eof>").slice(0, 200))} | ${JSON.stringify((bl[i] ?? "<eof>").slice(0, 200))}`;
  }
  return "(identical text; exit codes differ)";
}

export function sample<T extends { id: string }>(items: T[], n: number, seed: string): T[] {
  return items
    .map((it) => ({ it, k: hash(seed + "\0" + it.id) }))
    .sort((a, b) => (a.k < b.k ? -1 : 1))
    .slice(0, n)
    .map((x) => x.it)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The blessed-output report of one case (see the header). */
export interface BlessedResult {
  id: string;
  blessed: "PASS" | "FAIL" | "NOT_COVERED" | "N/A" | "ORACLE_TIMEOUT";
  /** N/A: why; NOT_COVERED: first difference oracle | blessed; FAIL: first difference subject | blessed. */
  why?: string;
}
export const BLESSED_STATUSES: BlessedResult["blessed"][] = ["PASS", "FAIL", "NOT_COVERED", "N/A", "ORACLE_TIMEOUT"];

/** The stderr part of a single-mode output (`render`). */
function stderrOf(o: Output): string {
  const start = o.text.indexOf("\n--- stderr ---\n");
  const end = o.text.lastIndexOf("\n--- exit: ");
  return start < 0 || end < start ? "" : o.text.slice(start + "\n--- stderr ---\n".length, end);
}

function blessedResult(id: string, b: Blessed, o: Output, sub: Output): BlessedResult {
  if ("na" in b) return { id, blessed: "N/A", why: b.na };
  if (o.timedOut) return { id, blessed: "ORACLE_TIMEOUT" };
  const on = b.normalize(stderrOf(o));
  if (on !== b.expected) return { id, blessed: "NOT_COVERED", why: firstDiffLine(on, b.expected) };
  const sn = b.normalize(stderrOf(sub));
  return sn === b.expected ? { id, blessed: "PASS" } : { id, blessed: "FAIL", why: firstDiffLine(sn, b.expected) };
}

/** A split run's oracle side as the oracle cache keeps it (see the header): hashes, never the text. */
interface SplitOracle {
  code: number;
  stderr: string;
  hashes: SplitHashes;
}

/** What one split run reports (see `runSplit`). */
interface SplitRunResult {
  /** The run case first, then the oracle's sections in output order. */
  results: CaseResult[];
  /** Diff file texts by case id: DIFF sections and run cases, and the run case of a run-level DIFF/CRASH. */
  diffs: Map<string, string>;
  /** Ids (`<run id>|<section id>`) of the sections only the subject printed, in its order. */
  extra: string[];
  heavy?: HeavyRun;
  /** The oracle's re-run for the diff files' text, if there was one (see the header). */
  oracleRerun?: OracleRerun;
}

/** A split run's second oracle process (see the header): summary and gate.json `oracleReruns`. */
export interface OracleRerun {
  run: string;
  /**
   * `reproduced`: the cached entry, exactly; `timed out`: no oracle text for the diff files (the statuses stand);
   * `not reproduced`: the entry is removed and the cases it would have scored are UNSTABLE (`detail`).
   */
  outcome: "reproduced" | "timed out" | "not reproduced";
  detail?: string;
}

/** The text the run case compares (see the header): the skeleton, then stderr and exit code as `render` lays them out. */
const runCaseText = (skeleton: string, stderr: string, code: number) => render({ stdout: skeleton, stderr, code });

/** What `rust-ts: unported: <what>` a failed subject printed (stderr first: stdout may be a large partial dump). */
const unportedOf = (r: ProcResult): string | undefined => (/^rust-ts: unported: (.*)$/m.exec(r.stderr) ?? /^rust-ts: unported: (.*)$/m.exec(r.stdout))?.[1]?.slice(0, 300);

/** How a subject process ended, for an ORACLE_TIMEOUT/UNSTABLE run case (as `record` in `difftest`). */
const subjectEnd = (r: ProcResult): string =>
  r.timedOut ? "TIMEOUT" : r.code === 101 ? "ICE" : r.code === EXIT_UNPORTED ? `UNPORTED: ${unportedOf(r) ?? ""}` : `exit ${r.code}`;

/** A diff file's text (as `record` in `difftest` writes them). */
const diffText = (id: string, status: Status, c: Case, o: string, oCode: number, sub: string, sCode: number): string =>
  `case: ${id}\nstatus: ${status}\nargs: ${c.args.join(" ")}\nfirst difference at ${firstDiff(o, sub)}\n\n=== oracle (exit ${oCode}) ===\n${o.slice(0, 20000)}\n=== subject (exit ${sCode}) ===\n${sub.slice(0, 20000)}\n`;

const MISSING = "missing from the subject's output";

/**
 * One run of a split suite (see the header): the oracle (cached as hashes, or run) and the subject, concurrently, or
 * one after the other for a heavy suite, then the statuses of the run case and of every oracle section.
 */
export async function runSplit(s: Suite, c: Case, impl: string, stats: SubjectStats): Promise<SplitRunResult> {
  const splitter = SPLITTERS[s.split!]!;
  const listed = unstableOf(s);
  const cwd = cwdOf(s);
  const timeoutMs = s.oracleTimeoutMs ?? s.timeoutMs;
  const p = cachePath(s, c, fileHash(s, c), depsOf(s, c));
  /** One oracle process; a timed-out one is retried once with a longer timeout (as in `runOracle`). */
  const oracleProc = async (): Promise<ProcResult> => {
    const r = await run(s.oracle([c]), { cwd, timeoutMs, env: caseEnv(c.env) });
    return r.timedOut ? await run(s.oracle([c]), { cwd, timeoutMs: timeoutMs * ORACLE_RETRY_FACTOR, env: caseEnv(c.env) }) : r;
  };
  /** What the oracle side found: its usage if it ran, its split text if it ran and finished, why it is unstable. */
  const fresh: { usage?: Usage; out?: SplitOutput; unstable?: string; timedOut?: boolean } = {};
  let cached = !listed.has(c.id) && existsSync(p) ? readCachedAs<SplitOracle>(p, (o) => typeof o?.code === "number" && typeof o.stderr === "string" && Array.isArray(o.hashes?.sections)) : undefined;
  if (cached && unstableOracleReason(cached.stderr)) {
    // An entry written before its pattern was known: never reused, removed (as in `runOracle`).
    rmSync(p, { force: true });
    cached = undefined;
  }
  const oracleSide = async (): Promise<SplitOracle | undefined> => {
    if (cached) return cached;
    const r = await oracleProc();
    fresh.usage = usageOf(r);
    if (r.timedOut) {
      fresh.timedOut = true;
      return undefined;
    }
    fresh.out = splitter(r.stdout);
    const o: SplitOracle = { code: r.code, stderr: r.stderr, hashes: splitHashes(fresh.out) };
    fresh.unstable = listed.get(c.id) ?? unstableOracleReason(r.stderr);
    if (!fresh.unstable) writeCached(p, o);
    return o;
  };
  const subjectSide = (): Promise<ProcResult> => {
    stats.processes++;
    return run(s.subject([c]), { cwd, timeoutMs: s.timeoutMs, env: { ...caseEnv(c.env), RUST_TS_IMPL: impl } });
  };
  const [o, r] = s.heavy ? [await oracleSide(), await subjectSide()] : await Promise.all([oracleSide(), subjectSide()]);
  /** The heavy run's resources, once every process of the run has run (the oracle's re-run, if any, comes last). */
  const heavyOf = (rerun?: ProcResult) => (s.heavy ? heavyRun(s, c.id, fresh.usage ?? "cached", usageOf(r), rerun && usageOf(rerun)) : undefined);
  const secId = (id: string) => `${c.id}|${id}`;
  const diffs = new Map<string, string>();
  if (!o) return { results: [{ id: c.id, status: "ORACLE_TIMEOUT", subject: subjectEnd(r) }], diffs, extra: [], heavy: heavyOf() };

  /** Every case of the run with one status; the run case carries the details. */
  const all = (o: SplitOracle, head: CaseResult): CaseResult[] => [head, ...o.hashes.sections.map(([id]): CaseResult => ({ id: secId(id), status: head.status }))];
  const runLevel: Status | undefined = r.timedOut ? "TIMEOUT" : r.code !== o.code ? (r.code === EXIT_UNPORTED ? "UNPORTED" : r.code === 101 && o.code !== 101 ? "CRASH" : "DIFF") : undefined;
  let results: CaseResult[];
  let extra: string[] = [];
  let r2: ProcResult | undefined;
  let oracleRerun: OracleRerun | undefined;
  if (fresh.unstable) results = all(o, { id: c.id, status: "UNSTABLE", unstable: fresh.unstable, subject: subjectEnd(r) });
  else if (runLevel) {
    const head: CaseResult = { id: c.id, status: runLevel };
    if (runLevel === "UNPORTED") {
      const what = unportedOf(r);
      if (what !== undefined) head.unported = what;
    } else if (runLevel !== "TIMEOUT") {
      // Exit codes differ: stderr and exit code tell why (the stdout of either side may be a whole crate's dump).
      const ot = runCaseText("", o.stderr, o.code);
      const st = runCaseText("", r.stderr, r.code);
      head.first = firstDiffLine(ot, st);
      diffs.set(c.id, diffText(c.id, runLevel, c, ot, o.code, st, r.code));
    }
    results = all(o, head);
  } else {
    // Same exit code: the run case and each section on their own.
    const sub = splitter(r.stdout);
    const subH = splitHashes(sub);
    const score = (o: SplitOracle) => {
      const cmp = compareSections(o.hashes, subH);
      const rs: CaseResult[] = [{ id: c.id, status: subH.skeleton === o.hashes.skeleton && r.stderr === o.stderr ? "MATCH" : "DIFF" }];
      for (const [id, oc] of cmp.outcomes) rs.push(oc === "match" ? { id: secId(id), status: "MATCH" } : oc === "missing" ? { id: secId(id), status: "DIFF", first: MISSING } : { id: secId(id), status: "DIFF" });
      return { rs, extra: cmp.extra };
    };
    ({ rs: results, extra } = score(o));
    if (results.some((x) => x.status === "DIFF")) {
      // The diff files and `first` need the oracle's text; a cached oracle is run again for it, and that run must
      // reproduce the cached entry: otherwise the entry is known not to be reproducible, and nothing is scored against
      // it (see the header).
      let oText: { out: SplitOutput; stderr: string; code: number } | undefined = fresh.out && { out: fresh.out, stderr: o.stderr, code: o.code };
      if (!oText) {
        r2 = await oracleProc();
        if (r2.timedOut) oracleRerun = { run: c.id, outcome: "timed out" };
        else {
          const out2 = splitter(r2.stdout);
          const h2 = splitHashes(out2);
          // An equal skeleton has the same section ids in the same order, so the hash lists line up.
          const whole =
            r2.code !== o.code ? `exit code (${o.code} cached, ${r2.code} now)` : r2.stderr !== o.stderr ? "stderr" : h2.skeleton !== o.hashes.skeleton || h2.sections.length !== o.hashes.sections.length ? "skeleton" : undefined;
          const changed = whole ? [] : o.hashes.sections.filter(([id, h], k) => h2.sections[k]![0] !== id || h2.sections[k]![1] !== h).map(([id]) => secId(id));
          if (whole !== undefined || changed.length) {
            rmSync(p, { force: true });
            const why = `detected: the oracle's re-run did not reproduce its cached ${whole ?? `text of ${changed.length} section(s)`}`;
            oracleRerun = { run: c.id, outcome: "not reproduced", detail: whole !== undefined ? `${whole} differs: every case of the run is UNSTABLE` : `${changed.length} section(s) differ and are UNSTABLE` };
            console.log(`ERROR: ${s.name} ${c.id}: the oracle's re-run did not reproduce its cached entry (${oracleRerun.detail}); the entry is removed`);
            const hit = new Set(whole !== undefined ? results.map((x) => x.id) : changed);
            results = results.map((x): CaseResult => (hit.has(x.id) ? { id: x.id, status: "UNSTABLE", unstable: why, ...(x.id === c.id ? { subject: subjectEnd(r) } : {}) } : x));
            // (The sections that did reproduce keep their statuses; their text is the fresh run's.)
            if (whole === undefined) oText = { out: out2, stderr: r2.stderr, code: r2.code };
          } else {
            oracleRerun = { run: c.id, outcome: "reproduced" };
            oText = { out: out2, stderr: r2.stderr, code: r2.code };
          }
        }
      }
      const oSec = new Map(oText?.out.sections.map((x) => [x.id, x.text]));
      const sSec = new Map(sub.sections.map((x) => [x.id, x.text]));
      for (const x of results) {
        if (x.status !== "DIFF") continue;
        if (!oText) {
          x.first ??= "(the oracle's text is not available: its re-run timed out)";
          continue;
        }
        const isRun = x.id === c.id;
        const ot = isRun ? runCaseText(oText.out.skeleton, oText.stderr, oText.code) : oSec.get(x.id.slice(c.id.length + 1))!;
        const st = isRun ? runCaseText(sub.skeleton, r.stderr, r.code) : (sSec.get(x.id.slice(c.id.length + 1)) ?? "");
        if (x.first !== MISSING) x.first = firstDiffLine(ot, st);
        diffs.set(x.id, diffText(x.id, "DIFF", c, ot, oText.code, x.first === MISSING ? `<${MISSING}>` : st, r.code));
      }
    }
  }
  // Cases listed in `Suite.unstable` are never compared.
  results = results.map((x) => {
    const why = listed.get(x.id);
    if (why === undefined || x.status === "UNSTABLE") return x;
    diffs.delete(x.id);
    return { id: x.id, status: "UNSTABLE", unstable: why };
  });
  return { results, diffs, extra: extra.map(secId), heavy: heavyOf(r2), ...(oracleRerun ? { oracleRerun } : {}) };
}

export interface RunOptions {
  suite: string;
  sample?: number;
  seed?: string;
  filter?: string;
  impl?: string;
  jobs?: number;
  batchSize?: number;
  runId?: string;
  quiet?: boolean;
  /** `blessed`: also write the blessed-output report (see the header). */
  report?: string;
}

export async function difftest(
  opts: RunOptions,
): Promise<{
  results: CaseResult[];
  dir: string;
  counts: Record<Status, number>;
  stats: SubjectStats;
  skipped?: number;
  oracleTimeoutSubjects: OracleTimeoutSubjects;
  subsets?: Record<string, Record<Status | "total", number>>;
  blessed?: Record<BlessedResult["blessed"], number>;
  /** `git status` lines of the upstream checkout before the run (scripts/lib/upstream.ts); should be empty. */
  upstreamDirty: string[];
  /** What the run (or a concurrent process) changed in the upstream checkout; should be empty. */
  upstreamChanges: string[];
  /** Split suites: how many sections only the subject printed (listed in `<suite>.extra.jsonl`). */
  extra?: number;
  /** Heavy suites: each run's resources. */
  heavy?: HeavyRun[];
  /** Split suites: each run's oracle re-run (see the header), if it had one. */
  oracleReruns?: OracleRerun[];
}> {
  requireUpstream();
  await verifyOraclePin();
  const upstreamBefore = upstreamStatus(UPSTREAM);
  if (upstreamBefore.length) console.log(upstreamError("the upstream checkout is not clean before the run", upstreamBefore, UPSTREAM));
  const s = getSuite(opts.suite);
  let cases = s.cases();
  const listedUnstable = unstableOf(s);
  if (!opts.filter && !opts.sample) {
    const ids = new Set(cases.map((c) => c.id));
    const stale = [...listedUnstable.keys()].filter((id) => !ids.has(id));
    if (stale.length) console.log(`note: suite ${s.name} lists ${stale.length} unstable case(s) that are not cases of it (e.g. ${stale[0]})`);
  }
  if (s.mode === "batch" && cases.some((c) => c.env !== undefined)) die(`suite ${s.name}: a batch suite's cases cannot have their own env`);
  const split = s.mode === "split";
  if (split && !(s.split && Object.hasOwn(SPLITTERS, s.split))) die(`suite ${s.name}: unknown splitter '${s.split}' (have: ${Object.keys(SPLITTERS).join(", ")})`);
  if (split && (s.subsets || s.blessed)) die(`suite ${s.name}: a split suite has no subsets or blessed report`);
  if (s.heavy && s.mode === "batch") die(`suite ${s.name}: a batch suite cannot be heavy`);
  // A split suite's runs all run; `--filter`/`--sample` select among the cases they report (see the header).
  if (opts.filter && !split) cases = cases.filter((c) => c.id.includes(opts.filter!));
  const skipped = (s.skipped?.() ?? []).filter((k) => !opts.filter || k.id.includes(opts.filter));
  const seed = opts.seed ?? process.env.RUST_TS_AGENT ?? "0";
  if (opts.sample && !split) cases = sample(cases, opts.sample, seed);
  if (opts.report !== undefined && opts.report !== "blessed") die(`unknown report '${opts.report}' (have: blessed)`);
  const blessedFor = opts.report === "blessed" ? s.blessed : undefined;
  if (opts.report === "blessed" && !blessedFor) die(`suite ${s.name} has no blessed-output report`);
  const blessedResults: BlessedResult[] = [];
  const impl = opts.impl ?? "port";
  const dir = ensureDir(join(RUNS, opts.runId ?? nowId()));
  const diffDir = ensureDir(join(dir, "diffs", s.name));

  const batchSize = s.mode === "batch" ? (opts.batchSize ?? 100) : 1;
  const chunks: Case[][] = [];
  // (A split suite's runs go through `runSplit` below, not this pool.)
  if (!split) for (let i = 0; i < cases.length; i += batchSize) chunks.push(cases.slice(i, i + batchSize));
  const jobs = s.heavy ? 1 : (opts.jobs ?? availableParallelism());
  const heavyRuns: HeavyRun[] = [];

  const results: CaseResult[] = [];
  const stats: SubjectStats = { processes: 0, batchOnlyFailures: 0, batchOnlyTimeouts: 0 };
  const oracleTimeoutSubjects: OracleTimeoutSubjects = { ok: 0, TIMEOUT: 0, ICE: 0, UNPORTED: 0 };
  let diffsWritten = 0;
  const started = performance.now();
  /** Records a case's status (and its blessed result and diff file) from its oracle and subject outputs. */
  const record = (c: Case, oc: Output, sc: Output, retried: boolean) => {
    const status = classify(oc, sc);
    const r: CaseResult = { id: c.id, status };
    if (retried) r.retried = true;
    if (status === "UNPORTED") {
      const m = /^rust-ts: unported: (.*)$/m.exec(sc.text);
      if (m) r.unported = m[1]!.slice(0, 300);
    } else if (status === "DIFF" || status === "CRASH") r.first = firstDiffLine(oc.text, sc.text);
    else if (status === "UNSTABLE") {
      const m = /^rust-ts: unported: (.*)$/m.exec(sc.text);
      r.unstable = oc.unstable!;
      r.subject = sc.timedOut ? "TIMEOUT" : sc.code === 101 ? "ICE" : sc.code === EXIT_UNPORTED ? `UNPORTED: ${(m?.[1] ?? "").slice(0, 300)}` : `exit ${sc.code}`;
    } else if (status === "ORACLE_TIMEOUT") {
      const m = /^rust-ts: unported: (.*)$/m.exec(sc.text);
      r.subject = sc.timedOut ? "TIMEOUT" : sc.code === 101 ? "ICE" : sc.code === EXIT_UNPORTED ? `UNPORTED: ${(m?.[1] ?? "").slice(0, 300)}` : `exit ${sc.code}`;
      const k = sc.timedOut ? "TIMEOUT" : sc.code === 101 ? "ICE" : sc.code === EXIT_UNPORTED ? "UNPORTED" : "ok";
      oracleTimeoutSubjects[k]++;
    }
    results.push(r);
    if (blessedFor) blessedResults.push(blessedResult(c.id, blessedFor(c), oc, sc));
    if (status !== "MATCH" && status !== "UNPORTED" && diffsWritten < 500) {
      diffsWritten++;
      const name = c.id.replace(/[\\/:]/g, "__");
      writeFileSync(
        join(diffDir, name + ".txt"),
        `case: ${c.id}\nstatus: ${status}\nargs: ${c.args.join(" ")}\nfirst difference at ${firstDiff(oc.text, sc.text)}\n\n=== oracle (exit ${oc.code}) ===\n${oc.text.slice(0, 20000)}\n=== subject (exit ${sc.code}) ===\n${sc.text.slice(0, 20000)}\n`,
      );
    }
  };
  /** Cases whose subject timed out in the parallel pool (with their oracle output). */
  const timedOut: { c: Case; oc: Output }[] = [];
  await pool(
    chunks,
    jobs,
    async (chunk) => {
      // A heavy suite runs one process at a time: the oracle, then the subject, each recording its resources.
      const oUsage = new Map<string, Usage>();
      const sUsage = new Map<string, Usage>();
      const [o, sub] = s.heavy
        ? [await runOracle(s, chunk, oUsage), await runSubject(s, chunk, impl, stats, sUsage)]
        : await Promise.all([runOracle(s, chunk), runSubject(s, chunk, impl, stats)]);
      for (const c of chunk) {
        const oc = o.get(c.id)!;
        const sc = sub.get(c.id)!;
        if (s.heavy) heavyRuns.push(heavyRun(s, c.id, oUsage.get(c.id) ?? "cached", sUsage.get(c.id)!));
        // (A heavy subject already ran alone: its TIMEOUT is not re-run.)
        if (classify(oc, sc) === "TIMEOUT" && !s.heavy) timedOut.push({ c, oc });
        else record(c, oc, sc, false);
      }
    },
    opts.quiet
      ? undefined
      : (n) => {
          if (n % 20 === 0 || n === chunks.length) process.stderr.write(`\r${s.name}: ${n}/${chunks.length} batches`);
        },
  );
  if (!opts.quiet) process.stderr.write("\n");
  // A subject that timed out in the pool is re-run once, alone, with the same timeout, once the pool is
  // done: a timeout from contention with the pool's other jobs (or a concurrent process) is not the
  // case's, but a subject slower than the limit on its own still times out. Past the cap the rest keep
  // their TIMEOUT unretried (a hang on a common path would otherwise cost a timeout per case, serially).
  const retries = { retried: 0, finished: 0, notRetried: 0 };
  for (const { c, oc } of timedOut) {
    if (retries.retried >= SUBJECT_TIMEOUT_RETRY_CAP) {
      retries.notRetried++;
      record(c, oc, { text: "", code: 0, timedOut: true }, false);
      continue;
    }
    if (!opts.quiet) process.stderr.write(`\r${s.name}: re-running subject timeout ${retries.retried + 1}/${Math.min(timedOut.length, SUBJECT_TIMEOUT_RETRY_CAP)} alone`);
    retries.retried++;
    const sc = (await runSubject(s, [c], impl, stats)).get(c.id)!;
    if (!sc.timedOut) retries.finished++;
    record(c, oc, sc, true);
  }
  if (!opts.quiet && retries.retried) process.stderr.write("\n");
  /** Split suites: ids of the sections only the subject printed (see the header). */
  const extra: { run: string; id: string }[] = [];
  const oracleReruns: OracleRerun[] = [];
  if (split) {
    const reported: CaseResult[] = [];
    const diffTexts = new Map<string, string>();
    await pool(cases, jobs, async (c) => {
      if (!opts.quiet) process.stderr.write(`${s.name}: run ${c.id}${s.heavy ? " (heavy: one process at a time)" : ""}\n`);
      const sr = await runSplit(s, c, impl, stats);
      if (sr.heavy) heavyRuns.push(sr.heavy);
      if (sr.oracleRerun) oracleReruns.push(sr.oracleRerun);
      for (const id of sr.extra) extra.push({ run: c.id, id });
      for (const x of sr.results) if (!opts.filter || x.id.includes(opts.filter)) reported.push(x);
      for (const [id, t] of sr.diffs) diffTexts.set(id, t);
    });
    for (const x of opts.sample ? sample(reported, opts.sample, seed) : reported) {
      results.push(x);
      if (x.status === "ORACLE_TIMEOUT") oracleTimeoutSubjects[x.subject === "TIMEOUT" || x.subject === "ICE" ? x.subject : x.subject?.startsWith("UNPORTED") ? "UNPORTED" : "ok"]++;
      const t = diffTexts.get(x.id);
      if (t === undefined || diffsWritten >= 500) continue;
      diffsWritten++;
      // Section ids can be long (core's MIR headers: up to 600 chars): a cut name plus a hash of the id.
      writeFileSync(join(diffDir, `${x.id.replace(/[^\w.@-]+/g, "_").slice(0, 100)}-${hash(x.id).slice(0, 10)}.txt`), t);
    }
  }
  results.sort((a, b) => (a.id < b.id ? -1 : 1));
  const counts = Object.fromEntries(STATUSES.map((st) => [st, 0])) as Record<Status, number>;
  for (const r of results) counts[r.status]++;
  writeFileSync(join(dir, `${s.name}.jsonl`), results.map((r) => JSON.stringify(r)).join("\n") + "\n");
  let subsets: Record<string, Record<Status | "total", number>> | undefined;
  if (s.subsets) {
    subsets = {};
    const byId = new Map(cases.map((c) => [c.id, c]));
    for (const [name, has] of Object.entries(s.subsets)) {
      const sc = Object.fromEntries(["total", ...STATUSES].map((st) => [st, 0])) as Record<Status | "total", number>;
      for (const r of results) {
        if (!has(byId.get(r.id)!)) continue;
        sc.total++;
        sc[r.status]++;
      }
      subsets[name] = sc;
    }
  }
  let blessed: Record<BlessedResult["blessed"], number> | undefined;
  if (blessedFor) {
    blessedResults.sort((a, b) => (a.id < b.id ? -1 : 1));
    blessed = Object.fromEntries(BLESSED_STATUSES.map((st) => [st, 0])) as Record<BlessedResult["blessed"], number>;
    for (const r of blessedResults) blessed[r.blessed]++;
    writeFileSync(join(dir, `${s.name}.blessed.jsonl`), blessedResults.map((r) => JSON.stringify(r) + "\n").join(""));
  }
  if (s.skipped) writeFileSync(join(dir, `${s.name}.skipped.jsonl`), skipped.map((k) => JSON.stringify(k) + "\n").join(""));
  if (split) writeFileSync(join(dir, `${s.name}.extra.jsonl`), extra.map((x) => JSON.stringify(x) + "\n").join(""));
  const upstreamAfter = upstreamStatus(UPSTREAM);
  const changed = upstreamChanges(upstreamBefore, upstreamAfter);
  if (changed.length) {
    console.log(upstreamError(`suite ${s.name}: the upstream checkout changed during the run (this run or a concurrent process)`, changed, UPSTREAM));
    writeFileSync(join(dir, `${s.name}.upstream-changes.txt`), changed.join("\n") + "\n");
  }
  const summary = {
    suite: s.name,
    impl,
    total: results.length,
    ...counts,
    sample: opts.sample ?? null,
    filter: opts.filter ?? null,
    seconds: Math.round((performance.now() - started) / 1000),
    ...stats,
    ...(timedOut.length ? { subjectTimeoutRetries: retries } : {}),
    ...(s.skipped ? { skipped: skipped.length } : {}),
    ...(counts.ORACLE_TIMEOUT ? { oracleTimeoutSubjects } : {}),
    ...(subsets ? { subsets } : {}),
    ...(blessed ? { blessed } : {}),
    ...(upstreamBefore.length ? { upstreamDirty: upstreamBefore } : {}),
    ...(changed.length ? { upstreamChanges: changed } : {}),
    ...(split ? { extra: extra.length, oracleReruns } : {}),
    ...(s.heavy ? { heavy: heavyRuns } : {}),
  };
  writeFileSync(join(dir, `${s.name}.summary.json`), JSON.stringify(summary, null, 2));
  return {
    results,
    dir,
    counts,
    stats,
    skipped: s.skipped ? skipped.length : undefined,
    oracleTimeoutSubjects,
    subsets,
    blessed,
    upstreamDirty: upstreamBefore,
    upstreamChanges: changed,
    ...(split ? { extra: extra.length, oracleReruns } : {}),
    ...(s.heavy ? { heavy: heavyRuns } : {}),
  };
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  if (a.list || !a.suite) {
    for (const s of SUITES) console.log(`${s.name.padEnd(8)} [${s.milestone}] ${s.description}`);
    if (!a.list) console.log("usage: bun scripts/difftest.ts --suite <name> [--sample N] [--filter S] [--impl port|shim|stub]");
    process.exit(0);
  }
  const num = (k: string) => (typeof a[k] === "string" ? Number(a[k]) : undefined);
  const { dir, counts, results, stats, skipped, oracleTimeoutSubjects: ots, subsets, blessed, extra, heavy, oracleReruns } = await difftest({
    suite: String(a.suite),
    sample: num("sample"),
    seed: typeof a.seed === "string" ? a.seed : undefined,
    filter: typeof a.filter === "string" ? a.filter : undefined,
    impl: typeof a.impl === "string" ? a.impl : undefined,
    jobs: num("jobs"),
    batchSize: num("batch-size"),
    runId: typeof a["run-id"] === "string" ? a["run-id"] : undefined,
    report: typeof a.report === "string" ? a.report : undefined,
  });
  const pct = results.length ? ((100 * counts.MATCH) / results.length).toFixed(2) : "0";
  console.log(`suite=${a.suite} total=${results.length} ${STATUSES.map((s) => `${s}=${counts[s]}`).join(" ")} match%=${pct}${skipped !== undefined ? ` skipped=${skipped}` : ""}`);
  for (const [name, sc] of Object.entries(subsets ?? {})) {
    console.log(`subset ${name}: total=${sc.total} ${STATUSES.map((st) => `${st}=${sc[st]}`).join(" ")} match%=${sc.total ? ((100 * sc.MATCH) / sc.total).toFixed(2) : "0"}`);
  }
  if (blessed) console.log(`blessed (report only): ${BLESSED_STATUSES.map((st) => `${st}=${blessed[st]}`).join(" ")} (per case: ${a.suite}.blessed.jsonl)`);
  if (stats.batchOnlyFailures || stats.batchOnlyTimeouts) {
    console.log(`note: ${stats.batchOnlyFailures} batch-only failure(s), ${stats.batchOnlyTimeouts} batch-only timeout(s): a batch process failed at a case that passes alone (see ${a.suite}.summary.json)`);
  }
  const retried = results.filter((r) => r.retried);
  if (retried.length) {
    const still = retried.filter((r) => r.status === "TIMEOUT").length;
    console.log(`note: ${retried.length} subject TIMEOUT(s) in the pool re-run alone: ${retried.length - still} finished, ${still} timed out again (per case: \`retried\` in ${a.suite}.jsonl)`);
  }
  const notRetried = results.filter((r) => r.status === "TIMEOUT" && !r.retried).length;
  if (notRetried) console.log(`note: ${notRetried} subject TIMEOUT(s) not re-run (over the cap of ${SUBJECT_TIMEOUT_RETRY_CAP})`);
  if (counts.UNSTABLE) {
    console.log(`note: ${counts.UNSTABLE} UNSTABLE case(s): the oracle's output is not reproducible (listed in the suite or detected); never cached, never MATCH (per case: \`unstable\`, \`subject\` in ${a.suite}.jsonl)`);
  }
  if (counts.ORACLE_TIMEOUT) {
    console.log(`note: ${counts.ORACLE_TIMEOUT} ORACLE_TIMEOUT case(s); the subject on them: ok=${ots.ok} TIMEOUT=${ots.TIMEOUT} ICE=${ots.ICE} UNPORTED=${ots.UNPORTED} (per case: \`subject\` in ${a.suite}.jsonl)`);
  }
  if (extra) console.log(`note: ${extra} section(s) only the subject printed (not cases; listed in ${a.suite}.extra.jsonl)`);
  // (A re-run that did not reproduce already printed its `ERROR:` line.)
  for (const x of oracleReruns ?? []) if (x.outcome === "timed out") console.log(`note: ${a.suite} ${x.run}: the oracle's re-run for the diff files timed out (no oracle text in them)`);
  for (const h of heavy ?? []) {
    console.log(heavyLine(String(a.suite), h));
    for (const l of heavyErrorLines(String(a.suite), h)) console.log(l);
  }
  console.log(`details: ${dir}`);
}
