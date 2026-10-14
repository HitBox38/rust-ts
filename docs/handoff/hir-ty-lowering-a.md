# Handoff: hir-ty-lowering-a (wave 16, M3): rustc_hir_analysis `hir_ty_lowering/mod.rs` lines 1..2185

Branch `lane/hir-ty-lowering-a` (from `lane/hirtylowerer-contract` 5171055, no merges).

## Files touched
- `src/rustc_hir_analysis/hir_ty_lowering/mod.ts`: only the `// ---- lane hir-ty-lowering-a imports ----` block and the
  region `// ==== lane hir-ty-lowering-a: mod.rs:1..2185 ====`. Region -b, the shared imports and the header are
  unchanged. The region-a `unported_methods(..)` list is gone (every name is assigned); the -b list is untouched.
- New test files (lane-named so they cannot collide with -b): `src/rustc_hir_analysis/hir_ty_lowering/mod_a.test.ts`,
  `mod_a_test/{lower.rs, run.ts, lower.expected.txt}`.
- No other file. decls.ts is unchanged (see "PORT(decls)").

## What is ported (upstream order, markers on every fn)
- **Trait declarations**: the 15 required methods of `trait HirTyLowerer` (mod.rs:139..:248) and the 3 of
  `trait GenericArgsLowerer` (:376..:385) carry their markers in a `declare module "../decls.ts"` block that restates
  decls.ts's members with identical signatures (see PORT(decls) 1). `HirTyLowerer_provided.lowerer` (:239) is unchanged.
- **Enum methods** on the generated companions, re-exported over the `export *` of mod.gen.ts (PORTING §8):
  `AssocItemQSelf.to_string` (:261), `LowerTypeRelativePathMode.{assoc_tag, def_kind_for_diagnostics, permit_variants}`
  (:277/:285/:292).
- **`ForbidParamUsesFolder`** (:401): the hand class replacing the `unknown` alias, with `error` (:410) and its
  `TypeFolder` impl `cx` / `fold_ty` / `fold_const` / `fold_region` (:461..:479); the non-overridden provided methods
  forward to `TypeFolder_provided` (no markers, as in other folders).
- **All 30 `impl dyn HirTyLowerer` methods** of the region, `check_param_res_if_mcg_for_instantiate_value_path` (:491) ..
  `probe_generic_path_segments` (:2037), assigned onto `HirTyLowerer.prototype`.
- **`GenericArgsCtxt`** (:725) as a class nested in `lower_generic_args_of_path`, with `args_for_def_id` / `provided_kind`
  / `inferred_kind` (:736/:745/:810).

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs`: 62/87; the 25 missing are
  all lane -b's (`:2189 lower_resolved_ty_path` .. `:3847 lower_view`). Nothing missing in 1..2185.
- `bun scripts/coverage.ts --crate rustc_hir_analysis`: 64/799. `--check`: `markers ok (12322; vendor 3888)`.

## Tests
- `mod_a.test.ts` runs `mod_a_test/run.ts` (ported driver, stops after expansion) on the no_core `lower.rs` and compares
  its report with `lower.expected.txt` (checked by reading mod.rs). `ItemCtxt`'s vtable is still all `unported` (collect-a),
  so the trait object is built with `HirTyLowerer_provided.lowerer` over a **test implementor** `TestCx` whose `tcx` / `dcx`
  / `item_def_id` / `mod_id` / `infcx` (None) / `probe_adt` mirror `ItemCtxt`'s; its other methods stop as UNPORTED
  (`test lowerer: ..`), and no case reaches them.
- **Passing (real values)**: the enum methods, `AssocItemQSelf::to_string` (`Tr`, `m::Inner`, `T`, `Self`), the folder on
  values it leaves alone, `anon_const_forbids_generic_params` / `check_param_res_if_mcg_for_instantiate_value_path` /
  `check_param_uses_if_mcg` outside anon consts, `lower_resolved_lifetime` for `StaticLifetime` (the interned
  `'static`), `LateBound` (`ReBound(Bound(0), var=0, Named('a))`) and `Free` (`ReLateParam`),
  `probe_trait_that_defines_assoc_item` (6 cases), `collapse_candidates_to_subtrait_pick` without the feature,
  `probe_inherent_assoc_item` without `inherent_associated_types`, `probe_assoc_item_unchecked` (3 cases incl. the scope),
  `prohibit_generic_args` without args, `probe_generic_path_segments` for `Fn` / `Const` / one-segment `AssocConst`.
- **PENDING** (the exact text is pinned in lower.expected.txt; update it as the lanes land):
  - `rustc_hir_analysis::collect::generics_of::generics_of` (collect-a): `lower_resolved_lifetime(EarlyBound)`,
    `lower_generic_args_of_path_segment`, `lower_path_segment`, `probe_generic_path_segments` for `AssocFn` with 2
    segments and `Ctor(Struct, ..)`.
  - `named_variable_map provider (not ported)` (collect-rbv): `lower_lifetime`.
  - `rustc_hir_analysis::hir_ty_lowering::errors::HirTyLowerer::report_internal_fn_trait` (-d): `lower_impl_trait_ref`,
    `lower_poly_trait_ref`, `lower_mono_trait_ref`, `lower_resolved_assoc_ty_path(Some(..))`.
  - `..::errors::HirTyLowerer::{report_unresolved_assoc_item, report_unresolved_type_relative_path,
    report_missing_self_ty_for_resolved_path, report_prohibited_generic_args}` (-d): the error paths of
    `probe_single_bound_for_assoc_item`, `lower_type_relative_{ty,const}_path`, `lower_resolved_assoc_ty_path(None)`,
    `prohibit_generic_args` with args.
  - `lookup_deprecation_entry provider (not ported)`: `probe_assoc_item` (via `check_stability`).
  - `rustc_infer::infer::TyCtxtInferExt::infer_ctxt (InferCtxtBuilder::build)`: `probe_traits_that_match_assoc_ty`.
  - The runner prints `FatalError (a query poisoned by an earlier UNPORTED case)` if a case re-queries a key an earlier
    case left poisoned (rustc's behaviour); the fixture uses distinct keys, so no line has it today.
- **tydump `type_of` / `fn_sig`**: not reachable. `src/rust_ts/tydump.ts` stops at
  `rust_ts::tydump::prefix::run_required_analyses_prefix`, and every `type_of` / `fn_sig` goes through collect-a's
  `ItemCtxt` and the -b/-c lowering; nothing to compare yet.
- `RUST_TS_AGENT=hir-ty-lowering-a bun scripts/difftest.ts --suite hir-tree-nocore --sample 200`: 200 MATCH / 0 DIFF /
  0 UNPORTED / 0 CRASH (run `20261014-121020-hir-ty-lowering-a-bzc5`). The suite does not reach this code; it checks that
  the crate still loads.
- `bunx tsc --noEmit -p .`: clean. `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Test run".

