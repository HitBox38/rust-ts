PASS WITH NOTES

**Wave 40c's accept stands.** Nothing protected was lost, tampered with or hidden. All three new cases are raw byte-identical to
the oracle 6 of 6 times each, alone and under load, with no mask involved, and none uses more than 3.6% of its limit. There are
four notes, all low severity. One is a stale README figure. One corrects a claim from the last review that is no longer true:
**the three new cases are exactly the protected cases that set `RUSTC_LOG`.** The other two concern what root's triage note
covers and what the oracle key covers. None of them reverses the verdict.

Regression audit, 2026-11-08. Gate `gate-20261107-141645-root-lspa`, tested `2e8c1b98`, accepted `71ef4101`. The previous accept
is `045b7318` (wave 40b). I ran no gate and no full suite through difftest. What I did run:
- a dump of every registered case's oracle key and environment at `045b7318` and at `2e8c1b98`, 371,901 cases at each;
- the three new cases, oracle and subject, 3 times alone and 3 times under load;
- the two near-limit cases' subjects, once each, alone;
- the 9 callconv fixtures and `large_assign`'s collector fixture, regenerated into scratch;
- the 10 typemap sets that load the changed inputs, regenerated in a scratch tree;
- `coverage.ts` (`--check`, `--order --require-clean`, summary) and `criteria.ts --run`.

All of it ran on AC power, at a load of 1.1 to 14. I only read code. Everything I wrote went to the scratchpad, apart from the
side effects listed at the end.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | low | README's `mir-o2` figure is 3,474. The protected count is **3,475**: `mir-o2.txt` has 3,475 lines, and the gate shows `match=3475/3479`, `gained=1`. The accept updated the headline (542,089), `run-pass-miri` and `run-pass-aux-miri`, but not this row. Every other README figure agrees. | `README.md:41`; item 7 |
| N2 | low | **"No protected case sets a log variable" is no longer true.** The +3 are exactly the protected cases that set `RUSTC_LOG`: `def-path-hash-ice-157238.rs` sets `trace` (in `mir-o2` and `run-pass-miri`) and `rust-log.rs` sets `debug` (in `run-pass-aux-miri`). Before the accept no protected case set one. The only LOG-named setting was `spawning-with-debug.rs`'s `exec-env:RUST_LOG=debug`, which goes to the interpreted program as `-Zmiri-env-set` and is not rustc's logger. Every other LOG entry is a removal: `RUSTC_LOG_COLOR` in 23,410 cases and `MIRI_LOG` in 5,234. A false pass is not possible here. Each case compares 554 or 19,876 raw lines, and the oracle has no line a mask touches. What has changed is that the INFO path is now protected: `tracing.ts`, `instrument`, every live INFO site and the `info_unconverted` stops. `info_sites_check.ts` is not a gate step (fixers-45 review F4). From now on, a lane that converts, moves or adds an INFO site in creader, locator, interpret, miri or one of the instrumented fns can lose these cases. Later reviews should stop repeating the old claim. | item 2 |
| N3 | low | Root's triage note in `docs/next.md:516` names only `rust-log.rs` as the whole-run canary. **`def-path-hash-ice-157238.rs` in `run-pass-miri` has the same profile:** 19,876 lines, 15,285 `interpret::step` lines, 1,109 `miri::machine` lines, 841 `borrow_tracker` lines and the same 12 interner and codegen count lines. The two outputs differ in 844 of 19,876 lines, and only in three ways: the crate name, the filter warning's word (`trace` / `debug`) and Miri's pointer values. The count lines are identical in both. A loss in either case should be triaged the same way: `debug_stats`' counts and the step lines first. The note is right about `rust-log.rs`. It is incomplete, because it leaves out the `run-pass-miri` case. | item 3 |
| N4 | low | `mir-o2`'s `def-path-hash` output names 121 locator paths under `~/.rustup/toolchains/nightly-2026-10-11-aarch64-apple-darwin/lib/rustlib/x86_64-unknown-linux-gnu/lib`. The oracle key of a `rustc` suite covers the `rustc_driver` hash (`oracleVersion`), but not that directory's file list or the home path. Running from another home, or after any change to the files of the oracle's x86_64 `rust-std`, would make the cached oracle disagree with a correct subject. That gives a false loss, never a false pass. The Miri cases have the same kind of paths, but their key covers the sysroot (`miriOracleKey`). | `scripts/difftest.ts:258-270`; item 3 |

