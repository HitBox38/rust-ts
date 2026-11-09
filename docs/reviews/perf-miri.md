**Verdict: APPROVE WITH NITS**

# Review: lane `perf-miri`

Independent review of branch `t3/optimize-miri-performance`, head `b3e297d7`, against `main` `74f215e6`. One code commit,
`ae95bbec` (`src/miri/concurrency/data_race.ts`, `src/miri/concurrency/data_race.test.ts`); handoff `docs/handoff/perf-miri.md`.
Reviewer agent `review-perf-miri`, host `aarch64-apple-darwin`, AC power, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`.

## 1. Is the reorder invisible? Yes (read)

Upstream `src/tools/miri/src/concurrency/data_race.rs:1324 local_write` and `:1354 local_read` read
`machine.current_user_relevant_span()` first, then `machine.data_race.as_vclocks_ref().unwrap()`, then return early if
`!global.race_detecting()`. `current_span` is used only after that return, in both functions.

What the read calls (upstream, then the port):
- `helpers.rs:1019 MiriMachine::current_user_relevant_span` → `threads.active_thread_ref()` (an index) →
  `thread.rs:285 Thread::current_user_relevant_span`: a `debug_assert_eq!` (compiled out of the oracle's release Miri; commented out in
  `src/miri/concurrency/thread.ts:325`), `top_user_relevant_frame()` (`thread.rs:272`: the cached field, or `stack.len() - 1`, or
  `None` → `DUMMY_SP`), then `Frame::current_span` (`stack.rs:309`): `Left(loc)` → `Body::source_info(loc).span`, `Right(span)` → `span`.
- `Body::source_info` (`rustc_middle/src/mir/mod.rs:517`; port `src/rustc_middle/mir/mod.ts:600`): `basic_blocks` index
  (`BasicBlocks::deref` returns the field, `src/rustc_middle/mir/basic_blocks.ts:144`, no cache fill), then the statement, or
  `assert_eq!(idx, stmts.len())` and `terminator()` (`expect`).
- `GlobalState::race_detecting` (`data_race.rs:1674`; port `data_race.ts:1860`) reads two cells.

There is no cache fill, no lazily computed frame or body, no backtrace, no `tcx` query, no tracing and no write anywhere on this path.
The only way it could differ is a panic: an out-of-range `top_user_relevant_frame` or a location past the terminator. Neither
happens in the oracle (Miri maintains both invariants), so such a panic would be a port bug, and hiding it on a single-threaded
path cannot turn a MATCH into a DIFF. The `unwrap()` now runs before the read rather than after it. Both are pure and `unwrap`
panics either way, so the order cannot show. This is within PORTING's PORT(perf) rule ("only if it cannot show in any output"); see N1.

## 2. The test: fails as claimed (reproduced)

Mutations of `data_race.ts`, each reverted with `git checkout` (tree clean afterwards), running
`bun test src/miri/concurrency/data_race.test.ts -t "FrameState::local_write"`:

| mutation | result |
|---|---|
| none | 1 pass |
| `local_write`'s span assignment dropped (`:1509`) | 1 fail |
| `local_read`'s span assignment dropped (`:1546`) | 1 fail |
| `local_write` back in upstream order (read before the check) | 1 fail (the test also pins the deferred read) |

`miri-fail --filter local_variable_` (`local_variable_{alloc,read,write}_race.rs`): head **3/3 MATCH**; with both span assignments
dropped **3/3 DIFF** (reproduced).

## 3. Results (reproduced, head `b3e297d7`)

Samples under seed `review-perf-miri`, which differs from the lane's, `--jobs 6`, at load 1-21 (other lanes running):

| suite | result | run |
|---|---|---|
| `miri-hello` | 1/1 MATCH | `20261109-081800-review-perf-miri-wkze` |
| `run-pass-miri` | 200/200 MATCH | `20261109-081815-review-perf-miri-j6i3` |
| `run-fail-miri` | 200/200 MATCH | `20261109-081915-review-perf-miri-ys0h` |
| `miri-pass` | 196 MATCH, 4 UNPORTED, 0 DIFF | `20261109-082057-review-perf-miri-nw9c` |
| `run-pass-aux-miri` | 200/200 MATCH | `20261109-082223-review-perf-miri-da60` |

My `miri-pass` sample drew 4 UNPORTED: `open_a_file_in_proc.rs`, `shims/socket-address.rs`, `shims/socket-no-blocking.rs`,
`shims/socket.rs` (file and socket shims). None is in `harness/baseline/miri-pass.txt`. It did not draw `tests/panic/mir-validation.rs`.
So I ran those cases and the lane's three by `--filter` on head and on main (main's two `data_race` files checked out in place,
then restored). Each status was the same on both: the four above plus `open_a_file_in_proc.rs` UNPORTED,
`tests/panic/mir-validation.rs` DIFF, `shims/unix-socket.rs` MATCH. So the lane's 1 DIFF and 2 UNPORTED are on main too.

`bun test src/miri`: **447 pass, 0 fail** (56 files).

## 4. The lane's negative result: sound, with one missed option

The reasoning holds up. The profile is flat: the top self time is `Ok` at 2.2-2.7% and no file is above 7.4%. The counts per run
are upstream's work done the same number of times: steps, validations, typed copies, leak backtraces per allocation (on by default
upstream). The pool arithmetic (each case gets about half a core, so it needs about 20 s alone and now takes 35-37 s) agrees with the
w40e audit's TAIT measurements. I agree that the faithful items left (backtrace memo, hashbrown numbers, `Bernoulli` memo) add up to
single-digit percent. Even the representation changes would not halve the time: the constructors and `Ok` together are about 4-5%
self, plus whatever GC they cause. I have not re-profiled; these figures are the lane's.

What it missed or left unquantified:
- **The heavy class already exists for this.** `run-pass-miri-heavy` (`harness/suites.ts:1547`, `MIRI_HEAVY` at `:1623`) runs one
  process at a time after the other suites, with long timeouts. That is exactly what these two cases need. Its entry rule
  (plan-m6 A7) is "oracle over 5 s user", and these cases take 4.1-4.2 s under the oracle, so admitting them means adding a
  port-cost criterion. That is a reviewed harness change plus a recorded decision, root's call. It is the only option here that
  removes the pool timeout outright. The handoff's harness option 3 discusses only the solo retry.
- **GC and retained heap are not quantified.** Peak RSS is 2.1 GB, but memory-map inserts and removes are equal (665k / 665k), so
  little should stay live. The handoff mentions a heap-at-exit hook but reports no GC share and no retained-set breakdown. If memo
  tables (`FRAME_NORMALIZE_MEMO`, the backtrace `WeakMap`, query caches) or per-allocation history grow without bound, GC marking
  cost grows with them. A faithful retention fix, if there is one, would reach every step. Worth one short measurement before a
  representation decision. I have not checked it.

## Findings

- **N1 (nit, read)** `PORTING.md:39`: the PORT(perf) rule's wording covers memoization ("may memoize upstream's logic"), not
  reordering. This change meets its test ("cannot show in any output"), but root may want to record a decision that moving a
  pure read past an early return falls under PORT(perf), so later lanes do not stretch the precedent to reads that have effects
  (for example `generate_stacktrace`, or anything that calls `tcx`).
- **N2 (nit, read)** `src/miri/concurrency/data_race.ts:1495` and `:1532`: the PORT(perf) comment says the read "cannot fail: the
  top frame's location is always in its body". That is right for the oracle. In the port, a bug that left `top_user_relevant_frame`
  out of range would have crashed every program before and now crashes only multi-threaded ones. That makes such a bug harder to
  notice, never a wrong output. No action needed; noted so a future crash in race detection is not blamed on this change.
- **N3 (opinion, read)** handoff "What remains": the heavy-class option and the unquantified GC share (section 4) are missing from
  root's options.

No finding blocks acceptance.

## Not checked

- The lane's timings, instruction counts and profile shares: not re-measured or re-profiled.
- The `check-ui` and `mir` samples: not run. The change is under `src/miri/`, which only the Miri driver loads.
- `bunx tsc --noEmit` and `coverage.ts --check`: not run (the gate covers both).
- The `miri-fail` suite beyond the three `local_variable_*_race.rs` cases.
- No gate and no full suites, as instructed.
