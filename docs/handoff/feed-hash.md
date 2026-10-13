# Handoff: feed-hash (wave 10, M2): query re-feed hashing, DenseBitSet, test scratch isolation

Branch `lane/feed-hash`, based on main 00f8a7b. There are no merges. Commits:
1. re-feed hashing;
2. DenseBitSet::new_filled;
3. scratch isolation;
4. this handoff.

## 1. Query re-feeding
At the pin, the re-feed check is `rustc_middle::query::calls::query_feed` (calls.rs:215). The `hash_value_fn` comes from
`rustc_query_impl::query_vtables` (`hash_result(hcx, &value)`, dep_graph/graph.rs:165).

- **`src/rustc_middle/query/calls.ts` `query_feed`.** This is now upstream's code. It hashes the old and new values with `hash_value_fn`
  inside `tcx.with_stable_hashing_context`. When the hashes differ, it calls `dcx().delayed_bug("Trying to feed an already recorded
  value ...")` and keeps the old value. `no_hash` queries still hit the `bug!`.
- **`src/rustc_query_impl/execution.ts` `check_feedable_consistency`.** This is now ported in full. On a hash mismatch it asserts
  `has_errors()`, with upstream's message (`{:#?}` of the formatted strings).
- **`src/rustc_middle/dep_graph/graph.ts`.** New `hash_result` (graph.rs:165). `with_feed_task` now takes the typed `HashValueFn`.
- **`src/rustc_middle/query/system.ts`.** `HashValueFn<V>` is now the real `(hcx: StableHashState, value: V) => Fingerprint`.
- **`src/rustc_query_impl/query_vtables.ts`.** `hash_value_fn(decl)` is `hash_result` over the decl's generated `stable_hash_value`.
  When a value type has no StableHash impl yet, the call is `unported("rustc_middle::dep_graph::hash_result (StableHash of the values of
  query `X`)")`. The no_hash arm stays `undefined`.
- **`src/rustc_middle/query/query_api.ts`.** `QueryDecl` gains `stable_hash_value: StableHash<V> | undefined`.
- **Codegen.** Please review; these files are outside my file list, but the brief points to the codegen StableHash support.
  - `tools/codegen/queries.ts`:
    - The TypeMapper now produces the value's `StableHash` impl (`Mapped.sh`), taken from three sources:
      - `stable_hash.json`, for primitives, Option, Vec, IndexMap/Set, slices, tuples and unit;
      - `src/<crate>/stable_hash.gen.ts`, for derived impls;
      - `stable_hash_<T>` exported by the type's own module, for manual impls.
    - It emits `stable_hash_value` for each query.
    - The report gains `missing_stable_hash`. 170 hashed value types are still without an impl; 103 queries have one.
    - Regenerated `src/rustc_middle/queries.gen.ts`, and `--check` is clean.
  - `tools/codegen/types.ts`: new set option `stable_hash_types`, which emits derive(StableHash) for only the listed items. It is
    needed for sets over big hand-written files such as ty/mod.rs, where 23 derives exist but only one type is ported.
  - `tools/codegen/types.sets.json`: new set `rustc_middle`, made of ty/mod.rs with `derive_only`, `derive_stable_hash` and
    `stable_hash_types: [rustc_middle::ty::Visibility]`.
  - New GENERATED file `src/rustc_middle/stable_hash.gen.ts`, holding `stable_hash_Visibility<Id>`.
    - For `Visibility<ModId>`, the generated code hashes the discriminant, then `stable_hash_ModId`, which hashes the DefId's
      DefPathHash.
    - `stable_hash_ModId` already existed in rustc_span's generated module.
- **Tests:**
  - `engine.test.ts`: new test. It feeds a struct's visibility twice with equal values, which is a no-op. A different value then
    gives a delayed bug, and the old value is kept.
  - The test session now has `source_map`, because `StableHashState::new` reads it.
  - `build_reduced_graph.test.ts`: the `with_visibility_refeed` stand-in is removed, along with its now-unused imports. All
    struct/union cases still match.

## 2. DenseBitSet
- `DenseBitSet::new_filled` was already ported in `src/rustc_index/bit_set.ts`, by res-macros. `rustc_resolve/lib.ts` already
  re-exports the real class, so no type-only stand-in remains.
