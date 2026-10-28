# Handoff: bck-diag-b (M4 wave 25, borrowck diagnostics)

Branch `lane/bck-diag-b` (base `de448071` on integ-w19, no merges). Filled all 42 stubs of the bck-diag-b row of the
borrowck-contract split table: upstream `compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs` lines >= 2469.

## Files touched
- `src/rustc_borrowck/diagnostics/conflict_errors.ts`, only below the `// ==== lane bck-diag-b ====` marker (bck-diag-a's
  section and the shared import block / `declare module` blocks above are untouched), in upstream order:
  `explain_iterator_advancement_in_for_loop_if_applicable` (+ fn-local `ExprFinder::visit_expr`),
  `explain_iterator_invalidation_in_for_loop_if_applicable`, `suggest_using_closure_argument_instead_of_capture`
  (+ `ClosureFinder::{maybe_tcx, visit_expr}`, `VariableUseFinder::visit_expr`), `suggest_binding_for_closure_capture_self`
  (+ `ExpressionFinder::{visit_expr, visit_local, visit_stmt}`), `describe_place_for_conflicting_borrow`,
  `report_borrowed_value_does_not_live_long_enough`, `report_local_value_does_not_live_long_enough`,
  `report_borrow_conflicts_with_destructor`, `report_thread_local_value_does_not_live_long_enough`,
  `report_temporary_value_does_not_live_long_enough` (+ `NestedStatementVisitor::{visit_block, visit_expr}`),
  `try_report_cannot_return_reference_to_local`, `report_escaping_closure_capture`, `report_escaping_data`,
  `get_moved_indexes` (+ fn-local `predecessor_locations`), `report_illegal_mutation_of_borrowed`, `explain_deref_coercion`,
  `report_illegal_reassignment` (+ `RefPatternFinder::{maybe_tcx, visit_pat}`), `classify_drop_access_kind`,
  `classify_immutable_section` (+ `FakeReadCauseFinder::visit_statement`), `annotate_argument_and_return_for_borrow`,
  `annotate_fn_sig`, `find_for_loop_span` (+ `ExprFinder::visit_expr`), `AnnotatedBorrowFnSignature::emit`,
  `ReferencedStatementsVisitor::visit_stmt`, `BreakFinder::visit_expr`, `ConditionError::new`,
  `ConditionErrorKind::describes_condition_value`, `ConditionVisitor::visit_expr`.
  - My value imports are a block at the top of my section (ES imports are hoisted). Names the shared block imports as
    types are imported under an alias where a value is needed (`SpanC`, `LocationC`, `LocalDefIdC`, `BinderC`,
    `PolyFnSigC`, `UseSpansC`, `BorrowExplanationC`, `RegionNameC`).
  - The fn-local types (`ExprFinder` x2, `ClosureFinder`, `VariableUseFinder`, `ExpressionFinder`,
    `NestedStatementVisitor`, `RefPatternFinder`, `FakeReadCauseFinder`) and the fn-local fn `predecessor_locations` are
    back inside their fns (contract "How to fill a stub" step 2), under their upstream names. The module-level exports
    `ExprFinder_2481`, `ExprFinder_4730`, `ExpressionFinder_2833`, `ClosureFinder`, `VariableUseFinder`,
    `NestedStatementVisitor`, `RefPatternFinder`, `FakeReadCauseFinder` and `predecessor_locations` are gone; nothing else
    referenced them. The shared file header (line 6) still names `ExpressionFinder_2833` / `ExprFinder_2481` /
    `ExprFinder_4730` as examples; I left it (shared with bck-diag-a). Root may trim it at merge.
  - The hand classes `ReferencedStatementsVisitor`, `BreakFinder`, `ConditionVisitor` stay module-level (as upstream).
  - No signature changed.
- `src/rustc_borrowck/contract.test.ts`, deltas only (root merges by delta): markers `458 -> 500` (+42), stubs
  `443 -> 401` (-42). The `bck-diag-b` row went 42 -> 0 and is now a comment.
- New `src/rustc_borrowck/bck_diag_b.test.ts` (8 tests, described below).

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs`: **42/76**. The 34 left are
all bck-diag-a's (lines < 2469). `bun scripts/coverage.ts --check`: markers ok (21339; vendor 4330).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_borrowck`: **45 pass, 0 fail** (6 files; includes the contract test's runtime-stop pin, which this
  lane does not move).
- Full unit suite: not run (coordinator: root runs it at integration).

