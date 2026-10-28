# Handoff: bck-diag-d (wave 23 borrowck fill, second batch): diagnostics/{mod, move_errors}.rs

Branch `lane/bck-diag-d` (base `f0e9a0cf`, no merges). Commits: `BorrowckDiagnosticsBuffer` + buffering + `local_names`
(the `emit_errors` path, first) → rest of mod.rs and move_errors.rs → lazy `hir_parent_iter` fix → this handoff.

## Files touched
- `src/rustc_borrowck/diagnostics/mod.ts`: all 45 fns of mod.rs ported (buffer, describe-place helpers, `UseSpans`,
  `BorrowedContentSource`, `move_spans` / `borrow_spans` / `closure_span`, `explain_captures`, ...).
- `src/rustc_borrowck/diagnostics/move_errors.ts`: all 25 fns of move_errors.rs ported. The fn-local `BindingFinder` is back
  inside `add_move_error_suggestions`. The header note that called it module-level is gone.
- `src/rustc_borrowck/contract.test.ts`: counts only. Markers 397 → 467, stubs 504 → 434, and the `bck-diag-d` row is
  removed (now 0, left as a comment). The runtime-stop pin is untouched.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_borrowck/src/diagnostics/mod.rs`: **45/45**.
- `bun scripts/coverage.ts --missing compiler/rustc_borrowck/src/diagnostics/move_errors.rs`: **25/25**.
- `bun scripts/coverage.ts --check`: markers ok (21306; vendor 4330).
- `bunx tsc --noEmit -p .`: clean.

## Checks
- `bun test src/rustc_borrowck`: 17 pass, 1 fail. The failure is the known runtime-stop test of `contract.test.ts`, which
  was already failing at the base. Every hand module loads as a fresh entry.
- Full `bun test src`: see "Full unit suite" below.

## Samples (`RUST_TS_AGENT=root-f5de`, compared case by case with the given base runs)
| suite | lane run | M / D / U / C / UNSTABLE | vs base |
|---|---|---|---|
| tydump-minicore | `20261022-234631-root-f5de-3xgw` | 45 / 0 / 1 / 0 / 0 | identical |
| mirdump-minicore | `20261022-234702-root-f5de-sn6r` | 45 / 0 / 1 / 0 / 0 | identical |
| tydump-ui `--sample 300` | `20261022-234737-root-f5de-7xga` | 261 / 0 / 37 / 0 / 2 | identical |
| mirdump-ui `--sample 300` | `20261022-235102-root-f5de-4hb2` | 271 / 0 / 29 / 0 / 0 | +2 MATCH (`mir/issue-76248.rs`, `mir/mir-inlining/ice-issue-77564.rs`, were `eval_in_interpreter`: ctfe, not this lane) |
| borrowck-ui `--sample 300` | `20261022-235344-root-f5de-aa5x` | 0 / 0 / 300 / 0 / 0 | all UNPORTED in both |

No MATCH lost, no new DIFF, CRASH or TIMEOUT. borrowck-ui stops now: `UniverseInfo::relate` (bound_region_errors, bck-diag-f)
209, `OutlivesConstraintSet::push` (constraints, bck-regions-b) 74, `polonius_engine::AllFacts::default` 12, the metadata
`Decodable for mir::Body` 5. The base run stopped at `replace_regions_in_mir` / `eval_in_interpreter` because it predates
the wave-23 merges. None of the stops is in this lane's files.

## Runtime stops
This lane does not move the stop of the contract test's real body. A trivial no_core `fn f(x: u8) -> u8 { x }` stops at
`rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::relate` (bck-diag-f), during type_check, before
`emit_errors` is reached. The contract test still pins `BorrowSet::build` (stale at base, re-pinned by fix-w23-bck / root).

## `unported(...)` left
None in mod.ts or move_errors.ts. Once reached, these paths stop at other lanes' stubs:
- `MirBorrowckCtxt::dcx` (borrowck_errors.rs:8, **bck-diag-f**): every `MirBorrowckCtxt::buffer_error` /
  `buffer_error_with_sort_span` and `report` call it. It is a one-liner (`self.root_cx.dcx()`) and gates all borrowck error
  output, so fill it early.
- `cannot_move_out_of`, `cannot_move_out_of_interior_noncopy`, `cannot_move_out_of_interior_of_drop` (borrowck_errors.rs,
  bck-diag-f).
- `is_upvar_field_projection` (lib.rs:2727), `is_mutable` (lib.rs:2571): **bck-lib-b**. `describe_place_with_options`
  calls `is_upvar_field_projection` for every `Deref` / `Field` projection.
- `mir_def_id`, `mir_hir_id` (region_name.rs:202/206), `ConstraintDescription for ConstraintCategory::description`
  (region_errors.rs:42): bck-diag-e.
- `find_expr`, `suggest_cloning`, `clone_on_reference`, `suggest_reborrow` (conflict_errors.rs, bck-diag-a);
  `explain_iterator_advancement_in_for_loop_if_applicable` (conflict_errors.rs:2469, bck-diag-b).

## `// PORT:` decisions
- mod.ts `emit_errors`: `mem::take` of the `BTreeMap<Vec<MoveOutIndex>, _>` iterates the `KeyedMap`'s entries sorted
  lexicographically (`cmp_move_out_indices`), as `BTreeMap` order. `mem::take` of the `FxIndexMap` keeps insertion order.
  `sort_by_key(lo_hi)` is stable, so `Array.prototype.sort` on `(lo, hi)` gives the same order.
