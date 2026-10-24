# Handoff: bck-tc-b (M4 wave 23, borrowck fill): type_check relate/free-region/canonical/constraint-conversion/input-output + implied_bounds

Branch `lane/bck-tc-b` (from `e138140f` on integ-w19, no merges).

## Result
All **68** stubs of the row are filled (`// rustc:` markers, upstream order, upstream comments kept):

| upstream (compiler/rustc_borrowck/src/) | TS | coverage |
|---|---|---|
| type_check/relate_tys.rs | src/rustc_borrowck/type_check/relate_tys.ts | 23/23 |
| type_check/free_region_relations.rs | src/rustc_borrowck/type_check/free_region_relations.ts | 15/15 |
| type_check/canonical.rs | src/rustc_borrowck/type_check/canonical.ts | 13/13 |
| type_check/constraint_conversion.rs | src/rustc_borrowck/type_check/constraint_conversion.ts | 11/11 |
| type_check/input_output.rs | src/rustc_borrowck/type_check/input_output.ts | 3/3 |
| implied_bounds.rs (`mir_borrowck_implied_outlives_bounds` provider) | src/rustc_borrowck/implied_bounds.ts | 3/3 |

`bun scripts/coverage.ts --check`: markers ok. No signature of the contract was changed. The ` (lane bck-tc-b)` tags of the
declaration comments (interface members) were dropped with the stubs (lib.ts precedent).

