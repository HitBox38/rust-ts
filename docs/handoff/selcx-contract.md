# Handoff: selcx-contract (M3 wave 18, contract-first): the old trait solver

Branch `lane/selcx-contract`, from `integ` 4447fa3, no merges. Commits: obligation_forest → codegen set + `SelectionContext`
contract → stub modules + fulfill/evaluate_obligation/implied_outlives_bounds ports + repoints → query keys → rustc_traits
crate → review-w17 tests + re-pins → this handoff.

## Result
- **Contract.** Every fn of the old solver's scope has a declaration or a signature-typed stub, so the wave-18b lanes
  only fill bodies (split table below):
  - `SelectionContext` (generated class, traits/select/mod.gen.ts): all 96 methods of select/{mod,candidate_assembly,
    confirmation}.rs + the statics `new` / `with_query_mode` are declared in `src/rustc_trait_selection/decls.ts`
    (`declare module "./traits/select/mod.gen.ts"`, `// traits/select/<file>:<line>` above each). The stub modules install
    `unported_methods` placeholders (`rustc_trait_selection::traits::select[::candidate_assembly|::confirmation]::SelectionContext::<name>`).
  - project.rs, query/**, vtable.rs, outlives_for_liveness.rs, auto_trait.rs: the pub / cross-file fns are exported
    stubs with their final signatures (`// <file>:<line> (stub)` above, body `unported("rustc_trait_selection::traits::..::<name>")`);
    private fns are listed in each module's comment block; trait impls are D4 descriptors (`QueryTypeOp_<T>`,
    `Normalizable_<T>`, `TypeOp_ParamEnvAnd(d_Q)`, `TypeOp_CustomTypeOp(d_R)`), methods of generated classes
    (`MatchAgainstFreshVars`, `QueryNormalizer`, `AutoTraitFinder`) are `unported_methods` placeholders.
  - Types: new codegen set `rustc_trait_selection_old_solver` (16 files, 38 types; `tools/codegen/types.sets.json`,
    appended) with the set-local map `tools/codegen/old_solver.typemap.json` (new). Hand types: `FulfillmentContext`,
    `OldSolverError`, `TypeOpOutput`, `CustomTypeOp`, `TraitObligationStackList`. Report: 0 unknown types; 1 missing
    TypeFoldable (`ArgOutlivesClause` inside `AutoImplConstituents`, generated as `unported_type_fold`).
- **Ported for real** (markers, upstream order):
  - `rustc_data_structures/obligation_forest/{mod,graphviz}.rs` 29/29 + 9/9, with `tests.rs` 15/15 as
    `obligation_forest/tests.test.ts` (7 tests, pass).
  - `traits/fulfill.rs` 24/24: `FulfillmentContext` (the old `TraitEngine`), `FulfillProcessor`, `DrainProcessor`,
    `StalledOnCoroutines`, `mk_pending`, `args_infer_vars`, both `FromSolverError<OldSolverError>` impls.
  - `traits/query/evaluate_obligation.rs` 7/7 (both solvers' paths; the old one calls the `evaluate_obligation` query).
  - `traits/implied_outlives_bounds.rs` 7/7 (incl. `QueryTypeOp_ImpliedOutlivesBounds`).
  - `traits/select/mod.rs` 22/67: `new`, `typing_mode`, `with_query_mode`, `tcx`, `IntercrateAmbiguityCause`'s 2 methods,
    and the helper impls at the end (`TraitObligationStack` 4, `ProvisionalEvaluationCache` 6, `TraitObligationStackList`
    5, the manual `Debug`).
  - the whole **rustc_traits** crate 28/28 (9 files): `provide` is wired in `rustc_interface/passes.ts` at upstream's
    position (after `rustc_passes::provide`, before `rustc_ty_utils::provide`).
- **rustc_middle query keys** (only edit there): `KEY_CanonicalPredicateGoal` (keys.rs:337) and
  `KEY_CanonicalImpliedOutlivesBoundsGoal_bool` (keys.rs:343), via generic builders over the instance's `Debug`;
  `tools/codegen/queries.config.json` maps both; `queries.gen.ts` regenerated (6 lines). The other canonical goals stay
  `key_unported` (the lanes that need them add a `KEY_<goal>` the same way).
- **Repointed stand-ins** (one implementation per upstream fn): engine.ts (`FulfillmentEngine::Old` →
  `FulfillmentContext.new`, `from_old` getters, `OldSolverError` type), normalize.ts (`SelectionContext` view and the
  4 `pending_project_*` → select/mod.ts / project.ts), wf.ts (`pending_SelectionContext_new`,
  `compute_inherent_assoc_term_args`), effects.ts (local `SelectionContext` interface), coherence.ts
  (`IntercrateAmbiguityCause` type), specialize/mod.ts + rustc_hir_analysis coherence/inherent_impls_overlap.ts
  (`IntercrateAmbiguityCause_add_intercrate_ambiguity_hint` stand-in → `IntercrateAmbiguityCause.add_intercrate_ambiguity_hint`),
  traits/mod.ts (`pub mod` / `pub use` lines of fulfill, project, select, query, implied_outlives_bounds, vtable,
  outlives_for_liveness, auto_trait; `TypeErrCtxtView` gained `report_overflow_obligation` and
  `report_overflow_obligation_cycle`).

## Split table (wave 18b; each ≤ ~3k upstream lines)
| lane | upstream (compiler/rustc_trait_selection/src/traits/) | lines | TS | fills |
|---|---|---|---|---|
| old-select-a | select/mod.rs:205..1709 | ~1500 | select/mod.ts | the 28 `SelectionContext` methods `poly_select` .. `match_projection_projections` (decls.ts group "mod.rs:180"; the first block of `unported_methods`) |
| old-select-b | select/mod.rs:1710..2797, select/_match.rs | ~1220 | select/mod.ts, select/_match.ts | `winnow_candidates`, `prefer_lhs_over_victim`, the 15 helpers `sizedness_conditions` .. `should_stall_coroutine` (second block); `MatchAgainstFreshVars` (`new` + 7 `TypeRelation` methods) |
| old-candidates-confirm | select/candidate_assembly.rs, select/confirmation.rs | 2881 | select/candidate_assembly.ts, select/confirmation.ts | 27 + 22 `SelectionContext` methods (incl. the local `flatten_answer_tree`) |
| old-project | project.rs | 2228 | project.ts | `ProjectionCandidateSet` (3), `Progress` (2), the 6 pub stubs, `ProjectionCacheKey_from_poly_projection_obligation`, the 24 private fns listed in the file |
| old-query-typeops | query/{normalize,dropck_outlives}.rs, query/type_op/{mod,custom,ascribe_user_type,normalize,outlives,prove_predicate}.rs | ~1480 | query/** | `query_normalize` + `QueryNormalizer` (6) + `MaxEscapingBoundVarVisitor` (4); dropck_outlives (4); type_op: `fully_perform_into`, `TypeOp_ParamEnvAnd`, `CustomTypeOp` (new, fully_perform, Debug), `scrape_region_constraints`, the `QueryTypeOp_*` descriptors (try_fast_path/perform_query), `Normalizable_*`, `type_op_ascribe_user_type_with_span` (+2 private), `type_op_prove_predicate_with_cause` |
| old-vtable-liveness (optional, M4 consumers) | vtable.rs, outlives_for_liveness.rs | 1025 | vtable.ts, outlives_for_liveness.ts | 10 + 8 fns; then uncomment `vtable::provide` and the 2 `outlives_for_liveness` providers in traits/mod.ts `provide` |
| (done here) | fulfill.rs, query/evaluate_obligation.rs, implied_outlives_bounds.rs, select/mod.rs helpers, obligation_forest, rustc_traits | | | |
| (no lane in M3) | auto_trait.rs (rustdoc only) | 915 | auto_trait.ts | stub |

Order: old-select-a/-b and old-candidates-confirm unblock most typeck stops (`poly_select`); old-project unblocks
`normalize` under the old solver; old-query-typeops is needed by `query_normalize` (normalize_erasing_regions) and NLL.

## How to fill a stub
1. `SelectionContext` methods: the signature is in `src/rustc_trait_selection/decls.ts` under `// traits/select/<file>:<line>`.
   Assign `SelectionContext.prototype.<name> = function (this: SelectionContext, ..) { .. };` in the mirrored module, in
   upstream order, marker `// rustc: compiler/rustc_trait_selection/src/traits/select/<file>:<line> <name>` directly above,
   then delete the name from that module's `unported_methods` list (the call when empty). `contract.test.ts` (rustc_infer)
   checks each declared method is a function and a placeholder names its own module.
2. Free fns / companions / descriptors: replace the stub body (comment `// <file>:<line> (stub)`) with the port and turn
   the comment into the `// rustc:` marker. Keep the signature; a wrong one goes in your handoff (or a local
   `declare module` marked `// PORT(decls): pending root`).
3. Private fns: module-local functions in upstream order (each module lists them).
4. Types are generated (set `rustc_trait_selection_old_solver`); fix maps in `tools/codegen/old_solver.typemap.json` and
   regenerate with `bun tools/codegen/types.ts rustc_trait_selection_old_solver` (root-reviewed data).
5. Init order: a module's top-level code touches only its `.gen.ts` and other crates; read this crate's other modules in
   function bodies (lazy `require` where a static import would close a load-time cycle, e.g. `../mod.gen.ts` values).
   Every module here loads as a fresh entry point (checked).
6. Representation notes: `TraitObligationStackList` is a mutable hand class (`head_`; `next()` mutates — copy with
   `clone_TraitObligationStackList` where Rust copies); `ProvisionalEvaluationCache.map` is a `KeyedMap` on `intern_key`;
   `ProjectionCandidateSet` methods and `candidate_set` params take `MutRef<ProjectionCandidateSet>`;
   `check_recursion_depth` / `check_recursion_limit` take the `Upcast` fn of `T`/`V` last.

## Coverage (bun scripts/coverage.ts)
- obligation_forest mod.rs 29/29, graphviz.rs 9/9, tests.rs 15/15; rustc_data_structures 466/960.
- fulfill.rs 24/24, query/evaluate_obligation.rs 7/7, implied_outlives_bounds.rs 7/7, select/mod.rs 22/67; every other
  file of the scope 0 (stubs). rustc_trait_selection 378/976 (was 318).
- rustc_traits 28/28 (new crate). TOTAL 14610/25518 (was 14467).

## Checks
- `bunx tsc --noEmit -p .` clean; `bun scripts/coverage.ts --check` markers ok (15129).
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 5102 pass, 1 skip, 0 fail.
- Samples, lane vs base 4447fa3 (same args, base in a temporary worktree):
  - tydump-minicore (46): 5 MATCH / 0 DIFF / 41 UNPORTED both (runs 20261015-083047-selcx-contract-9ogb /
    -083100-selcx-base-r4jx). Stops: base 27× `FulfillmentContext::new (old solver, wave 20)` → lane 24×
    `rustc_trait_selection::traits::select::SelectionContext::poly_select`, 2× `check_unused_traits provider` (typeck
    completes), 1× `QueryKey for PseudoCanonicalInput<Ty>`; rest unchanged.
  - tydump-nocore `--sample 100 --seed selcx`: 19/0/81 both (k7rp / iaft). 5× `QueryKey for (CanonicalImpliedOutlivesBoundsGoal, bool)`
    → `rustc_middle::mir::ConstraintCategory (mir, M4): BoringNoLocation` (the provider now runs to
    `make_query_region_constraints`; `ConstraintCategory` is rustc_infer infer/mod.ts's M4 stand-in).
  - hir-tree-nocore `--sample 100 --seed selcx`: 99/0/1 both, no status change.

## Re-pinned tests (no matching assertion weakened)
- `src/rustc_infer/contract.test.ts`: decl count 29 → 127 (the `SelectionContext` contract); the "placeholders stop as
  UNPORTED" example moves from `predicate_may_hold` (ported) to `At::query_normalize` (stub).
- `src/rustc_hir_analysis/{coherence,variance_outlives}.test.ts`, `check/{wfcheck_a,wfcheck_b,compare_eii}.test.ts`,
  `check/compare_impl_item.oracle.test.ts` (refine_rpitit): the pinned stop `QueryKey for (CanonicalImpliedOutlivesBoundsGoal, bool)`
  → `rustc_middle::mir::ConstraintCategory (mir, M4): BoringNoLocation`.
- New (review-w17, MED): `src/rustc_trait_selection/traits_a.test.ts` comment fixed (the next solver is the default only
  for bare rustc; compiletest-argv suites pass `-Znext-solver=coherence`), plus
  (a) `next_trait_solver_globally = false`: `ObligationCtxt::new` / `new_with_diagnostics` on a non-coherence `InferCtxt`
  use `FulfillmentEngine::Old` with a `FulfillmentContext`; registering `?0: Trait` leaves 1 pending obligation and
  `try_evaluate_obligations` reaches the forest → `SelectionContext::poly_select` (pinned stop);
  (b) globally = true with `with_next_trait_solver(false)`: `ObligationCtxt::new` panics with "using old solver even though
  new solver is enabled globally".
- New: `src/rustc_data_structures/obligation_forest/tests.test.ts` (upstream tests.rs, 7 tests).

## `unported(...)` left
- Placeholders: `SelectionContext` 45 (mod.rs) + 27 (candidate_assembly) + 22 (confirmation); `MatchAgainstFreshVars` 8;
  project.rs 3 + 2 + 7 stubs; query: `query_normalize`, `QueryNormalizer` 6, dropck_outlives 4, type_op (mod 2,
  custom 4, ascribe 3, normalize 7 incl. `d_Self` of `Normalize<T>`, outlives 2, prove_predicate 3); vtable 4;
  outlives_for_liveness 4; `AutoTraitFinder` 11.
- In ported code: obligation_forest `dump_graphviz` (rustc_graphviz not ported; only with `DUMP_OBLIGATION_FOREST_GRAPHVIZ`)
  and `dot::Id::new`; rustc_traits codegen.rs `ImplSource<()>: TypeFoldable` (derive not generated; the provider's key is
  `key_unported` anyway); coroutine_witnesses reads `mir_coroutine_witnesses` (M4, typed through a local view of
  `CoroutineLayout.field_tys`).
- Generated: `AutoImplConstituents` folds `ArgOutlivesClause` with `unported_type_fold` (no type_fold.json entry).
- Reached through the error-reporting view (wave 19): `err_ctxt(..).report_overflow_obligation` (fulfill.rs overflow arm),
  `report_overflow_obligation_cycle` (normalize_projection_ty, codegen).

## PORT decisions (please record)
1. Old-solver contract layout: `SelectionContext` is a generated class whose methods are declared in
   rustc_trait_selection/decls.ts; other files' pub fns are signature-typed stubs in their own modules; codegen set
   `rustc_trait_selection_old_solver` + `old_solver.typemap.json`.
2. obligation_forest: `O: ForestObligation` is a descriptor stored in the forest; `as_cache_key` returns the canonical key
   (`string | number`), so the caches are plain `Map`/`Set`; the processor's associated `OUT::new()` is `OUT_new()`.
3. `FulfillmentContext<E>` carries `E`'s `FromSolverError<OldSolverError>` descriptor in place of `PhantomData<E>`
   (as the next solver's `FulfillmentCtxt`); engine.ts's `FulfillmentErrorKinds_*.from_old` are lazy getters.
4. `TraitObligationStackList` hand class (`head_`, mutating `next()`); `ProvisionalEvaluationCache.map` `KeyedMap`.
5. type_op traits as D4 descriptors (`QueryTypeOp<Q, QR>`, `TypeOp<Op, Output, ErrorInfo>`, `Normalizable<T>`).
6. Generic `QueryKey` impls of canonical inputs are per-instance `KEY_<goal>` values built from the instance's `Debug`.
7. `ParamEnvAnd<T>`'s derived `TypeFoldable` is `src/rust_ts/fold_param_env_and.ts` (`fold_ParamEnvAnd(d_T)`) until
   rustc_middle ty/mod.rs gets generated derives (root: move it there).

## For root
- Shared files edited (review): rustc_trait_selection `decls.ts`, `lib.ts`, `traits/{mod,engine,normalize,wf,effects,coherence}.ts`,
  `traits/specialize/mod.ts`, `traits/query/{evaluate_obligation,normalize}.ts`; rustc_hir_analysis
  `coherence/inherent_impls_overlap.ts`; rustc_middle `query/keys.ts` + regenerated `queries.gen.ts`; rustc_interface
  `passes.ts` (rustc_traits wiring); `tools/codegen/{types.sets.json (appended), queries.config.json (2 keys),
  old_solver.typemap.json (new)}`; the re-pinned tests above.
- `ConstraintCategory` (rustc_middle mir, M4) is now the stop of every implied-bounds query (5/100 tydump-nocore); it is a
  stand-in in rustc_infer infer/mod.ts / rustc_middle traits/mod.ts — a small-gaps item if the `BoringNoLocation`
  value can be represented without MIR.
- Coordination: `fnctxt-contract` (rustc_hir_typeck) was not touched; `small-gaps-18`: my rustc_middle edits are the two
  keys only. The other canonical goals (`CanonicalAliasGoal`, `CanonicalDropckOutlivesGoal`, `CanonicalTypeOp*Goal`,
  `CanonicalMethodAutoderefStepsGoal`) still need `KEY_<goal>` values (same builder) when their providers matter.
- A compare_impl_item oracle test rewrites `check/compare_impl_item_oracle/cases/librefine_rpitit.rlib` on every run
  (tracked file); restored here — consider gitignoring it as merge-w17 did for check_oracle.
