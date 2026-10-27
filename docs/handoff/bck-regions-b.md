# Handoff: bck-regions-b (M4 wave 23 borrowck fill, second batch)

Branch `lane/bck-regions-b` (base `f0e9a0cf`, no merges). Commits: constraints/* + handle_placeholders → reverse_sccs /
dump_mir / graphviz → opaque_types/* → graphviz header note → this handoff.

## Files touched
- `src/rustc_borrowck/constraints/mod.ts`, `constraints/graph.ts`
- `src/rustc_borrowck/handle_placeholders.ts`
- `src/rustc_borrowck/region_infer/reverse_sccs.ts`, `region_infer/dump_mir.ts`, `region_infer/graphviz.ts`
- `src/rustc_borrowck/region_infer/opaque_types/{mod,member_constraints,region_ctxt}.ts`
- `src/rustc_borrowck/contract.test.ts`: my row only (`bck-regions-b` 94 → 0, commented out), markers 397 → 491,
  stubs 504 → 410.

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_borrowck/src/<file>`)
All 94 stubs filled. constraints/mod.rs 6/6, constraints/graph.rs 21/21, handle_placeholders.rs 15/15,
region_infer/reverse_sccs.rs 2/2, dump_mir.rs 2/2, graphviz.rs 22/22, opaque_types/mod.rs 18/18,
opaque_types/member_constraints.rs 6/6, opaque_types/region_ctxt.rs 5/5. `coverage.ts --check`: markers ok.

## Runtime path / stops
None of my code is reached yet. `mir_borrowck` stops inside `type_check` at
**`rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::relate`** (bck-diag-f). That is the same stop as on the
base `f0e9a0cf`: I checked by running the contract test against the base's `src/rustc_borrowck`. So my lane did not move
the runtime stop. The contract test's runtime-stop pin (`BorrowSet::build`) is still one of the known failures; I did not
touch it (fix-w23-bck re-pins it).
Next stubs of other lanes that my code calls, once the path gets here (call order):
- `compute_sccs_applying_placeholder_outlives_constraints`: `InferCtxt::get_region_var_infos` (ported),
  `UniversalRegions::named_universal_regions_iter` / `fr_static` (bck-nll, ported), `Sccs::new_with_annotation`
  (ported). No other lane's stubs.
- opaque_types: `MirTypeckRegionConstraints::placeholder_region` (bck-tc-a), `UniversalRegionRelations::{equal,
  outlives}` (bck-tc-b), `RegionValues::{add_region, add_free_region, universal_regions_outlived_by}` (bck-regions-a),
  `fully_perform_op_raw` (bck-tc-b), `ToUniverseInfo_never` (bck-diag-f). All of these are filled at the base.
- dump_mir: `RegionInferenceContext::{regions, max_nameable_universe, region_value_str}`,
  `LivenessValues::pretty_print_live_points` (bck-regions-a, filled), `UniversalRegions::region_classification`
  (bck-nll, filled).

## `unported(...)` left
- `rustc_graphviz::Id::new` and `rustc_graphviz::render` (graphviz.ts, local `dot_Id_new` / `dot_render`). rustc_graphviz
  is not ported. I ported every graphviz.rs fn faithfully over minimal local declarations, following
  rustc_data_structures obligation_forest/mod.ts: `dot_Id = string`, `dot_LabelText = { $: "LabelStr", _0: string }`.
  Only `-Zdump-mir=nll` reaches them, through nll.rs `dump_nll_mir` → `dump_graphviz_{raw,scc}_constraints`.
  **phase-diff runs `-Zdump-mir=all`**, so once borrowck runs end to end, phase-diff's MIR stage will stop here on any
  body that borrowck reaches. Root: consider a small rustc_graphviz lane (about 700 lines upstream).

## `// PORT:` decisions
- constraints/mod.ts: `debug_OutlivesConstraint` formats its arguments with `PLAIN`, because `write!` uses fresh specs;
  `graph` / `reverse_graph` read graph.ts lazily (`require`, init-order header). `index` panics out of bounds like
  `IndexVec`.
- constraints/graph.ts: `D::..` goes through the stored `_direction` table via the local helper `direction_of(graph)`.
  `RegionGraph::successors` returns a JS iterable over `Iterator_Successors.next`.
- handle_placeholders.ts:
  - `update_scc` / `update_reachable` write a modified clone of the `Copy` annotation through the `MutRef`. They never
    mutate it in place, because the SCC walk copies annotations.
  - Tuple `Ord::max` / `min` (`tuple_max` / `tuple_min`) and the derived `Representative` `Ord::min`
    (`representative_min`: variant order, then rvid) are local helpers.
  - `annotate_scc` keeps `assert!(idx == scc)`.
- reverse_sccs.ts: `chunk_by` is walked by index; `upper_bounds` is a generator (lazy, like the iterator chain).
- dump_mir.ts: the `{:rw$?}` / `{:cw$?}` / `{:4?}` widths have no effect, because `RegionVid` / `UniverseIndex`
  (`write!`) and the derived `RegionClassification` (`write_str`) ignore the formatter width. Confirmed against the
  oracle's `-Zdump-mir=nll` output (`| '?0 | Global | ['?2, ...]`).
- member_constraints.ts: `CollectMemberConstraintsVisitor` gets `Result = VisitorResult.unit` and the provided
  `TypeVisitor` methods on its prototype.
- opaque_types/mod.ts:
  - `ToArgRegionsFolder` gets the provided `FallibleTypeFolder` methods on its prototype.
  - `mk_args_from_iter` over `Result`s collects until the first `Err`.
  - The `prev.span = ..` write into the map rebuilds the slot, because `DefinitionSiteHiddenType` fields are readonly
    (writeback.ts precedent).
  - `decls_modulo_regions` is a `KeyedMap` keyed by `intern_key`.
  - Local `fold_OpaqueTypeKey` / `fold_ProvisionalHiddenType` descriptors follow the rustc_hir_typeck opaque_types.ts
    precedent.
  - `?` on `ErrorGuaranteed` → `NonDefiningUseReason.from`.
- region_ctxt.ts: the `PlaceholderIndices::default()` is `default_PlaceholderIndices()`, and the outlives set is cloned
  with `clone_OutlivesConstraintSet`.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok.
- `bun test src/rustc_borrowck`: 17 pass, 1 fail. The failure is the known runtime-stop pin.
- Full unit suite: see "Unit suite" below.

## Samples (`RUST_TS_AGENT=root-f5de`, compared case by case with the given base runs)
| suite | lane run | M / D / U / C / T / UNSTABLE | vs base |
|---|---|---|---|
| tydump-minicore | `20261022-233728-root-f5de-nwnw` | 45 / 0 / 1 / 0 / 0 / 0 | identical |
| mirdump-minicore | `20261022-233814-root-f5de-oly0` | 45 / 0 / 1 / 0 / 0 / 0 | identical |
| tydump-ui `--sample 300` | `20261022-233909-root-f5de-nhdc` | 261 / 0 / 37 / 0 / 0 / 2 | no status change; 33 stop messages changed |
| mirdump-ui `--sample 300` | `20261022-234338-root-f5de-yi3c` | 271 / 0 / 29 / 0 / 0 / 0 | +2 UNPORTED→MATCH; 27 stop messages changed |
| borrowck-ui `--sample 300` | `20261022-234703-root-f5de-dkck` | 0 / 0 / 300 / 0 / 0 / 0 | no status change; all stop messages changed |

No MATCH lost, and no DIFF / CRASH / TIMEOUT. The stop changes come from the integ-w19 merges since the base runs, not
from my code:
- `replace_regions_in_mir` / `eval_in_interpreter` → `UniverseInfo::relate` (bck-diag-f): 287 in borrowck-ui.
- 12 borrowck-ui cases → `polonius_engine::AllFacts::default` (wave 26).
- 1 → `CanonicalTypeOpProvePredicateGoal::to_universe_info` (bck-diag-f).
- A few → `CleanupPostBorrowck (pass not ported)` and metadata `Decodable for mir::Body`.

## For root / other lanes
- bck-diag-f: `UniverseInfo::relate` is the first stop on every borrowck path. After it, `compute_regions` reaches this
  lane's handle_placeholders code.
- rustc_graphviz: see above (phase-diff `-Zdump-mir=all`).

## Full unit suite (root note)
The lane's final full-suite run was cut off by the API limit / machine reboot. Root ran the full suite at integration instead (merge into integ-w19).
