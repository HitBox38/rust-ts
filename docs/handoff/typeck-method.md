# Handoff: typeck-method (M3 wave 18b, rustc_hir_typeck)

Branch `lane/typeck-method` (from integ `a5910d3`, no merges). Commits: `64d80ea` (method/mod.rs, confirm.rs, the two
prelude lints), `937f19e` (closure.rs), `48d2488` (unit tests), `d13640c` (unwrap / lazy assert message fixes).

## Result
- **method/mod.rs 9/9**: `method_exists_for_diagnostic`, `suggest_method_call`, `lookup_method`,
  `lookup_method_for_diagnostic`, `lookup_probe`, `lookup_probe_for_diagnostic`, `lookup_method_for_operator`,
  `resolve_fully_qualified_call`, `associated_value`.
- **method/confirm.rs 22/22**: `FnCtxt::{confirm_method, confirm_method_for_diagnostic}`, `ConfirmContext` (`deref` + the
  existing `register_deref`, `new`, `confirm`, `adjust_self_ty`, `create_ty_adjustments_from_pick`, `fresh_receiver_args`,
  `extract_existential_trait_ref`, `instantiate_method_args` with the local `GenericArgsCtxt` (3 `GenericArgsLowerer`
  methods), `unify_receivers`, `instantiate_method_sig`, `add_obligations`, `clauses_require_illegal_sized_bound`,
  `check_for_illegal_method_calls`, `lint_shadowed_supertrait_items`, `lint_ambiguously_glob_imported_traits`, `upcast`,
  `instantiate_binder_with_fresh_vars`).
- **closure.rs 17/17**: `check_expr_closure`, signature deduction (`deduce_closure_signature*`, `deduce_sig_from_projection`,
  `extract_sig_from_projection*`), `sig_of_closure*`, `merge_supplied_sig_with_expectation`, `supplied_sig_of_closure`,
  `deduce_future_output_from_*`, `error_sig_of_closure`, `closure_sigs`, and `MentionsTy::visit_ty` (local class).
- **method/prelude_edition_lints.rs 2/8**: `lint_edition_dependent_dot_call` (:156) and
  `lint_fully_qualified_call_from_2018` (:273). The other 6 (3 `impl Diagnostic`, `trait_path_or_bare_name`, `trait_path`,
  `adjust_expr`) are wave 19.

## Files touched
- `src/rustc_hir_typeck/method/mod.ts`, `method/confirm.ts`, `method/prelude_edition_lints.ts`, `closure.ts` (stubs filled).
- New: `src/rustc_hir_typeck/method_closure.test.ts` (9 tests, fake-`FnCtxt`-receiver style of pat_b.test.ts).
- Nothing outside my files; decls.ts and the generated files untouched.

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/<f>`)
| file | ported |
|---|---|
| method/mod.rs | 9/9 |
| method/confirm.rs | 22/22 |
| closure.rs | 17/17 |
| method/prelude_edition_lints.rs | 2/8 (missing: :28/:95/:293 `into_diag`, :416 `trait_path_or_bare_name`, :428 `trait_path`, :470 `adjust_expr`: wave 19) |

`bun scripts/coverage.ts --check`: `markers ok (15213; vendor 3888)`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_hir_typeck --timeout=60000`: 21 pass / 0 fail (contract.test.ts 12 + method_closure.test.ts 9).
- Trial merge of this branch into integ (`25388a5`-era HEAD, after callee-cast / checks-a / pat-a / pat-b / thir-pattern /
  small-gaps-18): no conflicts, tsc clean, `bun test src/rustc_hir_typeck` 58 pass / 0 fail, markers ok.

## Samples (no new DIFF; no stop changed)
Base = integ `a5910d3` (`RUST_TS_AGENT=typeck-method-base`), lane = `937f19e` (`RUST_TS_AGENT=typeck-method`), same seed.
Per-case comparison of status + `unported` stop: 0 changes in every suite.

