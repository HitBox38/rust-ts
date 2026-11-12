# Review: lane `llir-folder` (wave 40o)

Reviewer: independent, read-only. Branch `t3/llir-folder-model`, commits `2ad24159`, `31a99361`, `f6e1966f`, `61ac3f6c`, `9e26af67`,
`7e500262`, `ef0d01b3`, against `main` at `ba273e7f` (`git diff ba273e7f..ef0d01b3`), merged into the review worktree.
Sources: LLVM at `aab11ee0ea5e` under `$RUST_TS_DATA/llvm-src/` (read-only); `RustWrapper.cpp` / `PassWrapper.cpp` from
`$RUST_TS_DATA/rust`. Six headers that are not in the manifest were fetched read-only into the scratchpad at the same commit to
check the lane's citations (item 9).

**Power: every command below ran on battery.** The brief said AC only. I waited about 30 minutes for AC, then root allowed the
review's unit tests on battery, since they are not timing-sensitive. No samples were taken.

## Verdict: **PASS WITH NOTES**

No must-fix findings. The ports follow their LLVM and wrapper functions, with markers, and the differential tests are real. Where
a path is not modelled it stops (`unported`) rather than guessing. The notes are fidelity gaps on paths rustc does not reach today,
test gaps, and one missing manifest file.

## Commands (review worktree, battery, `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`)

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p .` | exit 0, no output |
| `bun scripts/coverage.ts --check --offline` | `markers ok (26583, 46 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 744; llvm 429)` |
| `bun test ./scripts/lib/unit-steps.test.ts` | 10 pass, 0 fail |
| `bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts`, run 1 | 216 pass, 0 fail (12.41 s), no `SKIP` lines |
| the same, run 2 | 216 pass, 0 fail (11.87 s), no `SKIP` lines |
| `folder.oracle.test.ts -t 'llir-folder vs libLLVM'` | 10 pass (the file has 10 tests; the handoff says 11) |
| `proof.oracle.test.ts -t '(attrs\|callconv\|atomic)$'` | 6 pass, 0 fail |

## Checks

1. **`LLVMRustGetElementTypeArgIndex`** (`build.ts:628`). This is the three-case switch of RustWrapper.cpp:1668-1677, with the
   WRAPPER marker `// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1668`. `CB->getIntrinsicID()` is the callee's, or
   `not_intrinsic` for an indirect call (`F instanceof Function`).
   - **ARM name match.** I traced `lookupLLVMIntrinsicByName` (Intrinsics.cpp:677) and `lookupIntrinsicID` (:757) by hand.
     - `llvm.arm.ldrex.<sfx>`: the `.ldrex` component keeps `{ldrex, ldrexd}`, because `strncmp` over 6 bytes matches both. The
       next component empties the range, and `LastLow` stays on `ldrex`, which is overloaded, so the ID is `arm_ldrex`. A
       trailing `llvm.arm.ldrex.` gives `arm_ldrex` too.
     - `llvm.arm.ldrexd[.x]` resolves to `ldrexd`. That intrinsic is not overloaded and the name is not an exact match, so the
       answer is `not_intrinsic` or `ldrexd`, never `arm_ldrex`.
     - So `armExclusiveIntrinsic` (`intrinsics.ts:627`) is exact. IntrinsicsARM.td:283-293 at the pin has only `ldrex`/`strex`
       (anyptr) and `ldrexd`/`strexd` (not overloaded) with those prefixes.
   - **The libLLVM test is real.** It reads names with `LLVMIntrinsicGetName`, asserts the four-name set and more than 100 ARM
     names, and compares against `LLVMLookupIntrinsicID` on every ARM name and seven variants of each. See N1 for how the loop
     stops. The expectations for the wrapper itself (`[0, 1, -1, -1, 0, -1, -1]`) are hand-written. That is unavoidable, because
     the wrapper is in librustc_driver, not libLLVM, and they follow from the switch.
