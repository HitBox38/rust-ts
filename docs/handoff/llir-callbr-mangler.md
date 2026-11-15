# Handoff: llir-callbr-mangler (wave 40t): `callbr`, `LLVMRustGetMangledName`, `LLVMRustGetSymbols`, long names, and the model nits

Branch `t3/llir-callbr-mangler` (from `6a74a1de`; no merges). Only `src/rust_ts/llvm/**` and this file (and
`docs/handoff/llir-callbr-mangler/llvm-pins.patch`, for root). Commits at the end.

**Root's additions, in priority order:**
- **G1 `LLVMRustGetSymbols`, done.** SymbolWrapper.cpp is 7/7. Every sysroot rlib's symbol table is reproduced, and the port's own
  rlib and staticlib symbol tables equal the oracle's byte for byte. **ripgrep's `cargo build --release` succeeds with every
  compile through the port.**
- **G3 long local names, done.** A `-non-global-value-max-name-size=-1` rule in tools.ts, pinned by a libLLVM test.
- **G2 bitcode members: still a named stop**, with the faithful route written out below.

**Root must pin 18 LLVM files before merging:** see "LLVM files to pin". Until they are pinned, `coverage --check` reports 23
marker errors, all from this lane's new `// llvm:` markers. With the pins applied it passes.

## Summary
- **`callbr` is in the model.**
  - `IRBuilder::CreateCallBr` → `CallBrInst::init`. The operands are in LLVM's order: args, bundle inputs, the default destination,
    the indirect destinations, then the callee. `numIndirectDests` is a field.
  - `LLVMBuildCallBr` (Core.cpp:3575) is in build.ts.
  - AsmWriter's callbr arm is in `printCallBase`. It prints `\n          to label %d [label %a, ...]`, and it does **not** call
    `maybePrintCallAddrSpace`: upstream's callbr arm doesn't either (AsmWriter.cpp:4735-4770).
  - Nothing else needed a change:
    - `isTerminator` and `isCallBase` already named `callbr`;
    - call-site attributes, `!srcloc` metadata and the type finder go through the shared CallBase paths;
    - the model has no IR verifier or fold that touches `callbr`. The pinned `opt` verifies the printed text in the unit test.
- **`LLVMRustGetMangledName` is ported** in a new file, `src/rust_ts/llvm/mangler.ts`. It contains:
  - Mangler.cpp's `getNameWithPrefixImpl` (both overloads), `hasByteCountSuffix`, `addByteCountSuffix` and
    `Mangler::getNameWithPrefix(GV, CannotUsePrivateLabel)`. The last one covers private and linker-private prefixes, `\01`,
    `?` on Windows modes, `__unnamed_N` with `AnonGlobalIDs`, and the fastcall/stdcall/vectorcall prefixes and `@N` / `@@N` suffixes;
  - DataLayout.h's `getGlobalPrefix`, `getInternalSymbolPrefix`, `getLinkerPrivateGlobalPrefix`, `doNotMangleLeadingQuestionMark`
    and `hasMicrosoftFastStdCallMangling`. The mangling mode is read from the layout's `m:` spec (DataLayout.cpp:650-676);
  - `findBaseObject` (Globals.cpp:482) for `getAliaseeObject`;
  - RustWrapper.cpp:1662 `LLVMRustGetMangledName`, which makes a fresh `Mangler()` and passes `CannotUsePrivateLabel = true`.
- **`ffi.ts` regenerated** (`bun tools/llir/ffi_gen.ts`): `LLVMBuildCallBr` → build.ts, `LLVMRustGetMangledName` → mangler.ts
  (`impl7`, appended to `IMPL_MODULES`). 332 of 381 implemented (was 330). `--check` passes.
- **All 18 gate cases that stopped on these two functions in `gate-20261115-021222-root-rgng` now MATCH** (table below).
- **`LLVMRustGetSymbols` and the rest of SymbolWrapper.cpp are ported** (G1, below), over a new model of LLVM's Object library
  (`object_file.ts`). ffi.ts now has 336 of 381 implemented.
- **Long local names (G3, below):** tools.ts takes them verbatim when a pinned tool parses model text that holds one.

