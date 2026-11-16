// What a built `cargo` does (plan-m8 §4b, §6 `cargo-smoke`, D8, D19, D23; lane harness-m8a-build): both sides of the `cargo-smoke` suite.
//
//   bun scripts/cargo-smoke.ts --step <id> --side oracle|subject --dir <case dir> -- <compiler argv...>
//
// - **The two cargos are built from the same source and environment** (D8): the oracle side runs the `cargo` the **oracle's** rustc built
//   from cargo's pinned source (scripts/cargo-project-build.ts, project `cargo`, the build `cargo-build`'s oracle side makes), the subject
//   side the one the **port** built (`cargo-build`'s subject side). Not the oracle toolchain's `cargo` component: its version line carries
//   bootstrap's `git-commit-info` suffix, which a build from the tarball never has (§4b). `<compiler argv>` is the compiler that built the
//   side's cargo; it names the kept binary's key.
//   - The oracle side builds its cargo if no build of the current key is kept (difftest may have `cargo-build`'s oracle output cached),
//     under the project's lock and D20's preconditions and watchdog. A refused, stopped or interrupted build, or one that made no binary,
//     prints lib/cargo-project-build.ts `CARGO_NO_RESULT_MARK` and exits 1 (128 + the signal's number if interrupted): never cached.
//   - **The subject side never builds the port's cargo** (40-50 min at `-j1`, D20's heavy class): it runs `cargo-build`'s kept binary of
//     the current key, or exits 1 saying none is kept (the gate runs `cargo-build` first). The port's `unported` stop recorded in that
//     key's stamp is UNPORTED (exit 70, its line on stderr).
// - **Every step runs on the oracle's rustc** (`RUSTC`, both sides), so only cargo differs. Each case is one step of §4b's smoke test
//   (`SMOKE_STEPS`), run in a fresh case directory: the steps on a project first make it with the side's own `cargo new --bin hello`
//   (`hello-tests` then gives it one passing and one failing test), and any `pre` steps; their output is not compared unless one fails.
//   ripgrep's steps run on rg-check's pinned ripgrep 15.2.0 (`$RUST_TS_DATA/ripgrep`, its CARGO_HOME, offline) with the target directory
//   in the case directory, holding rg-build's lock so no other cargo is in that CARGO_HOME (its "Blocking waiting for file lock" line).
// - No `.cargo/config.toml` or `.cargo/config` may be above the directory cargo runs in, nor a config in its CARGO_HOME (lib
//   `cargoConfigsAbove`; review harness-m8a-build N5): a step stops with the mark if one is.
// - The case directory is outside any git repository (`smokeDir`: this process's temp directory; it refuses one with a `.git` above it),
//   so `cargo new` makes its own repository through libgit2 as it would for a user. The environment is fixed: the built `PATH` of
//   cargo-build (D15: no `pkg-config`, no Homebrew `curl-config`), `HOME`, `CARGO_HOME` and `TMPDIR` in the case directory,
//   `CARGO_INCREMENTAL=0`, no colour, no progress bar, `RUST_BACKTRACE=0`, `GIT_CEILING_DIRECTORIES`. Each cargo runs in a process group of
//   its own (scripts/cargo-project-build.ts `runInGroup`) with a limit of 10 minutes, stopped on SIGTERM, SIGINT or SIGHUP.
//
// Output (stdout): a header, the step's cargo argv, `exit <n>`, cargo's stdout and stderr with the case directory, ripgrep's root and the
// oracle sysroot named, the `Finished` time masked, the `Compiling`/`Checking` lines sorted (their order varies at `-j4`) and the thread id
// and libtest time masked (lib/unstable.ts `maskProgramOutput`), then the files the step lists: names only for a target directory
// (plan-m7 D2: objects and binaries are not compared by bytes), names and bytes for what `cargo new` made. Exit code: the step's cargo's.
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, parse } from "node:path";
import { REPO, die, hash } from "./lib/common.ts";
import { withCaseLock } from "./lib/case-lock.ts";
import { oracleSysroot } from "./lib/oracle.ts";
import { RG_ROOT, RG_SRC } from "./rg-check.ts";
import { BUILT_PATH_DIRS, PROJECTS, ensureBinary, parseSideArgs, projectLock, runInGroup, type GroupRun } from "./cargo-project-build.ts";
import { CARGO_NO_RESULT_MARK, cargoConfigsAbove, signalNumber, sizeHash, walkFiles } from "./lib/cargo-project-build.ts";
import { normaliseSmokeStream } from "./lib/cargo-smoke.ts";