## 1. Protected set: nothing lost, and all totals agree

I recomputed each figure from `git show` of every baseline at `2e8c1b98` and at `71ef4101`, and from each suite's raw jsonl.

| Check | Result |
|---|---|
| `git diff --numstat 045b7318 71ef4101 -- harness/baseline` | 3 files, **+1, -0** each: `mir-o2.txt`, `run-pass-aux-miri.txt`, `run-pass-miri.txt` |
| Baselines `045b7318` vs `2e8c1b98` | identical: nothing touched them before the gate. `git log 045b7318..71ef4101 -- harness/baseline` lists only `71ef4101` |
| Baseline files | 60 at all three commits; none ever deleted (`git log --all --diff-filter=D -- 'harness/baseline/*'` is empty) |
| Unique ids | 542,086 to **542,089**; no duplicates in any file |
| `gate.json` `baseline` against the file at `2e8c1b98` | equal in all 60; `lost` and `lostSkipped` empty in all 60 |
| Added ids against `gate.json` `gained` | identical: `def-path-hash-ice-157238.rs` in `mir-o2` and in `run-pass-miri`, `rust-log.rs` in `run-pass-aux-miri` |
| Every id at `71ef4101` against the raw `<suite>.jsonl` | **542,089 of 542,089 `MATCH`**; none missing |
| `MATCH` rows not in the baseline | 0 |
| jsonl rows against `gate.json` `total` and `match` | equal in all 60 |
| `history.jsonl:648` (accept) | `runId` and `head` are the run's; 60 suites summing to 542,089; `protected` = baseline + gained and `total` = `gate.json`'s, in all 60 |
| `docs/state/current.json` protected sum | 542,089 |
| `71ef4101` | parent `2e8c1b98`; touches the 3 baselines, `current.json` and `history.jsonl`, nothing else |
| `head`, `dirty`, `pass`, `staticOk`, `skipStatic`, `unstableOk`, `upstreamOk` | `2e8c1b98`, `[]`, true, true, false, true, true; no `ERROR` line in `tmp/gate-w42.log` |
| Suites run against the baseline list | **60 of 60, both ways**; no `notRun`. The 10 registered suites without a baseline (`check-chain`, `check-core-bin`, `ir-hello`, `mir-heavy`, `miri-fail`, `miri-pass-tb`, `miri-sysroot-{core,alloc,std}`, `parse-ui-json`) are exactly root's scope decision (`history.jsonl`, 2026-11-07T14:16) |

## 2. Expectation tampering: none

`git diff 045b7318 2e8c1b98` leaves these untouched: every baseline, `UPSTREAM.json`, `harness/scope.json`, `tools/probes`,
`scripts/lib/unstable.ts` (the masks), and every corpus file of an existing suite. In `harness/`, `scripts/` and `tools/` it changes
25 files. I checked each named item:

