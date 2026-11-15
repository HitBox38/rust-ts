# Re-check: lane `ir-fix-b` (wave 40s), review round 1

Reviewer, read-only on code. Subject: `9ea5a946` on `t3/add-aarch64-llvm-intrinsics`, over `24295013` (`git diff 24295013 9ea5a946`).
The first review is `docs/reviews/ir-fix-b.md` at `26fd05f8`: FAIL on F1, with nits N1-N4. Root took option (a) for F1 (history
2026-11-15T01:19, "fat-LTO path through llvm-link merges ..."). Review branch `t3/review-ir-fix-b-recheck-9ea5a946`, at `9ea5a946`.

Upstream was read at the pin. LLVM `aab11ee0ea5e`'s `IRMover.cpp`, `LinkModules.cpp`, `llvm-link.cpp` and `Type.cpp` were fetched raw
into the scratchpad, since they are not pinned yet. The manifest was not touched.

## Verdict: **PASS WITH NOTES**

- **F1 is closed as root's option (a) asks.** The 9 fat-LTO cases in ir-host stop by name and the other 2 MATCH. The programs still
  MATCH in run-pass-native. The flag catches every merge that llvm-link's first link makes on its own.
- **One hole remains (note 1).** If a later source defines a type under the name a merge freed, the flag misses the merge, and the
  result is a silent DIFF. Reproduced against libLLVM. It needs a same-named type with a different body, which rustc's naming makes
  unlikely, and it is not seen in any case. The fix is one line.
- **N1 is right against IRMover and LinkModules.** Each rule matches the code, and every fallback gives llvm-link's order. The
  reviewer's repro and two new libLLVM cases (`extern_weak`, `available_externally`) give libLLVM's order.
- **Dropping the second llvm-link run changes no output.** All 11 linked modules are byte-identical before and after.
- N2-N4 are done.

