# Handoff: creader (wave 11, pulled forward: rustc_metadata creader.rs)

Branch `lane/creader`, based on e91a209. No merges. Commits: the port + stubs + shim replacement; the oracle tests
and PENDING texts; this handoff.

## Result
`rustc_metadata::creader::CStore` is real. The driver builds it in `create_and_enter_global_ctxt`, and
rustc_resolve and passes.ts now import it. All the `CStore::from_tcx` / `from_tcx_mut` stops are gone.

**Stop-point histograms (`--sample 300`, `RUST_TS_AGENT=creader`).** expanded-nocore and resdump-nocore give identical histograms:

| stop | before (runs 20261013-131026-creader-kmou, -131039-creader-eyc3) | after (runs 20261013-133324-creader-caib, -133340-creader-2gpm) |
|---|---|---|
| `rustc_metadata::creader::CStore::from_tcx (wave 11)` | 142 | 0 |
| `rustc_metadata::creader::CStore::from_tcx_mut (wave 11)` | 26 | 0 |
| `rustc_resolve::late::Resolver::late_resolve_crate` | 0 | 103 |
| `query_feed: re-feeding query visibility` | 94 | 94 |
| `rustc_resolve::diagnostics::impls::Resolver::dcx` | 0 | 38 |
| `rustc_metadata::locator::CrateLocator::new (wave 11 locator)` | 0 | 26 (`extern crate minicore` / aux crates) |
| `Resolver::report_path_resolution_error` | 17 | 18 |
| `DenseBitSet::new_filled` | 13 | 13 |
| `PathSource::is_expected` | 4 | 4 |
| MATCH | 4 | 4 |

Notes on the "after" column:
- **Prefix check.** All 296 UNPORTED expanded-nocore cases print a prefix of the oracle's output (296/296 ok), using `tmp/driver-m2/scripts/prefix.ts`.
- **Why `postprocess` is not reached yet.**
  - The 142 `from_tcx` stops were `had_extern_crate_load_failure` (imports.rs).
  - Those cases now reach late resolution, which is still unported on this base.
  - So `postprocess` and `report_session_incompatibilities` are not reached by the samples yet. They are covered by the oracle tests below.

## Files
- **New ports:**
  - `src/rustc_metadata/creader.ts`: all of creader.rs (55/55).
  - `src/rustc_metadata/rmeta/decoder/cstore_impl.ts`: the `impl CStore` block (cstore_impl.rs:629) and `impl CrateStore for CStore` (:737), 18/37.
  - `src/rustc_metadata/lib.ts`: the crate root. It loads cstore_impl.ts after creader.ts.
  - `src/rustc_metadata/diagnostics.ts`: re-exports `diagnostics.gen.ts`, which is GENERATED (new codegen set `rustc_metadata`: 61 types, 58 derives).
- **Stubs (contract-first, no markers, `unported` bodies):**
  - `src/rustc_metadata/locator.ts`: `CrateLocator`, `CratePaths`, `CrateRejections`, `CombinedLocatorError`, and `CrateError` (+ `report`). `CrateFlavor`'s `fmt` and `into_diag_arg` are ported (2/22), because the generated diagnostics need them.
  - `src/rustc_metadata/rmeta/mod.ts`: `CrateHeader`, `CrateRoot` (declared fields), `CrateRootUnhashed`, `CrateDep`.
  - `src/rustc_metadata/rmeta/decoder.ts`:
    - `Svh` stand-in, `MetadataBlob`, `CrateNumMap`, `TargetModifiers`, `DeniedPartialMitigations`.
    - `CrateMetadata`: the fields cstore_impl touches, plus every method creader.rs and cstore_impl.rs call (`unported_methods`).
    - The `impl CrateRoot` methods.
  - `src/rustc_metadata/host_dylib.ts`: `DylibError` + `From<DylibError> for CrateError` are ported (1/6); `dlsym_proc_macros` is unported (M6).
- **Tests:**
  - `src/rustc_metadata/creader.oracle.test.ts`: 28 oracle cases.
  - `src/rust_ts/creader_probe.ts`: the test driver (not a port).
