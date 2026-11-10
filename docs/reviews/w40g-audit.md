PASS WITH NOTES

**Wave 40g's accept stands.** No protected case was lost, removed or tampered with. All 60 protected suites ran, and every one of the
542,092 protected ids is `MATCH` in the gate's jsonl. The baselines are byte-identical from `6637fe41` to `f029cbe1`. I compared every
row of the 60 suites (542,143 rows) on every field with the wave 40f gate. Only the 15 retried cases differ, and only in their timing
fields (`attempts`, `retried`). No status, first difference or `unported` reason moved. The oracle keys of all 372,181 registered cases
are byte-identical at `0638cdfa` and `3541f8a5` (dump sha1 `5d076642…`, at both commits). **The binary is the tested tree.** From a
`git archive` tree of `3541f8a5`, I recomputed both build keys as `2e56dd07…` and `511e00b7…`. They equal `gate.json` `subject`, all 60
`<suite>.summary.json` files, and the cached builds' `meta.json`, whose inputs (2,097 and 2,285 files with their sha1s), config files and
spec are identical to my recomputation. On 4 protected suites at `--sample 150` (`mir`, `run-pass-miri`, `mono-ui`, `run-fail-miri`), source
and binary gave byte-identical raw output in all 600 subject processes. 598 of the cases are protected and `MATCH` in the gate; the other
2 are `mono-ui`'s known non-protected DIFFs, which are also identical between modes. Root's two test-only commits are correct, and neither weakens a test. **The margin cost is real, and close to root's figure.**
Alone on an idle machine, the gate's binary takes 11-12% more wall time and 14% more user time than source on all three long cases.
`dynamic-drop.rs` takes 39.5 s of 60, so 20.5 s of room is left (N1).

Regression audit, 2026-11-10. Gate `gate-20261110-023454-root-88uo`, tested `3541f8a5`, accepted `f029cbe1`, `RUST_TS_SUBJECT=binary`.
The previous accept is wave 40f: gate `gate-20261109-084958-root-eit4`, tested `0638cdfa`, accepted `6637fe41`, source mode. I ran no
gate and no full suite. What I ran:
- a comparison of every row of all 60 suites' jsonl (and the `.skipped.jsonl` and `.extra.jsonl` files), this gate against wave 40f's,
  on every field, and every id of `harness/baseline/*.txt` at `f029cbe1` against this gate's jsonl;
- `scripts/oracle-keys.ts` (the `3541f8a5` version, copied into the older tree) over every registered case, in `git archive` trees of
  `0638cdfa` and of `3541f8a5`;
- the subject-bin key, recomputed with `3541f8a5`'s own `buildSpec`, `subjectBinKey` and `subjectBinKeyOf` from its archive tree, with the
  spec rebased onto the gate's repo path, for both entries, against `gate.json` and `$RUST_TS_DATA/subject-bin/<hash>/meta.json`;
- `difftest --sample 150 --raw-subject` of `mir`, `run-pass-miri`, `mono-ui` and `run-fail-miri` in source and in binary mode
  (`RUST_TS_AGENT=w40g-audit`), then `scripts/subject-bin-compare.ts`;
- `dynamic-drop.rs`, `issue-8827.rs` (run-pass-miri) and `recursive-drop-elaboration.rs` (mir), 3 times each alone, in source mode and
  with **the gate's own binaries**, with the harness's argv, cwd, `caseEnv`, `run()` and 60 s limit (`s.subject([c])`, `cwdOf(s)`);
- the per-test lists of the three junit reports, against wave 40f's; a regex check of `ef609b6f`'s new pattern;
- `bun scripts/coverage.ts` (summary) and `bun scripts/criteria.ts --run gate-20261110-023454-root-88uo`.

