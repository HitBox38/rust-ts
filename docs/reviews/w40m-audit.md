PASS WITH NOTES

**Wave 40m's accept stands.** No protected case was lost, removed or tampered with. All 60 protected suites ran. Every one of the
542,304 protected ids in `harness/baseline/*.txt` at `72d95af6` is `MATCH` in this gate's jsonl. The accept commit (`463d6a25`) changed no
baseline, and neither did anything since `3a90ad1e`. I compared every row of all 102 jsonl files with wave 40l's gate, on every field. The ids
and their order are the same in every file. **Only 20 rows moved, all in `attempts`/`retried`**: the 20 solo retries, every one `MATCH` in both
gates. Status counts did not change: MATCH 542,304, UNPORTED 308, DIFF 28, TIMEOUT 2, UNSTABLE 1.

**The binaries are the tested tree, and nothing the wave changed is in them.** Both subject builds were reused from wave 40l's gate (built
2026-11-11 22:38Z). I recomputed both keys from a `git archive` of `72d95af6` with `scripts/lib/subject-bin.ts`: `1095a9a0…` (main.ts, 2,111
inputs) and `1a266c78…` (miri.ts, 2,299). Both match. Their `inputs`, `config` and `runtimeC` are identical to the builds' `meta.json`, and so is
the Bun. None of the 71 files changed in `3a90ad1e..72d95af6` is an input of either build. A `Bun.build` of all 92 non-test entries
under `src/rust_ts/`, `src/miri/bin/`, `scripts/` and `harness/` reaches none of them. Because the binaries are byte-identical to wave 40l's,
**no timing difference between the two gates can come from the code**.

**The battery spell touched one suite, `tydump-nocore`, and cost it nothing but time.** It ran 10:05:12–11:29:14Z and took 5,040 s, up
from 2,289 s. All 21,523 of its cases are `MATCH`, it had no retries and no timeouts, and every case is protected. No other suite was running
between 10:15 and 11:21. **This gate is still sound evidence.**

