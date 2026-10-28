# Handoff: bck-diag-a (M4 wave 25, borrowck diagnostics)

Branch `lane/bck-diag-a` (base `de448071` on integ-w19, no merges). I filled all 34 stubs of the bck-diag-a row:
upstream `compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs` lines < 2469.

## Files touched
- `src/rustc_borrowck/diagnostics/conflict_errors.ts`. All edits are inside the `// ==== lane bck-diag-a ====`
  section. The shared import block and the `declare module` block at the top are unchanged, so the merge with
  bck-diag-b should be clean. My value imports sit at the top of my section (ES imports are hoisted).
  - Ported, in upstream order: `report_use_of_moved_or_uninitialized`, `suggest_ref_or_clone`,
    `suggest_ref_for_dbg_args`, `suggest_reborrow`, `suggest_borrow_generic_arg`, `is_init_reachable`,
    `report_use_of_uninitialized`, `suggest_assign_value`, `suggest_hoisting_call_outside_loop`,
    `suggest_cloning_on_functional_record_update`, `suggest_cloning`, `implements_clone`, `clone_on_reference`,
    `in_move_closure`, `suggest_cloning_inner`, `suggest_adding_bounds`, `report_move_out_while_borrowed`,
    `report_use_while_mutably_borrowed`, `report_conflicting_borrow`, `suggest_copy_for_type_in_cloned_ref`,
    `suggest_adding_bounds_or_derive`, `suggest_using_local_if_applicable`, `find_expr`,
    `suggest_slice_method_if_applicable`.
  - Fn-local types are back inside their fns, as the contract's "How to fill a stub" step 2 asks:
    `ExpressionFinder` (was `ExpressionFinder_366`), `MatchArgFinder`, `LetVisitor`, `Finder`, `FindUselessClone`,
    `Holds`. The module-level exports of these names are gone. Nothing outside the file referenced them.
- `src/rustc_borrowck/contract.test.ts`, deltas only (root merges by delta): markers `458 -> 492` (+34), stubs
  `443 -> 409` (-34). The `bck-diag-a` row went 34 -> 0 and is now a comment.
- New `src/rustc_borrowck/bck_diag_a.test.ts` (5 tests, described below).

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs`: **34/76**. The 42
left are all bck-diag-b's (line >= 2469). `bun scripts/coverage.ts --check`: markers ok (21331; vendor 4330).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_borrowck`: 42 pass, 0 fail.
- I did not run the full unit suite. The coordinator said to skip it because root runs it at integration.

### `bck_diag_a.test.ts`
The runtime path of `mir_borrowck` still stops in type_check (`UniverseInfo::relate`, bck-diag-f), so this test calls
the lane's fns directly, the way bck_lib_b.test.ts does:
- It builds MIR and HIR for a no_core crate and uses a real `BorrowckInferCtxt`.
- Methods from other lanes are replaced by recorders on the `MirBorrowckCtxt` instance.
- The stub companions `UseSpans.*` (bck-diag-d) and `BorrowExplanation.*` (bck-diag-f) are patched for the duration
  of a case, then restored.
- `Diag`s are recording proxies.

It covers:
- `is_init_reachable`: argument inits, the dominator fast path, a CFG walk that reaches the use, and one that does not.
- `report_conflicting_borrow`: every `(gen, issued)` match arm, the `classify_immutable_section` early return,
  equal vs. different spans, the union note, and the unreachable arm.
- `report_use_of_moved_or_uninitialized`: the uninitialized path with duplicate suppression, and the moved path with
  0, 1 and 5 reinits. The moved path runs the real `suggest_ref_or_clone`, `suggest_hoisting_call_outside_loop` and
  `suggest_cloning`, including the `ObligationCtxt` "if `S` implemented `Clone`" note.
- `suggest_slice_method_if_applicable` and `find_expr`, using `FindExprBySpan` on real HIR.
- `clone_on_reference`, `in_move_closure` (negative case only), `suggest_cloning_inner` and
  `suggest_copy_for_type_in_cloned_ref`.

