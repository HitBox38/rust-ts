// ripgrep under a real `cargo build --release` (plan-m7 §6 `rg-build`, D9, D11, D19; lane harness-m7d): both sides of the `rg-build` suite,
// and the binaries `rg-behaviour` runs (scripts/rg-behaviour.ts `ensureRg`).
//
//   bun scripts/rg-build.ts run --side oracle|subject -- <compiler argv...>
//
// Needs `bun scripts/rg-check.ts setup` (ripgrep 15.2.0, its pinned `Cargo.lock` and every crate it names, under $RUST_TS_DATA/ripgrep).
//
// - **One build of one side:** the oracle's `cargo build --release --locked --offline -j1 --target-dir <tree>` in ripgrep's source
//   directory, with `RUSTC` set to scripts/rg-build-rustc.ts, which sends **every** compiler call to `<compiler argv>`: cargo's probes,
//   build scripts and their dependencies, every crate and the link of `rg`. On the port's side the build scripts are the port's output,
//   and cargo runs them. The stock release profile (`debug = 1`, D9), nothing overridden: every `CARGO_*` and `RUSTFLAGS`-like variable of
//   the caller is dropped, and `rgCargoEnv` sets `CARGO_INCREMENTAL=0` (D11) and keeps ripgrep's build.rs from finding a git repository.
// - `-j1`: cargo's stderr is compared, and with more jobs the compilers' diagnostics come in the order the jobs finish. One job also keeps
//   the port's memory to one compile at a time. Even so, the order of cargo's `Compiling` lines varies, so they are compared sorted.
// - **Both sides build at one absolute target path**, `$RUST_TS_DATA/ripgrep/target/rg-build`, one side at a time under the lock
//   `rg-build.lock`, as check-rg does: paths are in the dep-info and in what a build script prints. It is emptied before a build and
//   moved to `kept/rg-build/<side>` after it, with the logs (cargo's streams, each call's JSON and stderr) in `kept/rg-build/<side>-logs`.
// - **The build's processes are its own** (review harness-m7d F2). cargo runs in a process group of its own (`perl`'s `setpgrp`, then
//   `exec`, as scripts/native-run.ts runs its programs), and every process of the build carries `RGB_TREE=<tree>` in its environment.
//   On SIGTERM (difftest's time-out) or SIGINT the group gets SIGTERM, then SIGKILL after 3 s, and after cargo ends, whatever it ended
//   by, the group and every process left with that variable (`ps -E`, `killBuildProcesses`) are killed: cargo does not pass a signal on
//   to its compiler, which would keep running, at several GB for the port, and writing into the next build's tree. A build that starts
//   kills any such leftovers first (it holds the lock, so none is a live build's). cargo is a holder of the lock
//   (scripts/lib/case-lock.ts `addLockHolder`), so a wrapper killed by SIGKILL does not hand the tree to the next build while it runs.
//   An interrupted build (a signal to this process, or cargo ended by one) prints no report and no stamp, deletes its tree, and exits
//   128 + the signal.
// - **The binary is kept for rg-behaviour** in `bin/<side>/<key>/rg`, `<key>` being `rgBinKey`: this file and its helpers, the ripgrep
//   lock, the host tools that link it and the compiler argv; for the oracle its rustc build; for the port everything it reads (review
//   harness-m7d N1, `portInputs`): the state of `src/` (`srcState`), the files outside `src/` it imports (`scripts/lib/common.ts`,
//   `llvm-tools.ts`, `tools/llir/ffi_gen.ts`, ...), the config files Bun reads, the compiler's first word (Bun, or a subject binary) by
//   contents, the pinned LLVM tools and the oracle's rustc build (the std it links against).
//   - Only a **completed** build writes `bin/<side>/<key>/stamp.json`: `ok` beside the `rg`, or, for the port only, why there is none,
//     so rg-behaviour does not build again for the same key. The oracle's build either made an `rg` or leaves no stamp: the next
//     query builds again, and the one that found none prints `NO_RESULT_MARK`, which difftest never caches.
//   - The key directory appears whole (written as `<key>.tmp-<pid>`, then renamed), so a reader may check for its stamp without the lock
//     (scripts/rg-behaviour.ts takes the lock only to build).
//   - Keys of other worktrees and older ports stay (review harness-m7d N2: a query of another worktree may be running its `rg`); a key
//     directory unused for `KEY_MAX_AGE_MS` is removed when a build writes a new one.
// - A lock wait prints nothing (review harness-m7d F1): this process's stderr is compared and cached.
//
// Output (stdout), compared whole by difftest: a header line; `cargo exit <n>`; whether `rg` exists, and `rg --version` (its exit, stdout and
// stderr); every compiler call (`probe|compile <crate> <-C metadata>: exit <n>, stdout <size, sha256>, stderr <size, sha256>`, sorted: a
// probe's stdout is its answer to cargo); cargo's stderr with `$RUST_TS_DATA/ripgrep` and the oracle sysroot named, the `Finished` line's
// time masked and the `Compiling` lines sorted (lib/rg-build.ts `normaliseCargoStderr`); the artifacts of `release/` by name, and the bytes
// of the dep-info and build-script outputs (`artifactLines`). Exit code: 70 with the port's first `rust-ts: unported:` line on stderr if any
// call stopped there (UNPORTED), 101 if a compiler panicked, else 0; the oracle's build that makes no `rg` adds `NO_RESULT_MARK` to its
// stderr. A missing setup prints an `ERROR:` line and exits 1; a malformed command line exits 2.
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { REPO, die, hash } from "./lib/common.ts";
import { addLockHolder, withCaseLock } from "./lib/case-lock.ts";
import { llvmToolHashes } from "./lib/llvm-tools.ts";
import { oracleHost, oracleSysroot, rustcDriverHash } from "./lib/oracle.ts";
import { RG_ROOT, RG_SRC, RG_VERSION, rgIsSetUp } from "./rg-check.ts";
import { rgCargoEnv } from "./lib/rg-check.ts";
import { NO_RESULT_MARK, artifactLines, buildExit, callLine, normaliseCargoStderr, sizeHash, type RgBuildCall, type RgStamp } from "./lib/rg-build.ts";

