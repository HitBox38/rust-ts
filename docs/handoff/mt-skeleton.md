# Handoff: mt-skeleton (M4 wave 22): the rustc_mir_transform skeleton

Branch `lane/mt-skeleton` (from `7d76ddd0`, no merges). Commits: the crate (ported files, stub modules, provider
wiring, tests) → this handoff.

## Result
- **New crate `src/rustc_mir_transform/`**, ported whole (every fn, upstream order, markers):
  | upstream (compiler/rustc_mir_transform/src/) | fns | notes |
  |---|---|---|
  | lib.rs | 20/20 | `provide`, `PASS_NAMES` (`declare_passes!`), `remap_mir_for_const_eval_select`, `take_array`, `is_mir_available`, `mir_keys`, `mir_const_qualif`, `mir_built`, `mir_promoted`, `mir_for_ctfe` / `inner_mir_for_ctfe`, `mir_drops_elaborated_and_const_checked`, `run_analysis_to_runtime_passes`, the `run_*_passes` lists, `run_optimization_passes` (+ nested `o1`), `optimized_mir` / `inner_optimized_mir`, `promoted_mir` |
  | pass_manager.rs | 27/27 | `MirPass`, `MirLint`, `Lint`, `WithMinOptLevel`, `PassPolicy`, `PassCtx`, `should_run_pass`, `run_passes(_no_validate)`, `run_passes_inner` with the `-Zdump-mir` hooks (mir-pretty's `MirDumper`), `validate_body`, `dump_mir_for_phase_change`, `limited_by_opt_bisect`, `to_profiler_name`, `simplify_pass_type_name` |
  | simplify.rs | 32/32 | `SimplifyCfg`, `simplify_cfg`, `CfgSimplifier`, `remove_dead_blocks`, `simplify_duplicate_switch_targets`, `SimplifyLocals`, `remove_unused_definitions`, `UsedLocals`, `LocalUpdater`, `UsedInStmtLocals` |
  | trivial_const.rs | 2/2 | `trivial_const`, `trivial_const_provider` |
  | required_consts.rs | 2/2 | `RequiredConstsVisitor` |
  | sanity_check.rs | 1/1 | `SanityCheck` (calls rustc_mir_dataflow's `sanity_check`, a dataflow-impls stub) |
  | patch.rs | 18/18 | `MirPatch` |
- **Stub modules** for every other module lib.rs / pass_manager.rs reference (70 files, table below).
- **Provider wiring**: `rustc_interface/passes.ts` `default_query_providers` calls `rustc_mir_transform::provide` after
  `rustc_mir_dataflow::provide` (upstream order); the "pending crates" comment no longer lists the crate.
- Coverage: rustc_mir_transform 105/1101 (the 102 fns above + 3 `name` fns in stubs, see "Stub modules");
  TOTAL 18529/25518. `bun scripts/coverage.ts --check`: markers ok. The crate was already in coverage scope (every
  compiler crate not in `harness/scope.json` `excluded`): no tool change.

## Module layout (the contract for the other mt-* lanes)
- One TS module per upstream module at the mirrored path (`inline.rs` → `inline.ts`, `inline/cycle.rs` →
  `inline/cycle.ts`, `coroutine/mod.rs` → `coroutine/mod.ts`). Every module lib.rs or pass_manager.rs references exists
  now; lib.ts imports them all (`import * as <mod> from "./<mod>.ts"`), so **a porting lane replaces its stub module
  with the whole port and touches nothing else** (no lib.ts / pass-list edit). Modules nothing here references
  (check_pointers, cost_checker, elaborate_drop, ssa, coroutine/drop, shim/async_destructor_ctor, the other coverage/ modules, ...) are
  added by their lanes as new files.
- A stub module starts with `// Stub module (lane <lane>): <upstream path> is not ported yet.` and declares only what is
  referenced, each item under `// stub: <path>:<line> <name> (lane <lane>)`:
  - a unit-struct pass: `class X extends MirPass { readonly type_name = "rustc_mir_transform::<mod>::X"; policy(); run_pass(); }`,
    a lint: `class X extends MirLint { type_name; run_lint(); }`; the bodies are `unported("rustc_mir_transform::<mod>::X (pass not ported)")`;
  - a pass enum (`AddCallGuards`, `DeadStoreElimination`, `InstSimplify`, `SimplifyConstCondition`): the class with one
    frozen instance per variant. Their `name()` fns are **ported** in the stubs (dead_store_elimination.rs:144,
    instsimplify.rs:23, simplify_branches.rs:16; `AddCallGuards` uses the provided name): `PASS_NAMES` is a `LazyLock`
    forced by every `run_passes` call (`named_passes.difference(&*PASS_NAMES)`), so these names must work. Keep them.
  - free fns / providers with their final signature (`find_noop_landing_pads_for_instance`, `has_impossible_clauses`,
    `mir_coroutine_witnesses`, `coroutine_by_move_body_def_id`, `mir_callgraph_cyclic`, `mir_inliner_callees`,
    `deduced_param_attrs`, `check_liveness`, `build_adt_ctor`, `build_drop_shim`, `lint_body`,
    `lint_tail_expr_drop_order::run_lint`, `ForceInline::should_run_pass_for_callee`); the stub `provide`s
    (coverage/query, ffi_unwind_calls, shim, cross_crate_inline) set nothing, so their queries keep rustc_interface's
    `unported("<query> provider (not ported)")` providers.
  - `PromoteTemps` (with its derived `Default`: `new PromoteTemps([])`, field `promoted_fragments: Body[]`) and
    `Validator` (field `when`) keep their fields.
- Conventions (pass_manager.ts header): `MirPass` / `MirLint` are abstract classes (precedent mir/visit.ts, D4); a pass
  `extends MirPass` and overrides `policy` / `run_pass` (and `name` / `is_mir_dump_enabled` when upstream does);
  `std::any::type_name::<Self>()` is the abstract `type_name` property (the upstream path); `&Unit` in a pass list is
  `new Unit()`, `Enum::Variant` is `Enum.Variant`; `Lint(x)` is `new Lint(x)`, `WithMinOptLevel(1, x)` is
  `new WithMinOptLevel(1, x)`. `crate::MirPass` / `crate::PassPolicy` / `crate::PassCtx` are imported from
  `./pass_manager.ts`, never from lib.ts.
- **Init order** (TDZ-free): pass_manager.ts defines `MirPass` / `MirLint` and imports no pass module and not lib.ts
  (`crate::PASS_NAMES`, `crate::validate`, `crate::lint` are `require`d inside the fns that use them); every pass
  module imports `./pass_manager.ts`; lib.ts imports pass_manager.ts first. Pass modules must not import lib.ts.
  Like the rest of the driver, the crate expects rustc_session to be loaded first: `rustc_session/config.ts` is not a
  fresh entry point at base (Polonius TDZ), so a test that enters the crate imports `../rustc_session/lib.ts` first.
- `src/rustc_mir_transform/pass_manager.test.ts` "module layout" checks that every module mirrors an upstream file and
  counts the stub modules (70): **lower the count as you replace stubs.**

### Stub modules per lane
| lane | stub modules (src/rustc_mir_transform/) |
|---|---|
| mt-built-lints | lint_and_remove_uninhabited, check_inline, check_call_recursion, check_packed_ref, check_const_item_mutation, check_mut_restriction, function_item_references, ffi_unwind_calls, lint_tail_expr_drop_order (+ generated diagnostics: pass_manager.ts's two `UnknownPassName` / `ValidPassNames` stops) |
| mt-promote | promote_consts, post_drop_elaboration (+ lib.ts's two rustc_const_eval check_consts stops) |
| mt-liveness | liveness |
| mt-cleanup | impossible_clauses, cleanup_post_borrowck, remove_noop_landing_pads, deref_separator, remove_uninit_drops, add_call_guards, post_analysis_normalize, add_subtyping_projections, abort_unwinding_calls, add_moves_for_packed_drops, erase_deref_temps, elaborate_box_derefs, lower_intrinsics, remove_place_mention, ctfe_limit, mentioned_items |
| mt-drops | elaborate_drops |
| mt-shim | shim |
| mt-coroutine-a / -b | coroutine/mod, coroutine/by_move_body / coroutine/layout |
| mt-kpl-ubchecks | known_panics_lint, check_alignment, check_null, check_enums |
| mt-opt1 | remove_storage_markers, remove_zsts, remove_unneeded_drops, multiple_return_terminators, simplify_branches, lower_slice_len, strip_debuginfo, prettify, instsimplify, unreachable_enum_branching, single_use_consts, copy_prop |
| mt-inline | inline, inline/cycle, cross_crate_inline |
| mt-opt2 | unreachable_prop, ref_prop, sroa, dead_store_elimination, gvn, ssa_range_prop, match_branches, dataflow_const_prop, jump_threading, early_otherwise_branch, simplify_comparison_integral, dest_prop, tail_copy_to_move, deduce_param_attrs |
| mt-validate | validate, lint |
| mt-coverage | coverage/mod, coverage/query |

## For root: what blocks the MIR paths now
- `mir_built`: `build_mir_inner_impl` (the builder lanes), then `trivial_const` (fns return at the `def_kind` match;
  consts call `has_impossible_clauses`), then the pass list: the first stop is `LintAndRemoveUninhabited` (mt-built-lints).
- **`trivial_const` of a const stops at `impossible_clauses::has_impossible_clauses`** (plan-m4: lane mt-cleanup, wave
  24). The trivial-const path is also the shortcut of `eval_to_allocation_raw` (wave 23b) and of `is_trivial_const` in
  `mir_borrowck`: consider moving impossible_clauses.rs (121 lines, 4 fns) to an earlier lane (e.g. mt-built-lints or
  ctfe-a).
- `mir_promoted`: `mir_const_qualif` for const fns / consts (rustc_const_eval check_consts: mt-promote / const-check),
  `has_ffi_unwind_calls` (mt-built-lints), `PromoteTemps` (mt-promote), `InstrumentCoverage` (mt-coverage; its
  `policy` is reached for every body), `lint_tail_expr_drop_order::run_lint` (mt-built-lints).
- **`mir_drops_elaborated_and_const_checked`** (needed by `mir_for_ctfe` / `optimized_mir` and by analysis for const
  contexts and `should_codegen()`): after `mir_borrowck` it asks `should_run_pass(&inline::Inline, ..)` for every fn-like
  body, i.e. `Inline::policy` (mt-inline, wave 25), then `check_liveness` (mt-liveness). The borrowck-ui run-pass cases
  (M4b) will stop at `Inline` unless its `policy` (and `ForceInline::should_run_pass_for_callee`) land earlier.
- mirdump-minicore: the 6 `mir_keys provider (not ported)` cases now MATCH (their crates have no MIR bodies).

## PORT decisions (please record)
1. `MirPass` / `MirLint` are abstract classes; the provided methods are base-class methods; `type_name` is the abstract
   property standing for `std::any::type_name::<Self>()` (the upstream path; generic adapters compose it, e.g.
   `rustc_mir_transform::pass_manager::Lint<..>`).
2. Pass enums (`SimplifyCfg`, `SimplifyLocals`, and the stubbed `AddCallGuards`, `DeadStoreElimination`, `InstSimplify`,
   `SimplifyConstCondition`) are classes with one frozen instance per variant tagged `$` (`SimplifyCfg.Initial`); the
   `pub use self::AddCallGuards::*` re-export is `export const CriticalCallEdges = AddCallGuards.CriticalCallEdges`.
3. `declare_passes!` / `pass_names!` are expanded by hand: lib.ts `declared_passes()` lists the macro's arguments in
   order; `PASS_NAMES()` is the `LazyLock` (an insertion-ordered `Set`).
4. `impl SimplifyCfg { fn name }` and `impl MirPass for SimplifyCfg { fn name { self.name() } }` are one method carrying
   both markers.
5. `MirPatch`'s methods that clash with fields are `resume_block_()`, `unreachable_cleanup_block_()`,
   `unreachable_no_cleanup_block_()`, `terminate_block_()` (mir-contract decision 2). `source_info_for_index` returns a
   copy (`clone_SourceInfo`), `apply` copies a queued `Location` before shifting it.
6. `take_array::<T, N>` takes `N` as a parameter; `&mut Box<[T]>` is a `MutRef<T[]>` (`field_mut(kind, "args")`).
7. `std::mem::take` of `after_last_stmt_debuginfos` stores `new StmtDebugInfos(undefined)` (its `Default`).
8. `LocalUpdater`'s `tcx` field is `tcx_` (the base class's abstract `tcx()` returns it).
9. `tcx.sess.prof.enabled()` is read as `prof.profiler !== undefined` (the session's `SelfProfilerRef` stand-in has no
   `enabled`); with a profiler (`-Z self-profile`) the pass manager stops UNPORTED.
10. Capacity-only calls (`shrink_to_fit`, `reserve`) are comments; `as_mut_preserves_cfg()` is still called where upstream
    calls it (no cache effect).
11. The `#[cfg(debug_assertions)]` check of `run_passes_inner` is a comment (rustc ships without debug assertions).

## `unported(...)` left (lane files)
- lib.ts: `rustc_const_eval::check_consts::ConstCx::new (mir_const_qualif; ...)` (the rest of `mir_const_qualif` is kept
  as a comment), `rustc_const_eval::check_consts::post_drop_elaboration::checking_enabled` (local stand-in fn
  `checking_enabled_ConstCx_new`, the pass list under it is ported).
- pass_manager.ts: `rustc_mir_transform::diagnostics::UnknownPassName` / `ValidPassNames` (generated diagnostics, lane
  mt-built-lints; only with unknown `-Zmir-enable-passes` names), `SelfProfilerRef::generic_activity_with_arg`
  (`-Z self-profile`).
- Reached through other crates' stubs: rustc_mir_dataflow `sanity_check` (SanityCheck) and `debuginfo_locals`
  (SimplifyLocals / UsedLocals), both lane dataflow-impls / dataflow-move-paths.
- Every stub module item (table above).

## Tests (`bun test src/rustc_mir_transform`: 19 pass)
- `simplify.test.ts` (oracle): fixtures `simplify_oracle/simple.rs` (no_core: `f` = if/else, `g` = statements after
  `return`, `h` = loop with a cleanup block) and `simplify_oracle/dump/` = the pinned nightly's
  `-Zdump-mir=SimplifyCfg-initial` files (`REGEN=1` rewrites them). Each test hand-builds the body SimplifyCfg-initial
  sees, runs `run_passes` with seven no-op passes (for `mir_built`'s first seven), `SimplifyCfg::Initial` and a no-op
  lint, under `-Zdump-mir=SimplifyCfg-initial`, and compares the files the pass manager wrote (names
  `simple.<f>.1-1-007.SimplifyCfg-initial.{before,after}.mir` and text) with the oracle's: 3/3 byte-identical (goto
  chains, merging, dead blocks, the loop, the cleanup block, pass numbering).
- `pass_manager.test.ts`: `simplify_pass_type_name` doc examples; `name` / `profiler_name` of passes, enums and
  adapters; **`PASS_NAMES` sorted == the oracle's "valid MIR pass names" note** (`simplify_oracle/pass_names.txt`,
  `REGEN=1`); `should_run_pass` (defaults, `-Zmir-enable-passes` overrides, last wins, `Required`), `WithMinOptLevel`
  gating and its `bug!` on a required pass; `run_passes` (order, skipped passes, pass counts, phase change, the invalid
  phase-transition panic text, `injection_phase` skip, the unknown-name stop); `MirPatch` (documented statement order,
  `Nop`s, new and cached blocks, `Unreachable` patches clear statements); `RequiredConstsVisitor` (reachable blocks only,
  values skipped); `trivial_const` (fns: no body built; consts: the `has_impossible_clauses` stop); `provide` /
  `mir_keys` (global_asm removed, `CtorKind::Fn` ctors added, order); the module-layout contract (70 stubs).
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: see "Checks".

## Samples (lane vs root's base runs; `RUST_TS_AGENT=root-ad4b`, compared case by case)
| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| mirdump-minicore (46) | `20261022-105212-root-ad4b-rqyj` | 16 / 0 / 30 / 0 | `20261022-101711-root-ad4b-xljd` | 10 / 0 / 36 / 0 |
| tydump-minicore (46) | `20261022-105302-root-ad4b-4g0c` | 45 / 0 / 1 / 0 | `20261022-101651-root-ad4b-9r7y` | 45 / 0 / 1 / 0 |
| tydump-ui `--sample 300` | `20261022-105339-root-ad4b-62ft` | 263 / 0 / 36 / 0 (+1 unstable) | `20261022-101731-root-ad4b-hqwm` | same |
| hir-tree `--sample 200` | `20261022-110433-root-ad4b-xsy2` | 200 / 0 / 0 / 0 | (0 DIFF) | |

No new DIFF. mirdump-minicore: +6 MATCH (the six `mir_keys provider (not ported)` cases), the other 40 cases have the
same status and stop. tydump-minicore and tydump-ui: every case has the same status and stop.

## Shared files edited (review)
- `src/rustc_interface/passes.ts`: import + `rustc_mir_transform_provide(providers)` in `default_query_providers`, the
  pending-crates comment.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (19100; vendor 4196).
- `RUST_TS_AGENT=mt-skeleton RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (once, at `f0cbc925`): 5797 pass,
  1 skip, 0 fail (5798 tests, 399 files; 4022 s on the loaded machine). A first attempt was killed from outside mid-run
  (exit 144) and rerun.
