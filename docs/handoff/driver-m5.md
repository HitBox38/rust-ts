# Handoff: driver-m5 (wave 30/31): the metadata-only driver path (plan-m5 D5, D7)

Base `644cc1e0`, branch `lane/driver-m5`.

## Summary
- `rust-ts` now goes past `analysis` the way rustc does: `run_compiler` → `Linker::codegen_and_build_linker` →
  `start_codegen` → the backend's `link` → `link_binary`. `should_codegen()` stays false for `--emit=metadata` (D5):
  no `optimized_mir` encoding, mangling or mono.
- **Where a metadata check stops now.** `--crate-type lib --emit=metadata` on a small lib crate
  (`pub fn add(..)`, `pub struct S`) with the oracle's sysroot and `--target x86_64-unknown-linux-gnu` exits 70 at
  `rustc_metadata::fs::encode_and_write_metadata (metadata encoding; plan-m5 waves 32-33)`. That is the pending-lane
  shim `rustc_metadata_fs_encode_and_write_metadata` (src/rustc_interface/passes.ts, end of file), called from
  `start_codegen` (passes.ts:1379) ← `Linker.codegen_and_build_linker` (queries.ts:29) ← `run_compiler`
  (rustc_driver_impl/lib.ts:322). The oracle exits 0 with no stderr and a 2,365-byte rmeta. Before this lane the same
  run stopped one step earlier, at `rustc_interface::queue::Linker::codegen_and_build_linker (analysis, codegen; M3+)`.
- **Crates with errors now match end to end.** `start_codegen` raises the fatal error before it encodes anything, so
  an erroring crate gives the oracle's stderr and exit code. Checked against the oracle (stderr byte-identical, exit 1):
  `pub fn f() -> u32 { "x" }` as `--crate-type lib --emit=metadata`, as `-Zcodegen-backend=dummy`, and as
  `--crate-type bin --emit=metadata`. Before this lane these exited 70 at the Linker.
- `-Zcodegen-backend=dummy` now runs upstream's `DummyCodegenBackend`. It used to be `unported`.

## Files
New:
- `src/rustc_interface/queries.ts`: `Linker` (`codegen_and_build_linker`, `link`). With no `-C incremental` (D3),
  the `rustc_incremental` calls in `link` return at once, as upstream's do (`save_work_product_index` and
  `finalize_session_directory`, including the latter's assert, are local stand-ins). With incremental they are
  `unported`.
- `src/rust_ts/codegen_backend.ts`: the D7 stand-in. `LlvmCodegenBackend` (moved here from
  rustc_interface/stand_ins.ts, with `non_default_llvm_input` and `LLVM_VERSION`) gives LLVM's metadata-level
  answers:
  - `init` and `target_config`, as before: the oracle table `target_config.gen.ts`, decision D4;
  - `supported_crate_types`: the trait default, which LLVM does not override;
  - `target_cpu`: `llvm_util::target_cpu`, i.e. `-C target-cpu` or `target.cpu`; `native` is unported;
  - `link`: codegen_ssa `link_binary`, as `LlvmCodegenBackend::link` does.

  `codegen_crate`, `join_codegen`, `print_passes`, `print_pass_timings` and `print_statistics{,_json}` are `unported`.
- `src/rustc_codegen_ssa/base.ts`: `collect_eii_linkage`, `eii_linkage_needed`, `CrateInfo::new` (as
  `CrateInfo_new`, see PORT decisions) and `provide` (`backend_optimization_level`).
- `src/rustc_codegen_ssa/back/link.ts`:
  - `ensure_removed`, `eii_impl_crate_name` and `check_externally_implementable_item_linkage`;
  - `link_binary`: the whole loop. Its `should_link()` branch calls `out_filename`, which checks the file is
    writeable, then `unported` (linking, M7). The remove-temps step is ported up to `preserve_objects_for_their_debuginfo`
    (`unported`, reached only when linking);
  - `are_upstream_rust_objects_already_included`.
- `src/rustc_codegen_ssa/back/symbol_export.ts`:
  - the thresholds;
  - every provider in `provide`. The local `reachable_non_generics` / `exported_{non_,}generic_symbols` providers
    return empty sets when `!should_codegen()`. Their codegen helpers are `unported`;
  - `upstream_monomorphizations{,_for}`, `upstream_{async_,}drop_glue_for`, `is_reachable_non_generic` (local and
    extern), `is_unreachable_local_definition` and `wasm_import_module_map`, all ported fully.

Edited:
- `src/rustc_codegen_ssa/lib.ts`:
  - `CompiledModule`, `ModuleKind`, `CompiledModules` (a class, so that the `downcast` is an `instanceof`);
  - `NativeLib` with its `From<&cstore::NativeLib>` (`NativeLib_from`), and `SymbolExport` (`new`, `with_link_name`);
  - `EiiLinkageImplInfo`, `EiiLinkageInfo`, `CrateInfo`, and `CodegenLintLevelSpecs` (`from_tcx`);
  - `provide` now also installs `symbol_export::provide` and `base::provide`, in upstream order.
