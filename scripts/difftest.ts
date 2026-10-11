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
import { verifyOraclePin } from "./lib/oracle.ts";

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

let oracleVersionCache: string | undefined;
function oracleVersion(s: Suite): string {
  // Probe-based suites are keyed by the probe binary too, so rebuilding a probe invalidates the cache.
  if (oracleVersionCache) return oracleVersionCache;
  const cmd0 = s.oracle([{ id: "", file: "", args: [] }])[0]!;
  oracleVersionCache = existsSync(cmd0) ? hash(readFileSync(cmd0)) : PIN.commit;
  return oracleVersionCache;
}

function cachePath(s: Suite, c: Case, fileHash: string): string {
  const key = hash(JSON.stringify([PIN.commit, oracleVersion(s), s.name, c.id, c.args, fileHash]));
  return join(ensureDir(join(ORACLE_CACHE, key.slice(0, 2))), key);
}

async function runOracle(s: Suite, cases: Case[]): Promise<Map<string, Output>> {
  const out = new Map<string, Output>();
  const todo: Case[] = [];
  const paths = new Map<string, string>();
  for (const c of cases) {
    const p = cachePath(s, c, hash(readFileSync(join(UPSTREAM, c.file))));
    paths.set(c.id, p);
    if (existsSync(p)) out.set(c.id, JSON.parse(readFileSync(p, "utf8")));
    else todo.push(c);
  }
  if (todo.length === 0) return out;
  if (s.mode === "batch") {
    // A batch can time out under load; split it in halves until it succeeds, and only
    // fail when a single file cannot be run by the oracle.
    const runBatch = async (batch: Case[]): Promise<void> => {
      const r = await run(s.oracle(batch), { cwd: UPSTREAM, timeoutMs: s.timeoutMs });
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
      const r = await run(s.oracle([c]), { cwd: UPSTREAM, timeoutMs: s.timeoutMs });
      const o: Output = { text: render(r), code: r.code, timedOut: r.timedOut };
      out.set(c.id, o);
      if (!r.timedOut) writeFileSync(paths.get(c.id)!, JSON.stringify(o));
    }
  }
  return out;
}

async function runSubject(s: Suite, cases: Case[], impl: string): Promise<Map<string, Output>> {
  const env = { RUST_TS_IMPL: impl };
  const out = new Map<string, Output>();
  if (s.mode === "batch") {
    const runBatch = async (batch: Case[]): Promise<void> => {
      const r = await run(s.subject(batch), { cwd: UPSTREAM, timeoutMs: s.timeoutMs, env });
      // A timed-out batch says nothing about individual files (load, one huge file): retry in halves,
      // so TIMEOUT is only ever reported for a single file that is slow on its own.
      if (r.timedOut && batch.length > 1) {
        const mid = batch.length >> 1;
        await runBatch(batch.slice(0, mid));
        await runBatch(batch.slice(mid));
        return;
      }
      const parts = splitBatch(r.stdout);
      const failed = r.code !== 0 || r.timedOut;
      batch.forEach((c, i) => {
        // On failure the last section printed may be incomplete; treat it as missing.
        const complete = parts.has(c.file) && (!failed || (i + 1 < batch.length && parts.has(batch[i + 1]!.file)));
        out.set(c.id, complete ? { text: parts.get(c.file)!, code: 0, timedOut: false } : { text: r.stderr, code: r.code, timedOut: r.timedOut });
      });
    };
    await runBatch(cases);
  } else {
    for (const c of cases) {
      const r = await run(s.subject([c]), { cwd: UPSTREAM, timeoutMs: s.timeoutMs, env });
      out.set(c.id, { text: render(r), code: r.code, timedOut: r.timedOut });
    }
  }
  return out;
}

function classify(o: Output, sub: Output): Status {
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

export async function difftest(opts: RunOptions): Promise<{ results: CaseResult[]; dir: string; counts: Record<Status, number> }> {
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
  let diffsWritten = 0;
  const started = performance.now();
  await pool(
    chunks,
    opts.jobs ?? availableParallelism(),
    async (chunk) => {
      const [o, sub] = await Promise.all([runOracle(s, chunk), runSubject(s, chunk, impl)]);
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
  const summary = { suite: s.name, impl, total: results.length, ...counts, sample: opts.sample ?? null, filter: opts.filter ?? null, seconds: Math.round((performance.now() - started) / 1000) };
  writeFileSync(join(dir, `${s.name}.summary.json`), JSON.stringify(summary, null, 2));
  return { results, dir, counts };
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  if (a.list || !a.suite) {
    for (const s of SUITES) console.log(`${s.name.padEnd(8)} [${s.milestone}] ${s.description}`);
    if (!a.list) console.log("usage: bun scripts/difftest.ts --suite <name> [--sample N] [--filter S] [--impl port|shim|stub]");
    process.exit(0);
  }
  const num = (k: string) => (typeof a[k] === "string" ? Number(a[k]) : undefined);
  const { dir, counts, results } = await difftest({
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
  console.log(`details: ${dir}`);
}
