# Handoff: harness-w13 (M3a HIR suites + sparse `tests/auxiliary`; harness batch, needs an independent review)

Branch `lane/harness-w13`, based on main 2e11981. No ported upstream code, so there are no coverage numbers, no
`// rustc:` markers, no `unported(...)` and no `// PORT:`. Baselines, runner scripts, probes and the existing
suites are unchanged. The three new suites start unprotected.

## Files touched
- `harness/suites.ts`: suites `hir-tree-nocore`, `hir-tree` and `unpretty-hir`, appended after the with-std block.
  `nocoreArgs`, `stdArgs`, `NOCORE_ENV` and `NOCORE_SKIPPED` are reused and not edited.
- `UPSTREAM.json`: `tests/auxiliary` added to `rust.sparse` (plan-m3 D11). This is the whole "scripts" change.
  `scripts/upstream.ts fetch` already runs `git sparse-checkout set ...PIN.sparse`, so no script needed editing.
  `sparse` is not part of any oracle cache key (`cachePath` uses `PIN.commit`, not the sparse list), and no corpus
  walks `tests/` above `tests/ui`, so existing suites and cache entries are unaffected.
  - Applied to the shared checkout with `bun scripts/upstream.ts fetch` (7 s). `tests/auxiliary/{minicore.rs,
    minisimd.rs,rust_test_helpers.c}` now exist, `upstream.ts status` is ok, and the checkout is clean. Other
    worktrees still carry the old list until they merge main. If anyone runs `fetch` from an old worktree, it
    drops `tests/auxiliary` again (`sparse-checkout set`). This is harmless to the M2 suites.

## Setup (plan-m3 §1a, §4)
- One process per file. env `NOCORE_ENV` (`RUSTC_ICE=0`, `RUST_BACKTRACE=0`). Subject timeout 60 s; oracle
  timeout 300 s plus the 4x retry. Oracle is `rustc +nightly <args>`; subject is `bun src/rust_ts/main.ts <args>`.
  milestone `M3a`.
- `hir-tree-nocore`: `nocoreArgs(f)` + `-Zunpretty=hir-tree` + file, as `expanded-nocore` with only the mode
  changed.
- `hir-tree`: `stdArgs(f)` + `-Zunpretty=hir-tree` + file, as `expanded`.
- `unpretty-hir`: `stdArgs(f)` + `-Zunpretty=hir` + file. The plan says "as hir-tree", so it uses the with-std
  corpus.
- Neither mode runs analysis (`needs_analysis()` is false, config.rs:3334). hir-tree is pretty.rs:298, hir is
  pretty.rs:271 (`PpHirMode::Normal`).

## Skips (measured on the oracle only; scratch `$RUST_TS_DATA/tmp/harness-w13/`: `time.ts`, `time-cpu.ts`, `cands.ts`, `t-*.tsv`)
The host was heavily loaded during most runs (load average 40 to 600 on 12 cores), so wall times are upper bounds.
CPU time decides where it matters.

| file | hir-tree nocore | hir-tree std | hir std | hir nocore |
|---|---|---|---|---|
| associated-consts/issue-93775.rs | killed 1560 s, 0 B | killed 1560 s, 0 B | 0.05 s | 0.06 s |
| expr/if/expr-stack-overflow.rs | killed 1560 s, 0 B | killed 1560 s, 0 B | 0.06 s | 0.06 s |
| parser/survive-peano-lesson-queue.rs | killed 1560 s, 0 B | killed 1560 s, 0 B | 0.18 s | 0.16 s |
| try-trait/deep-try-chain-issue-153583.rs | exit 1 in 0.10 s | **1754 s CPU, no output, stopped** | 0.08 s (26.8 MB) | 0.05 s |
| suggestions/fn-to-method-deeply-nested.rs | exit 1 in 0.05 s | 182 s CPU / 641 s wall, 164 MB, exit 1 | 0.05 s | - |