2. **Attributes.**
   - **`LLVMRustCreateRangeAttribute`** (`core.ts:1027`) calls `LLVMCreateConstantRangeAttribute(C, Attribute::Range, ...)`
     (RustWrapper.cpp:501-509). `core.ts:1034` follows Core.cpp:198: `divideCeil` words, `APInt` truncation, uniquing by value.
     It prints `range(i<N> <lo>, <hi>)`, signed through `operator<<` → `print(OS, true)` (APInt.h:2214), as Attributes.cpp:731
     does.
   - **DeadOnReturn.** `getWithDeadOnReturnInfo(C, DeadOnReturnInfo())` is `toIntValue()` = `UINT64_MAX` (Attributes.h:85-89,
     Attributes.cpp:291). It prints bare `dead_on_return`, and other values through `AttrWithBytesToString` (:592-596). That
     matches the wrapper's `LLVM_VERSION_GE(23, 0)` arm (RustWrapper.cpp:445).
   - **Sorted printing.** `attributeLess` (`ir.ts:1637`) is `AttributeComparator::operator()` (Attributes.cpp:2151): non-string
     before string, kinds by `AttrKind` value, keys bytewise. `addAttributesAtIndex` is `addAttributeImpl`'s `lower_bound` plus
     swap-or-insert (:2177-2190). This order is what `AttributeSetNode` stores and AsmWriter walks. Because `Attributes.inc`
     numbers the kinds enum, then type, then int, then range, "enum, then int, then string" follows from the kind values.
   - **Kind numbering.** `Attributes.inc` is generated, so it is not in the source checkout. The test re-reads every
     `ATTR_KIND_ENUM` entry with `LLVMGetEnumAttributeKindForName`. An unknown name maps to kind 0, so the test would fail, not
     pass silently. It also checks that every `ATTR_NAME` kind has a value. The shuffled-subset test compares whole module text
     over 24 functions and call sites, including replacement.
3. **Calling conventions.** `CALLING_CONV_NAMES` (`printer.ts:94`) is `printCallingConv`'s switch entry for entry
   (AsmWriter.cpp:349-430). That includes the `CC_VLS_CASE` range and the trailing spaces of `avr_intrcc ` and `avr_signalcc `.
   The default is `cc<N>` with no space. The test compares 0..1023 on declarations and 0..130 on calls against libLLVM.
4. **Atomic alignment.** This follows IRBuilder.h:1968/1981: `if (!Align) Align = llvm::Align(DL.getTypeStoreSize(Ty))`, with
   `BB->getDataLayout()`. The C API passes `MaybeAlign()` (Core.cpp:4536, :4559).
   - Pointer width comes from `getPointerSpec` (DataLayout.cpp:746), falling back to address space 0's spec, as LLVM does.
   - A type it does not model, or a size that is not a power of two, stops.
   - cg-builder's three expectations (`builder.test.ts:461,463,467`) changed **only** by appending `, align 4`, which is the
     oracle's text (`, align 4` on every atomic line). The `atomic` proof case's raw-text check now compares every oracle
     `atomicrmw`/`cmpxchg` line byte for byte.
