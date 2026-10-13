# Handoff: driver-session (wave 6b porter): getopts, config.rs/session.rs subsets, rustc_interface, rustc_driver_impl

Branch `lane/driver-session`.

`src/rust_ts/main.ts <rustc args>` now runs the ported driver path. The path is
`rustc_driver_impl::main` → `compiler_entrypoint` → `handle_options` (getopts) → `build_session_options` →
`rustc_interface::run_compiler` → `build_early_session`/`build_session` → `passes::parse` → `pretty::print`
(`-Zunpretty=ast-tree` / `normal`) → `finish_diagnostics` / `abort_if_errors` / `flush_delayed` →
`drop_compiler_dcx`.

The only thing missing for the `parse` suite is the parser itself. Every sampled case stops at
`rust-ts: unported: rustc_parse::new_parser_from_file (pending lane parser-core)`.

## Files
- **New**
  - `src/vendor/getopts/lib.ts`, `src/vendor/getopts/tests/mod.test.ts`: getopts 0.2.24 and its unit tests.
  - `src/rustc_session/session.ts`
  - `src/rustc_session/config/{print_request,externs,native_libs}.ts`
  - `src/rustc_interface/{lib,interface,util,passes,stand_ins,pending_parser}.ts`
  - `src/rustc_driver_impl/{lib,args,pretty,print}.ts`
  - `src/rustc_driver_impl/driver.oracle.test.ts`
- **Changed**
  - `src/rustc_session/{config,lib,stand_ins}.ts`
  - `src/rust_ts/{main,driver}.ts`
- **Outside my ownership.** These are small edits that the new `Session` class forced:
  - `src/rustc_session/utils.ts`: `Session_utils.{timer,time}` became `Session.prototype.{timer,time}`, on the `SelfProfilerRef` stand-in. The session-parse handoff asked the session.rs porter to do this.
  - `src/rustc_session/diagnostics.test.ts`: its fake `Session` is now cast with `as unknown as Session`, because the real class is nominal.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 926 pass, 0 fail, 1 skip (pre-existing), 9 todo.
  - The 9 todos are getopts usage tests. They need `UnicodeWidthStr::width`, which is unported in `src/vendor/unicode_width/tables.ts`.
- `bun scripts/coverage.ts --check`: the only errors are **105** "names no harness/scope.json vendor crate" errors for getopts (44 lib.rs + 61 tests). I ran the check locally with `"getopts": "=0.2.24"` added to scope.json and got `markers ok (2920; vendor 2278)`. Coverage under that run:

  | file | fns |
  |---|---|
  | config.rs | 115/136 (was 31) |
  | session.rs | 65/104 |
  | config/print_request.rs | 8/8 |
  | config/externs.rs | 3/3 |
  | config/native_libs.rs | 1/5 |
  | utils.rs | 8/8 |
  | rustc_driver_impl lib.rs | 24/43 |
  | args.rs | 8/8 |
  | print.rs | 1/1 |
  | pretty.rs | 5/15 |
  | rustc_interface interface.rs | 1/4 |
  | util.rs | 5/21 |
  | passes.rs | 1/29 |
  | getopts lib.rs | 44/44 (2 crate-skip) |
  | getopts tests | 61/61 |

  These are the counts before I removed the markers from 4 fns whose bodies are entirely `unported`: config.rs `build_configuration`, native_libs `parse_native_lib`, and session.rs `apple_deployment_target` and `sanitizers`.
