APPROVE WITH NITS

# Review: tools lane `codegen-sets-m7` (M7, wave 40l)

Independent reviewer, read-only on code. Reviewed branch `t3/codegen-sets-m7` at `bf71d773` (code commit `d6a2791f`, handoff
`bf71d773`), diffed against its merge base `b3772ebb`. Pin `6f5da406b56c`.

No must-fix findings. Each `Box<dyn Error>` field type is backed by its construction site at the pin, the generated diagnostics
and codecs follow upstream's field order and attributes, nothing is guessed, and the generated files are fresh, with no hand edits.
The nits are about wording and follow-ups.

## Evidence (run by the reviewer on the lane's tree, AC power, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`)

- `bun test tools/codegen`: 66 pass, 0 fail (17 files, including `codegen_m7.test.ts`).
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (25786, ...)`.
- `--check` of every generator that has one (features, error_codes, lints, icu-data, queries, options, symbols, target-config,
  vendor-tables, gen-unicode-security, gen-unicode): all up to date. Queries: 98 `unknown` types.
- **From-scratch regeneration:** I deleted the six generated files the lane touched and reran every one of the 66 sets of
  `types.sets.json`, plus `bun tools/codegen/queries.ts`. `git status` came back clean except for the known stray
  `src/rustc_lexer/lib.gen.ts`, which already happened before this lane (handoff, Notes). I deleted it. All six files are
  byte-identical, so they have no hand edits.
- `difftest --sample 200 --jobs 6`, `RUST_TS_AGENT=review-codegen-sets-m7`:
  - mono-ui: 200 MATCH (`20261111-213105-review-codegen-sets-m7-3ch0`);
  - check-ui: 200 MATCH (`20261111-213213-review-codegen-sets-m7-f4cr`).

## 1. `Box<dyn Error>` typing (`ExtractBundledLibsError`, diagnostics.rs:623)

`ExtractBundledLibsError` is built in exactly one place in the pinned compiler: `extract_bundled_libs`, back/archive.rs:153–187.
I grepped all of `compiler/`; the only other hits are the type definition and a re-export. Each field matches its site:

| Variant | Site (archive.rs) | Error at the pin | TS type / Display |
|---|---|---|---|
| OpenFile | :162 `File::open` | `io::Error` | `IoError` / `display_IoError` |
| MmapFile | :164 `Mmap::map` (memmap.rs:20/:35, `io::Result`) | `io::Error` | `IoError` / `display_IoError` |
| ParseArchive | :167 `ArchiveFile::parse` | `object::read::Error` | `object_read_Error` / object `display_Error` |
| ReadEntry | :171 `members()` item | `object::read::Error` | same |
| ArchiveMember | :174 `ArchiveMember::data` | `object::read::Error` | same |
| ConvertName | :176 `std::str::from_utf8` | `Utf8Error` | `Utf8Error.toString` |
| ExtractSection | :181 `Box::<dyn Error>::from(String)` (`search_for_section` → `Result<_, String>`, metadata.rs:112) | `StringError` | the string |
| WriteFile | :184 `std::fs::write` | `io::Error` | `IoError` / `display_IoError` |

How the Display text compares with upstream:
- `rustc_codegen_ssa` uses object `=0.39.1` (Cargo.toml:52), the version vendored per `harness/scope.json`. Upstream's
  `impl Display for read::Error` writes the message string as-is (read/mod.rs:122), and `display_Error` returns `self._0`.
- `Utf8Error.toString` (src/std/str.ts:352) prints both of core's messages (str/error.rs:112): `invalid utf-8 sequence of {n}
  bytes from index {i}` and `incomplete utf-8 byte sequence from index {i}`.
- `StringError`'s Display is the inner string's Display, so `(s) => s` matches.
- Each arm wraps the Display in `into_diag_arg_using_display`. That is the same `DiagArgValue::Str(to_string())` the
  `Box<dyn std::error::Error>` impl makes (diagnostic_impls.rs:71).

**The driver-cli-2 io-error entry is not reachable from `rustc_codegen_ssa`.** I confirmed this by experiment. I took the eight
`fields` overrides out of `codegen_ssa.typemap.json` and regenerated the set into the scratchpad, then restored the file. All eight
fields became `unknown /* dyn std :: error :: Error */` with `unported_into_diag_arg`, and the report gave
`missing IntoDiagArg for Box < dyn std :: error :: Error >`. It did not fall back to `display_IoError`. The global Box entry
matches only on `arg0 === "dyn Error"` (types.ts:3275), and this crate spells it `dyn std::error::Error`. The driver's `dyn Error`
type entry is set-local (driver_impl.typemap.json). No other `Box<dyn ...>` field exists in the files of the three new or changed
`rustc_codegen_ssa` / `rustc_codegen_llvm` sets.

## 2. Generated diagnostics and codecs

**`rustc_codegen_llvm` diagnostics.rs: all 30 derives checked against upstream, 6 in detail.**
- `SymbolAlreadyDefined`: the `symbol_name` arg, then `span` last, as the derive puts args before `#[primary_span]`.
- `AutoDiffComponentMissing`: `#[note]` in the preamble, before the arg.
- `LlvmError`: all 10 variants in order, with the 4 unit variants as frozen singletons. `SmallCStr` / `CString` /
  `io::Error` go through the right impls. The two C-string impls stop cleanly with `unported` (diagnostic_impls.ts:126/131), and
  their `Uint8Array` parameter matches the typemap.
