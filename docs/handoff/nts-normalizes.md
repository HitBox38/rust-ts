# Handoff: nts-normalizes (wave 16, M3): rustc_next_trait_solver goal dispatch, normalization, host effects

Branch `lane/nts-normalizes` (from the evalctxt-contract tip, no merges). Commits: solve/mod.rs; shared PORT helpers;
project_goals/*; effect_goals.rs (+ `DefId_eq` fix); normalizes_to.rs; unit tests; this handoff.

## Files touched (all under `src/rustc_next_trait_solver/solve/`, all owned by this lane)
- `mod.ts`: solve/mod.rs. The 3 free fns, the 15 `EvalCtxt` methods (`compute_*_goal`, `try_merge_candidates`,
  `bail_with_ambiguity`, `flounder`, `structurally_normalize_*`), and a "PORT helpers" section (see decision 1).
  Its `unported_methods(..)` call is gone.
- `normalizes_to.ts`: normalizes_to.rs. The 5 `EvalCtxt` methods and the full `GoalKind_NormalizesTo` table.
- `effect_goals.ts`: effect_goals.rs. The full `GoalKind_HostEffectClause` table and `compute_host_effect_goal`.
- `project_goals/{mod,anon_const,free_alias,inherent,opaque_types}.ts`: all 7 `EvalCtxt` methods.
- New test `nts_normalizes.test.ts` (16 tests). It is not an upstream test file.

Nothing else was touched: no decls.ts, no other lane's file, no contract.test.ts.

## Coverage (`bun scripts/coverage.ts --missing`)
| file | ported |
|---|---|
| solve/mod.rs | 18/18 |
| solve/normalizes_to.rs | 37/37 |
| solve/effect_goals.rs | 32/32 |
| solve/project_goals/mod.rs | 2/2 |
| solve/project_goals/anon_const.rs | 1/1 |
| solve/project_goals/free_alias.rs | 1/1 |
| solve/project_goals/inherent.rs | 2/2 |
| solve/project_goals/opaque_types.rs | 1/1 |

`bun scripts/coverage.ts --check`: `markers ok (12405; vendor 3888)`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_next_trait_solver`: contract.test.ts 6/6, nts_normalizes.test.ts 16/16.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Full test run" below.
- Every touched module and `lib.ts` load as fresh-process entry points.
- **Difftest:** no suite reaches the solver yet (nothing outside the crate imports it). A sample would only re-run
  untouched code, so none was run (evalctxt-contract precedent).

## Tests (`nts_normalizes.test.ts`)
The other nts lanes' `EvalCtxt` methods are still stubs. The tests therefore use a fake `EvalCtxt`: an object on
`EvalCtxt.prototype` whose other-lane methods are recording instance overrides, over a real `mk_tcx` interner.
- **solve/mod.rs:**
  - the response helpers (identity, nested goals, non-identity `var_values`);
  - `equal_response_modulo_region_constraints`;
  - `try_merge_candidates`: `AlwaysApplicable(i)`, `EqualResponse`, and `None`;
  - `flounder` / `bail_with_ambiguity`: the folded `MaybeInfo` equals `AMBIGUOUS.or(..)`;
  - subtype of two ty vars, coerce→subtype, dyn-compatible, well-formed, unstable feature (rerun propagation);
  - const-evaluatable for infer and error consts;
  - `structurally_normalize_term` on a rigid term.
- **project_goals:**
  - `compute_projection_goal` dispatch for all 9 `AliasTermKind`s;
  - `normalize_associated_term`: the call order `evaluate_goal_raw(Normalization, NormalizesTo)` →
    `inspect.make_canonical_response(AMBIGUOUS)` → `eq` → nested `add_goal`s → response with the nested certainty.
- **GoalKind tables:**
  - NoSolution paths of the `NormalizesTo` builtins;
  - ICE texts (`unreachable!`, `panic!()`, `unimplemented!`);
  - `fast_reject_assumption` on a non-projection alias;
  - `HostEffectClause` iterator / never-const builtins.
- **PENDING (exact stub text, UNPORTED until the other lane lands):**
  - `GoalKind_NormalizesTo.consider_builtin_fn_trait_candidates` →
    `rustc_next_trait_solver::solve::assembly::structural_traits::extract_tupled_inputs_and_output_from_callable`
    (nts-assembly);
  - `GoalKind_HostEffectClause.consider_builtin_destruct_candidate` →
    `..::structural_traits::const_conditions_for_destruct` (nts-assembly);
  - `compute_host_effect_goal` → `rustc_next_trait_solver::solve::eval_ctxt::probe::EvalCtxt::probe` (nts-eval).

## `unported(...)` left
- **None in this lane's files.** Every fn is ported.
- **Reached through other lanes' stubs:**
  - nts-eval: `probe` / `probe_trait_candidate` / `probe_builtin_trait_candidate` and `ProbeCtxt::enter`, `eq` / `sub`,
    `add_goal(s)`, `evaluate_added_goals_and_make_canonical_response`, `evaluate_goal_raw`, `normalize`,
    `fresh_args_for_item`, `next_*_infer`, `instantiate_binder_with_infer`, `fetch_eligible_assoc_item`,
    `evaluate_const*`, `register_*`, `add_item_bounds_for_hidden_type`, `destructure_type_outlives`,
    `make_ambiguous_response_no_constraints`, ...;
  - nts-assembly: `GoalKind_provided.*`, `assemble_and_merge_candidates`, `forced_ambiguity`, and the
    structural_traits fns;
  - nts-trait-goals: `compute_trait_goal`;
  - inspect/build.rs (nts-canonical): `EvaluationStepBuilder::make_canonical_response`.
- **Stand-in:** `fold_AsyncCallableRelevantTypes` (evalctxt-contract's codegen stand-in). It is reached by
  `consider_builtin_async_fn_trait_candidates`.

## infcx-contract `ir_` renames
No call site. These files never call an `InferCtxtLike` method directly; they go through `EvalCtxt` methods
(`fresh_args_for_item`, `register_hidden_type_in_storage`, ...), which are nts-eval's. So there is no
`// PORT(merge): ir_<name>` marker.

## PORT decisions (please record)
1. **Shared helpers in solve/mod.ts.** They are not upstream fns, and other modules read them only inside fn bodies:
   - `NO_SOLUTION` (the unit value);
   - `upcast_fn` / `goal_with`: `Goal::with` with rustc_middle's `TyCtxt`-typed `UpcastFrom` fns;
   - `iter_instantiated`: `Interner::clauses_of` & co. return a lazy `Iterable`, and binder.ts's `iter_instantiated`
     takes a slice, so the helper collects first (the source is side-effect free);
   - `map_iter`: the lazy `Iterator::map`.
2. **`as_interner(cx)`** (rustc_type_ir predicate.ts precedent) is used for:
   - the TyCtxt query values that queries.gen.ts types `unknown`: `type_of`, `type_of_opaque_hir_typeck`,
     `impl_trait_ref`, `impl_polarity`, `adt_def`;
   - the `Interner`-typed helpers: `Goal::with/new`, `AliasTerm::trait_ref/own_args`, `DeepRejectCtxt`,
     `TraitRef::new`.
   Drop these casts when the query types are generated.
3. **Generic method resolution.** The solver is generic over `I`, so `I::Term` / `I::GenericArg` / `I::Clause` /
   `I::Ty` / `I::GenericArgs` provided methods are inherent.ts's `<Trait>_provided` helpers. Required ones are the
   rustc_middle impls.
4. **Equality.**
   - The derived `PartialEq` of plain values (`Certainty`, the opaque-type `Vec`, `NestedNormalizationGoals`,
     `ExternalRegionConstraints`, `AliasTermKind` in `assert_eq!`) compares `intern_key`s.
   - `DefId ==` is `DefId_eq`.
   - Interned handles use `===`.
5. **Rust idioms.**
   - `Vec::extend(result)` pushes only the `Ok` value (`consider_additional_alias_assumptions`).
   - `match never {}` returns the `never` value.
   - Destructuring parameters are bound in the body.
6. **Panic texts.**
   - `unimplemented!(m)` is `panic("not implemented: m")`, and plain `unimplemented!()` is `"not implemented"`.
   - `unreachable!(m)` is `unreachable("internal error: entered unreachable code: m")`.
   - `{:?}` uses the existing Debug fns (`debug_Goal(.., debug_NormalizesTo)`, `debug_Ty`, `debug_Const`,
     `debug_DefId`, `debug_AliasTermKind`).
7. **D4 descriptors** for `TraitRef`, `Binder<TraitRef>`, `ProjectionClause` and `HostEffectClause` are module-local,
   built from the generated derive fns (rustc_middle generics.ts precedent).

## For root
- **No decls.ts changes needed.**
- `fold_AsyncCallableRelevantTypes` still needs codegen (evalctxt-contract "For root" 3).
- If root prefers, the solve/mod.ts helpers (decision 1) could move to a shared non-upstream module.

## Full test run
`RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: RESULT_PLACEHOLDER
