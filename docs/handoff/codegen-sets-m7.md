# Handoff: codegen-sets-m7 (tools batch, plan-m7 wave 40)

**Both codegen crates now have generator sets.** `rustc_codegen_llvm`'s diagnostics are generated, and four `rustc_codegen_ssa`
sets produce its diagnostics, `LinkerOutput` and the rlink codecs. `ExtractBundledLibsError`'s eight `Box<dyn Error>` fields are
typed per field by the error each holds, so the driver's io-error entry does not apply to them (review driver-cli-2 N3).

16 query value types the mono and codegen lanes cast are now real types (114 → 98 `unknown`). Three stay `unknown`, with reasons
below. Every generator's `--check` reports up to date, and regenerating from scratch gives byte-identical files.

Branch `t3/codegen-sets-m7`. Commit d6a2791f (the code); this handoff is its own commit.

## Files touched

Generator inputs (all under `tools/codegen/`):
- `types.sets.json`:
  - set `rustc_codegen_ssa`: `InvalidMonomorphization` and `FailedToGetLayout` leave `skip`; adds `typemap_extra`
    `codegen_ssa.typemap.json` and `diag_args_lazy` for `LayoutError`;
  - new sets `rustc_codegen_ssa_link`, `rustc_codegen_ssa_lib` and `rustc_codegen_llvm`;
  - set `rustc_crate_store`: `CrateSource` added to `decodable_types`.
- `codegen_ssa.typemap.json` (new): the per-field `fields` overrides, `NumScalableVectors`, and the `natvis_debugger_visualizers` override.
- `codegen_llvm.typemap.json` (new): `c_uint`, `CString`, `SmallCStr`.
- `diag_args.json`: `rust_ts::dyn_error::{Io,ObjectRead,Utf8,String}`, `NumScalableVectors`, `LayoutError`, `CString`, `SmallCStr`;
  `c_uint` joins the number entry.
- `serialize.json`: `CrateSource`, `SymbolExportKind`, `WindowsSubsystemKind` (their generated codecs).
- `queries.config.json`: 16 `types` entries (query-local, so no other generator sees them).
- `codegen_m7.test.ts` (new): goldens of the four sets (live probe), per-field mapping checks, resolved query types.

Generated (no hand edits):
- `src/rustc_codegen_llvm/diagnostics.gen.ts` (new): 32 types, 30 derives, 0 unknown, 0 missing IntoDiagArg.
- `src/rustc_codegen_ssa/diagnostics.gen.ts`: the per-field errors, plus `InvalidMonomorphization` and `FailedToGetLayout`
  (83 derives, up from 81).
- `src/rustc_codegen_ssa/back/link.gen.ts` (new): `LinkerOutput`.
- `src/rustc_codegen_ssa/decodable.gen.ts` (new): `decode_`/`encode_` for 9 lib.rs types (rlink).
- `src/rustc_crate_store/cstore.gen.ts`: `decode_CrateSource` and `encode_CrateSource`.
- `src/rustc_middle/queries.gen.ts`: the typed values.

## `Box<dyn Error>` in `rustc_codegen_ssa` (driver-cli-2 N3)

Each field's content comes from its one construction site, `extract_bundled_libs` (back/archive.rs:153):

| Variant | Holds | TS type | IntoDiagArg |
|---|---|---|---|
| OpenFile, MmapFile, WriteFile | `std::io::Error` | `IoError` | Box's `into_diag_arg_using_display` over `display_IoError` |
| ParseArchive, ReadEntry, ArchiveMember | `object::read::Error` | `object_read_Error` | over object's `display_Error` |
| ConvertName | `core::str::Utf8Error` | `Utf8Error` | over `Utf8Error.toString` |
| ExtractSection | `String` → alloc's `StringError` | `string` | over the string itself |

The `rust_ts::dyn_error::*` paths in `codegen_ssa.typemap.json` mean "a Box holding X". The diag_args entries give each one the Box
impl (`into_diag_arg_using_display!`, diagnostic_impls.rs:71) over X's Display, which prints exactly what the Box prints. The driver's
`dyn Error` entry matches only the spelling `dyn Error`. This crate spells it `dyn std::error::Error`, and its fields are retyped
before lookup, so that entry is never reached. The test checks all eight fields.

