# M7 plan — text LLVM IR → pinned `opt` + `llc`, run-pass parity, ripgrep

**Status: accepted with amendments (root, 2026-11-05).** The amendments in `docs/reviews/plan-m7.md` (findings F1-F13 and its Decisions table) take precedence over the text below. Pending the owner: D4's change to `harness/scope.json` and the PLAN.md edits for D1 and D3; no lane depends on them before wave 40.

Source: the plan-m7 planner (design lane; it ports no code). Status: see above. Decisions D1–D20 are in §7. Pin `6f5da406b56c` (1.101.0-nightly, LLVM 23.1.3). Base: main `db323c3b`
(24,230 / 27,053 fns). Paths are relative to the upstream checkout (`compiler/…`, `library/…`). Line counts are `wc -l` at
the pin. Fn counts are `bun scripts/coverage.ts` for in-scope crates and a regex over `fn` lines for `rustc_codegen_llvm`,
which coverage does not count.

**How measurements were taken.** macOS arm64, 12 cores, 24 GB, 25 GB free disk (95% used). Oracle `rustc
+nightly-2026-10-11`. Port = `bun src/rust_ts/main.ts` at `db323c3b`, with `RUST_TS_HOST_TUPLE=aarch64-apple-darwin`,
`RUSTC_ICE=0`, `RUST_BACKTRACE=0`, under `/usr/bin/time -l` ("user" = user CPU, "rss" = max resident set). Load average 2–36
from the M6 audit running alongside, so user CPU is the comparable number. Samples are deterministic: sorted by a salted
SHA-256 of the case id. No oracle component was added or removed. Scripts and outputs are in `$RUST_TS_DATA/tmp/plan-m7/`:

| Path | What it is |
|---|---|
| `ir/` | IR experiments: `gen.sh`, `exp2.sh`–`exp6.sh`, `mut.ts`, `llcflags.sh`, `o0p.sh`, `dbg.sh`, `idem.sh` |
| `np/` | run-pass samples: `sample.ts` + `s240.jsonl`, `control.ts` + `control150.jsonl`, `normsim.ts`, `feat.ts` |
| `mir/` | MIR at opt levels: `cov.ts`, `optsample.ts` + `s100.jsonl`, `optrp.ts` + `rp120.jsonl` |
| `fe/` | front-end timing: `lb.ts` (throwaway walk over mono items), `t.sh`, `tryflags.sh` |
| `rg/` | ripgrep: `wrap.sh`, `wrapport.sh`, `run.sh`, `runcheck2.sh`, `cmp.ts`, `rgm3.sh`, per-crate logs `log.*` |
| `o2/`, `cg/`, `lib/`, `bundle/` | O2 reductions; the tests/codegen-llvm scan; core's IR; the failed bundle trials |

## 0. Recommendation

Port `rustc_codegen_ssa` and **`rustc_codegen_llvm` too**, keeping the seam at `llvm/ffi.rs`: the LLVM C API functions become
a small TypeScript IR model and printer. Run the text through the **pinned toolchain's own `opt` and `llc`** (the
`llvm-tools` component the oracle already has, the same `libLLVM.dylib`). Use the host `cc` only to link, as rustc does.
Start from the oracle's std rlibs.

Parity is two separate checks, because neither implies the other:
- **IR normal form**, byte for byte, before LLVM's passes: strong and cross-target, and it needs no linker.
- **Program behaviour**, natively on `aarch64-apple-darwin`: this is PLAN.md's "run-pass parity".

What the measurements settle:

| Question | Measured answer |
|---|---|
| Can IR be compared byte for byte? | **Yes, before passes.** 240/240 run-pass IRs are byte-stable across runs. After `opt -passes=assign-guid,verify -S` and stripping comments, 150/150 "port-like" texts (renumbered, reordered, attributes dropped) reach the oracle's bytes |
| After LLVM's passes? | **No.** `opt default<O3>` differs from rustc's pipeline on 2,070 of about 5,200 lines of one program. Not a gate |
| Does system clang work? | **No.** Apple clang 21 cannot parse rustc's IR (`nocreateundeforpoison`). The pinned `llc`/`opt` are LLVM 23.1.3 |
| Is the opt/llc pipeline itself safe? | **Yes.** The control (oracle IR → `opt` → `llc` → oracle's link line): 147 of 148 oracle-stable programs behave the same; the one difference is backtrace text. CPU per case: opt 15 ms, llc 10 ms, link 50 ms. Same `.o` size and identical disassembly as rustc's on the one program tried at O0 and at O3 |
| How big is the work? | About 52k upstream lines plus about 9k vendor and about 6k of new IR model: about 37 lanes in 6 waves |
| What is slow? | The front end, not codegen. ripgrep: 339 s CPU in the port's front end (58× the oracle), about 32 s of mono collection, an estimated 17–100 s of codegen |
| Is std a problem? | No. core has only 1,316 mono items; generics are instantiated downstream. Its cost was already paid in M5 |

The first thing to fix is the MIR bug (D13). `-O` is the default for 3,358 of the 3,478 run-pass cases, and no protected
suite meaningfully covers it. It ICEs on 5 of 120 sampled run-pass cases and on ripgrep itself.

## 1. What the output is and what "parity" means

### 1a. What upstream produces

`--emit=llvm-ir` goes through `LLVMRustPrintModule` (`rustc_llvm/llvm-wrapper/PassWrapper.cpp`), after `llvm_optimize`.
`-Cno-prepopulate-passes` skips the pipeline, so the text is what `rustc_codegen_llvm` built. `-Csave-temps` writes the same
module as `*.no-opt.bc`. That bitcode is `fewer_names` (`@0`, no value names), so the `.ll` with names is the better
comparison.

| Program, x86_64-unknown-linux-gnu | mode | lines | defs | decls |
|---|---|---|---|---|
| hello.rs | O0, O3 `-Cno-prepopulate-passes` | 164 / 164 | 10 / 9 | 3 / 6 |
| prog.rs (HashMap, trait objects, format!, catch_unwind) | O0, O3 `-Cno-prepopulate-passes` | 15,592 / 16,605 | 324 / 276 | 70 / 64 |
| prog.rs | O0, O3 with the pipeline | 15,367 / 5,260 | 306 / 30 | 70 / 46 |
| prog.rs | O0 + `-Cdebuginfo=2`, no pipeline | 44,118 (3.55 MB vs 0.77 MB) | | 21,680 metadata nodes |

The allocator shim is a second module (`*.rcgu.o`, `allocator.rs`). The link line also gets `symbols.o`.

### 1b. Is the text stable, and what differs

| Experiment | Result |
|---|---|
| Same argv twice, 240 sampled run-pass cases, x86_64-linux, pre-pass | **240/240 byte-identical**; oracle cost p50 0.016 s, p99 0.047 s, max 0.32 s, 4.5 s in all |
| Same relative path from another cwd | byte-identical |
| Different relative path (`y/prog.rs`) | 24 lines differ: panic `Location` strings and the `alloc_<hash>` names over them. The harness already uses the same relative path and cwd on both sides |
| Round trip through `llvm-as` / `llvm-dis` | Only comments differ: `; <demangled name>` and `; call …` (rustc's annotation writer, PassWrapper.cpp:1067, 1,051 lines in prog.rs) and the order inside `; preds = …` (use-list order, 118 lines) |
| Fixed point of `opt -passes=verify -S`, comments stripped | 238/240 run-pass cases. tests/codegen-llvm: 465 of 483. The misses checked are debuginfo: the printer marks some `DICompositeType` `distinct`. A second round changes nothing (`idem.sh`, diff 0) |
| `!guid` | Added by `AssignGUIDPass` inside `LLVMRustOptimize` (PassWrapper.cpp:996, :1542), including under `-Cno-prepopulate-passes`; absent from `no-opt.bc`. `opt -passes=assign-guid` adds the same values: removing them from a file and running the pass gives 0 differing lines |
| Attribute and metadata numbers | Assigned by the printer: renumbering and moving them changed nothing after `opt -S` (raw diff 2,655 lines in prog.rs, normalised 0; debuginfo: raw 69,113, normalised 0) |
| Attributes on intrinsic declarations, default alignments | Supplied by the parser: removing them gives diff 0 |
| Function order | **Kept**: swapping two functions shows as 72 differing lines, so normalisation does not hide order |

**Normal form:** `opt -passes=assign-guid,verify -S`, then remove lines starting with `; ` and ` ; preds = …` tails.

**Acceptance test of the normal form** (`normsim.ts`): 150 sampled run-pass cases, with the oracle's text mutated the way a
port's text would differ: comments and `!guid` removed, attribute groups and metadata renumbered and moved, attributes
dropped from intrinsic declarations, default `load`/`store` alignments dropped. **150 of 150 reach the oracle's normal form
exactly.** Mean 10.5 ms of `opt` per file. So the port does not have to reproduce the printer's numbering.

**What it must reproduce by construction**, because normalisation keeps it: order of globals, functions and declarations;
value names (`%_4`, `%self`, `%s.0`, `%_2.0`) including LLVM's collision suffixes; instruction order; folded constants and
constant GEPs; `alloc_<hash>`, `anon.<hash>.N`, `vtable.N` names; every attribute; datalayout and triple; module flags.

### 1c. With LLVM's optimization on

`opt -passes='default<O3>'` on the pre-pass text against rustc's own `-Copt-level=3` text (prog.rs): the same 30 defs, but
2,070 differing lines of about 5,200, in value names and in `anon.*` numbering among others (not fully classified).
`LLVMRustOptimize` builds its own pipeline (PassWrapper.cpp). At O0, `default<O0>` gives 0 differing lines on hello.rs and
276 of 15,367 on prog.rs (the lines I looked at carry `.i` inlining suffixes). **So IR after passes is not a gate** (D2); the
pipeline is judged by behaviour.

`llc` is far closer. With `-relocation-model=pic --function-sections --data-sections --trap-unreachable
--no-trap-after-noreturn` on rustc's own final IR, on prog.rs: same `.o` size and **0 differing disassembly lines**, at O0
(233,432 B) and at O3 (40,808 B). The bytes still differ (first at offsets 87,761 and 20,449); I did not look at why. rustc's
`TargetMachine` settings are in `LLVMRustCreateTargetMachine` (PassWrapper.cpp:374–428).

### 1d. Which LLVM

| | Apple clang (`/usr/bin/clang`) | pinned `llvm-tools` (`lib/rustlib/aarch64-apple-darwin/bin`) |
|---|---|---|
| Version | Apple clang 21.0.0 (clang-2100.3.34.2); its LLVM base not stated | `LLVM version 23.1.3-rust-1.101.0-nightly`, `rustc -vV` says 23.1.3 |
| hello.rs IR | compiles, with a warning overriding the triple (`arm64-apple-macosx26.0.0` over rustc's `11.0.0`) | compiles |
| prog.rs IR | **fails**: `unterminated attribute group`, at `nocreateundeforpoison` | compiles |
| Same code as rustc | no | `llc` links `@rpath/libLLVM.dylib`; the dylib `rustc` uses has the same SHA-256 prefix (`b7a4d6261326`) |
| Tools | `clang`, `ld` | `opt`, `llc`, `llvm-as`, `llvm-dis`, `llvm-link`, `llvm-ar`, `llvm-nm`, `llvm-objdump`, `llvm-readobj`, `rust-lld`, `gcc-ld/*`. **No** `clang`, `FileCheck`, `llvm-lto` |

The host's dialect does not match, and no downgrade step is worth porting. `llvm-tools` is already in the oracle's checked
component list (`UPSTREAM.json`), so nothing is installed and D1 of plan-m6 is untouched. `cc` stays, only as the link driver
rustc itself calls.

### 1e. The control: how much does the pipeline itself lose?

`control.ts` takes the port out of the picture. For 150 sampled run-pass cases, with compiletest's argv on the host: the
oracle builds its binary; the oracle writes pre-pass IR; `opt default<Ox>` and `llc -Ox` produce the object; the oracle's own
printed link line relinks with that object in place of the CGU's; both binaries run.

| | Result |
|---|---|
| Compared | 148 of 150; all 148 stable across two oracle runs |
| Same exit, stdout, thread-masked stderr | **147 of 148 (99.3%)** |
| The one difference | `drop/dynamic-drop.rs`: exit and stdout agree; a `stack backtrace:` in stderr differs (the case sets `RUST_BACKTRACE`, inlining changes frames) |
| Not comparable by this method | `sanitizer/cfi/const-generics.rs` (`llc` rejects `llvm.type.test`: rustc lowers it with LTO), `issue-64655…#fat1` (`-Clto=fat`: this relink is not LTO) |
| CPU per case | opt 15 ms, llc 10 ms, link 50 ms |

So when the port's IR is right, behaviour parity is reachable with these tools, and a wrong binary points at the port, not
the tools.

### 1f. Targets

| | x86_64-unknown-linux-gnu | aarch64-apple-darwin (host) |
|---|---|---|
| IR, cross | **yes**: no linker needed; every M2–M6 suite's target; M5's byte-identical std | yes |
| Port today | collector + partition work; x86_64 ABI 5/5 | **stops**: `callconv/aarch64.rs` 0/6 (202 lines), `compute_rust_abi_info`. It stops even `cargo check` of some host crates |
| Link | no glibc sysroot here | `cc`, as rustc does |
| Run | no. Docker is installed but its daemon is not running; no VM found. Unchecked | **yes** |
| Native determinism | | 233 of 236 stable (stdout, exit, thread-masked stderr), 234 on stdout and exit |
| std | rlibs from `rust-std` (161 MB), present | present, plus `libstd-*.dylib` (compiletest's `-C prefer-dynamic`) |
| M9 | | host proc-macro dylibs are built for this target (plan-m6 A4) |

Native sample (240 run-pass cases, compiletest's argv, host): 236 build (2 link failures, 1 Apple-only static error, 1
duplicate candidate), 235 exit 0, 1 exit 101. Build p50 0.076 s, p99 1.03 s, max 1.88 s. Run p50 1 ms, max 10 ms.

### 1g. Parity, defined

- **IR parity (per case):** the same compiler exit and stderr, and the normal forms of the pre-pass `.ll` byte-identical. It
  catches what a program never shows: a wrong `noalias`, alignment, `nuw`, or niche.
- **Behaviour parity (per case):** both binaries, built from the same argv, run from their own temporary directory under one
  fixed file name. Exit code, signal and stdout are equal; stderr is equal after masking the thread id and cutting `stack
  backtrace:` blocks. It catches what IR text cannot: the link, the object format, unwinding, the runtime, and the
  `opt`/`llc` flags.
- **Not parity:** IR after passes, object bytes, binary bytes. The control shows they are not needed, and they have too many
  sources of difference for a ratchet.
- Compiletest's `check-run-results` files are not used: the oracle's program is the expectation, as in plan-m6 D6.

Is IR parity the right gate, or behaviour? **Both, with behaviour as the milestone's name.** IR is what lets x86_64-linux be
checked at all here, and it localises a bug to one function. Behaviour is what PLAN.md asks for, and the only check of half
the new code.

## 2. Architecture

### 2a. The seam

| | **A. FFI seam (recommended, D4)**: port `rustc_codegen_llvm`; `llvm::LLVM*` become TS over an IR model | B. trait seam: hand-write a `Builder` / `CodegenCx` that prints text | C. `bun:ffi` into `libLLVM.dylib` |
|---|---|---|---|
| Upstream logic | all of it, line by line, same names and order | discards about 25k lines of logic: `intrinsic.rs`, `asm.rs`, `attributes.rs`, `consts.rs`, `abi.rs`, `debuginfo/*`, which decide every attribute | line by line |
| PORTING | fits: one non-port edge, like D7's FFI edge in plan-m6 | a redesign, which AGENTS.md forbids | fits |
| Exactness | parity depends on emulating the LLVM behaviours in §2c | also, and on re-deriving the logic | exact where exports exist |
| Blocker | none found | | **`LLVMRust*` are not reachable**: 131 of the 381 FFI fns are C++ wrappers; `librustc_driver` exports 1 such symbol, `libLLVM.dylib` exports 1,309 `LLVM*` C functions. `LLVMRustOptimize` and the DI wrappers would have to be reimplemented anyway. It also makes the port depend on a native binary in-process, contrary to PLAN.md |
| Speed | allocates JS objects per instruction | same | an FFI call per instruction |

The trait seam looks smaller, but `builder.rs` is 2,227 of 31,078 lines. The logic that decides the IR sits above and beside
it.

### 2b. `rustc_codegen_llvm` at the pin: 31,078 lines, 1,338 fns

| Group | Files | Lines | Fns | What happens to it |
|---|---|---|---|---|
| FFI declarations | `llvm/ffi.rs` | 2,630 | 387 | **Replaced** by the IR model (§2c); excluded from coverage |
| FFI helpers | `llvm/mod.rs`, `conversions.rs`, `metadata_kind.rs`, `value.rs`, `macros.rs` | 795 | 73 | Ported |
| Builder | `builder.rs`, `allocator.rs` | 2,412 | 148 | Ported |
| Context | `context.rs`, `common.rs` | 1,818 | 97 | Ported |
| Types, attributes, declarations | `type_.rs`, `type_of.rs`, `declare.rs`, `callee.rs`, `attributes.rs` | 1,834 | 109 | Ported |
| Items | `base.rs`, `mono_item.rs`, `lib.rs` | 610 | 17 | Ported |
| ABI, consts | `abi.rs`, `consts.rs` | 1,743 | 47 | Ported |
| Intrinsics | `intrinsic.rs` (:1–:2046 scalar, :2047–end SIMD) | 3,473 | 31 | Ported |
| Inline asm, va_arg | `asm.rs`, `va_arg.rs` | 3,008 | 33 | Ported |
| Backend driver | `back/write.rs`, `back/llvm_backend.rs`, `llvm_util.rs`, `back/owned_*`, `back/profiling.rs`, `back/archive.rs` | 2,963 | 110 | Ported; `opt`/`llc` calls behind `LLVMRust*` names (§2c) |
| LTO, diagnostics | `back/lto.rs`, `diagnostics.rs`, `llvm/diagnostic.rs` | 1,357 | 26 | Ported; ThinLTO stops (D8) |
| Debuginfo | `debuginfo/*` | 5,265 | 129 | Ported; `LLVMDI*` in the IR model |
| **Out of M7** | coverageinfo 1,172; enzyme_ffi 555, autodiff 387, typetree 180; gpu_offload 736, offload_ffi 133 | 3,163 | 131 | `unported(...)`, as `rustc_monomorphize`'s offload |

**Logic to port: about 25.3k lines, about 820 fns, against 2.6k lines of FFI to replace.**

Today `harness/scope.json` excludes the whole crate ("replaced by our own text-LLVM-IR backend"), and
`src/rust_ts/codegen_backend.ts` (673 lines, a stand-in with oracle `target_config` tables) stops at `codegen_crate`.
`rustc_llvm` stays excluded, with its 4,112 lines of C++ as the specification of the replaced calls.

### 2c. What the IR model replaces

All 381 FFI functions are called from outside `ffi.rs`. By name pattern (±a few):

| Class | Fns | Examples | In the model |
|---|---|---|---|
| Instruction builders | 89 | `LLVMBuildAdd`, `LLVMBuildCallWithOperandBundles`, `LLVMBuildGEPWithNoWrapFlags`, `LLVMRustBuildMemCpy` | objects in a block; **fold when operands are constant** |
| Module and value mutation | 51 | `LLVMSetAlignment`, `LLVMReplaceAllUsesWith`, `LLVMDeleteFunction`, `LLVMSetNSW`, `LLVMRustAddFunctionAttributes` | field writes |
| Backend driver | 50 | `LLVMRustOptimize`, `LLVMRustWriteOutputFile`, `LLVMRustCreateTargetMachine`, `LLVMRustPrintModule`, ThinLTO, `LLVMRustCoverage*` | process calls, or stops |
| Other | 44 | attribute creators, operand bundles, `LLVMAppendBasicBlockInContext`, `LLVMRustInlineAsmVerify`, `LLVMRustTargetHasMnemonic` | mixed |
| Read-back | 43 | `LLVMGetOrInsertFunction`, `LLVMRustGetOrInsertGlobal`, `LLVMIsDeclaration`, `LLVMGetAlignment`, `LLVMGetParam`, `LLVMGetValueName2` | **why it cannot be a text stream** |
| Types | 40 | `LLVMStructTypeInContext`, `LLVMGetIntrinsicDeclaration`, `LLVMTypeOf`, `LLVMRustUpgradeIntrinsicFunction` | uniqued objects |
| Debuginfo | 40 | `LLVMDIBuilderCreateStructType`, `LLVMRustDIBuilderCreateFunction`, `LLVMDIBuilderInsertDeclareRecordAtEnd` | metadata objects |
| Constants | 24 | `LLVMConstInt`, `LLVMConstInBoundsGEP2`, `LLVMConstStructInContext`, `LLVMIsAConstantInt` | uniqued objects |

Emission is therefore **model first, printer at `LLVMRustPrintModule`**, not `console.log` per instruction (D5). The model
lives in `src/rust_ts/llvm/` (not ported code, PORTING §2) and exports the FFI names unchanged, so `builder.ts` reads like
`builder.rs`.

LLVM behaviour the model must imitate. **None of this is in the pin's sparse checkout**: `src/llvm-project` is a submodule
(`aab11ee0ea5e`, branch `rustc/23.1-2026-07-22`). The list comes from reading the FFI's uses and from my knowledge of LLVM,
and is **not verified against that source**. The lane fetches the specific files it needs into `$RUST_TS_DATA` (D5).
- `IRBuilder`'s `ConstantFolder`: `LLVMBuildAdd(const, const)` returns a constant, and GEP/cast/compare fold or become
  constant expressions.
- `ValueSymbolTable` collision suffixes, per function and per module.
- `Value::setName`, including names on arguments and blocks; `fewer_names` dropping them.
- Intrinsic name mangling (`llvm.memcpy.p0.p0.i64`) and the overload check; `LLVMRustUpgradeIntrinsicFunction`.
- `LLVMRustPositionBuilderPastAllocas`, insertion points, RAUW.
- Declaration re-use and the `LLVMGetOrInsertFunction` type rule.
- `LLVMRustInlineAsmVerify`, `LLVMRustTargetHasMnemonic`: cannot be imitated exactly (D10).

**What it does not need:** numbering, attribute groups, use-lists, default alignments, intrinsic declaration attributes
(§1b), and any verifier: `opt` is the verifier.

### 2d. `rustc_codegen_ssa`: 30,703 lines, 113 of 1,091 fns ported

Done: `back/metadata.rs`, `back/symbol_export.rs`, `codegen_attrs.rs`, `diagnostics.rs`, `target_features.rs` (4,324 lines).
Partial: `back/link.rs` 7/87, `back/linker.rs` 7/218, `back/lto.rs` 2/8, `base.rs` 8/28, `lib.rs` 5/11, `traits/backend.rs`
10/20. **Left: about 26.4k lines, 978 fns.** It is generic over `Bx: BuilderMethods`, so it ports like any other crate, once
the traits exist as TS interfaces with the associated types (`Value`, `Type`, `BasicBlock`, …) erased to the model's classes
(the plan-m6 D3 pattern).

| Group | Files | Lines | Fns |
|---|---|---|---|
| Traits, common | `traits/*`, `common.rs` | 1,853 | 290 (10 done) |
| MIR core | `mir/{mod,analyze,locals,constant,statement,coverageinfo}.rs`, `mono_item.rs`, `meth.rs`, `size_of_val.rs` | 1,899 | 43 |
| Operands, places, retag | `mir/{operand,place,retag}.rs` | 2,450 | 75 |
| Rvalues, intrinsics, naked | `mir/{rvalue,intrinsic,naked_asm}.rs` | 2,369 | 25 |
| Terminators | `mir/block.rs` | 2,605 | 35 |
| Crate driver | `base.rs`, `lib.rs`, `back/lto.rs`, `assert_module_sources.rs` | 2,183 | 57 |
| Debuginfo | `mir/debuginfo.rs`, `debuginfo/*` | 1,802 | 54 |
| Write | `back/write.rs` | 2,271 | 40 |
| Link | `back/link.rs` (:1–:2104, :2105–end) | 4,196 | 87 |
| Linker | `back/linker.rs` + tests, `command.rs`, `rpath.rs` + tests, `apple.rs` + tests | 2,757 | 261 (7 done) |
| Archive | `back/archive.rs`, `rmeta_link.rs`, `symbol_edit.rs`, `link/raw_dylib.rs` | 1,960 | 49 |

`mir/debuginfo.rs` must come early, even without `-g`: it is what names values (`%self`, `%_4`), and those names are in the
normal form.

Vendor, at `Cargo.lock`'s versions: `ar_archive_writer` 0.5.3 (2,783 lines, about 60 fns); `object` 0.39.1 write side
(`write/{mod,string,util}` + `macho` 2,847 lines, `elf/*` 3,326 lines; 417/2,862 ported today, all read side; coff/pe/xcoff
stay `unported`); `pathdiff` (rpath). `thorin-dwp` stays `unported` (DWARF packages); `regex` is one line in
`back/link.rs:1295` (a linker error filter) and can be a `PORT:` regexp; `tempfile` goes through `src/std`.

### 2e. Topic by topic

| Topic | What it is | Plan |
|---|---|---|
| Allocator shim | `allocator.rs` (185 lines), a second module when linking an executable or dylib | ported in `cg-builder`; first native milestone |
| Debuginfo (`-g`) | 5,265 + 1,802 lines. IR grows 4.6× on prog.rs. Its 25 run-pass cases are few, but ripgrep's profiles have it (`debug = 1` in release, `debuginfo=2` in dev) | last wave, needed for stock ripgrep (D9). The normal form handles it (`idem.sh`: renumbered text, diff 0) |
| Inline asm | `asm.rs` 1,708, `mir/naked_asm.rs` 522. Text IR (`call void asm sideeffect "…"`). 16 run-pass files mention `asm!` | M7c. Errors from LLVM (E0668, `llc` stderr) cannot match bytes (D10) |
| Intrinsics | `intrinsic.rs` 3,473, `mir/intrinsic.rs` 645. SIMD is :2047–end; 58 run-pass files mention SIMD or `arch` | scalar in the first fill wave, SIMD in M7c |
| Vtables | `meth.rs`, `consts.rs`; **`vtable_allocation_provider` stops today** (§5, O3) | preflight |
| Unwinding | `block.rs` (`invoke`, cleanup, landing pads), `rust_eh_personality`, oracle's `panic_unwind` rlib. No port of the unwinder: it is std's. 69 run-pass files use `catch_unwind` or `should_panic`. 18 use `panic=abort` | M7b; native suites are the only check |
| `-O` | Upstream MIR passes (ported, §5) + `opt default<Ox>` (D8) | |
| LTO | 34 run-pass cases have `-C lto`. **std's rlibs carry bitcode** (`__LLVM,__bitcode` and `.llvmbc` sections, checked). Fat: `llvm-link` + `opt`. ThinLTO: no tool (`llvm-lto` absent) | D8 |
| Target features | `miri-tail-a` kept `llvm_util::target_config` as an oracle table + `ORACLE_ACCEPTED_LLVM_ARGS`; "any other value stays `unported`" | The table stays for `--print cfg`. `-C target-feature` reaches attributes through the ported `global_llvm_features`. `llvm_util.rs` is ported around it; `-Ctarget-cpu=native` stays a stop |
| Mono lanes | `rustc_monomorphize` 90/153: everything but `offload` (63 fns, 488 lines, `unported`). Not wired: `DEFAULT_QUERY_PROVIDERS` omits it; `partitioning.ts` has a load-order failure as an entry | `mono-wire` preflight, with `docs/reviews/mono-lanes.md`'s P1, N1–N5, C1–C3 |

## 3. The standard library, rlibs and linking

**Start from the oracle's rlibs (D6).** The port already decodes them. Same reasoning as plan-m6 D4: it keeps codegen
divergences apart from encoder divergences. Mixing is sound if symbols agree, and `symbol_mangling` is 71/71. Mono items for
upstream generics already resolve against those rmetas: the review's sweeps and this lane's collector runs all use them.
Measured link inputs: `symbols.o`, the CGU, the shim, 19 std rlibs, `-lSystem -lc -lm -arch arm64 -mmacosx-version-min=11.0.0
-Wl,-dead_strip -nodefaultlibs`, under `ZERO_AR_DATE=1`, `SDKROOT=…`, `LC_ALL=C`.

**Compiletest's argv is not the default.** It passes `-C prefer-dynamic` on 3,440 of 3,478 run-pass cases and `-Crpath`, so
these link `libstd-*.dylib`. `dependency_format` and `rpath.rs` are on the first path, not an edge.
`rustc_codegen_ssa::back::rpath` is 0/6 today.

**Rlib output** (aux crates, ripgrep): `link_rlib` (`back/link.rs:545`) + `back/archive.rs` 0/22 + `rmeta_link.rs` 0/8 +
vendor `ar_archive_writer`. These are also what `miri-sysroot` and `harness-m6d` need; both are still queued in
`docs/next.md`. **Fold them into wave 42 and 44** rather than keeping a second lane on the same files (D7). The Miri path
then needs only `MiriDepCompilerCalls`, and the report suites follow.

**Linker path.** `back/link.rs` (4,196 lines, 87 fns) and `back/linker.rs`. The port needs only `GccLinker` on macOS and
`cc`; PORTING §3 still says port every fn, in order. `symbols.o` and the metadata object need `object`'s writer. Windows
(`raw_dylib`, msvc) stops.

**Port-built std: a report in M7, needed by M9.** Measured: core has **1,316 mono items** at `-Copt-level=3`
(`--emit=llvm-ir`, 83,677 lines, 4.36 MB, oracle 5.77 s user, 1.28 GB). `opt` O3 0.75 s, `llc` 0.42 s. Defined text symbols
in the x86_64-linux rlibs after optimization: core 599, alloc 121, std 1,374. The port's check times from the last gate: core
1.4 min, alloc 0.3, std 0.3. So a port-built sysroot is minutes, dominated by the front end, with about 12 GB RSS on core
(the known watch item). It is not a blocker for anything before M9, but it is the proof that the backend stands on its own.

**M9 consequence (plan-m6 A4).** Until the port builds host dylibs, every proc macro it runs was compiled by the oracle. M7's
host-native choice serves this directly: `--crate-type proc-macro` on `aarch64-apple-darwin` through the same path, loaded by
the existing `pm-host` FFI edge. ripgrep 15.2.0 turns out to need **no proc macros at all** (checked: no `proc-macro` crate
type in its 46 rustc runs), so M7's gate does not depend on this. Keep a small `pm-self` suite anyway, so that M9 does not
discover the gap: D19.

## 4. Speed

**The port up to mono on real programs** (x86_64-linux; `lb.ts` stops after partitioning):

| Program | Port CPU: analysis / collect + partition | Items | Port rss | Oracle, all phases |
|---|---|---|---|---|
| hello.rs | 0.81 s (`--emit=metadata`) / +0.11 s | 9 | 415 MB | 0.01 s |
| prog.rs | about 1.9 s / +0.83–1.04 s | 323 | 750 MB | 0.05 s, to an object |
| run-pass sample, 113 cases | p50 1.43 s, p90 2.28 s, max 4.66 s total | p50 10, p90 51, max 271 | p50 478 MB, max 877 MB | build p50 0.076 s |
| `rg` bin, debug profile, oracle-built deps, vtable provider stubbed | 13.4 s / +5.13 s | 5,160 fns | 1.9 GB | 2.13 s (host, with LLVM) |

The walk `lb.ts` does after collection (instance MIR, ABI, symbol, layout of each local and assigned place) takes 2–3 µs per
statement on `rg` and prog.rs, because collection already filled those queries. So type work is **not** where codegen will
spend its time. (The direct-call ABI part of that walk failed in my script, 21,566 of 21,580 calls in the error path, so it
is unmeasured.) rg's items average 30 statements plus terminators.

**All of ripgrep 15.2.0 through the port's front end** (`cargo check` with the port as rustc, x86_64-linux target, -j3; the
oracle built the build scripts):

| | Port | Oracle |
|---|---|---|
| Result | **34 of 34 lib and bin crates exit 0**, and the warnings and errors cargo reports are the oracle's, after working around 2 stops (§5, O4, O5) | |
| CPU | 339 s (323.6 + `rg` 15.7) | 5.79 s (58×) |
| Largest | `regex_automata` 34 s, `serde_core` 33 s, `regex_syntax` 27 s / 3.9 GB, `encoding_rs` 18 s, `libc` 17 s | |
| `.rmeta` | **34 of 34 byte-identical** at one path, including `rg`. The 29 of 34 this plan first reported compared two directory names, and the oracle against itself gives the same 29 (O6, `docs/reviews/real-crates.md`) | |

This is the first run of the port on code outside the test suites. It is the best news in this plan.

**Oracle's whole build** (46 rustc runs: 33 libs, `rg`, 10 build scripts, 2 probes): debug 12.78 s user, 32,171 mono items,
6.4 s wall at -j4, 362 MB; release 41.73 s, 25,865 items, 14.75 s wall, 428 MB. `codegen_to_LLVM_IR` sums to 1.66 s (debug)
and 1.59 s (release), about 52 µs per item.

**Codegen, estimated, not measured** (no code exists). The port runs 10× the oracle per CTFE step (plan-m6) and 58× on whole
front-end runs, which includes startup and cold JIT. With 10–60× on 1.66 s:

| ripgrep phase, CPU | Debug, no debuginfo | Note |
|---|---|---|
| Front end | 339 s | measured |
| Mono collection | about 32 s | 1 ms per item on `rg`, measured on one crate, scaled |
| TS codegen and printing | 17–100 s | estimate; debuginfo multiplies text by up to 4.6× |
| `opt` + `llc` | 6–35 s | the oracle's total minus its front end (debug, release); parsing text adds time at about 60 MB/s |
| Process spawns | about 30 s | 2 per CGU; cargo's dev default is 256 CGUs |
| **Total** | **about 7–9 min CPU; 2–4 min wall at -j4** | peak about 4–5 GB per process |

**Suites.** A run-pass case: about 1.5 s to mono, 0.5–1 s codegen (cold JIT, estimate), 0.08 s of tools: about **3 s CPU**.
Times 3,478 ≈ 3 CPU-hours ≈ 22 min wall at 8 jobs, the same order as `run-pass-miri`'s 25 min.

**Startup.** Today 0.7–0.8 s of each case (10 Ginstr for hello `--emit=metadata`). Codegen modules must be `import()`ed only
when codegen runs: M7 adds about 60k TS lines, and 530k protected cases must not pay for them (D14).

**The bytecode bundle (deferred, `docs/state/history.jsonl:610`).** That record: hello 29.1 → 16.0 Ginstr in one run, on the
Miri entry. **I could not reproduce it on the rustc entry:** `bun build --bytecode --format=esm` says "ESM bytecode requires
--compile"; `--compile --bytecode` and CJS fail on the top-level `await` at `src/rust_ts/main.ts:42`. So it needs an entry
change first. It is still the largest single gate saving available: most of those 530k cases are startup. plan-ice-report's
review F6 adds a constraint: without source maps, the ICE location resolver refuses every frame, so 92 future protected cases
would be lost; use `--sourcemap`. Recommended as its own batch in wave 39 (D14).

## 5. Bugs M7 hits first

**How much of optimized MIR has been exercised** (`mir/cov.ts`, static, over each suite's argv; session `mir_opt_level()` is
1 at `-Copt-level=0`, otherwise 2; `-O` is `-Copt-level=3`, config.rs:2070):

| Suites | `-O` / opt-level | MIR actually seen |
|---|---|---|
| `mir` 21,525 cases, `mir-core`, `mir-alloc`, `mir-std`, `rmeta-*`, `check-*` | none | **`mir_opt_level` 1 only** |
| `mir-minicore` | 3 of 46 `-O` | the only protected optimized-MIR cases at level 2 |
| `mirdump-ui` | 156 `-O`, 19 level 3, 5 level 4 | `mir_built` and `mir_promoted`, not `optimized_mir` |
| `borrowck-*`, `tydump-ui`, `thirdump-ui`, `thir-tree`, `pm-*` | some `-O` | stop before `optimized_mir` for the program (not audited case by case) |
| `run-pass-miri` | `-O` on 3,348 | Miri's own `-Zmir-opt-level=0` wins |
| Unit tests | `src/rustc_monomorphize/*` | a few programs at opt-levels 0–3 |

So the level-2 pipeline (Inline, GVN, JumpThreading, …), which every `-O` compile uses, is essentially **unprotected**. It
runs for 3,358 of 3,478 run-pass cases in M7.

**O2 is real, common, and in the inliner.**

| Measurement | Result |
|---|---|
| `mir` corpus + `-Copt-level` 1, 2, 3, 100 cases each | 100/100 MATCH at each level, but only 26 exit 0 on the oracle: weak, these files run without their directives |
| 120 run-pass cases with compiletest's flags (115 have `-O`), `-Zunpretty=mir` | **115 MATCH; 5 ICE** (`broken MIR … after phase change to runtime-optimized`), oracle exit 0 |
| Same 120, through collect + partition | 113 exit 0, 5 ICE, 1 UNPORTED (vtable), 1 exit 1 |
| `prog.rs -O`, and ripgrep's `rg` (`from_low_args`, `doc_long::DOC`) | ICE |
| `prog.rs -O -Zinline-mir=no`, `-Zmir-enable-passes=-Inline` | **byte-identical to the oracle** |
| `-GVN`, `-JumpThreading`, `-RemoveUnneededDrops`, `-DestinationPropagation`, `-DataflowConstProp`, `-EarlyOtherwiseBranch` | still ICE |
| `-Copt-level=1`; `-Copt-level=1 -Zmir-opt-level=2` | MATCH (`inline.rs:55` enables Inline at level 2 only for opt-level 2 and 3) |

Smallest repro found (`o2/p2.rs`), oracle exit 0, port ICE, `--edition=2021 --target=x86_64-unknown-linux-gnu -O
-Zunpretty=mir`:

```rust
fn eval(mut st: Vec<f64>) -> Result<f64, String> { let b = st.pop().ok_or("u")?; st.push(b); Ok(b) }
fn main() { println!("{:?}", eval(vec![1.0])); }
```

With a second `st.pop().ok_or("u")?` in place of `st.push(b)` it matches, so this is not simply "the same callee twice". The
validator reports an unwind edge into a plain block (`cleanup false -> false`). The Integrator's block mapping reads correct
against upstream. **Root cause not found.** 4.2% of the sample, 95% interval roughly 1.4–9.5%.

| # | Finding | Effect | Plan |
|---|---|---|---|
| O2 | above | blocks `-O` broadly, and ripgrep | **first lane** |
| O1 | `type_length` wrapping, `ty/instance.ts:729` (review O1) | one `build-fail` diagnostic (`issue-83150`) | `real-crates` |
| O3 | `vtable_allocation_provider` stops at `Allocation::new`, `ty/vtable.ts:93` | 1 of 120 sampled, and `rg` | preflight; looks small |
| O4 | `rustc_data_structures::jobserver::initialize` stops under `CARGO_MAKEFLAGS` | **every crate under cargo** | preflight, needed for ripgrep |
| O5 | `build_output_filenames`'s `invocation_temp` stops with `-C incremental` (rand) | cargo's dev profile | D11 |
| O6 | **Not a port difference.** This row said `serde_core.rmeta` and 4 others differ from the oracle's. That was the comparison: it used two directory names, and the path is in the bytes. At one path the port is identical on 34 of 34 (`docs/reviews/real-crates.md`) | none | closed |
| O7 | `callconv/aarch64.rs` 0/6 | no host target past `compute_rust_abi_info`, even in `cargo check` | preflight |
| O8 | `P1`: `dump_mono_items_stats` catch relabels a panic | wrong stop name | `mono-wire` |

## 6. Suites and gates

Each suite is a separately reviewed harness batch (plan-m6 A2). Report until accepted, and everything accepted is protected,
as always (A9). Denominators exclude ORACLE_TIMEOUT and oracle-unstable cases.

| Suite | Mode | Cases | Oracle CPU | Port estimate, wall at 8 jobs | Role |
|---|---|---|---|---|---|
| `mir-o2` | `-Zunpretty=mir`, compiletest's argv, x86_64-linux | 3,479 (run-pass corpus, no aux) | about 3 min | 11 min | **M7a ≥ 99%**, then protected. Measured 115/120 |
| `mono-ui` | `-Zprint-mono-items=yes` on the same | 3,479 | about 5 min | 12 min | **M7a ≥ 99%**. Measured: 113/120 reach the end, review 351/363 MATCH |
| `check-rg` | ripgrep's 34 crates, `--emit=metadata`, rmeta bytes | 36 reported cases, of 34 crates | 6 s | 6 min, heavy | **M7a ≥ 33**, then 34 |
| `ir-hello` | normal form | 2 (`-O`, `-Copt-level=0`) | | | **M7a** |
| `ir-run-pass` | normal form; compiletest's argv + `-Cno-prepopulate-passes --emit=llvm-ir`, x86_64-linux | 3,478 | 66 s + 35 s of `opt` | 18 min | **M7b, M7c** |
| `ir-run-pass-o0` | the same + `-Copt-level=0` (other MIR, no lifetime markers) | 3,478 | 2 min | 18 min | report → M7c |
| `ir-codegen` | tests/codegen-llvm's argv on normal form, no FileCheck | ≥ 848 files, 483 measured so far (364 need revisions, `needs-`, aux, targets) | 7 s | 4 min | report → protected. Finds attributes first |
| `ir-host` | `ir-run-pass` for aarch64-apple-darwin | 3,478 | 2 min | 18 min | report: localises native failures |
| `native-hello` | behaviour, host | 1 | | | **M7b** |
| `run-pass-native` | behaviour | 3,470 + heavy | about 6 min | 22 min | **M7b, M7c** |
| `run-fail-native` | behaviour | 294 | 30 s | 2 min | **M7c** |
| `run-pass-aux-native` | behaviour; aux rlibs built by each side's compiler | 356 | 1 min | 4 min | report → M7d |
| `pm-self` | pm-ui's cases with proc-macro aux built by **the port** | 282 | none new | 8 min | report; 1 case in M7d |
| `rg-build` | real `cargo build --release` with `RUSTC`=port, pinned `Cargo.lock`, `rg` on host | 1 | 42 s | about 4 min, heavy | **M7d** |
| `rg-behaviour` | scripted queries on a fixed corpus, oracle-built vs port-built `rg`; plus ripgrep's own 333 `rgtest!` integration tests, as a report | about 50 + 333 | | | **M7d** |
| `std-self` | port-built core, alloc, std; hello links and runs | 1 | | minutes, heavy, 12 GB | report (M9) |

Oracle caches: IR is about 230 MB per suite uncompressed (16.0 MB over 240 cases) and only 16-19 GB of disk is free (25 GB when this plan was measured). Cache
**gzipped normal forms** (D12). The output is bound to this machine, per plan-m6 A11.

**Gates** (`scripts/criteria.ts` groups, per A12):
- **M7a, IR first light:** `ir-hello` MATCH; `mir-o2` ≥ 99%; `mono-ui` ≥ 99%; `check-rg` ≥ 33 of 34.
- **M7b, native first light:** `native-hello` MATCH; `run-pass-native` ≥ 80%; `ir-run-pass` ≥ 70%.
- **M7c, run-pass parity:** `run-pass-native` + heavy ≥ **98%**; `run-fail-native` ≥ 95%; `ir-run-pass` ≥ 95%. 98% is set
  against the control's 99.3% (§1e), and the plan-m6 review's objection (G1) that a low bar hides failures applies: 2% of
  3,478 is about 70 named cases, which the gate record lists (sanitizers 24, CFI, asm that LLVM rejects, …).
- **M7d, ripgrep:** `rg-build` passes with the stock release profile, `rg-behaviour` scripted set MATCH; `check-rg` 34 of 34;
  1 `pm-self` case.
- **M7 = M7a–d.**
- **Report only:** `ir-run-pass-o0`, `ir-codegen`, `ir-host`, `run-pass-aux-native` before M7d, `pm-self` (the rest),
  `std-self`, `miri-sysroot-*`.

**Gate time.** Now 10.66 h (sum of suite `seconds`, gate-20261104-143144); unit step 1,266 s quiet of its 1,800 s limit (a
mid-wave run reached 2,005 s under load). Protecting all of the above adds about 2.2 h. The 530k startup-dominated cases are
the large term, hence D14. **The unit step has about 9 minutes left and M7 must not spend them:** each lane adds ≤ 15 s of
unit-test wall; anything heavier is a suite. `scripts/ir-diff.ts` uses fixtures to keep lanes' tests cheap.

Debug tool (not a suite, D17): `scripts/ir-diff.ts <case>` prints the first differing **function** and line of the two normal
forms. `phase-diff` gets an `ir` phase after `mir`.

## 7. Decisions

**D1. The backend runs the pinned toolchain's `opt` and `llc`, and links with `cc`. Amends PLAN.md §4 and the M7 row ("system
clang").** Measured: Apple clang cannot parse the IR; `llc` uses rustc's own `libLLVM.dylib`. `llvm-tools` is in the oracle's
checked components; nothing is installed. Called by absolute path, with its hash in the guard test and the cache key.

**D2. Parity is IR normal form (pre-pass) and behaviour, separately. IR after passes, object and binary bytes are not
gates.** Normal form as in §1b. §1c explains why.

**D3. IR suites target x86_64-unknown-linux-gnu; native suites target aarch64-apple-darwin.** Amends PLAN.md §4's "target
x86_64-linux first" for execution only. x86_64-linux execution is not available here (no daemon, no VM, no glibc sysroot);
AGENTS.md §5 allows a Linux VM later as a report. Host is also what M9's dylibs need.

**D4. Port `rustc_codegen_llvm`, with the seam at `llvm/ffi.rs`.** `src/rustc_codegen_llvm/<path>.ts`, markers as usual;
`ffi.rs`, enzyme, autodiff, typetree, offload, coverageinfo out of coverage, as `scope.json` `partial`/`excluded` entries
like Miri's. **`scope.json` changes need the owner's approval** (the plan-m6 review's D2(b)). `rustc_llvm` stays excluded.
§2a compares the alternatives.

**D5. `src/rust_ts/llvm/` is an in-memory IR model with a printer, exporting the FFI's names.** Not a text stream: 43
read-back functions, RAUW and deletion need objects. Non-ported code under its own contract, reviewed separately. Read the
LLVM source it imitates at `aab11ee0ea5e`: fetch specific files into `$RUST_TS_DATA`, do not add the submodule to the sparse
checkout. Fold rules are ported from `ConstantFold.cpp`/`IRBuilderFolder` with `// llvm:` markers, kept minimal: only what a
reached call needs, `unported` otherwise. Never guess a fold.

**D6. M7 links the oracle's std rlibs. Port-built std is the report `std-self`.** §3.

**D7. Rlib and archive work moves from the queued `miri-sysroot` into `ssa-archive` and `vendor-ar`.** `harness-m6d` follows
at wave 44. M6 is done, so nothing waits for them, and the same files would otherwise have two owners.

**D8. `-O` runs `opt -passes=default<Ox>` and `llc -Ox` with flags mapped from `LLVMRustCreateTargetMachine` and
`ModuleConfig`** (`-Cno-vectorize-*`, `-C llvm-args`, `-Zmerge-functions`, …), with a `PORT:` per flag that has no `opt`
form. Not byte parity. **`-Clto=fat`:** bitcode from rlibs (checked present) + `llvm-link` + `opt`. **ThinLTO, including the
default `ThinLocal` at `-O` with several CGUs:** no tool does it. `ThinLocal` becomes a no-op with `PORT:`: the same
behaviour with less cross-CGU inlining, slower `rg` but correct. `-Clto=thin` stops at `unported`, unless `rust-lld` proves
workable (unchecked). Compiletest's argv has `-Ccodegen-units=1` (every case in the control had one CGU), so its `ThinLocal`
is already off.

**D9. Debuginfo lands last, and M7d's stock profile needs it.** `mir/debuginfo.rs` is early, because it names values even
without `-g`. The rest (`cg-di-*`, `llir-di`) is wave 44; until then cases with `-Cdebuginfo>0` stop by name. `rg` first
builds with `CARGO_PROFILE_RELEASE_DEBUG=0`. (`-Csplit-debuginfo`, dwp: `unported`.)

**D10. Inline asm is ported; what only LLVM can answer stops or passes through.** `LLVMRustInlineAsmVerify` and
`LLVMRustTargetHasMnemonic` return the permissive answer with `PORT:`, and `llc`'s stderr is the error. Build-fail tests that
need byte-identical LLVM errors are outside run-pass; they stay `unported` by name and do not count.

**D11. `-C incremental` stays out of scope (`scope.json`).** Suites and `rg-build` set `CARGO_INCREMENTAL=0`. Port
`invocation_temp` (O5) only if a non-incremental path reaches it. Port `jobserver::initialize` (O4) for an inherited client:
acquire nothing, since the port is single-process; `PORT:`, no output depends on it.

**D12. Harness: one wrapper, gzipped cache.** `scripts/ir-run.ts` runs a side, normalises and prints (as `rmeta-run.ts`
does); difftest compares stdout. `scripts/native-run.ts` builds into a per-case directory and runs twice on the oracle's side
(UNSTABLE otherwise). Stderr masks: stderr only, thread ids (plan-ice-report's mask), `stack backtrace:` blocks.
`rust_test_helpers` is built once with `cc` for the suite (44 run-pass files use it or `#[link]`).

**D13. Preflight before contracts.** O2, O3, O4, O7, `mono-wire` and `mir-o2`, `mono-ui`, `check-rg` come first. They
need no codegen, each is a real bug on the M7 path, and the protected sets cannot see them today. Everything downstream would
otherwise diverge from MIR that is wrong.

**D14. Startup: lazy-load codegen, and do the bundle as its own batch.** `rustc_codegen_*` and `rust_ts/llvm` load by
`import()` at `codegen_crate`, so no existing suite pays. Bundle: remove the top-level `await` at `main.ts:42` or use a
wrapper entry; `--sourcemap` (F6); measure Ginstr on hello and on one gate suite. It changes every suite's subject, so one
reviewed batch, one full gate on it alone.

**D15. Codegen is single-threaded; `opt`/`llc` per CGU are spawned serially at first.** Upstream's coordinator thread and
jobserver token logic in `back/write.rs` are ported as sequential control flow with `// PORT:` (as `par_for_each_in`).
`Bun.spawnSync`. A parallel pool is a later `PORT(perf)` change, if ripgrep's 256-CGU debug build needs it.

**D16. `opt`/`llc` failures are ICE-class.** Unparseable or invalid text is the port's bug: exit 101 with the first error
line and the module path kept for `ir-diff`. Never retried, never hidden.

**D17. `scripts/ir-diff.ts`** in `harness-m7a`, as `miri-diff.ts` in plan-m6 (its own harness lane).

**D18. Out of M7, as named stops:** `-Cinstrument-coverage`, `-Zautodiff`, `-Zoffload`, sanitizers beyond what `opt` passes
trivially, `-Ctarget-cpu=native`, Windows targets, `-Csplit-debuginfo` packages, `--print target-cpus`/`passes` (need LLVM).
`llubi`, GCC, Cranelift: no.

**D19. ripgrep is pinned at 15.2.0 with its `Cargo.lock`, built by the oracle's `cargo` with `RUSTC` set to a port wrapper.**
Fetched by a setup script into `$RUST_TS_DATA` with an isolated `CARGO_HOME`. Build scripts (10) are built and **executed**
by the port's output, the first time port-built programs run during a build. M8's `cargo-ts` is out of M7. No proc macros on
this version's default features, so `pm-self` is separate.

**D20. Harness and porting never mix (plan-m6 A2), and the new model is neither:** `llir-*` lanes own only
`src/rust_ts/llvm/`, the suites stay in `harness-m7*` lanes, and vendor lanes own `src/vendor/*`. Records: `coverage.ts`
learns `rustc_codegen_llvm` in a scripts batch.

## 8. Waves and lanes

Lanes ≤ about 3k upstream lines; ✱ = contract-first, merges before its dependants. Start 5–6 heavy lanes at a time (the wave
38 load went to 100–300 with 11 + reviews); lanes run `tsc`, own tests, samples.

**Wave 39: preflight (→ can gate alone; adds `mir-o2`, `mono-ui`, `check-rg`)**
- `o2-inline`: O2, from `o2/p2.rs`. Target: the 5 of 120, prog.rs, `rg`.
- `abi-aarch64`: `callconv/aarch64.rs` (202 lines, 6 fns). Target: hello through mono for the host.
- `vtable-alloc`: `ty/vtable.ts`, O3.
- `mono-wire`: providers in `DEFAULT_QUERY_PROVIDERS`, load order, review items P1, N1–N5, C1–C3; `tools` entries as a tools
  batch.
- `real-crates`: O1, O4, O5, and O6, which it closed as the comparison's artifact.
- `harness-m7a`: `llvm-tools` guard, `ir-run.ts` + normal form + tests of what it absorbs and what it must not, `mir-o2`,
  `mono-ui`, ripgrep setup + `check-rg`, `ir-diff.ts`.
- `startup-bundle` (harness batch, D14). May slip; nothing depends on it.

**Wave 40: contracts (✱; merge order as listed)**
- ✱`llir-core` (new, about 3k TS): types, constants, functions, blocks, instructions, names, printer. Proof: fixtures whose
  printed text reaches an oracle IR's normal form when driven by a recorded script of FFI calls.
- ✱`ssa-contract`: `traits/*`, `common.rs` (1,853 lines); TS interfaces with erased associated types; stubs per fill lane.
- ✱`cg-contract`: `llvm/{mod,conversions,metadata_kind}.rs`, `value.rs`, `macros.rs`, `lib.rs` (838 lines), a
  `CodegenCx`/`Builder` skeleton with stubs per fill lane.
- `codegen-sets-m7` (tools batch): `types.sets.json` for both crates; the `unknown` query types the mono lanes listed.

**Wave 41: fill (→ M7a)**
- `ssa-mir-core` 1,899. `ssa-operand-place` 2,450. `ssa-rvalue-intrinsic` 2,369. `ssa-block` 2,605. `ssa-base` 2,183.
  `ssa-debuginfo` 1,802.
- `cg-context` 1,818. `cg-types-attrs` 2,444 (`type_`, `type_of`, `declare`, `callee`, `attributes`, `mono_item`, `base`).
  `cg-builder` 2,412. `cg-abi-consts` 1,743. `cg-intrinsic-a` 2,046 (scalar).
- `llir-folder` (new, about 1.5k TS): folding, name suffixes, intrinsic names, attribute forms.
- Then fixers from `ir-hello`, `mir-o2` first differences. **Unlocks:** x86_64-linux IR for hello, with no linker.

**Wave 42: backend and link (→ M7b)**
- `cg-write` 2,963 + `llir-tools` (new, about 0.5k TS: `opt`/`llc` mapping, D8, D16). `ssa-write` 2,271.
- `ssa-link-a` 2,104. `ssa-link-b` 2,092. `ssa-linker` 2,757. `ssa-archive` 1,960.
- `vendor-ar` 2,783 (+ pathdiff). `vendor-object-a` 2,847 (write core + Mach-O). `vendor-object-b` 3,326 (ELF; could wait
  until a Linux VM exists, but rlib metadata objects for x86_64 cross-compiles need it).
- `harness-m7b`: native run mode, `native-hello`, `run-pass-native`, `run-fail-native`, `ir-run-pass`, `ir-run-pass-o0`,
  `ir-codegen`, `ir-host`.
- Fixers from `ir-hello`, `native-hello`, then samples of `run-pass-native`. **Unlocks:** native programs, and everything
  after.

**Wave 43: tail (→ M7c)**
- `cg-intrinsic-b` 2,727 (SIMD :2047–end, `va_arg.rs`). `cg-asm` 1,708. `cg-lto-diag` 1,357.
- `harness-m7c`: the heavy list from oracle timings, aux rlibs, `run-pass-aux-native`.
- Fixer lanes per file from the failure tail, and a perf lane on the codegen hot path. Representation changes need a recorded
  decision, as usual.

**Wave 44: debuginfo, ripgrep (→ M7d, M7)**
- `llir-di` (new, about 1.5k TS: 40 `LLVMDI*` fns). `cg-di-a` 3,005. `cg-di-b` 2,260.
- `harness-m7d`: `rg-build`, `rg-behaviour`, `pm-self`, `std-self`.
- `miri-sysroot` (now only `MiriDepCompilerCalls`) and `harness-m6d`.
- Fixers from `rg-build`.

**What it adds up to.** 25.3k + 26.4k = **51.7k upstream lines**, 6.2k vendor + 2.8k, about 6k of new TS: **about 37 lanes,
plus perhaps 15 fixers and 7 harness and tools batches**, each with an independent review. Compare M6: about 50k lines, about
30 lanes, plus fixers, in about 5 days and 4 gates. **Honest cost:** 5 to 6 gates at 11–13 h is a calendar floor of about 3
days; I would expect **7–12 days**. In tokens: about 60 agents at ≤ 500k and about 40 reviews at about 300k, so order of
**30–40 M tokens**. That is an extrapolation with wide error; I measured no dollars. The open-ended part is the IR-parity
tail. It is the one place where a port meets behaviour we re-derive rather than copy.

## 9. Risks, and what would change the plan

- **IR-model drift (the main risk).** The model imitates LLVM behaviour without a line-by-line source in scope. Mitigation:
  normal form names the first differing function; `D5` says port the folder from source, not from observation; never guess.
  If `ir-run-pass` stalls under about 90% with the failures in the model, **lower IR to report-only and keep behaviour as the
  gate** (a recorded decision, not a slide).
- **Silent miscompiles.** Behaviour can pass with wrong IR, and wrong `noalias` or `nuw` shows only under `-O`, by luck. That
  is why IR is protected, and `ir-host` should not be dropped from reports.
- **The `opt` pipeline differs from rustc's.** Measured: 2,070 of about 5,200 lines on one program; behaviour 147/148. Tests
  on `-O` that observe optimization (stack use, `black_box`) may differ. If `run-pass-native` shows a cluster, map more of
  `LLVMRustOptimize`'s options.
- **O2 may not be one bug.** All 5 sampled ICE show the same message, but that message is only the validator's. There could
  be several passes behind it.
- **Host-only native checks.** Nothing here executes x86_64 code. A bug in the x86_64 ABI lowering shows only in IR. If a
  Linux VM becomes available, add `run-pass-native-linux` as a report.
- **Memory.** `regex_syntax` 3.9 GB in the front end; codegen holds a model per CGU, on top. Gates run many cases, but 34
  crates at -j4 is fine on 24 GB. check-core is already at 12.3 GB; `std-self` must stay serial.
- **Disk.** 16-19 GB free (25 GB when this plan was measured). Gzipped cache; `$T/rg` target directories are removed after use. Watch `aux`-style growth:
  `run-pass-aux-native` keeps rlibs by hash.
- **Unit step.** 21 of 30 minutes. The ≤ 15 s rule is a real constraint for about 37 lanes; `opt`-based tests in unit tests
  are cheap (10 ms) but per-case port runs are not.
- **Upstream changes nothing.** The pin holds, so LLVM's dialect cannot move underneath us. Do not update `llvm-tools`.

What would change the plan:
- `ir-hello` cannot match without emulating far more of LLVM than §2c lists: revisit D4 only then, and first try reading the
  upstream `IRBuilder`.
- `llvm-tools` turns out to be unavailable for a future host: then a matching clang build is required; there is no substitute
  dialect.
- The bundle cuts gates by half or more: the budget above relaxes and `ir-host` can be protected.
- Codegen estimates are off by 10× on ripgrep: it stays a heavy suite and a report, and the milestone is judged on
  `run-pass-native` only, with a recorded decision.

## 10. What I could not check

- **No port IR exists.** Every parity statement is about the oracle's own text and about mutations of it. TS codegen cost is
  an estimate from oracle timings.
- **x86_64-linux execution:** Docker's daemon is not running and no VM or glibc sysroot was found. Nothing built for it ran.
- **Apple clang's LLVM base:** not stated by `clang --version`; I only know it fails to parse.
- **LLVM's own source:** not in the checkout; I did not fetch it. §2c's list of behaviours to imitate is from the FFI's uses
  and from memory.
- **Why `default<O3>` differs** from `LLVMRustOptimize`: not fully classified.
- **Which byte differs** in `llc`'s objects against rustc's, despite identical disassembly.
- **The bundle:** the 29.1 → 16.0 Ginstr figure is another lane's; my trials failed at the top-level `await` (§4).
- **Samples, not full runs:** native 240 of 3,478, control 150, O2 120, normal form 150. `run-fail` was not sampled natively.
  tests/codegen-llvm: 484 of 848 files ran; revisions, `needs-*`, aux and other targets were skipped by my simple directive
  filter.
- **O2's root cause.** (O6's turned out to be the comparison's: `docs/reviews/real-crates.md`.)
- **`rg`'s mono run** stubbed the vtable provider with an empty allocation, which can under-collect items reached only
  through a const vtable. Its direct-call ABI walk failed in my script.
- **`ar_archive_writer`:** read from a tarball; it is not in `Cargo.lock`-vendored form here, so `crate-src.ts` needs one
  online run.
- **ThinLTO via `rust-lld`:** not tried.
- **Proc-macro dylibs built by anything but the oracle:** not tried; no codegen exists.

Critical files: compiler/rustc_codegen_llvm/src/{builder.rs, context.rs, common.rs, consts.rs, abi.rs, attributes.rs,
intrinsic.rs, back/write.rs, llvm/ffi.rs}, compiler/rustc_codegen_ssa/src/{base.rs,
mir/{mod,block,operand,rvalue,debuginfo}.rs, back/{link,linker,write,archive}.rs, traits/*},
compiler/rustc_llvm/llvm-wrapper/{PassWrapper,RustWrapper}.cpp, compiler/rustc_mir_transform/src/inline.rs,
compiler/rustc_middle/src/ty/vtable.rs, compiler/rustc_target/src/callconv/aarch64.rs, harness/suites.ts,
harness/compiletest.ts, scripts/rmeta-run.ts.
