# Handoff: merge-w18c (fixer, old-solver integration on `integ-old`)

Branch `integ-old` (from integ 60a45cf + root's merges of old-select-a/-b, old-candidates-confirm, old-project,
old-query-typeops, HEAD 4ef2d8b9 at start). Commits (in order): b4b5f8ff (query keys), 3be737aa (old_solve.test.ts + the
4 test reworks), 43a8edb1 (ConstraintCategory, QueryRegionConstraint folds, ImplTraitHeader decode), 2f0a4c8a
(build_overflow_error, unreachable texts), 4144e02c (re-pins after ConstraintCategory), 8e20659d (more old-solver cases).

## Fixes
1. **QueryKeys of the old solver's canonical goals** (tools/codegen/queries.config.json `keys` + `KEY_<goal>` in
   src/rustc_middle/query/keys.ts via `canonical_query_input_key`, queries.gen.ts regenerated): `CanonicalAliasGoal`,
   `CanonicalDropckOutlivesGoal`, `CanonicalTypeOpAscribeUserTypeGoal`, `CanonicalTypeOpProvePredicateGoal`,
   `CanonicalTypeOpNormalizeGoal<{Ty,Clause,PolyFnSig,FnSig}>`. `CanonicalMethodAutoderefStepsGoal` (typeck's
   method probe) is left `key_unported` for the typeck-gaps lane (avoids a keys.ts conflict).
   The "wrong label `(LocalExpnId, &TokenStream)`" reported by old-query-typeops is **not a codegen bug**: every
   `key_unported(..)` in queries.gen.ts carries its own key text; that string is just the first entry of the
   generator's report (`unported_keys`), and the runtime message read `QueryKey for \`CanonicalAliasGoal<'tcx>\``.
