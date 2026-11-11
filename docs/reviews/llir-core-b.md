REQUEST CHANGES

# Review: llir-core-b (M7 contract lane, second half of the IR model)

Branch `t3/implement-llir-core-b`, commits `45701877`, `2377d8ef`, `d6e7aec8`, `2f13c6f3`. I reviewed
`git diff b3772ebb...2f13c6f3` against:

- LLVM in `$RUST_TS_DATA/llvm-src/aab11ee0…/`;
- rustc and its wrappers in `$RUST_TS_DATA/rust` at `6f5da406b56`;
- the context docs: llir-core-a's handoff, review and re-check, plan-m7 §1b, and review plan-m7 F6.

Everything ran on AC power, with `RUSTC_ICE=0`, `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`. I did not touch the
oracle toolchain or `llvm-src/`.

A subagent also read `fold.ts` against `ConstantFold.cpp` / `Constants.cpp` / `ConstantFolder.h` / `IRBuilder.h`. I
reproduced every claim of its that this review relies on.

**Summary.**

- **The model is close to LLVM.** Builder, instruction forms, printer and C API wrappers match the LLVM sources wherever I read
  them. The default-alignment decision is safe (§2). All 11 proof cases and two cases of my own reach the oracle's normal
  form. 5,303 extra fold comparisons against `libLLVM.dylib` agree.
- **Three things must change, each a few lines:**
  - **F1:** replay's position inference can hide a model bug in builder positioning. Two mutations pass replay, N1 and the
    wrapper-set check.
  - **F2:** one vector bitcast fold gives a wrong answer silently.
  - **F3:** FP-vector `fadd` folds throw a plain `Error` instead of stopping.

