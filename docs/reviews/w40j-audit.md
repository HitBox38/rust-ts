PASS WITH NOTES

**Wave 40j's accept stands.** No protected case was lost, removed or tampered with. All 60 protected suites ran. Every one of the
542,304 protected ids in `harness/baseline/*.txt` at `3f2da8d9` is still in the baselines at `9a03f050` and `MATCH` in this gate's jsonl.
The baselines did not change at all (`3f2da8d9..9a03f050`: 0 lines). I compared every row of all 102 jsonl files (60 suites plus their
`.skipped`/`.extra` files) with wave 40i's gate, on every field. There are 542,643 rows on both sides, with the same ids in the same order.
**Only 16 rows moved, all in `attempts`/`retried`:** the same 15 retried cases as wave 40i, plus `nested_panic_caught.rs`, newly retried
(N3). The status counts are unchanged: MATCH 542,304, UNPORTED 308, DIFF 28, TIMEOUT 2, UNSTABLE 1.

**mir-opt-o4's new meaning is sound.** All 406 rows are `MATCH`. For `dump_dataflow.rs`, the oracle cache entry the gate read holds a
`-Zdump-mir-dir: 138 file(s)` listing. That listing is byte-identical to the listing I made of the oracle's dump dir and of the subject's
dump dir. The subject's dir was written inside the gate's mir-opt-o4 window, holds 138 files, none of them empty, and is identical to the
oracle's file by file. The oracle side is fresh, not stale: its 406 entries are one complete set written 02:37:43-02:40:07Z by the final
`mir-dump-run.ts`, and the gate wrote no cache entry at all.

**No expectation tampering.** Oracle-key dumps of `git archive` trees of `b0708f98` and `103b447a` differ by exactly **+2,009 `cli`
keys and 406 changed `mir-opt-o4` keys**, with nothing gone and nothing else changed. Every one of the 49 non-doc, non-baseline files
changed in the wave equals a reviewed lane head, or root's checked commits (`85e77ec9`, `7418d6e1`). `harness/suites.ts` is the clean
three-way merge of harness-cli and harness-w50. `cli` has no baseline, was not in the gate and is not in the accept record.

**The binary is the tested tree.** Both build keys recompute at `103b447a` to `b131654f…` and `004c20b0…`, now including
`RUNTIME_C_FILES`. Both builds' `meta.json` lists `thread.c` and `proc_macro_host.c`, with the hashes of `103b447a`'s blobs.

**Host interference changed no result, but it changed the host (N1).** **Bun on the root host is now 1.4.4.** `~/.bun/bin` changed at
09:59:49Z, during the gate's last suite. The gate and its builds ran on 1.4.3. That did not touch this gate: every suite process
started before the change, the binaries embed 1.4.3, and the gate's oracle cache lookups were all hits. **It does block the next gate's
binary mode** (`VALIDATED_BUN` lists only 1.4.3). It also changes the oracle key of 2,308 registered cases in the 20 suites whose oracle
command is the Bun binary. `task-comm-6.rs` ran exactly in the late swap and load spell: 1,320 s of its 1,800 s limit (N2).

Regression audit, 2026-11-11. Gate `gate-20261111-034856-root-qgwe`, tested `103b447a`, accepted `9a03f050`, `RUST_TS_SUBJECT=binary`.
The previous accept is wave 40i: gate `gate-20261110-192312-root-ehou`, tested `b0708f98`, accepted `3f2da8d9`, binary mode. I ran no
gate and no full suite. What I ran:
- a comparison of every row of all 102 jsonl files of this gate against wave 40i's, on every field. I checked every id of the 60
  baselines at `3f2da8d9` (`git show`) against the baselines at `9a03f050` and this gate's jsonl. I checked `gate.json`, the
  `history.jsonl` accept entry, the three junit reports, the frozen-lists run and the gate log (`.data/tmp/gate-w49.log`, N5);
- `scripts/oracle-keys.ts` over every registered case, in `git archive` trees of `b0708f98` and `103b447a` (each with this worktree's
  `.env.local` and `node_modules`). I compared the result with the harness-cli review's dumps, and listed which suites' oracle command
  is the Bun binary (N1);
