// rust-ts glue (not an upstream mirror): the stack the compiler runs on.
//
// Upstream runs the whole compiler on a spawned thread of `init_stack_size()` bytes (`RUST_MIN_STACK`,
// default `DEFAULT_STACK_SIZE` = 17 MiB; rustc_interface/src/util.rs:147, :175), and has no recursion
// guard in the parser: nesting deep enough to exhaust that stack kills rustc with SIGSEGV/SIGBUS
// (signal_handler.rs). rust-ts runs on the JS main thread, whose usable stack is fixed when the VM
// starts: JSC limits itself to `maxPerThreadStackUsage` within the stack size it derives from
// `RLIMIT_STACK`. So, before anything else, src/rust_ts/main.ts calls `ensure_stack`, which re-execs
// the same process (same raw argv, same pid) with a raised `RLIMIT_STACK` and
// `BUN_JSC_maxPerThreadStackUsage`, sized from the same `RUST_MIN_STACK` rule.
//
// The environment is output: `env!`, `option_env!`, a proc macro's `std::env` and Miri's `vars()` show it. So `ensure_stack`
// also leaves the process with exactly the environment it was started with, in its order, as the oracle has it:
// - C's `environ` (what a proc-macro dylib reads, and what src/std/env.ts reads for the port): the re-exec carries it byte
//   for byte, and the two variables the re-exec needs are removed on arrival. See `reexec_with_stack`.
// - `process.env` (what the compiler's own settings read): made to follow `environ`, which removes what Bun's dotenv
//   loaded from the cwd. See `settle_environment`.
//
// PORT: JS frames are larger than rustc's, so the JS stack is `JS_STACK_PER_RUST_BYTE` times the Rust
// thread size (measured, see docs/handoff/fix-parser.md), so that rust-ts reaches at least rustc's
// nesting depth on the same input. It is capped by what the host gives the main thread: on macOS the
// main thread's stack is the binary's `LC_MAIN` stacksize (Bun: 18 MiB) whatever the rlimit, so
// rust-ts stops earlier than rustc only for nestings close to rustc's own limit; on Linux the main
// stack grows up to `RLIMIT_STACK`. Windows: no re-exec (the default stack applies).
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { CString, dlopen, FFIType, type Pointer, ptr, read } from "bun:ffi";
import { environ_entries, type OsString, process_raw_argv, remove_var, set_var, var_os, vars_os } from "../std/env.ts";

/** `rustc_session::config::DEFAULT_STACK_SIZE` (config.rs:57); stack.test.ts checks it against config.ts. */
export const DEFAULT_STACK_SIZE = 17 * 1024 * 1024;

/** JS stack bytes per byte of rustc thread stack. */
export const JS_STACK_PER_RUST_BYTE = 1.5;

/** Floor for the JS stack (the runtime itself needs some stack whatever `RUST_MIN_STACK` says). */
const MIN_JS_STACK = 2 * 1024 * 1024;

/** JSC reads this from `environ` when the VM starts, which is why the re-exec'd process must start with it set. */
const JSC_STACK_VAR = "BUN_JSC_maxPerThreadStackUsage";

/**
 * Set only in the re-exec'd process and removed on arrival. It holds the pid, which `exec` keeps, so a caller's own variable,
 * or one left in a child's environment, is not taken for it: a same-named variable would have to name this pid in advance.
 */
const reexec_marker = (): string => `RUST_TS_REEXEC_${process.pid}`;

/** Clears the shell's and the caller's environment, then sets the one it is given, in order. The shell cannot do that itself. */
const ENV_PROGRAM = "/usr/bin/env";

/** Room kept free between JSC's limit and the end of the mapped stack (native frames, guard). */
const MARGIN = 1024 * 1024;

const RLIMIT_STACK = 3; // same value on macOS and Linux

/** `init_stack_size`'s value for `RUST_MIN_STACK`, or the default when it is unset or invalid (the
 *  driver reports an invalid value itself, later, exactly like rustc). */
