PASS WITH NOTES

**Wave 40e's accept stands.** No protected case was lost, removed or tampered with. All 60 protected suites ran, and every one of the
542,092 protected ids is `MATCH` in the gate's jsonl. Across every case of the 60 suites, protected or not, exactly two rows differ from
the wave 40d gate. Both are unprotected `mono-ui` cases that set `RUSTC_LOG`, and both moved because `mono-run.ts` now starts the logger.
Only three oracle keys changed: the report-only `miri-sysroot-*` suites. **The three TAIT cases are much safer:** alone they take
24.5-25.3 s (9 of 9 runs), and beside a 4-job sample 32.2-33.0 s (9 of 9; in w40d that timed out 5 of 5). But they still time out
beside a 12-job sample (3 of 3), as they do in the gate's own pool, so they still depend on a quiet solo retry. That is note N1, low.
The other notes are low or informational.

Regression audit, 2026-11-09. Gate `gate-20261108-194803-root-0xx0`, tested `7a4f6fad`, accepted `39811561`. The previous accept is
`4ed419a1` (wave 40d). I ran no gate and no full suite. What I did run:
- a dump of every registered case's oracle key at `4ed419a1` and at `7a4f6fad` (372,123 cases each), from `git archive` trees;
- a status comparison of every row of all 60 suites' jsonl, this gate against `gate-20261108-052654-root-cpy7`;
- the three TAIT subjects with the harness's argv, cwd, `caseEnv` and 60 s limit: 3 times each alone, 3 times each beside a `--jobs 4` `mir`
  sample, and once each beside a `--jobs 12` sample; then a `difftest` of the three against the cached oracle (`--jobs 1`);
- `frozen-lists.ts`'s `nearLimitCases` and `frozenSample` against the history at `7a4f6fad` and the real run directories;
- `coverage.ts` (summary) and `criteria.ts --run`.

Everything ran on AC power, with `RUSTUP_AUTO_INSTALL=0` and `RUST_TS_REQUIRE_PROBES=1`. I read code but changed none. Everything I
wrote went to my scratchpad, except the side effects listed at the end.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | low | **"No longer at risk" holds only against light concurrent work.** The TAIT cases still time out in the gate's 12-job pool (60.1 s wall at 39-41 s user), so every gate protects them only through the solo retry. That retry now has room: 25 s alone and 33 s beside a 4-job sample, both against 60 s. But **beside a 12-job sample, all three timed out** (60.0-60.1 s, 34-35 s user, load 14 to 33). `difftest`'s default `--jobs` is the core count, 12, so one lane's plain `--sample` overlapping `mir`'s retries (about 76 s, at the end of `mir`) would lose all three. They now have more headroom than `run-pass-miri`'s `dynamic-drop.rs` (36.3 s alone) and `issue-8827.rs` (35.2 s), which have been protected under the same general precaution since wave 39. So root's decision is sound if "a precaution, as for every gate" is kept: no default-jobs difftest on the host during a gate (`--jobs 4` or less is survivable). A better phrasing for the decision would be "at risk only from heavy concurrent work during the retries, like every near-limit case". | item 3 |
| N2 | low | **`docs/next.md:555` says "27-32 s beside a 4-job sample"; I measured 32.2-33.0 s** (9 of 9). The difference is small, and 55% of the limit is still comfortable. | item 3 |
| N3 | info | **The frozen-lists step's notes still never reach the gate log** (root-w44-check N1, queued at `docs/next.md:518`). I recomputed what the step saw: no notes, 36 accepted runs read, 4 `mir` cases left out (the three TAIT cases and `hkl_forbidden.rs`). The 48 cases it ran equal `frozenSample` of the baselines at `7a4f6fad` with that exclusion, all 48 `MATCH`. | items 2, 4 |
| N4 | info | **`miri-sysroot-alloc`, `-core` and `-std` changed keys** (harness-w45 put `<ns>` into `scripts/miri-sysroot-run.ts`, which their `oracleKey` hashes). None is protected or gated. No entry exists under the new keys, so those oracles were not re-run; they will run on the suites' next use. | item 2 |

