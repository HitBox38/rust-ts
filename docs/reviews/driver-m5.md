verdict: APPROVE-WITH-NOTES

Lane driver-m5 (branch `lane/driver-m5`, 3 commits over main; `git diff main...lane/driver-m5`, 13 files).
Reviewer: independent, read-only. Upstream: `.data/rust` at the pin.

## What was checked
- Every ported fn compared with upstream:
  - queries.rs `Linker::{codegen_and_build_linker, link}`;
  - passes.rs:1295 `start_codegen`;
  - util.rs:400-487 `DummyCodegenBackend`;
  - traits/backend.rs provided methods;
  - base.rs:954-1253: `collect_eii_linkage`, `eii_linkage_needed`, `CrateInfo::new`, `provide`;
  - link.rs:68-130 and :303-482: `ensure_removed`, `eii_impl_crate_name`, `check_externally_implementable_item_linkage`, `link_binary`, plus :3780;
  - symbol_export.rs: thresholds, every provider, `provide`, `wasm_import_module_map`;
  - lib.rs: `NativeLib`/`From`, `SymbolExport`, `CrateInfo`, `CompiledModule(s)`, `CodegenLintLevelSpecs::from_tcx`, `provide` order;
  - rustc_driver_impl run_compiler :337-352.

  Order, logic and texts match. Every gap is `unported(...)` with a named reason.
- The D7 stand-in (`src/rust_ts/codegen_backend.ts`) was checked against back/llvm_backend.rs:175-420:
  - `name`, `init` (the intrinsic lists are verbatim), `link` (`link_binary` with `self.name()`) and `target_cpu` (= llvm_util.rs:657 `target_cpu` + :650 `handle_native`, `native` unported) are faithful;
  - `supported_crate_types` and `metadata_loader` are the trait defaults, which LLVM does not override. Correct;
  - `target_config` is unchanged (moved from stand_ins.ts; oracle table, D4);
  - `codegen_crate`, `join_codegen`, `print_passes` and the stats printers are unported.
- `DummyCodegenBackend` is verbatim, including:
  - the `internal_target_features::<0>` closures;
  - `vec![Rlib, Executable]`;
  - the `find(!= Rlib) && should_link()` fatal text;
  - `join_codegen`'s downcast (unwrap panic on mismatch).

  The non-overridden methods delegate to `CodegenBackend_provided`, which is a verbatim copy of the trait defaults with correct markers.
- `should_codegen()` stays false on the M5 path. The lane does not touch `OutputTypes`. `start_codegen` returns `CompiledModules` for `!should_codegen()`. The symbol_export local providers return empty before their helpers. `dump_symbol_names_and_def_paths` is gated as upstream.
- Pending shims:
  - `rustc_metadata_fs_encode_and_write_metadata` (passes.ts) is typed `Result<EncodedMetadata, ErrorGuaranteed>`. Its marker line, fs.rs:38, is right. `start_codegen` raises on `Err` as upstream;
  - the four `CrateInfo::new` shims (linker.rs `exported_symbols`/`linked_symbols`, lto.rs `exported_symbols_for_lto`, exported_symbols.rs `metadata_symbol_name`) are named shims that call `unported`.
- Provider install order in `default_query_providers` matches passes.rs:894-928 (`rustc_metadata` → `rustc_lint` → `rustc_symbol_mangling` → `rustc_codegen_ssa`). No other module overrides the newly provided queries.
- Nothing under `harness/`, `scripts/` or `harness/baseline/` changed.
- In a scratch worktree at b262c1bc:
  - `bunx tsc --noEmit -p .` is clean;
  - `coverage.ts --check` reports markers ok.
