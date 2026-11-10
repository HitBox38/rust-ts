# Handoff: pm-cross-thread (wave 40i, M6; plan-m6 D8's open item, scout-unported §5 lane 5)

Branch `t3/model-cross-thread-bridge` (from `1b4bf086`). The proc-macro bridge's cross-thread execution strategy is ported:
`MaybeCrossThread::run_bridge_and_client`'s cross-thread arm and `MessagePipe::{new, send, recv}`
(library/proc_macro/src/bridge/server.rs), with a `std::sync::mpsc::sync_channel` stand-in and a
`std::thread::spawn` stand-in in `src/std`. The client runs on a **real second OS thread** (a pthread), the server
loop stays on the JS thread.

**Gain: 2 gate cases**, `tests/ui/proc-macro/expand-expr.rs` in pm-ui and in pm-expanded (both UNPORTED in
`gate-20261110-113508-root-m7vn`, both MATCH now, 3 of 3 reruns).

## 1. The design: how the second thread is modelled

### What upstream does

`run_bridge_and_client` takes the cross-thread arm for `-Zproc-macro-execution-strategy=cross-thread` and, whatever
the flag, for every proc macro started while a same-thread one is running (`ALREADY_RUNNING_SAME_THREAD`): a proc
macro calls `TokenStream::expand_expr`, the server expands a macro call in it, and that call is another proc macro
(`echo_pm!` and `recursive_expand!` in expand-expr.rs). It makes two `sync_channel(1)`s, spawns an unnamed std thread
that runs the client's `extern "C" fn` with a `dispatch` closure (`client.send(b); client.recv().expect(..)`), and the
server thread loops `while let Some(b) = server.recv() { server.send(dispatcher.dispatch(b)) }`, then joins.