export const RG_BUILD = join(REPO, "scripts", "rg-build.ts");
const RG_BUILD_RUSTC = join(REPO, "scripts", "rg-build-rustc.ts");
/** The sources whose change re-keys the oracle's output and the kept binaries. */
export const RG_BUILD_SOURCES = [RG_BUILD, RG_BUILD_RUSTC, join(REPO, "scripts", "lib", "rg-build.ts"), join(REPO, "scripts", "lib", "rg-check.ts")];
const TREE = join(RG_ROOT, "target", "rg-build");
const KEPT = join(RG_ROOT, "kept", "rg-build");
export const RG_BIN = join(RG_ROOT, "bin");
const LOCK = join(RG_ROOT, "rg-build.lock");
const WRAPPER = join(RG_ROOT, "rustc-wrap-build.sh");
const CARGO_HOME = join(RG_ROOT, "cargo");
/** A port build of ripgrep is many compiles with codegen, one at a time; a lock older than this has a dead owner. */
const LOCK_MAX_HOLD_MS = 8 * 3_600_000;
const RUN_TIMEOUT_MS = 30_000;
/** A kept key directory unused this long is removed when a build writes a new one (no query runs for days). */
export const KEY_MAX_AGE_MS = 3 * 24 * 3_600_000;
/** The variable every process of a build carries, with the build tree as its value (`killBuildProcesses`). */
const MARK_VAR = "RGB_TREE";
/** How long the build's group has after SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 3_000;
const SIGNALS: Record<string, number> = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };
/** Variables that would change what cargo builds or how, or where ripgrep's build.rs looks for git; dropped from the caller's environment. */
const SCRUBBED = (k: string): boolean =>
  k.startsWith("CARGO_") || ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "RUSTFLAGS", "RUSTDOCFLAGS", "RUSTC", "RUSTDOC", "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER", "RUSTC_BOOTSTRAP"].includes(k);

let hostToolsMemo: string | undefined;
/** What links `rg` and builds its C-free tree on this machine: `cc -v`, `ld -v`, the SDK version and the OS build (as the native suites' key). */
export function hostToolsId(): string {
  if (hostToolsMemo !== undefined) return hostToolsMemo;
  const out = (cmd: string[]) => {
    const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
    return `${r.exitCode}\0${r.stdout.toString()}\0${r.stderr.toString()}`;
  };
  return (hostToolsMemo = hash([out(["cc", "-v"]), out(["ld", "-v"]), out(["xcrun", "--show-sdk-version"]), out(["sw_vers"]), ...["SDKROOT", "DEVELOPER_DIR", "LIBRARY_PATH"].map((k) => `${k}=${process.env[k] ?? "<unset>"}`)].join("\0")));
}

