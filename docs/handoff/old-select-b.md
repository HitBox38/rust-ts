# Handoff: old-select-b (M3 wave 18c, old trait solver)

Branch `lane/old-select-b`, from `integ` 60a45cf, no merges. Commits: port (select/mod.rs:1710..2797 + select/_match.rs)
→ unit tests → this handoff.

## Files touched
- `src/rustc_trait_selection/traits/select/mod.ts`: one contiguous region `==== lane old-select-b ====` placed directly
  before the `unported_methods(..)` call (after `tcx`), with its own import block at the top of the region (ESM hoists
  imports; kept apart from old-select-a's region to ease the merge). The 17 names of this lane are removed from the
  `unported_methods` list; old-select-a's 28 names are untouched.
- `src/rustc_trait_selection/traits/select/_match.ts`: rewritten (was the contract stub).
- New test: `src/rustc_trait_selection/traits/select/select_b.test.ts` (7 tests).
- Nothing else (no decls.ts change, no shared files).

## Ported (upstream order, markers)
- select/mod.rs `impl SelectionContext` (Winnowing, mod.rs:1710): `winnow_candidates` (1716), `prefer_lhs_over_victim` (1951).
- select/mod.rs `impl SelectionContext` (mod.rs:2023): `sizedness_conditions`, `copy_clone_conditions`, `coroutine_is_gen`,
  `constituent_types_for_auto_trait`, `collect_predicates_for_types`, `rematch_impl`, `match_impl`, `match_upcast_principal`,
  `match_where_clause_trait_ref`, `match_poly_trait_ref`, `match_fresh_trait_preds`, `push_stack`,
  `closure_trait_ref_unnormalized`, `impl_or_trait_obligations`, `should_stall_coroutine`.
- select/_match.rs: `MatchAgainstFreshVars::new` + the `TypeRelation` impl (`cx`, `relate_ty_args`, `relate_with_variance`,
  `regions`, `tys`, `consts`, `binders`; the provided `relate` forwards to `TypeRelation_provided`).

## Coverage (`bun scripts/coverage.ts --missing`)
- select/mod.rs 39/67 (was 22): the 28 missing are exactly old-select-a's (`poly_select` .. `match_projection_projections`).
- select/_match.rs 8/8 (was 0).
- rustc_trait_selection 403/976; TOTAL 15663/25518. `--check`: markers ok (16182).

## Checks
- `bunx tsc --noEmit -p .` clean.
- `bun test src/rustc_trait_selection src/rustc_infer --timeout=60000`: 136 pass, 0 fail (incl. contract.test.ts and the
  pinned `poly_select` stop in traits_a.test.ts, unchanged). New select_b.test.ts: 7 pass.
- Each of select/mod.ts, select/_match.ts, normalize.ts, fulfill.ts, lib.ts loads as a fresh entry point.
- Samples, lane vs base 60a45cf (same args; base run in a temporary detached worktree, removed afterwards), per-case
  status/stop diff = 0 in all three:
  - tydump-minicore (46): 14 MATCH / 0 DIFF / 32 UNPORTED both (lane 20261015-091059-old-select-b-axiq, base
    20261015-091149-old-select-b-base-et38). Stops: 24× `SelectionContext::poly_select`, 6× `ConstraintCategory (mir, M4)`,
    1× `TyCtxt::mk_pat`, 1× `QueryKey for PseudoCanonicalInput<Ty>`.
  - thirdump-minicore (46): 14 / 0 / 32 both (reut / bdoz), same stops.
  - tydump-nocore `--sample 100 --seed old-select-b`: 85 / 0 / 15 both (3qo2 / ainp); top stops `ConstraintCategory` 6,
    `Target::parse_data_layout` 3, `get_adt_def (ReprOptions)` 3.
  - As expected, no movement: every method of this lane is reached only through `poly_select` / `evaluate_*` / confirmation
    (old-select-a, old-candidates-confirm). The unit tests drive them directly instead: `MatchAgainstFreshVars`
    (fresh vars in `b`, `Sorts` for infer in `a`, structural tuples), `match_fresh_trait_preds`, `winnow_candidates`
    (single, Sized must-apply vs ambiguous, where-bound dedup / non-global / global+non-global ambiguity / global ignored for
    impls, Marker-mode alias bounds, alias/object/upcast lowest index and `has_non_region_infer`, impl vs builtin
    ambiguity), `sizedness_conditions` / `copy_clone_conditions` (incl. the verbatim `unreachable!` texts),
    `constituent_types_for_auto_trait`, `coroutine_is_gen`, `should_stall_coroutine`.

## `unported(...)` left
- None in this lane's scope. (Reached transitively: `normalize_with_depth[_to]` → `AssocTypeNormalizer` (ported; its
  project.rs callees are old-project's), `tcx.coroutine_hidden_types` / `type_of_opaque` / `impl_super_outlives` queries.)
- The generated `AutoImplConstituents` fold/visit still uses `unported_type_fold` for `ArgOutlivesClause` (selcx-contract
  report); `Binder::dummy` visits it only with empty `assumptions` here, but the `CoroutineWitness` arm of
  `constituent_types_for_auto_trait` produces non-empty `assumptions`, which a later fold/visit of the binder would hit.

## PORT decisions (please record)
1. Derived `PartialEq` of `PolyTraitClause` / `TraitRef` in `winnow_candidates` is the `eq` of their `Relate`
   descriptors (`relate_Binder(relate_TraitClause)`, `relate_TraitRef`): `Binder` compares the value by key and
   `bound_vars` by pointer.
2. `Iterator::try_reduce` with an `Option` closure → local `try_reduce` returning `{ $: "Some", _0: T | undefined } |
   undefined` (`Option<Option<T>>`, PORTING §5).
3. `push_stack` stores its own copy of `previous_stack` (`clone_TraitObligationStackList`), since the hand class's `next()`
   mutates in place and Rust moves a `Copy` value into the stack.
4. `should_stall_coroutine`: the uninhabited `ErasedNotCoherence(CantBeErased)` arm (no upstream arm) returns its `never`
   payload.
5. Lazy intra-crate reads in the region: `normalize_mod_b()` (normalize.rs) and `util_mod_b()` (util.rs), `require` inside
   bodies (normalize.ts imports select/mod.ts). `./_match.ts` is a static import (it imports only other crates).
6. `match_upcast_principal`: `FxIndexSet<DefId>` → `DefIdSet`; `projection_bounds()` (an eager array in the port) is
   filtered by a lazy generator so the `probe`s run in upstream order and stop after the second match.
7. `matches!(.., Infer(IntVar | FloatVar))` style arms on `TyKind::Infer` are split by the inner `InferTy` inside one
   `case "Infer"` (other `InferTy`s go to the upstream `bug!` arm).

## For root / merge
- Merge with old-select-a: both lanes edit select/mod.ts. Mine is one block between `tcx` and `unported_methods(..)`,
  delimited by `==== lane old-select-b` / `==== end of lane old-select-b` comments, with its own imports inside. If
  old-select-a also defines lazy helpers or descriptors (`d_PolyTraitClause`, `normalize` helpers), dedupe at merge
  (TS will report duplicate identifiers). Value imports that collide with the file's top imports were aliased
  (`EvaluationResult as EvaluationResultC`).
- old-candidates-confirm calls `rematch_impl`, `impl_or_trait_obligations`, `match_upcast_principal`,
  `closure_trait_ref_unnormalized`, `collect_predicates_for_types`, `*_conditions`, `constituent_types_for_auto_trait`
  with the decls.ts signatures (unchanged).
