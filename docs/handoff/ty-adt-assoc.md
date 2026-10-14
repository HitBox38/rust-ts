# Handoff: ty-adt-assoc (M3, wave 15): rustc_middle ty/adt.rs, ty/assoc.rs, ty/trait_def.rs, ty/closure.rs

Branch `lane/ty-adt-assoc` (from main `ab2cdfc`, no merges).

## Files
- `src/rustc_middle/ty/adt.ts` (new, defining module): adt.rs **60/60**. `AdtFlags` (bitflags companion + `debug_AdtFlags`,
  `external_bitflags_debug!`), `AdtDefData` (class: `eq`, `hash`, `static new`; `stable_hash` is a `rustc-skip`),
  `AdtDef` (D2 hash-consed class, `extends Interned`, `internee: AdtDefData`, frozen), every inherent method, the
  `inherent::AdtDef` impl, `AdtKind` (+ `article`, `debug_AdtKind`), `DataTypeKind_from_AdtKind`.
- `src/rustc_middle/ty/assoc.ts` (stub filled): assoc.rs **35/35**. Companions `AssocItem`, `AssocKind`, `AssocTag`
  (`...gen.AssocTag`), `AssocItems` over the generated types (assoc.gen.ts), `display_AssocKind`, and
  `TyCtxt.prototype.associated_types_for_impl_traits_in_associated_fn`. The `unported_methods` call is gone.
- `src/rustc_middle/ty/trait_def.ts` (stub filled): trait_def.rs **11/11**. `TraitDef` (class, `ancestors`),
  `TraitSpecializationKind`, `TraitImpls` (interface + companion, `debug_TraitImpls`), `for_each_relevant_impl`,
  `non_blanket_impls_for_ty`, `all_impls`, and the 4 providers (exported, not wired). `unported_methods` call gone.
- `src/rustc_middle/ty/closure.ts` (stub filled): closure.rs **20/20**. `CAPTURE_STRUCT_LOCAL`, `UpvarPath`, `UpvarId`,
  `UpvarCapture` (+ `partial_cmp`), `CapturedPlace` (class), `ClosureTypeInfo`, `closure_typeinfo` (provider),
  the 3 `TyCtxt` methods, `is_ancestor_or_same_capture`, `CaptureInfo`, `place_to_string_for_capture`, `BorrowKind`
  (+ `BorrowKind_discriminant`, `cmp`), `analyze_coroutine_closure_captures` (generator), `provide`. Derived Debug
  for UpvarPath / UpvarCapture / CapturedPlace / CaptureInfo / BorrowKind. `unported_methods` call gone.
- `src/rustc_data_structures/sorted_map/index_map.ts` (**new file outside the brief's list**, by necessity:
  `AssocItems` is a `SortedIndexMultiMap`): index_map.rs **15/15** + `debug_SortedIndexMultiMap`.
- Repointed stand-ins (brief: "the resolver and lowering lanes left `unported`s ... repoint them"):
  - `src/rustc_ast_lowering/delegation/resolution.ts`: `AssocItems_filter_by_name_unhygienic` ->
    `AssocItems.filter_by_name_unhygienic`; `TyCtxt_is_method(tcx, id)` -> `tcx.is_method(id)` (context.rs:1295,
    already ported by ty-ctxt). Both stand-ins deleted.
  - `src/rustc_resolve/late.ts`: the `AnonymousLifetimeNonGatReportError` `decl` (late.rs:2025) now runs upstream:
    `associated_items(trait_id)` + `AssocItemKind.ident` + `AssocItems.find_by_ident_and_kind` + `def_span` labels.
  - `src/rustc_resolve/late/diagnostics.ts`: `suggest_alternative_construction_methods` (diagnostics.rs:2794) runs the
    upstream item scan (`in_definition_order`, `is_fn`/`is_method`, `fn_sig` output/inputs, `ty::Adt` `did`).
- Test: `src/rustc_middle/ty/ty_adt_assoc.test.ts` (23 tests).