How the expected values were checked: the E0381 wording ("possibly-uninitialized" for `cond`, "isn't initialized on
any path leading to this point" for `two`) and the E0499 `split_at_mut` help on `sl` vs. no help on `sl_same` match the
oracle on the same source.

Note for other lanes: plain `rustc` on this machine is **stable 1.96**. The oracle is `rustc +nightly`. Run oracle
probes with `+nightly`.

Not covered: `report_use_of_uninitialized` (it reaches bck-diag-b's `ConditionVisitor::visit_expr`),
`suggest_borrow_generic_arg`, the loop/`break` part of `suggest_hoisting_call_outside_loop` (it needs `BreakFinder`),
the functional-record-update suggestion and `suggest_using_local_if_applicable`.

## Samples (`RUST_TS_AGENT=root-f5de`, same samples as the base runs in w25-common)
| suite | lane run | M / D / U / C / T / UNSTABLE | base run | M / D / U / C / T / UNSTABLE |
|---|---|---|---|---|
| tydump-minicore (46) | `20261028-001019-root-f5de-2a6m` | 46 / 0 / 0 / 0 / 0 / 0 | `20261022-210451-root-f5de-wos5` | 45 / 0 / 1 / 0 / 0 / 0 |
| mirdump-minicore (46) | `20261028-001237-root-f5de-bavr` | 44 / 0 / 0 / 0 / **2** / 0 | `20261022-210534-root-f5de-p8q4` | 45 / 0 / 1 / 0 / 0 / 0 |
| tydump-ui `--sample 300` | `20261028-001435-root-f5de-on6l` | 261 / 0 / 36 / 0 / **1** / 2 | `20261022-210624-root-f5de-zjq3` | 261 / 0 / 37 / 0 / 0 / 2 |
| mirdump-ui `--sample 300` | `20261028-002229-root-f5de-jlwf` | **273** / 0 / 27 / 0 / 0 / 0 | `20261022-211125-root-f5de-mzgb` | 269 / 0 / 31 / 0 / 0 / 0 |
| borrowck-ui `--sample 300` | `20261028-002545-root-f5de-4pqu` | 0 / 0 / 300 / 0 / 0 / 0 | `20261022-211729-root-f5de-86qn` | 0 / 0 / 300 / 0 / 0 / 0 |

I compared every case against the base run.
- **No MATCH was lost, and there is no DIFF or CRASH.**
- The 3 timeouts were caused by machine load. Re-run alone:
  - mirdump-minicore `mini_core.rs`: MATCH. `mini_core_hello_world.rs`: UNPORTED, as in the base
    (`20261028-002850-root-f5de-5yql`).
  - tydump-ui `layout/zero-sized-array-union.rs`: MATCH (`20261028-002902-root-f5de-7q7r`).
- The gains (+1 tydump-minicore, +1 tydump-ui, +4 mirdump-ui, all UNPORTED -> MATCH) come from the newer base tree,
  not from this lane.
- No stop in any suite is in this lane's code. The most common stop is `UniverseInfo::relate` (bck-diag-f): tydump-ui
  22, mirdump-ui 22, borrowck-ui 209. The other stops are `OutlivesConstraintSet::push`, `AllFacts::default`,
  `CleanupPostBorrowck` and the metadata `Decodable` stops.

## Runtime stops
Unchanged by this lane: bodies stop in type_check before any borrowck diagnostics run.

Once the path gets this far, this lane's code calls these stubs from other lanes:
- **bck-diag-b**: `get_moved_indexes`, `describe_place_for_conflicting_borrow`, `classify_immutable_section`,
  `suggest_binding_for_closure_capture_self`, `suggest_using_closure_argument_instead_of_capture`,
  `explain_iterator_invalidation_in_for_loop_if_applicable`, `explain_iterator_advancement_in_for_loop_if_applicable`,
  `ConditionVisitor::visit_expr`, `ConditionErrorKind::describes_condition_value`, `BreakFinder::visit_expr`.
- **bck-diag-d**: the `UseSpans` methods, `move_spans`, `borrow_spans`, `retrieve_borrow_spans`, `buffer_error`,
  `buffer_move_error`, `has_move_error`, `describe_place*`, `describe_any_place`, `add_moved_or_invoked_closure_note`,
  `explain_captures`, `suggest_clone_of_captured_var_in_move_closure` (move_errors.rs).
- **bck-diag-e**: `mir_def_id`, `mir_hir_id`.
- **bck-diag-f**: every `cannot_*` builder, `dcx`, `explain_why_borrow_contains_point`,
  `BorrowExplanation::{is_explained, add_explanation_to_diagnostic}`, `note_due_to_edition_2024_opaque_capture_rules`.
- **bck-diag-c**: `find_all_local_uses::find`.

## `unported(...)` left
None in this lane's code.

## `// PORT:` decisions
- Section header: my value imports sit at the top of my section.
  - `InitializationRequiringAction`'s methods are reached through the generated companion (`lib.gen.ts`) plus a
    type-only import of `InitializationRequiringAction_methods`, so lib.ts never enters this module's load graph.
  - `d_TraitRef` (the `TypeFoldable` proxy for `Binder::dummy`) is local, built from rustc_type_ir's
    `*_with_TraitRef`.
- The derived `PartialEq`s that upstream uses are local helpers: `Location`, `mir::Place` (interned projection:
  identity), `PlaceElem` / `PlaceRef` (a copy of statement.ts's private `eq_PlaceElem`), `Option<DefId>`, `Ident`
  (`name` + `eq_ctxt`), `CallKind`, `UseSpans` and `hir::ClosureKind`. The `UseSpans` helper serves
  `issued_spans == borrow_spans`.
- `span.lo_hi() < other.lo_hi()` is `lo_hi_lt` (lexicographic).
- `find_attr!(.., OnMove { directive, .. } => directive)` returns `Option<Option<&Directive>>`. The outer `Some` is
  encoded as `{ $: "Some" }`, the same pattern as trait_selection's `find_on_type_error`.
- `FormatArgs { this, generic_args, .. }` is written out with the default field values (`""` / `[]`).
- Container types:
  - `FxIndexSet<Span>` / `<Ty>` / `<String>` are `Set`s, which keep insertion order. Spans and `Ty`s are interned.
  - `find_all_local_uses::find`'s `BTreeSet<Location>` is iterated sorted by `(block, statement_index)`.
- Control flow:
  - The `match (gen_borrow_kind, issued_borrow.kind)` in `report_conflicting_borrow` is an if-chain in upstream arm
    order, with helpers `bk_is_shared_or_deep`, `bk_is_mut_default_or_two_phase` and `bk_is_mut_closure_capture`.
  - In `suggest_adding_bounds`, `.map(..).collect::<Result<Vec<_>, ()>>()` stops at the first `Err`.
  - `lines.dedup()` is a filter of adjacent duplicates.
- Query results typed `unknown` are cast: `typeck` -> `TypeckResults`, `generics_of` -> `Generics`,
  `associated_items` -> `AssocItems`, `clauses_of` -> `GenericClauses`, `fn_sig` -> `EarlyBinder<PolyFnSig>`.
- `ObligationCtxt::new_with_diagnostics(self.infcx)` gets `this.infcx.infcx`: the explicit deref of `BorrowckInferCtxt`.

## For root / other lanes
- Root: merge `contract.test.ts` by deltas: +34 markers, -34 stubs, `bck-diag-a` row -> comment.
- bck-diag-b: this lane does not touch your section or the shared top-of-file import / `declare module` blocks.
- I edited no shared files outside `src/rustc_borrowck`.
