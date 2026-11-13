# Review: lane `llir-tools` (wave 40p): **FAIL**

Independent reviewer, read-only on code. Reviewed branch `t3/implement-llir-tools`, commits `ce8718a3`, `4d429c49` and `5a878cfc`
(handoff), against `main` at `7b71d658` (`git diff 7b71d658..5a878cfc`). I merged `5a878cfc` into the review worktree. LLVM
sources were read at `aab11ee0ea5e` (rust-lang/llvm-project) for the files the handoff cites:
- PassBuilder.cpp, PassBuilderPipelines.cpp, PassRegistry.def;
- SLPVectorizer.cpp, LoopVectorize.cpp;
- CommandFlags.cpp, MCTargetOptionsCommandFlags.cpp;
- optdriver.cpp, NewPMDriver.cpp, llc.cpp, llvm-as.cpp, BitWriter.cpp.

Those files are in my scratchpad; nothing was written under `$RUST_TS_DATA/llvm-src/`.

The pipeline construction is faithful, and the evidence for it is real. The objects are byte-identical where the handoff says so.
Four things must change:
- **F1, F2:** the `-mcpu`/`-mattr` choice is justified in a PORT by a claim about LLVM that is false. With `-Ctarget-feature` it
  changes llc's code, makes llc crash on a valid program, and changes opt's inlining.
- **F3:** a tool that dies by a signal misses D16's path.
- **F4:** the bitcode writers keep use-list order, which rustc's do not, and the comment says the opposite.

The fixes are small: two named stops, a few lines in the runner, and corrected PORT text.

## Commands

All of these were run with `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0`, on AC power.

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check --offline` | `markers ok (26769, 57 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 745; llvm 435)` |
| `bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts` | **265 pass, 0 fail**, 21 files, no skips |
| `bun test ./scripts/lib/unit-steps.test.ts` | **10 pass, 0 fail** |
| `bun tools/llir/ffi_gen.ts` on the lane tree | `ffi.ts` comes out identical (no diff) |

The 265 + 10 = 275 tests match the handoff.

## Findings

### F1 (must fix). llc appends `-mattr` to every function's `target-features`. That changes code, and can crash llc on a valid program.

`src/rust_ts/llvm/tools.ts:581-583` (`llc_target_flags`), against LLVM `llvm/lib/CodeGen/CommandFlags.cpp:713-728`
(`codegen::setFunctionAttributes`, called at `llvm/tools/llc/llc.cpp:728`), and the wrapper's
`createTargetMachine(Trip, CPU, Feature, ...)` (PassWrapper.cpp:430).

The PORT says llc "writes `-mcpu`/`-mattr` onto functions that lack them". That is true for `target-cpu` (`!F.hasFnAttribute`). It
is false for features. When a function already has `target-features`, setFunctionAttributes *appends* `,<-mattr>` to them
(CommandFlags.cpp:718, "Append the command line features to any that are already on the function").

rustc writes `target-features` as `global_backend_features` followed by the function's own features (attributes.rs:440-451). Its
target machine's `Feature` is that same global list (write.rs:202). After the append, the global list comes again *after* the
function's own features and overrides them. Any `#[target_feature(enable = X)]` function compiled with a global `-X` loses `X`.

I reproduced both effects. The target machine's `Features` was set to the exact global list the oracle wrote, and everything else
came from cg-write's x86_64 `.tm`. The oracle IR went through `LLVMRustWriteOutputFile`:
- `#[target_feature(enable = "avx2")] _mm256_add_epi32` with `-Ctarget-feature=-avx2`, x86_64-linux, `-Copt-level=2`: the oracle's
  object has `vpaddd %ymm0`. The port's has two `vpaddd %xmm` and no `vzeroupper`. The bytes differ.
- `_mm256_shuffle_epi8`, under the same flags at `-Copt-level=0`: the oracle compiles it. The port's llc aborts with
  `LLVM ERROR: Cannot select: ... X86ISD::PSHUFB ... In function: ...__mm256_shuffle_epi8...`. Without the `-mattr` it compiles.

So a valid program ICEs, and another changes its code. D2 does not gate object bytes, but this is behaviour, and the PORT's
reason is wrong.

**Fix:** stop by name when `tm.Features` is non-empty, for example
`unported("llir: LLVMRustWriteOutputFile with target features (llc appends -mattr to every function's target-features)")`.
Alternatively, record a decision for a faithful mechanism. Then correct the PORT, and handoff PORT 3 ("it adds them the same way").
The IR suites (x86_64-linux) and the native suites (aarch64-apple-darwin) have empty `Features` in the recorded `.tm`s. The stop
costs only cases with `-Ctarget-feature`, or targets whose spec has base features.

