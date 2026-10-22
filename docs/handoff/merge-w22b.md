# Handoff: merge-w22b (fixer on `integ-w19` after the six late wave-22 merges)

Branch `integ-w19`, from `70a55c6f` (root's merges of dataflow-move-paths, dataflow-impls, mt-promote, const-check,
mt-liveness, mt-built-lints). Commits: `9ad16cec` tests on the real pipeline, `8c400301` M4a stops, then this handoff.

## 1. Tests on the real pipeline (`9ad16cec`)
- `rustc_mir_build/builder/contract.test.ts`: the scratch dir is `tmp/builder-contract/agent-<hash of RUST_TS_AGENT>`.
  An agent name containing "built" made `-Zdump-mir=built` match the `<impl at …/mt-built-lints/…>` def paths (54 oracle
  files instead of 12). Test-only.
- const-check oracle (`check_consts/check.oracle.test.ts`): strict, no PENDING allowance. The driver
  (`check_oracle/run.ts`) calls the real `tcx.mir_const_qualif(def)` (real `mir_built` + its pass list): **16/16**.
- mt-promote (`promote_consts.test.ts`): uses the real `tcx.mir_built(def)` (printed before the steal) and
  `tcx.mir_promoted(def)` (`mir_const_qualif`, `has_ffi_unwind_calls`, promotion, ...): byte-identical to the probe.
  This needed `InstrumentCoverage::policy` (coverage/mod.rs:28), ported in the mt-coverage stub module (1/5).
