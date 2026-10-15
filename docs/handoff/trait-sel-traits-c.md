# Handoff: trait-sel-traits-c (M3, wave 17): rustc_trait_selection coherence, effects, specialize, const_evaluatable

Branch `lane/trait-sel-traits-c`, from main `3e4773f`, no merges. No baselines, suites, oracle outputs, harness, scripts
or tools touched.

## Files
- **New (ports):**
  - `src/rustc_trait_selection/traits/coherence.ts` (traits/coherence.rs);
  - `src/rustc_trait_selection/traits/effects.ts` (traits/effects.rs);
  - `src/rustc_trait_selection/traits/const_evaluatable.ts` (traits/const_evaluatable.rs);
  - `src/rustc_trait_selection/traits/specialize/mod.ts` (traits/specialize/mod.rs);
  - `src/rustc_trait_selection/traits/specialize/specialization_graph.ts` (traits/specialize/specialization_graph.rs).
- **Edited:** `src/rustc_trait_selection/lib.ts`, five side-effect imports under `// pub mod traits;` (its header asks the
  lanes to add their modules there). `traits/mod.rs` (its `mod` lines, re-exports and `provide`) is lane
  trait-sel-traits-a's file; nothing else was edited.
- **Tests (new):**
  - `src/rustc_trait_selection/traits/coherence_specialize.test.ts` (4 tests);
  - `coherence_test/run.ts` (the TS side);
  - `coherence_test/probe.rs`, a rustc-dev probe that is not part of the build. Its header has the regenerate
    command (asm_oracle precedent);
  - `coherence_test/{graph,spec}.stdout`, the probe's recorded output;
  - test crates `coherence_test/{graph,spec,overlap,negpos}.rs`.

## Coverage (`bun scripts/coverage.ts --missing <file>`: 0 missing everywhere)
| upstream file | ported |
|---|---|
| traits/coherence.rs | 20/20 |
| traits/effects.rs | 11/11 |
| traits/const_evaluatable.rs | 3/3 |
| traits/specialize/mod.rs | 10/10 |
| traits/specialize/specialization_graph.rs | 9/9 |

`bun scripts/coverage.ts --check`: `markers ok (14418; vendor 3888)`. `bunx tsc --noEmit -p .`: clean.

## Results
- **graph.rs: 619 of 619 lines equal the pinned rustc's** (probe.rs, rustc-dev). The facts cover:
  - specialization graphs over 16 `SimplifiedType` buckets, blanket impls, and the `parent` / `children` maps (with the
    `IndexMap` order of `non_blanket_impls`);
  - every pairwise `overlapping_trait_impls` / `overlapping_inherent_impls`, some decided by `DeepRejectCtxt` and some
    by a failing `equate_impl_headers`;
  - `specializes` (false: specialization not enabled);
  - the orphan check of every impl in `Local{Proper}` / `Local{Compat}` / `Remote` modes, under fresh inference args;
  - `trait_ref_is_knowable`;
  - `translate_args` to `Node::Trait` / `Node::Impl(self)`.
