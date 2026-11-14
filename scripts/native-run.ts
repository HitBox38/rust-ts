// The command of both sides of the native suites (`native-hello`, `run-pass-native`, `run-fail-native`; harness/suites.ts, plan-m7 D12,
// §1g; lane harness-m7b): build a program with a compiler, linking for the host with `cc` as rustc does (D1), then run it, and print
// what both did. difftest compares stdout, stderr (thread ids masked) and the exit code.
//
//   bun scripts/native-run.ts --dir <case dir> --side oracle|subject [--runs 1|2] [--run-timeout <ms>] [--lib-path <dir>]...
//     [--arg <a>]... [--env K=V]... [--unset <K>]... [--expect <mode>] [--error-pattern <p>]... [--regex-error-pattern <p>]... [--check-stdout]
//     -- <compiler argv...>
//
// - `<case dir>` must be an absolute `<...>/native/<suite>/<16 hex digits>` (`nativeDirRefusal`): `<case dir>/work`, `/tmp` and `/home`
//   are emptied. **Both sides use that one path, one at a time under the lock `<case dir>/work.lock`** (as scripts/ir-run.ts), as the
//   path is in the program: `-Crpath` writes the way from the binary to the sysroot, a panic names `argv[0]`, and a program may print
//   its cwd. The compiler and the program are holders of the lock (scripts/lib/case-lock.ts `addLockHolder`).
// - The compiler runs with this process's cwd, environment and stdout/stderr (inherited: its diagnostics pass through byte for byte),
//   with `-o <case dir>/work/a` appended (compiletest's `make_exe_name`, `<output base>/a`). One that fails ends the run with its exit
//   code: difftest compares it, and the port's `unported` (70) is UNPORTED. One that exits 0 and writes no `a` prints
//   `native-run: no program` and exits 0.
// - **The program**, as runtest.rs `exec_compiled_test_general` runs it, made safe:
//   - `argv` is `<case dir>/work/a` and the `--arg`s (`run-flags`); cwd `<case dir>/work` (`output_base_dir`); stdin empty.
//   - Environment: **not inherited.** `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, `HOME=<case dir>/home`, `TMPDIR` and `RUST_TEST_TMPDIR`
//     `=<case dir>/tmp`, with `--libtest` `RUST_TEST_THREADS=1` (`programEnv`), the dylib
//     path compiletest's `compose_and_run` sets (`add_dylib_path`: the `--lib-path`s, then `<case dir>/work/auxiliary`, as
//     `DYLD_LIBRARY_PATH` on macOS, `LD_LIBRARY_PATH` elsewhere), then each `--env` (`exec-env`), then each `--unset` removed
//     (`unset-exec-env`), in compiletest's order. So `RUST_BACKTRACE` and the caller's variables never reach it.
//   - Under `sandbox-exec` (macOS), the `DYLD_*` variables set by `/usr/bin/env` inside it (SIP removes them on the way through `perl`
//     and `sandbox-exec`): **no network** (`(deny network*)`, localhost included) and no file writes outside `<case dir>` and
//     `/dev`. In its own process group (`perl`'s `setpgrp`, then `exec`), so a timeout kills what it started too, and that group is
//     killed after it ends; then every process left with this case's `HOME` in its environment (`killEscaped`: a `setsid()` child). A
//     descendant that both leaves the group and clears or changes its environment survives, still sandboxed.
//   - A limit of `--run-timeout` ms (default 30 s) per run.
// - Then, on stdout: `native-run: exit <code>` (or `signal <name>`, or `timed out after <ms> ms`); with `--expect`, compiletest's verdict
//   on that run (`compiletestVerdict`); `native-run: program stdout follows`, then the program's stdout as it wrote it. On stderr:
//   `native-run: program stderr follows`, then its stderr with each `stack backtrace:` block cut (`cutBacktraces`, plan-m7 §1g: frames
//   change with inlining and with the unwinder). No other line of its own: what it prints is compared.
// - `--runs 2` (the oracle's side): the program runs twice. If the two runs differ, after the thread ids are masked and the backtraces
//   cut (exit, stdout or stderr), or either timed out, the first run's output is printed and then, last on stderr,
//   `native-run: unstable: <why>`, which difftest's `UNSTABLE_ORACLE_PATTERNS` reads: that case is UNSTABLE, never cached, never MATCH.
// - Exit code: the compiler's when it fails, else 0 (the program's result is in the output).
// - SIGTERM/SIGINT (difftest's timeout) are passed on to the compiler or the program's group while one runs; at any other time they end
//   this run at once with 128 + the signal, `work` and the lock removed (as scripts/ir-run.ts).
// Only a malformed command line exits 2.
import { existsSync, mkdirSync, realpathSync, rmSync, writeSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import { addLockHolder, releaseHeldLocks, withCaseLock } from "./lib/case-lock.ts";
import { maskProgramOutput, maskThreadId } from "./lib/unstable.ts";

/** Past every limit a suite sets (its oracle's 300 s, retried with the retry factor), and a dead owner's lock goes sooner. */
const LOCK_MAX_HOLD_MS = 2 * 3_600_000;
export const DEFAULT_RUN_TIMEOUT_MS = 30_000;
/** The program's own name: compiletest's `make_exe_name` on a host with no exe suffix. */
export const PROGRAM = "a";
/** The marker difftest reads on the oracle's stderr (scripts/lib/unstable.ts `UNSTABLE_ORACLE_PATTERNS`). */
export const UNSTABLE_MARK = "native-run: unstable: ";
/** compiletest's pass/fail modes of a test that runs (common.rs `PassFailMode`). */
export const RUN_MODES = ["run-pass", "run-fail", "run-crash", "run-fail-or-crash"] as const;
export type RunMode = (typeof RUN_MODES)[number];

export interface NativeRunArgs {
  dir: string;
  side: "oracle" | "subject";
  runs: number;
  runTimeoutMs: number;
  libPaths: string[];
  args: string[];
  env: [string, string][];
  unset: string[];
  expect?: RunMode;
  errorPatterns: string[];
  regexErrorPatterns: string[];
  checkStdout: boolean;
  /** compiletest's `should-fail` (`--should-fail`): the test passes when one of its checks fails. */
  shouldFail: boolean;
  /** The program was built with `--test` (`--libtest`): it runs with `RUST_TEST_THREADS=1`. */
  libtest: boolean;
  compiler: string[];
}

/** Parses the command line (see the header); throws on a malformed one. */
export function parseNativeRunArgs(argv: string[]): NativeRunArgs {
  const a: Partial<NativeRunArgs> = { runs: 1, runTimeoutMs: DEFAULT_RUN_TIMEOUT_MS, libPaths: [], args: [], env: [], unset: [], errorPatterns: [], regexErrorPatterns: [], checkStdout: false, shouldFail: false, libtest: false };
  let compiler: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const o = argv[i]!;
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`native-run: ${o} needs a value`);
      return v;
    };
    if (o === "--") {
      compiler = argv.slice(i + 1);
      break;
    } else if (o === "--dir") a.dir = val();
    else if (o === "--side") {
      const v = val();
      if (v !== "oracle" && v !== "subject") throw new Error(`native-run: --side must be oracle or subject, not ${v}`);
      a.side = v;
    } else if (o === "--runs") {
      const v = val();
      if (v !== "1" && v !== "2") throw new Error(`native-run: --runs must be 1 or 2, not ${v}`);
      a.runs = Number(v);
    } else if (o === "--run-timeout") {
      const v = val();
      if (!/^[1-9]\d*$/.test(v)) throw new Error(`native-run: --run-timeout must be a positive number of ms, not ${v}`);
      a.runTimeoutMs = Number(v);
    } else if (o === "--lib-path") a.libPaths!.push(val());
    else if (o === "--arg") a.args!.push(val());
    else if (o === "--env") {
      const v = val();
      const eq = v.indexOf("=");
      if (eq <= 0) throw new Error(`native-run: --env needs K=V, not ${v}`);
      a.env!.push([v.slice(0, eq), v.slice(eq + 1)]);
    } else if (o === "--unset") a.unset!.push(val());
    else if (o === "--expect") {
      const v = val();
      if (!(RUN_MODES as readonly string[]).includes(v)) throw new Error(`native-run: --expect must be one of ${RUN_MODES.join(", ")}, not ${v}`);
      a.expect = v as RunMode;
    } else if (o === "--error-pattern") a.errorPatterns!.push(val());
    else if (o === "--regex-error-pattern") a.regexErrorPatterns!.push(val());
    else if (o === "--check-stdout") a.checkStdout = true;
    else if (o === "--should-fail") a.shouldFail = true;
    else if (o === "--libtest") a.libtest = true;
    else throw new Error(`native-run: unknown option ${o}`);
  }
  if (compiler === undefined) throw new Error("native-run: missing `--` before the compiler command");
  if (compiler.length === 0) throw new Error("native-run: no compiler command");
  if (a.dir === undefined || a.side === undefined) throw new Error("native-run: --dir and --side are required");
  const refusal = nativeDirRefusal(a.dir);
  if (refusal !== undefined) throw new Error(refusal);
  return { ...(a as NativeRunArgs), compiler };
}

