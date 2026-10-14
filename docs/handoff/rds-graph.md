# Handoff: rds-graph (M3): rustc_data_structures `transitive_relation.rs` + `graph/{mod,iterate,reference,reversed,scc,vec_graph}` + rustc_index `BitMatrix`

Branch `lane/rds-graph` (from `816b5c5`, no merges).

## Files
- `src/rustc_data_structures/transitive_relation.ts` (new): all of `transitive_relation.rs`: `TransitiveRelationBuilder`
  (`default`, `is_empty`, `elements`, `index`, `add_index`, `maybe_map`, `add`, `freeze`, derived `clone`),
  `TransitiveRelation` (`deref`, `clone`, `maybe_map`, `contains`, `reachable_from`, `postdom_upper_bound`,
  `mutual_immediate_postdominator`, `minimal_upper_bounds`, `parents`, `minimal_scc_representative`, `with_closure`,
  `base_edges`), `pare_down`, derived Debug (`debug_TransitiveRelationBuilder`, `debug_TransitiveRelation`).
- `src/rustc_data_structures/graph/mod.ts` (new): traits `DirectedGraph` (+ `DirectedGraph_provided.iter_nodes`),
  `NumEdges`, `StartNode`, `Successors`, `Predecessors`, `ControlFlowGraph` (intersection type), `is_cyclic`,
  `depth_first_search`, `depth_first_search_as_undirected`; `export * as iterate / reversed / scc / vec_graph`.
- `src/rustc_data_structures/graph/iterate/mod.ts` (new, needed by `graph/mod.rs`): `post_order_from(_to)`,
  `post_order_walk`, `reverse_post_order`, `DepthFirstSearch` (+ `debug_DepthFirstSearch`), `NodeStatus`,
  `TriColorDepthFirstSearch`, `TriColorVisitor` (+ `TriColorVisitor_provided`), `CycleDetector`.
- `src/rustc_data_structures/graph/reference.ts`, `graph/reversed.ts` (new): the `&G` forwarding impls and
  `ReversedGraph`.
- `src/rustc_data_structures/graph/scc/mod.ts` (new): `Annotation`, `Annotations`, `Annotation_unit`, `NoAnnotations`,
  `Sccs`, `SccData`, `SccsConstruction` (`construct`, `start_walk_from`, `inspect_node`, `find_state`,
  `walk_unvisited_node`).
- `src/rustc_data_structures/graph/vec_graph/mod.ts` (new): `VecGraph` (`new`, `successors`, `predecessors`,
  `num_nodes`, `num_edges`), `create_index`.
- `src/rustc_index/bit_set.ts` (**not assigned; additive only**): `update_words`, `BitMatrix` (all 13 methods) and
  `debug_BitMatrix`. `TransitiveRelation`'s closure is a `BitMatrix` and no lane owns rustc_index, so without it
  nothing in this lane could run. The existing `DenseBitSet` / `BitIter` code is untouched (only the header comment
  and imports changed). No other lane branch touches `src/rustc_index`.
- Tests (new): `graph/tests.test.ts` (`TestGraph`), `graph/iterate/tests.test.ts`, `graph/scc/tests.test.ts`,
  `graph/vec_graph/tests.test.ts`, `transitive_relation/tests.test.ts` (every upstream test, incl. `bench_sccc` run
  once); `src/rustc_index/bit_set/tests.test.ts` + `matrix_intersection`, `matrix_iter`.
- Oracle (new): `src/rustc_data_structures/graph_probe/{Cargo.toml.in,main.rs}` (rustc-dev probe, tools/probes
  template format, built by hand in `$RUST_TS_DATA/probe-builds/graphprobe`), its output
  `src/rustc_data_structures/graph_oracle.json` (135 KB) and the replay test `graph.oracle.test.ts`: 9 relations
  (up to 60 elements / 330 edges, so the hashbrown table resizes) checking element order, **base-edge order**,
  `maybe_map` orders, `{:?}`/`{:#?}` (incl. `BitMatrix`), `minimal_upper_bounds`, `postdom_upper_bound`, `parents`,
  `reachable_from`, `minimal_scc_representative`, `contains`; 6 SCC graphs checking `scc_indices`, SCC successors,
  `Sccs::reverse`, `VecGraph` successors/predecessors, `depth_first_search(_as_undirected)`, `post_order_from`.
  All 15 match.

