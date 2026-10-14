# Handoff: nts-trait-goals (wave 16, M3): rustc_next_trait_solver solve/trait_goals.rs

Branch `lane/nts-trait-goals` (from aa18d24, evalctxt-contract; no merges). Commits: the port; unit tests; this handoff.

## Files touched
- `src/rustc_next_trait_solver/solve/trait_goals.ts`: every fn of trait_goals.rs, in upstream order, with markers:
  - the `GoalKind_TraitClause` table: all 32 impl fns;
  - the nested fn `trait_def_id_matches`, inside `fast_reject_assumption`;
  - `trait_predicate_with_def_id`;
  - the 15 `EvalCtxt` methods (unsize/upcast helpers, auto-trait helpers, candidate merging, `compute_trait_goal`,
    `try_stall_coroutine`). The `unported_methods` call is gone.
- New test file `src/rustc_next_trait_solver/nts_trait_goals.test.ts` (19 tests).
- decls.ts, contract.test.ts and the other lanes' files are untouched.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_next_trait_solver/src/solve/trait_goals.rs`: **48/48 ported**.
- `bun scripts/coverage.ts --check`: `markers ok (12359; vendor 3888)`.

## Checks
- `bunx tsc --noEmit -p .` is clean.
- `bun test src/rustc_next_trait_solver`: 25 pass (contract 6 + this lane 19).
- Full `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Full test run" below.
- No sample difftest was run. Nothing outside the crate imports the solver until wave 17 (trait-sel-solve), so a sample
  would only re-run untouched code (same reasoning as evalctxt-contract and nts-eval).

## Unit tests
The tests use real interned types (`TyCtxt` over fresh `CtxtInterners`, nts-eval's fixture) and a fake `EvalCtxt`.
- **The fake.** It is `Object.create(EvalCtxt.prototype)` with recording fakes for the other lanes' methods: the probes,
  `evaluate_added_goals_and_make_canonical_response`, `forced_ambiguity`, `add_goal(s)`, `enter_forall_with_assumptions`,
  `try_merge_candidates`, `bail_with_ambiguity` and `filter_specialized_impls`.
- **Faked interner queries.** The few queries a test needs are faked on the `TyCtxt` instance: `ir_for_each_relevant_impl`,
  `is_default_trait`, `trait_is_marker`, and so on.
- **What the tests cover:**
  - the accessors and `trait_predicate_with_def_id`;
  - every builtin candidate rejects negative goals (unsize returns `Ok([])`);
  - `Tuple` holds for `()` and `(u8, bool)` but not for `u8`;
  - `Pointee`, `DiscriminantKind` and `Destruct` hold;
  - `FnPtr` in both polarities;
  - the coroutine-only traits reject `u8`;
  - `AsyncFnKindHelper` over the `i8` / `i16` / `i32` closure-kind encoding, including the upstream `panic!()`;
  - `probe_and_evaluate_goal_for_constituent_tys` adds one `ImplWhereBound` goal per constituent, with the self type
    replaced;
  - `disqualify_auto_trait_candidate_due_to_possible_impl`: a rigid type without an impl, a rigid type with an impl,
    `{integer}` gives ambiguity, and `?0t` panics with `` unexpected type `?0t` ``;
  - `try_stall_coroutine` in `Typeck` and in `PostAnalysis`;
  - `merge_trait_candidates`: empty, trivial builtin preference plus the upstream assertion text, non-global
    where-bound extraction with `AlwaysApplicable` head-usage ignoring, one or two impls, and coherence.
- **PENDING.** Each of these is asserted to stop as UNPORTED with the exact stub text:
  - `Sized` of `u8` stops at `rustc_next_trait_solver::solve::assembly::structural_traits::instantiate_constituent_tys_for_sizedness_trait`
    (nts-assembly);
  - an auto trait on `(u8, bool)` stops at `...::structural_traits::instantiate_constituent_tys_for_auto_trait` (nts-assembly);
  - `compute_trait_goal` stops at `rustc_next_trait_solver::solve::assembly::EvalCtxt::assemble_and_evaluate_candidates`
    (nts-assembly).
  - Once nts-eval, nts-canonical and nts-assembly have merged, an oracle probe should drive real trait goals
    end to end.

## `unported(...)` left
None in this file. Its calls into other lanes' stubs stop there until those lanes merge:
- **nts-assembly:**
  - structural_traits.rs: the `instantiate_constituent_tys_*` fns and both `extract_tupled_inputs_and_output_*`;
  - the `fold_AsyncCallableRelevantTypes` codegen stand-in;
  - `GoalKind_provided.*`, `assemble_and_evaluate_candidates`, `forced_ambiguity` and `filter_specialized_impls`.
- **nts-eval:** the probes, `eq`, `add_goal(s)`, `instantiate_binder_with_infer`, `enter_forall_with_assumptions`, and so on.
- **nts-normalizes:** `has_only_region_constraints`, `try_merge_candidates`, `bail_with_ambiguity` and
  `structurally_normalize_*` (solve/mod.rs).
- **rustc_middle:** `TyCtxt.supertrait_def_ids` is still unported (impl_interner.ts, elaborate.rs).

## infcx-contract `ir_` renames
- trait_goals.rs calls none of the 8 renamed `InferCtxtLike` methods directly. `fresh_args_for_item` is the
  `EvalCtxt` method, not the infcx one.
- So no `// PORT(merge)` markers were needed.