Regression audit, 2026-11-12. Gate `gate-20261112-061907-root-csyz`, tested `72d95af6`, accepted `463d6a25` (`git log -1 --
docs/state/history.jsonl`; the brief's `bc4c3d4f` is not the accept commit), `RUST_TS_SUBJECT=binary`, Bun 1.4.4. The previous accept is wave
40l: gate `gate-20261111-223829-root-dukf`, tested `3a90ad1e`, accepted `577a3cb1`. I ran no gate, no difftest and no full suite. What I ran:
- a comparison of every row of all 102 jsonl files against wave 40l's, on every field. I checked every id of the 60 baselines at `72d95af6`
  (`git show`) against this gate's jsonl. I also checked `gate.json`, the `history.jsonl` accept entry and the gate log (`.data/tmp/gate-w53.log`);
- `git diff` over `harness/`, `scripts/`, `UPSTREAM.json`, `tools/` and the config files, `3a90ad1e..463d6a25`;
- both subject-bin keys, recomputed in a `git archive` tree of `72d95af6` with that tree's `buildSpec`, `subjectBinKey` and `subjectBinKeyOf`.
  The spec was rebased onto the gate's repo path with `meta.spec`, and Bun was taken from `meta.bun`;
- an import-graph check: `Bun.build` (metafile only, no output) of the 92 entries above, intersected with the wave's changed files;
- `gate.json` `retryTimes`, `host.samples` and per-suite times against wave 40l. I also checked the retries and the
  `hashset-connected-border-12860.rs` result in every gate since 2026-11-04;
- the SHA-256 of the two new `llvm-manifest.json` entries against `$RUST_TS_DATA/llvm-src/aab11ee0…/`.

Everything ran on AC power (`pmset -g batt`), with `RUSTUP_AUTO_INSTALL=0`. No gate was running (`.data/tmp/GATE_RUNNING` absent), and the
host was quiet (1-minute load about 2). I read code but changed none.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | low | **The battery spell overlapped only `tydump-nocore`, and every case still matched.** Polls run every 60 s, and a change of source is kept at once (`scripts/lib/host-state.ts`). So the host lost AC between 10:15:08 and 10:16:08Z, and got it back between 11:20:08 and 11:21:08Z. The only suite running then was `tydump-nocore` (10:05:12 → 11:29:14Z). Its `hostStart` and `hostEnd` both read AC, so the per-suite marks miss the spell; only `host.powerLost` and the samples show it. The suite took **5,040 s against 2,289 s** in wave 40l (2.2×, within the 3.5× AGENTS.md quotes for battery). Load during the spell was 126–187. Still: 21,523 / 21,523 `MATCH`, all protected, `TIMEOUT` 0, `subjectTimeoutRetries` null, and no `retried` row. **No case was rescued by a retry.** All 20 retries came before the spell: mir by 07:46, run-fail-miri by 09:35, run-pass-miri by 09:57. The two heavy miri suites started at 12:11 and 12:16, on AC. A battery slowdown can only turn a pass into a false timeout, never a timeout into a false pass. And there was no timeout to explain. **The gate is sound evidence.** | `gate.json` `host.samples`, `host.powerLost`, `suites[].startedAt/endedAt`; `tydump-nocore.summary.json` both gates |
| N2 | low | **Retries rose from 16 to 20, and host load explains it. The brief says the previous gate had 4; it had 16.** The 16 are the same cases as in wave 40l. The 4 new ones are 3 run-fail-miri panic siblings of N1-w40l's `panic-in-ffi.rs` (`panic-in-cleanup.rs`, `panic-main.rs#abort-full`, `#unwind-full`) and `run-pass-miri` `tests/ui/macros/stringify.rs`. All are protected, and all `MATCH` alone in 8.3–11.4 s. Pool load at the 20 timeouts was **114.8–288.9** (wave 40l: 66.1–164.7). Host samples: median 71 (40l: 59), peak 275 (207), **53 samples above 100 (15)**, 9 above 200 (1). The suites' load at their start: mir 137 (72), run-fail-miri 169 (63), run-pass-miri 136 (54). The four run-fail-miri panic cases all timed out at load 115–117 with the same profile: pool user 32.2–32.9 s and **sys 6.3–6.5 s**, against 14.0–18.5 s user and 0.3–0.4 s sys alone. That is the contention pattern w40l-audit N1 saw on `panic-in-ffi.rs` alone. `stringify.rs` ran pool user 40.1 s at load 276, against 24.3 s alone. **The binaries are byte-identical to wave 40l's** (§4), so no rise can come from the code. | `gate.json` `retryTimes`, `host.samples`; `run-fail-miri.jsonl`, `run-pass-miri.jsonl` |
| N3 | low | **Repeated cases' alone times are within their binary-mode range. None is above 45 s.** `dynamic-drop.rs` **39.7 s** (40l 38.9; range 38.9–39.9 in the seven binary-mode gates since 2026-11-10). `issue-8827.rs` **39.3 s** (40l 38.4; range 38.4–39.3, so it ties the highest). The six mir cases are each 0.1–0.9 s slower. The other repeated run-pass-miri cases are 0.0–0.8 s slower. These alone runs started at load 101 and 21 (40l: 90 and 14): the "alone" retry runs while the rest of the host is still busy. **`panic-in-ffi.rs` moved most: 9.5 → 11.2 s wall, 15.0 → 18.5 s user**, starting at load 72 (40l: 47). Its run-fail-miri siblings took 8.3–8.9 s alone, with 14.0–14.5 s user. On the same binary, more user time means a busier host (shared cores, frequency, efficiency cores), not more work. The largest margin left is dynamic-drop.rs's: 20.3 s of the 60 s limit, 5.3 s under the 45 s line (decisions 2026-11-09, 2026-11-10). Heavy suites, one case at a time: every case is within ±0.7 s of 40l (`dynamic-drop-async.rs` 78.2 → 78.0, `task-comm-6.rs` 158.6 → 159.1). Those cases are over 45 s, but they run in the heavy suites, under their 1,800 s limit and outside the 45 s rule. | `gate.json` `retryTimes` in every gate since 2026-11-08; `run-pass-miri-heavy.summary.json` `heavy` |
| N4 | info | **`hashset-connected-border-12860.rs` is not a new timeout.** It is `TIMEOUT` (1,800 s wall, exit 143) in `run-pass-miri-heavy` in **all 15 gates since the suite began (2026-11-04)**, never `MATCH`. It is not in the 6-id baseline. Its user time is the lowest yet: 1,845.9 s (40l 1,846.9; 2026-11-04: 1,866), with max RSS 1,926 MB (40l 2,082). It reached the limit on CPU, not on waiting, and does not signal a slowdown. `step_overflowing.rs` is the same, in all of those gates: 1,846.8 s user, 1,763 MB. | `run-pass-miri-heavy.jsonl` / `.summary.json` in each gate since `gate-20261104-143144` |
| N5 | info | **Some of `src/rustc_codegen_ssa/` is in both builds, but none of the files the wave changed.** The brief asks to show the whole directory is unreachable. That is not so, and need not be: 18 unchanged `rustc_codegen_ssa` files are inputs of both builds, as in wave 40l (`back/*`, `base`, `codegen_attrs`, `common`, `diagnostics`, `lib`, `target_features`, `traits/backend`, and two `.gen.ts`). The wave changed `mir/*` and `traits/builder.ts` there, and neither build has those files. The builds' `typetree` inputs are `src/rustc_ast/expand/typetree{,.gen}.ts`, not the new `src/rustc_middle/ty/typetree.ts`. That file is imported only by `rustc_codegen_llvm/builder.ts`, `rustc_codegen_ssa/traits/builder.ts` and a test. The builds include 0 files under `src/rustc_codegen_llvm/` or `src/rust_ts/llvm/`. | `meta.json` inputs; `git grep` at `72d95af6` |
| N6 | info | **The import-graph check is static.** `Bun.build` follows static imports and dynamic imports of literal strings. Type-only imports are erased, so they carry no runtime code into a build. The one computed `import()` in non-test `src/` code (`rustc_lint/late_oracle/run.ts:54`) is in neither build. I ran no case with a tracer. Because the gate runs in binary mode, the two builds' input lists cover all of main.ts's and miri.ts's code. | §4 |
| N7 | info | **Disk:** 5.5 GiB free. `subject-bin/` holds only this gate's two builds, which wave 40l made. `.data/gate-bun/` is empty. | `ls`, `df` |

## 1. Protected set: nothing lost

| Check | Result |
|---|---|
| Baselines `3a90ad1e` = `72d95af6` = `463d6a25` | `git diff --shortstat` over `harness/baseline`: empty. 60 files |
| Protected ids (`72d95af6`) against this gate's jsonl | **542,304, every one `MATCH`**, no duplicate ids. Each suite's `gate.json` `baseline` equals its baseline's line count |
| `gate.json` | `pass: true`, `staticOk`, `skipStatic: false`, `head` `72d95af6`, `dirty: []`, `unstableOk`, `upstreamOk`, `staticNotes: []`. 60 suites, the same 60 as 40l. Summed over suites: `lost` 0, `lostSkipped` 0, `oracleTimeouts` 0, `upstreamChanges` 0, `gained` 0, batch-only failures and timeouts 0. Baseline 542,304, match 542,304, total 542,643, all equal to 40l |
| `history.jsonl` accept entry (13:24:52Z) | `runId` `gate-20261112-061907-root-csyz`, `head` `72d95af6`, 60 suites. Each `protected` equals its baseline's line count at `463d6a25` (0 mismatches, sum 542,304) |
| `463d6a25` | parent `72d95af6`. Changes only `README.md`, `docs/next.md`, `docs/state/current.json` and `docs/state/history.jsonl` (+1 line) |
| Unstable | `miri-pass` `tests/panic/panic1.rs`, as before |

**Every row, this gate against wave 40l's.** The same 102 files, with the same ids in the same order. Every field is equal, except:

| Suite | Rows | Change |
|---|---|---|
| `mir` | 6 | `attempts` only: the same 6 retried cases as 40l |
| `run-pass-miri` | 10 | `attempts` only: the same 9 as 40l, plus `stringify.rs` (`retried` added) |
| `run-fail-miri` | 4 | `panic-in-ffi.rs`: `attempts` only. `panic-in-cleanup.rs`, `panic-main.rs#abort-full`, `#unwind-full`: `retried` added |

Every moved row is `MATCH` in both gates. The four new retried cases are protected: `panic-in-cleanup.rs` in 16 suites, the two
`panic-main.rs` revisions in run-fail-miri, and `stringify.rs` in 18 suites.

**`harness/` and `scripts/`, `3a90ad1e..463d6a25`:**

```
harness/llvm-manifest.json | 2 ++
```

That is the only change. It is root's `f84c9ac4`, checked in `docs/reviews/root-w53-check.md` Q4 (APPROVE WITH NITS). It pins
`llvm/include/llvm/ADT/APFloat.h` (`14b0cf68…`) and `llvm/lib/Support/APFloat.cpp` (`199e7d48…`) for llir-apfloat's `// llvm:` markers
(`docs/reviews/llir-apfloat.md`: without them, `coverage.ts --check` fails with 24 errors). Both SHA-256s equal the files in
`$RUST_TS_DATA/llvm-src/aab11ee0…/`, the manifest's `commit`. Only the marker and LLVM-source tooling reads the manifest:
`scripts/coverage.ts`, `scripts/lib/cpp-fns.ts`, `scripts/{,lib/}llvm-src.ts` and their tests. So do `src/rust_ts/llvm/ir.ts` and one
`rustc_codegen_llvm` test, in comments. No subject reads it. **No change in `harness/baseline`, `harness/suites.ts`, `harness/corpus/`, oracle
outputs, any runner script, `tools/`, `UPSTREAM.json`, `tsconfig.json`, `package.json`, `bunfig.toml` or `bun.lock`.** No script or harness
entry reaches a file the wave changed (§4), so neither the oracle keys nor the runner's behavior can have moved.

The `apfloat.oracle.test.ts` "debug print" is in a test file the wave added. Root's `2abd1fe3` removed its one
`if (process.env.APFLOAT_TEST_VERBOSE) console.log(…)` line (root-w53-recheck Q5, APPROVE WITH NITS). It is a unit test, outside both builds and
every suite.

## 2. Static steps

From the gate log `.data/tmp/gate-w53.log`: `note: subject binary (src/rust_ts/main.ts 1095a9a0…, src/miri/bin/miri.ts 1a266c78…)`, then
`ok` for typecheck, unit tests, unit test skips (1, allowlisted, 0 not allowed under `RUST_TS_REQUIRE_PROBES=1`), unit tests (alone, 0 skips),
runner unit tests (0 skips), markers, marker order, info sites and frozen lists. `gate.json`: `staticOk: true`, `unitTestSkips`
`{skipped: 1, allowed: 1, unexpected: []}`, `frozenLists.runId` `gate-20261112-061907-root-csyz-frozen-lists`. The log ends
`gate PASS run=gate-20261112-061907-root-csyz`, with the power-loss note.

## 3. Bun records

| Check | Result |
|---|---|
| `gate.json` `bun` | `1.4.4`, `38afee6c84fcf48c0edb2466aa4b27d287a59c30`, unchanged |
| `bunExec.start` / `.end` | both at `.data/gate-bun/run-41005-hHmXqv/bun`, sha1 `7c1f29cd…`, `1.4.4`, `38afee6c8`; `goodAt` 13:24:39.612Z |
| `bunClone` | same path, `from` `~/.bun/bin/bun`, `how: clonefile`, `parent` 41005. `~/.bun/bin/bun` now: sha1 `7c1f29cd…` |
| Clone removed | `.data/gate-bun/` is empty |
| Builds' `meta.json` | both: `bun` 1.4.4, full revision, sha1 `7c1f29cd…`; `builtAt` 2026-11-11T22:38:33.954Z / 22:38:38.441Z (wave 40l's gate; reused here) |

