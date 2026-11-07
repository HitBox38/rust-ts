PASS WITH NOTES

**Wave 40b's accept stands.** Nothing protected was lost, tampered with or hidden, and `run-pass-aux-miri` is ready to be protected:
all 355 cases are raw-identical on a fresh oracle run and on a serial subject run, none needs a mask or a retry, and the slowest uses
5% of its limit. All four notes are low severity: one stale README figure, and three things the figures leave out. None of them
reverses the verdict.

Regression audit, 2026-11-07. Gate `gate-20261106-224720-root-i68w`, tested `f1d3aae7`, accepted `045b7318`; the previous accept is
`d51089a3` (wave 40a). No gate or full suite was run through difftest. What did run: a dump of every case's oracle key at both commits
(371,898 and 371,901 keys); `run-pass-aux-miri`'s 355 protected cases, subject alone, one at a time; the same 355's oracle (the isolated
Miri), one at a time; 8 cases' aux builds rebuilt into scratch; the 6 callconv fixtures regenerated into scratch; `coverage.ts` and
`criteria.ts --run`. All of it ran on AC, at a load of 1.1 to 3.8. Code was only read. Everything written went to the scratchpad (see
"What I did not check" for one side effect).

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | low | README's milestone row still says proc macros "match rustc on 279/282 ui cases". `pm-ui` is 281 / 282 (gate log; `pm-ui.txt` 281 lines). The line is from `ccf5dc4a` (2026-11-02); w40a-audit N1 fixed the table row below it but not this line. Every other README figure agrees. | `README.md:11`; item 7 |
| N2 | low | 32 of the 355 protect a failing run, not a passing program: 27 exit 1 with a Miri error (21 `unsupported operation`, 2 "can only run programs that have a main function", 1 UB, 1 memory leak, 2 `aborting due to N previous errors`) and 5 exit 101 with a program panic. They are byte-identical and still guard the port: 16 of the 32 are the EII cases, the decoder guard the fixers-44 decision names, and all 16 end in Miri's `unsupported operation` after decoding the aux crate. But "355 of 356" is not "355 programs run to exit 0", and README's new row does not say so. The EII errors print v0-mangled symbols holding the aux crate's `StableCrateId`, which depends on crate name, `-C metadata` and the toolchain, not on paths; a rebuild gives the same bytes (item 3). | item 3 |
| N3 | low | `run-pass-aux-miri`'s aux rlibs live in `$RUST_TS_DATA/aux/ui/<key>`, pruned after 3 days unused (`pruneStaleUiAux`). After a prune, the next run rebuilds them with the isolated Miri inside `cases()`. A rebuild is byte-identical (8 cases, 11 rlibs), so it cannot cause a false loss. But a rebuild that times out twice (300 s, then the retry factor) or fails stops the whole suite with `ERROR:` (`buildAux` → `auxBuildError`). That would fail a gate, not drop a case silently. Worth knowing before a gate on a loaded host after a long gap. | `harness/compiletest.ts:1199-1258`; `harness/library.ts:327` |
| N4 | low | The unit step took 1,225.6 s of its 1,800 s limit (68%), up from 1,196.9 s (66%) last gate, with 7,373 tests against 7,348. The margin keeps shrinking (m6-audit F8). | `unit-tests.junit.xml` of both gates |

## 1. Protected set: nothing lost, all totals agree

Each figure is recomputed from `git show` of each baseline at three commits and from each suite's raw jsonl.

| Check | Result |
|---|---|
| `git diff --numstat d51089a3 045b7318 -- harness/baseline` | 1 file: `run-pass-aux-miri.txt` **+355, -0** |
| Baseline files | 59 at `d51089a3` and `f1d3aae7`, 60 at `045b7318`; only `run-pass-aux-miri` added, none removed |
| Baselines between `d51089a3` and `f1d3aae7` | identical in all 59: nothing touched them before the gate |
| Unique ids | 541,731 to **542,086**; no duplicates in any file |
| `gate.json` `baseline` against the file at `f1d3aae7` | equal in all 60 (0 for the new suite); `lost` and `lostSkipped` empty in all 60 |
| Added ids against `gate.json` `gained` | identical: 355 in `run-pass-aux-miri`, 0 elsewhere |
| Every id at `045b7318` against the raw `<suite>.jsonl` | **542,086 of 542,086 `MATCH`**; none missing |
| `MATCH` rows not in the baseline | 0 |
| jsonl rows against `gate.json` `total`, `match` | equal in all 60 |
| `history.jsonl:643` (accept) `data.suites` | 60 suites, sum 542,086; `protected` and `total` equal `gate.json` in all 60; `runId` and `head` = the run's |
| `docs/state/current.json` protected sum | 542,086 |
| `045b7318`'s parent and contents | parent `f1d3aae7`; `run-pass-aux-miri.txt`, `current.json`, `history.jsonl`, nothing else |
| `dirty`, `unstableOk`, `upstreamOk`, `staticOk`, `skipStatic`, `pass` | `[]`, true, true, true, false, true; 0 `ERROR` lines in `tmp/gate-w41.log` |
| Suites run against the baseline list | **60 of 60, both ways**: the 59 old ones and `run-pass-aux-miri`; no `notRun`. `--suites` replaces the default (which reads baselines, 59 at `f1d3aae7`), so it had to name the new suite, and it did. |

