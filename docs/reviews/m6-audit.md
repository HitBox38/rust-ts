PASS WITH NOTES

**M6 is done by the plan's definition: yes.** `docs/plan-m6.md:196-198` with A9 and A12 is met, and every figure below was
recomputed from the raw jsonl of `gate-20261104-143144-root-lpo8`, without `scripts/criteria.ts`. Nothing was lost,
nothing was tampered with, and no exclusion moves a figure across its threshold given the results we have.

The notes are about what the figures leave out and what the next gate may trip on. None of them reverses the verdict.

Regression audit, 2026-11-05. Read-only: no gate, no full suite, no port or oracle process run. Tested commit `bc16a254`,
accept commit `db323c3b`.

## Findings

| # | severity | finding | evidence |
|---|---|---|---|
| F1 | medium | Seven protected cases matched only through the serial re-run. Two of them were first protected by this accept and have little margin against a 60 s limit that the re-run keeps. A timeout alone is a protected loss and so a STOP. | below |
| F2 | medium | 52 run-pass programs with proc-macro aux crates run in no suite. Their skip reason still says "deferred to M6", and M6 is now declared done. | `harness/compiletest.ts:982` |
| F3 | low | The README's "Real programs run: 3,473 of 3,478" is the right number under a stronger headline: 199 of the 3,473 are programs real Miri itself refuses or fails, and 420 run-pass tests with aux crates are outside it. | `README.md:11` |
| F4 | low | Open results from root's post-accept report runs are not recorded or queued: a CRASH on a valid program, and 16 stops at `EiiMapEncodedKeyValue`. | below |
| F5 | low | Plan items that are not done, none of them in the gate: `miri-sysroot-*`, D11's p99, D8's cross-thread path. | below |
| F6 | low | The state record still says M6 is in progress. | `docs/state/history.jsonl`, last `milestone` entry 2026-11-04T14:23 |
| F7 | low | Doc nits: `rustc_middle (91%)` is 92.1%; plan D9's "23+" Tree Borrows tests are 73 files, 132 cases. | `README.md:20`, `docs/plan-m6.md:254` |
| F8 | low | `RSS` and the unit step are near their limits. Neither can lose a case, but one can fail a gate early. | `.data/tmp/gate-w38.log:74`, `:62` |

### F1. Matched only via a retry (the next gate's flakes)

`gate.json` `retried`, each case's status in the jsonl, membership in the baseline at `db323c3b`. The re-run is alone, one
try, at the suite's own limit (`scripts/difftest.ts:82-85,:102`).

| suite (limit) | case | this run | protected | history |
|---|---|---|---|---|
| run-pass-miri (60 s) | `tests/ui/drop/dynamic-drop.rs` | MATCH, retried | yes, new in this accept | 53-57 s wall in `docs/handoff/miri-perf.md:20,:39` |
| run-pass-miri (60 s) | `tests/ui/threads-sendsync/issue-8827.rs` | MATCH, retried | yes, new | 52 s wall, `miri-perf.md:21` |
| run-pass-miri (60 s) | `tests/ui/moves/move-3-unique.rs` | MATCH, retried | yes, since wave 37 | retried in both Miri gates; 28-30 s quiet, 39 s in a batch, over 60 s in this pool |
| mir (60 s) | `tests/ui/try-trait/deep-try-chain-issue-153583.rs` | MATCH, retried | yes | retried in each of the last 4 gates |
| mir (60 s) | `tests/ui/type-alias-impl-trait/hkl_forbidden.rs` | MATCH, retried | yes | same |
| mir (60 s) | `tests/ui/type-alias-impl-trait/param_mismatch2.rs` | MATCH, retried | yes | same |
| mir (60 s) | `tests/ui/type-alias-impl-trait/self-referential-4.rs` | MATCH, retried | yes | same |

`docs/handoff/miri-perf.md:39-41` warned about `dynamic-drop.rs` and `issue-8827.rs` and noted "neither is protected yet".
They are now, and A12 rightly forbids moving them to a heavy list because of how the port does, so only speed work buys
margin.

Next closest by earlier measurement, not retried this gate: `test-attrs/terse.rs` (44.5 s wall, `miri-perf.md:19`).

The gate records no per-case time outside heavy suites, so this list comes from retries and the perf handoff, not from
this run's timing. Recommended, as its own harness batch: record the retry's wall time in `gate.json`.

Also retried but unprotected, TIMEOUT twice: `closures/supertrait-hint-cycle.rs`, `error-tainting-issue-122904.rs`,
`recursive-drop-elaboration.rs`, `recursive-drop-elaboration-2.rs` (`mir`). Not a loss.

