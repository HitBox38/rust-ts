# Handoff: rmeta-ty (M3, wave 15): typed metadata decoding

Branch `lane/rmeta-ty`, based on ab2cdfc (merge-w15a). No merges.

## Result
Types, signatures, clauses and associated items now decode from crate metadata for real, through rustc_middle's
`TyDecoder` (ty/codec.rs), the type shorthand cache of `MetadataDecodeContext` and the generated `derive(TyDecodable)` /
`derive(Decodable_NoContext)` of the type sets.

**Oracle (new probe `rmetatydump`, new test `src/rustc_metadata/rmeta/rmeta_ty.oracle.test.ts`)**: 17,596 lines over a
sample of core and alloc DefIndexes, **0 diffs**. Matched: kind 3400, `type_of` 1181, `fn_sig` 214, `generics_of` 1912,
`inferred_outlives_of` 1908, `variances_of` 884, `associated_item` 747, `explicit_item_bounds` 121. Pending (UNPORTED,
counted by stop): `AdtDefData` decode 1964 (every type mentioning an ADT), `GenericClauses` 1912, `{:?}` of
`Ty`/`Clause` (structural_impls.rs Debug stubs) 1181 + 2122, `Predicate::expect_clause` 31 (non-empty clause lists),
`ty::Value` / `ScalarInt` consts 16, `ImplTraitInTraitData` 1. Negative control: flipping `RawPtr`'s mutability in the
generated `decode_TyKind` gives 13 diffs. The test also requires each line kind to keep at least its measured match
count (`MIN_MATCHED`), so a regression cannot hide behind UNPORTED.

## Files
- **New ports**
  - `src/rustc_middle/ty/codec.ts`: codec.rs **50/50**. `TyEncoder` / `TyDecoder` / `EncodableWithShorthand` declared
    (markers on the trait items), `TyDecoder_provided.positioned_at_shorthand`, every `Decodable` impl
    (`decode_Ty`, `decode_Predicate`, `decode_Clause`, `decode_GenericArgs`, `decode_Place`, `decode_CanonicalVarKinds`,
    `decode_AllocId`, `decode_CtfeProvenance`, `decode_SymbolName`, `decode_ParamEnv`, `decode_Pattern`,
    `decode_ValTree`, `decode_ConstAllocation`, `decode_AdtDef`), `forward_all_decoder_methods_to` (the macro: installs
    the 14 forwarders, markers :327..:350). Encoding half `rustc-skip`ped (M5).
  - `src/rustc_middle/ty/codec/ref_decodable.ts`: ref_decodable.rs **8/8** (`RefDecodable`, the six `List` impls,
    the `impl_decodable_via_ref_decodable_for_local_types!` impl).