export const CARGO_SMOKE = join(REPO, "scripts", "cargo-smoke.ts");
const STEP_TIMEOUT_MS = 600_000;
const RG_LOCK_MAX_HOLD_MS = 8 * 3_600_000;

/** One step of §4b's smoke test: what it runs on, what it needs first, the cargo argv compared, and what files it lists. */
export interface SmokeStep {
  id: string;
  /** `none`: the case directory itself; `hello`: a `cargo new --bin hello`; `hello-tests`: that with two tests; `ripgrep`: rg-check's ripgrep. */
  project: "none" | "hello" | "hello-tests" | "ripgrep";
  /** cargo argvs run first in the project, not compared unless one fails. */
  pre: string[][];
  cargo: string[];
  /** Files to list after the step, relative to the project, and whether their bytes are compared. */
  list?: { dir: string; bytes: boolean };
}

/** §4b's 11 steps, plus `cargo -vV`, which names the libgit2, libcurl and OpenSSL the binary carries (D15's `all-static`). */
export const SMOKE_STEPS: readonly SmokeStep[] = [
  { id: "version", project: "none", pre: [], cargo: ["--version"] },
  { id: "version-verbose", project: "none", pre: [], cargo: ["-vV"] },
  { id: "new", project: "none", pre: [], cargo: ["new", "--bin", "hello"], list: { dir: "hello", bytes: true } },
  { id: "build", project: "hello", pre: [], cargo: ["build"], list: { dir: "target/debug", bytes: false } },
  { id: "run", project: "hello", pre: [], cargo: ["run"] },
  { id: "test", project: "hello-tests", pre: [], cargo: ["test", "--", "--test-threads=1"] },
  { id: "build-release", project: "hello", pre: [], cargo: ["build", "--release"], list: { dir: "target/release", bytes: false } },
  { id: "metadata", project: "hello", pre: [], cargo: ["metadata", "--format-version", "1"] },
  { id: "tree", project: "hello", pre: [], cargo: ["tree"] },
  { id: "clean", project: "hello", pre: [["build"]], cargo: ["clean"], list: { dir: "target", bytes: false } },
  { id: "rg-check", project: "ripgrep", pre: [], cargo: ["check", "--locked", "--offline", "-j4", "--target-dir", "<case>/rg-target"] },
  { id: "rg-tree", project: "ripgrep", pre: [], cargo: ["tree", "--locked", "--offline"] },
];

/** `hello-tests`' `src/main.rs`: one passing and one failing test (cargo test exits 101). */
export const HELLO_TESTS_MAIN = `fn main() {
    println!("Hello, world!");
}

#[cfg(test)]
mod tests {
    #[test]
    fn passes() {
        assert_eq!(2 + 2, 4);
    }

    #[test]
    fn fails() {
        assert_eq!(2 + 2, 5, "the failing test");
    }
}
`;

/** A step's case directory: in this process's temp directory, outside any git repository (see the header). */
export function smokeDir(id: string, base: string = tmpdir()): string {
  return join(base, "rust-ts-cargo-smoke", hash(id).slice(0, 16));
}

/** Dies if `dir` has a `.git` in it or above it: `cargo new` would then make no repository of its own. */
function refuseGitAbove(dir: string): void {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) die(`cargo-smoke: the case directory ${dir} is inside a git repository (${d}): cargo new would not make its own`);
    if (d === parse(d).root) break;
  }
}

