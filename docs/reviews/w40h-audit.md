PASS WITH NOTES

**Wave 40h's accept stands.** No protected case was lost, removed or tampered with. All 60 protected suites ran, and every one of the
542,092 protected ids in `harness/baseline/*.txt` at `088bdb33` is `MATCH` in the gate's jsonl. The baselines are byte-identical from
`f029cbe1` to `088bdb33`. I compared every row of the 60 suites (542,143 rows) on every field with the wave 40g gate. Only the same 15
retried cases differ, and only in `attempts` (their timings). No status, first difference or reason moved. The oracle keys of all 372,181
registered cases moved only where expected: host-rlib's 222 and rlib-native's 58 (both report-only), from harness-w48's `work.lock`
change to their runner scripts, which the keys hash. Every `harness/` and `scripts/` change came from the two reviewed batches, and the
merge brought exactly those commits. **The binary is the tested tree.** From a `git archive` tree of `46dff72a`, I recomputed both build
keys as `00cd7c6b…` and `bd1951d2…`, equal to `gate.json`, all 60 summaries and the builds' `meta.json` (inputs, config, spec, Bun). Neither
build has an `rts.map`, and **each `rts` is byte-identical to wave 40g's** (`cmp` against `2e56dd07…/rts` and `511e00b7…/rts`): the
`src/` tree did not change, only the builder's source did, which moves the key but not the binary. `-Ztrack-diagnostics` resolves frames
identically in binary and source. The new refusal works: the gate stops with one `ERROR:` line, before any work, for each of the 9
refused variables, and `gate.ts accept` is unaffected. Margins are steady (the binaries are the same), with no new retried case.

The notes are about the host, not the change: this gate ran under about 1.3x more load than wave 40g (N1), and wave 40g's two builds
(370 MB) are still on a tight disk (N2).

Regression audit, 2026-11-10. Gate `gate-20261110-113508-root-m7vn`, tested `46dff72a`, accepted `088bdb33`, `RUST_TS_SUBJECT=binary`.
The previous accept is wave 40g: gate `gate-20261110-023454-root-88uo`, tested `3541f8a5`, accepted `f029cbe1`, binary mode. I ran no
gate and no full suite. What I ran:
- a comparison of every row of all 60 suites' jsonl (and the `.skipped.jsonl` and `.extra.jsonl` files), this gate against wave 40g's,
  on every field, and every id of `harness/baseline/*.txt` at `088bdb33` (`git show`) against this gate's jsonl;
- `scripts/oracle-keys.ts` over every registered case, in `git archive` trees of `3541f8a5` and of `46dff72a` (the script is the same
  file at both);
- the subject-bin key, recomputed with `46dff72a`'s own `buildSpec`, `subjectBinKey` and `subjectBinKeyOf` from its archive tree, with the
  spec rebased onto the gate's repo path, against `gate.json` and `$RUST_TS_DATA/subject-bin/<hash>/meta.json`; `cmp` of the builds;
- `e0308.rs`, a 4-error file and `tests/ui/track-diagnostics/track{,6}.rs` with `-Ztrack-diagnostics` added to the `mir` argv, from
  source and from the gate's `00cd7c6b…/rts`;
- `difftest --sample 150 --raw-subject` of `mir`, `miri-pass` and `borrowck-ui-report` in source and in binary mode
  (`RUST_TS_AGENT=w40h-audit`), then `scripts/subject-bin-compare.ts`;
- `bun scripts/gate.ts run` with each refused variable set and a temp `RUST_TS_DATA`, to the refusal only (13 starts), and
  `bun scripts/gate.ts accept` with three of them set and a temp `RUST_TS_DATA` (9 starts);
- the per-test lists of the three junit reports, against wave 40g's; `gate.json` `retryTimes` and `host` of both gates;
- `bun scripts/coverage.ts` (summary) and `bun scripts/criteria.ts --run gate-20261110-113508-root-m7vn`.

