# Handoff: merge-w15b (fixer): wave 15 rustc_middle::ty integration

Worktree `.data/integ`, branch `integ`, based on main `fe3254c`. Merged with `--no-ff`, in this order: query-growth,
ty-mod-a, ty-mod-b, ty-util, ty-args, ty-adt-assoc, ty-sty, middle-traits-thir, rmeta-ty, assoc-opaque, ty-results
(root confirmed mid-task that ty-results had finished; its handoff is on its branch). Every merge commit type-checks;
the cross-lane repoints are in the merge commit or the `merge-w15b: reconcile ...` commit right after it.

## Conflicts and how they were resolved
- **ty-mod-b** (`ty/mod.ts`): the shared `decls.ts` import line and both import blocks were unioned, duplicates
  dropped. One `TypingEnv` class: ty-mod-a's position (mod.rs:1105) with ty-mod-b's 11 methods and ty-mod-a's
  `debug_TypingEnv` (it uses the real `debug_ParamEnv`). ty-mod-b's DELETE AT MERGE stand-ins for ty-mod-a items
  (`RestrictionKind_`, `debug_RestrictionKind_`, `ParamEnv_empty`, `ParamEnv_with_normalized`, `debug_ParamEnv_`) are
  gone; `ImplTraitHeaderFields` is the real `ImplTraitHeader`.
- **ty-util** (`query/calls.ts`): query-growth and ty-util made the same `TyCtxt::typeck` repoint; kept the typed one.
- **ty-sty** (`ty/contract.test.ts`): both lanes moved the stub probe; kept ty-sty's `Ty` probe
  (`inhabited_predicate`) and ty-util's `TyCtxt` probe (`expand_abstract_consts`).
- **middle-traits-thir** (`ty/context.ts`): imports and the interner field types unioned (`adt_def: InternedSet<AdtDef>`,
  `external_constraints: InternedSet<ExternalConstraints>`).
- **rmeta-ty**: `queries.gen.ts` regenerated; `context.ts` `GlobalCaches`: kept middle-traits-thir's real traits caches
  and rmeta-ty's `pending_cache` for infer's `CanonicalParamEnvCache` (so `GlobalCaches::default` no longer stops; the
  first *use* of that cache does — traits.test.ts pin updated accordingly).
