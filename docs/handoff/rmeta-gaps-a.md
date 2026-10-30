# Handoff: lane rmeta-gaps-a (wave 33 follow-up)

Branch `lane/rmeta-gaps-a`, made from main `214d7137`, then `git merge integ-w33` (merge commit `8f1e2eb8`): the lane
builds on the full encoder. Scope: the NativeLib codec, the missing Encodable impls behind check-ui's stops, and the
`NativeLibKind` stand-in.

## Results (`RUST_TS_AGENT=root-f5de`)

"Before" for check-ui is root's run `20261030-203722-root-f5de-92kn`. The other "before" runs used a temporary worktree
at `8f1e2eb8`, which I removed afterwards.

| suite | before | after |
|---|---|---|
| `check-ui` (all 730) | 8 MATCH, 722 UNPORTED | **694 MATCH**, 36 UNPORTED (run 20261030-205448-root-f5de-ploy) |
| `rmeta-ui --sample 100` | 1 MATCH, 99 UNPORTED (run 20261030-205907-root-f5de-9ifk) | **96 MATCH**, 4 UNPORTED (run 20261030-205821-root-f5de-gf2k) |
| `mir --sample 300` | 297 MATCH, 1 UNPORTED, 2 UNSTABLE (run 20261030-210359-root-f5de-1j8m) | same (run 20261030-205953-root-f5de-4yv3) |
| `tydump-ui --sample 300` | 298 MATCH, 2 UNSTABLE, 15 skipped (run 20261030-210555-root-f5de-x9gj) | same (run 20261030-210202-root-f5de-r88a) |

**New top stops.** There is only one: all 36 check-ui and all 4 rmeta-ui non-MATCH cases are
`std::collections::HashMap Encodable iteration order (hashbrown + FxHasher; not an FxHashMap)`. One case was traced
(tests/ui/allocator/auxiliary/custom.rs): the stop is `encode_def_ids` (encoder.ts:1131),
`associated_types_for_impl_traits_in_trait_or_impl`'s `DefIdMap<Vec<DefId>>` (`encode_DefIdMap_Vec_DefId`). That is the
item encoder-c's handoff raised for root ("Hash maps in encode_def_ids"). It needs the `DefIdMap` built as an
`FxHashMap` with upstream's construction history. I did not change it (not this lane).

## The old stops and what fixed them

- **675: "Decodable for rustc_crate_store::NativeLib"** and **7: "Encodable for rustc_crate_store::NativeLib"**. Fixed by
  codegen:
  - `tools/codegen/types.sets.json`, set `rustc_crate_store`: `decodable_types` gains `NativeLib`, `DllImport`,
    `DllImportSymbolType`, `DllCallingConvention` and `ForeignModule`.
  - `typemap.hir.json`: the `unknown` placeholders for `rustc_attr_ir::CfgEntry`, `rustc_attr_ir::PeImportNameType` and
    `rustc_abi::Size` become the real types. `NativeLib.cfg`, `DllImport.import_name_type` and `DllImport.size` are now
    typed, and their Debug works.
  - `serialize.json`:
    - `CfgEntry` gains the `rustc_attr_ir::` paths;
    - new entries for `PeImportNameType`, `ExternAbi` and the five rustc_crate_store types.
  - Set `rustc_abi` gains `extern_abi.rs`, with `ExternAbi` in `decodable_types`. The derive is generated into
    rustc_abi/decodable.gen.ts and checked against the hand TS shape (unit singletons on the companion).
- **4: "Encodable without a TS impl"**. These were `ty::ExprKind`'s operands, reached through `encode_ty_Const` →
  `ConstKind::Expr`:
  - `mir::BinOp`, `mir::UnOp`, `ty::abstract_const::CastKind`, in the four `generic_const_exprs` aux crates;
  - the decode side had the same gap.

  Fix:
  - `abstract_const::CastKind` is added to set `rustc_middle`'s `decodable_types`;
  - serialize.json gets entries for all three;
  - **PORT (init order):** importing mir/mod.ts or rustc_middle/decodable.gen.ts from ty/consts/kind.gen.ts made ESM
    load mir/ before `TyCtxt` existed (every compile ICEd with "Cannot access 'TyCtxt' before initialization"). So the
    entries name lazy wrappers added to `src/rustc_middle/ty/codec.ts`, next to its existing `mir_mod_()` lazy requires:
    `decode_mir_BinOp` / `encode_mir_BinOp`, `decode_mir_UnOp` / `encode_mir_UnOp` and
    `decode_abstract_const_CastKind` / `encode_abstract_const_CastKind`.

## Files touched

- **Codegen config:** `tools/codegen/types.sets.json`, `typemap.hir.json`, `serialize.json`.
- **Codegen test:** `tools/codegen/type_fold.test.ts`. Its pinned `missing_decodable` list for set rustc_ty loses
  `mir::BinOp`, `mir::UnOp` and `abstract_const::CastKind` (−3, the intended effect).
