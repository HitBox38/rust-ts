# Handoff: errrep-infer-a (wave 19, error reporting): error_reporting/infer/mod.rs (rest)

Branch `lane/errrep-infer-a` (from integ `52b5e37d`, no merges). Resumed lane: the first session ported the whole file but
was cut off before committing. This session reviewed that work against upstream function by function, fixed what it found,
re-pinned two tests and ran the checks.
Commits: `35428b80` port (first session's work, committed unchanged) → review fixes + re-pins → this handoff.

## Files touched
- `src/rustc_trait_selection/error_reporting/infer/mod.ts`: all 50 remaining fns (the 3 `ObligationCauseExt` fns were
  ported by errctxt-contract): `escape_literal`, `normalize_fn_sig`, `type_error_struct_with_diag`,
  `report_mismatched_types` / `_consts`, `check_and_note_conflicting_crates`, `suggest_param_env_shadowing`,
  `note_error_origin`, `should_deref_suggestion_on_mismatch`, `highlight_outer`, `cmp_type_arg`, `push_comma`, `cmp_fn_sig`,
  `cmp_traits`, `lifetime_display`, `compare_generics`, `recurse`, `maybe_highlight`, `cmp` (+ nested `fmt_region`,
  `push_ref`, `cmp_ty_refs`), `note_type_err` (+ local `OpaqueTypesVisitor` with `visit_expected_found` / `report` /
  `add_labels_for_types` / `visit_ty`, local `Mismatch` / `Similar` enums), `type_error_additional_suggestions`,
  `suggest_specify_actual_length` (+ `LetVisitor::visit_stmt`), `check_on_type_error_attribute`,
  `format_on_type_error_notes`, `report_and_explain_type_error`, `simplify_pin_macro_arg_ty_mismatch`,
  `suggest_wrap_to_build_a_tuple`, `values_str`, `expected_found_str_term`, `expected_found_str`, `is_try_conversion`,
  `same_type_modulo_infer`, `SameTypeModuloInfer` (class + 6 `TypeRelation` methods), `ObligationCauseAsDiagArg::into_diag_arg`,
  `Display for TyCategory`, `TyCategory::from_ty`. The lane's `unported_methods` list is gone (empty).
- Re-pinned tests (outside the assigned file; no assertion weakened, each now pins the exact new stop):
  `src/rustc_hir_analysis/check/entry.test.ts` (args_main.rs E0580) and `compare_impl_item.oracle.test.ts` (in process
  e0053_sig, e0326): `infer::TypeErrCtxt::note_type_err` → `traits::suggestions::TypeErrCtxt::note_field_shadowed_by_private_candidate_in_cause`.

## Review fixes (this session)
- The first session had added a non-upstream method `fn_sig_instantiate` to `TypeErrCtxt` (a `declare module` augmenting
  decls.ts plus a prototype assignment). It is now a module-local function, so the contract only declares upstream methods.
- Removed an unused `unported` import (it had been kept alive with a `void unported;` line).
- Everything else matched upstream: arm order, guards, labels/notes text, `common_default_params` counting every equal
  pair (not a prefix, as `filter().count()` does), `take_while` on the `::` split, byte-index `split_at`, `FormatArgs`
  default field values (`this_resolved`/`this_path`/`unresolved`/`item_context` = "", from rustc_attr_ir diagnostic.rs:213).

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs`: **53/53 ported**.
- rustc_trait_selection 647/976 (was 597); TOTAL 15954/25518. `coverage.ts --check`: markers ok (16473; vendor 3888).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_trait_selection`: 66 pass (incl. `errctxt_contract.test.ts`).
- `bun test src/rustc_hir_analysis src/rustc_hir_typeck src/rustc_infer`: 472 pass after the two re-pins (they were the only 3
  failures before).

## Samples (lane vs base; base = integ `52b5e37d`, `RUST_TS_AGENT=errrep-infer-a-base`)
| suite | lane run | M / D / U | base run | M / D / U |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-080931-errrep-infer-a-0xl6` | 21 / 0 / 25 | `20261021-081230-errrep-infer-a-base-ntgd` | 21 / 0 / 25 |
| thirdump-minicore (46) | `20261021-081007-errrep-infer-a-y35f` | 21 / 0 / 25 | `20261021-081307-errrep-infer-a-base-slgb` | 21 / 0 / 25 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-081016-errrep-infer-a-jgzk` | 289 / 0 / 11 | `20261021-081352-errrep-infer-a-base-7q7v` | 289 / 0 / 11 |

No new DIFF. Statuses are identical. The only change: the 12 `start_lang_item_args.rs` revisions (both minicore suites) now
stop later, at `traits::suggestions::TypeErrCtxt::note_field_shadowed_by_private_candidate_in_cause` (lane errrep-sugg-a),
which `note_type_err` calls (mod.rs:1683). tydump-nocore: same stops as base.

**Validation experiment (not committed):** with both downstream placeholders temporarily turned into no-ops
(`note_field_shadowed_by_private_candidate_in_cause`, then `note_and_explain_type_err`), the 12 cases went to **11 MATCH /
1 DIFF** (run `20261021-083108-errrep-infer-a-exp-mwpu`). The one DIFF, `#main_ret`, is missing only the `expected this type
parameter` label, which `note_and_explain_type_err` adds (infer/note_and_explain.rs, lane errrep-infer-b). Once errrep-sugg-a
and errrep-infer-b land, all 12 should match. (Doing nothing is faithful for the first callee in these cases: hir_analysis's
`err_ctxt` has no `typeck_results`, so `note_field_shadowed_by_private_candidate` returns at once.)

## `unported(...)` left
- None in this file. Callees that are still placeholders in other lanes' modules: `note_field_shadowed_by_private_candidate_in_cause`,
  `suggest_let_for_letchains`, `suggest_remove_semi_or_return_binding`, `suggest_tuple_pattern`,
  `suggest_accessing_field_where_appropriate`, `suggest_await_on_expect_found`, `suggest_function_pointers`,
  `suggest_turning_stmt_into_expr`, `suggest_for_all_lifetime_closure`, `note_and_explain_type_err`,
  `check_same_definition_different_crate`, and `compute_applicable_impls_for_diagnostics` (ambiguity.rs).

## `// PORT:` decisions
1. `(DiagStyledString, DiagStyledString)` is a tuple `[a, b]`; `values.0.0.extend(x.0)` is `values[0]._0.push(...x._0)`;
   derived `PartialEq` on `DiagStyledString` is the local `DiagStyledString_eq`; on `AliasTy` it is `AliasTy_eq`.
2. `into_sorted_stable_ord()` on `String`s sorts by UTF-8 byte order (`cmp_str_bytes`).
3. `split_at(split_idx)` in `cmp` splits the UTF-8 bytes (`split_idx` is a byte count of whole `::` components).
4. `tcx.fn_sig(did).instantiate(..).skip_norm_wip()` is the module-local `fn_sig_instantiate` (the query value is typed
   `unknown` in queries.gen.ts; it is cast to `EarlyBinder<PolyFnSig>`).
5. `OpaqueTypesVisitor`'s `FxIndexMap<TyCategory, FxIndexSet<Span>>` is `KeyedMap<TyCategory, Set<Span>>` keyed by
   `intern_key` (insertion order kept).
6. `find_attr!(.., OnTypeError { directive, .. } => directive)` is `Option<Option<&Directive>>`: outer `Some` is
   `{ $: "Some", _0 }` (local `find_on_type_error`).
7. Generic bounds follow the decls.ts signatures: `maybe_highlight` takes `to_string_T`; `expected_found_str` takes
   `display_T` + `d_T`; `same_type_modulo_infer` takes `d_T: Relate<T>`.
8. `Display for TyCategory` takes `alternate` (the `{:#}` flag), passed on to `CoroutineKind`'s Display.
9. Local `TypeFoldable` descriptor objects (top of the file) for `PolyFnSig`, `ValuePairs`, `ExpectedFound<T>`, `TraitRef`,
   `TraitRefPrintSugared`, `AliasTerm`, `ExistentialTraitRef`/`Projection`, plus `display_Binder_with` / `display_PolyFnSig`
   (rustc_middle's `IrPrint` Display for `Binder<T>`). These are D4 glue with no upstream counterpart.

## For root
1. Review the two re-pinned tests in rustc_hir_analysis (they sit outside this lane's file; precedent: errctxt-contract).
2. Stop chain for the 12 minicore cases: errrep-sugg-a (`note_field_shadowed_by_private_candidate_in_cause`) and then
   errrep-infer-b (`note_and_explain_type_err`). With both landed the experiment says 12/12 MATCH.
3. Possible shared helpers for later: `display_Binder_with` / `display_PolyFnSig` and the `TypeFoldable` descriptors here
   are local. Several error_reporting lanes will need the same Display/fold glue, so rustc_middle / rustc_type_ir could
   export them.
