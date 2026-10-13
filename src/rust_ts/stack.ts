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
// PORT: JS frames are larger than rustc's, so the JS stack is `JS_STACK_PER_RUST_BYTE` times the Rust
// thread size (measured, see docs/handoff/fix-parser.md), so that rust-ts reaches at least rustc's
// nesting depth on the same input. It is capped by what the host gives the main thread: on macOS the
// main thread's stack is the binary's `LC_MAIN` stacksize (Bun: 18 MiB) whatever the rlimit, so
// rust-ts stops earlier than rustc only for nestings close to rustc's own limit; on Linux the main
// stack grows up to `RLIMIT_STACK`. Windows: no re-exec (the default stack applies).
import { closeSync, openSync, readSync } from "node:fs";
import { dlopen, FFIType, ptr } from "bun:ffi";
import { process_raw_argv } from "../std/env.ts";

/** `rustc_session::config::DEFAULT_STACK_SIZE` (config.rs:57); stack.test.ts checks it against config.ts. */
export const DEFAULT_STACK_SIZE = 17 * 1024 * 1024;

/** JS stack bytes per byte of rustc thread stack. */
export const JS_STACK_PER_RUST_BYTE = 1.5;

/** Floor for the JS stack (the runtime itself needs some stack whatever `RUST_MIN_STACK` says). */
const MIN_JS_STACK = 2 * 1024 * 1024;

/** Set in the re-exec'd process (the JS stack size it was given). */
const MARKER = "RUST_TS_JS_STACK";

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
 * Re-execs this process once with a stack sized for the compiler (see the file comment). Returns
 * only when no re-exec is needed or possible.
 *
 * PORT: the rlimit is raised by `/bin/sh -c 'ulimit -S -s <kib>; exec "$@"'`: XNU refuses
 * `setrlimit(RLIMIT_STACK)` (EINVAL) in a process with a custom `LC_MAIN` stack, as Bun is. The raw
 * argv bytes are passed through unchanged (`execv`, `"$@"`).
 */
export function ensure_stack(): void {
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  if (process.env[MARKER] !== undefined) return;
  const want = Math.max(Math.ceil(rust_thread_stack_size(process.env.RUST_MIN_STACK) * JS_STACK_PER_RUST_BYTE), MIN_JS_STACK);

  const linux = process.platform === "linux";
  const libc = dlopen(linux ? "libc.so.6" : "libSystem.B.dylib", {
    getrlimit: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
    setenv: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    execv: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
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

  const cstr = (s: string | Uint8Array): Uint8Array => {
    const b = typeof s === "string" ? new TextEncoder().encode(s) : s;
    const out = new Uint8Array(b.length + 1);
    out.set(b);
    return out;
  };
  const setenv = (k: string, v: string): boolean => libc.symbols.setenv(ptr(cstr(k)), ptr(cstr(v)), 1) === 0;
  if (!setenv("BUN_JSC_maxPerThreadStackUsage", String(js_stack)) || !setenv(MARKER, String(js_stack))) return;

  const args = ["sh", "-c", `ulimit -S -s ${soft_kib} 2>/dev/null || unset BUN_JSC_maxPerThreadStackUsage; exec "$@"`, "sh", process.execPath]
    .map(cstr)
    .concat(argv.slice(1).map(cstr));
  const vec = new BigUint64Array(args.length + 1); // char *const argv[], NULL-terminated
  args.forEach((a, i) => {
    vec[i] = BigInt(ptr(a));
  });
  vec[args.length] = 0n;
  libc.symbols.execv(ptr(cstr("/bin/sh")), ptr(vec));
  // execv only returns on failure: carry on with the default stack.
}
