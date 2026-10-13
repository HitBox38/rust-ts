# Handoff: rmeta-decoder-a (wave 11b): rustc_metadata decoder.rs lines 1..1342

Branch `lane/rmeta-decoder-a`, based on 8005559 (rmeta-contract merged, span-decode included). No merges.

## Result
Every decoder.rs fn before `CrateMetadata::get_mod_child` (:1343) has its marker: `--missing` lists nothing below
1343 (decoder.rs 119/156; the 37 left are all lane rmeta-decoder-b's: :1343..:1962, the nested `filter` :1737 and
`CrateMetadata::new` :1977).

Ported for real: `MetaDecoder::decoder` for `(&CrateMetadata, TyCtxt)` (:297), `with_position` (:415),
`decode_syntax_context` / `decode_expn_id` / `decode_span` (:464/:480/:504, through rustc_span's
`hygiene::{decode_syntax_context, decode_expn_id}` and the crate's `HygieneDecodeContext`), `decode_SpanData` (:576,
local and foreign spans via `CStore::from_tcx(..).get_crate_data`), `print_item` (:888, `-Zls=items`), and
`impl CrateMetadata` :1028..:1332 (`missing`, `raw_proc_macro`, `opt_item_name`, `item_name`, `opt_item_ident`,
`item_ident`, `def_kind`, `get_span`, `load_proc_macro`, `get_visibility`, `get_safety`, `get_default_field`,
`get_expn_that_defined`, `get_stability_implications`, `get_diagnostic_items`, `get_canonical_symbols`,
`get_fake_doc_items`, and the array-decoding bodies of the rest, see "unported").

**Scope decision.** The lane brief also listed `def_key`, `def_path`, `get_attrs` (`get_item_attrs`) and
`imported_source_file`; those are at decoder.rs:1466..1736, i.e. lane -b's range per the contract's split
(1..1342 / 1343..end). I followed the line split and did not port them. Root: please record.

## Files
- `src/rustc_metadata/rmeta/decoder.ts`: my regions only, plus:
  - the header: the contract's structural `BlobDecoder` / `SpanDecoder` are replaced by rustc_span's (lib.ts),
    re-exported (`export type { BlobDecoder, SpanDecoder }`) so existing importers keep working;
  - a `// rmeta-decoder-a imports` block;
  - `print_item` filled in place inside `list_crate_metadata` (the contract left its stub there).
- `tools/codegen/types.sets.json`:
  - rustc_middle set: `derive_decodable` + `decodable_types: [rustc_middle::ty::Visibility]` (+ hand note) ->
    new `src/rustc_middle/decodable.gen.ts` (`decode_Visibility`);
  - the per-set `decoders` overrides of `rustc_crate_store` and `rustc_metadata_rmeta` are removed (contract
    PORT decision 3: span-decode had already switched serialize.json's globals). Regenerated
    `src/rustc_crate_store/cstore.gen.ts` and `src/rustc_metadata/decodable.gen.ts`: only their `BlobDecoder` import
    moves to rustc_span/lib.ts. Every other set is untouched.
- `src/rustc_metadata/rmeta/contract.test.ts`: the "stubs stop as UNPORTED" case checked `def_kind` (now ported);
  it now checks `MetadataDecodeContext::decode_alloc_id` (an M3 stop that stays after -b).
- New probe `tools/probes/rmetadefs/` (rustc-dev; build with `bun scripts/probes.ts build rmetadefs`).
- New test `src/rustc_metadata/rmeta/decoder_a.oracle.test.ts`.

## Tests
- **rmetadefs** runs the oracle driver on a `#![no_core]` crate with `extern crate core; extern crate
  compiler_builtins; extern crate alloc;` (`--target x86_64-unknown-linux-gnu --sysroot <oracle>`), and in
  `after_expansion` prints through the oracle's queries, for chunks of each crate's DefIndexes
  ([0,200), [n/2,+100), [n-100,n)): `def_kind`, `visibility`, `def_span`, `expn_that_defined` (+ `ExpnKind`), item
  name (`opt_item_name` logic), def path, `default_field`; plus `diagnostic_items`, `stability_implications`,
  `canonical_symbols`, `fake_doc_items`. 1709 lines, 0.35 s. Spans print as `file:lo..hi` relative to the file plus
  the context's `marks()`, so the output does not depend on decoding order (source map positions /
  `SyntaxContext` numbers do).
- The TS side builds a real `TyCtxt` (driver config, `parse`, `create_and_enter_global_ctxt`), registers the three
  `.rmeta` in the real `CStore` (`intern_stable_crate_id`, a directly constructed `CrateMetadata` with
  `HygieneDecodeContext.default()`, `set_crate_data`), and prints the same lines from the ported methods.
- Fields needing -b (`span` and non-root `expn` -> `imported_source_file`; `name` -> `def_key`; `path` ->
  `def_path`) may be `UNPORTED(..)` on the port's side; everything else must match. Today: kind/vis/default and all
  crate-level lines match strictly; span 1196, name 1200, path 1200, expn 61 pending.