const writeOut = (fd: number, b: Uint8Array) => {
  for (let at = 0; at < b.length; ) at += writeSync(fd, b, at);
};

function noResult(why: string, code: number): never {
  process.stderr.write(`${CARGO_NO_RESULT_MARK}${why}\n`);
  process.exit(code);
}

/** The side's cargo, or how this process ends because there is none (see the header). */
async function sideCargo(side: "oracle" | "subject", compiler: string[]): Promise<string> {
  const r = await ensureBinary(PROJECTS.cargo, side, compiler, { build: side === "oracle" });
  if ("bin" in r) return r.bin;
  if ("interrupted" in r) noResult(`the build of cargo was interrupted (${r.interrupted})`, 128 + signalNumber(r.signal));
  if ("refused" in r) noResult(`the build of cargo was not started: ${r.refused}`, 1);
  if ("stopped" in r) noResult(`the build of cargo was stopped: ${r.stopped}`, 1);
  if (side === "oracle") noResult(`the oracle's build of cargo made no binary: ${r.failed}`, 1);
  if (r.failed.startsWith("rust-ts: unported:")) {
    process.stderr.write(`${r.failed}\n`);
    process.exit(70);
  }
  process.stderr.write(`cargo-smoke: no port-built cargo: ${r.failed}\n`);
  process.exit(1);
}