## The gate's cases (each run by id on this branch)

| Case | Suite(s) | Stop in the gate | Now |
|---|---|---|---|
| `tests/ui/asm/label-operand.rs#aarch64` | run-pass-native, ir-host | `LLVMBuildCallBr` | **MATCH**, **MATCH** |
| `tests/ui/asm/label-operand.rs#x86_64` | ir-run-pass, ir-run-pass-o0 | `LLVMBuildCallBr` | **MATCH**, **MATCH** |
| `tests/ui/asm/x86_64/goto.rs` | ir-run-pass, ir-run-pass-o0 | `LLVMBuildCallBr` | **MATCH**, **MATCH** |
| `tests/ui/abi/custom.rs` (naked) | ir-run-pass, ir-run-pass-o0 | `LLVMRustGetMangledName` | **MATCH**, **MATCH** |
| `tests/ui/asm/cfg.rs#reva` (naked) | ir-run-pass, ir-run-pass-o0 | `LLVMRustGetMangledName` | **MATCH**, **MATCH** |
| `tests/ui/asm/cfg.rs#revb` (naked) | ir-run-pass, ir-run-pass-o0 | `LLVMRustGetMangledName` | **MATCH**, **MATCH** |
| `tests/ui/c-variadic/naked.rs` | ir-run-pass, ir-run-pass-o0 | `LLVMRustGetMangledName` | **MATCH**, **MATCH** |
| `tests/ui/c-variadic/same-program-multiple-abis-x86_64.rs` (naked) | ir-run-pass, ir-run-pass-o0 | `LLVMRustGetMangledName` | **MATCH**, **MATCH** |
| `tests/ui/asm/x86_64/global_asm_escape.rs` (`global_asm!` + `sym`) | ir-run-pass, ir-run-pass-o0 | `LLVMRustGetMangledName` | **MATCH**, **MATCH** |

- In all, run-pass-native +1, ir-host +1, ir-run-pass +8, ir-run-pass-o0 +8.
- The brief's "5 naked-function cases in run-pass-native" are in `ir-run-pass` and `ir-run-pass-o0` (cg-asm review N6). The only
  run-pass-native case behind these stops was `label-operand#aarch64`.
- Every `asm/` case of each suite is MATCH, filtered with `--filter asm/`: ir-host 8/8, ir-run-pass 12/12, ir-run-pass-o0 12/12 and
  run-pass-native 8/8. So is run-pass-native `--filter naked` (1/1).
- Runs (`RUST_TS_AGENT=llir-cbm`, under `$RUST_TS_DATA/runs/`):
  - `20261115-084920-llir-cbm-q4z2` (ir-host asm);
  - `-084931-…-gcyw` and `-085029-…-yeu2` (ir-run-pass asm);
  - `-085010`, `-085018` and `-085023` (ir-run-pass: custom, c-variadic);
  - `-085048`, `-085055`, `-085100` and `-085106` (the same on ir-run-pass-o0);
  - `-085118-…-s28c` and `-085130-…-e1lh` (run-pass-native asm, naked).

## Nits done
- **llir-di N1:** `di_builder.oracle.test.ts`'s libLLVM sequence has a second function, `_ZN2di3sub`, with a `DISubprogram` and two
  located instructions. The review's mutant M4b (number function attachments in the module pass) now **fails** the test; checked.
- **llir-di N3:** printer.ts numbers a global's attachments sorted by kind, as `processGlobalObjectMetadata` (AsmWriter.cpp:1223)
  does through `getAllMetadata` (Metadata.cpp:1596, `stable_sort` by kind).
  - Test: in the libLLVM sequence, global `G` gets a custom-kind `!{}` before its `!dbg`.
  - Reverting the sort **fails** the test; checked.
- **llir-di N4:** the `createMemberType` marker now cites `DIBuilder.cpp:463`.
- **cg-asm N2:** `inline_asm.test.ts` has a new test, "FIXTURES are the pinned llvm-as's answers".
  - It rebuilds each of the 65 rows as the reviewer did, runs the pinned `llvm-as`, and requires the parser's `error:` text (or
    none) to equal the row. That takes 0.7 s.
  - Flipping one row's answer **fails** it; checked.
  - It is skipped without the toolchain, unless `RUST_TS_REQUIRE_PROBES=1`.
