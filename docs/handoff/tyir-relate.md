# Handoff: tyir-relate (wave 14, M3): rustc_type_ir relate.rs, relate/{combine,solver_relating}.rs, elaborate.rs, outlives.rs (+ error.rs fns)

Branch `lane/tyir-relate` (from main a62a248, no merges).

## Files touched
- `src/rustc_type_ir/relate.ts` (was a skeleton): `TypeRelation` interface + `TypeRelation_provided`, the `Relate<T>`
  descriptor, `VarianceDiagInfo` companion (`xform`), `relate_args_invariantly` / `relate_args_with_variances`, the
  `Relate` impls of relate.rs (`relate_FnSig`, `relate_AliasTy`, `relate_AliasConst`, `relate_AliasTerm`,
  `relate_ExistentialProjection`, `relate_TraitRef`, `relate_ExistentialTraitRef`, `relate_Binder(d)`,
  `relate_TraitClause`), `structurally_relate_tys`, `structurally_relate_consts`; plus the stand-ins listed below and
  `interner(tcx)` (the `TyCtxt` → `Interner` view, see decision 4).
- `src/rustc_type_ir/relate/combine.ts` (new): `PredicateEmittingRelation`, `super_combine_tys`, `super_combine_consts`,
  `combine_ty_args`; the pending `InferCtxtLike` / `Upcast` contract pieces and stand-ins.
- `src/rustc_type_ir/relate/solver_relating.ts` (new): `RelateExt` + `RelateExt_for_Infcx`, `SolverRelating`.
- `src/rustc_type_ir/elaborate.ts` (new): `Elaboratable<O>` descriptor, `ClauseWithSupertraitSpan` (+ its impl
  `Elaboratable_ClauseWithSupertraitSpan`), `elaborate`, `Elaborator`, `supertrait_def_ids`, `supertraits`,
  `FilterToTraits`, `elaborate_outlives_assumptions`.
- `src/rustc_type_ir/outlives.ts` (was a skeleton): `push_outlives_components`, `OutlivesCollector` (exported for tests),
  `compute_alias_components_recursive`, `declared_bounds_from_definition`.
- `src/rustc_type_ir/error.ts` (was a skeleton; the brief's "ExpectedFound, TypeError helpers"): `ExpectedFound.new`,
  `TypeError.involves_regions` / `must_include_note`, `NoSolution_from_TypeError`,
  `NoSolutionOrRerunNonErased_from_TypeError`.
- `src/rustc_type_ir/tyir_relate.test.ts` (new): 32 tests, 123 expects.
- No `.gen.ts`, decls, contract, tools or other lanes' files edited. No new extension modules (nothing assigns to a
  prototype), so `rustc_middle/lib.ts` needs no import.

## Coverage (`bun scripts/coverage.ts --missing`)
| file | ported |
|---|---|
| relate.rs | 23/23 |
| relate/solver_relating.rs | 14/14 |
| relate/combine.rs | 7/7 |
| elaborate.rs | 21/21 |
| outlives.rs | 5/5 |
| error.rs | 5/5 |

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4139 pass, 1 skip (pre-existing linux-only), 0 fail.
- `bun scripts/coverage.ts --check`: markers ok.
- Fresh-process `import()` of relate.ts, relate/combine.ts, relate/solver_relating.ts, elaborate.ts, outlives.ts: ok.
- Difftest: nothing in these files is on a driver path yet (no caller outside the lane).
  `RUST_TS_AGENT=tyir-relate --suite parse --sample 100`: 100/100 MATCH (run `20261014-051403-tyir-relate-wzb6`).

## Tests (`tyir_relate.test.ts`)
Expectations are upstream semantics read off the pinned sources (no oracle probe was needed: every asserted value is a
`TypeError` variant, an interned type identity, a call sequence or a set/order derived from the code).
- error.rs: `ExpectedFound::new`, `involves_regions`, `must_include_note`, the two `From` impls; `VarianceDiagInfo::xform`;
  the full `Variance::xform` table.
