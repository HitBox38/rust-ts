# Handoff: nts-assembly (wave 16, M3): rustc_next_trait_solver solve/assembly/{mod,structural_traits}.rs

Branch `lane/nts-assembly` (from the evalctxt-contract base aa18d24, no merges). Commits: mod.rs port;
structural_traits.rs port; unit tests; this handoff.

## Files touched
- `src/rustc_next_trait_solver/solve/assembly/mod.ts`: every fn of assembly/mod.rs in upstream order. That covers the
  `GoalKind_provided` bodies, `AssembleCandidatesFrom::should_assemble_impl_candidates`, the 13 `EvalCtxt` methods
  (the `unported_methods` call is gone), the `ReplaceOpaque` folder (ported inside
  `try_assemble_bounds_via_registered_opaques`, with markers on `cx` / `fold_ty`) and the `FindParamInClause` visitor.
- `src/rustc_next_trait_solver/solve/assembly/structural_traits.ts`: every fn of structural_traits.rs, plus the
  `ReplaceProjectionWith` folder and `From<RerunNonErased> for AmbiguousOrRerunNonErased`.
- New `src/rustc_next_trait_solver/nts_assembly.test.ts`: 21 tests.
- Nothing else. decls.ts, contract.test.ts and the other lanes' stubs are unchanged.

## Coverage
| file | `bun scripts/coverage.ts --missing` |
|---|---|
| solve/assembly/mod.rs | 55/55 |
| solve/assembly/structural_traits.rs | 16/16 |

`bun scripts/coverage.ts --check`: `markers ok (12351; vendor 3888)`.

## Checks
- `bunx tsc --noEmit -p .` is clean.
- Every module loads as a fresh-process entry point: lib.ts, assembly/mod.ts and structural_traits.ts.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Full test run" below.
- **No difftest was run.** Nothing outside the crate drives the solver yet (evalctxt-contract handoff), so a sample
  run would only re-run untouched code.

## Tests (`nts_assembly.test.ts`)
The tests use a fake `EvalCtxt`: an object on `EvalCtxt.prototype` that keeps this lane's methods real and replaces
the methods of nts-eval / nts-normalizes (`probe*`, `structurally_normalize_ty`, `try_merge_candidates`, ...). They
also use a fake `cx` and a fake `GoalKind` table that logs calls. The structural helpers run on a real `TyCtxt`.