/**
 * The state of the port's sources, for the key of a port-built `rg`: `HEAD:src`'s tree, and every changed or untracked file under `src/`
 * with its contents. A port-built binary is reused only by the same port.
 */
export function srcState(): string {
  const git = (args: string[]) => {
    const r = Bun.spawnSync(["git", ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) die(`git ${args.join(" ")} failed: ${r.stderr.toString().trim().split("\n")[0]}`);
    return r.stdout.toString();
  };
  const tree = git(["rev-parse", "HEAD:src"]).trim();
  const changed = git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "src"]).split("\0").filter(Boolean);
  const parts = changed.map((l) => {
    const f = l.slice(3);
    const p = join(REPO, f);
    return `${l}\0${existsSync(p) ? hash(readFileSync(p)) : "deleted"}`;
  });
  return hash([tree, ...parts].join("\0"));
}

let portInputsMemo: string | undefined;
/**
 * What the port reads besides `src/` (review harness-m7d N1), for the key of a port-built `rg`: every file outside `src/` that a non-test
 * module under `src/` imports, with what those import in turn (found by their import specifiers: an over-approximation, as some are
 * oracle-fixture scripts, which is safe), the config files Bun reads, the pinned LLVM tools and the oracle's rustc build, whose std the
 * port links against. The compiler's own first word is in `rgBinKey`.
 */
export function portInputs(): string {
  if (portInputsMemo !== undefined) return portInputsMemo;
  const srcDir = join(REPO, "src");
  const g = Bun.spawnSync(["grep", "-rlE", "--include=*.ts", "--exclude=*.test.ts", "(\\.\\./)+(scripts|tools|harness)/", srcDir], { stdout: "pipe", stderr: "pipe" });
  const importers = g.stdout.toString().split("\n").filter(Boolean);
  const outside = new Set<string>();
  const todo: string[] = [];
  const visit = (from: string) => {
    for (const m of readFileSync(from, "utf8").matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["'](\.{1,2}\/[^"']+)["']/gm)) {
      const f = resolve(dirname(from), m[1]!);
      if (!f.startsWith(`${REPO}/`) || f.startsWith(`${srcDir}/`) || outside.has(f) || !existsSync(f)) continue;
      outside.add(f);
      todo.push(f);
    }
  };
  for (const f of importers) visit(f);
  while (todo.length) visit(todo.pop()!);
  const configs = ["UPSTREAM.json", "tsconfig.json", "package.json", "bunfig.toml", "bun.lock"].filter((f) => existsSync(join(REPO, f)));
  const files = [...[...outside].map((f) => relative(REPO, f)), ...configs].sort();
  return (portInputsMemo = hash(
    [...files.map((f) => `${f}\0${hash(readFileSync(join(REPO, f)))}`), JSON.stringify(llvmToolHashes(oracleSysroot(), oracleHost())), rustcDriverHash()].join("\0"),
  ));
}

/** The contents of a compiler's first word (Bun, or a subject binary): the path stays the same across an upgrade. */
const programId = (cmd: readonly string[]): string => {
  const p = cmd[0] !== undefined && cmd[0].includes("/") ? cmd[0] : Bun.which(cmd[0] ?? "") ?? "";
  return p !== "" && existsSync(p) ? hash(readFileSync(p)) : `unknown ${cmd[0]}`;
};

/** The key of one side's binary (see the header). */
export function rgBinKey(side: "oracle" | "subject", compiler: readonly string[]): string {
  const lock = readFileSync(join(RG_ROOT, RG_SRC, "Cargo.lock"));
  const sideParts = side === "oracle" ? [rustcDriverHash()] : [srcState(), portInputs(), programId(compiler)];
  return hash([...RG_BUILD_SOURCES.map((f) => hash(readFileSync(f))), hash(lock), hostToolsId(), side, JSON.stringify(compiler), ...sideParts].join("\0")).slice(0, 16);
}

/** Kills the process group `pgid`, if any of it is left. */
function killGroup(pgid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(-pgid, sig);
  } catch {
    // ESRCH: nothing is left.
  }
}

/**
 * Kills every process but this one whose environment holds `RGB_TREE=<tree>` (`ps -E`; see the header): what a build left running. A
 * platform binary (`/usr/bin/cc`, ...) shows no environment there, but those are in cargo's group. Returns their pids.
 */
