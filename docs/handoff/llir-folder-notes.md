# Handoff: llir-folder-notes (the minor notes of review llir-folder)

Branch `t3/llir-folder-notes`, base `main` at `95f42fff`. Owner: take care of N1-N8 where they are straightforward. This branch is
independent of `t3/n1-name-anon` (the item 10 fix), and either can merge first. Nothing in `scripts/`, `harness/`, baselines or
`$RUST_TS_DATA/llvm-src/` changed.

| Note | State | Change |
|---|---|---|
| N1 | done | `folder.oracle.test.ts`: the ARM name loop stops when it leaves the `llvm.arm.` block (the table is sorted), so it never asks `LLVMIntrinsicGetName` for an ID past `num_intrinsics`. |
| N2 | done | `record.ts` `wrg`: each `LLVMCreateConstantRangeAttribute` call rewrites its result's entry, instead of keeping the first one, so a reused address after `LLVMContextDispose` gets its own value. The recorder is keyed by its source, so it rebuilt; every committed proof script still records byte for byte. |
| N3 | already done by root | `1abfdf09` pinned all seven files, `DataLayout.h` and `Operator.h` included. |
| N4 | done | `fold.ts` `getPointerAlignment`: the `ObjectType->isSized()` guard of Value.cpp:1008 (review llir-folder-notes N-d corrected the line). An unsized, unaligned variable is `valueOrOne()` = 1 instead of a stop. Test: an opaque-struct declaration in the `and (ptrtoint @g), C` test, over the five layouts. |
| N5 | done | `fold.ts` `isSized`: marked `Type.h:326`, follows `isSizedDerivedType`; `StructType::isSized` (Type.cpp:722) is its own function now, with `containsHomogeneousScalableVectorTypes` (:587) and `containsHomogeneousTypes` (:593) ported, and each element checked with the existing `isScalableTy` (Type.cpp:61), now with `StructType::isScalableTy` (:504) split out and marked. **Re-check F1:** the first version looked only for a scalable vector directly in a struct, so `{ [2 x <vscale x 4 x i32>] }` was called sized, and the model folded an icmp libLLVM keeps. `isEmptyTy`: the element count truncated to `unsigned`, as Type.cpp:182 does. Tests: `[4294967296 x i8]`, `{ [2 x <vscale x 4 x i32>] }` (unsized) and `{ <vscale x 4 x i32>, <vscale x 4 x i32> }` (the sized exception) globals in the pointer icmp test. |
| N6 | done | `abi_consts.test.ts` (cg-abi-consts' file): the call-site test asserts that every one of the 7 callees' calls is in the model's text, as the oracle side already did. |
| N7 | done | `folder.oracle.test.ts`: GEPs without `inbounds` (offsets 0 and 4, folded builder GEPs with no flags) join the pointer icmp test. |
| N8 | done | `docs/handoff/llir-folder.md`: "11 tests" corrected to 10. |

## Evidence (AC power, `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`)

- **Each new test fails without its fix.** I reverted each fix in turn and restored it:
  - no `isSized` guard → the `and` test fails (N4);
  - no truncation in `isEmptyTy` → the icmp test fails (N5);
  - `isInBounds()` ignored → the icmp test fails (N7).
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check --offline`: `markers ok (26758, 46 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311;
  library 745; llvm 430)`, one more `llvm` marker (`Type.h:326 isSized`).
- `bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts`, twice: 229 pass, 0 fail (13.8 s, 12.1 s).
- `bun test ./scripts/lib/unit-steps.test.ts`: 10 pass.

## `unported(...)` added

None. The first version stopped on a struct with a scalable vector element; the F1 fix ports the rule instead.

No new `// PORT:` decisions. The existing one in `getPointerAlignment` moved inside the `isSized` branch, unchanged.

## Re-check of review llir-folder-notes

- **F1** fixed as above. Undoing it (checking only for a direct scalable element) reproduces the reviewer's difference: libLLVM keeps `icmp eq ptr @g0, @g70` and `icmp ne ptr @g0, @g70`, and the model folds them. Removing the homogeneous exception fails the test too, so the second struct is not vacuous.
- **N-b**: the ARM test asserts that the first name after the ARM block looks up to its own ID, so the loop provably stopped inside the table.
- **N-c**: `isSized`'s docstring lists the byte type (`ByteTyID`) among the types the model lacks.
- **N-d**: the N4 row cites Value.cpp:1008.
- **N-a** (an attribute address reused after `LLVMContextDispose`, for every kind): left for a recorder batch, as root asked.

- Final runs after the re-check (AC power, a gate running on main; no samples): `bunx tsc --noEmit -p .` clean; `bun scripts/coverage.ts --check --offline`: `markers ok (26758, 46 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 745; llvm 434)`, four more `llvm` markers than before (`StructType::isSized`, `containsHomogeneousScalableVectorTypes`, `containsHomogeneousTypes`, `StructType::isScalableTy`); `bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts`: 239 pass, 0 fail.

## For root

- `abi_consts.test.ts` belongs to cg-abi-consts. The change only adds an assertion.
- Merging `t3/n1-name-anon` as well adds the `anon` proof case, which brings the same test command to 231.
