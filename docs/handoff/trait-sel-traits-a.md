# Handoff: trait-sel-traits-a (M3, wave 17)

Branch `lane/trait-sel-traits-a`, based on main `3e4773f`, with no merges. Commits: `a12589f` (port), `accb384` (tests),
`cc08ecf` (re-pins), and this handoff.

## Result
- **Ported in full, in upstream order, with markers.** Every file is `--missing` 0:

  | upstream file (`compiler/rustc_trait_selection/src/`) | TS | fns |
  |---|---|---|
  | traits/mod.rs | traits/mod.ts | 26/26 |
  | traits/engine.rs | traits/engine.ts | 34/34 |
  | traits/normalize.rs | traits/normalize.ts | 15/15 |
  | traits/util.rs | traits/util.ts | 11/11 |
  | traits/misc.rs | traits/misc.ts | 3/3 |
  | traits/structural_normalize.rs | traits/structural_normalize.ts | 3/3 |
  | traits/outlives_bounds.rs | traits/outlives_bounds.ts | 2/2 |
  | infer.rs | infer.ts | 8/8 |
  | regions.rs | regions.ts | 6/6 |

- **Contract stubs filled.** All 15 extension methods of these files are now real:
  - infer.rs: the 7 `InferCtxtExt` methods and `enter_canonical_trait_query`;
  - regions.rs: `resolve_regions`, `OutlivesEnvironment.new` and `OutlivesEnvironment.new_with_implied_bounds_compat`;
  - traits/normalize.rs: `normalize`, `deeply_normalize`;
  - traits/structural_normalize.rs: the 3 `structurally_normalize_*`;
  - traits/outlives_bounds.rs: `implied_bounds_tys`.
  The `unported_methods(..)` lists of those stub modules are gone.
- **decls.ts.** `ObligationCtxt` and `FulfillmentError` are now re-exports of the real types (they were `Pending`).
- **Types are generated** by the new codegen set `rustc_trait_selection_traits_a` into `traits/{mod,engine,misc,normalize,util}.gen.ts`:
  - `FulfillmentError`, with its Debug and TypeVisitable;
  - `FulfillmentErrorCode`, with its Clone and TypeVisitable (the manual Debug is `debug_FulfillmentErrorCode` in mod.ts);
  - `SkipLeakCheck`, `TraitQueryMode`, `ReplaceRegions`, `EvaluateConstErr`;
  - the 3 misc.rs error enums and `TupleArgumentsFlag`.
  - The hand types are `FulfillmentEngine`, `ObligationCtxt` and `AssocTypeNormalizer`.
- **Not ported:** the old solver (`SelectionContext`, `project`, `FulfillmentContext`; wave 20 per D9) and the next solver's
  `FulfillmentCtxt` / `solve::normalize` (lane trait-sel-solve). Both stay `unported` stand-ins. Every stop is listed below.

## Files
- **Mine.** All under `src/rustc_trait_selection/`:
  - new: `traits/{mod,engine,util,misc}.ts`, the 5 `traits/*.gen.ts` and the test `traits_a.test.ts`;
  - stubs replaced: `infer.ts`, `regions.ts`, `traits/{normalize,structural_normalize,outlives_bounds}.ts`.