- **Changed outside the lane (call sites / necessary; please review):**
  - `src/rustc_resolve/lib.ts`: the `CStore` stand-in is replaced by `creader.CStore` (type + value alias, so decls.ts is unchanged).
  - `src/rustc_resolve/build_reduced_graph.ts:1024`: `process_extern_crate` now gets `this.r.tcx_` as its first argument, as upstream does. The stand-in had no `tcx`.
  - `src/rustc_interface/passes.ts`:
    - `cstore_new()` is replaced by `creader.CStore.new(compiler.codegen_backend.metadata_loader())`.
    - The `CStore_from_tcx` shim is replaced by `creader.CStore.from_tcx(tcx).report_session_incompatibilities`.
  - `src/rustc_interface/stand_ins.ts`: `metadata_loader()` was `unported`, which would have stopped every case. It now follows upstream's provided `CodegenBackend::metadata_loader` (backend.rs:97, marker) and returns a `DefaultMetadataLoader` stand-in whose two methods are `unported` (object-read lane).
  - `src/rustc_session/session.ts`: ported `Session::stack_protector` (session.rs:1112).
  - `tools/codegen/options.ts`: `gather_enabled_denied_partial_mitigations` is now generated for real, via a `MITIGATION_LEVEL_CODE` table of the two `$code` expressions. An unknown expression keeps the old `unported` body. Before, every crate stopped there in `report_session_incompatibilities`. Regenerated `options/mitigation_coverage.gen.ts`.
  - `tools/codegen/types.sets.json`: new set `rustc_metadata`.
  - New `tools/codegen/typemap.metadata.json`: `PanicStrategy`, `CrateFlavor`.
  - `tools/codegen/diag_args.json`: `PanicStrategy.into_diag_arg`, `CrateFlavor_into_diag_arg`.
  - `src/rustc_middle/queries.gen.ts` regenerated. The `PanicStrategy` typemap types `required_panic_strategy` / `panic_in_drop_strategy` and gives their values a Debug.
  - PENDING texts updated in:
    - `src/rustc_driver_impl/driver.oracle.test.ts`: `x.rs` now stops at `CrateLocator::new` (std).
    - `src/rustc_session/output.oracle.test.ts`: now `late_resolve_crate`.
    - `src/rustc_resolve/macros_oracle.test.ts`: `tool_attrs` now stops at `report_path_resolution_error`.

## Coverage (`bun scripts/coverage.ts --missing`)

| file | ported |
|---|---|
| creader.rs | 55/55 (0 missing) |
| rmeta/decoder/cstore_impl.rs | 18/37 |
| locator.rs | 2/22 |
| host_dylib.rs | 1/6 |
| rustc_session session.rs | 78/104 (+1) |
| rustc_codegen_ssa traits/backend.rs | 2/20 (+1) |

cstore_impl.rs still misses `ProcessQueryValue`, `IntoArgs`, `provide_extern`, `provide` and `provide_cstore_hooks`.

`--check`: markers ok (7013; vendor 2603).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3401 pass, 1 skip, 17 fail before the fixes in commit 266a7dc.
  - The 17 failures were all stale PENDING texts / `queries.gen.ts` staleness, all fixed.
  - The touched test files were then re-run: 124 + 28 pass, 0 fail.
- `--suite parse --sample 200`: 200/200 MATCH (run 20261013-134352-creader-dfi5).
- **creader.oracle.test.ts (28/28).**
  - **What it compares.** It compares which crates creader tries to load: the probe prints `resolving crate `x`` per `maybe_resolve_crate`; the oracle runs with `RUSTC_LOG=rustc_metadata::creader=info`. It also checks that our diagnostics are a prefix of the oracle's stderr.
  - **Cases:**
    - `#![needs_panic_runtime]` with `-Cpanic=unwind|abort|immediate-abort` and rlib
    - no_core bin/rlib
    - `-Cprofile-generate`, `-Cinstrument-coverage`, `-Zno-profiler-runtime`, `-Zprofiler-runtime=x`
    - `#![needs_allocator]` bin/rlib/`default_lib_allocator`: `GlobalAllocRequired`
    - duplicate `__rust_alloc` / `__rust_alloc_error_handler`: `fn_spans`, `NoMultiple*`
    - `#![compiler_builtins]`
    - `-Cunsafe-allow-abi-mismatch=foo,regparm,bar`: `UnknownTargetModifierUnsafeAllowed`
    - stack-protector / CFG mitigations with no crates
    - `wasm_bindgen` + `CARGO_PKG_VERSION_*`: `WasmCAbi` (0.2.87, `+0`) and none (0.2.88, no cargo)
    - pathless unused `--extern`
    - pipeline mode: `#![no_std]` → `core`, std crate → `std`, `extern crate foo` → `foo`, `extern crate föo` → `föo` then `core` (`NonAsciiName` + the `missing_core` probe)
  - **Negative control.** Flipping the `only_rlib && !is_std` and `default_lib_allocator` conditions fails 3 cases.

