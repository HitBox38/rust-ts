# Review: lane `cg-lto-diag` (wave 40p)

Reviewer, read-only on code. Branch `t3/port-cg-lto-diagnostics`, commits `15e35af8` (port, tests), `1b55ee87` and `11aaf180`
(handoff), against `main` at `7b71d658` (`git diff 7b71d658..11aaf180`). Upstream at the pin (`6f5da406b56c`):
`compiler/rustc_codegen_llvm/src/back/lto.rs` (856 lines), `src/diagnostics.rs`, `src/llvm/diagnostic.rs`,
`compiler/rustc_error_messages/src/diagnostic_impls.rs:142-152`, `compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:1290-1510`.

## Verdict: **PASS WITH NOTES**

No must-fix findings. Every function of the three files was read against upstream, in order. The ThinLocal no-op skips only
what D8 allows: `LLVMRustCreateThinLTOData` and the four `LLVMRustPrepareThinLTO*` calls. Reading PassWrapper.cpp at the pin,
I agree that the skip changes cross-CGU inlining and symbol linkage, not run-time behaviour, and that it cannot cause a link
failure. A stronger argument than the lane's is given in §3. Fat LTO invents nothing. I regenerated the `WithLlvmError` oracle
case myself, and it matches byte for byte. The notes are about comment precision, test coverage, and one tiny
`-C incremental`-only fidelity gap.

## Commands (AC power, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, `RUSTC_ICE=0`, after `git merge 11aaf180`)
| command | result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check --offline` | `markers ok (26784, 46 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 745; llvm 434)` |
| `bun scripts/coverage.ts --missing …/back/lto.rs` | 19/19 ported |
| `bun scripts/coverage.ts --missing …/diagnostics.rs` | 2/2 ported |
| `bun scripts/coverage.ts --missing …/llvm/diagnostic.rs` | 5/5 ported |
| `bun test ./src/rustc_codegen_llvm/ ./src/rustc_codegen_ssa/ ./src/rustc_error_messages/ ./src/std/result.test.ts` | 276 pass, 0 fail (35 files) |
| `bun test ./scripts/lib/unit-steps.test.ts` | 10 pass, 0 fail |

276 + 10 = 286, the handoff's count. No samples were run, as the brief asked.

## 1. Order and coverage
- Markers spot-checked against the pin. Each points at its `fn` line:
  - lto.rs: :39, :127, :154, :184, :205, :368, :533, :583, :651, :661, :674, :686, :695, :700, :796, :807, :822, :840, :846;
  - llvm/diagnostic.rs: :34, :84, :132, :149, :175;
  - diagnostics.rs: :24, :141.
- Order follows upstream. The non-upstream std helpers (`cstring_new_unwrap`, `cmp_cstr`, `debug_CStr`, `starts_with`,
  `path_join`, the profiler helpers, lazy `llvm_backend()`) sit after the last upstream fn, labelled as such.
  `ThinLTOKeysMap::default_` and `sorted_entries` stand in for `#[derive(Default)]` and `BTreeMap` order.

## 2. Logic fidelity (every function)
- **`prepare_lto`**: the symbol list order matches, including the profiler/msan conditions and the three fixed pushes.
  The rlib loop matches `filter_map`/`filter`, `expect` texts and `emit_fatal(LtoBitcodeFromRlib)`. `rmeta_link::read`
  returns `Option` upstream (rmeta_link.rs:51), so `unwrap` is right.
- **`get_bitcode_slice_from_object_data`**:
  - both magic sniffs are present;
  - `trim_start_matches` strips the prefix repeatedly, as the loop does;
  - `err.to_string()` is `display_Error`;
  - `section_by_name` is replaced by the provided `section_by_name_bytes`, with a PORT comment.
- **`run_fat` / `run_thin`**:
  - `run_thin`'s `unreachable!` text is right (the `\`-newline continuation eats the indentation);
  - `as_ptr()` collections are copies.
- **`fat_lto`**:
  - the costliest module is `Iterator::max` over `(cost, i)`, with ties going to the later index, which the loop reproduces;
  - `remove(i)` / `remove(0)` match, and so does `DiagnosticHandlers::new(.., LTO)`;
  - the sort is stable and in byte order;
  - the per-iteration drop of `Local` buffers is correct;
  - `llvm_err(LoadBitcode { name })` is correct;
  - the two `save_temp_bitcode` names match;
  - `_handler` drops at the end of the block, on the normal path only.
