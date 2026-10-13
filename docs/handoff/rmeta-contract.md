# Handoff: rmeta-contract (wave 11b): rmeta types, tables and the decoder contract

Branch `lane/rmeta-contract`, based on 2d98318 (wave 11a integrated). No merges.

## Result
Crate metadata headers and roots are decoded for real. `MetadataBlob::{new, check_compatibility, get_header,
get_root, get_root_unhashed, get_crate_hash, list_crate_metadata("root")}` match the oracle on every crate of the
oracle sysroot (x86_64-unknown-linux-gnu). Crate loads now pass the locator, `crate_matches`, `register_crate` and
`resolve_crate_deps`, and stop at `CrateMetadata::new` (lane rmeta-decoder-b; it then needs vendor odht, see below).

**expanded-nocore `--sample 300` (`RUST_TS_AGENT=rmeta-contract`):** 277 MATCH / 0 DIFF / 23 UNPORTED both before and after.

| stop | before (run 20261013-182827-rmeta-contract-a04q, base 2d98318) | after (run 20261013-182758-rmeta-contract-zlvy) |
|---|---|---|
| `MetadataBlob::new (wave 11 rmeta-decoder)` | 23 | 0 |
| `rustc_metadata::rmeta::decoder::CrateMetadata::new` | 0 | 23 |

`--suite parse --sample 200`: 200/200 MATCH (run 20261013-182855-rmeta-contract-8urk).

## Files
- **Ported in full:**
  - `src/rustc_metadata/rmeta/mod.ts`: mod.rs 18/18. It also holds `decode_LazyValue` / `decode_LazyArray` /
    `decode_LazyTable` (decoder.rs:676/683/690) and `LazyTable::{get, size}` (table.rs:515/536) in the class body.
  - `src/rustc_metadata/rmeta/table.ts`: table.rs 39/39.
  - `src/rustc_metadata/rmeta/def_path_hash_map.ts`: def_path_hash_map.rs 3/3 (1 rustc-skip: the Encodable impl).
  - `src/rustc_metadata/rmeta/parameterized.ts`: 0/0 (a type-level trait; the file says why).
- **Contract + partial port:** `src/rustc_metadata/rmeta/decoder.ts`, decoder.rs 86/156. See "Contract" below.
- **Generated:** `src/rustc_metadata/decodable.gen.ts` (new set `rustc_metadata_rmeta`, 10 decoders);
  `src/rustc_crate_store/cstore.gen.ts` regenerated (+`decode_CrateDepKind`, `decode_LinkagePreference`).
- **Outside the lane (needed; please review):**
  - `src/rustc_target/spec/tuple.ts`: ported `impl Decodable for TargetTuple` (tuple.rs:71).
  - `src/rustc_target/spec/mod.ts`: `decode_PanicStrategy`, a hand expansion of derive(BlobDecodable). The enum is inside
    `target_spec_enum!`, which tools/codegen cannot see.
  - `src/rustc_session/config.ts`: `decode_SymbolManglingVersion`, a hand expansion. syn cannot parse config.rs
    (863:37), so no codegen set can cover it.
  - `src/rustc_data_structures/sorted_map.ts` (new, 3/28): `SortedMap::{from_presorted_elements, get, lookup_index_for}`.
  - `src/rustc_metadata/lib.ts`: loads mod → table → def_path_hash_map → decoder.
  - Oracle test stops advanced:
    - `creader.oracle.test.ts`: the stop is now `CrateMetadata::new`. Four cases now also resolve the first crate's deps:
      `panic_unwind`/`panic_abort` + `rustc_std_workspace_core`, `core`; `std` + `core`.
    - `locator.oracle.test.ts`: the decoder stop is `CrateMetadata::new`. The garbage-rmeta case is now a **full**
      byte-for-byte match (E0786).