| Item | Finding |
|---|---|
| `RUSTC_LOG` INFO events (fixers-45) | The allowlist `INFO_CONVERTED_TARGETS` / `unconverted_info_directive` was replaced. Each unconverted site now calls `info_unconverted`, which stops with `unported` only when the filter enables INFO for its target. Every live site is behind `MAX_LEVEL`, which no case lowers without a filter. The cases with a filter are listed in N2. The removed `rustc_log` test pinned the removed allowlist. Two tests replace it, one for `info_unconverted` and one for the `instrument` span output. |
| `marker-check.ts`: `Result` method anchors | The anchor check now also searches for the port's name for a call (`RESULT_METHODS` mapped back to upstream's). That widens a static marker check only, and no suite reads it. Its unit test gained one case. root-w42-check N4 notes the case is thin; it is already queued. |
| `marker order` gate step | Added after `markers`: `coverage.ts --order --require-clean src/rustc_monomorphize/`. It fails on any inversion, and also on a prefix that names no marked file. It makes the gate stricter. It ran on the tested commit (item 6). |
| `oracle.ts`: `RUSTUP_AUTO_INSTALL=0` | It applies to `verifyOraclePin`, `oracleSysroot` and `oracleHost` only. `run` merges it into the environment, so `PATH` stays. Under the real home the pin is installed, so the output is unchanged. No oracle key changed (below). |
| `regen.ts`: thread ids written as 0 | **I regenerated all 9 callconv fixtures into scratch with the pinned rustc**, using `common.ts`'s `abi_args` and `test_env`: **9 of 9 byte-identical** to the committed files. The mask touches only `scalable_indirect`, the ICE fixture. The test reads that fixture only through `ice_message`, whose `\(\d+\)` accepts `0`. It compares the other 8 whole. I also regenerated `large_assign` (the 2^53 move, `collector_oracle/regen.ts` redirected to scratch): **byte-identical**. |
| `tools/codegen/` typemaps (fixers-46, accepted by root) | **In a scratch tree of `2e8c1b98` I ran `tools/codegen/types.ts`** for `rustc_lint`, `rustc_monomorphize`, `rustc_middle_{mono,diagnostics,mir}`, `rustc_mir_build_builder`, `rustc_mir_transform`, `rustc_const_eval_interpret`, `rustc_borrowck` and `miri`: **all 524 `.gen.ts` files were unchanged**. The change moves two diagnostic fields from `number` to `bigint`, and the harness never reads them. |
| IR per-case lock | Only `irSuite` defines `Suite.caseLock` (`suites.ts:2117`). `withSuiteCaseLock` calls `fn()` directly for every other suite, both in the pool and in the subject re-run. The only IR suite is `ir-hello`, which is outside the gate. Lock files go beside `$RUST_TS_DATA/ir/...`, not into any compared output. |
| `criteria.ts` | Adds `--milestone` and the M7a groups. It is report only; the gate and the accept do not read it. |
| `miri.ts` `hostLookupRefusal`, `miri-sysroot*`, `ir-run.ts`, `difftest.ts` | The refusal can only make a run die. The miri-sysroot and IR changes touch suites outside the gate. `difftest.ts` changes only the lock above. Status, comparison, `lost`, `gained` and the baseline write are unchanged. |

**Oracle keys.** I dumped each registered case's `caseOracleCacheKey` from `git archive` trees of `045b7318` and `2e8c1b98`. The
worktree dump at `2e8c1b98` equals the scratch dump.

| Suite | Keys changed | Oracle re-run? |
|---|---|---|
| `ir-hello` | 2 of 2 | not in this gate; not protected |
| `miri-sysroot-core`, `-alloc`, `-std` | 1 each | not in this gate; not protected |
| every gated suite (370,160 cases) | **0** | none was needed and none happened: every gated case's cache entry predates the gate's start (14:16:45 UTC) |

The one gated case without a cache entry is `miri-pass`'s `tests/panic/panic1.rs`. It is listed `UNSTABLE`, never cached or
protected, as in the last gate.

**Removed test lines** (8 test files with deletions, 59 lines). None weakens a check:
- the `rustc_log` allowlist test (above);
- `aarch64.oracle.test.ts`: whole-stderr comparison for the non-ICE cases, plus `ice_message` for the new ICE case;
- `miri-sysroot.test.ts`: the corpus is now 27 crates (`custom_local_sysroot` added, miri-sysroot review F1) instead of 26;
- `host-state.test.ts`: changed time windows (harness-w43, its review F6);
- the rest are import lines.

The unit-test skip allowlist is untouched. Its one entry is the only test that skipped.

## 3. The +3: stable to protect

`$RUST_TS_DATA` on AC power, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`. Each side ran with the harness's own argv, cwd,
`caseEnv` and limits. I compared the raw rendered text with the cached oracle entry, then compared again through `maskedTexts`.
"Alone" means a load of 1.2 to 1.4. "Load" means 16 `yes` burners on 12 cores, a load of 7 to 14.

| Suite (subject limit) | Case | Oracle | Oracle runs (alone + load) | Subject runs (alone + load) | Mask changes it? | Subject wall alone / load (% of limit) |
|---|---|---|---|---|---|---|
| `mir-o2` (240 s) | `def-path-hash-ice-157238.rs` | `2acf25b9f91f`, 554 lines, exit 0 | 6 of 6 raw-identical | **6 of 6 raw-identical** | no | 0.7 s (0.3%) / 1.1 s (0.5%) |
| `run-pass-miri` (60 s) | `def-path-hash-ice-157238.rs` | `81bafdfaeba7`, 19,876 lines, exit 0 | 6 of 6 raw-identical | **6 of 6 raw-identical** | no | 1.1 s (1.8%) / 1.9 s (3.2%) |
| `run-pass-aux-miri` (60 s) | `rust-log.rs` | `fbdc7440ee85`, 19,876 lines, exit 0 | 6 of 6 raw-identical | **6 of 6 raw-identical** | no | 1.1 s (1.9%) / 2.2 s (3.6%) |

- **Masks:** none of the three matches through a mask. Each oracle entry is unchanged by `maskedTexts`, and every subject run was
  raw-identical to it. README's "24 of them through a mask" stays right.
- **Content:** the `mir-o2` case holds creader and locator lines (288 + 86) and a few `#[instrument]` spans, with no counts and no
  Miri trace, so it is robust. The two Miri cases are whole-run canaries (N3). Their pointer values are Miri's own deterministic
  addresses, and their paths are the same on both sides. There are no thread ids, times or host addresses.