/** Why `<dir>/work`, `/tmp` and `/home` may not be emptied, or `undefined`: `dir` must be an absolute `<...>/native/<suite>/<16 hex digits>`. */
export function nativeDirRefusal(dir: string): string | undefined {
  const parts = dir.split(sep);
  if (!isAbsolute(dir) || parts.includes("..") || parts.includes(".") || parts.at(-3) !== "native" || !/^[a-z0-9-]+$/.test(parts.at(-2) ?? "") || !/^[0-9a-f]{16}$/.test(parts.at(-1) ?? "")) {
    return `native-run: --dir must be an absolute <...>/native/<suite>/<16 hex digits>, not ${dir}`;
  }
  // The sandbox profile quotes it, and `/usr/bin/env` would read a program path with `=` in it as a variable.
  if (/["\\\n=]/.test(dir)) return `native-run: --dir must not hold a quote, a backslash, a newline or \`=\`: ${dir}`;
  return undefined;
}

/**
 * The sandbox profile of a program run in `dir` (its real path): everything allowed but the network and writes outside `dir` and `/dev`.
 * `sandbox-exec`'s SBPL: `network*` covers inbound, outbound and binding, localhost and unix sockets included.
 */
export const sandboxProfile = (dir: string): string =>
  `(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* (subpath "${dir}") (subpath "/dev"))`;

/**
 * The program's environment (see the header), in compiletest's order: the fixed part, the dylib path, `exec-env`, then `unset-exec-env`.
 * The fixed part has `RUST_TEST_TMPDIR`, which bootstrap gives compiletest and so every test program (review harness-m7b N3:
 * tests/ui/std/stdio-from.rs reads it), as `<case dir>/tmp`; and for a libtest program `RUST_TEST_THREADS=1` (root's decision for review
 * harness-m7b F1: one test at a time, so the `test x ... ok` lines come in a fixed order; compiletest checks only a run test's exit and error
 * patterns, so the order is the harness's to fix). A test's own `exec-env` still wins over both.
 */
export function programEnv(a: Pick<NativeRunArgs, "dir" | "libPaths" | "env" | "unset" | "libtest">, platform: string = process.platform): Record<string, string> {
  const env: Record<string, string> = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: join(a.dir, "home"), TMPDIR: join(a.dir, "tmp"), RUST_TEST_TMPDIR: join(a.dir, "tmp") };
  if (a.libtest) env.RUST_TEST_THREADS = "1";
  // util.rs `dylib_env_var`, and `add_dylib_path` (lib path, then the aux dir, before an inherited value, of which there is none).
  env[platform === "darwin" ? "DYLD_LIBRARY_PATH" : platform === "win32" ? "PATH" : "LD_LIBRARY_PATH"] = [...a.libPaths, join(a.dir, "work", "auxiliary")].join(platform === "win32" ? ";" : ":");
  for (const [k, v] of a.env) env[k] = v;
  for (const k of a.unset) delete env[k];
  return env;
}

/**
 * The program's stderr with each `stack backtrace:` block cut (plan-m7 §1g): the line stays, as `stack backtrace: <cut>`, and the lines
 * after it that start with white space (the frames, `   0: <symbol>`, and their `             at <path>`) go. Nothing else changes.
 */
export function cutBacktraces(stderr: string): string {
  const lines = stderr.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== "stack backtrace:") {
      out.push(lines[i]!);
      continue;
    }
    out.push("stack backtrace: <cut>");
    while (i + 1 < lines.length && /^\s/.test(lines[i + 1]!)) i++;
  }
  return out.join("\n");
}