- **Hand edits**
  - `src/rustc_metadata/rmeta/decoder.ts`: `MetadataDecodeContext` implements `TyDecoder`; `cached_ty_for_shorthand`
    ported (`tcx.caches.ty_rcache`); `positioned_at_shorthand` forwarded; the two `Decoder` impls call codec.ts's
    `forward_all_decoder_methods_to` (the hand loop is gone); `get_associated_item` ported (was an M3 stub);
    declarations tightened (`cached_ty_for_shorthand` → `Ty`, `decode_alloc_id` → `AllocId`, `get_associated_item` →
    `AssocItem`; `PORT(decls)` note). Imports in a `// rmeta-ty imports` block.
  - `src/rustc_metadata/rmeta/decoder/cstore_impl.ts`: real decoders for `type_of`, `fn_sig`, `explicit_item_bounds`,
    `explicit_item_self_bounds`, `inferred_outlives_of`, `explicit_super_clauses_of`, `explicit_implied_clauses_of`,
    `variances_of`, `const_param_default`, `thir_abstract_const`, `explicit_implied_const_bounds`,
    `coerce_unsized_info`, `assumed_wf_types_for_rpitit`, `anon_const_kind`, `const_of_item`; `ProcessQueryValue_EarlyBinder`
    is `EarlyBinder::bind_no_rigid_aliases` (was unported). `associated_item` works through `get_associated_item`.
  - `src/rustc_middle/ty/context.ts`: `GlobalCaches::default` builds the not-yet-ported caches (`SelectionCache`,
    `EvaluationCache`, infer's `CanonicalParamEnvCache`) as `pending_cache(..)` values that stop on first use, so
    `tcx.caches.ty_rcache` is usable (before, any read of `tcx.caches` stopped).
  - `src/rustc_type_ir/serialize.ts`: callees loaded lazily (generated modules now import it; init order).
  - Tests: `src/rustc_metadata/rmeta/contract.test.ts` (the `get_associated_item` stop probe is gone: ported);
    `tools/codegen/type_fold.test.ts` (golden counts 255 types / 128 Debug / 94 Decodable + the pinned
    `missing_decodable` list).
- **tools/codegen** (please review)
  - `types.ts`: (1) a serialize.json entry keyed by an *item* of the set gives its Decodable impl when the set does
    not generate it and its hand module exports no `decode_<T>` (impls living in codec.rs / rustc_type_ir
    serialize.rs: `Predicate`, `Clause`, `Region`, `Const`, `Binder`, `UnsafeBinderInner`); for a type alias the entry
    is used before the alias is expanded (`GenericArgsRef` hides a reference, so the derive calls `Decodable`, not
    `RefDecodable`). (2) new set option `decodable_import_gen: [hand modules]`: generated `decode_<T>` of those files
    are imported from their `.gen.ts`, not through the hand module (extension modules must not load early).
    Every other set regenerates byte-identically except `rustc_middle/decodable.gen.ts` (decoder type, below).
  - `serialize.json`: `decoders.TyDecodable` → `TyDecoder` (src/rustc_middle/ty/codec.ts); `I::*` associated-type
    entries (`I::Ty`, `I::Tys`, `I::GenericArgs`, `I::Region`, `I::Const`, `I::Clauses`, ...); `I::Symbol`, `I::DefId`
    and the `*Id`s, `I::LocalDefId`, `I::ErrorGuaranteed`, `rustc_hir::Mutability` added to existing entries.
  - `types.sets.json`, set `rustc_ty`: `derive_decodable`, `decoders.Decodable_NoContext` → `TyDecoder`,
    `decodable_import_gen` (assoc.ts, consts.ts, sty.ts); **`CoerceUnsizedInfo` un-skipped** (codegen-tyir's deferral).
  - Regenerated: the 35 rustc_ty `.gen.ts` (94 decoders), `src/rustc_middle/decodable.gen.ts` (`TyDecoder`),
    `src/rustc_middle/queries.gen.ts` (`coerce_unsized_info` typed `CoerceUnsizedInfo`). `queries.ts --check` current.
- **Probe**: `tools/probes/rmetatydump/` (rustc-dev). Build it on gate hosts: `bun scripts/probes.ts build rmetatydump`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4293 pass, 1 skip (the existing linux-only one), 0 fail.
- `bun scripts/coverage.ts --check`: markers ok (11110; vendor 3888). `--missing`: codec.rs 50/50,
  codec/ref_decodable.rs 8/8, decoder.rs 156/156, cstore_impl.rs 37/37.
- Fresh-process loads of every module under rustc_type_ir/, rustc_middle/, rustc_metadata/: the same set of failures
  as the base commit (pre-existing: the `*_oracle/run.ts` scripts, print/mod.ts and a few rustc_type_ir `.gen.ts`
  entered first), nothing new.
- `RUST_TS_AGENT=rmeta-ty` difftest samples:
  - **expanded --sample 100**: 100 MATCH / 0 DIFF / 0 UNPORTED (run `20261014-072140-rmeta-ty-96er`).
  - **hir-tree --sample 100**: 99 MATCH / 0 DIFF / 1 UNPORTED (run `20261014-072201-rmeta-ty-5jm1`):
    `delegation/generics/mapping/impl-trait-to-free-pass.rs` stops at `TyCtxt::is_method`, identical on the base
    commit (checked), the delegation stop merge-w15a lists.

## `unported(...)` left (on this path)
- codec.ts (types of other lanes / M4): `Decodable for AdtDefData` (ty-adt-assoc; every ADT type stops here),
  `ParamEnv { caller_bounds }` (ty-mod), `SymbolName::new`, `mir::PlaceElem`, `CtfeProvenance::from_parts`,
  `mir::interpret::Allocation` (M4). `mk_pat` / `intern_valtree` / `mk_const_alloc` / `mk_adt_def_from_data` stop in
  context.ts's `direct_interners!` stubs; `mk_poly_existential_predicates` (dyn types) stops at `stable_cmp`.
- `Predicate::expect_clause` (ty-args) stops every non-empty clause list (`decode_Clause`).
- Generated `unported_decodable` fields (the golden pins them): `I::ValueConst`, `I::ScalarInt` (ty-results),
  `I::LocalDefIds`, `I::PredefinedOpaques`, `I::RegionAssumptions`, `rustc_abi::FieldIdx`, `mir::BinOp` / `UnOp`,
  `abstract_const::CastKind`, `ImplTraitInTraitData`.
- decoder.ts: `decode_alloc_id` (AllocDecodingSession, M4); `get_variant` / `get_adt_def` (AdtDef, ty-adt-assoc);
  `decode_ImplTraitInTraitData_pending` (RPITIT associated types).
- cstore_impl.ts still `decode_unported`: `GenericClauses` (`explicit_clauses_of`), `ImplTraitHeader`, `TraitDef`,
  `ConstConditions`, `ObjectLifetimeDefault`, `CodegenFnAttrs`, `OpaqueTyOrigin`, `PreciseCapturingArgKind`,
  `Destructor`/`AsyncDestructor`, MIR / const-eval / bitset / DefIdMap types.

## PORT decisions (please record)
1. `TyDecoder` is an interface; `positioned_at_shorthand` is `TyDecoder_provided`; `CLEAR_CROSS_CRATE` stays the
   implementor's `<Impl>_CLEAR_CROSS_CRATE` const. Encoding half of codec.rs rustc-skipped (M5), as decls.ts planned.
2. Set rustc_ty decodes with `TyDecoder` for `Decodable_NoContext` too (upstream's `where I::Ty: Decodable<D>` bounds
   are only met by a TyDecoder); global `TyDecodable` → `TyDecoder`.
3. Decodable impls outside the type's module come from serialize.json entries keyed by the item (generator change 1).
4. codec.ts, ref_decodable.ts and rustc_type_ir serialize.ts load their callees lazily (`require` in a function):
   every generated type module imports them.
5. Stand-ins in codec.ts running upstream bodies, no markers: `decode_GenericArg_standin` (generic_args.rs:371, lane
   ty-args) and `decode_Term_standin` (ty/mod.rs:639). When those files export `decode_GenericArg` / `decode_Term`,
   the generator picks the hand export automatically for the rustc_ty items; repoint `decode_GenericArgs` and the
   `I::GenericArg` / `I::Term` serialize.json entries, then delete the stand-ins.
6. `CReaderCacheKey` (ty/mod.rs, not ported) is the string key `<cnum>:<pos>` of `ty_rcache` (`Map<string, Ty>`).
7. `GlobalCaches::default` uses `pending_cache(..)` (stop on first use) for unported caches.
8. The probe prints a structural "shape" of each type besides `{:?}`, so decoding is checked before `Debug for Ty`
   lands; the test treats `.dbg` lines as pending until then.

## For root
- Build `rmetatydump` on gate hosts.
- Review the tools/codegen changes and the out-of-lane edits (context.ts `pending_cache`, rustc_type_ir serialize.ts,
  contract.test.ts / type_fold.test.ts pins).
- When ty-adt-assoc lands `AdtDefData` (+ its TyDecodable opt-in, e.g. in the rustc_middle derive_only set), replace
  codec.ts's `decode_AdtDefData` stub; when ty-args ports `expect_clause` / `GenericClauses`, wire
  `explicit_clauses_of` in cstore_impl.ts. Raise `MIN_MATCHED` in the oracle test as stops fall.
