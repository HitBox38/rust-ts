APPROVE WITH NITS

# Review: lane fixers-51 (wave 40j, queued review findings)

Branch `t3/fix-thread-fs-dataflow`, commits `5ccd5a19`, `0a283eda`, `f56202ff`, `c501cb3f`, against merge base `0ce28aa2`
and the pinned upstream (`6f5da406`). Independent, read-only. Host: root host, AC power, load about 17-20 from other lanes,
no `GATE_RUNNING`. `RUST_TS_AGENT=rev-fixers-51`, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, `RUSTC_ICE=0`.

## Findings (must fix)

None.

## 1. thread.c / thread.ts / tinycc.ts (pm-cross-thread N1-N6)

- **Former `abort()` paths.** I checked `rts_thread_spawn` against `library/std/src/sys/thread/unix.rs:53-115`
  (`Thread::new`). Every former abort now returns:
  - `pthread_attr_init` (:59) gives -2, with no destroy, because the guard does not exist yet (correct);
  - a non-EINVAL `setstacksize` (:83) gives -3, after a destroy (the guard unwinding);
  - a failed page-rounded retry (:95-100) gives -1, or -4 if the guard's destroy then fails (the assertion panics on the
    normal return, so -4 is the right report);
  - after `pthread_create` (:107), the guard's destroy runs either way, as upstream's does when `new` returns. If it
    fails, the code is -4 whatever `ret` was, and the thread is returned if it was created.
  - `calloc` still aborts (`handle_alloc_error`), and the channel's allocation and init aborts (thread.c:160-164) were
    not in scope.
  - `thread.ts` `spawn` tests `err` before `t`, so the -4-with-a-thread case stops too. The rounding expression is
    unchanged from upstream's.
- **Stopping `unported` is the right call.** `std::thread::spawn` (`library/std/src/thread/functions.rs:125`) is
  `#[track_caller]` only under `cfg(miri)`. So the panic location of `.expect("failed to spawn thread")` (:131) is
  inside std, where the track_caller walk has no marker, and the assertions panic inside std too. A guessed message or
  location would break the never-guess rule. None of these paths is reachable on the root host.
- **`cc_or_unported`.**
  - It covers every TinyCC compile site: `git grep` finds `cc` imported from `bun:ffi` only in `src/rust_ts/tinycc.ts`;
    the two callers are `thread.ts native_sync` and `proc_macro_host.ts native`.
  - It catches only what `cc()` throws. `cc` runs no port code, so it cannot swallow a port exception.
  - A broken checkout (a missing `.c` file) now reads UNPORTED rather than CRASH. That is still a loss for any protected
    case, so the gate catches it.
  - No cycle: `tinycc.ts` imports only `bun:ffi` and `std/panic.ts`.
- **The new cross-thread tests** (`echo! cross-thread`, and `recover!` under both strategies): 5 runs of
  `-t "cross-thread|other thread"` gave 2 pass, 0 fail each time. The whole oracle test file gave 11 pass. The `recover!`
  test checks the server's call sequence, which is what tells "rethrow after the join" apart from "rethrow at once".

## 2. time.ts and fs.ts (miri-host-fs item 5)

- **Markers.** Each was checked against `library/std` at the pin:
  - `sys/pal/unix/time.rs:39 new_unchecked`, `:43 zero` and `:47 new` are the `fn` lines;
  - `sys/time/unix.rs:19 new` is correct: line 18 is the `#[cfg_attr(..., expect(unused))]`, so the lane is right and
    the review's `:18` was off by one;
  - `sys/fs/unix.rs:520 from_stat64` is the `else` arm of `cfg_has_statx!`;
  - `core/src/fmt/mod.rs:3135 fmt` is `impl Debug for ()`.
- **Logic.**
  - The Apple correction keeps upstream's exact bounds (`tv_sec <= 0 && tv_sec > i64::MIN`, `-1e9 < tv_nsec < 0`).
    `tv_sec - 1` cannot overflow, because `i64::MIN` is excluded.
  - The range check `0 <= tv_nsec < NSEC_PER_SEC` matches upstream.
  - The error is `SimpleMessage { InvalidData, "invalid timestamp" }`, which is what `const_error!` makes.
  - `new_unchecked`'s `tv_nsec as u32` is `BigInt.asUintN(32, ..)`.
  - `UNIX_EPOCH = Timespec::zero()` matches `sys/time/unix.rs:6`.
  - No panic path is left. The old `SystemTime_new` had an unreachable `panic`; it is gone with the function.
  - `time.ts` imports `IoError` type-only, so there is no runtime cycle with `io.ts`.
- **Tests.** `time.test.ts` and `fs.test.ts` pass. `fs.ts`'s three callers now use `SystemTime.new`.
- **miri-pass-heavy, each case run alone:**

  | case | result | run |
  |---|---|---|
  | `shims/fs.rs` | MATCH | `20261111-025250-rev-fixers-51-9841` |
  | `shims/fs-permissions.rs` | MATCH | `20261111-025259-rev-fixers-51-ewnk` |
  | `shims/time.rs` | MATCH | `20261111-025302-rev-fixers-51-t85p` |

## 3. closedir, fcntl, `libc()` export (miri-host-fs N1-N3)

- **closedir** (`src/miri/shims/unix/fs.ts:1985-2012`) matches upstream `src/tools/miri/src/shims/unix/fs.rs:1575-1604`.
  - The `try` starts right after `streams.delete`, the point where Rust's `open_dir` becomes owned.
  - The `finally` drops the host `ReadDir` once on all four exits: the UB, `close`'s `?`, `deallocate_ptr`'s `?` and
    success. It also covers a JS throw, as Rust's unwinding drop does.
  - There is no double close:
    - the stream has already left the table, so no table teardown can drop it again;
    - the old unconditional drop after the block was removed;
    - `this.close(fd_num)` closes the Miri fd, and the `finally` closes the host `DIR*`, which are two different
      resources, as upstream.
  - `DirStream`'s other fields have no drop glue.
