# Handoff: ty-utils (M3, wave 16): the parts of rustc_ty_utils that typeck needs

Branch `lane/ty-utils` (from `00ce463`, no merges).

## Mapping of the brief to the pin
- `errors.rs` does not exist at the pin: the diagnostics are `compiler/rustc_ty_utils/src/diagnostics.rs`.
- `sig_types.rs` does not exist at the pin: `walk_types` / `SpannedTypeVisitor` moved to the new crate
  `compiler/rustc_ty_walk/src/lib.rs` (rustc_ty_utils depends on it). Ported as `src/rustc_ty_walk/lib.ts`.
  Root: record as a decision; `harness/scope.json` lists no excluded crate for it, so nothing else is needed.

## Files
- New, ported (every fn in upstream order, markers):
  - `src/rustc_ty_utils/ty.ts`: ty.rs 11/11 (`sizedness_constraint_for_ty`, `defaultness`, `adt_sizedness_constraint`,
    `param_env`, `ImplTraitInTraitFinder` (`visit_binder`, `visit_ty`), `param_env_normalized_for_post_analysis`,
    `asyncness`, `unsizing_params_for_adt`, `impl_self_is_guaranteed_unsized`, `provide`).
  - `src/rustc_ty_utils/implied_bounds.ts`: 4/4 (`provide` with the `assumed_wf_types_for_rpitit` closure,
    `assumed_wf_types`, `fn_sig_spans`, `impl_spans`).
  - `src/rustc_ty_utils/opaque_types.ts`: 12/12 (`OpaqueTypeCollector` + `TaitInBodyFinder`, `CollectionMode`,
    `opaque_types_defined_by`, `provide`).
  - `src/rustc_ty_utils/representability.ts`: 6/6.
  - `src/rustc_ty_utils/nested_bodies.ts`: 3/3.
  - `src/rustc_ty_utils/needs_drop.ts`: 19/19 (incl. the nested `with_query_cache`).
  - `src/rustc_ty_utils/structural_match.ts`: 2/2.
  - `src/rustc_ty_walk/lib.ts`: 2/2 (`SpannedTypeVisitor::visit`, `walk_types`).
- Generated: `src/rustc_ty_utils/diagnostics.gen.ts` (new codegen set `rustc_ty_utils` in
  `tools/codegen/types.sets.json`, `typemap_extra: tyir.typemap.json`; 6 types, 6 Diagnostic/Subdiagnostic derives,
  report clean: 0 unknown types, 0 missing IntoDiagArg). Hand module `diagnostics.ts` re-exports it.
  `tools/codegen/diag_args.json`: two entries, `rustc_middle::ty::Ty` -> `Ty_into_diag_arg` (ty/diagnostics.ts) and
  `rustc_middle::ty::GenericArg` -> `GenericArg_into_diag_arg` (ty/generic_args.ts). Other lanes adding a `Ty`
  diag-arg entry in the same wave will conflict textually; keep one.
- `src/rustc_ty_utils/lib.ts`: `provide` now calls assoc, implied_bounds, needs_drop, opaque_types,
  representability, ty, structural_match, nested_bodies in upstream order; abi, layout, instance (M4+), common_traits
  and consts stay commented out.
- Tests (new): `src/rustc_ty_utils/representability.test.ts` + `representability_test/` (driver with the real
  representability providers), `src/rustc_ty_utils/ty.test.ts` + `ty_test/` (driver report of the HIR-only providers).

## Coverage
`--missing`: ty.rs 11/11, implied_bounds.rs 4/4, opaque_types.rs 12/12, representability.rs 6/6, nested_bodies.rs 3/3,
needs_drop.rs 19/19, structural_match.rs 2/2, diagnostics.rs 0/0, lib.rs 1/1, rustc_ty_walk lib.rs 2/2.
`bun scripts/coverage.ts --check`: markers ok (12317; vendor 3888).

Not started (out of scope): `abi.rs`, `layout.rs` (+ `layout/`), `instance.rs` (codegen era, M4+).
Also not in this lane's list and not started: `common_traits.rs` (`is_copy_raw` & co., need trait_selection) and
`consts.rs` (abstract consts / THIR).

## `unported(...)` left
- PORT(stand-in) blocks at the top of `ty.ts` and `structural_match.ts` (repoint on merge, then delete):
  - `rustc_infer::infer::TyCtxtInferExt::infer_ctxt (lane infcx-contract)` (both files) — `tcx.infer_ctxt()`; the
    builder/`InferCtxt` surface used is `ignoring_regions()`, `build(TypingMode)`, `.tcx`.
  - `rustc_trait_selection::traits::ObligationCtxt::new` (both files) — methods used: `normalize(cause, param_env,
    Unnormalized<T>, d_T)`, `register_bound(cause, param_env, ty, def_id)`,
    `evaluate_obligations_error_on_ambiguity().no_errors()`.
  - `rustc_trait_selection::traits::normalize_param_env_or_error` (ty.ts, end of `param_env`).
  So `param_env`, `impl_self_is_guaranteed_unsized` and `has_structural_eq_impl` stop UNPORTED until rustc_infer /
  rustc_trait_selection land (param_env stops earlier today, at `clauses_of`).