Everything ran on AC power (`pmset -g batt` before each phase), with `RUSTUP_AUTO_INSTALL=0`, `RUST_TS_REQUIRE_PROBES=1` and
`RUSTC_ICE=0`. No gate was running (`.data/tmp/GATE_RUNNING` absent). I read code but changed none.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | low | **This gate ran under more load than wave 40g, and nothing in it explains the difference.** 1-minute load: median 48 (wave 40g 36), peak 181 (187, but that was one sample; the next was 69), and **26 of 147 samples above 100** (wave 40g: 1 of 145). Swap 2.2-3.9 GB (1.1-1.3 GB). The pool load at the 15 retried cases' timeouts was 87-198, against 45-73. The binaries are byte-identical to wave 40g's and the suites the same, so the extra load came from outside the gate (lanes, reviews or another session). Nothing was lost: the same 15 cases were retried, all finished alone at their wave 40g times, and the suites took 22,191 s against 21,562 s (+2.9%; `thirdump-ui` +21%, `tydump-nocore` +8%). But a pool timeout is what this load makes, and the solo retry is what saves it; with the near-limit cases at 38-40 s alone, a retry that starts under such load is the risk. Root may want to keep heavy lanes off while a gate runs | `gate.json` `host.samples`, `retryTimes[].load1` of both gates; per-suite `startedAt`/`endedAt` |
| N2 | info | **Wave 40g's two builds (`2e56dd07…`, `511e00b7…`, 370 MB) are still on disk**, beside this gate's, which are byte-identical to them. `pruneSubjectBins` removes them only after 3 days unused. With about 8 GiB free, root can delete them now: no accepted run needs them to reproduce, as `00cd7c6b…`/`bd1951d2…` hold the same `rts` | `cmp`; `ls $RUST_TS_DATA/subject-bin` |
| N3 | info | **The refusal message says "inherit it" when two variables are set** (`RUST_TS_IMPL=port and REGEN=1 set: every unit test would inherit it`). Cosmetic, beside harness-w48 review N3 (one group per refusal). It also refuses with `--skip-static`, when no unit test runs; harmless, and simpler as it is | §5 |
| N4 | info | **All claims are gone** (`docs/claims` does not exist at `088bdb33`): w40g-audit N6 is resolved by `46dff72a` | `git show --stat 46dff72a` |

## 1. Protected set: nothing lost