- a per-file blob check of the 49 changed files against the lane heads (driver-cli `2c011c48`, harness-cli `a162f53c`, harness-w50
  `169bff08`, fixers-51 `c501cb3f`, all based on `0ce28aa2`, whose code equals `b0708f98`'s) and against root's `85e77ec9` and
  `7418d6e1`. For `harness/suites.ts`, I ran `git merge-file` of the two lane versions over the base;
- the two subject-bin keys, recomputed in the `103b447a` archive tree with that tree's `buildSpec`, `subjectBinKey` and
  `subjectBinKeyOf`, with the spec rebased onto the gate's repo path and Bun taken from `meta.json`. I compared them with `gate.json`
  and the builds' `meta.json`, and hashed the main checkout's `.c` files;
- a scan of the mir-opt-o4 dump dirs (`.data/tmp/mir-opt-o4/{oracle,subject}/abaa683b58eea24c`), `diff -rq`, and the tree's own
  `dumpReport` of each. I decoded every oracle cache entry written since 2026-11-10T20:00Z (3,104 entries);
- the gate's `host` samples, per-suite times and the heavy suite's per-case usage, against wave 40i's;
- `difftest --filter` of `nested_panic_caught.rs` (twice, once with `--raw-subject`) and of `task-comm-6.rs`, alone, in binary mode
  **with the gate's own two builds**. Binary mode would not build on Bun 1.4.4 (N1), so I ran them from my `103b447a` archive tree with
  its `subjectBin` pointed at the gate's `b131654f…`/`004c20b0…` directories. That edit is in my scratchpad only;
- `bun scripts/coverage.ts` (summary) and `bun scripts/criteria.ts --run gate-20261111-034856-root-qgwe`.

Everything ran on AC power (`pmset -g batt` before each phase), with `RUSTUP_AUTO_INSTALL=0`, `RUST_TS_REQUIRE_PROBES=1` and
`RUSTC_ICE=0`. No gate was running (`.data/tmp/GATE_RUNNING` absent). I read code but changed none. **The host was never quiet during
the audit.** Another project (node, headless Chromium, other agents) kept the 1-minute load at 12-41.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | **medium** | **Bun on the root host changed from 1.4.3 to 1.4.4 during the gate, and nothing recorded it.** `bun --version` is now 1.4.4 (`38afee6c`). `~/.bun/bin` was modified at 09:59:49Z, while `run-pass-miri-heavy` ran (08:47-10:17Z). The builds' `meta.json` says 1.4.3 `c6da4a4d`, built at 03:49Z. **This gate is unaffected.** Every suite's difftest process started before 09:59Z, on the 1.4.3 already in memory. The subjects are the compiled binaries, which embed 1.4.3. No oracle cache file was written after 03:48Z, so no oracle ran on 1.4.4. Only `gate.ts accept` (10:17:50Z) ran on 1.4.4, and it only reads jsonl. **Consequences for what comes next:** (a) **binary mode now refuses to start**: `ERROR: Bun 1.4.4 (38afee6c84fc) is not a validated build for subject binaries` (`scripts/lib/subject-bin.ts:95`, `VALIDATED_BUN` = 1.4.3 only). So the next gate cannot run in binary mode until either Bun 1.4.3 is restored or a reviewed batch validates 1.4.4 (the depth, module-order and `buildFiles` checks of docs/handoff/subject-bin.md). (b) The oracle key of every case whose oracle command is `process.execPath` (`difftest.ts:285` `oracleVersion` hashes that file) changes. That is 20 suites and 2,308 keys: `check-ui` 730, `rmeta-ui` 730, `mir-opt-o4` 406, `host-rlib` 222, `check-ui-encode-mir` 146, `rlib-native` 58, `ir-hello` 2, and one each in `check-{alloc,chain,core,std,rg,rg-encode-mir,rg-host}`, `rmeta-{alloc,core,std}` and `miri-sysroot-{core,alloc,std}`. Their oracle re-runs on the next difftest or gate (none of my keys for these exist in the cache). That includes protected suites (check-ui, mir-opt-o4, check-ui-encode-mir, rmeta-*). (c) The static steps would run on an unvalidated Bun. (d) Key dumps made before 09:59Z (harness-cli's and harness-w50's reviews, w40i-audit: `d4ab0b61…`) cannot be reproduced now. My `b0708f98` dump is `88bef000…`. The difference is exactly those 20 suites' 1,902 then-registered keys (plus mir-opt-o4's), and nothing else, which I confirmed by listing each suite's oracle command. **Root should record a decision:** restore 1.4.3 (which I recommend for an unchanged next gate), or validate 1.4.4 in a reviewed harness batch. A gate preflight that names the Bun version for source mode too would catch this. The other project's tooling is the likely source; the shell history does not show who ran it. | `bun --version`; `stat ~/.bun/bin`; `meta.json` `bun`; `scripts/lib/subject-bin.ts:95,108`; my key dumps and the per-suite oracle commands (§3); `find oracle-cache -newermt 03:48Z`: 0 files |
| N2 | low | **`task-comm-6.rs` used 1,320 s of `run-pass-miri-heavy`'s 1,800 s limit**, against 160.6 s in wave 40i. Its *user* time rose too, 415.0 against 171.4 s, so this was not only waiting for CPU. `task-comm-5.rs` went 42.2 → 199.4 s (user 48.3 → 104.2). The heavy suite runs its cases one at a time; these two ran last, about 09:52-10:17Z. Over that window the samples show swap jumping from 4.1 to 7.3-8.9 GB and 1-minute load from 4 to 27-31 (5-minute up to 46), plus the Bun change at 09:59:49Z. Free disk is not sampled. Load alone (12 cores) does not explain an 8× wall slowdown; memory pressure and swap do. Re-run alone with the gate's binary, at load 12-17 (the host was not quiet): **MATCH, 251.3 s wall / 231.1 s user** (RSS 1,458 MB). That is still 1.5× wave 40i, consistent with the contention I could not avoid. A heavy case that times out is a loss, and this suite has no solo retry, so a gate on a host this busy could have lost it. The 2026-11-10 near-limit rule does not cover the heavy class. Worth a line in `docs/next.md`'s gate checklist: no other heavy work on the host during the heavy suites. | `run-pass-miri-heavy.summary.json` `heavy` (both gates); `host.samples`; `.data/runs/w40j-audit-tc6-1` |
| N3 | low | **`nested_panic_caught.rs` is a newly retried case, and the docs give the wrong cause.** It timed out in `run-pass-miri`'s pool at 07:07Z (pool load 158.33), three hours before the end, during that suite's own pool (06:57-07:16Z, sample load 148). That pool load is normal for this gate: wave 40i's retried cases timed out at pool loads 102-166, and this gate's other 15 at 97-165. `docs/next.md` puts it in the other project's spell "near the end", but nothing in the samples shows that, and the samples near the end show 1-minute load at most 31-46. Root's "load past 150" is not visible after 07:07Z either (samples every ~10 minutes during the heavy suite, so a short peak could be missed). Its solo time is fine: 10.9 s in the gate, and my re-runs with the gate's binary gave **MATCH, 12.1 s** at load 15-16. 47.9 s under the 60 s limit, so no near-limit concern. | `run-pass-miri.jsonl` attempts; `host.samples`; `.data/runs/w40j-audit-npc-{1,2}` |
| N4 | info | **Coverage moved to 24,394 / 27,053 (90.17%), +64**, which is driver-cli's +64 fns (`rustc_driver_impl` 68/77, `rustc_errors` 362/362, `rustc_metadata` 453/453, `rustc_abi` 273/273, `rustc_session` 412/446). `README.md`, `docs/state/current.json` and `state.ts summary` still say 24,330. fixers-51's `Timespec::new`/`SystemTime::new` count under library: **696 / 2,399 in 64 marked files** (wave 40i 690 / 2,260 in 62). Vendor unchanged at 5,307 / 17,360. | `bun scripts/coverage.ts` at `9a03f050` |
| N5 | info | The gate log is `.data/tmp/gate-w49.log`, though the wave integrated as `integ-w50`. This is the same off-by-one as w40i-audit N4. | `ls .data/tmp` |
| N6 | info | **Disk.** About 5.3 GiB free at the end of the audit. Wave 40i's builds (`1712b4a9…`, `9df9f9f3…`, about 370 MB) are still in `subject-bin/`, and no accepted run needs them. Three accepted runs in `history.jsonl` (`gate-20261011-191820`, `gate-20261011-233648-root-9pw6`, `gate-20261012-105941-root-hf6n`) have no run dir on this host. They predate its earliest gate dir (`gate-20261012-194922`), so the cleanup did not remove them. `frozen-lists.ts` skips a missing run silently unless it is the latest. | `ls subject-bin`, `ls runs` |