export function killBuildProcesses(tree: string, sig: NodeJS.Signals = "SIGKILL"): number[] {
  const mark = `${MARK_VAR}=${tree}`;
  const r = Bun.spawnSync(["/bin/ps", "-axwwE", "-o", "pid=,command="], { stdout: "pipe", stderr: "ignore" });
  const killed: number[] = [];
  for (const line of r.stdout.toString().split("\n")) {
    const m = /^\s*(\d+) (.*)$/.exec(line);
    if (!m || Number(m[1]) === process.pid) continue;
    if (!` ${m[2]} `.includes(` ${mark} `)) continue;
    try {
      process.kill(Number(m[1]), sig);
      killed.push(Number(m[1]));
    } catch {
      // Gone already.
    }
  }
  return killed;
}

function writeWrapper(): void {
  // Written only when it changes: cargo's `.rustc_info.json` keys on this file's mtime.
  const text = '#!/bin/sh\nexec "$RGB_BUN" "$RGB_WRAPPER_TS" "$@"\n';
  if (!existsSync(WRAPPER) || readFileSync(WRAPPER, "utf8") !== text) writeFileSync(WRAPPER, text, { mode: 0o755 });
}

/** A program's run with a fixed environment, for `rg --version`: its exit and both streams, indented. */
function runLines(cmd: string[], cwd: string): string[] {
  const r = Bun.spawnSync(cmd, { cwd, env: { PATH: "/usr/bin:/bin", HOME: cwd }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: RUN_TIMEOUT_MS });
  const ind = (s: string) => (s === "" ? [] : s.replace(/\n$/, "").split("\n").map((l) => `    ${l}`));
  return [`  exit ${r.exitedDueToTimeout ? `timed out after ${RUN_TIMEOUT_MS} ms` : (r.exitCode ?? `signal ${r.signalCode}`)}`, "  stdout:", ...ind(r.stdout.toString()), "  stderr:", ...ind(r.stderr.toString())];
}

/** A completed build's report and exit (`noResult`: why the oracle's has no result difftest may keep), or the signal that interrupted it. */
export type RgBuildResult = { report: string[]; exit: { code: number; unported?: string }; noResult?: string } | { interrupted: string };

