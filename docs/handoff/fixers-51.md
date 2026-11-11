# Handoff: lane fixers-51 (wave 40j, queued review findings)

Branch `t3/fix-thread-fs-dataflow`, on `main` at `0ce28aa2`. Host: root host, AC power throughout, load up to ~50 from
the other lanes. `RUST_TS_AGENT=fixers-51`, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, `RUSTC_ICE=0`.
No gate, no full suite. No file under `harness/`, `scripts/` or `tools/` changed.

| Group | Commit |
|---|---|
| pm-cross-thread review N1-N6 | `5ccd5a19` |
| miri-host-fs review item 5, N1-N3 | `0a283eda` |
| dataflow-graphviz review N1-N4, root-w49-check N1, N3 | `f56202ff` |

**Mutation checks.** For every item below marked "mutation", I applied the stated mutant by itself, saw the named test
fail, and restored the file from a scratch copy (each restore checked with `git diff --stat`).

## Files touched

- `src/std/thread.c`, `src/std/thread.ts`, `src/std/thread.test.ts` (new)
- `src/rust_ts/tinycc.ts` (new), `src/rust_ts/tinycc.test.ts` (new), `src/rust_ts/proc_macro_host.ts`,
  `src/rust_ts/proc_macro_host.oracle.test.ts`
- `docs/handoff/pm-cross-thread.md` (text corrections, N3/N4)
- `src/std/time.ts`, `src/std/time.test.ts`, `src/std/fs.ts`, `src/std/fs.test.ts`
- `src/miri/shims/unix/fs.ts`, `src/miri/shims/unix/fs.test.ts`
- `src/rustc_mir_dataflow/framework/graphviz.ts`, `src/rustc_mir_dataflow/framework/graphviz.test.ts`
- `src/std/fmt.ts`, `src/std/fmt.test.ts`, `src/rustc_hir/hir.ts`, `src/rustc_data_structures/obligation_forest/mod.ts`,
  `src/rustc_target/asm/asm_oracle/run.ts`, `src/rustc_type_ir/tyir_misc_region_constraint.test.ts`,
  `src/rustc_borrowck/region_infer/graphviz.ts`, `src/rustc_borrowck/type_check/mod.ts`
- `docs/handoff/fixers-51.md` (this file)

## 1. pm-cross-thread (`docs/reviews/pm-cross-thread.md`)

- **N2.** `rts_thread_spawn` no longer calls `abort()` where std's `Thread::new` returns an error or fails an assertion.
  It returns null with a negative code: -1 for the failed page-rounded retry (`Err(InvalidInput, "invalid stack
  size")`), -2 for `pthread_attr_init`, -3 for a non-EINVAL `setstacksize` error, and -4 for the guard's
  `pthread_attr_destroy` assertion. The order follows upstream: the guard runs after `pthread_create` either way, and
  `attr` is destroyed while unwinding from the -3 assertion. `thread.ts` `spawn` stops `unported` with
  `spawn_error(code)`'s text. `calloc` failure still aborts, as `handle_alloc_error` does.
  - **Why not the real panic:** `.expect("failed to spawn thread")` panics at a location in std, which the
    track_caller walk cannot resolve.
  - **Test:** `src/std/thread.test.ts` calls thread.c with `2^64 - 2048`. That size is not a page multiple, and
    rounding it wraps to 0, so the retry fails with code -1.
  - **Mutation:** restoring `abort()` at that point kills the test process (`panic(main thread): abort() called`).
- **N5.** Two new tests in the in-process block of `proc_macro_host.oracle.test.ts`.
  - `echo!` under `CROSS_THREAD` gives the same-thread answer.
  - A new `recover!` proc macro catches the resumed panic of a failing `ts_into_trees`, then asks for `ts_concat_trees`.
    Under `CROSS_THREAD` the server must see both calls, then rethrow `Unported` after the join. The bridge stays usable
    afterwards.
  - **Mutations:** (a) rethrow at once in the `catch`: the calls are `[ts_into_trees]` only, so the test fails. (b) drop
    the `throw error.value` after the join: no throw, so the test fails.
  - I could not use `echo!` for this, because `into_trees` consumes the stream and no call follows it.