- `RUST_TS_AGENT=driver-session bun scripts/difftest.ts --suite parse --sample 50`: MATCH 0, DIFF 0, UNPORTED 50, CRASH 0 (run `20261013-001011-driver-session-rvut`). All 50 stop at the parser shim. I checked this by re-running each case.
- `driver.oracle.test.ts` compares stdout, stderr and exit code with `rustc +nightly` byte for byte. 48 tests pass.
  - **35 exact matches:**
    - `-V`, `--version`, `-vV`, `--version --verbose`. This includes the host line and `LLVM version: 23.1.3`.
    - `-Zfoo`, `-Z foo=bar`, `-Cfoo`, `--foo`, `--opt-level=3` (the "Did you mean `-C opt-level`" hint).
    - `--edition=2099`, `--edition 2099`, `--edition=future`, `-Zunpretty=bogus`.
    - `--color=x`, `--error-format=bogus`, `--json=artifacts`, `--crate-type=bogus`, `--emit=bogus`, `--cap-lints=bogus`.
    - `--print=bogus`, `--print=lints`, `-Zthreads=x`, `--diagnostic-width=x`, `-Cpanic=immediate-abort`.
    - `--remap-path-prefix=x`, `--remap-path-scope=bogus`, `--jobs=2`.
    - `-Chelp`, `-Zhelp`, `-C help -Z help`, `-W all`, `-Wall`.
    - Two inputs. No input with `-Zunpretty=ast-tree`, or with `--edition=2021`; both give "no input filename given" plus "aborting due to 1 previous error", through the real `run_compiler` abort path. `--extern foo-bar`.
  - **12 pending cases.** These must match the oracle exactly, or stop at the named `unported` (exit 70) after printing a prefix of the oracle output:
    - Parser shim (7):
      - `-Zunpretty=ast-tree x.rs`, with editions 2021 and default, and with `-Zui-testing`
      - the missing input file
      - `-Zunpretty=normal`
      - plain `x.rs`, where the "`--edition` is unspecified" note is printed first, as upstream does
      - `-ooptimize`
    - unicode-width `width_in_str` (4), for getopts usage: `--help`, no args, `-o`, `--explain`.
  - **Target-spec stand-in check.** The stand-in values are compared with `--print target-spec-json` for 6 tuples.
  - **Unstable options.** `-Zunpretty=ast-tree` without `-Z unstable-options` is not gated at the pin. The oracle accepts it, and so do we.

## How the driver path is built (PORT decisions; root: please record)
1. **Load order in rustc_session.** options.gen.ts reads `config.ts` (`Polonius`) while it loads. options.ts imports config.ts, and config.ts imports options.ts (needed for `UnstableOptions::build` and friends).
   - Rule: **options.ts must be evaluated before config.ts.** `lib.ts`, `session.ts`, `config/print_request.ts` and every rustc_interface/rustc_driver_impl module start with a bare `import "…/options.ts"`.
   - The import has to be bare because Bun drops imports whose bindings are only used as types.
   - For the same reason, config.ts cannot touch the generated classes when it loads. `impl Options` and `impl UnstableOptions` of config.rs are the companion consts `Options_impl.f(opts)` and `UnstableOptions_impl.f(uo)`, not prototype extensions.
   - `utils.ts` extends `Session`, so config.ts imports utils only as a type.
2. **`Session` and Deref.** `Session` is a class. `impl Deref<Target = EarlySession>` becomes getters `target`, `host`, `opts` (with a setter) and `psess`, plus forwarding `dcx()`, `source_map()`, `panic_strategy()` and `code_model()`.
   - `lib.ts` now does `export * from "./session.ts"`.
   - `stand_ins.EarlyDiagCtxt` / `stand_ins.Matches` are now `Pick<>`s of the real types. They keep the structural subsets so the options tests' fakes still type-check.
3. **Deferred fields.** These are computed upstream by crates that are not ported (rustc_target, codegen backend, filesearch, search_paths, rustc_lint, config/cfg.rs, code_stats) and nothing on the parse path reads them. They use `defer_field` (stand_ins.ts), a getter that calls `unported(<upstream expr>)` when read.
   - Session fields: `target_tlib_path`, `asm_arch`, `*_filesearch`, `pointer_auth_config`, `sanitizers`, `code_stats`, `global_backend_features`, `replaced_intrinsics`, `fallback_intrinsics`, `thin_lto_supported`.
   - Set in `run_compiler`: `config`, `check_config`, `internal_target_features`, `lint_store`.
   - Non-empty `--cfg` / `--check-cfg` call `unported` right away, so no error is skipped silently.
