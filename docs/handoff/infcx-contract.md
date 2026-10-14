# Handoff: infcx-contract (M3, wave 16, contract-first): the `InferCtxt` contract

Branch `lane/infcx-contract` (from main `00ce463`, no merges).

## Result
- `src/rustc_infer/` exists as a contract plus stubs; the five wave-16 infer lanes only fill bodies.
  - **decls.ts** declares every one of the crate's 644 upstream fns at its `file:line`: real declarations for the
    contract classes and every type more than one lane uses, comment-only declarations for the rest.
  - **Codegen set `rustc_infer`** generates the crate's 117 types (+ rustc_middle `infer/canonical.rs`) with their
    derived Debug / Clone / Default / TypeFoldable into `*.gen.ts`.
  - **Each stub module** re-exports its `.gen.ts` and installs an `unported(..)` placeholder for every declared method.
- `src/rustc_trait_selection/` holds the extension-trait half of the contract (decls.ts + 10 stub modules + lib.ts).
- **Ported for real** (98 rustc_infer fns + 5 rustc_middle fns), so `tcx.infer_ctxt().build(typing_mode)` builds an
  empty `InferCtxt` whose ena tables, undo log and snapshots work:
  - type_variable.rs (37/37), unify_key.rs (13/13), snapshot/undo_log.rs (14/14), solver_region_constraints.rs (3/3)
    and its tests.rs (1/1);
  - mod.rs 20/123: the `impl InferCtxtInner` block (`new` .. `unwrap_region_constraints`), `TyCtxtInferExt::infer_ctxt`,
    all 8 `InferCtxtBuilder` methods (`build`, `build_with_typing_env`, `build_with_canonical`, ...);
  - rustc_middle infer/canonical.rs 5/5, including `CanonicalParamEnvCache` and its derived `Default`.
    `GlobalCaches::default` now builds the real cache; the `pending_cache` stand-in of rmeta-ty is gone.
  - the trait declarations that are ports in themselves: `TraitEngine` / `FromSolverError` (traits/engine.rs, 7 of
    23), `ToTrace` (at.rs:130), `TypeOutlivesDelegate` (outlives/obligations.rs, 2).
- Nothing in a driver path calls rustc_infer yet, so no suite output changes.

## Files
- **New, contract (root-owned after integration):** `src/rustc_infer/decls.ts`, `src/rustc_trait_selection/decls.ts`.
- **New, generated:** `src/rustc_infer/**/*.gen.ts` (30 files) and `src/rustc_middle/infer/canonical.gen.ts`
  (set `rustc_infer` of `tools/codegen/types.sets.json`).
- **New, hand (ported):**
  - `src/rustc_infer/infer/{type_variable,unify_key,solver_region_constraints}.ts`;
  - `src/rustc_infer/infer/snapshot/undo_log.ts`;
  - `src/rustc_infer/infer/mod.ts` (partly ported, see above);
  - `src/rustc_middle/infer/{mod,canonical}.ts`;
  - `src/rustc_infer/lib.ts` (crate root, load order).
- **New, stub modules (generated once from decls.ts, then hand-edited; header says how to fill):**
  - every other `src/rustc_infer/**/*.ts` (32 files);
  - `src/rustc_trait_selection/{lib,infer,regions}.ts`, `solve/select.ts`, `solve/inspect/analyse.ts`,
    `traits/{normalize,outlives_bounds,structural_normalize}.ts`, `traits/query/{normalize,evaluate_obligation}.ts`,
    `error_reporting/mod.ts`.
  - Some carry contract code beyond placeholders: the hand classes of the codegen `hand` list (see "Representation");
    the traits `TraitEngine` (+ `TraitEngine_provided` stubs), `FromSolverError`, `ToTrace` (+ the 14 `ToTrace_<T>`
    descriptors with stub `to_trace`), `TypeOutlivesDelegate`; the stub manual Debug impls codegen imports.