## What I ran

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` (lane) | clean |
| `bun test src/rust_ts/llvm/` ×5 | **63 pass, 0 fail** each run, no skips; 2.00, 1.60, 1.68, 1.61, 1.69 s |
| `bun test ./src/std/result.test.ts` | 3 pass |
| `bun scripts/coverage.ts --check --offline` | `markers ok (25797, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 735; llvm 347)` |
| `bun tools/llir/ffi_gen.ts --check`; `ffi.test.ts` | `contract up to date: 381 fns, 33 enums, 4 bitflags`; 4 pass |
| `coverage.ts --crate llvm-wrapper` | 43/218, as the handoff says |
| Stub count in `ffi.ts` | 243 at `b3772ebb`, **126** now. Every `LLVMBuild*` in ffi.rs is implemented except `LLVMBuildCallBr` |
| The 11 committed scripts, replayed by my own driver | statics 483/31, decls 287/21, host 306/20, pic 146/12: llir-core-a's numbers, unchanged. arith 567, phi 199, switch 232, invoke 404, atomic 210, memcpy 138, byval 293 calls: the handoff's numbers. `inferredBy` as in its table |
| The 7 new cases recompiled with the pinned rustc; the model's IR against the oracle's | N1 match (e.g. byval) |
| **Own case 1** `dropmatch.rs`: `match` on an enum with a `Drop` field and a `Drop` local, `extern "C-unwind"` calls | recorder transparent; 643 calls replayed, 43 inferred (`AddCallSiteAttributes` 8, `PositionBuilderAtStart` 5); **N1 MATCH**. The IR has a `switch`, 3 `invoke`s, 2 `landingpad cleanup` and `resume` |
| **Own case 2** `mix.rs` (`-Cdebug-assertions=off`): `intrinsics::copy`, `compare_exchange_weak` (15 ordering pairs), `volatile_store`, `atomic_xchg` AcqRel | 1720 replayed; `LLVMRustBuildMemMove` inferred; **N1 MATCH** |
| Lane's fold test (`capi.oracle.test.ts`) | passes; it is part of the 63 |
| **Extra fold comparison against `libLLVM.dylib`** (scratch test, not committed) | **5,303 constant answers and 452 instruction answers agree.** Covered: flagged ops (NSW/NUW add, sub and mul; exact udiv and sdiv) and plain ops at i8/i64 with `ptrtoint(@g)` operands; i128; `LLVMBuildGEPWithNoWrapFlags` with flags 0/1/2/4/5/6 over `@g`, `@h` (struct), `null`, `inttoptr`, undef and poison bases, with i8, array and struct types; GEP of a constant GEP; ptrtoint, inttoptr, bitcast, pointercast, intcast2, trunc, zext, sext; float fcmp. 150 stops (below) and **4 wrong answers: F2 and F3** |
| 14 script mutations | §3 |
| Trial merge with `integ-w52` (`a852aef2`), `--no-commit`, aborted | clean merge; tsc clean; 63/63 lane tests; `markers ok (25800, …)`; ffi check up to date; result.test 3/3 |
| Trial merge with `t3/llvm-codegen-contract` (`b5c3e429`), aborted | clean merge; **tsc clean**, so cg-contract's uses of `ffi.ts` type-check against the new `Builder` / `BasicBlock` / `OperandBundle` classes; 63/63 plus cg-contract's 35/35; `markers ok (25908, …)` |
| Three-way merge of lane, `integ-w52` and cg-contract (octopus), aborted | tsc: 2 errors, `PointerAuthSchema` not exported (`rustc_codegen_llvm/common.ts:11`, `context.ts:37`). **This is not the lane's:** `integ-w52` plus cg-contract alone give the same 2 errors. `fixers-52` (`fcf84a2b`) made `PointerAuthSchema` module-local in `rustc_codegen_ssa/traits/misc.ts`. Root should fix it when it integrates cg-contract |

## 1. Fidelity to LLVM

**Builder (inst.ts, against `IRBuilder.h` / `IRBuilder.cpp` at the pin):**

- The calls that fold match LLVM:
  - `CreateAdd/Sub/Mul/Shl` go through `FoldNoWrapBinOp`;
  - `UDiv/SDiv/LShr/AShr` go through `FoldExactBinOp`;
  - `And/Or/Xor/URem/SRem` and the FP operations go through `FoldBinOp`, with no early returns at this pin (IRBuilder.h:1570, :1592, :1622);
  - also `FNeg`, `CreateCast` (same-type early return, then fold), `CreatePointerCast` (a constant goes to `getPointerCast`),
    `ICmp`, `FCmpHelper`, `SelectFMF`, `GEP`, `Extract/InsertValue`, `Extract/InsertElement` and `ShuffleVector`.
- The calls that never fold match too: alloca, load, store, fence, the atomics, phi, call, invoke, va_arg, landingpad and the
  pads.
- `CreateMemTransferInst` (:296) and `CreateMemSet` (:251) use `CreateIntrinsicWithoutFolding` and `MaybeAlign` →
  `setDest/SourceAlignment`, as in the model.
- `LLVMRustPositionBuilderAtStart` / `PastAllocas` match RustWrapper.cpp:1403/:1408 and `SetInsertPointPastAllocas`.

**C API (`build.ts`, against Core.cpp):** I checked `LLVMSetVolatile`, `LLVMSetOrdering` (load, fence, rmw, else store),
`LLVMBuildLandingPad` (personality moves to the function), `LLVMBuildCleanupPad` / `CatchSwitch` (null parent → `none`),
`LLVMSetMetadata` (`extractMDNode`) and `Instruction::setMetadata` (dbg special case → stop),
`mapFromLLVMGEPNoWrapFlags` (inbounds = InBounds|NUSW), `LLVMBuildAtomicRMW` / `CmpXchg` (`MaybeAlign()`, sync scope),
`LLVMGetAlignment` / `SetAlignment` on instructions, and `LLVMDeleteFunction` of a definition (`Function::dropAllReferences`).
All faithful.

**Wrappers:** `AddAttributes` (RustWrapper.cpp:388) is `addAttributesAtIndex`, where a later attribute of the same kind replaces
an earlier one; the model does the same. The four fast-math setters match :606–:648. Rustc calls them only on FP operations, so the
missing `isa<FPMathOperator>` guard does not matter. `LLVMRustGetLastError` matches :134.

**Printer (against AsmWriter.cpp):** these match:

- `writeOptimizationInfo`: FMF first, then nuw/nsw, exact, disjoint, inbounds or nusw, nuw, nneg, trunc flags;
- `atomic` / `weak` / `volatile` placement, `writeAtomic`, cmpxchg's two orderings;
- landingpad clauses (`isCatch` = not an array), catchswitch, funclet pads, catchret, cleanupret;
- alloca's array-size rule, `PrintAllTypes`;
- `maybePrintCallAddrSpace`, the call/invoke layout with bundles before `to … unwind`, the musttail `...`;
- phi, switch, slot numbering (unnamed args, blocks, non-void instructions), and the type finder's body walk.

**Folds:** the subagent compared `fold.ts` with ConstantFold.cpp:637–993 and Constants.cpp line by line. It found it faithful:

- identity, absorber, poison and the undef table;
- div/rem by 0 or 1, sdiv INT_MIN/-1, shifts ≥ width;
- the associative re-fold, and the i1 rules;
- only Add/Sub/Xor become constant expressions (`isDesirableBinOp`), with flags kept only then;
- compares with `ICmpInst::isEquality`;
- select, extractvalue, insertvalue, fneg;
- GEP no-op and undef rules, with the no-wrap flags passed through raw.

My libLLVM comparison above backs this up for the non-vector cases. The stops are correct stops. Each of them is a rule LLVM
has and the model does not:

- `ptrtoint(@g)` AND a constant: 16;
- a cast of a cast: 16;
- APFloat int↔FP conversions: 48;
- pointer `icmp`: 56;
- FP and pointer vector splats: 10;
- vector binops: 2;
- an all-ones scalar bitcast: 2.

The exceptions are F2 and F3.

## 2. The default-alignment decision: safe, and no fill lane is blocked

- **Only cmpxchg and atomicrmw take the default.** Every `LLVMBuildAlloca` / `LLVMBuildLoad2` / `LLVMBuildStore` in rustc is
  followed at once by `LLVMSetAlignment`: builder.rs:144-145, 179-180, 187-188, 672-673, 685-686, 693-695, 717-724, 886-889 and
  948-955. `volatile_load` goes through `load` (:702). So no alloca, load or store ever prints without an explicit `align`. The
  two that take IRBuilder's default are `LLVMBuildAtomicCmpXchg` (:1391) and `LLVMBuildAtomicRMW` (:1419): the store size of
  the value (IRBuilder.h:1974, :1988), which LLParser's default reproduces.
  - The `atomic` case shows it.
  - My `mix.rs` shows it for 15 `cmpxchg weak` ordering pairs and `atomicrmw xchg acq_rel`, all N1 MATCH.
  - `va_arg` has no alignment.
- **Rustc never reads an instruction's alignment back.** It calls `LLVMGetAlignment` only on globals (consts.rs:335,
  intrinsic.rs:683). No wrapper reads one.
- **The other alignments come from rustc.** A GEP-derived `!align` is rustc's own metadata (`LLVMSetMetadata`). The memcpy,
  memmove and memset `align` attributes are explicit `MaybeAlign` values.
- **So no oracle normal form depends on an omitted alignment, and the `LLVMGetAlignment` stop is unreachable from rustc.**
- **One dependency remains:** the parser fills the default from the printed datalayout. That datalayout is still the stubbed
  `LLVMRustSetDataLayoutFromTargetMachine` effect, which belongs to a driver lane.

## 3. Replay soundness

**Hidden memory intrinsics:**

- They are attributed from observation:
  - the opcode must be `call` (45), the callee must be `llvm.mem{cpy,move,set}.*`, and the builder must be at the recorded place;
  - destination and source are operands 0 and 1, and the size type is operand 2's type;
  - volatile comes from the `#n` operand;
  - the alignments are decoded from the call-site attributes at indices 1 and 2 (parameters 0 and 1, the recorder's `j-1`
    mapping).
