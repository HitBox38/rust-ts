# Handoff: llir-core-b (plan-m7 wave 40, contract lane, second half of the IR model)

Branch `t3/implement-llir-core-b`, base `b3772ebb`. This lane touches only `src/rust_ts/llvm/` and this file.

## Result

- **Basic blocks, instructions and the builder are in the model.**
  - `inst.ts` holds `BasicBlock`, `Inst` (one class for LLVM's instruction classes), `OperandBundleDef`, `IRBuilder` (insertion
    point, `Insert`, every `Create*` rustc reaches), the memory-intrinsic declarations, and the printer of function bodies.
  - `fold.ts` holds the `ConstantFolder` and the `ConstantFold.cpp` / `Constants.cpp` rules it calls: binary operators, compares,
    select, extract/insertvalue, fneg, casts and GEPs.
  - `build.ts` exports the ffi.rs functions. It is listed in `impl_modules.ts`, and `ffi.ts` is regenerated.
- **Stub count: 243 before, 126 after** (117 implemented by this lane; 255 of 381 now implemented). Every `LLVMBuild*` rustc uses is
  implemented except `LLVMBuildCallBr` (asm goto). Also implemented:
  - blocks: append, parent, first block;
  - instructions: `LLVMIsAInstruction`, `LLVMGetOperand`, call conv, tail call / tail-call kind, volatile, ordering, weak,
    nuw/nsw/disjoint, `LLVMAddIncoming`, `LLVMAddCase`, `LLVMAddClause`, `LLVMSetCleanup`, `LLVMAddHandler`,
    `LLVMSetPersonalityFn`;
  - metadata: `LLVMSetMetadata` / `LLVMGetMetadata` on instructions;
  - operand bundles, `LLVMConstVector` (integer data vectors);
  - wrappers: `LLVMRustPositionBuilderAtStart` / `PastAllocas`, `LLVMRustBuildMemCpy` / `MemMove` / `MemSet`,
    `LLVMRustAddCallSiteAttributes`, the four fast-math setters, and `LLVMRustGetLastError`.
- **Changes to the first half:**
  - `LLVMSetAlignment` / `LLVMGetAlignment` on instructions;
  - `LLVMDeleteFunction` of a definition (`eraseFromParent` drops the body);
  - `stripPointerCasts` through instructions;
  - unnamed arguments of a definition print as slots;
  - `ConstantTokenNone` (`none`);
  - the printer's type finder walks bodies.
- **Proof**: seven new cases with function bodies (below) are recorded from the pinned rustc. Each replays with every answer
  checked and reaches the oracle IR's N1 normal form byte for byte. So do the four llir-core-a cases, whose committed scripts did
  not change.
- **C API differential test of the folds**: 6,976 expect() calls in `capi.oracle.test.ts` at first, plus 4,463 folds and 40
  vector bitcasts added at review (see Review fixes).
  - **Every case the model folds agrees with libLLVM.** The only stops are APFloat arithmetic on two doubles.
  - The test caught a real bug, now fixed: the undef rule of `ConstantFoldCompareInstruction` must use `ICmpInst::isEquality`.
    With `CmpInst::isEquality` instead, `fcmp oeq 0.0, undef` folded to `undef`, where LLVM gives `false`.

Commits: `45701877`, `2377d8ef`, `d6e7aec8` (docs, the replay place check, this file), `2f13c6f3`. Review fixes
(`docs/reviews/llir-core-b.md`, REQUEST CHANGES): `b99513d3` (F1), `29971ac7` (F2, F3), `c507f1c9` (N3–N6), and the commit of
this update.

## Review fixes (`docs/reviews/llir-core-b.md`)

