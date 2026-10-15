# Handoff: merge-w17 (fixer): integrate wave 17 (trait selection, hir_analysis check/*, coherence, small gaps)

Worktree `.data/integ`, branch `integ`, based on main `3e4773f`. Not pushed; main untouched.

## Merges (in order, `--no-ff`, one commit each, plus follow-up commits)
1. `trait-sel-traits-a` (clean).
2. `trait-sel-solve`: conflicts in `rustc_trait_selection/{lib,decls}.ts`, `rustc_infer/contract.test.ts` (kept both sides; decls
   re-exports the real `ObligationCtxt`, `FulfillmentError`, `NextSolverError`, `ProofTreeVisitor`).
3. `trait-sel-traits-b`, 4. `trait-sel-traits-c`: `rustc_trait_selection/lib.ts` (union of imports, `traits/mod.ts` first).
5. `check-check`: `contract.test.ts` count. The lane had committed two oracle-run artifacts
   (`check/check_oracle/cases/lib*.rlib`); removed and added to `.gitignore` (the oracle test writes them on every run).
6. `check-wf-a`, `check-wf-b`: `wfcheck.ts` add/add resolved as both handoffs describe: a's header + imports + region (1..1139),
   b's imports minus every name a binds, b's region (1140..end); both cross-lane stand-in blocks dropped.
7. `check-compare` (clean). 8. `check-region-intrinsic`: `lib.ts` / `contract.test.ts`.
9. `coherence`: `lib.ts` / `contract.test.ts` (`coherence.provide` between `collect.provide` and `check.provide`, lib.rs:126 order).
10. `small-gaps-17`: `rustc_hir_analysis/lib.ts`, `rustc_interface/passes.ts` (pending-crate comment).

## Wiring
- `rustc_interface` `default_query_providers`: `rustc_trait_selection.traits.provide` and `.solve.provide` after `ty::provide`
  (passes.rs:920-921); `rustc_const_eval.provide` (small-gaps-17).
- `traits::provide` installs `dyn_compatibility::provide` + the 3 `specialize` providers; `vtable` and `outlives_for_liveness`
  are not ported (no lane) and stay comments. traits/mod.ts re-exports coherence / dyn_compatibility / specialize items and
  `const_evaluatable`, `effects`, `specialize`, `wf` namespaces as upstream.
- `check::provide` installs all 9 (region_scope_tree, the 2 compare_impl_item, 2 check.rs, check_type_wf, check_well_formed,
  2 destructors). `contract.test.ts` now counts 62 hir_analysis providers and asserts each check/coherence one.
- QueryKey `KEY_CanonicalInput_usize` (keys.rs:368) + `queries.config.json` entry: `evaluate_root_goal_for_proof_tree_raw`
  is a real query now; solve_test/run.ts's workaround is gone.
- `visit_proof_tree` / `visit_proof_tree_at_depth` are generic in decls.ts; all casts dropped.
- check/mod.ts loads compare_eii / entry (not lib.ts); lib.rs `check_crate` calls `outlives::dump` / `variance::dump`.

