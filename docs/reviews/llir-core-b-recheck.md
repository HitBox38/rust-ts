APPROVE WITH NITS

# Re-check: llir-core-b review fixes (M7 contract lane)

Branch `t3/implement-llir-core-b`. I reviewed `git diff 2f13c6f3..e5a23dac`: commits `b99513d3` (F1), `29971ac7` (F2, F3),
`c507f1c9` (N3–N6) and `e5a23dac` (handoff). I checked it against the first review, `docs/reviews/llir-core-b.md` on
`t3/review-llir-core-b` (`7ff520a8`), and against these sources:

- rustc at `6f5da406b56`;
- LLVM in `$RUST_TS_DATA/llvm-src/aab11ee0…/`. `ConstantFold.cpp`'s SHA-256 matches `harness/llvm-manifest.json`.

Everything ran on AC power with `RUSTC_ICE=0`, `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`. I did not touch the oracle
toolchain or `llvm-src/`. My mutation drivers and differential scripts stayed in my scratchpad; none of them is committed.

**Verdict.** F1, F2 and F3 are fixed, and each fix follows rustc or LLVM at the pin.

- **F1:** the strict replay rule is exactly rustc's one pattern. Every model mutation of builder positioning that changes the IR
  now fails replay. Under the old rule, two of my mutations passed replay unnoticed.
- **F2:** the vector cast fold and the splat printer match `ConstantFold.cpp`, `Constants.cpp` and `AsmWriter.cpp`. I compared
  2,730 vector casts against `libLLVM.dylib`: 1,254 agree, 0 are wrong, the rest stop. A SIMD case of my own matches the
  oracle's normal form, and its splat constants and three folded vector casts print byte-identical to the oracle's own text.
- **F3:** every remaining plain `throw` is an LLVM assertion that IR rustc emits cannot reach.

The nits below are documentation, plus one optional test assertion.

## What I ran

| Check | Result |
|---|---|
| `bun test src/rust_ts/llvm/`, 3 runs | **68 pass, 0 fail** each run, no skips; 1.50, 1.50, 1.46 s |
| `proof.oracle.test.ts` alone | 22 pass, 154 expects: the 11 oracle cases (rustc + recorder + replay + N1) and the 11 committed scripts |
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check --offline` | `markers ok (25797, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 735; llvm 354)`; the 7 new `// llvm:` markers resolve |
| `bun tools/llir/ffi_gen.ts --check` | `contract up to date: 381 fns, 33 enums, 4 bitflags` |
| `bun test ./src/std/result.test.ts` | 3 pass |
| 8 model mutations of positioning × 11 committed scripts, new and old `replay.ts` | §F1 |
| Own case `splat.rs` (repr(simd) consts), recorded and replayed | recorder transparent; 526 calls; **N1 MATCH** (§F2) |
| Own case `nonsplat.rs` | stops: `unported: llir: ConstantFoldCastInstruction of a non-splat vector` |
| 2,730 vector casts against `libLLVM.dylib` (scratch script) | **1,254 agree, 0 wrong, 0 plain errors**, 1,476 stops (§F2) |
| Trial merge with `integ-w52` (`a852aef2`), `--no-commit`, aborted | clean merge; tsc clean; 68/68; `markers ok (25800, …; llvm 354)`; ffi check up to date; result.test 3/3 |
| Trial merge with `t3/llvm-codegen-contract` (`658e1a5b`), aborted | clean merge; **tsc clean**; `src/rust_ts/llvm/` + `src/rustc_codegen_llvm` tests 106/106; `markers ok (25917, …; llvm 354)`; ffi check up to date |
| Three-way trial merge (lane + `integ-w52` + cg-contract), aborted | 2 tsc errors, the `PointerAuthSchema` ones (`rustc_codegen_llvm/common.ts:11`, `context.ts:40`). The first review traced these to `integ-w52` + cg-contract without this lane. Not the lane's |

## F1: replay position inference: fixed

**The rule matches rustc's.** `replay.ts:443-453` now infers `LLVMRustPositionBuilderAtStart` only when all of these hold:

- the call is `LLVMBuildAlloca`;
- `B.block === undefined`;
- `bb.isEntryBlock()`;
- `idx === bb.getFirstInsertionPt()`.

Anything else throws. At the pin:

- `position_at_start` (builder.rs:1636) has exactly two callers. They are `alloca` (:667) and `alloca_with_ty` (:679), and each
  does three things in order:
  1. `Builder::with_cx` (a fresh `LLVMCreateBuilderInContext`);
  2. `position_at_start(LLVMGetFirstBasicBlock(self.llfn()))`;
  3. `LLVMBuildAlloca`.
- `LLVMRustPositionBuilderAtStart` (RustWrapper.cpp:1408) is `SetInsertPoint(BB, BB->getFirstInsertionPt())`. That matches
  `build.ts:265`.
