// A pinned project under a real `cargo build` with every compiler call on the side's compiler (plan-m8 D8, D15, D17, D20; lane
// harness-m8a-build, generalising lane harness-m7d's scripts/rg-build.ts): both sides of the `rg-build` suite (ripgrep, plan-m7 §6) and of
// `cargo-build` (cargo, plan-m8 §4), and the binaries `rg-behaviour` (scripts/rg-behaviour.ts) and `cargo-smoke` (scripts/cargo-smoke.ts) run.
//
//   bun scripts/cargo-project-build.ts run   --project ripgrep|cargo --side oracle|subject -- <compiler argv...>
//   bun scripts/cargo-project-build.ts check --project ripgrep|cargo                (preconditions only: builds nothing)
//
// Setup: ripgrep needs `bun scripts/rg-check.ts setup` (ripgrep 15.2.0, its pinned `Cargo.lock` and every crate it names, under
// $RUST_TS_DATA/ripgrep); cargo needs `bun scripts/tools-src.ts setup cargo` (UPSTREAM.json `cargo.commit`, its `Cargo.lock` fetched into the
// isolated CARGO_HOME $RUST_TS_DATA/cargo-src/cargo-home).
//
// **The two projects are configurations of one harness** (`PROJECTS`), with the same report format, key, lock, sweep and kept-binary rules.
// What differs is what D15, D17 and D20 ask of cargo and plan-m7 §6 of ripgrep, each named in the project: the profile and the cargo flags
// (ripgrep: `--release`, the stock profile, `debug = 1`, plan-m7 D9; cargo: the dev profile and `--features all-static`, cargo's own
// distribution configuration, vendored OpenSSL and libgit2 and the OS's libcurl, D15), the environment (below), the extra report
// sections, whether the tree is kept, and the host preconditions and watchdog (D20; ripgrep is outside D20).
//
// - **One build of one side:** the oracle's `cargo build --locked --offline -j1 --target-dir <tree> <project flags>` in the project's source
//   directory, with `RUSTC` set to scripts/cargo-project-build-rustc.ts, which sends **every** compiler call to `<compiler argv>`: cargo's
//   probes, build scripts and their dependencies, every crate and the link of the binary. On the port's side the build scripts are the
//   port's output, and cargo runs them. Nothing of the project is overridden: every `CARGO_*` and `RUSTFLAGS`-like variable of the caller is
//   dropped, `CARGO_INCREMENTAL=0` (plan-m7 D11, plan-m8 D16) and `GIT_CEILING_DIRECTORIES` (a build script must not find this repository)
//   are set. **cargo's environment is built, not inherited** (D15): only `HOME`, `TMPDIR`, `USER`, `LOGNAME`, the three variables
//   `hostToolsId` keys on (`SDKROOT`, `DEVELOPER_DIR`, `LIBRARY_PATH`) and the port's own `RUST_TS_*` and `BUN_*` pass, so no `OPENSSL_*`,
//   `PKG_CONFIG*`, `CC`, `CFLAGS`, `LIBGIT2_*` or deployment target of the caller reaches a `-sys` build script, and `PATH` is
//   `/usr/bin:/bin:/usr/sbin:/sbin`, refused if it holds a `pkg-config` or a `curl-config` other than the OS's (lib `builtPathRefusal`).
//   ripgrep's build keeps lane harness-m7d's environment (the caller's, minus the scrubbed variables): its protected report is unchanged.
// - `-j1`: cargo's stderr is compared, and with more jobs the compilers' diagnostics come in the order the jobs finish. One job also keeps
//   the port's memory to one compile at a time (D17). Even so, the order of cargo's `Compiling` lines varies, so they are compared sorted.
// - **Both sides build at one absolute target path** per project, `<root>/target/<suite>`, one side at a time under the project's lock
//   `<root>/<suite>.lock`, as check-rg does: paths are in the dep-info and in what a build script prints. It is emptied before a build. After
//   it, ripgrep's tree is moved to `<root>/kept/rg-build/<side>`; cargo's (2-3 GiB a side, D17) is deleted once the report is made, keeping
//   only the binary. The logs (cargo's streams, each call's JSON and stderr) stay in `<root>/kept/<suite>/<side>-logs`.
// - **The build's processes are its own** (review harness-m7d F2). cargo runs in a process group of its own (`perl`'s `setpgrp`, then
//   `exec`, as scripts/native-run.ts runs its programs), and every process of the build carries `CPB_TREE=<tree>#<nonce>` in its
//   environment, with a nonce made for this build and kept beside the lock (`<lock>.nonce`) for the next build's start. On SIGTERM
//   (difftest's time-out), SIGINT or SIGHUP (a closed terminal; harness-m7d re-check note 5) the group gets SIGTERM, then SIGKILL after 3 s,
//   and after cargo ends, whatever it ended by, the group and every process left with that variable are killed (`killBuildProcesses`:
//   cargo does not pass a signal on to its compiler, which would keep running, at several GB for the port, and writing into the next
//   build's tree). Only a process whose **environment** holds the tag, as one whole entry, is killed, never one that names it in its argv
//   (lib `markedPids`; harness-m7d re-check note 1, w40t-audit N6). A build that starts kills the previous build's leftovers first (it
//   holds the lock, so none is a live build's). cargo is a holder of the lock (scripts/lib/case-lock.ts `addLockHolder`), so a wrapper
//   killed by SIGKILL does not hand the tree to the next build while it runs. An interrupted build (a signal to this process, cargo or a
//   compiler call killed from outside, by SIGKILL, SIGTERM, SIGINT or SIGHUP: re-check note 4, a compiler the kernel killed leaves no
//   stamp) prints no report and no stamp, deletes its tree, and exits 128 + the signal's number (re-check note 6).
// - **Host preconditions and the watchdog (D20), cargo only.** Before a build: AC power, no `$RUST_TS_DATA/tmp/GATE_RUNNING` unless this
//   runs under the gate (`RUST_TS_GATE_RUN`, which scripts/gate.ts sets), and the project's headroom class (lib/headroom.ts
//   `headroomRefusal`: 20 GiB free, swap under 4 GiB, pressure not critical). A refusal builds nothing and exits 1 with the project's
//   no-result mark. During the build the watchdog (lib/watchdog.ts) polls every 5 s; at the 4 GiB floor or after 60 s of critical memory
//   pressure it records the stop (lib/headroom.ts `recordWatchdogStop`, which the gate reads after the suite) **before** it kills the
//   group (review harness-m8a-gate N2), and the build ends as stopped: no report, no stamp, the mark, exit 1.
// - **The binary is kept** in `<root>/bin/<side>/<key>/<binary>`, `<key>` being `binKey`: this file and its helpers, the project's
//   `Cargo.lock` and own key parts, the host tools that link it (`hostToolsId`) and the compiler argv; for the oracle its rustc build;
//   for the port everything it reads (review harness-m7d N1, `portInputs`): the state of `src/` (`srcState`), the files outside `src/` it
//   imports, the config files Bun reads, the compiler's first word (Bun, or a subject binary) by contents, the pinned LLVM tools and the
//   oracle's rustc build (the std it links against).
//   - Only a **completed** build writes `bin/<side>/<key>/stamp.json`: `ok` beside the binary, or, for the port only, why there is none,
//     so a user of the binary does not build again for the same key. The oracle's build either made a binary or leaves no stamp.
//   - The key directory appears whole (written as `<key>.tmp-<pid>`, then renamed), so a reader may check for its stamp without the lock.
//     A stamp that cannot be read (the key replaced in that instant, or pruned) is no stamp: the reader takes the lock and looks again
//     (harness-m7d re-check note 3).
//   - Keys of other worktrees and older ports stay (review harness-m7d N2); a key directory **unused** for `KEY_MAX_AGE_MS` is removed when
//     a build writes a new one. A kept key is touched each time `ensureBinary` hands it out, so its age is its last use (re-check note 2).
// - A lock wait prints nothing (review harness-m7d F1): this process's stderr is compared and cached.
//
// Output (stdout), compared whole by difftest: a header line; `cargo exit <n>`; whether the binary exists, and `<binary> --version` (its
// exit, stdout and stderr); every compiler call (`probe|compile <crate> <-C metadata>: exit <n>, stdout <size, sha256>, stderr <size,
// sha256>`, sorted: a probe's stdout is its answer to cargo); cargo's stderr with the project's root and the oracle sysroot named, the
// `Finished` line's time masked and the `Compiling` lines sorted (lib `normaliseCargoStderr`); the artifacts of the profile directory by
// name, and the bytes of the dep-info and build-script outputs (`artifactLines`); for cargo also each `-sys` crate's build-script output
// (`sysBuildScriptLines`) and `otool -L` of the built `cargo` (D15). Exit code: 70 with the port's first `rust-ts: unported:` line on
// stderr if any call stopped there (UNPORTED), 101 if a compiler panicked, else 0; the oracle's build that makes no binary adds the
// project's no-result mark to its stderr. A missing setup prints an `ERROR:` line and exits 1; a malformed command line exits 2.
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { DATA, REPO, die, hash } from "./lib/common.ts";
import { addLockHolder, withCaseLock } from "./lib/case-lock.ts";
import { llvmToolHashes } from "./lib/llvm-tools.ts";
import { oracleHost, oracleSysroot, rustcDriverHash } from "./lib/oracle.ts";
import { RG_ROOT, RG_SRC, RG_VERSION, rgIsSetUp } from "./rg-check.ts";
import { rgCargoEnv } from "./lib/rg-check.ts";
import { CARGO_SRC_HOME, CARGO_SRC_ROOT, cargoSrcIsSetUp } from "./tools-src.ts";
import { cargoPinOf } from "./lib/tools-src.ts";
import { HEADROOM_MINIMUMS, headroomRefusal, readHeadroom, watchdogStopDir, type HeadroomClass } from "./lib/headroom.ts";
import { REAL_HOST, batteryRefusal, parsePower, type HostReaders } from "./lib/host-state.ts";
import { startWatchdog, type Watchdog, type WatchdogLimits } from "./lib/watchdog.ts";
import {
  CARGO_NO_RESULT_MARK,
  NO_RESULT_MARK,
  artifactLines,
  buildExit,
  builtPathRefusal,
  callLine,
  markedPids,
  normaliseCargoStderr,
  otoolLines,
  signalNumber,
  sizeHash,
  sysBuildScriptLines,
  type BinStamp,
  type BuildCall,
} from "./lib/cargo-project-build.ts";