| Check | Result |
|---|---|
| Baselines `f029cbe1`..`088bdb33` | `git diff -- harness/baseline`: 0 lines. 60 files |
| Protected ids, `088bdb33` baselines, against this gate's jsonl | **542,092, every one `MATCH`**; none missing; no duplicate ids in a baseline or a jsonl |
| `gate.json` | `pass: true`, `staticOk`, `skipStatic: false`, `head` `46dff72a`, `dirty: []`, `unstableOk`, `upstreamOk`, `unitTestSkips` 1 allowed 1; every suite `lost: []`, `gained: []`, `lostSkipped: []`, `oracleTimeouts: []`, `upstreamChanges: []` |
| `history.jsonl` | the accept entry's per-suite protected/total equals wave 40g's in all 60 suites (542,092, 0 gained). `088bdb33` changes only `docs/next.md`, `docs/state/current.json` (the `updated` stamp) and `history.jsonl` (the accept). Between the two accepts `history.jsonl` gained two decisions (harness-w48's refusal; the solo retry staying in binary mode) |
| Unstable | `miri-pass` `tests/panic/panic1.rs`, as in wave 40g (listed in `harness/suites.ts`, not protected) |

**Every row, this gate against wave 40g's.** 542,143 rows in 60 suites, the same id set in each suite. 15 rows differ, and only in
`attempts`: the 15 retried cases, 6 in `mir` and 9 in `run-pass-miri`, **the same 15 as in wave 40g** (`retried` unchanged). No
`status`, first difference or other field moved. The `.skipped.jsonl` and `.extra.jsonl` files are byte-identical to wave 40g's in every
suite. The non-`MATCH` rows are the same 51 (DIFF 28, UNPORTED 20, TIMEOUT 2 in `run-pass-miri-heavy`, UNSTABLE 1), with identical records.

**Static steps** (gate log `.data/tmp/gate-w47.log`): `note: subject binary (… 00cd7c6b…, … bd1951d2…)`, then typecheck, unit tests,
alone, runner, markers, marker order, info sites, frozen lists: all `ok`. Frozen lists 48/48 `MATCH`, in binary mode with the same hashes.
The heavy cases' times are within 2% of wave 40g's (`check-core` 92.6 s against 91.0, `task-comm-6.rs` 162.4 s against 161.8).

| Junit report | wave 40g | wave 40h | Lost | Added |
|---|---|---|---|---|
| `unit-tests.junit.xml` | 7,396 (1 skip) in 625 files | 7,396 (1 skip, allowlisted `read_binary_file_handles_lying_stat`) | 0 (the one "lost" name is `json.oracle.test.ts`'s, which carries a temp-dir path; present under its new name) | 0 |
| `unit-tests.alone.junit.xml` | 39 | 39 | 0 | 0 |
| `runner-unit-tests.junit.xml` | 425 in 43 files | 434 in 43 files, 0 failures | 0 | 9: the 3 refusal tests in `gate-static-stop.test.ts`, 4 in `unit-steps.test.ts` (refusal, default mode, the two scans), and the `work.lock` test in `host-rlib.test.ts` and `rlib-native.test.ts` |

## 2. Expectation tampering: none

`git diff 3541f8a5 46dff72a` outside `docs/`: 2 files in `harness/` (both tests) and 13 in `scripts/`. **No file in `src/`, `tools/`,
`harness/baseline/`, `harness/suites.ts`, oracle outputs, `package.json`, `tsconfig.json`, `bunfig.toml`, `bun.lock` or `UPSTREAM.json`
changed.**

| File | Change | Effect on expectations |
|---|---|---|
| `scripts/gate.ts` | `gateRun` refuses on `unitEnvRefusal(process.env)` after `freezeEnvRefusal()`; `crashedLine` (wording when the gate's limit killed a one-process `bun test`); `outputTail` splits on `\r?\n` | none: a refusal before the run, and report wording |
| `scripts/lib/unit-steps.ts` (+ test) | `UNIT_ENV_REFUSED` (9 variables with reasons), `unitEnvRefusal`; comment | none: the gate refuses rather than changing any step's environment |
| `scripts/host-rlib-run.ts`, `scripts/rlib-native-run.ts` (+ `harness/*.test.ts`) | each run holds `<case dir>/work.lock` and registers its compilers as holders | the printed report is unchanged; the script's hash is in these report-only suites' oracle keys, which therefore moved (below) |
| `scripts/lib/subject-bin.ts` | `buildFiles` deletes `rts.map` after a build and refuses any other stray file; comments | builder source is in the build key, so the keys moved and the gate built afresh; the bundle inputs and options are unchanged, and so is the binary (§3) |
| `scripts/gate-power.test.ts`, `gate-probes.test.ts`, `gate-static-stop.test.ts`, `gate-unit.test.ts` | the tests that start a real `gateRun` unset the refused variables; new refusal cases and the new wording | none; no assertion was loosened (the old crash wording is replaced by the new one in the same check) |
| `scripts/subject-bin.cases.ts` | the frame test with no `rts.map`, `buildFiles` test, the bench tool's helpers | tests only |
| `scripts/subject-bin-bench.ts` (new), `scripts/subject-bin-order.ts` | timing tool; the order tool refuses a missing `--` | dev tools, not in the gate |

**Reviewed batches.** `3789f879` is harness-w48 (docs/reviews/harness-w48.md, APPROVE WITH NITS, reviewed at exactly `3789f879`).
`60d583e6`, `09c19f1f`, `b6be5313` are perf-subject-bin (docs/reviews/perf-subject-bin.md, APPROVE WITH NITS, reviewed at `b6be5313`).
The base of both, `bbde79e5`, has the same `harness/ scripts/ src/ tools/` as `3541f8a5`, and `git diff 3789f879 46dff72a` over those
paths equals `git diff bbde79e5 b6be5313` byte for byte (index lines aside), so the merges brought exactly the reviewed changes and
nothing else. No harness or scripts commit went unreviewed.

### Oracle keys

`scripts/oracle-keys.ts` over every registered case, in `git archive` trees of each commit: **372,181 keys in 72 suites at both
commits, the same case ids in the same order, 0 suites not listed, 0 `ERROR` lines.** The dump sha1 is `5d0766429cc8…` at `3541f8a5`
(the w40g audit's) and `6d1b393ca382…` at `46dff72a` (harness-w48 review's). **The keys that differ are exactly host-rlib's 222 of 222
and rlib-native's 58 of 58**, both report-only (no baseline in `harness/baseline/`). `oracleCacheKey` hashes each suite's
`oracleKey()`, which for these two includes their runner scripts; harness-w48 changed both. So their report caches miss once, as the
handoff says. Nothing else moved: no protected case's oracle was re-run or rewritten.

## 3. The binary is the tested tree

| Check | Result |
|---|---|
| Key of `src/rust_ts/main.ts` at `46dff72a` | **`00cd7c6b1639e49abde5df4f568c0042b5ccb43f`**, 2,097 inputs |
| Key of `src/miri/bin/miri.ts` at `46dff72a` | **`bd1951d2bf6a850d6b40fa5c2e2a804e0d164f78`**, 2,285 inputs |
| `gate.json` `subject`, and all 60 `<suite>.summary.json` `subject` | `mode: binary` with exactly these two hashes (60 of 60); the frozen lists run too |
| `meta.json` of each build | `hash`, `entry`, `spec` equal; the `inputs` list (paths and sha1s) and `config` (`tsconfig.json`, `package.json`, `bunfig.toml`, `bun.lock`) **identical** to the recomputation; Bun 1.4.3 `c6da4a4d`; built 11:35:12Z and 11:35:16Z, 4 s after `46dff72a` was committed and before the suites (11:43:48Z) |
| `rts.map` | **absent** from both builds (each holds `meta.json` and `rts` only). Root's deletion of the two wave 40g maps (perf-subject-bin review N3) holds too |
| Against wave 40g's builds | `inputs`, `config` and `spec` equal, and **`rts` byte-identical** (`cmp`: 181,955,186 and 186,941,810 bytes). Only `scripts/lib/subject-bin.ts` changed among the key's parts |

How: in the `46dff72a` archive tree, with that tree as the cwd, `buildSpec` + `subjectBinKey` give the inputs and config; the spec is
rebuilt with `buildSpec(entry, "/Users/tomernorman/Documents/personal/rust-ts", "/Users/tomernorman/.bun/bin/bun")`, and
`subjectBinKeyOf` is applied with the sha1 of the tree's own `scripts/lib/subject-bin.ts` as the builder.

**`-Ztrack-diagnostics`.** The `mir` suite's argv (`--target x86_64-unknown-linux-gnu --sysroot <oracle> -Zwrite-long-types-to-disk=no`)
with `-Ztrack-diagnostics --edition=2021`, cwd the upstream checkout, `RUST_TS_IMPL=port`, from source (this worktree, same `src/` as
`46dff72a`) and from the gate's `00cd7c6b…/rts`:

| Input | Source | Binary |
|---|---|---|
| `e0308.rs` (`let x: u32 = "a"`) | exit 1, 596 bytes, sha1 `3ec27d671f14`, `created at /rustc-dev/6f5da406…/compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2242:35` | **identical** |
| a 4-error file | exit 70, `unported: std::panic::Location::caller (DiagLocation Display)`, sha1 `808d364ac5f5` | **identical** |
| `tests/ui/track-diagnostics/track.rs`, `track6.rs` | the same exit 70 | **identical** |

So the embedded map still resolves frames to the same location with no `rts.map` beside the binary; the second kind stops at the same
known `unported` in both modes, as in the perf-subject-bin review. No protected case passes `-Ztrack-diagnostics`.

## 4. Binary against source

From this worktree, at `088bdb33` (the same `src/`, `harness/` and `scripts/` as `46dff72a`), `RUST_TS_AGENT=w40h-audit`, AC power, the
upstream checkout clean before and after. Per suite: `RUST_TS_SUBJECT=source` and then `RUST_TS_SUBJECT=binary` `difftest --suite S
--sample 150 --raw-subject <dir>`, then `scripts/subject-bin-compare.ts <source dir> <binary dir>`. I picked suites the w40g audit did
not sample (it took `mir`, `run-pass-miri`, `mono-ui`, `run-fail-miri`), except `mir`, which the brief names. Binary mode built this
worktree's own builds (`675f7d04…` for main.ts and `78e44025…` for miri.ts; the key covers the repo path). **Their `meta.json` `inputs`,
`config` and `bun` are identical to the gate builds', and their `rts` sizes equal (181,955,186 and 186,941,810 bytes)**, so they hold the
same files. I deleted both afterwards.

| Suite | Source | Binary | Compare | Sample in the gate | Subject s (source → binary) |
|---|---|---|---|---|---|
| `mir` | 150 MATCH | 150 MATCH | **150/150 same**, 0 differs, 0 pid-masked, 0 missing, 0 timed out | 150 protected, all MATCH | 244.5 → 89.8 |
| `miri-pass` (Miri) | 147 MATCH, 3 UNPORTED | 147 MATCH, 3 UNPORTED | **150/150 same** | 147 protected, all MATCH; the 3 UNPORTED (`socket.rs`, `socket-no-blocking.rs`, `intrinsics-x86-aes-vaes.rs`) are non-protected and UNPORTED in the gate with the same reasons (sockets out of scope in M6; `aes` not vendored) | 830.9 → 608.3 |
| `borrowck-ui-report` | 150 MATCH | 150 MATCH | **150/150 same** | 150 protected, all MATCH | 267.7 → 275.8 |

The comparison is of the raw process records (command after the subject prefix, exit code, stdout, stderr) and does not go through the
oracle or the statuses. **No process differed in any byte.** In all, 447 of the 450 sampled cases are protected, and each is `MATCH` in
source, in binary and in the gate.

## 5. The new refusal

`bun scripts/gate.ts run` from this worktree with `RUST_TS_DATA` pointed at an empty temp directory (so a failure to refuse would have
found no upstream checkout), each run killed after 30 s if it had not exited. None needed it.

| Set | Result |
|---|---|
| `RUST_TS_IMPL=port`; `RUST_TS_IMPL=shim --suites mir`; `REGEN=1`; `RUST_TS_WRITE_ORACLE=1`; `TYREPR_WRITE=` (empty); `TYPRINT_WRITE=1`; `TYCONSTS_WRITE=1`; `TYREPR_PROBE=x`; `TYPRINT_PROBE=x`; `TYCONSTS_PROBE=x`; `RUST_TS_IMPL` + `REGEN`; `RUST_TS_IMPL` with `--allow-battery --skip-static` | **exit 1, exactly one line, starting `ERROR: <VAR>=<value> set: every unit test would inherit it (<reason>) …`**, in 16-17 ms; nothing written to the temp data directory |
| `NODE_ENV=production` (the older refusal) | exit 1, one `ERROR:` line, unchanged |

In the code the refusal is the second statement of `gateRun`, after only the suite-name check and before the host sample, the
`GATE_RUNNING` marker, the clean-tree check and every step. By the code (not run), a variable set only in `.env.local` is refused too, since `common.ts` loads that file
into `process.env` at import. The gate's own run shows the refusal did not fire on the real start (no such variable was set).

**`gate.ts accept` is unaffected.** With `RUST_TS_IMPL=port`, `REGEN=1` or `TYREPR_WRITE=` set and a temp `RUST_TS_DATA`, accept ran its
normal checks and stopped on its own reasons: a missing run (`no gate result at …`), a copied `pass: false` result (`did not pass;
nothing accepted`), and a copy of this gate's `gate.json` (`tested 46dff72a5d but HEAD is 088bdb337b`). `gateAccept` does not read
`unitEnvRefusal`. No baseline or tree file changed (`git status` clean after).

## 6. Margins

Solo times from `gate.json` `retryTimes` (wall / user, max RSS), the same 15 cases in both gates, all finished alone and `MATCH`:

| Case | wave 40g | wave 40h | pool load at timeout (40g → 40h) |
|---|---|---|---|
| `dynamic-drop.rs` | 39.6 / 48.4 s, 2,135 MB | **39.5 / 48.1 s**, 2,134 MB | 66 → 166 |
| `issue-8827.rs` | 39.0 / 46.6 s, 1,949 MB | **38.4 / 45.7 s**, 1,947 MB | 70 → 198 |
| `error-tainting-issue-122904.rs` | 28.8 / 33.2 s, 3,893 MB | **27.9 / 32.0 s**, 3,890 MB | 48 → 87 |
| `recursive-drop-elaboration-2.rs` | 29.2 / 33.6 s, 3,907 MB | **27.9 / 32.4 s**, 3,932 MB | 46 → 92 |
| `recursive-drop-elaboration.rs` | 28.5 / 32.8 s, 3,914 MB | **27.9 / 32.2 s**, 3,913 MB | 46 → 92 |
| `move-3-unique.rs` | 27.1 / 32.4 s | 27.6 / 32.8 s | 68 → 178 |
| `repeated-vector-syntax.rs` | 20.8 / 26.8 s | 20.7 / 26.8 s | 48 → 140 |
| `issue-52475.rs` | 20.4 / 21.1 s | 20.4 / 21.2 s | 61 → 153 |
| `recursion-etc.rs` | 17.5 / 19.6 s | 16.8 / 18.8 s | 66 → 194 |
| `unique-send-2.rs` | 16.0 / 22.7 s | 16.2 / 23.0 s | 42 → 132 |
| `macro-comma-support-rpass.rs#std` | 15.0 / 23.8 s | 15.0 / 24.1 s | 73 → 162 |
| `infinite_loop.rs` | 15.4 / 16.1 s | 14.3 / 15.0 s | 61 → 153 |
| `let-else-drop-order.rs` | 13.8 / 20.8 s | 13.7 / 20.9 s | 66 → 159 |
| `projection-cache-rematch-impl-141124.rs` | 14.5 / 18.8 s | 14.1 / 18.4 s | 57 → 124 |
| `macro-comma-support-rpass.rs#core` | 12.2 / 21.1 s | 12.5 / 21.2 s | 73 → 162 |

**Steady**: every solo time is within ±1.3 s of wave 40g's, as expected from byte-identical binaries, and the largest, `dynamic-drop.rs`
at 39.5 s, leaves 20.5 s of the 60 s limit and 5.5 s under the 45 s line of the 2026-11-10 decision. **No new retried case.** The pool
load at the timeouts was about 2-3x wave 40g's (N1), yet the same cases timed out and no other did.

**Power and host.** `host.allowBattery` false, `powerLost` `[]`. 147 samples, all on AC, every one with a power reading, largest gap 660 s.
AC at both marks of all 60 suites. Load and swap: N1. Up 6 days, no reboot.

## 7. Coverage and criteria

`bun scripts/coverage.ts` at `088bdb33`: **24,293 / 27,053 fns ported (89.80%) across 66 crates**; Miri 1,506 / 1,535 (98.1%);
`rustc_session` 411 / 446; vendor 5,307 / 17,360 (60 crates); library 578 / 2,017. These equal wave 40g's figures and
`bun scripts/state.ts summary`; no `src/` file changed in this wave.

`scripts/criteria.ts --run gate-20261110-113508-root-m7vn` (gate at `46dff72a5d`, `pass=true`):

| Group | Result | Threshold |
|---|---|---|
| M6b run-pass | 3,474 / 3,478 = 99.88%, met | 90% |
| M6b run-fail | 294 / 294 = 100%, met | 90% |
| M6b miri-pass | 350 / 360 = 97.22%, met | 80% |
| M7a ir-hello | not met: "ir-hello: not in this gate" | 100% |
| M7a mir-o2 | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a mono-ui | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a check-rg | 34 of 34 crates, met | 33 |

These equal wave 40g's results.

## What I did not check

- **Protected cases outside my samples** were not re-run. Their status comes from the gate's jsonl, compared row by row with wave 40g's.
- **Solo timing runs of my own.** The binaries are byte-identical to wave 40g's, which the w40g audit timed alone; I relied on the gate's
  retry times.
- **The harness-w48 and perf-subject-bin code beyond the paths above**, and their reviews' open nits. Those belong to their reviews.
- **Typecheck and the unit steps** were not re-run. I rely on the gate's log and junit reports.
- **What produced N1's load.** The gate records the load, not its source.

## Side effects outside my scratchpad

**No oracle cache entry was written:** no file under `oracle-cache` is newer than the start of this audit (17:57Z). The upstream checkout
is clean (`git status --porcelain`: 0 paths, after the frame runs and after the difftests), with no `rustc-ice-*` file.
- `.env.local` copied into this worktree, with `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0` appended (gitignored).
- Six run directories, 168 KB in all: `$RUST_TS_DATA/runs/w40h-audit-{source,binary}-{mir,miri-pass,borrowck-ui-report}`. They are
  report files, and nothing compared reads them.
- Two subject builds keyed to this worktree's path (`$RUST_TS_DATA/subject-bin/675f7d04…`, `78e44025…`, about 370 MB), made by the
  binary half of section 4. **I deleted them.** Nothing of mine touched the gate's builds (`meta.json` mtimes 11:43:39Z, `rts` 11:35Z,
  unchanged); I ran their `rts` directly. Building ran `pruneSubjectBins`, which removed nothing (wave 40g's builds are still there, N2).
- The key dumps and difftests called suites' `cases()`, which touched the mtimes of 814 cached aux entries under `aux/`. Git refreshed the
  upstream checkout's index on the harness's cleanliness checks.
- `coverage.ts` rewrote `$RUST_TS_DATA/coverage.json` (from this worktree, at `088bdb33`, same figures).
- The refusal and accept checks used temp `RUST_TS_DATA` directories in my scratchpad (since deleted); nothing was written to the real
  one. The frame runs and the difftests used the upstream checkout as cwd, as the harness does, with `RUSTC_ICE=0`.