- mod.ts `buffer_move_error`: `BTreeMap::insert` is get + set on the `KeyedMap` (the stored key is kept, the old diag is
  cancelled). `get_buffered_mut_error` uses rustc_errors' `index_map_swap_remove` (real `IndexMap::swap_remove` order).
- mod.ts `has_buffered_diags` returns `buffered_diags.is_empty()`. That is upstream's own (inverted-looking) logic, kept as is.
- mod.ts helpers with no upstream counterpart: `as_fn_def`, `unwrap_print`, `describe_rc_or_arc` (the closure shared by
  `describe_for_unnamed_place` / `describe_for_immutable_place`), `PlaceRef_eq` / `PlaceElem_eq` (derived `PartialEq`;
  mir statement.ts's copies are not exported), `set_insert` (`HashSet::insert`'s bool).
- mod.ts `add_sized_or_copy_bound_info`: `ConstraintCategory`'s `!=` against the unit variants `SizedBound` / `CopyBound` is
  a tag comparison.
- move_errors.ts: `find_upvar_field` (`prefixes(..).find_map(is_upvar_field_projection)` through `Iterator_Prefixes`),
  `sort_dedup_locals` (`sort(); dedup()` on the moved `Vec<Local>`), `any_parent_is_assign_desugar_let` (lazy
  `hir_parent_iter(..).any(..)`, which stops at the first match), `cmp_lo_hi`.
- move_errors.ts `add_move_error_suggestions`: `sort_unstable_by_key(lo_hi)` goes through std `slice_sort_unstable_by` with
  layout `(Span, String, String)` = `{ size_of: 56, freeze: true }`, because equal keys keep ipnsort's order, which `dedup`
  then sees. `BindingFinder::visit_pat`'s `|=` is evaluated without short-circuit.
- move_errors.ts header (from the contract): `append_to_grouped_errors` destructures its `move_error` parameter in the body.

## For root / other lanes
- Nothing outside this lane's files was edited (besides the contract test counts).
- `docs/handoff/borrowck-contract.md`'s split table row bck-diag-d is done (70 → 0).

## Full unit suite (root note)
The lane's final full-suite run was cut off by the API limit / machine reboot. Root ran the full suite at integration instead (merge into integ-w19).
