# Handoff: llir-init (M7, wave 40p): the IR model's LLVM-init and target-machine stops, and recorder fixes

Branch `t3/implement-llvm-init-target-machine` (from `7b71d658`; no merges). Commits: see the end.

## Summary
- The 12 IR-model stops cg-write lists for every compile are now implemented in a new module, `src/rust_ts/llvm/target.ts`
  (listed in `impl_modules.ts`; `ffi.ts` regenerated: stubs 119 → 107):
  - `LLVMIsMultithreaded`;
  - `LLVMRustInstallErrorHandlers`;
  - `LLVMRustSetLLVMOptions`;
  - `LLVMRustCreateTargetMachine` and `LLVMDisposeTargetMachine`;
  - the three `LLVMRust*MCSubtargetInfo` calls;
  - `LLVMRustSetDataLayoutFromTargetMachine`;
  - `LLVMRustContext{Get,Set,Configure}DiagnosticHandler`.

  rustc_llvm's `initialize_available_targets` is ported there as well (`// rustc: compiler/rustc_llvm/src/lib.rs:73`).
- **Triple model**: `src/rust_ts/llvm/triple.ts` ports LLVM's `Triple`:
  - the constructor, `parseArch`, `parseVendor`, `parseOS`, `parseEnvironment`, `parseFormat` and `getDefaultFormat`;
  - the `Triple.h` predicates the data layouts need, and `isLittleEndian`;
  - `Triple::computeDataLayout` (TargetDataLayout.cpp), with the X86 and AArch64 layouts and every literal case. The other
    arches' `compute*DataLayout` functions stop by name.
- **Target machine**: a `TargetMachine` class in target.ts. `handles.ts` now re-exports `TargetMachine`, `MCSubtargetInfo` and
  `DiagnosticHandler` from target.ts. The shape was agreed with llir-tools:
  - the 23 arguments of `LLVMRustCreateTargetMachine`, under ffi.rs's parameter names (`Triple`, `CPU`, `Features`, `Abi`,
    `Model`, `Reloc`, `Level`, `FloatABIType`, …, `LargeDataThreshold`), as ffi.ts passes them;
  - `normalizedTriple`, `dataLayout` / `createDataLayout()`, `TargetCPU`, `TargetFS`, `Options` (the `TargetOptions` fields that
    the wrapper and the X86/AArch64 target machines set), `largeDataThreshold` and `disposed`.
- **cl options**: `llvm_cl_args()` returns the options `LLVMRustSetLLVMOptions` accepted (argv without argv[0]). llir-tools
  forwards them to `opt`/`llc`.
- **Recorder** (`record.ts`):
  - **N-a fixed**: at `LLVMContextDispose`, every handle of that context is retired, along with its attribute-set, call-site and
    range state, so a reused address gets a new handle and its own `?attr` line.
  - **Quadratic lookup fixed**: handles, `fa`/`ca` and range entries are found through pointer hash tables.
    - `issue-24313` now records in **8.7 s** (the llir-folder handoff gave about 4 minutes).
    - `task-comm-7 -Copt-level=2` now records in **28.6 s** (before: stopped after 24 CPU-minutes, unfinished).
  - Every committed proof script still records byte for byte.

## Items
| item | state |
|---|---|
| 1. `LLVMIsMultithreaded`, `LLVMRustInstallErrorHandlers`, `initialize_available_targets` + `LLVMInitialize*`, `LLVMRustSetLLVMOptions` | done (PORTs below) |
| 2. `LLVMRustCreateTargetMachine`, `LLVMDisposeTargetMachine`, the three MCSubtargetInfo calls, `LLVMRustSetDataLayoutFromTargetMachine`; data layout from `computeDataLayout` | done for X86 and AArch64 (the M7 targets) |
| 3. diagnostic-handler wrappers | done; a remark file (`-Z remark-dir`) stops |
| 4. recorder N-a and quadratic lookup | done |

