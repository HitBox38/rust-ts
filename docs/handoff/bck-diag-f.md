# Handoff: bck-diag-f (M4 wave 24, borrowck diagnostics, pulled forward)

Branch `lane/bck-diag-f`, base 53eeb8be (integ-w19 = f0e9a0cf + fix-w23-ctfe). No merges. Commits:
56a67561 (first priority: `UniverseInfo::{other, relate}` + the `ToUniverseInfo` impls), cc955f47 (rest of
bound_region_errors.rs), eb034970 (borrowck_errors.rs), de297aee (explain_borrow.rs), 0e4a2a91 (opaque_types.rs),
ff2733c8 (outlives_suggestion.rs + `TailExprDropOrder`), ce8d0c92 (fidelity fix in `later_use_kind`), then this handoff.

## Result
All **70** split-table stubs of the row are filled (`grep -rn "(lane bck-diag-f)" src` is empty). Coverage
(`bun scripts/coverage.ts --missing compiler/rustc_borrowck/src/<file>`):

| upstream file | ported |
|---|---|
| diagnostics/bound_region_errors.rs | 27/27 (23 stubs + the 4 trait-member markers that were already there) |
| diagnostics/explain_borrow.rs | 10/10 |
| diagnostics/opaque_types.rs | 5/5 |
| diagnostics/outlives_suggestion.rs | 6/6 |
| borrowck_errors.rs | 25/25 |
| session_diagnostics.rs | 1/1 (the manual `impl Diagnostic for TailExprDropOrder`; the derives are generated) |

`src/rustc_borrowck/contract.test.ts` counts: markers 397 -> **467**, stubs 504 -> **434**, split-table row
`"bck-diag-f": 70` -> removed (comment `// "bck-diag-f": 0 (filled, wave 24)`). Root merges these by deltas: **+70
markers, -70 stubs**.

All diagnostic text is upstream's: `struct_span_code_err` messages / labels / notes / suggestions are copied
verbatim (format strings expanded in template literals, `{:#}` of `CoroutineKind` is `display_CoroutineKind(k, true)`),
and the session diagnostics are the generated `*_diagnostic` constructors (`HigherRankedLifetimeError`,
`HigherRankedSubtypeError`, `MoveBorrow`, `LifetimeMismatchOpaqueParam`).

## Where the `UniverseInfo::relate` cases stop now (first priority)
Every case that stopped at `rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::relate` (non-trivial
consts, CTFE through `mir_borrowck`, most real bodies) now goes on into region inference and stops at
**`rustc_borrowck::constraints::OutlivesConstraintSet::push`** or
**`rustc_borrowck::constraints::OutlivesConstraintSet::reverse_graph`** (both lane **bck-regions-b**,
constraints/mod.rs). Seen in the samples: mirdump-minicore `mini_core_hello_world.rs` -> `OutlivesConstraintSet::push`;
tydump-ui 14 x `push`, 13 x `reverse_graph`; borrowck-ui 77 x `push`, 30 x `reverse_graph` (of the cases that did not
time out under load, see below). No sampled case stops in this lane's code any more.

## Runtime stops for root to re-pin (I did not touch any stop pin)
- `src/rustc_borrowck/contract.test.ts` "mir_borrowck: ... a real body reaches the first stub": the pin
  `rustc_borrowck::borrow_set::BorrowSet::build` is already stale at the base (known failure, fix-w23-bck owns it);
  on this branch `f` stops at **`rustc_borrowck::constraints::OutlivesConstraintSet::reverse_graph`** (bck-regions-b).
- `src/rustc_symbol_mangling/symbol_names.oracle.test.ts` `STOP_CONST_EVAL` (re-pinned by fix-w23-ctfe to
  `UniverseInfo::relate`) and the other pins that name `UniverseInfo::relate`: they move to
  `OutlivesConstraintSet::push` / `reverse_graph`. The full unit run below lists the exact failing pins.

## Stubs of other lanes that this lane's code now calls (it reaches them only when an error is reported)
- bck-diag-d (diagnostics/mod.rs): `MirBorrowckCtxt::{buffer_error, buffer_error_with_sort_span, local_name,
  describe_place, move_spans, borrow_spans, add_placeholder_from_predicate_note, add_sized_or_copy_bound_info}`,
  `BorrowckDiagnosticsBuffer::{buffer_error, buffer_error_with_sort_span}`, `UseSpans::or_else`.