- **cg-asm N3:** `// llvm:` markers on the five Module.h inline members (`operator==` :183, `GlobalAsmFragment` :198,
  `getModuleInlineAsm` :330, `hasModuleInlineAsm` :340, `appendModuleInlineAsm` :393). `coverage --check` accepts them.
- **cg-asm N4:** there is one `bytesArg`. It moved to ir.ts beside `bstrOfString` / `bstrOfBytes`; core.ts imports and re-exports it,
  and inline_asm.ts imports it from ir.ts.
  - Importing it from core.ts instead (the review's wording) creates an evaluation-order cycle: printer.ts → inline_asm.ts →
    core.ts → inst.ts, whose top-level `setBodyPrinter` then runs before printer.ts has initialised. That fails at load
    (`Cannot access 'bodyPrinter' before initialization`), so ir.ts is the shared home.
- **`Module.inlineAsm`, root-w59-check N3 (`printer.ts:599`):** the dead check is removed. `Module::GlobalScopeAsm` is now a field of
  `Module` (ir.ts), as upstream has it (Module.h:223). cg-asm's `WeakMap` side table is gone.
  - `LLVMCloneModule` copies the printed text, which includes the module asm (the cg-asm review checked this).
- **root-w59-check N1:** `link.oracle.test.ts`'s F1 test now holds RC-E: a source reuses the merged-away name `%B` with
  `{ i32 }`.
  - libLLVM keeps `%B = type {}` and adds `%B.0 = type { i32 }`.
  - The model's text has `%B = type { i32 }`, and `LLVMWriteBitcodeToFile` stops on the merged-types flag.
  - With `tools.ts` from `f76a3035` (before the whole-line check) the test **fails**; checked, then restored.

## Evidence
- **`callbr_mangler.test.ts`** (new, 17 tests, 2.7 s):
  - **Oracle crates** `callbr_oracle/a64.rs` (aarch64-apple-darwin) and `x64.rs` (x86_64-unknown-linux-gnu):
    - asm goto with 1, 2 and 3 labels, with an output (`asm_goto_with_outputs`), an inout, `noreturn` (default destination
      `%unreachable`), call-site attributes (`readonly`) and `att_syntax`;
    - naked functions: mangled, `no_mangle`, `\u{1}raw_name`, `?question`, hidden, and on x86_64 a vectorcall one, which gives
      `naked_vectorcall@@0` on ELF;
    - `global_asm!` with `sym` (functions, statics, `no_mangle`) and pointer `const` operands.

    The port's `--emit=llvm-ir` equals the committed oracle IR (asm.test.ts's comparison), and the fixtures are re-made and checked
    when the toolchain is present.
  - **The mangler on four mangling modes** (`m:x` i686-pc-windows-msvc, `m:e`, `m:w`, `m:o`), against the labels the pinned `llc`
    prints for the same globals:
    - the x86 calling conventions with and without varargs, `\01` and `?` names;
    - private, unnamed-private and unnamed-internal data. llc mangles these with one Mangler per module; on Mach-O with
      `CannotUsePrivateLabel`, which gives `l_p` and `l___unnamed_1`.

    The table is re-read from llc when it is present. Also tested: `LLVMRustGetMangledName` (a fresh Mangler: `__unnamed_1` each
    time), the `m:` parser and the stop for stdcall with parameters.
  - **A built `callbr`** (named result, two indirect destinations, then a void one with none): the pinned `opt -passes=verify -S`
    parses it, verifies it and prints the same function.
  - Mutations, each reverted: Mach-O's `_` prefix dropped **fails** 3 tests; the indirect destinations printed in reverse **fail** 3.
