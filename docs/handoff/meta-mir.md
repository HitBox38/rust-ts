# Handoff: meta-mir (wave 26): decoding MIR bodies from crate metadata

Branch `lane/meta-mir`, base `7f2d6592` (main). No merges.

## Result
`optimized_mir`, `mir_for_ctfe`, `promoted_mir`, `trivial_const`, `mir_coroutine_witnesses` and `mir_const_qualif` now
decode from crate metadata. Before, they all went through `decode_unported`. The decoders are the generated
`derive(TyDecodable)` / `derive(Decodable_NoContext)` of the MIR set, plus the hand impls they call:
- ty/codec.rs: `Place`, `AllocId` (through the crate's `AllocDecodingSession`), `CtfeProvenance` and `ConstAllocation`;
- mir/interpret: `Allocation`, `InitMaskMaterialized` and `ProvenanceMap`;
- mir/mod.rs: `ClearCrossCrate`;
- mir/basic_blocks.rs: `Cache`.

The stop `rustc_metadata::rmeta::decoder::cstore_impl: Decodable for mir::Body<'static>` is gone.

- **symbol_names** `const-generics.rs#legacy` / `#v0`: both now run to completion and equal the oracle (check-pass,
  empty stderr, exit 0). I removed the two pins and the `STOP_EXTERN_MIR` constant, so the cases are compared against
  the oracle like every other unpinned case. `symbol_names.oracle.test.ts`: 28/28 pass.
- **borrowck-ui `--sample 300`** (`RUST_TS_AGENT=root-f5de`): 266 MATCH, against 261 on a clean checkout of the base
  (run `20261028-023154-root-f5de-xsjw`). The 5 cases that stopped at the Body decode all MATCH now:
  - `borrowck-closures-slice-patterns.rs`;
  - `borrowck-move-out-from-array-use-no-overlap-match.rs`;
  - `borrowck-move-out-from-array-use.rs`;
  - `issue-64453.rs`;
  - `suggestions/overloaded-index-without-indexmut.rs`.

  Nothing else changed against the clean base.
- **New oracle test** `src/rustc_metadata/rmeta/rmeta_mir.oracle.test.ts`. It needs the pinned rustc; without it the
  test is a visible skip, and under `RUST_TS_REQUIRE_PROBES=1` that becomes a failure.
  1. *Extern MIR against `-Zunpretty=mir`.*
     - The oracle builds an aux crate twice: once with `--emit=metadata -Zalways-encode-mir`, and once with
       `-Zunpretty=mir`. The aux crate covers arithmetic with `Assert`, loops / `match`, projections, aggregates,
       generics, consts with and without bodies, `&str` / `&[u8; N]` / promoted allocations, `core` calls, a `const fn`
       and a tuple-struct ctor.
     - The port loads the `.rmeta` and renders every aux body with `MirWriter`, following `write_mir_pretty`'s branches.
     - The two outputs are compared item by item. Result: **422 lines, identical.**
     - The only normalisation strips `mm_aux::` from the port's paths.
     - Some differences are inherent to extern vs local printing, so they stay out of the aux crate (documented in the
       test):
       - closures: `{closure@<def path>}` and positional upvar names;
       - tuple *variants*: trimmed paths shorten a foreign variant, never a local one;
       - statics: no MIR in metadata.
     - Ctors: metadata holds only `mir_for_ctfe`, so the port renders it in both halves of the `const fn` branch.
  2. *Every MIR body of `core` and `alloc` decodes.*
     - It decodes every present `optimized_mir` / `mir_for_ctfe` / `promoted_mir` / `trivial_const` entry and checks
       the result structurally.
     - core: 24466 optimized, 19994 ctfe, 29324 promoted, 1999 trivial consts. alloc: 3174 / 286 / 3304 / 32.
     - Bodies stopping at the one known stop (inline-asm operands) are counted: 38, pinned as `MAX_ASM_STOPS`. Any
       other error fails the test.
     - It runs in about 7 s.

## Files
- **tools/codegen** (please review)
  - `types.sets.json`:
    - `rustc_middle_mir`: `derive_decodable` (96 decoders).
    - `rustc_hir` `decodable_types` adds `OwnerId`, `HirId`, `ItemLocalId`, `CoroutineKind`, `CoroutineSource`,
      `CoroutineDesugaring` and `ImplicitSelfKind`.
    - `rustc_index` adds `BitMatrix` (construct `BitMatrix.from_u64_words`; `erase_params` gains `R`, `C`).
    - `rustc_middle_typeck_results` gets `derive_decodable` for `CanonicalUserTypeAnnotation`, `UserType`,
      `UserTypeKind`, `UserArgs` and `UserSelfTy`.
    - `rustc_middle_ty_instance` gets `derive_decodable` for `Instance`, `ReifyReason`, `InstanceKind` and `ShimKind`.
  - `serialize.json`: new entries.
    - Codec-backed (codec.ts): `mir::Place`, `CtfeProvenance`, `ConstAllocation`, and the `AllocId` path added to
      `I::AllocId`.
    - `rustc_middle::ty::Const` goes to codec.ts's `decode_ty_Const`. It is a separate entry from `I::Const` because
      the MIR set has its own `decode_Const`. The `rustc_middle::ty::Region` paths are added to `I::Region`.
    - RefDecodable keys: `&List<PolyExistentialPredicate>`, `&[InlineAsmTemplatePiece]` and `&[Span]` (arena.ts).
    - Re-exports of other sets' types:
      - rustc_type_ir / rustc_ty: `Variance`, `RegionVid`, `PointerCoercion`, `UserArgs`, and `Canonical` (both the
        ir path and rustc_middle's `infer::canonical::Canonical` alias);
      - rustc_ast / rustc_ast_ir / rustc_attr_ir: `BindingMode`, `InlineAsmOptions`, `InlineAsmTemplatePiece`,
        `Movability`, `UnrollAttr`.
    - Newly generated: hir `CoroutineKind`, `ImplicitSelfKind` and `HirId`; `BitMatrix`; `Instance` and
      `InstanceKind`.
    - Typeck: `CanonicalUserTypeAnnotations` (a Vec) and `UserTypeAnnotationIndex`.
    - `FieldIdx` and `Size`.
  - `type_fold.test.ts`: `rustc_abi::FieldIdx` left the rustc_ty set's pinned `missing_decodable` list.
- **Regenerated:**
  - the 18 `rustc_middle/mir/**.gen.ts`;
  - `rustc_hir/hir.gen.ts` and `rustc_hir_id/lib.gen.ts`;
  - `rustc_index/decodable.gen.ts`;
  - `rustc_middle/ty/{instance,typeck_results}.gen.ts`;
  - `rustc_middle/ty/adjustment.gen.ts` (`CustomCoerceUnsized::Struct(FieldIdx)` decodes now).

  Every other decodable set regenerates byte-identically.
- **Hand edits (my area)**
  - `rustc_middle/ty/codec.ts`:
    - `decode_Place` builds a real `mir::Place`, and its `Local` uses the generated decoder.
    - `decode_PlaceElem` is the generated `decode_ProjectionElem(d, decode_Local, decode_Ty)` (was unported).
    - New adapter `decode_ty_Const`.
    - The mir modules are read lazily.
  - `rustc_middle/mir/interpret/mod.ts`: `GlobalAlloc::Function` decodes its `Instance` (was unported).
  - `rustc_middle/mir/interpret/allocation/init_mask.ts`: the unported `decode_InitMask` stub is gone; the generated
    one is re-exported.
  - `rustc_middle/mir/interpret/allocation/provenance_map.ts`: `decode_SortedMap_Size` is implemented (was unported).
  - `rustc_metadata/rmeta/decoder/cstore_impl.ts`: the six MIR tables are wired. New helpers `decode_ConstValue_Ty`
    and `decode_IndexVec_Promoted_Body`.
  - Tests: `cstore_impl.test.ts`, whose "unported element type" probe moved from `mir_const_qualif` to
    `opaque_ty_origin`; `symbol_names.oracle.test.ts` (above); new `rmeta_mir.oracle.test.ts`.
- **Out-of-lane edit (type-only, please review):** `src/rustc_index/bit_set.ts`. `class BitMatrix<R extends number =
  number, C extends number = number>` gains defaults so that the erased generated decoder can name `BitMatrix`.

## Coverage (`bun scripts/coverage.ts --missing`)
| file | ported |
|---|---|
| ty/codec.rs | 50/50 |
| rmeta/decoder/cstore_impl.rs | 37/37 |
| mir/interpret/mod.rs | 29/29 |
| init_mask.rs | 26/26 |
| provenance_map.rs | 23/23 |

`coverage --check`: markers ok (22099; vendor 4330).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- Unit tests:
  - affected crates (`src/rustc_metadata src/rustc_middle tools/codegen src/rustc_hir src/rustc_hir_id src/rustc_index
    src/rustc_symbol_mangling`): green after the two re-pins above;
  - full `bun test --timeout=300000 src tools`: 6251 pass, 1 skip, 0 fail (6252 tests, 473 files; the base had 6199).
- Sample difftests, `RUST_TS_AGENT=root-f5de`. Compared case by case with the base runs listed in w26-common; no MATCH
  was lost in any suite.

  | suite | result | run |
  |---|---|---|
  | borrowck-ui `--sample 300` | 266 MATCH / 34 UNPORTED / 0 DIFF | `20261028-022230-root-f5de-4lv7` |
  | tydump-minicore | 46/46 | `20261028-022516-root-f5de-0t6y` |
  | mirdump-minicore | 46/46 | `20261028-022541-root-f5de-yys6` |
  | tydump-ui `--sample 300` | 295 MATCH / 3 UNPORTED / 2 UNSTABLE / 0 DIFF | `20261028-022608-root-f5de-fsxr` |
  | mirdump-ui `--sample 300` | 300/300 | `20261028-022843-root-f5de-s7he` |

  - borrowck-ui stops left: `mir_inliner_callees` 20, `polonius_engine::AllFacts::default` 12, `LowerSliceLenCalls` 1,
    `NonGenericOpaqueTypeParam` diagnostic 1. They are the same on the clean base.
  - tydump-ui non-MATCH cases (`hash_result` ×2, `IntoDiagArg` ×1, the 2 UNSTABLE) are all the same as in the base run.

## New runtime stops / `unported(...)` left
- **Inline asm**: `InlineAsmOperand::{In, Out, InOut}.reg: rustc_target::asm::InlineAsmRegOrRegClass` has no TS
  `Decodable`. It is a generated `unported_decodable` in `syntax.gen.ts`, the only `missing_decodable` of the MIR set.
  38 `core` bodies hit it. It needs `derive(Decodable)` for rustc_target asm's `InlineAsmReg` / `InlineAsmRegClass`
  per arch (rustc_target lane), plus a serialize.json entry.
- Still `decode_unported` in cstore_impl.ts (not MIR): `PreciseCapturingArgKind`, `DeducedParamAttrs`,
  `hir::OpaqueTyOrigin`.
- Never reached from metadata, because `ClearCrossCrate` decodes `Clear` for `MetadataDecodeContext`, but
  generated anyway: `LocalInfo`, `VarBindingForm`, `SourceScopeLocalData` (`HirId`), etc.
- Encoding is not generated (M5).

## PORT decisions (please record)
1. **`decode_ty_Const`.** It is codec.ts's one-argument adapter for `ty::Const`: rustc_type_ir serialize.rs:130 with
   the derived `ConstKind` decoder. It has its own serialize.json entry because the MIR set's generated `decode_Const`
   (`mir::Const`) would otherwise clash with it in consts.gen.ts / syntax.gen.ts.
2. **`BitMatrix`.**
   - The rustc_index set erases `R, C` (`erase_params`).
   - The serialize.json template is `(decode_BitMatrix($D) as never)`. The phantom `__rc` makes `BitMatrix` invariant,
     and the decoder returns `<number, number>` while the field is `<CoroutineSavedLocal, CoroutineSavedLocal>`.
   - bit_set.ts gets default type params.
3. **`SortedMap<Size, V>`.** Its `derive(Decodable_NoContext)` (sorted_map.rs:24) is hand-expanded in
   provenance_map.ts (`decode_SortedMap_Size`): no codegen set covers rustc_data_structures sorted_map.rs, and the TS
   `SortedMap` carries its comparator (`cmp_Size`).
4. **`Size`.** It decodes as `Size.from_bytes(decode_u64(d))`: `Size { raw: u64 }`, where `from_bytes` is `raw` plus
   abi-lib's 2^53 guard. The serialize.json entry is used by the generated `InitMask` too.
5. **`FieldIdx`.** Its serialize.json entry imports the value through `ty/decls.ts`, where the generated modules
   already take the type from (a direct `rustc_abi/layout.ts` import duplicated the identifier).
6. **The oracle test's extern-vs-local exclusions** (closures, tuple variants, statics; ctors rendered from
   `mir_for_ctfe`), and its use of `-Zunpretty=mir` + `trimmed_def_paths = true` on the port side:
   - `trimmed_def_paths = true` mirrors rustc_driver's `TimePassesCallbacks::config`;
   - `-Zunpretty=mir` stops `record_trimmed_def_paths` from expecting a diagnostic, as on the oracle side.

## For root / other lanes
- Review the tools/codegen changes: types.sets.json, the serialize.json entries, the `type_fold.test.ts` golden.
- Review the out-of-lane type-only edit to `rustc_index/bit_set.ts`.
- rustc_target lane: a `Decodable` for `InlineAsmRegOrRegClass` (the per-arch `InlineAsmReg` / `InlineAsmRegClass`
  derives) removes the last MIR decode stop. Then raise / remove `MAX_ASM_STOPS` in `rmeta_mir.oracle.test.ts`.
- Possible follow-up, deliberately not done here (the init-order risk of rustc_ty modules importing mir/syntax.ts):
  serialize.json entries for `rustc_middle::mir::BinOp` / `UnOp`. They are generated now, and the rustc_ty set's
  `abstract_const` `ExprKind` still lists them as missing.
