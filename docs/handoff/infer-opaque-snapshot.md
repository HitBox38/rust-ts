# Handoff: infer-opaque-snapshot (M3, wave 16)

Branch `lane/infer-opaque-snapshot` (from main `816b5c5`, no merges). Row "infer-opaque-snapshot" of the infcx-contract
split table: rustc_infer `opaque_types/{mod,table}.rs`, `snapshot/{mod,fudge}.rs`, `projection.rs`,
`traits/{mod,engine,project,structural_impls,util}.rs`, `diagnostics.rs`.

## Result
- Every fn of the row is ported in upstream order with its marker; every `unported_methods(..)` call and stub
  `export const` of these files is gone.
- rustc_infer coverage 98 → 194 / 644.
- Nothing in a driver path calls rustc_infer yet, so no suite output changes.

## Files
- **Ported (hand):**
  - `src/rustc_infer/infer/opaque_types/mod.ts`: the 6 `impl InferCtxt` methods.
  - `src/rustc_infer/infer/opaque_types/table.ts`: `OpaqueTypeStorage` (now a hand class), its 10 methods,
    `needs_reevaluation`, and `OpaqueTypeTable::{deref, register, add_duplicate}`.
  - `src/rustc_infer/infer/snapshot/mod.ts`: the 10 methods (`start_snapshot`, `rollback_to`, `commit_from`,
    `commit_if_ok`, `probe`, ...).
  - `src/rustc_infer/infer/snapshot/fudge.ts`: 3 private fns, `fudge_inference_if_ok`, `fudge_inference`,
    `SnapshotVarData::{new, is_empty}`, and the `InferenceFudger` folder (class `InferenceFudgerFolder`).
  - `src/rustc_infer/infer/projection.ts`: `projection_term_to_infer`.
  - `src/rustc_infer/traits/mod.ts`: the 12 `Obligation` fns.
  - `src/rustc_infer/traits/engine.ts`: the `ScrubbedTraitError` / `TraitErrors` companions (both `IntoIterator`
    impls) and the 5 `TraitEngine_provided` methods.
  - `src/rustc_infer/traits/project.ts`: `Normalized::with`, `ProjectionCacheKey::new`, `ProjectionCacheStorage`
    (now a hand class), `with_log`, the 9 `ProjectionCache` methods, `reverse`.
  - `src/rustc_infer/traits/structural_impls.ts`: the 3 manual `Debug` impls.
  - `src/rustc_infer/traits/util.ts`: `anonymize_predicate`, `PredicateSet` (4 methods),
    `Elaboratable_PredicateObligation`, `transitive_bounds_that_define_assoc_item`; `pub use ty::elaborate::*`.
  - `src/rustc_infer/diagnostics.ts`: header only. The file's one type is a `#[derive(Diagnostic)]`, already generated
    (diagnostics.gen.ts, `OpaqueHiddenTypeDiag_into_diag`); there are 0 fns to port.
- **Regenerated:** `src/rustc_infer/infer/opaque_types/table.gen.ts`, `src/rustc_infer/traits/project.gen.ts`.
  These are the only changes when set `rustc_infer` is regenerated.
