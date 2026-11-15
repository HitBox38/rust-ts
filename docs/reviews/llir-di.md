# Review: llir-di (wave 40s), the IR model's debug-info builder

- **Subject:** branch `t3/port-llvm-debuginfo-builder`, commit `7e49f1cf`, on main `2bf7435a`. Handoff: `docs/handoff/llir-di.md`.
- **Reviewer:** independent, read-only on code. Review branch `t3/review-llir-di`, on top of `7e49f1cf`.
- **Run on:** AC power, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, Bun 1.4.4. LLVM sources at the pin `aab11ee0`; RustWrapper.cpp from
  the rust checkout.

## Verdict: APPROVE WITH NITS

The port is faithful wherever I compared it with LLVM at the pin. That covers:
- every `write<CLASS>` and `MDFieldPrinter` method;
- every uniquing key and both ODR subsets;
- operand layouts, distinct versus uniqued;
- `DIExpression::isValid` and its printing;
- the DIFlags/DISPFlags splitting;
- the record placement rules;
- the discriminator encoding;
- the 26 C API functions and the 12 RustWrapper functions.

The DWARF name tables equal a fresh extraction from `Dwarf.def`. Output without `-g` is byte-identical to the base on 156 protected
modules. The sample difftests lost no protected case.

There are no must-fix findings. The nits are about tests that pin less than the handoff says (N1, N2), one pre-existing numbering
detail now reachable (N3), and one marker (N4).

## Findings

**N1. The per-function metadata numbering is correct but no test pins it.** The change is at
`src/rust_ts/llvm/printer.ts:255-257` (the module-pass loop is removed) and `printer.ts:550` (numbering in `function()`).
- **The change is right.** It matches upstream `AsmWriter.cpp:1121-1128`: `processModule` skips `processFunctionMetadata` unless
  `ShouldInitializeAllMetadata`. It also matches `:1146-1148`: `processFunction` does that numbering when `incorporateFunction`
  runs. The oracle fixture `di_oracle/aarch64-apple-darwin.gdb-g.ll` agrees: the second function's `!35` comes after the first
  function's body locations `!30`–`!34`.
- **No test pins it.**
  - Mutant **M4b** puts back `for (const [, n] of f.metadata) this.mdSlot(n);` in the constructor's function loop. All 13 new tests
    still pass.
  - Mutant **M4** deletes the new loop at :550. That is an equivalent mutant: the header prints its sorted attachments and numbers them
    lazily anyway.
- **Why it survives.** The libLLVM sequence has a single function with attachments (`_ZN2di3add`,
  `di_builder.oracle.test.ts:257`). The gdb.rs cases compare modulo numbering.
- The handoff says "the libLLVM test needs it for exact text". It doesn't, for this sequence.
- **Fix:** add a second function with `!dbg` and a located body to the libLLVM sequence. With two such functions the two numberings
  differ.

**N2. The gdb.rs comparison does not see record placement or the head bit.**
- `debugView` (`di_builder.oracle.test.ts:395-406`) keeps only `define … !dbg`, `#dbg_*` lines, lines with `, !dbg !` and
  `!llvm.dbg.cu`. The spill `alloca`s and the `store`s that adopt the records are dropped.
- The handoff says this case covers "the spill allocas made by `LLVMRustPositionBuilderAtStart` with the head bit". It doesn't:
  - Mutant **M7** passes `false` for the head bit in `build.ts:273`. The three gdb.rs cases still pass.
  - Only the hand-derived unit test `di_builder.test.ts` ("insertion head bit, …") catches it.
- **The behaviour itself is right.** I dumped `printModule(buildGdb(2))`. Its `start` body matches the oracle's
  (`aarch64-apple-darwin.gdb-g.ll:8-23`) line for line:
  - the allocas come in reverse order, as the head bit inserts each new one first;
  - each `#dbg_declare` sits on the next `store`, through `adoptDbgRecords`;
  - the last declare is on `ret`.
