# Handoff: pm-host (wave 36, M6; plan-m6 D7/D8, amendment A4)

Branch `t3/3acf92a9` (from `06fa2c65`). The port now loads proc macros from oracle-built host dylibs, as rustc does:
creader → `host_dylib::dlsym_proc_macros` → the dylib's `&[Client]` → `Client.run1/run2` → the ported bridge server
and `proc_macro_server.ts`. The proc macro itself runs as the oracle's compiled code inside the dylib, so every RPC
crosses the real `Buffer` byte format.

## A4: does Bun's FFI work for this on this host? **Yes** (macOS aarch64, Bun 1.4.3)

I checked this first with a scratch probe, before writing any port code:
- `bun:ffi` `dlopen` of an oracle-built `--crate-type proc-macro` dylib works. `__rustc_proc_macro_decls_<id>__`
  resolves, and reading it as `*const &[Client]` gave (data, len = 3) with 3 fn pointers.
- A C trampoline compiled by `bun:ffi` `cc` (embedded TinyCC) makes the by-value
  `extern "C" fn(BridgeConfig) -> Buffer` call. `BridgeConfig` is 64 bytes, passed indirectly under AAPCS64, and
  the 40-byte `Buffer` return goes through x8.
- The client's `Closure.call` reached a `JSCallback`. The callback got the request (`ts_into_trees`, tag 13, handle
  1). It answered `Err(PanicMessage::Unknown)` = `[1, 1]`. The client resumed the panic, caught it in `run_client`,
  and returned `[1, 1]`.
- The returned buffer was freed through its `drop` fn pointer. Nothing broke.
- **Not checked: Windows.** AGENTS.md names a Windows host, but this machine is macOS, so the A4 "check Windows"
  item is still open. On Windows `proc_macro_host.ts` stops with `unported` (see below). A Windows port needs
  `LoadLibraryExW` / `GetProcAddress` declarations in the C file and the Win64 by-value struct ABI. TinyCC
  supports that ABI, but I have not tested it.

## Files touched
- `src/rustc_metadata/host_dylib.ts`: **rewritten as a full port** of host_dylib.rs (147 lines). It has
  `format_dlopen_err`, `attempt_load_dylib`, `load_dylib` (retry loop, `LoadLibraryExW`-only retry, prefix strip),
  `DylibError`, `From<DylibError> for CrateError`, `load_symbol_from_dylib` and `dlsym_proc_macros`.
  `ProcMacroClient` is now `proc_macro::bridge::client::Client`, where before it was `unknown`.
- `src/rust_ts/proc_macro_host.ts` (new): the FFI edge. It is glue, not an upstream mirror, and its header documents
  it.
  - A `libloading` 0.9.0 subset: `library_new` (`dlopen(path, RTLD_LAZY|RTLD_LOCAL)`), `library_get`
    (`get_singlethreaded`: dlerror cleared, then dlsym; null without a dlerror is `Ok`), and `LibloadingError` with
    the exact `Display` / `source` texts.
  - `read_proc_macro_clients`: the decls static's `&[Client]`, turned into TS `Client`s.
  - Native-buffer wrapping, the dispatch callback, and the dylib `run`.
- `src/rust_ts/proc_macro_host.c` (new): the TinyCC trampoline, compiled on first use. It holds:
  - the `#[repr(C)]` `Buffer` / `Closure` / `BridgeConfig` layouts;
  - server-owned buffers (malloc/realloc/free, growing like `Vec<u8>` `grow_amortized`, with a dangling non-null
    `data` at capacity 0);
  - calls through a buffer's own `reserve` / `drop`;
  - `rts_dispatch_call` → JS callback;
  - `rts_run`;
  - `dlopen` / `dlsym` / `dlerror`.
- `src/rust_ts/proc_macro_host.oracle.test.ts` (new): 9 tests, described below.
- `docs/handoff/pm-host.md` (this file).
- **No edits** to creader.ts, client.ts, server.ts, decoder.ts or locator.ts:
  - **creader.** The upstream functions on this path were already ported and wired: creader.rs:641–661
    `register_crate`'s `raw_proc_macros` block, :966 `dlsym_proc_macros`, decoder.rs:1032 `raw_proc_macro`, :1102
    `load_proc_macro`, and locator.rs:986 `get_proc_macros`. `--missing creader.rs` = 55/55.
  - **Client.run, dylib half.** This needed no client.ts change. `Client` is `{ run: (BridgeConfig) => Buffer }`, so
    a dylib client is `new Client(run)` where `run` calls the trampoline (`proc_macro_host.ts` `dylib_run`). The
    ported `run1` / `run2` / `run_server` / `Dispatcher` run on it unchanged.

