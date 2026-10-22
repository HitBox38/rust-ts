# Handoff: mt-built-lints (M4 wave 22): the MIR lints of `mir_built` / `mir_promoted`

Branch `lane/mt-built-lints` (from `fe77b233`, no merges). Commits: `973a3399` the port, `12c6f904` oracle tests + the
check_unsafety repin, then this handoff.

## Result
Every assigned stub module is replaced with the whole port (mt-skeleton's layout; lib.ts untouched):
| upstream | fns | notes |
|---|---|---|
| rustc_mir_transform lint_and_remove_uninhabited.rs | 3/3 | `run_pass`, `policy` (`Required`), `find_unreachable_code_from` |
| check_inline.rs | 3/3 | `CheckForceInline`, `is_inline_valid_on_fn` / `_on_body` (exported for mt-inline) |
| check_call_recursion.rs | 9/9 | `CheckCallRecursion`, `CheckDropRecursion`, `Search` (a `TriColorVisitor`), `CallRecursion`, `RecursiveDrop` |
| check_packed_ref.rs | 4/4 | |
| check_const_item_mutation.rs | 6/6 | |
| check_mut_restriction.rs | 6/6 | present at the pin |
| function_item_references.rs | 7/7 | |
| ffi_unwind_calls.rs | 3/3 | `provide` now installs `has_ffi_unwind_calls` and `required_panic_strategy` |
| lint_tail_expr_drop_order.rs | 7/7 | + generated `lint_tail_expr_drop_order.gen.ts` |
| diagnostics.rs (the crate's) | 5/5 manual impls | + generated `diagnostics.gen.ts` (all 24 derives, incl. the ones other mt-* lanes need: liveness, inline, coroutine, known_panics_lint) |
| rustc_middle ty/significant_drop_order.rs | 4/4 | new file |
| rustc_const_eval util/alignment.rs | 2/2 | new file, **ahead of ctfe-util** (check_packed_ref calls `place_unalignment` for every borrow) |

- pass_manager.ts: the two `UnknownPassName` / `ValidPassNames` stops are now the diagnostics (mt-skeleton's table gave
  them to this lane).
- Coverage: rustc_mir_transform 166/1101 (was 113), rustc_const_eval 6/764, TOTAL 19223/25518.
  `bun scripts/coverage.ts --missing` is complete for every file above. `--check`: markers ok.
- Codegen: new set `rustc_mir_transform` in tools/codegen/types.sets.json (diagnostics.rs + lint_tail_expr_drop_order.rs;
  `DropsReachable` is `hand`), set-local type map `tools/codegen/mir_transform.typemap.json` (`mir::AssertKind`,
  `MovePathIndex`). Report: 0 unknown types, 0 missing debug/clone/diag-arg.

## mirdump stops (as `RUST_TS_AGENT=root-fe77`, compared case by case with root's base runs at `fe77b233`)
| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| mirdump-minicore (46) | `20261022-153516-root-fe77-kmin` | 16 / 0 / 30 / 0 | `…144421-root-fe77-qdzc` | 16 / 0 / 30 / 0 |
| mirdump-ui `--sample 300` | `20261022-153553-root-fe77-3uv6` | 0 / 0 / 299 / 0 (+1 unstable) | `…144709-root-fe77-3ska` | same |
| tydump-minicore (46) | `20261022-153752-root-fe77-kq3q` | 45 / 0 / 1 / 0 | `…144407-root-fe77-zgkc` | same |
| tydump-ui `--sample 300` | `20261022-153807-root-fe77-jew2` | 263 / 1 / 35 / 0 (+1 unstable) | `…144529-root-fe77-uc9z` | same |

No status changed in any suite; no new DIFF (the one tydump-ui DIFF is base's known `issue-118950-root-region.rs`).
Stops moved past this lane:
- mirdump-ui: 217 `LintAndRemoveUninhabited` + 7 `has_ffi_unwind_calls provider` → **222 `rustc_mir_dataflow::rustc_peek::sanity_check`**
  (the `SanityCheck` lint, last pass of `mir_built`; lane dataflow-impls), 1 `check_liveness` (mt-liveness), 1
  `Validator` (mt-validate). Unchanged: 37 `mk_const_alloc`, 20 `mir_borrowck`, 13 `eval_to_valtree`, 4
  `eval_to_const_value_raw`, 1 `DeprecationEntry::external`.
- mirdump-minicore: 26 `LintAndRemoveUninhabited` + 2 `has_ffi_unwind_calls` → 28 `sanity_check`.
- Upstream `sanity_check` does nothing unless the body has `#[rustc_mir(..)]`; once dataflow-impls ports it (only its
  attribute check is on the hot path) the next stops are `PromoteTemps` / `mir_const_qualif` (mt-promote, const-check),
  `InstrumentCoverage::policy` (mt-coverage), `check_liveness`.

## Tests
- `built_lints.oracle.test.ts` (new): test driver `built_lints_oracle/run.ts` (tydump's analysis prefix, then per body
  owner `check_unsafety` (→ `mir_built` with the full pass list) and `has_ffi_unwind_calls`, as the
  `MIR_borrow_checking` loop; stand-in: `SanityCheck::run_lint` is upstream's attribute check, stopping UNPORTED on
  `#[rustc_mir]`). Full stderr + exit code equal to the pinned rustc on 10 hand cases (`built_lints_oracle/cases/`:
  unconditional recursion incl. trait default / impl / method, uninhabited calls (definition / expression, `!`-returning
  and uninhabited-returning fns), function_item_references via `fmt::Pointer` bounds and `transmute` (unsafe, generic,
  `extern "C"` suggestions), const item mutation (field assign, index assign, `&mut` method call with the method note,
  `&mut K`), packed refs (E0793, `packed` and `packed(2)`), ffi_unwind_calls (foreign fn, fn pointer, `asm!(..,
  may_unwind)`), `#[rustc_force_inline]` + `#[cold]`, mut restrictions (struct/enum/union field mutation, struct/union
  construction, tuple ctor value)) and 5 tests/ui cases (`lint/lint-unconditional-recursion-tail-calls.rs`,
  `mut-restriction/mut-restriction-ctor-value.rs`, `mut-restriction/stricter-of-non-ancestor-160873.rs`,
  `force-inlining/deny.rs`, `force-inlining/deny-closure.rs`). 15/15.
  Also checked by hand (not in the test: they reach other lanes' stops later): `lint/function-item-references.rs`,
  `lint/lint-const-item-mutation.rs`, `lint/lint-unconditional-recursion.rs` (173 identical lines),
  `lint/unaligned_references.rs`, `force-inlining/invalid.rs` (325 identical lines): identical up to `mk_const_alloc` /
  `mir_borrowck provider`.
- pass_manager.test.ts: the unknown `-Zmir-enable-passes` test now checks the warning and the note against the
  oracle's `simplify_oracle/pass_names.txt`; stub-module count 69 → 60; the layout walk skips `*.gen.ts` and
  `*_oracle/` directories.
- `bun test src/rustc_mir_transform` (`RUST_TS_REQUIRE_PROBES=1`): 36 pass, 0 fail.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: see "Checks".
- lint_tail_expr_drop_order is not exercised end to end: `run_lint` runs after promotion (mt-promote) and, past its
  early returns (edition ≥ 2024, lint allowed — the usual case), needs `MoveData::gather_moves` and
  `MaybeInitializedPlaces` (dataflow lanes).

## Shared files edited (review)
- `src/rustc_mir_transform/pass_manager.ts`: the two diagnostic stops (imports `./diagnostics.ts`; no init-order issue:
  diagnostics.ts imports no pass module).
- `src/rustc_mir_build/check_unsafety.oracle.test.ts` + `check_unsafety_oracle/run.ts` (comment): the
  `--real-mir-built` pin now expects the `sanity_check` stop. The `mir_built` stand-in of that driver must stay until
  dataflow-impls lands (merge-w22 decision 2 said "drop when mt-built-lints lands"; the real `mir_built` still stops).
- `tools/codegen/types.sets.json` (new set, appended at the end: parallel lanes adding sets will conflict textually
  there), new `tools/codegen/mir_transform.typemap.json`.
- New files outside rustc_mir_transform: `src/rustc_middle/ty/significant_drop_order.ts` (ty/mod.ts does not
  re-export it — not this lane's file; users import the module), `src/rustc_const_eval/util/alignment.ts` (no
  util/mod.ts yet; ctfe-util should add `pub use self::alignment::{..}` there and keep this file).

## `unported(...)` left
- None in this lane's files. Reached through other lanes' stubs: `MoveData::gather_moves`,
  `MaybeInitializedPlaces::new` (lint_tail_expr_drop_order, only with a BID in a pre-2024 crate with the lint enabled),
  `sanity_check` (SanityCheck).
- Test driver only: `rustc_mir_dataflow::rustc_peek::sanity_check (#[rustc_mir])`.

## For other lanes
- mt-liveness / mt-inline / mt-coroutine / mt-kpl: their diagnostics (`UnusedVariable`, `UnusedAssign*`, `PatternTypo`,
  `MustNotSupend` (manual impl ported), `ForceInlineFailure`, `AssertLint` (manual impl takes `debug_P`),
  `AssertLintKind_lint`, `ConstNIsZero`) are already generated in `rustc_mir_transform/diagnostics.ts`; don't add a
  second diagnostics file.
- mt-inline: `check_inline.is_inline_valid_on_fn` / `is_inline_valid_on_body` are exported.
- mt-drops / analysis: `CheckDropRecursion` is ported (runs in `run_analysis_to_runtime_passes`' list).

## PORT decisions (phrased for `bun scripts/state.ts record decision`)
1. (mt-built-lints) rustc_mir_transform's diagnostics.rs and lint_tail_expr_drop_order.rs are generated by codegen set `rustc_mir_transform` (set-local typemap mir_transform.typemap.json); manual `impl Diagnostic`/`Subdiagnostic` blocks live in the hand modules; `AssertLint<P: Debug>`'s impl takes `debug_P` (`AssertLint_into_diag(self, debug_P, dcx, level)`).
2. (mt-built-lints) rustc_const_eval util/alignment.rs (`place_unalignment`, `most_packed_projection`) is ported ahead of ctfe-util as `src/rustc_const_eval/util/alignment.ts`, imported directly until util/mod.ts exists; `Align`'s derived `Ord` compares `pow2`, `min_by_key` keeps the first minimum.
3. (mt-built-lints) check_call_recursion: `TerminatorClassifier` is an interface implemented by classes; `Search<C>` implements `TriColorVisitor<BasicBlock, NonRecursive>`; `NonRecursive` is a frozen singleton; `&body.basic_blocks` as a graph is the `BasicBlocks` object cast to `Successors & StartNode`; `&[GenericArg]` slices compare element identity.
4. (mt-built-lints) MIR visitors of the lints (`PackedRefChecker`, `ConstMutationChecker`, `MutRestrictionChecker`, `FunctionItemRefChecker`) are classes extending mir/visit.ts's `Visitor`; `Result<(), &'static str>` is `Result<null, string>`.
5. (mt-built-lints) lint_tail_expr_drop_order: `Rc<RefCell<MixedBitSet>>` is the shared `MixedBitSet` (`.borrow().clone()` copies); `&'a mut Option<Span>` is a `MutRef`; `UnordSet<&Place>` is an array searched with the derived `Place` `PartialEq` (`local`, interned projection by identity); `PlaceElem` `PartialEq` is `intern_key_eq`; `Itertools::all_equal_value` is a local loop.
6. (mt-built-lints) rustc_middle ty/significant_drop_order.rs: `SmallVec` is `Ty[]`, `UnordSet<Ty>`/`FxHashSet<Ty>` are `Set<Ty>`; path slice patterns are length/element checks in arm order; not re-exported from ty/mod.ts.
7. (mt-built-lints) The rustc_mir_transform module-layout test skips generated `*.gen.ts` files and `*_oracle/` fixture/driver directories.
8. (mt-built-lints) check_unsafety's `--real-mir-built` pin now expects the `sanity_check` stop; its `mir_built` stand-in stays until dataflow-impls ports `sanity_check`.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (19794; vendor 4330).