- **Tests (new):** `src/rustc_infer/opaque_snapshot.test.ts` (17 tests, see "Tests").
- **Outside my files (please review):**
  - `tools/codegen/types.sets.json`, set `rustc_infer`: `ProjectionCacheStorage` and `OpaqueTypeStorage` are added
    to `hand`, with `hand_notes`. See "PORT decisions" 1.
  - `src/rustc_infer/contract.test.ts`, one line: `expect(stubs).toBeGreaterThan(250)` →
    `expect(stubs).toBeLessThanOrEqual(DECLS.decls.length)`.
    - Why: filling this row's placeholders drops the count to 240, so the test failed.
    - Every wave-16 infer lane lowers this count. Root should keep a bound that does not depend on porting progress.
    - The other lanes may make a conflicting edit to the same line.

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_infer/src/<file>`)
| file | ported |
|---|---|
| infer/opaque_types/mod.rs | 6/6 |
| infer/opaque_types/table.rs | 14/14 |
| infer/snapshot/mod.rs | 10/10 |
| infer/snapshot/fudge.rs | 11/11 |
| infer/projection.rs | 1/1 |
| traits/mod.rs | 12/12 |
| traits/engine.rs | 23/23 |
| traits/project.rs | 13/13 |
| traits/structural_impls.rs | 3/3 |
| traits/util.rs | 10/10 |
| diagnostics.rs | 0/0 |

`bun scripts/coverage.ts --check`: `markers ok (13431; vendor 3888)`. TOTAL 12912/25518 (50.60%).

## Tests (`src/rustc_infer/opaque_snapshot.test.ts`, real `tcx.infer_ctxt().build(..)` over fresh interners)
- **snapshot/mod.rs:**
  - `start_snapshot` → changes → `rollback_to` restores every table and the universe, with all 13 `UndoLog` kinds in
    the log (asserted): TypeVariables, Const/Int/FloatUnificationTable, RegionConstraintCollector (AddVar,
    AddConstraint), RegionUnificationTable, ProjectionCache, OpaqueTypes (overwrite + fresh), DuplicateOpaqueType,
    PushTypeOutlivesConstraint, PushRegionAssumption, PushHirTypeckPotentiallyRegionDependentGoal,
    OverwriteSolverRegionConstraint.
  - nested snapshots and `commit_from`;
  - `probe` and `commit_if_ok` (Ok / Err);
  - `variable_lengths`, `region_constraints_added_in_snapshot`, `opaque_types_added_in_snapshot`.
- **fudge.rs:**
  - type / int / float / region / const variables created in the snapshot are replaced by fresh ones, with their
    origins;
  - older variables are kept;
  - `Err` passes through;
  - without new variables the value is returned unchanged.
- **opaque types:**
  - lookup by a structurally equal key;
  - `num_entries` / `needs_reevaluation` / `opaque_types_added_since` / `take_opaque_types`;
  - `remove` with `swap_remove` order, and its `bug!` for an unregistered key;
  - `pop_duplicate_entry`'s assert;
  - `insert_hidden_type` in Coherence (an `Ambiguous` goal), Typeck (stored, undone by rollback) and PostAnalysis
    (`bug!`);
  - `replace_opaque_types_with_inference_vars` without opaque types, and with the next solver.
- **traits:**
  - `Obligation` (new / with / with_depth / set_depth_from_parent / eq / as_goal / flip_polarity);
  - `TraitErrors`, `ScrubbedTraitError`, and the `TraitEngine` provided methods over a test engine;
  - the projection cache (keyed hits, `insert_term` does not overwrite `Recur`, `complete` clears the obligations,
    rollback);
  - `PredicateSet`, `Elaboratable_PredicateObligation` (child / derived cause), `debug_MismatchedProjectionTypes`.
- **PORT(test) stand-ins.** Some methods of the parallel lanes are still placeholders on this branch:
  - infer-core: `universe`, `next_*_var`, `typing_mode_raw`, `next_trait_solver`, `deeply_resolve_ignoring_regions`;
  - infer-regions: `RegionConstraintStorage::{with_log, reverse}` and the `RegionConstraintCollector` methods the
    snapshot code calls.

  The test file installs their upstream bodies only while they are placeholders, and restores them in `afterAll`.
  After the merge the real ports run, and the tests then check the integration. `deeply_resolve_ignoring_regions`'
  stand-in is the identity: it is only given values whose variables are unresolved, where upstream also returns the
  value unchanged.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4748 pass, 1 skip (the pre-existing linux-only one), 0 fail (4749 tests, 294 files).
- `bun scripts/coverage.ts --check`: ok.
- Fresh-process loads of every touched hand module and of `src/rustc_infer/lib.ts`: ok.
- `RUST_TS_AGENT=infer-opaque-snapshot bun scripts/difftest.ts --suite hir-tree-nocore --sample 100`: 100 MATCH, 0 DIFF, 0 UNPORTED, 0 CRASH (run `20261014-163246-infer-opaque-snapshot-gqi3`).

## `unported(...)` left
- `traits/mod.ts` `Obligation::hash`: `unported("... hash of a non-interned T without hash_T")`. It is reached only
  when a non-interned `T` is hashed without a descriptor (PORT 4).
- **Reached through generated code, not mine:**
  - `ProjectionCacheKey`'s derived Debug has `unported_debug` for `AliasTerm` / `ParamEnv`:
    - tyir.typemap.json and middle_traits_thir.typemap.json map these with `"debug": null`;
    - `debug_ParamEnv` (rustc_middle ty/mod.ts) and `debug_Alias` now exist;
    - so the `assert!(!fresh, "never started projecting `{key:?}`")` message of
      `insert_term` / `ambiguous` / `recur` / `error` stops as UNPORTED instead of an ICE.
    - **For root:** point the two type-map entries at `debug_ParamEnv` and `debug_Alias($v, $f, debug_AliasTermKind)`,
      then regenerate.
  - `Obligation`'s Debug `cause=` / `param_env=` (only with `-Zverbose-internals`) is generated and real.
- **Other lanes' placeholders**, which my code calls and which run once they merge:
  - infer-core: `universe`, `next_ty_var`, `next_const_var`, `next_*_var`, `typing_mode_raw`,
    `can_define_opaque_ty`, `next_trait_solver`, `dcx`, `deeply_resolve_ignoring_regions`, `at` and `At::eq`
    (+ `ToTrace_Ty.to_trace`);
  - infer-regions: `RegionConstraintCollector::{num_region_vars, start_snapshot, rollback_to, vars_since_snapshot,
    region_constraints_added_in_snapshot}`, `RegionConstraintStorage::with_log`.

## PORT decisions (please record)
1. **`OpaqueTypeStorage` and `ProjectionCacheStorage` are codegen `hand` classes**, written in table.ts / project.ts.
   - Their maps (`FxIndexMap<OpaqueTypeKey, _>`; the `SnapshotMapStorage<ProjectionCacheKey, _>`) are keyed by plain
     structs, so they must be `KeyedMap`s on `intern_key` (infcx-contract "For root" 1).
   - The generated derived `Default` / `Clone` built plain `Map`s, and `ProjectionCacheStorage`'s Clone was
     `unported_clone`.
   - The derived Default / Clone are now hand-written next to the classes, with the same exported names, so
     infer/mod.ts's imports are unchanged.
   - `OpaqueTypeStorage`'s Debug stays generated.
2. **`IndexMap::swap_remove`** in `OpaqueTypeStorage::remove` is rustc_errors' `index_map_swap_remove` applied to the
   stored key of the `KeyedMap` (as rustc_resolve late.ts).
3. **`impl Iterator` results of `OpaqueTypeStorage`** (`take_opaque_types`, `iter_*`, `opaque_types_added_since`) are
   arrays taken at the call. Upstream borrows the storage, so it cannot change during the iteration.
4. **`Obligation`'s `PartialEq` / `Hash` take optional trailing descriptors `eq_T` / `hash_T`.**
   - decls.ts's `eq(other)` / `hash(state)` carry none.
   - Without one, `T` must be interned (`Predicate`, `Clause`): it is compared by identity and hashed by its intern id,
     as rustc does with the pointer.
   - `ParamEnv`'s derived Hash is `hash_RawList` of `caller_bounds_`.
   - **For root:** add `eq_T?` / `hash_T?` to the decls.ts signatures if a caller with a non-interned `T` appears.
5. **`TraitErrors::into_iter`.** `impl IntoIterator for TraitErrors` is `TraitErrors.into_iter` (engine.rs:106).
   `impl IntoIterator for &TraitErrors` is the extra companion method `TraitErrors.into_iter_ref` (engine.rs:116).
   decls.ts declares one `into_iter` for both.
6. **`TraitErrors::push` returns the new value** (decls.ts: `&mut self` on an enum). In the `HasErrors` case it is the
   same object, after a push.
7. **`InferenceFudger`** is generated as an interface. The `TypeFolder` impl is the module-private class
   `InferenceFudgerFolder`, with the `rustc:` markers on its methods. `Range<T>` is ena's `{ start, end }`, with
   `contains` / `is_empty` over the newtype index.
8. **`transitive_bounds_that_define_assoc_item`** returns a generator. `seen` (a `KeyedSet<PolyTraitRef>`) and the
   collected `stack` are built eagerly, as upstream does before `from_fn`.
9. **`impl Elaboratable<TyCtxt> for PredicateObligation`** is the D4 descriptor `Elaboratable_PredicateObligation`,
   exported from traits/util.ts. `impl Extend<Predicate> for PredicateSet` is three methods on the class; `reserve`
   is capacity only.
10. **Query values typed `unknown` in queries.gen.ts are cast where they are read:**
    - `explicit_item_bounds` and `explicit_implied_const_bounds` (`EarlyBinder<&[(_, Span)]>`);
    - `type_of_opaque_hir_typeck` (`EarlyBinder<Ty>`);
    - `opaque_ty_origin`;
    - `explicit_supertraits_containing_assoc_item`.
11. **`impl Upcast<TyCtxt, P>` arguments.** rustc_middle's `Predicate_upcast_from_*` fns, typed over `TyCtxt`, are cast
    to decls.ts's `(from, tcx: Interner)` form (as the next solver's `upcast_tcx`). `Obligation::with_depth` passes
    `as_interner(tcx)`.
12. **`assert!(cond, "..{key:?}")`** is `if (!cond) panic(..)`, so the message is formatted only on failure.
    `bug!` is rustc_span's `bug`. `unreachable!("unexpected fresh infcx var")` carries rustc's full panic text.
13. **`float_origin_origin_storage` is not undo-logged upstream**, so a rollback keeps origins pushed in the snapshot.
    The tests pin this behaviour.

## For root
1. Record the PORT decisions above, plus the `hand` additions to set `rustc_infer`.
2. contract.test.ts: settle the placeholder-count assertion. All infer lanes reach it.
3. The two type-map Debug entries (`AliasTerm`, `ParamEnv`), see "`unported(...)` left".
4. `src/rustc_hir_analysis/hir_ty_lowering/mod.ts:1176` already calls `rustc_infer.traits.util.transitive_bounds_that_define_assoc_item`.
   It now runs, and stops at the `explicit_supertraits_containing_assoc_item` query provider if that is not wired.
