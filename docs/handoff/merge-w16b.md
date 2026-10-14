# Handoff: merge-w16b (fixer): rustc_infer fill lanes, tydump-subject, rds-graph, passes-a, passes-b, variance-outlives

Worktree `.data/integ`, branch `integ`, based on main `816b5c5`. Every merge is `git merge --no-ff lane/<name>`, in this
order:
1. infer-core
2. infer-relate
3. infer-regions
4. infer-canonical-outlives
5. infer-opaque-snapshot
6. tydump-subject
7. rds-graph
8. passes-a
9. passes-b
10. variance-outlives

Root added steps 7-10 while this lane was running. Each merge and each fix is its own commit; see
`git log --first-parent 816b5c5..integ`.

## Merge resolutions
- **at.ts `PORT(decls): pending root`.** infer-relate already puts `relate` on `TypeRelating.prototype` and
  `LatticeOp.prototype` (`TypeRelation_provided.relate`), next to the interfaces in its own files. at.ts's local
  `declare module` augmentation is deleted.
- **`SsoHashMap -> Map`.** I regenerated set `rustc_infer` after infer-relate's typemap change. It produced no further
  diff, because infer-relate had already regenerated it. infer-canonical-outlives' two `PORT(merge)` casts in
  canonicalizer.ts are gone; `sub_root_lookup_table` is the generated `Map<TyVid, number>`.
- **`extract_verify_if_eq`.** lexical_region_resolve/mod.ts calls `test_type_match.extract_verify_if_eq`, as upstream's
  `use super::outlives::test_type_match` does. The stand-in is deleted.
- **contract.test.ts.** No contract placeholders are left after the five infer lanes (0 of 344 declarations), so the
  count check is now `expect(stubs).toBe(0)`. That is stronger than both lanes' versions (`> 0` and `<= decls.length`).
  The `next_ty_var` / `with_log` UNPORTED assertions are gone, since both are ported. The `can_eq` stop (wave 17) stays.
- **Lane test shims deleted. Every test now runs against the real ports:**
  - infer_regions.test.ts: the `SubregionOrigin.span` stand-in is gone. `lub_regions` of two params now asserts the
    real fresh var and its `Misc` origin instead of the UNPORTED stop.
  - infer_canonical_outlives.test.ts: `shim()` is gone.
  - infer_relate.test.ts: the `spyOn` shims are gone.
  - opaque_snapshot.test.ts: the `standin`s are gone, along with the vacuous "placeholders still stop" test.
  - infer_core.test.ts:
    - `serve_cx` is gone.
    - The `raw` ops now call the real `*_raw` methods and `InferCtxt::probe`.
    - The 3 `fork` oracle lines are checked strictly. All 62 of 62 lines match.
- **tydump-subject's tyir.typemap.json change** (`I::BoundVarKinds` Debug → `debug_BoundVarKinds`): **kept.**
  - Upstream `Binder` is `#[derive_where(Debug)]` over `{ value, bound_vars }`.
  - `BoundVarKinds` is `&List<BoundVariableKind>`, whose Debug is list.rs:192 `(**self).fmt(f)`, the slice Debug. That
    is exactly `debug_RawList(v, f, debug_BoundVariableKind)`.
  - Fix on top of it: list.ts's static value import of rustc_type_ir binder.gen.ts broke a fresh-process load of
    `src/rustc_next_trait_solver/lib.ts` (`Cannot access 'RawList' before initialization`). This also happens on
    lane/tydump-subject alone. list.ts now reads binder.gen.ts lazily (`require`, the `middle_predicate()` precedent).
    Fresh loads of the rustc_middle, rustc_type_ir, rustc_infer, rustc_next_trait_solver, rustc_hir_analysis,
    rustc_trait_selection, rustc_ast_lowering and rustc_driver_impl `lib.ts` files are all ok.
- **passes-a / passes-b:**
  - `rustc_passes/lib.ts` is the union of the module lists and `provide` lines (delegation, check_attr, check_export,
    diagnostic_items, eii, entry, lib_features, stability).
  - passes-b's copies of `lib_features.ts` and `middle/mod.ts` were byte-identical to passes-a's: no diff.
  - `mod_a_test/lower.expected.txt` takes passes-b's `probe_assoc_item(C, Const, Tr): Some(C)` and keeps infer-core's
    `can_eq` stop for `probe_traits_that_match_assoc_ty`.
  - The new set `rustc_passes_check_attr` is kept and regenerated (no diff).