`gate.json` does not record the gate's argv, so the `--suites` list itself is known only through the suites that ran. They are exactly
the 60 baselines, which is what matters.

## 2. Expectation tampering: none

`git diff d51089a3 f1d3aae7` changes no baseline, `harness/corpus` file of an existing suite, `UPSTREAM.json` or `tools/probes`. In
`harness/` and `scripts/` it touches 19 files (7 commits: harness-w42, miri-sysroot, the fixers-43 F1 host fix). Each named item:

| Item | Finding |
|---|---|
| `scripts/difftest.ts`: an IR suite's sides in turn | The sequential branch is taken only when `s.irTier` is set, i.e. IR suites (`irSuite`). The only one is `ir-hello`, not in the gate. Every other suite keeps `Promise.all`. The other changes are `--ir-tier` (a report under `<suite>@<tier>`, never registered, so no gate or baseline takes the name) and `irTier` in the summary. Status, comparison and baseline logic are unchanged. |
| `ir-hello`'s key | Now `hash(irToolsKey, tier)`. Its 2 keys changed (below). Not protected, not in the gate. |
| `harness/scope.json`: `ar_archive_writer` `=0.5.3` | Upstream's `Cargo.lock` has `ar_archive_writer` 0.5.3. Only `scripts/coverage.ts` reads `scope.json`, so the entry widens the vendor coverage count and touches no suite. |
| `scripts/miri.test.ts`: expected suite list | Extended by the 3 `miri-sysroot-*` names only; the 9 old names keep their order. It also adds 2 tests (the `.env` host test, and no rustc under the isolated home). No assertion removed. |
| callconv `sizes.*.txt` fixtures | New in this range (`901e335e`, `48454843`). **I regenerated all 6 fixtures (`abi.rs` ×2, `sizes.rs` ×4) with the pinned rustc into scratch, with `regen.ts`'s exact argv and environment: 6 of 6 byte-identical** to the committed files. `aarch64.oracle.test.ts` compares all 6 and keeps the test that tells Darwin from AAPCS. |
| `scripts/lib/miri.ts`: `RUST_TS_HOST_TUPLE` first | `verifyOracleToolchain` (`scripts/lib/oracle.ts:34`) already refuses a `RUST_TS_HOST_TUPLE` that is not the oracle's host, so the value equals `oracleHost()` on any run that gets past it. The Miri keys did not change (below). |
| `miri-sysroot-*` suites | Registered, no baseline file, not in the gate (item 6). Their wrapper writes only to `$RUST_TS_DATA/rmeta/miri-sysroot/<crate>/<side>` (`miri-sysroot-run.ts:76`), never to `$RUST_TS_DATA/miri-sysroot`, which the protected Miri suites read. |
| `scripts/gate.ts`, `host-state.ts` | `irTier` is recorded and printed; `StuckReads` is report-only; `oracleRuns` learns the new wrapper. `lost`, `gained`, `lostSkipped`, the accept's checks and the baseline write are unchanged, apart from `acceptEntry` adding `irTier` when set. |

**Oracle keys.** I dumped every registered suite's case keys (`caseOracleCacheKey`) from `git archive` trees of `d51089a3` and
`f1d3aae7`, at one path. Keys are path-independent: a dump from this worktree equals the scratch dump for all 371,901.

| Suite | Keys changed | Oracle re-run? |
|---|---|---|
| `ir-hello` | 2 of 2 (tier in the key) | not in this gate; not protected |
| `miri-sysroot-core`, `-alloc`, `-std` | new, 1 each | not in this gate |
| every other suite, all 60 gated ones included | **0** | No re-run was needed, and none happened: every gated case's cache entry was written before the gate started (22:47:20 UTC) |

The one gated case with no cache entry is `miri-pass`'s `tests/panic/panic1.rs`, `UNSTABLE` and never cached or protected, as before.

**Removed test lines** (24 test files changed, 36 lines removed). None weakens a check:
- `expr_a`, `matches_b`, `late_a`, `late_b`: wrapped in `plain_bug(...)`, same messages (root-w40-check3 N1, queued last wave).
- `rustc_feature/lib.test.ts`: the `Err` payload's shape, same expectation.
- `jobserver.oracle.test.ts`: the old test pinned an `unported` stop on a non-UTF-8 value. Two tests replace it and compare the port with the oracle on `\xff` and on a real U+FFFD.
- `aarch64.oracle.test.ts`: `TARGETS` → `CASES`, now 6 fixtures instead of 2.
- `fulfill_stalled`: a comment.