- **Unit-test wall time added:** about 11 s at machine load ~33: callbr_mangler 2.7 s, symbol_wrapper 6.9 s (its eight compiles run
  four at a time), the llvm-as check 0.7 s, long_names 0.25 s, the rest under 0.1 s.
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`:
  - at `0fbd9e10`: `markers ok (27350, 96 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library 745; llvm 653)`;
  - at `a45dc9b4`: **23 ERROR lines**, all pointing into the unpinned Object-library files. With the pins applied:
    `markers ok (27357, 103 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library 745; llvm 676)`.
- WRAPPER figure: `bun scripts/coverage.ts --crate llvm-wrapper` gives **96/197** at `0fbd9e10`, and **103/197** after G1. RustWrapper.cpp is 68/132;
  `LLVMRustGetMangledName` is no longer in `--missing`.
  - `coverage.ts --missing` does not take LLVM paths (`--missing llvm/lib/IR/Mangler.cpp` fails with ENOENT in `rust-fns.ts`).
  - Mangler.cpp by hand: 5 of its 14 definitions are modelled: both `getNameWithPrefixImpl`s, `hasByteCountSuffix`,
    `addByteCountSuffix` and `Mangler::getNameWithPrefix(OS, GV, bool)`. RustWrapper reaches none of the other 9:
    - `getNameWithPrefix(OS, GVName, DL)` (:71);
    - the two `SmallVectorImpl` overloads (:76, :188);
    - the two `canBeUnquotedInDirective`s (:196, :200);
    - `emitLinkerFlagsForGlobalCOFF` / `emitLinkerFlagsForUsedCOFF` (:214, :278);
    - the Arm64EC name functions (:292, :331).
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rust_ts/ ./src/rustc_codegen_llvm/ ./scripts/lib/unit-steps.test.ts`:
  - **494 pass, 0 fail** at `0fbd9e10` (49 files);
  - **506 pass, 0 fail** at `a45dc9b4` (51 files, 73.6 s).
- `bun tools/llir/ffi_gen.ts --check`: up to date.

### Samples (`--sample 200 --jobs 6`, `RUST_TS_AGENT=llir-cbm`)
All at `0fbd9e10` (callbr and the mangler; G1 and G3 came later and are covered by the unit tests and the ripgrep build):

| Suite | Result | Protected in sample | Lost |
|---|---|---|---|
| `run-pass-native` | MATCH 198, UNSTABLE 2 (`binop/binops.rs`, `runtime/rt-explody-panic-payloads.rs`) | 198 | **0** |
| `ir-run-pass` | MATCH 196, UNPORTED 4 (sanitizer/cfi and kcfi) | 196 | **0** |
| `ir-run-pass-o0` | MATCH 196, UNPORTED 4 (the same) | 196 | **0** |
| `ir-host` | MATCH 200 | 200 | **0** |
| `ir-hello` | MATCH 2 | 2 | **0** |

- DIFF, CRASH and TIMEOUT are 0 everywhere.
- Runs: `20261115-090627-llir-cbm-49ie`, `-091047-…-3soh`, `-091301-…-armf`, `-091527-…-zqya`, `-091758-…-40am`.

## LLVM files to pin
**All 18 at once:** `git apply docs/handoff/llir-callbr-mangler/llvm-pins.patch`. It is the manifest diff that
`bun scripts/llvm-src.ts add <the 18 paths>` wrote at the pinned commit; I restored the manifest afterwards. Or run that command
yourself.

**Needed by markers** (coverage --check fails without them; with them: `markers ok (27357, 103 of them in llvm-wrapper; vendor 5392;
library 745; llvm 676)`):
- `llvm/lib/BinaryFormat/Magic.cpp`;
- `llvm/lib/Object/SymbolicFile.cpp`, `llvm/lib/Object/ObjectFile.cpp`, `llvm/lib/Object/MachOObjectFile.cpp`,
  `llvm/lib/Object/ELFObjectFile.cpp`;
- `llvm/include/llvm/Object/ELFObjectFile.h`, `llvm/include/llvm/Object/ELF.h`, `llvm/include/llvm/Object/ELFTypes.h`.

**Cited in comments** (pinned so a reviewer reads them at the pin):
- `llvm/include/llvm/BinaryFormat/Magic.h`, `llvm/include/llvm/BinaryFormat/MachO.h`, `llvm/include/llvm/BinaryFormat/ELF.h`,
  `llvm/include/llvm/BinaryFormat/COFF.h`;
