# Handoff: typeck-probe (M3 wave 18b, rustc_hir_typeck method/probe.rs)

Branch `lane/typeck-probe` (from integ `a5910d3`, no merges). Commits: `13c0c63` (port), `143871f` (fidelity fixes),
`0350b75` (oracle test), `a67770f` (`expect_ty`).

## Result
- **method/probe.rs: 55/55 fns ported**, in upstream order, with markers: the 4 `impl FnCtxt` methods (`probe_op`,
  `probe_for_name`, `probe_for_name_many`, `probe_for_return_type_for_diagnostic`), the free fn / provider
  `method_autoderef_steps`, `ProbeContext` (`deref`, `new` and 42 methods), `Pick` (2 methods, plus the nested
  `ItemMaybeBeAddedToStd::into_diag`), `AutorefOrPtrAdjustment::get_unsize`, `PickConstraintsForShadowed` (2),
  `Candidate::to_unadjusted_pick`. Every `unported_methods(..)` placeholder list of probe.ts is gone.
- `method_autoderef_steps` is checked against the pinned rustc byte-for-byte (new test, see "Oracle check").
- Candidate assembly order (inherent: per step `assemble_probe` in step order; extension: `in_scope_traits` order with
  `(DefId, lint_ambiguous)` dedup; `impl_dups`), the private/inherent/extension split, `pick_method`'s inherent ->
  extension -> private order, `consider_candidates`' collapse -> unstable filter -> subtrait collapse -> `Ambiguity`
  order and `candidate_method_names`' byte-order sort (`str_cmp`, stable) follow upstream exactly.

## Files
- `src/rustc_hir_typeck/method/probe.ts` (the stub, now the port).
- New test: `src/rustc_hir_typeck/method/probe.test.ts` + `src/rustc_hir_typeck/method/probe_test/` (`run.ts`,
  `steps.rs`, `limit.rs`, `recv.rs` and their oracle `.stdout`/`.stderr`).