- The other positioning wrappers are out of scope:
  - `LLVMRustPositionBuilderPastAllocas` is called only from gpu_offload.rs:563 and :615.
  - `LLVMRustPositionBefore` and `LLVMRustPositionAfter` (RustWrapper.cpp:1414, :1420) are declared only in `enzyme_ffi.rs`.
- The only other `LLVMBuildAlloca` is `direct_alloca` (builder.rs:144). Its only callers are in gpu_offload.rs.
- So no in-scope rustc path builds an alloca on a positioned builder. A fresh builder at the entry block's first insertion point
  can only be `alloca`'s.

**Mutations of my own.** I patched `IRBuilder.prototype` (`setInsertPoint` / `insert`) and replayed all 11 committed scripts.
"same" below means replay passed and printed a module identical to the unmutated one, so the mutation had no effect in that case.

| # | Model mutation | New `replay.ts` | Old `replay.ts` (`2f13c6f3`) |
|---|---|---|---|
| MA | right block, inserting before the last instruction instead of at the end (a position after the wrong instruction) | **throws** in arith, switch, invoke, byval; same elsewhere | **passes** arith, switch, invoke (`inferredBy` changed, output identical); throws only in byval |
| MB | repositioning a used builder to another block is lost | same in all 11 (no case repositions a builder) | same |
| MC | `LLVMPositionBuilderAtEnd` of a fresh builder into a non-empty block is lost (a missing position call) | **throws** in arith, switch, invoke, byval | **passes** arith, switch, invoke; throws in byval |
| MD | `SetInsertPoint(BB, ip < len)` goes to the end (a broken `PositionBuilderAtStart`) | throws in invoke (the only case with a second alloca); same elsewhere | same |
| ME | `insert` ignores `insertBefore` | throws in invoke; same elsewhere | same |
| MF | `SetInsertPoint` off by one (`ip + 1`) | throws in invoke; same elsewhere | same |
| MG | `LLVMPositionBuilderAtEnd` of a fresh builder into an empty block is lost | throws in all 7 body cases | same |
| MH | every positioning into an empty block is lost | throws in all 7 body cases | same |

- With the new rule, every mutation either throws or leaves the module unchanged. None is hidden by an inferred wrapper.
- The old rule hid MA and MC: it repaired them by inference, and N1 would have matched.
- The model does not call `LLVMPositionBuilderBefore`, and in-scope rustc never calls it (ffi.rs declares it; no codegen file
  calls it). A no-op version of it would be a builder in the wrong place, which `positionFor` throws on unless the call is the
  alloca pattern, as MA and MC show.
- The reviewer's M1 and M2 are now failing replays in `build.test.ts:300-307`. Both throw "not in rustc's alloca pattern".
- All 11 proof cases pass under the strict rule, in both the oracle run and the committed-script run. The `inferredBy` key sets
  are unchanged, `PositionBuilderPastAllocas` is gone, and `PositionBuilderAtStart` remains for arith, switch, invoke and byval.

## F2: vector all-ones bitcast and vector cast folds: fixed

**Fidelity, marker by marker:**

- `Constant.isAllOnesValue` (`ir.ts:461-470`, Constants.cpp:68): the vector arm through `getSplatValue`. The ConstantInt and
  ConstantFP arms are the subclass overrides (`ir.ts:517`, `:539`). LLVM's ConstantByte arm has no model type.
- `getSplatValue` (`ir.ts:848`, Constants.cpp:1846) checks Poison, then CAZ, then CDV, then ConstantVector, in LLVM's order:
  - The vector-typed ConstantInt, FP and null arms and the shufflevector constant-expression arm return undefined. The model
    never makes those constants, so this matches.
  - `ConstantVector::getSplatValue` (:1887) is strict mode (`AllowPoison = false`), as `Constant::getSplatValue()` defaults.
  - `ConstantDataVector::getSplatValue` (:3505) compares uniqued element objects where LLVM compares bytes. That is the same
    for integer elements, and the model cannot build FP data vectors: every FP vector I built stopped in `LLVMConstVector`.
- `getAllOnesValue` (`ir.ts:876`, Constants.cpp:427): the integer, FP, then vector arms.
- `getSplat` (`ir.ts:888`, Constants.cpp:1602):
  - LLVM's own order: the FP and pointer-null arms stop, as does a scalable splat.
  - A fixed integer splat whose element type is compatible becomes `ConstantDataVector::getSplat`.
  - The rest stop as "ConstantVector::get of other elements" (i1, for example).
  - `UseConstantIntForFixedLengthSplat` is off by default, as the comment says.
  - Zero collapses to `zeroinitializer` through `getConstantDataSequential`, as `ConstantDataVector::getSplat` → `get` does.