### F2. Run-pass programs with proc-macro aux crates

`run-pass-aux-miri` skips 65 cases: 52 proc-macro aux, 6 native library, 6 aux binary, 1 compiletest config. The 52 are
compared at compile level in `pm-ui`, but their execution is compared nowhere. The plan permits this: the suite is
report-only and defined as "non-proc-macro aux" (`docs/plan-m6.md:187`). Plan §4 item 3 (`:174-176`) does describe
proc-macro aux crates as part of the run-mode aux chain, though, and `PLAN.md:59` says "run-pass tests; proc macros".

Fix: record a decision on where they go, and correct the string at `harness/compiletest.ts:982`, which now misstates the
plan.

### F3. The README's headline

`README.md:11` and `:38`. D6 makes every oracle outcome a case, so the figure is legitimate. Oracle exit codes read from
the oracle cache for all 3,478 cases:

| oracle exit | MATCH | not MATCH |
|---|---|---|
| 0 | 3,274 | 5 (3 UNPORTED, 2 TIMEOUT) |
| 1 | 172 (`open`, `readlink`, FFI, inline asm, intrinsic fallback, no `main`) | 0 |
| 101 | 27 | 0 |

Counting only programs the oracle runs to exit 0 gives 3,274/3,279 = 99.85%, so the ratio is robust. Only the words
overstate. Suggested: "match the real Miri's result, including its refusals".

I looked for matches that come from a harness mistake (both sides failing on the same bad argv). I found none in the error
buckets of `run-pass-miri`, `run-fail-miri` or `miri-pass`. `miri-pass` is 326 exit 0 and 11 exit 101, all in `tests/panic`.

### F4. Unrecorded report results

Root's own runs after the accept, not gate runs: `20261105-013243-root-i6a7`, `-013348-root-1dzj`, `-013714-root-sebl`.
Root said it would record them. It had not when this audit read the state.

| suite | result | open items |
|---|---|---|
| `miri-pass-tb` | 130/132, 0 DIFF | 2 `mio::Poll::new` |
| `miri-fail` | 598/610, **1 DIFF** | `uninit_alloc_diagnostic_with_provenance.rs`, already queued (`docs/next.md:448`); 7 at `rustc_errors::codes::DIAGNOSTICS` text; 4 mio |
| `run-pass-aux-miri` | 338/356, **1 CRASH** | below; 16 UNPORTED at `Decodable for EiiMapEncodedKeyValue`, not in `docs/next.md` |

The CRASH: `tests/ui/compiletest-self-test/rustc-env.rs` exits 0 on the oracle. On the port, `option_env!("PWD")` at
`:16` returns `Some(<upstream checkout>)` despite `//@ unset-rustc-env:PWD`. That is a wrong answer, not an `unported` stop.
I did not diagnose it. Possibly the Bun process restores `PWD`, which would also affect any other `env!`/`option_env!` of
`PWD` in the port.

### F5. Promised by the plan, not done (none is in the gate)

- `miri-sysroot` and `harness-m6d`, under wave 38's "(→ gate M6)" heading (`docs/plan-m6.md:317-323`, A2), are still
  queued (`docs/next.md:445`). No `miri-sysroot-*` suite exists, although §4 lists it as a report. next.md relabels the
  lanes "M7 groundwork" without a recorded decision.
- D11 run-pass p99 ≤ 10 s: 11.1 s (`docs/next.md:432`), and it is not waived. D11's "all cases within the 60 s timeout" did
  not hold in this pool (F1).
- D8 "port all of library/proc_macro": the cross-thread path is `unported` (`src/proc_macro/bridge/server.ts:551`), which is
  the one UNPORTED in `pm-ui` and `pm-expanded` (`expand-expr.rs`). `coverage.ts` shows `library/proc_macro` 364/364 because
  markers do not see unported bodies. It is not in `docs/next.md`.
- All 27 `-Zmiri-disable-isolation` cases across the four Miri suites stop at `mio::Poll::new`, so no such program runs.
  (`panic1.rs` is among them; its row is UNSTABLE, its subject stopped there.) This is by D5 and queued
  (`docs/next.md:444`). It accounts for 20 of the 23 `miri-pass` + heavy misses, which stay in the denominator. The one
  protected case with a host flag is `tests/pass/shims/env/var-forward.rs` (`-Zmiri-env-forward=MIRI_ENV_VAR_TEST`, a
  variable the harness sets itself).

The `README.md` "Next: M7" is consistent with this as long as root records that these move to M7.

