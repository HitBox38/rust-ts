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
