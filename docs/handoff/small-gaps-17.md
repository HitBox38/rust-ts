# Handoff: small-gaps-17 (M3, wave 17)

Ports four unowned pieces: `constness` (rustc_const_eval fn_queries.rs), rustc_hir_analysis `check/compare_eii.rs`,
`check/entry.rs` and `autoderef.rs`. Branch `lane/small-gaps-17`, based on main 3e4773f.

## Files

New:
- `src/rustc_const_eval/lib.ts`: crate root, `provide` (lib.rs:45). `const_eval::provide` (= fn_queries) is real; the other
  providers/hooks of lib.rs (M4/M6 modules) are `unported("<upstream fn>")` placeholders.
- `src/rustc_const_eval/const_eval/mod.ts`: `pub use self::fn_queries::*` only.
- `src/rustc_const_eval/const_eval/fn_queries.ts`: `constness`, `is_promotable_const_fn`, `provide`.
- `src/rustc_hir_analysis/autoderef.ts`: `AutoderefKind`, `Autoderef` (class; `next()` + JS iterator), `report_autoderef_recursion_limit_error`.
- `src/rustc_hir_analysis/check/entry.ts`: `check_for_entry_fn`, `check_main_fn_ty` (+ its 5 nested fns).
- `src/rustc_hir_analysis/check/compare_eii.ts`: all 11 fns.
- Tests: `src/rustc_const_eval/const_eval/fn_queries.test.ts` (+ `fn_queries_test/`), `src/rustc_hir_analysis/autoderef.test.ts`
  (+ `autoderef_test/`), `src/rustc_hir_analysis/check/entry.test.ts` (+ `entry_test/`),
  `src/rustc_hir_analysis/check/compare_eii.test.ts` (+ `compare_eii_test/`).

Edited (outside the four files):
- `src/rustc_interface/passes.ts`: `import * as rustc_const_eval` and `rustc_const_eval.provide(providers)` after
  `limits.provide` (upstream order: ast_lowering, limits, expand_queries, **const_eval**, hir...); the PORT comment's pending list
  drops rustc_const_eval.
- `src/rustc_hir_analysis/lib.ts`: `export * as autoderef` (`pub mod autoderef`); side-effect imports of
  `check/compare_eii.ts` and `check/entry.ts` (PORT comment: until check/mod.ts declares `mod compare_eii; mod entry;`).
- Re-pinned stops that the `constness` provider moved (no oracle data touched):
  - `src/rustc_passes/check_attr_stability.oracle.test.ts`: `PENDING.staged_api` ("constness provider (not ported)") removed;
    the case now equals the oracle (13/13 pass).
  - `src/rustc_ty_utils/ty_test/ty.expected.txt`: `param_env(::f)` now stops at
    `rustc_trait_selection::traits::normalize_param_env_or_error` (trait-sel lanes).

## Coverage (`bun scripts/coverage.ts --missing`)
- const_eval/fn_queries.rs 3/3; check/compare_eii.rs 11/11; check/entry.rs 7/7; autoderef.rs 15/15. `--check`: markers ok.
- rustc_const_eval lib.rs: only `provide` is marked (`assert_typing_mode` and `CTRL_C_RECEIVED` are M4/M6).

## Tests (all against the pinned rustc)
- fn_queries: 3 crates (const/non-const fns, inherent `const impl`, `const impl Tr`, `#[rustc_non_const_trait_method]`, tuple
  ctors, foreign fn, closures + "cannot use `const` closures outside of const contexts", `#[rustc_promotable]` under staged_api):
  stdout/stderr/exit byte-identical to the oracle. 3/3.
- autoderef: builtin steps (`&&S`, `&mut`, `owned_box` lang item, raw pointers with/without `include_raw_pointers`, slices),
  recursion limit E0055 (+ `silence_errors`): byte-identical. Overloaded `Deref` stops at
  `predicate_may_hold_opaque_types_jank` (PENDING). 3/3.
