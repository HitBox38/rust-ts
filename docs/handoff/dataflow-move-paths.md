# Handoff: dataflow-move-paths (M4 wave 22, rustc_mir_dataflow fill lane)

Branch `lane/dataflow-move-paths` from `fe77b233`, no merges. Commits:
- `34677d70`: the port (API first, for lane dataflow-impls) plus the contract-test update.
- `fe2b6b91`: the tests.
- This handoff.

## Files touched
- Ported, all stubs filled:
  - `src/rustc_mir_dataflow/move_paths/mod.ts`: 23/23 (22 stubs + the `HasMoveData` marker).
  - `src/rustc_mir_dataflow/move_paths/builder.ts`: 15/15.
  - `src/rustc_mir_dataflow/drop_flag_effects.ts`: 10/10.
  - `src/rustc_mir_dataflow/un_derefer.ts`: 7/7.
  - `src/rustc_mir_dataflow/points.ts`: 7/7.
  - `src/rustc_mir_dataflow/debuginfo.ts`: 2/2.

  That is 63 stubs turned into markers.
- `src/rustc_mir_dataflow/dataflow_contract.test.ts`:
  - Counts: markers 109 → **172**, stubs 269 → **206**.
  - The six files are added to `PORTED`, so they must have 0 stubs.
  - The representative "stops UNPORTED" calls into my stubs are removed; the other lanes' calls stay.
  - **Merge note:** dataflow-impls edits the same two count lines. At merge, sum both lanes' changes.
- New: `src/rustc_mir_dataflow/move_paths/move_paths.test.ts` (7 tests).

## Coverage
`bun scripts/coverage.ts --missing` reports full coverage for each file:

| upstream file | fns ported |
|---|---|
| move_paths/mod.rs | 23/23 |
| move_paths/builder.rs | 15/15 |
| drop_flag_effects.rs | 10/10 |
| un_derefer.rs | 7/7 |
| points.rs | 7/7 |
| debuginfo.rs | 2/2 |

- rustc_mir_dataflow: 109 → 172/378.
- TOTAL: 19227/25518.
- `--check`: markers ok (19798).

## API used by dataflow-impls (unchanged from the contract)
The declared signatures are kept:
- `MoveData.gather_moves(body, tcx, filter)`.
- `move_data.rev_lookup.find(place_ref)` returns a `LookupResult` (`{$:"Exact",_0}` or `{$:"Parent",_0}`). Also `find_local` and `iter_locals_enumerated()` (an array).
- `MovePath.parents/children(move_paths)`: JS iterators.
- `move_data.move_out_loc_map.index(loc)` / `init_loc_map.index(loc)` / `index_mut(loc).value`.
- `MoveOutIndex.move_path_index(mo, md)`, `Init.span(init, body)`.
- In drop_flag_effects: `on_all_children_bits`, `on_lookup_result_bits`, `drop_flag_effects_for_{function_entry,location}`, `on_all_inactive_variants`, `InactiveVariants.contains`, `DropFlagState.value`.
- `DenseLocationMap.new(body)` with its `point_from_location` / `to_location` / ... methods.
- `debuginfo_locals(body)`.

Shape changes from the declarations:
- `MoveSubPath::ConstantIndex` and `MoveSubPathResult::Subslice` hold `number`, not `bigint`, to match `ProjectionElem`.
- New exports in mod.ts:
  - `MoveSubPathResult.{Skip,Stop}` singletons.
  - `MoveSubPath.{Deref,UnwrapUnsafeBinder}` singletons.
  - `debug_InitLocation` and `InitLocation_eq` (derived impls).
- `DebuginfoLocals` now extends mir `Visitor`.

## Tests (`move_paths/move_paths.test.ts`)
- **Setup.** A no_core crate is compiled through `build_mir_inner_impl`.
  - 12 bodies: struct fields, tuple + `switchInt`, `&mut` deref, union field write, `Drop` type field write + `drop(_1)`, enum downcast, `[x, rest @ ..]` subslice, call destinations, and the anonymous array-length consts.
  - The built MIR of these bodies matches the pinned rustc's `-Zdump-mir=built` byte for byte. I checked this with a scratch driver; the 2 bodies returning `()` stop at the known `const ()` printer stop.
