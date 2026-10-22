# Handoff: dataflow-impls (wave 22, rustc_mir_dataflow fill lane)

Branch `lane/dataflow-impls` (from `fe77b233`). Commits: liveness (early, for mt-liveness) → the other impls + pretty →
codegen set → rustc_peek → **merge of `lane/dataflow-move-paths` (`fe2b6b91`)** → rustc_peek oracle test → built-MIR test →
this handoff.

## Result
All 116 stubs of the lane are ported (`bun scripts/coverage.ts --missing <file>`):

| upstream | ported |
|---|---|
| impls/borrowed_locals.rs | 7/7 |
| impls/initialized.rs | 36/36 |
| impls/liveness.rs | 18/18 |
| impls/precise_liveness.rs | 22/22 |
| impls/storage_liveness.rs | 19/19 |
| rustc_peek.rs | 8/8 (7 stubs + the trait decl marker) |
| pretty.rs | 7/7 |
| diagnostics.rs | no fns: `#[derive(Diagnostic)]` generated into `src/rustc_mir_dataflow/diagnostics.gen.ts` |

rustc_mir_dataflow **288/378** (with dataflow-move-paths' 63); left: framework/graphviz.rs (30, wave 26) and
value_analysis.rs (60, mt-opt2-a). TOTAL 19343/25518. `dataflow_contract.test.ts`: 288 markers + 90 stubs; its
`stops(..)` lines for `sanity_check` / `mir_pretty_extra_data` / `MaybeLiveLocals::bottom_value` are gone (ported).

## Files touched
- Mine: `src/rustc_mir_dataflow/impls/{borrowed_locals,initialized,liveness,precise_liveness,storage_liveness}.ts`,
  `rustc_peek.ts`, `pretty.ts`, `dataflow_contract.test.ts` (counts), new `diagnostics.gen.ts` (GENERATED),
  new tests `impls/impls.test.ts`, `rustc_peek.oracle.test.ts`, `rustc_peek_oracle/{run.ts, *.rs}`.
- **Outside the lane (please review): `tools/codegen/types.sets.json`** gains the set `rustc_mir_dataflow`
  (`files: [compiler/rustc_mir_dataflow/src/diagnostics.rs]`, nothing else), so `bun tools/codegen/types.ts
  rustc_mir_dataflow` generates the six rustc_peek diagnostics (the contract assigned diagnostics.rs "codegen" to this
  lane; PORTING §5 forbids hand-writing the derive). Own commit `4896d2f3`; report: 0 unknown types / 0 missing.
- `docs/state/{current.json,history.jsonl}`: one `record decision` (the merge, below).

## For root (merge)
1. **This branch contains `lane/dataflow-move-paths` (`fe2b6b91`, merged in `0eb26194`)** so the init analyses,
   rustc_peek and the pretty hook could be tested end to end (they need `MoveData`, `drop_flag_effects`, `points`,
   `debuginfo`). If you merge dataflow-move-paths first, this merges cleanly on top; the only conflict I resolved was
   `dataflow_contract.test.ts` (counts 288 / 90, imports). Decision recorded.
2. `MaybeLiveLocals` / `MaybeTransitiveLiveLocals` / `DefUse` were committed first (`1d3e13cf`) for mt-liveness.
3. The analyses' visitor helpers now `extend Visitor` (rustc_middle mir/visit.ts): `LivenessTransferFunction`,
   `YieldResumeEffect`, `VisitAllocatedLocalsWith`, `VisitDeallocatedLocalsWith`, `KillableLocalsVisitor` (moved inside
   `MaybeRequiresStorage::new` as upstream). The `_xxx_decls` keep-alive exports of the stub files are gone.

## Tests
- `src/rustc_mir_dataflow/rustc_peek.oracle.test.ts` (**oracle**): the 6 `tests/ui/mir-dataflow/*.rs` UI tests and 3
  own cases (rustc_peek_oracle/*.rs: maybe-init across a loop with moves/re-inits, tuple-field moves, an untracked
  place; maybe-uninit + maybe-init over an enum match with Drop types (precise enum drop elaboration, SwitchInt edge
  effects); liveness across a loop and call returns). Driver `rustc_peek_oracle/run.ts` = analysis prefix +
  `check_unsafety` loop with `mir_built` = MIR building + `SimplifyCfg::Initial` + `Lint(SanityCheck)` (the real
  provider still stops at `LintAndRemoveUninhabited`, mt-built-lints; the skipped passes are lints / no-ops on these
  inputs). **Complete stderr + exit code equal to the pinned rustc for 7/9** (inits-1, liveness-ptr, uninits-1,
  uninits-2, init_loop, live_loop, uninit_enum: 3..7 peek errors each, incl. "argument untracked"); liveness-enum and
  liveness-projection are pinned UNPORTED at `rustc_middle::ty::context::TyCtxt::mk_const_alloc (ConstAllocation, M4)`
  (MIR building of a const allocation, before the dataflow).
- `src/rustc_mir_dataflow/impls/impls.test.ts`: real built MIR (no_core crate through the driver; builder-contract
  checks that MIR against `-Zdump-mir=built`): MaybeLiveLocals, MaybeTransitiveLiveLocals (with/without debuginfo
  locals: dead stores), MaybeBorrowedLocals / borrowed_locals, always_storage_live_locals, MaybeStorageLive/Dead,
  MaybeRequiresStorage, EverInitializedPlaces + init_reaches_location, the precise liveness matrix, and the
  `mir_pretty_extra_data` hook (`#[rustc_mir(rustc_pretty_live_locals, rustc_pretty_transitive_live_locals)]`,
  `rustc_pretty_precise_liveness`, none). Expected values derived by hand from the upstream transfer functions on the
  dumped MIR (each checked). The hook's line format (`        // live: [..]`, `early:` / `late:`) matches the oracle's
  `-Zunpretty=mir` output; an end-to-end `-Zunpretty=mir` comparison needs optimized MIR (not reachable yet).
- `bunx tsc --noEmit -p .` clean; `bun scripts/coverage.ts --check` markers ok; `bun test src/rustc_mir_dataflow`
  all pass.
- Samples (`RUST_TS_AGENT=root-fe77`, compared case by case, status + stop, with root's base runs):

| suite | lane run | M / D / U | base run | M / D / U | changed |
|---|---|---|---|---|---|
| mirdump-minicore (46) | `20261022-153933-root-fe77-vhgs` | 16 / 0 / 30 | `20261022-144421-root-fe77-qdzc` | 16 / 0 / 30 | 0 |
| tydump-minicore (46) | `20261022-153955-root-fe77-ovpj` | 45 / 0 / 1 | `20261022-144407-root-fe77-zgkc` | 45 / 0 / 1 | 0 |

- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: 6023 pass / 1 skip / 0 fail (last section).

## `unported(...)` left
None in this lane's files.

## `// PORT:` decisions (also in the file headers)
- liveness.ts: `MaybeLiveLocals` (unit struct) is `new MaybeLiveLocals()`; `LivenessTransferFunction<I>` takes the
  `GenKill<I, Local>` table as a second ctor arg; `DefUse::for_place`'s exhaustive match ends in `unreachable()`.
- borrowed_locals.ts: `body.local_decls().len()` is `body.local_decls.length`.
- storage_liveness.ts: `Cow<DenseBitSet>` is the set; `KillableLocals` a `KeyedMap<Location, Local[]>`
  (`KillableLocals_key`); `KillableLocalsVisitor` local to `new`.
- initialized.ts: fields colliding with methods get `_` (`move_data_`, `exclude_inactive_in_otherwise_`,
  `mark_inactive_variants_as_uninit_`); builder methods mutate `this`; `MaybeReachable` domain through
  `GenKill_MaybeReachable(GenKill_MixedBitSet())` / `MaybeReachable.assign`; `Place ==` is local + interned projection
  identity; `FxIndexSet<Location>` a `KeyedSet`; the discriminants iterator is a generator consumed by `find`;
  `filter_map` helper for `gen_all`.
- precise_liveness.ts: `kill_points_map` holds copies of the `chunk_by` slices (`chunk_by` helper); `SplitPointIndex::new`
  masks `<<` to 32 bits; `trace!` / `debug_assert!` are comments.
- rustc_peek.ts: `RustcPeekAt` impl tables (`RustcPeekAt_HasMoveData(D_)` with `BitSetExt` of `MaybeReachable<MixedBitSet>`
  / `MixedBitSet`, `RustcPeekAt_MaybeLiveLocals`); `kind.contains(&RustcMirKind::X)` compares tags; the peek-call scan is
  a lazy generator (errors interleave as upstream).
- pretty.ts: `FxIndexMap<PassWhere, Vec<String>>` is a `KeyedMap` (`PassWhere_key`); `ExtraDataFn` returns
  `IoResult<void>` (was `IoResult<null>` in the stub, matching rustc_middle mir/pretty.ts's `extra_data`).

## Full test suite
`RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (once, at `5337b9c5`, detached): **6023 pass, 1 skip (the existing one),
0 fail**, 424 files, 2640 s. Log: `$RUST_TS_DATA/tmp/dataflow-impls/full.log`.
