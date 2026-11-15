// What a built `rg` does (plan-m7 §6 `rg-behaviour`, D19; lane harness-m7d): both sides of the `rg-behaviour` suite (scripted queries on a
// fixed corpus) and of `rg-behaviour-rgtest` (ripgrep's own integration tests, as a report).
//
//   bun scripts/rg-behaviour.ts query  --side oracle|subject --dir <case dir> --query <JSON {args, stdin?}> -- <compiler argv...>
//   bun scripts/rg-behaviour.ts rgtest --side oracle|subject --dir <case dir> -- <compiler argv...>
//
// - **The `rg` is rg-build's** (scripts/rg-build.ts `ensureRg`): the side's compiler builds ripgrep 15.2.0 with the stock release profile,
//   once per key, and every case runs that binary. A kept key's stamp is read without a lock. If no build of the current key is kept
//   (difftest may have rg-build's oracle output in its cache, so rg-build's oracle side never ran), the first case builds it, under
//   rg-build's lock. A side whose build made no `rg`: the port's `unported` stop is UNPORTED (exit 70, its line on stderr), any other
//   port failure exits 1. The oracle's, an interrupted build, or a corpus with ignore files above it prints lib/rg-build.ts
//   `NO_RESULT_MARK` on stderr and exits 1 (128 + the signal if interrupted, 2 for the corpus): difftest never caches an oracle output
//   with that mark, so no error stands for the oracle's answer (review harness-m7d F2). Only a malformed command line exits 2 otherwise.
// - **No lock wait prints anything** (review harness-m7d F1): every lock here is taken with a silent note, as scripts/native-run.ts does,
//   since this process's stderr is compared and an oracle's is cached.
// - **query** (one case per scripted query, harness/corpus/rg-behaviour/queries.json): the corpus (harness/corpus/rg-behaviour/corpus.json)
//   is written to `<case dir>/corpus` afresh, with an empty `.git` directory at its root so it is a repository's root for rg's ignore
//   rules, as a checkout is. rg also reads `.ignore` and `.rgignore` in every directory above it, whatever the repository: a query stops
//   with `NO_RESULT_MARK` if one exists (lib/rg-build.ts `ancestorIgnoreFiles`; review harness-m7d N4). `rg <args>` runs there with stdin the query's text (else none), environment `PATH=/usr/bin:/bin` and
//   `HOME=<case dir>/home` and nothing else (no `RIPGREP_CONFIG_PATH`, no global git excludes), and a limit of 30 s. Its stdout and stderr
//   are printed as they are but for the times `--json` and `--stats` print (lib/rg-build.ts `maskRgTimes`), and its exit code is this
//   process's (124 for a time-out, 128 + n for a signal).
// - **rgtest**: ripgrep's `tests/` (target `integration`: its 333 `rgtest!` tests and the rest), built once **by the oracle** into a test
//   binary (`ensureRgtestBinary`, under its own lock, kept per key as rg-build keeps `rg`, and not removed while recent): it is the test
//   harness, not what is tested. Each side copies it to
//   `<case dir>/run/deps/integration` with the side's `rg` at `<case dir>/run/rg`, where the tests look for it (`../rg` from their own
//   directory), and runs it with `HOME=<case dir>/home`, a fixed `PATH`, four test threads and a limit of 10 minutes, one side at a time
//   under the lock `<case dir>.case.lock`. `TMPDIR`, where each test makes its directory, is `rust-ts-rgtest-<hash of the case dir>` in
//   this process's temp directory, **outside any git repository** (`rgtestTmp` checks): $RUST_TS_DATA may be inside this one, and with a
//   `.git` above them two of ripgrep's tests fail on any rg (`f1414_no_require_git`, `f45_precedence_internal`: seen on the oracle). Output for difftest's
//   splitter `rmetadump`: a header, the test binary's exit code, then `== <test>` with `ok`, `FAILED` or `ignored` for each test, sorted.
//   The whole libtest output is kept in `<case dir>/<side>-libtest.txt`. Exit 0 unless there is no `rg` (above).
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, parse } from "node:path";
import { REPO, die, hash } from "./lib/common.ts";
import { withCaseLock } from "./lib/case-lock.ts";
import { oracleSysroot, rustcDriverHash } from "./lib/oracle.ts";
import { RG_ROOT, RG_SRC, RG_VERSION, rgIsSetUp } from "./rg-check.ts";
import { rgCargoEnv } from "./lib/rg-check.ts";
import { RG_BUILD_SOURCES, ensureRg, hostToolsId, parseSideArgs, pruneKeys } from "./rg-build.ts";
import { NO_RESULT_MARK, ancestorIgnoreFiles, corpusBytes, maskRgTimes, rgtestSections, type CorpusFile, type RgQuery } from "./lib/rg-build.ts";

