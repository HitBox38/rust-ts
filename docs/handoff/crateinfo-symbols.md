# Handoff: crateinfo-symbols (plan-m5 wave 33): the symbol fns `CrateInfo::new` calls, and `global_backend_features`

Base `adaa9d4a`, branch `lane/crateinfo-symbols`.

## Summary
- `CrateInfo::new` (codegen_ssa base.ts `CrateInfo_new`) no longer calls `unported` shims. It now uses the ported fns:
  - back/linker.rs `exported_symbols` and `linked_symbols`;
  - back/lto.rs `exported_symbols_for_lto`;
  - rustc_middle `metadata_symbol_name`.

  For a metadata-only rlib (D5) they give `{Rlib: []}`, `{Rlib: []}` and `[]`, plus the metadata symbol
  `rust_metadata_<crate>_<stable crate id:08x>`.
- `Session::global_backend_features` is no longer deferred. The LLVM stand-in's `init` now computes it as
  `LlvmCodegenBackend::init` does, through `llvm_util::global_llvm_features(sess, false)`. That fn and `to_llvm_features`,
  `llvm_features_by_flags`, `get_version`, `LLVMFeature` and `TargetFeatureFoldStrength` are ported into
  `src/rust_ts/codegen_backend.ts`. On x86_64-unknown-linux-gnu the list is empty, as on the oracle.
- The `ExportedSymbol`, `SymbolExportInfo`, `SymbolExportLevel` and `SymbolExportKind` stand-ins that driver-m5 left in
  codegen_ssa now live in their own file, `src/rustc_middle/middle/exported_symbols.ts`, with the whole file ported (3/3).
- **Where a small `--emit=metadata` crate stops: unchanged, in the encoder.** I used `pub fn add(..)` and `pub struct S`
  with `--crate-type lib --emit=metadata --target x86_64-unknown-linux-gnu` and the oracle's sysroot. The port exits 70 at
  `rustc_metadata::rmeta::encoder::encode_metadata (lanes encoder-a..d)`. The oracle exits 0 and writes a 2,370-byte
  `liblib.rmeta`. A bin crate (`fn main() {}`) stops at `rustc_metadata::rmeta::encoder::EncodedMetadata::from_path
  (lanes encoder-a..d)`.
- **The next stop after the encoder, found by calling `CrateInfo_new` directly** (linker.oracle.test.ts): any crate with
  an extern crate stops in `CrateInfo::new`'s per-crate loop. That includes std, and core plus compiler_builtins under
  `#![no_std]`. The stop is at `tcx.native_libraries(cnum)` →
  `Decodable for rustc_crate_store::NativeLib (derive(Decodable) not generated)` (rmeta/decoder.ts `decode_NativeLib`).
  So my new code runs end to end only for a `#![no_core]` crate today. For `bin`/`dylib`/`cdylib` crates,
  `for_each_exported_symbols_include_dep` will also reach `decode_ExportedSymbol_SymbolExportInfo` (decoder.ts, unported)
  for statically linked deps.

## Files
New:
- `src/rustc_middle/middle/exported_symbols.ts`: all three fns.
  - Types: `SymbolExportLevel` (`is_below_threshold`), `SymbolExportKind`, `SymbolExportInfo`, `ExportedSymbol`.
  - Fns: `ExportedSymbol::symbol_name_for_local_instance` and `metadata_symbol_name`.
- `src/rustc_codegen_ssa/back/linker.ts`: these seven fns, linker.rs:1625 to the end of `linked_symbols`:
  - `for_each_exported_symbols_include_dep`;
  - `symbol_export_from_exported_symbol` and `symbol_export_from_raw_name`;
  - `exported_symbols`, `exported_symbols_for_non_proc_macro` and `exported_symbols_for_proc_macro_crate`;
  - `linked_symbols`.

  The rest of linker.rs (the `Linker` trait, `get_linker`, ...) is M7.
