# Handoff: llir-apfloat (M7 wave 41): floating point in the IR model

Branch `t3/27f5d05c`, base `620acf48`. This lane touches only `src/rust_ts/llvm/` and this file.

## Result

- **New `apfloat.ts`**: LLVM's `APFloat` API by LLVM's names, used by the folds, the cast folds and the printer.
  - Reused from the vendored `rustc_apfloat` (0.2.3+llvm-462a31f5a5ab):
    - for half, bfloat, float, double, fp128 and x86_fp80: add, subtract, multiply, divide, mod, `convert`,
      `convertToInteger` (whose `opInvalidOp` decides fptoui/fptosi poison), `convertFromAPInt`, `compare`, `changeSign`;
    - the decimal `toString(6, 0, false)` / `convertFromString` round trip the AsmWriter does.
  - Each such reuse carries a `// PORT:` note citing the equivalence, which the libLLVM differential test checks (below).
  - Ported from LLVM because rustc_apfloat differs or lacks it: `isSignaling` (`IEEEFloat::isSignaling`), `getNaNPayload`.
    The test caught rustc_apfloat's `is_signaling` disagreeing for x86_fp80 unnormals.
- **`ir.ts`**:
  - **Vector-typed `ConstantFP`.** At this pin every FP splat is a `ConstantFP` whose type is the vector (`FPSplatConstants`).
    `getSplatValue`, `getAggregateElement`, `getNullValue`, `getAllOnesValue` and `ConstantVector::getSplat` handle it.
  - **Getters.** `ConstantFP::get` covers every FP type (`getConstantFPOfAPFloat`, `getConstantFPSplat`, `getConstantFPOfType`,
    `getConstantFPOfDouble`), and `Type::getFltSemantics` / `getFloatingPointTy` are added.
  - **Cast folds.** The FP casts in `ConstantFoldCastInstruction` now fold. `FoldBitCast` reads its bits through
    `APFloat(sem, APInt)`, which canonicalises x86_fp80 encodings as LLVM does.
  - **Casts of casts.** `foldConstantCastPair` and `CastInst::isEliminableCastPair` are ported, with `DL = nullptr` as ConstantFold
    passes it.
  - **`ConstantVector::getImpl`** (`getConstantVector`), used by `LLVMConstVector` (build.ts) and by `getSplat` for elements the
    data vectors do not take. It handles zero/undef/poison collapse, FP splats, and FP or integer data vectors.
- **`fold.ts`**:
  - fadd, fsub, fmul, fdiv and frem of constants (ConstantFold.cpp:883);
  - fneg (`neg`);
  - fcmp (`FCmpInst::compare` over `APFloat::compare`);
  - `ConstantFP::getZero` and `getNaN` of every type, splats included;
  - the `m_NegZeroFP` FSub rule;
  - the splat fast paths of the unary and binary folds (ConstantFold.cpp:612, :912).
- **`printer.ts`**: `writeAPFloatInternal` and `WriteFullHexAPInt`. A constant prints in decimal when it round-trips and in
  `f0x` hex otherwise; also `±inf`, `±qnan`, `[s]nan(0x…)`, and vector `splat (…)` / `zeroinitializer`. The old always-hex
  PORT is gone.

## Stops (the llir-core-b APFloat table)

| llir-core-b stop | Now |
|---|---|
| `ConstantFoldBinaryInstruction FAdd/FSub/FMul/FDiv/FRem of two floating-point constants` | **gone** (ppc_fp128 still stops in `apfloat.ts`) |
| `ConstantFoldCastInstruction FPTrunc/FPExt/FPToUI/FPToSI/UIToFP/SIToFP` | **gone**, poison rule included (ppc_fp128 stops; integers wider than 128 bits stop) |
| `ConstantFoldCastInstruction of a cast of a cast` | **gone** (`isEliminableCastPair`; cases 7 and 11 need the DL, which is null here, as in LLVM) |
| `ConstantFP::get(<type>, double)` for half, bfloat, x86_fp80, fp128, ppc_fp128; `ConstantFP::get(float, NaN)` | **gone**, except ppc_fp128 |
| `comparing <type> constants (APFloat::compare)`; `ConstantFP::getNaN(<type>)` | **gone**, except ppc_fp128 compare |
| `the sign of a ppc_fp128 constant` | **gone** (`DoubleAPFloat::changeSign` flips both doubles; getZero) |
| vector-typed `ConstantFP` splats (`getZero` / `getNullValue` / `ConstantFP::get` of a vector, FP vector splat) | **gone** |

