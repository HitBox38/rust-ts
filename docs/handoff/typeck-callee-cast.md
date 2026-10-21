# Handoff: typeck-callee-cast (M3 wave 18b, rustc_hir_typeck callee.rs + cast.rs)

Branch `lane/typeck-callee-cast` (from integ `a5910d3`, no merges).

## Result
- `compiler/rustc_hir_typeck/src/callee.rs` -> `src/rustc_hir_typeck/callee.ts`: **17/17** (`bun scripts/coverage.ts --missing`).
  `check_legal_trait_for_method_call`, `check_expr_call`, `check_call_abi`, `try_overloaded_call_step`,
  `try_overloaded_call_traits`, `is_scalable_vector_ctor`, `identify_bad_closure_def_and_call`,
  `maybe_suggest_bad_array_definition`, `confirm_builtin_call`, `check_argument_types_maybe_method_like`,
  `get_info_for_method_call_adjustments`, `suggest_call_as_method`, `report_invalid_callee`,
  `confirm_deferred_closure_call`, `enforce_context_effects`, `confirm_overloaded_call`, `DeferredCallResolution::resolve`.
- `compiler/rustc_hir_typeck/src/cast.rs` -> `src/rustc_hir_typeck/cast.ts`: **22/22**. `FnCtxt::pointer_kind`,
  `CastError::from`, `make_invalid_casting_error`, `check_cast`, `CastCheck::new` and all 16 `CastCheck` methods,
  `index_operand_ambiguity_span`.
- Both stubs' `unported_methods(..)` lists are gone (every method assigned). No signature in decls.ts changed; no
  `declare module` override.

## Files touched
- `src/rustc_hir_typeck/callee.ts`, `src/rustc_hir_typeck/cast.ts` (only these).
- `docs/handoff/typeck-callee-cast.md` (this file).

## PORT decisions (please record)
1. **`impl From<ErrorGuaranteed> for CastError`** (decls.ts comment-only `cast.rs:207`) is the free fn `CastError_from(err)`
   in cast.ts; each `?` on `pointer_kind(..)` in the `check_*_cast` methods is written `Err(CastError_from(e))`.
2. **`#[derive(PartialEq)] PointerKind`** is the hand fn `PointerKind_eq` in cast.ts (PORTING §5 "on data -> `<type>_eq`"):
   `VTable` compares the interned list by identity, `OfAlias` compares kind tag + `DefId_eq` + interned args,
   `OfParam` compares `index`/`name`.