- **Fix:** compare whole bodies in `debugView`, with `!guid` and attribute groups stripped. Then the oracle pins placement too.

**N3. Global attachments are numbered in insertion order** (`printer.ts:251`, an ir-fix-b line, not changed by this lane).
- `for (const [, n] of gv.metadata) this.mdSlot(n)` walks attachments in insertion order.
- Upstream `SlotTracker::processGlobalObjectMetadata` (`AsmWriter.cpp:1218-1222`) uses `getAllMetadata`, which is stable-sorted by
  kind. The model's own `attachments()` printer sorts them too.
- **Now reachable.** It used to matter only for globals with several attachment kinds. With `!dbg` (kind 0) on statics, a global
  that already carries another kind gets its `!dbg` numbered second; LLVM numbers it first. One example is a CFI vtable's `!type`
  (those cases are out of scope today).
- It affects numbering only, and `opt` re-prints the module in `tools.ts:726` anyway (see Evidence). But the lane sorted the
  function case at :550, so the global case should match.
- For root, or ir-fix-b: sort there as `:550` does.

**N4. A marker cites the wrong overload.**
- `di_builder.ts` `// llvm: llvm/lib/IR/DIBuilder.cpp:473 DIBuilder::createMemberType` cites the overload taking `Metadata *SizeInBits` /
  `Metadata *OffsetInBits`.
- The C API (`DebugInfo.cpp:1575`, `uint64_t` arguments) calls the `uint64_t` overload at `DIBuilder.cpp:463`. The port's body
  follows that one.
- The marker should say `:463`. `coverage --check` cannot tell them apart, since both are named `createMemberType`.

## 1. Fidelity

### AsmWriter specialized metadata
I compared every writer the lane added with `AsmWriter.cpp:2114-2690` at the pin: `DILocation`, `DISubrange`, `DIEnumerator`,
`DIBasicType`, `DIDerivedType`, `DICompositeType`, `DISubroutineType`, `DIFile`, `DICompileUnit`, `DISubprogram`, `DILexicalBlock(File)`,
`DINamespace`, `DITemplateTypeParameter`, `DIGlobalVariable`, `DILocalVariable`, `DIExpression` and `DIGlobalVariableExpression`.

- **Field order, skip flags and defaults** match line for line:
  - `line` is always printed in `DILocation`;
  - `baseType` is never skipped in `DIDerivedType`;
  - `dwarfAddressSpace` is printed only when present, including 0;
  - `rank` goes through `getRankConst`;
  - `specification` is printed only when non-null;
  - `virtualIndex` is guarded by virtuality or a non-zero index;
  - `spFlags` is always printed, as `0` when there are none;
  - `emissionKind` and `nameTableKind` use the `*String` tables; `language` goes through `LanguageString` with no skip, the
    unversioned path.
- **`distinct `** comes from the node's storage, printed before the body in `mdTuple`, as `writeMDNodeBodyInternal` does.
- **DIFlags splitting** matches `DINode::splitFlags` (DebugInfoMetadata.cpp:476): Accessibility, then PtrToMemberRep, then
  IndirectVirtualBase, then each `HANDLE_DI_FLAG` row in `.def` order, then the extra bits. The `Largest` row is excluded, as the
  `.def` guards it.
- **DISP flags:**
  - `DISPFlag*` row order is right;
  - `getFlagString(SPFlagVirtuality)` returns `""`;
  - `fromRust(LLVMRustDISPFlags)` maps rustc's `MainSubprogram` (1 << 5) to LLVM's (1 << 8), as `RustWrapper.cpp:785-810` does.
- **DWARF tables.** I re-extracted TAG, OP, ATE, LANG and CC from `Dwarf.def` at the pin and compared them with `dwarf.ts`: 115, 181,
  24, 63 and 32 entries, 0 mismatches, 0 extras. The `DW_OP_LLVM_*` tail matches `Dwarf.cpp:146-161`.
