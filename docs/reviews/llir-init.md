# Review: llir-init (wave 40p)

Reviewer: independent, read-only. Branch `t3/implement-llvm-init-target-machine`, commits `6c933b96` (model, replay, tests),
`27a971a7` (recorder) and `2b54c738` (handoff), against `main` at `7b71d658` (`git diff 7b71d658..2b54c738`). I merged `2b54c738`
into `t3/review-llir-init` to run it.

Sources:
- LLVM at `aab11ee0ea5e`: the 18 files of the handoff's manifest list, fetched from `rust-lang/llvm-project` at that commit into my
  scratchpad (not `llvm-src/`). The 4 markers into files already in the manifest were checked against `$RUST_TS_DATA/llvm-src/`.
- rustc at the pin: `compiler/rustc_llvm/llvm-wrapper/{PassWrapper,RustWrapper}.cpp`, `compiler/rustc_llvm/src/lib.rs`, and
  `rustc_codegen_llvm/src/llvm_util.rs`.

**Verdict: FAIL.** Two must-fix findings, each a one-line fidelity error in code that M7 targets never reach:
- **F1**: `arc`'s data layout literal drops a component.
- **F2**: `X86TargetMachine` tests the OS where LLVM calls `Triple::isPS()`.

Everything else checks out:
- all 83 `// llvm:` markers and the new WRAPPER markers;
- the X86 and AArch64 data layouts, which equal libLLVM on the lane's triples and on 21 more of mine;
- `Triple` parsing and its name tables;
- `LLVMRustCreateTargetMachine`, init, the error and diagnostic handlers;
- the subtarget table and its oracle check;
- the recorder's hash tables and N-a fix;
- the two out-of-list test edits.

## Environment and commands

AC power (`pmset`: "Now drawing from 'AC Power'"). `.env.local` from integ-w39; `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0
RUSTC_ICE=0`; `bun install --frozen-lockfile`. No samples were taken. I did not touch the oracle toolchain or `llvm-src/`.

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts` | 252 pass, 0 fail, 0 skip (22 files) |
| `bun test ./scripts/lib/unit-steps.test.ts` | 10 pass, 0 fail |
| `bun test` proof.oracle + record.oracle + target.oracle + context.test | 63 pass, 0 fail (proof.oracle alone: 34 = 15 cases recorded and replayed, 2 empty recorded, 2 empty committed) |
| `bun scripts/coverage.ts --check --offline` | exit 1 with exactly 79 `ERROR:` lines, all "names no file of harness/llvm-manifest.json". That is the 79 markers into the 18 unlisted files; nothing else fails. |
| target.oracle.test.ts with no rustc on `PATH` and `RUST_TS_REQUIRE_PROBES=1` | the 5 libLLVM tests **fail** (11 model tests pass). Without the variable they skip with a printed `SKIP:` line. |

## Checks

1. **Markers.** target.ts and triple.ts have 83 `// llvm:` markers:
   - 79 point into the 18 new files;
   - 4 point into manifest files: `Core.cpp:4767`, `LLVMContext.cpp:133` and `:365`, `TargetMachineC.cpp:229`.

   I ran `llvmMarkerErrors` with a temporary manifest of my fetched files for the 79 and the real manifest for the 4: **0 errors**.

   The WRAPPER markers are verified by `coverage.ts --check` (no wrapper errors in the output), and I read them by hand:
   - RustWrapper.cpp:87 `FatalErrorHandler`, :115, :124, :1498, :1505, :1521;
   - PassWrapper.cpp:87, :100, :106, :138, :166, :225, :249, :268, :347, :440, :1196;
   - `rustc_llvm/src/lib.rs:73 initialize_available_targets`.

   Each marker sits on the function that follows that source. `TripleName.def` carries no marker, by design, and backs the three
   tables. Gaps are in N2.