- **`thin_lto`**:
  - the first loop, the upstream loop, `assert_eq!` text, the key-map logic, `info!` texts and `{:?}`/`{:#?}` forms all match;
  - the opt/copy job loop compares `Option`s (`undefined === undefined` is `None == None`);
  - the save step matches.
  - `Green` stops at a named `unported`. Upstream builds the map before the loop, but no output happens in between, so the
    point is equivalent.
- **`enable_autodiff_settings`**: the arms are in upstream order and stop at `EnzymeWrapper::get_instance` (D18).
- **`run_pass_manager`**:
  - the stage/opt-stage selection matches;
  - `autodiff_post_passes.as_deref() != Some("")` is `!== ""` (`undefined` gives true, as `None` does);
  - `LLVMDumpModule` is a D18 stop.
- **`Buffer`, `ThinData`, `ModuleBuffer`**: these match. The `#[repr(transparent)]` handle is a recorded PORT.
- **`optimize_and_codegen_thin_module`**: see §3. Apart from the skips, it matches line for line: `parse`, `new_regular`,
  `embed_bitcode` re-adding the buffer, every timer label, every save-temps name, `run_pass_manager(thin = true)` and `codegen`.
- **`ThinLTOKeysMap`**: `save_to_file`, `load_from_file` (see N6) and `from_thin_lto_modules` (`iter::zip`, `expect` text). The
  derived Debug matches.
- **`module_name_to_str`, `parse_module`**: these match.
- **llvm/diagnostic.rs**:
  - `OptimizationDiagnostic::unpack`: the nested `build_string`s, `.ok()` and the `<unknown file>` default match, and the
    struct fields are evaluated in order (`pass_name.expect` before `function.unwrap` before `message.expect`), with the same
    texts;
  - `SrcMgrDiagnostic::unpack`: `ranges`/`num_ranges` and both `expect` texts match, and the `InnerSpan` list starts at `loc`;
  - `unpackInlineAsm` and `unpackSrcMgr` match;
  - `Diagnostic::unpack`: the arm order and kind mapping match, including `OptimizationRemarkMissed → OptimizationMissed`,
    `SrcMgr → InlineAsm` and the `_ → UnknownDiagnostic` fallback.

## 3. The ThinLocal no-op (PassWrapper.cpp:1313-1500 at the pin)
**Where it applies.** `cgcx.lto === "ThinLocal"` gates the no-op at two places:
- `thin_lto` (lto.ts:459): no `LLVMRustCreateThinLTOData`;
- `optimize_and_codegen_thin_module` (lto.ts:796): the four `LLVMRustPrepareThinLTO*` calls.

Each place has a `// PORT (plan-m7 D8, …)` comment. So do the two follow-on sites: `ThinData::drop` (:718) and
`from_thin_lto_modules` (:915), which stops under `-C incremental`. Nothing else is skipped. Timers, save-temps files, the parse,
the thin post-link pipeline and `codegen` all run. `each_linked_rlib_for_lto` really is empty for ThinLocal (ssa base.rs:1176
gathers rlibs only for `Fat`/`Thin`), so the index would hold only this crate's CGUs, as the lane says.

**The lane's claims, checked against the pin:**
- **Internalize.** `ExportedGUIDs` (:1394-1404) holds every *live* non-local GUID. `getOriginalName()` equals the GUID for
  non-local values. So `thinLTOInternalizeAndPromoteInIndex` internalizes only dead symbols, as the lane says. Skipping it
  keeps dead symbols external: more code, the same behaviour.
- **Rename.** It promotes only locals in `ExportLists`, which come from `ComputeCrossModuleImport`; `ExportedGUIDs` skips
  locals. With import skipped too, nothing needs promoting. Its `dso_local` changes choose between direct and GOT access, as
  the code comment says (but see N2).
- **Resolve-weak.** This is right as far as it goes, but it understates the step (N1). Nothing in the port's attribute path
  is lost: rustc's thin link never runs `thinLTOPropagateFunctionAttrs` (no call in llvm-wrapper). So `PropagateAttrs = true`
  re-applies flags read from the same module's own attributes, which is a no-op.
- **Import** is the D8 difference: less cross-CGU inlining.

