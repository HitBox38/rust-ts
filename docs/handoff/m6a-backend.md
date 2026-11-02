# Handoff: lane `m6a-backend` (M6a: `miri-hello` MATCH)

Branch `t3/miri-codegen-backend` (worktree `t3-fcb3a8dd`), on top of `integ-w37` and `t3/miri-wire-37`. Both merged at
setup with no conflicts. Code commit: 2ceec547. The handoff commit follows it.

**Result: `difftest --suite miri-hello` gives MATCH 1/1** (run `20261102-145758-m6a-backend-oakr`). The M6a criterion
line reads `met`.

## What changed

Most of the backend was already ported:
- `DummyCodegenBackend` (util.rs:403-458), `get_codegen_backend` (util.rs:369);
- `MiriCodegenBackend` (bin/miri.rs:217-263) and `make_miri_codegen_backend` (bin/miri.rs:112).

Only the `run_compiler` arm that uses them was missing.

| file | change |
|---|---|
| `src/rustc_interface/interface.ts` | `Config.make_codegen_backend` is now typed `((sess: EarlySession) => CodegenBackend) \| undefined` (was `undefined`). `run_compiler` (interface.rs:379) ports the `match config.make_codegen_backend` at interface.rs:424-436 as an if/else. The `None` arm is the unchanged `util::get_codegen_backend(..)` call. The `Some` arm keeps upstream's "N.B." comment and calls `make_codegen_backend(&early_sess)`. The PORT note on the unported `Some` arms no longer lists `make_codegen_backend`. |
| `src/miri/bin/miri.ts` | `MiriCompilerCalls::config` (bin/miri.rs:129) sets `config.make_codegen_backend` directly. The cast and its `PORT(contract)` note are gone. |

Hello world's exit path after codegen needed no further change:
- `MiriCodegenBackend::codegen_crate` / `join_codegen` forward to the dummy;
- `link` does nothing when `dep == false`;
- exit code, stdout and stderr already equal the oracle's.

No files outside the brief's scope were touched.

## Verify

| check | result |
|---|---|
| `bunx tsc --noEmit -p .` | 0 errors |
| `bun scripts/coverage.ts --check --offline` | `markers ok (24395; vendor 5050; library 584)` |
| `RUST_TS_REQUIRE_PROBES=1 bun test ./src ./tools` | 6826 pass, 1 skip, 0 fail (567 files, 1017 s; log `$RUST_TS_DATA/tmp/m6a-backend/unit-src.log`); no timeouts |
| `bun test ./scripts ./harness` | 148 pass, 0 fail |
| `difftest --suite mir --sample 300` | MATCH 300/300 (`20261102-145848-m6a-backend-0xvj`) |
| `difftest --suite expanded --sample 200` | MATCH 200/200 (`20261102-150002-m6a-backend-s20j`) |
| `difftest --suite rmeta-ui --sample 100` | MATCH 100/100 (`20261102-150024-m6a-backend-pt78`) |
| `difftest --suite pm-ui --sample 50` | MATCH 50/50 (`20261102-150043-m6a-backend-rf0z`) |
| `difftest --suite miri-hello` | **MATCH 1/1** (`20261102-145758-m6a-backend-oakr`) |
| `difftest --suite run-pass-miri --sample 100` | MATCH 99, CRASH 1, DIFF 0, UNPORTED 0; 497 skipped (`20261102-145807-m6a-backend-kl27`) |
| `difftest --suite run-fail-miri --sample 50` | MATCH 47, DIFF 2, UNPORTED 1, CRASH 0; 32 skipped (`20261102-145857-m6a-backend-6uv6`) |

All samples ran with `RUST_TS_AGENT=m6a-backend`.

Coverage (`--missing`). These gaps were there before this lane, and it changed none of them:

| upstream file | ported | still missing |
|---|---|---|
| rustc_interface interface.rs | 3/4 | `try_print_query_stack` |
| rustc_interface util.rs | 16/21 | `load_backend_from_dylib`, `DummyArchiveBuilderBuilder::{new_archive_builder, create_dll_import_lib}`, `rustc_path`, `get_codegen_sysroot` |
| miri bin/miri.rs | 19/21 | `MiriDepCompilerCalls::{config, after_analysis}` (miri-sysroot lane, plan-m6 D4) |

## run-pass-miri / run-fail-miri breakdown (input for the next fixer wave)

The 150 sampled cases have only 4 non-MATCHes.

**First-unported sites (1 in total):**
1. `rustc_codegen_llvm::llvm_util::configure_llvm (-C target-feature)`: `tests/ui/sanitizer/cfi/fn-ptr-type-mismatch.rs#kcfi` (run-fail).

No other case stops unported in the sample. The 48 codegen stops harness-m6a reported earlier are gone with this
lane.

**First-difference kinds (3 cases, one likely root cause): thread join / thread exit under the port's Miri.**

- **`threads should not terminate unexpectedly`**:
  - In `std::thread::lifecycle::JoinInner::join` (library std thread/lifecycle.rs:230), after `self.native.join()`,
    `Arc::get_mut(&mut self.packet)` returns `None`. So the spawned thread's clone of the packet `Arc` has not been
    dropped by the time join returns, or the count read is stale.
  - Cases:
    - run-pass `tests/ui/std/channel-stack-overflow-issue-102246.rs`: CRASH, exit 101; the oracle exits 0 with empty
      output.
    - run-fail `tests/ui/test-attrs/test-thread-nocapture.rs`: DIFF. Here the spawned test thread's own inner join
      panics first, and only 3 of the 4 `fee/fie/foe/fum` lines reach stdout. That fits a thread being treated as
      finished before its closure (and its drops) has run to the end.
- **`error: the evaluated program deadlocked`** at `std::sys::sync::futex::unix::futex_wait` (thread `main`, under
  `Thread::park`):
  - Case: run-fail `tests/ui/test-attrs/terse.rs`, with 103 test threads. The port prints `running 103 tests`, then
    deadlocks; the oracle runs all 103 tests.
  - Most likely the same root cause: the main thread parks waiting for a test thread's completion message that the
    exit path never delivers or wakes on.

**Suggested next item:** one fixer on Miri's thread-exit path:
- `ThreadManager` termination: `thread_terminated`, the join-blocked threads' unblock callbacks, TLS dtors run on
  thread exit (`schedule_next_tls_dtor_for_active_thread`);
- the futex wake on the joined thread.

Start with `channel-stack-overflow-issue-102246.rs`, the smallest repro (2 spawns, 2 joins), using `miri-diff` on
that case.

## `unported(...)` left / removed

- None added.
- None removed in code. The `rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate` stop is no longer reached under
  Miri; it stays reachable for plain `rustc` runs, M7.

## `// PORT:` decisions

- interface.ts: the comment above `is_unwind` now lists only the still-unported `Some` arms. These are `file_loader`,
  `psess_created`, `track_state`, `register_lints` and `override_queries`. It notes that `make_codegen_backend` is
  ported.
- The `match` is an if/else on `config.make_codegen_backend === undefined`, in upstream arm order: `None` first, then
  `Some`.

## For root

- bin/miri.ts's `PORT(contract)` for `make_codegen_backend` is resolved. This was the miri-wire-37 handoff's "M6a
  blocker" row.
- miri-driver handoff item 9 is done. Its side note also no longer applies: `target_config` now comes from
  `MiriCodegenBackend`, which gives `has_reliable_f16_math` from the host table and `has_reliable_f128_math = false`.