- **spec.rs** (`min_specialization`, `negative_impls`): 39 of 41 lines match. Both other lines are `specializes` of two
  negative impls. They stop at `rustc_trait_selection::traits::normalize_param_env_or_error`, inside `param_env`
  (rustc_ty_utils' stand-in for lane trait-sel-traits-a). That text is in `PENDING_FACTS`.
- **E0119 (overlap.rs) and E0751 (negpos.rs):** the oracle emits them. The port stops at this lane's merge stand-ins:
  - `rustc_trait_selection::solve::SolverDelegate::root_goal_may_hold_with_depth`;
  - `rustc_trait_selection::traits::ObligationCtxt::new`.

  Both texts are in `PENDING_COHERENCE`. Once trait-sel-solve and trait-sel-traits-a are merged and repointed, the test
  compares stderr and exit code byte for byte with the oracle's.
- **E0117:** the orphan error itself is emitted by rustc_hir_analysis `coherence/orphan.rs` (lane coherence). This lane
  re-exports `orphan_check_trait_ref` / `trait_ref_is_knowable` (`pub use rustc_next_trait_solver::coherence::*`), and
  checks them against the probe above.
- **Negative control:** changing one DefId in graph.stdout fails the graph test.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src/rustc_trait_selection`: 4 pass.

## `unported(...)` left (all `PORT(merge)` stand-ins at the end of each file, for root to repoint)
- **Lane trait-sel-traits-a:**
  - `rustc_trait_selection::traits::ObligationCtxt::new`, in coherence.ts, specialize/mod.ts and const_evaluatable.ts;
  - `rustc_trait_selection::traits::ObligationCtxt::new_with_diagnostics` (coherence.ts);
  - `rustc_trait_selection::traits::predicates_for_generics` (specialize/mod.ts);
  - `rustc_trait_selection::traits::try_evaluate_const` and `rustc_trait_selection::traits::evaluate_const`
    (const_evaluatable.ts);
  - `rustc_trait_selection::traits::normalize::normalize_with_depth_to` (effects.ts).
- **Lane trait-sel-solve:**
  - `rustc_trait_selection::solve::SolverDelegate::root_goal_may_hold_with_depth`, meaning
    `<&SolverDelegate>::from(infcx)` plus the nts `SolverDelegateEvalExt` method;
  - `rustc_trait_selection::solve::normalize::deeply_normalize_for_diagnostics`.
- **Wave 19 (error reporting):**
  - `rustc_trait_selection::error_reporting::traits::overflow::suggest_new_overflow_limit`;
  - `rustc_trait_selection::error_reporting::traits::to_pretty_impl_header`.
- **Wave 20 (selcx-contract):**
  - `rustc_trait_selection::traits::select::IntercrateAmbiguityCause::add_intercrate_ambiguity_hint`.
- **Unassigned:**
  - `rustc_trait_selection::diagnostics::NegativePositiveConflict` (diagnostics.rs, a manual `impl Diagnostic`);
  - `rustc_middle::ty::elaborate_impl: impl Elaboratable for (Clause, Span)`. This is the same text
    min_specialization.ts uses.
- **Local type shapes standing in for other lanes' types** (structural, so the real ones satisfy them; delete them on
  repoint):
  - `SkipLeakCheck` (plus `SkipLeakCheck_is_yes`, a copy of the one-line upstream body);
  - `FulfillmentError`;
  - the `ObligationCtxt` method subsets;
  - `IntercrateAmbiguityCause`;
  - `EvaluateConstErr`;
  - `InspectGoal` / `InspectCandidate`;
  - `SelectionContext` (effects.ts);
  - `NotConstEvaluatable` (rustc_middle abstract_const.rs, not ported there).

## PORT decisions (please record)
1. **Extension traits.**
   - `GraphExt` (`insert`, `record_impl_from_cstore`) is assigned onto rustc_middle's generated `Graph.prototype`.
   - The private `ChildrenExt` is a module companion (`ChildrenExt.insert(children, ..)`), because `Children` is a
     plain interface.
2. **`FxIndexMap::entry(k).or_default()`** is a get-or-insert at the end of the map. This includes `filtered_children`,
   which inserts the empty bucket when it is called. This fixes the iteration order of `non_blanket_impls`; the probe
   confirms it (graph.rs `Tr`, 16 buckets).
3. **`ImplHeader`'s derived `TypeFoldable` / `TypeVisitable`** are hand-written in the generator's shape.
   - No codegen set covers rustc_trait_selection yet.
   - The `#[derive(Debug)]`s of `ImplHeader`, `OverlapError`, `FutureCompatOverlapError` and `Inserted` feed only
     `debug!`, so they are not ported.
4. **The three providers** are exported, and `traits::provide` (lane trait-sel-traits-a) installs them:
   - `specialization_graph_provider`;
   - `specializes(tcx, [a, b])`;
   - `specialization_enabled_in(tcx, LocalCrate)`.

   The test installs them through `override_queries`.
5. **Fn-local items move to module level:** `PlugInferWithPlaceholder`, const_evaluatable's `Visitor`, and
   `report_conflicting_impls`'s `decorate`.
6. **Lazy iterators.** Upstream feeds some iterators lazily into `register_obligations`; here they are generators, so
   normalization and registration interleave as upstream (the `const_conditions` in `specializes`).
7. **`?` of a `TypeError` into `NoSolution`** returns `Err(NO_SOLUTION)` (`impl From<TypeError> for NoSolution`).
   `cfg!(debug_assertions)` blocks are dead in the oracle and stay as comments.
8. **The probe in a test directory** (asm_oracle precedent). It runs `specialization_graph_of`, the overlap and orphan
   checks, knowability and `translate_args` on the pinned rustc, and its output is recorded in `<crate>.stdout`.

## For root
1. **Wire the providers.** When merging trait-sel-traits-a, its `traits::provide` must install
   `specialize::specialization_graph_provider` / `specializes` / `specialization_enabled_in`, and rustc_interface
   passes.ts must call it.
   - Today `specialization_graph_of provider (not ported)` is still what `TraitDef::ancestors` hits.
   - That text is in variance_outlives.test.ts `PENDING_DUMP`, and the next stop will be one of the stand-ins above.
2. **Repoint min_specialization.ts's stand-in** for `rustc_trait_selection::traits::specialize::translate_args_with_cause`
   (rustc_hir_analysis, lane variance-outlives) to `specialize/mod.ts`'s `translate_args_with_cause`.
3. **Repoint this lane's stand-ins** to trait-sel-traits-a / trait-sel-solve on merge. Then:
   - coherence_specialize.test.ts's E0119 / E0751 cases should turn into byte-identical oracle matches;
   - drop the matching `PENDING_COHERENCE` / `PENDING_FACTS` entries.
4. **traits/mod.rs re-exports.** traits/mod.ts (lane -a) should re-export:
   - from this lane: `OverlapResult`, `add_placeholder_note`, `overlapping_{inherent,trait}_impls`, `OverlapError`,
     `specialization_graph`, `translate_args`, `translate_args_with_cause`, `FutureCompatOverlapError{,Kind}`;
   - the nts orphan items, which coherence.ts already re-exports.
5. **Optional:** add a codegen set for rustc_trait_selection's derives. That would replace `fold_ImplHeader` /
   `clone_ImplHeader` and give the skipped Debug impls.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (14418; vendor 3888).
- Fresh-process loads of all five modules and of `rustc_trait_selection/lib.ts`: ok.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4964 pass, 1 skip (the pre-existing linux-only one),
  0 fail (4965 tests, 310 files).
- `RUST_TS_AGENT=trait-sel-traits-c bun scripts/difftest.ts --suite hir-tree-nocore --sample 100`: 100 MATCH, 0 DIFF,
  0 UNPORTED, 0 CRASH (run `20261015-000302-trait-sel-traits-c-nxb9`). No driver path reaches this lane's code yet
  (the providers are not wired), so no suite output changes.
