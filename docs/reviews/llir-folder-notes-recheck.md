# Re-check: llir-folder-notes fix (review llir-folder-notes F1, N-b, N-c, N-d)

Reviewer: independent, read-only on code. I reviewed `git diff 0a1df849..df75a76d` (branch `t3/llir-folder-notes`) against
the first review (`dc1ea55c:docs/reviews/llir-folder-notes.md`). I merged `df75a76d` into this worktree, which is based on main
`e488e464`. I checked against LLVM at the pin (`harness/llvm-manifest.json`, `aab11ee0`,
`$RUST_TS_DATA/llvm-src/aab11ee0.../llvm/`).

**Verdict: PASS WITH NOTES.** F1 is fixed by a full port of `StructType::isSized`. The regression test catches both rules, and
undoing either one fails it. N-b, N-c and N-d are done as described. Nothing else changed, and no check is weaker. One test gap
is left (R1): it is optional, and nothing is wrong today.

## Environment

AC power (`pmset`: "Now drawing from 'AC Power'", 100%, charged). `.env.local` came from integ-w39, with
`RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0`. No open STOP. I took no samples, did not touch the main checkout, and did not
touch the oracle toolchain. I ran every mutation in this worktree and restored it with `git checkout -- src/rust_ts/llvm/fold.ts`.
The tree was clean afterwards.

## Commands

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean (exit 0) |
| `bun scripts/coverage.ts --check --offline` | `markers ok (26758, 46 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 745; llvm 434)`. This matches the handoff: four more `llvm` markers than the 430 at `0a1df849`. |
| `bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts` | 241 pass, 0 fail, no skips (16.0 s). The handoff reports 239. The 2 extra tests come from main's `proof.oracle.test.ts` / `proof/anon.*` (n1-name-anon), which are in this worktree's base but not in the author's. |

## F1, against the source

