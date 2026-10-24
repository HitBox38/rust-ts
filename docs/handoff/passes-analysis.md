# Handoff: passes-analysis (wave 23)

Base `f5de3f15`, branch `lane/passes-analysis`.

## What landed
- `src/rustc_interface/passes.ts`: `run_required_analyses` (passes.rs:1100) and `analysis` (:1209) ported in upstream
  order, between `emit_delayed_lints` and `get_crate_name`; `DEFAULT_QUERY_PROVIDERS` installs `analysis` (the
  `unported("rustc_interface::passes::analysis (M3+)")` stand-in is gone). Wired to the real code:
  - misc_checking_1 (entry_fn, EII check, proc_macro_decls_static, `CStore::report_unused_deps`, exportable items,
    check_mod_attrs / unstable_api_usage, limits), `emit_delayed_lints`, the real `rustc_hir_analysis::check_crate`
    (with its const-eval arm: CTFE stops UNPORTED there for every `static` / non-generic `const`);
  - MIR_borrow_checking loop: `check_unsafety`, `is_trivial_const`, `mir_borrowck`, `check_transmutes`, `check_offloads`,
    `has_ffi_unwind_calls`, `check_liveness`, `mir_drops_elaborated_and_const_checked` (should_codegen or const
    context), coroutine `layout_of(TypingEnv::codegen ...)`;
  - `layout_test::test_layout`, `abi_test::test_abi` (rustc_passes/lib.ts);
  - `analysis`: abort on `has_errors_excluding_lint_errors`, misc_checking_3 (effective_visibilities,
    check_private_in_public, check_mod_deathness, `rustc_lint::check_crate`, clashing_extern_declarations,
    check_mod_privacy, check_expectations(None), all_diagnostic_items, all_canonical_symbols), `-Zvalidate-mir`'s
    `instance_mir(InstanceKind::Item)`.
- `src/rustc_interface/analysis_oracle/run.ts` + `src/rustc_interface/analysis.oracle.test.ts` (new): the driver stopped by
  `after_analysis` (as harness-w23's ckdump.ts / the ckdump probe), compared with the pinned rustc (`--emit=metadata`,
  std, lib) on body-less crates (dead code, late lints, private_bounds, missing_docs as lint errors, fulfilled /
  unfulfilled `#[expect]`, the non-lint-error abort) and one fn body (stop at `mir_borrowck`, printed prefix = oracle).
- Re-pinned (forced by this change; the files say "the entry has to go once the pipeline runs through"):
  `src/rustc_hir_analysis/hir_ty_lowering/errors.oracle.test.ts` (8/9 cases now equal the oracle end to end; e0109_kinds
  stops at `mir_borrowck`) and `src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts` (e0049_ty, e0053_kinds_ty,
  e0326 equal the oracle; 11 cases stop at `mir_borrowck` after printing the oracle's own diagnostics).

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_interface/src/passes.rs`: 27/29 (left: `print_macro_stats` :321,
`start_codegen` :1295). `coverage.ts --check`: markers ok.

## Where `analysis` stops today
- Any fn / closure / const-fn body: `mir_borrowck provider (not ported)` (lane borrowck-contract), right after that
  body's `check_unsafety`; everything printed before equals the oracle (checked by the test and by the re-pinned cases).
- `static` / non-generic `const` items: `rustc_const_eval::const_eval::eval_to_const_value_raw_provider` /
  `eval_static_initializer_provider` in `check_crate` (lane interp-contract).
- Late lints on `extern` blocks: `rustc_middle::ty::Ty: StableHash ... while_hashing_spans` (improper_ctypes cache
  key), and clashing_extern_declarations needs `symbol_name`.
- `-Zinput-stats`: `rustc_passes::input_stats::print_hir_stats` (new shim at the end of passes.ts, next to
  `print_ast_stats`; no lane yet).
- Body-less crates run `analysis` through and match the oracle.

## ckdump (harness-w23)
`ckdump.ts` needs no change: its `after_analysis` runs after the driver's `tcx.ensure_ok().analysis(())`
(rustc_driver_impl/lib.ts:305), which is now this provider. Not merged here.

## Drivers' prefixes (tydump / thirdump / mirdump)
Left unchanged, by decision: `tydump_dump.ts`'s `run_required_analyses_prefix` already calls the real ported fn or query
for every statement it shares with upstream (`emit_delayed_lints` from passes.ts, `check_glob_and_list_delegations_target_expr`,
`CStore::report_unused_deps`, the queries, the real `collect/outlives/variance` dump fns). What it does not share is
exactly where the probe departs from upstream: it stops at `definitions.freeze()` and runs `check_crate` without the
const-eval arm (D1a); mirdump's `mir_borrow_checking` leaves out `mir_borrowck` / `check_transmutes` / drop elaboration
(D2). Upstream has no smaller function to call for those pieces, so calling `run_required_analyses` from them would
change their output (CTFE / borrowck stops). Their output is unchanged (samples below).

## Sample difftests (as `root-f5de`, vs root's base runs)
| suite | base | this lane |
|---|---|---|
| tydump-minicore | 45 M / 0 D / 1 U | 45 / 0 / 1 |
| mirdump-minicore | 17 / 0 / 29 | 17 / 0 / 29 |
| tydump-ui --sample 300 | 258 / 0 / 40 | 258 / 0 / 40 |
| mirdump-ui --sample 300 | 17 / 0 / 283 | 17 / 0 / 283 |
| hir-tree --sample 300 | (protected) | 300 / 0 / 0 |
No new DIFF. Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: 6062 pass / 0 fail. `bunx tsc --noEmit -p .` clean.

## unported(...) left by this lane
- `rustc_passes::input_stats::print_hir_stats (-Zinput-stats)` (passes.ts shim).

## PORT decisions (please record)
1. `hir_id_validator::check_crate` is `#[cfg(debug_assertions)]`: kept as a comment (the oracle is a release build).
2. `definitions.write().commit_end_of_determinism()` / `definitions.freeze()`: the `RwLock` / `FreezeLock` are their inner
   value (PORTING §5); `freeze` is a no-op comment, as in `iter_local_def_id`.
3. `type_of(def_id).instantiate_identity().skip_norm_wip()` is `Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(..))`.
4. The two rustc_hir_analysis oracle tests' PENDING tables were re-pinned by this lane (outside its file list) because
   the stop they pinned (`analysis (M3+)`) no longer exists.
