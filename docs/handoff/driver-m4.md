# Handoff: driver-m4 (wave 25): the real `-Zunpretty=mir` driver path

Base `7f2d6592`, branch `lane/driver-m4`.

## Summary
- `rust-ts -Zunpretty=mir|mir-cfg|thir-tree|thir-flat|hir,identified|hir,typed` and `--emit=mir` now run the
  upstream code path (`pretty::print` / `pretty::emit_mir`). The printing itself is byte-identical to the pinned rustc
  wherever the pipeline before it runs through (verified with a scratch build, see "Verification").
- **No MIR-printing case is reachable on the real tree yet.** Every body that reaches `optimized_mir` stops at the
  mt-opt1 pass stubs (`LowerSliceLenCalls (pass not ported)` first; at `-Zmir-opt-level=0` too, because the stub's
  `policy` itself is unported, and `RemoveUnneededDrops` / `SimplifyConstCondition` / `ForceInline` run at every
  level). Both cg_clif files (mini_core.rs, mini_core_hello_world.rs) stop even earlier, in `analysis`, at the
  `ty::Value` query key (see "Blockers").
- `passes.rs` `analysis` / `run_required_analyses` were already ported for real by lane passes-analysis (wave 23);
  re-checked line by line against the pin, nothing to change.

## Files
New:
- `src/rustc_graphviz/lib.ts`: port of `compiler/rustc_graphviz/src/lib.rs` (crate docs kept). `LabelText`, `Style`,
  `Id`, `Labeller` (+ `Labeller_provided`), `escape_html`, `GraphWalk`, `RenderOption`, `render`, `render_opts`.
- `src/rustc_graphviz/tests.test.ts`: port of `tests.rs` (11 tests).
- `src/rustc_middle/mir/generic_graph.ts`: port of `mir/generic_graph.rs`.
- `src/rustc_middle/mir/graphviz.ts`: port of `mir/graphviz.rs` (`write_mir_graphviz`, `write_mir_fn_graphviz`,
  `write_graph_label`, `escape`).
- `src/vendor/gsgdt/{lib,graph,node,multi_graph,util}.ts`: vendored gsgdt 0.1.2 (the `-Zunpretty=mir-cfg` DOT
  writer; rustc_graphviz only supplies `escape_html` to it). Tests: `graph.test.ts` (in-file `mod tests`),
  `tests/{helpers.ts,test_graph.test.ts,test_multigraph.test.ts}` + the crate's `tests/small_graph.json` fixture.

Edited:
- `src/rustc_driver_impl/pretty.ts`: `print`'s `Mir`, `MirCFG`, `ThirTree`, `ThirFlat` arms; `HirIdentifiedAnn`
  and `HirTypedAnn` (`hir,identified` / `hir,typed`); `emit_mir`. `StableMir` stays `unported` (rustc_public is
  excluded in harness/scope.json).
- `src/rustc_driver_impl/lib.ts` (driver, call site of my `emit_mir`): `run_compiler` calls `pretty::emit_mir` when
  `--emit` contains `mir`, before the (still unported) `Linker::codegen_and_build_linker`. The unported message of
  the latter is unchanged, so the `refine_rpitit` pin in `compare_impl_item.oracle.test.ts` still holds.
- `src/rustc_middle/mir/contract.test.ts`: the MIR contract's scope list gains `graphviz.rs` and `generic_graph.rs`
  (fn total 715 → 723) and `mir/graphviz.ts` joins the fresh-entry-point list (it is imported from outside mir/).
  Without this the contract test fails on the new markers ("every declaration names a scope file").

