PASS WITH NOTES

**Wave 40t's accept stands, and so does M7.** No protected case was lost or tampered with. All 71 suites ran. I checked each of the
556,212 protected ids in the 67 `harness/baseline/*.txt` files at `cc7f52fa` against this gate's jsonl. Every one is `MATCH`.

The accept commit (`4a3ffbf8`, parent `cc7f52fa`) only adds ids:
- four new baselines: `pm-self` 282, `rg-behaviour-rgtest` 324, `rg-behaviour` 63 and `rg-build` 1;
- four grown ones: `ir-run-pass` +8, `ir-run-pass-o0` +8, `ir-host` +1 and `run-pass-native` +1.

That is 688, which equals `gained`. Each baseline at `4a3ffbf8` is exactly its suite's MATCH set in this gate, and each added id is in that
suite's `gained` list. 556,212 + 688 = 556,900.

**The only removals ever made from a baseline are root's four withdrawals.** They are `yield1.rs`, `task-comm-0.rs`, `comm.rs` and
`unwind-resource.rs` (`864a37a1`, `a4a98609`). Each is listed in `NATIVE_UNSTABLE`, and this gate scored each as UNSTABLE, not lost.

**The M7d MATCHes are real.**
- **`rg-build`:** every one of the 53 compiler calls of ripgrep's release build went to the port's binary, which this tree builds.
- **`rg-behaviour` and `rg-behaviour-rgtest`:** they ran the `rg` that build made. Its key recomputes from `cc7f52fa` (N2, N3).
- **`pm-self`:** the port rebuilt every aux directory in this gate.

`scripts/criteria.ts --milestone M7` exits 0 with M7a, M7b, M7c and M7d met.

**Power:** AC throughout. **Load:** the host was much busier than in 40s. That caused six more solo retries, all protected. Each finished
alone and matched (N1).

Regression audit, 2026-11-15:
- **This gate:** `gate-20261115-141315-root-qswd`. Tested `cc7f52fa`, accepted `4a3ffbf8`, `RUST_TS_SUBJECT=binary`, Bun 1.4.4.
- **Previous accept:** wave 40s, gate `gate-20261115-021222-root-rgng`. Tested `da1c0393`, accepted `5195eab9`.
- **The stopped run** `gate-20261115-120314-root-r1gc`, on `612ed4a1`, has no `gate.json` (N8).

I ran no gate, no difftest and no full suite. What I ran:
- **Rows:**
  - every row of the 114 common jsonl files against 40s's, on every field;
  - every baseline id at `cc7f52fa` (`git show`) against this gate's jsonl;
  - every baseline at `4a3ffbf8` against its suite's MATCH rows and `gained`;
  - the six files of the new suites.
- **Records:** `gate.json`, the accept, milestone and decision entries of `history.jsonl`, both gate logs (`.data/tmp/gate-w60.log` for the
  stopped run, `gate-w60b.log` for this one), the summaries and the three junit files.
- **The ripgrep suites:**
  - the kept build trees and call logs (`.data/ripgrep/kept/rg-build/{oracle,subject}{,-logs}`);
  - the kept binaries and stamps (`bin/{oracle,subject}/<key>`);
  - the rgtest run directory and both libtest outputs;
  - rg-build's cached oracle report.
- **pm-self:** the 282 aux directories under `.data/pm-self`, hashed against the oracle-built aux under `.data/aux/ui`.
- **Oracle cache:** every entry written during the gate, found by mtime.
- **Keys:**
  - both subject-bin keys, recomputed from a `git archive` of `cc7f52fa`;
  - both `rgBinKey`s, recomputed in this worktree, whose `src/` tree equals `cc7f52fa`'s (`07fa9333`).
- **Diffs:** `git diff da1c0393 4a3ffbf8` over `harness/`, `scripts/` and `tools/`. Importers of the new `src/` code.
- **Power:** `gate.json` samples and `pmset -g log`.
- **Criteria:** `bun scripts/criteria.ts --run gate-20261115-141315-root-qswd --milestone M7`.

