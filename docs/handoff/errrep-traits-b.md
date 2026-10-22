# Handoff: errrep-traits-b (M3 wave 19, error reporting)

Branch `lane/errrep-traits-b` (from integ `52b5e37d`, no merges). Assignment: row 6 of the split table in
`docs/handoff/errctxt-contract.md`, `error_reporting/traits/fulfillment_errors.rs:1530..4136`.

The lane was resumed after the first agent was cut off before committing. Its uncommitted port was reviewed against upstream
(one independent read-only reviewer covered all of 1530..4136; it found no behaviour bugs) and committed as-is. One nit was
then fixed: unit variants of `GetSafeTransmuteErrorAndReason` now use the generated singletons.

## Files touched
- `src/rustc_trait_selection/error_reporting/traits/fulfillment_errors.ts` only. The code is in the
  `// ==== lane errrep-traits-b ====` block after lane errrep-traits-a's `unported_methods` list, in upstream order. Lane
  b's `unported_methods` list is deleted because it is empty now. Lane b's imports also live in its block, separate from
  lane a's. Expect a textual merge conflict only if lane a puts its imports in the same place.

## Coverage
- `bun scripts/coverage.ts --missing .../fulfillment_errors.rs` reports 44/54. The 10 missing fns are all lane
  errrep-traits-a's (lines 63..1427). Every fn of 1530..4136 is ported, including the nested `type_category` (2004) and
  `ParamToVarFolder` (3020/3026/3033).
- rustc_trait_selection 641/976. TOTAL 15948/25518. `coverage.ts --check`: markers ok.

## Checks
- `bunx tsc --noEmit -p .` is clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_trait_selection`: 66 pass, 0 fail. `errctxt_contract.test.ts` is green.
- `bun test src/rustc_hir_typeck src/rustc_infer src/rustc_hir_analysis`: 472 pass, 0 fail.

## Samples (lane vs base; base = a detached worktree at `52b5e37d`, `RUST_TS_AGENT=errrep-traits-b-base`)
| suite | lane run | M / D / U | base run | M / D / U |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-082004-errrep-traits-b-k91d` | 21 / 0 / 25 | `20261021-082002-errrep-traits-b-base-7wie` | 21 / 0 / 25 |
| thirdump-minicore (46) | `20261021-082043-errrep-traits-b-gt3u` | 21 / 0 / 25 | `20261021-082038-errrep-traits-b-base-w9px` | 21 / 0 / 25 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-082116-errrep-traits-b-etfi` | 289 / 0 / 11 | `20261021-082113-errrep-traits-b-base-zogc` | 289 / 0 / 11 |

Per-case statuses and stops are identical to base, and there is no new DIFF. As the split table predicted, no sample case
reaches this region yet. Its entry points are lane a's `report_fulfillment_errors` / `report_selection_error`, plus
hir_typeck closure.ts's `get_fn_like_arguments` / `report_arg_count_mismatch`.

## `unported(...)` left
- `rustc_transmute::Assume::from_const` and `rustc_transmute::TransmuteTypeEnv::is_transmutable` (2 calls each) are in
  `select_transmute_obligation_for_reporting` and `get_safe_transmute_error_and_reason`. rustc_transmute has no lane yet.
  Local structural stand-ins `TransmuteAssume` / `TransmuteReason` / `TransmuteAnswer` follow the
  traits/select/confirmation.ts precedent.
- `rustc_trait_selection::error_reporting::infer::TyCategory::from_ty` is a local stand-in `TyCategory_from_ty` used by
  `get_parent_trait_ref`. The real fn is error_reporting/infer/mod.rs:2738, lane errrep-infer-a.

## `// PORT:` decisions
- `error_implies`: `Goal`'s derived `PartialEq` compares the interned `ParamEnv` / `Predicate` by identity.
- Nested `fn type_category` (in `fuzzy_match_tys`) and `struct ParamToVarFolder` (in `predicate_can_apply`) are moved to
  module level, just above their parent fn, with upstream-line markers.
- Lazy iterator chains (`find_similar_impl_candidates`) are evaluated one element at a time, which keeps the same
  side-effect order.
- `(a, b).references_error()` is evaluated as both elements' visits.
- `usize::MAX` becomes `Number.MAX_SAFE_INTEGER` and `u64::MAX` becomes `Infinity`. Both are only compared.
- `sort_by_key` with tuple keys uses a lexicographic comparator. String comparison uses `str_cmp`, which is byte order.
- `<[T]>::sort_by` / `sort_by_key` use a local `sort_by_stable`:
  - For len <= 20 it is Rust's exact insertion sort (`insertion_sort_shift_left`). That is the only path that is exact for
    non-total comparators such as `report_similar_impl_candidates`' tuple-arity comparator, which returns `Equal` for
    non-tuples.
  - For len > 20 it falls back to JS's stable sort. That is exact for total orders but may differ from driftsort for that
    one comparator. Root may want a shared port of core's stable sort.
- `UnordSet<(DefId, String)>` (`check_same_name_different_path`) is an array of distinct pairs.
- The `TypeFoldable` descriptors for `Binder<TraitClausePrintWithBoundConstness>` / `Binder<TraitClausePrintModifiersAndPath>`
  are local, because pretty.ts has no derive for these wrappers yet.

## For root
1. When errrep-infer-a lands, point `get_parent_trait_ref` at the real `TyCategory::from_ty` and delete the local stand-in.
2. Consider porting core's driftsort to src/std (see the sort decision above). This lane's helpers could then be replaced.
3. Possible follow-up for rustc_middle pretty.ts: TypeFoldable derives for `TraitClausePrintWithBoundConstness` /
   `TraitClausePrintModifiersAndPath`, so the local descriptors can go.
