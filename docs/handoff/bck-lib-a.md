# Handoff: bck-lib-a (M4 wave 23 borrowck fill, second batch)

Branch `lane/bck-lib-a` (from `f0e9a0cf` on integ-w19, no merges). Filled all 8 stubs of the bck-lib-a row of the
borrowck-contract split table, from upstream `compiler/rustc_borrowck/src/lib.rs` lines < 1400.

## Files touched
- `src/rustc_borrowck/lib.ts`. The 8 bodies were ported in place:
  - `ClosureOutlivesSubjectTy::bind` (267) and `instantiate` (282).
  - `MirBorrowckCtxt`'s `ResultsVisitor` methods: `visit_after_early_statement_effect` (808),
    `visit_after_early_terminator_effect` (882) and `visit_after_primary_terminator_effect` (994).
  - `access_place` (1190), `borrows_in_scope` (1249) and `check_access_for_conflict` (1268). In
    `check_access_for_conflict`, every arm of `match (rw, borrow.kind)` is ported in upstream order, and so is every
    error-reporting call: `report_use_while_mutably_borrowed` / `report_conflicting_borrow` + `buffer_error`,
    `report_borrowed_value_does_not_live_long_enough(.., Some(StorageDeadOrDrop))`, `report_illegal_mutation_of_borrowed`
    (`Mutate` and `Replace`) and `report_move_out_while_borrowed`. The `reservation_error_reported` insert happens before
    the report, as upstream does it.
  - One new import block, placed just above the `ClosureOutlivesSubjectTy` augmentation and marked
    `// ---- lane bck-lib-a imports ----`. I did not edit the top-of-file imports or any bck-lib-b line, so the merge
    with bck-lib-b should be clean. The `// lib.rs:<line> (lane bck-lib-a)` comments inside the `declare module`
    interfaces are unchanged (bck-nll and bck-core did the same). They sit next to bck-lib-b's lines, so I left them
    alone to avoid a merge conflict.
- `src/rustc_borrowck/contract.test.ts`: markers 397 → **405** (+8), stubs 504 → **496** (−8), and the `"bck-lib-a": 8`
  row is replaced by a comment (0). Other lanes edit the same numbers, so merge by deltas.
- New `src/rustc_borrowck/bck_lib_a.test.ts` (6 tests). It compiles a no_core crate up to built MIR, renumbers its
  borrows, builds a real `BorrowSet`, and uses a `MirBorrowckCtxt` stand-in. On that stand-in, the callees owned by
  other lanes are replaced by recorders: the lib.rs >= 1400 methods (bck-lib-b) and the `report_*` / `buffer_error`
  builders (bck-diag-*). The test therefore pins none of their stubs and keeps passing when those lanes land. It
  checks:
  - the `bind` / `instantiate` round trip, plus the `bug!` on other regions;
  - every `check_access_for_conflict` arm against Mut / Shared / Fake(Shallow) / Fake(Deep) borrows, a two-phase
    reservation that is not yet active, activation of the same borrow and of another one, and the reservation record;
  - `access_place`: call order, `access_place_error_reported` suppression (including `is_mutable` / `add_used_mut` for
    `Write(Mutate)`), and the skip for an activation of a failed reservation;
  - `borrows_in_scope` without polonius;
  - the three visitor methods over every statement and terminator of two bodies, under both `LocalsStateAtExit`
    variants.

  I worked out every expected line by hand from upstream over the MIR shown in the test.

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_borrowck/src/lib.rs`: **24/46**. All 22 that are missing are
bck-lib-b's (lines >= 1402). `bun scripts/coverage.ts --check`: markers ok (21244; vendor 4330).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_borrowck`: 23 pass, 1 fail. The failure is the known contract runtime-stop pin (see below).
- Full `bun test src`: UNIT_RESULT

## Runtime stop (not re-pinned; root re-pins)
At this base, the contract test's real body (`f`) stops at
**`rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::relate`** (bck-diag-f). That stop is inside
`type_check` and comes before any code of this lane, and this lane did not move it. The test still pins
`rustc_borrowck::borrow_set::BorrowSet::build` (a known failure at the base). The borrowck-ui sample stops at the same
place (209× `UniverseInfo::relate`, 74× `OutlivesConstraintSet::push` (bck-regions-b), 12× `PoloniusFacts_default`,
5× metadata `Decodable for mir::Body`).

Once the run gets past type_check / region inference, my code is reached through `visit_results(.., mbcx)` in
`borrowck_check_region_constraints`. It then calls these stubs of other lanes:
- bck-lib-b: `check_activations` (the first call of every statement / terminator), `consume_rvalue`, `mutate_place`,
  `consume_operand`, `check_if_path_or_subpath_is_moved`, `check_backward_incompatible_drop`, `check_access_permissions`
  (`access_place` calls it before the conflict check), `is_mutable`, `add_used_mut`, `check_for_local_borrow` and
  `check_for_invalidation_at_exit`.