### `bck_diag_b.test.ts`
The runtime path of `mir_borrowck` does not reach this lane's code yet, so the test drives it directly, the way
`bck_lib_b.test.ts` does. It builds MIR for a no_core crate (borrow regions renumbered to `ReVar`s), builds the real
`MoveData` and `BorrowSet` per body, and runs this lane's methods on a `MirBorrowckCtxt`. The other lanes' methods they
call are replaced on the instance: `describe_place` / `describe_any_place` (return the place's Debug text),
`mir_def_id` / `mir_hir_id`, `get_name_for_ty` / `get_region_name_for_ty`, `buffer_error`, and the `borrowck_errors.rs`
builders, which return a recording `Diag` stand-in (a Proxy that logs every call, with spans shown as their source
snippet). The HIR visitors run on the crate's real HIR bodies.

It covers:
- `get_moved_indexes`: a plain move, a move found only through a loop back edge (`traversed_back_edge = true`), and a
  move with a reinit reachable from it.
- `classify_drop_access_kind`: `LocalStorageDead` vs `Destructor(D)` for a field of a `Drop` ADT.
- `classify_immutable_section`: `"match guard"` for the fake borrow of an enum scrutinee, `None` for the others.
- `annotate_argument_and_return_for_borrow` / `annotate_fn_sig`: `AnonymousFunction`, `NamedFunction` (only the
  argument whose region is the return region), and `None` when the borrow is not returned; `emit` for both.
- `describe_place_for_conflicting_borrow`: two fields of a union, the same place, and a non-union base.
- `report_illegal_reassignment`: `let x;` (label on the earlier assignment), an argument, `let x = 1;` (label on the
  binding, as `opt_match_place` is `Some((None, _))`), and a destructuring `let S { x, .. } = s;` (adds the
  "take a borrow instead" suggestion).
- `try_report_cannot_return_reference_to_local` (non-return category, return without a place description, yield with
  one) and `report_thread_local_value_does_not_live_long_enough` (including the empty drop span extended over `}`).
- `ConditionVisitor` (if without else, if/else either way, match with a guarded arm and a wildcard arm),
  `ReferencedStatementsVisitor`, `BreakFinder`, `ConditionError::new`, `describes_condition_value`.

I worked the expected values out by hand from upstream (and the mir_build code that sets `opt_match_place`) before
pinning them.

## Samples
Runs as `RUST_TS_AGENT=root-f5de` against root's base runs (same agent name and sample). The machine was heavily loaded
during the sample runs (load average around 250-450 on 12 cores, from the other lanes' runs), so many cases timed out. Per
the w25 instructions I re-ran **every** TIMEOUT case alone (`--filter <id> --jobs 1`): all 179 finished, 155 MATCH and
24 UNPORTED, with no TIMEOUT, DIFF or CRASH. The "lane + re-runs" column uses the re-run status for those cases.

| suite | lane run | M / D / U / C / T / UNSTABLE | lane + re-runs (M / U / UNSTABLE) | base run | base M / U / UNSTABLE |
|---|---|---|---|---|---|
| tydump-minicore (46) | `20261027-232805-root-f5de-m5pr` | 23 / 0 / 0 / 0 / 23 / 0 | **46** / 0 / 0 | `20261022-210451-root-f5de-wos5` | 45 / 1 / 0 |
| mirdump-minicore (46) | `20261027-233310-root-f5de-h5i4` | 34 / 0 / 0 / 0 / 12 / 0 | 45 / 1 / 0 | `20261022-210534-root-f5de-p8q4` | 45 / 1 / 0 |
| tydump-ui `--sample 300` | `20261027-233731-root-f5de-9ua4` | 161 / 0 / 22 / 0 / 115 / 2 | **262** / 36 / 2 | `20261022-210624-root-f5de-zjq3` | 261 / 37 / 2 |
| mirdump-ui `--sample 300` | `20261027-235811-root-f5de-h3cu` | 253 / 0 / 25 / 0 / 22 / 0 | **273** / 27 / 0 | `20261022-211125-root-f5de-mzgb` | 269 / 31 / 0 |
| borrowck-ui `--sample 300` | `20261028-000919-root-f5de-8wp0` | 0 / 0 / 293 / 0 / 7 / 0 | 0 / 300 / 0 | `20261022-211729-root-f5de-86qn` | 0 / 300 / 0 |

I compared every case against the base run. **No MATCH turned into anything else, and there is no new DIFF or CRASH.**
No TIMEOUT remains after the solo re-runs. The 6 gains (`mini_core_hello_world.rs` in tydump-minicore,
`wrapping_niche.rs` in tydump-ui, 4 `tests/ui/mir/` cases in mirdump-ui) come from the newer base tree. **No case in any
suite stops in this lane's code**: the `mir_borrowck` stops are `UniverseInfo::relate` (bck-diag-f),
`OutlivesConstraintSet::push` (bck-regions-b) and `AllFacts::default` (wave 26), all reached before any `report_*` call.
The other changed stop messages (`CleanupPostBorrowck`, the metadata `Decodable` stops) also come from the newer base tree.

## Runtime stop
Unchanged by this lane: `mir_borrowck` still stops before any `report_*` call. Once it gets there, this lane's code
calls these still-stubbed fns of other lanes:
- **bck-diag-d**: `UseSpans::{args_or_use, var_or_use_path_span, var_or_use, coroutine_kind, args_subdiag,
  var_subdiag, for_closure, for_coroutine}`, `retrieve_borrow_spans`, `buffer_error`, `describe_place`,
  `describe_any_place`, `get_name_for_ty`, `get_region_name_for_ty`.
- **bck-diag-e**: `mir_def_id`, `mir_hir_id`, `synthesize_region_name`, `RegionName::highlight_region_name`.
- **bck-diag-f**: `explain_why_borrow_contains_point`, `BorrowExplanation::add_explanation_to_diagnostic`,
  `note_due_to_edition_2024_opaque_capture_rules`, `dcx`, and the builders `path_does_not_live_long_enough`,
  `cannot_borrow_across_destructor`, `thread_local_value_does_not_live_long_enough`,
  `temporary_value_borrowed_for_too_long`, `cannot_return_reference_to_local`, `cannot_capture_in_long_lived_closure`,
  `cannot_mutate_in_immutable_section`, `cannot_assign_to_borrowed`, `cannot_reassign_immutable`,
  `borrowed_data_escapes_closure`.
- **bck-diag-a**: `find_expr` (from `try_report_cannot_return_reference_to_local`'s `Cow` suggestion).

## `unported(...)` left
None in this lane's code.

## `// PORT:` decisions
- Section header: the lane's own import block (aliases above) and the fn-local items back inside their fns.
- `Place_eq` / `PlaceRef_eq` (module-local): derived `PartialEq` (same local and interned projection list / same local and
  element-wise equal projections, via `is_prefix_of` plus equal length). rustc_middle's `slice_eq_PlaceElem` is not
  exported.
- `ExprFinder` (2481) and `ExpressionFinder` (2833): the `= None` / `= vec![]` / `= false` / `= String::new()` default
  field values are the constructor arguments of their single construction site.
- `describe_place_for_conflicting_borrow`: the `Option` combinator chain is an IIFE with early returns in the same order;
  `iter_projections().rev()` loops are reverse index loops.
- `report_borrowed_value_does_not_live_long_enough`: the `match (place_desc, explanation)` is an if-chain in upstream arm
  order, and the `if let OutlivesConstraint { .. } = best_blame.constraint()` guards are evaluated in place.
- `get_moved_indexes`: `predecessor_locations` returns an array (the `Either` iterator); `FxIndexSet<Location>` is a
  `KeyedSet` keyed by borrow_set.ts's `Location_key`; `visited.insert(..)` is `has` + `add`.
- `report_escaping_closure_capture`: `strip_prefix("async")` / `trim_end` / `ends_with("gen")` on the snippet `Str` use
  `Str.starts_with` / `slice(5)` / `str_trim_end` / `toString().endsWith`; `len()` is the UTF-8 byte length.
- `explain_deref_coercion`: `tcx.fn_arg_idents(method_did)[0]` panics with core's index-out-of-bounds text when empty.
- `classify_drop_access_kind`: the `fold` is a loop computing the new kind from the old `place_ty` before projecting.
- Query results are cast (`tcx.typeck(..) as TypeckResults`, `type_of` / `fn_sig` as `EarlyBinder<..>`, `def_kind` as
  `DefKind`, `fn_arg_idents` as `(Ident | undefined)[]`), as elsewhere in the crate.
- `CAPTURE_STRUCT_LOCAL` (rustc_middle ty/closure.ts) has a different `Local` brand from mir's `Local`; compared as numbers.
- `debug!` / `#[instrument]` are kept as comments.

## For other lanes / root
- Root: merge `contract.test.ts` by deltas (+42 markers, -42 stubs, bck-diag-b row -> comment).
- bck-diag-a: nothing of yours was touched; my section only adds below the marker.
