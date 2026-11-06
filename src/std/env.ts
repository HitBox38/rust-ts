// `std::env::args_os()` / `std::env::args()` (library/std/src/env.rs) for the rust-ts process.
//
// PORT: JS only sees argv decoded to UTF-16 (invalid UTF-8 becomes U+FFFD), so the raw bytes are read
// from the OS, like std does: `_NSGetArgc`/`_NSGetArgv` on macOS (through `bun:ffi`),
// `/proc/self/cmdline` on Linux. The runtime's own arguments (`bun [flags] src/rust_ts/main.ts`) are
// dropped: the program's arguments are the last `process.argv.length - 2` raw entries, and argv[0]
// is the script path (it stands for the `rustc` binary). On other hosts (Windows: `GetCommandLineW`
// with WTF-16) the decoded `process.argv` is used, so a non-Unicode argument there is not detected.
// Drivers that run the compiler in-process (tests) install their own list with `set_args_os`.
//
// PORT: the process environment is C's `environ`, read through `bun:ffi`, because `process.env` is not it. Bun copies
// `environ` once at startup, and from then on the two are separate. `process.env` gains what Bun's dotenv loaded from the
// cwd, decodes names and values lossily, and moves integer-like names to the front of its keys. Its writes never reach
// `environ`, which is what a proc-macro dylib reads. So everything `std::env` does on the host goes through libc here.
// On other hosts (Windows) `process.env` stands in: a non-Unicode value or a dotenv variable is not detected there.
import { readFileSync } from "node:fs";
import { dlopen, FFIType, type Pointer, ptr, read, toArrayBuffer } from "bun:ffi";
import { panic } from "./panic.ts";
import { Err, Ok, type Result } from "./result.ts";
import { debug_os_bytes, from_utf8 } from "./str.ts";

/** `OsString` on unix: raw bytes. */
export type OsString = Uint8Array;

let ARGS_OS: OsString[] | undefined;

/** Installs the process arguments `args_os()` returns (argv[0] first). */
export function set_args_os(args: readonly OsString[]): void {
  ARGS_OS = [...args];
}

const encoder = new TextEncoder();
const lossy = new TextDecoder("utf-8", { ignoreBOM: true });

/** The raw argv of this OS process, or `undefined` where it cannot be read. */
export function process_raw_argv(): Uint8Array[] | undefined {
  if (process.platform === "linux") {
    let b: Uint8Array;
    try {
      b = readFileSync("/proc/self/cmdline");
    } catch {
      return undefined;
    }
    const out: Uint8Array[] = [];
    let start = 0;
    for (let i = 0; i < b.length; i++) {
      if (b[i] === 0) {
        out.push(b.slice(start, i));
        start = i + 1;
      }
    }
    if (start < b.length) out.push(b.slice(start));
    return out;
  }
  if (process.platform === "darwin") {
    const lib = dlopen("libSystem.B.dylib", {
      _NSGetArgc: { args: [], returns: FFIType.ptr },
      _NSGetArgv: { args: [], returns: FFIType.ptr },
    });
    try {
      const argc_p = lib.symbols._NSGetArgc();
      const argv_pp = lib.symbols._NSGetArgv();
      if (argc_p === null || argv_pp === null) return undefined;
      const argc = read.i32(argc_p, 0);
      const argv = read.ptr(argv_pp, 0);
      const out: Uint8Array[] = [];
      for (let i = 0; i < argc; i++) {
        const p = read.ptr(argv, i * 8);
        let n = 0;
        while (read.u8(p, n) !== 0) n++;
        out.push(n === 0 ? new Uint8Array(0) : new Uint8Array(toArrayBuffer(p, 0, n)).slice());
      }
      return out;
    } finally {
      lib.close();
    }
  }
  return undefined;
}

