# Handoff: assoc-opaque (M3): rustc_ty_utils `assoc.rs` + rustc_middle `ty/opaque_types.rs`

Branch `lane/assoc-opaque` (from `ab2cdfc`, no merges).

## Files
- `src/rustc_ty_utils/assoc.ts` (new): all of `assoc.rs` in upstream order: `provide`, `associated_item_def_ids`,
  `associated_items`, `impl_item_implementor_ids`, `associated_item`, `fn_has_self_parameter`,
  `associated_item_from_trait_item`, `associated_item_from_impl_item`, `RPITVisitor` (+ `visit_opaque_ty`),
  `associated_types_for_impl_traits_in_trait_or_impl`, `associated_type_for_impl_trait_in_trait`,
  `associated_type_for_impl_trait_in_impl`.
- `src/rustc_ty_utils/lib.ts` (new): `provide` (only `assoc::provide` live; the other modules are commented out, as
  rustc_passes/lib.ts does).
- `src/rustc_middle/ty/opaque_types.ts` (new): `OpaqueTypeKey` alias, `ReverseMapper` (`new`,
  `fold_kind_no_missing_regions_error`, `fold_kind_normally`, `fold_closure_args`, and the `TypeFolder` impl: `cx`,
  `fold_region`, `fold_ty`, `fold_const`; `fold_binder` / `fold_predicate` / `fold_clauses` forward to
  `TypeFolder_provided`).
- `src/rustc_interface/passes.ts`: call site only: `rustc_ty_utils.provide(providers.queries)` before
  `rustc_metadata_provide` (upstream order: after `rustc_traits`, before `rustc_metadata`); the "pending crates"
  comment no longer lists rustc_ty_utils.
- `src/rustc_ast_lowering/delegation/resolution.ts`: one line, `TyCtxt_is_method(tcx, sig_id)` ->
  `tcx.is_method(sig_id)`. This is byte-identical to the same hunk on `lane/ty-adt-assoc` (commit 9a30843), so the
  two merge cleanly; I left the now-unused exported `TyCtxt_is_method` stand-in in place because ty-adt-assoc
  deletes it (deleting it here too would conflict with their adjacent deletion).
- Tests (new): `src/rustc_ty_utils/assoc.test.ts` + `assoc_test/{assoc.rs,run.ts,assoc.expected.txt}` (the driver
  up to expansion on a no_core trait, a trait impl and an inherent impl; prints `associated_item_def_ids`, the
  RPITIT map and each `associated_item`; the expected text was checked by reading assoc.rs);
  `src/rustc_middle/ty/opaque_types.test.ts` (5 tests of `ReverseMapper::fold_region` and the
  `do_not_error` assertions over a bare interner `TyCtxt`).

## Coverage
- `--missing compiler/rustc_ty_utils/src/assoc.rs`: 12/12. `--missing compiler/rustc_middle/src/ty/opaque_types.rs`:
  8/8. `--missing compiler/rustc_ty_utils/src/lib.rs`: 1/1.
- `bun scripts/coverage.ts --check`: `markers ok (11073; vendor 3888)`.

## Stand-ins to repoint on merge (all in `src/rustc_ty_utils/assoc.ts`, top "PORT(stand-in)" block)
1. `AssocItems_new` -> `AssocItems.new` (lane ty-adt-assoc). Currently `unported(..)`.
2. `AssocItems_in_definition_order` -> `AssocItems.in_definition_order` (ty-adt-assoc). Currently `unported(..)`.
3. `AssocItem_trait_item_def_id` -> `AssocItem.trait_item_def_id` (ty-adt-assoc). Currently the upstream body.
4. `ImplTraitInTraitData_of` (a cast): `ImplTraitInTraitData` is `Pending` in ty/decls.ts; lane ty-mod-b ports it
   (ty/mod.rs:1572) as `{ $: "Trait", fn_def_id, opaque_def_id } | { $: "Impl", fn_def_id }`, the same shape, so the
   object literal can be used directly once decls.ts points at it.
For 1-3 the change is: `import { type AssocContainer, AssocItem, AssocItems, type AssocKind } from
"../rustc_middle/ty/assoc.ts"` and replace the three `_`-names with the dotted ones (verified, see Preview).