- `src/rustc_codegen_ssa/back/lto.ts`: `exported_symbols_for_lto` only. The rest of lto.rs is M7.
- `src/rust_ts/codegen_backend.oracle.test.ts`: compares `sess.global_backend_features` with the oracle's LLVM IR
  `"target-features"` attribute. The test crate is `no_core` with one plain fn, so that attribute is exactly
  `global_backend_features.join(",")`. It covers the six built-in targets rust-ts has ported:
  - x86_64-unknown-linux-gnu, x86_64-apple-darwin, aarch64-apple-darwin and wasm32-wasip2: empty;
  - aarch64-unknown-linux-gnu: `+v8a,+outline-atomics`;
  - x86_64-pc-windows-msvc: `+cx16,+sse,+sse2,+sse3,+sahf`, which exercises the `cmpxchg16b`/`lahfsahf` renames.

  Passes.
- `src/rustc_codegen_ssa/back/linker.oracle.test.ts`: calls `CrateInfo_new` on a metadata-only `no_core` rlib and
  checks:
  - empty `exported_symbols`, `linked_symbols` and `exported_symbols_for_lto`;
  - empty `target_features`;
  - `metadata_symbol`, against the oracle. It comes from a dylib build of the same crate name, whose export
    version script I captured with a `-C linker=` script. Here that is `rust_metadata_cislib_…`.

  Passes.

Edited:
- `src/rustc_codegen_ssa/base.ts`:
  - ported `wants_wasm_eh` (:376), `allocator_kind_for_codegen` (:665) and `needs_allocator_shim_for_linking` (:685);
  - removed the four pending-file shims; `CrateInfo_new` imports the real fns.
- `src/rustc_codegen_ssa/back/symbol_export.ts`:
  - the local `SymbolExportLevel`/`SymbolExportInfo`/`ExportedSymbol` are gone, imported from rustc_middle;
  - added named `unported` shims for the M7 naming fns that linker.ts/lto.ts call (listed below).
- `src/rustc_codegen_ssa/lib.ts`: the local `SymbolExportKind` is gone, imported from rustc_middle.
- `src/rust_ts/codegen_backend.ts`: `init` sets `global_backend_features = global_llvm_features(sess, false)`
  instead of `defer_field`. The ported llvm_util fns are listed above.
- **Outside the assigned list (one import line, forced by the move):** `src/rustc_metadata/rmeta/encoder.ts` imports
  `ExportedSymbol`/`SymbolExportInfo` from `rustc_middle/middle/exported_symbols.ts` instead of codegen_ssa
  symbol_export.ts.

## Coverage (`bun scripts/coverage.ts --missing compiler/<file>`)
| file | before (adaa9d4a) | after |
|---|---|---|
| rustc_middle/src/middle/exported_symbols.rs | 1/3 | 3/3 |
| rustc_codegen_ssa/src/back/linker.rs | 0/218 | 7/218 |
| rustc_codegen_ssa/src/back/lto.rs | 0/8 | 1/8 |
| rustc_codegen_ssa/src/base.rs | 4/28 | 7/28 |
| rustc_codegen_ssa/src/back/symbol_export.rs | 15/29 | 15/29 |

TOTAL 22,485 → 22,498 / 25,518 fns. `coverage.ts --check`: markers ok. The llvm_util.rs fns have no markers, because
`rustc_codegen_llvm` is excluded in harness/scope.json (see PORT decisions).

## Sample difftests (`RUST_TS_AGENT=root-f5de`)
"Before" ran in a detached worktree at `adaa9d4a`; "after" ran on this branch.

| suite | before | after |
|---|---|---|
| mir --sample 300 | MATCH 297, UNPORTED 1, UNSTABLE 2, DIFF 0 (20261030-193128-root-f5de-8e7x) | MATCH 297, UNPORTED 1, UNSTABLE 2, DIFF 0 (20261030-193430-root-f5de-dp3h) |
| tydump-ui --sample 300 | MATCH 298, UNSTABLE 2, DIFF 0 (20261030-193259-root-f5de-tgep) | MATCH 298, UNSTABLE 2, DIFF 0 (20261030-193600-root-f5de-d2ym) |
| borrowck-ui --sample 300 (extra, full driver) | n/a (driver-m5: 300/300) | MATCH 300/300 (20261030-194227-root-f5de-0zot) |

