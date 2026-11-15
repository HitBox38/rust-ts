# Handoff: llir-di (M7c/M7d, wave 40s): the IR model's debuginfo builder

Branch `t3/port-llvm-debuginfo-builder`, from `2bf7435a`. No merges.

## Summary
- The IR model now has LLVM's `DIBuilder` as rustc's FFI uses it. All 40 debuginfo functions of `ffi.rs` are bound; no
  debuginfo stub is left in `ffi.ts`:
  - `LLVMCreateDIBuilder` / `LLVMDisposeDIBuilder` / `LLVMDIBuilderFinalize`;
  - the 26 `LLVMDIBuilder*` C API functions;
  - the 12 `LLVMRustDI*` wrappers;
  - plus `LLVMSetCurrentDebugLocation2` / `LLVMGetCurrentDebugLocation2`, which build.ts already bound. They used to stop on a
    location; now they store and return one.
- The model also has:
  - the 18 specialized node classes rustc reaches, with LLVM's operand layout, uniquing keys (the ODR subset cases included) and
    `AsmWriter` text;
  - `!dbg` locations on instructions, set by `Instruction::setMetadata(MD_dbg)` and by the builder's `StoredDL`;
  - debug records (`#dbg_declare` / `#dbg_value`) with LLVM's `DbgMarker` placement: trailing records, adoption by the next
    instruction, the insertion head bit, `flushTerminatorDbgRecords`, and `removeMarker` on erase.
- **Evidence:**
  - **libLLVM, byte for byte.** One call sequence goes through the oracle's own libLLVM.dylib and through the model. The two
    printed modules are equal byte for byte, metadata numbering included.
  - **rustc's IR, numbering aside.** gdb.rs at `-Cdebuginfo=2` (x86_64 and the host) and at `-Cdebuginfo=1`: the model's debug
    info equals rustc's.
