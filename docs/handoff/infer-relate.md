# Handoff: infer-relate (M3, wave 16): rustc_infer `infer/context.rs` and `relate/{mod,generalize,higher_ranked,lattice,type_relating}.rs`

Branch `lane/infer-relate` (from main `816b5c5`, no merges).

## Files touched
- `src/rustc_infer/infer/context.ts`: `impl InferCtxtLike for InferCtxt` (36 declared methods assigned onto `InferCtxt.prototype`,
  the 8 `ir_` ones included), the 25 served-by-inherent methods as marker comments, `lower_universe`, and the
  `TypeFolder` impl of `LowerUniverseFolder`. The `unported_methods` call is gone.
- `src/rustc_infer/infer/relate/generalize.ts`: `TermVid` companion (`from_TyVid` / `from_ConstVid`) + `TermVid_eq`; the 5
  `InferCtxt` methods; `NEEDS_GENERALIZATION`; `Generalizer`'s inherent methods and `TypeRelation` impl on its prototype.
- `src/rustc_infer/infer/relate/higher_ranked.ts`: `enter_forall_and_leak_universe`, `enter_forall`, `leak_check`.
- `src/rustc_infer/infer/relate/lattice.ts`: `LatticeOpKind.invert`; `LatticeOp` (`new`, `into_obligations`, `TypeRelation`,
  `relate_bound`, `PredicateEmittingRelation`).
- `src/rustc_infer/infer/relate/type_relating.ts`: `TypeRelating` (`new`, `into_obligations`, `TypeRelation`,
  `PredicateEmittingRelation`).
