# Handoff: bck-lib-b (M4 wave 23 borrowck fill, second batch)

Branch `lane/bck-lib-b` (base `f0e9a0cf` on integ-w19, no merges). Filled all 22 stubs of the bck-lib-b row of the
borrowck-contract split table, which is upstream `compiler/rustc_borrowck/src/lib.rs` lines >= 1400.

## Files touched
- `src/rustc_borrowck/lib.ts`. My edits are kept local so the merge with bck-lib-a is clean:
  - The 22 bodies after the `// ==== lane bck-lib-b ====` marker, in upstream order:
    `check_backward_incompatible_drop`, `mutate_place`, `consume_rvalue`, `propagate_closure_used_mut_upvar`,
    `consume_operand`, `check_for_invalidation_at_exit`, `check_for_local_borrow`, `check_activations`,
    `check_movable_place`, `check_if_full_path_is_moved`, `check_if_subslice_element_is_moved`,
    `check_if_path_or_subpath_is_moved`, `move_path_closest_to`, `move_path_for_place`,
    `check_if_assigned_path_is_moved`, `check_parent_of_field`, `check_access_permissions`, `first_reaching_init`,
    `add_used_mut`, `is_mutable`, `is_upvar_field_projection`, `lint_unused_mut`.
  - `check_parent_of_field` is a nested function inside `check_if_assigned_path_is_moved` again, as upstream has it. The
    module-level export `check_parent_of_field` is gone; nothing else referenced it.
  - My value imports are a block at the top of my section (ES imports are hoisted).
  - Four lines of the shared import block changed from `type` imports to value imports: `FieldIdx`
    (`FieldIdx::ZERO`), `MixedBitSet` (`MixedBitSet.contains`), `PlaceRef` (`new PlaceRef`) and `Span`
    (`Span.desugaring_kind`). If these conflict with bck-lib-a, keep the value form.
  - Changed signature: `check_if_subslice_element_is_moved`'s `from` / `to` went from `bigint` to `number`, both in the
    declaration and in the body. rustc_middle's `ProjectionElem::Subslice { from, to }` and `ConstantIndex { offset }`
    are `number`. The contract's PORT note claiming they were `bigint` "as in rustc_middle" was wrong, and I removed it.
- `src/rustc_borrowck/contract.test.ts`, deltas only (root merges by delta): markers `397 -> 419` (+22), stubs
  `504 -> 482` (-22). The `bck-lib-b` row went 22 -> 0 and is now a comment.
- New `src/rustc_borrowck/bck_lib_b.test.ts` (12 tests, described below).

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_borrowck/src/lib.rs`: **38/46**. The 8 left are all bck-lib-a's:
`bind`, `instantiate`, the 3 `ResultsVisitor` methods, `access_place`, `borrows_in_scope` and
`check_access_for_conflict`. `bun scripts/coverage.ts --check`: markers ok (21258; vendor 4330).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_borrowck`: 29 pass, 1 fail. The failure is the known contract runtime-stop test. It still pins
  `BorrowSet::build`; fix-w23-bck re-pins it, and I did not touch that pin.
- Full unit suite, run once at `ab479e2a` (`RUST_TS_REQUIRE_PROBES=1 RUST_TS_AGENT=bck-lib-b bun test src --timeout=120000`):
  **6124 pass, 1 skip, 25 fail** (6150 tests, 447 files). All 25 failures are the known list in w24-common.txt:
  symbol_names (7), collect_test misc (1), the borrowck contract runtime stop (1), late_c (1), late_e2 (1),
  place_operand (1), the interpret contract runtime stop (1), operator_cast (1) and compare_impl_item end to end (11).
  The run finished before the machine rebooted (the log is complete), so I did not run it a second time: the
  assignment allows one full run.

### `bck_lib_b.test.ts`
The runtime path of `mir_borrowck` never reaches this lane's code yet, so this test drives the code directly, the way
`bck_core.test.ts` does:
- It builds MIR for a no_core crate with these bodies: `shared`, `mutb`, `two_phase`, `reassign`, `never_init`,
  `deferred`, `reb`, `moves` (with a `Drop` ADT), `fmove` (a tuple field move) and `arr` (an array pattern move).
- For each body it builds the real `MoveData` and `BorrowSet`.
- It runs this lane's methods on a `MirBorrowckCtxt`. The other lanes' methods they call are replaced by recorders on
  the instance: `access_place`, `borrows_in_scope`, `report_*`, `retrieve_borrow_spans` and
  `local_excluded_from_unused_mut_lint`.

It covers: `is_mutable` (locals, fields, `&` / `&mut` derefs), `add_used_mut`, `check_access_permissions` (including
the illegal-reassignment and mutability-error branches), `first_reaching_init`, `move_path_closest_to` / `_for_place`,
the full-path / subpath / subslice move checks, `check_if_assigned_path_is_moved` with `check_parent_of_field` and a
`Drop` base, `mutate_place`, `check_movable_place`, every `consume_rvalue` arm except `CopyForDeref`,
`check_activations`, `check_for_invalidation_at_exit`, `check_for_local_borrow`, `check_backward_incompatible_drop`,
`propagate_closure_used_mut_upvar` (including the temporary-init search) and `lint_unused_mut`.

