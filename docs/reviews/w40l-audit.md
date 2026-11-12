PASS WITH NOTES

**Wave 40l's accept stands.** No protected case was lost, removed or tampered with. All 60 protected suites ran. Every one of the
542,304 protected ids in `harness/baseline/*.txt` at `95ba28aa` is still in the baselines at the accept (`577a3cb1`) and is `MATCH` in this
gate's jsonl. The baselines did not change (`95ba28aa..577a3cb1`: 0 lines). I compared every row of all 102 jsonl files (the 60 suites plus
their `.skipped`/`.extra` files) with wave 40k's gate, on every field. The ids and their order are the same in every file. **Only 16 rows
moved, all in `attempts`/`retried`:** the same 15 retried cases as in wave 40k, with new solo times, plus `tests/ui/panics/panic-in-ffi.rs` in
run-fail-miri. That case timed out in the pool and took 9.5 s alone, `MATCH` (N1). Status counts did not change: MATCH 542,304, UNPORTED 308,
DIFF 28, TIMEOUT 2, UNSTABLE 1.

**No expectation tampering. The only new keys are the two new suites'.** I dumped the oracle key of every registered case from `git archive`
trees on Bun 1.4.4. `ab750e50` has 374,690 keys, sha1 `a3e1b6e58756…`, the same as w40k-audit's dump. `3a90ad1e` has 377,217, sha1
`c34544623e40…`. Between them: **0 gone, 0 changed, exactly 2,527 added**, stats-ui 2,193 and target-specs 334. Without those two suites'
lines, the `3a90ad1e` dump is byte-identical to the `ab750e50` one. Neither new suite has a baseline or ran in this gate. Each of the 147
non-doc files changed in the wave matches one of three sources: a reviewed lane head's blob, root's three checked commits applied on top of
the lane or base blob, or a conflict-free merge of two reviewed lanes (`session.ts`). **Every `harness/` and `scripts/` change is
harness-w51's (`8b846ca3`, APPROVE WITH NITS), except `harness/llvm-manifest.json`,** which is root's checked `d2e2f3c7` (+10 lines, 0
removed).

**The binary is the tested tree.** I recomputed both build keys at `3a90ad1e`, and both equal `gate.json` and the builds' `meta.json`:
`1095a9a0…` (main.ts, 2,111 inputs) and `1a266c78…` (miri.ts, 2,299). The `inputs`, `config` (`CONFIG_FILES`), `runtimeC`
(`RUNTIME_C_FILES`) and `spec` fields are all identical. `bun` = `GATE_BUN` (1.4.4 `38afee6c84fc…`). `bunExec` start = end, both pointing at
the clone (sha1 `7c1f29cd…`). `bunClone` is a `clonefile` of `~/.bun/bin/bun`, same sha1. The clone's directory is gone: `.data/gate-bun/` is
empty, last changed 04:52:48Z, which is `bunExec.goodAt`.

**The new code is not on any protected path.** Neither build has an input under `src/rustc_codegen_llvm/` or `src/rust_ts/llvm/`. Their input
path sets are the same as wave 40k's builds'; only file contents changed, in 33 files for main.ts and 34 for miri.ts. I also bundled all 92
non-test entry files under `src/rust_ts/`, `src/miri/bin/`, `scripts/` and `harness/` at `3a90ad1e`, which covers every subject entry the
suites use. **None of them reaches those directories.** No non-test file outside them imports them. The one computed `import()` in `src/`
(`rustc_lint/late_oracle/run.ts`) is in neither build. The backend the driver loads is still the stand-in
`src/rust_ts/codegen_backend.ts` (`rustc_interface/util.ts:242`), and `rustc_interface` changed only in one test file.

