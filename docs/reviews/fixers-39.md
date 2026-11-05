# Independent review: fixers-39

Branch `t3/fixers-39-miri-mir-bugs`, head `4236e549`, merge base `db323c3b`. It merges cleanly with `main` at `8090a32f`. Tested at the lane head. Code read-only: every patch below was in a scratch worktree, none is committed.

## Verdict: APPROVE WITH NITS

All seven commits are correct and match upstream. Each regression test kills the old code. No sample of the six suites has a DIFF, CRASH or TIMEOUT.

**But the class of bug in item 3 is not closed.** The same shape is in `MatchBranchSimplification` (F1): at plain `-O` the port ICEs on some ordinary programs and **silently writes wrong MIR, exit 0** on others. F1 predates this lane, so it does not block the merge. It should be fixed before M7's first `-O` lane relies on `-O` being cured. The fix is five `clone_Place` calls.

**Root's decisions:**

- **Item 5, `ff3cef15`: ACCEPT.** It is an honest narrow port; the reasoning is under Item 5.
- **Item 6, `time.rs`:** move to `miri-pass-heavy` with a recorded A12 amendment, **before the next accept**. Leave `sync.rs#stack` protected in `miri-pass`.

| # | Severity | Where | Finding |
|---|---|---|---|
| F1 | **high for M7**; not a regression, no protected case affected | `src/rustc_mir_transform/match_branches.ts:119,176,242,338` | New statements store the arm's or parent's `Place` object. `SimplifyLocals` renumbers it twice. ICE or silently wrong MIR at `-O` |
| F2 | low | `src/rustc_structures/limit.ts:47` | A real `type_length_limit` of 2^53−1 now counts as unlimited: ICE where the oracle reports the limit |
| N1 | nit, evidence | `docs/handoff/fixers-39.md` item 3 | The 340 `mir` programs are weak evidence: the oracle exits 0 on only 35% of a sample of that suite |
| N2 | nit, not observable | `src/miri/clock.ts:145` | Sub-millisecond sleeps truncate to 0 ms, so the scheduler spins until the deadline |

### F1: the same aliasing bug in `MatchBranchSimplification`

`Place` is `Copy` upstream, and `LocalUpdater` writes `place.local` in place. Three things combine:

- `unify_by_eq_op`, `unify_by_int_to_int` and `unify_if_equal_const` put `dest` in the new statement. That object is also the arm's statement's `Place`.
- `unify_by_copy` also shares `copy_src_place` with the parent's `Discriminant` statement.
- If the arm survives through a second predecessor (an or-pattern here), both statements stay in the body, so `SimplifyLocals`'s `LocalUpdater` maps that one object twice.

The other passes clone at these points; this file does not.

**ICE at `-O`, `-Copt-level=2`, `3` and `-Zmir-opt-level=4`:** oracle exit 0; port `encountered _6 = Eq(copy _1, const 1_i32) with incompatible types`.

```rust
#![crate_type = "lib"]
pub fn e3(k: i32, a: i32) -> u32 {
    let pre = a == 3;
    let mut acc = 0u32;
    let mut i = 0;
    while i < 3 {
        let r = match (pre, k) { (true, _) | (_, 1) => true, _ => false };
        if r { acc += 1; }
        i += 1;
    }
    acc
}
```

**Silently wrong at `-O`:** both sides exit 0, validation passes, and `r`'s assignments land on `_9` (the local before it) instead of `_10`.

```rust
#![crate_type = "lib"]
#[inline(never)]
pub fn opaque(x: bool) -> bool { x }
pub fn wrong(k: i32, a: i32) -> u32 {
    let pre = a == 3;
    let mut acc = 0u32;
    let mut i = 0u8;
    while i < 3 {
        let y = i == 2; let z = opaque(y);
        let r = match (pre, k) { (true, _) | (_, 1) => true, _ => false };
        if r { acc += 1; }
        if z { acc += 2; } if y { acc += 4; }
        i += 1;
    }
    acc
}
```