## Verification (one line each)
- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (23198; vendor 5050)`.
- `bun scripts/coverage.ts --missing compiler/rustc_metadata/src/host_dylib.rs`: 6/6 ported. `--missing
  compiler/rustc_metadata/src/creader.rs`: 55/55 ported.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/proc_macro src/rustc_expand src/rustc_metadata src/rust_ts`: 434 pass,
  0 fail (34 files).
- `bun scripts/difftest.ts --suite expanded --sample 300` (`RUST_TS_AGENT=pm-host`): 300/300 MATCH, skipped=3, run
  `20261101-125218-pm-host-q4h3`. Unchanged.
- `bun scripts/difftest.ts --suite rmeta-ui --sample 100`: 100/100 MATCH, run `20261101-125401-pm-host-oxm1`.
  Unchanged.

### The first test (pm-bridge review): `src/rust_ts/proc_macro_host.oracle.test.ts`, 9/9 pass
Each test builds its proc-macro crates with the oracle into a `$RUST_TS_DATA/tmp/pm-host-*` scratch directory.
Then it compiles user crates with both the oracle and `src/rust_ts/main.ts` (`-Zunpretty=expanded`, same argv, same
cwd) and compares stdout, stderr and exit code byte for byte. The only normalisation is the panic hook's OS thread
id, which varies per run on both sides. Without the pinned rustc the test prints a visible SKIP;
`RUST_TS_REQUIRE_PROBES=1` turns that into a failure.
- derive (with helper attrs), attribute and bang macros;
- token-tree walking: Group / Punct spacing / Ident / Literal, raw idents, non-ASCII idents (`größe`);
- every literal constructor kind;
- a 2000-token stream, so the client's buffers grow through the server's `reserve`;
- doc comments in derive input;
- proc-macro `panic!` with a string, `panic_any(7u8)` (the "proc macro panicked" errors with and without a
  message), `compile_error!` with a respanned literal, and a `"let x = (;".parse()` failure;
- the same with `-Zproc-macro-backtrace`, where the dylib's own panic hook prints to fd 2 interleaved with the
  port's diagnostics;
- `println!` / `eprintln!` from inside the dylib interleaved with diagnostics;
- `dlopen` failure (macOS: an unsigned copy of the dylib). The `CrateError::DlOpen` message, including dyld's text,
  is identical;
- in process: `dlsym_proc_macros` returns 3 clients, and a wrong stable crate id gives `DlSym` with `": dlsym
  failed: …"`;
- in process: `echo!`'s `Client.run1` against a minimal TS server;
- in process: a JS exception (`unported`) thrown inside a server method while the dylib calls back is rethrown
  after the client returns, and the bridge works again afterwards.

### tests/ui proc-macro cases
`bun scripts/difftest.ts --suite expanded --sample` **cannot reach them**: harness/compiletest.ts:646/664 rejects
`//@ proc-macro:` cases and proc-macro aux crates when it builds a suite's case list ("deferred to M6 (plan-m2
D6)"), so they are never sampled. Lane `harness-m6b` is adding the aux dylib build; I did not touch harness/ or
scripts/.

I ran a scratch sweep instead, from outside the repo (`/tmp/pmhost/sweep.ts`, not committed):
- **Selection:** every tests/ui file whose directives are only `proc-macro`, `edition`, pass/fail modes and harmless
  `compile-flags`. That is 200 files.
- **Aux:** each `//@ proc-macro:` aux built with the oracle (`--crate-type proc-macro`, aux edition).
- **Compare:** oracle vs port on `-Zui-testing -Zunpretty=expanded --extern …` (host target), stdout + stderr + exit.