export const CARGO_PROJECT_BUILD = join(REPO, "scripts", "cargo-project-build.ts");
const BUILD_RUSTC = join(REPO, "scripts", "cargo-project-build-rustc.ts");
/** The harness's sources: a change re-keys every project's oracle output and kept binaries. */
export const PROJECT_BUILD_SOURCES = [
  CARGO_PROJECT_BUILD,
  BUILD_RUSTC,
  join(REPO, "scripts", "lib", "cargo-project-build.ts"),
  join(REPO, "scripts", "lib", "rg-check.ts"),
  join(REPO, "scripts", "lib", "watchdog.ts"),
  join(REPO, "scripts", "lib", "headroom.ts"),
];
/** A kept key directory unused this long is removed when a build writes a new one (no query runs for days). */
export const KEY_MAX_AGE_MS = 3 * 24 * 3_600_000;
/** The variable every process of a build carries, with `<tree>#<nonce>` as its value (`killBuildProcesses`). */
const MARK_VAR = "CPB_TREE";
/** How long the build's group has after SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 3_000;
const RUN_TIMEOUT_MS = 30_000;
/** The signals that interrupt a build (re-check note 5: SIGHUP too). */
const INTERRUPTS: NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGHUP"];
/** Variables that would change what cargo builds or how, or where a build script looks for git; dropped from the caller's environment (ripgrep). */
const SCRUBBED = (k: string): boolean =>
  k.startsWith("CARGO_") || ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "RUSTFLAGS", "RUSTDOCFLAGS", "RUSTC", "RUSTDOC", "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER", "RUSTC_BOOTSTRAP"].includes(k);