Everything ran on AC power (`pmset -g batt` before and after each phase), with `RUSTUP_AUTO_INSTALL=0`, `RUST_TS_REQUIRE_PROBES=1` and
`RUSTC_ICE=0`. No gate was running (`.data/tmp/GATE_RUNNING` absent). I read code but changed none.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | medium | **The binary costs 11-12% more wall time and 14% more user time on long cases, measured alone on an idle machine.** Medians of 3 alone (load 1.9-2.1): `dynamic-drop.rs` 35.4 s to **39.5 s** wall (user 42.3 to 48.1 s), `issue-8827.rs` 35.3 to **39.1 s** (41.0 to 46.6), `recursive-drop-elaboration.rs` 25.5 to 28.3 s (28.5 to 32.5). Each spread is 1 s or less. This confirms root's figure, a little lower in wall time: the gate's solo retries gave +11 to +17% wall and +14 to +19% user over wave 40f for the 7 cases retried in both gates. The two Miri cases now have about 20.5 s of room, against about 25 s in wave 40f. They are 5-6 s under the 45 s line of the 2026-11-09 decision. They do not finish in the 12-job pool in either mode, so they rely on the solo retry. Short cases are still far cheaper in the binary: the suites took 21,562 s in total, against 37,882 s (0.57x). The cost per long case should go to the queued performance lane before the corpus grows: a few more percent puts these two near 45 s | §6 table; `gate.json` `retryTimes` of both gates |
| N2 | low | **The binary needs about 20% more memory on the TAIT cases.** Alone, `recursive-drop-elaboration.rs` peaks at 3,897-3,942 MB in the binary, against 3,155-3,263 MB from source (my runs). The gate's retries agree: 3,893-3,914 MB, against 3,257-3,274 MB in wave 40f, for all three TAIT cases. The Miri cases do not change (2.1 and 1.9 GB). Nothing failed, but 12 jobs of such cases at once would need about 47 GB. Worth a line in the performance lane's brief, beside N1 | §6; `retryTimes[].alone.maxRssMb` |
| N3 | low | **Each build holds an unrecorded 63-67 MB `rts.map` next to `rts`.** The two gate builds are 182 MB + 63 MB and 187 MB + 67 MB. The handoff says Bun embeds the map in the binary (section 4.1), and neither `subject-bin.ts`, `meta.json` nor the handoff mentions the file. So a build is about 250 MB, not "~160 MB" (`PRUNE_AFTER_MS` comment, subject-bin review N5). Disk was the limit in this wave (2.6 GiB free before root's cleanup). Either drop the file after the build, if nothing reads it, or record it and fix the size in the comment | `ls -la $RUST_TS_DATA/subject-bin/*/` |
| N4 | info | **One host sample in this gate shows a 1-minute load of 187**, at 04:52:55Z, during `resdump-nocore` (5- and 15-minute loads 95 and 64). That is 2.7 times wave 40f's peak (68). The next highest sample in this gate is 69. Nothing was lost, `resdump-nocore` took 1.13x its wave 40f time, and no retry falls in that suite. `resdump*`, `tydump*` and `mono-ui` still run their dump wrappers from source (1.04-1.13x, against 0.14-0.46x for the main.ts suites). Root may want to know whether another lane was running then | `gate.json` `host.samples`; per-suite `startedAt`/`endedAt` |
| N5 | info | **`ef609b6f` is the only harness/scripts commit of this wave without an independent pass before the gate,** as planned: it fixes root-w46-check2's F1 and goes to this audit (§5). Every other `harness/` and `scripts/` commit from `0638cdfa` to `3541f8a5` was checked: `a5b7e0fd` and `bb3c6948` by subject-bin, `344a014d` by root-w46-check, `2a9930d7` by root-w46-check2, `9bd994f1` by root-w47-check | §2 |
| N6 | info | **Two stale claims.** `docs/claims/fixers-50.md` and `docs/claims/subject-bin.md` (from `9015f665`) are still in the tree at `f029cbe1`, although both lanes are merged. AGENTS §3 says to delete a claim when the work is done | `ls docs/claims` |

## 1. Protected set: nothing lost

| Check | Result |
|---|---|
| Baselines `6637fe41`..`f029cbe1` | `git diff -- harness/baseline`: 0 lines. 60 files |
| Protected ids, `f029cbe1` baselines, against this gate's jsonl | **542,092, every one `MATCH`**; none missing; no duplicate ids |
| `gate.json` | `pass: true`, `staticOk`, `skipStatic: false`, `head` `3541f8a5`, `dirty: []`, `unstableOk`, `upstreamOk`; every suite `lost: []`, `gained: []`, `lostSkipped: []`, `oracleTimeouts: []`, `upstreamChanges: []` |
| `history.jsonl` | the accept entry's per-suite protected/total equals wave 40f's in all 60 suites (0 gained). `f029cbe1` changes only `docs/next.md`, `docs/state/current.json` (the `updated` stamp) and `history.jsonl` (the accept and a decision) |
| Unstable | `miri-pass` `tests/panic/panic1.rs`, as in wave 40f (listed in `harness/suites.ts`, not protected) |

**Every row, this gate against wave 40f's.** 542,143 rows in 60 suites, the same id set in each suite. 15 rows differ, and only in
`attempts` (7) or `attempts` + `retried` (8): the 15 retried cases, 6 in `mir` and 9 in `run-pass-miri`. No `status`, first difference or
other field moved. The `.skipped.jsonl` and `.extra.jsonl` files are byte-identical to wave 40f's in every suite. The non-`MATCH` rows are
the same 51 as before (DIFF 28, UNPORTED 20, TIMEOUT 2 in `run-pass-miri-heavy`, UNSTABLE 1), with identical records.

**The retries.** All 15 finished alone and are `MATCH`. 8 were new, all below 21 s alone: `infinite_loop.rs` 15.4 s, `issue-52475.rs`
20.4 s, `projection-cache-rematch-impl-141124.rs` 14.5 s (mir), and `unique-send-2.rs` 16.0, `recursion-etc.rs` 17.5,
`let-else-drop-order.rs` 13.8, `macro-comma-support-rpass.rs#core` 12.2 and `#std` 15.0 s (run-pass-miri). They timed out in a pool
whose 1-minute load was 42-73 (wave 40f: 32-56). The pool user times at the timeout were lower than in wave 40f (20-35 s, against 32-41 s),
so these are contention timeouts, not slow cases. The 7 cases retried in both gates are in §6.

## 2. Expectation tampering: none

`git diff 0638cdfa 3541f8a5` outside `docs/` and `src/`: `README.md` (coverage figure), `harness/suites.ts` and 13 files in `scripts/`.
No baseline, oracle output, `tools/`, `package.json`, `tsconfig.json`, `bunfig.toml`, `bun.lock` or `UPSTREAM.json` changed.

| File | Change | Effect on expectations |
|---|---|---|
| `harness/suites.ts` | `bunCmd` now calls `subjectCmd(script)`; `miriSubjectOf` calls `subjectCmd(MIRI_DRIVER_ENTRY, args, { preload })`; one comment | subject command only. In source mode `subjectCmd` returns exactly the old array (`[execPath, (--preload <repo>/X), <repo>/<entry>, ...args]`). No oracle command, case list, timeout, skip or key reads it |
| `scripts/difftest.ts` | `runSubjectProcess` (optional `--raw-subject` record), `prepareSubject()` before any case, `subject` in the summary | none: the record only writes a file; the statuses are computed as before |
| `scripts/gate.ts` | `prepareSubject()` before the static steps, `subject` in both `gate.json` writes, header | none |
| `scripts/lib/unit-steps.ts` (+ its test, `gate-unit.test.ts`) | `unitStepEnv` adds `RUST_TS_SUBJECT: "source"` | the unit tests run the harness in source mode (root-w47-check) |
| `scripts/phase-diff.ts` | subject via `subjectCmd` | dev tool, not in the gate |
| `scripts/lib/subject-bin.ts`, `subject-bin.ts`, `subject-bin-compare.ts`, `subject-bin-order.ts`, `subject-bin.cases.ts`, `subject-bin.test.ts`, `oracle-keys.ts` | new | the builder and its tools and tests |

**Reviewed batches.** `a5b7e0fd`, `bb3c6948`: subject-bin review (REQUEST CHANGES; F1, F2, N3 fixed in `344a014d`). `344a014d`:
root-w46-check, APPROVE WITH NITS. `2a9930d7`: root-w46-check2, REQUEST CHANGES (F1). `ef609b6f` (the F1 fix): this audit, item 5.
`9bd994f1`: root-w47-check, APPROVE WITH NITS. So every change came through a reviewed batch, and `ef609b6f` was routed here (N5).

### Oracle keys

`scripts/oracle-keys.ts` over every registered case, run in `git archive` trees of each commit (the script copied into the
`0638cdfa` tree, which predates it): **372,181 keys in 72 suites at both commits, 0 suites not listed, dump sha1
`5d0766429cc8b685d9c12369a5ae59dd2a5049db` at both, `cmp` identical.** The same sha1 is in the subject-bin review (its check 6). No case
was added or removed, and no key changed, so no oracle was re-run and no cache entry was rewritten for this wave. (The 3 dump lines
that contain `ERROR` are the revision `tests/ui/std/overflow-check-ops.rs#ERROR`, not errors.)

### Tests

| Check | Result |
|---|---|
| Per test, against wave 40f's three junit reports | 672 files with 7,860 tests, against 670 files with 7,854. **No test lost.** New: the `subject-bin.test.ts` wrapper, `archive.test.ts` (1), `path.test.ts` +1, `code_stats.oracle.test.ts` +3 (the ties). The only "removed" name is `json.oracle.test.ts`'s, which carries a random temp-dir name; it is present under its new name |
| Runner unit tests | 425 tests, 0 failures, 0 skipped (wave 40f: 424). The wrapper passed in 1.55 s with 2 assertions |
| Unit tests | 7,396 tests, 0 failures, 1 skip (allowlisted: `read_binary_file_handles_lying_stat`); alone 39, 0 failures |
| Static steps (gate log `.data/tmp/gate-w46b.log`) | `note: subject binary (… 2e56dd07…, … 511e00b7…)`, then typecheck, unit tests, alone, runner, markers, marker order, info sites, frozen lists: all `ok`. Frozen lists 48/48 `MATCH`, in binary mode with the same hashes |

## 3. The binary is the tested tree

| Check | Result |
|---|---|
| Key of `src/rust_ts/main.ts` at `3541f8a5` | **`2e56dd07727194dd634e919642a45afc264d8d9e`**, 2,097 inputs |
| Key of `src/miri/bin/miri.ts` at `3541f8a5` | **`511e00b725c6720d700941c4a16c0cbe48f2c733`**, 2,285 inputs |
| `gate.json` `subject`, and all 60 `<suite>.summary.json` `subject` | `mode: binary` with exactly these two hashes (60 of 60) |
| `meta.json` of each build | `hash`, `entry` and spec equal; the `inputs` list (paths and sha1s) and the `config` list (`tsconfig.json`, `package.json`, `bunfig.toml`, `bun.lock`) are **identical** to the ones recomputed from the archive tree; Bun 1.4.3 `c6da4a4d`, the one `VALIDATED_BUN` entry |
| When built | `rts` mtime 01:39:01Z, `builtAt` 01:39:03Z and 01:39:07Z: built for the first try (`a37f0d84`). Between `a37f0d84` and `3541f8a5` only `scripts/lib/unit-steps.ts`, its tests and `docs/` changed, none of them a bundle input or `subject-bin.ts`, so the key is the same, and the gate found the build in the cache. `meta.json` mtime 02:43:35Z, when the gate resolved it (the suites started at 02:43:42Z); `rts` was not touched after the build |

How: in the `3541f8a5` archive tree, with that tree as the cwd, `buildSpec` + `subjectBinKey` give the inputs and config. The spec is
rebuilt with `buildSpec(entry, "/Users/tomernorman/Documents/personal/rust-ts")` (the gate's repo; the key covers `repo`, `entryPath`,
the banner and `Bun.main`), and `subjectBinKeyOf` is applied with the sha1 of the tree's own `scripts/lib/subject-bin.ts` as the builder.
A stale build would show as a different key or a different input list. Neither does.

## 4. Binary against source

From this worktree, at `f029cbe1` (the same `src/` as `3541f8a5`), `RUST_TS_AGENT=w40g-audit`, AC power, upstream checkout clean before and
after. Per suite: `RUST_TS_SUBJECT=source` and then `RUST_TS_SUBJECT=binary` `difftest --suite S --sample 150 --raw-subject <dir>`, then
`scripts/subject-bin-compare.ts <source dir> <binary dir>`. Binary mode built this worktree's own builds (`336bddfc…` for main.ts and
`1a478835…` for miri.ts; the key differs because it covers the repo path). **Their `meta.json` `inputs`, `config` and `bun` are identical to
the gate builds' (`2e56dd07…`, `511e00b7…`)**, so they hold the same files. I deleted both afterwards.

