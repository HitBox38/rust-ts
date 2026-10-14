# Handoff: check-wf-a (M3, wave 17): rustc_hir_analysis `check/wfcheck.rs` lines 1–1139

Branch `lane/check-wf-a` (from main `3e4773f`, no merges).

## Result
`src/rustc_hir_analysis/check/wfcheck.ts` is new. It holds every upstream fn of wfcheck.rs lines 1–1139, in upstream
order, with markers: `WfCheckingCtxt` (+ `deref`, `tcx`, `normalize`, `deeply_normalize`, `register_wf_obligation`,
`unnormalized_obligations`), `enter_wf_checking_ctxt`, `check_well_formed`, `check_item`, `check_foreign_item`,
`check_trait_item`, `check_gat_where_clauses`, `augment_param_env`, `gather_gat_bounds`, `GATArgsCollector`
(`visit`, `visit_ty`), `lint_item_shadowing_supertrait_item`, `check_param_wf` (+ its nested `ty_is_local`),
`check_associated_item`, `check_type_defn`, `check_trait`, `check_associated_type_bounds`.

Nothing calls the file yet: `check_type_wf` (wfcheck.rs:2614) is lane check-wf-b's and the providers are set in
check/mod.rs (lane check-check). So the tydump stops do not move with this lane alone (see "Difftest").

## Files
- `src/rustc_hir_analysis/check/wfcheck.ts` (new). Layout:
  1. file header (PORT notes) and the `// check-wf-a imports` block;
  2. the check-wf-a region (wfcheck.rs:1–1139);
  3. `// ---- check-wf-a: PORT stand-ins ...`: local stand-ins for items of other lanes (below);
  4. `// ---- check-wf-b region ...`: `unported` stand-ins for the check-wf-b fns this region calls
     (`check_item_fn`, `check_const_item`, `check_impl`, `check_where_clauses`, `check_fn_or_method`,
     `check_method_receiver`, `lint_redundant_lifetimes`, and the method `WfCheckingCtxt.check_false_global_bounds`
     through interface merging + a prototype assignment). No markers on them.
- `src/rustc_hir_analysis/check/wfcheck_a.test.ts` + `src/rustc_hir_analysis/check/wfcheck_a_test/` (driver `run.ts`
  and 7 small `#![no_core]` crates).

## Merge notes (root)
- **Add/add conflict with check-wf-b**: both lanes create `check/wfcheck.ts`. Resolve as: header + both import blocks;
  this lane's region and its stand-in block; then check-wf-b's real region, **dropping section 4 above**
  (check-wf-b's real fns replace those stand-ins; the `interface WfCheckingCtxt { check_false_global_bounds }` merge
  goes with them or into the class, PORTING §8). check-wf-b presumably has stand-ins for this region's fns: drop those.