- Nothing else touched (no decls.ts, generated file, tools, scripts or other lane's file).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (15218; vendor 3888)`.
- `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/method/probe.rs`: `55/55 ported`
  (crate: 131/1041 on this branch).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_hir_typeck --timeout=120000`: 15 pass / 0 fail (contract.test.ts 12 +
  probe.test.ts 3). Negative control: setting the array step's `unsize: true` to `false` fails all 3 probe tests.
- No pre-existing test's pinned stop moved (typeck still stops at `rustc_hir_typeck::loops::check` before any method call).

## Samples (no new DIFF; same per-case status and stop as base)
Base = integ `a5910d3` in a detached worktree (`RUST_TS_AGENT=typeck-probe-base`), lane = `a67770f`
(`RUST_TS_AGENT=typeck-probe`), same `--seed typeck-probe`. Per-case comparison of status + stop text: 0 changed in each.

| suite | lane run | MATCH | DIFF | UNPORTED | CRASH | base run |
|---|---|---|---|---|---|---|
| tydump-minicore (46, full) | `20261015-082919-typeck-probe-cuvz` | 5 | 0 | 41 | 0 | `20261015-082042-typeck-probe-base-eefu` 5/0/41/0 |
| tydump-nocore `--sample 100` | `20261015-082933-typeck-probe-scxr` | 76 | 0 | 24 | 0 | `20261015-082104-typeck-probe-base-70k6` 76/0/24/0 |
| hir-tree-nocore `--sample 100` | `20261015-083008-typeck-probe-zt32` | 99 | 0 | 1 | 0 | `20261015-082138-typeck-probe-base-93r4` 99/0/1/0 |

Top stops (unchanged, none in this lane): tydump-minicore `FulfillmentContext::new (old solver, wave 20)` 34,
`check_unused_traits provider` 3, `StableHash without a TS impl` 2; tydump-nocore `QueryKey for
(CanonicalImpliedOutlivesBoundsGoal, bool)` 9, `LateParamRegionKind::from_bound` 5, `IntegerExt::from_int_ty` 4;
hir-tree-nocore `IntoDiagArg without a TS impl` 1. Method probing is not reached by any sample yet (every typeck stops at
`loops::check`, lane typeck-lib-wb).

## Oracle check (probe_test expected files)
The `.stdout`/`.stderr` files were produced by a throwaway rustc-dev driver (not committed; lanes may not add probes under
tools/; it lives in `$RUST_TS_DATA/tmp/typeck-probe-oracle/`). Built with `rustc +nightly-2026-10-11 --edition 2024
main.rs -o oracle`, run as `DYLD_LIBRARY_PATH=<sysroot>/lib oracle --sysroot <sysroot> --edition=2021 <file>.rs`. Our
run.ts runs the same loop but calls the provider `method_autoderef_steps(tcx, goal)` directly (the query's key is not
ported, see "For root" 1). Root may turn it into a real probe:

```rust
#![feature(rustc_private)]
extern crate rustc_driver; extern crate rustc_hir; extern crate rustc_infer;
extern crate rustc_interface; extern crate rustc_middle; extern crate rustc_span;
use rustc_driver::{Callbacks, Compilation};
use rustc_hir::def::DefKind;
use rustc_hir::def_id::LocalDefId;
use rustc_infer::infer::TyCtxtInferExt;
use rustc_infer::infer::canonical::OriginalQueryValues;
use rustc_interface::interface;
use rustc_middle::traits::query::{MethodAutoderefSteps, MethodAutoderefStepsResult};
use rustc_middle::ty::print::with_no_trimmed_paths;
use rustc_middle::ty::{self, Ty, TyCtxt, TypingMode};
use rustc_span::DUMMY_SP;

fn print(name: &str, r: &MethodAutoderefStepsResult<'_>) {
    with_no_trimmed_paths!({
        println!("{name}: limit={} steps={}", r.reached_recursion_limit, r.steps.len());
        for (i, s) in r.steps.iter().enumerate() {
            println!("  step {i}: opaque={} autoderefs={} unsafe={} unsize={} via_deref={} self_ty={:?}",
                s.self_ty_is_opaque, s.autoderefs, s.from_unsafe_deref, s.unsize, s.reachable_via_deref, s.self_ty);
        }
        match r.opt_bad_ty {
            Some(b) => println!("  bad: reached_raw_pointer={} ty={:?}", b.reached_raw_pointer, b.ty),
            None => println!("  bad: none"),
        }
    });
}
fn run<'tcx>(tcx: TyCtxt<'tcx>, name: &str, param_env: ty::ParamEnv<'tcx>,
             f: impl FnOnce(&rustc_infer::infer::InferCtxt<'tcx>) -> Ty<'tcx>) {
    let infcx = tcx.infer_ctxt().build(TypingMode::non_body_analysis());
    let self_ty = f(&infcx);
    let mut orig_values = OriginalQueryValues::default();
    let goal = infcx.canonicalize_query(
        param_env.and(MethodAutoderefSteps { predefined_opaques_in_body: ty::List::empty(), self_ty }), &mut orig_values);
    print(name, &tcx.method_autoderef_steps(goal));
}
struct P;
impl Callbacks for P {
    fn after_expansion<'tcx>(&mut self, _c: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let _ = tcx.hir_crate_items(());
        let n = tcx.untracked().definitions.read().num_definitions();
        for i in 0..n {
            let id = LocalDefId { local_def_index: rustc_span::def_id::DefIndex::from_usize(i) };
            if tcx.def_kind(id) != DefKind::Fn { continue; }
            let name = tcx.item_name(id.to_def_id());
            let name = name.as_str();
            if !name.starts_with("ms_") { continue; }
            let sig = tcx.fn_sig(id).instantiate_identity().skip_norm_wip();
            let sig = tcx.instantiate_bound_regions_with_erased(sig);
            let param_env = tcx.param_env(id);
            for (j, ty) in sig.inputs().iter().enumerate() { run(tcx, &format!("{name}#{j}"), param_env, |_| *ty); }
        }
        run(tcx, "infer", ty::ParamEnv::empty(), |infcx| infcx.next_ty_var(DUMMY_SP));
        run(tcx, "ref_infer", ty::ParamEnv::empty(), |infcx|
            Ty::new_imm_ref(tcx, tcx.lifetimes.re_erased, infcx.next_ty_var(DUMMY_SP)));
        Compilation::Stop
    }
}
fn main() -> std::process::ExitCode {
    let args: Vec<String> = std::env::args().collect();
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&args, &mut P))
}
```

Covered: builtin deref over `&`/`&mut`/`Box`/raw pointers (`from_unsafe_deref`), slices, `str`, the array unsize step
(const-generic lengths: a literal length stops at `QueryKey for LitToConstInput` in rustc_middle), type/const params under
`param_env(fn)`, `#![recursion_limit = "4"]` (`reached_recursion_limit`), `arbitrary_self_types(_pointers)` (the
`Receiver`/`Deref` zip), an inference variable final type (`opt_bad_ty`), alone and behind `&`.

## `unported(...)` left in probe.ts
1. `#[derive(Diagnostic)] rustc_hir_typeck::method::probe::probe_op::MissingTypeAnnot` and
   `..::MethodCallOnDivergingInferenceVariable` (the two structs local to `probe_op`; codegen does not generate them):
   reached by the 2015-edition `TYVAR_BEHIND_RAW_POINTER` lint and by a method call on a diverging inference variable
   (`METHOD_CALL_ON_DIVERGING_INFER_VAR`, a success path).
