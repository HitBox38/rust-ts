# Handoff: cg-write (M7, wave 40o; plan-m7 wave 42): rustc_codegen_llvm's backend driver

Branch `t3/port-cg-write-backend` (from `ba273e7f`; no merges). Commits: see the end.

## Summary
- **Ported whole, in upstream order, with markers:** `back/write.rs` (32/32), `llvm_util.rs` (26/26),
  `back/owned_target_machine.rs` (3/3), `back/owned_mc_subtarget_info.rs` (3/3, new file), `back/profiling.rs` (6/6, new
  file) and `back/archive.rs` (7/7). No `unported("cg-write: ...")` is left in the crate.
- `back/owned_mc_subtarget_info.rs` is on no list but plan-m7 §2b's `back/owned_*`; `llvm_util::target_config` needs it, so I
  ported it here (`src/rustc_codegen_llvm/back/owned_mc_subtarget_info.ts`). `back/mod.rs` has no fns. `back/llvm_backend.rs` was
  cg-contract's (its handoff asked root to take it off this lane's list).
- **Checked against the oracle** (pinned rustc, empty `#![no_core]` lib, x86_64-unknown-linux-gnu and aarch64-apple-darwin):
  - the 23 arguments of both `LLVMRustCreateTargetMachine` calls (`create_informational_target_machine` from `create_module`,
    `create_target_machine` from `ModuleLlvm::new`) are the oracle's, value for value;
  - `get_version` / `print_version` are `rustc -vV`'s `LLVM version: 23.1.3`;
  - `codegen` with `emit_ir` writes a module the port built to `<cgu>.rcgu.ll`, byte-identical to the oracle's
    `--emit=llvm-ir -Cno-prepopulate-passes` output (cg-context's fixture).
- The backend is still not registered. Samples: `mono-ui` and `mir-o2` 200/200 MATCH each.

## Files touched
| file | what |
|---|---|
| `src/rustc_codegen_llvm/back/write.ts` | write.rs, ported (was the skeleton) |
| `src/rustc_codegen_llvm/llvm_util.ts` | llvm_util.rs, ported (was the skeleton) |
| `src/rustc_codegen_llvm/back/owned_target_machine.ts` | owned_target_machine.rs, ported |
| `src/rustc_codegen_llvm/back/owned_mc_subtarget_info.ts` | new: owned_mc_subtarget_info.rs |
| `src/rustc_codegen_llvm/back/profiling.ts` | new: profiling.rs |
| `src/rustc_codegen_llvm/back/archive.ts` | archive.rs, ported (was the skeleton) |
| `src/rustc_codegen_llvm/back/write.test.ts` | new: tests (Evidence) |
| `src/rustc_codegen_llvm/back/write_oracle/` | new: `<target>.tm` (recorded TM arguments), `version.txt`, `record_tm.py` (the lldb recorder), `record.ts` (its hand-run driver) and `README.md` (review N1) |
| `src/rustc_codegen_llvm/skeleton.test.ts` | the count table (cg-write's line gone; the new owners below), the sketch's `get_version` step, and the two `init`/`print` stops |

`.env.local` was copied for setup (gitignored).

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_codegen_llvm/src/<file>`)
| file | ported |
|---|---|
| back/write.rs | 32/32 |
| llvm_util.rs | 26/26 |
| back/owned_target_machine.rs | 3/3 |
| back/owned_mc_subtarget_info.rs | 3/3 |
| back/profiling.rs | 6/6 |
| back/archive.rs | 7/7 |

- `bun scripts/coverage.ts --check --offline`: `markers ok (26657, 44 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311;
  library 744; llvm 404)`.
- `--order`: no rows for these files. The nested fns (`llvm_arg_to_arg_name`, `handle_offload`, `demangle_callback`, `ignored`,
  archive's `callback` / `error_callback`) are module functions placed right after their enclosing fn, which keeps the order.

## Evidence
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_codegen_llvm/ ./src/rust_ts/llvm/ ./src/std/result.test.ts`: **216 pass, 0 fail**
  (19 files).
- `bun test ./scripts/lib/unit-steps.test.ts`: 10 pass. The new test reads only `RUST_TS_REQUIRE_PROBES` and `RUST_TS_AGENT`.
- `back/write.test.ts` (14 tests at first; 12 after review N1 removed the two lldb re-recordings):
  - **Target machine settings, per target.** A real `TyCtxt` from the port's front end for `context_oracle/empty.rs` with the
    oracle's flags; `ModuleLlvm::new(tcx, <oracle ModuleID>)`; each `LLVMRustCreateTargetMachine` call is written in record.ts's
    argument form and must equal `write_oracle/<target>.tm`. The oracle side:
    - x86_64: `("x86_64-unknown-linux-gnu", "x86-64", "", "", 5, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, "", "", 0, 0, 0, 0)`, then the
      same with `OutputObjFile` `"empty.empty.152e68e9976e7355-cgu.0.rcgu.o"`;
    - host: `("arm64-apple-macosx11.0.0", "apple-m1", "", "", 5, 1, 0, 0, 0, 0, 1, 1, ...)` (no function/data sections), likewise.
  - **How the oracle was recorded.** `LLVMRustCreateTargetMachine` is a wrapper inside librustc_driver, so record.ts cannot see
    it (it interposes on the exported C API). The symbol is in the dylib's local symbol table (`nm`: `t
    _LLVMRustCreateTargetMachine`), so `write_oracle/record_tm.py` breaks at its entry under lldb and reads the arguments: x0-x7,
    then the stack per Apple's arm64 ABI (natural size and alignment). Its header documents the layout. The strings read through
    the stack pointers (`""` and the object path) confirm the offsets.
  - **The version fixture is current** (skips without the toolchain unless `RUST_TS_REQUIRE_PROBES=1`): `rustc -vV` must reproduce
    `version.txt`. *Superseded by review N1:* the lldb re-recording of `<target>.tm` is no longer a test; it is
    `bun src/rustc_codegen_llvm/back/write_oracle/record.ts`, run by hand (write_oracle/README.md says when). rustc gets a SIGUSR1 on
    the host target, so the recorder tells lldb to pass it without stopping.
  - **get_version / print_version** (`std_print` spied) against `version.txt`.
  - **`--emit=llvm-ir`**: the module from `ModuleLlvm::new` + `CodegenCx::new` goes through `write::codegen` with a `ModuleConfig`
    of `emit_ir` only and `--out-dir` in the work directory. The written `.rcgu.ll` must equal `context_oracle/<target>.ll`.
    `DiagnosticHandlers` must read, configure and restore the handler (`get`, `configure false [] 0 undefined false`, `set`),
    and nothing is emitted. `codegen` then stops in `into_compiled_module` (rustc_codegen_ssa lib.ts's own
    `OutputFilenames::temp_path_for_cgu` stub, ssa-write's), after the file is written; the test expects exactly that stop.
  - **Helpers:** `to_llvm_features` (renames, ties, filters, the LLVM-24 Nvptx gate), `global_llvm_features` equals the session's
    `global_backend_features` (computed by the stand-in backend's copy) on both targets, `target_cpu` / `tune_cpu`,
    `update_target_reliable_float_cfg` on both targets.
  - **Stops:** `OwnedMCSubtargetInfo::new`, `OwnedTargetMachine::drop`, `print_passes`, `llvm_optimize` stop at the model's names;
    `LlvmArchiveBuilderBuilder::new_archive_builder` builds an `ArArchiveBuilder`.
  - **The tests bite.** With `use_init_array` negated, both TM tests fail on argument 17 (`1` against `0`). With `apple-m1` changed
    to `apple-m2` in the host fixture, the fixtures-current test fails. Both reverted.
- **Test doubles** (restored after each test): line-by-line copies of the upstream bodies of `OutputFilenames::{temp_path_for_cgu,
  temp_path_ext_for_cgu, temp_path_dwo_for_cgu, split_dwarf_path}` and `maybe_strip_file_name` (rustc_session config.rs:1239-1395)
  and `ModuleConfig::bitcode_needed` (rustc_codegen_ssa back/write.rs:269). The model's `LLVMRustCreateTargetMachine` (records,
  returns an opaque machine with the oracle's data layout), `LLVMRustSetDataLayoutFromTargetMachine` (applies it),
  `LLVMDisposeTargetMachine` and the three diagnostic-handler wrappers (no handler). `SharedEmitter_clone_box` returns a
  recording emitter.
- **Sample difftests**, `RUST_TS_AGENT=cg-write`, `--sample 200 --jobs 6`, AC power:
  - `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-213438-cg-write-0oh0`.
  - `mir-o2`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-213528-cg-write-143e`.
  - The backend is not registered, so nothing changes, as expected.

## IR-model stops (each an `unported("llir: <fn>")` in ffi.ts; plan-m7 D8: opt/llc are `llir-tools`')
Reached by every compile once the backend is registered:
- `LLVMIsMultithreaded`: `llvm_util::init`, its first call (so `CodegenBackend::init` stops here).
- `LLVMRustInstallErrorHandlers`, then `rustc_llvm::initialize_available_targets` (a local `unported("llir: ...")`: rustc_llvm has
  no TS side) and `LLVMRustSetLLVMOptions`: `configure_llvm`.
- `LLVMRustCreateMCSubtargetInfo`, `LLVMRustMCSubtargetInfoCheckFeatures`, `LLVMRustDisposeMCSubtargetInfo`: `target_config`
  (through `OwnedMCSubtargetInfo`).
- `LLVMRustCreateTargetMachine`, `LLVMDisposeTargetMachine`: `OwnedTargetMachine::{new, drop}` (every
  `create_target_machine` / `create_informational_target_machine`).
- `LLVMRustContextGetDiagnosticHandler`, `LLVMRustContextConfigureDiagnosticHandler`, `LLVMRustContextSetDiagnosticHandler`:
  `DiagnosticHandlers::{new, drop}`, in every `optimize` and `codegen`.
- **`LLVMRustOptimize`**: `llvm_optimize`, from every `optimize` whose `ModuleConfig` has an opt level (that includes `-O0`).
- **`LLVMRustWriteOutputFile`**: `write_output_file` (`--emit=asm`, and object output).
On particular flags:
- `LLVMCloneModule`: `codegen` with `--emit=asm` and an object.
- `LLVMWriteBitcodeToFile`: `save_temp_bitcode` (`-C save-temps`).
- `LLVMRustAppendModuleInlineAsm` (through `llvm::append_module_inline_asm`): `embed_bitcode` on ELF/COFF.
- `LLVMRustWriteDiagnosticInfoToString`: `diagnostic_handler` (PGO, linker, unsupported diagnostics).
- `LLVMRustLLVMHasZlibCompression` / `LLVMRustLLVMHasZstdCompression`: `-Z debuginfo-compression`.
- `LLVMRustModuleInstructionStats`: only with a self-profiler (never, see below).
- `LLVMRustTimeTraceProfilerInitialize` / `Finish`: `-Z llvm-time-trace`.
- `LLVMRustDisableSystemDialogsOnCrash`: `configure_llvm` with `CI` set.
- `LLVMRustPrintPasses`, `LLVMRustGetTargetFeaturesCount`, `LLVMRustGetTargetFeature`, `LLVMRustPrintTargetCPUs`,
  `LLVMRustGetHostCPUName`, `LLVMGetHostCPUFeatures`, `LLVMDisposeMessage`, `LLVMRustTargetHasMnemonic`: `--print passes /
  target-cpus / target-features`, `-C target-cpu=native`, `-Z tune-cpu=native`, `target_has_mnemonic` (inline asm, D10).
- `LLVMRustGetSymbols`, `LLVMRustIs64BitSymbolicFile`, `LLVMRustIsECObject`, `LLVMRustIsAnyArm64Coff`: back/archive.rs's object
  reader (`LLVM_OBJECT_READER`), when the archive writer asks it.

## Cross-lane stubs this lane calls (typed stubs at the end of back/write.ts unless noted; counted in skeleton.test.ts)
- **ssa-write** (8; running in parallel): `ModuleConfig::{bitcode_needed, embed_bitcode}`, `SharedEmitter` as the `Emitter`
  `DiagCtxt::new` takes (`SharedEmitter_clone_box`), `SharedEmitter::inline_asm_error`, and rustc_session's
  `OutputFilenames::{temp_path_for_cgu, temp_path_dwo_for_cgu, temp_path_ext_for_cgu, split_dwarf_path}` (next.md gives those
  to ssa-write).
  - **Views (PORT, for root at merge):** `CodegenContext` and `ModuleConfig` are ssa-contract's opaque placeholders, so write.ts
    reads them through `cgcx_(cgcx)` / `config_(config)`, a type-level view as interfaces of the upstream fields it reads
    (`CodegenContextFields`, `ModuleConfigFields`), plus local `EmitObj` / `BitcodeSection` / `InlineAsmError` types. When
    ssa-write's structs land, replace the views and local types with them and the stubs above with its methods.
- **cg-lto-diag** (4): `impl Diagnostic for WithLlvmError` and `for ParseTargetMachineConfig` (hand impls in diagnostics.rs;
  tools/codegen generates only the derives), `llvm::diagnostic::Diagnostic::unpack` (write.ts carries the variant shapes it
  reads, as a local type), back/lto.rs's private `Buffer::data`. Also, as before, `ModuleBuffer::{new, data}` (lto.ts stubs).
- **excluded (plan-m7 D18)** (5): `EnzymeWrapper::get_instance` (autodiff), three `RustOffloadWrapper` calls and
  `gpu_offload::scalar_width` (offload; gpu_offload.ts has no stub for it, so it is local).
- **rustc_data_structures** (4): the self-profiler: `TimingGuard::start` (profiling.ts), `SelfProfilerRef::{get_self_profiler,
  llvm_recording_enabled, artifact_size}` with a profiler. Unreachable: the stand-in never has one.
- **rustc_session** (1): `filesearch::dll_path` in the LLVM-version-mismatch error (never: the model's version is the oracle's).
- **rustc_fs_util** (1): `link_or_copy` (`EmitObj::Bitcode`).
- **rustc_codegen_llvm** (1): `create_msvc_imps` of a symbol name that is not UTF-8 (`add_global` takes text).
- **llir** (1): `rustc_llvm::initialize_available_targets` (above).

## `// PORT:` decisions (for root to record)
1. **The `CodegenContext` / `ModuleConfig` views** (cross-lane section above). Not a redesign: field names and types are
   upstream's; the cast is the only non-upstream line, at one place each.
2. **`SelfProfilerRef` methods the stand-in lacks** (`enabled`, `llvm_recording_enabled`, `generic_activity_with_arg`,
   `artifact_size`) are local helpers that answer as upstream does with no profiler and an empty event mask. **Root:** they
   belong on rustc_session's stand-in.
3. **`rustc_fs_util::path_to_c_string`** (not ported there) is a local copy of its Unix body (`CString::new(bytes).unwrap()`).
4. **Drops on the normal path only.** `print`, `target_has_mnemonic` and `target_config` drop their `OwnedTargetMachine` /
   `OwnedMCSubtargetInfo`, and `optimize` / `codegen` their `DiagnosticHandlers`, after the body returns, not in a `finally`, so a
   stop in the body stays the stop reported (a drop reaches a model stop itself). Same as cg-context's `tm.drop()`.
5. **`static INIT: Once`** is a module-level `{ completed }`, set after `configure_llvm` returns (PORTING §5).
6. **`CStr::to_str()` on model strings**: the model hands JS strings, so the non-UTF-8 `bug!`/`expect` arms are unreachable
   (comments at each).
7. **Lazy crate imports in write.ts** (`attributes`, `base`, `builder`, `common`, `context`, `type_`, `lto` through `require`, as
   context.ts does): a top-level import of builder.ts from write.ts ran builder.ts's extension modules before `Builder` existed.
8. `rustc_llvm::initialize_available_targets` is an IR-model stop (rustc_llvm is excluded and the model has no target registry).
9. The `LLVMRustCreateTargetMachine` oracle is recorded with lldb, not record.ts (Evidence). If root prefers one recorder, the
   breakpoint could move into the harness-owned interposer (review llir-core-a N12).

## For root
- *Resolved by review N1:* no unit test runs lldb any more.
- src/rust_ts/codegen_backend.ts still holds its own copies of `global_llvm_features`, `to_llvm_features`,
  `update_target_reliable_float_cfg` and `target_cpu`. The test checks the port gives the stand-in's `global_backend_features`
  on both targets. Once the backend is registered the copies can go (not this lane's file).
- `x86_64-unknown-linux-gnu`'s `RelaxELFRelocations` is `0` in the oracle's call too; the port matches.

## Review fixes (docs/reviews/cg-write.md, PASS WITH NOTES; branch `t3/review-cg-write-port`, `11153680`)
- **N1 (root's decision):** the lldb re-recording is out of the unit tests. `write.test.ts` keeps the comparison of the port's 23
  `LLVMRustCreateTargetMachine` arguments with the committed `<target>.tm` and the `rustc -vV` check against `version.txt`.
  Re-recording is `bun src/rustc_codegen_llvm/back/write_oracle/record.ts` (writes `<target>.tm` and `version.txt`; one line per
  file, `ERROR:` on failure), and `write_oracle/README.md` says how and when to re-run it. Run once here: the three fixtures came out
  unchanged. No environment variable is read by the test or the script (the script spreads `process.env` to its children only);
  nothing under `scripts/` or `harness/` changed.
  - `bun test ./scripts/lib/unit-steps.test.ts`: passes (in the run below).
  - With lldb unresolvable (`PATH=$HOME/.cargo/bin:/bin`, where `command -v lldb` finds nothing) and
    `RUST_TS_REQUIRE_PROBES=1`: `write.test.ts` **12 pass, 0 fail**, nothing skipped. PATH was only set for that command.
- **N3:** `with_tcx` compiles the relative `empty.rs` from the work directory, as the oracle was run (cwd restored in a `finally`).
  The emit test's `--out-dir` is relative too, and its output is read through the work directory.
- **N4:** the skeleton.test.ts comment names `back/write.test.ts`.
- **N5 (optional, done):** archive.ts's `error_callback` decodes with `{ ignoreBOM: true }`, as `to_string_lossy` keeps U+FEFF.
- **N6:** `target_config` (llvm_util.ts) says why `SmallCStr::new`'s interior-NUL panic is dropped (a NUL cannot come from argv,
  only from a target-spec JSON); `target_machine_factory` (write.ts) points at it.
- **N2 (optional, not done):** `SelfProfilerRef_generic_activity_with_arg` keeps the stand-in's `VerboseTimingGuard` type. The
  stand-in has no `TimingGuard` type to return, so the fix belongs with moving these helpers onto the stand-in (PORT decision 2).
- After the fixes: `bunx tsc --noEmit -p .` clean; `coverage.ts --check --offline` markers ok (26657); `RUST_TS_REQUIRE_PROBES=1
  bun test ./src/rustc_codegen_llvm/ ./src/rust_ts/llvm/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts`: **224 pass,
  0 fail** (20 files).

## Commits
- `2e11cd16` port of the six files, skeleton.test.ts counts.
- `b2203c1a` tests and oracle fixtures.
- `f042a45c` `create_msvc_imps`: the `__imp_` name as UTF-8 text.
- `d50983fe` this handoff.
- `c43c885f` review fixes N1, N3, N4, N5, N6.
- The commit of this handoff update.