- **N6.** A new `src/rust_ts/tinycc.ts` `cc_or_unported(what, options)` wraps `cc`. On failure it stops with
  `unported("<what> (TinyCC failed: <messages joined by ' | '>)")`. Both `native_sync()` (thread.c) and
  `proc_macro_host.ts` `native()` use it. std already imports from rust_ts (`panicking.ts`), and tinycc.ts imports only
  `bun:ffi` and `panic.ts` (no imports), so it adds no cycle.
  - **Test:** `tinycc.test.ts` (a bad source gives one `Unported` line naming the helper; a good one compiles).
  - **Mutation:** a bare `cc` makes the test fail.
- **N1.** A comment on `RTS_PTHREAD_STACK_MIN` says where 16384 holds in libc 0.2.189 and where it does not:
  - it holds on aarch64-apple-darwin (`apple/mod.rs:2543`, the root host);
  - on glibc arm/x86/x86_64/s390x/riscv (`gnu/mod.rs:973`) it holds, but only as the fallback when `__pthread_get_minstack` is missing;
  - other values: 8192 on x86_64 apple, 0x6000 on glibc sparc, 131072 on glibc aarch64 and the rest, 2048 on musl,
    where std does not use `__pthread_get_minstack`, unlike the port's `#ifdef __linux__`.
  - Code unchanged, as assigned.
- **N3/N4.** I corrected the thread.ts header and `docs/handoff/pm-cross-thread.md` (§1 point 2, option B, §6).
  - I re-checked the overflow myself with a recursive proc macro (`deep!(100000)`, 4 KiB frames). The oracle prints
    `error: rustc interrupted by SIGBUS, printing backtrace` and exits 138, in both strategies. The port, cross-thread,
    exits 132.
  - The same-thread thread name `<unnamed>` is already pinned by the existing `-Zproc-macro-backtrace` oracle test.

## 2. miri-host-fs (`docs/reviews/miri-host-fs.md`)

- **Item 5.** Ported into `src/std/time.ts`'s `Timespec`, in upstream order, with markers:
  - `new_unchecked` (`sys/pal/unix/time.rs:39`), `zero` (`:43`), `new` (`:47`, with the Apple correction);
  - `SystemTime.new` (`sys/time/unix.rs:19`; the review said `:18`, but that line is the `cfg_attr`, and `fn` is at 19);
  - `UNIX_EPOCH` is now `Timespec.zero()`.
  - fs.ts's `SystemTime_new`, with its `UNIX_EPOCH ± Duration` arithmetic, is gone; `modified`/`accessed`/`created` call
    `SystemTime.new`.
  - **Test:** `time.test.ts` covers the common form, both i64 ends, out-of-range nanoseconds, the Apple form (darwin) or
    its rejection (other hosts), `i64::MIN` never corrected, and a value 0.9 s before the epoch.
  - **Mutation:** with the Apple branch off, the test fails.
- **N1.** Added the marker `// std: library/std/src/sys/fs/unix.rs:520 from_stat64`. `--missing` still lists
  `unix.rs:484 from_stat64`: that is the `cfg_has_statx!` arm, which Apple does not take.