| suite | lane run | MATCH | DIFF | UNPORTED | CRASH | base run (same counts) |
|---|---|---|---|---|---|---|
| tydump-minicore (46, full) | `20261015-082200-typeck-method-yffx` | 5 | 0 | 41 | 0 | `20261015-082415-typeck-method-base-hyad` |
| tydump-nocore `--sample 100 --seed typeck-method` | `20261015-082219-typeck-method-1wcp` | 79 | 0 | 21 | 0 | `20261015-082435-typeck-method-base-qls8` |
| hir-tree-nocore `--sample 100 --seed typeck-method` | `20261015-082303-typeck-method-q1ee` | 100 | 0 | 0 | 0 | `20261015-082504-typeck-method-base-4bxe` |

Also on the trial merge vs. integ alone: tydump-minicore 9/0/37/0 both (`...-merged-tdiz` vs `...-integ-h3qa`), tydump-nocore
85/0/15/0 both (`...-merged-d4n0` vs `...-integ-gjy1`), 0 per-case changes.

Top stops (lane runs): tydump-minicore `FulfillmentContext::new (old solver, wave 20)` 34, `check_unused_traits provider` 3,
`StableHash without a TS impl` 2; tydump-nocore `QueryKey for (CanonicalImpliedOutlivesBoundsGoal, bool)` 7,
`LateParamRegionKind::from_bound` 5, `IntegerExt::from_int_ty` 3. No sampled case reaches typeck bodies yet
(`loops::check` / `check_fn`, lane typeck-lib-wb), so none reaches method lookup or closures; the unit tests cover the
reachable logic with fake receivers.

## `unported(...)` left
- **confirm.rs:525 `instantiate_method_args`** (user type annotation of a method call whose method has own generics, i.e.
  `!args.is_empty() && !generics.is_own_empty()`): `unported("TypeFoldable for rustc_middle::ty::typeck_results::UserType
  (derive not generated)")`, the same codegen gap as gather_locals.ts `GatherLocalsVisitor::declare`. **This will be the
  first stop of every call of a generic method** once probing works.
- confirm.rs:568 `unify_receivers`, error path with `#![feature(arbitrary_self_types)]`: `this.err_ctxt()` (stops) then
  `unported("..TypeErrCtxt::report_mismatched_types")` (TypeErrCtxt is `Pending`, wave 19).
- closure.rs:714 `sig_of_closure_with_mismatched_number_of_arguments` (error path): stand-in
  `ArgKind_from_expected_ty` -> `unported("rustc_trait_selection::error_reporting::traits::ArgKind::from_expected_ty")`,
  then `err_ctxt()`, then `unported("..TypeErrCtxt::{get_fn_like_arguments, report_arg_count_mismatch}")`.
- prelude_edition_lints.rs: the three lint structs' `impl Diagnostic` are `diag_pending(..)` trait objects whose
  `into_diag` is `unported("..::<X as Diagnostic>::into_diag (wave 19)")`; reached only when the lint is not allowed at the
  node (`emit_lint_base` returns before `into_diag` for `Allow`). `RUST_2021/2024_PRELUDE_COLLISIONS` are allow-by-default;
  `ARRAY_INTO_ITER` / `BOXED_SLICE_INTO_ITER` warn, so `[T; N].into_iter()` / `Box<[T]>.into_iter()` in edition < 2021/2024
  resolving to a non-std method would stop there. `trait_path_or_bare_name` / `trait_path` / `adjust_expr` stay
  `unported_methods` placeholders.

## PORT decisions (please record)
1. **`fold_ExpectedSig`** (closure.ts): the derived `TypeFoldable`/`TypeVisitable` of `ExpectedSig` is hand-written as a
   descriptor (field-by-field like the derive, `Binder<FnSig>` impls for `sig`, `cause_span: Option<Span>` trivial)
   because the generated `visit_with_ExpectedSig` / `*fold_with_ExpectedSig` (closure.gen.ts) stop `unported` on
   `sig: ty::PolyFnSig` (no `type_fold.json` entry for the alias; fnctxt-contract report "2 missing TypeFoldable"). Needed
   on the success path (`normalize(Option<ExpectedSig>)`, `MentionsTy`). Root: add a `type_fold.json` entry for
   `rustc_middle::ty::PolyFnSig` / `rustc_middle::ty::sty::PolyFnSig`, regenerate, then drop the descriptor.
