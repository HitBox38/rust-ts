PASS WITH NOTES

**Wave 40d's accept stands.** No protected case was lost, removed or tampered with, every test file ran exactly once in the new
parallel unit step, and the `frozen lists` step really ran frozen on 48 protected cases. The three new `mir` cases are deterministic and
match the oracle, but **their protection rests on one thing: a quiet host while the gate runs `mir`'s solo retry.** They timed out in
5 of 5 runs I made under any concurrent load, including a `--jobs 4` sample, and took 46.0-47.0 s in 9 of 9 runs alone. That is note N1,
of medium severity. The other note is low. Neither reverses the verdict.

Regression audit, 2026-11-08. Gate `gate-20261108-052654-root-cpy7`, tested `c60b129d`, accepted `4ed419a1`. The previous accept is
`71ef4101` (wave 40c). I ran no gate and no full suite. What I did run:
- a dump of every registered case's oracle key at `71ef4101` and at `c60b129d` (371,901 and 372,123 cases), from `git archive` trees;
- the three new cases' subjects, 3 times each alone, once each beside a 12-job `mir` sample and twice beside a 4-job sample, plus one
  `difftest` of the three against the cached oracle;
- the host-rlib fixture of `rlib_macho.test.ts`, rebuilt with the pinned rustc;
- all 63 `tools/codegen/types.ts` sets, regenerated in a scratch tree of `c60b129d`;
- `RawList.of_slice` with and without `RUST_TS_FREEZE_LISTS=1`;
- `coverage.ts` (summary) and `criteria.ts --run`.

Everything ran on AC power, with `RUSTUP_AUTO_INSTALL=0` and `RUST_TS_REQUIRE_PROBES=1`. I read code but changed none. Everything I
wrote went to the scratchpad, apart from the side effects listed at the end.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | medium | **The three new cases survive only a solo retry on a quiet host.** Alone they take 46.0-47.0 s (77-78% of 60 s), 9 of 9 runs. Under concurrent load they time out every time: 3 of 3 beside a 12-job `mir` sample (load 11 to 40), and 2 of 2 beside a **4-job** sample (load about 10), even though those two got 63 s of CPU each. The host has 8 performance and 4 efficiency cores, so load slows each CPU-second as well as taking CPU away. The gate's retries ran at the end of `mir`, when the 1-minute load had fallen to 6-10, and took 45.7-48.3 s. The same gate saw outside load of 86 during `mir`'s pool and 113-117 at other times, more than its own 12-job pool explains. **So one `difftest --sample` from another lane, running during the 2.5 minutes of retries, is enough to lose a protected case.** My estimate is 20-40% per gate if lanes keep running beside gates, and under 5% if the host stays quiet through `mir`. Root's decision is sound only together with that condition, which no tool enforces. Item 3 gives the reasoning and a recommendation. | item 3 |
| N2 | low | **The margin also depends on lists staying unfrozen** (`0d4092c4`, landed as `8f2586ca` + `9a323212`). In the last gate, with frozen lists, all three timed out even alone. Two things prevent a freeze today. `freezeEnvRefusal` stops the gate from starting with `NODE_ENV` or `RUST_TS_FREEZE_LISTS` set. And the `frozen lists` sample cannot pick them: their ranks under seed `frozen-lists` are 9,471, 13,041 and 15,479 against a cutoff of 16, and ranks only rise as the baseline grows. But `scripts/frozen-lists.ts`'s header justifies sampling `mir` by saying its cases are "ordinary tests/ui files", which is no longer true of these three. Changing `SEED` or `PER_SUITE`, or reverting `0d4092c4`, would lose them. That comment should name them. | item 2 |

The previous audit's notes are closed: README's `mir-o2` row now reads 3,475 (w40c N1). The `info sites` step makes the INFO path a
gate check (w40c N2). And `c8ca9c27` puts the oracle sysroot into the cache key of the cases that set `RUSTC_LOG` (w40c N4).

## 1. Protected set: nothing lost, and all totals agree