### F7, F8. Small items

- `README.md:20`: `rustc_middle (91%)` is 3102/3369 = 92.1%. Stale, and in the modest direction.
- `docs/plan-m6.md:254` says 23+ Tree Borrows tests. The real split is 73 files, 132 cases. The plan understated it; see
  section 4 for why that does not flatter the figure.
- RSS: `rmeta-core` 12,207 MB (99.3% of 12,288), `check-core` 12,120 MB (98.6%). Over budget is reported and cannot fail a
  gate (`scripts/gate.ts:8-9`), and root's decision of 2026-11-04T13:56 expects readings over it. No loss risk.
- Unit step: 1,169 s here (junit) against 1,800 s. Root measured 2,005 s with one review alongside, so a gate with anything
  else running fails at this step.

## 1. No lost protected cases: clean

For all 49 baseline files at `bc16a254`, every id is present and MATCH in the run's own jsonl:
**533,608 of 533,608**. 0 missing, 0 other status, 0 duplicate ids in any baseline or result file. Each suite's raw count
equals its `summary.json` and `gate.json`. No baseline suite was left out. The other 3 of the 52 suites are new. No file in
the run directory is newer than `gate.json`.

## 2. No tampering: clean

**Baselines.** `ef00b86a..db323c3b`: +4,105, −0 lines, in two accepts, wave 37 (+3,701) and this one.

| suite | before | after | added | added not MATCH in the run |
|---|---|---|---|---|
| `run-pass-miri` | 3,408 | 3,467 | 59 | 0 |
| `run-fail-miri` | 292 | 294 | 2 | 0 |
| `miri-pass` | new | 333 | 333 | 0 |
| `miri-pass-heavy` | new | 4 | 4 | 0 |
| `run-pass-miri-heavy` | new | 6 | 6 | 0 |

Every MATCH in the run is in the baseline afterwards. In all of git history the only deleted baseline line is a blank line
at `90a231db`, when an empty file first got ids.

**Case lists.** The wave 37 gate tested `ef00b86a` exactly, so its rows are that commit's lists. For all 49 suites, the
ids and the skip lists are identical in both runs: 0 dropped, 0 added, 0 skips moved. The only status changes are
`run-pass-miri` 57 UNPORTED and 2 TIMEOUT to MATCH, `run-fail-miri` 1 UNPORTED and 1 TIMEOUT to MATCH. Nothing left MATCH.
No quiet loss.

**Diffs read with the question "does this make something pass?":** no.

- `harness/suites.ts`: new suites added, plus a comment and a label string. No existing suite's cases, skips or limits
  changed.
- `harness/compiletest.ts`: Miri aux and `uiTestCases` are new paths behind new options. The layout check now also covers
  the Miri sysroot, and an undecided need skips instead of throwing, but the lists above did not change.
- `scripts/difftest.ts`: `unportedBuckets` is reporting only. `withCaseLock` wraps heavy Miri cases only, and the limits
  start after the wait.
- `scripts/lib/case-lock.ts` compares nothing. `scripts/criteria.ts` is report-only, and `scripts/gate.ts` does not read it.
- `scripts/probes.ts`: stamps and a Miri fixture path. Probe keys are untouched.
- **Correction to the audit brief: `scripts/gate.ts` did not change in wave 38.** `git diff ef00b86a bc16a254 --
  scripts/gate.ts` is empty; its last change is `45e09678`, 2026-11-01.
- Also unchanged: `scripts/lib/unstable.ts`, `scripts/lib/miri.ts`, `scripts/lib/oracle.ts`, `harness/corpus`,
  `UPSTREAM.json`, and every existing probe source.
- `harness/scope.json`: removes one Miri exclusion and adds a vendor crate. The denominator grew.

**Oracle outputs.** No existing `*.oracle.txt` changed; all are added. The aux cache poisoning of 2026-11-04 was a real oracle
build under a test's key and an expected-output file was not involved (history 2026-11-04T01:14). The 18 removed `expect` or
test lines are rewrites: load-independent timing, a new crate in a count, new suites in a list. The new `test.skip` guards
cannot hide anything in a gate, since the skip allowlist fails on any new skip.

## 3. Gate validity: clean

| field | value |
|---|---|
| `pass`, `staticOk`, `unstableOk`, `upstreamOk` | all true |
| `skipStatic` | false |
| `dirty` | empty |
| `head` | `bc16a254`, the parent of `db323c3b`, with no commits between |
| unit tests | 7,235, 0 failures, 1 skip: the allowlisted `read_binary_file_handles_lying_stat` (`src/rustc_span/source_map/tests.test.ts:651`, Linux only, `scripts/gate.ts:155-162`) |
| runner tests | 181, 0 failures, 0 skips |
| suites | 52 run, no `notRun` |
| `oracleReruns` | empty everywhere |
| `heavyErrors`, `batchOnly*` | empty, 0 |