## 4. Subject binaries: reuse is correct

| Entry | Recomputed at `72d95af6` | `gate.json` | inputs | `inputs` / `config` / `runtimeC` / Bun vs `meta.json` |
|---|---|---|---|---|
| `src/rust_ts/main.ts` | `1095a9a03327ac22b7b9a6cd385c6605b394f7fd` | equal | 2,111 | all identical |
| `src/miri/bin/miri.ts` | `1a266c784e56b9cf7098c27443612d8df1708637` | equal | 2,299 | all identical |

The key (`subjectBinKeyOf`, v4) hashes the spec (with the Bun path replaced by a placeholder), the Bun (version, revision, sha1), the builder
source (`subject-bin.ts`, unchanged), every bundled input's path and sha1, `CONFIG_FILES` (unchanged) and `RUNTIME_C_FILES`
(`src/std/thread.c` `ebced323…`, `src/rust_ts/proc_macro_host.c` `c1541cf1…`, both unchanged). The banner matches once the archive path is
rebased onto `meta.spec.repo`.

| Check | Result |
|---|---|
| Files changed `3a90ad1e..72d95af6` | 71: 52 outside `docs/`/`README.md` (27 added, 25 modified), all under `src/rustc_codegen_llvm/` (25), `src/rust_ts/llvm/` (12), `src/rustc_codegen_ssa/{mir,traits/builder.ts}` (13) and `src/rustc_middle/ty/typetree.ts` (new), plus `harness/llvm-manifest.json` |
| Changed files among either build's inputs | **0** |
| Inputs under `src/rustc_codegen_llvm/`, `src/rust_ts/llvm/`, or `src/rustc_middle/ty/typetree.ts` | **0** in both. 18 unchanged `src/rustc_codegen_ssa/` files are inputs, as before (N5) |
| `Bun.build` of the 92 non-test entries in `src/rust_ts/*.ts`, `src/miri/bin/*.ts`, `scripts/*.ts`, `harness/*.ts` at `72d95af6` | 92 built, 0 failed, **0 reach a changed file**, 0 reach the three paths above. Covers main.ts, miri.ts, every dump entry and the wrappers the suites run, plus `difftest.ts` and `oracle-keys.ts` |
| Non-test imports of those paths from outside them | only `src/rustc_codegen_ssa/traits/builder.ts`, itself a changed file outside both builds |
| Backend | the backend is not registered (decision 2026-11-12T05:38). The driver's stand-in `src/rust_ts/codegen_backend.ts` and `rustc_interface` did not change |