- bck-diag-e (region_errors.rs / region_name.rs): `MirBorrowckCtxt::{mir_def_id, give_region_a_name}`,
  `RegionInferenceContext::to_error_region_vid`, `ConstraintDescription_ConstraintCategory.description`,
  `RegionName::{was_named, highlight_region_name}`, `display_RegionName` (`impl Display for RegionName`).
- bck-regions-b: `RegionInferenceContext::name_regions_for_member_constraint` (region_infer/opaque_types/mod.rs).

## `unported(...)` left
None in this lane's files (all `unported` imports removed).

## `// PORT:` decisions
- bound_region_errors.ts: `d_ParamEnvAnd_ProvePredicate` / `d_ParamEnvAnd_AscribeUserType` / `d_Normalize` (the
  derived `TypeFoldable` of the type-op keys handed to `build_with_canonical`, same D4 descriptors as rustc_traits
  type_op.ts, which keeps its own private copies); `checked_sub_u32` (`u32::checked_sub`);
  `InstantiateOpaqueType::nice_error` passes `mbcx.infcx.infcx` (deref coercion `&BorrowckInferCtxt -> &InferCtxt`).
  `regions_the_same` compares `BoundRegion`s with `intern_key_eq` (derived `PartialEq`).
- explain_borrow.ts: the fn-local `FindLetExpr` lives inside `add_explanation_to_diagnostic` again (header updated);
  `first(it)` = `iter.next()` of `tcx.hir_parent_iter(..)`; rustc_session is entered through its lib.ts before
  `Polonius` is imported from config.ts (the fresh-entry test failed with a TDZ otherwise; nll.ts does the same);
  `tcx.object_lifetime_default(..)` / `generics_of(..)` values are cast (`unknown` in queries.gen.ts);
  `preds.sort_by_key(lo_hi)` + `dedup_by_key(lo_hi)` as a stable sort + adjacent dedup; `assert_matches!` is
  `assert(.., "assertion `left matches right` failed ...")`.
- opaque_types.ts: `TypeVisitor_of_FindOpaqueRegion(self)` / `TypeVisitor_of_CheckExplicitRegionMentionAndCollectGenerics(self)`
  build the `TypeVisitor` object over the generated data interfaces (impl table + provided methods; not upstream fns);
  `d_Clause_Span`, `d_OpaqueTypeKey` descriptors; `explicit_item_bounds` value cast to `EarlyBinder<[Clause, Span][]>`;
  the `Option<(Span, Ty, OpaqueTypeKey)>` comparison is field-wise (interned `Ty` / `GenericArgs` by identity);
  `FxIndexSet<DefId>` fields hold `DefIdSet`s (insertion-ordered, keyed by `DefId_key`).
- outlives_suggestion.ts: `BTreeMap<RegionVid, Vec<RegionVid>>` iterated in key order (sorted copy of the `Map`).

## Shared files edited
`src/rustc_borrowck/contract.test.ts` (count tests only: markers / stubs totals and the split-table row).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (21306; vendor 4330).
- `bun test src/rustc_borrowck`: 17 pass, 1 fail (the known runtime-stop pin, see above). The fresh-entry init-order
  test passes for all 62 hand modules.
- Full unit suite: 6118 pass / 1 skip / 19 fail, all stop pins (see "Full unit run").

## Samples (`RUST_TS_AGENT=root-f5de`, compared case by case with the base runs named in w24-common.txt)
| suite | lane run | M / D / U / C / T / UNSTABLE | base run | M / D / U / C / T / UNSTABLE |
|---|---|---|---|---|
| tydump-minicore (46) | `20261027-224924-root-f5de-ngky` | 46 / 0 / 0 / 0 / 0 / 0 | `20261022-210451-root-f5de-wos5` | 45 / 0 / 1 / 0 / 0 / 0 |
| mirdump-minicore (46) | `20261027-225027-root-f5de-kyv8` | 45 / 0 / 1 / 0 / 0 / 0 | `20261022-210534-root-f5de-p8q4` | 45 / 0 / 1 / 0 / 0 / 0 |
| tydump-ui `--sample 300` | `20261027-225208-root-f5de-aev0` | 262 / 0 / 36 / 0 / 0 / 2 | `20261022-210624-root-f5de-zjq3` | 261 / 0 / 37 / 0 / 0 / 2 |
| mirdump-ui `--sample 300` | `20261027-235517-root-f5de-7pt1` (+ 10 re-runs alone) | **273** / 0 / 27 / 0 / 0 / 0 | `20261022-211125-root-f5de-mzgb` | 269 / 0 / 31 / 0 / 0 / 0 |
| borrowck-ui `--sample 300` | `20261028-002355-root-f5de-1yn9` | 0 / 0 / 300 / 0 / 0 / 0 | `20261022-211729-root-f5de-86qn` | 0 / 0 / 300 / 0 / 0 / 0 |