**Left:** `rustc_llvm::initialize_available_targets` is still a local stop in `llvm_util.ts` (cg-write's file, not this lane's).
Root needs to make a one-line change in `src/rustc_codegen_llvm/llvm_util.ts` `configure_llvm`: replace
`unported("llir: rustc_llvm::initialize_available_targets");` with `initialize_available_targets();`, imported from
`../rust_ts/llvm/target.ts`, and drop the PORT comment above it. Until then, `CodegenBackend::init` stops there. Before this lane
it stopped at `LLVMIsMultithreaded`.

## Files touched
| file | what |
|---|---|
| `src/rust_ts/llvm/target.ts` | new impl module (all the above) |
| `src/rust_ts/llvm/triple.ts` | new: `Triple`, `computeDataLayout` |
| `src/rust_ts/llvm/subtarget_table.ts` | new: oracle data, MC subtarget feature tables (written by `target.oracle.test.ts` with `REGEN=1`) |
| `src/rust_ts/llvm/tm_fixture.ts` | new test helper: parses cg-write's `<target>.tm` into ffi.ts arguments |
| `src/rust_ts/llvm/target.oracle.test.ts` | new: model tests + differential tests against libLLVM |
| `src/rust_ts/llvm/record.oracle.test.ts` | new: the recorder's handle tables (N-a, hash tables) |
| `src/rust_ts/llvm/record.ts` | hash tables, context retirement |
| `src/rust_ts/llvm/replay.ts` | `ReplayOptions.targetMachines`: hidden target machines from recorded arguments; `configure_llvm`'s hidden init replayed |
| `src/rust_ts/llvm/proof.oracle.test.ts`, `proof/empty.{x86_64-unknown-linux-gnu,aarch64-apple-darwin}.script` | the empty no_core case with no stand-ins; `SKIP_ALLOWED` loses `LLVMIsMultithreaded` |
| `src/rust_ts/llvm/core.ts` | `LLVMRustSetLastError` exported (one word; llir-tools makes the same change) |
| `src/rust_ts/llvm/handles.ts` | the three handle types re-exported from target.ts |
| `src/rust_ts/llvm/impl_modules.ts`, `ffi.ts` | `./target.ts` added; regenerated with `bun tools/llir/ffi_gen.ts` |
| `src/rustc_codegen_llvm/context.test.ts` | stand-ins for target-machine creation, the data-layout wrapper and the dispose removed (Evidence) |
| **outside the brief's list:** `src/rustc_codegen_llvm/skeleton.test.ts` (one assertion), `src/rustc_codegen_llvm/back/write.test.ts` (two assertions) | They asserted the stops this lane removes (`llir: LLVMIsMultithreaded`, `llir: LLVMRustCreateMCSubtargetInfo`, `llir: LLVMDisposeTargetMachine`) and failed. Now: `LLVMIsMultithreaded` answers true; `OwnedMCSubtargetInfo::new("t", …)` stops at `Triple::normalize("t")`; `OwnedTargetMachine::drop` disposes of a real model machine. Root: these are cg-write's / the skeleton's files; review or reassign. |

## Coverage
- WRAPPER figure (`bun scripts/coverage.ts --crate llvm-wrapper`): **63/197** (PassWrapper.cpp 16/50, RustWrapper.cpp 47/132). This
  lane added these markers:
  - PassWrapper.cpp: `LLVMRustCreateMCSubtargetInfo`, `LLVMRustMCSubtargetInfoCheckFeatures`, `LLVMRustDisposeMCSubtargetInfo`,
    five `fromRust`, `LLVMRustCreateTargetMachine`, `LLVMRustSetLLVMOptions`, `LLVMRustSetDataLayoutFromTargetMachine`;
  - RustWrapper.cpp: `FatalErrorHandler`, `BadAllocErrorHandler`, `LLVMRustInstallErrorHandlers` and the three diagnostic-handler
    wrappers.
- `// llvm:` markers: 88 new, in target.ts and triple.ts (83 at first; review fixes added 5).
- `bun scripts/coverage.ts --check --offline`: **fails with 84 `ERROR:` lines (79 before the review fixes), all "names no file of harness/llvm-manifest.json"**,
  because this lane may not add files to the manifest. Nothing else fails.
  - I checked the 88 markers against the pinned sources: I fetched the files from the manifest's repo and commit into my
    scratchpad (not `llvm-src/`), then ran `llvmMarkerErrors` with a temporary manifest that adds them. Result: **0 errors**.
  - After root adds the files below, the check should pass.