## Query `unknown`s

Resolved, each with its real type:

| Query | Type | Module |
|---|---|---|
| `collect_and_partition_mono_items` | `MonoItemPartitions` | `src/rustc_middle/mono.ts` |
| `codegen_unit` | `CodegenUnit` | `src/rustc_middle/mono.ts` |
| `items_of_instance` | `Result<[Spanned<MonoItem>[], Spanned<MonoItem>[]], NormalizationErrorInMono>` | `src/rustc_middle/mono.ts` |
| `symbol_name` | `SymbolName` | `src/rustc_middle/ty/mod.ts` |
| `codegen_fn_attrs` | `CodegenFnAttrs` | `src/rustc_middle/middle/codegen_fn_attrs.ts` |
| `sanitizer_settings_for` | `SanitizerFnAttrs` | `src/rustc_middle/middle/codegen_fn_attrs.ts` |
| `exported_non_generic_symbols`, `exported_generic_symbols` | the `ExportedSymbol` half | `src/rustc_middle/middle/exported_symbols.ts` |
| `hir_crate_items`, `hir_module_items` | `ModuleItems` | `src/rustc_middle/hir/mod.ts` |
| `impl_trait_header` | `ImplTraitHeader` | `src/rustc_middle/ty/mod.ts` |
| `constness` | `Constness` | `src/rustc_hir/hir.ts` |
| `asyncness` | `Asyncness` | `src/rustc_middle/ty/mod.ts` |
| `typeck_root` (what `typeck` reads) | `TypeckResults` | `src/rustc_middle/ty/typeck_results.ts` |
| `all_rust_target_features` | `Map<string, Stability>` | `src/rustc_target/target_features.ts` |
| `backend_optimization_level` (extra, for M7) | `OptLevel` | `src/rustc_session/config.ts` |
| `symbol_mangling_version` (extra, for M7) | `SymbolManglingVersion` | `src/rustc_session/config.ts` |

Debug of a value is imported only from modules `queries.gen.ts` already loads, or from lower crates. Entries from other modules
inside `rustc_middle` are type-only: `codegen_fn_attrs.ts`, `exported_symbols.ts`, `hir/mod.ts` and `typeck_results.ts`. A value
import would load them together with `queries.gen.ts` (init order). Those values stay in the report's "values without Debug".

`constness` also gains a `stable_hash_value` (the generated `stable_hash_Constness`). It runs only on the incremental path
(`hash_value_fn`), which was unported for it before.

Left `unknown`:
- **`generics_of` (`Generics`) and `reachable_non_generics` (`SymbolExportInfo`)**: typing them breaks one hand-written site
  each, in files this lane does not own:
  - `src/rustc_metadata/rmeta/decoder/cstore_impl.ts:597` builds `new KeyedMap<DefId, unknown>`; it would need `SymbolExportInfo`.
  - `src/rustc_middle/query/engine.test.ts:371` returns a fake `{ count: () => 2 }` from `generics_of`; it would need
    `as unknown as Generics`.

  **For root:** apply both one-line fixes together with these two lines in `queries.config.json` `types`, then
  `bun tools/codegen/queries.ts`. With the two lines in and no hand fixes, tsc reported exactly these two errors and nothing
  else. The two fixes themselves were not applied or tested here.

  ```json
  {"paths": ["rustc_middle::ty::Generics"], "ts": "Generics", "import": "src/rustc_middle/ty/generics.ts", "types": ["Generics"], "values": ["debug_Generics"], "debug": "debug_Generics($v, $f)", "note": "hand-written class in ty/generics.ts; generics_of value (codegen-sets-m7)"},
  {"paths": ["rustc_middle::middle::exported_symbols::SymbolExportInfo"], "ts": "SymbolExportInfo", "import": "src/rustc_middle/middle/exported_symbols.ts", "types": ["SymbolExportInfo"], "debug": null, "note": "hand-written in middle/exported_symbols.ts (no Debug in TS yet); reachable_non_generics, exported_*_symbols values (codegen-sets-m7)"},
  ```

  Then update the last test of `codegen_m7.test.ts`, which pins these two as `unknown`.