- **F1, position inference.** `positionFor` (`replay.ts`) now infers `LLVMRustPositionBuilderAtStart` only in rustc's one
  pattern: `alloca` / `alloca_with_ty` (builder.rs:669, :681) create a builder, call `position_at_start` on the entry block, then
  `LLVMBuildAlloca`.
  - The builder must never have been positioned (`B.block === undefined`), the block must be its function's entry block, the
    place its first insertion point, and the call `LLVMBuildAlloca`. Anything else throws.
  - `LLVMRustPositionBuilderPastAllocas` is never inferred: its only callers are in gpu_offload.rs (:563, :615).
  - All 11 proof cases still pass under the strict rule.
  - The reviewer's M1 (`switch.script`, `LLVMPositionBuilderAtEnd(%34, %26)` deleted) and M2 (pointed at `%28`) are tests in
    `build.test.ts` that must fail replay. Mutation check: under the old `replay.ts` both were accepted; under the new one both
    throw "not in rustc's alloca pattern".
- **F2, vector all-ones.** In `ir.ts`:
  - `Constant.isAllOnesValue` has the vector arm of Constants.cpp:68, through `getSplatValue` (Constants.cpp:1846; ConstantVector
    :1887, ConstantDataVector :3505).
  - `getAllOnesValue` moved into `ir.ts` with its vector arm, `ConstantVector::getSplat` (:1602; `ConstantDataVector::getSplat`
    for integer data vectors).
  - `FoldBitCast` of an all-ones value folds to `getAllOnesValue(DestTy)`.
  - The other predicate, `isNullValue`, has no vector gap: it is LLVM's construction-time flag (Constant.h:64), and the model's
    vector constants that hold data are never all zero, because their getters collapse those to `zeroinitializer` as LLVM's do.
  - Porting this exposed a second gap. `ConstantFoldCastInstruction` stopped on every vector-to-vector cast. It now follows
    ConstantFold.cpp: only when element counts match, with the splat fast path through `foldMaybeUndesirableCast` (:156). A
    non-splat vector still stops.
  - The printer uses LLVM's `splat (<ty> <v>)` shorthand for data vectors.
  - `bitcast <2 x i32> <-1, -1> to i64` is now `i64 -1`, as in LLVM. The differential test covers 40 vector bitcasts, folded and
    unfolded, through the builder and `LLVMConstBitCast`.