/** How a run ended. */
export type RunEnd = { exit: number } | { signal: string } | { timedOut: number };

export const describeEnd = (e: RunEnd): string => ("exit" in e ? `exit ${e.exit}` : "signal" in e ? `signal ${e.signal}` : `timed out after ${e.timedOut} ms`);

/**
 * runtest/ui.rs `run_ui_test`'s checks of a run, as lines: its `RunResult` (`Pass` on success, `Fail` on an exit code of 1 to 127, else
 * `Crash`) against the mode (`run-fail` may not crash: this host's target unwinds, so `can_unwind()` holds), then `check_all_error_patterns`
 * on `get_output` (stderr, or stdout then stderr with `check-stdout`). A regex that does not compile in JS is said to be unchecked, never
 * guessed. A timed-out run has no result: compiletest would have waited.
 */
export function compiletestVerdict(a: Pick<NativeRunArgs, "expect" | "errorPatterns" | "regexErrorPatterns" | "checkStdout" | "shouldFail">, end: RunEnd, stdout: string, stderr: string): string[] {
  if (a.expect === undefined) return [];
  if ("timedOut" in end) return [`native-run: compiletest ${a.expect}: no result (timed out)`];
  const lines = checkLines(a, end, stdout, stderr);
  if (!a.shouldFail) return lines;
  // `should-fail` (review harness-m7b N5): compiletest runs the test as `ShouldPanic::Yes`, so it passes when any check above fails (each
  // failure is a panic in runtest), and fails when every check passes. The lines above stay as they are.
  const failed = lines.filter((l) => l.includes(": not met (") || l.endsWith(": not found"));
  return [...lines, `native-run: compiletest should-fail: ${failed.length > 0 ? "met (a check failed)" : "not met (every check passed)"}`];
}