export function rust_thread_stack_size(env_value: string | undefined): number {
  if (env_value !== undefined && env_value.trim().length !== 0) {
    const s = env_value.trim();
    if (/^\+?[0-9]+$/.test(s)) {
      const v = Number(s.replace(/^\+/, ""));
      if (Number.isSafeInteger(v)) return v;
    }
  }
  return DEFAULT_STACK_SIZE;
}

/** The `LC_MAIN` stacksize of a 64-bit Mach-O executable (0 = none: the rlimit applies). */
function macho_main_stacksize(path: string): number | undefined {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return undefined;
  }
  try {
    const head = new Uint8Array(32);
    if (readSync(fd, head, 0, 32, 0) !== 32) return undefined;
    const dv = new DataView(head.buffer);
    if (dv.getUint32(0, true) !== 0xfeedfacf) return undefined; // MH_MAGIC_64 (fat binaries: not handled)
    const sizeofcmds = dv.getUint32(20, true);
    const cmds = new Uint8Array(sizeofcmds);
    if (readSync(fd, cmds, 0, sizeofcmds, 32) !== sizeofcmds) return undefined;
    const cv = new DataView(cmds.buffer);
    for (let off = 0; off + 8 <= sizeofcmds; ) {
      const cmd = cv.getUint32(off, true);
      const cmdsize = cv.getUint32(off + 4, true);
      if (cmd === 0x80000028) return Number(cv.getBigUint64(off + 16, true)); // LC_MAIN: entryoff, stacksize
      if (cmdsize === 0) break;
      off += cmdsize;
    }
    return 0;
  } finally {
    closeSync(fd);
  }
}

/**
 * `env` as `reexec_with_stack` runs it can only carry entries that are a unique `name=value` with a non-empty name: it would run
 * an entry with no `=` as the program, it refuses an empty name, and it folds a repeated name into one. A caller's own
 * `JSC_STACK_VAR` cannot be carried, since JSC must see ours and the caller's must come back at its position. None of these
 * can be put right on arrival short of rewriting `environ`, so such a process stays on the default stack: its environment is
 * still exact, and a nesting too deep for that stack dies by signal, where a wrong environment would have been silent.
 */
function env_can_carry(entries: readonly OsString[]): boolean {
  const names = new Set<string>();
  const latin1 = new TextDecoder("latin1");
  for (const entry of entries) {
    const eq = entry.indexOf(0x3d);
    if (eq <= 0) return false;
    const name = latin1.decode(entry.subarray(0, eq));
    if (names.has(name) || name === JSC_STACK_VAR) return false;
    names.add(name);
  }
  return true;
}

/**
 * Re-execs this process with a stack sized for the compiler (see the file comment). Returns only when no re-exec is needed or
 * possible, with nothing changed: a failed `execve` costs only the larger stack.
 *
 * PORT: the rlimit is raised by `/bin/sh -c 'ulimit -S -s <kib>; ...'`: XNU refuses `setrlimit(RLIMIT_STACK)` (EINVAL) in a process
 * with a custom `LC_MAIN` stack, as Bun is. The shell must not touch the environment, and on its way to `exec` it would: bash
 * sorts it, adds `PWD`, `SHLVL` and `_`, acts on `SHELLOPTS`, `IFS`, `OPTIND`, and SIP strips `DYLD_*` from it. So:
 *
 *     execve("/bin/sh", [sh, -c, script, sh, <entries>, <execPath>, <argv...>], [])
 *     script: if ulimit -S -s N; then set -- JSC_STACK_VAR=M "$@"; fi; exec /usr/bin/env -i MARKER=1 "$@"
 *
 * The shell starts with an empty environment, so it reads nothing, and holds the caller's entries only as positional
 * parameters, which it passes on byte for byte (`"$@"`, every byte value checked in stack.test.ts). `env -i` then sets them in
 * order and execs Bun. The marker comes first, so an entry starting with `-` is not taken for an option of `env`. On arrival
 * `environ` is `MARKER, [JSC_STACK_VAR,] <entries>`, and `unsetenv` of the first two leaves exactly the entries. `JSC_STACK_VAR` is
 * gone before any compiler code runs, so no read of the environment can show the stack limit. The raised `RLIMIT_STACK` is not
 * in the environment and stays: a proc macro calling `getrlimit`, or a child it spawns, sees it where the oracle's sees the default,
 * and XNU refuses to lower it here. That is the one trace of the re-exec left that a proc macro can read.
 *
 * An `execPath` holding `=` stays on the default stack too: `env` would take it for an entry.
 */