## Manifest additions (for root: `bun scripts/llvm-src.ts add <path>…`)
```
llvm/include/llvm/MC/TargetRegistry.h
llvm/include/llvm/Target/TargetMachine.h
llvm/include/llvm/TargetParser/SubtargetFeature.h
llvm/include/llvm/TargetParser/Triple.h
llvm/include/llvm/TargetParser/TripleName.def
llvm/lib/MC/MCSubtargetInfo.cpp
llvm/lib/MC/TargetRegistry.cpp
llvm/lib/Support/ErrorHandling.cpp
llvm/lib/Target/AArch64/AArch64TargetMachine.cpp
llvm/lib/Target/AArch64/MCTargetDesc/AArch64MCTargetDesc.cpp
llvm/lib/Target/AArch64/TargetInfo/AArch64TargetInfo.cpp
llvm/lib/Target/TargetMachine.cpp
llvm/lib/Target/X86/MCTargetDesc/X86MCTargetDesc.cpp
llvm/lib/Target/X86/TargetInfo/X86TargetInfo.cpp
llvm/lib/Target/X86/X86TargetMachine.cpp
llvm/lib/TargetParser/SubtargetFeature.cpp
llvm/lib/TargetParser/TargetDataLayout.cpp
llvm/lib/TargetParser/Triple.cpp
```
`TripleName.def` carries no marker. It is the source of triple.ts's vendor, OS and environment tables, as `Intrinsics.td` is
for the intrinsic table.

## Evidence (AC power; `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`)
- `bunx tsc --noEmit -p .`: clean.
- `bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts`: **262 pass,
  0 fail** (23 files).
- **Differential tests against the pinned libLLVM** (`target.oracle.test.ts`, bun:ffi; the model never calls libLLVM):
  - **Data layouts**: for 27 distinct triples (the first version said 30, counting the M7 two twice: review N1), `Triple::computeDataLayout` equals `LLVMCopyStringRepOfTargetData(LLVMCreateTargetDataLayout(LLVMCreateTargetMachine(…)))`.
    - The triples cover both M7 targets and every branch of the X86 / AArch64 / mangling code: x32, IAMCU, Windows MSVC/GNU, UEFI,
      MachO, COFF, big-endian, ILP32, `-macho` in the environment, and `arm64_32`.
    - Through `LLVMRustCreateTargetMachine` with cg-write's recorded arguments, both targets give libLLVM's layout. That is also
      the oracle's `?datalayout`.
  - **`LLVMIsMultithreaded`**: 1, as in libLLVM.
  - **Components**: libLLVM exports `LLVMInitialize<C>{TargetInfo,Target,TargetMC,AsmPrinter[,AsmParser]}` for each of
    `initialize_available_targets`' 19 components (NVPTX has no AsmParser), and no other `LLVMInitialize*TargetInfo`.
  - **MC subtargets**: for each table entry and every feature of the target (230 X86, 355 AArch64, from the pinned
    `llc -mattr=help`), `subtarget_table.ts` equals libLLVM's `MCSubtargetInfo::checkFeatures("+f")`. The table is re-recorded and
    compared on every run.
    - libLLVM's subtarget comes from `TargetMachine::getMCSubtargetInfo(CPU, FS)`, a C++ export that calls the same
      `Target::createMCSubtargetInfo` the wrapper does.
    - The model's `LLVMRustMCSubtargetInfoCheckFeatures` is also compared with libLLVM on mixed `+`/`-` lists of three features.
    - Entries: `x86_64-unknown-linux-gnu` with `x86-64` and `x86-64-v4`, and `arm64-apple-macosx11.0.0` with `apple-m1`, all with
      an empty feature string.
  - **`ACCEPTED_LLVM_ARGS`**: the oracle runs `rustc -Cllvm-args=<arg> --print cfg --target <t>` for each argument on both targets
    with exit 0, no stderr and unchanged stdout.