- **Gate cases:** none of the 24 `run-pass-native` cases passes yet. They no longer stop at `llir: LLVMCreateDIBuilder`. All 24
  now stop at `cg-di-b: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs TypeMap::default`, on the codegen side
  (cg-di-b, a later lane; then cg-di-a's `build_compile_unit_di_node` stub).

## Files touched
New:
- `src/rust_ts/llvm/di_nodes.ts`: the node classes, from DebugInfoMetadata.h/.cpp and LLVMContextImpl.h:
  - `DILocation`, `DISubrange`, `DIEnumerator`, `DIBasicType`, `DIDerivedType`, `DICompositeType`, `DISubroutineType`, `DIFile`;
  - `DICompileUnit`, `DISubprogram`, `DILexicalBlock`, `DILexicalBlockFile`, `DINamespace`, `DITemplateTypeParameter`;
  - `DIGlobalVariable`, `DILocalVariable`, `DIExpression`, `DIGlobalVariableExpression`.

  It also holds the uniquing store (`storeImpl`), `replaceOperandWith` (`handleChangedOperand` for a uniqued node), the
  `MDFieldPrinter`, every `write<CLASS>`, `DIExpression::isValid`/`getSize`, the discriminator encoding, and
  `cloneWithBaseDiscriminator`.
- `src/rust_ts/llvm/di_builder.ts`:
  - `DIBuilder`: the 33 methods the FFI calls, each with its `// llvm: DIBuilder.cpp` marker;
  - `DbgVariableRecord`;
  - the C API functions (`// llvm: DebugInfo.cpp`) and the RustWrapper functions (`// rustc: RustWrapper.cpp`).
- `src/rust_ts/llvm/dwarf.ts`: name tables (DW_TAG / OP / ATE / LANG / CC) extracted mechanically from Dwarf.def, one row per
  `HANDLE_DW_*` line, plus the DIFlag/DISPFlag rows and `splitFlags`.
- Tests:
  - `src/rust_ts/llvm/di_builder.test.ts`: 8 tests, about 40 ms;
  - `src/rust_ts/llvm/di_builder.oracle.test.ts`: 5 tests, about 0.2 s.
- Fixtures in `src/rust_ts/llvm/di_oracle/`: `gdb.rs` (a copy of cg-di-a's), `aarch64-apple-darwin.gdb-g.ll`,
  `x86_64-unknown-linux-gnu.gdb-g1.ll` and `README.md`. The test re-makes the two `.ll` files with the pinned toolchain and
  requires them unchanged.

Regenerated: `src/rust_ts/llvm/ffi.ts` with `bun tools/llir/ffi_gen.ts`. ir-fix-b and cg-asm may regenerate it too, so root
should regenerate at integration. `impl_modules.ts` gains `./di_builder.ts`, as its header says a later llir lane does.

### Hooks in existing model files
ir-fix-b owns these files this wave. Each hook is small:
1. **`ir.ts`, `MDNode`:** two overridable methods:
   - `writeSpecialized(operand)`: an MDTuple returns `undefined`;
   - `printsInline()`: false, except for `DIExpression`.
2. **`printer.ts`:**
   - `mdSlot` gives a `DIExpression` no slot;
   - `metadataOperand` writes a `DIExpression` inline;
   - `mdTuple` prints a specialized node's `write<CLASS>`, with `distinct ` before it.
   - **Correction:** a function's attachments are numbered when the function is printed, not in the module pass. This is
     `SlotTracker::processModule` with `ShouldInitializeAllMetadata` false, and `incorporateFunction` in `printFunction`
     (AsmWriter.cpp:1121-1134, :1143, :4164).
   - The correction changes only metadata numbers, which the normal form absorbs. The libLLVM test needs it for exact text.
3. **`inst.ts`:**
   - new fields: `Inst.debugLoc`, `Inst.dbgRecords`, `BasicBlock.trailingDbgRecords`;
   - `Inst.setMetadata`/`getMetadata` handle kind 0 (`MD_dbg`), as `Instruction::setMetadata` does. The old stop is gone;
   - `Inst.handleMarkerRemoval` runs in `eraseFromParent`;
   - `IRBuilder`:
     - new fields `headBit` and `storedDL`;
     - `setInsertPoint(bb, ip, headBit)` takes IP's debug location, as `SetInsertPoint(BB, IP)` does;
     - `insert` adopts records (`Instruction::insertBefore`), flushes trailing records onto a terminator, and applies `StoredDL`;
   - exports `DbgRecordHook` and `insertDbgRecordBefore`;
   - the body printer prints records before their instruction (`printDbgRecordLine`) and `!dbg` first among the attachments.
4. **`build.ts`:**
   - `LLVMGet/SetCurrentDebugLocation2` are implemented;
   - `LLVMRustPositionBuilderAtStart` passes the head bit (`getFirstInsertionPt` sets it);
   - `LLVMRustPositionBuilderPastAllocas` clears it.
5. **`core.ts`:** `bytesArg` and `cstrArg` are exported.
6. **`handles.ts`:** `DbgRecord` and `DIBuilder` are di_builder.ts's classes, no longer opaque brands, as the file's header
   says a lane does.
7. **Tests:**
   - `model.test.ts` "debuginfo is llir-di's" now expects a `DIBuilder`;
   - `build.test.ts` expects a non-`DILocation` passed to `LLVMSetCurrentDebugLocation2` to throw `unwrap<DILocation>`.

   Both used to assert this lane's stops.

### For root: one test outside this lane's files
- `src/rustc_codegen_llvm/debuginfo/mod.test.ts:285` (cg-di-a's) pins the old stop with
  `expect(stop).toBe("llir: LLVMCreateDIBuilder");`. It now fails.
- Replace it with
  `expect(stop).toBe("cg-di-b: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs TypeMap::default");`.
- The test's title (line 268) should say "then cg-di-b's TypeMap::default".
- This lane may not edit `rustc_codegen_llvm/`. Every other test in that file passes.

## LLVM files to pin (`bun scripts/llvm-src.ts add <path>`)
Every `// llvm:` marker this lane added is in a file already pinned: DIBuilder.cpp, DebugInfo.cpp, AsmWriter.cpp,
Instruction.cpp and BasicBlock.cpp. `coverage.ts --check` passes without new pins. The files below are cited in comments.
Pinning them makes the citations checkable, after which the comments can become markers. All were fetched at `aab11ee0` into my
scratchpad:

| path | SHA-256 |
|---|---|
| llvm/lib/IR/DebugInfoMetadata.cpp | d8ae1daf0f322bfb4a871bf10fdea8bcb4fc9e1accf090a28fa0f32fab8290e1 |
| llvm/include/llvm/IR/DebugInfoMetadata.h | 8108615a168c81b5bbd1153178e988b314c7be35b63dc1830363b806487810d3 |
| llvm/include/llvm/IR/DIBuilder.h | 91b8f3ad586dde6778cc41953fc9745ce2ca6bf4efff1f4615ca4ec87fdf3084 |
| llvm/lib/IR/LLVMContextImpl.h | 8220559a4cbbfd013c459fe193c43e6d9d511340ad7665171fae2ef6be56c202 |
| llvm/include/llvm/Support/Discriminator.h | 2c93e5bcac232848b04b2f7ce0c6b1fd49f623ed53e8d15874e3bc872c9d3ad1 |
| llvm/lib/BinaryFormat/Dwarf.cpp | 7e07936e725f80d695091107772cb8110cb6422264a3a8baea9929e0a8c361f7 |
| llvm/include/llvm/BinaryFormat/Dwarf.def | 68295c4003f163651c9b83c1177b30adf5421fd574d6a94cf5388aa534925de3 |
| llvm/include/llvm/BinaryFormat/Dwarf.h | 4b30588df9509abdd7ffa5907375c708d17d17ec6e9009ef739c5337e7a0d751 |
| llvm/include/llvm/IR/DebugInfoFlags.def | ed5b4faa89d2d5d58428486eaaacd22c7b0be61c64cd9e7e1b422c5ef1fa05e6 |
| llvm/lib/IR/DebugProgramInstruction.cpp | 1a05240c56904aba5c886886a2fd1740e061092c278bc1da2986b0b4bf604938 |
| llvm/include/llvm/IR/DebugProgramInstruction.h | 6183f5c4af6ff0861db97aa77c763294ba99e11db49e9bf76051dbb9a7676b33 |

## Coverage
- No rustc file is ported, so the compiler TOTAL is unchanged. `// llvm:` markers are not counted (PORTING §5c).
- WRAPPER figure (`bun scripts/coverage.ts --crate llvm-wrapper`): **87/197**. RustWrapper.cpp is 65/132, with 12 new markers.
- `bun scripts/coverage.ts --check`: `markers ok (27232, 87 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library 745; llvm 627)`.
- `ffi.ts`: 38 fewer stubs (95 before, 57 after).

## Evidence
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: ok (above).
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./scripts/lib/unit-steps.test.ts`:
  - **all pass but the one cg-di-a test above** (341 tests before this lane's 13 new ones);
  - the added unit-test wall time is about 0.3 s.

### di_builder.oracle.test.ts
1. **libLLVM, byte for byte.** The same call sequence goes through the oracle's libLLVM.dylib (bun:ffi) and through the model.
   The printed modules are equal, metadata numbers included. The sequence follows rustc's metadata.rs and mod.rs shapes:
   - an MD5 file, and the compile unit;
   - nested namespaces (uniqued);
   - basic, pointer, `const`-qualified and typedef types;
   - a struct made as a stub and filled by `replaceArrays`. Its members belong to a type with an identifier, so a second
     `CreateMemberType` with the same name and scope returns the first;
   - a static member with `extraData: i32 7`, and a union;
   - an enumeration of arbitrary-precision enumerators (8, 64 and 128 bits, signed and unsigned), which lands in the CU's `enums:`;
   - an array and a vector of a subrange;
   - a global variable expression attached as `!dbg`, which lands in `globals:`;
   - a function with `setSubprogram`, parameter and auto variables (`retainedNodes:` after finalize);
   - a lexical block, and a lexical block file used in an `inlinedAt` location;
   - `#dbg_declare` records trailing and adopted, and one after the terminator (placed before it);
   - four `#dbg_value` expressions: a fragment, `plus_uconst`/`deref`, `stack_value`, and constu-stack_value-fragment;
   - builder debug locations, and clearing them.

   Where the model side calls an `LLVMRust*` wrapper, the libLLVM side calls the C API that makes the same `DIBuilder` call:
   File, CompileUnit, Function, ReplaceArrays, EnumerationType, VectorType.
2. **rustc's `-g` IR, numbering aside.** di_oracle gdb.rs is built through the wrappers rustc calls. Each `!N` is compared by
   what it is, recursively. Compared: every specialized node, each definition's `!dbg`, every `#dbg_*` record, every located
   instruction, and `!llvm.dbg.cu`:
   - **x86_64-unknown-linux-gnu, `-Cdebuginfo=2`** (cg-di-a's fixture): equal. This covers `nameTableKind: None`,
     `splitDebugInlining: false`, `DISPFlagMainSubprogram` (rustc's 1 << 5 to LLVM's 1 << 8), `templateParams`,
     `retainedNodes`, `dwarfAddressSpace: 0`, and the spill allocas made by `LLVMRustPositionBuilderAtStart` with the head bit;
   - **aarch64-apple-darwin (host), `-Cdebuginfo=2`:** equal;
   - **x86_64-unknown-linux-gnu, `-Cdebuginfo=1`:** equal. Limited debuginfo has empty signature and template arrays and no
     variables;
   - the two new fixtures are re-made from the pinned toolchain and unchanged.

### di_builder.test.ts
These cover what the C API cannot drive, with expected values derived from the cited source:
- `cloneWithBaseDiscriminator`:
  - BD 1 gives discriminator 2;
  - BD 40 gives 208, and skips a parent that already has a discriminator;
  - BD 0x1000 gives none;
- a column of 2^16 or more is 0;
- ODR uniquing of method declarations (`LLVMRustDIBuilderCreateMethod`), and distinct definitions;
- the printed text of variant parts, variant members (`extraData: i8 1`) and template parameters;
- a global in a local scope is retained by its subprogram, not listed in `globals:`;
- the DIFlags/DISPFlags conversions, including `bad LLVMDIFlags`;
- invalid vs valid `DIExpression` printing;
- head bit, `StoredDL` copy and record moves on erase.

### The 24 gate cases (`run-pass-native`)
- Run with `--filter <id> --jobs 1`: **0/24 pass, all UNPORTED**. Every one now stops at
  `cg-di-b: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs TypeMap::default`. That is the codegen side's
  `#[derive(Default)]` of `CodegenUnitDebugContext.type_map` (cg-di-b).
- After it, cg-di-a's handoff lists `build_compile_unit_di_node` and the rest of metadata.rs (`type_di_node`, `file_metadata`, ...).

### Sample difftests (`RUST_TS_AGENT=llir-di`, `--sample 200 --jobs 6`, AC power)
- `ir-run-pass`: 192 MATCH, 1 DIFF, 7 UNPORTED; run `20261115-004846-llir-di-7anz`.
  - No protected case left MATCH.
  - The DIFF (`tests/ui/lto/thin-lto-inlines.rs`) is a DIFF in the accepted gate too.
  - The UNPORTED cases are cg-asm, cg-di-b (`issue-82859`, a gate-24 case), thin LTO and sanitizers.
- `ir-host`: 193 MATCH, 1 DIFF, 6 UNPORTED; run `20261115-005018-llir-di-qhnv`. Every non-MATCH case has the same status in the
  accepted gate; none is protected.
- `run-pass-native`: 194 MATCH, 0 DIFF, 6 UNPORTED; run `20261115-005203-llir-di-ccx8`. Every non-MATCH case is UNPORTED in
  the accepted gate too (cg-asm, the aarch64 intrinsic table, cg-di-b, thin LTO); none is protected.

## `unported(...)` this lane left (all `llir: ...`)
- `MDNode::handleChangedOperand making a uniqued node distinct (self reference)`, and
  `MDNode::handleChangedOperand collision on re-uniquing (RAUW or storeDistinctInContext)`. Re-uniquing after `replaceArrays`
  hits neither on rustc's paths, since its composite types carry unique identifiers.
- `DIBuilder tracking vector of a scope that is not a DILocalScope`. LLVM's `cast<>` would be undefined behaviour there.
- `printing a DICompositeType's enumKind (dwarf::EnumKindString)`. rustc never sets one.
- `DIExpression opcode <n> has no name`. An opcode `isValid` accepts always has one, so this is unreachable.
- `DIFile checksum kind <n>`, `emission kind <n>`, `name table kind <n>`, for values outside LLVM's enums.
- `DICompileUnit is never uniqued`, if the uniquing key of a compile unit is ever asked for.
- Removed: `llir: LLVMSetCurrentDebugLocation2 of a location`, `llir: Instruction::setMetadata(MD_dbg)`, and the 38 debuginfo
  `ffi.ts` stubs.

## `// PORT:` and judgment calls
1. **Unpinned LLVM files are cited in comments, not markers** (dwarf.ts and di_nodes.ts headers), so `coverage --check` passes
   before root pins them.
2. **Uniquing as string keys:** the class name, operand ids and the integer fields `isKeyOf` compares (not `EnumKind`, which
   LLVM leaves out of the key).
   - The ODR subsets key on `(tag, name, scope)` for members and on `(scope, linkageName, templateParams)` for method
     declarations, both only when the scope has an identifier.
   - This is the same equality, because an eligible lookup can only meet eligible nodes (di_nodes.ts header).
3. **`assert`s are comments, not checks.** The oracle's LLVM is a release build: "Can only make one compile unit",
   "Expected compile unit", matching subprograms, and so on.
   - Unchecked `unwrap<>` misuse (a non-`DILocation` location, a non-tuple array) throws an `Error`.
   - `fromRust(LLVMDIFlags)`'s `report_fatal_error` throws `bad LLVMDIFlags`.
4. **No temporaries:** `trackIfUnresolved`, `UnresolvedNodes` and `resolveCycles` only matter for temporary nodes, which no
   rustc path makes. Macros, imported entities and labels are left out too.
5. **`DISubprogram` keeps all 13 operands.** LLVM drops trailing null operands from `ContainingType` on, and neither an accessor
   nor the printer can tell the difference.
6. **The model's TypeFinder does not walk metadata or debug records** (`incorporateMDNode`). Identified struct types reachable
   only from metadata would be missed. rustc's metadata holds only integer constants and the values instructions already use.
7. **`processInstructionMetadata` numbers only intrinsic calls' MDNode operands.** The model's printer numbers any metadata
   operand as it prints it. rustc calls no non-intrinsic function with metadata, so numbering is unaffected (and N1 renumbers).

## Notes for root
- After cg-di-b lands, the whole `-g` path can be checked end to end:
  - `debugView`/`diNodes` in di_builder.oracle.test.ts compare a port-built module with the oracle's;
  - the normal form (N1) is the gate's comparison anyway.
- Nothing here changes output without `-g`. Without a `DILocation` there is no `StoredDL`, no record and no `!dbg`. The
  printer's numbering change moves metadata numbers only.
