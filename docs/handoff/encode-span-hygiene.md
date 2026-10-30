# Handoff: lane encode-span-hygiene (plan-m5 wave 32)

Branch `lane/encode-span-hygiene`, made from main `06d07cf8`. **`integ-w32` is merged in first** (merge commit
`3f63335e`), so this lane builds on encode-contract's `EncodeContext` skeleton and the `Encodable` codegen.

## What landed

### Already in place (nothing to port)

The rustc_span side of the scope was already ported before this lane; I checked each one against the pin:
- **The hand `Encodable` impls in rustc_span lib.rs**:
  - `Span` :1448, `Symbol` :1454, `ByteSymbol` :1460, `ExpnId` :1466, `SyntaxContext` :1472, `CrateNum` :1478,
    `DefIndex` :1484, `DefId` :1490, `AttrId` :1496 and `SourceFile` :1996;
  - `LocalDefId` (def_id.rs:401), `LocalExpnId` (hygiene.rs:1532);
  - the `SpanEncoder` impls for `FileEncoder` / `MemEncoder`.
- **`HygieneEncodeContext`** (hygiene.rs:1331–:1410): `default`, `get_encoding_index`,
  `schedule_expn_data_for_encoding`, `encode` and `get_syntax_ctxt_encoding_index`. The span-decode lane ported these
  and its spancodec oracle test checks them.
- **No `raw_encode_syntax_context` at the pin.** The task names "`raw_encode_syntax_context` and friends", but
  hygiene.rs at the pin has no such fn. The only mention is a stale comment at encoder.rs:290 naming
  `raw_encode_expn_id`. `coverage --missing` reports rustc_span hygiene.rs at 98/98 and lib.rs at 242/242.

So the new work is all in `src/rustc_metadata/rmeta/encoder.ts`.

### Ported in encoder.rs (15 fns, all stubs before)

- **`impl SpanEncoder for EncodeContext`** (:151–:244):
  - `encode_crate_num` (with its proc-macro panic), `encode_def_index` (panics, as upstream) and `encode_def_id`;
  - `encode_syntax_context` (through `HygieneEncodeContext::get_syntax_ctxt_encoding_index`);
  - `encode_expn_id` (schedules local `ExpnData`);
  - `encode_span`: `span_shorthands`, `SpanTag::indirect` with relative or absolute offsets, and `write_with` of the
    `bytes_needed` LE bytes;
  - `encode_symbol`, `encode_byte_symbol`, `encode_local_def_id` and `encode_def_key`.
- **`bytes_needed`** (:254).
- **`impl Encodable<EncodeContext> for SpanData`** (:259):
  - Partial tags for dummy spans and spans that cross files;
  - Foreign tags for imported files, with their `metadata_index` and `cnum`;
  - Local tags, with `required_source_files.insert_full`;
  - inline lengths and contexts.
- **`encode_symbol_or_byte_symbol`** (:529): `SYMBOL_PREDEFINED`, `SYMBOL_STR`, `SYMBOL_OFFSET`.
- **`encode_source_map`** (:581): takes `required_source_files` and adapts a clone of each file: the
  `update_for_crate_metadata` name, `cnum` for proc-macro crates, and `StableSourceFileId::from_filename_for_export`.
  Then `TableBuilder::set_some` / `encode`.
- **`encode_hygiene`** (:2036): `HygieneEncodeContext::encode` into the three `TableBuilder`s (`SyntaxContextKey`,
  local `ExpnData`, `ExpnHash`).

## Decision for root: I took the SpanEncoder impl from encoder-a

The task file puts "`SpanEncoder for EncodeContext` (encoder.rs)" in this lane's scope. The contract test (from
encode-contract) gave :151–:244 to **encoder-a**. I followed the task file's explicit scope. I also took the three fns
that the impl's bodies call, so that span and symbol encoding is complete and testable end to end:
- `bytes_needed` :254;
- `SpanData` :259;
- `encode_symbol_or_byte_symbol` :529.

**encoder-a keeps only** `[u8]` :402, `encode_def_path_table` :556 and `encode_def_path_hash_map` :577, plus its two
hand-impl stubs outside encoder.rs. Root should record this (or revert it if encoder-a must own them).

## Contract test changes (by the delta)

- **Ownership.** `encoder_contract.test.ts` has a new `SPAN_HYGIENE` line set and a `ported_by(line)`. A `// rustc:`
  marker now counts for the lane that ported it, instead of always for encode-contract.
- **Per-lane counts:**
  - `encoder-a`: 16 → **3**;
  - `encode-span-hygiene`: 2 → **15** (all ported);
  - the others are unchanged (encode-contract 11, encoder-b 15, encoder-c 16, encoder-d 35; total 95).
- **"stubs stop with their lane".** `encode_span`, `encode_source_map` and `encode_hygiene` are no longer stubs, so
  the encoder-a probe is now `encode_def_path_table`.
- The module comment of encoder.ts states the new split.

## Tests