The unit-test skip allowlist is untouched. Its one entry, the Linux-only `read_binary_file_handles_lying_stat`, is the one test that skipped.

## 3. The +355: ready to protect

| Check | Result |
|---|---|
| Gate statuses | 355 `MATCH`, 1 `UNPORTED` (`tests/ui/rustc-env/rust-log.rs`, at `RUSTC_LOG`); `retried`, `retryTimes`, `unstable`, `oracleTimeouts`, batch-only counts all empty; 65 skipped, listed with reasons (proc-macro aux, `aux-bin`, native static libraries) |
| Earlier runs | `root-w41-check-za4e`, `-4ys1`, `-ifj4` and the gate: **the same 355 ids `MATCH` in all four**, none extra |
| Masks | **0 of 355** oracle entries change under `maskedTexts` (thread id, long-type hash). No case matches through a mask, so README's "24 of them through a mask" stays right. |
| Oracle stability | **Re-ran the isolated Miri oracle fresh on all 355, one at a time: 355 of 355 raw-identical** to the cached entry; slowest 0.23 s (`backtrace/dylib-dep.rs`). |
| Subject, alone | **Ran all 355 subjects one at a time: 355 of 355 raw-identical** to the oracle, 0 timeouts. Median 1.0 s. |
| Aux rebuild | Rebuilt the aux crates of 8 cases into scratch with the same isolated Miri command and environment (`call_default.rs` ×2, `cross_crate_def.rs` ×2, `xcrate-use2.rs` (3 crates), `const-argument-cross-crate.rs` ×2, `rangefrom-overflow-2crates.rs` (2 crates)): **11 rlibs, all byte-identical** to the cached ones, from a different output directory. |

**Closest to the 60 s limit** (alone, wall; user time in brackets):

| Case | Wall | % of 60 s |
|---|---|---|
| `backtrace/dylib-dep.rs` | 3.2 s (6.8 s) | 5.4% |
| `backtrace/line-tables-only.rs` | 3.1 s (6.6 s) | 5.1% |
| `structs-enums/classes-cross-crate.rs` | 2.9 s (6.2 s) | 4.8% |
| `async-await/async-fn-size.rs` | 2.9 s (6.3 s) | 4.8% |
| `async-await/drop-order/drop-order-when-cancelled.rs#default` | 2.7 s (6.4 s) | 4.5% |

The gate ran the suite in 121 s.

**Could a later gate lose one for a reason other than a real regression?** What I looked for, and found nothing:
- **Build state.** The aux directory is keyed by the oracle build, the case id, each step's command, environment, source hash and dependencies, and `miriOracleKey()`. The case's argv names that directory, so the oracle key follows any aux change. Rebuilds are byte-identical (above). A failed rebuild stops the run loudly (N3).
- **Host state.** `MIRI_CASE_ENV` pins the environment. The 5 thread lines print Miri's `gettid`, a constant under isolation, and stay compared.
- **Time.** Margins are wide.
- **Oracle.** It is reproducible.

N2 and N3 are the only caveats.

## 4. Retries and margins

`retryTimes` has all 8 retried cases. As last gate, the pool attempt hit 60 s wall at 33-41 s user time, which is contention (load up to
45). The re-runs alone:

| Suite (limit) | Case | Protected | Alone, wall | % of limit | Last audit |
|---|---|---|---|---|---|
| `run-pass-miri` (60 s) | `drop/dynamic-drop.rs` | yes | 36.8 s | **61%** | 62% |
| `run-pass-miri` (60 s) | `threads-sendsync/issue-8827.rs` | yes | 36.0 s | **60%** | 60% |
| `run-pass-miri` (60 s) | `moves/move-3-unique.rs` | yes | 25.3 s | 42% | 42% |
| `mir` (60 s) | `type-alias-impl-trait/hkl_forbidden.rs` | yes | 20.1 s | 34% | 34% |
| `run-pass-miri` (60 s) | `array-slice-vec/repeated-vector-syntax.rs` | yes | 19.0 s | 32% | 32% |
| `mir` (60 s) | `error-tainting-issue-122904.rs`, `recursive-drop-elaboration.rs`, `-2.rs` | no (not in `mir.txt`) | 60 s, timed out | over | same |

Unchanged from last audit to within a second. Retries: `mir` 4, `run-pass-miri` 4, as last gate.

**Heavy suites.** The highest protected heavy case is `task-comm-6.rs` at 151.9 of 1,800 s (8.4%); `miri-pass-heavy`'s highest is
`consistency_sc.rs` at 39.5 s. The two `run-pass-miri-heavy` cases that hit 1,800 s are unprotected, as last gate. `heavyErrors` are empty.
The highest RSS is `check-core` at 10,721 MB of 12,288. Every suite's duration is 0.7-1.4x the last gate's; the whole run took 11.56 h
against 11.64 h.

