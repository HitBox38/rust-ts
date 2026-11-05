// The alias sweep (lane mir-alias; test helper, not a port, and not a unit test: see docs/handoff/mir-alias.md for the cost).
//   bun src/rustc_mir_transform/alias_check_oracle/sweep.ts --tests <dir> [--sample N] [--modes o0,o2,o3,o4,dbg,abort,inl,miropt,all,mono,dump]
//       [--jobs 4] [--timeout 120000] [--name <run name>]
//
// Every `.rs` under `--tests` (without `auxiliary/`; tests with `aux-build`/`proc-macro` directives are skipped, since aux
// crates are not built here) runs once per mode through driver.ts and, except for `mono`, through the oracle with the same
// argv. So each run gives both the checker's hits and a byte comparison of `-Zunpretty=mir`.
//
// Mode `dump` runs src/rust_ts/main.ts, not driver.ts, and also compares the dump of every pass: `-Zdump-mir=<all pass names and
// phases>` (so not `nll`, whose graphviz is unported) with `-Zverbose-internals`, so regions show. It finds what no walk can:
// a body that was edited twice or too early and is back to the right text by the end of the pipeline, or a value leaking
// out of a clone. It reports no hits.
//
// `--tests` on tests/ui (or any directory where most files should fail) keeps only `run-pass`, `build-pass` and `check-pass`
// programs when `--passing` is given. `--sample N` takes N files by a hash of `$RUST_TS_AGENT` and the path.
//
// `--argv-file <jsonl>` runs real crates instead of `--tests`: one `{"cwd", "args", "env"}` per line, as a `RUSTC_WRAPPER` around
// `cargo build` records them (docs/handoff/mir-alias.md). Modes `mir` (`-Zunpretty=mir` appended, compared with the oracle) and
// `mono` apply. Those runs use the recorded cwd.
//
// Every run has its own empty cwd under the output directory, removed afterwards: `tests/mir-opt/dump_dataflow.rs` carries
// `-Zdump-mir` and the oracle writes into the cwd. Never run this from the upstream checkout.
//
// Output: `$RUST_TS_DATA/tmp/mir-alias/<name>/runs.jsonl` (one line per run) and `summary.txt` (outcomes, then each distinct
// hit: kind, type, the two paths with indices removed, the first pass it was seen at, how many runs, one example).
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DATA, REPO } from "../../../scripts/lib/common.ts";
import { caseEnv, mergeEnv } from "../../../scripts/lib/env.ts";
import { oracleRustcCmd, oracleSysroot } from "../../../scripts/lib/oracle.ts";
import type { AliasHit } from "./hooks.ts";

const DRIVER = join(REPO, "src/rustc_mir_transform/alias_check_oracle/driver.ts");
const MAIN = join(REPO, "src/rust_ts/main.ts");
const TARGET = "x86_64-unknown-linux-gnu";

function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const TESTS = arg("tests");
const ARGV_FILE = arg("argv-file");
if (TESTS === undefined && ARGV_FILE === undefined) {
  console.log("usage: bun sweep.ts --tests <dir> [--passing] [--sample N] [--modes o0,o2,o3,o4,dbg,abort,inl,miropt,all,mono,dump] [--jobs 4] [--timeout ms] [--name n]");
  process.exit(0);
}
const MODES = arg("modes", "o0,o2,o3,o4")!.split(",");
const JOBS = Number(arg("jobs", "4"));
const TIMEOUT = Number(arg("timeout", "120000"));
const AGENT = process.env.RUST_TS_AGENT ?? "default";
const NAME = arg("name", `${AGENT}-${Date.now()}`)!;
const OUT = join(DATA, "tmp", "mir-alias", NAME);
mkdirSync(OUT, { recursive: true });

interface Program {
  file: string;
  edition: string;
  flags: string[];
  mir_pass: string | undefined;
  /** A recorded rustc invocation (`--argv-file`). */
  recorded?: { cwd: string; args: string[]; env: Record<string, string> };
}

function list_rs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== "auxiliary") list_rs(p, out);
    } else if (e.endsWith(".rs")) out.push(p);
  }
  return out;
}

