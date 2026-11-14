# Handoff: cg-lto-diag (M7, wave 40p)

## Summary
- **Ported whole, in upstream order, with markers:**
  - `compiler/rustc_codegen_llvm/src/back/lto.rs` → `src/rustc_codegen_llvm/back/lto.ts`;
  - the two hand-written `Diagnostic` impls of `diagnostics.rs` → `src/rustc_codegen_llvm/diagnostics.ts` (new). It re-exports
    `diagnostics.gen.ts`, as rustc_codegen_ssa's `diagnostics.ts` does;
  - `llvm/diagnostic.rs` → `src/rustc_codegen_llvm/llvm/diagnostic.ts` (new).
- **D8 as recorded:**
  - `ThinLocal` is a no-op with `PORT:` comments at the two points where it is skipped (next section);
  - `-Clto=thin` stops at `unported`, where the combined index would be built;
  - fat LTO is ported as upstream: rlib bitcode in `prepare_lto`, then `LLVMRustLinker*` and `LLVMRustRunRestrictionPass`. In
    the IR model those become `llvm-link` + `opt`, over llir-tools' helper. They are IR-model stops until an IR-model lane
    writes them (see "For root").
- **write.ts (cg-write's file):** cg-write's local stand-ins for my 4 stubs are replaced. These are:
  - `WithLlvmError_diagnostic` and `ParseTargetMachineConfig_diagnostic`, now imported from `../diagnostics.ts`;
  - `Diagnostic_unpack` and its local variant types, now `Diagnostic.unpack` from `../llvm/diagnostic.ts`;
  - `Buffer` / `Buffer_data`, now lto.ts's, read through the existing lazy `lto_mod()`.

  Nothing else in write.ts changed.
- **Root's exception (by message, 2026-11-14):** two functions in `src/rustc_error_messages/diagnostic_impls.ts`:
  - `impl IntoDiagArg for CString` (diagnostic_impls.rs:143);
  - `impl IntoDiagArg for SmallCStr` (:149).

  Both were `unported`, and both are reached by `LlvmError::{CreateTargetMachine, CreateMCSubtargetInfo, LoadBitcode}`. The
  body is `String::from_utf8_lossy` of the bytes, through std/env.ts's existing `to_string_lossy`: the same decoder, with
  U+FFFD per maximal invalid subpart and a leading U+FEFF kept. No other part of that crate is pulled in. The existing markers
  were already right.

## The ThinLocal decision point
Upstream flow at `-O` with several CGUs (`sess.lto() == ThinLocal`):
1. ssa `compute_per_cgu_lto_type` returns `Thin`.
2. Each CGU is optimized with `PreLinkThinLTO`, then `serialize_module(.., is_thin = true)`.
3. `do_thin_lto` calls `run_thin_lto` = `lto::run_thin` → `thin_lto`.
4. Then, per module, `optimize_and_codegen_thin_module`: parse, rename / resolve-weak / internalize / import, then
   `run_pass_manager(thin = true)` (`OptStage::ThinLTO`), then `codegen`.

**Skipped, and only these:**
- `thin_lto` (lto.ts, `if (cgcx.lto === "ThinLocal")`): `LLVMRustCreateThinLTOData` is not called. `ThinData` holds no index
  (`_0: undefined`). Everything else runs as upstream: `prepare_lto`, the `ThinShared` of all buffers, the incremental key-map
  logic, one `ThinModule` per CGU.
- `optimize_and_codegen_thin_module`: the four `LLVMRustPrepareThinLTO{Rename,ResolveWeak,Internalize,Import}` calls, the only
  consumers of the index. The timers and every `-Csave-temps` file (`thin-lto-after-*`, written of the unchanged module) stay.
  So do the parse, `run_pass_manager(thin = true)` and `codegen`.

**Why the result is equivalent apart from cross-CGU inlining.** I read PassWrapper.cpp:1313-1500 at the pin. With
`ThinLocal` the index covers only this crate's CGUs, and `each_linked_rlib_for_lto` is empty.
- **Rename** promotes locals that another CGU imports. Nothing is imported, so nothing is promoted. Its `dso_local` changes
  (cleared on declarations for ELF PIC at the default PIE level; set where the index proves a local definition) only choose
  direct vs GOT access to a symbol that resolves the same. Only the clearing is ELF-only; the setting happens on every object
  format, Mach-O included (review cg-lto-diag N2, PassWrapper.cpp:1428-1445).
- **Resolve-weak** makes one copy of each multiply-defined linkonce/weak symbol prevailing, and propagates attributes from the
  index. Without it every CGU keeps its `linkonce_odr` copy and the linker keeps one, as a multi-CGU `-O0` build does.
- **Internalize** internalizes only symbols dead from the preserved roots. PassWrapper says: "everything that's already
  external linkage will stay as external". Without it those stay external but unreachable.
- **Import** is the D8 difference: less cross-CGU inlining.
- **Post-link pipeline:** `buildThinLTODefaultPipeline(Level, nullptr)` takes no summary upstream either. llir-tools maps
  `OptStage::ThinLTO` to `opt -passes='thinlto<Ox>'` (PassWrapper.cpp:963-966).

## Pinned-tool helper agreement (with llir-tools, by message)
- **llir-tools owns it, in `src/rust_ts/llvm/tools.ts`:**
  - `pinned_tool(name)`, for `"opt" | "llc" | "llvm-as" | "llvm-dis" | "llvm-link"`; a missing tool or sysroot is ICE-class;
  - `run_pinned_tool(name, args, stdin?)`, returning `{ status, stdout, stderr }`;
  - `run_pinned_tool_or_ice(name, args, what)`, the D16 form: a non-zero status panics, exit 101;
  - `llvm_tmp_dir()`;
  - `module_text(M)` and `set_module_text(M, text)`: a module held as text after `opt`; later model mutation stops.

  Every LTO tool call goes through it; no second runner.
- **llir-tools implemented these IR-model calls** (commit `ce8718a3` on `t3/implement-llir-tools`, by message):
  - `LLVMRustModuleSerialize`, thin only; `is_thin = false` stops by name;
  - `LLVMRustBufferPtr` / `LLVMRustBufferLen` / `LLVMRustBufferFree`. handles.ts's `Buffer` is now their `LLVMRustBuffer`
    class, and `LLVMRustBufferPtr` always returns the bytes;
  - `LLVMRustParseBitcodeForLTO`;
  - also `LLVMCloneModule` and `LLVMWriteBitcodeToFile`.

  Their `tools.ts` exports `pinned_tool`, `run_pinned_tool`, `run_pinned_tool_or_ice(name, args, input, what, ext?)`,
  `llvm_tmp_dir`, `module_text`, `set_module_text` and `LLVMRustBuffer`.
- **Buffer out-parameter contract** (sent to llir-tools): `LLVMRustOptimize` writes its model `Buffer` handle straight into the
  `{ value }` cell write.ts passes. lto.ts's `Buffer` is that handle (`#[repr(transparent)]`).
  - **Not met yet:** `LLVMRustOptimize` stops by name when a ThinLTO buffer cell is given. Upstream writes that buffer with a
    `ThinLTOBitcodeWriterPass` partway through the pipeline, which one `opt` run cannot produce.
  - write.ts passes the cell when `emit_obj` is `ObjectCode(Full)` or `emit_thin_lto_summary` is set. `ObjectCode(Full)` is an
    rlib with embedded bitcode, the default for an rlib under `--emit=link`. So **every optimized rlib stops there**, with one
    CGU or several. A bin does not.
  - llir-tools' handoff lists it as a follow-up.
- **`llvm-link` is not in `LLVM_TOOLS` / `LLVM_TOOLS_PINNED`** (scripts/lib/llvm-tools.ts). tools.ts locates it and checks it
  exists, but does not hash-check it. Pinning it is a `scripts/` change for root.

## Coverage (`bun scripts/coverage.ts --missing <file>`)
| upstream file | ported |
|---|---|
| compiler/rustc_codegen_llvm/src/back/lto.rs | **19/19** (was 0/19) |
| compiler/rustc_codegen_llvm/src/diagnostics.rs | **2/2** (was 0/2) |
| compiler/rustc_codegen_llvm/src/llvm/diagnostic.rs | **5/5** (was 0/5) |

`bun scripts/coverage.ts --check --offline`: `markers ok (26784, 46 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311;
library 745; llvm 434)`.

## Evidence
- `bunx tsc --noEmit -p .`: clean.
- `RUSTC_ICE=0 RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_codegen_llvm/ ./src/rustc_codegen_ssa/ ./src/std/result.test.ts
  ./scripts/lib/unit-steps.test.ts ./src/rustc_error_messages/`: **286 pass, 0 fail** (36 files). Nothing is skipped.
- **`src/rustc_codegen_llvm/diagnostics.test.ts`** (new, 4 tests). It renders through the real `AnnotateSnippetEmitter` at
  `emit_fatal`.
  - **Oracle:** `WithLlvmError(CreateMCSubtargetInfo)` equals the pinned rustc's stderr byte for byte. The case is a target
    JSON whose `llvm-target` is `nonexistent-unknown-none`. The oracle printed `error: could not create LLVM MCSubtargetInfo
    for triple: nonexistent-unknown-none11.0.0: No available targets are compatible with triple
    "nonexistent-unknown-none11.0.0"` and a blank line, exit 1. The commands are in the test header.

    rust-ts cannot reach this end to end yet: `LLVMRustCreateMCSubtargetInfo` is llir-init's. So the test builds the
    diagnostic as `llvm_err` does.
  - Every `WithLlvmError` variant against diagnostics.rs:144-165.
  - `ParseTargetMachineConfig` against :34. It is unreachable from the CLI: `LLVMRustCreateTargetMachine` fails only where
    `lookupTarget` does, and `LLVMRustCreateMCSubtargetInfo` has already failed on that triple during LLVM init.
  - `ParseTargetMachineConfig` cancels its inner diagnostic: a recording emitter sees one.
  - Bad `-Ctarget-cpu` is not a case here: LLVM only warns, and no diagnostic of mine is involved.
- **`src/rustc_codegen_llvm/back/lto.test.ts`** (new, 2 tests). It runs `-Copt-level=2 -Ccodegen-units=2` (so
  `sess.lto() == ThinLocal`) through ssa-write's real coordinator, over a mock backend whose `run_thin_lto` is the real
  `lto::run_thin`.
  - Checked: the call order and threads (`opt cgu.N`, serialize, `run_thin_lto` on `coordinator`, `optimize_and_codegen_thin`
    on `lto cgu.N`); no index; one `ThinModule` per CGU over one shared `ThinShared`; the buffers' bytes; both CGUs back.
    The mock's `optimize_and_codegen_thin` records instead of parsing, because the real one reaches the IR model's
    `LLVMRustParseBitcodeForLTO`.
  - `-Clto=thin`: the same `CodegenContext` with `lto: Thin` stops at the named `unported`.
- `skeleton.test.ts`:
  - the `cg-lto-diag` entry is gone (0 stubs left);
  - `"excluded (plan-m7 D18)"` 17 → 19 (EnzymeWrapper, `LLVMDumpModule`);
  - `"rustc_codegen_llvm"` 8 → 12 (two `Green`, `-Clto=thin`, `from_thin_lto_modules`).
- Sample difftests (`RUST_TS_AGENT=cg-lto-diag`, `--sample 200 --jobs 6`, AC power, on commit 15e35af8). No suite is called
  `mir`, so I ran `mir-o2` (the brief's) and `mir-o0`:
  - `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261113-220305-cg-lto-diag-474a`.
  - `check-ui`: **200/200 MATCH**, run `20261113-220427-cg-lto-diag-2bnd`.
  - `mir-o2`: **200/200 MATCH**, run `20261113-220532-cg-lto-diag-ym3s`.
  - `mir-o0` (the whole suite, 146 cases): **87 MATCH**, which is all 87 protected; 59 UNPORTED (unprotected), DIFF 0,
    CRASH 0. Run `20261113-220650-cg-lto-diag-va2u`.

  Nothing protected changed.

## Every `unported(...)` left
- back/lto.ts:
  - `"rustc_codegen_llvm::back::lto::thin_lto (ThinLtoInput::Green: rustc_middle WorkProduct; -C incremental, plan-m7 D11)"`
    (×2; `WorkProduct` is never constructed);
  - `"rustc_codegen_llvm::back::lto::thin_lto (-Clto=thin: LLVMRustCreateThinLTOData, no pinned tool builds a ThinLTO combined
    index; plan-m7 D8)"`;
  - `"rustc_codegen_llvm::back::lto::ThinLTOKeysMap::from_thin_lto_modules (LLVMRustComputeLTOCacheKey without a ThinLTO index:
    the ThinLocal no-op under -C incremental; plan-m7 D8, D11)"`;
  - `"excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/llvm/enzyme_ffi.rs EnzymeWrapper::get_instance"`;
  - `"excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/llvm/enzyme_ffi.rs LLVMDumpModule"`.
- **IR-model calls reached (today `llir: <name>` stops in ffi.ts):**
  - lto.ts, fat LTO: `LLVMRustModuleCost`, `LLVMRustLinkerNew`, `LLVMRustLinkerAdd`, `LLVMRustLinkerFree`,
    `LLVMRustRunRestrictionPass`;
  - lto.ts, both: `LLVMRustModuleSerialize`, `LLVMRustBufferPtr`, `LLVMRustBufferLen`, `LLVMRustBufferFree`,
    `LLVMRustParseBitcodeForLTO`. llir-tools is taking these;
  - lto.ts, `-Clto=thin` only, behind the stop: `LLVMRustPrepareThinLTO{Rename,ResolveWeak,Internalize,Import}`,
    `LLVMRustFreeThinLTOData`, `LLVMRustComputeLTOCacheKey`;
  - llvm/diagnostic.ts: `LLVMRustGetDiagInfoKind`, `LLVMRustUnpackOptimizationDiagnostic`, `LLVMRustUnpackInlineAsmDiagnostic`,
    `LLVMRustGetSMDiagnostic`, `LLVMRustUnpackSMDiagnostic`, `LLVMRustWriteTwineToString` (via `twine_to_string`). Nothing
    reaches `diagnostic_handler` until the model turns a tool's stderr into a `DiagnosticInfo`.
  - Plus `LLVMRustOptimize` through `write::llvm_optimize` (llir-tools).

## `// PORT:` decisions (for root to record)
1. **The ThinLocal no-op** (above), at `thin_lto` and `optimize_and_codegen_thin_module`, keyed on `cgcx.lto === "ThinLocal"`.
   `ThinData._0` is `ThinLTOData | undefined`, and `ThinData::drop` frees nothing when it is `undefined`.
2. **`-Clto=thin`** stops in `thin_lto`. The upstream `LLVMRustCreateThinLTOData(..).unwrap_or_else(llvm_err(PrepareThinLtoContext))`
   is kept as a comment there.
3. **`Buffer` is the model's handle** (`#[repr(transparent)]`), with free functions `Buffer_data` / `Buffer_drop`. This lets the
   FFI's `&mut Option<Buffer>` out-parameter hold it unwrapped. `Buffer_data` `unwrap`s `LLVMRustBufferPtr`, since
   `from_raw_parts` needs a non-null pointer.
4. **Drops:** `fat_lto` calls `Buffer_drop` where each `Local` serialized module drops (end of the link loop), and
   `_handler.drop()` at the end of its block, on the normal path only (cg-write decision 4). Other upstream drops of
   `ModuleBuffer` / `ThinData` are left to GC, as elsewhere.
5. **`CString` / `&CStr` are strings.** `CString::new(..).unwrap()` keeps its interior-NUL panic (a local copy of write.ts's
   `cstring_new_unwrap`). `module_name_to_str`'s non-UTF-8 `bug!` is unreachable. Sorting by `CString` is byte order.
6. **Local helpers in lto.ts:**
   - the `SelfProfilerRef` helpers (`generic_activity_with_arg`, `generic_activity_with_arg_recorder`, the recorder never called
     with an empty mask), as write.ts does;
   - `debug_CStr` (`escape_ascii`) for `info!` lines;
   - `path_join`;
   - `starts_with`.
7. **`Object::section_by_name`** is the provided `section_by_name_bytes(name.as_bytes())`, which the vendor port lacks; called
   that way with a PORT comment.
8. **`ThinLTOKeysMap::save_to_file`** writes the whole text once (`create_buffered` + `writeln!`, flushed on drop).
   `load_from_file` implements `BufRead::lines` (`\n`, a trailing `\r` dropped, `INVALID_UTF8`). `keys: BTreeMap` is a `Map`
   iterated in byte order (`sorted_entries`). `#[derive(Debug)]` is `debug_ThinLTOKeysMap`. `-C incremental` only.
9. **llvm/diagnostic.ts:**
   - the field `function` is `function_` (a constructor parameter property cannot be a reserved word);
   - `SrcMgrDiagnostic::unpack` passes the 8-element `ranges` array through a cast, because the generated ffi.ts types
     `*mut c_uint` as `MutRef<number>`. **For the llir lane implementing `LLVMRustUnpackSMDiagnostic`:** write
     `ranges[0 .. 2*num_ranges]`.
10. **`enable_autodiff_settings`** stops at `EnzymeWrapper::get_instance` (D18). Its body is kept over a local
    `EnzymeWrapper` interface listing the setters it calls.
11. **lto.ts reads `crate::back::llvm_backend` (`ModuleLlvm`) lazily**, because llvm_backend.ts imports lto.ts. `write.ts` is
    imported statically. diagnostics.ts and llvm/diagnostic.ts load only modules write.ts already loads.

## For root
- **Fat LTO follow-up (IR model, not llir-tools'):**
  - `LLVMRustLinkerNew` / `Add` / `Free`: `llvm-link` of the base module's text and the buffers into one module, which gets
    `set_module_text`;
  - `LLVMRustRunRestrictionPass`: `opt -passes=internalize -internalize-public-api-list=<syms>`, or a file list;
  - `LLVMRustModuleCost`: upstream counts the module's functions (RustWrapper.cpp:1487, `std::distance` over `functions()`), which the model can
    answer.

  All of them go over llir-tools' `tools.ts`.
- **Pin `llvm-link`** in scripts/lib/llvm-tools.ts (`LLVM_TOOLS`, `LLVM_TOOLS_PINNED`). This is a scripts/ batch.
- **ThinLocal end to end.** On this branch alone, `-O` with several CGUs stops by name in the first `serialize_module`. It no
  longer stops at `run_thin_lto`.

  With llir-tools' `ce8718a3` merged, a **bin** should get through the whole ThinLocal path:
  - pre-link optimize;
  - thin serialize;
  - parse;
  - the four skipped steps;
  - `thinlto<Ox>`;
  - codegen.

  I have not run this: the two branches are not merged here.

  An **rlib** at `-O` still stops earlier, in `LLVMRustOptimize`'s ThinLTO buffer cell (above).

  `-Clto=fat` needs `is_thin = false` serialization too (stops in llir-tools' `LLVMRustModuleSerialize`), on top of the
  follow-up above.

## Commits (branch `t3/port-cg-lto-diagnostics`)
- `15e35af8`: the port, the write.ts stub replacements, diagnostic_impls.ts, skeleton counts and both new tests.
- `1b55ee87`, `11aaf180`: this handoff, and the branch name in it.
- The commit recording llir-tools' `ce8718a3`.