/** One build of `side` with `lock` held (see the header). Writes the kept tree, the logs and, if it completed, `bin/<side>/<key>`. */
async function buildLocked(side: "oracle" | "subject", compiler: string[], lock: string): Promise<RgBuildResult> {
  if (!rgIsSetUp()) die(`ripgrep is not set up in ${RG_ROOT}; run: bun scripts/rg-check.ts setup`);
  const sysroot = oracleSysroot();
  const key = rgBinKey(side, compiler);
  const log = join(KEPT, `${side}-logs`);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !SCRUBBED(e[0]))),
    ...rgCargoEnv(RG_ROOT, CARGO_HOME),
    CARGO_TERM_COLOR: "never",
    CARGO_TERM_PROGRESS_WHEN: "never",
    RUSTC: WRAPPER,
    RUSTC_ICE: "0",
    RUST_BACKTRACE: "0",
    RGB_COMPILER: JSON.stringify(compiler),
    RGB_LOG: log,
    RGB_BUN: process.execPath,
    RGB_WRAPPER_TS: RG_BUILD_RUSTC,
    [MARK_VAR]: TREE,
  };
  writeWrapper();
  // Leftovers of a build whose owner died: this process holds the lock, so no live build has them.
  killBuildProcesses(TREE);
  rmSync(TREE, { recursive: true, force: true });
  rmSync(log, { recursive: true, force: true });
  rmSync(join(KEPT, side), { recursive: true, force: true });
  mkdirSync(log, { recursive: true });
  mkdirSync(join(RG_ROOT, "target"), { recursive: true });
  const errFile = join(log, "cargo.stderr");
  const out = openSync(join(log, "cargo.stdout"), "w");
  const err = openSync(errFile, "w");
  // `setpgrp`, then `exec`: cargo leads a group of its own, which can be signalled as a whole.
  const cargo = [join(sysroot, "bin", "cargo"), "build", "--release", "--locked", "--offline", "-j1", "--target-dir", TREE];
  const p = Bun.spawn(["/usr/bin/perl", "-e", "setpgrp(0, 0); exec { $ARGV[0] } @ARGV or exit 127", ...cargo], { cwd: join(RG_ROOT, RG_SRC), env, stdin: "ignore", stdout: out, stderr: err });
  addLockHolder(lock, p.pid);
  let interrupted: NodeJS.Signals | undefined;
  let escalate: ReturnType<typeof setTimeout> | undefined;
  const stop = (sig: NodeJS.Signals) => () => {
    interrupted ??= sig;
    killGroup(p.pid, "SIGTERM");
    escalate ??= setTimeout(() => {
      killGroup(p.pid, "SIGKILL");
      killBuildProcesses(TREE);
    }, KILL_GRACE_MS);
  };
  const onTerm = stop("SIGTERM");
  const onInt = stop("SIGINT");
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInt);
  const code = await p.exited;
  process.off("SIGTERM", onTerm);
  process.off("SIGINT", onInt);
  if (escalate !== undefined) clearTimeout(escalate);
  // Whatever cargo ended by: what it left in its group, then what left the group.
  killGroup(p.pid, "SIGKILL");
  killBuildProcesses(TREE);
  closeSync(out);
  closeSync(err);
  if (interrupted !== undefined || p.signalCode) {
    rmSync(TREE, { recursive: true, force: true });
    return { interrupted: interrupted ?? String(p.signalCode) };
  }
  const calls = readdirSync(log)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(log, f), "utf8")) as RgBuildCall);
  const exit = buildExit(calls.map((c) => ({ code: c.code, stderrText: readFileSync(join(log, c.stderr), "latin1") })));
  const profile = join(TREE, "release");
  const rg = join(profile, "rg");
  const report = [
    `rg-build ripgrep ${RG_VERSION}: cargo build --release (stock profile, debug = 1), -j1, CARGO_INCREMENTAL=0, every compiler call to the side's compiler`,
    `cargo exit ${code}`,
    `rg ${existsSync(rg) ? "built" : "missing"}`,
    ...(existsSync(rg) ? ["rg --version", ...runLines([rg, "--version"], log)] : []),
    `compiler calls: ${calls.length}`,
    ...calls.map((c) => callLine(c, readFileSync(join(log, c.stderr)))).sort(),
    "cargo stderr:",
    ...normaliseCargoStderr(readFileSync(errFile, "latin1"), [
      [RG_ROOT, "$RG_ROOT"],
      [sysroot, "$SYSROOT"],
    ]).map((l) => `  ${l}`),
    `cargo stdout: ${sizeHash(readFileSync(join(log, "cargo.stdout")))}`,
    ...artifactLines(profile),
  ];
  // The binary for rg-behaviour, or (the port's only) why there is none: this build completed.
  const sideBin = join(RG_BIN, side);
  mkdirSync(sideBin, { recursive: true });
  const built = existsSync(rg);
  if (built || side === "subject") {
    const tmp = join(sideBin, `${key}.tmp-${process.pid}`);
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp);
    if (built) copyFileSync(rg, join(tmp, "rg"));
    const stamp: RgStamp = { key, outcome: built ? "ok" : (exit.unported ?? `no rg: cargo exit ${code}`), builtAt: new Date().toISOString() };
    writeFileSync(join(tmp, "stamp.json"), JSON.stringify(stamp));
    // A rename onto a directory that exists fails: the old one of this key goes aside first, and then away.
    const dest = join(sideBin, key);
    const old = `${dest}.old-${process.pid}`;
    if (existsSync(dest)) renameSync(dest, old);
    renameSync(tmp, dest);
    rmSync(old, { recursive: true, force: true });
  } else {
    rmSync(join(sideBin, key), { recursive: true, force: true });
  }
  pruneKeys(sideBin, key);
  const noResult = side === "oracle" && !built ? `the oracle's build of rg made no binary (cargo exit ${code})` : undefined;
  if (existsSync(TREE)) renameSync(TREE, join(KEPT, side));
  return { report, exit, ...(noResult !== undefined ? { noResult } : {}) };
}

/**
 * Removes the key directories of a side (`sideBin`) unused for `KEY_MAX_AGE_MS`, and leftover temp directories of dead builds, but never
 * `keep` (review harness-m7d N2: another worktree's query may be running a recent one).
 */