- **Tests:** `src/rustc_infer/contract.test.ts` (9 tests) and
  `src/rustc_infer/infer/solver_region_constraints/tests.test.ts` (the upstream unit test).
- **Edited outside rustc_infer** (needed by the contract; please review):
  - `tools/codegen/types.sets.json`: new set `rustc_infer` (appended, rest of the file untouched).
  - `tools/codegen/infer.typemap.json` (new): set-local type map of the ~50 external types the set reaches.
  - `tools/codegen/type_fold.json`: `rustc_middle::infer::canonical::Certainty` added to `trivial` (it is in
    `TrivialTypeTraversalImpls!`, structural_impls.rs:186).
  - `src/rustc_type_ir/infer_ctxt.ts`: the 8 colliding `InferCtxtLike` methods are `ir_<name>` (see "Representation"
    4). Their callers `universe.ts`, `relate/solver_relating.ts` and the mock in `tyir_relate.test.ts` follow.
  - `src/rustc_middle/ty/context.ts`: `GlobalCaches.canonical_param_env_cache` is the real
    `rustc_middle::infer::canonical::CanonicalParamEnvCache`. `pending_cache` is removed (it had no other user).
    `src/rustc_middle/traits/traits.test.ts` pins the real cache instead of the stop.

## Split points: lane -> files (upstream lines)
| lane | upstream files (compiler/rustc_infer/src/) | lines | TS | waiting |
|---|---|---|---|---|
| infer-core | infer/mod.rs (rest), at.rs, resolve.rs, freshen.rs | 2774 | infer/mod.ts, at.ts, resolve.ts, freshen.ts | 103 + 24 + 11 + 8 fns: the `impl InferCtxt` of mod.rs (85 methods), `fork`, `At` (7), the 14 `ToTrace` impls, `SubregionOrigin`/`ValuePairs`/`RegionVariableOrigin` companions, `display_FixupError`, `TypeTrace` (4), `InferOk` (2), `ToFreshVars`, `InferenceLiteralEraser`, the resolvers |
| infer-relate | infer/context.rs, relate/{mod,generalize,higher_ranked,lattice,type_relating}.rs | 2122 | context.ts, relate/*.ts | `impl InferCtxtLike for InferCtxt` (36 declared + 25 served by inherent methods), `lower_universe`; generalize (17), higher_ranked (3), lattice (15), type_relating (13) |
| infer-regions | region_constraints/{mod,leak_check}.rs, lexical_region_resolve/{mod,indexed_edges}.rs, free_regions.rs, outlives/env.rs | 2614 | region_constraints/*.ts, lexical_region_resolve/*.ts, free_regions.ts, outlives/env.ts | 34 + 10 + 24 + 2 + 7 + 5 fns |
| infer-canonical-outlives | canonical/{mod,canonicalizer,instantiate,query_response}.rs, outlives/{mod,obligations,test_type_match,verify}.rs | 3134 | canonical/*.ts, outlives/{mod,obligations,test_type_match,verify}.ts | 2 + 33 + 13 + 10 + 4 + 26 + 12 + 8 fns |
| infer-opaque-snapshot | opaque_types/{mod,table}.rs, snapshot/{mod,fudge}.rs, projection.rs, traits/{mod,engine,project,structural_impls,util}.rs, diagnostics.rs | 1854 | opaque_types/*.ts, snapshot/{mod,fudge}.ts, projection.ts, traits/*.ts, diagnostics.ts | 6 + 14 + 10 + 11 + 1 + 12 + 16 + 13 + 3 + 10 fns |
| (done here) | type_variable.rs, unify_key.rs, snapshot/undo_log.rs, solver_region_constraints.rs (+tests.rs) | 863 | | |

- **Deviation from plan-m3 §5.** The plan puts context.rs in infer-core and outlives/env.rs with outlives. Here
  context.rs is in infer-relate and env.rs in infer-regions, so that infer-core (2774) and infer-canonical-outlives
  (3134) stay near the ~3k bound. context.rs is a delegation layer over the other files' methods. env.rs only builds
  `FreeRegionMap` / `RegionBoundPairs`. Root may move them back: the contract does not depend on it.
- **rustc_trait_selection extension traits** (30 methods) belong to the wave-17/19/20 lanes named in its decls.ts:
  - trait-sel-traits-a: infer.rs, regions.rs, normalize.rs, structural_normalize.rs;
  - trait-sel-traits-b: outlives_bounds.rs;
  - trait-sel-solve: solve/select.rs, solve/inspect/analyse.rs;
  - old-query-typeops: traits/query/*;
  - errctxt-contract: error_reporting/mod.rs.

## How to fill a stub
1. **Find the declaration.** Every fn of your file is declared in `src/rustc_infer/decls.ts` under `// <file>:<line>`.
   - Real declarations are in `interface InferCtxt` / `InferCtxtInner` / `InferCtxtBuilder` / `At`, in the
     `declare module "./infer/<file>.gen.ts"` (or hand module) augmentations, or in `Companions` / `FreeFns`.
   - Comment-only ones (`// name: Self[Trait]`) are at the end, grouped by file.
   - Do not change a real signature. A wrong or missing one goes in your handoff. If you cannot type-check without
     the change, add a local `declare module "<path>/decls.ts"` in your file marked `// PORT(decls): pending root`.
2. **Methods.** In your file's TS module, in upstream order, write
   `InferCtxt.prototype.<name> = function (this: InferCtxt, ..): R { .. };` (or the generated class's prototype), with
   the marker `// rustc: compiler/rustc_infer/src/<file>:<line> <name>` directly above it. Then delete the name from
   the `unported_methods(..)` list, and delete the call when the list is empty.
   - Statics are on the class: `(OutlivesEnvironment as ..).from_normalized_bounds = function ..`.
   - A static `new` is declared `function new_(..); export { new_ as new }` (precedent rustc_errors).
3. **Companions and free fns.** The stub `export const X = {} as Companions["X"]` (enum methods, `self` first) and
   `export const f = ((): never => unported(..)) as FreeFns["f"]` become real objects / `export function`s with the
   same signatures. contract.test.ts checks that each still exists. For an enum whose `.gen.ts` exports a companion
   (`VerifyBound`, `TraitErrors`, `ScrubbedTraitError`, ...), keep the spread `{ ...gen.X, method() {..} }`.
4. **Comment-only fns** (folders, relations, helper types of one file): pick the TS form yourself.
   - Methods of a generated class go on its prototype with a `declare module "./<file>.gen.ts"` in your own file.
   - Trait impls are D4 descriptor objects; private fns are module-local functions.
   - `impl TypeFolder for X` is a class implementing `TypeFolder` (rustc_type_ir fold.ts).
5. **Types are generated.** Do not hand-write a type that is in your `.gen.ts`.
   - If a generated type is wrong, fix `tools/codegen/infer.typemap.json` / the set and regenerate with
     `bun tools/codegen/types.ts rustc_infer`. This is root-reviewed data: note it in your handoff.
   - The hand types (codegen `hand`) are written in the mirrored module; see "Representation" 2.
   - Manual Debug impls that codegen imports exist as stubs (`debug_GenericKind`, `debug_RegionSnapshot`,
     `debug_RegionAndOrigin`, `debug_Normalized`, `debug_Obligation`, `debug_MismatchedProjectionTypes`).
6. **Init order.** Breaking these rules gives a TDZ `ReferenceError` at load:
   - decls.ts imports only types;
   - a module's top-level code may touch only decls.ts, its own `.gen.ts` and other crates;
   - other rustc_infer modules are imported through their hand module (`./x.ts`, never another file's `./x.gen.ts`)
     and read inside function bodies only;
   - consumers outside the crate import `src/rustc_infer/lib.ts` (or `src/rustc_trait_selection/lib.ts`).

   Every hand module loads as a fresh entry point today. The `.gen.ts` files, like every other `.gen.ts`, are not
   entry points: they import their hand module.
7. **contract.test.ts must stay green.** Its counts change only when declarations change (root).

## Representation
1. **Contract classes in decls.ts** (`class` with all fields in declaration order + `interface` with the methods):
   `InferCtxt`, `InferCtxtInner`, `InferCtxtBuilder`, `At`.
   - `InferCtxt implements InferCtxtLike`, checked by tsc.
   - `RefCell` / `Cell` fields are the values (PORTING §5).
   - `reported_hir_errors` is a `HirIdMap`, `reported_signature_mismatch` a `KeyedSet` on `intern_key`.
2. **Field renames** (a method of the same name exists; the fields are private upstream):
   - `InferCtxt`: `tainted_by_errors_`, `universe_`, `next_trait_solver_`, `enable_next_solver_overflow_fcw_`;
   - `InferCtxtInner`: `projection_cache_`, `region_obligations_`, `region_assumptions_`;
   - `InferCtxtBuilder`: `in_hir_typeck_`, `skip_leak_check_`, `enable_next_solver_overflow_fcw_`;
   - `InferCtxtUndoLogs`: `num_open_snapshots_`;
   - `OutlivesEnvironment`: `free_region_map_`, `region_bound_pairs_`, `known_type_outlives_`,
     `higher_ranked_assumptions_`;
   - `ProjectionCache`: `map_`;
   - `LatticeOp`, `TypeRelating`: `param_env_` (`PredicateEmittingRelation::param_env`).

   These types are codegen `hand` classes (codegen cannot rename fields). So are `TypeVariableStorage` and
   `RegionConstraintStorage`, which hold ena tables whose value type the type map cannot express.
3. **ena glue** (as vendor/ena tests/external_undo_log.test.ts):
   - `ut::UnificationTableStorage<K>` is `UnificationTableStorage<K, K::Value, Error>`.
   - `with_log(&mut undo_log)` takes the `UndoLogs` view at the table's undo type:
     `undo_log.as_(UndoLog.from_<..>)`, the `impl<T> UndoLogs<T> for InferCtxtUndoLogs where UndoLog: From<T>`.
     infer/mod.ts's `UnificationTable<K, V, E>` is that table type.
   - Keys `TyVidEqKey` / `ConstVidKey` / `RegionVidKey` are `{ vid, phantom }` objects (`<K>_from(vid)`).
   - The `UnifyKey` / `UnifyValue` impls are dictionaries `UnifyKey_<K>` / `UnifyValue_<V>`.
   - The `impl_from!` conversions are `UndoLog.from_<..>` (one marker at undo_log.rs:40).
   - The three `Rollback` impls of `TypeVariableStorage` are `reverse_EqRelation`, `reverse_SubRelation` and
     `reverse`.
4. **`InferCtxtLike` name collisions.**
   - The `impl InferCtxtLike for InferCtxt` methods whose signature equals the inherent method of the same name are
     served by the inherent method (`probe` / `commit_if_ok`: a `() => T` closure ignores the snapshot argument).
   - The 8 with a different signature are `ir_<name>` in `InferCtxtLike` and on `InferCtxt`: `ir_sub_regions`,
     `ir_equate_regions`, `ir_fresh_args_for_item`, `ir_universe_of_region`, `ir_get_solver_region_constraint`,
     `ir_overwrite_solver_region_constraint`, `ir_register_solver_region_constraint`,
     `ir_register_hidden_type_in_storage`. This follows ty-contract decision 5 (`Interner`'s `ir_` methods).
5. **Extension traits** (`#[extension(pub trait X)] impl T`) are methods on `T.prototype` under their own names, as
   rustc_middle's `ConstExt`:
   - `TyCtxtInferExt::infer_ctxt` on `TyCtxt.prototype`;
   - rustc_trait_selection's on `InferCtxt` / `InferCtxtBuilder` / `At` / `OutlivesEnvironment`;
   - `CanonicalExt` on rustc_type_ir's `Canonical` interface is the free fns `Canonical_instantiate` /
     `Canonical_instantiate_projected`.
   contract.test.ts checks that no extension name collides with an inherent method.
6. **D4 descriptors.** `T: TypeFoldable` adds `d_T: TypeFoldable<T>` last; `T: ToTrace` adds `d_T: ToTrace<T>`.
   - `ToTrace<T> extends Relate<T>`; the impls are `ToTrace_Ty`, `ToTrace_Region`, ..., spreading rustc_type_ir's
     `relate_<T>`.
   - `impl Upcast<TyCtxt, O>` is a value plus `upcast_from_O` (rustc_type_ir upcast.ts).
   - `dyn TraitEngine<E>` is the interface `TraitEngine<E>`, with `TraitEngine_provided`.
7. **`()` as a type argument is `null`** (`InferResult<null>`, `RelateResult<null>`), as in rustc_type_ir.
8. **`Drop for InferCtxt` is a method `drop()`.** JS has no destructors and nothing calls it. Upstream it only emits a
   `delayed_bug` when opaque types leak; a lane that wants the check calls `infcx.drop()` where the `InferCtxt` goes
   out of scope.
9. **Generated enum companions** with methods: `X.method(self, ..)`. The enums with data whose `.gen.ts` has no companion
   get `{} as Companions["X"]`.

## `unported(...)` left
- **Placeholders:**
  - `InferCtxt`: 184 (`rustc_infer::infer::<mod>::InferCtxt::<name>`);
  - `TypeTrace` 4, `InferOk` 2, `At` 7;
  - `RegionConstraintCollector` 23, `RegionConstraintStorage` 2, `RegionConstraintData` 1, `Constraint` 2;
  - `LexicalRegionResolutions` 4, `FreeRegionMap` 5, `RegionRelations` 2;
  - `OpaqueTypeStorage` 10, `OpaqueTypeStorageEntries` 1, `OpaqueTypeTable` 3;
  - `OutlivesEnvironment` 5, `TypeFreshener` 4, `SnapshotVarData` 2, `TypeRelating` 2, `LatticeOp` 2;
  - `Obligation` 12, `Normalized` 1, `ProjectionCache` 9, `ProjectionCacheStorage` 2, `ProjectionCacheKey` 1;
  - the companions `ValuePairs`, `SubregionOrigin`, `RegionVariableOrigin`, `GenericKind`, `VerifyBound`,
    `RegionResolutionError`, `ScrubbedTraitError`, `TraitErrors`;
  - the 11 `FreeFns`, the 14 `ToTrace_<T>.to_trace`, the 5 `TraitEngine_provided` methods, the 6 manual Debug stubs;
  - rustc_trait_selection: 30 extension methods.
- **Generated:**
  - `unported_debug` for `PhantomData` fields, `UpvarId`, `ParamEnv`, `AliasTerm`, `PolyFnSig`,
    `PolyExistential*`, `ty::RegionConstraint`, `ConstraintCategory`, `TransitiveRelation`;
  - `unported_clone` for `TransitiveRelation` (`FreeRegionMap`) and `SnapshotMapStorage`;
  - `unported_type_fold` for `ExpectedFound` (`ValuePairs`), `PlaceholderType` (`GenericKind`), and in
    `QueryRegionConstraint(s)`: `ArgOutlivesClause`, `ty::RegionConstraint`, `ConstraintCategory`.
  - `QueryResponse` has no TypeFoldable (generator bug, "For root" 3).
- **Reachable from the ported code:**
  - `CanonicalParamEnvCache::get_or_insert` stops at `visit_with_ParamEnv` (rustc_middle ty/mod.ts: ParamEnv's derive
    is not generated yet).
  - `InferCtxtInner::{projection_cache, opaque_types, unwrap_region_constraints}` stop at the stub `with_log` of their
    storages.
  - `InferCtxtInner::reverse` stops for opaque / region / projection undo entries.
  - `build_with_canonical` stops at `instantiate_canonical`.

## PORT decisions (please record)
1. **Contract layout:**
   - the crate types come from codegen (set `rustc_infer` + `infer.typemap.json`);
   - decls.ts holds the 4 contract classes and the method declarations (augmentations for the generated classes);
   - `Companions` / `FreeFns`;
   - comment-only declarations for single-file helpers;
   - stub modules with `unported_methods`;
   - the init-order rule above.
2. **The field renames and `hand` types** of "Representation" 2.
3. **`InferCtxtLike` `ir_` renames** in rustc_type_ir ("Representation" 4).
4. **Extension traits as prototype methods**, `TyCtxt.prototype.infer_ctxt` ("Representation" 5).
5. **`Drop` as an uncalled `drop()`.**
6. **Lane split** as in the table, with context.rs -> infer-relate and outlives/env.rs -> infer-regions.
7. **`OpaqueTypeStorageEntries` is a codegen `class`**, so that it can carry
   `inherent::OpaqueTypeStorageEntries::needs_reevaluation`.

## For root
1. **Maps keyed by plain structs.** The lanes must replace these with `KeyedMap` / `KeyedSet`; the generated `Map` /
   `Set` types accept subclasses. Each owning class comment says so:
   - `OpaqueTypeStorage.opaque_types` (`FxIndexMap<OpaqueTypeKey, _>`);
   - `RegionConstraintStorage.{lubs,glbs}` (`CombineMap`, keyed by `TwoRegions`);
   - `RegionBoundPairs` and `OutlivesEnvironment.higher_ranked_assumptions` (sets of `OutlivesClause` structs);
   - the `ProjectionCache` `SnapshotMap` (keyed by `ProjectionCacheKey`);
   - `TypeRelating.cache` (tuples).

   `RegionConstraintStorage::default_` starts with plain `Map`s.
2. **Coordination with evalctxt-contract** (parallel). rustc_next_trait_solver's code over `InferCtxtLike` must call
   the `ir_` names (`delegate.ir_sub_regions(..)`, ...). rustc_trait_selection's `SolverDelegate` derefs to
   `InferCtxt`, so it gets them from `InferCtxt.prototype`. If that lane also creates `src/rustc_trait_selection/lib.ts`,
   merge the two import lists (rustc_infer first).
3. **Codegen generator bugs** (tools/codegen/types.ts, not changed here):
   - (a) A type parameter named `R` clashes with the visitor's `R` in the generated `visit_with_<T><R, R>`. Set
     `rustc_infer` therefore lists `type_fold_types` without `QueryResponse`, so `QueryResponse` has no TypeFoldable
     yet (needed by wave 20's canonical queries).
   - (b) A type-map `values` entry is imported only when the type's Debug is generated. `clone_ObligationCause` was
     missing in traits/mod.gen.ts; the workaround is a `helpers` entry in infer.typemap.json.
4. **`middle_traits_thir.typemap.json`** still maps `rustc_middle::infer::canonical::QueryResponse` to `unknown`
   ("lane infcx-contract"). The type is now generated (rustc_middle/infer/canonical.gen.ts) and can be pointed at
   (regenerate set `rustc_middle_traits_thir`). Not done here, to keep that set's outputs unchanged.
5. **Wire-up.** Nothing imports `src/rustc_infer/lib.ts` / `src/rustc_trait_selection/lib.ts` outside tests yet. The
   wave-16/17 consumers (hir_analysis collect, next solver) import them.
6. **Record the PORT decisions above.** Then point the wave-16 infer lanes at "How to fill a stub" and their split
   row, and the wave-17 trait-selection lanes at rustc_trait_selection/decls.ts.

## Checks
CHECKS_PLACEHOLDER