- Scratch validation (not committed): with a throwaway `imported_source_file` (upstream :1736 minus the path
  translations) all **span and expn fields match too** (validates `decode_span` incl. indirect/relative tags,
  `decode_SpanData` local + foreign (alloc -> core), `decode_syntax_context`, `decode_expn_id`, ExpnData decoding).
  With -b's in-progress `decode_DefKey`, the `-Zls=items` test (`print_item` vs `rustc -Zls=items` on
  compiler_builtins) **matches byte for byte**.
- Negative control: shifting the `Restricted` module index by one fails the test with the expected diffs.
- `-Zls=items` test: today a visible SKIP (`decode_DefKey_pending` is unported).
- Checks: `bunx tsc --noEmit -p .` clean; `bun scripts/coverage.ts --check` ok (markers 7834);
  `--suite parse --sample 200`: 200/200 MATCH (run 20261013-191601-rmeta-decoder-a-04t0);
  `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3724 pass, 1 skip (the existing linux-only one), 0 fail.
- Fresh-process loads of decoder.ts, lib.ts, creader.ts, locator.ts, mod.ts, both decodable.gen.ts work
  (decoder.ts now imports `../creader.ts` for `CStore`; creader.ts uses decoder.ts bindings only inside functions).

## `unported(...)` left (my range)
- `MetadataDecodeContext::cached_ty_for_shorthand` (`TyCtxt::caches.ty_rcache`, M3) and `decode_alloc_id`
  (`AllocDecodingSession::decode_alloc_id`, M3).
- `CrateMetadata::get_variant` / `get_adt_def`: after the `AdtKind` match (VariantData is TyDecodable; ReprOptions,
  ty::VariantDef / AdtDef: M3).
- `decode_unported(..)` element decoders (reached only when the array / value is non-empty):
  `rustc_middle::ty::RestrictionKind` (`get_mut_restriction`), `DebuggerVisualizerFile`
  (`get_debugger_visualizers`), `FeatureStability` (`get_lib_features`), `LangItem` (`get_lang_items`; the derive
  sits inside `language_item_table!`), `StrippedCfgItem<LocalDefId>` (`get_stripped_cfg_items`, no codegen opt-in).
- `decode_DefKey_pending` (`print_item`): **on integration with -b, import -b's generated `decode_DefKey`
  (rustc_hir_id `definitions.gen.ts`) in decoder.ts, delete the stub**; the `-Zls=items` test then runs for real.
- `load_proc_macro` reaches `get_item_attrs` (-b) and needs `raw_proc_macros` clients (M6).

## PORT decisions (please record)
1. **Alloc decoding session.** `CrateMetadata_tcx_decoder` builds `alloc_decoding_session` as `{ state:
   cdata.alloc_decoding_state }` (upstream `new_decoding_session` is exactly `AllocDecodingSession { state: self }`);
   no rustc_middle interpret port needed until `decode_alloc_id` (M3).
2. **Contract `unknown` aliases left alone** (shared header): `hygiene_context` is cast to rustc_span's
   `HygieneDecodeContext`, `translated_source_file` to rustc_span's `SourceFile`; `decode_SpanData` returns
   rustc_span's `SpanData`. `get_diagnostic_items` / `get_canonical_symbols` return `DiagnosticItems` /
   `CanonicalSymbols` but stay declared `unknown`. Root may tighten these aliases/declarations now.
3. **Import aliases** `SyntaxExtension_`, `DefPath_`, `ModId_`: the contract imports those names type-only; my
   block imports the values under aliases instead of editing the contract's imports.
4. **Visibility decode is generated** (rustc_middle codegen set opt-in), not hand-written.
5. **`ty::AdtKind`** (M3) is its variant name string in `get_variant` / `get_adt_def`.
6. **`LibFeatures`** (not ported) is a `{ stability: Map }` record; `DiagnosticItems.id_to_name` is the generated
   `Map<DefId, Symbol>` (keyed by `DefId` object identity, as the generated type is).
7. **`decode_span`'s indirect offset** (`usize::from_le_bytes`) is a number, panicking if not a safe integer
   (contract decision 7); the relative-offset subtraction is unchecked as in a release rustc.
8. **Probe mirrors encoder.rs** `should_encode_{span,expn_that_defined,visibility}` to know which tables are
   recorded; the port prints from the tables' own presence, so a table-decoding bug shows as a diff.

## For root
- Build `rmetadefs` on gate hosts (`bun scripts/probes.ts build rmetadefs`).
- On integrating -b: wire `decode_DefKey` (above); expect `decoder_a.oracle.test.ts` to compare spans / names /
  paths strictly (its "pending" log line should disappear); then `PENDING_B` can be emptied so a regression cannot
  hide behind UNPORTED.
- -b's `CrateMetadata::new` must set `hygiene_context = HygieneDecodeContext.default()` and its
  `imported_source_file` must return a rustc_span `SourceFile` as `translated_source_file` (decode_SpanData reads
  `.start_pos`).
- Review the tools/codegen edit (types.sets.json: rustc_middle opt-in, two `decoders` overrides dropped).
