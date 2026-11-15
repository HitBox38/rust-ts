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
// - **The binary is kept for rg-behaviour** in `bin/<side>/<key>/rg`, `<key>` being `rgBinKey`: this file and its helpers, the ripgrep
//   lock, the host tools that link it, the compiler argv, and for the oracle its rustc build, for the port the state of `src/`
//   (`srcState`). A build that makes no `rg` leaves `bin/<side>/<key>/stamp.json` with why, so rg-behaviour does not build again for the
//   same key. Other keys of the side are removed.
//
// Output (stdout), compared whole by difftest: a header line; `cargo exit <n>`; whether `rg` exists, and `rg --version` (its exit, stdout and
// stderr); every compiler call (`probe|compile <crate> <-C metadata>: exit <n>, stderr <size, sha256>`, sorted); cargo's stderr with
// `$RUST_TS_DATA/ripgrep` and the oracle sysroot named, the `Finished` line's time masked and the `Compiling` lines sorted (lib/rg-build.ts
// `normaliseCargoStderr`); the artifacts of `release/` by name,
// and the bytes of the dep-info and build-script outputs (`artifactLines`). Exit code: 70 with the port's first `rust-ts: unported:` line on
// stderr if any call stopped there (UNPORTED), 101 if a compiler panicked, else 0. Only a malformed command line or a missing setup exits 2.
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { REPO, die, hash } from "./lib/common.ts";
import { withCaseLock } from "./lib/case-lock.ts";
import { oracleSysroot, rustcDriverHash } from "./lib/oracle.ts";
import { RG_ROOT, RG_SRC, RG_VERSION, rgIsSetUp } from "./rg-check.ts";
import { rgCargoEnv } from "./lib/rg-check.ts";
import { artifactLines, buildExit, callLine, normaliseCargoStderr, sizeHash, type RgBuildCall, type RgStamp } from "./lib/rg-build.ts";

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

/** The key of one side's binary (see the header). */
export function rgBinKey(side: "oracle" | "subject", compiler: readonly string[]): string {
  const lock = readFileSync(join(RG_ROOT, RG_SRC, "Cargo.lock"));
  return hash([...RG_BUILD_SOURCES.map((f) => hash(readFileSync(f))), hash(lock), hostToolsId(), side, JSON.stringify(compiler), side === "oracle" ? rustcDriverHash() : srcState()].join("\0")).slice(0, 16);
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

export interface RgBuildResult {
  report: string[];
  exit: { code: number; unported?: string };
}

/** One build of `side` with the lock held (see the header). Writes the kept tree, the logs and `bin/<side>/<key>`. */
async function buildLocked(side: "oracle" | "subject", compiler: string[]): Promise<RgBuildResult> {
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
  };
  writeWrapper();
  rmSync(TREE, { recursive: true, force: true });
  rmSync(log, { recursive: true, force: true });
  rmSync(join(KEPT, side), { recursive: true, force: true });
  mkdirSync(log, { recursive: true });
  mkdirSync(join(RG_ROOT, "target"), { recursive: true });
  const errFile = join(log, "cargo.stderr");
  const out = openSync(join(log, "cargo.stdout"), "w");
  const err = openSync(errFile, "w");
  const p = Bun.spawn([join(sysroot, "bin", "cargo"), "build", "--release", "--locked", "--offline", "-j1", "--target-dir", TREE], { cwd: join(RG_ROOT, RG_SRC), env, stdin: "ignore", stdout: out, stderr: err });
  const stop = () => p.kill("SIGTERM");
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const code = await p.exited;
  process.off("SIGTERM", stop);
  process.off("SIGINT", stop);
  closeSync(out);
  closeSync(err);
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
  // The binary for rg-behaviour, or why there is none.
  const sideBin = join(RG_BIN, side);
  mkdirSync(sideBin, { recursive: true });
  const tmp = join(sideBin, `${key}.tmp-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp);
  if (existsSync(rg)) copyFileSync(rg, join(tmp, "rg"));
  const stamp: RgStamp = { key, outcome: existsSync(rg) ? "ok" : (exit.unported ?? `no rg: cargo exit ${code}`), builtAt: new Date().toISOString() };
  writeFileSync(join(tmp, "stamp.json"), JSON.stringify(stamp));
  for (const d of readdirSync(sideBin)) if (d !== `${key}.tmp-${process.pid}`) rmSync(join(sideBin, d), { recursive: true, force: true });
  renameSync(tmp, join(sideBin, key));
  if (existsSync(TREE)) renameSync(TREE, join(KEPT, side));
  return { report, exit };
}

/** One side's build under the lock: the `run` command. */
export const buildSide = (side: "oracle" | "subject", compiler: string[]): Promise<RgBuildResult> => withCaseLock(LOCK, LOCK_MAX_HOLD_MS, () => buildLocked(side, compiler));

/**
 * The `rg` of `side` built with `compiler` at the current key, building it first (under the lock) if no build of that key is kept: for
 * rg-behaviour, whose oracle output may be cached while rg-build's is too. `{ failed }` when that key's build made no `rg`.
 */
export async function ensureRg(side: "oracle" | "subject", compiler: string[]): Promise<{ rg: string } | { failed: string }> {
  return withCaseLock(LOCK, LOCK_MAX_HOLD_MS, async () => {
    const key = rgBinKey(side, compiler);
    const dir = join(RG_BIN, side, key);
    if (!existsSync(join(dir, "stamp.json"))) await buildLocked(side, compiler);
    const stamp = JSON.parse(readFileSync(join(dir, "stamp.json"), "utf8")) as RgStamp;
    return stamp.outcome === "ok" ? { rg: join(dir, "rg") } : { failed: stamp.outcome };
  });
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
  const b = Buffer.from(r.report.join("\n") + "\n", "latin1");
  for (let at = 0; at < b.length; ) at += writeSync(1, b, at);
  if (r.exit.unported !== undefined) process.stderr.write(`${r.exit.unported}\n`);
  process.exit(r.exit.code);
}
