// rust-ts glue (not an upstream mirror): compiling a C helper with bun:ffi's embedded TinyCC (`cc`), used by
// src/std/thread.ts (thread.c) and src/rust_ts/proc_macro_host.ts (proc_macro_host.c).
//
// PORT: a failed compile is not a rustc behavior; it is the port lacking a native helper on this host, so it stops
// `unported` with one line (`rust-ts: unported: ...`, exit 70) instead of escaping as an uncaught JS `Error` with a
// stack (docs/reviews/pm-cross-thread.md N6). TinyCC's messages are joined onto that line.
import { cc } from "bun:ffi";
import { unported } from "../std/panic.ts";

type CcOptions = Parameters<typeof cc>[0];

/** `cc(options)`; on failure, `unported("<what> (TinyCC failed: <its messages on one line>)")`. */
export function cc_or_unported(what: string, options: CcOptions): ReturnType<typeof cc> {
  try {
    return cc(options);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).trim().split(/\r?\n/).join(" | ");
    return unported(`${what} (TinyCC failed: ${msg})`);
  }
}
