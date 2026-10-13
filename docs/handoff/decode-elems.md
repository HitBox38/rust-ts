# Handoff: decode-elems (wave 11c): the element decoders behind `extern crate`

Branch `lane/decode-elems`, based on 9c1c7d1 (span-decode, rmeta-decoder-a/-b, cstore-impl and odht-wire merged).
There are no merges.

## Result
Crate loads now complete:
- `CrateMetadata::new` finishes for every sysroot crate;
- the incoherent impls decode, and so do the session-incompatibility checks;
- the resolver's metadata reads work: module children and reexports, attributes, lang items, stability, macro
  bodies, and `generics_of`.

No sampled case stops in metadata any more.

| suite (`RUST_TS_AGENT=decode-elems`) | before | after |
|---|---|---|
| expanded-nocore `--sample 300` | 280 MATCH, 20 UNPORTED (all `SimplifiedType`), run 20261013-194926-decode-elems-mnqh | **300/300 MATCH**, run 20261013-202925-decode-elems-cpj3 |
| expanded-nocore `--sample 1500 --seed big1` | 1477 MATCH, 23 UNPORTED (18 of them `generics_of`), measured mid-lane | 1495 MATCH, 5 UNPORTED, run 20261013-201001-decode-elems-i8bm |
| resdump-nocore `--sample 300` | (not measured before) | **300/300 MATCH**, run 20261013-201206-decode-elems-j9p1 |
| resdump-nocore `--sample 1500 --seed big1` | (not measured before) | 1495 MATCH, 5 UNPORTED, run 20261013-201256-decode-elems-l68z |
| unpretty-expanded-nocore `--sample 200` | (not measured before) | **200/200 MATCH**, run 20261013-201236-decode-elems-nslu |
| unpretty-expanded-nocore `--sample 1500 --seed big1` | (not measured before) | 1495 MATCH, 5 UNPORTED, run 20261013-202938-decode-elems-enli |
| parse `--sample 200` | | 200/200 MATCH, run 20261013-202912-decode-elems-stxe |

The 5 UNPORTED left in each large sample are outside metadata:
- 3 × `rustc_expand::proc_macro::BangProcMacro::expand (quote!; proc-macro bridge, M6)`;
- 2 × `std::panic::Location::caller (DiagLocation Display)`.

No sample shows a DIFF.

Stops, in the order they fell: `SimplifiedType`, then `ModChild`, then `Stability`, then `DeniedPartialMitigation`,
then `generics_of`.

## What was ported, and how
- **`SimplifiedType<DefId>`** (rustc_type_ir fast_reject.rs).
  - New codegen set `rustc_type_ir` generates `src/rustc_type_ir/fast_reject.gen.ts`: the type, Debug, Clone,
    Decodable_NoContext, and `TreatParams`. It also writes `src/rustc_type_ir/stable_hash.gen.ts`.
  - `DeepRejectCtxt` is skipped (M3). The set does not derive Encodable (M5).
  - Hand module `src/rustc_type_ir/fast_reject.ts`: `SimplifiedType::def`, plus `SimplifiedType_key` for `KeyedMap`.
  - New `src/rustc_middle/ty/fast_reject.ts` mirrors rustc_middle's alias at `DefId`.
  - `simplify_type` stays unported (M3).
  - `CrateMetadata.incoherent_impls` is now a `KeyedMap(SimplifiedType_key)`.
- **rustc_ast_ir `IntTy` / `UintTy` / `FloatTy` / `Mutability`.** The rustc_ast set gains `derive_stable_hash`, with
  `stable_hash_types` limited to these four, which creates the new `src/rustc_ast_ir/stable_hash.gen.ts`.
- **Whole-crate `derive_decodable`** (no `decodable_types` limit) on three sets:
  - `rustc_ast`: 212 decoders, AST and tokens included, so `DelimArgs` / `TokenStream` / `Path` decode;
  - `rustc_attr_ir`: 66 decoders, including `Attribute`, `AttributeKind`, stability, `LangItem` and `StrippedCfgItem`;
  - `rustc_structures`.
  - Missing impls I added for these:
    - `decode_LazyAttrTokenStream`: tokenstream.rs:155, upstream panics; it replaces a `rustc-skip`.
    - serialize.json entries: `Spanned`, `ErrorGuaranteed`, `LocalExpnId`, `Pu128`, `Ident`, `ModId`, `Res`,
      `Transparency`, `Align`, and each cross-set rustc_ast / rustc_structures / rustc_attr_ir type.
- **rustc_hir def.rs.** `Res`, `DefKind`, `CtorOf`, `CtorKind`, `MacroKinds`, `NonMacroAttrKind` and `Namespace` are
  opted in. The def.ts stand-ins `PrimTy` / `Safety` get hand-expanded `decode_PrimTy` / `decode_Safety`.