AC power throughout my work (`pmset -g batt`), and `RUSTUP_AUTO_INSTALL=0`. No gate was running (no `.data/tmp/GATE_RUNNING`). I
changed no code.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | low | **A busier host than 40s, with six more retries. No protected case was lost to it.** <br><br> **Load** (1-min, kept samples, 40s → 40t): median 58.9 → **72.4**, p90 92.7 → **203.6**, max 148.4 → **256.5**. Samples above 150: 0 → **33**. Swap 5.9–7.8 → **5.4–8.1 GB**. The peak sample is at 15:16:05Z, the `ir-host`/`ir-run-pass-o0` edge. <br><br> **The kept record is sparse.** `HostLog` polls every 60 s but keeps a sample only every `keepEveryMs`, at suite edges and on a power change. That is 168 kept samples, with 50 gaps over 120 s; the longest is 660 s. So the ~290 seen during `resdump` falls between kept samples. The kept samples of `resdump-nocore` and `resdump` (16:36–17:54Z) reach 208, with 5.9–6.1 GB of swap. <br><br> **No case in any front-end suite retried or timed out except in `mir`**, and every front-end row equals 40s's apart from `attempts` (§1). **18 solo retries (40s: 12):** `mir` 6, `run-pass-miri` 9, `miri-pass` 2, `run-fail-miri` 1. All 18 are protected, all finished alone and all MATCH. The slowest alone was `dynamic-drop.rs` at 38.8 s, with 21.2 s left of the 60 s limit; none is above 45 s. Pool load at those timeouts was 61–241. <br><br> **The six new retries** are `mir` `infinite_loop.rs` and `projection-cache-rematch-impl-141124.rs`, `miri-pass` `float.rs` and `nested_panic_caught.rs`, `run-fail-miri` `panic-in-ffi.rs`, and `run-pass-miri` `macro-comma-support-rpass.rs#core`. These are known borderline cases. The first five retried in 9 of the 13 earlier gates since 11-10 that ran them, 2 or 3 of them per gate, and `#core` retried in 40r. <br><br> **Total suite time** 22,607 → 25,186 s (+11%), including the 460 s of the new suites. I found no other run directory and no tree commit in the window, so the record does not say where the extra load came from. | `gate.json` `host`, `retryTimes`; jsonl `attempts` across `.data/runs/gate-2026111*` |
| N2 | info | **`rg-build`: what was compared, and that the port made every compile.** <br><br> **The report** (757 lines, from the cached oracle side) holds: <br> - cargo's exit; <br> - `rg built`, and `rg --version`'s exit and streams; <br> - **53 call lines**, sorted: 8 probes and 45 compiles, each with its exit, stdout size and SHA-256, and stderr size and SHA-256; <br> - cargo's stderr, normalised, with its 34 `Compiling` lines sorted; <br> - cargo's stdout hash; <br> - **556 artifact names**; <br> - **75 byte hashes:** 45 dep-info files and the 10 build scripts' `run/{stdout,stderr,root-output}`. <br> Objects, rlibs and binaries are compared by name only (plan-m7 D2). What `rg` does is `rg-behaviour`'s and rgtest's job. <br><br> **The calls:** both kept call logs have 53 calls with the same (kind, crate, `-C metadata`) set. Every subject call exits 0, and none has `unported` in its stderr. <br><br> **Every call went to the port.** `rg-build-rustc.ts` spawns `[...RGB_COMPILER, ...args]` for every call. It has no other branch, and nothing is appended. The suite's subject compiler is `rgCompiler("subject")`: the subject binary `.data/subject-bin/5fb6b937…/rts` with `--sysroot <oracle sysroot>`. The binary's key recomputes from `cc7f52fa` (§4). The port would forward to the oracle only under `RUST_TS_IMPL=shim` (`main.ts:20-24`), and difftest sets `RUST_TS_IMPL=port` in the subject's environment (`difftest.ts:570,861`). `rg-build.ts` keeps it, since its scrub list drops only `CARGO_*`, `RUSTC*`, `RUSTFLAGS`-like and `GIT_*` variables. Every summary says `impl: port`. <br><br> **Timing agrees.** The port side took 264 s, 563.7 s user and 5,988 MB; the oracle took 20.8 s and 711 MB. Per unit, by log mtimes, the port took 5–20× the oracle's time on every non-trivial crate: `regex_automata` 40.7 against 2.3 s, `rg` 35.4 against 2.5 s, `serde_core` 17.9 against 1.2 s. Only units under 0.5 s either way are close. <br><br> **Byte-identical artifacts are not a sign of fallback.** 15 of 33 rlibs, 15 of 149 objects, all 33 `.rmeta` and 8 of 10 build-script binaries equal the oracle's. That parity is expected: rmeta is byte-identical since M5, and the IR model's text matches at N1 before the same pinned LLVM. `serde_core`'s rlib is identical, yet the port took 15× as long to make it. 18 rlibs, 134 objects, 2 build scripts (`serde`, `serde_core`) and `rg` differ. The port's `rg` is 7,073,200 bytes, the oracle's 6,624,384. The oracle is reproducible: its `rg` under keys `8766cf8d…` (10:38Z) and `0c4d288e…` (21:17Z) is the same file, sha1 `235673e4…`. | `kept/rg-build/*-logs`; oracle cache `1f75002a…`; `rg-build.summary.json`; `scripts/rg-build{,-rustc}.ts`; `suites.ts` `rgCompiler` |
| N3 | info | **`rg-behaviour` (63/63) and `rg-behaviour-rgtest` (324/324) ran the port-built `rg`, keyed on this tree.** <br><br> **The key:** `rgBinKey("subject", [<5fb6b937…/rts>, "--sysroot", <sysroot>])` recomputes to **`7ea4d5a37ef1e79a`**. Its inputs are `srcState`, which is `HEAD:src` `07fa9333` plus a clean status; `portInputs`; the binary by contents; the rg-build sources; the lock; and the host tools. The oracle key recomputes to **`0c4d288e498ee945`**. Both equal the kept key directories. <br><br> **The build:** `bin/subject/7ea4d5a37ef1e79a/stamp.json` is `ok`, built at 21:21:38.009Z by this gate's rg-build (21:16:52–21:21:38Z). Its `rg` (sha1 `4937f84e…`) equals `kept/rg-build/subject/release/rg`. `rg-behaviour` started at 21:21:38Z. Its first subject case took 1.7 s, so it read the stamp and built nothing. <br><br> **rgtest:** `rgtest-run/run/rg` is that same file (sha1 `4937f84e…`). Both sides' libtest outputs (21:22:25Z and 21:22:28Z) report `323 passed; 0 failed; 0 ignored`, with the same per-test results. <br><br> **The 324 protected ids** are those 323 tests and the header section `integration`, which holds the test binary's exit. ripgrep has 333 `rgtest!`s; 10 are compiled out here (8 `not(target_os = "macos")` in `binary.rs`, 1 in `regression.rs`, and 1 `target_pointer_width = "32"` in `feature.rs`). The test harness is the oracle-built `rgtest-bin/e73b076ddc21301d/integration` (11:05Z), as designed. | `.data/ripgrep/bin`, `rgtest-run`; `scripts/rg-behaviour.ts` |
| N4 | info | **`pm-self` (282/282): the port built every aux crate in this gate.** <br><br> All 282 aux directories under `.data/pm-self` were rewritten between 19:55 and 19:57:30Z, inside the suite's window. With a case lock, difftest runs the oracle, then the subject, under the lock (`difftest.ts:1160-1166`). So each directory holds the subject's output. <br><br> `pm-self-run.ts` empties the directory, then runs every `--step` with `--compiler`, which is `bunCmd(RUSTC_DRIVER_ENTRY)` (the subject binary) on the port's side, and `RUST_TS_IMPL=port`. MATCH means each step's `pm-self: aux <file>: exit 0` line and stderr equal the oracle's. <br><br> **What the port built:** 296 dylibs and 14 `.rmeta`. 281 dylibs and all 14 rmeta are byte-identical to an oracle-built file in `.data/aux/ui`, as in N2. 15 dylibs differ. 216 oracle outputs were computed in this gate; the other 66 hit cache entries under the current key (`pm-self-run.ts` + the oracle's rustc build). | `.data/pm-self`; `scripts/pm-self-run.ts`; oracle-cache mtimes |
| N5 | low | **Comments that say the M7d suites are report-only are now stale, and the suites run in every gate from now on.** <br><br> The gate's default suites are every baseline file (`gate.ts:636`). So every gate will now do a full port build of ripgrep: 264 s and 6 GB here, 4.5 min of the 6 h limit. <br><br> **Stale text:** <br> - `harness/suites.ts:2818`: "All report only: no baseline, so none is in the gate's defaults"; <br> - the `scripts/criteria.ts` header: "only `check-rg` has a baseline, so a gate must name the others with `--suites`"; <br> - the descriptions of `rg-behaviour-rgtest` ("report only") and `pm-self` ("report only, M7d needs 1 MATCH"). <br><br> **Recommendation:** fix them in the next harness batch. | `git show 4a3ffbf8 --stat`; `gate.ts:636` |
| N6 | low | **The harness-m7d re-check's notes did not touch this run.** <br><br> **Note 3, the uncached-error race,** needs a key rebuilt or pruned while a query reads it. Here, rg-build finished before `rg-behaviour` started, and the suites ran one after another. No other run directory was written during the gate. No oracle-cache entry and no jsonl row contains `rg-harness: no result:`, and no ripgrep suite has an UNSTABLE row. <br><br> **Note 2, prune-by-build-date,** never removes the current key. No key was more than a day old: the oldest kept is `bin/oracle/8766cf8d…` (10:38Z), unused. <br><br> **Note 4:** the subject stamp is `ok`. <br><br> **Note 1, the `RGB_TREE` sweep,** kills any process whose `ps -E` line mentions `RGB_TREE=<tree>`. Sweeps ran at the start and end of each side's build, while rg-build held the lock. The gate was alone and load was 2–3 then, so there was nothing to hit. But the suite is now in every gate (N5), so the note's fix should land before gates run beside other agents' work. | `gate.json` suite times; `.data/runs` mtimes; stamps |
| N7 | info | **The four withdrawals.** <br><br> `864a37a1` removes `yield1.rs`; `a4a98609` removes `task-comm-0.rs`, `comm.rs` and `unwind-resource.rs`. Each commit adds the matching `NATIVE_UNSTABLE` entries, and decisions 08:54Z and 11:56Z record them. They were checked in `root-w60-check.md` and `root-w60-recheck.md`. <br><br> **The only other line ever removed from a baseline** is an empty first line of `borrowck-ui.txt` (`90a231db`), so these are the first protected cases withdrawn. **No other baseline changed** between `5195eab9` and `cc7f52fa`. <br><br> **In this gate** all four are `UNSTABLE` with `subject: exit 0`; in 40s they were `MATCH`. `NATIVE_UNSTABLE` now has 22 `run-pass-native` and 7 `run-fail-native` ids. They equal the UNSTABLE rows exactly, and none is protected at `4a3ffbf8`. The M7b/M7c `run-pass-native` figure moves from 3,389/3,396 to 3,386/3,392 (99.82%, 22 unstable excluded). | `git log -p harness/baseline`; jsonl; `NATIVE_UNSTABLE` at `cc7f52fa` |
| N8 | info | **The binaries are the stopped run's, and this tree's.** <br><br> **Both keys recompute from a `git archive` of `cc7f52fa`:** `src/rust_ts/main.ts` **`5fb6b937…`** (2,220 inputs) and `src/miri/bin/miri.ts` **`46743b8c…`** (2,406 inputs). Rebased onto the gate's repo path, each spec equals `meta.spec`, and the inputs, config and runtime C equal `meta.json`. <br><br> **The stopped run built them.** Both were built at 12:03:16–20Z by Bun clone `run-16744`; the stopped run's pid file says 16743, and its log names both hashes. The accepted run (pid 36711, clone `run-36712`) reused them: the key replaces the Bun path with a placeholder. Both runs used Bun 1.4.4, sha1 `7c1f29cd…`. `bunExec` start equals end. `612ed4a1..cc7f52fa` changes only `docs/next.md`. <br><br> **The stopped run's log** has `lost=0` through `mir-opt-o4`, its battery note at 12:50:14Z, and no `gate.json`. | `.data/subject-bin/*/meta.json`; `gate-w60{,b}.{log,pid}`; `gate.json` |
| N9 | info | **Power: AC throughout.** `pmset -g log`: `Using Batt` at 12:49:21Z and 13:19:12Z (the stopped run), then `Using AC (Charge: 54)` with PowerChime's `chimeOnAttach` at 14:12:38Z. That is 37 s before this gate started (14:13:15Z). There is no `Using Batt` after it. All 168 samples and all 71 suites' `hostStart`/`hostEnd` read `AC Power`. `powerLost` is `[]`, and `allowBattery` is false. The battery charged from 54% to 100% during the run. | `pmset -g log`; `gate.json` `host` |
| N10 | info | **The 67 earlier suites' definitions are unchanged, by this gate's own evidence.** Of the 281 oracle-cache entries written during the gate (14:13Z–21:22Z), every one belongs to a new suite: `pm-self` 216, `rg-build` 1, `rg-behaviour` 63 and `rg-behaviour-rgtest` 1. None was written after the gate. So every case of the 67 earlier suites hit the cache under an unchanged key. | oracle-cache mtimes |