- Reached, not mine: the rustc_hir_analysis providers (`clauses_of`, `fn_sig`, `type_of`, `adt_def`, `generics_of`,
  `explicit_item_bounds`, `explicit_clauses_of`, `item_bounds`, `const_conditions`, `anon_const_kind`, ...: the
  `install_unported_providers` placeholders); `mir_coroutine_witnesses` (M4; read by `NeedsDropTypes::next` only in
  exhaustive mode); `GlobalCtxt::data_layout` (`Ty::new_array` via `Const::from_target_usize`).
- **E0072 through the real provider**: `check_representability` now goes through `check_representability_adt_ty(Ty)`
  as upstream does, so every representability cycle has a `check_representability_adt_ty` frame, and
  `create_cycle_error` describes every frame. That query's `desc` is still
  `unported("desc of query `check_representability_adt_ty` (Display of `rustc_middle::ty::Ty`)")` in queries.gen.ts
  (merge-w15b "Left for root": typemap.lint.json shadows `rustc_middle::ty::Ty` as `unknown` for queries.ts).
  representability.test.ts runs the six E0072 programs of `rustc_query_impl/cycle_oracle` through the real providers
  (stand-ins only for `adt_def` / `type_of` / `generics_of` / `check_well_formed`) and pins that stop; a
  representable program (`ok.rs`, fields/tuples/arrays/enums, exercising `params_in_repr`) passes clean. The
  query-growth cycle oracle (its own stand-in `check_representability`) is unchanged and still 12/12. **When the desc
  is generated, flip the rec tests to the oracle comparison (comment `EXPECT_ORACLE` in the test; fixtures are the
  oracle's `.stderr`, re-checked by the test).** In the real pipeline none of this is reachable yet (`check_well_formed`
  is a placeholder).

## PORT decisions
1. `sig_types.rs` -> `rustc_ty_walk/lib.ts` and `errors.rs` -> `diagnostics.rs` (pin layout, above).
2. D4: `SpannedTypeVisitor::visit`, `OpaqueTypeCollector::visit_spanned` take the descriptor of the visited value last;
   local descriptors for `Binder<Ty>`, `Unnormalized<Ty>`, `&[GenericArg]` (rustc_ty_walk) and `ProjectionAliasTy`
   (`Alias<DefId>`, `DefId` a trivially-foldable leaf; ty.ts).
3. Query values / keys typed `unknown` in queries.gen.ts are cast at the read site (as assoc.ts); providers with an
   `unknown` key are installed through a casting lambda.
4. `NeedsDropTypes` is an iterator driven with `next()` by the callers, keeping upstream's laziness (`.filter().next()`
   stops at the first kept item, `collect::<Result<..>>` at the first `Err`). `DropTysOptions` methods on a companion
   const (field names = method names). `DtorType`, `CollectionMode`: string unions.
5. `itertools::zip_eq` is a local helper with itertools 0.15's panic text; `iter::repeat(span)` of `impl_spans` is an
   infinite generator tail, as upstream.
6. `ImplTraitInTraitFinder.depth` is a `MutRef<DebruijnIndex>` (`shift_in` / `shift_out` take `&mut`).
7. `OpaqueTypeCollector.span` field is `span_` (method name clash). `TraitRef` equality (derived `PartialEq`) is a
   local `TraitRef_eq` (`def_id` by value, interned `args` by identity).
8. Tracing (`#[instrument]`, `debug!`, `trace!`) left out; `debug_assert!`s kept as comments.
9. Test drivers (`representability_test/run.ts`, `ty_test/run.ts`) are test code with PORT (test) stand-ins, like
   `rustc_query_impl/cycle_oracle/run.ts`; `ty_test` prints def ids as `DefPath::to_string_no_crate_verbose`
   (`def_path_str` of an impl item needs `type_of`). Note for whoever extends them: a query whose provider stopped
   (Unported) is poisoned; querying it again raises `FatalError`, as upstream after a panic.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Full test run" below.
- Fresh-process loads of every new module (`rustc_ty_utils/{lib,ty,needs_drop,opaque_types,implied_bounds,
  structural_match,representability,nested_bodies,diagnostics}.ts`, `rustc_ty_walk/lib.ts`): ok.
- Samples (`RUST_TS_AGENT=ty-utils`), no DIFF, no CRASH, nothing protected lost:
  - hir-tree-nocore --sample 200: 195 MATCH / 5 UNPORTED (`20261014-113618-ty-utils-gjes`): `fn_sig provider (not
    ported)` x4 (delegation, pre-existing), `StableHash without a TS impl` x1 (pre-existing).
  - hir-tree --sample 200: 195 MATCH / 5 UNPORTED (`20261014-113705-ty-utils-n1tp`): same five.
