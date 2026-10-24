# Handoff: bck-tc-live (M4 wave 23, borrowck fill)

Branch `lane/bck-tc-live` (from `e138140f` on integ-w19, no merges).

## Result
All 34 `(lane bck-tc-live)` stubs filled, plus rustc_trait_selection's `traits/outlives_for_liveness.rs` (its module
already existed as a selcx-contract stub, so I filled it in place rather than creating a new one).

| upstream file | coverage |
|---|---|
| compiler/rustc_borrowck/src/type_check/liveness/mod.rs | 9/9 |
| compiler/rustc_borrowck/src/type_check/liveness/trace.rs | 18/18 |
| compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs | 7/7 |
| compiler/rustc_trait_selection/src/traits/outlives_for_liveness.rs | 8/8 (was 0/8) |

`bun scripts/coverage.ts --check`: markers ok (20462; vendor 4330).

## Files touched
- `src/rustc_borrowck/type_check/liveness/{mod,trace,local_use_map}.ts` (the stubs, in place).
- `src/rustc_trait_selection/traits/outlives_for_liveness.ts` (whole file).
- `src/rustc_trait_selection/traits/mod.ts` (**shared file**): `traits::provide` now installs
  `live_args_for_alias_from_outlives_bounds` and `args_known_to_outlive_alias_params`, as upstream does. Before this
  change both lines were commented out and the queries used the driver's placeholder providers. Also adds
  `import * as outlives_for_liveness` and a type import of `AliasTyKind`.
- `src/rustc_borrowck/contract.test.ts`: my split-table row is gone (34 -> 0), stubs 859 -> 825, markers 42 -> 76.
  Root: merge these by deltas (-34 stubs, +34 markers).

## Runtime stop
Unchanged: `mir_borrowck` still stops at `rustc_borrowck::nll::replace_regions_in_mir` (bck-nll), so nothing re-pinned.
My code is reached from `type_check::type_check` (bck-tc-a) through `liveness::generate`.

## Other lanes' stubs this code calls (in call order on the liveness path)
- bck-nll: `UniversalRegions::{universal_regions_iter, is_universal_region, to_region_vid}`,
  `PoloniusLocationTable::to_location` (legacy facts only).
- bck-regions-a: `LivenessValues::{add_all_points, add_location, add_points}`.
- bck-regions-b: `OutlivesConstraintSet::reverse_graph`, `ConstraintGraph::region_graph`,
  `RegionGraph::outgoing_regions`, `Iterator_Successors.next`.
- bck-tc-a: `TypeChecker::{tcx, push_region_constraints}`, `NormalizeLocation_Location.to_locations`.
- bck-core: `BorrowSet::len`, `def_use::categorize`.
- bck-polonius: `record_live_region_variance`, `DeferredRegionLiveness::defer_local` (only under `-Zpolonius=next`
  with loans; the variance call also runs on every run with a polonius context).
- **bck-polonius-legacy (wave 26): `polonius::legacy::emit_drop_facts`.** Root needs to act on this one: every NLL
  run with a drop-live local (or a boring local that is deferred) calls it, and upstream returns at once when
  `facts` is `None` (`let Some(facts) = facts.as_mut() else { return };`). If it stays a wave-26 stub, borrowck stops
  there for any body with drops. Suggest moving it to bck-nll, or porting it now: its body is 6 lines, and
  `drop_of_var_derefs_origin` is reached only when facts exist.

## `unported(...)` left
None in the four ported files.

## `// PORT:` decisions
- liveness/mod.ts: the `tcx.prof` timer is dropped (driver-m2 decision 8). `partition_map` / `filter_map` /
  `iter_enumerated` are explicit loops in the same order. `stack.extend(..filter(|&r| set.insert(r)))` is an
  insert-and-push loop over `Iterator_Successors.next`. `debug!` calls are kept as comments. `LiveVariablesVisitor`
  passes descriptors `relate_GenericArgs` / `relate_Region` / `relate_Ty` to `record_regions_live_at`.
  `make_all_regions_live` builds trait_selection's `FreeRegionsVisitor` class.
- liveness/local_use_map.ts: `appearances_iter` returns an `Iterable` that drives `Iterator_AppearancesIter.next`.
  `defs` / `uses` / `drops` are a lazy `map_iter` helper (marked PORT). `&mut first_*_at[local]` is the array plus
  the index. `nones.clone()` is `slice()`.