- **`entry_fn` (`EntryFnType`)**: the real type belongs in `rustc_session` config.rs:1617, which `rustc_session/config.ts` does
  not define. `rustc_passes/entry.ts` has a stand-in, but pointing `rustc_middle` at `rustc_passes` would be backwards. Map it
  once config.rs:1617 is ported.

The other 95 `unknown`s were not on the lanes' lists and are not touched.

## For cg-contract's reviewer: what `rustc_codegen_llvm` imports

`src/rustc_codegen_llvm/diagnostics.gen.ts` exports, for each of the 30 `#[derive(Diagnostic)]` types:
- the type (`interface`, or a `$`-tagged union for `LlvmError`);
- `<T>_into_diag(self, dcx, level)`;
- `<T>_diagnostic(self)`.

It also exports the types of `ParseTargetMachineConfig` and `WithLlvmError` without their impls: their `Diagnostic` impls are
manual (diagnostics.rs:24 and :141). Those two `into_diag` are the file's only fns left for a hand-written
`src/rustc_codegen_llvm/diagnostics.ts` (`coverage.ts --missing` shows 0/2). That module should `export * from "./diagnostics.gen.ts"`.

Field types: `Span`, `string` (`&str`, `String`, `&Path`), `number` (`c_uint`), `IoError`, and `Uint8Array` for `CString` /
`SmallCStr` (`LlvmError.CreateTargetMachine.triple`, `.CreateMCSubtargetInfo.triple`, `.LoadBitcode.name`). The `Uint8Array`
matches the parameter of `CString_into_diag_arg` / `SmallCStr_into_diag_arg` in `rustc_error_messages/diagnostic_impls.ts`, both
still `unported` (`to_string_lossy`). If cg-contract gives `SmallCStr` another TS type, change `codegen_llvm.typemap.json` and
regenerate.

The generated file imports only `rustc_errors`, `rustc_error_messages`, `rustc_span`, `std/fmt` and `std/io`, so it does not
depend on cg-contract's files.

## Derive-generated types: what is generated, and what is not

- **Generated:** `rustc_codegen_ssa` lib.rs's derive(Encodable/Decodable) for `CompiledModule`, `ModuleKind`, `NativeLib`,
  `SymbolExport`, `EiiLinkageImplInfo`, `EiiLinkageInfo`, `CrateInfo`, `CompiledModules`, `CodegenLintLevelSpecs`. They serve
  `serialize_rlink` / `deserialize_rlink` (`-Zno-link` / `-Zlink-only`), which lane ssa-base would port. Nothing imports
  `decodable.gen.ts` yet.

  Three field codecs are emitted as `unported` (the report lists them):
  - `Dependencies`: no codec for its `Linkage` elements;
  - `StableLevelSpec`: hand-written in `rustc_middle/lint.ts`, with no codec;
  - `CrateInfo.natvis_debugger_visualizers`: the hand-written `CrateInfo` types this `BTreeSet` as an array, and
    `DebuggerVisualizerFile` has no codec.

  The lib.rs types keep their hand-written Debug (lib.ts): upstream's derived Debug of hand types is not generated by a
  `derive_only` set.
- **Not generated: `rustc_codegen_ssa` back/write.rs (`EmitObj`, `BitcodeSection`, `ModuleConfig`, `CodegenContext`, all
  Encodable/Decodable).** No TS module defines these types yet, and a `derive_only` set needs them. Lane ssa-write should add a
  per-file set for back/write.rs when it ports the file.