**Remain:**

- **ppc_fp128 arithmetic, conversions, `compare`, and decimal printing.** LLVM's `DoubleAPFloat` changed after rustc_apfloat's
  base. I did not bit-check it, and rustc makes no ppc_fp128 constants: the type appears only as an ABI cast register kind,
  abi.rs:150.
  - Printing stops even for a ppc_fp128 zero. `writeAPFloatInternal` tries the decimal round trip even when ForceBitwiseOutput
    is set; that flag only skips the inf/NaN spellings.
- **Per-element vector folds**: unary, binary and cast of a non-splat fixed vector, and `m_NegZeroFP` of one. These need
  `ConstantExpr::getExtractElement`. An all-undef vector is one of them: LLVM's `getSplatValue` gives nothing for undef.
- **Vector compares**: their result is a vector of i1, `cmpResultType`.

## Evidence

### Differential test against libLLVM.dylib (`apfloat.oracle.test.ts`, new)

Each case builds the same fold through libLLVM's C API and through `ffi.ts`, and compares `LLVMPrintValueToString`. That checks
the value and the printer's spelling at once. If neither side folds, both must have made an instruction.

The inputs are, per format:

- signed zeros and infinities;
- quiet and signalling NaNs, with and without payloads;
- the subnormal and normal boundaries;
- one and its neighbours, rounding ties, and large exponents;
- for x86_fp80, unnormals, pseudo-denormals and pseudo-infinities;
- plus a fixed pseudo-random sample of bit patterns.

| Test | Agree | Disagree | Stops |
|---|---|---|---|
| constants of every bit pattern (printer) | 1,232 | 0 | 0 |
| `LLVMConstReal` (double → each format; NaN payloads, subnormals, ties) | 1,368 | 0 | 0 |
| fadd/fsub/fmul/fdiv/frem | 15,165 | 0 | 0 |
| fneg and all 16 fcmp predicates | 43,856 | 0 | 0 |
| fptrunc/fpext between all format pairs | 1,602 | 0 | 0 |
| fptoui/fptosi to i1…i128, with poison | 6,720 | 0 | 0 |
| uitofp/sitofp from i1…i128 | 3,024 | 0 | 0 |
| bitcasts FP↔int, half↔bfloat | 634 | 0 | 0 |
| vector splats: build, fneg, bitcast, fptosi, fpext/fptrunc, binops, data vectors, sitofp of an int splat, the -0.0 identity | 2,298 | 0 | 13 (`ConstantVector::get of other elements`: bitcasts of x86_fp80/fp128 splats to `<4 x i80>` / `<4 x i128>`, whose elements no data vector takes) |
| casts of casts (`ptrtoint`/`inttoptr`/`trunc`/`zext`/`sext`/`bitcast`/`uitofp` over `ptrtoint @g`) | 36 | 0 | 0 |
| undef operands and identities | 60 | 0 | 0 |
| **Total** | **75,995** | **0** | 13 |

The ppc_fp128 test asserts the stops, and that `fneg 0.0` gives LLVM's bits (`0x8000…8000…`).

**Before writing the module**, scratch probes compared rustc_apfloat directly with libLLVM's folds, bits through a folded bitcast:

- IEEE arithmetic: about 30,000 cases;
- conversions: 23,634 (every fptrunc/fpext pair, fpto[us]i and [us]itofp at six widths);
- x86_fp80 arithmetic: about 115,000.