**So the old binaries are exactly what a fresh build of `72d95af6` would be**, and the gate tested the merged tree.

## 5. Margins

**Solo retries** (alone wall / user s; pool load at the timeout, 40l → 40m):

| Case | wave 40l | wave 40m | Δ wall | pool load |
|---|---|---|---|---|
| `dynamic-drop.rs` | 38.9 / 47.7 | **39.7 / 48.8** | +0.8 | 71 → 288 |
| `issue-8827.rs` | 38.4 / 46.1 | **39.3 / 46.8** | +0.9 | 156 → 173 |
| `recursive-drop-elaboration-2.rs` | 28.3 / 32.5 | 29.2 / 33.0 | +0.9 | 106 → 211 |
| `recursive-drop-elaboration.rs` | 28.5 / 32.6 | 28.9 / 32.9 | +0.4 | 106 → 211 |
| `error-tainting-issue-122904.rs` | 28.2 / 32.5 | 28.8 / 32.9 | +0.6 | 103 → 206 |
| `move-3-unique.rs` | 26.4 / 31.5 | 26.4 / 31.6 | 0.0 | 165 → 284 |
| `repeated-vector-syntax.rs` | 20.1 / 26.1 | 20.9 / 26.8 | +0.8 | 69 → 122 |
| `issue-52475.rs` | 20.3 / 21.0 | 20.4 / 21.2 | +0.1 | 86 → 162 |
| `recursion-etc.rs` | 16.8 / 18.8 | 16.9 / 19.0 | +0.1 | 77 → 289 |
| `unique-send-2.rs` | 16.1 / 22.5 | 16.8 / 23.2 | +0.7 | 93 → 176 |
| `infinite_loop.rs` | 15.3 / 16.0 | 15.4 / 16.1 | +0.1 | 86 → 162 |
| `macro-comma-support-rpass.rs#std` | 14.9 / 23.8 | 15.3 / 24.5 | +0.4 | 133 → 273 |
| `projection-cache-rematch-impl-141124.rs` | 14.0 / 18.4 | 14.7 / 18.7 | +0.7 | 111 → 219 |
| `let-else-drop-order.rs` | 13.5 / 20.5 | 13.9 / 21.0 | +0.4 | 125 → 265 |
| `macro-comma-support-rpass.rs#core` | 12.2 / 20.8 | 12.8 / 21.1 | +0.6 | 133 → 273 |
| `panic-in-ffi.rs` (run-fail-miri) | 9.5 / 15.0 | **11.2 / 18.5** | +1.7 | 66 → 115 (N3) |
| `stringify.rs` (run-pass-miri) | not retried | 11.4 / 24.3 | — | — → 276 |
| `panic-in-cleanup.rs` (run-fail-miri) | not retried | 8.9 / 14.5 | — | — → 115 |
| `panic-main.rs#abort-full` (run-fail-miri) | not retried | 8.5 / 14.2 | — | — → 117 |
| `panic-main.rs#unwind-full` (run-fail-miri) | not retried | 8.3 / 14.0 | — | — → 116 |