- `llvm/include/llvm/Object/SymbolicFile.h`, `llvm/include/llvm/Object/ObjectFile.h`;
- `llvm/lib/Object/IRObjectFile.cpp` (G2);
- `llvm/include/llvm/IR/Mangler.h`, `llvm/include/llvm/IR/Function.h`, `llvm/lib/CodeGen/TargetLoweringObjectFileImpl.cpp` (the
  mangler).

For G2's route, also pin `llvm/lib/Object/ModuleSymbolTable.cpp`. It is not cited yet, so it is not in the patch.

The callbr and mangler markers point into files that were already pinned: Instructions.h/.cpp, IRBuilder.h, Core.cpp,
AsmWriter.cpp, Mangler.cpp, DataLayout.h, Globals.cpp and Module.h.

**For root, `scripts/coverage.test.ts`:** its "--missing on a wrapper file lists C++ fns" test uses SymbolWrapper.cpp as the
wrapper file with nothing ported, and it now fails (`bun test ./scripts/coverage.test.ts`: 5 pass, 1 fail). The only in-figure
wrapper file left at 0 ported is `compiler/rustc_llvm/llvm-wrapper/LLVMWrapper.h`, so it is the replacement. Its expected output:
```
compiler/rustc_llvm/llvm-wrapper/LLVMWrapper.h:34 write_impl
compiler/rustc_llvm/llvm-wrapper/LLVMWrapper.h:39 current_pos
compiler/rustc_llvm/llvm-wrapper/LLVMWrapper.h:42 RawRustStringOstream
compiler/rustc_llvm/llvm-wrapper/LLVMWrapper.h:44 ~RawRustStringOstream
0/4 ported
```

## `unported(...)` added
- `llir: data layout mangling spec "<spec>" (DataLayout parsing)`: an `m:` spec that DataLayout would reject (no module can carry
  one).
- `llir: Mangler addByteCountSuffix of a function with parameters (DataLayout::getTypeAllocSize)`: stdcall, fastcall or vectorcall
  with parameters. The model has no `getTypeAllocSize` and no `byval`/`inalloca`/`sret` sizes.
  - Reachable only by a naked or `sym`-named `extern "vectorcall"` function with parameters (x86_64), or by i686 Windows targets.
  - Not in any gate case.
- `llir: Function::hasStructRetAttr (the Mangler's variadic stdcall/fastcall rule)`: a variadic stdcall/fastcall with exactly one
  parameter.
- `llir: GlobalValue::getAliaseeObject through a constant expression`: an alias of a GEP, cast or difference. rustc's aliases name a
  global directly.

## `// PORT:` decisions
- **mangler.ts header:** names are the model's byte strings and `raw_ostream` is a returned string. The mangling mode is read from the
  module's layout string, as ir.ts's other layout readers do. `"\0"` stands for the `char` 0 (no prefix).
- **`addByteCountSuffix`:** a function with parameters stops (above). With none, it writes `@0`, as LLVM does: `ArgWords` is 0.
- **`findBaseObject`:** the `ConstantExpr` arms stop (above).
- **`callBrInit`** (inst.ts): the operands are pushed in index order. The `#ifndef NDEBUG` signature asserts are left out, as the
  oracle is built without assertions.
- **`GlobalScopeAsm` on `Module`, `bytesArg` in ir.ts:** see "Nits done".

## G1: `LLVMRustGetSymbols` (pm-self F2, rg-fix-a G1)
- **`symbol_wrapper.ts`** ports SymbolWrapper.cpp whole, **7/7** (`coverage --missing compiler/rustc_llvm/llvm-wrapper/SymbolWrapper.cpp`:
  `7/7 ported`):
  - `isArchiveSymbol` (:24), `getSymbolicFile` (:43), `LLVMRustGetSymbols` (:66) and `withBufferAsSymbolicFile` (:106);
  - `LLVMRustIs64BitSymbolicFile` (:129), `LLVMRustIsECObject` (:134) and `LLVMRustIsAnyArm64Coff` (:160).

  The WRAPPER figure is now **103/197** (was 96).
