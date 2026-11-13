# Handoff: llir-tools (M7, wave 40p): `LLVMRustOptimize` and `LLVMRustWriteOutputFile` over the pinned `opt`/`llc`

Branch `t3/implement-llir-tools` (from `7b71d658`; no merges). Commits at the end.

## Summary

- **`src/rust_ts/llvm/tools.ts`**, a new IR-model module listed in `impl_modules.ts` after `intrinsics.ts`; `ffi.ts` is regenerated
  (`bun tools/llir/ffi_gen.ts`). It implements 9 FFI functions: `LLVMRustOptimize`, `LLVMRustWriteOutputFile`,
  `LLVMRustModuleSerialize` (thin), `LLVMRustBufferPtr`/`Len`/`Free`, `LLVMRustParseBitcodeForLTO`, `LLVMCloneModule`,
  `LLVMWriteBitcodeToFile`.
- **`LLVMRustOptimize`** builds PassWrapper.cpp:676's pipeline as an `opt` command line (`opt_plan`):
  - the stage's pipeline: `default<O0>` (`buildO0DefaultPipeline`), `default<Ox>`, `thinlto-pre-link<Ox>`, `thinlto<Ox>`, `lto<Ox>`;
  - the PipelineTuningOptions as flags: `-disable-loop-unrolling`, `-interleave-loops`, `-vectorize-loops`, `-vectorize-slp`,
    `-enable-merge-functions`;
  - the PipelineStart callbacks (`-Zverify-llvm-ir`, `-Zlint-llvm-ir`) at opt's `-passes-ep-pipeline-start`;
  - `-Cpasses`, parsed alone as rustc parses it, then spliced in;
  - the ThinLTO-buffer passes (`canonicalize-aliases,name-anon-globals,assign-guid`);
  - TargetLibraryInfo (`-disable-simplify-libcalls`), the target machine's relocation model, code model and level, and
    configure_llvm's `cl::opt`s.
  - It runs `opt -S` on the module's text and keeps the result as the module's text.
- **`LLVMRustWriteOutputFile`** maps all 23 `LLVMRustCreateTargetMachine` arguments to `llc` flags (`llc_target_flags`), or stops
  where llc has none or no faithful form (global target features, review F1), and runs `llc -filetype=asm|obj`.
- **Modules after a tool are held as text.** The model cannot read IR back, so the module keeps its handle and its contents are the
  tool's text (`set_module_text`). Every consumer reads `module_text`: `LLVMRustPrintModule` (core.ts, one changed line), llc,
  serialize, clone, bitcode. A model mutation after that point stops (`unported`) because the model's print no longer matches its
  snapshot. A model *read* after that point is not caught (see "For root").
- **Shared runner, owned by this lane** (agreed by message with cg-lto-diag, who uses it for fat LTO): `pinned_tool`,
  `run_pinned_tool`, `run_pinned_tool_or_ice`, `llvm_tmp_dir`, `module_text`, `set_module_text`, `LLVMRustBuffer`.
  - Tools are located as scripts/lib/oracle.ts finds the sysroot: `rustc +<UPSTREAM.json toolchain> --print sysroot`,
    `RUSTUP_AUTO_INSTALL=0`, once per process, then `lib/rustlib/<host_tuple()>/bin`.
  - `opt`, `llc` and `llvm-as` are SHA-256-checked against scripts/lib/llvm-tools.ts's `LLVM_TOOLS_PINNED`, imported read-only.
- **Failures are ICE-class (D16).** A non-zero exit panics (exit 101) with
  `llir: <tool> failed on $RUST_TS_DATA/tmp/llir/<pid>/<n>-<module>.ll (exit N): <first error line>`. The input is kept there; the
  path is printed with `$RUST_TS_DATA` unexpanded, and the tool's own absolute path is replaced by its name. Modules pass through
  stdin/stdout, so nothing is written for a run that succeeds, and no machine path reaches any output.

## Evidence

### Pipelines: 18/18 match the oracle's own (`tools.test.ts`)

