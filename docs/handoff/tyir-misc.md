# Handoff: tyir-misc (wave 14, M3): the remaining rustc_type_ir files

Branch `lane/tyir-misc` (from main a62a248, no merges). The lane agent ported interner.rs + inherent.rs and split the
rest into four parallel sub-lanes on disjoint files in the same worktree (lib-sty, predicate, infer,
region-constraint); every commit names its sub-lane (`tyir-misc(<sub>): ..`). 20 commits.

## Scope taken (every rustc_type_ir file outside tyir-kind / tyir-binder / tyir-relate / tyir-solve)
Assigned: interner.rs, inherent.rs, predicate.rs, predicate_kind.rs, canonical.rs, infer_ctxt.rs, universe.rs,
ir_print.rs, fast_reject.rs (rest). "Any other" file, taken here: lib.rs, sty/mod.rs, sty/consts.rs,
region_constraint.rs, unnormalized.rs, ty/alias.rs, opaque_ty.rs, error.rs, ty_info.rs, upcast.rs, intern/mod.rs,
macros.rs, lift.rs, serialize.rs, data_structures/delayed_map.rs (data_structures/mod.rs, generic_arg.rs,
lang_items.rs, pattern.rs, ty/mod.rs, solve/inspect.rs have 0 fns). Left to their lanes: binder, fold, visit, walk,
generic_visit (tyir-binder); relate, relate/*, elaborate, outlives (tyir-relate); solve/*, search_graph/* (tyir-solve).

## Coverage (`bun scripts/coverage.ts --missing`): every file `N/N ported`
| file | ported | skips |
|---|---|---|
| interner.rs | 116/116 | |
| inherent.rs | 139/139 | |
| predicate.rs | 64/64 | |
| predicate_kind.rs | 2/2 | |
| ir_print.rs | 16/16 | |
| unnormalized.rs | 20/20 | |
| infer_ctxt.rs | 82/82 | |
| canonical.rs | 11/11 | |
| fast_reject.rs | 12/12 | |
| region_constraint.rs | 64/64 | |
| lib.rs | 16/16 | |
| universe.rs | 10/10 | |
| sty/mod.rs | 36/36 | |
| sty/consts.rs | 31/31 | |
| ty/alias.rs, opaque_ty.rs, error.rs | 1/1, 2/2, 5/5 | |
| ty_info.rs | 6/6 | :87 StableHash (M5) |
| upcast.rs, intern/mod.rs | 4/4, 1/1 | |
| macros.rs | 5/5 | :92 Lift |
| lift.rs | 2/2 | :20, :26 Lift |
| serialize.rs | 11/11 | :28/:62/:84/:105/:125 Encodable (M5) |
| data_structures/delayed_map.rs | 12/12 | |

rustc_type_ir overall: 883/1349 (was 331).

## Checks (on the final tree)
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4178 pass, 1 skip (pre-existing linux-only), 0 fail.
- `bun scripts/coverage.ts --check`: `markers ok (10005; vendor 3888)`.
- `RUST_TS_AGENT=tyir-misc --suite expanded --sample 100`: 100/100 MATCH (`20261014-052306-tyir-misc-f8l8`);
  `--suite hir-tree-nocore --sample 100`: 98 MATCH / 0 DIFF / 2 UNPORTED, both pre-existing stops listed by merge-w14
  (`TyCtxt::is_method`, StableHash for a type without a TS impl) (`20261014-052313-tyir-misc-ahpd`).
  The predicate sub-lane also ran `expanded --sample 50`: 50/50 (`20261014-050334-tyir-misc-predicate-v6tm`).
- `rustc_middle/lib.ts` loads as a fresh entry point; every new/edited file loads as an entry point.

## Most important notes for root
1. **Init order (TDZ)**: ty_kind.ts imports `debug_ParamTy` from the *extension* module rustc_middle ty/sty.ts, and
   generated files keep `import { type ParamTy } from ".../ty/sty.ts"` as side-effect imports
   (`verbatimModuleSyntax`). Any defining module reaching ty_kind.ts statically (sty/mod.ts, sty/consts.ts) therefore
   evaluated ty/sty.ts before `Ty` existed. lib-sty works around it with a lazy `require(..)` of
   `debug_RegionKind` / `debug_ConstKind`; the same TDZ will hit whoever ports `debug_Ty`. Fix at the source.
2. **IrPrint registry** (ir_print.ts): ty-print-a/-b must fill `IR_PRINT.<Type> = { print, print_debug }` at load,
   and export per-`T` `IrPrint<Binder<T>>` / `<OutlivesClause<T>>` / `<Placeholder<T>>` impl objects
   (`display_Binder(self, ir_print)`). Until then TraitRef/ExistentialTraitRef/PatternKind Debug and the Display impls
   stop UNPORTED.
3. **decls.ts**: re-export `CanonicalParamEnvCache` from canonical.ts (now a class). No `PORT(decls)` overrides were
   added by this lane.
4. **Repoint tyir-kind's stand-ins** (ty_kind.ts, ty_kind/closure.ts): `DebruijnIndex_shifted_in/_out` ->
   `DebruijnIndex.shifted_in/shifted_out` (lib.ts; these wrap u32 like the release oracle, the stand-ins did not);
   `debug_bound_var` -> lib.ts; closure.ts `DelayedMap` -> data_structures/delayed_map.ts `DelayedMap.default_(key)`;
   `Unnormalized_new` -> `Unnormalized.new_wip` / `dummy`, `.value` reads -> `skip_normalization` / `skip_norm_wip`.
5. **Binder stand-ins** with upstream bodies exist in several files of this lane (inherent.ts: `map_bound`,
   `map_bound_no_validate_bound_vars`, `transpose`; region_constraint.ts: `bound_vars`, `bind_with_vars`,
   `super_fold_with`; canonical.ts: placeholder/bound-region accessors) and `unported` ones (predicate.ts:
   `map_bound_ref`, `map_bound_no_validate_bound_vars`, `rebind`): repoint all at binder.ts when tyir-binder merges.
   Likewise the `TypeRelation`/`Relate` structural stand-ins (sty, region_constraint) at tyir-relate's relate.ts.
6. **D6 order**: `TransitiveRelation::base_edges` iterates an `FxHashSet` (hashbrown order) and decides the element
   order of `Assumptions`' inverse relation; the oracle showed reverse insertion order for a 4-edge graph. Whoever
   ports rustc_data_structures `transitive_relation.rs` (no lane yet) must reproduce it.
7. **Codegen typemap**: generated `debug_TypingMode` (Typeck / PostTypeckUntilBorrowck / PostBorrowck) and
   `debug_Canonical`'s `var_kinds` print through `unported_debug`: add Debug entries for `I::LocalDefIds` (RawList of
   `debug_LocalDefId`) and `I::CanonicalVarKinds` (RawList of `debug_CanonicalVarKind`); oracle text
   `Typeck { defining_opaque_types_and_generators: [] }`. serialize.ts's hand Decodables take `decode_T`,
   `decode_BoundVarKinds`, `decode_RegionKind`, `decode_ConstKind`, which codegen should generate.
8. `TyCtxt` does not satisfy `Interner` in TS yet (14 placeholders, some queries typed `unknown`): predicate.ts casts
   with `as_interner(tcx)`, tests cast `as unknown as Interner`; drop when ty-ctxt lands.
9. Test pins changed outside the lane's files (they pinned the stub state; now assert real behaviour, nothing
   weakened): tyir_kind.test.ts ("Ref stops as UNPORTED" -> `Ref` interns with the oracle's flags);
   rustc_middle/ty/contract.test.ts ("a stub stops as UNPORTED" -> `Region.new_static` is real; the stub example is
   now `Const.zero_sized`).
10. The four oracle probes are throwaway rustc-dev programs under `/tmp/tyir-misc-{lib-sty,predicate,infer,
    region-constraint}/main.rs` (copies of tyir-kind's `after_expansion` probe, each with `empty.rs` and `out.txt`;
    build `rustc +nightly --edition 2024 -O main.rs -o probe -C link-arg=-Wl,-rpath,$(rustc +nightly --print sysroot)/lib`).
    Root may adopt them into tools/probes; /tmp is not durable.

## Per sub-lane: files, tests, `unported(...)`, PORT decisions, probes

### lane agent: interner.rs, inherent.rs
- `src/rustc_type_ir/interner.ts` (edited): interner.rs 116/116. Added `Cx_for_Interner` (the 5 fns of
  `impl search_graph::Cx for I`, :759-:775), forwarding to the `Interner` methods; header table gains
  `I::FnInputTys` = `FnInputTys` and pointers to ir_print.ts / inherent.ts. The `Interner` interface (ty-contract's
  shape) is unchanged: every trait method was already declared with its marker; no gaps found against the upstream
  item list (assoc types: all in the header table).
- `src/rustc_type_ir/inherent.ts` (new): inherent.rs 139/139. Each trait is a TS interface with `// rustc-trait:`;
  required items carry markers in the interface; associated fns (no `self`) are a separate `<Trait>_static`
  interface (`Ty_static`, `Safety_static`, `GenericArgs_static`, `Span_static`, `BoundVarKinds_static`,
  `Symbol_static`); provided methods are `<Trait>_provided` objects (`Ty_provided`, `GenericArg_provided`,
  `Term_provided`, `GenericArgs_provided`, `Predicate_provided`, `Clause_provided`, `SliceLike_provided`); the
  three `SliceLike` impls are `SliceLike_for_slice`, `SliceLike_for_array`, `SliceLike_for_ref(d_S)`.
- Test `src/rustc_type_ir/tyir_misc_inherent.test.ts`: provided methods (kind predicates, rigid/unsized, as_*/expect_*
  with upstream panic strings, allow_normalization, as_*_clause, SliceLike), `Cx_for_Interner` forwarding, and
  type-level conformance of rustc_middle `Ty` / `Predicate` / `Clause` to `inherent.Ty` / `.Predicate` / `.Clause`.

