# Handoff: cstore-impl (wave 11b): rustc_metadata rmeta/decoder/cstore_impl.rs (the rest)

Branch `lane/cstore-impl`, based on 8005559 (rmeta-contract merge). No merges.

## Result
cstore_impl.rs is ported in full: **37/37** (`--missing` 0; it was 18/37 after creader).
- The extern query providers are in place: the `provide!` expansion, 116 queries.
- So are the local providers (`provide`) and the cstore hooks (`provide_cstore_hooks`).
- `rustc_metadata::provide` is wired into `DEFAULT_QUERY_PROVIDERS` (passes.ts).

**What runs end to end: nothing yet.**
- Every extern provider needs a loaded crate, and loading still stops in rmeta-decoder-b's `CrateMetadata::new`.
  The exact text is `rustc_metadata::rmeta::decoder::CrateMetadata::new`; after that comes odht's
  `OdhtHashTable.from_raw_bytes`.
- Any decode through `(cdata, tcx)` also stops at `CrateMetadata_tcx_decoder`:
  `rustc_metadata::rmeta::decoder::MetaDecoder::decoder for (&CrateMetadata, TyCtxt) (AllocDecodingState::new_decoding_session)`.
- The local providers are reachable in principle, but no sample reaches them. For example, `tcx.crates(())` in
  `write_out_deps` comes after `debugger_visualizers`, which is still unported.

So every case that would reach these providers is PENDING behind the texts above.

## Files
- `src/rustc_metadata/rmeta/decoder/cstore_impl.ts`: the full port, in upstream order (see "Structure").
- `src/rustc_metadata/rmeta/decoder/cstore_impl.test.ts` (new): 19 tests (see "Tests").
- `src/rustc_interface/passes.ts` (call site only):
  - imports `provide as rustc_metadata_provide` from `rustc_metadata/lib.ts`;
  - calls it in `default_query_providers` just before `rustc_lint.provide`, which is where upstream calls it;
  - updates the "pending crates" comment.

## Structure (all PORT-noted in the file header)
- **`trait ProcessQueryValue`.** Each of the 8 impls is a value: `ProcessQueryValue_T`, `_EarlyBinder`,
  `_Option_T`, `_Option_ref_T`, `_Option_Result`, `_DecodeIterator_slice`, `_DecodeIterator_Option_slice` and
  `_Deprecation`. The trait's `process_decoded` declaration (:33) sits on the interface.
- **`provide_one!` / `provide!`.**
  - `PROVIDE_EXTERN` is the invocation at :230. Each entry is `name: [IntoArgs impl, arm]`, in upstream order.
  - An arm is either a `TableArm` built by `table(fse, decode, process)`, `table_defaulted_array(decode, process)`
    or `table_direct(fse, process)`, or else the `$compute` block as `(tcx, def_id, other, cdata) => ..`.
  - `table_arm_compute` expands the first three macro arms.
  - `provide_one` builds the 4th arm's `fn $name`: the prof timer, `into_args`, `assert!(!def_id.is_local())`,
    `ensure_ok().crate_hash` and `CStore::from_tcx(tcx).get_crate_data`.
  - `provide_extern` (:168) installs the providers with `Object.assign`.
- **Element decoding.**
  - `lazy_value(what, decode_T)` / `lazy_array(what, decode_T)` / `raw_def_id` model `.map(|lazy|
    lazy.decode((cdata, tcx)))`.
  - Real decoders are used for `Span`, `String`, `Option<Ident>` and `IndexVec<FieldIdx, Symbol>`; the last
    decodes as `Vec<Symbol>`, as `IndexVec::from_raw` does.
  - Every other element type uses `decode_unported("<type>")` (list below).
- **`trait IntoArgs`.** Each of the 6 impls is a value: `IntoArgs_DefId`, `_ModId`, `_CrateNum`, `_CrateNum_DefId`,
  `_InstanceKind` and `_CrateNum_SimplifiedType`.

