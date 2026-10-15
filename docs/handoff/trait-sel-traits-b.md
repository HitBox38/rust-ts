# Handoff: trait-sel-traits-b (M3, wave 17): rustc_trait_selection `traits/wf.rs`, `traits/dyn_compatibility.rs`

Branch `lane/trait-sel-traits-b` (from main `3e4773f`, no merges).

## Result
- **traits/wf.rs → `src/rustc_trait_selection/traits/wf.ts`: 22/22 fns.** `obligations`, `unnormalized_obligations`,
  `trait_obligations`, `clause_obligations`, `extend_cause_with_original_assoc_item_obligation`, `WfPredicates` (class
  implementing `TypeVisitor<()>`: `normalize`, `add_wf_preds_for_*`, `require_sized`, `nominal_obligations`,
  `visit_ty`, `visit_const`, `visit_predicate`), `object_region_bounds`.
- **traits/dyn_compatibility.rs → `src/rustc_trait_selection/traits/dyn_compatibility.ts`: 28/28 fns.**
  `hir_ty_lowering_dyn_compatibility_violations`, the providers `dyn_compatibility_violations` / `is_dyn_compatible` /
  `generics_require_sized_self` and their `provide`, `is_vtable_safe_method`, `dyn_compatibility_violations_for_assoc_item`,
  `virtual_call_violations_for_method`, `receiver_is_dispatchable`, `IllegalSelfTypeVisitor`, `EraseEscapingBoundRegions`
  (a `TypeFolder`), `IllegalRpititVisitor`, ...
- Nothing in a driver path calls them yet (see "For root"), so no suite output changes.
- "report_dyn_incompatibility support": `report_dyn_incompatibility` itself is error_reporting/traits/mod.rs (wave 19);
  the violations it reports (`DynCompatibilityViolation` from rustc_middle, with its `error_msg` / `solution` / `spans`)
  are what this lane computes.

## Files
- New: `src/rustc_trait_selection/traits/{wf,dyn_compatibility}.ts`.
- Edited (shared, crate root): `src/rustc_trait_selection/lib.ts` gains `import "./traits/dyn_compatibility.ts";` and
  `import "./traits/wf.ts";` under `// pub mod traits;` (merge with the other wave-17 lanes' lines; there is no
  `traits/mod.ts` yet).
- Tests: `src/rustc_trait_selection/traits/wf_dyn.test.ts` and `traits/wf_dyn_oracle/` (`cases.rs`, `dyn_e0038.rs`,
  `probe.rs` (rustc-dev program), `run.ts` (port runner), `cases.stdout` (fixture, `REGEN=1` rebuilds)).

## Tests
- **`wf_dyn_oracle/cases.rs` dump vs rustc's own functions (probe.rs, 351 lines).** 339 of the 351 lines are byte-identical; the other
  facts stop at PENDING (below). Covered:
  - dyn compatibility of 25 traits: `SizedSelf` (supertrait / where-clause spans), `SupertraitSelf`
    (`clauses_reference_self`, `bounds_reference_self`), `AssocConst(FeatureNotEnabled)`, `GenericAssocTy`,
    `StaticMethod` with both suggestions (`span_through_char`, `add_where_or_trailing_comma`), `ReferencesSelfInput` /
    `ReferencesSelfOutput` spans, `Generic`, `WhereClauseReferencesSelf` (outlives and auto-trait exemptions),
    `UndispatchableReceiver` (no `Unsize` / `DispatchFromDyn` lang items), `is_vtable_safe_method`,
    `hir_ty_lowering_dyn_compatibility_violations`, `object_region_bounds` (`'static` through elaborated supertraits);
  - `wf::obligations` / `unnormalized_obligations` of 9 type aliases (slices, tuples, refs, raw pointers, ADTs with
    where-clauses and outlives, `!`), `trait_obligations` of 6 impls (Elaborate::All with `WellFormedDerived` causes,
    supertraits, a negative impl), `clause_obligations` of 8 fn clauses;
  - hand-built types with inference variables (`?0` / `?c` cycle cases → `None`, `?int`, `&'static ?0`, a tuple at
    depth 3).
  - negative control: changing one fixture line fails the test.
- **E0038 (dyn_e0038.rs)**: the oracle emits E0038 for `type D = dyn SuperSelf;`. Not reachable: the port stops first at
  `rustc_trait_selection::traits::util::expand_trait_aliases` (hir_ty_lowering dyn_trait.ts, lane trait-sel-traits-a),
  and the report itself is `report_dyn_incompatibility` (wave 19). The test is pinned to that exact text (PENDING_E0038)
  and flips to a stderr comparison when it no longer stops.
