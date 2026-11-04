# Review: harness-m6c (harness batch; miri-pass, miri-pass-heavy, miri-pass-tb, miri-fail, run-pass-aux-miri)

Reviewer: independent, read-only on code. Branch `t3/add-miri-harness-suites`, head `48448a94` (harness change `a3bb8688`),
compared with its merge base on main, `c9d3c553`. Context: docs/plan-m6.md §4, D9, D11, D13, D14, A5, A7, A8, A9, A11;
docs/handoff/harness-m6c.md; upstream `src/tools/miri/tests/ui.rs` at the pin; ui_test-0.30.7 and comma sources.

## Verdict: REQUEST CHANGES (one small change, R1; one root decision, R2)

The case lists are right, and I would not change them. An independent enumeration agrees with the lane on every case, argv
and skip, and the oracle on that argv reproduces upstream's blessed output for all 1,102 cases. Nothing was selected out
because the port fails it, with one exception that stays in the denominator (R2). The Tree Borrows split is what A5 says
and is applied by flag.

The problem is the number these suites exist to produce. No code computes the M6b figure, while the printed line says
it does (R1). Only R1 and R2 need attention before M6b is read from these suites. After R1, a re-review needs only that
change and the merge in N4.

## Findings

### R1. Medium, must fix: the M6b criterion is labelled combined but computed per suite

`harness/suites.ts:1957` (used at `:1978`, `:1988`), `scripts/difftest.ts:859`, `scripts/difftest.ts:1132`.

`M6B_MIRI_PASS` reads "miri-pass + miri-pass-heavy >= 80% MATCH", but `criterionOf` takes one suite's counts. Each suite
prints its own `met` / `not met` next to that combined text. No code adds the two, and `scripts/gate.ts` does not read
the criterion at all (only `scripts/difftest.ts` and its test do). `docs/plan-m6.md:197` still says `miri-pass` alone.

Failing scenarios, using the handoff's heavy result of 6/10:
- `miri-pass` 281/350 prints `80.29%: met (plan-m6 gate M6b: miri-pass + miri-pass-heavy ...)`. The real figure is
  287/360 = 79.72%, so the criterion is not met. On a full run the line has no `[sample/filter run]` tag.
- The reverse: `miri-pass` 279/350 prints `not met`, and heavy 10/10 prints `met`; the real figure is 289/360 = 80.28%.
- The heavy suite is not run. New suites are not defaults (`protectedSuites`, `scripts/gate.ts:316`), so root must name
  them, and `--skip-heavy` drops heavy suites. Nothing then signals that 10 cases (2.8 points) left the denominator.
  This has precedent: `docs/next.md:423-424` calls M6b's run-pass share met in a gate that left `run-pass-miri-heavy` out.
  It made no practical difference there (8 of about 3,700 cases), but here it can decide the result.

