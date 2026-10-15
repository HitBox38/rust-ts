# Handoff: trait-sel-solve (M3, wave 17): rustc_trait_selection `solve/*`

Branch `lane/trait-sel-solve` (from main `3e4773f`, no merges).

## Result
- All of `compiler/rustc_trait_selection/src/solve.rs` and `solve/*` is ported: **107 fns, every file `--missing` 0**.
  - `solve.rs` 2/2, `delegate.rs` 27/27, `fulfill.rs` 18/18, `fulfill/derive_errors.rs` 14/14, `inspect/analyse.rs` 27/27,
    `normalize.rs` 14/14, `select.rs` 5/5, `inspect.rs` 0/0 (module only).
- **First end-to-end run of the next solver.** rustc_trait_selection's `SolverDelegate` drives the ported
  rustc_next_trait_solver over a real `InferCtxt` and the real query system of a `#![no_core]` crate compiled by the ported
  driver. `FulfillmentCtxt`, the error derivation, the proof-tree analysis and `select_in_new_trait_solver` run on top.
  With `-Zdisable-fast-paths`, every line matches rustc's own rustc_trait_selection (rustc-dev probe), byte for byte.
  The covered cases:
  - builtin `Sized`;
  - param-env and impl candidates, with nested impl where-bounds;
  - auto traits, including a negative impl;
  - `FulfillmentError`s with the best leaf obligation (`W<W<U>>: Tr` reports `U: Tr`);
  - ambiguity, and inference through a unique impl (`S: Gen<?2>` gives `?2 := W<S>`);
  - a rigid projection.

## Files
- **New, ported:**
  - `src/rustc_trait_selection/solve.ts` (solve.rs: re-exports, `evaluate_root_goal_for_proof_tree_raw`, `provide`);
  - `src/rustc_trait_selection/solve/delegate.ts`;
  - `src/rustc_trait_selection/solve/fulfill.ts`;
  - `src/rustc_trait_selection/solve/fulfill/derive_errors.ts`;
  - `src/rustc_trait_selection/solve/inspect.ts`;
  - `src/rustc_trait_selection/solve/normalize.ts`.
- **Stub modules filled:**
  - `src/rustc_trait_selection/solve/inspect/analyse.ts`;
  - `src/rustc_trait_selection/solve/select.ts`.
- **Edited, contract (root-owned):**
  - `src/rustc_trait_selection/decls.ts`: the `Pending` aliases `NextSolverError` and `ProofTreeVisitor` are now re-exports
    (the decls header allows this).
  - `src/rustc_trait_selection/lib.ts`: imports rustc_next_trait_solver's `lib.ts`, then solve.ts and the solve modules in
    `mod` order. It also exports `solve`.
- **Edited, not mine (please review):** `src/rustc_infer/contract.test.ts`, test 9.
  - That test required every rustc_trait_selection extension method to still be an `unported` placeholder.
  - It now also accepts a ported method: a plain function, not a placeholder.
  - The collision check and the count (29) are unchanged.
  - The trait-sel-traits lanes will need the same change; expect a trivial merge conflict.
- **Tests (new):**
  - `src/rustc_trait_selection/solve.test.ts` (4 tests);
  - `solve_test/goals.rs` and `solve_test/proj.rs` (test crates);
  - `solve_test/probe.rs` (rustc-dev probe, built with `REGEN=1`, the infer_core_oracle pattern);
  - `solve_test/run.ts` (the port side);
  - the fixtures `solve_test/{goals.nofast,goals,proj.nofast}.stdout`.

## Tests (solve.test.ts)
Each `env_<name>` / `goals_<name>` fn pair is one case:
- param env: `env_`'s clauses;
- goals: `goals_`'s clauses, with type params named `I*` replaced by fresh inference vars.

For every goal the test prints:
- the `visit_proof_tree` root result;
- every candidate's kind / result / shallow certainty;
- the unique candidate's nested goals;
- for trait goals, `select_in_new_trait_solver`.

For every case it also prints:
- the errors of one `FulfillmentCtxt<FulfillmentError>`, from `try_evaluate_obligations` and `collect_remaining_errors`;
- the resolved inference variables.

A case must equal the oracle, or print a prefix of it and stop at a `PENDING` stand-in.