- `src/rustc_infer/infer/relate/mod.ts`: unchanged (no fns).
- `src/rustc_infer/infer/relate/infer_relate.test.ts` (new): 22 tests on a real `InferCtxt`.
- **Outside my files (please review):** `tools/codegen/infer.typemap.json`: `rustc_data_structures::sso::SsoHashMap` maps to
  `Map<$0, $1>` (was `SsoHashMap<$0, $1>`), set `rustc_infer` regenerated. The diff is only the three fields
  `Generalizer.cache`, `LowerUniverseFolder.cache`, and `Canonicalizer.sub_root_lookup_table` (lane
  infer-canonical-outlives' gen file), plus their dropped imports.
  - Why: these SsoHashMaps are lookup caches (get/insert only, never iterated). The ported `SsoHashMap` compares keys
    with `===` and needs a hashbrown `KeyType`, which a `(Ty, Variance, bool)` key or a pointer-hashed `Ty` cannot give.
    rustc_type_ir's data_structures already maps `SsoHashMap` to a JS `Map` (PORTING §5). A tuple-keyed one is a
    `KeyedMap` (`intern_key`) at its creation site.
  - infer-canonical-outlives: `Canonicalizer.sub_root_lookup_table` is now a plain `Map<TyVid, number>` (`new Map()`).

## Coverage (`bun scripts/coverage.ts --missing`)
| file | ported |
|---|---|
| infer/context.rs | 66/66 (36 assigned, 25 served-by-inherent markers, `lower_universe` + 4 folder fns) |
| infer/relate/mod.rs | 0/0 |
| infer/relate/generalize.rs | 17/17 |
| infer/relate/higher_ranked.rs | 3/3 |
| infer/relate/lattice.rs | 15/15 |
| infer/relate/type_relating.rs | 13/13 |

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4753 pass, 1 skip (pre-existing linux-only), 0 fail
  (4754 tests, 294 files). contract.test.ts stays green (my stub lists are gone; `TypeRelating.new` / `LatticeOp.new` exist).
- `bun scripts/coverage.ts --check`: `markers ok (13449; vendor 3888)`. `--missing` is 0 for all six files.
- Fresh-process `import()` of context.ts and each relate/*.ts: ok.
- `RUST_TS_AGENT=infer-relate bun scripts/difftest.ts --suite hir-tree-nocore --sample 100`: 100 MATCH, 0 DIFF, 0 UNPORTED,
  0 CRASH (run `20261014-162721-infer-relate-e78h`). Nothing on a driver path calls these files yet.

## Tests (`infer_relate.test.ts`)
Expectations are upstream semantics read off the pinned sources (vids, universes, `TypeError` variants, the `Subtype`
obligations).
- type_relating: `?0 == u32` both directions; `?0 == ?1` unifies (no obligation); `?0 <: ?1` / contravariant push
  `Subtype` obligations (`a_is_expected` true/false, operands flipped); `?0 <: (u32, ?1)` generalizes to `(u32, ?2)` with
  `?2` sub-unified with `?1` and one `Subtype(?2, ?1)` obligation; `?0 == (u32, ?1)` reuses `?1`; `u32 == i32` is
  `Sorts`.
- generalize (occurs check / universes): `?0 rel (u32, ?0)` is `CyclicTy(source)` for every variance and both
  directions, `?0` stays unknown; the check goes through unified variables; an unnameable placeholder is `Mismatch`, a
  nameable one instantiates; an invariant variable of a higher universe is replaced by a fresh U0 variable and lowered;
  `generalize` returns the generalized term without instantiating; `union_var_term` of mismatched kinds is an ICE; `TermVid`.
- higher_ranked / context: `enter_forall` gives `!1_0` placeholders in universe 1, no universe for a binder without bound
  vars; `instantiate_binder_with_infer` gives fresh variables; `TypeRelating::binders` (identity,
  `(u32,) <: for<T> (T,)` fails at the placeholder, `for<T> (T,) <: (u32,)` instantiates `T := u32`);
  `enter_forall_with_empty_assumptions` enters U1 then stops at `Assumptions::empty` (PENDING, see below).
- context: `cx`, `enable_next_solver_overflow_fcw`, `next_ty_infer`, `universe_of_ty`, `root_ty_var`, `equate_*_raw`,
  `instantiate_{ty,int,float}_var_raw`, `is_sub_unification_table_root_var`, `universe_of_const`, and `lower_universe` through
  `instantiate_ty_var_raw` (a U1 variable is replaced by a fresh U0 one and the root's universe drops to U0).
- lattice: `invert`; LUB/GLB of equal types; `Sorts` for unrelated rigid types (also nested); bivariance keeps the left
  operand; contravariance restores the kind.
- PORT(test) shims: the infer-core / infer-opaque-snapshot placeholders on these paths (`next_trait_solver`,
  `typing_mode_raw`, `next_ty_var(_in_universe)`, `next_const_var`, `try_resolve_{ty,const}_var`, `shallow_resolve` (TyVar
  arm), `shallow_resolve_const` (non-infer), `root_var`, `root_const_var`, `instantiate_binder_with_fresh_vars` (bound
  types), `universe`, `create_next_universe`, `TypeTrace::span`, `Obligation::new`) are installed from their upstream
  bodies **only while the method is still a placeholder** (`unported_stub_path`), with `spyOn` and restored in `afterAll`.
  After the merge the real ports run and the shims are skipped.

## `unported(...)` left
None in my files. Reached at runtime through other lanes' placeholders:
- infer-core: every inherent `InferCtxt` method of mod.rs called here (`next_trait_solver`, `shallow_resolve`,
  `try_resolve_*`, `root_var`, `next_*_var*`, `universe`, `create_next_universe`, `instantiate_binder_with_fresh_vars`,
  `get/overwrite_solver_region_constraint`, `fresh_args_for_item`, `universe_of_region`, `equate_regions`,
  `const_var_origin`, `take_opaque_types`, ...), `At::{eq_trace, sub}`, `InferCtxt::at`, `TypeTrace::span`,
  `InferOk::into_obligations`, `ToTrace_Ty.to_trace`.
- infer-regions: `RegionConstraintStorage::with_log` (`unwrap_region_constraints`), so every region path
  (`regions`, `ir_sub_regions`, `ir_equate_regions`, `shallow_resolve_region_var`, `ir_universe_of_region`, `leak_check`).
- infer-opaque-snapshot: `Obligation::new`, `handle_opaque_type`, `register_hidden_type_in_storage`,
  `OpaqueTypeTable::{deref, add_duplicate}`, `probe` / `commit_if_ok` (served by snapshot/mod.rs).
- infer-canonical-outlives: `register_solver_region_constraint`, `register_type_outlives_constraint`.
- rustc_data_structures: `Assumptions::empty()` stops at `TransitiveRelationBuilder::default` (merge-w16a "Other"), so
  `enter_forall_with_empty_assumptions` stops after entering the universe.

## PORT decisions (please record)
1. **Served-by-inherent `InferCtxtLike` methods** (25): their markers sit on comments in context.ts and nothing is assigned
   (assigning would recurse into itself; rustc_resolve macros.ts precedent). `probe` / `commit_if_ok` are among them:
   the inherent methods take a `(snapshot) => T` closure, so the trait's `() => T` closure is passed as is.
2. **`impl TypeFolder for LowerUniverseFolder`** is the class `TypeFolder_LowerUniverseFolder` holding the generated
   field interface `LowerUniverseFolder` as `self_`, because the generated type has no inherent methods and so is an
   interface, not a class.
3. **`Generalizer`** (generated class): its inherent methods and `TypeRelation` impl are prototype methods declared by a
   `declare module "./generalize.gen.ts"` block in generalize.ts. `TermVid`'s `From` impls are `TermVid.from_TyVid` /
   `.from_ConstVid` (rustc_middle `Term.from_Ty` precedent), and its derived `PartialEq` is `TermVid_eq`.
4. **`TypeRelating` / `LatticeOp`** (hand classes): fields in the class; the methods are declared by an interface merged
   in the same file and assigned onto the prototype in upstream order. `new` is the cast assignment
   (`(X as unknown as { new: .. }).new = ..`, the rustc_errors precedent of decls' `function new_; export { new_ as new }`).
   `TypeRelation::relate` (provided) is a prototype method that calls `TypeRelation_provided.relate`.
5. **Or-patterns with guards** (`(Opaque(def_id), _) | (_, Opaque(def_id)) if guard`): the guard is tried for each
   alternative that matches (Rust semantics), so it is `guard(a_def_id) || guard(b_def_id)`.
6. **`Obligation::new(.., pred)`** gets the upcast fn of the predicate: rustc_type_ir relate's `Upcast<T, Predicate>` is
   typed over `TyCtxt`, decls' `Obligation.new` over `Interner` (`I = TyCtxt`), hence a cast helper
   `as_obligation_upcast`. `register_goals` uses `upcast_from_self` (the reflexive `UpcastFrom`).
7. **`OpaqueTypeTable: Deref<Target = OpaqueTypeStorage>`** is the explicit `.deref()` (decls.ts).
8. **`SsoHashMap` caches** are JS `Map`s (typemap change above); `Generalizer.cache` is a `KeyedMap` on `intern_key`;
   `TypeRelating.cache` a `DelayedSet` on `intern_key` (solver_relating.ts precedent).
9. **`Result::unwrap_err`** of `try_resolve_{ty,const}_var` is a module-local `unwrap_err(r, debug_T)` that panics with
   upstream's message and the `Ok` value's Debug.
10. `#[instrument]`, `debug!`, `warn!` are dropped; `debug_assert*!` and the `#[cfg(debug_assertions)]` block of
    `lower_universe` stay as comments. `generalize_alias_term` still computes `infer_replacement_is_complete` (only its
    `warn!` is dropped).

## For root
- `infer.typemap.json` change (above): merge-time, infer-canonical-outlives must construct `sub_root_lookup_table` as a
  `Map` (if it wrote `SsoHashMap.new(..)` against the old gen file, tsc points at it).
- No decls.ts change was needed; no `PORT(decls)` augmentation of decls.ts was added.
- `Assumptions::empty()` (`TransitiveRelationBuilder::default`) blocks `enter_forall_with_empty_assumptions`, which the next
  solver's `SolverRelating::binders` calls through `InferCtxtLike`.
