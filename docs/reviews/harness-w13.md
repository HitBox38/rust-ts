REJECT

# Review: harness-w13 (`lane/harness-w13` at 14c161d)

Reviewer: reviewer-w13 (independent, read-only on the lane).
- **Scope:** `git diff lane/plan-m3...lane/harness-w13` (merge base a177e1d): `harness/suites.ts` (+86 lines, appended after
  the with-std block), `UPSTREAM.json` (`tests/auxiliary` added to `rust.sparse`) and `docs/handoff/harness-w13.md`.
- **Merge and build:**
  - `git merge-tree --write-tree main lane/harness-w13` is clean.
  - `bunx tsc --noEmit -p .` in the lane worktree prints nothing.
  - `git diff --stat lane/plan-m3...lane/harness-w13 -- scripts harness/baseline tools src docs/state` is empty.

**Summary.**
- **The three suites are good.** `hir-tree-nocore`, `hir-tree` and `unpretty-hir` are their M2 twins with only `-Zunpretty`
  changed. The skips hold up on an idle host. The sample MATCHes are real comparisons.
- **The `UPSTREAM.json` sparse change is not safe as submitted (B1, blocking).** 27 protected `tests/ui/simd` files read
  `tests/auxiliary/minisimd.rs` through `#[path]`. The oracle cache key does not cover that file. So adding or removing the
  directory makes cached oracle outputs stale, and protected cases are lost.
  - Root confirmed the same finding independently.
  - The handoff's "harmless to the M2 suites" / "no corpus walks `tests/` above `tests/ui`" is wrong.
- **Verdict:** REJECT as one batch. Two ways to resubmit, both covered under "What I require":
  - the suites alone (I would ACCEPT-WITH-NOTES);
  - the sparse change together with a cache-key fix.

## B1 (BLOCKING): `tests/auxiliary` changes the input of 27 protected cases, and the cache key does not see it

**Which files.**
- `grep -rnE '(\.\./)+auxiliary/[A-Za-z_]+\.(rs|c)' tests/ui` finds 27 files outside `auxiliary/` directories. They are 17 under
  `tests/ui/simd/intrinsic/` (`../../../auxiliary/minisimd.rs`) and 10 under `tests/ui/simd/`
  (`../../auxiliary/minisimd.rs`).
- Every one resolves (`realpath`) to `tests/auxiliary/minisimd.rs`. The list is in scratch `refs-files.txt`.
- All 27 are protected in `expanded-nocore`, `unpretty-expanded-nocore`, `resdump-nocore`, `expanded`, `unpretty-expanded`
  and `resdump`, which is 162 protected cases. They are also protected in lex/tokens/escape/parse, but those suites do not
  load modules, so they are unaffected.

**What changes.**
- Without the directory, both sides report `error: couldn't find file 'tests/ui/simd/../../auxiliary/minisimd.rs'`, and
  `expanded-nocore` prints nothing on stdout.
- With it, the module is loaded and the whole crate is printed.

**Why the cache cannot tell.** `cachePath` (`scripts/difftest.ts:145`) keys on
`[PIN.commit, oracleVersion, suite, id, args, fileHash(case file), env]`. `fileHash` (`:106`) hashes only the case file. Nothing
covers files the case pulls in (`#[path]`, `include!`, out-of-line `mod`), and nothing covers the sparse set.

**Evidence.** While the lane's sparse set was on the shared checkout (applied at 03:38 local, before review), I ran
`bun scripts/difftest.ts --suite <s> --filter tests/ui/simd/` (75 cases each; runs `rv-hw13-simd-*`):

| suite | MATCH | DIFF |
|---|---|---|
| expanded-nocore | 48 | **27** |
| unpretty-expanded-nocore | 48 | **27** |
| resdump-nocore | 48 | **27** |
| expanded | 48 | **27** |
| unpretty-expanded | 75 | 0 |
| resdump | 75 | 0 |
| parse | 75 | 0 |

- **The DIFF ids are exactly the 27 minisimd files.**
  - First difference, `expanded-nocore`: oracle `""` vs subject `"Crate {"`.
  - The cached oracle stderr is the "couldn't find file" error.
  - So the oracle entries were cached before the fetch, and the subject now sees the module.