export function pruneKeys(sideBin: string, keep: string, now: number = Date.now()): string[] {
  const removed: string[] = [];
  for (const d of readdirSync(sideBin)) {
    if (d === keep) continue;
    const p = join(sideBin, d);
    const m = /\.(?:tmp|old)-(\d+)$/.exec(d);
    let dead = false;
    if (m) {
      try {
        process.kill(Number(m[1]), 0);
      } catch (e) {
        dead = (e as NodeJS.ErrnoException).code !== "EPERM";
      }
    }
    if (dead || now - statSync(p).mtimeMs > KEY_MAX_AGE_MS) {
      rmSync(p, { recursive: true, force: true });
      removed.push(d);
    }
  }
  return removed;
}

/** One side's build under the lock: the `run` command. A lock wait prints nothing (see the header). */
export const buildSide = (side: "oracle" | "subject", compiler: string[]): Promise<RgBuildResult> => withCaseLock(LOCK, LOCK_MAX_HOLD_MS, () => buildLocked(side, compiler, LOCK), () => {});

/** A key directory's stamp, if the key has one; a directory appears whole (see the header), so this needs no lock. */
const readStamp = (dir: string): RgStamp | undefined => (existsSync(join(dir, "stamp.json")) ? (JSON.parse(readFileSync(join(dir, "stamp.json"), "utf8")) as RgStamp) : undefined);

/**
 * The `rg` of `side` built with `compiler` at the current key: for rg-behaviour, whose oracle output may be cached while rg-build's is
 * too. A kept stamp is read without the lock. Without one, the lock is taken (silently) and, if the stamp is still missing, the key is
 * built. `{ failed }`: that key's completed build made no `rg` (`stamped` when the port's stamp says so; an oracle build that made none
 * leaves no stamp); `{ interrupted }`: this process got a signal while it built.
 */
export async function ensureRg(side: "oracle" | "subject", compiler: string[]): Promise<{ rg: string } | { failed: string; stamped: boolean } | { interrupted: string }> {
  const key = rgBinKey(side, compiler);
  const dir = join(RG_BIN, side, key);
  let stamp = readStamp(dir);
  if (stamp === undefined) {
    const r = await withCaseLock(
      LOCK,
      LOCK_MAX_HOLD_MS,
      async () => {
        stamp = readStamp(dir);
        return stamp === undefined ? await buildLocked(side, compiler, LOCK) : undefined;
      },
      () => {},
    );
    if (r !== undefined && "interrupted" in r) return { interrupted: r.interrupted };
    stamp = readStamp(dir);
  }
  if (stamp === undefined) return { failed: "its build completed and made no rg", stamped: false };
  return stamp.outcome === "ok" ? { rg: join(dir, "rg") } : { failed: stamp.outcome, stamped: true };
}

/** `[--side oracle|subject, --, compiler...]`, as the suites pass it; throws on a malformed one. */
export function parseSideArgs(argv: readonly string[]): { side: "oracle" | "subject"; rest: string[]; compiler: string[] } {
  const dd = argv.indexOf("--");
  if (dd < 0 || dd === argv.length - 1) throw new Error("no `-- <compiler argv>`");
  const head = argv.slice(0, dd);
  const i = head.indexOf("--side");
  const side = i < 0 ? undefined : head[i + 1];
  if (side !== "oracle" && side !== "subject") throw new Error("--side must be oracle or subject");
  return { side, rest: [...head.slice(0, i), ...head.slice(i + 2)], compiler: argv.slice(dd + 1) };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv[0] !== "run") {
    console.error("usage: bun scripts/rg-build.ts run --side oracle|subject -- <compiler argv...>");
    process.exit(2);
  }
  let a: ReturnType<typeof parseSideArgs>;
  try {
    a = parseSideArgs(argv.slice(1));
    if (a.rest.length) throw new Error(`unknown arguments: ${a.rest.join(" ")}`);
  } catch (e) {
    console.error(`ERROR: rg-build: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  const r = await buildSide(a.side, a.compiler);
  if ("interrupted" in r) {
    process.stderr.write(`${NO_RESULT_MARK}the build was interrupted (${r.interrupted})\n`);
    process.exit(128 + (SIGNALS[r.interrupted] ?? 0));
  }
  const b = Buffer.from(r.report.join("\n") + "\n", "latin1");
  for (let at = 0; at < b.length; ) at += writeSync(1, b, at);
  if (r.exit.unported !== undefined) process.stderr.write(`${r.exit.unported}\n`);
  if (r.noResult !== undefined) process.stderr.write(`${NO_RESULT_MARK}${r.noResult}\n`);
  process.exit(r.exit.code);
}
