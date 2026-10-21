# Handoff: passes-dead (wave 21): rustc_passes dead.rs, canonical_symbols.rs, layout_test.rs, abi_test.rs

## Files
New:
- `src/rustc_passes/dead.ts`: port of `dead.rs`. Covers `MarkSymbolVisitor` with its intravisit `Visitor` impl
  (`Result = ControlFlow<ErrorGuaranteed>`), seeding, `live_symbols_and_ignored_derived_traits`, `DeadVisitor`,
  `check_mod_deathness`, `lint_dead_codes` and `provide`.
- `src/rustc_passes/canonical_symbols.ts`: port of `canonical_symbols.rs` (`canonical_symbols`,
  `all_canonical_symbols`, `provide`).
- `src/rustc_passes/layout_test.ts`: port of `layout_test.rs` (`test_layout`, `ensure_wf`, `dump_layout_of`,
  `UnwrapLayoutCx`). Every `RustcDumpLayoutKind` is supported, including `homogeneous_aggregate`.
- `src/rustc_passes/abi_test.ts`: port of `abi_test.rs`. `test_abi` and the dispatch / `AbiInvalidAttribute` paths are
  fully ported. What reads a `FnAbi` stops with `unported`, because `FnAbi` is still `Pending` (M4 callconv); see
  "unported" below.
- `src/rustc_passes/dead.oracle.test.ts` and `src/rustc_passes/oracle/dead_run.ts`: the oracle test and its driver.

Edited:
- `src/rustc_passes/lib.ts`: added `export * as abi_test / dead / layout_test`. `provide` now calls
  `canonical_symbols.provide` and `dead.provide` in upstream order.

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_passes/src/<f>.rs`:
- dead: 49/49
- canonical_symbols: 6/6
- layout_test: 7/7
- abi_test: 5/5
- lib: 1/1

`--check`: markers ok (17351). `bunx tsc --noEmit -p .` is clean.

## Wiring for root (no call site exists yet)
`analysis` in `src/rustc_interface/passes.ts` is still `unported`, so this lane added no call sites. When
`run_required_analyses` / `analysis` are ported (lint-late-a's `check_crate` goes in the same place), wire these:
- At the end of `run_required_analyses`, after MIR_borrowck:
  - `sess.time("layout_testing", () => layout_test.test_layout(tcx))`
  - `sess.time("abi_testing", () => abi_test.test_abi(tcx))`
  - Both are exported from `rustc_passes/lib.ts`.
- In `analysis` → `misc_checking_3`:
  - `tcx.par_hir_for_each_module((m) => tcx.ensure_ok().check_mod_deathness(m))` in the par_fns group, after
    `check_private_in_public`.
  - Later, `tcx.all_canonical_symbols(null)`, after `all_diagnostic_items`.
  - The providers are already installed through `rustc_passes.provide`.

`src/rustc_passes/oracle/dead_run.ts` already runs this sequence in upstream order and can serve as a reference.

## Tests
`dead.oracle.test.ts` has 12 cases. The oracle is the pinned rustc with `--emit=metadata`. The subject is the ported
driver, followed by:
- the tydump prefix
- `test_layout` and `test_abi`
- the abort on non-lint errors
- `effective_visibilities`, `check_private_in_public`, `check_mod_deathness`, `check_mod_privacy`
- `check_expectations`, `all_diagnostic_items`, `all_canonical_symbols`

Results:
- **Byte-identical stderr and exit code (9 cases):**
  - items, assoc items with mixed descr and the enum-variant-same-name note.
  - Named / tuple / repr(C) / PhantomData / ZST fields, more than 6 items ("multiple"), the derived-impls note.
  - allow/expect propagation, an unfulfilled `#[expect]`, `dead_code_pub_in_binary`, `#[no_mangle]`, `const _`.
  - A lib crate with reachable seeds and extern items.
  - Self-assignment, patterns, closures.
  - `#[rustc_dump_layout]` with every kind, layout errors (too big, generic) and a not-WF alias (E0277 through
    `ensure_wf`).
  - `#[rustc_abi]` on invalid targets.