function reexec_with_stack(marker: string, entries: readonly OsString[]): void {
  const want = Math.max(Math.ceil(rust_thread_stack_size(process.env.RUST_MIN_STACK) * JS_STACK_PER_RUST_BYTE), MIN_JS_STACK);

  const linux = process.platform === "linux";
  const libc = dlopen(linux ? "libc.so.6" : "libSystem.B.dylib", {
    getrlimit: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
    execve: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  });
  const rl = new BigUint64Array(2); // struct rlimit { rlim_t rlim_cur, rlim_max }
  if (libc.symbols.getrlimit(RLIMIT_STACK, ptr(rl)) !== 0) return;
  // RLIM_INFINITY is all ones on Linux and 2^63 - 1 on macOS: both exceed any size used here.
  const hard = rl[1]! > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(rl[1]!);
  // The stack the main thread really has: Linux grows it up to the rlimit; macOS maps `LC_MAIN`'s
  // stacksize when the binary sets one (else the rlimit).
  let mapped = hard;
  if (!linux) {
    const lc_main = macho_main_stacksize(process.execPath);
    if (lc_main === undefined) return;
    if (lc_main !== 0) mapped = lc_main;
  }
  const js_stack = Math.min(want, mapped - MARGIN);
  if (js_stack <= 0) return;
  // JSC sizes the main thread's stack from RLIMIT_STACK (soft): at least `js_stack + MARGIN`.
  const soft_kib = Math.min(Math.ceil((js_stack + MARGIN) / 1024), Math.floor(hard / 1024));

  const argv = process_raw_argv();
  if (argv === undefined || argv.length === 0) return;
  if (!env_can_carry(entries)) return;
  if (process.execPath.includes("=") || !existsSync(ENV_PROGRAM)) return;

  const cstr = (s: string | Uint8Array): Uint8Array => {
    const b = typeof s === "string" ? new TextEncoder().encode(s) : s;
    const out = new Uint8Array(b.length + 1);
    out.set(b);
    return out;
  };
  const script = `if ulimit -S -s ${soft_kib} 2>/dev/null; then set -- ${JSC_STACK_VAR}=${js_stack} "$@"; fi; exec ${ENV_PROGRAM} -i ${marker}=1 "$@"`;
  const args = ["sh", "-c", script, "sh"]
    .map(cstr)
    .concat(entries.map(cstr), [cstr(process.execPath)], argv.slice(1).map(cstr));
  const vec = new BigUint64Array(args.length + 1); // char *const argv[], NULL-terminated
  args.forEach((a, i) => {
    vec[i] = BigInt(ptr(a));
  });
  vec[args.length] = 0n;
  const envp = new BigUint64Array(1); // an empty char *const envp[]
  libc.symbols.execve(ptr(cstr("/bin/sh")), ptr(vec), ptr(envp));
  // execve only returns on failure (E2BIG, if the extra arguments were what overflowed): carry on with the default stack.
}

const lossy = new TextDecoder("utf-8", { ignoreBOM: true });

const CF_ENCODING_VAR = "__CF_USER_TEXT_ENCODING";

/**
 * PORT (macOS): the oracle's process links CoreFoundation, whose startup puts this variable in `environ` before rustc's `main`, so
 * programs see it. Bun does not link it. This is `_CFStringGetUserDefaultEncoding` (CF-Lite `CFString.c`, not in the pin; each
 * branch is checked against the oracle in stack.test.ts): a value that starts with this uid (`strtol`, base 0) and a `:` stays.
 * Otherwise, unless root with no `HOME`, it becomes `0x<uid>:<the first 63 bytes of ~/.CFUserTextEncoding>`, or `0x<uid>:0:0` if
 * the file cannot be opened, where `~` is `CFFIXED_USER_HOME` or else the passwd entry's home, not `HOME`.
 */