| Suite | Source | Binary | Compare | Sample in the gate | Subject s (source → binary) |
|---|---|---|---|---|---|
| `mir` | 150 MATCH | 150 MATCH | **150/150 same**, 0 differs, 0 missing, 0 timed out | 150 protected, all MATCH | 250.9 → 100.8 |
| `run-pass-miri` | 150 MATCH | 150 MATCH | **150/150 same** | 150 protected, all MATCH | 565.8 → 400.2 |
| `mono-ui` | 148 MATCH, 2 DIFF | 148 MATCH, 2 DIFF | **150/150 same** | 148 protected MATCH; the 2 DIFFs (`callee_is_track_caller.rs`, `def-path-hash-ice-157238.rs`) are DIFF in the gate with the same first difference | 444.0 → 388.2 |
| `run-fail-miri` | 150 MATCH | 150 MATCH | **150/150 same** (no pid masking needed) | 150 protected, all MATCH | 767.8 → 623.2 |

The comparison is of the raw process records (command after the subject prefix, exit code, stdout, stderr) and does not go through the
oracle or the statuses. **No process differed in any byte.** The same holds for the gate's own binaries: in the 18 timing runs of
section 6, each of the three cases gave one output (exit code, stdout, stderr with the panic pid masked) across all runs in both modes.