Regression audit, 2026-11-12. Gate `gate-20261111-223829-root-dukf`, tested `3a90ad1e`, accepted `577a3cb1` (`git log -1 --
docs/state/history.jsonl`), `RUST_TS_SUBJECT=binary`, Bun 1.4.4. The previous accept is wave 40k: gate `gate-20261111-141426-root-vl2w`, tested
`ab750e50`, accepted `95ba28aa`. I ran no gate and no full suite. What I ran:
- a comparison of every row of all 102 jsonl files of this gate against wave 40k's, on every field. I checked every id of the 60 baselines at
  `95ba28aa` (`git show`) against the baselines at `577a3cb1` and this gate's jsonl. I also checked `gate.json`, the `history.jsonl` accept
  entry, the three junit reports (by test name), the frozen-lists run and the gate log (`.data/tmp/gate-w52.log`);
- `scripts/oracle-keys.ts` over every registered case, in `git archive` trees of `ab750e50` and `3a90ad1e`, each with this worktree's
  `.env.local` and `node_modules`, on `~/.bun/bin/bun` (1.4.4);
- a per-file blob check of the 147 changed non-doc files against the five lane heads, plus root's three commits against their parents.
  `git merge-file` covered the one file two lanes changed. I also looked for non-doc commits from outside the lanes;
- both subject-bin keys, recomputed in the `3a90ad1e` archive tree with that tree's `buildSpec`, `subjectBinKey` and `subjectBinKeyOf`.
  The spec was rebased onto the gate's repo path with `meta.spec.bunPath`, and Bun was taken from `meta.bun`;
- an import-graph check: `Bun.build` (metafile only, no output) of the 92 entries above, plus the two builds' `meta.json` inputs;
- `gate.json` `retryTimes`, `host.samples`, per-suite times and the heavy suites' per-case usage, against wave 40k. I also looked at
  run-fail-miri's `retried` in every gate since 2026-11-10;
- `bun scripts/coverage.ts` (summary, `--check`) and `bun scripts/criteria.ts --run` for this gate and wave 40k's.