## PORT decisions (please record)
1. **D3, `cx`.** `cx` is `TyCtxt`, as in nts-eval decision 5.
   - `Interner` trait calls go through predicate.ts's `as_interner(cx)`. That includes calls `TyCtxt` also types:
     upstream dispatches them all through `I: Interner`.
   - `UpcastFrom` impls over `TyCtxt` are cast for `Goal::new` / `Goal::with` by a module-local `upcast_tcx`.
2. **`?` conversions.**
   - `Err(NoSolution.into())` is `Err(NoSolution_into)`, a frozen `{ $: "NoSolution", _0: {} }`.
   - Other `?` conversions use `NoSolutionOrRerunNonErased.from_NoSolution` / `.from_RerunNonErased`.
3. **Lazy iterator chains** passed as `impl IntoIterator` (`add_goals`, `probe_and_consider_implied_clause`) are
   generators.
   - `iter_instantiated` over the `Interner`'s `EarlyBinder<Iterable<Clause>>` first collects the items with
     `Array.from`, because binder.ts's version takes a slice. This is a module-local helper.
4. **`Vec::extend(Result)`** in `consider_builtin_dyn_upcast_candidates` pushes only the `Ok` value. An `Err`, including
   `RerunNonErased`, is dropped, as upstream does.
5. **Shadowed bindings.** Upstream shadows `impl_trait_ref`, `goal`, `target_projection` and `target_principal`. These
   are renamed with `_` / numeric suffixes, because a JS `const` cannot read the binding it shadows (TDZ).
6. **Collections.**
   - `IndexSet<I::TraitId>` (`a_auto_traits`) is a `DefIdSet`; only `contains` is used.
   - `Vec::retain` / `extract_if` are in-place module-local helpers that keep order.
   - The lazy `filter` over trivial builtin candidates is advanced at most twice, as upstream (`findIndex` twice).
7. **D4 descriptors.**
   - `TraitClause` and `Goal<TraitClause>` descriptors are module-local, built from the generated fns.
   - Relations use `relate_TraitRef`, `relate_Ty`, `relate_ExistentialTraitRef` and `relate_ExistentialProjection`.
   - Binders use `fold_Binder(..)`.
8. **Tracing.** `#[instrument]`, `trace!`, `debug!` and `debug_assert!` are comments.
9. **Panic texts** are upstream's: `` unexpected type `{ty:?}` ``, `unexpected infer {a:?} {b:?}`, `explicit panic`,
   the `unreachable!` typing-mode message, and `assertion failed: trivial_builtin_impls.next().is_none()`.

## For root
1. **Stale contract-test example.** nts-eval moved contract.test.ts's "a stub stops as UNPORTED" example from
   `EvalCtxt::cx` to `compute_trait_goal`. This lane ports `compute_trait_goal`, so after merging both, re-pin the
   example to a method that is still a stub.
   - My base still has the `cx` example, so nothing is stale on this branch.
2. Root should record the decisions above.

## Full test run
`RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4513 pass, 1 skip (the pre-existing linux-only one), 0 fail (4514 tests, 272 files).
