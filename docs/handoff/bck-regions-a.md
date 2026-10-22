# Handoff: bck-regions-a (M4 wave 23, borrowck fill): region_infer/{values, mod, region_context}

Branch `lane/bck-regions-a` (from `e138140f` on integ-w19, no merges).

## Result
All 85 stubs of the row are filled, in upstream order, with `// rustc:` markers:
- `compiler/rustc_borrowck/src/region_infer/values.rs` **35/35** (`LivenessValues`, `PlaceholderIndices`, `RegionValues<N>`,
  `pretty_print_region_elements` + its nested `push_location_range`).
- `compiler/rustc_borrowck/src/region_infer/mod.rs` **8/8** (`Representative::{rvid, new}`, `<TypeTest as Debug>::fmt` +
  nested `fmt_bound`, `sccs_info`, `BestBlame::{to_obligation_cause, constraint, path}`).
- `compiler/rustc_borrowck/src/region_infer/region_context.rs` **45/45** (42 filled here + the 3 Deref markers from the
  contract): `RegionInferenceContext::{solve, region_contains_point, first_non_contained_inclusive}`, every
  `RegionInferenceContextInner` method (constraint path search, `best_blame_constraint`, `approx_universal_upper_bound`, ...),
  every `UnsolvedRegionInferenceContext` method (`propagate_constraints`, `check_type_tests`, `try_promote_type_test*`,
  `eval_verify_bound` / `eval_if_eq` / `eval_outlives`, `check_universal_region(s)`, `check_polonius_subset_errors`,
  `try_propagate_universal_region_error`, `check_bound_universal_region`, ...).

Contract test (`src/rustc_borrowck/contract.test.ts`): markers 42 → **127** (+85), stubs 859 → **774** (−85), the
`bck-regions-a` row removed from the split table (0 left; a comment marks it). Root: merge by deltas.

## Files touched
- `src/rustc_borrowck/region_infer/values.ts`, `mod.ts`, `region_context.ts` (bodies + imports; header notes updated)
- `src/rustc_borrowck/region_infer/values.test.ts` (new: unit tests of `RegionValues` / `LivenessValues` /
  `PlaceholderIndices` / `pretty_print_region_elements` on a hand-built `DenseLocationMap`; the runtime path does not reach
  region inference yet)
- `src/rustc_borrowck/contract.test.ts` (my row, totals, marker count only)

## Runtime path
Not reached yet: `mir_borrowck` still stops at `rustc_borrowck::nll::replace_regions_in_mir` (bck-nll), before
`type_check` and `nll::compute_regions` → `RegionInferenceContext::solve`. No runtime stop was re-pinned.
When `solve` is reached, these other-lane stubs are next on its path (in call order):
- bck-regions-b: `OutlivesConstraintSet::{graph, outlives}`, `ConstraintGraph::{is_normal, outgoing_edges_from_graph,
  outgoing_edges_from_static}`, `Iterator_EdgesFromGraph` / `Iterator_EdgesFromStatic.next`, `RegionTracker::{
  max_nameable_universe, can_name_all_placeholders}` (handle_placeholders.rs); `Sccs` is ported (rustc_data_structures).
- bck-diag-e: `RegionErrors::{new, push}`. bck-diag-f: `UniverseInfo::other`.
- bck-nll: `UniversalRegions::{len, to_region_vid, is_universal_region, is_local_free_region,
  num_global_and_external_regions, annotate}`.
- bck-tc-b: `UniversalRegionRelations::{outlives, postdom_upper_bound, non_local_upper_bounds, non_local_lower_bounds}`.
- bck-lib-a: `ClosureOutlivesSubjectTy::bind` (closure type-test promotion). bck-polonius: `LiveLoans::contains`
  (`is_loan_live_at`, `-Zpolonius=next` data).
- `sccs_info` (only under `cfg!(debug_assertions)`, compiled out) needs bck-nll's `RegionCtxt::preference_value`.

## `unported(...)` left
- `polonius_engine::Output::subset_errors` (region_context.ts, `PoloniusOutput_subset_errors`): `PoloniusOutput` is
  `unknown` until vendor polonius-engine lands (D7, wave 26, bck-polonius-legacy); only `-Zpolonius=legacy` reaches
  `check_polonius_subset_errors`. The rest of that fn is ported over the accessor.

## `// PORT:` decisions
- values.ts: `Rc<DenseLocationMap>` is the shared map; `live_regions_unordered` iterates the JS `Set` in insertion order
  (upstream hash order; its callers are `potential_query_instability`). `PlaceholderIndices`: the generated field is a
  `Set<PlaceholderRegion>` but `PlaceholderRegion` is a plain object, so `insert` / `lookup_index` / `lookup_placeholder`
  compare by value (`intern_key_eq`) in insertion order (= the `IndexSet` index) whatever `Set` the constructor stored;
  added `default_PlaceholderIndices()` (the `#[derive(Default)]`, storing a `KeyedSet(intern_key)`). `add_region` evaluates
  all three unions (`|`). Nested `push_location_range` hoisted; `&mut String` is a `MutRef<string>`.