| run | result |
|---|---|
| goals.rs `-Zdisable-fast-paths` | 7/7 cases byte-identical (also checked as one whole-file equality) |
| goals.rs (fast paths on) | prefixes match; cases stop at `sizedness_fast_path` (trait-sel-traits-a) |
| proj.rs `-Zdisable-fast-paths` | `rigid` byte-identical; `proj` / `proj_infer` stop at `specialization_graph::assoc_def` (trait-sel-traits-b) |

- Negative control: changing one fixture line (`resolved: [?0t, ?1t, W<S>]`) fails 2 tests.
- **PORT(test) in run.ts:** the runner installs `solve::provide` and calls the provider of
  `evaluate_root_goal_for_proof_tree_raw` directly. The reasons are under "For root", item 1.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (14472; vendor 3888)`.
- Coverage: rustc_trait_selection 107/976; TOTAL 13953/25518.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: green after one fix; see "Full test run" below.
- Fresh-process loads: `lib.ts`, `solve.ts` and every `solve/**` module load as entry points.
- hir_ty_lowering imports `rustc_trait_selection/lib.ts`, so the driver now loads this lane's modules. The samples are
  unchanged:
  - `hir-tree-nocore --sample 100`: 98 MATCH / 0 DIFF / 2 UNPORTED / 0 CRASH (run `20261014-234441-trait-sel-solve-htzm`).
    The two stops are pre-existing: `codegen_fn_attrs` and `StableHash`.
  - `tydump-nocore --sample 100`: 18 MATCH / 0 DIFF / 82 UNPORTED / 0 CRASH (run `20261014-234513-trait-sel-solve-dfyw`).
    The stops are the known `check_type_wf` (80), `codegen_fn_attrs` and `StableHash`.

## `unported(...)` / stand-ins left
**PORT(merge) stand-ins for the parallel traits lanes.** Each is a module-local fn that stops as UNPORTED, with the same
signature as upstream. Root repoints the call to the real import.
- delegate.ts:
  - `sizedness_fast_path` (traits/util.rs:220, trait-sel-traits-a);
  - `try_evaluate_const` + the local type `EvaluateConstErr` (traits/mod.rs:629/582, trait-sel-traits-a);
  - `wf_unnormalized_obligations` (traits/wf.rs:95, trait-sel-traits-b);
  - `specialization_graph_assoc_def` (traits/specialize/specialization_graph.rs:352, trait-sel-traits-b).
- derive_errors.ts:
  - `wf_unnormalized_obligations` (same);
  - **`FulfillmentError` / `FulfillmentErrorCode`**. These are trait-sel-traits-a's generated types (codegen set
    `rustc_trait_selection_traits_a`, traits/mod.rs:80/113). Until then, derive_errors.ts has:
    - a structural `FulfillmentError_` interface;
    - a `FulfillmentErrorCode` union with upstream's variants and fields;
    - `FulfillmentError_lit(..)`, which builds the struct literal and casts it to decls.ts's `Pending` `FulfillmentError`.

    After the merge: replace `FulfillmentError_lit(o, c, r)` with `new FulfillmentError(o, c, r)` and delete the two types.
    run.ts's `code_str` / `errors` read the stand-in's fields.

**Other lanes' stops reached from here:**
- `infcx.err_ctxt().report_overflow_obligation(..)` (fulfill.ts, the fulfillment-overflow path). `err_ctxt` is a wave-19
  placeholder and `TypeErrCtxt` a `Pending` alias, so the call is cast; PORT(merge) comment.
- `is_transmutable`: rustc_transmute (`Assume::from_const`, `TransmuteTypeEnv`) has no lane: `unported`. It is reached only
  after `erase_and_anonymize_regions`.

## PORT decisions (please record)
1. **`SolverDelegate` is a class** `{ _0: InferCtxt }` implementing rustc_next_trait_solver's `SolverDelegate` interface.
   - `deref()` returns `_0`.
   - `Self` is `SolverDelegate_static_impl`: `build_with_canonical`, plus the `OpaqueTypeStorageEntries` default
     `default_OpaqueTypeStorageEntries()`.
   - `<&SolverDelegate>::from(infcx)` (a transmute) is `SolverDelegate.from(infcx)`: a fresh stateless wrapper.
   - `cx`, `obtain_canonicalizer_state` and `release_canonicalizer_state` are overridden, as upstream.
2. **`FulfillmentCtxt<E>`** implements rustc_infer's `TraitEngine<E>`.
   - `_errors: PhantomData<E>` holds the `FromSolverError<E, NextSolverError>` descriptor, so `FulfillmentCtxt.new(infcx,
     from_solver_error_E)`.
   - The impls are `FromSolverError_FulfillmentError` and `FromSolverError_ScrubbedTraitError`.
   - `retain_mut` rebuilds `pending` in order. Its closure is the private method `retain_pending`, with the
     `errors` / `any_changed` cells.
3. **`ObligationStorage`** is a class with `default_()` and a hand-written `debug_ObligationStorage` (derive Debug).
   `NextSolverError` is a `$`-tagged union without derives, as upstream.
4. **`ProofTreeVisitor<R>`** is an interface with `Result: VisitorResult<R, ..>` (the rustc_ast_ir pattern).
   - The provided `config` / `on_recursion_limit` are in `ProofTreeVisitor_provided`.
   - `try_visit!` is the rustc_ast_ir `try_visit` expansion.
   - The visitors are classes: `OverflowedGoalChain`, `BestObligation` and `Select`.
5. **`InspectGoal` / `InspectCandidate`** are classes. Private fields that share a name with an accessor get a trailing
   `_` (infcx-contract Representation 2).
6. **`visit_proof_tree` / `visit_proof_tree_at_depth`** are generic in the implementation. decls.ts declares them as
   `(.., visitor: ProofTreeVisitor): unknown`, so callers cast the result to their visitor's `R`. See "For root" 2.
7. **`crate::traits::BoundVarReplacer`** is rustc_next_trait_solver's `placeholder::BoundVarReplacer` (traits/util.rs:14
   re-exports it), imported from there directly.
8. **D4:** `E: FromSolverError` adds the descriptor `from_solver_error_E` before `d_T` in normalize.ts's
   `deeply_normalize*`. Module-local descriptors cover `Goal<Predicate>`, `()`, `PredicateObligation`,
   `(ObligationCause, PredicateObligation)`, `PolyTraitRef`, `AliasTy` / `AliasConst`, `(Ty, Ty)` and `TraitRef`.
9. **`FxHashMap<ty::RegionConstraint, usize>`** in `make_deduplicated_region_constraints` is a `Map` keyed by `intern_key`
   (lookup only, so order does not matter).
10. **`assert_matches!`** in `candidates_recur` uses a one-line `stringify!` of the pattern (only an ICE prints it).
11. **rustc_next_trait_solver is reached through its `lib.ts`** (`solve`, `canonical`, `normalize`, `placeholder`
    namespaces), read inside fn bodies; nts `upcast_fn` / `NO_SOLUTION` come through `solve.`.

## For root
1. **Wire the proof-tree query.** Without this, nothing outside tests can reach `visit_proof_tree`, `select`, or the
   `FulfillmentError` derivation.
   - queries.gen.ts has `key: key_unported("(solve::CanonicalInput<'tcx>, usize)")` for
     `evaluate_root_goal_for_proof_tree_raw`. tools/codegen needs a QueryKey for that tuple; the query is `no_hash`.
   - rustc_interface passes.ts `default_query_providers` lists `solve` among the pending crates. Add
     `solve.provide(providers.queries)` (upstream passes.rs:921), importing `src/rustc_trait_selection/lib.ts`'s `solve`.
   - solve_test/run.ts works around both (PORT(test)). Drop that workaround once they land.
2. **decls.ts** (rustc_trait_selection): make `visit_proof_tree` / `visit_proof_tree_at_depth` generic:
   `<R>(goal, [depth,] visitor: ProofTreeVisitor<R>): R`. Then drop the casts at analyse.ts, delegate.ts,
   derive_errors.ts, select.ts and run.ts.
3. **After trait-sel-traits-a/-b merge:**
   - repoint the PORT(merge) stand-ins above;
   - switch derive_errors.ts to the generated `FulfillmentError`;
   - drop `PENDING` entries in solve.test.ts. The fast-path run and proj.rs should then become byte-identical (re-run
     `REGEN=1` only if the pin changes).
4. **contract.test.ts** test 9 change (see Files). The traits lanes will need the same change.
5. Nothing in this lane touches `scripts/`, `harness/`, `tools/` or the oracle cache.

## Full test run
`RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4963 pass, 1 skip (the pre-existing linux-only one), 1 fail
(4965 tests, 310 files).
- The one failure was std/result.test.ts's lint "non-test code never reaches the one-argument unwrap_result". select.ts had
  a local helper of that name; it is renamed `unwrap_certainty`.
- After the fix, `src/std/result.test.ts` plus `src/rustc_trait_selection`, `src/rustc_infer` and
  `src/rustc_next_trait_solver` are green, and tsc is clean.