- **Mixed cache.** `unpretty-expanded` and `resdump` matched because other runs had refilled their entries after the
  fetch. 36,910 cache files were written between the fetch and my check. Those entries became stale in the other direction
  once root restored main's sparse set. These are the 54 entries root removed: 27 x 2 suites.
- **Silent failure.** The cache's correctness depended on when each entry was written, and nothing reported it.
- **After root's restore.** I re-ran the same filter on all six suites with the directory absent (runs `rv-hw13-simd2-*`):
  75/75 MATCH in each. The shared checkout's sparse list is back to main's, and `git status --porcelain` is clean.

**The batch itself does not lose protected cases once the cache is consistent.**
- With the directory present, I ran oracle and subject by hand on all 27 files. I used the exact suite argv, env
  `RUSTC_ICE=0 RUST_BACKTRACE=0` and cwd = upstream, with no cache.
- `-Zunpretty=ast-tree,expanded` and `-Zunpretty=expanded`, nocore and std: 27/27 have `cmp`-identical stdout and stderr,
  and equal exit codes. Exit is 1 for all nocore runs and 0 for all std runs.
- The resdump probe was not hand-run.
- So the problem is the cache key, not the port. A gate run with a correct key should show no loss. Root must confirm
  that with the gate.

**Worktree flip risk (handoff note).** The handoff's warning is real and worse than it says.
- `scripts/upstream.ts fetch` runs `git sparse-checkout set ...PIN.sparse`.
- Running it from any worktree whose `UPSTREAM.json` differs flips `tests/auxiliary` in the shared checkout.
- With the current key, every flip silently poisons the cache for these 27 cases, in whichever suites run before the next
  flip back.
- That is not "harmless".

### What I require before the sparse change can be accepted
1. **Required: option (a), a cache-key fix, in a reviewed scripts batch.**
   - For a case whose source references a file outside its own directory tree (at minimum the `(\.\./)+auxiliary/` pattern
     above), fold the content hash of each resolved target, or a fixed `missing` marker, into that case's key.
   - The fix must change the keys of only the cases that reference such files, so every other cache entry stays valid.
   - Hashing `PIN.sparse` into `oracleVersion` would also be correct, but it would throw away the whole cache.
   - With (a), worktrees flipping the directory only switch between two valid keys, so the flip risk goes away.
2. **Not sufficient: option (b), a documented invalidation step.** It is manual, it has to be repeated at every flip from
   every worktree, and its failure is silent. I would accept (b) only as a stop-gap together with a STOP-style rule. That
   rule would be that no `fetch` and no oracle runs happen on the shared checkout until all lanes are on the new `UPSTREAM.json`.
   I do not recommend it.
3. **Sequencing.**
   - Do not apply the sparse set to the shared checkout until the key fix is on main.
   - Then run one full gate. Every affected suite has to recompute these 27 cases.
   - Confirm that no protected case is lost, and accept on that run.
4. **Also acceptable: do D11 another way.** Minicore can be built from a copy of `tests/auxiliary` outside the
   shared `tests/` tree, for example a separate sparse checkout or `git show <pin>:tests/auxiliary/minicore.rs` into
   `$RUST_TS_DATA/aux`. That leaves every existing suite's input unchanged.

## 1. Symmetry of oracle and subject (OK)
I loaded the lane's `harness/suites.ts` and walked every case of each new suite against its M2 twin (scratch `argv.ts`):

| suite | cases | twin | ids not in twin | twin-only ids | args != twin args (mode swapped) | env != twin | trailing argv != case args |
|---|---|---|---|---|---|---|---|
| hir-tree-nocore | 21,523 | expanded-nocore (21,523) | 0 | none | 0 | 0 | 0 |
| hir-tree | 21,522 | expanded (21,523) | 0 | `deep-try-chain-issue-153583.rs` | 0 | 0 | 0 |
| unpretty-hir | 21,526 | expanded (21,523) | 3 (the `NOCORE_SKIPPED` files) | none | 0 | 0 | 0 |