rustc prints the pass manager `LLVMRustOptimize` built when given `-Zautodiff=PrintPasses` (`MPM.printPipeline`; PassWrapper.cpp:1037),
which needs no Enzyme. `tools_oracle/record.ts` recorded that pipeline for 18 command lines (`pipelines.json`, x86_64-linux). They cover:
- O0, O1, O2, O3, Os, Oz;
- `-Cno-vectorize-loops` and `-Cno-vectorize-slp`;
- `-Zverify-llvm-ir` and `-Zlint-llvm-ir`, at O0 and O2;
- `-Cpasses` with function passes first and with a module pass first;
- `-Cno-prepopulate-passes`, alone, with the verifier, and with `-Cpasses`.

The test prints opt's pipeline for `opt_plan`'s flags and passes (`-print-pipeline-passes`). **All 18 equal the oracle's string**, with one
PORT'd difference: at O2, and at O3 under `-Cno-vectorize-slp`, opt has an `slp-vectorizer` that does nothing there (below). The test
requires that extra pass to be present and nothing else to differ.

Two bugs this check found, both fixed:
- `-Cpasses=instcombine dce` became two function adaptors where rustc has one. rustc parses the text alone, and a text starting with a
  function pass is nested whole. `canonical_extra_passes` now has opt parse it alone too.
- My first test expected no pipeline for FatLTO under `-Cno-prepopulate-passes`. Upstream clears `NeedThinLTOBufferPasses` only where it
  builds a default pipeline, so the three buffer passes still run there.

### IR: the model's module through `LLVMRustOptimize`, against the oracle's `--emit=llvm-ir`, at N1

`tools.test.ts` checks `tools_oracle/opt.rs` at both levels. opt.rs is a loop for the vectorizer, two identical functions that
mergefunc folds into an alias, and an inlined callee. For each level:
1. the oracle's C API calls with `-Cno-prepopulate-passes` (`opt.O<n>.script`) are replayed into the model;
2. the result goes through `LLVMRustOptimize` with ModuleConfig's settings;
3. it must equal the N1 of the oracle's `--emit=llvm-ir` (`opt.O<n>.ll`).

**O0: N1 equal. O2: N1 equal**, including the vectorized loop and `twin_b` as an `unnamed_addr alias` of `twin_a`. The test also checks
that the module before the pipeline is *not* the oracle's after it.

**mir-o2 sample** (`bun src/rust_ts/llvm/tools_oracle/evidence.ts --opt 0|2 --sample 150`, salt `llir-tools`, deterministic). Every case
has `--target=x86_64-unknown-linux-gnu`, so the target machine is cg-write's recorded x86_64 one. Two comparisons per case:
- **model**: the case recorded and replayed into the model, then `LLVMRustOptimize`;
- **control**: the oracle's own pre-pass text (the recorded run's `-Cno-prepopulate-passes` output) through `LLVMRustOptimize`. It takes
  the model out of the picture.

The pipeline column compares the oracle's printed pipeline for the case with tools.ts's.

**N1 answer, the model: O0 128/142, O2 125/141**, out of the cases the model could run: the recorder timed out on 6 at O0 and 7 at O2, and one case per level stopped in the model. Of all
compared cases (149 per level; one `-Clto` case skipped), the control reaches N1 on 129/149 at O0 and 125/149 at O2.

