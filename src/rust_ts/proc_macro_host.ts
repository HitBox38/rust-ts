// rust-ts glue (not an upstream mirror): the FFI edge for proc-macro host dylibs (plan-m6 D7, A4).
//
// rustc loads a proc-macro crate's dylib with `libloading` (compiler/rustc_metadata/src/host_dylib.rs, ported in
// src/rustc_metadata/host_dylib.ts), reads its `__rustc_proc_macro_decls_<stable crate id>__` static as
// `*const &[bridge::client::Client]` and calls each `Client`'s `run: extern "C" fn(BridgeConfig) -> Buffer`
// with the server half of the bridge (library/proc_macro/src/bridge/server.rs, src/proc_macro/bridge/server.ts).
// This module is the part that has no Rust source to port:
//
// - `libloading` itself (0.9.0, the version in upstream's Cargo.lock), as far as host_dylib.rs uses it:
//   `Library::new` (`dlopen(path, RTLD_LAZY | RTLD_LOCAL)`), `Library::get` (macOS / Linux: `get_singlethreaded`,
//   a null symbol is `Ok`), `Library::into_raw`, and the `Error` variants these produce with their `Display` /
//   `source`. The calls go through the C side so that `dlerror` is read right after the failing call.
// - The `#[repr(C)]` ABI of the bridge: `Buffer` (buffer.rs:8), `Closure` (closure.rs:8), `BridgeConfig`
//   (mod.rs:120), `Client` (client.rs:221). Bun's FFI has no struct-by-value arguments, so proc_macro_host.c
//   (compiled by bun:ffi's TinyCC on first use) makes the by-value calls and TS passes pointers.
//
// Memory: every buffer that crosses to the client is native memory. Buffers the server allocates use the C
// side's `reserve` / `drop` (malloc / realloc / free, growing like `Vec<u8>`). A native buffer is seen in TS as
// a `bridge::Buffer` whose `data` views the native allocation and whose `reserve` / `drop` call the buffer's own
// `extern "C"` fn pointers (the client's, for buffers the client allocated), so the ported bridge code runs on
// it unchanged. A TS-memory buffer handed to the client (the server's input buffer, made by `Buffer::new()` in
// run_server) is copied into a fresh native one first.
//
// Errors: a JS exception thrown while the client is calling back into the server (an `unported(..)` or a port bug
// in a server method; server panics are already caught by `Dispatcher::dispatch`) cannot unwind through the
// dylib's Rust frames. The callback keeps it, answers the RPC with `Err(PanicMessage::Unknown)` (which the client
// resumes as a panic, caught by its `run_client`; `resume_unwind` runs no panic hook, so nothing is printed), and
// `run` rethrows it when the client returns. A panic that aborts inside the dylib kills the process, as in rustc.

