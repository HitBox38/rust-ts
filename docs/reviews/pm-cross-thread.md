APPROVE WITH NITS

# Review: pm-cross-thread (wave 40i), independent reviewer

Branch `t3/model-cross-thread-bridge`: `d7170d9c` (the port and its tests) and `c83b5052` (the handoff). I reviewed
`git diff 1b4bf086...t3/model-cross-thread-bridge` (9 files, +1193/-22) against the pinned upstream:
`library/proc_macro/src/bridge/server.rs` (lines 186-250), `library/std/src/thread/lifecycle.rs` (`spawn_unchecked_`'s
stack-size closure), `library/std/src/sys/thread/unix.rs` (`Thread::new`, `min_stack_size`), `library/std/src/sync/mpsc.rs`,
`library/core/src/any.rs`, libc 0.2.189 (the version in `library/Cargo.lock`) and `docs/plan-m6.md` D8. I read every line
of the three C files.

There are no must-fix findings. The port is faithful where output can depend on it. The C is correct for the strict
ping-pong the bridge uses, and nothing I ran was flaky. The nits below are comment and handoff errors, plus two
unreachable error paths whose handling differs from upstream's.

## What I ran (worktree detached at `c83b5052`, AC power, `RUST_TS_AGENT=rev-pmct`, source mode unless noted)

