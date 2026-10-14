# Handoff: infer-regions (M3, wave 16)

Branch `lane/infer-regions` (from main `816b5c5`, no merges). Ports the infer-regions row of the infcx-contract split
table: rustc_infer `region_constraints/{mod,leak_check}.rs`, `lexical_region_resolve/{mod,indexed_edges}.rs`,
`free_regions.rs`, `outlives/env.rs`.

## Files
- **Ported (hand modules; the `.gen.ts` files are unchanged):**
  - `src/rustc_infer/infer/region_constraints/mod.ts`: `RegionConstraintStorage` (hand class, `CombineMap`s are now
    `KeyedMap`s), `Constraint`, `RegionConstraintCollector` (all methods), the `RegionSnapshot` / `GenericKind`
    Debug impls, `display_GenericKind`, the `GenericKind` / `VerifyBound` companions,
    `RegionConstraintData::is_empty`, `Rollback for RegionConstraintStorage`;
  - `src/rustc_infer/infer/region_constraints/leak_check.ts`: `leak_check`, `LeakCheck`, `SccUniverse::take_min`,
    `MiniGraph`;
  - `src/rustc_infer/infer/lexical_region_resolve/mod.ts`: `resolve`, `RegionResolutionError::origin`, `LexicalResolver`
    (all methods, including the nested `region_order_key` / `process_edges`), `debug_RegionAndOrigin`,
    `LexicalRegionResolutions`;
  - `src/rustc_infer/infer/lexical_region_resolve/indexed_edges.ts`: `build_index`, `adjacent_edges`;
  - `src/rustc_infer/infer/free_regions.ts`: `RegionRelations`, `FreeRegionMap`;
  - `src/rustc_infer/infer/outlives/env.ts`: `OutlivesEnvironment` (`from_normalized_bounds`, accessors),
    `clone_OutlivesEnvironment`, `new_RegionBoundPairs`.
- **New test:** `src/rustc_infer/infer/infer_regions.test.ts` (31 tests).
- **Edited outside the lane (please review):** `src/rustc_infer/contract.test.ts`. Test "the contract's placeholders
  stop as UNPORTED" asserted that `unwrap_region_constraints()` stops at the `RegionConstraintStorage::with_log`
  placeholder. This lane ports `with_log`, so that one assertion is now a comment. Nothing else in the file changed.

## Coverage (`bun scripts/coverage.ts --missing`)
- region_constraints/mod.rs 34/34;
- region_constraints/leak_check.rs 10/10;
- lexical_region_resolve/mod.rs 24/24;
- lexical_region_resolve/indexed_edges.rs 2/2;
- free_regions.rs 7/7;
- outlives/env.rs 5/5.

The total is 82 fns, `--missing` is 0 for every file, and `coverage.ts --check` reports `markers ok`.

## Tests
`infer_regions.test.ts` runs on `tcx.infer_ctxt().build(..)` over a bare `TyCtxt`, as contract.test.ts does.
- **Collector:**
  - region var creation (vids, origins, universes, unification keys);
  - `make_subregion` / `make_eqregion` classification and unification;
  - `universe`, `add_verify`'s `AllBounds([])` skip, `lub_regions` / `glb_regions`;
  - `combine_vars`: max universe, edge order, memoization per ordered pair, rollback of combinations;
  - snapshots: `region_constraints_added_in_snapshot`, `vars_since_snapshot`, rollback through `InferCtxtInner`;
  - `take_and_reset_data` (un-unification, and the panic inside a snapshot);
  - `iter_outlives`, the `VerifyBound` algebra, `GenericKind` Debug and `to_ty`.
- **Lexical resolution:**
  - expansion across `VarSubVar` in the changes pass;
  - two unrelated params, giving `'static`, then `SubSupConflict` with the lower bounds in reverse constraint order;
  - `ConcreteFailure`;
  - placeholder universes, where the value grows to `'static`;
  - `UpperBoundUniverseConflict`;
  - verifys (`OutlivedBy`, `IsEmpty`, `AnyBound`, `GenericBoundFailure` with the normalized region);
  - dedup with `Unreachable`, where the caller's data stays untouched;
  - the decomposition assert;
  - `IndexedConstraintEdges` order.
- **Free regions / env:**
  - `sub_free_regions`: reflexive, `'static` on the right, the relation call order;
  - `lub_param_regions`, its asserts, `RegionBoundPairs` dedup by value;
  - the env accessors, and `from_normalized_bounds` stopping.
- **Leak check:**
  - the `outer == max` fast path;
  - the stop at `VecGraph::new`;
  - `iterate_region_constraints`: edge direction, `VisibleForLeakCheck::No` skipped, snapshot-only entries;
  - `add_node` numbering;
  - the logic of `assign_placeholder_values` / `propagate_scc_value` over a test-local SCC computation: `R: P` is
    ok, `P1 == P2`, `P: R` with an unnameable universe, and `P1: ?0: P2` transitively.
- **How the expectations were derived:** by tracing the upstream code paths named in each test. There is no probe:
  nothing in the driver reaches this code yet.
- **Test stand-ins (`PORT(test)`):**
  - a `TransitiveRelation` view with no edges;
  - a Tarjan `Sccs` view numbered in post order;
  - in two tests, a temporary `SubregionOrigin.span` for `RelateObjectBound(sp) => sp` (infer-core's companion,
    restored in `finally`).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see the end of this file.
- `bun scripts/coverage.ts --check`: `markers ok (13417; vendor 3888)`.
- Sample difftest: see the end of this file.