- **`StructType::isScalableTy`** (Type.cpp:504), now `structTypeIsScalableTy` at `src/rust_ts/llvm/fold.ts:1011-1018`. It
  returns false when `Visited` already holds the struct, adds it, and returns true on the first element for which
  `isScalableTy(Ty, Visited)` holds. Otherwise it returns false. This is the same as LLVM. The two `SCDB_*ContainsScalableVector`
  flags only cache the answer: the model recomputes each time, and a body is set at most once, so the answers agree. LLVM also
  declines to cache "not scalable" for an opaque struct, and the model has no cache, so that difference does not matter. It is
  the same logic as the inline arm it replaces (behaviour-preserving for `foldGEP`'s caller at :1022).
- **`Type::isScalableTy`** (Type.cpp:61), at `fold.ts:1002-1009`. Arrays go to the element type, structs go to the struct form,
  and anything else is checked with `getTypeID() == ScalableVectorTyID`. The model's `VectorType` takes typeID
  `"ScalableVector"` when `scalable` is set (`ir.ts:178`), so the check is the same. `isScalableTargetExtTy()` is false because
  the model has no target extension types, and the docstring says so. The default `new Set()` matches the no-argument overload
  (Type.cpp:69-72). This is faithful.
- **`StructType::isSized`** (Type.cpp:722), at `fold.ts:724-740`, ported in full and in the same order: opaque → false;
  `containsHomogeneousScalableVectorTypes()` → true; then for each element, `isScalableTy()` (with a fresh `Visited`, as in
  LLVM) → false, and `!isSized` → false; at the end, true. The model skips the `Visited` self-containment check. The `isSized`
  docstring (:711-713) explains why: with opaque pointers no struct can contain itself, and the model never passes a `Visited`
  set. LLVM's top-level `isSized()` passes `nullptr` too. `SCDB_IsSized` only caches the answer, and the docstring says so.
  The upstream comments are kept.
- **`containsHomogeneousScalableVectorTypes`** (Type.cpp:587), at `fold.ts:742-747`. `getNumElements() <= 0 ||
  !isa<ScalableVectorType>(front)` is the same as `elements.length <= 0 || elements[0].typeID !== "ScalableVector"`.
- **`containsHomogeneousTypes`** (Type.cpp:593), at `fold.ts:749-754`. It is `!empty() && all_equal(...)`, with identity
  standing in for equality. That is sound: `Context.getVectorType`, `getArrayType` and `getLiteralStructType` unique by key
  (`ir.ts:1896-1925`), as LLVM uniques types per context.
- `isSized` (`fold.ts:714-722`) keeps the `Type.h:326` order. Its docstring adds `ByteTyID` (N-c). The four new markers cite the
  right lines: I checked Type.cpp:504, :587, :593 and :722 each against the file.

## F1, behaviour (pointer icmp test vs libLLVM)

The test adds `{ [2 x <vscale x 4 x i32>] }` (globals g70-g79) and `{ <vscale x 4 x i32>, <vscale x 4 x i32> }` (g80-g89)
(`src/rust_ts/llvm/folder.oracle.test.ts:556-559`, plus the `LLVMScalableVectorType` dlopen entry at :78). At `df75a76d` the
test passes, so the model and libLLVM agree on both: the first is unsized, and the second is sized.

| Mutation in `fold.ts` | Result |
|---|---|
| none | pass |
| A: undo F1. In `structTypeIsSized`, `isScalableTy(Ty)` → `Ty.typeID === "ScalableVector"` (direct elements only) | **fail**. The model folds `icmp eq ptr @g0, @g70` to `i1 false` and `icmp ne` to `i1 true`, and libLLVM keeps both. That is 528 differing tagged lines, the same as the first review's reproduction. |
| B: drop the homogeneous exception (`if (false && containsHomogeneousScalableVectorTypes(t))`) | **fail**. libLLVM folds `icmp eq/ne ptr @g0, @g80`, and the model keeps them as instructions. The function-text comparison catches it. |
| C: drop the array arm of `Type::isScalableTy` | **fail**, with the same `@g70` difference as A |
| E: drop the `front is ScalableVector` test in `containsHomogeneousScalableVectorTypes` | **fail**. A one-element `{ [2 x <vscale ...>] }` is homogeneous, so it becomes sized. |
| D: `containsHomogeneousTypes` → `!empty()` (drop `all_equal`) | **passes**. See R1. |

So the test fails if either rule asked for is undone: the array look-through (A, C) and the homogeneous exception (B).

## N-b, N-c, N-d

- **N-b** (`folder.oracle.test.ts:676, 686-689, 694-696`): done. The loop records the first non-ARM `(id, name)` after the block.
  The test then asserts that it exists and that `LLVMLookupIntrinsicID(name) === id`. This is the check the first review
  suggested. It turns the "sorted by target, ARM not last" assumption into a test failure.
- **N-c** (`fold.ts:711-712`): done. The docstring now lists "no byte type (`ByteTyID`, primitive and sized at the pin)", which
  matches Type.h:327-329.
- **N-d** (`docs/handoff/llir-folder-notes.md:12`): done. It cites Value.cpp:1008, where `if (ObjectType->isSized())` is at the
  pin. No `Value.cpp:1005` remains in the handoff or in `fold.ts`.

## Regressions and scope

- The diff touches only `src/rust_ts/llvm/fold.ts`, `src/rust_ts/llvm/folder.oracle.test.ts` and
  `docs/handoff/llir-folder-notes.md`. Nothing changed in `scripts/`, `harness/`, the baselines, the suites or `llvm-src/`.
- The `unported("llir: StructType::isSized of a struct with a scalable vector element ...")` is removed, because the rule is
  now ported. The handoff's `unported` section says so.
- No assertion is removed or loosened. The test only gains type rows and the two N-b assertions. The existing
  `toBeGreaterThan(100)` folded-result floor and the full function-text comparison are unchanged.
- `isScalableTy`'s refactor keeps the same behaviour for `foldGEP` (`fold.ts:1022`).
- N-a (attribute address reuse after `LLVMContextDispose`) is still deferred to a recorder batch, as the handoff says.

## Findings

- **R1** (optional, test gap) `src/rust_ts/llvm/folder.oracle.test.ts:559`. No row covers a struct of *different* scalable
  vector types, such as `{ <vscale x 4 x i32>, <vscale x 2 x i64> }`, which LLVM calls unsized because `all_equal` fails.
  Because of that, weakening `containsHomogeneousTypes` (`fold.ts:753`) to `!empty()` still passes (mutation D). The code is
  right today. One more `types` row would pin it.
- **R2** (information only) `folder.oracle.test.ts:613-614`. Each tagged line uses the *model's* `isInst` for both sides. So
  when the model keeps an instruction and libLLVM folds it (mutation B), the tagged lines agree, and only the function-text
  comparison at :627-629 catches the difference. It does catch it. This is the existing design, not changed here, and I have
  noted it only so a later edit does not drop the function-text check.

## For root

F1 is closed, and N-b, N-c and N-d are closed. `t3/llir-folder-notes` at `df75a76d` can merge. R1 is a one-row test addition for
whoever touches the file next. N-a stays with the recorder batch.
