# Handoff: typeck-coerce (M3, wave 18b, rustc_hir_typeck)

Branch `lane/typeck-coerce` (from integ `a5910d3`, no merges).

## Result
- **coercion.rs: 49/49** fns ported, in upstream order: `Coerce` (deref, `new`, `unify_raw` .. `coerce_to_raw_ptr`), the
  free fns `coerce_mutbls` / `success` / `can_coerce` / `irrefutable_if_let_expr` / `simple_irrefutable_pattern`, the
  `impl FnCtxt` block (`coerce`, `may_coerce`, `may_coerce_except_never`, `deref_steps_for_suggestion`,
  `deref_once_mutably_for_diagnostic`, `sig_for_coerce_lub`, `sig_for_fn_def_coercion`, `sig_for_closure_coercion`,
  `try_find_coercion_lub`), `CoerceMany` (`new`, `with_capacity`, `expected_ty`, `merged_ty`, `coerce`,
  `coerce_forced_unit`, `coerce_inner` incl. its error branch, `suggest_boxing_tail_for_return_position_impl_trait`,
  `report_return_mismatched_types`, `is_return_ty_definitely_unsized`, `complete`), and the hand class `CoerceVisitor`
  (`impl ProofTreeVisitor`: `span`, `visit_goal`, `on_recursion_limit`).
- **demand.rs: 8/25**, exactly the lane's region 171..289: `demand_suptype`, `demand_suptype_diag`,
  `demand_suptype_with_origin`, `demand_eqtype`, `demand_eqtype_diag`, `demand_eqtype_with_origin`, `demand_coerce`,
  `demand_coerce_diag`. The other 17 stay `unported_methods` placeholders (wave 19).
- Verified end-to-end: `can_coerce` builds a real `TypeckRootCtxt` + `FnCtxt` and runs `Coerce::coerce` (next solver);
  18 cases agree with the pinned rustc (see Tests).

## Files touched
- `src/rustc_hir_typeck/coercion.ts` (filled; `CoerceVisitor` type alias replaced by the class)
- `src/rustc_hir_typeck/demand.ts` (8 methods filled; placeholder list reduced to the 17 wave-19 names)
- `src/rustc_hir_typeck/coercion.test.ts` (new)
- `docs/handoff/typeck-coerce.md` (this file)

Nothing outside these files; decls.ts, the .gen.ts files and other lanes' files are untouched.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/coercion.rs`: 49/49 ported.
- `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/demand.rs`: 8/25 (missing = wave 19: :20, :73,
  :112, :290, :323, :577, :658, :708, :856, :929, :953, :1126, :1159, :1165, :1179, :1197, :1250).
- `bun scripts/coverage.ts --check`: `markers ok (15220; vendor 3888)`. Crate: 133/1041.

## PORT decisions (please record)
1. `Coerce`'s own field `cause` shadows FnCtxt's method `cause(span, code)` (Coerce_shadowed), so upstream's
   `self.cause(self.cause.span, ..)` inside `Coerce` is `this.fcx.cause(this.cause.span, ..)`.
2. `CoerceVisitor`'s field `span` is `span_` (collides with the trait method `span()`; CoerceMany `expected_ty_`
   precedent). Its `type Result = ControlFlow<()>` is `VisitorResult.ControlFlow<null>()` (BestObligation precedent);
   the provided `config()` delegates to `ProofTreeVisitor_provided.config`.
3. Old solver (`coerce_unsized_old_solver`): `traits::SelectionContext::new(self)` is normalize.ts's
   `pending_SelectionContext_new(this.infcx)` viewed as a local `SelectionContextView` (`select(Obligation<Binder<
   TraitClause>>)`), effects.ts precedent. It stops as UNPORTED until selcx-contract lands; then replace the view and
   the call by the real class.
4. `TypeErrCtxt` is `Pending`: the error paths call `fcx.err_ctxt()` through local `TypeErrCtxtView`s
   (`report_selection_error`, `report_mismatched_types`, `ty_kind_suggestion`), coherence/builtin.ts precedent.
5. `Vec::with_capacity(capacity)` is `[]`; `prev_adjustment.clone()` is a spread copy of the plain-data `Adjust`;
   `adjustments.clone()` per expr is `[...adjustments]`.
6. `unreachable!` / `span_bug!` / `assert!` with `{:?}` / `{}` of a `Ty` are real panics with `debug_Ty(.., PLAIN)` /
   `display_Ty(..)` messages (check.ts precedent); the `coerce_to_ref` assert builds its message only on failure.
7. `Iterator::find_map` over `Autoderef` is a `next()` loop (coerce_to_ref keeps using the same autoderef afterwards
   for `step_count()` / `into_obligations()`); `.nth(1)` is two `next()` calls.

## PORT(decls) pending root
- `FnCtxt::adjust_expr_for_assert_eq_macro` (demand.rs:112, wave 19) takes `found_expr: &mut &hir::Expr` and
  `expected_expr: &mut Option<&hir::Expr>`; decls.ts declares it with plain values, so the out-parameters are lost.
  demand.ts adds a local overload `(found_expr: MutRef<hir.Expr>, expected_expr: MutRef<hir.Expr | undefined>)`
  (marked `// PORT(decls): pending root`) and `demand_coerce_diag` passes `MutRef` cells and reads them back.
  Root: change the real declaration to the `MutRef` form and drop the local overload.