## Coverage (`bun scripts/coverage.ts --missing <file>`)
- `compiler/rustc_driver_impl/src/pretty.rs`: 15/15 (was 8/15)
- `compiler/rustc_interface/src/passes.rs`: 27/29 (unchanged: `print_macro_stats` :321, `start_codegen` :1295)
- `compiler/rustc_graphviz/src/lib.rs`: 22/22; `tests.rs`: 36/36
- `compiler/rustc_middle/src/mir/graphviz.rs`: 4/4; `mir/generic_graph.rs`: 4/4
- vendor `gsgdt-0.1.2` (only countable once scope.json lists it): 18/38. Not ported: `src/diff/*` and
  `src/levenshtein.rs` (rustc never calls them; `match_graph` iterates std `HashMap`s with a random hasher) and
  `tests/test_diff.rs`; `graph.rs`'s `test_json_ser` / `test_json_deser` are `crate-skip` (serde).

`coverage.ts --check`: the only errors are **18** "names no harness/scope.json vendor crate at that version" errors for
gsgdt. With `"gsgdt": "=0.1.2"` added to scope.json `vendor` (tested on a temporary copy, not committed):
`markers ok (22166; vendor 4348)`.

## Verification (CLI vs `rustc +nightly`, same argv + `-Zunpretty=<mode>`)
Scratch tools (not committed): `$RUST_TS_DATA/tmp/driver-m4/{cases.ts,cmp.ts,t/run.sh}`.

1. **tydump-minicore corpus, `-Zunpretty=mir`, real tree**: 44/46 MATCH, 2 UNPORTED. The 44 are the
   diagnostics-only cases (the oracle prints no MIR: the analysis aborts with errors; stdout empty, stderr equal). The
   2 that print MIR (mini_core.rs: 1441 lines; mini_core_hello_world.rs: 6872 lines) stop in `analysis` at
   `rustc_middle::query::keys: QueryKey for \`ty::Value<'tcx>\` (cache)` (KnownPanicsLint → `eval_mir_constant` →
   `valtree_to_const_val`).
2. **Scratch build** (the 26 mt-opt1 / mt-inline pass stubs' `policy` patched to `optional(false)` and
   `ForceInline::run_pass` to a no-op, run with `-Zmir-opt-level=0` on bodies those passes leave alone; reverted, never
   committed). This exercises `optimized_mir` → `write_mir_pretty` / `write_mir_graphviz` on real bodies:
   - own test files (fns, `const fn` + `// MIR FOR CTFE`, statics + allocations, ctors, closures, loops, matches,
     slice bounds checks, string literals): `mir` 3/3, `mir-cfg` 5/5 (incl. a single-body graph without subgraphs,
     `-Zgraphviz-dark-mode`, `-Zgraphviz-font=Arial`), `--emit=mir` to a file and to stdout (`--emit=mir=-`) equal to
     the oracle's `.mir`;
   - every 3rd file of tests/ui/mir (45 files, std): `mir` 31 MATCH / 0 DIFF / 14 UNPORTED, `mir-cfg` 32 / 0 / 13.
     UNPORTED: `Decodable for mir::Body<'static>` (cross-crate MIR, 7), the `ty::Value` key (4),
     `rustc_target::callconv::aarch64` (host target; the harness uses x86_64), `short_string_namespace` long-type file.
3. **Real tree, no scratch**: `thir-tree` / `thir-flat` / `hir,identified` / `hir,typed` on own files: 12/12 MATCH.
   tests/ui files whose `compile-flags` use these modes (19): 12 MATCH (8 of them print output: unpretty-expr-fn-arg,
   issue-82392 (`hir,typed`), thir-flat-const-variant, thir-tree-loop-match, thir-tree-match, thir-tree-field-expr-index,
   thir-flat, thir-tree), 7 UNPORTED: `ty::Value` key (3), `cross_crate_inlinable provider`, `Ty: StableHash ...
   while_hashing_spans`, aarch64 callconv (host target), `LowerSliceLenCalls` (mir-cfg-unpretty-no-panic-81918).