- bck-diag-d: `MirBorrowckCtxt::buffer_error`.
- bck-diag-a: `report_move_out_while_borrowed`, `report_use_while_mutably_borrowed`, `report_conflicting_borrow`,
  `report_borrowed_value_does_not_live_long_enough` and `report_illegal_mutation_of_borrowed`.
- `dump_annotation` (bck-nll) and bck-tc-b now reach a ported `ClosureOutlivesSubjectTy::instantiate`.

## Sample difftests (`RUST_TS_AGENT=root-f5de`, same samples as root's base runs)
| suite | lane run | M / D / U / C / UNSTABLE | base run | M / D / U / C / UNSTABLE |
|---|---|---|---|---|
| tydump-minicore (46) | `20261022-231952-root-f5de-lis6` | 45 / 0 / 1 / 0 / 0 | `20261022-210451-root-f5de-wos5` | 45 / 0 / 1 / 0 / 0 |
| mirdump-minicore (46) | `20261022-232009-root-f5de-camw` | 45 / 0 / 1 / 0 / 0 | `20261022-210534-root-f5de-p8q4` | 45 / 0 / 1 / 0 / 0 |
| tydump-ui `--sample 300` | `20261022-232023-root-f5de-iilu` | 261 / 0 / 37 / 0 / 2 | `20261022-210624-root-f5de-zjq3` | 261 / 0 / 37 / 0 / 2 |
| mirdump-ui `--sample 300` | `20261022-232203-root-f5de-8fn8` | **271** / 0 / 29 / 0 / 0 | `20261022-211125-root-f5de-mzgb` | 269 / 0 / 31 / 0 / 0 |
| borrowck-ui `--sample 300` | `20261022-232353-root-f5de-va8l` | 0 / 0 / 300 / 0 / 0 | `20261022-211729-root-f5de-86qn` | 0 / 0 / 300 / 0 / 0 |

I compared every case against its base run: no MATCH was lost and there is no new DIFF / CRASH / TIMEOUT. The 2
mirdump-ui gains are `tests/ui/mir/issue-76248.rs` and `mir-inlining/ice-issue-77564.rs`. In the base run they stopped
at `eval_in_interpreter`, so the newer base tree (the CTFE lanes) made them pass, not this lane. The borrowck-ui stops
moved from `replace_regions_in_mir` to the type_check stops listed above, which also comes from the base tree.

## `unported(...)` left
- `PoloniusOutput_errors_at` (lib.ts, a new module-level helper used by `borrows_in_scope`) calls
  `unported("polonius_engine::Output::errors_at (vendor polonius-engine, plan-m4 D7, wave 26)")`. `polonius_output`
  is only `Some` under `-Zpolonius=legacy`, and `PoloniusOutput` is `unknown` until the vendor crate is ported.
- No stubs are left in this lane's row.

## `// PORT:` decisions
- The import block sits next to the lane's code (parallel bck-lib-b in the same file). `Region`, `RegionVid` and
  `MixedBitSet` are already imported as types only at the top, so their values are reached through namespace imports
  (`sty.Region`, `region_kind_gen.RegionVid`, `bit_set.MixedBitSet`). Root may fold these into the top imports after
  the merge.
- `check_access_for_conflict`: the `match (rw, borrow.kind)` is an if-chain in upstream arm order. The last arm
  `(Reservation(kind) | Activation(kind, _) | Write(kind), _)` narrows `rw` with a cast (`Exclude<ReadOrWrite, Read>`),
  because the earlier arms already cover every `Read`: `Shared` / `Fake` by the second arm, `Mut` by the `(Read(kind),
  Mut)` arm. `ControlFlow::Continue(())` / `Break(())` are `ControlFlow.CONTINUE` / `ControlFlow.Break(null)`.
- `borrows_in_scope`: `Cow` is the set itself (the existing PORT note). `polonius.errors_at` goes through the helper
  above.
- `access_place`: `rw == ReadOrWrite::Write(WriteKind::Mutate)` is a check on the variant tags. `is_empty()` is
  `.size !== 0`.
- `debug!` / `#[instrument]` are kept as comments, and `debug_assert_eq!(debruijn, depth)` too (PORTING §3).

## For other lanes / root
- Root: re-pin the contract runtime stop to `rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::relate`
  (or whatever the merged tree gives).
- No shared files edited (only lib.ts's own stubs, the contract test's counts, and the new test file).

## Full unit suite (root note)
The lane's final full-suite run was cut off by the API limit / machine reboot. Root ran the full suite at integration instead (merge into integ-w19).
