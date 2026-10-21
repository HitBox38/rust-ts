# Handoff: errrep-sugg-a (M3 wave 19, error reporting): suggestions.rs:1..2484

Branch `lane/errrep-sugg-a` (from integ `52b5e37d`, no merges). Commits: `efe1c550` (port), this handoff.
The lane was resumed after an API cut-off; the resumed session reviewed the committed port against upstream
(all 21 fns, function by function), found no fidelity issues, and ran the checks below.

## Files touched
- `src/rustc_trait_selection/error_reporting/traits/suggestions.ts` only (lane-a block + removal of lane-a's
  `unported_methods` list; lanes b / c lists untouched).

## Ported (suggestions.rs:1..2484, 21 fns, in upstream order)
`CoroutineData::{try_get_upvar_span, get_from_await_ty}` (declared by module augmentation of suggestions.gen.ts),
`predicate_constraint`, `suggest_restriction`, and the `impl TypeErrCtxt` methods
`note_field_shadowed_by_private_candidate_in_cause`, `note_field_shadowed_by_private_candidate`,
`suggest_restricting_param_bound`, `suggest_dereferences`, `get_closure_name`, `suggest_fn_call`,
`suggest_cast_to_fn_pointer`, `check_for_binding_assigned_block_without_tail_expression`, `suggest_add_clone_to_arg`,
`extract_callable_info`, `where_clause_expr_matches_failed_self_ty`, `suggest_add_reference_to_arg`,
`suggest_borrowing_for_object_cast`, `peel_expr_refs`, `suggest_remove_reference`, `suggest_remove_ref_from_param`,
`suggest_remove_await`.

## Coverage
- `bun scripts/coverage.ts --missing .../traits/suggestions.rs`: nothing missing in 1..2484; file 25/80 (was 4/80; the
  55 left are lanes errrep-sugg-b / -c).
- rustc_trait_selection 618/976 (was 597); TOTAL 15925/25518.

## `unported(...)` left (all stand-ins for lane errrep-sugg-c's items, `// PORT(merge)` block near the top)
- `next_type_param_name(params, name)`: `<&[hir::GenericParam] as NextTypeParamName>::next_type_param_name` (:6970).
- `new_ReplaceImplTraitFolder(tcx, param, replace_ty)`: `ReplaceImplTraitFolder` (:7068).
- `ReplaceImplTraitVisitor_visit_ty_unambig(ty_spans, param_did, ty)`: `ReplaceImplTraitVisitor` (:6997).
- `ParamFinderStandIn.can_suggest_bound`: `ParamFinder` (:7348); `visit_binder` only records the binder (the collected
  params are first observable in `can_suggest_bound`).
Reached by `suggest_restriction`'s `impl Trait` branch and `suggest_restricting_param_bound`'s two
`can_suggest_bound` arms (e.g. `Vec<T>: Trait`).

## `// PORT:` decisions
- Lane-a imports are a separate block (file split between three lanes). `FindExprBySpan` (./mod.ts) and
  `SelectionContext` (traits/select/mod.ts) are read lazily (`sugg_a_mod()`, `sugg_a_select()`): init order cycles.
- `print_PolyTraitClausePrintModifiersAndPath` / `display_...`: `Binder<TraitClausePrintModifiersAndPath>` is printed as
  the `Binder<TraitClause>` with the newtype's `Print` on the bound value (same value and fold; the newtype's
  `TypeFoldable` derive is not generated). Local `print_PolyTy` / `display_PolyTy` for `Binder<Ty>`.
- `try_get_upvar_span`: the `upvars_mentioned` query value is `unknown` in queries.gen.ts, cast to
  `Map<HirId, hir::Upvar>` (as rustc_hir_typeck expr_use_visitor.ts).
- `note_field_shadowed_by_private_candidate_in_cause`: `FxHashSet` iteration is insertion order here; the stable sort by
  `(file name, lo, hi)` only keeps that order for equal keys. `sort_by_cached_key` computes each key once.
- `Option::get_or_insert` builds its value eagerly (as upstream).
- `suggest_add_reference_to_arg`: `err.messages = ..` is `err.deref_mut().messages = ..`.
- `SelfVisitor` / `ReturnsVisitor` / `AwaitsVisitor` (errctxt-contract) unchanged.

## Samples (lane vs base; base = integ `52b5e37d`, `RUST_TS_AGENT=errrep-sugg-a-base`)
| suite | lane run | M / D / U | base run | M / D / U |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-081300-errrep-sugg-a-l0kb` | 21 / 0 / 25 | `20261021-081015-errrep-sugg-a-base-pvpl` | 21 / 0 / 25 |
| thirdump-minicore (46) | `20261021-081349-errrep-sugg-a-6nvt` | 21 / 0 / 25 | `20261021-081028-errrep-sugg-a-base-4zhm` | 21 / 0 / 25 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-081447-errrep-sugg-a-e0av` | 289 / 0 / 11 | `20261021-081043-errrep-sugg-a-base-fs8s` | 289 / 0 / 11 |

No new DIFF. Only stop moved: `tests/ui/lang-items/lang-item-generic-requirements.rs` (tydump and thirdump)
`note_field_shadowed_by_private_candidate` → `rustc_hir_typeck::method::suggest::FnCtxt::note_unmet_impls_on_type`
(lane typeck-suggest-a). tydump-nocore: identical statuses and stops.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (16444; vendor 3888).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_trait_selection --timeout=120000`: 66 pass, 0 fail (11 files, incl.
  errctxt_contract.test.ts).

## For root
1. **Merge with errrep-sugg-c**: replace the four `PORT(merge)` stand-ins (top of suggestions.ts) with lane c's real
   `NextTypeParamName::next_type_param_name`, `ReplaceImplTraitFolder`, `ReplaceImplTraitVisitor`, `ParamFinder`
   (call sites: `suggest_restriction`, `suggest_restricting_param_bound`), then delete the block.
2. **decls.ts bug** (`PORT(decls): pending root`): `src/rustc_trait_selection/decls.ts` does not import rustc_span's
   `Symbol`, so `get_closure_name(..): Symbol | undefined` (:861) and
   `point_at_methods_that_satisfy_associated_type(.., current_method_ident: Symbol | undefined, ..)` (:645) name the ES
   `Symbol`. Fix: `import type { Symbol } from "../rustc_span/symbol.ts"` in decls.ts; then drop the two
   `as unknown as` casts in suggestions.ts (`get_closure_name`, `suggest_fn_call`).