`db323c3b` touches only `harness/baseline/`, `docs/state/`, `docs/next.md`, `PLAN.md` and `README.md`.

Log (`.data/tmp/gate-w38.log`): nothing beyond F1 and F8. The two heavy TIMEOUTs (`hashset-connected-border-12860.rs`,
`step_overflowing.rs`) are unprotected and cost 1 h per gate. All heavy oracle entries were cached except
`task-comm-5.rs` and `task-comm-6.rs`, which ran for the first time in this gate because the wave 37 dry run was stopped.

## 4. The M6 claim: met

Recomputed from raw rows. There are no ORACLE_TIMEOUTs in any of these suites.

| criterion (`docs/plan-m6.md:196-198`) | recomputed | target | |
|---|---|---|---|
| M6a `miri-hello` | 1/1, oracle exit 0 | MATCH | met |
| `run-pass-miri` + `-heavy` | 3,467 + 6 of 3,470 + 8 = **3,473/3,478 = 99.86%** | ≥ 90% | met |
| `run-fail-miri` | **294/294 = 100%** | ≥ 90% | met |
| `miri-pass` + `-heavy` | 333 + 4 of 353 + 7 = **337/360 = 93.61%** | ≥ 80% | met |
| `pm-ui` | **279/282 = 98.94%** | ≥ 95% | met |
| `quote!` cases | **325/325**, and 330/330 counting all instances | all | met |

A12's conditions hold: one gate, passed, clean tree, every suite of each group present. `scripts/criteria.ts`, run only
afterwards as a cross-check, prints the same three figures.

### The `quote!` list

**Reconciliation.** The M5 gate has exactly 325 rows with reason `BangProcMacro::expand (quote!; ...)`, and no other
proc-macro or bridge reason. They are 30 distinct files in 11 suites: 6 suites × 30 + 5 `-nocore` suites × 29 = 325. The
missing 5 are `tests/ui/proc-macro/auxiliary/count_compound_ops.rs`, which was already MATCH on the five nocore suites at M5.

**Wave 35's "+29/+30"** at `b8305c67` is exactly this list: the baseline additions equal the list suite by suite. The only
extras are in `mir` (+33): `const_transmute_type_id2.rs`, `offset_from_ub.rs` and `offset_ub.rs`, which have nothing to do
with `quote!`.

**Completeness: the list is complete.** A grep of `tests/ui` for `quote!`, `proc_macro::quote` and `proc_macro_quote` finds
36 files, the 30 plus 6 others. All 6 were MATCH on every suite at the M5 gate, when reaching the `quote!` path was a hard
stop, so none of those runs reached it: 
`derive-attribute-annotation-needed.rs`, `generate-inherent-impl-with-input-spans.rs`, `tuple-index-suffix-proc-macro.rs`,
`custom-quote.rs`, `valid-sugg-issue-137345.rs`, `reserved-prefixes-migration.rs`. All 6 are MATCH today. Aux crates in
`pm-*` run inside oracle-built dylibs and so do not use this path.

No row of any of the 52 suites mentions `BangProcMacro` today. The 30 files also appear in `lex`, `tokens`, `escape` and
`parse`, MATCH, which run before expansion.

### What each exclusion does to a figure

| group | exclusion | figure with it counted | moves the verdict? |
|---|---|---|---|
| run-pass | `mpsc_stress.rs`: oracle does not finish (A9; `harness/suites.ts:1658`) | 3,473/3,479 = 99.83% | no |
| run-pass | also 13 config and LLVM skips, as failures | 3,473/3,492 = 99.46% | no |
| run-pass | 356 aux cases at their actual 338 | 3,811/3,834 = 99.40% | no |
| run-pass | also the 64 aux skips (F2), as failures | 3,811/3,898 = 97.77% | no |
| run-pass | all 420 aux cases as failures (bound only; the real result refutes it) | 3,473/3,898 = 89.10% | would, but it is not the result |
| run-pass | the 4 heavy MATCHes over 60 s wall, had they stayed at 60 s | 3,469/3,478 = 99.74% | no |
| run-fail | 3 aux, 17 config, 3 incremental skips, as failures | 294/317 = 92.74% | no |
| miri-pass | UNSTABLE removed (it is in the denominator as a miss) | 337/358 = 94.13% | no, root's figure is the lower one |
| miri-pass | Tree Borrows in, at the post-accept 130/132 | 467/492 = 94.92% | no, the exclusion **lowers** the figure |
| miri-pass | Tree Borrows in, all failing | 337/492 = 68.50% | would; break-even is 57 of 132 |
| pm-ui | UNSTABLE removed | 279/280 = 99.64% | no, root's figure is the lower one |
| pm-ui | 2 config skips, as failures | 279/284 = 98.24% | no |