## 5. Power and host: AC throughout

| Check | Result |
|---|---|
| `host.allowBattery`, `host.powerLost` | false, 0 |
| Samples | 177, all `AC Power`, none without a reading; charge 78-100%; largest gap 660 s (kept every 600 s, polled every 60 s) |
| `hostStart`, `hostEnd` | AC at both marks of all 60 suites; suites in order, no overlap |
| `pmset -g log` (independent) | Battery until **22:46:28 UTC**, AC from then on, **52 s before the gate's first sample**. No `Using Batt` in 22:47-10:22 UTC. No sleep or wake entry in the window, and no reboot since 2026-11-04. |
| Notes, stuck readers (`F2`) | The log has no `note: host reader ... is stuck` line and no power line. `gate.json`'s samples have no `null` reading. |

## 6. Unrun and report-only suites, and the static steps

| Suite | Cases | Baseline file now or ever |
|---|---|---|
| `parse-ui-json` | 991 | no |
| `miri-fail` | 610 | no |
| `miri-pass-tb` | 132 | no |
| `ir-hello` | 2 | no |
| `mir-heavy`, `check-core-bin`, `check-chain` | 1 each | no |
| `miri-sysroot-core`, `-alloc`, `-std` | 1 each | no |

That is exactly the 10 suites root's scope decision names (`history.jsonl`, 2026-11-06T22:31). **Nothing protected-looking hides there:**
the gate protects by baseline file, and `git log --all --diff-filter=D -- 'harness/baseline/*'` finds none ever removed.

**Static steps, all on `f1d3aae7`** (`head`, `dirty: []`, `staticOk`, `skipStatic` false), before the first suite at 23:08:27 UTC:

| Step | Result |
|---|---|
| typecheck | ok (log) |
| unit tests | ok: 7,373 tests, 0 failures, 1 skipped (allowlisted); **1,225.6 s of 1,800 s (68%)** by junit (N4) |
| runner unit tests | ok: 378 tests, 0 failures, 0 skipped; 33.2 s |
| skips | 1 allowed, 0 unexpected, under `RUST_TS_REQUIRE_PROBES=1` |
| markers | ok (log) |

## 7. Root's numbers

| Figure | Claimed | Recomputed | |
|---|---|---|---|
| Protected total | 542,086 | 542,086 | ok |
| Suites | 60 | 60 | ok |
| Gain | +355, 0 lost | +355, 0 lost | ok |
| Coverage | 24,269 / 27,053 (89.7%) | `coverage.ts`: 24,269 / 27,053, 89.71% | ok |
| Miri | 1,506 / 1,535 | 1,506 / 1,535 (98.1%) | ok |
| `run-pass-aux-miri` row | 355 of 356 | 355 / 356 | ok (see N2 on what a match is) |
| Masked cases | 24 | 24 (the 355 add none) | ok |
| `pm-ui` / `pm-expanded` (table) | 281 / 281 | 281 / 281 | ok |
| **Proc macros (milestone row)** | **279/282** | **281/282** | **N1** |
| Wave date in `docs/next.md` | 2026-11-07 | 2026-11-07 (accept 10:21 UTC) | ok |

`scripts/criteria.ts --run gate-20261106-224720-root-i68w`:

| Group | `criteria.ts` | Threshold |
|---|---|---|
| M6b run-pass | 3,473 / 3,478 = 99.86%, met | 90% |
| M6b run-fail | 294 / 294 = 100%, met | 90% |
| M6b miri-pass | 350 / 360 = 97.22%, met | 80% |

These match README's `3,473 of 3,478`, `294 of 294` and `350 of 360`. `run-pass-aux-miri` is in no `criteria.ts` group.

## What I did not check

- **Protected cases outside the +355** were not re-run. Their status is the gate's jsonl, and their oracle entries are as cached (none re-keyed).
- **Margins of cases that never timed out** in other suites. A non-heavy case records a time only if retried.
- **The other aux builds.** Only 8 of the cases with aux crates were rebuilt.
- **Port correctness of the wave's code.** That belongs to the lanes' reviews (harness-w42, miri-sysroot, fixers-43/44). I read only the harness and script diff and the test diffs named above.
- **Typecheck and markers** were not re-run; I rely on the gate's log.
- **The report-only suites' current results.** They did not run in this gate, and I did not run them.
- **The gate's argv.** It is not recorded; I checked the suites that ran.
- **A side effect of my key dump.** Calling each suite's `cases()` touches the mtime of cached aux directories (`touchAuxDir`), as any difftest does. No aux build happened: every aux key was unchanged, and the 8 rebuilds wrote only to scratch.
