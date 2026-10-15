# Handoff: codegen-fn-attrs (M3 wave 18): the `codegen_fn_attrs` query

Branch `lane/codegen-fn-attrs` (from `integ` 4447fa3). Commits: 14506d7, 931878c, 2f2a616.

## Files
New:
- `src/rustc_middle/middle/codegen_fn_attrs.ts`: port of `compiler/rustc_middle/src/middle/codegen_fn_attrs.rs`.
  - The types are hand-written. The typedefs probe cannot parse the file's `const impl Default for SanitizerFnAttrs`; middle/privacy.rs has the same problem and is handled the same way.
  - Types: `CodegenFnAttrs`, `TargetFeatureKind`, `TargetFeature`, `PatchableFunctionEntry`, `SanitizerFnAttrs`, and the `CodegenFnAttrFlags` bitflags (branded number + `flags_companion`).
  - Their Debug/Clone/PartialEq are written by hand.
  - Extras: `Option_Align_max` (`Ord::max` on `Option<Align>`), and a local `Visibility` for `rustc_middle::mono::Visibility`, because mono.rs is not ported.
- `src/rustc_codegen_ssa/codegen_attrs.ts`: port of codegen_attrs.rs.
- `src/rustc_codegen_ssa/codegen_attrs.gen.ts`: generated. Contains `InterestingAttributeDiagnosticSpans` and the `SanitizeOnInline` / `AsyncBlocking` diagnostics.
- `src/rustc_codegen_ssa/target_features.ts`: port of target_features.rs.
  - Covers `provide` (`all_rust_target_features`, `implied_target_features`, `asm_target_features`), `from_target_feature_attr`, `check_target_feature_trait_unsafe` and `check_tied_features`.
  - It also covers the backend helpers: `internal_target_features`, `target_spec_to_backend_features`, `flag_to_backend_features`, `retpoline_features_by_flags` and `sanitizer_features_by_flags`.
- `src/rustc_codegen_ssa/diagnostics.gen.ts` (generated) and `diagnostics.ts` (the hand-written impls).
- `src/rustc_codegen_ssa/lib.ts`: only `provide` (lib.rs:339).
- `src/rustc_codegen_ssa/codegen_attrs.test.ts` and `codegen_attrs_test/` (`run.ts` plus 9 `.rs` crates).

Edited:
- `tools/codegen/types.sets.json`: one new set, `rustc_codegen_ssa` (codegen_attrs.rs + diagnostics.rs), appended at the end. The skips are:
  - Linker / incremental / intrinsic types: `IncorrectCguReuseType`, `LinkingFailed`, `ProcessingDymutilFailed`, `StrippingDebugInfoFailed`, `InvalidMonomorphization`, `FailedToGetLayout`. Their field types are not ported.
  - `FeatureNotValid`, `CrossArchFeatureNote`, `FeatureNotValidHint`: hand-written in diagnostics.ts (see "For root").
- `src/rustc_interface/passes.ts`: `rustc_codegen_ssa.provide(providers)` is now called last in `default_query_providers`, as in upstream (`rustc_codegen_ssa::provide(providers)` after `rustc_symbol_mangling`). The pending-crates comment is updated to match.
  - At the pin, the LLVM backend's `CodegenBackend::provide` is the default no-op. Nothing is missing there.
- `src/rustc_middle/ty/util.ts`: the `CodegenFnAttrs_flags_contains_THREAD_LOCAL` stand-in now reads the ported flags. This affects `is_thread_local_static`.
- `src/rustc_middle/ty/context.ts`: `body_codegen_attrs` now returns `CodegenFnAttrs.EMPTY` instead of `unported`.
- Re-pinned tests (stops moved; no matching assertion was weakened):
  - `src/rustc_hir_analysis/check/entry.test.ts` `PENDING`: `codegen_fn_attrs provider (not ported)` → `rustc_metadata::rmeta::decoder::cstore_impl: Decodable for ty::TraitDef`.
  - `src/rustc_hir_analysis/check/wfcheck_b.test.ts` `PENDING_WF` (static_wf.rs): `codegen_fn_attrs provider (not ported)` → `rustc_trait_selection::error_reporting::InferCtxt::err_ctxt`.

## Coverage
- `compiler/rustc_codegen_ssa/src/codegen_attrs.rs`: 10/10
- `compiler/rustc_codegen_ssa/src/target_features.rs`: 11/11
- `compiler/rustc_codegen_ssa/src/diagnostics.rs`: 8/8
- `compiler/rustc_middle/src/middle/codegen_fn_attrs.rs`: 9/9
- `compiler/rustc_codegen_ssa/src/lib.rs`: 1/11 (only `provide`; the rest is backend, M4+)
- `bun scripts/coverage.ts --check`: markers ok (15025; vendor 3888). `bunx tsc --noEmit -p .` is clean.

## Tests
- `codegen_attrs.test.ts`: 8/8 byte-identical to the oracle (stderr + exit code). Cases:
  - a clean crate
  - `#[inline(always)]` + `#[target_feature]`
  - invalid feature names (closest-names help, `+` suggestion, single and multiple cross-arch notes)
  - an unstable feature (E0658 via `feature_err`)
  - tied AArch64 features (`paca`)
  - `#[no_mangle]` on a weak lang item and on `#[rustc_std_internal_symbol]`
  - `safe_trait.rs`: first diagnostic only, because rustc also reports E0053 from compare_impl_item
