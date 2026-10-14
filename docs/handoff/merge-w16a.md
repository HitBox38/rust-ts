# Handoff: merge-w16a (wave 16 integration)

Branch `integ` (worktree `.data/integ`), from `00ce463` (merge-w15b). Every lane was merged with `git merge --no-ff`,
after reading its handoff on its branch, followed by a fixer commit.

## Merge order
1. infcx-contract, evalctxt-contract, hirtylowerer-contract, ty-utils.
2. nts-eval, nts-canonical.
3. collect-a, collect-b, collect-rbv. hira-misc (root's request) followed them.
4. hir-ty-lowering-a, -b, -c, -d.
5. Root's later requests:
   - wrong-num-args (after -c);
   - nts-trait-goals;
   - repr-options (after collect-a);
   - nts-normalizes;
   - nts-assembly (last).

So every rustc_next_trait_solver lane is in.

## Conflicts
- `tools/codegen/types.sets.json` (hirtylowerer-contract, ty-utils): every lane appended a set. All sets are kept
  (`rustc_infer`, `rustc_hir_analysis`, `rustc_ty_utils`).
- `tools/codegen/diag_args.json` (ty-utils vs hirtylowerer-contract): both added `rustc_middle::ty::Ty`. They are merged
  into one entry (both paths + `display_Ty`). ty-utils' `GenericArg` entry is kept.
- `hir_ty_lowering/mod.ts`: lanes -a and -b each had an import block, and the two duplicated each other (tsc
  `Duplicate identifier`). They are now one deduplicated block; `BoundVar` comes from `rustc_type_ir/lib.ts`, not
  `lib.gen.ts`.
- No other textual conflicts.

## Repoints (stand-ins → real ports; one implementation and one marker per upstream fn)
- **infcx-contract `ir_` renames.** All 15 `PORT(merge)` sites (nts-eval 9, nts-canonical 6) now call `ir_<name>`, and
  the markers are gone. nts_canonical.test.ts's fake infcx keys are renamed too.
- **delegate.ts.** `make_deduplicated_region_constraints` returns predicate.ts's `RegionConstraint` (`ty::RegionConstraint`,
  delegate.rs:75). The cast in eval_ctxt/mod.ts is gone.
- **hir_analysis decls.ts.**
  - `InferCtxt` and `SolverRegionConstraint` are re-exported from rustc_infer.
  - collect-rbv's `ResolvedArg` / `ObjectLifetimeDefault` / `ResolveBoundVars` re-exports are adopted, without the
    PORT(decls) marker.
- **ResolvedArg.**
  - context.ts's `PendingEnum` alias is now the real type.
  - Gone: mod.ts's `ResolvedArgShape` (-a), `RbvResolvedArg` and `debug_opt_resolved_arg` (-b; the real
    `debug_ResolvedArg` is used now), generics_of.ts's tag-match cast and dump.ts's `ObjectLifetimeDefault_` view.
