# Handoff: bck-nll (M4 wave 23, borrowck fill)

Branch `lane/bck-nll` (base `e138140f` on integ-w19, no merges). Commits: `c2a2f910` (the 64 stubs of the row + re-pins),
`cc54b10c` (`emit_drop_facts`, root decision), this handoff.

## Result
All stubs of the bck-nll row are filled, **65** in total: the split table's 64 plus `polonius/legacy/mod.rs:184
emit_drop_facts`, which root moved from bck-polonius-legacy to this lane during the wave. bck-tc-live's liveness code
calls it on every run with a drop-live local; it returns at once when there are no facts.

| upstream (compiler/rustc_borrowck/src/) | coverage |
|---|---|
| nll.rs | 8/8 |
| renumber.rs | 9/9 |
| consumers.rs | 5/5 |
| universal_regions.rs | 34/34 |
| polonius/legacy/location.rs | 7/7 |
| polonius/legacy/facts.rs | 3/20 (`enabled` here; the 17 others are bck-polonius-legacy, wave 26) |
| polonius/legacy/mod.rs | 2/5 (`emit_facts`, `emit_drop_facts`; the 3 others are bck-polonius-legacy) |

`bun scripts/coverage.ts --check`: markers ok (20485; vendor 4330).

### contract.test.ts deltas (root merges these by delta)
- markers `42 -> 107` (+65), stubs `859 -> 794` (-65).
- split table: the `bck-nll` row went from 64 to 0, so it is now a comment. `bck-polonius-legacy` went from 41 to 40
  (`emit_drop_facts` moved out).
- The legacy-polonius ownership check (`main_path`) now also lists `emit_drop_facts` as a main-path fn.
- Runtime stop re-pinned: `rustc_borrowck::nll::replace_regions_in_mir` -> **`rustc_borrowck::borrow_set::BorrowSet::build`**
  (bck-core).

## New runtime stop
`borrowck_collect_region_constraints` now runs `replace_regions_in_mir` (`UniversalRegions::new` + `renumber_mir` +
the `renumber` MIR dump), `PoloniusLocationTable::new`, `MoveData::gather_moves`, and stops at `BorrowSet::build`
(bck-core). The next stubs on the path are in the contract handoff's order. My filled code they will reach:
- `PoloniusFactsExt::enabled`.
- `nll::compute_regions`. It goes through `compute_sccs_applying_placeholder_outlives_constraints` (bck-regions-b),
  `emit_facts`, polonius-next `compute_loan_liveness` (bck-polonius) and `RegionInferenceContext::solve`
  (bck-regions-a).
- `dump_nll_mir`, which needs `RegionInferenceContext::dump_mir` and the graphviz dumps (bck-regions-b).
- `dump_annotation`, which needs `RegionInferenceContext::annotate` (bck-regions-a) and
  `ClosureOutlivesSubjectTy::instantiate` (bck-lib-a).

## Tests re-pinned outside my row (same stop change; no assertion weakened)
These pinned the old stop, so they fail without the re-pin. Each now names the exact new stop. They belong to other
lanes, so please review.
- `src/rustc_hir_analysis/collect_test/misc.expected.txt:80` (`type_of STOP UNPORTED: ...`)
- `src/rustc_lint/late_c.oracle.test.ts:231` (`blocked_by`)
- `src/rustc_lint/late_e2.oracle.test.ts:329` (`stop`)

Two more tests still pinned the **pre-contract** stop `mir_borrowck provider (not ported)`. They were already stale at the
branch base: the contract lane changed the provider and its handoff does not list them. The full suite showed them, and
each is re-pinned to the exact stop it now hits:
- `src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts:38`: 11 PENDING cases ->
  `rustc_borrowck::borrow_set::BorrowSet::build`.
- `src/rustc_hir_analysis/hir_ty_lowering/errors.oracle.test.ts:38` (`e0109_kinds`) ->
  `rustc_mir_transform::cleanup_post_borrowck::CleanupPostBorrowck (pass not ported)`. Its body is tainted, so
  `mir_borrowck` returns `Err` and the run continues to the post-borrowck passes. This is not caused by this lane.

If bck-core lands `BorrowSet::build` in the same merge, these three and the contract test move together to the next
stop.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_borrowck`: 6 pass (contract test included). `collect.test.ts` 2 pass; `late_c` / `late_e2`
  31 pass.
- Every changed hand module loads as a fresh entry point. `universal_regions.ts` takes `NllRegionVariableOrigin` from
  `rustc_infer/infer/mod.ts`, because entering `mod.gen.ts` hits a TDZ on `InferOk`. `nll.ts` / `facts.ts` enter
  rustc_session through its `lib.ts`, as lib.ts does.
- Full unit suite (`RUST_TS_REQUIRE_PROBES=1 RUST_TS_AGENT=bck-nll bun test src --timeout=120000`, at `cc54b10c`):
  **6095 pass, 1 skip, 12 fail** (6108 tests, 436 files). All 12 failures were the two stale e2e pin files above.
  After re-pinning them, those two files give 62 pass, 0 fail. I did not rerun the whole suite, to respect the
  once-only rule.