- **`object_file.ts`** models LLVM's Object library as far as rustc's archive members need it. All with `// llvm:` markers:
  - `identify_magic` (Magic.cpp:33, whole);
  - `SymbolicFile::isSymbolicFile` / `createSymbolicFile` (SymbolicFile.cpp);
  - `ObjectFile::createObjectFile` / `printSymbolName` (ObjectFile.cpp);
  - **Mach-O:** `createMachOObjectFile` and the header, load commands and LC_SYMTAB with `checkSymtabCommand`'s checks;
    `getSymbolName`, `getNValue`, `getSymbolFlags` and `symbol_begin`/`end` (MachOObjectFile.cpp);
  - **ELF:** `createELFObjectFile`; `ELFFile::sections` / `getSectionContentsAsArray` / `getStringTable` / `getSectionName`
    (ELF.h); `Elf_Sym::getName` (ELFTypes.h); `initContent`, `getSymbolName`, `getSymbolFlags` (with the AArch64, ARM, CSKY and
    RISC-V mapping-symbol rules), `isExportedToOtherDSO` and `symbol_begin`/`end` (ELFObjectFile.h). ELF32 and ELF64, either
    endianness.
- **The vendored `object` crate is not used.** Its reader is ar_archive_writer's non-LLVM path. LLVM's own logic is small for
  these two formats, so the port follows LLVM directly. rg-fix-a's scratch patch (appendix C, `get_native_object_symbols`) is
  superseded.
- **What stops, by name** (object_file.ts header):
  - bitcode (`IRObjectFile::create`, G2 below);
  - COFF objects and import libraries, XCOFF, GOFF, Wasm and DXContainer (not modelled; rustc reaches COFF only on Windows targets);
  - the checks the model does model, when they fail, where LLVM would return an `Error`.
- **Not modelled:** `MachOObjectFile`'s constructor also validates every other load command (segments, sections, overlaps, ...).
  rustc only archives objects written by LLVM's MC or by a C compiler. This is a `// PORT:` decision.
- **`LLVMRustIs64BitSymbolicFile`, `LLVMRustIsECObject` and `LLVMRustIsAnyArm64Coff`** are reached only for AIX big archives and
  COFF symbol maps (vendor archive_writer.ts). On Mach-O/ELF they return LLVM's answers (64-bit; not EC; not Arm64 COFF).
- **Evidence, `symbol_wrapper.test.ts`** (9 tests, about 7 s wall at machine load 33):
  - **Every member of every rlib in the pinned sysroot**, for aarch64-apple-darwin (30 rlibs, 497 Mach-O objects, 3253 symbols)
    and x86_64-unknown-linux-gnu (27 rlibs, 417 ELF objects, 2997 symbols). The pinned rustc wrote those archives' symbol tables
    from LLVM's `LLVMRustGetSymbols`, so each table is the oracle's answer for its members. The port's answers equal them exactly:
    names, order and member. `lib.rmeta` members give none.
  - One rlib is left out: `libtikv_jemalloc_sys` (aarch64) bundles jemalloc's objects as clang `-flto` bitcode. The test requires
    that this is the only one, and that its bitcode stops.
  - **The port's own archives:** `symbol_oracle/symlib.rs`, as an rlib (`-Cembed-bitcode=no`, as cargo passes without LTO) and as
    a staticlib (std's objects as well), on both targets. The port's and the pinned rustc's **symbol-table members are byte for
    byte equal** in all four.
  - Ad hoc, the same four builds: both staticlibs and the x86_64 rlib are **byte-identical archives** overall. The aarch64 rlib
    differs by 2 bytes inside the object member: pm-self F1's inlining order through `opt`, not the symbol table.
  - Mutations (each reverted). These **fail** the test: ELF weak symbols not global; ELF undefined symbols kept; the Mach-O name
    offset +1; Mach-O undefined symbols treated as common. These survive, as **equivalent mutants** on any well-formed object:
    - dropping Mach-O `N_STAB` → format-specific (every stab type is even, so `N_EXT` is never set);
    - ELF iteration from the null symbol, and ELF `STT_SECTION` not format-specific (both are `STB_LOCAL`, so not global);
    - Mach-O `N_PEXT`-only treated as global (only `ld -r` writes it).
- **ripgrep's release build through the port** (rg-fix-a's appendix A/B driver and runner, every compile on the port side,
  `RGALL_PM_ORACLE` unset):
  - at `32fbfd2c`: `cargo build --release` **exit 0** in 2 m 56 s, 50 compiles, all through the port and all exit 0 (34 lib,
    11 bin/build-script, 5 others). The port-built `rg --version` prints `ripgrep 15.2.0`, and searches work, `--json` too.
  - **rerun at `a45dc9b4` (the final code):** `cargo build --release` **exit 0** in 3 m 09 s, 50/50 compiles through the port,
    all exit 0; `rg --version` prints `ripgrep 15.2.0`. Logs: `$RUST_TS_DATA/tmp/llircbm-rel2/` (`logs/calls.tsv`, `cargo.log`);
    the first run is in `llircbm-rel/`.
