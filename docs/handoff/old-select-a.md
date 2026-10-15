# Handoff: old-select-a (M3 wave 18c, old trait solver)

Branch `lane/old-select-a`, from `integ` 60a45cf, no merges. Commits: d0de29a (port), a087dde (tests + re-pin), this
handoff.

## Result
- `compiler/rustc_trait_selection/src/traits/select/mod.rs` lines 205..1709 -> `src/rustc_trait_selection/traits/select/mod.ts`:
  all 28 `SelectionContext` methods `poly_select` .. `match_projection_projections` ported in upstream order with markers
  (decls.ts group "mod.rs:180"; signatures unchanged, no `declare module` overrides). Their names are removed from the
  `unported_methods` list (only lane old-select-b's 17 remain there).
- Selection entry: `poly_select`, `select`, `select_from_obligation`, `candidate_from_obligation(_no_cache)`.
  Evaluation: `evaluate_root_obligation`, `evaluation_probe`, `evaluate_predicates_recursively`,
  `evaluate_predicate_recursively` (all `PredicateKind` arms incl. WF coinduction, projection cache completion,
  ConstEquate/ConstArgHasType), `evaluate_trait_predicate_recursively` (global/provisional caches, cycle handling, the
  #103563 renormalization retry), `check_evaluation_cycle`, `evaluate_stack`, `coinductive_match`, `evaluate_candidate`.
  Caches: `check/insert_evaluation_cache`, `can_use_global_caches`, `check/insert_candidate_cache`,
  `can_cache_candidate`. Helpers: `check_recursion_depth/limit`, `in_task`, `filter_impls`, `for_each_item_bound`,
  `match_normalize_trait_ref`, `where_clause_may_apply`, `match_projection_projections`.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_trait_selection/src/traits/select/mod.rs`: 50/67 (was 22/67); the 17
  missing are exactly lane old-select-b's (`winnow_candidates` .. `should_stall_coroutine`, mod.rs:1716..2782).
- rustc_trait_selection 406/976. `bun scripts/coverage.ts --check`: markers ok.

## Checks
- `bunx tsc --noEmit -p .` clean.
- `bun test src/rustc_trait_selection src/rustc_infer --timeout=60000`: 140 pass, 0 fail.
- Samples, lane vs base 60a45cf (same args; base = this worktree before the first commit):
  - tydump-minicore (46): 14 MATCH / 0 DIFF / 32 UNPORTED both (base run 20261015-090131-old-select-a-base-txhc, lane
    20261015-090957-old-select-a-z73g). Top stop moved: 24x `SelectionContext::poly_select` -> 24x
    `SelectionContext::push_stack` (lane old-select-b); rest unchanged (6x `ConstraintCategory (mir, M4)`, 1x `mk_pat`,
    1x `QueryKey for PseudoCanonicalInput<Ty>`).
  - thirdump-minicore (46): 14/0/32 both (base -090143-...-qnap, lane -091009-...-wkxy), same stop move.
  - tydump-nocore `--sample 100 --seed old-select-a`: 79/0/21 both (base -090153-...-wc9z, lane -091022-...-np4c), no
    status change (next solver).
- No `#![no_core]` phase-diff probes: every trait-selection path now stops in old-select-b (`push_stack`) or
  old-candidates-confirm (`assemble_candidates`, `confirm_candidate`) stubs, so a probe can only report UNPORTED until
  those lanes merge.

## Tests
- New `src/rustc_trait_selection/old_select_a.test.ts` (4 tests, real `InferCtxt` over fresh interners, old solver):
  outlives/ambiguous arms and the lattice max of `evaluate_predicates_recursively` (+ depth from parent),
  `evaluate_root_obligation` through `evaluation_probe`, a `?0: Trait` root obligation pinned at the `push_stack` stop,
  canonical-mode overflow (`check_recursion_limit`, `evaluate_predicate_recursively`), `coinductive_match`,
  `can_use_global_caches`.
- Re-pinned (no assertion weakened): `src/rustc_trait_selection/traits_a.test.ts` "next_trait_solver_globally = false: ..."
  stop `SelectionContext::poly_select` -> `SelectionContext::push_stack` (the next stub on the same path).

## `unported(...)` left
- None added. The ported code reaches these other-lane stubs: old-select-b `push_stack`, `match_fresh_trait_preds`,
  `winnow_candidates`, `match_where_clause_trait_ref`; old-candidates-confirm `assemble_candidates`, `confirm_candidate`;
  old-project `poly_project_and_unify_term`, `ProjectionCacheKey_from_poly_projection_obligation`; wave 19
  `err_ctxt().report_overflow_obligation` (overflow in standard mode); D3 `DepGraphData::with_anon_task_inner` (only with
  a dep graph; the port runs without one).

## PORT decisions
1. `PolyTraitClause` (`Binder`, not interned) `==` is compared through `intern_key` (fresh_trait_pred cycles, the #103563
   retry); `ParamEnv` `==` is `ParamEnv_eq`; interned `Predicate`/`Term`/`Ty`/`Const` use `===`.
2. `candidate_from_obligation_no_cache`: `.map(..).flat_map(Result::transpose).collect::<Result<Vec<_>, _>>()?` is a loop
   that returns at the first overflow (the lazy iterator stops there, so later candidates are not evaluated).
3. `filter_impls` retains in place (the array is filtered, refilled and returned).
4. `evaluate_trait_predicate_recursively`'s `mut obligation` param-env reset builds a new `Obligation` (owned value; the
   caller's object is not mutated).
5. `can_use_global_caches` on `TypingMode<CantBeErased>`: the uninhabited `ErasedNotCoherence(!)` arm is `unreachable()`.
6. `check_candidate_cache`'s `cfg!(debug_assertions)` branch is dead (the oracle is a release build), kept as a comment.
7. `check_recursion_depth`/`check_recursion_limit` take the declared `upcast_from_T`/`upcast_from_V` but do not use it:
   the error-reporting view's `report_overflow_obligation<T>` takes no upcast (wave 19 may need it).
8. `item_self_bounds`/`item_non_self_bounds` query values (`unknown` in queries.gen) are cast to `EarlyBinder<Clauses>`
   (as rustc_hir_typeck coercion.ts) and instantiated with `fold_Clauses`.
9. Local helpers: `max_EvaluationResult` (derived `Ord::max` on the discriminants, `other` on ties),
   `clone_SelectionResult_SelectionCandidate`, `take_while`/`map_iter`/`all_iter`/`any_iter` iterator adapters (lazy
   where upstream is lazy, so `coinductive_match` short-circuits before upcasting the rest of the cycle), and D4
   descriptors (`d_PolyTraitClause`, `d_TraitRef`, `d_AliasTerm`, `d_ProjectionClause`, `d_HostEffectClause`,
   `d_ParamEnv`, `d_PolyTraitObligation`), read lazily.

## For root / other lanes
- Files touched: `src/rustc_trait_selection/traits/select/mod.ts` (my region + imports + helper block at the end of the
  file), `src/rustc_trait_selection/traits_a.test.ts` (re-pin), new `src/rustc_trait_selection/old_select_a.test.ts`.
- old-select-b edits the same file (its methods go in the `unported_methods` block position / after `match_projection_projections`);
  expect a textual merge in the import block and the `unported_methods` list only.
- `push_stack` (old-select-b) receives `previous_stack` as given (no copy); per the representation note, it should
  `clone_TraitObligationStackList` when storing it if anything could advance the list with `next()`.
