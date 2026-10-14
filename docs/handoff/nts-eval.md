# Handoff: nts-eval (wave 16, M3): rustc_next_trait_solver eval_ctxt + search_graph

Branch `lane/nts-eval` (from aa18d24, evalctxt-contract; no merges). Commits: port of the five files; unit tests +
`PORT(merge)` markers; this handoff.

## Files touched
- `src/rustc_next_trait_solver/solve/eval_ctxt/mod.ts`: every fn of eval_ctxt/mod.rs (the `SolverDelegateEvalExt`
  blanket impl, the two `maybe_evaluate_*_with_higher_recursion_limit`, all `EvalCtxt` methods and the statics
  `enter_root` / `enter_canonical`, `filter_irrelevant_region_constraints` with its local `NonTrivialVars`,
  `term_is_fully_unconstrained` with its local `ContainsTermOrNotNameable`, `should_rerun_after_erased_canonicalization`,
  `evaluate_root_goal_for_proof_tree_raw_provider`, `evaluate_root_goal_for_proof_tree`). Its `unported_methods`
  calls are gone.
- `solve/eval_ctxt/fast_path.ts`, `solve/eval_ctxt/probe.ts` (`ProbeCtxt`, `TraitProbeCtxt`, `probe*`),
  `solve/eval_ctxt/solver_region_constraints.ts` (with its local `RawAssumptions`), `solve/search_graph.ts`
  (the `Delegate` table fns, `response_no_constraints`).
- New test `src/rustc_next_trait_solver/nts_eval.test.ts` (16 tests).
- `src/rustc_next_trait_solver/contract.test.ts`: one pin changed. Its "a stub stops as UNPORTED" example was
  `EvalCtxt::cx`, which is now ported; it now uses trait_goals.rs's `compute_trait_goal`. Whoever ports
  trait_goals.rs must move the example again. No counts changed.
- decls.ts, delegate.ts and other lanes' files are untouched.

## Coverage (`bun scripts/coverage.ts --missing`)
| file | ported |
|---|---|
| solve/eval_ctxt/mod.rs | 76/76 |
| solve/eval_ctxt/fast_path.rs | 4/4 |
| solve/eval_ctxt/probe.rs | 8/8 |
| solve/eval_ctxt/solver_region_constraints.rs | 8/8 |
| solve/search_graph.rs | 9/9 |

`bun scripts/coverage.ts --check`: `markers ok (12411; vendor 3888)`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_next_trait_solver`: 22 pass (contract 6 + nts_eval 16).
- Full `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4510 pass, 1 skip (the pre-existing linux-only one), 0 fail.
- Each of the five modules and lib.ts loads as a fresh-process entry point.
- No difftest suite reaches the solver: nothing outside the crate imports it until wave 17 (trait-sel-solve).
  A sample difftest would only re-run untouched code, so none was run.

## Unit tests (fake `SolverDelegate` / `InferCtxtLike`, real interned `PredicateKind::Ambiguous`)
- **`enter_root`:**
  - the root context is `Misc`, in `U0`, with empty var values;
  - an empty goal list gives `Ok(Yes)`;
  - the two root assertions panic with the upstream text: goals left behind, and `might_rerun`.
- **`add_goal` → `try_evaluate_added_goals`:**
  - a `TriviallyHolds` fast path adds nothing;
  - a `TriviallyStalled` goal stays (`Ok(AMBIGUOUS)` after one pass). Once its var changes, it reruns through
    `compute_goal_fast_path_cold` and drops out;
  - goals that keep changing the inference state stop after `FIXPOINT_STEP_LIMIT` (8) steps with `overflow(false)`;
  - `NoSolution` drops the remaining goals and taints the context. A later
    `evaluate_added_goals_and_make_canonical_response` ICEs with the exact `assert_eq!` text;
  - `RerunNonErased` propagates without tainting;
  - a goal with no fast path reaches `canonicalize_goal` (nts-canonical) and stops as `Unported`.
