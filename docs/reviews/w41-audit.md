PASS WITH NOTES

**Wave 41's accept stands.** No protected case was lost or tampered with. All 71 protected suites ran in full. Each of the 556,900
protected ids in `harness/baseline/*.txt` at `843bc593` is `MATCH` in this gate's own jsonl. No baseline file changed anywhere in the wave
(`4a3ffbf8..962c9a39`), and the accept commit `962c9a39` touches only `docs/state/`.

**The battery spells did not change a protected result.** Root's argument holds against the code. A battery-induced slowdown can only
turn a case into TIMEOUT or ORACLE_TIMEOUT, and neither is ever MATCH. Every suite that overlapped a spell compared against an oracle output
cached before the gate: no oracle-cache entry was written during either spell. Per-case statuses in every suite that overlapped a spell are
identical to wave 40t's gate. The status counts of all 71 suites are identical too.

**The re-keyed ripgrep suites really re-ran.**
- **Oracle sides:** 65 oracle-cache entries were written during the gate: 1 for `rg-behaviour-rgtest`, 63 for `rg-behaviour` and 1 for
  `rg-build`.
- **Subject sides:** the port's `rg` was rebuilt at a new key.
- **Compiler calls:** all 53 calls of `rg-build`'s subject build went to the port.

**The new fields are inert.** Only `cargo-build` and `cargo-smoke` set `neverProtect`, `headroom` or `runFirst`. Neither has a baseline
file, and neither ran. `ENV` is 0 everywhere. No headroom check, watchdog stop or `notRun` is recorded.

The notes below are about the host and the records, not the result.

Regression audit, 2026-11-16, lane `w41-audit`:
- **This gate:** `gate-20261116-031102-root-ftbd`.
  - Tested `843bc593`, with an empty `dirty` list. Accepted in `962c9a39` with 0 gained and 0 lost.
  - Run settings: `RUST_TS_SUBJECT=binary`, Bun 1.4.4 (`38afee6c8`), the same Bun file at start and end, run from a `clonefile` copy.
- **Previous accept:** wave 40t, gate `gate-20261115-141315-root-qswd`. Tested `cc7f52fa`, accepted `4a3ffbf8`.

I ran no gate, no difftest and no suite. What I read and ran:
- **Gate records:** `gate.json`, `.data/tmp/gate-w41.log`, `.data/tmp/gate-w41-battery-note.txt`, all 71 `*.summary.json`, every jsonl and
  `skipped.jsonl`, and the three junit files.
- **Every protected id:** checked against the run's jsonl with a script. Rows equal the summary totals, and `sample`/`filter` are null.
- **Comparison with wave 40t:** per-suite status counts, and per-case `{id, status}` for the suites that overlapped a spell, against
  `gate-20261115-141315-root-qswd`.
- **Diffs:** `git diff 4a3ffbf8 843bc593` over `harness/`, `scripts/` and `UPSTREAM.json`, read in full for `harness/suites.ts`,
  `scripts/difftest.ts`, `scripts/gate.ts`, `scripts/lib/protect.ts`, `scripts/lib/input-dirs.ts`, `scripts/lib/oracle.ts` and
  `scripts/lib/host-state.ts`.
- **Registered suites:** loaded from `harness/suites.ts` at HEAD, whose `harness/` and `scripts/` equal `843bc593`'s, to list which suites
  set the new fields.
- **Oracle cache:** every entry written between the gate's start and end, found by mtime.
- **The ripgrep suites:** the kept call logs (`.data/ripgrep/kept/rg-build/{oracle,subject}-logs`), the kept binaries and stamps
  (`.data/ripgrep/bin/{oracle,subject}/<key>`), and the oracle `binKey` recomputed at HEAD.
- **Power:** `gate.json` `host`, `pmset -g log`, `pmset -g ac` and `pmset -g batt`.
- **Host now:** `df` and `vm.swapusage`. A `ps` check for stuck host readers.

`RUSTUP_AUTO_INSTALL=0` throughout. I changed no code.

## 1. Protected cases