## 1. Protected set: nothing lost

| Check | Result |
|---|---|
| Protected ids (`cc7f52fa`) against this gate's jsonl | **556,212 in 67 files, every one `MATCH`**, no duplicate ids. Each suite's `gate.json` `baseline` equals its file's line count |
| `4a3ffbf8` (parent `cc7f52fa`) | Changes `README.md`, `docs/next.md`, `docs/state/current.json` and `history.jsonl` (+1). **Adds ids to eight baselines, removes none**, and touches no other baseline. Each is exactly its suite's MATCH set; its additions are exactly `gained` |
| `gate.json` | `pass: true`, `staticOk`, `skipStatic: false`, `head` `cc7f52fa`, `dirty: []`, `unstableOk`, `upstreamOk`, `staticNotes: []`. 71 suites. Sums: `lost` 0, `gained` 688, `lostSkipped` 0, `oracleTimeouts` 0, `upstreamChanges` 0, batch-only failures and timeouts 0, `retried` 18, `unstable` 30 (1 + 7 + 22). Baseline 556,212, match 556,900, total 557,392. `host.powerLost` `[]`, `allowBattery: false` |
| Gate log (`gate-w60b.log`) | 63 `ok … lost=0 gained=0` lines; `lost=0 gained=<n>` for `ir-host` (1), `ir-run-pass-o0` (8), `ir-run-pass` (8), `run-pass-native` (1), `pm-self` (282), `rg-build` (1), `rg-behaviour` (63) and `rg-behaviour-rgtest` (324). IR tier N1 notes for the four IR suites. Unstable notes for `miri-pass` (1), `run-fail-native` (7) and `run-pass-native` (22). Retry notes for `mir` (6), `miri-pass` (2), `run-fail-miri` (1) and `run-pass-miri` (9), all "finished, 0 timed out again". Then `gate PASS run=gate-20261115-141315-root-qswd`. No `ERROR` |
| `history.jsonl` accept entry (21:23:22Z) | `runId` and `head` match. 71 suites. Each `protected` equals its baseline's line count at `4a3ffbf8` (0 mismatches, sum 556,900). The four IR suites carry `irTier: "N1"`. The milestone entry (21:23:46Z) records M7 done |