## `unported(...)` left (region a)
1. `rustc_infer::traits::util::transitive_bounds_that_define_assoc_item` in `probe_single_ty_param_bound_for_assoc_item`'s
   candidates closure (rustc_infer is not ported). The `trait_refs` iterator in front of it is ported (lazy generator).
2. `rustc_hir_analysis::hir_ty_lowering::errors::AmbiguityBetweenVariantAndAssocItem as Diagnostic (into_diag)`: the
   local helper `AmbiguityBetweenVariantAndAssocItem_diagnostic_pending`, used as the decorator of the
   `AMBIGUOUS_ASSOCIATED_ITEMS` lint in `lower_type_relative_path`. The manual `impl Diagnostic` (errors.rs:2031) is lane
   -d's. **Root at merge:** replace the call with `AmbiguityBetweenVariantAndAssocItem_diagnostic(..)` from errors.ts and
   delete the helper.
3. `rustc_infer::infer::TyCtxtInferExt::infer_ctxt (InferCtxtBuilder::build)` and
   4. `rustc_infer::infer::InferCtxt::fresh_args_for_item` in `probe_traits_that_match_assoc_ty` (`InferCtxt` is pending,
   lane infcx-contract). The rest of that closure (`fold_regions`, `has_escaping_bound_vars`, `can_eq`, the polarity
   check) is kept as upstream text in a comment right above the `unported`; port it when `InferCtxt` lands.

Everything else this region calls exists; where it is still a stub elsewhere, it stops with that stub's text (list above).

## PORT decisions
1. **PORT(decls), trait markers.** decls.ts (root-owned) declares `HirTyLowererImpl<S>` and `GenericArgsLowerer` without
   markers, so `--missing` listed :139..:248 and :376..:385. mod.ts restates those members, with markers and identical
   signatures, in a `declare module "../decls.ts"` augmentation; the merged interfaces are unchanged (identical overloads).
   **Root:** either keep it, or move the 18 markers onto the decls.ts members and delete the augmentation block.
2. **PORT(decls), `ResolvedArg`.** decls.ts's `ResolvedArg` is an opaque `Pending`, and rustc_middle `named_bound_var`
   returns a `PendingEnum`. `lower_resolved_lifetime` matches through a local `ResolvedArgShape` (the PORTING §5 shape of
   middle/resolve_bound_vars.rs:13, i.e. what codegen will produce); `lower_lifetime` casts `PendingEnum` -> `Pending`.
   **Root:** when collect-rbv / codegen land the real type, delete `ResolvedArgShape` and both casts.
3. `LateParamRegionKind::Named(..)` is built as an object literal cast to rustc_middle's pending `LateParamRegionKind`,
   as context.ts does.
4. Shadowed bindings get a suffix (TS has no same-scope shadowing): `hir_polarity` (`lower_poly_trait_ref`'s HIR
   polarity; `polarity` is the `ty::ClausePolarity`), `scope_` (`probe_assoc_item`), `ident_` (parameter of
   `probe_assoc_item_unchecked`), `item_def_id_` (parameter of `lower_resolved_assoc_const_path`), `variant_def_id`
   (`probe_generic_path_segments`' shadowing `def_id`), `supertraits_` (the local of
   `collapse_candidates_to_subtrait_pick`, to keep the imported `supertraits` fn visible). `lower_type_relative_path`
   reassigns `item_def_id` (same type).
5. `prohibit_generic_args` collects its `impl Iterator + Clone` argument once (it is iterated three times upstream; the
   iteration has no side effects).
6. `probe_single_bound_for_assoc_item`'s `filter` is a lazy generator, so `probe_trait_that_defines_assoc_item` (queries)
   runs in upstream's order.
7. `Binder::dummy(trait_ref)` in `resolve_type_relative_path` gets a local D4 descriptor
   `{ visit_with: visit_with_TraitRef }` (as rustc_middle predicate.ts's `d_TraitRef`).
8. `#[instrument]` / `debug!` are comments; `debug_assert!` is a comment (PORTING §3).
9. The test implementor `TestCx` (mod_a_test/run.ts) is test-only glue, not a port.

## For root
- Record PORT(decls) 1 and 2 and the merge step for unported 2.
- Lane -b edits the same file: the regions do not overlap; at merge, the region-a `unported_methods` list being gone is
  expected (contract.test.ts 10/10 passes with it gone).

## Test run
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4499 pass, 1 skip (pre-existing linux-only), 0 fail (4500 tests, 272 files, 1334 s), including mod_a.test.ts and contract.test.ts 10/10.