| check | result | evidence |
|---|---|---|
| Baselines vs this run | **All 556,900 protected ids are MATCH**, in all 71 suites. None is missing, none is non-MATCH, none is in a suite's `skipped.jsonl`. The number of MATCH rows equals the number of protected ids, so this run gained nothing. | script over `harness/baseline/*.txt` and `runs/gate-20261116-031102-root-ftbd/<suite>.jsonl`. Overall status counts: MATCH 556,900, UNPORTED 410, DIFF 50, UNSTABLE 30, TIMEOUT 2 |
| Baselines across the wave | **No change.** `git diff 4a3ffbf8 843bc593 -- harness/baseline` is empty, and so is `70ae6e6a..962c9a39`. `git log 4a3ffbf8..962c9a39 -- harness/baseline` lists no commit. `962c9a39` changes only `docs/state/current.json` and `docs/state/history.jsonl`. | git |
| Accept record | `history.jsonl` line 746 matches the run. For each suite, `protected` equals its baseline size and `total` equals its row count. | `history.jsonl` |
| Expectation tampering: `harness/suites.ts` | **None found.** The changes, in turn: | `git diff 4a3ffbf8 843bc593 -- harness/suites.ts` |
| | **Rg import swap and new fields.** The `rg-build` imports become `cargo-project-build` ones. Four optional fields are added: `neverProtect`, `headroom`, `runFirst` and `envOracle`. | |
| | **The `ORACLE_KEY_FILES` table.** It only adds inputs to the rg keys: `RG_BEHAVIOUR_LIB` for `rg-behaviour` and `rg-behaviour-rgtest`, and the new harness sources through `PROJECT_BUILD_SOURCES`. A key that hashes more files is never easier to hit stale. | |
| | **The rg suites' commands.** `rg-build` now runs `cargo-project-build.ts run --project ripgrep`. Its timeouts, `cases`, `inputDirs`, `uncachedOracle` and `criterion` are unchanged. | |
| | **Two new suites.** `cargo-build` and `cargo-smoke` are added, both `neverProtect`. | |
| | **No existing suite's cases, args, unstable list or timeouts changed.** | |
| Expectation tampering: `scripts/difftest.ts` | **None found.** | `scripts/difftest.ts` `classify`, `oracleEnv`, `runOracle`, `criterionOf` |
| | **`ENV`.** The status is decided from oracle runs only, and only for a suite with `envOracle`. No registered suite has one. `classify` returns ENV before TIMEOUT or MATCH, so ENV can never produce a MATCH. Cached oracle entries that `envOracle` flags are removed. `criterionOf` drops ENV from the denominator; it is a report only. | |
| | **`inputDirsHash`.** It moved into `lib/input-dirs.ts`. The text it hashes is the same for regular files and for symbolic links that resolve to a file. Only links to a directory, or dangling links, are new: they are hashed by their link text, and both used to throw. The keys of the protected `inputDirs` suites (`check-*`, `mir-*`, `rmeta-*`, the rg suites) did not move for this reason: their oracles were served from cache (the heavy lines say `oracle cached`). | |
| Expectation tampering: `scripts/gate.ts` and `scripts/lib/protect.ts` | **None found.** | |
| | **The loss rule is unchanged.** `lost = base − MATCH`, and `pass` still requires `lost.length === 0`. | |
| | **`pass` also gains `stop === undefined`.** | |
| | **`matchesOfRun`.** It moved to `matchIdsOfJsonl` with the same logic: MATCH rows only. | |
| | **`planAccept`.** It is the old accept loop, plus the `neverProtect` skip. That skip refuses while the suite has a baseline file. | |
| | **New refusals.** The gate refuses to run, and accept refuses, if a `neverProtect` suite has a baseline. | |
| | **`gateSuiteOrder`.** Only the order changes: `runFirst` suites first, then the rest, then the heavy ones. | |
| Oracle outputs and the oracle toolchain | **Untouched.** The tool oracles (clippy, rustfmt) are unpacked under `$RUST_TS_DATA/tools/<sha256>` and run on the oracle's own `librustc_driver`. Nothing is installed into the toolchain (`scripts/lib/oracle.ts`). Apart from the re-keyed rg suites, every suite's oracle was served from cache. `UPSTREAM.json` changes only `sparse` (two new tool directories), `rust.tools` and the top-level `cargo` pin. `upstreamOk` is true. | `UPSTREAM.json`, oracle-cache mtimes (§3) |