Also for lane ty-mod-a (or the integrator): `ReverseMapper_new` in ty/mod.ts (ty-mod-a's stand-in) can now be
`ReverseMapper.new` from `./opaque_types.ts` (the module reads its imports inside methods only, so mod.ts may import
it). The `mod opaque_types;` / `pub use` lines of ty/mod.rs are not wired (mod.ts is not mine).

## unported(...) left
- `rustc_middle::ty::assoc::AssocItems::new (lane ty-adt-assoc)` and
  `rustc_middle::ty::assoc::AssocItems::in_definition_order (lane ty-adt-assoc)` (stand-ins above).
- Reached, not mine: `TyCtxt::is_trait_alias` (ty/util.ts stub, lane ty-util ports it), `TyCtxt::opt_associated_item`
  (ty/mod.ts stub, lane ty-mod-b ports it), `TyCtxtFeed::feed_hir` (context.ts; any trait/impl fn with a
  return-position `impl Trait` stops there), `Ty::new_closure` / `new_coroutine` / `new_coroutine_witness` /
  `new_error` (sty.ts stubs, lane ty-sty).

## PORT decisions
- assoc.ts: query values typed `unknown` in queries.gen.ts (`associated_item`, `associated_items`, `generics_of`)
  are cast at the read site.
- assoc.ts `associated_types_for_impl_traits_in_trait_or_impl`: `in_trait_def[&id]` -> `.get(id) ?? panic("no entry
  found for key")` (std's `Index for HashMap` message). Maps are `DefIdMap` (keyed by value).
- assoc.ts `associated_type_for_impl_trait_in_impl`: `own_params.clone()` copies each `GenericParamDef` with a
  spread (plain data, derive Clone) so the index rewrite does not touch the trait's generics;
  `param_def_id_to_index` is a `KeyedMap(DefId_hash_key, ..)` as `Generics::from_decoded` builds it.
- opaque_types.ts: tracing (`#[instrument]`, `debug!`, `trace!`) is left out (kept as a comment where inline);
  `{r}` / `{ty}` / `ct.to_string()` are `display_Region` / `display_Ty` / `display_Const`; `{u:?}` is
  `debug_GenericArgKind`.

## Delegation suite (`bun scripts/difftest.ts --suite hir-tree-nocore --filter delegation/`)
- Before (ab2cdfc): 36 MATCH, 108 UNPORTED (all `TyCtxt::is_method`).
- This branch alone: 36 MATCH, 108 UNPORTED, now all `rustc_middle::ty::TyCtxt::opt_associated_item` (ty/mod.ts
  stub; ported on lane/ty-mod-b).
- Preview (scratch worktree, not committed): this branch + `lane/ty-adt-assoc` + `lane/ty-mod-b`, merged cleanly,
  stand-ins 1-3 repointed, tsc clean: 36 MATCH, 107 CRASH, 1 UNPORTED. `is_method` now answers through the
  `associated_item` provider; 106 of the 107 crashes ICE at the next step,
  `fn_sig_skip_binders` -> `tcx.fn_sig(def_id)` ("`tcx.fn_sig(..)` is not supported for this key": the `fn_sig`
  provider is rustc_hir_analysis's, unported, so the default query ICEs). The 107th
  (`generics/mapping/trait-to-trait-pass.rs`) has its stderr cut off in the diff file after many resolve errors; not
  inspected. The UNPORTED one (`delegation-inherent-impl-issue-162774.rs`) is
  `std::panic::Location::caller (DiagLocation Display)`.
  **Integrator note:** merging these three lanes turns those 107 delegation cases from UNPORTED into CRASH (none
  is protected). To keep them UNPORTED until `fn_sig` lands, `fn_sig_skip_binders` (resolution.ts) could call
  `unported(..)` before `tcx.fn_sig(..)`, or `fn_sig` could get an `unported` provider; neither file is mine.
- Also in the preview (+ `lane/ty-util` for `is_trait_alias`): `associated_items` and `impl_item_implementor_ids`
  return the right items for the test crate (trait: C, T, by_ref, by_val, assoc_fn, provided; trait impl
  implementors C->C, T->T, by_ref->by_ref, by_val->by_val, assoc_fn->assoc_fn; inherent impl: method, new, no
  implementors). Worth adding to assoc_test/run.ts after the merge.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- Fresh-process loads of `rustc_middle/ty/opaque_types.ts`, `rustc_ty_utils/lib.ts`, `rustc_ty_utils/assoc.ts`: ok.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: RESULTS_PLACEHOLDER