## Commands (AC power; `.env.local` from integ-w39 plus `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`; `RUST_TS_AGENT=review-irfixb-rc2`)
| command | result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check` | `markers ok (27227, 82 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library 745; llvm 528)` |
| `bun test ./src/rust_ts/ ./src/rustc_codegen_llvm/ ./scripts/lib/unit-steps.test.ts` | **443 pass, 0 fail**, 44 files (the handoff's count) |
| `difftest --suite run-pass-native --sample 200 --jobs 6` (`rv-irfixb-rc-rpn`) | MATCH 188, UNPORTED 7 (cg-asm 2, DIBuilder 2, cg-intrinsic-b 3), UNSTABLE 5, **DIFF 0**; none of the 12 non-MATCH ids is in `harness/baseline/run-pass-native.txt` |
| `difftest --suite ir-host --sample 200 --jobs 6` (`rv-irfixb-rc-irh`) | MATCH 192, UNPORTED 8 (cg-asm 2, DIBuilder 2, cg-intrinsic-b 3, `rustc_log::BacktraceFormatter` 1), **DIFF 0**; none is in `harness/baseline/ir-host.txt` |
| `difftest --suite ir-host --filter lto` / `--filter issue-64655` (`rv-irfixb-rc-irh-lto`, `-64655`) | the 9 fat-LTO cases are **UNPORTED** `llir: fat LTO merged named struct types (llvm-link's IRMover; rustc's in-process link keeps them)`; `lto/fat-lto.rs` and `lto/lto-many-codegen-units.rs` **MATCH**. The filters' other cases: thin LTO stays UNPORTED (D8); `thin-lto-global-allocator`, `thin-lto-inlines` and `weak-works` are DIFF (the known D8 ThinLocal class); the `#no*` revisions MATCH |
| `difftest --suite run-pass-native --filter` `panic-runtime/lto-unwind` and `issue-64655-extern-rust-must-allow-unwind.rs#fat1` | both **MATCH** |
| `RUST_TS_REQUIRE_PROBES=1 bun test link.oracle.test.ts` | 4 pass, including the N1 repro (libLLVM's `f,g,h`) and the F1 test |

The 9 stopping cases are:
- `abi/stack-probes-lto.rs#aarch64`;
- `extern/issue-64655-allow-unwind-when-calling-panic-directly.rs#fat`;
- `extern/issue-64655-extern-rust-must-allow-unwind.rs#fat0`, `#fat1`, `#fat2` and `#fat3`;
- `lto/lto-still-runs-thread-dtors.rs`, `panic-runtime/lto-abort.rs` and `panic-runtime/lto-unwind.rs`.

The handoff gives counts only, not these ids (note 5).

## 1. F1: the merged-types flag

**Where the flag is checked.**
- `LLVMRustLinkerFree` compares the names in the destination's `%T = type` lines with the names in the final text, and flags the
  module if one is missing.
- `assert_types_unmerged` stops on the flag at three places: `LLVMRustPrintModule` (core.ts), `LLVMWriteBitcodeToFile` and
  `LLVMRustModuleSerialize`.
- `LLVMCloneModule` copies the flag.
- Objects are untouched: `LLVMRustWriteOutputFile` has no check, and run-pass-native still MATCHes.

**Sound for every merge made by llvm-link's first link.**
- In that link, the destination is linked as a *source* into the empty `Composite`.
- A type isomorphic to one already placed is mapped to it, and its own name is cleared with `STy->setName("")`
  (IRMover.cpp:229-231, `findNonOpaque`).
- In rustc, `IRMover::IRMover` seeds the set from the destination (IRMover.cpp:1670-1678) and never remaps the destination's types.
- So every merge removes a name the destination's text defines. Later links only map source types, so they cannot merge two
  destination types.
- When the destination has no isomorphic pair, each of its types is the only one with its body in both linkers. A source type then
  maps to the same type in both. Checked against libLLVM (scratch case RC-F: a source `%S = type { i32 }` and `%A.N`), and the
  result is the same and not flagged.

**Not sound when a later source takes the freed name (note 1).**
- llvm-link loads each input only after linking the previous one (llvm-link.cpp:380-450, `linkFiles`). By then, the merged type's
  name is free in the context.
- A source type with that exact name gets it without a `.N` suffix (Type.cpp:632-671). `computeTypeMapping` matches by name only
  for suffixed names (IRMover.cpp:749-751), so this type is not mapped by name.
- If its body is isomorphic to the representative, `findNonOpaque` maps it and clears the name again. The name is still missing,
  so the module is flagged.
- If its body is different, it keeps the name, so the name is present and nothing is flagged.
- Scratch case RC-E against libLLVM shows it:
  - The destination is `%A = type {}`, `%B = type {}`, `@a`, `@b`. The source is `%B = type { i32 }`, `@sb`.
  - libLLVM prints `%B = type {}`, `%B.0 = type { i32 }` and `@b = global %B`.
  - The model prints `%B = type { i32 }` and `@b = global %A`, and is **not flagged**: `LLVMWriteBitcodeToFile` returns -1 rather
    than stopping.
- It is a DIFF, never a false MATCH, because the text differs.

**False flags are harmless.** One case stops without any merge (scratch RC-G):
- a destination type used only by a value that the keep global cannot hold, here an unused `internal addrspace(1)` global;
- llvm-link drops the value, so its type goes too, and the module is flagged.

That output was already a DIFF, because the global is missing, so the flag turns a DIFF into a stop and nothing more. It does make
one sentence inexact, both in the header and in handoff PORT 2: "every destination type is used by a value the keep global retains".
That is note 3.

**The test bites.** I changed the check in `LLVMRustLinkerFree` to `... && false`. The F1 test of link.oracle.test.ts then fails, and
the other 3 pass. Removing the flag copy in `LLVMCloneModule` also fails that test. Both reverted.

## 2. N1: restore by name

Each rule against the pin:

| rule (`touchedBySources`) | upstream | right? |
|---|---|---|
| A local destination or source value never links by name | `getLinkedToGlobal` returns null when either side is local (IRMover.cpp:362-380, LinkModules.cpp:81-100) | yes |
| A non-local destination `declare` that a source defines is replaced (moved to the end) | `linkIfNeeded`: with a destination value and a source definition, `shouldLinkFromSource` gives `DestIsDeclaration` and `LinkFromSrc` (LinkModules.cpp:277-280, 380-401). `linkGlobalValueProto` creates the new value at the end and RAUWs the old one (IRMover.cpp:965, 1011-1017). This also holds for a source `available_externally` or `linkonce_odr` definition (`!Src.isDeclaration() && Dest.isDeclaration()`, :273), and for a destination `declare extern_weak` | yes |
| A destination `define` (external) that a source also defines is untouched | A strong source definition is a multiply-defined error. A weak, linkonce or `available_externally` source gives `LinkFromSrc = false` (:273, 303-314) | yes |
| A destination `linkonce`/`weak`/`available_externally`/`common`/`extern_weak` definition that a source defines falls back | `shouldLinkFromSource` decides by both linkages. The fallback is conservative: a destination `weak` with a strong source is always replaced (:316-320) | safe |
| A non-local, non-appending destination global that a source declares or defines is moved | The reordering loop maps *every* non-appending source global, declaration or definition. Through `linkGlobalValueProto`, a same-named destination global maps to itself, and the loop then moves it to the end (IRMover.cpp:1584-1599). A source global with no destination match maps to null (`DoneLinkingBodies`, :962) | yes |
| An appending global stays in place | `linkAppendingVarProto` creates the merged global with `InsertBefore = DstGV` and RAUWs (IRMover.cpp:879-893); the reordering loop skips appending globals | yes |

**The fallbacks are safe.** `restoreDestinationOrder` falls back to llvm-link's order unless `out` starts with exactly the predicted
untouched names. The cases:
- **An under-prediction would be the dangerous case**: a moved value predicted untouched could pass the prefix check if it came first
  in the tail. On darwin, the table above leaves no such case.
  - The only remaining path that moves a destination value is the exact-definition prototype path (IRMover.cpp:953-957). It needs a
    source definition that is not in `ValuesToLink` while the destination has a declaration, which happens only through comdats.
  - Even then the value is moved, and the rule says touched.
- **An over-prediction** (predicted touched, actually untouched) can pass the check, and the value then goes to the tail. That is a
  DIFF only.
  - On Linux, a `ComdatFrom::Dst` source definition of a destination declaration can do this (LinkModules.cpp:387-392). Darwin
    emits no comdats. See note 4.
- **A renamed local** (`forceRenaming` gives `x.N`) fails the name check and falls back.
- **An alias, an ifunc or an unnamed global** makes `cutModuleText` return undefined, and the order falls back.

In every case the output is either rustc's order or llvm-link's, so a wrong prediction can only DIFF.

**Repro and the extra cases.** Each was checked against libLLVM `LLVMLinkModules2`, in a scratch copy of link.oracle.test.ts:
- The reviewer's N1 repro (in the lane's test) gives `f,g,h`, as libLLVM does.
- RC-A: a destination `declare extern_weak void @h()` after `@llvm.compiler.used = [@f, @g]`, which a source defines. Model and
  libLLVM are identical: `f,g,h`.