/** `compiletestVerdict`'s lines before `should-fail`. */
function checkLines(a: Pick<NativeRunArgs, "expect" | "errorPatterns" | "regexErrorPatterns" | "checkStdout">, end: RunEnd, stdout: string, stderr: string): string[] {
  if (a.expect === undefined || "timedOut" in end) return [];
  const result = "exit" in end && end.exit === 0 ? "Pass" : "exit" in end && end.exit >= 1 && end.exit <= 127 ? "Fail" : "Crash";
  const ok = a.expect === "run-pass" ? result === "Pass" : a.expect === "run-fail" ? result === "Fail" : a.expect === "run-crash" ? result === "Crash" : result !== "Pass";
  const lines = [`native-run: compiletest ${a.expect}: ${ok ? "met" : "not met"} (${result})`];

  const output = a.checkStdout ? stdout + stderr : stderr;
  for (const p of a.errorPatterns) lines.push(`native-run: compiletest error-pattern '${p.trim()}': ${output.includes(p.trim()) ? "found" : "not found"}`);
  // `check_regex_error_patterns` trims too (`pattern.trim()`), before `Regex::new`.
  for (const raw of a.regexErrorPatterns) {
    const p = raw.trim();
    let re: RegExp | undefined;
    try {
      re = new RegExp(p);
    } catch {
      re = undefined;
    }
    lines.push(`native-run: compiletest regex-error-pattern '${p}': ${re === undefined ? "unchecked (not a JS regex)" : re.test(output) ? "found" : "not found"}`);
  }
  return lines;
}

const SIGNALS: Record<string, number> = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

/** What a signal is passed on to while it runs, and `work` while this run holds the lock and may have written it. */
const running: { compiler?: Bun.Subprocess; group?: number; work?: string } = {};