- **`DIExpression`:**
  - printed inline and never given a slot (`CreateMetadataSlot`, AsmWriter.cpp:1424);
  - `isValid` and `ExprOperand::getSize` match DebugInfoMetadata.cpp:1733-1857 case for case;
  - an invalid expression prints raw elements; `DW_OP_LLVM_convert` prints its encoding through `AttributeEncodingString`.
- **`#dbg_*` records:**
  - `printDbgVariableRecord` (AsmWriter.cpp:4921) gives location, variable, expression, then location, with `(null)` for null;
  - `printDbgRecordLine` indents by four spaces, before the owning instruction;
  - trailing records are not printed, as in `printBasicBlock`.

### Uniquing
I compared each key with `MDNodeKeyImpl<CLASS>::isKeyOf` in LLVMContextImpl.h. For every class, the key's operands and integer fields
together are exactly the fields `isKeyOf` compares.
- `EnumKind` is left out of `DICompositeType`'s key, as upstream does.
- `PtrAuthData` is always none.

**Distinct versus uniqued**, checked against DIBuilder.cpp:
- distinct: `DICompileUnit`, `DISubprogram` definitions (`getSubprogram(IsDistinct = IsDefinition)`), `DILexicalBlock` and
  `DIGlobalVariable`;
- uniqued: everything else, including `DIGlobalVariableExpression` and `DILexicalBlockFile`.

**ODR subsets:**
- members key on (tag, name, scope) when the scope is a `DICompositeType` with an identifier (`isODRMember`, :738);
- method declarations key on (scope, linkageName, templateParams) under the same condition (`isDeclarationOfODRMember`, :1008).
- The handoff argues that a string key on the subset is the same equality, because an eligible lookup can meet only eligible nodes.
  That argument holds: a full-key match implies a subset match, and an eligible right-hand side has the same eligibility inputs.
- There is no `DICompositeType` ODR uniquing to port. `getODRType` / `buildODRType` run only with `enableDebugTypeODRUniquing`, which
  DIBuilder never uses.

**`replaceOperandWith` on a uniqued node** re-uniques it, and stops by name on the two paths that rustc's identified types never
reach.

### DIBuilder and the C API / RustWrapper functions
I compared each `DIBuilder` method with DIBuilder.cpp:
- `finalize`/`finalizeSubprogram`, with the retained-node scope filter;
- the `createCompileUnit` operands and `llvm.dbg.cu`;
- `createFile`: canonical strings, but the source not canonicalized;
- the derived, composite, enum, array and vector creators: tags, flags, tracking vectors, `EnumTypes` versus local scope;
- `createGlobalVariableExpression`: `Globals` versus a local scope;
- `createLocalVariable` and `AlwaysPreserve`;
- `createFunction`/`createMethod` defaults;
- `insertDeclare(BasicBlock*)`: before the terminator, else at end;
- `insertDbgVariableRecord`, which takes the position's head bit;
- `replaceArrays`.

Each C API function matches its DebugInfo.cpp body: argument defaults, the `unsigned AddressSpace` becoming a present `optional`,
`InsertDbgValueRecordAtEnd` going to `end()`, and the arbitrary-precision words read little-endian. Each RustWrapper function matches
`RustWrapper.cpp:1005-1164`, including `fromRust(LLVMDIFlags)`'s unknown-bits fatal error and `cloneWithBaseDiscriminator`.

`encodeDiscriminator`, `decodeDiscriminator` and `cloneWith(Base)Discriminator` match DebugInfoMetadata.cpp:417-455, `Discriminator.h`
and DebugInfoMetadata.h:3092-3143. The test values (BD 1 → 2, BD 40 → 208, BD 0x1000 → none) check out by hand.

### Markers and stops
- **Markers.** Every `// llvm:` marker the lane added points at a definition of that name in a pinned file (my own line check, plus
  `coverage --check`). N4 is the one wrong overload.