5. **Folder.**
   - **extract/insert/shuffle.** `ConstantFoldExtractElementInstruction` (:373), `...InsertElement...` (:437) and
     `...ShuffleVector...` (:479) are line-by-line ports. The arms the model cannot build stop: a vector GEP constant expression,
     the extractelement/insertelement/shufflevector constant expressions that `ConstantExpr::get*` would create, and an
     insertelement CE operand that cannot arise. `FoldExtractElement`, `FoldInsertElement` and `FoldShuffleVector` follow
     ConstantFolder.h:148-172. The mixed `ConstantVector::get` now interns, which is `VectorConstants.getOrCreate`.
   - **`and (ptrtoint @g), C`** (ConstantFold.cpp:782-815) is exact, including the 4-byte FIXME default for functions and the
     `GV->getParent()` / `getAlign().valueOrOne()` split. `getPointerAlignment` (Value.cpp:993) is exact for functions and for
     aligned variables. It stops where LLVM needs `getPreferredAlign` or a non-integer `getABITypeAlign`; see N4 for one case where
     it stops although LLVM's answer is trivial. The int specs and the `getIntegerAlignment` lower_bound match DataLayout.cpp:180
     and :780.
   - **Pointer icmp**, read closely against ConstantFold.cpp:996-1132.
     - `areGlobalsPotentiallyEqual`: `isInterposable` (Globals.cpp:178, with `isNoipaFnDef` :401 and
       `getSemanticInterposition`, which stops if the flag exists), `hasGlobalUnnamedAddr`, `isSized`, `isEmptyTy`, and the alias
       exclusion.
     - `evaluateICmpRelation`: complexity swap with `getSwappedPredicate`; GV vs GV; GV vs null with external-weak, alias and
       `NullPointerIsDefined(nullptr, AS)` (true exactly when AS ≠ 0); GEP vs null (requires `isInBounds`, raw bit 1 of the
       model's GEP flags); GEP vs GV and GEP vs GEP through `hasAllZeroIndices`.
     - The predicate table in `constantFoldCompareInstruction` matches :1252-1320 arm for arm, including the partial ULE/SLE/
       UGE/SGE/NE arms.
     - BlockAddress arms are absent, and the model has no BlockAddress. **No guessed rules.**
     - The test covers 50 globals × 10 predicates, plus GEPs, null and addrspace(1). It compares each folded constant, then the
       whole function text, so a fold on one side only would surface as an extra or missing instruction.
   - **Vector icmp/fcmp/GEP.** `makeCmpResultType` (InstrTypes.h:1049) and `getGEPReturnType` (Instructions.h:1135) are exact.
   - **Inline asm.** `InlineAsm::get` keys on all seven fields (InlineAsm.cpp:43). Printing follows AsmWriter.cpp:2757-2773.
     `verify` runs only under `!NDEBUG`, which is correctly not modelled.
6. **Replay and recorder.**
   - **Bins with two contexts.** `ctxHint` is set from the function, call or block that first uses a pending attribute: the
     `?attrs` lines, `LLVMRustAddFunctionAttributes`/`CallSiteAttributes`, and `?inst`. It is reset in `finally`. Elsewhere it
     falls back to the old `modules[0]`. A wrong context there gives an over-uniquing throw in `bind`, not a silent pass.
   - **Attribute decoding.** captures 0/0x33/0x77, `allocsize` `n<<32|0xFFFFFFFF`, `allockind` 1..63, range and
     `dead_on_return` `UINT64_MAX` are each pinned by libLLVM printing in `folder.oracle.test.ts`. Any other value throws.
   - **First-seen out-params** are `bind`-ed with the same under- and over-uniquing checks as returned handles. This proves the
     same thing returned handles do.
   - **Folded builder calls.** The positioning and place check are skipped only when the returned handle is already bound. The
     answer is still `bind`-checked. A model that inserts where the oracle folded returns a new object and throws, and a builder
     that drifted is caught at its next real insertion. This does not weaken what replay proves.
   - **`LLVMCreateConstantRangeAttribute` interposition** logs no call, only the value. Widths over 128 bits get no value, and
     replay then throws (`n === undefined`). See N2 for a stale-entry case.
   - **Quadratic lookups.** The `rg()` lookup is linear like `find()`. Comment only: a hash table in the generated C would fix both
     lookups, and the committed scripts are unchanged either way.
7. **`abi_consts.test.ts`** (outside the brief).
   - `STOPS_O1 = {}` now makes `expect(stops).toEqual(STOPS_O1)` stricter. -O1 now compares 26 signatures, `r_char`, `r_slice`
     and `r_big` included, each `ours.get(n)` against `oracle.get(n)` from `oracle_ir` (the pinned rustc).
   - The call-site test now expects no stops. Nothing else changed in the file. See N6 for an older gap in that test.
8. **Tests.**
   - `folder.oracle.test.ts` is a real differential test. It `dlopen`s the oracle's `libLLVM.dylib`. Under
     `RUST_TS_REQUIRE_PROBES=1` the `describe` is not skipped (`skipIf(!HAVE && !REQUIRE)`), `lib` is undefined, and every test
     throws, so it fails, and it also prints `ERROR:`.
   - The `attrs` and `callconv` proof cases are recorded live from the pinned rustc on every run, and each recording is asserted
     equal to the committed `.script`. So the committed scripts are the pinned rustc's.
   - The raw-text checks are sound. They mask only `#N` and `!guid`, and they assert that the matched-line count is non-zero.
   - `unit-steps.test.ts`: 10 pass.
9. **Manifest.** I fetched the five files the lane lists at `aab11ee0` and checked each citation:
   - Attributes.h:65-89 (`DeadOnReturnInfo`)
   - IntrinsicsARM.td:283-293
   - CallingConv.h
   - APInt.h:2214
   - ConstantRange.cpp:57

   All are correct and should be added. The list is incomplete: see N3.
10. **Root notes.**
    - **The normal-form gap is real.** PassWrapper.cpp:992-997 adds `CanonicalizeAliasesPass`, `NameAnonGlobalPass` and
      `AssignGUIDPass` together under `NeedThinLTOBufferPasses`, so any oracle `.ll` that carries `!guid` has also been through
      name-anon-globals. N1 runs only `assign-guid,verify` (`scripts/lib/ir-normal.ts:58`).
    - I confirmed it with the pinned rustc on a 1-line `vec!`/`println!` bin (`--target x86_64-unknown-linux-gnu
      -Ccodegen-units=1 --emit=llvm-ir`): the output has `@anon.7eaf8e71f513ed6a5a5b0674c571552d.0 = private unnamed_addr
      constant ...` and 32 `!guid`. The model's pre-pipeline text would print `@0` there.
    - Either the port's pipeline runs name-anon-globals (D8), or N1 adds the pass on both sides. The second is a `harness/`
      change and needs its own reviewed batch.
    - **Recorder speed**: agreed, see item 6. It does not affect correctness.

## Findings

No F findings.

- **N1** `src/rust_ts/llvm/folder.oracle.test.ts:665`. The loop that reads the ARM names calls `LLVMIntrinsicGetName(id)` for ids
  up to 20000, past `num_intrinsics`. `Intrinsic::getName` (Intrinsics.cpp, `getBaseName`) only asserts `id < num_intrinsics`
  and then indexes `IntrinsicNameOffsetTable` out of bounds in a release dylib. The loop ends on whatever garbage follows. It
  works today, but it is undefined behaviour and could crash or pick up junk on a rebuild. Stop the loop once names leave the
  `llvm.arm.` block (the table is sorted by target), or bound it by an ID known to be valid.
- **N2** `src/rust_ts/llvm/record.ts:320`. `wrg` records a range only `if (!rg(r))`, and entries are never forgotten. If an
  attribute's address is reused after `LLVMContextDispose`, for example by a later CGU's context, the old range is logged for the
  new attribute. Overwriting is always correct, because one pointer within a live context has one value. This would give a false
  difference at N1, never a false pass.
- **N3** `docs/handoff/llir-folder.md`, "Manifest". Add `llvm/include/llvm/IR/DataLayout.h` too: `inst.ts`'s `getTypeStoreSize`
  cites it, and it was not listed. `llvm/include/llvm/IR/Operator.h` would also help, since `GEPOperator::hasAllZeroIndices` and
  `isInBounds` are ported (unmarked) in `fold.ts:765` and `fold.ts:807`.
- **N4** `src/rust_ts/llvm/fold.ts:241-263`. `getPointerAlignment` of an unaligned variable whose type is unsized (for example an
  opaque struct declaration) stops, but LLVM's answer is `Alignment.valueOrOne()` = 1, because the `isSized()` guard is skipped
  (Value.cpp:1005). Porting the guard is one line, `if (!isSized(ObjectType)) return 1`. It is conservative today, not wrong.
- **N5** `src/rust_ts/llvm/fold.ts:707-719`. Two helpers are not exact ports.
  - `isSized` has no marker and leaves out `StructType::isSized`'s scalable rule (Type.cpp:722-750): a struct that contains a
    scalable vector is unsized unless it holds only scalable vectors of one type. The model calls such a struct sized. It should
    stop on scalable elements.
  - `isEmptyTy` (Type.cpp:180) truncates `getNumElements()` to `unsigned`, so LLVM treats `[k·2³² x T]` as empty, but the model
    compares the full `0n`. That case is only reachable with a ≥4 GiB global, but the port should copy the truncation or stop.
- **N6** `src/rustc_codegen_llvm/abi_consts.test.ts:376-379` (cg-abi-consts' test). This gap predates the lane and the lane did not
  loosen it. The call-site loop compares only the call lines the model printed. Nothing asserts that all 7 callees appear in the
  model's text, as the oracle side asserts at :351. Now that no call stops, the owner could add that assertion.
- **N7** `src/rust_ts/llvm/folder.oracle.test.ts:584-585`. Only inbounds GEPs are tested, so the `isInBounds()` condition of the
  GEP-vs-null arm (`fold.ts:807`) is never exercised in its false direction. Add one GEP without flags.
- **N8** `docs/handoff/llir-folder.md`, "Evidence". The handoff says `folder.oracle.test.ts` has 11 tests. It has 10, and 10 run.

## For root

- Record the lane's five PORT decisions. I agree with all five.
- The N1 normal-form gap (item 10) is real and affects every bin that has an unnamed global. It needs a decision: D8's pipeline,
  or a reviewed `harness/` batch.