## Tests (`cstore_impl.test.ts`, 19 pass)
These tests read the pinned sources: cstore_impl.rs `provide!`, mod.rs `define_tables!`, queries.rs signatures, and
`arena_cache` from QUERY_DECLS. They check the table against them:
- **Names and order.** The 116 names appear in upstream order, and every one is `separate_provide_extern`.
- **`IntoArgs`.** Each entry's impl matches its query's key type in queries.rs.
- **Table arms (53).**
  - The arm kind matches upstream.
  - The `FixedSizeEncoding` matches the table's `define_tables!` type and section.
  - The element type (`what`) and the LazyValue / LazyArray / RawDefId kind match.
  - The **`ProcessQueryValue` impl equals the one Rust's trait selection picks.** The test derives it from the
    decoded type and the query's `ProvidedValue` (`arena_cache` unwraps `&'tcx T`).
- **Block arms (63).** Every `cdata.<member chain>` and every `tcx.<query>(` in upstream's `$compute` also appears
  in the TS arm. The field renames `dep_kind_` / `source_` are applied first.
- **Behaviour on a fake `TyCtxt` / `CrateMetadata`:**
  - the decoder method is called with the `DefIndex`;
  - the CrateNum, ModId and (CrateNum, DefId) keys work;
  - a local DefId fails the assert;
  - `crate_hash` is ensured only when the dep graph is fully enabled, and never for `crate_hash` itself;
  - `table_direct` returns the table value;
  - a missing `table` entry panics with upstream's `"{:?} does not have a {:?}"` text for `Option<T>` → `T`, and is
    `None` for `T` → `T`;
  - `RawDefId::decode` maps the cnum;
  - a default (empty) LazyArray gives `[]` without decoding;
  - unported element types stop at `unported`;
  - the local providers work: `crates` / `used_crates` (freeze + filter), `is_private_dep`, `duplicate_crate_names`,
    and `visible_parent_map` (BFS, `_` re-exports only as fallback);
  - the `def_path_hash_to_def_id_extern` hook works, including its `bug!` and `assert_ne!` texts;
  - all 15 upstream local providers are installed.
- **Negative control.** Each of three edits made the matching test fail:
  - `def_ident_span` switched to `ProcessQueryValue_Option_T`;
  - `inherent_impls` calling `get_incoherent_impls`;
  - `is_profiler_runtime` given `IntoArgs_DefId`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok. `--missing cstore_impl.rs`: 37/37.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3742 tests across 206 files, 0 fail, 1 skip.
- `--suite parse --sample 200`: 200/200 MATCH (run 20261013-191240-cstore-impl-lbos).
- `--suite expanded-nocore --sample 300` (run 20261013-191314-cstore-impl-1j46): 279 MATCH, 0 DIFF, 21 UNPORTED, and
  3 skipped.
  - All 21 UNPORTED stop at `rustc_metadata::rmeta::decoder::CrateMetadata::new`. That is the same stop
    rmeta-contract reported, so wiring the providers changed nothing on the sample.
- Fresh-process loads of `rustc_metadata/lib.ts` and `rustc_interface/passes.ts` work.

## `unported(...)` left (all in cstore_impl.ts)
- **Other rustc_metadata files** (not ported, not this lane's):
  - `rustc_metadata::native_libs::relevant_lib`
  - `rustc_metadata::native_libs::collect`
  - `rustc_metadata::foreign_modules::collect`
  - `rustc_metadata::eii::collect`
  - `rustc_metadata::dependency_format::calculate`
- **rustc_middle (M3):**
  - `rustc_middle::ty::EarlyBinder::bind_no_rigid_aliases (M3)`, used by the 5 EarlyBinder `table_defaulted_array`
    queries;
  - `rustc_middle::middle::stability::DeprecationEntry::external`;
  - `rustc_middle::ty::InstanceKind::def_id (M3)`, which no entry uses.
- **Element `Decodable`s.** Each one stops as
  `rustc_metadata::rmeta::decoder::cstore_impl: Decodable for <type>`. The types are:
  - **Clauses, generics and signatures:** `(ty::Clause<'static>, Span)` (5 tables), `(ty::PolyTraitRef<'static>, Span)`,
    `ty::GenericClauses`, `ty::Generics`, `ty::EarlyBinder<Ty>`, `ty::EarlyBinder<PolyFnSig>`,
    `ty::EarlyBinder<Const>` (×2), `Option<ty::EarlyBinder<Const>>`, `ty::Variance`, `ty::ImplTraitHeader`.
  - **Attributes and trait / ADT data:** `CodegenFnAttrs`, `ObjectLifetimeDefault`, `ty::ConstConditions`,
    `ty::TraitDef`, `ty::Destructor`, `ty::AsyncDestructor`, `ty::AnonConstKind`, `ty::adjustment::CoerceUnsizedInfo`,
    `hir::OpaqueTyOrigin<DefId>`, `PreciseCapturingArgKind<Symbol, Symbol>`, `DeducedParamAttrs`.
  - **MIR and const eval:** `mir::Body` (×2), `IndexVec<mir::Promoted, mir::Body>`, `mir::CoroutineLayout`,
    `mir::ConstQualifs`, `(ConstValue, Ty)`, `mir::interpret::ConstAllocation`.
  - **Stability:** `Stability`, `ConstStability`, `DefaultBodyStability`, `Deprecation`.
  - **Bit sets:** `DenseBitSet<u32>`, `Vec<(usize, DenseBitSet<u32>)>`.
  - **DefId maps** (these need a key strategy as well as a decoder): `DefIdMap<ty::EarlyBinder<Ty>>`,
    `DefIdMap<Vec<DefId>>`.

## PORT decisions (please record)
1. **Trait impls as values.** `ProcessQueryValue` / `IntoArgs` impls are values. The static impl selection is
   written out per `provide!` entry, and the test re-derives it from the pinned types.
2. **The `provide!` invocation is a data table** (`PROVIDE_EXTERN`). The three table macro arms are descriptors; the
   `$compute` blocks are closures. The macro-generated `fn $name`s have no markers (coverage does not count them).
3. **Arenas are erased.**
   - `alloc` → the value; `alloc_from_iter` → an array.
   - `extern_crate`'s `&*tcx.arena.alloc(c)` of the `Copy` value → `clone_ExternCrate`.
   - `alloc_str` / `alloc_path` → the value.
4. **`DefIdMap` / `FxIndexMap<DefId, _>` results are `KeyedMap(DefId_hash_key)`.** This covers
   `visible_parent_map`, `foreign_modules`, `externally_implementable_items` (inner map too),
   `reachable_non_generics` and `stable_order_of_exportable_impls`. `UnordMap<Symbol, Symbol>` is a plain `Map`.
5. **`ExportedSymbol`** is a local stand-in union (variant names from exported_symbols.rs:49). Only `NonGeneric`
   is matched.
6. **Casts on unported shapes.** Where decoder.ts declares `unknown` but queries.gen.ts has a concrete type, the
   provider casts. This applies to `get_diagnostic_items` → `DiagnosticItems` and to
   `exported_*_symbols` → `[ExportedSymbol, unknown][]`.
7. **Only the decoder half of `rmeta::provide` runs.** `rustc_metadata::provide` is `rmeta::provide`, which calls
   `encoder::provide` (M5, unported) and then `decoder::provide`. lib.ts already exports `cstore_impl::provide`
   directly, so the driver gets only the decoder half. Until the encoder lands, the local `doc_link_resolutions`,
   `doc_link_traits_in_scope`, `traits` and `trait_impls_in_crate` providers keep upstream's `default_query` ICE.

## For root / other lanes
- **rmeta-decoder-a/-b:**
  - Several `CrateMetadata` declarations in decoder.ts return `unknown` where the query type is concrete
    (`get_diagnostic_items`, `exported_*_symbols`). Aligning them would remove the casts.
  - When you port an element type's `Decodable` (`Visibility`, `Stability`, ...), replace its
    `decode_unported("<type>")` in `PROVIDE_EXTERN`. That is a one-line edit in cstore_impl.ts, and the test checks
    the `what` label against `define_tables!`.
- **`IndexVec<FieldIdx, Symbol>`** decodes with `MetadataDecodeContext.decode_symbol` (rmeta-decoder-a's stub
  until it lands).
- **passes.ts `write_out_deps`** still has the `used_crate_source` shim (`-Z binary-dep-depinfo`). Now that the
  provider exists, it can call `tcx.used_crate_source(cnum)`.
- On integration, delete `docs/claims/wave11-cstore-impl.md`.
