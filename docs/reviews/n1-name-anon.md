# Review: harness batch `n1-name-anon` (changes `scripts/`)

Reviewer, independent and read-only (AGENTS.md §1, §2). Branch `t3/n1-name-anon`, commit `421de575`, against `main`
(merge-base `95f42fff`). Handoff: `docs/handoff/n1-name-anon.md`.

**Verdict: PASS WITH NOTES.** No must-fix findings. Three nits, all about wording in comments or the handoff. None of them
changes what the normal form does.

## What I checked

### 1. Order of passes

- `PassWrapper.cpp:992-997` at the pin runs, under `if (NeedThinLTOBufferPasses)`:
  1. `CanonicalizeAliasesPass`
  2. `NameAnonGlobalPass`
  3. `AssignGUIDPass`, behind `LLVM_VERSION_GE(23, 0)`. The pinned toolchain's `opt` reports LLVM 23.1.3, so the pass runs.
- N1's `name-anon-globals,assign-guid` is therefore rustc's order, minus `canonicalize-aliases`. The handoff says why that pass
  is left out (the owner asked for name-anon-globals only).
- `NeedThinLTOBufferPasses` is cleared for `PreLinkThinLTO`, `PreLinkFatLTO` and `FatLTO` (`PassWrapper.cpp:961, 970`). See N1.
- **The claim that `assign-guid` first gives a wrong `!guid` holds.** I set N1 to `assign-guid,name-anon-globals,verify` and
  ran the `anon` proof case. It fails, and the only differing line is the guid metadata:
  `- !9 = !{i64 2279403125147009485}` / `+ !9 = !{i64 1717521279088806947}`.
  The guid is computed while the global is still unnamed, and renaming it afterwards does not recompute it.

### 2. Does the normal form still catch real differences?

I compiled `scripts/fixtures/ir/mut.rs` with the pinned rustc, using the test's own flags. Its IR has two globals,
`@anon.803b….0` and `@anon.803b….1`, and no `@N`. I applied the mutations and ran `opt` directly under each pass list.

**No mutated text is "caught" only because it fails to parse.** This matters because the test counts an `ERROR` as caught.

**The three new mutations:**

| Mutation | New N1 | Old N1 | assign-guid first |
|---|---|---|---|
| anonymous globals printed unnamed (`ALWAYS_ABSORBED`) | absorbed | caught | caught |
| a named global printed unnamed | caught (2 lines) | caught | caught |
| an anonymous global's name wrong | caught (19 lines) | caught | caught |

All three are meaningful:

- **The absorbed one** is exactly what the model writes today: `@0` with no `!guid`.
- **"A named global printed unnamed"** is the obvious way this change could hide a bug, and it stays caught. The renamed
  global gets an `anon.` name, and it even collides with the existing `@anon.<h>.0`, so it comes out `….0.1`.
- **"An anonymous global's name wrong"** confirms that the pass leaves existing names alone, on either side.

**Extra adversarial edits under the new N1** (my own, not in the batch). Each starts from the oracle's text with its anonymous
globals printed unnamed:

| Edit | Result |
|---|---|
| definitions of `@0`/`@1` swapped | caught |
| uses of `@0`/`@1` swapped | caught |
| one global changed `private` → `internal` | caught |
| an extra unnamed global | caught |
| the oracle's two named `@anon` definitions swapped | caught |

**How the hash behaves.** I ran `opt -passes=name-anon-globals` at the pin on small modules:

- The hash depends on the **names and order** of the module's non-local definitions. Swapping `@f` and `@g` changes it.
  Making `@g` internal changes it.
- It does **not** depend on function bodies, on the anonymous constants' contents, or on declarations.
- `<n>` counts unnamed globals in module order.

So the name given to an unnamed global depends only on things that are visible in the text anyway: the definition lines and
the position of the global. **Two texts that differ in anything other than "unnamed vs. its correct `anon.` name" still differ
after the pass.** I found no way to hide a divergence.

What can still go wrong is a false difference, which is the safe direction. If rustc ran the pass on an earlier module state
than the one it printed, the oracle's names can disagree with what the pass computes on the model's final module. This can
happen when `buildThinLTOPreLinkDefaultPipeline` names the globals and later passes then delete or change definitions. The
result is a reported difference, not a hidden one.

### 3. The new proof case `anon`

- **It is recorded from the pinned rustc.** Under `RUST_TS_REQUIRE_PROBES=1`,
  `bun test src/rust_ts/llvm/proof.oracle.test.ts -t anon` passes both tests (2 pass, 0 fail). The oracle test re-records with
  the pinned toolchain and requires the fresh script to equal the committed `proof/anon.script`.