The w40d audit's notes are closed. N1: perf-tait brought the cases from 46-48 s to about 25 s alone, and from 5 of 5 timeouts beside a
4-job sample to 0 of 9. N2: `frozen-lists.ts`'s header names the three cases, and `KNOWN_NEAR_LIMIT` excludes them whatever the run
directories hold.

## 1. Protected set: nothing lost, and all totals agree

I recomputed each figure with a script, from `git show` of every baseline at `4ed419a1`, `7a4f6fad` and `39811561` and from each suite's
raw jsonl.

| Check | Result |
|---|---|
| `git diff 4ed419a1 39811561 -- harness/baseline` | **empty**; `git log 4ed419a1..39811561 -- harness/baseline` lists nothing |
| Baseline files | 60 at all three commits, the same names; none ever deleted (`git log --all --diff-filter=D -- 'harness/baseline/*'` is empty) |
| Unique ids | **542,092** at both ends; no duplicates in any file; no id at `4ed419a1` missing at `39811561` |
| `gate.json` per suite | `baseline` equals the file at `7a4f6fad` in all 60; `lost`, `lostSkipped` and `gained` empty in all 60 |
| Every id against the raw `<suite>.jsonl` | **542,092 of 542,092 `MATCH`**; 0 `MATCH` rows outside the baseline |
| jsonl rows against `gate.json` `total` and `match` | equal in all 60 |
| `history.jsonl:657` (accept) | `runId` and `head` (`7a4f6fad`) are the run's; 60 suites; in each, `protected` equals the baseline and `total` equals `gate.json`'s |
| `history.jsonl` | append-only from `4ed419a1` to `327cb302`: 5 lines added, none removed |
| `docs/state/current.json` | 60 suites summing to 542,092; coverage 24,290 / 27,053 |
| `39811561` | parent `7a4f6fad`; touches only `current.json` and `history.jsonl` |
| `head`, `dirty`, `pass`, `staticOk`, `skipStatic`, `unstableOk`, `upstreamOk` | `7a4f6fad`, `[]`, true, true, false, true, true; no `ERROR` line in `tmp/gate-w44.log` |
| Suites run | **60 of 60**, the same set as the baselines; no `notRun`. Report-only suites stay out, per root's scope decision (`history.jsonl`, 2026-11-08T19:47) |
| HEAD during the gate | the main checkout's reflog has `7a4f6fad` from 19:47:54Z until the accept at 06:44:01Z; the gate ran 19:48:03Z to 06:42:47Z. The only files modified in the checkout in that window are three gitignored `.rlib` files that unit tests write (next.md:522, unit-parallel N5) |

## 2. Expectation tampering: none

`git diff 4ed419a1 7a4f6fad` touches 74 files. In `harness/`, `scripts/` and `tools/` it touches 10 files, and none of these: any
baseline, `UPSTREAM.json`, `harness/scope.json`, `harness/suites.ts`, `tools/probes`, `scripts/lib/unstable.ts`, `scripts/lib/env.ts`,
or a suite corpus.

### Oracle keys

**I dumped every case's key at both commits**, with `difftest.ts`'s own `oracleCacheKey`, `cwdOf` and `depsOf`, run from each tree.
There were 372,123 cases at each, with no error. **Exactly 3 keys changed:** `miri-sysroot-alloc`, `-core` and `-std` (N4). No case
was added or removed. No key of any protected suite changed, so no protected oracle needed a re-run, and no cache entry was rewritten
for one.

Oracle keys cover only the oracle side. The subject-side changes (perf-tait, `mono-run.ts`, `Mmap::map`, the module-order fixes) are
checked by statuses below.

### Every case's status, this gate against wave 40d's