- **The rlib default is a separate stop.** A plain `rustc --crate-type rlib -O` (no `-Cembed-bitcode=no`) stops before archiving,
  at `llir: LLVMRustOptimize's ThinLTO buffer (ThinLTOBitcodeWriterPass ...)`. That is the model's embed-bitcode path, an existing
  stop, which cargo's release profile does not reach.

## G2: bitcode archive members (`release-lto`, `-Clinker-plugin-lto`): a named stop
- **What upstream does:** `getSymbolicFile` gives bitcode a context, so `createSymbolicFile` → `IRObjectFile::create`
  (IRObjectFile.cpp). That makes a lazily loaded `Module` per bitcode module (`getBitcodeModuleList`), and `ModuleSymbolTable::addModule`
  lists:
  - `M->global_values()`: functions, then global variables, aliases and ifuncs, each in module order;
  - then `CollectAsmSymbols`, the symbols of module-level inline asm.

  Each symbol's flags come from `ModuleSymbolTable::getSymbolFlags`: undefined if `isDeclarationForLinker`, global unless local
  linkage, format-specific if private or `llvm.*` or in section `llvm.metadata`, and so on. Each name comes from
  `Mangler::getNameWithPrefix(GV, false)`, which mangler.ts now has.
- **The faithful route:**
  - the pinned `llvm-dis` gives the module text (the bitcode reader is the same one rustc runs);
  - a reader for the global values' lines of that text (name, linkage, visibility, declaration or definition, section,
    alias/ifunc), in `global_values()` order;
  - `getSymbolFlags` and the Mangler, ported as above;
  - a stop when the module has `module asm` (`CollectAsmSymbols` runs MC's target asm parser through `RecordStreamer`, which no
    pinned tool exposes) or holds more than one module.

  rg-fix-a's `llvm-nm` call is not acceptable (an unpinned tool). Writing "no symbols" would be wrong too: rustc warns only when
  LLVM *fails* to read the bitcode.
- **Why it is not done here:** the model has no reader from IR text back to global values (it only builds and prints), so this is a
  lane of its own. It would need `llvm/lib/Object/ModuleSymbolTable.cpp` and `IRObjectFile.cpp` pinned.
- Today `LLVMRustGetSymbols` of a bitcode member stops with `unported: llir: IRObjectFile::create (the symbols of an LLVM bitcode
  file)`. On this branch `release-lto` never reaches it:
  `RGALL_PROFILE="--profile release-lto"` (run `llircbm-lto`) exits 101 after 16 compiles succeed. 33 libraries stop first at
  `unported: rustc_fs_util: compiler/rustc_fs_util/src/lib.rs link_or_copy`, which rg-fix-a fixed on its own branch (not merged
  here). Per rg-fix-a, with that fix the next stop is this bitcode one.

## G3: long local names through the text hand-off
- **Does it match rustc?** Partly, and where it doesn't, the difference is named.
  - In-process LLVM truncates a local name to 1024 bytes only when the value is named *inside* a function
    (`ValueSymbolTable::createValueName`, :112). A value named before insertion keeps its whole name (`reinsertValue`, :82).
    `makeUniqueName` keeps uniquified names within 1024.
  - So rustc's in-process modules can hold longer names. rustc never parses IR text, but the model hands every module to the pinned
    tools as text. LLParser rejects any local whose name comes back different from the one written (`setInstName`, LLParser.cpp:4110,
    and the forward-reference check: "name is too long which can result in name collisions").