- **Record/replay of an empty `#![no_core]` lib with no stand-ins** (`proof.oracle.test.ts` "empty no_core lib", both targets):
  - recorded from process start (`1 = LLVMIsMultithreaded()` on);
  - the recording leaves the IR unchanged;
  - the script equals the committed `proof/empty.<target>.script`;
  - replay runs with cg-write's `.tm` arguments, with **nothing skipped and no stubbed effects**;
  - `LLVMIsMultithreaded` is replayed and checked;
  - replay infers `LLVMRustInstallErrorHandlers` + `initialize_available_targets` after `configure_llvm`'s first `LLVMGetVersion`;
  - each `?datalayout` replays as the model's `LLVMRustCreateTargetMachine` + `LLVMRustSetDataLayoutFromTargetMachine`, checked
    against the recorded layout;
  - `LLVMDisposeTargetMachine(%4)` disposes of that machine;
  - the printed module reaches the oracle's N1 normal form.

  The committed scripts also replay without the toolchain. The other 17 proof cases are unchanged (34 pass in the file).
- **`CodegenCx::new` oracle test** (`context.test.ts`, both targets) passes without its stand-ins:
  - `create_informational_target_machine` and `create_target_machine` are the real ones;
  - the drop is `OwnedTargetMachine::drop` → the model's `LLVMDisposeTargetMachine`;
  - `LLVMRustSetDataLayoutFromTargetMachine` is the model's, and the `?datalayout` line is written from the module after the
    wrapper call, as for the other wrappers.

  The test first calls the model's `initialize_available_targets()`, as `configure_llvm` does. 12 pass.
- **The tests bite** (each mutation reverted after the check):
  - `Is64Bit || isOSWindows()` → `Is64Bit` in `computeX86DataLayout`: the data-layout test fails (i686 Windows).
  - `checkFeatures` ignoring the `+`/`-` flag: the model test and the table test fail.
  - `retire` not clearing the handle: the recorder test fails (no second `?attr` line, and `find(c1)` stays 1).
- **Recorder**: `record.oracle.test.ts` compiles the recorder's C (without its interpose section) against libLLVM into a test
  program and checks:
  - an attribute of context c1 is logged once; after `retire(c1)` the same address gets `?attr %4`, while another context's handle
    keeps its number;
  - 300,000 handles, half of them retired, all look up right;
  - the `LLVMContextDispose` wrapper calls `retire` after logging.

  `proof.oracle.test.ts` re-records all 19 committed scripts byte for byte with the new recorder.
- No new environment-variable names are read (`RUST_TS_REQUIRE_PROBES`, `RUST_TS_AGENT`, and `REGEN` as proof.oracle.test.ts reads
  it). No lldb, and no absolute paths in fixtures.