## Repoints (one implementation per upstream fn)
- trait-sel internal: engine.ts (`solve::FulfillmentCtxt`, both `FromSolverError` impls via lazy getters), normalize.ts
  (`solve::{normalize, deeply_normalize}`), regions.ts, delegate.ts (`sizedness_fast_path`, `try_evaluate_const`,
  `wf::unnormalized_obligations`, `specialization_graph::assoc_def`), derive_errors.ts (generated `FulfillmentError`),
  wf.ts / effects.ts (`normalize_with_depth_to`; the wave-20 `SelectionContext::new` stand-in is now only normalize.ts's
  exported `pending_SelectionContext_new`), dyn_compatibility.ts, coherence.ts, const_evaluatable.ts, specialize/*.
- hir_analysis: wfcheck.ts (ObligationCtxt, traits::wf, regions, misc, err_ctxt, check_item_type, Autoderef, compare_eii,
  entry), check.ts / mod.ts (wfcheck, compare_impl_item, intrinsic, always_applicable), compare_impl_item.ts / refine.ts,
  intrinsic.ts, always_applicable.ts, coherence/* (overlap, ObligationCtxt, traits::misc, check_negative_auto_trait_impl),
  autoderef.ts, entry.ts, compare_eii.ts, collect.ts (`hir_ty_lowering_dyn_compatibility_violations`, TestBinder* built,
  `suggest_impl_trait`'s candidate loop ported), collect/type_of.ts (`check_static_item`), decls.ts (FulfillmentError,
  TestBinder* re-exports), dyn_trait.ts (`expand_trait_aliases`, `object_region_bounds`), errors.ts, min_specialization.ts
  (6 of 7; `impl Elaboratable for (Clause, Span)` stays unported).
- rustc_ty_utils ty.ts / structural_match.ts (ObligationCtxt, normalize_param_env_or_error).
- rustc_passes check_attr.ts: `check_proc_macro` ported in full (its error reports are wave 19).
- **Bug fix (root's request):** `ResolverGlobalCtxt.trait_impls` is a `DefIdMap<LocalDefId[]>`; `all_local_trait_impls` yields
  `DefId` keys, `local_trait_impls` reads by `DefId`; resdump unchanged.
- **Bug fix:** wfcheck.ts `check_gat_where_clauses` passed the `FnSig` companion as its TypeFoldable descriptor (a check-wf-a
  stand-in cast); now `fold_FnSig`.
- `intrinsic.ts`'s `pending` object is now `test_hooks` (PORT(test) seam, default = the real `check_function_signature`).

## Codegen
- All sets regenerated + `queries.ts`. Only change from regeneration: `rustc_infer/infer/mod.gen.ts` (ValuePairs gets the
  real `ExpectedFound` impls, as traits-a predicted).
- `rustc_hir_analysis` set: + `check/wfcheck.rs` (5 hand types), + `infer.typemap.json` in `typemap_extra`;
  hir_analysis.typemap.json maps `ty::ClauseKind`, `SolverRegionConstraint`; type_fold.json their impls; diag_args.json
  `IntoDiagArg for ty::Region`; solver_region_constraints.ts gained `debug/visit/fold_SolverRegionConstraint` (the
  `S = Span` impls). wfcheck.gen.ts: 0 unknown types; `WithWhereClauses`' outlives vectors have no TypeFoldable (2).
- `bun scripts/probes.ts build`: all built.

## Results
- `bunx tsc --noEmit -p .` clean; `coverage --check` markers ok (14986). rustc_hir_analysis 795/799, rustc_trait_selection
  318/976, TOTAL 14467/25518.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 5093 pass, 1 skip, 0 fail (at 36078fe; 52eaae3 re-ran
  hir_analysis check + contract).
- Samples `--seed m17`, integ vs main (identical sets, no new UNPORTED): parse 200 200/0/0; expanded 200 200/0/0;
  hir-tree-nocore 300 295 MATCH / 0 DIFF / 5 UNPORTED (delegation `codegen_fn_attrs`, same on main); unpretty-hir 200
  198/0/2 (same).
- **tydump-minicore (46):** 5 MATCH / 0 DIFF / 41 UNPORTED (run 20261015-010957-merge-w17-z59t). Stops: 27 old solver
  `FulfillmentContext::new` (wave 20), 8 `codegen_fn_attrs`, 3 `check_unused_traits` provider, 2 StableHash, 1
  `Decodable for TraitDef`.
- **tydump-nocore --sample 300 --seed m17:** 49 MATCH / 0 DIFF / 251 UNPORTED (main 43/0/257, all at `check_type_wf`).
  Stops: 217 `codegen_fn_attrs provider`, 8 implied_outlives_bounds QueryKey (wave 20), 6 `LitToConstInput` QueryKey,
  5 `check_unused_traits`, 4 `erase_and_anonymize_regions`, 4 `IntegerExt::from_int_ty` (M4), 4 `Decodable AdtDefData`, ...

## Re-pins (no matching case weakened; newly matching cases are locked with "must not stop" checks)
- Now equal to the oracle / probe: solve.test fast-path + proj.rs (PENDING emptied); coherence_specialize overlap.rs, spec.rs
  41/41; coherence unsafety (check), object_overlap, inherent_dyn; check.oracle abi_cdecl and all `wf` cases but
  abi_cmse_fn_ptr; compare_impl_item e0050/e0185/e0186/e0643; wfcheck_a const_param.rs; compare_eii static_wrong_ty.rs;
  variance_outlives pending.rs; lower_ty P2; collect generics static `type_of`; ty_test `param_env(::f)`; mod_a 2 lines;
  lowering_c's 2 unit tests now assert the completed path; traits_a's ObligationCtxt test asserts the Next engine + can_eq.
- Other PENDING sets now hold exactly today's stops (see the commit messages of 909e42f.., 36078fe).

## Remaining stops worth a lane (by tydump impact)
1. `codegen_fn_attrs` provider (217/300 nocore): wfcheck `check_item_fn` / statics reach it.
2. compiletest passes `-Znext-solver=coherence` (harness/compiletest.ts), so in the ui-derived suites typeck-side
   obligations use the **old solver** (27/46 minicore): `FulfillmentContext` / `SelectionContext` / `project`.
   [Root correction, decision 4447fa3: a bare rustc at this pin defaults to `globally` (options.oracle.test.ts), so
   trait-sel-traits-a's note is right for bare runs; the old solver matters for the compiletest-argv suites.]
3. rustc_traits `implied_outlives_bounds` query (+ its `(CanonicalImpliedOutlivesBoundsGoal, bool)` QueryKey).
4. `check_unused_traits` provider (check_unused.rs, no lane), `LitToConstInput` QueryKey.
5. Small rustc_middle items: `LateParamRegionKind::from_bound`, `EarlyParamRegion::is_named`, `try_normalize_erasing_regions`,
   `erase_and_anonymize_regions`, `impl Elaboratable for (Clause, Span)` (3 unported stand-ins + wfcheck.ts's unmarked copy).
6. Wave 19 error reporting (`err_ctxt`, `report_dyn_incompatibility`, NegativePositiveConflict diag).

## PORT decisions to record
1. `FulfillmentErrorKinds_*.from_next` are getters (lazy import of solve/fulfill.ts; module cycle).
2. `ImplTraitInTraitCollector<E>` is generic over the engine's error type (upstream `<'a, 'tcx, E>`).
3. `intrinsic.ts` `test_hooks` seam (default = real fn) for the signature-recording test.
4. hir_analysis codegen uses infer.typemap.json; `SolverRegionConstraint` impls are the `S = Span` instances in rustc_infer.
5. `ResolverGlobalCtxt.trait_impls` is a `DefIdMap` (replaces the `DefId_hash_key`-keyed `[DefId, impls]` map).
6. `check::{compare_eii, entry}` are side-effect imports of check/mod.ts (private mods, used by wfcheck.ts).
