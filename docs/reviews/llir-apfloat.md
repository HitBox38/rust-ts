# Review: lane `llir-apfloat` (M7 wave 41)

Reviewer: independent, read-only (AGENTS.md §1). Branch `t3/implement-llvm-apfloat-folds`, commits `1b35c787`, `39c79e8a`,
`d93fa081`, `08d279b3`, `ef6016ce`, `eafdf7d4` against `main` at `620acf48` (`git diff 620acf48..eafdf7d4`), merged into
the review worktree (`t3/review-llvm-apfloat-folds`). LLVM sources at `aab11ee0ea5e` (`harness/llvm-manifest.json`).

## Verdict: **PASS WITH NOTES**

No must-fix findings. The folds, cast folds, cast-pair table, `ConstantVector::get`/splat handling and the printer follow
LLVM at the pin, in LLVM's order, and an independent libLLVM probe (below) agrees with the model bit for bit. The nits are
documentation and marker gaps. Root must add the two APFloat files to the manifest at integration, or the marker check fails
(24 `ERROR` lines, all `names no file of harness/llvm-manifest.json`).

## Commands (AC power, `RUSTC_ICE=0`, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`)

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p .` | exit 0 |
| `bun test ./src/rust_ts/llvm/ ./src/std/result.test.ts`, run 1 | 86 pass, 0 fail, 7 files, 6.55 s |
| same, run 2 | 86 pass, 0 fail, 7 files, 6.21 s |
| `bun test ./src/rust_ts/llvm/apfloat.oracle.test.ts` | 13 pass, 0 fail |
| `bun test ./src/rust_ts/llvm/proof.oracle.test.ts -t fpconst` | 2 pass, 0 fail (a fresh recording from the pinned rustc equals the committed script) |
| `bun scripts/coverage.ts --check --offline`, manifest as committed | exactly the 24 expected errors: 16 for `APFloat.h`, 8 for `APFloat.cpp`, nothing else |
| same, with the two files added to a local manifest copy (not committed) | **0 errors**: `markers ok (25920, … llvm 390)` |

For the marker check I did not run `bun scripts/llvm-src.ts add`, because it writes under `$RUST_TS_DATA/llvm-src/<commit>/`.
Instead I fetched the two files at `aab11ee0ea5ea9a1d462ad0bc1fae9d9bb643019` from raw.githubusercontent into my scratchpad.
I pointed `RUST_TS_DATA` at a scratch directory of symlinks: the real `.data` entries, the pinned llvm-src files, and the two
new files. The temporary manifest edit was reverted, and the tree is clean apart from this file.

## 1. Markers

- **SHA-256s confirmed.**
  - `llvm/lib/Support/APFloat.cpp`: `199e7d48a3ffaacbe1cdf85068aada7aef822272383857fff29d2916e024f5b4` (6181 lines).
  - `llvm/include/llvm/ADT/APFloat.h`: `14b0cf686ed14b650b566cc3a9e2f17b13b203c2f8dbb1f9f850482db2b7d660` (1843 lines).
- **All 37 new `// llvm:` markers checked**, not just 20. Each points at the definition line of the function it names:
  - APFloat.h:
    - 1165 `getZero`, 1195 `getNaN`, 1206 `getQNaN`;
    - 1267 `add`, 1276 `subtract`, 1285 `multiply`, 1294 `divide`, 1312 `mod`;
    - 1383 `changeSign`, 1433 `convertFromAPInt`, 1457 `bitcastToAPInt`;
    - 1484 `operator==`, 1508 `compare`, 1530 `bitwiseIsEqual`, 1602 `toString`, 1709 `neg`.
  - APFloat.cpp:
    - 4030 `IEEEFloat(Sem, APInt)`, 4038 `IEEEFloat(double)`;
    - 4392 `isSignaling`, 4541 `getNaNPayload`;
    - 5842 `APFloat(Sem, StringRef)`, 5920 `convert`, 5946 `getAllOnesValue`, 5967 `convertToInteger`.
  - Type.cpp: 106 `getFltSemantics`, 125 `getFloatingPointTy`.
  - Constants.cpp: 1122, 1174 and 1188 `ConstantFP::get`; 1149 `getNaN`; 1167 `getZero`; 1549 `ConstantVector::getImpl`.
  - ConstantFold.cpp: 45 `foldConstantCastPair`.
  - Instructions.cpp: 2882 `isEliminableCastPair`.
  - AsmWriter.cpp: 1540 `WriteFullHexAPInt`, 1550 `writeAPFloatInternal`.

## 2. Fidelity