- **Comments, not markers.** The unpinned files are cited in comments and listed in the handoff. Their 11 SHA-256s match the files I
  fetched at `aab11ee0`: DebugInfoMetadata.cpp/.h, DIBuilder.h, LLVMContextImpl.h, Discriminator.h, Dwarf.cpp/.def/.h,
  DebugInfoFlags.def and DebugProgramInstruction.cpp/.h.
- **Stops.** Every one is an `llir: …` `unported` and is listed in the handoff.

## 2. Evidence
- **New tests.** `bun test di_builder.test.ts di_builder.oracle.test.ts`: 13 pass, 0 fail, 88 expects. Under
  `RUST_TS_REQUIRE_PROBES=1` the oracle suites do not skip.
- **The libLLVM comparison** is test-only, through `bun:ffi` `dlopen` of `<pinned sysroot>/lib/libLLVM.dylib`:
  - It follows the existing pattern of `capi.oracle.test.ts`, and the files carry the same "tests only" header.
  - It is gated by `describe.skipIf(!HAVE && !REQUIRE)`. HAVE means `rustc +<pin> --print sysroot` works, the dylib exists, and the
    platform is darwin. Without the toolchain it prints `SKIP: …`; with `RUST_TS_REQUIRE_PROBES=1` a missing dylib is a failure.
  - Cost: the whole oracle file takes about 0.1 s.
  - **The port never loads libLLVM.** `di_builder.ts`, `di_nodes.ts` and `dwarf.ts` import no `bun:ffi` and spawn nothing.