2. **`computeDataLayout`.**
   - `computeX86DataLayout`, `computeAArch64DataLayout` and `getManglingComponent` match TargetDataLayout.cpp:16-25, :83-98 and
     :408-450 line by line: Darwin/MachO, ELF, Windows/COFF (`-m:x` for x86), UEFI, x32/muslx32, IAMCU, ILP32, big-endian,
     `arm64_32`, and `-macho` in the environment.
   - The other arches' `compute*DataLayout` stop by name (`llir: computeRISCVDataLayout ...`).
   - The literal arms match TargetDataLayout.cpp:555-667 except **F1**. I checked all ten by evaluating the model against the C++
     text.
   - **The comparison with libLLVM is real** (target.oracle.test.ts:322): `LLVMCreateTargetMachine` →
     `LLVMCreateTargetDataLayout` → `LLVMCopyStringRepOfTargetData` through bun:ffi, against `new Triple(t).computeDataLayout("")`.
     The second half goes through `LLVMRustCreateTargetMachine` with cg-write's recorded arguments. It is 28 distinct triples, not
     30 (N1).
   - I compared 21 more through libLLVM myself: all equal.
     - `x86_64-unknown-linux-gnux32`, `aarch64-apple-ios-macabi`, `arm64-apple-darwin`, `arm64-apple-ios14.0-simulator`;
     - `i686-pc-windows-msvc-elf`, `x86_64-unknown-windows-gnu-coff`, `arm64ec-pc-windows-msvc`, `i686-unknown-uefi`;
     - `i686-pc-windows-itanium`, `i386-apple-ios`, `aarch64_be-apple-darwin`, `aarch64-unknown-linux-gnu-coff`;
     - `x86_64-scei-ps4`, `i686-pc-cygwin`, `i686-w64-windows-gnu`, `x86_64`, `i686-linux-android`;
     - `aarch64_32-unknown-linux-gnu`, `x86_64-unknown-linux-gnu-macho`, `i686-unknown-unknown-macho`,
       `aarch64-pc-windows-gnu-elf`.
   - An unmodelled target stops by name, twice over:
     - `lookupTarget` stops (`only the X86 and AArch64 targets are modelled`) before any layout is computed;
     - `computeDataLayout` itself stops per arch.
3. **`Triple`.**
   - The constructor (Triple.cpp:1093, `split(.., '-', 3)` and the mips one-component environments), `parseArch` (:640, every
     `StringSwitch` arm in order, `StartsWith` for amdgpu/kalimba, and the ARM/BPF fallbacks stopping), `parseFormat`,
     `getDefaultFormat` (:992) and `isLittleEndian` (:2254) match.
   - The three name tables equal `TripleName.def`'s `TRIPLE_VENDOR`/`_ALIAS`, `TRIPLE_OS`/`_ALIAS` and `TRIPLE_ENV` exactly
     (16/52/53 entries, in order; checked by script).
   - All the Triple.h predicates match their bodies.
   - Spot checks give LLVM's components:
     - `x86_64-unknown-linux-gnux32` → x86_64/Linux/GNUX32/ELF;
     - `aarch64-apple-ios-macabi` → aarch64/Apple/IOS/MacABI/MachO;
     - `arm64-apple-darwin` → aarch64/Apple/Darwin/MachO.
   - Raw triples parse positionally, as `Triple::Triple` does: `aarch64-linux-gnu` → OS Unknown.
   - **`normalize` is not ported.** It follows core.ts's existing PORT: only `NORMAL_TRIPLES` pass, and any other triple stops
     (`llir: Triple::normalize("t")`). That is a stop, not a guess. Every M7 triple is already in its normal form.
4. **`LLVMRustCreateTargetMachine`** (PassWrapper.cpp:347-438).
   - It has all 23 parameters in order.
   - Each `fromRust` maps code model (None → nullopt), opt level, reloc (`PIC` → `PIC_`, `DynamicNoPic` → `DynamicNoPIC`,
     `ROPIRWPI`), float ABI, and compression (Zlib/Zstd stop by name; rustc asks `LLVMRustLLVMHas*` first, itself a stop).
   - `TargetOptions` is set field for field: `FloatABIType`, sections, `AsmVerbose`, `PreserveAsmComments`, `ABIName`,
     `SplitDwarfFile`/`ObjectFilenameForDebug` only when non-null, `X86RelaxRelocations`, `UseInitArray`, `EmulatedTLS`, the
     `TrapUnreachable`/`NoTrapAfterNoreturn` rule with `isWasm`/`isOSWindows`, `ThreadModel::Single`, Wasm EH, and
     `EmitStackSizeSection`.
   - `setLargeDataThreshold` is called only when the threshold is non-zero.
   - `lookupTarget` failure goes to `LLVMRustSetLastError`.
   - For llir-tools, the object carries the 23 arguments under ffi.rs's names, plus `normalizedTriple`, `dataLayout` /
     `createDataLayout()`, `TargetCPU`, `TargetFS`, `Options`, `largeDataThreshold` and `disposed`.
   - Use-after-dispose and a double dispose assert.
   - The X86 and AArch64 constructors (X86TargetMachine.cpp:187, AArch64TargetMachine.cpp:362/:564) follow upstream except F2.
     The effective reloc and code models are not computed (PORT 4: nothing reads them, and `llc` derives them).
   - `computeDefaultCPU` stops on an empty CPU. That is honest: `isArm64e` needs `SubArch`. rustc's AArch64 specs always name a
     CPU.
   - AArch64 on Windows stops (D18).