- **Sample difftests**, `RUST_TS_AGENT=llir-init`, `--sample 200 --jobs 6`, AC power:
  - `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261113-221349-llir-init-b9s3`.
  - `mir-o2`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261113-221446-llir-init-m6gk`.
  - The backend is not registered yet, so nothing changes here, as expected.

## `unported(...)` left
- triple.ts:
  - `Triple parseARMArch(...)` and `parseBPFArch(...)`: arch names outside the StringSwitch (`armv7…`, `thumbv…`, `bpf…`);
  - `compute{ARM,BPF,CSKY,LoongArch,M68k,Mips,Power,AMD,RISCV,Sparc,SystemZ,NVPTX,SPIRV,Lanai,WebAssembly,VE}DataLayout`.
- target.ts:
  - `cl::ParseCommandLineOptions of "<arg>"`: an argument outside `ACCEPTED_LLVM_ARGS`, or one given twice;
  - `lookupTarget(...)`: no modelled target matches while unmodelled components are initialised;
  - `Triple::normalize(...)`: a triple outside core.ts's `NORMAL_TRIPLES`, as `LLVMRustSetNormalizedTarget`;
  - `LLVMRustCompressionKind::{Zlib,Zstd}`;
  - `LLVMRustCreateTargetMachine with a null ABIStr`; `… the target registered no target machine`;
  - `AArch64 computeDefaultCPU with an empty CPU` (`isArm64e` needs the sub-architecture);
  - `AArch64TargetMachine on Windows` (`usesWindowsCFI`; D18);
  - `MC subtarget <triple> <cpu> "<fs>"`: not in subtarget_table.ts;
  - `MCSubtargetInfo::checkFeatures: '<f>' is not a recognized feature for this target` (`reportFatalInternalError`);
  - `LLVMRustContextConfigureDiagnosticHandler with a remark file`.

## `// PORT:` decisions (for root to record)
1. **Only X86 and AArch64 are modelled.**
   - `initialize_available_targets` registers them as their `LLVMInitialize{TargetInfo,Target,TargetMC}` do. The `AsmPrinter` and
     `AsmParser` initialisers, and every function of the other 17 components, register nothing.
   - `lookupTarget` stops, instead of reporting LLVM's "no available targets" error, when no modelled target matches.
   - All 19 `cfg(llvm_component)`s are present in the oracle (tested via libLLVM's exports).
2. **`LLVMRustSetLLVMOptions` uses an exact-argument allowlist** (`ACCEPTED_LLVM_ARGS`), because there is no `cl::opt` registry.
   - The list is configure_llvm's four defaults plus codegen_backend.ts's `ORACLE_ACCEPTED_LLVM_ARGS`. Any other argument, or a
     repeat, stops. LLVM itself accepts a repeat of these (`cl::opt`, last one wins; the oracle takes `-enable-tail-merge=0`
     twice), so the repeat stop is conservative: the model would pass the repeat to `opt`/`llc`, and that is not checked
     (review N5).
   - `static bool Initialized` is kept: the first call wins.
   - `llvm_cl_args()` exposes the accepted options to `opt`/`llc`.
3. **MC subtarget feature bits come from an oracle table** (`subtarget_table.ts`), because they are TableGen output. The table is
   re-checked against libLLVM on every test run. An unrecorded (triple, CPU, features) stops at creation.
   - The registered constructors stand in for `X86_MC::createX86MCSubtargetInfo` / `createAArch64MCSubtargetInfo`, keyed by the
     wrapper's arguments.
   - An unknown feature in `checkFeatures` stops (LLVM: `reportFatalInternalError`).
4. **`TargetOptions`** holds only the fields the wrapper and the X86/AArch64 target machines set.
   - `InitTargetOptionsFromCodeGenFlags` is not modelled: none of its flags are accepted, so they stay at their defaults.
   - The effective relocation and code models are not computed: nothing reads them.
   - AArch64's `TLSSize = 24` is set as upstream (from the `-tls-size` default 0). Its clamps read the effective code model and
     stop, but they cannot fire for a size of 24 (review N3).
5. **`Triple` has no `SubArch`.** `parseSubArch` is not ported; `computeDefaultCPU` with an empty CPU stops.
6. **`Triple::normalize`** follows core.ts's existing PORT (`NORMAL_TRIPLES`).
7. **`llvm_is_multithreaded()` is 1** (the oracle libLLVM's `LLVM_ENABLE_THREADS`; tested).
8. **Error handlers.**
   - `install_*` record the handler (the `assert`s are compiled out in the release LLVM).
   - `FatalErrorHandler` / `BadAllocErrorHandler` / `report_fatal_error` are ported, but nothing in the model reaches them yet.
   - `install_out_of_memory_new_handler` only records itself.
9. **Diagnostic handlers.**
   - Each context's handler lives in a `WeakMap` in target.ts. It starts as LLVM's default `DiagnosticHandler`; `get` moves it out
     (leaving none), as `std::move(pImpl->DiagHandler)` does.
   - `RustDiagnosticHandler` is a `DiagnosticHandler` with `Rust` set. A remark file stops.
   - The model raises no diagnostics yet (the passes run in `opt`/`llc`).
10. **Compression availability.** `fromRust(LLVMRustCompressionKind)` stops for Zlib/Zstd, because availability is not modelled.
    rustc asks `LLVMRustLLVMHas*Compression` first, and that is still a stop.
11. **Replay.**
    - `ReplayOptions.targetMachines` takes a compile's hidden `LLVMRustCreateTargetMachine` arguments (cg-write's lldb fixtures).
    - With them, replay also runs `configure_llvm`'s hidden `LLVMRustInstallErrorHandlers` and `initialize_available_targets` right
      after the first `LLVMGetVersion` that follows `LLVMIsMultithreaded`.
    - `LLVMRustSetLLVMOptions` is left out: it is process-wide, and the module shows nothing of it.
    - Without target machine arguments, replay behaves as before: the data layout is stubbed and the dispose is skipped.
12. **Recorder context tags.**
    - A new handle belongs to the module's context when `scan()` first sees it in a module. Otherwise it belongs to the calling
      thread's current context (the last `LLVMContextCreate` on that thread). rustc fills each context on one thread, one at a time.
    - A handle first seen on a thread with no context (a worker thread's) is never retired.
    - If a context's object is first mentioned after another context was created on the same thread, it is retired with the
      newer context: a false difference, never a false pass.
    - Only a live context tags (review N8): a thread whose current context another thread disposed of tags new handles 0.
13. **Placement.** `rustc_llvm::initialize_available_targets` lives in the IR model (target.ts), not at the mirrored
    `src/rustc_llvm/lib.ts`. `rustc_llvm` is excluded, and the body is only `LLVMInitialize*` calls into the model (review N9;
    root records it).

## Test doubles root can remove
- `context.test.ts`: the remaining doubles `llvm_util::get_version`, `back::write::to_llvm_code_model` and
  `attributes::frame_pointer` are copies of functions that are now ported. With all three removed (`install_doubles` returning a
  no-op), the file passes **12/12**. Not removed here, because the brief named only the target-machine and data-layout stand-ins.
- `back/write.test.ts` (cg-write): its spies on the model's `LLVMRustCreateTargetMachine`, `LLVMRustSetDataLayoutFromTargetMachine`,
  `LLVMDisposeTargetMachine` and the three diagnostic-handler wrappers (handoff cg-write "Test doubles") now have real
  implementations behind them. **Not checked by removal.**
- `proof.oracle.test.ts`: `STUBBED_ALLOWED` / `SKIP_ALLOWED` remain only for the 17 cases that have no recorded target machine
  arguments.
- `src/rust_ts/codegen_backend.ts`'s `ORACLE_ACCEPTED_LLVM_ARGS` duplicates part of `ACCEPTED_LLVM_ARGS`. Once the backend is
  registered, one of them can go.

## Coordination (llir-tools)
- Agreed by message:
  - the field names above;
  - the class in target.ts, re-exported from handles.ts;
  - `llvm_cl_args()`;
  - both lanes append to `impl_modules.ts` and regenerate `ffi.ts` (a trivial merge);
  - both export `LLVMRustSetLastError` from core.ts with the same one-word change.
- A disposed machine has `disposed = true`.

## For root
- Add the manifest files above. Then `coverage.ts --check` should pass.
- Make the `llvm_util.ts` one-liner (Items, "Left").
- Review the two out-of-list test edits (Files touched).
- Remaining recorder cost: `scan()` still walks every global, function and instruction of the building thread's module on each
  recorded call (O(calls × module size)). It accounts for most of task-comm-7's 28 s, and could be made incremental later.

## Review fixes (docs/reviews/llir-init.md on t3/review-llir-init, FAIL; fixed in `76cee423`, `c8890402`)
- **F1** `triple.ts`: the `arc` arm now has LLVM's string with `i32:32:32-` (TargetDataLayout.cpp:566-568).
  - **All literal arms re-checked:** a script parsed `computeDataLayout`'s switch from the pinned TargetDataLayout.cpp (lines
    555-667) and compared each literal arm with the model. **19 arches, 0 differences**: arc, avr, dxil, hexagon, msp430, tce,
    tcele, tcele64, xcore, xtensa, and the nine `""` arms. On the first version the same script finds the arc difference.
  - New test: the literal layouts of the oracle's AVR, Hexagon, MSP430 and Xtensa back ends equal libLLVM's target machine's.
- **F2** `target.ts` `X86TargetMachine`: uses `TT.isPS()`. `isPS4`, `isPS5` and `isPS` are ported in triple.ts (Triple.h:894,
  :900, :906, marked).
  - New test against libLLVM: libLLVM exposes `TrapUnreachable` through no C API, so the observable is whether
    `define void @f() { unreachable }` compiles to a `ud2` (`LLVMTargetMachineEmitToMemoryBuffer`). It is compared with the
    model's `Options.TrapUnreachable` for seven triples:

    | triple | traps (model = libLLVM) |
    |---|---|
    | `x86_64-scei-ps4` | true |
    | `x86_64-unknown-ps4` | false |
    | `x86_64-sie-ps5` | true |
    | `x86_64-unknown-ps5` | false |
    | `i686-scei-ps4` | false |
    | `x86_64-unknown-linux-gnu` | false |
    | `x86_64-apple-darwin` | true (MachO) |

  - The test bites: with the old OS-only test, it fails on `x86_64-unknown-ps4`, `x86_64-unknown-ps5` and `i686-scei-ps4`.
- **N1** `DL_TRIPLES` no longer spreads `NORMAL_TRIPLES`. It has 27 entries, all distinct, which the test asserts, along with
  both M7 triples being in it.
- **N2** `// llvm:` markers on `AArch64beTargetMachine` (AArch64TargetMachine.cpp:572) and `setLargeDataThreshold`
  (TargetMachine.h:277).
- **N3** AArch64 `Options.TLSSize = 24`, as upstream (TargetOptions.h:130 `TLSSize(0)`; `-tls-size` defaults to 0 and is not
  accepted). The clamps stop if ever reached (PORT 4). The comment is corrected.
- **N4** `skeleton.test.ts`:
  - The test drives `LlvmCodegenBackend::init` again, through the port's driver: `Config::make_codegen_backend` hands
    `run_compiler` the backend, and the driver calls `init(early_sess)`.
  - It asserts the stop `llir: rustc_llvm::initialize_available_targets`, or `LLVMRustDisableSystemDialogsOnCrash` if `CI` is
    set.
  - Once root makes the `llvm_util.ts` one-liner, this expectation moves to the next stop.
- **N5** The repeated-option stop's reason is corrected (PORT 2). It is still a stop.
- **N6 (optional, done)** The target machines copy `TargetOptions` with its `MCOptions`.
- **N7** Every libLLVM test calls `libLLVM()` first. Without the toolchain under `RUST_TS_REQUIRE_PROBES=1`, each fails with one
  line: `ERROR: the oracle's libLLVM.dylib is unavailable (…)`. Checked with `PATH=/bin:/usr/bin`: the 7 libLLVM tests fail
  that way, and the 11 model tests pass.
- **N8 (optional, done)** `record.ts`: only a live context tags a new handle (PORT 12). `record.oracle.test.ts` checks a stale
  thread context; with the check removed, the test fails.
- **N9** recorded as PORT 13.
- **After the fixes:**
  - `bunx tsc --noEmit -p .`: clean.
  - The brief's test command: **264 pass, 0 fail** (23 files). That includes the 19 proof scripts, re-recorded byte for byte with
    the changed recorder.
  - `coverage.ts --check --offline`: 84 `ERROR:` lines, all "names no file of harness/llvm-manifest.json" (the same 18 files).
  - The 88 markers checked against the pinned sources: 0 errors.

## Commits
- `6c933b96` IR model: LLVM init, target registry, target machine, MC subtarget, diagnostic handlers; replay, proof case, test
  updates.
- `27a971a7` Recorder: hash-table handle lookups; retire a disposed context's handles.
- `2b54c738` this handoff.
- `76cee423` review fixes F1, F2, N1-N7.
- `c8890402` recorder N8.
- The commit of this handoff update.