- **N2.** `closedir`: everything after the stream leaves `dirs.streams` is in a `try`, with the host `ReadDir` dropped in
  `finally`. That covers the explicit drop and the three early returns (UB on a tampered fd, `close`'s `?`,
  `deallocate_ptr`'s `?`), as Rust's drop of the owned `open_dir` does.
  - **Test:** `src/miri/shims/unix/fs.test.ts` runs each exit with a counting fake `ReadDir`; there is exactly one drop
    on every exit.
  - **Mutation:** dropping only on success fails the test (0 drops).
- **N3.** Two tests in `src/std/fs.test.ts`:
  - fs.ts's own variadic `fcntl` declaration with `F_DUPFD_CLOEXEC` and minimums 200 and 777 returns exactly those fds;
  - `Dir::try_clone` with fd 0 closed (moved away with `dup`, restored with `dup2` in `finally`) does not hand out fd 0.
  - For this, `libc()` in fs.ts is exported with a `// PORT:` note (for fs.test.ts only).
  - **Mutations:** `try_clone`'s minimum 3 → 0 fails the second test. `pad(6)` → `pad(5)` in the declaration (the
    argument moves to a register) fails the first.

## 3. dataflow-graphviz (`docs/reviews/dataflow-graphviz.md`)

- **N1.** `HAVE` is computed once. The freshness test is `test.skipIf(!HAVE && !REQUIRE)` and prints a `SKIP:` line,
  as `debug.oracle.test.ts` does. Under `REQUIRE` without the toolchain it fails with an `ERROR:` line.
  - Evidence with `PATH=/usr/bin:/bin` and no `REQUIRE`: before the fix, 4 pass; after, 3 pass and 1 skip. With
    `REQUIRE=1`: 1 fail.
- **N2.** `run_dumps` makes its dirs under `test_scratch_dir("dataflow-graphviz")` (`$RUST_TS_DATA/tmp`).
- **N3.** A `// PORT:` line on `diff_pretty`: exported for graphviz.test.ts only.
- **N4.** Fixed faithfully. Each `vec::IntoIter` is `{ v, start, end }`: `next` takes `v[start++]`, `next_back` takes
  `v[--end]`, and `is_empty` is `start === end`. That is constant time, like std's, and follows the precedent in
  `proc_macro/lib.ts:598`. There is no output change, so no new test. The existing end-to-end `.dot` test (a forward and
  a backward analysis) covers it.
  - **Mutations:** `v[++start]` and `v[end--]` each fail "the port writes the oracle's .dot files".

## 4. root-w49-check (`docs/reviews/root-w49-check.md`)

- **N1.** I added `// rustc-call: 201:57` (the `.unwrap()` of `write_node_label(..)`) above `node_label`'s
  `unwrap_result`. A `// PORT:` note explains the missing second `.unwrap()`: under the string-buffer PORT,
  `String::from_utf8(label)` is the identity and cannot fail. This is the same treatment as `rustc_errors/json.ts:321`.
  - **Why an anchor, not a second call:** an `unwrap_result(Ok(label))` would be an invented call, and the anchor is the
    walk's own mechanism for a call-count difference.
  - **Test:** graphviz.test.ts runs the real `map_call` on graphviz.ts's `node_label` and expects upstream `[201, 56]`
    (0-based column).
  - **Mutation:** removing the anchor gives "`unwrap_result` called 1x in TS, 2x at …graphviz.rs:193".
- **N3.** `src/std/fmt.ts` now has `export const debug_unit` under `// std: library/core/src/fmt/mod.rs:3135 fmt`.
  Upstream's `f.pad("()")` is `"()"` because `Fmt` has no width or precision (PORT note).
  - Seven local copies are removed: the review counted six, plus a function-local one in `type_check/mod.ts`. Those
    files are graphviz.ts (dataflow), region_infer/graphviz.ts, obligation_forest/mod.ts, type_check/mod.ts,
    asm_oracle/run.ts, the tyir test and hir.ts.
  - hir.ts's copy was exported but used nowhere.
  - **Cycles:** fmt.ts's imports are unchanged (the unicode tables only), so there is none.
  - **Test:** `fmt.test.ts` "debug_unit".

## Evidence