5. **Subtarget table.**
   - **The check is real.** target.oracle.test.ts:328 reads every feature name from the pinned `llc -mattr=help` and asserts byte
     order, since `Find` binary-searches. It asks libLLVM `MCSubtargetInfo::checkFeatures("+f")` per feature, through the C++
     exports `TargetMachine::getMCSubtargetInfo(StringRef, StringRef)` and `checkFeatures`. It regenerates the table source and
     requires it to equal the committed file. It then compares the model's `LLVMRustMCSubtargetInfoCheckFeatures` with libLLVM on
     mixed `+`/`-` triples of features.
   - Under `RUST_TS_REQUIRE_PROBES=1` without the toolchain it **fails**, not skips (run above).
   - The ported logic around the table matches `MCSubtargetInfo.cpp:27` `Find`, `:328` `checkFeatures`, the `SubtargetFeatures`
     split (KeepEmpty false), `hasFlag`/`StripFlag`/`isEnabled`, `TargetRegistry.h:462` `createMCSubtargetInfo` and
     `TargetRegistry.cpp:28` `isValidFeatureListFormat`. JS's `$` without the `m` flag matches POSIX ERE without `REG_NEWLINE`.
   - **A table is justified, and the PORT (target.ts header, handoff PORT 3) says why.** `FeatureBits` come from the
     `X86GenSubtargetInfo.inc` / `AArch64GenSubtargetInfo.inc` that TableGen generates at build time. They are not in the source
     checkout, and porting them means porting TableGen's processor/implies resolution over `X86.td`/`AArch64*.td`.
   - The table covers the three (triple, CPU, "") keys M7 uses, and any other key stops naming itself.
   - Cost: each new `-C target-cpu` or `-C target-feature` set needs a `REGEN=1` row, which the stop makes obvious.
6. **`LLVMRustSetLLVMOptions`** (PassWrapper.cpp:440): `static bool Initialized` is kept, and argv[0] is skipped.
   - `ACCEPTED_LLVM_ARGS` is configure_llvm's four unconditional or target-conditional defaults (llvm_util.rs:117-139) plus
     codegen_backend.ts's two oracle-seen `-C llvm-args`.
   - The oracle test runs `rustc -Cllvm-args=<arg> --print cfg` on both targets and requires exit 0, no stderr and unchanged
     stdout. That is real, because `--print cfg` runs `init` → `configure_llvm`. An unknown argument exits 1 with "Unknown command
     line argument": I checked with `-bogus-arg`.
   - So the list is a faithful **subset** of what the oracle accepts.
   - Everything else stops naming the argument. That includes configure_llvm's own conditional `-time-passes`,
     `-debug-pass=Structure`, `-stats`, `-wasm-enable-eh` and the small-data threshold, which codegen_backend.ts already gates.
   - The duplicate stop's reason is wrong (N5).
7. **Init and diagnostic handlers.**
   - `LLVMIsMultithreaded` is 1, and the test checks that against libLLVM.
   - `LLVMRustInstallErrorHandlers` keeps the order bad-alloc, fatal, new-handler (RustWrapper.cpp:124-128).
   - `FatalErrorHandler` and `BadAllocErrorHandler` keep the text, the 101 exit and the abort.
   - `initialize_available_targets` has lib.rs:73-260's 19 components, in order, 5 initialisers each (4 for NVPTX). Each one's
     existence in libLLVM is tested, and no other `TargetInfo` is exported.
   - X86/AArch64 registration matches X86TargetInfo.cpp:23, X86TargetMachine.cpp:66, AArch64TargetInfo.cpp:36 (arm64 and
     arm64_32 with a never-matching arch function) and AArch64TargetMachine.cpp:239. The `TargetRegistry.cpp:153` `lookupTarget`
     / `:180` `RegisterTarget` logic matches, including "Cannot choose between".
   - The diagnostic handlers follow RustWrapper.cpp:1498-1660: get moves the handler out, set takes it, and configure copies the
     pass list. A remark file stops by name.