- RC-D: a destination `@w = extern_weak global i32`, which a source defines. Identical (`a,p,w`).
- RC-C: a destination `@x = available_externally global i32 1`, which a source defines next to a new `@y`. Identical (`a,p,y,x`).
- RC-B: a destination `define available_externally void @h()`, which a source defines. This is the fallback path, and it is
  identical here because llvm-link's order happens to be libLLVM's.

**The tests bite.** I dropped the `appending` exception in `touchedBySources`. Two tests then fail: link.oracle's main test and
tools.test's `touchedBySources` test. Reverted.

## 3. Other behaviour: the second llvm-link run

- `c0` came from linking the destination alone, and it was read only by the old `restoreDestinationOrder`. Nothing else used it.
- I ran `scripts/ir-diff.ts --suite ir-host` on all 11 fat-LTO cases twice:
  - **old**: `src/rust_ts/llvm/` at `24295013`;
  - **new**: `9ea5a946`, with `assert_types_unmerged` disabled so that the 9 merged cases print.
  - Runs `rv-irfixb-rc-old-N` and `rv-irfixb-rc-new-N`.
- **All 11 subject `.ll` files are byte-identical** between old and new. They are 183 to 16731 lines.
- `fat-lto.rs` and `lto-many-codegen-units.rs` are the same at N1 as the oracle. The other 9 first differ at a named struct type, for
  example `%"alloc::alloc::Global"` against `%"core::marker::PhantomData<u8>"`. That is the class F1 stops.