Target-based skips (55 run-pass, 9 run-fail, 12 miri-pass) are correct as a target rule and were left out of this table.

**The three cases moved back (`float.rs`, `nested_panic_caught.rs`, `time-with-isolation.rs`):** all MATCH in `miri-pass` under
its 60 s limit, none retried. Effect on the figure: 0.00, since heavy and non-heavy share one group. This is the right
direction: a shorter limit can only make them harder. At ~15 s wall, `float.rs` no longer looks like the 60 s risk of the
earlier reading (`miri-perf.md:26,:36`).

**Is the 27% Tree Borrows split fair? Yes.** 132 of 492 cases = 26.83%, and A5 and `docs/plan-m6.md:199` authorize it. 24 of
the 73 files have no Stacked Borrows case, so they leave M6b altogether, but they pass at the same rate. The split is by a
flag in the argv (`harness/suites.ts:1911`), not by results. Its effect on the figure is against root.

**Heavy lists:** membership is by oracle cost and files written, as A12 requires. `MIRI_HEAVY` dates from `b7692094`
(2026-11-01), before the port's first hello (2026-11-02), so it cannot have been chosen by how the port did. A7 says "4
more", and there are 6, because two became run-pass cases when `needs-*` was evaluated (`harness/suites.ts:1643-1644`).

**File accounting:** no test vanished before reaching a case or a skip. 389 of 389 `tests/pass` and `tests/panic` files,
258 of 258 run-fail files and 269 of 269 `proc-macro:` files are accounted for. 3,768 of 3,796 run-pass files are, and the
other 28 are all under `compiletest-ignore-dir`.

**`PLAN.md` wording:** "std hello world runs" holds. "Run-pass tests" holds for the plan's suites; see F2 for the rest.
"Proc macros" holds through oracle-built dylibs, as D7 and A4 amend it.

## 5. The docs: the numbers are right

Checked against the run and `coverage.ts`: `README.md:11-13,:24-39`, `PLAN.md:59`, `docs/next.md:450-451`.

- 534,012 protected in 52 suites, and +404 = 59 + 2 + 333 + 4 + 6. Correct.
- 24,230/27,053 = 89.6%, Miri 1,504/1,535. Correct.
- All per-suite figures in the README table. Correct.
- The README's "at 100%" crate list. Correct.

Overstatement is limited to F3's wording, and F7 is a stale figure in the modest direction. `docs/next.md:451` says the
audit is running; `README.md` and `PLAN.md` do not, which F6's record should settle.

## Not checked

- **No port or oracle process ran.** Statuses come from the run's jsonl: I recomputed counts and membership, not the byte
  comparisons behind each MATCH. That the jsonl came from this gate rests on provenance in `gate.json` and on file times.
- **Oracle cache contents** were read for exit codes and error buckets on the six gated Miri suites only, not regenerated.
  2 `miri-pass` entries are absent, consistent with the 2 UNSTABLE cases.
- **Case timing** was not measured: root's report suites and lanes held the load at 20-30. `miri-perf` figures are that
  lane's, not mine. The recorded oracle costs in the heavy lists were not re-measured, apart from what the gate itself logged
  for `task-comm-5` (4.5 s user, recorded 5.1) and `task-comm-6` (17.3, recorded 18.5).
- **Harness diffs:** I read `suites.ts`, `difftest.ts`, `criteria.ts`, `case-lock.ts` and `probes.ts` in full, and in
  `compiletest.ts` the changed existing code and the structure and skip logic of `uiTestCases`, not every line of it. I did not read
  `harness/miri-ui.test.ts` or `tools/probes/fixtures.test.ts` in detail. Whether `uiTestCases` matches `ui_test` on argv is
  covered only by the oracle and subject sharing that argv.
- **Heavy and skip reasons:** whether the 13 config and LLVM skips are all justified. They are counted as failures above instead.
- **The report runs' commit:** they are root's own, not gate runs, and I took them as results at `db323c3b`.
- **Port code:** no fidelity review. That is the reviewer's role.