- **Root's triage note** (`docs/next.md:516`): it is right about `rust-log.rs`, which is deterministic and prints the interner
  counts and about 15k steps. It leaves out the `run-pass-miri` case, which has the same profile (N3). Line 510's explanation of the
  unprotected `mono-ui` DIFF matches the gate's first difference: line 11, the filter warning, which the port does not print there
  because `mono-run.ts` never starts the logger.

## 4. Retries and margins

`retryTimes` holds the same 8 cases as last gate (`mir` 4, `run-pass-miri` 4). The pool attempts hit 60 s wall at 33-42 s of user
time, which means contention.

| Suite (limit) | Case | Protected | Gate, alone | My run, alone | Last audit |
|---|---|---|---|---|---|
| `run-pass-miri` (60 s) | `drop/dynamic-drop.rs` | yes | 37.1 s (**61.8%**) | 34.9 s (58.2%) | 36.8 s (61%) |
| `run-pass-miri` (60 s) | `threads-sendsync/issue-8827.rs` | yes | 35.8 s (**59.7%**) | 35.2 s (58.7%) | 36.0 s (60%) |
| `run-pass-miri` (60 s) | `moves/move-3-unique.rs` | yes | 25.3 s (42%) | | 25.3 s |
| `mir` (60 s) | `type-alias-impl-trait/hkl_forbidden.rs` | yes | 19.9 s (33%) | | 20.1 s |
| `run-pass-miri` (60 s) | `array-slice-vec/repeated-vector-syntax.rs` | yes | 18.9 s (32%) | | 19.0 s |
| `mir` (60 s) | `error-tainting-issue-122904.rs`, `recursive-drop-elaboration.rs`, `-2.rs` | no (not in `mir.txt`) | timed out again | | same |

Both near-limit cases are unchanged from the last audit, to within 0.3 s in the gate. My quiet runs came in 0.6 to 2.2 s lower.

**`perf-heavy`'s element sharing (`90fad7d0`)** changed no protected case's time noticeably:
- every heavy case is 0.98-1.07x the last gate (`task-comm-6.rs` 151.9 to 150.2 s of 1,800; `consistency_sc.rs` 39.5 to 39.8 s);
- the retried cases are the same to within 0.3 s;
- each suite's wall time is 0.77-1.13x the last gate's (`parse-ui` the highest, 101 to 115 s, at a load of up to 58);
- all suites together took 10.88 h, against 11.21 h last gate.

The two `run-pass-miri-heavy` cases that hit 1,800 s are unprotected, as before. The highest RSS is `rmeta-core` at 10,822 MB of
12,288 (88%, up from 10,498), and `check-core` is at 10,414 MB. `heavyErrors` are empty.

## 5. Power and host: AC throughout

| Check | Result |
|---|---|
| `host.allowBattery`, `host.powerLost` | false, `[]` |
| Samples | 177, all `AC Power`, none with a missing reading; charge 100% throughout; largest gap 660 s; 14:16:45Z to 01:30:59Z |
| `hostStart`, `hostEnd` | AC at both marks of all 60 suites; suites run in order with no overlap |
| `pmset -g log` (independent) | No `Using Batt` from 16:00 +0200 on Nov 7 to 03:40 +0200 on Nov 8, which covers the gate window of 16:16 to 03:31 local. The last battery entry is Nov 7 00:46 +0200. No sleep, wake or shutdown entries in the window, and no reboot since 2026-11-04. |
| `note:` lines | 3, all known: `mir` 4 subject timeouts (1 finished alone, 3 not, all unprotected); `miri-pass` 1 `UNSTABLE` (`panic1.rs`); `run-pass-miri` 4 timeouts, all 4 finished alone. No stuck host reader, no power line, no RSS-over-budget note. |

## 6. Static steps: all ran on `2e8c1b98`