/** What a built environment keeps of the caller's (cargo; see the header). */
const KEPT_IN_BUILT_ENV = (k: string): boolean => ["HOME", "TMPDIR", "USER", "LOGNAME", "SDKROOT", "DEVELOPER_DIR", "LIBRARY_PATH"].includes(k) || k.startsWith("RUST_TS_") || k.startsWith("BUN_");
/** The built `PATH` (D15): the OS's directories only. */
export const BUILT_PATH_DIRS = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
/** The marker root keeps while a gate runs (as scripts/subject-bin-bench.ts reads it). */
export const GATE_RUNNING = join(DATA, "tmp", "GATE_RUNNING");

/** One project the harness builds (see the header). */
export interface Project {
  name: "ripgrep" | "cargo";
  /** The suite whose sides these builds are: the tree, the lock and the kept directory are named after it. */
  suite: string;
  /** Where everything of this project lives under $RUST_TS_DATA. */
  root: string;
  /** The source directory, relative to `root`. */
  src: () => string;
  isSetUp: () => boolean;
  setupHint: string;
  cargoHome: string;
  /** cargo's argv after the program: `build`, the project's flags, `--locked --offline -j1 --target-dir <tree>`. */
  cargoArgs: (tree: string) => string[];
  /** `release` or `debug`. */
  profile: string;
  /** The binary the build makes and the users run. */
  binary: string;
  /** The report's first line. */
  header: () => string;
  /** The name of `root` in the report. */
  rootName: string;
  /** The environment of cargo: the caller's minus `SCRUBBED` (ripgrep), or built from `KEPT_IN_BUILT_ENV` and `BUILT_PATH_DIRS` (cargo). */
  builtEnv: boolean;
  /** D17: cargo's tree is deleted after its report; ripgrep's is kept in `kept/<suite>/<side>`. */
  keepTree: boolean;
  /** D15's recorded checks in the report: the `-sys` build scripts' output and `otool -L` of the binary. */
  sysReport: boolean;
  /** D20's row: the preconditions before a build and the watchdog during it. Unset: neither (ripgrep). */
  headroom?: HeadroomClass;
  noResultMark: string;
  /** The project's own key parts (beyond the harness's sources, its lock and `hostToolsId`). */
  keyParts: () => string[];
}