function parse_program(file: string): Program | undefined {
  const src = readFileSync(file, "utf8");
  if (/^\/\/@\s*(aux-build|aux-crate|proc-macro|aux-bin|revisions)/m.test(src)) return undefined;
  if (has("passing") && !/^\/\/@\s*(run-pass|build-pass|check-pass)/m.test(src)) return undefined;
  const flags: string[] = [];
  for (const m of src.matchAll(/^\/\/@\s*compile-flags:(.*)$/gm)) flags.push(...m[1]!.trim().split(/\s+/).filter((x) => x !== ""));
  const edition = /^\/\/@\s*edition:\s*(\S+)$/m.exec(src)?.[1] ?? "2021";
  const mir_pass = /^\/\/@\s*test-mir-pass:\s*(\S+)$/m.exec(src)?.[1];
  return { file, edition, flags, mir_pass };
}

const all_optional_passes = async (): Promise<string> => {
  const { PASS_NAMES } = await import("../lib.ts");
  // `InstrumentCoverage` needs `-Cinstrument-coverage`: without it the oracle ICEs as well ("hash should be present").
  return [...PASS_NAMES()]
    .filter((p) => p !== "InstrumentCoverage")
    .map((p) => `+${p}`)
    .join(",");
};
const ALL = MODES.includes("all") ? await all_optional_passes() : "";
const all_dump_filter = async (): Promise<string> => {
  const { PASS_NAMES } = await import("../lib.ts");
  return [...PASS_NAMES(), "built", "analysis", "runtime"].join("|");
};
const DUMP_FILTER = MODES.includes("dump") ? await all_dump_filter() : "";

/** The flags after the program's own, or (`miropt`, as compiletest's `TestMode::MirOpt`) before them. */
function mode_args(mode: string, p: Program): { before: string[]; after: string[] } {
  if (p.recorded !== undefined) return { before: [], after: [] };
  switch (mode) {
    case "mir":
      return { before: [], after: [] };
    case "o0":
      return { before: [], after: ["-Copt-level=0"] };
    case "o2":
      return { before: [], after: ["-Copt-level=2"] };
    case "o3":
      return { before: [], after: ["-Copt-level=3"] };
    case "o4":
      return { before: [], after: ["-Zmir-opt-level=4"] };
    // Paths the plain levels do not take: debuginfo (SROA fragments, `SingleUseConsts`, `ReferencePropagation`'s remap),
    // `-Cpanic=abort` (`AbortUnwindingCalls`, `RemoveNoopLandingPads`), and inlining far past the default thresholds.
    case "dbg":
      return { before: [], after: ["-Copt-level=3", "-Zmir-opt-level=4", "-Cdebuginfo=2"] };
    case "abort":
      return { before: [], after: ["-Copt-level=2", "-Cpanic=abort"] };
    case "inl":
      return { before: [], after: ["-Copt-level=3", "-Zinline-mir-threshold=2000", "-Zinline-mir-hint-threshold=4000"] };
    case "all":
      return { before: [], after: ["-Copt-level=3", "-Zmir-opt-level=4", `-Zmir-enable-passes=${ALL}`] };
    case "mono":
      return { before: [], after: ["-Copt-level=3"] };
    case "dump":
      return { before: [], after: ["-Copt-level=3", "-Zverbose-internals", `-Zdump-mir=${DUMP_FILTER}`] };
    case "miropt":
      return {
        before: [
          "-Copt-level=1",
          "-Zvalidate-mir",
          "-Zlint-mir",
          "-Zmir-include-spans=false",
          "--crate-type=rlib",
          ...(p.mir_pass !== undefined ? ["-Zmir-opt-level=0", `-Zmir-enable-passes=+${p.mir_pass}`] : ["-Zmir-opt-level=4", "-Zmir-enable-passes=+ReorderBasicBlocks,+ReorderLocals"]),
        ],
        after: [],
      };
    default:
      throw new Error(`ERROR: unknown mode ${mode}`);
  }
}

const SYSROOT = oracleSysroot();
function env(extra: Record<string, string>): Record<string, string> {
  return mergeEnv(process.env, { ...caseEnv({ RUSTC_ICE: "0", RUST_BACKTRACE: "0" }), ...extra });
}