- `foldBitCast` (`ir.ts:903`, ConstantFold.cpp:68-69): `isAllOnesValue()` → `getAllOnesValue(DestTy)`.
- `foldMaybeUndesirableCast` (`ir.ts:923`, ConstantFold.cpp:156):
  - Trunc, PtrToInt, IntToPtr, BitCast and AddrSpaceCast are `isDesirableCastOp` (Constants.cpp:2599). They go through
    `getCast`'s arms (:2369): `getTrunc` → `getFoldedCast`, `getPtrToInt`, `getIntToPtr`, `getBitCast`,
    `getAddrSpaceCast` → `getFoldedCast`.
  - The other opcodes go to `ConstantFoldCastInstruction`. The model has no PtrToAddr.
- The vector arm of `ConstantFoldCastInstruction` (`ir.ts:952-964`, ConstantFold.cpp:197-222):
  - The guard is equal `ElementCount`, comparing both the count and the scalable flag.
  - Then the splat fast path: a `foldMaybeUndesirableCast` that fails returns undefined (`nullptr`), and otherwise the result
    becomes a `getSplat`.
  - A scalable destination returns undefined. A non-splat vector stops in place of LLVM's per-element `getExtractElement` loop.

**Printer.** `printer.ts:303-309` follows AsmWriter.cpp:1764-1780. Only a `ConstantVector` or a ConstantDataVector qualifies (the
`VectorType` check excludes data arrays), and only when the splat value is a ConstantInt or ConstantFP. CAZ is printed earlier,
as in LLVM.

**Through the real pipeline.** `splat.rs` declares `#[repr(simd)]` consts, which `immediate_const_vector` passes to rustc as
`LLVMConstVector`, and uses them in `simd_add`/`and`/`xor`/`mul` and in `simd_cast` of a constant:

- target `x86_64-unknown-linux-gnu`, `-Coverflow-checks=off`, `-Cno-prepopulate-passes`;
- 526 calls recorded and replayed; **N1 MATCH**.
- The model's text has the same 7 splat lines as the oracle's raw `.ll`, byte for byte:
  - `mul <2 x i32> %x, splat (i32 7)`;
  - `and <8 x i8> %x, splat (i8 -1)`;
  - and three folded vector casts: `store <4 x i64> splat (i64 -5)`, `ret <4 x i16> splat (i16 4464)` (trunc of 70000) and
    `store <4 x i64> splat (i64 -1)`.
- So the new vector fold path is reachable from rustc and right there.
- `nonsplat.rs` (`simd_cast` of `[1, 2, 3, 4]`) stops with `Unported`. It does not guess.

**Against `libLLVM.dylib`, 2,730 casts** (scratch script, builder and `LLVMConstBitCast`, compared through
`LLVMPrintValueToString`):

- Inputs: element widths 1, 8, 16, 32 and 64, vectors of 2 and 4. Splats of 0, 1, -1, 5, INT_MIN, INT_MAX and two patterns;
  non-splat vectors; vectors that are all undef or all poison; vectors with undef or poison elements.
- Calls: trunc, zext, sext, `LLVMBuildIntCast2` (signed and unsigned), and bitcasts to a scalar and to every other vector shape
  of the same width.
- **1,254 agree. 0 are wrong and 0 raise a plain error.** By call: bitcast 207 + 207 const, intcast2 544, sext 96, zext 96,
  trunc 104. The bitcasts include every all-ones case, for example `bitcast <2 x i64> splat (i64 -1) to <16 x i8>` →
  `<16 x i8> splat (i8 -1)`.
- **1,476 stops**:
  - 1,200 happen while building the input. The model's `LLVMConstVector` does not take i1 elements or undef/poison elements, and
    `immediate_const_vector` never passes those.
  - 168 are `ConstantVector::getSplat` of i1 results.
  - 108 are non-splat vector casts.
- All-ones integer vector → scalar `float`/`double`/`half` (4 cases): the folded value has the same bits as LLVM's. The model
  prints `f0xFFFFFFFF` where LLVM prints `-nan(0x3FFFFF)`, under llir-core-a's hex-FP printer decision. The pinned `opt` reads
  `f0xFFFFFFFF` and prints `-nan(0x3FFFFF)`, so the normal forms agree. The unfolded non-all-ones case agrees verbatim.

## F3: plain throws: fixed, and the rest are unreachable

`signBit` (`fold.ts:101-107`) stops for a vector type before `fpBits()`. The new test asserts that LLVM folds the three
`fadd <2 x …>` cases and that the model throws `Unported`.

The other caller of `fpBits()` in `fold.ts`/`inst.ts` is `inst.ts:664`, which is behind `isFloatingPointTy()` on a scalar.

I audited every remaining `throw new Error`, plus the two new ones in `ir.ts`:

- **`fold.ts` (5 throws).** Each is an `llvm_unreachable`/assert that its callers rule out:
  - `:134`: the `isCommutative` switch already covers all seven commutative opcodes.
  - `:195`: `constantExprGet` is reached only through `isDesirableBinOp` (`:419`, `:685`) or the associative re-fold
    (`:479-480`). The re-fold needs `c1.opcode === opcode` on a constant-expression binop, so Add or Xor.
  - `:217`: `getCast` is called only after `isDesirableCastOp` (`:743`).
  - `:555` and `:599`: the predicate switches are exhaustive for the predicates the builders accept, and rustc passes only valid
    `IntPredicate`/`RealPredicate` values.
- **`inst.ts` (6 throws).** Each is an LLVM assert, or a null dereference in LLVM:
  - a block inserted before another with no function;
  - a scalable shuffle mask (rustc's masks are fixed vectors);
  - `CreateAlloca`, or an intrinsic call, with no block or module (rustc always positions first);
  - invalid extractvalue indices;
  - an invalid compare predicate.
- **`build.ts` (21 throws).** Each is an `unwrap<T>`/`cast<T>` of the wrong kind, or a null Twine. The one class of call that
  could reach them is a flag setter applied to a builder result that folded to a constant. rustc guards every one with
  `LLVMIsAInstruction`:
  - `LLVMSetNUW`/`NSW`, builder.rs:554-576 and :1021-1035;
  - `LLVMSetIsDisjoint`, :589.

  The fast-math setters take any value: they use `instanceof Inst` (`build.ts:634-651`), as RustWrapper's `dyn_cast` does.
  Volatile, ordering, metadata, alignment and call conventions are only set on loads, stores, atomics and calls, which never
  fold. `LLVMGetFirstBasicBlock` is only asked of the function being built.
- **`ir.ts`.** `getSplatValue` throws on a non-vector, and `getAllOnesValue` throws on a type that is not integer, FP or vector.
  Both are LLVM asserts (`assert`, `cast<VectorType>`). Every caller checks for a vector first, and an all-ones bitcast to a
  pointer or a struct is invalid IR.

None of these is a path where LLVM folds and the model would ICE instead of stopping.

## Nits

- **R1.** The handoff's replay limit 1 says a model bug in `LLVMRustPositionBuilderAtStart` "would show as a wrong instruction
  order, which the N1 comparison catches". Replay's own `checkPlaced` catches it first: MD threw at replay in invoke. Worth one
  word.
- **R2 (optional, carried over from the first review).** `proof.oracle.test.ts:99`/`:116` compare the `inferredBy` key sets only.
  Under the strict rule, the `PositionBuilderAtStart` count must equal the number of `LLVMBuildAlloca` calls in the script.
  Asserting that is a one-liner, and it would pin the rule in the proof itself as well as in `build.test.ts`.
- **R3.** `foldMaybeUndesirableCast` (`ir.ts:923-938`) restates `isDesirableCastOp` (`fold.ts:187`) and `getCast`
  (`fold.ts:204`) as an inline switch. The likely reason is that ir.ts cannot import fold.ts. It is correct today. A
  `// PORT:` line naming the two functions it mirrors would keep them from drifting apart.

## Manifest (`bun scripts/llvm-src.ts add …`)

The handoff's ten files. None is in `harness/llvm-manifest.json`, and all ten are cited in comments under `src/rust_ts/llvm/`. I
also scanned every `*.h`/`*.cpp`/`*.td` name cited in `src/rust_ts/llvm/*.ts`. The only other unpinned names are rustc's
`RustWrapper.cpp`/`PassWrapper.cpp` (rustc tree, not LLVM) and the C headers of the recorder. Every file the fix diff cites
(`Constants.cpp`, `ConstantFold.cpp`, `AsmWriter.cpp`, `Constant.h`, `IRBuilder.h`, `Instructions.cpp`) is already pinned.

1. `llvm/include/llvm/IR/Intrinsics.td`
2. `llvm/lib/AsmParser/LLParser.cpp`
3. `llvm/lib/IR/Instruction.cpp`
4. `llvm/include/llvm/IR/Instructions.h`
5. `llvm/include/llvm/IR/InstrTypes.h`
6. `llvm/include/llvm/IR/IntrinsicInst.h`
7. `llvm/include/llvm/Support/AtomicOrdering.h`
8. `llvm/lib/IR/Operator.cpp`
9. `llvm/include/llvm/IR/FMF.h`
10. `llvm/include/llvm/IR/Instruction.h`

## For root

- Accept the lane at `e5a23dac`. R1–R3 can be folded into a later commit, or left as they are.
- The `PointerAuthSchema` break appears when `integ-w52` and cg-contract are merged together, with or without this lane. It
  needs fixing when cg-contract is integrated.
- The APFloat stop table in the handoff is accurate for what I hit. Every FP-vector path I tried stops, and none guesses.