- **Regenerated:**
  - `src/rustc_crate_store/cstore.gen.ts`;
  - `src/rustc_abi/decodable.gen.ts`;
  - `src/rustc_middle/decodable.gen.ts`;
  - `src/rustc_middle/ty/consts/kind.gen.ts`;
  - `src/rustc_metadata/decodable.gen.ts`: `CrateRoot`'s `native_libraries` / `foreign_modules` element codecs.
- `src/rustc_metadata/rmeta/decoder.ts`: the unported `decode_NativeLib` / `decode_ForeignModule` stubs are replaced by
  the generated ones (imported from rustc_crate_store).
- `src/rustc_metadata/rmeta/encoder.ts`: the hand-written `encode_NativeLib` (an unported stub), `encode_ForeignModule`,
  `encode_ExternAbi` and `EXTERN_ABI_VARIANTS` are gone; it uses the generated encoders.
  - **Behaviour is identical.** The generated variant order equals the old table, and the new test pins every
    variant's tag against the old list.
  - `encode_DocLinkResMap` **stays hand-written**. `DocLinkResMap` is a type alias of `FxIndexMap` with a TS-specific
    representation (string key, `[key, value]` entries), so there is no derive for codegen to generate.
- `src/rustc_middle/ty/codec.ts`: the lazy wrappers above.
- `src/rustc_session/utils.ts`: the opaque `NativeLibKind` stand-in is removed. `NativeLib.kind` is the real
  `rustc_structures::NativeLibKind`, and `has_modifiers` is ported as upstream (`|| self.kind.has_modifiers()`).
- `src/rustc_session/config.ts`: `hash_NativeLib` no longer stops. The new `hash_NativeLibKind` is `derive(Hash)`: the
  discriminant as `isize` in declaration order, then the fields.
- `src/rustc_metadata/native_libs.ts`: drops its `session_lib_kind` cast (now just `.kind`) and the header note.
- New test: `src/rustc_metadata/rmeta/rmeta_gaps_a.test.ts`. It round-trips through the port's encoder and decoder:
  - a no_core lib with four `#[link]` blocks: default, `static` + modifiers, `dylib` + `cfg(...)`, and `+verbatim`
    with `C-unwind`;
  - `encode_native_libraries` / `encode_foreign_modules` decoded back with the generated decoders, equal to
    `tcx.native_libraries` / `tcx.foreign_modules`;
  - all 40 `ExternAbi::ALL_VARIANTS`, with each tag checked against upstream declaration order;
  - `ExprKind` of each operand kind, with bytes checked against upstream order.

## Verification

- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (23,153; vendor 4,680). TOTAL 22,574 / 25,518.
  - The derives are `rustc-derive:` markers and the codec.ts wrappers are not markers.
  - `--missing`: cstore.rs 16/16, extern_abi.rs 16/16, utils.rs 8/8, encoder.rs 95/95, decoder.rs 156/156, codec.rs
    50/50.
- `bun test`, all with 0 fail:

  | directory | pass |
  |---|---|
  | src/rustc_metadata | 128 |
  | src/rustc_session | 83 |
  | src/rustc_abi | 27 |
  | src/rustc_structures | 4 |
  | src/rustc_middle | 356 |
  | tools/codegen | 53 |

  src/rustc_crate_store has no tests.
- **Codegen regeneration is consistent.** I regenerated every set in types.sets.json twice and got the same tree. The
  diff is only the files listed above.
  - One exception: set `rustc_lexer` writes `src/rustc_lexer/lib.gen.ts`, which is untracked on main as well (a
    fixture set for tools/codegen/rustc_lexer.test.ts). I deleted it again, so don't regenerate that set into src/.

## `unported(...)` left / for root

- **No new `unported`.** This lane removed these stops: the `NativeLib` decode and encode stubs, the `ForeignModule`
  decode stub, `Hash for NativeLibKind`, and `NativeLibKind::has_modifiers`.
- **`decode_DocLinkResMap` (decoder.ts) is still unported.** It is reached only by rustdoc's
  `get_doc_link_resolutions`. Its message ("derive(Decodable) of Res / Namespace not generated") is stale: `decode_Res`
  and `decode_Namespace` exist in rustc_hir/def.gen.ts. Porting it means `decode_IndexMap` into the `DocLinkResMap_key`
  map, a small follow-up.
- **`rustc_session/config/native_libs.ts` `parse_native_lib` (`-l`) is still unported.** Its reason names
  `rustc_structures::NativeLibKind`, which is now available, so `-l` parsing could be ported next (not this lane's file).
- **The only remaining check-ui / rmeta-ui stop is the `DefIdMap` hash-map one** (see Results). Root's open decision is
  from encoder-c's handoff.
- **Root may want to record a decision:** generated derives whose field codecs live in modules that load mir/ (or other
  heavy cycles) go through lazy wrappers in ty/codec.ts, named by serialize.json.