- **Shared, please review:**
  - `src/rustc_trait_selection/lib.ts`: imports `traits/{mod,engine,misc,util}.ts` and exports `regions` and `traits`.
    Other wave-17 lanes add lines here too, so expect conflicts. Merging means taking the union of the import lines.
  - `src/rustc_trait_selection/decls.ts`: the two re-exports above.
  - `tools/codegen/types.sets.json`: the new set `rustc_trait_selection_traits_a`, appended as text (the rest of the
    file is untouched).
  - `tools/codegen/trait_selection.typemap.json` (new), the set-local type map. It needs bare paths
    (`PredicateObligation`, `SelectionError`) because traits/mod.rs gets them through `pub use rustc_infer::traits::*`,
    a glob import the generator does not resolve. It also has `helpers` entries for `clone_SelectionError` and
    `clone_MismatchedProjectionTypes`, as a workaround for infcx-contract's generator bug 3(b).
  - `tools/codegen/type_fold.json`: 5 entries appended:
    - `rustc_middle::ty::error::ExpectedFound`;
    - `PredicateObligation` and `PredicateObligations`, served by fns in traits/mod.ts;
    - `SelectionError` and `MismatchedProjectionTypes`, visit only.
    - **Side effect when root regenerates set `rustc_infer`:** `ValuePairs`' TypeVisitable/TypeFoldable in
      infer/mod.gen.ts gets real `ExpectedFound` impls instead of `unported_type_fold` (checked by regenerating to a
      scratch dir). The Region, Term and TraitRef arms become real; Aliases, PolySigs and the two Existential arms still
      stop inside. `rustc_middle_traits_thir`, `rustc_hir_analysis` and `rustc_type_ir` are unchanged.
- **Re-pins in other lanes' tests.** These are pinned stop texts and placeholder checks. No matching case got weaker.
  - `src/rustc_infer/contract.test.ts`:
    - the rustc_trait_selection extension check now accepts a ported method (any non-stub function) or a placeholder
      of its own module;
    - the "placeholders stop as UNPORTED" example moves from `can_eq` (ported now) to `predicate_may_hold` (wave 20
      stub).
  - `src/rustc_hir_analysis/hir_ty_lowering/mod_a_test/lower.expected.txt`: the 2 `PENDING` lines that stopped at
    `can_eq` now stop one step deeper, at `rustc_trait_selection::solve::FulfillmentCtxt::new (solve/fulfill.rs, lane trait-sel-solve)`.
    The test header says to update these lines "as those land".

## Stand-ins for root to repoint (earlier lanes' copies of this lane's items)
Each of these now has a real port:
- **rustc_ty_utils**
  - `ty.ts:53-60`: `ObligationCtxt_` / `ObligationCtxt_new`. Use `ObligationCtxt.new`.
  - `ty.ts:59`: `normalize_param_env_or_error`. Use `traits::normalize_param_env_or_error` from traits/mod.ts.
    - This is on the `param_env` query path. The alias-free early return is tested.
    - Env clauses with aliases go on to `ObligationCtxt::new_with_diagnostics`, which stops at trait-sel-solve's
      `FulfillmentCtxt` stand-in.
  - `structural_match.ts:20-25`: `ObligationCtxt_`. Use `ObligationCtxt.new`.
- **rustc_hir_analysis**
  - `impl_wf_check/min_specialization.ts:502-512`: `ObligationCtxtView` / `ObligationCtxt_new_with_diagnostics`. Use
    `ObligationCtxt.new_with_diagnostics`.
  - `hir_ty_lowering/dyn_trait.ts:177`: the `expand_trait_aliases` stop. Use `expand_trait_aliases(tcx, user_written_bounds)`
    from traits/util.ts.
    - The return type is the same: `[[PolyTraitClause, Span[]][], [PolyProjectionClause, Span][]]`.
    - Re-pin `lowering_c.test.ts:598` after the change.
  - `decls.ts:121`: `FulfillmentError = Pending<..>`. Re-export it from `rustc_trait_selection/decls.ts`.
  - `hir_ty_lowering/errors.ts:2102`: `FulfillmentError::root_obligation`. It is now a plain field of the generated class.
  - `collect.ts:1347`: `suggest_impl_trait`'s loop ("ObligationCtxt pending: wave 17") can use `ObligationCtxt` now.
- **rustc_passes** `check_attr.ts:1285` (`check_proc_macro`): the `ObligationCtxt` part is available. It also needs
  error reporting (wave 19).