## 2. Battery spells

The `pmset -g log` and `gate.json` records agree. All times are local (IST, UTC+2):
- **Spell 1:** battery from 10:05:36 (seen by the gate at 08:06:03Z) to 10:24:13 (08:25:03Z), at 100% → 85%.
- **Spell 2:** battery from 10:44:18 (08:45:03Z) to **11:30:50** (09:31:04Z), at 91% → **74%**. See N3 for root's different figures.

| spell | suites that ran | overlap | retries | oracle |
|---|---|---|---|---|
| 1 | `run-pass-native` (07:59:33–08:19:41Z) | last ~13.5 of 20 min | 0 | cached; 22 UNSTABLE, the same set as wave 40t |
| 1 | `symbols`, `thir-tree`, `thirdump-minicore` (08:19:41–08:22:04Z) | whole | 0 | cached |
| 1 | `thirdump-ui` (08:22:04–08:27:24Z) | first 3 of 5 min | 0 | cached |
| 2 | `tydump-nocore` (08:28:04–09:45:31Z) | 46 of 77 min | **9**, all finished alone, all MATCH | cached |

**Timeout re-runs.** Over the whole run 38 subject TIMEOUTs were re-run alone: `mir` 8, `miri-pass` 2, `run-fail-miri` 4,
`run-pass-miri` 15 and `tydump-nocore` 9. All 38 are protected ids, all finished alone, and all are MATCH.
- **During a spell:** only the 9 in `tydump-nocore`. The jsonl gives no times, but the pool load at those timeouts was 200.8–207.1, and
  the only kept sample that high is 214.9 at 09:05:10Z, inside spell 2. Alone, each took 0.6–0.7 s, against 62.9–78.1 s in the pool,
  where each used 2.5–2.8 s of user time. That is contention, not a slow case.
- **The slowest alone** was `run-pass-miri` `issue-8827.rs` at 42.8 s of the 60 s limit, on AC.
- **Heavy suites** ran 10:21–11:53Z, on AC. A heavy subject's TIMEOUT is never re-run, but none of the protected heavy cases timed out.
  The only TIMEOUTs are `run-pass-miri-heavy`'s two unprotected cases at 1800 s, `hashset-connected-border-12860.rs` and
  `step_overflowing.rs`. Both timed out in wave 40t too.

**Root's argument, checked against the code: it holds.**
- **A timed-out subject is never MATCH.** `scripts/lib/common.ts` `run` sets `timedOut` from its timer whatever the exit code; the 7 of
  the 9 `tydump-nocore` pool timeouts that show `exit 1, timedOut: true` show this. `difftest.ts` `classify` returns TIMEOUT before
  comparing.
- **A re-run's status is used only if the re-run finishes.** The re-run is alone, with the same limit, so a slowdown can only keep a case
  at TIMEOUT. That is a loss, which fails the gate visibly.
- **An oracle that times out twice is ORACLE_TIMEOUT**, which is never MATCH, so a protected case with it is lost.
- **A MATCH needs byte equality with the oracle's output.** Slowness can change that output only for a timing-dependent case. Those are
  UNSTABLE, listed or detected, never cached and never protected. The UNSTABLE sets are identical to wave 40t's.
- **No oracle output was produced on battery and then compared or cached.** No oracle-cache entry was written between 10:06:00 and 10:25:10
  local or between 10:45:00 and 11:31:10 local.

**Caveat:** the argument covers status classification, not wall time. Battery does make a TIMEOUT loss more likely. This gate had none.

## 3. Re-keyed ripgrep suites