/** `std::env::args_os()` collected: argv[0] (the script path) and the program's arguments. */
export function args_os(): OsString[] {
  if (ARGS_OS !== undefined) return ARGS_OS;
  const decoded = process.argv.slice(1);
  let args: OsString[] = decoded.map((a) => encoder.encode(a));
  const raw = process_raw_argv();
  const n = decoded.length - 1;
  if (raw !== undefined && raw.length >= n) {
    const tail = raw.slice(raw.length - n);
    // The raw tail must decode (lossily) to what the runtime gave us; otherwise keep the decoded argv.
    if (tail.every((b, i) => lossy.decode(b) === decoded[i + 1])) {
      args = [args[0]!, ...tail];
    }
  }
  ARGS_OS = args;
  return args;
}

/** `std::env::args()` collected: panics on a non-Unicode argument like `Args::next`
 *  (`self.inner.next().map(|s| s.into_string().unwrap())`, library/std/src/env.rs). */
export function args(): string[] {
  return args_os().map((a) => {
    const s = from_utf8(a);
    if (s.$ === "Err") panic(`called \`Result::unwrap()\` on an \`Err\` value: ${debug_os_bytes(a)}`);
    return s._0;
  });
}

/** `OsString::into_string`: `Err` holds the original bytes. */
export function os_string_into_string(a: OsString): { $: "Ok"; _0: string } | { $: "Err"; _0: OsString } {
  const s = from_utf8(a);
  return s.$ === "Ok" ? s : { $: "Err", _0: a };
}

/** `<OsString as Debug>` */
export const debug_os_string = debug_os_bytes;

// ---- the process environment ----------------------------------------------------------------------------------------

const ENV_FROM_LIBC = process.platform === "darwin" || process.platform === "linux";

const open_env_libc = () =>
  dlopen(process.platform === "linux" ? "libc.so.6" : "libSystem.B.dylib", {
    getenv: { args: [FFIType.ptr], returns: FFIType.ptr },
    setenv: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    unsetenv: { args: [FFIType.ptr], returns: FFIType.i32 },
  });
let ENV_LIBC: ReturnType<typeof open_env_libc> | undefined;
const env_libc = () => (ENV_LIBC ??= open_env_libc());

/** A NUL-terminated copy of `s`; `undefined` when `s` has an interior NUL (`run_with_cstr`'s `Err`). */
function to_cstr(s: string): Uint8Array | undefined {
  const b = encoder.encode(s);
  if (b.includes(0)) return undefined;
  const out = new Uint8Array(b.length + 1);
  out.set(b);
  return out;
}

/** The bytes of the C string at `p`, copied. */
function read_cstr(p: Pointer): OsString {
  let n = 0;
  while (read.u8(p, n) !== 0) n++;
  return n === 0 ? new Uint8Array(0) : new Uint8Array(toArrayBuffer(p, 0, n)).slice();
}

/** Linux only: the names `remove_var` removed, which `/proc/self/environ` still shows (see `environ_entries`). */
const REMOVED_VARS = new Set<string>();

/** The name in an `environ` entry: up to the first `=` after the first byte (`parse` in `env()` below), or `undefined`. */
function entry_name(entry: OsString): OsString | undefined {
  const eq = entry.indexOf(0x3d, 1);
  return eq === -1 ? undefined : entry.subarray(0, eq);
}

/**
 * Every string in C's `environ`, in order, malformed ones included, or `undefined` where it cannot be read.
 *
 * PORT: on Linux this is `/proc/self/environ`, as `process_raw_argv` reads `cmdline`: the block as `execve` left it, minus
 * what `remove_var` removed. A later `setenv` does not show in it. Its callers all run at startup, before a proc macro
 * could call `setenv`. `dlsym` of `environ` could return libc's copy where the executable has a copy relocation, and that
 * could not be run here.
 */
