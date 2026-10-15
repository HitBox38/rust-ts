# Handoff: old-project (M3 wave 18c, old trait solver: traits/project.rs)

Branch `lane/old-project` (from integ `60a45cf`, no merges). Commits: the port + `project.test.ts`, then this handoff.

## Result
- `compiler/rustc_trait_selection/src/traits/project.rs` -> `src/rustc_trait_selection/traits/project.ts`: **38/38**
  (`bun scripts/coverage.ts --missing compiler/rustc_trait_selection/src/traits/project.rs`), upstream order:
  - `ProjectionCandidateSet` companion: `mark_ambiguous`, `mark_error`, `push_candidate` (`self: MutRef<..>`).
  - the 6 pub stubs filled with their contract signatures unchanged: `poly_project_and_unify_term`,
    `normalize_projection_term`, `opt_normalize_projection_term`, `const_of_item_or_delayed_bug`,
    `normalize_inherent_projection`, `compute_inherent_assoc_term_args`.
  - `Progress.error_for_term` / `Progress.prototype.with_addl_obligations`.
  - all 24 private fns (`project_and_unify_term`, `normalize_to_error`, `push_const_arg_has_type_obligation`, `project`,
    the 5 `assemble_candidates_*`, `confirm_candidate`, `confirm_select_candidate`, the 9 builtin `confirm_*_candidate`s,
    `confirm_callable_candidate`, `coroutine_closure_output_coroutine`, `confirm_param_env_candidate`,
    `confirm_impl_candidate`, `assoc_term_own_obligations`).
  - `ProjectionCacheKeyExt`: the trait's method declaration (:2203) is an exported `interface ProjectionCacheKeyExt`; the
    one impl (:2210) is `ProjectionCacheKey_from_poly_projection_obligation` (contract signature unchanged).
- rustc_trait_selection 378 -> 416/976; TOTAL 15676/25518.
- `traits/normalize.ts`: **no change needed** — selcx-contract had already repointed the 4 `pending_project_*` stand-ins to
  `project.*` (normalize.ts:240/256/278/283/333); there are no `pending_project_*` names left anywhere in `src/`.

## Files touched
- `src/rustc_trait_selection/traits/project.ts` (port), `src/rustc_trait_selection/traits/project.test.ts` (new, 6 tests),
  `docs/handoff/old-project.md`. Nothing else (no decls.ts change, no `declare module` override).

## Checks
- `bunx tsc --noEmit -p .` clean; `bun scripts/coverage.ts --check` markers ok (16195; vendor 3888).
- `bun test src/rustc_trait_selection src/rustc_infer src/rustc_traits --timeout=60000`: 142 pass, 0 fail (12 files; was
  136/11 before the new test file). Every touched module loads as a fresh entry point (`project.ts`, `normalize.ts`,
  `traits/mod.ts`, `fulfill.ts`, `lib.ts`).
- Samples, lane vs base 60a45cf (same args, base in a temporary worktree, `RUST_TS_AGENT=old-project`): **no change**.
  - tydump-minicore (46): 14 MATCH / 0 DIFF / 32 UNPORTED both (runs 20261015-091450-old-project-xccg / base
    -091531-old-project-h28w). Stops: 24x `SelectionContext::poly_select` (old-select-a), 6x `ConstraintCategory (mir, M4):
    BoringNoLocation`, 1x `TyCtxt::mk_pat (Pattern class)`, 1x `QueryKey for PseudoCanonicalInput<Ty>`.
  - thirdump-minicore (46): 14/0/32 both (1x0p / wqcr), same stops.
  - tydump-nocore `--sample 100 --seed old-project`: 82/0/18 both (oizd / zy04). Stops: 9x `ConstraintCategory`, 3x
    `IntegerExt::from_int_ty`, 3x `const_eval_resolve_for_typeck`, 1x `get_adt_def (ReprOptions)`, 1x `parse_data_layout`, ...
  - project.rs is not reached by any sample yet: every old-solver path stops earlier in `poly_select` (old-select-a).
    Inside `project`, the first unported call is `SelectionContext::for_each_item_bound` (old-select-a; reached from
    `assemble_candidates_from_trait_def` whenever the param-env yields no match), then `match_projection_projections`
    (old-select-a) and `select` (old-select-a). No phase-diff probes: they would all stop at `poly_select`.
- New unit tests (`traits/project.test.ts`, real `InferCtxt` over fresh interners, old solver): `push_candidate`
  transitions (dedup, ParamEnv preference, ambiguity, the `bug!`), the projection-cache arms of
  `opt_normalize_projection_term` (Ambiguous -> `Ok(None)`, InProgress -> `Err` + `Recur`, Recur -> `Err`, NormalizedTerm ->
  cached term + obligations appended), `Progress::with_addl_obligations`, `from_poly_projection_obligation`, and the pinned
  stop of an uncached projection: `SelectionContext::for_each_item_bound` (re-pin when old-select-a lands).
- No pre-existing test's pinned stop moved.

## `unported(...)` left (in ported code)
- `rustc_trait_selection::diagnostics::InherentProjectionNormalizationOverflow` (`normalize_inherent_projection`'s
  recursion-limit `emit_fatal`; rustc_trait_selection/src/diagnostics.rs has no TS port yet).
- `rustc_trait_selection::error_reporting::traits::report_dyn_incompatibility` (`project`'s non-dyn-compatible `<dyn
  Trait>::Name` with a real span; same string as hir_analysis dyn_trait.ts; wave 19). `dyn_compatibility_violations` is
  still queried first, as upstream.
- Reached through other lanes' placeholders: `SelectionContext::{for_each_item_bound, match_projection_projections,
  select}` (old-select-a).

## PORT decisions (please record)
1. `#[derive(PartialEq)] ProjectionCandidate` is the local `ProjectionCandidate_eq` (an `intern_key` of the value): the
   clause variants compare the `Binder<ProjectionClause>` by value; `Select` compares the `ImplSource` with each nested
   `Obligation` reduced to `(param_env, predicate)` (rustc_infer's manual `PartialEq for Obligation` ignores `cause` and
   `recursion_depth`).
2. The `SsoHashSet` dedup of `opt_normalize_projection_term`'s obligations is a `Set` of `intern_key([param_env,
   predicate])` (the same manual `Hash`/`Eq` of `Obligation`), keeping first occurrences in order.
3. `match` arms over `TypingMode<CantBeErased>` get the uninhabited `ErasedNotCoherence` arm (`return mode._0`) only to
   satisfy the TS switch (as normalize.ts:431).
4. The PointeeTrait `match tail.kind()` with the guarded `Param | Alias if ..` arm is a `switch` whose `default` evaluates
   the arms in upstream order (`Infer(IntVar|FloatVar)` -> guard -> `UnsafeBinder` -> rest); the guard's right-hand side
   only runs for `Param`/`Alias`, as upstream.
5. `let [..6 args..] = **obligation.predicate.args else { bug!() }` is a length check (`bug!()` when `!= 6`).
6. Crate-internal modules (normalize.ts, util.ts, specialize/**) are read lazily in function bodies (`require`), so the
   module's top level touches only project.gen.ts and other crates.

## For root
- Pre-existing, not in my scope: `traits/fulfill.ts:209` writes `unreachable("old solver coherence")`; upstream's
  `unreachable!("old solver coherence")` panics with `internal error: entered unreachable code: old solver coherence`
  (std/panic.ts's `unreachable(msg)` replaces the whole message; normalize.ts:430 has the full text). Worth a one-line fix.
- When old-select-a lands, re-pin `project.test.ts`'s "reaches `project`'s trait-def assembly" test to the new stop.