- `bun test src/rustc_codegen_ssa src/rustc_interface src/rustc_hir_analysis src/rustc_middle`: 500 pass, 0 fail.
- `bun test src/rustc_ast_lowering src/rustc_passes src/rustc_privacy src/rust_ts src/rustc_trait_selection src/rustc_ty_utils`: 198 pass, 0 fail.

## Samples (MATCH / DIFF / UNPORTED)
| suite | base | now |
|---|---|---|
| tydump-nocore `--sample 300 --seed m17` | 49 / 0 / 251 | **239 / 0 / 61** |
| tydump-minicore (46, full) | 5 / 0 / 41 | 5 / 0 / 41 |
| hir-tree-nocore `--sample 300 --seed m17` | 295 / 0 / 5 | **299 / 0 / 1** |
| expanded `--sample 100` | — | 100 / 0 / 0 |

tydump-minicore stays at 5 / 0 / 41, but `codegen_fn_attrs` no longer appears among its stops. 34 of its 41 stops are now `FulfillmentContext::new` (old solver, lane selcx-contract).

New top stops of tydump-nocore (no `codegen_fn_attrs` stop is left):
```
14 rustc_middle::query::keys: QueryKey for `(CanonicalImpliedOutlivesBoundsGoal<'tcx>, bool)` (cache)
12 rustc_middle::ty::region::LateParamRegionKind::from_bound
 9 rustc_middle::query::keys: QueryKey for `LitToConstInput<'tcx>` (cache)
 7 rustc_middle::ty::erase_regions::TyCtxt::erase_and_anonymize_regions
 5 check_unused_traits provider (not ported)
 4 rustc_middle::ty::layout::IntegerExt::from_int_ty (ty/layout.rs, M4)
 4 Decodable for rustc_middle::ty::AdtDefData (derive(TyDecodable) not generated; rustc_abi ReprOptions)
 3 rustc_middle::ty::region::EarlyParamRegion: RegionName::is_named
 1 FulfillmentContext::new / Decodable for ty::TraitDef / IntegerExt::to_ty
```
hir-tree-nocore's remaining stop is `QueryKey for LitToConstInput`.

## `unported(...)` left
- `rustc_middle::ty::instance::InstanceKind::def_id (ty/instance.rs)` in middle/codegen_fn_attrs.ts. It is reached only through `TyCtxt_codegen_instance_attrs` (codegen), because `InstanceKind` is `Pending`.
- `ThorinErrorWrapper::into_diag` (thorin, split DWARF) and `LinkingFailed::into_diag` (linker) in diagnostics.ts.
- In diagnostics.gen.ts, the generator's `unported_into_diag_arg` for `std::io::Error` / `Box<dyn Error>` args of linker / archive diagnostics.
- `back::symbol_export::provide` and `base::provide` (lib.rs `provide`) are not ported. Their queries keep the passes.ts `unported("<query> provider (not ported)")` placeholders.

## `// PORT:` decisions
- `Cow<CodegenFnAttrs>` in `codegen_instance_attrs`: the borrowed query value is used until a field changes, then a clone is made (`clone_CodegenFnAttrs`).
- `CodegenFnAttrs::EMPTY` is a getter that returns a fresh `new()`.
- `RtsanSetting::default()` is inlined as `"Caller"` (`#[derive_const(Default)]`, `#[default] Caller`).
- `TyCtxt::codegen_instance_attrs` is the free function `TyCtxt_codegen_instance_attrs`. The `TyCtxt` class lives in context.ts.
- Query values that are `unknown` in queries.gen.ts (`codegen_fn_attrs`, `sanitizer_settings_for`, `fn_sig`, `asyncness`, `all_rust_target_features`) are cast by their readers.
- `DebugArgPath` `{:?}` of a `Path` is the `str` Debug (`debug_str`), because a JS string holds UTF-8.
- `asm_target_features`: `FxIndexSet::swap_remove` is done on an array copy, which keeps upstream's order.
- `sort_by_key` / `into_sorted_stable_ord` of feature names use a stable sort with `str_cmp`.

## For root
- **Generator gap.** `$display0` for `DiagSymbolList<&str>` in a `#[derive(Subdiagnostic)]` emits `DiagSymbolList_into_diag_arg_with((x) => x)(..)`, and tsc cannot infer `S` there (TS2322). The fix is a one-line change in `tools/codegen/types.ts` (around line 3128): emit a typed lambda, `(x: string) => x`. After that fix, drop the three `FeatureNotValid*` skips from the `rustc_codegen_ssa` set and delete their hand copies in diagnostics.ts. Those copies are in the generator's exact shape.
- **Extern crates.** `codegen_fn_attrs` for extern crates still decodes through `decode_unported("CodegenFnAttrs")` in rustc_metadata `cstore_impl.ts`. It was not hit in any sample. When it is, `CodegenFnAttrs` needs a `TyDecodable` decoder. The probe cannot parse the file, so the decoder has to be hand-written or the probe fixed.
- **Query value types.** queries.gen.ts still types the `codegen_fn_attrs` / `sanitizer_settings_for` values as `unknown`. A typemap entry for `rustc_middle::middle::codegen_fn_attrs::{CodegenFnAttrs, SanitizerFnAttrs}` → `src/rustc_middle/middle/codegen_fn_attrs.ts` would let the local `CodegenFnAttrs` view interfaces be removed. Those views are in ty/context.ts, ty/print/pretty.ts, check/check.ts, check/entry.ts, check/mod.ts and ast_lowering delegation.
- **Edits outside the lane's own files** (please review at merge): util.ts and context.ts each change a single stand-in body plus one import. This is the "rest of middle/codegen_fn_attrs.rs" part of the task.
