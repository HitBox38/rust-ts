# Handoff: fixers-36 (port-side follow-ups from the wave-36 reviews)

Branch `t3/206c45fb`. Files touched (tests only; no port file changed):

- `src/miri/concurrency/threads.test.ts`: item 2 (RealTime arm tests; `make_ecx` takes `communicate`).
- `src/rust_ts/proc_macro_host.oracle.test.ts`: item 3 (failure-path tests pin the oracle's text; the dlopen case
  now really reaches dlopen).
- `docs/handoff/fixers-36.md` (this file).

No `unported(...)` added, no `// PORT:` decisions, no markers changed.

## 1. `tests/ui/consts/const-eval/do_not_const_check.rs`: diagnosed, not a const-eval divergence; root cause is unported ICE reporting (write-up, no partial fix)

**Reproduction** (the `mir` suite's exact argv, from `harness/suites.ts`: `--target x86_64-unknown-linux-gnu --sysroot
<oracle sysroot> --edition=2015 -Zwrite-long-types-to-disk=no -Zunpretty=mir <file>`, env `RUSTC_ICE=0
RUST_BACKTRACE=0`, cwd = upstream checkout). Both exit 101, both stdouts are empty and identical. Stderr with
`thread 'rustc' (<tid>)` masked: the two warnings are identical; then

- oracle: `error: internal compiler error: /rustc-dev/<sha>/compiler/rustc_const_eval/src/const_eval/machine.rs:460:21:
  calling non-const function `mostly_harmless`` + span snippet, `thread 'rustc' (TID) panicked at ...machine.rs:460:21:
  Box<dyn Any>`, the report_ice notes, the query stack, then **the same again for `integer_min::<i32>`**, then
  `error: aborting due to 2 previous errors; 2 warnings emitted`.
- port: `warning: 2 warnings emitted`, then `rust-ts: internal compiler error: calling non-const function
  `integer_min::<i32>`` + a JS stack.

**The port's control flow matches rustc's.** A temporary probe at the `span_bug` in
`src/rustc_const_eval/const_eval/machine.ts:248` (removed again) printed `mostly_harmless` then `integer_min::<i32>`:
the port evaluates both anonymous consts in rustc's order, through the same path (`analysis` ->
`run_required_analyses` -> `check_crate` -> `par_hir_body_owners` -> `par_for_each_in` -> `eval_to_const_value_raw`
x2 -> `eval_to_allocation_raw` -> `find_mir_or_eval_fn`). Each `span_bug!` panic is caught by `ParallelGuard::run`,
which keeps the **last** panic (`parallel.rs:22`: `if panic.is_none() || !err.is::<FatalErrorMarker>() { *panic =
Some(err) }`), and `parallel_guard` resumes it: in rustc too the resumed panic is `integer_min::<i32>`'s. So "rustc
panics on `mostly_harmless`, the port on `integer_min`" is only how the outputs look: rustc *prints* the first ICE at
the moment of the first `span_bug!`, the port prints nothing until the final, resumed panic reaches `main.ts`.

**Root cause: two unported pieces of rustc's ICE path.**

1. `compiler/rustc_interface/src/callbacks.rs:90 emit_bug_diagnostic` (coverage: callbacks.rs 3/6, this one missing;
   `setup_callbacks` leaves `rustc_span::macros::EMIT_BUG_DIAGNOSTIC` at its default). Upstream, every
   `bug!`/`span_bug!` with a `tcx` in TLS emits `DiagInner::new(Level::Bug, format!("{location}: {args}"))` with the
   span through `tcx.dcx().emit_diagnostic` *before* panicking with `ExplicitBug`. That is what prints the
   `error: internal compiler error: <file>:<line>:<col>: ...` block and counts toward `aborting due to 2 previous
   errors`. The port's `bug_impl` (`src/rustc_span/macros.ts:43`) calls the default (`false`) and throws a plain
   `Panic(args)`.
   **Blocker:** `{location}` is the `#[track_caller]` `std::panic::Location` of the `bug!`/`span_bug!` call site in
   the *Rust* source (`/rustc-dev/<commit>/compiler/rustc_const_eval/src/const_eval/machine.rs:460:21`). The port has
   no such value (callers pass `undefined`; `src/rustc_span/macros.ts:15` notes this). Porting `emit_bug_diagnostic`
   needs a recorded design for that: e.g. every `bug(...)`/`span_bug(...)` call site passes its upstream
   `{file, line, col}` (there are ~1,290 `bug(`/`span_bug(` call sites in 340 files under `src/`; the line and
   column of the macro invocation would be checked like markers by `coverage.ts`), plus the `/rustc-dev/<commit>/`
   prefix from the oracle's `remap-path-prefix` (UPSTREAM.json commit). Guessing any of it is not allowed, so I did
   not port it.
2. `compiler/rustc_driver_impl/src/lib.rs:1538 report_ice` (coverage: rustc_driver_impl lib.rs 29/43, this one
   missing; `install_ice_hook` at `src/rustc_driver_impl/lib.ts:1146` leaves the panic hook out). It prints the
   `thread 'rustc' (<tid>) panicked at <location>:\nBox<dyn Any>` line (std's default hook, called first), the
   `note: using internal features ...`, `note: rustc <version> running on <host>`, `note: compiler flags: ...` notes
   and the query stack (`print_query_stack`, `... and N other queries...`). It needs the same `Location`, and the
   thread id makes the text non-reproducible anyway (why the case is `MIR_UNSTABLE`).

**Consequence / recommendation for root.** No fix is possible in rustc_const_eval / rustc_mir_transform: they already
match. The case can only start matching when (a) a `bug!` call-site `Location` design is decided and
`emit_bug_diagnostic` + `report_ice` are ported, and (b) difftest masks `thread '<name>' (<tid>)` (as
`proc_macro_host.oracle.test.ts`'s `normalize` does) instead of marking such cases unstable. All 14 `MIR_UNSTABLE`
cases are ICEs, so they share this blocker. Suggested queue item: "ICE output: `bug!` Location design +
callbacks.rs:90 emit_bug_diagnostic + lib.rs:1538 report_ice + tid masking in difftest (harness batch)".

**Before/after** (masked outputs; no port change, so before = after): oracle exit 101, port exit 101, stdout identical
(both empty), masked stderr differs from line 18 (oracle `error: internal compiler error: ...mostly_harmless`, port
`warning: 2 warnings emitted`). Re-run with `$RUST_TS_DATA/scratch/fx36/run.sh <worktree> <tag>` (writes
`p-<tag>.err.m`, `diff-<tag>.txt` next to it). A single-const file (`mostly_harmless` only) makes the port ICE on
`mostly_harmless`, as the oracle does.

## 2. RealTime arm of `unblock_expired_deadlines` (thread.rs:865, `src/miri/concurrency/thread.ts:949`)

Three tests in `threads.test.ts`, using real `SystemTime`s from `src/std/time.ts`, built from `SystemTime::UNIX_EPOCH`
+ `Duration::from_secs` (the test never reads the host clock; the port's arm reads `SystemTime::now()` as upstream
does, so the bounds only assume a host clock between 2023-11 and year ~3500):

- isolation off (`communicate: true`): deadlines at epoch+1 s and the epoch itself time out (`Err` from
  `duration_since` -> `Duration::ZERO`), in thread order, on their own threads; a deadline at epoch+10^11 s stays
  `Blocked` and the returned wait is in (5*10^10 s, 10^11 s - 1.7*10^9 s).
- `RealTime` and `Monotonic` deadlines share `min_wait_time` (virtual 50 ns wins over the far RealTime one).
- isolation on: `block_thread` panics `cannot have `RealTime` timeout with isolation` (thread.rs:822), and a RealTime
  deadline placed through `ThreadManager::block_thread` trips the arm's `assert!` with the same text.

Mutants of the arm, each caught: `Duration.ZERO` -> `Duration.MAX` (1 fail); swapped `duration_since` operands
(2 fail); `assert(communicate, ..)` removed (1 fail).

## 3. pm-host failure-path tests (`src/rust_ts/proc_macro_host.oracle.test.ts`)

The three failure-path cases now assert the oracle's own result, not only port == oracle:

- `proc-macro panics and compile_error! spans` and `-Zproc-macro-backtrace`: oracle exit 1, its stdout (the expansion
  without the failed calls) and its full stderr (thread ids masked by `normalize`) are pinned as constants
  (`ERRORS_STDOUT`, `ERRORS_STDERR`, `ERRORS_BT_STDERR`), recorded from the pinned oracle.
- **dlopen failure: the old case never reached dlopen.** Its copy `unsigned_libecho_pm.dylib` was rejected by the
  crate locator (`extern location for echo_pm is of an unknown type`, `file name should be lib*.rlib or lib*.dylib`,
  E0463), so both sides failed the same unrelated way. The copy is now `unsigned/libecho_pm.dylib` (same file name,
  own directory), which gives `CrateError::DlOpen`: `error: <abs path>: dlopen failed: dlopen(<abs path>, 0x0005):
  tried: '<abs path>' (missing code signature in <UUID> ...` + the `extern crate echo_pm;` span + `aborting due to 1
  previous error`. The test pins exit 1, empty stdout, the first line's shape up to the UUID, and every following
  line. The port matches the oracle on it. Reverting the path to `unsigned_${file}` makes the test fail.

## Verify

- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (23954; vendor 5050; library 506)`.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src ./tools`: 6735 pass, 1 skip (the allowlisted skip integ-w36 already had), 0 fail, 6736 tests in 553 files (1118 s); exit 0.
- `bun scripts/difftest.ts --suite mir --sample 300`: total=300 MATCH=300 (100.00%), 0 DIFF/UNPORTED/CRASH/TIMEOUT/UNSTABLE.
- `bun scripts/difftest.ts --suite mir-core --sample 200`: total=200 MATCH=200 (100.00%), 0 non-MATCH.
- `bun scripts/difftest.ts --suite expanded --sample 200`: total=200 MATCH=200 (100.00%), 0 non-MATCH (skipped=3, suite-defined).
- (no port file changed, so the difftest results cannot differ from main's; do_not_const_check stays UNSTABLE, see 1.)
