# Handoff: merge-w15a (fixer): wave 15a integration of the type-system and HIR-pretty lanes

Worktree `.data/integ`, branch `integ`, based on main `13d8197`. Merged with `--no-ff`, in this order:
tyir-binder, tyir-relate, tyir-misc, ty-ctxt, tyir-solve, ty-print-a, ty-print-b (added by root mid-task), hir-pretty-a,
hir-pretty-b. Each merge is followed by its fix-up, in the merge commit itself or in the commit right after it.
The ty-print-a merge auto-committed with tsc errors. The ty-print-b merge commit (`3ad9679`) fixes them, so
`bde9ffe` alone does not type-check.

## Conflicts and how they were resolved
- **tyir-misc**
  - `rustc_type_ir/error.ts`: tyir-relate and tyir-misc made identical ports (only the header comment differed).
    Kept one copy, with a header naming both lanes.
  - `data_structures/delayed_map.ts` (add/add): kept tyir-misc's version, `default_(key?)`. Callers in tyir-binder
    and tyir-relate were renamed from `default(key)` to `default_(key)`.
- **ty-ctxt**: `ty/contract.test.ts` "a stub stops as UNPORTED". Both lanes had moved the probe, and both changes
  are kept: the `typeck_root_def_id_local` stub, plus tyir-misc's `Region.new_static` / `Const.zero_sized`.
- **tyir-solve**: `interner.ts`. tyir-misc and tyir-solve had both ported `impl search_graph::Cx for I`. Kept
  tyir-solve's `Cx<InternerCx>` table, because that lane owns the trait.
- **ty-print-a + ty-print-b**: `ty/print/pretty.ts`.
  - Rebuilt the file as a's region followed by b's region.
  - Deleted both lanes' DELETE AT MERGE blocks.
  - Merged the two import blocks into one. `DefKind` and `DefPathData` are now value imports.
- **hir-pretty-a + hir-pretty-b**: `rustc_hir_pretty/lib.ts` (add/add).
  - Rebuilt the file as a's region followed by b's region.
  - Deleted both stand-in blocks.
  - Merged the import blocks, including b's `BoxMarker` / `Breaks` aliases.
  - Both lanes used the same `_` suffixes (`print_attr_item_`, `bclose_maybe_open_`, `bclose_`, `print_path_`,
    `print_path_segment_`, `print_generic_args_`). lib.rs is 119/119.

## Stand-ins repointed at the real code
- **decls**
  - `rustc_type_ir/decls.ts` re-exports `TypeWalker` (walk.ts), `CanonicalParamEnvCache` (canonical.ts), and the
    search graph's `GlobalCache` (as `GlobalCache<InternerCx>`) and `RequiredDepth`.
  - `rustc_middle/ty/decls.ts` re-exports `BoundVarReplacerDelegate` (ty/fold.ts) and `Print` (print/mod.ts).
    It also declares `def_path_str`.
  - The `Pending` casts in ty/fold.ts and `Cx_for_Interner.with_global_cache` are removed.
- **tyir-kind stand-ins** (now in lib.ts, unnormalized.ts and binder.ts):
  - `DebruijnIndex_shifted_in/out` is now `DebruijnIndex.shifted_in/out`. Callers: fold, visit, binder, flags,
    closure, rustc_middle fold, pretty.
  - `debug_bound_var` now comes from lib.ts.
  - `Unnormalized_new` is now `Unnormalized.new` / `new_wip` / `dummy`, matching upstream at each site.
  - `.value` is now `skip_normalization`.
- **Binder / visit stand-ins** (in tyir-relate, tyir-misc, ty-ctxt and ty-print files):
  - The `Binder_*` / `EarlyBinder_*` helpers are now `Binder.*` / `EarlyBinder.*`.
  - The `has_*` stand-ins are now `TypeVisitableExt.*`.
  - Placeholder accessors and `BoundRegionKind.get_name/is_named` now come from binder.ts. `BoundConst.new` is
    used too.
  - `DelayedSet` is the one in delayed_map.ts.
  - Where a stand-in stopped at the `TypeSuper*` impls of `Ty`, it now calls tyir-binder's `standin_fold_Ty`, so
    there is one stand-in for structural_impls.rs.
- **relate**
  - `Variance.xform` and `TraitRef` / `ExistentialTraitRef` / `ExistentialProjection.new_from_args`, `alias_kind`
    are repointed at their real ports.
  - `InferCtxtLike` is infer_ctxt.ts's interface. The relate test double types the missing members with an
    interface merge.
  - `TypingMode.assert_not_erased` is the real one.
  - `relate_Region` / `relate_Const` are now descriptors over sty's real fns. sty's `TypeRelation_*` slices became
    relate.ts's `TypeRelation`.
  - `Goal_new` now delegates to `Goal.new`.