- **Commands:** the oracle is `rustc +nightly <args>`, and the subject is `bun src/rust_ts/main.ts <args>`.
- **Settings shared with the twins:**
  - mode `single`;
  - timeouts of 60 s for the subject and 300 s for the oracle;
  - no `cwd`, so both sides run in the upstream checkout;
  - env `NOCORE_ENV` on both sides, which is also part of the cache key.
- **Cache keys:** the suite names are new, so the new suites get fresh keys and existing keys are untouched.
- **Milestone:** `M3a`. The suites match plan-m3 §4.

## 2. Skips
- **The 3 `NOCORE_SKIPPED` files in `hir-tree-nocore` and `hir-tree`: convincing.**
  - The lane's wall times were taken at load 40 to 600, so they were weak on their own (scratch `t-skip-tree-*.tsv`:
    SIGKILL at 1559.96 s, 0 B).
  - I re-measured on an idle host (load about 2 at the start, rising to about 30 near the end from other sessions; 6 processes on 12 cores; scratch `cpu.ts`; CPU read with `ps`).
    -Zunpretty=hir-tree, nocore and std, on all 3 files: see the table at the end of this section.
  - Every run was still going, with 0 B of stdout, when I stopped it at 1727 s wall (1464 to 1648 s of CPU each). That is past the oracle's 300 s + 4 x 300 s = 1500 s, so each would be ORACLE_TIMEOUT on every run.
  - RSS stayed at 0.1 to 0.5 GB, so this is CPU time, not output size.
  - The ast-tree twins already hang on the same files.
- **New `deep-try-chain-issue-153583.rs` skip in `hir-tree` (std only): justified.**
  - The lane has a CPU-time measurement: 1754 s of CPU with no output, then SIGTERM (`t-cpu-tree-std.tsv`). That is above the
    1500 s budget in CPU terms alone.
  - Without std, it fails fast. I measured exit 1 in less than 0.1 s, the same as the lane's 0.10 s.
  - So `hir-tree-nocore` correctly keeps it.
  - It stays protected in `expanded`/`expanded-nocore`. That is unaffected.
- **`unpretty-hir` with no skips: consistent and acceptable.**
  - I measured `-Zunpretty=hir` with std on all 4 files: exit 0, under 0.2 s, stdout 3.8 kB to 26.8 MB.
  - Following review harness-w12 L1, each suite skipping only what it measurably must is the better rule.
  - The one-list-per-family precedent was a convenience, and these suites start unprotected.
  - Root should record the departure as a decision, as the handoff suggests.
- **INFO.** The `HIR_TREE_*` reason strings are precise for their mode, which fixes harness-w12 I1 for these suites.
- **`fn-to-method-deeply-nested.rs` kept in `hir-tree`: acceptable.**
  - The lane measured 182 s of CPU and 164 MB of output (`t-cpu-tree-std.tsv`).
  - On an idle host it fits the first 300 s attempt. Under load (641 to 777 s wall), it fits the 1200 s retry with about
    6.6x CPU headroom.
  - ORACLE_TIMEOUT is handled safely, and this batch does not touch it:
    - `classify` returns ORACLE_TIMEOUT first (`difftest.ts:360`);
    - it is never cached and never MATCH;
    - the gate counts a protected ORACLE_TIMEOUT as a loss (harness-w12 §4).
  - The worst case is a slow cold run, not a false pass.
  - **INFO.** The subject has 60 s to print the same 164 MB, so this case may stay TIMEOUT for a long time. That is
    harmless.
- **Other heavy files.** The lane timed 231 candidates per mode (`t-cands-*.tsv`, 231 rows each).
  - Exit codes are only 0 and 1, apart from the 2 hir-tree std kills, which are the 2 files above.
  - The slowest other files are `mir/issue-29227.rs` (9.7 s, 22 MB) and `expr/weird-exprs.rs` (6.5 s).
  - No ICE. This supports "nothing else needs skipping".

Idle re-measurement, `-Zunpretty=hir-tree`:

| file | nocore | std |
|---|---|---|
| associated-consts/issue-93775.rs | 1611 s CPU, 0 B, stopped | 1464 s CPU, 0 B, stopped |
| expr/if/expr-stack-overflow.rs | 1464 s CPU, 0 B, stopped | 1614 s CPU, 0 B, stopped |
| parser/survive-peano-lesson-queue.rs | 1464 s CPU, 0 B, stopped | 1648 s CPU, 0 B, stopped |