- **variance-outlives** merged without conflicts. Its re-pins are kept: `collect_b.test.ts`, the `contract.test.ts`
  provider count (45), and `ty.expected.txt`. Its own test is tightened:
  - `PENDING_FACTS` is now empty. tydump-subject's `EarlyParamRegion` and `Binder.bound_vars` Debug impls are merged,
    and every fact matches.
  - `transitive_bounds_that_define_assoc_item` is dropped from `PENDING_DUMP`; infer-opaque-snapshot ported it.
  - tydump_dump.ts's prefix now calls the real `outlives::dump::inferred_outlives` and `variance::dump::variances`.
    Their stand-ins are gone.

## Codegen requests and repoints
- **`AliasTerm` / `ParamEnv` Debug:**
  - middle_traits_thir.typemap.json: `rustc_middle::ty::AliasTerm` now uses the hand alias `debug_AliasTerm`, which is
    new in rustc_type_ir/ty/alias.ts and equals `debug_Alias(v, f, debug_AliasTermKind)`.
  - tyir.typemap.json: `I::ParamEnv` is imported from rustc_middle/ty/mod.ts and uses `debug_ParamEnv`.
  - Regenerated output: `ProjectionCacheKey`, `CanonicalParamEnvCacheEntry`, `QueryInput`/`Goal` (solve/mod.gen.ts),
    `TypeError::Aliases`, and hir_ty_lowering's `AssocItem` now print through them.
- **`ParamEnv` TypeVisitable / TypeFoldable.**
  - The hand derives in rustc_middle/ty/mod.ts now visit and fold `caller_bounds` through `fold_Clauses`, replacing the
    `unported` stubs.
  - As a result, `canonicalize_query` runs and is compared directly with the probe's two `query` cases. Both match.
  - The nts `canonicalize_input` runs too. In nts_canonical.test.ts, the "stops UNPORTED at the ParamEnv traversal"
    test is now a real check: it gives the same canonical value as the oracle-checked predicate canonicalizer.
  - In nts_eval.test.ts, "a goal without a fast path..." used a `{}` param env.
    - It now uses `ParamEnv.empty()`, a fake tcx with real `GlobalCaches` and a disabled `DepGraph`, and the provided
      `obtain/release_canonicalizer_state`.
    - It asserts the goal is canonicalized and reaches `D::build_with_canonical` with the expected canonical input.
- **`clone_ProjectionCacheStorage`** is real: infer-opaque-snapshot hand-wrote it with a `KeyedMap`. infer_core's fork
  lines match, see above.
- **`fn_sig_skip_binders`.**
  - delegation/resolution.ts and delegation/mod.ts call
    `Binder.skip_binder(EarlyBinder.skip_binder(tcx.fn_sig(id)))` and the `FnSig` companion (`inputs`, `output`,
    `c_variadic`, `safety`, `abi`).
  - The `Ty_super_visit_with` stand-in now calls `fold_Ty.super_visit_with`.
  - `hir-tree-nocore --filter delegation/`: **44 MATCH / 0 DIFF / 100 UNPORTED** (it was 36 / 108). 99 cases now stop
    at `codegen_fn_attrs provider (not ported)` and 1 at `shallow_lint_levels_on`.
