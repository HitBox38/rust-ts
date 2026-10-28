# Handoff: mt-coverage (wave 27, the `InstrumentCoverage` pass and the coverage queries)

Branch `lane/mt-coverage` (base `fbb8fa9a` on integ-w25, no merges). Commits: `982b63db` the queries + counters + graph
(first, as asked), `708cb614` the pass itself and `coverage/tests.rs`, then this handoff.

## Files touched
All in `src/rustc_mir_transform/`.
- `coverage/query.ts` (was a stub): `provide` now installs `is_eligible_for_coverage`, `coverage_attr_on` and
  `coverage_codegen_info`; `all_coverage_in_mir_body`, `is_inlined`.
- `coverage/mod.ts` (was a stub): `InstrumentCoverage::run_pass` (the policy was already ported by merge-w22b),
  `instrument_function_for_coverage`, `inject_coverage_statements`, `inject_statement`.
- **new** `coverage/counters.ts`, `coverage/counters/balanced_flow.ts`, `coverage/counters/node_flow.ts`,
  `coverage/graph.ts`, `coverage/hir_info.ts`, `coverage/from_mir.ts`, `coverage/expansion.ts`, `coverage/mappings.ts`,
  `coverage/spans.ts`.
- **new** tests: `coverage/tests.test.ts` (tests.rs: the three covgraph tests on mock bodies),
  `coverage/counters/node_flow/tests.test.ts` (Knuth & Stevenson `example_driver`).
- `pass_manager.test.ts`: the stub-module count is now 14 (was 16; `coverage/mod.ts` and `coverage/query.ts`). Other
  lanes of this wave change the same number; root sums the deltas (-2 here).

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_mir_transform/src/coverage/<f>.rs`)
mod 5/5, query 6/6, counters 9/9, counters/balanced_flow 4/4, counters/node_flow 8/8, counters/node_flow/tests 4/4,
expansion 5/5, from_mir 2/2, graph 24/24, hir_info 10/10, mappings 3/3, spans 8/8, tests 22/22 (110 fns).
`bun scripts/coverage.ts --check`: markers ok (22457; vendor 4351). `bunx tsc --noEmit -p .`: clean.

## Tests
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_mir_transform`: 81 pass, 0 fail (4 of them new).
- `bun test src/rustc_mir_build`: 99 pass; `bun test src/rustc_lint/late_passes_e1.oracle.test.ts`: 27 pass.
- Full unit suite (`bun test src`, run once at the end): 6227 pass, 1 skip, 0 fail (466 files). No pinned stop moved:
  no test pinned a coverage provider stop or the async-closure `coverage_attr_on` stop.

## Oracle verification (`-Cinstrument-coverage`, `-Zdump-mir`, scratch, not committed)
Script: `$RUST_TS_DATA/scratch/mt-coverage/{cwrap.ts,cmp.sh,k1.rs,k2.rs,k2b.rs,k3.rs,k4.rs}`: mt-opt1's driver
repointed at this worktree, with:
- `CWRAP_NOOP_INLINE=0` (mt-inline has landed; the real ForceInline/Inline run). The mt-opt2 stand-ins are kept.
- **Stand-in for two unported session helpers** (scratch only, `CWRAP_COV!=0`): `Session::instrument_coverage_branch`
  and `instrument_coverage_condition` are not ported (rustc_session), and rustc_mir_build's `coverageinfo.ts` calls
  `unported(..)` in their place, so **every `-Cinstrument-coverage` compile of an eligible fn stops at
  `rustc_session::session::Session::instrument_coverage_branch`** in the real driver. The stand-in replaces
  `CoverageInfoBuilder::new_if_enabled` / `visit_coverage_standalone_condition` with upstream's logic for
  `-Zcoverage-options=block` (the default) and throws for branch/condition levels.
- `CWRAP_FAKE_BCK=0` keeps the real `mir_borrowck` (needed for opaque types: async fns / RPIT ICE in
  `find_opaque_ty_constraints_for_rpit` under the faked borrowck); then `-Zdump-mir=all` stops at
  `rustc_graphviz::render` (NLL dumps), so those runs use
  `-Zdump-mir=InstrumentCoverage|CleanupPostBorrowck|PreCodegen|built|promoted`.
- `CWRAP_COVINFO=1` calls `coverage_codegen_info(Item(def))` after `optimized_mir` and prints it.

All runs `--target x86_64-unknown-linux-gnu -Cinstrument-coverage`. "equal" = byte-identical dumps.

| input | flags | dumps compared | equal |
|---|---|---|---|
| k1.rs (18 fns: if/loops/match/guards/lazy bools/closure/assert!/nested fn/`#[coverage(off)]`/`?`/let-else/`!`/panic!/derives) | default, `-Zdump-mir=all` | 1729 | 1729 |
| k1.rs | `-Zmir-opt-level=0` | 1117 | 1117 |
| k4.rs (macro-generated fn, expr macros, `if let`, `const {}`, array-length anon const, macro in closure, break/continue, labeled loops, method) | default | 870 | 870 |
| k2b.rs (async fn, `.await`, RPIT closure, async block, iterator closures) | real borrowck, restricted dumps | 55 | 55 |
| tests/ui consts/precise-drop-with-coverage, consts/precise-drop-allow-const-fn-unstable (allow), instrument-coverage/coverage-options (block), instrument-coverage/on-values, coverage-attr/bad-attr-ice (feat; same E0539 error), instrument-coverage/msvc-link-dead-code-inline-always-85461 | real borrowck, restricted dumps, `-Zno-profiler-runtime` | 5/5/5/5/5/20 | all |

