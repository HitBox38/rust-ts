# Re-check: lane `llir-tools` review fixes (wave 40p): **FAIL**

Independent reviewer, read-only on code. Reviewed `git diff 5a878cfc..d1eb362a` on `t3/implement-llir-tools`:
- `229fb3ae`: merge of llir-init `e9e7a89d`;
- `1ebd1c1a`: the review fixes;
- `d1eb362a`: the handoff.

The first review is `docs/reviews/llir-tools.md` at `520666f4` (FAIL, F1-F4, N1-N7). I merged `d1eb362a` into this worktree. I read the
LLVM sources at `aab11ee0ea5e` (rust-lang/llvm-project, the manifest's repo and commit), fetched into my scratchpad:
- BitcodeWriter.cpp, CommandFlags.cpp;
- optdriver.cpp, NewPMDriver.cpp, llc.cpp, llvm-as.cpp.

Nothing was written under `$RUST_TS_DATA/llvm-src/`. All runs used AC power, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0` and
`RUSTC_ICE=0`.

F1, F2, F3 and N1-N6 are fixed as asked. F4's mechanism is right. The merge kept both sides.

One new must-fix (R1) came up while checking F4's comparison. The rewritten PORT says opt adds `EnableSplitLTOUnit` "when it has
none", which is false. opt adds the flag unconditionally. A module that already has the flag (rustc writes it under `-Zsplit-lto-unit`)
then breaks, and opt aborts: a valid program ICEs where it should hit a named stop. The fix is one condition and a corrected comment.

## Commands

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts` | **303 pass, 0 fail**, 24 files, no skips (matches the handoff) |
| `bun test ./src/rust_ts/llvm/tools.test.ts` | 39 pass, 0 fail |
| `bun scripts/coverage.ts --check --offline` | 84 `ERROR:` lines (details below) |
| `bun tools/llir/ffi_gen.ts` | `ffi.ts` (381 fns) and `ffi_types.ts` come out identical: `git status` stays clean |

The marker check's 84 `ERROR:` lines are all "names no file of harness/llvm-manifest.json":
- 39 in `target.ts` and 45 in `triple.ts`, both llir-init's files;
- they cover 17 distinct files, which are llir-init's 18 manifest additions minus `TripleName.def`, which carries no marker;
- there is no other kind of error, and none is in this lane's files.

## Findings

### R1 (must fix). opt adds `EnableSplitLTOUnit` unconditionally. A module that already has it ICEs, and the PORT says otherwise.

`src/rust_ts/llvm/tools.ts:719-722` (`LLVMRustModuleSerialize`, thin), against `llvm/tools/opt/optdriver.cpp:722-726`:

```
if (OutputThinLTOBC) {
  M->addModuleFlag(Module::Error, "EnableSplitLTOUnit", SplitLTOUnit);
```

There is no `getModuleFlag` check. The PORT says "opt also gives the written module an `EnableSplitLTOUnit` flag of 0 **when it has
none**", and that is false. Handoff PORT 8 does not say "when it has none", but it gives no limit either.

rustc writes `!{i32 4, !"EnableSplitLTOUnit", i32 1}` when `sess.is_split_lto_unit_enabled() || sess.is_sanitizer_cfi_enabled()`
(rustc_codegen_llvm context.rs:297-303; ported at `src/rustc_codegen_llvm/context.ts:513`). opt then adds a second flag of the same
name, and its output verifier rejects the module.

**Reproduced.** I compiled `tools_oracle/opt.rs` with the pinned rustc:
`--target x86_64-unknown-linux-gnu -Copt-level=2 -Ccodegen-units=1 -Zsplit-lto-unit -Clinker-plugin-lto --emit=llvm-bc,llvm-ir`.
- **The oracle** writes `opt.bc` (4160 bytes) and exits 0.
- **The port**, given the oracle's `.ll`, ends in `LLVMRustModuleSerialize(M, true)` with:
  `Panic: llir: opt failed on $RUST_TS_DATA/tmp/llir/<pid>/0-opt2.ll (signal SIGABRT): module flag identifiers must be unique (or of 'require' type) (then: LLVM ERROR: Broken module found, compilation aborted!)`.
  (The F3 and N4 fixes work as intended here.)

**Reachable in M7.** `-Zsplit-lto-unit` needs `-Clto`, `-Clto=thin` or `-Clinker-plugin-lto`. With `-Clinker-plugin-lto`, write.rs takes
this path:
- `emit_obj` is `EmitObj::Bitcode`, so `llvm_optimize` gets no ThinLTO buffer, and the buffer stop does not fire (write.rs:892-899).
- Then `ModuleBuffer::new(llmod, cgcx.lto != Lto::Fat)` (write.rs:984) calls `LLVMRustModuleSerialize` thin.

The same holds for `--emit=llvm-bc` without an object. Plan-m7 D18 does not exclude linker-plugin LTO. `-Zsanitizer=cfi` reaches the same
path, but D18 excludes it. The two codegen-llvm tests that use the flag (`split-lto-unit.rs`, `enable-lto-unit-splitting.rs`) use `-Clto`
and emit IR, so they stop elsewhere first. The suites are barely affected. The point is that a valid program ICEs (exit 101) where
it should hit a named stop (exit 70), and the PORT's claim about LLVM is wrong. That is the same kind of defect as F1 and F4.

**Fix:**
- Stop by name before the `--thinlto-bc` run when the module already has an `EnableSplitLTOUnit` flag. For example, `module_text(M)`
  holds `!"EnableSplitLTOUnit"`: `unported("llir: LLVMRustModuleSerialize of a module with an EnableSplitLTOUnit flag (opt
  --thinlto-bc adds a second one, optdriver.cpp:724)")`.
- Correct the PORT and handoff PORT 8: the flag is added unconditionally. Absent becomes "Error 0", which reads as absent; present
  becomes a stop.

### N1. F4's comparison shows equal disassembly, not equal bitcode. Say so in the PORT and handoff.

`src/rust_ts/llvm/tools.test.ts:348-365`, `tools.ts:720-721`, handoff PORT 8.

The mechanism is right:
- `-preserve-bc-uselistorder` is a real `cl::opt<bool>`, defined at BitcodeWriter.cpp:117 (`cl::Hidden, cl::init(true)`).
- `ModuleBitcodeWriterBase`'s constructor (BitcodeWriter.cpp:221-223) uses it in place of the caller's `ShouldPreserveUseListOrder`
  whenever it was given (`getNumOccurrences()`). Every module writer goes through that constructor, ThinLTO's included.
- So it overrides llvm-as's hard-coded `true` (llvm-as.cpp:98) and opt's (optdriver.cpp:809 → NewPMDriver.cpp:544-546).
- It takes effect. With the flag, opt's thin bitcode of opt.rs at O2 has the same size (4620) but different bytes. On the
  `-Cno-prepopulate-passes` module, llvm-as gives 4808 bytes with the default and 4784 with the flag; `LLVMWriteBitcodeToFile` gives
  4784.

The test proves that the bytes change and that the disassembly equals rustc's, flag aside. It cannot show that use-list or
constant order matches, because llvm-dis drops both. The bytes still differ from rustc's for other reasons:
- rustc's `-Csave-temps` `*.no-opt.bc`, disassembled and written back through `LLVMWriteBitcodeToFile`, gives the same disassembly
  but 4524 bytes against 4456.
- The cause is probably context-level tables that a text round trip cannot reproduce. I did not identify it; llvm-bcanalyzer is
  not in the pinned toolchain.

D2 does not gate bitcode, so this is only wording. The "only difference" in PORT 8 and the comment is "the only difference *in the
disassembly*".

### N2. A death by signal whose first line starts with `opt: ` would read as a pass-parse error.

`src/rust_ts/llvm/tools.ts:448` (`canonical_extra_passes`). Before F3, a signal panicked inside `run_pinned_tool`. Now it returns
status 128 + signo, and `r.status !== 0 && line.startsWith("opt: ")` turns it into `LLVMRustResult::Failure` with the line as the
message. opt's crash output starts with `LLVM ERROR:`, `PLEASE submit` or `Stack dump:`, so this is unlikely. Adding
`r.signal === undefined &&` keeps signals ICE-class there too.

### N3. The tests still use a structural target machine. The real one works.

`tools.test.ts:58, :295`, `write.test.ts` (`tmFromRecorded(...) as never`), `tools_oracle/objects.ts`. tools.ts now takes llir-init's
`TargetMachine` and reads `TargetMachineArgs` (N1 is done). The tests still pass a plain object cast to the type.

I ran the path with a real machine instead. For `hello.rs`, I built it with `initialize_available_targets()` and
`LLVMRustCreateTargetMachine(...tmArgs(<cg-write .tm line>))`, with the level set to match, then ran `LLVMRustWriteOutputFile`:
- aarch64-apple-darwin -O2: **byte-identical** to the oracle's `--emit=obj` (2416 bytes);
- x86_64-unknown-linux-gnu -O0: **byte-identical** (4800 bytes);
- the same with `Features = "+avx2"`: the named F1 stop.

Moving the tests to `tm_fixture.ts`'s real machine would test the integrated path. That is optional.

## The checklist

1. **F1/F2: fixed as root decided.**
   - `stop_on_global_features` (`tools.ts:231`) stops by name when `Features` is non-empty. It is called first in `LLVMRustOptimize`
     (`:500`) and in `llc_target_flags` (`:586`), which only `LLVMRustWriteOutputFile` calls (`:660`) apart from the tests.
   - There is a `// PORT:` with the corrected reasons (`:221-229`). The CPU PORTs are corrected too (`:343-348`, `:581-582`).
   - `-mattr` is gone: no flag push of it is left, only comments.
   - The test (`tools.test.ts:280-314`) compiles `catch_unwind.rs` through the oracle with `-Ctarget-feature=+avx2
     -Cno-prepopulate-passes`. It asserts that `__rust_try` has `"target-cpu"="x86-64"` and no `target-features`, and that `main`'s
     global list has `+avx2`. It also asserts both exact stop texts, and that the same module runs through a machine without features.
     It ran under `RUST_TS_REQUIRE_PROBES=1` and was not skipped.
   - The recorded `.tm` lines for both targets have `Features` `""`. Two regenerated objects are byte-identical (N3).
2. **F3: fixed.**
   - `run_pinned_tool` (`tools.ts:111-121`) returns `status` 128 + signo and `signal`, and keeps stderr with the tool's path replaced.
   - `run_pinned_tool_or_ice` keeps the input and panics with `(signal SIGABRT): <first line>`. A panic is an ICE, exit 101, as D16
     requires.
   - The test is real: llc on `llvm.x86.avx2.pshuf.b` with `-mattr=-avx2` gives `SIGABRT`/134 from the raw run. The panic text
     matches `LLVM ERROR:`, no sysroot path appears, and the kept file equals the input byte for byte. R1's repro hit the same path
     with a real failure.
3. **F4: the mechanism is right; see N1 on what the comparison shows.**
   - The option, its definition, the override and its effect are as claimed.
   - The test compiles opt.rs with the oracle (`--emit=llvm-bc,llvm-ir`) and compares through disassembly and N1. The only
     difference in the disassembly is the `EnableSplitLTOUnit` flag, and that flag has a PORT, but its text is wrong (R1).
4. **N1-N6.**
   - **N1:** `tools.ts` imports `TargetMachineArgs` and `llvm_cl_args` from target.ts. The `ToolTargetMachine` view and the
     `require` fallback are gone. `llc_target_flags` and `opt_plan` lose their markers, and `LLVMRustOptimize` keeps `:676`.
   - **N2:** the DWO check follows upstream, with a PORT (`:668-670`).
   - **N3:**
     - SystemZ stops on `s390x` (`:589`), and there is a PORT for the vector library (`:261-264`, `:658-659`).
     - The claim that `-vector-library` cannot reach the tools holds: llir-init's `ParseCommandLineOptions` stops on anything
       outside `ACCEPTED_LLVM_ARGS` (six exact strings).
   - **N4:** `firstErrorLine` (`:165`) gives the first line plus a later error line, with a test (`tools.test.ts:337`).
   - **N5:** `assert_model_current` (`:205`) is exported, the header tells implementers to call it, and there is a test
     (`tools.test.ts:367`). It has no caller yet, as intended.
   - **N6:** `evidence.ts` uses `host_tuple()`.
5. **Merge resolution: both sides kept.**
   - 33 files changed between the merge base `7b71d658` and `229fb3ae`. 28 were changed by only one side, and each equals that side
     exactly.
   - The five changed by both:
     - `core.ts`: tools' version. llir-init's only change, exporting `LLVMRustSetLastError`, is in it.
     - `handles.ts`: target.ts's `TargetMachine`, `MCSubtargetInfo` and `DiagnosticHandler`, and `Buffer = LLVMRustBuffer`.
     - `impl_modules.ts`: `[core, build, intrinsics, target, tools]`.
     - `write.test.ts`: llir-init's subtarget/target-machine assertions and llir-tools' `llvm_optimize` test, with both import sets.
     - `ffi.ts`: equals `ffi_gen.ts`'s output.
6. **Regressions.**
   - `1ebd1c1a`/`d1eb362a` touch only `tools.ts`, `tools.test.ts`, `tools_oracle/catch_unwind.rs`, `tools_oracle/evidence.ts` and the
     handoff.
   - `tools.test.ts` only gains tests. No assertion was removed or loosened.
   - Nothing changes under `scripts/`, `harness/`, `tools/`, `package.json` or `tsconfig.json`.
   - The one behavioural loosening is N2: signals no longer panic before a caller judges `status`.
7. **Commands:** see the table. The marker check fails only on llir-init's unmanifested files.

## Verdict

**FAIL**, on R1 alone: a named stop for a module that already has `EnableSplitLTOUnit`, and a corrected PORT 8. Everything the
first review asked for is fixed. Once R1 is fixed this is PASS WITH NOTES (N1-N3).
