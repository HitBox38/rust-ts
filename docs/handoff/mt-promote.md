# Handoff: mt-promote (M4 wave 22): promotion + const qualifs

Branch `lane/mt-promote` (from `fe77b233`, no merges). Commits: `29a35e65` port + wiring, `80d81974` tests, then
this handoff.

## Result
| upstream | TS | fns |
|---|---|---|
| rustc_mir_transform/src/promote_consts.rs | src/rustc_mir_transform/promote_consts.ts (stub module replaced) | 27/27 |
| rustc_mir_transform/src/post_drop_elaboration.rs | src/rustc_mir_transform/post_drop_elaboration.ts (stub module replaced) | 1/1 |
| rustc_const_eval/src/check_consts/mod.rs | src/rustc_const_eval/check_consts/mod.ts (new) | 9/9 |
| rustc_const_eval/src/check_consts/qualifs.rs | src/rustc_const_eval/check_consts/qualifs.ts (new) | 16/16 |
| rustc_const_eval/src/check_consts/resolver.rs | src/rustc_const_eval/check_consts/resolver.ts (new) | 25/25 |
| rustc_const_eval/src/check_consts/post_drop_elaboration.rs | src/rustc_const_eval/check_consts/post_drop_elaboration.ts (new) | 4/4 |

Coverage: rustc_mir_transform 141/1101, rustc_const_eval 58/764, TOTAL 19246/25518. `coverage.ts --check`: markers ok.
No `unported(...)` is left in these six files.

### Wiring (shared files, review)
- `src/rustc_const_eval/lib.ts`: `pub mod check_consts;` (`import * as check_consts` + export).
- `src/rustc_mir_transform/lib.ts` (the two stops mt-skeleton assigned to this lane): `mir_const_qualif` is ported
  for real (ConstCx, the `span_bug` on a non-const, the `references_error` delayed bug, `Checker::new` / `check_body` /
  `qualifs_in_return_place`); the stand-in `checking_enabled_ConstCx_new` is gone,
  `run_analysis_to_runtime_passes` calls `check_consts::post_drop_elaboration::checking_enabled(ConstCx::new(..))`.
- `src/rustc_mir_transform/pass_manager.test.ts`: stub-module count 69 → 67 (as the mt-skeleton contract asks).

## Coordination with const-check (check_consts/{check, ops})
Created as **stub modules** so this lane type-checks; on merge, **take const-check's files** (add/add conflict):
- `check_consts/check.ts`: `Checker` with `static new(ccx)`, `check_body()`, `qualifs_in_return_place(): ConstQualifs`,
  `check_drop_terminator(place, location, span)`, each `// stub: ... (lane const-check)` → `unported(...)`.
- `check_consts/ops.ts`: empty module (`mod.ts` declares `export * as ops from "./ops.ts"`).
- `check_consts/mod.ts` declares all five submodules (`check`, `ops`, `post_drop_elaboration`, `qualifs`, `resolver`)
  as namespace re-exports; const-check should not need to edit it. If check.ts imports mod.ts (`ConstCx`) there is a
  module cycle mod.ts → check.ts → mod.ts; it is TDZ-safe as long as check.ts uses `ConstCx` only inside functions.
- API for check.rs (shapes const-check should use):
  - `Qualif` is an impl-table interface (`ANALYSIS_NAME`, `IS_CLEARED_ON_MOVE`, `ALLOW_PROMOTED`, `in_qualifs`,
    `in_any_value_of_ty(cx, ty)`, `is_structural_in_adt_value(cx, adt)`); the implementors are the frozen tables
    `qualifs.HasMutInterior` / `NeedsDrop` / `NeedsNonConstDrop`. Generic `Q` is passed first: `qualifs.in_place(Q_,
    ccx, in_local, place_ref)`, `in_rvalue(Q_, ..)`, `in_operand(Q_, ..)`; `qualifs.in_any_value_of_ty(ccx, ty,
    tainted)` is the free fn.
  - `resolver.FlowSensitiveAnalysis.new(Q_, ccx)` extends `AnalysisBase<State>` (`iterate_to_fixpoint(tcx, body,
    undefined).into_results_cursor(body)` gives check.rs's `ResultsCursor<State, FlowSensitiveAnalysis>`);
    `State.contains(local)`, `State.qualif` / `.borrow` (`MixedBitSet<Local>`). `pub(super)` items are exported.
  - `ConstCx` fields `body`, `tcx`, `typing_env`, `const_kind`; the method `const_kind()` is **`const_kind_()`**
    (field/method clash); `dcx()`, `def_id()`, `enforce_recursive_const_stability()`, `is_async()`, `fn_sig()`.
    `rustc_allow_const_fn_unstable`, `is_fn_or_trait_safe_to_expose_on_stable` are exported from mod.ts.

## Tests (`src/rustc_mir_transform/promote_consts.test.ts`, oracle = the mirdump probe)
- "promoted MIR equals the mirdump probe's": a no_core crate (`&5`, `&[1, 2]`, a reborrow through `let`, `&P { a: 1 }`
  (the `Freeze` obligation of `HasMutInterior`), `&mut []`, nested `&[&1, &2]`, `&(10 / 2)` (division checks),
  a borrowed call and argument in fns (not promotable), a borrowed `UnsafeCell` (not promotable), const-fn calls in
  a `const` and a `static` (promoted `Call` terminators, `unwind continue`, `required_consts`)). The port builds each
  body in process (`build_mir_inner_impl`, `SimplifyCfg::Initial` — the other `mir_built` passes are mt-built-lints
  stubs that leave these bodies unchanged), then `compute_required_consts` + `PromoteTemps` +
  `SimplifyCfg::PromoteConsts`, prints `// mir_built` / `// mir_promoted` + promoteds with `MirWriter::write_mir_fn`
  in the probe's layout: **byte-identical** to the probe (730 lines, 9 promoted fragments; trivial-const one-liners
  excluded on both sides). `mir_const_qualif` is skipped there (Checker is const-check's; it only supplies
  `tainted_by_errors`).