- These match `LLVMRustBuildMemCpy/MemMove/MemSet` (RustWrapper.cpp:1372–1401).
- `LLVMRustBuildVScale` is the only other wrapper that makes an instruction, and it is a stub. My `mix.rs` adds a correctly
  attributed `LLVMRustBuildMemMove`.

**Mutations of committed scripts (my driver, compared against the recompiled oracle IR):**

| # | Mutation | Replay | N1 |
|---|---|---|---|
| M1 | switch.script: delete `LLVMPositionBuilderAtEnd(%34, %26)` (line 172) | **OK** | **MATCH** |
| M2 | switch.script:172: position at `%28` instead of `%26` | **OK** | **MATCH** |
| M3 | switch.script:183: the `br` recorded `@ %26 %37` (before the store) | OK | DIFFER |
| M4 | switch.script:180: the store recorded in another empty block | OK | DIFFER |
| M5 | memcpy `?inst` volatile `#0`→`#1` | OK | DIFFER |
| M6 | memcpy `?inst` opcode 45→34 | **fails** ("an instruction (opcode 34) made by a hidden wrapper") | |
| M7 | memcpy `?inst`, the destination `align` dropped | OK (decodes MaybeAlign 0) | DIFFER |
| M8 | memcpy `?inst`, destination and source swapped | OK | DIFFER |
| M9 | arith: one `?csattrs` deleted | OK | DIFFER |
| M10 | byval `?inst` callee replaced by a non-intrinsic | **fails** | |

M3–M5 and M7–M9 mutate the oracle's own data, and N1 decides them, as the handoff says. **M1 and M2 are F1.**

## Findings

### F1. Replay's position inference hides builder-positioning bugs in the model