- **F3, a plain `Error`.** `signBit` (the `ConstantFP::getZero` of FAdd's identity) stops with `unported` for a vector type.
  - A vector-typed `ConstantFP` splat is not in the model. LLVM folds `fadd <2 x float> undef, undef`; the model stops. The test
    asserts LLVM folds the three cases and the model throws `Unported`.
  - **Audit:** the remaining `throw new Error` in `fold.ts`, `inst.ts` and `build.ts` are LLVM's assertions, `llvm_unreachable`
    or crashes on invalid input: a value of the wrong kind (`unwrap<CallInst>` ...), an invalid predicate or cast opcode, an
    alloca without an insertion block, a null Twine. None is reachable from valid IR. The one reachable path the review found,
    `Type.fpBits()` on a vector, is now guarded at every caller in `fold.ts` and `inst.ts`.
- **N1, the APFloat stops**: listed below, for an APFloat lane.
- **N2**: added to PORT 6.
- **N3**: the fold differential test adds 4,463 comparisons, and all agree:
  - NSW/NUW add, sub and mul, and exact udiv/sdiv, next to the plain ops;
  - i8/i64/i128 with `ptrtoint(@g)` operands, inttoptr, intcast2;
  - GEPs with every no-wrap flag combination over global, struct-global, null, inttoptr, undef and poison bases, with i8, array
    and struct types;
  - ptrtoint and pointercast.

  The stops are asserted to be only the rules the model lacks. **Not done:** building the forms module a second time through
  libLLVM. That means writing each of ~60 calls twice against two signatures (C strings, raw arrays, numeric enums), or an
  interpreter of scripts for libLLVM. The forms module stays checked by hand-written lines plus the pinned `opt -passes=verify`.
  That is a candidate for the harness's typed interposer (llir-core-a N12).
- **N4**: comment fixed.
- **N5**: `getSwappedPredicate` has its marker (Instructions.cpp:3766), and `getXor` cites :2817.
- **N6**: at this pin `CreateIntCast` itself picks by scalar width (IRBuilder.h:2316-2321), not through
  `CastInst::getCastOpcode`, so the model follows it as written. A comment says so.

### Floating-point (APFloat) stops, for root to plan an APFloat lane

The model holds an FP constant's bits but has no APFloat arithmetic. These stops are reachable from rustc today. The first three
come early: at opt-level 0, rustc keeps SSA constants as operands. The reviewer recorded `let x = 5i64; x as f64` (a constant
`LLVMBuildSIToFP`) and `1.5f64 * 2.0` (a constant `LLVMBuildFMul`): LLVM folds both, and the model stops on the first.

| Stop (`llir: ...`) | Where | LLVM rule |
|---|---|---|
| `ConstantFoldBinaryInstruction FAdd/FSub/FMul/FDiv/FRem of two floating-point constants (APFloat arithmetic)` | fold.ts | ConstantFold.cpp:883 (`APFloat::add` ..., `mod`) |
| `ConstantFoldCastInstruction FPTrunc/FPExt/FPToUI/FPToSI/UIToFP/SIToFP (APFloat conversion)` | ir.ts | ConstantFold.cpp:229 on, the cast switch (`convert`, `convertToInteger`, `convertFromAPInt`) |
| `ConstantFoldCastInstruction of a cast of a cast` (`f as usize as u32`) | ir.ts | `foldConstantCastPair` / `CastInst::isEliminableCastPair`; not APFloat, but just as early |
| `ConstantFP::get(<type>, double) (APFloat conversion)` for half, bfloat, x86_fp80, fp128, ppc_fp128; `ConstantFP::get(float, NaN)` | ir.ts `getConstantFPOfDouble` | Constants.cpp:1108 |
| `comparing <type> constants (APFloat::compare)` for FP types other than double/float; `ConstantFP::getNaN(<type>)` | fold.ts | Instructions.cpp:3914, Constants.cpp:1149 |
| `the sign of a ppc_fp128 constant` | fold.ts | `APFloat::getZero` / `changeSign` of the double-double |
| vector-typed `ConstantFP` splats: `ConstantFP::getZero of a vector type`, `a floating-point vector splat`, `getNullValue of a vector of floats`, `ConstantFP::get of a vector type` | fold.ts, ir.ts | Constants.cpp:1122, :1167, :1602, :384 |

**IEEE double and float** cover nearly all of rustc's constants. JS gives their arithmetic and conversions exactly, but NaN
payloads and the `convert` status rules need APFloat's source.

## Evidence

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `RUST_TS_REQUIRE_PROBES=1 bun test src/rust_ts/llvm/`, 5 runs | **63 pass, 0 fail** each time; 1.96, 1.69, 1.72, 1.57, 1.57 s wall. After the review fixes: **68 pass, 0 fail** each time; 2.26, 1.73, 1.56, 1.57, 1.62 s; the 22 proof tests (11 oracle cases, 11 committed scripts) run, none skipped; marker check `llvm 354`, no ERROR; ffi check up to date; result.test 3/3 |
| that includes `proof.oracle.test.ts` | 22 pass: 11 oracle cases (record, recorder-transparency, script = committed, replay, wrapper sets, N1) + 11 committed-script replays; none skipped |
| `bun test ./src/std/result.test.ts` | 3 pass |
| `bun tools/llir/ffi_gen.ts --check` and `ffi.test.ts` (staleness) | "contract up to date: 381 fns, 33 enums, 4 bitflags"; ffi.test.ts passes |
| `bun scripts/coverage.ts --check --offline` | `markers ok (25797, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 735; llvm 347)`, no ERROR |
| `bun scripts/coverage.ts --crate llvm-wrapper` | 43/218 (RustWrapper.cpp 38/132); this lane added 12 wrapper markers |

All runs were on AC power with `RUSTC_ICE=0`, `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`. I did not touch the oracle
toolchain or `$RUST_TS_DATA/llvm-src/`. Recorder dylibs are cached in `$RUST_TS_DATA/llvm-record/` as before.

## Proof cases (`src/rust_ts/llvm/proof/`)

All seven use `--target x86_64-unknown-linux-gnu -Coverflow-checks=off --emit=llvm-ir -Cno-prepopulate-passes`.
`-Coverflow-checks=off` keeps `llvm.*.with.overflow` intrinsics out: `LLVMGetIntrinsicDeclaration` is a fill lane's.

| Case | What it covers | Calls replayed | Wrappers its inferred effects went through (besides the common three) |
|---|---|---|---|
| `arith` | add/sub/mul/shl/lshr/ashr/and/or/xor, sdiv with rustc's overflow check, fmul/fdiv/fsub/fadd, icmp/fcmp, trunc/zext/sext/fptrunc/fpext/sitofp/uitofp, branches, a panic call | 567 | AttrNoValue, UWTable, AddFunctionAttributes, GetOrInsertGlobal, **PositionBuilderAtStart**, AlignmentAttr, **AddCallSiteAttributes** |
| `phi` | `[x; 6]`: rustc's `write_operand_repeatedly` loop, a `phi`, GEP `inbounds nuw`, `icmp ne ptr` | 199 | defn three, AlignmentAttr, StructRetAttr |
| `switch` | `match` lowered to `switch` with four cases | 232 | defn three, PositionBuilderAtStart |
| `invoke` | `invoke`, `landingpad cleanup` and `filter`, `resume`, insertvalue/extractvalue, a personality, call-site `cold` / `noreturn nounwind` | 404 | defn three, AlignmentAttr, AddCallSiteAttributes, PositionBuilderAtStart |
| `atomic` | `atomicrmw add seq_cst`, `cmpxchg acq_rel acquire`, `store atomic release`, `fence seq_cst`, `load atomic volatile monotonic` | 210 | defn three |
| `memcpy` | a by-value `[u64; 8]`: `LLVMRustBuildMemCpy`, the `llvm.memcpy.p0.p0.i64` declaration | 138 | defn three, AlignmentAttr, StructRetAttr, **BuildMemCpy** |
| `byval` | a `#[repr(C)]` struct passed `byval` and returned `sret`; memset + memcpy | 293 | defn three, AlignmentAttr, StructRetAttr, ByValAttr, PositionBuilderAtStart, **BuildMemSet**, BuildMemCpy |

"Common three" are SetNormalizedTarget, SetModulePICLevel and AddModuleFlagU32. "Defn three" are AddFunctionAttributes,
CreateAttrNoValue and CreateUWTableAttr. Every case skips only `LLVMIsMultithreaded` and `LLVMDisposeTargetMachine`, and its only
stubbed effect is `LLVMRustSetDataLayoutFromTargetMachine`, as in llir-core-a. The test asserts the exact wrapper set per case.

## How the recorder and replay see bodies (for fill lanes)

The recorder (`record.ts`) gains three kinds of observation:

- **` @ %BB <next|end>` after each recorded `LLVMBuild*` call that returns an instruction in a block**: where the builder put it.
  Before each such call, replay checks that the model's builder would insert there.
  - If it would not, a hidden wrapper positioned the builder. Replay infers `LLVMRustPositionBuilderAtStart` only in rustc's
    `alloca` pattern (builder.rs:669, :681): a never-positioned builder, the entry block's first insertion point, and
    `LLVMBuildAlloca`. This is review F1.
  - `LLVMRustPositionBuilderPastAllocas` is never inferred; it is gpu_offload.rs's.
  - Anything else throws.
  - After the call, replay checks the instruction landed there.
- **`?inst %I %BB <next|end> <opcode> [operands] {<index>:[attributes]}`**: an instruction no recorded call returned.
  - rustc's only hidden instruction makers are the memory-intrinsic wrappers. Replay replays the matching one on the builder
    positioned at that place, decoding `MaybeAlign` from the `align` attribute lines and `IsVolatile` from the `#<n>` operand.
  - Replay binds the oracle's handles for the call, its intrinsic declaration (a pending `?function`) and its `align` attributes
    to the model's objects, then compares the attribute sets.
  - Any other opcode or callee throws.
- **`?csattrs %I <index> [%A...]`**: a known call's call-site attribute set changed. Replay plays it as
  `LLVMRustAddCallSiteAttributes`, rustc's one caller of which is llvm/mod.rs:61, and then checks the model's whole set equals the
  oracle's.
- **`?attr` lines are now recreated when first used.** An intrinsic declaration's attributes (`Intrinsic::getAttributes`:
  `nocallback`, `memory(argmem: ...)`, `immarg` ...) have no rustc creator and are supplied by the parser. Their `?attrs` lines
  are counted in `ReplayResult.intrinsicAttributeSets` and never applied.
