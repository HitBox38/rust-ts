# Re-review: exported-symbols-codec (fix 32a2428d)

Reviewer: independent, read-only. Scope: `git diff integ-w34...HEAD -- src tools` (b140650c, 95d8de5c, 32a2428d) against
upstream at the pin. The first review is `docs/reviews/exported-symbols-codec.md` (3b22377c).

## Verdict: APPROVE

The blocking finding is resolved. The codecs now come from `tools/codegen`, regeneration reproduces the committed
output, and the generated code matches the upstream derive expansion byte for byte.

## Checks run

- `bunx tsc --noEmit -p .`: exit 0, no output.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts src/rustc_metadata src/rustc_middle tools/codegen`:
  588 pass, 0 fail, 68 files.
- `bun scripts/coverage.ts --check --offline`: `markers ok (23169; vendor 4680)`.
- Regeneration with `bun tools/codegen/types.ts rustc_middle`: `33/34 decodable/encodable impls`, `missing Decodable/Encodable: 0/0`.
  `git status --short` afterwards shows no change. The one-impl gap is SymbolName, which has an encode but no decode.
  That is expected, because its decode is the manual impl in codec.rs:276.

## 1. First review's findings

- **Blocking finding 1 (hand-written derives): resolved** with remedy (a).
  - `compiler/rustc_middle/src/middle/exported_symbols.rs` is added to the `rustc_middle` set's `files`
    (`tools/codegen/types.sets.json:787`).
  - The four types and `rustc_middle::ty::SymbolName` are added to `decodable_types` (`types.sets.json:849-853`), with
    a hand note.
  - The hand codecs are gone. The net diff of `exported_symbols.ts` against integ-w34 is only the header comment, and
    `ty/mod.ts` is unchanged against integ-w34.
  - Outside `decodable.gen.ts` and the test, the only users are `rmeta/encoder.ts:2891` and `rmeta/decoder.ts:1799`.
    Both import the generated fns.
- **Nit 2 (markers): moot.** Every generated fn carries a generator `// rustc-derive:` marker.
- **Nit 3 (`default:` for tag 6): resolved.** The generated decoder has `case 6:` and a `default:` panic.
- **Nit 4 (stale header): resolved.** `exported_symbols.ts:2-4` now points to `decodable.gen.ts`.
- **Nit 5 (duplicated tag helper): moot.** The helper was removed.
- **Test nit (NoDefId expectation built with the port's own emit_str): resolved.** The expectation is now the literal
  `[6, 2, 0x61, 0x62, 0xc1]` (`exported_symbols.test.ts:29`).
- **Test nit (no bad-tag test): resolved.** The test now pins the panic text `expected 0..7, actual 7`
  (`exported_symbols.test.ts:33`).
- **Coverage note (DefId/Ty/GenericArgs variants have no unit test): still open, no action needed.** These fields go
  through serialize.json entries that other generated codecs already use and test. Oracle coverage arrives with
  non-empty exported symbols (M7).

## 2. Regeneration

Regenerating reproduces the committed output exactly: no diff in `src` after the run (see "Checks run").

## 3. Fidelity to `rustc_macros/src/serialize.rs`

- **Enums with more than one variant**:
  - Encode: `disc = match *self {...}`, then `emit_u8(disc as u8)`, because each enum has fewer than `u8::MAX`
    variants.
  - Fields: for an enum that has fields, a second match encodes them in binding order. A fieldless enum emits only
    `disc` (serialize.rs:252).
  - Decode: `read_u8() as usize`, then each variant's fields in order, then the panic
    ``invalid enum variant tag while decoding `{ty}`, expected 0..{len}, actual {n}`` (serialize.rs:83-98).
  - The generated `SymbolExportLevel` (0..2), `SymbolExportKind` (0..3) and `ExportedSymbol` (0..7) codecs follow
    this exactly.
  - Variant indices match declaration order:
    - `SymbolExportLevel`: C, Rust.
    - `SymbolExportKind`: Text, Data, Tls.
    - `ExportedSymbol`: NonGeneric, Generic, DropGlue, AsyncDropGlueCtorShim, AsyncDropGlue, ThreadLocalShim, NoDefId.
- **Field encoders** in `ExportedSymbol`:
  - `DefId`: `encode_def_id` / `decode_def_id`.
  - `GenericArgsRef`: `encode_GenericArgs`, which is `encode_RawList` (length, then the elements). `decode_GenericArgs`
    is `read_usize` followed by `mk_args_from_iter`, i.e. the `RefDecodable for List<GenericArg>` path.
  - `Ty`: `encode_Ty` / `decode_Ty`, with shorthand.
  - Decode reads `_0` before `_1`, matching the derive's `construct` order.
- **`SymbolExportInfo`** is a single-variant struct with bindings, so the derive encodes its fields in declaration
  order: `level`, `kind`, `used`, `rustc_std_internal_symbol`. The generated code does the same.
- **`SymbolExportKind`** is plain `Encodable`/`Decodable`, so it gets SpanEncoder/SpanDecoder signatures. That is
  correct: a TyEncoder is a SpanEncoder.
- **`SymbolName`** is `#[derive(TyEncodable)]` only (ty/mod.rs:2406).
  - The generated `encode_SymbolName` (`decodable.gen.ts:255`) is `encode_str(self.name)`, which calls `emit_str`.
    This matches `<&str as Encodable>`.
  - **serialize.json entry is correct.** `rustc_middle::ty::SymbolName` has only `decode: decode_SymbolName($D)`, which
    imports from `ty/codec.ts`. That is the manual codec.rs:276 impl, `SymbolName::new(interner, read_str())`, at
    codec.ts:475. The entry has no `encode`, so the encode comes from the set's derive.
- **Tuple codec**: `encode_tuple` / `decode_tuple_` encode and decode the elements in order, matching upstream `(A, B)`.
  This is unchanged from the first review.

## 4. New issues introduced by the fix

None found.

- `refine_rpitit` is re-pinned at `compare_impl_item.oracle.test.ts:43`. This is unchanged from the reviewed 95d8de5c
  and passes with probes required.
- The type-only import added to `decoder.ts:117` cannot create an init-order hazard.

## Findings

None blocking. No new non-blocking findings.