`replay.ts:439-451` (`positionFor`). When the model's builder is not where the oracle inserted, replay infers
`LLVMRustPositionBuilderAtStart` whenever the recorded place is *any* block's first insertion point. It does this for any
builder and any `LLVMBuild*` call.

**Failing scenario (M1, M2).**

- The model's `LLVMPositionBuilderAtEnd` is a no-op (M1), or puts a fresh builder in the wrong block (M2). The next
  instruction goes into a still-empty block.
- Replay "repairs" the position with an inferred `PositionBuilderAtStart`. The model's IR then equals the oracle's, so N1 matches.
- `switch` already expects `PositionBuilderAtStart` in its wrapper set (`proof.oracle.test.ts:99`, `:116`), and counts are not
  compared, so the proof passes.
- **So the proof does not show that the model positions builders the way LLVM does.** This holds for every case whose wrapper
  set includes `PositionBuilderAtStart`: arith, switch, invoke, byval.

Rustc has exactly two callers of `position_at_start` (builder.rs:1636). Both are `alloca` / `alloca_with_ty`
(builder.rs:669, :681), which do:

1. `Builder::with_cx` (a recorded `LLVMCreateBuilderInContext`);
2. `position_at_start(LLVMGetFirstBasicBlock(llfn))`;
3. `LLVMBuildAlloca`.

**Fix.** Infer `PositionBuilderAtStart` only when all of these hold:

- the builder has not been positioned since it was created (`B.block === undefined`);
- the block is its function's entry block;
- the call is `LLVMBuildAlloca`.

`LLVMRustPositionBuilderPastAllocas`'s only callers are in gpu_offload.rs (:563, :615), and offload is out of scope. Its
inference should throw, or at least require a builder that was never positioned.

Add M1 and M2 as failing replays in `build.test.ts`. Optionally, compare `inferredBy` counts in the proof.

### F2. `bitcast` of an all-ones integer vector to a scalar folds to the wrong constant

`ir.ts:459` (`Constant.isAllOnesValue` returns false for `ConstantDataSequential` / `ConstantVector`) and `ir.ts:837-840`
(`foldBitCast`). `fold.ts:742` reaches them through `foldCast`, so `LLVMBuildBitCast` and `LLVMConstBitCast` do too.

- In LLVM, `Constant::isAllOnesValue` (Constants.cpp:68) is true for a vector whose splat value is all ones, and `FoldBitCast`
  (ConstantFold.cpp:67) returns `getAllOnesValue(DestTy)`.
- In the model, `isAllOnesValue` is false, `foldBitCast` returns undefined, and a constant expression is interned.

**Evidence** (scratch libLLVM test): `LLVMBuildBitCast(<2 x i32> <i32 -1, i32 -1>, i64)`. The model gives
`i64 bitcast (<2 x i32> <i32 -1, i32 -1> to i64)`; LLVM gives `i64 -1`. This is a wrong answer where the contract requires a
fold or a stop.

**Fix.** Port the vector arm of `isAllOnesValue`: `getSplatValue()` is all ones, for both `ConstantDataSequential` and
`ConstantVector`. With that, the existing stop at `ir.ts:840` catches the case. Folding to `getAllOnesValue(destTy)` for a
scalar integer destination would be better still. Add the case to `capi.oracle.test.ts`.

### F3. FP-vector `fadd` throws a plain `Error` instead of `unported`

`fold.ts:105-107` (`signBit`), called from `getBinOpIdentity`'s FAdd arm (`fold.ts:131`), calls `ty.fpBits()` on a vector type.
`ir.ts:110` then throws `Error("llir: Vector is not a floating-point type")`.

**Evidence:** these throw that plain `Error`:

- `LLVMBuildFAdd(undef <2 x float>, undef <2 x float>)`;
- the same with a `poison` LHS;
- `<2 x double> undef, undef`.

LLVM folds each one to a constant (`ConstantFP::getZero(Ty, …)` handles vectors, Constants.cpp:2866). The model reports an
ICE, not UNPORTED, and the harness misclassifies it. FSub, FMul, FDiv and FRem already stop correctly
("ConstantFP::get of a vector type", "ConstantFoldBinaryInstruction of vectors").

**Fix.** Make `signBit` stop with `unported` for a vector type, or guard the FAdd arm.

## Nits