- The tree was restored afterwards with `git checkout 9ea5a946 -- src/rust_ts/llvm/`, and is clean.

## Notes

1. **The F1 flag misses a merge when a later source takes the freed name** (`tools.ts`, `LLVMRustLinkerFree`, the `linkedTypes`
   check).
   - After the first link clears the name of a merged destination type, a source type of that exact name with a different body gets
     the name, so the name is present again. Repro is RC-E above: a silent DIFF, not a stop.
   - Fix: compare whole definition lines rather than names. That means flagging when any `%T = type …` line of the destination
     text is not a line of the result.
   - That is sound because rustc never changes the destination's types, so each such line is printed again unchanged. A changed
     nested type changes the line that refers to it, and that nested type's own line is checked too.
   - Not seen in any case. It needs two different bodies under one LLVM type name, and rustc names types after the Rust type. Do it
     when this code is next touched, and add RC-E to link.oracle.test.ts.
2. **One more type-name divergence for PORT 1-2's list, next to N4's `LastUnique`.** This one is from reading the source; I did not
   reproduce it.
   - rustc parses each source into the destination's own `LLVMContext`. That context also holds the types of its codegen and earlier
     parses, including ones the module no longer uses, and the counter `NamedStructTypesUniqueID` (Type.cpp:659-671).
   - llvm-link's context starts with only the destination's text.
   - So a source type that no destination type absorbs, whose name collides with a type the context holds but the module no longer
     uses, gets a `.N` suffix in rustc and none in llvm-link. The suffix numbers can also differ.
   - That is a DIFF only. One line in the PORT would save the next auditor the search.
3. **The "every destination type is used by a value the keep global retains" sentence is too strong** (`tools.ts` header, handoff
   PORT 2).
   - Values that `keepAllLine` leaves out cannot keep their types: intrinsics, `llvm.*` globals and values in other address spaces.
     When such a value is dropped, its type goes too, and the flag fires falsely (RC-G).
   - This is harmless, because that output is already a DIFF, since the value is missing. The sentence should say "only a merge, or a
     dropped value the keep global cannot hold, removes one".
4. **The N1 fallback claims are right for darwin. On Linux, comdats add one over-prediction.**
   - A destination declaration whose source definition is in a comdat that `ComdatsChosen` takes from the destination is not
     replaced (LinkModules.cpp:387-392). The model still marks it touched.
   - The result is a DIFF at most. The aarch64 Linux target makes it reachable later.
   - Comment-level only: no change is needed while the IR suites run on the darwin host.
5. **The handoff gives the fat-LTO cases as counts, not ids.** The re-check brief expected the 9 stopping cases to be listed. They are
   in §"Commands" above, so root can name them in the integration record.

## For root
- The first review's "For root" items still stand:
  - pin `IRMover.cpp`, `LinkModules.cpp`, `llvm-link.cpp`, `Internalize.cpp` and `GlobPattern.cpp`, and also `llvm/lib/IR/Type.cpp`
    for notes 1-2;
  - record `llvm-link`'s hash;
  - regenerate `ffi.ts` at integration.
- The 9 cases × 3 IR suites move from UNPORTED (`LLVMRustModuleCost`) to UNPORTED (the merged-types stop), so no protected case
  changes there. run-pass-native gains the 10.
