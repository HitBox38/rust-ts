PASS WITH NOTES

**Wave 40a's accept stands.** Nothing protected was lost, tampered with or hidden, and each figure below was recomputed from
the raw jsonl, git and the oracle cache. All six notes are low severity: two wrong figures in the docs, one incomplete scope
record, and three things the figures leave out. None of them reverses the verdict.

Regression audit, 2026-11-06. Gate `gate-20261106-073703-root-u0z2`, tested `529807e7`, accepted `d51089a3`; the previous
gate is `gate-20261105-081912-root-ygiz`. No gate or full suite was run. What did run: 46 subject processes and 24 oracle
processes, one at a time; a scan of the oracle cache; a key dump at two commits. Code was read only, apart from one mutation
in a throwaway scratch copy. The laptop was on battery, so no timing here comes from this audit's own runs.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | low | README's `pm-ui` / `pm-expanded` row says 279 / 280. Both are 281: both suites grew in this accept and the row was missed. Every other README figure agrees. | `README.md:37`; `harness/baseline/pm-ui.txt`, `pm-expanded.txt`; item 7 |
| N2 | low | `docs/next.md` heads the wave "ACCEPTED 2026-11-07". The accept was on 2026-11-06: 19:16 UTC, 21:16 local. | `docs/next.md:472`; `history.jsonl:638`; `d51089a3`'s date |
| N3 | low | The scope decision names 5 suites left out of the gate. 8 were: also `parse-ui-json` (991 cases), `check-core-bin` and `check-chain` (1 each). None of the 8 has or ever had a baseline file, so nothing protected hides there. | `history.jsonl:637`; item 5 |
| N4 | low | `gate.json`'s `host` missed a 10 s spell on battery during `expanded`, because the poll is 60 s. It had no effect, but "records the power source through the run" (AGENTS.md section 2) holds only down to a poll. | `pmset -g log`; item 4 |
| N5 | low | README's "byte-for-byte" has an exception: exactly 24 of the 541,731 protected cases match only through a mask, as the digits of a thread id or long-type hash cannot be reproduced. The wording may want a footnote. | item 3 |
| N6 | low | `supertrait-hint-cycle.rs` at `-Zunpretty=mir` is now compared by nothing, and `mir-heavy`'s oracle has never run (no cache entry). It timed out before, so no comparison was lost. One report run is worth doing on AC with 16 GB free. | item 2 |

## 1. Protected set: nothing lost, all totals agree

Each figure is recomputed from `git show` of each baseline at both commits and from each suite's raw jsonl.

| Check | Result |
|---|---|
| `git diff --numstat 1adcee8e d51089a3 -- harness/baseline` | 13 files, **+98, -0** |
| Baseline files | 59 at `1adcee8e`, `529807e7` and `d51089a3`; none added or removed |
| Baselines between `1adcee8e` and `529807e7` | identical to `1adcee8e` in all 59: nothing touched them before the gate |
| Unique ids in the baselines | 541,633 to **541,731**; no duplicates |
| Added ids against `gate.json` `gained`, per suite | identical in all 13 suites (15, 16, 14, 1, 1, 2, 6, 6, 2, 2, 2, 15, 16) |
| `gate.json` `baseline` against the file at `1adcee8e` | equal in all 59; sum 541,633, `lost` 0, `lostSkipped` 0 |
| Every id at `d51089a3` against the raw `<suite>.jsonl` | **541,731 of 541,731 `MATCH`**; none missing |
| `MATCH` rows not in the baseline | 0 |
| jsonl rows against `gate.json` `total`, `match` | equal in all 59 |
| `history.jsonl:638` `protected`, `total` against the above | equal in all 59 |
| `docs/state/current.json` protected sum | 541,731 |
| Suites in the gate against baseline files | 59 of 59, both ways; no `notRun`; `skipStatic` false |
| `d51089a3`'s parent and contents | parent `529807e7`; 13 baselines, `current.json`, `history.jsonl`, nothing else |
| `dirty`, `unstableOk`, `upstreamOk`, `pass` | `[]`, true, true, true; 0 `ERROR` lines in `.data/tmp/gate-w40.log` |

## 2. Expectation tampering: none

`git diff 93cab6b7 529807e7` changes no baseline, `harness/scope.json`, `harness/corpus`, `UPSTREAM.json` or `tools/probes`.

**Oracle keys.** I dumped every case's key from `93cab6b7`'s `harness/` and `scripts/` and from this tree, and compared them
with the cache entries' times.