- **N1. Stops the handoff's `unported` list leaves out.** This lane's builder casts now reach these `ir.ts` stops:
  - int↔FP conversions of constants (`ConstantFoldCastInstruction SIToFP/UIToFP/FPToSI/FPToUI/FPTrunc/FPExt (APFloat
    conversion)`, `ir.ts:879`);
  - a cast of a cast (`ir.ts:870`);
  - `FoldBitCast` of an all-ones scalar (`ir.ts:840`);
  - `ConstantFP::get` of a vector.

  Two of these come early. At opt-level 0, rustc keeps SSA constants as operands. I recorded `let x = 5i64; x as f64` and
  `1.5f64 * 2.0`: LLVM folds `LLVMBuildSIToFP` and `LLVMBuildFMul` of constants (no ` @ ` place), and **the model stops on the
  first one**. A cast of a cast is common in `f as usize as u32`. So IEEE double/float APFloat arithmetic and conversions
  belong near the top of the fill queue. They are stops, not guesses.
- **N2. `SetInsertPoint(BB, IP)` copies `IP`'s debug location** (IRBuilder.h:196-201). `LLVMRustPositionBuilderAtStart` into a
  block that already holds instructions does this; `LLVMPositionBuilderAtEnd` and `SetInsertPointPastAllocas` do not. The
  model has no debug locations, so nothing changes today. llir-di must add it. Mention it in PORT 6.
- **N3. The forms module is checked against hand-written lines** (`build.test.ts:96-250`), plus `opt -passes=verify`. Building
  the same module through libLLVM, as `capi.oracle.test.ts` already does for folds, would check the funclet, bundle,
  metadata and flag forms against LLVM itself rather than the author's reading. That is review plan-m7 F6's point. Also extend
  the fold comparison to the areas my scratch test covered: flagged ops, GEPs with flags and bases, the other casts, i64/i128.
- **N4.** `inst.ts:373-376`: the docblock says `CreateOr (IsDisjoint)`, but `createBinOp` takes no disjoint flag. It is set
  later by `LLVMSetIsDisjoint`, which matches the C API, so only the comment is wrong.
- **N5.** `fold.ts:61` `getSwappedPredicate` has no marker; it follows Instructions.cpp:3766, which is in the manifest.
  `fold.ts:200` cites Constants.cpp:2797 for `getXor`; that line is `getNot`, and `getXor` is at :2817.
- **N6.** `inst.ts:491-495` `createIntCast` picks trunc/sext/zext by width instead of `CastInst::getCastOpcode`, which also
  handles pointer and FP operands and equal widths. Rustc's `intcast` only passes integers, so this is harmless; a
  `// PORT:` line would say so.

## Manifest (`bun scripts/llvm-src.ts add …`)

The handoff's nine files, cited in comments but not pinned:

1. `llvm/include/llvm/IR/Intrinsics.td` (`int_memcpy` / `int_memmove` / `int_memset`, PORT 5)
2. `llvm/lib/AsmParser/LLParser.cpp` (the default alignments of PORT 2)
3. `llvm/lib/IR/Instruction.cpp` (`getOpcodeName`, `setHasNoUnsignedWrap` / `setHasNoSignedWrap`, `setFast`)
4. `llvm/include/llvm/IR/Instructions.h` (`ICmpInst::isEquality`, behind the fold fix)
5. `llvm/include/llvm/IR/InstrTypes.h` (`CmpInst::Predicate`)
6. `llvm/include/llvm/IR/IntrinsicInst.h` (`setDestAlignment` / `setSourceAlignment`)
7. `llvm/include/llvm/Support/AtomicOrdering.h` (`toIRString`)
8. `llvm/lib/IR/Operator.cpp` (`FastMathFlags::print`)
9. `llvm/include/llvm/IR/FMF.h` (the flag bits)

One more, cited at `fold.ts:47`: `llvm/include/llvm/IR/Instruction.h` (`Instruction::isAssociative(unsigned)`).

`isEquality`'s eq/ne-only reading could not be checked against source (file 4). It rests on the lane's libLLVM test, which my
fcmp cases confirm.

## llir-core-a's re-check nits R1–R6

All are fixed as the handoff says:

- R1: `flagKeys`, `replay.ts:637`;
- R2: `attrListPos`, `printer.ts`;
- R3: `LLVMRustPrintModule(null)` → ENOENT text, `Failure`; `LLVMRustGetLastError` clears;
- R4: `proof.oracle.test.ts:115`;
- R5: the comment;
- R6: `destroyed` rebinding in `bind`.

`build.test.ts` covers R1, R3 and R6.

## For root

- Record PORT decisions 1–9. PORT 2 holds, per §2.
- After F1–F3, a re-check need only look at `replay.ts`, `ir.ts` / `fold.ts`, and the new tests.
- The `integ-w52` + cg-contract `PointerAuthSchema` break is independent of this lane.