These samples are short cases, mostly. The binary is faster on them, because they are dominated by start-up. The cost of N1 shows only in
long cases.

## 5. Root's test-only commits

**`60cc3471`** (`src/rustc_session/code_stats.oracle.test.ts`). Two comment lines become three, saying that `closures.rs`'s ties also print the
same in insertion order, so only `upvars.rs` and `locals.rs` pin FxHashSet order. The per-file title changes from `ties in FxHashSet order`
to `ties as the oracle prints them`. **No assertion changed.** The new header is what root-w46-check found by mutation (the insertion-order
mutation passes `closures.rs` and fails the other two), so it is accurate, and the title is right for all three files. No allowlist or other
file names the old title. In the gate's `unit-tests.junit.xml`, all three ties tests ran (not skipped), with 3, 4 and 4 assertions. Correct,
and no weakening.

**`ef609b6f`** (`scripts/subject-bin.test.ts`, `scripts/subject-bin.cases.ts`).
- **F1, at least one pass.** The pattern goes from `/\n\s*\d+ pass\n\s*0 fail\n/` to `/\n\s*[1-9]\d* pass\n\s*0 fail\n/`. The exit-0 and
  no-`(fail)` assertion before it is unchanged. Checked on sample summaries: `0 pass / 0 fail` is rejected, `19 pass` and `10 pass` are
  accepted, and `1 skip` between the two lines, `1 fail` or `05 pass` are rejected. That is the fix root-w46-check2 asked for, and it is
  stricter than before. It does not pin the count (19), as that review accepted; a cases file that lost some of its tests would still pass
  (no change from before).