**Every row against 40s.** The 114 jsonl files 40s had are all here, with the same ids in the same order. Six new files: `pm-self`,
`pm-self.skipped`, `rg-build`, `rg-behaviour`, `rg-behaviour-rgtest` and `rg-behaviour-rgtest.extra`, the last empty.

| Status (the 114 common files) | 40s | 40t |
|---|---:|---:|
| MATCH | 556,216 | **556,230** |
| UNPORTED | 428 | **410** |
| DIFF | 50 | 50 |
| UNSTABLE | 26 | **30** |
| TIMEOUT | 2 | 2 |
| skipped/extra rows | 6,435 | 6,435 |

**Status moves:**
- `UNPORTED → MATCH` ×18 (§3);
- `MATCH → UNSTABLE` ×4, the withdrawals (N7).

There are no others. No DIFF, TIMEOUT or other UNSTABLE row changed status.

**Other rows that changed** (status unchanged):

| Suite | Rows | Change |
|---|---|---|
| `mir` | 6 | `attempts`/`retried`: the 4 retries of 40s plus `infinite_loop.rs` and `projection-cache-rematch-impl-141124.rs` (N1) |
| `miri-pass` | 2 | `attempts`/`retried`: `float.rs`, `nested_panic_caught.rs` |
| `run-fail-miri` | 1 | `attempts`/`retried`: `panic-in-ffi.rs` |
| `run-pass-miri` | 10 | `attempts` of the 8 retries of 40s, and `macro-comma-support-rpass.rs#core` retried again (as in 40r) |