- mt-liveness: the `PORT(pending mt-built-lints)` block in `liveness.ts` is replaced by
  `import * as diagnostics from "./diagnostics.ts"` (types as `diagnostics.<Type>`). `liveness.oracle.test.ts` now
  compares **rendered stderr + exit code** through a new driver `liveness_oracle/run.ts` (analysis prefix, then
  `check_unsafety` / `has_ffi_unwind_calls` / `check_liveness` per body owner; both sides get `-A unused_mut`, because
  `mir_borrowck` isn't ported). Both fixtures are identical (15 + 10 liveness warnings).
- `mir_built` stand-ins dropped, so every driver runs the real provider:
  - check_unsafety driver: also dropped the `--real-mir-built` flag and the pin test. 24/24.
  - rustc_peek driver: 9/9. The two former `mk_const_alloc` pins (liveness-enum, liveness-projection) now match.
  - built_lints driver: the `SanityCheck` stand-in is gone. 15/15.
  - const_alloc driver (`ty/const_alloc_oracle/run.ts`): uses `ensure_ok().mir_built(def)`.
- The `simplify.test.ts` no-op passes stay: its hand-built `TyCtxt` can't run the real lints. Only the comment changed.
- `rustc_mir_dataflow/lib.ts` header updated: what's ported, and that `provide` is wired.

## 2. M4a stops fixed (`8c400301`)
- **`shim::build_adt_ctor`**, with `local_decls_for_sig` and `new_body` (shim.rs 3/38), ported ahead of mt-shim in its
  stub module. Every constructor's `mir_for_ctfe` reaches it.
  - Checked in scratch against the oracle with the Validator bypassed: identical on mini_core.rs (4 ctors) and on 3 UI
    cases (4 ctors).
  - The real path now stops at `validate::Validator`. A phase change to `Runtime(Optimized)` always validates.
- **stability.rs**: `eval_stability_allow_unstable` calls the real `hir_get_parent_item`, and `late_report_deprecation`
  is complete (`with_no_trimmed_paths(def_path_str)`, `def_descr`, `hir_node`, `emit_node_span_lint(Deprecated)`).
  The file has no `unported` left.
- **rustc_metadata**:
  - `ProcessQueryValue_Deprecation` calls `DeprecationEntry::external`.
  - `eval_static_initializer` decodes `ConstAllocation`. codec.ts's `decode_Allocation` uses allocation.rs's generic
    decoder with `decode_CtfeProvenance` / `decode_unit`.
  - Next stop: `SortedMap<Size, _>` / `InitMask` `derive(Decodable_NoContext)`. These are not generated (codegen set
    rustc_middle_mir has no `derive_decodable`); this is for the codegen owner.

## 3. End-to-end MIR (M4a), `RUST_TS_AGENT=root-fe77`, at `8c400301`
| suite | run | M / D / U | base | M / D / U | changes |
|---|---|---|---|---|---|
| mirdump-minicore (46) | `20261022-170038-root-fe77-28qv` | 17 / 0 / 29 | `qdzc` | 16 / 0 / 30 | 1 UNPORTED→MATCH |
| mirdump-ui `--sample 300` | `20261022-170138-root-fe77-v57j` | 16 / 0 / 283 (+1 UNSTABLE) | `3ska` | 0 / 0 / 299 | 16 UNPORTED→MATCH |

**0 DIFF.** Top stops (all of them):

| mirdump-ui | stop |
|---|---|
| 237 | `rustc_const_eval::const_eval::try_destructure_mir_constant_for_user_output` (MIR printer, `const ()` etc.; needs the interpreter, wave 23b) |
| 20 | `mir_borrowck provider (not ported)` |
| 16 | `rustc_const_eval::const_eval::eval_to_valtree` |
| 5 | `rustc_mir_transform::validate::Validator (pass not ported)` (mt-validate; 3 of them are the ctor cases above) |
| 4 | `rustc_const_eval::const_eval::eval_to_const_value_raw_provider` |
| 1 | `Decodable for SortedMap<Size, _> (derive(Decodable_NoContext) not generated)` |

minicore: 28 `try_destructure_mir_constant_for_user_output`, 1 `eval_to_const_value_raw_provider`.

The `rustc_peek::sanity_check` stop is gone (dataflow-impls), and so are `LintAndRemoveUninhabited`, `mk_const_alloc`,
`Checker::new`, `check_liveness`, `InstrumentCoverage::policy`, `DeprecationEntry::external` and
`hir_get_parent_item`.

**Behind the printer stop.** Scratch check, not committed (`$RUST_TS_DATA/scratch/merge-w22b/{mirdump_partial.ts,
partial_check.ts}`). It is a copy of mirdump.ts that writes a marker and goes on when the printer or a ctor body stops
UNPORTED. Its stderr and its MIR text up to each marker are compared with the oracle's:
- minicore: 28 of the 29 UNPORTED cases are identical. The other one stops in the pipeline (CTFE).
- mirdump-ui sample: 233 of the 236 printer-stop cases are identical. The other 3 are artifacts of the checker: a
  trivial-const one-liner; a query poisoned by a caught stop, which then raises `FatalError`; a static's
  `write_allocations` that the marker skipped.
- **No hidden divergence found.**

## 4. Other suites (`RUST_TS_AGENT=root-fe77`)
| suite | run | M / D / U | base | changes |
|---|---|---|---|---|
| tydump-minicore | `20261022-165055-root-fe77-sbbi` | 45 / 0 / 1 | `zgkc` 45/0/1 | 0 |
| tydump-ui `--sample 300` | `20261022-165116-root-fe77-cva4` | 263 / 1 / 35 (+1 UNSTABLE) | `uc9z` 263/1/35 | 0 (the DIFF is base's `issue-118950-root-region.rs`) |
| hir-tree `--sample 300` | `20261022-165650-root-fe77-5r7b` | 300 / 0 / 0 | | |

## 5. Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (20149; vendor 4330).
- Coverage: rustc_mir_transform 235/1101, rustc_mir_dataflow 288/378, rustc_const_eval 113/764; TOTAL 19578/25518.
  stability.rs 17/17, shim.rs 3/38, coverage/mod.rs 1/5.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`:
  - First run, started at `70a55c6f` while I was editing: 6057 pass / 1 skip / 1 fail. The fail was promote_consts.test,
    caught between two of my edits.
  - Final run at `8c400301`: **6058 pass / 1 skip / 0 fail**. See the last section.

## 6. Shared files edited (review)
- Stub modules of other lanes, partly filled with their markers:
  - `rustc_mir_transform/shim.ts` (mt-shim): `build_adt_ctor`, `local_decls_for_sig`, `new_body`.
  - `coverage/mod.ts` (mt-coverage): `policy`.
- `rustc_middle/middle/stability.ts`, `rustc_middle/ty/codec.ts`, `rustc_metadata/rmeta/decoder/cstore_impl.ts`.
- Test drivers: `check_unsafety_oracle/run.ts`, `rustc_peek_oracle/run.ts`, `built_lints_oracle/run.ts`,
  `check_oracle/run.ts`, `const_alloc_oracle/run.ts`, and the new `liveness_oracle/run.ts`.
- No harness/, scripts/ or tools/ edits.

## `unported(...)` left in what I touched
- shim.ts: `build_drop_shim` and `provide` (lane mt-shim).
- coverage/mod.ts: `InstrumentCoverage::run_pass` (lane mt-coverage).
- liveness.ts, stability.ts: none.

## For root
- The Validator (mt-validate) now gates every constructor body: `run_passes_no_validate` with a phase change to
  `Optimized` always validates.
- `Decodable_NoContext` derives for `SortedMap<Size, _>`, `InitMask` / `InitMaskBlocks` / `InitMaskMaterialized`
  are needed to decode statics' initializers from metadata (codegen set rustc_middle_mir).
- From the handoffs, still open:
  - dataflow-move-paths: the port accepts `fn drop(&mut self)` in a no_core crate without a `legacy_receiver` lang
    item; rustc rejects it. That's for the wfcheck owner.
  - mt-built-lints: `significant_drop_order` is not re-exported from ty/mod.ts. That is consistent with ty/mod.ts,
    which re-exports no `pub mod`.
  - mt-built-lints: `util/alignment.ts` has no util/mod.ts yet (ctfe-util).
  - const-check: `InternKind` lives in rustc_const_eval/diagnostics.ts until interpret/intern.rs lands.

## PORT decisions not yet in docs/state/history.jsonl (phrased for `bun scripts/state.ts record decision`)
merge-w22b (this lane):
1. (merge-w22b) Test drivers run the real `mir_built` / `mir_promoted` / `mir_const_qualif` now that the wave-22 lanes are merged; the stand-ins of check_unsafety, rustc_peek, built_lints, const-check, mt-promote and const_alloc are gone (supersedes merge-w22 decision 2 and mt-built-lints decision 8).
2. (merge-w22b) liveness.oracle.test.ts compares rendered stderr through liveness_oracle/run.ts with `-A unused_mut` on both sides (`mir_borrowck` not ported); the `pending` diagnostics block of liveness.ts is gone (supersedes mt-liveness decisions 4 and 6).
3. (merge-w22b) `shim::build_adt_ctor` (with `local_decls_for_sig`, `new_body`) and `InstrumentCoverage::policy` are ported ahead of mt-shim / mt-coverage, in their stub modules; `IndexVec::from_elem_n(x, 1)` is a one-element array; the `LBR in ADT constructor signature` `expect` is `panic(..)`.
4. (merge-w22b) codec.rs's `Decodable for Allocation` (the `ConstAllocation` payload) is allocation.rs's generic decoder instantiated with `decode_CtfeProvenance` and `decode_unit` (`()` = `null`), allocation.ts read lazily.
5. (merge-w22b) The builder contract test's scratch dir is named by a hash of `RUST_TS_AGENT` (agent names can contain "built", which `-Zdump-mir=built` matches in no_core impl paths).

dataflow-move-paths:
6. (dataflow-move-paths) `MoveSubPath::ConstantIndex(u64)` / `MoveSubPathResult::Subslice { from, to }` are `number`s, like mir `ProjectionElem::ConstantIndex` / `Subslice`. The unit variants are frozen singletons on the companions (`MoveSubPath.Deref`, `MoveSubPathResult.Skip`); derived `PartialEq` with `Skip` compares `.$`.
7. (dataflow-move-paths) `debug!` calls in builder.rs / drop_flag_effects.rs are comments; the derived `Debug` of `MoveData` / `LocationMap` / `MovePathLookup` / `UnDerefer` is not ported (only `debug!` uses it). `cfg!(debug_assertions)` / `debug_assert!` blocks are comments, so a bare deref-temp local still walks its chain in `ProjectionIter` (release behavior).
8. (dataflow-move-paths) `LocationMap::new`'s `vec![T::default(); n]` calls `default_T()` per slot; `IndexMut` is `field_mut(data, offset)`; `IndexVec::push` returns `push(..) - 1`; `entry(..).or_insert_with` is get-then-set on the `MoveSubPath_key` map; out-of-range indexing upstream bounds-checks (`LocationMap`, `ProjectionIter`, `DenseLocationMap`) panics with core's `index out of bounds` message.
9. (dataflow-move-paths) `move_path_for`'s borrowed `ProjectionIter` is the JS iterator (`iter.all(..)` drains it until the first `false`); the nested `fn on_all_children_bits` is a nested function inside its parent (marker kept on it).

dataflow-impls:
10. (dataflow-impls) liveness.ts: `MaybeLiveLocals` (unit struct) is `new MaybeLiveLocals()`; `LivenessTransferFunction<I>` takes the `GenKill<I, Local>` table as a second ctor arg; `DefUse::for_place`'s exhaustive match ends in `unreachable()`. borrowed_locals.ts: `body.local_decls().len()` is `body.local_decls.length`.
11. (dataflow-impls) storage_liveness.ts: `Cow<DenseBitSet>` is the set; `KillableLocals` a `KeyedMap<Location, Local[]>` (`KillableLocals_key`); `KillableLocalsVisitor` is local to `new`. The analyses' visitor helpers extend mir `Visitor`.
12. (dataflow-impls) initialized.ts: fields colliding with methods get `_` (`move_data_`, `exclude_inactive_in_otherwise_`, `mark_inactive_variants_as_uninit_`); builder methods mutate `this`; the `MaybeReachable` domain goes through `GenKill_MaybeReachable(GenKill_MixedBitSet())` / `MaybeReachable.assign`; `Place ==` is local + interned projection identity; `FxIndexSet<Location>` is a `KeyedSet`; the discriminants iterator is a generator consumed by `find`.
13. (dataflow-impls) precise_liveness.ts: `kill_points_map` holds copies of the `chunk_by` slices; `SplitPointIndex::new` masks `<<` to 32 bits; `trace!` / `debug_assert!` are comments.
14. (dataflow-impls) rustc_peek.ts: `RustcPeekAt` impls are tables (`RustcPeekAt_HasMoveData(D_)` over `BitSetExt` of `MaybeReachable<MixedBitSet>` / `MixedBitSet`, `RustcPeekAt_MaybeLiveLocals`); `kind.contains(&RustcMirKind::X)` compares tags; the peek-call scan is a lazy generator (errors interleave as upstream). rustc_mir_dataflow diagnostics.rs is generated by codegen set `rustc_mir_dataflow`.
15. (dataflow-impls) pretty.ts: `FxIndexMap<PassWhere, Vec<String>>` is a `KeyedMap` (`PassWhere_key`); `ExtraDataFn` returns `IoResult<void>`.

mt-promote:
16. (mt-promote) `trait Qualif` is an impl-table interface; `HasMutInterior` / `NeedsDrop` / `NeedsNonConstDrop` are frozen tables of that name; a generic `Q: Qualif` is the table passed first as `Q_` (`in_rvalue::<Q, _>(cx, ..)` → `in_rvalue(Q_, cx, ..)`), stored as `_qualif` where upstream has `PhantomData<Q>`; `in_local: &mut impl FnMut(Local) -> bool` is a closure.
17. (mt-promote) `ConstCx`'s method `const_kind()` is `const_kind_()` (clash with the field); `Validator`'s `Deref<Target = ConstCx>` is the ported `deref()` and the bodies read `this.ccx.<field>`.
18. (mt-promote) `FlowSensitiveAnalysis` extends `AnalysisBase<State>`; `const NAME = Q::ANALYSIS_NAME` is a getter; `State` is a class with `clone` / `clone_from` / `contains`; its derived Debug / PartialEq are `debug_State` / `State_eq`; the domain descriptor is `Domain_State` (`JoinSemiLattice_State` keeps upstream's short-circuit `||`).
19. (mt-promote) promote_consts: `TempState::Defined` is a mutable object owned by one `temps` slot (edited in place only for `ref mut uses`); unit variants are frozen singletons; `Result<(), ()>` is `Result<null, null>`; `Unpromotable` is a frozen unit value.
20. (mt-promote) promote_consts: `IndexVec::push` returns `length - 1`; `basic_blocks.last_index().unwrap()` is `unwrap(length - 1 or None)`; `&mut body[bb]` is `body.index_mut(bb)` (invalidates the CFG cache); `mem::replace` writes the field in place and keeps the old value; `Copy` values upstream duplicates (the promoted's `ConstOperand`, `*constant`, the new body's `MirSource`, the cloned `SourceScopeData`) are `clone_*` copies.
21. (mt-promote) promote_consts: `Location { statement_index: usize::MAX }` is `Number.MAX_SAFE_INTEGER` (never compared or printed); `sort_by_key(Reverse(loc))` is a stable sort with `Location_cmp(b, a)`; `candidates.retain(..)` is `filter`.

const-check:
22. (const-check) `mk_const_alloc` interns by the derived `PartialEq` of `Allocation` (`key_Allocation` in context.ts: bytes, provenance entries without the `SortedMap` comparator, `InitMask` representation, align, mutability); `Hash` only picks the bucket upstream.
23. (const-check) `trait NonConstOp` is an interface with provided methods in `NonConstOp_provided` (via a module-local base class); ops are classes (`ops::FnCallIndirect` is `new FnCallIndirect()`); their `derive(Debug)` (tracing only) is not ported.
24. (const-check) `Qualifs`' `Option<QualifResults>` fields are `MutRef`s filled with `??=`; `Q: Qualif` is the impl table `Q_` (mt-promote's convention); `impl Deref for Checker` is the field `ccx` (`deref()` returns it).
25. (const-check) `crate::interpret::InternKind` is declared in rustc_const_eval/diagnostics.ts until interpret/intern.rs is ported (wave 23b); that port takes it over (typemap const_eval.typemap.json points there).
26. (const-check) Oracle test drivers that bypass `rustc_driver_impl`'s callbacks set `opts.trimmed_def_paths = true` as `TimePassesCallbacks::config` does.

mt-liveness:
27. (mt-liveness) liveness.rs's `MaybeLivePlaces` is its own analysis: it extends `AnalysisBase<DenseBitSet<PlaceIndex>>` with `Direction = Backward`; `TransferFunction` / `LocalVisitor` / `LiteralFinder` extend mir `Visitor`, `ExprFinder` / `LocalUseVisitor` extend hir intravisit `Visitor`. Structs and impls nested in fn bodies are module-level classes next to their parent.
28. (mt-liveness) `FxHashSet<Location>` is a `KeyedSet` (`key_Location`), `FxIndexMap<SourceInfo, Access>` a `KeyedMap` (`key_SourceInfo`); `IndexEntry` is a get/set; `Access` is a mutable object; `IndexMap::retain` is a local `retain`; `IndexVec<I, Option<T>>::insert` / `get_or_insert_with` grow the array.
29. (mt-liveness) `mir::Place ==` is a module-local `place_eq` (local, interned projection by identity), as decision 2026-10-22 #17; `ty::CAPTURE_STRUCT_LOCAL` is cast to the mir `Local` brand; `PlaceIndex` is a `newtype_index` brand with `{}` Debug.
30. (mt-liveness) The `#[derive(Debug)]` of `Access`, `AccessKind`, `CaptureKind`, `PlaceSet`, `ExprFinder`, `DefUse` is not ported: only `tracing` would print them.

mt-built-lints:
31. (mt-built-lints) rustc_mir_transform's diagnostics.rs and lint_tail_expr_drop_order.rs are generated by codegen set `rustc_mir_transform` (set-local typemap mir_transform.typemap.json); manual `impl Diagnostic`/`Subdiagnostic` blocks live in the hand modules; `AssertLint<P: Debug>`'s impl takes `debug_P` (`AssertLint_into_diag(self, debug_P, dcx, level)`).
32. (mt-built-lints) rustc_const_eval util/alignment.rs (`place_unalignment`, `most_packed_projection`) is ported ahead of ctfe-util as `src/rustc_const_eval/util/alignment.ts`, imported directly until util/mod.ts exists; `Align`'s derived `Ord` compares `pow2`, `min_by_key` keeps the first minimum.
33. (mt-built-lints) check_call_recursion: `TerminatorClassifier` is an interface implemented by classes; `Search<C>` implements `TriColorVisitor<BasicBlock, NonRecursive>`; `NonRecursive` is a frozen singleton; `&body.basic_blocks` as a graph is the `BasicBlocks` object cast to `Successors & StartNode`; `&[GenericArg]` slices compare element identity.
34. (mt-built-lints) MIR visitors of the lints (`PackedRefChecker`, `ConstMutationChecker`, `MutRestrictionChecker`, `FunctionItemRefChecker`) are classes extending mir/visit.ts's `Visitor`; `Result<(), &'static str>` is `Result<null, string>`.
35. (mt-built-lints) lint_tail_expr_drop_order: `Rc<RefCell<MixedBitSet>>` is the shared `MixedBitSet` (`.borrow().clone()` copies); `&'a mut Option<Span>` is a `MutRef`; `UnordSet<&Place>` is an array searched with the derived `Place` `PartialEq`; `PlaceElem` `PartialEq` is `intern_key_eq`; `Itertools::all_equal_value` is a local loop.
36. (mt-built-lints) rustc_middle ty/significant_drop_order.rs: `SmallVec` is `Ty[]`, `UnordSet<Ty>`/`FxHashSet<Ty>` are `Set<Ty>`; path slice patterns are length/element checks in arm order; not re-exported from ty/mod.ts.
37. (mt-built-lints) The rustc_mir_transform module-layout test skips generated `*.gen.ts` files and `*_oracle/` fixture/driver directories.

## Final full suite result
`RUST_TS_AGENT=merge-w22b RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` at `8c400301` (detached, clean
tree): **6058 pass, 1 skip (the existing one), 0 fail** (6059 tests, 429 files, 1967 s). Log:
`$RUST_TS_DATA/scratch/merge-w22b/test2.log`.
