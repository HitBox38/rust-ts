# Handoff: tydump-subject (M3): the port side of the `tydump-*` / `thirdump-*` suites

Branch `lane/tydump-subject`, based on main 816b5c5. No baselines, suites, probes or expected oracle outputs touched.

## Summary
- `src/rust_ts/tydump.ts` now runs the probe's D1 prefix and prints its dump (`src/rust_ts/tydump_dump.ts`), section by
  section with the probe's sort keys. thirdump runs the same prefix, then `abort_if_errors`, then stops at
  `thir_flat` / `thir_tree` (THIR building is wave 18): **thirdump is reachable up to the prefix only.**
- Every case that gets past AST lowering now stops at the **first unported statement of the prefix: `entry_fn`**
  (misc_checking_1). The dump itself is written but only reachable once the prefix runs (see "Experiment" below for what
  it already prints).

## Files touched
- `src/rust_ts/tydump_dump.ts` (new, our own code): `run_required_analyses_prefix`, the inlined `check_crate`,
  `check_crate_typecks` (prefix.rs), and `should_encode_{variances,generics,type,fn_sig}`, `defs_with_hir`, `dump`,
  `table`, `dump_typeck` (main.rs), in the probe's order. Upstream statements go through their ported fns and queries.
  collect/dump.rs is called directly (`rustc_hir_analysis/collect/dump.ts`, after the crate's lib.ts for load order).
- `src/rust_ts/tydump.ts`: callbacks wired like resdump.ts (dynamic imports after `ensure_stack`, `std_print`).
- `src/rust_ts/thirdump.ts`: prefix + `abort_if_errors` + the `hir_body_owners` loop; `THIRDUMP_FORMAT=tree` honoured.
- `src/rustc_passes/delegation.ts` (new) + `rustc_passes/lib.ts` export: delegation.rs (1 fn), called by the prefix.
- `src/rustc_interface/passes.ts`: `DiagCallback::into_diag` (passes.rs:1078) and `emit_delayed_lints` (:1083).
- `src/rustc_data_structures/sync/parallel.ts` (new): sync/parallel.rs, serial paths (`ParallelGuard`, `parallel_guard`,
  `par_fns`, `par_for_each_in`, `try_par_for_each_in`, `par_map`, ...). The prefix's `par_fns` uses it.
  `rustc_middle/hir/map.ts` / `hir/mod.ts`: their `par_for_each_in` / `try_par_for_each_in` pending shims are replaced by
  imports from it (call-site repoint), so `par_hir_for_each_module` / `par_hir_body_owners` run.
- Debug impls:
  - `src/rustc_middle/ty/list.ts`: `debug_BoundVarKinds`, a hand alias (`debug_RawList` over `debug_BoundVariableKind`).
  - `tools/codegen/tyir.typemap.json`: `I::BoundVarKinds` now names that alias (was `debug: null`). Regenerated sets
    rustc_ty, rustc_middle_traits_thir, rustc_infer, rustc_hir_analysis, rustc_ty_utils; the only output change is
    `src/rustc_type_ir/binder.gen.ts` (`Binder.bound_vars` Debug). **Root: this is a tools/ config change; please review.**
  - `src/rustc_middle/ty/region.ts`: `impl Debug for EarlyParamRegion` (region.rs:57).
- `src/rustc_type_ir/tyir_misc_lib_sty.test.ts`: the Region Debug oracle loop runs inside
  `create_default_session_globals_then`, because `EarlyParamRegion`'s Debug reads a `Symbol`. `early_anon` used to be
  accepted as UNPORTED and is now asserted to be exactly `'_/#2`, as the oracle prints it.
- `src/rustc_hir_analysis/collect_test/{generics,misc}.expected.txt`: regenerated; 10 `type_of STOP UNPORTED` lines are now
  values. collect.test.ts's check 2 compares them with the tydump probe: byte-identical.

## Coverage
- `compiler/rustc_data_structures/src/sync/parallel.rs`: 12/12.
- `compiler/rustc_passes/src/delegation.rs`: 1/1.
- `compiler/rustc_interface/src/passes.rs`: 25/29 (missing: print_macro_stats, run_required_analyses, analysis,
  start_codegen).
- `compiler/rustc_middle/src/ty/region.rs`: 1/13 (only the Debug impl; the rest is another lane's).
- `compiler/rustc_middle/src/ty/list.rs`: 22/22.
- `bun scripts/coverage.ts --check`: markers ok (13351; vendor 3888).

## Results (`RUST_TS_AGENT=tydump-subject`)
| suite | before | after |
|---|---|---|
| tydump-nocore `--sample 300` | 15 MATCH / 0 DIFF / 285 UNPORTED | **38 MATCH / 0 DIFF / 262 UNPORTED** |
| tydump-minicore (full, 46) | 4 MATCH / 42 UNPORTED (probe handoff) | 5 MATCH / 0 DIFF / 41 UNPORTED |
| thirdump-minicore (full, 46) | 4 MATCH / 42 UNPORTED (probe handoff) | 5 MATCH / 0 DIFF / 41 UNPORTED |
| hir-tree-nocore `--sample 100` | | 98 MATCH / 2 UNPORTED (both delegation `fn_sig` skip_binder, not protected, pre-existing) |

Stop histogram, tydump-nocore sample 300 (run 20261014-161813-tydump-subject-khzd):
- 256 `entry_fn provider (not ported)`
- 5 `rustc_type_ir::binder::{EarlyBinder, Binder}::skip_binder of tcx.fn_sig(..)` (delegation; next.md's repoint item)
- 1 `rustc_expand::proc_macro::BangProcMacro::expand` (M6)

minicore (both suites): 39 `entry_fn provider (not ported)`, 2 `StableHash without a TS impl` (before the prefix, while
loading `--extern mini_core`).

## Experiment: what comes after `entry_fn` (measurement only, not committed)
To show root which work matters, I ran the sample once more with a local, uncommitted patch that caught each `Unported`
of the prefix statements and of each dump fact, logged it, and went on. These are case counts (sample 300; minicore 10 cases
reach the prefix):
- Prefix, every case, in order: `entry_fn`, `check_externally_implementable_items`, `exportable_items`,
  `stable_order_of_exportable_impls` (passes-a: entry, eii, check_export), `check_mod_attrs`,
  `check_mod_unstable_api_usage` (passes-b), `check_type_wf`, `crate_inherent_impls_validity_check`,
  `crate_inherent_impls_overlap_check` (wave 17), `typeck_root` (249, wave 18), `check_unused_traits` (249),
  `coherent_trait` (59). `emit_delayed_lints` stops in `rustc_lint::levels::shallow_lint_levels_on` for 4 cases.
- Dump facts:
  - `clauses_of` 165 → `inferred_outlives_of provider` (variance-outlives-implwf);
  - `variances_of` 159 → `variances_of provider` (same lane);
  - `type_of` / `fn_sig` 138 + 135 → `Debug` of `Binder.bound_vars`. **Fixed in this lane**; then 6 + 6 →
    `EarlyParamRegion` Debug, **fixed**.
  - Left: `check_static_item` (wfcheck, 5), `check_abi` (5), `QueryKey for LitToConstInput` (5),
    `Decodable for AdtDefData` (2), `Decodable for ObjectLifetimeDefault` (1).
  - `#[rustc_dump_*]` crates (6): `outlives::dump::inferred_outlives`.
- Fidelity: every fact line the port printed matched the oracle. On minicore, 346 fact lines in 22 cases were all
  byte-identical to the oracle's, in order. On the nocore sample, 17 lines in 7 cases. Missing facts were the ones the
  patch skipped.

So, in priority order, the subject needs: **passes-a** (entry, eii, check_export), **passes-b** (check_attr,
stability), **wave 17** (check_type_wf, coherence, inherent impls, variance/outlives, check_unused), then typeck (wave 18).

## unported(...) left (all in our own code)
- `tydump_dump.ts`:
  - `rustc_passes::input_stats::print_hir_stats` (`-Zinput-stats` only);
  - `rustc_hir_analysis::outlives::dump::inferred_outlives` and `rustc_hir_analysis::variance::dump::variances` (wave 17;
    only with `#![feature(rustc_attrs)]`);
  - `dump_typeck`: `Debug of ... (tydump typeck section)` for pending types (`Rust2024IncompatiblePatInfo`,
    `(Span, hir::place::Place)`, closure_fake_reads' `(Place, FakeReadCause, HirId)`). They fire only when such a value is
    present.
- `thirdump.ts`: `rustc_mir_build::thir::print::thir_flat` / `thir_tree` (THIR building, wave 18).
- `sync/parallel.ts`: the parallel-frontend branches (`rustc_thread_pool::*`, `par_slice`), unreachable since
  `check_dyn_thread_safe()` is always `None`.

## PORT decisions
- `sync/parallel.ts`: `ParallelGuard::run` catches every thrown value except `Unported` (a missing port, which must stop at
  once with its own text) and a JS stack overflow (rustc aborts there and does not unwind). `check_dyn_thread_safe()` is
  `None` (single-threaded rust-ts; the parallel frontend already stops UNPORTED in rustc_interface util.ts).
- `passes.ts`: `DelayedLintView` is a typed view of `rustc_hir::lints::DelayedLint` (`unknown` in hir_shim.ts) with the fields
  that rustc_ast_lowering's literal carries.
- `delegation.ts`: `FxIndexMap` is a JS `Map` (insertion order).
- `tydump_dump.ts`: `FreezeLock::freeze` is a no-op (as context.ts). `par_hir_body_owners` and `par_fns` go through
  parallel.ts, so a panic in one body owner / closure is resumed after the others ran, as upstream.
- Lane scope: delegation.rs, emit_delayed_lints, parallel.rs and the map.ts/mod.ts repoints are outside "Debug impls +
  driver call sites". They are small and lie directly on the probe's path. Without them every case would stop at the
  delegation check and at `par_for_each_in`, before `entry_fn`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: ok.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4730 pass, 1 skip, 1 fail (4732 tests, 293 files).
  The fail was the Region Debug test above, which needed session globals. After the fix that file passes 17/17. The full
  run was not repeated (13 min).