- **N1, the timeout.** The child gets `--timeout=${UNIT_TEST_TIMEOUT_MS}` (60,000, the gate's value), imported from `scripts/lib/unit-steps.ts`,
  which has no imports, so loading it loads nothing else. Before, the child ran under Bun's 5 s default. This loosens a timeout only up to
  the gate's own policy, and the wrapper keeps its 600 s limit.
- **N3.** `buildSpec("scripts/subject-bin.test.ts")` becomes `buildSpec("scripts/subject-bin.cases.ts")`, the file it is in. Both files exist,
  the tests compare keys only with each other, and no hard-coded key depends on the entry.
Correct, and no weakening. The gate's runner step ran it: 1 testcase, 2 assertions, pass.

## 6. Margins

All alone, one process at a time, nothing else running (1-minute load 1.9-2.1), AC power. Same command as the harness: `s.subject([c])`
of `harness/suites.ts` in source mode, with `cwdOf(s)` (the upstream checkout), `{ ...caseEnv(c.env), RUST_TS_IMPL: "port" }`, the
harness's own `run()` from `scripts/lib/common.ts` (its resource usage), and `s.timeoutMs` (60 s). The binary runs swap the
`bun [--preload …] <repo>/<entry>` prefix for **the gate's own build** (`2e56dd07…/rts`, `511e00b7…/rts`), exactly as `subjectCmd` does.
Rounds interleave source and binary.

| Case | Mode | Wall (s), 3 runs | User (s) | Max RSS (MB) | Exit |
|---|---|---|---|---|---|
| `dynamic-drop.rs` | source | 34.7, 35.4, 35.4 | 41.6, 42.4, 42.3 | 2,114-2,209 | 0 |
| | binary | 39.0, 39.6, 39.5 | 47.8, 48.4, 48.1 | 2,139-2,149 | 0 |
| `issue-8827.rs` | source | 35.1, 35.3, 35.7 | 40.7, 41.0, 41.4 | 1,954-1,959 | 0 |
| | binary | 39.1, 39.1, 39.1 | 46.8, 46.4, 46.6 | 1,939-1,952 | 0 |
| `recursive-drop-elaboration.rs` | source | 25.6, 25.5, 25.4 | 28.5, 28.5, 28.5 | 3,155-3,263 | 1 |
| | binary | 28.3, 28.6, 28.3 | 32.5, 32.7, 32.4 | 3,897-3,942 | 1 |

Medians, binary against source: wall **+11.6%, +10.8%, +11.0%**; user **+13.7%, +13.7%, +14.0%**. The output (exit code, stdout, stderr
with a panic's pid masked) was byte-identical across all 6 runs of each case, in both modes.

**Is the binary slower on long cases? Yes, by about 11% in wall time and 14% in user time, consistently.** It is not load: these runs were
alone on an idle machine, and wave 40f's solo times (and the w40f audit's 33-35 s alone) match my source times. Root's 15-16% user figure
came from gate retries at different loads. Mine is slightly lower and has very little spread. User time exceeds wall time by 3-7 s from
source and 4-9 s from the binary (helper threads), but most of the cost is in the wall time itself: the work runs slower. That fits the bytecode optimizer being off
(`bb3c6948`, kept for stack depth) or a bundle that JSC tiers differently, as root's decision says. Startup cannot explain it (0.4 s
in the binary's favour). For the queued lane: comparing a plain `bun build` bundle run with `bun` against the compiled binary would
separate bundle shape from the compile and bytecode step.

| Gate retries alone | wave 40f wall / user | wave 40g wall / user | change |
|---|---|---|---|
| `error-tainting-issue-122904.rs` | 25.1 / 28.3 | 28.8 / 33.2 | +15% / +17% |
| `recursive-drop-elaboration-2.rs` | 25.0 / 28.2 | 29.2 / 33.6 | +17% / +19% |
| `recursive-drop-elaboration.rs` | 25.1 / 28.3 | 28.5 / 32.8 | +14% / +16% |
| `repeated-vector-syntax.rs` | 18.3 / 22.5 | 20.8 / 26.8 | +14% / +19% |
| `dynamic-drop.rs` | 35.6 / 42.5 | 39.6 / 48.4 | +11% / +14% |
| `move-3-unique.rs` | 24.5 / 28.4 | 27.1 / 32.4 | +11% / +14% |
| `issue-8827.rs` | 34.8 / 40.5 | 39.0 / 46.6 | +12% / +15% |

**Power and host.** `host.allowBattery` false, `powerLost` `[]`. 145 samples, all on AC, every one with a power reading, largest gap 650 s.
AC at both marks of all 60 suites. Swap 1.06-1.34 GB. 1-minute load 1.3 to 187 (N4). `pmset -g log` shows no battery, sleep or shutdown
entry on Nov 10; up 6 days, no reboot.

## 7. Coverage and criteria

`bun scripts/coverage.ts` at `f029cbe1`: **24,293 / 27,053 fns ported (89.80%) across 66 crates**; Miri 1,506 / 1,535 (98.1%);
`rustc_session` 411 / 446; vendor 5,307 / 17,360 (60 crates); library 578 / 2,017. These equal README, `docs/state/current.json` and
wave 40f's figures. No `src/` change in this wave added or removed a ported fn: fixers-50 touched existing ports, and subject-bin changed
only `src/rust_ts/` glue and comments.

`scripts/criteria.ts --run gate-20261110-023454-root-88uo` (gate at `3541f8a5c2`, `pass=true`):

| Group | Result | Threshold |
|---|---|---|
| M6b run-pass | 3,474 / 3,478 = 99.88%, met | 90% |
| M6b run-fail | 294 / 294 = 100%, met | 90% |
| M6b miri-pass | 350 / 360 = 97.22%, met | 80% |
| M7a ir-hello | not met: "ir-hello: not in this gate" | 100% |
| M7a mir-o2 | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a mono-ui | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a check-rg | 34 of 34 crates, met | 33 |

These equal wave 40f's results.

## What I did not check

- **Protected cases outside my samples** were not re-run. Their status comes from the gate's jsonl, compared row by row with wave 40f's.
- **Every suite in binary mode.** I compared 4 suites at 150 cases. The subject-bin lane compared all 60 at 200 cases, and the gate itself
  matched all 542,092 protected cases in binary mode against the oracle.
- **Port correctness** of fixers-50, and the subject-bin code beyond the paths above. That belongs to their reviews.
- **Typecheck and the unit steps** were not re-run. I rely on the gate's log and junit reports.
- **The cause of N1.** I measured the cost but did not profile it.

## Side effects outside my scratchpad

**No oracle cache entry was written:** no file under `oracle-cache` is newer than the start of this audit (08:40Z). The upstream checkout
is clean (`git status --porcelain`: 0 paths, before and after every phase).
- `.env.local` copied into this worktree (gitignored).
- Eight run directories, 576 KB in all: `$RUST_TS_DATA/runs/w40g-audit-{source,binary}-{mir,run-pass-miri,mono-ui,run-fail-miri}`. They are
  report files, and nothing compared reads them.
- Two subject builds keyed to this worktree's path (`$RUST_TS_DATA/subject-bin/336bddfc…`, `1a478835…`, about 500 MB), made by the binary
  half of section 4. **I deleted them.** Building them ran `pruneSubjectBins`, which removes only builds unused for 3 days, and removed
  nothing: the gate's two builds are still there, and their `meta.json` mtimes were touched by nothing of mine (I ran their `rts` directly).
- The key dumps and difftests called suites' `cases()`, which touched the mtimes of 814 cached aux entries under `aux/`. Git refreshed the
  upstream checkout's index (`.data/rust/.git` mtime) on the harness's cleanliness checks.
- `coverage.ts` rewrote `$RUST_TS_DATA/coverage.json` (twice, from this worktree, at `f029cbe1`).
- The timing runs and the difftests used the upstream checkout as cwd, as the harness does, with `RUSTC_ICE=0`. No stray file was left there.