I recomputed each figure with a script, from `git show` of every baseline at `71ef4101`, `c60b129d` and `4ed419a1`, and from each
suite's raw jsonl.

| Check | Result |
|---|---|
| `git diff --numstat 71ef4101 4ed419a1 -- harness/baseline` | 1 file: `mir.txt`, **+3, -0** |
| Baselines `71ef4101` vs `c60b129d` | identical in all 60: nothing touched them before the gate. `git log 71ef4101..4ed419a1 -- harness/baseline` lists only `4ed419a1` |
| Baseline files | 60 at all three commits, the same names; none ever deleted (`git log --all --diff-filter=D -- 'harness/baseline/*'` is empty) |
| Unique ids | 542,089 to **542,092**; no duplicates in any file |
| `gate.json` `baseline` against the file at `c60b129d` | equal in all 60; `lost` and `lostSkipped` empty in all 60 |
| Added ids against `gate.json` `gained` | identical: the three `type-alias-impl-trait` cases in `mir` |
| Every id at `4ed419a1` against the raw `<suite>.jsonl` | **542,092 of 542,092 `MATCH`** |
| `MATCH` rows not in the baseline | 0 |
| jsonl rows against `gate.json` `total` and `match` | equal in all 60 |
| `history.jsonl:653` (accept) | `runId` and `head` (`c60b129d`) are the run's; 60 suites summing to 542,092; in all 60, `protected` = baseline + gained and `total` = `gate.json`'s |
| `docs/state/current.json` | 60 suites, 542,092; `mir` 21,525; coverage 24,290 / 27,053 |
| `4ed419a1` | parent `c60b129d`; touches `mir.txt`, `current.json` and `history.jsonl`, nothing else |
| `head`, `dirty`, `pass`, `staticOk`, `skipStatic`, `unstableOk`, `upstreamOk` | `c60b129d`, `[]`, true, true, false, true, true; no `ERROR` line in `tmp/gate-w43.log` |
| Suites run against the baseline list | **60 of 60, both ways**; no `notRun`. The report-only suites are outside, as root's scope decision says (`history.jsonl`, 2026-11-08T05:26) |

## 2. Expectation tampering: none

`git diff 71ef4101 c60b129d` touches 27 files in `harness/`, `scripts/` and `tools/` and none of these: any baseline, `UPSTREAM.json`,
`harness/scope.json`, `tools/probes`, `scripts/lib/unstable.ts`, or a corpus file of an existing suite. I checked each named item.

### The unit step's two passes: every test file exactly once

The step now runs `src` and `tools` in 4 workers (`--parallel=4`, with the four `alone` files left out by `--path-ignore-patterns`),
then those four files in a second process (`--isolate`), then `scripts` and `harness` as before.

| Check | Result |
|---|---|
| `git ls-tree` `*.test.ts` under `src`, `tools` at `c60b129d` | 625 files |
| files in `unit-tests.junit.xml` / `unit-tests.alone.junit.xml` | 620 / 4, **no overlap**, no file outside the tree |
| the one tree file in neither report | `src/rustc_data_structures/graph/tests.test.ts`: the port of upstream's `TestGraph` helper, with **no `test(`** in it. Bun reports no suite for it, and it was absent from the last gate's report too |
| `scripts`, `harness` | 40 files in the tree, the same 40 in `runner-unit-tests.junit.xml` |
| tests per file against the last gate | 664 files hold 7,821 tests, against 658 and 7,782. Every difference is an added test or file: `rlib_native.oracle.test.ts` (+8), `rlib_macho.test.ts` (+7, renamed from `rlib_macho.oracle.test.ts`, 7), `info_sites_check.test.ts` (+6), `gate-static-stop.test.ts` (+4), `host-rlib.test.ts` (+4), `marker-check.test.ts` (+5), and +1 or +2 in nine more. **No file lost a test** |
| failures, skips | 0 failures in all three reports; skipped 1 / 0 / 0 |