**Why no link failure: a stronger argument.** At `-O` with several CGUs and `-Clto=off`, `sess.lto()` is `Lto::No`: neither
the thin link nor any of the four steps runs, and that configuration is supported upstream. So rustc's partitioning never
relies on rename, resolve-weak or internalize to make a multi-CGU crate link. The ThinLocal no-op is that configuration with
different pass pipelines (`thinlto-pre-link<Ox>` / `thinlto<Ox>`), and LLVM passes add no new cross-module references.

The only direction of change is *keeping more*:
- dead symbols stay external;
- duplicate linkonce copies are coalesced by the linker (weak definitions on Mach-O, COMDAT on ELF).

Neither can cause an undefined symbol. A duplicate strong symbol would need two CGUs to define the same external symbol,
which `-Clto=off` would hit too. `#[no_mangle]`/exported symbols are preserved roots, so they are live, and upstream does not
internalize them either. A run-pass case could see a difference only by inspecting its own symbol table, and D8 does not
claim byte parity at `-O` anyway.

**Equivalence.** I agree that D8's "same behaviour with less cross-CGU inlining" holds.

## 4. Fat LTO
`LLVMRustModuleCost`, `LLVMRustLinkerNew/Add/Free` and `LLVMRustRunRestrictionPass` are called exactly where upstream calls
them. They remain `stub(..)` in `src/rust_ts/llvm/ffi.ts` (:1287, :1374, …), so they are IR-model stops. Nothing is invented.
`git diff 7b71d658..11aaf180 -- scripts harness tools` is empty. `llvm-link` is not in `LLVM_TOOLS`
(scripts/lib/llvm-tools.ts:12), so the lane did not pin it and correctly left it to root.

## 5. Diagnostics
- **Oracle regenerated** in my scratchpad with the lane's recipe: `--print target-spec-json`, then `llvm-target` set to
  `nonexistent-unknown-none`, then `--crate-type lib --emit=obj` on a `no_core` lib. The run gave exit 1 and stderr
  `error: could not create LLVM MCSubtargetInfo for triple: nonexistent-unknown-none11.0.0: No available targets are compatible with triple "nonexistent-unknown-none11.0.0"\n\n`.
  `od -c` confirms the two trailing newlines. That is byte for byte the test's `ORACLE` (diagnostics.test.ts:55).
- **`WithLlvmError`** (diagnostics.rs:141-171): all ten arms are in upstream order, and every format string matches, including
  the escaped quotes in `LoadBitcode`. The `with_primary_message`, then `with_arg("llvm_err", self.1)` order matches.
- **`ParseTargetMachineConfig`** (:24-37):
  - `messages.first().expect("`LlvmError` with no message")`, then `format_diag_message` with the inner args, then `cancel()`,
    then `Diag::new` with the same `msg!` text and `with_arg("error", message)`;
  - the cancel test shows one emitted diagnostic.
- **`IntoDiagArg for CString` / `SmallCStr`** (diagnostic_impls.rs:143, :149):
  - both are one-liners returning `{ $: "Str", _0: to_string_lossy(self) }`;
  - std/env.ts's `to_string_lossy` is `TextDecoder("utf-8", { ignoreBOM: true })`: WHATWG replacement is one U+FFFD per
    maximal subpart, as `String::from_utf8_lossy` does, and the BOM is kept;
  - the markers were already right, and nothing else in that crate changed.

## 6. `back/write.ts`
The diff (+10/−40) only does this:
- it replaces the imports of `type ParseTargetMachineConfig` / `type WithLlvmError` with `../diagnostics.ts`'s two
  `_diagnostic` functions and `../llvm/diagnostic.ts`'s `Diagnostic`;
- it changes `Diagnostic_unpack(info)` to `Diagnostic.unpack(info)`;
- it removes cg-write's four stand-ins and their local types;
- it routes `Buffer` / `Buffer_data` through the existing lazy `lto_mod()` (write.ts:1492).

Nothing else changed. `InnerSpan` is still used (write.ts:459).

## 7. Tests
- **`back/lto.test.ts`** is meaningful for `thin_lto`. It runs ssa-write's real `start_async_codegen` / coordinator with
  `-Copt-level=2 -Ccodegen-units=2` (`sess.lto() === "ThinLocal"` is asserted), and the mock's `run_thin_lto` is the real
  `lto::run_thin`. So `prepare_lto` and `thin_lto` run on the coordinator's real `ThinLtoInput`s. The test checks:
  - the thread names;
  - no index;
  - one shared `ThinShared`;
  - indices, names and buffers.

  The `-Clto=thin` test reaches the named stop. It does **not** exercise the skip inside `optimize_and_codegen_thin_module`
  (N4).