I worked the expected values out by hand from upstream before running. All of them matched on the first run except
one, where my expected string used the wrong format for `Init`'s Debug output (`mp1@Statement(bb0[1])`).

## Runtime stop
Unchanged by this lane. A real fn body stops at `rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::relate`
(bck-diag-f), inside type_check, before any of this lane's code runs. Once the path gets this far, my code calls the
following stubs from other lanes:
- **bck-lib-a**: `access_place`, `borrows_in_scope`.
- **bck-diag-d**: `MoveError::new`, `UseSpans::var_or_use` / `var_or_use_path_span`, `retrieve_borrow_spans`,
  `local_excluded_from_unused_mut_lint`, `has_buffered_diags`, `buffer_error`. `local_excluded_from_unused_mut_lint`
  runs on every body that has an unused `mut` local.
- **bck-diag-a/-b**: `report_use_of_moved_or_uninitialized`, `report_borrowed_value_does_not_live_long_enough`,
  `report_illegal_reassignment`, `report_illegal_mutation_of_borrowed` (from lib-a's code).
- **bck-diag-c**: `report_mutability_error`.
- **bck-diag-f**: `explain_why_borrow_contains_point`, `BorrowExplanation::add_explanation_to_diagnostic`,
  `TailExprDropOrder::into_diag`, `cannot_borrow_across_coroutine_yield`.

## Samples (`RUST_TS_AGENT=root-f5de`, same samples as root's base runs)
| suite | lane run | M / D / U / C / UNSTABLE | base run | M / D / U / C / UNSTABLE |
|---|---|---|---|---|
| tydump-minicore (46) | `20261022-233330-root-f5de-e050` | 45 / 0 / 1 / 0 / 0 | `20261022-210451-root-f5de-wos5` | 45 / 0 / 1 / 0 / 0 |
| mirdump-minicore (46) | `20261022-233402-root-f5de-5b3p` | 45 / 0 / 1 / 0 / 0 | `20261022-210534-root-f5de-p8q4` | 45 / 0 / 1 / 0 / 0 |
| tydump-ui `--sample 300` | `20261022-233435-root-f5de-mtr7` | 261 / 0 / 37 / 0 / 2 | `20261022-210624-root-f5de-zjq3` | 261 / 0 / 37 / 0 / 2 |
| mirdump-ui `--sample 300` | `20261022-233823-root-f5de-9tu4` | **271** / 0 / 29 / 0 / 0 | `20261022-211125-root-f5de-mzgb` | 269 / 0 / 31 / 0 / 0 |
| borrowck-ui `--sample 300` | `20261022-234323-root-f5de-9zbz` | 0 / 0 / 300 / 0 / 0 | `20261022-211729-root-f5de-86qn` | 0 / 0 / 300 / 0 / 0 |

I compared every case against the base run. **No MATCH turned into anything else, and there is no new DIFF, CRASH or
TIMEOUT.** mirdump-ui gained 2 UNPORTED -> MATCH. Some stop messages changed: `replace_regions_in_mir` and
`eval_in_interpreter` became `UniverseInfo::relate`, `OutlivesConstraintSet::push`, `AllFacts::default`,
`CleanupPostBorrowck` and the metadata `Decodable` stops. These changes come from the newer base tree (the base runs
predate the wave-23 merges at `f0e9a0cf`), not from this lane. No stop in any suite is in this lane's code. Every
`mir_borrowck` body still stops in type_check or earlier.

## `unported(...)` left
None in this lane's code. The only remaining stops are other lanes' stubs, listed above.

## `// PORT:` decisions
- Section header: my imports sit at the top of my section so the merge with bck-lib-a stays clean. Companions of
  names that are imported as types above (`AccessDepth`, `WriteKind`, `ReadKind`, `debug_ReadOrWrite`) are reached
  through `gen.`.
- `check_if_subslice_element_is_moved`: `from` / `to` are `number`.
- `check_access_permissions`: the `match kind` is a `switch` over `Reservation | Write` (split on the `WriteKind`),
  then `Activation`, then `Read`, keeping upstream arm order.
- `is_mutable`: the `match elem` with the `Field(FieldIdx::ZERO, _) if let Some(adt) = .. && adt.is_pin() &&
  pin_ergonomics()` guard is an if-chain in upstream order, and the guard is evaluated in upstream order.
- `TyCtxtConsts::DEREF_PROJECTION` is a module-level frozen `TyCtxtConsts_DEREF_PROJECTION`. Only
  `check_for_invalidation_at_exit` uses it.
- Other conversions:
  - `.iter_projections().rev()` loops become reverse index loops. `check_if_assigned_path_is_moved`'s `break` becomes
    a labelled `break loop`.
  - The `.unwrap()` calls panic with core's text.
  - `assert!(match borrow.kind {..})` keeps rustc's `stringify!` message.
  - `debug!` / `#[instrument]` are kept as comments.

## For other lanes / root
- Root: merge `contract.test.ts` by deltas (+22 markers, -22 stubs, bck-lib-b row -> comment).
- bck-lib-a: `access_place` / `check_access_for_conflict` call this lane's `check_access_permissions`,
  `check_if_path_or_subpath_is_moved` and friends with the signatures above. The only one that changed is
  `check_if_subslice_element_is_moved` (now `number`).