Fix, smallest first: make `what` say the line covers this suite only and how M6b is derived (sum `match` and `of` over
both suites' `<suite>.summary.json`, both must be full runs); root amends `docs/plan-m6.md:197` and records it. A small
tool that computes the sum from two summaries would be better, and could serve the run-pass family, whose `M6B` text
(`harness/suites.ts`, from harness-m6a) has the same gap. I did not ask to change that text here, so that the existing
suites stay byte-identical.

### R2. Medium, root decision: three heavy cases are there because the port failed them

`harness/suites.ts:1938`, `:1940`, `:1941` (`float.rs`, `panic/nested_panic_caught.rs`, `shims/time-with-isolation.rs`).

These are in `miri-pass-heavy` because the port had not finished them in 42–52 s of CPU, not for any property of the
test. The move changes their limit from 60 s to 1,800 s, and the handoff shows all three then MATCH. So a suite definition
turned three TIMEOUTs into MATCHes: +3 of 360, or +0.83 points. A7 derives the run-pass heavy list from oracle timing.

It is not uniform either. Lane's timing file (`miri-pass-20261103-224105-harness-m6c-grlt.jsonl`, oracle user seconds):

| case | oracle s | where |
|---|---|---|
| `shims/x86/intrinsics-x86-gfni.rs` | 1.79 | miri-pass, 60 s |
| `panic/nested_panic_caught.rs` | 1.17 | heavy |
| `concurrency/sync.rs#stack` | 0.84 | miri-pass, 60 s |
| `backtrace/backtrace-std.rs` | 0.78 | miri-pass, 60 s |
| `shims/time-with-isolation.rs` | 0.77 | heavy |
| `backtrace/backtrace-global-alloc.rs` | 0.71 | miri-pass, 60 s |
| `float.rs` | 0.50 | heavy |

In its favour: all three stay in the denominator, D11 says slow cases "go to the heavy class if they exceed it", A11 is
about cost, and the table in the handoff is open about the reason. But "Decisions for root" does not list this rule, and
its item 3 discusses only the fs cases. The lane's evidence was also taken on a loaded host.

Root should choose and record one:
- keep them, with a stated rule ("the port exceeds 60 s on a quiet host"), applied to any case that meets it and measured
  on a quiet host before M6b is read; or
- move them back until `miri-perf` brings them under 60 s. This is the stricter reading of AGENTS.md §2, and costs at most
  0.83 points.

The other seven heavy cases are fine: four by oracle time (D11 names weak memory) and three for the file race.

### N1. Low: the file race is closed within one process, not between processes

`harness/suites.ts:1917`. `MIRI_TEMP` is a fixed path per case under the shared `$RUST_TS_DATA`, and `jobs = 1`
(`scripts/difftest.ts:925`) holds only inside one difftest. Two lanes running `miri-pass-heavy --filter fs` at once would
have `utils::prepare` delete each other's files, giving a false DIFF. If the oracle's entry is not yet cached (a rebuilt
sysroot re-keys it), a failing oracle output could be cached, which is what the heavy class is there to prevent. A gate is
safe because lanes stop during it. Queue a per-case lock or a note in the suite's description.

### N2. Low: two test assertions check less than they appear to

- `harness/miri-ui.test.ts:201`: `byId("miri-pass", i)` is undefined for every heavy id, so `gated` never looks at the heavy
  cases. A Tree Borrows case in `miri-pass-heavy` would pass. (None exists: I checked directly.)
- `harness/miri-ui.test.ts:203`: `fsHeavy` matches `shims/fs` only, so `issues/issue-miri-3680.rs`, the third file writer,
  is not pinned.

### N3. Low: a comment no longer holds

`harness/suites.ts:1590` says D14 keeps isolation on and that `unstableMiriOracleReason` and `MIRI_CASE_ENV` rely on it. The
new suites have 27 isolation-off cases. `unstableMiriOracleReason` returns nothing for `panic1.rs` (measured), so only the
explicit list covers it. This is correct at the pin, because it is the only isolation-off case that prints a real thread
id. A moved pin could add another, and it would be cached and then DIFF rather than be hidden. The note belongs on that
comment.

### N4. Information: the branch does not merge cleanly into `integ-w38`

`git merge-tree integ-w38 t3/add-miri-harness-suites` (`7a5ac07a`) conflicts at one line, the import at
`harness/compiletest.ts:110`. Take the union of the imported names. Since integ-w38 changes this file in other ways too,
repeat the base/head case dump on the merge.

## The eight checks

1. **Fidelity to ui.rs: ok.** I wrote my own enumerator from the ui_test source, in Python, using no harness code.
   - pass + panic 492 cases and 12 skips, fail 610 cases and 3 skips. Ids and argv are identical to the lane's on all 1,102;
     `rustc-env` agrees too.
   - I ran the isolated Miri on that argv (own `MIRI_TEMP` and out-dir, reduced `PATH`, no `TMPDIR`) and applied ui.rs's
     filters, the test's `normalize-*`, and ui_test's JSON rendering: **1,102 of 1,102 equal upstream's blessed `.stderr` and
     `.stdout`**, with 479 exit 0, 13 exit 101, 610 exit 1. This repeats the lane's scratch check independently.
   - Subject side: `miriSubject` passes the same argv to `src/miri/bin/miri.ts`, with the same env and cwd.
   - **`--error-format=json` is right, and the plan's list was incomplete.** `miri_config` starts from
     `CommandBuilder::rustc()`, whose args are `["--error-format=json"]` (ui_test cmd.rs), and only appends;
     `run_with_deps` even resets the args "otherwise we'll get JSON output". The plan's list also omits `--sysroot` and
     `--out-dir`, so it was a summary, not the argv. JSON makes the comparison stricter, not easier.
   - `tests/panic` without `WithDeps`: `DependencyBuilder::apply` only adds `--extern` / `-L`, no test there names a
     tests/deps crate, and the blessed match confirms the output does not change.
2. **The split: ok.** A5, committed 2026-11-01 (`06495db2`), two days before this lane, says "Gated suites run Miri's defaults
   (Stacked Borrows) ... TB cases are a report suite until after M6". It amends D9's "its 23+ tests in `miri-pass`". The rule
   predates the result. It is applied by flag (`harness/suites.ts:1907`): all 132 cases in `miri-pass-tb` have
   `-Zmiri-tree-borrows`, none of the 360 has any tree-borrows flag, and every `tests/pass/tree_borrows` case is in
   `-tb`. `both_borrows` and similar files split by revision, `#stack` staying gated. The five `-Zmiri-disable-stacked-borrows`
   cases stay in, which is the harder choice. Root should note that A5's authors had "23+" in mind and the real share is 27%.
3. **`miri-pass-heavy`: partly.** Membership is a clean partition of the gated cases: 350 + 10. Nothing in the suite drops a
   case: only ORACLE_TIMEOUT leaves `of`, while TIMEOUT and UNSTABLE stay. The text and computation do not combine: **R1**.
   The three writers are the only ones, from a source search of all 27 isolation-off cases for file and socket APIs; I read
   `path.rs` and `env/temp.rs`, and they do not write. No isolation-on case uses `MIRI_TEMP`. Heavy runs the oracle and then
   the subject in series (`scripts/difftest.ts:972`). `utils::prepare` makes reruns safe. Sockets bind port 0, so they don't
   collide. Across processes: **N1**. Port-based membership: **R2**.
4. **Selection and reconciliation: ok.**
   - All 15 skips are target or bitwidth filters as upstream evaluates them for `MIRI_TEST_TARGET=x86_64-unknown-linux-gnu`.
     No file is rejected, and no skip depends on the port.
   - The plan's measure reproduces exactly: 389 files, base directives only, gives **362 / 14 / 13**. The 27 non-zero
     runs are the ones the handoff names. So: 389 files − 12 filtered = 377 files, expanded to 492 runs. `tests/pass` 479 exit 0
     (347 gated + 132 TB), `tests/panic` 13 exit 101. 13 + 347 = 360.
   - A8's 109 versus the lane's 108: I get 108 counting revisions or target filters, and 109 counting revisions or any
     `only-*` / `ignore-*` directive. That resolves the difference the lane did not chase.
   - `run-pass-aux-miri`: my own grep finds 387 run-pass files with an aux directive, and they are exactly the lane's 327 files
     with cases plus 60 with skips. The four revisions in neither list have no `run-pass` directive of their own, so they are
     correctly absent. The 65 skips are 52 proc-macro, 6 native helper, 6 aux binary and 1
     sanitizer, none of them about the port. The plan's 333 is not exactly reconcilable from these numbers; the suite is report
     only, so I did not pursue it.
5. **The unstable list: ok.** Two oracle runs differ in one line each, and masking the id makes them byte-identical.
   `mir-validation.rs`: `thread 'rustc' (114982803)` vs `(114995968)`, the host's real thread id in an ICE. `panic1.rs`:
   `thread 'main' (39490)` vs `(46366)`, Miri's `gettid` adding the real pid with isolation off. No other case of the 1,102
   differs. Treating them as UNSTABLE is the same rule as elsewhere: `scripts/lib/unstable.ts` says compiletest normalizes
   `$TID` and this harness does not, and ui.rs normalizes it too. They should not be excluded: UNSTABLE keeps them in the
   denominator as non-MATCH (2 of 360), which is the conservative side. Masking would need a harness-wide decision.
6. **`run-pass-aux-miri`: ok.** All 407 aux steps of the 356 cases: `miri: true`, `MIRI_BE_RUSTC=target`, the Miri sysroot, one
   `--crate-type lib`, no `--emit`, `--target=x86_64-unknown-linux-gnu`, isolated `RUSTUP_HOME`, none host-built. `buildAux` runs
   `miriBinary()` by absolute path. Aux directories hold 400 rlibs and no rmeta or dylib; a sampled rlib holds `lib.rmeta` and
   `lib.rmeta-link`. `MIRI_DEFAULT_ARGS` (`-Zalways-encode-mir`) is inserted for this mode (bin/miri.rs). `auxKey` adds
   `miriOracleKey()` (Miri binary, driver, components, target, sysroot hash) only for Miri-built steps, and the aux directory is
   in the case's argv, so the oracle key follows. `bun scripts/miri.ts status` is `ok` for both toolchains. The oracle's
   components file was last modified 2026-11-01, before this lane.
7. **Existing suites: ok.** Dumped on base and head: fields, oracle key, hash of all cases, hash of skips, unstable, first case's
   oracle and subject commands. **53 suites, 362,928 cases, 0 lines changed; head only adds the five suites' lines** (58 suites,
   364,386 cases; 1,458 new). No baseline changed, and gate defaults come from `harness/baseline/*.txt`, so none of the new
   suites is a default. The edits to `scripts/miri.test.ts` and `scripts/unstable.test.ts` only add the new names; nothing was
   weakened.
