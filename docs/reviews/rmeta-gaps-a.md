verdict: APPROVE-WITH-NOTES

Reviewer: independent read-only review of lane `rmeta-gaps-a`, own commits after merge 8f1e2eb8
(ca945b57, c85e4203), against upstream at the pin (`.data/rust`).

## What was checked

- **Generated codecs vs upstream derives**:
  - `NativeLib` (cstore.rs:69): fields kind, name, cfg, foreign_module, verbatim, dll_imports.
  - `DllImport` (cstore.rs:89): name, import_name_type, calling_convention, span, symbol_type, size. `Size` is encoded
    as the `u64` `raw` of `derive(Encodable_NoContext)` (lib.rs:865), through the existing serialize.json entry.
  - `DllImportSymbolType` (:104): Function/Static/ThreadLocal.
  - `DllCallingConvention` (:130): C/Stdcall(usize)/Fastcall(usize)/Vectorcall(usize).
  - `ForeignModule` (:138): foreign_items, def_id, abi.
  - `ExternAbi` (extern_abi.rs:20): 30 variants, u8 tag, `unwind` on C, System, Aapcs, Cdecl, Stdcall, Fastcall,
    Thiscall, Vectorcall, SysV64 and Win64.
  - `abstract_const::CastKind` (:13): As/Use.

  Field order, variant order, field codecs and the derive markers' line numbers all match. JS evaluates constructor
  arguments left to right, so decoding reads the fields in declaration order.
- **NativeLibKind replacement**:
  - `NativeLib::has_modifiers` (utils.rs:31) is now `verbatim.is_some() || kind.has_modifiers()`, as upstream; the
    marker is correct.
  - `hash_NativeLibKind` follows `derive(Hash)`: an `isize` discriminant in declaration order (Static=0 .. Unspecified=6,
    native_lib_kind.rs:6), then each field as `Option<bool>` through the file's existing `hash_Option` (isize 0/1).
  - `hash_NativeLib` (utils.rs:23) hashes its fields in order: name, new_name, kind, verbatim.
  - native_libs.ts only drops the cast; its logic is unchanged.
- **encoder.ts byte identity**: the generated `encode_ExternAbi` has the same tag order as the removed
  `EXTERN_ABI_VARIANTS` table and writes `unwind` for the same variants. The generated `encode_ForeignModule` calls
  `encode_def_id`, which is what the removed hand version's `encode_DefId` did. `encode_native_libraries` and
  `encode_foreign_modules` (encoder.rs:2024/:2030) are unchanged apart from the element encoder.
- **Lazy wrappers in ty/codec.ts**: they delegate to `mir_mod_().decode_BinOp/encode_BinOp/decode_UnOp/encode_UnOp`
  (mir/syntax.gen.ts) and to rustc_middle/decodable.gen.ts's `decode_CastKind`/`encode_CastKind`. kind.gen.ts already
  imported codec.ts, so this adds no new static import edge. The init-order reason is sound.
- **type_fold.test.ts pin**: the −3 entries (`mir::BinOp`, `mir::UnOp`, `abstract_const::CastKind`) are exactly the
  three types that gained serialize.json entries. This is the codegen report changing, not tampering, and the test
  passes.
- **Generator (general, not only the fixed cases)**: no generator code changed, only config (types.sets.json,
  typemap.hir.json, serialize.json).
  - The global typemap entries for `rustc_attr_ir::CfgEntry` (a re-export of rustc_ast's, data_structures.rs:7),
    `PeImportNameType` (data_structures.rs:336) and `rustc_abi::Size` now name real types.
  - I regenerated **every** set in types.sets.json except rustc_lexer in a scratch worktree, and `git status` came back
    clean. The checked-in generated files are therefore reproducible, and the global typemap change does not silently
    alter any other set's output.
- **harness/ scripts/ baselines**: untouched (diffstat has only src/, tools/codegen config and test, and the handoff).
- **Verification I ran** (scratch worktree at lane HEAD c85e4203, since removed):
  - `bunx tsc --noEmit -p .`: exit 0, no output.
  - `bun scripts/coverage.ts --check`: markers ok (23153; vendor 4680).
  - `bun test` on rmeta_gaps_a.test.ts and tools/codegen/type_fold.test.ts: 9 pass, 0 fail.
  - Difftests, `RUST_TS_AGENT=rev-rga`, `--sample 30` each:

    | suite | result | run |
    |---|---|---|
    | check-ui | 29 MATCH, 1 UNPORTED | 20261030-215741-rev-rga-r7do |
    | rmeta-ui | 29 MATCH, 1 UNPORTED | |
    | borrowck-ui | 30/30 MATCH | |
    | thirdump-ui | 30/30 MATCH | |

    The check-ui UNPORTED is `std::collections::HashMap Encodable iteration order ...` (the DefIdMap stop that
    rmeta-fxmap fixed separately), as the handoff says.

  No DIFF or CRASH anywhere. The lane's claimed numbers (check-ui 694/730, rmeta-ui 96/100) are plausible.

## Findings

1. `src/rustc_middle/ty/codec.ts:701` and `:705`, non-blocking. `decode_abstract_const_CastKind` and
   `encode_abstract_const_CastKind` call `require("../decodable.gen.ts")` inline on every call. The file already has
   the memoized lazy accessor `decodable_()` (codec.ts:85, with a perf-intern memo note) for the same module. The
   wrappers should use `decodable_()` to stay consistent and avoid repeated `require` resolution on a per-const-expr
   path.
2. `tools/codegen/mir.typemap.json:6` and `:18`, non-blocking (file not in the lane). The note says `rustc_abi::Size`
   is an `unknown` placeholder in typemap.hir.json, which this lane made false. The mir-local `Size` override is now
   redundant with the new global entry. Clean it up as a follow-up so the two entries can't drift.
3. `src/rustc_metadata/rmeta/rmeta_gaps_a.test.ts`, non-blocking. The new test round-trips through the port's own
   encoder and decoder, so it checks self-consistency, not the oracle.
   - Oracle evidence comes from the rmeta-ui/check-ui suites, which mostly exercise plain `#[link]` blocks.
     `DllImport` is only non-empty for `raw-dylib`, and none of the 30 sampled check-ui cases exercises it.
   - Its field order and codecs check out by reading cstore.rs:89, so I accept it. An oracle rmeta case with
     `kind = "raw-dylib"` (and `cfg`) would be worth adding when one becomes reachable.
4. `src/rustc_session/config.ts:3818`, non-blocking (informational). `hash_NativeLibKind` is a hand-written
   `derive(Hash)`. PORTING §5 says such derives come from tools/codegen, but config.ts already hand-writes its
   DepTrackingHash helpers under the documented convention at config.ts:3640, and this one is correct. Fold it into
   codegen whenever the `Hash` derive generator lands.
5. `src/rustc_metadata/rmeta/decoder.ts:1803`, non-blocking (the lane reported it itself). The `decode_DocLinkResMap`
   unported message ("derive(Decodable) of Res / Namespace not generated") is stale, because `decode_Res` and
   `decode_Namespace` exist now. The stop itself is legitimate (rustdoc-only path); only the text is wrong.
