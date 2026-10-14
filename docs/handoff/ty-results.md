# Handoff: ty-results (wave 15, M3): rustc_middle ty/{typeck_results,adjustment,structural_impls,fold,visit,error,diagnostics}.rs, ty/consts.rs, ty/consts/*

Branch `lane/ty-results` (from main ab2cdfc, no merges). Work was split over three agents in one worktree (helpers
`ty-results-a`: typeck_results + adjustment; `ty-results-b`: visit + error + diagnostics; the lane agent: the rest).

## Files touched
- **Ported (every fn, upstream order, markers):**
  - `src/rustc_middle/ty/structural_impls.ts` (was merge-w13's stub): D4 descriptors `fold_Ty`, `fold_Predicate`,
    `fold_Clause`, `fold_Clauses`, `fold_ValTree`, `fold_ErrorGuaranteed`, `fold_Pattern`, `visit_AdtDef`,
    `visit_TyAndLayout`, `fold_Spanned(d)`, `fold_LocalDefIds`, the `list_fold!` descriptors (`fold_BoundExistentialPredicates`,
    `fold_PredefinedOpaques`, `fold_PlaceElems`, `fold_PatList`, `fold_RegionAssumptions`, `fold_Consts`), the manual Debug
    impls (`debug_TraitDef`, `debug_AdtDef`, `debug_UpvarId`, `debug_Adjustment`, `debug_PatAdjustment`,
    `debug_LateParamRegionKind`, `debug_Ty`, `debug_ParamTy`, `debug_ParamConst`, `debug_Predicate`, `debug_Clause`,
    `debug_Expr`, `debug_GenericArg`), and the gen-shaped wrappers codegen calls (names unchanged).
  - `src/rustc_middle/ty/consts.ts` (`ConstExt`: `from_bits` .. `walk`), new `consts/int.ts` (`ScalarInt`, `ConstInt`,
    `AtomicOrdering`, `SimdAlign`, `CharTryFromScalarInt`, Debug/LowerHex/UpperHex/Display, `decode_ScalarInt`),
    `consts/kind.ts` (`Expr` companion), new `consts/lit.ts`, `consts/valtree.ts` (`ValTree` hash-consed class, `Value`
    struct + companion, Display, the derived Value traversal).
  - New `src/rustc_middle/ty/typeck_results.ts` (83/83), `adjustment.ts` (4/4) — helper a.
  - `visit.ts` (14/14), `error.ts` (8/8, `TypeError_to_string`), `diagnostics.ts` (19/19) — helper b.
  - `ty/fold.rs` was already 29/29 (tyir-binder); only its stand-in uses were repointed.
- **Edited outside the scope list (repoints of this lane's stand-ins; no parallel lane owns these files):**
  `context.ts` (`CommonConsts::new` real, `intern_valtree` real, `valtree` interner typed), `rustc_type_ir/fold.ts`
  (stand-in block `standin_fold_Ty/Clauses` deleted), and `standin_fold_*` → `fold_Ty`/`fold_Clauses` in binder.ts,
  visit.ts, ty_kind/closure.ts, universe.ts, fast_reject.ts, infer_ctxt.ts, outlives.ts, const_kind.ts, middle ty/fold.ts,
  print/pretty.ts, print/mod.ts; pretty.ts's ty-results stand-ins (`ValTree_*`, `Value_*`, `ScalarInt_*`, `ConstInt*`,
  `Expr_*_args`, `TargetDataLayout_pointer_size`, `UserTypeKind`) now delegate to the ports; `sty/consts.ts`
  `display_Value`, `walk.ts` `Value_ty`, `flags.ts` `add_const_kind` Value arm, `const_kind.ts` ConstKind Debug Value arm.
- **Tests:** new `structural_impls.test.ts` (10), `consts/consts.test.ts` (6), `consts/consts.oracle.test.ts` (2 oracle
  cases, probe `consts/consts_oracle/{probe.rs,run.ts,expected.json}`), `typeck_results.test.ts` (15), `error.test.ts` (27);
  pins updated in `interning.test.ts`, `contract.test.ts`, `context.test.ts`, `tyir_binder.test.ts` (real behaviour now).

## Coverage (`bun scripts/coverage.ts --missing`)
typeck_results 83/83, adjustment 4/4, structural_impls 64/64, fold 29/29, visit 14/14, error 8/8, diagnostics 19/19,
consts 14/14, consts/int 60/60, consts/kind 11/11, consts/lit 1/1, consts/valtree 22/22. `--check`: markers ok.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4351 pass, 1 skip (pre-existing), 1 fail on the first
  run (a stale `context.test.ts` pin, fixed in the last commit; that file now 17/17).
- difftest: `hir-tree-nocore --sample 200`: 198 MATCH, 2 UNPORTED (both `TyCtxt::is_method`, pre-existing; run
  `20261014-073330-ty-results-vzfq`); `resdump-nocore --sample 100`: 100/100 MATCH (`20261014-092326-ty-results-pxe5`).
- Every non-gen module under `rustc_type_ir/` and `rustc_middle/ty/` loads as a fresh entry point (the six `.gen.ts` /
  `print/mod.ts` TDZ failures exist on the base commit too).
- Const oracle: plain and `-Zverbose-internals` runs match the probe byte-for-byte (stdout/stderr/exit), minus the sections
  blocked on lane ty-sty (below), which consts.test.ts checks against the probe's lines with `Ty::is_ptr_sized_integral` /
  `is_bool` mocked with upstream's bodies.

## For root (merge)
1. **decls.ts:** replace `ValTree`, `Value` (`ty::Value`), `ScalarInt` with re-exports of `consts/valtree.ts` /
   `consts/int.ts`, and `TypeckResults` with `typeck_results.ts`'s class; then drop the `as_pending_Value` /
   `from_pending_Value` casts. `Const.try_to_target_usize` is declared `number`; upstream is `u64`: suggest `bigint`
   (now converted, ICE above 2^53).
2. **Repoint other lanes' stubs at this lane's descriptors:** ty/mod.ts `visit_with_Ty` / `try_fold_with_Ty` /
   `fold_with_Ty` → `fold_Ty`, `debug_Ty` → structural_impls' `debug_Ty`; ty/predicate.ts gen-shaped Predicate/Clause impls +
   `debug_Predicate` / `debug_Clause` → `fold_Predicate` / `fold_Clause` / debug fns; ty/generic_args.ts `debug_GenericArg`
   → structural_impls'. Until then generated code (e.g. `PredicateKind` folds) stops at those stubs.
3. **Stand-ins here to repoint when their lanes land:** structural_impls.ts `fold_list` / `try_fold_list` (ty-util;
   upstream bodies), `visit_List` (generic_args.rs:714, ty-args; upstream body), `Predicate_upcast_from_PolyProjectionClause`
   (ty-args), `AdtDef_did`, `Pattern_deref`, `debug_BinOp/UnOp/CastKind`, `fold_PlaceElem` (M4); valtree.ts / lit.ts
   `AdtDef_*` (ty-adt-assoc), `layout_size_of` (M4), `DestructuredAdtConst` (ty-mod); consts.ts `layout_of_size` (M4),
   `TypingEnv_fully_monomorphized` (ty-mod); int.ts `Size_truncate` / `Size_sign_extend` / `TargetDataLayout_pointer_size`
   (rustc_abi; upstream bodies). helper b: `AdtDef_descr`.
4. **tools/codegen:** typemap: `ScalarInt` → consts/int.ts `debug_ScalarInt`, `Consts` → list Debug of `debug_Const`
   (const_kind.gen.ts `debug_ValTreeKind` prints both via `unported_debug`; valtree.ts carries a same-derive copy until
   then). Add valtree.rs (Value derives) and typeck_results.rs to set rustc_ty; drop the hand-written derived impls.
5. **Driver observation (not changed):** with `after_expansion` → Stop and nothing lowered, rust-ts emits no buffered
   early lints (e.g. `internal_features`) while rustc does; the const oracle source avoids `lang_items` for that reason.

## `unported(...)` left
- rustc_apfloat: `ScalarInt::to_float`/`to_f16..f128`, `From<Half|Single|Double|Quad>` both ways.
- Layout (M4): `Const::from_bits` (so `from_bool`, `from_target_usize`), `Value::try_to_bits`.
- Other lanes: the stand-ins of "For root" 3; `OverloadedDeref::method_call` stops at `AssocItems::in_definition_order`;
  `short_string_namespace`'s long-type-file path (hashing by address + file I/O); `const_lit_matches_ty` CStr arm
  (`AdtDef::did`).

## PORT decisions (please record)
1. D4 descriptors as above; `Ty`/`Clauses` descriptors carry `Flags`; Predicate/Clause descriptors are `PredicateProxy`
   with a nested `flags` object. structural_impls.ts reaches extension modules only via lazy `require` (init order).
2. `ValTree` = `class extends Interned` with `internee`; `Deref` and `IntoKind::kind` are one `kind()` (two markers).
   `ty::Value` is a data struct + same-named companion; `ScalarInt` a frozen value class (`data: bigint`, `size_`), equality
   `ScalarInt_eq` / intern key. `From`/`TryFrom` impls are `ScalarInt.from_<T>` / `into_<T>` / `try_into_<T>` statics.
3. u64/i64 results of ScalarInt stay `bigint`; `Expr::call_args`' iterator is an array; `impl Into<u128>` params are `bigint`.
4. `TrivialTypeTraversalImpls!` etc. define no fns; trivial traversals (`Span`, `LocalDefId`) are inline descriptors.
5. Lift impls `rustc-skip`; ScalarInt `stable_hash`/`encode` skipped (M5); `decode_ScalarInt` hand-ported.
6. The oracle run replaces `FmtPrinter::new` by `new_with_limit(.., 2^24)` in-process (limits.ts stand-in, same as ty-print-b).
7. Helper a: private TypeckResults fields get a `_` suffix (name clash with accessors); `HashMapEntry` helper class;
   `FxIndexSet<(Predicate, ObligationCause)>` → `KeyedSet(intern_key)`. Helper b: `IsSuggestable` is one companion
   (trait + blanket impl); `FxIndexSet<BoundRegionKind>` → `KeyedSet`; local `str_cmp` / `dedup` (src/std candidates).
