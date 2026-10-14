# Handoff: infer-canonical-outlives (M3, wave 16): rustc_infer canonical/* and outlives/{mod,obligations,test_type_match,verify}

Branch `lane/infer-canonical-outlives` (from main `816b5c5`, no merges). Stubs filled per docs/handoff/infcx-contract.md
"How to fill a stub". decls.ts, the `.gen.ts` files, codegen data and every other lane's file are unchanged.

## Files touched
- **Ported** (`// rustc:` markers, upstream order), all under `src/rustc_infer/infer/`:
  - `canonical/mod.ts`, `canonical/canonicalizer.ts`, `canonical/instantiate.ts`, `canonical/query_response.ts`;
  - `outlives/mod.ts`, `outlives/obligations.ts`, `outlives/test_type_match.ts`, `outlives/verify.ts`.
- **New test:** `infer_canonical_outlives.test.ts` (27 tests).
- **New oracle:** `canonical_outlives_oracle/{probe.rs,empty.rs,oracle.stdout}` (rustc-dev program, same pattern as
  nts-canonical's `canonical_oracle`; `REGEN=1` rebuilds the probe and rewrites the fixture).

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_infer/src/infer/<file>`)
canonical/mod 2/2, canonical/canonicalizer 33/33, canonical/instantiate 13/13, canonical/query_response 10/10,
outlives/mod 4/4, outlives/obligations 28/28, outlives/test_type_match 12/12, outlives/verify 8/8 (every `--missing` 0).
`bun scripts/coverage.ts --check`: `markers ok (13443; vendor 3888)`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4758 pass, 1 skip (pre-existing linux-only), 0 fail.
  (Run before the last commit, which only switched `sub_root_lookup_table` to a `Map`; `bun test src/rustc_infer` and
  tsc re-run green after it.)
- Every touched module, `src/rustc_infer/lib.ts`, `src/rustc_trait_selection/lib.ts` and `src/rustc_middle/lib.ts` load
  as fresh-process entry points (init-order rule respected: other rustc_infer modules are read in function bodies only).
- `RUST_TS_AGENT=infer-canonical-outlives bun scripts/difftest.ts --suite hir-tree-nocore --sample 100`: 100 MATCH,
  0 DIFF/UNPORTED/CRASH (run `20261014-163502-infer-canonical-outlives-5bv8`). Nothing in a driver path calls this code
  yet, so no suite output changes.

## Tests and oracle
- **Probe** (`canonical_outlives_oracle/probe.rs`): runs the pinned rustc to `after_expansion`, builds real old-solver
  `InferCtxt`s with a fixed set of variables (ty vars in U0/U1/U2, a sub-unified pair, an equated pair, a resolved var,
  int/float vars (one resolved), const vars (one resolved to `N`), region vars, placeholders) and calls the real
  rustc_infer entry points: `canonicalize_response` (3 cases incl. >8 vars = the `spilled`/`indices` path),
  `canonicalize_user_type_annotation` (2, incl. the `preserve_universes` assertion panic), `canonicalize_query` with
  `ParamEnv::empty()` (2), `instantiate_canonical` (in a fresh infcx, with sub-unification roots), `TypeOutlives::
  type_must_outlive` with a recording delegate (5: refs/params/tuples/placeholders/fn ptr, implicit bound) and
  `extract_verify_if_eq` (7: bound/free/unconstrained regions, mismatch, repeated binding).
- **All 20 oracle cases match byte-for-byte** on a real `InferCtxt` (`tcx.infer_ctxt().build(..)`).
  - `canonicalize_query` itself stops UNPORTED at the `ParamEnv` derive (see below); the test asserts that, and
    compares the oracle with `Canonicalizer.canonicalize_with_base(empty param env, value, .., CanonicalizeAllFreeRegions)`,
    which is exactly what `canonicalize_query` does after `get_or_insert` returns for `ParamEnv::empty()`.
  - Negative controls: making `CanonicalizeQueryResponse::preserve_universes` false fails 3 cases; swapping the
    `push_sub_region_constraint` arguments / inverting `bind`'s equality fails 5.
- **PORT(test) shims.** The infer/mod.rs methods these paths call (`universe`, `create_next_universe`,
  `next_*_var*`, `root_var`, `try_resolve_*`, `shallow_resolve_{int,float}_var`, `sub_unify_ty_vids_raw`, ...,
  `in_snapshot`) are lane infer-core's placeholders in this base. `shim(infcx)` installs their upstream bodies
  (one-liners over the ported ena tables, quoted per shim) on the test's instance only; the prototype keeps the
  placeholders. Once infer-core lands, the shims can be deleted (they are identical to upstream).
- **Semantics tests** (no oracle, derived from upstream and documented per test): `instantiate_value` /
  `Canonical_instantiate` (empty var values, length assertion), `fold_clauses` + `highest_var_in_clauses` + the two
  `GlobalCaches` caches, `query_response_instantiation_guess` (Ty vars never guessed, region/int guessed, placeholder
  mapped back, fresh universe), `make_query_region_constraints` (empty, verify assertion), region obligation /
  assumption registration with undo-log rollback and the in-snapshot panics, `process_registered_region_obligations`
  on no obligations, the `&InferCtxt` `TypeOutlivesDelegate`, `explicit_outlives_bounds`.

## `unported(...)` left / reachable stops
- `obligations.ts`: `TransitiveRelationBuilder::default` (`destructure_solver_region_constraints_for_regionck`) and
  `TransitiveRelation::maybe_map` (`..._for_borrowck`): rustc_data_structures transitive_relation.rs is not ported
  (same stand-in names as rustc_type_ir region_constraint.ts). Only reached with `-Zassumptions-on-binders`.
- Reached through other lanes' stubs (not mine):
  - `canonicalize_query` → `CanonicalParamEnvCache::get_or_insert` → `visit_with_ParamEnv` (rustc_middle derive stub);
  - `erase_and_anonymize_regions` (rustc_middle stub) → every verify path with caller bounds / matching region-bound
    pairs, `can_match_erased_ty`, `approx_declared_bounds_from_env`;
  - `mir::ConstraintCategory` (M4): `SubregionOrigin::to_constraint_category` / `ObligationCause::to_constraint_category`
    → `make_query_region_constraints` with constraints, `process_registered_region_obligations` with obligations,
    the NLL path, alias outlives;
  - `QueryRegionConstraint`'s generated TypeFoldable/Debug are `unported_type_fold`/`unported_debug` → canonicalizing a
    `QueryResponse` with non-empty constraints, NLL instantiation of constraints;
  - infer-core (`at().eq`, `SubregionOrigin` companions, mod.rs methods), infer-regions (region constraint collector,
    `OutlivesEnvironment` accessors, `GenericKind::to_ty`, `VerifyBound::{or,must_hold}`, `resolve`), infer-opaque-snapshot
    (opaque type storage, `in_snapshot`), traits/engine (`evaluate_obligations_error_on_ambiguity`).

## PORT decisions
1. `trait CanonicalizeMode` is an interface; its four unit-struct impls are frozen singleton objects
   (`CanonicalizeQueryResponse`, ...). `Canonicalizer` is the generated class: `TypeFolder` impl + inherent methods on
   the prototype, `canonicalize` / `canonicalize_with_base` as statics. `canonicalize_mode` (generated `unknown`) is read
   through a typed accessor.
2. `OriginalQueryValues.var_values` is a `SmallVec<[_; 8]>`: `spilled()` is `len > 8` (the vector only grows).
3. `universe_map.binary_search` + insert is a linear search for the sorted insertion point; `HashMap` `Index` panics with
   std's "no entry found for key".
4. `sub_root_lookup_table` is a `Map` (`// PORT(merge): SsoHashMap -> Map (infer-relate typemap)`, 2 sites, cast because
   this base's generated type is still `SsoHashMap`). **Root: after merging infer-relate's typemap the casts are
   redundant and can be dropped.**
5. `CanonicalExt` is the free fns `Canonical_instantiate` / `Canonical_instantiate_projected`; `CanonicalInstantiator` and
   `HighestVarInClauses` are module-local classes; `clauses_cache` is keyed by `intern_key([clauses, args_prefix])`.
6. `QueryResponse` has no generated TypeFoldable (codegen bug, infcx-contract "For root" 3a): `fold_QueryResponse(d_R)`
   in query_response.ts writes out the derive over the generated field impls. Bare `ty::RegionConstraint` and
   `ArgOutlivesClause` use local descriptors over rustc_type_ir's generated impls.
7. `TypeOutlives` is the generated class; `TypeOutlivesDelegate` stays the interface (contract); `impl
   TypeOutlivesDelegate for &InferCtxt` is `InferCtxt_TypeOutlivesDelegate(infcx)`. `ConstraintCategory` is `unknown`.
8. `VerifyBoundCx`, `MatchAgainstHigherRankedOutlives`, `TypeOutlives` get static `new` via `function new_; export
   { new_ as new }` declarations (rustc_errors precedent). `MatchAgainstHigherRankedOutlives.map` is a `KeyedMap` on
   `intern_key` (keyed by the `BoundRegion` struct).
9. Lazy iterator chains are evaluated in upstream order: `alias_bound` collects the env/definition bounds after
   `recursive_bound`; `bound_from_components` collects then applies the `(next, next)` match (same results/side effects).
10. `binders` in `MatchAgainstHigherRankedOutlives` returns on `Err` before `shift_out` (as upstream's `?`).
11. Rust `assert!(cond, "..{:#?}..")` messages are formatted only when the assertion fails.
12. canonical/mod.ts re-exports `rustc_middle::infer::canonical::*`, `CanonicalExt` and `query_response`; outlives/mod.ts
    re-exports `env`, `obligations`, `test_type_match`, `verify` as namespaces (the `pub mod`s).
13. The stub's comment about `impl TypeOutlivesDelegate for (A, B)` was dropped: no such impl exists at the pin.

## For root
1. Record the PORT decisions above. Decision 4 needs reconciling with infer-relate's typemap at merge.
2. Codegen: give `QueryResponse` a TypeFoldable (generator bug 3a) and map `QueryRegionConstraint.constraint` to
   rustc_type_ir's `RegionConstraint` (its fold/Debug are `unported_*` now); `ParamEnv`'s TypeVisitable/TypeFoldable
   (blocks `canonicalize_query`).
3. `mir::ConstraintCategory` (M4) blocks regionck (`process_registered_region_obligations` with any obligation) and
   query-response region constraints: consider generating the type early.
4. The test shims (`shim()` in infer_canonical_outlives.test.ts) should be deleted after infer-core merges.