- `src/rustc_interface/passes.ts`: `start_codegen` (passes.rs:1295), plus the pending-lane shim for
  `encode_and_write_metadata`.
- `src/rustc_interface/util.ts`: `DummyCodegenBackend`, ported verbatim (D7). `get_codegen_backend`'s `"dummy"` arm
  now builds it. The LLVM stand-in is imported from rust_ts/codegen_backend.ts.
- `src/rustc_interface/stand_ins.ts`: the `CodegenBackend` interface now has every method the driver calls
  (`target_cpu`, `codegen_crate`, `join_codegen`, `print_pass_timings`, `print_statistics{,_json}`, `link`), plus:
  - `CodegenBackend_provided`: the trait's provided methods, with markers on traits/backend.rs;
  - opaque `ArArchiveBuilderBuilder`;
  - stand-in types `EncodedMetadata` (`path()`), `IncrCompSession` (never constructed) and `WorkProductMap`.
- `src/rustc_interface/lib.ts`: `export { Linker }`.
- **Outside the assigned list (wiring, needed for the check above):**
  - `src/rustc_driver_impl/lib.ts` `run_compiler`: `Linker.codegen_and_build_linker`, the `-Zmetrics-dir` branch
    (`dump_feature_usage_metrics`, `unported`), `tcx.report_unused_features()` and `linker.link(..)`. These
    replace the two old `unported` calls.
  - `src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts`: the `refine_rpitit` PENDING stop is re-pinned
    to the new stop string; the brief's "update a pinned test by the delta" rule. The file passes, 43/43.

## Coverage (`bun scripts/coverage.ts --missing compiler/<file>`)
| file | before | after |
|---|---|---|
| rustc_interface/src/queries.rs | 0/2 | 2/2 |
| rustc_interface/src/passes.rs | 27/29 | 28/29 (left: `print_macro_stats`) |
| rustc_interface/src/util.rs | 9/21 | 16/21 (left: `load_backend_from_dylib`, the `DummyArchiveBuilderBuilder` methods, `rustc_path`, `get_codegen_sysroot`) |
| rustc_codegen_ssa/src/base.rs | 0/28 | 4/28 |
| rustc_codegen_ssa/src/back/link.rs | 0/87 | 5/87 |
| rustc_codegen_ssa/src/back/symbol_export.rs | 0/29 | 15/29, counting the `is_below_threshold` marker of middle/exported_symbols.rs |
| rustc_codegen_ssa/src/lib.rs | 1/11 | 5/11 |
| rustc_codegen_ssa/src/traits/backend.rs | 2/20 | 10/20 |

Total 22,219 → 22,266 / 25,518 fns. `coverage.ts --check`: markers ok.

## Sample difftests (`RUST_TS_AGENT=root-f5de`)
"Before" ran in a detached worktree at `644cc1e0`; "after" ran on this branch.

| suite | before | after |
|---|---|---|
| mir --sample 300 | MATCH 290, UNPORTED 8, UNSTABLE 2, DIFF 0 (run 20261029-103033-root-f5de-w2xi) | MATCH 290, UNPORTED 8, UNSTABLE 2, DIFF 0 (20261029-104745-root-f5de-citt); same 8 unported reasons |
| tydump-ui --sample 300 | MATCH 297, UNPORTED 1, UNSTABLE 2, DIFF 0 (20261029-103132-root-f5de-s6gh) | MATCH 297, UNPORTED 1, UNSTABLE 2, DIFF 0 (20261029-104922-root-f5de-bw4w) |
| mir-minicore (full, 46) | MATCH 46 (20261029-103232-root-f5de-1ch0) | MATCH 46 (20261029-105103-root-f5de-iij7) |
| borrowck-ui --sample 300, extra | MATCH 300/300 (20261029-105218-root-f5de-wei3) | MATCH 300/300 (20261029-105117-root-f5de-5aqj) |

borrowck-ui was not asked for. I added it because it is the one suite family that runs the full driver; its subject
stops at `after_analysis`, so the new code is never reached there either.

Which protected suites can reach the new code at all? None that I found: the `-Zunpretty` suites return before
analysis, and the probe suites have their own stops. So behaviour on the protected set can change only through
the newly installed **query providers**: symbol_export.rs (`upstream_monomorphizations*`,
`reachable_non_generics`, ...) and base.rs `backend_optimization_level`. Before, these were
`unported("<q> provider (not ported)")`. Now they run upstream's logic, which bottoms out in `unported` (the
`ExportedSymbol` decoder, the codegen helpers) or in real answers (empty sets when `!should_codegen()`).