Every `InstrumentCoverage.after` dump with mappings was among them (k1: 14 bodies with `coverage Code` lines; async fn
bodies take the `is_async_fn` signature-only path; derives are `#[coverage(off)]` via `automatically_derived`).
`coverage_codegen_info` has no MIR dump; as a cross-check, its `num_counters` for every k1 fn equals the size of the
oracle's `@__profc_*` counter array in `--emit=llvm-ir` (14/14; `None` for `off` and the three derives, which have no
counters in the oracle either).

No harness suite runs `-Cinstrument-coverage` MIR dumps (the six tests/ui cases above are in the token/parse/hir
suites only; tests/coverage and tests/mir-opt are not in the sparse checkout).

## Async closures: where they stop now
Async closures used to stop at `coverage_attr_on provider (not ported)` (by_move_body.rs feeds
`coverage_attr_on(tcx.coverage_attr_on(coroutine_def_id))` for the synthetic by-move body). That query is ported, so
they now stop four feeds later, at the **second** `body_def.explicit_clauses_of(..)` feed (by_move_body.rs:247, upstream
feeds it twice): feeding an already-fed query compares stable hashes, and
`rustc_middle::dep_graph::hash_result (StableHash of the values of query \`explicit_clauses_of\`)` is unported
(rustc_query_impl/query_vtables.ts). Same stop with and without `-Cinstrument-coverage` (k3.rs).

## Runtime stops this lane leaves / meets
- None left in the coverage files: no `unported(..)` in `src/rustc_mir_transform/coverage/`.
- Met outside the lane: `rustc_session::session::Session::instrument_coverage_branch` /
  `instrument_coverage_condition` (rustc_session + rustc_mir_build coverageinfo.ts), see above. This is the first
  stop of every instrumented compile; `-Zcoverage-options=branch|condition` additionally need `BranchInfo` paths in
  coverageinfo.ts.

## `// PORT:` decisions
- graph.ts: `CoverageGraph` implements the graph traits as methods, so its `successors` / `predecessors` fields are
  `successors_` / `predecessors_` (and `dominators` field `dominators_`); `Index`/`IndexMut` are `index`/`index_mut`.
- counters.ts: `expressions_memo` is a `KeyedMap` keyed by `intern_key(Expression)`; `FxIndexMap` is an ordered `Map`.
- `CoverageMirInfo::function_source_hash` is a `u64`, but the generated type (rustc_middle/mir/coverage.gen.ts) declares
  it `number`; mod.ts stores hir_info's `bigint` through a cast. **Root/tools: map that field to `bigint` in
  tools/codegen** (no MIR dump prints it, so nothing observable today).
- expansion.ts: itertools' `minmax_by` (first min, last max) is a fold; `IndexMap::sort_by_key` rebuilds the `Map`
  (stable); `usize::MAX` dfs-rank sentinel is `Number.MAX_SAFE_INTEGER`.
- spans.ts: `Vec::dedup_by` / `dedup_by_key` / `retain(_mut)` via a local `dedup_by` helper and `filter`;
  `discard_spans_overlapping_holes` returns the filtered vector.
- hir_info.ts: the fn-local visitors are module classes placed after their declaring fn (marker order).
- query.ts: the `priority_list[1..].sort_by_key` partition sorts a copy of the tail (stable) and writes it back.
- `#[derive(Debug)]` on lane-local structs only used by tracing (`NodeCounters`, `SpantreeEdge`, `CounterTerm`,
  `RawSpanFromMir`, `ExpnTree`, `ExpnNode`, `MinMaxBcbs`, `Covspan`, `Hole`) is not ported;
  `BasicCoverageBlockData`'s is (used by tests.rs's failure message). `tracing` calls are comments.

## Sample difftests (`RUST_TS_AGENT=root-f5de`)
Run after root's gate finished. Compared case by case with the base runs named in w27-common.txt.

| suite | run | result | base run | MATCH -> other |
|---|---|---|---|---|
| tydump-minicore | 20261028-131757-root-f5de-t8vo | 46/46 MATCH | wos5 | none |
| mirdump-minicore | 20261028-131808-root-f5de-qg8j | 46/46 MATCH | p8q4 | none |
| tydump-ui `--sample 300` | 20261028-131839-root-f5de-joe2 | 295 MATCH, 3 UNPORTED, 2 UNSTABLE | zjq3 (261) | none |
| mirdump-ui `--sample 300` | 20261028-132134-root-f5de-kz7t | 300/300 MATCH | mzgb (269) | none |
| borrowck-ui `--sample 300` | 20261028-132455-root-f5de-3y1a | 286 MATCH, 14 UNPORTED | 86qn (0) | none |

No new DIFF / CRASH / TIMEOUT. Each remaining non-MATCH was already non-MATCH in the base run. The gains come
from the waves since those base runs; none of these suites passes `-Cinstrument-coverage`.

## For root / other lanes
- rustc_session: port `Session::instrument_coverage_branch` / `instrument_coverage_condition` (session.rs:711/716;
  three lines each), then repoint rustc_mir_build/builder/coverageinfo.ts:76/242 and re-pin `mb_mod.test.ts:295`.
- rustc_query_impl: stable hashing of `explicit_clauses_of` values (the async-closure stop).
- tools/codegen: `function_source_hash: u64` -> `bigint`.
- Merge note: `pass_manager.test.ts`'s stub count is touched by several lanes this wave (this lane: -2).