4. **Steps not run (no markers).** Each one reports nothing on the built-in host targets with the default flags. Root: port them when rustc_target lands.
   - `validate_commandline_args_with_session_available` (session.rs:1545): reads the target spec throughout.
   - `util::add_configuration`, `util::check_abi_required_features`, `codegen_backend.target_config`.
   - `callbacks::setup_callbacks`: rustc_middle hooks that only matter while a `TyCtxt` exists.
   - `signal_handler::install`, `install_ctrlc_handler`, `install_ice_hook`/`report_ice`. ICEs are still reported by main.ts (exit 101).
5. **Target stand-in** (`stand_ins.Target`). `Target::search` loads a built-in spec from `TARGET_STANDIN_SPECS` (aarch64/x86_64 apple-darwin, x86_64/aarch64 linux-gnu, x86_64-pc-windows-msvc, wasm32-wasip2).
   - Each spec has only `pointer_width`, `is_like_msvc` (for `src_hash_algorithm`) and `default_codegen_backend`, checked against the oracle.
   - Reading any other field calls `unported` through a Proxy.
   - Any other tuple is unported.
   - `TargetTuple` is the real enum (`from_tuple`, `tuple`, `debug_tuple`, Display). `CrateType` has its real variants.
   - With these, `LinkSelfContained::check_unstable_variants` and `LinkerFeaturesCli::check_unstable_variants` are fully ported now. They run on every invocation.
6. **Build constants of the oracle**, all hard-coded and oracle-checked:
   - `CFG_VERSION` = `1.101.0-nightly (6f5da406b 2026-10-10)`, plus `CFG_VER_HASH`, `CFG_VER_DATE` and `CFG_RELEASE` from UPSTREAM.json.
   - `CFG_DEFAULT_CODEGEN_BACKEND` = `llvm`.
   - `LLVM_VERSION` = `23.1.3`.
   - `CFG_COMPILER_HOST_TRIPLE`: derived from Node `platform/arch` for the 5 rustup host tuples above. Otherwise it is `None`, so `host_tuple()` panics like a rustc built without it.
7. **Sysroot.** `filesearch::default_sysroot()` has no TS counterpart (`current_dll_path`). The stand-in returns the marker path `<rust-ts: default sysroot unported>`.
   - With that path, `real_rust_source_base_dir` and `real_rustc_dev_source_base_dir` are `None`.
   - Nothing on the driver path reads the sysroot's files. Root: decide what rust-ts's sysroot is before metadata (M5).
8. **Codegen backend.** The `LlvmCodegenBackend` stand-in (rustc_interface/stand_ins.ts) works like this:
   - `init` returns deferred fields.
   - `print_version` prints the pinned LLVM version.
   - `target_config`, `print_passes` and `metadata_loader` are unported.
9. **Profiler.** `SelfProfilerRef` is a stand-in (no self-profiler and no `-Z time-passes`, as computed upstream). The other cases are unported.
10. **Jobserver.** `jobserver::initialize` with no `CARGO_MAKEFLAGS`/`MAKEFLAGS`/`MFLAGS` creates a client silently, as upstream does. An inherited jobserver is unported.
11. **Threads.** `run_in_thread_with_globals` runs on the JS main thread, inside `create_session_globals_then`. A parallel frontend is unported.
12. **Unwinding in `run_compiler`.** `catch_unwind(f)` catches `Panic` and `FatalErrorMarker` only; `Unported` propagates.
    - If `abort_if_errors` raises, the closure unwinds with `drop_compiler_dcx(dcx, true)`. There is no explicit `flush_delayed`, as upstream.
    - On the normal path, `drop_compiler_dcx(dcx, false)` runs under `prof.generic_activity("drop_compiler")`. This is fix-w23b's hook.
    - `EarlyDiagCtxt::set_error_format` and the `drop(default_early_dcx)` in `compiler_entrypoint` call `DiagCtxtInner::drop` on the replaced or dropped `DiagCtxt`.