2. `rustc_trait_selection::error_reporting::infer::need_type_info::emit_inference_failure_err` (wave 19; reached after
   `self.err_ctxt()`, itself unported): E0282 on a method call whose receiver is `_`.
3. `rustc_trait_selection::traits::select::SelectionContext::select` (local helper `SelectionContext_select`, lane
   selcx-contract): `select_trait_candidate_for_diagnostics`, reached from `consider_probe` (old solver, trait candidate
   whose `predicate_may_hold` is false) and from `candidate_source` (ambiguity errors).

## Success-path calls into other lanes' placeholders (cross-lane needs)
- `FnCtxt::probe_instantiate_query_response` (fn_ctxt/_impl.rs:1633, lane typeck-impl): every `pick` step.
- `FnCtxt::associated_value` (method/mod.rs, lane typeck-method): `impl_or_trait_item` for every named probe.
- `suggest::all_traits` (method/suggest.rs:4962, wave 19): `ProbeScope::AllTraits` and every failed `pick` (diagnostics
  search) and `probe_for_similar_candidate`.
- `InferCtxt::predicate_may_hold` (old solver, rustc_trait_selection evaluate_obligation) in `consider_probe` for trait
  candidates under `-Znext-solver=coherence` (compiletest-derived suites).

## For root
1. **Query key**: `tcx.method_autoderef_steps(goal)` (every `Mode::MethodCall` probe) stops at `rustc_middle::query::keys:
   QueryKey for CanonicalMethodAutoderefStepsGoal<'tcx> (cache)` (queries.gen.ts `key_unported`; keys.rs:355 canonical
   inputs). This will be the first stop of method calls once typeck reaches them.
2. **Codegen follow-ups** (worked around locally with `// PORT` descriptors in probe.ts; root may move them):
   - `MethodAutoderefSteps`' generated TypeFoldable/TypeVisitable (rustc_middle traits/query.gen.ts) call
     `unported_type_fold` for `predefined_opaques_in_body` (its `PredefinedOpaques` comes from traits/solve.gen.ts, not
     mapped to structural_impls' `fold_PredefinedOpaques`). probe.ts exports `fold_MethodAutoderefSteps`.
   - `ParamEnvAnd<T>` (rustc_middle ty/mod.rs, `#[derive(TypeFoldable, TypeVisitable)]`) has no descriptor: probe.ts's
     local `fold_ParamEnvAnd(d_T)` (needed by `build_with_canonical` / `instantiate_canonical` of the goal).
   - `CandidateStep.self_ty` / `MethodAutoderefBadTy.ty` are typed `Canonical<unknown>` with `unported_debug` (should be
     `Canonical<QueryResponse<Ty>>`): probe.ts casts via `step_self_ty` / `bad_ty_ty`.
   - `debug_Canonical` (rustc_type_ir canonical.gen.ts) prints `var_kinds` with `unported_debug`: probe_test/run.ts prints
     the same derived output itself.
   - The two `#[derive(Diagnostic)]` structs local to `probe_op` (unported 1).
3. **PORT decisions** (record):
   - `PickDiagHints.unsatisfied_predicates: &mut Vec` is the shared array; `Cell`/`RefCell` fields are plain fields;
     `std::mem::take` / `Cell::take` are read-then-reset; `impl_dups` is constructed as a `DefIdSet` (DefId is a class).
   - `AutorefOrPtrAdjustment` is re-exported from probe.ts as `{ ...gen, get_unsize }` (enum method on the companion);
     `PickConstraintsForShadowed` / `Candidate` methods are prototype methods (module augmentation of probe.gen.ts).
   - `method_autoderef_steps`' lazy `Zip`/`Chain` of the `Receiver` and `Deref` autoderef chains is an explicit loop that
     pulls the receiver chain first and stops pulling the deref chain after its first `None` (the deref chain's
     `final_ty()` depends on how far it was driven).
   - `xform_self_ty`: `unwrap_or(sig.inputs()[0])` keeps the eager bounds check (panics with the Rust message).
   - `consider_probe` normalizes `xform_ret_ty: Option<Ty>` only when `Some` (`Option`'s fold).
   - `FxHashSet<Ident>` keyed by name + `SyntaxContext` (Ident's Eq/Hash); `(DefId, bool)` dedup via `KeyedSet`.
   - `debug!` / `#[instrument]` are comments; `span_bug!`/`bug!` messages format their `{:?}` arguments with the ported
     Debug impls.