- PENDING texts of the dump:
  - `rustc_middle::ty::region::LateParamRegionKind::from_bound` (`liberate_late_bound_regions` of a `&self` receiver);
  - `rustc_middle::ty::erase_regions::TyCtxt::erase_and_anonymize_regions` (a `Self::A` projection in a method signature);
  - `FATAL` only after one of those in the same item (the stopped query is poisoned for the run).

## `unported(..)` left
- wf.ts, `PORT(merge)` stand-ins for parallel lanes' files (root repoints at merge):
  - `rustc_trait_selection::traits::select::SelectionContext::new` (old-solver `normalize` and inherent projections);
  - `rustc_trait_selection::traits::normalize::normalize_with_depth_to` (`WfPredicates::normalize`, old solver only:
    with the next solver, the pin's default, `normalize` returns the obligations unnormalized as upstream);
  - `rustc_trait_selection::traits::project::compute_inherent_assoc_term_args` (inherent projections);
  - plus `rustc_middle::ty::Pattern: Deref (ty/pattern.rs not ported yet)` (pattern types, as rustc_middle's own stand-in).
- dyn_compatibility.ts: `rustc_trait_selection::traits::normalize_param_env_or_error` (`PORT(merge)`, lane
  trait-sel-traits-a; reached by `receiver_is_dispatchable` when both `Unsize` and `DispatchFromDyn` lang items exist).
  `receiver_is_dispatchable` then calls `infcx.predicate_must_hold_modulo_regions` (contract stub, wave 20).

## PORT decisions (please record)
1. `WfPredicates` is a class implementing `TypeVisitor<undefined>`; `impl FnMut(&mut Self, PredicateObligation)` callbacks
   take the `WfPredicates` first.
2. `Elaborate` and `AllowSelfProjections` are string unions.
3. `impl UpcastFrom<TyCtxt, X> for Predicate` fns take `TyCtxt` while `Obligation::with_depth` / `new` pass
   `as_interner(tcx)` (same object): a local `upcast_via_tcx` adapter in each file.
4. Derived `PartialEq` of `TraitRef` / `AliasTy` (`supertraits.contains`, `Some(proj) != self.allowed`) compares
   `intern_key`s.
5. `visit_ty`: the `Infer(IntVar)` / `Infer(FloatVar)` arms are the first checks of the final `Infer` case (disjoint
   patterns).
6. The test runner installs `dyn_compatibility::provide` through `override_queries` (stands in for `traits::provide`).

## For root
1. **Wire the providers**: upstream `traits::provide` (traits/mod.rs:982, lane trait-sel-traits-a) calls
   `dyn_compatibility::provide(providers)`; rustc_interface passes.ts's `default_query_providers` must call
   `rustc_trait_selection::traits::provide` (listed there as pending "traits"). Until then `is_dyn_compatible` /
   `dyn_compatibility_violations` / `generics_require_sized_self` stay UNPORTED in the driver.
2. **Repoint stand-ins in other lanes' files** (one line each):
   - rustc_hir_analysis collect.ts:721 `ItemCtxt::dyn_compatibility_violations` → `hir_ty_lowering_dyn_compatibility_violations(this.tcx, trait_def_id)`;
   - hir_ty_lowering/dyn_trait.ts:602 → `object_region_bounds(tcx, existential_predicates)` (then lowering_c.test.ts:622's
     `Unported(object_region_bounds)` expectation flips);
   - hir_ty_lowering/errors.ts:2106 `dyn_compatibility_violations_for_assoc_item` → the export here.
3. **Repoint my `PORT(merge)` stand-ins** at the merge of trait-sel-traits-a (normalize, `normalize_param_env_or_error`,
   `SelectionContext::new`) and the project.rs lane (`compute_inherent_assoc_term_args`).
4. infcx-contract's split table assigns traits/outlives_bounds.rs (`implied_bounds_tys`) to this lane; the wave-17
   brief did not. It is still the contract stub.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (14415; vendor 3888)`.
- `--missing`: wf.rs 22/22, dyn_compatibility.rs 28/28 (0 missing).
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools` (at 9db49fb): 4962 pass, 1 skip (the pre-existing
  linux-only one), 0 fail (4963 tests, 310 files).
- `RUST_TS_AGENT=trait-sel-traits-b bun scripts/difftest.ts --suite hir-tree-nocore --sample 100`: 100 MATCH, 0 DIFF,
  0 UNPORTED, 0 CRASH (run `20261015-000132-trait-sel-traits-b-c2t0`). No driver path reaches the new code yet.