- What still stopped `p_macro_rules` was a direct `unported(...new_filled...)` in `src/rustc_resolve/build_reduced_graph.ts`
  `insert_unused_macro`, written by res-graph before bit_set.ts existed.
  - I replaced it with `DenseBitSet.new_filled<number>(nrules)` and imported it from `rustc_index/bit_set.ts`, as upstream's
    `use rustc_index::bit_set::DenseBitSet`.
  - This is one edit in a res-graph file; please review it.
- **What rustc_resolve and rustc_expand reach:**
  - rustc_resolve uses `new_filled`, `remove` and `iter` (macros.rs). All three were already ported.
  - rustc_expand does not use bit_set at all at the pin.
  - Neither crate uses MixedBitSet or GrowableBitSet, so no new bit_set fns were needed.
- **`p_macro_rules` now MATCHES the resdump oracle.** Its PENDING entry is deleted.

## 3. Test scratch isolation
- New `src/rust_ts/test_scratch.ts`. `test_scratch_dir(name)` makes `mkdtemp($RUST_TS_DATA/tmp/<name>-<pid>-XXXXXX)` and
  registers an `afterAll` that removes it.
- The following tests switched from the fixed `tmp/<name>/<RUST_TS_AGENT>` directory to it:
  - `rustc_ast_passes/oracle`
  - `rustc_driver_impl/{driver,inputs,print}.oracle`
  - `rustc_errors/json.oracle`
  - `rustc_feature/oracle`
  - `rustc_lint_defs/lib`
  - `rustc_parse/parser/{diagnostics,item}`
  - `rustc_session/{options,output}.oracle`
  - `std/std.oracle`
  - `tools/codegen/oracle`
- Unused `DATA` imports were dropped.
- After a full run, no `*-<pid>-*` directories are left behind.
- **Left alone:** `vendor/annotate_snippets/oracle.test.ts`. It writes to a fixed `tmp/annotate-oracle`, but only with the opt-in
  `ANNOTATE_DUMP=1`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3380 pass, 1 skip, 0 fail.
- `bun scripts/coverage.ts --check`: markers ok (6665; vendor 2603).
- `--suite parse --sample 200`: 200/200 MATCH (run `20261013-131136-feed-hash-88ix`).
- `bun tools/codegen/queries.ts --check`: up to date.

## Coverage (`--missing`)
| upstream file | ported |
|---|---|
| rustc_middle query/calls.rs | 12/12 |
| rustc_query_impl query_vtables.rs | 7/7 |
| rustc_query_impl execution.rs | 15/22 (unchanged; check_feedable_consistency is now complete, not just marked) |
| rustc_middle dep_graph/graph.rs | 10/62 (+`hash_result`) |
| rustc_index bit_set.rs | 17/117 (unchanged, DenseBitSet subset) |

## `unported(...)` left
- `rustc_middle::dep_graph::hash_result (StableHash of the values of query X)`.
  - It is reached only when a query whose value type has no StableHash yet is re-fed, or is computed after being fed.
  - The list is in `$RUST_TS_DATA/codegen/queries.report.json` → `missing_stable_hash`.
- Not mine, still unported:
  - `stable_hash_DenseBitSet` / `BitMatrix` in `rustc_data_structures/stable_hash.ts`. They need `impl Hash for DenseBitSet`.
  - `stable_hash_EffectiveVisibilities` in middle/privacy.ts. It is now wired as the `effective_visibilities` value hash, but its
    body is still unported.

## PORT decisions (please record)
1. Query value StableHash is generated: queries.gen.ts `stable_hash_value`, resolved by the queries generator from stable_hash.json,
   `<crate>/stable_hash.gen.ts` and the type modules' `stable_hash_<T>`.
   - `hash_value_fn` = `hash_result(hcx, v, stable_hash_value)`.
   - `hash_result`'s `R: StableHash` bound is passed as a fn (stable-hash decision 4).
2. `types.sets.json` sets may restrict derive(StableHash) output with `stable_hash_types`. The rustc_middle set uses it for ty/mod.rs
   (Visibility only); add types there as their TS types get ported.
3. `check_feedable_consistency`'s `query.dep_kind` Debug is the query name, because DepKind variant names are the query names (D3).
4. Oracle tests take scratch directories from `test_scratch_dir`, never a fixed path.

## For root
- Review the codegen changes (queries.ts, types.ts, types.sets.json) and the one-line `build_reduced_graph.ts` edit.
- `docs/claims/wave10-feed-hash.md` can be removed on integration.
