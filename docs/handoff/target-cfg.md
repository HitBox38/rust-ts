# Handoff: target-cfg (wave 8, M2 foundations)

Branch `lane/target-cfg` (main merged at aa2e805, i.e. hir-def + attr-ir-gen).

`rustc_target` is ported for six built-in targets. `--print cfg`, `--print target-spec-json`, the
`target_config` table, `--cfg`/`--check-cfg` parsing and the session's command-line validation all run for
real now. Root's extra items (parse_cfg/parse_check_cfg; review parser-b findings 1, 2, 6) are in this lane.

## ROOT ACTION before merging
**`RUST_TS_HOST_TUPLE` must be set in `.env.local` on every machine** to the oracle's `rustc -vV` `host:`.
For example `RUST_TS_HOST_TUPLE=x86_64-pc-windows-msvc` on Windows, `aarch64-apple-darwin` on this Mac.
- Without it, `host_tuple()` calls `unported` and every protected case turns UNPORTED.
- This fixes review parser-b finding 6: the Node `platform/arch` guess is gone.
- `print.oracle.test.ts` checks the value against `rustc -vV`.
- `config.ts` reads it from the environment first, then from the repo's `.env.local`, so a direct `bun src/rust_ts/main.ts` works too.

## Files
- **New: rustc_target**
  - `src/rustc_target/lib.ts`: crate root. Import rustc_target only through this file, because `target_features.ts` extends `Target`.
  - `json.ts`
  - `target_features.ts`
  - `stand_ins.ts`: `SanitizerSet`, see below.
  - `spec/{mod,json,tuple,crt_objects}.ts`
  - `spec/base/{mod,linux,linux_gnu,msvc,windows_msvc,wasm}.ts`, `spec/base/apple/mod.ts`
  - `spec/targets/{mod,x86_64_unknown_linux_gnu,aarch64_unknown_linux_gnu,aarch64_apple_darwin,x86_64_apple_darwin,x86_64_pc_windows_msvc,wasm32_wasip2}.ts`
- **New: rustc_abi subset** (no lane owned it): `src/rustc_abi/lib.ts`, which covers the data layout parser, `Endian`, `Size`, `Align`, `Integer::from_size`, `AddressSpace` and `CVariadicStatus`; and `src/rustc_abi/canon_abi.ts`.
- **New: rustc_session**
  - `src/rustc_session/config/cfg.ts`
  - `filesearch.ts`
  - `search_paths.ts`
- **New: generator and tests**
  - `tools/codegen/target-config.ts` with `--check`, plus `tools/codegen/target-config/probe.rs`: a rustc_private probe built into `$RUST_TS_DATA/probes/target-config`.
  - `src/rust_ts/target_config.gen.ts`: GENERATED.
  - `tools/codegen/target-config.test.ts`
  - `src/rustc_driver_impl/print.oracle.test.ts`: 134 tests.
- **Changed (mine):**
  - `src/rustc_session/stand_ins.ts`: the target stand-ins are now re-exports.
  - `config.ts`:
    - `build_configuration`, `Lto`, the host tuple.
    - `-L` via `SearchPath::from_cli_opt`.
    - The `build_target_config` error path, with TARGETS suggestions.
    - The linker-flavor and `link-self-contained` checks.
  - `src/rustc_interface/stand_ins.ts`: `TargetConfig`, `target_config`, `init`.
  - `src/rustc_driver_impl/lib.ts`: `print_crate_info`.