## `TyCtxt::is_method`
It lives in ty/context.rs:1295 (lane ty-ctxt, already ported in context.ts). Its stand-in `AssocItem_is_method`
(context.ts:3034) has the upstream body; root: repoint it to `AssocItem.is_method` from ./assoc.ts (context.ts is not
this lane's file). The hir-tree stop moves: the 108 `tests/ui/delegation/` cases of hir-tree-nocore that stopped at
`TyCtxt::is_method` now stop at `rustc_middle::ty::TyCtxt::opt_associated_item` (ty/mod.rs stub, lanes ty-mod-a/-b).
Same 36 MATCH as the ty-mod-b runs before; no case left MATCH.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Results" below.
- `bun scripts/coverage.ts --check`: markers ok (11193; vendor 3888).
- `--missing`: adt.rs 60/60, assoc.rs 35/35, trait_def.rs 11/11, closure.rs 20/20, sorted_map/index_map.rs 15/15.
- Fresh-process loads: ty/adt.ts, ty/assoc.ts, ty/closure.ts, ty/trait_def.ts, rustc_middle/lib.ts,
  rustc_resolve/{lib,late,late/diagnostics}.ts, rustc_ast_lowering/{lib,delegation/resolution}.ts,
  rustc_driver_impl/lib.ts, sorted_map/index_map.ts.

## Results (`RUST_TS_AGENT=ty-adt-assoc` samples)
- hir-tree-nocore --sample 300: 299 MATCH / 0 DIFF / 1 UNPORTED (`20261014-071250-ty-adt-assoc-fpu0`; the stop is
  `tests/ui/macros/auxiliary/proc_macro_def.rs`, proc-macro bridge M6, pre-existing).
- unpretty-hir --sample 200: 199 / 0 / 1 (`20261014-071336-ty-adt-assoc-j7g8`; same case).
- resdump-nocore --sample 200: 199 / 0 / 1 (`20261014-071616-ty-adt-assoc-5krc`; same case, not protected).
- expanded --sample 200: 199 / 0 / 1 (`20261014-071652-ty-adt-assoc-g8h0`; same case, not protected).
- hir-tree-nocore `--filter delegation/`: 36 MATCH / 0 DIFF / 108 UNPORTED (`20261014-071455-ty-adt-assoc-re5p`),
  see `TyCtxt::is_method` above.

## For root (wiring this lane may not do: other owners' files)
1. **context.ts** (`mk_adt_def` / `mk_adt_def_from_data`, ty-ctxt's file):
   ```ts
   import { AdtDef, AdtDefData } from "./adt.ts";   // adt.ts is a defining module: safe to import from context.ts
   mk_adt_def(did, kind, variants, repr) { return this.mk_adt_def_from_data(AdtDefData.new(this, did, kind, variants, repr)); }
   mk_adt_def_from_data(v: AdtDefData): AdtDef {
     return Interned.new_unchecked(this.interners.adt_def.intern(v, v.hash(), (v) => new AdtDef(v)) as AdtDef);
   }
   ```
   The key must be `v.hash()` (`impl Hash for AdtDefData` hashes only `did`), not `intern_key(v)`. The test
   "AdtDefData: PartialEq and Hash only look at `did`" does exactly this against a real `CtxtInterners`. Also type
   `CtxtInterners.adt_def` as `InternedSet<AdtDef>`, drop the local `type AdtKind = Pending<..>` (use adt.ts's), and
   repoint `mk_place_downcast`'s `AdtDef::variant` stand-in (context.ts:2196) and `AssocItem_is_method` (:3034).
2. **decls.ts**: re-export the real types: `AdtDef`, `AdtDefData` (adt.ts); `CapturedPlace` (closure.ts);
   `SortedIndexMultiMap` (rustc_data_structures/sorted_map/index_map.ts; then `items_of` in assoc.ts and the
   `as unknown as AssocItems["items"]` cast in `AssocItems.new` can go). `AdtDef` then no longer matches
   `inherent.ts`'s `AdtDef.destructor` signature: per ty-contract decision 5 the trait method is `ir_destructor`;
   rename the interface member in rustc_type_ir/inherent.ts accordingly (lane tyir-misc's file).
3. **Stand-ins elsewhere that can now point at this lane's code** (not edited here):
   - rustc_type_ir/fast_reject.ts:680 and relate.ts:94 `AdtDef_def_id` -> `adt.def_id()`;
   - rustc_middle/ty/print/pretty.ts `AdtDef_did` / `AdtDef_field_representing_type_info` / `AdtDef_variants` /
     `AdtDef_variant` / `TraitDef_paren_sugar`; print/mod.ts `AdtDef_did`; rustc_ast_lowering/delegation/generics.ts
     `AdtDef_did`;
   - context/impl_interner.ts `TraitDefFields` casts -> `TraitDef`; `for_each_blanket_impl` reads `trait_impls.blanket_impls`
     (the field, still correct: `TraitImpls` is a plain interface); `in_definition_order` stand-in (:394) ->
     `AssocItems.in_definition_order`;
   - rustc_type_ir/ty_kind.ts:218 `TyKind` Debug of `Adt` waits for `impl Debug for AdtDef` (structural_impls.rs:35,
     lane ty-results);
   - rustc_lint/context.ts:657 `get_associated_type` (tcx.associated_items).
   - rustc_data_structures/sorted_map.ts: add `export { SortedIndexMultiMap } from "./sorted_map/index_map.ts"`
     (`pub use index_map::SortedIndexMultiMap`), and drop "`SortedIndexMultiMap` ... is not ported" from its header.
4. **ty/mod.rs `provide`** (lane ty-mod): call `closure::provide` and install `trait_impls_of_provider`,
   `incoherent_impls_provider`, `traits_provider`, `trait_impls_in_crate_provider` (exported from trait_def.ts).
5. **queries.gen.ts** (lane query-growth): values typed `unknown` that this lane casts: `trait_impls_of` (TraitImpls),
   `trait_def` (TraitDef), `adt_def` (AdtDef), `associated_items` (AssocItems), `closure_typeinfo` (ClosureTypeInfo),
   `adt_destructor` / `adt_async_destructor`, `adt_sizedness_constraint`, `defaultness`, `constness`, `fn_sig`,
   `type_of`, `implementations_of_trait` (SimplifiedType), `upvars_mentioned` (hir::Upvar).
6. tools/codegen: `assoc.gen.ts`'s `debug_AssocItems` prints `unported_debug(v.items)`: map `SortedIndexMultiMap` to
   `debug_SortedIndexMultiMap` in the typemap.

## `unported(...)` left (all stand-ins for other owners' code; none in this lane's own fns)
- adt.ts: `ReprOptions::packed`, `ReprOptions::discr_type` (rustc_abi, unowned); `IntTypeExt::to_ty`,
  `IntTypeExt::initial_discriminant`, `Discr { .. }`, `Discr::wrap_incr`, `Discr::checked_add` (ty/util.rs, ty-util);
  `ty::Value::to_leaf`, `ScalarInt::to_u32` (ty-results); `TyCtxt::const_eval_poly`, `ConstValue::try_to_bits_for_ty`,
  `ReportedErrorInfo: Into<ErrorGuaranteed>` (mir, M4); `TypingEnv::post_analysis` (ty-mod).
- trait_def.ts: `traits::specialization_graph::ancestors` (middle-traits-thir).
- closure.ts: `Debug` of `hir::place::{Place, PlaceBase, ProjectionKind}` (hir/place.rs, unowned; reached only on
  `bug!`/assert-failure paths); `TypeckResults::closure_min_captures_flattened`,
  `TypeckResults::closure_kind_origins` (ty-results).

## PORT decisions (please record)
1. `AdtDef` is the D2 hash-consed class (`extends Interned`, `internee: AdtDefData`, frozen); the interner key is
   `AdtDefData.hash()` = `intern_key(did)`.
2. `inherent::AdtDef` impl: compatible same-name methods are `served by` the inherent ones; `destructor` collides
   incompatibly and is `ir_destructor` (ty-contract decision 5). The second marker of `field_representing_type_info`
   (adt.rs:287) sits on the inherent method (identical body).
3. Later `impl` blocks in class bodies (PORTING §8): `AdtDefData.new` (adt.rs:355), `AdtDef`'s second block
   (adt.rs:406-760), `TraitDef.ancestors`.
4. Plain data structs with methods are interface + companion (`AssocItem`, `AssocItems` (generated), `TraitImpls`,
   `UpvarId`); `TraitImpls` must be: its fields and accessors share names, and impl_interner.ts reads the field.
5. Pending ty/mod.rs / hir/place.rs / typeck_results.rs types are read through exported `*View` interfaces
   (`VariantDefView`, `FieldDefView`, `VariantDiscr`, `HirPlaceView`, `HirProjectionKind`, `HirPlaceBase`,
   `TypeckResultsView`, `RestrictionKind`, `DataTypeKind`) with upstream field/method names, cast at the boundary;
   methods that are not field reads are `unported` stand-ins.
6. `SortedIndexMultiMap`: `K: Ord` is a `cmp` function; `Option<Symbol>` orders `None` first, symbols by index
   (derived `Ord` of `Symbol`). `impl Hash` is a key string; iterators are generators.
7. `impl Iterator` returns are generators (lazy), so query-calling closures (`find_by_ident_and_kind`'s hygiene check,
   `discriminants`) run in upstream order and stop where upstream stops.
8. `assert!(cond, "{:#?}", ..)` with formatted messages is `if (!cond) panic(..)` so the message (which would hit the
   pending `Place` Debug) is only formatted on failure.
9. `unimplemented!("FIXME(comptime)")` is `panic("not implemented: FIXME(comptime)")` (an ICE, like rustc).
10. New file `rustc_data_structures/sorted_map/index_map.ts` outside the brief's file list (needed by `AssocItems`).
