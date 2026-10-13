# Handoff: odht-wire (fixer; wire vendored odht 0.3.1 into rustc_hir_id / rustc_metadata)

Branch `integ` (root's worktree), on top of c2c64b7.

## Files
- `harness/scope.json`: `vendor` gains `"odht": "=0.3.1"`.
- `src/rustc_hir_id/def_path_hash_map.ts`:
  - `Config` companion now has `EncodedKey: ByteArray_u8_array(8)`, `EncodedValue: ByteArray_u8_array(4)` and
    `H: UnHashFn`, and it `satisfies odht.Config<Hash64, DefIndex>`.
  - Stand-ins removed. `HashTableOwned` is now `type = odht.HashTableOwned<Hash64, DefIndex>` plus
    `const = odht.HashTableOwned`, and `debug_HashTableOwned` is odht's.
- `src/rustc_hir_id/definitions.ts` (call site): `HashTableOwned.default()` becomes `HashTableOwned.default(Config)`.
- `src/rustc_hir_id/tests.test.ts` (call site): the same change.
- `src/rustc_metadata/rmeta/def_path_hash_map.ts`:
  - `OdhtHashTable` stand-in removed.
  - `OwnedFromMetadata._0` is `odht.HashTable<Hash64, DefIndex>`.
  - `decode` calls `odht.HashTable.from_raw_bytes(HashMapConfig, o)`, which is zero-copy over the `OwnedSlice`.
  - decoder.ts needed no change.
- PENDING stop texts advanced from `odht::HashTable::from_raw_bytes` to -a's
  `MetaDecoder::decoder for (&CrateMetadata, TyCtxt) (AllocDecodingState::new_decoding_session)`, which is
  `CrateMetadata::new`'s `incoherent_impls` decode. Files changed:
  - `src/rustc_metadata/creader.oracle.test.ts`;
  - `src/rustc_metadata/locator.oracle.test.ts` (`RMETA_DECODER`);
  - `src/rustc_metadata/rmeta/decoder_b.oracle.test.ts` (the `CrateMetadata::new` case; also its comments).

  `contract.test.ts` was not affected. No matching case was changed.

## Checks
- Probes built: `bun scripts/probes.ts build odht rmetadecode`.
- `bunx tsc --noEmit -p .`: clean.
- `coverage --check`: markers ok (7838; vendor 3664).
- `--missing`: hir_id def_path_hash_map.rs 4/4; rmeta def_path_hash_map.rs 3/3.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3870 pass, 1 skip (the existing linux-only one),
  0 fail.
- `expanded-nocore --sample 300` (run 20261013-192813-odht-wire-kekp): 271 MATCH, 0 DIFF, 29 UNPORTED (3 skipped).
  All 29 stop at `rustc_metadata::rmeta::decoder::MetaDecoder::decoder for (&CrateMetadata, TyCtxt)
  (AllocDecodingState::new_decoding_session)`.

## unported(...) left
None added. The two odht stand-in `unported` calls are gone, and so is the `debug_HashTableOwned` one.

## PORT decisions / notes for root
1. `tools/codegen/typemap.hir.json` still maps `odht::HashTableOwned` to `HashTableOwned` from
   `src/rustc_hir_id/def_path_hash_map.ts`. Its type args are dropped, so the module exports the non-generic alias
   `HashTableOwned = odht.HashTableOwned<Hash64, DefIndex>`. This is correct for rustc's only use
   (`HashTableOwned<Config>`).
2. The typemap entry's note ("stand-in ... until odht is vendored") is stale. Fix it in a tools batch; the generated
   files do not change.

## Merge: rmeta-decoder-a + cstore-impl (follow-up fixer task)
- **`git merge --no-ff lane/rmeta-decoder-a`** (80249ad).
  - Conflicts:
    - `contract.test.ts`: kept both lanes' probes, `get_associated_item` (-b) and `decode_alloc_id` (-a).
    - `decoder.ts`: the duplicate imports across the two lanes' import blocks were dropped, and
      `HygieneDecodeContext_` became a value import.
  - decoder.rs is 156/156, and each marker appears exactly once.
  - `print_item` now uses the generated `decode_DefKey`; the `decode_DefKey_pending` stub is deleted.
  - `CrateMetadata::new` already set `HygieneDecodeContext.default()`, and `imported_source_file` already returned
    rustc_span's `SourceFile` (from `new_imported_source_file`). Neither needed a change.
  - Codegen: `bun tools/codegen/types.ts` was run for `rustc_hir`, `rustc_middle`, `rustc_crate_store` and
    `rustc_metadata_rmeta`. The output is byte-identical to the committed files.
- **`decoder_a.oracle.test.ts`**: `PENDING_B` is empty, so span / expn / name / path are compared strictly and match.
  The `-Zls=items` case runs for real (its DefKey skip is gone) and matches.
- **`decoder_b.oracle.test.ts`**, which moved from PENDING to compared:
  - `get_diagnostic_items` and `get_traits`, against the probe's `diag` / `traits` lines;
  - the root's `get_module_children` through a real `TyCtxt` (new helper `with_registered_crates`). The non-reexport
    prefix matches the oracle, and the reexports stop at `Decodable for rustc_middle::metadata::ModChild`.

  The PENDING cases that are left now use exact stop texts:
  - `CrateMetadata::new`: `Decodable for rustc_middle::ty::fast_reject::SimplifiedType (M3)`. For compiler_builtins,
    which has no incoherent impls, `new` finishes; the test then checks `num_def_ids` and the cnum.
  - `get_lang_items`: `Decodable for rustc_hir::lang_items::LangItem (...)`.
  - `get_missing_lang_items`: `Decodable for rustc_attr_ir::lang_items::LangItem (...)`.

  For a crate with an empty array, the test also checks that the oracle section is empty.
- **creader / locator oracle tests**: the stop is now SimplifiedType. The two profiler_builtins cases stop later, at
  `Decodable for rustc_session::config::mitigation_coverage::DeniedPartialMitigation (...)`; they use a per-case
  `stop`.
- **`git merge --no-ff lane/cstore-impl`**: clean. cstore_impl.rs is 37/37.
- Deleted the claims `docs/claims/wave11-{rmeta-decoder-a,rmeta-decoder-b,cstore-impl,odht}.md`.
- **Checks:**
  - probe `rmetadefs` built;
  - tsc clean;
  - `coverage --check`: markers ok (7890; vendor 3664);
  - `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3890 pass, 1 skip, 0 fail;
  - parse `--sample 200`: 200/200 MATCH (run 20261013-194711-odht-wire-iv5a);
  - expanded-nocore `--sample 300` (run 20261013-194728-odht-wire-vjli): 271 MATCH, 0 DIFF, 29 UNPORTED (3 skipped).
    All 29 stop at `Decodable for rustc_middle::ty::fast_reject::SimplifiedType (M3)`.
- **For root:** record -a's scope decision (the line split 1..1342 / 1343..end). Root can also tighten the
  decoder.ts contract aliases `HygieneDecodeContext` / `SourceFile` / `SpanData`, which are still `unknown`.