- `structurally_relate_tys` with a plain structural `TypeRelation`: equal leaves, `Sorts` for different leaves, params by
  index, placeholders by value, raw pointers (`Mutability`, the pointee's variance and `VarianceDiagInfo::Invariant {
  ty: a, param_index: 0 }` for `*mut`), tuples (`TupleSize` vs `Sorts`), foreign types; panics for `Infer`/`Bound`;
  UNPORTED where a `Ty::new_*` constructor (lane ty-sty) is needed.
- `relate_args_invariantly` / `_with_variances`: same interned list back, lazy stop at the first error, variances per arg.
- `relate_FnSig`: `VariadicMismatch`, `SafetyMismatch`, `AbiMismatch`, `ArgCount`, `ArgumentSorts` by index (output at
  `inputs.len()`), `ArgumentMutability`, success; `relate_TraitRef` (`Traits`), `relate_AliasTy` (`ProjectionMismatched`
  with the `AliasTermKind` conversion), `relate_Binder` equality.
- `structurally_relate_consts`: params by index, `ConstMismatch`, `Error` wins on either side.
- `SolverRelating` with a recording `InferCtxtLike` double: short-circuit, int/float variable instantiation/equating,
  type variables (equate when invariant; `instantiate_ty_var` with the flipped variance on the right),
  `relate_with_variance` composition/restoration and bivariance, regions per ambient variance, consts, binders
  short-circuit, `RelateExt::relate`, `relate_ty_args` (invariant), `combine_ty_args` diag infos and `a_ty` reuse.
- outlives: `OutlivesCollector::visit_ty` (params, inference vars, dedup via `visited`, trivial leaves),
  `visit_region` (skips bound regions).
- elaborate: dedup + LIFO order + `size_hint`, `supertrait_def_ids` (depth-first, cycle-safe), `supertraits`,
  `elaborate_outlives_assumptions` (dedup, insertion order), `Elaboratable for Clause`.
- Mocked stubs (upstream bodies, in the test only): `RawList.inputs/output` (as tyir-kind did), `TyCtxt.features`
  (`generic_const_exprs` off), `Region.is_bound`, and for elaborate `Predicate.as_clause/expect_clause`,
  `Clause.kind/as_trait_clause/instantiate_supertrait`, `TyCtxt.anonymize_bound_vars` (identity without bound vars),
  `TyCtxt.is_trait_lang_item`, `TyCtxt.explicit_super_clauses_of`.

## `unported(...)` left
In my files, all in clearly marked stand-in blocks for other lanes' fns:
- relate.ts: `inherent::AdtDef::def_id` (AdtDef pending), `ty::Value` `valtree().kind()` (Value pending), the
  rustc_middle `Relate` impls for `Pattern`, `&List<PolyExistentialPredicate>` and `ty::Expr` (rustc_middle
  ty/relate.rs:22/:56/:102).
- combine.ts: `Binder::dummy` (needs `has_escaping_bound_vars`), `TypeVisitableExt::has_non_region_infer`.
- solver_relating.ts: `Binder::no_bound_vars`.
- outlives.ts: `Binder::no_bound_vars`, `TypeVisitableExt::has_escaping_bound_vars`, `Ty::super_visit_with`,
  `EarlyBinder::instantiate` (inside the `iter_instantiated` stand-in, per item).
Reached at runtime through other lanes' stubs: every `Ty::new_*` (ty-sty), `visit_with_Ty` / `fold_*` descriptors of
`Ty`, `Region`, `Const`, `GenericArg(s)` (tyir-binder), `Clause`/`Predicate` methods (`as_clause`, `kind`,
`as_trait_clause`, `instantiate_supertrait`, `expect_clause`, `as_type_outlives_clause`), `Region.is_bound`,
`debug_Const` / `debug_GenericArg` (in panic messages), `TyCtxt.debug_assert_args_compatible` /
`debug_assert_existential_args_compatible` (ty-ctxt placeholders), `anonymize_bound_vars`, `expand_abstract_consts`.

## PORT stand-ins (not markers; root repoints them when the owners land)
| stand-in | file | real home |
|---|---|---|
| `Variance_xform` (exported) | relate.ts | lib.rs:306 |
| `Binder_rebind` (exported) | relate.ts | binder.rs:186 (tyir-binder) |
| `TraitRef_new_from_args`, `ExistentialTraitRef_new_from_args`, `ExistentialProjection_new_from_args`, `ExistentialProjection_alias_kind` | relate.ts | predicate.rs (tyir-misc) |
| `relate_Ty`, `relate_GenericArg`, `relate_GenericArgs`, `relate_Term`, `relate_Pattern`, `relate_BoundExistentialPredicates`, `relate_Expr` | relate.ts | rustc_middle ty/relate.rs |
| `relate_Region`, `relate_Const` | relate.ts | sty/mod.rs:281, sty/consts.rs:240 (decls name them `relate_Region` / `relate_Const`) |
| `InferCtxtLike` (interface, the slice used here) | combine.ts | infer_ctxt.rs:387 (tyir-misc) |
| `Upcast<T, U>` (type) | combine.ts | upcast.rs (tyir-misc) |
| `Goal_new` | combine.ts | solve/mod.rs:401 (tyir-solve) |
| `Binder_dummy`, `Binder_no_bound_vars` (×2), `EarlyBinder_iter_identity`, `EarlyBinder_iter_instantiated` | combine.ts, solver_relating.ts, outlives.ts, elaborate.ts | binder.rs (tyir-binder) |
| `TypingMode_assert_not_erased` | combine.ts | infer_ctxt.rs:285 |
| `upcast_PredicateKind_Predicate`, `upcast_Binder_PredicateKind_Predicate`, `upcast_ClauseKind_Predicate`, `upcast_ProjectionClause_Predicate` (exported), `upcast_Binder_ClauseKind_Clause`, `upcast_PolyTraitClause_Predicate`, `upcast_PolyTraitRef_Clause` | combine.ts, elaborate.ts | rustc_middle ty/predicate.rs:455-609 (ty-args) |
| `DelayedSet` | solver_relating.ts | data_structures/delayed_map.rs:60 |
| `Unnormalized_skip_norm_wip`, `Unnormalized_to_host_effect_clause` | outlives.ts, elaborate.ts | unnormalized.rs |
| `trait_ref_def_id`, `PolyTraitClause_def_id` | elaborate.ts | predicate.rs:218/:228/:684 |
| `Elaboratable_Clause` | elaborate.ts | rustc_middle ty/elaborate_impl.rs:6 |
| `AliasTy_has_escaping_bound_vars`, `GenericArg_has_non_region_infer`, `Ty_super_visit_with` | outlives.ts, combine.ts | visit.rs / structural_impls.rs |

## PORT decisions (please record)
1. **`Relate<T>` is a D4 descriptor** that extends `TypeFoldable<T>` and adds `eq` (the `PartialEq` supertrait) and
   `relate(relation, a, b)`. Impl consts are `relate_<T>`; the generic `Binder` impl is the function `relate_Binder(d)`.
   Methods generic over `T: Relate` take the descriptor last: `relation.relate(a, b, d)`,
   `relate_with_variance(v, info, a, b, d)`, `binders(a, b, d)`.
2. **`TypeRelation`** is an interface; its provided `relate` is `TypeRelation_provided.relate(self, a, b, d)`.
   `PredicateEmittingRelation extends TypeRelation`; `register_predicates<T>(obligations, upcast)` takes the items'
   upcast function (`impl IntoIterator<Item: Upcast<I, I::Predicate>>`); `Goal_new(cx, param_env, pred, upcast)` likewise.
3. **Derived `PartialEq` of non-interned values** (`AliasTyKind`, `AliasTermKind`, `Placeholder`, `FnSig`, `TraitRef`,
   `ScalarInt`, ...) is `intern_key(a) === intern_key(b)`; `Binder` equality is `d.eq(value) && bound_vars ===`;
   interned values use `===`; `DefId` uses `DefId_eq`.
4. **`interner(tcx)`** (relate.ts) casts `TyCtxt` to `Interner` for trait calls: the `TyCtxt` class type does not
   declare the 14 inherent Interner methods yet (ty-ctxt), so `TyCtxt` is not assignable to `Interner`. Used for
   `variances_of`, `item_self_bounds`, `explicit_*_clauses_of`, `ir_explicit_implied_const_bounds`, `is_trait_lang_item`,
   `anonymize_bound_vars`, `mk_args_from_iter`, `debug_assert_*`, `IsRigid.yes_if_next_solver`. Drop it once `TyCtxt`
   implements `Interner` in the type system.
5. **Lazy iterator chains** collected through `mk_*_from_iter` / `new_tup_from_iter` are generators passed with
   `CollectAndApply_Result`, so relating stops at the first `Err` (side effects on the relation match upstream).
   Eager parts of a chain (e.g. the `once((a.output(), b.output()))` operand, `iter_instantiated` construction) are
   evaluated before the generator.
6. **`pub mod combine; pub mod solver_relating;`** and solver_relating's `pub use crate::relate::*;` are not re-exported
   (ESM cycle: the submodules import relate.ts). Importers use the submodule paths.
7. **`SolverRelating`** fields `param_env` / `span` are `param_env_` / `span_` (the `PredicateEmittingRelation` methods
   need the names); `Elaborator.elaborate_sized` field is `elaborate_sized_` (method name); `Elaborator` stores its
   `Elaboratable<O>` impl as a trailing field `d_O`. `RelateExt`'s blanket impl is `RelateExt_for_Infcx.relate(infcx, ..)`.
8. **Containers**: `SsoHashSet<Ty>` → `Set<Ty>` (probe only); `HashSet<Binder<PredicateKind>>` and
   `HashSet<OutlivesClause<GenericArg>>` → `KeyedSet(intern_key)` (the latter is returned; insertion order per D6, interned
   keys); `HashSet<TraitId>` → `DefIdSet`; `SmallVec` → arrays; `DelayedSet` key `[Variance, Ty, Ty]` by `intern_key`.
9. **Iterators** (`Elaborator`, `FilterToTraits`) are classes with `next` / `size_hint` and `[Symbol.iterator]`
   (rustc_hir pat_util.ts precedent); `supertrait_def_ids` / `declared_bounds_from_definition` return generators.
10. `structurally_relate_tys`'s `Param` arm and `structurally_relate_consts`'s read `ParamTy.index` / `ParamConst.index`
    directly (`inherent::ParamLike::index` is the field).
11. `Span::dummy()` (`inherent::Span for Span`) is `DUMMY_SP`.
12. `#[instrument]`, `trace!`, `debug!` are comments/dropped; `debug_assert*!` stay as comments; panics whose message
    formats a value with `{:?}` call that value's `debug_*` (which stops UNPORTED today for `Const` / `GenericArg`).
