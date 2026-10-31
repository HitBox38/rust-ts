# Handoff: pm-bridge (wave 35, M6): library/proc_macro/src/bridge/* → src/proc_macro/bridge/*

Branch `t3/b7f5e303` (from `b0008692`). Plan: `integ-w35:docs/plan-m6.md` §3, D7, D8 (A4).

## Files touched
All under `src/proc_macro/bridge/` (the lane's files). Nothing else is edited: no lib.ts, no rustc_expand, no scripts.
- `mod.ts` (rewritten, existing types kept): `BridgeConfig`, `ApiTags` (+ `ApiTags_variants`, codecs), `Mark`
  (+ the identity impls `Mark_Marked`, `Mark_ref_Marked`, `Mark_Vec`, `Mark_noop`, `Mark_compound_struct` / `_enum`).
  It also has every `rpc_encode_decode!` / `compound_traits!` expansion in upstream order: Delimiter, Level, LitKind,
  Bound, Option, Result, DelimSpan, Group, Punct, Ident, IdentKind, Literal, TokenTree, Diagnostic, ExpnGlobals, Range.
  It re-exports `Buffer`.
- `buffer.ts` (new): `Buffer` (`repr(C)` fields `data`/`len`/`capacity`/`reserve`/`drop`). It also has the
  `Vec<u8>` raw-parts helpers, including `vec_reserve`, which follows RawVec `grow_amortized`.
- `rpc.ts` (new): the `Encode` / `Decode` function types and the primitive impls: `()`, u8, u32, usize, bool,
  `NonZero<u32>`, `(A, B)`, `&str`, `String`, `Vec<T>`.
- `handle.ts`, `fxhash.ts`, `arena.ts`, `closure.ts`, `selfless_reify.ts`, `symbol.ts` (new).
- `panic_message.ts`: completed. It adds both `From` impls (`PanicMessage.from`, `PanicMessage.into_payload`) and
  the codecs, plus the `catch_unwind` / `resume_unwind` helpers.
- `client.ts` (rewritten). It has:
  - `TokenStream`, the client `Span` (a branded number) and `debug_Span`;
  - `Symbol` (re-exported from symbol.ts);
  - `Methods` (all 31 `with_api!` fns), `Bridge`, `state`, `is_available`;
  - `Client` with `run`, `expand1`, `expand2`, plus `run_client` and `maybe_install_panic_hook`;
  - the codecs for `crate::TokenStream`.
- `server.ts` (rewritten). It has:
  - `HandleStore` and the handle codecs;
  - the `Server` interface (unchanged shape) and `ServerStatics`;
  - `Dispatcher.dispatch` (all 31 arms);
  - `ExecutionStrategy`, `RunningSameThreadGuard`, `MaybeCrossThread`, `MessagePipe`;
  - `run_server`, and `Client.run1` / `run2`, which are now real (no longer `unported`).
- `bridge.test.ts` (new): 25 unit tests, described below.

## Coverage
`bun scripts/coverage.ts --missing <file>` **does not count `// std:` markers**. It only reads `// rustc:`, so it
reports 0/N for library/ files, including the six `// std:` markers that already existed. The `// std:` convention
comes from decision 2026-10-13 (history line 97). I checked with an ad-hoc script outside the repo
(`/tmp/pmb/stdcov.ts`). It runs coverage.ts's own `upstreamFns` against `// std:` / `// std-skip:` markers and
checks each marker's line and name:

| file | covered |
|---|---|
| mod.rs | 47/47 |
| buffer.rs | 13/13 |
| rpc.rs | 26/26 |
| handle.rs | 7/7 |
| symbol.rs | 15/15 |
| fxhash.rs | 9/9 |
| closure.rs | 3/3 |
| selfless_reify.rs | 2/2 |
| arena.rs | 5/5 |
| panic_message.rs | 6/6 |
| client.rs | 22/22 |
| server.rs | 20/20 |
| **total** | **175/175, no marker pointing at a wrong line or name** |

- **New marker form `// std-skip: <path>:<line> <name> <reason>`**, used 3 times for the 32-bit `cfg` arms: rpc.rs:128,
  rpc.rs:143, fxhash.rs:82. The hosts are 64-bit.
- **Harness request (root, separate batch):** teach coverage.ts `--missing` / `--check` to read `// std:` and
  `// std-skip:` markers for `library/` paths.
- Marker conventions used:
  - The `with_api!` lines (mod.rs:36–79) mark the client `Methods` fns that `define_client_side!` generates.
  - The `rpc_encode_decode!` expansions carry rpc.rs:39/48 (struct) or rpc.rs:64/78 (enum).
  - Trait method declarations (rpc.rs:8/12, mod.rs:153/154, server.rs:75/78/81/138) sit on the TS type or interface
    members.
- `bun scripts/coverage.ts --check --offline`: `markers ok (23169; vendor 4680)`.

## Verification
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/proc_macro src/rustc_expand`: **267 pass, 0 fail** (bridge.test.ts plus the existing
  proc_macro_server oracle test).
- `bun scripts/difftest.ts --suite expanded --sample 100` (`RUST_TS_AGENT=pm-bridge`): **100/100 MATCH**, 0 UNPORTED,
  skipped=3. Run `20261031-224656-pm-bridge-9mxu`. The `quote!` cases still stop where they did, because
  `quote_client` in rustc_builtin_macros is not wired yet (see below).

bridge.test.ts checks expected bytes derived from rpc.rs / mod.rs:
- `u32` / `usize` LE (usize is 8 bytes), `bool`, `&str` (usize length + UTF-8);
- Vec; Option (**Some = 0, None = 1**); Result (Ok = 0, Err = 1); Bound;
- the `ApiTags` indices (track_env_var 0, ts_drop 4, ts_into_trees 13, span_debug 14,
  symbol_normalize_and_validate_ident 30);
- LitKind tags with raw hash counts;
- TokenTree field order; PanicMessage as `Option<&str>`.

It also checks behaviour:
- **Buffer**: growth (cap 0 → 8 → doubling, or `required` when larger); growth through a foreign `reserve` fn;
  `drop_` calling the owner's `drop`.
- **Handle stores**: counter, `take` / use-after-free, interning.
- **Client symbol interner**: `sym_base` shift on `invalidate_all`; use-after-free; `new_ident` panics.
- **Dispatcher**: request/response bytes, including a use-after-free returned as `Err(Some(msg))`.

Finally, it runs **full in-process round trips** (`Client.expand1` / `expand2` → `run1` / `run2` → same-thread
dispatch → a toy server) for:
- token trees, globals, spans, diagnostics, `literal_from_str`, `ts_expand_expr`;
- non-ASCII `new_ident` via RPC;
- a `None` output becoming the default stream;
- client panics, server panics resumed in the client, and use-after-free of a moved stream.

The wire format has **not** been checked against a real oracle-built client yet. That needs the FFI edge, so it is
the first thing `pm-host` should test.

## `unported(...)` left
1. `proc_macro::bridge::server::MaybeCrossThread::run_bridge_and_client (cross-thread …)` (server.ts). This runs for
   `-Zproc-macro-execution-strategy=cross-thread`, and for a proc macro nested inside a same-thread one (via
   `expand_expr`). It needs a second thread with its own client thread-locals.
2. `MessagePipe::new` / `send` / `recv` (server.ts): `mpsc::sync_channel` between threads. Unreachable while (1)
   stands.
3. `proc_macro::bridge::server::Client::run (the server class has no static default_TokenStream)` (server.ts). This
   fires when a client returns an empty stream (`None`) and the server class lacks `default_TokenStream`. See the
   integration notes.
4. `proc_macro::TokenStream (lib.rs has not installed bridge::client::crate_TokenStream.new_)` (client.ts). This is
   the hook lib.ts must set.
5. `proc_macro::bridge::client::maybe_install_panic_hook (printing a proc-macro panic: -Zproc-macro-backtrace)`
   (client.ts). It fires when a TS client (`quote!`) panics with `force_show_panics`, where upstream's hook would print
   the panic.

Removed: the two `unported` calls in `Client::run1` / `run2`.

## `// PORT:` decisions (root: record what you accept)
- **Codecs.**
  - Traits as functions: `Encode<T, S>` / `Decode<T, S>` are function types; impls are `encode_<T>` / `decode_<T>`.
  - Generic impls take their type parameters' codecs as trailing arguments.
  - `r: &mut &[u8]` is a `MutRef<Uint8Array>` that is re-sliced as it is read.
  - Decoded `&str`s are copied into JS strings.
- **`usize`** is 8 LE bytes (the hosts are 64-bit). Decoding a value ≥ 2^53 panics.
- **`Marked<T, M>`** is `T`, and every `Mark` impl is an identity (`&Marked`'s `mark` stays `unreachable!()`).
  `dispatch` still calls `unmark` / `mark` where upstream does.
- **Name clashes between fields and methods.**
  - `impl Drop for Buffer` is `drop_()`, because the field `drop` is the owner's fn.
  - `Closure::call` is `call_()`, because the field `call` is the `extern "C"` fn.
- **Implicit drops that matter are explicit.**
  - `run_server` calls `buf.drop_()` on the client's response. For a dylib, that buffer is native memory freed by the
    dylib's `drop` fn.
  - When `f` panics, `run_client` drops the cached buffer.
  - Client `TokenStream` drops (the `ts_drop` RPC) are **not** performed. They only free entries in the per-expansion
    server store. `TokenStream.drop_()` exists for explicit use. pm-lib does the same.
- **The server's associated fns** (`intern_symbol`, `with_symbol_string`) and the `TokenStream: Default` bound are
  `ServerStatics`, read from `server.constructor`. `HandleStore` carries them as field `S`, standing for the type
  parameter.
  - This keeps the `client.run1(strategy, server, …)` call sites in rustc_expand unchanged.
  - `default_TokenStream` is optional in the type; a server without it hits unported (3) when it is needed.
- **Handle counters** (`static TOKEN_STREAM` / `SPAN: AtomicU32 = 1`) are module-level and process-wide, as upstream.
  `fetch_add` wraps at 2^32.
- **`catch_unwind`** catches `Panic`s and non-`Error` throwables, such as `FatalErrorMarker` (which becomes
  `PanicMessage::Unknown`, as in rustc). Other JS `Error`s propagate: `Unported`, stack-overflow `RangeError`, and
  `TypeError` and similar port bugs.
- **`PanicMessage::from`** maps any `Panic` to `String`, since TS panics do not distinguish `&'static str` payloads.
  This is unobservable: both cross as `Some(str)` and decode as `String`.
- **Panic hook.** TS has no panic hooks; see unported (5).
- **`FxHashMap`** is `Map`. Lookups only, so iteration order is never observed; `InternedStore` keys must be
  primitives (server Spans are branded numbers). `FxHasher` is ported but unused.
- **`Arena::alloc_str`** copies the UTF-8 bytes into byte chunks as upstream does, then returns the JS string.
- **RefCell borrow flags** keep core's panic texts: `INTERNER` (`already borrowed: BorrowMutError`, …) and the client
  `RefCell<Bridge>` (`… already in use: BorrowMutError`).
- **`crate::TokenStream`** is typed structurally (`CrateTokenStream { _0 }`) in client.ts, and built through
  `crate_TokenStream.new_`. lib.ts imports the bridge, and its `TokenStream` does not exist on this branch.
  Agreed with pm-lib over a cross-session message: they export
  `class TokenStream { constructor(public _0: client.TokenStream | undefined) }`.

## Integration (root, at merge with pm-lib)
1. **lib.ts (pm-lib):** after `class TokenStream`, set
   `bridge.client.crate_TokenStream.new_ = (x) => new TokenStream(x);`. The alternative is to replace the hook with a
   direct import in client.ts.
   - pm-lib's `PORT(contract): pending pm-bridge` block names exports that all exist here:
     - client.ts: `Methods`, `is_available`, `TokenStream` (with `handle`, `clone()`), `Span` (with
       `def_site` / `call_site` / `mixed_site`), `debug_Span`;
     - symbol.ts, re-exported by client.ts: `Symbol` (with `new` / `new_ident` / `with`), `debug_Symbol`,
       `display_Symbol`.
2. **rustc_expand/proc_macro_server.ts:** add to `Rustc`
   `static default_TokenStream(): TokenStream { return TokenStream_.default(); }` (rustc_ast tokenstream.ts:858).
   Otherwise an empty proc-macro output hits unported (3).
3. **rustc_builtin_macros/lib.ts:** `quote_client` becomes `new BangProcMacro(Client.expand1(quote))`, with
   `quote` from pm-lib's lib.ts. This targets the 30 `quote!` cases.
4. **Stale headers:** rustc_expand/proc_macro.ts lines 3–6 and the top comment of proc_macro/lib.ts still say
   `run1` / `run2` are unported.

## What `pm-host` needs (D7)
- **Entry points.** `ProcMacroClient` is `bridge::client::Client`; `rustc_metadata/host_dylib.ts` currently types it
  `unknown`. For each entry of the dylib's `&[Client]` slice, build `new Client(run)`, where `run(config: BridgeConfig)
  => Buffer` calls the dylib's `extern "C" fn(BridgeConfig) -> Buffer` through the C trampoline.
- **`#[repr(C)]` layouts** (64-bit):
  - `Buffer` = `{ data: *mut u8, len: usize, capacity: usize, reserve: extern "C" fn(Buffer, usize) -> Buffer, drop:
    extern "C" fn(Buffer) }`, 40 bytes;
  - `Closure` = `{ call: extern "C" fn(*mut Env, Buffer) -> Buffer, env: *mut Env }`;
  - `BridgeConfig` = `{ input: Buffer, dispatch: Closure, force_show_panics: bool }`;
  - `Client` = `{ run: fn ptr }`.
- **Buffers crossing to the dylib.** `run_server` makes its input with `Buffer.new()`, which is TS memory with TS
  `reserve` / `drop`. The client reads it, then writes its own output into it through the buffer's `reserve`. So every
  buffer handed to native code must be native memory with C-callable `reserve` / `drop`, for example a
  malloc/realloc/free pair in the trampoline. Wrap it as a TS `Buffer` whose `data` is a `Uint8Array` view of the
  native allocation (`toArrayBuffer(ptr, 0, capacity)`) and whose `reserve` / `drop` call the native fns and re-wrap
  the result. Buffer's methods only touch `data` / `len` / `capacity` and call `reserve` / `drop`, so a native-backed
  `Buffer` works unchanged; `bun:ffi`'s `ptr(view)` should give the address back.
- **Dispatch from native code.** The native client calls `dispatch.call(dispatch.env, buf)` with its own native
  buffer. The trampoline's `JSCallback` should wrap `buf` as above, run `dispatcher.dispatch(buf)` (that is, the TS
  `Closure.call_`), and write the returned buffer's five fields back as the by-value result. `dispatch` may grow the
  buffer through the client's `reserve`, which yields a new allocation.
- **Response buffers.** `run_server` decodes the client's response and then calls `buf.drop_()`, so the dylib's `drop`
  fn frees it.
- **Execution strategy.** Same-thread only (`MaybeCrossThread(false)`); cross-thread is unported (1). A panic that
  does not unwind inside the dylib aborts the process, as in rustc.
- **First test to write:** run an oracle-built proc macro that echoes its input (plus one `Span::call_site()`
  `Ident`). That confirms the byte format end to end: handles, `ExpnGlobals` order, `Option` tags, symbols as
  strings.
