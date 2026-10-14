# Handoff: nts-canonical (wave 16, M3): rustc_next_trait_solver canonical/*, placeholder, coherence, normalize, inspect/build

Branch `lane/nts-canonical` (from the evalctxt-contract tip aa18d24, no merges). It is the nts-canonical row of the
split table in docs/handoff/evalctxt-contract.md. The stubs were filled in place, following that handoff's "Contract
rules".

## Files touched
All files are under `src/rustc_next_trait_solver/`.
- **Ported** (stubs filled, `// rustc:` markers, upstream order; the file headers now say "Port of"):
  - `canonical/canonicalizer.ts`
  - `canonical/mod.ts`
  - `placeholder.ts`
  - `coherence.ts`
  - `normalize.ts`
  - `solve/inspect/build.ts`
- **New test:** `nts_canonical.test.ts` (19 tests).
- **New oracle:**
  - `canonical_oracle/probe.rs`: a rustc-dev program, same pattern as ty-sty's `sty_oracle`;
  - `canonical_oracle/empty.rs`;
  - `canonical_oracle/canonical.stdout`: the fixture. `REGEN=1` rebuilds the probe and rewrites the fixture.

Nothing outside this lane's files was edited. decls.ts, delegate.ts, contract.test.ts and the other stub modules are
unchanged.

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_next_trait_solver/src/<file>`)
| file | ported |
|---|---|
| canonical/mod.rs | 22/22 |
| canonical/canonicalizer.rs | 14/14 |
| placeholder.rs | 14/14 |
| coherence.rs | 11/11 |
| normalize.rs | 7/7 |
| solve/inspect/build.rs | 23/23 |

`bun scripts/coverage.ts --check`: markers ok (12401; vendor 3888).

## Checks
- `bunx tsc --noEmit -p .` is clean.
- `bun test src/rustc_next_trait_solver`: 25 pass (contract.test.ts 6, nts_canonical.test.ts 19).
- Full run: see "Full test run" at the end.
- Every module of the crate still loads as a fresh-process entry point.
- **No sample difftest was run.** Nothing outside the crate imports the solver yet (wave 17 wires it up), so a difftest
  would only re-run untouched code. evalctxt-contract did the same.

## Tests and oracle
- **The probe** (`canonical_oracle/probe.rs`) runs the pinned rustc with `after_expansion`. It builds a next-solver
  `InferCtxt` in `TypingMode::Coherence` with:
  - universes U1 and U2;
  - `?0t` (U0), `?1t` (U2), and `?2t` (U1, sub-unified with `?0t`);
  - `?0i`, `?0f`, `'?0` (U0), `'?1` (U2) and `?0c` (U2);
  - placeholder ty/region/const in U2, plus one region placeholder in U0;
  - params, `'static` and `'{erased}`.

  It wraps that `InferCtxt` in a minimal `SolverDelegate`. Its `instantiate_canonical*` methods are copied from
  rustc_trait_selection's delegate; the rest are `unimplemented!()`. It then canonicalizes with the **real**
  `Canonicalizer`:
  - **Response mode.** It calls the public `make_canonical_state`, which runs `canonicalize_response` on
    `inspect::State`. There are 5 cases:
    - max input universe U1, U2 and ROOT;
    - a placeholder from an input universe, which gives the `new placeholder in universe` panic;
    - a case with more than 16 variables, which exercises the `variable_lookup_table` path.
  - **Input mode.** It calls `SolverDelegateEvalExt::evaluate_root_goal` on `WellFormed(<tuple>)` with an empty
    `ParamEnv`. That runs the real `canonicalize_goal`, then reaches the probe's `build_with_canonical`, which records
    the `CanonicalQueryInput` and unwinds.
    - The original values come from `evaluate_root_goal_for_proof_tree` (`GoalEvaluation::orig_values`).
    - The `params` case has no original values: the solver itself rejects params and placeholder consts in
      `WellFormed`.
- **The TS side** uses a fake `InferCtxtLike` with the same vids, universes and sub-unification roots, and a fake
  `SolverDelegate`.
  - Response cases go through the ported `make_canonical_state`.
  - Input cases go through `Canonicalizer.new(Input(Predicate))`, then `fold_ty`, then `finalize`. That is exactly what
    `canonicalize_input` does for this goal: an empty `ParamEnv` gives a fresh `Predicate` canonicalizer, and the
    predicate fold reaches `fold_ty(term)`.
  - **All 7 oracle cases match byte-for-byte.** That covers:
    - var order and sub-roots;
    - the universe mapping;
    - `'static` and `'{erased}` handling;
    - params and placeholders becoming anonymous root placeholders;
    - the fold cache;
    - the >16 lookup path;
    - the panic text.
  - **Negative control.** Removing the fake's sub-unification fails 5 of the 7 oracle tests.
- **Tests from upstream semantics** (no oracle):
  - `canonicalize_input` stops UNPORTED at the `ParamEnv` traversal (see below).
  - Canonicalize → instantiate round trip, with a test-local copy of rustc_infer's `CanonicalInstantiator`.
  - `response_no_constraints_raw` gives the identity response.
  - `instantiate_and_apply_query_response` on the identity response. The expected log of calls:
    - only the `Ty` kind gets a fresh var;
    - `ResponseRelating` equates it with the original;
    - the region is always equated.
  - `BoundVarReplacer` / `PlaceholderReplacer` round trip, with lazy universe creation. Also the `Bound vars ..
    outside of self.universe_indices` panic text.
  - Orphan check:
    - Remote mode finds the infer var;
    - Local mode reports `UncoveredTyParams`;
    - `NonLocalInputType([(u8, Yes), (i32, No)])`;
    - a normalization error passes through;
    - `trait_ref_is_knowable` returns `Downstream` and `Ok`.
  - `NormalizationFolder` leaves alias-free types alone.
  - `ProofTreeBuilder` / `EvaluationStepBuilder`:
    - root plus a nested probe, including the final-state canonicalization;
    - the noop builders;
    - the `assert_eq!(prev, None)` panic text.

## `unported(...)` left
None of the six files calls `unported`. Paths that still stop UNPORTED in other lanes' code:
1. **`Canonicalizer::canonicalize_param_env` stops at the `ParamEnv` traversal.**
   - It calls `has_type_flags` / `has_non_region_infer` / `fold_with` on the `ParamEnv`, through the local descriptor
     `fold_ParamEnv_`.
   - That descriptor uses rustc_middle ty/mod.ts's `visit_with_ParamEnv` / `try_fold_with_ParamEnv` /
     `fold_with_ParamEnv`, which are stubs for the derive (mod.rs:1018).
   - So `canonicalize_input` and `canonicalize_goal` stop UNPORTED until codegen covers `ParamEnv`. This blocks
     nts-eval's goal evaluation at runtime. **Root: add `ParamEnv` to a codegen set.**
2. **`Assumptions::empty()`** (rustc_type_ir region_constraint.ts, tyir-misc) is reached only with
   `-Zassumptions-on-binders`. Two places call it:
   - `compute_query_response_instantiation_values`;
   - `BoundVarReplacer::replace_bound_vars`.
3. **Generated `debug_Canonical`** prints `var_kinds` through `unported_debug` (tyir-misc "For root" item).
   - So `debug_WipProbeStep`, `debug_WipProbe` and rustc_type_ir's `debug_Probe` stop UNPORTED on a canonical state.
   - The test formats `Canonical { .. }` by hand, with the same field order.

## PORT decisions
1. **Locally built D4 descriptors**, each from the generated or stub free fns, kept at the end of the file that uses
   it:
   - `fold_ParamEnv_` (canonicalizer.ts);
   - `fold_Response` and `fold_State(d_T)` (canonical/mod.ts);
   - `fold_AliasTy` and `fold_AliasConst` (normalize.ts);
   - `visit_TraitRef` (coherence.ts);
   - `fold_unit` and `fold_Goal_Predicate` (inspect/build.ts).

   If codegen later emits shared descriptors, these can be replaced.
2. **`Canonicalizer::finalize`:**
   - `usize::saturating_sub` is `Math.max(0, ..)`;
   - `.max().unwrap_or(ROOT)` is a loop;
   - `mem::take(&mut state.variables)` swaps in a new array.
3. **`get_or_insert_bound_var`:** `entry().or_insert_with` / `position` are written out. The order of side effects is
   kept: push to `variables`, then `var_kinds`, then insert the table entry.
4. **`slice[idx]` reads and writes.**
   - canonical/mod.ts (`opt_values`, `original_values[expect_placeholder_index]`) and placeholder.ts (`universe_for`)
     use `index_get` / `index_set` helpers. They panic with core's "index out of bounds" text.
   - normalize.ts's `self.universes.first().unwrap().unwrap()` is a single `unwrap`, because both panics have the
     same message.
5. **`ResponseRelating::binders`:** derived `PartialEq` of `Binder` is `intern_key(a) === intern_key(b)` (contract
   rule 4).
6. **`ResponseRelating::tys`:** the `match` on `(a.kind(), b.kind())` is an if-chain in arm order.
7. **`instantiate_and_apply_query_response`:**
   - `r.clone()` of `NextGen` constraints is dropped, because the value is immutable;
   - `normalization_nested_goals.clone()` is a shallow copy of `_0`.
8. **`CanonicalVarValues::instantiate` and `ExternalConstraintsData::new`** take `cx: Interner`. They get
   `as_interner(delegate.cx())` (rustc_type_ir predicate.ts precedent).
9. **The stub of canonical/mod.ts imported the wrong `RegionConstraint`** (region_constraint.rs's struct).
   - `register_region_constraints` now takes rustc_type_ir predicate.ts's `RegionConstraint` (`ty::RegionConstraint`,
     the `Outlives` / `Eq` enum). That is upstream's type, and the type generated `ExternalRegionConstraints::Old`
     holds.
   - delegate.ts's `make_deduplicated_region_constraints` has the same mistake; see "For root".
10. **`assert_ne!`** in `finish_probe` and the two `assert_eq!(prev, None)` produce core's panic text inline or through
    `assert_eq`.
11. **inspect/build.ts header.** It said the file belonged to nts-eval. Corrected to nts-canonical, as the split table
    and this lane's brief say.

## For root
1. **infcx-contract merge (root's request).** infcx-contract renames 8 `InferCtxtLike` methods to `ir_<name>`. The call
   sites here are marked `// PORT(merge): ir_<name> after infcx-contract` and need the rename at merge:
   - `canonical/canonicalizer.ts:570` `universe_of_region` → `ir_universe_of_region`;
   - `canonical/mod.ts:179` `register_solver_region_constraint` → `ir_register_solver_region_constraint`;
   - `canonical/mod.ts:453` `equate_regions` → `ir_equate_regions` (`ResponseRelating::regions`);
   - `canonical/mod.ts:552` `sub_regions` → `ir_sub_regions` (`register_region_constraints`);
   - `canonical/mod.ts:566` `equate_regions` → `ir_equate_regions` (`register_region_constraints`);
   - `canonical/mod.ts:581` `register_hidden_type_in_storage` → `ir_register_hidden_type_in_storage`.

   The fake infcx in `nts_canonical.test.ts` uses the old names `equate_regions` and `register_hidden_type_in_storage`
   as object keys, so rename them there too. No call site uses `fresh_args_for_item`,
   `get_solver_region_constraint` or `overwrite_solver_region_constraint`.
2. **delegate.ts:** `make_deduplicated_region_constraints(): [RegionConstraint, VisibleForLeakCheck][]` imports
   `RegionConstraint` from region_constraint.ts. Upstream it is `ty::RegionConstraint`, which is predicate.ts's.
   Please correct it; decision 9 above has the details.
3. **Codegen:** add `ParamEnv`'s `TypeVisitable` / `TypeFoldable`; until then the solver cannot canonicalize a goal
   (`unported` 1). Also give `debug_Canonical` a Debug for `I::CanonicalVarKinds` (`unported` 3).
4. **Probe:** `canonical_oracle/probe.rs` could move to tools/probes if root wants a shared home. The test regenerates
   it in place, like `sty_oracle`.

## Full test run
`RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4513 pass, 1 skip (the pre-existing linux-only one),
0 fail (4514 tests, 272 files). This run started before the last commit, which changed only comments and test typings;
`bun test src/rustc_next_trait_solver` and `bunx tsc` were re-run green afterwards.