- "FlowSensitiveAnalysis propagates qualifs": `HasMutInterior` / `NeedsDrop` through the dataflow framework on a body
  with an `UnsafeCell` argument, a move, a borrow and `StorageDead` (`State { qualif: [_0, _1], borrow: [] }`).
- `bun test src/rustc_mir_transform` (`RUST_TS_REQUIRE_PROBES=1`): 0 fail.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: see "Checks".

## Samples (`RUST_TS_AGENT=root-fe77`, compared case by case with root's base runs at `fe77b233`)
| suite | lane run | M / D / U / C | base run | case-by-case |
|---|---|---|---|---|
| mirdump-minicore (46) | `20261022-152843-root-fe77-b1r7` | 16 / 0 / 30 / 0 | `20261022-144421-root-fe77-qdzc` | 46 same status and stop |
| mirdump-ui `--sample 300` | `20261022-152902-root-fe77-wr4s` | 0 / 0 / 299 / 0 (+1 UNSTABLE) | `20261022-144709-root-fe77-3ska` | 300 same |
| tydump-minicore (46) | `20261022-153112-root-fe77-rzgz` | 45 / 0 / 1 / 0 | `20261022-144407-root-fe77-zgkc` | 46 same |
| tydump-ui `--sample 300` | `20261022-153134-root-fe77-kim7` | 263 / 1 / 35 / 0 (+1 UNSTABLE) | `20261022-144529-root-fe77-uc9z` | 300 same (the 1 DIFF is in the base too) |

**No new DIFF; the mirdump stops did not move.** Every mirdump body stops in `mir_built` before `mir_promoted` is
reached: 217 (ui) / 26 (minicore) at `LintAndRemoveUninhabited (pass not ported)` (mt-built-lints), then
`mk_const_alloc` 37, `mir_borrowck` 20, `eval_to_valtree` 13, `has_ffi_unwind_calls` 7. Once mt-built-lints lands,
fns reach promotion (ported); const items / const fns stop at `Checker::new` (const-check) in `mir_const_qualif`.
Also on the mirdump path after promotion: `check_liveness` (mt-liveness) and `InstrumentCoverage::policy`.

## PORT decisions (phrased for `bun scripts/state.ts record decision`)
1. (mt-promote) `trait Qualif` (assoc consts + `self`-less fns, unit-struct implementors used as type params) is an impl-table interface; `HasMutInterior` / `NeedsDrop` / `NeedsNonConstDrop` are frozen tables of that name; a generic `Q: Qualif` is the table passed first as `Q_` (`in_rvalue::<Q, _>(cx, ..)` → `in_rvalue(Q_, cx, ..)`), stored as `_qualif` where upstream has `PhantomData<Q>`; `in_local: &mut impl FnMut(Local) -> bool` is a closure.
2. (mt-promote) `ConstCx`'s method `const_kind()` is `const_kind_()` (clash with the field); `Validator`'s `Deref<Target = ConstCx>` is the ported `deref()` and the bodies read `this.ccx.<field>`.
3. (mt-promote) `FlowSensitiveAnalysis` extends `AnalysisBase<State>`; `const NAME = Q::ANALYSIS_NAME` is a getter; `State` is a class with `clone` / `clone_from` / `contains`; its derived Debug / PartialEq are `debug_State` / `State_eq`; the domain descriptor is `Domain_State` (`Clone_State`, `JoinSemiLattice_State` keeping upstream's short-circuit `||`, `DebugWithContext_State`).
4. (mt-promote) promote_consts: `TempState::Defined` is a mutable object owned by one `temps` slot (edited in place only for `ref mut uses`); unit variants are frozen singletons; `Result<(), ()>` is `Result<null, null>`; `Unpromotable` is a frozen unit value.
5. (mt-promote) promote_consts: `IndexVec::push` returns `length - 1`; `basic_blocks.last_index().unwrap()` is `unwrap(length - 1 or None)`; `&mut body[bb]` is `body.index_mut(bb)` (invalidates the CFG cache), `&body[bb]` is `body.index(bb)`; `mem::replace` of the assign rvalue / terminator kind writes the field in place and keeps the old value; `Copy` values that upstream duplicates (`ConstOperand` of the promoted, `*constant`, `MirSource` of the new promoted body, the cloned `SourceScopeData`) are `clone_*` copies.
6. (mt-promote) promote_consts: `Location { statement_index: usize::MAX }` (the promoted root rvalue's visitor location) is `Number.MAX_SAFE_INTEGER` (never compared or printed); `sort_by_key(Reverse(loc))` is a stable sort with `Location_cmp(b, a)`; `candidates.retain(..)` is `filter`.
7. (mt-promote) rustc_const_eval check_consts/check.ts and ops.ts are stub modules owned by lane const-check (declared names: `Checker::{new, check_body, qualifs_in_return_place, check_drop_terminator}`); on merge const-check's files win.

## `unported(...)` left
- None in the six ported files. Reached through the stubs: `rustc_const_eval::check_consts::check::Checker::new`
  (and its methods) from `mir_const_qualif` (const items, statics, const fns) and from `check_live_drops` (only with
  `#![feature(const_precise_live_drops)]` or `rustc_allow_const_fn_unstable`).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok.
- Full `RUST_TS_AGENT=mt-promote RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (once, detached, at `80d81974`): **6007 pass, 1 skip, 0 fail** (6008 tests, 422 files, 2800 s).