import { cc, CString, JSCallback, ptr, read, toArrayBuffer } from "bun:ffi";
import { join } from "node:path";
import { bridge } from "../proc_macro/lib.ts";
import type { Buffer as BufferT } from "../proc_macro/bridge/buffer.ts";
import type { Client as ClientT } from "../proc_macro/bridge/client.ts";
import type { Closure } from "../proc_macro/bridge/closure.ts";
import type { BridgeConfig } from "../proc_macro/bridge/mod.ts";
import { unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";

// ---------------------------------------------------------------------------------------------------------------
// The C side

/** `Buffer` is 5 machine words: data, len, capacity, reserve, drop. */
const BUFFER_WORDS = 5;
const WORD = 8;

interface Native {
  rts_buffer_with_capacity(capacity: number, out: number): void;
  rts_buffer_reserve(b: number, additional: number, out: number): void;
  rts_buffer_drop(b: number): void;
  rts_set_dispatch(f: number): void;
  rts_run(run: number, input: number, env: number, force_show_panics: number, out: number): void;
  rts_dlopen(path: number, flags: number): number;
  rts_dlsym(handle: number, symbol: number): number;
  rts_dlerror(): number;
}

let NATIVE: Native | undefined;
let DISPATCH_CALLBACK: JSCallback | undefined;

function native(): Native {
  if (NATIVE !== undefined) return NATIVE;
  if (process.platform !== "darwin" && process.platform !== "linux") {
    // PORT: Windows (`LoadLibraryExW` / `GetProcAddress`) is not written yet; TinyCC there needs kernel32 bindings.
    return unported(`rust_ts::proc_macro_host (proc-macro dylibs on ${process.platform})`);
  }
  // PORT: `cc`'s C ABI is the platform's (AAPCS64 on aarch64-apple-darwin; checked by proc_macro_host.oracle.test.ts on darwin/aarch64).
  const lib = cc({
    source: join(import.meta.dir, "proc_macro_host.c"),
    symbols: {
      rts_buffer_with_capacity: { args: ["u64", "ptr"], returns: "void" },
      rts_buffer_reserve: { args: ["ptr", "u64", "ptr"], returns: "void" },
      rts_buffer_drop: { args: ["ptr"], returns: "void" },
      rts_set_dispatch: { args: ["ptr"], returns: "void" },
      rts_run: { args: ["ptr", "ptr", "ptr", "i32", "ptr"], returns: "void" },
      rts_dlopen: { args: ["ptr", "i32"], returns: "ptr" },
      rts_dlsym: { args: ["ptr", "ptr"], returns: "ptr" },
      rts_dlerror: { args: [], returns: "ptr" },
    },
  });
  // PORT: bun:ffi's symbol types are not expressible as the interface above; the signatures are the ones declared.
  const n = lib.symbols as unknown as Native;
  DISPATCH_CALLBACK = new JSCallback(dispatch_callback, { args: ["ptr", "ptr"], returns: "void" });
  n.rts_set_dispatch(nonnull(DISPATCH_CALLBACK.ptr));
  NATIVE = n;
  return n;
}

function nonnull(p: number | null): number {
  if (p === null || p === 0) return unported("rust_ts::proc_macro_host (bun:ffi returned a null pointer)");
  return p;
}

function cstr(s: string): Uint8Array {
  return new TextEncoder().encode(s + "\0");
}

// ---------------------------------------------------------------------------------------------------------------
// libloading 0.9.0 (src/error.rs, src/os/unix/mod.rs)

/** `libloading::Error`, the variants the unix `Library::new` / `Library::get` produce. `source` is the `DlError`. */
export type LibloadingError =
  | { readonly $: "DlOpen"; readonly source: string }
  | { readonly $: "DlOpenUnknown" }
  | { readonly $: "DlSym"; readonly source: string }
  | { readonly $: "DlSymUnknown" }
  | { readonly $: "LoadLibraryExW"; readonly source: string };

/** `impl Display for libloading::Error` */
export function display_LibloadingError(e: LibloadingError): string {
  switch (e.$) {
    case "DlOpen":
      return "dlopen failed";
    case "DlOpenUnknown":
      return "dlopen failed, but system did not report the error";
    case "DlSym":
      return "dlsym failed";
    case "DlSymUnknown":
      return "dlsym failed, but system did not report the error";
    case "LoadLibraryExW":
      return "LoadLibraryExW failed";
  }
}

/**
 * `<dyn Error>::sources()`: the error itself, then its `source()` chain, as `Display` strings. A `DlError`'s
 * `Display` is the `dlerror()` text (lossy UTF-8) and it has no source.
 */
export function sources_LibloadingError(e: LibloadingError): string[] {
  switch (e.$) {
    case "DlOpen":
    case "DlSym":
    case "LoadLibraryExW":
      return [display_LibloadingError(e), e.source];
    case "DlOpenUnknown":
    case "DlSymUnknown":
      return [display_LibloadingError(e)];
  }
}

/** `libloading::Library` (unix: the `dlopen` handle). */
export interface Library {
  readonly handle: number;
}

/** `RTLD_LAZY | RTLD_LOCAL` (libloading src/os/unix/consts.rs). */
function rtld_lazy_local(): number {
  // RTLD_LAZY = 1 on both; RTLD_LOCAL = 4 on macOS / iOS, 0 on Linux.
  return process.platform === "darwin" ? 1 | 4 : 1 | 0;
}

/** `with_dlerror`'s error half: `dlerror()`, or `None` when it reports nothing. */
function take_dlerror(n: Native): string | undefined {
  const p = n.rts_dlerror();
  if (p === 0 || p === null) return undefined;
  // `CStr::to_string_lossy`
  return new CString(p).toString();
}

/** `libloading::Library::new(path)` = `os::unix::Library::open(Some(path), RTLD_LAZY | RTLD_LOCAL)`. */
export function library_new(path: string): Result<Library, LibloadingError> {
  const n = native();
  const p = cstr(path);
  const handle = n.rts_dlopen(ptr(p), rtld_lazy_local());
  if (handle === 0 || handle === null) {
    const desc = take_dlerror(n);
    return Err(desc === undefined ? { $: "DlOpenUnknown" } : { $: "DlOpen", source: desc });
  }
  return Ok({ handle });
}

/**
 * `Library::get::<T>(name)`: the symbol's address (`*Symbol<T>` is the `T` stored at it; the caller reads it).
 * macOS / Linux use `get_singlethreaded`: `dlsym` returning null without a `dlerror` is `Ok(null)`.
 */
export function library_get(lib: Library, sym_name: string): Result<number, LibloadingError> {
  const n = native();
  const s = cstr(sym_name);
  const sym = n.rts_dlsym(lib.handle, ptr(s));
  if (sym === 0 || sym === null) {
    const desc = take_dlerror(n);
    if (desc !== undefined) return Err({ $: "DlSym", source: desc });
    return Ok(0);
  }
  return Ok(sym);
}

// ---------------------------------------------------------------------------------------------------------------
// The proc-macro decls static

/**
 * `*(sym as *const &[Client])`: the `&[Client]` (pointer, length) stored at the decls static's address, as TS
 * `Client`s whose `run` calls the dylib's `extern "C" fn` through the trampoline.
 * PORT: the slice layout is "unstable" upstream too (host_dylib.rs:134 FIXME): `&[T]` is (data, len) on the
 * oracle's rustc. A `Client` is one fn pointer.
 */
export function read_proc_macro_clients(decls: number): ClientT[] {
  if (decls === 0) return unported("rust_ts::proc_macro_host::read_proc_macro_clients (null decls symbol: rustc dereferences it)");
  const data = read.ptr(decls, 0);
  const len = read.ptr(decls, WORD);
  const clients: ClientT[] = [];
  for (let i = 0; i < len; i++) {
    const run = read.ptr(data, i * WORD);
    clients.push(new bridge.client.Client(dylib_run(run)));
  }
  return clients;
}

// ---------------------------------------------------------------------------------------------------------------
// Buffers

/** The native address behind each `Buffer.data` view (the view's identity survives `take` / `assign`). */
const DATA_PTR = new WeakMap<Uint8Array, number>();
/** The `extern "C"` fn pointer behind each native `Buffer.reserve` / `Buffer.drop` function. */
const FN_PTR = new WeakMap<object, number>();
const RESERVE_FNS = new Map<number, (b: BufferT, additional: number) => BufferT>();
const DROP_FNS = new Map<number, (b: BufferT) => void>();

/** A `Buffer` struct (5 words) in TS memory, for passing by pointer. */
function struct_buffer(): Float64Array {
  // PORT: written and read through `words_of`; Float64Array only reserves 8-byte aligned memory.
  return new Float64Array(BUFFER_WORDS);
}

function words_of(s: Float64Array): BigUint64Array {
  return new BigUint64Array(s.buffer, s.byteOffset, BUFFER_WORDS);
}

/** View a native `Buffer` struct at `p` as a TS `Buffer`. */
function from_native_at(p: number): BufferT {
  const data_ptr = read.ptr(p, 0);
  const len = read.ptr(p, WORD);
  const capacity = read.ptr(p, 2 * WORD);
  const reserve = read.ptr(p, 3 * WORD);
  const drop = read.ptr(p, 4 * WORD);
  const data = capacity === 0 ? new Uint8Array(0) : new Uint8Array(toArrayBuffer(data_ptr, 0, capacity));
  DATA_PTR.set(data, data_ptr);
  return new bridge.Buffer(data, len, capacity, reserve_fn(reserve), drop_fn(drop));
}

function reserve_fn(f: number): (b: BufferT, additional: number) => BufferT {
  let g = RESERVE_FNS.get(f);
  if (g === undefined) {
    // `(b.reserve)(b, additional)` through the buffer's own fn pointer.
    g = (b: BufferT, additional: number): BufferT => {
      const n = native();
      const s = struct_buffer();
      write_native(b, s);
      const out = struct_buffer();
      n.rts_buffer_reserve(ptr(s), additional, ptr(out));
      return from_native_at(ptr(out));
    };
    FN_PTR.set(g, f);
    RESERVE_FNS.set(f, g);
  }
  return g;
}

function drop_fn(f: number): (b: BufferT) => void {
  let g = DROP_FNS.get(f);
  if (g === undefined) {
    // `(b.drop)(b)` through the buffer's own fn pointer.
    g = (b: BufferT): void => {
      const s = struct_buffer();
      write_native(b, s);
      native().rts_buffer_drop(ptr(s));
    };
    FN_PTR.set(g, f);
    DROP_FNS.set(f, g);
  }
  return g;
}

/**
 * Write `b` as a native `Buffer` struct into `s`. A TS-memory buffer is copied into a new server-owned native
 * buffer (its TS allocation is then garbage).
 */
function write_native(b: BufferT, s: Float64Array): void {
  const w = words_of(s);
  const data_ptr = DATA_PTR.get(b.data);
  const reserve = FN_PTR.get(b.reserve);
  const drop = FN_PTR.get(b.drop);
  if (data_ptr !== undefined && reserve !== undefined && drop !== undefined) {
    w[0] = BigInt(data_ptr);
    w[1] = BigInt(b.len);
    w[2] = BigInt(b.capacity);
    w[3] = BigInt(reserve);
    w[4] = BigInt(drop);
    return;
  }
  // A buffer of the TS bridge (`Buffer::from(Vec<u8>)` in buffer.ts): same capacity and contents, in native
  // memory with the C side's `reserve` / `drop`.
  native().rts_buffer_with_capacity(b.capacity, ptr(s));
  const copy = from_native_at(ptr(s));
  copy.data.set(b.data.subarray(0, b.len));
  w[1] = BigInt(b.len);
}

// ---------------------------------------------------------------------------------------------------------------
// `Client::run` for a dylib client, and the server's dispatch `Closure`

/** The dispatch closures of the `run` calls in progress (`env` = index + 1). */
const DISPATCH_STACK: { dispatch: Closure; error: { value: unknown } | undefined }[] = [];

/**
 * `extern "C" fn(env: *mut Env, arg: Buffer) -> Buffer` for the server's `Closure`s: the C side's
 * `rts_dispatch_call` passes the request buffer in `*io` and returns `*io` after this writes the response.
 */
function dispatch_callback(env: number | null, io: number | null): void {
  const frame = DISPATCH_STACK[(env ?? 0) - 1];
  const io_ = io ?? 0;
  if (frame === undefined || io_ === 0) {
    // Cannot happen (the C side only passes envs made by `dylib_run`); no way to report it from here.
    process.stderr.write("rust-ts: proc_macro_host: dispatch callback with an unknown env\n");
    process.exit(101);
  }
  const s = struct_buffer();
  let b = from_native_at(io_);
  try {
    b = frame.dispatch.call_(b);
  } catch (e) {
    // PORT: see the header (Errors). `b` was moved into `call_`; the dispatcher reuses the request buffer
    // for its response, so the request buffer (now `b` again, possibly grown) carries the panic response.
    frame.error ??= { value: e };
    b.clear();
    // `Result::<(), PanicMessage>::Err(PanicMessage::Unknown)`: Err = 1, then `Option<&str>::None` = 1.
    b.push(1);
    b.push(1);
  }
  write_native(b, s);
  new BigUint64Array(toArrayBuffer(io_, 0, BUFFER_WORDS * WORD)).set(words_of(s));
}

/** `client.run` for the `extern "C" fn(BridgeConfig) -> Buffer` at address `run`. */
function dylib_run(run: number): (config: BridgeConfig) => BufferT {
  return (config: BridgeConfig): BufferT => {
    const n = native();
    const { input, dispatch, force_show_panics } = config;
    const input_s = struct_buffer();
    write_native(input, input_s);
    const out = struct_buffer();
    const frame: (typeof DISPATCH_STACK)[number] = { dispatch, error: undefined };
    DISPATCH_STACK.push(frame);
    const env = DISPATCH_STACK.length;
    try {
      n.rts_run(run, ptr(input_s), env, force_show_panics ? 1 : 0, ptr(out));
    } finally {
      DISPATCH_STACK.pop();
    }
    const result = from_native_at(ptr(out));
    if (frame.error !== undefined) {
      result.drop_();
      throw frame.error.value;
    }
    return result;
  };
}
