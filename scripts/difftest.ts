// Differential tester: runs a suite on the oracle and on rust-ts, compares outputs.
//
//   bun scripts/difftest.ts --suite <name> [options]
//     --sample N        deterministic random sample of N cases (seed: --seed, else $RUST_TS_AGENT, else 0)
//     --filter S        only cases whose id contains S
//     --impl I          RUST_TS_IMPL for the subject: port (default) | shim | stub
//     --jobs N          parallel processes (default: cores)
//     --batch-size N    files per process in batch suites (default 100)
//     --run-id ID       output dir name under $RUST_TS_DATA/runs (default: timestamp)
//     --list            list suites
//
// Statuses: MATCH | DIFF | UNPORTED (exit 70) | CRASH (subject ICE/exit mismatch with no output) | TIMEOUT
// Prints one summary line; details go to $RUST_TS_DATA/runs/<run-id>/.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { SUITES, suite as getSuite, type Case, type Suite } from "../harness/suites.ts";
import { ORACLE_CACHE, PIN, RUNS, UPSTREAM, ensureDir, hash, nowId, parseArgs, pool, requireUpstream, run } from "./lib/common.ts";
import { rustcDriverHash, verifyOraclePin } from "./lib/oracle.ts";

export type Status = "MATCH" | "DIFF" | "UNPORTED" | "CRASH" | "TIMEOUT";
export const STATUSES: Status[] = ["MATCH", "DIFF", "UNPORTED", "CRASH", "TIMEOUT"];

export interface CaseResult {
  id: string;
  status: Status;
}

interface Output {
  text: string;
  code: number;
  timedOut: boolean;
}

const EXIT_UNPORTED = 70;

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
  // build, so rebuilding a probe or reinstalling the toolchain invalidates the cache.
  let v = oracleVersionCache.get(s.name);
  if (v) return v;
  const cmd0 = s.oracle([{ id: "", file: "", args: [] }])[0]!;
  v = cmd0 === "rustc" ? rustcDriverHash() : existsSync(cmd0) ? hash(readFileSync(cmd0)) : PIN.commit;
  oracleVersionCache.set(s.name, v);
  return v;
}

/** Working directory of every command of a suite (and base of `Case.file`). */
const cwdOf = (s: Suite): string => s.cwd ?? UPSTREAM;

/** Hash of a case's input file; synthetic cases (`file: ""`) have no input. */
const fileHash = (s: Suite, c: Case): string => (c.file === "" ? "" : hash(readFileSync(join(cwdOf(s), c.file))));

function cachePath(s: Suite, c: Case, fileHash: string): string {
  const key = hash(JSON.stringify([PIN.commit, oracleVersion(s), s.name, c.id, c.args, fileHash]));
  return join(ensureDir(join(ORACLE_CACHE, key.slice(0, 2))), key);
}