| check | result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check` | markers ok (24896) |
| `coverage.ts --missing library/proc_macro/src/bridge/server.rs` | 20/20 |
| `bun test src/std/sync/mpsc.test.ts`, 5 times | 10 pass, 0 fail, every time |
| `bun test src/std src/proc_macro src/rust_ts/proc_macro_host.oracle.test.ts` | 111 pass, 0 fail |
| pm-ui `--filter proc-macro/expand-expr.rs`, 10 runs (`rev-pmct-r-pm-ui-1..10`) | MATCH 10/10 |
| pm-expanded, same case, 10 runs (`rev-pmct-r-pm-expanded-1..10`) | MATCH 10/10 |
| pm-ui `--sample 200 --jobs 6` (`rev-pmct-s-pm-ui`) | 200/200 MATCH |
| pm-expanded `--sample 200 --jobs 6` (`rev-pmct-s-pm-expanded`) | 200/200 MATCH |
| all 282 pm-ui cases with `-Zproc-macro-execution-strategy=cross-thread` appended on both sides (my own script, pool 5, stdout + `maskThreadId`/`maskLongTypeHash` stderr + exit) | **282/282 MATCH** |
| `RUST_TS_SUBJECT=binary`: expand-expr.rs in pm-ui and pm-expanded | MATCH, MATCH (the builds keyed to my worktree were deleted afterwards) |

I also built a probe proc-macro dylib with the oracle, in the scratchpad and not committed. Each probe case ran on both
sides, same-thread and with the cross-thread flag:
- **Thread name:** a client printing `thread::current().name()` MATCH; so does a client that `std::thread::spawn`s and
  joins its own thread.
- **Nesting:** a client calling `expand_expr` on another proc macro (the implicit nested cross-thread path) MATCH.
- **Panics:** a panicking client MATCH. With `-Zproc-macro-backtrace` MATCH too, and both sides print
  `thread '<unnamed>' (<tid>) panicked at`.
- **`std::process::exit(3)`** on the client thread, while the JS thread is blocked in `recv`: MATCH (exit 3).
- **Stack-size rule:** a recursive client at several depths. Both sides succeed or overflow at the same depths: under
  the default 2 MiB (80 levels ok, 88 overflow), `RUST_MIN_STACK=1048576` (40 ok, 80 overflow), `RUST_MIN_STACK=4194305`
  (100 and 120 ok; this exercises the EINVAL page-rounding path) and `RUST_MIN_STACK=0`. Values that fail to parse
  (`abc`, `-8388608`) MATCH because rustc itself rejects them first. Only the crash text of an overflow differs (N3).

## 1. Fidelity

- `run_bridge_and_client` (server.ts:554-602) follows upstream's order. `MessagePipe::new` creates two `sync_channel(1)`s
  and returns (server, client) as `{tx1, rx2}`, `{tx2, rx1}`. `spawn` follows with `input` and `client` moved into the
  closure, then the `while let Some(b) = server.recv() { server.send(dispatcher.dispatch(b)) }` loop, then
  `join().unwrap()`, then `server` is dropped after the join. `send` is `unwrap` with `SendError { .. }` and `recv` is
  `.ok()`. The same-thread arm is unchanged.
- The spawned closure (proc_macro_host.c `rts_client_thread_main`) builds `BridgeConfig { input, dispatch, force_show_panics }`,
  and `dispatch` sends then receives. When the closure returns it drops `client`'s fields in declaration order (`tx`,
  then `rx`), as Rust drops captures. The server's `recv` wakes on the `tx` drop, and the `rx` drop finishes before
  `pthread_join` returns.
- Spawn (thread.c / thread.ts):
  - It is unnamed and joinable.
  - `RUST_MIN_STACK` is read once into a `MIN`+1 sentinel, as `lifecycle.rs:29-44` does.
  - Parsing follows `to_str().and_then(parse::<usize>)`: invalid UTF-8 fails, a BOM is kept (so it fails), an optional
    `+` is allowed, a `-` fails, and values above u64 fail. Values above 2^53 stop with `unported` rather than a guess.
  - The size is `max(stack, min_stack_size)`, with the EINVAL page rounding using the same mask expression as upstream.
- `join` is always `Ok`, and that is right: the closure is an `extern "C"` call chain, which cannot unwind.
- Buffer ownership:
  - `input` is copied into the captures and owned by the client from then on.
  - The response comes back through `ClientThread.out`, which is read and freed only after the join.
  - The `fns` array and the input struct are copied synchronously, so no JS memory is shared with the thread.
- Markers: I checked mpsc.rs 181/399/414/425/576/709/889/1162, functions.rs:125, join_handle.rs:71/149 and any.rs:154 by
  hand. All point at the right items. The `SendError` and `dyn Any` `Debug`s are `finish_non_exhaustive`, as upstream.

## 2. Memory and thread safety

- **The client thread never enters JS.** It calls only the dylib's code, `rts_pipe_dispatch`, and thread.c's channel
  functions through `rts_chan_fns` pointers. Buffers created by the server always carry the C `rts_reserve`/`rts_drop`
  (`write_native` copies a TS-memory buffer into a native one), and the client's own buffers carry the dylib's Rust
  functions. No `JSCallback` pointer can reach a `Buffer` the thread touches. `rts_dispatch_call` and its `JSCallback`
  are used only by same-thread clients on the JS thread.
- **The channel** is one mutex and one condvar with `broadcast` on every state change. Both waits are predicate loops
  under the mutex (`len == cap && receivers`, `len == 0 && senders`), so there are no missed or spurious wakeups. The
  mutex also orders the data writes: the request bytes are written before `send` and read after `recv`.
- **Use-after-free:** every channel is freed on the JS thread after the join (chan1 by the server's `tx` drop, chan2 by
  its `rx` drop). The client's drops only decrement counts, so it never frees a channel the server might still touch.
  The server's `Uint8Array` views of buffers it has sent back become dangling but are never used, the same as on the
  same-thread path.
- **Client panic:** `run_client` catches it, and the client returns `Err` as usual (probe MATCH).
- **Client `exit`:** MATCH (probe).
- **Client `abort`:** the process dies with SIGABRT on both sides, but Bun's crash reporter adds about 20 lines to the
  port's stderr. That is equally true same-thread (probe DIFF in both modes), so it predates this lane (N7).
- **Threads at process end:** the strict ping-pong means the JS thread can only end the process while the client is
  blocked in `recv` (after an exception escaping before the join, e.g. `unported`). The OS reaps the thread. Rust TLS
  destructors run on the client thread before `pthread_join` returns, so their output cannot interleave either.
- **`unported` and port bugs** in a server method are kept, answered `Err(PanicMessage::Unknown)` and rethrown after the
  join, mirroring proc_macro_host.ts's same-thread handling. `FatalErrorMarker` is not an `Error`, so the dispatcher's
  `catch_unwind` takes it, as upstream's does.

## 3. Determinism

The two threads never run at the same time: whenever one runs, the other is blocked in `recv`. So stdout and stderr
order are those of same-thread execution. The only thread-dependent text is the tid in a panic line, and `maskThreadId`
covers any thread name. 20/20 target reruns, 282/282 forced and 400/400 sampled cases matched: no flake.

## 4. Robustness and portability

- **TinyCC:** thread.c is compiled by `bun:ffi`'s `cc` on first use, so only when a cross-thread run happens. If `cc`
  fails, the JS `Error` escapes as a CRASH with a stack. That is not silent and matches the existing `native()` in
  proc_macro_host.ts (N6).
- **Binary mode works.** thread.c is not in the subject-bin key: it is not a bundle input, and the plugin turns
  `import.meta.dir` into the source path, so the binary compiles the tree's `src/std/thread.c` at run time. A changed
  `.c` therefore cannot make a cached binary stale: it behaves as source mode does. This is the arrangement
  proc_macro_host.c already has. Not a finding, but the subject-bin audit list could say so (N8).
- **Windows** stops with `unported`. **Linux** is unchecked, as elsewhere. The opaque 128-byte blocks cover glibc's
  sizes, and `dlsym(0, "__pthread_get_minstack")` is right for glibc. The `PTHREAD_STACK_MIN` fallback is wrong off the
  root host (N1).

## 5. The edit outside the file list

proc_macro_host.{ts,c} is justified: the `#[repr(C)]` `Buffer`/`Closure`/`BridgeConfig` layouts and the by-value
`RunFn` call live only in that TinyCC unit, and copying them into a second unit would be worse. It is minimal and
additive. The same-thread path changes only in that `dylib_run` registers `f` with `set_cross_thread_native`, which
builds a small object and calls no native code. pm-ui and pm-expanded samples were 200/200 each, and the same-thread
probe runs matched.