Unit tests:
- `bun test src/rustc_interface src/rustc_codegen_ssa src/rustc_driver_impl`: 202/203 pass. The one failure was a
  5 s timeout in print.oracle.test.ts at load average ~70; that file alone passes, 134/134.
- compare_impl_item.oracle.test.ts: 43/43. `bunx tsc --noEmit -p .`: clean.

## `unported(...)` left (all on paths `--emit=metadata` does not reach, or after the encoder stop)
- passes.ts:
  - `rustc_metadata::fs::encode_and_write_metadata`: **the stop**. Lane metadata-deps then the encoder lanes;
  - `write_host_metadata_offload_manifest` (`-Zoffload=HostMetadata`);
  - `CodeStats::print_type_sizes` (`-Zprint-type-sizes`).
- queries.ts:
  - `copy_cgu_workproduct_to_incr_comp_cache_dir`, `save_work_product_index` and `finalize_session_directory`
    (`-C incremental`);
  - `CompiledModules::serialize_rlink` (`-Zno-link`);
  - the io::Error Display for a failed stats write.
- rustc_driver_impl/lib.ts: `dump_feature_usage_metrics` (`-Zmetrics-dir`).
- base.ts `CrateInfo_new`: **reached right after the encoder, so these come next once encoding lands**:
  - `back::linker::exported_symbols` (the first statement), `back::linker::linked_symbols`,
    `middle::exported_symbols::metadata_symbol_name`, `back::lto::exported_symbols_for_lto`. Each is a named shim at
    the end of base.ts;
  - also `each_linked_rlib` (only with `-C lto`) and `collect_debugger_visualizers_transitive` (MSVC only).
- link.ts:
  - `link_binary` once `should_link()` holds (linking, M7);
  - `preserve_objects_for_their_debuginfo`, reached in that case only;
  - `ensure_removed`'s io::Error Display.
- symbol_export.ts: `reachable_non_generics_helper`, `exported_non_generic_symbols_helper`, and the rest of
  `exported_generic_symbols_provider_local`. All are codegen-only (M7).
- codegen_backend.ts: `codegen_crate`, `join_codegen`, `print_passes`, `print_pass_timings`, `print_statistics{,_json}`,
  `-C target-cpu=native`, plus the existing non-default-LLVM-input and no-table stops.

## PORT decisions
- `CrateInfo` is a data interface in lib.ts, and `CrateInfo::new` is the free fn `CrateInfo_new` in base.ts. lib.ts
  imports base.ts for `provide`, so base.ts cannot attach a static to a class defined in lib.ts at load time.
- `CompiledModules` is a class, so that `Box<dyn Any>::downcast::<CompiledModules>()` is `instanceof`.
- Types declared locally because their upstream files are not ported:
  - in codegen_ssa lib.ts: `Linkage`, `DependencyList` and `Dependencies` (rustc_middle middle/dependency_format.rs),
    and `SymbolExportKind` (middle/exported_symbols.rs);
  - in symbol_export.ts: `SymbolExportLevel` (with `is_below_threshold`), `SymbolExportInfo` and `ExportedSymbol`.

  Move them when rustc_middle's files are ported. The metadata-deps lane needs `Dependencies` too.
- `ArchiveBuilderBuilder`, `ArArchiveBuilderBuilder`, `LlvmArchiveBuilderBuilder` and `DummyArchiveBuilderBuilder`
  are opaque values. Only the linking steps use them, and those are unported.
- `EncodedMetadata` is an interface stand-in, `{ path() }`, in stand_ins.ts. The encoder lane replaces it.
- In `upstream_monomorphizations_provider`, the `unreachable!("{exported_symbol:?}")` message prints only the variant
  name, because `ExportedSymbol`'s Debug is not ported.
- `Linker::link`'s `TimingSectionGuard` for `Linking` is dropped in a `finally` around `codegen_backend.link`.

## For root
- The plan lists `back/linker.rs`, `back/lto.rs` and rustc_middle `middle/exported_symbols.rs` as "not M5", but
  `CrateInfo::new` calls `linker::exported_symbols`, `linker::linked_symbols`, `lto::exported_symbols_for_lto` and
  `metadata_symbol_name` on every compilation. A `check-core` MATCH therefore needs those four on their
  metadata-only path. I recommend a small lane after the encoder: for an rlib with `!should_codegen()` they reduce
  to empty lists plus the metadata symbol name.
- `rustc_middle::middle::dependency_format` (types only) should get its own file before lane metadata-deps ports
  `dependency_formats`. Then base.ts and lib.ts import from it.
- Nothing under harness/ or scripts/ was touched. The before-worktree is
  `$RUST_TS_DATA/tmp/w30/dm5-before` (detached at `644cc1e0`); remove it with `git worktree remove`.