- **region_constraint**: `elaborate` (as a lazy generator over `Elaborator`), `relate_args_invariantly`,
  `structurally_relate_*`, `relate_Ty`, `set_aliases_to_non_rigid`.
- **elaborate / outlives**
  - The `TraitClause` / `HostEffectClause` / `PolyTraitClause.def_id`, `UnnormalizedPolyTraitRef.to_host_effect_clause`
    and `skip_norm_wip` stand-ins are repointed.
  - The duplicate `UpcastFrom` stand-ins were merged into predicate.ts. Its 3 stand-ins now run upstream's bodies,
    as tyir-relate's did; before, they were `unported`.
- **context.ts and infer_ctxt.ts**
  - `EarlyBinder.no_bound_vars` / `instantiate` and `supertrait_def_ids` are repointed.
  - `inherent_Features.feature_bound_holds_in_crate` is used.
  - `GlobalCaches.default_()` now builds each field in order. It creates the search graph cache with
    `GlobalCache.default_()` (`#[derive(Default)]`; it has the same body as `new()`) and builds
    `CanonicalParamEnvCache`. It still stops UNPORTED first, at `traits::SelectionCache`.
- **solve/mod.ts**: `RegionConstraint.new_true` / `is_true` are repointed, and `UpcastFn` is now upcast.ts's
  `UpcastFrom["upcast_from"]`.
- **print**
  - mod.ts uses the real `FmtPrinter.new` / `display_Ty`, binder, predicate and unnormalized.
  - pretty.ts: a's binder / unnormalized / lib / predicate / elaborate stand-ins and b's tyir-binder / tyir-misc ones
    are repointed.
  - The local descriptors `fold_Ty_` and `descriptor_Binder` are now `standin_fold_Ty` and `fold_Binder`.
- **decoder.ts**: `DiagnosticItems.id_to_name` is a `DefIdMap`.

## Wiring done
- `IR_PRINT`:
  - Filled in print/mod.ts from the blanket `IrPrint` impl (mod.rs:427) for TraitRef, TraitClause,
    ExistentialTraitRef, ExistentialProjection, ProjectionClause, NormalizesTo, SubtypePredicate, CoercePredicate,
    HostEffectClause, AliasTy, AliasTerm, FnSig, Region and Const.
  - `PatternKind` stays empty, because its impl in ty/pattern.rs is not ported.
- `print::provide` (`trimmed_def_paths`) is called from `rustc_interface/passes.ts`, after `context::provide`.
- The `def_path_str` placeholder is removed from the context.ts class body.
- `tools/codegen/tyir.typemap.json`: `RequiredDepth` now comes from `search_graph/mod.ts` with its Debug.
  After regenerating set `rustc_ty`, `inspect.gen.ts` imports it from there.
- **Init order fix.** The `debug_ParamTy` stub moved from the extension module `ty/sty.ts` to
  `ty/structural_impls.ts`, and sty.ts re-exports it.
  - binder.ts and ty_kind.ts now import it from structural_impls.ts.
  - Before this, the merged graph evaluated `ty/sty.ts` before `Ty` existed, and `rustc_middle/lib.ts` failed to
    load with a TDZ error. This is the root cause from tyir-misc's note 1.
  - sty/mod.ts and sty/consts.ts load binder.ts lazily with `require`, the same way they load region_kind.
- Every module under `rustc_type_ir/` and `rustc_middle/ty/` loads as a fresh entry point.

## Not done / kept (for root)
- **`interner(tcx)` (relate.ts) and `as_interner(tcx)` (predicate.ts) casts are kept.** All Interner methods are
  real now, but `queries.gen.ts` still types some query values `unknown` (`generics_of`, ...), so `TyCtxt` is still
  not assignable to `Interner`. Drop the casts when the query types are generated.
- **The oracle run in print_oracle/run.ts still uses `TestPrinter`.** `FmtPrinter` names regions in binders, and its
  `fn(..)` rows stop UNPORTED at `impl TypeVisitable for &List<Ty>` (generic_args.rs:714). print.test.ts uses
  `FmtPrinter`. Switching run.ts would have weakened the matching oracle case, so test_printer.ts was not deleted.