Every repeated case is the same as 40l or up to 0.9 s slower (1.7 s for `panic-in-ffi.rs`), on the identical binary and at a higher
starting load. No case is above 45 s alone; the largest, `dynamic-drop.rs` at 39.7 s, leaves 20.3 s of the 60 s limit.

**Suite time:** 25,008 s against 21,931 s. `tydump-nocore` accounts for 2,753 s of the 3,077 s difference (N1). Without it: 19,966 s against
19,642 s (+1.6%), under the higher load. Swap ranged 5.6–7.3 GB (40l: 5.6–6.5). There were 151 samples, and `allowBattery` was false.

**Heavy suites:** within ±0.7 s of 40l, and no RSS over budget (max 2,154 MB in `run-pass-miri-heavy`, of 12,288). The two unprotected 1,800 s
timeouts are in N4.

## 6. Suites not run (report-only)

`harness/suites.ts` at `72d95af6` registers 75 suites. 60 have a baseline, and the gate ran exactly those 60. The other 15 have no file in
`harness/baseline/` and **did not run**: `check-chain`, `check-core-bin`, `cli`, `host-rlib`, `ir-hello`, `mir-heavy`, `miri-fail`,
`miri-pass-tb`, `miri-sysroot-alloc`, `miri-sysroot-core`, `miri-sysroot-std`, `parse-ui-json`, `rlib-native`, `stats-ui`, `target-specs`.
None protects anything, so nothing about them can be a loss. M7a's `ir-hello` criterion is still "not in this gate".

