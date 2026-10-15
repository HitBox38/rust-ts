# Handoff: check-compare (M3, wave 17): rustc_hir_analysis `check/compare_impl_item.rs` + `compare_impl_item/refine.rs`

Branch `lane/check-compare` (from main `3e4773f`, no merges).

## Result
- **compare_impl_item.rs 35/35, refine.rs 10/10** ported in upstream order, every fn with its marker (the trait-impl
  methods of the local folder / visitor types included: `RemapLateParam`, `ImplTraitInTraitCollector` (both files),
  `RemapHiddenTyRegions`, `FindRegion`, the nested hir `Visitor` of `compare_synthetic_generics`, `Anonymize`,
  `CollectParams`).
- Nothing in the driver path calls the module yet: `check::provide` / `check_impl_items_against_trait` are lane
  check-check's. Suites are unchanged.
- **Reachable today, byte-identical to rustc** (in-process oracle test): E0049 (assoc fn / assoc type, more or fewer
  params, `impl Trait` labels) and E0053 (incompatible generic param kind, fn and type).
- **PENDING** (exact stop, see "Tests"): E0050, E0053 (signature), E0185, E0186, E0195, E0326, E0643 and the
  `refining_impl_trait` lint. Every method / type / const comparison reaches `compare_const_generic_param_types`, which
  builds an `ObligationCtxt` before E0050 and the later checks; E0185/E0186 stop earlier in `compare_self_type`
  (`TypingEnv::non_body_analysis` -> `param_env` provider -> `is_conditionally_const` -> `constness provider`).

## Files
- `src/rustc_hir_analysis/check/compare_impl_item.ts` (new): the port of compare_impl_item.rs. Exports what upstream
  makes `pub(super)`/`pub(crate)`: `compare_impl_item`, `collect_return_position_impl_trait_in_trait_tys` (the two
  providers), `check_type_bounds`, `compare_const_directness` (check.rs), `check_number_of_early_bound_regions` +
  `CheckNumberOfEarlyBoundRegionsError` (compare_eii.rs), `RemapLateParam` + `new_late_param_mapping` (refine.rs's
  `super::RemapLateParam`), and `export * as refine` (`pub(super) mod refine`).
- `src/rustc_hir_analysis/check/compare_impl_item/refine.ts` (new): the port of refine.rs
  (`check_refining_return_position_impl_trait_in_trait` exported).
- `src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts` (new) + `check/compare_impl_item_oracle/{run.ts,
  cases/*.rs}` (14 no_core cases). run.ts is test scaffolding (not a port): it walks the trait impls in
  `after_expansion` as check.rs `check_impl_items_against_trait` does (compare, then refine for `Ok` fns).
- No other file touched. The module is not imported by `lib.ts` / `check/mod.ts` (check-check owns those).