export const RG_BEHAVIOUR = join(REPO, "scripts", "rg-behaviour.ts");
export const RG_CORPUS = join(REPO, "harness", "corpus", "rg-behaviour", "corpus.json");
export const RG_QUERIES = join(REPO, "harness", "corpus", "rg-behaviour", "queries.json");
const QUERY_TIMEOUT_MS = 30_000;
const RGTEST_TIMEOUT_MS = 600_000;
const LOCK_MAX_HOLD_MS = 2 * 3_600_000;
const RGTEST_BIN = join(RG_ROOT, "rgtest-bin");

/** The corpus: path to contents. */
export const rgCorpus = (): Record<string, CorpusFile> => (JSON.parse(readFileSync(RG_CORPUS, "utf8")) as { files: Record<string, CorpusFile> }).files;
/** The scripted queries. */
export const rgQueries = (): RgQuery[] => (JSON.parse(readFileSync(RG_QUERIES, "utf8")) as { queries: RgQuery[] }).queries;

/** Writes the corpus to `dir` (emptied first), with an empty `.git` directory at its root. */
export function writeCorpus(dir: string, files: Record<string, CorpusFile> = rgCorpus()): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  for (const [rel, f] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), corpusBytes(f));
  }
}

const SIGNALS: Record<string, number> = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

/** Ends this process with `NO_RESULT_MARK` on stderr (see the header). */
function noResult(why: string, code: number): never {
  process.stderr.write(`${NO_RESULT_MARK}${why}\n`);
  process.exit(code);
}

/** The side's `rg`, or how this process ends because there is none (see the header). */
async function sideRg(side: "oracle" | "subject", compiler: string[]): Promise<string> {
  const r = await ensureRg(side, compiler);
  if ("rg" in r) return r.rg;
  if ("interrupted" in r) noResult(`the build of rg was interrupted (${r.interrupted})`, 128 + (SIGNALS[r.interrupted] ?? 0));
  if (side === "oracle" || !r.stamped) noResult(`the ${side === "oracle" ? "oracle's" : "port's"} build of rg made no binary: ${r.failed}`, 1);
  if (r.failed.startsWith("rust-ts: unported:")) {
    process.stderr.write(`${r.failed}\n`);
    process.exit(70);
  }
  process.stderr.write(`rg-behaviour: the port's build of rg made no binary: ${r.failed}\n`);
  process.exit(1);
}

const writeOut = (fd: number, b: Uint8Array) => {
  for (let at = 0; at < b.length; ) at += writeSync(fd, b, at);
};

async function query(side: "oracle" | "subject", dir: string, q: Pick<RgQuery, "args" | "stdin">, compiler: string[]): Promise<number> {
  const rg = await sideRg(side, compiler);
  const corpus = join(dir, "corpus");
  const home = join(dir, "home");
  const above = ancestorIgnoreFiles(corpus);
  if (above.length) noResult(`rg would read ignore files above the corpus: ${above.join(", ")}`, 2);
  writeCorpus(corpus);
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  const r = Bun.spawnSync([rg, ...q.args], {
    cwd: corpus,
    env: { PATH: "/usr/bin:/bin", HOME: home },
    stdin: q.stdin === undefined || q.stdin === null ? "ignore" : Buffer.from(q.stdin, "utf8"),
    stdout: "pipe",
    stderr: "pipe",
    timeout: QUERY_TIMEOUT_MS,
  });
  writeOut(1, Buffer.from(maskRgTimes(r.stdout.toString("latin1")), "latin1"));
  writeOut(2, Buffer.from(maskRgTimes(r.stderr.toString("latin1")), "latin1"));
  if (r.exitedDueToTimeout) {
    writeOut(2, Buffer.from(`rg-behaviour: rg timed out after ${QUERY_TIMEOUT_MS} ms\n`));
    return 124;
  }
  if (r.exitCode === null) return 128 + (typeof r.signalCode === "string" ? (({ SIGKILL: 9, SIGSEGV: 11, SIGABRT: 6, SIGBUS: 10, SIGILL: 4, SIGTRAP: 5, SIGFPE: 8 }) as Record<string, number>)[r.signalCode] ?? 0 : 0);
  return r.exitCode;
}

/** The key of the oracle-built integration test binary: what builds it. */
const rgtestKey = (): string => hash([...RG_BUILD_SOURCES, RG_BEHAVIOUR].map((f) => hash(readFileSync(f))).concat(hash(readFileSync(join(RG_ROOT, RG_SRC, "Cargo.lock"))), hostToolsId(), rustcDriverHash()).join("\0")).slice(0, 16);