- **Disposed builders and bundles have their handle retired**, like deleted globals. Without this, LLVM's address reuse made the
  next builder look under-uniqued.
- **The recorder now logs `LLVMAddIncoming`'s values array**: two arrays share one count. It logged `?` before.

Mutation checks I ran on the committed scripts:

| Mutation | Result |
|---|---|
| A `LLVMBuildXor` placed before the second instruction of its block | throws "the builder inserts where no rustc wrapper positions one" |
| A store "placed" in a non-block | throws "a recorded place that is not a block and an instruction" |
| A hidden call to `llvm.foo.p0` | throws |
| A hidden non-call instruction | throws |
| memcpy `align 8`→`4`, memcpy volatile, a `?csattrs` set with one attribute dropped | replays consistently with the mutated data; the N1 comparison against the oracle's IR decides |

### What a replay of bodies still cannot catch

1. **Which allocas went through `position_at_start`.** Within the alloca pattern, replay assumes the hidden wrapper ran. A model
   bug in `LLVMRustPositionBuilderAtStart` itself would show as a wrong instruction order, which the N1 comparison catches.
   Since review F1, a model bug in any recorded positioning call fails replay.
2. **Builder state the C API cannot read**: fast-math flags (`LLVMRustSetFastMath` and kin), `LLVMRustSetNoSanitize*`,
   `LLVMRustBuildVScale`, and inline asm.
