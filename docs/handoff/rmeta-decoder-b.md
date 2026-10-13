# Handoff: rmeta-decoder-b (wave 11b): rustc_metadata decoder.rs 1343..end + `CrateMetadata::new`

Branch `lane/rmeta-decoder-b`, based on 8005559 (rmeta-contract merged). No merges.

## Result
The -b region of `src/rustc_metadata/rmeta/decoder.ts` is filled: decoder.rs:1343 `get_mod_child` ..
:1962 `get_doc_link_traits_in_scope` (35 fns + the nested `filter` :1737) and `CrateMetadata::new` (:1977), in
upstream order with markers. The region's `unported_methods(..)` list is gone.

**Every blob-level answer matches the oracle** on core, alloc and compiler_builtins (101,873 DefIndexes): `def_key`,
`def_path`, `def_path_hash`, `is_item_mir_available`, `get_attr_flags` and `num_def_ids`.

Crate loads now get through `CrateMetadata::new`'s `trait_impls` and `AllocDecodingState` steps. They stop at its
`def_path_hash_map` decode, in vendor odht (`odht::HashTable::from_raw_bytes`).

**expanded-nocore `--sample 300` (`RUST_TS_AGENT=rmeta-decoder-b`, run 20261013-190421-rmeta-decoder-b-w30h):**
281 MATCH, 0 DIFF, 19 UNPORTED (3 skipped). All 19 UNPORTED stop at `odht::HashTable::from_raw_bytes (vendor odht
0.3.1 not ported)`; before this lane they stopped at `CrateMetadata::new`.

`--suite parse --sample 200`: 200/200 MATCH (run 20261013-190409-rmeta-decoder-b-i2mt).

## Files
- **Port:** `src/rustc_metadata/rmeta/decoder.ts`, only inside the `-b` region, the `static new` in the class
  body, and an import block marked `// rmeta-decoder-b imports` .. `// end rmeta-decoder-b imports`.
- **New probe:** `tools/probes/rmetadecode/{Cargo.toml.in,main.rs}` (rustc-dev). It runs the oracle compiler
  (`rustc_driver::compiler_entrypoint`) on `#![no_std] extern crate alloc;` for x86_64-unknown-linux-gnu and stops
  after expansion. For every crate it then prints, through the queries cstore_impl answers from `CrateMetadata`:
  - crate name, cnum, hash, `crate_dep_kind` and `num_extern_def_ids`;
  - per DefIndex: `def_key`, `def_path_hash`, `def_path`, `is_mir_available` and `is_doc_hidden`;
  - the root's `module_children`;
  - `defined_lang_items`, `missing_lang_items`, `diagnostic_items` and the `traits` count.

  Build it with `bun scripts/probes.ts build rmetadecode` (gate hosts too).
- **New test:** `src/rustc_metadata/rmeta/decoder_b.oracle.test.ts`.
  - It compares the def lines of all 3 crates byte for byte. Negative control: taking the wrong `Fingerprint` half in
    `def_path_hash` fails it on 82,294 lines.
  - It also has PENDING cases with exact stop texts (below).
  - The `CrateMetadata` is built with the class constructor, because `new` cannot finish yet. The placeholders are
    fields no compared method reads.