- `bunx tsc --noEmit -p .`: clean (before the commits).
- `bun scripts/coverage.ts --check`: `markers ok (24933; vendor 5311; library 728)`. The 728 is 722 (the figure in the root-w49 review) plus this lane's 6
new `// std:` markers (`new_unchecked`, `zero`, `Timespec.new`, `SystemTime.new`, `from_stat64`, `debug_unit`).
- Unit tests, one run after all edits: `src/std` (`result.test.ts` included), `src/proc_macro`,
  `proc_macro_host.oracle.test.ts`, `tinycc.test.ts`, `track_caller.test.ts`, `src/miri/shims/unix`,
  `src/rustc_mir_dataflow`, the tyir region-constraint test, `obligation_forest`, `rustc_borrowck/region_infer`,
  `rustc_target/asm`. **327 pass, 0 fail** (40 files).
- Difftests (`--jobs 6`):

  | suite | result | run |
  |---|---|---|
  | mir-opt-o4 `--sample 200` | 200/200 MATCH | `20261111-023727-fixers-51-5y8a` |
  | pm-ui `--sample 200` | 200/200 MATCH | `20261111-023901-fixers-51-3jn7` |
  | miri-pass `--sample 200` | 197 MATCH, 3 UNPORTED | `20261111-024010-fixers-51-ofqg` |
  | miri-pass-heavy `tests/pass/shims/fs-permissions.rs` (alone) | MATCH | `20261111-024237-fixers-51-eq9g` |
  | miri-pass-heavy `tests/pass/shims/fs.rs` (alone) | MATCH | `20261111-024240-fixers-51-900p` |
  | miri-pass-heavy `tests/pass/shims/time.rs` (alone; time.ts changed) | MATCH | `20261111-024313-fixers-51-cr0q` |

  - The 3 miri-pass UNPORTED are `shims/socket-address.rs` and `shims/socket.rs` (sockets, plan-m6 D2) and
    `x86/intrinsics-x86-aes-vaes.rs` (the aes crate is not vendored). None is in `harness/baseline/miri-pass.txt`.
  - `--filter fs` on miri-pass-heavy selects exactly those two fs cases.

## Coverage (`bun scripts/coverage.ts --missing <file>`)

| file | after | before |
|---|---|---|
| `library/std/src/sys/pal/unix/time.rs` | 6/13 | 3/13 |
| `library/std/src/sys/time/unix.rs` | 1/16 | 0/16 |
| `library/std/src/sys/fs/unix.rs` | 60/186 | 59/186 |
| `compiler/rustc_mir_dataflow/src/framework/graphviz.rs` | 30/30 | 30/30 |

## `unported(...)` left or added

- `std::thread::spawn (<spawn_error text>)`: every `Thread::new` failure. None is reachable on the root host.
- `std::thread::spawn (no thread and no error)`: an impossible null.
- `<what> (TinyCC failed: ...)`: replaces the uncaught `Error` in both `cc` sites.

## `// PORT:` decisions

- **thread.c:** the single `RTS_PTHREAD_STACK_MIN` and where it holds.
- **thread.ts:** `spawn_error` (why each `Thread::new` failure stops `unported` rather than panicking).
- **tinycc.ts:** a failed compile is the port lacking a helper, not rustc behavior.
- **time.ts:**
  - `TARGET_VENDOR_APPLE` is the host's platform.
  - `UNIX_EPOCH` collapses std's two `SystemTime` layers.
- **fs.ts:** `libc` is exported for fs.test.ts.
- **miri `closedir`:** the `finally` is Rust's drop of the owned stream.
- **graphviz.ts:**
  - the `vec::IntoIter` cursor;
  - `diff_pretty` exported for the test;
  - `String::from_utf8(label).unwrap()` is the identity (anchor above).
- **fmt.ts:** `debug_unit`'s `f.pad` has no padding to do.

## For root

- `docs/claims/fixers-51.md` (created by root) is left for root to remove at integration.
- Not in this lane, for a later batch:
  - pm-cross-thread N7 and N8 (notes);
  - miri-host-fs N4-N6 (handoff wording, a Debug PORT note, a comment);
  - root-w49 N2 (tail calls in `graph_id`/`node_id`; the review says no change).
