# Handoff: ty-args (wave 15, M3): rustc_middle ty/generic_args.rs, ty/list.rs, ty/predicate.rs, rest of ty/generics.rs

Branch `lane/ty-args` (from main-integ `ab2cdfc`, no merges). Commits: list.rs; generic_args.rs + generics.rs; predicate.rs;
tests (+ one repinned test outside the lane); generics.ts Debug imports; this handoff.

## Files touched
- `src/rustc_middle/ty/list.ts` (list.rs 10 → 22/22): `RawList.default`, `eq`, `deref`, `as_ref`, `into_iter` (class
  body), `RawList.from_vars` (static, `tcx.mk_bound_variable_kinds_from_iter`), `cmp_RawList` / `partial_cmp_RawList`
  (element order passed as a fn), `hash_RawList` (writes the intern `id`), `encode` rustc-skip. The `SliceLike` `iter` /
  `as_slice` markers stack on the inherent methods. The `unported_methods(RawList, ..)` call is gone.
- `src/rustc_middle/ty/generic_args.ts` (generic_args.rs 14 → 60/60): `split_closure_args` /
  `split_coroutine_closure_args` / `split_coroutine_args`, `GenericArg_into_diag_arg`, `GenericArg.is_non_region_infer` /
  `walk` (real `TypeWalker.new`), the real D4 descriptors `fold_GenericArg`, `fold_GenericArgs` (1/2/0 fast paths +
  `fold_list`), `fold_List_Ty` (2 fast path + `fold_list`), new `visit_List(d_T)` (`TypeVisitable for &List<T>`),
  `decode_GenericArg(d, decode_GenericArgKind)`, and every `impl GenericArgs` method/static (`into_type_list`, `as_*`,
  `identity_for_item`, `for_item`, `extend_to`, `fill_item`, `fill_single`, `extend_with_error`, `types` / `regions` /
  `consts` / `terms` / `non_erasable_generics`, `type_at` / `region_at` / `const_at`, `type_for_def`, `rebase_onto`,
  `truncate_to`, `print_as_list`). `lift_to_interner` / `encode` rustc-skip. The `unported_methods` calls are gone.
- `src/rustc_middle/ty/predicate.ts` (predicate.rs 8 → 61/61): `Predicate` `flip_polarity`, `allow_normalization`,
  `as_trait_clause`, `as_projection_clause`, `as_clause`, `expect_clause`; `Clause` `kind` (+ `unreachable_inner`),
  `as_trait_clause` / `as_projection_clause` / `as_type_outlives_clause` / `as_region_outlives_clause`,
  `instantiate_supertrait`; `Predicate_into_diag_arg` / `Clause_into_diag_arg`; `ExistentialPredicate_stable_cmp`;
  `List<PolyExistentialPredicate>` `principal` / `principal_def_id` / `projection_bounds` / `auto_traits` /
  `without_auto_traits`; all 24 `UpcastFrom` impls as `Predicate_upcast_from_<X>` / `Clause_upcast_from_<X>`. The
  `unported_methods` calls are gone; the structural_impls.rs stubs at the end (Debug / visit / fold of `Predicate` and
  `Clause`) are unchanged (lane ty-results).
- `src/rustc_middle/ty/generics.ts` (generics.rs 17 → 45/45): `GenericParamDef.to_early_bound_region_data` /
  `default_value` / `to_error`; `Generics.param_region_def_id` (`GenericsOf`), `param_at`, `params_to`, `region_param`,
  `type_param`, `const_param`, `own_args_no_defaults`, `own_args`, `check_concrete_type_after_default`; new types
  `GenericClauses` / `ConstConditions` (interfaces + derived `Debug` + `default_()` + all methods incl.
  `is_fully_generic_for_reflection` with its local `ParamChecker` visitor), `MapUnzipIter` (the lazy `.map(unzip)`
  iterator of `instantiate_own*`), stand-in `InstantiatedClauses` (below).
- New test `src/rustc_middle/ty/ty_args.test.ts` (11 tests): identity args of a hand-built trait + method
  (`Self`, `'a`, `T`, `const N`), `for_item` / `extend_to` / `extend_with_error` / `truncate_to` / `rebase_onto`,
  `fill_single`'s assertion text, `split_*` / `into_type_list`, `EarlyBinder::instantiate` through `fold_GenericArgs`
  (2-arg and `fold_list` paths, unchanged list returns itself), `fold_List_Ty`, `fold_GenericArg`; `Generics` lookups,
  bug texts, `own_args*` with/without a matching default; `GenericClauses` / `ConstConditions` identity instantiation
  through a parent and `MapUnzipIter`; predicate upcasts / `as_*` / `flip_polarity` / `allow_normalization`;
  `instantiate_supertrait` on upstream's own doc examples (`for<'x> T: Foo1<'x>` with `Foo1<'a>: for<'b> Bar1<'a, 'b>`
  gives `for<'x, 'b> T: Bar1<'^0.0, '^0.1>`); `List<PolyExistentialPredicate>` accessors; `stable_cmp`; list.rs impls.
  `Ty.new_param` (ty/sty.rs, lane ty-sty) is mocked with its upstream body; queries are shadowed on the `TyCtxt` instance.