## `unported(...)` left
- **rustc_data_structures, which no lane owns** (see "For root" 1):
  - `rustc_data_structures::graph::vec_graph::VecGraph::new` and `rustc_data_structures::graph::scc::Sccs::new`
    (leak_check.ts). `leak_check` with `outer_universe != max_universe` stops there, after collecting the graph.
  - `rustc_data_structures::transitive_relation::TransitiveRelationBuilder::{default, add, freeze}` (outlives/env.ts).
    `OutlivesEnvironment::from_normalized_bounds` stops at `default`, its first line.
- `<TyCtxt as IrPrint<ty::PlaceholderType>>::print` (region_constraints/mod.ts, `display_GenericKind`'s `Placeholder` arm):
  - rustc_type_ir's `IR_PRINT` registry has no `Placeholder` slot;
  - rustc_middle's `forward_display_to_print` is module-private.
- `rustc_infer::infer::outlives::test_type_match::extract_verify_if_eq` (lexical_region_resolve/mod.ts): a
  `PORT(merge)` stand-in, because lane infer-canonical-outlives picks the TS form of this comment-only declaration.
  Repoint it at merge. It is reached only by `VerifyBound::IfEq` in `bound_is_met`.
- **Reached, but owned by other lanes:**
  - `SubregionOrigin::span`, which `combine_vars` and the `span_bug!`s need, and `RegionVariableOrigin::span`
    (both infer-core);
  - `explicit_outlives_bounds` (infer-canonical-outlives);
  - the generated `unported_clone` of `FreeRegionMap.relation`, which `clone_OutlivesEnvironment` reaches.

## PORT decisions (please record)
1. **Plain-struct keys:**
   - `CombineMap` (`FxHashMap<TwoRegions, RegionVid>`) is a `KeyedMap` on `intern_key`, and
     `clone_RegionConstraintStorage` keeps it keyed. The map is only probed, never iterated.
   - `RegionBoundPairs` (`FxIndexSet<OutlivesClause<GenericKind>>`) is a `KeyedSet` on `intern_key`
     (`new_RegionBoundPairs`).
   - `higher_ranked_assumptions` is kept as the caller's set; callers should pass a `KeyedSet` on `intern_key`.
2. **Views of unported rustc_data_structures types**, following rustc_type_ir region_constraint.ts:
   - `FreeRegionMap.relation` goes through `TransitiveRelationView` (`elements`, `is_empty`, `contains`,
     `postdom_upper_bound`);
   - `MiniGraph.sccs` goes through `Sccs` (`num_sccs`, `scc`, `all_sccs` in post order, `successors`);
   - builders are stand-ins that stop UNPORTED.
3. **`&mut VarValue` places** are `MutRef<VarValue>` views onto the `values` slot (`value_slot`). `value_mut` returns the
   element, as decls.ts declares.
4. **`infer_variable_values`' `retain_mut`** builds new `Constraint`s (they are `Copy`) in a new
   `RegionConstraintData` assigned to `resolver.data`. Upstream moves the data in, so the caller never observes it,
   and here the caller's object is not mutated either.
5. **`Constraint::iter_outlives`** returns an array of one or two constraints. `IndexedConstraintEdges` pairs share the
   data's origin objects (`&'data SubregionOrigin`).
6. **Statics and nested fns:**
   - `LeakCheck::new`, `MiniGraph::{new, iterate_region_constraints, add_node}` and
     `IndexedConstraintEdges::build_index` are statics declared by a `declare module` / `namespace` in the lane's own
     module;
   - the methods of the generated classes are prototype assignments;
   - the nested fns `region_order_key` / `process_edges` (and the local `WalkState` struct) are module-level
     functions, placed in upstream order.
7. **`debug!` / `#[instrument]`** are kept as comments. The `cfg!(debug_assertions)` call of `dump_constraints` is
   omitted (rustc ships without debug assertions); the fn itself is ported.
8. **`write!(f, "{p:?}")` in the manual Debug impls** formats with `PLAIN`: a fresh spec, with no `#` inherited.

## For root
1. **No lane owns these rustc_data_structures files:** `graph/scc/mod.rs`, `graph/vec_graph/mod.rs` and
   `transitive_relation.rs`. plan-m3 lists them under rustc_data_structures. Until they are ported:
   - the leak check stops whenever a new universe exists;
   - `OutlivesEnvironment::from_normalized_bounds` always stops;
   - lexical resolution stops at any param-vs-param `sub_free_regions` / `lub_param_regions` (through the
     `TransitiveRelation` view of a relation that cannot be built).

   A small lane should port them. When it does:
   - repoint `leak_check.ts`'s `VecGraph_new` / `Sccs_new` and the `Sccs` view;
   - repoint `env.ts`'s `TransitiveRelationBuilder_*` and `free_regions.ts`'s `TransitiveRelationView`;
   - repoint rustc_type_ir region_constraint.ts's and solver_region_constraints.ts's stand-ins (tyir-misc /
     nts-eval).

   Also note tyir-misc's D6 remark on the order of `base_edges`.
2. **Merge repoints:**
   - `extract_verify_if_eq` → lane infer-canonical-outlives' `test_type_match` export;
   - the two test-only `SubregionOrigin.span` stand-ins can go once infer-core lands (the tests then use the real
     companion).
3. **`IR_PRINT` has no `Placeholder` slot:** rustc_type_ir ir_print.ts's `IrPrintImpls` lacks one, so `Display` of
   `ty::PlaceholderType` (`define_print_and_forward_display!`, rustc_middle pretty.rs:3323) cannot be reached from
   outside pretty.ts. `display_GenericKind`'s `Placeholder` arm is a stand-in.
4. **contract.test.ts edit:** one assertion (see "Files").