## Samples (`RUST_TS_AGENT=root-f5de`, same samples as root's base runs)
| suite | lane run | M / D / U / C / UNSTABLE | base run | changes vs base |
|---|---|---|---|---|
| tydump-minicore (46) | `20261022-211233-root-f5de-j1zr` | 45 / 0 / 1 / 0 / 0 | `20261022-175059-root-f5de-8kp6` | 1 CTFE stop message (not this lane) |
| mirdump-minicore (46) | `20261022-211334-root-f5de-89fw` | 45 / 0 / 1 / 0 / 0 | `20261022-175111-root-f5de-bbue` | 28 UNPORTED->MATCH, 1 CTFE stop message (from the newer base tree, not this lane) |
| tydump-ui `--sample 300` | `20261022-211442-root-f5de-t94n` | 261 / 0 / 37 / 0 / 2 | `20261022-175123-root-f5de-supl` | 3 UNPORTED->MATCH; 21 `mir_borrowck provider (not ported)` -> `BorrowSet::build`; 1 -> `IntoDiagArg without a TS impl`; 13 CTFE stop messages |
| mirdump-ui `--sample 300` | `20261022-212024-root-f5de-ty7f` | 269 / 0 / 31 / 0 / 0 | `20261022-175248-root-f5de-c6id` | 252 UNPORTED->MATCH (newer base tree); 13 `mir_borrowck` -> `BorrowSet::build`; 18 CTFE stop messages |
| borrowck-ui `--sample 300` | `20261022-212420-root-f5de-v4pb` | 0 / 0 / 300 / 0 / 0 | `20261022-210635-root-f5de-gxw0` (earlier root-f5de run, same sample) | 287 `replace_regions_in_mir` -> `BorrowSet::build`; 13 `eval_in_interpreter` unchanged |

**No MATCH became anything else, and there are no new DIFF / CRASH / TIMEOUT.** The universal-regions and renumbering
code runs on 287 + 21 + 13 real bodies without an ICE. The base runs predate the branch base (f5de vs e138140f), so the
UNPORTED->MATCH and CTFE message changes come from the intervening integ-w19 work, not from this lane.

## `unported(...)` left in my files
- `nll.ts` `compute_regions`: `polonius_engine::Output::compute (vendor polonius-engine, plan-m4 D7, wave 26)`. Only
  `-Zpolonius=legacy` or a consumer asking for polonius output reaches it, and both already stop at
  `PoloniusFacts::default()`.
- `polonius/legacy/mod.ts` `emit_drop_facts`: `polonius_engine::AllFacts::drop_of_var_derefs_origin (vendor
  polonius-engine, plan-m4 D7, wave 26)`. It is only reached when facts exist. Just before it, the closure calls
  `PoloniusRegionVid_from_RegionVid`, which is a bck-polonius-legacy stub.
- Other lanes' stubs that my code calls are listed under "New runtime stop". `emit_facts` also calls
  `emit_move_facts` / `emit_universal_region_facts` / `emit_outlives_facts`, `emit_loan_kills`,
  `emit_loan_invalidations`, `emit_access_facts` and `PoloniusFactsExt::write_to_dir` (bck-polonius-legacy). These only
  run with facts.

## `// PORT:` decisions
- nll.ts:
  - `PoloniusFacts | undefined`, with `Output::compute` unported (header).
  - `MirDumper::create_dump_file`'s writer is mir/pretty.ts's **unexported** `DumpFile`. Its `drop()` (flush + close at
    the end of the `try` block) is reached through a structural cast `Write & { drop(): void }`.
  - rustc_session is entered via its lib.ts.
  - The `tcx.prof` timer is dropped.
  - `PathBuf::from(..).join(..)` is std/path.ts `path_join`.
- universal_regions.ts:
  - A local `split_last` helper (std `<[T]>::split_last`; there is no shared one).
  - The `Const { inline: false }` / `Static` or-arm is written out in both switch cases (TS has no fallthrough here).
  - `iter::zip` in `compute_indices` is an explicit iterator loop. It pulls the identity side first, as `zip` does.
  - `Cell<Option<ErrorGuaranteed>>` is the field itself.
  - Header notes from the contract are unchanged.
- polonius/legacy/facts.ts: rustc_session is entered via its lib.ts. polonius/legacy/mod.ts: `tcx.prof` timers are
  dropped, and `emit_drop_facts`'s `AllFacts` push is unported.
- consumers.ts: `tainted_by_errors` is the root context's field (as `mir_borrowck` in lib.ts does). It imports
  `./root_cx.ts` for its side effects (`BorrowCheckRootCtxt::new`).
- `#[instrument]` / `debug!` are kept as comments. `RegionCtxt` closures are passed but never called, because
  `next_nll_region_var`'s debug-assertion block is compiled out.

## For other lanes / root
- rustc_middle mir/pretty.ts could export `DumpFile`. nll.ts would then drop the structural cast.
  bck-polonius-legacy's `write_to_dir` may need it as well.
- bck-core: once `BorrowSet::build` is filled, re-pin the contract test and the three tests above to the next stop.
