# Handoff: lane gaps-30c (wave 30, M4 tail: the long tail of unported stops)

Branch `lane/gaps-30c` from main `b30bd34b`. Every listed stop is resolved. Each case was checked with
`difftest --filter` (`RUST_TS_AGENT=root-f5de`) in every suite whose gate jsonl (gate-20261029-001428-root-june) showed it.

## Results per stop (cases now MATCH)

| # | stop | fix | cases |
|---|---|---|---|
| 1 | `NumScalableVectors::for_non_tuple` / `from_field_count` | `rustc_middle/ty/sty.ts` stand-ins replaced by the rustc_abi port | mir 11/11 (tests/ui/scalable-vectors: 27/27) |
| 2 | `mir::Const::from_bits` | `ty/util.ts` `numeric_{max,min}_val` call the ported `mir::Const::from_bits` (lazy require); they return `mir::Const` as upstream (decls.ts) | mir 4/4, mirdump-ui 3/3 |
| 3 | `get_diagnostic_name` (extern crates) | `rustc_resolve/late/diagnostics.ts` `suggest_named_format_argument` calls `tcx.get_diagnostic_name` (the metadata side was already ported) | 5 cases × mir, expanded, hir-tree, resdump, unpretty-expanded, unpretty-hir = 30 |
| 4 | QueryKey `(ValidityRequirement, PseudoCanonicalInput<Ty>)` | `KEY_ValidityRequirement_PseudoCanonicalInput_Ty` (query/keys.ts) + queries.config.json, queries.gen.ts regenerated | mir 4/4 |
| 5 | `extract_component_with_significant_dtor` | `rustc_lint/if_let_rescope.ts` uses the ported significant_drop_order fns (`ty_dtor_span` too) | mir 4/4 |
| 6 | `deeply_resolve_via_region_graph` Debug of T | optional `debug_T` parameter (infer/mod.ts, decls.ts); passed by all 4 callers (compare_impl_item, refine, min_specialization, traits/mod.ts) | mir 2/2; borrowck-ui-report's case now stops at `EarlyBinder::skip_binder` (lane tyir-binder) |
| 7 | `probe_op::{MissingTypeAnnot, MethodCallOnDivergingInferenceVariable}` | hand-written inside `probe_op` exactly as the generated derives look (`_into_diag` / `_diagnostic`) | mir 6/6 |
| 8 | `tcx.hir_attrs(..)` in the resolver | `rustc_resolve/lib.ts` `DefId_get_attrs` = `HasAttrs_DefId.get_attrs`; a local id asks `hir_attrs`, the query cycle these 3 tests expect | 3 cases × the 6 suites of #3 = 18 |
| 9a | TypeVisitable/TypeFoldable | `ty::{PolyTypeOutlivesClause, RegionOutlivesClause, AliasTerm, PolyExistentialTraitRef, PolyExistentialProjection}` fold fns in ty/predicate.ts + type_fold.json (wfcheck `WithWhereClauses`, infer `ValuePairs`); `Display for Binder<TypeOutlivesClause>` (ty/print/pretty.ts `display_PolyTypeOutlivesClause`, replacing wfcheck's stand-in) | mir 4/4, thir-tree 1/1 |
| 9b | Debug | `I::LocalDefIds` (tyir.typemap.json: `debug_RawList(.., debug_LocalDefId)`, TypingMode) and `ty::RegionConstraint` (infer.typemap.json: its derive_where Debug, QueryRegionConstraint) | mir 2/2, thir-tree 1/1 |
| 9c | StableHash | autodiff `DiffMode` / `DiffActivity` derived in set rustc_ast (types.sets.json `stable_hash_types`) + stable_hash.json entries (RustcAutodiff) | mir 1/1 |
| 10 | `ipnsort` | std/slice_sort.ts: ipnsort, unstable quicksort, `partition` + `inst_partition` + both partitions (lomuto branchless cyclic, hoare branchy cyclic), heapsort/sift_down, the unstable small-sorts (`UnstableSmallSortTypeImpl` / `...FreezeTypeImpl` specializations: network sort9/sort13 + swap_if_less, general, fallback), `has_efficient_in_place_swap` | mir 1/1 |
| 11 | `x86_win64::compute_abi_info` | ported (74 lines, new `rustc_target/callconv/x86_win64.ts`), wired in callconv/mod.ts | mir 1/1 |

In total 93 case×suite results go from UNPORTED to MATCH (mir 48, mirdump-ui 3, thir-tree 2, expanded/hir-tree/resdump/
unpretty-expanded/unpretty-hir 8 each). `std::panic::Location::caller` is left alone, as decided.

## Samples (RUST_TS_AGENT=root-f5de)

| | before | after |
|---|---|---|
| `difftest --suite mir --sample 300` | 290 MATCH, 0 DIFF, 8 UNPORTED, 2 UNSTABLE | 290 MATCH, 0 DIFF, 8 UNPORTED, 2 UNSTABLE |
| `difftest --suite tydump-ui --sample 300` | 297 MATCH, 0 DIFF, 1 UNPORTED, 2 UNSTABLE (15 skipped) | identical |

The sample contains none of this lane's cases. Its remaining stops all belong to other lanes (transmute, `Relate for
ty::Expr`, tyir-binder, `Const::Unevaluated`, inherent assoc types, IntoDiagArg). No MATCH was lost.

## Files touched

- rustc_middle: `ty/sty.ts`, `ty/util.ts`, `ty/decls.ts` (2 return types), `ty/predicate.ts`, `ty/print/pretty.ts`,
  `query/keys.ts`; generated `queries.gen.ts`, `infer/canonical.gen.ts`
- rustc_resolve: `lib.ts`, `late/diagnostics.ts`
- rustc_lint: `if_let_rescope.ts`, `builtin.ts` (LAYOUT_Span gains `copy: true`), `late_c.oracle.test.ts`
- rustc_infer: `decls.ts`, `infer/mod.ts`; generated `infer/mod.gen.ts`
- rustc_hir_analysis: `check/compare_impl_item.ts`, `check/compare_impl_item/refine.ts`,
  `impl_wf_check/min_specialization.ts`, `check/wfcheck.ts`; generated `check/wfcheck.gen.ts`
- rustc_trait_selection: `traits/mod.ts`; `error_reporting/traits/{mod,fulfillment_errors}.ts` (`copy: false` on
  their unstable-sort layouts)
- rustc_borrowck: `diagnostics/move_errors.ts` (`copy: false` on its layout)
- rustc_hir_typeck: `method/probe.ts`
- rustc_pattern_analysis: `rustc.ts` (cast removed, since `numeric_max_val` is now typed `mir::Const`), `rustc.test.ts`
- rustc_target: `callconv/x86_win64.ts` (new), `callconv/mod.ts`
- std: `slice_sort.ts`, `slice_sort.test.ts`
- generated: `rustc_type_ir/infer_ctxt.gen.ts`, `rustc_ast/stable_hash.gen.ts`, `rustc_attr_ir/stable_hash.gen.ts`
- tools/codegen: `queries.config.json`, `type_fold.json`, `tyir.typemap.json`, `infer.typemap.json`,
  `types.sets.json` (rustc_ast `stable_hash_types`), `stable_hash.json`

I touched none of the files the lane brief said to avoid. In `tools/codegen/queries.ts` (gaps-30b's file) I changed
only the config JSON and the regenerated queries.gen.ts, not the generator. If 30b also regenerates queries.gen.ts, the
merge conflict is in the one import line and the `check_validity_requirement` key. Rerunning
`bun tools/codegen/queries.ts` after merging both resolves it.

I regenerated all 59 types.ts sets afterwards: no other generated file changed (`queries.ts --check` is up to date).

## Tests / checks

- `bunx tsc --noEmit -p .` clean; `bun scripts/coverage.ts --check`: markers ok (22800; vendor 4483).
- `bun test` passed (0 fail) on src/rustc_ast, rustc_attr_ir, rustc_target, rustc_type_ir, std, tools/codegen,
  rustc_pattern_analysis, rustc_resolve, rustc_lint, rustc_middle, rustc_infer, rustc_hir_typeck/method,
  rustc_hir_analysis, rustc_trait_selection, rustc_borrowck, and all five "fresh entry point" init-order tests
  (rustc_mir_transform simplify/pass_manager, rustc_const_eval interpret, rustc_middle mir, rustc_borrowck).
- Moved pinned expectations (the brief allows this):
  - rustc_pattern_analysis `rustc.test.ts`: `usize_max_plus_one` now prints `usize::MAX.. (wildcard: false)` instead of
    the `from_bits` unported.
  - rustc_lint `late_c.oracle.test.ts`: "if_let_rescope fires" moved from BLOCKED to CASES, as its own error message
    says to do. It matches the oracle.
- `slice_sort.test.ts` now checks `sort_unstable_by` against the pinned std for 6 layouts × every length (up to 5000):
  Copy/Freeze 24/16/8 bytes, Freeze non-Copy `Box`, a 104-byte Copy element (Hoare partition, fallback small-sort),
  and non-Freeze `Cell`. Mutating the network, the partition choice, the swap heuristic or the heapsort fallback each
  makes the test fail.
- Coverage: callconv/x86_win64.rs 1/1; ty/util.rs 78/78; ty/predicate.rs 61/61; ty/significant_drop_order.rs 4/4;
  query/keys.rs 57/63 (the remaining keys are not in this lane).

## `unported(...)` left / added

- Added `core::slice::sort::shared::smallsort: \`T: Copy\` of the element type (SortLayout.copy) for sort_unstable`.
  It fires only when an unstable sort over more than 20 elements of a Freeze type gets a `SortLayout` without `copy`.
  The four unstable callers with fixed layouts set it. `SortedMap::from_iter` takes its layout from its callers (none
  call it today).
- Kept: `deeply_resolve_via_region_graph` without `debug_T` (all current callers pass one).
- Removed: every stop listed in the lane brief; the stand-in
  `rustc_middle::ty::print::pretty: Display for Binder<TypeOutlivesClause>`; `ty_dtor_span`'s stand-in in
  if_let_rescope.

## `// PORT:` decisions

- `deeply_resolve_via_region_graph(value, d_T, debug_T?)`: `T: Debug` is an explicit table, like the D4 descriptors.
- probe.ts: the two fn-local `#[derive(Diagnostic)]` structs are hand-written as the generator writes them (the
  typedefs probe does not see into fn bodies).
- ty/util.ts reads mir/consts.ts lazily (mir/ is in ty/context.ts's import closure). pretty.ts reads
  rustc_type_ir/predicate.gen.ts lazily: a static import broke rustc_borrowck's init-order test (`ImplPolarity` TDZ).
- query/keys.ts reads ty/layout.ts (`debug_ValidityRequirement`) lazily.
- slice_sort.ts: `SortLayout.copy` stands in for the `CopyMarker` specialization. In the Lomuto cyclic partition,
  `GAP_VALUE` (-1) marks `state.right` / `gap.pos` pointing at the saved gap value. `ancestor_pivot` and the
  partition `pivot` are passed by value (their slots are never moved while referenced). The `GapGuard` drop runs after
  the result is computed. The sort9/sort13 networks are tables, checked equal to upstream's call sequence.
- x86_win64.ts: the `match a.layout.backend_repr` is an if-chain in upstream arm order (`Memory { sized: false }`
  before `ScalarPair | Memory { sized: true }`).

## Notes for root

- Debugging aid used (not committed): a temporary stack print in `unported` plus a runner script
  (`$RUST_TS_DATA/tmp/w30/gaps-30c/runcase.ts <suite> <id-part>`) that runs one case's subject command directly. It
  might be worth a reviewed harness option (`--stack` for UNPORTED), since the "without a TS impl" stops name no type.
- Regenerating all 59 sets also wrote an untracked `src/rustc_lexer/lib.gen.ts`. That file is not tracked at base
  either, and none of my config changes touch rustc_lexer: some set targets it but its output is not committed. I
  deleted it; root may want to look into it.
