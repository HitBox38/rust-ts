# Handoff: errrep-sugg-c (wave 19, error reporting): suggestions.rs:5018..7379

Branch `lane/errrep-sugg-c` (from integ `52b5e37d`, no merges). Commits:
- `7cb461bc` port of suggestions.rs:5018..7379 (previous agent, cut off by a usage limit).
- `65c1a1ef` review fixes + oracle test (resumed agent).
- this handoff.

## Files touched
- `src/rustc_trait_selection/error_reporting/traits/suggestions.ts` (only the errrep-sugg-c region: the lane's import block
  after `// ---- imports of lane errrep-sugg-c ----`, the section from `// lane errrep-sugg-c` to the end of the file; the
  lane-a / lane-b `unported_methods` lists are untouched; this lane's list is gone, all its names are ported).
- `src/rustc_trait_selection/error_reporting/traits/suggestions_c.oracle.test.ts` (new).

## What is ported (37 fns, upstream order, markers checked)
- `impl TypeErrCtxt` (continued) 22 methods: `suggest_await_before_try`, `suggest_floating_point_literal`,
  `can_suggest_derive`, `suggest_derive`, `suggest_dereferencing_index`, `note_function_argument_obligation`,
  `suggest_option_method_if_applicable`, `look_for_iterator_item_mistakes`, `point_at_chain`, `probe_assoc_types_at_expr`,
  `point_at_chain_in_return_position`, `suggest_convert_to_slice`, `suggest_tuple_wrapping`,
  `suggest_shadowed_inherent_method`, `explain_hrtb_projection`, `suggest_desugaring_async_fn_in_trait`,
  `ty_kind_suggestion`, `suggest_add_result_as_return_type` (+ nested `choose_suggest_items`),
  `suggest_unsized_bound_if_applicable`, `suggest_indirection_for_unsized`, `suggest_swapping_lhs_and_rhs`,
  `is_truly_imperfect_derive`.
- Free fns: `hint_missing_borrow`, `get_explanation_based_on_obligation`,
  `suggest_desugaring_async_fn_to_impl_future_in_trait`, `point_at_assoc_type_restriction`, `get_deref_type_and_refs`.
- `trait NextTypeParamName` + its impl for `&[hir::GenericParam]` (free fn `next_type_param_name` + companion).
- Hand types replacing the stub aliases: `ReplaceImplTraitVisitor` (hir Visitor), `ReplaceImplTraitFolder` (TypeFolder),
  `FindTypeParam` (hir Visitor), `ParamFinder` (TypeVisitor + `can_suggest_bound`).
- The three visitors at 6875.. (`SelfVisitor`, `ReturnsVisitor`, `AwaitsVisitor`) were already ported by errctxt-contract.

## Review (resumed agent)
Function-by-function comparison of the whole region against upstream (arm order, guards, strings, spans, Applicability,
laziness, DefId/HirId equality). Fixes:
1. `suggest_shadowed_inherent_method`: `autoderef.iter().filter_map(..)` is lazy; the filter (`predicate_may_hold`) now
   runs interleaved with the loop body via a generator (was an eager pre-pass).
2. `next_type_param_name`: `char::to_uppercase` now uses `src/std/char.ts` `to_uppercase` (oracle Unicode tables) instead
   of JS `toUpperCase`.
No other divergences found.

## Coverage
- `bun scripts/coverage.ts --missing .../traits/suggestions.rs`: 41/80 (base 4/80); the 39 missing are all < 5018
  (lanes errrep-sugg-a / -b). rustc_trait_selection 634/976. TOTAL 15941/25518.
- `bun scripts/coverage.ts --check`: markers ok (16460; vendor 3888).

## Tests
- `bunx tsc --noEmit -p .`: clean.
- New `suggestions_c.oracle.test.ts` (3 cases, tydump probe vs `src/rust_ts/tydump.ts`, stdout/stderr/exit identical):
  `ret_prims`, `ret_items` (E0069 `return;` → `ty_kind_suggestion`, every arm incl. diagnostic items, `Box`, `Default`,
  arrays 0/1/Copy/non-Copy, 1-tuple, `&str`, `&mut`), `missing_consts` (E0046 → `ty_kind_suggestion`). The rest of the
  region is reached only from `report_selection_error` / `note_obligation_cause_code` (errrep-traits-a/-b, errrep-sugg-b),
  not ported yet, so it has no end-to-end test here.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_trait_selection`: 69 pass, 0 fail (incl. `errctxt_contract.test.ts`).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_hir_analysis src/rustc_hir_typeck`: 356 pass, 0 fail.

## Samples (lane vs base; base = integ `52b5e37d`, `RUST_TS_AGENT=errrep-sugg-c-base`)
| suite | lane run | M / D / U | base run | M / D / U |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-081850-errrep-sugg-c-e0qd` | 21 / 0 / 25 | `20261021-081115-errrep-sugg-c-base-g5f0` | 21 / 0 / 25 |
| thirdump-minicore (46) | `20261021-081905-errrep-sugg-c-d1af` | 21 / 0 / 25 | `20261021-081140-errrep-sugg-c-base-xbv6` | 21 / 0 / 25 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-081917-errrep-sugg-c-khf6` | 289 / 0 / 11 | `20261021-081208-errrep-sugg-c-base-ewgg` | 289 / 0 / 11 |

Per-case status and UNPORTED stop identical in all three (no new DIFF, no moved stop).

## `unported(...)` left
- None in this region. Paths that stop elsewhere: `look_for_iterator_item_mistakes` → `suggest_restriction` (lane
  errrep-sugg-a stub); `hint_missing_borrow` → diagnostics.ts `AdjustSignatureBorrow_subdiagnostic` (lane errrep-infer-b
  stub); methods of other lanes called through the contract.

## `// PORT:` decisions
- `suggest_shadowed_inherent_method`: lazy `filter_map` as a generator.
- `NextTypeParamName`: the trait's only impl is for `&[hir::GenericParam]`; interface + free fn
  `next_type_param_name(self_, name)` + companion const.
- `ReplaceImplTraitVisitor.ty_spans: &mut Vec<Span>` is the caller's array (mutated in place).
- `FindTypeParam` / `ParamFinder` default field values (`= Vec::new()`, `= false`) are constructor defaults.
- `d_TraitClausePrintModifiersAndPath`: hand-written `TypeFoldable` derive (struct is hand-written in pretty.ts).
- Lane helpers at the end of the file: `display_PolyTraitClause` / `display_Binder_TraitClausePrintModifiersAndPath`
  (ir_print.rs:89 `Display for Binder` through `IrPrint`, same form as rustc_middle ty/diagnostics.ts), `d_*` TypeFoldable
  descriptors, `upcast_*` `Upcast<TyCtxt, Predicate>` descriptors, lazy `traits_mod()` / `engine_mod()` /
  `diagnostics_mod()` requires (init order).

## For root
1. Stand-ins outside this lane's files can now call the port: rustc_hir_analysis `collect.ts:176` and
   `hir_ty_lowering/dyn_trait.ts:867` still `unported("...NextTypeParamName::next_type_param_name")`; replace with
   `next_type_param_name(params, name)` from `rustc_trait_selection/error_reporting/traits/suggestions.ts` (owner lanes).
2. Merge note: lanes errrep-sugg-a/-b edit the same file; this lane kept to its own import block and region, and deleted
   only its own `unported_methods` list, its 5 free-fn stubs and its 4 `export type X = unknown` aliases. One shared
   header line changed: the `rustc_span/symbol.ts` import now reads `{ debug_Symbol, display_Ident, display_Symbol, Ident,
   kw, sym, Symbol }` (union it with the other lanes' version on merge).