`src/rustc_borrowck/contract.test.ts` (only this lane's numbers): markers 42 → **110** (+68), stubs 859 → **791** (−68), the
`"bck-tc-b": 68` row of the split table is **removed** (the test's `toEqual` cannot hold a 0 row: `per_lane` has no key for a
lane without stubs). Root merges by deltas.

## `unported(...)` left
None in this lane's code. Every remaining stop on these paths is another lane's stub (below).

## Other lanes' stubs this code calls (in the order a `type_check` run would reach them)
- bck-tc-a (type_check/mod.ts): `TypeChecker::{tcx, body, eq_types}`, `mirbug`, `MirTypeckRegionConstraints::placeholder_region`,
  `Locations::span`, `NormalizeLocation_{Locations,Location}.to_locations`, `TypeOp_InstantiateOpaqueType.fully_perform`.
  `placeholder_region` is called with `infcx.infcx` (the `InferCtxt`: upstream auto-derefs `&BorrowckInferCtxt`).
- bck-nll (universal_regions.ts): `UniversalRegions::{to_region_vid, is_universal_region, is_local_free_region,
  is_external_free_region, universal_regions_iter, implicit_region_bound, closure_mapping}`, `DefiningTy::{new_, def_id,
  inputs_and_output}`.
- bck-diag-f (diagnostics/bound_region_errors.ts): `UniverseInfo::{relate, other}`, the five `ToUniverseInfo_*.to_universe_info`.
- bck-regions-b: `OutlivesConstraintSet::push`. bck-regions-a: `LivenessValues::add_all_points`.
- bck-lib-a: `ClosureOutlivesSubjectTy::instantiate`.

The contract test's runtime stop is unchanged (`rustc_borrowck::nll::replace_regions_in_mir`, bck-nll): this lane's code is
not reached by any run yet, so nothing was re-pinned.

## `// PORT:` decisions
- relate_tys.ts: header (descriptor parameters, `enter_forall`'s `f(this_, t)`); `reg_map` is a `KeyedMap` on `intern_key`
  (struct key `BoundRegion`); the `cfg!(debug_assertions)` block of `next_placeholder_region` is compiled out (lib.ts
  precedent; `reg_info` is still computed, `item_name` included); `tys`' or-pattern with guard
  `(Opaque{def_id}, _) | (_, Opaque{def_id}) if def_id.is_local() && ..` tries the guard per matching alternative (Rust
  semantics); `relate(..)?` into `Result<(), NoSolution>` maps the `TypeError` to `NoSolution` (`From`).
- canonical.ts: header (`TypeOp_Op` / `ToUniverseInfo_E` / `d_T` / `display_T` / `NormalizeLocation_L` / `upcast_C` tables;
  `op.fully_perform(infcx, ..)` takes `infcx.infcx`); the `cfg!(debug_assertions)` leftover-constraints check of
  `fully_perform_op_raw` is compiled out; `(old_universe + 1)..=universe` iterates `UniverseIndex.as_u32`; the
  `CustomTypeOp` closure of `ascribe_user_type_skip_wf` maps `ocx.eq`'s `TypeError` to `NoSolution` (`?`) and uses
  `TypeOp_CustomTypeOp(fold_unit)` (`R = ()`, rustc_trait_selection solve/inspect/analyse.ts) + `ToUniverseInfo_never`.
- constraint_conversion.ts: `TypeOutlivesDelegate` on the prototype; `higher_ranked_assumptions` is a `KeyedSet` on
  `intern_key` (`elaborate_outlives_assumptions`'s result, an empty one for `&Default::default()`); local `TypeFoldable`
  descriptors for `GenericKind` / `VerifyBound` (rustc_trait_selection region.ts precedent).
- free_region_relations.ts: `Frozen<T>` = `T`; `RegionBoundPairs::default()` is a `KeyedSet` on `intern_key` (rustc_infer
  outlives/env.ts); `OriginalQueryValues { var_values, ..Default::default() }` spreads `default_()`; the query value of
  `mir_borrowck_implied_outlives_bounds` is cast (queries.gen.ts types it `Result<unknown, unknown>`); local descriptors
  for `OutlivesBound` / `MirBorrowckImpliedOutlivesBounds`; the `unwrap_or_else(|guar| TypeOpOutput { Ty::new_error .. })`
  fallback is the module helper `normalize_error_output`.
- input_output.ts: `span_mirbug!` is the module helper `span_mirbug` (format of type_check/mod.rs:53); `zip_eq` is an
  explicit length check with itertools' panic message; `assert_matches!` is a real assertion (`panic` with the
  `left matches right` message).
- implied_bounds.ts: local descriptor for `MirBorrowckImpliedOutlivesBounds`; `deeply_normalize(..).map_err(|_| NoSolution)?`.
- Everywhere: `#[instrument]` / `debug!` stay comments (tracing is off in the oracle); `debug_assert!`s stay comments.

## Init order
Value imports of hand modules (`../diagnostics/bound_region_errors.ts`, `../universal_regions.ts`, `./mod.ts`,
`../implied_bounds.ts`) are used only inside function bodies; `ConstraintConversion` / `UniversalRegions` are imported from
their `.gen.ts`. `rustc_hir` is imported through `hir.ts` (importing `hir.gen.ts` directly breaks a fresh-entry load with
`Cannot access 'LifetimeSyntax' before initialization`). All 62 hand modules load as fresh entries (contract test).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun test src/rustc_borrowck`: 6 pass, 0 fail. `coverage.ts --check`: markers ok.
- Full unit suite (`bun test src --timeout=120000`, run once): **did not finish** (stopped at the 30-minute limit on the
  shared machine, load ~70). Failures seen before the stop, 12, none in this lane's files and none reaching its code:
  - `src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts` (11 end-to-end cases e0049_fn .. refine_rpitit): PENDING
    pins `mir_borrowck provider (not ported)`, got `rustc_borrowck::nll::replace_regions_in_mir`. That's the
    borrowck-contract stop change (already on base `e138140f`; the contract re-pinned 4 other tests but not this one).
  - `src/rustc_hir_analysis/hir_ty_lowering/errors.oracle.test.ts` (1 case): got
    `rustc_mir_transform::cleanup_post_borrowck::CleanupPostBorrowck (pass not ported)` (rustc_mir_transform, not borrowck
    type_check).
  **Root**: re-pin those PENDING stops at integration (not this lane's files).

## Samples (`RUST_TS_AGENT=root-f5de`, same samples as root's base runs)
| suite | lane run | M / D / U / C / UNSTABLE | base run | M / D / U / C / UNSTABLE |
|---|---|---|---|---|
| tydump-minicore (46) | `20261022-211014-root-f5de-9bnb` | 45 / 0 / 1 / 0 / 0 | `20261022-175059-root-f5de-8kp6` | 45 / 0 / 1 / 0 / 0 |
| mirdump-minicore (46) | `20261022-211114-root-f5de-vmig` | 45 / 0 / 1 / 0 / 0 | `20261022-175111-root-f5de-bbue` | 17 / 0 / 29 / 0 / 0 |
| tydump-ui `--sample 300` | `20261022-211204-root-f5de-rwwy` | 261 / 0 / 37 / 0 / 2 | `20261022-175123-root-f5de-supl` | 258 / 0 / 40 / 0 / 2 |
| mirdump-ui `--sample 300` | `20261022-211805-root-f5de-7bsx` | 269 / 0 / 31 / 0 / 0 | `20261022-175248-root-f5de-c6id` | 17 / 0 / 283 / 0 / 0 |
| borrowck-ui `--sample 300` | `20261022-212306-root-f5de-pjka` | 0 / 0 / 300 / 0 / 0 | (none) | |

Per-case comparison: **no MATCH lost, no new DIFF / CRASH / TIMEOUT**. Every change comes from the base branch
(`e138140f` vs the base runs' tree: the borrowck contract, CTFE, MIR passes), not from this lane, which no run reaches yet:
tydump-ui 21 × `mir_borrowck provider (not ported)` → `rustc_borrowck::nll::replace_regions_in_mir`, 12 × `eval_to_valtree` →
`eval_in_interpreter`, 3 UNPORTED → MATCH, 1 → `IntoDiagArg without a TS impl`; mirdump-ui 252 UNPORTED → MATCH, 13 →
`replace_regions_in_mir`, 16 CTFE stop renames, 2 → `ConstValue::try_to_bits_for_ty (M4)`; mirdump-minicore 28 UNPORTED →
MATCH. borrowck-ui stops: 287 × `rustc_borrowck::nll::replace_regions_in_mir` (bck-nll), 13 × `eval_in_interpreter`.