3. **Hidden instructions other than the memory intrinsics** throw. That is correct today, but a new rustc wrapper would need a
   rule.
4. **Two builders positioned at the same place when a hidden memcpy runs.** Replay uses the first. The result is the same
   instruction either way.
5. **The order of attributes within one set.** Sets are compared as sets, and the C API gives LLVM's sorted order. This is the
   same as llir-core-a's item 3.
6. **Instruction metadata set by a wrapper** (none in rustc today besides `!dbg`, which is llir-di's).

## llir-core-a re-check nits

- **R1**: `replay(calls, upstream, { flagKeys })`. An integer `?flag` that matches no call-site table now throws unless the case
  names its key, meaning a `-Z llvm-module-flag` key or the target's small-data key. `build.test.ts` covers both outcomes.
- **R2**: the type finder visits attribute sets in `AttributeList` order: function, return, then each parameter
  (`attrListPos`).
- **R3**: `LLVMRustPrintModule(null)` (or `""`) now sets the last error to `No such file or directory`, which is `open("")`'s
  ENOENT, and returns `Failure`, as `raw_fd_ostream` does. `LLVMRustGetLastError` is implemented: it returns the error and clears
  it.
  - Another open failure stops `unported`, because Node does not expose the C library's strerror text.
  - `build.test.ts` covers this.
- **R4**: the committed-script test asserts `stubbedEffects ⊆ {LLVMRustSetDataLayoutFromTargetMachine}`.
- **R5**: the comment in `replay.ts` is corrected. A function-level `elementtype` is decodable, but rustc puts it only on call
  sites (abi.rs:754).
- **R6**: `Constant.destroyed` is set by `destroyConstant`. When a handle whose object was destroyed comes back as a new object,
  replay rebinds it. That is LLVM's address reuse after `handleOperandChange`. `build.test.ts` covers it with a RAUW that rebuilds
  a constant array.

## Every `unported(...)` left by this lane (all `llir: ...`)

**Folds (fold.ts)**:

- added at review: a non-splat vector cast (`ConstantExpr::getExtractElement` per element); vector splats other than integer data
  vectors (FP, pointer null, other elements, scalable): `ConstantVector::getSplat`; `ConstantFP::getZero` of a vector type (F3);

- `ConstantFoldBinaryInstruction` of two floating-point constants (APFloat arithmetic);
- folds of vectors: binary, unary, select with a vector condition, compares (a vector `i1` result),
  `getAllOnesValue` / `ConstantInt::get` of a vector;
- `extractelement`, `insertelement` and `shufflevector` of constant operands;
- `evaluateICmpRelation` of pointer constants: `areGlobalsPotentiallyEqual` needs `isInterposable` and `NullPointerIsDefined`;
- `and` of `ptrtoint(@global)` with a constant (needs the data layout's pointer alignment);
- comparing or NaN-making for FP types other than double and float;
- the sign of a `ppc_fp128`;
- `ConstantFoldInsertValueInstruction` of an array above 4096 elements.

**Instructions and builder (inst.ts, build.ts, core.ts)**:

- `LLVMGetAlignment` of an instruction whose alignment is the data layout's default (the model leaves it undefined; see PORT 2);
- a vector GEP instruction and a vector comparison instruction;
- an alloca address space in the data layout (`A`);
- `getMangledTypeStr` of other than pointer and integer types;
- an existing intrinsic declaration of another type (the `.invalid` rename);
- `Instruction::setMetadata(MD_dbg)` and `LLVMSetCurrentDebugLocation2` of a location (llir-di's);
- `LLVMGetOperand` of a metadata node;
- `ConstantVector::get` of other than integer data vectors;
- `LLVMRustPrintModule` open errors (R3).

**Stubs in this half's area, not needed by the proof**: `LLVMBuildCallBr`, `LLVMRustBuildVScale`, `LLVMRustGetElementTypeArgIndex`
(inline asm), `LLVMGetIntrinsicDeclaration` / `LLVMLookupIntrinsicID` / `LLVMIntrinsicIsOverloaded` /
`LLVMRustUpgradeIntrinsicFunction` / `LLVMRustIsTargetIntrinsic` (the intrinsic fill lane), `LLVMReplaceMDNodeOperandWith`, and
`LLVMRustSetNoSanitize*`. The other stubs are debuginfo, the driver, LTO, coverage and diagnostics.

## `// PORT:` decisions (for root to record)

1. **One `Inst` class** stands for LLVM's instruction classes. `opcode` is the printed opcode, and the other classes' fields are
   optional members. The operand layout follows LLVM where printing or RAUW reads it: a call's callee is last, an invoke's normal
   and unwind blocks come before it, and bundle inputs follow the arguments. Phi blocks are kept beside the operands, as LLVM
   does.
2. **The data layout's default alignments are not computed.** This applies to an instruction rustc does not give an alignment:
   alloca (preferred), load/store (ABI), cmpxchg/atomicrmw (store size).
   - The model leaves `align` undefined and the printer omits it.
   - LLParser fills in the same defaults IRBuilder uses (`parseAlloc`, `parseLoad`, `parseStore`, `parseCmpXchg`,
     `parseAtomicRMW`). So the normal form is the same; the `atomic` case shows it for `atomicrmw`/`cmpxchg`.
   - Reading such an alignment back (`LLVMGetAlignment`) stops.
3. **No `; preds = ...` comments**, and blocks are printed without padding. The normal form drops comments.
4. **Intrinsic declarations get no `Intrinsic::getAttributes`**, as in llir-core-a's PORT 5. Replay counts the oracle's
   `?attrs` for them in `intrinsicAttributeSets`.
5. **The memory intrinsics' types are taken from Intrinsics.td** (`int_memcpy`, `int_memmove`, `int_memset`), not from the
   generated IIT tables. Their names come from `getIntrinsicNameImpl` / `getMangledTypeStr` for pointer and integer overload
   types.
6. **Builder state rustc never sets is absent**: debug location, default FP math tag, fast-math flags, constrained FP and
   default operand bundles. Setting a debug location stops.
   - When llir-di adds debug locations, `SetInsertPoint(BB, IP)` must also copy `IP`'s debug location (IRBuilder.h:196-201).
   - `LLVMRustPositionBuilderAtStart` into a non-empty block goes through that path. `LLVMPositionBuilderAtEnd` and
     `SetInsertPointPastAllocas` do not (review N2).
7. **`LLVMGetFirstBasicBlock` and `LLVMGetInsertBlock` throw where LLVM returns null.** ffi.rs declares the results non-null.
8. **A call's `returned` argument is not followed by `stripPointerCasts`**: no creator of the model makes `returned`.
9. **`LLVMRustPrintModule(null)`'s last error is `No such file or directory`** (R3).

## Manifest

**Marked files outside `harness/llvm-manifest.json`: none.** All 354 `// llvm:` markers resolve.

**Read and cited in comments without a marker**: please add these so reviewers have the same files. I fetched them into my
scratchpad only, not into `$RUST_TS_DATA/llvm-src/`.

- `llvm/include/llvm/IR/Intrinsics.td`: `int_memcpy` (line 1147), `int_memmove` (:1168), `int_memset` (:1175), source of PORT 5.
- `llvm/lib/AsmParser/LLParser.cpp`: the default alignments of PORT 2 (lines 8955, 9007, 9056, 9104, 9256).
- `llvm/lib/IR/Instruction.cpp`: `getOpcodeName` (:819), `setHasNoUnsignedWrap` / `setHasNoSignedWrap` (:395, :402), `setFast`
  (:625).
- `llvm/include/llvm/IR/Instructions.h`: `ICmpInst::isEquality` (:1375), behind the fold fix.
- `llvm/include/llvm/IR/InstrTypes.h`: the `CmpInst::Predicate` values.
- `llvm/include/llvm/IR/IntrinsicInst.h`: `setDestAlignment` / `setSourceAlignment`.
- `llvm/include/llvm/Support/AtomicOrdering.h`: `toIRString`.
- `llvm/lib/IR/Operator.cpp`: `FastMathFlags::print` (:284).
- `llvm/include/llvm/IR/FMF.h`: the flag bits.
- `llvm/include/llvm/IR/Instruction.h`: `Instruction::isAssociative(unsigned)`, cited at `fold.ts:47` (review).

The wrapper markers point into `compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp` (lines 134, 411, 606, 620, 637, 644, 1372, 1383,
1395, 1403, 1408).

## Files

| File | Lines | What |
|---|---|---|
| `inst.ts` | 926 | new: blocks, instructions, IRBuilder, memory intrinsics, body printer, type-finder hook |
| `fold.ts` | 748 | new: ConstantFolder and the ConstantFold.cpp / Constants.cpp rules |
| `build.ts` | 670 | new: the ffi.rs functions of this half |
| `build.test.ts` | 287 | new: builder, instruction forms (verified by the pinned `opt`), R1/R3/R6 |
| `ir.ts`, `core.ts`, `printer.ts`, `handles.ts`, `impl_modules.ts` | | the hooks and changes listed above |
| `record.ts`, `replay.ts` | +64, +216 | body observation and replay (above) |
| `capi.oracle.test.ts`, `proof.oracle.test.ts`, `model.test.ts` | | fold differential test; 7 cases; one stop test moved to debuginfo |
| `proof/*.rs`, `proof/*.script` | | 7 new cases and their recorded scripts (~80 KB) |
| `ffi.ts` | | regenerated |

## Notes for root

- **Unit-time budget**: 1.6–2.0 s wall for the lane's five test files. That includes 22 rustc compiles (11 under the recorder) and
  22 `opt` runs.
- **`scripts/lib/llvm-trace.ts`** (harness): the port's `bind` trace classifies `LLVMBuild*` answers with `instanceof
  Instruction`. llir-core-b's `Inst` extends it, so the port side of the trace works for bodies too. llir-core-a's note about
  masking float `const` answers stands. LLVM also spells special values as `+qnan` / `-inf`, which the fold test normalises.
- **Fill lanes adding a hidden wrapper that makes instructions** (inline asm, `LLVMRustBuildVScale`, ...): add its rule to
  `replayHiddenInst` in `replay.ts`, with the rustc call site.
