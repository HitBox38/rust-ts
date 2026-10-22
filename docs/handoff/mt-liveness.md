# Handoff: mt-liveness (M4 wave 22): rustc_mir_transform liveness.rs

Branch `lane/mt-liveness` (from `fe77b233`, no merges). Commits: the port (`ba015734`), the oracle test (`0be7fa7d`),
a test fix (`a51dffb2`), then this handoff.

## Result
- **`src/rustc_mir_transform/liveness.ts`**: compiler/rustc_mir_transform/src/liveness.rs ported whole, **37/37 fns**,
  upstream order, markers. It replaces mt-skeleton's stub module (same export `check_liveness(tcx, def_id):
  DenseBitSet<FieldIdx>`, which lib.ts's `provide` already wires as the `check_liveness` provider). It contains
  `check_liveness`, the `PlaceSet`, `AssignmentResult` (`find_dead_assignments`, `merge_guards`, `compute_dead_captures`,
  `report_fully_unused`, `report_unused_assignments`), the typo / drop-guard / `&mut`-suggestion helpers, and the
  file's own backward analysis `MaybeLivePlaces` + `TransferFunction` + `DefUse`.
- **No dependency on lane dataflow-impls.** liveness.rs does not use `MaybeLiveLocals`. It defines its own
  `MaybeLivePlaces` (domain `DenseBitSet<PlaceIndex>`, `Backward`, `NAME = "liveness-lint"`) on the dataflow framework
  (`AnalysisBase`, `iterate_to_fixpoint`, `ResultsCursor`), which is fully ported. Nothing is pending from that lane.
- Coverage: liveness.rs 37/37; rustc_mir_transform 150/1101; TOTAL 19201/25518. `bun scripts/coverage.ts --check`:
  markers ok.
- `pass_manager.test.ts` "module layout": the stub-module count goes 69 → 68 (mt-skeleton's contract: lower it when a
  stub is replaced; other wave-22 lanes lower it too, so expect a trivial merge conflict on that number).

## Pending: rustc_mir_transform diagnostics (lane mt-built-lints)
compiler/rustc_mir_transform/src/diagnostics.rs (generated derives plus the hand-written `impl Subdiagnostic` of
`UnusedAssignOverwrite` / `UnusedVariableStringInterp`) belongs to mt-built-lints and was not committed when this lane
ran. liveness.ts has a marked block `PORT(pending mt-built-lints): use crate::diagnostics;` with:
- the ten types liveness.rs builds (`PatternTypo`, `UnusedAssignOverwrite`, `UnusedAssignSuggestion`,
  `UnusedVariableStringInterp`, `UnusedVariableSugg`, `UnusedCaptureMaybeCaptureRef`, `UnusedVarAssignedOnly`,
  `UnusedAssign`, `UnusedAssignPassed`, `UnusedVariable`), with upstream field names and order;
- a local `diagnostics` object whose `<Type>_diagnostic(value)` stand-ins return a `Diagnostic` whose `into_diag` stops
  `unported("rustc_mir_transform::diagnostics::<Type> (generated; lane mt-built-lints)")`. Allowed lints are never
  decorated, so they run through. Each stand-in carries a `pending: { type, value }` marker (`PendingDiagnostic`,
  exported) that the oracle test reads.

**At merge** (when mt-built-lints' generated module lands):
1. Replace the whole block with `import * as diagnostics from "./diagnostics.ts";` and refer to the types as
   `diagnostics.<Type>` (or import them). The call sites already use the generated names
   (`diagnostics.UnusedVariable_diagnostic({..})` etc.).
2. Switch liveness.oracle.test.ts from the `pending` marker to the rendered stderr (see its "MERGE NOTE").
   Without the marker the test fails with `ERROR: decorator without pending`.

## Reachability
Not reachable in the suites yet. mirdump's driver calls `check_liveness` after `mir_built` / `mir_promoted`, which stop
first: `LintAndRemoveUninhabited` (mt-built-lints), `PromoteTemps` / `mir_const_qualif` (mt-promote / const-check),
`has_ffi_unwind_calls` (mt-built-lints). Once those land, the first liveness stop on a case that emits a liveness
warning is the pending diagnostics block above.

## Tests
- **`src/rustc_mir_transform/liveness.oracle.test.ts`** (oracle, skips without the pinned rustc, fails under
  `RUST_TS_REQUIRE_PROBES=1`): an in-process driver with tydump's analysis prefix, then `check_liveness` for every
  body owner. `mir_promoted` is overridden with a stand-in: the real `build_mir_inner_impl`, then `SimplifyCfg::Initial`
  and `SimplifyCfg::PromoteConsts` (the skipped passes change nothing in the fixtures). `emit_node_span_lint` is
  intercepted for the two lints; allowed / expected levels are dropped as rustc does. Each lint's pending struct is
  turned into what diagnostics.rs makes of it: level, message, primary spans, span labels, and the
  help/note/suggestion children with their suggestion parts. The oracle's `--error-format=json` diagnostics give the
  same shape, compared in order.
  - Fixture 1 (no_core, 16 fns): 15/15 lints match, including the overwrite labels, `TryIgnore` shorthand, the
    unit-variant typo suggestion, `+=` self-assignments, match guards, loops, and the `&mut` out-param suggestion.
  - Fixture 2 (closures): 10/10 match: by-value capture never read (`UnusedCaptureMaybeCaptureRef`), by-ref `FnMut`
    capture (the `goto bb0` rewrite), dead captures returned to the parent through the `check_liveness` query.
- **Scratch sweep** (not committed; `$RUST_TS_DATA/tmp/mt-liveness/{sweep.ts,port_one.ts,one.ts}`): the same
  structured comparison on every compiletest case of `tests/ui/liveness` and `tests/ui/lint/unused` (127 cases,
  compiletest argv from harness/compiletest.ts, std, `-A unused` default):
  - **49 MATCH, 0 DIFF**: 56 liveness lints in 11 cases, all equal, among them `liveness-unused.rs` (36 lints),
    `liveness-dead.rs`, `liveness-asm.rs`, issue-54180 / -81314 / -117284 (macro `NoSugg`), if-let guards, the raw
    identifier `r#move`; the other 38 MATCH cases have no liveness lint on either side.
  - The other 78 stop outside liveness. 51 are UNPORTED: 25 `mk_const_alloc`, 13 `mir_borrowck` provider, 6
    `DIAGNOSTICS long description`, 4 `LintAndRemoveUninhabited` (through a real `mir_built`), 3 const eval /
    binder. 27 exit with an error after early deny-level lints (`unused_parens`, `unused_imports`,
    `unused_macros`, ...); the oracle has no liveness lint in any of those 27.
  - The one DIFF of the first sweep was in the test's shape (`Symbol` args render through `to_ident_string`), fixed
    in `a51dffb2`.
