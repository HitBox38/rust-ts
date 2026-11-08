**Verdict: REQUEST CHANGES.** Two findings, and both have small fixes. F1: a new assertion in `scripts/retry-times.test.ts` fails whenever a sampled load average is one of about 13% of two-decimal values, and that test runs in the gate's `runner unit tests` step. I saw it fail 2 times in 11 runs. F2: the frozen lists step now fails for good on a host whose latest accepted run directory is gone, and no new gate can be accepted to clear it. Everything else holds. Pass and fail are decided as before, all 60 protected suites keep their oracle keys and case lists, a planted list write is still caught, and the trial merges are clean.

# Review: lane `harness-w45` (queued harness findings)

- Batch: branch `t3/harness-gate-reporting-fixes`, head `682d3825`, against `main` `519e6360`. Handoff: `docs/handoff/harness-w45.md`.
- Reviewer: independent, and read-only on code. Nothing ran in the tree under review. Everything ran in my own scratch worktrees: `main` `519e6360`, head `682d3825`, fixers-48 `6962913b`, and head merged with fixers-48 (not committed).
- Host: root Mac on AC power, at a load of 8 to 22 from other lanes. Settings: `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, `RUST_TS_AGENT=w45rev`.
- I ran no gate and no full suite. My run directories are `$RUST_TS_DATA/runs/w45rev-*`.
- `$SCRATCH` below means my session's scratchpad. Its scripts and logs are temporary.

## Findings

### F1 (blocking): `scripts/retry-times.test.ts:70` fails at random under the gate. Reproduced.

```ts
expect(Math.round(v * 100)).toBe(v * 100);
```

`load1()` (`scripts/difftest.ts`) returns `Math.round(x * 100) / 100`. For many two-decimal values, multiplying by 100 again does not give an exact integer in floating point. Two examples: `19.01 * 100 = 1901.0000000000002`, and `4.73 * 100 = 473.00000000000006`.

- **How often:** 1,146 of the 10,001 values from 0.00 to 100.00 fail the assertion (11.5%). Between load 10 and 40 the rate is 13.6%. The test checks 6 load values, and a run fails if any one of them is a bad value. The values are close together, because the load average updates only every 5 s, so the chance per run lies between about 14% and 52%.
- **Seen:** 2 failures in 11 runs on this host.
  - `bun test ./scripts ./harness` on head: `Expected: 1901.0000000000002, Received: 1901`.
  - The same on head merged with fixers-48: `Expected: 473.00000000000006, Received: 473`.
  - Then `retry-times.test.ts` alone passed 8 times in a row.
- **Effect:** the file is under `scripts/`, so the gate's `runner unit tests` step runs it. A failed static step stops the gate before the suites (`gate.ts` `gateRun`). Roughly one gate in seven or worse would stop with a false `ERROR: runner unit tests` and have to be restarted. The lane's "417 tests, 0 failures" was a lucky run.
- **Not affected:** the production code is right. `load1()` cannot throw, and nothing that decides a status reads `load1`. Only the test is wrong.
- **Fix:** `expect(Number(v.toFixed(2))).toBe(v)`, or `expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6)`.

### F2 (blocking): `scripts/frozen-lists.ts:87,99` stops every gate for good once the latest accepted run's `gate.json` is gone. Reproduced with synthetic run directories.

`nearLimitCases` returns an error, and the step exits 1, in three cases:
- the latest accepted run's `gate.json` is missing;
- it cannot be parsed;
- it lacks `retryTimes` for any of `mir`, `mir-o2`, `check-ui`.

I ran `nearLimitCases` from `$SCRATCH/tools/fl.ts` against the real `docs/state/history.jsonl`:

| `runsDir` | result |
|---|---|
| the real `$RUST_TS_DATA/runs` | ok: 36 runs read, 4 `mir` cases left out, 0 from `mir-o2` or `check-ui` |
| a fresh host (directory does not exist) | **FAIL**: "the latest accepted gate run's …/gate-20261108-052654-root-cpy7/gate.json is missing" |
| only the latest run kept (older runs pruned) | ok: 1 run read, **0 cases left out** |
| the latest run's directory gone, older ones present | **FAIL** |
| the latest `gate.json` from an older harness, with no `retryTimes` | **FAIL**: "records no retryTimes for mir, mir-o2, check-ui" |
| the latest `gate.json` truncated | **FAIL**: "cannot read …: JSON Parse error: Unexpected EOF" |
| an older accepted run's directory gone | ok: it adds nothing (it is skipped) |

**Why this blocks:**
1. **No way out from the gate itself.** The step runs before the suites, and a failed static step stops the gate. A stopped gate cannot be accepted, so there will never be a newer "latest accepted run" to read. Once the latest directory is gone, every later gate stops at `frozen lists`. The only fixes are restoring that directory by hand or a reviewed `scripts/` change. This has happened once already: the first three accepted runs are from the Windows host, and their directories do not exist on this one. A move to another root host, or a `.data` cleanup (`runs/` is 1.7 GB in 4,989 directories), would trigger it again.
2. **It fails where nothing is at risk.** The exclusion only avoids a frozen TIMEOUT on a near-limit case, and that is a false failure, not a missed bug. At the gate's 16 cases per suite the exclusion changes nothing today: the 4 left-out `mir` cases rank 20,212 to 20,395 of 21,525 under the fixed seed, and the picks equal `main`'s in all three suites (checked). Without the data, the step would pick exactly what last passed. Failing turns a possible false failure into a certain one.
3. **The check does not give the guarantee it claims.** Pruning every run except the latest drops every older exclusion without a word. The TAIT cases' only record could be in those older runs. Only the loss of the latest directory fails the step.

**Fix (any of these):**
- When `gate.json` files are missing, print a `note:` naming them and sample with whatever exists.
- Or use the newest accepted run whose `gate.json` exists, and fail only if none can be read.
- Or keep the near-limit set in the tree. The handoff turned that down to avoid hand edits, but a tree file would make the sample deterministic again (see N4).

A `gate.json` that exists but cannot be parsed can reasonably stay an error.

### Nits

- **N1. `scripts/gate.ts:410`: a `process.exit` or crash in a one-process pass names no file. Reproduced.** The new naming covers a load error, `.only` and a failing test in every pass, and every case among the workers (see section 3). In the two one-process passes, the alone pass and `runner unit tests`, a test that calls `process.exit(0)`, `process.exit(1)` or `process.abort()` leaves no junit report. Bun's output then names no file: it prints only `bun test v1.4.3`. The step fails as it should, but the only clue is the "(bun test exited 0: a test that called process.exit?)" hint, and only for exit 0. For a non-zero exit or a signal, the no-report branch prints neither that hint nor the line-430 "names nothing" message. Suggestion: in the no-report branch, give the same hint for any exit code and list the files of the pass when it ran few, as the alone pass does. This was not a regression: `main` named nothing there either.
- **N2. The miri-sysroot oracle keys change, and the handoff does not say so. Measured.** `harness/suites.ts:2272` hashes the whole of `scripts/miri-sysroot-run.ts` into the `miri-sysroot-core`, `-alloc` and `-std` oracle keys. Those keys go from `0d08cd66…` to `b19ef57d…`. These suites only report and are outside the gate, so the cost is one oracle re-run of each the next time someone runs them. The handoff's "no protected suite's oracle key changes" is true; it should also name this.
- **N3. `src/rust_ts/info_sites_check.ts:201`: the namesake rule makes a failing check pass. Reproduced. Intended, but say so.** I deleted the `coercion.rs:242 coerce` marker in scratch copies of `main` and head.
  - `main` exits 1 with "the scanner and the marker disagree".
  - Head exits 0, reporting `not ported: …coercion.rs:242 coerce (1 site(s))`.
  - Head now treats this marker the same way it treats a removed marker on any fn without a namesake. That matches what harness-w44 N3 asked for. But that review's "either way the step fails" no longer holds: the step now passes on a removed namesake marker. Root should know that no step catches a removed marker. `coverage.ts --missing` shows it, but no step fails on it.
  - The rule is sound only while both the scanner and the markers use the `fn` keyword's line, so that two different lines that both declare `fn <name>` must be two different fns. That is true at this pin.
- **N4. The sample is no longer fixed by the tree.** It now depends on which run directories exist under the host's `$RUST_TS_DATA`. The header says the sample stays the same "until a baseline grows or an accepted gate records another case near its limit". Pruning runs, or another data root, also changes the sample. That cannot matter today (see F2, point 2), but the header should say it.
- **N5. `scripts/frozen-lists.ts:64`: a malformed line in `history.jsonl` crashes the step.** `JSON.parse` throws, and the step dies with a stack trace instead of one `ERROR:` line (reproduced with an extra `{not json` line). The step still fails, so this is only about output.
- **N6. `scripts/miri-sysroot-run.ts:109`: an edge case where a live run's directory could be removed. Read only.** In a Linux container where `/proc/self/ns/pid` cannot be read, the namespace tag falls back to host name and boot id. Two such containers that share `$RUST_TS_DATA`, with the same `--hostname` and the same boot, would get the same tag, and pid numbers repeat across containers. One could then remove the other's live directory. This needs a restricted `/proc`, a shared data root and a fixed host name all at once. It does not apply to the root Mac. Possible fix: give up on cleanup (leak) when the namespace link cannot be read on Linux.
- **N7. Branch name.** The handoff says branch `t3/e0c25e65`, but the batch is on `t3/harness-gate-reporting-fixes`.

## 1. Frozen lists (`scripts/frozen-lists.ts`)

- **A planted list write is still caught. Reproduced.** I used perf-heavy F1's write, `(r as T[])[0] = r[0]!` after `intern_slice` in `TyCtxt.slice_intern`, in a scratch copy of head.
  - `bun scripts/frozen-lists.ts --per-suite 2`: **1/6 MATCH**, 5 CRASH (`TypeError: Attempted to assign to readonly property`), exit 1 (run `w45rev-plant`).
  - Clean head at the default size: **48/48 MATCH**, exit 0, 12 s (run `w45rev-clean`). It printed `left out 4 protected case(s) … in the retryTimes of 36 accepted gate run(s)`.
- **Deterministic, and the same picks as `main`.** For `mir`, `mir-o2` and `check-ui`, head's 16 picks with the real exclusions are identical to `main`'s `frozenSample`, and identical on repeated runs. None of them is excluded.
- **The exclusion does not grow out of hand.**
  - Only the 4 most recent accepted runs have `retryTimes` at all. The earlier 32 predate harness-w40 and have no key.
  - Those 4 runs hold 7 or 8 entries each, across all suites.
  - The set it produces: 4 `mir` cases (the three TAIT cases, and `hkl_forbidden.rs` from 3 runs) out of 21,525 `mir` cases. Baselines are 3,475 for `mir-o2` and 730 for `check-ui`.
  - It keeps growing while old runs are kept, by every case a loaded gate ever had to retry. Even hundreds would leave nearly all of `mir` to sample from. The real cost is a bias: it leaves out the heavy cases, which exercise lists the most.
- A `gate.json` from an older harness as a *non-latest* accepted run adds nothing (`?? []`). As the latest, it fails (F2).
- `gate accept` refuses a run that skipped a protected suite (`gate.ts:567`), and every suite entry gets a `retryTimes` array, empty or not (`gate.ts:488`). So the "records no retryTimes" error cannot fire for a run accepted by the current harness.

## 2. Load in `retryTimes` (`scripts/difftest.ts`)

It is reporting only (read). `load1` is written into `CaseResult.attempts`, and from there into `gate.json` `retryTimes`. A grep finds no reader outside `difftest.ts` and `gate.ts`, and no status uses it. `os.loadavg()` does not throw, and returns 0s on Windows. `aloneStart` is sampled inside the case lock, as the handoff says. The only defect is in its test (F1).

## 3. Unit-step failure naming (`scripts/gate.ts`)

**Pass or fail is decided exactly as on `main`. Reproduced and read.**

I used `$SCRATCH/tools/plant-unit.ts`. It builds real `bun test` fixture trees, runs `unitStaticSteps` and `runStaticStep` from `main`'s and from head's `gate.ts`, and compares them. There are 6 plants, each in 3 passes:
- workers: `parallel: 3`, the planted file not alone;
- alone: the planted file in the `alone` list;
- runner: no `parallel`, root `scripts`.

| plant | workers | alone | runner | named by head? |
|---|---|---|---|---|
| top-level throw at load | F,P = main | P,F = main | F = main | yes, in all 3 ("an error outside any test …") |
| `test.only` under `CI=true` | F,P = main | P,F = main | F = main | yes, in all 3 |
| failing test | F,P = main | P,F = main | F = main | yes, in all 3 (`failed: …: fails`) |
| `process.exit(0)` | F,P = main | P,F = main | F = main | workers: yes (`(worker crashed)`); alone and runner: no file, only the exit-0 hint (N1) |
| `process.exit(1)` | F,P = main | P,F = main | F = main | workers: yes; alone and runner: no (N1) |
| `process.abort()` | F,P = main | P,F = main | F = main | workers: yes; alone and runner: no (N1) |

All 18 pass arrays are identical to `main`'s.

Reading the code:
- `pass` is still set only by the exit code, a missing report, an unreadable report and unexpected skips.
- `errorsOutsideTests` runs only when `!pass`.
- The `ok` line now waits until the report is read, and its spelling (`ok` plus four spaces) is unchanged.
- The `slowest:` and `note:` lines come after `pass` is final and never assign it. `Number(time)` cannot throw, and a missing `time` is skipped.

The stopped path's `upstreamStatus` throws only if `git status` fails. It succeeded at the gate's start, and a throw there would only lose the record of a run that had already failed.

## 4. `miri-sysroot-run.ts` namespace

Read, and tested by the lane's updated `harness/miri-sysroot.test.ts`, which passed in my runs.
- **Two live runs on one host cannot get one name.** Within one pid namespace, live pids are unique. Two namespaces get different tags, unless the namespace link cannot be read (N6).
- **A live run's directory is not removed.** A run removes only directories of its own side and tag whose name is a plain positive integer and whose pid `kill(pid, 0)` reports gone, with `EPERM` counted as alive. A reused pid only keeps a dead run's directory (a leak).
- **Old-format `<side>.run-<pid>` directories** are never removed. That is a leak, on purpose. There are none today: all four crate directories under `$RUST_TS_DATA/rmeta/miri-sysroot/` are empty (checked).
- The oracle-key cost is N2.

## 5. `mono-run.ts` starts the logger

- **No protected `mono-ui` case sets a log variable. Measured over all 3,479 cases.**
  - All 3,475 protected cases carry `RUSTC_LOG_COLOR: null`, which unsets it.
  - Only 2 unprotected cases set one: `log-backtrace.rs` (`RUSTC_LOG=info`, `RUSTC_LOG_BACKTRACE`) and `def-path-hash-ice-157238.rs` (`RUSTC_LOG=trace`).
  - `scripts/lib/env.ts:77` scrubs inherited `RUSTC_LOG*`.
- **No key changes.** `mono-ui` has no `oracleKey`. The subject script is not in any case key: all 3,479 keys are in the identical 60-suite dump (section 7).
- **My sample:** `difftest --suite mono-ui --sample 120 --jobs 4` on head gave **120/120 MATCH** (run `w45rev-mono-sample`). `--filter log-backtrace` gives UNPORTED (`rustc_log::BacktraceFormatter`), as the handoff says.
- **Spot check of the lane's full run** (`$RUST_TS_DATA/runs/w45-mono-ui-full`):
  - `mono-ui.jsonl` has 3,479 rows: 3,475 MATCH, 3 DIFF, 1 UNPORTED.
  - All 3,475 protected ids are MATCH, and no row has a retry. The 4 cases that are not MATCH are the 4 the handoff names.
  - **One caveat:** the run took 1,081 s and its last row was written at 19:55:51, so it started at about 19:37:50. That is before commit `2f2c3f0d` (19:41:27). The change may have been in the working tree already, but the summary records no head, so I cannot confirm the run tested this commit. My sample, which did run on head, agrees with it.

## 6. `info_sites_check.ts` (harness-w44 N3)

- **The report is byte-identical to `main`'s.** I ran it on both scratch trees and the two `report.txt` files are equal. Both print 136 sites (3 skipped), 83 in ported fns and 18 fns not ported, and both exit 0.
- **A planted marker removal now reports "not ported"** (N3 above). `main` reported "disagree" and failed. A marker at a line that declares no such fn still disagrees, and the lane's new test covers that.

## 7. Oracle keys, unit tests, merges

- **All 60 protected suites keep their `oracleKey()`, their case lists and every case key. Measured.**
  - `$SCRATCH/tools/keys.ts` dumps, per baseline suite: `oracleKey()`; a hash of the case list (`id`, `file`, `args`, `env`, `cwd`, in order); and a hash of every case's `caseOracleCacheKey`.
  - The dumps from `main` and head are byte-identical: 60 suites, 370,160 cases, 19 with an `oracleKey`, 0 errors.
- **`bun test ./scripts ./harness`** (with the gate's step environment):
  - head: 417 tests, 1 failure, which is F1, in 67.8 s.
  - `main`: 414 tests, 0 failures, in 66.0 s.
  - So the 3 new tests add about 2 s at load around 20. Within noise.
- **Trial merges:**
  - With `main` `519e6360` (integ-w43's merged state): head is based on it, so the merge is trivially clean.
  - With fixers-48 (`t3/6b4c6b71`, branch `t3/fixers-48-queued-port-findings`, `6962913b`): `git merge --no-commit` is clean with no conflicts. fixers-48 touches no file under `scripts/` or `harness/`.
  - On the merged tree, `bunx tsc --noEmit -p .` exits 0. `src/std/env.test.ts` and `info_sites_check.test.ts` pass, 13 tests.
  - The merged tree's info-sites report is byte-identical to fixers-48's alone, which differs from head's only by fixers-48's own `locator.ts` marker lines.
  - `bun test ./scripts ./harness` on the merge gave 417 tests and 1 failure, the F1 flake again (load 4.73).

## What I did not check

- I ran no gate. I did not run `gateRun` end to end with these changes, so I did not see the stopped `gate.json`'s new `upstreamOk` and `frozenLists` fields written by a real gate. I read them, and the lane's `gate-static-stop.test.ts` passed.
- I ran no full `mono-ui` (only 120 cases) and no full suite of any kind.
- The pid namespace on Linux (VMs, containers) was read only: there is no Linux host here.
- I did not measure how long the static steps take, so I did not price a false stop from F1.
- I did not re-check the harness-w44 N4 reasoning (sysroot hash breadth), which the lane left unchanged.
- I did not check the "slowest test" timings against a real gate's reports.