13. **stdout and stderr.** `print!`/`eprintln!` are synchronous `writeSync` to fd 1/2 (`std_print` in config.ts). Root: move this to src/std/io.ts.
14. **Session field `unstable_features`.** It is `UnstableFeatures::from_environment(None)`, which is what session.rs:1499 has at the pin.
    - Review w456b says it should be `from_environment(crate_name)`, but the pinned source passes `None`. `opts.unstable_features`, built in `build_session_options`, is the one that uses `--crate-name`.
    - I followed the pin. Root: please reconcile with the reviewer.
15. **Naming.**
    - `RustcOptGroup.long_name_`: the field clashes with the accessor.
    - `Sysroot.default_`.
    - `rustc_interface/lib.ts` exports the module as `interface_` (reserved word).
    - getopts' `parsing_style_`/`long_only_` fields; `opt_get` takes an explicit `from_str`.
16. **`define_output_types!`** (config.rs:668) is expanded by hand: one table, plus each generated fn reading its column. Markers are at the fn lines inside the macro.

## `unported(...)` left on reachable paths
- **Parser (pending lane parser-core).** `src/rustc_interface/pending_parser.ts` holds `new_parser_from_file`, `new_parser_from_source_str` and `unwrap_or_emit_fatal`. **Remove it on integration:**
  - Import these from `../rustc_parse/lib.ts` in `rustc_interface/passes.ts` and `rustc_driver_impl/lib.ts`. parser-core's lib.ts uses the same names and signatures.
  - Make sure the `Parser` methods `parse_crate_mod` and `parse_inner_attributes` are loaded.
- **getopts usage.** `--help`, no args, and the `ArgumentMissing` usage (`-o`, `--explain`) need `unicode_width::tables::width_in_str`, which is unported (vendor unicode-width, not mine).
- **rustc_target.** `Target` fields beyond the stand-in, `TargetTuple::from_path` (`--target x.json`), unknown targets, `TARGETS` suggestions, `LinkerFlavorCli::is_unstable` (`-C linker-flavor`), and `LinkSelfContainedComponents::as_str` (the inconsistent `-C link-self-contained` error).
- **Other crates and modules:**
  - search_paths `SearchPath::from_cli_opt` (`-L`)
  - native_libs `parse_native_lib` (`-l`)
  - `CanonicalizedPath::new` (`--extern name=path`)
  - `JsonEmitter` (`--error-format=json`)
  - `SelfProfiler` (`-Z self-profile`)
  - time-passes printing
  - `RUSTC_LOG`
  - stdin input (`-`)
  - `handle_explain` (`--explain`)
  - `describe_lints` (`-W help`)
  - `print_crate_info` with any `--print`
  - `list_metadata` (`-Z ls`)
  - `process_rlink` (`-Z link-only`)
  - `create_and_enter_global_ctxt` (expansion and everything after it, and `-Zunpretty` modes needing the AST map)
  - `-Z crate-attr` (rustc_builtin_macros)
  - parallel frontend
  - `-C passes=list`
  - dylib / sysroot codegen backends
  - `Input::filestem`, `OutFileName::{parent, filestem}` (no `Path::file_stem`/`parent` in src/std)
  - `FileWriteFail` (`-o` write errors)

## For root
- **scope.json** (harness/, not mine): add `"getopts": "=0.2.24"` to `vendor`. That clears the 105 `--check` errors.
- **parse.ts `dyn_buffer_lint_sess`** (session-parse's file; review w456b): now that `Session` is a class, add upstream's runtime check `if (!(sess instanceof Session)) panic("expected a `Session`")`.
  - parse.ts would then import session.ts as a value, inside the function only. session.ts imports parse.ts, so the cycle needs checking.
  - I did not take this because it is outside my ownership.
- **utils.ts and diagnostics.test.ts** were edited (see Files); please confirm with session-parse's owner.
- **Move helpers into src/std:**
  - `std_print`/`eprintln` (config.ts)
  - `str_lines` (args.ts)
  - `Path::parent`/`file_stem`
  - the code-point `str_cmp` (now duplicated in config.ts, symbol.ts, lint_defs and the emitter)
- **unicode-width** `width_in_str` would turn on `--help` and the getopts usage tests (9 todos).
- `docs/claims/wave6b-driver-session.md` can be removed on integration.