## unported(...) left / stops reachable from this code
- Own: none (no `unported(` call in coercion.ts / demand.ts).
- Old solver: `coerce_unsized_old_solver` -> `pending_SelectionContext_new` (rustc_trait_selection, wave 20). Reached by
  every unsizing candidate under `-Znext-solver=coherence` (tydump-minicore / thirdump-minicore) once typeck runs.
- Error path (wave 19): `FnCtxt::err_ctxt` (every type mismatch: `demand_*_with_origin`, `demand_coerce_diag`,
  `coerce_inner`'s error branch, `report_return_mismatched_types`, the `report_selection_error` arm of
  `coerce_unsized_old_solver`), and the wave-19 FnCtxt methods called on error paths: `emit_coerce_suggestions`,
  `adjust_expr_for_assert_eq_macro` (demand.rs), `suggest_missing_semicolon`, `suggest_mismatched_types_on_tail`,
  `suggest_semicolon_at_end`, `suggest_missing_return_type`, `suggest_missing_break_or_return_expr`
  (fn_ctxt/suggestions.rs), and `get_fn_decl` (fn_ctxt/_impl.rs, typeck-impl). No success-path call into wave-19 code.
- Cross-lane (success path, placeholders until merge): `deeply_resolve_ignoring_regions_with_obligations`,
  `apply_adjustments`, `normalize`, `type_var_is_sized` (fn_ctxt/_impl.rs, lane typeck-impl).
- Seen in tests, other areas: unsizing to `dyn Trait` stops at `rustc_middle::ty::relate: Relate for
  &List<PolyExistentialPredicate>`; with the `&'b T: CoerceUnsized<&'a U>` impl present, `&mut u8 -> &u8` stops at
  `rustc_middle::mir::ConstraintCategory (mir, M4): BoringNoLocation` (region obligation of `'b: 'a`); array types
  (`[u8; 3]`) stop at `QueryKey for LitToConstInput` (known).

## Tests
- `src/rustc_hir_typeck/coercion.test.ts` (21 tests): one `#![no_core]` crate per case (own session, since an UNPORTED
  stop poisons in-flight queries), `can_coerce(tcx, param_env(body), body, A, B)` with `A`/`B` lowered by `ItemCtxt`
  (or `type_of` of a fn item). 18 cases give `true`/`false`: reborrows, `&&T -> &T` autoderef, `!`, raw-pointer
  mutability, `&mut T -> *const T`, fn pointer safety + leak check, fn items -> fn pointers (`sig_for_fn_def_coercion`,
  `At::normalize`, `ReifyFnPointer`), mismatches; 2 cases pinned at the stops above. One test runs the pinned rustc on
  `pub fn body(a: A) -> B { a }` for every case and checks it agrees (12 accepted, 8 E0308); skipped when the pinned
  toolchain is absent (`RUST_TS_REQUIRE_PROBES=1` makes that a failure). It ran here.
- `bun test src/rustc_hir_typeck --timeout=120000`: 33 pass / 0 fail (contract.test.ts 12 + coercion.test.ts 21).
- `bunx tsc --noEmit -p .`: clean.
- No pre-existing test pin moved.

## Samples
Base = a detached worktree at integ `a5910d3` (`RUST_TS_AGENT=typeck-coerce-base`), lane = this branch
(`RUST_TS_AGENT=typeck-coerce`), same `--seed typeck-coerce`. Per-case status and stop are identical (0 changes):
none of these cases reaches a coercion yet (typeck still stops at `loops::check` and earlier stops).

| suite | lane run | MATCH | DIFF | UNPORTED | CRASH | base run |
|---|---|---|---|---|---|---|
| tydump-nocore `--sample 100` | `20261015-083139-typeck-coerce-q2xs` | 75 | 0 | 25 | 0 | `20261015-083409-typeck-coerce-base-0yat`: 75/0/25/0 |
| tydump-minicore (46, full) | `20261015-083210-typeck-coerce-pafa` | 5 | 0 | 41 | 0 | `20261015-083427-typeck-coerce-base-ge2d`: 5/0/41/0 |
| hir-tree-nocore `--sample 100` | `20261015-083225-typeck-coerce-41zt` | 100 | 0 | 0 | 0 | `20261015-083436-typeck-coerce-base-4et5`: 100/0/0/0 |

Top stops (lane): tydump-nocore: `LateParamRegionKind::from_bound` 5, `QueryKey for (CanonicalImpliedOutlivesBoundsGoal,
bool)` 5, `check_unused_traits provider` 4, `IntegerExt::from_int_ty` 3, `erase_and_anonymize_regions` 2;
tydump-minicore: old solver `FulfillmentContext::new` 34, `check_unused_traits provider` 3, `StableHash without a TS
impl` 2.

## Cross-lane notes
- typeck-impl: `FnCtxt::coerce` needs `deeply_resolve_ignoring_regions_with_obligations` + `apply_adjustments`;
  `try_find_coercion_lub` needs `normalize`; the old-solver unsize path and `CoerceVisitor` need `type_var_is_sized`.
- selcx-contract: `coerce_unsized_old_solver` uses `SelectionContext::new(infcx)` and `select(&PolyTraitObligation)`
  (returns `SelectionResult<ImplSource<PredicateObligation>>`); swap the local view for the real class at merge.