- **Probes:**
  - the nested context gets a copy of the outer goals; `enter_without_propagated_nested_goals` gets none;
  - inference is rolled back through `probe`;
  - the outer goals are unchanged afterwards, and the nested opaque accesses are merged;
  - `probe_kind` is not called when inspection is off;
  - inner `NoSolution` does not taint the outer context;
  - a rerun-always access bails the probe, every later probe, and `enter_single_candidate`, the last before it
    touches the search graph;
  - `probe_trait_candidate` / `probe_builtin_trait_candidate` record their candidate source.
- **Fast paths:**
  - `compute_goal_fast_path` maps the delegate's outcome;
  - `goal_remains_stalled`;
  - `evaluate_root_goal`'s stalled early return, and its cold fast path;
  - `should_rerun_after_erased_canonicalization` arms.
- inspect/build.rs is still a stub (nts-canonical). The test installs the **noop** `EvaluationStepBuilder` behaviour
  (upstream `state: None`) in `beforeAll` and restores the stubs in `afterAll`.
- **PENDING** (needs nts-canonical, then the goal-kind lanes):
  - real goals through `evaluate_goal_raw` / `evaluate_in_search_graph` / `enter_canonical` / `compute_goal`;
  - `evaluate_added_goals_and_make_canonical_response` producing a response (`canonicalize_response`,
    `response_no_constraints_raw`, `mk_external_constraints`);
  - `term_is_fully_unconstrained` (needs ParamEnv's TypeVisitable, a rustc_middle stub);
  - the proof-tree root (`evaluate_root_goal_for_proof_tree*`);
  - `-Zassumptions-on-binders`.
  - An oracle probe in the style of tyir-solve's `oracle/main.rs` should drive these once nts-canonical lands.

## `unported(...)` left
- solver_region_constraints.ts `TransitiveRelationBuilder_default_freeze` stands in for
  `TransitiveRelationBuilder::default().freeze()` (rustc_data_structures transitive_relation.rs, not ported; region_constraint.ts has
  the same private stand-ins). It is reached only under `-Zassumptions-on-binders`.
- Everything else these files call that is not ported yet belongs to other lanes and stops there:
  - nts-canonical: canonical/*, inspect/build.rs, normalize.rs, placeholder.rs, coherence.rs;
  - nts-normalizes: solve/mod.rs's `has_only_region_constraints` / `has_no_inference_or_external_constraints` and the
    `compute_*_goal` fns;
  - nts-trait-goals: trait_goals;
  - rustc_middle: `ParamEnv` fold/visit stubs.

## infcx-contract `ir_` renames (root's message)
Each call site carries `// PORT(merge): ir_<name> after infcx-contract`:
- `eval_ctxt/mod.ts`:
  - `enter_canonical`: `register_hidden_type_in_storage`;
  - `EvalCtxt::register_hidden_type_in_storage`: `register_hidden_type_in_storage`;
  - `fresh_args_for_item`: `fresh_args_for_item`;
  - `register_solver_region_constraint`: `register_solver_region_constraint`;
  - `register_region_outlives`: `sub_regions`;
  - `compute_external_query_constraints`: `get_solver_region_constraint`;
  - `filter_irrelevant_region_constraints`: `universe_of_region`.
- `eval_ctxt/solver_region_constraints.ts`:
  - `eagerly_handle_placeholders`: `get_solver_region_constraint` and `overwrite_solver_region_constraint`.
- `grep -rn "PORT(merge)" src/rustc_next_trait_solver` lists all 9 call sites.

## PORT decisions (please record)
1. **Struct literals.** `EvalCtxt { .. }` (`enter_root`, `enter_canonical`, `ProbeCtxt::enter_inner`) computes the
   field expressions in upstream literal order, then calls the constructor in declaration order.
2. **`Default::default()` of the root's fields.** `var_kinds` / `var_values` are `RawList.empty()`. The
   `OpaqueTypeStorageEntries` default is `delegate.Self.OpaqueTypeStorageEntries_default()`. `I::Span::dummy()` is
   `DUMMY_SP`.
3. **`CanonicalInput` field reads** (`canonical_input.canonical`, `.value.predefined_opaques_in_body`, and
   `&canonical_input` for `build_with_canonical`) go through `CanonicalInput_deref` (upstream's `Deref`).
4. **D4 descriptors.** The descriptors of `Goal<Predicate>`, `(OpaqueTypeKey, Ty)`, `QueryInput<Predicate>`,
   `PredicateKind`, `AliasConst`, `ExternalConstraintsData` and `Response` are module-local in eval_ctxt/mod.ts. They
   are built from the generated `visit_with_*` / `try_fold_with_*` / `fold_with_*` fns, imported through the hand
   modules.
5. **`cx` casts.**
   - Calls typed only on `Interner` (`item_self_bounds`, `Goal::new` / `Goal::with`, the search graph's `cx`) use
     predicate.ts's `as_interner`.
   - The search graph's `X::Self` (`Interner`) is cast back to `TyCtxt` in search_graph.ts (`tcx_of`).
   - `UpcastFrom` impls written over `TyCtxt` are cast for `Goal::new` (`upcast_tcx` / `upcast_ClauseKind`).
   - Drop all of these when `TyCtxt` satisfies `Interner`.
6. **`mut goal` in `add_goal`** is a by-value `Copy` parameter. The normalized goal is a fresh object, not an
   in-place write to the caller's object.
7. **`match x? {}` on `Result<Infallible, RerunNonErased>`** (`rerun_always`) returns `r._0` (`never`) after the
   `Err` early return.
8. **`HashSet<RegionConstraint>`** (dedup in `evaluate_added_goals_and_make_canonical_response`) is a `Set` of intern
   keys. Only `insert` is used, so order does not matter. `HashSet<RegionVid>` / `HashSet<Ty>` in the local visitors
   are plain `Set`s.
9. **Derived `PartialEq` of `Certainty`** (search_graph.rs `is_initial_provisional_result`) compares intern keys
   (contract rule 4).
10. **Local structs** (`ContainsTermOrNotNameable`, `NonTrivialVars`, `RawAssumptions`) are classes inside their fns,
    with markers on their methods. The `TypeVisitor` methods they don't override forward to `TypeVisitor_provided`.
    The decls.ts / module comment lines for them were kept; the contract test accepts either.
11. **`unwrap_or(vec![Goal::new(..)])`** in `RawAssumptions` evaluates its argument eagerly, as upstream.
12. **`tracing` and debug-only code.** `tracing::span!`, `#[instrument]`, `debug!`, `trace!`, `cfg!(debug_assertions)`
    blocks and `debug_assert!` are comments. Panics and assertions keep upstream's text, including the formatted
    `assert!` in `evaluate_goal_raw`.

## For root
1. **delegate.ts type bug.** delegate.ts types `make_deduplicated_region_constraints()` with region_constraint.rs's
   `RegionConstraint`. Upstream (delegate.rs:75) returns `ty::RegionConstraint`, which is predicate.rs's.
   eval_ctxt/mod.ts casts at the call site (`// PORT(decls): pending root`). Fix the interface and drop the cast.
2. **Contract test pin.** contract.test.ts's stub example moved from `cx` to `compute_trait_goal` (see "Files touched").
3. **`ir_` renames.** Rename the 9 `PORT(merge)` call sites when infcx-contract merges.
4. **`TransitiveRelationBuilder` stand-in.** When rustc_data_structures transitive_relation.rs is ported, repoint
   `TransitiveRelationBuilder_default_freeze` (and region_constraint.ts's stand-ins).

## Full test run
`RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4510 pass, 1 skip (the pre-existing linux-only one),
0 fail (4511 tests, 272 files).