- **ConstantFoldUnaryInstruction** (ConstantFold.cpp:579), `fold.ts` `constantFoldUnaryInstruction`.
  - The arms are in LLVM's order. A vector-typed `ConstantFP` takes the `ConstantFP` arm, as in LLVM, where `dyn_cast<ConstantFP>`
    matches it.
  - The splat fast path is ConstantFold.cpp:611-614. A fixed non-splat vector stops; a scalable one returns undefined, as
    LLVM returns nullptr.
- **ConstantFoldBinaryInstruction**: the FP arm (:883-907) and the vector branch (:910-923, `isIntDivRem`+null →
  poison, `isDesirableBinOp ? ConstantExpr::get : recurse`) are line for line.
  - The `m_NegZeroFP` rule (:734) matches `cstfp_pred_ty` for scalars and splats.
  - The non-splat stop there is unreachable, because that arm only sees scalars and scalable vectors.
- **fcmp** (`FCmpInst::compare`, Instructions.cpp:3914): all 16 predicates match case for case over `APFloat::compare`.
  Vector compares still stop first, in `cmpResultType` (`fold.ts`, "a comparison of vectors").
- **ConstantFoldCastInstruction** (ConstantFold.cpp:163-290):
  - **fptrunc/fpext**: `convert(…, rmNearestTiesToEven)`, with `losesInfo` ignored as LLVM ignores it.
  - **fpto[us]i**: `convertToInteger(width, isSigned = FPToSI, rmTowardZero)`. Poison iff `opInvalidOp`, as LLVM's
    `APSInt(width, isUnsigned = FPToUI)` does.
  - **[us]itofp**: `convertFromAPInt`.
  - **The cast-of-cast arm** (:186-190): ported, and the splat path (:200-206) matches.
  - **`FoldBitCast`** (:63-150): matches, including the PPC_FP128 guards. `APFloat(sem, APInt)` canonicalises x87 encodings:
    unnormals and pseudo-infinities become NaN as in `initFromIEEEAPInt` (APFloat.cpp, the `hasExplicitIntegerBit` branch).
- **`isEliminableCastPair`** (Instructions.cpp:2882-3100): I compared the 14×14 table cell by cell, and every case 0-17/99.
  - Cases 7 and 11 return 0 because `DL` is null, as `foldConstantCastPair` passes it (ConstantFold.cpp:59-60).
  - The order of the `CastOpcode` names follows Instruction.def at the pin, PtrToAddr included.
- **Constants.cpp**:
  - `ConstantFP::get(Type*, double)` (:1108) and `ConstantFP::get(Type*, APFloat)` (:1122) are ported.
  - The scalar and vector `FPConstants` / `FPSplatConstants` uniquers (:1174/:1188) are keyed by `bitcastToAPInt`. That is
    equivalent to `bitwiseIsEqual` because every creator goes through `APFloat`: there is no other `new ConstantFP`.
  - `getNullValue` of an FP vector is a ConstantFP splat (:388).
  - `getSplatValue` / `getAggregateElement` have the ConstantFP arm in LLVM's order.
  - `ConstantVector::getImpl` (:1549) is ported, isZero → CAZ before isSplatFP included.
  - `ConstantVector::getSplat` (:1602) is ported.
- **Printer** (AsmWriter.cpp:1550 `writeAPFloatInternal`, :1643 the ConstantFP arm of `writeConstantInternal`): faithful.
  - The ppc_fp128 `ForceBitwiseOutput` rule is ported.
  - `±inf` and `±qnan` are ported, as is `[s]nan(0x…)` with the quiet bit cleared and `trunc(getActiveBits())` (a zero
    payload prints `0x0`, as `WriteFullHexAPInt` of width 0 does).
  - The round trip uses `toString(6, 0, false)` and `operator==`, which is `compare == cmpEqual` (APFloat.h:1484), so `-0.0`
    round-trips. The fallback is `f` + `WriteFullHexAPInt` at the type's width.
  - A vector is `zeroinitializer` when its bits are zero, otherwise `splat (<ty> …)`.
  - The brief asks about `0x` (double-width for float), `0xK`, `0xL`, `0xM` and `0xH`/`0xR`. **At this pin AsmWriter no longer
    prints any of them.** Every hex FP constant is `f0x` with the type's own digit count (AsmWriter.cpp:1598-1601), so
    `float f0x002AAAAB` is correct.
- **NaN payloads.** These come from rustc_apfloat's arithmetic.
  - The lane's test and my probe (below) found no difference for NaN operands with payloads, signalling NaNs, or x87
    unnormals and pseudo-NaNs.
  - They also agree on the result **bits**: I compared through a folded bitcast to `i80`, because the printed form of an x87
    NaN leaves out the explicit integer bit.

### Independent probe (scratchpad, not committed)

I wrote my own bun:ffi probe against the oracle's `libLLVM.dylib`, comparing `LLVMPrintValueToString` with the model's
printer. It covered:

- double, float, x86_fp80 and half;
- sNaN and qNaN with payloads, `-0.0`, the smallest denormal, `2^31` and its neighbours, `±inf`;
- x87 unnormals with and without the quiet bit, pseudo-NaNs and pseudo-denormals;
- all five binops over every pair;
- fptrunc d→f/h, fpext d→x87, and fptrunc x87→f/d;
- fptosi/fptoui to i1, i8, i31, i32, i33 and i64, including poison.

**1,147 + 409 + 416 cases, 0 differences.** The last 416 compare the x87 bits through a bitcast to i80.

## 3. Reuse of `rustc_apfloat`

- **The reuse is plausible and tested.** rustc_apfloat 0.2.3 is a port of LLVM's `IEEEFloat`. The lane checked it against
  libLLVM before relying on it, and `apfloat.oracle.test.ts` re-checks it on every run.
- **The `isSignaling` divergence is real, and the lane's version follows LLVM.**
  - LLVM's `IEEEFloat::isSignaling` (APFloat.cpp:4392) tests only bit `precision-2` (bit 62 for x87) of the stored
    significand.
  - rustc_apfloat's `is_signaling` (`src/vendor/rustc_apfloat/ieee.ts:1776`) tests `sig & QNAN_SIGNIFICAND`, which for x87
    is `0b11 << 62` (`ieee.ts:539`). So an x87 NaN without the integer bit but with bit 62 set (an unnormal or pseudo-NaN)
    is signalling to rustc_apfloat and quiet to LLVM.
  - `getNaNPayload` (APFloat.cpp:4541) is the low `precision-1` bits of the significand, which is what the lane computes
    from `bitcastToAPInt`. That holds because LLVM's x87 `initFromIEEEAPInt` stores the explicit 64-bit significand, and
    `bitcastToAPInt` writes it back.
  - The ppc_fp128 versions delegate to `Floats[0]`, which matches LLVM: `DoubleAPFloat::getNaNPayload` (APFloat.cpp:5812)
    and `APFloat::isSignaling` → `getIEEE()` (APFloat.h:1567).
- **The `// PORT:` notes do not meet the brief's per-operation requirement.** See N1.

## 4. No guessed values

- **The required stops are all present, each as `unported("llir: ...")`:**
  - ppc_fp128: arithmetic, compare, convert, convertTo/FromInteger, getQNaN, fromString and toString (`apfloat.ts` `ppcStop`).
    Printing stops even for a ppc_fp128 zero, because LLVM tries the decimal form there too.
  - Non-splat fixed vectors: unary, binary and cast folds, and `m_NegZeroFP`.
  - Vector compares (`cmpResultType`).
  - FP↔int conversions wider than 128 bits.
  - The new `throw new Error("llvm: …")` lines stand for LLVM asserts and `llvm_unreachable`, as elsewhere in ir.ts.
- **The ppc_fp128 bit operations follow LLVM:**
  - `getZero` sets only bit 63, as `DoubleAPFloat::makeZero` sets `Floats[1]` to +0;
  - `changeSign` flips bits 63 and 127, as `DoubleAPFloat::changeSign` (APFloat.cpp:5083) does;
  - all-ones and interning are plain bits.
- **Integer-splat folding is sourced from LLVM.** It is ConstantFold.cpp:910-923, which runs for any element type ahead of
  the constant-expression rules.
  - It only turns a former stop (`"llir: ConstantFoldBinaryInstruction of vectors"`) into a fold. Before this lane nothing
    could pass through that line, so nothing relies on the old behaviour.
  - No test asserted that stop. The integer `Mul` identity of a vector still stops first, as before.
- **`LLVMConstVector` now goes through `getConstantVector`.** All-zero integer vectors now collapse to
  `zeroinitializer`, as `getImpl` does; before, they were a data vector. capi.oracle checks this against libLLVM.

## 5. Tests

- **`apfloat.oracle.test.ts` is a real differential test.**
  - It `dlopen`s `$(rustc +<PIN.toolchain> --print sysroot)/lib/libLLVM.dylib`, the pinned nightly's own libLLVM, and builds
    each case through libLLVM's C API on one side and the model's `ffi.ts` on the other.
  - It compares the printed values, and each test requires a minimum agreement count (`done(minAgreed)`), so it cannot pass
    vacuously.
  - Model stops are counted, and only the two expected stop messages are tolerated.
- **Skips are not silent under the gate.**
  - Without `RUST_TS_REQUIRE_PROBES=1` and without libLLVM, the test prints a `SKIP:` line and `describe.skipIf` skips it.
  - With `RUST_TS_REQUIRE_PROBES=1`, which the gate's unit step sets (`scripts/gate.ts:6`, `ALLOWED_SKIPS` :271), the
    describe runs. A missing libLLVM then fails it instead of skipping.
  - Nothing new is needed in `ALLOWED_SKIPS`.