## Stand-ins in this lane's files for other lanes' items (`pending_*`, each stops as UNPORTED)
- **Lane trait-sel-solve** (solve/fulfill.rs and solve/normalize.rs):
  - engine.ts: `pending_NextFulfillmentCtxt_new`;
  - engine.ts: `FulfillmentErrorKinds_{ScrubbedTraitError,FulfillmentError}.from_next`, the `impl FromSolverError<NextSolverError>` impls;
  - normalize.ts: `pending_solve_normalize` and `pending_solve_deeply_normalize`;
  - regions.ts: `pending_solve_deeply_normalize_ScrubbedTraitError`.
  - When repointing, keep the D4 shape: `FulfillmentEngine.new(infcx, d_E)` passes `d_E.from_next` to the
    `FulfillmentCtxt` constructor.
- **Wave 20, old solver** (traits/fulfill.rs, select, project.rs):
  - engine.ts: `pending_FulfillmentContext_new` and `FulfillmentErrorKinds_*.from_old`;
  - normalize.ts: `pending_SelectionContext_new` (with the `SelectionContext` view interface), and
    `pending_project_{normalize_projection_term, opt_normalize_projection_term, normalize_inherent_projection, const_of_item_or_delayed_bug}`.
- **Wave 19, errctxt-contract:** `TypeErrCtxtView` in traits/mod.ts, the methods called on `infcx.err_ctxt()`:
  - `report_fulfillment_errors`, `report_region_errors`, `report_overflow_error`.
  - Drop the view when `TypeErrCtxt` stops being `Pending`.
- **M4, const eval:** traits/mod.ts `try_evaluate_const` stops at `TyCtxt::const_eval_resolve_for_typeck`. The match on
  its result is kept as a comment.
- **Providers.** `provide` (traits/mod.rs:982) installs `instantiate_and_check_impossible_clauses` and
  `is_impossible_associated_item`. The other entries are comments that root fills when those lanes land:
  `dyn_compatibility::provide`, `vtable::provide`, the 3 `specialize` providers and the 2 `outlives_for_liveness`
  providers.
  - Nothing calls `rustc_trait_selection::provide` yet: it is not in rustc_interface's provider list, and lib.rs's
    `provide` is not this lane's.
- **Re-exports.** traits/mod.ts re-exports only this lane's modules. The other `pub use self::{coherence, dyn_compatibility,
  fulfill, project, select, specialize}::..` lines are comments to fill when those modules land.

### What the default (next-solver) typeck path needs
Plain invocations use the next solver globally. For `ObligationCtxt` to work there, it needs:
- **from trait-sel-solve:** `solve::FulfillmentCtxt::new` and its `TraitEngine` impl, the two `FromSolverError<NextSolverError>`
  impls, and `solve::{normalize, deeply_normalize}`. Then `At::normalize`, `deeply_normalize`, `assumed_wf_types`,
  `can_eq`, `normalize_param_env_or_error` (when the env has aliases) and `impossible_clauses` all run.
- **`type_is_{copy,clone,sized,..}_modulo_regions` / `type_implements_trait`** go through
  `InferCtxt::evaluate_obligation(_no_overflow)` (traits/query/evaluate_obligation.rs). That file is planned for wave 20
  (old-query-typeops), but upstream it serves the next solver too (`evaluate_root_goal`). **Recommend moving
  evaluate_obligation.rs earlier.**

## Tests
- `src/rustc_trait_selection/traits_a.test.ts`: 8 tests.
  - `ObligationCtxt` runs on a real `InferCtxt` over a recording `TraitEngine` (the `Next` variant):
    - `eq` unifies a type variable and reports a `Sorts` mismatch;
    - `sub` / `sup` / `lub` / `relate` work;
    - `register_bound` builds the right TraitRef predicate;
    - `register_obligations`, `into_pending_obligations` and `evaluate_obligations_error_on_ambiguity` are checked;
    - `structurally_normalize_ty` on a non-alias type succeeds;
    - `ObligationCtxt::new` / `new_with_diagnostics` / `can_eq` stop at the trait-sel-solve stand-in.
  - `expand_trait_aliases` on hand-built aliases (`Outer = Foo + Bar`, `Foo = Bar + Baz + 2× projection`):
    - expansion is breadth-first;
    - `Self` is instantiated;
    - span stacks are kept;
    - duplicate projections are dropped.
  - `normalize_param_env_or_error`: an alias-free env is elaborated with supertraits and returned without normalizing.
- **Checks:**
  - `bunx tsc --noEmit -p .`: clean.
  - `bun scripts/coverage.ts --check`: `markers ok (14473; vendor 3888)`.
  - `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4965 pass, 1 skip (the pre-existing linux-only
    test), 3 fail before the re-pins. Those 3 are exactly the re-pinned tests above, and after the re-pins all 3 pass
    (re-run of those files: 18 pass, 0 fail).
  - Fresh-process loads: lib.ts, decls.ts, infer.ts, regions.ts and every hand module under traits/ load as entry
    points. `.gen.ts` files are not entry points, as elsewhere.