## What I did not check

- **Protected cases beyond the gate's jsonl.** I re-ran no case. Statuses come from the jsonl, compared row by row with 40l's.
- **The oracle-key dump.** Unlike w40l-audit, I did not dump keys with `scripts/oracle-keys.ts`; that would touch the shared `aux/` cache.
  No runner, suite or harness file changed, and no script or harness entry reaches a changed file, so the keys cannot have moved.
- **The lanes' code and their queued nits** (cg-context, cg-types-attrs, cg-builder, ssa-operand-place, ssa-mir-core, llir-apfloat,
  root-w53-check/-recheck). Those belong to their reviews. I did not check each merged file's blob against its lane head.
- **Coverage numbers.** I did not run `scripts/coverage.ts`, which rewrites `$RUST_TS_DATA/coverage.json`. The gate's `markers` step passed.
- **Typecheck and the unit steps** were not re-run. I relied on the gate log.

## Side effects outside my scratchpad

- `.env.local` was copied into this worktree from `.data/integ-w39/.env.local`, and `bun install --frozen-lockfile` linked `node_modules`
  (both gitignored).
- I wrote nothing under the main checkout's `.data`: no run dir, no subject build, no oracle cache entry, no coverage file. The key
  recomputation and the import-graph check ran `Bun.build` in memory, with no output, over a `git archive` tree in my scratchpad. I deleted
  the tree afterwards.
- This file is the only tracked change.