8. **Recorder.**
   - **Hash tables.** Open addressing; key 0 is empty and `(P)1` is a tombstone.
     - `hfind` stops at the first empty slot.
     - `hput` grows when used slots (entries plus tombstones) would pass half, so an empty slot always exists and probing ends.
     - A rehash drops tombstones.
     - `find`/`forget`/`id`, `fa`, `ca` and `rg` keep the old linear searches' semantics. Each address had at most one live entry
       before too, `forget` still leaves `fas`/`cas` alone as before, and `wrg` still rewrites its entry.
   - **N-a fix.** `retire(ctx)` runs after the `LLVMContextDispose` line is logged and its modules are scanned. It drops every
     handle tagged with `ctx` (the context's own handle is tagged with itself, because `ckey` is set before `%1 =` is printed), and
     their `fa`/`ca`/`rg` entries.
   - **Does it break replay?** Not of what is committed. In the suite I ran, the 15 proof cases and 2 empty cases re-record to
     their committed scripts byte for byte, and context.test.ts re-records its 2 `context_oracle` scripts (19 in all).
   - A wrong context tag can only renumber a handle. The renumbered handle either gets its own inferred line (`?attr`,
     `?global`) and replays correctly, or is unbound and replay throws. It cannot make a false pass. See N8 for one tagging gap.
   - record.oracle.test.ts compiles the real recorder source and exercises both the retire and 300k-handle paths.
9. **Out-of-list edits.**
   - `back/write.test.ts`'s two assertions follow the removed stops exactly: `OwnedMCSubtargetInfo::new("t", ..)` now stops at
     `Triple::normalize("t")`, and `OwnedTargetMachine::drop` disposes of a real model machine.
   - `skeleton.test.ts` replaces the `b.init` stop with a direct `LLVMIsMultithreaded` check (N4).
   - Neither edit changes anything else.
10. **Tests.** The `CodegenCx::new` test is real.
    - The spies for `create_informational_target_machine`, `create_target_machine`, `OwnedTargetMachine::drop`, the data-layout
      wrapper and the dispose are gone.
    - `record_port` calls through to the model's `LLVMRustCreateTargetMachine`, `LLVMRustSetDataLayoutFromTargetMachine` and
      `LLVMDisposeTargetMachine`, and writes `?datalayout` from the module after the real call. It is compared line by line
      with the oracle script.
    - The remaining doubles are `get_version`, `to_llvm_code_model` and `frame_pointer`.
    - `unit-steps.test.ts` passes.
11. **Commands**: see the table. The marker check's only failures are the 79 missing-manifest lines.

## Findings

### F (must fix)

- **F1** `src/rust_ts/llvm/triple.ts:411`: `Triple::computeDataLayout`'s `arc` arm drops `i32:32:32-`.
  - LLVM (TargetDataLayout.cpp:566-568) returns `"e-m:e-p:32:32-i1:8:32-i8:8:32-i16:16:32-i32:32:32-f32:32:32-i64:32-f64:32-a:0:32-n32"`.
  - The model returns `"e-m:e-p:32:32-i1:8:32-i8:8:32-i16:16:32-f32:32:32-i64:32-f64:32-a:0:32-n32"`.
  - Unreachable today (ARC has no registered target, so `lookupTarget` stops first), but it is a wrong value where the handoff
    claims every literal case. The fix is one string.
- **F2** `src/rust_ts/llvm/target.ts:362`: `X86TargetMachine` tests `TT.getOS() === "PS4" || TT.getOS() === "PS5"`. LLVM
  (X86TargetMachine.cpp:202) tests `TT.isPS()`, which is `x86_64` **and** vendor `SCEI` **and** OS PS4/PS5 (Triple.h:894-906).
  - For `x86_64-unknown-ps4` or `i686-scei-ps4`, the model sets `TrapUnreachable` where libLLVM does not.
  - rustc's own PS4/PS5 triples (`x86_64-scei-ps4`, `x86_64-sie-ps5`) satisfy both, and neither is M7. Still, it is a logic
    divergence in a constructor that otherwise follows upstream.
  - Fix: port `isPS4`/`isPS5`/`isPS` into triple.ts with markers and call `isPS()`.

### N (nits)

- **N1** `src/rust_ts/llvm/target.oracle.test.ts:66-67`: `DL_TRIPLES` spreads `NORMAL_TRIPLES` and then lists both again, so
  the "30 triples" in the handoff are 28 distinct. Drop the spread, or say 28.
- **N2** `src/rust_ts/llvm/target.ts:434`: `AArch64beTargetMachine` cites AArch64TargetMachine.cpp:572 only in its doc comment.
  - The checker accepts the le constructor at :564, so the be one can carry
    `// llvm: llvm/lib/Target/AArch64/AArch64TargetMachine.cpp:572 AArch64beTargetMachine`.
  - Likewise `setLargeDataThreshold` (:653; TargetMachine.h:277) has no marker.
- **N3** `src/rust_ts/llvm/target.ts:464`: `AArch64TargetMachine` leaves out `Options.TLSSize = 24` (AArch64TargetMachine.cpp:391-399).
  - The comment groups it with "the MC asm info is not modelled", but TLSSize is a plain `TargetOptions` field.
  - The `TargetOptions` doc says it holds the fields the target machines set.
  - It is harmless (`llc` recomputes it), but either add the field or say in the PORT that it is left out.
- **N4** `src/rustc_codegen_llvm/skeleton.test.ts:325`: the test no longer drives `LlvmCodegenBackend::init` at all.
  - `b.init(undefined)` would now fail on the session, not on a stop.
  - The comment says the next stop is `initialize_available_targets`, but nothing asserts it.
  - Once root makes the `llvm_util.ts` one-liner, a session-backed assertion would cover `init` again.
- **N5** `src/rust_ts/llvm/target.ts:185`, :191: the duplicate-argument stop says "LLVM's options that take a value occur at
  most once". That is not so at the pin. LLVM's `cl::opt`s accept repeats, last one wins: the oracle exits 0 with
  `-Cllvm-args=-enable-tail-merge=0` twice, and the same for `--inline-threshold=0`. The stop is conservative, so no output is
  wrong. Fix the reason, or accept repeats.
- **N6** `src/rust_ts/llvm/target.ts:356`, :456: `{ ...Options }` is a shallow copy, so the machine shares `MCOptions` with the
  caller's object. C++ copies `TargetOptions`, `MCOptions` included, by value. This is harmless today, because
  `LLVMRustCreateTargetMachine` builds a fresh object each call.
- **N7** `src/rust_ts/llvm/target.oracle.test.ts:237`, :344: under `RUST_TS_REQUIRE_PROBES=1` without the toolchain the libLLVM
  tests fail correctly, but with `TypeError: undefined is not an object` from `lib!`. They should fail with an `ERROR:` line
  naming the missing dylib (AGENTS.md §4).
- **N8** `src/rust_ts/llvm/record.ts:231`: `retire` clears `ckey` only on the disposing thread. rustc drops a `ModuleLlvm` (and
  disposes its context) on a backend worker, so the building thread's `ckey` keeps the freed context's address until its next
  `LLVMContextCreate`.
  - A handle first seen there in between is tagged with a dead context. It would be retired along with a later context that
    reuses that address.
  - That is a false difference, never a false pass, and the same class as handoff PORT 12. Mention it there.
- **N9** `src/rust_ts/llvm/target.ts:501`: `rustc_llvm::initialize_available_targets` is placed in the IR model, not at the
  mirrored path (`src/rustc_llvm/lib.ts`, PORTING §2).
  - That is reasonable: `rustc_llvm` is excluded, and its body is only `LLVMInitialize*` calls into the model.
  - But it is a placement decision, and root should record it with the handoff's PORT list.

## For root

- F1 and F2 are one-line fixes. After them (and the manifest additions), I expect `coverage.ts --check` to pass, and the
  differential tests are unaffected: neither ARC nor a non-SCEI PS triple is among them.
- The handoff's 12 PORT decisions match the code. PORT 3 (subtarget table) is justified as written. PORT 2's duplicate rule
  needs N5's correction.