### sub-lane lib-sty: lib.rs, universe.rs, sty/*, ty/alias.rs, opaque_ty.rs, error.rs, ty_info.rs, upcast.rs, intern/mod.rs, macros.rs, lift.rs, serialize.rs, data_structures/delayed_map.rs
- Edited `lib.ts`, `sty/mod.ts`, `sty/consts.ts`, `ty/alias.ts`, `opaque_ty.ts`, `error.ts`, `ty_info.ts`, `macros.ts`; new `universe.ts`, `upcast.ts`, `intern/mod.ts`, `lift.ts`, `serialize.ts`, `data_structures/delayed_map.ts`, `data_structures/mod.ts` (re-export), test `tyir_misc_lib_sty.test.ts` (17 tests). Commits d5d2db3, 91c3dba, ede7981, dec154f, 00ae15c, be55ec6, 737405e, 24bb598.
- Pins edited outside the lane's files (they asserted the stub state; now assert real behaviour): `tyir_kind.test.ts` "Ref stops as UNPORTED" -> `Ref` interns once with the oracle's flags for `'static` / `'?5`; `rustc_middle/ty/contract.test.ts` "a stub stops as UNPORTED" -> `Region.new_static` returns the interner's `'static`, the static-stub example is now `Const.zero_sized`.
- Coverage: lib.rs 16/16, universe.rs 10/10, sty/mod.rs 36/36, sty/consts.rs 31/31, ty/alias.rs 1/1, opaque_ty.rs 2/2, error.rs 5/5, ty_info.rs 6/6 (skip :87 "StableHash impl (incremental, M5)"), upcast.rs 4/4, intern/mod.rs 1/1, macros.rs 5/5 (skip :92 Lift), lift.rs 2/2 (skips :20, :26 Lift), serialize.rs 11/11 (skips :28/:62/:84/:105/:125 "Encodable impl (metadata encoding, M5)"), data_structures/delayed_map.rs 12/12.
- serialize.rs's hand-written `Decodable` impls are ported (reached from metadata: rmeta type tables of extern `fn_sig`/`type_of`/`predicates_of`; nothing calls them yet): `decode_Binder`, `decode_Binder_GenericArgs`, `decode_UnsafeBinderInner`, `decode_Region`, `decode_Const`, interface `InternerDecoder`. They take the decode fns of their parts (`decode_T`, `decode_BoundVarKinds`, `decode_RegionKind`, `decode_ConstKind`), which are derived Decodables for tools/codegen to generate.
- Tests (oracle strings verbatim): Variance Debug + the 16-case `xform` table; UniverseIndex Debug (`{:?}`/`{:#?}`), `next_universe`, `can_name`, `cannot_name`, `is_root`, `default_`; ClosureKind Display/Debug/`as_str`, `extends` table, `LATTICE_BOTTOM`; DebruijnIndex shifts incl. u32 wrap + `newtype_index!` assertion, `debug_bound_var`; 12 regions: interning, flags, `outer_exclusive_binder`, every `is_*`, `bound_at_or_above_binder`; `Ref` over all 12 regions with flags; Region/Const Debug (`'static`, `'?5`, `'{erased}`, `'{region error}`, `?3c`, `Fresh(2)`, `{const error}`, three bound consts `^BoundConst { var: 0, .. }`...); arms needing another lane's stub use `oracle_or_unported` (oracle text or UNPORTED, nothing else; today UNPORTED: bound/placeholder regions, early/late param regions, placeholder/param consts); `get_name`/`is_named`/`get_name_or_anon`, `as_var` + panic text; 8 consts: flags, oeb, predicates, `ct_vid`; fold/visit/super-fold/relate dispatch, TypeError helpers, `Alias.kind`, Upcast, DelayedMap/DelayedSet at the 32-insert cutoff.
- `unported(...)` (module-local stand-ins): sty/mod.ts: `EarlyParamRegion` `get_name`/`is_named` (rustc_middle region.rs:44/:51), `BoundRegionKind::get_name`/`is_named` (binder.rs:1041/:1037, tyir-binder), `LateParamRegionKind` `get_name`/`is_named`/`get_def_id` (region.rs:128/:133/:139), `Generics::param_region_def_id` (generics.rs:154), `Debug for LateParamRegionKind` (structural_impls.rs:67). sty/consts.ts: `Display for ty::Value` (ty-print), `BoundConst::new` (binder.rs:1245; so `Const.new_anon_bound`/`new_canonical_bound` stop UNPORTED). universe.ts: `TypeVisitableExt::has_placeholders`/`has_infer` (visit.rs:315/:311), `TypeSuperVisitable for Ty` (structural_impls) -> `max_universe*` stop UNPORTED. serialize.ts: `Binder::bind_with_vars` (tyir-binder). Structural interface stand-ins `TypeRelation_regions` / `TypeRelation_consts` (tyir-relate's `TypeRelation` should be compatible). Existing stubs called: `visit_with_ErrorGuaranteed`, the `*_with_Value` fns, `TypeVisitor_provided`, `span_delayed_bug`.
- Stand-ins in ty_kind.ts / ty_kind/closure.ts that now have real ports (root: repoint): `DebruijnIndex_shifted_in`/`_shifted_out` -> `DebruijnIndex.shifted_in`/`shifted_out` (lib.ts; these wrap u32 like the release oracle, the stand-ins did not); `debug_bound_var` -> lib.ts `debug_bound_var` (same signature); closure.ts `DelayedMap` -> `data_structures/delayed_map.ts` `DelayedMap.default_(key)` (a `(DebruijnIndex, Ty)` key needs a key fn, e.g. ``([d, t]) => `${d},${t.id}` ``).
- PORT decisions:
  1. **Init order**: sty/mod.ts and sty/consts.ts are defining modules; statically importing region_kind.ts / const_kind.ts reached the extension module rustc_middle ty/sty.ts (through ty_kind.ts's `debug_ParamTy` import) and caused a TDZ on `Ty`. `debug_RegionKind` / `debug_ConstKind` are loaded lazily with `require(..)` at call time. **For root**: the real defect is ty_kind.ts importing from an extension module, plus generated files with `import { type ParamTy } from ".../ty/sty.ts"` (kept as side-effect imports under `verbatimModuleSyntax`); the same TDZ will hit whoever ports `debug_Ty`.
  2. lib.ts does not mirror upstream's `pub use <mod>::*` globs (universe.ts included), to avoid import cycles.
  3. DebruijnIndex u32 arithmetic uses `>>> 0` (no overflow checks in the release oracle), then `from_u32` asserts like upstream.
  4. `impl Default` -> `default_()` (`UniverseIndex`, `DelayedMap`, `DelayedSet`); `shift_in`/`shift_out` take a `MutRef`.
  5. `I::Symbol::KW_STATIC_LIFETIME` / `SYM_ANON` -> `kw.StaticLifetime` / `sym.anon`; `I::Span::dummy()` -> `DUMMY_SP`.
  6. `IntoKind::kind` of Region and Const is the inherent `kind` (two stacked markers).
  7. `kind != self.kind()` in Const's super-fold compares intern keys (derived `PartialEq`).
  8. Relate impls are `relate_Region` / `relate_Const` over a structural relation interface.
  9. `MaxUniverse`'s const generics are constructor fields; its field `max_universe` is `max_universe_` (the method needs the name); `max_universe*` take a `TypeFoldable` descriptor `d_T`.
  10. Upcast/UpcastFrom are descriptor interfaces; blanket impl `upcast(self, interner, upcast_from_U)`, reflexive `upcast_from_self`.
  11. `From<TypeError>` for `NoSolution` / `NoSolutionOrRerunNonErased` are free fns `NoSolution_from_TypeError` / `NoSolutionOrRerunNonErased_from_TypeError` in error.ts (those companions are tyir-solve's).
  12. ty_info.rs trait impls take `T`'s impl fn last (`eq_T`, `cmp_T`, `hash_T`).
  13. `intern::Interned<I>` is a TS interface only.
  14. opaque_ty iterators are lazy generators (the `panic!` fires when the item is reached, as upstream).
- Probe: `/tmp/tyir-misc-lib-sty/main.rs` (+ `empty.rs`, output `out.txt`): Variance Debug + `xform`; UniverseIndex ops; ClosureKind Display/Debug/`extends`; DebruijnIndex shifts; 12 regions (static, var, erased, error, anon bound, bound ClosureEnv at D2, canonical, placeholder, early named/anon, late Anon/ClosureEnv) with `{:?}`/`{:#?}`, flags, oeb, predicates, names, `as_var`, `LateParamRegion` Debug; 8 consts; `Ty::new_ref` over each region.

### sub-lane predicate: predicate.rs, predicate_kind.rs, ir_print.rs, unnormalized.rs
- Edited `predicate.ts`, `predicate_kind.ts`, `unnormalized.ts`; new `ir_print.ts`, test `tyir_misc_predicate.test.ts` (15 tests, 81 expects). Commits 5920188, 1a4f6d4, d773d02.
- Coverage, no skips (no Lift/Encodable/StableHash/Decodable in these files): predicate.rs 64/64, predicate_kind.rs 2/2, ir_print.rs 16/16, unnormalized.rs 20/20.
- Tests: oracle `{:?}`/`{:#?}` of `ImplPolarity`/`ClausePolarity` (Debug, Display, `as_str`, `flip`), `BoundConstness` (Debug, Display, `as_str`, `satisfies`), `PredicateKind::Ambiguous`, `ClauseKind::UnstableFeature` (alone and in `PredicateKind::Clause`), `ClauseKind::RegionOutlives('?5, 'static)` (alone and wrapped), `ConstEvaluatable(?3c)`, `ConstEquate(?3c, Fresh(2))`, `Unnormalized`, `RegionConstraint::Eq` + `is_trivial`/`iter_outlives` (structure only: `debug_GenericArg` is a rustc_middle stub). Partly oracle: `TraitClause`, `HostEffectClause`, `ClauseKind::Trait`/`HostEffect` (the test installs a stand-in `IR_PRINT.TraitRef` returning the oracle's TraitRef line; only rustc_type_ir's formatting around it is verified). Upstream semantics: empty registry slot -> UNPORTED; generic `display_Binder` uses the passed impl; `ClosureKind`/`TraitRef` `into_diag_arg`; `TraitRef.from_assoc`, `with_replaced_self_ty`, `ExistentialTraitRef.with_self_ty`, `ExistentialProjection.trait_ref`/`alias_kind` (incl. out-of-range panic text), `Unnormalized` methods and folds; stand-ins stop UNPORTED.
- Sample: `difftest --suite expanded --sample 50`: 50/50 MATCH (run `20261014-050334-tyir-misc-predicate-v6tm`).
- `unported(...)`: none in own logic except the empty-slot path of `ir_print.ts` (`<I as IrPrint<X<I>>>::print|print_debug (rustc_middle ty/print, lane ty-print)`). Stand-ins exported from `predicate.ts`, each calling `unported`: `Binder_map_bound_ref` (binder.rs:132), `Binder_map_bound_no_validate_bound_vars` (:155), `Binder_rebind` (:186) (tyir-binder); `Clause_upcast_from_Binder_ClauseKind`, `Clause_upcast_from_PolyTraitRef`, `Clause_upcast_from_PolyProjectionClause` (rustc_middle ty/predicate.rs:491, :517, :588; ty-args). Reuses ty_kind.ts's `Binder_skip_binder` / `Binder_map_bound`. Reached through other lanes' stubs: `tcx.debug_assert_args_compatible` / `debug_assert_existential_args_compatible` (ty-ctxt: `TraitRef.new*` / `ExistentialTraitRef.new*` stop UNPORTED on a real TyCtxt); `RawList.type_at`/`identity_for_item`/`extend_with_error`, `Clause.kind`/`as_trait_clause` (ty-args); `debug_Ty`, `debug_Term`, `debug_GenericArg`.
- PORT decisions:
  1. **IrPrint**: `IrPrint<T>` = `{ print(t, fmt): string; print_debug(t, fmt): string }`; registry `IR_PRINT` (ir_print.ts) with one optional slot per non-generic printed type (TraitRef, TraitClause, ExistentialTraitRef, ExistentialProjection, ProjectionClause, NormalizesTo, SubtypePredicate, CoercePredicate, HostEffectClause, AliasTy, AliasTerm, FnSig, PatternKind, Region, Const). ty-print fills a slot at load: `IR_PRINT.TraitRef = { print, print_debug }`.
  2. Generic Display impls (`OutlivesClause<T>`, `Binder<T>`, `Placeholder<T>`): the `where I: IrPrint<X<I, T>>` bound is a parameter, `display_Binder(self, ir_print: IrPrint<Binder<T>>)`; ty-print exports one impl object per `T` (or a builder from `T`'s `Print`).
  3. Display passes `PLAIN` (the printer writes with `write_str`, flags never reach it); Debug passes `f`.
  4. `debug_TraitRef`, `debug_ExistentialTraitRef`, `debug_PatternKind` live in `ir_print.ts` (hoisted fn declarations, import cycle); `predicate.ts` re-exports the first two under the names generated code imports.
  5. Binder impls get companions named after rustc_middle's aliases: `PolyTraitRef`, `PolyTraitClause`, `PolyExistentialPredicate`, `PolyExistentialTraitRef`, `PolyExistentialProjection`, `PolyProjectionClause`, plus `PolyHostEffectClause` (no upstream alias).
  6. `Unnormalized`: generic blocks on `Unnormalized` (incl. `unzip`, `skip_binder`); concrete blocks on `UnnormalizedClause`, `UnnormalizedPolyTraitClause`, `UnnormalizedPolyTraitRef` (`self_ty`/`def_id` would clash); manual TypeFoldable = `try_fold_with_Unnormalized` / `fold_with_Unnormalized`.
  7. Upcasts: `x.upcast(cx)` is a direct call of the target's `upcast_from_*`; `RegionConstraint.from_OutlivesClause` / `from_RegionEqPredicate`, `TraitClause.upcast_from_TraitRef`, `PolyTraitClause.upcast_from_PolyTraitRef`.
  8. `as_interner(tcx)` cast: `TyCtxt` does not yet satisfy `Interner` in TS (14 placeholders, some queries typed `unknown`); `TraitRef.identity`, `PolyExistentialPredicate.with_self_ty` and the `to_host_effect_clause` pair cast. Drop when TyCtxt implements Interner.
  9. `impl Iterator` results are arrays; `debug_assert!` in `ExistentialProjection.with_self_ty` kept as a comment; `[..n]`/`[1..]` use `slice_to`/`slice_from` (rustc's panic messages); `I::*Id` conversions are the identity.
- For root: `pattern.ts` has no `debug_PatternKind` (the real one is in ir_print.ts; re-export if needed). ty_kind.ts's `Unnormalized_new` stand-in -> `Unnormalized.new_wip` / `Unnormalized.dummy`; its `.value` reads -> `Unnormalized.skip_normalization` / `skip_norm_wip` per upstream site. Loading `predicate.gen.ts` itself as an entry point fails (TDZ; same as the ty_kind.gen.ts precedent; nothing imports it directly).
- Probe: `/tmp/tyir-misc-predicate/main.rs` (+ `out.txt`, needs `empty.rs`): builds with the real TyCtxt `RegionVid(5)` / `'static`, `ConstVid(3)` / `Fresh(2)`, `TraitRef <u8 as Sized>` (via `sized_trait`), `Unnormalized<u32>`; prints polarities, constness, Clause/PredicateKind variants, TraitClause, HostEffectClause, Unnormalized, RegionConstraint with `{:?}`, `{:#?}`, `{}`.

### sub-lane infer: infer_ctxt.rs, canonical.rs, fast_reject.rs
- Edited `infer_ctxt.ts`, `canonical.ts`, `fast_reject.ts`; new test `tyir_misc_infer.test.ts` (13 tests). Commits fd5e2d4, 842a45e, a969f99, 36f849d, 6c7d100.
- Coverage, no skips: infer_ctxt.rs 82/82, canonical.rs 11/11, fast_reject.rs 12/12. No Decodable impls in these files (derives only, codegen).
- Tests (oracle strings verbatim from the probe): `TypingMode` `{:?}`/`{:#?}` (Coherence, Reflection, PostAnalysis, Codegen, ErasedNotCoherence(MayBeErased)) and `TypingModeEqWrapper` Debug; `is_coherence`/`is_reflection`/`is_erased_not_coherence`, the 6x6 `TypingModeEqWrapper_eq` matrix, hash agrees with eq; `assert_not_erased` (incl. ICE text), `from_` round-trip, borrowck/post_borrowck/typeck_for_body/analysis_in_body fallbacks (mock cx); `CanonicalVarKind` Debug (5 non-placeholder variants), `universe`, `with_updated_universe`, `is_existential`, `is_region`, `expect_placeholder_index` + panics; `Canonical` Display, `unchecked_map`; `CanonicalVarValues::instantiate` (<=4 and cold path); `CanonicalizerState::clear`; `simplify_type` for 20 types under both `TreatParams`; `DeepRejectCtxt::types_may_unify` for 21 pairs in the three modes at depths 0/1/2, `args_may_unify`, Alias under AsRigid stops UNPORTED. Mocks `RawList.prototype.inputs` with upstream's one-liner (ty-sty stub), as tyir_kind.test.ts does.
- `unported(...)` stand-ins (module-local, `// PORT: stand-in`):
  - infer_ctxt.ts: `TypeVisitableExt_has_infer`, `Ty_has_infer`, `Clauses_has_infer` (visit.rs, tyir-binder); `Ty_super_fold_with`, `Clauses_super_fold_with` (rustc_middle structural_impls); `ParamEnv_caller_bounds` (ParamEnv pending); `Features_feature_bound_holds_in_crate` (context.rs, ty-ctxt). So `deeply_resolve_via_unification_table` and `may_use_unstable_feature` stop UNPORTED; `fold_const` calls the existing `fold_Const` descriptor.
  - fast_reject.ts: `AdtDef_def_id` (ty-adt-assoc), `Ty_has_non_region_infer` and `Binder_no_bound_vars_unwrap` (tyir-binder), `Value_valtree` (rustc_middle valtree).
  - canonical.ts (upstream-body one-liners, not `unported`): `PlaceholderRegion`/`PlaceholderType`/`PlaceholderConst` `universe`/`var`/`with_updated_universe`, `BoundRegion_var` (binder.rs, tyir-binder).
  - Type stand-in: `PredicateEmittingRelation` = `Pending<..>` (relate/combine.rs, tyir-relate).
- PORT decisions:
  1. `Self::Interner` is `TyCtxt` (`cx(): TyCtxt`, as `TypeFolder::cx`); `TypingMode` constructors, `simplify_type`, `DeepRejectCtxt`, `CanonicalVarValues` take `cx: Interner` (trait methods only).
  2. `InferCtxtLike` is an interface with a marker per required member; provided (`next_trait_solver`, `deeply_resolve_via_unification_table`) in `InferCtxtLike_provided`; generic `T: TypeFoldable` methods take the D4 descriptor last.
  3. Assoc type `OpaqueTypeStorageEntries` typed by inherent.ts's interface (`InferCtxtLike_OpaqueTypeStorageEntries`).
  4. `std::range::RangeInclusive<T>` is the exported interface `{ start, last }`.
  5. `MayBeErased` is a frozen `{}` constant; `TypingModeErasedStatus` / `Sealed` are erased marker traits.
  6. `impl From<TypingMode<CantBeErased>>` is `TypingMode.from_TypingMode`; unreachable `ErasedNotCoherence` arms in `from_` / `may_use_unstable_feature` return `value._0` (type `never`).
  7. `TypingModeEqWrapper.hash` uses a hand-written `hash_TypingMode` (the `derive_where(Hash)` spelled out like `hash_FileName`: discriminant via `write_isize`, `LocalDefIds` via `write_usize(list.id)`); manual `PartialEq` is `TypingModeEqWrapper_eq`.
  8. `non_body_analysis` uses `RawList.empty()` (`Default` for `&List`).
  9. `display_Canonical(self, display_V)` formats inner values with fresh options (oracle: `{:#}` prints like `{}`).
  10. `DeepRejectCtxt` is a class whose two const generics are readonly fields, `static STARTING_DEPTH = 8`; its derived Debug is not ported (nothing prints it).
  11. Derived `PartialEq` on non-interned values (ParamTy, Placeholder*, AliasTyKind, FnHeader, ParamConst) is `eq_by_value` (`intern_key`); interned `===`; `DefId_eq`; local helper for `Option<DefId>`.
  12. `CanonicalParamEnvCache` is a class (`_0: KeyedMap<ParamEnv, _>(intern_key)`, `default_()`); `CanonicalizerState` a class with `default_()` and `clear()`.
  13. `inherent::Ty` provided methods called as `Ty_provided.is_known_rigid / is_integral / is_floating_point`.
- For root: `rustc_type_ir/decls.ts:94` `CanonicalParamEnvCache = Pending<..>` -> re-export the class from canonical.ts. Generated `debug_TypingMode` prints Typeck / PostTypeckUntilBorrowck / PostBorrowck through `unported_debug`, and generated `debug_Canonical`'s `var_kinds` likewise: the codegen typemap needs Debug for `I::LocalDefIds` (RawList of `debug_LocalDefId`) and `I::CanonicalVarKinds` (RawList of `debug_CanonicalVarKind`); oracle text `Typeck { defining_opaque_types_and_generators: [] }`. Until ty-ctxt lands, `simplify_type`'s AsRigid Alias path would reach `cx.next_trait_solver_globally()` (today the `has_non_region_infer` stand-in stops first).
- Probe: `/tmp/tyir-misc-infer/main.rs` (+ `out.txt`, 122 lines; needs `empty.rs`): builds `ir::TypingMode` values (incl. `non_body_analysis()`), `TypingModeEqWrapper`, every `CanonicalVarKind` (placeholders via `new_anon`), `ir::Canonical<TyCtxt, u32 / &str>` Display, `simplify_type` for 20 types, `DeepRejectCtxt` queries.

### sub-lane region-constraint: region_constraint.rs
- `src/rustc_type_ir/region_constraint.ts` (full port), test `src/rustc_type_ir/tyir_misc_region_constraint.test.ts` (16 tests). Commits 08a4e71, a492aa3.
- Coverage: region_constraint.rs 64/64, no skips. The `#[cfg(not(feature = "nightly"))]` items (lines 20-49, rust-analyzer only) are ported as `TransitiveRelation_not_nightly` / `TransitiveRelationBuilder_not_nightly`.
- Tests (oracle strings from a rustc-dev probe): Debug of `LeafRegionConstraint` (`{:?}`/`{:#?}`, with/without span) and `Assumptions`; `And::new` (drops reflexive/duplicate leaves), `Or::new` canonical form, `Or`/`RegionConstraint` combinators (`build_and`/`build_or`/`new_ambig`/`is_true`/`is_false`/`is_ambig`/`new_from_or`/`splatted_and_constraints`/`with_spans`/`without_spans`/`span`); `regions_outlived_by`/`regions_outliving` on a plain graph and a cycle; the only upstream test `canonicalization_preserves_only_one_ambiguity` (rustc_infer solver_region_constraints/tests.rs). Non-oracle: `eagerly_handle_placeholders_in_universe` panics for the root universe; `Assumptions::empty` stops UNPORTED; `PlaceholderReplacer` numbering/reuse/`fold_binder` shifting. Graph tests use a test-local relation with transitive_relation's rules; inverse relations built in the edge order the oracle showed.
- `unported(...)` (module-local stand-ins at the end of the file):
  - rustc_data_structures `transitive_relation.rs` (no lane owns it): `TransitiveRelationBuilder::{default, add, freeze, clone}`; so `Assumptions::empty/new/new_unelaborated` and `compute_new_region_constraints` stop UNPORTED. `reachable_from`/`base_edges` go through a typed view of the pending relation object.
  - tyir-relate: `elaborate`, `relate_args_invariantly`, `structurally_relate_tys`, `structurally_relate_consts`.
  - tyir-binder: `Binder::no_bound_vars`, `TypeVisitableExt::has_escaping_bound_vars`, `set_aliases_to_non_rigid`.
  - Stand-ins running the upstream body: `Binder::bound_vars` (field read), `Binder::bind_with_vars`, `Binder_super_fold_with` (tyir-binder); the `TypeRelation`/`Relate` interfaces with provided `relate` and `impl Relate for Ty` (`relation.tys(a, b)`) (tyir-relate). Reuses ty_kind.ts's `Binder_map_bound` / `Binder_skip_binder` stand-ins.
- PORT decisions:
  1. Methods on companions `Assumptions`, `LeafRegionConstraint`, `Or`, `And`, `RegionConstraint` (`self` first); `S = ()` is `null`.
  2. `LeafRegionConstraint::is_ambig` (:542) sits in the companion out of file order (PORTING §8), marker keeps the line.
  3. Derived `PartialEq`/`Hash` of leaves (`without_span()` comparisons, `And::new`'s `IndexSet`) compared with `intern_key`.
  4. Fns returning iterators upstream return arrays (side-effect-free adapters; same items, same order).
  5. `#[instrument]` / `debug!` kept as comments.
  6. `assert!(cond, fmt, ..)` in `rewrite_type_outlives_…` is `if (!cond) panic(fmt)`.
  7. `PlaceholderReplacer.cx` field is `cx_` (the `TypeFolder::cx()` method needs the name); its `IndexMap<BoundVar, BoundRegion>` is an insertion-ordered `Map`; `mem::take` is swap-and-replace.
  8. Local D4 descriptors for `Ty`, `Clause`, `LeafRegionConstraint<()>`, `RegionConstraint<()>`, `(AliasTy, Region)`, `Binder<(AliasTy, Region)>`, `OutlivesClause<Ty>` built from the generated `*_with_*` fns.
  9. **D6, for root**: `TransitiveRelation::base_edges` iterates `edges: FxHashSet<Edge>` in hashbrown order; `Assumptions::new`/`new_unelaborated` copy relations through it, so the element order of `inverse_region_outlives` (and of `regions_outliving`) depends on hash order. The oracle shows base edges visited in reverse insertion order for the 4-edge graph. Whoever ports `transitive_relation.rs` must reproduce that order.
- Probe: `/tmp/tyir-misc-region-constraint/main.rs` (+ `out.txt`, needs `empty.rs`): `after_expansion` callback; regions `Region::new_var(tcx, RegionVid::from_u32(1..4))`, `re_static`/`re_erased`; builds leaves (unit and `Span` spans), `And`/`Or`/`RegionConstraint` via the real combinators, `Assumptions::empty()`, prints `{:?}`/`{:#?}` and the `is_*` predicates; runs the upstream ambiguity test and the graph queries on `Assumptions::new_unelaborated(vec![], TransitiveRelationBuilder{..}.freeze())`.

#### lane agent PORT decisions (interner.rs, inherent.rs)
1. Inherent traits (D3): one TS interface per trait describing the rustc_middle impl (prototype methods for class
   `Self`s, `self`-first companion fns for value `Self`s); associated fns in a separate `<Trait>_static` interface;
   provided methods in `<Trait>_provided` (no rustc_middle impl overrides a provided method, so generic code calls
   `<Trait>_provided.<m>`). `inherent::Ty::new_param` is `ir_new_param` (ty-contract decision 5).
2. `SliceLike`: every implementor is a `readonly T[]`, so `as_slice` is the identity; provided methods take the
   array; `contains` takes an optional `eq` (default `===`) for items with structural `PartialEq`; the three impls are
   `SliceLike_for_slice`, `SliceLike_for_array`, `SliceLike_for_ref(d_S)`.
3. `SpecificDefId` is a type alias of `DefId` (every specific id is `DefId`; conversions are the identity).
4. `impl search_graph::Cx for I` is the object `Cx_for_Interner` (fns over `self: Interner`) in interner.ts.
5. `Option::expect(msg)` is `unwrap(v, msg)` (same panic text, including upstream's "expected a const" in
   `GenericArg::expect_region`).
6. The test mocks `Clause::kind` (rustc_middle predicate.rs:173, lane ty-args, still a stub) with upstream's body.