Resulting skip lists:
- `hir-tree-nocore` skips the same 3 files as the nocore suites (`HIR_TREE_NOCORE_SKIPPED`), with hir-tree-specific
  reasons. Its case list equals `expanded-nocore`'s: 21,523 cases.
- `hir-tree` skips those 3 plus `deep-try-chain-issue-153583.rs` (`HIR_TREE_SKIPPED`), so 21,522 cases.
  - Without std, `deep-try-chain-issue-153583.rs` fails at once: there is no `Result`, and lowering `?` reports
    "requires `branch` lang_item". So the nocore suite keeps it.
  - `fn-to-method-deeply-nested.rs` stays. 182 s of CPU fits the retry budget, and the result is cached once per
    oracle build. Its gzipped cache entry holds 164 MB of `{:#?}` text.
- `unpretty-hir` skips nothing (21,526 cases): every file above takes < 0.2 s. **Departure from the M2 precedent**
  of one case list per family, following review harness-w12 L1. Root may record this as a decision.

Other heavy files: I timed 231 candidates per mode, chosen with the harness-w12 heuristics (top 15 by size, top 20
by bracket depth, top 15 by std-macro count, top 15 by recursion_limit, plus paths matching
deep/stack-overflow/blowup/slow/hang/huge/exponential/quadratic/perf/many-/large). Runs were 3 in parallel under load:

| mode | exit codes | total wall | slowest |
|---|---|---|---|
| hir-tree nocore | 54 x 0, 177 x 1 | 34.9 s | mir/issue-29227.rs 9.7 s (22.4 MB), expr/weird-exprs.rs 6.5 s |
| hir-tree std | 175 x 0, 54 x 1, 2 killed at 300 s (the two files above) | 648 s | mir/issue-29227.rs 9.2 s (22.4 MB) |
| hir std | 176 x 0, 55 x 1 | 12.3 s | 0.23 s |

No ICE (exit 101) and no other timeout, so nothing else needs skipping.

## Sample results (`RUST_TS_AGENT=harness-w13`, `--jobs 4`, `--impl port`)
| suite | sample | MATCH | DIFF | UNPORTED | CRASH | TIMEOUT | ORACLE_TIMEOUT | run |
|---|---|---|---|---|---|---|---|---|
| hir-tree-nocore | 50 | 8 | 0 | 42 | 0 | 0 | 0 | `20261014-015825-harness-w13-ttg7` |
| hir-tree | 20 | 6 | 0 | 14 | 0 | 0 | 0 | `20261014-015829-harness-w13-utp5` |
| unpretty-hir | 20 | 6 | 0 | 14 | 0 | 0 | 0 | `20261014-015830-harness-w13-qrx3` |

- **UNPORTED stops, all of them:**
  - hir-tree suites: `rustc_driver_impl::pretty::print (HirTree: needs a TyCtxt)`.
  - unpretty-hir: `rustc_driver_impl::pretty::print (Hir: needs a TyCtxt)`.
- **The MATCHes are error cases.** I re-ran the oracle by hand on every MATCH: all exit 1. The crate has errors
  before or during lowering, so nothing is printed and both sides emit the same diagnostics. No MATCH comes from
  printing HIR.
- **No ORACLE_TIMEOUT anywhere.**

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (7925; vendor 3664)`.

## Notes for root
- **Cost:** a cold full `hir-tree` run pays about 3 to 11 min for `fn-to-method-deeply-nested.rs`, since its first
  300 s attempt can time out before the retry. The oracle cache grows by about one hir-tree dump per case.
  hir-tree output is several times larger than ast-tree output; `mir/issue-29227.rs` alone is 22 MB. Check disk
  before the first full run.
- **Plan D11 follow-ups that are not in this lane:**
  - building minicore/mini_core with the oracle;
  - `harness/compiletest.ts:409` accepting `add-minicore`.
  Both belong to the probe-tydump / later harness batches.