/** The oracle-built `integration` test binary of ripgrep (see the header), built once per key. */
async function ensureRgtestBinary(): Promise<string> {
  if (!rgIsSetUp()) die(`ripgrep is not set up in ${RG_ROOT}; run: bun scripts/rg-check.ts setup`);
  const key = rgtestKey();
  const bin = join(RGTEST_BIN, key, "integration");
  // The key directory appears whole (renamed into place), so a kept one needs no lock.
  if (existsSync(bin)) return bin;
  return withCaseLock(join(RG_ROOT, "rgtest-bin.lock"), LOCK_MAX_HOLD_MS, async () => {
    if (existsSync(bin)) return bin;
    const sysroot = oracleSysroot();
    const tree = join(RG_ROOT, "target", "rgtest-bin");
    rmSync(tree, { recursive: true, force: true });
    const env: Record<string, string> = {
      ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !e[0].startsWith("CARGO_") && !["RUSTFLAGS", "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER", "GIT_DIR", "GIT_WORK_TREE"].includes(e[0]))),
      ...rgCargoEnv(RG_ROOT, join(RG_ROOT, "cargo")),
      RUSTC: join(sysroot, "bin", "rustc"),
      CARGO_TERM_COLOR: "never",
    };
    const p = Bun.spawnSync([join(sysroot, "bin", "cargo"), "test", "--release", "--no-run", "--locked", "--offline", "--test", "integration", "-j4", "--message-format=json-render-diagnostics", "--target-dir", tree], { cwd: join(RG_ROOT, RG_SRC), env, stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) noResult(`the oracle's build of ripgrep's integration tests failed: ${p.stderr.toString().trim().split("\n").at(-1)}`, 1);
    const exe = p.stdout
      .toString()
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l) as { reason?: string; target?: { name?: string; kind?: string[] }; executable?: string | null })
      .find((m) => m.reason === "compiler-artifact" && m.target?.name === "integration" && m.executable)?.executable;
    if (!exe) noResult("cargo named no executable for ripgrep's integration tests", 1);
    const tmp = join(RGTEST_BIN, `${key}.tmp-${process.pid}`);
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    cpSync(exe!, join(tmp, "integration"));
    renameSync(tmp, join(RGTEST_BIN, key));
    rmSync(tree, { recursive: true, force: true });
    // Other keys stay while recent: another worktree's run may be copying one (review harness-m7d N2).
    pruneKeys(RGTEST_BIN, key);
    return bin;
  }, () => {});
}

/** The tests' `TMPDIR` for case directory `dir` (see the header); dies if a `.git` is in it or above it. */
export function rgtestTmp(dir: string, base: string = tmpdir()): string {
  const tmp = join(base, `rust-ts-rgtest-${hash(dir).slice(0, 12)}`);
  for (let d = tmp; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) die(`rg-behaviour: the tests' TMPDIR ${tmp} is inside a git repository (${d}): ripgrep's tests need it outside one`);
    if (d === parse(d).root) break;
  }
  return tmp;
}

async function rgtest(side: "oracle" | "subject", dir: string, compiler: string[]): Promise<number> {
  const rg = await sideRg(side, compiler);
  const testBin = await ensureRgtestBinary();
  // No note on waiting: what this prints is compared (review harness-m7d F1).
  const lines = await withCaseLock(`${dir}.case.lock`, LOCK_MAX_HOLD_MS, async () => {
    const run = join(dir, "run");
    const tmp = rgtestTmp(dir);
    const home = join(dir, "home");
    for (const d of [run, tmp, home]) rmSync(d, { recursive: true, force: true });
    for (const d of [join(run, "deps"), tmp, home]) mkdirSync(d, { recursive: true });
    cpSync(testBin, join(run, "deps", "integration"));
    cpSync(rg, join(run, "rg"));
    const r = Bun.spawnSync([join(run, "deps", "integration"), "--test-threads=4"], {
      cwd: run,
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, TMPDIR: tmp, RUST_BACKTRACE: "0" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: RGTEST_TIMEOUT_MS,
    });
    const out = r.stdout.toString();
    writeFileSync(join(dir, `${side}-libtest.txt`), `${out}\n=== stderr ===\n${r.stderr.toString()}`);
    const end = r.exitedDueToTimeout ? `timed out after ${RGTEST_TIMEOUT_MS} ms` : r.exitCode === null ? `signal ${r.signalCode}` : `exit ${r.exitCode}`;
    return [`rg-behaviour-rgtest: ripgrep ${RG_VERSION}'s integration tests, an oracle-built test binary running the side's rg`, `test binary ${end}`, ...rgtestSections(out)];
   }, () => {});
  writeOut(1, Buffer.from(lines.join("\n") + "\n"));
  return 0;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  try {
    if (cmd !== "query" && cmd !== "rgtest") throw new Error("the command must be query or rgtest");
    const a = parseSideArgs(argv.slice(1));
    const opt = (k: string): string => {
      const i = a.rest.indexOf(k);
      if (i < 0 || a.rest[i + 1] === undefined) throw new Error(`${k} is missing`);
      return a.rest[i + 1]!;
    };
    const dir = opt("--dir");
    if (cmd === "query") {
      const q = JSON.parse(opt("--query")) as RgQuery;
      if (!Array.isArray(q.args)) throw new Error("--query has no args");
      process.exit(await query(a.side, dir, q, a.compiler));
    }
    process.exit(await rgtest(a.side, dir, a.compiler));
  } catch (e) {
    console.error(`ERROR: rg-behaviour: ${e instanceof Error ? e.message : String(e)}`);
    console.error("usage: bun scripts/rg-behaviour.ts query|rgtest --side oracle|subject --dir <case dir> [--query <JSON>] -- <compiler argv...>");
    process.exit(2);
  }
}