## 6. The threading decision

I agree that option A (a real pthread) is the faithful choice. The client is native code whose thread-locals
(`BRIDGE_STATE` and the client symbol interner that `run_client` invalidates at the end of every run) belong to the OS
thread, and nothing in the port can swap them. The option-B evidence is convincing: 55 `use-after-free of proc_macro
symbol` panics are exactly what upstream's comment on `ALREADY_RUNNING_SAME_THREAD` predicts. A Worker (option C) adds a
second FFI copy and a cross-isolate protocol and changes no output. Root can record option A, but correct the second
argument against B first (N4).

## Nits

- **N1. `src/std/thread.c:36-38`**: `RTS_PTHREAD_STACK_MIN 16384` is cited as libc's value "on macOS (aarch64 and
  x86_64) and on Linux glibc". It is only right for aarch64-apple-darwin and glibc x86_64. libc 0.2.189 has 8192 for
  x86_64 apple (`src/unix/bsd/apple/mod.rs:2545`), 131072 for glibc on aarch64 and most other arches
  (`linux/gnu/mod.rs:977`) and 2048 for musl (where upstream does not call `__pthread_get_minstack` at all, while the
  port's `#ifdef __linux__` does). It matters only when `RUST_MIN_STACK` is below the floor. Make the constant
  per-target (`#if defined(__x86_64__)` etc.) or restrict the comment and the platform check to what is validated.
- **N2. `src/std/thread.c:77-79,82`**: when the second `pthread_attr_setstacksize` fails, upstream returns
  `Err(InvalidInput, "invalid stack size")`, which `spawn` turns into the panic `failed to spawn thread: ..` (an ICE).
  The port calls `abort()`. Return the error to TS and stop with `unported`, as the `pthread_create` failure already
  does. Upstream also asserts that `pthread_attr_destroy` returns 0, and the port ignores the result. Neither path is
  reachable on macOS or glibc.
- **N3. `src/std/thread.ts:11-14`** and handoff §6 say the oracle's client-thread overflow is std's "has overflowed its
  stack" message followed by SIGABRT. The oracle on the root host actually prints rustc_driver's
  `error: rustc interrupted by SIGBUS, printing backtrace` with frames and exits 138. The port prints Bun's crash report
  and exits 132 (SIGILL), not "a plain SIGSEGV/SIGBUS". The thresholds match (see the probe), so only the comment is
  wrong. A same-thread overflow inside a dylib presumably crashes the port the same way already.
- **N4. Handoff §1 point 2 and option B's second reason**: the claim that same-thread prints `thread 'rustc'` is wrong.
  The oracle prints `thread '<unnamed>' (<tid>)` same-thread too (probe, `-Zproc-macro-backtrace`, no flag). The hook
  runs in the dylib's own libstd, which never learns rustc's thread name. Point 1 alone decides the question. Fix the
  text before root records the decision.
- **N5. `src/proc_macro/bridge/server.ts:574-602`**: no test covers the exception path (a JS error out of
  `dispatcher.dispatch` while the client is on the second thread: answered `Err(Unknown)`, the client joined, the error
  rethrown, the result dropped). mpsc.test.ts uses an echo fixture, not the bridge. No real case reaches this path, so
  this is optional, but it is the one piece of new control flow left untested.
- **N6.** A TinyCC failure in `native_sync()` is an uncaught JS `Error`, not one `unported(..)`. That is consistent
  with proc_macro_host.ts; wrapping both in one place would give the `ERROR:`/`unported` form. Optional.
- **N7 (predates this lane).** `std::process::abort()` in a proc macro adds Bun's crash report to stderr in both
  strategies. Worth a note in docs/next.md if a pm case ever aborts. None does at the pin.
- **N8 (observation).** docs/handoff/subject-bin.md's audit could list the run-time `.c` sources (proc_macro_host.c and
  now thread.c): they are why a binary is tied to its tree, and why they need no place in the key.
