// CTFE trace sample (lane miri-log-fix's evidence script, `$RUST_TS_DATA/tmp/miri-log-fix/scripts/ctfe-sample.ts`,
// moved into the repo by lane harness-w37). A tool, not a suite: nothing is protected by it and the gate does not run
// it. It checks the port's tracing events (RUSTC_LOG) of const evaluation on real tests, file by file.
//
//   bun scripts/ctfe-sample.ts [--n <N>|all] [--filter <RUSTC_LOG>] [--dir <tests dir>] [--jobs <J>] [--file <f.rs>]
//
// Defaults: `--n 150 --filter rustc_const_eval::interpret=info --dir tests/ui/consts --jobs 6` (the miri-log lanes'
// run). The files are every `.rs` under `--dir` (relative to the upstream checkout), sorted, and every k-th of them
// (scripts/lib/ctfe-sample.ts `sampleFiles`: the same selection as the lanes' script); `--file` checks one file
// instead. For each file both sides run, in the upstream checkout (nothing is written there: `-Zunpretty` writes no
// output file, `RUSTC_ICE=0` no ICE report, `-Zwrite-long-types-to-disk=no` no long-type file):
//   <oracle rustc | bun src/rust_ts/main.ts> --edition <the file's `//@ edition`, else 2015>
//     --target x86_64-unknown-linux-gnu --sysroot <oracle sysroot> -Zunpretty=mir -Zwrite-long-types-to-disk=no <file>
// with the caller's environment minus scripts/lib/env.ts's scrubbed variables, plus `RUSTC_LOG=<filter>`,
// `RUSTC_ICE=0`, `RUST_BACKTRACE=0`. Other directives of the file (revisions, compile-flags, aux crates) are not
// read: a file that needs them differs on both sides alike or is a known limit of the sample, not of the port.
// Each side's stdout and stderr are streamed and the process is killed past CAP bytes (nothing big is kept) or after
// TIMEOUT_MS. The classes and what fails are scripts/lib/ctfe-sample.ts's header: a crash (port exit 101 where the
// oracle did not ICE) is a failure, never a skip.
// Output: the counts per class and the most frequent details of each (the full report in
// `$RUST_TS_DATA/ctfe-sample/<run id>/report.txt`, one JSON line per file in `results.jsonl`). Exit 1 with an
// `ERROR:` line when any file failed (differed, crashed, port-timeout), 0 otherwise.
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DATA, REPO, UPSTREAM, die, ensureDir, nowId, parseArgs, pool, requireUpstream } from "./lib/common.ts";
import { caseEnv, mergeEnv } from "./lib/env.ts";
import { oracleRustcCmd, oracleSysroot, verifyOraclePin } from "./lib/oracle.ts";
import { type SampleResult, type SampleRun, FAILURE_CLASSES, classify, failures, fileEdition, sampleFiles, sampleReport } from "./lib/ctfe-sample.ts";

/** Per side and stream: past this many bytes the process is killed and the file is not compared (oracle) or differs (port). */
export const CAP = 5_000_000;
export const TIMEOUT_MS = 120_000;
/** The default `--filter`, `--n`, `--dir`, `--jobs`. */
export const DEFAULTS = { filter: "rustc_const_eval::interpret=info", n: 150, dir: "tests/ui/consts", jobs: 6 } as const;
/** Report groups printed per class (report.txt has them all). */
const CONSOLE_GROUPS = 5;

/** Run `cmd` in the upstream checkout, streaming its output; killed past CAP bytes on a stream or after TIMEOUT_MS. */
async function runCapped(cmd: string[], env: Record<string, string>): Promise<SampleRun> {
  const p = Bun.spawn(cmd, { env, cwd: UPSTREAM, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let over = false;
  let timeout = false;
  const timer = setTimeout(() => {
    timeout = true;
    p.kill(9);
  }, TIMEOUT_MS);
  const read = async (s: ReadableStream<Uint8Array>): Promise<string> => {
    const chunks: Uint8Array[] = [];
    let n = 0;
    for await (const c of s) {
      if (over) continue;
      n += c.length;
      chunks.push(c);
      if (n > CAP) {
        over = true;
        p.kill(9);
      }
    }
    return Buffer.concat(chunks).toString("utf8");
  };
  const [stdout, stderr] = await Promise.all([read(p.stdout), read(p.stderr)]);
  const exit = await p.exited;
  clearTimeout(timer);
  return { exit, stdout, stderr, over, timeout };
}

/** Every `.rs` file under `dir` (absolute). */
function rsFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) rsFiles(p, out);
    else if (p.endsWith(".rs")) out.push(p);
  }
  return out;
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) {
    console.log("usage: bun scripts/ctfe-sample.ts [--n N|all] [--filter RUSTC_LOG] [--dir DIR] [--jobs J] [--file F.rs]");
    process.exit(0);
  }
  requireUpstream();
  await verifyOraclePin();
  const filter = typeof a.filter === "string" ? a.filter : DEFAULTS.filter;
  const jobs = typeof a.jobs === "string" ? Number(a.jobs) : DEFAULTS.jobs;
  const n = a.n === "all" ? "all" : typeof a.n === "string" ? Number(a.n) : DEFAULTS.n;
  if ((n !== "all" && !(Number.isInteger(n) && n > 0)) || !(Number.isInteger(jobs) && jobs > 0)) die("--n must be a positive integer or `all`, --jobs a positive integer");
  let pick: string[];
  if (typeof a.file === "string") {
    pick = [join(UPSTREAM, a.file)];
  } else {
    const dir = typeof a.dir === "string" ? a.dir : DEFAULTS.dir;
    pick = sampleFiles(rsFiles(join(UPSTREAM, dir)), n);
  }
  if (pick.length === 0) die("no .rs files selected");
  const out = ensureDir(join(DATA, "ctfe-sample", nowId()));
  const sysroot = oracleSysroot();
  const env = mergeEnv(process.env, caseEnv({ RUSTC_LOG: filter, RUSTC_ICE: "0", RUST_BACKTRACE: "0" }));
  const portEnv = { ...env, RUST_TS_IMPL: "port" };
  const results: SampleResult[] = await pool(pick, jobs, async (f) => {
    const file = relative(UPSTREAM, f).replaceAll("\\", "/");
    const args = ["--edition", fileEdition(await Bun.file(f).text()), "--target", "x86_64-unknown-linux-gnu", "--sysroot", sysroot, "-Zunpretty=mir", "-Zwrite-long-types-to-disk=no", file];
    const o = await runCapped(oracleRustcCmd(args), env);
    const p = o.over || o.timeout ? undefined : await runCapped([process.execPath, join(REPO, "src/rust_ts/main.ts"), ...args], portEnv);
    return { file, ...classify(o, p, REPO) };
  });
  results.sort((x, y) => x.file.localeCompare(y.file));
  const report = sampleReport(results, filter, Infinity);
  writeFileSync(join(out, "results.jsonl"), results.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(join(out, "report.txt"), report.join("\n") + "\n");
  for (const l of sampleReport(results, filter, CONSOLE_GROUPS)) console.log(l);
  console.log(`details: ${out}`);
  const bad = failures(results);
  if (bad > 0) {
    const by = FAILURE_CLASSES.map((c) => `${c} ${results.filter((r) => r.cls === c).length}`).join(", ");
    console.log(`ERROR: ctfe-sample: ${bad} of ${results.length} files failed (${by}); see ${join(out, "report.txt")}`);
    process.exit(1);
  }
}