- liveness/trace.ts:
  - `DeferredRegionLiveness::default()` and `DropckOutlivesResult::default()` are written as explicit empty
    constructions.
  - `FxIndexSet` / `FxIndexMap` are `Set` / `Map`. `entry().or_insert_with` is get-or-compute.
  - The `flow_inits` field is typed `ResultsCursor<unknown, ..>` by codegen, so it is cast to the real domain
    (`MaybeInitCursor`). `flow_inits.get().clone()` uses `Clone_MaybeReachable(Clone_MixedBitSet)`.
  - `(entry_point..term_point).rev()` is a descending loop.
  - `PoloniusFacts` is `unknown` (D7), so `facts.var_dropped_at` is read through a cast to polonius-engine 0.13.0's
    `Vec<(Variable, Point)>` field (facts.rs:43, checked against the crate source).
  - `polonius_facts` is passed to `emit_drop_facts` as the `MutRef`'s `.value`.
  - The dropck error path passes `infcx.infcx` to `ObligationCtxt::new_with_diagnostics` (the deref coercion).
- outlives_for_liveness.ts:
  - The generated `FreeRegionsVisitor` is a data interface. The module declares a class of the same name that
    implements it plus `TypeVisitor<undefined>`; the class shadows the `export *` and takes its fields in declaration
    order. The provided visitor methods forward to `TypeVisitor_provided`.
  - The query results are `unknown`-typed and cast. `live_args_for_alias_from_outlives_bounds(kind)` is
    `.clone()`d before `intersect`, as upstream does.
  - `opt_alias_variances(kind)` takes `AliasTermKind.from_AliasTyKind(kind)` (the `impl Into`).
  - The local helper `alias_ty_kind_def_id` stands for the repeated 4-arm `def_id` match.
- traits/mod.ts: the `live_args_for_alias_from_outlives_bounds` provider casts its `unknown` key (`AliasTyKind`).

## Known gaps outside my files
- The `live_args_for_alias_from_outlives_bounds` query's `desc` is `unported` in queries.gen.ts (Debug of
  `AliasTyKind`). It is only read for cycle / ICE query stacks.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_borrowck`: 6 pass, 0 fail (contract test included).
- `bun test src/rustc_trait_selection`: 139 pass, 0 fail.

## Samples (`RUST_TS_AGENT=root-f5de`, vs the base runs named in the assignment, per-case compare)
| suite | lane run | M / D / U / C / UNSTABLE | base run | per-case vs base |
|---|---|---|---|---|
| tydump-minicore (46) | `20261022-210451-root-f5de-wos5` | 45 / 0 / 1 / 0 / 0 | `20261022-175059-root-f5de-8kp6` | 0 status changes; 1 stop moved (CTFE, not mine) |
| mirdump-minicore (46) | `20261022-210534-root-f5de-p8q4` | 45 / 0 / 1 / 0 / 0 | `20261022-175111-root-f5de-bbue` | 28 UNPORTED -> MATCH, 0 regressions |
| tydump-ui `--sample 300` | `20261022-210624-root-f5de-zjq3` | 261 / 0 / 37 / 0 / 2 | `20261022-175123-root-f5de-supl` | 3 UNPORTED -> MATCH, 0 regressions; `mir_borrowck` stops now read `replace_regions_in_mir` (contract) |
| mirdump-ui `--sample 300` | `20261022-211125-root-f5de-mzgb` | 269 / 0 / 31 / 0 / 0 | `20261022-175248-root-f5de-c6id` | 252 UNPORTED -> MATCH, 0 regressions |
| borrowck-ui `--sample 300` | `20261022-211729-root-f5de-86qn` | 0 / 0 / 300 / 0 / 0 | (none given) | stops: 287 `rustc_borrowck::nll::replace_regions_in_mir`, 13 `eval_in_interpreter` |

**No new DIFF / CRASH / TIMEOUT, and no MATCH lost.** The base runs come from `f5de3f15`. The UNPORTED -> MATCH changes
come from the work merged into integ-w19 since then (this lane's base is `e138140f`), not from this lane: my code
is not reached yet, because every borrowck run stops earlier at `replace_regions_in_mir`.