- **What the tests check.** The expected move paths, move-outs, inits (with kinds) and child/sibling links were worked out by hand from builder.rs over that MIR. The tests check:
  - those tables;
  - `find` (Exact / Parent, `Index`, `from_end` and subslice stops);
  - the iterators, `find_descendant` order, `base_local`;
  - both drop-flag-effects functions (including `drop(_1)` and calls that only init on the non-panic path), inactive variants and `move_path_children_matching`;
  - the `filter`;
  - `DenseLocationMap`, `debuginfo_locals`.
- **CopyForDeref.** Built MIR has no `CopyForDeref`, and the `Derefer` pass (deref_separator.rs) is a stub. So one test inserts `_2 = deref_copy (*_1)` with a `DerefTemp` local by hand. This covers that arm of `gather_statement`, the `UnDerefer` chains, `iter_projections` through a chain, and the no-move `StorageDead` of a deref temp.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_mir_dataflow`: all pass (contract, framework, toy, move_paths).
- Samples as `RUST_TS_AGENT=root-fe77`, compared case by case (status + stop) with root's base runs: **0 changed**.

| suite | lane run | M / D / U | base run | M / D / U |
|---|---|---|---|---|
| mirdump-minicore (46) | `20261022-152441-root-fe77-v2ty` | 16 / 0 / 30 | `20261022-144421-root-fe77-qdzc` | 16 / 0 / 30 |
| tydump-minicore (46) | `20261022-152458-root-fe77-lia7` | 45 / 0 / 1 | `20261022-144407-root-fe77-zgkc` | 45 / 0 / 1 |

- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: 0 fail (details at the end of this file).
  - Log: `$RUST_TS_DATA/tmp/dataflow-move-paths/full.log`.

## `unported(...)` left
None in the six files.

## `// PORT:` decisions (for `state.ts record decision`)
1. (dataflow-move-paths) `MoveSubPath::ConstantIndex(u64)` / `MoveSubPathResult::Subslice { from, to }` are `number`s, like mir `ProjectionElem::ConstantIndex` / `Subslice`. The unit variants are frozen singletons on the companions (`MoveSubPath.Deref`, `MoveSubPathResult.Skip`); derived `PartialEq` with `Skip` compares `.$`.
2. (dataflow-move-paths) `debug!` calls in builder.rs / drop_flag_effects.rs are comments (compiled out of release rustc); the derived `Debug` of `MoveData` / `LocationMap` / `MovePathLookup` / `UnDerefer` is not ported (only `debug!` uses it). `cfg!(debug_assertions)` / `debug_assert!` blocks are comments; so a bare deref-temp local still walks its chain in `ProjectionIter` (release behavior).
3. (dataflow-move-paths) `LocationMap::new`'s `vec![T::default(); n]` calls `default_T()` per slot; `IndexMut` is `field_mut(data, offset)`. `IndexVec::push` returns `push(..) - 1`; `entry(..).or_insert_with` is get-then-set on the `MoveSubPath_key` map. Indexing that upstream bounds-checks and that could be reached out of range (`LocationMap` index, `ProjectionIter`, `DenseLocationMap`) panics with core's `index out of bounds` message.
4. (dataflow-move-paths) `move_path_for`'s borrowed `ProjectionIter` is the JS iterator: `iter.all(..)` drains it until the first `false`. The nested `fn on_all_children_bits` is a nested function inside its parent (marker kept on it).

## Notes for root
- `debuginfo_locals` is now real. Its users are `simplify.ts` (`UsedLocals::new`) and others in rustc_mir_transform. The minicore samples above show no change.
- Seen on the way (not my files): the port accepted `fn drop(&mut self)` in a no_core crate without a `legacy_receiver` lang item. The pinned rustc rejects it (`error: requires legacy_receiver lang_item`). My scratch driver called `build_mir_inner_impl` directly without the analysis passes, so this may just be a check that wasn't reached there. Worth a look by the wfcheck owner.

## Full suite result
`RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` at `fe2b6b91`: **6012 pass, 1 skip (the existing one), 0 fail** (6013 tests, 422 files, 2996 s).