- entry: `#[track_caller] fn main` (std) equals rustc's stderr; no_core `async fn main` E0752 equals rustc's first diagnostic;
  lib crate is clean. E0580 / E0131 / E0646 / clean main stop at `codegen_fn_attrs provider (not ported)` (PENDING). 7/7.
- compare_eii: three E0806 argument-count mismatches (tests/ui/error-codes/E0806.rs, eii/type_checking/wrong_ty_2.rs, a
  2-vs-1 case) equal rustc's stderr; matching sig stops at `check_number_of_early_bound_regions`, static mismatch at
  `type_of`'s `check_static_item` stand-in (PENDING). 5/5.
- `bunx tsc --noEmit -p .` clean; `bun scripts/coverage.ts --check` ok; full
  `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4978 pass, 1 skip, 0 fail.
- Sample difftests (RUST_TS_AGENT=small-gaps-17): tydump-nocore 200: MATCH 42 / DIFF 0 / UNPORTED 158
  (run 20261015-003922-small-gaps-17-v1tb); hir-tree-nocore 200: MATCH 200 (run 20261015-003959-small-gaps-17-bfl0).

### Oracle check (fn_queries / autoderef expected files)
The `.stdout`/`.stderr` files of fn_queries_test/ and autoderef_test/ were produced by a throwaway rustc-dev driver (not
committed: lanes may not add probes under tools/) that runs the same loop as the test's run.ts with upstream's
`tcx.constness` / `tcx.is_promotable_const_fn` and `rustc_hir_analysis::autoderef::Autoderef`. Root may turn it into a real
probe; its source (built with `rustc +nightly --edition 2024 main.rs`, run with `DYLD_LIBRARY_PATH=<sysroot>/lib`,
`SG17_MODE=constness|autoderef`):

```rust
#![feature(rustc_private)]
extern crate rustc_driver;
extern crate rustc_hir;
extern crate rustc_hir_analysis;
extern crate rustc_infer;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_span;

use rustc_driver::{Callbacks, Compilation};
use rustc_hir::def::{CtorKind, DefKind};
use rustc_hir::def_id::LocalDefId;
use rustc_hir_analysis::autoderef::Autoderef;
use rustc_infer::infer::TyCtxtInferExt;
use rustc_interface::interface;
use rustc_middle::ty::print::with_no_trimmed_paths;
use rustc_middle::ty::{self, TyCtxt, TypingMode};

struct P;
impl Callbacks for P {
    fn after_expansion<'tcx>(&mut self, _c: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        tcx.hir_crate_items(());
        let n = tcx.untracked().definitions.read().num_definitions();
        let mode = std::env::var("SG17_MODE").unwrap();
        for i in 0..n {
            let id = LocalDefId { local_def_index: rustc_span::def_id::DefIndex::from_usize(i) };
            let k = tcx.def_kind(id);
            if mode == "constness" {
                let ask = matches!(k, DefKind::Fn | DefKind::AssocFn | DefKind::Ctor(_, CtorKind::Fn) | DefKind::Closure | DefKind::Impl { .. });
                if ask {
                    with_no_trimmed_paths!(println!("{:?} {:?} {:?} promotable={}", id, k, tcx.constness(id), tcx.is_promotable_const_fn(id.to_def_id())));
                }
            } else if mode == "autoderef" && k == DefKind::Fn {
                let name = tcx.item_name(id.to_def_id());
                let name = name.as_str();
                if !name.starts_with("ad_") { continue; }
                let sig = tcx.fn_sig(id).instantiate_identity().skip_norm_wip();
                let infcx = tcx.infer_ctxt().build(TypingMode::non_body_analysis());
                for ty in sig.skip_binder().inputs() {
                    let mut ad = Autoderef::new(&infcx, ty::ParamEnv::empty(), id, tcx.def_span(id), *ty);
                    if name.contains("raw") { ad = ad.include_raw_pointers(); }
                    if name.contains("recv") { ad = ad.use_receiver_trait(); }
                    if name.contains("silent") { ad = ad.silence_errors(); }
                    let mut out = String::new();
                    while let Some((t, n)) = ad.next() { out += &format!(" ({t}, {n})"); }
                    with_no_trimmed_paths!(println!("{name}:{out} | final={} steps={:?} limit={}", ad.final_ty(), ad.steps(), ad.reached_recursion_limit()));
                }
            }
        }
        Compilation::Stop
    }
}