- **hir_ty_lowering.**
  - errors.ts's `AssocItemQSelf_to_string` / `LowerTypeRelativePathMode_def_kind_for_diagnostics` now call -a's
    companions.
  - mod.ts's `AmbiguityBetweenVariantAndAssocItem_diagnostic_pending` now calls -d's `AmbiguityBetweenVariantAndAssocItem_diagnostic`.
  - `probe_traits_that_match_assoc_ty` builds the real `InferCtxt`, and its closure is ported (it now stops at
    rustc_infer's `InferCtxt::fresh_args_for_item` placeholder).
  - `transitive_bounds_that_define_assoc_item` calls the rustc_infer stub fn.
- **collect.ts (collect-a "For root" 4).**
  - `lower_test_binder_constraint` builds `RegionConstraint` (rustc_type_ir), all arms.
  - `recover_infer_ret_ty` builds the `InferCtxt`.
  - `suggest_impl_trait`'s candidate loop still stops, now with "ObligationCtxt pending: wave 17".
- **ty-utils.** `tcx.infer_ctxt()` is real in ty.ts and structural_match.ts. `ObligationCtxt` and
  `normalize_param_env_or_error` stay as wave-17 stand-ins.
- **collect_*_late_bound_regions** return `KeyedSet<BoundRegionKind>` in rustc_middle ty/decls.ts and ty/visit.ts. The casts
  in mod.ts, bounds.ts and dyn_trait.ts are gone.
- **hira-misc.**
  - clauses_of.ts calls `setup_constraining_clauses(.., parameters_for_impl(..))` and `inherit_clauses_for_delegation_item`.
  - The two delegation providers are installed in lib.ts.
  - `trait_ref_and_own_args_for_alias` (impl_interner.ts) is filled with `TraitRef.from_assoc`, and collect_b.test.ts's
    stand-in for it is gone.
- **wrong-num-args.** `check_generic_arg_count` builds `GenericArgsInfo` and emits `WrongNumberOfGenericArgs`, using the
  handoff's exact code. wrong_num_oracle/run.ts drops its `generics_of` / `trait_def` / `check_generic_arg_count`
  stand-ins and calls the real fn over an `ItemCtxt`. 21/21 cases are still byte-identical to the oracle.
- **repr-options.** collect.ts's `ReprOptions_{discr_type,c}` / `Size_*_int_*` and type_of.ts's `ReprOptions_discr_type`
  stand-ins now call rustc_abi.
- **Decision: where the trait-method markers live.** The `HirTyLowerer` / `GenericArgsLowerer` markers stay in
  hir-ty-lowering-a's `declare module "../decls.ts"` block in hir_ty_lowering/mod.ts. It restates the decls.ts members
  with identical signatures, in upstream order. It is no longer marked PORT(decls); it is a PORT note. decls.ts is
  unchanged.

## Codegen / tools
- **typemap.lint.json.** `rustc_middle::ty::Ty` maps to the real `Ty`, as tyir.typemap.json does (it was `unknown`).
  queries.config.json gains a `display` entry for it.
  - queries.gen.ts now has 6 more descs (`check_representability_adt_ty`, `erase_and_anonymize_regions_ty`,
    `supertrait_vtable_slot`, `has_structural_eq_impl`, `inhabited_predicate_type`, ...) and typed `Ty` keys/values.
  - ty-utils' E0072 test is switched to the oracle comparison (`EXPECT_ORACLE`); all 6 rec cases are byte-identical.
- **New generator option `diag_args_skip`** (types.ts SetConfig, 1 line of logic), used by set `rustc_middle_diagnostics`
  for `rustc_middle::ty::Ty`.
  - Why: rustc_middle/ty/mod.ts imports `rustc_middle/diagnostics.gen.ts`. With the merged `Ty` diag-arg entry, that
    `.gen.ts` imported `ty/diagnostics.ts` / `ty/print/pretty.ts`, and `rustc_middle/lib.ts` no longer loaded (TDZ on
    `fold_Term`, then `Ty`).
  - Those 5 diagnostics keep `unported_into_diag_arg` for `Ty`. rustc_lint / rustc_passes / rustc_ty_utils get the real
    `Ty_into_diag_arg`.
- **stable_hash.json.** `rustc_abi::Align` → `stable_hash_u8($v.pow2, ..)` (repr-options' request). attr_ir's
  `ReprPacked` / `ReprAlign` / `RustcAlign` and one query's `stable_hash_value` now hash.
- **Regeneration.** All 33 sets plus queries.ts were regenerated. The diffs are only those above (lint/middle/passes/ty_utils
  diagnostics, attr_ir stable hash, queries.gen.ts).
- No new probes. rustc-dev oracles live in test dirs, and `bun scripts/probes.ts build` was not needed.

## Tests re-pinned (PENDING texts, no matching case weakened)
- **rustc_next_trait_solver.**
  - contract.test.ts: there are no stubs left, so the "stub stops as UNPORTED" example is dropped.
  - nts_trait_goals: `Sized(u8)` and auto-trait-on-tuple are now real assertions (Yes; one `ImplWhereBound` goal per
    element). The `compute_trait_goal` pin is retired: it needs a real `SolverDelegate`, wave 17.
  - nts_normalizes: the Fn-candidate test asserts `NoSolution`. The destruct / `compute_host_effect_goal` pins are retired:
    they need real queries and a delegate.
- **rustc_hir_analysis.**
  - contract test 10: 40 providers.
  - hira_misc: `delegation_user_specified_args` returns `[[], []]`.
  - lowering_c: the E0107 pins are removed; E0107 is now compared end to end by wrong_num_oracle.
  - lower_ty.test.ts: runs through `ItemCtxt`. The lane-a mock and the "without the mock" test are deleted (-b's handoff).
    The once-PENDING P0/P1/P3/P5/P6 aliases are now compared with the tydump probe; P2/P4/P7 stay pinned.
  - mod_a: the fixture is regenerated. The runner reports `PANIC` lines for fabricated inputs, and the `AssocFn` case now
    passes `Tr::f` instead of `Tr`. The runner exits 1, because real E0220/E0223/E0109 are emitted.
  - collect_test: regenerated. 69 / 39 facts match the probe (was 51 / 22).
  - collect_b queries: the runner skips `clauses_of` where the probe does (crate root, lifetime params). The new PENDING
    stops are `inferred_outlives_of provider (not ported)` and an `unported_debug` of an assoc type's
    `explicit_item_bounds` value.
  - rbv `err_anon` moves to the oracle cases (E0658 byte-identical).
- **rustc_ty_utils.** The ty_test fixture is regenerated: `nested_bodies_within(g)`, `opaque_types_defined_by` and
  `assumed_wf_types` now complete.

## Results
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: `markers ok (13335; vendor 3888)`.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4731 pass, 1 skip (pre-existing linux-only), 0 fail (4732 tests, 293 files).
- Coverage: TOTAL 12816/25518 (50.22%). rustc_next_trait_solver 425/425 (every file `--missing` 0),
  rustc_hir_analysis 434/799, rustc_infer 98/644, rustc_ty_utils 70/123, rustc_abi 102/273.
- **Samples, `--seed m16`.** Main was run read-only at fe3254c. The integ base is 00ce463, which main has not merged yet.

  | suite | integ | main |
  |---|---|---|
  | parse --sample 200 | 200 MATCH | 200 MATCH |
  | expanded --sample 200 | 200 MATCH | 200 MATCH |
  | unpretty-hir --sample 200 | 200 MATCH | 199 MATCH, 1 UNPORTED |
  | hir-tree-nocore --sample 300 | 299 MATCH, 1 UNPORTED | 298 MATCH, 2 UNPORTED |

  - All four suites have 0 DIFF / 0 CRASH, and there are no new UNPORTED.
  - integ's one UNPORTED is `macros/auxiliary/hello_macro.rs` (proc-macro `quote!`, M6), which main has too.
  - `transmutability/unions/repr/should_handle_packed.rs` was UNPORTED on main (StableHash) and now MATCHes (the `Align` entry).
- **`hir-tree-nocore --filter delegation/`.** 36 MATCH / 108 UNPORTED, the same as base 00ce463. The stop moved from
  `fn_sig provider (not ported)` to rustc_ast_lowering's own stand-in
  `delegation/resolution.ts fn_sig_skip_binders` ("skip_binder of `tcx.fn_sig(..)` (ty::FnSig, wave 15)"). `fn_sig` itself
  now runs. **For root:** repointing that ast_lowering stand-in (lane lower-delegation's) is the next step for these
  108 cases. It is not done here: it is outside this merge's lanes, and it changes a suite's output.
- **`tydump-nocore --sample 100`.** 9 MATCH / 91 UNPORTED, identical to base. All 91 stop at
  `rust_ts::tydump::prefix::run_required_analyses_prefix` (the subject is a stub), so it gets no further.

## `unported(..)` / stand-ins left (all documented in their files)
- **Wave 17, rustc_trait_selection.**
  - ty_utils: `ObligationCtxt`, `normalize_param_env_or_error`.
  - collect.ts: `NextTypeParamName`, `hir_ty_lowering_dyn_compatibility_violations`, the `suggest_impl_trait` loop.
  - errors.ts: `FulfillmentError`, `dyn_compatibility_violations_for_assoc_item`, `report_dyn_incompatibility`.
  - dyn_trait.ts: `expand_trait_aliases` & co.
  - opaque.ts: `report_item_does_not_constrain_error`.
- **Wave 17, check.**
  - mod.ts: the `check_abi` stand-in.
  - type_of.ts: `check_static_item`.
  - collect.ts: `TestBinder*`.
  - `inferred_outlives_of` (outlives/).
- **rustc_infer.** Every non-contract `InferCtxt` method is still a placeholder (the five infer-* lanes).
- **Codegen.**
  - `TraitRefPrint*` TypeFoldable (errors.ts);
  - `fold_AsyncCallableRelevantTypes`, `debug_CandidateHeadUsages` and `Elaboratable_Predicate` (solver);
  - assembly's `Goal` Debug for the "unexpected self type" panics;
  - `ParamEnv` TypeFoldable/Visitable (nts-canonical "For root" 3);
  - `QueryResponse` in middle_traits_thir.typemap.json.
- **M4.** cmse.ts layout stand-ins; `GlobalCtxt.data_layout`.
- **Other.**
  - `TransitiveRelationBuilder` (solver_region_constraints.ts);
  - `lit_to_const`'s `LitToConstInput` QueryKey;
  - `erase_and_anonymize_regions` (rustc_middle);
  - `typeck_results.ts`'s `hidden_types` Pending (collect-a "For root" 2);
  - `rustc_middle/lib.ts` `export * as resolve_bound_vars` (collect-rbv "For root" 5, not done).

## PORT decisions to record
- The decisions in each lane's handoff:
  - infcx-contract 1-7, evalctxt-contract 1-10, hirtylowerer-contract 1-6;
  - ty-utils 1-9, nts-eval 1-12, nts-canonical 1-11;
  - collect-a 1-8, collect-b 1-8, collect-rbv 1-8, hira-misc 1-8;
  - hir-ty-lowering-a 1-9, -b 1-6, -c 1-10, -d 1-10;
  - wrong-num-args 1-8, nts-trait-goals 1-9, nts-normalizes 1-7, nts-assembly 1-9, repr-options 1-6.
- Adopted lane proposals: add lane hir-ty-lowering-d (hirtylowerer-contract); `sig_types.rs` → `rustc_ty_walk/lib.ts`
  (ty-utils).
- merge-w16a's own:
  1. The `HirTyLowerer` / `GenericArgsLowerer` trait-method markers stay in hir_ty_lowering/mod.ts's
     `declare module "../decls.ts"` block.
  2. The codegen option `diag_args_skip` exists for init order. `rustc_middle_diagnostics` skips `Ty`.
  3. `rustc_middle::ty::Ty` is typed in typemap.lint.json and displayed in query descs.
  4. `collect_*_late_bound_regions` return `KeyedSet`.
  5. Test runners report ICEs of fabricated inputs as `PANIC` lines (mod_a). collect_b's runner mirrors the probe's
     per-DefKind dump set.