**Removed test lines** (14 files, 34 lines). None weakens a check:
- `ConstantIndex`/`Subslice` literals rewritten as `bigint` (fixers-47);
- import lines;
- `gate-power.test.ts` and `gate-probes.test.ts` now start their child gate without `NODE_ENV` and `RUST_TS_FREEZE_LISTS`, which
  `freezeEnvRefusal` would otherwise refuse;
- two timing races replaced by handshakes. `ir-normal.test.ts`'s orphan now waits for a `go` file instead of `sleep 3`. In
  `case-lock.test.ts` the re-run's limit went from 3 s to 10 s, while the pool's subject still sleeps 30 s, so it still times out
  (harness-w43 F6);
- `HOST_RLIB` replaced in `rlib_macho.test.ts`. **I rebuilt it** with the pinned rustc, using the command in the file's header (the
  three sizedness lang items, a blank line before `pub fn f() {}`, `--remap-path-prefix="$PWD=/x"`): **byte-identical** to the fixture,
  2,328 bytes.

### The other items

| Item | Finding |
|---|---|
| `ALLOWED_SKIPS` | Unchanged; one entry (`read_binary_file_handles_lying_stat`, Linux-only), and it is the one test that skipped. `runStaticStep` checks each of the three reports, and the two unit reports add into `unitTestSkips` (1 allowed, 0 unexpected). Each report must exist and parse, or the step fails. Under `--parallel`, the failures are now read from the junit report, not from the output's tail. |
| `frozen lists` | **It ran frozen, on protected cases.** The step sets `RUST_TS_FREEZE_LISTS=1` both in its own environment and in `process.env`. `caseEnv` only removes scrubbed names, and `RUST_TS_*` is kept, so every subject inherits it. Without `NODE_ENV`, `RawList.of_slice` gives a list that is frozen only with the variable set (I ran both). Its run `gate-…-cpy7-frozen-lists` has 16 + 16 + 16 rows (`mir`, `mir-o2`, `check-ui`). Every one is `MATCH`, and the ids equal `frozenSample(baseline at c60b129d, 16)` exactly. It took 11 s. |
| `info sites` | Runs `src/rust_ts/info_sites_check.ts`, which stops loudly on a site it cannot check (`62ce4ca0`). Its report in the run directory has 63 `ok` lines and the rest `not ported`, nothing else. It makes the gate stricter. |
| Early stop on a failed static step | It writes `pass: false`, with every suite in `notRun`, and exits 1. `accept` refuses that, so it can only make a run fail. Here `staticOk` is true. `freezeEnvRefusal` likewise can only stop a run. |
| `c8ca9c27` cache keys | **I dumped every case's key at both commits.** Exactly 4 changed: `mir-o2` and `mono-ui` × `attributes/log-backtrace.rs` and `rustc-env/def-path-hash-ice-157238.rs`, the rustc cases that set `RUSTC_LOG`. The other 371,897 are equal. 222 are new, all `host-rlib`, and none was removed. **All 4 oracles re-ran, each output byte-identical to its old entry**: `mir-o2`'s at 02:55Z, before the gate, and `mono-ui`'s at 05:25Z and 09:53Z, the latter during the gate's `mono-ui`. Only `mir-o2`'s `def-path-hash-ice-157238.rs` is protected, and it is `MATCH`. |
| `host-rlib` report-only | `harness/baseline/host-rlib.txt` does not exist, so `protectedSuites()` does not include it, and the gate did not run it. Its cases run their two sides one after the other under a case lock. The only other effect on gated suites is a change to `scripts/lib/env.ts`: it now scrubs the five `*_DEPLOYMENT_TARGET` variables. That changes no key (above). |
| `0d4092c4` | It is not an ancestor of `c60b129d`. It landed as the cherry-pick `8f2586ca`, identical in code. `9a323212` changes only comments. Lists stay frozen under `bun test`: `interning.test.ts`'s tripwire ("under bun test the list is frozen too") passed among the workers. |
| `tools/codegen/` inputs (fixers-47) | **I regenerated all 63 sets** in a scratch tree of `c60b129d`: no committed file changed. The only extra output is `src/rustc_lexer/lib.gen.ts`, which no commit has ever held. It comes from the `rustc_lexer` set, and `types.ts` and `types.sets.json` are unchanged since `71ef4101`, so it predates this wave. The one generated file the wave changed, `rustc_middle/mir/syntax.gen.ts` (8 lines), regenerates as committed. |

