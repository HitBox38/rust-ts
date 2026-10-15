# Handoff: old-candidates-confirm (M3 wave 18c, old trait solver)

Branch `lane/old-candidates-confirm`, from `integ` 60a45cf, no merges.

## Result
- `compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs` -> `src/rustc_trait_selection/traits/select/candidate_assembly.ts`:
  all 27 `SelectionContext` methods, upstream order, candidate push order exactly upstream's. `unported_methods` list removed.
- `compiler/rustc_trait_selection/src/traits/select/confirmation.rs` -> `src/rustc_trait_selection/traits/select/confirmation.ts`:
  all 22 methods + the local `flatten_answer_tree` (nested function inside `confirm_transmutability_candidate`, marker :292).
  `unported_methods` list removed.
- No signature in `decls.ts` changed; no `declare module` overrides needed.
- New test: `src/rustc_trait_selection/traits/select/assembly_confirm.test.ts` (7 tests). The callers of this code
  (`candidate_from_obligation_no_cache`, `evaluate_candidate`, `poly_select`, ... in select/mod.rs) are still placeholders on
  this branch, so no difftest reaches it yet; the tests drive assembly/confirmation directly over a fresh `TyCtxt`
  (as traits_a.test.ts) with `as_lang_item` / `is_trait_alias` / `trait_is_auto` / `is_sizedness_trait` stubbed on the instance:
  ty-var fast path, `u32: Sized` / `str: MetaSized` / `str: Sized` through `assemble_candidates`, sized / copy-clone / tuple /
  unsize arms, the `FreshTy` `bug!` text, `confirm_candidate` for no-nested candidates, and a pinned stop:
  `confirm_candidate(SizedCandidate)` -> `rustc_trait_selection::traits::select::SelectionContext::sizedness_conditions`
  (old-select-b; re-pin to the real result after merge).

## Files touched
- `src/rustc_trait_selection/traits/select/candidate_assembly.ts` (rewritten from stub)
- `src/rustc_trait_selection/traits/select/confirmation.ts` (rewritten from stub)
- `src/rustc_trait_selection/traits/select/assembly_confirm.test.ts` (new)
- `docs/handoff/old-candidates-confirm.md` (this file)

## Coverage (`bun scripts/coverage.ts --missing`)
- select/candidate_assembly.rs: 27/27 ported
- select/confirmation.rs: 23/23 ported (22 methods + `flatten_answer_tree`)
- `--check`: markers ok (16207; vendor 3888)

## Checks
- `bunx tsc --noEmit -p .` clean.
- `bun test src/rustc_trait_selection src/rustc_infer --timeout=60000`: 143 pass, 0 fail (12 files).
- Samples (lane vs base 60a45cf, same args; base in a temporary worktree, removed):
  - tydump-minicore (46): 14 MATCH / 0 DIFF / 32 UNPORTED, both (lane `20261015-091854-old-candidates-confirm-zfwz`, base
    `20261015-092003-occ-base-sfgw`). Stops: 24x `SelectionContext::poly_select` (old-select-a), 6x
    `rustc_middle::mir::ConstraintCategory (mir, M4): BoringNoLocation`, 1x `TyCtxt::mk_pat (Pattern class)`, 1x
    `QueryKey for PseudoCanonicalInput<Ty>`.
  - thirdump-minicore (46): 14 / 0 / 32, both (`-091905-...-50r3` / `-092015-occ-base-r3he`); same stops.
  - tydump-nocore `--sample 100 --seed old-candidates-confirm`: 85 / 0 / 15, both (`-091916-...-9rib` / `-092027-occ-base-ag9q`).
    Stops: 11x `ConstraintCategory ... BoringNoLocation`, 3x `Target::parse_data_layout`, 1x `IntegerExt::from_int_ty`.
  - No status change is expected before merge: every old-solver path stops at `poly_select` first.

## `unported(...)` left
- `confirm_transmutability_candidate`: `rustc_transmute::Assume::from_const` and `rustc_transmute::TransmuteTypeEnv::is_transmutable`
  (crate not ported, no lane; the next solver's `SolverDelegate::is_transmutable` stops the same way).
- Calls into other lanes' methods (placeholders until merge, expected): old-select-a `for_each_item_bound`,
  `match_normalize_trait_ref`, `where_clause_may_apply`, `evaluate_root_obligation`; old-select-b `match_impl`,
  `rematch_impl`, `match_upcast_principal`, `match_where_clause_trait_ref`, `should_stall_coroutine`, `coroutine_is_gen`,
  `sizedness_conditions`, `copy_clone_conditions`, `constituent_types_for_auto_trait`, `collect_predicates_for_types`,
  `closure_trait_ref_unnormalized`, `impl_or_trait_obligations`.

## PORT decisions (please record)
1. `rustc_transmute::{Condition, Assume}` are local structural stand-ins in confirmation.ts (`TransmuteCondition`,
   `TransmuteAssume`, PORTING's enum representation) so `flatten_answer_tree` is ported as written; the two rustc_transmute
   calls are `unported`. Replace with the real types when rustc_transmute is ported.
2. `FxHashSet<TraitRef>` (`distinct_normalized_bounds`) is a `KeyedSet` on `intern_key`; `FxIndexSet<DefId>` (`a_auto_traits`,
   only `contains` is used) is a `DefIdSet`.
3. Guarded / or-pattern match arms are if-chains in upstream arm order where a `switch` cannot express them
   (`ty::Adt(def, _) if def.is_manually_drop()` in `confirm_bikeshed_guaranteed_no_drop_candidate`; the `(source, target)`
   tuple matches of the unsize fns; `ty::Alias(_, AliasTy { kind: Projection|Inherent|Free })` vs `Opaque` in
   `assemble_candidates_from_auto_impls`). No-op arms that differ only in a nested pattern (`ty::Ref(.., Not)` /
   `ty::Ref(.., Mut)` in `assemble_builtin_copy_clone_candidate`) share one `case` with both comments.
4. Lazy iterator chains whose items are consumed with side effects (`util::supertraits(..).enumerate().filter(probe)` in
   `assemble_candidates_from_object_ty`, `explicit_super_clauses_of(..).iter_instantiated_copied(..)` in
   `confirm_object_candidate`, the existential-predicate chains of `confirm_builtin_unsize_candidate`) are `for..of` loops /
   generators, so elaboration interleaves with the probes exactly as upstream; `assoc_types` is collected eagerly as upstream
   (`.collect()`).
5. `UpcastFrom<TyCtxt, X> for Predicate` fns are cast to `Obligation::new/with/with_depth`'s `(from, Interner)` signature
   (as effects.ts / infer.ts); `obligation.with(tcx, placeholder_predicate)` (a `TraitObligation`) uses an identity upcast.
6. `crate::traits::{util, normalize, evaluate_const}` are read through lazy `require` (init order); other crates are static imports.

## For root
- No shared files edited. `InferCtxt::evaluate_obligation` (used by `assemble_candidates_for_field_trait`) is installed by
  `rustc_trait_selection/lib.ts`'s import of traits/query/evaluate_obligation.ts, as upstream's `use ..::InferCtxtExt`.
- After merging old-select-a/-b: re-pin `assembly_confirm.test.ts`'s "reaches `sizedness_conditions`" test to the real
  result (`Builtin(Misc, [])` for `u32: Sized` once `sizedness_conditions` is ported), and run tydump-minicore /
  thirdump-minicore fully: assembly/confirmation become reachable then.