3. **`rustc_middle::ty::cast::CastTy`** is not ported (rustc_middle/src/ty/cast.rs, 73 lines, no owner). cast.ts has a
   local stand-in alias `CastTy` in PORTING's standard representation and `CastTy_from_ty(t)` =
   `unported("rustc_middle::ty::cast::CastTy::from_ty")` (precedent: thir-cx-print's MIR stand-ins). `do_check` is ported
   in full against the stand-in; swap both for the real import once ty/cast.rs is ported.
4. **TypeFoldable descriptors over generated derives** (D4 pattern, like `fold_FnSig`): `fold_PointerKind` (cast.ts, over
   cast.gen.ts's derives, for `erase_and_anonymize_regions(Option<PointerKind>)` via `fold_Option`) and
   `fold_CoroutineClosureSignature` (callee.ts, over closure.gen.ts's derives, for `instantiate_binder_with_fresh_vars`).
5. **`DefIdOrName`** is `Pending` in decls.ts (wave 19). `report_invalid_callee` reads the value `extract_callable_info`
   returned through a local alias `DefIdOrNameRepr = {$:"DefId",_0} | {$:"Name",_0: string}` (the standard representation
   of upstream's `enum DefIdOrName { DefId(DefId), Name(&'static str) }`); drop it when the type lands.
6. **`fcx.err_ctxt().report_fulfillment_errors(..)`** (cast.rs `try_report_ambiguous_binop_for_infer_cast`) is read through
   rustc_trait_selection's `TypeErrCtxtView` (`fcx.err_ctxt() as unknown as TypeErrCtxtView`), as that crate does until the
   errctxt contract lands.
7. **Owned clones**: `try_report_ambiguous_binop_for_infer_cast` clones each pending obligation (`clone_Obligation`) before
   mutating its `cause.span` / `predicate` (upstream iterates an owned `Vec` returned by `pending_obligations()`).
8. Small mechanical choices: `Obligation::new(.., clause)` uses a local `upcast_Clause` (precedent: traits/effects.ts);
   `prev_types: FxHashMap<HirId, _>` is a `HirIdMap`; `*adjustments.entry(id).or_default() = v` is `insert(id, v)`;
   `assert_eq!(splatted, None, "msg")` is written out (std `assert_eq` has no message parameter) with core's text;
   `traits.sort()` on `Vec<String>` uses a code-point comparator (`cmp_string`, = Rust's byte-wise UTF-8 order).

## `unported(...)` left (in my files)
- `rustc_middle::ty::cast::CastTy::from_ty` (cast.ts `CastTy_from_ty`): reached by **every non-coercion cast** (`CastCheck::check`
  -> `do_check` after `try_coercion_cast` fails, e.g. `1u32 as u8`) and by `check_cast`.
- Indirect (generated code, not my files): `PointerKind::VTable` has no generated TypeVisitable/TypeFoldable (cast.gen.ts
  `unported_type_fold`, the codegen report's "missing TypeFoldable (cast.rs `List`)"), so `check_ptr_ptr_cast`'s
  `erase_and_anonymize_regions` stops for any `*const dyn A as *const dyn B` style cast; `PointerKind::OfAlias` Debug
  (`AliasTy`) is unported but only reached by the `span_bug!` text of `report_cast_error`.

## Cross-lane needs (for root)
1. **Port rustc_middle `ty/cast.rs`** (`CastTy`, `from_ty`, `is_int_like`, `mir_cast_kind`; also needed by MIR building).
   Success path: blocks every non-coercion `as` cast.
2. **Codegen**: map cast.rs's `&'tcx ty::List<ty::Binder<'tcx, ty::ExistentialPredicate<'tcx>>>` to the existing
   `I::BoundExistentialPredicates` fold fns (`visit_with/try_fold_with/fold_with_BoundExistentialPredicates`,
   type_fold.json) and give `AliasTy` a Debug in the `rustc_hir_typeck` set; regenerate cast.gen.ts.
3. **Wave 19 (error path only)** reached from my code: `FnCtxt::extract_callable_info` (first statement of
   `report_invalid_callee`, i.e. every "expected function, found .." error), `FnCtxt::suggest_closure_to_fn_ptr_coercion`
   (NonScalar cast error), `FnCtxt::err_ctxt` + `report_fulfillment_errors` (ambiguous binop `as _`). No success-path
   wave-19 function is needed.
4. **Other typeck lanes my success path calls** (placeholders until merge): typeck-expr-a (`check_expr`,
   `check_expr_with_expectation_and_args`, `precedence`), typeck-impl (`deeply_resolve_ignoring_regions_with_obligations`,
   `apply_adjustments`, `record_deferred_call_resolution`, `normalize`, `register_wf_obligation`, `register_bound`,
   `require_type_is_sized`, `write_method_call_and_enforce_effects`, `write_resolution`, `structurally_resolve_type`,
   `type_must_be_known_at_this_point`, `node_ty`, `field_ty`), typeck-checks-a (`check_argument_types`), typeck-method
   (`lookup_method_for_operator`, `ConfirmContext::new` / `create_ty_adjustments_from_pick`), typeck-probe
   (`probe_for_name`), typeck-coerce (`coerce`, `may_coerce`, `demand_eqtype`, `demand_suptype`). Callers of my code:
   expr-a (`check_expr_call`, `CastCheck::new`), checks-a (`check_casts` -> `CastCheck::check`), upvar
   (`DeferredCallResolution::resolve`), method (`check_legal_trait_for_method_call`).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (15202; vendor 3888)`.
- `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/callee.rs`: 17/17; `.../cast.rs`: 22/22.
- `bun test src/rustc_hir_typeck --timeout=60000`: 12 pass / 0 fail (contract.test.ts, incl. "every declared method and
  static exists at runtime" after the placeholder lists were removed).
- No pre-existing unit test's pinned stop moved (nothing re-pinned).

## Samples
Base = integ `a5910d3` in a temporary detached worktree (`RUST_TS_AGENT=callee-cast-base`, removed afterwards), lane =
this branch (`RUST_TS_AGENT=typeck-callee-cast`), same `--seed typeck-callee-cast`. Identical counts, no new DIFF:

| suite | lane run | MATCH | DIFF | UNPORTED | CRASH | base run |
|---|---|---|---|---|---|---|
| tydump-minicore (46, full) | `20261015-081357-typeck-callee-cast-lmh2` | 5 | 0 | 41 | 0 | `20261015-081630-callee-cast-base-rsc9`: 5/0/41/0 |
| tydump-nocore `--sample 100` | `20261015-081434-typeck-callee-cast-6t2l` | 80 | 0 | 20 | 0 | `20261015-081659-callee-cast-base-f0sx`: 80/0/20/0 |
| hir-tree-nocore `--sample 100` | `20261015-081528-typeck-callee-cast-syfg` | 100 | 0 | 0 | 0 | `20261015-081807-callee-cast-base-96io`: 100/0/0/0 |

Top stops (none in my files; typeck bodies still stop at other lanes' placeholders, first `rustc_hir_typeck::loops::check`
of lane typeck-lib-wb, so callee/cast code is not exercised by these samples yet):
- tydump-minicore: `FulfillmentContext::new` (old solver, wave 20) 34, `check_unused_traits provider` 3, StableHash 2.
- tydump-nocore: `QueryKey for (CanonicalImpliedOutlivesBoundsGoal, bool)` 4, `LateParamRegionKind::from_bound` 3,
  `IntegerExt::from_int_ty` 3, `QueryKey for LitToConstInput` 3, `EarlyParamRegion: RegionName::is_named` 2.