- **`proof/fpconst.rs`: the expectations come from the pinned rustc.**
  - `proof.oracle.test.ts` re-records with `rustc +<pin>` and requires the fresh recording to equal the committed script.
    The script itself records `LLVMGetVersion(&23, &1, &3)`, matching the manifest's `rustc/23.1` branch.
  - It then replays with every answer checked, and requires the N1 normal form of the oracle IR. It passed here.

## 6. Scope

- **Only IR-model files changed:** `src/rust_ts/llvm/{apfloat,ir,fold,printer,build}.ts`, its tests, the proof case and
  `docs/handoff/llir-apfloat.md`. No harness, script, manifest or baseline changes.
- **No conflict with cg-builder (`78469d5c`).**
  - Its diff from `620acf48` touches no file under `src/rust_ts/llvm/`.
  - `git merge-tree --write-tree eafdf7d4 78469d5c` is clean.
  - The only export the lane removed, `getConstantFP(ty, bits)`, is used nowhere on either branch.
  - No ffi signature changed.
  - cg-builder's stop assertions in `builder.test.ts` concern vscale, loop metadata and cross-lane stubs, which this lane
    does not touch.

## Findings

No F findings.

- **N1: the reuse of rustc_apfloat is documented once, in the module header, and the list is incomplete.**
  - Where: `src/rust_ts/llvm/apfloat.ts:5-12` against the reuse sites at `apfloat.ts:94-98` (`from_bits`), `:126`
    (`qnan`), `:187` (`neg`), `:239` (`to_bits`), and `:253-267` (`is_zero`/`is_negative`/`is_nan`/`is_infinite`).
  - What the brief asks: a `// PORT:` note citing the differential test on each reused operation. The handoff says "each such
    reuse carries a `// PORT:` note". In fact there is one header note, which lists the arithmetic, the conversions,
    `compare` and the decimal round trip.
  - What it leaves out:
    - `from_bits`/`to_bits`. These carry the x87 canonicalisation that `FoldBitCast` and the uniquing key depend on, the
      counterpart of LLVM's `initFromIEEEAPInt`/`convertF80LongDoubleAPFloatToAPInt` (APFloat.cpp:3365).
    - `qnan`, `neg`, and the category predicates.
  - Fix: add a one-line `// PORT: rustc_apfloat <fn>; checked by apfloat.oracle.test.ts (<test name>)` on each reusing method,
    or at least add `from_bits`/`to_bits`/`qnan` to the header, and correct the handoff's sentence.
- **N2: `Printer` lost its doc comment.**
  - Where: `src/rust_ts/llvm/printer.ts:164`.
  - The new `writeFullHexAPInt`/`writeAPFloatInternal` were inserted between `Printer`'s JSDoc ("One printing of a module
    …") and `export class Printer` (now :210). That JSDoc now sits above the `// llvm: …:1540 WriteFullHexAPInt` marker.
  - Fix: move the two functions above that comment.
- **N3: four predicates that follow LLVM carry no marker.**
  - Where: `src/rust_ts/llvm/apfloat.ts:252-267`. `isZero`, `isNegative`, `isNaN` and `isInfinity` follow `APFloat::isZero`
    (APFloat.h:1561), `isInfinity` (:1562), `isNaN` (:1563) and `isNegative` (:1565). The ppc_fp128 path asks the first
    double, as `getCategory()`/`getIEEE()` do.
  - They have no `// llvm:` marker (PORTING §5c: "where it follows LLVM … it carries a marker").
  - Also, `fromAPInt` (`:90`) and `fromDouble` (`:100`) cite the `IEEEFloat` constructors (APFloat.cpp:4030/:4038). The
    functions stand for `APFloat`'s own constructors, which dispatch to `IEEEFloat` or `DoubleAPFloat`. That passes the
    check and is acceptable, but a `// PORT:` saying so would help the next reader.
- **N4: the test does not check which LLVM version it loads.**
  - Where: `src/rust_ts/llvm/apfloat.oracle.test.ts:20-29`.
  - It loads the libLLVM of `PIN.toolchain`, which is the pinned LLVM. But it never asserts the version, as the proof
    scripts implicitly do through `LLVMGetVersion(&23, &1, &3)`.
  - A cheap `LLVMGetVersion` check against the manifest's branch would turn a silent toolchain mismatch into a clear failure.
    Optional.

## For root at integration

1. Add the two APFloat files to the manifest: `bun scripts/llvm-src.ts add llvm/lib/Support/APFloat.cpp
   llvm/include/llvm/ADT/APFloat.h`. Their hashes match the lane's (above).
2. Record the lane's `// PORT:` decisions 1-6 from the handoff, in particular 6 (integer-splat folds now happen).