- **rds-graph repoints**, from that lane's list:
  - decls.ts's `TransitiveRelation` is the real class.
  - tyir.typemap.json: `TransitiveRelation` Debug and Clone are real.
  - infer.typemap.json: `Sccs` is `Sccs<$0, $1>`.
  - leak_check.ts calls `VecGraph.new` / `Sccs.new`; the view is gone.
  - free_regions.ts reads the relation directly.
  - env.ts uses `TransitiveRelationBuilder`, so `from_normalized_bounds` runs.
  - region_constraint.ts: all stand-ins are gone, and `Assumptions::empty` runs.
  - solver_region_constraints.ts calls `TransitiveRelationBuilder.default().freeze()`.
  - The same stand-ins were also repointed in obligations.ts (`destructure_solver_region_constraints_for_{regionck,
    borrowck}`) and in mod.ts (`insert_placeholder_assumptions`' `base_edges` assert).
  - Flipped tests now use the real results:
    - tyir_misc_region_constraint: `Assumptions::empty`. Its `TestRelation` was replaced by
      `Assumptions::new_unelaborated(vec![], builder.freeze())`, as the oracle did, and the hashbrown `base_edges`
      order reproduces the oracle strings.
    - infer_relate: `enter_forall_with_empty_assumptions` records the empty assumptions and calls `f`.
    - infer_regions:
      - a real relation for `sub_free_regions` / `lub_param_regions`;
      - real `from_normalized_bounds`;
      - real SCCs in every leak-check test;
      - the former "stops at VecGraph::new" case now expects `placeholder_error(!1, !0)`.
- Every codegen set except `rustc_lexer` was regenerated (`rustc_lexer` is excluded, as merge-w15b noted), and
  `queries.ts` too (no change). The only generated diffs are the ones listed above.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (14276). TOTAL 13757/25518 (53.91%). rustc_infer 644/644; transitive_relation,
  graph/scc, check_attr, stability, entry, delegation and sync/parallel are all complete.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools` at 4e0ff56: **4938 pass, 1 skip (the pre-existing linux-only test), 0 fail** (4939 tests, 307 files). It was also green at ecbdf7c: 4931 pass, 1 skip, 0 fail.
- Difftests at 4e0ff56, `--seed m16b` (integ against main 816b5c5, same seed):

| suite | integ | main |
|---|---|---|
| parse 200 | 200 MATCH | — (no UNPORTED possible) |
| expanded 200 | 198 MATCH / 0 DIFF / 2 UNPORTED / 0 CRASH | 198 / 0 / 2 |
| hir-tree-nocore 300 | 295 / 0 / 5 / 0 | 295 / 0 / 5 |
| unpretty-hir 200 | 196 / 0 / 4 / 0 | 196 / 0 / 4 |

  The UNPORTED id sets are identical to main's: no new UNPORTED. The delegation cases among them now stop at
  `codegen_fn_attrs` instead of `fn_sig`.
- **tydump** (after passes-a, passes-b and variance-outlives; the counts did not change with variance-outlives):
  - `tydump-nocore --sample 300 --seed m16b`: **46 MATCH / 0 DIFF / 254 UNPORTED**. Stops:
    - 236 `check_type_wf provider`;
    - 7 `shallow_lint_levels_on`;
    - 3 `effective_visibilities provider`;
    - 3 `check_proc_macro` (wave 17);
    - 3 `BangProcMacro::expand` (M6);
    - 2 `codegen_fn_attrs provider`.
  - `tydump-minicore` (all 46): **5 MATCH / 0 DIFF / 41 UNPORTED**. Stops:
    - 36 `check_type_wf`;
    - 2 `StableHash without a TS impl` (loading `--extern mini_core`);
    - 2 `shallow_lint_levels_on`;
    - 1 `effective_visibilities`.

## unported / views left (not this lane's)
- infer-core: `SubregionOrigin::to_constraint_category` (mir `ConstraintCategory`, M4), and the
  `deeply_resolve_via_region_graph` bug message (no Debug of `T` in a D4 descriptor).
- infer-canonical-outlives: `erase_and_anonymize_regions`, `mir::ConstraintCategory`, and `QueryRegionConstraint`'s
  generated fold/Debug.
- infer-regions: `display_GenericKind`'s `Placeholder` arm (`IR_PRINT` has no `Placeholder` slot). The
  rustc_data_structures views are all repointed now.
- passes-b: `check_proc_macro`, `shallow_lint_levels_on` (rustc_lint HIR levels), `effective_visibilities`, and the
  `hir_get_parent_item` stand-in in rustc_middle/middle/stability.ts:305 (a one-line repoint for its owner).
- passes-b's suggestion was not done: point `rustc_passes::check_attr::ProcMacroKind` in typemap.passes.json at
  check_attr.ts.

## PORT decisions (please record)
1. `TypeRelation::relate` on `TypeRelating` / `LatticeOp` is infer-relate's prototype method. at.ts no longer declares
   it.
2. `ParamEnv` (a hand class) has its derived `TypeVisitable` / `TypeFoldable` written out in ty/mod.ts over
   `fold_Clauses`, in the generator's shape.
3. Hand Debug aliases named by type maps: `debug_AliasTerm` (rustc_type_ir/ty/alias.ts) and `debug_BoundVarKinds`
   (list.ts). list.ts reads binder.gen.ts lazily for load order.
4. `TransitiveRelation` clones through `$v.clone()` (the derived Clone). Earlier hand clones (at.ts / mod.ts
   `clone_Assumptions`) still share the frozen relations.
5. `insert_placeholder_assumptions`: the `.all()` over `base_edges()` visits both regions of each edge (the tuple's
   `TypeVisitable`) and panics with the relation's Debug.
6. Since `stubs === 0` holds after wave 16, contract.test.ts now requires every rustc_infer contract declaration to be
   real.