- **The rule** (`verbatimNameArgs`, `hasLongLocalName` in tools.ts, `// PORT:`d):
  - `-non-global-value-max-name-size=-1` goes to opt, llc and llvm-as (reading stdin), and to llvm-link (its `.ll` destination),
    **only when that text names a local over 1024 bytes**. A quoted name's `\XX` escapes count as one byte. Every other module runs
    with LLVM's default, exactly as before.
  - The bitcode readers (llvm-dis, llvm-link's `.bc` sources) get no flag: they truncate as rustc's in-process bitcode parse for fat
    LTO does.
  - **What remains different, only in such modules:** the flag is a global limit, so names that passes create in that same tool run
    are not truncated to 1024, where in-process they are. That affects local value names only. They never become symbols, so
    objects and behaviour are unaffected; post-opt `--emit=llvm-ir` text could differ, as a DIFF.
  - rg-fix-a's patch passed the flag on every run, which also lifted truncation in the first `opt` of every module. This rule
    does not.
- **Evidence, `long_names.oracle.test.ts`** (3 tests, 0.25 s):
  - libLLVM builds, through the C API, a function with an add named in its block (truncated to 1024) and a block created with
    an 1100-byte name and then appended (kept whole);
  - the pinned `opt` rejects that text with the default limit;
  - through `run_pinned_tool`, `opt` reads it and prints the function back **unchanged**;
  - a module whose names fit gets no flag;
  - the detector's cases cover locals, quoted names with escapes, labels, globals, strings and metadata.
- rg-fix-a confirmed by hand that the flag lets regex_automata's failing module through.

## Other findings for the next model lane
- **pm-self F1, use-list order lost through `opt`.** AlwaysInliner walks `F.users()`, so `.iN` suffixes and stack-slot order can
  differ. That is the 2-byte object difference in the aarch64 rlib above. The fix is to emit `uselistorder` directives where the
  model's creation order differs from the parser's, which needs a use-list model in ir.ts. A lane of its own.
- **An rlib with embedded bitcode** (`-Cembed-bitcode=yes`, rustc's default for rlibs) stops at the model's ThinLTO buffer (above).

## Files touched
- New: `src/rust_ts/llvm/mangler.ts`, `src/rust_ts/llvm/callbr_mangler.test.ts`, and `src/rust_ts/llvm/callbr_oracle/{a64.rs,x64.rs,aarch64-apple-darwin.ll,x86_64-unknown-linux-gnu.ll}`.
- New (G1, G3): `src/rust_ts/llvm/object_file.ts`, `symbol_wrapper.ts`, `symbol_wrapper.test.ts`, `symbol_oracle/symlib.rs`,
  `long_names.oracle.test.ts`, and `docs/handoff/llir-callbr-mangler/llvm-pins.patch`.
- Changed (G1, G3): `ffi.ts` (regenerated again; 336 of 381), `impl_modules.ts` (`./symbol_wrapper.ts`), `tools.ts`
  (`verbatimNameArgs`).
- Changed:
  - `inst.ts` (callbr);
  - `build.ts` (`LLVMBuildCallBr`);
  - `ffi.ts` (regenerated) and `impl_modules.ts`;
  - `ir.ts` (`Module.GlobalScopeAsm`, `bytesArg`);
  - `core.ts` (`bytesArg` re-export);
  - `inline_asm.ts` (`Module` field, markers, shared `bytesArg`);
  - `printer.ts` (the dead check, the N3 sort);
  - `di_builder.ts` (N4 marker);
  - the tests `di_builder.oracle.test.ts`, `inline_asm.test.ts` and `link.oracle.test.ts`;
  - this file.

## Commits
- `0fbd9e10` llir-callbr-mangler: callbr, LLVMRustGetMangledName, and the model nits
- `32fbfd2c` llir-callbr-mangler: LLVMRustGetSymbols and SymbolWrapper.cpp (pm-self F2, rg-fix-a G1)
- `a45dc9b4` llir-callbr-mangler: take long local names verbatim when a pinned tool parses model text (rg-fix-a G3)
- (this handoff) llir-callbr-mangler: handoff