const cargoPin = () => {
  const p = cargoPinOf(JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")));
  if (typeof p === "string") die(p);
  return p;
};

let buildToolsMemo: string | undefined;
/** What else cargo's build runs from the built `PATH`: `make` and `perl` build `openssl-src`'s OpenSSL (`all-static`). */
const buildToolsId = (): string => {
  if (buildToolsMemo !== undefined) return buildToolsMemo;
  const out = (cmd: string[]) => {
    const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", env: { PATH: BUILT_PATH_DIRS.join(":") } });
    return `${r.exitCode}\0${r.stdout.toString()}\0${r.stderr.toString()}`;
  };
  return (buildToolsMemo = hash([BUILT_PATH_DIRS.join(":"), out(["/usr/bin/make", "--version"]), out(["/usr/bin/perl", "-e", "print $^V"])].join("\0")));
};

export const PROJECTS: Record<Project["name"], Project> = {
  ripgrep: {
    name: "ripgrep",
    suite: "rg-build",
    root: RG_ROOT,
    src: () => RG_SRC,
    isSetUp: rgIsSetUp,
    setupHint: "bun scripts/rg-check.ts setup",
    cargoHome: join(RG_ROOT, "cargo"),
    cargoArgs: (tree) => ["build", "--release", "--locked", "--offline", "-j1", "--target-dir", tree],
    profile: "release",
    binary: "rg",
    header: () => `rg-build ripgrep ${RG_VERSION}: cargo build --release (stock profile, debug = 1), -j1, CARGO_INCREMENTAL=0, every compiler call to the side's compiler`,
    rootName: "$RG_ROOT",
    builtEnv: false,
    keepTree: true,
    sysReport: false,
    noResultMark: NO_RESULT_MARK,
    keyParts: () => [],
  },
  cargo: {
    name: "cargo",
    suite: "cargo-build",
    root: CARGO_SRC_ROOT,
    src: () => `cargo-${cargoPin().commit}`,
    isSetUp: cargoSrcIsSetUp,
    setupHint: "bun scripts/tools-src.ts setup cargo",
    cargoHome: CARGO_SRC_HOME,
    cargoArgs: (tree) => ["build", "--locked", "--offline", "-j1", "--features", "all-static", "--target-dir", tree],
    profile: "debug",
    binary: "cargo",
    header: () =>
      `cargo-build cargo ${cargoPin().commit.slice(0, 12)}: cargo build (dev profile) --features all-static, -j1, CARGO_INCREMENTAL=0, built environment and PATH (${BUILT_PATH_DIRS.join(":")}), every compiler call to the side's compiler`,
    rootName: "$CARGO_ROOT",
    builtEnv: true,
    keepTree: false,
    sysReport: true,
    headroom: "heavy-build",
    noResultMark: CARGO_NO_RESULT_MARK,
    keyParts: () => [cargoPin().commit, buildToolsId()],
  },
};

/** The project named on a command line; throws on another name. */
export function projectOf(name: string | undefined): Project {
  if (name !== "ripgrep" && name !== "cargo") throw new Error("--project must be ripgrep or cargo");
  return PROJECTS[name];
}

const treeOf = (p: Project) => join(p.root, "target", p.suite);
const keptOf = (p: Project) => join(p.root, "kept", p.suite);
export const binDirOf = (p: Project): string => join(p.root, "bin");
/** A project's lock: one build at a time, and no other cargo in its CARGO_HOME (scripts/cargo-smoke.ts holds ripgrep's). */
export const projectLock = (p: Project): string => join(p.root, `${p.suite}.lock`);
const lockOf = projectLock;
/** The shell script cargo runs as `RUSTC`. ripgrep's keeps lane harness-m7d's name: cargo's `.rustc_info.json` keys on its path. */
const wrapperOf = (p: Project) => join(p.root, "rustc-wrap-build.sh");
/** A project build's lock: one port build of cargo is 40-50 min at `-j1`; a lock older than this has a dead owner. */
const LOCK_MAX_HOLD_MS = 8 * 3_600_000;

let hostToolsMemo: string | undefined;
/** What links the binary and builds its C on this machine: `cc -v`, `ld -v`, the SDK version and the OS build (as the native suites' key). */
export function hostToolsId(): string {
  if (hostToolsMemo !== undefined) return hostToolsMemo;
  const out = (cmd: string[]) => {
    const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
    return `${r.exitCode}\0${r.stdout.toString()}\0${r.stderr.toString()}`;
  };
  return (hostToolsMemo = hash([out(["cc", "-v"]), out(["ld", "-v"]), out(["xcrun", "--show-sdk-version"]), out(["sw_vers"]), ...["SDKROOT", "DEVELOPER_DIR", "LIBRARY_PATH"].map((k) => `${k}=${process.env[k] ?? "<unset>"}`)].join("\0")));
}

/**
 * The state of the port's sources, for the key of a port-built binary: `HEAD:src`'s tree, and every changed or untracked file under `src/`
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
 * What the port reads besides `src/` (review harness-m7d N1), for the key of a port-built binary: every file outside `src/` that a non-test
 * module under `src/` imports, with what those import in turn (found by their import specifiers: an over-approximation, as some are
 * oracle-fixture scripts, which is safe), the config files Bun reads, the pinned LLVM tools and the oracle's rustc build, whose std the
 * port links against. The compiler's own first word is in `binKey`.
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

/** The oracle key of a project's suite: the harness's sources, the project's lock and own parts, the oracle rustc build and the host tools. */
export function projectOracleKey(p: Project): string {
  return hash([...PROJECT_BUILD_SOURCES.map((f) => hash(readFileSync(f))), p.name, ...p.keyParts(), rustcDriverHash(), hostToolsId()].join("\0"));
}

/** The key of one side's binary (see the header). */
export function binKey(p: Project, side: "oracle" | "subject", compiler: readonly string[]): string {
  const lock = readFileSync(join(p.root, p.src(), "Cargo.lock"));
  const sideParts = side === "oracle" ? [rustcDriverHash()] : [srcState(), portInputs(), programId(compiler)];
  const projectParts = p.name === "ripgrep" ? [] : [p.name, ...p.keyParts()];
  return hash([...PROJECT_BUILD_SOURCES.map((f) => hash(readFileSync(f))), hash(lock), hostToolsId(), ...projectParts, side, JSON.stringify(compiler), ...sideParts].join("\0")).slice(0, 16);
}

/** Kills the process group `pgid`, if any of it is left. */
export function killGroup(pgid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(-pgid, sig);
  } catch {
    // ESRCH: nothing is left.
  }
}

const psListing = (withEnv: boolean): string =>
  Bun.spawnSync(["/bin/ps", withEnv ? "-axwwE" : "-axww", "-o", "pid=,command="], { stdout: "pipe", stderr: "ignore" }).stdout.toString();

/**
 * Kills every process but this one whose environment holds `CPB_TREE=<tag>` as one whole entry (lib `markedPids`; see the header): what a
 * build left running. A platform binary (`/usr/bin/cc`, ...) shows no environment there, but those are in cargo's group. Lists again
 * (up to three times) while a pid exec'd between the two listings. Returns the pids it signalled.
 */
