// `std::thread::spawn` / `JoinHandle::join` (library/std/src/thread) for a thread whose body is native code.
//
// PORT: a JS realm has one thread; a second OS thread cannot run TS. The one place rustc spawns a thread whose
// effects the port must reproduce is the proc-macro bridge's cross-thread execution strategy
// (library/proc_macro/src/bridge/server.rs `MaybeCrossThread::run_bridge_and_client`), whose spawned closure
// only calls a proc-macro dylib's `extern "C" fn` and the client half of a channel (mpsc.ts), all native. So
// `spawn` takes the closure as a `NativeThunk`: a C entry point and its argument, compiled by bun:ffi's TinyCC,
// plus how TS reads the closure's return value after the thread is joined. The thread is a real pthread, created
// as std's `sys/thread/unix.rs` `Thread::new` does (joinable, the same stack size: `RUST_MIN_STACK` or 2 MiB,
// at least `PTHREAD_STACK_MIN`, rounded up to the page size on EINVAL). It is unnamed, as std's are by default.
// Not reproduced (no output depends on them in the port's cases; a native closure cannot unwind, see `join`):
// std's spawn hooks, output capture, the `Thread` handle and `ThreadId`, and the stack-overflow guard page
// handler (a stack overflow on the second thread is a plain SIGSEGV/SIGBUS instead of std's "has overflowed its
// stack" message followed by SIGABRT).
//
// thread.c holds the native side (also the channel of mpsc.ts, so that the two share one TinyCC unit).

import { cc, FFIType, ptr } from "bun:ffi";
import { join } from "node:path";
import { var_os } from "./env.ts";
import { type Debug, debug_struct_non_exhaustive } from "./fmt.ts";
import { unported } from "./panic.ts";
import { Ok, type Result } from "./result.ts";

/** The native functions of thread.c. */
export interface NativeSync {
  rts_thread_spawn(start: number, arg: number, stack: number, err: number): number;
  rts_thread_join(t: number): number;
  rts_chan_new(cap: number, words: number): number;
  rts_chan_send(c: number, msg: number): number;
  rts_chan_recv(c: number, out: number): number;
  rts_chan_len(c: number): number;
  rts_chan_drop_sender(c: number): void;
  rts_chan_drop_receiver(c: number): void;
  rts_chan_fns(out: number): void;
}

let NATIVE: NativeSync | undefined;

/** Compiles thread.c on first use. */
export function native_sync(): NativeSync {
  if (NATIVE !== undefined) return NATIVE;
  if (process.platform !== "darwin" && process.platform !== "linux") {
    // PORT: Windows threads (`CreateThread`) and its synchronization primitives are not written.
    return unported(`std::thread (native threads on ${process.platform})`);
  }
  const lib = cc({
    source: join(import.meta.dir, "thread.c"),
    symbols: {
      rts_thread_spawn: { args: ["ptr", "ptr", "u64", "ptr"], returns: "ptr" },
      rts_thread_join: { args: ["ptr"], returns: "i32" },
      rts_chan_new: { args: ["u64", "u64"], returns: "ptr" },
      rts_chan_send: { args: ["ptr", "ptr"], returns: "i32" },
      rts_chan_recv: { args: ["ptr", "ptr"], returns: "i32" },
      rts_chan_len: { args: ["ptr"], returns: FFIType.u64_fast },
      rts_chan_drop_sender: { args: ["ptr"], returns: "void" },
      rts_chan_drop_receiver: { args: ["ptr"], returns: "void" },
      rts_chan_fns: { args: ["ptr"], returns: "void" },
    },
  });
  // PORT: bun:ffi's symbol types are not expressible as the interface above; the signatures are the ones declared.
  NATIVE = lib.symbols as unknown as NativeSync;
  return NATIVE;
}

/**
 * PORT: the `F: FnOnce() -> T + Send + 'static` of `spawn` when its body is native (see the header): the thread
 * runs `start(arg)` (`extern "C" fn(*mut c_void) -> *mut c_void`, its return value ignored); after the thread
 * is joined, `take_result()` reads the closure's return value from wherever `start` left it.
 */