- Oracle spot checks (x86_64-unknown-linux-gnu, oracle sysroot):
  - `pub fn f() -> u32 { "x" }` as `--crate-type lib --emit=metadata`, with `-Zcodegen-backend=dummy`, and as `--crate-type bin --emit=metadata`: stderr is byte-identical and the exit is 1 in all three. The handoff's claim is confirmed;
  - an OK lib crate exits 70 at `rustc_metadata::fs::encode_and_write_metadata (metadata encoding; plan-m5 waves 32-33)`. The claimed stop is confirmed.
- Filtered difftests (RUST_TS_AGENT=rev-dm5):
  - mir `--filter inline --sample 12`: MATCH 11, UNPORTED 1. All 11 protected cases match. The UNPORTED case, tests/ui/asm/asm-const-ptr-mir-inline.rs, is not protected and stops at an unrelated mir Const reason;
  - borrowck-ui `--filter generic --sample 8`: MATCH 6/6.

  No lost MATCH. The handoff's sample claims (mir 290/300, tydump-ui 297/300, mir-minicore 46/46, borrowck-ui 300/300, identical before and after) are plausible: the new code is reachable from the protected suites only through providers that were `unported` placeholders before.

## Findings

1. **src/rustc_codegen_ssa/base.ts:130 (`CrateInfo_new`, `target_features`). Non-blocking, for root.**
   `[...tcx.sess.global_backend_features]` reads a field that the LLVM stand-in defers (`defer_field` in codegen_backend.ts `init`, copied onto the Session by session.ts:1179). With the default backend this is `unported("rustc_codegen_ssa::traits::CodegenBackend::init (Session::global_backend_features)")`.
   - Today the earlier `back_linker_exported_symbols` shim masks it.
   - Once the four shims the handoff recommends are filled, this is the next stop on the `check-core` path.
   - The handoff's "unported left" and "For root" sections do not list it. A metadata-only MATCH also needs `llvm_util::global_llvm_features`, or a D4-style oracle table for it.

2. **src/rustc_codegen_ssa/back/link.ts:155 (`link_binary`, `bug!`). Non-blocking.**
   Upstream formats `sess.opts.target_triple` with `Display`, which is `debug_tuple()` (tuple.rs:140). The port uses `TargetTuple.tuple(...)`. The two agree for `TargetTuple` but differ for `TargetJson`. `TargetTuple.debug_tuple` exists in tuple.ts:93, so use it. The path is a `bug!`, so the impact is small.

3. **src/rustc_codegen_ssa/base.ts:202 (`CrateInfo_new`, missing weak lang items `bug!`). Non-blocking.**
   `{:?}` of `Target` is rendered as `t.$`. That matches Debug for unit variants only. `Target` has data variants, `Impl { of_trait }` and `Method(MethodKind)` (rustc_attr_ir target.rs:41,46), whose Debug prints the fields. The path is unreachable in practice, since weak lang items are Fn/Static. It should carry a `// PORT:` note like the one on `upstream_monomorphizations_provider`'s `unreachable!`.

4. **src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts:39 and src/rustc_driver_impl/lib.ts:322-339. Non-blocking.**
   Both files are edits outside the lane's own files, and the handoff discloses and justifies them:
   - the test edit only re-pins a PENDING `unported` stop string (refine_rpitit) to the new stop. No oracle output or expected stderr changes, so this is not expectation tampering;
   - the driver edit is a faithful port of run_compiler :337-352, with `dump_feature_usage_metrics` unported.

   Root should acknowledge both when integrating.

5. **src/rustc_codegen_ssa/lib.ts and back/symbol_export.ts (local type declarations). Non-blocking.**
   `Linkage`, `DependencyList`, `Dependencies`, `SymbolExportKind`, `SymbolExportLevel`, `SymbolExportInfo` and `ExportedSymbol` are declared locally, as upstream defines them. The `is_below_threshold` marker of rustc_middle exported_symbols.rs:18 also lives in a codegen_ssa file. All of this is disclosed as PORT decisions. Queue a follow-up to move them when rustc_middle `middle/dependency_format.rs` and `middle/exported_symbols.rs` get files; lane metadata-deps needs `Dependencies`.
