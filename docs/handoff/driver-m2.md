# Handoff: driver-m2 (wave 9/10, M2: the driver path to expansion and resolution)

Branch `lane/driver-m2`, based on main d2db7fd. No merges.

## Result
The `-Zunpretty=ast-tree,expanded` path now runs for real, from the driver through
`create_and_enter_global_ctxt` (crate name, crate types, output filenames, global ctxt, feeds), through
`early_lint_checks` → `resolver_for_lowering` → `resolver_for_lowering_raw`, up to `Resolver::arenas()` /
`Resolver::new` (lane res-lib). All 193 UNPORTED cases of a 200-sample re-run were prefix-checked against the
oracle (stdout and stderr up to the stop are a prefix of rustc's): **193/193 ok**. Script:
`$RUST_TS_DATA/tmp/driver-m2/scripts/prefix.ts <repo> <suite> <run jsonl>`.

**Stop-point histograms (`--sample 500`, `RUST_TS_AGENT=driver-m2`):**

| suite | before | after |
|---|---|---|
| expanded-nocore | 490 `rustc_session::output::validate_crate_name`, 10 MATCH (run 20261013-093407-driver-m2-sk1j) | 489 `rustc_resolve::Resolver::arenas (pending res-lib)`, 11 MATCH (run 20261013-095655-driver-m2-v46u) |
| resdump-nocore | 490 `rustc_interface::passes::create_and_enter_global_ctxt (expansion, analysis, codegen)`, 10 MATCH (run 20261013-093419-driver-m2-wg7d) | 489 `rustc_resolve::Resolver::arenas (pending res-lib)`, 11 MATCH (run 20261013-095709-driver-m2-22t9; prefix check 489/489 ok) |
| unpretty-expanded-nocore | not measured | 489 `rustc_resolve::Resolver::arenas (pending res-lib)`, 11 MATCH (run 20261013-095721-driver-m2-eb83) |

The extra MATCH cases come from crate-name errors such as `a.b.rs` → `invalid character '.' in crate name`, which are fatal before resolution.

## Files
- **New:**
  - `src/rustc_session/output.ts`: all of output.rs (7/7).
  - `src/rustc_interface/limits.ts` (2/2).
  - `src/rustc_interface/diagnostics.gen.ts`: GENERATED, new codegen set `rustc_interface`.
  - `src/rustc_session/output.oracle.test.ts`.
- **Changed (owned):**
  - `src/rustc_interface/passes.ts`:
    - `pre_expansion_lint` and `LintStoreExpandImpl`
    - `configure_and_expand`
    - `early_lint_checks`, `env_var_os`
    - `generated_output_paths`, `output_contains_path`, `output_conflicts_with_dir`, `escape_dep_filename`, `escape_dep_env`
    - `write_out_deps`, `hash_iter_files`
    - `resolver_for_lowering_raw`, `write_dep_info`, `write_interface` (guard only)
    - `get_recursion_limit`
    - the diagnostics in `get_crate_name`/`collect_crate_types`; `#![crate_type]` parsing; real `supported_crate_types`
    - `override_queries`, `compiler.current_gcx`
    - the `limits`/resolve/passes providers
  - `src/rustc_interface/util.ts`: `multiple_output_types_to_stdout`, `build_output_filenames`, and the real `AbiRequiredTargetFeature` diagnostics in `check_abi_required_features`.
  - `src/rustc_interface/stand_ins.ts`:
    - `CodegenBackend.supported_crate_types` (codegen_ssa default; LLVM does not override it).
    - `CurrentGcx` is now rustc_middle's real one (re-export). This was tyctxt-min's request.
  - `src/rustc_interface/interface.ts`: `override_queries` is typed `(sess, providers: rustc_middle Providers) => void`.
  - `src/rustc_driver_impl/pretty.ts`:
    - `PrintExtra::NeedsAstMap { tcx }`, with `with_krate` through `resolver_for_lowering`.
    - `AstIdentifiedAnn` (`expanded,identified`), `AstHygieneAnn` (`expanded,hygiene`).
    - `AstTreeExpanded`, and `needs_analysis` → `analysis`.
  - `src/rustc_driver_impl/lib.ts`:
    - `Callbacks` gets the provided `after_crate_root_parsing`/`after_expansion`/`after_analysis` (`Callbacks_provided`, PORTING §8). resdump.ts's callback object works unchanged.
    - The NeedsAstMap pretty path: `early_lint_checks`, `pretty::print`, `write_dep_info`.
    - The compile path up to `after_expansion` → `write_dep_info` → `write_interface` → analysis (unported after that).
    - The missing `return`s after `list_metadata`/`process_rlink`.
    - `print_crate_info` `--print file-names | crate-name | supported-crate-types`.
  - `src/rustc_session/session.ts`: `staticlib_components`, `resolve_path` (bm-a needs it; see "For other lanes").
  - `src/rustc_driver_impl/driver.oracle.test.ts`: 2 PENDING stop texts updated.
- **Changed outside the listed ownership (please review):**
  - `src/rustc_session/config.ts`:
    - `OutputFilenames`: struct, `new`, `path`, `interface_path`, `output_path`, `temp_path_for_diagnostic`, `with_extension`, `with_directory_and_extension`. The cgu/dwo temp paths, `maybe_strip_file_name` and `split_dwarf_path` are not ported (codegen).
    - `path_set_extension` (std `PathBuf::set_extension`; move it to src/std/path.ts).
    - `Input::filestem`, `OutFileName::{parent, filestem}` now use std/path.ts instead of `unported`.
  - `tools/codegen/types.sets.json`: new set `rustc_interface` (diagnostics.rs).
  - `tools/codegen/diag_args.json`: `rustc_structures::CrateType` → `CrateType_into_diag_arg` / `display_CrateType`.

## Coverage (`bun scripts/coverage.ts --missing`)

| file | before | after |
|---|---|---|
| rustc_session output.rs | 0/7 | 7/7 |
| rustc_interface passes.rs | 6/29 | 21/29 |
| rustc_interface limits.rs | 0/2 | 2/2 |
| rustc_interface util.rs | 7/21 | 9/21 |
| rustc_driver_impl pretty.rs | 5/15 | 8/15 |
| rustc_driver_impl lib.rs | 24/43 | 28/43 |
| rustc_session session.rs | 75/104 | 77/104 |

- **passes.rs, the 8 missing:**
  - post-HIR: `analysis`, `run_required_analyses`, `start_codegen`, `emit_delayed_lints`, `DiagCallback::into_diag`.
  - `print_macro_stats`: an `unported` stand-in without a marker. It is unreachable, because `-Zmacro-stats` already stops in rustc_expand stats.rs, and it needs `rustc_data_structures::thousands`.
- **pretty.rs, the 7 missing:** the HIR annotators and `emit_mir`.
- `bun scripts/coverage.ts --check`: markers ok (5825; vendor 2403).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 2677 pass, 1 skip (the pre-existing one), 0 fail.
- `--suite parse --sample 300`: 300/300 MATCH (run 20261013-095640-driver-m2-wwhe). `--suite parse-ui --sample 300`: 300/300 MATCH (run 20261013-095647-driver-m2-qcs2).
- **`output.oracle.test.ts`**: 52 tests, all against `rustc +nightly`.
  - **MATCH, 40 cases:**
    - `--crate-name` with `.`, a space, `€`, empty.
    - The file stem `a.b`; `#![crate_name = "a-b"]` and `= ""`.
    - `MultipleOutputTypesToStdout` (2 forms).
    - `--print crate-name` (attr, file stem, `--crate-name` mismatch, invalid).
    - `--print file-names` (`#![crate_type]` ×3, bogus crate_type, `-o`, extra-filename, `--crate-name`, `--test`).
    - For all 6 ported targets: `--print supported-crate-types` (this is `invalid_output_for_target`), and file-names for every crate type (this is `filename_for_input`).
  - **PENDING, 12 cases.** Each must match or stop at `Resolver::arenas` after an oracle prefix:
    - unicode names (`héllo`, `٣x`)
    - `CrateNameDoesNotMatch`, and a double `#![crate_name]`
    - `CrateNameInvalid` (`-foo.rs`)
    - `UnsupportedCrateTypeForTarget` (proc-macro/dylib on wasm32-wasip2; `#![crate_type]`)
    - the `MultipleOutputTypesAdaption`, `IgnoringExtraFilename` and `IgnoringOutDir` warnings
  - **Not CLI-testable yet:** `out_filename`, `check_file_is_writeable` and `filename_for_metadata` run only at link time.

## Pending-lane shims (all in passes.ts, section "Pending-lane shims"; replace by imports on integration)
| shim | upstream | lane |
|---|---|---|
| `Resolver` interface + `Resolver.arenas()` / `Resolver.new(tcx, attrs, crate_span, inject_span, arenas)`, `ResolverOutputs`, `ResolverArenas` | rustc_resolve lib.rs:1345, 1803, 1954 (`tcx()`, `lint_buffer()`, `resolve_crate()`, `into_outputs()`) | res-lib |
| `rustc_resolve_provide` (`registered_attr_tools`, `registered_lint_tools`) | lib.rs:2850 / macros.rs:126,146 | res-lib / res-macros |
| `rustc_lint_unerased_lint_store`, `rustc_lint_check_ast_node`, `EarlyCheckNode`, `LintStore` | rustc_lint late.rs:25, early.rs:278/311 | lint-early-a |
| `rustc_ast_passes_ast_validation_check_crate`, `rustc_ast_passes_feature_gate_check_crate` | ast_validation.rs:2226, feature_gate.rs:409 | ast-passes |
| `rustc_builtin_macros_test_harness_inject`, `rustc_builtin_macros_proc_macro_harness_inject` | test_harness.rs:47, proc_macro_harness.rs:49 | bm-rest |
| `CStore_from_tcx(..).report_session_incompatibilities` | rustc_metadata creader.rs:200/452 | wave 11 (creader) |
| `rustc_passes_provide` (`debugger_visualizers`), `rustc_passes_input_stats_print_ast_stats` | rustc_passes | none yet (M3) |
| `limits.ts` `hir_krate_attrs` | rustc_middle hir/mod.rs | M3 (HIR) |

## `unported(...)` left (reachable)
- **The shims above.** Every nocore case now stops at `rustc_resolve::Resolver::arenas (pending res-lib)`.
- **Next steps once res-lib lands**, in order:
  1. `Resolver::new` and `registered_*_tools`
  2. lints (`unerased_lint_store`, pre-expansion lints)
  3. expansion runs for real
  4. `test_harness`, then `ast_validation`, then `proc_macro_harness`, then `resolve_crate`, then `CStore::from_tcx`
  5. `early_lint_checks`: `feature_gate::check_crate`, then the lints
- **Other unported paths:**
  - `write_out_deps` with `-Z checksum-hash-algorithm` (`SourceFileHash::new`) or `-Z binary-dep-depinfo` (`used_crate_source`)
  - `ErrorWritingDependencies` (no `IntoDiagArg` for `io::Error`)
  - `write_interface` (sdylib)
  - `print_macro_stats`
  - `build_output_filenames` `invocation_temp` with `-C incremental`
  - `Session::resolve_path` for a Windows verbatim (`\\?\`) absolute path
  - after analysis: `Linker::codegen_and_build_linker`, `Linker::link`
  - unchanged: `CStore::new` (cstore_new stand-in, wave 11), `setup_dep_graph` incremental

## PORT decisions (please record)
1. **Pending-lane shims** live in passes.ts under their upstream names. They call `unported("<path> (pending <lane>)")` and are not stand-in values.
   - Queries of crates not yet provided get shim providers (`rustc_resolve_provide`, `rustc_passes_provide`), so that they report UNPORTED rather than upstream's `default_query` ICE.
2. **`char::is_alphanumeric`** (output.ts, local): ASCII is exact.
   - Non-ASCII uses JS `\p{Alphabetic}`/`\p{N}`, whose Unicode version may differ from the oracle's.
   - Move it to src/std/char.ts with generated tables (tools/gen-unicode.ts).
3. **`path_set_extension`** (config.ts) is std's `_set_extension`: truncate after the file stem, then append `.ext`.
4. **`std::path::absolute`** for `try_canonicalize` (passes.ts, local; rustc_fs_util is not ported):
   - unix: component normalisation onto the cwd;
   - Windows: `path.win32.resolve`.
5. **The `output_filenames` and `registered_*_tools` query values** are typed `unknown` in queries.gen.ts and cast at the use sites. Add `OutputFilenames`/`RegisteredTools` to typemap.middle.json and regenerate.
6. **`Session.env_depinfo`** stays `Set<string>` with the JSON text of `[key, value|null]`, as bm-a did. `env_var_os` writes it and `write_out_deps` decodes it and sorts it as `(String, Option<String>)`. Root: make it the real tuple set.
7. **Callbacks provided methods** are optional interface members plus `Callbacks_provided.*` (markers on the helper).
8. **`pre_expansion_lint`'s `generic_activity_with_arg`** is `generic_activity`: the profiler stand-in records nothing, so the argument is unobservable.
9. **`configure_and_expand`'s `cfg!(windows)` PATH handling** is ported for the host (`process.platform === "win32"`), with std's Windows `split_paths`/`join_paths` rules written out locally.
10. **`tcx.is_sdylib_interface_build()`** is inlined as `sess.opts.unstable_opts.build_sdylib_interface`, because it is not on the ported `TyCtxt`.

## For other lanes / root
- **bm-a:** `Session::resolve_path` is ported now. Replace `session_resolve_path` in rustc_builtin_macros/source_util.ts with `cx.sess.resolve_path(path, span)`.
- **res-lib:**
  - Export `Resolver` (class, with `static arenas()` and `static new(tcx, attrs, crate_span, crate_inject_span, arenas)`), `ResolverOutputs` and `provide(providers.queries)` from `src/rustc_resolve/lib.ts`.
  - Then delete the shims and import them in passes.ts.
- **driver.oracle.test.ts / output.oracle.test.ts:** the PENDING stop texts name `Resolver::arenas`. Update them when res-lib lands.
- `docs/claims/driver-m2.md` can be removed on integration.