## Sample difftests (as `root-f5de`; vs root's base runs, case by case)
| suite | base run | this lane |
|---|---|---|
| tydump-minicore | 45 M / 1 U | 46 M / 0 D / 0 U |
| mirdump-minicore | 45 M / 1 U | 45 M / 0 D / 1 U |
| tydump-ui --sample 300 | 261 M / 37 U / 2 UNSTABLE (~294 at this base per root) | 294 M / 0 D / 4 U / 2 UNSTABLE |
| mirdump-ui --sample 300 | 269 M / 31 U (~296 at this base) | 296 M / 0 D / 4 U |
| borrowck-ui --sample 300 | 0 M / 300 U (~259 at this base) | 261 M / 0 D / 39 U |
No base MATCH is lost, no DIFF/CRASH/TIMEOUT. Runs: `$RUST_TS_DATA/runs/dm4-<suite>`.

Unit tests: `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` at 75f99221: 6213 pass / 1 fail; the failure
(`std/result.test.ts`: one-argument `unwrap_result` in pretty.ts) is fixed in 488564ae (that test now passes, as
does `rustc_driver_impl/print.oracle.test.ts`). `bunx tsc --noEmit -p .` clean.

## Blockers for M4c (not this lane's files)
1. **`QueryKey` for `ty::Value<'tcx>`** (`valtree_to_const_val`): `src/rustc_middle/queries.gen.ts` uses
   `key_unported("ty::Value<'tcx>")` (generated by tools/codegen/queries.ts; keys.ts has no `ty::Value` key). Hit by
   KnownPanicsLint on every array-length / type-level const, so by both cg_clif files. Needs a `KEY_Value` in
   `rustc_middle/query/keys.ts` and the generator mapping (tools/ is root's). Pinned today by
   `known_panics_lint.oracle.test.ts` (`STOP_VALTREE_KEY`).
2. **mt-opt1 / mt-inline pass stubs** (parallel lanes): every `optimized_mir` stops at `LowerSliceLenCalls` first.
   Note for mt-opt1: `RemoveUnneededDrops` and `SimplifyConstCondition` (`optional(true)`) and `ForceInline`
   (`Required`) run at every opt level, so `-Zmir-opt-level=0` (the planned `mir-o0` suite) needs them too.
3. Cross-crate MIR (`Decodable for mir::Body`, rustc_metadata; meta-mir lane?) for std callers that inline / const-eval.

## unported(...) left by this lane
- `rustc_public::rustc_internal::pretty::write_smir_pretty (-Zunpretty=stable-mir)` (pretty.ts; rustc_public is
  excluded).
- `rustc_driver_impl::diagnostics::CantEmitMIR (--emit=mir write error)` (lib.ts; a `#[derive(Diagnostic)]`, generated).

## PORT decisions (please record)
1. `rustc_graphviz` is an in-tree crate: `src/rustc_graphviz/` with `// rustc:` markers. gsgdt (an external crate,
   rustc_middle's dependency for `mir-cfg`) is vendored at the Cargo.lock version 0.1.2 under `src/vendor/gsgdt/`.
2. `mir/graphviz.ts` and `mir/generic_graph.ts` are not re-exported by `mir/mod.ts` (mod.rs's
   `pub use self::graphviz::write_mir_graphviz`): like pretty.ts they import pretty.ts (init order), so callers import
   `rustc_middle/mir/graphviz.ts` directly.
3. `emit_mir`'s `io::stdout()` is anstream's unbuffered `Stdout`; the driver's `print!` text (`std_print`) is buffered
   until exit, so text printed with `print!` before `emit_mir` would come out after it (no such case known).
   `File::create_buffered` collects the text and writes it once, as `BufWriter`'s drop.
4. gsgdt's serde derives are not ported; its test helper `read_graph_from_file` builds the classes from `JSON.parse`.
5. `HirTypedAnn`: `typeck_body` takes `ty::decls`'s `Pending` `BodyId`, so `hir::BodyId` is cast as in rustc_privacy /
   rustc_lint.

## For root
- Add `"gsgdt": "=0.1.2"` to `harness/scope.json` `vendor` (clears the 18 `--check` errors).
- harness-w25's `mir-minicore` / `mir` / `thir-tree` suites can call `src/rust_ts/main.ts` with `-Zunpretty=...`
  directly; nothing else is needed from the driver.