- **tools/codegen** (every other set regenerates byte-identically; all sets were rerun):
  - `types.ts`:
    - new per-set `decoders` override (a set may use `BlobDecoder` while serialize.json's global entry stays `Decoder`);
    - template imports skip method calls (`$D.decode_symbol()` imports nothing);
    - `derive_only` + `class` types are imported as values for `new T(..)`.
  - `serialize.json`:
    - `LazyDecodable` → `LazyDecoder` (decoder.ts);
    - new entries: the rustc_span BlobDecoder/SpanDecoder method templates (Symbol, ByteSymbol, DefIndex,
      LocalDefId, CrateNum, DefId, Span, SyntaxContext, ExpnId, AttrId), StableCrateId (cross-set), IndexVec,
      TargetTuple, PanicStrategy, SymbolManglingVersion, CrateDepKind, LinkagePreference, Svh, LazyTables.
  - `types.sets.json`: new set `rustc_metadata_rmeta`; `rustc_crate_store` opts in two decodable types.
- **Probe + tests:**
  - `tools/probes/rmetaroot/` (rustc-dev). It uses the oracle's own `DefaultMetadataLoader`, `MemDecoder`, leaf
    Decodable impls and symbol interner. It prints the header, the CrateHeader, every CrateRoot scalar, every lazy
    array/value/table position (+ width, length) and the CrateRootUnhashed. The CrateRoot layout is mirrored, since
    CrateRoot is private.
  - `src/rustc_metadata/rmeta/root.oracle.test.ts` covers 54 files (27 rlib stubs + 27 rmeta).
    - The port prints the probe's lines identically.
    - `locator::list_file_metadata(.., ["root"])` equals `rustc -Zls=root <file>` on every file. The stub rlibs ICE in
      both with "MemDecoder exhausted".
    - Negative control: swapping width/len in `decode_LazyTable` fails it.
  - `src/rustc_metadata/rmeta/contract.test.ts` checks three things:
    - all 156 decoder.rs fns are ported, `rustc-decl`'d or installed;
    - every `CrateMetadata` declaration exists on the prototype;
    - the stubs stop as UNPORTED.
  - Build the probe before the gate: `bun scripts/probes.ts build rmetaroot`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: green.
- `bun scripts/coverage.ts --check`: ok.
- `--missing`: mod.rs, table.rs, parameterized.rs and def_path_hash_map.rs are all 0.
- Fresh-process loads work for rmeta/{mod,table,decoder,def_path_hash_map,parameterized}.ts, lib.ts, locator.ts
  and creader.ts. `decodable.gen.ts` must not be entered first.

## Contract (decoder.rs)
**Split point: decoder.rs:1343 (`CrateMetadata::get_mod_child`).**
- **rmeta-decoder-a** (decoder.rs:1..1342). Left: `MetaDecoder::decoder` for `(&CrateMetadata, TyCtxt)` (:297,
  `CrateMetadata_tcx_decoder`); `TyDecoder` (:398 `cached_ty_for_shorthand`, :415 `with_position`, :428
  `decode_alloc_id`); `SpanDecoder` :464 `decode_syntax_context`, :480 `decode_expn_id`, :504 `decode_span`;
  `decode_SpanData` (:576); `print_item` (:888, so -Zls=items); `impl CrateMetadata` :1028..:1332 (24 fns; 
  `map_encoded_cnum_to_current` is ported).
- **rmeta-decoder-b** (decoder.rs:1343..end). Left: :1343 `get_mod_child` .. :1962 `get_doc_link_traits_in_scope` (35
  fns + the nested `filter` :1737) and `CrateMetadata::new` (:1977). The accessors :2037..:2166 are ported.
- **Already ported** (keep): the header path; `impl CrateRoot`; `LazyDecoder` (+ provided) for both contexts;
  `MetaBlob`; `MetaDecoder` for `&MetadataBlob`; `LazyValue::decode` / `LazyArray::decode`; `DecodeIterator`;
  `BlobDecoder` for both contexts; `InternerDecoder`; `Decodable for ExpnIndex`; `SpanDecoder::{decode_attr_id,
  decode_crate_num, decode_def_id}`; the `forward_all_decoder_methods_to!` expansion; the second impl block's accessors.

### How to fill a stub
1. Every method is declared in decoder.ts's `interface CrateMetadata` / `MetadataDecodeContext` / `BlobDecodeContext`
   / `MetadataBlob` blocks, grouped by upstream impl block. These declarations are root's: do not change a signature
   without root. If you must, add a local `declare module` marked `// PORT(decls): pending root` and note it.
2. **Methods.** Assign `CrateMetadata.prototype.<name> = function (this: CrateMetadata, ..) { .. }` **inside your
   region** (`// ---- lane rmeta-decoder-a ...` / `-b`), in upstream order, with the `// rustc:` marker above it. Then
   delete the name from your region's `unported_methods(..)` list; delete the call when the list is empty. -a also
   has the `MetadataDecodeContext` list.
3. **Free fns** (`CrateMetadata_tcx_decoder`, `decode_SpanData`) and the static `CrateMetadata.new` already have their
   final signatures: fill them in place, add the marker, and delete the `rustc-decl` comment.
4. **Imports.** Put new imports under a `// rmeta-decoder-a imports` / `-b imports` comment at the top, so the two
   lanes do not conflict.
5. **Representation:**
   - Tables: `this.root.tables.<t>.get(fse_<T>, this, index)`. The first argument is the `FixedSizeEncoding`
     dictionary of the table's element type from table.ts: `fse_Option_LazyValue`, `fse_Option_LazyArray`,
     `fse_LazyArray`, `fse_Option_DefKind`, `fse_Option_RawDefId`, `fse_bool`, `fse_u64`, `fse_AttrFlags`,
     `fse_Asyncness`, `fse_Constness`, `fse_Safety`, `fse_Defaultness`, `fse_Option_CoroutineKind`. Each table's
     upstream type is in its doc comment in mod.ts.
   - Lazy decoding: `lazy.decode(this, decode_T)` is `.decode(&blob)`; `lazy.decode([this, tcx], decode_T)` is
     `.decode((self, tcx))`. `LazyArray.decode` returns a `DecodeIterator` (iterable; `.len()`).
   - Field renames: `CrateMetadata.{blob_, source_, dep_kind_, used_}`, `BlobDecodeContext.blob_`,
     `CrateRoot.stable_crate_id_`. `trait_impls` must be a `KeyedMap(RawDefId_key)` (mod.ts).
   - Generators: upstream `gen move { .. }` / `impl Iterator` returns are `Iterable` generator functions
     (`function* (..)`).
   - Types without a TS port are `unknown` aliases at the top of decoder.ts (`AllocDecodingState`,
     `HygieneDecodeContext`, `SimplifiedType`, `SourceFile`, `SpanData`, `ProcMacroClient`).
6. **Init order.** mod.ts must not import decoder.ts at runtime (decoder.ts attaches methods to mod.ts classes at
   load). decoder.ts's top level may touch only mod.ts, table.ts and other crates. Consumers import
   `rustc_metadata/lib.ts`.

## `unported(...)` left
- The decoder stubs above (`rustc_metadata::rmeta::decoder::CrateMetadata::<name>` / `MetadataDecodeContext::<name>`).
- **odht** (`OdhtHashTable.from_raw_bytes` / `get`, def_path_hash_map.ts). Vendor odht 0.3.1 is not ported, and
  `CrateMetadata::new` decodes `def_path_hash_map` first thing, so **every crate load will stop there once -b ports
  `new`**. A vendor lane is needed: odht read side, `HashTable::from_raw_bytes` + `get`, about 800 lines.
- `list_crate_metadata`: the kinds lang_items / features / items / target_modifiers (their element types have no
  Decodable yet).
- `decode_TargetModifier` / `decode_DeniedPartialMitigation` (`CrateRoot::decode_target_modifiers`, used by creader's
  `report_session_incompatibilities`): rustc_session options.rs types, no codegen set yet.
- `rmeta::provide` → `encoder::provide` (M5). lib.ts still exports `cstore_impl::provide` directly.
- In decodable.gen.ts, `unported_decodable` sits only behind phantom type parameters, plus
  `ProcMacroData.stability` (`rustc_attr_ir::Stability`). The latter is reached for proc-macro crates only and needs
  the rustc_attr_ir set to opt in Stability/StabilityLevel/StableSince/UnstableReason, plus rustc_ast `RustcVersion`.

## PORT decisions (please record)
1. **Hand types, generated derives.** The rmeta types are hand-written classes and interfaces. Their
   derive(Decodable) comes from a `derive_only` set (`rustc_metadata_rmeta`). `LazyTables` / `TableBuilders` are
   expanded from `define_tables!` with their derives written by hand (82 tables), and so are `decode_PanicStrategy` and
   `decode_SymbolManglingVersion` (both are macro- or syn-invisible).
2. **`FixedSizeEncoding` is a dictionary** (`fse_*` in table.ts): `BYTE_LEN`, `default`, `is_default`, `from_bytes`,
   `write_to_bytes`. `LazyTable::get` takes it as its first argument. Stand-ins for `hir::{Defaultness, Constness,
   CoroutineKind, ..}` and `ty::Asyncness` live in table.ts until hir.rs / ty are ported.
3. **`rustc_span::{BlobDecoder, SpanDecoder}` are declared structurally in decoder.ts**, without markers, because lane
   span-decode owns the rustc_span traits. Replace them with an import when it lands. Then switch serialize.json's
   global `Decodable` / `BlobDecodable` decoders and drop the per-set `decoders` overrides. Note that MemDecoder must
   then implement them, because serialize_oracle's cases decode rustc_span types with a MemDecoder.
4. **`MetaDecoder` is the union `MetadataBlob | [CrateMetadata, TyCtxt]`** with a dispatcher; `MetaBlob` is an
   interface. `LazyValue/LazyArray::decode` take the element's Decodable fn. `ParameterizedOverTcx::Value<'tcx>` is
   `T`.
5. **Iterators and arrays.** `DecodeIterator` implements the JS iterator protocol (`next` → `IteratorResult` as the
   `Option`). `CrateRoot::decode_*` collect it into arrays, because creader indexes them.
6. **`Svh` stays creader's stand-in** (the `to_hex` text). `decode_Svh`, `Svh_new`, `Svh_as_fingerprint` and `debug_Svh`
   are in decoder.ts. svh.rs is still unported.
7. **Positions are numbers** (exact < 2^53, otherwise checked with a panic). Table `u64` values (`def_path_hashes`) are
   `bigint`.
8. **Phantom decode arguments.** `decode_LazyValue` / `decode_LazyArray` / `decode_LazyTable` accept the phantom decode
   fns tools/codegen passes (`PhantomDecodable`, an `any`-typed fn, PORT-noted).
9. The `rmetaroot` probe mirrors CrateRoot's private layout. Every leaf value comes from oracle code, and the `-Zls=root`
   comparison exercises the oracle's own decoder end to end.

## For root
- Review the tools/codegen changes and the outside-lane edits listed above. Record the decisions.
- Build `rmetaroot` on gate hosts.
- Schedule vendor odht (read side) before or alongside rmeta-decoder-b.
- Delete `docs/claims/wave11-rmeta-contract.md` on integration.