export interface NativeThunk<T> {
  readonly start: number;
  readonly arg: number;
  take_result(): T;
}

/** `sys::thread::DEFAULT_MIN_STACK_SIZE` on unix (library/std/src/sys/thread/unix.rs:33). */
const DEFAULT_MIN_STACK_SIZE = 2 * 1024 * 1024;

/** The `MIN` static of `spawn_unchecked_`'s stack-size closure: 0 until set, then the size + 1. */
let MIN_STACK = 0;

/**
 * The stack size of a thread spawned without `Builder::stack_size` (library/std/src/thread/lifecycle.rs:29,
 * inside `spawn_unchecked`): `RUST_MIN_STACK` parsed as a `usize`, else `DEFAULT_MIN_STACK_SIZE`, read once per
 * process.
 */
function min_stack(): number {
  if (MIN_STACK !== 0) return MIN_STACK - 1;
  const v = var_os("RUST_MIN_STACK");
  let amt = DEFAULT_MIN_STACK_SIZE;
  if (v !== undefined) {
    const parsed = parse_usize(v);
    if (parsed !== undefined) amt = parsed;
  }
  // 0 is our sentinel value, so ensure that we'll never see 0 after
  // initialization has run
  MIN_STACK = amt + 1;
  return amt;
}

/** `s.to_str().and_then(|s| s.parse().ok())` for `usize` (u64 on the 64-bit hosts the port runs on). */
function parse_usize(raw: Uint8Array): number | undefined {
  let s: string;
  try {
    // `OsStr::to_str`: `None` unless valid UTF-8.
    s = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    return undefined;
  }
  // `<usize as FromStr>`: an optional `+`, then one or more ASCII digits, no overflow.
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^[0-9]+$/.test(s)) return undefined;
  const n = BigInt(s);
  if (n > 0xffff_ffff_ffff_ffffn) return undefined;
  // PORT: a stack size above 2^53 cannot be passed through bun:ffi as a number; no such stack can be allocated.
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) return unported(`std::thread::spawn (RUST_MIN_STACK=${s} above 2^53)`);
  return Number(n);
}

/** `thread::Result<T>`'s error: the panic payload, a `Box<dyn Any + Send>`. */
// impl fmt::Debug for dyn Any
// std: library/core/src/any.rs:154 fmt
export const debug_Any: Debug<unknown> = (_v, f) => debug_struct_non_exhaustive(f, "Any", []);

/** An owned permission to join on a thread (block on its termination). */
// std-type: library/std/src/thread/join_handle.rs:71 JoinHandle
export class JoinHandle<T> {
  constructor(
    private native: number,
    private thunk: NativeThunk<T>,
  ) {}

  /// Waits for the associated thread to finish.
  ///
  /// This function will return immediately if the associated thread has already finished.
  // std: library/std/src/thread/join_handle.rs:149 join
  join(): Result<T, unknown> {
    const r = native_sync().rts_thread_join(this.native);
    this.native = 0;
    if (r !== 0) return unported(`std::thread::JoinHandle::join (pthread_join failed: ${r})`);
    // PORT: std's thread main catches a panic of the closure and `join` returns it as `Err`. A native closure is
    // an `extern "C"` call chain, which cannot unwind (a panic escaping it aborts the process), so `join` is
    // always `Ok` here.
    return Ok(this.thunk.take_result());
  }
}

/// Spawns a new thread, returning a [`JoinHandle`] for it.
// std: library/std/src/thread/functions.rs:125 spawn
export function spawn<T>(f: NativeThunk<T>): JoinHandle<T> {
  // `Builder::new().spawn(f).expect("failed to spawn thread")`
  const stack = min_stack();
  const err = new Int32Array(1);
  const n = native_sync();
  const t = n.rts_thread_spawn(f.start, f.arg, stack, ptr(err));
  if (t === 0 || t === null) {
    // PORT: the panic message is `failed to spawn thread: {io::Error:?}` (an `Os { code, kind, message }`); the
    // port does not format OS errors from an errno here.
    return unported(`std::thread::spawn (pthread_create failed: errno ${err[0]})`);
  }
  return new JoinHandle(t, f);
}