13. error.rs's fns were ported here (the brief lists "ExpectedFound, TypeError helpers"); no other lane owns error.rs.

## For root
- `rustc_type_ir/decls.ts` already re-exports `RelateResult` from relate.ts (still exported, now the generated alias).
- When tyir-binder / tyir-misc / tyir-solve / ty-args / ty-sty land, replace the stand-ins in the table above
  (module-local ones are `function`s at the top of each file, under a "PORT stand-ins" heading).
- `relate_Region` / `relate_Const` belong in sty/{mod,consts}.ts per decls; the rustc_middle ty/relate.rs impls
  (`relate_Ty`, `relate_GenericArg`, `relate_GenericArgs`, `relate_Term`, `relate_Pattern`,
  `relate_BoundExistentialPredicates`, `relate_Expr`) need a home (`src/rustc_middle/ty/relate.ts`, not created: outside
  this lane's files).
- `InferCtxtLike` here lists only what relate uses; the real interface (tyir-misc) must keep these signatures or the
  call sites adjust: `instantiate_binder_with_infer(value, d_T)`, `enter_forall_with_empty_assumptions(value, f, d_T)`,
  `instantiate_ty_var(relation, target_is_expected, vid, variance, ty)`, `instantiate_const_var(relation, ..)`,
  `deeply_resolve_ignoring_regions(value, d_T)`.
