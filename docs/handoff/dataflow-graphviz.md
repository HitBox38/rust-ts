# Handoff: dataflow-graphviz (wave 40i): the dataflow and MIR graphviz writers, rustc_graphviz wired in

Branch `t3/port-dataflow-graphviz` (from `1b4bf086`). Commits: `38b91011` (the port), then this handoff.

## Result
- **mir-opt-o4 `tests/mir-opt/dump_dataflow.rs`: UNPORTED → MATCH** (it was UNPORTED at
  `rustc_mir_dataflow::framework::graphviz::write_graphviz_results` in gate-20261110-113508-root-m7vn).
- The case's `-Zdump-mir-dir` (`$RUST_TS_DATA/tmp/mir-opt-o4/{oracle,subject}/abaa683b58eea24c`) is **byte-identical
  on all 138 files**: the 12 dataflow/borrowck `.dot`s, `nll.0.regioncx.{all,scc}.dot`, `transitive liveness.-----.dot`,
  `polonius.0.html` and every `.mir`. The oracle directory there dated from Nov 5, so I re-ran the oracle by hand with
  the suite's exact argv into a scratch dir: 138/138 identical to the port's.

## Files touched
- `src/rustc_mir_dataflow/framework/graphviz.ts`: the stubs replaced by the port of all of
  `framework/graphviz.rs` (30 fns).
- `src/rustc_middle/mir/generic_graphviz.ts` (new): `GraphvizWriter`, all of `mir/generic_graphviz.rs` (7 fns). Nothing
  calls it upstream or here.
- `src/rustc_middle/mir/pretty.ts`: `MirDumper::dump_mir` now calls `write_mir_fn_graphviz` (graphviz.ts was already
  ported) in place of its `unported(..)` (`-Zdump-mir-graphviz`). It imports `./graphviz.ts` and no longer imports
  `unported`. This is the only change to the file.
- `src/rustc_borrowck/region_infer/graphviz.ts`: `dot_Id_new` / `dot_render` were UNPORTED stand-ins. They are now
  rustc_graphviz's `Id::new(..).unwrap()` and `render`. The impl tables are bound to the value by `as_dot_graph`;
  `dot_Id` / `dot_LabelText` are now aliases of `dot.Id` / `dot.LabelText`.
- `src/rustc_data_structures/obligation_forest/mod.ts` (graphviz.rs part):
  - `dump_graphviz` renders through rustc_graphviz into the `.gv` file.
  - `Id::new` is real.
  - **Fixed a port bug:** `edges` pushed `(index, dependent)`, but upstream's is `(d, i)`.
  - `node_label` lost the non-upstream `f: Fmt` parameter. It now stops (see the unported list).
  - The exported placeholder `LabelStr` interface is gone; nothing used it.
- Tests:
  - `src/rustc_mir_dataflow/framework/graphviz.test.ts` (new);
  - `src/rustc_mir_dataflow/framework/graphviz_oracle/` (new): `dataflow.rs` plus 6 oracle `.dot` files, 80 KB;
  - `src/rustc_mir_dataflow/dataflow_contract.test.ts`: the counts are now 378 markers and 0 stubs. The two checks that
    expected the graphviz stub to stop were dropped or renamed; the `-Zdump-mir-dataflow` branch is covered by
    graphviz.test.ts;
  - `src/rustc_middle/mir/contract.test.ts`: `generic_graphviz.rs` added to the scope files, total 723 → 730.

`direct callers`: `rustc_borrowck/nll.ts` and `rustc_mir_dataflow/framework/mod.ts` needed no change.

## Coverage (`bun scripts/coverage.ts --missing <file>`)
| upstream file | ported |
|---|---|
| `compiler/rustc_mir_dataflow/src/framework/graphviz.rs` | 30/30 |
| `compiler/rustc_middle/src/mir/generic_graphviz.rs` | 7/7 |
| `compiler/rustc_middle/src/mir/graphviz.rs` | 4/4 (already ported; now reached) |
| `compiler/rustc_middle/src/mir/pretty.rs` | 59/59 |
| `compiler/rustc_borrowck/src/region_infer/graphviz.rs` | 22/22 |
| `compiler/rustc_data_structures/src/obligation_forest/graphviz.rs` | 9/9 |

`bun scripts/coverage.ts --check`: `markers ok (24933; vendor 5311; library 610)`. `bunx tsc --noEmit -p .`: clean.

## Evidence
- `bun scripts/difftest.ts --suite mir-opt-o4 --filter tests/mir-opt/dump_dataflow.rs`: MATCH 1/1
  (run 20261110-182057-root-nnsf).
- `--sample 200 --jobs 6`:
  - mir-opt-o4 **200/200 MATCH** (20261110-182709-root-bxlg);
  - mir **200/200** (20261110-182757-root-n7nb);
  - borrowck-ui **200/200** (20261110-182845-root-lpck).
  - No protected case turned non-MATCH in any sample.
- No other harness case writes `.dot` files:
  - mir-opt `graphviz.rs` passes `-Zdump-mir-graphviz` without `-Zdump-mir`, so neither side dumps;
  - no tests/ui case passes `-Zdump-mir`;
  - so the borrowck `.dot`s the port now writes appear only in dump_dataflow.rs (identical, above).