- **ty-results**: `context.ts` imports (union), `contract.test.ts` (no static stub is left anywhere, so the
  static-stub probe line is gone), `print/pretty.ts` `Value::destructure_adt_const` (ty-results' forwarder).

## Stand-ins repointed / duplicates removed (one implementation per upstream fn)
- **decls.ts** re-exports the real types: `ParamEnv`, `TypingEnv`, `PseudoCanonicalInput`, `VariantDef`,
  `ImplOverlapKind`, `ImplTraitInTraitData`, `Destructor`, `AsyncDestructor` (ty/mod.ts), `Attribute` (rustc_attr_ir),
  `Discr` (shape: util.ts's class `{ val: bigint, ty }`), `CheckRegions`, `NotUniqueParam` (util.ts), `AdtDef`,
  `AdtDefData` (adt.ts), `CapturedPlace` (closure.ts), `SortedIndexMultiMap` (index_map.ts), `SizedTraitKind`
  (rustc_type_ir solve), `ValTree`, `Value`, `ScalarInt`, `TypeckResults` (ty-results). `struct_tail_raw` is declared
  with its 4th parameter `f`. ty-mod-b's `from_pending`/`to_pending` remain only for still-pending types (hir BodyId,
  mir Body, LayoutError, InstanceKind); the ty-results `as_pending_Value` / `from_pending_Value` casts are gone.
- **context.ts**: `mk_adt_def` / `mk_adt_def_from_data` wired (interner key `AdtDefData::hash()`); `mk_place_downcast`;
  `trait_may_define_assoc_item`; `return_type_impl_or_dyn_traits(_with_type_alias)` (diagnostics.ts's
  `TraitObjectVisitor`); `is_method`, `HasAttrs`, `GenericParamDef`, `own_args`, `stable_cmp` stand-ins repointed.
- **impl_interner.ts**: `with_cached_task` = `dep_graph.with_anon_task(.., "TraitSelect", ..)`; `ir_clauses_of`,
  `own_clauses_of`, `ir_const_conditions`, `associated_type_def_ids` ported over the real types; `TraitDefFields` gone.
- **inherent.ts**: `inherent::AdtDef::destructor` is `ir_destructor`.
- **structural_impls**: the `Ty` / `Predicate` / `Clause` / `GenericArg` gen-shaped stubs in mod.ts / predicate.ts /
  generic_args.ts now wrap `fold_Ty` / `fold_Predicate` / `fold_Clause` and re-export the Debug fns; every
  `standin_fold_Ty` / `standin_fold_Clauses` use is `fold_Ty` / `fold_Clauses`; Debug stubs for `ParamConst`,
  `LateParamRegionKind`, `AdtDef` (TyKind Debug), `ConstKind::Param` use structural_impls.
- `fold_list` / `try_fold_list` (generic_args.ts, structural_impls.ts copies) -> util.ts; `visit_List` -> generic_args.ts;
  `InstantiatedClauses` (generics.ts copy) -> mod.ts; UpcastFrom stand-ins in rustc_type_ir predicate.ts / relate
  combine.ts -> re-exports of ty/predicate.ts; `ReverseMapper_new` -> opaque_types.ts; rustc_ty_utils assoc.ts
  stand-ins -> `AssocItems.new` / `in_definition_order` / `AssocItem.trait_item_def_id`.
- Every `AdtDef_*`, `AssocItem_*`, `VariantDef_*`, `FieldDef_*`, `Generics_*`, `ObligationCause_*`, `TypingEnv_*`,
  `ValTree_*`, `ScalarInt_*`, `Value_*`, `TypeckResults_*` stand-in in mod.ts, util.ts, sty.ts, adt.ts, closure.ts,
  thir.ts, trait_def.ts, specialization_graph.ts, keys.ts, handle_cycle_error.ts, fast_reject.ts, relate.ts, print,
  delegation/generics.ts, consts.ts, valtree.ts, lit.ts, error.ts, adjustment.ts points at the real port.
- `has_unsafe_fields`: util.ts's body carries both markers (sty.rs:1122, util.rs:1275); sty.ts's stub is gone.
- rmeta: table.ts re-exports `ty::Asyncness`; codec.ts `GenericArg` / `Term` decoders are adapters over
  generic_args.ts / mod.ts's (serialize.json); `get_mut_restriction`, RPITIT data, `adt_destructor`,
  `adt_async_destructor` decode via generated `decode_RestrictionKind` / `decode_ImplTraitInTraitData` /
  `decode_Destructor` / `decode_AsyncDestructor` (rustc_middle set `decodable_types`).
- Type maps: `DefIdMap` -> rustc_span's D5 `DefIdMap` (fixes `DiagnosticItems.id_to_name` and 7 query value types);
  `ImplTraitInTraitData`, `SortedIndexMultiMap`, `ScalarInt`, `Value` with their Debug; middle_traits_thir: `AdtKind`,
  `ParamEnvAnd`, `AliasTerm`, `UserType`, `CanonicalUserType(Annotation)`.
- Oracle runners: pretty_oracle / consts_oracle use `FmtPrinter::new` (limits.ts's `hir_krate_attrs` workaround gone);
  the consts oracle blocks no section any more; rmeta-ty oracle compares fn_sig / outlives `{:?}` (0 diffs) and its
  `MIN_MATCHED` is raised (type_of.dbg 294, outlives 1912, outlives.dbg 1908, assoc 748, bounds 124, super/implied 9).

## Providers
- **Unprovided queries no longer ICE.** Upstream `Providers::default()` is `default_query` (a `bug!`). The port turned
  every query of a crate whose `provide` is not ported into that ICE (assoc-opaque's delegation preview: CRASH at
  `tcx.fn_sig`). `rustc_interface/passes.ts` `install_unported_providers` (PORT) now starts every local and extern
  provider as `unported("<query> provider (not ported)")` / `unported("<query> extern provider (not ported)")`; the
  ported `provide` fns overwrite theirs as upstream's do.
- `ty::provide` (mod.rs) is called at upstream's position (after rustc_resolve, before rustc_passes) instead of
  `context::provide` + `print::provide`. It installs closure, context, util (incl. `intrinsic_raw`), print and the
  trait_def providers; its sub-providers of unported files (erase_regions, inhabitedness, util::bug) install nothing
  (PORT), so those queries keep the placeholders.

## PORT decisions to record
1. Unported-provider placeholders in `DEFAULT_QUERY_PROVIDERS` (above).
2. Sub-providers of unported files inside `ty::provide` are no-ops (their queries stay on the placeholders).
3. Cross-module access from defining modules / extension modules to ty/assoc.ts, util.ts, opaque_types.ts,
   diagnostics.ts, trait_def.ts, specialization_graph.ts, traits/mod.ts, consts/valtree.ts goes through lazy `require`
   helpers (init order), as the lanes did; structural_impls.ts (type-only imports) is imported statically.
4. codec.ts `decode_GenericArg_TyDecoder` / `decode_Term_TyDecoder` are adapters (not markers) supplying the derived
   kind decoder to the real `decode_GenericArg` / `decode_Term`.
5. `DefIdMap` is the generated type for `rustc_span::def_id::DefIdMap` (typemap.attr_ir.json, `default_values`).

## Left for root
- `lane ty-mod-a` derives owed to codegen (TypeFoldable/TypeVisitable of `ParamEnv`, ...; TyDecodable of
  `ImplTraitHeader`, `TraitDef`, `AdtDefData`, `GenericClauses`, `ConstConditions`): the generator has no RefDecodable
  for `&'tcx [(Clause, Span)]` and the rustc_middle set lacks the type-IR serialize entries, so `explicit_clauses_of`,
  `const_conditions`, `impl_trait_header`, `trait_def`, `AdtDef` decoding still stop UNPORTED (tried; reverted).
- ty-results "for root" 4: generating valtree.rs / typeck_results.rs derives in set rustc_ty (hand copies remain).
- query-growth: `typemap.lint.json` shadows `rustc_middle::ty::Ty` as `unknown` (blocks 5 `Display of Ty` descs).
- `rustc_lint::LateContext::get_associated_type` still unported (needs `try_normalize_erasing_regions`).
- region.rs (13 fns) is not ported: print/pretty.ts keeps its `EarlyParamRegion_is_named` etc. stand-ins.
- The new `.gen.ts` modules of middle-traits-thir fail as fresh entry points (they import their hand module), like the
  older `.gen.ts` files; every hand module loads.

## Results
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (12258; vendor 3888).
- Codegen: every set of `tools/codegen/types.sets.json` (except `/` keys and `rustc_lexer`) and
  `bun tools/codegen/queries.ts` regenerated; only the expected changes (typemap / set edits above).
  `queries.ts --check`: up to date (unknown types 163, unported desc 61, unported key impls 30).
- Probes: `bun scripts/probes.ts build` (includes rmeta-ty's new `rmetatydump`).
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4486 pass, 1 skip (pre-existing linux-only),
  2 fail at the time of the full run; both were test pins of the old `ParamConst` Debug stub and are fixed in the last
  commit (the two files re-run green: 49 pass). Test pins updated to the real behaviour, none weakened: ty_mod_a
  (`is_fully_generic_for_reflection` runs), ty_mod_b (`with_*_normalized`), sty (real `AdtDef`, `has_unsafe_fields`,
  closure-kind ICE text, `contains`), tyir_relate (Subtype goal, binders, outlives components), tyir_binder (ICE text),
  tyir_misc_lib_sty (Region / Const Debug), traits (GlobalCaches, PatRange), ty_adt_assoc (real VariantDef / FieldDef),
  contract, consts oracle (nothing blocked), rmeta-ty oracle (more lines compared, higher minima).
- Samples (`RUST_TS_AGENT=merge-w15b`), 0 DIFF, 0 CRASH, no protected case lost:
  - parse --sample 200: 200 MATCH (`20261014-110026-merge-w15b-m8x9`).
  - expanded --sample 200: 196 MATCH / 4 UNPORTED (`20261014-110057-merge-w15b-lwlb`): proc-macro bridge x2 (M6),
    `Location::caller`, delegation `generics-gen-args-errors.rs` (rmeta `VariantData` decode); none protected.
  - hir-tree-nocore --sample 300: 293 MATCH / 7 UNPORTED (`20261014-110138-merge-w15b-3fut`): `fn_sig provider (not
    ported)` x3 (delegation), `StableHash without a TS impl` x2, proc-macro bridge x2; none protected.
  - unpretty-hir --sample 200: 194 MATCH / 6 UNPORTED (`20261014-110224-merge-w15b-dt60`): same reasons (no baseline).
- `hir-tree-nocore --filter delegation/`: 36 MATCH / 0 DIFF / 108 UNPORTED / 0 CRASH (`20261014-110305-merge-w15b-tsh7`),
  all 108 at `fn_sig provider (not ported)` (was `TyCtxt::is_method`; without the placeholder providers they are ICEs).