- **Changed outside the listed ownership.** These were needed by the brief or by root's messages:
  - `rustc_interface/interface.ts`: `parse_cfg` and `parse_check_cfg` (root asked for these). `run_compiler` now calls `target_config`, `parse_cfg`, `add_configuration`, `parse_check_cfg` and `check_abi_required_features`.
  - `rustc_interface/util.ts`: `add_configuration`, `check_abi_required_features`.
  - `rustc_session/session.ts`:
    - `EarlySession::sanitizers`
    - `lto`, `split_debuginfo`, `dwarf_version`, `codegen_units`
    - `overflow_checks`, `ub_checks`, `contract_checks`
    - `target_filesearch`, `host_filesearch`, `wasm_proc_macro_filesearch`
    - `validate_commandline_args_with_session_available` (review parser-b finding 1)
    - `build_session` now computes `target_tlib_path`, the filesearches, `sanitizers` and `pointer_auth_config`. `Session.config`/`check_config` are the real `Cfg`/`CheckCfg`.
  - `rustc_session/diagnostics.ts`: the `StackProtector`/`TargetTuple`/`SplitDebuginfo` stand-ins are now the real types and `into_diag_arg`s.
  - `rustc_driver_impl/driver.oracle.test.ts`: the old target stand-in test was removed; `print.oracle.test.ts` replaces it.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (4218; vendor 2323).
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 2180 pass, 3 fail, 1 skip. None of the four is in this lane's files:
  - `tools/codegen/attr_ir.test.ts` golden: fails identically at main aa2e805 (hir-def's rustc_structures after attr-ir-gen).
  - `src/vendor/termize` "no fd leak under a pty" (stdio branch): fails and its /dev/tty branch skips, both environment-dependent (pty).
  - `src/vendor/unicode_width` `test_vs1_vs2_vs3`: 5 s timeout on this machine; it also times out in isolation, as does `test_khmer_coeng`.
- `RUST_TS_AGENT=target-cfg bun scripts/difftest.ts --suite parse --sample 300`: 300/300 MATCH (run `20261013-030339-target-cfg-7rzd`).
- Exact oracle matches on all 6 targets (`--target T`):
  - `--print cfg`
  - `-Zunstable-options --print target-spec-json`
  - cfg variants: opt-level, panic, overflow-checks, debug-assertions, fmt-debug, ub-checks, contract-checks, proc-macro, `--test`
  - `--print split-debuginfo|target-libdir|check-cfg`
  - `-Zunpretty=ast-tree`
- Other exact matches:
  - `--print target-list|host-tuple|sysroot|wasm-proc-macro-tuple`
  - an unknown `--target` (with the "did you mean" suggestion)
  - about 20 `validate_commandline_args…` repros: `-Cdwarf-version=7`, `-Zregparm=5`, `-Cprofile-use=…`, VFE, `reg-struct-return`, `packed-stack`, `function-return`, `embed-source`, `small-data-threshold`, the sanitizer-cfi checks, `branch-protection`, `force-unwind-tables`, `instrument-mcount`/`xray`, `linker-flavor`, `split-debuginfo` on msvc, and others
- **Pending until lane stable-hash wires `FileName::cfg_spec_source_code`** (rustc_span lib.rs:634, StableHasher):
  - every `--cfg`/`--check-cfg` case. They stop at `unported: rustc_data_structures::stable_hasher::StableHasher`.
  - In a scratch run with that one fn stubbed, every `--cfg`/`--check-cfg` case in the test matched rustc byte for byte: about 30 cases, including all the "invalid `--cfg`/`--check-cfg` argument" diagnostics, `--print check-cfg`, and `cfg(test,FALSE)`. The tests then turn into exact matches with no change.
  - Root's parse-ui suite (991 cases) needs this too.
- `coverage --missing`:

  | file | fns |
  |---|---|
  | spec/mod.rs | 86/97 |
  | rustc_target lib.rs | 8/10 |
  | json.rs | 15/16 |
  | spec/json.rs | 1/9 (`to_json` only) |
  | tuple.rs | 6/9 |
  | target_features.rs | 13/13 |
  | crt_objects.rs | 11/11 |
  | base/apple/mod.rs | 16/16 |
  | the 6 targets and their bases | all |
  | config/cfg.rs | 7/7 |
  | search_paths.rs | 4/4 |
  | filesearch.rs | 7/14 |
  | session.rs | 75+/104 |
  | interface.rs | 3/4 |
  | util.rs | 7/21 |
  | rustc_driver_impl lib.rs | 24/43 |
  | rustc_abi lib.rs | 26/157 |
  | canon_abi.rs | 1/2 |

## PORT decisions (root: please record)
1. **D4 extension: generated `BUILTIN_TARGET_CFG_VALUES`.** `CheckCfg::fill_well_known` iterates `Target::builtins()`, which needs all 334 specs.
   - The `target_*` values of every built-in come from a table generated from the oracle (`rustc --print cfg --target T`, same generator).
   - The current target's values come from its ported spec.
   - `load_all_builtins` itself stays `unported` for unported targets.
2. **`target_config` table.** It covers the 6 ported targets, from a rustc_private probe that prints `sess.internal_target_features`. The probe is needed because `--print cfg` hides InternalOnly features, e.g. `fp-armv8` on aarch64.
   - The table holds only for default LLVM inputs. Any non-default input calls `unported` with the flag's name. In `LlvmCodegenBackend.init` (`configure_llvm`):
     - `-Cllvm-args`, `-Ctarget-cpu`, `-Ctarget-feature`
     - `-Zllvm-target-feature`, `-Zllvm-plugins`, `-Ztime-llvm-passes`, `-Zprint-llvm-passes`
     - codegen stats, `-Zautodiff`
     - `-Zsmall-data-threshold` (only on LlvmArg targets)
     - `-Zfixed-x18`, `-Zretpoline*`
     - `-Cpanic` with wasm EH
   - `target_config` additionally treats `-Zsanitizer` as non-default.
   - This covers review parser-b finding 2.
   - `CodegenBackendInit` returns upstream's literal `replaced_intrinsics`, `fallback_intrinsics` and `thin_lto_supported: true`. `global_backend_features` stays deferred.
3. **`Target` derefs to `options`.** Getters and setters on `Target.prototype` forward every `TargetOptions` field and method. Four `Target` methods clash with field names and get a `_` suffix: `min_atomic_width_()`, `max_atomic_width_()`, `singlethread_()`, `small_data_threshold_support_()`.
4. **`TargetOptions` is a class built from a field object** (123 fields). Struct update `..base` becomes `TargetOptions.update(base, {…})`, which updates the moved base in place. Private upstream fields are public.
5. **Interning and order.** `LinkerFlavor`/`LinkerFlavorCli` values are interned (frozen singletons), so `===` and Map keys work. `BTreeMap` order comes from derived-`Ord` comparators (`btree_entries`).
6. **Enum representations.**
   - `target_spec_enum!` is a helper (`target_spec_enum`, `target_spec_other_enum`) with markers on lib.rs's macro fns.
   - Closed enums are string unions.
   - Enums with an `other_variant` (`Arch`, `Os`, `Env`, `CfgAbi`, `LlvmAbi`) are `{ $ }` singletons plus `{ $: "Other", _0 }`.
7. **`Cfg`** is a class: an insertion-ordered set of `(Symbol, Symbol | undefined)`. `ExpectedValues` uses `Set<Symbol | undefined>`.
8. **`CFG_DEFAULT_LINKER_SELF_CONTAINED_LLD_CC`** is treated as unset (base/linux_gnu.rs). The macOS oracle prints `linker-flavor: gnu-cc` for linux-gnu, and the test checks this. A Linux-hosted x86_64 dist rustc sets the variable; revisit if the oracle ever runs on Linux.
9. **`CFG_DEFAULT_LINKER` is unset** and `CFG_LIBDIR_RELATIVE` is the default `lib`. Both are oracle-checked through target-spec-json and target-libdir.
10. **`default_sysroot()`** still returns the marker path, moved to filesearch.ts (`dll_path`/`current_dll_path` have no TS counterpart). Pass `--sysroot`.
11. **serde_json is not vendored.** `rustc_target/json.ts` carries a JS-value `Json` and a `to_string_pretty` that reproduces `PrettyFormatter` for these values. It is oracle-checked on 6 targets.
12. **`SanitizerSet`.** `src/rustc_target/stand_ins.ts` keeps a number-based `SanitizerSet` (methods copied verbatim from rustc_structures, without markers).
    - hir-def's `src/rustc_structures/sanitizer_set.ts` landed on main with a branded type. The options tables and session use plain numbers.
    - Root: unify, then re-export.
13. **`PointerAuthConfig::from_raw`** returns `None` for non-Pauthtest targets, which covers all ported targets. Pauthtest calls `unported`.

## `unported(...)` left (reachable)
- **Built-in targets other than the 6.** `load_builtin` reports `rustc_target::spec::targets::<module> (built-in target T)`. `Target::builtins()` and `--print all-target-specs-json` hit it too.
- **Target JSON:** `Target::from_json`, `TargetTuple::from_path`, `debug_tuple` for TargetJson, and load_file's io::Error text.
- **schemars:** `--print target-spec-json-schema`.
- **object crate:** `BinaryFormat::to_object`, `Target::object_architecture`. Also `Target::is_abi_supported` (AbiMap).
- **`--print` kinds:**
  - `file-names`, `crate-name`, `crate-root-lint-levels`, `calling-conventions`
  - `backend-has-mnemonic`/`zstd`
  - LLVM's relocation-models, code-models, tls-models, target-cpus, stack-protector-strategies, target-features
  - `deployment-target` (`apple_deployment_target`)
  - `supported-crate-types`
- **LLVM inputs** (decision 2 above), and `AbiRequiredTargetFeature` (util.rs check_abi_required_features). The latter is unreachable with default inputs.
- **Other:**
  - `TargetDataLayoutError` diagnostics
  - `CanonAbi` Display (ExternAbi)
  - `FileName::cfg_spec_source_code` (StableHasher, lane stable-hash)
  - `lint_store` (rustc_lint), `asm_arch` (rustc_target::asm), `global_backend_features`: deferred fields

## Notes
- **Slow test.** `print.oracle.test.ts` takes about 105 s: 134 cases, each spawning bun and rustc.
- **Generator.** `bun tools/codegen/target-config.ts` takes about 4 s: it builds the probe once, then runs 334 × `--print cfg` in parallel.
- **Claim file.** Delete `docs/claims/wave8-target-cfg.md` on integration.