The reason it exists is in the source: "the thread-local state in the proc_macro client does not handle being
re-entered, and will invalidate all `Symbol`s when entering a nested macro". The client is the proc-macro dylib's
compiled code; its thread-locals (`BRIDGE_STATE`, the client-side symbol interner that `run_client` clears at the
end of every run, the panic hook's view of the bridge) belong to the OS thread it runs on.

### What can be observed

The exchange is strict ping-pong over channels of capacity 1: the server is blocked in `recv` whenever the client
runs, and the client is blocked in `recv` whenever the server runs. So there is no interleaving of stderr, no race
and no deadlock in any reachable state; the order of every RPC, diagnostic and print is the same as same-thread
execution. What does depend on the thread:

1. **The client's thread-locals.** A nested client must start with a fresh `BRIDGE_STATE` and symbol interner, and
   its end-of-run `Symbol::invalidate_all` must not touch the outer client's symbols. expand-expr.rs checks exactly
   this (`pre_expand_ident.to_string() == "ident"` after `expand_expr` ran `echo_pm!`); a wrong answer is a client
   panic, reported as `error: proc macro panicked` lines the oracle does not print.
2. **The thread name in a proc macro's panic message**, printed when the panic is shown (`-Zproc-macro-backtrace`):
   `thread 'rustc'` same-thread, `thread '<unnamed>' (<tid>)` cross-thread (the tid is masked by the harness).
3. **Stack size** of the client thread (std's `RUST_MIN_STACK` or 2 MiB): only visible as a stack overflow.
4. **Nesting depth.** `recursive_expand!` nests one cross-thread client per level up to the recursion limit (128
   live threads at once, each blocked in `recv` on its own pipe, the server's JS stack holding one dispatch frame
   chain per level).

### Options

- **A. A real second thread in native code (chosen).** The spawned closure is C (proc_macro_host.c
  `rts_client_thread_main`): it builds the `BridgeConfig` with a C `dispatch` closure and calls the dylib's `run`; the
  channels are native (a bounded queue under a pthread mutex/condvar, src/std/thread.c); the thread is a pthread
  created like std's (`Thread::new`: joinable, `RUST_MIN_STACK` or 2 MiB, page rounding on EINVAL, unnamed). The JS
  thread runs upstream's server loop, blocking in an FFI `recv`. The client thread never enters JS: every buffer it
  touches is native and its `reserve`/`drop` are C or the client's own Rust. Faithful in 1 (the dylib's thread-locals
  are a new OS thread's), 2 (the dylib's std sees an unnamed thread: `<unnamed>`, checked below), 3 (same size rule),
  4 (130 nested pipes in the unit test, 128+ in expand-expr.rs).
- **B. Same JS thread, the pipe as a queue.** Run the client synchronously on the JS thread and treat `send`/`recv`
  as a queue. The RPC order would be the same, but the client is native code with OS-thread-local state, which the
  port cannot swap: a nested client would run inside the outer client's thread-locals. That is the re-entrance the
  upstream comment rules out, and in expand-expr.rs it invalidates the outer `expand_expr_is!`'s `Ident`/`Literal`
  symbols (point 1), so the outputs differ. It would also print `thread 'rustc'` for a panic that the oracle prints
  as `thread '<unnamed>'` (point 2). **Not faithful.** (It would fit a TS client, whose "thread-locals" are module
  globals the port could save and restore. No real case has a TS client on this path, so TS clients stay `unported`.)
- **C. A Bun Worker running the client.** The Worker would call the dylib's `run` through its own FFI and post each
  request to the main thread, which would block on `Atomics.wait` over a SharedArrayBuffer. Same fidelity as A for
  points 1–3, but it needs a second copy of the TinyCC trampoline and its JS callbacks inside the Worker, a buffer
  protocol across isolates, and a Worker start (tens of ms) per nested level: 128+ for `recursive_expand!`. No output
  differs from A; A is simpler and cheaper, so C is rejected.

**Decision (`// PORT:` in server.ts's header and in src/std/thread.ts): option A.** Root: please record it.

### Evidence that A is faithful

- Both targets MATCH (pm-ui, pm-expanded), 3 of 3 reruns of the pm-ui case.
- A check outside the harness (scratch script, not committed): **all 282 pm-ui cases** run on both sides with
  `-Zproc-macro-execution-strategy=cross-thread` appended, so every proc macro of the suite runs on a second thread:
  **282 MATCH** (stdout, stderr with the harness's thread-id mask, exit code). That includes
  `load-panic-backtrace.rs` (`-Zproc-macro-backtrace`), where both sides print `thread '<unnamed>' (<tid>) panicked
  at tests/ui/proc-macro/auxiliary/test-macros.rs:38:5:`.
- Option B tried and rejected by experiment: with a temporary edit (reverted, never committed) that ran a nested
  client on the same thread with no guard, expand-expr.rs is a **DIFF** (run `pmct-optB`): the first difference is
  line 3, `error: proc macro panicked` where the oracle has its first parse error, and the subject prints 55 extra
  panics, all `= help: message: use-after-free of \`proc_macro\` symbol`. That is the outer client's symbols
  being invalidated by the nested run, which is point 1 above.

## 2. Files touched

| file | what |
|---|---|
| `src/proc_macro/bridge/server.ts` | the cross-thread arm of `MaybeCrossThread::run_bridge_and_client`; `MessagePipe::{new, send, recv}` (and `drop`); header `PORT:`; `CrossThreadNative` / `set_cross_thread_native` (how the FFI edge supplies the native closure for a dylib client's `run`) |
| `src/std/sync/mpsc.ts` (new) | `sync_channel`, `SyncSender::send`, `Receiver::recv`, `SendError` (+ its `Debug`), `RecvError`, the ends' drops, `into_raw` (an end moved to native code), `chan_fns` |
| `src/std/thread.ts` (new) | `thread::spawn` of a native closure (`NativeThunk`), `JoinHandle::join`, the `RUST_MIN_STACK` / 2 MiB stack rule, `debug_Any`; compiles thread.c |
| `src/std/thread.c` (new) | pthread spawn/join as std's `sys/thread/unix.rs` `Thread::new`; the bounded native channel |
| `src/std/sync/mpsc.test.ts`, `src/std/sync/mpsc_test_echo.c` (new) | tests of the channel and the pipe, with a native echo client thread |
| `src/rust_ts/proc_macro_host.ts`, `src/rust_ts/proc_macro_host.c` | **outside the brief's list, see below**: the native body of the spawned closure (`rts_client_thread_main`, the `dispatch` closure over the pipe), the `Buffer` codec for the channel, and registering each dylib client's `run` |

The call site that selects the strategy, `src/rustc_expand/proc_macro.ts` `exec_strategy`, needed no change (it
already builds `MaybeCrossThread(sess.opts.unstable_opts.proc_macro_execution_strategy === "CrossThread")`).

**Why proc_macro_host.{ts,c} changed.** The spawned closure must be native code (it runs on a thread with no JS), and
it calls the dylib's `extern "C" fn(BridgeConfig) -> Buffer` with a `Closure` by value: that is the `#[repr(C)]`
bridge ABI, which lives only in proc_macro_host.c (the TinyCC unit that already makes the same-thread call). The
alternative was a copy of those layouts in a new C file of the bridge. The edits are additive: the same-thread path
is unchanged except that `dylib_run` now registers its `run` with `set_cross_thread_native`.

## 3. Coverage

- `bun scripts/coverage.ts --missing library/proc_macro/src/bridge/server.rs`: **20/20 ported** (the three
  `MessagePipe` fns were markers on `unported` bodies; now real).
- `library/std/src/sync/mpsc.rs`: 4/34 (`sync_channel`, `SyncSender::send`, `Receiver::recv`, `SendError`'s `Debug`).
- `library/std/src/thread/functions.rs`: 1/11 (`spawn`); `thread/join_handle.rs`: `join`; `core/src/any.rs`:
  `<dyn Any as Debug>::fmt`.

## 4. Tests and samples

- `bun test src/std src/proc_macro src/rust_ts/proc_macro_host.oracle.test.ts`: all pass (the new mpsc.test.ts: 10
  tests: order and bound, both disconnect rules, the drop-with-messages stop, bound 0, moved ends, ping-pong with a
  native client thread, a client blocked while the server works, two nested pipes, 130 nested levels).
  `bridge.test.ts`'s "cross-thread is unported" test still passes: it uses a TS client, which stays `unported`.
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok.
- `--sample 200 --jobs 6` (`RUST_TS_AGENT=pm-cross-thread`), runs `pmct-s-<suite>`:
  - pm-ui: **200/200 MATCH**
  - pm-expanded: **200/200 MATCH**
  - mir: **200/200 MATCH**

  No protected case is non-MATCH.
- Targets: `pmct-ui-2` (pm-ui) and `pmct-exp-1` (pm-expanded), expand-expr.rs MATCH; `pmct-ui-r1..r3` rerun the pm-ui
  case, all MATCH.

## 5. `unported(..)` left

- `proc_macro::bridge::server::MaybeCrossThread::run_bridge_and_client (cross-thread execution of a TS client: ...)`
  — a client that is a TS function (tests' `Client.expand1`, ...) cannot run on another thread (option B above
  would be needed). No real case reaches it.
- `std::sync::mpsc::sync_channel (bound 0: a rendezvous channel)` — not used.
- `std::sync::mpsc::Receiver::drop (messages left in a native channel)` — the native channel cannot run `T`'s drop;
  the bridge never leaves a message behind.
- `std::thread (native threads on <platform>)` — Windows.
- `std::thread::spawn (pthread_create failed: errno N)` — std panics `failed to spawn thread: {io::Error:?}`; the
  port does not format the OS error here.
- `std::thread::JoinHandle::join (pthread_join failed: N)` — std asserts.
- `std::thread::spawn (RUST_MIN_STACK=N above 2^53)`.

## 6. `// PORT:` decisions

- server.ts header: the threading decision (option A); TS clients stop with `unported`.
- server.ts `run_bridge_and_client`: the spawned closure is native (`CrossThreadNative.client_thread`); a JS
  exception out of `dispatch` (an `unported` or a port bug; panics are caught by the dispatcher) is kept, answered
  with `Err(PanicMessage::Unknown)` and rethrown after the join, as proc_macro_host.ts already does for same-thread
  dylib clients. Without it the client thread would wait forever, or dropping the server's end would make the client
  abort ("server died while client waiting for reply" inside an `extern "C"` closure), turning exit 70 into a crash.
- server.ts `MessagePipe::new` takes the `NativeCodec` of `T` (the message crosses native memory).
- mpsc.ts: the channel is native, a message is a `#[repr(C)]` value of N words moved by copy through a codec; one
  sender (no `clone`); `into_raw` moves an end to native code, which then owns its drop.
- thread.ts: `spawn` takes a `NativeThunk` (C entry point + argument + how to read the return value after `join`);
  `join` is always `Ok` (a native closure cannot unwind); not reproduced: spawn hooks, output capture, `Thread` /
  `ThreadId`, and std's stack-overflow handler (an overflow on the client thread is a plain SIGSEGV/SIGBUS instead of
  "has overflowed its stack" + SIGABRT; no case overflows).
- proc_macro_host.c `rts_pipe_dispatch`: the `unwrap`/`expect` failures abort, as a panic out of the `extern "C"`
  `Closure::call` does upstream (and neither can happen: the server keeps its end until the join).

## 7. Notes for root

- The new pthread machinery runs only when a cross-thread run happens (expand-expr.rs, or the flag); thread.c is
  compiled by TinyCC on first use, like proc_macro_host.c.
- Each nested level is one pthread with a 2 MiB stack reservation (virtual); 128 levels is 256 MiB of address space,
  not resident memory.
- Windows: `unported` (no pthreads in TinyCC there), like the rest of proc_macro_host.
- A `-Zproc-macro-execution-strategy=cross-thread` report suite would be cheap (pm-ui's cases with the flag): 282/282
  MATCH today, and it would keep this path covered beyond the one gate case.
