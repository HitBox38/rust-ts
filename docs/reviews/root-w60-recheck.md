# Review root-w60-recheck: root's follow-up to root-w60-check (integ-w60 `a4a98609`)

**Reviewer:** independent, read-only on the code (AGENTS.md §1). **Subject:** `a4a98609` on `integ-w60`, the newest commit, after the merge of
`t3/review-root-w60-check` (`63576f9d`). It withdraws `task-comm-0.rs`, `comm.rs` and `unwind-resource.rs` from `run-pass-native`
(root-w60-check N1, decision at `main:docs/state/history.jsonl:725`) and corrects `yield1.rs`'s reason (N2).

## Verdict: PASS WITH NOTES

The commit does what the decision says and nothing more. The baseline loses exactly the three lines, which makes four with `yield1.rs`
against `main`. Each reason names the lines that race, and the gate's own check is clean on the new state. `tsc`, the harness unit tests and the
filtered difftest all pass: the four withdrawn cases show UNSTABLE, and all 54 protected `threads-sendsync` cases are MATCH. The notes below are
a wording nit and information for root. Neither blocks.

## Checks

### 1. Baseline: exactly four lines leave against `main`, nothing else under `harness/baseline/`

- `git show --stat a4a98609` touches three files: `harness/baseline/run-pass-native.txt` (−3), `harness/m7-suites.test.ts`,
  `harness/suites.ts`.
- `git diff main..a4a98609 -- harness/baseline/` is one file, four deletions, no additions: `comm.rs`, `task-comm-0.rs`,
  `unwind-resource.rs`, `yield1.rs` (all `tests/ui/threads-sendsync/`). No other baseline file changes.
- `run-pass-native.txt` has 3,385 lines (3,388 before this commit, 3,389 on `main`).
- `NATIVE_UNSTABLE["run-pass-native"]` has 22 entries, so `m7-suites.test.ts`'s move from 19 to 22 (`unstableLists`, `unstableHooked`)
  is right. Its comment cites the decisions.

### 2. Each reason against the test's source

| case | source (upstream at the pin) | reason in `harness/suites.ts` | verdict |
|---|---|---|---|
| `task-comm-0.rs` | the child prints `sent N` after each `send`; `main` prints `N` after each `recv`; joins last | "the sender's `sent 10/20/30` and the receiver's `10/20/30` come out in an order that changes"; 70 in 3,200 | accurate |
| `comm.rs` | the child prints `sending`, `send`s, then prints `value sent`; `main` prints `received` then `10` after `recv`; joins last | "the child's `sending`/`value sent` and main's `received` come out …"; 8 in 3,200 | accurate on the race, slightly over-broad (N1) |
| `unwind-resource.rs` | `main` prints `hiiiiiiiii` right after `spawn`, before its `recv`; the child prints `Hello!`, panics, and the drop prints `About to send!`, sends, then prints `Sent!` | "main's `hiiiiiiiii` and the thread's `Hello!`/`About to send!`/`Sent!` come out …"; 8 in 3,200 | accurate: nothing orders main's line against any of the three |
| `yield1.rs` | `main` prints `1`, `yield_now`, joins; the child prints `2` | "flipped 2 in 1,500 runs of the oracle-built program at load ~70 (review root-w60-check) …"; "never seen to flip" is gone | accurate; N2 resolved |

The counts match root-w60-check N1 (70, 8 and 8 in 3,200; `yield1.rs` 2 in 1,500). `unwind-resource.rs`'s panic message goes to stderr, a
separate stream, so it plays no part in the stdout race.

### 3. The gate's own check on the new state

I called `protectedUnstable` and `readBaseline` from `scripts/gate.ts` (`:84`, `:181`; used by the run at `:704-709` and by `accept` at
`:950-951`):

- `protectedUnstable("run-pass-native", <baseline at a4a98609>)` is `[]` (3,385 ids).
- `protectedUnstable("run-fail-native")` is `[]`.
- Adding any one of the four ids back to the baseline gives that id alone, so each of the four is listed and the gate would refuse a
  baseline that protected it. Listing and removal agree.

### 4. Commands (AC power, load about 4 at the start; `--jobs 6`)

