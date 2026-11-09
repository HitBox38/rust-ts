PASS WITH NOTES

**Wave 40f's accept stands.** No protected case was lost, removed or tampered with. All 60 protected suites ran, and every one of the
542,092 protected ids is `MATCH` in the gate's jsonl. The baselines are byte-identical from `39811561` to `6637fe41`. Across every row of
the 60 suites, protected or not, the only rows that differ from the wave 40e gate are the 7 retried cases, and only in their timing fields
(`attempts`). No status, first difference or `unported` reason moved. Three oracle keys changed, all in the report-only `miri-sysroot-*`
suites. The registered cases changed by one thing only: 58 new cases in the new report-only suite `rlib-native`. The `harness/` and
`scripts/` changes are exactly harness-w46's reviewed head `90045ea7` plus fixers-49's two `harness/scope.json` vendor entries, which
PORTING §5b allows. The two slow Miri cases have 25-27 s of room alone. The one number that is wrong is coverage: 24,293, not 24,290 (N1).

Regression audit, 2026-11-09. Gate `gate-20261109-084958-root-eit4`, tested `0638cdfa`, accepted `6637fe41`. The previous accept is wave
40e: gate `gate-20261108-194803-root-0xx0`, tested `7a4f6fad`, accepted `39811561`. I ran no gate and no full suite. What I did run:
- a dump of every registered case's oracle key at `7a4f6fad` (71 suites, 372,123 cases) and at `0638cdfa` (72 suites, 372,181 cases), with
  `difftest.ts`'s own `caseOracleCacheKey`, run from `git archive` trees of each commit; 0 errors;
- a comparison of every row of all 60 suites' jsonl (542,143 rows), this gate against wave 40e's, on every field;
- `frozen-lists.ts`'s `nearLimitCases` and `frozenSample` against the history at `0638cdfa` and the real run directories;
- `run-pass-miri`'s `dynamic-drop.rs` and `issue-8827.rs` with the harness's argv, cwd, `caseEnv` and 60 s limit, 3 times each alone; then
  a `difftest` of each against the cached oracle (`--jobs 1`);
- `coverage.ts` (summary) at `7a4f6fad`, `0638cdfa` and `6637fe41`, and `criteria.ts --run gate-20261109-084958-root-eit4`.