Everything ran on AC power (`pmset -g batt`), with `RUSTUP_AUTO_INSTALL=0`, `RUST_TS_REQUIRE_PROBES=1`, `RUSTC_ICE=0` and
`RUST_TS_AGENT=w40l-audit`. No gate was running (`.data/tmp/GATE_RUNNING` absent), and the host was quiet (1-minute load about 2). I read
code but changed none.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | low | **`panic-in-ffi.rs` is a new retry, and load does not explain it.** In run-fail-miri it hit the 60 s pool limit (user 30.2 s, sys 6.6 s, RSS 905 MB), then ran alone in **9.5 s** (user 15.0, sys 0.4, exit 1, `MATCH`). That leaves 50.5 s of margin. 1-minute load was 66 at the timeout, and the suite window's samples were 63 and 40. In wave 40k they were 185 and 115, with no retry. In none of the five gates since 2026-11-10 was run-fail-miri retried. This case's pool CPU is 2.0× its solo user time, and its sys time 16× (6.6 s), which is the most sys of any retried case in the gate. The other 15 retried cases run 0.63-1.65× in user, with sys at most 4.4 s. The test is a 26-line non-unwinding panic (abort with a backtrace, `RUST_BACKTRACE=0`), with no threads. The miri build changed content in 34 files, including fixers-52's `src/std/thread.ts`/`thread.c`, `fmt.ts` and `num.ts`. I could not tie the pool time to any of them without running the case. A single pool spike is the likeliest cause. Suggest watching it in the next gate, and timing it in a pool if it recurs. | `run-fail-miri.jsonl`; `gate.json` `retryTimes`, `host.samples`; run-fail-miri `retried` in `gate-20261110-023454`…`gate-20261111-223829` |
| N2 | info | **Six test names went missing from the junit reports, and none was lost.** Each was renamed or moved. `src/rustc_data_structures/thousands/tests.test.ts` "f64_fixed1 matches the oracle's {:.1}" moved to `src/std/fmt.test.ts:565` (fixers-52's shared `{:.1}`). `input_stats_sizes.oracle.test.ts` "every size is a positive integer" became "…non-negative integer", plus a ZST test. `llvm/model.test.ts` "a function body is llir-core-b's" became "debuginfo is llir-di's". `json.oracle.test.ts`'s name changes with its temp path, as in every gate. In the runner tests, `coverage.test.ts` "218 C++ fns in 8 files" became "197 … in 6 files" (scope-m7 N6). Its import-guard test moved to `scripts/lib/unit-steps.test.ts`, which now covers every runner test file (scope-m7 N4). Counts: unit 7,539 → **7,620** (1 skip, allowed), alone 39 → 39, runner 537 → **558**, 0 failures. | three junit reports, both gates; `git diff b3772ebb 3a90ad1e` on those files |
| N3 | info | **The host was quieter at its peaks than in wave 40k.** 1-minute load: median 59 (40k: 52), peak 207 (273), 15 samples above 100 (36), 1 above 200 (3). Suites summed to **21,931 s against 22,794 s** (hir-tree 901 → 717, mir 1,842 → 1,688). Swap stayed at 5.8–6.7 GB. There were 146 samples, all on AC, every one with a power reading, and the largest gap was 660 s. `allowBattery` false, `powerLost` `[]`. Every suite was on AC at both its marks. | `gate.json` `host`, per-suite `startedAt`/`endedAt` |
| N4 | info | **`step_overflowing.rs` and `hashset-connected-border-12860.rs` are the same unprotected 1,800 s timeouts** in `run-pass-miri-heavy`. Neither is in its baseline (6 ids). `step_overflowing.rs`'s max RSS went back to **1,990 MB** (40k: 4,821, w40k-audit N4). | `run-pass-miri-heavy` `heavy`, both gates |
| N5 | info | **The import-graph check is static.** `Bun.build` follows static imports and dynamic imports of literal strings. The one computed `import()` in non-test `src/` code is in neither build. No non-test file imports `rustc_codegen_llvm`/`rust_ts/llvm` by any specifier. I ran no case with a tracer. Because of the gate's binary mode, the two builds' input lists cover all of main.ts's and miri.ts's code. | `meta.json` inputs; §4 |
| N6 | info | **Disk:** 3.3 GiB free at the end of the audit. Wave 40k's builds (`49a56593…`, `45bb8067…`) are still in `subject-bin/`, beside this gate's. No accepted run needs them any more. | `ls`, `df` |

## 1. Protected set: nothing lost

| Check | Result |
|---|---|
| Baselines `95ba28aa` = `3a90ad1e` = `577a3cb1` | `git diff --shortstat` over `harness/baseline`: empty. 60 files at both |
| Protected ids (`95ba28aa`) against this gate's jsonl | **542,304, every one `MATCH`**, every one in the `577a3cb1` baselines, no duplicates |
| `gate.json` | `pass: true`, `staticOk`, `skipStatic: false`, `head` `3a90ad1e`, `dirty: []`, `unstableOk`, `upstreamOk`, `unitTestSkips` 1 allowed 1, 0 unexpected, `staticNotes: []`. 60 suites, the same 60 as 40k: no `cli`, no `stats-ui`, no `target-specs`. Summed over suites: `lost` 0, `lostSkipped` 0, `oracleTimeouts` 0, `upstreamChanges` 0, `gained` 0, batch-only failures and timeouts 0. Baseline 542,304, match 542,304, total 542,643, all equal to 40k |
| `history.jsonl` accept entry (04:53:57Z) | run `gate-20261111-223829-root-dukf`, head `3a90ad1e`, 60 suites, no `cli`. Each `protected` equals its baseline's line count at `577a3cb1` (0 mismatches, sum 542,304) |
| `577a3cb1` | parent `3a90ad1e`. Changes only `README.md`, `docs/next.md`, `docs/state/current.json`, `docs/state/history.jsonl`. `3a90ad1e` itself changes only `docs/next.md` and deletes the five claims |
| Unstable | `miri-pass` `tests/panic/panic1.rs`, as before |

**Every row, this gate against wave 40k's.** The same 102 files, with the same ids in the same order. Every field is equal, except:

| Suite | Rows | Change | Explanation |
|---|---|---|---|
| `mir` | 6 | `attempts` only | the same 6 retried cases as 40k; solo times in §5 |
| `run-pass-miri` | 9 | `attempts` only | the same 9 retried cases as 40k |
| `run-fail-miri` | `tests/ui/panics/panic-in-ffi.rs` | `retried: true` and `attempts` added, `MATCH` in both gates | pool timeout at 60.0 s, 9.5 s alone (N1). Protected in run-fail-miri (line 165 of 294) and 15 other suites, `MATCH` in all |

**Static steps** (`.data/tmp/gate-w52.log`): `note: subject binary (src/rust_ts/main.ts 1095a9a0…, src/miri/bin/miri.ts 1a266c78…)`. Typecheck,
unit tests, alone, runner, markers, marker order, info sites and frozen lists are all `ok`, with 1 allowed skip. **Frozen lists:** the three
jsonl files (plus two `.skipped`) are byte-identical to 40k's. All three summaries are in binary mode with this gate's two hashes.

## 2. Bun records

| Check | Result |
|---|---|
| `GATE_BUN` | `1.4.4`, `38afee6c84fcf48c0edb2466aa4b27d287a59c30` (`scripts/lib/bun-pin.ts` changed in harness-w51, in its prune and sha1 check only. The `GATE_BUN` line and `VALIDATED_BUN` did not change) |
| `gate.json` `bun` | equal |
| `bunExec.start` / `.end` | both `path` = `.data/gate-bun/run-84163-8okNJv/bun`, sha1 `7c1f29cd40510ed09854dff849e519411e374c13`, `1.4.4`, `38afee6c8` (the short form `bun --revision` prints); `goodAt` 04:52:48.797Z |
| `bunClone` | same path, `from` `~/.bun/bin/bun`, sha1 `7c1f29cd…`, `how: clonefile`, `parent` 84163. `~/.bun/bin/bun` now: sha1 `7c1f29cd…`, `1.4.4+38afee6c8`; `~/.bun/bin` unchanged since 2026-11-11 09:59:49Z |
| Clone removed | `.data/gate-bun/` is empty, last changed 04:52:48Z (the end of the run) |
| Builds' `meta.json` | both: `bun` 1.4.4 full revision, sha1 `7c1f29cd…`; `spec.bunPath` = the clone; `builtAt` 22:38:33.954Z / 22:38:38.441Z, inside the gate's first minute |
| `gate.json` `subject`, all 60 summaries, the 3 frozen-lists summaries | `mode: binary`, `1095a9a0…` / `1a266c78…` |

**Build keys, recomputed at `3a90ad1e`:**

| Entry | Recomputed | `gate.json` | inputs | `inputs` / `config` / `runtimeC` / `spec` vs `meta.json` |
|---|---|---|---|---|
| `src/rust_ts/main.ts` | `1095a9a03327ac22b7b9a6cd385c6605b394f7fd` | equal | 2,111 | all identical |
| `src/miri/bin/miri.ts` | `1a266c784e56b9cf7098c27443612d8df1708637` | equal | 2,299 | all identical |

`CONFIG_FILES` = `tsconfig.json`, `package.json`, `bunfig.toml`, `bun.lock`, all unchanged since 40k (no diff `ab750e50..3a90ad1e`).
`RUNTIME_C_FILES` = `src/std/thread.c` **`ebced323…`** (40k: `453d4222…`, changed by fixers-52's `pthread_attr_destroy` stop code) and
`src/rust_ts/proc_macro_host.c` `c1541cf1…` (unchanged). `scripts/lib/subject-bin.ts` itself changed (harness-w51 added `prunePreV4Builds`).
It is hashed into the key as the builder source, so both builds were new, as expected.

## 3. Expectation tampering: none

### Oracle keys

| Tree, Bun 1.4.4 | keys | sha1 | not listed |
|---|---|---|---|
| `ab750e50` | 374,690 | `a3e1b6e58756c19c6d1a970360856b01d51e3cf2` (= w40k-audit's `ab750e50`@1.4.4) | 0 |
| `3a90ad1e` | 377,217 | `c34544623e4075a5b40023517b26396e97fbe1d9` | 0 |

`ab750e50` → `3a90ad1e`: **0 gone, 0 changed, 2,527 added: stats-ui 2,193 and target-specs 334**, registered last (suites 74 and 75 of 75).
With those suites' lines removed, the `3a90ad1e` dump is byte-identical to the `ab750e50` one. `scripts/difftest.ts`, which computes the key,
did not change in this wave. `harness/suites.ts` changed only by appending: two imports and the two `SUITES.push` blocks at the end of the file.

**The new suites are report-only.** `harness/baseline/` has no `stats-ui.txt` or `target-specs.txt`, at `3a90ad1e` or `577a3cb1`. Neither is
among the gate's 60 suites, and the run dir has no file for either.

### Reviewed batches

`git diff ab750e50 3a90ad1e` outside `docs/` and `README.md`: 147 files. `ab750e50..b3772ebb` (the wave start) changes no non-doc file, and
all five lanes branch from `b3772ebb`. **No change in `harness/baseline`, `harness/corpus/`, oracle outputs, `scripts/difftest.ts`,
`tsconfig.json`, `bunfig.toml`, `package.json`, `bun.lock` or `UPSTREAM.json`.**

| Head | Review (verdict, names the SHA) | Files whose blob at `3a90ad1e` equals the head's |
|---|---|---|
| llir-core-b `e5a23dac` | llir-core-b-recheck.md, APPROVE WITH NITS | 29 |
| cg-contract `658e1a5b` | cg-contract-recheck.md, APPROVE WITH NITS | 36, plus 2 via `b12fd60c` and `session.ts` (merge) |
| codegen-sets-m7 `bf71d773` | codegen-sets-m7.md, APPROVE WITH NITS | 10 (the `tools/codegen` files), plus 3 via `e771735c` |
| harness-w51 `8b846ca3` | harness-w51.md, APPROVE WITH NITS | 21: **every `harness/` and `scripts/` file except `llvm-manifest.json`** (`suites.ts`, `stats.ts`, `target-specs.ts` and their tests; `gate.ts`, `coverage.ts`, `llvm-src.ts`, `subject-bin.ts`, `subject-bin.cases.ts`, `gate-bun.test.ts`, `coverage.test.ts`; `lib/` `bun-pin`, `cpp-fns`, `llvm-src`, `subject-bin`, `unit-steps` and tests), plus `PORTING.md` |
| fixers-52 `c936b424` | fixers-52.md, APPROVE WITH NITS | 42, plus `session.ts` (merge) |
| root `e771735c` | root-w52-check.md, APPROVE WITH NITS | 5 files. Its parent's blob is codegen-sets-m7's (`queries.gen.ts`, `codegen_m7.test.ts`, `queries.config.json`) or the base's (`cstore_impl.ts`, `engine.test.ts`); +16 −17 |
| root `b12fd60c` | root-w52-check.md | `rustc_codegen_llvm/{common,context}.ts`; parent blobs are cg-contract's; +3 −3 |
| root `d2e2f3c7` | root-w52-check.md | `harness/llvm-manifest.json`; parent blob is the base's; **+10, 0 removed** |

- `src/rustc_session/session.ts` (fixers-52's pointer-auth accessors + cg-contract's `Session::fewer_names`): `git merge-file` of the two
  lane versions over `b3772ebb`'s merges with 0 conflicts and is byte-identical to `3a90ad1e`'s.
- The only non-doc commits in `b3772ebb..3a90ad1e` that are not in a lane head's history are root's `e771735c`, `b12fd60c` and `d2e2f3c7`.

**So every `harness/` and `scripts/` change came through the reviewed harness-w51 batch or root's checked `d2e2f3c7`.**

## 4. The new code is off every protected path

| Check | Result |
|---|---|
| `meta.json` inputs, main.ts (2,111) and miri.ts (2,299) | **0** paths under `src/rustc_codegen_llvm/` or `src/rust_ts/llvm/`. The path sets equal wave 40k's builds'; content changed in 33 / 34 files (fixers-52's `std/fmt`, `num`, `thread`, `session.ts`, the codegen-sets diagnostics/queries, cg-contract's `fewer_names`, …) |
| `Bun.build` of the 92 non-test entries in `src/rust_ts/*.ts`, `src/miri/bin/*.ts`, `scripts/*.ts`, `harness/*.ts` at `3a90ad1e` | 92 built, **0 reach** either directory. Covers every `bunCmd`/`subjectCmd` entry in the suites: main.ts, miri.ts, ck/emit/escape/fluent/lex/mir/res/sym/thir/tok/ty-dump, and the wrappers |
| Non-test imports of either directory from outside them | none |
| Computed `import()` in non-test `src/` | one, `src/rustc_lint/late_oracle/run.ts:54`, in neither build |
| Backend registration | `rustc_interface/util.ts:242` loads `LlvmCodegenBackend` from the stand-in `src/rust_ts/codegen_backend.ts`; `ab750e50..3a90ad1e` changes only `rustc_interface/metadata_temp_dir.test.ts` there |

## 5. Margins

**Solo retries** (`retryTimes` alone wall / user s; pool load at the timeout, 40k → 40l):

| Case | wave 40k | wave 40l | Δ wall | pool load |
|---|---|---|---|---|
| `dynamic-drop.rs` | 39.6 / 48.6 | **38.9 / 47.7** | −0.7 | 238 → 71 |
| `issue-8827.rs` | 39.0 / 46.6 | **38.4 / 46.1** | −0.6 | 234 → 156 |
| `recursive-drop-elaboration.rs` | 28.7 / 32.7 | 28.5 / 32.6 | −0.2 | 57 → 106 |
| `error-tainting-issue-122904.rs` | 28.5 / 32.6 | 28.2 / 32.5 | −0.3 | 48 → 103 |
| `recursive-drop-elaboration-2.rs` | 28.5 / 32.6 | 28.3 / 32.5 | −0.2 | 57 → 106 |
| `move-3-unique.rs` | 27.1 / 32.2 | 26.4 / 31.5 | −0.7 | 272 → 165 |
| `issue-52475.rs` | 20.5 / 21.2 | 20.3 / 21.0 | −0.2 | 125 → 86 |
| `repeated-vector-syntax.rs` | 20.6 / 26.7 | 20.1 / 26.1 | −0.5 | 226 → 69 |
| `recursion-etc.rs` | 16.8 / 18.9 | 16.8 / 18.8 | 0.0 | 242 → 77 |
| `unique-send-2.rs` | 16.2 / 22.5 | 16.1 / 22.5 | −0.1 | 234 → 93 |
| `infinite_loop.rs` | 15.5 / 16.2 | 15.3 / 16.0 | −0.2 | 125 → 86 |
| `macro-comma-support-rpass.rs#std` | 15.2 / 24.2 | 14.9 / 23.8 | −0.3 | 217 → 133 |
| `projection-cache-rematch-impl-141124.rs` | 14.4 / 18.6 | 14.0 / 18.4 | −0.4 | 57 → 111 |
| `let-else-drop-order.rs` | 13.6 / 20.7 | 13.5 / 20.5 | −0.1 | 215 → 125 |
| `macro-comma-support-rpass.rs#core` | 12.8 / 21.3 | 12.2 / 20.8 | −0.6 | 217 → 133 |
| `panic-in-ffi.rs` (run-fail-miri) | not retried | **9.5 / 15.0** | — | — → 66 (N1) |

Every solo time is the same as 40k's or up to 0.7 s faster. The largest, `dynamic-drop.rs` at 38.9 s, leaves 21.1 s of the 60 s limit and is
6.1 s under the 45 s line of the 2026-11-10 decision.

**Heavy suites** (one case at a time, wall / user s): within ±1 s of 40k, except the crate suites below. `dynamic-drop-async.rs` 77.6 → 78.2,
`issue-94923.rs` 86.0 → 85.3, `example-calendar.rs` 68.6 → 68.7, `panic-handler-flail-wildly.rs` 38.4 → 38.8, `task-comm-5.rs` 41.8 → 41.7,
`task-comm-6.rs` 157.8 → 158.6. The two unprotected timeouts are in N4. In the crate suites: `mir-core` 87.9 → 98.5, `check-core` 100.9 → 103.5,
`rmeta-core` 98.7 → 102.4, `check-rg-encode-mir` 79.6 → 83.0. Max RSS is at most 6,598 MB against the 12,288 MB budget, and nothing is over
budget. `heavyErrors` is empty everywhere.

## 6. Coverage and criteria

`bun scripts/coverage.ts` at `577a3cb1`: **TOTAL 24,886 / 27,873 fns (89.28%) across 67 crates** and **WRAPPER 43 / 197 (21.8%)** in 6
llvm-wrapper files. Both match the README (line 13), `state.ts summary` and `docs/next.md`. Miri 1,506 / 1,535; `rustc_codegen_ssa` 433 / 1,091;
`rustc_codegen_llvm` 119 / 820. `--check`: `markers ok (25920, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 744; llvm 354)`.

`scripts/criteria.ts --run gate-20261111-223829-root-dukf` (gate at `3a90ad1efc`, `pass=true`):

| Group | Result | Threshold |
|---|---|---|
| M6b run-pass | 3,474 / 3,478 = 99.88%, met | 90% |
| M6b run-fail | 294 / 294 = 100%, met | 90% |
| M6b miri-pass | 354 / 360 = 98.33%, met | 80% |
| M7a ir-hello | not met: "ir-hello: not in this gate" | 100% |
| M7a mir-o2 | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a mono-ui | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a check-rg | 34 of 34 crates, met | 33 |

Every line is identical to the same command for wave 40k's gate, as expected with 0 gained.

## What I did not check

- **Protected cases beyond the gate's jsonl.** I re-ran no case, `panic-in-ffi.rs` included. Statuses come from the jsonl, compared row by
  row with 40k's.
- **The lanes' code and their queued nits** (llir-core-b-recheck, cg-contract-recheck, codegen-sets-m7, harness-w51, fixers-52,
  root-w52-check). Those belong to their reviews. I checked only that the merged files are the reviewed ones.
- **The new suites' results.** stats-ui and target-specs are report-only, and I did not run them.
- **Typecheck and the unit steps** were not re-run. I relied on the gate log and the junit reports.

## Side effects outside my scratchpad

**No oracle cache entry was written** (0 files under `oracle-cache` newer than the start of the audit). **No subject build was made**:
`subject-bin/` holds the same four dirs. **No run dir was made.** The upstream checkout is clean (`git status --porcelain`: 0 paths), with no
`rustc-ice-*` file. Its ignored `build/` has no entry newer than the audit's start.
- `.env.local` was copied into this worktree, with `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0` appended (gitignored).
  `bun install --frozen-lockfile` linked this worktree's `node_modules` (gitignored).
- The key dumps called suites' `cases()`, which touched the mtimes of 814 cached aux entries under `aux/`.
- `.data/tmp`'s own mtime moved: an entry was made and removed there. Nothing is left in it newer than the audit's start.
- `coverage.ts` rewrote `$RUST_TS_DATA/coverage.json`, from this worktree at `577a3cb1`.
- The build-key recomputation and the import-graph check ran `Bun.build` in memory over the `3a90ad1e` archive tree, and wrote no output.
- The two archive trees (about 160 MB each), the key dumps and my scripts were in my scratchpad only. I deleted the trees afterwards.