## Coverage (`bun scripts/coverage.ts --missing ...`)
- rustc_data_structures: `transitive_relation.rs` 21/21, `transitive_relation/tests.rs` 19/19, `graph/mod.rs` 11/11,
  `graph/tests.rs` 5/5, `graph/reference.rs` 4/4, `graph/reversed.rs` 4/4, `graph/iterate/mod.rs` 19/19,
  `graph/iterate/tests.rs` 4/4, `graph/scc/mod.rs` 27/27, `graph/scc/tests.rs` 30/30, `graph/vec_graph/mod.rs` 8/8,
  `graph/vec_graph/tests.rs` 6/6.
- rustc_index `bit_set.rs`: `update_words` + all `BitMatrix` fns (1319..1473) covered; tests `matrix_intersection`,
  `matrix_iter` covered.
- Not ported (not needed by these files, no consumer yet): `graph/dominators`, `graph/linked_graph`.
- `bun scripts/coverage.ts --check`: `markers ok (13511; vendor 3888)`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see the final commit message / section below.
- Difftest: nothing in the driver reaches these modules yet (all consumers still hold stand-ins), so no suite can
  change; see "Sample difftest" below.

## Exports for the repoints (root / infer lanes)
- `src/rustc_data_structures/transitive_relation.ts`: `TransitiveRelationBuilder.default<T>()`, `b.add(a, b)`,
  `b.freeze()`, `b.clone()`, `b.is_empty()`, `b.elements()`; `TransitiveRelation<T>` class with `contains`,
  `reachable_from`, `postdom_upper_bound`, `minimal_upper_bounds`, `parents`, `mutual_immediate_postdominator`,
  `minimal_scc_representative`, `base_edges()` (generator, hashbrown order), `maybe_map`, `clone`, and the
  Deref-forwarded `is_empty()` / `elements()`. `Option<T>` returns are `T | undefined`.
- `src/rustc_data_structures/graph/vec_graph/mod.ts`: `VecGraph.new<N>(num_nodes, edge_pairs, BR = false)`
  (sorts `edge_pairs` in place, as upstream does with its owned `Vec`).
- `src/rustc_data_structures/graph/scc/mod.ts`: `Sccs.new<N, S>(graph)`, `Sccs.new_with_annotation(graph,
  annotations)`; `sccs.num_sccs()`, `scc(n)`, `all_sccs()` (array, post order), `successors(s)` (`readonly S[]`),
  `scc_indices()`, `reverse()`.