- `bunx tsc`: exit 0.
- `bun test ./harness/ ./scripts/unstable.test.ts`: 91 pass, 0 fail, 1,143 `expect()` calls, 14 files (Bun 1.4.4).
- `RUST_TS_AGENT=review-root-w60-recheck-99355 bun scripts/difftest.ts --suite run-pass-native --filter threads-sendsync --jobs 6`:
  total 62, MATCH 54, DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0, UNSTABLE 8, skipped 1 (`thread-local-extern-static.rs`, needs an aux crate;
  not protected). Run: `$RUST_TS_DATA/runs/20261115-115901-review-root-w60-recheck-99355-gabt`.
  - UNSTABLE: `comm.rs`, `task-comm-0.rs`, `unwind-resource.rs`, `yield1.rs` (the four withdrawn), plus `spawn-fn.rs`, `task-comm-14.rs`,
    `task-comm-3.rs`, `yield.rs` (already listed before integ-w60). None of the eight is protected.
  - All 54 protected `threads-sendsync` ids are MATCH, so no protected case left MATCH.

### 5. Other protected native cases with the same shape

I ran my own scan, separate from root-w60-check's. I looked at every protected id of both native suites whose source spawns a thread or
process (`spawn(`, `scope(`, `Builder::new()`, `Command::new`, `.status()`, `fork`) and prints, and read the relevant lines of each of
the 44 hits. **I found none with the unordered-print shape.** They fall into these groups:

- **Spawn, then join, and only one side prints, or the other side prints only after the join:** `extern-call-deep2`, `extern-call-scrub`,
  `box-of-array-of-drop-1/2`, `nested-vec-3`, `debug-single-call`, `macro-with-braces-in-expr-position`,
  `moves-based-on-type-capture-clause`, `issue-24313`, `issue-4446`, `sendfn-spawn-with-fn-arg`, `spawn`, `spawn2`, `task-comm-1`,
  `task-comm-9/10/12/13`, `threads`, `issue-29488`, `hashmap-memory`, `eprint-on-tls-drop`.
- **Only `main` prints, after `recv`:** `issue-8827`.
- **Nothing printed on success, or no real spawn:** `no-double-lock-same-thread` (children print only on failure),
  `spawning-with-debug`, `negated-auto-traits-rpass` (its `spawn` is a local no-op).
- **A child process with its output captured or nulled, or awaited before the parent prints:** `issue-10626`, `issue-13304`,
  `atomic-print`, `println-with-broken-pipe`, `stdout-stderr-separation`, `apple-no-dsymutil`, `std-backtrace`,
  `backtrace-debuginfo`, `command-argv0`, `command-current-dir`, `command-exec`, `lto-unwind`, `env-args-reverse-iterator`,
  `inherit-env`, `homogenous-floats-target-feature-mixup`, `simd/target-feature-mixup`.
- **`run-fail-native`:** `test-thread-capture` and `test-thread-nocapture` run with `--test-threads=1`, and each test joins its thread
  before printing again, so the order is fixed.

This agrees with root-w60-check's scan. I changed nothing.

## Notes

1. **low, wording: `comm.rs`'s reason names one line too many.** The child's `sending` is printed before its `send`, and `main` prints
   `received` only after `recv` returns, so `sending` always comes before `received`. The lines that really race are the child's
   `value sent` against main's `received` and `10`. The reviewer's flip (`sending received 10 value sent`) shows exactly that. The withdrawal
   is still right. Something like "the child's `value sent` and main's `received`/`10` come out …" would be exact. Change it the next time
   root touches `NATIVE_UNSTABLE`. It does not need a commit of its own.
2. **info: no further candidates.** My §5 scan found no other protected native case that prints from two threads or processes with nothing
   ordering the lines. On this evidence, no further withdrawal is needed before the next gate. The scan is by pattern, so a case that
   prints through a helper my patterns missed (a custom `write!` to `stdout()` from a pool or a callback) would not show. The two scans
   agree, though.
3. **info: where the decision lives.** It is in `main`'s `docs/state/history.jsonl` (line 725), not in `integ-w60`'s copy. That is the usual
   flow, root records on `main`, and the commit message points to it. Make sure the merge of `integ-w60` keeps that line.
