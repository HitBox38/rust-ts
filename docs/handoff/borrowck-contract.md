# Handoff: borrowck-contract (M4 wave 23, contract-first): the rustc_borrowck contract

Branch `lane/borrowck-contract` (from `f5de3f15`, no merges). Commits: codegen set + generated types + skeletons → stubs of
every fn + the `mir_borrowck` hub + wiring + contract test → this handoff.

## Result
- **Codegen set `rustc_borrowck`** (types.sets.json, appended): all 62 files of the crate → 53 `*.gen.ts`, 206 types, 67
  Debug / 59 Clone fns, 24 diagnostic derives (session_diagnostics.rs), 7 `newtype_index!` (`BorrowIndex` `bw{}`,
  `OutlivesConstraintIndex`, `ConstraintSccIndex`, `PlaceholderIndex`, `AppearanceIndex`, `PoloniusRegionVid`,
  `LocationIndex`). Report: 0 unknown types, 0 missing Debug / Clone, 3 manual Debug impls (declared: `OutlivesConstraint`,
  `TypeTest`, `RegionErrors`). New set-local type map `tools/codegen/borrowck.typemap.json` (bare mir names from
  `use rustc_middle::mir::*`, dataflow / infer / index types, `Frozen<T>` = `T`, `OnceCell<T>` = `T | undefined`,
  `BTreeMap`/`BTreeSet` = `Map`/`Set`, `IntervalSet`, polonius-engine `AllFacts`/`Output` = `unknown` (D7, wave 26),
  `SparseIntervalMatrix<$0 & number, ..>` because the generator does not emit `N: Idx` bounds).
  - `hand` (17): `TypeChecker` (type_check/mod.ts, extends mir `Visitor`), the module-level MIR visitors (`GatherBorrows`,
    `GatherUsedMutsVisitor`, `AllLocalUsesVisitor`, `DefUseVisitor`, `LiveVariablesVisitor`, `LocalUseMapBuild`,
    `AccessFactsExtractor`, `LoanInvalidationsGenerator`, `LoanKillsGenerator`; `RegionRenumberer` extends `MutVisitor`),
    the HIR visitors (`BindingFinder`, `ReferencedStatementsVisitor`, `BreakFinder`, `ConditionVisitor`), the analyses
    `Borrows` / `Borrowck` (extend rustc_mir_dataflow `AnalysisBase`).
  - `import_gen`: every hand module of the set except constraints/mod.ts, region_infer/mod.ts and
    diagnostics/region_name.ts (they hold manual impls the generated code calls). Hand modules attach methods to generated
    classes at load; a generated module must never value-import such a module.
