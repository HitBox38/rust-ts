# Review: llir-folder-notes (fixes for review llir-folder N1-N8)

Reviewer: independent, read-only. Branch `t3/llir-folder-notes`, commit `0a1df849`, against `main`. The merge base is `95f42fff`.
I checked the work against LLVM at the pin (`harness/llvm-manifest.json`, commit `aab11ee0`, `$RUST_TS_DATA/llvm-src/`). The
review merged `0a1df849` into `t3/review-llir-folder-fixes`.

**Verdict: FAIL.** One must-fix: N5's new scalable-vector rule in `isSized` misses scalable vectors nested in arrays, and the
model then folds an `icmp` that libLLVM leaves alone (F1). The fix is one line. Everything else checks out: N1, N4, N6, N7 and N8
are correct, `isEmptyTy` is correct, N2 is correct as far as it goes (see N-a), and N3 was already done on main.

## Environment

The machine was on AC power (`pmset`: "Now drawing from 'AC Power'", battery charged). The runs used
`RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0`, with `.env.local` from integ-w39. I did not touch the oracle toolchain or
`llvm-src/`.

## Commands

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check --offline` | `markers ok (26758, 46 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 745; llvm 430)`. This matches the handoff. |
| `bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts` | 229 pass, 0 fail, 0 skip (12.2 s). This includes `proof.oracle.test.ts`, which records fresh with the rebuilt recorder and compares against the committed scripts. That confirms the handoff's "records byte for byte" for N2. |
| `bun test ./scripts/lib/unit-steps.test.ts` | 10 pass |

## Mutation checks

I undid each fix in `fold.ts`, ran `folder.oracle.test.ts`, then ran `git checkout` to restore it. The tree is clean afterwards.

| Mutation | Result |
|---|---|
| N4: `if (isSized(ObjectType))` → `if (true)` | the `and(ptrtoint @g, C)` test fails |
| N4 (extra): `Alignment ?? 1` → `Alignment ?? 4` | the `and` test fails, so the test checks the value and not just the absence of a stop |
| N5: `BigInt.asUintN(32, n) === 0n` → `n === 0n` | the pointer icmp test fails |
| N7: drop `&& (CE1.flags & 1) !== 0` | the pointer icmp test fails |

## Per finding

- **N1** (`folder.oracle.test.ts:674-680`): fixed. The loop now stops at the first non-`llvm.arm.` name after the ARM block. The
  real bound is "the end of the ARM block". That keeps every ID inside the table as long as some target sorts after `arm`
  (bpf, hexagon, ..., xcore), which is true at the pin. The `20000` cap and the `n <= 5 || n > 200` checks are only backstops.
  The ordering rule (TableGen sorts intrinsics by target prefix, then by name) is not a pinned source, so the bound is not
  sourced. It is checked indirectly, because the test finds more than 100 ARM names. See N-b for a cheap way to make it checked.
- **N2** (`record.ts:322-323`): fixed as asked. `wrg` now rewrites the entry for every result, so the `RG` table always holds the
  latest value for an address. Within a live context, `LLVMCreateConstantRangeAttribute` uniques its result, so the same pointer
  means the same range, and the rewrite is a no-op. Replay proves the same things as before. The fresh recordings still match
  the committed scripts. The fix does not cover the whole reuse case: see N-a.
- **N3**: already done on main (`1abfdf09`). Not part of this branch.
- **N4** (`fold.ts:255-268`): matches `Value::getPointerAlignment` (Value.cpp:1004-1018). The unaligned, unsized case falls
  through to `Alignment.valueOrOne()` = 1 (Value.cpp:1018), and the model's `return Alignment ?? 1` does the same. The existing
  PORT stop moved inside the `isSized` branch unchanged. The new opaque-struct declaration `dO` is tested over the five layouts.
- **N5, `isSized`** (`fold.ts:707-726`): it now has a marker (`Type.h:326 isSized`, correct), and the other cited lines are
  right (Type.cpp:265 `isSizedDerivedType`, Type.cpp:722 `StructType::isSized`). An opaque struct is unsized and a direct
  scalable vector element stops. The scalable check is incomplete: **F1**.
- **N5, `isEmptyTy`** (`fold.ts:731-734`): matches Type.cpp:180-184. `unsigned NumElements = ATy->getNumElements()` truncates to
  32 bits, and the model uses `BigInt.asUintN(32, ...)`. The struct arm already followed Type.cpp:187-191. Tested with
  `[4294967296 x i8]`.
- **N6** (`abi_consts.test.ts:402-411`): it only adds an assertion. The comparisons and their order are unchanged, the test still
  passes, and the oracle-side assertion at :375 is untouched. One small asymmetry: the oracle side de-duplicates through a
  `Map`, but the model side's `seen` array does not, so the new check also requires exactly one call per callee. That holds today
  and is stricter, not looser.
- **N7** (`folder.oracle.test.ts:590-591`): the GEP-vs-null arm is ConstantFold.cpp:1100
  (`!GV->hasExternalWeakLinkage() && CE1GEP->isInBounds()`). `gep4nf` stays a `getelementptr` constant without `inbounds`, so it
  reaches that line with `isInBounds()` false. The mutation check confirms this. `gep0nf` folds back to the global itself
  (ConstantFoldGetElementPtr's `IsNoOp`, ConstantFold.cpp:1363-1373), so it tests global-vs-null rather than the GEP arm.
  That is harmless.
- **N8** (`docs/handoff/llir-folder.md:107`): correct. The file has 10 `test(` blocks, now and at the base.

Scope: only `fold.ts`, `folder.oracle.test.ts`, `record.ts` (the recorder, which N2 required), the one assertion in
`abi_consts.test.ts` and the two handoffs changed. Nothing changed in `scripts/`, `harness/`, the baselines or `llvm-src/`. No
new values are guessed. The new rules have `// llvm:` markers, or sit under an existing one (`isEmptyTy` Type.cpp:180,
`getPointerAlignment` Value.cpp:993).