## 1. Protected set: nothing lost

| Check | Result |
|---|---|
| Baselines `3f2da8d9` = `103b447a` = `9a03f050` | `git diff --shortstat`: empty for both ranges; 60 files at each; no `cli.txt` |
| Protected ids (`3f2da8d9`) against this gate's jsonl | **542,304, every one `MATCH`**, every one in the `9a03f050` baselines (542,304 lines), no duplicates |
| `gate.json` | `pass: true`, `staticOk`, `skipStatic: false`, `head` `103b447a`, `dirty: []`, `unstableOk`, `upstreamOk`, `unitTestSkips` 1 allowed 1, 0 unexpected. 60 suites, no `cli`. Summed over suites: `lost` 0, `lostSkipped` 0, `oracleTimeouts` 0, `upstreamChanges` 0, `gained` 0, batch-only failures and timeouts 0. Baseline 542,304, match 542,304, total 542,643 |
| `history.jsonl` accept entry (10:17:50Z) | 60 suites, no `cli`; each `protected` equals its baseline's line count at `9a03f050` (sum 542,304) |
| `9a03f050` | changes only `docs/next.md`, `docs/state/current.json`, `docs/state/history.jsonl` |
| Unstable | `miri-pass` `tests/panic/panic1.rs`, as in wave 40i |