Everything ran on AC power (`pmset -g batt` before and after the timing runs), with `RUSTUP_AUTO_INSTALL=0` and `RUST_TS_REQUIRE_PROBES=1`.
I read code but changed none. Everything I wrote went to my scratchpad, except the side effects listed at the end.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | low | **Coverage is 24,293 / 27,053, not 24,290.** `coverage.ts` gives 24,290 at `7a4f6fad` and 24,293 at `0638cdfa` and `6637fe41`. The only crate that moved is `rustc_session`, 408 to 411 of 446: fixers-49 ported `code_stats.rs` (new `src/rustc_session/code_stats.ts`). Vendor coverage went from 5,298 / 17,015 to 5,307 / 17,360, with the new `memmap2-0.2.3` (2 / 115) and `tempfile-3.23.0` (7 / 230). `README.md:13`, `docs/state/current.json` (`coverage.ported`), and so `state.ts summary`, still say 24,290. Nothing protected depends on the figure. The next record should update it. | item 6 |
| N2 | info | **The two slow Miri cases have 25-27 s of room alone, and they still need the solo retry.** Alone, `dynamic-drop.rs` took 33.2, 34.3 and 34.8 s, and `issue-8827.rs` 34.4, 34.7 and 34.7 s, against a 60 s limit (55-58%). Both matched the cached oracle, with one output hash per case across all three runs. Both have timed out in the 12-job pool in every accepted gate that ran `run-pass-miri` (10 of 10). Their solo times fall slowly: 37.4 to 35.6 s and 35.7 to 34.8 s over the last six gates, the latest step after perf-miri's 2.1%. The posture is unchanged: they are protected by a quiet solo retry, like the TAIT cases. | item 5 |
| N3 | info | **`move-3-unique.rs` and `repeated-vector-syntax.rs` are not new retries.** `move-3-unique.rs` was retried in all 10 accepted gates that ran `run-pass-miri` (from `gate-20261102-174727-root-kxpt` on). `repeated-vector-syntax.rs` was retried in 9 of 10; it did not time out in `gate-20261104-143144-root-lpo8`. Their solo times since `retryTimes` began are 24.5-25.3 s and 18.3-19.0 s. Both were in the w40e audit's table too. | item 5 |
| N4 | info | **`staticNotes` holds only the notes of steps without a junit report.** That is what harness-w46 meant to build (the `gate.ts` header and `runStaticStep`'s comment say so). A `bun test` step's slow-test `note:` (unit-parallel N4) is printed by the gate itself and goes to the log only, never to `staticNotes`. This gate printed none: the slowest tests took 8.8, 18.3 and 10.2 s, against the 30 s threshold. Read `gate.json` together with the log when a unit step's time matters. | item 4 |
| N5 | info | **`miri-sysroot-alloc`, `-core` and `-std` changed keys again.** harness-w46 changed `scripts/miri-sysroot-run.ts` (harness-w45 review N6: an unknown pid namespace gets a random tag), and their `oracleKey` hashes that file. None of them is protected or gated. No cache entry exists under either the old or the new keys, so nothing was re-run or rewritten. | item 2 |

**Status of the w40e audit's notes.**
- **N1:** the TAIT cases still time out in the 12-job pool and depend on the solo retry. This gate's solo times were 25.0-25.1 s.
- **N2:** I did not re-check it.
- **N3 (the frozen-lists step's notes never reach the gate log): closed by harness-w46.** A passing step without a report now prints its
  `note:` lines after its `ok` line and returns them, and `staticChecks` collects them into `gate.json`'s `staticNotes` (item 4).
- **N4:** the keys changed again, and they still have no cache entries (N5 above).

## 1. Protected set: nothing lost, and every total agrees

I recomputed each figure with a script, from `git show` of every baseline at `39811561`, `0638cdfa` and `6637fe41`, and from each suite's raw
jsonl.

| Check | Result |
|---|---|
| `git diff 39811561 6637fe41 -- harness/baseline` | **empty**; `git log 39811561..6637fe41 -- harness/baseline` lists nothing |
| Baseline files | 60 at all three commits, with the same names and the same bytes; no baseline was ever deleted (`git log --all --diff-filter=D -- 'harness/baseline/*'` is empty) |
| Unique ids | **542,092** at all three commits; no duplicates in any file |
| Every id against the raw `<suite>.jsonl` | **542,092 of 542,092 `MATCH`**; no `MATCH` row outside the baseline; no protected id in any `.skipped.jsonl` |
| `gate.json` per suite | `baseline`, `total` and `match` equal the file and the jsonl in all 60; `lost`, `lostSkipped`, `gained`, `batchOnly*`, `oracleTimeouts` and `upstreamChanges` are empty in all 60 |
| Gate log (`.data/tmp/gate-w45.log`) | 60 `ok` suite lines with `lost=0 gained=0`; no `ERROR` line; `gate PASS run=gate-20261109-084958-root-eit4` |
| `history.jsonl` | append-only from `39811561` to `6637fe41`: 4 lines added (three decisions, then the accept), none removed |
| The accept record (`history.jsonl:661`) | `runId` and `head` (`0638cdfa`) are the run's; 60 suites; in each, `protected` equals the baseline's line count and `total` equals `gate.json`'s |
| `6637fe41` | parent `0638cdfa`; touches only `docs/next.md`, `docs/state/current.json` and `docs/state/history.jsonl` |
| `head`, `dirty`, `pass`, `staticOk`, `skipStatic`, `unstableOk`, `upstreamOk` | `0638cdfa`, `[]`, true, true, false, true, true |
| Suites run | **60 of 60**, the same set as the baselines; no `notRun`; no suite ran with `sample` or `filter` |
| HEAD during the gate | the main checkout's reflog has `0638cdfa` from 08:49:10Z until the accept at 19:30:58Z. The gate ran from 08:49:58Z to 19:29:40Z. **No file** in the main checkout outside `.data` changed in that window, so harness-w46's move of the `.rlib` files works (in wave 40e, three such files were written into the tree) |
| `main` = `integ-w45` | `git diff e2b7ba68 2118d372` is empty. Outside docs and PORTING.md, code at `0638cdfa` equals root-w45-check's checked head `51d6ca81` |

### Every row, this gate against wave 40e's

I compared all 542,143 rows of the 60 suites on every field. The skipped lists and the `.extra.jsonl` files are identical. **7 rows differ.
They are the 7 retried cases, the same 7 as wave 40e, and only their `attempts` (timing and load) changed.** Status, `retried` and every
other field are equal:
- `mir`: `error-tainting-issue-122904.rs`, `recursive-drop-elaboration.rs`, `recursive-drop-elaboration-2.rs`;
- `run-pass-miri`: `dynamic-drop.rs`, `issue-8827.rs`, `move-3-unique.rs`, `repeated-vector-syntax.rs`.

So none of wave 40f's subject-side changes moved a row in any of the 60 suites: fixers-49's three module-order fixes and its
`-Zprint-type-sizes` port, harness-w46's unit-step environment, or perf-miri's data-race change. That holds for rows that were not `MATCH`
too. The 51 non-`MATCH` rows (28 `DIFF`, 20 `UNPORTED`, 2 `TIMEOUT` in `run-pass-miri-heavy`, 1 `UNSTABLE` in `miri-pass`) keep their
first-difference lines and `unported` reasons.

## 2. Expectation tampering: none

`git diff 7a4f6fad 0638cdfa` touches 75 files. In `harness/`, `scripts/` and `tools/` it touches 36. All but `harness/scope.json` are
harness-w46's: `harness/corpus/gen-rlib-native.ts` and `harness/corpus/rlib-native/**` (new), `harness/rlib-native.test.ts` (new),
`harness/miri-sysroot.test.ts` (+55, additions only), `harness/suites.ts` (+143, one hunk appended at the end of the file: the `rlib-native`
suite; no existing line changed), `scripts/rlib-native-run.ts` (new), `scripts/gate.ts`, `scripts/lib/unit-steps.ts`,
`scripts/miri-sysroot-run.ts`, `scripts/gate-unit.test.ts` and `scripts/gate-static-stop.test.ts`. Untouched: every baseline,
`UPSTREAM.json`, `tools/`, `scripts/difftest.ts`, `scripts/lib/env.ts`, `scripts/lib/unstable.ts`, `scripts/frozen-lists.ts`, and every
corpus but the new one.

### Did these changes come through their own reviewed batch?

| Change | Commit | Review |
|---|---|---|
| Every `harness/` and `scripts/` file except `scope.json` | `90045ea7` (harness-w46), merged in `12989f17` | `docs/reviews/harness-w46.md`, APPROVE WITH NITS, reviewed head `90045ea7`. `git diff 90045ea7 0638cdfa -- harness scripts tools` is only the `scope.json` hunk, so nothing in these directories changed after the review |
| `harness/scope.json` | `7d6c79f2` (fixers-49 item 4) | `docs/reviews/fixers-49.md` N4 (info) asked for an owner's approval. Root recorded it (`history.jsonl`, 2026-11-09T07:53) |
| Root's merges on `integ-w45` | `2764988d` … `d3ff421c` | `docs/reviews/root-w45-check.md`, APPROVE WITH NITS |

### `harness/scope.json`

The only change is two entries under `vendor`: `"memmap2": "=0.2.3"` and `"tempfile": "=3.23.0"`. Upstream's `Cargo.lock` at the pin
(`6f5da406b56`) has exactly one `version` for each: memmap2 0.2.3 and tempfile 3.23.0. Both are dependencies of in-scope compiler crates
(`rustc_data_structures` for memmap2; `rustc_data_structures`, `rustc_fs_util`, `rustc_metadata` and `rustc_codegen_ssa` for tempfile).
The markers match the versions: 2 `// crate: memmap2-0.2.3` in `src/rustc_data_structures/memmap.ts`, and 7 `// crate: tempfile-3.23.0`
in `src/rustc_codegen_ssa/back/archive.ts`. This is the record PORTING §5b asks for, and nothing else in the file changed.

### Oracle keys

**I dumped every case's key at both commits**, from `git archive` trees, with `difftest.ts`'s own `caseOracleCacheKey`. There were no errors.

| | Count | Explanation |
|---|---|---|
| Cases added | **58**, all in `rlib-native` | the new report suite (harness-w46). It is not gated, per root's scope decision (`history.jsonl`, 2026-11-09T08:49). All 58 have an oracle cache entry already, from harness-w46's own runs and its review's runs |
| Cases removed | 0 | |
| Keys changed | **3**: `miri-sysroot-alloc`, `-core`, `-std` | their `oracleKey` hashes `scripts/miri-sysroot-run.ts`, which harness-w46 changed (N5). There is no cache entry under either key |
| Any other suite | no change | every key of the 60 protected suites is unchanged, so no protected oracle needed a re-run, and no cache entry was rewritten for one |

### Tests

| Check | Result |
|---|---|
| Per file, against wave 40e's reports | 670 files with 7,854 tests, against 668 files with 7,841 tests. **No file lost a test.** New: `harness/rlib-native.test.ts`, `src/rustc_session/code_stats.oracle.test.ts`. Gains of +1 in `miri-sysroot`, `data_race`, `sharded_value`, `check.oracle`, `compare_impl_item.oracle` and `type_variable_views` |
| Test files at `0638cdfa` | 671. 624 + 4 + 42 are in the three reports, with no overlap between the two unit reports. The one file in none is `rustc_data_structures/graph/tests.test.ts`, which has no `test(` in it, as before |
| Edited test expectations | `gate-unit.test.ts` adds the note cases (`notesPass`, `notesFail`, `notesFailTail`) and the crashed-file cases. `gate-static-stop.test.ts` adds `staticNotes` assertions and, in the stub, `notes` beside `ok`. `harness/miri-sysroot.test.ts` only adds the namespace cases. No earlier `pass` or `ok` expectation was weakened |

## 3. Suites not run, or run with less

The gate ran the 60 protected suites, in full. Of the 72 registered suites at `0638cdfa`, **12 did not run**. None has a baseline, and root's
scope decision names them as report-only:

| Suite | Cases | Note |
|---|---|---|
| `miri-sysroot-core`, `-alloc`, `-std` | 1 each | keys changed (N5), no cached oracle |
| `host-rlib` | 222 | report-only |
| `rlib-native` | 58 | **new in this wave**, report-only; its oracles are cached |
| `mir-heavy` | 1 | `supertrait-hint-cycle.rs`, which `mir` skips as heavy |
| `ir-hello` | 2 | M7a's `ir-hello` criterion is therefore "not in this gate" (item 6) |
| `parse-ui-json`, `check-core-bin`, `check-chain`, `miri-pass-tb`, `miri-fail` | 991, 1, 1, 132, 610 | never gated |

Inside the 60 suites, skips are as before: the `.skipped.jsonl` files equal wave 40e's in every suite. Most skips are for
`needs-llvm-components`, aux crates the harness does not build, cases compiletest ignores on `x86_64-unknown-linux-gnu`, and Tree Borrows cases. `miri-pass`'s `panic1.rs` is
`UNSTABLE` (never protected), as before. `run-pass-miri-heavy`'s `hashset-connected-border-12860.rs` and `step_overflowing.rs` reach their
1,800 s limit, and neither is protected.

## 4. Static steps

| Check | Result |
|---|---|
| Steps in the log | typecheck, unit tests, unit tests (alone), runner unit tests, markers, marker order, info sites, frozen lists: all `ok`; skips 1 (allowlisted), 0 and 0 |
| Unit tests | 335.8 s, 7,391 tests, 0 failures, 1 skipped; alone 87.7 s, 39 tests; runner 54.6 s, 424 tests. Slowest: 8.8 s, 18.3 s (`miri/contract.test.ts`), 10.2 s. No `note:`, since all are under 30 s |
| Static phase | 08:49:58Z to 08:58:18Z, 8 min 20 s (8 min 19 s in wave 40e) |
| **Frozen lists** | **48 / 48 `MATCH`** (16 each of `mir`, `mir-o2`, `check-ui`) in `gate-20261109-084958-root-eit4-frozen-lists`. I recomputed it with `nearLimitCases` over the history at `0638cdfa`: 37 accepted runs read, **no notes**, 4 `mir` cases left out (the three TAIT cases and `hkl_forbidden.rs`). `frozenSample` then picks exactly the 48 ids that ran |
| `staticNotes` against the log | `[]` in `gate.json`; the log has no `note:` line before the first suite. They agree |

**Would a step that prints `note:` lines have recorded them?** Yes. I read harness-w46's code. `runStaticStep`, for a step without a junit
report (frozen lists, typecheck, markers, marker order, info sites), takes every line of stdout and stderr that starts with `note:`. On a pass
it prints them after the `ok` line. On a failure it prints those not already in the tail. Either way it returns them. `staticChecks` pushes
each one as `{ step, note }`, and both `gate.json` writes (the stopped run and the finished one) store them as `staticNotes`.
`frozen-lists.ts:146` prints its notes as `note: frozen lists: …` with `console.log`, so they match. The tests cover each part:
`gate-unit.test.ts` covers the step (a note on stdout and one on stderr, on a pass, on a failure with a long tail, and on a short tail), and
`gate-static-stop.test.ts` covers `staticNotes` in both `gate.json` writes. The aggregation in `staticChecks` is one line that no test drives
directly, and it reads correctly. A junit step's notes are a separate matter (N4).

## 5. Retries and margins

### The two slow Miri cases, alone

I used the harness's own argv (`bun --preload src/rust_ts/miri_stack_first.ts src/miri/bin/miri.ts <file> …`, from `suite.subject([c])`),
cwd (`cwdOf`), environment (`caseEnv(c.env)` plus `RUST_TS_IMPL=port`) and the suite's 60 s limit, through `scripts/lib/common.ts`'s `run`,
as `runSubject` does. The 1-minute load was 1.2-2.5.

| Case | Alone ×3 (wall s) | User s | Max RSS MB | Room left | Gate solo | Gate pool | `difftest --jobs 1` |
|---|---|---|---|---|---|---|---|
| `drop/dynamic-drop.rs` | 33.2, 34.3, 34.8 | 40.1-41.7 | 2,142-2,157 | **25.2-26.8 s (42-45%)** | 35.6 | TIMEOUT 60.0 (36.1 user) | `MATCH` |
| `threads-sendsync/issue-8827.rs` | 34.4, 34.7, 34.7 | 40.0-40.3 | 1,930-1,977 | **25.3-25.6 s (42%)** | 34.8 | TIMEOUT 60.0 (33.7 user) | `MATCH` |

Both exited 0, with one output hash per case across the three runs. The gate's solo times are 0.8-2.4 s above mine for `dynamic-drop.rs`,
which started at load 31 just after the pool, and 0.1-0.4 s above mine for `issue-8827.rs`, which started at load 12. The cases are not at risk from a slowdown of the size seen so far. What they depend on is the solo retry, as N2
says.

### Every retried protected case, across gates

| Suite (limit 60 s) | Case | This gate, alone | w40e | w40d | w40c | Since |
|---|---|---|---|---|---|---|
| `mir` | `error-tainting-issue-122904.rs` | 25.1 | 25.2 | 48.3 | TIMEOUT | |
| `mir` | `recursive-drop-elaboration-2.rs` | 25.0 | 25.5 | 45.7 | TIMEOUT | |
| `mir` | `recursive-drop-elaboration.rs` | 25.1 | 25.4 | 46.0 | TIMEOUT | |
| `run-pass-miri` | `drop/dynamic-drop.rs` | 35.6 | 36.3 | 36.6 | 37.1 | every run-pass-miri gate (10 / 10) |
| `run-pass-miri` | `threads-sendsync/issue-8827.rs` | 34.8 | 35.2 | 35.0 | 35.8 | 10 / 10 |
| `run-pass-miri` | `moves/move-3-unique.rs` | 24.5 | 24.8 | 24.8 | 25.3 | 10 / 10 (N3) |
| `run-pass-miri` | `array-slice-vec/repeated-vector-syntax.rs` | 18.3 | 18.6 | 18.6 | 18.9 | 9 / 10, not in `…-lpo8` (N3) |

All 7 finished alone and matched. `SUBJECT_TIMEOUT_RETRY_CAP` is 50, far above the 3 and 4 needed. Root's figures in `docs/next.md:563`
(25.0-25.1 s; 35.6, 34.8, 24.5 and 18.3 s) equal `retryTimes`.

**The retries ran with no outside load.** `mir`'s pool ran at host loads 33-52 (24-33 in wave 40e), and its first retry started at load
57.0, at the pool's tail. The chain 57.0, 38.3, 25.7, 17.4 over 25.1, 25.0 and 25.1 s matches the decay of a 1-minute average with only the
case running (57.0 · e^(−25.1/60) = 37.5, plus about 1 for the case). `run-pass-miri`'s chain matches the same way: 42.7, 30.8, 17.8, 12.1,
7.2. So the TAIT cases' 25 s was measured right after a heavy pool, and it still equals wave 40e's.

### Power and host

| Check | Result |
|---|---|
| `host.allowBattery`, `host.powerLost` | false, `[]` |
| Samples | 172, all `AC Power`, none on battery, none without a power or load reading; largest gap 660 s (the 10-minute keep interval) |
| `hostStart`, `hostEnd` | AC at both marks of all 60 suites |
| `pmset -g log` (independent) | no battery, sleep or shutdown entry on Nov 9; the last battery entry is Nov 7 00:46. Booted Nov 4, no reboot |
| Load and swap | 1-minute load 1.1 to 68.4. The peak was at 12:54Z, at the end of `mirdump-ui`, inside the gate's own work. Swap 1.37-1.48 GB |
| Suite time | 10.52 h in all, against 10.77 h; each suite ran at 0.90-1.07x its wave 40e time (`mir` 0.96x, `run-pass-miri` 0.99x) |
| Heavy | `check-core` 9,005 MB max RSS, `rmeta-core` 9,796 MB, `mir-core` 9,518 MB, of 12,288 MB; `task-comm-6.rs` 145.3 s of 1,800 |

## 6. Root's numbers

| Figure | Claimed | Recomputed | |
|---|---|---|---|
| Protected total (README, `next.md`, commit message, `current.json`) | 542,092 | 542,092 | ok |
| Suites | 60 | 60 | ok |
| Gain | 0 gained, 0 lost | 0 / 0 | ok |
| Coverage (README, `current.json`) | 24,290 / 27,053 | **24,293 / 27,053 (89.80%)** at `0638cdfa`; 24,290 at `7a4f6fad` | **N1** |
| Miri | 1,506 / 1,535 | 1,506 / 1,535 (98.1%) | ok |

`scripts/criteria.ts --run gate-20261109-084958-root-eit4` (gate at `0638cdfa7e`, `pass=true`):

| Group | Result | Threshold |
|---|---|---|
| M6b run-pass | 3,474 / 3,478 = 99.88%, met | 90% |
| M6b run-fail | 294 / 294 = 100%, met | 90% |
| M6b miri-pass | 350 / 360 = 97.22%, met | 80% |
| M7a ir-hello | not met: "ir-hello: not in this gate" | 100% |
| M7a mir-o2 | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a mono-ui | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a check-rg | 34 of 34 crates, met | 33 |

These equal wave 40e's results.

## What I did not check

- **Protected cases other than the two Miri ones** were not re-run. Their status comes from the gate's jsonl, compared row by row with
  the last gate.
- **The TAIT cases, `move-3-unique.rs` and `repeated-vector-syntax.rs`** were not re-run. I compared the gate's times with the earlier
  gates' `retryTimes`.
- **Beside concurrent load:** I did not run the two Miri cases beside a sample, as the w40e audit did for the TAIT cases.
- **Port correctness** of fixers-49, perf-miri and harness-w46. That belongs to their reviews and to root-w45-check. I read the
  harness/script diffs, and `gate.ts`'s note path in full.
- **Typecheck and the unit steps** were not re-run. I rely on the gate's log and junit reports.
- **The report-only suites** were not run.

## Side effects outside my scratchpad

These are report files only, and nothing compared reads them. **No oracle cache entry was written:** no file under `oracle-cache` is
newer than the start of this audit (19:34:03Z).
- `.env.local` copied into this worktree (gitignored).
- Two run directories: `$RUST_TS_DATA/runs/w40f-audit-dynamic-drop` and `w40f-audit-issue-8827` (`difftest --filter … --jobs 1`, oracle
  from the cache).
- The key dumps called every suite's `cases()` at both commits, which touched the mtimes of cached aux directories (814 entries under
  `aux/`). The upstream checkout's directory mtime changed, but `git status` there is clean.
- `coverage.ts` rewrote `$RUST_TS_DATA/coverage.json` three times. The last run was from this worktree (`6637fe41`, the same code as
  `0638cdfa`).
