# Handoff: mb-mod (M4 wave 22, MIR build fill lane): builder/mod.rs (rest), block.rs, coverageinfo.rs (rest), misc.rs

Branch `lane/mb-mod` (from `7d76ddd0`, no merges). Commits: the ports + lane tests → this handoff.

## Result
All 25 mb-mod stubs of the builder-contract split table are ported (`// rustc:` markers, upstream order and logic).
- **builder/mod.rs** 31/31: `insert_upvar_arg`, `args_and_body`, `set_correct_source_scope_for_arg`, `get_unit_temp` (class body).
- **block.rs** 2/2: `ast_block`, `ast_block_stmts` (the `match kind` arms as an if-chain in upstream arm order; the `let .. else`
  arm, the `span_bug!` arm (initializer missing), the plain `let` arm).
- **coverageinfo.rs** 15/15: `BlockMarkerGen::{next_block_marker_id, inject_block_marker}`, `CoverageInfoBuilder::{visit_unary_not,
  visit_with_not_info, register_two_way_branch, into_done, as_done}`, the `impl Builder` hooks (`push_coverage_point_*`,
  `visit_coverage_{standalone,branch}_condition`, `visit_coverage_conditional_let`).
- **misc.rs** 5/5: `temp`, `literal_operand`, `zero_literal`, `push_usize`, `consume_by_copy_or_move`.

## Files touched
- `src/rustc_mir_build/builder/{mod,block,coverageinfo,misc}.ts` (my stubs only; new imports in mod.ts are of other crates /
  `.gen.ts` modules, so the init-order rule holds; `PlaceBuilder::from` is read lazily from expr/as_place.ts via `as_place()`).
- `src/rustc_mir_build/builder/contract.test.ts`: markers 50 → 75, stubs 263 → 238, the `mb-mod` row removed from the per-lane
  table (0 left). The `construct_fn` stop is unchanged (`scope::Builder::in_scope`, mb-scope): nothing of this lane is on the
  path before it.
- `src/rustc_mir_build/builder/mb_mod.test.ts` (new, 4 tests): runs the methods on a `Builder` made by the ported
  `Builder::new` for `pub fn f(x: u8, y: bool) -> u8 { x }` (no_core + `Copy` lang item, `struct S`) and on hand-built coverage
  states (see "Stops reached").

## Coverage (`bun scripts/coverage.ts --missing ..`)
builder/mod.rs 31/31, block.rs 2/2, coverageinfo.rs 15/15, misc.rs 5/5. `--check`: markers ok (19020; vendor 4196).

## Stops reached (unit tests; end to end MIR building still stops at `in_scope`, mb-scope)
- `args_and_body`: allocates the arg locals + `VarDebugInfo` (`x`/`y`, argument_index 1/2), runs `insert_upvar_arg` (no-op on a
  fn), then stops at `scope::Builder::schedule_drop_value` (mb-scope).
- `set_correct_source_scope_for_arg` → `scope::Builder::maybe_new_source_scope` (mb-scope).
- `ast_block` → `scope::Builder::in_scope` (mb-scope). `ast_block_stmts` also calls `stmt_expr` / `expr_into_dest` /
  `expr_into_pattern` (mb-expr-*), `declare_bindings` / `lower_fallible_let` / `visit_primary_bindings` / `storage_live_binding`
  / `schedule_drop_for_binding` (mb-matches-*), `push_scope` / `pop_scope` / `in_breakable_scope` / `in_if_then_scope` (mb-scope).
- `visit_coverage_standalone_condition` with a coverage builder → `rustc_session::session::Session::instrument_coverage_condition`.
- Fully exercised: misc.rs (incl. `zero_literal` / `push_usize` through `layout_of`, `consume_by_copy_or_move` Copy vs Move),
  `get_unit_temp` caching, `BlockMarkerGen`, `visit_unary_not` / `visit_with_not_info` (flip flags, already-marked, assert),
  `register_two_way_branch`, `into_done` / `as_done`, the Builder coverage hooks with coverage off, `visit_coverage_branch_condition`
  with a flipped `!`.