**Every row, this gate against wave 40i's.** The same 102 files. In every file the ids, their order and every field are equal, except in:

| Suite | Rows | Change | Explanation |
|---|---|---|---|
| `mir` | 6 | `attempts` only | the same 6 retried cases as wave 40i; solo times in §5 |
| `run-pass-miri` | 9 | `attempts` only | the same 9 retried cases as wave 40i |
| `run-pass-miri` | `tests/ui/panics/nested_panic_caught.rs` | `MATCH` → `MATCH`, `retried` and `attempts` added | pool timeout at load 158, MATCH alone in 10.9 s (N3) |

Status counts are unchanged from wave 40i: DIFF 28, UNPORTED 308, TIMEOUT 2 (`run-pass-miri-heavy`: `hashset-connected-border-12860.rs`,
`step_overflowing.rs`, both unprotected, as before), UNSTABLE 1.

**Static steps** (`.data/tmp/gate-w49.log`). The log opens with `note: subject binary (… b131654f…, … 004c20b0…)`. Typecheck, unit
tests, alone, runner, markers, marker order, info sites and frozen lists are all `ok`, with 1 allowed skip. **Frozen lists:** 48/48 `MATCH`;
the three jsonl files are byte-identical to wave 40i's, in binary mode with this gate's two hashes. They ran at 03:57Z, long before the run-dir cleanup.

| Junit report | wave 40i | wave 40j | Gone | Added |
|---|---|---|---|---|
| `unit-tests.junit.xml` | 7,421 (1 skip) | 7,453 (1 skip, allowlisted `read_binary_file_handles_lying_stat`), 0 failures | 1: `json.oracle.test.ts`, whose name carries a temp path (re-added under the new path), as in every gate | 33: `rustc_errors/markdown/tests/parse.test.ts` 19, `term.test.ts` 2 (driver-cli); `proc_macro_host.oracle.test.ts` 2, `tinycc.test.ts` 2, `std/fs.test.ts` 2, `std/thread.test.ts` 1, `std/time.test.ts` 1, `std/fmt.test.ts` 1, `unix/fs.test.ts` 1, `framework/graphviz.test.ts` 1 (fixers-51); `json.oracle.test.ts` 1 (renamed) |
| `unit-tests.alone.junit.xml` | 39 | 39 | 0 | 0 |
| `runner-unit-tests.junit.xml` | 436 | 446, 0 failures | 0 | 10: `harness/mir-dump.test.ts` 5, `scripts/gate-power.test.ts` 1 (harness-w50); `harness/cli.test.ts` 4 (harness-cli) |

## 2. mir-opt-o4: the dump comparison