/** Kills the process group `pgid`, if any of it is left. */
function killGroup(pgid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(-pgid, sig);
  } catch {
    // ESRCH: nothing is left.
  }
}

function onSignal(sig: "SIGTERM" | "SIGINT"): void {
  if (running.compiler !== undefined) {
    running.compiler.kill(sig);
    return;
  }
  if (running.group !== undefined) killGroup(running.group, "SIGKILL");
  if (running.work !== undefined) rmSync(running.work, { recursive: true, force: true });
  releaseHeldLocks();
  process.exit(128 + SIGNALS[sig]!);
}

/** Every byte of `b` to `fd`: a large write to a pipe can stop short. */
function writeAll(fd: number, b: Buffer | string): void {
  const buf = typeof b === "string" ? Buffer.from(b) : b;
  for (let at = 0; at < buf.length; ) at += writeSync(fd, buf, at);
}

/** Runs the compiler with inherited stdio, as a holder of `lock`; its exit code (128 + signal if it was killed). */
async function compile(cmd: string[], lock: string): Promise<number> {
  const p = Bun.spawn(cmd, { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  running.compiler = p;
  try {
    addLockHolder(lock, p.pid);
    const code = await p.exited;
    return p.signalCode ? 128 + (SIGNALS[p.signalCode] ?? 0) : code;
  } finally {
    running.compiler = undefined;
  }
}

interface RunOutput {
  end: RunEnd;
  stdout: Buffer;
  stderr: Buffer;
}

/** One run of the program (see the header). */
async function runProgram(a: NativeRunArgs, exe: string, lock: string): Promise<RunOutput> {
  const work = join(a.dir, "work");
  for (const d of ["tmp", "home"]) {
    rmSync(join(a.dir, d), { recursive: true, force: true });
    mkdirSync(join(a.dir, d), { recursive: true });
  }
  if (process.platform !== "darwin") throw new Error("native-run: no sandbox for this platform (macOS's sandbox-exec only)");
  const env = programEnv(a);
  // SIP: a protected binary (`perl`, `sandbox-exec`, `/usr/bin/env`, all in /usr/bin) starts with every `DYLD_*` variable removed, so
  // those are set last, by `env`, whose exec of the program (not protected) keeps them. `env` reads its `K=V` words up to the first
  // without `=`: the program's path, which has none (`nativeDirRefusal`).
  const dyld = Object.keys(env).filter((k) => k.startsWith("DYLD_"));
  const sandboxed = ["/usr/bin/sandbox-exec", "-p", sandboxProfile(realpathSync(a.dir)), "/usr/bin/env", ...dyld.map((k) => `${k}=${env[k]}`), exe, ...a.args];
  for (const k of dyld) delete env[k];
  // `setpgrp`, then `exec`: the program (sandbox-exec and env exec it) leads a group of its own, which can be killed as a whole.
  const cmd = ["/usr/bin/perl", "-e", "setpgrp(0, 0); exec { $ARGV[0] } @ARGV or exit 127", ...sandboxed];
  const p = Bun.spawn(cmd, { cwd: work, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  running.group = p.pid;
  addLockHolder(lock, p.pid);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup(p.pid, "SIGKILL");
  }, a.runTimeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).arrayBuffer(), new Response(p.stderr).arrayBuffer(), p.exited]);
    const end: RunEnd = timedOut ? { timedOut: a.runTimeoutMs } : p.signalCode ? { signal: String(p.signalCode) } : { exit: code };
    return { end, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) };
  } finally {
    clearTimeout(timer);
    // What the program left running in its group, then what left the group (review harness-m7b N1).
    killGroup(p.pid, "SIGKILL");
    killEscaped(a.dir);
    running.group = undefined;
  }
}

/**
 * Kills every process whose environment holds this case's `HOME=<case dir>/home` (`ps -E`): what the program started and left behind
 * outside its group, such as a child that called `setsid()` (review harness-m7b N1). Every descendant inherits that variable, which is
 * unique to the case, unless it cleared or changed its environment: **such a process can survive the run**, sandboxed (no network, writes
 * only under the case directory). No run-mode test at the pin calls `setsid`, `setpgid`, `process_group` or `daemon` (the review's grep).
 */