- **rustc_middle.**
  - `middle/resolve.rs`: `Reexport`, `ModChild`, `AmbigModChild`.
  - `ty/generics.rs`: `GenericParamDefKind`, `GenericParamDef`, `Generics`.
  - All are opted in to the derive_only set, which writes `rustc_middle/decodable.gen.ts`.
  - New `src/rustc_middle/ty/generics.ts` holds the data types, the manual Debug, and the methods that need no `Ty`.
- **`DeniedPartialMitigation{,Kind,Level}`** and **`StackProtector`**: hand-expanded `derive(BlobDecodable)`, in
  mitigation_coverage.ts and rustc_target spec/mod.ts. These types live inside `denied_partial_mitigations!` /
  `target_spec_enum!`, as with `decode_PanicStrategy`.
- **Wiring.**
  - decoder.ts: the local stubs for `ModChild`, `AmbigModChild`, `Attribute`, `LangItem`, `DelimArgs`,
    `SimplifiedType`, `DeniedPartialMitigation` and `StrippedCfgItem` are now imports.
  - cstore_impl.ts: `lookup_stability`, `lookup_const_stability`, `lookup_default_body_stability`,
    `lookup_deprecation_entry` and `generics_of` use real decoders.
  - rustc_resolve lib.ts: `item_generics_num_lifetimes` and `item_required_generic_args_suggestion` for extern items
    now go through `tcx.generics_of`.

## Files touched
- **New:**
  - `src/rustc_type_ir/{fast_reject.ts, fast_reject.gen.ts, stable_hash.gen.ts}`
  - `src/rustc_middle/ty/{fast_reject.ts, generics.ts}`
  - `src/rustc_ast_ir/stable_hash.gen.ts`
  - `tools/codegen/typemap.type_ir.json`
- **Hand edits:**
  - `src/rustc_metadata/rmeta/decoder.ts` (import block `// decode-elems imports`, stubs removed);
  - `src/rustc_metadata/rmeta/decoder/cstore_impl.ts`;
  - `src/rustc_hir/def.ts`;
  - `src/rustc_ast/tokenstream.ts`;
  - `src/rustc_session/options/mitigation_coverage.ts`;
  - `src/rustc_target/spec/mod.ts`;
  - `src/rustc_resolve/lib.ts` (call sites only, see "For root").
- **Regenerated:**
  - rustc_ast `*.gen.ts`, rustc_ast_ir `lib.gen.ts`, rustc_attr_ir `*.gen.ts`, rustc_structures `*.gen.ts`;
  - rustc_hir `def.gen.ts`;
  - `rustc_middle/decodable.gen.ts`;
  - `rustc_span/decodable.gen.ts`: only the `decode_Spanned` signature;
  - `rustc_metadata/decodable.gen.ts`: only phantom args, which now name `decode_LangItem`.

  Every set was rerun. Nothing else changed. `queries.ts --check` is up to date.