export function environ_entries(): OsString[] | undefined {
  if (process.platform === "linux") {
    let b: Uint8Array;
    try {
      b = readFileSync("/proc/self/environ");
    } catch {
      return undefined;
    }
    const out: OsString[] = [];
    let start = 0;
    for (let i = 0; i < b.length; i++) {
      if (b[i] === 0) {
        const entry = b.slice(start, i);
        const name = entry_name(entry);
        if (name === undefined || !REMOVED_VARS.has(lossy.decode(name))) out.push(entry);
        start = i + 1;
      }
    }
    return out;
  }
  if (process.platform === "darwin") {
    // `*_NSGetEnviron()` (`environ()`, library/std/src/sys/env/unix.rs:37).
    const lib = dlopen("libSystem.B.dylib", { _NSGetEnviron: { args: [], returns: FFIType.ptr } });
    try {
      const environ_p = lib.symbols._NSGetEnviron();
      if (environ_p === null) return undefined;
      const environ = read.ptr(environ_p, 0);
      const out: OsString[] = [];
      if (environ === 0) return out;
      for (let i = 0; ; i++) {
        const p = read.ptr(environ as Pointer, i * 8);
        if (p === 0) return out;
        out.push(read_cstr(p as Pointer));
      }
    } finally {
      lib.close();
    }
  }
  return undefined;
}

/** `env::vars_os().collect::<Vec<_>>()`: the variables in `environ`'s order. Names and values are bytes. */
// std: library/std/src/sys/env/unix.rs:73 env
export function vars_os(entries: readonly OsString[] | undefined = environ_entries()): [OsString, OsString][] {
  if (entries === undefined) {
    return Object.entries(process.env).flatMap(([k, v]): [OsString, OsString][] => (v === undefined ? [] : [[encoder.encode(k), encoder.encode(v)]]));
  }
  const result: [OsString, OsString][] = [];
  for (const entry of entries) {
    // `parse`: variable name and value are separated by an ASCII equals sign '='. Since a variable name must not be empty,
    // allow variable names starting with an equals sign. Skip all malformed lines.
    const name = entry.length === 0 ? undefined : entry_name(entry);
    if (name !== undefined) result.push([name, entry.subarray(name.length + 1)]);
  }
  return result;
}

/** `env::var_os(key)`. PORT: libc's own `getenv`, so a name holding `=` means what it means on this host (BSD stops at the `=`). */
// std: library/std/src/sys/env/unix.rs:112 getenv
export function var_os(key: string): OsString | undefined {
  if (!ENV_FROM_LIBC) {
    const v = process.env[key];
    return v === undefined ? undefined : encoder.encode(v);
  }
  // environment variables with a nul byte can't be set, so their value is always None as well
  const k = to_cstr(key);
  if (k === undefined) return undefined;
  const v = env_libc().symbols.getenv(ptr(k));
  return v === null ? undefined : read_cstr(v as Pointer);
}

/** `std::env::VarError` */
export type VarError = { readonly $: "NotPresent" } | { readonly $: "NotUnicode"; _0: OsString };

/** `env::var(key)` */
// std: library/std/src/env.rs:228 var
export function var_(key: string): Result<string, VarError> {
  const v = var_os(key);
  if (v === undefined) return Err({ $: "NotPresent" });
  const s = from_utf8(v);
  return s.$ === "Ok" ? Ok(s._0) : Err({ $: "NotUnicode", _0: v });
}

/** `env::set_var(key, value)` for a name and value this port made. `process.env` follows it. */
// std: library/std/src/sys/env/unix.rs:132 setenv
export function set_var(key: string, value: string): void {
  process.env[key] = value;
  if (!ENV_FROM_LIBC) return;
  const k = to_cstr(key);
  const v = to_cstr(value);
  if (k === undefined || v === undefined || env_libc().symbols.setenv(ptr(k), ptr(v), 1) !== 0) {
    panic(`failed to set environment variable \`${key}\` to \`${value}\``);
  }
}

/** `env::remove_var(key)` for a name this port made. `process.env` follows it. */
// std: library/std/src/sys/env/unix.rs:141 unsetenv
export function remove_var(key: string): void {
  delete process.env[key];
  if (!ENV_FROM_LIBC) return;
  REMOVED_VARS.add(key);
  const k = to_cstr(key);
  if (k === undefined || env_libc().symbols.unsetenv(ptr(k)) !== 0) panic(`failed to remove environment variable \`${key}\``);
}