2. **`mir::ConstraintCategory`** (was the top stop: 30/46 minicore cases, 14/300 tydump-nocore): new codegen set
   `rustc_middle_mir_query` (types.sets.json) generates src/rustc_middle/mir/query.gen.ts with only `ConstraintCategory`,
   `ReturnConstraint`, `AnnotationSource` (+ the `CoroutineSavedLocal` newtype the file declares); the other types of
   mir/query.rs are skipped until M4. Hand module src/rustc_middle/mir/query.ts re-exports it.
   `ObligationCause::to_constraint_category` (rustc_middle traits/mod.ts) and `SubregionOrigin::to_constraint_category`
   (rustc_infer infer/mod.ts; decls.ts signature) now return the upstream values instead of `unported`.
   infer.typemap.json maps `rustc_middle::mir::ConstraintCategory` to it; type_fold.json gains `ConstraintCategory`,
   `ty::RegionConstraint` and `ty::ArgOutlivesClause` (named folds `visit_with_ArgOutlivesClause` /
   `try_fold_with_..` / `fold_with_..` added to src/rustc_middle/ty/predicate.ts). Regenerated: infer/canonical.gen.ts
   (`QueryRegionConstraint(s)` now fold/visit/Debug for real) and traits/select/mod.gen.ts (`AutoImplConstituents`'
   `assumptions` fold, the old-select-b handoff's open item). Sets rustc_ty, rustc_middle_traits_thir, rustc_hir_analysis,
   rustc_trait_selection_traits_a, rustc_hir_typeck, rustc_trait_selection_old_solver regenerated: no other change.
3. **`Decodable for ty::ImplTraitHeader`** (3 minicore cases with `extern crate core`-style metadata; old-solver impl
   candidate assembly reads `impl_trait_header` of extern impls): added to the rustc_middle set's `decodable_types` /
   `decodable_construct` (`new ImplTraitHeader($0..$3)`), serialize.json entries for `ty::EarlyBinder`, `ty::TraitRef`,
   `rustc_type_ir::ImplPolarity`; decodable.gen.ts regenerated; cstore_impl.ts `impl_trait_header` uses it.
4. `TypeErrCtxtView.build_overflow_error` added (traits/mod.ts); query/normalize.ts's local `OverflowErrCtxtView` dropped.
5. `unreachable!` texts in std form: fulfill.ts:209 (`internal error: entered unreachable code: old solver coherence`)
   and fulfill.ts:541 (`.. unexpected higher ranked \`UnstableFeature\` goal`). Other old-solver files already used it.

Cross-crate files touched: rustc_middle (query/keys.ts, queries.gen.ts, mir/query{,.gen}.ts, traits/mod.ts,
ty/predicate.ts, infer/canonical.gen.ts, decodable.gen.ts), rustc_infer (decls.ts, infer/mod.ts), rustc_metadata
(rmeta/decoder/cstore_impl.ts), tools/codegen (queries.config.json, types.sets.json, infer.typemap.json, type_fold.json,
serialize.json).

## Test reworks (with justification)
- **New `src/rustc_trait_selection/traits/old_solve.test.ts`** + `traits/old_solve_test/{probe.rs,run.ts,old.rs,*.stdout}`:
  a rustc-dev probe (as solve_test/probe.rs) that runs rustc's own old solver with `-Znext-solver=coherence` on
  `#![no_core]` crates (solve_test's goals.rs / proj.rs and a new old.rs) and prints per goal `evaluate_root_obligation`,
  the `evaluate_obligation` query, `query_normalize`, `poly_select` (trait clauses), `normalize_projection_term`
  (projection clauses), then the old `FulfillmentContext`'s `try_evaluate_obligations` / pending / `collect_remaining_errors`
  / resolved args. run.ts prints the same from the port. 5 runs (fast paths on/off), **every case equals the oracle
  exactly** (no PENDING): impl / param-env / builtin Sized+Copy / auto-trait (incl. a coinductive cycle) / object (with a
  supertrait) candidates, ambiguity on inference variables, projection via impls and param env, mismatch errors.
- old_select_a.test.ts:101 (`?0: Trait` pinned at `push_stack`): stop assertion removed; the region-outlives
  `evaluate_root_obligation` assertion stays; trait goals are covered by old_solve.test.ts against the oracle (the mock
  `TyCtxt` has no caches/queries).
- traits_a.test.ts:236 (old `FulfillmentContext` pinned at `push_stack`): registration assertions kept; processing is
  covered by old_solve.test.ts (`?0: Tr` stays pending, then `Ambiguity`).
- project.test.ts:164 (pinned `for_each_item_bound`): its only purpose was the stop; replaced by a comment pointing to
  old_solve.test.ts, which runs `normalize_projection_term` -> `opt_normalize_projection_term` against the oracle.
- assembly_confirm.test.ts:203: now asserts `confirm_candidate(SizedCandidate)` of `u32: Sized` is
  `Ok(Builtin(Misc, []))` (confirmation.rs:41 + select/mod.rs:2031 `Uint` arm -> no nested types); tuples are in the
  oracle fixtures.
- Re-pins after ConstraintCategory (each now an oracle match or a value derived from upstream; no assertion weakened):
  infer_core.test.ts (`to_constraint_category` arms: BoringNoLocation / Predicate / SolverRegionConstraint);
  coercion.test.ts `mut_ref_to_ref_with_unsize` -> `true` (oracle-checked); query_typeops.test.ts CustomTypeOp -> one
  `RegionConstraint::Eq` between the two vars, `BoringNoLocation`, leak-check `Yes`; wfcheck_a.test.ts (gat/marker/unused
  `wf` now NOW_EXACT; the `lint`-mode gat.rs case removed: lint mode never runs `check_associated_item`, whose receiver
  check emits the oracle's second error, while `wf` mode prints both); wfcheck_b.test.ts (+ its run.ts now calls
  `check_associated_item` on impl items as check.rs:1124 does; receiver.rs E0307 is NOW_EXACT); compare_impl_item
  refine_rpitit (in-process now equals the oracle; the guard accepts the lint case's warning, exit 0); stale
  ConstraintCategory PENDING entries removed from variance_outlives / coherence / check_region_intrinsic tests (those
  cases now match).

## Samples (before = HEAD 4ef2d8b9, after = 8e20659d / 4144e02c)
| suite | before | after |
|---|---|---|
| tydump-minicore (46, full) | 14 / 0 / 32 | 14 / 0 / 32 (no MATCH lost; stops moved, below) |
| thirdump-minicore (46, full) | 14 / 0 / 32 | 14 / 0 / 32 (same) |
| tydump-nocore `--sample 300 --seed m17` | 262 / 0 / 38 | **276 / 0 / 24** (+14, none lost) |
| hir-tree-nocore `--sample 200 --seed m18c` | 200 / 0 / 0 | 200 / 0 / 0 |
(MATCH / DIFF / UNPORTED; no CRASH/TIMEOUT.) Runs: `$RUST_TS_DATA/runs/{20261015-094507-merge-w18c-6wvx,
20261015-094520-merge-w18c-v6m0, w18c-before-tydump-nocore, w18c-before-hirtree, w18c-after-tydump-mc,
w18c-after-thir-mc, w18c-after-tydump-nocore, w18c-after-hirtree}`. No DIFF anywhere.

Note: the brief's base numbers (top stop 24x `poly_select`) are pre-merge; on integ-old HEAD the minicore top stop was
already 30x `ConstraintCategory`.

## Remaining top stops (after), by case count
tydump-minicore / thirdump-minicore (identical):
1. 23x `rustc_hir_typeck::fn_ctxt::suggestions::FnCtxt::fn_sig` (typeck-gaps)
2. 3x `TypeFoldable for rustc_middle::ty::typeck_results::UserType` (2x write_user_type_annotation_from_args, 1x
   "derive not generated", from gather_locals; typeck / typeck_results codegen)
3. 1x each: `error_reporting::InferCtxt::err_ctxt` (wave 19), `Target::parse_data_layout`, `TyCtxt::mk_pat`,
   `QueryKey for PseudoCanonicalInput<Ty>` (layout_of from check_static_inhabited), `suggest_assoc_method_call`,
   `same_type_modulo_vars` (typeck)
tydump-nocore sample: 8x parse_data_layout, 6x const_eval_resolve_for_typeck, 4x IntegerExt::from_int_ty, 4x
`get_adt_def` (ReprOptions decode), 1x thir_abstract_const, 1x IntegerExt::to_ty.
No old-solver / trait-selection stop is left in these samples except `err_ctxt` (wave 19).

## Checks
- `bunx tsc --noEmit -p .` clean; `bun scripts/coverage.ts --check`: markers ok (16340). Coverage: rustc_trait_selection
  561/976, rustc_middle 2154/3369, TOTAL 15821/25518.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools --timeout=120000` (at 8e20659d): 5271 pass, 5 fail, all from the known
  unrelated set: privacy clean_pub, collect_test generics/misc, lower_ty "remaining stubs", entry_test/args_main.rs (the
  other 3 known entry_test failures now pass on this branch).

## `unported(...)` left / added
None added. Removed: the 4 `ConstraintCategory (mir, M4)` stand-ins, `decode_unported("ty::ImplTraitHeader")`, 8 query
`key_unported`s.

## PORT decisions to record
1. rustc_middle mir/query.rs is generated partially (set `rustc_middle_mir_query`): only `ConstraintCategory` (+ the two
   enums it stores) until M4; the hand module mir/query.ts re-exports it.
2. `ty::ArgOutlivesClause` (a type alias) gets named fold impls in rustc_middle ty/predicate.ts
   (`OutlivesClause<A>`'s derived impls at `A = GenericArg`) for generated code; type_fold.json maps it,
   `ty::RegionConstraint` and `ConstraintCategory`.
3. Keys of generic canonical goals are one `KEY_<goal>[_<T>]` per instance (`KEY_CanonicalTypeOpNormalizeGoal_Ty`, ...),
   as selcx-contract did for `KEY_CanonicalPredicateGoal`.
4. old_solve.test.ts is the old solver's oracle test (rustc-dev probe in the test dir, not tools/probes, as solve.test.ts);
   unit tests that only pinned another lane's stop point there instead of re-pinning a mock `TyCtxt`.
5. Test harness wfcheck_b_test/run.ts `wf` mode also runs `check_associated_item` on impl items (check.rs:1124).

## For root
- Scratch outside the repo only (`/tmp/w18c`); no claims/worktrees created.
- The old-solver PORT decisions of old-select-a/-b, old-candidates-confirm, old-project, old-query-typeops are still to be
  recorded from their handoffs (unchanged by this lane).
- outlives/obligations.ts still types categories as `unknown` (compatible; can be narrowed to `ConstraintCategory`).