No `unported` message changed apart from the 18 gains' rows. That includes the 410 remaining UNPORTED rows.

**New suites:** `pm-self` 282 MATCH (2 skipped, `ignore-enzyme`); `rg-build` 1; `rg-behaviour` 63; `rg-behaviour-rgtest` 324. No
other status in any of them.

**`git diff --stat da1c0393 4a3ffbf8 -- harness/ scripts/ tools/`** (28 files). The range includes 40s's accept, `5195eab9`:

| File | Change | Effect on protected suites |
|---|---|---|
| `harness/baseline/{ir-host,ir-run-pass,ir-run-pass-o0,run-fail-native}.txt` | grown by 40s's accept (`5195eab9`) and, the first three, by this accept | The protected set grows |
| `harness/baseline/run-pass-native.txt` | +112 (40s's accept), −4 (the withdrawals, N7), +1 (this accept) | N7 |
| `harness/baseline/{pm-self,rg-behaviour,rg-behaviour-rgtest,rg-build}.txt` | created by this accept | The four new suites are protected and now run in every gate (N5) |
| `harness/suites.ts` | (a) the M7d suites (`rg-build`, `rg-behaviour`, `rg-behaviour-rgtest`, `pm-self`, `std-self` with a skip) and their imports. (b) `Suite.uncachedOracle`, set only by the three ripgrep suites. (c) `pmCorpus` also returns `auxSteps`. (d) Three `NATIVE_UNSTABLE` entries and `yield1.rs`'s entry and reason (N7) | (a) new suites. (b) difftest `oracleUnstableReason` is the old `unstableOracleReason` for every suite without the hook. (c) pm-ui's and pm-expanded's cases are unchanged: no oracle-cache write and the same rows (N10). (d) N7 |
| `harness/compiletest.ts` | exports `AUX_DIR` and `auxEnv` | none |
| `harness/corpus/rg-behaviour/{corpus,queries}.json` | the fixed corpus and the 63 queries | `rg-behaviour` only |
| `harness/llvm-manifest.json` | +19 pins: `Mangler.cpp` (`6a74a1de`) and 18 Object/BinaryFormat files (`6d23a76a`) | Coverage and llvm-src tooling only |
| `harness/m7-suites.test.ts`, `harness/m7d-suites.test.ts` | the unstable counts move from 18 to 22; the native-hello baseline check; tests of the M7d suites | Tests only |
| `scripts/difftest.ts` | `oracleUnstableReason(s, stderr)` at the four places that read `unstableOracleReason` | Unchanged for the 67 earlier suites (re-check §2; N10) |
| `scripts/gate.ts` | `oracleRuns` knows `rg-build.ts`/`rg-behaviour.ts` (the oracle rustc) and `pm-self-run.ts` (its `--compiler`) | The probe check only |
| `scripts/criteria.ts`, `criteria.test.ts` | the four M7d groups; `minMatch` | Reporting |
| `scripts/rg-build.ts`, `rg-build-rustc.ts`, `rg-behaviour.ts`, `pm-self-run.ts`, `lib/rg-build.ts`, `lib/rg-build.test.ts` | the new suites' wrappers and their tests | The new suites only |
| `scripts/coverage.test.ts` | the "nothing ported yet" example moves from `SymbolWrapper.cpp`, now ported by llir-callbr-mangler, to `LLVMWrapper.h` | Test only; no expectation weakened |
| `scripts/probes.ts` | comment only (harness-w40s N1) | none |

`UPSTREAM.json`, `harness/corpus/` outside `rg-behaviour/`, `scripts/native-run.ts`, `scripts/ir-run.ts`, `scripts/lib/ir-normal.ts`,
`scripts/lib/unstable.ts`, `tools/`, the config files and the runtime C files did not change.

## 2. The four withdrawals

See N7. They are the only removals. Each is listed in `NATIVE_UNSTABLE` with its reason, scored `UNSTABLE` (subject `exit 0`), and absent
from the protected set at both `cc7f52fa` and `4a3ffbf8`. `harness/m7-suites.test.ts` pins the counts at 22 and 7.

## 3. Newly protected cases

| Suite | Gained | What |
|---|---:|---|
| `rg-behaviour-rgtest` | 324 | 323 ripgrep integration tests and the header section (N3) |
| `pm-self` | 282 | every pm-ui case, with port-built aux (N4) |
| `rg-behaviour` | 63 | every scripted query (N3) |
| `rg-build` | 1 | ripgrep 15.2.0's release build (N2) |
| `ir-run-pass`, `ir-run-pass-o0` | 8 + 8 | `abi/custom.rs`, `asm/cfg.rs#reva`/`#revb`, `asm/label-operand.rs#x86_64`, `asm/x86_64/global_asm_escape.rs`, `asm/x86_64/goto.rs`, `c-variadic/naked.rs`, `c-variadic/same-program-multiple-abis-x86_64.rs` |
| `ir-host`, `run-pass-native` | 1 + 1 | `asm/label-operand.rs#aarch64` |

The 18 IR and native gains were UNPORTED in 40s, at `llir: LLVMBuildCallBr` or `llir: LLVMRustGetMangledName`. The one native gain
also matches as aarch64 IR text in `ir-host`, so it has an IR twin.

## 4. Subject binaries and reachability

| Entry | Recomputed at `cc7f52fa` | `gate.json` | inputs |
|---|---|---|---|
| `src/rust_ts/main.ts` | `5fb6b937d6f41f315b04c2ae38e247cc0c124f2f` | equal | 2,220 |
| `src/miri/bin/miri.ts` | `46743b8c744bb1e527702f60a1fc0bfa540f0e99` | equal | 2,406 |

**How:**
1. `buildSpec`/`subjectBinKey` on the archive.
2. `subjectBinKeyOf(meta.spec, …)` with the build's Bun record.
3. Rebased onto the gate's repo path, the archive's spec equals `meta.spec`. The inputs, config and runtime C equal `meta.json`.

`scripts/lib/subject-bin.ts` is the same at `cc7f52fa` and in this tree. The rg keys are in N3.

**Reachability of the new object-file and mangler code.**
- **The new files** are `rust_ts/llvm/object_file.ts` (+1,002), `mangler.ts` (+283) and `symbol_wrapper.ts` (+123).
- **Who imports them:**
  - `object_file.ts` is imported only by `symbol_wrapper.ts`;
  - `symbol_wrapper.ts` and `mangler.ts` only by the model's `ffi.ts` and `impl_modules.ts`;
  - `LLVMRustGetSymbols` is called only from `rustc_codegen_llvm/back/archive.ts`;
  - `LLVMRustGetMangledName` is called only from `rustc_codegen_llvm`'s asm codegen.
- **How the model loads:** the LLVM model and `rustc_codegen_llvm` load only through `codegen_backend.ts`'s lazy `require` (`:322-326`).
  Its only static import of them is `import type` (`:34`), which is erased. No other non-test file outside those two trees imports either;
  the other hits are comments.
- **So the archive symbol table** (`LLVMRustGetSymbols`) is reached only when the LLVM backend writes an rlib, which happens only on link
  compiles: `rg-build`, the native suites' and `pm-self`'s aux builds.
- **The mangler** is reached only by codegen with inline or global asm: the IR and native suites.

**Other changed non-test `src/` files:**

| File | Change | Reach |
|---|---|---|
| `std/panic.ts` | adds `assert_eq_args`, used only by `debuginfo/metadata.ts` | additive; `clauses_of.ts` has its own local function of that name, unchanged |
| `rustc_fs_util/lib.ts` | ports `link_or_copy` (imports `hard_link` and `remove_file`) | its only caller is `rustc_codegen_llvm/back/write.ts` |
| `rustc_codegen_ssa/back/write.ts` | comments and one stop text | `-C incremental` paths only |
| `rustc_codegen_ssa/back/apple.ts` | `stdout_to_path` keeps a BOM | link time |
| `rustc_interface/util.ts` | exports `DummyArchiveBuilderBuilder` | no behaviour change |
| `rustc_session/filesearch.ts` | comment (w40r N3) | none |
| `rust_ts/llvm/*`, `rustc_codegen_llvm/*` | the rest | inside the lazy require |

Every front-end row equals 40s's (§1), and no front-end oracle entry was written (N10).

## 5. Retries, timeouts, power and load

**Solo retries** (alone wall / user s, 40s → 40t). All 18 are protected, and every one MATCHes:

| Suite | Case | wave 40s | wave 40t | pool load |
|---|---|---|---|---:|
| `run-pass-miri` | `dynamic-drop.rs` | 38.4 / 47.4 | **38.8 / 47.9** | 216 |
| `run-pass-miri` | `issue-8827.rs` | 38.3 / 46.1 | 38.0 / 45.6 | 230 |
| `mir` | `error-tainting-issue-122904.rs` | 28.0 / 32.3 | 29.0 / 33.0 | 92 |
| `mir` | `recursive-drop-elaboration-2.rs` | 28.2 / 32.5 | 28.8 / 33.0 | 100 |
| `mir` | `recursive-drop-elaboration.rs` | 27.9 / 32.1 | 28.8 / 33.1 | 107 |
| `run-pass-miri` | `move-3-unique.rs` | 25.9 / 31.1 | 26.2 / 31.3 | 196 |
| `mir` | `issue-52475.rs` | 20.4 / 21.2 | 20.5 / 21.2 | 155 |
| `run-pass-miri` | `repeated-vector-syntax.rs` | 19.7 / 25.4 | 20.1 / 26.0 | 118 |
| `run-pass-miri` | `recursion-etc.rs` | 16.4 / 18.5 | 16.3 / 18.3 | 241 |
| `run-pass-miri` | `unique-send-2.rs` | 15.8 / 22.3 | 16.1 / 22.3 | 175 |
| `run-pass-miri` | `macro-comma-support-rpass.rs#std` | 14.9 / 23.6 | 15.1 / 23.5 | 194 |
| `run-pass-miri` | `let-else-drop-order.rs` | 13.6 / 20.6 | 13.2 / 20.3 | 204 |
| `mir` | `infinite_loop.rs` | not retried | **15.2 / 15.9** | 152 |
| `mir` | `projection-cache-rematch-impl-141124.rs` | not retried | **14.3 / 18.7** | 118 |
| `run-pass-miri` | `macro-comma-support-rpass.rs#core` | not retried | **12.0 / 20.6** | 194 |
| `run-fail-miri` | `panic-in-ffi.rs` | not retried | **9.4 / 15.1** | 124 |
| `miri-pass` | `nested_panic_caught.rs` | not retried | **11.0 / 17.3** | 61 |
| `miri-pass` | `float.rs` | not retried | **10.2 / 27.6** | 68 |

- No case is above 45 s alone. The largest leaves 21.2 s of the 60 s limit. Every alone run finished.
- No protected TIMEOUT. The two `run-pass-miri-heavy` timeouts are as before: `hashset-connected-border-12860.rs` and
  `step_overflowing.rs`, 1,800 s. Neither is protected.
- **Heavy cases.** These run alone by design, with their own limits.
  - The earlier suites are within ±10% of 40s: `mir-core` 92.3 → 99.9 s, `check-core` 88 → 83.6 s, `rmeta-core` 87 → 90.2 s,
    `check-rg*` 55–75 s, `task-comm-6.rs` 187.5 → 155.3 s.
  - New: `rg-build` 264 s, 5,988 MB.
  - Max RSS is 7,631 MB (`check-core`), against the 12,288 MB budget. No heavy case is over budget.
- The six new suites retried nothing, and none of their cases timed out.

**Power:** N9. **Load:** N1.

## 6. Unstable and unprotected

- **Unstable, earlier suites:** `miri-pass` `tests/panic/panic1.rs`, as before.
- **Unstable, M7b suites:** `run-pass-native` 22 (40s's 18 and the four withdrawals) and `run-fail-native` 7. These are exactly the ids
  in `NATIVE_UNSTABLE`, and none is protected.
- **Unprotected timeouts:** the two in `run-pass-miri-heavy`, as in 40s.
- **Other unprotected rows of the earlier suites** are row for row identical to 40s's, their `unported` and `first` fields included,
  apart from the 18 gains.
  - Remaining UNPORTED rows: `ir-host` 16, `ir-run-pass` 40, `ir-run-pass-o0` 40 and `run-pass-native` 6.
  - DIFF rows are unchanged: `ir-host` 9, `ir-run-pass` 9, `ir-run-pass-o0` 4.

## 7. Static steps

From `gate-w60b.log`:
- `note: subject binary (src/rust_ts/main.ts 5fb6b937…, src/miri/bin/miri.ts 46743b8c…)`;
- then `ok` for typecheck, unit tests, unit test skips (1, allowlisted), unit tests (alone, 0 skips), runner unit tests (0 skips),
  markers, marker order, info sites and frozen lists;
- `gate.json`: `unitTestSkips {skipped: 1, allowed: 1, unexpected: []}`.

Junit, 40s → 40t:
- unit tests 8,036 → **8,086 tests, 1 skipped, 0 failures (8,085 pass)**;
- unit tests (alone) 39 → **39**, 0 failures;
- runner unit tests 577 → **594**, 0 failures.

That is the pre-gate step's 8,085 + 39 + 594.

**Bun:** `gate.json` `bun` is `1.4.4` / `38afee6c…`. `bunExec.start` and `bunExec.end` are both the private clone
`.data/gate-bun/run-36712-QIjFIv/bun`, sha1 `7c1f29cd…`. `bunClone` came `from` `~/.bun/bin/bun` by clonefile.

## 8. Criteria

`bun scripts/criteria.ts --run gate-20261115-141315-root-qswd --milestone M7`, **exit 0**:

```
gate gate-20261115-141315-root-qswd at cc7f52fa44: pass=true
plan-m7 M7a ir-hello: MATCH 2/2 = 100% vs >= 100%, 0 oracle timeouts counted: met
plan-m7 M7a mir-o2: MATCH 3475/3479 = 99.89% vs >= 99%, 0 oracle timeouts excluded, 0 unstable excluded: met
plan-m7 M7a mono-ui: MATCH 3475/3479 = 99.89% vs >= 99%, 0 oracle timeouts excluded, 0 unstable excluded: met
plan-m7 M7a check-rg: MATCH 34 of 34 crates vs >= 33, 0 oracle timeouts: met
plan-m7 M7b native-hello: MATCH 1/1 = 100% vs >= 100%, 0 oracle timeouts counted: met
plan-m7 M7b run-pass-native: MATCH 3386/3392 = 99.82% vs >= 80%, 0 oracle timeouts excluded, 22 unstable excluded: met
plan-m7 M7b ir-run-pass: MATCH 3430/3479 = 98.59% vs >= 70%, 0 oracle timeouts excluded, 0 unstable excluded: met
plan-m7 M7c run-pass-native: MATCH 3386/3392 = 99.82% vs >= 98%, 0 oracle timeouts excluded, 22 unstable excluded: met
plan-m7 M7c run-fail-native: MATCH 282/282 = 100% vs >= 95%, 0 oracle timeouts excluded, 7 unstable excluded: met
plan-m7 M7c ir-run-pass: MATCH 3430/3479 = 98.59% vs >= 95%, 0 oracle timeouts excluded, 0 unstable excluded: met
plan-m7 M7d rg-build: MATCH 1/1 = 100% vs >= 100%, 0 oracle timeouts counted: met
plan-m7 M7d rg-behaviour: MATCH 63/63 = 100% vs >= 100%, 0 oracle timeouts counted: met
plan-m7 M7d check-rg: MATCH 34 of 34 crates vs >= 34, 0 oracle timeouts: met
plan-m7 M7d pm-self: MATCH 282 of 282 cases vs >= 1, 0 oracle timeouts excluded: met
milestone M7a: met (4 of 4 groups met)
milestone M7b: met (3 of 3 groups met)
milestone M7c: met (3 of 3 groups met)
milestone M7d: met (4 of 4 groups met)
exit 0: every selected milestone is met (M7a, M7b, M7c, M7d)
```

**M7 is done, as recorded** (history 2026-11-15T21:23:46Z).

## What I did not check

- **Subject outputs of MATCH rows.** The run data keeps none. For the ripgrep suites I used what the wrappers keep (N2, N3).
- **The lanes' code:** the fidelity of `callbr`, the mangler, `LLVMRustGetSymbols`, the object-file reader and `link_or_copy`. That
  belongs to their reviews and `root-w60-check.md`. I checked reachability and evidence, not correctness.
- **Which process ran each rg-build compile**, beyond the wrapper's code, the environment, timing and the artifacts (N2). Calls are not
  logged with their program path.
- **The pm-self step order** within a case. MATCH covers each step's exit line and stderr.
- **Subject commands of the earlier suites.** They are not in the run data. I rely on the unchanged oracle keys, case lists and rows
  (N10), and on the harness diff above, which changes no earlier suite's command.

## Side effects outside my scratchpad

- I copied `.env.local` into this worktree from `.data/integ-w39/.env.local`, and `bun install --frozen-lockfile` linked
  `node_modules`. Both are gitignored.
- `RUST_TS_SUBJECT` stayed unset, and I built no binary.
  - The key recomputation ran `Bun.build` in memory over a `git archive` tree in my scratchpad, which I then deleted.
  - `rgBinKey` only reads files and runs `cc -v`, `ld -v`, `xcrun` and `sw_vers`.
- Nothing under `.data/subject-bin`, `.data/oracle-cache`, `.data/ripgrep`, `.data/pm-self`, `.data/aux`, `.data/native`,
  `.data/crate-fetch` or `.data/runs` changed after I started.
- I read the gzipped cache entries directly, not through `readCached`, which can remove an unreadable entry.
- This file is the only tracked change.