- **Outside the lane (needed; please review):**
  - `tools/codegen/types.sets.json`: the `rustc_hir` set opts in `derive_decodable` for `DefKey`,
    `DisambiguatedDefPathData` and `DefPathData` (`decodable_types`, plus a hand_note). These are needed by
    `CrateMetadata::def_key`, and -a's `print_item` (-Zls=items) needs them too.
  - `src/rustc_hir_id/definitions.gen.ts` was regenerated with `bun tools/codegen/types.ts rustc_hir`. It adds
    `decode_DefKey`, `decode_DisambiguatedDefPathData` and `decode_DefPathData`; nothing else changed. tools/codegen
    tests: 42/42.
  - PENDING texts advanced, because the stop moved from `CrateMetadata::new` to odht:
    - `src/rustc_metadata/creader.oracle.test.ts` (`odht::HashTable::from_raw_bytes`).
    - `src/rustc_metadata/locator.oracle.test.ts` (`RMETA_DECODER`).
  - `src/rustc_metadata/rmeta/contract.test.ts`: the "stubs stop as UNPORTED" case probed `get_mod_child`, which is now
    ported. It now probes `get_associated_item` (an M3 stop).

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_metadata/src/rmeta/decoder.rs`: 123/156. **Nothing at or after
:1343 is missing.** The 33 that are left all belong to rmeta-decoder-a (:297 .. :1332). `coverage --check`: markers ok
(7838; vendor 3502).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3730 pass, 1 skip (the existing linux-only one), 0 fail.
- `bun scripts/coverage.ts --check`: ok.
- `--suite parse --sample 200`: 200/200 MATCH.

## PENDING (decoder_b.oracle.test.ts; exact texts)
| case | stop |
|---|---|
| `CrateMetadata::new` (dependencies / crate_dep_kind through creader) | `odht::HashTable::from_raw_bytes (vendor odht 0.3.1 not ported)` |
| `get_module_children(CRATE_DEF_INDEX)`, `get_missing_lang_items`, `get_traits` | `rustc_metadata::rmeta::decoder::MetaDecoder::decoder for (&CrateMetadata, TyCtxt) (AllocDecodingState::new_decoding_session)` (-a) |
| `get_lang_items`, `get_diagnostic_items` (-a's methods; the brief listed them, but they sit before the :1343 split) | `rustc_metadata::rmeta::decoder::CrateMetadata::get_lang_items` / `::get_diagnostic_items` |

After odht lands, `new` will stop next at `incoherent_impls.decode((&cdata, tcx))`, i.e. -a's `MetaDecoder::decoder`.
After that it stops at `Decodable for SimplifiedType` (M3), if the crate has incoherent impls. core, alloc and std do.
When a stop moves, update the table in the test. The probe already prints each section's oracle lines for when the
stops go away.

## `unported(...)` left (all in the -b region)
Element `Decodable` impls with no TS port yet. Each is a local `decode_<T>` that stops as UNPORTED, and each becomes an
import once its crate generates it:
- `Decodable for rustc_middle::metadata::ModChild` / `AmbigModChild` (derive(Decodable) not generated):
  `get_module_children` reexports, `get_ambig_module_children`.
- `Decodable for rustc_metadata::rmeta::VariantData (ty::VariantDiscr, M3)`: `get_ctor`.
- `Decodable for rustc_attr_ir::Attribute`: `get_item_attrs`.
- `Decodable for rustc_middle::ty::fast_reject::SimplifiedType (M3)`: `new` (incoherent impls),
  `get_trait_impls`, `get_implementations_of_trait`.
- `Decodable for rustc_crate_store::NativeLib` / `ForeignModule`: `get_native_libraries` and `get_foreign_modules`. The
  rustc_crate_store set's `decodable_types` would have to opt them in, but NativeLib needs `Option<MetaItemInner>` /
  `DllImport`.
- `Decodable for rustc_metadata::rmeta::EiiMapEncodedKeyValue`: `get_externally_implementable_items`.
- `Decodable for rustc_attr_ir::lang_items::LangItem (derive(BlobDecodable) not generated)`:
  `get_missing_lang_items`.
- `Decodable for (ExportedSymbol, SymbolExportInfo) (M3)`: `exported_non_generic_symbols` and
  `exported_generic_symbols`.
- `Decodable for rustc_ast::ast::DelimArgs`: `get_macro`.
- `Decodable for rustc_middle::ty::IntrinsicDef (M3)`: `get_intrinsic`.
- `Decodable for rustc_hir::def::DocLinkResMap`: `get_doc_link_resolutions`.
- `rustc_metadata::rmeta::decoder::CrateMetadata::get_associated_item (ty::AssocItem / AssocKind / AssocContainer,
  M3)`: the whole body. Its result types are rustc_middle ty (M3), so it is an unported body under its marker.

## PORT decisions (please record)
1. **`AllocDecodingState` stand-in.** `rustc_middle::mir::interpret` is not ported (M3), so
   `AllocDecodingStateStandIn { decoding_state, data_offsets }` and `AllocDecodingState_new` live in the -b region.
   They follow upstream's `AllocDecodingState::new` (mir/interpret/mod.rs:162), have no marker, and are typed into the
   contract's `AllocDecodingState = unknown` field. -a's `MetaDecoder::decoder` needs `new_decoding_session` on it.
   Move both into rustc_middle when mir/interpret is ported.
2. **`CFG_VIRTUAL_RUST_SOURCE_BASE_DIR` / `CFG_VIRTUAL_RUSTC_DEV_SOURCE_BASE_DIR`** (`option_env!` in
   `imported_source_file`) are `/rustc/<pinned commit>` and `/rustc-dev/<pinned commit>`. Both were checked against
   the oracle:
   - the sysroot `core` metadata names its files `/rustc/6f5da406../library/..`;
   - librustc_driver embeds `/rustc-dev/6f5da406../compiler/..`.
3. **Iterators.** Upstream `gen move { .. }` blocks are generator functions (lazy), as the contract says:
   `get_module_children`, `get_ambig_module_children`. `get_trait_impls` is a lazy `flat_map` and is a generator too.
   Upstream fns that call `.decode(..)` eagerly and return a `.map(..)` (`get_traits`,
   `get_associated_item_or_field_def_ids`, `get_exportable_items`, `get_stable_order_of_exportable_impls`) decode
   eagerly and wrap the result with a local `iter_map`. This keeps the point where they panic or stop at upstream's.
   `tcx.arena.alloc_from_iter(..)` returns an array.
4. **`def_key`** returns `clone_DefKey(..)` of the cached key, because upstream copies it out (`*`).
   `expn_hash_map.get_or_init` is a lazily set field; `map[&hash]` panics with `no entry found for key`.
5. **`interpret_alloc_index`** is `LazyArray<u64>`, but mod.ts types its phantom element as `number`. It is cast to
   `LazyArray<bigint>` and decoded with `decode_u64`.
6. **`imported_source_file`**:
   - The upstream closures' `&mut FileName` is a `{ value }` box.
   - `Option<&Path>` is a `PathBuf | undefined`.
   - `PathBuf == Path` is `path_eq`.
   - The `ImportedSourceFile` clone is a shallow copy, so the `Arc<SourceFile>` is shared.
7. The contract's `HygieneDecodeContext = unknown` alias is still in place. `new` builds the real
   `rustc_span::hygiene::HygieneDecodeContext.default()`, which lane span-decode ported, imported as
   `HygieneDecodeContext_`. Root may drop the alias. The same goes for `SourceFile`, imported as `SourceFile_`.

## Notes for -a / odht / root
- odht: no call site in decoder.ts. `new` calls `root.def_path_hash_map.decode(blob, decode_DefPathHashMapRef)`, and the
  odht call is in `def_path_hash_map.ts` (`OdhtHashTable` stand-in). The odht lane should replace that stand-in. I did
  not add an import of `src/vendor/odht/lib.ts`, because a missing module would break tsc.
- -a: `get_mod_child` uses your `item_ident`, `def_kind` and `get_visibility`. `get_associated_item_or_field_def_ids`
  uses `missing`. `get_ctor` and `get_macro` use `def_kind`.
- If -a also opts DefKey into the `rustc_hir` codegen set, the two edits should be identical. Otherwise rerun
  `bun tools/codegen/types.ts rustc_hir` after the merge.
- Root: build `rmetadecode` on gate hosts. Delete the rmeta-decoder-b claim in `docs/claims/` on integration.