`head` is `2e8c1b98`, `dirty` is `[]`, `staticOk` is true and `skipStatic` is false. The steps run one after another
(`gate.ts` `staticChecks`), before the first suite started at 14:38:07.9Z.

| Step | Result |
|---|---|
| typecheck | ok (log) |
| unit tests | ok: 7,388 tests, 0 failures, 1 skipped (allowlisted). **1,226.3 s of 1,800 s (68.1%)** by junit, about the same as 1,225.6 s and 1,231 s. It began at a load of 19.7 that fell to 3.5 within 10 minutes, so this was not a quiet start. Junit written 14:37:19Z. |
| runner unit tests | ok: 394 tests, 0 failures, 0 skipped; 46.6 s; junit written 14:38:06Z |
| skips | 1 allowed and 0 unexpected in the unit step, 0 in the runner step, under `RUST_TS_REQUIRE_PROBES=1` |
| markers | ok (log). My rerun: `markers ok (24882; vendor 5286; library 606)`, 1.9 s |
| **marker order** | ok (log). **Independent evidence:** the step writes `$RUST_TS_DATA/coverage-order.txt`, and that file was stamped 14:38:07Z, between the runner junit and the first suite. My rerun gives `order: no inversions under src/rustc_monomorphize/` in 0.2 s and rewrites the file byte-identically. |

## 7. Root's numbers

| Figure | Claimed | Recomputed | |
|---|---|---|---|
| Protected total | 542,089 | 542,089 | ok |
| Suites | 60 | 60 | ok |
| Gain | +3, 0 lost | +3, 0 lost | ok |
| Coverage | 24,279 / 27,053 (89.7%) | `coverage.ts`: 24,279 / 27,053, 89.75% | ok |
| Miri | 1,506 / 1,535 | 1,506 / 1,535 (98.1%) | ok |
| `run-pass-aux-miri` | 356 of 356 | 356 / 356; still 32 that match an expected Miri error or panic (`rust-log.rs` exits 0) | ok |
| `run-pass-miri` + heavy | 3,474 of 3,478 | 3,468 + 6 of 3,470 + 8 | ok |
| `miri-pass` + heavy | 350 of 360 | 345 + 5 of 360 | ok |
| Masked cases | 24 | 24 (the 3 add none) | ok |
| **`mir-o2` (README table)** | **3,474** | **3,475** | **N1** |
| `mono-ui`, `mir-opt-o4`, `check-rg*`, all other rows | as README | equal to the baselines | ok |

`scripts/criteria.ts --run gate-20261107-141645-root-lspa` (exit 1, from `ir-hello` alone):

| Group | `criteria.ts` | Threshold |
|---|---|---|
| M6b run-pass | 3,474 / 3,478 = 99.88%, met | 90% |
| M6b run-fail | 294 / 294 = 100%, met | 90% |
| M6b miri-pass | 350 / 360 = 97.22%, met | 80% |
| M7a ir-hello | not met: "ir-hello: not in this gate" | 100% |
| M7a mir-o2 | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a mono-ui | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a check-rg | 34 of 34 crates, met | 33 |

These match `docs/next.md`'s accept line: mir-o2 and mono-ui at 99.89%, check-rg 34 of 34, and ir-hello not yet in a gate.

## What I did not check

- **Protected cases other than the +3 and the two near-limit cases** were not re-run. Their status comes from the gate's jsonl. Their
  oracle entries are as cached, and none was re-keyed.
- **Margins of cases that never timed out** in other suites. A non-heavy case records a time only when it is retried.
- **Port correctness of the wave's code.** That belongs to the lanes' reviews (fixers-45, fixers-46, harness-w43,
  object-write-macho, perf-heavy). I read only the harness, script and test diffs and the `RUSTC_LOG` mechanism.
- **Typecheck and the unit steps** were not re-run; I rely on the gate's log and junit.
- **`info_sites_check.ts`**, the report-only suites and `ir-hello` were not run.
- **The gate's argv.** It is not recorded; I checked the suites that ran instead.
- **Side effects in `$RUST_TS_DATA`.** These are report files only, and nothing compared reads them:
  - my key dump called every suite's `cases()`, which touches the mtimes of cached aux directories (`touchAuxDir`); no aux build ran;
  - `coverage.ts` rewrote `coverage-order.txt` (byte-identical) and `coverage.json`;
  - the typemap regeneration rewrote 10 `codegen/*.types-report.json` files.
  No oracle cache entry was written.