async function runOracle(s: Suite, cases: Case[]): Promise<Map<string, Output>> {
  const out = new Map<string, Output>();
  const todo: Case[] = [];
  const paths = new Map<string, string>();
  for (const c of cases) {
    const p = cachePath(s, c, fileHash(s, c));
    paths.set(c.id, p);
    if (existsSync(p)) out.set(c.id, JSON.parse(readFileSync(p, "utf8")));
    else todo.push(c);
  }
  if (todo.length === 0) return out;
  if (s.mode === "batch") {
    // A batch can time out under load; split it in halves until it succeeds, and only
    // fail when a single file cannot be run by the oracle.
    const runBatch = async (batch: Case[]): Promise<void> => {
      const r = await run(s.oracle(batch), { cwd: cwdOf(s), timeoutMs: s.timeoutMs });
      if (r.code !== 0 || r.timedOut) {
        if (batch.length === 1) throw new Error(`oracle failed on ${batch[0]!.file} (exit ${r.code}${r.timedOut ? ", timeout" : ""}): ${r.stderr.slice(0, 2000)}`);
        const mid = batch.length >> 1;
        await runBatch(batch.slice(0, mid));
        await runBatch(batch.slice(mid));
        return;
      }
      const parts = splitBatch(r.stdout);
      for (const c of batch) {
        const o: Output = { text: parts.get(c.file) ?? "", code: 0, timedOut: false };
        out.set(c.id, o);
        writeFileSync(paths.get(c.id)!, JSON.stringify(o));
      }
    };
    await runBatch(todo);
  } else {
    for (const c of todo) {
      const r = await run(s.oracle([c]), { cwd: cwdOf(s), timeoutMs: s.timeoutMs });
      const o: Output = { text: render(r), code: r.code, timedOut: r.timedOut };
      out.set(c.id, o);
      if (!r.timedOut) writeFileSync(paths.get(c.id)!, JSON.stringify(o));
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

export async function runSubject(s: Suite, cases: Case[], impl: string, stats?: SubjectStats): Promise<Map<string, Output>> {
  const env = { RUST_TS_IMPL: impl };
  const out = new Map<string, Output>();
  /** Every failed multi-case batch process: its case ids and whether it timed out. */
  const failedBatches: { ids: Set<string>; timedOut: boolean }[] = [];
  const exec = async (batch: Case[]) => {
    if (stats) stats.processes++;
    const r = await run(s.subject(batch), { cwd: cwdOf(s), timeoutMs: s.timeoutMs, env });
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
        if (k > 0) {
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
    }
  }
  return out;
}

export function classify(o: Output, sub: Output): Status {
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

export function sample<T extends { id: string }>(items: T[], n: number, seed: string): T[] {
  return items
    .map((it) => ({ it, k: hash(seed + "\0" + it.id) }))
    .sort((a, b) => (a.k < b.k ? -1 : 1))
    .slice(0, n)
    .map((x) => x.it)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
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
}

export async function difftest(opts: RunOptions): Promise<{ results: CaseResult[]; dir: string; counts: Record<Status, number>; stats: SubjectStats }> {
  requireUpstream();
  await verifyOraclePin();
  const s = getSuite(opts.suite);
  let cases = s.cases();
  if (opts.filter) cases = cases.filter((c) => c.id.includes(opts.filter!));
  if (opts.sample) cases = sample(cases, opts.sample, opts.seed ?? process.env.RUST_TS_AGENT ?? "0");
  const impl = opts.impl ?? "port";
  const dir = ensureDir(join(RUNS, opts.runId ?? nowId()));
  const diffDir = ensureDir(join(dir, "diffs", s.name));

  const batchSize = s.mode === "batch" ? (opts.batchSize ?? 100) : 1;
  const chunks: Case[][] = [];
  for (let i = 0; i < cases.length; i += batchSize) chunks.push(cases.slice(i, i + batchSize));

  const results: CaseResult[] = [];
  const stats: SubjectStats = { processes: 0, batchOnlyFailures: 0, batchOnlyTimeouts: 0 };
  let diffsWritten = 0;
  const started = performance.now();
  await pool(
    chunks,
    opts.jobs ?? availableParallelism(),
    async (chunk) => {
      const [o, sub] = await Promise.all([runOracle(s, chunk), runSubject(s, chunk, impl, stats)]);
      for (const c of chunk) {
        const oc = o.get(c.id)!;
        const sc = sub.get(c.id)!;
        const status = classify(oc, sc);
        results.push({ id: c.id, status });
        if (status !== "MATCH" && status !== "UNPORTED" && diffsWritten < 500) {
          diffsWritten++;
          const name = c.id.replace(/[\\/:]/g, "__");
          writeFileSync(
            join(diffDir, name + ".txt"),
            `case: ${c.id}\nstatus: ${status}\nargs: ${c.args.join(" ")}\nfirst difference at ${firstDiff(oc.text, sc.text)}\n\n=== oracle (exit ${oc.code}) ===\n${oc.text.slice(0, 20000)}\n=== subject (exit ${sc.code}) ===\n${sc.text.slice(0, 20000)}\n`,
          );
        }
      }
    },
    opts.quiet
      ? undefined
      : (n) => {
          if (n % 20 === 0 || n === chunks.length) process.stderr.write(`\r${s.name}: ${n}/${chunks.length} batches`);
        },
  );
  if (!opts.quiet) process.stderr.write("\n");
  results.sort((a, b) => (a.id < b.id ? -1 : 1));
  const counts = Object.fromEntries(STATUSES.map((st) => [st, 0])) as Record<Status, number>;
  for (const r of results) counts[r.status]++;
  writeFileSync(join(dir, `${s.name}.jsonl`), results.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const summary = {
    suite: s.name,
    impl,
    total: results.length,
    ...counts,
    sample: opts.sample ?? null,
    filter: opts.filter ?? null,
    seconds: Math.round((performance.now() - started) / 1000),
    ...stats,
  };
  writeFileSync(join(dir, `${s.name}.summary.json`), JSON.stringify(summary, null, 2));
  return { results, dir, counts, stats };
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  if (a.list || !a.suite) {
    for (const s of SUITES) console.log(`${s.name.padEnd(8)} [${s.milestone}] ${s.description}`);
    if (!a.list) console.log("usage: bun scripts/difftest.ts --suite <name> [--sample N] [--filter S] [--impl port|shim|stub]");
    process.exit(0);
  }
  const num = (k: string) => (typeof a[k] === "string" ? Number(a[k]) : undefined);
  const { dir, counts, results, stats } = await difftest({
    suite: String(a.suite),
    sample: num("sample"),
    seed: typeof a.seed === "string" ? a.seed : undefined,
    filter: typeof a.filter === "string" ? a.filter : undefined,
    impl: typeof a.impl === "string" ? a.impl : undefined,
    jobs: num("jobs"),
    batchSize: num("batch-size"),
    runId: typeof a["run-id"] === "string" ? a["run-id"] : undefined,
  });
  const pct = results.length ? ((100 * counts.MATCH) / results.length).toFixed(2) : "0";
  console.log(`suite=${a.suite} total=${results.length} ${STATUSES.map((s) => `${s}=${counts[s]}`).join(" ")} match%=${pct}`);
  if (stats.batchOnlyFailures || stats.batchOnlyTimeouts) {
    console.log(`note: ${stats.batchOnlyFailures} batch-only failure(s), ${stats.batchOnlyTimeouts} batch-only timeout(s): a batch process failed at a case that passes alone (see ${a.suite}.summary.json)`);
  }
  console.log(`details: ${dir}`);
}