- Repoint list:
  1. `src/rustc_middle/ty/decls.ts:224` `TransitiveRelation<T> = Pending1<...>` -> `export type { TransitiveRelation }
     from "../../rustc_data_structures/transitive_relation.ts"` (then `free_regions.gen.ts` / `region_constraint.gen.ts`
     / `rustc_infer/decls.ts` get the real class).
  2. infer-regions `leak_check.ts`: `VecGraph_new` -> `VecGraph.new`, `Sccs_new` -> `Sccs.new`, the `Sccs` view ->
     the class (same method names; `all_sccs()` / `successors()` return arrays).
  3. infer-regions `outlives/env.ts` `TransitiveRelationBuilder_{default,add,freeze}` and `free_regions.ts`
     `TransitiveRelationView` -> the classes (`elements`, `is_empty`, `contains`, `postdom_upper_bound` exist).
  4. `src/rustc_type_ir/region_constraint.ts` stand-ins (end of file): `TransitiveRelation_reachable_from`,
     `TransitiveRelation_base_edges`, `TransitiveRelationBuilder_{default,add,freeze,clone}` -> methods. D6 is
     resolved: `base_edges` iterates the `FxHashSet<Edge>` in hashbrown order (oracle-checked).
  5. `src/rustc_next_trait_solver/solve/eval_ctxt/solver_region_constraints.ts:276`
     `TransitiveRelationBuilder_default_freeze` -> `TransitiveRelationBuilder.default<Region>().freeze()`.
  6. Test expectations that assert the stand-in stops UNPORTED will flip once repointed:
     `src/rustc_type_ir/tyir_misc_region_constraint.test.ts:402` ("Assumptions::empty needs TransitiveRelationBuilder
     (not ported)") and the infer-regions tests that use test-local relation / Tarjan stand-ins.

## `unported(...)` left
- None. (`VecGraph.predecessors` on a `BR = false` graph is `unreachable`: upstream it does not type-check.)

## PORT decisions
1. `BitMatrix` + `update_words` added to `src/rustc_index/bit_set.ts` (unassigned file, additive) because the closure of
   `TransitiveRelation` is a `BitMatrix` and no lane owns rustc_index. Root: please confirm or move.
2. `FxIndexSet<T>` (elements) is a small private class in transitive_relation.ts (`Map<T, index>` + array:
   `get_index_of`, `insert_full`, positional get); elements are keyed by JS identity (interned `Region`s, numbers,
   strings). There is no shared IndexSet port with `get_index_of` yet.
3. `FxHashSet<Edge>` is rust_ts/hash_map.ts's `FxHashSet` over an `Edge` packed into one number (`source * 2^32 +
   target`, asserted `source < 2^21`), hashed as the derived `Hash` (two `write_usize`), layout 16/8, so iteration is
   hashbrown's. Oracle-checked up to 330 edges.
4. `Frozen<T>` is the inner value; `impl Deref for TransitiveRelation` is `deref()`, plus forwarding `is_empty`,
   `elements`, `index` methods for auto-deref.
5. Field/method name clashes (Rust allows both): fields renamed with a trailing `_`: `TransitiveRelationBuilder.
   elements_`, `DepthFirstSearch.visited_`, `Sccs.scc_indices_`. The method `BitMatrix::words()` is `words_()`
   instead, because the field keeps the name `words` like the existing `DenseBitSet`'s public `words` field. In tests, `Maxes::new` (inherent)
   is `Maxes.new_`.
6. Graph traits are interfaces over `N extends number`; `impl Iterator` returns are `Iterable<N>`; inherent slice
   methods that share a name with the trait method (`VecGraph::successors`/`predecessors`, `Sccs::successors`) are one
   TS method carrying both markers.
7. `Annotation` (`Debug + Copy` with `&mut self` merges) is a function table over immutable values; merges write a new
   value through a `MutRef`, so `*annotation` copies never alias. `Annotations` carries its `Ann` table; `()` is
   `null`. `Annotation` impls must not mutate annotation objects in place.
8. Iterators that upstream suspends across loop iterations (`post_order_walk`'s `by_ref()`, the SCC frame's
   `successors`) are advanced with explicit `next()` (a `for..of` exit would close them). The SCC walk's
   `returned_walk.chain(successor_walk)` is an explicit loop that first takes the returned walk.
9. `const BR: bool` is a `readonly BR` field (`VecGraph.new(.., BR = false)`).
10. Panic messages that format `{node:?}` of a generic `Idx` print the number (only reached on internal bugs).
11. `#[bench] bench_sccc` runs its `b.iter` body once as a test.
12. `SccsConstruction.duplicate_set` (`FxHashSet`, only used for membership) is a JS `Set`.

## For root
- The probe source is in the lane's tree (`graph_probe/`), like stable_hash_probe; move it under `tools/probes/` if
  preferred. Rebuild: copy `Cargo.toml.in` with `@SRC@` replaced, then
  `RUSTC_BOOTSTRAP=1 CARGO_ENCODED_RUSTFLAGS=-C<US>link-arg=-Wl,-rpath,<sysroot>/lib cargo +nightly-2026-10-11 build
  --release` and `./target/release/graphprobe > src/rustc_data_structures/graph_oracle.json`.