## 3. The three new cases

All runs used the harness's own argv, cwd, `caseEnv` and the 60 s limit. "Alone" means a 1-minute load of 1.2-2.0.

| Case | Alone, 3 runs (wall s / user s / max RSS MB) | Beside a 12-job `mir` sample | Beside a 4-job sample | Gate solo retry |
|---|---|---|---|---|
| `recursive-drop-elaboration.rs` | 46.4, 46.6, 46.2 / 49.4-49.8 / 3,995-4,024 | TIMEOUT 60.0 (34.3 user; load 39) | TIMEOUT 60.1 (63.0 user; load 10) | 46.0 |
| `recursive-drop-elaboration-2.rs` | 47.0, 46.2, 46.0 / 49.2-50.1 / 4,001-4,056 | TIMEOUT 60.0 (33.7 user; load 37) | not run | 45.7 |
| `error-tainting-issue-122904.rs` | 46.0, 46.2, 46.5 / 49.0-49.6 / 3,990-4,061 | TIMEOUT 60.1 (33.4 user; load 11) | TIMEOUT 60.1 (62.9 user; load 10) | 48.3 |

- **Deterministic:** one output hash per case across all 9 alone runs, and exit 1 every time. A `difftest` of the three (`--jobs 1`,
  quiet) gives `MATCH` for all three with no retry. The oracle entries (cached since Oct 29) are one E0275 overflow error each, with no
  thread id, hash or long-type name, so no mask is involved.
- **Root's decision** (`history.jsonl:654`) is accurate about the numbers. It is also right that `retryTimes` makes a false loss easy
  to diagnose, and that `dynamic-drop.rs` and `issue-8827.rs` were protected at a similar ratio. But those two need about 35-37 s
  alone, 61% of their limit, against 77-80% here. And the 13 s of headroom is less than one concurrent sample takes away: N1.
- **What makes a loss likely**, in order:
  1. any concurrent CPU work during the retries. One lane's `--sample` is enough. Lanes ran beside this gate: the load reached 86 in
     `mir`'s pool and 113-117 elsewhere;
  2. battery: the gate refuses to start on it, but samples every 60 s and does not stop on a power loss;
  3. the freeze (N2);
  4. a next-solver slowdown of 25% or more in a later wave. perf-heavy measured these cases moving 27% from one lane;
  5. memory pressure: each case peaks at about 4 GB, on a 24 GB host that had 1.6-1.9 GB of swap in use throughout the gate;
  6. more `mir` retries, which run one after another and lengthen the window.
- **Estimate:** with the host quiet through the end of `mir`, under 5% per gate. The gate's own retries ran at 46-48 s, and a quiet
  host has never produced more than 48.3 s. With lanes running beside gates, as in this wave, 20-40% per gate. A retry that overlaps
  outside work is very likely to time out (5 of 5 here), and the retries take 2.5 of about 670 minutes. But lanes run for hours, so
  the overlap is far likelier than that fraction.
- **Recommendation: keep them protected, on a condition.** Removing them means shrinking the protected set, which needs its own
  reviewed exception and another gate, and the queued performance lane is the real fix. Until that lane lands, root should:
  - not run lanes or samples on the host while a gate runs, or at least not from `mir`'s start until it ends (in this gate 08:45 to
    09:46Z, about 3 h 20 min after the gate's start). Say so in `docs/next.md` beside the decision;
  - have the performance lane target under about 30 s alone, perf-heavy F5's bar;
  - consider a small reviewed harness change that records the 1-minute load in each `retryTimes` attempt, so a loss can be told from
    a regression without lining up `host.samples` by hand.

  If root cannot keep the host quiet during gates, moving the three out through a reviewed change is safer than an expected STOP every
  few gates. Root decides.

