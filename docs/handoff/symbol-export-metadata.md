# Handoff: symbol-export-metadata (wave 33 follow-up)

Branch `lane/symbol-export-metadata`, made from main `e8ac0b8e` with **`integ-w33` merged in** (merge commit
`2888921d`), so it builds on the full encoder.

## Summary
- `compiler/rustc_codegen_ssa/src/back/symbol_export.rs` is fully ported: **15/29 → 29/29**. There are no
  `unported` calls left in the file.
  - The two codegen helpers:
    - `reachable_non_generics_helper` (:64);
    - `exported_non_generic_symbols_helper` (:196).
  - The body of `exported_generic_symbols_provider_local` after its `should_codegen` exit (the mono-item loop).
  - The five naming stubs that crateinfo-symbols left:
    - `allocator_shim_symbols`;
    - `symbol_name_for_instance_in_crate`;
    - `linking_symbol_name_for_instance_in_crate`;
    - `exporting_symbol_name_for_instance_in_crate`;
    - `extend_exported_symbols`.
  - Everything else in the file: `symbol_export_level`, `calling_convention_for_symbol`, `strip_numeric_suffix`,
    `coff_machine_for_arch`, `undecorate_coff_symbol`, `maybe_emutls_symbol_name` and `escape_symbol_name`.
- `allocator_shim_contents` (base.rs:695) is ported in `rustc_codegen_ssa/base.ts`. `allocator_shim_symbols` calls it.
  base.rs coverage: 7/28 → 8/28.
- D5 holds. The providers keep both `should_codegen()` branches. On `--emit=metadata` they still return `[]` / an empty
  map before reaching the helpers, so the M5 path is unchanged (see the samples below).
- **refine_rpitit:** its stop moved on and is re-pinned (see below).

## Files touched
- `src/rustc_codegen_ssa/back/symbol_export.ts`: the port, plus a block of local helpers at the end of the file:
  - `to_sorted_by_def_path_hash` and `sort_by_cached_symbol_name`;
  - `set_insert`, `iter_next`, `next_multiple_of`, `parse_u32_is_ok` and `rsplit_once`;
  - `assert_first_non_erasable_is_type` and `is_const_always`;
  - the `pe` constants.
- `src/rustc_codegen_ssa/base.ts`: `allocator_shim_contents` and the header comment.
- **New** `src/rustc_codegen_ssa/back/symbol_export.oracle.test.ts`. It builds a `#![no_core]` crate with:
  - `pub` and private fns, an inherent method and a trait-impl method;
  - an unexported default trait method, `#[inline]`, generic and `const` fns;
  - a `#[no_mangle] extern "C"` fn, a `#[no_mangle]` static, a Rust static and a nested module.

  It compares the port's `exported_non_generic_symbols(LOCAL_CRATE)` with the oracle's linker version script. The
  names go through `exporting_symbol_name_for_instance_in_crate` and are filtered by the export threshold. Results:
  - `dylib`: the 9 v0-mangled names, which also checks the `Rust`-level export;
  - `cdylib`: `C_STATIC` and `c_fn` only.

  Passes.
- **Outside my crate, as the pinned-test rule requires:** `src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts`.
  `PENDING.refine_rpitit` is re-pinned, and its doc comment is extended.

## refine_rpitit
- **Old stop:** `rustc_codegen_ssa::back::symbol_export::exported_non_generic_symbols_helper (codegen; M7)`.
- **New stop:** `rustc_middle::middle::exported_symbols: Encodable for (ExportedSymbol, SymbolExportInfo) (codegen, M7)`.
  That is the encoder's element encoder `encode_ExportedSymbol_SymbolExportInfo`, in encoder.ts, which
  `encode_exported_symbols` calls. The helper now returns `<S as Tr>::f`.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts`: 43 pass, 0 fail.

## Coverage
| file | before | after |
|---|---|---|
| rustc_codegen_ssa/src/back/symbol_export.rs | 15/29 | 29/29 |
| rustc_codegen_ssa/src/base.rs | 7/28 | 8/28 |

- TOTAL: 22,574 → 22,589 / 25,518.
- `coverage.ts --check`: markers ok.

## Sample difftests (`RUST_TS_AGENT=root-f5de`)
"Before" ran in a detached worktree at `2888921d`; "after" ran on this branch. The per-case jsonl files are identical:
0 differing lines in each suite.

| suite | before | after |
|---|---|---|
| check-ui --sample 100 | MATCH 1, UNPORTED 99 (20261030-205651-root-f5de-rh0o) | same (20261030-210158-root-f5de-cx1x) |
| mir --sample 300 | MATCH 297, UNPORTED 1, UNSTABLE 2 (20261030-205737-root-f5de-zbw2) | same (20261030-210235-root-f5de-atvl) |
| borrowck-ui --sample 300 | MATCH 300 (20261030-205948-root-f5de-d6vr) | same (20261030-210429-root-f5de-4pbr) |

check-ui's stops (93 of the 100 are the NativeLib decoder) are untouched. Those cases are `--emit=metadata`, so the new
code does not run there.

## Unit tests
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_codegen_ssa src/rustc_metadata`: 141 pass, 0 fail.