| check | result | evidence |
|---|---|---|
| Oracle sides re-run | **Yes, not from a stale cache.** 65 oracle-cache entries were written during the gate, and all were on AC: `rg-behaviour-rgtest` 1 (10:32:15Z), `rg-behaviour` 63 (10:36:52–10:37:40Z) and `rg-build` 1 (10:38:01Z). The heavy lines show a timed oracle run for all three, not `oracle cached`. | oracle-cache mtimes; `gate-w41.log` |
| Oracle `rg` | Key `4f4206ec6f471206`, stamped `builtAt 2026-11-16T10:38:01Z`. It equals `binKey(ripgrep, "oracle", <sysroot>/bin/rustc)` recomputed at HEAD. The older keys `0c4d288e…` (00:40Z) and `8766cf8d…` (11-15) were not touched during the gate, so they were not handed out (`touchKey` updates the mtime on every use). | `.data/ripgrep/bin/oracle/*/stamp.json`; scratch `binKey` |
| Subject `rg` | **Rebuilt at a new key.** Key `aed3ce709d83cbf2`, stamped 10:42:27Z. `rg-behaviour-rgtest`'s subject side built it first: its subject wall time was 272.4 s, against `rg-build`'s 265.9 s. The previous key `7ea4d5a3…` (11-15 21:21Z) was not touched. The port-built `rg` is 7,073,200 bytes and the oracle's is 6,624,384, so the subject side did not run an oracle binary. | `bin/subject/*` |
| Matched | `rg-build` 1/1, `rg-behaviour` 63/63, `rg-behaviour-rgtest` 324/324. | §1 |
| Every compile through the port | **Yes.** | `.data/ripgrep/kept/rg-build/{oracle,subject}-logs` |
| | **One compiler for every call.** `cargo-project-build-rustc.ts` sends every call (probes, build scripts, crates, the link) to a single `CPB_COMPILER` argv, the side's compiler. | |
| | **Same calls, all clean.** The subject log has 53 calls, 45 compiles and 8 probes. They are the same (kind, crate, `-C metadata`) set as the oracle's, every one exits 0, and none was killed by a signal. | |
| | **The subject build looks like the port's.** It took 568.8 s of user time at 4,468 MB max RSS, against the oracle's 43 s at 705 MB. | |

## 4. New fields are inert

- **New fields:** loading `SUITES` from `harness/suites.ts` gives 88 suites. The only ones with `neverProtect`, `headroom`, `runFirst` or
  `envOracle` are:
  - `cargo-build`: `neverProtect`, `headroom: "heavy-build"`, `runFirst`;
  - `cargo-smoke`: `neverProtect`.

  Neither has a baseline file. Every one of the 71 baseline files names a registered suite.
- **Not run:** neither `cargo-build` nor `cargo-smoke` has a file in the run directory, and the log does not mention them.
- **ENV:**
  - no jsonl row has status `ENV`;
  - every `*.summary.json` has `"ENV": 0` (the counter is always written);
  - no `gate.json` suite entry has an `env` key.
- **No stops:** `gate.json` has no `headroom`, `stop` or `notRun` key, and `$RUST_TS_DATA/watchdog-stops` does not exist.

## 5. Unrun suites and skips

- **Suites:** all 71 protected suites ran in full, with no `sample` or `filter`, and each jsonl row count equals its summary `total`.
  Nothing was not run.
- **Cases left out by the suites:** every `skipped.jsonl` lists the same ids as wave 40t's. None of them is a protected id.
- **Unit-test skips:** one, `read_binary_file_handles_lying_stat`, which is allowlisted (`unit-tests.junit.xml`: 8,225 tests, 0 failures).
  The alone run (39 tests) and the runner tests (683) have no skips.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | info | **The spells touched six suites.** Five front-end suites overlapped spell 1, and `tydump-nocore` overlapped spell 2 (§2). The heavy suites and the rg suites all ran on AC. `tydump-nocore` took 77 min, against 38 min in wave 40t, with 9 pool timeouts against 0. All 9 finished alone and matched. Every per-case status in those six suites equals wave 40t's. | `gate.json` `startedAt`/`endedAt`, `retryTimes`; jsonl comparison |