- **Outside the lane (test pin only):** `src/rustc_type_ir/tyir_misc_predicate.test.ts` "PolyTraitRef helpers stop at
  rustc_middle stubs as UNPORTED" pinned the stubs this lane filled (`GenericArgs::type_at`, `Predicate::expect_clause`).
  Renamed "PolyTraitRef helpers run the rustc_middle methods": `self_ty` on empty args now panics with core's index
  text, `to_host_effect_clause` interns a `HostEffect` clause (asserted, and interned once). Nothing weakened (same
  precedent as tyir-misc note 9).

## Coverage (`bun scripts/coverage.ts --missing`)
| file | before | now |
|---|---|---|
| ty/generic_args.rs | 14/60 | 60/60 |
| ty/list.rs | 10/22 | 22/22 |
| ty/predicate.rs | 8/61 | 61/61 |
| ty/generics.rs | 17/45 | 45/45 |

Skips: list.rs:199 `encode`, generic_args.rs:325 `lift_to_interner` (Lift), generic_args.rs:366 `encode`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (11193; vendor 3888)` (final tree).
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4303 pass, 1 skip (pre-existing linux-only), 0 fail
  (run at the test commit; the later generics.ts Debug-import commit was re-checked with the two crates' tests).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_middle src/rustc_type_ir`: all pass (236 incl. the 11 new).
- Difftest samples (`RUST_TS_AGENT=ty-args`):
  - `hir-tree-nocore --sample 150`: 149 MATCH / 0 DIFF / 1 UNPORTED (`20261014-071525-ty-args-ccqy`); the stop is the
    pre-existing `proc-macro/quote/does-not-have-iter-separated.rs` (`BangProcMacro::expand`, M6).
  - `unpretty-hir --sample 100`: 100/100 MATCH (`20261014-071603-ty-args-46ad`).
- Fresh-process loads: every non-test module under `src/rustc_middle/` and `src/rustc_type_ir/` loads as an entry point
  except the six that already failed at the lane base (`ty/print/mod.ts`, `binder.gen.ts`, `canonical.gen.ts`,
  `predicate.gen.ts`, `solve/mod.gen.ts`, `ty_kind.gen.ts`; checked against `ab2cdfc`).

## `unported(...)` left in the lane's files
- `debug_GenericArg` (structural_impls.rs:145, lane ty-results). Reached by the `bug!` texts of `type_at` /
  `region_at` / `const_at` and `fill_single`'s `assert_eq!` text (ICE paths only).
- predicate.ts's structural_impls.rs stubs (unchanged): `debug_Predicate`, `debug_Clause`, `visit_with_` /
  `try_fold_with_` / `fold_with_` `Predicate` / `Clause` (lane ty-results). They are reached by `GenericClauses`'
  instantiation (`EarlyBinder::bind` of a clause folds it), `is_fully_generic_for_reflection` (`clause.visit_with`) and
  `debug_GenericClauses`.
- Through other lanes' stubs: `Ty::new_param` (identity args of a type param, ty-sty), `Ty::new_misc_error`
  (`to_error`, ty-sty), `Ty::is_ty_or_numeric_infer` (ty-sty), the `Ty` super-fold / super-visit of `standin_fold_Ty`
  (ty-results) when an instantiated type has params below the top level.

## Stand-ins this lane added (root: repoint)
1. `generic_args.ts` `fold_list` / `try_fold_list`: upstream bodies of ty/util.rs:1607 / :1643 (lane ty-util). Local,
   not exported; they take the element descriptor last.
2. `generics.ts` `InstantiatedClauses` (exported interface `{ clauses, spans }`) + `InstantiatedClauses_empty`: upstream
   ty/mod.rs:790/:796 (lane ty-mod). `GenericClauses.instantiate*` return it.
3. `generics.ts` `d_Clause` / `d_Span` / `d_TraitRef` / `d_PolyTraitRef` and `predicate.ts` `d_ClauseKind` /
   `d_PredicateKind` / `d_TraitRef`: D4 descriptors over generated / stub impl fns (`d_Span` is
   `TrivialTypeTraversalImpls! { Span }`, structural_impls.rs). Replace with ty-results' descriptors when they land.
4. `fold_GenericArg` / `fold_List_Ty` use `standin_fold_Ty` for the `Ty` impls (merge-w15a decision 3).