- mod.ts: `debug_TypeTest` / `fmt_bound` format each argument with a fresh spec (`PLAIN`) and return the text; `fmt_bound`
  hoisted. `sccs_info`: `enabled!(Level::DEBUG)` blocks and `debug!` stay comments (statically disabled, `max_level_info`);
  `FxIndexSet<(RegionVid, RegionCtxt)>` is a `KeyedSet(intern_key)`; `max_by` keeps the last maximum.
- region_context.ts: `cfg!(debug_assertions)` → `sccs_info` call compiled out; `VecDeque` = array + read cursor;
  `min_by_key` keeps the first minimum (of the reversed enumeration when `blame_source`); constraint paths hold
  `clone_OutlivesConstraint` copies (`*c`, `.copied()`), so `best_blame_constraint` can rewrite `path[best_choice].category`;
  struct-keyed sets in `check_type_tests` are `KeyedSet(intern_key)`; `RegionElement` / placeholder equality is
  `intern_key_eq`; `&BorrowckInferCtxt` passed as `&InferCtxt` is `infcx.infcx` (Deref); `GenericKind` / `VerifyIfEq`
  `TypeFoldable` descriptors built from region_constraints/mod.gen.ts's derived impls; `PoloniusOutput_subset_errors` (above).
- Init order: region_infer/mod.ts and region_context.ts import constraint items from `../constraints/mod.ts` and
  region_infer items from `./mod.ts`, never `constraints/mod.gen.ts` (entering that generated module first evaluates
  constraints/mod.ts's prototype assignments before `OutlivesConstraintSet` exists: TDZ, caught by the fresh-entry test).

## Notes for other lanes / root
- bck-tc-a (`MirTypeckRegionConstraints`): construct `placeholder_indices` with `default_PlaceholderIndices()`
  (values.ts). The generated `clone_PlaceholderIndices` rebuilds a plain `Set` (codegen: `FxIndexSet` of a struct key);
  the methods here still work on it (by-value lookups), but `Set.has` on the field would not.
- No signature was changed.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (20505; vendor 4330).
- `bun test src/rustc_borrowck`: contract 6 pass + values 4 pass.
- Full unit suite (`RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`, `RUST_TS_AGENT=bck-regions-a`): **6099 pass,
  1 skip, 12 fail** (6112 tests, 437 files). The 12 failures are **pre-existing on the base e138140f** and not this lane's:
  `src/rustc_hir_analysis/hir_ty_lowering/errors.oracle.test.ts` (e0109_kinds) and
  `src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts` (11 `end to end` cases) pin the old stop
  `mir_borrowck provider (not ported)`, a string that no longer exists in the source since the borrowck-contract merge
  (those PENDING pins came with `d39c8e65` passes-analysis). They now stop at `rustc_borrowck::nll::replace_regions_in_mir`
  (11) and `rustc_mir_transform::cleanup_post_borrowck::CleanupPostBorrowck (pass not ported)` (1, a body whose borrowck
  returns early). Root (or the owner of those tests) should re-pin them; this lane does not edit them.

## Samples (`RUST_TS_AGENT=root-f5de`, vs the given base runs, same samples)
| suite | lane run | M / D / U / C / T / UNSTABLE | base run | M / D / U / C / T / UNSTABLE |
|---|---|---|---|---|
| tydump-minicore (46) | `20261022-210559-root-f5de-jpb1` | 45 / 0 / 1 / 0 / 0 / 0 | `20261022-175059-root-f5de-8kp6` | 45 / 0 / 1 / 0 / 0 / 0 |
| mirdump-minicore (46) | `20261022-210647-root-f5de-ah7s` | 45 / 0 / 1 / 0 / 0 / 0 | `20261022-175111-root-f5de-bbue` | 17 / 0 / 29 / 0 / 0 / 0 |
| tydump-ui `--sample 300` | `20261022-210736-root-f5de-bqj5` | 261 / 0 / 37 / 0 / 0 / 2 | `20261022-175123-root-f5de-supl` | 258 / 0 / 40 / 0 / 0 / 2 |
| mirdump-ui `--sample 300` | `20261022-211238-root-f5de-3iq0` | 268 / 0 / 31 / 0 / 1 / 0 | `20261022-175248-root-f5de-c6id` | 17 / 0 / 283 / 0 / 0 / 0 |
| borrowck-ui `--sample 300` | `20261022-211914-root-f5de-2igb` | 0 / 0 / 300 / 0 / 0 / 0 | (no base given) | |

No MATCH lost, no new DIFF/CRASH. All moves come from the base tree (e138140f: the borrowck contract + CTFE/validator work
merged since the base runs), not from this lane's code, which no case reaches: the `mir_borrowck` stops are
`rustc_borrowck::nll::replace_regions_in_mir` (tydump-ui 21, mirdump-ui 13, borrowck-ui 287; the other 13 borrowck-ui
cases stop in CTFE `eval_in_interpreter`). The one mirdump-ui TIMEOUT (`tests/ui/mir/issue-29227.rs`, UNPORTED in the
base) is load-induced (load average 110-160 during the run): re-run alone it is a **MATCH**
(`20261022-212425-root-f5de-slqg`).