| N2 | low | **The battery kept draining on AC.** After spell 2 the source was AC from 11:30:50 local, yet the charge fell from 74% to 26% by about 12:27 local (10:27Z), at 1-minute load 140–170. It was still falling at load 9–12 and began rising only at about 12:31 local (10:31Z), with load near 3. The adapter is a 70 W USB-C (`pmset -g ac`), and under this load it does not cover the draw. <br><br> The gate records the power source only, so `power back at 09:31:04Z` reads as a recovery that the charge figures do not show. Suites in that window: the end of `tydump-nocore`, `tydump-ui`, the three `unpretty-*`, `check-alloc`, `check-core`, the three `check-rg*`, `check-std` and `mir-alloc`. All matched. `check-core`'s subject took 134.8 s, against 83.6 s in wave 40t, with 76.6 s of system time. <br><br> No thermal or speed-limit event is logged. **Suggestion** (a harness change for root, not made here): treat a falling charge on AC like battery in `HostLog`'s notes, or gate on a higher-wattage adapter. | `gate.json` `host.samples`; `pmset -g log`; `pmset -g ac` |
| N3 | low | **Root's record of spell 2 differs from the machine's.** The decision in `history.jsonl` line 747 and `.data/tmp/gate-w41-battery-note.txt` (written 11:37 local) say "10:44-11:37, 91->68%". `pmset -g log` and `gate.json` show AC from 11:30:50 at 74%. The 68% was evidently read at 11:37, already on AC and still draining (N2). Spell 1's "10:06-10:24, 100->85%" matches. The verdict does not depend on it. | `pmset -g log` `Using AC(Charge: 74)` at 11:30:50 |
| N4 | info | **The brief's base commit is not the previous accept.** `70ae6e6a` is `next.md: harness-m8a-build merged`, partway through the wave. The previous accept is `4a3ffbf8` (wave 40t). `git log 70ae6e6a^..843bc593 --first-parent` therefore leaves out the merges of `harness-m8a-gate` (`8d6b0acb`), `tools-prep-m8` with `cargo-fix-a` (`b75df78c`), and `harness-m8a-build` (`f3f8f6f4`). I audited `4a3ffbf8..962c9a39`, and every check above covers the whole wave. | `git log --first-parent --grep=qswd` |
| N5 | low | **The host record.** | `gate-w41.log`; `gate.json`; `df`; `sysctl vm.swapusage`; `ps` |
| | | **Disk.** `gate.json` `host` holds power, load and swap but no disk figure, so the run's free disk is not on record. | |
| | | **Stuck readers.** The `pmset` and `swapusage` readers were reported stuck at about 09:05Z, leaving one null power sample. No stuck `pmset` or `sysctl` process is left now, and no process is in state `U`, so the reboot the note asks for is not needed. | |
| | | **Swap** during the run was 5.3–8.2 GB. | |
| | | **Headroom.** No check fired, because no suite in this run has `headroom`. The host now has 19 GiB free on the data volume (96% used) and 6.1 GB of 7.2 GB swap in use. That is below D20's `heavy-build` minimum (20 GiB free, swap under 4 GiB), so `cargo-build` would be refused (left not run, as a report) if a gate ran it now. This does not affect this run. | |
| N6 | low | **The host was busy during the gate.** The 1-minute load reached 214.9 at 09:05:10Z. Of the 180 kept samples (suite edges counted twice), 31 are over 100 and 9 are over 150. During the battery part of `run-pass-native`, load was about 9. 38 solo retries, against 18 in wave 40t. All are protected, and all are MATCH (§2). Other worktrees recorded decisions during the run, at 09:08Z (`tools-prep-m8`); the record does not say which processes made the load. | `gate.json` `host.samples`, `retryTimes` |
| N7 | info | **Housekeeping: old watcher shells.** Root's watcher loops are still alive: four for `gate-w41`, and the ones for `gate-w53`, `gate-w56` and `gate-w57`, which are 1–4 days old. Each polls `pmset -g batt` every minute and holds a `tail -F`. They are harmless to results, but they add `pmset` calls during the next gate. I did not stop them (read-only, and no `pkill`). | `ps -axo pid,etime,command` |