## For root: stand-ins elsewhere that now have real ports
- `rustc_type_ir/predicate.ts` `Clause_upcast_from_Binder_ClauseKind` / `Clause_upcast_from_PolyTraitRef` /
  `Clause_upcast_from_PolyProjectionClause` → re-export the same-named fns of `rustc_middle/ty/predicate.ts`.
- `rustc_type_ir/relate/combine.ts` `upcast_PredicateKind_Predicate` / `upcast_Binder_PredicateKind_Predicate` /
  `upcast_ClauseKind_Predicate` / `upcast_ProjectionClause_Predicate` → `Predicate_upcast_from_PredicateKind` /
  `_Binder_PredicateKind` / `_ClauseKind` / `_ProjectionClause`.
- `rustc_middle/ty/context.ts`: `GenericParamDef_to_early_bound_region_data` → `GenericParamDef.to_early_bound_region_data`;
  `Generics_own_args(g, args)` → `g.own_args(args)`; `ExistentialPredicate_stable_cmp` → predicate.ts's (same name and
  signature), which unblocks `mk_poly_existential_predicates`.
- `rustc_middle/ty/print/mod.ts` and `print/pretty.ts`: `own_args_no_defaults` stand-ins → `generics.own_args_no_defaults(tcx, args)`.
- `rustc_type_ir/sty/mod.ts` `Generics_param_region_def_id` → `generics.param_region_def_id(tcx, ebr)`.
- `rustc_middle/ty/context/impl_interner.ts`: `ir_clauses_of` / `own_clauses_of` / `ir_const_conditions` can now be
  written (`GenericClauses.instantiate_identity`, `.instantiate_own_identity`, `ConstConditions.instantiate_identity`;
  `EarlyBinder.bind_iter`). Their stub texts still say `GenericPredicates` (the pre-rename name).
- `tools/codegen` / queries: `generics_of`, `type_of`, `const_param_default`, `clauses_of`, `explicit_clauses_of`,
  `const_conditions` value types can now be `Generics` / `EarlyBinder<Ty>` / `EarlyBinder<Const>` / `GenericClauses` /
  `ConstConditions` (generics.ts); this lane casts their `unknown` values. rmeta's `decode_unported("ty::GenericClauses")`
  / `("ty::ConstConditions")` can decode into these interfaces (`{ parent, clauses: [Clause, Span][] }`).
- decls.ts (no change needed): `types` / `regions` / ... are declared `Iterable<_>`; they return arrays (a subtype).
  The upcast fns are free fns, as decls.ts's comment lines say ("upcast fn").

## PORT decisions (please record)
1. Inherent methods that an `inherent::*` / `IntoKind` / `SliceLike` / `BoundExistentialPredicates` / `GenericsOf` impl
   only forwards to carry both markers (`// PORT: also ...: one method`), as ty-contract did for `kind`.
2. `impl UpcastFrom<TyCtxt, X> for Y` → exported free fn `Y_upcast_from_X(from, tcx)` (the existing stand-ins' names);
   `Binder<X>` is `PolyX` where rustc_middle has the alias, else `Binder_X`; `Binder<HostEffectClause>` is
   `PolyHostEffectClause`. `x.upcast(tcx)` chains call the selected impl directly.
3. `impl Iterator` results of `GenericArgs` / `List<PolyExistentialPredicate>` methods are arrays (pure closures);
   `GenericClauses` / `ConstConditions` `instantiate_own*` return the lazy `MapUnzipIter` (instantiation may stop
   UNPORTED/ICE per element, so it must stay lazy like upstream).
4. `self[i]` / `&self[a..b]` use local helpers with core's panic texts (`index out of bounds: the len is .. but the index
   is ..`, `slice index starts at .. but ends at ..`, `range end index ..`).
5. `RawList`'s `Ord` / `PartialOrd` take the element order as a fn (`cmp_T`); `Hash` writes the intern id.
6. `Display` / `Print` uses from defining modules (`GenericArg_into_diag_arg`, `print_as_list`, `expect_clause`'s bug
   text, `*_into_diag_arg`) load ty/print/pretty.ts lazily (`require`), and predicate.ts loads `context/tls.ts` lazily:
   a static import of tls.ts (→ context.ts) made `relate.ts` read `fold_GenericArgs` in its TDZ.
7. `GenericClauses` / `ConstConditions` are hand-written interfaces with companions (methods take `self` first), derived
   `Debug` as `debug_<T>`, `#[derive(Default)]` as `default_()`.
8. `fill_single`'s `assert_eq!(.., "{args:#?}, {defs:#?}")` is written out (core's `assert_failed` text with the message).

## Not done
- Nothing in scope. No driver path calls the new code yet beyond what already reached the stubs (e.g. print's
  `own_args_no_defaults` still goes through its own stand-in until repointed).