| Check | Result |
|---|---|
| Rows | 406/406 `MATCH`, the same ids as wave 40i; suite 04:45:14-04:45:49Z, 0 retried |
| Dump dirs on disk | exactly one dir per side holds files: `abaa683b58eea24c` (= `dump_dataflow.rs`). Others are empty, as the wrapper intends |
| Subject dir | **138 files** (124 `.mir`, 13 `.dot`, 1 `.html`), 552 KiB, **none empty**, all written 04:45:30Z, inside the gate's mir-opt-o4 window |
| Oracle dir | 138 files, same names; last written 02:38:53Z (before the gate) |
| `diff -rq oracle subject` | **0 differences**. No file contains the dump-dir path, so the `$DUMP_DIR` mask had nothing to do |
| `dumpReport` of each dir (the tree's own function) | 41,267 bytes, sha1 `581d0ff4fb17`, **byte-identical** |
| Oracle cache entry the run matched | `f77cb372…`, written 02:38:53.8Z: `code 0`, not timed out; text = `-Zunpretty=mir` stdout (283 bytes) + `-Zdump-mir-dir: 138 file(s)` + the listing + `--- stderr ---` (the dead-code warning) + `--- exit: 0 ---`. **Its listing is byte-for-byte the `dumpReport` above** |

**The oracle side ran under the new key and is not stale.**
- The new key adds `oracleKey = hash(hash(scripts/mir-dump-run.ts) + rustc_driver)` (`harness/suites.ts:2242`), a part that no
  pre-wave key has. So a matching entry can only have been written by an oracle run of that exact wrapper.
- The merged wrapper (blob `1991276d`) first exists at harness-w50's checkpoint of 02:37:48Z. Earlier drafts (`0ef073c9`, …) have other keys.
- All 3,104 cache entries written since 2026-11-10T20:00Z were written 02:29-02:40Z: 2,009 `cli`, and 1,095 mir-opt-o4 entries in
  four bursts: 1, 282, 406 and **406 (02:37:43-02:40:07Z)**. The last burst is the one complete set made with the final wrapper. Its
  `dump_dataflow` entry is `f77cb372` (the oracle dump dir's mtime is the same second).
- **The gate wrote no cache entry** (0 files newer than 03:48Z). Every one of its 406 lookups was therefore a hit on an entry that
  existed before the gate. The pre-wave entries (2026-11-05) are under the old keys and could not match.
- The three `dump_dataflow` entries (one per wrapper version) hold identical text, so even a mix-up would not change the result.

I could not recompute the gate's exact keys, because they include the sha1 of the Bun 1.4.3 binary, which is gone (N1). The argument
above does not need them.

## 3. Expectation tampering: none

`git diff b0708f98 103b447a` outside `docs/` and `README.md`: 59 files. 10 are the baselines of wave 40i's accept (`3f2da8d9`, an ancestor).
That leaves 49: 7 in `harness/` (`cli.ts`, `cli.test.ts`, `compiletest.ts`, `compiletest.test.ts`, `m7-suites.test.ts`,
`mir-dump.test.ts`, `suites.ts`), 7 in `scripts/` (`gate.ts`, `gate-power.test.ts`, `lib/subject-bin.ts`, `lib/unit-steps.ts`,
`mir-dump-run.ts`, `subject-bin-compare.ts`, `subject-bin.cases.ts`), and the rest in `src/`. **No change in `tools/`, `harness/corpus/`,
oracle outputs, `package.json`, `tsconfig.json`, `bunfig.toml`, `bun.lock` or `UPSTREAM.json`.**

**Reviewed batches.** All four lanes branch from `0ce28aa2`, whose code (`src`, `harness/*.ts`, `scripts`, `tools`) equals `b0708f98`'s. For each
of the 49 files I found which of the six commits changed it. Its blob at `103b447a` equals the blob at the last of them:
- driver-cli `2c011c48`: 11 files (docs/reviews/driver-cli.md, APPROVE WITH NITS, names `2c011c48`);
- harness-cli `a162f53c`: 2 files, plus `suites.ts` (harness-cli.md, APPROVE WITH NITS, names `a162f53c`);
- harness-w50 `169bff08`: 9 files, plus `suites.ts` and `subject-bin.cases.ts` (harness-w50.md, APPROVE WITH NITS, names `169bff08`/`e7fd5da0`);
- fixers-51 `c501cb3f`: 22 files, plus `std/fs.test.ts` (fixers-51.md, APPROVE WITH NITS);
- root `85e77ec9`: `scripts/lib/unit-steps.ts` (`RUSTC_BLESS` refused), `scripts/subject-bin.cases.ts` (on top of harness-w50's),
  `src/rustc_interface/metadata_temp_dir.test.ts`;
- root `7418d6e1`: `src/std/fs.test.ts` (on top of fixers-51's). Both root commits are checked in root-w50-check.md, APPROVE WITH NITS.

`harness/suites.ts` is the one file two lanes changed. `git merge-file` of harness-cli's and harness-w50's versions over `0ce28aa2`'s merges
with 0 conflicts and is byte-identical to `103b447a`'s. **So every `harness/` and `scripts/` change came through a reviewed lane or the
checked root commit.** No lane change is missing from the merge.

### Oracle keys

`scripts/oracle-keys.ts` over every registered case, in `git archive` trees (Bun 1.4.4, N1):

| | `b0708f98` | `103b447a` |
|---|---|---|
| keys | 372,681 in 72 suites | **374,690** |
| sha1 | `88bef000f68a…` | `a3e1b6e58756…` |
| suites not listed / `ERROR` lines | 0 / 0 | 0 / 0 |

**Exactly 2,009 keys are new, all `cli`. 406 changed, all `mir-opt-o4`. 0 went away, and no other key changed.** This matches harness-cli's
review (2,009 new) and harness-w50's (406 changed, nothing else).

**Why my sha1s differ from the reviews' (`d4ab0b61…` before, `e374a567…` after harness-cli).** I compared my `103b447a` dump with
the harness-cli dump of `a162f53c` (`e374a567…`, 374,690 keys), made at 02:29Z on Bun 1.4.3. Beyond mir-opt-o4's 406, exactly 1,902 keys differ, in exactly the 20
suites whose oracle command is the Bun binary (N1). In those suites, `difftest.ts:285` keys the oracle version on `sha1(process.execPath)`.
I listed every suite's oracle command in the `103b447a` tree: these 20 and no others are `/Users/tomernorman/.bun/bin/bun`. My two dumps
ran on the same Bun minutes apart, so their comparison is sound. `RUST_TS_AGENT`, `RUSTC_ICE` and the `.env.local` additions do not
move any key (checked on `check-chain`).

## 4. The binary is the tested tree

| Check | Result |
|---|---|
| Key of `src/rust_ts/main.ts` at `103b447a` | **`b131654feb887e00f48090de3f902ffb64a96be2`**, 2,104 inputs |
| Key of `src/miri/bin/miri.ts` at `103b447a` | **`004c20b017fb6c6e63a640e528482a6f42d79c43`**, 2,292 inputs |
| `gate.json` `subject`, the 60 summaries and the frozen-lists summaries | `mode: binary` with exactly these two hashes |
| `meta.json` of each build | `hash` equal; `inputs`, `config`, `spec` and **`runtimeC` identical** to the recomputation. `runtimeC` = `src/std/thread.c` `453d4222…`, `src/rust_ts/proc_macro_host.c` `c1541cf1…` (`RUNTIME_C_FILES` at `103b447a` is exactly these two). No `.c` among the bundler inputs. Bun 1.4.3 `c6da4a4d`; built 03:49:00Z and 03:49:04Z, after `103b447a` (03:48:48Z) |
| Main checkout's `.c` | `thread.c`, `proc_macro_host.c` and `mpsc_test_echo.c` equal `103b447a`'s blobs, and their content sha1s equal `runtimeC`. `thread.c` was last written 03:48:48Z (the merge), the other two 2026-11-10T19:23Z; none since. HEAD is `9a03f050` (same code); tree clean |

How: in the `103b447a` archive tree, `buildSpec(entry, tree)` and `subjectBinKey` give the inputs, config and `runtimeC`. The spec is
rebuilt as `buildSpec(entry, "/Users/tomernorman/Documents/personal/rust-ts", meta.spec.bunPath)`. `subjectBinKeyOf` takes the tree's own
`subject-bin.ts` sha1 as the builder, and `meta.bun` as Bun (today's Bun would give a different key, N1).

## 5. Host interference

**Power and host.** `host.allowBattery` false, `powerLost` `[]`. 148 samples (03:48:56Z-10:17:26Z), all on AC, every one with a power
reading, largest gap 660 s. AC at both marks of all 60 suites. 1-minute load: median 40 (wave 40i 50), peak 152 (180), 8 samples above
100 (18), all in the pool suites before 07:10Z. Swap 3.8 GB until 09:47Z, then 7.3-8.9 GB. Suites took 22,788 s against 23,252 s (−2.0%).
The only suite much slower is `run-pass-miri-heavy`, 5,408 s against 4,079 s (+1,329 s), all of it in `task-comm-5.rs` and
`task-comm-6.rs` (+157 s and +1,160 s). Up 7 days, no reboot. The samples have no disk field, so I cannot place the 1.8 GiB low.

**Did the spell change a result? No.** It overlapped only the last two heavy cases (both `MATCH`) and the accept. Every other suite had ended
by 08:47Z, when the 1-minute load was 3 and swap 4.2 GB. The newly retried `nested_panic_caught.rs` is a normal pool timeout (N3).

| Heavy case (one at a time) | wave 40i wall / user s | wave 40j wall / user s |
|---|---|---|
| `dynamic-drop-async.rs` | 78.7 / 90.1 | 82.4 / 93.7 |
| `issue-94923.rs` | 87.6 / 94.5 | 89.3 / 95.6 |
| `example-calendar.rs` | 70.1 / 80.7 | 73.5 / 83.7 |
| `panic-handler-flail-wildly.rs` | 39.3 / 47.6 | 41.5 / 49.7 |
| `task-comm-5.rs` | 42.2 / 48.3 | **199.4 / 104.2** |
| `task-comm-6.rs` | 160.6 / 171.4 | **1,320.4 / 415.0** |
| `hashset-connected-border-12860.rs`, `step_overflowing.rs` | TIMEOUT 1,800 | TIMEOUT 1,800 (unprotected) |

**Re-runs, alone, with the gate's two builds** (binary mode, `RUST_TS_AGENT=w40j-audit`). I could not get a quiet machine: another project
kept the load at 12-41 all through the audit.

| Case | Gate | Re-run | Load during re-run |
|---|---|---|---|
| `run-pass-miri-heavy` `task-comm-6.rs` | 1,320.4 / 415.0 s (wave 40i 160.6 / 171.4) | **MATCH, 251.3 / 231.1 s**, RSS 1,458 MB | 17 → 12 |
| `run-pass-miri` `nested_panic_caught.rs` | pool TIMEOUT, alone 10.9 / 16.5 s | **MATCH, 12.1 s** (`--raw-subject` `ms`), MATCH on a second run | 15-16 |

**Solo retries** (`retryTimes`, wall / user s; pool load at the timeout). The same 15 as wave 40i, each within ±1.2 s, plus N3:

| Case | wave 40i | wave 40j | Δ wall | pool load (40i → 40j) |
|---|---|---|---|---|
| `dynamic-drop.rs` | 39.6 / 48.5 | **39.9 / 48.7** | +0.3 | 137 → 112 |
| `issue-8827.rs` | 39.2 / 46.7 | **39.3 / 46.6** | +0.1 | 153 → 154 |
| `error-tainting-issue-122904.rs` | 28.2 / 32.5 | 28.1 / 32.4 | −0.1 | 102 → 117 |
| `recursive-drop-elaboration-2.rs` | 28.1 / 32.3 | 28.1 / 32.4 | 0.0 | 119 → 136 |
| `recursive-drop-elaboration.rs` | 27.9 / 32.5 | 28.0 / 32.5 | +0.1 | 119 → 136 |
| `move-3-unique.rs` | 27.1 / 32.3 | 27.1 / 32.4 | 0.0 | 126 → 139 |
| `repeated-vector-syntax.rs` | 20.6 / 26.4 | 20.9 / 26.8 | +0.3 | 105 → 98 |
| `issue-52475.rs` | 19.8 / 20.6 | 19.5 / 20.3 | −0.3 | 158 → 165 |
| `recursion-etc.rs` | 16.8 / 18.9 | 16.6 / 18.7 | −0.2 | 129 → 120 |
| `unique-send-2.rs` | 16.1 / 22.9 | 16.1 / 22.9 | 0.0 | 126 → 97 |
| `macro-comma-support-rpass.rs#std` | 15.2 / 24.3 | 15.1 / 24.4 | −0.1 | 122 → 154 |
| `infinite_loop.rs` | 14.3 / 15.1 | 15.5 / 16.2 | +1.2 | 158 → 165 |
| `projection-cache-rematch-impl-141124.rs` | 14.2 / 18.4 | 13.9 / 18.3 | −0.3 | 131 → 121 |
| `let-else-drop-order.rs` | 13.6 / 20.6 | 13.7 / 20.7 | +0.1 | 113 → 151 |
| `macro-comma-support-rpass.rs#core` | 12.4 / 21.5 | 12.5 / 21.3 | +0.1 | 122 → 154 |
| `nested_panic_caught.rs` (new) | — | 10.9 / 16.5 | — | — → 158 |

The largest, `dynamic-drop.rs` at 39.9 s, leaves 20.1 s of the 60 s limit and is 5.1 s under the 45 s line of the 2026-11-10 decision.

**Nothing the gate needed lived in the deleted run dirs.**
- Root deleted only non-`gate-*` dirs. Of the scripts, only `gate.ts` (its own run), `criteria.ts` (the named gate's `gate.json`) and
  `frozen-lists.ts` read run dirs. `frozen-lists.ts` reads the `gate.json` `retryTimes` of the runs that `history.jsonl` lists as accepted,
  and all of those are `gate-*` runs. `miri-diff.ts`, `ir-tiers.ts`, `ir-diff.ts` and `difftest.ts` only write.
- 42 of the 45 accepted runs have their `gate.json`, including the latest three. The other 3 predate this host (N6).
- The frozen-lists step ran at 03:57Z, before the cleanup, and its output equals wave 40i's byte for byte.

## 6. Root's test-only commit `7418d6e1`

`src/std/fs.test.ts` at `103b447a` has blob `7418d6e1:src/std/fs.test.ts`. It is the only file `7418d6e1` touches (+29 −24), on top of
fixers-51's `c501cb3f`. root-w50-check.md (APPROVE WITH NITS) reviews `7418d6e1` and `85e77ec9` by SHA. **The merged file is the checked one.**

## 7. Coverage and criteria

`bun scripts/coverage.ts` at `9a03f050`: **24,394 / 27,053 fns ported (90.17%) across 66 crates**, against 24,330 in the README (N4).
Miri 1,506 / 1,535 (98.1%); `rustc_driver_impl` 68 / 77; `rustc_errors` 362 / 362; `rustc_metadata` 453 / 453; `rustc_abi` 273 / 273;
`rustc_session` 412 / 446; vendor 5,307 / 17,360 (60 crates); library 696 / 2,399 in 64 marked files (`library/proc_macro` 364 / 364,
`library/std` 231 / 1,182).

`scripts/criteria.ts --run gate-20261111-034856-root-qgwe` (gate at `103b447a5a`, `pass=true`):

| Group | Result | Threshold |
|---|---|---|
| M6b run-pass | 3,474 / 3,478 = 99.88%, met | 90% |
| M6b run-fail | 294 / 294 = 100%, met | 90% |
| M6b miri-pass | 354 / 360 = 98.33%, met | 80% |
| M7a ir-hello | not met: "ir-hello: not in this gate" | 100% |
| M7a mir-o2 | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a mono-ui | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a check-rg | 34 of 34 crates, met | 33 |

All unchanged from wave 40i, as expected for 0 gained.

## What I did not check

- **Protected cases outside my two re-runs.** Their status comes from the gate's jsonl, compared row by row with wave 40i's.
- **The lanes' code and their open nits** (driver-cli N1-N7, harness-cli N1-N4, harness-w50 N1-N4, fixers-51 N2-N4, root-w50-check
  N1-N6). Those belong to their reviews. I checked only that the merged files are the reviewed ones.
- **Typecheck and the unit steps** were not re-run. I relied on the gate log and junit reports.
- **The gate's exact oracle keys**, which need the Bun 1.4.3 binary that was replaced (§2 argues freshness without them).
- **Timings on a quiet host.** I never had one (§5).
- **Who changed Bun.** The evidence is the directory's mtime and the version.

## Side effects outside my scratchpad

**No oracle cache entry was written** (0 files under `oracle-cache` newer than 10:17Z). **No subject build was made**: binary mode refused
on Bun 1.4.4, and my re-runs used the gate's builds, read-only. `subject-bin/` holds the same four dirs as before. The upstream checkout is
clean (`git status --porcelain`: 0 paths), with no `rustc-ice-*` file.
- `.env.local` was copied into this worktree, with `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0` appended (gitignored).
  `bun install --frozen-lockfile` made this worktree's `node_modules` (gitignored, 37 MB).
- Three run dirs, 8 KB each: `$RUST_TS_DATA/runs/w40j-audit-npc-1`, `w40j-audit-npc-2`, `w40j-audit-tc6-1`.
- The Miri re-runs used their per-case `MIRI_TEMP` dirs under `$RUST_TS_DATA/tmp/miri-temp`, as the gate's runs of those cases do.
- The key dumps and difftests called suites' `cases()`, which touched the mtimes of 814 cached aux entries under `aux/`. Git refreshed the
  upstream checkout's index on the harness's cleanliness checks.
- `coverage.ts` rewrote `$RUST_TS_DATA/coverage.json` (from this worktree at `9a03f050`; figures in §7).
- The two archive trees, my patched `subjectBin` and the key dumps are in my scratchpad only. I deleted the trees afterwards.