export function killEscaped(dir: string): number[] {
  const mark = `HOME=${join(dir, "home")}`;
  const r = Bun.spawnSync(["/bin/ps", "-axwwE", "-o", "pid=,command="], { stdout: "pipe", stderr: "ignore" });
  const killed: number[] = [];
  for (const line of r.stdout.toString().split("\n")) {
    const m = /^\s*(\d+) (.*)$/.exec(line);
    if (!m || Number(m[1]) === process.pid) continue;
    // As an environment entry: a word of its own, not inside a longer value.
    if (!` ${m[2]} `.includes(` ${mark} `)) continue;
    try {
      process.kill(Number(m[1]), "SIGKILL");
      killed.push(Number(m[1]));
    } catch {
      // Gone already.
    }
  }
  return killed;
}

/** Why two runs of the oracle's program are not the same result, or `undefined`. */
export function runsDiffer(x: { end: RunEnd; stdout: string; stderr: string }, y: { end: RunEnd; stdout: string; stderr: string }): string | undefined {
  if ("timedOut" in x.end || "timedOut" in y.end) return "a run timed out";
  if (describeEnd(x.end) !== describeEnd(y.end)) return `the two runs ended differently (${describeEnd(x.end)}, ${describeEnd(y.end)})`;
  // difftest's masks for these suites (`Suite.maskProgramOutput`), and the backtrace cut this wrapper prints.
  if (maskProgramOutput(x.stdout) !== maskProgramOutput(y.stdout)) return "the two runs' stdout differ";
  if (maskProgramOutput(maskThreadId(cutBacktraces(x.stderr))) !== maskProgramOutput(maskThreadId(cutBacktraces(y.stderr)))) return "the two runs' stderr differ";
  return undefined;
}

export async function nativeRun(a: NativeRunArgs): Promise<number> {
  mkdirSync(a.dir, { recursive: true });
  const onTerm = () => onSignal("SIGTERM");
  const onInt = () => onSignal("SIGINT");
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInt);
  try {
    const lock = join(a.dir, "work.lock");
    // No note on waiting: what this prints is compared.
    return await withCaseLock(lock, LOCK_MAX_HOLD_MS, () => nativeRunLocked(a, lock), () => {}, 50);
  } finally {
    process.off("SIGTERM", onTerm);
    process.off("SIGINT", onInt);
  }
}

async function nativeRunLocked(a: NativeRunArgs, lock: string): Promise<number> {
  const work = join(a.dir, "work");
  running.work = work;
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    const exe = join(work, PROGRAM);
    const code = await compile([...a.compiler, "-o", exe], lock);
    if (code !== 0) return code;
    if (!existsSync(exe)) {
      writeAll(1, "native-run: no program\n");
      return 0;
    }
    const first = await runProgram(a, exe, lock);
    let unstable: string | undefined;
    if (a.runs === 2) {
      const second = await runProgram(a, exe, lock);
      const text = (r: RunOutput) => ({ end: r.end, stdout: r.stdout.toString("latin1"), stderr: r.stderr.toString("latin1") });
      unstable = runsDiffer(text(first), text(second));
    }
    const stdout = first.stdout.toString("latin1");
    const stderr = first.stderr.toString("latin1");
    writeAll(1, [`native-run: ${describeEnd(first.end)}`, ...compiletestVerdict(a, first.end, first.stdout.toString(), first.stderr.toString()), "native-run: program stdout follows", ""].join("\n"));
    writeAll(1, Buffer.from(stdout, "latin1"));
    writeAll(2, "native-run: program stderr follows\n");
    writeAll(2, Buffer.from(cutBacktraces(stderr), "latin1"));
    if (unstable !== undefined) writeAll(2, `${stderr.length > 0 && !stderr.endsWith("\n") ? "\n" : ""}${UNSTABLE_MARK}${unstable}\n`);
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
    running.work = undefined;
  }
}

if (import.meta.main) {
  let a: NativeRunArgs;
  try {
    a = parseNativeRunArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  process.exit(await nativeRun(a));
}