- `FromLlvmOptimizationDiag` and `LlvmVersionMismatch`: `c_uint` → `number_into_diag_arg`, the same as upstream's `u32` impl.
- `IntrinsicSignatureMismatch`: three args, then `span`, although `span` is declared last.
- `PackedStackBackchainNeedsSoftfloat`: the note text matches byte for byte.

All `rustc-type` line numbers I checked (11, 19, 21, 42, 49, 115, 138, 176, 240, 276) match the struct or enum line at the pin.
`ParseTargetMachineConfig` and `WithLlvmError` get only their types, which is correct: their `Diagnostic` impls are manual
(diagnostics.rs:23 and :140).

**`rustc_codegen_ssa`:**
- `LinkerOutput` (link.rs:1028) is right, including its doc comment.
- `FailedToGetLayout` (diagnostics.rs:1107) sets `ty`, then `err` (lazy `LayoutError_into_diag_arg`, ty/layout.ts:502), then
  `span`.
- `InvalidMonomorphization::ReturnNumVecsInputType` (:840) types `NumScalableVectors` from rustc_abi and keeps
  `code = E0511`. Its `NumScalableVectors_into_diag_arg` matches rustc_abi lib.rs:1823.

**rlink codecs (`decodable.gen.ts`, lib.rs derives at :121/:156/:212/:234/:255/:261/:277/:325/:417):**
- Every struct's fields are in declaration order. `CrateInfo`'s 23 fields match lib.rs:278–302 one for one.
- `ModuleKind` uses a `read_u8` tag 0..2.
- The class constructors (`SymbolExport`, `CompiledModules`, `CodegenLintLevelSpecs`) take their arguments in the field order of
  the hand-written lib.ts.
- `UnordMap` is decoded as `HashMap`, which matches upstream: `UnordMap` is `Encodable_NoContext` over its single `inner` field
  (unord.rs:253).

**The three `unported` field codecs stop cleanly.** Each is a call to `unported_decodable` / `unported_encodable`, which exits 70,
placed at that field's position in the object literal or argument list. Decoding therefore stops exactly at the field, with no
default value invented. The three are `dependency_formats`, `natvis_debugger_visualizers` and both `StableLevelSpec`s.

**`CrateSource` codecs (cstore.gen.ts):** four `Option<PathBuf>` fields in declaration order (cstore.rs:24–29), through the
constructor.

**Nothing is guessed.** Every new typemap or diag_args entry points at an upstream impl or a hand-written TS item that exists.

## 3. Query types

The query list is in `compiler/rustc_middle/src/queries.rs` at the pin (not `query/mod.rs`). I checked all 16 resolved values
there, and each matches:
- `collect_and_partition_mono_items` :2477
- `codegen_unit` :2486
- `items_of_instance` :2797
- `symbol_name` :1458
- `codegen_fn_attrs` :1558
- `sanitizer_settings_for` :2823
- `exported_{non_,}generic_symbols` :2458/:2471 (first tuple half only)
- `hir_{crate,module}_items` :246/:256
- `impl_trait_header` :1125
- `constness` :979
- `asyncness` :985
- `typeck_root` :1252
- `all_rust_target_features` :2681
- `backend_optimization_level` :2490
- `symbol_mangling_version` :1890

The `generics_of` (:433), `reachable_non_generics` (:1944) and `entry_fn` (:2044) types the handoff gives are correct, as are its
reasons for leaving them `unknown`.

**What changes at run time.** The typing itself is erased, so only two runtime things change:
- 7 `debug_value` closures go from `undefined` to a Debug fn. `debug_value` is read only by `format_value`
  (query_vtables.ts:107), which is used in ICE and inconsistency messages (execution.ts:256 ff., calls.ts:215 ff.). An `unported`
  stop on an error path becomes real text there.
- `constness` (a `feedable` query) gains `stable_hash_value = stable_hash_Constness`, which matches hir.rs:4432–4436
  (`Const { always }`, `NotConst`). Upstream hashes the value when a feed meets an already-cached value (`query_feed`,
  `check_feedable_consistency`), and the TS port does the same. That path used to stop with `unported` and now hashes as upstream.

