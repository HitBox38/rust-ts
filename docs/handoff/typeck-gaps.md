# Handoff: typeck-gaps (M3 wave 18c): success-path blockers reported by the typeck lanes

Branch `lane/typeck-gaps` (from integ `60a45cf`, no merges). One commit per item (see `git log 60a45cf..`), then this
handoff.

## Result
All 10 assigned items are done (item 8: all but the two `probe_op` lint diagnostics, see "Left"), plus the success-path
stops the probe crates found next (ConstraintCategory, `FnCtxt::fn_sig`, `TyCtxt::is_intrinsic`,
`GlobalCtxt::data_layout`, `IntegerExt`). Typeck now runs end to end on ordinary `#![no_core]` bodies: 20 probe
crates (lets with annotations, generic fns and turbofish, inherent / trait / generic method calls, method turbofish,
casts, closures (`Fn` bounds, captures, `move`), struct / enum / tuple / slice patterns, refs, arrays, indexing,
operators, `if`/`match`/`while`/`loop`/`if let`, `impl Trait` returns, lifetimes, assoc types/consts, struct update,
raw-pointer deref, enum `as` casts, literals of every kind) MATCH the oracle in **both tydump and thirdump**.

| item | what | where |
|---|---|---|
| 1 | TypeVisitable/TypeFoldable of `UserType` / `UserTypeKind` / `CanonicalUserTypeAnnotation` generated (new set `rustc_middle_typeck_results`, typemap `typeck_results.typemap.json`); `fold_UserType` descriptor; the 4 `unported("TypeFoldable for …UserType…")` stops replaced by the upstream calls | `rustc_middle/ty/typeck_results{.gen,}.ts`, `gather_locals.ts` `declare`, `fn_ctxt/_impl.ts` `write_user_type_annotation_from_args` / `lower_ty_saving_user_provided_ty`, `method/confirm.ts` `instantiate_method_args` |
| 2 | `same_type_modulo_vars` + `SameModuloVars` (`TypeRelation`, a module-level class) | `fn_ctxt/checks.ts` |
| 3 | rustc_middle `ty/cast.rs` (`CastTy`, `from_ty`, `is_int_like`, `mir_cast_kind`); mir `CastKind` / `CoercionSource` generated (un-skipped in set `rustc_middle_mir_syntax`); cast.ts's stand-in dropped | `rustc_middle/ty/cast.ts`, `rustc_middle/mir/syntax.gen.ts`, `rustc_hir_typeck/cast.ts` |
| 4 | rustc_passes `upvars.rs` (`upvars_mentioned` provider, `LocalCollector`, `CaptureCollector`), wired in `rustc_passes::provide` | `rustc_passes/upvars.ts`, `rustc_passes/lib.ts` |
| 5 | `KEY_CanonicalMethodAutoderefStepsGoal` + queries.config.json key; queries.gen.ts regenerated | `rustc_middle/query/keys.ts` |
| 6 | `FnCtxt::is_field_suggestable` | `fn_ctxt/suggestions.ts` |
| 7 | `Session::relocation_model` (the `Deref` forwarder to `EarlySession`); inline_asm.ts stand-in dropped | `rustc_session/session.ts` |
| 8 | codegen: type_fold.json **instance keys** (`List<Binder<ExistentialPredicate>>` → BoundExistentialPredicates fns: `PointerKind::VTable`); `PolyFnSig` alias fold (→ `ExpectedSig`, closure.ts hand fold dropped); `AliasTy` Debug (`debug_AliasTy` hand alias in rustc_type_ir ty_kind.ts); `solve::PredefinedOpaques` alias fold (→ `MethodAutoderefSteps` derive complete; probe.ts local `fold_MethodAutoderefSteps` / `fold_ParamEnvAnd` dropped, it uses the generated impls + `rust_ts/fold_param_env_and.ts`); new set option **`type_fold_hand`** (derive TypeFoldable of hand-written types) used for hir/place.rs (`Place`, `PlaceBase`, `Projection`, `ProjectionKind`: new set `rustc_middle_hir_place`) and ty/mod.rs (`ProvisionalHiddenType`, `ClosureSizeProfileData`: new set `rustc_middle_ty_mod`); their `unported` descriptors in writeback.ts / opaque_types.ts / check.ts replaced | `tools/codegen/{types.ts,type_fold.json,types.sets.json,middle_traits_thir.typemap.json}` |
| 9 | `IntoDiagArg for ReturnLikeStatementKind` | `rustc_hir_typeck/diagnostics.ts` |
| 10 | rustc_trait_selection `opaque_types.rs` (235 lines: `NonDefiningUseReason` (+`from`, `report`), `opaque_type_has_defining_use_args`, `LazyOpaqueTyEnv`, `report_item_does_not_constrain_error`); hir_typeck / hir_analysis stand-ins repointed | `rustc_trait_selection/opaque_types.ts`, `rustc_trait_selection/lib.ts` |
| + | mir `ConstraintCategory` / `ReturnConstraint` / `AnnotationSource` generated (new set `rustc_middle_mir_query`; infer.typemap.json + type_fold.json entries), `ObligationCause::to_constraint_category` and `SubregionOrigin::to_constraint_category` ported. **This was the first stop of every fn item** (wfcheck → implied bounds → query response) | `rustc_middle/mir/query{.gen,}.ts`, `rustc_middle/traits/mod.ts`, `rustc_infer/infer/mod.ts`, `rustc_infer/decls.ts` |
| + | `FnCtxt::fn_sig` (suggestions.rs:43; every body's return check) | `fn_ctxt/suggestions.ts` |
| + | rustc_middle `ty/intrinsic.rs` (`IntrinsicDef`, `TyCtxt::is_intrinsic`; every fn call) | `rustc_middle/ty/intrinsic.ts`, `context.ts` (the `Pending` alias dropped) |
| + | `GlobalCtxt::data_layout` = `sess.target.parse_data_layout()` on first read (typed `TargetDataLayout`; error path unported); format.rs `int_ty_max` / `uint_ty_max` use it | `rustc_middle/ty/context.ts`, `rustc_ast_lowering/format.ts` |
| + | rustc_middle `ty/layout.rs` partial: `IntegerExt::{to_ty, from_int_ty, from_uint_ty}`, `HasDataLayout for TyCtxt`; util.ts / thir.ts / mir_build pattern stand-ins of these and of rustc_abi `Integer::size` / `Size::*` now forward to the real fns | `rustc_middle/ty/layout.ts` (+ lib.ts import), `ty/util.ts`, `thir.ts`, `rustc_mir_build/thir/pattern/mod.ts` |

## Files touched
- New: `src/rustc_middle/ty/{typeck_results.gen.ts,cast.ts,intrinsic.ts (stub filled),layout.ts,mod.gen.ts}`,
  `src/rustc_middle/hir/place.gen.ts`, `src/rustc_middle/mir/{query.ts,query.gen.ts}`, `src/rustc_passes/upvars.ts`,
  `src/rustc_trait_selection/opaque_types.ts`, `tools/codegen/typeck_results.typemap.json`.
- Edited (src): rustc_hir_typeck `gather_locals.ts`, `method/confirm.ts`, `method/probe.ts`, `fn_ctxt/{_impl,checks,suggestions}.ts`,
  `cast.ts`, `closure.ts`, `inline_asm.ts`, `writeback.ts`, `opaque_types.ts`, `diagnostics.ts`; rustc_middle
  `ty/{typeck_results,context,mod,util}.ts`, `hir/place.ts`, `mir/syntax.ts`, `traits/mod.ts`, `query/keys.ts`, `thir.ts`,
  `lib.ts`; rustc_infer `infer/mod.ts`, `decls.ts`; rustc_hir_analysis `check/check.ts`, `collect/type_of/opaque.ts`;
  rustc_session `session.ts`; rustc_passes `lib.ts`; rustc_trait_selection `lib.ts`; rustc_type_ir `ty_kind.ts`;
  rustc_ast_lowering `format.ts`; rustc_mir_build `thir/pattern/mod.ts`.
- Generated (regenerated, only intended diffs): `rustc_middle/{thir,traits/query,infer/canonical,mir/syntax}.gen.ts`,
  `rustc_hir_typeck/{cast,closure}.gen.ts`, `rustc_infer/infer/mod.gen.ts`, `rustc_middle/queries.gen.ts`.
- tools/codegen: `types.ts` (instance keys in type_fold lookups; `type_fold_hand`), `types.sets.json` (5 new sets:
  `rustc_middle_typeck_results`, `rustc_middle_hir_place`, `rustc_middle_ty_mod`, `rustc_middle_mir_query`; CastKind /
  CoercionSource un-skipped), `type_fold.json`, `middle_traits_thir.typemap.json`, `infer.typemap.json`,
  `queries.config.json`, `type_fold.test.ts` (golden excludes the two new rustc_middle/ty .gen.ts of other sets; new
  synthetic test for `type_fold_hand`).
- Not touched: decls.ts seams of rustc_hir_typeck (merge-w18), trait_selection traits/select|project|query (old-* lanes),
  harness/, scripts/, baselines.

## Coverage (`bun scripts/coverage.ts --missing`)
ty/cast.rs 3/3, passes/upvars.rs 5/5, trait_selection/opaque_types.rs 9/9, ty/intrinsic.rs 1/1, ty/layout.rs 4/61
(IntegerExt minus `discr_range_of_repr`, `HasDataLayout for TyCtxt`), fn_ctxt/checks.rs 31/73 (+`same_type_modulo_vars`
and the 7 `SameModuloVars` methods), fn_ctxt/suggestions.rs 2/51, hir_typeck diagnostics.rs 1/10, mir/query.rs 0/1 (types
only). `--check`: markers ok (16190; vendor 3888).

## Checks
- `bunx tsc --noEmit -p .` clean.
- `bun test src/rustc_hir_typeck src/rustc_middle src/rustc_infer src/rustc_hir_analysis src/rustc_trait_selection
  src/rustc_passes src/rustc_mir_build src/rustc_ast_lowering src/rustc_session tools` (1030 tests): all pass except the 7 that fail on base 60a45cf too
  (verified in a base worktree): `collect_test/{generics,misc}.rs`, `lower_ty stops at the remaining stubs`,
  `entry_test/{args_main,generic_main,where_main,plain_main}.rs`.
- Samples, lane vs base 60a45cf (same args; base in a temporary worktree):
  - `tydump-nocore --sample 300 --seed m17`: base 262 MATCH / 0 DIFF / 38 UNPORTED → lane **287 / 0 / 13**
    (all 14 `ConstraintCategory` stops of base now MATCH).
  - `tydump-minicore`: 14 / 0 / 32 → **15 / 0 / 31**. `thirdump-minicore`: 14 / 0 / 32 → **15 / 0 / 31**.
  - `hir-tree-nocore --sample 100 --seed tgaps`: 100 / 0 / 0 both.
  - Targeted: tests/ui/fmt/{format-macro-no-std,no-inline-literals-out-of-range}.rs now MATCH in hir-tree-nocore,
    hir-tree and unpretty-hir (were UNPORTED at `Size::signed_int_max` / `unsigned_int_max`).
  - No new DIFF anywhere.

## Re-pinned tests (no matching assertion weakened)
- `rustc_infer/infer_core.test.ts`: `SubregionOrigin::to_constraint_category` of a `Misc` cause now equals
  `{ $: "BoringNoLocation" }` (was `toThrow(Unported)`).
- `rustc_hir_typeck/coercion.test.ts` `mut_ref_to_ref_with_unsize`: `UNPORTED(ConstraintCategory …)` → `true` (the
  oracle's answer).
- `rustc_hir_analysis/check/wfcheck_b.test.ts` receiver.rs: its harness (`wfcheck_b_test/run.ts wf`) now also runs
  `check_associated_item` on the impl items after the free items (as `check_type_wf`'s owner loop); the case prints the
  oracle's E0307 exactly. The stale `ConstraintCategory` PENDING entry is removed.
- `rustc_hir_analysis/check/wfcheck_a.test.ts` `lint gat.rs`: lint mode does not make `check_associated_item`'s calls, so
  the expected stderr is the oracle's without its `requires \`legacy_receiver\` lang_item` diagnostic (and the error count
  adjusted; `LINT_NOT_MADE`, asserted to be present in the oracle). The full tydump pipeline prints both errors exactly
  (checked). Stale `ConstraintCategory` PENDING entry removed (marker.rs now passes without it).
- `rustc_hir_analysis/check/compare_impl_item.oracle.test.ts` `refine_rpitit` (in process): no longer pending; it prints
  the oracle's `refining_impl_trait` warning exactly (the "reported an error" guard accepts the lint case's warning,
  `LINT_CASES`).
- Stale `ConstraintCategory` PENDING entries removed (the cases now pass without them):
  `variance_outlives.test.ts`, `coherence.test.ts`, `check/check_region_intrinsic.test.ts`, `check/compare_eii.test.ts`.
- `rustc_middle/ty/util.test.ts`: `i32.int_size_and_signed` now `[4 bytes, signed]` (was `toThrow(Unported)`);
  `rustc_middle/traits/traits.test.ts`: the `0..` i32 `PatRange::is_full_range` is `false` (was `toThrow(Unported)`).
- `tools/codegen/type_fold.test.ts`: the rustc_ty golden's stale-file check ignores `typeck_results.gen.ts` /
  `mod.gen.ts` of rustc_middle/ty (other sets').

## `unported(...)` left (mine)
- `NonDefiningUseReason::report`, `NotAParam` arm: `#[derive(Diagnostic)] rustc_trait_selection::diagnostics::NonGenericOpaqueTypeParam`
  (rustc_trait_selection diagnostics.rs has no codegen set; error path, E0792).
- `GlobalCtxt::data_layout` error path: `Diagnostic for rustc_abi::TargetDataLayoutErrors` (custom target specs only).
- Not done from item 8: the two `probe_op` lint diagnostics (`MissingTypeAnnot`, `MethodCallOnDivergingInferenceVariable`)
  are fn-local `#[derive(Diagnostic)]` structs; the typedefs probe (tools/probes/typedefs) does not look inside fn bodies,
  so codegen cannot see them. Needs a probe change (root/harness batch). Reached only by the 2015-edition
  `TYVAR_BEHIND_RAW_POINTER` lint and method calls on diverging inference variables.
- Not done from item 8: writeback's `fold_CapturedPlace` / `fold_HirPlace` stay `unported`: the folds of hir/place.rs's
  types are generated now, but rustc_middle ty/decls.ts's `HirPlace` is still `Pending<"hir::place::Place">` (the
  place-types seam of merge-w18). Once decls.ts points `HirPlace` at hir/place.ts's `Place`: use `visit_with_Place` /
  `try_fold_with_Place` / `fold_with_Place` for `fold_HirPlace`, and add ty/closure.rs to a set with `type_fold_hand`
  (`CapturedPlace`, `CaptureInfo`, `UpvarCapture`) for `fold_CapturedPlace`.

## `// PORT:` decisions
- Codegen of hand-written types: a set may list `hand` items in `type_fold_hand` to get their derived
  TypeVisitable/TypeFoldable (hand classes rebuilt with `new`, imported as values). The hand module re-exports only the
  fold fns (`export { visit_with_X, .. } from "./x.gen.ts"`), not the .gen.ts's Debug of its hand types.
- type_fold.json **instance keys** (`<path><<arg keys>>`, args by first resolved key) for impls that differ per type
  argument (`list_fold!` impls of `&List<T>`); looked up before the generic entry.
- `UpvarId` / `UpvarPath` are in type_fold.json's `trivial` list: their derived impls only traverse `HirId` / `LocalDefId`
  (both trivial), so visiting continues and folding returns the value.
- typeck_results.rs: `UserType`, `UserTypeKind`, `CanonicalUserTypeAnnotation` are generated types now (the hand file keeps
  `UserType`'s companion `new` / `new_with_bounds` as `export type UserType = gen.UserType` + const); every other type of the
  file stays hand-written (skipped in the set).
- ty/mod.rs, mir/query.rs: sets with long `skip` lists so only the needed types are generated (the rest is hand-written
  or M4).
- `SameModuloVars` is a module-level class (fn-local struct upstream).
- Descriptors over generated fns are built with arrow wrappers (`(self, v) => gen.visit_with_X(self, v)`): init order.
- `NonDefiningUseReason` is a `$`-tagged union with `from` / `report` on the companion const; `LazyOpaqueTyEnv`'s
  `OnceCell` is a `GenericArgs | undefined` field.
- `GlobalCtxt::data_layout` is still computed on first read (was already deferred), now from the real parser.
- util.ts / thir.ts keep their stand-in names as thin forwarders to the real `IntegerExt` / rustc_abi fns (root may inline
  them).

## Remaining success-path stops, ranked
`tydump-nocore --sample 2000 --seed tgaps` (run tg-nocore-2k): **1911 MATCH / 0 DIFF / 89 UNPORTED** (95.6%). Stops:

| # | stop | owner / size |
|---|---|---|
| 24 | `CrateMetadata::get_adt_def` (+ `get_variant`: `VariantData` decode, `VariantDef::new`, `mk_adt_def`) | rmeta decoder, ~90 upstream lines; all proc-macro tests (extern ADTs) |
| 17 | `TyCtxt::const_eval_resolve_for_typeck` | const eval, M4 |
| 17 | `TyCtxt::const_eval_poly` (explicit enum discriminants `A = 1`, array lengths from consts) | const eval, M4 |
| 8 | `InferCtxt::err_ctxt` / `TypeErrCtxt` | error reporting, wave 19 (error paths) |
| 6 | `QueryKey for PseudoCanonicalInput<Ty>` (`layout_of` in `check_static_inhabited`: **every `static`**) | the key is small (queries.config.json), but `layout_of`'s provider (rustc_ty_utils layout.rs) is M4 |
| 6 | `Decodable for ty::ImplTraitHeader` (extern trait impls) | rmeta decoder |
| 2 | `TyCtxt::expand_abstract_consts` | ty/abstract_const.rs, generic_const_exprs |
| 1 each | `hir_get_parent_item`, `ValueConst::valtree`, `adjust_expr_for_assert_eq_macro`, `Decodable for DenseBitSet<u32>`, `BangProcMacro::expand` (M6), an `IntoDiagArg` missing in codegen, `suggest_assoc_method_call`, `suggest_new_overflow_limit`, `NextTypeParamName` | mostly error paths (wave 19) |

`tydump-minicore` / `thirdump-minicore` (31 UNPORTED each): 24× `SelectionContext::poly_select` and 3×
`evaluate_root_obligation` (old solver: lanes old-select-a/-b, running), 1× `TyCtxt::mk_pat` (mini_core.rs: the
hash-consed `Pattern` class, rustc_middle ty/pattern.rs, 122 lines + interner + relate/fold), 1× `const_eval_poly`
(mini_core_hello_world.rs), 1× `PseudoCanonicalInput` key (statics), 1× `adjust_fulfillment_error_for_expr_obligation`
(fn_ctxt/adjust_fulfillment_errors.rs stub, wave 19; error path).

Probe crates: the only success-path stops left are `static` items (layout_of) and explicit enum discriminants
(const_eval_poly).