| | O0 | O2 |
|---|---:|---:|
| Compared (1 of 150 skipped: `lto/fat-lto.rs`, `-Clto`) | 149 | 149 |
| **Pipeline the same as the oracle's printed one** | **149/149** | **149/149** |
| Control at N1 | 129 | 125 |
| Control at N2 only (N1 misses on local names) | 15 | 14 |
| Control misses N2 too | 5 | 10 |
| Model: recorder timed out (60 s, load 7-30) | 6 | 7 |
| Model: stopped (`llvm.x86.sse2.pause`: target intrinsics are not in the model, llir-core's) | 1 | 1 |
| **Model at N1** | **128/142** | **125/141** |
| Model at N2 only | 11 | 9 |
| Model misses N2 too | 3 | 7 |
| **Model's verdict equal to the control's on the same case** | **142/142** | **141/141** |

**The model adds no difference of its own.** In every case it ran, its result is the control's, so each miss comes from the text round trip:
- **N2 only** (all 29 control cases): local-name collision suffixes made during the passes, e.g. `%self.i10` against `%self.i11`. LLVM's
  per-function symbol table keeps a counter (`ValueSymbolTable::LastUnique`) that the collisions of IR construction advanced in rustc's
  process. A module read from text starts it at zero.
- **N2 misses** (15): the order of inlined allocas, of phi operands (`phi i64 [ 1, %26 ], [ 0, %27 ]` against `[ 0, %27 ], [ 1, %26 ]`) and
  of blocks after inlining. These follow **use-list order**: the inliner walks a callee's users, and a phi's incoming order follows the
  predecessor walk, which is a block's users. LLVM's text has no use lists unless written with `uselistorder` directives, and rustc's
  `--emit=llvm-ir` writes none. A module read from text has use lists in textual order, while rustc's in-memory module has them in
  creation order. I checked one O0 case (`iter-step-overflow-ndebug.rs`): opt's always-inliner inlined the three call sites in the opposite
  order to rustc's.
- **For llir-core (not done here):** the model could close this by printing `uselistorder` directives, which LLParser reads, if it
  recorded the order in which it creates uses (LLVM pushes each new use at the head of the list).

**How much N1 alone proves about the mapping:** with tools.ts deliberately at O1 against the oracle's O2 (`--as 1`, first 30 cases), N1 still
matched on 24 (against 28 at the right level). Most run-pass programs are too small for the level to change their IR. The pipeline check
caught all 30 (`pipeline differs: 30/30`). So the printed-pipeline comparison is the strong evidence for the flag mapping. N1 shows that
running the pipeline through the text gives the oracle's IR, except where use lists matter.

### Objects: byte-identical (`bun src/rust_ts/llvm/tools_oracle/objects.ts`)

For an empty lib and `tools_oracle/hello.rs`, on x86_64-unknown-linux-gnu and aarch64-apple-darwin, at -Copt-level=0 and 2:
- the oracle's IR after its pipeline (`--emit=obj,llvm-ir`, one CGU) went through `LLVMRustWriteOutputFile` with cg-write's recorded
  target machine for that target;
- the result was compared with the oracle's `.o` from the same compile.

| Program | Target | O0 | O2 |
|---|---|---|---|
| empty lib | x86_64-linux | 6 sections, 0 symbols: **bytes identical** | identical |
| empty lib | aarch64-apple-darwin | 1 section, 1 symbol: **identical** | identical |
| hello | x86_64-linux | 28 sections, 12 symbols, 103 disassembly lines: **identical** | 22 sections, 8 symbols, 66 lines: **identical** |
| hello | aarch64-apple-darwin | 5 sections, 19 symbols, 111 lines: **identical** | 5 sections, 15 symbols, 69 lines: **identical** |

So sections (name and size), symbols and disassembly all match, and so do the bytes, which D8 does not require. The check bites: with
`-function-sections=false` instead of the target machine's `true`, the hello x86_64 O0 object differs.

`tools.test.ts` also runs the whole chain (replay, optimize, clone, asm and object) on opt.rs. It checks an ELF object and a `.text._RNv...`
section in the assembly.

### Checks

- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check --offline`: `markers ok (26769, 57 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 745; llvm 435)`.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts`:
  **275 pass, 0 fail** (22 files).
- `tools.test.ts` alone: 34 tests, about 1.0 s wall. That is within the unit-step budget; each opt or llc run takes about 15-30 ms.
- Tests read no new environment variable (`RUST_TS_REQUIRE_PROBES` only), run no lldb, and commit no absolute paths: the fixtures
  were checked for `/Users/`.

## Coverage

`bun scripts/coverage.ts --crate llvm-wrapper`: 56/197 at the first handoff (46 at `7b71d658`); **72/197 after merging llir-init**.
This lane adds 9 wrapper functions:
- PassWrapper.cpp: `fromRust` (PassBuilderOptLevel, :190), `fromRust` (FileType, :457), `LLVMRustWriteOutputFile` (:469),
  `LLVMRustOptimize` (:676, on the wrapper only), `LLVMRustModuleSerialize` (:1523), `LLVMRustParseBitcodeForLTO` (:1561).
- Review N1 removed two markers: the `:347 LLVMRustCreateTargetMachine` marker on `llc_target_flags` (llir-init ports that wrapper),
  and the second `:676` marker, on `opt_plan`.
- RustWrapper.cpp: `LLVMRustBufferFree`/`Ptr`/`Len` (:1477-1483).
- LLVM: `LLVMWriteBitcodeToFile` (BitWriter.cpp:20).
- `LLVMCloneModule` has no `// llvm:` marker. Its file (`llvm/lib/Transforms/Utils/CloneModule.cpp`) is not in
  `harness/llvm-manifest.json`, and this lane writes nothing under `$RUST_TS_DATA/llvm-src`.

The other `fromRust`s (CodeModel, CodeGenOptLevel, RelocModel, FloatABI, CompressionKind) are llir-init's, with
`LLVMRustCreateTargetMachine`. tools.ts maps the same enums to flag spellings in tables (`RELOC`, `CODE_MODEL`, ...) without markers.

## `unported(...)` left (all by name)

`LLVMRustOptimize`:
- `llir: LLVMRustOptimize's ThinLTO buffer (ThinLTOBitcodeWriterPass inside the pass pipeline ...)`: **reached by an rlib built with
  link output** (`-Cembed-bitcode`, so `emit_obj == ObjectCode(Full)`), e.g. run-pass aux crates, and by `--emit=thin-link-bitcode`.
  The buffer is written in the middle of the pipeline (`buildThinLTOPreLinkDefaultPipeline`, then the writer, then
  `buildModuleOptimizationPipeline`), which no single opt run gives. `embed_bitcode` would then also mutate the module after the
  pipeline, which the text model stops on.
- self-profiler, PGO (`-Cprofile-generate/-use`, sample use, debug info for profiling), `-Zllvm-plugins`, `-Cinstrument-coverage`
  (D18), Enzyme (D18), every sanitizer including CFI (D18).
- loop or SLP vectorization requested below O2 (opt's `default<Ox>` alias cannot turn them on there; rustc never asks).

`LLVMRustWriteOutputFile` / `llc_target_flags`:
- `-Zdebuginfo-compression` (llc has no flag for `CompressDebugSections`);
- `OutputObjFile` on a Windows target (CodeView; D18);
- an output path that cannot be opened (`raw_fd_ostream`'s strerror text, as core.ts's `LLVMRustPrintModule`).

Others:
- `LLVMRustModuleSerialize` for fat LTO: `forceFullLTOSummary` adds a module flag to the module itself.
- `module_text`: the model changed after a tool rewrote the module.
- Global target features (review F1, F2): a target machine whose `Features` is not empty stops in `LLVMRustOptimize` and in
  `LLVMRustWriteOutputFile` (PORT 3).
- `llc_target_flags` for SystemZ: llc clears `VerifyArgABICompliance` (review N3).
- `assert_model_current`: a model read of a module a tool rewrote (review N5), for future readers.
- `LLVMRustModuleSerialize` of a module that already has an `EnableSplitLTOUnit` flag (`-Zsplit-lto-unit`, CFI; review recheck R1).

## `// PORT:` decisions (for root to record)

1. **Modules after a tool are text** (header of tools.ts). Mutations are caught; reads are not. The read-back functions answer from the
   model's pre-pipeline state. No consumer at the pin reads a module after `optimize` except: `embed_bitcode` (a mutation, so a stop),
   `create_msvc_imps` (Windows, D18), and the LTO paths (cg-lto-diag's follow-up, which uses `set_module_text`).
2. **SLP at O2.** opt's `default<O2>` alias forces `PTO.SLPVectorization` on (PassBuilder.cpp:2066). rustc's is off below O3 or under
   `-Cno-vectorize-slp`. `-vectorize-slp=false` makes the pass return at once (SLPVectorizer.cpp:27804), so the IR is unchanged and only
   the pipeline text has one extra pass. Interleaving and loop vectorization are forced off through `-interleave-loops=false` and
   `-vectorize-loops=false`, which reach the same `LoopVectorizePass` options; those printed the same in all 18 pipelines.
3. **Target CPU and features (corrected after review F1, F2; my first text was wrong).**
   - **CPU.** opt gets no `-mcpu`: it would write `target-cpu` onto every function lacking it, declarations included
     (CommandFlags.cpp:713), which rustc's text does not have. rustc writes `target-cpu` on every definition, `__rust_try` included.
     llc does get `-mcpu`: it fills in only functions without the attribute, which is where rustc's machine CPU applies too.
   - **Features: a named stop when the machine has any**, by root's decision on F1. LLVM gives the machine's `Feature` (rustc's global
     list) only to a function without `target-features`, and neither tool can do that:
     - llc appends `-mattr` to every function's own list (CommandFlags.cpp:717-728). The global list then overrides
       `#[target_feature]`; the reviewer got a 128-bit `_mm256_add_epi32` and an llc `Cannot select` crash.
     - opt without `-mattr` gives `__rust_try` (`target-cpu` only, intrinsic.rs:1751) no features where rustc gives it the global
       list, which changes inlining (F2). With `-mattr`, opt would print the list on every function.
   - `tools.test.ts` compiles `catch_unwind.rs` with `-Ctarget-feature=+avx2` through the oracle. It checks that `__rust_try` has
     `target-cpu` and no `target-features` while `main` has the global list, and that both wrappers stop on a machine with that list.
   - The recorded x86_64-linux and aarch64-apple-darwin machines have no features, so this costs only `-Ctarget-feature` cases and
     targets whose spec has base features.
4. **Verification.** opt verifies its input and output (`VerifierKind::InputOutput`), which rustc does only under `-Zverify-llvm-ir`. That
   changes no IR and makes an invalid model module a D16 stop. llc gets `-disable-verify` unless `VerifyIR`, matching
   `addPassesToEmitFile(..., !VerifyIR)`.
5. **`; ModuleID = '<stdin>'`.** The tools read stdin; the first line of a tool's text is replaced by the model's own ModuleID line,
   since rustc's module keeps its identifier in memory. The line is a comment, so N1 never sees it either way.
6. **`UpgradeCallsToIntrinsic`** before the run is the parser's own upgrade in opt.
7. **`ObjectFilenameForDebug`.** llc sets it to its `-o` file, and only CodeView reads it. Windows stops.
8. **`LLVMRustModuleSerialize` (thin)** runs `assign-guid` on the module itself, as the wrapper does, then writes with
   `opt --thinlto-bc`.
   - **Use-list order (review F4; my first comment was wrong).** opt and llvm-as hard-code `ShouldPreserveUseListOrder = true`
     (optdriver.cpp:809, llvm-as.cpp:98), where rustc's writers default to false. The bitcode writer's own `-preserve-bc-uselistorder`
     overrides the tools' choice when given (BitcodeWriter.cpp:117, :221). Both now pass `-preserve-bc-uselistorder=false`, in
     `LLVMRustModuleSerialize` and `LLVMWriteBitcodeToFile`.
   - What is left: opt **always** adds an `EnableSplitLTOUnit` flag of 0 to the written module (`addModuleFlag`, optdriver.cpp:724,
     with no check for an existing one). A flag of 0 reads as absent.
   - A module that already has the flag, which rustc writes under `-Zsplit-lto-unit` or CFI, would get a second one, and opt would
     abort. It now stops by name before any opt run (review recheck R1).
   - On opt.rs at O2, `tools.test.ts` checks that the flag is **the only difference in the disassembly** from rustc's own
     `--emit=llvm-bc`. llvm-dis prints no use lists, so the bytes are not compared; a separate check shows that keeping use-list order
     gives other bytes.
9. **`LLVMRustParseBitcodeForLTO`**: a parse failure is the port's own bitcode, so it is ICE-class, not `Failure`.
   `enableDebugTypeODRUniquing` is not modeled; debuginfo is llir-di's.
10. **`with_cl_args`** is a seam for tests and the evidence tools, which call the wrappers without `configure_llvm`.
11. **`VerifyArgABICompliance`** (review N3): llc clears it (llc.cpp:703), and rustc leaves it on. Only SystemZ reads it, so SystemZ
    stops.
12. **Vector library** (review N3): opt's and llc's TargetLibraryInfo take `-vector-library` (optdriver.cpp:730, llc.cpp:715), and
    the wrapper's has none. The option cannot reach the tools, because llir-init's `LLVMRustSetLLVMOptions` stops on anything outside
    its allowlist.
13. **DWO file** (review N2): upstream's open check can never fire (`EC.clear()` before `if (EC)`). llc opens the file itself and
    fails as an ICE where upstream would write to a broken stream. Reached only with `-Csplit-debuginfo` (D18).
14. **Signals** (review F3): a tool killed by a signal is a failure like any other. It gets status 128 + the signal number, its stderr
    is kept, the panic says `(signal SIGABRT): LLVM ERROR: ...`, and the input is kept. Tested with llc on
    `llvm.x86.avx2.pshuf.b` under `-mattr=-avx2`.

## For root

- **llir-init is merged in** (`e9e7a89d`, merge commit `229fb3ae`; the conflicts and their resolution are in its message). tools.ts now
  imports target.ts's `TargetMachineArgs` and `llvm_cl_args` directly. `with_cl_args` stays for the tests.
- **`bun scripts/coverage.ts --check --offline` prints 84 `ERROR:` lines after the merge.** All are in llir-init's `target.ts` (39) and
  `triple.ts` (45), "names no file of harness/llvm-manifest.json". llir-init's handoff lists the manifest files to add
  (`bun scripts/llvm-src.ts add ...`); none of the errors is in this lane's files.
- **`src/rustc_codegen_llvm/back/write.test.ts`** (cg-write's file, not mine). The test "llvm_optimize stops at LLVMRustOptimize" relied
  on the stub, so it is now "llvm_optimize runs LLVMRustOptimize". It drives the real `write::llvm_optimize` with an empty model module, the
  recorded x86_64 target machine's fields, and `with_cl_args`. It asserts the module comes back as opt's text, and that a ThinLTO buffer
  cell stops by name.
- **For cg-lto-diag's follow-up** (that lane has finished, so this is the note):
  - The port's bitcode now carries no use-list order, as rustc's writers do; before review F4 it did. Fat LTO links these buffers, and
    use-list order steers the inliner.
  - `LLVMRustModuleCost` must count the `define`s of `module_text(M)`, not the model's functions: it picks fat LTO's base module, and
    after `optimize` the model is stale. Any function that reads a module from the model calls `assert_model_current(M, fn)` (N5).
- **cg-lto-diag** uses the runner. `LLVMRustLinkerNew/Add/Free`, `LLVMRustRunRestrictionPass` and `LLVMRustModuleCost` are its fat-LTO
  follow-up, to go to root. cg-lto-diag's `Buffer` is `llvm.Buffer`, which is now `LLVMRustBuffer`.
- **The recorder** timed out (60 s) on 6 of 150 mir-o2 programs at O0 and 7 at O2, all bigger programs (threads, `fmt`, collections).
  llir-init fixed its handle lookup (now merged here); a rerun of `evidence.ts` would measure more of the sample. I did not rerun it.
- **Startup cost (review N7, for the D14/perf work):** the first tool use in a compile spawns `rustc +<toolchain> --print sysroot` (about
  17 ms) and hashes `opt`/`llc` (about 0.5 MB together).
- **No `scripts/` change.** `llvm-link` and `llvm-dis` are not in `LLVM_TOOLS_PINNED`, so only their existence is checked. Pinning them is
  a scripts batch.

## Files

| File | What |
|---|---|
| `src/rust_ts/llvm/tools.ts` | new: the wrappers, the runner, modules as text |
| `src/rust_ts/llvm/tools.test.ts` | new: 34 tests |
| `src/rust_ts/llvm/tools_oracle/` | new: `record.ts` (hand-run recorder of the fixtures), `fixtures.ts` (ModuleConfig settings, configure_llvm options, target machines from `.tm`), `evidence.ts`, `objects.ts` (hand-run evidence tools), `hello.rs`, `opt.rs`, `catch_unwind.rs`, `pipelines.json`, `opt.O{0,2}.{ll,script}` |
| `src/rust_ts/llvm/core.ts` | `LLVMRustPrintModule` prints `module_text`; `LLVMRustSetLastError` exported |
| `src/rust_ts/llvm/handles.ts` | `Buffer` is `LLVMRustBuffer` |
| `src/rust_ts/llvm/impl_modules.ts` | `./tools.ts` appended |
| `src/rust_ts/llvm/ffi.ts` | regenerated |
| `src/rustc_codegen_llvm/back/write.test.ts` | the `llvm_optimize` test runs the real thing (above) |

## Commits

- `ce8718a3`: tools.ts, its tests and fixtures, core.ts/handles.ts/impl_modules.ts/ffi.ts, the first write.test.ts change.
- `4d429c49`: the evidence tools as run for this handoff (evidence.ts's control without the recorder, N2 tier, timeouts), and write.test.ts's
  `llvm_optimize` test on the real path.
- `5a878cfc`: the first handoff.
- `229fb3ae`: merge of llir-init `e9e7a89d`.
- `1ebd1c1a`, `d1eb362a`: the review fixes and their handoff update (below).
- The recheck fix commit (R1, N1, N2) and this handoff update.

## Review fixes (docs/reviews/llir-tools.md at `520666f4`: FAIL, four must-fixes)

| Finding | Fix |
|---|---|
| F1 `llc -mattr` overrides `#[target_feature]` | no `-mattr`; a machine with global features stops by name (`stop_on_global_features`), root's decision; PORT 3 corrected |
| F2 opt gives `__rust_try` no features | the same stop in `LLVMRustOptimize`; a test compiles `catch_unwind.rs` with `-Ctarget-feature=+avx2` and checks both the attributes and the two stops |
| F3 signal deaths skip D16 | `ToolRun` has `signal`, status 128 + signo, stderr kept; the panic gives `(signal SIGABRT): LLVM ERROR: ...` and the input is kept; tested with llc on `llvm.x86.avx2.pshuf.b` under `-mattr=-avx2` |
| F4 bitcode keeps use-list order | `-preserve-bc-uselistorder=false` (the writer's own override) for opt `--thinlto-bc` and llvm-as; comments and PORT 8 corrected; tested against rustc's `--emit=llvm-bc` |
| N1 markers, view | llir-init merged; `TargetMachineArgs`; `llc_target_flags` and `opt_plan` lose their markers |
| N2 DWO | follows upstream: no check of its own (PORT 13) |
| N3 VerifyArgABICompliance, vector library | PORT 11 (SystemZ stops) and PORT 12 |
| N4 error line | first line, plus the first error line when that is a later one (`Instruction does not dominate all uses! (then: opt: -: error: input module is broken!)`); tested |
| N5 stale reads | `assert_model_current(M, fn)` exported, header guard text, the note for `LLVMRustModuleCost` above; tested |
| N6 evidence host | `host_tuple()` |
| N7 startup | noted under "For root" |

After the fixes:
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check --offline`: 84 `ERROR:` lines, all llir-init's manifest files (above), none in this lane's files.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts`:
  **303 pass, 0 fail** (24 files).
- `tools.test.ts`: 39 tests, about 0.6-1.1 s.
- `objects.ts`: the 8 objects are still byte-identical; no machine involved has features.

## Recheck fixes (docs/reviews/llir-tools-recheck.md at `9e868027`: FAIL, one must-fix)

- **R1:** `LLVMRustModuleSerialize` stops by name, before any opt run, on a module that already has an `EnableSplitLTOUnit` flag:
  `llir: LLVMRustModuleSerialize of a module with an EnableSplitLTOUnit flag (-Zsplit-lto-unit or CFI): opt --thinlto-bc always adds
  another (optdriver.cpp:724); ...`.
  - The PORT says opt always adds the flag.
  - Test: opt fails on such a text, and the wrapper stops without touching the module.
  - The reviewer's case (opt.rs, `-Zsplit-lto-unit -Clinker-plugin-lto --emit=llvm-bc,llvm-ir`, the oracle's `.ll`) now stops by name
    instead of ICEing.
- **N1:** F4's PORT, test name and comment say "the only difference in the disassembly", and that llvm-dis prints no use lists.
- **N2:** `canonical_extra_passes` reads a failure as the parser's message only when the tool was not killed by a signal.
- N3 (tests on the real target machine): not done. The views still match `TargetMachineArgs` structurally.
- Checks:
  - `bunx tsc --noEmit -p .`: clean.
  - Test set: **304 pass, 0 fail** (24 files); `tools.test.ts` has 40.
  - Marker check: the same 84 llir-init manifest errors, none in this lane's files.