- **New N1:** passes.
- **Old N1 (`assign-guid,verify`):** fails, as expected. The failing lines are listed in N3.

### 4. Baselines and caches

- **No protected suite reads N1.**
  - The only suite that reads N1 is `ir-hello`. It is built by `irSuite` (`harness/suites.ts:2118`, defined at `:2224`),
    and there is no `harness/baseline/ir-hello.txt`.
  - The other users run no suite: `scripts/ir-diff.ts` (uncached, a report), `scripts/ir-tiers.ts`, the proof test, and
    `scripts/ir-normal.test.ts`.
  - `harness/host-rlib.test.ts` and `harness/rlib-native.test.ts` mention ir-run only in comments.
- **The oracle cache re-keys.** `irToolsKey` (`harness/suites.ts:2101-2112`) hashes `scripts/lib/ir-normal.ts`, and the
  pass list lives in that file. Cached IR oracle normal forms therefore re-key on their own.
- **No baseline, oracle output or suite definition changed.**

### 5. Scope

The diff touches 8 files:

- `scripts/lib/ir-normal.ts`
- `scripts/lib/ir-mutations.ts`
- `scripts/ir-normal.test.ts`
- `scripts/ir-tiers.ts` (uses `OPT_PASSES.N1` for its bitcode check instead of a copied string)
- `src/rust_ts/llvm/proof.oracle.test.ts`
- `src/rust_ts/llvm/proof/anon.rs`
- `src/rust_ts/llvm/proof/anon.script`
- `docs/handoff/n1-name-anon.md`

Nothing under `harness/`, and nothing else under `scripts/`. All of it is in scope.

### 6. Commands

Run after merging `421de575` into the review worktree, with `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`. The
machine was on **AC power** (`pmset`: "Now drawing from 'AC Power'").

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p .` | exit 0 |
| `bun scripts/coverage.ts --check --offline` | `markers ok (26758, …)`, exit 0 |
| `bun test scripts/ir-normal.test.ts scripts/ir-diff.test.ts scripts/ir-sides.test.ts ./src/rust_ts/llvm/` | 182 pass, 0 fail |
| `bun test ./scripts/lib/` (every `scripts/lib/*.test.ts`) | 261 pass, 0 fail |
| `bun test src/rust_ts/llvm/proof.oracle.test.ts -t anon` | 2 pass |
| the same, with N1 set to `assign-guid,verify` | 1 fail |
| the same, with N1 set to `assign-guid,name-anon-globals,verify` | 1 fail |

For the last two runs I edited the pass list temporarily and restored it with `git checkout`. The tree was clean afterwards.

## Findings

No F (must-fix) findings.

- **N1** `scripts/lib/ir-normal.ts:6`: "the two that `LLVMRustOptimize` runs on every module whose text the oracle prints" is
  too strong.
  - The block runs only when `NeedThinLTOBufferPasses` is set, and that flag is false for `PreLinkThinLTO`, `PreLinkFatLTO`
    and `FatLTO` (`PassWrapper.cpp:961, 970`).
  - So line 8 ("On the oracle's text they change nothing") does not hold for fat-LTO output. There the pass renames on both
    sides alike.
  - The handoff already says this correctly. Suggest saying it in the header too, e.g. "on every module whose
    `NeedThinLTOBufferPasses` is set".
- **N2** `scripts/lib/ir-normal.ts:25-26`: "a definition missing, extra, renamed or moved changes every anonymous name" is
  not quite true.
  - The names are hashed joined together with no separator. At the pin, `define @f` + `define @g` hashes the same as
    `define @fg` (both give `anon.3d4044d6….0`).
  - Declarations are not hashed at all.
  - It does no harm, since such a difference shows in the definition lines anyway. But the sentence claims more than the
    pass does: "usually changes", or naming the no-separator caveat, would be accurate.
- **N3** `docs/handoff/n1-name-anon.md:35`: "it fails on exactly `- @anon….0` / `+ @0`, and nothing else" is not accurate.
  - Under the old N1 the case fails on 4 lines per side: the definition, its two uses (`load ptr, ptr @…` and the
    `getelementptr` load), and `!9 = !{i64 …}`. The guid differs because `assign-guid` hashed the unnamed global.
  - The conclusion stands. Only the wording is off.

Notes for root, no action needed in this batch:

- `canonicalize-aliases`, the first pass in the same block, is still not in N1. If the model ever prints aliases that the
  pass would canonicalize, that is a false difference, not a hidden one. The handoff already notes it for later.
- The decision record and the stale descriptions in `docs/plan-m7.md:83` and `docs/handoff/harness-m7a.md:61` are listed
  in the handoff's "For root" section.