2. **`Elaboratable_Clause_Span`** (closure.ts): stand-in for `impl Elaboratable<TyCtxt> for (ty::Clause, Span)` (rustc_middle
   ty/elaborate_impl.rs:66, unported), a copy of rustc_hir_analysis wfcheck.ts's (second copy now: worth porting the file).
3. **`PORT(decls): pending root`** (closure.ts `deduce_future_output_from_obligations`): decls.ts types
   `FnCtxt.ret_coercion` as the *generated* `CoerceMany` (coercion.gen.ts, field `expected_ty`), but the field holds the
   hand class of coercion.ts (field `expected_ty_`, method `expected_ty()`, augmented in decls.ts under
   `declare module "./coercion.ts"`). I cast to the coercion.ts type. Root: import `CoerceMany` in decls.ts from
   `./coercion.ts` (affects every lane that calls `ret_coercion.*`).
4. **Lazy iterators keep upstream order**: `supplied_sig_of_closure` / `error_sig_of_closure` lower the argument types
   inside `mk_fn_sig`, i.e. *after* the return type (`decl.inputs.iter().map(lower_ty)` is consumed by `mk_fn_sig`);
   matters for inference-variable numbering. Tested.
5. `instantiate_method_args`'s local `struct GenericArgsCtxt` + `impl GenericArgsLowerer` is a local class (as
   hir_ty_lowering/mod.ts's); `self.cfcx.ct_infer(..)` (HirTyLowerer method through the Deref) is
   `this.cfcx.fcx.lowerer().ct_infer(..)`; `check_generic_arg_count_for_value_path(self.fcx, ..)` /
   `lower_generic_args(self.fcx, ..)` take `this.fcx.lowerer()` (the `&dyn HirTyLowerer` coercion).
6. `closure.rs:379 MentionsTy` is a local class implementing `TypeVisitor<ControlFlow<null>>` with the provided methods
   forwarded to `TypeVisitor_provided` (compare_impl_item.ts precedent).
7. `assert_eq!(a, b, "msg")` is written as `if (a !== b) panic(<core's exact text>)` (std `assert_eq` has no message
   parameter); `unimplemented!("msg")` as `panic("not implemented: msg")`; `Option::unwrap` via std `unwrap`.
8. `upcast_tcx` (the `Upcast<TyCtxt, P>` over-`Interner` cast) duplicated locally in method/mod.ts (precedent:
   autoderef.ts, opaque_types).
9. `Iterator::nth` on `Autoderef` (create_ty_adjustments_from_pick) is `n + 1` calls of `next()`.
10. prelude lints: the `edition` field of the lint structs is a `string` (generated type); `diag_pending` (see above).

## Cross-lane needs (what my code calls that other lanes own)
- **typeck-probe**: `FnCtxt::probe_for_name`, `Pick::{differs_from, maybe_emit_unstable_name_collision_hint}` (every method
  call and UFCS path goes through them first).
- **typeck-lib-wb**: `check::check_fn` (every closure body).
- **typeck-impl**: `normalize`, `apply_adjustments`, `write_user_type_annotation`, `add_wf_bounds`,
  `register_wf_obligation`, `require_type_is_sized`, `lower_ty`, `lower_const_arg`, `cause`/`misc` (if theirs),
  `deeply_resolve_ignoring_regions_with_obligations`.
- **typeck-checks-a** (merged): `obligations_for_self_ty`; **typeck-callee-cast** (merged):
  `callee::check_legal_trait_for_method_call`.
- **typeck-coerce**: `CoerceMany::expected_ty` (and decision 3).
- **codegen/root**: derive(TypeFoldable) for rustc_middle `UserType` / `UserTypeKind` (first stop of generic method calls);
  `type_fold.json` entry for `PolyFnSig` (decision 1).
- **wave 19**: `TypeErrCtxt::{report_mismatched_types, get_fn_like_arguments, report_arg_count_mismatch}`, `ArgKind`, the
  prelude lint `Diagnostic` impls and helpers.

## Re-pinned tests
None.