8. **Runner tests: ok, with N2.** `bun test harness/miri-ui.test.ts scripts/miri.test.ts scripts/unstable.test.ts` alone: 29 pass,
   0 fail. Revision expansion, `BTreeMap` order, filters including `#` and substring behaviour, and the rejections match my
   reading of ui_test and comma. `scripts/lib/common.test.ts` was left out as instructed.

## Fresh samples (`RUST_TS_AGENT=review-m6c`, head `48448a94`, load 30–70)

| suite | sample | MATCH | UNPORTED | TIMEOUT | DIFF / CRASH | run |
|---|---|---|---|---|---|---|
| `miri-pass` | 40 | 32 | 8 | 0 | 0 | `20261104-011740-review-m6c-vqba` |
| `miri-fail` | 25 | 20 | 5 | 0 | 0 | `20261104-011912-review-m6c-5ufg` |
| `run-pass-aux-miri` | 25 | 21 | 4 | 0 | 0 | `20261104-012014-review-m6c-zwrv` |
| `miri-pass-tb` | 10 | 0 | 10 | 0 | 0 | `20261104-012147-review-m6c-ja21` |
| `miri-pass-heavy --filter issue-miri-3680` | 1 | 0 | 1 | 0 | 0 | `20261104-012206-review-m6c-f3z5` |

These are samples, not the M6b figure. There were no TIMEOUTs at this load, which weakly supports the lane's inference that
its 12 came from load 150–200. It is still not a measurement on a quiet host.

## Not checked

- No gate or full difftest of the new suites, as instructed. The only whole-corpus runs were of the Miri oracle itself
  (1,102 cases twice, the 389 files once, from my own scripts; under 10 minutes of process time under load). They wrote to my
  scratch directories, and the upstream checkout is still clean.
- The port on the other nine heavy cases: the handoff's table (6 MATCH, 3 UNPORTED, 1 TIMEOUT) is the lane's, not mine.
- Oracle exit codes for all of `run-pass-aux-miri` (324 / 27 / 5), and the handoff's timing and RSS figures, were not
  re-measured; I used its timing file only for R2. I did not repeat the run with a changed `HOME` / `USER`; my runs did use a
  different `PATH` and environment from the harness, and still matched blessed output.
- The full `bun test ./scripts ./harness`, a host other than `aarch64-apple-darwin`, and the merge with `integ-w38` beyond the
  conflict check (N4).
- Whether `-Ctarget-feature` and similar UNPORTED reasons are correctly attributed to their lanes: that is port work.