Neither change can alter a successful compilation's output. The samples above (and the lane's mir-o2 sample) show no change.

**The two follow-up fixes: verified, and root should apply them.** I applied the two `queries.config.json` lines from the
handoff and regenerated, then restored everything.
- tsc reported exactly the two errors predicted: cstore_impl.ts(597) and engine.test.ts(371).
- With `new KeyedMap<DefId, SymbolExportInfo>(DefId_hash_key)` (cstore_impl.ts:598, where `SymbolExportInfo` is already
  imported at :34) and `return { count: () => 2 } as unknown as Generics;` plus `import type { Generics } from "../ty/generics.ts"`
  in engine.test.ts, tsc is clean and `bun test src/rustc_middle/query/engine.test.ts` gives 12 pass, 0 fail.
- `unknown` types go from 98 to 96. `exported_*_symbols` also become `[ExportedSymbol, SymbolExportInfo]`.
- Both fixes change only types. The one runtime change is a new `debug_value` for `generics_of` (`debug_Generics`), again used
  only by `format_value`. `ty/generics.ts` was already a value import of `queries.gen.ts`, so no module is loaded at a new time.
- Root should apply them in a small follow-up. It touches files of other lanes (`cstore_impl.ts`, `engine.test.ts`), so it is root
  work, and the last test of `codegen_m7.test.ts` (lines 140–143) must be updated in the same change.

## Nits

- **N1 — the handoff's init-order claim is wrong for `mono.ts`.** It says: "Debug of a value is imported only from modules
  `queries.gen.ts` already loads". But at the merge base, `queries.gen.ts` imported only the type `CollectionMode` from `./mono.ts`
  (line 37). The lane makes it a value import (`debug_CodegenUnit`, `debug_MonoItem`, `debug_NormalizationErrorInMono`), along
  with `debug_OptLevel` / `debug_SymbolManglingVersion` from `rustc_session/config.ts`. A static closure of value imports adds 17
  modules: `rustc_middle/mono.ts`, `mono_stable_hash.gen.ts`, `rustc_data_structures/base_n.ts`, `rustc_session/config*.ts`,
  `options*.ts`, `filesearch.ts`, `search_paths.ts`, `stand_ins.ts`, `rust_ts/target_config.gen.ts` and `vendor/getopts`.
  This does no harm:
  - neither `mono.ts` nor `rustc_session/config.ts` reaches `queries.gen.ts` again, so there is no new cycle;
  - `queries.gen.ts`, `mono.ts`, `rustc_middle/lib.ts`, `rustc_monomorphize/lib.ts`, `rustc_query_impl/lib.ts`,
    `rustc_interface/lib.ts` and all five other generated files each load standalone without a TDZ error.

  The reverse also holds: `middle/codegen_fn_attrs.ts` and `ty/typeck_results.ts` were already in the value closure at the merge
  base. So the "type-only, for init order" reason given for them (handoff PORT decision 3, the queries.config.json notes) does not
  apply to those two. It does apply to `hir/mod.ts` and `exported_symbols.ts`. Root should record decision 3 with that
  correction.
- **N2 — `display_Error` is imported without an alias.** In `src/rustc_codegen_ssa/diagnostics.gen.ts:16`, object's
  `display_Error` comes in under its own name, while its type comes in as `object_read_Error` (diag_args.json, the
  `rust_ts::dyn_error::ObjectRead` entry). A later diag_args entry importing another crate's `display_Error` into the same set
  would clash. Aliasing it as `display_object_read_Error` would match the type's treatment.
- **N3 — `Utf8Error` is a value import used only as a type.** The `rust_ts::dyn_error::Utf8` diag_args entry imports it as a
  value, so the generated `import { Utf8Error } from "../std/str.ts"` (diagnostics.gen.ts:15) is used only in a type annotation.
  It is harmless, since std/str.ts is always loaded. A `type` import would be tidier.
- **N4 — `Linkage` has an upstream derive, so `Dependencies` could get a codec.** The handoff says `Dependencies` has "no codec
  for its `Linkage` elements". But `Linkage` derives `Encodable, Decodable` at the pin (rustc_middle
  middle/dependency_format.rs:24), so adding it to the `rustc_middle` set's `decodable_types` and serialize.json would make
  `dependency_formats` generatable. Leaving it `unported` is correct for now; this is a pointer for lane ssa-base.
- **N5 — the brief's path for the query list is stale.** It cites `rustc_middle/src/query/mod.rs` for the query list, but at
  this pin it is `rustc_middle/src/queries.rs`. This concerns the brief, not the lane.