export function killBuildProcesses(tag: string, sig: NodeJS.Signals = "SIGKILL"): number[] {
  const mark = `${MARK_VAR}=${tag}`;
  const killed: number[] = [];
  for (let round = 0; round < 3; round++) {
    const plain = psListing(false);
    const { pids, unsure } = markedPids(psListing(true), plain, mark, process.pid);
    for (const pid of pids) {
      if (killed.includes(pid)) continue;
      try {
        process.kill(pid, sig);
        killed.push(pid);
      } catch {
        // Gone already.
      }
    }
    if (unsure.length === 0) break;
  }
  return killed;
}

/** How a program run by `runInGroup` ended. `interrupted`: this process got that signal while it ran, and the group was stopped. */
export interface GroupRun {
  exitCode: number | null;
  signalCode: string | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  interrupted?: NodeJS.Signals;
}

/**
 * Runs `cmd` in a process group of its own (`perl`'s `setpgrp`, then `exec`) and waits for it, reading both streams (harness-m7d re-check
 * note 5: rgtest's two `Bun.spawnSync` calls could not react to a signal, and left their child running in a directory the next run
 * reuses). On a time-out, or on SIGTERM, SIGINT or SIGHUP to this process, the group gets SIGTERM, then SIGKILL after 3 s; once the
 * program has ended, whatever is left of its group is killed, so no child holds the streams open.
 */
export async function runInGroup(cmd: string[], o: { cwd: string; env: Record<string, string>; timeoutMs: number }): Promise<GroupRun> {
  const proc = Bun.spawn(["/usr/bin/perl", "-e", "setpgrp(0, 0); exec { $ARGV[0] } @ARGV or exit 127", ...cmd], { cwd: o.cwd, env: o.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let interrupted: NodeJS.Signals | undefined;
  let timedOut = false;
  let escalate: ReturnType<typeof setTimeout> | undefined;
  const terminate = () => {
    killGroup(proc.pid, "SIGTERM");
    escalate ??= setTimeout(() => killGroup(proc.pid, "SIGKILL"), KILL_GRACE_MS);
  };
  const handlers = INTERRUPTS.map((sig) => {
    const h = () => {
      interrupted ??= sig;
      terminate();
    };
    process.on(sig, h);
    return [sig, h] as const;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    terminate();
  }, o.timeoutMs);
  const streams = Promise.all([new Response(proc.stdout).arrayBuffer(), new Response(proc.stderr).arrayBuffer()]);
  await proc.exited;
  clearTimeout(timer);
  for (const [sig, h] of handlers) process.off(sig, h);
  if (escalate !== undefined) clearTimeout(escalate);
  killGroup(proc.pid, "SIGKILL");
  const [stdout, stderr] = await streams;
  return { exitCode: proc.exitCode, signalCode: proc.signalCode === null ? null : String(proc.signalCode), stdout: Buffer.from(stdout), stderr: Buffer.from(stderr), timedOut, ...(interrupted !== undefined ? { interrupted } : {}) };
}

/** The tag of a build: its tree and a nonce, so only its own processes carry it (see the header). */
const newTag = (tree: string): string => `${tree}#${randomBytes(8).toString("hex")}`;
const nonceFile = (p: Project) => `${lockOf(p)}.nonce`;

function writeWrapper(p: Project): void {
  // Written only when it changes: cargo's `.rustc_info.json` keys on this file's mtime.
  const text = '#!/bin/sh\nexec "$CPB_BUN" "$CPB_WRAPPER_TS" "$@"\n';
  const w = wrapperOf(p);
  if (!existsSync(w) || readFileSync(w, "utf8") !== text) writeFileSync(w, text, { mode: 0o755 });
}

const indent = (s: string) => (s === "" ? [] : s.replace(/\n$/, "").split("\n").map((l) => `    ${l}`));

/** A program's run with a fixed environment, for `<binary> --version`: its exit and both streams, indented. */
function runLines(cmd: string[], cwd: string): string[] {
  const r = Bun.spawnSync(cmd, { cwd, env: { PATH: "/usr/bin:/bin", HOME: cwd }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: RUN_TIMEOUT_MS });
  return [`  exit ${r.exitedDueToTimeout ? `timed out after ${RUN_TIMEOUT_MS} ms` : (r.exitCode ?? `signal ${r.signalCode}`)}`, "  stdout:", ...indent(r.stdout.toString()), "  stderr:", ...indent(r.stderr.toString())];
}

/**
 * A completed build's report and exit (`noResult`: why the oracle's has no result difftest may keep), the signal that interrupted it, why
 * it was refused before it started, or why the watchdog stopped it (with the stop record's path).
 */
export type BuildResult = { report: string[]; exit: { code: number; unported?: string }; noResult?: string } | { interrupted: string; signal: string } | { refused: string } | { stopped: string; record: string };

/** What a check reads (tests pass fakes). */
export interface PreconditionHost {
  readers: HostReaders;
  gateRunning: () => boolean;
  underGate: () => boolean;
  exists: (p: string) => boolean;
}

export const REAL_PRECONDITION_HOST: PreconditionHost = {
  readers: REAL_HOST,
  gateRunning: () => existsSync(GATE_RUNNING),
  underGate: () => process.env.RUST_TS_GATE_RUN !== undefined,
  exists: existsSync,
};

/**
 * Why a build of `p` must not start now, or undefined (D20 "before a run starts", D15's built `PATH`): AC power, no gate running unless
 * this is the gate's, the project's headroom class. Nothing for a project with no `headroom` (ripgrep) but the built-PATH check.
 */
export async function preconditionRefusal(p: Project, host: PreconditionHost = REAL_PRECONDITION_HOST): Promise<string | undefined> {
  if (p.builtEnv) {
    const bad = builtPathRefusal(BUILT_PATH_DIRS, host.exists);
    if (bad !== undefined) return bad;
  }
  if (p.headroom === undefined) return undefined;
  const pm = await host.readers.pmset();
  const power = pm === undefined ? null : (parsePower(pm) ?? null);
  const battery = batteryRefusal(power, false);
  if (battery !== undefined) return `${p.suite}: ${battery}`;
  if (host.gateRunning() && !host.underGate()) return `${p.suite}: a gate is running (${GATE_RUNNING} exists) and this is not it: one heavy build at a time (plan-m8 D17, D20)`;
  const reading = await readHeadroom(host.readers, DATA);
  const refused = headroomRefusal(p.headroom, reading);
  return refused === undefined ? undefined : `${p.suite}: ${refused}`;
}

/** cargo's environment for one build of `p` (see the header). */
function buildEnv(p: Project, compiler: string[], log: string, tag: string): Record<string, string> {
  const base = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && (p.builtEnv ? KEPT_IN_BUILT_ENV(e[0]) : !SCRUBBED(e[0]))));
  return {
    ...base,
    ...(p.builtEnv ? { PATH: BUILT_PATH_DIRS.join(":") } : {}),
    ...rgCargoEnv(p.root, p.cargoHome),
    CARGO_TERM_COLOR: "never",
    CARGO_TERM_PROGRESS_WHEN: "never",
    RUSTC: wrapperOf(p),
    RUSTC_ICE: "0",
    RUST_BACKTRACE: "0",
    CPB_COMPILER: JSON.stringify(compiler),
    CPB_LOG: log,
    CPB_BUN: process.execPath,
    CPB_WRAPPER_TS: BUILD_RUSTC,
    [MARK_VAR]: tag,
  };
}

