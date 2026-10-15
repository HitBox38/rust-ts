# Handoff: typeck-lib-wb (M3 wave 18b, rustc_hir_typeck)

Branch `lane/typeck-lib-wb` (from integ `a5910d3`, no merges). Upstream compiler/rustc_hir_typeck/src/ check.rs,
writeback.rs, fallback.rs, opaque_types.rs, loops.rs: all ported.

## Result
- **loops.rs** (11/11): `loops::check`, `CheckLoopVisitor` (hand class), `Display for BreakContextKind`. Every typeck body
  now passes `loops::check`. Verified byte-identical against the oracle on two no_core fixtures through a driver runner
  (`loops.test.ts`, below): E0267/E0268 (with the labeled-block suggestion), E0590, E0695, E0696, inline const, closures,
  `#[loop_match]`/`#[const_continue]` (`emit_fatal`).
- **check.rs** (3/3): `check_fn`, `check_panic_info_fn`, `check_lang_start_fn`.
- **writeback.rs** (55/55): `FnCtxt::resolve_type_vars_in_body`, `WritebackCx` (`new`, inherent methods, the 9 `Visitor`
  overrides), `Locatable::to_span` (both impls), `Resolver`, `EagerlyNormalizeConsts`, `HasRecursiveOpaque`.
- **fallback.rs** (18/18): `type_inference_fallback` .. `try_to_suggest_annotations`, `AnnotateUnitFallbackVisitor`,
  `compute_unsafe_infer_vars` (+ the fn-local `UnsafeInferVarsVisitor`, `InferVarCollector`).
- **opaque_types.rs** (6/6): `try_handle_opaque_type_uses_next`, `handle_opaque_type_uses_next`, `UsageKind::merge`,
  `compute_definition_site_hidden_types`, `consider_opaque_type_use`, `detect_opaque_types_added_during_writeback`.

## Files touched
- `src/rustc_hir_typeck/{loops,check,writeback,fallback,opaque_types}.ts` (stubs filled; hand types replaced by classes
  under the same exported names).
