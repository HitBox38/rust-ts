# Handoff: n1-name-anon (owner decision after review llir-folder, item 10)

Branch `t3/n1-name-anon`, base `main` at `95f42fff`. **This changes `scripts/`, so per AGENTS.md §2 it needs its own independent
review before merge.** It does not touch `harness/`, baselines, oracle outputs or suite definitions.

## What and why

The oracle's IR text is printed after `LLVMRustOptimize`, which runs `CanonicalizeAliasesPass`, `NameAnonGlobalPass` and
`AssignGUIDPass` on every module whose text it prints (`PassWrapper.cpp:992-997`, under `NeedThinLTOBufferPasses`). N1 ran only
`assign-guid`. So any IR comparison saw the model's `@0` against the oracle's `@anon.<md5>.0`, and that was most bins: the
llir-folder lane needed an extra `opt -passes=name-anon-globals` step on the model's side to compare its samples.

The owner chose option 2 from review llir-folder: the normal form runs the pass on both sides. Every tier's `opt -passes=` is now
`name-anon-globals,assign-guid,...,verify`, in rustc's order. **The order matters.** With `assign-guid` first, the anonymous
global's `!guid` comes out wrong (checked: 2 differing lines on a real module, and the new mutation test fails).
`canonicalize-aliases` is not added, since the owner asked for name-anon-globals only. Note it for later: it is the third pass in
the same block.

## Files

| File | Change |
|---|---|
| `scripts/lib/ir-normal.ts` | `OPT_PASSES` exported; all three tiers run `name-anon-globals` before `assign-guid`. The header says what N1 now absorbs (unnamed globals' names) and what stays visible. |
| `scripts/lib/ir-mutations.ts` | One absorbed mutation, "anonymous globals printed unnamed" (`@anon.<h>.N` → `@N`, its `!guid` dropped). Two that must stay caught: "a named global printed unnamed" (`@alloc_…` → `@0`) and "an anonymous global's name wrong". |
| `scripts/ir-normal.test.ts` | Tier command expectations updated. The bitcode-path check uses `OPT_PASSES.N1` instead of its own copy. |
| `scripts/ir-tiers.ts` | The same, for its bitcode check. |
| `src/rust_ts/llvm/proof.oracle.test.ts`, `proof/anon.{rs,script}` | A new proof case, `anon`: `vec![1u8, 2, 3]` brings in `Global::alloc_impl`'s unnamed constant. The model prints `@0` and the oracle `@anon.d8d4….0`. It is recorded from the pinned rustc. |

## Evidence (AC power for the final runs; `RUST_TS_REQUIRE_PROBES=1`)

- The mutations run on real oracle IR (`scripts/fixtures/ir/mut.rs`, which has two `@anon` globals). With the old pass list, and
  with `assign-guid` first, "anonymous globals printed unnamed" is caught at all three tiers, so the test fails. With the new list
  it is absorbed and the two must-stay-caught mutations are caught. All three were checked.
- The `anon` proof case, end to end through record, replay, print and N1: it passes with the new N1. With the old N1 it fails on
  4 lines per side: the definition (`- @anon.d8d43945….0 = …` / `+ @0 = …`), its two uses (the `load ptr, ptr @…` and the
  `getelementptr` load) and `!9 = !{i64 …}`, whose guid differs because `assign-guid` hashed the unnamed global (corrected by
  fixers-56 after review n1-name-anon N3).
- `bunx tsc --noEmit -p .`: clean.
- `bun test` on `scripts/ir-normal.test.ts`, `ir-sides.test.ts`, `gate-probes.test.ts`, `lib/case-lock.test.ts`,
  `lib/unit-steps.test.ts`, `harness/host-rlib.test.ts` and `harness/rlib-native.test.ts`: 103 pass, 0 fail.
- `bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts`: 231 pass, 0 fail.
- `bun scripts/coverage.ts --check --offline`: `markers ok (26758, …)`.

## Effect on suites and the oracle cache

- **No protected suite reads N1.** The only IR suite is `ir-hello` (`harness/suites.ts:2226`), and there is no
  `harness/baseline/ir-hello.txt`.
- The IR suites' oracle key hashes `scripts/lib/ir-normal.ts` (`irToolsKey`, `harness/suites.ts:2108`). So their cached oracle
  normal forms re-key on their own; nothing stale is reused.
- On the oracle's side the pass is a no-op wherever `LLVMRustOptimize` already ran it. Where it did not (pipelines without
  `NeedThinLTOBufferPasses`, for example fat-LTO pre-link), it renames on both sides alike.

## For root

- Record the decision, for example `bun scripts/state.ts record decision "N1 runs name-anon-globals before assign-guid, as
  LLVMRustOptimize does (owner, after review llir-folder item 10)"`. I did not write `docs/state/`.
- `docs/plan-m7.md:83` and `docs/handoff/harness-m7a.md:61` still describe N1 as `assign-guid,verify`. They are historical
  records and I left them alone. The header of `scripts/lib/ir-normal.ts` is the current statement.
- This needs an independent reviewer: a `scripts/` change.
- No `unported(...)` and no `// PORT:` decisions in this batch.