- **Every fn is declared** (901 upstream fns; `src/rustc_borrowck/contract.test.ts`, scan = coverage): 42 `// rustc:` +
  859 `// stub: <path>:<line> <name> (lane <lane>)` over the final signature, body
  `unported("rustc_borrowck::<module>[::<SelfType>]::<name>")` (the test checks the path is in the fn's own module).
  The 12 required trait-method declarations carry `// rustc:` on their interface member.
- **Ported here (the hub)**, coverage rustc_borrowck 0 → **42/901**:
  - lib.rs 16/46: `provide`, `mir_borrowck`, `borrowck_collect_region_constraints`, `borrowck_check_region_constraints`
    (+ the fn-local `MoveVisitor::visit_operand`), `get_flow_results`, `BorrowckInferCtxt::{new, next_region_var,
    next_nll_region_var, fully_perform, deref}`, `InitializationRequiringAction::{as_noun, as_verb_in_past_tense,
    as_general_verb_in_past_tense}`, `MirBorrowckCtxt::{body, dominators}`; the `ResultsVisitor` provided methods.
  - root_cx.rs 11/11 (`BorrowCheckRootCtxt`: `new`, `finalize`, `do_mir_borrowck`, the opaque/closure-requirement
    rounds, `dcx`, ...).
  - region_context.rs 3 (the `Deref` / `DerefMut` glue of `RegionInferenceContext` / `UnsolvedRegionInferenceContext`).
- **Wiring**: rustc_interface passes.ts `DEFAULT_QUERY_PROVIDERS` calls `rustc_borrowck::provide` (after
  `rustc_middle::hir::provide`, upstream order): `mir_borrowck`, `mir_borrowck_implied_outlives_bounds` (stub, bck-tc-b).
- **Where `mir_borrowck` stops now** (contract test, no_core crate): a trivial const returns `Ok({})`; a typeck-tainted
  body (E0308; `construct_error`'s MIR) returns `Err(guar)`; a real fn runs `BorrowCheckRootCtxt::do_mir_borrowck` →
  `borrowck_collect_region_constraints` (`BorrowckInferCtxt::new`, `mir_promoted`, the body clone) and stops at
  **`rustc_borrowck::nll::replace_regions_in_mir`** (bck-nll). The next stubs on that path, in order:
  `PoloniusLocationTable::new` (bck-nll), `BorrowSet::build` (bck-core), `PoloniusFactsExt::enabled` (bck-nll),
  `type_check::type_check` (bck-tc-a, then tc-b / tc-live), `nll::compute_regions` (bck-nll → regions-a/-b,
  polonius), `dump_nll_mir` / `dump_polonius_mir` / `dump_annotation`, `Borrows::new` + the dataflow, the
  `ResultsVisitor` methods (bck-lib-a) and the access checks (bck-lib-a/-b), `report_*` (bck-diag-*),
  `gather_used_muts` / `lint_unused_mut` (bck-core / bck-lib-b).

## Conventions (lib.ts's header has the full text; please record)
1. Types are generated (`<file>.gen.ts`, re-exported by the hand module). Shared classes are **generated classes**:
   `MirBorrowckCtxt`, `BorrowckInferCtxt` (lib.gen.ts), `RegionInferenceContext` / `RegionInferenceContextInner` /
   `UnsolvedRegionInferenceContext` (region_infer/region_context.gen.ts), `BorrowCheckRootCtxt` (root_cx.gen.ts),
   `UniversalRegions`, `BorrowSet`, `RegionValues`, `LivenessValues`, ... Hand classes are the 17 above.
2. Methods of a generated class: the file holding the `impl` augments the `.gen.ts` (`declare module "<rel>/x.gen.ts" {
   interface X { // x.rs:<line> (lane L) .. } namespace X { function new_(..): X; export { new_ as new } } }`; in a
   namespace with an `export {..}` statement every other member needs `export`) and assigns `X.prototype.m` /
   `(X as unknown as {..}).m`. Hand classes: methods in the class body, or augmentation of the defining hand module
   (`TypeChecker` from input_output.ts / relate_tys.ts / canonical.ts).
3. A method whose name is a field of its class gets a trailing `_` (mir-contract rule): `MirBorrowckCtxt.body_()` /
   `local_names_()`, `BorrowCheckRootCtxt.root_def_id_()`, `TypeChecker.body_()`, `BorrowData.kind_()` etc.,
   `LivenessValues.location_map_()`, `RegionInferenceContextInner.constraint_sccs_()` / `liveness_constraints_()`,
   `UniversalRegionRelations.outlives_()`, `OutlivesConstraintSet.outlives_()`, `RegionTracker.max_nameable_universe_()`,
   `BestBlame.path_()`. A trait method fixed by an interface keeps its name (the field gets the `_`).
4. Enum methods on the companion (`E_methods` + `export const E = gen.E as typeof gen.E & E_methods`; `{} as
   E_methods` when the generator emitted no companion: `Representative`, `DefiningTy`, `Locations`, `UseSpans`,
   `AnnotatedBorrowFnSignature`).
5. Traits: implemented by classes → prototype methods (mir/hir `Visitor` overrides; `TypeRelation` /
   `PredicateEmittingRelation` on `NllTypeRelating` / `VarianceExtractor` with a `relate` forwarder to
   `TypeRelation_provided`; `TypeOutlivesDelegate` on `ConstraintConversion`); implemented by generated *interfaces* or
   non-class values → impl tables `<Trait>_<Type>` with `self` first (`Iterator_Prefixes`, `Iterator_EdgesFromGraph`,
   `Iterator_AppearancesIter`, `Annotation_RegionTracker` (`self: MutRef`), `TypeVisitor_FindOpaqueRegion`,
   `TypeOpInfo_PredicateQuery` / `_NormalizeQuery(display_T, d_T)` / ..., `ToUniverseInfo_<T>`, `NormalizeLocation_<T>`,
   `LivenessSource_*`, `LocalizedConstraintGraphVisitor_*`, `Labeller_*` / `GraphWalk_*`, `PoloniusFactsExt`,
   `ConstraintDescription_ConstraintCategory`, `JoinSemiLattice_BorrowckDomain`); `dyn TypeOpInfo` is the interface
   `TypeOpInfo` (+ glue `TypeOpInfo_of(self, impl)` standing for `Rc::new(x) as Rc<dyn TypeOpInfo>`).
   `ConstraintGraphDirection`: the generated field `_direction` holds the impl table (`ConstraintGraphDirection_Normal` /
   `_Reverse`), so `D::start_region(c)` is `graph._direction.start_region(c)`. Extension traits augment the foreign class:
   `PlaceExt` (mir `Place`, syntax.gen.ts), `InferCtxtExt` (rustc_infer `InferCtxt`); `BorrowckInferCtxt`'s
   `replace_*_with_nll_infer_vars` augment lib.gen.ts.
6. `Deref` = field + rust_ts/deref.ts `register_deref`: `BorrowckInferCtxt -> InferCtxt` (lib.ts),
   `RegionInferenceContext` / `UnsolvedRegionInferenceContext -> RegionInferenceContextInner` (region_context.ts);
   lib.ts calls `install_derefs()` last.
7. Struct-keyed maps / sets are `KeyedMap` / `KeyedSet` at construction (`MirBorrowckCtxt.access_place_error_reported` /
   `reservation_error_reported` use `intern_key`; `BorrowckDiagnosticsBuffer.buffered_move_errors` is keyed by the
   `MoveOutIndex` list and its users must iterate it in `BTreeMap` key order).
8. `BorrowCheckRootCtxt.tainted_by_errors` (`&Cell<Option<ErrorGuaranteed>>`) is the field itself; `dcx()` passes a
   `MutRef` view of it to `into_taintable`. `Option<PoloniusFacts>` handed to `type_check` is a `MutRef` slot.
   `PoloniusFacts::default()` stops `unported` (vendor polonius-engine, wave 26). `BorrowckInferCtxt`'s
   `cfg!(debug_assertions)` blocks are compiled out (rustc ships without them).
9. Fn-local items (nested fns, local structs / visitors) are module-level until filled; clashing names get the upstream
   struct line as suffix (`ExpressionFinder_366`, `ExprFinder_2481`, ...). Tuple params `(a, b): (A, B)` are tuples.
10. Init order: top-level code touches only `.gen.ts` classes / companions, the hand classes' defining modules and other
    crates; hand modules import generated items from `.gen.ts`; no `export *` of sibling modules that assign prototypes
    (region_infer/mod.ts does not re-export region_context.ts, type_check/mod.ts / diagnostics/mod.ts /
    polonius/legacy/mod.ts / liveness/mod.ts do not re-export their submodules). lib.ts imports lib.gen.ts, then every
    module in `mod` order, then rustc_session/lib.ts before config.ts (config.ts is not a fresh entry point).
    root_cx.ts reads lib.ts's two fns lazily (`require`). Every hand module loads as a fresh entry (contract test).

## Split table (fill lanes, wave 23; stubs from the contract test)
| lane | upstream (compiler/rustc_borrowck/src/) | stubs | notes |
|---|---|---|---|
| bck-lib-a | lib.rs lines < 1400 | 8 | `ClosureOutlivesSubjectTy::{bind, instantiate}`, the 3 `ResultsVisitor` methods, `access_place`, `borrows_in_scope`, `check_access_for_conflict` |
| bck-lib-b | lib.rs lines >= 1400 | 22 | mutate/consume/move checks, `is_mutable`, `lint_unused_mut`, fn-local `check_parent_of_field` |
| bck-core | borrow_set, dataflow, places_conflict, path_utils, prefixes, place_ext, def_use, used_muts | 64 | `BorrowSet::build`, `Borrows::new` (`PoloniusOutOfScopePrecomputer` under next, D7) |
| bck-nll | nll, renumber, consumers, universal_regions; polonius/legacy/location.rs, facts.rs `enabled`, legacy/mod.rs `emit_facts` | 64 | **first stop** `replace_regions_in_mir`; the legacy fns every run reaches are here |
| bck-tc-a | type_check/mod.rs | 39 | `type_check`, `TypeChecker` (hand class) |
| bck-tc-b | relate_tys, free_region_relations, canonical, constraint_conversion, input_output, implied_bounds | 68 | `mir_borrowck_implied_outlives_bounds` provider |
| bck-tc-live | type_check/liveness/{mod, trace, local_use_map} (+ rustc_trait_selection outlives_for_liveness.rs, not declared here) | 34 | `make_all_regions_live` needs trait_selection's `FreeRegionsVisitor` |
| bck-regions-a | region_infer/{region_context, values, mod} | 85 | |
| bck-regions-b | region_infer/{opaque_types/*, reverse_sccs, dump_mir, graphviz}, handle_placeholders, constraints/* | 94 | graphviz: rustc_graphviz not ported (`dot_Id` / `dot_LabelText` local `unknown`) |
| bck-polonius | polonius/{mod, constraints, liveness, liveness_constraints, dump} (next, D7) | 39 | dump.rs's `TEMPLATE` (`include_str!` of polonius-mir-dump.template.html) is not declared: copy it verbatim |
| bck-diag-a | diagnostics/conflict_errors.rs lines < 2469 | 34 | |
| bck-diag-b | diagnostics/conflict_errors.rs lines >= 2469 | 42 | |
| bck-diag-c | diagnostics/{mutability_errors, var_name, find_use, find_all_local_uses} | 37 | |
| bck-diag-d | diagnostics/{mod, move_errors} | 70 | `BorrowckDiagnosticsBuffer` (`emit_errors` is the last call of `do_mir_borrowck`) |
| bck-diag-e | diagnostics/{region_errors, region_name} | 48 | |
| bck-diag-f | diagnostics/{explain_borrow, bound_region_errors, opaque_types, outlives_suggestion}, borrowck_errors, session_diagnostics (manual `TailExprDropOrder` impl) | 70 | session diagnostics are generated |
| bck-polonius-legacy (wave 26, M4d) | polonius/legacy/* (rest) | 41 | needs vendor polonius-engine 0.13.0 + datafrog 2.0.1 |

**mt-coroutine-b (parallel)** provides `mir_coroutine_witnesses` (rustc_mir_transform coroutine/layout.rs): borrowck of
async fns / coroutines reaches it through `coroutine_hidden_types` (auto-trait / `Sized` obligations on
`CoroutineWitness` types proved by type_check) and `mir_drops_elaborated_and_const_checked`; coroutine/drop.rs (async
drop glue) is not on the borrowck path.

## How to fill a stub
1. `grep -rn "// stub: compiler/rustc_borrowck/src/<file>:<line> <name>" src` (or `bun scripts/coverage.ts --missing
   <path>`). Keep the signature; a wrong one goes in your handoff (or fix it and say so).
2. Port the body in place; turn the comment into `// rustc: <path>:<line> <name>` (drop `(lane ..)`); move fn-local items
   back inside their fn.
3. Lower your lane's count in `src/rustc_borrowck/contract.test.ts` ("split table") and the stub total (859), raise the
   marker count (42). Re-pin the runtime stop (`replace_regions_in_mir`) to the next stub on the path.
4. Keep the init-order rules (the test loads every hand module as a fresh entry point).

## `unported(...)` left
- The 859 stubs (each names its module and lane).
- In ported code: `PoloniusFacts_default` (lib.ts; `-Znll-facts` / `-Zpolonius=legacy` only).

## `// PORT:` decisions in ported code
- lib.ts: header (conventions), `mod` declarations as side-effect imports, `PoloniusFacts_default`, the
  `cfg!(debug_assertions)` blocks of `next_region_var` / `next_nll_region_var`, `tcx.prof` timers dropped (driver-m2
  decision 8), `Cow<MixedBitSet>` = the set, `from` / `to` of `check_if_subslice_element_is_moved` are `bigint`,
  `MoveVisitor` hoisted, rustc_session entered through lib.ts.
- root_cx.ts: header (`tainted_by_errors` field, `mem::take`), the `BorrowckDiagnosticsBuffer::default()` construction,
  the lazy `require` of lib.ts.
- Fork-written stub files: each header lists its notes (see "Conventions").

## Shared files edited (review)
`src/rustc_interface/passes.ts` (import + `rustc_borrowck_provide(providers.queries)` + comment),
`tools/codegen/types.sets.json` (new set `rustc_borrowck`), `tools/codegen/borrowck.typemap.json` (new).
No tool code changed.

## Re-pinned tests (each pins the exact new stop; no assertion weakened)
- `src/rustc_hir_analysis/collect_test/misc.expected.txt` (`rpit`'s `type_of`): `mir_borrowck provider (not ported)` →
  `rustc_borrowck::nll::replace_regions_in_mir`.
- `src/rustc_lint/late_c.oracle.test.ts` (blocked impl_trait_overcaptures case) and `late_e2.oracle.test.ts` (TAIT
  opaque_hidden_inferred_bound case): same stop change.
- `src/rustc_hir_typeck/contract.test.ts` "Deref ...": the shared registry lists the 3 borrowck derefs
  (`BorrowckInferCtxt.infcx`, `RegionInferenceContext.inner`, `UnsolvedRegionInferenceContext.inner`); the test imports
  rustc_borrowck/lib.ts so the list does not depend on test-file order.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (20191; vendor 4330).
- `src/rustc_borrowck/contract.test.ts`: 6 pass (scan = coverage; split table; 62 hand modules load as fresh entries;
  enum methods; providers installed; runtime stops).
- `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (`RUST_TS_AGENT=borrowck-contract`): **6064 pass, 1 skip, 0 fail**
  (6065 tests, 430 files; after the re-pins below: the first run had exactly those 4 failures).

## Samples (`RUST_TS_AGENT=root-f5de` vs root's base runs at `f5de3f15`, same samples)
| suite | lane run | M / D / U / C / UNSTABLE | base run | M / D / U / C / UNSTABLE |
|---|---|---|---|---|
| tydump-minicore (46) | `20261022-182812-root-f5de-ydjt` | 45 / 0 / 1 / 0 / 0 | `20261022-180940-root-f5de-fn9c` | 45 / 0 / 1 / 0 / 0 |
| mirdump-minicore (46) | `20261022-182830-root-f5de-ycj8` | 17 / 0 / 29 / 0 / 0 | `20261022-180922-root-f5de-tefg` | 17 / 0 / 29 / 0 / 0 |
| tydump-ui `--sample 300` | `20261022-182848-root-f5de-5cg4` | **261** / 0 / 37 / 0 / 2 | `20261022-175123-root-f5de-supl` | 258 / 0 / 40 / 0 / 2 |
| mirdump-ui `--sample 300` | `20261022-183040-root-f5de-6ugk` | **18** / 0 / 282 / 0 / 0 | `20261022-175248-root-f5de-c6id` | 17 / 0 / 283 / 0 / 0 |

**No new DIFF**; minicore stops identical. How the `mir_borrowck` stops moved:
- tydump-ui: 25 `mir_borrowck provider (not ported)` → 21 `rustc_borrowck::nll::replace_regions_in_mir` (bck-nll), 3
  **MATCH** (tainted owners: `mir_borrowck` returns `Err`), 1 `IntoDiagArg without a TS impl` (different-bound-vars.rs#current:
  a later, non-borrowck diagnostic is now reached).
- mirdump-ui: 16 → 12 `replace_regions_in_mir`, 1 **MATCH**, 2 `rustc_const_eval::...::try_destructure_mir_constant_for_user_output`,
  1 `rustc_mir_transform::coroutine::layout::mir_coroutine_witnesses` (mt-coroutine-b).
- Root's later mirdump-ui base run `20261022-180955-root-f5de-gnxc` (21 MATCH) differs from the `f5de3f15` one on 4 cases
  that stop at `rustc_mir_transform::validate::Validator (pass not ported)` here and in `20261022-175248` (not this lane's
  code; that run's tree evidently had the validator).
