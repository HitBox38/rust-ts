# Handoff: span-decode (wave 11b): rustc_span's encode/decode side and hygiene decode

Branch `lane/span-decode`, based on integ 2d98318. There are no merges.

## Files touched
- **Port** `src/rustc_span/`:
  - `lib.ts`:
    - the `SpanEncoder` trait, with `SpanEncoder_provided` holding `encode_local_def_id` and `encode_def_key`;
    - the `BlobDecoder` and `SpanDecoder` traits;
    - their impls for `FileEncoder`, `MemEncoder` and `MemDecoder`;
    - the `Encodable` / `Decodable` impls through them: `encode_*` / `decode_*` for Span, Symbol, ByteSymbol, ExpnId, SyntaxContext,
      CrateNum, DefIndex, DefId and AttrId;
    - the manual impls of RemapPathScopeComponents, SourceFile, BytePos, RelativeBytePos and ErrorGuaranteed.
  - `def_id.ts`: `encode_LocalDefId` / `decode_LocalDefId`.
  - `hygiene.ts`:
    - `HygieneEncodeContext` (all five fns) and `HygieneDecodeContext`;
    - `decode_expn_id`, `decode_syntax_context`, and `encode_LocalExpnId` / `decode_LocalExpnId`;
    - `debug_hygiene_data(true)`, i.e. the derived Debug of `HygieneData`. Before this lane it was `unported`.
  - `source_map.ts`: `stable_source_file_id_key` now returns the id's `Hash128`.
  - `StableSourceFileId` was reworked: see PORT decision 5.
- **Generated**: `src/rustc_span/decodable.gen.ts` now has all 22 rustc_span `derive(Decodable*/Encodable*)` types (it had 12). The new ones
  are Spanned, RealFileName, InnerRealFileName, FileName, StableSourceFileId, ExpnData, ExpnKind, ModId, LocalModId and Ident.
- **tools/codegen**:
  - `types.sets.json` (rustc_span set): `decodable_types` is removed, so every type is generated. Six `decodable_construct` entries were added.
  - `serialize.json`:
    - `decoders.Decodable` is now `SpanDecoder` and `decoders.BlobDecodable` is now `BlobDecoder` (both from lib.ts).
    - The BytePos / RelativeBytePos templates now call the ported manual impls.
  - `serialize.test.ts`: the golden count is now 22/22.
- **New probe** `tools/probes/spancodec/{Cargo.toml.in,main.rs}`, a rustc-dev probe.
- **New tests**:
  - `src/rustc_span/span_codec_oracle.test.ts`, plus `span_codec_oracle/{cases.ts,expected.json}`.
  - `src/rustc_span/hygiene_verbose.test.ts`, plus `hygiene_verbose/{verbose.rs,expected.txt}`.

Every other codegen set regenerates byte-identically. A stray `src/rustc_lexer/lib.gen.ts` that the rustc_lexer set writes was not committed.

## Coverage (`bun scripts/coverage.ts --missing`)
- `hygiene.rs` is 98/98 and `lib.rs` 242/242.
- `def_id.rs` is 52/52, `source_map.rs` 84/84 and `symbol.rs` 71/71.
- No `rustc-skip` remains in `lib.ts`, `hygiene.ts` or `def_id.ts`. The encode side, including `HygieneEncodeContext`, is fully ported rather
  than stubbed, because the round-trip test encodes with it.
- `coverage --check`: markers ok (7652; vendor 3502).

## Tests and checks
- **`spancodec` probe.** Session A uses the oracle's rustc_span to build 4 expansions with `register_local_expn_id` and 5 contexts with
  `apply_mark`, covering all transparencies. It then encodes 31 cases:
  - spans whose contexts are reused;
  - symbols and byte symbols;
  - DefId, DefIndex, LocalDefId, CrateNum and ExpnId;
  - Ident, Spanned and AttrId;
  - RealFileName / FileName (all variants, including remapped and virtual), StableSourceFileId;
  - 4 SourceFiles: CRLF, multibyte, BOM, and `bytes_per_diff` of 1, 2 and 4;
  - ExpnKind, ExpnData, ModId, LocalModId, Transparency and StableCrateId.

  The encoder uses rmeta's scheme without shorthands, plus `HygieneEncodeContext::encode` for the context and expansion tables. Session B
  starts fresh and decodes everything with `hygiene::decode_syntax_context` / `decode_expn_id`, remapping crate n to n+1.

  The TS test rebuilds session A and must match the oracle on:
  - **byte-identical** bytes, case ends and hygiene table positions;
  - session A's verbose hygiene dump;
  - decoding the oracle's bytes to the same `{:?}` of every value;
  - the same SyntaxContext numbering;
  - the same `debug_hygiene_data(false/true)`, which covers foreign_expn_data and the syntax_context_map bucket order.

  Everything passes. A live check compares the fixture with the probe.