## 4. Retries and margins

`retryTimes` holds 7 cases (`mir` 3, `run-pass-miri` 4). Every pool attempt hit 60 s wall at 32-42 s of user time, which is contention.
All 7 matched alone.

| Suite (limit) | Case | Protected | Gate, alone | Last gate | My run, alone |
|---|---|---|---|---|---|
| `mir` (60 s) | `error-tainting-issue-122904.rs` | yes, new | **48.3 s (80.5%)** | TIMEOUT alone | 46.0-46.5 s |
| `mir` (60 s) | `recursive-drop-elaboration.rs` | yes, new | 46.0 s (76.7%) | TIMEOUT alone | 46.2-46.6 s |
| `mir` (60 s) | `recursive-drop-elaboration-2.rs` | yes, new | 45.7 s (76.2%) | TIMEOUT alone | 46.0-47.0 s |
| `run-pass-miri` (60 s) | `drop/dynamic-drop.rs` | yes | 36.6 s (61.0%) | 37.1 s (61.8%) | not re-run |
| `run-pass-miri` (60 s) | `threads-sendsync/issue-8827.rs` | yes | 35.0 s (58.3%) | 35.8 s (59.7%) | not re-run |
| `run-pass-miri` (60 s) | `moves/move-3-unique.rs` | yes | 24.8 s | 25.3 s | |
| `run-pass-miri` (60 s) | `array-slice-vec/repeated-vector-syntax.rs` | yes | 18.6 s | 18.9 s | |

- `dynamic-drop.rs` and `issue-8827.rs` are 0.5-0.8 s faster than last gate. The last audit measured 34.9 and 35.2 s alone.
- `type-alias-impl-trait/hkl_forbidden.rs` (19.9 s last gate) did not time out in the pool this time.
- Heavy: `task-comm-6.rs` took 151.1 s of 1,800 (150.2 before), and `consistency_sc.rs` 39.1 s (39.8). The two
  `run-pass-miri-heavy` cases that reach 1,800 s are the same unprotected two.
- **RSS fell with the unfrozen lists**: `check-core` 9,034 MB of 12,288 (73.5%, from 10,414), `rmeta-core` 8,796 (from 10,822).
- Suites took 11.08 h in all, against 10.88 h; each suite ran at 1.03-1.08x its last time, under higher outside load.

## 5. Power and host: AC throughout

| Check | Result |
|---|---|
| `host.allowBattery`, `host.powerLost` | false, `[]` |
| Samples | 175, all `AC Power`, none without a reading; charge 100% throughout; largest gap 660 s; 05:26:54Z to 16:40:49Z |
| `hostStart`, `hostEnd` | AC at both marks of all 60 suites |
| `pmset -g log` (independent) | `Using AC (Charge: 100)` throughout; no sleep, wake or shutdown entry from 07:20 to 18:45 local (+0200). The last battery entry is Nov 7 00:46. No reboot since Nov 4. |
| Load | 1-minute load from 1.3 to 117.8 (08:06Z), with 86 during `mir`'s pool (09:25Z) and 113 at 15:10Z (N1) |
| `note:` lines | 3, all expected: `mir` 3 timeouts, all 3 finished alone; `miri-pass` 1 `UNSTABLE` (`panic1.rs`, as before); `run-pass-miri` 4 timeouts, all 4 finished alone. No stuck host reader, power line or RSS-over-budget note. |

The run directory's mtime of 18:40 is local time: the gate's own end, 16:40:49Z, a minute before the accept. Nothing changed it later.

## 6. Static steps: the whole phase took 8 min 35 s, against 21 min 23 s

Times come from the junit reports' own totals and from file mtimes (all UTC).