- Ad hoc oracle-vs-port runs, not harness suites. Flags: `-Zdump-mir=all -Zdump-mir-dataflow -Zdump-mir-graphviz` with
  mir-opt-o4's other flags. Every file of the dump dirs was compared (`diff -rq`), along with stdout and exit:

  | input | files | `.dot` | differing files |
  |---|---:|---:|---:|
  | a custom file (loops, calls, borrows, match guards, HTML-escaped strings) | 762 | 398 | 0 |
  | mir-opt `box_partial_move.rs` | 506 | 264 | 0 |
  | mir-opt `dataflow-const-prop/checked.rs` (ConstAnalysis) | 253 | 132 | 0 |
  | mir-opt `nll/named_lifetimes_basic.rs` | 506 | 264 | 0 |
  | mir-opt `nll/region_subtyping_basic.rs` | 506 | 264 | 0 |
  | mir-opt `coroutine/coroutine_storage_dead_unwind.rs` | 1035 | 541 | 0 |
  | mir-opt `coroutine/async_await.rs` | 1053 | 552 | 0 |

  - The rows these runs exercise: "(on yield resume)", "(on successful return)", "(on unwind)", and backward
    analyses (liveness), all written as the oracle writes them.
  - `#[rustc_mir(borrowck_graphviz_postflow = "<abs>/sub/x.dot", borrowck_graphviz_format = "two_phase")]` was tested
    too (the BeforeAndAfter style, `output_path`, `create_dir_all`): the 5 files were identical.
- Unit tests: `bun test src/rustc_mir_dataflow src/rustc_graphviz src/rustc_data_structures/obligation_forest
  src/rustc_middle/mir src/rustc_borrowck` passes **208/208**. graphviz.test.ts has:
  - `diff_pretty` on DenseBitSet<Local> diffs, with cells copied from the oracle's `.dot`s;
  - the port run on `graphviz_oracle/dataflow.rs` (a `#![no_core]` crate, so no sysroot) with
    `-Zdump-mir=f -Zdump-mir-dataflow -Zdump-mir-graphviz`. Its six `.dot` files are compared with the fixture:
    maybe_uninit, borrows, liveness-lint, regioncx.all, regioncx.scc, and the MIR graph `1-1-000.built.after.dot`;
  - the fixture check against the pinned rustc. It throws under `RUST_TS_REQUIRE_PROBES=1` when the toolchain is
    missing, and `REGEN=1` rewrites the fixture.

## `unported(...)` left
- `rustc_data_structures::obligation_forest::graphviz: Debug of ForestObligation::CacheKey`
  (`Labeller_ObligationForest.node_label`). Upstream prints `{:?}` of `node.obligation.as_cache_key()`. The port's
  `as_cache_key` returns a canonical key string, not the `CacheKey` value (obligation_forest/mod.ts header, D4), so
  that Debug cannot be written. It is reachable only through `dump_graphviz`, which nothing calls (upstream:
  `#[allow(dead_code)]`), and only with `DUMP_OBLIGATION_FOREST_GRAPHVIZ` set.
- `dataflow_const_prop.ts`'s `DebugWithContext_State` `fmt` (the derived `Debug` of `State`) still stops. This lane did
  not add or reach it: graphviz goes through `fmt_with` / `fmt_diff_with`, which are ported.

## `// PORT:` decisions
- framework/graphviz.ts:
  - The `dot::Labeller` / `dot::GraphWalk` impls are methods of `Formatter`.
  - `ResultsVisitor for StateDiffCollector` is `implements ResultsVisitor` with the provided `visit_block_exit`
    forwarding.
  - `A::Domain: DebugWithContext<A>` is the analysis's `Domain` table.
  - The `Vec<u8>` label buffers are `string[]`: the `?` after an infallible `write!` into them is dropped, and the `?`
    on `io::Result` calls is kept.
  - `diff_pretty` takes the `DebugWithContext` table as an extra last argument. `Regex::replace_all`'s
    Borrowed/Owned distinction is a `matched` flag.
  - `fs::create_dir_all` and `File::create_buffered` (the attribute path only) use Node fs, with the buffer written at
    `drop`, following the precedent of mir/pretty.ts's `create_dump_file`.
  - `debug!` is a comment (STATIC_MAX_LEVEL is INFO).
- generic_graphviz.ts: `G::Node: Debug` is an extra `debug_node` argument of `new` and a field. The file has no caller.
- region_infer/graphviz.ts: `as_dot_graph` binds the impl tables to the value. A table that leaves out a provided
  method (SccConstraints' `edge_label`) gets rustc_graphviz's default.
- obligation_forest: `File::create_buffered(..).unwrap()` and `dot::render(..).unwrap()` panic as upstream, and the
  buffer is written to the file at the end of scope.

## Notes for root
- The harness still does not compare `-Zdump-mir-dir`. With this lane, dump_dataflow.rs's 138 files match. A harness
  batch that compares the dump dirs for mir-opt-o4 (the scout's lane 3 note) would protect them.
- No harness, scripts, baseline or suite file was touched.