```
<         _10 = Eq(copy _1, const 1_i32);        (oracle)
>         _9 = Eq(copy _1, const 1_i32);         (port)
```

Run them with `--edition=2021 --target=x86_64-unknown-linux-gnu -Awarnings -O -Zunpretty=mir`.

- **Root cause proven:** with `clone_Place(dest)` at those four sites and `clone_Place(copy_src_place)` at `:338`, in a scratch copy, these programs and my larger variants match the oracle at every level tried.
- **Base and scope:** base `db323c3b` fails the same way on both. `run-pass-miri` passes `-Zmir-opt-level=0`, so almost no protected case runs this pass. One that hit the bug would not be a MATCH, and the fix only adds copies, so no protected case should change. That is reasoning plus samples, not a gate.
- **M7's exposure:** in codegen, the wrong-local variant is a miscompile. On ripgrep's 35 crates the checker reports shared `Place`s from this pass 50 times and no crate diverges, so the trigger is uncommon, not absent.
- **Suggested test:** the two programs above as oracle fixtures, in the style of `inline.oracle.test.ts`.

### F2: `limit.ts:47`

`value <= this._0 || this._0 === USIZE_MAX` can't tell the sentinel (`Number.MAX_SAFE_INTEGER`) from a limit the user wrote. Adding `#![type_length_limit = "9007199254740991"]` to `type_length_wraps.rs`:

- oracle: exit 1, reached the limit, suggesting `18446744073709551607`
- port: exit 101, `failed to resolve instance`

`#![type_length_limit = "18446744073709551000"]` fails the same way through the lossy `usize_from_str` (`rustc_session/options.ts:155`), which the handoff already flags. Both are contrived limits. Queue with the `tools/codegen` `bigint` work.

## Item 1: `0036b049`, pointer fragments

**Correct.** Upstream's `{prov:#?}` is `Debug` of the provenance. `debug_provenance` dispatches on representation:

| Provenance | Representation | Output |
|---|---|---|
| Miri `Concrete` | object | `[alloc..]<tag>` |
| Miri `Wildcard` | object | `[wildcard]` |
| `CtfeProvenance` | bigint | `debug_CtfeProvenance` |
| `AllocId` | number | `debug_AllocId` |

- **CTFE output cannot change.** The bigint and number branches call the same functions the removed `debug_prov` called. `debug_Pointer` never used its third argument when provenance is present (`pointer.ts:398`), so only the `frag.prov` line changes.
- **The CTFE fragment path is not reachable from a final value:** the compiler rejects it with `encountered partial pointer in final value`, on both sides.
- **Samples:** `mir` 200/200, `mirdump-ui` 200/200.
- **Other object-into-string paths:** none. The lane's grep was by hand, so I ran a typed scan with the TypeScript API over 2,432 non-test files: every template span and `+` / `+=` with a string side.
  - All the object-typed hits are false positives: the `proc_macro/quote.ts` tagged template; `"" | Str`, where `Str` has `toString`; and a test helper.
  - **Limit:** `any` and generic values are listed, not resolved. There are none in `rustc_middle/mir` or `src/rustc_const_eval`; in `src/miri` they are `process.platform`, `process.arch` and a log variable name. `.join` and `String(x)` are not scanned.

## Item 2: `1cbaebc9`, `retain`

**Correct.** Upstream's `self.borrows.truncate(write_idx)` starts `write_idx` at 1 and does nothing on an empty stack.

- **O1 program, against the oracle:** MATCH on the lane with default flags, `-Zmiri-provenance-gc=1` and `-Zmiri-seed=7`. On base: exit 101.
- **Elsewhere:** not found. A scan of all `x.length = y` in `src/` leaves 15 candidates. I read the ones that could grow an array: each is guarded or uses a value that cannot exceed the length (`coverage/spans.ts:30` returns early at `length <= 1`; `suggest.ts:2268` is under `> 5`). `stack.ts` was the only unguarded write index starting at 1.

## Item 3: `42927bfb`, `Inline`