What they cover:
- **Candidate order:** param-env, then builtin (lang-item dispatch), then unsize, then impls.
- **Failed param-env candidates:** their head usages are merged.
- **`EnvAndBounds`.**
- **Normalization failure:** it gives empty candidates, also on rerun (the FIXME(#155443) behaviour).
- **Coherence:** a knowable trait ref falls through.
- **Reflection mode:** it skips builtins.
- **`PointeeSized`:** it is unreachable.
- **`filter_specialized_impls`.**
- **`assemble_and_merge_candidates`:** forced ambiguity, rigid, where-bound preference and Misc shadowing.
- **The provided `GoalKind` methods:** fast reject, and the `Cell` source written inside `then`.
- **Auto, sizedness and copy/clone constituent types** for scalars, `str`, tuples, `&mut`, `()` and `!`.

**PENDING** (these need the other nts lanes merged):
- Real trait and projection goals through `assemble_and_evaluate_candidates`.
- The unknowable-coherence branch. It elaborates a real trait ref, so it needs a real `cx`.
- The param-env shadowing of impls. `has_no_inference_or_external_constraints` (solve/mod.rs, nts-normalizes) is
  a stub: `rustc_next_trait_solver::solve::has_no_inference_or_external_constraints`.
- `filter_specialized_impls` with `AllowInferenceConstraints::No`. It needs `has_only_region_constraints`, also an
  nts-normalizes stub. The current test asserts that it throws.
- `characterize_param_env_assumption` / `FindParamInClause` on real clauses. They need `replace_bound_vars`,
  `structurally_normalize_*` and `eager_resolve_region` (nts-eval / nts-normalizes).
- `predicates_for_object_candidate` / `ReplaceProjectionWith`. They need `probe` / `eq` / `eq_and_get_goals`
  (nts-eval).
- The callable extractors. They need the `fn_sig`, lang-item and coroutine queries of a real crate.

## `unported(...)` left
1. `assemble_alias_bound_candidates_recur` (the `Bound` and `Infer(Fresh*)` arms) and
   `assemble_object_bound_candidates` (the `Bound` and `Infer(TyVar|Fresh*)` arms). Upstream these are
   `panic!("unexpected self type for `{goal:?}`")`. That message needs `Debug` of `Goal<I, G>`, and the `GoalKind<G>`
   table has no Debug descriptor. Text: `rustc_next_trait_solver::solve::assembly::EvalCtxt::<fn>: panic message needs
   `{:?}` of `Goal<I, G>` (header)`. For root: adding `debug` to the `GoalKind` contract (decls/tables) would let
   these become real panics.
2. `debug_CandidateHeadUsages` is a pre-existing evalctxt-contract stand-in, kept as is. It is moved to the end of
   mod.ts and is for root / rustc_type_ir.
3. `fold_AsyncCallableRelevantTypes` is a pre-existing stand-in, kept as is. It waits for the codegen of the
   `TypeVisitable_Generic` / `TypeFoldable_Generic` derives.

## `// PORT:` decisions
1. **`Cell` in `probe_and_consider_param_env_candidate`:** a one-field box `{ value }` that both closures read.
2. **`candidates.extend(result)` over a `Result`:** pushes the `Ok` value only. This drops errors exactly as upstream
   does, `RerunNonErased` included.
3. **`EarlyBinder<impl IntoIterator>.iter_instantiated(..)`:** the items are collected into an array first. This
   applies to `item_*bounds`, `explicit_super_clauses_of` and `AdtDef::all_field_tys`, because binder.ts's
   `iter_instantiated` takes a slice. Instantiation is per element, so the items are the same.
4. **`Elaboratable for ty::Predicate`** (rustc_middle ty/elaborate_impl.rs:26) is not ported. mod.ts has a local
   stand-in (`Elaboratable_Predicate`), the same as elaborate.ts's `Elaboratable_Clause`. For root: port
   elaborate_impl.rs and drop it.
5. **Derived `PartialEq`:** `Canonical<Response>` and `OpaqueAliasTy` compare with `intern_key` (contract rule 4).
6. **`Result::expect` in `try_eagerly_replace_alias`:** panics with the upstream text
   `<msg>: NoSolution`.
7. **`Interner` calls** go through `as_interner(cx)` (nts-eval precedent). The call sites are
   `ir_for_each_relevant_impl` (the ty-contract `ir_` name), `ir_recursion_limit`, `for_each_blanket_impl` and the
   others. `Result<(), E>` visitor results use `VisitorResult.Result()` (`Ok(null)`).
8. **`TypeFlags` `A | B | C`** is `TypeFlags.union`.
9. **Local descriptors:** `fold_Goal(G)` (built from the table's `TypeFoldable` entries), `d_VecTy`,
   `d_ProjectionClause`, `d_Binder_CoroutineWitnessTypes` and `d_Clause_Span`. There is also an `upcast_tcx`
   helper (nts-eval precedent).

## infcx-contract `ir_` renames
- These files make no `InferCtxtLike` call. They only call `EvalCtxt` methods, so there are no
  `PORT(merge): ir_<name> after infcx-contract` markers.

## For root
- Merge after nts-eval. The runtime paths need `probe`, `probe_trait_candidate`, `evaluate_added_goals_*`, `eq`,
  `instantiate_binder_with_infer` and the others.
- Merge after nts-normalizes. The runtime paths also need `has_no_inference_or_external_constraints`,
  `has_only_region_constraints`, `try_merge_candidates`, `flounder` and `structurally_normalize_*`.
- Then move the PENDING cases above onto real goals.
- Optional: add a `debug` entry to `GoalKind<G>`. See `unported` item 1.

## Full test run
`RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4515 pass, 1 skip (the pre-existing linux-only one), 0 fail (4516 tests, 272 files).