- **Fixtures:**
  - `aarch64-apple-darwin.gdb-g.ll` and `x86_64-unknown-linux-gnu.gdb-g1.ll` are oracle output, and the test re-makes them with the
    pinned rustc.
  - I checked that the re-make test really runs and compares: one changed byte in the `-g1` fixture failed it ("this lane's
    fixtures are the pinned rustc's output", 44 ms), then I restored the file.
  - The third case is cg-di-a's existing x86_64 `-g` fixture.
- **What the rustc-IR test really checks.** Its call sequence (`buildGdb`) is a hand transcription of rustc's metadata.rs/mod.rs
  calls, not ported codegen. That is fine for a model test. The end-to-end `-g` check waits for cg-di-b, as the handoff says.
- **`ffi.ts`** regenerates to the committed file byte for byte (`bun tools/llir/ffi_gen.ts`, no diff). No debuginfo stub is left: all
  40 `ffi.rs` debuginfo fns are bound, and 57 stubs remain overall.

## 3. Hooks into ir-fix-b's files: identical without debug info
**Argument.** With no `DILocation` anywhere:
- `storedDL` stays undefined: `setInsertPoint` copies an instruction's undefined `debugLoc`, and `insert` sets `debugLoc` only when
  `storedDL` is defined.
- No record exists. So `insertedDbgRecords`, `handleMarkerRemoval` and `flushTerminatorDbgRecords` find nothing to move, and
  `headBit` has no effect.
- `MDTuple.writeSpecialized` returns undefined, so `mdTuple` prints `!{…}` as before. `printsInline()` is false, so `mdSlot` and
  `metadataOperand` take the old paths.
- `Inst.setMetadata(0, …)` was a stop before. `setMetadata(k ≠ 0)` and its early return behave as before, because `debugLoc` is
  undefined.
- The only change is when a function's own attachments are numbered.

**Measurement.** I built 156 distinct protected cases with the port at `2bf7435a` and at `7e49f1cf`, and `cmp`-ed the raw `.ll`
outputs, before any normal form:
- 80 every-42nd cases of `harness/baseline/ir-run-pass.txt`, run with their own argv;
- 41 cases of `ir-host` and 34 of `ir-run-pass-o0` (one id appears in both, so they share an output file), and both `ir-hello`
  cases.

All built with exit 0, and **all are byte-identical**. Every module has metadata, and all 4437 definitions carry a `!guid`
attachment.

**Why the numbering change cannot show here.** The model's text goes through the pinned `opt -passes=assign-guid -S` (`tools.ts:726`),
a subprocess that re-prints the module. So the final numbering is LLVM's own on both sides. N1 renumbering absorbs it again in
the suites.

**Other text comparisons.** No protected suite compares IR text outside the N1 normal form. Every IR suite in `harness/suites.ts`
goes through `scripts/ir-run.ts`.

## 4. Mutations
I made one change at a time, ran the two new test files, then reverted. After each revert `git diff` was empty.

| # | mutation | result |
|---|---|---|
| M1 | `DIDerivedType` prints `align` before `size` (di_nodes.ts write) | 4 fail (libLLVM, 3× gdb.rs) |
| M2 | ODR member key drops the name (`odrKey`) | 1 fail (libLLVM) |
| M3 | `createFunction` never distinct (`getSubprogram(false, …)`) | 5 fail |
| M5 | `DILocation` key drops the column | 4 fail |
| M6 | `insertDbgRecordBefore` always inserts at head | 1 fail (libLLVM) |
| M7 | `LLVMRustPositionBuilderAtStart` without the head bit | 1 fail (unit test only; see N2) |
| M8 | `insertedDbgRecords` never adopts | 2 fail |
| M4 | delete the per-function numbering loop (printer.ts:550) | 0 fail: equivalent mutant |
| M4b | put back module-pass numbering of function attachments | **0 fail** (N1) |

## 5. Regressions
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (27232, 87 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library 745;
  llvm 627)`.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./scripts/lib/unit-steps.test.ts`: 343 pass,
  1 fail.
  - The failure is the expected one: `src/rustc_codegen_llvm/debuginfo/mod.test.ts`, "-Cdebuginfo=2:
    CodegenUnitDebugContext::new's module flags, then the IR model's LLVMCreateDIBuilder". It pins the old stop at :285.
  - Root must update it as the handoff says.
- Sample difftests: `RUST_TS_AGENT=rev-llir-di-7q`, `--sample 200 --jobs 6`, AC power.

| suite | MATCH | DIFF | UNPORTED | other | run |
|---|---|---|---|---|---|
| ir-run-pass | 193 | 0 | 7 | 0 | `20261115-005809-rev-llir-di-7q-mq9t` |
| ir-run-pass-o0 | 193 | 0 | 7 | 0 | `20261115-005905-rev-llir-di-7q-hxgx` |
| ir-host | 191 | 0 | 9 | 0 | `20261115-010005-rev-llir-di-7q-mo3i` |
| run-pass-native | 190 | 0 | 9 | 1 UNSTABLE | `20261115-010105-rev-llir-di-7q-ox3p` |
| ir-hello | 2 | 0 | 0 | 0 | `20261115-010213-rev-llir-di-7q-x4kf` |

**No non-MATCH case is in its suite's protected baseline,** so no protected case left MATCH. The stops are:
- `cg-di-b … TypeMap::default`: `bool-negation-with-debug-info.rs` and `issue-82833-slice-miscompile.rs`, both among the 24 gate
  cases, which agrees with the handoff;
- `llir: LLVMRustModuleCost`: fat LTO;
- `rustc_sanitizers` out of scope;
- cg-intrinsic-b's `simd_gather`;
- the aarch64 intrinsic table, on host suites;
- `hashmap-debug-format.rs`, UNSTABLE: the oracle is not reproducible, and the case is not protected.

## For root
- Update `src/rustc_codegen_llvm/debuginfo/mod.test.ts:285` (and its title at :268) as the handoff says.
- Pin the 11 LLVM files. The hashes in the handoff are verified above.
- Regenerate `ffi.ts` at integration if ir-fix-b or cg-asm also regenerate it.
- N3 belongs to ir-fix-b's file.