- **Sample difftests:**

  | suite | run | MATCH | DIFF | UNPORTED | CRASH | notes |
  |---|---|---|---|---|---|---|
  | hir-tree-nocore --sample 100 | `20261015-000120-trait-sel-traits-a-4tpz` | 100 | 0 | 0 | 0 | |
  | tydump-nocore --sample 100 | `20261015-000138-trait-sel-traits-a-6h43` | 22 | 0 | 78 | 0 | all 78 at `check_type_wf provider` (another wave-17 lane) |

  No new UNPORTED.

## PORT decisions (please record)
1. **`FulfillmentEngine`**
   - It is a class with the enum's `$` tag and `_0` payload, so that it can implement `TraitEngine` (it is passed as
     `&mut dyn TraitEngine`). Both payloads are `TraitEngine<E>` objects.
   - The bound `E: FromSolverError<NextSolverError> + FromSolverError<OldSolverError>` is the D4 pair
     `FulfillmentErrorKinds<E>` (`from_next`, `from_old`).
2. **`ObligationCtxt`**
   - It is a class `(infcx, engine, d_E)`. The extra last field `d_E` carries `E`'s descriptor pair, because
     `assumed_wf_types` and `deeply_normalize` take no descriptor upstream.
   - The impl blocks restricted to `E = FulfillmentError` / `E = ScrubbedTraitError` are methods with a typed `this`.
   - `FxIndexSet<Ty>` is `Set<Ty>`.
3. **Fn-local structs** become module-level classes next to their fn:
   - `ConstNormalizer`, `ReplaceParamAndInferWithPlaceholder`, `ReferencesOnlyParentGenerics`.
   - Their unoverridden `TypeFolder` / `TypeVisitor` methods forward to the `*_provided` tables.
4. **Lazy iterators** (`predicates_for_generics`, `implied_bounds_tys`, the param-env clause map, the impossible-item
   obligations) are generators, so the pull order matches upstream. `Vec::extract_if` is a stable two-way partition.
5. **Uninhabited arms.** `EvaluateConstErr::FailedNormalization(!)` and `TypingMode<CantBeErased>::ErasedNotCoherence`
   get an explicit (unreachable) case so that the TS switches are exhaustive.
6. **`find_attr!(tcx, def_id, ..)`** is `find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), ..)`.
7. **Codegen**
   - The set is named `rustc_trait_selection_traits_a`, a per-lane name, to avoid clashing with other wave-17 lanes'
     sets for this crate. Root may fold the sets into one `rustc_trait_selection` set.
   - It has a set-local typemap.
   - `type_fold.json` serves the alias impls of `PredicateObligation(s)` with fns in traits/mod.ts.
8. **`SkipLeakCheck::is_yes`** is on a sibling companion `SkipLeakCheck_`. The generated companion of a fieldless enum
   is a frozen `as const` object, so the method cannot be added to it.
9. **outlives_bounds.rs.** The comment in rustc_trait_selection/decls.ts assigns it to trait-sel-traits-b, but this
   lane's brief assigns it to trait-sel-traits-a, and this lane ported it. Lane -b should not port it again.