- **Not generated: `rustc_codegen_llvm` debuginfo/metadata/type_map.rs `StableHash` of `UniqueTypeId` / `HiddenZst`.** The file's
  types need cg-contract's LLVM types (`&'ll DIType`), which this branch does not have. When the hand module exists, add:
  ```json
  "rustc_codegen_llvm_type_map": { "files": ["compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs"], "class": [], "hand": [], "discriminant": [], "skip": [], "derive_only": true, "derive_stable_hash": true, "stable_hash_types": ["rustc_codegen_llvm::debuginfo::metadata::type_map::UniqueTypeId", "rustc_codegen_llvm::debuginfo::metadata::type_map::unique_type_id::HiddenZst"], "typemap_extra": ["tyir.typemap.json"] }
  ```
  This was not tried. Check the module path of `HiddenZst` (an inline `mod unique_type_id`).

## Skips left in set `rustc_codegen_ssa`

Reasons are unchanged in `skip_notes`:
- `LinkingFailed`, `ProcessingDymutilFailed`, `StrippingDebugInfoFailed`: `ExitStatus` and `back::command::Command` have no TS
  type. The wave 42 link lanes need them: give `ExitStatus` a TS type (and its `into_diag_arg_using_display`) in `src/std`, then
  drop the skips.
- `IncorrectCguReuseType`: `CguReuse` (assert_module_sources.rs, incremental).
- `FeatureNotValid`, `CrossArchFeatureNote`, `FeatureNotValidHint`: hand-written (codegen-fn-attrs).
- `ThorinErrorWrapper(thorin::Error)` stays a type with an `unknown` field. Its `Diagnostic` impl is manual, and thorin is not
  vendored.

## Evidence

- `RUST_TS_REQUIRE_PROBES=1 bun test tools/codegen`: 66 pass, 0 fail (17 files, including the new `codegen_m7.test.ts`, 5 tests).
- `bun test src/rustc_codegen_ssa src/rustc_middle/query src/rustc_crate_store src/rustc_monomorphize src/rustc_query_impl`:
  229 pass, 0 fail.
- `--check` of every generator that has one: all up to date, at 98 `unknown` types for queries.
- All 66 sets of `types.sets.json` regenerated in place: no diff outside the files above.
- Regeneration from scratch: the six generated files above were deleted, and every set plus `queries.ts` was rerun. All six came
  back byte-identical.
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check --offline`: `markers ok`.
- `--sample 200 --jobs 6`, `RUST_TS_AGENT=codegen-sets-m7`:

  | Suite | Result | Run |
  |---|---|---|
  | mono-ui | 200 MATCH | `20261111-211641-codegen-sets-m7-hoxq` |
  | mir-o2 | 200 MATCH | `20261111-211803-codegen-sets-m7-u67v` |
  | check-ui | 200 MATCH | `20261111-211924-codegen-sets-m7-l5b6` |

Coverage is unchanged, since generated code carries no fn markers:
- `rustc_codegen_ssa`: 433/1091 fns; its diagnostics.rs `--missing`: 8/8.
- `rustc_codegen_llvm`: 0/820; its diagnostics.rs `--missing`: 0/2, the two manual `into_diag` above.

## `unported(...)` left

- Generated `unported_decodable` / `unported_encodable` in `rustc_codegen_ssa/decodable.gen.ts`, for the three field types above.
- Unchanged: `CString_into_diag_arg` / `SmallCStr_into_diag_arg` (not this lane's files), which `rustc_codegen_llvm` now calls.

## `// PORT:` decisions (for root to record)

1. `Box<dyn Error>` fields of a diagnostic are retyped per field to what they hold (`rust_ts::dyn_error::*`, a set-local
   `fields` override). Each gets the Box `IntoDiagArg` over that content's Display; the global `dyn Error` entry stays
   driver_impl-only.
2. `rustc_codegen_llvm` `CString` / `SmallCStr` are `Uint8Array` (set-local), as in `diagnostic_impls.ts`.
3. Query values from `rustc_middle`-internal modules that `queries.gen.ts` does not already import are type-only (no Debug),
   for init order.
4. `FailedToGetLayout`'s `LayoutError_into_diag_arg` is required lazily (`diag_args_lazy`), since ty/layout.ts is an extension
   module.
5. `rustc_target::target_features::Stability` is imported as `target_features_Stability` in `queries.gen.ts` (rustc_attr_ir has
   a `Stability`). object's `read::Error` is imported as `object_read_Error` (not shadowing the global `Error`).

## Notes

- Running `bun tools/codegen/types.ts rustc_lexer` writes an uncommitted `src/rustc_lexer/lib.gen.ts`. That was already so before
  this lane; a full regeneration should delete it afterwards.
- `bun tools/codegen/queries.ts` with any argument other than `--check` (even `--help`) rewrites the file. It was a no-op here.