- **Pending at a pinned UNPORTED point (2 cases):** `#[rustc_abi(debug)]` on a fn and on a fn-ptr alias. Both stop at
  the `PseudoCanonicalInput<(Instance|PolyFnSig, List<Ty>)>` query key cache.

Test runs:
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_passes`: 58 pass, 0 fail.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: 5408 tests (1 skip), 0 fail.

Corpus sweeps (not committed; same driver, upstream `//@ compile-flags` / `edition`, aux/revision tests skipped):
- **tests/ui/lint/dead-code (80):**
  - 61 byte-identical, 3 skipped.
  - 6 DIFF, all caused by passes this driver does not run: liveness `unused_variables`, the `unreachable definition`
    lint, and late lints `unused_must_use`. The dead-code warnings themselves match.
  - 10 UNPORTED: const eval (M4), and `mir_borrowck` reached via opaque types.
- **Every tests/ui file with `rustc_dump_layout` / `rustc_abi(` (41):**
  - 18 byte-identical, 7 skipped.
  - 1 DIFF: trivial-bounds-sized.rs, where the late lint `trivial_bounds` is not run, so its `#![expect]` shows as
    unfulfilled.
  - 15 UNPORTED: const eval, FnAbi query key, `NumScalableVectors::for_non_tuple`, non-host built-in targets,
    `mir_borrowck`.

Sample difftests against base `970d2365` (same seed, base run in a detached worktree). Identical, with no new DIFF:
- tydump-ui `--sample 300`: 259 MATCH, 0 DIFF, 38 UNPORTED, 1 TIMEOUT, 2 UNSTABLE, on both sides.
- tydump-minicore: 45/46 MATCH, 1 UNPORTED, on both sides.
- hir-tree `--sample 300`: 300/300 on both sides.

## unported(...) left
- `abi_test.ts` `debug_FnAbi_pretty`: `rustc_target::callconv::FnAbi Debug (M4 callconv)`.
- `abi_test.ts` `test_abi_eq`: `rustc_passes::abi_test::test_abi_eq: FnAbi fields / ArgAbi::eq_abi (M4 callconv)`.
- Reached through queries whose providers are unported:
  - `symbol_name` (rustc_symbol_mangling), in `canonical_symbols` on a foreign item with `#[rustc_canonical_symbol]`.
  - `fn_abi_of_instance*` / `fn_abi_of_fn_ptr` and their query keys.

## PORT decisions
- **dead-code liveness types:** `DeadCodeLivenessSnapshot` / `DeadCodeLivenessSummary` (rustc_middle
  `middle/dead_code.rs`, data only, not ported) are declared in `dead.ts`, with markers on the type definitions.
  - When rustc_middle `middle/dead_code.rs` is ported (or generated), root should move them there.
  - The query value is `Result<unknown, ErrorGuaranteed>` in queries.gen.ts; `dead.ts` casts it.
- **Containers:**
  - `live_symbols` (`LocalDefIdSet`, membership and clone only) is a `Set<LocalDefId>`.
  - `scanned` is a `Set<number>` keyed `id*2+flag`.
  - `ignored_derived_traits` is `Map<LocalDefId, DefIdSet>` (insertion-ordered inner set, as `FxIndexSet`). The
    pre-deferred snapshot deep-clones it.
- **`unsolved_map`:** this map is iterated (`extract_if`, `into_values`), and that order decides the worklist order. It
  is therefore a rust_ts `FxHashMap` (hashbrown order), with `u32_key` and a 24-byte `Vec` value layout.
  - `extract_if` is modelled as: collect the matches in iteration order, then remove them in that same order. This gives
    the same erase sequence, so the table state is identical.
- **`find_attr!(tcx, id, ..)`** goes through `HasAttrs_DefId` / `HasAttrs_LocalDefId`.
- **`MultiSpan::from_spans` sorts its argument in place**, so `ChangeToUnitTypeOrRemove` gets a copy of `spans` (as
  upstream's `spans.clone()`).
- **`UnwrapLayoutCx`** is a class implementing `LayoutOfHelpers` with `LayoutOfResult = MaybeResult_T`.

## Not done / notes for root
- No `analysis` call site; see "Wiring" above.
- `src/rustc_passes/oracle/dead_run.ts` uses `tydump_dump.run_required_analyses_prefix` (`check_crate` without const
  eval).