function cf_user_text_encoding(current: string | undefined): void {
  const uid = process.getuid!();
  if (current !== undefined) {
    const m = /^[ \t\n\v\f\r]*([+-]?)(0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)(.?)/s.exec(current);
    if (m !== null && m[3] === ":") {
      const n = Number(m[2]!.replace(/^0(?=[0-7])/, "0o"));
      if ((m[1] === "-" ? -n : n) === uid) return;
    }
  }
  if (uid === 0 && var_os("HOME") === undefined) return;
  const fixed = var_os("CFFIXED_USER_HOME");
  const home = fixed !== undefined ? new TextDecoder().decode(fixed) : passwd_home(uid);
  if (home === undefined) return;
  const tail = (() => {
    let fd: number;
    try {
      fd = openSync(`${home}/.CFUserTextEncoding`, "r");
    } catch {
      return "0:0";
    }
    try {
      const buf = new Uint8Array(63);
      const n = readSync(fd, buf, 0, 63, 0);
      const end = buf.subarray(0, n).indexOf(0);
      return new TextDecoder().decode(buf.subarray(0, end === -1 ? n : end));
    } catch {
      return "";
    } finally {
      closeSync(fd);
    }
  })();
  set_var(CF_ENCODING_VAR, `0x${uid.toString(16).toUpperCase()}:${tail}`);
}

/** `getpwuid(uid)->pw_dir`. `os.userInfo().homedir` returns `HOME`, not the passwd entry. */
function passwd_home(uid: number): string | undefined {
  const lib = dlopen("libSystem.B.dylib", { getpwuid: { args: [FFIType.u32], returns: FFIType.ptr } });
  try {
    const pw = lib.symbols.getpwuid(uid);
    if (pw === null) return undefined;
    const dir = read.ptr(pw, 48); // macOS `struct passwd`: pw_dir follows pw_name, pw_passwd, pw_uid, pw_gid, pw_change, pw_class, pw_gecos
    return dir === 0 ? undefined : new CString(dir as Pointer).toString();
  } finally {
    lib.close();
  }
}

/**
 * Makes `process.env` follow C's `environ`, which removes what Bun's dotenv loaded from a `.env`, `.env.local`, `.env.production`
 * ... in the cwd: Bun adds those to its own map and never to `environ`, so `environ` tells them apart, and a real variable with the
 * same name is the one Bun keeps. Glue that wants the project's `.env.local` (`RUST_TS_DATA`, `RUST_TS_HOST_TUPLE`) reads the file
 * itself when the variable is unset (rustc_session/config.ts, rust_ts/track_caller.ts, scripts/lib/common.ts).
 */
function settle_environment(): OsString[] | undefined {
  let entries = environ_entries();
  if (entries === undefined) return undefined;
  if (process.platform === "darwin") {
    const current = vars_os(entries).find(([k]) => lossy.decode(k) === CF_ENCODING_VAR);
    const before = current === undefined ? undefined : lossy.decode(current[1]);
    cf_user_text_encoding(before);
    if (process.env[CF_ENCODING_VAR] !== before) entries = environ_entries()!;
  }
  const real = new Map<string, string>();
  for (const [k, v] of vars_os(entries)) {
    const name = lossy.decode(k);
    // The first of a repeated name, as `getenv` finds it.
    if (!real.has(name)) real.set(name, lossy.decode(v));
  }
  for (const k of Object.keys(process.env)) {
    if (!real.has(k)) delete process.env[k];
  }
  for (const [k, v] of real) {
    if (process.env[k] !== v) process.env[k] = v;
  }
  return entries;
}

let ENSURED = false;

/**
 * Gives this process the compiler's stack and the environment it was started with (see the file comment). Call it before
 * anything else. A second call does nothing, as the variables that mark the re-exec are gone by then.
 */
export function ensure_stack(): void {
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  if (ENSURED) return;
  ENSURED = true;
  const marker = reexec_marker();
  const arrived = process.env[marker] !== undefined;
  if (arrived) {
    remove_var(marker);
    // Ours: `env_can_carry` does not re-exec a process whose caller set it.
    remove_var(JSC_STACK_VAR);
  }
  const entries = settle_environment();
  if (!arrived && entries !== undefined) reexec_with_stack(marker, entries);
}