- **`hygiene_verbose.test.ts`** runs rust-ts `-Zunpretty=expanded,hygiene -Zverbose-internals --remap-path-prefix=<dir>=/remapped` on a
  no_core crate. Its maps grow, and `expn_data_disambiguators` reaches 2. The output is byte-identical to the oracle. A live oracle check
  runs when `rustc +nightly` works.
- `bunx tsc --noEmit -p .` is clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3716 pass, 1 skip (the existing linux-only one). There was 1 fail, the
  `unwrap_result` lint on my test helper. I fixed it in 58f9d85 and re-ran the affected files, which are green.
- Difftest samples, all MATCH:
  - `--suite parse --sample 200`: 200/200 (run `20261013-154145-span-decode-se5b`);
  - `emit --sample 100`: 100/100;
  - `parse-ui --sample 100`: 100/100.

## `unported(...)` left
- None in hygiene.rs.
- Three remain in rustc_span, all outside this lane: `std::path::Path::file_name` (lib.ts), `blake3::hash` and the SourceMap Debug `{:p}`.

## `// PORT:` decisions (please record)
1. **Traits as interfaces.** `SpanEncoder` / `BlobDecoder` / `SpanDecoder` are interfaces that extend `Encoder` / `Decoder`. Upstream's impls
   on `FileEncoder` / `MemEncoder` / `MemDecoder` live in rustc_span. They are ported as `declare module` interface merging plus prototype
   methods in lib.ts, so lib.ts now imports rustc_serialize's opaque.ts and mem_encoder.ts.
2. **Encoders take a plain `Encoder`.** rustc_serialize's `Encodable<T>` is `(v, s: Encoder)` and is not generic over the encoder. So every
   `impl<E: SpanEncoder> Encodable<E>` takes an `Encoder` and casts it (`span_encoder(s)`). `serialize.json` keeps `encoders.Encodable` as
   `Encoder` for the same reason. Decoders are generic and use the real traits.
3. **Codec location.** `encode_SourceFile` / `decode_SourceFile` are module-level functions after the `SourceFile` class, because codegen
   resolves `decode_<T>` exports of the hand module.
4. **InnerRealFileName.** `InnerRealFileName` is now exported, because the generated code imports its type.
5. **StableSourceFileId.**
   - It has a private constructor holding either its inputs (hashed lazily, as before) or a decoded `Hash128`, via `StableSourceFileId.of`.
   - The source map's `stable_id_to_source_file` is keyed by the `Hash128`, as upstream's `UnhashMap` is. This replaces the hash-input byte
     key, and the `StableHasherBytes` shim is gone.
   - As a result, every registered file is now hashed once. The parse, emit and parse-ui samples above show no change in output.
6. **HygieneEncodeContext.** `&RefCell<HygieneEncodeContext>` becomes the context itself. `serialized_expns` is a `Set` keyed by
   `expn_id_key`.
7. **HygieneDecodeContext.** `remapped_ctxts` is a holey array, which matches `IndexVec::insert`.
8. **Verbose `HygieneData` Debug.**
   - The TS maps keep insertion order and never remove entries. So each map is printed by replaying its inserts into the vendored hashbrown
     table: Fx for the FxHashMaps, and a local `Unhasher` stand-in for the UnhashMaps (`write_fingerprint_unhasher` for ExpnHash).
   - Maps made by `iter::once(..).collect()` replay through `extend(.., 1)`.
   - The bucket layouts are 64-bit estimates; only the size class matters here.

## For root
1. Build the probe before the gate: `bun scripts/probes.ts build spancodec`.
2. **The `Unhasher` stand-in** belongs in a ported `rustc_data_structures/unhash.rs`. Whoever ports that file should move it.
3. **Encoders.** If rustc_serialize's encoders become generic (`encode_Vec<T, S extends Encoder>` and so on):
   - switch `serialize.json` `encoders.Encodable` to `SpanEncoder`;
   - drop the `span_encoder` casts;
   - regenerate.
4. **rmeta-decoder** gets ready-made hooks:
   - `MetadataDecodeContext` implements `SpanDecoder`;
   - it calls `decode_syntax_context` / `decode_expn_id` with a per-crate `HygieneDecodeContext.default()`;
   - imported files go through `decode_SourceFile` and `SourceMap.new_imported_source_file`.

   `span_codec_oracle/cases.ts` `ProbeDecoder` is a worked example of all three.
5. **Shared config.** The rmeta-contract lane may also edit `serialize.json` / `types.sets.json`. The changes here are confined to the
   rustc_span set and the decoder entries.