## `unported(...)` left (reachable once a crate is loaded)
- `rustc_metadata::locator::CrateLocator::new` / `for_*proc_macro` / `maybe_load_library_crate` / `into_error`, `CratePaths::new`, `CrateError::report` (wave 11 locator). Every crate load stops at `CrateLocator::new`.
- `rustc_metadata::rmeta::decoder::{MetadataBlob, CrateMetadata, CrateRoot}` methods and `CrateMetadata::new` (wave 11 rmeta-decoder).
- `rustc_metadata::host_dylib::dlsym_proc_macros` (M6).
- `rustc_metadata::rmeta::decoder::cstore_impl::provide` (wave 11 cstore). This is a stub and is not wired into `DEFAULT_QUERY_PROVIDERS`: its local providers need loaded crates.
- `rustc_codegen_ssa::back::metadata::DefaultMetadataLoader::get_{rlib,dylib}_metadata` (wave 11 object-read).
- Generated diagnostics with an `io::Error` argument use `unported_into_diag_arg`.
- Not ported in diagnostics.ts: the hand `impl Diagnostic` for `MultipleCandidates` / `InvalidMetadataFiles` / `CannotFindCrate`. They are left to the locator lane.

## PORT decisions (please record)
1. **`FreezeLock` and `downcast`.**
   - `FreezeReadGuard::map` / `FreezeWriteGuard::map` are the value (PORTING §5).
   - `as_any().downcast_ref::<CStore>()` is an `instanceof CStore` check that panics with the upstream `expect` text.
2. **Field renames.** Fields that clash with a method get `_`: `injected_panic_runtime_`, `allocator_kind_`, `alloc_error_handler_kind_`, `has_global_allocator_`, `has_alloc_error_handler_` (CStore); `CrateRoot.stable_crate_id_`, `CrateMetadata.used_`.
3. **`struct CStore` placement.** It is declared after `CrateOrigin` so that its class-body methods (PORTING §8) follow `impl Debug` (:111) and `impl CrateOrigin` (:160) in file order.
4. **Lazy iterators become arrays.** `iter_crate_data` / `all_proc_macro_def_ids` return arrays; nothing mutates `metas` while iterating. `report_target_modifiers_extended` keeps the lazy `map(tmod_extender)` as index cursors.
5. **`IndexSet`, `BTreeMap`, `UnordMap`.**
   - `IndexSet<CrateNum>` is `Set`.
   - `BTreeMap<DeniedPartialMitigationKind, _>` is a `Map` read in key order.
   - `UnordMap<Svh, CrateNum>` is a `Map` keyed by the `Svh` stand-in (the hash's Display text, branded string).
6. **Local helpers.** These are local in creader.ts: the derived `Ord` of `DeniedPartialMitigationLevel` and `StackProtector`, `cmp::max` of `CrateDepKind`, and `str::is_ascii`. `env::var` + `u64::from_str` use `bigint`, accept a leading `+`, and reject overflow. **Move them to their crates** (rustc_session mitigation_coverage.ts, rustc_target).
7. **`usize::MAX` path_len** is `Number.MAX_SAFE_INTEGER`, the repo's existing sentinel (rustc_crate_store `rank`).
8. **`generic_activity_with_arg`** is `generic_activity`, as in driver-m2 decision 8.
9. **Logging.** `info!` / `debug!` are comments. In particular `postprocess`'s `info!("{:?}", self)` is a comment; `debug_CStore` is ported but only used as `CrateStore.debug`.
10. **`*crate_rejections = CrateRejections::default()`** (`load_proc_macro`) is `Object.assign` on the caller's object.
11. **Generated mitigation levels.** The generated `gather_enabled_denied_partial_mitigations` writes the `From::from` results as `DeniedPartialMitigationLevel` object literals. Importing mitigation_coverage.ts from the `.gen.ts` breaks options.ts's load order (TDZ on `Options`); this was verified.
12. **rustc_session imports.** creader.ts reaches rustc_session through `lib.ts` (`config`, `options`, `options.mitigation_coverage`). Direct value imports of `options/mitigation_coverage.ts` hit the same TDZ.

## For root / other lanes
- **locator / rmeta-decoder / cstore / object-read lanes:** fill the stubs in place. Keep the declared signatures, or adjust creader.ts's call sites with the stub.
  - `CrateMetadata`'s method list in decoder.ts is exactly what creader.rs + cstore_impl.rs call.
  - `Svh` should become `rustc_data_structures::svh::Svh`. Keep a primitive key for `hash_to_cnum`.
- **cstore lane:** port `provide` / `provide_cstore_hooks` and add `rustc_metadata.provide(providers)` to `DEFAULT_QUERY_PROVIDERS` (passes.ts lists rustc_metadata as pending).
- **Not ported in passes.rs:** `CStore::from_tcx(tcx).report_unused_deps(tcx)` (passes.rs:1131) is in `analysis` (M3), which is not ported.
- **Unit tests with NO_CSTORE proxies.** resolver_new.test.ts, ident.test.ts, build_reduced_graph.test.ts and with_resolver.ts still build `Untracked` with a `NO_CSTORE` proxy. They could use `creader.CStore.new(..)` now.
- `docs/claims/creader.md` can be removed on integration.