/** What a build reads of the host: its preconditions, and where its watchdog reads and records (tests pass fakes). */
export interface BuildHost {
  preconditions: PreconditionHost;
  watchdog: { readers: HostReaders; stopDir: string; limits?: Partial<WatchdogLimits> };
}

export const REAL_BUILD_HOST: BuildHost = { preconditions: REAL_PRECONDITION_HOST, watchdog: { readers: REAL_HOST, stopDir: watchdogStopDir(DATA) } };

/** One build of `side` with `lock` held (see the header). Writes the kept tree or deletes it, the logs and, if it completed, `bin/<side>/<key>`. */
async function buildLocked(p: Project, side: "oracle" | "subject", compiler: string[], lock: string, host: BuildHost = REAL_BUILD_HOST): Promise<BuildResult> {
  if (!p.isSetUp()) die(`${p.name} is not set up in ${p.root}; run: ${p.setupHint}`);
  const refused = await preconditionRefusal(p, host.preconditions);
  if (refused !== undefined) return { refused };
  const sysroot = oracleSysroot();
  const key = binKey(p, side, compiler);
  const tree = treeOf(p);
  const kept = keptOf(p);
  const log = join(kept, `${side}-logs`);
  // Leftovers of a build whose owner died, by its tag: this process holds the lock, so no live build has them.
  if (existsSync(nonceFile(p))) killBuildProcesses(readFileSync(nonceFile(p), "utf8").trim());
  const tag = newTag(tree);
  writeFileSync(nonceFile(p), `${tag}\n`);
  const env = buildEnv(p, compiler, log, tag);
  writeWrapper(p);
  rmSync(tree, { recursive: true, force: true });
  rmSync(log, { recursive: true, force: true });
  rmSync(join(kept, side), { recursive: true, force: true });
  mkdirSync(log, { recursive: true });
  mkdirSync(join(p.root, "target"), { recursive: true });
  const errFile = join(log, "cargo.stderr");
  const out = openSync(join(log, "cargo.stdout"), "w");
  const err = openSync(errFile, "w");
  // `setpgrp`, then `exec`: cargo leads a group of its own, which can be signalled as a whole.
  const cargo = [join(sysroot, "bin", "cargo"), ...p.cargoArgs(tree)];
  const proc = Bun.spawn(["/usr/bin/perl", "-e", "setpgrp(0, 0); exec { $ARGV[0] } @ARGV or exit 127", ...cargo], { cwd: join(p.root, p.src()), env, stdin: "ignore", stdout: out, stderr: err });
  addLockHolder(lock, proc.pid);
  let interrupted: NodeJS.Signals | undefined;
  let escalate: ReturnType<typeof setTimeout> | undefined;
  const terminate = () => {
    killGroup(proc.pid, "SIGTERM");
    escalate ??= setTimeout(() => {
      killGroup(proc.pid, "SIGKILL");
      killBuildProcesses(tag);
    }, KILL_GRACE_MS);
  };
  const handlers = INTERRUPTS.map((sig) => {
    const h = () => {
      interrupted ??= sig;
      terminate();
    };
    process.on(sig, h);
    return [sig, h] as const;
  });
  const watchdog: Watchdog | undefined =
    p.headroom === undefined
      ? undefined
      : startWatchdog({ readers: host.watchdog.readers, path: DATA, pgid: proc.pid, what: `${p.suite} ${side}`, stopDir: host.watchdog.stopDir, kill: () => terminate(), ...(host.watchdog.limits ? { limits: host.watchdog.limits } : {}) });
  const code = await proc.exited;
  watchdog?.end();
  await watchdog?.done;
  for (const [sig, h] of handlers) process.off(sig, h);
  if (escalate !== undefined) clearTimeout(escalate);
  // Whatever cargo ended by: what it left in its group, then what left the group.
  killGroup(proc.pid, "SIGKILL");
  killBuildProcesses(tag);
  closeSync(out);
  closeSync(err);
  const callFiles = readdirSync(log)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const readCall = (f: string) => JSON.parse(readFileSync(join(log, f), "utf8")) as BuildCall;
  // A wrapper killed while it wrote its record leaves half of one: only an interrupted build can have that, so it is skipped here.
  const parsed = callFiles.map((f) => {
    try {
      return readCall(f);
    } catch {
      return undefined;
    }
  });
  // A compiler killed from outside (the kernel under memory pressure sends SIGKILL; a signal to the group, SIGTERM): an interruption. A
  // crash by its own fault (SIGSEGV, SIGABRT, SIGBUS, ...) is deterministic and stays the call's 101, a crash in the report.
  const killedCall = parsed.find((c) => c?.signal !== undefined && ["SIGKILL", ...INTERRUPTS].includes(c.signal));
  if (watchdog?.stopped !== undefined || interrupted !== undefined || proc.signalCode || killedCall !== undefined) {
    rmSync(tree, { recursive: true, force: true });
    if (watchdog?.stopped !== undefined) return { stopped: watchdog.stopped.reason, record: watchdog.stopped.file };
    if (interrupted !== undefined || proc.signalCode) return { interrupted: interrupted ?? String(proc.signalCode), signal: interrupted ?? String(proc.signalCode) };
    return { interrupted: `a compiler call of ${killedCall!.crate} ended by ${killedCall!.signal}`, signal: killedCall!.signal! };
  }
  // A completed build: every record is whole, or this throws, as before.
  const calls = parsed.map((c, i) => c ?? readCall(callFiles[i]!));
  const exit = buildExit(calls.map((c) => ({ code: c.code, stderrText: readFileSync(join(log, c.stderr), "latin1") })));
  const profile = join(tree, p.profile);
  const bin = join(profile, p.binary);
  const built = existsSync(bin);
  const roots: [string, string][] = [
    [p.root, p.rootName],
    [sysroot, "$SYSROOT"],
  ];
  const report = [
    p.header(),
    `cargo exit ${code}`,
    `${p.binary} ${built ? "built" : "missing"}`,
    ...(built ? [`${p.binary} --version`, ...runLines([bin, "--version"], log)] : []),
    `compiler calls: ${calls.length}`,
    ...calls.map((c) => callLine(c, readFileSync(join(log, c.stderr)))).sort(),
    "cargo stderr:",
    ...normaliseCargoStderr(readFileSync(errFile, "latin1"), roots).map((l) => `  ${l}`),
    `cargo stdout: ${sizeHash(readFileSync(join(log, "cargo.stdout")))}`,
    ...artifactLines(profile),
    ...(p.sysReport ? sysBuildScriptLines(profile, roots) : []),
    ...(p.sysReport && built ? [`otool -L ${p.binary}:`, ...otoolLines(Bun.spawnSync(["/usr/bin/otool", "-L", bin], { stdout: "pipe", stderr: "pipe" }).stdout.toString(), roots)] : []),
  ];
  // The binary for its users, or (the port's only) why there is none: this build completed.
  const sideBin = join(binDirOf(p), side);
  mkdirSync(sideBin, { recursive: true });
  if (built || side === "subject") {
    const tmp = join(sideBin, `${key}.tmp-${process.pid}`);
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp);
    if (built) copyFileSync(bin, join(tmp, p.binary));
    const stamp: BinStamp = { key, outcome: built ? "ok" : (exit.unported ?? `no ${p.binary}: cargo exit ${code}`), builtAt: new Date().toISOString() };
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
  const noResult = side === "oracle" && !built ? `the oracle's build of ${p.binary} made no binary (cargo exit ${code})` : undefined;
  if (existsSync(tree)) {
    if (p.keepTree) renameSync(tree, join(kept, side));
    else rmSync(tree, { recursive: true, force: true });
  }
  return { report, exit, ...(noResult !== undefined ? { noResult } : {}) };
}