- `bunx tsc --noEmit -p .`: clean.

## Samples (`RUST_TS_AGENT=root-fe77`, compared case by case with root's base runs at `fe77b233`)
| suite | lane run | M / D / U / C | base run | case-by-case |
|---|---|---|---|---|
| mirdump-minicore (46) | `20261022-153443-root-fe77-mvjk` | 16 / 0 / 30 / 0 | `20261022-144421-root-fe77-qdzc` | 46 same, 0 changed |
| tydump-minicore (46) | `20261022-153502-root-fe77-sub2` | 45 / 0 / 1 / 0 | `20261022-144407-root-fe77-zgkc` | 46 same, 0 changed |
| mirdump-ui `--sample 300` | `20261022-153518-root-fe77-gzn7` | 0 / 0 / 299 / 0 (+1 UNSTABLE) | `20261022-144709-root-fe77-3ska` | 300 same, 0 changed |

No new DIFF. Same status and same stop for every case (expected: `check_liveness` is not reached yet, see Reachability).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok.
- Full `RUST_TS_AGENT=mt-liveness RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (once, detached, at
  `a51dffb2`): **6007 pass, 1 skip, 0 fail** (6008 tests, 422 files, 2706 s).

## `unported(...)` left
- liveness.ts: only the pending diagnostics stand-ins (`rustc_mir_transform::diagnostics::<Type> (generated; lane
  mt-built-lints)`), reached only when a liveness lint is emitted at a non-allow level.

## PORT decisions (phrased for `bun scripts/state.ts record decision`)
1. (mt-liveness) liveness.rs's `MaybeLivePlaces` is its own analysis: it extends `AnalysisBase<DenseBitSet<PlaceIndex>>` with `Direction = Backward`; `TransferFunction` / `LocalVisitor` / `LiteralFinder` extend mir `Visitor`, `ExprFinder` / `LocalUseVisitor` extend hir intravisit `Visitor`. Structs and impls nested in fn bodies are module-level classes next to their parent (class declarations are not hoisted).
2. (mt-liveness) `FxHashSet<Location>` is a `KeyedSet` (`key_Location`), `FxIndexMap<SourceInfo, Access>` a `KeyedMap` (`key_SourceInfo`: span and scope handles). `IndexEntry` is a get/set; `Access` is a mutable object. `IndexMap::retain` is a local `retain`. `IndexVec<I, Option<T>>::insert` / `get_or_insert_with` grow the array.
3. (mt-liveness) `mir::Place ==` is a module-local `place_eq` (local, interned projection by identity), as decision 2026-10-22 #17. `ty::CAPTURE_STRUCT_LOCAL` is cast to the mir `Local` brand (#15). `PlaceIndex` is a `newtype_index` brand with `{}` Debug.
4. (mt-liveness) The rustc_mir_transform diagnostics liveness.rs uses are a marked pending block (types + stand-in `Diagnostic`s stopping UNPORTED in `into_diag`, carrying a `pending` marker for the oracle test) until mt-built-lints' generated module lands; the merge replaces the block by the import.
5. (mt-liveness) The `#[derive(Debug)]` of `Access`, `AccessKind`, `CaptureKind`, `PlaceSet`, `ExprFinder`, `DefUse` is not ported: only `tracing` would print them.
6. (mt-liveness) liveness.oracle.test.ts stands in `mir_promoted` (built MIR + `SimplifyCfg::Initial` + `SimplifyCfg::PromoteConsts`) and compares structured lints (level, message, spans, labels, children, suggestion parts) with the oracle's JSON until the diagnostics land.

## Files touched
- `src/rustc_mir_transform/liveness.ts` (stub → port), `src/rustc_mir_transform/liveness.oracle.test.ts` (new),
  `src/rustc_mir_transform/pass_manager.test.ts` (stub count 69 → 68), this handoff. No harness/ or scripts/ edits.