**The fix is right and is not papering over.** `UnwindAction` is `Copy`, and upstream's `self.cleanup_block` copies it on each use. `clone_UnwindAction` is that copy, per PORTING §8. The other arms are safe: `Cleanup` builds a new object, `Terminate` and `Unreachable` are never written (`successors_mut` writes only `Cleanup._0`), and the `UnwindResume` arm only reads the number.

**The cure holds:**

| Program | Result |
|---|---|
| plan-m7's 5 run-pass failures, compiletest's argv | 5/5 byte-identical |
| `fe/prog.rs -O`; `o2/p0`–`p5`, `one`, `two`, `three` | 10/10 byte-identical |
| `docs/reviews/mono-lanes.md`'s O2 program, at `-Copt-level=2`, `3`, and `1` with `-Zmir-opt-level=3` | 3/3 byte-identical; base ICEs |
| **ripgrep, all 35 crates**, cargo's release flags and env, `-Zunpretty=mir` | **35/35 byte-identical, 2,270,263 lines**, oracle exit 0 on all, 317 s of port time |
| `rg` through mono collection, unstubbed | No O2 ICE. Stops at `Allocation::new` in `vtable_allocation_provider`, plan-m7's separate O3. I did not stub past it |

**The lane's sample, extended.** All are my own programs or samples, compared in bytes with the oracle:

| Sample | Levels | Result | Oracle exit 0 |
|---|---|---|---|
| 150 run-pass (new salt) | `-Copt-level=3`; `-Zmir-opt-level=4`; `-Copt-level=3` + inline thresholds 2000 + `-Zvalidate-mir` | 450/450 | 450 |
| 359 `tests/mir-opt` (408 less aux or target-specific) | `-Copt-level=3`; `-Zmir-opt-level=4 -Cdebuginfo=2` | 716/718, 2 UNPORTED (`rustc_graphviz::render`, from `dump_dataflow.rs`'s own `-Zdump-mir`) | 656 |
| 100 run-pass (new salt) | `-Copt-level=3 -Cdebuginfo=2`; `-Copt-level=2 -Cpanic=abort` | 200/200 | 199 |

No ICE and no DIFF in any of those 1,368 runs. **Yet they missed F1,** which took a program written for it. These sweeps do not show `-O` is correct.

**The aliasing audit.** A hand audit would miss cases, so I built a throwaway checker, hooked after every pass in `run_passes_inner`. It walks the whole `Body` and reports any non-frozen object reachable by two paths, or still held by two bodies.

- **Validated:** on base it reports `Inline $Cleanup ... terminator.kind.unwind` on `p2.rs`.
- **Over those sweeps, and ripgrep's 35 crates:** the only mutable MIR type left shared in one body is `Place`, only after `MatchBranchSimplification`. There is no shared `$Cleanup`, `SourceInfo`, `SwitchTargets`, `Statement`, `Terminator`, `Operand` or `Rvalue`. Everything else shared is an immutable leaf: `DefId`, `HirId`, `ScalarInt`, `Instance`, unit kinds.
- **Cross-body:** the first version of the check also flagged objects moved by promotion and nested coroutine bodies. Once it required the other body to still hold the object, what remained outside nested coroutine bodies was immutable leaves.
- **Statically:** a typed scan of `rustc_mir_transform` and `rustc_middle/mir` for bare (unclone) stores of `Place`, `UnwindAction`, `SourceInfo`, `Operand`, `Rvalue`, `SwitchTargets` and `TerminatorKind`. 213 hits; I read where each came from, by a script's trace and by eye, not by proof. They replace their old holder (`replace_in_place`, a moved `Call`), build fresh objects, clone at their use, or sit in shims, which only reach a caller through `clone_Body`. Only `match_branches.ts` stores a `Place` that stays live elsewhere.

**Conclusion:** `map_unwind` and F1 are isolated misses in a port that otherwise clones consistently, not a systemic gap. I recommend keeping the checker's approach for M7: it found F1's sharing before any mismatch did.

**N1.** 70 of 200 sampled `mir` cases exit 0 on the oracle at `-Copt-level=3`, as plan-m7 §5 also warned. So most of the handoff's 340 runs stop before optimization. Its conclusion holds, by the evidence above.

## Item 4: `4c0c1cfe`, `type_length`

**Correct and consistent.**

- `+=` and `-` wrap with `BigInt.asUintN(64, ..)`, and `> 16` compares a `bigint` with a `bigint`.
- `value_within_limit` compares exactly (JS compares `bigint` with `number` without rounding).
- The diagnostic prints all 64 bits.
- `issue-83150.rs`: stderr byte-identical to the oracle, suggesting `18446744073709551607`. 82 s under load.
- The fixture is the oracle's: regenerated, diff empty.

**Cost:** none that matters. Upstream calls `type_length` only under `-Zenforce-type-length-limit` (`instance.rs:600`; one `tests/ui` file uses it) or on `expect_resolve`'s error path (`:629`). `value_within_limit` is hot, but its `||` runs only when the comparison already failed. F2 is the one inconsistency.

## Item 5: `ff3cef15`, the empty poller. Decision: **ACCEPT**

**An empty poll is exact for everything Miri's target can observe.**

- **The selectors.** Miri is in the root workspace, so the toolchain builds mio 1.1.1 from the root `Cargo.lock` (`src/tools/miri/Cargo.lock`'s 1.2.3 is only for standalone builds). I read both: `kevent(kq, NULL, 0, events, cap, ts)` and `epoll_wait(ep, events, cap, ms)` differ only in rounding (epoll rounds up to a millisecond). With nothing registered, each returns 0 events after the timeout, or `EINTR` early.
- **Zero timeout.** Returns at once with no events, so upstream's event loop has nothing to process. The port's no-op is exact, and is the case behind the 17 matches.
- **Timed poll.** Only real time passes. `poll_and_unblock` ignores `Interrupted`, then the scheduler recomputes the deadline, so an early wake is already legal upstream. The port's truncated sleep is such a wake (N2).
- **Sleeping for the timeout matches.** `Bun.sleepSync` through `MonotonicClock::sleep`'s `Host` arm. Extra `schedule()` passes with no enabled thread have nothing to choose from, so they draw no random number.
- **Nothing else is observable.** The kqueue fd is a host handle, and the target sees Miri's own virtual `FdTable`. `Poll::new` failing needs host fd exhaustion, which the port does not model. Target semantics are the same either way, since no event ever reaches `Readiness`.
- **`Poll::poll(None)` is unreachable with no sources.** `any_thread_blocked_on_host` iterates `sources`, so upstream reports a deadlock instead.
- **The stand-in hides nothing.** `NO_HOST_POLLER` (`blocking_io.ts:86`) only stands for `Some`. `sources` is filled only by `register`, which stops `unported` (`:133`), so the guard at `:112` is always true and the stop at `:122` is unreachable today. If sockets are ported, the guard fails safe.

**Run against the oracle with `-Zmiri-disable-isolation`:**

| Program | Result |
|---|---|
| sleeps of 0, 1, 500, 999, 1000, 1001, 1500 and 12,345 µs, `park_timeout`, `wait_timeout`, 3 threads waking in deadline order | MATCH twice |
| deadlock with nothing registered | MATCH (exit 1) |
| sleeper beside a thread blocked forever | MATCH (exit 1) |
| target `epoll` on `eventfd` and `socketpair`, with timeouts 5, 0 and −1 | MATCH |
| `no_sources.rs` fixture | regenerated: same |

**One difference, and it does not look like the poller.** With 20, 40 and 60 ms sleeps and no start barrier, the wake order differs (`[1, 0, 2]` against `[1, 2, 0]`). With a start barrier and 300, 600 and 900 ms it matches, so the likely cause is the port's slow thread spawn; I did not measure that directly. Any isolation-off program whose output depends on real-time order can diverge. That is item 6's problem. All 17 cases matched in every run I made, so I saw no sign of it there.

**Not checked:** a real injected `EINTR`, host fd exhaustion, Windows IOCP (`AGENTS.md` §5: Windows is unchecked).

**What this opens.** All 17 cases reach host paths that were unreachable before. `-Zmiri-disable-isolation` still stops by name on `open_a_file_in_proc`, the sockets, `std::fs` and `open_file_or_dir`.

## Item 6: real-clock assertions

**How it fails.** Only the serial re-run of a TIMEOUT exists: `difftest.ts` does not retry a DIFF. So an assertion that fires under load is a lost protected case and a STOP.

**Measured at the lane head.** The window is `time.rs`'s first `duration_sanity` (limit 1,000 ms), from a copy of the test that prints it. The rates are the real case with its suite argv.

| `tests/pass/shims/time.rs` | Window | Real case passes |
|---|---|---|
| Oracle, quiet | 6.6–6.8 ms (second window 4.7 ms) | – |
| Port, one at a time, 12 runs, load 3–4 | 134–157 ms (**6.4× margin**) | 8/8, 2.3 s |
| 6 at once | | 24/24 |
| 12 at once | 604–878 ms | 36/36 |
| During a real `miri-pass` pool (12 jobs, load 20–32) | 145–681 ms, median 544 (**1.5× margin**) | MATCH once |
| 16 at once | 772–1,484 ms | **43/48** |
| 24 at once | | **4/48** |

| `tests/pass/concurrency/sync.rs#stack` | `wait_timeout(10 ms)` window, limit 4,000 ms | `notify` window, must beat 4,000 ms | Real case passes |
|---|---|---|---|
| Quiet | 41–45 ms | 131–148 ms (27×) | 3/3 |
| During the `miri-pass` pool | max 269 ms | max 745 ms (**5.4×**) | MATCH once |
| 16 at once | max 358 ms | max 738 ms | 32/32, slowest 30 s |

**Is moving `time.rs` consistent with A12?** Not with its words, but with its purpose.

- **The words:** "never by how the port does". The oracle's window is 5–7 ms, so load only threatens it because the port is slow.
- **The purpose:** "a longer limit must not turn a port TIMEOUT into a MATCH". The limit plays no part here: a 2.3 s run never nears 60 s, and the program's own 1,000 ms bound stays. A port that became 7× slower would still fail in the heavy class. It removes contention, which is what the second reason already does for the file-writing cases.

**Recommendation, one per case:**

| Case | Recommendation |
|---|---|
| `tests/pass/shims/time.rs` | **`miri-pass-heavy`**, with a recorded A12 amendment naming a third reason as a property of the program: *an isolation-off case whose source asserts an upper bound on the real clock*. Never add one because it was seen to fail. **Do it before the next accept:** once protected in `miri-pass`, moving it means touching a baseline. It is a `harness/` change, so its own reviewed batch. The cost is about 2 s in a serial suite; the alternative is a STOP and another ~10 h gate. |
| `tests/pass/concurrency/sync.rs#stack` | **Leave protected in `miri-pass`.** 5.4× at the worst load measured. |
| `sync.rs#tree`, `#tree_implicit_writes` | **Leave** in the report suite `miri-pass-tb`. |
| `tests/pass/shims/sleep_long.rs` | **Leave:** it asserts no upper bound. |
| `socket.rs`, `fs.rs` | **No action:** they stop by name. `socket.rs` has lower bounds only. Recheck when sockets or `std::fs` are ported. |
| `thread_park_isolated.rs`, `time-with-isolation.rs` (protected) | **Leave:** isolation on, so the virtual clock. Their bounds depend on the port's basic blocks, not on load. |

**Other existing protected cases:** none is exposed. Across the 7 Miri suites, no protected case has `-Zmiri-disable-isolation`, because all of them stopped at `Poll::new` until this lane. So this is a new class, and it starts here. The scan matches clock calls and asserts by text; a real-clock bound written differently would be missed, so I also read `time.rs`, `sync.rs` and `sleep_long.rs` directly.

**Side note, oracle only:** `time.rs:8` asserts `> 1` ms and the oracle's second window is 4.7 ms, so a host 3× faster would fail on the oracle's side at a pin move. Nothing to do now.

## Item 7: `a4a99aff`

**Correct.** `run()` saves `args_os()` and restores it in `finally`. `bun test ./src/miri/bin/miri.test.ts ./src/rustc_session/diagnostics.test.ts`, the fixers-38 F3 scenario: old code 17 pass, 1 fail (`was_invoked_from_cargo`); lane 18 pass. `miri.test.ts` is the only test file that calls `set_args_os`.

## Item 8: samples and regression tests

Lane head, `RUST_TS_AGENT=review-fixers-39`:

| Suite | Sample | MATCH | Other |
|---|---|---|---|
| `miri-pass` | 353 (all, see below) | 346 | 5 UNPORTED, 2 UNSTABLE |
| `miri-fail` | 200 | 195 | 5 UNPORTED |
| `miri-pass-tb` | 132 (all) | 132 | |
| `run-pass-miri` | 200 | 200 | |
| `mir` | 200 | 200 | |
| `mirdump-ui` | 200 | 200 | |

No DIFF, CRASH or TIMEOUT. `miri-pass`'s 5 UNPORTED are named stops: `open_a_file_in_proc`, three socket cases and `intrinsics-x86-aes-vaes`. Its 2 UNSTABLE are the listed ones. All 13 of the lane's `miri-pass` cases MATCH, plus `sync.rs#tree` and `#tree_implicit_writes` in `miri-pass-tb`. Run by name in `miri-fail`: `vararg_callee_signature_mismatch` and `wrong_fixed_arg_count` MATCH, while `input_arg_mismatch` and `return_type_mismatch` are UNPORTED, as the handoff says. `tsc` is clean, and `coverage.ts --check --offline` reports markers ok.

**Spot-check, each fix reverted alone at the lane head, tests with `RUST_TS_REQUIRE_PROBES=1`:**

| Item | Reverted | Lane | Expected values |
|---|---|---|---|
| 1 | 1 fail (`ptr_fragment_dump`) | pass | Live oracle |
| 2 | 2 fail (`gc_unknown_bottom`, `stack.test`) | pass | Fixture; regenerated, same |
| 3 | 1 fail (`shared_unwind`) | pass | Live oracle |
| 4 | 1 fail (`type_length_wraps`) | pass | Fixture; regenerated, same |
| 5 | 4 fail | pass | Fixture; regenerated, same |
| 6 | 1 fail (scenario above) | pass | Unit test, no oracle |

## What I did not check

- The gate. I also ran `miri-pass` whole rather than `--sample 200`, on purpose, to get a real 12-job pool under the clock probes; it took about 3 minutes. `miri-pass-tb` is under 200 cases anyway.
- `run-pass-miri-heavy`, `miri-pass-heavy` and the full unit suite.
- `rg` past `Allocation::new`; codegen of any of this.
- That F1 is the last of its class. The checker only sees programs it runs, and F1 needed a purpose-written trigger. The static scan is complete only for direct stores, not for an object passed through a helper's parameters beyond `patch.add_assign`.
- N2's CPU cost.
- Windows, per `AGENTS.md` §5.

## Incident: I dirtied the upstream checkout, now cleaned

My sweep ran `tests/mir-opt` programs with the upstream checkout as cwd. `tests/mir-opt/dump_dataflow.rs` carries its own `-Zdump-mir`, and at 04:18 the oracle wrote 205 files to `$RUST_TS_DATA/rust/mir_dump/`. I found it when difftest printed `ERROR: the upstream checkout is not clean before the run`.

I checked that every file was `dump_dataflow.*` from that minute, removed the directory at about 04:42, and `git status` there is clean. It did not change any result, but:

- My first four difftests above printed that line.
- **Any other session that ran a difftest between 04:18 and 04:42 (2026-11-05) would have printed it too**, and if a gate had started in that window, its evidence would carry the note. I know of none.