/**
 * Removes the key directories of a side (`sideBin`) unused for `KEY_MAX_AGE_MS` (their mtime: the last build or `touchKey`), and leftover
 * temp directories of dead builds, but never `keep` (review harness-m7d N2: another worktree's query may be running a recent one).
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
    let age: number;
    try {
      age = now - statSync(p).mtimeMs;
    } catch {
      continue;
    }
    if (dead || age > KEY_MAX_AGE_MS) {
      rmSync(p, { recursive: true, force: true });
      removed.push(d);
    }
  }
  return removed;
}

/** Marks a kept key directory as used now (harness-m7d re-check note 2), so `pruneKeys` counts its age from its last use. */
export function touchKey(dir: string, now: Date = new Date()): void {
  try {
    utimesSync(dir, now, now);
  } catch {
    // Gone (pruned or replaced in this instant): the caller's next read finds out.
  }
}

/** One side's build under the project's lock: the `run` command. A lock wait prints nothing (see the header). */
export const buildSide = (p: Project, side: "oracle" | "subject", compiler: string[], host: BuildHost = REAL_BUILD_HOST): Promise<BuildResult> =>
  withCaseLock(lockOf(p), LOCK_MAX_HOLD_MS, () => buildLocked(p, side, compiler, lockOf(p), host), () => {});