New file `src/rustc_metadata/rmeta/encoder_span_hygiene.test.ts` (5 tests). Each round trip encodes with the port's
`EncodeContext` over a `MemEncoder`, then decodes with the port's `MetadataDecodeContext` (decoder.ts). The decoder
runs over a stand-in `CrateMetadata`: crate 1, `cnum_map`, the hygiene tables and `imported_source_file`. Coverage:
- **`bytes_needed`** at the byte boundaries.
- **DefId, CrateNum, LocalDefId and `encode_def_key`:**
  - exact bytes and a decode through `map_encoded_cnum_to_current`;
  - the `encode_def_index` panic and the proc-macro CrateNum panic (`crate3`).
- **Symbols and byte symbols:**
  - the predefined tag + index, then a string, then `SYMBOL_OFFSET` to the string's position;
  - these decode through `BlobDecodeContext::decode_symbol_or_byte_symbol`.
- **Spans, hygiene and source map in one session.** Session: two local files, one remapped; an imported file; two
  expansions; two marks.
  - Local / long / with-context / dummy-with-context / cross-file (Partial) spans, then repeats (absolute
    shorthands).
  - Then an `ExpnId`, a `SyntaxContext`, `encode_hygiene` and `encode_source_map`.
  - The decoded source map table has the files in first-use order (the unused file is not encoded). Exported names
    lose their `local` part, and the session's own files keep it (clone). `stable_id` is
    `from_filename_for_export(.., stable_crate_id)`.
  - Spans decode to the same positions.
  - The contexts are rebuilt by `decode_syntax_context` from the `syntax_contexts` table with the same marks:
    transparency, `ExpnData` (normalised for crate numbers) and `ExpnHash`.
  - The foreign span's bytes are checked by hand (Foreign tag, `metadata_index` 6, crate 3). Decoding it needs the
    CStore.
- **A relative shorthand** (offset < target position) decodes through `with_position`.

## Verification

- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (23,041; vendor 4,680).
- **Coverage.** TOTAL 22,447 → **22,462** (+15). Base is the merge commit `3f63335e`.
  - `coverage --missing compiler/rustc_metadata/src/rmeta/encoder.rs`: 11/95 → **26/95**.
  - rustc_metadata: 363 → 378.
- `bun test src/rustc_span src/rustc_metadata tools/codegen`: 229 pass, 1 skip, 0 fail (37 files).
- **Samples.** `RUST_TS_AGENT=root-f5de`; "before" is a temporary base worktree at `3f63335e`, "after" is this branch.

  | suite | before (`3f63335e`) | after (this branch) |
  |---|---|---|
  | `mir --sample 300` | 297 MATCH, 1 UNPORTED, 2 UNSTABLE (run 20261030-090201-root-f5de-354l) | 297 MATCH, 1 UNPORTED, 2 UNSTABLE (run 20261030-090407-root-f5de-13f7) |
  | `tydump-ui --sample 300` | 298 MATCH, 2 UNSTABLE, 15 skipped (run 20261030-090301-root-f5de-lw0s) | same (run 20261030-090507-root-f5de-on3u) |

  The per-case jsonl files are identical before and after (0 differing lines). The one UNPORTED case is the same in
  both: `const-generics/transmute-fail.rs`, `rustc_abi::Size beyond 2^53`.

## `unported(...)` left

None in this lane's fns. The remaining encoder.rs stubs belong to encoder-a (3), encoder-b, encoder-c and encoder-d.

## PORT decisions (in the code)

- `required_source_files.iter().enumerate()`: the `Map<file index, insertion index>` iterates in insertion order, so
  the value is `on_disk_index`.
- `original_file_name.clone()` (`#[derive(Clone)]` on `RealFileName`) is a new `RealFileName` over the same
  `InnerRealFileName`s. Only `local` is reassigned (by `update_for_crate_metadata`), never mutated in place.
- `*dest = offset.to_le_bytes()` in `write_with`: `write_with(8, ..)` with a local `usize_to_le_bytes`, since a
  number < 2^53 fits the 8 LE bytes.
- `try_into::<u32>().expect("cannot export more than U32_MAX files")`: an explicit range check that panics with
  rustc's message plus `: TryFromIntError(())`.
- `SyntaxContextKey`'s `Encodable` (a tuple) is a local `encode_SyntaxContextKey`, the inverse of decoder.ts's
  `decode_tuple_(d, decode_SyntaxContext, decode_ExpnId, decode_Transparency)`.
- `HygieneEncodeContext::encode`'s `&mut (self, &mut tables..)` context is a tuple `[this, syntax_contexts,
  expn_data_table, expn_hash_table]` destructured in the callbacks.
- `span_shorthands` keys on the interned `Span`. The span interner dedups `SpanData` (span_encoding.ts PORT), so this
  is the same relation as upstream's `Span: Eq`.

## Notes

- encoder.ts is still not loaded at startup, since nothing calls the encoder yet, so the suites cannot change. The
  samples above confirm it.
- The base worktree used for the "before" samples (`.data/tmp/w32/esh-base`) was removed afterwards.