- **`diagnostics.test.ts`** goes through the real `AnnotateSnippetEmitter` at `emit_fatal`. It has one oracle case and the
  format strings for the rest.
- **Skeleton counts** match the source. lto.ts has:
  - 2 `excluded (plan-m7 D18)` stops (`EnzymeWrapper::get_instance`, `LLVMDumpModule`): 17 → 19;
  - 4 `rustc_codegen_llvm::` stops (2× `Green`, `-Clto=thin`, `from_thin_lto_modules`): 8 → 12.

  The `cg-lto-diag` entry is gone with write.ts's four stand-ins, and the test passes.

## 8. Scope
The diff touches only these 9 files:
- the lane's six (lto.ts/.test.ts, diagnostics.ts/.test.ts, llvm/diagnostic.ts, the handoff);
- write.ts (§6);
- diagnostic_impls.ts (its two functions and one import);
- skeleton.test.ts (counts).

## Findings
No F findings.

- **N1. The resolve-weak description understates the step.** Code: lto.ts:786-789; also handoff :51. Upstream: PassWrapper.cpp
  :1361-1387 and `thinLTOResolvePrevailingGUID` / `thinLTOFinalizeInModule`.
  - `PrevailingCopy` is filled only for GUIDs with more than one summary, and `isPrevailing` returns true otherwise. So
    *every* prevailing linkonce definition becomes weak, single copies included. A `linkonce_odr` with `canAutoHide` also
    gets hidden visibility.
  - Skipping it lets the post-link GlobalDCE drop an unreferenced `linkonce_odr`, where upstream keeps a hidden `weak_odr`.
    That is not observable at run time.
  - Suggest that the PORT comment say this, and that it carry the `-Clto=off` argument from §3. That argument is the real
    reason no link can fail.
- **N2. The handoff's "No-op on Mach-O" for rename is too broad.** Handoff :50; upstream PassWrapper.cpp:1428-1445.
  - Only the *clearing* of `dso_local` (`clearDSOLocalOnDeclarations`) is ELF-only. Setting `dso_local` where every summary
    is dso_local happens on every object format.
  - The code comment (lto.ts:783-785) is accurate. Only the handoff wording should change.
- **N3. Stale test comment.** diagnostics.test.ts:58-59; upstream diagnostic_impls.rs:142-152.
  - It says the `IntoDiagArg for SmallCStr / CString` impls are what "fixers-56 ports", but this lane ported them under
    root's exception.
  - It also cites `:142`, the `impl` line, where the `fn` is at `:143`.
- **N4. The `optimize_and_codegen_thin_module` skip is untested.** lto.ts:796-829; upstream lto.rs:736-772.
  - The mock replaces `optimize_and_codegen_thin` (lto.test.ts:130), and the real function stops first at
    `LLVMRustParseBitcodeForLTO`. So nothing shows that none of the four `LLVMRustPrepareThinLTO*` stubs is reached under
    ThinLocal.
  - When llir-tools lands parse/serialize, add a test: the real function under ThinLocal reaches `run_pass_manager(thin)` and
    calls no `LLVMRustPrepareThinLTO*`.
- **N5. Two different `Buffer`s in one file.** lto.ts:684, :967; upstream lto.rs:645.
  - `export type Buffer = llvm.Buffer` shadows Node's global `Buffer` in type space only.
  - `cmp_cstr` uses the value `Buffer.compare`, which is Node's.
  - This is correct, but it reads as if it used the alias. Consider `globalThis.Buffer.compare` or a comment.
- **N6. `load_from_file` checks UTF-8 for the whole file before it reads any line.** lto.ts:895-896; upstream lto.rs:811-816.
  - `BufRead::lines` errors per line, in order. Take a malformed line (no space, or three fields) followed by a non-UTF-8
    line: upstream panics on the first, while the port returns `Err` and so recompiles.
  - It is reachable only with `-C incremental` (D11), which stops right after at `from_thin_lto_modules`. Fix it whenever
    D11 opens.
- **N7. A note for the llir lane (carry it into its brief).** llvm/diagnostic.ts:116; upstream llvm/diagnostic.rs:101.
  - `ranges` passes as a plain 8-element array, cast to `MutRef<number>`.
  - An implementation of `LLVMRustUnpackSMDiagnostic` must write `ranges[0 .. 2*num_ranges]`, not `.value`. The handoff
    says so (PORT 9), but it is easy to miss.