The only differences were ConstantFold's identity rules (`-0.0 + sNaN` returns the sNaN unchanged), which `fold.ts` applies
before APFloat. They were not APFloat differences.

### Record and replay: proof case `fpconst` (new)

`proof/fpconst.rs` and its committed script (943 calls) contain:

- `let x = 5i64; x as f64` and `1.5 * 2.0`;
- f32 `+ - * / %`;
- f64→f32, f32→f64, `u64::MAX as f32`, `-7i8 as f64`;
- `to_int_unchecked`;
- NaN, inf, `-0.0` and subnormal operands, with fcmp of them;
- f16 and f128 arithmetic and conversions;
- `-c + x`.

It is compiled `--target x86_64-unknown-linux-gnu -Coverflow-checks=off --emit=llvm-ir -Cno-prepopulate-passes`. It records,
replays with every answer checked, and reaches the oracle IR's N1 normal form.

The model's own printed FP constants also equal the oracle's `.ll` text **verbatim**: 19 of 19 in order, among them `+qnan`,
`f0x002AAAAB`, `half 2.500000e+00` and `fp128 f0x3FFD5555…`. Before this lane the model printed hex, so they agreed only after
`opt`.

### Checks

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `RUST_TS_REQUIRE_PROBES=1 bun test src/rust_ts/llvm/`, 3 runs | **83 pass, 0 fail** each, 6.60 / 6.11 / 6.09 s wall (was 68 tests in ~2 s; the differential test adds ~4 s, mostly the printer's bigint decimal round trip) |
| `bun test ./src/std/result.test.ts` | 3 pass |
| `bun tools/llir/ffi_gen.ts --check` | contract up to date: 381 fns, 33 enums, 4 bitflags (ffi.ts unchanged) |
| `bun scripts/coverage.ts --check --offline` | 24 ERROR lines, **all** "marker llvm/…/APFloat.{h,cpp}:… names no file of harness/llvm-manifest.json"; no other error. With the two files added to a scratch copy of the manifest, the checker (`llvmMarkerErrors`) resolves **all 136 `// llvm:` markers** in apfloat.ts, ir.ts, fold.ts and printer.ts |
| Coverage | No rustc file is ported, so the TOTAL/WRAPPER figures are unchanged; `// llvm:` markers are not counted (PORTING §5c). New markers: 25 in apfloat.ts, 8 in ir.ts, 2 in fold.ts, 2 in printer.ts |

Every run was on AC power with `RUSTC_ICE=0`, `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`. The oracle toolchain and
`$RUST_TS_DATA/llvm-src/` were not touched. The extra LLVM files were fetched into my scratchpad only.

## Manifest additions needed (`bun scripts/llvm-src.ts add …`)

The marked files are **required**, because the marker check fails until they are pinned:

1. `llvm/lib/Support/APFloat.cpp`: SHA-256 `199e7d48a3ffaacbe1cdf85068aada7aef822272383857fff29d2916e024f5b4` at `aab11ee0`.
2. `llvm/include/llvm/ADT/APFloat.h`: SHA-256 `14b0cf686ed14b650b566cc3a9e2f17b13b203c2f8dbb1f9f850482db2b7d660`.

Cited in comments without a marker, for reviewers:

- `llvm/include/llvm/IR/PatternMatch.h` (`m_NegZeroFP` / `cstfp_pred_ty`);
- `llvm/include/llvm/ADT/FloatingPointMode.h` (`roundingMode`).

## Every `unported(...)` this lane added or left (all `llir: ...`)

- `apfloat.ts`:
  - `APFloat <op> of a ppc_fp128 (DoubleAPFloat; not bit-checked against the pinned LLVM)`, where `<op>` is getQNaN,
    convertFromString, add, subtract, multiply, divide, mod, compare, convert, convertToInteger, convertFromAPInt or toString;
  - `APFloat::convertToInteger to i<N>` and `APFloat::convertFromAPInt of an i<N>` for N > 128.
- `fold.ts`:
  - `ConstantFoldUnaryInstruction of a non-splat vector`;
  - `ConstantFoldBinaryInstruction of a non-splat vector`;
  - `m_NegZeroFP of a non-splat vector` (unreachable: the undef rule only sees scalars and scalable vectors).
  - Left from llir-core-b: vector compares, `ConstantInt::get of a vector type` (the integer `Mul`/`SDiv` identity of a vector),
    vector select, extract/insert/shufflevector folds, pointer relations, `and` of `ptrtoint(@g)`, and large insertvalue.
- `ir.ts`:
  - `getNullValue of a vector of pointers`;
  - `a pointer-null vector splat` (in getImpl and getSplat);
  - `ConstantVector::get of other elements (a ConstantVector)`;
  - `a scalable vector splat` (non-FP);
  - `FoldBitCast scalar-to-vector`;
  - `ConstantFoldCastInstruction of a non-splat vector`.
  - Left: vector ptrtoint/inttoptr/GEP.

## `// PORT:` decisions (for root to record)

1. **rustc_apfloat is reused for the IEEE layouts**, and only for the operations the differential test checks.
   - LLVM's `isSignaling` and `getNaNPayload` are computed from the bits as LLVM computes them.
   - **ppc_fp128 stops** everywhere except bit operations: zero, all-ones, `changeSign`, NaN/inf tests, interning.
2. **An APFloat is immutable.** LLVM's mutating members return `{ status, value }`.
3. **`ConstantFP` keeps its bit pattern**, now the *element's* bits for a vector-typed splat.
   - The uniquing key is `(type, bitcastToAPInt)`, which is LLVM's `bitwiseIsEqual`.
   - Every creator goes through `APFloat`, so x86_fp80 encodings are canonicalised: unnormals become NaNs and pseudo-denormals
     are re-encoded, as `initFromF80LongDoubleAPInt` / `bitcastToAPInt` do.
4. **Integers wider than 128 bits stop** in FP↔int conversions. rustc_apfloat's limit is 128 bits, and rustc's integers are no
   wider.
5. **`apfloat.ts` is not listed in `impl_modules.ts`**, although the brief suggested it. `IMPL_MODULES` is the list `ffi_gen`
   searches for ffi.rs functions, and apfloat.ts exports none. `LLVMConstReal` / `LLVMConstVector` stay in core.ts / build.ts,
   so ffi.ts is unchanged. Listing it is harmless if root prefers.
6. **Side effect on integer vectors.** The splat fast path of `ConstantFoldBinaryInstruction` is LLVM's generic vector branch,
   so integer data-vector splats now fold too, e.g. `add <4 x i32> splat 1, splat 2`. Before, every vector stopped. ConstantFold
   puts this branch ahead of the constant-expression rules for any element type. Signatures did not change (cg-builder
   coordination).

## Files

| File | What |
|---|---|
| `apfloat.ts` | new: the APFloat API |
| `ir.ts` | vector-typed ConstantFP, ConstantFP getters, FP cast folds, `foldConstantCastPair` / `isEliminableCastPair`, `getConstantVector`, `getSplat` through it |
| `fold.ts` | FP arithmetic, fneg, fcmp, getZero/getNaN, splat fast paths, `m_NegZeroFP` |
| `printer.ts` | `writeAPFloatInternal`, `WriteFullHexAPInt`, vector ConstantFP |
| `build.ts` | `LLVMConstVector` → `getConstantVector` |
| `apfloat.oracle.test.ts` | new: the libLLVM differential test |
| `proof/fpconst.rs`, `proof/fpconst.script`, `proof.oracle.test.ts` | the new proof case |
| `capi.oracle.test.ts`, `model.test.ts`, `build.test.ts` | the old FP stop assertions now check folds against libLLVM / fixed text, plus the ppc_fp128 stops |

Commits: `1b35c787`, `39c79e8a`, `d93fa081`, `08d279b3`, and the commit adding this file.