- **tools/codegen (please review):**
  - `types.sets.json`: the opt-ins above and the new `rustc_type_ir` set.
  - `serialize.json`:
    - the new entries;
    - `decoders.TyDecodable` → `SpanDecoder`. Upstream's `TyDecoder<'tcx>: SpanDecoder`. Nothing used the old
      `Decoder` entry.
  - `stable_hash.json`: the four rustc_ast_ir entries.
  - `types.ts`, three generator changes:
    1. derive(Decodable) of a `bitflags!` impl-form tuple struct (`struct MacroKinds(u8)` + `bitflags! { impl .. }`):
       it decodes the bits field into the branded number. The Debug path already handles this form.
    2. derive(Decodable) of the `language_item_table!` enum (`LangItem`). The enum is already synthesized as an item.
    3. Decoders of generic types are generic over the decoder:
       `decode_X<T, __D extends DT = DT>(__decoder: __D, decode_T: Decodable<T, __D>)`, as in
       `impl<D: SpanDecoder, T: Decodable<D>>`. This is needed for `Visibility<ModId>` (BlobDecodable) inside
       `ModChild` (SpanDecoder).
  - Tests: `serialize.test.ts` golden updated for change 3. `macros.test.ts` rustc_ast file count goes from 22 to 23
    (`rustc_ast_ir/stable_hash.gen.ts`).
- **Oracle tests advanced** (no matching case weakened; stricter where the stop went away):
  - `creader.oracle.test.ts`. Every case completes, and its crate list now equals the oracle's full list
    (dependencies included). Three cases gained `expect` texts (E0463 / non-ASCII). `STOP` now names no stop, so an
    UNPORTED run fails.
  - `locator.oracle.test.ts`. The two real-sysroot cases were stop cases. They are now full byte-for-byte matches.
  - `decoder_b.oracle.test.ts`. PENDING is gone. `get_module_children` is now compared in full against the probe,
    reexports and foreign `DefId`s included. `get_lang_items` / `get_missing_lang_items` are compared. A new test
    checks that `CrateMetadata::new` builds every crate with the real `cnum_map` and that the incoherent impls
    decoded.
  - `cstore_impl.test.ts`. The "unported element type" probe moved from `generics_of` to `trait_def`.

## Coverage (`bun scripts/coverage.ts --missing`)
- decoder.rs 156/156; cstore_impl.rs 37/37.
- tokenstream.rs 64/64. The decode `rustc-skip` became a port.
- mitigation_coverage.rs 13/13; rustc_resolve lib.rs 170/170.
- rustc_type_ir fast_reject.rs 1/12: only `def`. `simplify_type`, `DeepRejectCtxt`, … are M3.
- rustc_middle ty/generics.rs 17/45. The rest needs `Ty` / `GenericArg` / clauses (M3).
- `coverage --check`: markers ok (7908; vendor 3664).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3887 pass, 1 skip (the existing linux-only one), and
  2 fail. Both failures are the generator goldens above, now fixed: `tools/codegen` 42/42 and `src/rustc_metadata`
  95/95 on rerun.
- Fresh-process loads work for every new or touched module, including `rustc_middle/decodable.gen.ts` and
  `rustc_metadata/decodable.gen.ts`. Cross-set decoders are imported through the hand modules (`rustc_hir/def.ts`,
  `rustc_ast_ir/lib.ts`). Importing `def.gen.ts` directly broke the def.ts ↔ def.gen.ts cycle when it was entered
  first.

## `unported(...)` left (on this path; none reached by any sample)
- **decoder.ts:**
  - `Decodable for rustc_session::config::TargetModifier`: inside the options macro; `OptionsTargetModifiers` would
    need tools/codegen/options.ts.
  - `rustc_middle::ty::RestrictionKind (M3)`.
  - `rustc_span::DebuggerVisualizerFile`.
  - `rustc_middle::middle::lib_features::FeatureStability`.
  - `rustc_metadata::rmeta::VariantData (ty::VariantDiscr, M3)`.
  - `rustc_crate_store::NativeLib` / `ForeignModule`. They can now be opted in to the rustc_crate_store set: the
    `rustc_attr_ir` / `rustc_ast` element types decode.
  - `EiiMapEncodedKeyValue`: `EiiDecl` / `EiiImpl` are generated now, so it is a tuple of them.
  - `(ExportedSymbol, SymbolExportInfo) (M3)`.
  - `ty::IntrinsicDef (M3)`.
  - `DocLinkResMap`: needs a `KeyedMap` of `(Symbol, Namespace)`. `Res` and `Namespace` decode now.
  - `-Zls=lang_items` / `features` / `target_modifiers` in `list_crate_metadata`. `lang_items` is now a small port,
    since `LangItem` decodes.
- **cstore_impl.ts:** every other `decode_unported(..)` table element type is M3: `Ty`, clauses, MIR, `TraitDef`, …
- **Generated code:** only the pre-existing phantom `unported_decodable` arguments in `rustc_metadata/decodable.gen.ts`.

## PORT decisions (please record)
1. **`SimplifiedType` map keys.** `SimplifiedType` keys a `KeyedMap` by `SimplifiedType_key` (variant + field, the
   `DefId` by `DefId_hash_key`). The same applies to `Generics.param_def_id_to_index` (`DefId_hash_key`), which is
   built by `Generics.from_decoded` through `decodable_construct`.
2. **`TyDecodable` derives decode with `SpanDecoder`.** `TyDecoder`, which adds `Ty` shorthands and alloc ids, is M3.
3. **Generated generic decoders are generic over the decoder** (`__D extends <derive's decoder>`).
4. **Hand-expanded derives** where codegen cannot see the type:
   - `decode_PrimTy` / `decode_Safety` for the def.ts stand-ins;
   - `decode_StackProtector`, inside `target_spec_enum!`;
   - `decode_DeniedPartialMitigation{,Kind,Level}`, inside `denied_partial_mitigations!` or hand types.
5. **Encodable is not derived** for the new opt-ins (M5). The only exception is the old `encode_Spanned`.
6. **Casts where shared declarations still say `unknown`**, each with a `// PORT:` note:
   - queries.gen.ts types the `crate_incoherent_impls` key and the `generics_of` value `unknown`, so cstore_impl.ts
     and the resolver cast;
   - mod.ts types `TraitImpls::impls`' `Option<SimplifiedType>` element `unknown`, so decoder.ts casts.

## For root
- Review the three tools/codegen/types.ts changes and the serialize.json `TyDecodable` switch. Also review the
  out-of-lane hand edits:
  - rustc_resolve lib.ts: two call sites, now ported from upstream lib.rs:1743 / :1751;
  - rustc_target spec/mod.ts, rustc_session mitigation_coverage.ts, rustc_ast tokenstream.ts and rustc_hir def.ts:
    decode fns only.
- Probes used: `rmetadecode`, `rmetadefs`, `rmetaroot`. They were already scheduled; no new probe was added.
- Delete `docs/claims/` for decode-elems on integration.