- **Still stand-ins, waiting on unported lanes:**
  - ty-args / ty-results / ty-adt-assoc / ty-mod: `UpcastFrom` impls, structural_impls `TypeSuper*`, `AdtDef`,
    `ValTree`, `ScalarInt`, `Generics::own_args*`, `AssocItem`, `Instance`.
  - transitive_relation.rs.
  - `ParamEnv_caller_bounds`.
  - walk.ts `Pattern_kind` / `Value_ty`.
  - `LateParamRegionKind_from_bound`.
  - `relate_Ty` and the other rustc_middle ty/relate.rs impls.
  - context.ts's inline `unported` in `ty_is_opaque_future`, `get_impl_future_output_ty` and
    `needs_coroutine_by_move_body_def_id`. These need more than binder.rs.
- relate's `Upcast<T, U>` type stays `(from, TyCtxt) => U`. Its upcast fns call `tcx.mk_predicate`, so they cannot
  take `Interner`. `Goal_new` casts once when it calls `Goal.new`.
- ty-print-b's run.ts and test files still use `new_with_limit`, because limits.ts's `hir_krate_attrs` is still a
  stand-in.

## Test pins changed (real behaviour now, no matching case weakened)
- **tyir_misc_lib_sty**
  - `Const.new_anon_bound` / `new_canonical_bound` now intern the same consts; before, they were UNPORTED.
  - The `relate_Region` / `relate_Const` doubles are cast to `TypeRelation`.
- **tyir_misc_infer**: `simplify_type(Alias, AsRigid)` returns `Placeholder`. Before, it was UNPORTED at
  `has_non_region_infer`.
- **tyir_misc_predicate**
  - The `PolyTraitRef` helpers use a real binder and stop at the named rustc_middle stubs.
  - `TraitRef.new_from_args` on a real `TyCtxt` builds the struct (the debug assertion is a release no-op).
  - The registry test deletes the TraitRef slot itself. `display_Region` (slot now filled) panics with
    `no ImplicitCtxt stored in tls`, as upstream does.
  - `afterEach` restores the registered slot.
- **contract.test**: `COUNT_DECLARED` changed from 408 to 409 (`def_path_str`).
- **tyir_relate.test**: `RecordingInfcx` uses an interface merge with the real `InferCtxtLike`.

## PORT decisions to record
1. `debug_ParamTy` lives in ty/structural_impls.ts, and ty/sty.ts re-exports it. Defining modules must not import
   extension modules.
2. sty/mod.ts and sty/consts.ts reach binder.ts through a lazy `require`, for init order (same precedent as
   region_kind).
3. The one stand-in for the `Ty` / `Clauses` structural impls is tyir-binder's `standin_fold_Ty` /
   `standin_fold_Clauses`. Other lanes' duplicates point at it.
4. The `UpcastFrom` stand-ins of rustc_middle predicate.rs are merged in rustc_type_ir/predicate.ts and run upstream
   bodies.
5. `GlobalCaches::default` builds its fields in order. `new_solver_evaluation_cache` uses `GlobalCache.default_()`,
   which is the derive's `Default`.
6. `IR_PRINT` is filled in print/mod.ts, with lazy references to `print_X`.
7. `interner(tcx)` / `as_interner` stay until the query value types are generated.
8. The print_oracle run keeps `TestPrinter` until `TypeVisitable for &List<T>` is ported.
9. `Interner::item_self_bounds` (`impl IntoIterator`) is cast to the `Clauses` slice for `iter_instantiated` in
   outlives.ts.

## Results
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (11052; vendor 3888).
  - pretty.rs 125/125.
  - rustc_hir_pretty lib.rs 119/119.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4292 pass, 1 skip (the pre-existing linux-only
  one), 0 fail.
- Regenerating every codegen set (except `/`-prefixed keys and `rustc_lexer`) and `queries.ts`: no changes. The only
  generated change is the intended `rustc_ty` `inspect.gen.ts` import of `RequiredDepth`.
- `RUST_TS_AGENT=merge-w15a` difftest samples:
  - **parse --sample 200**: 200 MATCH / 0 DIFF / 0 UNPORTED (`20261014-063354-merge-w15a-gdt8`).
  - **expanded --sample 200**: 200 MATCH / 0 DIFF / 0 UNPORTED (`20261014-063414-merge-w15a-pfzt`).
  - **hir-tree-nocore --sample 300**: 298 MATCH / 0 DIFF / 2 UNPORTED (`20261014-063441-merge-w15a-y7dk`). Both
    stops were already listed by merge-w14 / tyir-misc:
    - `delegation/impl-trait.rs`: `TyCtxt::is_method`;
    - `layout/debug.rs`: `StableHash without a TS impl`.
  - **unpretty-hir --sample 200**: 198 MATCH / 0 DIFF / 2 UNPORTED (`20261014-062211-merge-w15a-6dz0`). The 2 stops
    are the same two cases.