async function spawn(cmd: string[], cwd: string, e: Record<string, string>): Promise<{ out: string; err: string; code: number; timeout: boolean }> {
  const proc = Bun.spawn(cmd, { cwd, env: e, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  let timeout = false;
  const t = setTimeout(() => {
    timeout = true;
    proc.kill(9);
  }, TIMEOUT);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  clearTimeout(t);
  return { out, err, code, timeout };
}

interface RunResult {
  file: string;
  mode: string;
  outcome: "MATCH" | "DIFF" | "UNPORTED" | "ICE" | "BOTH_ICE" | "TIMEOUT" | "CHECKED";
  oracle: number | undefined;
  port: number;
  checked: boolean;
  walks: number;
  first_diff?: string;
  hits: AliasHit[];
}

function first_difference(a: string, b: string): string {
  const x = a.split("\n");
  const y = b.split("\n");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return `line ${i + 1}: < ${(x[i] ?? "").slice(0, 160)} > ${(y[i] ?? "").slice(0, 160)}`;
  }
  return "";
}

/** The first dump file that differs or that one side lacks, in file order. */
function dump_difference(o: string, p: string): string | undefined {
  const ls = (d: string): string[] => (existsSync(d) ? readdirSync(d).sort() : []);
  const left = ls(o);
  const right = ls(p);
  for (const f of [...new Set([...left, ...right])].sort()) {
    if (!left.includes(f) || !right.includes(f)) return `${f}: only on the ${left.includes(f) ? "oracle" : "port"} side`;
    const a = readFileSync(join(o, f), "utf8");
    const b = readFileSync(join(p, f), "utf8");
    if (a !== b) return `${f}: ${first_difference(a, b)}`;
  }
  return undefined;
}

let serial = 0;
async function run_one(p: Program, mode: string): Promise<RunResult> {
  const n = serial++;
  const cwd = join(OUT, "cwd", String(n));
  mkdirSync(cwd, { recursive: true });
  const hits_file = join(OUT, "cwd", `${n}.hits`);
  const { before, after } = mode_args(mode, p);
  // A recorded invocation names no sysroot (rustc finds its own, and the port has no install to look next to).
  // Its `--out-dir` is this run's: a run past analysis writes an rmeta, and the next crate must keep reading the oracle's.
  const recorded_args = (a: string[]): string[] => a.map((x, i) => (a[i - 1] === "--out-dir" ? cwd : x));
  const args = p.recorded !== undefined ? [...recorded_args(p.recorded.args), "--sysroot", SYSROOT] : [p.file, "--target", TARGET, "--sysroot", SYSROOT, `--edition=${p.edition}`, "-Zwrite-long-types-to-disk=no", "-Awarnings", ...before, ...p.flags, ...after];
  const mir_args = [...args, "-Zunpretty=mir"];
  const mono = mode === "mono";
  const port_env = env({ ...p.recorded?.env, RUST_TS_ALIAS_OUT: hits_file, ...(mono ? { RUST_TS_ALIAS_MONO: "1" } : {}) });
  const run_cwd = p.recorded?.cwd ?? cwd;
  const dump = mode === "dump";
  const dump_arg = (side: string): string[] => (dump ? [`-Zdump-mir-dir=${join(cwd, side)}`] : []);
  const oracle = mono ? undefined : await spawn(oracleRustcCmd([...mir_args, ...dump_arg("o")]), run_cwd, env({ ...p.recorded?.env }));
  const port = await spawn(dump ? [process.execPath, MAIN, ...mir_args, ...dump_arg("p")] : [process.execPath, DRIVER, ...(mono ? args : mir_args)], run_cwd, port_env);
  const hits: AliasHit[] = [];
  let checked = false;
  let walks = 0;
  if (existsSync(hits_file)) {
    for (const l of readFileSync(hits_file, "utf8").split("\n")) {
      if (l === "") continue;
      const o = JSON.parse(l) as AliasHit | { kind: "CHECKED"; walks: number };
      if (o.kind === "CHECKED") {
        checked = true;
        walks = o.walks;
      } else hits.push(o);
    }
  }
  let outcome: RunResult["outcome"];
  let first_diff: string | undefined;
  if (port.timeout) outcome = "TIMEOUT";
  else if (port.code === 70) outcome = "UNPORTED";
  else if (mono) outcome = port.code === 101 ? "ICE" : "CHECKED";
  else if (dump && oracle!.code === port.code && dump_difference(join(cwd, "o"), join(cwd, "p")) !== undefined) {
    outcome = "DIFF";
    first_diff = dump_difference(join(cwd, "o"), join(cwd, "p"));
  } else if (oracle!.out === port.out && oracle!.err === port.err && oracle!.code === port.code) outcome = "MATCH";
  else if (port.code === 101 && oracle!.code !== 101) outcome = "ICE";
  // Invalid custom MIR at this mode, on both sides. The wording differs (`rust-ts: internal compiler error`), and the ICE's
  // text is not compared here: the suites do that.
  else if (port.code === 101 && oracle!.code === 101) outcome = "BOTH_ICE";
  else outcome = "DIFF";
  if ((outcome === "DIFF" || outcome === "ICE") && first_diff === undefined) {
    first_diff = oracle === undefined ? port.err.slice(0, 300) : first_difference(oracle.out, port.out) || first_difference(oracle.err, port.err);
  } else if (outcome === "UNPORTED") {
    first_diff = port.err.slice(-200);
  }
  rmSync(cwd, { recursive: true, force: true });
  rmSync(hits_file, { force: true });
  return { file: p.file, mode, outcome, oracle: oracle?.code, port: port.code, checked, walks, first_diff, hits };
}

const hash = (s: string): string => createHash("sha256").update(`${AGENT}|${s}`).digest("hex");
let programs: Program[] =
  ARGV_FILE !== undefined
    ? readFileSync(ARGV_FILE, "utf8")
        .split("\n")
        .filter((l) => l !== "")
        .map((l, i): Program => {
          const recorded = JSON.parse(l) as NonNullable<Program["recorded"]>;
          // The jobserver cargo handed to that build is gone (the port stops `unported` on an inherited one).
          delete recorded.env.CARGO_MAKEFLAGS;
          return { file: `${recorded.env.CARGO_PKG_NAME}/${recorded.env.CARGO_CRATE_NAME}#${i}`, edition: "", flags: [], mir_pass: undefined, recorded };
        })
    : list_rs(TESTS!)
        .map(parse_program)
        .filter((p): p is Program => p !== undefined);
const SAMPLE = arg("sample");
if (SAMPLE !== undefined) {
  programs = programs
    .map((p): [string, Program] => [hash(p.file), p])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(0, Number(SAMPLE))
    .map(([, p]) => p)
    .sort((a, b) => (a.file < b.file ? -1 : 1));
}

const queue: [Program, string][] = [];
for (const p of programs) for (const m of MODES) queue.push([p, m]);
const RUNS = join(OUT, "runs.jsonl");
writeFileSync(RUNS, "");
const outcomes = new Map<string, number>();
const distinct = new Map<string, { count: number; example: string; where: string }>();
let done = 0;
let oracle_ok = 0;
let walks = 0;

function write_summary(): void {
  const lines: string[] = [`runs ${done}/${queue.length} programs ${programs.length} modes ${MODES.join(",")} oracle-exit-0 ${oracle_ok} walks ${walks}`];
  for (const [k, v] of [...outcomes].sort()) lines.push(`${k} ${v}`);
  lines.push(`distinct hits ${distinct.size}`);
  for (const [k, v] of [...distinct].sort((a, b) => b[1].count - a[1].count)) lines.push(`${v.count}\t${v.where}\t${k}\t${v.example}`);
  writeFileSync(join(OUT, "summary.txt"), `${lines.join("\n")}\n`);
}

async function worker(): Promise<void> {
  for (;;) {
    const item = queue[done + active];
    if (item === undefined) return;
    active += 1;
    const r = await run_one(item[0], item[1]).catch((e): RunResult => ({ file: item[0].file, mode: item[1], outcome: "ICE", oracle: undefined, port: -1, checked: false, walks: 0, first_diff: `sweep: ${String(e)}`, hits: [] }));
    active -= 1;
    done += 1;
    appendFileSync(RUNS, `${JSON.stringify(r)}\n`);
    outcomes.set(r.outcome, (outcomes.get(r.outcome) ?? 0) + 1);
    if (r.oracle === 0) oracle_ok += 1;
    walks += r.walks;
    for (const h of r.hits) {
      const key = `${h.kind}\t${h.what}\t${h.first.replace(/\[\d+\]/g, "[]")}\t${h.second.replace(/\[\d+\]/g, "[]")}`;
      const d = distinct.get(key);
      if (d === undefined) distinct.set(key, { count: 1, example: `${r.file} ${r.mode} ${h.def}`, where: h.where });
      else d.count += 1;
    }
    if (done % 50 === 0) write_summary();
  }
}
let active = 0;
await Promise.all(Array.from({ length: JOBS }, () => worker()));
write_summary();
rmSync(join(OUT, "cwd"), { recursive: true, force: true });
console.log(readFileSync(join(OUT, "summary.txt"), "utf8").split("\n").slice(0, 8).join("\n"));
console.log(`summary: ${join(OUT, "summary.txt")}`);