## `unported(...)` left
- None in my files.
- `exported_generic_symbols_provider_local` calls `tcx.collect_and_partition_mono_items(())`. That query has no
  provider: rustc_monomorphize is not ported (M7). For an rlib or dylib built with codegen, it therefore stops at
  `collect_and_partition_mono_items provider (not ported)` (`install_unported_providers`).

## PORT decisions
- **`UnordMap::to_sorted(hcx, true)` over `DefId` keys** sorts by `DefPathHash`. This is the same as rustc_hir_typeck
  writeback.ts and rustc_resolve diagnostics.ts.
- **`reachable_set(()).items()`** iterates the `Set`. Its order is never observed: the `UnordMap` is read only through
  `get` / `to_sorted`.
- **`sort_by_cached_key`**:
  - keys are computed once, in order;
  - the sort is stable (the index tie-break makes Rust's sort stable);
  - `SymbolName` is compared with `str_cmp`.
- **The `debug!` in `reachable_non_generics_helper`** is a comment, so `tcx.symbol_name` is not called there.
- **`MonoItemPartitions` / `CodegenUnit` are not ported.** The query value is read through a structural type
  (`codegen_units`, `items()`, `linkage` / `visibility`), as base.ts already does for `all_mono_items`.
- **`tcx.sess.tls_model()` is `tcx.sess.early_sess.tls_model()`.** `Session` derefs to `EarlySession`, and session.ts
  forwards `relocation_model` / `code_model` but not `tls_model`. Root could add the forward to session.ts.
- **`object::pe::IMAGE_FILE_MACHINE_{I386,AMD64,ARM64EC}`** are local constants (`0x014c`, `0x8664`, `0xa641`), copied
  from object-0.39.1 `src/pe.rs`. The `object` crate is not vendored.
- **`assert_eq!(args.non_erasable_generics().next(), Some(GenericArgKind::Type(ty)))`** compares by kind and `===` on
  the `Ty`. The panic message omits the left/right values, because there is no Debug for `Option<GenericArgKind>` here.
- **`linking_symbol_name_for_instance_in_crate`**: the `u64` argument byte sum is a `number`, since it stays far below
  2^53.
- **`str::parse::<u32>().is_ok()`** accepts an optional `+` followed by ASCII digits whose value is at most `u32::MAX`.
- **`impl Iterator` returns** (`allocator_shim_symbols`) are arrays, because every caller consumes them fully.

## For root
- **The next refine_rpitit stop, and the stop for any codegen'd crate with exported symbols:**
  - **Encode side:** encoder.ts `encode_ExportedSymbol_SymbolExportInfo`, the hand-written encoder of
    `(ExportedSymbol, SymbolExportInfo)`.
  - **Decode side:** `decode_ExportedSymbol_SymbolExportInfo` in decoder.ts.
  - **Both** are owned by the encoder/decoder lanes. rmeta-gaps-a is editing encoder.ts hand encoders now, so I did
    not touch them.
  - `ExportedSymbol` needs the `TyEncodable` shape: a variant tag, then `DefId`, `GenericArgsRef`, `Ty` or
    `SymbolName` as a `str`.
- **After that stop,** a codegen'd rlib reaches `collect_and_partition_mono_items` (rustc_monomorphize, M7) through
  `exported_generic_symbols`.
- **Optional:** add a `tls_model()` forward to `Session` (rustc_session/session.ts).
- linker.ts / lto.ts need no change. The functions they import from symbol_export.ts keep their names and types;
  `allocator_shim_symbols` now returns an array.