| Suite | Keys changed | Oracle re-run? |
|---|---|---|
| `parse` | **21,523 of 21,523** (`RUSTC_ICE=0` joins the key) | Yes: 685 entries written in the wave, 20,838 during this gate (13:15-13:52 UTC). **All 21,523 are identical to the old-key entries**, which still exist, so the change altered no output. |
| `ir-hello` | 2 of 2 (`ir-normal.ts`'s text is in its key) | Yes; written in the wave. Not protected. |
| every other suite | 0 | Reused, correctly. |

Four cases have no key any more: `parse`'s 3 and `mir`'s 1, below. One is new: `mir-heavy`'s, with no entry. The mask freed 50
entries that used to be uncached (`mir` 14, `thir-tree` 9, `tydump-ui` 8, `thirdump-ui` 8, `mirdump-ui` 4, `mir-o2` 3, `pm-ui` 2,
`pm-expanded` 1, `miri-pass` 1); each was written in the wave with its key unchanged. I re-ran the oracle on the 24 of these that
are now protected: **24 of 24 equal the cached entry once masked, and 0 of 24 equal it raw**, so the entries are real and the
mask is needed.

**Thread-id and long-type masks.** Read at `scripts/lib/unstable.ts:46-103`. They apply to stderr only, on both sides, and to digits only:
the id in a line-anchored `thread '<name>' (<digits>) panicked`, and the digits in `.long-type-<digits>.txt'`. A literal `<tid>` or
`<hash>` gets one more `<`, so it cannot equal a masked value. Cached text and diff bodies stay raw. A Miri suite masks the thread id
only for the host's `thread 'rustc'` under an ICE. Item 3 gives what they reach.

**`parse` skips.** All 3 were `ORACLE_TIMEOUT` in the last gate and in that gate's `oracleTimeouts`. None was ever in `parse.txt`.
Each stays protected in other suites, unchanged by this accept: `issue-93775.rs` and `expr-stack-overflow.rs` in 5 suites each,
`survive-peano-lesson-queue.rs` in 6, all including `mir`. The `parse` denominator falls by 3 and no figure moves: ORACLE_TIMEOUT
was already excluded. They appear in `parse.skipped.jsonl` with their own reason.

**`supertrait-hint-cycle.rs`.** Status in `mir` last gate: `TIMEOUT`, retried. It was never in `mir.txt`, so its move lost nothing.
It stays protected in the same 15 other suites, including `parse`, `hir-tree` and `tydump-nocore`. `MIR_HEAVY`'s rule is the oracle's
cost, not the port's, and the reason cites `docs/handoff/perf-near-limit.md:39,57`. A longer limit does no harm while `mir-heavy` has
no baseline. See N6.

**`--preload` (`b3c9f0a6`).** It changes `miriSubjectOf` alone, and only for Miri's driver entry; the subject's command is read by
no key (0 Miri keys changed above). It cannot make a comparison pass by itself: output is still compared whole, and the gate ran
with it. The re-exec passes the raw argv on (`src/rust_ts/stack.ts:170,184`), so the child keeps the flag, and `process.execArgv` is
not read there. `miri.test.ts` now also pins that the preload file exists.

**`plain_bug` and `take_hook` (`6f7208d9`).** Test only, except `run_compiler`'s `finally`, which restores `EMIT_BUG_DIAGNOSTIC` as it
restores `DEF_ID_DEBUG`. The tests kept their message assertions; `plain_bug` turns off the emit that upstream's path now takes, so they
read the same strings as before. The real emit path is exercised by the ICE cases, which match: 16 of the 18 thread-id cases print
`error: internal compiler error`. `take_hook` is called only from
`miri.test.ts`. `root-w40-check3` N1 (five assertions that keep their message only by accident) is queued in `docs/next.md`.

**Unit-test skip allowlist.** `ALLOWED_SKIPS` is untouched by the wave; its one entry, the Linux-only
`read_binary_file_handles_lying_stat`, is the one test that skipped (junit). The `skipIf`s the wave adds are platform or missing-probe
guards, and the gate rejects a skip under `RUST_TS_REQUIRE_PROBES=1` that is not allowlisted: 0 such.

**Removed test lines.** `scripts/miri.test.ts`, `scripts/unstable.test.ts`, `scripts/lib/env.test.ts`, `harness/pm.test.ts` and
`harness/miri-ui.test.ts` lose assertions about the removed `UNSTABLE` lists and `unstableMiriOracleReason`. The mask has its own
`scripts/lib/unstable.test.ts` (153 lines), and `protectedUnstable` is still tested on `miri-pass`. `coverage.ts --check` gains checks
and loses none.

## 3. The +98: 74 real matches, 24 through a mask

| Group | Cases | Before | Depends on |
|---|---|---|---|
| `DiagLocation Display` | **74** in 6 suites: `expanded` 16, `unpretty-expanded` 16, `expanded-nocore` 15, `unpretty-expanded-nocore` 15, `resdump` 6, `resdump-nocore` 6 (16 files) | all `UNPORTED` at `std::panic::Location::caller (DiagLocation Display)` | **no mask** |
| Thread id | **18**: `mir` 14, `pm-ui` 2, `pm-expanded` 1, `mirdump-ui` 1 (17 files) | `UNSTABLE`, never compared | `maskThreadId` |
| Long-type hash | **6**: `tydump-ui`, `thirdump-ui`, `thir-tree`, 2 each (2 files) | `UNSTABLE`, never compared | `maskLongTypeHash` |

That is 98 cases, 35 distinct files (16 + 17 + 2) and 13 suites. Each case's previous status comes from the last gate's jsonl.

**The port fix behind the first group.** All 74 oracle outputs print a delayed bug's location, such as `delayed at
/rustc-dev/6f5da406.../compiler/rustc_attr_parsing/src/attributes/macro_attrs.rs:94:51`. The port used to stop at `unported` there; the
ICE report's port (`d784e0c2` and its follow-ups) resolves it to upstream's line and column. A wrong line would show as a difference,
as this line is compared raw.

**The 74.** None of their oracle entries has a thread line or a long-type note, so neither mask changes the oracle's text. A masked
subject cannot equal it unless it is byte-identical. I re-ran 22 of the 74 (`expanded` 16, `resdump` 6): raw-identical, 22 of 22.

**The 24.** All re-run, against the cached oracle:

- 24 of 24 `MATCH` once masked; 0 of 24 raw.
- Every differing line, checked by program, differs only in the masked digits, and in no more lines than the oracle has of them (1 or 2).
- Example: `thread 'rustc' (32079056) panicked at /rustc-dev/6f5da406.../check_packed_ref.rs:51:17:` against `(85287)`, the rest equal.

**Could a mask hide a real difference here?** Only in those digits:

- A thread id is the OS's and differs between two runs of the oracle itself; the 24 fresh oracle runs show it.
- `pm-ui`'s `thread '<unnamed>'` is a real proc-macro thread, with the same answer.
- The long-type digits hash an interned type's address. The mask gives up whether two notes name one file; each of the 6 cases has
  one note (one differing line), so nothing is given up here.

**How far the masks reach, across everything protected.** A scan of each protected case's oracle entry: 369,748 entries, and the other
171,983 ids are split suites' sections, which are stdout hashes, never masked. **The masks change exactly 24 entries, and they are the
24 above.** No Miri protected entry is touched: 312 of them hold a thread line and keep it compared. N5 follows from this.

`plan-m7.md:158,527` already plans the mask for native programs, so that warning from `docs/handoff/harness-w40.md` is tracked.

## 4. Battery: no effect, and one short spell nobody saw

| Check | Result |
|---|---|
| `hostStart`, `hostEnd` | Coherent: 59 suites in order, none overlapping, each start at or after the last end |
| Power at the marks | AC at both ends of the first 58 suites; `miri-pass-heavy` starts on AC and ends on battery |
| `host.powerLost` | 1: first seen 19:14:05.556 UTC at 100%; `allowBattery` false |
| Samples | 178; none without a reading; largest gap 10.97 min; no restart or sleep in them |
| `pmset -g log` (independent) | Battery from **19:13:44 UTC**, 12 s after `miri-pass-heavy` started at 19:13:32; `check-rg-host` had ended on AC |
| Same log, earlier | **One more spell: 15:57:29-15:57:39 UTC, 10 s**, with `PowerChime`'s attach at the end, inside `expanded` (15:16-16:01). Not in `gate.json` (N4) |
| `expanded` in that spell | 21,523 of 21,523, `retried` 0, no `TIMEOUT` |

`pmset` logs these lines on an assertion change, so it could miss a spell too. The gate's own poll saw nothing else.

**`miri-pass-heavy`, the suite that crossed over:** statuses identical to the last gate on all 8 cases: 5 `MATCH`, 3 `UNPORTED` (exit
70 in 1.5-2.2 s). Walls against the last gate: 24.6 / 25.7 s, 43.3 / 42.2 s, 29 / 29.3 s, 23.6 / 24.2 s, 1.6 / 2.1 s. The slowest protected
case used 2.4% of its 1,800 s limit, so 3.5x would change nothing. Total 128 s against 131 s.

**Retries.** `retryTimes` has all 8 retried cases. The pool attempt hit 60 s wall on 33-42 s of user time, which is contention (12 CPUs,
load up to 70). The re-runs came after the pool, at load 7 and 3 at the suites' ends.

| Suite (limit) | Case | Protected | Alone, wall | % of limit | Alone, user |
|---|---|---|---|---|---|
| `run-pass-miri` (60 s) | `drop/dynamic-drop.rs` | yes | 37.4 s | **62%** | 44 s |
| `run-pass-miri` (60 s) | `threads-sendsync/issue-8827.rs` | yes | 35.7 s | **60%** | 41.4 s |
| `run-pass-miri` (60 s) | `moves/move-3-unique.rs` | yes | 24.9 s | 42% | 28.8 s |
| `mir` (60 s) | `type-alias-impl-trait/hkl_forbidden.rs` | yes | 20.1 s | 34% | 23.8 s |
| `run-pass-miri` (60 s) | `array-slice-vec/repeated-vector-syntax.rs` | yes | 18.9 s | 32% | 23.1 s |
| `mir` (60 s) | `type-alias-impl-trait/error-tainting-issue-122904.rs` | no | 60.1 s, timed out | over | 65.7 s |
| `mir` (60 s) | `type-alias-impl-trait/recursive-drop-elaboration.rs` | no | 60.1 s, timed out | over | 65.6 s |
| `mir` (60 s) | `type-alias-impl-trait/recursive-drop-elaboration-2.rs` | no | 60.1 s, timed out | over | 65.7 s |

**No protected case survives at a thin margin.** The closest two have about 38-40% left, and all five were protected before this wave.
`mir`'s retries fell from 14 last gate to 4, against a cap of 50, and `run-pass-miri`'s stay at 4. The 3 timeouts are not losses.
`docs/next.md`'s "63-66%" for the top two is a little above these figures, which is the safe direction.

**Heavy suites.** No protected heavy case uses more than 8.4% of its limit: `task-comm-6.rs`, 150.9 of 1,800 s, is the highest. RSS can't fail a
gate; the highest is `check-core` at 11,047 MB of 12,288. The two `run-pass-miri-heavy` cases at 1,800 s are unprotected, as last gate.

**Other suites' times** are 0.75-1.20x the last gate, except `hir-tree` (0.32x) and `mir` (0.37x), which last gate ran on battery
(`scripts/lib/host-state.ts:1-3`). Nothing there suggests another slow period.

## 5. Unrun and report-only suites, and the static steps

| Suite | Cases | Baseline file now or ever | Named in root's scope decision |
|---|---|---|---|
| `miri-fail` | 610 | no | yes |
| `miri-pass-tb` | 132 | no | yes |
| `run-pass-aux-miri` | 356 | no | yes |
| `mir-heavy` | 1 | no | yes |
| `ir-hello` | 2 | no | yes |
| `parse-ui-json` | 991 | no | **no** (N3) |
| `check-core-bin` | 1 | no | **no** (N3) |
| `check-chain` | 1 | no | **no** (N3) |

The other 59 ran. The same 7 older suites were also out of the last gate, which ran the same 59. **Nothing protected-looking hides here:**
the gate protects by baseline file, and `git log --diff-filter=D` finds none of these ever removed.

**Static steps, all on `529807e7`** (`gate.json` `head`, `dirty: []`, `staticOk`, `skipStatic` false), and all before the first suite at 07:57:38 UTC:

| Step | Result |
|---|---|
| typecheck | ok (log) |
| unit tests | ok: 7,348 tests, 0 failures, 1 skipped (allowlisted); junit written 07:57:07 UTC |
| runner unit tests | ok: 359 tests, 0 failures, 0 skipped; 07:57:37 UTC |
| skips | 1 allowed, 0 unexpected, under `RUST_TS_REQUIRE_PROBES=1` |
| markers | ok (log) |

**The unit step stayed under its limit:** 1,196.9 s by junit against 1,800 s (66%), at a load near 4. As `docs/reviews/m6-audit.md` F8
warned, anything running alongside could use that margin up.

## 6. The four commits with no separate review: none changes behaviour or weakens a test

All four are ancestors of `529807e7`.

| Commit | Contents | Verdict |
|---|---|---|
| `40d11aef` | `gate-power.test.ts` +7, `host-state.test.ts` +3 -1, `docs/next.md`, state. No code outside tests. | Strengthens. See below. |
| `1545921a` | One comment rejoined in `interface.ts`. | No behaviour. |
| `36439b76` | `take_hook` moved to upstream's order and given upstream's panic; one test assertion stronger; a comment. | No behaviour in a real run. See below. |
| `07917315` | One comment in `interface.ts`, stating that `TRACK_FEATURE` stays. | No behaviour; true per `root-w40-check3` N3. |

**C1, by mutation.** In a scratch repository at `529807e7`, the new test passes. With `gate.ts:363` changed to `firstOnBattery: undefined`
it **fails**, as the commit claims: `Received: "ok    power-stub ... gate PASS ..."`, no power-lost note. So the gap
`root-w40-check2` C1 reported is closed.

**C2.** An empty marker now gives pid 0 and the loop tries again. A shell that never starts still reaches `throw`, so a real failure
still fails. Not weakened.

**`take_hook`.** Upstream `library/std/src/panicking.rs:179-185` has the same check and message. The marker's line is right, and order
is upstream's (`take_hook` 179, `update_hook` 219). Its only caller is `miri.test.ts`'s `afterAll`.

**`matches_b.test.ts`.** `toBeInstanceOf(Error)` became `toBeInstanceOf(Panic)` plus the message. That message is upstream's,
`builder/matches/mod.rs:2763`. Stronger.

## 7. Root's numbers

| Figure | Claimed | Recomputed | |
|---|---|---|---|
| Protected total | 541,731 | 541,731 | ok |
| Suites | 59 | 59 | ok |
| Gain | +98, 0 lost | +98, 0 lost | ok |
| Distinct files, suites | 35, 13 | 35, 13 | ok |
| Coverage | 24,245 / 27,053 (89.6%) | `coverage.ts`: 24,245 / 27,053, 89.62% | ok |
| Miri | 1,504 / 1,535 | 1,504 / 1,535 | ok |
| `rustc_middle`, `rustc_mir_dataflow` | 92%, 92% | 92.1%, 92.1% | ok |
| `tydump-ui` / `thirdump-ui` | 1,842 / 1,853 | same | ok |
| `mirdump-ui`, `mir`, `thir-tree` | 1,344, 21,522, 1,851 | same | ok |
| `parse` / `parse-ui` | 21,523 / 991 | same | ok |
| `mir-o2` / `mir-opt-o4` / `mono-ui` | 3,474 / 405 / 3,475 | same | ok |
| `mir-core`; `check-core` / `rmeta-core` | 47,734; 1 / 82,338 | same | ok |
| `rmeta-alloc`, `mir-alloc`; `rmeta-std`, `mir-std` | 14,678, 3,734; 18,196, 5,204 | same | ok |
| `check-rg` modes; `check-ui-encode-mir` | 36 / 36 / 36; 146 | same | ok |
| **`pm-ui` / `pm-expanded`** | **279 / 280** | **281 / 281** | **N1** |
| Wave date in `docs/next.md` | 2026-11-07 | 2026-11-06 | **N2** |

`scripts/criteria.ts --run` prints the following, recomputed from `gate.json`:

| Group | `criteria.ts` | From `gate.json` | Threshold |
|---|---|---|---|
| M6b run-pass | 3,473 / 3,478 = 99.86%, met | 3,467/3,470 + 6/8 | 90% |
| M6b run-fail | 294 / 294 = 100%, met | 294/294 | 90% |
| M6b miri-pass | 350 / 360 = 97.22%, met | 345/352 + 5/8 | 80% |

These match README's `3,473 of 3,478`, `294 of 294` and `350 of 360`. `pm-ui`'s own criterion, 95%, stands at 281 / 282. It is in no
`criteria.ts` group.

## What I did not check

- **The other 52 of the 74** were not re-run. They rest on the gate's `MATCH` and on their oracle entries holding nothing a mask reads.
- **Protected cases outside the +98** were not re-run. Their status is the gate's jsonl.
- **Oracle entries.** Only the 24 were re-run fresh, plus `parse`'s old-against-new comparison. Older entries I took as they stand.
- **Port correctness of the wave's code.** That belongs to the lanes' reviews; I read only the commits named above and the harness diff.
- **Measured claims not re-measured:** `parse`'s 3 not finishing in 1,500 s (I saw only their `ORACLE_TIMEOUT` status), and the oracle's
  59-68 s and 11.6 GB on `supertrait-hint-cycle.rs`.
- **The report-only suites' current results.** They did not run in this gate and I did not run them.
- **Typecheck and markers** were not re-run; I rely on the gate's log.
- **Margins of cases that never timed out.** A non-heavy case records a time only if retried, so a protected case at 55 s that finished
  in the pool shows nothing.
- **Long-type files.** The 6 long-type cases write or try to write a file; compared here is only the note, not any such file.