**Result: 195 MATCH, 0 DIFF, 1 UNPORTED, 4 aux-build-fail.** The UNPORTED case is `proc-macro/expand-expr.rs`, a
nested proc macro through `ts_expand_expr` → cross-thread, which is pm-bridge's unported (1). The 4 aux crates need
directives the sweep does not handle. Separately, two hand-made cases with `--target x86_64-unknown-linux-gnu`
(the harness's target, with a host proc-macro dylib) also match.

## `unported(...)` left (all in `src/rust_ts/proc_macro_host.ts`)
1. `rust_ts::proc_macro_host (proc-macro dylibs on <platform>)`: any host but darwin/linux, i.e. Windows (see A4).
2. `rust_ts::proc_macro_host (bun:ffi returned a null pointer)`: the `JSCallback` has no pointer. Cannot happen.
3. `rust_ts::proc_macro_host::read_proc_macro_clients (null decls symbol: rustc dereferences it)`: `dlsym`
   returned null without a dlerror, which libloading's `get_singlethreaded` treats as `Ok`. rustc would then
   dereference null and crash, and we do not reproduce the crash.

These were already there and are still reachable:
- pm-bridge (1): `MaybeCrossThread::run_bridge_and_client`, for `-Zproc-macro-execution-strategy=cross-thread` and
  nested proc macros. It exits 70 cleanly with a dylib client.
- pm-bridge (2): `MessagePipe`.

## `// PORT:` decisions (root: record what you accept)
1. **libloading lives in the FFI edge, not src/vendor.** Only the unix `Library::new` / `get` / `into_raw` /
   `Error` subset that host_dylib.rs needs is reproduced, with the exact `Display` / `source` texts. The dl* calls
   are made in C so that `dlerror` is read right after the failing call.
   - `load_symbol_from_dylib::<T>` returns the symbol's address, and the caller reads the `T`. The one caller wants
     `*const &[Client]`.
   - The retry `thread::sleep(100ms)` is `Bun.sleepSync(100)`. It only happens on `LoadLibraryExW`, so Windows
     only.
   - The library handle is never closed (`into_raw` + `mem::forget`).
2. **Native buffers.** Every buffer the client sees is native memory.
   - **Server allocations** use the C side's malloc/realloc/free `reserve` / `drop`, following `Vec<u8>`'s
     `grow_amortized`. They stand in for the server's `Buffer::from(Vec<u8>)`. Which allocator is used cannot be
     observed.
   - **In TS**, a native buffer is a `bridge::Buffer`:
     - `data` is a `toArrayBuffer` view of the allocation;
     - `reserve` / `drop` call the buffer's *own* fn pointers, so a buffer the client allocated is grown and freed
       by the client;
     - a `WeakMap` maps each view back to its address, which survives `take` / `assign`.
   - **TS-memory buffers** (`run_server`'s `Buffer::new()` input) are copied into a native buffer before the call.
3. **Dispatch closure.** Every `Closure` handed to a client has `call` = C `rts_dispatch_call` and `env` = an index
   into a JS stack of the `run` calls in progress. It reaches one `JSCallback` that runs the TS `Closure.call_`
   (the dispatcher).
4. **JS exceptions during a callback.** These are `unported` or port bugs; server panics are already caught by
   `Dispatcher::dispatch`. They cannot unwind through the dylib's Rust frames.
   - The callback keeps the first one and answers the RPC with `Err(PanicMessage::Unknown)` (`[1, 1]`).
   - The client resumes that as a panic and catches it in `run_client`. `resume_unwind` runs no hook, so nothing is
     printed.
   - `run` then drops the response and rethrows the kept exception, so the case ends UNPORTED exactly as it would
     with a TS client.
5. **Import order.** `proc_macro_host.ts` value-imports the bridge only through `../proc_macro/lib.ts` (`bridge`
   namespace). This avoids the pm-wiring review's F1 TDZ hazard. Loading host_dylib.ts, proc_macro_host.ts or
   rustc_metadata/lib.ts first works.
6. **TinyCC.** The C file has no system headers, because Bun's TinyCC has no SDK include path. The libc / libdl
   prototypes are declared by hand and resolved from the process. `RTLD_LAZY | RTLD_LOCAL` = `1|4` on macOS and
   `1|0` on Linux, from libloading's consts.rs.

## For root / other owners
- `src/rustc_metadata/rmeta/decoder.ts:176` still has its own `ProcMacroClient = unknown`, plus the casts in
  `load_proc_macro`. These can become `import type { ProcMacroClient } from "../host_dylib.ts"` without casts. That
  is the owner's call; it works as is.
- `src/rustc_metadata/lib.ts`:
  - line 8 says "host_dylib is a stub", which is stale;
  - line 35 keeps `pub use host_dylib::load_symbol_from_dylib` commented out. It can now be exported if
    `rustc_interface::util::load_backend_from_dylib` (which uses it for `-Zcodegen-backend=<path>`) is ever ported.
- **harness-m6b.** The suites can compare the port's stdout + stderr directly; there is no ordering issue with
  output from the dylib. It writes straight to fd 1/2, and the port's diagnostics interleave identically (tested).
  The panic hook's `thread '<unnamed>' (<tid>)` line has an OS thread id that differs per run (compiletest
  normalises it).
- The A4 probe and sweep scratch directories under `$RUST_TS_DATA/tmp` have been removed.