/** Runs one step in `dir` with the side's cargo `cargo` (see the header); returns the report and cargo's exit. */
export async function runStep(step: SmokeStep, cargo: string, dir: string): Promise<{ lines: string[]; code: number }> {
  refuseGitAbove(dir);
  rmSync(dir, { recursive: true, force: true });
  for (const d of ["home", "cargo-home", "tmp", "work"]) mkdirSync(join(dir, d), { recursive: true });
  const sysroot = oracleSysroot();
  const rg = step.project === "ripgrep";
  const env: Record<string, string> = {
    PATH: BUILT_PATH_DIRS.join(":"),
    HOME: join(dir, "home"),
    CARGO_HOME: rg ? join(RG_ROOT, "cargo") : join(dir, "cargo-home"),
    TMPDIR: join(dir, "tmp"),
    RUSTC: join(sysroot, "bin", "rustc"),
    CARGO_INCREMENTAL: "0",
    CARGO_TERM_COLOR: "never",
    CARGO_TERM_PROGRESS_WHEN: "never",
    RUST_BACKTRACE: "0",
    GIT_CEILING_DIRECTORIES: `${dir}:${RG_ROOT}`,
  };
  // cargo prints canonical paths: the temp directory's `/var` is `/private/var` there.
  const roots: [string, string][] = [
    [realpathSync(dir), "$CASE"],
    [dir, "$CASE"],
    [RG_ROOT, "$RG_ROOT"],
    [sysroot, "$SYSROOT"],
  ];
  const work = join(dir, "work");
  const projectDir = rg ? join(RG_ROOT, RG_SRC) : step.project === "none" ? work : join(work, "hello");
  // No cargo config above where cargo runs, or in its CARGO_HOME (review harness-m8a-build N5): none is keyed. For hello, the case
  // directory is made afresh, so its parents are what is checked.
  const configs = cargoConfigsAbove(rg ? projectDir : join(dir, "x"), env.CARGO_HOME!, existsSync);
  if (configs.length) noResult(`cargo would read ${configs.join(", ")}, which no key covers: move it away`, 1);
  const run = (argv: string[], cwd: string): Promise<GroupRun> => runInGroup([cargo, ...argv.map((a) => a.replaceAll("<case>", dir))], { cwd, env, timeoutMs: STEP_TIMEOUT_MS });
  const lines = [`cargo-smoke ${step.id}: the side's cargo (built from cargo's pinned source by the side's compiler), RUSTC = the oracle's rustc`, `cargo ${step.cargo.join(" ")}`];
  const failed = (what: string, r: GroupRun): { lines: string[]; code: number } => {
    if (r.interrupted !== undefined) noResult(`the step was interrupted (${r.interrupted})`, 128 + signalNumber(r.interrupted));
    return { lines: [...lines, `${what} failed: ${r.timedOut ? "timed out" : r.exitCode === null ? `signal ${r.signalCode}` : `exit ${r.exitCode}`}`, "stderr:", ...normaliseSmokeStream(r.stderr.toString("latin1"), roots).map((l) => `  ${l}`)], code: 1 };
  };
  if (step.project === "hello" || step.project === "hello-tests") {
    const n = await run(["new", "--bin", "hello"], work);
    if (n.interrupted !== undefined || n.exitCode !== 0) return failed("cargo new --bin hello (setup)", n);
    if (step.project === "hello-tests") writeFileSync(join(projectDir, "src", "main.rs"), HELLO_TESTS_MAIN);
  }
  const body = async (): Promise<{ lines: string[]; code: number }> => {
    for (const pre of step.pre) {
      const r = await run(pre, projectDir);
      if (r.interrupted !== undefined || r.exitCode !== 0) return failed(`cargo ${pre.join(" ")} (setup)`, r);
    }
    const r = await run(step.cargo, projectDir);
    if (r.interrupted !== undefined) noResult(`the step was interrupted (${r.interrupted})`, 128 + signalNumber(r.interrupted));
    const code = r.timedOut ? 124 : (r.exitCode ?? 128 + signalNumber(r.signalCode ?? ""));
    const out = [
      ...lines,
      `exit ${r.timedOut ? `timed out after ${STEP_TIMEOUT_MS} ms` : r.exitCode === null ? `signal ${r.signalCode}` : r.exitCode}`,
      "stdout:",
      ...normaliseSmokeStream(r.stdout.toString("latin1"), roots).map((l) => `  ${l}`),
      "stderr:",
      ...normaliseSmokeStream(r.stderr.toString("latin1"), roots).map((l) => `  ${l}`),
    ];
    if (step.list !== undefined) {
      const at = join(step.list.dir === "hello" ? work : projectDir, step.list.dir);
      const files = walkFiles(at, (rel) => rel.split("/")[0] === ".fingerprint" || rel.split("/")[0] === "incremental");
      out.push(`files in ${step.list.dir}: ${files.length}`, ...files.map((f) => (step.list!.bytes ? `  ${f}: ${sizeHash(readFileSync(join(at, f)))}` : `  ${f}`)));
    }
    return { lines: out, code };
  };
  // ripgrep's CARGO_HOME is rg-build's: no other cargo in it meanwhile (see the header). The wait prints nothing.
  return rg ? withCaseLock(projectLock(PROJECTS.ripgrep), RG_LOCK_MAX_HOLD_MS, body, () => {}) : body();
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  try {
    const a = parseSideArgs(argv);
    const opt = (k: string): string => {
      const i = a.rest.indexOf(k);
      if (i < 0 || a.rest[i + 1] === undefined) throw new Error(`${k} is missing`);
      return a.rest[i + 1]!;
    };
    const id = opt("--step");
    const step = SMOKE_STEPS.find((s) => s.id === id);
    if (step === undefined) throw new Error(`no smoke step ${id}`);
    const dir = opt("--dir");
    if (!PROJECTS.cargo.isSetUp()) die(`cargo is not set up in ${PROJECTS.cargo.root}; run: ${PROJECTS.cargo.setupHint}`);
    const cargo = await sideCargo(a.side, a.compiler);
    const r = await runStep(step, cargo, dir);
    writeOut(1, Buffer.from(r.lines.join("\n") + "\n", "latin1"));
    rmSync(dir, { recursive: true, force: true });
    process.exit(r.code);
  } catch (e) {
    console.error(`ERROR: cargo-smoke: ${e instanceof Error ? e.message : String(e)}`);
    console.error("usage: bun scripts/cargo-smoke.ts --step <id> --side oracle|subject --dir <case dir> -- <compiler argv...>");
    process.exit(2);
  }
}