## For root (merge with check-check, trait-sel-*)
1. **Wire it up** in check-check's `check/mod.ts`: `// mod compare_impl_item;` -> `import * as compare_impl_item from
   "./compare_impl_item.ts"`; uncomment the two providers (`collect_return_position_impl_trait_in_trait_tys`,
   `compare_impl_item`); repoint check-check's stand-ins for them, for `check_type_bounds`,
   `compare_const_directness` and `refine::check_refining_return_position_impl_trait_in_trait` (check.rs).
   Note the provider takes `LocalDefId` (compare_impl_item) / `LocalDefId` (collect_rpitit) as upstream.
2. **Repoint my stand-ins** (all at the end of each file under "Stand-ins"):
   - `potentially_plural_count` (compare_impl_item.ts): a copy of check/mod.rs:652's body (check-check exports the
     real one from check/mod.ts) -> import it from `../mod.ts` and delete the copy.
   - `ObligationCtxt` (local interface: the methods these files call, D4 descriptors last), `ObligationCtxt_new`,
     `ObligationCtxt_new_with_diagnostics`, `normalize_param_env_or_error` -> the trait-sel lanes' real ones. The
     interface's method shapes are the contract I assumed: `normalize<T>(cause, param_env, value: Unnormalized<T>,
     d_T)`, `eq/sup<T>(cause, param_env, expected, actual, d_T: ToTrace<T>): Result<null, TypeError>`,
     `deeply_normalize<T>(.., d_T): Result<T, E[]>`, `evaluate_obligations_error_on_ambiguity(): TraitErrors<E>`,
     `try_evaluate_obligations()`, `register_obligation(s)`, `resolve_regions_and_report_errors(def_id, param_env,
     Iterable<Ty>)`, `assumed_wf_types_and_report_errors(param_env, def_id): Result<Ty[], ErrorGuaranteed>`.
   - `FulfillmentErrorView` (`root_obligation` only) -> rustc_trait_selection's `FulfillmentError`.
   - `err_ctxt(infcx)` calls the declared `infcx.err_ctxt()` (its stub stops UNPORTED) and casts to
     `TypeErrCtxtView` (`report_fulfillment_errors`, `note_type_err(diag, cause, [Span, string, boolean] | undefined,
     ParamEnvAnd<ValuePairs> | undefined, terr, prefer_label, override_span)`, `report_region_errors`) because
     `TypeErrCtxt` is still `Pending` (wave 19).
   - refine.ts: `elaborate_Clause_Span` (`impl Elaboratable for (Clause, Span)`, rustc_middle ty/elaborate_impl.rs; same
     stand-in as impl_wf_check/min_specialization.ts) and `LateParamRegionKind_from_bound` (rustc_middle ty/region.rs;
     same stand-in as rustc_middle ty/fold.ts). Whoever ports them should repoint all three files.
3. **compare_eii.rs** is not in this lane's scope (check-check's mod.ts comment says "wave 17: check-compare"). It needs
   `check_number_of_early_bound_regions` / `CheckNumberOfEarlyBoundRegionsError`, both exported here. Suggest a small
   follow-up lane (567 lines).
4. **`liberate_late_bound_regions`** stops UNPORTED (rustc_middle fold.ts's `LateParamRegionKind::from_bound` stand-in)
   on any signature with a late-bound region (`&self`, elided refs). Once the trait-sel stops are gone this is the next
   stop for most method comparisons; porting `LateParamRegionKind::from_bound` (region.rs, a few lines) is cheap.

## Tests
- `src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts`: 43 tests (14 cases x {end to end, in process, oracle
  sanity} + 1), all green with `RUST_TS_REQUIRE_PROBES=1`.
  - In process, byte-identical stderr + exit code to the pinned rustc: `e0049_fn`, `e0049_fn_fewer`, `e0049_ty`,
    `e0049_impl_trait`, `e0053_kinds_fn`, `e0053_kinds_ty`.
  - In-process PENDING (exit 70, exactly one `rust-ts: unported:` line):
    - `rustc_trait_selection::traits::ObligationCtxt::new_with_diagnostics`: `e0050`, `e0053_sig`, `e0195`, `e0326`,
      `e0643`, `refine_rpitit`;
    - `constness provider (not ported)`: `e0185`, `e0186`.
  - End to end (main.ts): every case stops at `rustc_interface::passes::analysis (M3+)` (pinned as PENDING, as
    errors.oracle.test.ts does).
  - The oracle-sanity test pins that each case's rustc output has exactly one diagnostic (no stray warnings / later
    passes).
  - Negative control: changing the E0049 message text makes `in process: e0049_ty` fail.
- Fresh-process loads of both modules are ok (rustc_infer values are reached through `rustc_infer/lib.ts`, like
  hir_ty_lowering/mod.ts; `import "../../rustc_trait_selection/lib.ts"` installs the extension stubs `can_eq`,
  `resolve_regions`, `err_ctxt`).

## `unported(...)` left (all stand-ins, see "For root" 2)
- compare_impl_item.ts: `rustc_trait_selection::traits::ObligationCtxt::new_with_diagnostics`,
  `rustc_trait_selection::traits::ObligationCtxt::new`, `rustc_trait_selection::traits::normalize_param_env_or_error`;
  plus the stubs reached through declared methods: `infcx.err_ctxt()` (wave 19), `infcx.can_eq` / `infcx.resolve_regions`
  (trait-sel-traits-a).
- refine.ts: `ObligationCtxt::new`, `normalize_param_env_or_error`, `rustc_middle::ty::elaborate_impl: impl Elaboratable
  for (Clause, Span)`, `rustc_middle::ty::region::LateParamRegionKind::from_bound`.

## PORT decisions (please record)
1. Other lanes' items are file-local stand-ins at the end of each file that stop as UNPORTED at their first use
   (precedent: min_specialization.ts, check-check's mod.ts); `ObligationCtxt` / `TypeErrCtxt` are local interfaces with
   the methods called here. `potentially_plural_count` is a verbatim copy of check/mod.rs's body until merge.
2. Unknown query values (`associated_item`, `generics_of`, `fn_sig`, `type_of`, `clauses_of`, `const_conditions`,
   `explicit_item_bounds`, `param_env`, `asyncness`, `variances_of`) are cast to the upstream value type; `fn_sig` via a
   `fn_sig_of` helper.
3. `FxIndexMap`/`FxIndexSet` of interned values (`Ty`, `Region`, `Clause`, `GenericArg`) are `Map`/`Set`;
   `FxIndexMap<DefId, _>` is `DefIdMap`; `FxIndexMap<LateParamRegionKind, _>` and `FxIndexSet<ProjectionAliasTy>` are
   `KeyedMap`/`KeyedSet` on `intern_key`.
4. `try { .. }` blocks with `?` on `Option` (compare_synthetic_generics) are IIFEs that return early.
5. The nested `struct FindRegion` (declared after its use upstream) is declared before the loop (JS classes are not
   hoisted); its marker stays at :1456.
6. `Upcast` descriptors passed to `Obligation::new` go through a local `upcast_tcx` cast (precedent: rustc_infer
   opaque_types/mod.ts).
7. `IndexSet::sort_by_cached_key` (refine.rs) is a stable JS sort on the precomputed key.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (14410; vendor 3888)`.
- `bun scripts/coverage.ts --missing compiler/rustc_hir_analysis/src/check/compare_impl_item.rs`: 35/35 ported;
  `.../compare_impl_item/refine.rs`: 10/10 ported.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Test run".
- Difftest: not affected (no driver path reaches the module); see "Test run" for the sample.

## Test run
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: **5003 pass, 1 skip (the pre-existing linux-only test),
  0 fail** (5004 tests, 310 files, 1202 s), including compare_impl_item.oracle.test.ts 43/43.
- `RUST_TS_AGENT=check-compare bun scripts/difftest.ts --suite hir-tree-nocore --sample 100`: 98 MATCH / 0 DIFF /
  2 UNPORTED / 0 CRASH (run `20261015-000312-check-compare-ad37`). The module is not in the driver path, so this only
  confirms no load-order regression.