### F2 (must fix). opt runs without the target machine's features. A definition without `target-features` gets a different subtarget.

`src/rust_ts/llvm/tools.ts:343-348` (opt_plan's PORT), against rustc's `gen_fn` (rustc_codegen_llvm `intrinsic.rs:1751`
`cx.apply_target_cpu_attr(llfn)`, which is context.rs:1052-1056: `target-cpu`/`tune-cpu` only), the subtarget lookup by
function attribute with the target machine's `TargetFS` as fallback, and optdriver.cpp:686-714.

The PORT argues that passes read a function's subtarget from its attributes, "which rustc writes on every definition
(`target-cpu` always)". That holds for `target-cpu`. It does not hold for `target-features`:
- `__rust_try`, an internal *definition* that every `catch_unwind` produces, gets `target-cpu` but no `target-features`.
- In rustc, its subtarget's features are the target machine's `Feature`, the global list.
- In opt (no `-mattr`) they are empty. TTI and the inliner's `areInlineCompatible` then see a different callee/caller feature
  set.

Reproduced with a `catch_unwind` closure plus `-Ctarget-feature=+avx2`, x86_64-linux, `-Copt-level=2`. I used the control path:
the oracle's `-Cno-prepopulate-passes` text through `LLVMRustOptimize`.
- **Unpatched:** N1 differs in inlining depth. Ours has `%bb6.i.i` where the oracle has `%bb6.i.i.i`: the closure was not inlined
  into `__rust_try` first.
- **Patched:** I added the global `"target-features"` to `__rust_try`'s attribute group in the same input, which is what rustc's
  target machine implies. The depth then matches, and only the known `LastUnique` suffix (`.05` vs `.07`) is left.
- **Without `-Ctarget-feature`:** only that suffix differs.

In this case the difference is local names (N2 equal). Where `__rust_try` is not itself inlined into its caller, the same
inline-compatibility difference changes structure.

**Fix:** with F1's stop on non-empty `Features` (a narrower trigger is a definition without `target-features`), and a corrected
PORT. Passing `-mattr` to opt is not a fix: opt would append the features to every function and print them.

### F3 (must fix). A tool killed by a signal skips D16's path: no first error line, no kept input.

`src/rust_ts/llvm/tools.ts:105` (`run_pinned_tool`), against plan-m7 D16 ("exit 101 with the first error line and the module path
kept for `ir-diff`").

`if (r.exitCode === null) panic("llir: ${name} did not exit (signal ...)")` fires before `run_pinned_tool_or_ice` can keep the input
or read stderr. A backend `LLVM ERROR` aborts the tool, and so does every "Cannot select" and every crash. Shown with F1's second
case: the port printed `Panic: llir: llc did not exit (signal SIGABRT)`, and llc's stderr (`LLVM ERROR: Cannot select: ...`) was
lost. Nothing was written under `$RUST_TS_DATA/tmp/llir/`. Those are exactly the failures `ir-diff` needs.

**Fix:** return the signal in `ToolRun` (for example `status = 128 + signo`, plus the signal's name), keep the stderr, and let
`run_pinned_tool_or_ice` treat any non-success the same way. Add a test, for example llc on an `llvm.x86.avx2.pshuf.b` call with
`-mattr=-avx2`.

### F4 (must fix: comments and PORT). The port's bitcode keeps use-list order; rustc's does not.

`src/rust_ts/llvm/tools.ts:745` (`LLVMWriteBitcodeToFile`) and `:708-711` (`LLVMRustModuleSerialize`), against:
- `llvm/tools/llvm-as/llvm-as.cpp:98`: `WriteBitcodeToFile(*M, Out->os(), /* ShouldPreserveUseListOrder */ true, ...)`,
  hard-coded;
- `llvm/tools/opt/optdriver.cpp:809`: `/* ShouldPreserveBitcodeUseListOrder */ true`, passed to `ThinLTOBitcodeWriterPass` at
  `NewPMDriver.cpp:544-546`;
- upstream's `WriteBitcodeToFile(*unwrap(M), OS)` (BitWriter.cpp:26) and `ThinLTOBitcodeWriterPass(OS, nullptr)`
  (PassWrapper.cpp:1546), both defaulting to `false`.

The comment at :745 says llvm-as writes "no use-list order", which is false. On a real module (the oracle's O2 IR of the
F2 program), `llvm-link -preserve-bc-uselistorder=true` and `=false` give 21156 and 21064 bytes: there are use-list records to
write.

What it affects:
- the bitcode of `--emit=llvm-bc` and `-Csave-temps`;
- more importantly, the use lists a later reader gets: textual order in the port, the reader's own order in rustc. The handoff's
  own N2 analysis shows use-list order steers the inliner. This matters for cg-lto-diag's fat LTO, which links these buffers.

Neither tool has a switch to turn it off. **Fix:** correct both comments, and add the difference to PORT 8 for root to record
(D2 does not gate bitcode). Also tell cg-lto-diag in the handoff.

### N1. Two `// rustc:` markers are placed on functions that are not ports of the named wrapper.

- `tools.ts:574`: `llc_target_flags` is marked `PassWrapper.cpp:347 LLVMRustCreateTargetMachine`. llir-init ports the real
  `LLVMRustCreateTargetMachine` with the same marker.
- `tools.ts:318` and `:460`: both `opt_plan` and `LLVMRustOptimize` carry `:676`.

`coverage --check` accepts both. After the llir-init merge, drop `llc_target_flags`' marker, or make it a plain comment.
Also replace the structural `ToolTargetMachine` view (`tools.ts:194`) with target.ts's exported `TargetMachineArgs`, which has the
same 23 names.

### N2. A DWO file that cannot be opened is a failure or a stop here; upstream ignores it.

`tools.ts:660-664`, against PassWrapper.cpp:514-516. Upstream runs `auto DOS = raw_fd_ostream(DwoPath, EC, ...)`, then
`EC.clear();`, then `if (EC)`, so the check can never fire. The port returns `Failure` for an empty DWO path and `unported` for
other open errors. It is reachable only with `-Csplit-debuginfo` (D18), so either follow upstream or note it as a PORT.

### N3. Two llc/opt differences have no PORT line.

- `llc.cpp:703` sets `Target->Options.VerifyArgABICompliance = 0`; rustc keeps the default. It is only a SystemZ check.
- opt's and llc's `TargetLibraryInfoImpl` take the target machine's `VecLib` (`-vector-library`; optdriver.cpp:730, llc.cpp:715).
  The wrapper's is `TargetLibraryInfoImpl(TargetTriple)`, with no vector library (PassWrapper.cpp, in `LLVMRustOptimize` and
  `LLVMRustWriteOutputFile`).

They differ only for SystemZ, or for `-Cllvm-args=-vector-library=...`. Add a PORT line for each, or stop on `-vector-library` in
`cl_args()`.

### N4. `firstErrorLine` can skip the useful line.

`tools.ts:148`. For an invalid module, opt prints the verifier's detail first (for example `Call parameter type does not match
function signature!`, which has no "error" in it), then `opt: <stdin>: error: input module is broken!`. The chosen line is the
generic one. Prefer the first non-empty line, or print both.

### N5. Stale model reads after `optimize`: none happens silently today; guard future readers.

These are rustc_codegen_llvm `back/write.rs` call sites after `LLVMRustOptimize` (`llvm_optimize`, write.rs:743), with what the
port does at each:

| Call site | What it reaches | Port |
|---|---|---|
| offload `llvm_rust_bundle_images`/`offload_wrap_images` (806, 840) | GPU/offload | D18, out |
| `create_msvc_imps` (967) | `LLVMGetFirstGlobal`... reads, then mutates | Windows, D18 |
| `ModuleBuffer::new` (984) | `LLVMRustModuleSerialize` | reads text |
| `embed_bitcode` (1006) | mutation | unreachable: the buffer stop fires first; caught anyway |
| `LLVMRustPrintModule` (1044) | | text |
| `LLVMCloneModule` (1065) | | text |
| `write_output_file` (1069, 1102) | | text |
| `record_llvm_cgu_instructions_stats` (1130/1345) | `LLVMRustModuleInstructionStats`, `-Zself-profile` only | ffi stub stops |
| `save_temp_bitcode` (291/308) | `LLVMWriteBitcodeToFile` | text |
| back/lto.rs:252 | `LLVMRustModuleCost` | ffi stub stops |

So no reachable path reads stale model state today; the risk is the next lane that implements one of those stubs. Suggestion: an
exported `assert_model_current(M, fn)` that stops when `is_tool_text(M)`, for model readers to call. Tell cg-lto-diag that
`LLVMRustModuleCost` must count the `define`s of `module_text`: it picks the base module of fat LTO, so the output depends on it.

### N6. evidence.ts hard-codes the host.

`src/rust_ts/llvm/tools_oracle/evidence.ts:37`: `llvmBinDir(sysroot, "aarch64-apple-darwin")`. Use the host tuple, as tools.ts
does. The tool is run by hand, so this is a nit.

### N7. Startup cost on every compile.

`tools.ts:60-66, 83-94`. Every compile process spawns rustup's `rustc +<toolchain> --print sysroot` and SHA-256-hashes the tools
on first use. That is fine for correctness; note it for the D14/perf work.

## The checklist

1. **`LLVMRustOptimize` against PassWrapper.cpp:676-1060.** The flags are mapped faithfully except where F1, F2 and N3 say
   otherwise.
   - **Opt level:** `fromRust` (190, Os/Oz → O2 at LLVM 23) is exact.
   - **Pipelines by stage:** O0 non-LTO is `default<O0>`, which is `buildPerModuleDefaultPipeline(O0)` and that is
     `buildO0DefaultPipeline` (PassBuilderPipelines.cpp:1769-1770). The other stages map as follows, each through PassRegistry.def
     275-309, which calls `setupOptionsForPipelineAlias` first:

     | Stage | Pipeline |
     |---|---|
     | PreLinkNoLTO | `default<Ox>` |
     | Pre-link Thin/Fat | `thinlto-pre-link<Ox>`, buffer passes cleared |
     | ThinLTO | `thinlto<Ox>` |
     | FatLTO | `lto<Ox>`, cleared |

     O0 with an LTO stage uses the LTO pipeline. Under `-Cno-prepopulate-passes`, the callbacks are added directly and
     `NeedThinLTOBufferPasses` stays true, as upstream does.
   - **Tuning options.** Interleaving and loop vectorization have only one reader, `LoopVectorizeOptions(...)`
     (PassBuilderPipelines.cpp:1352). `-interleave-loops`/`-vectorize-loops` OR into the same fields in the constructor
     (LoopVectorize.cpp:7418-7422). `PTO.LoopUnrolling` is `!DisableLoopUnrolling` (NewPMDriver.cpp:458).
     `PTO.MergeFunctions` is `EnableMergeFunctions` (PassBuilderPipelines.cpp:351).
   - **Verifier and lint:** `-passes-ep-pipeline-start` registers through `registerPipelineStartEPCallback`, like rustc's
     (NewPMDriver.cpp:306-310).
   - **`-Cpasses`** is parsed alone, then spliced. A parse failure is `Failure` with the parser's message.
   - **Trailing passes:** `canonicalize-aliases,name-anon-globals,assign-guid` are correct.
   - **Is the comparison real?** Yes. I ran the oracle with `-Zautodiff=PrintPasses` against `opt -print-pipeline-passes`
     myself. The recorded `o3-no-vectorize-slp` case matches once the extra SLP pass is removed. Three combinations that are not
     in the fixture also match: `3 -Zlint-llvm-ir -Cno-vectorize-loops -Cpasses="loop-unroll sroa"` matches exactly (SLP is on at
     O3); `1 -Zverify-llvm-ir` matches exactly; `z -Zverify-llvm-ir` matches once the extra SLP pass is removed.
   - **Is the extra `slp-vectorizer` a no-op?** Yes. `SLPVectorizerPass::run` only gets analyses, then calls `runImpl`, whose first
     statement is `if (!RunSLPVectorization) return false;` (SLPVectorizer.cpp:27805). The result is `PreservedAnalyses::all()`, and
     no SCEV or AA query is made first. The only follow-on pass, the `EarlyCSE` after SLP, sits behind `ExtraVectorizerPasses`, which
     defaults to off (PassBuilderPipelines.cpp:1451-1455).
   - **opt's other behaviour.** `updateVCallVisibilityInModule` returns early without whole-program visibility. opt's own
     `setFunctionAttributes` is a no-op with no `-mcpu`/`-mattr` and no other codegen flag; that is F2's premise.
2. **`LLVMRustWriteOutputFile`.** I checked all 23 fields against PassWrapper.cpp:347-438 and llc.cpp:536-765.
   - Each field maps to a flag or stops by name: CompressDebugSections has no llc or MC flag (I checked both CommandFlags files);
     ObjectFilenameForDebug on Windows stops.
   - `Features`: see F1.
   - **Objects regenerated independently.** I compiled a program of my own (HashMap, sort, `catch_unwind`) with the pinned rustc
     (`--emit=obj,llvm-ir`, one CGU), then ran its IR through the port's `LLVMRustWriteOutputFile`. The results are
     **byte-identical** for aarch64-apple-darwin at -O2 and for x86_64-unknown-linux-gnu at -O0.
3. **Text after `opt`.** See N5. Mutations are caught. No reachable path reads stale model state silently; the hazard is for future
   stubs.
4. **D16.** A non-zero exit is handled right. The test checks the panic text: `$RUST_TS_DATA` stays unexpanded, the input is kept,
   the first line comes from stderr, and the tool's path is replaced by its name. Signals are not handled (F3). A missing
   `RUST_TS_DATA` turns the failure into `unported` rather than an ICE (`llvm_tmp_dir`); this cannot happen under the harness.
   Machine paths: the first error line names `<stdin>`, and `-o` paths are not part of it. The output's own name
   (`ObjectFilenameForDebug`) is read only by CodeView, which stops.
5. **The thin functions.**
   - `LLVMRustModuleSerialize` (thin) runs `assign-guid` on the module, then writes with ThinLTOBitcodeWriterPass, as the wrapper
     does (1523-1555). The extra `EnableSplitLTOUnit` flag reads as absent, as PORT 8 says; the use-list difference is F4.
   - The fat path stops (`forceFullLTOSummary` mutates the module).
   - `LLVMRustBuffer*` match RustWrapper.cpp:1477-1485.
   - `LLVMRustParseBitcodeForLTO`: the identifier becomes the ModuleID, and a parse failure is ICE-class (PORT 9). That is
     reasonable, since the bytes are the port's own.
   - **Is the embedded-bitcode stop named and justified?** Yes. The buffer is written between `buildThinLTOPreLinkDefaultPipeline`
     and `buildModuleOptimizationPipeline` (PassWrapper.cpp:938-952), which no single opt run gives. `embed_bitcode` would then
     mutate the module.
   - Worth knowing: `-Cembed-bitcode` defaults to yes, so *every* rlib built with `--emit=link` and without
     `-Cembed-bitcode=no` stops there. That includes compiletest's aux crates. Cargo passes `=no` for non-LTO builds.
6. **Determinism.** Modules go through stdin and stdout. Files are written only on failure (`<pid>/<n>-<module>.ll`), and those
   names appear only in an ICE message. The environment is inherited, which matches the oracle's in-process LLVM: same environment,
   same cwd. GUIDs and anonymous names come from `source_filename`, never from the `<stdin>` identifier. The ModuleID comment line is
   replaced.
7. **Tests.**
   - opt.O2.ll has a `vector.body` with 11 vector-typed lines and `twin_b` as an `unnamed_addr alias`. N1 is reached at O0 and O2,
     and the test also checks that the input is not already the answer.
   - With rustc taken off `PATH` and `RUST_TS_REQUIRE_PROBES=1`, `tools.test.ts` gives **23 fail, 11 pass, 0 skip**. Without the
     variable, it prints `SKIP:` and skips 29. write.test's new test uses the same `skipIf(!haveTools && !REQUIRE)`.
   - unit-steps: 10 pass.
8. **Scope.**
   - write.test.ts only replaces the old "stops at LLVMRustOptimize" stub test, plus three imports.
   - core.ts: `LLVMRustSetLastError` is now `export`, and `LLVMRustPrintModule` prints `module_text`. That is one line, with a
     circular import that resolves at call time.
   - handles.ts: `Buffer = LLVMRustBuffer`.
   - impl_modules.ts appends `./tools.ts`.
   - No change to `scripts/`, `harness/`, `tools/`, package.json or tsconfig.
9. **llir-init merge.** llir-init's branch has moved since the handoff's trial: it is now at `e9e7a89d` ("Handoff llir-init: review
   fixes"), after `2b54c738`. I trial-merged `e9e7a89d` into `5a878cfc` in a scratch worktree, then removed it.
   - Conflicts: `core.ts` (doc comment only), `ffi.ts`, `handles.ts`, `impl_modules.ts`, `write.test.ts` (imports: keep both).
   - Resolution as the handoff says: handles.ts keeps target.ts's `DiagnosticHandler` and `Buffer = LLVMRustBuffer`;
     `IMPL_MODULES = [core, build, intrinsics, target, tools]`; ffi.ts is regenerated.
   - Then `tsc` is clean and the test set passes **288, 0 fail**. target.ts's `TargetMachine` has the 23 field names and
     `disposed`, and `llvm_cl_args()` exists.
10. **Commands:** see the table above.

## Verdict

**FAIL.** F1-F4 must be fixed: two named stops (or recorded decisions) for target features, the signal path in the runner, and
corrected PORT text for `-mattr` and use-list order. After that it is PASS WITH NOTES (N1-N7). The pipeline mapping, the object
path and the evidence are otherwise sound.