- **check-check**: check.ts has local stand-ins for this region's fns (`enter_wf_checking_ctxt`, `wfcheck_check_item`,
  `wfcheck_check_foreign_item`, `wfcheck_check_trait_item`, `wfcheck_check_gat_where_clauses`,
  `wfcheck_check_associated_item`, `check_type_defn`, `wfcheck_check_trait`) and an interface `WfCheckingCtxt`; they
  can be repointed at the exports of wfcheck.ts. The class has the members its view lists (`ocx.register_obligations`,
  `deeply_normalize(span, loc, value, d_T)`, `register_wf_obligation`, `register_bound`, `unnormalized_obligations`;
  `check_test_binder_body` is check-wf-b's).
- This file's stand-in `check_check_item_type` should become `check::check::check_item_type` (check.ts). Import it
  lazily or only inside fn bodies: check.ts imports wfcheck.ts, so it is an import cycle (fine while only fn bodies
  touch the other module).
- After trait-sel-traits-a/-b merge, repoint the stand-ins in section 3 (`ObligationCtxt`, `traits::wf`, `regions`,
  `misc`). The local `interface ObligationCtxt` lists exactly the members used (also the ones reached through `Deref`).

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_hir_analysis/src/check/wfcheck.rs`: **23/57**; the first missing fn
is `:1140 check_item_fn` (nothing missing in 1..1139). `bun scripts/coverage.ts --check`: markers ok.

## Tests (`RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_hir_analysis/check/wfcheck_a.test.ts`: 8 pass)
`run.ts` walks the items in `check_type_wf` order and makes the calls `check_item_type` makes into this region
(`wf` mode), or only the calls that build no `ObligationCtxt` (`lint` mode); then `check_param_wf` per own param.
- **Oracle matches** (`lint`, exit + stderr equal to the pinned rustc):
  - shadow.rs: `SHADOWING_SUPERTRAIT_ITEMS` (6 warnings: fn/const/type, one supertrait (`Labeled`), several
    (`Several`, "`B` and `A`"), transitive supertrait, `#[allow]` on the subtrait), and `check_param_wf` on
    bool/char/u8/i64/usize const params (no output);
  - neg_default.rs: 2 × E0750 (`default impl !Tr for ..`), plus a plain negative impl (no output).
- **PENDING** (equal to the oracle or stop at one of `PENDING`; all stop today):
  - field_bound.rs (E0277 in a struct field), unused.rs (E0392), marker.rs (E0714), const_param.rs (raw pointer const
    param), gat.rs (`wf`): `rustc_trait_selection::traits::normalize_param_env_or_error` (`tcx.param_env` in
    `enter_wf_checking_ctxt` / `check_trait`, lane trait-sel-traits-a);
  - gat.rs (`lint`, `check_gat_where_clauses` alone): `constness provider (not ported)` (`param_env` of the trait fn).
  - E0392 itself is emitted by `check_variances_for_type_defn` (wfcheck.rs:2012, check-wf-b).

## Difftest
`RUST_TS_AGENT=check-wf-a bun scripts/difftest.ts --suite tydump-nocore --sample 200` (run
`20261014-233727-check-wf-a-4nha`): **29 MATCH / 0 DIFF / 171 UNPORTED / 0 CRASH** (3 skipped). Stops:
- 169 `check_type_wf provider (not ported)` (unchanged: the provider is wired by check-check's check/mod.rs and the fn
  is check-wf-b's; this region is reached only through them);
- 1 `constness provider (not ported)`;
- 1 `codegen_fn_attrs provider (not ported)`.

## unported(...) left (all stand-ins at the end of the check-wf-a region)
- `rustc_trait_selection::traits::ObligationCtxt::new_with_diagnostics` (traits/engine.rs, trait-sel-traits-a)
- `rustc_trait_selection::error_reporting::TypeErrCtxt::report_fulfillment_errors` (wave 19)
- `rustc_trait_selection::error_reporting::TypeErrCtxt::report_region_errors` (wave 19)
- `rustc_trait_selection::traits::wf::unnormalized_obligations` (traits/wf.rs, trait-sel-traits-b)
- `rustc_trait_selection::traits::wf::clause_obligations` (traits/wf.rs, trait-sel-traits-b)
- `rustc_trait_selection::regions::region_known_to_outlive` (regions.rs, trait-sel-traits-a)
- `rustc_trait_selection::regions::ty_known_to_outlive` (regions.rs, trait-sel-traits-a)
- `rustc_trait_selection::traits::misc::type_allowed_to_implement_const_param_ty` (traits/misc.rs, trait-sel-traits-a)
- `rustc_hir_analysis::check::check::check_item_type (lane check-check)`
- `rustc_middle::mir::interpret::TyCtxt::const_eval_poly (M4)` (field default values, explicit enum discriminants)
- check-wf-b's fns (section 4): `rustc_hir_analysis::check::wfcheck::{check_item_fn, check_const_item, check_impl,
  check_where_clauses, check_fn_or_method, check_method_receiver, lint_redundant_lifetimes,
  WfCheckingCtxt::check_false_global_bounds} (lane check-wf-b)`
Calls that already stop elsewhere: `OutlivesEnvironment.new_with_implied_bounds_compat` (contract placeholder,
regions.rs, trait-sel-traits-a).

## PORT decisions (please record)
1. `WfCheckingCtxt`'s `Deref` to `ObligationCtxt` is `deref()` plus forwarding members for the deref'd members the file
   uses (`infcx` getter, `register_bound`, `register_obligation`, `register_obligations`,
   `evaluate_obligations_error_on_ambiguity`). `body_def_id` / `param_env` are public fields (check-wf-b reads them).
2. `ObligationCtxt` / `FulfillmentError` are local (`interface ObligationCtxt` with the members used,
   `FulfillmentError = unknown`) until trait-sel-traits-a exports the real ones; `rustc_trait_selection/decls.ts` still
   has them as `Pending`.
3. `FxIndexSet<(Region, usize)>` / `FxIndexSet<(Ty, usize)>` are `KeyedSet`s keyed `${value.id}:${idx}`;
   `FxIndexSet<Clause>` is a `Set`; `.any(|p| set.insert(p))` stops at the first newly inserted bound, as upstream.
4. `Obligation::new(.., ClauseKind::WellFormed(term))` passes `Predicate_upcast_from_ClauseKind` through
   `as_obligation_upcast` (TyCtxt vs `Interner` parameter type; as type_relating.ts).
5. `check_param_wf` is exported (upstream private) so the test driver can call it.
6. The nested `fn ty_is_local` (wfcheck.rs:874) is a module-level fn right after `check_param_wf`.