This compares every row of all 60 suites' jsonl, protected or not, on status, first-difference line and `unported` reason. **Exactly 2 rows
differ, and neither is protected:**
- `mono-ui` `tests/ui/attributes/log-backtrace.rs`: was `DIFF` (line 11, the oracle's ` INFO rustc_metadata::creader ...` against nothing),
  now `UNPORTED` (`rustc_log::BacktraceFormatter`);
- `mono-ui` `tests/ui/rustc-env/def-path-hash-ice-157238.rs`: still `DIFF`, with the first difference moved from line 11 to line 646.

Both set `RUSTC_LOG`, and both moved closer to the oracle because `mono-run.ts` now calls `init_rustc_env_logger`. Neither id is in
`harness/baseline/mono-ui.txt`. The second is protected in `mir-o2`, where it is `MATCH` as before. No other `mono-ui` row changed, so no
case picked up a WARN or ERROR event from tracing's default filter.

### The named items

| Item | Finding |
|---|---|
| `scripts/frozen-lists.test.ts` | New in this wave (not in `4ed419a1`), so no earlier expectation was weakened. Root's F2 rewrite turned failures into notes; the test checks the notes, that a missing latest run still keeps the older runs' cases, that `KNOWN_NEAR_LIMIT`'s ids are protected ids (root-w44-check N4), and that no seed or size picks an excluded id. |
| `scripts/retry-times.test.ts` | Only additions: the `load1` keys and their range, plus the tolerance check (harness-w45 F1, as root-w44-check verified). Every earlier status assertion (`once`, `always`, `plain`, `differs`) is unchanged. |
| `KNOWN_NEAR_LIMIT` | 4 `mir` ids, each in `harness/baseline/mir.txt`. They are exactly the cases ever in `mir`/`mir-o2`/`check-ui` `retryTimes` of an accepted run (I read all 36 run directories through `nearLimitCases`). It only narrows the frozen-lists sample and decides no status. Its reason text ("about 26 s since perf-tait") is close to what I measured (25 s). |
| `mono-run.ts` logger | See above: no protected `mono-ui` row changed. 3,475 of 3,479 `MATCH` before and after. |
| Unit-step naming | `runStaticStep` decides pass and fail as before: `pass` starts as `r.code === 0`; a missing or unreadable report, or an unexpected skip, makes it false; nothing turns a false back to true. What changed is the printing: `ok` is printed only after the report parses, files that throw at load are named, and the slowest test is printed with a `note:` above 30 s. In `gate-unit.test.ts` the old exact line list became a length check plus the same `ok` lines, with the timed lines masked. Every `pass` expectation is unchanged, and the new cases (`load`, `aloneLoad`, `aloneExit0`, `nameless`) all expect `false`. |
| perf-tait: typed interner equalities, packed opaque key | No status or first-difference line changed in any of the 60 suites, including the 21,525 `mir` cases and every next-solver and TAIT case, protected or not. Its review reproduced the same first-interning order on 1,190 programs. |
| `Mmap::map` (fixers-48) | Regular files still go through `Bun.mmap` (review §3); only non-regular files take the new FFI path. All rmeta and check suites are `MATCH` in full (`rmeta-core` 82,338, `rmeta-alloc` 14,678, `rmeta-std` 18,196, `rmeta-ui` 730, `check-*`), and their rows equal the last gate's. |
| Other test-file edits | `pat_b.test.ts`: lengths written as `bigint` (`1n, 3n`), as the 2^53 fix requires. `rlib_native.oracle.test.ts`: TMPDIR set through `set_var`, because `env::temp_dir` now reads C's environ, plus two new tests. `diagnostics_b.test.ts`, `env.test.ts`, `encoder_contract.test.ts`: import lines only. `rlib_macho.test.ts`: header text only; its review rebuilt `HOST_RLIB` byte for byte. `big_err.aarch64-apple-darwin.txt`: regenerated from the pinned oracle (fixers-48 review §1). `harness/miri-sysroot.test.ts` keeps every case and adds the namespace ones. `gate-static-stop.test.ts` only adds cases. |
| Tests per file against the last gate | 668 files with 7,841 tests, against 664 and 7,821. **No file lost a test.** New files: `first_import`, `type_variable_views`, `element_eq`, `frozen-lists`. Gains: `info_sites_check` +1, `rlib_native` +1, `env` +1, `gate-static-stop` +2. |

## 3. Retries and margins

### The three TAIT cases

All runs used the harness's own argv, cwd, `caseEnv` and the 60 s limit. Alone, the 1-minute load was 1.4-2.8.

| Case | Alone ×3 (wall s) | Beside a `--jobs 4` sample ×3 | Beside a `--jobs 12` sample ×1 | Gate pool | Gate solo retry | w40d gate / audit alone |
|---|---|---|---|---|---|---|
| `error-tainting-issue-122904.rs` | 24.5, 25.2, 25.1 | 32.4, 33.0, 33.0 | **TIMEOUT** 60.1 (33.7 user) | TIMEOUT 60.1 (39.4 user) | **25.2** | 48.3 / 46.0-46.5 |
| `recursive-drop-elaboration-2.rs` | 24.9, 25.2, 25.2 | 32.5, 32.5, 33.0 | **TIMEOUT** 60.0 (34.7 user) | TIMEOUT 60.1 (41.1 user) | **25.5** | 45.7 / 46.0-47.0 |
| `recursive-drop-elaboration.rs` | 25.1, 25.3, 25.3 | 32.8, 32.2, 32.6 | **TIMEOUT** 60.1 (35.0 user) | TIMEOUT 60.1 (40.6 user) | **25.4** | 46.0 / 46.2-46.6 |

- User time alone 27.5-28.4 s, max RSS 3.1-4.1 GB. Beside 4 jobs 35.3-36.4 s user at load 4 to 11. Beside 12 jobs the load rose from 14 to 33.
- **Deterministic:** one output hash per case across all 18 finished runs, exit 1 every time. `difftest` of the three (`--jobs 1`) gives
  `MATCH` for all three.
- **Root's claim:** "25.2-25.5 s on the solo retry at load 11-31 (42% of 60 s)" matches `retryTimes`. "No longer at risk" is sound
  against the light work that usually runs beside a gate. It is not sound against a default-jobs sample during the retries (N1).
- The remaining risks, in order: (1) a 12-job workload overlapping `mir`'s retries (3 of 3 timeouts here); (2) a next-solver slowdown
  of roughly 2x (a 25% slowdown, the worry in w40d, now leaves them at about 31 s); (3) battery (the gate refuses to start on it, but
  only samples power every 60 s). The freeze is no longer a risk: `KNOWN_NEAR_LIMIT` keeps them out of the frozen sample whatever the run
  directories hold.

### Every retried protected case

`retryTimes` holds 7 cases (`mir` 3, `run-pass-miri` 4), the same 7 as wave 40d. All matched alone. `hkl_forbidden.rs` again did not
time out in the pool. `SUBJECT_TIMEOUT_RETRY_CAP` is 50, far above the 3 and 4 needed.

| Suite (limit 60 s) | Case | This gate, alone | w40d gate | w40c gate | Pool user s | `load1` pool / start / end |
|---|---|---|---|---|---|---|
| `mir` | `error-tainting-issue-122904.rs` | **25.2 (42%)** | 48.3 | TIMEOUT | 39.4 | 27.4 / 31.0 / 21.1 |
| `mir` | `recursive-drop-elaboration-2.rs` | **25.5 (42.5%)** | 45.7 | TIMEOUT | 41.1 | 27.2 / 21.1 / 15.0 |
| `mir` | `recursive-drop-elaboration.rs` | **25.4 (42.3%)** | 46.0 | TIMEOUT | 40.6 | 27.2 / 15.0 / 10.8 |
| `run-pass-miri` | `drop/dynamic-drop.rs` | 36.3 (60.5%) | 36.6 | 37.1 | 36.0 | 53.1 / 39.0 / 24.1 |
| `run-pass-miri` | `threads-sendsync/issue-8827.rs` | 35.2 (58.7%) | 35.0 | 35.8 | 34.4 | 61.3 / 17.9 / 11.7 |
| `run-pass-miri` | `moves/move-3-unique.rs` | 24.8 (41.3%) | 24.8 | 25.3 | 32.4 | 45.3 / 24.1 / 17.9 |
| `run-pass-miri` | `array-slice-vec/repeated-vector-syntax.rs` | 18.6 (31%) | 18.6 | 18.9 | 33.8 | 50.2 / 52.0 / 39.0 |

The `run-pass-miri` four are stable within 0.5 s over three gates. The w40c audit measured `dynamic-drop.rs` and `issue-8827.rs` at 34.9 and
35.2 s alone; I did not re-run them.

### The new load data

It is present on all 7 rows, with the keys `pool`, `aloneStart` and `aloneEnd`, two decimals each. It is also sensible:
- `pool` (27.2-27.4 in `mir`, 45-61 in `run-pass-miri`) agrees with the host samples during those pools: 24-33 during `mir`.
- The alone values fall like a 1-minute average with nothing else running. In `run-pass-miri`, 52.0 decays over the 18.6 s retry by
  e^(-18.6/60) to 38.1, and 39.0 was recorded. Over the next 36.3 s, 39.0 decays to 21.3, and 24.1 was recorded (the case's own load is
  about 1.5). The `mir` chain fits the same way (31.0, 21.1, 15.0, 10.8).

So **both suites' retries ran with no outside load**, and a later loss could be read off these fields directly, as w40d N1 asked.
`aloneStart` of a suite's first retry can exceed `pool`, because the average lags the pool's tail. That is expected.

Heavy suites, for comparison: `task-comm-6.rs` took 147.0 s of 1,800 (151.1 before), `consistency_sc.rs` 38.2 s (39.1). The same two
`run-pass-miri-heavy` cases reach 1,800 s, both unprotected. `check-core` max RSS 8,924 MB (9,034 before), `rmeta-core` 9,057 MB (8,796)
of 12,288. Suites took 10.77 h in all, against 11.09 h. Each suite ran at 0.85-1.17x its last time (`mir` 0.95x, `mono-ui` 1.02x).

## 4. Power and host: AC throughout

| Check | Result |
|---|---|
| `host.allowBattery`, `host.powerLost` | false, `[]` |
| Samples | 173, all `AC Power` at 100%, none without a power or load reading; 19:48:03Z to 06:42:47Z; largest gap 660 s (the 10-minute keep interval) |
| `hostStart`, `hostEnd` | AC at both marks of all 60 suites |
| `pmset -g log` (independent) | `Using AC (Charge: 100)` throughout, 21:40 Nov 8 to 08:47 Nov 9 local (+0200); no sleep, wake or shutdown entry. The last battery entry is Nov 7 00:46. Up 5 days, no reboot. |
| Load | 1-minute load from 1.1 to 69.1. The peak was at 20:49Z, in the early suites; 24-33 during `mir`'s pool. Swap 1.48-1.49 GB throughout. |
| `note:` lines | 3, all expected: `mir` 3 timeouts, all 3 finished alone; `miri-pass` 1 `UNSTABLE` (`panic1.rs`, as before); `run-pass-miri` 4 timeouts, all 4 finished alone. No stuck host reader, power, RSS-budget or slow-test note. No frozen-lists note: the gate does not print a passing step's notes (N3), and my recomputation shows the step had none. |

## 5. Static steps: the whole phase took 8 min 19 s, against 8 min 35 s

Times come from the junit reports' own totals and from file mtimes (UTC).

| Step | Ends | Time | Result |
|---|---|---|---|
| oracle and probe checks, typecheck | about 19:48:10 | about 7 s | ok |
| unit tests, 4 workers | 19:53:46 | **335.5 s** (18.6% of 1,800 s) | ok: 7,385 tests, 0 failures, 1 skipped (allowlisted: `read_binary_file_handles_lying_stat`); slowest 8.9 s |
| unit tests (alone) | 19:55:14 | **87.8 s** (4.9%) | ok: 39 tests in the 4 files, 0 skipped; slowest 18.3 s (`miri/contract.test.ts`) of the 60 s per-test limit |
| runner unit tests | 19:56:09 | 55.6 s | ok: 417 tests, 0 failures, 0 skipped; slowest 10.1 s |
| markers, marker order, info sites | 19:56:11 | about 2 s | ok |
| frozen lists | 19:56:22 | 11 s | ok, 48 / 48, the expected sample (N3) |

**The unit step took 423.3 s in all (335.5 + 87.8), against 439.5 s in wave 40d.** All ran on `7a4f6fad`: `gate.json`'s `head`, a clean
`dirty`, and HEAD unmoved during the gate (item 1). Coverage of the reports: 628 `*.test.ts` files under `src` and `tools` at `7a4f6fad`,
623 + 4 in the two reports with no overlap. The one file in neither is `rustc_data_structures/graph/tests.test.ts`, which has no `test(`
in it, as before. `scripts` and `harness`: 41 files in the tree, the same 41 in the runner report.

## 6. Root's numbers

| Figure | Claimed | Recomputed | |
|---|---|---|---|
| Protected total (README, commit message, `current.json`) | 542,092 | 542,092 | ok |
| Suites | 60 | 60 | ok |
| Gain | 0 gained, 0 lost | 0 / 0 | ok |
| Coverage (README, `current.json`) | 24,290 / 27,053 (89.8%) | `coverage.ts`: 24,290 / 27,053, 89.79% | ok |
| Miri | 1,506 / 1,535 | 1,506 / 1,535 (98.1%) | ok |
| README rows | `mir` 21,525, run-pass 3,474 of 3,478, miri-pass 350 of 360, `mir-o2`/`mono-ui` 3,475, `check-rg*` 36, ... | equal to the baselines (run-pass = `run-pass-miri` 3,468 + heavy 6, of 3,470 + 8; miri-pass = 345 + 5, of 352 + 8) | ok |

Aside: the w40d audit's table gave `current.json`'s coverage at `4ed419a1` as 24,290. The file then said 24,289, and README said
24,279. Both now say 24,290, as `coverage.ts` does.

`scripts/criteria.ts --run gate-20261108-194803-root-0xx0`:

| Group | Result | Threshold |
|---|---|---|
| M6b run-pass | 3,474 / 3,478 = 99.88%, met | 90% |
| M6b run-fail | 294 / 294 = 100%, met | 90% |
| M6b miri-pass | 350 / 360 = 97.22%, met | 80% |
| M7a ir-hello | not met: "ir-hello: not in this gate" | 100% |
| M7a mir-o2 | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a mono-ui | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a check-rg | 34 of 34 crates, met | 33 |

The same as wave 40d.

## What I did not check

- **Protected cases other than the three TAIT ones** were not re-run. Their status comes from the gate's jsonl, compared row by row with
  the last gate.
- **The four retried `run-pass-miri` cases** were not re-run; I compared the gate's times with the last two gates and audits.
- **The TAIT cases beside a 12-job sample** ran once each, not three times: all three timed out on the first round, which settles the question.
- **Port correctness** of perf-tait, fixers-48 and harness-w45: that belongs to their reviews and root-w44-check. I read the harness,
  script and test diffs, and the `frozen-lists.ts`, `difftest.ts` (`load1`), `gate.ts` (`runStaticStep`) and `mono-run.ts` changes.
- **Typecheck and the unit steps** were not re-run; I rely on the gate's log and junit reports.
- **The `miri-sysroot-*` suites** were not run (N4).
- **What caused the outside load early in the gate** (69 at 20:49Z). `gate.json` records load, not processes. By `retryTimes` it had
  stopped well before the retries.
- **Side effects in `$RUST_TS_DATA`.** These are report files only, and nothing compared reads them. No oracle cache entry was written:
  no file under `oracle-cache` is newer than the start of this audit.
  - four run directories: `w40e-audit-j4` (`mir --sample 3000 --jobs 4`, stopped once the timings were done), `w40e-audit-j12`
    (`--jobs 12`, stopped likewise), `w40e-audit-tait-recursive-drop-elaboration` and `w40e-audit-tait-error-tainting-issue-122904`;
  - the key dump called every suite's `cases()`, which touches cached aux directories' mtimes;
  - `coverage.ts` rewrote `coverage.json`.