## `unported(...)` left
- `rustc_session::session::Session::instrument_coverage_condition` (coverageinfo.ts, `visit_coverage_standalone_condition`) and the
  pre-existing `rustc_session::session::Session::instrument_coverage_branch` (`new_if_enabled`): both rustc_session methods are
  not ported (session.ts has only `instrument_coverage`); reached only under `-Cinstrument-coverage` for an eligible body.
  For root / the rustc_session owner: port `Session::instrument_coverage_branch` / `instrument_coverage_condition`
  (session.rs:711 / :716; they need `unstable_opts.coverage_options.level`), then replace the two calls.

## `// PORT:` decisions
- `insert_upvar_arg`: ty/closure.ts's `CAPTURE_STRUCT_LOCAL` has a stand-in `Local` brand (`"mir::Local"`), cast to mir's
  `Local` (it is `Local(1)`). For the ty/closure.ts owner: retype it as `mir::Local`.
- `insert_upvar_arg`: `.iter().zip_eq(capture_tys).enumerate().map(..).collect()` is a loop that maps element by element and panics
  with itertools' message when one side ends first (as the lazy `zip_eq` does); `collect` into `CaptureMap` is
  `SortedIndexMultiMap.from_iter` with the numeric `ItemLocalId` order (as `CaptureMap_new`).
- `args_and_body`: the `VarDebugInfo` of a simple-binding arg gets `clone_SourceInfo(source_info)` (Copy class): the `LocalDecl` holds
  `source_info` itself and its `.scope` is re-set in place below (decision 7 of builder-contract).
- `args_and_body`: `**local_info.as_mut().unwrap_crate_local() = ..` keeps the `unwrap_crate_local` check (a `Clear` is a `bug!`),
  then stores a fresh `ClearCrossCrate::Set`.
- `as_done`: `.to_owned()` of the `[BranchSpan]` is the generated `clone_BranchSpan` per element; `into_done` moves the vec.
- `visit_unary_not`: `assert_matches!`'s pattern text is the `stringify!` of the pattern (ICE message only).
- `consume_by_copy_or_move` uses rustc_trait_selection's `InferCtxtExt::type_is_copy_modulo_regions` without a load-time import of
  that crate (loaded by the driver, like the other mir_build callers of its extensions).
- `debug!` calls are comments (as in cfg.ts).

## Signatures
All declared signatures kept. None found wrong.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok.
- `bun test src/rustc_mir_build --timeout=120000`: 11 pass, 0 fail (contract.test.ts 3, mb_mod.test.ts 4, ...).
- Full `RUST_TS_REQUIRE_PROBES=1 bun test ./src --timeout=120000` (`RUST_TS_AGENT=mb-mod`, once, at `2a673f1d`): 5782 pass,
  1 skip, 0 fail (5783 tests, 398 files, 3976 s under load ~85). Two earlier attempts did not finish: one hit the harness's
  30-min background limit, one was killed externally after ~4 min (exit 144, the cross-lane kills root warned about); neither
  reported a failure.
- Process hygiene: this lane once ran `pkill -f "until grep -qE"` to stop its own wait loops (no `bun test` / difftest
  pattern); per root's notice only own pids are killed from then on.

## Samples (`RUST_TS_AGENT=root-ad4b`, compared case by case (status + unported stop) with root's base runs)
| suite | lane run | M / D / U | base run | changed cases |
|---|---|---|---|---|
| tydump-minicore | `20261022-103622-root-ad4b-8ds3` | 45 / 0 / 1 | `20261022-101651-root-ad4b-9r7y` | 0 / 46 |
| mirdump-minicore | `20261022-103644-root-ad4b-6vxq` | 10 / 0 / 36 | `20261022-101711-root-ad4b-xljd` | 0 / 46 |
| tydump-ui `--sample 300` | `20261022-103712-root-ad4b-tlhg` | 263 / 0 / 36 (+1 unstable) | `20261022-101731-root-ad4b-hqwm` | 0 / 300 |
| hir-tree `--sample 200` | `20261022-104017-root-ad4b-d2t5` | 200 / 0 / 0 | (base: 0 DIFF) | — |

No new DIFF; no case changed status or stop (MIR building is not reached by any suite yet: mirdump stops before it, see the
builder-contract handoff "Not moved by this lane").