## 3. `UPSTREAM.json`
- **The pin is unchanged:** commit, release, toolchain and nightlyName are the same, and only `sparse` changes.
- **"Alters no file the existing protected suites read": false.** See B1: the 27 simd cases read `tests/auxiliary/minisimd.rs`.
- **The `add-minicore` tests are unaffected.** `harness/compiletest.ts:409` rejects them regardless, and the
  `extern crate minicore` cases fail E0463 either way.

## 4. Nothing protected changed (OK for the files; see B1 for behaviour)
- No file under `scripts/`, `harness/baseline/`, `tools/`, `src/` or `docs/state/` changed.
- The `suites.ts` diff only adds lines. `nocoreArgs`, `stdArgs`, `NOCORE_ENV` and `NOCORE_SKIPPED` are reused unedited.
- The only behavioural change to protected suites comes through the sparse set (B1).

## 5. Spot-check (OK)
`RUST_TS_AGENT=reviewer-w13 bun scripts/difftest.ts --suite hir-tree-nocore --sample 30`, run `20261014-020123-reviewer-w13-4bli`:

| sample | MATCH | DIFF | UNPORTED | CRASH | TIMEOUT | ORACLE_TIMEOUT | skipped |
|---|---|---|---|---|---|---|---|
| 30 | 3 | 0 | 27 | 0 | 0 | 0 | 3 |

- **The UNPORTED cases:** all 27 stop at `rustc_driver_impl::pretty::print (HirTree: needs a TyCtxt)`, as the handoff says.
- **The MATCHes are real, but they are not HIR evidence.** I hand-ran both sides with the suite's argv, env and cwd:

  | MATCH | stdout | stderr | exit | reason |
  |---|---|---|---|---|
  | `abi/foreign/invoke-external-foreign.rs` | 0/0 B | 297 B, `cmp`-identical | 1 / 1 | E0463, can't find crate `foreign_lib` |
  | `asm/x86_64/issue-96797.rs` | 0/0 B | 280 B, `cmp`-identical | 1 / 1 | E0463, can't find crate `minicore` |
  | `macros/macro-stability-rpass.rs` | 0/0 B | 329 B, `cmp`-identical | 1 / 1 | E0463, can't find crate `unstable_macros` |

  - **Not vacuous:** `classify` compares stdout, stderr and the exit code. Both sides emit the same non-empty diagnostics
    and exit 1.
  - **Fatal before lowering:** each one is a fatal crate-loading error during resolution, so lowering never runs.
  - **What protecting them means:** they test the pre-lowering pipeline only, the same thing `expanded-nocore` already
    protects. That is fine, but root should not read early hir-tree MATCH counts as HIR progress.
  - **Error-but-printed cases are not MATCHes:** the oracle still prints HIR after non-fatal errors, for example
    `mir/issue-29227.rs`, which exits 1 with 22 MB. The subject reports UNPORTED on those.

## Gate recommendation
- **Do not merge as is.**
  - Either split the batch: the three suites without the `UPSTREAM.json` change, which I would accept with the notes above;
  - or resubmit the sparse change together with the cache-key fix in §B1 (1).
- **Before protecting `hir-tree`:**
  - check disk; the host has 18 GB free, and the cache grows by one `{:#?}` dump per case (22 MB for `mir/issue-29227.rs`
    alone, 164 MB raw for `fn-to-method-deeply-nested.rs`);
  - record the `unpretty-hir` no-skip decision.
- **INFO, general.** The same key hole exists for any `#[path]`, `include!` or out-of-line `mod` target outside the case
  file. It is harmless only while the checkout is fixed by the pin. Any future change to the sparse set, or a local edit in
  the checkout, has the same failure mode.

## Scratch
- Scratch is under `$RUST_TS_DATA/tmp/review-hw13/`.
- Runs: `20261014-020123-reviewer-w13-4bli`, `rv-hw13-simd-*` (with the directory present) and `rv-hw13-simd2-*` (after
  root's restore).