/**
 * A key directory's stamp, if the key has one; a directory appears whole (see the header), so this needs no lock. A stamp that cannot be
 * read (the key was replaced or pruned between the check and the read) is no stamp (harness-m7d re-check note 3): the caller takes the lock.
 */
export function readStamp(dir: string): BinStamp | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, "stamp.json"), "utf8")) as BinStamp;
  } catch {
    return undefined;
  }
}

/** What `ensureBinary` gives: the binary, why its key has none, the signal that interrupted its build, or why it was refused or stopped. */
export type EnsureResult = { bin: string } | { failed: string; stamped: boolean } | { interrupted: string; signal: string } | { refused: string } | { stopped: string };

/**
 * The binary of `side` built with `compiler` at the current key: for a suite whose oracle output may be cached while the build suite's is
 * too. A kept stamp is read without the lock, and the key is touched (it is in use). Without one, the lock is taken (silently) and, if the
 * stamp is still missing, the key is built, unless `build` is false (cargo-smoke never builds the port's cargo: that is cargo-build's,
 * under D20). `{ failed }`: that key's completed build made no binary (`stamped` when the port's stamp says so; an oracle build that made
 * none leaves no stamp), or (`build` false) no build is kept.
 */
export async function ensureBinary(p: Project, side: "oracle" | "subject", compiler: string[], opts: { build?: boolean } = {}): Promise<EnsureResult> {
  const key = binKey(p, side, compiler);
  const dir = join(binDirOf(p), side, key);
  let stamp = readStamp(dir);
  if (stamp === undefined) {
    if (opts.build === false) return { failed: `no ${side === "oracle" ? "oracle" : "port"}-built ${p.binary} is kept for this key (${key}); the ${p.suite} suite builds it`, stamped: false };
    const r = await withCaseLock(
      lockOf(p),
      LOCK_MAX_HOLD_MS,
      async () => {
        stamp = readStamp(dir);
        return stamp === undefined ? await buildLocked(p, side, compiler, lockOf(p)) : undefined;
      },
      () => {},
    );
    if (r !== undefined && "interrupted" in r) return { interrupted: r.interrupted, signal: r.signal };
    if (r !== undefined && "refused" in r) return { refused: r.refused };
    if (r !== undefined && "stopped" in r) return { stopped: r.stopped };
    stamp = readStamp(dir);
  }
  if (stamp === undefined) return { failed: `its build completed and made no ${p.binary}`, stamped: false };
  touchKey(dir);
  return stamp.outcome === "ok" ? { bin: join(dir, p.binary) } : { failed: stamp.outcome, stamped: true };
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

/** `--project <name>` out of `rest`; throws if it is missing or another name. */
export function takeProject(rest: readonly string[]): { project: Project; rest: string[] } {
  const i = rest.indexOf("--project");
  if (i < 0) throw new Error("--project is missing");
  return { project: projectOf(rest[i + 1]), rest: [...rest.slice(0, i), ...rest.slice(i + 2)] };
}

/** Ends this process for a build result that is not a report (see the header). */
export function exitWithoutReport(p: Project, r: Exclude<BuildResult, { report: string[] }>): never {
  if ("interrupted" in r) {
    process.stderr.write(`${p.noResultMark}the build was interrupted (${r.interrupted})\n`);
    process.exit(128 + signalNumber(r.signal));
  }
  if ("refused" in r) process.stderr.write(`${p.noResultMark}the build was not started: ${r.refused}\n`);
  else process.stderr.write(`${p.noResultMark}the build was stopped: ${r.stopped} (record ${r.record})\n`);
  process.exit(1);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const usage = "usage: bun scripts/cargo-project-build.ts run --project ripgrep|cargo --side oracle|subject -- <compiler argv...> | check --project ripgrep|cargo";
  if (argv[0] === "check") {
    let p: Project;
    try {
      p = takeProject(argv.slice(1)).project;
    } catch (e) {
      console.error(`ERROR: cargo-project-build: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(2);
    }
    const why = await preconditionRefusal(p);
    if (why !== undefined) {
      console.log(`ERROR: ${why}`);
      process.exit(1);
    }
    console.log(`ok   ${p.suite}: may start now${p.headroom ? ` (plan-m8 D20 ${p.headroom}: ${HEADROOM_MINIMUMS[p.headroom].freeGiB} GiB free)` : ""}`);
    process.exit(0);
  }
  if (argv[0] !== "run") {
    console.error(usage);
    process.exit(2);
  }
  let a: ReturnType<typeof parseSideArgs>;
  let p: Project;
  try {
    a = parseSideArgs(argv.slice(1));
    const t = takeProject(a.rest);
    p = t.project;
    if (t.rest.length) throw new Error(`unknown arguments: ${t.rest.join(" ")}`);
  } catch (e) {
    console.error(`ERROR: cargo-project-build: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  const r = await buildSide(p, a.side, a.compiler);
  if (!("report" in r)) exitWithoutReport(p, r);
  const b = Buffer.from(r.report.join("\n") + "\n", "latin1");
  for (let at = 0; at < b.length; ) at += writeSync(1, b, at);
  if (r.exit.unported !== undefined) process.stderr.write(`${r.exit.unported}\n`);
  if (r.noResult !== undefined) process.stderr.write(`${p.noResultMark}${r.noResult}\n`);
  process.exit(r.exit.code);
}