## Findings

- **F1** `src/rust_ts/llvm/fold.ts:723`. `isSized` stops only when a struct element is directly a scalable vector
  (`e instanceof VectorType && e.scalable`). LLVM's rule is `Ty->isScalableTy()` (Type.cpp:746), which also looks through arrays
  and nested structs (Type.cpp:61-67 `Type::isScalableTy`, Type.cpp:504 `StructType::isScalableTy`). Arrays of scalable vectors
  are valid (Type.cpp:829-833 `ArrayType::isValidElementType` does not exclude them). For `{ [2 x <vscale x 4 x i32>] }` LLVM says
  the struct is unsized, but the model says it is sized.
  - **Reproduced.** I temporarily added such a global to the pointer icmp test (`types` list, plus an `LLVMScalableVectorType`
    dlopen entry), then reverted. The model folds `icmp eq ptr @g0, @g70` to `i1 false` and `icmp ne` to `i1 true`, while
    libLLVM keeps both instructions, giving 528 diff lines in total. This is a wrong answer, not a stop.
  - A struct nested inside a struct is fine: the inner struct stops on its direct scalable element.
  - **Fix:** port `Type::isScalableTy` (arrays, structs, `ScalableVectorTyID`; the model has no target extension types) and
    check that in place of the direct `VectorType` test. Optionally, add the `{[2 x <vscale x 4 x i32>]}` global to the icmp test
    as the regression case.
  - rustc puts no scalable type in a global today, so this cannot be reached. It is still the exact rule N5 asked to port, and
    the docstring at :711-714 claims it.
- **N-a** `src/rust_ts/llvm/record.ts:181` (with :262). The N2 fix only takes effect when the old attribute was never logged.
  `attr()` returns early when `find(a)` knows the address, and handles are not retired at `LLVMContextDispose`; only the
  `forget` list at :266 retires handles. So if a later context reuses an attribute address that an earlier context's `?attr`
  line already numbered, the recorder writes no new `?attr` line, and replay keeps the old context's attribute: its old kind,
  value or range. This applies to every attribute kind, not just ranges.
  - The handoff's "a reused address after `LLVMContextDispose` gets its own value" is true of the `RG` entry but not of the
    script.
  - It is the same severity as the original N2: a false difference, never a false pass. It is not new.
  - Suggested follow-up for a recorder batch: retire the disposed context's attribute handles in the `LLVMContextDispose` hook
    (or all of its handles, along with the `fas`/`cas` entries keyed by its functions and calls).
- **N-b** `src/rust_ts/llvm/folder.oracle.test.ts:680`. The loop's stop relies on the table being sorted by target with ARM not
  last, and that rule is not in a pinned file. A one-line check would turn the assumption into a test: assert that the first
  non-ARM name after the block round-trips (`LLVMLookupIntrinsicID(name) === id`). That proves the stopping ID is below
  `num_intrinsics`.
- **N-c** `src/rust_ts/llvm/fold.ts:712`. The docstring lists the types the model lacks as "no X86_AMX, no target extension
  types". At the pin, `Type::isSized` also treats `ByteTyID` as primitive (Type.h:327-329), and the model has no byte type
  either. Add it to the list.
- **N-d** `docs/handoff/llir-folder-notes.md:12`. It cites the `ObjectType->isSized()` guard as Value.cpp:1005. At the pin the
  guard is Value.cpp:1008; line 1005 is `const MaybeAlign Alignment(GVar->getAlign())`. The original review had the same line
  number. This only affects the docs.

## For root

- Fix F1 on `t3/llir-folder-notes` (one helper and one condition), then do a quick re-check (the icmp test plus the scalable
  struct case) before merging.
- N-a goes to a later recorder batch. It is pre-existing and outside N2's literal ask.