| Step | Ends | Time | Result |
|---|---|---|---|
| oracle and probe checks, typecheck | about 05:27:02 | about 8 s, by subtraction | ok |
| unit tests, 4 workers | 05:32:50 | **347.8 s** (19.3% of its 1,800 s). The files' times sum to 1,377.5 s, so all 4 workers stayed busy | ok: 7,368 tests, 0 failures, 1 skipped (allowlisted) |
| unit tests (alone) | 05:34:21 | **91.7 s** (5.1%) | ok: 39 tests in the 4 files; slowest test 18.4 s (`miri/contract.test.ts`) of the 60 s per-test limit |
| runner unit tests | 05:35:16 | 54.7 s | ok: 414 tests, 0 failures, 0 skipped |
| markers, marker order | 05:35:18 | about 2 s | ok; `coverage-order.txt` stamped 05:35:18 |
| info sites | 05:35:18 | under 1 s | ok |
| frozen lists | 05:35:29 | 11 s | ok, 48 / 48 |

**The unit step took 439.5 s in all (347.8 + 91.7), against 1,226.3 s in the last gate,** 2.8 times faster. Each of its two
processes now has its own 1,800 s limit (`runStaticStep`), and the larger used 19%, against 68% before. The slowest test in the
workers took 9.4 s.

## 7. Root's numbers

| Figure | Claimed | Recomputed | |
|---|---|---|---|
| Protected total | 542,092 | 542,092 | ok |
| Suites | 60 | 60 | ok |
| Gain | +3, 0 lost | +3, 0 lost | ok |
| Coverage | 24,290 / 27,053 (89.8%) | `coverage.ts`: 24,290 / 27,053, 89.79% | ok |
| Miri | 1,506 / 1,535 | 1,506 / 1,535 (98.1%) | ok |
| `mir` | 21,525 | 21,525 (`mir.txt`, `current.json`, `history.jsonl`) | ok |
| Masked cases | 24 | the 3 add none | ok |
| Other README rows (`mir-o2` 3,475, `mono-ui`, `check-rg*`, run-pass 3,474 of 3,478, ...) | as README | equal to the baselines | ok |

`scripts/criteria.ts --run gate-20261108-052654-root-cpy7` gives the same results as `docs/next.md:537`:

| Group | `criteria.ts` | Threshold |
|---|---|---|
| M6b run-pass | 3,474 / 3,478 = 99.88%, met | 90% |
| M6b run-fail | 294 / 294 = 100%, met | 90% |
| M6b miri-pass | 350 / 360 = 97.22%, met | 80% |
| M7a ir-hello | not met: "ir-hello: not in this gate" | 100% |
| M7a mir-o2 | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a mono-ui | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a check-rg | 34 of 34 crates, met | 33 |

## What I did not check

- **Protected cases other than the three new ones** were not re-run. Their status comes from the gate's jsonl. Their oracle entries are
  as cached, and apart from the 4 above, none was re-keyed.
- **`dynamic-drop.rs` and `issue-8827.rs`** were not re-run; I compared the gate's times with the last gate and the last audit.
- **`recursive-drop-elaboration-2.rs` beside the 4-job sample**: I did not run it, because the other two had already timed out there.
- **Port correctness** of the wave's code (link-rlib-native, fixers-47, unit-parallel, harness-w44): that belongs to their reviews. I
  read the harness, script, test and codegen-input diffs, `list.ts` and `frozen-lists.ts`.
- **Typecheck and the unit steps** were not re-run; I rely on the gate's log and junit reports.
- **The `host-rlib` suite** was not run. I only checked that it is outside the gate and changes no gated key.
- **What caused the outside load** during the gate. `gate.json` records load, not processes.
- **Side effects in `$RUST_TS_DATA`.** These are report files only, and nothing compared reads them. No oracle cache entry was written
  (no file under `oracle-cache` is newer than the start of this audit).
  - Three run directories: `20261108-170213-w40d-audit-pezy` (`mir --sample 2500`: 2,500 / 2,500 `MATCH`),
    `20261108-171009-w40d-audit-j4-16ii` (a `--jobs 4` sample, which I stopped once the timings were done) and `w40d-audit-tait3`;
  - the key dump called every suite's `cases()`, which touches cached aux directories' mtimes;
  - `coverage.ts` rewrote `coverage.json`.