The one mir UNPORTED is the same before and after: `transmute-fail.rs`, "rustc_abi::Size beyond 2^53". I added
borrowck-ui because `init` now computes `global_llvm_features` on every compilation, and that suite runs the full
driver.

Unit tests:
- `bun test src/rustc_codegen_ssa src/rust_ts src/rustc_metadata src/rustc_interface`: all pass (13 + 20 + 114 + 4);
- `bunx tsc --noEmit -p .`: clean.

No contract or stub-count test moved.

## `unported(...)` left
- back/symbol_export.ts, the M7 naming shims (named, typed as upstream). None is reached for a metadata-only rlib.
  - `allocator_shim_symbols` (:603). Reached for non-rlib crate types when `tcx.allocator_kind` is `Some`.
  - `symbol_name_for_instance_in_crate` (:654). Reached by `exported_symbols_for_lto` with `-C lto`.
  - `linking_symbol_name_for_instance_in_crate` (:755), `exporting_symbol_name_for_instance_in_crate` (:808) and
    `extend_exported_symbols` (:882). Reached for dylib, proc-macro and bin crates, and with
    `override_export_symbols`.
- rust_ts/codegen_backend.ts:
  - `LLVMGetHostCPUFeatures` (`-C target-cpu=native`);
  - `FixedX18InvalidArch` (`-Z fixed-x18` off aarch64);
  - `UnknownLlvmTargetFeaturePrefix` (only with `for_cfg`, which nothing calls: `target_config` uses the D4 table).

  `init` already stops at `non_default_llvm_input` on `-C target-cpu`, `-Z fixed-x18` and `-Z llvm-target-feature`, so
  none of the three is reachable today.
- base.ts keeps `each_linked_rlib` (`-C lto`) and `collect_debugger_visualizers_transitive` (MSVC), as before.

## PORT decisions
- `ExportedSymbol::symbol_name_for_local_instance` is a method on the companion const (`ExportedSymbol.symbol_name_for_local_instance(sym, tcx)`).
- `metadata_symbol_name`: `{:08x}` on `StableCrateId`, whose `LowerHex` forwards the formatter to the `u64`, is
  `lower_hex_StableCrateId(..).padStart(8, "0")`.
- `IndexMap`'s `formats[&crate_type]` is `Map.get` and then `panic("IndexMap: key not found")` when the key is missing.
  `deps.iter_enumerated()` walks the `Linkage[]` with the `CrateNum` as index.
- lto.rs: the `tcx.prof.generic_activity("lto_generate_symbols_below_threshold")` timers are dropped (driver-m2
  decision 8); `info!` is a comment.
- llvm_util.rs is in `rustc_codegen_llvm`, which harness/scope.json excludes, so `coverage.ts --check` would reject
  `// rustc:` markers there. Each fn has a doc line naming its llvm_util.rs fn and line instead.
  - `get_version()` (`LLVMGetVersion`) is parsed from `LLVM_VERSION`, the oracle's bundled LLVM, which
    driver.oracle.test.ts checks.
  - `SmallVec<[TargetFeatureFoldStrength; 1]>` is an array.

## For root
- `cstore_impl.ts` (rustc_metadata) still has its own local `ExportedSymbol` type (line ~455). It could import the
  rustc_middle one now; I left it because it is outside this lane.
- The next driver stops after the encoder lands are the two decoders named in the summary:
  - `Decodable for rustc_crate_store::NativeLib`, for every crate with an extern crate;
  - `Decodable for (ExportedSymbol, SymbolExportInfo)`, for linked crate types.