fn main() -> std::process::ExitCode {
    let args: Vec<String> = std::env::args().collect();
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&args, &mut P))
}
```

## unported(...) left
- rustc_const_eval/lib.ts (M4/M6): `rustc_const_eval::const_eval::{tag_for_variant_provider, eval_to_const_value_raw_provider,
  eval_to_allocation_raw_provider, eval_static_initializer_provider, eval_to_valtree, try_destructure_mir_constant_for_user_output,
  valtree_to_const_value}`, `rustc_const_eval::util::{caller_location::const_caller_location_provider, check_validity_requirement,
  validate_scalar_in_layout}`.
- Stand-ins for other lanes (root repoints at integration; each is at the end of its file under "Stand-ins"):
  - autoderef.ts: `ObligationCtxt` view + `ObligationCtxt_new` -> `rustc_trait_selection::traits::ObligationCtxt.new` (trait-sel-traits-a).
  - entry.ts: `check_function_signature` -> check/mod.ts (check-check); `ObligationCtxt_new_with_diagnostics` (trait-sel-traits-a);
    `TypeErrCtxtView`/`err_ctxt` (wave 19); `CodegenFnAttrsView` (codegen_fn_attrs not ported).
  - compare_eii.ts: `potentially_plural_count` (copy of upstream body, as check-compare did) -> check/mod.ts;
    `CheckNumberOfEarlyBoundRegionsError` + `check_number_of_early_bound_regions` -> check/compare_impl_item.ts (check-compare);
    `ObligationCtxt_new_with_diagnostics`; `TypeErrCtxtView`/`err_ctxt`.

## Integration notes for root
- check-wf-b's wfcheck.ts stand-ins `Autoderef_new`, `compare_eii_function_types`, `compare_eii_statics`, `check_for_entry_fn`
  -> `Autoderef.new` (autoderef.ts; the class has `use_receiver_trait()`, `include_raw_pointers()`, `next()`,
  `into_obligations()`), `compare_eii.ts` and `entry.ts` exports (signatures match: `Result<null, ErrorGuaranteed>`).
- check-check's check/mod.ts should import `./compare_eii.ts` / `./entry.ts`; then drop the two side-effect imports from lib.ts.
- After repointing, update the tests' `PENDING` sets (entry/compare_eii/autoderef); cases turn into oracle matches.
- Other tests that pin "constness provider (not ported)" in other lanes (e.g. check-wf-b's `PENDING_WF`) move to the next stop.

## PORT decisions
- fn_queries: the `match` with `if let` guards is an if-chain in arm order; `cfg!(debug_assertions)` block in
  `is_promotable_const_fn` is a comment (release rustc); unknown query values cast.
- autoderef: `impl Iterator` = `next()` + `[Symbol.iterator]`; `mut self` builders mutate and return `this`; fields `span_`,
  `include_raw_pointers_`, `use_receiver_trait_`, `silence_errors_` (methods of the same name); `PredicateObligations::clone`
  is an array copy; `Limit(0) => Limit(2)` is `limit._0 === 0`.
- entry: nested fns kept nested with markers; `Option::then_some` / `unwrap_or` inline.
- compare_eii: `FxIndexSet<Ty>` -> `Set<Ty>`; the `Option` combinator chain in `report_number_of_arguments_mismatch` is unrolled
  in order; lazy span iterators are arrays; `(a, b).references_error()` uses `fold_tuple2`; `mut cause` by value: the caller
  passes a clone.