- **fcntl tests.** They pass, and a busy fd cannot make them pass wrongly. They can fail spuriously, though (N1).
- **The `libc()` export** carries a `// PORT:` note saying it is for the test only. That follows the `diff_pretty`
  precedent and is acceptable.

## 4. dataflow (dataflow-graphviz N1-N4, root-w49-check N1)

- **The cursor.** Upstream (`graphviz.rs:463-500`) uses `std::vec::IntoIter` with `next()`/`next_back()`. It has no
  `VecDeque`, contrary to the review brief's wording. The `{ v, start, end }` cursor is that iterator: `next` takes
  `v[start++]`, `next_back` takes `v[--end]`, and `is_empty` is `start == end`. The port also no longer mutates
  `diffs.before`/`after`.
  - **Order matters, and the test sees it.** I applied each direction's mutant by itself and ran the test:
    - backward reading from the front (`v[start++]` in the `next_back` arm): "the port writes the oracle's .dot files"
      fails;
    - forward reading from the back (`v[--end]` in the `next` arm): the same test fails.
    - The fixture's forward and backward analyses therefore both pin the order. Each mutant was restored with
      `git checkout --`, and the tree was clean afterwards.
- **The `// rustc-call: 201:57` anchor** is a sanctioned use.
  - `map_call` (`src/rust_ts/track_caller.ts:319-328`) consults the anchor before the count comparison.
  - docs/handoff/ice-report-impl.md:207 records that count-mismatch sites get an anchor instead of the dropped D4
    exception, with `sty.rs:1816:86` as the example.
  - Column 57 (1-based) is the `unwrap` of `.unwrap()` on graphviz.rs:201. `coverage.ts --check` validates it
    (`markers ok`).
  - The new unit test maps the real `node_label` to `[201, 56]` (0-based).
  - Not inventing a second `unwrap_result` is correct.
- **`test.skipIf(!HAVE && !REQUIRE)`** follows `debug.oracle.test.ts`. It prints a `SKIP:` line, and under `REQUIRE`
  without the toolchain it fails with `ERROR:`. `HAVE` is computed once and reused by `REGEN`.
- **N2/N3:** both done. The scratch dir is under `$RUST_TS_DATA/tmp`, and `diff_pretty` has its note.

## 5. Shared `debug_unit` (root-w49-check N3)

- `src/std/fmt.ts:181` `debug_unit: Debug<null> = () => "()"` is the same function as all seven removed copies:
  - region_infer/graphviz.ts, obligation_forest/mod.ts, dataflow graphviz.ts, asm_oracle/run.ts, the tyir test and
    hir.ts (exported, no importer: `tsc` is clean without it) were each `Debug<null> = () => "()"`;
  - type_check/mod.ts's was a function-local constant of the same form.
- **No cycle:** `fmt.ts`'s import list is unchanged.

## 6. Checks run (on `c501cb3f`, detached in this worktree)

- `bunx tsc --noEmit -p .`: exit 0, no output.
- `bun scripts/coverage.ts --check`: `markers ok (24933; vendor 5311; library 728)`.
- Unit tests:
  - `result`, `thread`, `time`, `fs`, `fmt`, `sync/`, `tinycc`, miri `shims/unix/fs`, dataflow `graphviz`, the tyir
    region-constraint test and `track_caller`: **90 pass, 0 fail**;
  - `obligation_forest`, `region_infer`, `rustc_target/asm` and `src/proc_macro`: **65 pass, 0 fail**;
  - `proc_macro_host.oracle.test.ts`: **11 pass**.
- Difftests (`--sample 200 --jobs 6`, my own sample):

  | suite | result | run |
  |---|---|---|
  | mir-opt-o4 | 200/200 MATCH (10 skipped) | `20261111-024950-rev-fixers-51-tydp` |
  | pm-ui | 200/200 MATCH | `20261111-025131-rev-fixers-51-79c6` |

## Nits

- **N1** `src/std/fs.test.ts:297` and `:319`. Both new fcntl tests depend on the state of the whole process.
  - The first hard-codes fds 200 and 777. If either is open, the `fstatSync(min)` pre-check fails the test rather than
    picking another fd. In the gate's one-process `bun test` pass, fds leaked by earlier files could reach 200.
  - The second closes fd 0 for the whole process for a moment. If a Bun-internal thread opens a file in that window, it
    gets fd 0, which `dup2` then silently replaces.
  - Neither can make the test pass wrongly, and neither failed here. Suggested hardening: probe upward from 200 for the
    first free fd and expect exactly that fd (same for a second, higher minimum).
- **N2** `src/std/thread.c:95-99` (the -3 path). Upstream's `assert_eq!(n, EINVAL)` panics while the guard is live. If
  the guard's `pthread_attr_destroy` assertion then also failed, that would be a panic during unwinding, which aborts.
  The port ignores destroy's result there. The path is unreachable on every host the port supports, so a one-line comment
  saying so would be enough.
- **N3** docs/handoff/fixers-51.md:113 says the `node_label` treatment "is the same treatment as
  `rustc_errors/json.ts:321`". json.ts:319-320 has only the `// PORT:` note, with no `rustc-call:` anchor. The precedent
  for the anchor is ice-report-impl.md:207 (`sty.ts`). Wording only.
- **N4** `src/rustc_borrowck/region_infer/graphviz.ts:31-32` and `src/rustc_data_structures/obligation_forest/mod.ts:852-853`:
  the removed `debug_unit` copies leave two blank lines in a row. Cosmetic.