- New: `src/rustc_hir_typeck/loops.test.ts`, `src/rustc_hir_typeck/loops_test/{run.ts, loops_basic.rs, loops_more.rs,
  *.stderr, *.exit}` (oracle fixtures written by `REGEN=1`, pattern of rustc_privacy's privacy_test).
- `src/rustc_hir_typeck/contract.test.ts` (outside my files, test only): the "placeholders stop as UNPORTED" probe of the
  three free/associated fns (`CastCheck::new`, `check::check_fn`, `loops::check`) had one shared guard
  (`unported_stub_path(CastCheck.new)`), so porting `loops::check` failed it while `CastCheck::new` is still a stub. The
  guard is now per entry (the target's own body contains `unported("<path>")` or it is a registered placeholder); no
  assertion weakened. **Merge note:** typeck-callee-cast (CastCheck::new) may touch the same lines.
- `src/rustc_privacy/privacy.test.ts` (re-pin, see below).

## Coverage (`bun scripts/coverage.ts --missing`)
check.rs 3/3, writeback.rs 55/55, fallback.rs 18/18, opaque_types.rs 6/6, loops.rs 11/11. Crate: 169/1041.
`coverage.ts --check`: markers ok (15256; vendor 3888).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_hir_typeck --timeout=120000`: 15 pass / 0 fail (contract 12 + loops 3). `bun test src/rustc_privacy`:
  13 pass after the re-pin.

## Samples (no new DIFF, no stop change vs base)
Base = a5910d3 snapshot (`RUST_TS_AGENT=typeck-lib-wb-base`), same cases/seeds; per-case status+stop compared: 0 changed.

| suite | lane run | MATCH | DIFF | UNPORTED | base run |
|---|---|---|---|---|---|
| tydump-minicore (46 full) | `20261015-083212-typeck-lib-wb-oiwz` | 5 | 0 | 41 | `20261015-082217-typeck-lib-wb-base-q6tj` (5/0/41) |
| tydump-nocore `--sample 100 --seed typeck-lib-wb` | `20261015-083126-typeck-lib-wb-vxbg` | 83 | 0 | 17 | `20261015-082321-typeck-lib-wb-base-1gmb` (83/0/17) |
| hir-tree-nocore `--sample 100 --seed typeck-lib-wb` | `20261015-082502-typeck-lib-wb-qf3m` | 100 | 0 | 0 | — |

None of the sampled cases reaches typeck yet. Top stops: minicore 34x `FulfillmentContext::new` (old solver, selcx-contract),
3x `check_unused_traits provider`, 2x `StableHash without a TS impl`; nocore 6x `QueryKey for
(CanonicalImpliedOutlivesBoundsGoal, bool)` (wfcheck), 2x `LateParamRegionKind::from_bound`, singles in rustc_middle
(erase_and_anonymize_regions, layout IntegerExt, query keys). A hand-written no_core `const C: () = { break; };` now
prints the oracle's E0268 and stops at `rustc_hir_typeck::fn_ctxt::_impl::FnCtxt::normalize` (lane typeck-impl).

## Re-pinned tests
- `src/rustc_privacy/privacy.test.ts` "clean_pub.rs (--mod-privacy)": stop moved from `rustc_hir_typeck::loops::check` to
  `rustc_middle::ty::region::LateParamRegionKind::from_bound` (`liberate_late_bound_regions` in `typeck_with_inspect`,
  right after `loops::check`); exit 70 kept.

## `unported(...)` left
- rustc_trait_selection **opaque_types.rs is not ported** (no lane owns it): shims in opaque_types.ts
  `opaque_type_has_defining_use_args`, `NonDefiningUseReason::report`, `NonDefiningUseReason` (the `Tainted` match),
  `report_item_does_not_constrain_error`. Reached by the old solver's `visit_opaque_types` and the next solver's
  `consider_opaque_type_use` whenever a body has opaque-type uses.
- Not-generated `TypeFoldable` derives (unported descriptors, precedent rustc_hir_analysis check/check.ts):
  `ty::ProvisionalHiddenType` (writeback/opaque_types: any opaque use), `ty::ClosureSizeProfileData`
  (`closure_size_eval`, only with closure size profiling), `ty::CapturedPlace` and `hir::place::Place` (closure
  min-captures / fake reads / kind origins: pending rustc_middle hir/place.rs, lane typeck-euv).
- Through `FnCtxt::err_ctxt()` (wave 19, already unported): `Resolver::report_error` (E0282 on unresolved infer vars),
  `report_fulfillment_errors` in `Resolver::handle_term` / `consider_opaque_type_use`, the E0282 of
  `UnconstrainedHiddenType`. Called through a local `TypeErrCtxtView` (precedent rustc_trait_selection traits/mod.ts).
- `BreakNonLoop_into_diag` (diagnostics.rs manual impl, wave 19) is reached by `break <value>` out of `while`/`for`.
- `SuggestAnnotations_add_to_diag` (manual impl, wave 19) is reached by the `NEVER_TYPE_FALLBACK_FLOWING_INTO_UNSAFE` lint.

## PORT decisions (please record)
1. `BTreeMap<OrdSpan, BlockInfo>` (loops.rs) is `SortedMap<OrdSpan, BlockInfo>` ordered by `OrdSpan::cmp`;
   `entry().or_insert_with` is `get` + `insert`.
2. `Display for BreakContextKind` is `display_BreakContextKind`; `find_attr!(tcx, hir_id, X(_))` is
   `find_attr(HasAttrs_HirId.get_attrs(..), ..) !== undefined`.
3. `trait Locatable` is decls.ts's `Locatable = Span | HirId`; `to_span` is `Locatable_to_span` (dispatches on number vs
   object) with the two impls as `Span_to_span` / `HirId_to_span`.
4. `UnordMap<LocalDefId, _>::to_sorted(hcx, _)` sorts by the keys' `DefPathHash` (precedent rustc_resolve
   late/diagnostics.ts); `coercion_casts().to_sorted_stable_ord()` sorts `ItemLocalId`s numerically.
5. `DefinitionSiteHiddenType` fields are readonly: writeback's `entry.span = prev.span.substitute_dummy(..)` re-inserts a
   new value in the same `FxIndexMap` slot (JS `Map.set` keeps the slot).
6. `UsageKind::merge(&mut self, ..)` is `UsageKind_merge(MutRef<UsageKind>, other)` (exported free fn).
7. The fn-local types of `compute_unsafe_infer_vars` (`UnsafeInferVarsVisitor`, `InferVarCollector`) are module-private
   classes; `try_insert` is `has` + `set`.
8. `.take().unwrap()` on `Cell<Option<OpaqueTypeStorageEntries>>` / `RefCell` values: read the field and assign
   `undefined`; `mem::take` of `used_trait_imports` / `hidden_types`: read and assign a fresh `Set` / `Map`.

## For root (decls / cross-lane)
1. **decls.ts imports `CoerceMany` from `./coercion.gen.ts`** (the generated class, whose field is `expected_ty`) instead of
   the hand class of `./coercion.ts` (`expected_ty_` + methods). `FnCtxt.ret_coercion` and `if_fallback_coercion(..,
   coercion: CoerceMany)` are therefore typed with the wrong class: check.ts casts at the two uses, marked
   `// PORT(decls): pending root`. Fix: `import type { CoerceMany } from "./coercion.ts"` in decls.ts (lane typeck-coerce
   will hit the same).
2. rustc_middle typeck_results.ts types `hidden_types` / `closure_size_eval` with local `Pending` aliases of
   `ty::DefinitionSiteHiddenType` / `ty::ClosureSizeProfileData` (both exist in ty/mod.ts now): writeback.ts /
   opaque_types.ts read them through `hidden_types_of` / `closure_size_eval_of` casts. Swap the aliases for the real types.
3. Codegen follow-ups: `TypeFoldable`/`TypeVisitable` derives of `ProvisionalHiddenType`, `ClosureSizeProfileData`
   (rustc_middle ty/mod.rs), `CapturedPlace` (ty/closure.rs, after hir/place.rs lands).
4. rustc_trait_selection `opaque_types.rs` (4 fns + `NonDefiningUseReason`) needs an owner (opaque types in any body).
