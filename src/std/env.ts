// `std::env::args_os()` / `std::env::args()` (library/std/src/env.rs) for the rust-ts process.
//
// PORT: JS only sees argv decoded to UTF-16 (invalid UTF-8 becomes U+FFFD), so the raw bytes are read
// from the OS, like std does: `_NSGetArgc`/`_NSGetArgv` on macOS (through `bun:ffi`),
// `/proc/self/cmdline` on Linux. The runtime's own arguments (`bun [flags] src/rust_ts/main.ts`) are
// dropped: the program's arguments are the last `process.argv.length - 2` raw entries, and argv[0]
// is the script path (it stands for the `rustc` binary). On other hosts (Windows: `GetCommandLineW`
// with WTF-16) the decoded `process.argv` is used, so a non-Unicode argument there is not detected.
// Drivers that run the compiler in-process (tests) install their own list with `set_args_os`.
import { readFileSync } from "node:fs";
import { dlopen, FFIType, read, toArrayBuffer } from "bun:ffi";
import { panic } from "./panic.ts";
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