**No MATCH lost, no new DIFF / CRASH.** The machine ran at load average 200-350 (other lanes). The first
mirdump-ui / borrowck-ui runs (`20261027-230457-root-f5de-r5zu`: 132 TIMEOUT, `20261027-232817-root-f5de-9zdo`:
188 TIMEOUT) were re-run with `--jobs 4` (runs above); the 10 cases that still timed out in mirdump-ui
(`borrowck-anon-fields-variant`, `borrowck-borrow-from-stack-variable`, `borrowck-borrowed-uniq-rvalue`, `mir/issue-29227`,
`mir_codegen_critical_edge`, `mir_codegen_ssa`, `mir_codegen_switch`, `mir_coercions`, `mir_constval_adts`,
`mir_refs_correct`) were each re-run alone (`--filter <id> --jobs 1`): all 10 **MATCH**. So the mirdump-ui sample is
273 MATCH / 27 UNPORTED.
- Gains (tydump-minicore `mini_core_hello_world.rs`, tydump-ui `enum-discriminant/wrapping_niche.rs`, mirdump-ui
  `mir/enum/option_with_bigger_niche_break.rs`, `mir/issue-76248.rs`, `mir/mir-inlining/ice-issue-77564.rs`,
  `mir/mir_refs_correct.rs`) are the same ones fix-w23-ctfe reported (they come from the base, not this lane).
- Stops: base runs predate wave 23's merge (`replace_regions_in_mir`, `eval_in_interpreter`); here every borrowck
  stop is `OutlivesConstraintSet::push` / `reverse_graph` (bck-regions-b): borrowck-ui 230 `push`, 53 `reverse_graph`,
  12 `polonius_engine::AllFacts::default` (wave 26), 5 metadata `Decodable for mir::Body`; mirdump-ui 15 / 7;
  tydump-ui 14 / 13. No case stops at `UniverseInfo::relate` or anywhere in this lane's files.

## Full unit run
`RUST_TS_AGENT=bck-diag-f bun test src --timeout=120000` (once, at the end): **6118 pass, 1 skip, 19 fail**
(6138 tests, 446 files). All 19 are stop pins from the known-failure list in w24-common.txt (none in this lane's
code); this lane moved some of them further:
- `rustc_symbol_mangling/symbol_names.oracle.test.ts` (4: `const-generics-structural-demangling.rs`,
  `const-generics.rs#legacy`, `#v0`, `impl2.rs`): pinned `UniverseInfo::relate` (fix-w23-ctfe's `STOP_CONST_EVAL`),
  now **`rustc_borrowck::constraints::OutlivesConstraintSet::reverse_graph`**.
- `rustc_hir_analysis/check/compare_impl_item.oracle.test.ts` (11, pinned `BorrowSet::build`): 10 now
  `OutlivesConstraintSet::reverse_graph`, 1 `OutlivesConstraintSet::push`.
- `rustc_hir_analysis/collect_test/misc` (`type_of STOP`, pinned `BorrowSet::build`): now `reverse_graph`.
- `rustc_lint/late_e2.oracle.test.ts` (TAIT case, pinned `BorrowSet::build`): now `reverse_graph`;
  `rustc_lint/late_c.oracle.test.ts` (blocked `impl_trait_overcaptures` case): its boolean stop check fails the same
  way as at the base (the body still stops in borrowck, now at `OutlivesConstraintSet::*`).
- `rustc_borrowck/contract.test.ts` runtime-stop test: now `reverse_graph` (above).
The other base known failures (place_operand, interp contract, operator_cast, 3 of the symbol-names ones) were
already fixed at the base (fix-w23-ctfe). Root / fix-w23-bck re-pin; I did not edit any pin.
